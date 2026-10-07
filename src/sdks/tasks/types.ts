import type { TaskRecord, TaskStatus } from "agentkit/host";

export type TaskRunSummary = Pick<TaskRecord,
  "taskId" | "kind" | "scopeId" | "status" | "enqueuedAt" | "startedAt" | "finishedAt" | "attemptCount" | "error"> & {
  chatId: string | null;
};
export type { TaskStatus };

export interface TaskRunPageInput {
  limit?: number;
  cursor?: string;
  chatId?: string;
}

export interface TaskRunPage {
  items: TaskRunSummary[];
  nextCursor: string | null;
}

/** Monitor the one AgentKit queue; this SDK cannot create or execute work. */
export interface TasksSDK {
  listTasks(input?: TaskRunPageInput): Promise<TaskRunPage>;
  getTask(taskId: string): Promise<TaskRunSummary | null>;
  cancelTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
}

export const AGENTKIT_MONITOR_TOKEN = "openpcb.agentkit-monitor";
