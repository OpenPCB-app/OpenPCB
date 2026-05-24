import { NotFoundError, ValidationError } from "../../../core/contracts/errors";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import {
  MODULE_SDK_TOKENS,
  type AssistantChat,
  type AssistantContextBindingDto,
  type AssistantPromptPreset,
  type AssistantProviderConfig,
  type AssistantProviderConfigInput,
  type AssistantProviderModel,
  type AssistantSettings,
  type AssistantToolEventDto,
  type AiProviderCapabilities,
  type CreateAssistantChatInput,
  type ProviderTestResult,
  type SubmitAssistantMessageInput,
  type SubmitAssistantMessageResult,
  type TasksSDK,
} from "../../../sdks";
import { ConversationStore } from "./conversation-store";
import { ProviderStore, type InternalProviderConfig } from "./provider-store";
import { SettingsStore } from "./settings-store";
import { PromptService } from "./prompt-service";
import { ContextResolver } from "./context-resolver";
import { RunService } from "./run-service";
import { buildOpenpcbToolRegistry } from "./tools/openpcb-tool-registry";
import {
  buildAiProviderClient,
  providerRequiresApiKey,
} from "./providers/openpcb-provider-factory";

let service: AssistantService | null = null;

export class AssistantService {
  readonly conversation: ConversationStore;
  readonly providers: ProviderStore;
  readonly settings: SettingsStore;
  readonly prompts: PromptService;
  readonly contextResolver: ContextResolver;
  readonly runService: RunService;
  private readonly tasks: TasksSDK;

  constructor(private readonly ctx: CoreBackendModuleContext) {
    this.providers = new ProviderStore(ctx);
    this.providers.ensureDefaults();
    this.conversation = new ConversationStore(ctx);
    this.settings = new SettingsStore(ctx, this.providers);
    this.settings.ensureDefaults();
    this.prompts = new PromptService();
    this.contextResolver = new ContextResolver(ctx, this.conversation);

    const tasks = ctx.sdk.get<TasksSDK>(MODULE_SDK_TOKENS.TASKS);
    if (!tasks) throw new Error("TasksSDK not registered");
    this.tasks = tasks;

    this.runService = new RunService({
      ctx,
      conversation: this.conversation,
      providers: this.providers,
      settings: this.settings,
      prompts: this.prompts,
      contextResolver: this.contextResolver,
      buildRegistry: (allowRawToolData) =>
        buildOpenpcbToolRegistry(ctx, this.contextResolver, {
          allowRawToolData,
        }),
    });
  }

  // ─── chats ────────────────────────────────────────────────────────────
  createChat(input: CreateAssistantChatInput = {}): AssistantChat {
    const settings = this.settings.getSettings();
    const providerConfigId =
      input.providerConfigId ?? settings.defaultProviderId;
    const provider = this.requireProvider(providerConfigId);
    return this.conversation.createChat({
      title: input.title ?? "New chat",
      providerConfigId: provider.id,
      model: input.model ?? provider.defaultModel,
      promptPresetId: input.promptPresetId ?? settings.defaultPromptPresetId,
    });
  }

  async submitMessage(
    chatId: string,
    input: SubmitAssistantMessageInput,
  ): Promise<SubmitAssistantMessageResult> {
    this.assertValidChatId(chatId);
    if (!input.content?.trim())
      throw new ValidationError("Message content is required");
    let chat = this.conversation.getChat(chatId);
    if (!chat) throw new NotFoundError(`Chat not found: ${chatId}`);

    const providerConfigId = input.providerConfigId ?? chat.providerConfigId;
    const provider = this.requireUsableProvider(providerConfigId);
    const model = input.model ?? chat.model;
    const promptPresetId = input.promptPresetId ?? chat.promptPresetId;
    chat = this.conversation.updateChat(chatId, {
      providerConfigId: provider.id,
      model,
      promptPresetId,
    });

    const userMessage = this.conversation.createMessage({
      chatId,
      role: "user",
      content: input.content,
    });
    const assistantMessage = this.conversation.createMessage({
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
        providerConfigId: provider.id,
        model,
      },
      correlation: { scopeId: chatId },
      tags: ["assistant", provider.id],
    });
    this.conversation.setMessageTask(assistantMessage.id, result.task.id);

    return {
      chat,
      userMessage,
      assistantMessage:
        this.conversation.getMessage(assistantMessage.id) ?? assistantMessage,
      taskId: result.task.id,
    };
  }

  // ─── prompt presets ───────────────────────────────────────────────────
  listPromptPresets(): AssistantPromptPreset[] {
    return this.prompts.listPresets();
  }

  // ─── context bindings ─────────────────────────────────────────────────
  listContextBindings(chatId: string): AssistantContextBindingDto[] {
    this.assertValidChatId(chatId);
    return this.contextResolver.listBindings(chatId);
  }

  deleteContextBinding(chatId: string, bindingId: string): void {
    this.assertValidChatId(chatId);
    this.conversation.deleteBinding(bindingId);
  }

  // ─── tool events ──────────────────────────────────────────────────────
  listToolEvents(
    chatId: string,
    options: { messageId?: string } = {},
  ): AssistantToolEventDto[] {
    this.assertValidChatId(chatId);
    return this.conversation.listToolEvents(chatId, options);
  }

  // ─── settings ─────────────────────────────────────────────────────────
  getSettings(): AssistantSettings {
    return this.settings.getSettings();
  }
  updateSettings(input: Partial<AssistantSettings>): AssistantSettings {
    return this.settings.updateSettings(input);
  }

  // ─── providers ────────────────────────────────────────────────────────
  listProviders(): AssistantProviderConfig[] {
    return this.providers.listProviders();
  }
  createProvider(input: AssistantProviderConfigInput): AssistantProviderConfig {
    return this.providers.createProvider(input);
  }
  updateProvider(
    id: string,
    input: AssistantProviderConfigInput,
  ): AssistantProviderConfig {
    return this.providers.updateProvider(id, input);
  }
  deleteProvider(id: string): void {
    this.providers.deleteProvider(id);
  }
  listProviderModels(id: string): AssistantProviderModel[] {
    return this.providers.listModels(id);
  }
  async refreshProviderModels(id: string): Promise<AssistantProviderModel[]> {
    const provider = this.requireUsableProvider(id);
    const client = buildAiProviderClient(provider);
    const models = await client.listModels();
    const ids = models.map((m) => m.modelId);
    if (ids.length > 0 && !ids.includes(provider.defaultModel)) {
      this.providers.updateProvider(provider.id, { defaultModel: ids[0] });
    }
    return this.providers.replaceModels(provider.id, ids);
  }
  async testProvider(
    id: string,
    input: { includeCompletion?: boolean } = {},
  ): Promise<ProviderTestResult> {
    const provider = this.requireUsableProvider(id);
    const client = buildAiProviderClient(provider);
    const checkedAt = new Date().toISOString();
    let modelsAvailable = 0;
    let toolCallSupported = false;
    let message = "";
    try {
      const models = await client.listModels();
      modelsAvailable = models.length;
      this.providers.replaceModels(
        provider.id,
        models.map((m) => m.modelId),
      );
      message = `Listed ${modelsAvailable} model(s).`;
    } catch (err) {
      message = `List models failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (input.includeCompletion) {
      const caps = await client.capabilities();
      this.providers.saveCapabilities(provider.id, caps);
      toolCallSupported = caps.toolCalling;
      message += caps.toolCalling
        ? " Tool-call probe passed."
        : ` Tool-call probe failed${caps.warning ? `: ${caps.warning}` : "."}`;
    }
    return {
      ok: modelsAvailable > 0,
      checkedAt,
      modelsAvailable,
      completionTested: Boolean(input.includeCompletion),
      toolCallSupported,
      message,
    };
  }
  getProviderCapabilities(id: string): AiProviderCapabilities | null {
    return this.providers.getCapabilities(id);
  }
  async refreshProviderCapabilities(
    id: string,
  ): Promise<AiProviderCapabilities> {
    const provider = this.requireUsableProvider(id);
    const client = buildAiProviderClient(provider);
    const caps = await client.capabilities();
    this.providers.saveCapabilities(provider.id, caps);
    return caps;
  }

  // ─── helpers ──────────────────────────────────────────────────────────
  private assertValidChatId(chatId: string): void {
    if (!chatId || chatId === "undefined" || chatId === "null") {
      throw new ValidationError("A valid chat id is required");
    }
  }

  private requireProvider(providerId: string): InternalProviderConfig {
    const provider = this.providers.getProviderInternal(providerId);
    if (!provider)
      throw new ValidationError(`Provider not found: ${providerId}`);
    return provider;
  }

  private requireUsableProvider(providerId: string): InternalProviderConfig {
    const provider = this.requireProvider(providerId);
    if (!provider.enabled)
      throw new ValidationError(`Provider disabled: ${provider.label}`);
    if (!provider.baseUrl.trim())
      throw new ValidationError(`Provider ${provider.label} has no base URL`);
    if (providerRequiresApiKey(provider) && !provider.apiKey) {
      // Dev-mode bypass for OpenAI without API key.
      if (provider.kind === "openai" && process.env.NODE_ENV !== "production")
        return provider;
      throw new ValidationError(
        `API key required for provider: ${provider.label}`,
      );
    }
    return provider;
  }
}

export function initializeAssistantService(
  ctx: CoreBackendModuleContext,
): AssistantService {
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
