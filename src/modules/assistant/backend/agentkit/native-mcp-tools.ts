import { AiToolRegistry, type AiTool, type AiToolExecutionContext } from "agentkit/core";
import type { AiToolResult } from "agentkit/contracts";
import type { ToolSetContributor } from "agentkit/host";
import { MODULE_SDK_TOKENS, type DesignerSDK } from "../../../../sdks";
import { createNativeToolContributor, type NativeToolContributorOptions } from "./native-tools";
import { registerExtendedReadTools } from "../tools/read-tools";
import type { NativeMcpActors } from "./native-mcp-actors";
import type { NativeContextStore } from "./native-context-store";

export function createNativeMcpContributor(options: Omit<NativeToolContributorOptions, "actorScope"> & {
  actors: NativeMcpActors; contextStore: NativeContextStore;
}): ToolSetContributor {
  return {
    namespace: "openpcb",
    async contribute(contribution) {
      if (!contribution.actorId || !contribution.chatId) return [];
      const actorScope = options.actors.register(contribution.actorId, contribution.chatId);
      const native = await createNativeToolContributor({ ...options, actorScope }).contribute(contribution);
      const extended = new AiToolRegistry();
      registerExtendedReadTools(extended, options.context);
      return [...native, ...extended.list()].map((tool): AiTool => ({ definition: tool.definition,
        execute: (context, input) => executeSessionTool(options, actorScope, tool, context, input) }))
        .concat(pinTool(options, actorScope));
    },
  };
}

type McpOptions = Parameters<typeof createNativeMcpContributor>[0];

async function executeSessionTool(
  options: McpOptions, actorScope: string, tool: AiTool, context: AiToolExecutionContext, input: unknown,
): Promise<AiToolResult> {
  if (!context.chatId || !options.actors.has(actorScope, context.chatId)) throw new Error("MCP_ACTOR_DENIED");
  context.signal?.throwIfAborted();
  const acceptsDesign = Boolean(tool.definition.inputSchema.properties?.designId);
  const args = input && typeof input === "object" ? { ...input as Record<string, unknown> } : {};
  if (acceptsDesign) {
    const target = await resolveSessionDesign(options, actorScope, context.chatId, args.designId);
    if ("errorCode" in target) return targetRefusal(context, target);
    await bindSession(options, context.chatId, target.designId);
    args.designId = target.designId;
  }
  const result = await tool.execute(context, acceptsDesign ? args : input);
  if (!result.data || typeof result.data !== "object" || !("proposalId" in result.data)) return result;
  const data = result.data as Record<string, unknown>;
  return { ...result, modelData: { ...(result.modelData && typeof result.modelData === "object" ? result.modelData : {}),
    proposalId: data.proposalId, proposalStatus: data.status, envelope: data.envelope, outcome: data.outcome } };
}

interface TargetCandidate { designId: string; name: string | null; source: "explicit" | "pinned" | "session" | "ui-active" | "available" }
interface TargetRefusal {
  errorCode: "DESIGN_TARGET_AMBIGUOUS" | "DESIGN_TARGET_STALE" | "DESIGN_NOT_FOUND"; message: string; candidates: TargetCandidate[];
}
const TARGET_HINT = "Pass designId, or call designer_use_design to pin this session (designer_list_designs lists ids).";
const MAX_LISTED_CANDIDATES = 10;

/**
 * Explicit id, then session pin, then the UI-active design only while it agrees with the session's
 * prior binding. A target that changed under the client, or none at all, is refused, never guessed.
 */
async function resolveSessionDesign(
  options: McpOptions, actorScope: string, chatId: string, requested: unknown,
): Promise<{ designId: string } | TargetRefusal> {
  const designer = options.context.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  const nameOf = async (designId: string) => (await designer?.getDesign(designId))?.head.name ?? null;
  const explicit = typeof requested === "string" ? requested : null;
  const chosen = explicit ?? options.actors.pinnedDesign(actorScope);
  if (chosen) {
    if (await nameOf(chosen) !== null) return { designId: chosen };
    return { errorCode: "DESIGN_TARGET_STALE", candidates: [{ designId: chosen, name: null, source: explicit ? "explicit" : "pinned" }],
      message: `The ${explicit ? "requested" : "pinned"} design '${chosen}' no longer exists. ${TARGET_HINT}` };
  }
  const active = designer?.getActiveDesignId() ?? null;
  const bound = options.contextResolver.getPrimaryDesign(chatId);
  if (active && (!bound || bound.refId === active)) return { designId: active };
  const candidates: TargetCandidate[] = bound?.refId ? [{ designId: bound.refId, name: bound.label, source: "session" }] : [];
  if (active) {
    const shown: TargetCandidate = { designId: active, name: await nameOf(active), source: "ui-active" };
    return { errorCode: "DESIGN_TARGET_AMBIGUOUS", candidates: [...candidates, shown],
      message: `This MCP session is bound to ${describeTarget(candidates[0]!)} but the OpenPCB UI now shows ` +
        `${describeTarget(shown)}; refusing to guess. ${TARGET_HINT}` };
  }
  for (const design of (await designer?.listDesigns()) ?? []) {
    if (candidates.length >= MAX_LISTED_CANDIDATES) break;
    if (design.id !== bound?.refId) candidates.push({ designId: design.id, name: design.name, source: "available" });
  }
  return { errorCode: "DESIGN_TARGET_AMBIGUOUS", candidates,
    message: "No design is open in the OpenPCB UI and this MCP session has no pinned design. " +
      `Candidates: ${candidates.length ? candidates.map(describeTarget).join(", ") : "none"}. ${TARGET_HINT}` };
}

async function unknownDesignRefusal(options: McpOptions, requested: string): Promise<TargetRefusal> {
  const designer = options.context.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  const candidates: TargetCandidate[] = ((await designer?.listDesigns()) ?? []).slice(0, MAX_LISTED_CANDIDATES)
    .map((design) => ({ designId: design.id, name: design.name, source: "available" }));
  return { errorCode: "DESIGN_NOT_FOUND", candidates,
    message: `Design '${requested}' does not exist, so nothing was pinned. ` +
      `Candidates: ${candidates.length ? candidates.map(describeTarget).join(", ") : "none"}. ${TARGET_HINT}` };
}

function describeTarget(candidate: TargetCandidate): string {
  return candidate.name === null ? `'${candidate.designId}'` : `"${candidate.name}" ('${candidate.designId}')`;
}

function targetRefusal(context: AiToolExecutionContext, refusal: TargetRefusal): AiToolResult {
  const errorMessage = `${refusal.errorCode}: ${refusal.message}`;
  return { ok: false, data: { errorCode: refusal.errorCode, errorMessage, candidates: refusal.candidates },
    summary: errorMessage, warnings: [errorMessage], sources: [], truncated: false, limits: context.limits };
}

async function bindSession(options: McpOptions, chatId: string, designId: string): Promise<void> {
  const designer = options.context.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  const design = await designer?.getDesign(designId);
  if (!design) throw new Error(`Design '${designId}' not found.`);
  const prior = options.contextResolver.getPrimaryDesign(chatId);
  if (prior?.refId === designId) return;
  if (prior) options.contextStore.deleteBinding(chatId, prior.id);
  await options.contextResolver.bindDesign(chatId, { id: design.head.id, name: design.head.name });
}

function pinTool(options: McpOptions, actorScope: string): AiTool {
  return {
    definition: { name: "designer_use_design", version: "1", effect: "read", capability: "designer.read",
      description: "Pin this MCP session to a design so later calls do not need designId; an unknown id is refused and nothing is pinned. " +
        "Without a pin, calls follow the design focused in the OpenPCB UI only while it is this session's design: if no design is focused, " +
        "or the UI shows a different one, calls are refused with the candidate ids instead of guessing. " +
        "Pass null to drop the pin and bind the session to the design currently focused in the UI. Call designer_list_designs first to get an id.",
      inputSchema: { type: "object", properties: { designId: { type: ["string", "null"],
        description: "Design id to pin, or null to clear the pin." } } } },
    async execute(context, input) {
      context.signal?.throwIfAborted();
      const args = input as { designId?: string | null };
      const requested = args.designId ?? null;
      if (!context.chatId || !options.actors.has(actorScope, context.chatId)) throw new Error("MCP_ACTOR_DENIED");
      if (requested && !(await options.context.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER)?.getDesign(requested))) {
        return targetRefusal(context, await unknownDesignRefusal(options, requested));
      }
      if (requested) await bindSession(options, context.chatId, requested);
      else {
        const designer = options.context.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
        const active = designer?.getActiveDesignId();
        if (active) await bindSession(options, context.chatId, active);
        else {
          const prior = options.contextResolver.getPrimaryDesign(context.chatId);
          if (prior) options.contextStore.deleteBinding(context.chatId, prior.id);
        }
      }
      options.actors.pin(actorScope, requested);
      return { ok: true, data: { pinnedDesignId: requested }, modelData: { pinnedDesignId: requested },
        sources: [], warnings: [], truncated: false, limits: context.limits };
    },
  };
}
