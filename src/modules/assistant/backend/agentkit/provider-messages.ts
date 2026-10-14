import type { AiChatMessage, AiProviderConfig } from "agentkit/contracts";
import { createEventStamper, type AiChatRequest, type AiProviderClient } from "agentkit/core";
import { awaitProviderSnapshot } from "./await-snapshot";

export interface ProviderMessageContext {
  messages: AiChatMessage[];
  /** Surfaced as durable `run.warning` events so the user sees what the model was not given. */
  warnings: Array<{ code: string; message: string }>;
}

export type ProviderMessageTransform = (request: AiChatRequest) => Promise<ProviderMessageContext>;

/** App prompt/mention adaptation cannot replace pinned model or transport credentials. */
export function providerFactoryWithMessages(
  factory: (config: AiProviderConfig) => AiProviderClient, transform?: ProviderMessageTransform,
): (config: AiProviderConfig) => AiProviderClient {
  if (!transform) return factory;
  return (config) => {
    const client = factory(config);
    return {
      id: client.id,
      kind: client.kind,
      tracksTransportRequests: client.tracksTransportRequests,
      capabilities: (signal, model) => client.capabilities(signal, model),
      listModels: (signal) => client.listModels(signal),
      async *streamChat(request) {
        const context = await awaitProviderSnapshot(() => transform(request), request.signal,
          "Provider message preparation timed out");
        request.signal?.throwIfAborted();
        const stamp = createEventStamper();
        let pending = context.warnings;
        const flush = () => {
          const events = pending.map((warning) =>
            stamp({ type: "run.warning", runId: request.runId, timestamp: new Date().toISOString(), data: warning }));
          pending = [];
          return events;
        };
        for await (const event of client.streamChat({ ...request, messages: context.messages })) {
          yield event;
          // Any non-start event counts as provider activity and swaps the first-byte budget for the
          // shorter idle budget, so app warnings wait until the provider has actually answered.
          if (event.type !== "run.started") yield* flush();
        }
        yield* flush();
      },
    };
  };
}
