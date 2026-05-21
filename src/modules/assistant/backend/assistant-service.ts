import { NotFoundError, ValidationError } from "../../../core/contracts/errors";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import {
  MODULE_SDK_TOKENS,
  type AssistantChat,
  type AssistantProviderConfig,
  type AssistantProviderId,
  type AssistantProviderModel,
  type AssistantSettings,
  type AssistantProviderConfigInput,
  type ProviderTestResult,
  type SubmitAssistantMessageInput,
  type SubmitAssistantMessageResult,
  type TasksSDK,
} from "../../../sdks";
import { AssistantChatStore } from "./chat-store";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import type { AIProviderRequest, AIToolCall } from "./providers/types";
import { requiresConfirmation } from "./tools/confirmation-policy";
import { registerCoreTools } from "./tools/register-core-tools";
import {
  AssistantSettingsStore,
  type InternalProviderConfig,
} from "./settings-store";

let service: AssistantService | null = null;

export class AssistantService {
  readonly store: AssistantChatStore;
  readonly settings: AssistantSettingsStore;
  readonly tools: ReturnType<typeof registerCoreTools>;
  private readonly tasks: TasksSDK;

  constructor(private readonly ctx: CoreBackendModuleContext) {
    this.store = new AssistantChatStore(ctx);
    this.settings = new AssistantSettingsStore(ctx);
    this.settings.ensureDefaults();
    this.tools = registerCoreTools(ctx);
    const tasks = ctx.sdk.get<TasksSDK>(MODULE_SDK_TOKENS.TASKS);
    if (!tasks) throw new Error("TasksSDK not registered");
    this.tasks = tasks;
    this.registerExecutor();
  }

  createChat(
    input: {
      title?: string;
      providerConfigId?: string;
      provider?: AssistantProviderId;
      model?: string;
    } = {},
  ): AssistantChat {
    const appSettings = this.settings.getSettings();
    const providerConfigId =
      input.providerConfigId ?? input.provider ?? appSettings.defaultProviderId;
    const provider = this.requireProvider(providerConfigId);
    return this.store.createChat({
      ...input,
      providerConfigId: provider.id,
      provider: provider.id,
      model: input.model ?? provider.defaultModel,
    });
  }

  async submitMessage(
    chatId: string,
    input: SubmitAssistantMessageInput,
  ): Promise<SubmitAssistantMessageResult> {
    this.assertValidChatId(chatId);
    if (!input.content?.trim())
      throw new ValidationError("Message content is required");
    let chat = this.store.getChat(chatId);
    if (!chat) throw new NotFoundError(`Chat not found: ${chatId}`);
    const providerConfigId =
      input.providerConfigId ?? input.provider ?? chat.providerConfigId;
    const providerConfig = this.requireUsableProvider(providerConfigId);
    const provider = providerConfig.id;
    const model = input.model ?? chat.model;
    chat = this.store.updateChatModel(
      chatId,
      provider,
      model,
      providerConfig.id,
    );
    const userMessage = this.store.createMessage({
      chatId,
      role: "user",
      content: input.content,
    });
    const assistantMessage = this.store.createMessage({
      chatId,
      role: "assistant",
      content: "",
    });
    const result = await this.tasks.createTask({
      type: "assistant.chat",
      queueKey: "assistant",
      payload: {
        chatId,
        assistantMessageId: assistantMessage.id,
        providerConfigId: providerConfig.id,
        provider,
        model,
      },
      correlation: { scopeId: chatId },
      tags: ["assistant", providerConfig.id],
    });
    this.store.setMessageTask(assistantMessage.id, result.task.id);
    return {
      chat,
      userMessage,
      assistantMessage:
        this.store.getMessage(assistantMessage.id) ?? assistantMessage,
      taskId: result.task.id,
    };
  }

  private assertValidChatId(chatId: string): void {
    if (!chatId || chatId === "undefined" || chatId === "null") {
      throw new ValidationError("A valid chat id is required");
    }
  }

  async approveToolEvent(
    eventId: string,
  ): Promise<{ ok: true; followUpTaskId: string }> {
    const event = this.store.getToolEvent(eventId);
    if (!event) throw new Error(`Tool event not found: ${eventId}`);
    const tool = this.tools.get(event.toolName ?? "");
    if (!tool) throw new Error(`Tool ${event.toolName} not found`);
    const result = await tool.execute(
      event.argsJson ? (JSON.parse(event.argsJson) as unknown) : {},
    );
    this.store.updateToolEventResult(eventId, JSON.stringify(result), false);
    const chat = this.store.getChat(event.chatId);
    const followUp = this.store.createMessage({
      chatId: event.chatId,
      role: "tool",
      content: JSON.stringify({ tool: event.toolName, result }),
    });
    const providerConfig = this.requireUsableProvider(
      chat?.providerConfigId ?? "openai",
    );
    const resultTask = await this.tasks.createTask({
      type: "assistant.chat",
      queueKey: "assistant",
      payload: {
        chatId: event.chatId,
        assistantMessageId: event.assistantMessageId,
        providerConfigId: providerConfig.id,
        provider: providerConfig.id,
        model: chat?.model ?? providerConfig.defaultModel,
      },
      correlation: { scopeId: event.chatId },
      tags: ["assistant", "follow-up"],
    });
    this.store.setMessageTask(followUp.id, resultTask.task.id);
    return { ok: true, followUpTaskId: resultTask.task.id };
  }

  rejectToolEvent(eventId: string): void {
    const event = this.store.getToolEvent(eventId);
    if (!event) throw new Error(`Tool event not found: ${eventId}`);
    this.store.updateToolEventResult(
      eventId,
      JSON.stringify({ rejected: true }),
      false,
    );
    this.store.createMessage({
      chatId: event.chatId,
      role: "tool",
      content: JSON.stringify({ tool: event.toolName, error: "User rejected" }),
    });
  }

  private registerExecutor(): void {
    this.tasks.registerExecutor("assistant.chat", {
      execute: async (taskCtx) => {
        const payload = taskCtx.task.payload as {
          chatId: string;
          assistantMessageId: string;
          providerConfigId?: string;
          provider: AssistantProviderId;
          model: string;
        };
        const providerConfig = this.requireUsableProvider(
          payload.providerConfigId ?? payload.provider,
        );
        const provider = this.createProvider(providerConfig);
        const toolDefs = this.tools.list().map((tool) => tool.definition);
        const maxToolIterations = 5;

        for (let iteration = 0; iteration < maxToolIterations; iteration++) {
          const messages = this.buildProviderMessages(
            payload.chatId,
            payload.assistantMessageId,
          );
          const response = await provider.stream({
            messages,
            model: payload.model,
            signal: taskCtx.signal,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
            onToken: async (token) => {
              this.store.appendMessageContent(
                payload.assistantMessageId,
                token,
              );
              await taskCtx.emitChunk({ content: token, kind: "text" });
            },
          });

          if (response.toolCalls.length === 0) {
            return {
              content: response.content,
              messageId: payload.assistantMessageId,
            };
          }

          const pending: AIToolCall[] = [];
          for (const call of response.toolCalls) {
            const tool = this.tools.get(call.name);
            await this.persistToolEvent(
              payload.chatId,
              payload.assistantMessageId,
              taskCtx.task.id,
              {
                kind: "tool_call",
                toolCallId: call.id,
                toolName: call.name,
                argsJson: call.argumentsJson,
              },
            );
            if (!tool) {
              this.store.createMessage({
                chatId: payload.chatId,
                role: "tool",
                content: JSON.stringify({
                  error: `Tool ${call.name} not found`,
                }),
              });
              continue;
            }
            if (
              requiresConfirmation(
                this.settings.getSettings().toolExecutionPolicy,
                tool.effect,
              )
            ) {
              pending.push(call);
              const notice = `\n\nTool ${call.name} requires confirmation before execution.`;
              this.store.appendMessageContent(
                payload.assistantMessageId,
                notice,
              );
              await taskCtx.emitChunk({
                content: JSON.stringify({
                  kind: "confirmation_required",
                  tool: call.name,
                  callId: call.id,
                }),
                kind: "json",
              });
              await this.persistToolEvent(
                payload.chatId,
                payload.assistantMessageId,
                taskCtx.task.id,
                {
                  kind: "confirmation_required",
                  toolCallId: call.id,
                  toolName: call.name,
                },
              );
              continue;
            }
            const result = await tool.execute(
              call.argumentsJson
                ? (JSON.parse(call.argumentsJson) as unknown)
                : {},
            );
            const toolMessage = this.store.createMessage({
              chatId: payload.chatId,
              role: "tool",
              content: JSON.stringify({ tool: call.name, result }),
            });
            await this.persistToolEvent(
              payload.chatId,
              payload.assistantMessageId,
              taskCtx.task.id,
              {
                kind: "tool_result",
                toolCallId: call.id,
                toolName: call.name,
                resultJson: JSON.stringify(result),
              },
            );
            await taskCtx.emitEvent({
              type: "task.progress",
              data: {
                kind: "tool_result",
                callId: call.id,
                messageId: toolMessage.id,
              },
            });
          }

          if (pending.length > 0) {
            return {
              content: response.content,
              messageId: payload.assistantMessageId,
              pendingToolCalls: pending,
            };
          }
        }

        return {
          content: "Reached maximum tool iterations.",
          messageId: payload.assistantMessageId,
        };
      },
    });
  }

  getSettings(): AssistantSettings {
    return this.settings.getSettings();
  }

  updateSettings(input: Partial<AssistantSettings>): AssistantSettings {
    return this.settings.updateSettings(input);
  }

  listProviders(): AssistantProviderConfig[] {
    return this.settings.listProviders();
  }

  createProviderConfig(
    input: AssistantProviderConfigInput,
  ): AssistantProviderConfig {
    return this.settings.createProvider(input);
  }

  updateProviderConfig(
    id: string,
    input: AssistantProviderConfigInput,
  ): AssistantProviderConfig {
    return this.settings.updateProvider(id, input);
  }

  deleteProviderConfig(id: string): void {
    this.settings.deleteProvider(id);
  }

  listProviderModels(providerId: string): AssistantProviderModel[] {
    const models = this.settings.listModels(providerId);
    return models.length > 0 ? models : [];
  }

  async refreshProviderModels(
    providerId: string,
  ): Promise<AssistantProviderModel[]> {
    const provider = this.requireUsableProvider(providerId);
    const modelIds = await this.createProvider(provider).listModels();
    if (modelIds.length > 0 && !modelIds.includes(provider.defaultModel)) {
      this.settings.updateProvider(provider.id, { defaultModel: modelIds[0] });
    }
    return this.settings.replaceModels(provider.id, modelIds);
  }

  async testProvider(
    providerId: string,
    input: { includeCompletion?: boolean } = {},
  ): Promise<ProviderTestResult> {
    const provider = this.requireUsableProvider(providerId);
    const client = this.createProvider(provider);
    const modelIds = await client.listModels();
    this.settings.replaceModels(provider.id, modelIds);
    const testModel = modelIds.includes(provider.defaultModel)
      ? provider.defaultModel
      : modelIds[0];
    if (!testModel)
      throw new ValidationError(
        `Provider ${provider.label} did not return any models`,
      );
    if (testModel !== provider.defaultModel) {
      this.settings.updateProvider(provider.id, { defaultModel: testModel });
    }
    if (input.includeCompletion) await client.testCompletion(testModel);
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      modelsAvailable: modelIds.length,
      completionTested: Boolean(input.includeCompletion),
      message: input.includeCompletion
        ? `Models listed and completion accepted with ${testModel}.`
        : "Models listed successfully.",
    };
  }

  private requireUsableProvider(providerId: string): InternalProviderConfig {
    const provider = this.requireProvider(providerId);
    if (!provider.enabled)
      throw new ValidationError(`Provider disabled: ${provider.label}`);
    if (!provider.baseUrl.trim())
      throw new ValidationError(`Provider ${provider.label} has no base URL`);
    // Allow submitting messages and creating placeholder tasks without an API key.
    // Execution may still fail later when the provider is actually invoked.
    // This keeps local UX and backend tests from requiring secrets.
    if (
      provider.kind === "openai" &&
      !provider.apiKey &&
      process.env.NODE_ENV !== "production"
    ) {
      return provider;
    }
    if (provider.kind === "openai" && !provider.apiKey)
      throw new ValidationError("OpenAI API key is required");
    return provider;
  }

  private requireProvider(providerId: string): InternalProviderConfig {
    const provider = this.settings.getProviderInternal(providerId);
    if (!provider)
      throw new ValidationError(`Provider not found: ${providerId}`);
    return provider;
  }

  private createProvider(
    provider: InternalProviderConfig,
  ): OpenAICompatibleProvider {
    return new OpenAICompatibleProvider(provider.id, {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey ?? undefined,
    });
  }

  private buildProviderMessages(
    chatId: string,
    excludeMessageId: string,
  ): AIProviderRequest["messages"] {
    return this.store
      .listMessages(chatId)
      .filter((message) => message.id !== excludeMessageId)
      .map((message) => ({
        role:
          message.role === "assistant"
            ? ("assistant" as const)
            : ("user" as const),
        content:
          message.role === "tool"
            ? `Tool result: ${message.content}`
            : message.content,
      }));
  }

  private async persistToolEvent(
    chatId: string,
    assistantMessageId: string,
    taskId: string,
    input: {
      kind: string;
      toolCallId?: string;
      toolName?: string;
      argsJson?: string;
      resultJson?: string;
      isError?: boolean;
    },
  ): Promise<void> {
    const row = {
      id: crypto.randomUUID(),
      chatId,
      assistantMessageId,
      taskId,
      seq: 0,
      kind: input.kind,
      toolCallId: input.toolCallId ?? null,
      toolName: input.toolName ?? null,
      argsJson: input.argsJson ?? null,
      resultJson: input.resultJson ?? null,
      isError: input.isError ? 1 : 0,
      createdAt: new Date().toISOString(),
    };
    const rawSql = (
      this.ctx.db as {
        rawSql<T = unknown>(query: string, params?: unknown[]): T[];
      }
    ).rawSql.bind(this.ctx.db);
    rawSql(
      "INSERT INTO assistant_task_tool_event (id,chat_id,assistant_message_id,task_id,seq,kind,tool_call_id,tool_name,args_json,result_json,is_error,created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        row.id,
        row.chatId,
        row.assistantMessageId,
        row.taskId,
        row.seq,
        row.kind,
        row.toolCallId,
        row.toolName,
        row.argsJson,
        row.resultJson,
        row.isError,
        row.createdAt,
      ],
    );
  }
}

export function initializeAssistantService(
  ctx: CoreBackendModuleContext,
): AssistantService {
  // Tests and dev tooling bootstrap module runtimes repeatedly with isolated DBs.
  // Recreate the service for each activation so routes/SDKs never hold stores for
  // a previous SQLite connection.
  service = new AssistantService(ctx);
  return service;
}

export function resetAssistantServiceForTesting(): void {
  service = null;
}

export function getAssistantService(): AssistantService {
  if (!service) throw new Error("Assistant service not initialized");
  return service;
}
