import { describe, expect, test } from "bun:test";
import type { AiChatRequest, AiProviderClient } from "agentkit/core";
import type { AiRunEvent } from "agentkit/contracts";
import { providerFactoryWithMessages } from "./provider-messages";

function client(events: Array<AiRunEvent["type"]>): AiProviderClient {
  return {
    id: "fake",
    kind: "openai-compatible",
    capabilities: async () => ({ streaming: true, toolCalling: true, modelList: false }),
    listModels: async () => [],
    async *streamChat(request: AiChatRequest) {
      for (const [seq, type] of events.entries()) {
        const data = type === "run.message.completed"
          ? { content: "ok", toolCallCount: 0, toolCalls: [], finishReason: "stop" }
          : { provider: "fake", model: "m" };
        yield { contractVersion: "0.6.0", eventId: `e${seq}`, seq, type, runId: request.runId,
          timestamp: "2026-10-15T00:00:00.000Z", data } as AiRunEvent;
      }
    },
  };
}

async function types(events: Array<AiRunEvent["type"]>): Promise<string[]> {
  const factory = providerFactoryWithMessages(() => client(events), async () => ({
    messages: [], warnings: [{ code: "mention_images_omitted", message: "1 image omitted" }],
  }));
  const seen: string[] = [];
  const request = { runId: "run", model: "m", messages: [] } as unknown as AiChatRequest;
  for await (const event of factory({} as never).streamChat(request)) seen.push(event.type);
  return seen;
}

describe("provider message warnings", () => {
  test("wait for the provider's first activity so the first-byte budget is not shortened", async () => {
    expect(await types(["run.started", "run.message.completed"]))
      .toEqual(["run.started", "run.message.completed", "run.warning"]);
  });

  test("still reach the run log when the provider produced no activity", async () => {
    expect(await types(["run.started"])).toEqual(["run.started", "run.warning"]);
  });
});
