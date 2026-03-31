/**
 * TaskOrchestrator - Wire Together Task System Components
 *
 * Integrates:
 * - TaskSystem (task creation, lifecycle)
 * - TaskQueueManager (per-provider queuing)
 * - TaskExecutor (provider execution)
 * - ChatManager (context loading)
 *
 * This is the main entry point for task operations with
 * full queue-based execution support.
 *
 * See: TASK_SYSTEM_SPECIFICATION.md Phase 2
 */

import type { DatabaseAccess } from '../../../db';
import type { Task as DbTask, TaskMetadata, MessageTaskResultData } from '../../../db/schema/task';
import type { MessageContent } from '../../../db/schema/message';
import type { ProviderRegistry } from '../../../infrastructure/ai-providers/registry';
import { getModelLoadCache, initializeModelLoadCache } from '../../../infrastructure/cache/model-load-cache';
import { TaskSystem, type MessageTaskSpec, type LoadTaskSpec, type TaskFilter, type TaskEvent, initializeTaskSystem } from '../task-system';
import { ChatManager, initializeChatManager, type CreateUserMessageInput } from '../chat-manager';
import { TaskQueueManager, initializeTaskQueueManager, type QueueStatus, type QueueConfig } from './task-queue-manager';
import { TaskExecutor, type ExecutorConfig, type ExecutionEvent, type ExecutionEventType } from './task-executor';
import { ChatTaskLock, initializeChatTaskLock } from '../chat-task-lock';
import { ChunkBuffer, initializeChunkBuffer } from './chunk-buffer';
import type { ToolDispatcher } from '../tools/tool-dispatcher';
import { LicenseUtil } from '../license-util';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  /** Queue configuration */
  queue?: Partial<QueueConfig>;
  /** Executor configuration */
  executor?: Partial<ExecutorConfig>;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Task creation result with queue info
 */
export interface TaskCreationResult {
  task: DbTask;
  queueStatus: QueueStatus;
  enqueuedImmediately: boolean;
}

const TERMINAL_EXECUTION_EVENTS = new Set<ExecutionEventType>([
  'task.completed',
  'task.failed',
  'task.cancelled',
]);

// ─── TaskOrchestrator Implementation ─────────────────────────────────────────

export class TaskOrchestrator {
  private taskSystem: TaskSystem;
  private chatManager: ChatManager;
  private queueManager: TaskQueueManager;
  private executor: TaskExecutor;
  private chatTaskLock: ChatTaskLock;
  private chunkBuffer: ChunkBuffer;
  private debug: boolean;

  constructor(
    private readonly db: DatabaseAccess,
    providerRegistry: ProviderRegistry,
    config?: OrchestratorConfig
  ) {
    this.debug = config?.debug ?? false;

    // Initialize components
    this.chatManager = initializeChatManager(db);
    this.taskSystem = initializeTaskSystem(db, this.chatManager);
    this.chatTaskLock = initializeChatTaskLock();

    // Initialize chunk buffer for time-based flushing
    this.chunkBuffer = initializeChunkBuffer(db, {
      flushIntervalMs: 1000, // 1 second flush interval
      debug: this.debug,
    });

    // Initialize model load cache with provider registry
    initializeModelLoadCache(providerRegistry as any);

    // Initialize queue manager
    this.queueManager = initializeTaskQueueManager({
      maxConcurrentPerProvider: config?.queue?.maxConcurrentPerProvider ?? 3,
      debug: config?.queue?.debug ?? this.debug,
    });

    // Initialize executor with chunk buffer
    this.executor = new TaskExecutor(
      db,
      providerRegistry,
      this.queueManager,
      getModelLoadCache(),
      this.chunkBuffer,
      {
        saveIntervalTokens: config?.executor?.saveIntervalTokens ?? 10,
        debug: config?.executor?.debug ?? this.debug,
        retryBaseDelayMs: config?.executor?.retryBaseDelayMs,
        retryMaxDelayMs: config?.executor?.retryMaxDelayMs,
        maxToolFollowupDepth: config?.executor?.maxToolFollowupDepth,
      }
    );
    this.executor.setFollowupTaskCreator(async (spec) => {
      await this.createMessageTask(spec);
    });

    // Wire up queue callback
    this.queueManager.onTaskReady(async (task) => {
      await this.executor.execute(task);
    });

    // Wire up executor events to task system
    this.executor.on((event) => {
      this.handleExecutorEvent(event);
    });

    this.log('Orchestrator initialized');
  }

  setToolDispatcher(toolDispatcher: ToolDispatcher): void {
    this.executor.setToolDispatcher(toolDispatcher);
  }

  // ─── Task Creation ─────────────────────────────────────────────────────

  /**
   * Create and queue a message task
   * Returns task with queue status
   *
   * Uses ChatTaskLock to serialize tasks per chat - only one MessageTask
   * can run per chat at a time. Others are queued internally.
   */
  async createMessageTask(spec: MessageTaskSpec): Promise<TaskCreationResult> {
    await LicenseUtil.enforceAllowed();

    // Create task via TaskSystem (handles context loading, dependencies)
    const task = await this.taskSystem.createMessageTask(spec);

    // If task is pending (no dependency), try chat lock
    let enqueuedImmediately = false;
    if (task.status === 'pending') {
      const canStart = this.chatTaskLock.tryAcquire(spec.chatId, task.id);

      if (canStart) {
        // Acquired lock, enqueue for execution
        await this.enqueueTask(task);
        enqueuedImmediately = true;
        this.log(`Task ${task.id} acquired chat lock for ${spec.chatId}`);
      } else {
        // Chat has active task, this one is queued in chat lock
        // Update task status to 'waiting' with chat_serialized reason
        await this.db.tasks.update(task.id, {
          status: 'waiting',
          metadata: {
            ...((task.metadata as Record<string, unknown>) ?? {}),
            waitReason: 'chat_serialized',
          },
        });
        this.log(`Task ${task.id} waiting for chat lock on ${spec.chatId}`);
      }
    }
    // If waiting (on dependency), reserve chat slot order so messages remain serialized
    if (task.status === 'waiting' && task.dependsOn && task.chatId) {
      this.ensureChatTaskQueued(task.chatId, task.id);
    }
    if (task.dependsOn) {
      await this.ensureLoadTaskQueued(task.dependsOn);
    }

    const queueStatus = this.queueManager.getQueueStatus(task.provider);

    return {
      task,
      queueStatus,
      enqueuedImmediately,
    };
  }

  /**
   * Create and queue a load task
   */
  async createLoadTask(spec: LoadTaskSpec): Promise<TaskCreationResult> {
    // Create task via TaskSystem (handles deduplication)
    const task = await this.taskSystem.createLoadTask(spec);

    // LoadTasks are created with status='queued', enqueue them
    if (task.status === 'queued') {
      this.enqueueTaskSync(task);
    }

    const queueStatus = this.queueManager.getQueueStatus(task.provider);

    return {
      task,
      queueStatus,
      enqueuedImmediately: true,
    };
  }

  // ─── Queue Management ──────────────────────────────────────────────────

  /**
   * Enqueue a task (transition pending→queued)
   */
  async enqueueTask(task: DbTask): Promise<void> {
    // Transition to queued in DB
    await this.db.tasks.update(task.id, {
      status: 'queued',
    });

    // Update local task object
    const queuedTask: DbTask = { ...task, status: 'queued' };

    // Add to queue
    this.queueManager.enqueue(queuedTask);

    // Trigger processing
    await this.queueManager.processQueue(task.provider);

    this.log(`Enqueued task ${task.id} for ${task.provider}`);
  }

  /**
   * Enqueue task synchronously (for already-queued tasks)
   */
  private enqueueTaskSync(task: DbTask): void {
    this.queueManager.enqueue(task);
    // Fire and forget queue processing
    this.queueManager.processQueue(task.provider).catch(err => {
      console.error('[TaskOrchestrator] Queue processing error:', err);
    });
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string, cascade = true): Promise<void> {
    // Get task to check if it's a message task
    const task = await this.db.tasks.findById(taskId);

    // Cancel via executor (if running)
    this.executor.cancel(taskId);

    // Remove from queue (if queued)
    this.queueManager.removeFromQueue(taskId);

    // Cancel via task system (handles DB + cascade)
    await this.taskSystem.cancelTask(taskId, cascade);

    // Release chat lock if this was a message task
    if (task && task.type === 'message' && task.chatId) {
      const nextTaskId = this.chatTaskLock.cancel(task.chatId, taskId);
      if (nextTaskId) {
        this.log(`Chat ${task.chatId} cancelled task, starting next task ${nextTaskId}`);
        await this.startChatQueuedTaskIfReady(task.chatId, nextTaskId);
      }
    }
  }

  /**
   * Retry a failed/paused task
   */
  async retryTask(taskId: string): Promise<void> {
    // Retry via task system (transitions to queued)
    await this.taskSystem.retryTask(taskId);

    // Get updated task and enqueue
    const task = await this.taskSystem.getTask(taskId);
    this.enqueueTaskSync(task);
  }

  // ─── Status Queries ────────────────────────────────────────────────────

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<DbTask> {
    return this.taskSystem.getTask(taskId);
  }

  /**
   * List tasks with filters
   */
  async listTasks(filters?: TaskFilter): Promise<DbTask[]> {
    return this.taskSystem.listTasks(filters);
  }

  /**
   * Get queue status for a provider
   */
  getQueueStatus(provider: string): QueueStatus {
    return this.queueManager.getQueueStatus(provider);
  }

  /**
   * Get queue status for all providers
   */
  getAllQueueStatus(): QueueStatus[] {
    return this.queueManager.getAllQueueStatus();
  }

  /**
   * Get total queued task count
   */
  getTotalQueuedCount(): number {
    return this.queueManager.getTotalQueuedCount();
  }

  /**
   * Get total active task count
   */
  getTotalActiveCount(): number {
    return this.queueManager.getTotalActiveCount();
  }

  // ─── Event Subscription ────────────────────────────────────────────────

  /**
   * Subscribe to task events
   */
  onTaskEvent(taskId: string, handler: (event: TaskEvent) => void): () => void {
    return this.taskSystem.on(taskId, handler);
  }

  /**
   * Subscribe to executor events
   */
  onExecutionEvent(handler: (event: ExecutionEvent) => void): () => void {
    return this.executor.on(handler);
  }

  /**
   * Get task dependency info (for tracking LoadTask dependencies)
   */
  async getTaskDependency(taskId: string): Promise<{ dependsOn: string | null; loadTaskId: string | null }> {
    const task = await this.db.tasks.findById(taskId);
    if (!task) {
      return { dependsOn: null, loadTaskId: null };
    }

    // If task has a dependency, check if it's a load task
    if (task.dependsOn) {
      const depTask = await this.db.tasks.findById(task.dependsOn);
      if (depTask && depTask.type === 'load') {
        return { dependsOn: task.dependsOn, loadTaskId: task.dependsOn };
      }
      return { dependsOn: task.dependsOn, loadTaskId: null };
    }

    return { dependsOn: null, loadTaskId: null };
  }

  /**
   * Get ChatManager instance (for context loading in StreamService)
   */
  getChatManager(): ChatManager {
    return this.chatManager;
  }

  /**
   * Create assistant message via ChatManager
   */
  async createAssistantMessage(chatId: string, input: {
    id?: string;
    content: string;
    taskId: string;
    provider: string;
    model: string;
    tokens?: any;
    metadata?: any;
    parentMessageId?: string;
  }) {
    return this.chatManager.createAssistantMessage(chatId, input);
  }

  /**
   * Create user message via ChatManager
   */
  async createUserMessage(chatId: string, input: CreateUserMessageInput) {
    return this.chatManager.createUserMessage(chatId, input);
  }

  /**
   * Get the active (non-completed) message task for a chat, if any
   * Returns the most recent task that is still in progress
   */
  async getActiveChatTask(chatId: string): Promise<DbTask | null> {
    // Find tasks that are still running for this chat
    const tasks = await this.db.tasks.findByStatus(['waiting', 'queued', 'running', 'streaming', 'paused']);

    // Filter by chatId and type
    const activeTasks = tasks.filter(task => {
      if (task.type !== 'message') return false;
      return task.chatId === chatId;
    });

    // Return most recent (first in list, assuming ordered by createdAt desc)
    return activeTasks[0] || null;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Resume tasks after application restart
   */
  async resumeTasksOnStartup(): Promise<void> {
    // Mark interrupted tasks as paused
    await this.taskSystem.resumeTasksOnStartup();

    // Restore chat locks in task creation order
    const messageTasks = await this.db.tasks.findByTypeAndStatus('message', [
      'pending',
      'waiting',
      'queued',
      'paused',
    ]);

    const sortedMessageTasks = [...messageTasks].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    for (const task of sortedMessageTasks) {
      if (task.chatId) {
        this.ensureChatTaskQueued(task.chatId, task.id);
      }
    }

    // Enqueue only the active task per chat (respecting dependency order)
    for (const task of sortedMessageTasks) {
      if (!task.chatId) continue;

      const activeTaskId = this.chatTaskLock.getActive(task.chatId);
      if (activeTaskId !== task.id) {
        const waitReason = task.dependsOn ? 'model_loading' : 'chat_serialized';
        const currentWaitReason = (task.metadata as TaskMetadata | null)?.waitReason;
        if (task.status !== 'waiting' || currentWaitReason !== waitReason) {
          await this.db.tasks.update(task.id, {
            status: 'waiting',
            metadata: {
              ...((task.metadata as Record<string, unknown>) ?? {}),
              waitReason,
            },
          });
        }
        continue;
      }

      if (task.dependsOn) {
        await this.db.tasks.update(task.id, {
          status: 'waiting',
          metadata: {
            ...((task.metadata as Record<string, unknown>) ?? {}),
            waitReason: 'model_loading',
          },
        });
        continue;
      }

      await this.startChatQueuedTask(task.chatId, task.id);
    }

    // Re-enqueue queued non-message tasks
    const queuedTasks = await this.db.tasks.findByStatus(['queued']);
    for (const task of queuedTasks) {
      if (task.type === 'message') continue;
      this.queueManager.enqueue(task);
    }

    // Re-enqueue paused non-message tasks that should retry
    const pausedTasks = await this.db.tasks.findByStatus(['paused']);
    for (const task of pausedTasks) {
      if (task.type === 'message') continue;
      if ((task.retryCount ?? 0) < (task.maxRetries ?? 3)) {
        // Check if dependency is resolved before re-enqueueing
        if (task.dependsOn) {
          const dep = await this.db.tasks.findById(task.dependsOn);
          if (dep && dep.status !== 'completed') {
            // Dependency not resolved - skip, will be enqueued when dep completes
            this.log(`Skipping paused task ${task.id} - dependency ${task.dependsOn} not resolved`);
            continue;
          }
        }
        await this.enqueueTask({ ...task, status: 'queued' });
      }
    }

    // Process all queues
    await this.queueManager.processAllQueues();

    this.log('Startup recovery complete');
  }

  /**
   * Shutdown orchestrator (clear queues, cancel active tasks)
   */
  async shutdown(): Promise<void> {
    this.log('Shutting down...');

    // Clear queues (don't start new tasks)
    this.queueManager.clear();

    // Clear chat locks
    this.chatTaskLock.clear();

    // Note: Active tasks will complete or be interrupted
    // They'll be recovered on next startup

    this.log('Shutdown complete');
  }

  /**
   * Get chat task lock status for debugging
   */
  getChatLockStatus(chatId: string) {
    return this.chatTaskLock.getStatus(chatId);
  }

  /**
   * Get all active chat locks
   */
  getActiveChats(): string[] {
    return this.chatTaskLock.getAllActiveChats();
  }

  // ─── Internal Event Handling ───────────────────────────────────────────

  private async handleExecutorEvent(event: ExecutionEvent): Promise<void> {
    if (!TERMINAL_EXECUTION_EVENTS.has(event.type)) {
      return;
    }

    const task = await this.db.tasks.findById(event.taskId);
    if (!task) {
      return;
    }

    switch (event.type) {
      case 'task.completed':
        if (task.type === 'load') {
          await this.resolveLoadDependencies(task.id);
        }

        if (task.type === 'message') {
          await this.ensureAssistantMessage(task);
          await this.releaseChatLockAndStartNext(task);
        }
        break;
      case 'task.failed':
        if (task.type === 'load') {
          await this.cancelLoadDependencies(task.id);
        } else if (Array.isArray(task.waitingTasks) && task.waitingTasks.length > 0) {
          await this.taskSystem.cascadeCancellation(task.waitingTasks, 'parent_failed');
        }

        if (task.type === 'message') {
          await this.releaseChatLockAndStartNext(task);
        }
        break;
      case 'task.cancelled':
        if (task.type === 'message') {
          await this.ensureAssistantMessage(task);
          await this.releaseChatLockAndStartNext(task);
        }
        break;
    }
  }

  private async resolveLoadDependencies(loadTaskId: string): Promise<void> {
    const waitingTasks = await this.db.tasks.findWaitingOn(loadTaskId);
    for (const waitingTask of waitingTasks) {
      if (waitingTask.type === 'message') {
        await this.startMessageTaskIfReady(waitingTask, { clearDependency: true });
        continue;
      }

      await this.db.tasks.update(waitingTask.id, { dependsOn: null });
      await this.enqueueTask({ ...waitingTask, dependsOn: null });
    }
  }

  private async ensureLoadTaskQueued(loadTaskId: string): Promise<void> {
    const loadTask = await this.db.tasks.findById(loadTaskId);
    if (!loadTask || loadTask.type !== 'load') {
      return;
    }

    if (loadTask.status === 'queued') {
      this.enqueueTaskSync(loadTask);
      return;
    }

    if (loadTask.status === 'pending') {
      await this.enqueueTask(loadTask);
      return;
    }

    if (loadTask.status === 'paused' && (loadTask.retryCount ?? 0) < (loadTask.maxRetries ?? 3)) {
      await this.taskSystem.retryTask(loadTask.id);
      const updated = await this.db.tasks.findById(loadTask.id);
      if (updated) {
        this.enqueueTaskSync(updated);
      }
    }
  }

  private async cancelLoadDependencies(loadTaskId: string): Promise<void> {
    const waitingTasks = await this.db.tasks.findWaitingOn(loadTaskId);
    if (waitingTasks.length === 0) {
      return;
    }

    await this.taskSystem.cascadeCancellation(
      waitingTasks.map(task => task.id),
      'parent_failed'
    );

    const affectedChats = new Set<string>();
    for (const waitingTask of waitingTasks) {
      if (!waitingTask.chatId) continue;
      affectedChats.add(waitingTask.chatId);
      this.chatTaskLock.cancel(waitingTask.chatId, waitingTask.id);
    }

    for (const chatId of affectedChats) {
      const activeTaskId = this.chatTaskLock.getActive(chatId);
      if (activeTaskId) {
        await this.startChatQueuedTaskIfReady(chatId, activeTaskId);
      }
    }
  }

  private async releaseChatLockAndStartNext(task: DbTask): Promise<void> {
    if (!task.chatId) {
      return;
    }

    const nextTaskId = this.chatTaskLock.release(task.chatId, task.id);
    if (nextTaskId) {
      this.log(`Chat ${task.chatId} released, starting next task ${nextTaskId}`);
      await this.startChatQueuedTaskIfReady(task.chatId, nextTaskId);
    }
  }

  private async startChatQueuedTaskIfReady(chatId: string, taskId: string): Promise<void> {
    const task = await this.db.tasks.findById(taskId);
    if (!task) {
      this.log(`Chat queued task ${taskId} not found`);
      return;
    }

    if (task.dependsOn) {
      await this.db.tasks.update(taskId, {
        status: 'waiting',
        metadata: {
          ...((task.metadata as Record<string, unknown>) ?? {}),
          waitReason: 'model_loading',
        },
      });
      return;
    }

    await this.startChatQueuedTask(chatId, taskId);
  }

  private async startMessageTaskIfReady(
    task: DbTask,
    options?: { clearDependency?: boolean }
  ): Promise<void> {
    if (!task.chatId) {
      if (options?.clearDependency) {
        await this.db.tasks.update(task.id, { dependsOn: null });
      }
      await this.enqueueTask({
        ...task,
        ...(options?.clearDependency ? { dependsOn: null } : {}),
      });
      return;
    }

    const activeTaskId = this.chatTaskLock.getActive(task.chatId);
    if (!activeTaskId) {
      this.chatTaskLock.tryAcquire(task.chatId, task.id);
      await this.startChatQueuedTask(task.chatId, task.id, options);
      return;
    }

    if (activeTaskId === task.id) {
      await this.startChatQueuedTask(task.chatId, task.id, options);
      return;
    }

    this.ensureChatTaskQueued(task.chatId, task.id);

    await this.db.tasks.update(task.id, {
      status: 'waiting',
      ...(options?.clearDependency ? { dependsOn: null } : {}),
      metadata: {
        ...((task.metadata as Record<string, unknown>) ?? {}),
        waitReason: 'chat_serialized',
      },
    });
  }

  private ensureChatTaskQueued(chatId: string, taskId: string): void {
    const activeTaskId = this.chatTaskLock.getActive(chatId);
    if (!activeTaskId) {
      this.chatTaskLock.tryAcquire(chatId, taskId);
      return;
    }

    if (activeTaskId === taskId) {
      return;
    }

    if (this.chatTaskLock.getPosition(chatId, taskId) === -1) {
      this.chatTaskLock.tryAcquire(chatId, taskId);
    }
  }

  private async ensureAssistantMessage(task: DbTask): Promise<void> {
    if (task.type !== 'message' || !task.chatId) {
      return;
    }

    const assistantMessageId = task.assistantMessageId;
    if (!assistantMessageId) {
      return;
    }

    const result = task.result as MessageTaskResultData | null;
    const resultData = result?.data as { content?: string } | undefined;
    let content = resultData?.content ?? '';

    if (!content && task.status === 'failed' && task.error?.message) {
      content = `Task failed: ${task.error.message}`;
    }

    const existingById = await this.db.messages.findById(assistantMessageId);

    const metadata: Record<string, unknown> | undefined =
      task.status === 'cancelled'
        ? { incomplete: true, cancelled: true }
        : task.status === 'failed'
          ? { error: task.error?.message || 'Task failed', incomplete: true }
          : undefined;

    if (existingById) {
      const existingContent = this.extractMessageText(existingById.content as MessageContent);
      const mergedContent = content ? `${existingContent}${content}` : existingContent;

      if (mergedContent !== existingContent || result?.tokensUsed || metadata) {
        await this.chatManager.updateAssistantMessage(assistantMessageId, {
          ...(mergedContent !== existingContent ? { content: mergedContent } : {}),
          ...(result?.tokensUsed ? { tokens: result.tokensUsed } : {}),
          ...(metadata ? { metadata } : {}),
        });
      }
      return;
    }

    if (!content) {
      return;
    }

    await this.chatManager.createAssistantMessage(task.chatId, {
      id: assistantMessageId,
      content,
      taskId: task.id,
      provider: task.provider,
      model: task.model,
      tokens: result?.tokensUsed,
      metadata,
    });
  }

  private extractMessageText(content: MessageContent): string {
    if (content.type === 'text') {
      return content.text ?? '';
    }
    if (content.type === 'multipart' && Array.isArray(content.parts)) {
      return content.parts
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');
    }
    return '';
  }

  /**
   * Start a task that was queued in chat lock
   */
  private async startChatQueuedTask(
    _chatId: string,
    taskId: string,
    options?: { clearDependency?: boolean }
  ): Promise<void> {
    void _chatId;
    const task = await this.db.tasks.findById(taskId);
    if (!task) {
      this.log(`Chat queued task ${taskId} not found`);
      return;
    }

    // Update status from waiting to pending, then enqueue
    const updates: Partial<DbTask> = {
      status: 'pending',
      metadata: {
        ...((task.metadata as Record<string, unknown>) ?? {}),
        waitReason: null,
      },
      ...(options?.clearDependency ? { dependsOn: null } : {}),
    };

    await this.db.tasks.update(taskId, updates);

    await this.enqueueTask({
      ...task,
      status: 'pending',
      ...(options?.clearDependency ? { dependsOn: null } : {}),
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private log(message: string): void {
    if (this.debug) {
      console.log(`[TaskOrchestrator] ${message}`);
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let orchestratorInstance: TaskOrchestrator | null = null;

export function initializeTaskOrchestrator(
  db: DatabaseAccess,
  providerRegistry: ProviderRegistry,
  config?: OrchestratorConfig
): TaskOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new TaskOrchestrator(db, providerRegistry, config);
  }
  return orchestratorInstance;
}

export function getTaskOrchestrator(): TaskOrchestrator {
  if (!orchestratorInstance) {
    throw new Error('TaskOrchestrator not initialized. Call initializeTaskOrchestrator() first.');
  }
  return orchestratorInstance;
}
