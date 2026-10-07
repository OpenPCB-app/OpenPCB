import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isolatedHttpDomain, submit, UI_SESSION, waitUntil, type HttpDomain } from "../agentkit-http-domain";
import { boundChat, proposalRequest } from "../agentkit-http-scenarios";
import scenarios from "./scenarios.json";

function warningCode(event: object): unknown {
  if (!("type" in event) || event.type !== "run.warning" || !("data" in event)) return undefined;
  const data = event.data;
  return data && typeof data === "object" && "code" in data ? data.code : undefined;
}

let domain: HttpDomain | undefined;
afterEach(async () => { await domain?.close(); domain = undefined; });

test("canonical empty completion retries once and persists an honest empty-response warning", async () => {
  domain = await isolatedHttpDomain([{ content: "" }, { content: "" }]);
  const { chatId } = await boundChat(domain);
  const result = await submit(domain, chatId, "empty-turn", "Explain this circuit.");
  assert.equal(domain.provider.requests.length, 2);
  const events = await domain.service.host.store.tasks.listEvents(result.runId);
  assert.ok(events.some((event) => warningCode(event) === "empty_response"));
  assert.ok(events.length > 0);
  assert.ok(events.every((event) => "runId" in event && event.runId === result.runId));
  assert.notEqual(result.runId, chatId);
});

test("canonical empty retry can recover without a false empty-response warning", async () => {
  domain = await isolatedHttpDomain([{ content: "" }, { content: "Recovered answer." }]);
  const { chatId } = await boundChat(domain);
  const result = await submit(domain, chatId, "recover-empty", "Explain this circuit.");
  const events = await domain.service.host.store.tasks.listEvents(result.runId);
  assert.ok(!events.some((event) => warningCode(event) === "empty_response"));
  assert.equal((await domain.service.host.store.conversations.getMessage(result.assistantMessageId))?.content, "Recovered answer.");
});

test("canonical emulated tool prose warns without dispatching a native command", async () => {
  domain = await isolatedHttpDomain([{ content: '```json\n{"name":"designer_place_components","arguments":{"components":[]}}\n```' }]);
  const { chatId, designId } = await boundChat(domain);
  const result = await submit(domain, chatId, "emulated-tool");
  const events = await domain.service.host.store.tasks.listEvents(result.runId);
  assert.ok(events.some((event) => warningCode(event) === "emulated_tool_call"));
  assert.equal((await domain.designer.getSchematicProjection(designId))?.revision, 0);
});

test("place, move, wire, value update and Undo retain actual IDs and connectivity", async () => {
  const calls = ["place", "move", "wire", "update"].map((name) => structuredClone(scenarios[name as keyof typeof scenarios]));
  domain = await isolatedHttpDomain(calls.flatMap((call, index) => [
    { calls: [call], newRun: index > 0 }, { content: "Done." },
  ]));
  const { chatId, designId } = await boundChat(domain);
  for (const call of calls) call.arguments = JSON.parse(JSON.stringify(call.arguments)
    .replaceAll("$componentId", domain.componentId).replaceAll("$designId", designId));
  await submit(domain, chatId, "place");
  const placed = (await domain.designer.getSchematicProjection(designId))!;
  assert.equal(placed.revision, 2);
  const ids = placed.parts.map((part) => part.id).sort();
  await submit(domain, chatId, "move");
  const moved = (await domain.designer.getSchematicProjection(designId))!;
  assert.equal(moved.revision, 3);
  assert.deepEqual(moved.parts.find((part) => part.reference === "C1")?.positionNm, { x: 30_000_000, y: 10_000_000 });
  await submit(domain, chatId, "wire");
  const wired = (await domain.designer.getSchematicProjection(designId))!;
  assert.equal(wired.revision, 5);
  const pins = wired.parts.map((part) => part.pins.find((pin) => pin.number === "1")!.id);
  assert.ok(wired.nets.some((net) => pins.every((id) => net.pinIds.includes(id))));
  await submit(domain, chatId, "update");
  const updated = (await domain.designer.getSchematicProjection(designId))!;
  assert.equal(updated.revision, 6);
  assert.deepEqual(updated.parts.map((part) => part.id).sort(), ids);
  assert.equal(updated.parts.find((part) => part.reference === "C1")?.value, "22nF");
  assert.equal((await domain.designer.undo(designId, UI_SESSION)).ok, true);
  const undone = (await domain.designer.getSchematicProjection(designId))!;
  assert.equal(undone.revision, 7);
  assert.equal(undone.parts.find((part) => part.reference === "C1")?.value, wired.parts.find((part) => part.reference === "C1")?.value);
  assert.deepEqual(undone.wires, wired.wires);
  assert.equal((await domain.designer.redo(designId, UI_SESSION)).ok, true);
  assert.deepEqual((await domain.designer.getSchematicProjection(designId))?.parts.map((part) => part.id).sort(), ids);
});

test("repeated provider tool IDs remain one domain action within a canonical run", async () => {
  const call = structuredClone(scenarios.place);
  domain = await isolatedHttpDomain([{ calls: [call] }, { calls: [call] }, { content: "Done." }]);
  const { chatId, designId } = await boundChat(domain);
  call.arguments = JSON.parse(JSON.stringify(call.arguments).replaceAll("$componentId", domain.componentId).replaceAll("$designId", designId));
  const result = await submit(domain, chatId, "duplicate-call");
  assert.equal((await domain.designer.getSchematicProjection(designId))?.revision, 2);
  assert.equal((await domain.service.host.store.proposals.listByChat(chatId)).length, 1);
  assert.equal(new Set(domain.provider.requests.map((request) => request.runId)).size, 1);
  assert.ok((await domain.service.host.store.tasks.listEvents(result.runId)).some((event) => event.type === "run.tool.succeeded"));
});

test("unresolved placement waits for explicit approval before committing its valid subset", async () => {
  const call = structuredClone(scenarios.partial);
  domain = await isolatedHttpDomain([{ calls: [call] }, { content: "Review unresolved component." }]);
  const { chatId, designId } = await boundChat(domain);
  call.arguments = JSON.parse(JSON.stringify(call.arguments).replaceAll("$componentId", domain.componentId).replaceAll("$designId", designId));
  await submit(domain, chatId, "partial-placement");
  const proposal = (await domain.service.host.store.proposals.listByChat(chatId))[0]!;
  assert.equal(proposal.status, "pending");
  assert.equal((await domain.designer.getSchematicProjection(designId))?.revision, 0);
  assert.ok(JSON.stringify(proposal).includes("parity.missing-component"));
  assert.equal((await proposalRequest(domain, proposal.id, "approve", {})).status, 200);
  assert.equal((await proposalRequest(domain, proposal.id, "apply", { operationId: `native:${proposal.id}` })).status, 200);
  assert.equal((await domain.designer.getSchematicProjection(designId))?.parts.length, 1);
  assert.equal((await domain.designer.undo(designId, UI_SESSION)).ok, true);
});

test("terminal Stop reopens durable messages/events/domain state without starting inference", async () => {
  const call = structuredClone(scenarios.place);
  domain = await isolatedHttpDomain([{ calls: [call] }, { waitForStop: true }], false, { preserveDirectory: true });
  const { chatId, designId } = await boundChat(domain);
  call.arguments = JSON.parse(JSON.stringify(call.arguments).replaceAll("$componentId", domain.componentId).replaceAll("$designId", designId));
  const submitted = await domain.request(`/v1/chats/${chatId}/messages`, { method: "POST", headers: { "Idempotency-Key": "stop-reopen" }, body: JSON.stringify({ content: "Place, then wait." }) });
  const result = await submitted.json() as { runId: string };
  await waitUntil(() => domain!.provider.requests.length === 2);
  assert.equal((await domain.request(`/v1/runs/${result.runId}/cancel`, { method: "POST" })).status, 202);
  await waitUntil(async () => (await domain!.service.host.store.tasks.getTask(result.runId))?.status === "cancelled");
  const events = await domain.service.host.store.tasks.listEvents(result.runId);
  const boundary = events[Math.floor(events.length / 2)]!.seq;
  assert.deepEqual(await domain.service.host.store.tasks.listEvents(result.runId, { afterSeq: boundary }), events.filter((event) => event.seq > boundary));
  const messages = await domain.service.host.store.conversations.listMessages(chatId);
  const projection = await domain.designer.getSchematicProjection(designId);
  const directory = domain.directory;
  await domain.close();
  domain = await isolatedHttpDomain([], false, { existingDirectory: directory });
  assert.equal(domain.provider.requests.length, 0);
  assert.deepEqual(await domain.service.host.store.tasks.listEvents(result.runId), events);
  assert.deepEqual(await domain.service.host.store.conversations.listMessages(chatId), messages);
  assert.deepEqual(await domain.designer.getSchematicProjection(designId), projection);
  assert.equal((await domain.designer.undo(designId, UI_SESSION)).ok, true);
});
