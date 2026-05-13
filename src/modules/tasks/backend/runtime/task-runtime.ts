import type {
  CreateTaskInput,
  CreateTaskResult,
  QueueStatus,
  Task,
  TaskError,
  TaskEvent,
  TaskExecutor,
  TaskFilter,
  TaskResult,
  TaskStatus,
} from "../../../../sdks/tasks";
import { ExecutorRegistry } from "./executor-registry";
import { TaskEventBus } from "./event-bus";
import { ScopeTaskLock } from "./scope-task-lock";
import { assertValidTransition, isTerminalStatus } from "./status";
import { TaskQueueManager } from "./task-queue-manager";
import type { TaskStorage } from "../storage/openpcb-task-storage";

export class TaskRuntime {
  readonly events = new TaskEventBus();
  readonly executors = new ExecutorRegistry();
  readonly queue = new TaskQueueManager(3);
  private readonly scopeLock = new ScopeTaskLock();
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    readonly storage: TaskStorage,
    private readonly logger: { info(message: string, meta?: unknown): void; error(message: string, meta?: unknown): void },
  ) {
    this.queue.onTaskReady((task) => this.executeTask(task));
  }

  registerExecutor(type: string, executor: TaskExecutor): void {
    this.executors.register(type, executor);
  }

  async createTask<TPayload>(input: CreateTaskInput<TPayload>): Promise<CreateTaskResult<TPayload>> {
    const status = input.dependsOn ? "waiting" : "pending";
    const task = await this.storage.createTask({ ...input, status });
    if (input.dependsOn) await this.storage.addWaitingTask(input.dependsOn, task.id);
    await this.emit({ type: "task.created", taskId: task.id, status: task.status, data: { task }, timestamp: new Date().toISOString() });
    const enqueuedImmediately = input.dependsOn ? false : await this.enqueueOrWaitForScope(task);
    return { task, enqueuedImmediately, queueStatus: this.queue.getQueueStatus(task.queueKey) };
  }

  async getTask(taskId: string): Promise<Task> {
    const task = await this.storage.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  listTasks(filter?: TaskFilter): Promise<Task[]> {
    return this.storage.listTasks(filter);
  }

  onEvent(handler: (event: TaskEvent) => void): () => void {
    return this.events.on(handler);
  }

  onTaskEvent(taskId: string, handler: (event: TaskEvent) => void): () => void {
    return this.events.onTask(taskId, handler);
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (isTerminalStatus(task.status)) return;
    this.abortControllers.get(taskId)?.abort();
    this.queue.removeFromQueue(taskId);
    const next = task.correlation?.scopeId ? this.scopeLock.cancel(task.correlation.scopeId, taskId) : null;
    await this.transition(task, "cancelled", { completedAt: new Date().toISOString(), metadata: { ...(task.metadata ?? {}), cancelled: true } });
    for (const child of await this.storage.findWaitingOn(taskId)) await this.cancelTask(child.id);
    if (next) await this.startScopeQueuedTask(next);
  }

  async retryTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!["failed", "paused", "cancelled"].includes(task.status)) throw new Error(`Cannot retry ${task.status} task`);
    const updated = await this.storage.updateTask(taskId, { status: "queued", error: null, completedAt: null, retryCount: task.retryCount + 1 });
    this.queue.enqueue(updated);
    await this.emit({ type: "task.queued", taskId, status: "queued", timestamp: new Date().toISOString() });
  }

  getQueueStatus(): QueueStatus[] {
    return this.queue.getAllQueueStatus();
  }

  async resumeTasksOnStartup(): Promise<void> {
    for (const task of await this.storage.findRunning()) {
      await this.storage.updateTask(task.id, { status: "paused", metadata: { ...(task.metadata ?? {}), resumedAfterCrash: true } });
      await this.emit({ type: "task.paused", taskId: task.id, status: "paused", data: { reason: "crash_recovery" }, timestamp: new Date().toISOString() });
    }
  }

  private async enqueueOrWaitForScope(task: Task): Promise<boolean> {
    const scopeId = task.correlation?.scopeId;
    if (scopeId && !this.scopeLock.tryAcquire(scopeId, task.id)) {
      await this.storage.updateTask(task.id, { status: "waiting", metadata: { ...(task.metadata ?? {}), waitReason: "scope_serialized" } });
      return false;
    }
    const queued = await this.transition(task, "queued");
    this.queue.enqueue(queued);
    return true;
  }

  private async executeTask(task: Task): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(task.id, controller);
    const startMs = Date.now();
    let current = task;
    try {
      current = await this.transition(current, "running", { startedAt: new Date().toISOString() });
      const executor = this.executors.get(current.type);
      const data = await executor.execute({
        task: current,
        signal: controller.signal,
        logger: this.logger,
        emitProgress: async (progress) => {
          const metadata = { ...(current.metadata ?? {}), progress: progress.progress, progressStage: progress.stage, custom: progress.metadata };
          await this.storage.updateTask(current.id, { metadata });
          await this.emit({ type: "task.progress", taskId: current.id, status: current.status, data: progress, timestamp: new Date().toISOString() });
        },
        emitChunk: async (chunk) => {
          if (current.status === "running") current = await this.transition(current, "streaming");
          const [created] = await this.storage.appendChunks(current.id, [chunk]);
          await this.emit({ type: "task.chunk", taskId: current.id, status: "streaming", data: created ?? chunk, timestamp: new Date().toISOString() });
        },
        emitEvent: async (event) => {
          await this.emit({ ...event, taskId: current.id, timestamp: new Date().toISOString() });
        },
      });
      const result: TaskResult = { success: true, data, duration: Date.now() - startMs, finishReason: "stop" };
      await this.transition(await this.getTask(current.id), "completed", { result, completedAt: new Date().toISOString() });
      await this.resolveDependency(current.id, result);
    } catch (error) {
      const taskError = this.toTaskError(error, controller.signal.aborted);
      const status: TaskStatus = controller.signal.aborted ? "cancelled" : taskError.retryable && current.retryCount < current.maxRetries ? "paused" : "failed";
      await this.transition(await this.getTask(current.id), status, { error: taskError, completedAt: status === "paused" ? null : new Date().toISOString() });
      await this.pauseDependents(current.id, taskError);
    } finally {
      this.abortControllers.delete(current.id);
      this.queue.releaseSlot(current.queueKey, current.id);
      const scopeId = current.correlation?.scopeId;
      if (scopeId) {
        const next = this.scopeLock.release(scopeId, current.id);
        if (next) await this.startScopeQueuedTask(next);
      }
      await this.queue.processQueue(current.queueKey);
    }
  }

  private async startScopeQueuedTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (task.status !== "waiting" || task.dependsOn) return;
    const queued = await this.transition(task, "queued", { metadata: { ...(task.metadata ?? {}), waitReason: null } });
    this.queue.enqueue(queued);
  }

  private async resolveDependency(parentTaskId: string, _result: TaskResult): Promise<void> {
    for (const child of await this.storage.findWaitingOn(parentTaskId)) {
      const updated = await this.storage.updateTask(child.id, { dependsOn: null });
      await this.storage.removeWaitingTask(parentTaskId, child.id);
      await this.enqueueOrWaitForScope(updated);
    }
  }

  private async pauseDependents(parentTaskId: string, reason: TaskError): Promise<void> {
    for (const child of await this.storage.findWaitingOn(parentTaskId)) {
      const metadata = { ...(child.metadata ?? {}), waitReason: "dependency_failed", dependencyError: reason };
      await this.storage.updateTask(child.id, { status: "paused", metadata });
      await this.storage.removeWaitingTask(parentTaskId, child.id);
    }
  }

  private async transition(task: Task, status: TaskStatus, patch: Partial<Task> = {}): Promise<Task> {
    assertValidTransition(task.status, status);
    const updated = await this.storage.updateTask(task.id, { ...patch, status });
    await this.emit({ type: this.eventType(status), taskId: task.id, status, data: { task: updated }, timestamp: new Date().toISOString() });
    return updated;
  }

  private async emit(event: TaskEvent): Promise<void> {
    this.events.emit(event);
    try {
      await this.storage.appendEvent(event);
    } catch (error) {
      this.logger.error("Failed to persist task event", { event, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private eventType(status: TaskStatus): TaskEvent["type"] {
    if (status === "queued") return "task.queued";
    if (status === "running") return "task.started";
    if (status === "streaming") return "task.streaming";
    if (status === "completed") return "task.completed";
    if (status === "failed") return "task.failed";
    if (status === "cancelled") return "task.cancelled";
    if (status === "paused") return "task.paused";
    return "task.created";
  }

  private toTaskError(error: unknown, aborted: boolean): TaskError {
    return {
      type: aborted ? "cancelled" : "provider",
      code: aborted ? "ABORTED" : "EXECUTION_ERROR",
      message: error instanceof Error ? error.message : String(error),
      details: error,
      retryable: !aborted,
      timestamp: new Date().toISOString(),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    };
  }
}
