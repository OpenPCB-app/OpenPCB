import { NotFoundError, ValidationError } from "../../../core/contracts/errors";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import {
  MentionRegistry,
  parseMentions,
} from "../../../core/backend/mentions";
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
import { isFeatureEnabled } from "../../../core/contracts/feature-flags/backend";
import { ConversationStore } from "./conversation-store";
import { CloudRunService } from "./cloud/cloud-run-service";
import {
  approvePlan,
  getPlan,
  getWallet,
  patchPlan,
  postApplied,
  rejectProposal,
  resumeRun,
} from "./cloud/copilot-client";
import {
  sealCloudCredentials,
  type CloudCredentials,
} from "./cloud/token-crypto";
import {
  cloudProxyHeaders,
  resolveCloudWorkspace,
} from "./cloud/cloud-context";
import {
  ProviderStore,
  type InternalProviderConfig,
  type ToolCallingMode,
} from "./provider-store";
import { SettingsStore } from "./settings-store";
import { PromptService } from "./prompt-service";
import { ContextResolver } from "./context-resolver";
import { RunService } from "./run-service";
import { buildOpenpcbToolRegistry } from "./tools/openpcb-tool-registry";
import { registerExtendedReadTools } from "./tools/read-tools";
import { McpEndpoint } from "./mcp/handler";
import {
  McpConnectionRegistry,
  type ChatDefaults,
  type McpConnectionSummary,
} from "./mcp/connections";
import { McpCallRecorder } from "./mcp/call-recorder";
import type { AiToolRegistry } from "@openpcb/ai-core";
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

/** FNV-1a — a stable, dependency-free fingerprint (not a security hash). */
function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class AssistantService {
  readonly conversation: ConversationStore;
  readonly providers: ProviderStore;
  readonly settings: SettingsStore;
  readonly prompts: PromptService;
  readonly contextResolver: ContextResolver;
  readonly runService: RunService;
  readonly writeSessionPolicy = new AssistantWriteSessionPolicy();
  private readonly tasks: TasksSDK;
  private mcpEndpoint: McpEndpoint | null = null;
  private mcpConnections: McpConnectionRegistry | null = null;
  /** Keyed by `${allowWrites}:${allowRawToolData}` — both change the registry. */
  private readonly mcpRegistries = new Map<string, AiToolRegistry>();

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
    // S6: cloud chat mode — registers the assistant.cloud-chat executor.
    if (isFeatureEnabled("cloud.copilot")) {
      new CloudRunService({
        ctx,
        conversation: this.conversation,
        contextResolver: this.contextResolver,
      });
    }
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
    cloudCreds?: CloudCredentials | null,
  ): Promise<SubmitAssistantMessageResult> {
    this.assertValidChatId(chatId);
    if (!input.content?.trim())
      throw new ValidationError("Message content is required");
    let chat = this.conversation.getChat(chatId);
    if (!chat) throw new NotFoundError(`Chat not found: ${chatId}`);

    const cloudMode = input.mode === "cloud";
    if (cloudMode && !isFeatureEnabled("cloud.copilot")) {
      throw new ValidationError("Cloud Copilot mode is not enabled");
    }
    if (cloudMode && !cloudCreds) {
      throw new ValidationError(
        "Cloud Copilot mode needs cloud credentials (sign in to cloud first)",
      );
    }

    // Cloud mode talks to the copilot service — no local provider involved.
    const provider = cloudMode
      ? null
      : this.requireUsableProvider(input.providerConfigId ?? chat.providerConfigId);
    // The openpcb-cloud provider runs the LOCAL agent loop against the metered
    // LLM proxy; it carries no stored key, so a signed-in session is mandatory.
    if (provider?.kind === "openpcb-cloud" && !cloudCreds) {
      throw new ValidationError(
        "OpenPCB Cloud provider requires a signed-in cloud session.",
      );
    }
    // Workspace resolution (x-openpcb-workspace-id) needs cloud-api — fail fast
    // here instead of deep inside the detached run.
    if (provider?.kind === "openpcb-cloud" && !cloudCreds?.apiUrl) {
      throw new ValidationError(
        "OpenPCB Cloud provider requires the cloud API URL (x-cloud-api-url).",
      );
    }
    const model = input.model ?? chat.model;
    const promptPresetId = input.promptPresetId ?? chat.promptPresetId;
    if (provider) {
      chat = this.conversation.updateChat(chatId, {
        providerConfigId: provider.id,
        model,
        promptPresetId,
      });
    }

    const userMessage = this.conversation.createMessage({
      chatId,
      role: "user",
      content: input.content,
    });

    await this.processMentions(userMessage.id, input.content);

    const assistantMessage = this.conversation.createMessage({
      chatId,
      role: "assistant",
      content: "",
    });
    const result = cloudMode
      ? await this.tasks.createTask({
          type: "assistant.cloud-chat",
          queueKey: "assistant",
          payload: {
            chatId,
            assistantMessageId: assistantMessage.id,
            goal: input.content,
            // AES-GCM sealed {bearer, apiUrl, copilotUrl} — see token-crypto.ts.
            cloudCredsEnc: sealCloudCredentials(cloudCreds!),
          },
          correlation: { scopeId: chatId },
          tags: ["assistant", "cloud-copilot"],
        })
      : await this.tasks.createTask({
          type: "assistant.chat",
          queueKey: "assistant",
          payload: {
            chatId,
            assistantMessageId: assistantMessage.id,
            providerConfigId: provider!.id,
            model,
            // openpcb-cloud: seal the live bearer into the detached task (D8).
            ...(provider!.kind === "openpcb-cloud" && cloudCreds
              ? { cloudBearerEnc: sealCloudCredentials(cloudCreds) }
              : {}),
          },
          correlation: { scopeId: chatId },
          tags: ["assistant", provider!.id],
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

  // ─── cloud provider (D15 zero-config seed) ────────────────────────────
  /** Idempotently seed + enable the openpcb-cloud provider for a Pro session. */
  async seedCloudProvider(creds: CloudCredentials) {
    // The seed path writes the row directly (no assertProviderInput), so
    // validate the header-supplied URL here — garbage would brick every run.
    try {
      new URL(creds.copilotUrl);
    } catch {
      throw new ValidationError("Copilot URL must be a valid URL");
    }
    const baseUrl = `${creds.copilotUrl.replace(/\/+$/, "")}/v1/llm`;
    const defaultModel = await this.fetchDefaultCloudModel(
      baseUrl,
      creds.bearer,
    );
    return this.providers.seedCloudProvider({ baseUrl, defaultModel });
  }

  /** Disable the openpcb-cloud provider on tier loss. */
  disableCloudProvider(): void {
    this.providers.disableCloudProvider();
  }

  /** Best-effort fetch of the proxy's default model alias (D11/D15). */
  private async fetchDefaultCloudModel(
    baseUrl: string,
    bearer: string,
  ): Promise<string> {
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { authorization: `Bearer ${bearer}` },
        // Bounded: a hung proxy must not stall the seed route (falls back below).
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return "openpcb-fast";
      const bodyJson = (await res.json()) as {
        data?: Array<{ id?: string; default?: boolean }>;
      };
      const list = bodyJson.data ?? [];
      const chosen = list.find((m) => m.default) ?? list[0];
      return chosen?.id ?? "openpcb-fast";
    } catch {
      return "openpcb-fast";
    }
  }

  // ─── mentions ─────────────────────────────────────────────────────────
  private async processMentions(
    messageId: string,
    content: string,
  ): Promise<void> {
    const mentions = parseMentions(content);
    if (mentions.length === 0) return;

    const registry = MentionRegistry.get();
    const mentionRecords: Array<{
      messageId: string;
      entityType: string;
      entityId: string;
      displayText: string;
      snapshotData: Record<string, unknown>;
      snapshotCreatedAt: string;
      entityVersion: string;
      position: number;
    }> = [];

    for (const mention of mentions) {
      try {
        const snapshot = await registry.createSnapshot(
          mention.entityType,
          mention.entityId,
        );

        if (!snapshot) {
          console.warn(
            `[AssistantService] Entity not found for mention ${mention.entityType}:${mention.entityId}, skipping`,
          );
          continue;
        }

        mentionRecords.push({
          messageId,
          entityType: mention.entityType,
          entityId: mention.entityId,
          displayText: mention.displayText,
          snapshotData: snapshot.data,
          snapshotCreatedAt: snapshot.snapshotCreatedAt,
          entityVersion: snapshot.entityVersion,
          position: mention.position,
        });
      } catch (err) {
        console.warn(
          `[AssistantService] Failed to create snapshot for mention ${mention.entityType}:${mention.entityId}:`,
          err,
        );
      }
    }

    if (mentionRecords.length > 0) {
      await this.conversation.mentions.createMany(mentionRecords);
    }
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
    cloudCreds?: CloudCredentials | null,
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
      if (proposalStatus !== "failed") {
        this.notifyCloudProposal(record, "applied", cloudCreds);
      }
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
    cloudCreds?: CloudCredentials | null,
  ): AssistantWriteProposalDto {
    this.assertValidChatId(chatId);
    const record = this.conversation.getWriteProposal(chatId, proposalId);
    if (!record)
      throw new NotFoundError(`Write proposal not found: ${proposalId}`);
    if (record.status !== "pending") {
      throw new ValidationError(`Write proposal is already ${record.status}`);
    }
    const updated = this.conversation.updateWriteProposalStatus(
      chatId,
      proposalId,
      "rejected",
    );
    this.notifyCloudProposal(record, "rejected", cloudCreds);
    return updated;
  }

  /** S6: loop a local approve/reject back to the cloud-copilot run. Best-effort
   * fire-and-forget — the desktop stays authoritative; the copilot side is
   * idempotent. Skipped (with a log) when the request carried no cloud creds. */
  private notifyCloudProposal(
    record: AssistantWriteProposalDto,
    outcome: "applied" | "rejected",
    cloudCreds?: CloudCredentials | null,
  ): void {
    if (record.origin !== "cloud" || !record.cloudRunId || !record.cloudProposalId) {
      return;
    }
    if (!cloudCreds) {
      this.ctx.logger.warn("cloud proposal outcome not synced (no cloud creds)", {
        proposalId: record.id,
        outcome,
      });
      return;
    }
    const cctx = { copilotUrl: cloudCreds.copilotUrl, bearer: cloudCreds.bearer };
    const call =
      outcome === "applied"
        ? postApplied(cctx, record.cloudRunId, record.cloudProposalId, {})
        : rejectProposal(cctx, record.cloudRunId, record.cloudProposalId);
    void call.catch((err) => {
      this.ctx.logger.warn("cloud proposal outcome callback failed", {
        proposalId: record.id,
        outcome,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /** S7: cloud-plan proxy. Unlike proposal outcome sync (best-effort), plan
   * actions are cloud-only — missing creds is a hard error, not a skip. */
  private requireCloudCtx(cloudCreds?: CloudCredentials | null): {
    copilotUrl: string;
    bearer: string;
  } {
    if (!cloudCreds) {
      throw new ValidationError(
        "Cloud credentials required (x-cloud-bearer / x-cloud-copilot-url)",
      );
    }
    return { copilotUrl: cloudCreds.copilotUrl, bearer: cloudCreds.bearer };
  }

  getCloudPlan(
    chatId: string,
    runId: string,
    cloudCreds?: CloudCredentials | null,
  ): ReturnType<typeof getPlan> {
    this.assertValidChatId(chatId);
    return getPlan(this.requireCloudCtx(cloudCreds), runId);
  }

  /** Read-only remaining-credits balance for a workspace (cloud-only). Not
   * chat-scoped — the desktop surfaces it in the composer footer. */
  getCloudWallet(
    workspaceId: string,
    cloudCreds?: CloudCredentials | null,
  ): ReturnType<typeof getWallet> {
    const ws = workspaceId.trim();
    if (!ws) throw new ValidationError("workspaceId is required");
    return getWallet(this.requireCloudCtx(cloudCreds), ws);
  }

  patchCloudPlan(
    chatId: string,
    runId: string,
    req: Parameters<typeof patchPlan>[2],
    cloudCreds?: CloudCredentials | null,
  ): ReturnType<typeof patchPlan> {
    this.assertValidChatId(chatId);
    return patchPlan(this.requireCloudCtx(cloudCreds), runId, req);
  }

  approveCloudPlan(
    chatId: string,
    runId: string,
    cloudCreds?: CloudCredentials | null,
  ): Promise<{ status: string }> {
    this.assertValidChatId(chatId);
    return approvePlan(this.requireCloudCtx(cloudCreds), runId);
  }

  resumeCloudRun(
    chatId: string,
    runId: string,
    req: Parameters<typeof resumeRun>[2],
    cloudCreds?: CloudCredentials | null,
  ): Promise<{ status: string }> {
    this.assertValidChatId(chatId);
    return resumeRun(this.requireCloudCtx(cloudCreds), runId, req);
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
    const before = this.settings.getSettings();
    const after = this.settings.updateSettings(input);
    if (
      before.mcpEnabled !== after.mcpEnabled ||
      before.mcpAllowWrites !== after.mcpAllowWrites ||
      before.allowRawToolData !== after.allowRawToolData
    ) {
      // The MCP tool set (or its result shaping) changed: tell connected
      // clients to re-list tools.
      this.mcpEndpoint?.notifyToolsChanged();
    }
    return after;
  }

  // ─── MCP ──────────────────────────────────────────────────────────────
  /**
   * Streamable HTTP MCP endpoint, built on first use. The SDK handler itself
   * is stateless per request; what persists across requests is held here —
   * the connection registry (pins, backing chats) and the call recorder.
   */
  get mcp(): McpEndpoint {
    if (!this.mcpEndpoint) {
      this.mcpEndpoint = new McpEndpoint({
        ctx: this.ctx,
        appVersion: this.ctx.manifest.version,
        contextResolver: this.contextResolver,
        conversation: this.conversation,
        connections: this.mcpConnectionRegistry(),
        recorder: new McpCallRecorder({ conversation: this.conversation }),
        getSettings: () => this.settings.getSettings(),
        getRegistry: (allowWrites) => this.mcpRegistry(allowWrites),
        pendingProposalHint: (chatTitle) =>
          `Waiting for the user to approve or reject it in OpenPCB's assistant panel (chat "${chatTitle}"). Tell the user; do not re-send it.`,
      });
    }
    return this.mcpEndpoint;
  }

  /** Connected MCP clients, most recent first (for the Settings panel). */
  listMcpClients(): McpConnectionSummary[] {
    return this.mcpConnectionRegistry().list();
  }

  private mcpConnectionRegistry(): McpConnectionRegistry {
    this.mcpConnections ??= new McpConnectionRegistry({
      ctx: this.ctx,
      conversation: this.conversation,
      contextResolver: this.contextResolver,
      chatDefaults: () => this.mcpChatDefaults(),
    });
    return this.mcpConnections;
  }

  /**
   * Provider stamped on chats created for MCP clients. The external agent
   * never runs through this provider, so a missing default must not break
   * MCP: fall back to any provider row, then to a sentinel id.
   */
  private mcpChatDefaults(): ChatDefaults {
    const settings = this.settings.getSettings();
    const provider =
      this.providers.getProviderInternal(settings.defaultProviderId) ??
      this.providers.listProviders()[0] ??
      null;
    return {
      providerConfigId: provider?.id ?? "mcp-external",
      model: provider?.defaultModel ?? "external",
      promptPresetId: settings.defaultPromptPresetId,
    };
  }

  /**
   * MCP tool registry, cached per (write mode, raw-data setting) so Ajv does
   * not recompile every tool schema on each request. Separate from the in-app
   * assistant registry: MCP additionally gets the extended tools, and its
   * auto-apply policy is gated on `mcpAllowWrites` on top of the usual risk
   * check.
   */
  private mcpRegistry(allowWrites: boolean): AiToolRegistry {
    const allowRawToolData = this.settings.getSettings().allowRawToolData;
    const key = `${allowWrites}:${allowRawToolData}`;
    const cached = this.mcpRegistries.get(key);
    if (cached) return cached;
    const registry = buildOpenpcbToolRegistry(
      this.ctx,
      this.contextResolver,
      this.conversation,
      {
        allowRawToolData,
        designerTools: {
          isSessionAutoApplyAllowed: (input) =>
            allowWrites &&
            (input.riskLevel !== "destructive" ||
              this.writeSessionPolicy.isAllowed(input)),
        },
      },
    );
    registerExtendedReadTools(registry, this.ctx);
    this.mcpRegistries.set(key, registry);
    return registry;
  }

  /**
   * Cheap state probe for the stdio shim: whether the server is on, whether
   * writes are on, and a fingerprint of the advertised tool set. The shim
   * polls it and synthesizes `notifications/tools/list_changed` for 2025-era
   * clients, which the stateless endpoint cannot push to.
   */
  mcpState(): {
    enabled: boolean;
    allowWrites: boolean;
    toolset: string;
    appVersion: string;
  } {
    const settings = this.settings.getSettings();
    const names = settings.mcpEnabled
      ? this.mcpRegistry(settings.mcpAllowWrites)
          .list()
          .filter((t) => settings.mcpAllowWrites || t.definition.effect !== "write")
          .map((t) => t.definition.name)
          .sort()
      : [];
    return {
      enabled: settings.mcpEnabled,
      allowWrites: settings.mcpAllowWrites,
      toolset: `${names.length}:${hashString(names.join(","))}`,
      appVersion: this.ctx.manifest.version,
    };
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
  /**
   * B2: build a client for a one-off Settings call (models refresh / test /
   * capability probe). For every BYO provider this is the plain path and the
   * request's cloud credentials are deliberately ignored — they must never leak
   * to a third-party endpoint. For `openpcb-cloud` the row stores no API key
   * (the preset is `requiresApiKey: false`, so `requireUsableProvider` lets it
   * through), and the proxy also demands a workspace header — without both, all
   * three endpoints 401. That is why they used to be permanently broken.
   */
  private async buildRequestClient(
    provider: InternalProviderConfig,
    cloudCreds?: CloudCredentials | null,
  ) {
    if (provider.kind !== "openpcb-cloud") return buildAiProviderClient(provider);
    if (!cloudCreds)
      throw new ValidationError(
        "OpenPCB Cloud requires a signed-in session (x-cloud-bearer / x-cloud-api-url).",
      );
    const cloud = await resolveCloudWorkspace(cloudCreds);
    return buildAiProviderClient(
      { ...provider, apiKey: cloud.bearer },
      { extraHeaders: cloudProxyHeaders(cloud.workspaceId) },
    );
  }

  async refreshProviderModels(
    id: string,
    cloudCreds?: CloudCredentials | null,
  ): Promise<AssistantProviderModel[]> {
    const provider = this.requireUsableProvider(id);
    const client = await this.buildRequestClient(provider, cloudCreds);
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
    cloudCreds?: CloudCredentials | null,
  ): Promise<ProviderTestResult> {
    const provider = this.requireUsableProvider(id);
    const client = await this.buildRequestClient(provider, cloudCreds);
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
  getToolCalling(id: string): { mode: ToolCallingMode; effective: boolean } {
    const mode = this.providers.getToolCallingMode(id);
    const provider = this.requireProvider(id);
    return { mode, effective: provider.capabilities?.toolCalling !== false };
  }
  setToolCalling(
    id: string,
    mode: ToolCallingMode,
  ): { mode: ToolCallingMode; effective: boolean } {
    this.providers.setToolCallingMode(id, mode);
    return this.getToolCalling(id);
  }
  async refreshProviderCapabilities(
    id: string,
    cloudCreds?: CloudCredentials | null,
  ): Promise<AiProviderCapabilities> {
    const provider = this.requireUsableProvider(id);
    const client = await this.buildRequestClient(provider, cloudCreds);
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
