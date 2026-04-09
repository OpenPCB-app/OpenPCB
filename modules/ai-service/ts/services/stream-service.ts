/**
 * StreamService - Chat Streaming via TaskSystem
 *
 * Refactored to use TaskOrchestrator with event bridge pattern.
 * SSE stream transforms TaskExecutor events into SSE events.
 *
 * See: TASK_SYSTEM_SPECIFICATION.md Section 8
 */

import type { DatabaseAccess } from '../../db';
import type { Task as DbTask, TaskMetadata, MessagePayload } from '../../db/schema/task';
import type { ContentPart } from '../../db/schema/message';
import type { TaskToolEvent } from '../../db/schema/task-tool-event';
import type { TaskOrchestrator } from './queue/task-orchestrator';
import type { ExecutionEvent } from './queue/task-executor';
import type { KernelMessage } from '@shared/types';
import { ValidationError } from '../../core/errors';
import { LicenseUtil } from './license-util';
import { DEFAULT_WORKSPACE_ID } from '../constants';
import { nowISO } from '../../core/utils/time';
import { ToolRegistry } from './tools/tool-registry';
import { EDIT_CONTENT_TOOL, EDIT_CONTENT_ALIASES } from './tools/edit-content-tool';
import { generateUUIDv7 } from '../../db/schema/base';
import { parseMentions } from '../utils/mention-parser';

/**
 * Chat stream request input
 */
export interface StreamChatInput {
    chatId?: string;
    provider: string;
    model: string;
    text?: string;
    files?: Array<{
        data?: string;
        url?: string;
        mediaType?: string;
        filename?: string;
    }>;
    systemPrompt?: string;
    workspaceId?: string;
    projectId?: string;
    priority?: number;
    toolChoice?: MessagePayload['toolChoice'];
    activeContext?: MessagePayload['activeContext'];
    allowedTools?: string[];
}

/**
 * Stream creation result
 */
export interface StreamResult {
    stream: ReadableStream;
    chatId: string;
    taskId: string;
    userMessageId: string;
    assistantMessageId: string;
}

/**
 * Replay mode for streaming progress
 */
export type ReplayMode = 'full' | 'final';

/**
 * Replay request for resuming/replaying task progress
 */
export interface ReplayRequest {
    taskId: string;
    mode: ReplayMode;
}

/**
 * Replay result
 */
export interface ReplayResult {
    stream: ReadableStream;
    taskId: string;
    status: string;
}

/**
 * StreamService interface
 */
export interface IStreamService {
    createChatStream(input: StreamChatInput): Promise<StreamResult>;
    abortStream(taskId: string): boolean;
    replayProgress(request: ReplayRequest): Promise<ReplayResult>;
    getActiveChatTask(chatId: string): Promise<ActiveTaskInfo | null>;
}

/**
 * Active task info for a chat
 */
export interface ActiveTaskInfo {
    taskId: string;
    status: string;
    provider: string;
    model: string;
    createdAt: string;
    assistantMessageId?: string | null;
    waitReason?: TaskMetadata['waitReason'] | null;
    resumeEligible: boolean;
}

interface ToolResultEventData {
    toolCallId?: string;
    toolName?: string;
    result?: unknown;
    isError?: boolean;
    seq?: number;
}

interface ReplayToolEvent {
    taskId: string;
    seq: number;
    kind: 'tool-call' | 'tool-result';
    toolCallId: string;
    toolName: string;
    args?: unknown;
    result?: unknown;
    isError?: boolean | null;
}

type ScopeResolutionCache = Map<string, boolean | Promise<boolean>>;

/**
 * StreamService - Chat streaming via TaskOrchestrator
 *
 * Uses event bridge pattern to transform TaskExecutor events into SSE events.
 */
export class StreamService implements IStreamService {
    private static readonly EDIT_CONTENT_ALIASES = EDIT_CONTENT_ALIASES;

    constructor(
        private db: DatabaseAccess,
        private orchestrator: TaskOrchestrator,
        private toolRegistry: ToolRegistry = new ToolRegistry()
    ) { }

    /**
     * Create SSE stream for chat
     *
     * 1. Creates/gets chat
     * 2. Creates user message
     * 3. Creates MessageTask via TaskOrchestrator
     * 4. Returns SSE stream that listens to execution events
     */
    async createChatStream(input: StreamChatInput): Promise<StreamResult> {
        // Validate input
        if (!input.provider) {
            throw new ValidationError('provider is required');
        }
        if (!input.model) {
            throw new ValidationError('model is required');
        }
        if (!input.text && (!input.files || input.files.length === 0)) {
            throw new ValidationError('text or files required');
        }

        await LicenseUtil.enforceAllowed();

        // Get or create chat
        let chatId = input.chatId;
        if (!chatId) {
            const chatManager = this.orchestrator.getChatManager();
            const newChat = await chatManager.createChat(
                input.workspaceId || DEFAULT_WORKSPACE_ID,
                {
                    title: 'New Chat',
                    provider: input.provider,
                    model: input.model,
                    systemPrompt: input.systemPrompt,
                }
            );
            chatId = newChat.id;
        }

        // Build user message content
        const userMessageContent = this.buildUserMessageContent(input);

        // Create user message via ChatManager
        const userMessage = await this.orchestrator.createUserMessage(chatId, {
            content: userMessageContent,
        });
        const userMessageId = userMessage.id;

        // Generate assistant message ID upfront for one-message-per-turn chaining
        const assistantMessageId = generateUUIDv7();

        const requestedToolChoice = input.toolChoice;
        const shouldEnableTools = requestedToolChoice === 'auto' || requestedToolChoice === 'required';
        const normalizedAllowedTools = this.normalizeAllowedToolAliases(input.allowedTools);
        const activeContextWithScope = this.buildActiveContextWithKnowledgeScope(input);
        let tools: MessagePayload['tools'] | undefined;
        let toolChoice: MessagePayload['toolChoice'] | undefined;

        if (shouldEnableTools) {
            const candidateTools = this.buildCandidateTools({
                ...input,
                allowedTools: normalizedAllowedTools,
            });
            tools = candidateTools.length > 0 ? candidateTools : undefined;
            toolChoice = tools ? requestedToolChoice : undefined;
        }

        // Debug logging for tools
        if (tools && tools.length > 0) {
            console.log(`[StreamService] Chat ${chatId} - ${tools.length} tool(s) registered:`,
                tools.map(t => t.function.name).join(', '));
        } else if (requestedToolChoice === 'none') {
            console.log(`[StreamService] Chat ${chatId} - Tools disabled (toolChoice=none)`);
        } else if (!requestedToolChoice) {
            console.log(`[StreamService] Chat ${chatId} - Tools disabled (toolChoice omitted)`);
        } else {
            console.log(`[StreamService] Chat ${chatId} - No tools registered`);
        }

        // Create MessageTask via TaskOrchestrator
        const { task, queueStatus } = await this.orchestrator.createMessageTask({
            chatId,
            provider: input.provider,
            model: input.model,
            userMessage: typeof userMessageContent === 'string'
                ? userMessageContent
                : JSON.stringify(userMessageContent),
            priority: input.priority,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            assistantMessageId,
            tools,
            toolChoice,
            activeContext: activeContextWithScope,
            allowedTools: normalizedAllowedTools,
        });

        const taskId = task.id;

        // Persist draft assistant row immediately so stream/reload use a stable message id.
        await this.orchestrator.createAssistantMessage(chatId, {
            id: assistantMessageId,
            content: '',
            taskId,
            provider: input.provider,
            model: input.model,
            metadata: { incomplete: true },
        });

        // Get LoadTask dependency info (if any)
        const depInfo = await this.orchestrator.getTaskDependency(taskId);
        const loadTaskId = depInfo.loadTaskId;

        // Create SSE stream with event bridge
        const stream = this.createEventBridgeStream({
            taskId,
            loadTaskId,
            chatId,
            assistantMessageId,
            input,
        });

        return {
            stream,
            chatId,
            taskId,
            userMessageId,
            assistantMessageId,
        };
    }

    /**
     * Abort a streaming task
     */
    abortStream(taskId: string): boolean {
        try {
            this.orchestrator.cancelTask(taskId, false);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get active task for a chat (if any)
     * Used by frontend to detect running tasks and reconnect
     */
    async getActiveChatTask(chatId: string): Promise<ActiveTaskInfo | null> {
        const task = await this.orchestrator.getActiveChatTask(chatId);
        if (!task) {
            return null;
        }

        const metadata = task.metadata as TaskMetadata | null;
        const assistantMessageId = task.assistantMessageId ?? null;

        return {
            taskId: task.id,
            status: task.status,
            provider: task.provider,
            model: task.model,
            createdAt: task.createdAt.toISOString(),
            assistantMessageId,
            waitReason: metadata?.waitReason ?? null,
            resumeEligible: metadata?.resumedAfterCrash === true,
        };
    }

    /**
     * Replay task progress as SSE stream
     */
    async replayProgress(request: ReplayRequest): Promise<ReplayResult> {
        const task = await this.db.tasks.findById(request.taskId);
        if (!task) {
            throw new ValidationError(`Task not found: ${request.taskId}`);
        }

        const stream = this.createReplayStream(task, request.mode);

        return {
            stream,
            taskId: request.taskId,
            status: task.status,
        };
    }

    // ─── Event Bridge Stream ──────────────────────────────────────────────────

    /**
     * Create SSE stream that bridges TaskExecutor events to SSE
     */
    private createEventBridgeStream(params: {
        taskId: string;
        loadTaskId: string | null;
        chatId: string;
        assistantMessageId: string;
        input: StreamChatInput;
    }): ReadableStream {
        const { taskId, loadTaskId, chatId, assistantMessageId, input } = params;
        const orchestrator = this.orchestrator;
        const db = this.db;
        const streamService = this;

        let fullText = '';
        let reasoningText = '';
        let pendingToolContinuation = false;
        const eventScopeCache: ScopeResolutionCache = new Map();
        let unsubscribe: (() => void) | null = null;
        let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

        return new ReadableStream({
            start(controller) {
                const sendSSE = (data: Record<string, unknown>) => {
                    try {
                        const payload = `data: ${JSON.stringify(data)}\n\n`;
                        controller.enqueue(new TextEncoder().encode(payload));
                    } catch (e) {
                        // Stream closed
                    }
                };

                const stopKeepAlive = () => {
                    if (keepAliveTimer) {
                        clearInterval(keepAliveTimer);
                        keepAliveTimer = null;
                    }
                };

                const startKeepAlive = () => {
                    if (keepAliveTimer) return;
                    keepAliveTimer = setInterval(() => {
                        sendSSE({ event: 'ping', ts: nowISO() });
                    }, 15000);
                };

                // Send initial metadata
                sendSSE({
                    event: 'start',
                    taskId,
                    chatId,
                    messageId: assistantMessageId,
                    loadTaskId,
                });

                // If task has LoadTask dependency, notify about model loading
                if (loadTaskId) {
                    sendSSE({
                        event: 'model-loading',
                        status: 'loading',
                        modelName: input.model,
                    });
                }

                startKeepAlive();

                // Subscribe to execution events in-order to avoid tool_call/task.completed races.
                let eventQueue = Promise.resolve();
                unsubscribe = orchestrator.onExecutionEvent((event: ExecutionEvent) => {
                    eventQueue = eventQueue.then(async () => {
                        let inScope = false;
                        try {
                            inScope = await streamService.isEventInChatScope(taskId, loadTaskId, chatId, event.taskId, eventScopeCache);
                        } catch (error) {
                            console.error(`[StreamService] Error checking scope for task ${event.taskId} in chat ${chatId}:`, error);
                            return;
                        }

                        if (!inScope) {
                            return;
                        }

                        // Handle LoadTask events
                        if (event.taskId === loadTaskId) {
                            if (event.type === 'task.completed') {
                                sendSSE({
                                    event: 'model-loading',
                                    status: 'ready',
                                });
                            } else if (event.type === 'task.failed') {
                                const error = event.data as { message?: string; code?: string } | undefined;
                                sendSSE({
                                    event: 'model-loading',
                                    status: 'error',
                                    error: error?.message || 'Model loading failed',
                                });
                            }
                            return;
                        }

                        // Handle MessageTask events
                        switch (event.type) {
                        case 'task.started':
                            sendSSE({ event: 'task-started' });
                            break;

                        case 'task.streaming':
                            sendSSE({
                                event: 'model-loading',
                                status: 'ready',
                            });
                            break;

                        case 'task.token': {
                            const tokenData = event.data as { token: string } | undefined;
                            if (tokenData?.token) {
                                fullText += tokenData.token;
                                sendSSE({
                                    event: 'token',
                                    delta: tokenData.token,
                                });
                            }
                            break;
                        }

                        case 'task.reasoning': {
                            const reasoningData = event.data as { text: string } | undefined;
                            if (reasoningData?.text) {
                                reasoningText += reasoningData.text;
                                sendSSE({
                                    event: 'reasoning',
                                    delta: reasoningData.text,
                                });
                            }
                            break;
                        }

                        case 'task.tool_call': {
                            pendingToolContinuation = true;
                            const toolCallData = event.data as {
                                id?: string;
                                seq?: number;
                                name?: string;
                                args?: unknown;
                                function?: { name?: string; arguments?: unknown };
                            } | undefined;
                            const rawArgs = toolCallData?.function?.arguments ?? toolCallData?.args;
                            const toolName = toolCallData?.function?.name ?? toolCallData?.name;
                            let parsedArgs = rawArgs;

                            if (typeof rawArgs === 'string') {
                                try {
                                    parsedArgs = JSON.parse(rawArgs);
                                } catch {
                                    parsedArgs = rawArgs;
                                }
                            }

                            sendSSE({
                                event: 'tool_call',
                                taskId: event.taskId,
                                toolCall: {
                                    id: toolCallData?.id,
                                    name: toolName,
                                    args: parsedArgs,
                                },
                                seq: toolCallData?.seq,
                            });
                            break;
                        }

                        case 'task.tool_result': {
                            const toolResultData = event.data as ToolResultEventData | undefined;
                            sendSSE(streamService.buildToolResultPayload(event.taskId, toolResultData));
                            break;
                        }

                        case 'task.completed': {
                            const resultData = event.data as {
                                data?: { content?: string };
                                tokensUsed?: { prompt: number; completion: number; total: number };
                            } | undefined;

                            const continuationTask = pendingToolContinuation
                                ? await streamService.findAdditionalActiveMessageTask(chatId, event.taskId)
                                : null;

                            if (continuationTask) {
                                pendingToolContinuation = false;
                                const continuationMetadata = continuationTask.metadata as TaskMetadata | null;
                                if (continuationMetadata?.waitReason === 'model_loading' || continuationTask.dependsOn) {
                                    sendSSE({
                                        event: 'model-loading',
                                        status: 'loading',
                                        modelName: continuationTask.model,
                                    });
                                }
                                sendSSE({ event: 'in-progress', status: continuationTask.status });
                                break;
                            }

                            pendingToolContinuation = false;

                            // Update chat title if this was first message
                            if (fullText.length > 0) {
                                const title = fullText.substring(0, 50) + (fullText.length > 50 ? '...' : '');
                                db.chats.update(chatId, { title }).catch(() => { });
                            }

                            sendSSE({
                                event: 'done',
                                text: fullText || resultData?.data?.content,
                                reasoningText: reasoningText || undefined,
                                usage: resultData?.tokensUsed,
                            });

                            unsubscribe?.();
                            stopKeepAlive();
                            controller.close();
                            break;
                        }

                        case 'task.failed': {
                            const errorData = event.data as { message?: string; code?: string; type?: string } | undefined;
                            sendSSE({
                                event: 'error',
                                code: errorData?.code || 'STREAM_ERROR',
                                message: errorData?.message || 'Task failed',
                                type: errorData?.type,
                            });
                            unsubscribe?.();
                            stopKeepAlive();
                            controller.close();
                            break;
                        }

                        case 'task.cancelled': {
                            sendSSE({
                                event: 'cancelled',
                                partial: fullText || undefined,
                            });
                            unsubscribe?.();
                            stopKeepAlive();
                            controller.close();
                            break;
                        }
                        }
                    }).catch((error) => {
                        console.error(`[StreamService] Event bridge processing error for chat ${chatId}:`, error);
                    });
                });
            },

            cancel() {
                unsubscribe?.();
                if (keepAliveTimer) {
                    clearInterval(keepAliveTimer);
                    keepAliveTimer = null;
                }
                // Don't cancel the task when stream is cancelled
                // Task continues running in background and saves result to DB
                // User can return to chat later and load the completed message
                // Explicit cancellation should use the abort endpoint
            },
        });
    }

    // ─── Replay Stream ────────────────────────────────────────────────────────

    /**
     * Create SSE stream for replaying task progress
     */
    private createReplayStream(task: DbTask, mode: ReplayMode): ReadableStream {
        const db = this.db;
        const orchestrator = this.orchestrator;
        const streamService = this;
        let unsubscribe: (() => void) | null = null;
        let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

        const stopKeepAlive = () => {
            if (keepAliveTimer) {
                clearInterval(keepAliveTimer);
                keepAliveTimer = null;
            }
        };

        return new ReadableStream({
            async start(controller) {
                const sendSSE = (data: Record<string, unknown>) => {
                    try {
                        const payload = `data: ${JSON.stringify(data)}\n\n`;
                        controller.enqueue(new TextEncoder().encode(payload));
                    } catch {
                        // Stream closed
                    }
                };

                const startKeepAlive = () => {
                    if (keepAliveTimer) return;
                    keepAliveTimer = setInterval(() => {
                        sendSSE({ event: 'ping', ts: nowISO() });
                    }, 15000);
                };

                const metadata = task.metadata as TaskMetadata | null;
                const assistantMessageId = task.assistantMessageId ?? null;
                const replayedToolSeqs = new Set<number>();
                const replayScopeCache: ScopeResolutionCache = new Map();

                const startPayload: Record<string, unknown> = {
                    event: 'start',
                    taskId: task.id,
                    replay: true,
                };
                if (task.chatId) {
                    startPayload.chatId = task.chatId;
                }
                if (assistantMessageId) {
                    startPayload.messageId = assistantMessageId;
                }
                sendSSE(startPayload);

                let maxSeq = -1;
                let replayReady = false;
                const bufferedEvents: ExecutionEvent[] = [];
                const handleEvent = async (event: ExecutionEvent) => {
                    switch (event.type) {
                        case 'task.started':
                            sendSSE({ event: 'task-started' });
                            break;
                        case 'task.streaming':
                            sendSSE({ event: 'model-loading', status: 'ready' });
                            break;
                        case 'task.token': {
                            const tokenData = event.data as { token?: string; sequence?: number } | undefined;
                            const sequence = tokenData?.sequence ?? -1;
                            if (sequence > maxSeq && tokenData?.token) {
                                maxSeq = sequence;
                                sendSSE({ event: 'token', delta: tokenData.token, seq: sequence });
                            }
                            break;
                        }
                        case 'task.reasoning': {
                            const reasoningData = event.data as { text?: string } | undefined;
                            if (reasoningData?.text) {
                                sendSSE({ event: 'reasoning', delta: reasoningData.text });
                            }
                            break;
                        }
                        case 'task.tool_call': {
                            const toolCallData = event.data as {
                                id?: string;
                                seq?: number;
                                name?: string;
                                args?: unknown;
                                function?: { name?: string; arguments?: unknown };
                            } | undefined;
                            const seq =
                                typeof toolCallData?.seq === "number"
                                    ? toolCallData.seq
                                    : undefined;
                            if (typeof seq === "number" && replayedToolSeqs.has(seq)) {
                                break;
                            }
                            if (typeof seq === "number") {
                                replayedToolSeqs.add(seq);
                            }
                            const rawArgs = toolCallData?.function?.arguments ?? toolCallData?.args;
                            const toolName = toolCallData?.function?.name ?? toolCallData?.name;
                            let parsedArgs = rawArgs;

                            if (typeof rawArgs === 'string') {
                                try {
                                    parsedArgs = JSON.parse(rawArgs);
                                } catch {
                                    parsedArgs = rawArgs;
                                }
                            }

                            sendSSE({
                                event: 'tool_call',
                                taskId: event.taskId,
                                toolCall: {
                                    id: toolCallData?.id,
                                    name: toolName,
                                    args: parsedArgs,
                                },
                                seq,
                            });
                            break;
                        }

                        case 'task.tool_result': {
                            const toolResultData = event.data as ToolResultEventData | undefined;
                            const seq =
                                typeof toolResultData?.seq === "number"
                                    ? toolResultData.seq
                                    : undefined;
                            if (typeof seq === "number" && replayedToolSeqs.has(seq)) {
                                break;
                            }
                            if (typeof seq === "number") {
                                replayedToolSeqs.add(seq);
                            }
                            sendSSE(streamService.buildToolResultPayload(event.taskId, toolResultData));
                            break;
                        }
                        case 'task.completed': {
                            const continuationTask = task.chatId
                                ? await streamService.findAdditionalActiveMessageTask(task.chatId, event.taskId)
                                : null;
                            if (continuationTask) {
                                const continuationMetadata = continuationTask.metadata as TaskMetadata | null;
                                if (continuationMetadata?.waitReason === 'model_loading' || continuationTask.dependsOn) {
                                    sendSSE({
                                        event: 'model-loading',
                                        status: 'loading',
                                        modelName: continuationTask.model,
                                    });
                                }
                                sendSSE({ event: 'in-progress', status: continuationTask.status });
                                break;
                            }

                            const resultData = event.data as {
                                data?: { content?: string };
                                tokensUsed?: { prompt: number; completion: number; total: number };
                            } | undefined;
                            sendSSE({
                                event: 'done',
                                text: resultData?.data?.content,
                                usage: resultData?.tokensUsed,
                            });
                            unsubscribe?.();
                            stopKeepAlive();
                            controller.close();
                            break;
                        }
                        case 'task.failed': {
                            const errorData = event.data as { message?: string; code?: string } | undefined;
                            sendSSE({
                                event: 'error',
                                code: errorData?.code || 'UNKNOWN',
                                message: errorData?.message || 'Task failed',
                            });
                            unsubscribe?.();
                            stopKeepAlive();
                            controller.close();
                            break;
                        }
                        case 'task.cancelled': {
                            sendSSE({ event: 'cancelled' });
                            unsubscribe?.();
                            stopKeepAlive();
                            controller.close();
                            break;
                        }
                    }
                };
                const handleExecutionEvent = async (event: ExecutionEvent) => {
                    let inScope = false;
                    try {
                        inScope = await streamService.isReplayEventInScope(task, event.taskId, replayScopeCache);
                    } catch (error) {
                        console.error(`[StreamService] Error checking replay scope for task ${event.taskId}:`, error);
                        return;
                    }

                    if (!inScope) {
                        return;
                    }
                    if (!replayReady) {
                        bufferedEvents.push(event);
                        return;
                    }
                    await handleEvent(event);
                };

                try {
                    if (metadata?.waitReason === 'model_loading' || task.dependsOn) {
                        sendSSE({
                            event: 'model-loading',
                            status: 'loading',
                            modelName: task.model,
                        });
                    }

                    // Send initial status
                    sendSSE({
                        event: 'replay-start',
                        taskId: task.id,
                        status: task.status,
                        mode,
                    });

                    startKeepAlive();
                    const continuationAtStart = task.chatId
                        ? await streamService.findAdditionalActiveMessageTask(task.chatId, task.id)
                        : null;

                    // For completed tasks with final mode, skip to result
                    if (mode === 'final' && task.status === 'completed' && !continuationAtStart) {
                        const result = task.result;
                        const data = result?.data as { content?: string } | undefined;
                        if (data?.content) {
                            sendSSE({
                                event: 'done',
                                text: data.content,
                                usage: result?.tokensUsed,
                            });
                        }
                        stopKeepAlive();
                        controller.close();
                        return;
                    }

                    // Full mode: replay chunks from database
                    if (mode === 'full') {
                        if (!unsubscribe) {
                            unsubscribe = orchestrator.onExecutionEvent((event: ExecutionEvent) => {
                                void handleExecutionEvent(event);
                            });
                        }

                        const chunks = await db.taskChunks.getChunks(task.id);

                        for (const chunk of chunks) {
                            sendSSE({
                                event: 'token',
                                delta: chunk.content,
                                seq: chunk.seq,
                            });
                        }

                        maxSeq = chunks.length > 0 ? chunks[chunks.length - 1]!.seq : -1;

                        if (assistantMessageId) {
                            const persistedToolEvents =
                                await db.taskToolEvents.listByAssistantMessageId(
                                    assistantMessageId,
                                );
                            const reconciledToolEvents = streamService.reconcilePersistedToolEvents(
                                persistedToolEvents,
                                {
                                    synthesizeMissingResults:
                                        streamService.shouldSynthesizeMissingToolResults(task.status),
                                },
                            );
                            for (const toolEvent of reconciledToolEvents) {
                                replayedToolSeqs.add(toolEvent.seq);
                                if (toolEvent.kind === "tool-call") {
                                    sendSSE({
                                        event: "tool_call",
                                        taskId: toolEvent.taskId,
                                        toolCall: {
                                            id: toolEvent.toolCallId,
                                            name: toolEvent.toolName,
                                            args: toolEvent.args,
                                        },
                                        seq: toolEvent.seq,
                                    });
                                    continue;
                                }

                                sendSSE({
                                    event: "tool_result",
                                    taskId: toolEvent.taskId,
                                    toolCallId: toolEvent.toolCallId,
                                    toolName: toolEvent.toolName,
                                    result: streamService.parseToolResult(toolEvent.result),
                                    isError: toolEvent.isError ?? undefined,
                                    seq: toolEvent.seq,
                                });
                            }
                        }

                        replayReady = true;
                        for (const bufferedEvent of bufferedEvents) {
                            await handleEvent(bufferedEvent);
                        }
                        bufferedEvents.length = 0;
                    }

                    // Terminal states: send final result and close
                    if (task.status === 'completed' && task.result && !continuationAtStart) {
                        const result = task.result;
                        const resultData = result.data as { content?: string } | undefined;
                        sendSSE({
                            event: 'done',
                            text: resultData?.content,
                            usage: result.tokensUsed,
                        });
                        stopKeepAlive();
                        unsubscribe?.();
                        controller.close();
                        return;
                    }

                    if (task.status === 'failed') {
                        sendSSE({
                            event: 'error',
                            code: task.error?.code || 'UNKNOWN',
                            message: task.error?.message || 'Task failed',
                        });
                        stopKeepAlive();
                        unsubscribe?.();
                        controller.close();
                        return;
                    }

                    if (task.status === 'cancelled') {
                        const cancelData = task.result?.data as { content?: string } | undefined;
                        sendSSE({
                            event: 'cancelled',
                            partial: cancelData?.content,
                        });
                        stopKeepAlive();
                        unsubscribe?.();
                        controller.close();
                        return;
                    }

                    // Task still in progress - keep stream open
                    sendSSE({ event: 'in-progress', status: task.status });

                    if (!unsubscribe) {
                        unsubscribe = orchestrator.onExecutionEvent((event: ExecutionEvent) => {
                            void handleExecutionEvent(event);
                        });
                    }

                    if (!replayReady) {
                        replayReady = true;
                        for (const bufferedEvent of bufferedEvents) {
                            await handleEvent(bufferedEvent);
                        }
                        bufferedEvents.length = 0;
                    }
                } catch (e: any) {
                    sendSSE({
                        event: 'error',
                        code: 'REPLAY_ERROR',
                        message: e.message,
                    });
                    unsubscribe?.();
                    stopKeepAlive();
                    controller.close();
                }
            },
            cancel() {
                unsubscribe?.();
                stopKeepAlive();
            },
        });
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private buildCandidateTools(input: StreamChatInput): NonNullable<MessagePayload['tools']> {
        const registeredTools = this.toolRegistry.list().map((tool) => tool.definition);
        const candidates = [...registeredTools];

        if (!candidates.some((tool) => tool.function.name === EDIT_CONTENT_TOOL.function.name)) {
            candidates.push(EDIT_CONTENT_TOOL);
        }

        const allowedSet = this.buildAllowedToolSet(input.allowedTools);
        const editContentExplicitlyAllowed = allowedSet?.has(EDIT_CONTENT_TOOL.function.name) ?? false;
        if (!input.activeContext && !editContentExplicitlyAllowed) {
            const editToolName = EDIT_CONTENT_TOOL.function.name;
            return this.applyAllowedToolsFilter(
                candidates.filter((tool) => tool.function.name !== editToolName),
                input.allowedTools,
            );
        }

        return this.applyAllowedToolsFilter(candidates, input.allowedTools);
    }

    private buildActiveContextWithKnowledgeScope(
        input: StreamChatInput,
    ): MessagePayload['activeContext'] | undefined {
        const activeContext = input.activeContext;
        if (!activeContext) {
            return undefined;
        }

        const activeTarget = activeContext.activeTarget;
        const rootPageId =
            activeTarget?.targetType === 'knowledge.page' ? activeTarget.targetId : undefined;
        const mentionedPageIds = this.extractMentionedKnowledgePageIds(input.text);

        if (!rootPageId && mentionedPageIds.length === 0) {
            return activeContext;
        }

        return {
            ...activeContext,
            knowledgeScope: {
                rootPageId,
                mentionedPageIds: mentionedPageIds.length > 0 ? mentionedPageIds : undefined,
                grantMode: 'exact',
                grantLifetime: 'turn',
            },
        };
    }

    private extractMentionedKnowledgePageIds(text?: string): string[] {
        if (!text || text.trim().length === 0) {
            return [];
        }

        const mentionedPageIds = new Set<string>();
        for (const mention of parseMentions(text)) {
            if (mention.entityType !== 'knowledge-page') {
                continue;
            }
            mentionedPageIds.add(mention.entityId);
        }

        return Array.from(mentionedPageIds);
    }

    private applyAllowedToolsFilter(
        tools: NonNullable<MessagePayload['tools']>,
        allowedTools?: string[],
    ): NonNullable<MessagePayload['tools']> {
        if (!allowedTools || allowedTools.length === 0) {
            return tools;
        }
        const allowedSet = this.buildAllowedToolSet(allowedTools);
        if (!allowedSet || allowedSet.size === 0) {
            return tools;
        }
        return tools.filter((tool) => allowedSet.has(tool.function.name));
    }

    private buildAllowedToolSet(allowedTools?: string[]): Set<string> | null {
        if (!allowedTools || allowedTools.length === 0) {
            return null;
        }
        const set = new Set<string>();
        for (const toolName of allowedTools) {
            if (StreamService.EDIT_CONTENT_ALIASES.has(toolName)) {
                for (const alias of StreamService.EDIT_CONTENT_ALIASES) {
                    set.add(alias);
                }
                continue;
            }
            set.add(toolName);
        }
        return set;
    }

    private normalizeAllowedToolAliases(allowedTools?: string[]): string[] | undefined {
        if (!allowedTools || allowedTools.length === 0) {
            return allowedTools;
        }
        const normalized = this.buildAllowedToolSet(allowedTools);
        if (!normalized) {
            return allowedTools;
        }
        return Array.from(normalized);
    }

    private async isEventInChatScope(
        primaryTaskId: string,
        loadTaskId: string | null,
        chatId: string,
        eventTaskId: string,
        scopeCache?: ScopeResolutionCache,
    ): Promise<boolean> {
        if (eventTaskId === primaryTaskId || eventTaskId === loadTaskId) {
            return true;
        }

        const cached = scopeCache?.get(eventTaskId);
        if (cached !== undefined) {
            return typeof cached === 'boolean' ? cached : await cached;
        }

        const lookupPromise = this.db.tasks.findById(eventTaskId).then((task) => Boolean(task && task.chatId === chatId));
        scopeCache?.set(eventTaskId, lookupPromise);

        try {
            const inScope = await lookupPromise;
            scopeCache?.set(eventTaskId, inScope);
            return inScope;
        } catch (error) {
            scopeCache?.delete(eventTaskId);
            throw error;
        }
    }

    private async isReplayEventInScope(
        task: DbTask,
        eventTaskId: string,
        scopeCache?: ScopeResolutionCache,
    ): Promise<boolean> {
        if (eventTaskId === task.id) {
            return true;
        }
        if (!task.chatId) {
            return false;
        }

        const cached = scopeCache?.get(eventTaskId);
        if (cached !== undefined) {
            return typeof cached === 'boolean' ? cached : await cached;
        }

        const lookupPromise = this.db.tasks.findById(eventTaskId).then((eventTask) => Boolean(eventTask && eventTask.chatId === task.chatId));
        scopeCache?.set(eventTaskId, lookupPromise);

        try {
            const inScope = await lookupPromise;
            scopeCache?.set(eventTaskId, inScope);
            return inScope;
        } catch (error) {
            scopeCache?.delete(eventTaskId);
            throw error;
        }
    }

    private async findAdditionalActiveMessageTask(chatId: string, excludeTaskId: string): Promise<DbTask | null> {
        const candidates = await this.db.tasks.findByStatus(['waiting', 'queued', 'running', 'streaming', 'paused']);
        return candidates.find(
            (candidate) =>
                candidate.type === 'message' &&
                candidate.chatId === chatId &&
                candidate.id !== excludeTaskId,
        ) ?? null;
    }

    private buildToolResultPayload(taskId: string, data?: ToolResultEventData): Record<string, unknown> {
        const payload: Record<string, unknown> = {
            event: 'tool_result',
            taskId,
        };

        if (!data) {
            return payload;
        }

        return {
            ...payload,
            toolCallId: data.toolCallId,
            toolName: data.toolName,
            result: this.parseToolResult(data.result),
            isError: data.isError ?? undefined,
            seq: data.seq,
        };
    }

    private shouldSynthesizeMissingToolResults(taskStatus: DbTask['status']): boolean {
        return taskStatus === 'completed' || taskStatus === 'failed' || taskStatus === 'cancelled';
    }

    private reconcilePersistedToolEvents(
        events: TaskToolEvent[],
        options?: { synthesizeMissingResults?: boolean },
    ): ReplayToolEvent[] {
        const shouldSynthesizeMissingResults = options?.synthesizeMissingResults ?? true;
        const reconciled: ReplayToolEvent[] = events.map((event) => ({
            taskId: event.taskId,
            seq: event.seq,
            kind: event.kind,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            result: event.result,
            isError: event.isError,
        }));

        if (shouldSynthesizeMissingResults) {
            const completedCallIds = new Set(
                events
                    .filter((event) => event.kind === 'tool-result')
                    .map((event) => event.toolCallId),
            );

            let nextSyntheticSeq =
                events.reduce((maxSeq, event) => Math.max(maxSeq, event.seq), -1) + 1;

            for (const event of events) {
                if (event.kind !== 'tool-call') {
                    continue;
                }
                if (completedCallIds.has(event.toolCallId)) {
                    continue;
                }

                reconciled.push(
                    this.buildSyntheticMissingToolResultEvent(event, nextSyntheticSeq),
                );
                nextSyntheticSeq += 1;
            }
        }

        return reconciled.sort((left, right) => left.seq - right.seq);
    }

    private buildSyntheticMissingToolResultEvent(
        orphanCall: TaskToolEvent,
        seq: number,
    ): ReplayToolEvent {
        return {
            taskId: orphanCall.taskId,
            seq,
            kind: 'tool-result',
            toolCallId: orphanCall.toolCallId,
            toolName: orphanCall.toolName,
            result: {
                error: {
                    code: 'TOOL_RESULT_MISSING',
                    message:
                        'Missing tool_result event for persisted tool-call; reconciled as synthetic failure',
                    details: {
                        source: 'replay-reconciliation',
                        toolCallId: orphanCall.toolCallId,
                        toolName: orphanCall.toolName,
                    },
                },
            },
            isError: true,
        };
    }

    private parseToolResult(value: unknown): unknown {
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        }

        return value;
    }

    /**
     * Build user message content from input
     * Returns MessageContent format compatible with DB schema (ContentPart)
     */
    private buildUserMessageContent(input: StreamChatInput): { type: 'text'; text: string } | { type: 'multipart'; parts: ContentPart[] } {
        // Simple text message
        if (input.text && (!input.files || input.files.length === 0)) {
            return { type: 'text', text: input.text };
        }

        // Multipart with files - use ContentPart format (DB schema)
        const parts: ContentPart[] = [];

        if (input.text) {
            parts.push({ type: 'text', text: input.text });
        }

        if (input.files) {
            for (const file of input.files) {
                // Determine if it's an image or generic file
                const isImage = file.mediaType?.startsWith('image/');

                if (isImage) {
                    parts.push({
                        type: 'image',
                        imageData: file.data, // Base64 data
                        altText: file.filename,
                    });
                } else {
                    parts.push({
                        type: 'file',
                        fileReferenceId: file.url || file.data, // URL or inline data
                        altText: file.filename,
                    });
                }
            }
        }

        return { type: 'multipart', parts };
    }
}
