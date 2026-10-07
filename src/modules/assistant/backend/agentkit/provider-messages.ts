import type { AiChatMessage, AiProviderConfig } from "agentkit/contracts";
import type { AiChatRequest, AiProviderClient } from "agentkit/core";
import { awaitProviderSnapshot } from "./await-snapshot";

export type ProviderMessageTransform = (request: AiChatRequest) => Promise<AiChatMessage[]>;

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
        const messages = await awaitProviderSnapshot(() => transform(request), request.signal,
          "Provider message preparation timed out");
        request.signal?.throwIfAborted();
        yield* client.streamChat({ ...request, messages });
      },
    };
  };
}
