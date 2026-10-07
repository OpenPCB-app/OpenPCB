import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SqliteAssistantStore } from "agentkit/adapters-sqlite";
import { ProposalService, SessionWritePolicy, defaultClock, defaultIds, type AssistantStore, type ProposalApplier } from "agentkit/host";
import type { AiTool, AiToolExecutionContext } from "agentkit/core";
import { isolatedDomain, UI_SESSION, type ParityDomain } from "../../../../core/backend/tests/fixtures/assistant-parity/domain";
import { ContextResolver } from "../context-resolver";
import { NativeContextStore } from "./native-context-store";
import { createNativeToolContributor } from "./native-tools";
import { createNativeProposalApplier } from "./native-applier";
import { commandRisk, argumentFingerprint, authorizeNativeProposal } from "./native-identity";
import { nativeScope } from "./native-stage";
import { createNativeVerification } from "./native-verification";
import { allowNativeSession } from "./native-session-grants";
import { registerNativeSessionGrantRoutes } from "./native-session-grants";
import { ModuleRouter } from "../../../../core/backend/router/module-router";
import { RouteParams } from "../../../../core/backend/router/route-params";

let domain: ParityDomain;
let store: SqliteAssistantStore;
let appContext: NativeContextStore;
let resolver: ContextResolver;
let applier: ProposalApplier;
let proposals: ProposalService;
let tools: AiTool[];
let chatId: string;
let designId: string;
let context: AiToolExecutionContext;

function pipeline(assistantStore: AssistantStore = store): { applier: ProposalApplier; proposals: ProposalService } {
  const nativeApplier = createNativeProposalApplier({ context: domain.ctx, store: assistantStore, actorScope: "desktop", contextResolver: resolver });
  return { applier: nativeApplier, proposals: new ProposalService({ store: assistantStore, applier: nativeApplier,
    policy: new SessionWritePolicy(), clock: defaultClock, ids: defaultIds }) };
}

beforeEach(async () => {
  domain = await isolatedDomain();
  store = new SqliteAssistantStore(`${domain.dbPath}.agentkit`);
  appContext = new NativeContextStore(domain.ctx);
  resolver = new ContextResolver(domain.ctx, appContext);
  ({ applier, proposals } = pipeline());
  const chat = await store.conversations.createChat({ title: "Native AgentKit" });
  chatId = chat.id;
  const design = await domain.designer.createDesign({ name: "Native adapter" });
  designId = design.id;
  await resolver.bindDesign(chatId, design);
  context = { runId: "native-run", chatId, bindings: appContext.listBindings(chatId),
    limits: { profile: "large", maxItems: 100, maxBytes: 100_000 } };
  tools = await createNativeToolContributor({ context: domain.ctx, store, proposals, actorScope: "desktop",
    contextResolver: resolver, contextStore: appContext }).contribute({ bindings: context.bindings, limits: context.limits });
});
afterEach(async () => { store?.close(); await domain?.close(); });

function tool(name: string): AiTool {
  const selected = tools.find((item) => item.definition.name === name);
  if (!selected) throw new Error(name);
  return selected;
}
function placeInput(quantity = 2): Record<string, unknown> {
  return { designId, action_id: `place_native_${designId}`, components: [{ componentId: domain.componentId, quantity }] };
}
async function projection() {
  const result = await domain.designer.getSchematicProjection(designId);
  if (!result) throw new Error("Projection missing");
  return result;
}

async function stageCommands(commands: Array<Record<string, unknown>>, expectedUnits = commands.length) {
  const id = crypto.randomUUID();
  const actionId = `test_${id}`;
  const revision = (await projection()).revision;
  const operations = commands.map((payload, index) => ({ id: `${id}:${index}`, payload }));
  const warnings: string[] = [];
  return proposals.stage({ id, chatId, runId: context.runId, scopeKey: nativeScope("desktop", designId, chatId), actionId,
    toolName: "designer_propose_schematic_edits", kind: "designer_schematic_edits", risk: commandRisk(operations), operations,
    revisionAtCreate: String(revision), envelope: { id, toolName: "designer_propose_schematic_edits", kind: "designer_schematic_edits",
      designId, baseRevision: revision, operations, warnings,
      nativeIdentity: { actorScope: "desktop", argumentFingerprint: argumentFingerprint(commands), expectedUnits } } });
}

async function approve(proposalId: string) {
  await proposals.approve({ proposalId, actor: "user", decidedBy: "desktop" });
}

async function sessionRoute(router: ModuleRouter, path: string, method = "GET", body?: unknown) {
  const req = new Request(`http://127.0.0.1${path}`, { method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
  const url = new URL(req.url);
  return router.dispatch({ req, url, query: url.searchParams, params: new RouteParams({}),
    requestId: crypto.randomUUID(), signal: req.signal, validated: {} });
}

describe("real native domain through AgentKit proposal pipeline", () => {
  test("15 exact native schemas; two placements, IDs, outcomes, undo/redo and immutable action replay", async () => {
    expect(tools.map((item) => item.definition)).toEqual(domain.registry.listDefinitions());
    expect(tools).toHaveLength(15);
    const beforeLegacy = domain.ctx.db.rawSql<{ total: number }>("SELECT COUNT(*) AS total FROM assistant_write_proposal")[0]!.total;
    const result = await tool("designer_place_components").execute(context, placeInput());
    expect(result.ok).toBe(true);
    const placed = await projection();
    expect(placed.parts).toHaveLength(2);
    expect(placed.revision).toBe(2);
    const ids = placed.parts.map((item) => item.id).sort();
    expect((result.modelData as { results: Array<{ createdEntityId: string }> }).results.map((item) => item.createdEntityId).sort()).toEqual(ids);
    const replay = await tool("designer_place_components").execute(context, placeInput());
    expect(replay.modelData).toMatchObject({ status: "already_applied", appliedCount: 2 });
    expect((replay.modelData as { results: Array<{ createdEntityId: string }> }).results.map((item) => item.createdEntityId).sort()).toEqual(ids);
    expect((await projection()).parts.map((item) => item.id).sort()).toEqual(ids);
    expect((await projection()).revision).toBe(2);
    const changed = await tool("designer_place_components").execute(context, placeInput(3));
    expect(changed.ok).toBe(false);
    expect(changed.warnings.join()).toContain("OPERATION_IDENTITY_CONFLICT");
    const other = await domain.designer.createDesign({ name: "Other" });
    const changedTarget = await tool("designer_place_components").execute(context, { ...placeInput(), designId: other.id });
    expect(changedTarget.warnings.join()).toContain("OPERATION_IDENTITY_CONFLICT");
    expect((await domain.designer.getSchematicProjection(other.id))?.parts).toHaveLength(0);
    expect((await domain.designer.undo(designId, UI_SESSION)).ok).toBe(true);
    expect((await projection()).parts).toHaveLength(1);
    expect((await domain.designer.redo(designId, UI_SESSION)).ok).toBe(true);
    expect((await projection()).parts.map((item) => item.id).sort()).toEqual(ids);
    expect(domain.ctx.db.rawSql<{ total: number }>("SELECT COUNT(*) AS total FROM assistant_write_proposal")[0]!.total).toBe(beforeLegacy);
    expect(domain.ctx.db.rawSql<{ total: number }>("SELECT COUNT(*) AS total FROM assistant_chat")[0]!.total).toBe(0);
  });

  test("two desktop chats reuse action on same design independently; recovery resolves proposal identity", async () => {
    const input = placeInput(1);
    const first = await tool("designer_place_components").execute(context, input);
    const secondChat = await store.conversations.createChat({ title: "Independent desktop chat" });
    await resolver.bindDesign(secondChat.id, { id: designId, name: "Native adapter" });
    const secondContext = { ...context, chatId: secondChat.id, bindings: appContext.listBindings(secondChat.id), runId: "second-chat-run" };
    const second = await tool("designer_place_components").execute(secondContext, input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.modelData).toMatchObject({ status: "ok", appliedCount: 1 });
    expect((await projection()).parts).toHaveLength(2);
    expect((await projection()).revision).toBe(2);
    const firstProposal = (await store.proposals.listByChat(chatId))[0]!;
    const secondProposal = (await store.proposals.listByChat(secondChat.id))[0]!;
    expect(firstProposal.actionId).toBe(secondProposal.actionId);
    expect(firstProposal.scopeKey).not.toBe(secondProposal.scopeKey);
    expect(firstProposal.id).not.toBe(secondProposal.id);
    expect(firstProposal.revisionAtCreate).toBe("0");
    expect(secondProposal.revisionAtCreate).toBe("1");
    expect(await applier.getOutcome(firstProposal.operationId!)).toEqual(await store.proposals.getOutcome(firstProposal.operationId!));
    expect(await applier.getOutcome(secondProposal.operationId!)).toEqual(await store.proposals.getOutcome(secondProposal.operationId!));
    expect((await tool("designer_place_components").execute(context, input)).modelData).toMatchObject({ status: "already_applied", appliedCount: 1 });
    expect((await tool("designer_place_components").execute(secondContext, input)).modelData).toMatchObject({ status: "already_applied", appliedCount: 1 });
    expect(await applier.currentRevision?.(`external:chat:${chatId}:design:${designId}`)).toBeNull();
    expect(await applier.currentRevision?.(`desktop:chat:missing-chat:design:${designId}`)).toBeNull();
  });

  test("destructive pending requires explicit approval; exact scoped allowance auto-applies", async () => {
    await tool("designer_place_components").execute(context, placeInput(1));
    const input = { designId, action_id: `delete_native_${designId}`, title: "Delete C1", summary: "Remove capacitor", entities: [{ entityId: "C1", entityKind: "part" }] };
    const staged = await tool("designer_propose_schematic_deletions").execute(context, input);
    expect(staged.modelData).toMatchObject({ status: "pending", appliedCount: 0 });
    expect((await projection()).parts).toHaveLength(1);
    const pending = (await store.proposals.listByChat(chatId)).find((item) => item.kind === "designer_schematic_deletions")!;
    expect(pending.risk).toBe("destructive");
    await approve(pending.id);
    const outcome = await proposals.apply({ proposalId: pending.id, operationId: `native:${pending.id}`,
      authorize: (item) => authorizeNativeProposal(item, "desktop") });
    expect(outcome.status).toBe("applied");
    expect((await projection()).parts).toHaveLength(0);
    expect(await proposals.apply({ proposalId: pending.id, operationId: `native:${pending.id}` })).toEqual(outcome);
    await domain.designer.undo(designId, UI_SESSION);
    expect((await projection()).parts).toHaveLength(1);
    const grantedInput = { ...input, action_id: `delete_granted_${designId}` };
    proposals.policy.allow({ chatId, toolName: "designer_propose_schematic_deletions", proposalKind: "designer_schematic_deletions",
      maxRisk: "destructive", actorId: "desktop", scopeKey: nativeScope("desktop", designId, chatId),
      payloadFingerprint: argumentFingerprint(grantedInput), revision: String((await projection()).revision) });
    const applied = await tool("designer_propose_schematic_deletions").execute(context, grantedInput);
    expect(applied.modelData).toMatchObject({ status: "ok", appliedCount: 1 });
    expect((await projection()).parts).toHaveLength(0);
  });

  test("unresolved placement waits for explicit partial approval", async () => {
    const input = { designId, action_id: `place_partial_${designId}`, components: [
      { componentId: domain.componentId, quantity: 1 }, { componentId: "missing-component", quantity: 1 },
    ] };
    const staged = await tool("designer_place_components").execute(context, input);
    expect(staged.modelData).toMatchObject({ status: "pending", appliedCount: 0 });
    expect((await projection()).parts).toHaveLength(0);
    const proposal = (await store.proposals.listByChat(chatId))[0]!;
    await approve(proposal.id);
    const outcome = await proposals.apply({ proposalId: proposal.id, operationId: `native:${proposal.id}` });
    expect(outcome).toMatchObject({ status: "partial", appliedOps: 1 });
    expect(outcome.failedOps).toHaveLength(1);
    expect((await projection()).parts).toHaveLength(1);
  });

  test("malformed placement action waits for explicit approval", async () => {
    const result = await tool("designer_place_components").execute(context, { ...placeInput(1), action_id: "malformed" });
    expect(result.modelData).toMatchObject({ status: "pending", appliedCount: 0 });
    expect((await projection()).parts).toHaveLength(0);
  });

  test("broad session consent cannot cross actor, chat, design or explicit rejection", async () => {
    await tool("designer_place_components").execute(context, placeInput(2));
    const input = { designId, action_id: `delete_session_${designId}`, title: "Delete C1", summary: "Remove C1",
      entities: [{ entityId: "C1", entityKind: "part" }] };
    await tool("designer_propose_schematic_deletions").execute(context, input);
    const proposal = (await store.proposals.listByChat(chatId)).find((item) => item.actionId === input.action_id)!;
    allowNativeSession({ store, policy: proposals.policy as SessionWritePolicy, authorize: (item) => authorizeNativeProposal(item, "desktop") }, proposal);
    await proposals.reject({ proposalId: proposal.id, decidedBy: "desktop" });
    expect((await tool("designer_propose_schematic_deletions").execute(context, input)).ok).toBe(false);
    const actorTools = await createNativeToolContributor({ context: domain.ctx, store, proposals, actorScope: "other-actor",
      contextResolver: resolver, contextStore: appContext }).contribute({ bindings: context.bindings, limits: context.limits });
    expect((await actorTools.find((item) => item.definition.name === "designer_propose_schematic_deletions")!.execute(context,
      { ...input, action_id: `delete_other_${designId}` })).modelData).toMatchObject({ status: "pending", appliedCount: 0 });
    const otherChat = await store.conversations.createChat({ title: "No shared consent" });
    await resolver.bindDesign(otherChat.id, { id: designId, name: "Native adapter" });
    expect((await tool("designer_propose_schematic_deletions").execute({ ...context, chatId: otherChat.id },
      { ...input, action_id: `delete_otherchat_${designId}` })).modelData).toMatchObject({ status: "pending", appliedCount: 0 });
    const otherDesign = (await domain.designer.createDesign({ name: "No shared design consent" })).id;
    appContext.deleteBinding(chatId, resolver.getPrimaryDesign(chatId)!.id);
    await resolver.bindDesign(chatId, { id: otherDesign, name: "No shared design consent" });
    const placed = await tool("designer_place_components").execute(context, { ...placeInput(1), designId: otherDesign, action_id: `place_other_${otherDesign}` });
    expect(placed.ok).toBe(true);
    expect((await tool("designer_propose_schematic_deletions").execute(context,
      { ...input, designId: otherDesign, action_id: `delete_otherdesign_${otherDesign}` })).modelData).toMatchObject({ status: "pending", appliedCount: 0 });
    expect((await projection()).parts).toHaveLength(2);
  });

  test("session grant routes reject authority fields; canonical auto_all alone cannot grant destructive writes", async () => {
    (proposals.policy as SessionWritePolicy).setMode("auto_all");
    await tool("designer_place_components").execute(context, placeInput(1));
    const input = { designId, action_id: `delete_allow_${designId}`, title: "Delete C1", summary: "Remove C1",
      entities: [{ entityId: "C1", entityKind: "part" }] };
    const pending = await tool("designer_propose_schematic_deletions").execute(context, input);
    expect(pending.modelData).toMatchObject({ status: "pending", appliedCount: 0 });
    const proposal = (await store.proposals.listByChat(chatId)).find((item) => item.actionId === input.action_id)!;
    const router = new ModuleRouter("assistant");
    let writable = true;
    registerNativeSessionGrantRoutes(router, { store, policy: proposals.policy as SessionWritePolicy,
      authorize: (item) => writable && authorizeNativeProposal(item, "desktop") });
    const path = `/v1/proposals/${proposal.id}/allow-session`;
    expect((await sessionRoute(router, path, "POST", { actorId: "other", scopeKey: "other", maxRisk: "destructive" })).status).toBe(400);
    expect(proposals.policy.list(chatId)).toHaveLength(0);
    writable = false;
    expect((await sessionRoute(router, path, "POST", {})).status).toBe(400);
    writable = true;
    const allowed = await sessionRoute(router, path, "POST", {});
    expect(allowed.status).toBe(201);
    const grant = await allowed.json() as { key: string; scopeKey: string };
    expect(grant.scopeKey).toBe(proposal.scopeKey);
    const listPath = `/v1/chats/${chatId}/native-write-allowances`;
    expect(await (await sessionRoute(router, listPath)).json()).toHaveLength(1);
    const otherChat = await store.conversations.createChat({ title: "Foreign revoke" });
    expect((await sessionRoute(router, `/v1/chats/${otherChat.id}/native-write-allowances/${encodeURIComponent(grant.key)}`, "DELETE")).status).toBe(404);
    expect(proposals.policy.list(chatId)).toHaveLength(1);
    expect((await sessionRoute(router, `${listPath}/${encodeURIComponent(grant.key)}`, "DELETE")).status).toBe(204);
    expect(proposals.policy.list(chatId)).toHaveLength(0);
  });

  test("rejected action stays rejected on repeat; changed arguments conflict", async () => {
    await tool("designer_place_components").execute(context, placeInput(1));
    const input = { designId, action_id: `delete_rejected_${designId}`, title: "Delete C1", summary: "Remove C1",
      entities: [{ entityId: "C1", entityKind: "part" }] };
    await tool("designer_propose_schematic_deletions").execute(context, input);
    const pending = (await store.proposals.listByChat(chatId)).find((item) => item.actionId === input.action_id)!;
    await proposals.reject({ proposalId: pending.id, decidedBy: "desktop" });
    const repeat = await tool("designer_propose_schematic_deletions").execute(context, input);
    expect(repeat.ok).toBe(false);
    expect(repeat.warnings.join()).toContain("rejected");
    expect((await store.proposals.listByChat(chatId)).filter((item) => item.actionId === input.action_id)).toHaveLength(1);
    const conflict = await tool("designer_propose_schematic_deletions").execute(context, { ...input, summary: "Changed" });
    expect(conflict.warnings.join()).toContain("OPERATION_IDENTITY_CONFLICT");
    expect((await projection()).parts).toHaveLength(1);
  });

  test("approved stale proposal and operation-key identity reuse cannot mutate", async () => {
    const proposal = await stageCommands([{ type: "place_gnd_port", positionNm: { x: 0, y: 0 }, rotationDeg: 0 }]);
    await approve(proposal.id);
    await tool("designer_place_components").execute(context, placeInput(1));
    await expect(proposals.apply({ proposalId: proposal.id, operationId: `native:${proposal.id}` })).rejects.toThrow();
    expect((await projection()).primitives).toHaveLength(0);
    const applied = (await store.proposals.listByChat(chatId)).find((item) => item.kind === "designer_place_components")!;
    const other = await stageCommands([{ type: "place_gnd_port", positionNm: { x: 0, y: 0 }, rotationDeg: 0 }]);
    expect(await applier.apply({ proposal: other, operationId: applied.operationId! })).toMatchObject({ status: "failed", appliedOps: 0 });
    expect((await projection()).primitives).toHaveLength(0);
  });

  test("all failed domain receipts never invent revision zero", async () => {
    await tool("designer_place_components").execute(context, placeInput(1));
    const proposal = await stageCommands([{ type: "create_wire", sourcePinId: "missing-source", targetPinId: "missing-target" }]);
    await approve(proposal.id);
    const outcome = await proposals.apply({ proposalId: proposal.id, operationId: `native:${proposal.id}` });
    expect(outcome).toMatchObject({ status: "failed", appliedOps: 0 });
    expect(outcome.revision).toBeUndefined();
    expect((await projection()).revision).toBe(1);
    expect(await applier.getOutcome(`native:${proposal.id}`)).toEqual(outcome);
  });

  test("real follow-up failure remains partial and replay reports original IDs and failure", async () => {
    const proposal = await stageCommands([{ type: "place_gnd_port", positionNm: { x: 0, y: 0 }, rotationDeg: 0 }], 2);
    const operation = (proposal.envelope.operations as Array<Record<string, unknown>>)[0]!;
    operation.linkWireToCreatedPrimitive = { sourcePinId: "nonexistent-pin" };
    // Stage immutable payload with the follow-up present.
    await proposals.reject({ proposalId: proposal.id, decidedBy: "desktop" });
    const second = await proposals.stage({ ...proposal, id: crypto.randomUUID(), envelope: { ...proposal.envelope, operations: [operation] } });
    await approve(second.id);
    const outcome = await proposals.apply({ proposalId: second.id, operationId: `native:${second.id}` });
    expect(outcome.status).toBe("partial");
    expect(outcome.appliedOps).toBe(1);
    expect(outcome.failedOps).toHaveLength(1);
    const reconstructed = await applier.getOutcome(`native:${second.id}`);
    expect(reconstructed).toEqual(outcome);
    expect(JSON.parse(outcome.resultJson!).receipts[0].result.createdEntityId).toBeTruthy();
    expect((await projection()).primitives).toHaveLength(1);
    const verifier = createNativeVerification({ context: domain.ctx, contextResolver: resolver, contextStore: appContext, store });
    const verification = await verifier.verify({ runId: context.runId, chatId, toolCallCount: 1, finalContent: "Everything is complete." });
    expect(verification?.status).toBe("partial");
    expect(verification?.checks.find((item) => item.id === "native_mutations")?.ok).toBe(false);
    expect(await proposals.apply({ proposalId: second.id, operationId: `native:${second.id}` })).toEqual(outcome);
    expect((await projection()).primitives).toHaveLength(1);
  });

  test("cancel after first committed unit prevents all later units; replay remains partial", async () => {
    const controller = new AbortController();
    const original = domain.designer.dispatchOperation.bind(domain.designer);
    domain.designer.dispatchOperation = async (...args) => {
      const result = await original(...args); controller.abort(); return result;
    };
    const result = await tool("designer_place_components").execute({ ...context, signal: controller.signal }, placeInput());
    expect(result.ok).toBe(false);
    expect(result.modelData).toMatchObject({ status: "partial", appliedCount: 1 });
    expect((await projection()).parts).toHaveLength(1);
    expect((await projection()).revision).toBe(1);
    const replay = await tool("designer_place_components").execute(context, placeInput());
    expect(replay.ok).toBe(false);
    expect(replay.modelData).toMatchObject({ status: "partial", appliedCount: 1 });
    expect((await projection()).revision).toBe(1);
  });

  test("boot reconciliation proves committed units without executing interrupted tail", async () => {
    const proposal = await stageCommands([
      { type: "place_gnd_port", positionNm: { x: 0, y: 0 }, rotationDeg: 0 },
      { type: "place_gnd_port", positionNm: { x: 4_000_000, y: 0 }, rotationDeg: 0 },
    ]);
    await approve(proposal.id);
    const claimed = await store.proposals.transition(proposal.id, ["approved"], "applying", { operationId: `native:${proposal.id}`, claimedAt: defaultClock.nowIso() });
    const controller = new AbortController();
    const original = domain.designer.dispatchOperation.bind(domain.designer);
    domain.designer.dispatchOperation = async (...args) => { const result = await original(...args); controller.abort(); return result; };
    await applier.apply({ proposal: claimed, operationId: `native:${proposal.id}`, signal: controller.signal });
    store.close();
    store = new SqliteAssistantStore(`${domain.dbPath}.agentkit`);
    ({ applier, proposals } = pipeline());
    const before = await projection();
    expect(await proposals.reconcileInterrupted()).toEqual({ reconciled: 1, applied: 1, failed: 0 });
    const recovered = await store.proposals.getOutcome(`native:${proposal.id}`);
    expect(recovered).toMatchObject({ status: "partial", appliedOps: 1 });
    expect(await projection()).toEqual(before);
    expect((await projection()).primitives).toHaveLength(1);
  });

  test("new design uses creation receipt and binds canonical chat without legacy records", async () => {
    const unboundChat = await store.conversations.createChat({ title: "Create" });
    const invocation = { ...context, chatId: unboundChat.id, bindings: [], runId: "create-run" };
    const created = await tool("designer_create_design").execute(invocation, { name: "Receipt design" });
    expect(created.ok).toBe(true);
    const binding = resolver.getPrimaryDesign(unboundChat.id)!;
    expect(binding.label).toBe("Receipt design");
    expect((await store.conversations.getChat(unboundChat.id))?.metadata).toMatchObject({ designId: binding.refId, designName: "Receipt design" });
    expect(created.modelData).toMatchObject({ designId: binding.refId, creations: [{ id: binding.refId, name: "Receipt design", revision: 0 }] });
    const proposal = (await store.proposals.listByChat(unboundChat.id))[0]!;
    const recovered = await applier.getOutcome(proposal.operationId!);
    expect(recovered).toMatchObject({ status: "applied", appliedOps: 1 });
    expect((await domain.designer.listDesigns()).filter((item) => item.id === binding.refId)).toHaveLength(1);
    const repeated = await tool("designer_create_design").execute(invocation, { name: "Receipt design" });
    expect(repeated.modelData).toMatchObject({ status: "already_applied", appliedCount: 1 });
    expect(repeated.data).toEqual(created.data);
    expect((await store.proposals.listByChat(unboundChat.id))).toHaveLength(1);
    expect((await domain.designer.listDesigns()).filter((item) => item.name === "Receipt design")).toHaveLength(1);
    const newRun = await tool("designer_create_design").execute({ ...invocation, runId: "new-submission" }, { name: "Receipt design" });
    expect(newRun.ok).toBe(false);
    expect(newRun.warnings.join()).toContain("already bound");
  });

  test("read-only, foreign actor, unknown operation and nested PCB deletion fail closed", async () => {
    const readOnly = await createNativeToolContributor({ context: domain.ctx, store, proposals,
      actorScope: "desktop", contextResolver: resolver, readOnly: true }).contribute({ bindings: [], limits: context.limits });
    expect((await readOnly.find((item) => item.definition.name === "designer_place_components")!.execute(context, placeInput())).ok).toBe(false);
    expect((await projection()).parts).toHaveLength(0);
    const proposal = await stageCommands([{ type: "place_gnd_port", positionNm: { x: 0, y: 0 }, rotationDeg: 0 }]);
    const foreign = { ...proposal, envelope: { ...proposal.envelope, nativeIdentity: {
      ...(proposal.envelope.nativeIdentity as Record<string, unknown>), actorScope: "external" } } };
    expect(await applier.apply({ proposal: foreign, operationId: "foreign" })).toMatchObject({ status: "failed", appliedOps: 0 });
    expect(commandRisk([{ type: "batch_commands", commands: [{ type: "pcb_delete_trace", traceId: "t" }] }])).toBe("destructive");
    const spoof = { type: "delete_entity", entityId: "C1", entityKind: "part", payload: { type: "place_part", componentId: "x" } };
    expect(commandRisk([{ payload: spoof }])).toBe("destructive");
    expect(commandRisk([{ payload: { type: "batch_commands", commands: [spoof],
      payload: { type: "place_part", componentId: "x" } } }])).toBe("destructive");
    expect(() => commandRisk([{ type: "unknown", payload: { type: "place_part", componentId: "x" } }])).toThrow("UNKNOWN_NATIVE_OPERATION");
    expect(() => commandRisk([{ type: "unknown" }])).toThrow("UNKNOWN_NATIVE_OPERATION");
  });

  test("existing DoD reads app build intent and real same-revision projection/ERC", async () => {
    const verification = createNativeVerification({ context: domain.ctx, contextResolver: resolver, contextStore: appContext, store });
    appContext.saveBuildIntent({ chatId, taskId: context.runId, goal: "Two capacitors",
      items: [{ role: "capacitor", componentId: domain.componentId, quantity: 2, requiredNets: [] }] });
    const report = await verification.verify({ runId: context.runId, chatId, toolCallCount: 1, finalContent: "done" });
    expect(report?.status).toBe("partial");
    expect(report?.checks.find((item) => item.id === "bom_placed")?.ok).toBe(false);
    await tool("designer_place_components").execute(context, placeInput());
    const after = await verification.verify({ runId: context.runId, chatId, toolCallCount: 1, finalContent: "done" });
    expect(after?.checks.find((item) => item.id === "bom_placed")?.ok).toBe(true);
    expect(after?.checks.slice(0, 4).map((item) => item.id)).toEqual(["bom_placed", "nets_wired", "no_dangling_power", "erc_clean"]);
  });
});
