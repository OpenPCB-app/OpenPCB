/**
 * TaskExecutor - Execute Tasks via Provider Engines
 *
 * Handles task execution lifecycle:
 * - Transitions task to running/streaming
 * - Calls provider engine (chat/stream)
 * - Handles streaming callbacks
 * - Saves results/errors
 * - Notifies completion
 *
 * See: TASK_SYSTEM_SPECIFICATION.md Section 5.2
 */

import type { DatabaseAccess } from '../../../db';
import type { Task, TaskStatus, TaskResultData, TaskError, MessagePayload, LoadPayload, MessageTaskResultData, LoadTaskResultData, TokenChunk, TaskMetadata } from '../../../db/schema/task';
import type { ChatRequest, ChatResult, StreamCallbacks } from '../../../infrastructure/ai-providers/engine';
import type { ProviderRegistry } from '../../../infrastructure/ai-providers/registry';
import type { TaskQueueManager } from './task-queue-manager';
import type { ModelLoadCache } from '../../../infrastructure/cache/model-load-cache';
import type { ChunkBuffer } from './chunk-buffer';
import type { KernelMessage } from '@shared/types';
import type { MessageTaskSpec } from '../task-system';
import type { ToolDispatcher, ToolExecutionResult } from '../tools/tool-dispatcher';
import { generateUUIDv7 } from '../../../db/schema/base';
import { EDIT_CONTENT_ALIASES } from '../tools/edit-content-tool';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Task execution result for event emission
 */
export interface ExecutionResult {
  taskId: string;
  status: TaskStatus;
  result?: TaskResultData;
  error?: TaskError;
}

/**
 * Execution event types
 */
export type ExecutionEventType =
  | 'task.started'
  | 'task.streaming'
  | 'task.token'
  | 'task.reasoning'
  | 'task.tool_call'
  | 'task.tool_result'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled';

export interface ExecutionEvent {
  type: ExecutionEventType;
  taskId: string;
  data?: unknown;
  timestamp: string;
}

/**
 * Executor configuration
 */
export interface ExecutorConfig {
  /** Save partial results every N tokens (default: 10) */
  saveIntervalTokens: number;
  /** Enable detailed logging */
  debug: boolean;
  /** Base delay before retrying a paused task (default: 1000ms) */
  retryBaseDelayMs: number;
  /** Maximum delay before retrying a paused task (default: 30000ms) */
  retryMaxDelayMs: number;
  /** Maximum tool follow-up depth per user turn (default: 6) */
  maxToolFollowupDepth: number;
}

interface ToolCallPlan {
  toolCall: NonNullable<ChatResult['toolCalls']>[number];
  resultSeq: number;
}

// ─── TaskExecutor Implementation ─────────────────────────────────────────────

export class TaskExecutor {
  private static readonly EDIT_CONTENT_ALIASES = EDIT_CONTENT_ALIASES;
  private abortControllers = new Map<string, AbortController>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private config: ExecutorConfig;
  private toolDispatcher?: ToolDispatcher;
  private createFollowupTask?: (spec: MessageTaskSpec) => Promise<void>;

  /** Event listeners */
  private eventListeners = new Set<(event: ExecutionEvent) => void>();

  constructor(
    private readonly db: DatabaseAccess,
    private readonly providerRegistry: ProviderRegistry,
    private readonly queueManager: TaskQueueManager,
    private readonly modelLoadCache: ModelLoadCache,
    private readonly chunkBuffer?: ChunkBuffer,
    config?: Partial<ExecutorConfig>
  ) {
    this.config = {
      saveIntervalTokens: config?.saveIntervalTokens ?? 10,
      debug: config?.debug ?? false,
      retryBaseDelayMs: config?.retryBaseDelayMs ?? 1000,
      retryMaxDelayMs: config?.retryMaxDelayMs ?? 30000,
      maxToolFollowupDepth: config?.maxToolFollowupDepth ?? 6,
    };
  }

  // ─── Event System ──────────────────────────────────────────────────────

  /**
   * Subscribe to execution events
   */
  on(listener: (event: ExecutionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  setToolDispatcher(toolDispatcher: ToolDispatcher): void {
    this.toolDispatcher = toolDispatcher;
  }

  setFollowupTaskCreator(createFollowupTask: (spec: MessageTaskSpec) => Promise<void>): void {
    this.createFollowupTask = createFollowupTask;
  }

  private emit(event: ExecutionEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[TaskExecutor] Event listener error:', err);
      }
    }
  }

  // ─── Task Execution ────────────────────────────────────────────────────

  /**
   * Execute a task (main entry point)
   * Called by TaskQueueManager.onTaskReady callback
   */
  async execute(task: Task): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Create abort controller for cancellation
      const abortController = new AbortController();
      this.abortControllers.set(task.id, abortController);

      // Transition to running
      await this.transitionToRunning(task);

      // Execute based on task type
      let result: ExecutionResult;

      switch (task.type) {
        case 'message':
        case 'chat':
        case 'completion':
          result = await this.executeMessageTask(task, abortController.signal, startTime);
          break;
        case 'load':
          result = await this.executeLoadTask(task, startTime);
          break;
        case 'embedding':
          result = await this.executeEmbeddingTask(task, startTime);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }

      return result;
    } catch (err) {
      // Check if task was cancelled (AbortError or signal aborted)
      const controller = this.abortControllers.get(task.id);
      const isAborted = controller?.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError');

      if (isAborted) {
        // Handle as cancellation, not error
        return this.handleCancellation(task, '', [], startTime);
      }
      return this.handleExecutionError(task, err, startTime);
    } finally {
      // Cleanup
      this.abortControllers.delete(task.id);
      this.queueManager.releaseSlot(task.provider, task.id);

      // Trigger queue processing for this provider
      this.queueManager.processQueue(task.provider);
    }
  }

  /**
   * Cancel a running task
   */
  cancel(taskId: string): boolean {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.log(`Cancelled task ${taskId}`);
      return true;
    }
    return false;
  }

  // ─── Message Task Execution ────────────────────────────────────────────

  private async executeMessageTask(
    task: Task,
    signal: AbortSignal,
    startTime: number
  ): Promise<ExecutionResult> {
    if ((task.retryCount ?? 0) > 0) {
      await this.prepareForRetry(task);
    }

    // Validate payload structure
    const payload = task.payload as MessagePayload;
    if (!payload || !Array.isArray(payload.messages)) {
      throw new Error(`Invalid MessagePayload: missing or invalid messages array for task ${task.id}`);
    }

    // Get provider engine
    const engine = await this.providerRegistry.get(task.provider as any);
    if (!engine) {
      throw new Error(`Provider not found: ${task.provider}`);
    }

    // Generate or use existing requestId for idempotency
    const requestId = task.requestId ?? generateUUIDv7();
    if (!task.requestId) {
      // Save requestId to DB for crash recovery
      await this.db.tasks.update(task.id, { requestId });
      this.log(`Generated requestId ${requestId} for task ${task.id}`);
    }

    // Add tool encouragement system prompt if tools are available
    let messages = this.convertMessages(payload.messages);
    if (payload.tools && payload.tools.length > 0) {
      const toolNames = payload.tools.map(t => t.function.name).join(', ');
      const toolSystemMessage: KernelMessage = {
        id: generateUUIDv7(),
        role: 'system',
        parts: [{ type: 'text', text: `You have access to tools: ${toolNames}. When the user asks you to perform actions like creating pages or editing content, USE THE APPROPRIATE TOOL rather than describing the action. Invoke the tool with the correct parameters.` }],
        createdAt: new Date().toISOString(),
      };
      messages = [toolSystemMessage, ...messages];
    }

    // Defense-in-depth: filter tools by allowedTools
    let requestTools = payload.tools;
    const allowedToolNameSet = this.buildAllowedToolSet(payload.allowedTools);
    if (allowedToolNameSet && requestTools) {
      requestTools = requestTools.filter(
        (tool) => allowedToolNameSet.has(tool.function.name)
      );
    }

    // Build chat request
    const request: ChatRequest = {
      taskId: task.id,
      model: task.model,
      messages,
      maxTokens: payload.maxTokens,
      temperature: payload.temperature,
      topP: payload.topP,
      tools: requestTools,
      toolChoice: payload.toolChoice,
      signal,
      requestId, // For provider idempotency (OpenAI uses this)
    };

    // Streaming state
    const chunks: TokenChunk[] = [];
    let fullText = '';
    let reasoningText = '';
    let tokenCount = 0;

    // Stream callbacks
    const callbacks: StreamCallbacks = {
      onToken: (token: string) => {
        tokenCount++;
        fullText += token;

        const chunk: TokenChunk = {
          sequence: chunks.length,
          content: token,
          timestamp: new Date().toISOString(),
        };
        chunks.push(chunk);

        // Buffer chunk for batch DB write (if chunkBuffer available)
        if (this.chunkBuffer) {
          this.chunkBuffer.append(task.id, token);
        }

        // Emit token event
        this.emit({
          type: 'task.token',
          taskId: task.id,
          data: { token, sequence: chunk.sequence },
          timestamp: chunk.timestamp,
        });

        // Periodic save to result field (for recovery)
        if (tokenCount % this.config.saveIntervalTokens === 0) {
          this.savePartialResult(task.id, fullText, chunks).catch(err => {
            console.error('[TaskExecutor] Failed to save partial result:', err);
          });
        }
      },

      onReasoning: (text: string) => {
        reasoningText += text;
        this.emit({
          type: 'task.reasoning',
          taskId: task.id,
          data: { text },
          timestamp: new Date().toISOString(),
        });
      },

      onComplete: (_result: ChatResult) => {
        void _result;
        this.log(`Task ${task.id} stream complete`);
      },

      onError: (error: Error) => {
        this.log(`Task ${task.id} stream error: ${error.message}`);
      },

      onAbort: (partial: { text: string; reasoningText?: string }) => {
        fullText = partial.text;
        if (partial.reasoningText) reasoningText = partial.reasoningText;
        this.log(`Task ${task.id} aborted with partial result`);
      },
    };

    // Transition to streaming
    await this.transitionToStreaming(task);

    // Execute stream
    const chatResult = await engine.stream(request, callbacks);

    if (chatResult.toolCalls && chatResult.toolCalls.length > 0) {
      if (allowedToolNameSet) {
        const disallowed = chatResult.toolCalls.filter(
          (tc) => !allowedToolNameSet.has(tc.function.name)
        );
        if (disallowed.length > 0) {
          console.warn(
            `[TaskExecutor] Rejected disallowed tool calls: ${disallowed.map(tc => tc.function.name).join(', ')}`
          );
          chatResult.toolCalls = chatResult.toolCalls.filter(
            (tc) => allowedToolNameSet.has(tc.function.name)
          );
        }
      }

      const chatId = payload.chatId || task.chatId;
      if (!chatId) {
        throw new Error(`No chatId available for tool calls on task ${task.id}`);
      }

      if (!task.assistantMessageId) {
        throw new Error(`Task ${task.id} missing assistantMessageId for tool calls`);
      }

      const toolCallPlans = await this.persistAndEmitToolCalls(
        task,
        chatId,
        task.assistantMessageId,
        chatResult.toolCalls,
      );
      await this.handleToolCalls(task, payload, chatId, task.assistantMessageId, toolCallPlans);
    }

    // Check if aborted
    if (signal.aborted) {
      return this.handleCancellation(task, fullText, chunks, startTime);
    }

    // Finalize chunk buffer (flush remaining chunks to DB)
    if (this.chunkBuffer) {
      await this.chunkBuffer.finalize(task.id);
    }

    // Build result
    const duration = Date.now() - startTime;
    const resultData: MessageTaskResultData = {
      success: true,
      data: {
        content: fullText,
        role: 'assistant',
        chunks,
      },
      tokensUsed: chatResult.usage ? {
        prompt: chatResult.usage.promptTokens ?? 0,
        completion: chatResult.usage.completionTokens ?? 0,
        total: chatResult.usage.totalTokens ?? 0,
      } : undefined,
      duration,
      finishReason: this.mapFinishReason(chatResult.finishReason),
    };

    // Save final result
    await this.saveCompletedResult(task.id, resultData);

    this.emit({
      type: 'task.completed',
      taskId: task.id,
      data: resultData,
      timestamp: new Date().toISOString(),
    });

    return {
      taskId: task.id,
      status: 'completed',
      result: resultData,
    };
  }

  // ─── Load Task Execution ───────────────────────────────────────────────

  private async executeLoadTask(task: Task, startTime: number): Promise<ExecutionResult> {
    // Validate payload structure
    const payload = task.payload as LoadPayload;
    if (!payload || typeof payload !== 'object') {
      throw new Error(`Invalid LoadPayload for task ${task.id}`);
    }

    // Get provider engine
    const engine = await this.providerRegistry.get(task.provider as any);
    if (!engine) {
      throw new Error(`Provider not found: ${task.provider}`);
    }

    try {
      // Check if already loaded
      const alreadyLoaded = await engine.isModelLoaded(task.model);
      if (alreadyLoaded) {
        this.log(`Model ${task.model} already loaded on ${task.provider}`);

        const duration = Date.now() - startTime;
        const resultData: LoadTaskResultData = {
          success: true,
          data: {
            modelLoaded: true,
            loadDuration: duration,
          },
          duration,
          finishReason: 'stop',
        };

        await this.saveCompletedResult(task.id, resultData);

        // Release load lock (marks as loaded in cache)
        this.modelLoadCache.releaseLoadLock(task.provider, task.model);

        // Emit completion event
        this.emit({
          type: 'task.completed',
          taskId: task.id,
          data: resultData,
          timestamp: new Date().toISOString(),
        });

        return {
          taskId: task.id,
          status: 'completed',
          result: resultData,
        };
      }

      // Preload model
      const success = await engine.preloadModel(task.model);

      if (!success) {
        const error = new Error(`Failed to preload model ${task.model} on ${task.provider}`);
        this.modelLoadCache.releaseLoadLockWithError(task.provider, task.model, error);
        throw error;
      }

      const duration = Date.now() - startTime;
      const resultData: LoadTaskResultData = {
        success: true,
        data: {
          modelLoaded: true,
          loadDuration: duration,
        },
        duration,
        finishReason: 'stop',
      };

      await this.saveCompletedResult(task.id, resultData);

      // Release load lock (marks as loaded in cache)
      this.modelLoadCache.releaseLoadLock(task.provider, task.model);

      this.emit({
        type: 'task.completed',
        taskId: task.id,
        data: resultData,
        timestamp: new Date().toISOString(),
      });

      return {
        taskId: task.id,
        status: 'completed',
        result: resultData,
      };
    } catch (err) {
      // Release load lock with error
      const error = err instanceof Error ? err : new Error(String(err));
      this.modelLoadCache.releaseLoadLockWithError(task.provider, task.model, error);
      throw err;
    }
  }

  // ─── Embedding Task Execution ──────────────────────────────────────────

  private async executeEmbeddingTask(_task: Task, _startTime: number): Promise<ExecutionResult> {
    void _task;
    void _startTime;
    // TODO: Implement embedding task execution
    throw new Error('Embedding tasks not yet implemented');
  }

  // ─── State Transitions ─────────────────────────────────────────────────

  private async transitionToRunning(task: Task): Promise<void> {
    await this.db.tasks.update(task.id, {
      status: 'running',
      startedAt: new Date(),
    });

    this.emit({
      type: 'task.started',
      taskId: task.id,
      timestamp: new Date().toISOString(),
    });

    this.log(`Task ${task.id} started`);
  }

  private async transitionToStreaming(task: Task): Promise<void> {
    await this.db.tasks.update(task.id, {
      status: 'streaming',
    });

    this.emit({
      type: 'task.streaming',
      taskId: task.id,
      timestamp: new Date().toISOString(),
    });

    this.log(`Task ${task.id} streaming`);
  }

  // ─── Result Handling ───────────────────────────────────────────────────

  private async savePartialResult(
    taskId: string,
    content: string,
    chunks: TokenChunk[]
  ): Promise<void> {
    const partialResult: Partial<MessageTaskResultData> = {
      success: false, // Not complete yet
      data: {
        content,
        role: 'assistant',
        chunks,
        incomplete: true,
      },
    };

    await this.db.tasks.update(taskId, {
      result: partialResult as TaskResultData,
    });
  }

  private async saveCompletedResult(taskId: string, result: TaskResultData): Promise<void> {
    await this.db.tasks.update(taskId, {
      status: 'completed',
      result,
      completedAt: new Date(),
    });
  }

  private async prepareForRetry(task: Task): Promise<void> {
    await this.db.taskChunks.deleteChunks(task.id);

    const metadata: TaskMetadata = {
      ...(task.metadata as TaskMetadata || {}),
    };
    delete (metadata as { error?: TaskError }).error;

    await this.db.tasks.update(task.id, {
      result: null,
      resultRaw: null,
      error: null,
      metadata,
    });
  }

  private async handleCancellation(
    task: Task,
    partialContent: string,
    chunks: TokenChunk[],
    startTime: number
  ): Promise<ExecutionResult> {
    // Cancel chunk buffer without flushing (partial data will be in result field)
    if (this.chunkBuffer) {
      this.chunkBuffer.cancel(task.id);
    }

    const duration = Date.now() - startTime;

    const resultData: MessageTaskResultData = {
      success: false,
      data: {
        content: partialContent,
        role: 'assistant',
        chunks,
        incomplete: true,
      },
      duration,
      finishReason: 'cancelled',
    };

    const metadata: TaskMetadata = {
      cancelled: true,
      cancelReason: 'user_cancelled',
    };

    await this.db.tasks.update(task.id, {
      status: 'cancelled',
      result: resultData,
      metadata,
      completedAt: new Date(),
    });

    this.emit({
      type: 'task.cancelled',
      taskId: task.id,
      data: { partialSaved: true },
      timestamp: new Date().toISOString(),
    });

    return {
      taskId: task.id,
      status: 'cancelled',
      result: resultData,
    };
  }

  private async handleExecutionError(
    task: Task,
    err: unknown,
    startTime: number
  ): Promise<ExecutionResult> {
    void startTime;
    const error = err instanceof Error ? err : new Error(String(err));

    if (this.chunkBuffer) {
      try {
        await this.chunkBuffer.finalize(task.id);
      } catch (flushError) {
        console.error('[TaskExecutor] Failed to flush chunks on error:', flushError);
      }
    }

    // Classify error
    const taskError: TaskError = this.classifyError(error);

    // Check if retryable
    const retryCount = (task.retryCount ?? 0) + 1;
    const maxRetries = task.maxRetries ?? 3;

    if (taskError.retryable && retryCount < maxRetries) {
      // Transition to paused for retry
      await this.db.tasks.update(task.id, {
        status: 'paused',
        retryCount,
        error: taskError,
        metadata: {
          ...(task.metadata as TaskMetadata || {}),
          error: taskError,
        },
      });

      if (task.type === 'load') {
        this.scheduleRetry(task.id, task.provider, retryCount);
      }

      this.log(`Task ${task.id} paused for retry (attempt ${retryCount}/${maxRetries})`);

      return {
        taskId: task.id,
        status: 'paused',
        error: taskError,
      };
    }

    // Permanent failure
    await this.db.tasks.update(task.id, {
      status: 'failed',
      error: taskError,
      metadata: {
        ...(task.metadata as TaskMetadata || {}),
        error: taskError,
      },
      completedAt: new Date(),
    });

    this.emit({
      type: 'task.failed',
      taskId: task.id,
      data: taskError,
      timestamp: new Date().toISOString(),
    });

    this.log(`Task ${task.id} failed: ${error.message}`);

    return {
      taskId: task.id,
      status: 'failed',
      error: taskError,
    };
  }

  // ─── Error Classification ──────────────────────────────────────────────

  private classifyError(error: Error): TaskError {
    const message = error.message.toLowerCase();

    // Transient errors (retryable)
    if (
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('enotfound') ||
      message.includes('socket hang up') ||
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504') ||
      message.includes('429') ||
      message.includes('bad gateway') ||
      message.includes('service unavailable') ||
      message.includes('rate limit')
    ) {
      return {
        type: 'transient',
        code: 'NETWORK_ERROR',
        message: error.message,
        retryable: true,
        timestamp: new Date().toISOString(),
        stack: error.stack,
      };
    }

    // Auth errors (not retryable)
    if (
      message.includes('401') ||
      message.includes('403') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('api key')
    ) {
      return {
        type: 'fatal',
        code: 'AUTH_ERROR',
        message: error.message,
        retryable: false,
        timestamp: new Date().toISOString(),
        stack: error.stack,
      };
    }

    // Model errors (not retryable)
    if (
      message.includes('model not found') ||
      message.includes('invalid model')
    ) {
      return {
        type: 'provider',
        code: 'MODEL_NOT_FOUND',
        message: error.message,
        retryable: false,
        timestamp: new Date().toISOString(),
        stack: error.stack,
      };
    }

    // Default: treat as fatal
    return {
      type: 'fatal',
      code: 'EXECUTION_ERROR',
      message: error.message,
      retryable: false,
      timestamp: new Date().toISOString(),
      stack: error.stack,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────
  private scheduleRetry(taskId: string, provider: string, retryCount: number): void {
    if (this.retryTimers.has(taskId)) {
      return;
    }

    const delay = Math.min(
      this.config.retryMaxDelayMs,
      this.config.retryBaseDelayMs * Math.pow(2, retryCount - 1)
    );

    const timer = setTimeout(async () => {
      this.retryTimers.delete(taskId);
      const task = await this.db.tasks.findById(taskId);
      if (!task || task.status !== 'paused') {
        return;
      }

      if ((task.retryCount ?? 0) >= (task.maxRetries ?? 3)) {
        return;
      }

      await this.db.tasks.update(taskId, { status: 'queued' });
      this.queueManager.enqueue({ ...task, status: 'queued' });
      await this.queueManager.processQueue(provider);
    }, delay);

    this.retryTimers.set(taskId, timer);
  }

  /**
   * Convert simple message format from MessagePayload to KernelMessage format
   */
  private convertMessages(messages: MessagePayload['messages']): KernelMessage[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        const toolCallId = this.resolveToolCallId(m);
        const toolName = this.resolveToolName(m);
        return {
          id: generateUUIDv7(),
          role: 'tool',
          parts: [
            {
              type: 'tool-result',
              toolCallId,
              toolName,
              result: m.content,
            },
          ],
          createdAt: new Date().toISOString(),
        };
      }

      return {
        id: generateUUIDv7(),
        role: m.role as 'user' | 'assistant' | 'system',
        parts: [{ type: 'text' as const, text: m.content }],
        createdAt: new Date().toISOString(),
      };
    });
  }

  private resolveToolCallId(message: MessagePayload['messages'][number]): string {
    if (message.tool_call_id) {
      return message.tool_call_id;
    }

    const extracted = this.extractToolCallIdFromContent(message.content);
    if (extracted) {
      return extracted;
    }

    return generateUUIDv7();
  }

  private extractToolCallIdFromContent(content: string): string | null {
    const match = content.match(/^Tool (?:result|error) \(([^)]+)\):/i);
    return match?.[1] ?? null;
  }

  private resolveToolName(message: MessagePayload['messages'][number]): string {
    const match = message.content.match(/^Tool (?:result|error)\s+([^\s(]+)\s+\([^)]+\):/i);
    return match?.[1] ?? "tool";
  }

  /**
   * Map provider finish reason to TaskResultData finish reason
   */
  private mapFinishReason(reason?: string): 'stop' | 'length' | 'error' | 'cancelled' | undefined {
    if (!reason) return 'stop';
    switch (reason) {
      case 'stop':
      case 'length':
      case 'error':
      case 'cancelled':
        return reason;
      case 'content_filter':
      case 'tool_calls':
      default:
        return 'stop'; // Map unknown reasons to stop
    }
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[TaskExecutor] ${message}`);
    }
  }

  private async handleToolCalls(
    task: Task,
    payload: MessagePayload,
    chatId: string,
    assistantMessageId: string,
    toolCallPlans: ToolCallPlan[],
  ): Promise<void> {
    if (!this.toolDispatcher) {
      this.log(`No ToolDispatcher configured for task ${task.id}`);
      return;
    }

    try {
      const toolResults = await Promise.all(
        toolCallPlans.map(({ toolCall, resultSeq }) =>
          this.executeToolCallPlan({
            task,
            payload,
            chatId,
            assistantMessageId,
            toolCall,
            resultSeq,
          }),
        )
      );

      this.emitToolResults(task.id, toolResults);

      if (!this.createFollowupTask) {
        this.log(`No follow-up task creator configured for task ${task.id}`);
        return;
      }

      const currentToolChainDepth = this.resolveToolChainDepth(payload.providerOptions);
      const nextToolChainDepth = currentToolChainDepth + 1;
      const shouldForcePlainFollowup = nextToolChainDepth >= this.config.maxToolFollowupDepth;
      if (shouldForcePlainFollowup) {
        this.log(
          `Task ${task.id} reached tool follow-up depth ${nextToolChainDepth}/${this.config.maxToolFollowupDepth}; forcing plain-text final follow-up`,
        );
      }

      const nextProviderOptions: Record<string, unknown> = {
        ...(payload.providerOptions ?? {}),
        __toolChainDepth: nextToolChainDepth,
      };

      await this.createFollowupTask({
        chatId,
        provider: task.provider,
        model: task.model,
        userMessage: this.buildToolFollowupUserMessage(toolResults),
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
        topP: payload.topP,
        priority: task.priority ?? undefined,
        providerOptions: nextProviderOptions,
        workspaceId: task.workspaceId ?? undefined,
        projectId: task.projectId ?? undefined,
        assistantMessageId,
        tools: shouldForcePlainFollowup ? undefined : payload.tools,
        toolChoice: shouldForcePlainFollowup ? undefined : payload.toolChoice,
        activeContext: payload.activeContext,
        allowedTools: payload.allowedTools,
      });
    } catch (err) {
      console.error('[TaskExecutor] Tool execution failed:', err);
    }
  }

  private async executeToolCallPlan(params: {
    task: Task;
    payload: MessagePayload;
    chatId: string;
    assistantMessageId: string;
    toolCall: NonNullable<ChatResult['toolCalls']>[number];
    resultSeq: number;
  }): Promise<ToolExecutionResult> {
    const {
      task,
      payload,
      chatId,
      assistantMessageId,
      toolCall,
      resultSeq,
    } = params;

    try {
      return await this.toolDispatcher!.executeTool({
        taskId: task.id,
        chatId,
        provider: task.provider,
        model: task.model,
        assistantMessageId,
        workspaceId: task.workspaceId ?? undefined,
        projectId: task.projectId ?? undefined,
        toolCall,
        activeContext: payload.activeContext,
        seq: resultSeq,
      });
    } catch (err) {
      const toolCallId = toolCall.id || generateUUIDv7();
      const toolName = toolCall.function.name || "unknown_tool";
      const message = err instanceof Error ? err.message : String(err);
      const result = {
        success: false,
        error: {
          code: "TOOL_DISPATCH_FAILED",
          message,
        },
      };

      console.error(
        `[TaskExecutor] ToolDispatcher threw for ${toolName} (${toolCallId}) on task ${task.id}:`,
        err,
      );

      try {
        await this.db.taskToolEvents.appendToolResult({
          chatId,
          assistantMessageId,
          taskId: task.id,
          seq: resultSeq,
          toolCallId,
          toolName,
          result,
          isError: true,
        });
      } catch (persistErr) {
        console.error(
          `[TaskExecutor] Failed to persist fallback tool_result for ${toolName} (${toolCallId}) on task ${task.id}:`,
          persistErr,
        );
      }

      return {
        toolCallId,
        toolName,
        result,
        isError: true,
        seq: resultSeq,
        contextMessage: {
          role: "assistant",
          content: `Tool error ${toolName} (${toolCallId}): ${JSON.stringify(result)}`,
        },
      };
    }
  }

  private emitToolResults(taskId: string, toolResults: ToolExecutionResult[]): void {
    const timestamp = new Date().toISOString();
    for (const result of toolResults) {
      this.emit({
        type: 'task.tool_result',
        taskId,
        data: {
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          result: result.result,
          isError: result.isError || undefined,
          seq: result.seq,
        },
        timestamp,
      });
    }
  }

  private buildToolFollowupUserMessage(toolResults: ToolExecutionResult[]): string {
    if (toolResults.length === 1 && toolResults[0]?.toolName) {
      return `[tool_result:${toolResults[0].toolName}]`;
    }
    return `[tool_results:${toolResults.length}]`;
  }

  private async persistAndEmitToolCalls(
    task: Task,
    chatId: string,
    assistantMessageId: string,
    toolCalls: NonNullable<ChatResult['toolCalls']>,
  ): Promise<ToolCallPlan[]> {
    const existingEvents = await this.db.taskToolEvents.listByAssistantMessageId(
      assistantMessageId,
    );
    const seqOffset = existingEvents.length;
    const timestamp = new Date().toISOString();
    const plans: ToolCallPlan[] = [];
    const usedToolCallIds = new Set(existingEvents.map((event) => event.toolCallId));

    for (const [index, rawToolCall] of toolCalls.entries()) {
      const toolCallId = this.ensureUniqueToolCallId({
        taskId: task.id,
        chatId,
        assistantMessageId,
        index,
        incomingToolCallId: rawToolCall.id || generateUUIDv7(),
        usedToolCallIds,
      });
      const normalizedToolCall = {
        ...rawToolCall,
        id: toolCallId,
      };

      const toolName = normalizedToolCall.function.name || "unknown_tool";
      const parsedArgs = this.parseToolArgs(normalizedToolCall.function.arguments);
      const callSeq = seqOffset + index * 2;
      const resultSeq = callSeq + 1;

      await this.db.taskToolEvents.appendToolCall({
        chatId,
        assistantMessageId,
        taskId: task.id,
        seq: callSeq,
        toolCallId,
        toolName,
        args: parsedArgs,
      });

      this.emit({
        type: 'task.tool_call',
        taskId: task.id,
        data: {
          id: toolCallId,
          seq: callSeq,
          function: {
            name: toolName,
            arguments: parsedArgs,
          },
        },
        timestamp,
      });

      plans.push({
        toolCall: normalizedToolCall,
        resultSeq,
      });
    }

    return plans;
  }

  private ensureUniqueToolCallId(params: {
    taskId: string;
    chatId: string;
    assistantMessageId: string;
    index: number;
    incomingToolCallId: string;
    usedToolCallIds: Set<string>;
  }): string {
    const {
      taskId,
      chatId,
      assistantMessageId,
      index,
      incomingToolCallId,
      usedToolCallIds,
    } = params;

    if (!usedToolCallIds.has(incomingToolCallId)) {
      usedToolCallIds.add(incomingToolCallId);
      return incomingToolCallId;
    }

    let suffix = 1;
    let normalized = `${incomingToolCallId}__dup${suffix}`;
    while (usedToolCallIds.has(normalized)) {
      suffix += 1;
      normalized = `${incomingToolCallId}__dup${suffix}`;
    }

    usedToolCallIds.add(normalized);
    console.warn(
      `[TaskExecutor] Normalized duplicate toolCallId '${incomingToolCallId}' -> '${normalized}' ` +
        `(task=${taskId}, chat=${chatId}, assistant=${assistantMessageId}, idx=${index})`,
    );
    return normalized;
  }

  private parseToolArgs(raw: unknown): unknown {
    if (typeof raw !== "string") {
      return raw;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  private buildAllowedToolSet(allowedTools?: string[]): Set<string> | null {
    if (!allowedTools || allowedTools.length === 0) {
      return null;
    }

    const set = new Set<string>();
    for (const toolName of allowedTools) {
      if (TaskExecutor.EDIT_CONTENT_ALIASES.has(toolName)) {
        for (const alias of TaskExecutor.EDIT_CONTENT_ALIASES) {
          set.add(alias);
        }
        continue;
      }
      set.add(toolName);
    }

    return set;
  }

  private resolveToolChainDepth(providerOptions?: Record<string, unknown>): number {
    const rawDepth = providerOptions?.__toolChainDepth;
    if (typeof rawDepth === "number" && Number.isFinite(rawDepth) && rawDepth >= 0) {
      return Math.floor(rawDepth);
    }
    return 0;
  }
}
