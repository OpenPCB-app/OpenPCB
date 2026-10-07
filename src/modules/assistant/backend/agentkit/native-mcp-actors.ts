import type { ProposalRecord } from "agentkit/host";
import { nativeIdentity } from "./native-identity";

export interface NativeMcpSettings { mcpEnabled: boolean; mcpAllowWrites: boolean }
interface McpActor { chatId: string; pinnedDesignId: string | null }

/** Only framework-generated session actors enter this registry. Display names confer no rights. */
export class NativeMcpActors {
  private readonly actors = new Map<string, McpActor>();
  private readonly sessionChats = new Set<string>();

  constructor(private readonly settings: () => NativeMcpSettings, private readonly readOnly = false) {}

  admitSessionChat(chatId: string): void { this.sessionChats.add(chatId); }

  register(actorId: string, chatId: string): string {
    if (!this.sessionChats.has(chatId) || !/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error("MCP_ACTOR_DENIED");
    const scope = `mcp:${actorId}`;
    const prior = this.actors.get(scope);
    if (prior && prior.chatId !== chatId) throw new Error("MCP_ACTOR_DENIED");
    if (!prior) this.actors.set(scope, { chatId, pinnedDesignId: null });
    return scope;
  }

  canWrite(scope: string, chatId: string): boolean {
    const settings = this.settings();
    return !this.readOnly && settings.mcpEnabled && settings.mcpAllowWrites && this.actors.get(scope)?.chatId === chatId;
  }

  canApprove(proposal: ProposalRecord): boolean {
    try { return this.canWrite(nativeIdentity(proposal).actorScope, proposal.chatId); }
    catch { return false; }
  }

  has(scope: string, chatId: string): boolean { return this.actors.get(scope)?.chatId === chatId; }
  pinnedDesign(scope: string): string | null { return this.actors.get(scope)?.pinnedDesignId ?? null; }

  pin(scope: string, designId: string | null): void {
    const actor = this.actors.get(scope);
    if (!actor) throw new Error("MCP_ACTOR_DENIED");
    actor.pinnedDesignId = designId;
  }

  close(actorId: string, sessionChatId?: string): string | null {
    const scope = `mcp:${actorId}`;
    const actor = this.actors.get(scope);
    this.actors.delete(scope);
    const chatId = actor?.chatId ?? sessionChatId;
    if (chatId) this.sessionChats.delete(chatId);
    return chatId ?? null;
  }

  clear(): void { this.actors.clear(); this.sessionChats.clear(); }
  sessions(): Array<{ actorScope: string; chatId: string }> {
    return [...this.actors].map(([actorScope, actor]) => ({ actorScope, chatId: actor.chatId }));
  }
}
