import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { SqliteAssistantStore } from "agentkit/adapters-sqlite";
import * as McpFramework from "agentkit/mcp-server";
import { ProposalService, SessionWritePolicy, defaultClock, defaultIds, type ProposalApplier } from "agentkit/host";
import { isolatedDomain, UI_SESSION, type ParityDomain } from "../../../../core/backend/tests/fixtures/assistant-parity/domain";
import { createNativeMcpEndpoint } from "./native-mcp";
import { createNativeMcpProposalApplier } from "./native-mcp-applier";
import { NativeMcpActors, type NativeMcpSettings } from "./native-mcp-actors";
import { nativeIdentity } from "./native-identity";
import { allowNativeSession } from "./native-session-grants";

const TOKEN = "native-mcp-test-token";
let domain: ParityDomain;
let store: SqliteAssistantStore;
let proposals: ProposalService;
let policy: SessionWritePolicy;
let applier: ProposalApplier;
let actors: NativeMcpActors;
let endpoint: ReturnType<typeof createNativeMcpEndpoint>;
let server: ReturnType<typeof Bun.serve>;
let url: string;
let settings: NativeMcpSettings;
let designId: string;
let sequence = 0;

beforeEach(async () => {
  domain = await isolatedDomain();
  store = new SqliteAssistantStore(`${domain.dbPath}.mcp-agentkit`);
  settings = { mcpEnabled: true, mcpAllowWrites: true };
  actors = new NativeMcpActors(() => settings);
  policy = new SessionWritePolicy();
  applier = createNativeMcpProposalApplier({ context: domain.ctx, store, actors, contextResolver: domain.contextResolver });
  proposals = new ProposalService({ store, applier, policy, clock: defaultClock, ids: defaultIds });
  endpoint = createNativeMcpEndpoint({ context: domain.ctx, host: { store, proposals, policy }, actors,
    contextStore: domain.contextStore, contextResolver: domain.contextResolver, getSettings: () => settings, getToken: () => TOKEN });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => endpoint.fetch(request) });
  url = `http://127.0.0.1:${server.port}/mcp`;
  designId = (await domain.designer.createDesign({ name: "MCP real domain" })).id;
});
afterEach(async () => { await endpoint?.close(); server?.stop(true); store?.close(); await domain?.close(); });

async function rpc(method: string, params?: unknown, sessionId?: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`,
    "content-type": "application/json", accept: "application/json, text/event-stream", "x-openpcb-mcp-client": "Same display name",
    ...(sessionId ? { "mcp-session-id": sessionId, "mcp-protocol-version": "2025-06-18" } : {}), ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, ...(params === undefined ? {} : { params }) }) });
  const text = await response.text();
  const body = response.headers.get("content-type")?.includes("text/event-stream")
    ? text.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim() : text;
  return { response, value: body ? JSON.parse(body) as Record<string, unknown> : {} };
}

async function initialize(): Promise<string> {
  const initialized = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "Same display name", version: "1.0.0" } });
  expect(initialized.response.status).toBe(200);
  const id = initialized.response.headers.get("mcp-session-id");
  if (!id) throw new Error("Session ID missing");
  await fetch(url, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json",
    accept: "application/json, text/event-stream", "mcp-session-id": id, "mcp-protocol-version": "2025-06-18" },
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  return id;
}

async function call(sessionId: string, name: string, args: Record<string, unknown> = {}) {
  const result = await rpc("tools/call", { name, arguments: args }, sessionId);
  const data = result.value.result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
  const json = data?.content?.map((item) => item.text).findLast((text) => text?.startsWith("{"));
  return { ...result, isError: data?.isError, data: json ? JSON.parse(json) as Record<string, unknown> : {} };
}

function placement(actionId: string, quantity = 2) {
  return { action_id: `place_${actionId}_${designId}`, components: [{ componentId: domain.componentId, quantity }] };
}

async function snapshot(target = designId) {
  const result = await domain.designer.getSchematicProjection(target);
  if (!result) throw new Error("Missing real projection");
  return result;
}

async function disconnect(sessionId: string) {
  return fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": sessionId,
    "mcp-protocol-version": "2025-06-18" } });
}

describe("canonical AgentKit MCP embedded over real OpenPCB domain", () => {
  test("22 exact tools, original resources and prompts; no provider, task or inference surface", async () => {
    const providerReads = spyOn(domain.providers, "getProvider");
    const session = await initialize();
    const catalog = await rpc("tools/list", undefined, session);
    const entries = (catalog.value.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
    expect(entries).toHaveLength(22);
    for (const native of domain.registry.listDefinitions()) {
      expect(entries.find((item) => item.name === native.name)?.inputSchema).toEqual(native.inputSchema);
    }
    expect(entries.some((item) => /provider|secret|inference|chat|task/.test(item.name))).toBe(false);
    const designs = await call(session, "designer_list_designs");
    expect(designs.isError).not.toBe(true);
    const resources = await rpc("resources/list", undefined, session);
    expect((resources.value.result as { resources: unknown[] }).resources).toHaveLength(5);
    const resource = await rpc("resources/read", { uri: `openpcb://design/${designId}/schematic` }, session);
    const contents = (resource.value.result as { contents: Array<{ text: string }> }).contents;
    expect(JSON.parse(contents[0]!.text).revision).toBe(0);
    const promptCatalog = await rpc("prompts/list", undefined, session);
    expect((promptCatalog.value.result as { prompts: unknown[] }).prompts).toHaveLength(4);
    const prompt = await rpc("prompts/get", { name: "openpcb-build-circuit", arguments: { spec: "5V capacitor" } }, session);
    expect(JSON.stringify(prompt.value.result)).toContain("Build this circuit in OpenPCB: 5V capacitor");
    expect(providerReads).toHaveBeenCalledTimes(0);
    for (const chat of await store.conversations.listChats()) expect(await store.tasks.listByScope(chat.id)).toHaveLength(0);
    providerReads.mockRestore();
  });

  test("pin, real two-part edit, IDs, receipt replay, undo and explicitly approved delete exactly once", async () => {
    const providerReads = spyOn(domain.providers, "getProvider");
    const session = await initialize();
    expect((await call(session, "designer_use_design", { designId })).data).toEqual({ pinnedDesignId: designId });
    const placed = await call(session, "designer_place_components", placement("mcp_place"));
    expect(placed.isError).not.toBe(true);
    expect(placed.data).toMatchObject({ status: "ok", appliedCount: 2, designId });
    const original = await snapshot();
    expect(original.parts).toHaveLength(2);
    expect(original.revision).toBe(2);
    const returned = (placed.data.results as Array<{ createdEntityId: string }>).map((item) => item.createdEntityId).sort();
    expect(returned).toEqual(original.parts.map((part) => part.id).sort());
    const repeat = await call(session, "designer_place_components", placement("mcp_place"));
    expect(repeat.data).toMatchObject({ status: "already_applied", appliedCount: 2 });
    expect((await snapshot()).revision).toBe(2);
    const deletion = await call(session, "designer_propose_schematic_deletions", { action_id: `delete_mcp_${designId}`, title: "Delete C1",
      summary: "Remove C1", entities: [{ entityId: "C1", entityKind: "part" }] });
    expect(deletion.data).toMatchObject({ status: "pending", appliedCount: 0 });
    const proposalId = String(deletion.data.proposalId);
    const proposal = (await store.proposals.get(proposalId))!;
    expect(proposal.risk).toBe("destructive");
    expect(actors.canApprove(proposal)).toBe(true);
    await proposals.approve({ proposalId, actor: "user", decidedBy: "desktop" });
    const outcome = await proposals.apply({ proposalId, operationId: `native:${proposalId}`, authorize: (item) => actors.canApprove(item) });
    expect(outcome).toMatchObject({ status: "applied", appliedOps: 1 });
    expect((await snapshot()).parts).toHaveLength(1);
    expect(await proposals.apply({ proposalId, operationId: `native:${proposalId}` })).toEqual(outcome);
    expect((await snapshot()).revision).toBe(3);
    const actor = nativeIdentity(proposal).actorScope;
    expect(await domain.designer.listOperationReceipts(actor, `native:${proposalId}`)).toHaveLength(1);
    await domain.designer.undo(designId, UI_SESSION);
    expect((await snapshot()).parts).toHaveLength(2);
    expect((await disconnect(session)).status).toBe(200);
    expect(await applier.getOutcome(`native:${proposalId}`)).toEqual(outcome);
    expect(providerReads).toHaveBeenCalledTimes(0);
    providerReads.mockRestore();
  });

  test("revoking live MCP writes after first receipt prevents every later command unit", async () => {
    const session = await initialize();
    await call(session, "designer_use_design", { designId });
    const original = domain.designer.dispatchOperation.bind(domain.designer);
    const dispatch = spyOn(domain.designer, "dispatchOperation").mockImplementation(async (...args) => {
      const result = await original(...args);
      settings.mcpAllowWrites = false;
      return result;
    });
    const result = await call(session, "designer_place_components", placement("revoke", 2));
    expect(result.isError).toBe(true);
    expect(result.data).toMatchObject({ status: "partial", appliedCount: 1 });
    expect((await snapshot()).parts).toHaveLength(1);
    expect((await snapshot()).revision).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const proposalId = String(result.data.proposalId);
    await disconnect(session);
    expect(await applier.getOutcome(`native:${proposalId}`)).toMatchObject({ status: "partial", appliedOps: 1 });
    expect((await snapshot()).parts).toHaveLength(1);
    dispatch.mockRestore();
  });

  test("same display names have separate actors, pins and action identities; disconnect revokes allowance", async () => {
    const first = await initialize();
    const second = await initialize();
    expect(first).not.toBe(second);
    const otherId = (await domain.designer.createDesign({ name: "Second MCP target" })).id;
    await call(first, "designer_use_design", { designId });
    await call(second, "designer_use_design", { designId: otherId });
    await call(first, "designer_place_components", placement("same_action", 1));
    await call(second, "designer_place_components", placement("same_action", 1));
    expect((await snapshot()).parts).toHaveLength(1);
    expect((await snapshot(otherId)).parts).toHaveLength(1);
    const chats = await store.conversations.listChats();
    expect(chats).toHaveLength(2);
    const firstProposal = (await store.proposals.listByChat(chats[0]!.id))[0]!;
    const secondProposal = (await store.proposals.listByChat(chats[1]!.id))[0]!;
    expect(nativeIdentity(firstProposal).actorScope).not.toBe(nativeIdentity(secondProposal).actorScope);
    const live = firstProposal.envelope.designId === designId ? firstProposal : secondProposal;
    const actor = nativeIdentity(live).actorScope;
    policy.allow({ chatId: live.chatId, actorId: actor, toolName: "designer_propose_schematic_deletions", maxRisk: "destructive", proposalKind: "designer_schematic_deletions",
      scopeKey: live.scopeKey, payloadFingerprint: nativeIdentity(live).argumentFingerprint, revision: live.revisionAtCreate ?? null });
    expect(policy.list(live.chatId)).toHaveLength(1);
    await disconnect(first);
    expect(policy.list(live.chatId)).toHaveLength(0);
    expect(actors.canApprove(live)).toBe(false);
    expect((await call(first, "designer_get_design_summary")).response.status).toBe(404);
    expect((await call(second, "designer_get_design_summary")).isError).not.toBe(true);
  });

  test("explicit broad consent covers future action/revision only in live actor session; disconnect removes it", async () => {
    const session = await initialize();
    await call(session, "designer_use_design", { designId });
    await call(session, "designer_place_components", placement("consent", 2));
    const deletion = { action_id: `delete_first_${designId}`, title: "Delete C1", summary: "Remove C1",
      entities: [{ entityId: "C1", entityKind: "part" }] };
    const first = await call(session, "designer_propose_schematic_deletions", deletion);
    const proposal = (await store.proposals.get(String(first.data.proposalId)))!;
    const grant = allowNativeSession({ store, policy, authorize: (item) => actors.canApprove(item) }, proposal);
    expect(grant.actorId).toBeUndefined();
    expect(grant.scopeKey).toBe(proposal.scopeKey);
    await proposals.approve({ proposalId: proposal.id, actor: "user", decidedBy: "desktop" });
    await proposals.apply({ proposalId: proposal.id, operationId: `native:${proposal.id}` });
    const next = await call(session, "designer_propose_schematic_deletions", { ...deletion,
      action_id: `delete_second_${designId}`, entities: [{ entityId: "C2", entityKind: "part" }] });
    expect(next.data).toMatchObject({ status: "ok", appliedCount: 1 });
    expect((await snapshot()).parts).toHaveLength(0);
    expect((await snapshot()).revision).toBe(4);
    await domain.designer.undo(designId, UI_SESSION);
    expect((await snapshot()).parts).toHaveLength(1);
    await disconnect(session);
    expect(policy.list(proposal.chatId)).toHaveLength(0);
    expect(new SessionWritePolicy().list(proposal.chatId)).toHaveLength(0);
    const other = await initialize();
    await call(other, "designer_use_design", { designId });
    const denied = await call(other, "designer_propose_schematic_deletions", { ...deletion,
      action_id: `delete_fresh_${designId}`, entities: [{ entityId: "C2", entityKind: "part" }] });
    expect(denied.data).toMatchObject({ status: "pending", appliedCount: 0 });
    expect((await snapshot()).parts).toHaveLength(1);
  });

  test("stale, changed action target and foreign actor fail; live flag revocation prevents mutation", async () => {
    const session = await initialize();
    await call(session, "designer_use_design", { designId });
    await call(session, "designer_place_components", placement("immutable", 1));
    const deletion = await call(session, "designer_propose_schematic_deletions", { action_id: `delete_stale_${designId}`, title: "Delete C1",
      summary: "Remove C1", entities: [{ entityId: "C1", entityKind: "part" }] });
    const proposalId = String(deletion.data.proposalId);
    await call(session, "designer_place_components", placement("next", 1));
    await proposals.approve({ proposalId, actor: "user", decidedBy: "desktop" });
    await expect(proposals.apply({ proposalId, operationId: `native:${proposalId}`, authorize: (item) => actors.canApprove(item) })).rejects.toThrow();
    expect((await snapshot()).parts).toHaveLength(2);
    const other = (await domain.designer.createDesign({ name: "Changed action target" })).id;
    const conflict = await call(session, "designer_place_components", { ...placement("immutable", 1), designId: other });
    expect(conflict.isError).toBe(true);
    expect(JSON.stringify(conflict.value)).toContain("OPERATION_IDENTITY_CONFLICT");
    expect((await snapshot(other)).parts).toHaveLength(0);
    const proposal = (await store.proposals.get(proposalId))!;
    const foreign = { ...proposal, envelope: { ...proposal.envelope, nativeIdentity: { ...nativeIdentity(proposal), actorScope: `mcp:${crypto.randomUUID()}` } } };
    expect(await applier.apply({ proposal: foreign, operationId: "foreign" })).toMatchObject({ status: "failed", appliedOps: 0 });
    settings.mcpAllowWrites = false;
    expect(actors.canApprove(proposal)).toBe(false);
    expect(await applier.apply({ proposal, operationId: "revoked" })).toMatchObject({ status: "failed", appliedOps: 0 });
    expect((await snapshot()).parts).toHaveLength(2);
  });

  test("read-only, wrong token and foreign origin rejected; disabled setting closes sessions", async () => {
    expect((await rpc("initialize", {}, undefined, { authorization: "Bearer wrong-token" })).response.status).toBe(401);
    expect((await rpc("initialize", {}, undefined, { origin: "https://evil.example" })).response.status).toBe(403);
    expect((await rpc("initialize", {}, undefined, { host: "evil.example" })).response.status).toBe(403);
    settings.mcpAllowWrites = false;
    const session = await initialize();
    const catalog = await rpc("tools/list", undefined, session);
    const entries = (catalog.value.result as { tools: Array<{ name: string }> }).tools;
    expect(entries.some((item) => item.name === "designer_place_components")).toBe(false);
    const denied = await call(session, "designer_place_components", { ...placement("readonly"), designId });
    expect(denied.isError ?? Boolean(denied.value.error)).toBe(true);
    expect((await snapshot()).parts).toHaveLength(0);
    settings.mcpEnabled = false;
    expect((await rpc("tools/list", undefined, session)).response.status).toBe(503);
    settings.mcpEnabled = true;
    expect((await rpc("tools/list", undefined, session)).response.status).toBe(404);
  });

  test("dispose failure stays visible, revokes grants and permits one clean handler retry", async () => {
    const create = McpFramework.createMcpServerHandler;
    let failing = false;
    const factory = spyOn(McpFramework, "createMcpServerHandler").mockImplementation((options) => {
      const handler = create(options);
      return { ...handler, async dispose() {
        if (failing) throw new Error("dispose-fault");
        await handler.dispose();
      } };
    });
    try {
      const session = await initialize();
      await call(session, "designer_use_design", { designId });
      await call(session, "designer_place_components", placement("dispose", 1));
      const deletion = await call(session, "designer_propose_schematic_deletions", { action_id: `delete_dispose_${designId}`,
        title: "Delete C1", summary: "Remove C1", entities: [{ entityId: "C1", entityKind: "part" }] });
      const proposal = (await store.proposals.get(String(deletion.data.proposalId)))!;
      allowNativeSession({ store, policy, authorize: (item) => actors.canApprove(item) }, proposal);
      expect(policy.list(proposal.chatId)).toHaveLength(1);
      failing = true;
      settings.mcpAllowWrites = false;
      await expect(endpoint.fetch(new Request(url))).rejects.toThrow("dispose-fault");
      expect(actors.canApprove(proposal)).toBe(false);
      expect(policy.list(proposal.chatId)).toHaveLength(0);
      expect(factory).toHaveBeenCalledTimes(1);
      failing = false;
      const fresh = await initialize();
      expect(factory).toHaveBeenCalledTimes(2);
      expect((await rpc("tools/list", undefined, session)).response.status).toBe(404);
      await rpc("tools/list", undefined, fresh);
      expect(actors.sessions()).toHaveLength(1);
      failing = true;
      await expect(endpoint.close()).rejects.toThrow("dispose-fault");
      expect(actors.sessions()).toHaveLength(0);
    } finally { failing = false; factory.mockRestore(); }
  });

  test("concurrent close during disposal cannot rebuild or retain a second handler", async () => {
    const create = McpFramework.createMcpServerHandler;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const disposing = new Promise<void>((resolve) => { entered = resolve; });
    let delayed = false;
    const factory = spyOn(McpFramework, "createMcpServerHandler").mockImplementation((options) => {
      const handler = create(options);
      return { ...handler, async dispose() {
        if (delayed) { entered(); await gate; }
        await handler.dispose();
      } };
    });
    try {
      await initialize();
      delayed = true;
      settings.mcpAllowWrites = false;
      const rotating = endpoint.fetch(new Request(url));
      await disposing;
      const closing = endpoint.close();
      release();
      expect((await rotating).status).toBe(503);
      await closing;
      expect(factory).toHaveBeenCalledTimes(1);
      expect(actors.sessions()).toHaveLength(0);
    } finally { release(); factory.mockRestore(); }
  });
});
