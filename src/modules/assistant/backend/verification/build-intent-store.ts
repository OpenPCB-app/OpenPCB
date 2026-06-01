import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { BuildIntent, BuildIntentItem } from "./types";

type RawSqlFn = (
  query: string,
  params?: unknown[],
) => Record<string, unknown>[];

function rawSqlFrom(ctx: CoreBackendModuleContext): RawSqlFn {
  return (
    ctx.db as { rawSql<T = unknown>(q: string, p?: unknown[]): T[] }
  ).rawSql.bind(ctx.db);
}

function uuid(): string {
  return crypto.randomUUID();
}
function nowIso(): string {
  return new Date().toISOString();
}

function decodeStringArray(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Persistence for {@link BuildIntent} — the resolved BOM + required nets captured
 * from `library_resolve_bom`, keyed by chat + task (migration 0009). The DoD
 * verifier reads it back to compare the finished design to the user's request.
 */
export class BuildIntentStore {
  private rawSqlFn: RawSqlFn | null = null;

  // Resolve the raw-SQL binding lazily: the store is constructed eagerly by
  // RunService, but some unit harnesses build RunService with a ctx that has no
  // `db`. Deferring the lookup keeps construction side-effect-free.
  constructor(private readonly ctx: CoreBackendModuleContext) {}

  private get rawSql(): RawSqlFn {
    if (!this.rawSqlFn) this.rawSqlFn = rawSqlFrom(this.ctx);
    return this.rawSqlFn;
  }

  /**
   * Replace the intent for a (chatId, taskId). The latest resolve wins —
   * a delete-then-insert keeps re-resolves from accumulating stale items.
   */
  save(intent: BuildIntent): void {
    const existing = this.rawSql(
      "SELECT id FROM assistant_build_intent WHERE chat_id=? AND task_id=?",
      [intent.chatId, intent.taskId],
    )[0];
    const timestamp = nowIso();
    const intentId = (existing?.id as string | undefined) ?? uuid();
    if (existing) {
      this.rawSql(
        "DELETE FROM assistant_build_intent_item WHERE build_intent_id=?",
        [intentId],
      );
      this.rawSql(
        "UPDATE assistant_build_intent SET goal=?, updated_at=? WHERE id=?",
        [intent.goal, timestamp, intentId],
      );
    } else {
      this.rawSql(
        "INSERT INTO assistant_build_intent (id,chat_id,task_id,goal,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [
          intentId,
          intent.chatId,
          intent.taskId,
          intent.goal,
          timestamp,
          timestamp,
        ],
      );
    }
    for (const item of intent.items) {
      this.rawSql(
        "INSERT INTO assistant_build_intent_item (id,build_intent_id,role,component_id,quantity,value,required_nets_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          uuid(),
          intentId,
          item.role,
          item.componentId,
          Math.max(1, Math.floor(item.quantity)),
          item.value ?? null,
          JSON.stringify(item.requiredNets ?? []),
        ],
      );
    }
  }

  /** Load the intent for a (chatId, taskId), or null when none was captured. */
  get(chatId: string, taskId: string): BuildIntent | null {
    const row = this.rawSql(
      "SELECT * FROM assistant_build_intent WHERE chat_id=? AND task_id=?",
      [chatId, taskId],
    )[0];
    if (!row) return null;
    const items = this.rawSql(
      "SELECT * FROM assistant_build_intent_item WHERE build_intent_id=?",
      [String(row.id)],
    ).map(
      (r): BuildIntentItem => ({
        role: String(r.role),
        componentId: String(r.component_id),
        quantity: Number(r.quantity),
        value:
          r.value === null || r.value === undefined
            ? undefined
            : String(r.value),
        requiredNets: decodeStringArray(r.required_nets_json),
      }),
    );
    return {
      chatId: String(row.chat_id),
      taskId: String(row.task_id),
      goal: String(row.goal),
      items,
    };
  }
}
