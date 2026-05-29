import {
  runChat,
  resolveToolLimits,
  AiToolRegistry,
  type AiChatMessage,
  type AiRunEvent,
  type AiToolCall,
} from "@openpcb/ai-core";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import {
  MODULE_SDK_TOKENS,
  type AssistantToolCallSummary,
  type AssistantToolEventDto,
  type AssistantMessageMetadata,
  type AssistantMessage,
  type TasksSDK,
  type TaskExecutionContext,
} from "../../../sdks";
import type { ConversationStore } from "./conversation-store";
import type { ProviderStore } from "./provider-store";
import type { SettingsStore } from "./settings-store";
import type { PromptService } from "./prompt-service";
import type { ContextResolver } from "./context-resolver";
import { buildAiProviderClient } from "./providers/openpcb-provider-factory";

export interface SubmitPayload {
  chatId: string;
  assistantMessageId: string;
  providerConfigId: string;
  model: string;
}

export interface RunServiceOptions {
  ctx: CoreBackendModuleContext;
  conversation: ConversationStore;
  providers: ProviderStore;
  settings: SettingsStore;
  prompts: PromptService;
  contextResolver: ContextResolver;
  buildRegistry: (allowRawToolData: boolean) => AiToolRegistry;
  /** Injectable provider-client factory (defaults to buildAiProviderClient); tests override. */
  buildClient?: typeof buildAiProviderClient;
}

/** Per-turn signals captured from ai-core events for fallback decisions + metadata. */
interface AssistantTurnState {
  reasoning?: string;
  finishReason?: string;
  truncated?: boolean;
}

/**
 * Tools exposed when no design is bound to the chat: library reads plus the two
 * designer entry points. The full designer read+write set is only sent once a
 * design is bound — this keeps the per-call schema payload small enough that
 * reasoning models reliably emit content/tool calls instead of going empty.
 */
const UNBOUND_TOOL_NAMES = new Set<string>([
  "library_search_components",
  "library_resolve_bom",
  "library_get_component_detail",
  "designer_resolve_design",
  "designer_create_design",
]);

function stageRegistryForBindings(
  full: AiToolRegistry,
  hasBoundDesign: boolean,
): AiToolRegistry {
  if (hasBoundDesign) return full;
  const staged = new AiToolRegistry();
  for (const tool of full.list()) {
    if (UNBOUND_TOOL_NAMES.has(tool.definition.name)) staged.register(tool);
  }
  return staged;
}

function isBlank(text: string | null | undefined): boolean {
  return !text || text.trim().length === 0;
}

export class RunService {
  private readonly tasks: TasksSDK;

  constructor(private readonly options: RunServiceOptions) {
    const tasks = options.ctx.sdk.get<TasksSDK>(MODULE_SDK_TOKENS.TASKS);
    if (!tasks) throw new Error("TasksSDK not registered");
    this.tasks = tasks;
    this.tasks.registerExecutor("assistant.chat", {
      execute: (taskCtx) =>
        this.execute(taskCtx as TaskExecutionContext<SubmitPayload>),
    });
  }

  private async execute(
    taskCtx: TaskExecutionContext<SubmitPayload>,
  ): Promise<unknown> {
    const payload = taskCtx.task.payload;
    const provider = this.options.providers.getProviderInternal(
      payload.providerConfigId,
    );
    if (!provider)
      throw new Error(`Provider not found: ${payload.providerConfigId}`);
    if (!provider.enabled)
      throw new Error(`Provider disabled: ${provider.label}`);

    const settings = this.options.settings.getSettings();
    const chat = this.options.conversation.getChat(payload.chatId);
    if (!chat) throw new Error(`Chat not found: ${payload.chatId}`);
    await this.options.contextResolver.refreshBindingHealth(payload.chatId);
    const bindings = this.options.contextResolver.listBindings(payload.chatId);

    const configuredRegistry = this.options.buildRegistry(
      settings.allowRawToolData,
    );
    const providerAllowsTools = provider.capabilities?.toolCalling !== false;
    const hasBoundDesign = bindings.some(
      (b) => b.kind === "design" && b.status === "active",
    );
    const registry = providerAllowsTools
      ? stageRegistryForBindings(configuredRegistry, hasBoundDesign)
      : new AiToolRegistry();
    const client = (this.options.buildClient ?? buildAiProviderClient)(
      provider,
    );
    const limits = resolveToolLimits({
      preference: settings.contextSizePreference,
      modelContextTokens: provider.capabilities?.maxContextTokens,
    });

    const systemBlocks = bindings
      .filter((b) => b.status === "active")
      .map((b, idx) => ({
        id: `binding-${b.id}`,
        title: `Bound ${b.kind} (${b.role})`,
        content: `${b.label} (refId=${b.refId})`,
        priority: 10 + idx,
      }));
    const systemPrompt = this.options.prompts.composeSystem(
      chat.promptPresetId,
      systemBlocks,
      { includeWriteTools: hasBoundDesign },
    );

    const history = orderMessagesForProvider(
      this.options.conversation.listMessages(payload.chatId, { limit: 200 })
        .items,
    );
    const messages: AiChatMessage[] = [
      { role: "system", content: systemPrompt },
    ];
    for (const m of history) {
      if (m.id === payload.assistantMessageId) continue;
      if (m.role === "user") {
        messages.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        const tcRaw = m.toolCallsJson
          ? safeParseArray<AiToolCall>(m.toolCallsJson)
          : null;
        messages.push({
          role: "assistant",
          content: m.content,
          toolCalls: tcRaw && tcRaw.length > 0 ? tcRaw : undefined,
        });
      } else if (m.role === "tool" && m.toolCallId) {
        messages.push({
          role: "tool",
          content: m.content,
          toolCallId: m.toolCallId,
          name: m.toolName ?? undefined,
        });
      }
    }

    // Snapshot the pre-run prompt; runChat mutates `messages` in place (appends
    // assistant/tool turns). The empty-completed retry reuses this clean copy.
    const initialMessages = messages.slice();
    const callSummaries = new Map<string, AssistantToolCallSummary>();
    const toolEventsByCall = new Map<string, AssistantToolEventDto>();
    const runState: AssistantTurnState = {};

    try {
      let failedEvent: AiRunEvent | null = null;
      for await (const event of runChat({
        client,
        registry,
        model: payload.model,
        messages,
        bindings,
        limits,
        chatId: payload.chatId,
        maxToolIterations: 4,
        signal: taskCtx.signal,
      })) {
        if (event.type === "run.failed") failedEvent = event;
        await this.handleEvent(
          event,
          payload,
          taskCtx,
          callSummaries,
          toolEventsByCall,
          runState,
        );
      }
      if (failedEvent && registry.listDefinitions().length > 0) {
        const warning =
          "Provider failed while tools were enabled. Retrying this answer in chat-only mode.";
        this.options.conversation.setMessageContent(
          payload.assistantMessageId,
          "",
        );
        this.options.conversation.appendMessageContent(
          payload.assistantMessageId,
          `_${warning}_\n\n`,
        );
        await taskCtx.emitChunk({ kind: "text", content: `_${warning}_\n\n` });
        callSummaries.clear();
        toolEventsByCall.clear();
        for await (const event of runChat({
          client,
          registry: new AiToolRegistry(),
          model: payload.model,
          messages: messages.filter((m) => m.role !== "tool" && !m.toolCalls),
          bindings,
          limits,
          chatId: payload.chatId,
          maxToolIterations: 1,
          signal: taskCtx.signal,
        })) {
          await this.handleEvent(
            event,
            payload,
            taskCtx,
            callSummaries,
            toolEventsByCall,
            runState,
          );
        }
      }

      // Empty-completed safety net: a reasoning model can finish a turn with no
      // visible content and no tool calls (it spent the turn on reasoning_content).
      // Retry once chat-only; if still empty, signal an empty_response so the UI
      // shows a retry affordance instead of a blank bubble.
      const answeredOrToolWork = () =>
        !isBlank(
          this.options.conversation.getMessage(payload.assistantMessageId)
            ?.content,
        ) || callSummaries.size > 0;
      if (!answeredOrToolWork() && !failedEvent) {
        for await (const event of runChat({
          client,
          registry: new AiToolRegistry(),
          model: payload.model,
          messages: initialMessages.filter(
            (m) => m.role !== "tool" && !m.toolCalls,
          ),
          bindings,
          limits,
          chatId: payload.chatId,
          maxToolIterations: 1,
          signal: taskCtx.signal,
        })) {
          await this.handleEvent(
            event,
            payload,
            taskCtx,
            callSummaries,
            toolEventsByCall,
            runState,
          );
        }
      }
      const emptyResponse = !answeredOrToolWork();
      if (emptyResponse) {
        await this.emitAiEvent(taskCtx, {
          type: "run.warning",
          runId: payload.chatId,
          timestamp: new Date().toISOString(),
          data: {
            code: "empty_response",
            message: "The model returned no answer.",
          },
        });
      }

      // Persist final summaries + reasoning/diagnostics onto the assistant message metadata.
      const summaries = Array.from(callSummaries.values());
      const totalSources = summaries.reduce((acc, s) => acc + s.sourceCount, 0);
      const metadata: AssistantMessageMetadata = {
        ai: {
          toolCallSummaries: summaries,
          totalSources,
          ...(runState.reasoning ? { reasoning: runState.reasoning } : {}),
          ...(runState.truncated ? { truncated: true } : {}),
          ...(emptyResponse ? { emptyResponse: true } : {}),
        },
      };
      this.options.conversation.setMessageMetadata(
        payload.assistantMessageId,
        metadata,
      );
      return {
        messageId: payload.assistantMessageId,
        toolCallCount: summaries.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.conversation.appendMessageContent(
        payload.assistantMessageId,
        `\n\n_Error: ${message}_`,
      );
      throw err;
    }
  }

  private async emitAiEvent(
    taskCtx: TaskExecutionContext<SubmitPayload>,
    event: AiRunEvent,
  ): Promise<void> {
    await taskCtx.emitChunk({
      kind: "json",
      content: JSON.stringify({ _aiEvent: event }),
    });
  }

  private async handleEvent(
    event: AiRunEvent,
    payload: SubmitPayload,
    taskCtx: TaskExecutionContext<SubmitPayload>,
    callSummaries: Map<string, AssistantToolCallSummary>,
    toolEventsByCall: Map<string, AssistantToolEventDto>,
    runState: AssistantTurnState,
  ): Promise<void> {
    switch (event.type) {
      case "run.message.delta":
        this.options.conversation.appendMessageContent(
          payload.assistantMessageId,
          event.data.delta,
        );
        await taskCtx.emitChunk({ kind: "text", content: event.data.delta });
        break;
      case "run.message.completed":
        if (event.data.reasoningContent)
          runState.reasoning = event.data.reasoningContent;
        if (event.data.finishReason)
          runState.finishReason = event.data.finishReason;
        if (event.data.toolCallCount > 0) {
          this.options.conversation.createMessage({
            chatId: payload.chatId,
            role: "assistant",
            content: event.data.content,
            toolCallsJson: JSON.stringify(event.data.toolCalls ?? []),
            taskId: taskCtx.task.id,
            metadata: { ai: { internal: true } },
          });
        }
        await this.emitAiEvent(taskCtx, event);
        break;
      case "run.tool.requested": {
        const dto = this.options.conversation.upsertToolEvent({
          chatId: payload.chatId,
          taskId: taskCtx.task.id,
          messageId: payload.assistantMessageId,
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          status: "requested",
          argumentsJson: event.data.argumentsJson,
        });
        toolEventsByCall.set(event.data.toolCallId, dto);
        callSummaries.set(event.data.toolCallId, {
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          status: "requested",
          sourceCount: 0,
          truncated: false,
          warnings: [],
        });
        await taskCtx.emitChunk({
          kind: "json",
          content: JSON.stringify({ _aiEvent: event }),
        });
        break;
      }
      case "run.tool.running": {
        const summary = callSummaries.get(event.data.toolCallId);
        if (summary) summary.status = "running";
        const dto = this.options.conversation.upsertToolEvent({
          id: toolEventsByCall.get(event.data.toolCallId)?.id,
          chatId: payload.chatId,
          taskId: taskCtx.task.id,
          messageId: payload.assistantMessageId,
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          status: "running",
          argumentsJson:
            toolEventsByCall.get(event.data.toolCallId)?.argumentsJson ?? "{}",
        });
        toolEventsByCall.set(event.data.toolCallId, dto);
        await taskCtx.emitChunk({
          kind: "json",
          content: JSON.stringify({ _aiEvent: event }),
        });
        break;
      }
      case "run.tool.succeeded": {
        const summary = callSummaries.get(event.data.toolCallId);
        if (summary) {
          summary.status = "succeeded";
          summary.sourceCount = event.data.sources.length;
          summary.truncated = event.data.truncated;
          summary.warnings = event.data.warnings;
        }
        const argsJson =
          toolEventsByCall.get(event.data.toolCallId)?.argumentsJson ?? "{}";
        const dto = this.options.conversation.upsertToolEvent({
          id: toolEventsByCall.get(event.data.toolCallId)?.id,
          chatId: payload.chatId,
          taskId: taskCtx.task.id,
          messageId: payload.assistantMessageId,
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          status: "succeeded",
          argumentsJson: argsJson,
          resultJson: event.data.resultJson,
          sources: event.data.sources,
        });
        toolEventsByCall.set(event.data.toolCallId, dto);
        this.options.conversation.createMessage({
          chatId: payload.chatId,
          role: "tool",
          content: event.data.resultJson,
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          taskId: taskCtx.task.id,
          metadata: { ai: { internal: true } },
        });
        await taskCtx.emitChunk({
          kind: "json",
          content: JSON.stringify({ _aiEvent: event }),
        });
        break;
      }
      case "run.tool.failed": {
        const summary = callSummaries.get(event.data.toolCallId);
        if (summary) {
          summary.status = "failed";
          summary.warnings = [event.data.errorMessage];
        }
        const argsJson =
          toolEventsByCall.get(event.data.toolCallId)?.argumentsJson ?? "{}";
        const dto = this.options.conversation.upsertToolEvent({
          id: toolEventsByCall.get(event.data.toolCallId)?.id,
          chatId: payload.chatId,
          taskId: taskCtx.task.id,
          messageId: payload.assistantMessageId,
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          status: "failed",
          argumentsJson: argsJson,
          errorJson: JSON.stringify({
            message: event.data.errorMessage,
            code: event.data.errorCode,
          }),
        });
        toolEventsByCall.set(event.data.toolCallId, dto);
        this.options.conversation.createMessage({
          chatId: payload.chatId,
          role: "tool",
          content: JSON.stringify({
            ok: false,
            error: event.data.errorMessage,
          }),
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          taskId: taskCtx.task.id,
          metadata: { ai: { internal: true } },
        });
        await taskCtx.emitChunk({
          kind: "json",
          content: JSON.stringify({ _aiEvent: event }),
        });
        break;
      }
      case "run.warning":
        if (event.data.code === "truncated") runState.truncated = true;
        await this.emitAiEvent(taskCtx, event);
        break;
      case "run.started":
      case "run.completed":
      case "run.failed":
      case "run.cancelled":
        await this.emitAiEvent(taskCtx, event);
        break;
    }
  }
}

function safeParseArray<T>(json: string): T[] | null {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
}

function orderMessagesForProvider(
  messages: AssistantMessage[],
): AssistantMessage[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const messageA = a.message;
      const messageB = b.message;
      if (messageA.taskId && messageA.taskId === messageB.taskId) {
        const delta = providerTurnOrder(messageA) - providerTurnOrder(messageB);
        if (delta !== 0) return delta;
      }
      return a.index - b.index;
    })
    .map(({ message }) => message);
}

function providerTurnOrder(message: {
  role: string;
  metadata: AssistantMessageMetadata | null;
}): number {
  const internal = message.metadata?.ai?.internal === true;
  if (internal && message.role === "assistant") return 0;
  if (internal && message.role === "tool") return 1;
  return 2;
}
