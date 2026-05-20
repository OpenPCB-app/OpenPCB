import type { QueueStatus, Task } from "../../../../sdks/tasks";

interface QueueState {
  queued: Task[];
  active: Set<string>;
}

export class TaskQueueManager {
  private readonly queues = new Map<string, QueueState>();
  private onReady?: (task: Task) => Promise<void>;

  constructor(private readonly defaultConcurrency = 3) {}

  onTaskReady(handler: (task: Task) => Promise<void>): void {
    this.onReady = handler;
  }

  shutdown(): void {
    this.onReady = undefined;
    this.queues.clear();
  }

  enqueue(task: Task): void {
    const state = this.state(task.queueKey);
    if (state.active.has(task.id) || state.queued.some((entry) => entry.id === task.id)) return;
    state.queued.push(task);
    state.queued.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
    void this.processQueue(task.queueKey);
  }

  removeFromQueue(taskId: string): void {
    for (const state of this.queues.values()) {
      state.queued = state.queued.filter((task) => task.id !== taskId);
    }
  }

  releaseSlot(queueKey: string, taskId: string): void {
    this.state(queueKey).active.delete(taskId);
  }

  async processQueue(queueKey: string): Promise<void> {
    const state = this.state(queueKey);
    while (this.onReady && state.active.size < this.defaultConcurrency) {
      const task = state.queued.shift();
      if (!task) return;
      state.active.add(task.id);
      void this.onReady(task);
    }
  }

  getAllQueueStatus(): QueueStatus[] {
    return [...this.queues.keys()].map((queueKey) => this.getQueueStatus(queueKey));
  }

  getQueueStatus(queueKey: string): QueueStatus {
    const state = this.state(queueKey);
    return {
      queueKey,
      queuedTasks: state.queued.length,
      activeTasks: state.active.size,
      availableSlots: Math.max(0, this.defaultConcurrency - state.active.size),
      maxConcurrent: this.defaultConcurrency,
    };
  }

  private state(queueKey: string): QueueState {
    const existing = this.queues.get(queueKey);
    if (existing) return existing;
    const created = { queued: [], active: new Set<string>() };
    this.queues.set(queueKey, created);
    return created;
  }
}
