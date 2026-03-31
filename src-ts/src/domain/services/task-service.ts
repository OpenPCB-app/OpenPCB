import type { TaskManager } from '../../kernel/tasks/manager';
import type { Task as KernelTask, TaskMeta as KernelTaskMeta } from '../../kernel/tasks/types';
import { TaskStatus } from '../../kernel/tasks/types';
import type { Task, TaskMeta, TaskResult, TaskState } from '@shared/types';
import { NotFoundError, BusinessError } from '../../core/errors';

/**
 * Task filter options (re-exported from kernel)
 */
export interface TaskFilter {
    state?: string | string[];
    type?: string;
    chatId?: string;
    provider?: string;
    activeOnly?: boolean;
    limit?: number;
}

/**
 * Retry result
 */
export interface RetryResult {
    status: string;
    retryCount: number;
}

/**
 * TaskService interface
 * See: TASK_SYSTEM_SPECIFICATION.md Section 10.1
 */
export interface ITaskService {
    list(filter?: TaskFilter): TaskMeta[];
    get<TInput = unknown>(id: string): Task<TInput, TaskResult>;
    getMeta(id: string): TaskMeta;
    cancel(id: string): boolean;
    retry(id: string): Promise<RetryResult>;
    cleanup(): void;
}

/**
 * TaskService - Task lifecycle business logic
 * Wraps TaskManager with error handling and maps to shared types
 */
export class TaskService implements ITaskService {
    constructor(private taskManager: TaskManager) { }

    /**
     * List tasks matching filter
     */
    list(filter: TaskFilter = {}): TaskMeta[] {
        const kernelTasks = this.taskManager.list(filter);
        return kernelTasks.map((task) => this.mapToSharedMeta(task, task.input as Record<string, unknown>));
    }

    /**
     * Get task by ID
     * @throws NotFoundError if task doesn't exist
     */
    get<TInput = unknown>(id: string): Task<TInput, TaskResult> {
        const task = this.taskManager.get<TInput>(id);
        if (!task) {
            throw new NotFoundError('Task', id);
        }
        return this.mapToSharedTask(task);
    }

    /**
     * Get task metadata
     * @throws NotFoundError if task doesn't exist
     */
    getMeta(id: string): TaskMeta {
        const meta = this.taskManager.getMeta(id);
        if (!meta) {
            throw new NotFoundError('Task', id);
        }
        return this.mapToSharedMeta(meta);
    }

    /**
     * Cancel task
     * @throws NotFoundError if task doesn't exist
     * @throws BusinessError if task cannot be cancelled (wrong state)
     */
    cancel(id: string): boolean {
        const meta = this.taskManager.getMeta(id);
        if (!meta) {
            throw new NotFoundError('Task', id);
        }

        // Check if cancellable - all active/pending states can be cancelled
        const cancellableStates = [
            TaskStatus.PENDING,
            TaskStatus.QUEUED,
            TaskStatus.WAITING,
            TaskStatus.RUNNING,
            TaskStatus.STREAMING,
            TaskStatus.PAUSED,
        ];

        if (!cancellableStates.includes(meta.status)) {
            throw new BusinessError(
                `Cannot cancel task in state: ${meta.status}`,
                { taskId: id, state: meta.status }
            );
        }

        const cancelled = this.taskManager.cancel(id);
        if (!cancelled) {
            throw new BusinessError(
                `Failed to cancel task ${id}`,
                { taskId: id }
            );
        }

        return true;
    }

    /**
     * Retry a failed or paused task
     * See: TASK_SYSTEM_SPECIFICATION.md Section 10.1
     *
     * NOTE: Manual retry from API is not yet fully implemented.
     * Automatic retry on transient errors is handled by TaskExecutor.
     * This endpoint validates the task state and returns intent to retry.
     *
     * @throws NotFoundError if task doesn't exist
     * @throws BusinessError if task cannot be retried or retry not supported
     */
    async retry(id: string): Promise<RetryResult> {
        const meta = this.taskManager.getMeta(id);
        if (!meta) {
            throw new NotFoundError('Task', id);
        }

        // Check if retryable (only failed/cancelled tasks)
        if (meta.status !== TaskStatus.FAILED &&
            meta.status !== TaskStatus.CANCELLED) {
            throw new BusinessError(
                `Cannot retry task in state: ${meta.status}`,
                { taskId: id, state: meta.status }
            );
        }

        // TODO: Implement full manual retry by resetting task status to PENDING
        // and re-enqueuing to TaskOrchestrator. Current limitation: TaskManager
        // doesn't expose a method to reset task state for re-execution.
        // For now, return acknowledgment that retry was requested.

        // Get full task to check retry count if available
        const task = this.taskManager.get(id);
        const currentRetryCount = (task as any)?.retryCount ?? 0;

        return {
            status: 'pending', // Intent to retry (not yet re-queued)
            retryCount: currentRetryCount + 1,
        };
    }

    /**
     * Cleanup old completed tasks
     */
    cleanup(): void {
        this.taskManager.cleanup();
    }

    // =========================================================================
    // Mappers
    // =========================================================================

    private mapToSharedMeta(meta: KernelTaskMeta, input?: Record<string, unknown>): TaskMeta {
        // Extract optional fields from input if available (for MessageTask)
        const chatId = input?.chatId as string | undefined;
        const provider = input?.provider as string | undefined;
        const model = input?.model as string | undefined;

        return {
            id: meta.id,
            type: meta.type as TaskMeta['type'],
            state: meta.status as unknown as TaskState,
            createdAt: new Date(meta.createdAt).toISOString(),
            startedAt: meta.startedAt ? new Date(meta.startedAt).toISOString() : undefined,
            completedAt: meta.completedAt ? new Date(meta.completedAt).toISOString() : undefined,
            // Optional fields from task input (if provided)
            chatId,
            provider,
            model,
        };
    }

    private mapToSharedTask<TInput>(task: KernelTask<TInput>): Task<TInput, TaskResult> {
        return {
            meta: this.mapToSharedMeta(task, task.input as Record<string, unknown>),
            input: task.input,
            result: task.output as TaskResult | undefined,
            error: task.error
        };
    }
}
