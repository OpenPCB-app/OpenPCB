import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ConversationStore } from "../../../modules/assistant/backend/conversation-store";

// The idempotency index (design_id, idempotency_scope, action_id) +
// createOrGetWriteProposal's catch→return-existing makes a duplicate action a
// no-op even under a concurrent submit. Exercises the real ConversationStore
// over an in-memory SQLite built from the REAL assistant migrations, so the
// schema here can never drift from production.
const MIGRATIONS_DIR = path.resolve(
  import.meta.dir,
  "../../../modules/assistant/backend/migrations",
);

function makeStore(): { store: ConversationStore; db: Database } {
  const db = new Database(":memory:");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.run(statement);
    }
  }
  const ctx = {
    db: {
      rawSql: (q: string, p: unknown[] = []) =>
        db.query(q).all(...(p as never[])) as Record<string, unknown>[],
    },
  };
  return { store: new ConversationStore(ctx as never), db };
}

function count(db: Database): number {
  const rows = db
    .query("SELECT COUNT(*) AS n FROM assistant_write_proposal")
    .all() as Array<{ n: number }>;
  return rows[0]!.n;
}

const ACTOR_A = { type: "mcp" as const, clientKey: "claude-code", instanceId: "a" };
const ACTOR_B = { type: "mcp" as const, clientKey: "claude-code", instanceId: "b" };

describe("action_id idempotency (DB backstop)", () => {
  const wire = (chatId: string, actor: typeof ACTOR_A | null = null) => ({
    chatId,
    designId: "d1",
    baseRevision: 0,
    kind: "designer_schematic_wires",
    proposal: {},
    envelope: { actionId: "wire_U1.OUT__R1.1_d1" },
    actor,
  });

  test("the same action in the same chat returns the first proposal — no duplicate row", () => {
    const { store, db } = makeStore();
    const first = store.createOrGetWriteProposal(wire("c1") as never);
    const second = store.createOrGetWriteProposal(wire("c1") as never);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(count(db)).toBe(1);
  });

  test("proposals without an action_id are never deduped", () => {
    const { store, db } = makeStore();
    const base = {
      chatId: "c1",
      designId: "d1",
      baseRevision: 0,
      kind: "designer_schematic_edits",
      proposal: {},
      envelope: {},
    };
    const a = store.createWriteProposal(base as never);
    const b = store.createWriteProposal(base as never);
    expect(b.id).not.toBe(a.id);
    expect(count(db)).toBe(2);
  });

  test("in-app, the same deterministic id in another chat is a different action", () => {
    const { store, db } = makeStore();
    expect(store.createOrGetWriteProposal(wire("c1") as never).created).toBe(true);
    expect(store.createOrGetWriteProposal(wire("c2") as never).created).toBe(true);
    expect(count(db)).toBe(2);
  });

  test("an MCP session dedupes across its chats; another session does not collide", () => {
    const { store, db } = makeStore();
    const first = store.createOrGetWriteProposal(wire("home-a", ACTOR_A) as never);
    const retry = store.createOrGetWriteProposal(wire("design-a", ACTOR_A) as never);
    expect(retry.created).toBe(false);
    expect(retry.record.id).toBe(first.record.id);
    expect(store.createOrGetWriteProposal(wire("design-b", ACTOR_B) as never).created).toBe(true);
    expect(count(db)).toBe(2);
    expect(first.record.actor).toEqual(ACTOR_A);
  });
});
