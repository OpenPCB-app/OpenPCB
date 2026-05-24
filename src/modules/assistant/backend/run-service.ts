import {
  runChat,
  resolveToolLimits,
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
  type TasksSDK,
  type TaskExecutionContext,
} from "../../../sdks";
import type { ConversationStore } from "./conversation-store";
import type { ProviderStore } from "./provider-store";
import type { SettingsStore } from "./settings-store";
import type { PromptService } from "./prompt-service";
import type { ContextResolver } from "./context-resolver";
import type { AiToolRegistry } from "@openpcb/ai-core";
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
    const bindings = this.options.contextResolver.listBindings(payload.chatId);

    const registry = this.options.buildRegistry(settings.allowRawToolData);
    const client = buildAiProviderClient(provider);
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
    );

    const history = this.options.conversation.listMessages(payload.chatId);
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

    const callSummaries = new Map<string, AssistantToolCallSummary>();
    const toolEventsByCall = new Map<string, AssistantToolEventDto>();

    try {
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
        await this.handleEvent(
          event,
          payload,
          taskCtx,
          callSummaries,
          toolEventsByCall,
        );
      }
      // Persist final summaries onto the assistant message metadata.
      const summaries = Array.from(callSummaries.values());
      const totalSources = summaries.reduce((acc, s) => acc + s.sourceCount, 0);
      const metadata: AssistantMessageMetadata = {
        ai: {
          toolCallSummaries: summaries,
          totalSources,
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

  private async handleEvent(
    event: AiRunEvent,
    payload: SubmitPayload,
    taskCtx: TaskExecutionContext<SubmitPayload>,
    callSummaries: Map<string, AssistantToolCallSummary>,
    toolEventsByCall: Map<string, AssistantToolEventDto>,
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
        await taskCtx.emitChunk({
          kind: "json",
          content: JSON.stringify({ _aiEvent: event }),
        });
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
        this.options.conversation.upsertToolEvent({
          chatId: payload.chatId,
          taskId: taskCtx.task.id,
          messageId: payload.assistantMessageId,
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          status: "running",
          argumentsJson:
            toolEventsByCall.get(event.data.toolCallId)?.argumentsJson ?? "{}",
        });
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
        this.options.conversation.upsertToolEvent({
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
        this.options.conversation.upsertToolEvent({
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
        await taskCtx.emitChunk({
          kind: "json",
          content: JSON.stringify({ _aiEvent: event }),
        });
        break;
      }
      case "run.warning":
      case "run.started":
      case "run.completed":
      case "run.failed":
      case "run.cancelled":
        await taskCtx.emitChunk({
          kind: "json",
          content: JSON.stringify({ _aiEvent: event }),
        });
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
