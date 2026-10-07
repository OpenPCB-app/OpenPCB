import type { AiRunEvent, AiRunMessageDeltaEvent } from "agentkit/contracts";
import { createEventStamper, type AiProviderClient } from "agentkit/core";

const REDACTED = "[REDACTED]";

function credentialRedactor(secret: string) {
  const representations = [...new Set([secret, encodeURIComponent(secret)])].filter(Boolean);
  let pending = "";
  const redact = (text: string): string => representations.reduce(
    (value, representation) => value.split(representation).join(REDACTED), text);
  return {
    sanitize<T>(value: T): T {
      return JSON.parse(JSON.stringify(value,
        (_key, entry: unknown) => typeof entry === "string" ? redact(entry) : entry)) as T;
    },
    error(error: unknown): Error {
      return new Error(redact(error instanceof Error ? error.message : "Provider request failed"));
    },
    push(chunk: string): string {
      const text = pending + chunk;
      pending = "";
      let output = "";
      for (let index = 0; index < text.length;) {
        const match = representations.find((value) => text.startsWith(value, index));
        if (match) { output += REDACTED; index += match.length; continue; }
        const remaining = text.length - index;
        if (representations.some((value) => remaining < value.length && value.startsWith(text.slice(index)))) {
          pending = text.slice(index);
          break;
        }
        output += text[index++];
      }
      return output;
    },
    finish(): string { const tail = pending; pending = ""; return tail; },
    discard(): void { pending = ""; },
  };
}

type CredentialRedactor = ReturnType<typeof credentialRedactor>;

/** Only a possible credential prefix waits; its size is bounded by the credential length. */
async function* redactStream(
  source: AsyncIterable<AiRunEvent>, redactor: CredentialRedactor,
): AsyncIterable<AiRunEvent> {
  const stamp = createEventStamper();
  let lastDelta: AiRunMessageDeltaEvent | undefined;
  try {
    for await (const event of source) {
      if (event.type === "run.message.delta") {
        lastDelta = event;
        yield stamp(redactor.sanitize({ ...event, data: { delta: redactor.push(event.data.delta) } }));
        continue;
      }
      if (event.type === "run.failed" || event.type === "run.cancelled") redactor.discard();
      if (event.type === "run.message.completed" || event.type === "run.completed") {
        const tail = redactor.finish();
        if (tail && lastDelta) yield stamp(redactor.sanitize({ ...lastDelta, data: { delta: tail } }));
        lastDelta = undefined;
      }
      yield stamp(redactor.sanitize(event));
    }
    const tail = redactor.finish();
    if (tail && lastDelta) yield stamp(redactor.sanitize({ ...lastDelta, data: { delta: tail } }));
  } catch (error) {
    throw redactor.error(error);
  } finally {
    // Cancellation or an exceptional end must not release an unverified prefix.
    redactor.discard();
  }
}

/** Provider authorization echoes must be removed before events reach durable storage. */
export function redactCredentialClient(client: AiProviderClient, secret: string): AiProviderClient {
  const redactor = credentialRedactor(secret);
  return {
    id: client.id,
    kind: client.kind,
    tracksTransportRequests: client.tracksTransportRequests,
    async capabilities(signal, model) {
      try { return redactor.sanitize(await client.capabilities(signal, model)); }
      catch (error) { throw redactor.error(error); }
    },
    async listModels(signal) {
      try { return redactor.sanitize(await client.listModels(signal)); }
      catch (error) { throw redactor.error(error); }
    },
    async *streamChat(input) {
      try { yield* redactStream(client.streamChat(input), credentialRedactor(secret)); }
      catch (error) { throw redactor.error(error); }
    },
  };
}
