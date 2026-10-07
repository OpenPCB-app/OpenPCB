import type { ExecutionBudgets } from "agentkit/core";

const SHARED = {
  overallMs: 600_000,
  providerRequests: 24,
  toolCalls: 64,
  correctionPasses: 3,
  toolMs: 60_000,
} as const;

export const REMOTE_EXECUTION_BUDGETS: Readonly<ExecutionBudgets> = Object.freeze({
  ...SHARED,
  firstByteMs: 60_000,
  streamIdleMs: 60_000,
});
export const LOCAL_EXECUTION_BUDGETS: Readonly<ExecutionBudgets> = Object.freeze({
  ...SHARED,
  firstByteMs: 180_000,
  streamIdleMs: 90_000,
});

export const LOCAL_TURN_KIND = "openpcb.local-chat-turn";

export function isLocalProvider(kind: string, baseUrl: string): boolean {
  if (kind === "lmstudio" || kind === "omlx") return true;
  if (kind !== "openai-compatible") return false;
  const hostname = new URL(baseUrl).hostname;
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}
