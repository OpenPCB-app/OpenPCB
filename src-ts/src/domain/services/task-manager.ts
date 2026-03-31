/**
 * Task Manager - Domain Service
 *
 * Manages background AI operations with lifecycle tracking,
 * cancellation support, and cleanup.
 */

import {
  type TaskId,
  type TaskType,
  type TaskState,
  type TaskMeta,
  type Task,
  type TaskResult,
  type TaskResultSuccess,
  type TaskEvent,
  createTaskMeta,
  isTerminalState,
  isActiveState,
} from "@shared/types";
import type { ProviderId } from "@shared/types";

/** Internal task entry with abort controller */
interface TaskEntry<TInput = unknown> {
  task: Task<TInput, TaskResult>;
  abortController: AbortController;
}

/** Task filter options */
export interface TaskFilter {
  /** Filter by state */
  state?: TaskState | TaskState[];
  /** Filter by type */
  type?: TaskType;
  /** Filter by chat ID */
  chatId?: string;
  /** Filter by provider */
  provider?: ProviderId;
  /** Only active tasks */
  activeOnly?: boolean;
  /** Limit results */
  limit?: number;
}

/** Task manager configuration */
export interface TaskManagerConfig {
  /** Max tasks to keep in memory (default: 1000) */
  maxTasks?: number;
  /** Auto-cleanup completed tasks after ms (default: 5 min) */
  cleanupAfterMs?: number;
  /** Enable auto-cleanup (default: true) */
  autoCleanup?: boolean;
}

/** Event callback type */
export type TaskEventCallback = (event: TaskEvent) => void;

/** Default configuration */
const DEFAULT_CONFIG: Required<TaskManagerConfig> = {
  maxTasks: 1000,
  cleanupAfterMs: 5 * 60 * 1000, // 5 minutes
  autoCleanup: true,
};

/**
 * Task Manager for tracking background operations.
 */
export class TaskManager {
  private tasks: Map<TaskId, TaskEntry> = new Map();
  private config: Required<TaskManagerConfig>;
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private eventListeners: Set<TaskEventCallback> = new Set();

  constructor(config: TaskManagerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoCleanup) {
      this.startAutoCleanup();
    }
  }

  /**
   * Create a new task.
   */
  create<TInput>(
    type: TaskType,
    input: TInput,
    options?: {
      chatId?: string;
      provider?: ProviderId;
      model?: string;
    },
  ): TaskId {
    const id = crypto.randomUUID();
    const meta = createTaskMeta(id, type, options);
    const abortController = new AbortController();

    const task: Task<TInput, TaskResult> = {
      meta,
      input,
    };

    this.tasks.set(id, { task, abortController });
    this.enforceMaxTasks();

    this.emit({
      type: "task.created",
      taskId: id,
      timestamp: meta.createdAt,
      meta,
    });

    return id;
  }

  /**
   * Mark task as started.
   */
  start(taskId: TaskId): void {
    const entry = this.tasks.get(taskId);
    if (!entry) return;

    const now = new Date().toISOString();
    entry.task.meta.state = "running";
    entry.task.meta.startedAt = now;

    this.emit({
      type: "task.started",
      taskId,
      timestamp: now,
    });
  }

  /**
   * Update task state.
   */
  updateState(taskId: TaskId, state: TaskState): void {
    const entry = this.tasks.get(taskId);
    if (!entry) return;

    entry.task.meta.state = state;

    if (isTerminalState(state) && !entry.task.meta.completedAt) {
      entry.task.meta.completedAt = new Date().toISOString();
    }
  }

  /**
   * Mark task as streaming.
   */
  startStreaming(taskId: TaskId): void {
    this.updateState(taskId, "streaming");
  }

  /**
   * Complete task successfully.
   */
  complete(taskId: TaskId, result: TaskResultSuccess): void {
    const entry = this.tasks.get(taskId);
    if (!entry) return;

    const now = new Date().toISOString();
    entry.task.meta.state = "completed";
    entry.task.meta.completedAt = now;
    entry.task.result = result;

    this.emit({
      type: "task.completed",
      taskId,
      timestamp: now,
      result,
    });
  }

  /**
   * Mark task as failed.
   */
  fail(taskId: TaskId, error: { message: string; code?: string; stack?: string }): void {
    const entry = this.tasks.get(taskId);
    if (!entry) return;

    const now = new Date().toISOString();
    entry.task.meta.state = "failed";
    entry.task.meta.completedAt = now;
    entry.task.error = error;
    entry.task.result = {
      ok: false,
      error: { message: error.message, code: error.code },
    };

    this.emit({
      type: "task.failed",
      taskId,
      timestamp: now,
      error: { message: error.message, code: error.code },
    });
  }

  /**
   * Cancel task and trigger abort.
   * Returns true if task was cancelled.
   */
  cancel(taskId: TaskId): boolean {
    const entry = this.tasks.get(taskId);
    if (!entry) return false;

    // Can only cancel non-terminal tasks
    if (isTerminalState(entry.task.meta.state)) {
      return false;
    }

    const now = new Date().toISOString();

    // Abort the controller
    entry.abortController.abort();

    // Update state
    entry.task.meta.state = "cancelled";
    entry.task.meta.completedAt = now;

    this.emit({
      type: "task.cancelled",
      taskId,
      timestamp: now,
    });

    return true;
  }

  /**
   * Get task by ID.
   */
  get<TInput = unknown>(taskId: TaskId): Task<TInput, TaskResult> | undefined {
    const entry = this.tasks.get(taskId);
    return entry?.task as Task<TInput, TaskResult> | undefined;
  }

  /**
   * Get task metadata by ID.
   */
  getMeta(taskId: TaskId): TaskMeta | undefined {
    return this.tasks.get(taskId)?.task.meta;
  }

  /**
   * Get abort signal for task.
   */
  getAbortSignal(taskId: TaskId): AbortSignal | undefined {
    return this.tasks.get(taskId)?.abortController.signal;
  }

  /**
   * Check if task is aborted.
   */
  isAborted(taskId: TaskId): boolean {
    const entry = this.tasks.get(taskId);
    return entry?.abortController.signal.aborted ?? false;
  }

  /**
   * List tasks matching filter.
   */
  list(filter?: TaskFilter): TaskMeta[] {
    const results: TaskMeta[] = [];

    for (const entry of this.tasks.values()) {
      const meta = entry.task.meta;

      // Apply filters
      if (filter?.state) {
        const states = Array.isArray(filter.state) ? filter.state : [filter.state];
        if (!states.includes(meta.state)) continue;
      }

      if (filter?.type && meta.type !== filter.type) continue;
      if (filter?.chatId && meta.chatId !== filter.chatId) continue;
      if (filter?.provider && meta.provider !== filter.provider) continue;
      if (filter?.activeOnly && !isActiveState(meta.state)) continue;

      results.push(meta);

      if (filter?.limit && results.length >= filter.limit) break;
    }

    // Sort by creation time (newest first)
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Get count of active tasks.
   */
  activeCount(): number {
    let count = 0;
    for (const entry of this.tasks.values()) {
      if (isActiveState(entry.task.meta.state)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get total task count.
   */
  totalCount(): number {
    return this.tasks.size;
  }

  /**
   * Cleanup completed/failed/cancelled tasks older than specified age.
   * Returns number of tasks removed.
   */
  cleanup(olderThanMs?: number): number {
    const maxAge = olderThanMs ?? this.config.cleanupAfterMs;
    const cutoff = Date.now() - maxAge;
    let removed = 0;

    for (const [id, entry] of this.tasks.entries()) {
      if (!isTerminalState(entry.task.meta.state)) continue;

      const completedAt = entry.task.meta.completedAt;
      if (!completedAt) continue;

      const completedTime = new Date(completedAt).getTime();
      if (completedTime < cutoff) {
        this.tasks.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[TaskManager] Cleaned up ${removed} completed tasks`);
    }

    return removed;
  }

  /**
   * Add event listener.
   */
  addEventListener(callback: TaskEventCallback): void {
    this.eventListeners.add(callback);
  }

  /**
   * Remove event listener.
   */
  removeEventListener(callback: TaskEventCallback): void {
    this.eventListeners.delete(callback);
  }

  /**
   * Shutdown task manager.
   */
  shutdown(): void {
    // Stop auto-cleanup
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Cancel all active tasks
    for (const [id, entry] of this.tasks.entries()) {
      if (isActiveState(entry.task.meta.state)) {
        this.cancel(id);
      }
    }

    this.tasks.clear();
    this.eventListeners.clear();

    console.log("[TaskManager] Shutdown complete");
  }

  /** Emit event to all listeners */
  private emit(event: TaskEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[TaskManager] Event listener error:", err);
      }
    }
  }

  /** Start auto-cleanup interval */
  private startAutoCleanup(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60_000);
  }

  /** Enforce max tasks limit by removing oldest completed tasks */
  private enforceMaxTasks(): void {
    if (this.tasks.size <= this.config.maxTasks) return;

    // Collect terminal tasks sorted by completion time
    const terminalTasks: Array<{ id: TaskId; completedAt: string }> = [];

    for (const [id, entry] of this.tasks.entries()) {
      if (isTerminalState(entry.task.meta.state) && entry.task.meta.completedAt) {
        terminalTasks.push({ id, completedAt: entry.task.meta.completedAt });
      }
    }

    // Sort oldest first
    terminalTasks.sort((a, b) => a.completedAt.localeCompare(b.completedAt));

    // Remove oldest until under limit
    const toRemove = this.tasks.size - this.config.maxTasks;
    for (let i = 0; i < toRemove && i < terminalTasks.length; i++) {
      const task = terminalTasks[i];
      if (task) {
        this.tasks.delete(task.id);
      }
    }
  }
}

/** Create a new task manager instance */
export function createTaskManager(config?: TaskManagerConfig): TaskManager {
  return new TaskManager(config);
}
