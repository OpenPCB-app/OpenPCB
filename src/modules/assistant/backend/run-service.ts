import {
  runChat,
  newRunId,
  resolveToolLimits,
  AiToolRegistry,
  type AiChatMessage,
  type AiRunEvent,
  type AiTool,
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
  type DesignerSDK,
} from "../../../sdks";
import type { ConversationStore } from "./conversation-store";
import { MentionContentResolver } from "./mention-content-resolver";
import type {
  ResolvedMentionContent,
  MentionImage,
} from "./mention-resolver-types";
import type { ProviderStore, InternalProviderConfig } from "./provider-store";
import {
  openCloudCredentials,
  type CloudCredentials,
} from "./cloud/token-crypto";
import type { SettingsStore } from "./settings-store";
import type { PromptService } from "./prompt-service";
import type { ContextResolver } from "./context-resolver";
import { buildAiProviderClient } from "./providers/openpcb-provider-factory";
import { loadRemoteTools } from "./cloud/remote-tool";
import {
  cloudProxyHeaders,
  resolveCloudWorkspace,
  type CloudWorkspaceContext,
} from "./cloud/cloud-context";
import { isFeatureEnabled } from "../../../core/contracts/feature-flags/backend";
import {
  intentFromBomResult,
  intentFromCompileResult,
} from "./verification/build-intent-capture";
import { BuildIntentStore } from "./verification/build-intent-store";
import { runDefinitionOfDone } from "./verification/run-dod";
import { buildDesignContextSummary } from "./context-summary";
import type {
  DeficiencyReport,
  DesignContextSummary,
} from "./verification/types";

export interface SubmitPayload {
  chatId: string;
  assistantMessageId: string;
  providerConfigId: string;
  model: string;
  /**
   * AES-GCM-sealed {bearer, apiUrl, copilotUrl} (see cloud/token-crypto.ts).
   * Present only when the selected provider is `openpcb-cloud` (D8): the bearer
   * is unsealed at run time and used as the per-run apiKey — no key is stored on
   * the provider row.
   */
  cloudBearerEnc?: string;
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
  /**
   * Cumulative: a write tool succeeded at some point this run. NEVER cleared by a
   * chat-only retry or a correction pass, so DoD still runs after a provider
   * failure that followed successful writes (F4).
   */
  hadWriteWork?: boolean;
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

/** Tool that binds the chat to a fresh design mid-run, unlocking the writers. */
const CREATE_DESIGN_TOOL = "designer_create_design";

/**
 * Designer tools that mutate the design (schematic/PCB). A successful call to any
 * of these means real write work was applied, so the Definition-of-Done verifier
 * must run regardless of a later provider failure or chat-only retry (F4).
 */
const WRITE_TOOL_NAMES = new Set<string>([
  "designer_create_design",
  "designer_place_components",
  "designer_propose_schematic_edits",
  "designer_propose_schematic_wires",
  "designer_propose_schematic_updates",
  "designer_propose_schematic_deletions",
  "designer_arrange_schematic",
  "compile_circuit",
]);

/**
 * Stage the registry for the model.
 *
 * `runChat` snapshots `registry.listDefinitions()` ONCE at the start of a run
 * and reuses that list for every iteration, so a registry mutated mid-loop
 * never re-advertises new tools to the provider. That broke the "create →
 * place → wire in one run" path: an unbound chat was locked to the 5
 * `UNBOUND_TOOL_NAMES` for the whole run, so after `designer_create_design`
 * bound a design the write tools were never exposed.
 *
 * Fix: when the unbound chat CAN create a design this run (the create tool is
 * registered), expose the full set up front. The write tools are then already
 * advertised when the bind appears mid-run. A truly read-only unbound chat
 * (no create tool) keeps the lean payload.
 */
function stageRegistryForBindings(
  full: AiToolRegistry,
  hasBoundDesign: boolean,
): AiToolRegistry {
  if (hasBoundDesign) return full;
  const canCreateThisRun = full
    .list()
    .some((tool) => tool.definition.name === CREATE_DESIGN_TOOL);
  if (canCreateThisRun) return full;
  const staged = new AiToolRegistry();
  for (const tool of full.list()) {
    if (UNBOUND_TOOL_NAMES.has(tool.definition.name)) staged.register(tool);
  }
  return staged;
}

function isBlank(text: string | null | undefined): boolean {
  return !text || text.trim().length === 0;
}

/** Keys a JSON object must carry to look like an attempted tool invocation. */
const EMULATED_NAME_KEYS = ["name", "tool", "tool_name", "function"];
const EMULATED_ARG_KEYS = ["arguments", "parameters", "args", "input"];

/**
 * H4 — does this answer contain a fenced JSON block shaped like a tool call?
 *
 * Weak/distilled local models (e.g. oMLX Qwen3.5-27B-Distilled) frequently
 * "call" a tool by printing ```json {"name": "...", "arguments": {...}} ``` into
 * the message body instead of emitting real `tool_calls`. The run then completes
 * "successfully" while nothing was built, and the DoD gate never fires because
 * there was no tool work to verify.
 *
 * Deliberately conservative — it only fires when BOTH a name-ish and an args-ish
 * key are present, so a model legitimately *showing* a JSON snippet (a BOM, a
 * config example) is not flagged. Callers additionally require that the run
 * produced no real tool calls.
 */
export function looksLikeEmulatedToolCall(content: string): boolean {
  if (!content) return false;
  const fences = content.matchAll(/```(?:json|tool_call|json5)?\s*\n?([\s\S]*?)```/gi);
  for (const match of fences) {
    const block = match[1]?.trim();
    if (!block) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const keys = new Set(Object.keys(candidate as Record<string, unknown>));
      const hasName = EMULATED_NAME_KEYS.some((k) => keys.has(k));
      const hasArgs = EMULATED_ARG_KEYS.some((k) => keys.has(k));
      if (hasName && hasArgs) return true;
    }
  }
  return false;
}

/** Max correction passes after the main run; each pass re-primes + re-runs. */
const MAX_DOD_CORRECTION_PASSES = 3;

export class RunService {
  private readonly tasks: TasksSDK;
  private readonly buildIntents: BuildIntentStore;

  constructor(private readonly options: RunServiceOptions) {
    const tasks = options.ctx.sdk.get<TasksSDK>(MODULE_SDK_TOKENS.TASKS);
    if (!tasks) throw new Error("TasksSDK not registered");
    this.tasks = tasks;
    this.buildIntents = new BuildIntentStore(options.ctx);
    this.tasks.registerExecutor("assistant.chat", {
      execute: (taskCtx) =>
        this.execute(taskCtx as TaskExecutionContext<SubmitPayload>),
    });
  }

  private designerSdk(): DesignerSDK | null {
    return this.options.ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  }

  private boundDesignId(chatId: string): string | null {
    const primary = this.options.contextResolver.getPrimaryDesign(chatId);
    return primary && primary.status === "active" ? primary.refId : null;
  }

  /** Parse a library_resolve_bom result and persist it as a BuildIntent row. */
  private captureBuildIntent(
    chatId: string,
    taskId: string,
    resultJson: string,
  ): void {
    const intent = intentFromBomResult(resultJson);
    if (!intent) return;
    try {
      this.buildIntents.save({ chatId, taskId, ...intent });
    } catch {
      // Persisting intent is best-effort; never fail the run over it.
    }
  }

  /**
   * Parse a compile_circuit result and persist its BOM as a BuildIntent so the
   * Definition-of-Done harness verifies the composed circuit (ERC/wiring) and can
   * drive correction passes.
   */
  private captureCompiledBuildIntent(
    chatId: string,
    taskId: string,
    resultJson: string,
  ): void {
    const intent = intentFromCompileResult(resultJson);
    if (!intent) return;
    try {
      this.buildIntents.save({ chatId, taskId, ...intent });
    } catch {
      // Persisting intent is best-effort; never fail the run over it.
    }
  }

  /**
   * Run DoD, then dynamically correct: while the failing-check set keeps
   * shrinking, re-prime the model with a FRESH minimal context (goal + current
   * design summary + structured deficiencies) and re-run. Stop on pass, on stall
   * (no shrink between two passes), or on the pass budget. On stop with
   * remaining deficiencies, mark the answer partial and append written
   * suggested-next-steps; no further auto-action. Idempotent re-runs rely on the
   * write tools' `action_id` (Track D).
   *
   * Returns the final DeficiencyReport, or null when there is nothing to verify
   * (no bound design / no projection).
   */
  private async runCorrectionHarness(
    payload: SubmitPayload,
    taskCtx: TaskExecutionContext<SubmitPayload>,
    callSummaries: Map<string, AssistantToolCallSummary>,
    toolEventsByCall: Map<string, AssistantToolEventDto>,
    runState: AssistantTurnState,
    runProvider: InternalProviderConfig,
    remoteTools: AiTool[],
    cloudHeaders: Record<string, string> | undefined,
    aiRunId: string,
  ): Promise<DeficiencyReport | null> {
    const designer = this.designerSdk();
    if (!designer) return null;
    const designId = this.boundDesignId(payload.chatId);
    if (!designId) return null;

    const verify = (): Promise<DeficiencyReport> =>
      runDefinitionOfDone({
        designer,
        conversation: this.options.conversation,
        buildIntents: this.buildIntents,
        chatId: payload.chatId,
        taskId: taskCtx.task.id,
        designId,
      });

    let report = await verify();
    let prevFailing = new Set(report.failing);
    const intent = this.buildIntents.get(payload.chatId, taskCtx.task.id);
    const goal = intent?.goal ?? "";

    for (
      let pass = 0;
      pass < MAX_DOD_CORRECTION_PASSES && report.status !== "pass";
      pass++
    ) {
      if (taskCtx.signal.aborted) break;
      const summary = await buildDesignContextSummary(designer, designId);
      const correctionMessages = buildCorrectionMessages(goal, summary, report);
      callSummaries.clear();
      toolEventsByCall.clear();
      const passRegistry = this.options.buildRegistry(
        this.options.settings.getSettings().allowRawToolData,
      );
      this.registerRemoteTools(passRegistry, remoteTools);
      for await (const event of runChat({
        client: (this.options.buildClient ?? buildAiProviderClient)(
          runProvider,
          cloudHeaders ? { extraHeaders: cloudHeaders } : undefined,
        ),
        registry: passRegistry,
        // Stitch cloud LLM + tool usage under one run id (matches the
        // x-openpcb-run-id header + the desktop's own emitted-event runId).
        // B8/B12: sharing the turn's id across correction passes is what lets
        // the derived x-tool-call-id dedupe a re-issued tool call — a per-pass
        // id would bill the same logical call once per pass.
        runId: aiRunId,
        model: payload.model,
        messages: correctionMessages,
        bindings: this.options.contextResolver.listBindings(payload.chatId),
        limits: resolveToolLimits({
          preference: this.options.settings.getSettings().contextSizePreference,
          modelContextTokens: runProvider.capabilities?.maxContextTokens,
        }),
        chatId: payload.chatId,
        maxToolIterations: 8,
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

      report = await verify();
      const failing = new Set(report.failing);
      const shrank =
        failing.size < prevFailing.size &&
        [...failing].every((id) => prevFailing.has(id));
      prevFailing = failing;
      if (report.status === "pass") break;
      if (!shrank) break; // stall — same or non-shrinking failing set.
    }

    if (report.status !== "pass") {
      const message = buildDeficiencyMessage(report);
      this.options.conversation.appendMessageContent(
        payload.assistantMessageId,
        message,
      );
      await taskCtx.emitChunk({ kind: "text", content: message });
    }
    return report;
  }

  /**
   * Resolve the run's provider config, injecting the live GoTrue bearer as the
   * apiKey for the `openpcb-cloud` provider (D8/D15). The bearer is sealed into
   * the task payload at submit and never stored on the provider row; every other
   * kind uses its stored key unchanged. The sealed credentials are unsealed
   * exactly once here and returned alongside (null for every non-cloud kind) so
   * resolveCloudContext doesn't decrypt a second time.
   */
  private resolveRunProvider(payload: SubmitPayload): {
    provider: InternalProviderConfig;
    cloudCreds: CloudCredentials | null;
  } {
    const provider = this.options.providers.getProviderInternal(
      payload.providerConfigId,
    );
    if (!provider)
      throw new Error(`Provider not found: ${payload.providerConfigId}`);
    if (provider.kind !== "openpcb-cloud")
      return { provider, cloudCreds: null };
    if (!payload.cloudBearerEnc)
      throw new Error(
        "OpenPCB Cloud requires a signed-in session (missing bearer).",
      );
    const creds = openCloudCredentials(payload.cloudBearerEnc);
    return {
      provider: { ...provider, apiKey: creds.bearer },
      cloudCreds: creds,
    };
  }

  /**
   * Resolve the per-run cloud attribution context for an `openpcb-cloud` run:
   * the unsealed {bearer, apiUrl} plus the caller's personal workspace id. The
   * metered proxy REQUIRES `x-openpcb-workspace-id` on every /v1/llm and
   * workspace-scoped /v1/tools call (a bare Pro bearer 400s), and the desktop
   * has no workspace context of its own — so we resolve it from cloud-api at run
   * time (`GET {apiUrl}/v1/workspaces/me/personal`, which idempotently creates
   * the personal workspace and makes the caller its owner → satisfies the
   * proxy's workspace-member RBAC). Returns null for any non-cloud run; throws
   * a user-readable error (never a raw fetch failure) when resolution fails.
   */
  private async resolveCloudContext(
    creds: CloudCredentials | null,
  ): Promise<CloudWorkspaceContext | null> {
    if (!creds) return null;
    return resolveCloudWorkspace(creds);
  }

  /**
   * Static headers the ai-core client must send on every metered-proxy call for
   * an `openpcb-cloud` run: workspace attribution (required) + run stitching.
   *
   * B8: `aiRunId` is the per-turn run id, NOT the chat id — the cloud ledger
   * groups `usage_event` rows by it, so a chat id would make per-run cost
   * attribution impossible. It is also the identity ingredient for the derived
   * `x-tool-call-id` in remote-tool.ts, which is why one id must cover the whole
   * turn including every correction pass.
   */
  private cloudHeaders(
    aiRunId: string,
    cloud: CloudWorkspaceContext | null,
  ): Record<string, string> | undefined {
    if (!cloud) return undefined;
    return cloudProxyHeaders(cloud.workspaceId, aiRunId);
  }

  /**
   * Load the cloud tool-plane tools for a Pro openpcb-cloud run (R4.4). Best
   * effort: returns [] for any non-cloud provider, a missing flag/bearer, or a
   * manifest fetch failure, so the run degrades to local tools only.
   */
  private async loadRemoteToolsFor(
    provider: InternalProviderConfig,
    workspaceId: string | undefined,
    designId: string | undefined,
  ): Promise<AiTool[]> {
    if (provider.kind !== "openpcb-cloud") return [];
    if (!isFeatureEnabled("cloud.copilot")) return [];
    const bearer = provider.apiKey;
    if (!bearer) return [];
    // provider.baseUrl = {copilotUrl}/v1/llm — tools live at {copilotUrl}/v1/tools.
    const copilotBase = provider.baseUrl.replace(/\/v1\/llm\/?$/, "");
    try {
      return await loadRemoteTools({
        copilotBase,
        getBearer: () => bearer,
        workspaceId,
        designId,
      });
    } catch (err) {
      console.warn(
        "[RunService] cloud tool manifest fetch failed:",
        err instanceof Error ? err.message : String(err),
      );
      return [];
    }
  }

  /** Register remote tools into a registry, skipping any that fail to register. */
  private registerRemoteTools(
    registry: AiToolRegistry,
    tools: AiTool[],
  ): void {
    for (const tool of tools) {
      try {
        registry.register(tool);
      } catch {
        // A tool whose schema won't compile or whose name collides is skipped;
        // the rest still register.
      }
    }
  }

  private async execute(
    taskCtx: TaskExecutionContext<SubmitPayload>,
  ): Promise<unknown> {
    const payload = taskCtx.task.payload;
    const { provider, cloudCreds } = this.resolveRunProvider(payload);
    if (!provider.enabled)
      throw new Error(`Provider disabled: ${provider.label}`);

    // B8: ONE run id for this whole submitted turn — the main pass, both
    // fallback retries, and every DoD correction pass. It is not the chat id:
    // grouping cloud spend per chat made per-run cost attribution impossible.
    // Minted here because it must precede cloudHeaders below, which are baked
    // into the client and captured by closure for every runChat call; minting
    // per-invocation would desync the ledger from the emitted events.
    const aiRunId = newRunId();

    const settings = this.options.settings.getSettings();
    const chat = this.options.conversation.getChat(payload.chatId);
    if (!chat) throw new Error(`Chat not found: ${payload.chatId}`);
    await this.options.contextResolver.refreshBindingHealth(payload.chatId);
    const bindings = this.options.contextResolver.listBindings(payload.chatId);

    const configuredRegistry = this.options.buildRegistry(
      settings.allowRawToolData,
    );
    const providerAllowsTools = provider.capabilities?.toolCalling !== false;
    // B1: the active design binding's refId IS the design id (context-resolver
    // sets refId = design.id) — remote tools that own a registration need it.
    const boundDesignId = bindings.find(
      (b) => b.kind === "design" && b.status === "active",
    )?.refId;
    const hasBoundDesign = boundDesignId !== undefined;
    const registry = providerAllowsTools
      ? stageRegistryForBindings(configuredRegistry, hasBoundDesign)
      : new AiToolRegistry();
    // R4: resolve the cloud workspace context once (throws with a clear message
    // if it can't) — the proxy requires x-openpcb-workspace-id on every call.
    const cloud = await this.resolveCloudContext(cloudCreds);
    const cloudHeaders = this.cloudHeaders(aiRunId, cloud);
    // R4.4: augment with the cloud tool plane for an openpcb-cloud Pro run.
    // Respect the provider-level tool-calling gate: a provider forced/probed to
    // chat-only must not advertise remote tools either.
    const remoteTools = providerAllowsTools
      ? await this.loadRemoteToolsFor(
          provider,
          cloud?.workspaceId,
          boundDesignId,
        )
      : [];
    this.registerRemoteTools(registry, remoteTools);
    const client = (this.options.buildClient ?? buildAiProviderClient)(
      provider,
      cloudHeaders ? { extraHeaders: cloudHeaders } : undefined,
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

    const mentionContext = await this.resolveMentionContext(history);

    const messages: AiChatMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    if (mentionContext.text) {
      messages.push({ role: "system", content: mentionContext.text });
    }

    const lastUserMessageIndex = findLastUserMessageIndex(history, payload.assistantMessageId);

    for (let i = 0; i < history.length; i++) {
      const m = history[i];
      if (!m) continue;
      if (m.id === payload.assistantMessageId) continue;
      if (m.role === "user") {
        if (i === lastUserMessageIndex && mentionContext.images.length > 0) {
          messages.push(
            buildUserMessageWithImages(m.content, mentionContext.images),
          );
        } else {
          messages.push({ role: "user", content: m.content });
        }
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
        runId: aiRunId,
        model: payload.model,
        messages,
        bindings,
        limits,
        chatId: payload.chatId,
        // Higher budget so a whole build completes in ONE run: resolve BOM →
        // create design → place → re-read connectivity → wire (+ retry skips).
        // Each non-destructive edit auto-applies, so the model chains these.
        maxToolIterations: 12,
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
          runId: aiRunId,
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
        ) ||
        callSummaries.size > 0 ||
        runState.hadWriteWork === true;
      if (!answeredOrToolWork() && !failedEvent) {
        for await (const event of runChat({
          client,
          registry: new AiToolRegistry(),
          runId: aiRunId,
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
          runId: aiRunId,
          timestamp: new Date().toISOString(),
          data: {
            code: "empty_response",
            message: "The model returned no answer.",
          },
        });
      }

      // H4: weak/distilled local models often "call" tools by printing a fenced
      // JSON block into the answer instead of emitting real tool_calls. The run
      // then looks successful — the model narrates progress — but nothing was
      // built and DoD never runs, which is far more confusing than an outright
      // failure. Detect it and say so.
      const emulatedToolCall =
        providerAllowsTools &&
        callSummaries.size === 0 &&
        runState.hadWriteWork !== true &&
        looksLikeEmulatedToolCall(
          this.options.conversation.getMessage(payload.assistantMessageId)
            ?.content ?? "",
        );
      if (emulatedToolCall) {
        const message =
          "This model wrote tool calls as text instead of calling the tools, so nothing was actually run. Pick a model with native tool-calling support, or check that your server has tool calling enabled.";
        await this.emitAiEvent(taskCtx, {
          type: "run.warning",
          runId: aiRunId,
          timestamp: new Date().toISOString(),
          data: { code: "emulated_tool_call", message },
        });
        // Persist as a system message: MessageCard already renders role:"system"
        // as an amber warning banner, so this surfaces in BOTH the full space
        // and the designer dock with no frontend change.
        this.options.conversation.createMessage({
          chatId: payload.chatId,
          role: "system",
          content: message,
          taskId: taskCtx.task.id,
        });
      }

      // P4b: Definition-of-Done verification + dynamic correction. Runs when the
      // model did real tool work in the live summaries OR a write was applied at
      // any point this run (`hadWriteWork`) — the latter survives a chat-only
      // retry that clears `callSummaries`, so a provider failure AFTER successful
      // writes is still verified (F4). A pure chat-only answer has nothing to
      // verify.
      const deficiency =
        callSummaries.size > 0 || runState.hadWriteWork === true
          ? await this.runCorrectionHarness(
              payload,
              taskCtx,
              callSummaries,
              toolEventsByCall,
              runState,
              provider,
              remoteTools,
              cloudHeaders,
              aiRunId,
            )
          : null;

      // Persist final summaries + reasoning/diagnostics onto the assistant message metadata.
      const summaries = Array.from(callSummaries.values());
      const totalSources = summaries.reduce((acc, s) => acc + s.sourceCount, 0);
      // `definitionOfDone` is an additive diagnostic field not in the published
      // AssistantMessageMetadata shape; attach it via a widened ai object.
      const ai: Record<string, unknown> = {
        toolCallSummaries: summaries,
        totalSources,
        ...(runState.reasoning ? { reasoning: runState.reasoning } : {}),
        ...(runState.truncated ? { truncated: true } : {}),
        ...(emptyResponse ? { emptyResponse: true } : {}),
        ...(deficiency
          ? {
              definitionOfDone: {
                status: deficiency.status,
                failing: deficiency.failing,
                checks: deficiency.checks,
              },
            }
          : {}),
      };
      const metadata = { ai } as unknown as AssistantMessageMetadata;
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

  private async resolveMentionContext(
    messages: AssistantMessage[],
  ): Promise<{ text: string | null; images: MentionImage[] }> {
    const resolver = new MentionContentResolver();
    const allResolved: ResolvedMentionContent[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        try {
          const resolved = await resolver.resolveMessageMentions(
            msg.content,
            "default",
          );
          allResolved.push(...resolved);
        } catch (err) {
          console.warn(
            `[RunService] Failed to resolve mentions in message ${msg.id}:`,
            err,
          );
        }
      }
    }

    if (allResolved.length === 0) {
      return { text: null, images: [] };
    }

    const seen = new Set<string>();
    const uniqueResolved = allResolved.filter((m) => {
      const key = `${m.entityType}:${m.entityId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const images: MentionImage[] = [];
    let imageByteBudget = 20 * 1024 * 1024;
    for (const resolved of uniqueResolved) {
      for (const img of resolved.images) {
        if (images.length >= 20) break;
        if (img.byteSize > imageByteBudget) continue;
        images.push(img);
        imageByteBudget -= img.byteSize;
      }
      if (images.length >= 20) break;
    }

    const text = resolver.formatAsContextSection(uniqueResolved);
    return { text, images };
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
          // F8: non-streaming/completed-only providers carry the tool calls (with
          // real args) only on this event — no preceding `run.tool.requested`.
          // Seed the summary + tool-event here so DoD runs and the persisted
          // tool-event args are the real arguments, not "{}".
          for (const call of event.data.toolCalls ?? []) {
            if (callSummaries.has(call.id)) continue;
            callSummaries.set(call.id, {
              toolCallId: call.id,
              toolName: call.name,
              status: "requested",
              sourceCount: 0,
              truncated: false,
              warnings: [],
            });
            const dto = this.options.conversation.upsertToolEvent({
              id: toolEventsByCall.get(call.id)?.id,
              chatId: payload.chatId,
              taskId: taskCtx.task.id,
              messageId: payload.assistantMessageId,
              toolCallId: call.id,
              toolName: call.name,
              status: "requested",
              argumentsJson: call.argumentsJson,
            });
            toolEventsByCall.set(call.id, dto);
          }
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
        if (WRITE_TOOL_NAMES.has(event.data.toolName))
          runState.hadWriteWork = true;
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
        // F9: the persisted tool message is what history replays to the model on
        // later turns, so it must carry the SLIM model-facing envelope, not the
        // full payload. The full `resultJson` lives only on the tool-event/UI DTO.
        this.options.conversation.createMessage({
          chatId: payload.chatId,
          role: "tool",
          content: event.data.modelResultJson ?? event.data.resultJson,
          toolCallId: event.data.toolCallId,
          toolName: event.data.toolName,
          taskId: taskCtx.task.id,
          metadata: { ai: { internal: true } },
        });
        // P4: capture BuildIntent from a resolved BOM. The tool execute context
        // carries chatId but not taskId, so the intent is persisted here where
        // both keys are in scope.
        if (event.data.toolName === "library_resolve_bom") {
          this.captureBuildIntent(
            payload.chatId,
            taskCtx.task.id,
            event.data.resultJson,
          );
        } else if (event.data.toolName === "compile_circuit") {
          this.captureCompiledBuildIntent(
            payload.chatId,
            taskCtx.task.id,
            event.data.resultJson,
          );
        }
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
        // F4: a write tool that actually EXECUTED but failed may have partially
        // applied (auto-apply landed a placement, then a follow-up wire threw),
        // so count it as write work → the DoD verifier still runs even if the
        // run later fails / retries chat-only. But pre-execution failures
        // (tool_missing/bad_args/schema_invalid/cap) and cancellation never
        // touched the design, so they must NOT trigger verification.
        if (
          WRITE_TOOL_NAMES.has(event.data.toolName) &&
          (event.data.errorCode === "tool_failed" ||
            event.data.errorCode === "exec_failed")
        )
          runState.hadWriteWork = true;
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
          // NEW:808 / #3 — replay the ai-core balanced envelope. When the tool
          // RAN and reported failure (esp. status:"partial"), ai-core carries
          // the real envelope (modelResultJson) so the model sees the same
          // partial result on replay; otherwise synthesize a balanced error.
          content:
            event.data.modelResultJson ??
            JSON.stringify({
              ok: false,
              status: "error",
              summary: event.data.errorMessage,
              warnings: [],
              truncated: false,
              data: {
                errorCode: event.data.errorCode,
                errorMessage: event.data.errorMessage,
              },
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

interface ContentPart {
  type: string;
  text?: string;
  image_url?: { url: string; detail?: string };
}

function findLastUserMessageIndex(
  messages: AssistantMessage[],
  assistantMessageId: string,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user" && m.id !== assistantMessageId) {
      return i;
    }
  }
  return -1;
}

function buildUserMessageWithImages(
  text: string,
  images: MentionImage[],
): AiChatMessage {
  const content: ContentPart[] = [{ type: "text", text }];
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: { url: img.src, detail: "auto" },
    });
  }
  return {
    role: "user",
    content: content as unknown as string,
  } as AiChatMessage;
}

/**
 * Build a fresh minimal correction context: a system instruction to fix only the
 * listed deficiencies, plus the goal, the current design summary, and the
 * structured failing checks. Deliberately omits prior tool/assistant turns so a
 * reasoning model isn't drowned in history.
 */
function buildCorrectionMessages(
  goal: string,
  summary: DesignContextSummary | null,
  report: DeficiencyReport,
): AiChatMessage[] {
  const failing = report.checks.filter((c) => !c.passed);
  const deficiencyLines = failing
    .map((c) => `- [${c.id}] ${c.message}`)
    .join("\n");
  const summaryBlock = summary
    ? [
        `Design "${summary.name}" (id=${summary.designId}):`,
        `- schematic: ${summary.schematic.componentCount} component(s), ${summary.schematic.netCount} net(s)`,
        summary.schematic.unplaced.length > 0
          ? `- unplaced on PCB: ${summary.schematic.unplaced.join(", ")}`
          : null,
        summary.schematic.openNets.length > 0
          ? `- open nets: ${summary.schematic.openNets.join(", ")}`
          : null,
        `- PCB: ${summary.pcb.placed} placed, ${summary.pcb.unrouted} unrouted net(s)`,
      ]
        .filter(Boolean)
        .join("\n")
    : "Design summary unavailable.";
  const system =
    "You are continuing an autonomous PCB build. The design is NOT yet complete. " +
    "Fix ONLY the deficiencies listed below using the designer write tools. " +
    "Do not touch parts of the design that are already correct. Reuse stable " +
    "action_id keys so repeated operations are safe no-ops. When every " +
    "deficiency is resolved, stop.";
  const user =
    (goal ? `Goal: ${goal}\n\n` : "") +
    `${summaryBlock}\n\nRemaining deficiencies:\n${deficiencyLines}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** A user-facing, written suggested-next-steps block for an unfinished build. */
function buildDeficiencyMessage(report: DeficiencyReport): string {
  const failing = report.checks.filter((c) => !c.passed);
  const lines = failing.map((c) => `- ${c.message}`).join("\n");
  return (
    `\n\n---\n**Build incomplete** — ${failing.length} check(s) still failing:\n` +
    `${lines}\n\n_Suggested next steps: resolve the items above, then ask me to verify again._`
  );
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
