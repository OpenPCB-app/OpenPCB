/**
 * Task Types and Interfaces
 *
 * Defines the core types for the task management system.
 * Tasks represent async background operations with lifecycle tracking.
 *
 * Enhanced for AI Task Management System:
 * - Additional states: queued, waiting, paused
 * - Task types: message, load, embedding
 *
 * See: TASK_SYSTEM_SPECIFICATION.md
 */

/**
 * Task status enum
 *
 * Lifecycle:
 * - pending: Created, not yet queued
 * - queued: In provider queue, waiting for slot
 * - waiting: Blocked by dependency (e.g., LoadTask)
 * - running: Actively executing
 * - streaming: Receiving token stream
 * - paused: Temporarily halted for retry
 * - completed: Successfully finished
 * - failed: Permanently failed
 * - cancelled: User cancelled
 */
export enum TaskStatus {
    PENDING = 'pending',
    QUEUED = 'queued',
    WAITING = 'waiting',
    RUNNING = 'running',
    STREAMING = 'streaming',
    PAUSED = 'paused',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled',
}

/**
 * Task types
 */
export enum TaskType {
    MESSAGE = 'message',    // Chat completion with conversation context
    LOAD = 'load',          // Model loading for server/local providers
    EMBEDDING = 'embedding', // Generate embeddings
    CONTENT_EDIT = 'content_edit', // AI-powered content editing
    CHAT = 'chat',          // Legacy (use MESSAGE)
    COMPLETION = 'completion', // Legacy
}

/**
 * Task metadata - lightweight task information
 */
export interface TaskMeta {
    /** Unique task identifier */
    id: string;
    /** Task type/category */
    type: string;
    /** Current task status */
    status: TaskStatus;
    /** Task creation timestamp */
    createdAt: Date;
    /** Last update timestamp */
    updatedAt: Date;
    /** Task start timestamp (when moved to RUNNING) */
    startedAt?: Date;
    /** Task completion timestamp (COMPLETED/FAILED/CANCELLED) */
    completedAt?: Date;
}

/**
 * Full task with input and output data
 */
export interface Task<TInput = unknown, TOutput = unknown> extends TaskMeta {
    /** Task input data */
    input: TInput;
    /** Task output data (if completed successfully) */
    output?: TOutput;
    /** Error information (if failed) */
    error?: {
        message: string;
        code: string;
        stack?: string;
    };
}

/**
 * Task event for streaming progress updates
 */
export interface TaskEvent {
    /** Task ID this event belongs to */
    taskId: string;
    /** Event type */
    type: 'progress' | 'data' | 'error' | 'complete';
    /** Event payload */
    payload: unknown;
    /** Event timestamp */
    timestamp: Date;
}
