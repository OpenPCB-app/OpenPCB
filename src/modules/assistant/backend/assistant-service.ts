import { NotFoundError, ValidationError } from "../../../core/contracts/errors";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import {
  MODULE_SDK_TOKENS,
  type AssistantChat,
  type AssistantContextBindingDto,
  type AssistantPromptPreset,
  type AssistantPromptPresetId,
  type AssistantProviderConfig,
  type AssistantProviderConfigInput,
  type AssistantProviderModel,
  type AssistantSettings,
  type AssistantToolEventDto,
  type AssistantWriteProposalDto,
  type AssistantPlacementApplyResult,
  type AiProviderCapabilities,
  type CreateAssistantChatInput,
  type ProviderTestResult,
  type SubmitAssistantMessageInput,
  type SubmitAssistantMessageResult,
  type TasksSDK,
  type DesignerSDK,
} from "../../../sdks";
import { ConversationStore } from "./conversation-store";
import { ProviderStore, type InternalProviderConfig } from "./provider-store";
import { SettingsStore } from "./settings-store";
import { PromptService } from "./prompt-service";
import { ContextResolver } from "./context-resolver";
import { RunService } from "./run-service";
import { buildOpenpcbToolRegistry } from "./tools/openpcb-tool-registry";
import {
  applyAssistantWriteProposal,
  applyFailureResult,
} from "./proposals/proposal-apply-service";
import type { SchematicApplyResult } from "./tools/designer-tools";
import {
  AssistantWriteSessionPolicy,
  type AssistantSessionWriteAllowance,
} from "./write-session-policy";
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
  readonly writeSessionPolicy = new AssistantWriteSessionPolicy();
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
        buildOpenpcbToolRegistry(ctx, this.contextResolver, this.conversation, {
          allowRawToolData,
          designerTools: {
            // Non-destructive schematic edits (place / wire / move / update)
            // auto-apply immediately — they are revertible via designer undo.
            // Destructive proposals (deletions) still require an explicit
            // per-session allowance.
            isSessionAutoApplyAllowed: (input) =>
              input.riskLevel !== "destructive" ||
              this.writeSessionPolicy.isAllowed(input),
          },
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

  async listDesignChats(designId: string): Promise<AssistantChat[]> {
    await this.requireDesign(designId);
    return this.conversation.listChatsForDesign(designId);
  }

  async createDesignChat(input: {
    designId: string;
    title?: string;
    providerConfigId?: string;
    model?: string;
    promptPresetId?: AssistantPromptPresetId;
  }): Promise<AssistantChat> {
    const design = await this.requireDesign(input.designId);
    const settings = this.settings.getSettings();
    const providerConfigId =
      input.providerConfigId ?? settings.defaultProviderId;
    const provider = this.requireProvider(providerConfigId);
    const chat = this.conversation.createChat({
      title: input.title ?? `${design.name} chat`,
      providerConfigId: provider.id,
      model: input.model ?? provider.defaultModel,
      promptPresetId: input.promptPresetId ?? settings.defaultPromptPresetId,
      metadata: {
        scope: "designer",
        designId: design.id,
        designName: design.name,
      },
    });
    await this.contextResolver.bindDesign(chat.id, {
      id: design.id,
      name: design.name,
    });
    return chat;
  }

  async ensureDesignChat(designId: string): Promise<AssistantChat> {
    const existing = await this.listDesignChats(designId);
    if (existing[0]) return existing[0];
    return this.createDesignChat({ designId });
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
    this.conversation.deleteBinding(chatId, bindingId);
  }

  // ─── tool events ──────────────────────────────────────────────────────
  listToolEvents(
    chatId: string,
    options: { messageId?: string; messageIds?: string[] } = {},
  ): AssistantToolEventDto[] {
    this.assertValidChatId(chatId);
    return this.conversation.listToolEvents(chatId, options);
  }

  // ─── write proposals ─────────────────────────────────────────────────
  listWriteProposals(chatId: string): AssistantWriteProposalDto[] {
    this.assertValidChatId(chatId);
    return this.conversation.listWriteProposals(chatId);
  }

  async applyWriteProposal(
    chatId: string,
    proposalId: string,
    input: { allowPartial?: boolean } = {},
  ): Promise<AssistantPlacementApplyResult | SchematicApplyResult> {
    this.assertValidChatId(chatId);
    const record = this.conversation.getWriteProposal(chatId, proposalId);
    if (!record)
      throw new NotFoundError(`Write proposal not found: ${proposalId}`);
    if (record.status !== "pending") {
      throw new ValidationError(`Write proposal is already ${record.status}`);
    }
    const designer = this.ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    if (!designer) throw new ValidationError("Designer module not available");
    try {
      const result = await applyAssistantWriteProposal({
        designer,
        record,
        allowPartial: input.allowPartial === true,
      });
      const proposalStatus = writeProposalStatusFromApplyResult(result);
      this.conversation.updateWriteProposalStatus(
        chatId,
        proposalId,
        proposalStatus,
        result,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Confirm partial apply")) {
        throw new ValidationError(message);
      }
      const failureResult = applyFailureResult(err);
      this.conversation.updateWriteProposalStatus(
        chatId,
        proposalId,
        writeProposalStatusFromApplyResult(failureResult),
        failureResult ?? { message },
      );
      if (failureResult) {
        return failureResult as
          | AssistantPlacementApplyResult
          | SchematicApplyResult;
      }
      throw new ValidationError(message);
    }
  }

  rejectWriteProposal(
    chatId: string,
    proposalId: string,
  ): AssistantWriteProposalDto {
    this.assertValidChatId(chatId);
    const record = this.conversation.getWriteProposal(chatId, proposalId);
    if (!record)
      throw new NotFoundError(`Write proposal not found: ${proposalId}`);
    if (record.status !== "pending") {
      throw new ValidationError(`Write proposal is already ${record.status}`);
    }
    return this.conversation.updateWriteProposalStatus(
      chatId,
      proposalId,
      "rejected",
    );
  }

  listSessionWriteAllowances(chatId: string): AssistantSessionWriteAllowance[] {
    this.assertValidChatId(chatId);
    return this.writeSessionPolicy.list(chatId);
  }

  allowSessionWriteTool(
    chatId: string,
    input: { toolName?: unknown; proposalKind?: unknown; riskLevel?: unknown },
  ): AssistantSessionWriteAllowance {
    this.assertValidChatId(chatId);
    const toolName =
      typeof input.toolName === "string" ? input.toolName.trim() : "";
    const proposalKind =
      typeof input.proposalKind === "string" ? input.proposalKind.trim() : "";
    if (!toolName) throw new ValidationError("Tool name is required");
    if (!proposalKind) throw new ValidationError("Proposal kind is required");
    return this.writeSessionPolicy.allow({
      chatId,
      toolName,
      proposalKind,
      riskLevel: typeof input.riskLevel === "string" ? input.riskLevel : null,
    });
  }

  revokeSessionWriteAllowance(chatId: string, key: string): void {
    this.assertValidChatId(chatId);
    this.writeSessionPolicy.revoke(chatId, key);
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
      const caps = await client.capabilities(undefined, provider.defaultModel);
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
    const caps = await client.capabilities(undefined, provider.defaultModel);
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
      throw new ValidationError(
        `API key required for provider: ${provider.label}`,
      );
    }
    return provider;
  }

  private async requireDesign(
    designId: string,
  ): Promise<{ id: string; name: string }> {
    if (!designId || designId === "undefined" || designId === "null") {
      throw new ValidationError("A valid design id is required");
    }
    const designer = this.ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    if (!designer) throw new ValidationError("Designer module not available");
    const design = await designer.getDesign(designId);
    if (!design) throw new NotFoundError(`Design not found: ${designId}`);
    return { id: design.head.id, name: design.head.name };
  }
}

function writeProposalStatusFromApplyResult(
  result: unknown,
): "applied" | "partial" | "failed" {
  if (result && typeof result === "object" && "status" in result) {
    const status = (result as { status?: unknown }).status;
    if (status === "applied" || status === "partial") return status;
  }
  return "failed";
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
