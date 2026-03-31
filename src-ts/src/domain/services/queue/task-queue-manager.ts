/**
 * TaskQueueManager - Per-Provider Task Queue with Priority Scheduling
 *
 * Implements priority-based task scheduling with:
 * - Per-provider queues with configurable concurrency limit
 * - Priority-based dequeuing (higher priority = more urgent)
 * - Slot management for concurrent task execution
 *
 * See: TASK_SYSTEM_SPECIFICATION.md Section 5.2, 7.1
 */

import type { Task } from '../../../db/schema/task';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Queue status information for a provider
 */
export interface QueueStatus {
  provider: string;
  queuedTasks: number;
  activeTasks: number;
  availableSlots: number;
  maxConcurrent: number;
}

/**
 * Queue configuration options
 */
export interface QueueConfig {
  /** Maximum concurrent tasks per provider (default: 3) */
  maxConcurrentPerProvider: number;
  /** Enable detailed logging (default: false) */
  debug: boolean;
  /** Priority aging interval in ms (default: 30000 = 30 seconds) */
  agingIntervalMs: number;
  /** Priority bonus per aging interval (default: 1) */
  agingBonus: number;
  /** Maximum priority after aging (default: 10) */
  maxPriority: number;
}

/**
 * Task entry in the queue with priority metadata
 */
interface QueueEntry {
  task: Task;
  enqueuedAt: number;
  /** Effective priority after aging (starts at task.priority) */
  effectivePriority: number;
}

/**
 * Per-provider queue state
 */
interface ProviderQueue {
  /** Priority queue (sorted by priority desc, then enqueue time asc) */
  queue: QueueEntry[];
  /** Set of currently active (executing) task IDs */
  activeSlots: Set<string>;
  /** Processing state */
  processing: boolean;
}

// ─── Priority Queue Helpers ──────────────────────────────────────────────────

/**
 * Compare queue entries for priority sorting
 * Higher effective priority first, then earlier enqueue time
 */
function compareEntries(a: QueueEntry, b: QueueEntry): number {
  // Higher effective priority first
  if (a.effectivePriority !== b.effectivePriority) {
    return b.effectivePriority - a.effectivePriority;
  }
  // Earlier enqueue time first (FIFO for same priority)
  return a.enqueuedAt - b.enqueuedAt;
}

/**
 * Insert entry into sorted queue maintaining priority order
 */
function insertSorted(queue: QueueEntry[], entry: QueueEntry): void {
  // Binary search for insertion point
  let low = 0;
  let high = queue.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midEntry = queue[mid];
    // mid is always valid since low < high and mid = floor((low+high)/2)
    if (midEntry && compareEntries(midEntry, entry) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  queue.splice(low, 0, entry);
}

// ─── TaskQueueManager Implementation ─────────────────────────────────────────

export class TaskQueueManager {
  private queues = new Map<string, ProviderQueue>();
  private config: QueueConfig;

  /** Callback when task is ready for execution */
  private onTaskReadyCallback?: (task: Task) => Promise<void>;

  /** Timer for priority aging */
  private agingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<QueueConfig>) {
    this.config = {
      maxConcurrentPerProvider: config?.maxConcurrentPerProvider ?? 3,
      debug: config?.debug ?? false,
      agingIntervalMs: config?.agingIntervalMs ?? 30000, // 30 seconds
      agingBonus: config?.agingBonus ?? 1,
      maxPriority: config?.maxPriority ?? 10,
    };

    // Start aging timer
    this.startAgingTimer();
  }

  // ─── Configuration ─────────────────────────────────────────────────────

  /**
   * Set callback for when a task is dequeued and ready for execution
   * This is called during processQueue when a slot becomes available
   */
  onTaskReady(callback: (task: Task) => Promise<void>): void {
    this.onTaskReadyCallback = callback;
  }

  /**
   * Update max concurrent limit for all providers
   * @param limit Must be between 1 and 100
   */
  setMaxConcurrent(limit: number): void {
    if (limit < 1 || limit > 100) {
      throw new Error(`Invalid concurrent limit: ${limit}. Must be 1-100.`);
    }
    this.config.maxConcurrentPerProvider = limit;
  }

  // ─── Queue Operations ──────────────────────────────────────────────────

  /**
   * Enqueue a task for execution
   * Task should already have status='queued' in database
   */
  enqueue(task: Task): void {
    const queue = this.getOrCreateQueue(task.provider);

    // Check if already in queue
    if (queue.queue.some(e => e.task.id === task.id)) {
      this.log(`Task ${task.id} already in queue for ${task.provider}`);
      return;
    }

    // Check if already active
    if (queue.activeSlots.has(task.id)) {
      this.log(`Task ${task.id} already active for ${task.provider}`);
      return;
    }

    const entry: QueueEntry = {
      task,
      enqueuedAt: Date.now(),
      effectivePriority: task.priority,
    };

    insertSorted(queue.queue, entry);

    this.log(`Enqueued task ${task.id} for ${task.provider} (priority: ${task.priority}, queue size: ${queue.queue.length})`);
  }

  /**
   * Dequeue the highest-priority task if a slot is available
   * Returns null if queue is empty or no slots available
   */
  dequeue(provider: string): Task | null {
    const queue = this.queues.get(provider);
    if (!queue) return null;

    // Check slot availability
    if (queue.activeSlots.size >= this.config.maxConcurrentPerProvider) {
      return null;
    }

    // Pop highest-priority task (first in sorted queue)
    const entry = queue.queue.shift();
    if (!entry) return null;

    // Mark slot as active
    queue.activeSlots.add(entry.task.id);

    this.log(`Dequeued task ${entry.task.id} for ${provider} (active: ${queue.activeSlots.size}/${this.config.maxConcurrentPerProvider})`);

    return entry.task;
  }

  /**
   * Remove a task from the queue (e.g., on cancellation)
   */
  removeFromQueue(taskId: string): boolean {
    for (const [provider, queue] of this.queues) {
      const idx = queue.queue.findIndex(e => e.task.id === taskId);
      if (idx !== -1) {
        queue.queue.splice(idx, 1);
        this.log(`Removed task ${taskId} from ${provider} queue`);
        return true;
      }
    }
    return false;
  }

  /**
   * Release an active slot (called when task completes/fails/cancels)
   */
  releaseSlot(provider: string, taskId: string): void {
    const queue = this.queues.get(provider);
    if (!queue) return;

    const wasActive = queue.activeSlots.delete(taskId);
    if (wasActive) {
      this.log(`Released slot for ${taskId} on ${provider} (active: ${queue.activeSlots.size}/${this.config.maxConcurrentPerProvider})`);
    }
  }

  /**
   * Process queue for a provider - dequeue and execute tasks
   * Called after enqueue or slot release
   */
  async processQueue(provider: string): Promise<void> {
    const queue = this.queues.get(provider);
    if (!queue || queue.processing) return;

    queue.processing = true;

    try {
      // Keep dequeuing while slots available and tasks exist
      while (queue.queue.length > 0 && queue.activeSlots.size < this.config.maxConcurrentPerProvider) {
        const task = this.dequeue(provider);
        if (!task) break;

        // Execute task via callback
        if (this.onTaskReadyCallback) {
          // Fire and forget - don't await, let execution proceed independently
          this.onTaskReadyCallback(task).catch(err => {
            console.error(`[TaskQueueManager] Task execution error for ${task.id}:`, err);
            // Release slot on error
            this.releaseSlot(provider, task.id);
            void this.processQueue(provider);
          });
        }
      }
    } finally {
      queue.processing = false;
    }
  }

  /**
   * Process all queues
   */
  async processAllQueues(): Promise<void> {
    const providers = Array.from(this.queues.keys());
    await Promise.all(providers.map(p => this.processQueue(p)));
  }

  // ─── Status Queries ────────────────────────────────────────────────────

  /**
   * Get queue status for a provider
   */
  getQueueStatus(provider: string): QueueStatus {
    const queue = this.queues.get(provider);
    const activeCount = queue?.activeSlots.size ?? 0;

    return {
      provider,
      queuedTasks: queue?.queue.length ?? 0,
      activeTasks: activeCount,
      availableSlots: this.config.maxConcurrentPerProvider - activeCount,
      maxConcurrent: this.config.maxConcurrentPerProvider,
    };
  }

  /**
   * Get status for all providers
   */
  getAllQueueStatus(): QueueStatus[] {
    return Array.from(this.queues.keys()).map(p => this.getQueueStatus(p));
  }

  /**
   * Check if a task is active (currently executing)
   */
  isTaskActive(taskId: string): boolean {
    for (const queue of this.queues.values()) {
      if (queue.activeSlots.has(taskId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all active task IDs for a provider
   */
  getActiveTasks(provider: string): string[] {
    const queue = this.queues.get(provider);
    return queue ? Array.from(queue.activeSlots) : [];
  }

  /**
   * Get total queued task count across all providers
   */
  getTotalQueuedCount(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.queue.length;
    }
    return total;
  }

  /**
   * Get total active task count across all providers
   */
  getTotalActiveCount(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.activeSlots.size;
    }
    return total;
  }

  // ─── Priority Aging ────────────────────────────────────────────────────

  /**
   * Start the priority aging timer
   */
  private startAgingTimer(): void {
    if (this.agingTimer) return;

    this.agingTimer = setInterval(() => {
      this.ageQueuedTasks();
    }, this.config.agingIntervalMs);

    this.log('Started priority aging timer');
  }

  /**
   * Stop the priority aging timer
   */
  stopAgingTimer(): void {
    if (this.agingTimer) {
      clearInterval(this.agingTimer);
      this.agingTimer = null;
      this.log('Stopped priority aging timer');
    }
  }

  /**
   * Age all queued tasks - boost effective priority based on wait time
   */
  private ageQueuedTasks(): void {
    const now = Date.now();
    let aged = 0;

    for (const queue of this.queues.values()) {
      for (const entry of queue.queue) {
        // Calculate age bonus based on time waiting
        const waitTime = now - entry.enqueuedAt;
        const intervals = Math.floor(waitTime / this.config.agingIntervalMs);
        const newPriority = Math.min(
          this.config.maxPriority,
          entry.task.priority + intervals * this.config.agingBonus
        );

        if (newPriority !== entry.effectivePriority) {
          entry.effectivePriority = newPriority;
          aged++;
        }
      }

      // Re-sort queue after aging
      if (aged > 0) {
        queue.queue.sort(compareEntries);
      }
    }

    if (aged > 0) {
      this.log(`Aged ${aged} tasks`);
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Clear all queues (for shutdown or reset)
   */
  clear(): void {
    // Stop aging timer
    this.stopAgingTimer();

    for (const queue of this.queues.values()) {
      queue.queue.length = 0;
      queue.activeSlots.clear();
    }
    this.queues.clear();
    this.log('Cleared all queues');
  }

  /**
   * Clear queue for specific provider
   */
  clearProvider(provider: string): void {
    const queue = this.queues.get(provider);
    if (queue) {
      queue.queue.length = 0;
      // Don't clear active slots - let them complete
      this.log(`Cleared queue for ${provider}`);
    }
  }

  /**
   * Remove empty provider queues from memory
   * Call periodically to prevent memory leaks in long-running apps
   */
  cleanupEmptyQueues(): number {
    let cleaned = 0;
    for (const [provider, queue] of this.queues) {
      if (queue.queue.length === 0 && queue.activeSlots.size === 0) {
        this.queues.delete(provider);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.log(`Cleaned up ${cleaned} empty queue(s)`);
    }
    return cleaned;
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private getOrCreateQueue(provider: string): ProviderQueue {
    let queue = this.queues.get(provider);
    if (!queue) {
      queue = {
        queue: [],
        activeSlots: new Set(),
        processing: false,
      };
      this.queues.set(provider, queue);
    }
    return queue;
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[TaskQueueManager] ${message}`);
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let queueManagerInstance: TaskQueueManager | null = null;

export function getTaskQueueManager(config?: Partial<QueueConfig>): TaskQueueManager {
  if (!queueManagerInstance) {
    queueManagerInstance = new TaskQueueManager(config);
  }
  return queueManagerInstance;
}

export function initializeTaskQueueManager(config?: Partial<QueueConfig>): TaskQueueManager {
  if (queueManagerInstance) {
    queueManagerInstance.clear();
  }
  queueManagerInstance = new TaskQueueManager(config);
  return queueManagerInstance;
}
