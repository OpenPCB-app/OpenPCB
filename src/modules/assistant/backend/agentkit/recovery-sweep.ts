import type { Logger, TaskRunner } from "agentkit/host";

/** The runner only expires stale leases; the app owns scheduling and shutdown. */
export function startManualRecoverySweep(
  runner: TaskRunner, logger?: Logger, intervalMs = 10_000,
): { stop(): Promise<void> } {
  let pending: Promise<void> | undefined;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped || pending) return;
    pending = runner.recover().catch(() => {
      logger?.error("AgentKit manual recovery failed");
    }).finally(() => { pending = undefined; });
  }, intervalMs);
  timer.unref?.();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pending;
    },
  };
}
