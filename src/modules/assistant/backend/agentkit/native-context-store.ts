import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { AiContextBinding, AiContextBindingStatus, AssistantContextBindingDto } from "../../../../sdks";
import type { ContextBindingStore } from "../context-resolver";
import type { BuildIntent } from "../verification/types";

/** Domain context is application data; chat history and proposal state belong to AgentKit. */
export interface NativeActionReservation {
  actorScope: string; chatId: string; actionId: string; designId: string; toolName: string;
  argumentFingerprint: string; proposalId: string;
}

export class NativeContextStore implements ContextBindingStore {
  constructor(private readonly context: CoreBackendModuleContext) {}

  listBindings(chatId: string): AssistantContextBindingDto[] {
    return this.context.db.rawSql<Record<string, unknown>>(
      "SELECT * FROM assistant_native_context_binding WHERE chat_id=? ORDER BY created_at, id", [chatId],
    ).map((row) => ({
      id: String(row.id), chatId: String(row.chat_id), kind: String(row.kind) as AiContextBinding["kind"],
      refId: String(row.ref_id), label: String(row.label), role: String(row.role) as AiContextBinding["role"],
      status: String(row.status) as AiContextBindingStatus,
      metadata: row.metadata ? JSON.parse(String(row.metadata)) as Record<string, unknown> : undefined,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }));
  }

  createBinding(chatId: string, binding: AiContextBinding): AssistantContextBindingDto {
    const timestamp = new Date().toISOString();
    this.context.db.rawSql(
      "INSERT INTO assistant_native_context_binding (id,chat_id,kind,ref_id,label,role,status,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [binding.id, chatId, binding.kind, binding.refId, binding.label, binding.role, binding.status,
        JSON.stringify(binding.metadata ?? null), timestamp, timestamp],
    );
    return this.listBindings(chatId).find((item) => item.id === binding.id)!;
  }

  updateBindingStatus(bindingId: string, status: AiContextBindingStatus): void {
    this.context.db.rawSql(
      "UPDATE assistant_native_context_binding SET status=?,updated_at=? WHERE id=?",
      [status, new Date().toISOString(), bindingId],
    );
  }

  deleteBinding(chatId: string, bindingId: string): void {
    this.context.db.rawSql("DELETE FROM assistant_native_context_binding WHERE chat_id=? AND id=?", [chatId, bindingId]);
  }

  deleteChatContext(chatId: string): void {
    this.context.db.rawSql("DELETE FROM assistant_native_context_binding WHERE chat_id=?", [chatId]);
    this.context.db.rawSql("DELETE FROM assistant_native_build_intent WHERE chat_id=?", [chatId]);
  }

  getAction(actorScope: string, chatId: string, actionId: string): NativeActionReservation | null {
    const row = this.context.db.rawSql<Record<string, unknown>>(
      "SELECT * FROM assistant_native_action WHERE actor_scope=? AND chat_id=? AND action_id=?", [actorScope, chatId, actionId],
    )[0];
    return row ? { actorScope, chatId, actionId, designId: String(row.design_id), toolName: String(row.tool_name),
      argumentFingerprint: String(row.argument_fingerprint), proposalId: String(row.proposal_id) } : null;
  }

  reserveAction(input: NativeActionReservation): NativeActionReservation {
    this.context.db.rawSql(
      "INSERT OR IGNORE INTO assistant_native_action (actor_scope,chat_id,action_id,design_id,tool_name,argument_fingerprint,proposal_id) VALUES (?,?,?,?,?,?,?)",
      [input.actorScope, input.chatId, input.actionId, input.designId, input.toolName, input.argumentFingerprint, input.proposalId],
    );
    const reserved = this.getAction(input.actorScope, input.chatId, input.actionId)!;
    if (reserved.designId !== input.designId || reserved.toolName !== input.toolName ||
        reserved.argumentFingerprint !== input.argumentFingerprint) throw new Error("OPERATION_IDENTITY_CONFLICT");
    return reserved;
  }

  saveBuildIntent(intent: BuildIntent): void {
    this.context.db.rawSql(
      "INSERT INTO assistant_native_build_intent (chat_id,run_id,intent_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(chat_id,run_id) DO UPDATE SET intent_json=excluded.intent_json,updated_at=excluded.updated_at",
      [intent.chatId, intent.taskId, JSON.stringify(intent), new Date().toISOString()],
    );
  }

  getBuildIntent(chatId: string, runId: string): BuildIntent | null {
    const row = this.context.db.rawSql<{ intent_json: string }>(
      "SELECT intent_json FROM assistant_native_build_intent WHERE chat_id=? AND run_id=?", [chatId, runId],
    )[0];
    return row ? JSON.parse(row.intent_json) as BuildIntent : null;
  }
}
