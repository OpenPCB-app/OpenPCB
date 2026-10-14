import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  isolatedHttpDomain,
  submit,
  type HttpDomain,
} from "./agentkit-http-domain";
import { boundChat } from "./agentkit-http-scenarios";
import scenarios from "./assistant-parity/scenarios.json";

let domain: HttpDomain | undefined;
afterEach(async () => {
  await domain?.close();
  domain = undefined;
});

type Call = (typeof scenarios)[keyof typeof scenarios];

function bind(call: Call, componentId: string, designId: string): Call {
  return JSON.parse(
    JSON.stringify(call)
      .replaceAll("$componentId", componentId)
      .replaceAll("$designId", designId),
  ) as Call;
}

interface ModelOutcome {
  status: string;
  designId?: string;
  results?: Array<{ ok: boolean; revision?: number; createdEntityId?: string | null }>;
}

function toolOutcome(current: HttpDomain, runId: string, callId: string): ModelOutcome {
  const message = current.provider.requests
    .filter((request) => request.runId === runId)
    .flatMap((request) => request.messages)
    .find((item) => item.role === "tool" && item.toolCallId === callId);
  assert.ok(message && typeof message.content === "string", `tool result ${callId}`);
  const envelope = JSON.parse(message.content) as { data?: ModelOutcome } & ModelOutcome;
  return envelope.data ?? envelope;
}

async function verification(current: HttpDomain, runId: string): Promise<string> {
  const event = (await current.service.host.store.tasks.listEvents(runId))
    .filter((item) => item.type === "run.verification")
    .at(-1);
  return JSON.stringify(event);
}

test("move, wire and update through the real host return domain IDs and verify", async () => {
  const place = structuredClone(scenarios.place);
  const move = structuredClone(scenarios.move);
  const wire = structuredClone(scenarios.wire);
  const update = structuredClone(scenarios.update);
  domain = await isolatedHttpDomain([
    { calls: [place], newRun: true },
    { content: "Placed" },
    { calls: [move], newRun: true },
    { calls: [wire] },
    { calls: [update] },
    { content: "Moved, wired and updated" },
  ]);
  const { chatId, designId } = await boundChat(domain);
  for (const call of [place, move, wire, update])
    Object.assign(call, bind(call, domain.componentId, designId));
  await submit(domain, chatId, "place");
  const placed = (await domain.designer.getSchematicProjection(designId))!;
  const run = await submit(domain, chatId, "edit");
  const edited = (await domain.designer.getSchematicProjection(designId))!;

  assert.deepEqual(edited.parts.map((part) => part.id).sort(), placed.parts.map((part) => part.id).sort());
  // Wiring auto-arranges the sheet, so the move is asserted on its own receipt below.
  assert.equal(edited.parts.find((part) => part.reference === "C1")!.value, "22nF");
  const pins = edited.parts.map((part) => part.pins.find((pin) => pin.number === "1")!.id);
  assert.ok(edited.nets.some((net) => pins.every((id) => net.pinIds.includes(id))));

  const moved = toolOutcome(domain, run.runId, move.id);
  const wired = toolOutcome(domain, run.runId, wire.id);
  const updated = toolOutcome(domain, run.runId, update.id);
  for (const outcome of [moved, wired, updated]) {
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.designId, designId);
    assert.ok(outcome.results?.length && outcome.results.every((item) => item.ok));
  }
  assert.ok(moved.results!.every((item) => item.revision! > placed.revision));
  const wireIds = wired.results!.map((item) => item.createdEntityId).filter(Boolean);
  assert.ok(wireIds.length > 0);
  for (const id of wireIds) assert.ok(edited.wires.some((item) => item.id === id), String(id));
  assert.equal(updated.results!.at(-1)!.revision, edited.revision);
  assert.ok((await verification(domain, run.runId)).includes('"status":"pass"'));
});

test("explain answers through read tools without proposals or design changes", async () => {
  const place = structuredClone(scenarios.place);
  const inspect = structuredClone(scenarios.inspect);
  domain = await isolatedHttpDomain([
    { calls: [place], newRun: true },
    { content: "Placed" },
    { calls: [inspect], newRun: true },
    { content: "C1 and C2 are unconnected capacitors." },
  ]);
  const { chatId, designId } = await boundChat(domain);
  Object.assign(place, bind(place, domain.componentId, designId));
  await submit(domain, chatId, "place");
  const before = await domain.designer.getSchematicProjection(designId);
  const proposals = (await domain.service.host.store.proposals.listByChat(chatId)).length;
  const run = await submit(domain, chatId, "explain", "Explain this circuit.");
  assert.deepEqual(await domain.designer.getSchematicProjection(designId), before);
  assert.equal((await domain.service.host.store.proposals.listByChat(chatId)).length, proposals);
  const inspected = domain.provider.requests
    .filter((request) => request.runId === run.runId)
    .flatMap((request) => request.messages)
    .find((item) => item.role === "tool" && item.toolCallId === inspect.id);
  assert.ok(typeof inspected?.content === "string" && inspected.content.includes("C2"));
  assert.equal(
    (await domain.service.host.store.conversations.getMessage(run.assistantMessageId))?.content,
    "C1 and C2 are unconnected capacitors.",
  );
});
