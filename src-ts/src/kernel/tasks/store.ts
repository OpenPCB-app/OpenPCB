/**
 * Task Store - SQLite Persistence with Cache
 * 
 * Provides synchronous API for TaskManager while using SQLite internally.
 * Uses cache for immediate reads + background persistence for sync compatibility.
 */

import type { Task, TaskMeta, TaskStatus } from './types';
import { TaskStatus as Status } from './types';
import type { TaskRepository } from '../../db/repositories/task';
import { generateUUIDv7 } from '../../db/schema/base';

/**
 * Task Store with SQLite persistence
 * 
 * IMPORTANT: Maintains sync API for backward compatibility
 * but persists to SQLite asynchronously in background.
 */
export class TaskStore {
    // Cache for immediate sync access
    private cache = new Map<string, Task>();

    constructor(private repository: TaskRepository) {
        // Load existing tasks from DB on initialization
        this.initializeCache();
    }

    /**
     * Initialize cache from database
     */
    private async initializeCache(): Promise<void> {
        try {
            // Load all active tasks (not completed/failed/cancelled)
            const activeTasks = await this.repository.findByStatus([
                Status.PENDING,
                Status.RUNNING,
                Status.STREAMING
            ]);

            for (const dbTask of activeTasks) {
                this.cache.set(dbTask.id, this.mapToKernelTask(dbTask));
            }

            console.log(`[TaskStore] Loaded ${activeTasks.length} active tasks from database`);
        } catch (error) {
            console.error('[TaskStore] Failed to load tasks from database:', error);
        }
    }

    /**
     * Create a new task (sync API)
     */
    create<TInput>(type: string, input: TInput): Task<TInput> {
        const task: Task<TInput> = {
            id: generateUUIDv7(),
            type,
            status: Status.PENDING,
            input,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        // Add to cache immediately
        this.cache.set(task.id, task);

        // Persist to DB in background (non-blocking)
        this.persistTask(task).catch(err => {
            console.error(`[TaskStore] Failed to persist task ${task.id}:`, err);
        });

        return task;
    }

    /**
     * Get task by ID (sync API, cache-first)
     */
    get<TInput = unknown, TOutput = unknown>(id: string): Task<TInput, TOutput> | null {
        return (this.cache.get(id) as Task<TInput, TOutput>) || null;
    }

    /**
     * Get task metadata only (sync API)
     */
    getMeta(id: string): TaskMeta | null {
        const task = this.cache.get(id);
        if (!task) return null;

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { input, output, error, ...meta } = task;
        return meta;
    }

    /**
     * Update task (sync API)
     */
    update<TInput = unknown, TOutput = unknown>(
        id: string,
        updates: Partial<Task<TInput, TOutput>>
    ): boolean {
        const task = this.cache.get(id);
        if (!task) return false;

        Object.assign(task, updates, { updatedAt: new Date() });

        // Persist to DB in background
        this.persistTask(task).catch(err => {
            console.error(`[TaskStore] Failed to update task ${id}:`, err);
        });

        return true;
    }

    /**
     * Delete task (sync API)
     */
    delete(id: string): boolean {
        const deleted = this.cache.delete(id);

        if (deleted) {
            // Delete from DB in background
            this.repository.delete(id).catch(err => {
                console.error(`[TaskStore] Failed to delete task ${id} from DB:`, err);
            });
        }

        return deleted;
    }

    /**
     * List tasks (sync API, cache-based)
     */
    list(filter?: {
        status?: TaskStatus | TaskStatus[];
        type?: string;
        limit?: number;
    }): Task[] {
        let tasks = Array.from(this.cache.values());

        // Filter by status
        if (filter?.status) {
            const statuses = Array.isArray(filter.status)
                ? filter.status
                : [filter.status];
            tasks = tasks.filter(t => statuses.includes(t.status));
        }

        // Filter by type
        if (filter?.type) {
            tasks = tasks.filter(t => t.type === filter.type);
        }

        // Sort by creation date (newest first)
        tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        // Apply limit
        if (filter?.limit) {
            tasks = tasks.slice(0, filter.limit);
        }

        return tasks;
    }

    /**
     * Cleanup old tasks (sync API)
     */
    cleanup(maxAge: number = 3600000): number {
        const now_ts = Date.now();
        const terminalStatuses = [Status.COMPLETED, Status.FAILED, Status.CANCELLED];

        let cleaned = 0;
        for (const [id, task] of this.cache.entries()) {
            if (
                terminalStatuses.includes(task.status) &&
                now_ts - task.updatedAt.getTime() > maxAge
            ) {
                this.cache.delete(id);
                cleaned++;

                // Delete from DB in background
                this.repository.delete(id).catch(err => {
                    console.error(`[TaskStore] Failed to cleanup task ${id}:`, err);
                });
            }
        }

        // Also trigger DB cleanup
        this.repository.cleanupOld(maxAge).catch(err => {
            console.error('[TaskStore] Failed to cleanup old tasks from DB:', err);
        });

        return cleaned;
    }

    /**
     * Persist task to database (background)
     */
    private async persistTask(task: Task): Promise<void> {
        try {
            const existing = await this.repository.findById(task.id);

            if (existing) {
                await this.repository.update(task.id, {
                    type: task.type,
                    status: task.status,
                    input: task.input,
                    output: task.output,
                    error: task.error,
                    updatedAt: task.updatedAt,
                    startedAt: task.startedAt,
                    completedAt: task.completedAt,
                } as any);
            } else {
                await this.repository.create({
                    id: task.id,
                    type: task.type,
                    status: task.status,
                    input: task.input,
                    output: task.output,
                    error: task.error,
                    createdAt: task.createdAt,
                    updatedAt: task.updatedAt,
                    startedAt: task.startedAt,
                    completedAt: task.completedAt,
                } as any);
            }
        } catch (error) {
            console.error('[TaskStore] Database persistence error:', error);
            throw error;
        }
    }

    /**
     * Map database task to kernel task
     */
    private mapToKernelTask(dbTask: any): Task {
        return {
            id: dbTask.id,
            type: dbTask.type,
            status: dbTask.status as TaskStatus,
            input: dbTask.input,
            output: dbTask.output,
            error: dbTask.error,
            createdAt: new Date(dbTask.createdAt),
            updatedAt: new Date(dbTask.updatedAt),
            startedAt: dbTask.startedAt ? new Date(dbTask.startedAt) : undefined,
            completedAt: dbTask.completedAt ? new Date(dbTask.completedAt) : undefined,
        };
    }
}
