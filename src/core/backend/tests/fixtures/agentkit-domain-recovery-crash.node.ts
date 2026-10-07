import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { isolatedHttpDomain } from "./agentkit-http-domain";
import type { DomainRecoveryCheckpoint } from "./agentkit-domain-recovery-checkpoint";

const checkpointPath = process.env.OPENPCB_NATIVE_CRASH_CHECKPOINT;
if (!checkpointPath) throw new Error("Missing native crash checkpoint path");
const call = {
  id: "crash-place", name: "designer_place_components",
  arguments: { action_id: "crash-place-action", components: [] as Array<{ componentId: string; quantity: number }> },
};
const domain = await isolatedHttpDomain([{ calls: [call] }, { content: "Placed." }], false, { preserveDirectory: true });
writeFileSync(checkpointPath, JSON.stringify({ directory: domain.directory }));
call.arguments.components.push({ componentId: domain.componentId, quantity: 1 });
const design = await domain.designer.createDesign({ name: "Crash recovery" });
call.arguments.action_id = `place_crash_${design.id}`;
assert.equal((await domain.request("/v1/chats", {}, null)).status, 401);
const chatResponse = await domain.request("/v1/chats", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Crash native write" }),
});
assert.equal(chatResponse.status, 201);
const chat = await chatResponse.json() as { id: string };
const binding = await domain.request(`/v1/chats/${chat.id}/context-bindings`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ designId: design.id }),
});
assert.equal(binding.status, 201);

const dispatch = domain.designer.dispatchOperation.bind(domain.designer);
domain.designer.dispatchOperation = async (designId, envelope, identity, capture) => {
  const result = await dispatch(designId, envelope, identity, capture);
  if (!result.ok) throw new Error(result.code);
  assert.equal(result.ok, true);
  const proposals = await domain.service.host.store.proposals.listByChat(chat.id);
  const proposal = proposals.find((item) => item.operationId === identity.operationId);
  assert.ok(proposal);
  const outcomeBeforeExit = await domain.service.host.store.proposals.getOutcome(identity.operationId);
  assert.equal(proposal.status, "applying");
  assert.equal(outcomeBeforeExit, null);
  const checkpoint: DomainRecoveryCheckpoint = {
    directory: domain.directory, designId, chatId: chat.id,
    runId: proposal.runId!, proposalId: proposal.id, operationId: identity.operationId,
    envelope, identity, result, modelRequests: domain.provider.requests.length,
    proposalStatusBeforeExit: proposal.status, outcomeBeforeExit,
  };
  writeFileSync(checkpointPath, JSON.stringify(checkpoint));
  process.exit(73);
};

const submitted = await domain.request(`/v1/chats/${chat.id}/messages`, {
  method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "native-crash-turn" },
  body: JSON.stringify({ content: "Place one capacitor on this design." }),
});
assert.equal(submitted.status, 201);
await new Promise<void>((_resolve, reject) => {
  setTimeout(() => reject(new Error("Native domain crash hook did not run within 5000 ms")), 5000);
});
