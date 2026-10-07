import assert from "node:assert/strict";
import { test } from "node:test";
import type { AiRunEvent, AiRunEventDraft } from "agentkit/core";
import { createEventStamper, type AiChatRequest, type AiProviderClient } from "agentkit/core";
import { redactCredentialClient } from "./redaction";

const SECRET = "provider-canary+/=é";
const request: AiChatRequest = { runId: "redaction-test", model: "fixture", messages: [] };
const base = { runId: request.runId, timestamp: "2026-10-07T00:00:00.000Z" };

function fixture(chunks: string[], ending: "success" | "failed" | "cancelled" | "throw" | "end" = "success") {
  const stamp = createEventStamper();
  const client: AiProviderClient = {
    id: "fixture", kind: "openai-compatible", tracksTransportRequests: true,
    capabilities: async () => { throw new Error(`Authorization: ${SECRET}`); },
    listModels: async () => [{ providerId: "fixture", modelId: SECRET, displayName: SECRET, fetchedAt: base.timestamp }],
    async *streamChat(input) {
      assert.equal(input, request);
      await input.beforeRequest?.();
      yield stamp({ ...base, type: "run.started", data: { model: "fixture", toolCount: 0 } });
      for (const delta of chunks) yield stamp({ ...base, type: "run.message.delta", data: { delta } });
      if (ending === "throw") throw new Error(`Authorization: ${SECRET}`);
      if (ending === "end") return;
      const terminal: AiRunEventDraft = ending === "success"
        ? { ...base, type: "run.message.completed", data: { content: chunks.join(""), toolCallCount: 0 } }
        : ending === "failed"
          ? { ...base, type: "run.failed", data: { errorMessage: SECRET } }
          : { ...base, type: "run.cancelled", data: { reason: SECRET } };
      yield stamp(terminal);
    },
  };
  return redactCredentialClient(client, SECRET);
}

async function collect(client: AiProviderClient): Promise<AiRunEvent[]> {
  const events: AiRunEvent[] = [];
  for await (const event of client.streamChat(request)) events.push(event);
  assert.deepEqual(events.map((event) => event.seq), events.map((_event, index) => index));
  assert.equal(new Set(events.map((event) => event.eventId)).size, events.length);
  return events;
}

function deltas(events: AiRunEvent[]): string {
  return events.filter((event) => event.type === "run.message.delta")
    .map((event) => event.data.delta).join("");
}

test("all raw and URI credential split points redact before delta events leave the client", async () => {
  for (const representation of [SECRET, encodeURIComponent(SECRET)]) {
    for (let split = 1; split < representation.length; split++) {
      const events = await collect(fixture([`before ${representation.slice(0, split)}`, `${representation.slice(split)} after`]));
      assert.equal(deltas(events), "before [REDACTED] after");
      const completed = events.find((event) => event.type === "run.message.completed");
      assert.equal(completed?.data.content, "before [REDACTED] after");
      assert.equal(JSON.stringify(events).includes(representation), false);
    }
  }
});

test("one-character chunks, repeated keys and overlapping prefixes preserve non-secret text", async () => {
  const input = `x provider-${SECRET}${SECRET} provider-end y`;
  assert.equal(deltas(await collect(fixture([...input]))), "x provider-[REDACTED][REDACTED] provider-end y");
});

test("successful completion and clean exhaustion flush an innocent trailing prefix", async () => {
  for (const ending of ["success", "end"] as const) {
    assert.equal(deltas(await collect(fixture(["ordinary provider-ca"], ending))), "ordinary provider-ca");
  }
});

test("failure, cancellation and thrown errors discard an unverified trailing prefix", async () => {
  for (const ending of ["failed", "cancelled"] as const) {
    const events = await collect(fixture(["ordinary provider-ca"], ending));
    assert.equal(deltas(events), "ordinary ");
    assert.equal(JSON.stringify(events).includes(SECRET), false);
  }
  const received: AiRunEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of fixture(["ordinary provider-ca"], "throw").streamChat(request)) received.push(event);
  }, (error: Error) => error.message === "Authorization: [REDACTED]");
  assert.equal(deltas(received), "ordinary ");
});

test("credential redaction preserves dispatch budget hooks and sanitizes model lists and errors", async () => {
  let requests = 0;
  request.beforeRequest = async () => { requests++; };
  try {
    const client = fixture(["plain text"]);
    assert.equal(client.tracksTransportRequests, true);
    await collect(client);
    assert.equal(requests, 1);
    assert.deepEqual(await client.listModels(), [{ providerId: "fixture", modelId: "[REDACTED]", displayName: "[REDACTED]", fetchedAt: base.timestamp }]);
    await assert.rejects(client.capabilities(), (error: Error) => error.message === "Authorization: [REDACTED]");
  } finally { delete request.beforeRequest; }
});

test("a prefix stays buffered across non-content provider events", async () => {
  const client = fixture([]);
  const stamp = createEventStamper();
  client.streamChat = async function* () {
    yield stamp({ ...base, type: "run.message.delta", data: { delta: SECRET.slice(0, 8) } });
    yield stamp({ ...base, type: "run.warning", data: { code: "fixture", message: "interleaved" } });
    yield stamp({ ...base, type: "run.message.delta", data: { delta: SECRET.slice(8) } });
  };
  assert.equal(deltas(await collect(redactCredentialClient(client, SECRET))), "[REDACTED]");
});
