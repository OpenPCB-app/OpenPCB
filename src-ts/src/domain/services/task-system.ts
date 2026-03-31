/**
 * TaskSystem - AI Task Management System Orchestration
 *
 * Core orchestrator for AI task lifecycle management:
 * - Task creation with dependency handling
 * - State transitions following state machine
 * - Model load deduplication
 * - Task queue management
 * - Error recovery and retry logic
 *
 * See: TASK_SYSTEM_SPECIFICATION.md Section 5.2
 */

import type { DatabaseAccess } from '../../db';
import type { Task as DbTask, TaskStatus, TaskType, TaskResultData, TaskMetadata, MessagePayload, LoadPayload, TaskError } from '../../db/schema/task';
import { isTerminalStatus, isValidTransition } from '../../db/schema/task';
import type { ChatManager } from './chat-manager';
import { NotFoundError, BusinessError } from '../../core/errors';
import { generateUUIDv7 } from '../../db/schema/base';
import { getModelLoadCache, type ModelLoadCache } from '../../infrastructure/cache/model-load-cache';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Specification for creating a MessageTask
 */
export interface MessageTaskSpec {
  chatId: string;
  provider: string;
  model: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  priority?: number;
  providerOptions?: Record<string, unknown>;
  workspaceId?: string;
  projectId?: string;
  assistantMessageId: string;
  tools?: MessagePayload["tools"];
  toolChoice?: MessagePayload["toolChoice"];
  activeContext?: MessagePayload["activeContext"];
  allowedTools?: string[];
}

/**
 * Specification for creating a LoadTask
 */
export interface LoadTaskSpec {
  provider: string;
  model: string;
  modelPath?: string;
  loadOptions?: Record<string, unknown>;
  priority?: number;
}

/**
 * Task filter criteria
 */
export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  type?: TaskType;
  provider?: string;
  chatId?: string;
  limit?: number;
}

/**
 * Task event types
 */
export type TaskEventType =
  | 'task.created'
  | 'task.queued'
  | 'task.started'
  | 'task.streaming'
  | 'task.paused'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'task.progress';

export interface TaskEvent {
  type: TaskEventType;
  taskId: string;
  status: TaskStatus;
  data?: unknown;
  timestamp: string;
}

/**
 * ITaskSystem interface following spec Section 5.2
 */
export interface ITaskSystem {
  // Task creation (with chat context loading)
  createMessageTask(spec: MessageTaskSpec): Promise<DbTask>;
  createLoadTask(spec: LoadTaskSpec): Promise<DbTask>;

  // Lifecycle management
  startTask(taskId: string): Promise<void>;
  pauseTask(taskId: string, reason: string): Promise<void>;
  cancelTask(taskId: string, cascade?: boolean): Promise<void>;
  retryTask(taskId: string): Promise<void>;

  // State queries
  getTask(taskId: string): Promise<DbTask>;
  listTasks(filters?: TaskFilter): Promise<DbTask[]>;

  // Event handlers
  onTaskComplete(task: DbTask, result: TaskResultData): Promise<void>;
  onTaskFailed(task: DbTask, error: TaskError): Promise<void>;

  // Dependency resolution
  resolveDependency(parentTaskId: string, result: TaskResultData): Promise<void>;
  cascadeCancellation(taskIds: string[], reason: string): Promise<void>;
}

// ─── TaskSystem Implementation ───────────────────────────────────────────────

export class TaskSystem implements ITaskSystem {
  private eventHandlers = new Map<string, Set<(event: TaskEvent) => void>>();
  private readonly modelLoadCache: ModelLoadCache;

  constructor(
    private readonly db: DatabaseAccess,
    private readonly chatManager: ChatManager
  ) {
    this.modelLoadCache = getModelLoadCache();
  }

  // ─── Task Creation ─────────────────────────────────────────────────────

  /**
   * Create a MessageTask with full conversation context
   *
   * CRITICAL: This method loads all previous messages in the chat
   * and includes them in the task payload for the provider.
   */
  async createMessageTask(spec: MessageTaskSpec): Promise<DbTask> {
    if (!spec.assistantMessageId || spec.assistantMessageId.trim().length === 0) {
      throw new BusinessError("assistantMessageId is required for message tasks");
    }

    // 1. Load complete chat context (CRITICAL)
    const messages = await this.chatManager.loadChatContext(spec.chatId);

    // 2. Check if model requires loading
    const needsLoading = await this.requiresModelLoading(spec.provider);
    let dependsOn: string | null = null;

    if (needsLoading) {
      // Check if model is already loaded (uses TTL cache)
      const isLoaded = await this.modelLoadCache.isLoaded(spec.provider, spec.model);

      if (!isLoaded) {
        // Check for existing LoadTask or create one
        const loadTaskId = await this.ensureModelLoaded(spec.provider, spec.model);
        if (loadTaskId) {
          dependsOn = loadTaskId;
        }
      }
    }

    // 3. Build message payload with full context
    const payload: MessagePayload = {
      chatId: spec.chatId,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        tool_call_id: m.tool_call_id,
      })),
      userMessage: spec.userMessage,
      temperature: spec.temperature,
      maxTokens: spec.maxTokens,
      topP: spec.topP,
      stream: true, // Always stream per spec
      providerOptions: spec.providerOptions,
      tools: spec.tools,
      toolChoice: spec.toolChoice,
      activeContext: spec.activeContext,
      allowedTools: spec.allowedTools,
    };

    // 4. Create task with appropriate status
    const initialStatus: TaskStatus = dependsOn ? 'waiting' : 'pending';
    const metadata: TaskMetadata | null = dependsOn
      ? { waitReason: 'model_loading' }
      : null;

    const task = await this.db.tasks.create({
      id: generateUUIDv7(),
      type: 'message',
      status: initialStatus,
      priority: spec.priority ?? 5,
      provider: spec.provider,
      model: spec.model,
      chatId: spec.chatId,
      dependsOn,
      waitingTasks: [],
      payload,
      retryCount: 0,
      maxRetries: 3,
      workspaceId: spec.workspaceId ?? null,
      projectId: spec.projectId ?? null,
      assistantMessageId: spec.assistantMessageId,
      metadata,
    });

    // 5. If waiting on LoadTask, register with parent
    if (dependsOn) {
      await this.db.tasks.addWaitingTask(dependsOn, task.id);
    }

    // 6. Emit creation event
    this.emit(task.id, {
      type: 'task.created',
      taskId: task.id,
      status: initialStatus,
      data: { chatId: spec.chatId, dependsOn },
      timestamp: new Date().toISOString(),
    });

    console.log(`[TaskSystem] Created MessageTask ${task.id} (status: ${initialStatus}, dependsOn: ${dependsOn})`);

    return task;
  }

  /**
   * Create a LoadTask for model loading
   */
  async createLoadTask(spec: LoadTaskSpec): Promise<DbTask> {
    // Check for existing LoadTask (deduplication)
    const existingTask = await this.db.tasks.findLoadTask(spec.provider, spec.model);
    if (existingTask) {
      console.log(`[TaskSystem] Reusing existing LoadTask ${existingTask.id}`);
      return existingTask;
    }

    // Build load payload
    const payload: LoadPayload = {
      modelPath: spec.modelPath || spec.model,
      targetProvider: spec.provider,
      loadOptions: spec.loadOptions,
    };

    // Create task with high priority (LoadTasks are prioritized)
    const task = await this.db.tasks.create({
      id: generateUUIDv7(),
      type: 'load',
      status: 'queued', // LoadTasks go directly to queue
      priority: spec.priority ?? 10, // High priority per spec
      provider: spec.provider,
      model: spec.model,
      chatId: null,
      dependsOn: null,
      waitingTasks: [],
      payload,
      retryCount: 0,
      maxRetries: 3,
      workspaceId: null,
      projectId: null,
    });

    this.emit(task.id, {
      type: 'task.queued',
      taskId: task.id,
      status: 'queued',
      timestamp: new Date().toISOString(),
    });

    console.log(`[TaskSystem] Created LoadTask ${task.id} for ${spec.provider}:${spec.model}`);

    return task;
  }

  // ─── Lifecycle Management ──────────────────────────────────────────────

  /**
   * Start task execution (transition to running)
   */
  async startTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);

    if (!isValidTransition(task.status, 'running')) {
      throw new BusinessError(`Cannot start task in ${task.status} state`);
    }

    await this.db.tasks.update(taskId, {
      status: 'running',
      startedAt: new Date(),
    });

    this.emit(taskId, {
      type: 'task.started',
      taskId,
      status: 'running',
      timestamp: new Date().toISOString(),
    });

    console.log(`[TaskSystem] Started task ${taskId}`);
  }

  /**
   * Pause task for retry (transition to paused)
   */
  async pauseTask(taskId: string, reason: string): Promise<void> {
    const task = await this.getTask(taskId);

    if (!isValidTransition(task.status, 'paused')) {
      throw new BusinessError(`Cannot pause task in ${task.status} state`);
    }

    const metadata: TaskMetadata = {
      ...(task.metadata as TaskMetadata || {}),
      progressStage: 'paused',
    };

    await this.db.tasks.update(taskId, {
      status: 'paused',
      metadata,
    });

    this.emit(taskId, {
      type: 'task.paused',
      taskId,
      status: 'paused',
      data: { reason },
      timestamp: new Date().toISOString(),
    });

    console.log(`[TaskSystem] Paused task ${taskId}: ${reason}`);
  }

  /**
   * Cancel task (with optional cascade to waiting tasks)
   */
  async cancelTask(taskId: string, cascade = true): Promise<void> {
    const task = await this.getTask(taskId);

    if (isTerminalStatus(task.status)) {
      return;
    }

    const metadata: TaskMetadata = {
      ...(task.metadata as TaskMetadata || {}),
      cancelled: true,
      cancelReason: 'user_cancelled',
    };

    await this.db.tasks.update(taskId, {
      status: 'cancelled',
      completedAt: new Date(),
      metadata,
    });

    this.emit(taskId, {
      type: 'task.cancelled',
      taskId,
      status: 'cancelled',
      timestamp: new Date().toISOString(),
    });

    console.log(`[TaskSystem] Cancelled task ${taskId}`);

    // Cascade cancellation to waiting tasks
    if (cascade && task.waitingTasks && (task.waitingTasks as string[]).length > 0) {
      await this.cascadeCancellation(task.waitingTasks as string[], 'parent_cancelled');
    }
  }

  /**
   * Retry a failed/paused task
   */
  async retryTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);

    if (!isValidTransition(task.status, 'queued')) {
      throw new BusinessError(`Cannot retry task in ${task.status} state`);
    }

    const retryCount = (task.retryCount ?? 0) + 1;
    if (retryCount > (task.maxRetries ?? 3)) {
      throw new BusinessError(`Task ${taskId} has exceeded maximum retries`);
    }

    await this.db.tasks.update(taskId, {
      status: 'queued',
      retryCount,
    });

    this.emit(taskId, {
      type: 'task.queued',
      taskId,
      status: 'queued',
      data: { retryCount },
      timestamp: new Date().toISOString(),
    });

    console.log(`[TaskSystem] Retrying task ${taskId} (attempt ${retryCount})`);
  }

  // ─── State Queries ─────────────────────────────────────────────────────

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<DbTask> {
    const task = await this.db.tasks.findById(taskId);
    if (!task) {
      throw new NotFoundError('Task', taskId);
    }
    return task;
  }

  /**
   * List tasks with optional filters
   */
  async listTasks(filters?: TaskFilter): Promise<DbTask[]> {
    if (!filters) {
      return this.db.tasks.findAll(100);
    }

    if (filters.provider && filters.status) {
      return this.db.tasks.findByProviderAndStatus(
        filters.provider,
        Array.isArray(filters.status) ? filters.status : [filters.status],
        filters.limit
      );
    }

    if (filters.type && filters.status) {
      return this.db.tasks.findByTypeAndStatus(
        filters.type,
        Array.isArray(filters.status) ? filters.status : [filters.status],
        filters.limit
      );
    }

    if (filters.status) {
      return this.db.tasks.findByStatus(
        Array.isArray(filters.status) ? filters.status : [filters.status],
        filters.limit
      );
    }

    if (filters.type) {
      return this.db.tasks.findByType(filters.type, filters.limit);
    }

    return this.db.tasks.findAll(filters.limit || 100);
  }

  // ─── Event Handlers ────────────────────────────────────────────────────

  /**
   * Handle task completion
   */
  async onTaskComplete(task: DbTask, result: TaskResultData): Promise<void> {
    await this.db.tasks.update(task.id, {
      status: 'completed',
      result,
      completedAt: new Date(),
    });

    this.emit(task.id, {
      type: 'task.completed',
      taskId: task.id,
      status: 'completed',
      data: result,
      timestamp: new Date().toISOString(),
    });

    console.log(`[TaskSystem] Task ${task.id} completed`);

    // If this is a LoadTask, resolve dependencies
    if (task.type === 'load') {
      await this.resolveDependency(task.id, result);

      // Mark model as loaded in cache
      this.modelLoadCache.markLoaded(task.provider, task.model);
    }
  }

  /**
   * Handle task failure
   */
  async onTaskFailed(task: DbTask, error: TaskError): Promise<void> {
    const metadata: TaskMetadata = {
      ...(task.metadata as TaskMetadata || {}),
      error,
    };

    await this.db.tasks.update(task.id, {
      status: 'failed',
      error,
      metadata,
      completedAt: new Date(),
    });

    this.emit(task.id, {
      type: 'task.failed',
      taskId: task.id,
      status: 'failed',
      data: error,
      timestamp: new Date().toISOString(),
    });

    console.error(`[TaskSystem] Task ${task.id} failed: ${error.message}`);

    // Cancel waiting tasks (cascade)
    if (task.waitingTasks && (task.waitingTasks as string[]).length > 0) {
      await this.cascadeCancellation(task.waitingTasks as string[], 'parent_failed');
    }
  }

  // ─── Dependency Resolution ─────────────────────────────────────────────

  /**
   * Resolve dependency when parent task completes
   */
  async resolveDependency(parentTaskId: string, _result: TaskResultData): Promise<void> {
    void _result;
    // Find all tasks waiting on this parent
    const waitingTasks = await this.db.tasks.findWaitingOn(parentTaskId);

    console.log(`[TaskSystem] Resolving ${waitingTasks.length} tasks waiting on ${parentTaskId}`);

    for (const task of waitingTasks) {
      // Transition from 'waiting' to 'queued'
      await this.db.tasks.update(task.id, {
        status: 'queued',
        dependsOn: null, // Clear dependency
      });

      this.emit(task.id, {
        type: 'task.queued',
        taskId: task.id,
        status: 'queued',
        data: { resolvedFrom: parentTaskId },
        timestamp: new Date().toISOString(),
      });

      console.log(`[TaskSystem] Task ${task.id} now queued (dependency resolved)`);
    }
  }

  /**
   * Cancel multiple tasks (cascade from parent)
   */
  async cascadeCancellation(taskIds: string[], reason: string): Promise<void> {
    console.log(`[TaskSystem] Cascade cancellation for ${taskIds.length} tasks: ${reason}`);

    for (const taskId of taskIds) {
      try {
        const task = await this.db.tasks.findById(taskId);
        if (!task || isTerminalStatus(task.status)) {
          continue;
        }

        const metadata: TaskMetadata = {
          ...(task.metadata as TaskMetadata || {}),
          cancelled: true,
          cancelReason: reason,
        };

        await this.db.tasks.update(taskId, {
          status: 'cancelled',
          completedAt: new Date(),
          metadata,
        });

        this.emit(taskId, {
          type: 'task.cancelled',
          taskId,
          status: 'cancelled',
          data: { reason },
          timestamp: new Date().toISOString(),
        });

        // Recursively cancel any tasks waiting on this one
        if (task.waitingTasks && (task.waitingTasks as string[]).length > 0) {
          await this.cascadeCancellation(task.waitingTasks as string[], reason);
        }
      } catch (err) {
        console.error(`[TaskSystem] Failed to cancel task ${taskId}:`, err);
      }
    }
  }

  // ─── Model Loading Helpers ─────────────────────────────────────────────

  /**
   * Check if provider requires model loading
   */
  private async requiresModelLoading(provider: string): Promise<boolean> {
    // Server and local providers require model loading
    const loadingProviders = ['ollama', 'lmstudio', 'local', 'llamacpp', 'mlx'];
    return loadingProviders.includes(provider.toLowerCase());
  }

  /**
   * Ensure model is loaded, return LoadTask ID if one was created
   */
  private async ensureModelLoaded(provider: string, model: string): Promise<string | null> {
    // Check if already loaded (uses TTL cache)
    const isLoaded = await this.modelLoadCache.isLoaded(provider, model);
    if (isLoaded) {
      return null;
    }

    // Check for existing LoadTask
    const existingTask = await this.db.tasks.findLoadTask(provider, model);
    if (existingTask) {
      return existingTask.id;
    }

    // Create new LoadTask
    const loadTask = await this.createLoadTask({
      provider,
      model,
      priority: 10,
    });

    return loadTask.id;
  }

  // ─── Event System ──────────────────────────────────────────────────────

  /**
   * Subscribe to task events
   */
  on(taskId: string, handler: (event: TaskEvent) => void): () => void {
    let handlers = this.eventHandlers.get(taskId);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(taskId, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers?.delete(handler);
      if (handlers?.size === 0) {
        this.eventHandlers.delete(taskId);
      }
    };
  }

  /**
   * Emit task event
   */
  private emit(taskId: string, event: TaskEvent): void {
    const handlers = this.eventHandlers.get(taskId);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(event);
        } catch (err) {
          console.error('[TaskSystem] Event handler error:', err);
        }
      });
    }
  }

  // ─── Crash Recovery ────────────────────────────────────────────────────

  /**
   * Resume tasks after application restart
   * Called during initialization
   */
  async resumeTasksOnStartup(): Promise<void> {
    console.log('[TaskSystem] Checking for tasks to resume...');

    // Find all non-terminal tasks
    const activeTasks = await this.db.tasks.findRunning();

    for (const task of activeTasks) {
      // Running tasks should be marked as paused (interrupted by crash)
      if (task.status === 'running' || task.status === 'streaming') {
        const metadata: TaskMetadata = {
          ...(task.metadata as TaskMetadata || {}),
          resumedAfterCrash: true,
        };

        await this.db.tasks.update(task.id, {
          status: 'paused',
          retryCount: (task.retryCount ?? 0) + 1,
          metadata,
        });

        console.log(`[TaskSystem] Marked task ${task.id} as paused (interrupted by shutdown)`);
      }
    }

    console.log(`[TaskSystem] Startup recovery complete. Found ${activeTasks.length} tasks.`);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let taskSystemInstance: TaskSystem | null = null;

export function initializeTaskSystem(db: DatabaseAccess, chatManager: ChatManager): TaskSystem {
  if (!taskSystemInstance) {
    taskSystemInstance = new TaskSystem(db, chatManager);
  }
  return taskSystemInstance;
}

export function getTaskSystem(): TaskSystem {
  if (!taskSystemInstance) {
    throw new Error('TaskSystem not initialized. Call initializeTaskSystem() first.');
  }
  return taskSystemInstance;
}
