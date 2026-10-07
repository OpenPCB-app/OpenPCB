import type { AiRunEvent, ChatDto, MessageDto, ProposalDto, ToolEventDto } from "agentkit/contracts";
import { CONTRACT_VERSION } from "agentkit/contracts";

const time = "2026-10-07T10:00:00.000Z";
export const provider = { id: "local", label: "Local fixture", kind: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1", defaultModel: "fixture-model", enabled: true, hasApiKey: false, isBuiltin: false, capabilities: { streaming: true, toolCalling: true, modelList: true } };
export const settings = { defaultProviderId: "local", defaultModel: "fixture-model", contextSizePreference: "medium", writePolicyMode: "confirm_all_writes", allowRawToolData: false, toolCalling: "auto", metadata: {} };
export const appSettings = { ...settings, defaultPromptPresetId: "minimal-concise", mcpEnabled: false, mcpAllowWrites: false };
export class AgentKitHttpFixture {
  requests: { url: URL; method: string; headers: Headers; body: Record<string, unknown> }[] = [];
  chats = new Map<string, ChatDto>();
  messages = new Map<string, MessageDto[]>();
  runs = new Map<string, { runId: string; chatId: string; scopeId: string; status: string; createdAt: string }>();
  events = new Map<string, AiRunEvent[]>();
  tools = new Map<string, ToolEventDto[]>();
  proposals = new Map<string, ProposalDto>();
  presentations = new Map<string, unknown>();
  allowances = new Map<string, { key: string; chatId: string; scopeKey: string; toolName: string; proposalKind: string; maxRisk: string; createdAt: string }>();
  submissions = new Map<string, { chatId: string; userMessageId: string; assistantMessageId: string; runId: string }>();
  connections = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
  loseNextPost = false;
  loseNextApply = false;
  mutationCount = 0;
  preferenceProvider = { ...provider };
  delayProviders: Promise<void> | null = null;
  preferenceAppSettings = { ...appSettings };
  modelCatalogue = [{ providerId: "local", modelId: "fixture-model", displayName: "Fixture", fetchedAt: time }];
  delayAppSettings: Promise<void> | null = null;
  delayChats: Promise<void> | null = null;
  delayBinding: Promise<void> | null = null;
  delayCreate: Promise<void> | null = null;
  delayProposals = new Map<string, Promise<void>>();
  preferenceSettings = { ...settings };
  delaySettings: Promise<void> | null = null;
  delayMessages = new Map<string, Promise<void>>();
  closed = false;
  constructor() { this.addChat("chat-a"); this.addChat("chat-b"); }
  addChat(id: string, metadata: Record<string, unknown> = {}) {
    this.chats.set(id, { id, title: id, archived: false, metadata, createdAt: time, updatedAt: time, activeRunId: null });
    this.messages.set(id, []);
  }
  append(runId: string, type: AiRunEvent["type"], data: unknown) {
    const items = this.events.get(runId) ?? [];
    const event = { runId, type, data, timestamp: time, contractVersion: CONTRACT_VERSION, eventId: `${runId}:${items.length + 1}`, seq: items.length + 1 } as AiRunEvent;
    items.push(event); this.events.set(runId, items);
    for (const connection of this.connections.get(runId) ?? []) connection.enqueue(this.frame(event));
  }
  frame(event: AiRunEvent) { return new TextEncoder().encode(`id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); }
  disconnect(runId: string) {
    for (const connection of this.connections.get(runId) ?? []) connection.error(new Error("fixture connection lost"));
    this.connections.delete(runId);
  }
  settle(runId: string, status = "completed", finalContent = "Authoritative answer") {
    const run = this.runs.get(runId)!; run.status = status;
    const chat = this.chats.get(run.chatId)!; chat.activeRunId = status === "interrupted" ? runId : null;
    for (const message of this.messages.get(run.chatId) ?? []) if (message.role === "assistant" && message.runId === runId) { message.content = finalContent; message.metadata = { placeholder: false }; }
    for (const connection of this.connections.get(runId) ?? []) { connection.enqueue(new TextEncoder().encode("event: agentkit.stream.settled\ndata: {}\n\n")); connection.close(); }
    this.connections.delete(runId);
  }
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    this.requests.push({ url, method, headers, body });
    const path = url.pathname.replace("/api/modules/assistant", "");
    if (path === "/v1/settings") { const snapshot = { ...this.preferenceSettings }; await this.delaySettings; return Response.json(snapshot); }
    if (path === "/settings") { const snapshot = { ...this.preferenceAppSettings }; await this.delayAppSettings; return Response.json(snapshot); }
    if (path === "/prompt-presets") return Response.json([{ id: "minimal-concise", label: "Concise", description: "Concise" }]);
    if (path === "/v1/providers") { const snapshot = structuredClone(this.preferenceProvider); await this.delayProviders; return Response.json([snapshot]); }
    if (path === "/v1/providers/local/models") return Response.json(this.modelCatalogue);
    if (path === "/v1/tools") return Response.json([]);
    if (path === "/v1/chats") {
      if (method === "POST") { await this.delayCreate; const id = `chat-${this.chats.size + 1}`; this.addChat(id, body.metadata as Record<string, unknown>); return Response.json(this.chats.get(id), { status: 201 }); }
      const snapshot = structuredClone([...this.chats.values()]); await this.delayChats; return Response.json(snapshot);
    }
    const chatMatch = /^\/v1\/chats\/([^/]+)$/.exec(path);
    if (chatMatch) return Response.json(this.chats.get(chatMatch[1]!));
    const bindingMatch = /^\/v1\/chats\/([^/]+)\/context-bindings$/.exec(path);
    if (bindingMatch) { await this.delayBinding; const chat = this.chats.get(bindingMatch[1]!)!; chat.metadata.designId = body.designId; return Response.json({ id: "binding", refId: body.designId }, { status: 201 }); }
    const messageMatch = /^\/v1\/chats\/([^/]+)\/messages$/.exec(path);
    if (messageMatch) {
      const chatId = messageMatch[1]!;
      if (method === "GET") { await this.delayMessages.get(chatId); return Response.json({ items: this.messages.get(chatId) }); }
      const key = headers.get("Idempotency-Key")!;
      let accepted = this.submissions.get(key);
      if (!accepted) {
        const runId = `run-${this.submissions.size + 1}`;
        accepted = { chatId, runId, userMessageId: `${runId}-user`, assistantMessageId: `${runId}-assistant` };
        this.submissions.set(key, accepted);
        this.runs.set(runId, { runId, chatId, scopeId: "workspace", status: "running", createdAt: time });
        this.chats.get(chatId)!.activeRunId = runId;
        this.messages.get(chatId)!.push(
          { id: accepted.userMessageId, chatId, runId, role: "user", content: String(body.content), metadata: body.metadata as Record<string, unknown>, createdAt: time },
          { id: accepted.assistantMessageId, chatId, runId, role: "assistant", content: "", metadata: { placeholder: true }, createdAt: time },
        );
      }
      if (this.loseNextPost) { this.loseNextPost = false; throw new Error("POST response lost"); }
      return Response.json(accepted, { status: 202 });
    }
    if (path.endsWith("/native-write-allowances")) return Response.json([...this.allowances.values()]);
    const allowanceMatch = /\/native-write-allowances\/(.+)$/.exec(path);
    if (allowanceMatch && method === "DELETE") { this.allowances.delete(decodeURIComponent(allowanceMatch[1]!)); return new Response(null, { status: 204 }); }
    const toolMatch = /^\/v1\/chats\/([^/]+)\/tool-events$/.exec(path);
    if (toolMatch) return Response.json(this.tools.get(toolMatch[1]!) ?? []);
    const proposalsMatch = /^\/v1\/chats\/([^/]+)\/proposals$/.exec(path);
    if (proposalsMatch) { const snapshot = structuredClone([...this.proposals.values()].filter(item => item.chatId === proposalsMatch[1])); await this.delayProposals.get(proposalsMatch[1]!); return Response.json(snapshot); }
    const proposalMatch = /^\/v1\/proposals\/([^/]+)(?:\/(approve|apply|reject|presentation|allow-session))?$/.exec(path);
    if (proposalMatch) {
      const id = proposalMatch[1]!; const action = proposalMatch[2]; const proposal = this.proposals.get(id)!;
      if (action === "allow-session") {
        if (proposal.risk !== "destructive") return Response.json({ title: "Only destructive proposals support session consent" }, { status: 400 });
        const allowance = { key: "trusted:allowance:key", chatId: proposal.chatId, scopeKey: `native:actor:chat:${proposal.chatId}:design:design-real`, toolName: proposal.toolName, proposalKind: proposal.kind, maxRisk: proposal.risk, createdAt: time };
        this.allowances.set(allowance.key, allowance); return Response.json(allowance);
      }
      if (action === "presentation") return Response.json(this.presentations.get(id));
      if (action === "approve") proposal.status = "approved";
      if (action === "reject") proposal.status = "rejected";
      if (action === "apply") {
        if (body.operationId !== `native:${id}`) return Response.json({ title: "Wrong identity" }, { status: 400 });
        if (!proposal.outcome) {
          this.mutationCount++; proposal.status = "applied";
          proposal.outcome = { status: "partial", appliedOps: 1, failedOps: [{ opIndex: 1, error: "Fixture placement refused" }] };
          const presentation = this.presentations.get(id) as { outcome: unknown };
          presentation.outcome = { ...proposal.outcome, revision: "7", resultJson: JSON.stringify({ designId: "design-real", receipts: [{ commandId: "command-real", result: { ok: true, revision: 7, createdEntityId: "part-real" } }] }) };
        }
        if (this.loseNextApply) { this.loseNextApply = false; throw new Error("Apply response lost"); }
      }
      return Response.json(proposal);
    }
    const runMatch = /^\/v1\/runs\/([^/]+)(?:\/(stream|cancel|resume))?$/.exec(path);
    if (runMatch) {
      const id = runMatch[1]!; const action = runMatch[2]; const run = this.runs.get(id)!;
      if (action === "stream") return this.stream(id, headers.get("Last-Event-ID"), init?.signal);
      if (action === "cancel") { this.append(id, "run.cancelled", {}); this.settle(id, "cancelled", "Stopped answer"); }
      if (action === "resume") { run.status = "running"; this.chats.get(run.chatId)!.activeRunId = id; }
      return Response.json(run);
    }
    throw new Error(`Fixture route missing: ${method} ${path}`);
  };
  stream(runId: string, cursor: string | null, signal?: AbortSignal | null) {
    const fixture = this;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let seen = false;
        for (const event of fixture.events.get(runId) ?? []) {
          if (!cursor || seen) controller.enqueue(fixture.frame(event));
          if (event.eventId === cursor) seen = true;
        }
        const run = fixture.runs.get(runId)!;
        if (["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
          controller.enqueue(new TextEncoder().encode("event: agentkit.stream.settled\ndata: {}\n\n")); controller.close(); return;
        }
        const group = fixture.connections.get(runId) ?? new Set(); group.add(controller); fixture.connections.set(runId, group);
        signal?.addEventListener("abort", () => { group.delete(controller); try { controller.close(); } catch { /* Already closed by a terminal event. */ } }, { once: true });
      }, cancel() { /* The caller's abort releases the controller above. */ }
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }
  close() { for (const id of this.connections.keys()) this.settle(id, "cancelled"); this.closed = true; }
}
