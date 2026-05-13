import type { TaskStatus } from "../../../../sdks/tasks";

const terminal = new Set<TaskStatus>(["completed", "failed", "cancelled"]);

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["queued", "waiting", "cancelled"],
  queued: ["running", "cancelled"],
  waiting: ["queued", "cancelled"],
  running: ["streaming", "completed", "paused", "failed", "cancelled"],
  streaming: ["completed", "paused", "failed", "cancelled"],
  paused: ["queued", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isTerminalStatus(status: TaskStatus): boolean {
  return terminal.has(status);
}

export function assertValidTransition(from: TaskStatus, to: TaskStatus): void {
  if (from !== to && !transitions[from].includes(to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`);
  }
}
