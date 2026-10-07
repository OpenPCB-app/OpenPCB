import { createHash } from "node:crypto";
import { AgentKitHostError, type AssistantStore, type RegenerateMessageInput,
  type SubmitMessageInput, type TaskRecord } from "agentkit/host";

export const SUBMISSION_FINGERPRINT_KEY = "__openpcbSubmissionFingerprint";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** Hash caller intent before resolving defaults; retries cannot silently change it. */
export function submissionFingerprint(
  input: SubmitMessageInput | RegenerateMessageInput, regenerate: boolean,
): string {
  const { taskId: _taskId, ...intent } = input;
  return createHash("sha256").update(JSON.stringify(canonical({ regenerate, ...intent }))).digest("hex");
}

export async function assertReplayMatches(
  store: AssistantStore, task: TaskRecord, fingerprint: string, regenerate: boolean,
): Promise<void> {
  const messageId = task.payload[regenerate ? "assistantMessageId" : "userMessageId"];
  const message = typeof messageId === "string" ? await store.conversations.getMessage(messageId) : null;
  if (message?.metadata[SUBMISSION_FINGERPRINT_KEY] !== fingerprint) {
    throw new AgentKitHostError("idempotency_key_mismatch", "Idempotency key belongs to a different request");
  }
}
