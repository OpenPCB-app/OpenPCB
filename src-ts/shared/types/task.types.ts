/**
 * Task Types - V2 Kernel
 *
 * Tasks represent background AI operations (chat completions, streaming).
 * Each task has a lifecycle: pending -> running -> completed/failed/cancelled
 */

import type { ProviderId } from "./provider.types";
import type { KernelMessage } from "./message.types";

/** Task identifier (UUID v7) */
export type TaskId = string;

/** Task states */
export type TaskState =
  | "pending" // Created, not yet started
  | "running" // Currently executing
  | "streaming" // Actively streaming response
  | "completed" // Successfully finished
  | "failed" // Error occurred
  | "cancelled"; // User aborted

/** Task type discriminator */
export type TaskType = "chat" | "completion";

/** Token usage statistics */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

/** Task result (success) */
export interface TaskResultSuccess {
  ok: true;
  text: string;
  reasoningText?: string;
  usage?: TokenUsage;
  finishReason?: string;
}

/** Task result (failure) */
export interface TaskResultFailure {
  ok: false;
  error: {
    message: string;
    code?: string;
  };
}

/** Task result union */
export type TaskResult = TaskResultSuccess | TaskResultFailure;

/** Chat task input */
export interface ChatTaskInput {
  chatId: string;
  provider: ProviderId;
  model: string;
  messages: KernelMessage[];
  systemPrompt?: string;
  apiKey?: string;
}

/** Task metadata (for tracking) */
export interface TaskMeta {
  id: TaskId;
  type: TaskType;
  state: TaskState;
  createdAt: string; // ISO 8601
  startedAt?: string;
  completedAt?: string;
  chatId?: string;
  provider?: ProviderId;
  model?: string;
}

/** Full task record */
export interface Task<TInput = unknown, TResult = TaskResult> {
  meta: TaskMeta;
  input: TInput;
  result?: TResult;
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
}

/** Chat-specific task */
export type ChatTask = Task<ChatTaskInput, TaskResult>;

/** Task event types */
export type TaskEventType =
  | "task.created"
  | "task.started"
  | "task.progress"
  | "task.token"
  | "task.reasoning"
  | "task.completed"
  | "task.failed"
  | "task.cancelled";

/** Base task event */
export interface TaskEventBase {
  taskId: TaskId;
  timestamp: string;
}

/** Task created event */
export interface TaskCreatedEvent extends TaskEventBase {
  type: "task.created";
  meta: TaskMeta;
}

/** Task started event */
export interface TaskStartedEvent extends TaskEventBase {
  type: "task.started";
}

/** Task progress event (percentage) */
export interface TaskProgressEvent extends TaskEventBase {
  type: "task.progress";
  progress: number; // 0-100
}

/** Task token event (streaming) */
export interface TaskTokenEvent extends TaskEventBase {
  type: "task.token";
  token: string;
}

/** Task reasoning event (streaming) */
export interface TaskReasoningEvent extends TaskEventBase {
  type: "task.reasoning";
  text: string;
}

/** Task completed event */
export interface TaskCompletedEvent extends TaskEventBase {
  type: "task.completed";
  result: TaskResultSuccess;
}

/** Task failed event */
export interface TaskFailedEvent extends TaskEventBase {
  type: "task.failed";
  error: {
    message: string;
    code?: string;
  };
}

/** Task cancelled event */
export interface TaskCancelledEvent extends TaskEventBase {
  type: "task.cancelled";
}

/** Union of all task events */
export type TaskEvent =
  | TaskCreatedEvent
  | TaskStartedEvent
  | TaskProgressEvent
  | TaskTokenEvent
  | TaskReasoningEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCancelledEvent;

/** Create task metadata */
export function createTaskMeta(
  id: TaskId,
  type: TaskType,
  options?: Partial<Pick<TaskMeta, "chatId" | "provider" | "model">>,
): TaskMeta {
  return {
    id,
    type,
    state: "pending",
    createdAt: new Date().toISOString(),
    ...options,
  };
}

/** Check if task is in terminal state */
export function isTerminalState(state: TaskState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

/** Check if task is active (running or streaming) */
export function isActiveState(state: TaskState): boolean {
  return state === "running" || state === "streaming";
}
