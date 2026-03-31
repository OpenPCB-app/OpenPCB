/**
 * Task Manager
 * 
 * Orchestrates task lifecycle and event emission.
 * Implements business logic for task management.
 */

import { TaskStore } from './store';
import type { Task, TaskMeta, TaskStatus, TaskEvent } from './types';
import { TaskStatus as Status } from './types';

/**
 * Task Manager - orchestrates task lifecycle
 * 
 * Responsibilities:
 * - Task creation
 * - Status transitions
 * - Cancellation handling
 * - Event emission
 */
export class TaskManager {
    private store: TaskStore;
    private abortControllers = new Map<string, AbortController>();
    private eventHandlers = new Map<string, Set<(event: TaskEvent) => void>>();

    constructor(store: TaskStore) {
        this.store = store;
    }

    /**
     * Create a new task
     * @param type Task type/category
     * @param input Task input data
     * @returns Task ID
     */
    create<TInput>(type: string, input: TInput): string {
        const task = this.store.create(type, input);
        console.log(`[TaskManager] Created task ${task.id} (type: ${type})`);
        return task.id;
    }

    /**
     * Start task execution
     * @param id Task ID
     * @returns True if started, false if task not found
     */
    start(id: string): boolean {
        const success = this.store.update(id, {
            status: Status.RUNNING,
            startedAt: new Date(),
        });

        if (success) {
            console.log(`[TaskManager] Started task ${id}`);
        }

        return success;
    }

    /**
     * Mark task as streaming
     * @param id Task ID
     * @returns True if updated, false if task not found
     */
    startStreaming(id: string): boolean {
        return this.store.update(id, {
            status: Status.STREAMING,
        });
    }

    /**
     * Complete task successfully
     * @param id Task ID
     * @param output Task output data
     * @returns True if completed, false if task not found
     */
    complete<TOutput>(id: string, output: TOutput): boolean {
        const success = this.store.update(id, {
            status: Status.COMPLETED,
            output,
            completedAt: new Date(),
        });

        if (success) {
            console.log(`[TaskManager] Completed task ${id}`);
            this.emit(id, {
                taskId: id,
                type: 'complete',
                payload: output,
                timestamp: new Date(),
            });
            this.cleanupAbortion(id);
        }

        return success;
    }

    /**
     * Fail task with error
     * @param id Task ID
     * @param error Error information
     * @returns True if failed, false if task not found
     */
    fail(
        id: string,
        error: { message: string; code: string; stack?: string }
    ): boolean {
        const success = this.store.update(id, {
            status: Status.FAILED,
            error,
            completedAt: new Date(),
        });

        if (success) {
            console.error(`[TaskManager] Failed task ${id}:`, error.message);
            this.emit(id, {
                taskId: id,
                type: 'error',
                payload: error,
                timestamp: new Date(),
            });
            this.cleanupAbortion(id);
        }

        return success;
    }

    /**
     * Cancel a running task
     * @param id Task ID
     * @returns True if cancelled, false if not found or not running
     */
    cancel(id: string): boolean {
        const task = this.store.get(id);
        if (!task || task.status === Status.COMPLETED || task.status === Status.FAILED) {
            return false;
        }

        // Trigger abort signal
        const controller = this.abortControllers.get(id);
        if (controller) {
            controller.abort();
        }

        const success = this.store.update(id, {
            status: Status.CANCELLED,
            completedAt: new Date(),
        });

        if (success) {
            console.log(`[TaskManager] Cancelled task ${id}`);
            this.cleanupAbortion(id);
        }

        return success;
    }

    /**
     * Get full task
     * @param id Task ID
     * @returns Task or null if not found
     */
    get<TInput = unknown, TOutput = unknown>(id: string): Task<TInput, TOutput> | null {
        return this.store.get<TInput, TOutput>(id);
    }

    /**
     * Get task metadata only
     * @param id Task ID
     * @returns Task metadata or null
     */
    getMeta(id: string): TaskMeta | null {
        return this.store.getMeta(id);
    }

    /**
     * List tasks with optional filter
     * @param filter Filter criteria
     * @returns Array of matching tasks
     */
    list(filter?: { status?: TaskStatus; type?: string }): Task[] {
        return this.store.list(filter);
    }

    /**
     * Get abort signal for task cancellation
     * @param id Task ID
     * @returns AbortSignal for the task
     */
    getAbortSignal(id: string): AbortSignal {
        let controller = this.abortControllers.get(id);
        if (!controller) {
            controller = new AbortController();
            this.abortControllers.set(id, controller);
        }
        return controller.signal;
    }

    /**
     * Subscribe to task events
     * @param taskId Task ID to listen to
     * @param handler Event handler callback
     * @returns Unsubscribe function
     */
    on(taskId: string, handler: (event: TaskEvent) => void): () => void {
        let handlers = this.eventHandlers.get(taskId);
        if (!handlers) {
            handlers = new Set();
            this.eventHandlers.set(taskId, handlers);
        }
        handlers.add(handler);

        // Return unsubscribe function
        return () => {
            handlers?.delete(handler);
            if (handlers?.size === 0) {
                this.eventHandlers.delete(taskId);
            }
        };
    }

    /**
     * Emit task event to all subscribers
     * @param taskId Task ID
     * @param event Event to emit
     */
    private emit(taskId: string, event: TaskEvent): void {
        const handlers = this.eventHandlers.get(taskId);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(event);
                } catch (error) {
                    console.error('[TaskManager] Event handler error:', error);
                }
            });
        }
    }

    /**
     * Cleanup old completed tasks
     */
    cleanup(): void {
        const cleaned = this.store.cleanup();
        if (cleaned > 0) {
            console.log(`[TaskManager] Cleaned up ${cleaned} old tasks`);
        }
    }

    /**
     * Cleanup abort controller and event handlers for a task
     * @param id Task ID
     */
    private cleanupAbortion(id: string): void {
        this.abortControllers.delete(id);
        this.eventHandlers.delete(id);
    }
}
