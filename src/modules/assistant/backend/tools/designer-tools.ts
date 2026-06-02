import type {
  AiSourceRef,
  AiTool,
  AiToolRegistry,
  AiToolResult,
} from "@openpcb/ai-core";
import { truncateArray } from "@openpcb/ai-core";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import {
  MODULE_SDK_TOKENS,
  type AssistantPlacementProposal,
  type AssistantWriteProposalDto,
  type DesignerDesignSummary,
  type DesignerSDK,
  type DesignerCommandEnvelope,
  type DesignerSchematicProjection,
  type DesignerPcbProjection,
} from "../../../../sdks";
import type { ContextResolver } from "../context-resolver";
import type { ConversationStore } from "../conversation-store";
import { ACTION_ID_DESC, isValidActionId } from "./action-id";
import {
  buildProjectionIndex,
  planNetConnect,
  resolvePartTarget,
  resolvePinTarget,
  resolveWireEndpoint,
  type PinTarget,
  type WireEndpoint,
} from "./schematic-targeting";

const AI_DESIGNER_SESSION_ID = "designer-ui-session";
const SCHEMATIC_GRID_NM = 2_000_000;
const DEFAULT_GRID_SPACING_X_NM = 24_000_000;
const DEFAULT_GRID_SPACING_Y_NM = 16_000_000;
const MAX_PLACEMENTS_PER_PROPOSAL = 20;

export interface DesignerToolOptions {
  isSessionAutoApplyAllowed?: (input: {
    chatId: string;
    toolName: string;
    proposalKind: string;
    riskLevel?: string | null;
  }) => boolean;
}

interface PlacementProposalEnvelope {
  id: string;
  kind: "designer_place_components";
  toolName: "designer_place_components";
  /** Idempotency key from the model (Track D); dedup re-runs by design + key. */
  actionId?: string;
  title: string;
  summary: string;
  riskLevel: "medium";
  designId: string;
  baseRevision: number;
  operations: Array<{
    id: string;
    kind: "designer.place_part";
    title: string;
    summary: string;
    riskLevel: "medium";
    payload: unknown;
    sources: AiSourceRef[];
    warnings: string[];
  }>;
  payload: AssistantPlacementProposal;
  sources: AiSourceRef[];
  warnings: string[];
}

export interface SchematicProposalEnvelope {
  id: string;
  kind:
    | "designer_schematic_edits"
    | "designer_schematic_wires"
    | "designer_schematic_updates"
    | "designer_schematic_deletions";
  toolName:
    | "designer_propose_schematic_edits"
    | "designer_propose_schematic_wires"
    | "designer_propose_schematic_updates"
    | "designer_propose_schematic_deletions"
    | "designer_arrange_schematic";
  /** Idempotency key from the model (Track D); dedup re-runs by design + key. */
  actionId?: string;
  title: string;
  summary: string;
  riskLevel: "medium" | "high" | "destructive";
  designId: string;
  baseRevision: number;
  operations: Array<{
    id: string;
    kind: string;
    title: string;
    summary: string;
    riskLevel: "medium" | "high" | "destructive";
    payload: DesignerCommandEnvelope["command"];
    updatePartAfterCreate?: {
      value?: string;
      propertiesJson?: Record<string, string>;
    };
    /** Net-connect: after this primitive is created, wire `sourcePinId` to the
     *  newly-created primitive's pin (`primitive:<createdEntityId>`). */
    linkWireToCreatedPrimitive?: {
      sourcePinId: string;
    };
    sources: AiSourceRef[];
    warnings: string[];
  }>;
  payload: unknown;
  sources: AiSourceRef[];
  warnings: string[];
}

export interface SchematicApplyResult {
  proposalId: string;
  status: "applied" | "partial" | "failed";
  designId: string;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  stoppedAtOperationId?: string;
  operations: Array<{
    operationId: string;
    status: "applied" | "failed";
    commandId?: string;
    revisionBefore?: number | null;
    revisionAfter?: number;
    createdEntityId?: string | null;
    error?: string;
    result?: unknown;
  }>;
  message: string;
}

// ─── idempotency + slim model-facing result helpers (Track D) ──────────

/** Slim, truthful view the model sees instead of the full envelope. */
interface WriteToolModelData {
  appliedCount: number;
  skipped: Array<{ id: string; reason: string }>;
  status: "ok" | "partial" | "pending" | "already_applied";
}

/**
 * Look for a prior write proposal in this chat that carries the same
 * `actionId` for the same design — regardless of status. Used to make write
 * tools idempotent and to block duplicate in-flight dispatches: re-issuing the
 * same action_id must never duplicate placements/wires.
 *
 * Returns the most recent matching record (proposals are listed created-at
 * ASC) so the dedup decision reflects the latest known state of that action.
 */
function findPriorByActionId(
  conversation: ConversationStore,
  chatId: string,
  designId: string,
  actionId: string,
): AssistantWriteProposalDto | null {
  let match: AssistantWriteProposalDto | null = null;
  for (const record of conversation.listWriteProposals(chatId)) {
    if (record.designId !== designId) continue;
    const envelope = (record as { envelope?: unknown }).envelope as
      | { actionId?: unknown }
      | null
      | undefined;
    if (envelope && envelope.actionId === actionId) match = record;
  }
  return match;
}

/**
 * Idempotency / duplicate guard for write tools. Returns a terminal tool
 * result when a prior proposal for the same (designId + actionId) means we must
 * NOT dispatch again, or null when this action is fresh and may proceed:
 *  - applied / partial → already landed; replay its persisted apply result.
 *  - pending           → an earlier identical action is still in-flight (auto-
 *                        apply gated or concurrent); block to avoid a duplicate
 *                        write.
 *  - failed            → a prior identical action errored; a blind re-dispatch
 *                        could double-write whatever partially landed. Block
 *                        and report so correction goes through a fresh action.
 *  - rejected          → user declined; allow a fresh attempt (returns null).
 */
function dedupByActionId<T>(
  conversation: ConversationStore,
  chatId: string,
  designId: string,
  actionId: string,
  limits: AiToolResult<T>["limits"],
): AiToolResult<T | null> | null {
  const prior = findPriorByActionId(conversation, chatId, designId, actionId);
  if (!prior) return null;
  if (prior.status === "applied" || prior.status === "partial") {
    return alreadyAppliedResult<T>(prior, actionId, limits);
  }
  if (prior.status === "pending" || prior.status === "failed") {
    return duplicateInFlightResult<T>(prior, actionId, limits);
  }
  // rejected (or any future non-blocking status): allow a fresh attempt.
  return null;
}

/**
 * Validate a model-supplied `action_id`. Returns the trimmed id when usable,
 * or null (with a pushed warning) when malformed — malformed ids fall back to
 * non-idempotent behavior rather than failing the tool call.
 */
function normalizeActionId(
  raw: string | undefined,
  warnings: string[],
): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!isValidActionId(trimmed)) {
    warnings.push(
      `Ignored malformed action_id "${trimmed}" (expected <verb>_<key>_<designId>).`,
    );
    return null;
  }
  return trimmed;
}

/** Build the slim already-applied result returned on an idempotent re-run. */
function alreadyAppliedResult<T>(
  record: AssistantWriteProposalDto,
  actionId: string,
  limits: AiToolResult<T>["limits"],
): AiToolResult<T | null> {
  const modelData: WriteToolModelData = {
    appliedCount: 0,
    skipped: [],
    status: "already_applied",
  };
  const data =
    ((record as { envelope?: unknown }).envelope as T | undefined) ?? null;
  return {
    ok: true,
    status: "ok",
    summary: `already_applied: ${actionId}`,
    data,
    modelData,
    sources: [],
    warnings: [],
    truncated: false,
    limits,
  };
}

/**
 * Blocked-duplicate result: a prior proposal with the same action_id is still
 * pending (in-flight) or previously failed, so we refuse to dispatch again to
 * avoid duplicate writes. Reported as ok:false so the loop does not treat the
 * blocked call as progress, but carries no data mutation.
 */
function duplicateInFlightResult<T>(
  record: AssistantWriteProposalDto,
  actionId: string,
  limits: AiToolResult<T>["limits"],
): AiToolResult<T | null> {
  const reason =
    record.status === "failed"
      ? `action_id "${actionId}" already attempted and failed; do not re-issue it. Inspect the design state and use a new action_id only for the parts that still need fixing.`
      : `action_id "${actionId}" is already in-flight (pending). Wait for it to settle instead of re-issuing the same write.`;
  const modelData: WriteToolModelData = {
    appliedCount: 0,
    skipped: [{ id: actionId, reason }],
    status: "already_applied",
  };
  const data =
    ((record as { envelope?: unknown }).envelope as T | undefined) ?? null;
  return {
    ok: false,
    status: "partial",
    summary: `duplicate_blocked: ${actionId}`,
    data,
    modelData,
    sources: [],
    warnings: [reason],
    truncated: false,
    limits,
  };
}

// ─── designer_resolve_design ───────────────────────────────────────────

interface DesignerResolveDesignInput {
  query: string;
  allowAlreadyBound?: boolean;
}

interface DesignerResolveDesignOutput {
  status:
    | "resolved"
    | "ambiguous"
    | "not-found"
    | "already-bound-to-other-design";
  resolvedDesign?: {
    id: string;
    name: string;
    revision: number;
    updatedAt: string;
  };
  candidates: Array<{
    id: string;
    name: string;
    revision: number;
    updatedAt: string;
    reason: string;
  }>;
  message: string;
}

export function makeDesignerResolveDesignTool(
  contextResolver: ContextResolver,
): AiTool<DesignerResolveDesignInput, DesignerResolveDesignOutput> {
  return {
    definition: {
      name: "designer_resolve_design",
      version: "1",
      effect: "read",
      capability: "designer.read",
      description:
        "Resolve a design by natural-language name. On a clean unambiguous match in an unbound chat, binds the chat to that design.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          allowAlreadyBound: { type: "boolean" },
        },
        required: ["query"],
      },
    },
    async execute(
      execCtx,
      input,
    ): Promise<AiToolResult<DesignerResolveDesignOutput>> {
      const chatId = execCtx.chatId;
      if (!chatId) {
        return {
          ok: false,
          data: {
            status: "not-found",
            candidates: [],
            message: "Chat context missing.",
          },
          sources: [],
          warnings: ["chatId required"],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      const result = await contextResolver.resolveDesign(chatId, input.query, {
        allowAlreadyBound: input.allowAlreadyBound === true,
      });
      const output: DesignerResolveDesignOutput = {
        status: result.status,
        resolvedDesign: result.resolved
          ? {
              id: result.resolved.id,
              name: result.resolved.name,
              revision: result.resolved.revision,
              updatedAt: result.resolved.updatedAt,
            }
          : undefined,
        candidates: result.candidates.map((c) => ({
          id: c.id,
          name: c.name,
          revision: c.revision,
          updatedAt: c.updatedAt,
          reason: c.matchKind,
        })),
        message: result.message,
      };
      const sources: AiSourceRef[] = result.resolved
        ? [
            {
              id: `design_${result.resolved.id}`,
              kind: "design",
              refId: result.resolved.id,
              label: result.resolved.name,
            },
          ]
        : [];
      return {
        ok: true,
        data: output,
        sources,
        warnings: [],
        truncated: false,
        limits: execCtx.limits,
      };
    },
  };
}

// ─── designer_get_design_summary ───────────────────────────────────────

interface DesignerGetDesignSummaryInput {
  designId?: string;
}

interface DesignerGetDesignSummaryOutput {
  design: { id: string; name: string; revision: number; updatedAt: string };
  schematic: {
    partCount: number;
    wireCount: number;
    labelCount: number;
    primitiveCount: number;
    junctionCount: number;
    netCount: number;
    parts: Array<{
      id: string;
      reference: string;
      value: string;
      componentId: string;
    }>;
    nets: Array<{
      id: string;
      name: string;
      pinCount: number;
      labelCount: number;
    }>;
  };
  pcb: {
    available: boolean;
    placementCount: number;
    traceCount: number;
    viaCount: number;
    freePadCount: number;
    freeHoleCount: number;
    ratsnestCount: number;
    warnings: string[];
  };
  erc?: {
    errors: number;
    warnings: number;
    infos: number;
    topViolations: Array<{ code: string; severity: string; message: string }>;
  };
}

function summarizeSchematic(
  projection: DesignerSchematicProjection,
  partLimit: number,
  netLimit: number,
): {
  summary: DesignerGetDesignSummaryOutput["schematic"];
  truncated: boolean;
} {
  const partsAll = projection.parts.map((p) => ({
    id: p.id,
    reference: p.reference,
    value: p.value,
    componentId: p.componentId,
  }));
  const netsAll = projection.nets.map((n) => ({
    id: n.id,
    name: n.name,
    pinCount: n.pinIds.length,
    labelCount: n.labelIds.length,
  }));
  const { items: parts, truncated: partsTrunc } = truncateArray(
    partsAll,
    partLimit,
  );
  const { items: nets, truncated: netsTrunc } = truncateArray(
    netsAll,
    netLimit,
  );
  return {
    summary: {
      partCount: projection.parts.length,
      wireCount: projection.wires.length,
      labelCount: projection.labels.length,
      primitiveCount: projection.primitives.length,
      junctionCount: projection.junctions.length,
      netCount: projection.nets.length,
      parts,
      nets,
    },
    truncated: partsTrunc || netsTrunc,
  };
}

function summarizePcb(
  projection: DesignerPcbProjection | null,
): DesignerGetDesignSummaryOutput["pcb"] {
  if (!projection) {
    return {
      available: false,
      placementCount: 0,
      traceCount: 0,
      viaCount: 0,
      freePadCount: 0,
      freeHoleCount: 0,
      ratsnestCount: 0,
      warnings: [],
    };
  }
  return {
    available: true,
    placementCount: projection.placements.length,
    traceCount: projection.traces.length,
    viaCount: projection.vias.length,
    freePadCount: projection.freePads.length,
    freeHoleCount: projection.freeHoles.length,
    ratsnestCount: projection.ratsnest.length,
    warnings: projection.warnings.slice(0, 10),
  };
}

function resolveDesignForTool(input: {
  chatId?: string;
  requestedDesignId?: string;
  contextResolver: ContextResolver;
}):
  | { ok: true; designId: string; label?: string }
  | { ok: false; warning: string } {
  const primary = input.chatId
    ? input.contextResolver.getPrimaryDesign(input.chatId)
    : undefined;
  if (primary?.status === "missing") {
    return {
      ok: false,
      warning:
        "The bound design is missing. Choose another design before continuing.",
    };
  }
  if (
    primary &&
    input.requestedDesignId &&
    input.requestedDesignId !== primary.refId
  ) {
    return {
      ok: false,
      warning:
        "This chat is already bound to another design. Start a new chat for the other design.",
    };
  }
  const designId = input.requestedDesignId ?? primary?.refId;
  if (!designId) {
    return {
      ok: false,
      warning:
        "No design specified. Resolve a design first via designer_resolve_design.",
    };
  }
  return { ok: true, designId, label: primary?.label };
}

export function makeDesignerGetDesignSummaryTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
): AiTool<
  DesignerGetDesignSummaryInput,
  DesignerGetDesignSummaryOutput | null
> {
  return {
    definition: {
      name: "designer_get_design_summary",
      version: "1",
      effect: "read",
      capability: "designer.read",
      description:
        "Compact one-shot summary of a design: schematic part/net counts, PCB placement/trace counts, and top ERC violations. Uses the bound design if designId is omitted.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
        },
      },
    },
    async execute(
      execCtx,
      input,
    ): Promise<AiToolResult<DesignerGetDesignSummaryOutput | null>> {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: ["Designer module not available."],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      const resolvedDesign = resolveDesignForTool({
        chatId: execCtx.chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: [resolvedDesign.warning],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      const designId = resolvedDesign.designId;
      const designRecord = await designer.getDesign(designId);
      if (!designRecord) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: [`Design not found: ${designId}`],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      const [projection, pcb, erc] = await Promise.all([
        designer.getSchematicProjection(designId),
        designer.getPcbProjection(designId).catch(() => null),
        designer.runErc(designId).catch(() => null),
      ]);
      if (!projection) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: ["Schematic projection unavailable."],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      // Auto-bind on success.
      if (execCtx.chatId)
        await contextResolver.maybeAutoBindDesign(execCtx.chatId, designId);

      const partLimit = execCtx.limits.maxItems ?? 50;
      const netLimit = Math.max(
        10,
        Math.floor((execCtx.limits.maxItems ?? 50) / 2),
      );
      const { summary, truncated: schemTrunc } = summarizeSchematic(
        projection,
        partLimit,
        netLimit,
      );
      const pcbSummary = summarizePcb(pcb);
      const ercSummary = erc
        ? {
            errors: erc.summary.errors,
            warnings: erc.summary.warnings,
            infos: erc.summary.infos,
            topViolations: erc.violations
              .slice()
              .sort(
                (a, b) => severityRank(b.severity) - severityRank(a.severity),
              )
              .slice(0, 5)
              .map((v) => ({
                code: v.code,
                severity: v.severity,
                message: v.message,
              })),
          }
        : undefined;
      const output: DesignerGetDesignSummaryOutput = {
        design: {
          id: designRecord.head.id,
          name: designRecord.head.name,
          revision: designRecord.head.revision,
          updatedAt: designRecord.head.updatedAt,
        },
        schematic: summary,
        pcb: pcbSummary,
        erc: ercSummary,
      };
      const sources: AiSourceRef[] = [
        {
          id: `design_${designRecord.head.id}`,
          kind: "design",
          refId: designRecord.head.id,
          label: designRecord.head.name,
        },
        {
          id: `sch_${designRecord.head.id}`,
          kind: "schematic",
          refId: designRecord.head.id,
          label: `${designRecord.head.name} schematic`,
        },
      ];
      if (pcb) {
        sources.push({
          id: `pcb_${designRecord.head.id}`,
          kind: "pcb",
          refId: designRecord.head.id,
          label: `${designRecord.head.name} PCB`,
        });
      }
      return {
        ok: true,
        data: output,
        sources,
        warnings: [],
        truncated: schemTrunc,
        limits: execCtx.limits,
      };
    },
  };
}

function severityRank(severity: string): number {
  switch (severity) {
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

// ─── designer_get_part_detail ──────────────────────────────────────────

interface DesignerGetPartDetailInput {
  designId?: string;
  referenceOrPartId: string;
}

interface PartCandidate {
  id: string;
  reference: string;
  value: string;
  componentId: string;
}

interface DesignerGetPartDetailOutput {
  status: "resolved" | "ambiguous" | "not-found";
  candidates?: PartCandidate[];
  part?: {
    id: string;
    reference: string;
    value: string;
    componentId: string;
    positionNm: { x: number; y: number };
    rotationDeg: number;
    mirrored: boolean;
    pins: Array<{
      id: string;
      number: string | null;
      name: string;
      electricalType: string;
      netId: string | null;
      netName: string | null;
    }>;
    footprint: { footprintId: string; name: string; mountType: string | null };
    pcbPlacement?: {
      placementId: string;
      positionMm: { x: number; y: number };
      rotationDeg: number;
      layer: string;
      mirrored: boolean;
    };
  };
}

export function makeDesignerGetPartDetailTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
): AiTool<DesignerGetPartDetailInput, DesignerGetPartDetailOutput | null> {
  return {
    definition: {
      name: "designer_get_part_detail",
      version: "1",
      effect: "read",
      capability: "designer.read",
      description:
        "Resolve a placed schematic part by reference (e.g. U1) within the bound design. Returns pin/net mapping and PCB placement if available.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          referenceOrPartId: { type: "string" },
        },
        required: ["referenceOrPartId"],
      },
    },
    async execute(
      execCtx,
      input,
    ): Promise<AiToolResult<DesignerGetPartDetailOutput | null>> {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: ["Designer module not available."],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      const resolvedDesign = resolveDesignForTool({
        chatId: execCtx.chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: [resolvedDesign.warning],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      const designId = resolvedDesign.designId;
      const projection = await designer.getSchematicProjection(designId);
      if (!projection) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: [`Schematic projection not available for ${designId}`],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      const ref = input.referenceOrPartId.trim();
      const refLower = ref.toLowerCase();
      const candidates = projection.parts.filter(
        (p) => p.reference.toLowerCase() === refLower || p.id === ref,
      );
      if (candidates.length === 0) {
        return {
          ok: true,
          data: { status: "not-found", candidates: [] },
          sources: [],
          warnings: [],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      if (candidates.length > 1) {
        return {
          ok: true,
          data: {
            status: "ambiguous",
            candidates: candidates.map((c) => ({
              id: c.id,
              reference: c.reference,
              value: c.value,
              componentId: c.componentId,
            })),
          },
          sources: [],
          warnings: [],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      const part = candidates[0]!;
      const pinToNet = new Map<string, { netId: string; netName: string }>();
      for (const net of projection.nets) {
        for (const pinId of net.pinIds) {
          pinToNet.set(pinId, { netId: net.id, netName: net.name });
        }
      }
      const pins = part.pins.map((p) => {
        const net = pinToNet.get(p.id);
        return {
          id: p.id,
          number: p.number,
          name: p.name,
          electricalType: p.electricalType,
          netId: net?.netId ?? null,
          netName: net?.netName ?? null,
        };
      });

      let pcbPlacement:
        | {
            placementId: string;
            positionMm: { x: number; y: number };
            rotationDeg: number;
            layer: string;
            mirrored: boolean;
          }
        | undefined;
      try {
        const pcb = await designer.getPcbProjection(designId);
        const placement = pcb?.placements.find(
          (pl) => pl.partId === part.id || pl.reference === part.reference,
        );
        if (placement) {
          pcbPlacement = {
            placementId: placement.id,
            positionMm: placement.positionMm,
            rotationDeg: placement.rotationDeg,
            layer: placement.layer,
            mirrored: placement.mirrored,
          };
        }
      } catch {
        // ignore
      }

      if (execCtx.chatId)
        await contextResolver.maybeAutoBindDesign(execCtx.chatId, designId);

      const output: DesignerGetPartDetailOutput = {
        status: "resolved",
        part: {
          id: part.id,
          reference: part.reference,
          value: part.value,
          componentId: part.componentId,
          positionNm: part.positionNm,
          rotationDeg: part.rotationDeg,
          mirrored: part.mirrored,
          pins,
          footprint: {
            footprintId: part.footprint.footprintId,
            name: part.footprint.name,
            mountType: part.footprint.mountType,
          },
          pcbPlacement,
        },
      };
      const sources: AiSourceRef[] = [
        {
          id: `design_${designId}`,
          kind: "design",
          refId: designId,
          label: resolvedDesign.label ?? designId,
        },
        {
          id: `part_${part.id}`,
          kind: "part",
          refId: part.id,
          label: `${part.reference} ${part.value}`,
        },
      ];
      return {
        ok: true,
        data: output,
        sources,
        warnings: [],
        truncated: false,
        limits: execCtx.limits,
      };
    },
  };
}

// ─── designer_place_components ─────────────────────────────────────────

interface DesignerCreateDesignInput {
  name?: string;
}

interface DesignerCreateDesignOutput {
  design: {
    id: string;
    name: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
  };
  bound: boolean;
  message: string;
}

export function makeDesignerCreateDesignTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
): AiTool<DesignerCreateDesignInput, DesignerCreateDesignOutput | null> {
  return {
    definition: {
      name: "designer_create_design",
      version: "1",
      effect: "write",
      capability: "designer.write.create_design",
      description:
        "Create a new empty OpenPCB design and bind this chat to it. Use after the user has chosen a project direction and wants a new schematic canvas.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Short human-readable design name.",
            maxLength: 120,
          },
        },
      },
    },
    async execute(
      execCtx,
      input,
    ): Promise<AiToolResult<DesignerCreateDesignOutput | null>> {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer) {
        return failedTool("Designer module not available.", execCtx.limits);
      }
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);
      const primary = contextResolver.getPrimaryDesign(chatId);
      if (primary?.status === "active") {
        return failedTool(
          `This chat is already bound to "${primary.label}". Start a new chat to create another design.`,
          execCtx.limits,
        );
      }

      const name = normalizeDesignName(input.name);
      const created = await designer.createDesign({ name });
      await contextResolver.bindDesign(chatId, {
        id: created.id,
        name: created.name,
      });

      const output: DesignerCreateDesignOutput = {
        design: summarizeCreatedDesign(created),
        bound: true,
        message: `Created and bound new design "${created.name}".`,
      };
      return {
        ok: true,
        data: output,
        sources: [
          {
            id: `design_${created.id}`,
            kind: "design",
            refId: created.id,
            label: created.name,
          },
        ],
        warnings: [],
        truncated: false,
        limits: execCtx.limits,
      };
    },
  };
}

function normalizeDesignName(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "AI Draft Design";
  return trimmed.length > 120 ? trimmed.slice(0, 120).trim() : trimmed;
}

function summarizeCreatedDesign(
  created: DesignerDesignSummary,
): DesignerCreateDesignOutput["design"] {
  return {
    id: created.id,
    name: created.name,
    revision: created.revision,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

interface DesignerPlaceComponentsInput {
  designId?: string;
  action_id?: string;
  components: Array<{
    componentId: string;
    quantity?: number;
    rotationDeg?: 0 | 90 | 180 | 270;
    mirrored?: boolean;
    value?: string;
    properties?: Record<string, string>;
    note?: string;
  }>;
  layout?: { mode?: "auto-grid"; columns?: number };
}

function snapNm(value: number): number {
  return Math.round(value / SCHEMATIC_GRID_NM) * SCHEMATIC_GRID_NM;
}

function resolvePlacementStart(projection: DesignerSchematicProjection): {
  x: number;
  y: number;
} {
  if (projection.parts.length === 0) return { x: 0, y: 0 };
  // Start to the right of every existing part's actual right edge (pin extent),
  // not just its origin — otherwise a wide part can overlap new placements.
  let rightEdge = -Infinity;
  let topEdge = Infinity;
  for (const part of projection.parts) {
    const xs = part.pins.map((pin) => pin.worldPositionNm.x);
    const ys = part.pins.map((pin) => pin.worldPositionNm.y);
    rightEdge = Math.max(rightEdge, part.positionNm.x, ...xs);
    topEdge = Math.min(topEdge, part.positionNm.y, ...ys);
  }
  return {
    x: snapNm(rightEdge + DEFAULT_GRID_SPACING_X_NM),
    y: snapNm(Number.isFinite(topEdge) ? topEdge : 0),
  };
}

function expandPlacementInputs(input: DesignerPlaceComponentsInput): Array<{
  componentId: string;
  rotationDeg: 0 | 90 | 180 | 270;
  mirrored: boolean;
  note?: string;
  value?: string;
  properties?: Record<string, string>;
}> {
  const out: Array<{
    componentId: string;
    rotationDeg: 0 | 90 | 180 | 270;
    mirrored: boolean;
    note?: string;
    value?: string;
    properties?: Record<string, string>;
  }> = [];
  for (const item of input.components ?? []) {
    const quantity = Math.max(1, Math.min(20, Math.floor(item.quantity ?? 1)));
    for (let i = 0; i < quantity; i++) {
      out.push({
        componentId: item.componentId,
        rotationDeg: item.rotationDeg ?? 0,
        mirrored: item.mirrored === true,
        note: item.note,
        value: item.value,
        properties: item.properties,
      });
      if (out.length >= MAX_PLACEMENTS_PER_PROPOSAL) return out;
    }
  }
  return out;
}

function countRequestedPlacements(input: DesignerPlaceComponentsInput): number {
  return (input.components ?? []).reduce((total, item) => {
    const quantity = Number.isFinite(item.quantity ?? 1)
      ? Math.max(1, Math.floor(item.quantity ?? 1))
      : 1;
    return total + quantity;
  }, 0);
}

export function makeDesignerPlaceComponentsTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions = {},
): AiTool<DesignerPlaceComponentsInput, AssistantPlacementProposal | null> {
  return {
    definition: {
      name: "designer_place_components",
      version: "1",
      effect: "write",
      capability: "designer.write.schematic.place_components",
      description:
        "Place installed library components onto the bound design's schematic canvas. Non-destructive: auto-applies immediately and is undoable. Prefer designer_propose_schematic_edits for placement (it also adds labels/power ports and wires in one batch); use this only for a plain quantity-based drop.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          action_id: { type: "string", description: ACTION_ID_DESC },
          components: {
            type: "array",
            items: {
              type: "object",
              properties: {
                componentId: { type: "string" },
                quantity: { type: "integer", minimum: 1, maximum: 20 },
                rotationDeg: { type: "integer", enum: [0, 90, 180, 270] },
                mirrored: { type: "boolean" },
                value: {
                  type: "string",
                  description:
                    "Optional displayed part value/intended value, e.g. 330Ω, 10k, 10µF, red LED.",
                },
                properties: {
                  type: "object",
                  description:
                    "Optional string metadata such as color, role, tolerance, voltage, current, or package intent.",
                },
                note: { type: "string" },
              },
              required: ["componentId"],
            },
          },
          layout: {
            type: "object",
            properties: {
              mode: { type: "string", enum: ["auto-grid"] },
              columns: { type: "integer", minimum: 1, maximum: 8 },
            },
          },
        },
        required: ["components"],
      },
    },
    async execute(
      execCtx,
      input,
    ): Promise<AiToolResult<AssistantPlacementProposal | null>> {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer) {
        return failedTool("Designer module not available.", execCtx.limits);
      }
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({
        chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok)
        return failedTool(resolvedDesign.warning, execCtx.limits);
      const designId = resolvedDesign.designId;
      const [designRecord, projection] = await Promise.all([
        designer.getDesign(designId),
        designer.getSchematicProjection(designId),
      ]);
      if (!designRecord || !projection) {
        return failedTool(
          `Design not found or unavailable: ${designId}`,
          execCtx.limits,
        );
      }
      const idempotencyWarnings: string[] = [];
      const actionId = normalizeActionId(input.action_id, idempotencyWarnings);
      if (actionId) {
        const dedup = dedupByActionId<AssistantPlacementProposal>(
          conversation,
          chatId,
          designId,
          actionId,
          execCtx.limits,
        );
        if (dedup) return dedup;
      }

      const requested = expandPlacementInputs(input);
      const placementInputTruncated =
        countRequestedPlacements(input) > MAX_PLACEMENTS_PER_PROPOSAL;
      if (requested.length === 0) {
        return failedTool(
          "No components requested for placement.",
          execCtx.limits,
        );
      }
      const columns = Math.max(
        1,
        Math.min(
          input.layout?.columns ?? Math.ceil(Math.sqrt(requested.length)),
          8,
        ),
      );
      const start = resolvePlacementStart(projection);
      const placements: AssistantPlacementProposal["placements"] = [];
      const skipped: AssistantPlacementProposal["skipped"] = [];

      for (const item of requested) {
        const detail = await designer.resolveLibraryComponentForPlacement(
          item.componentId,
        );
        if (!detail) {
          skipped.push({
            componentId: item.componentId,
            reason: "Installed library component not found.",
          });
          continue;
        }
        const idx = placements.length;
        placements.push({
          componentId: item.componentId,
          componentName: detail.component.name,
          positionNm: {
            x: snapNm(start.x + (idx % columns) * DEFAULT_GRID_SPACING_X_NM),
            y: snapNm(
              start.y + Math.floor(idx / columns) * DEFAULT_GRID_SPACING_Y_NM,
            ),
          },
          rotationDeg: item.rotationDeg,
          mirrored: item.mirrored,
          value: item.value,
          properties: item.properties,
          warnings: item.note ? [item.note] : [],
        });
      }

      if (placements.length === 0) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings:
            skipped.length > 0
              ? skipped.map((item) => `${item.componentId}: ${item.reason}`)
              : ["No valid installed components were resolved for placement."],
          truncated: placementInputTruncated,
          limits: execCtx.limits,
        };
      }

      await contextResolver.maybeAutoBindDesign(chatId, designId);

      const proposalId = crypto.randomUUID();
      const proposalWarnings = [
        ...idempotencyWarnings,
        ...skipped.map((item) => `${item.componentId}: ${item.reason}`),
      ];
      if (placementInputTruncated) {
        proposalWarnings.push(
          `Only the first ${MAX_PLACEMENTS_PER_PROPOSAL} requested placement(s) were included.`,
        );
      }
      const proposal: AssistantPlacementProposal = {
        proposalId,
        status: "pending_approval",
        design: {
          id: designRecord.head.id,
          name: designRecord.head.name,
          revision: designRecord.head.revision,
        },
        placements,
        skipped,
        requiresPartialConfirmation:
          skipped.length > 0 || placementInputTruncated,
      };
      const sources: AiSourceRef[] = [
        {
          id: `design_${designId}`,
          kind: "design",
          refId: designId,
          label: designRecord.head.name,
        },
        ...placements.map((placement) => ({
          id: `library_component_${placement.componentId}`,
          kind: "library-component" as const,
          refId: placement.componentId,
          label: placement.componentName,
        })),
      ];
      const envelope = buildPlacementProposalEnvelope({
        proposal,
        designId,
        baseRevision: designRecord.head.revision,
        sources,
        warnings: proposalWarnings,
        actionId,
      });
      conversation.createWriteProposal({
        id: proposalId,
        chatId,
        kind: "designer_place_components",
        designId,
        baseRevision: designRecord.head.revision,
        proposal,
        envelope,
      });
      // Build-time skips (unresolved components, truncation). These never reach
      // the apply path, so they are reported as skipped regardless of apply.
      const buildSkipped: WriteToolModelData["skipped"] = skipped.map(
        (item) => ({ id: item.componentId, reason: item.reason }),
      );
      if (placementInputTruncated)
        buildSkipped.push({
          id: "placements",
          reason: `Only the first ${MAX_PLACEMENTS_PER_PROPOSAL} placement(s) were included.`,
        });

      // Slim, truthful model-facing view. Defaults to the staged (pending)
      // state; overwritten below once auto-apply runs.
      let modelData: WriteToolModelData = {
        appliedCount: 0,
        skipped: buildSkipped,
        status: buildSkipped.length > 0 ? "partial" : "pending",
      };
      let toolOk = placements.length > 0;
      let toolStatus: "ok" | "partial" = "ok";
      let summary = `Staged ${placements.length} placement(s) on ${designRecord.head.name}.`;

      if (
        proposalWarnings.length === 0 &&
        options.isSessionAutoApplyAllowed?.({
          chatId,
          toolName: "designer_place_components",
          proposalKind: "designer_place_components",
          riskLevel: "medium",
        }) === true
      ) {
        try {
          const applyResult = await applyDesignerPlaceComponentsProposal({
            designer,
            proposal,
            designId,
            baseRevision: designRecord.head.revision,
            allowPartial: false,
          });
          conversation.updateWriteProposalStatus(
            chatId,
            proposalId,
            writeProposalTerminalStatus(applyResult),
            applyResult,
          );
          modelData = {
            appliedCount: applyResult.applied.length,
            skipped: buildSkipped,
            status: "ok",
          };
          toolOk = true;
          toolStatus = "ok";
          summary = `Placed ${applyResult.applied.length} component(s) on ${designRecord.head.name}.`;
        } catch (err) {
          // CRITICAL: a failed auto-apply must surface ok:false / partial — not
          // ok:true with warnings. Pull the applied count from the partial
          // result envelope when present.
          const applyResult = isAssistantProposalApplyError(err)
            ? (err.applyResult as {
                status?: string;
                applied?: unknown[];
              })
            : null;
          const message = err instanceof Error ? err.message : String(err);
          conversation.updateWriteProposalStatus(
            chatId,
            proposalId,
            writeProposalTerminalStatus(applyResult),
            applyResult ?? { message },
          );
          const appliedCount = applyResult?.applied?.length ?? 0;
          modelData = {
            appliedCount,
            skipped: [...buildSkipped, { id: "apply", reason: message }],
            status: "partial",
          };
          // A failed/partial auto-apply is not a success even if some ops
          // landed — return ok:false so the loop sees a deficiency.
          toolOk = false;
          toolStatus = "partial";
          summary = `Auto-apply failed: ${message}`;
          proposalWarnings.push(`Auto-apply failed: ${message}`);
        }
      }
      return {
        ok: toolOk,
        status: toolStatus,
        summary,
        data: proposal,
        modelData,
        sources,
        warnings: proposalWarnings,
        truncated: placementInputTruncated,
        limits: execCtx.limits,
      };
    },
  };
}

function buildPlacementProposalEnvelope(input: {
  proposal: AssistantPlacementProposal;
  designId: string;
  baseRevision: number;
  sources: AiSourceRef[];
  warnings: string[];
  actionId?: string | null;
}): PlacementProposalEnvelope {
  return {
    id: input.proposal.proposalId,
    kind: "designer_place_components",
    toolName: "designer_place_components",
    ...(input.actionId ? { actionId: input.actionId } : {}),
    title: `Place ${input.proposal.placements.length} component(s)`,
    summary: `Place ${input.proposal.placements.length} component(s) on ${input.proposal.design.name}.`,
    riskLevel: "medium",
    designId: input.designId,
    baseRevision: input.baseRevision,
    operations: input.proposal.placements.map((placement, index) => ({
      id: `${input.proposal.proposalId}:place:${index}`,
      kind: "designer.place_part",
      title: `Place ${placement.componentName}`,
      summary: `Place ${placement.componentName} at ${placement.positionNm.x}, ${placement.positionNm.y} nm.`,
      riskLevel: "medium",
      payload: {
        componentId: placement.componentId,
        positionNm: placement.positionNm,
        rotationDeg: placement.rotationDeg,
        mirrored: placement.mirrored,
        value: placement.value,
        properties: placement.properties,
      },
      sources: [
        {
          id: `library_component_${placement.componentId}`,
          kind: "library-component",
          refId: placement.componentId,
          label: placement.componentName,
        },
      ],
      warnings: placement.warnings,
    })),
    payload: input.proposal,
    sources: input.sources,
    warnings: input.warnings,
  };
}

function failedTool<T>(
  message: string,
  limits: AiToolResult<T>["limits"],
): AiToolResult<T | null> {
  return {
    ok: false,
    data: null,
    sources: [],
    warnings: [message],
    truncated: false,
    limits,
  };
}

function writeProposalTerminalStatus(
  result: unknown,
): "applied" | "partial" | "failed" {
  if (result && typeof result === "object" && "status" in result) {
    const status = (result as { status?: unknown }).status;
    if (status === "applied" || status === "partial") return status;
  }
  return "failed";
}

function netNameByPinId(
  projection: DesignerSchematicProjection,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const net of projection.nets) {
    for (const pinId of net.pinIds) map.set(pinId, net.name);
  }
  return map;
}

function pointOnWire(
  point: { x: number; y: number },
  wire: { pointsNm: Array<{ x: number; y: number }> },
): boolean {
  for (let i = 1; i < wire.pointsNm.length; i += 1) {
    const a = wire.pointsNm[i - 1]!;
    const b = wire.pointsNm[i]!;
    if (a.x === b.x && point.x === a.x) {
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      if (point.y >= minY && point.y <= maxY) return true;
    }
    if (a.y === b.y && point.y === a.y) {
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      if (point.x >= minX && point.x <= maxX) return true;
    }
  }
  return false;
}

// ─── designer_get_schematic_connectivity ───────────────────────────────

interface DesignerGetSchematicConnectivityInput {
  designId?: string;
  includePins?: boolean;
  includeNets?: boolean;
  includeWires?: boolean;
}

interface DesignerGetSchematicConnectivityOutput {
  design: { id: string; name: string; revision: number };
  parts: Array<{
    id: string;
    reference: string;
    value: string;
    componentId: string;
    positionNm: { x: number; y: number };
    rotationDeg: number;
    pins?: Array<{
      id: string;
      number: string | null;
      name: string;
      electricalType: string;
      worldPositionNm: { x: number; y: number };
      netName: string | null;
    }>;
  }>;
  primitives: Array<{
    id: string;
    kind: string;
    pinId: string;
    text: string;
    positionNm: { x: number; y: number };
  }>;
  nets?: Array<{
    id: string;
    name: string;
    pinIds: string[];
    labelIds: string[];
    primitiveIds: string[];
    wireIds: string[];
  }>;
  wires?: Array<{
    id: string;
    sourcePinId: string;
    targetPinId: string;
    pointsNm: Array<{ x: number; y: number }>;
  }>;
}

export function makeDesignerGetSchematicConnectivityTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
): AiTool<
  DesignerGetSchematicConnectivityInput,
  DesignerGetSchematicConnectivityOutput | null
> {
  return {
    definition: {
      name: "designer_get_schematic_connectivity",
      version: "1",
      effect: "read",
      capability: "designer.read.schematic.connectivity",
      description:
        "Return compact schematic connectivity for the bound design: placed parts, exact pin IDs/coordinates, nets, wires, and primitive pin IDs for planning safe wiring proposals.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          includePins: { type: "boolean" },
          includeNets: { type: "boolean" },
          includeWires: { type: "boolean" },
        },
      },
    },
    async execute(execCtx, input) {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer)
        return failedTool("Designer module not available.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({
        chatId: execCtx.chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok)
        return failedTool(resolvedDesign.warning, execCtx.limits);
      const design = await designer.getDesign(resolvedDesign.designId);
      if (!design)
        return failedTool(
          `Design not found: ${resolvedDesign.designId}`,
          execCtx.limits,
        );
      const projection = await designer.getSchematicProjection(
        resolvedDesign.designId,
      );
      if (!projection)
        return failedTool(
          `Schematic projection not found: ${resolvedDesign.designId}`,
          execCtx.limits,
        );
      const maxItems = execCtx.limits.maxItems ?? 50;
      const pinToNet = netNameByPinId(projection);
      const includePins = input.includePins !== false;
      const { items: parts, truncated: partsTruncated } = truncateArray(
        projection.parts.map((part) => ({
          id: part.id,
          reference: part.reference,
          value: part.value,
          componentId: part.componentId,
          positionNm: part.positionNm,
          rotationDeg: part.rotationDeg,
          pins: includePins
            ? part.pins.map((pin) => ({
                id: pin.id,
                number: pin.number,
                name: pin.name,
                electricalType: pin.electricalType,
                worldPositionNm: pin.worldPositionNm,
                netName: pinToNet.get(pin.id) ?? null,
              }))
            : undefined,
        })),
        maxItems,
      );
      const { items: nets, truncated: netsTruncated } = truncateArray(
        projection.nets.map((net) => ({
          id: net.id,
          name: net.name,
          pinIds: net.pinIds,
          labelIds: net.labelIds,
          primitiveIds: net.primitiveIds,
          wireIds: net.wireIds,
        })),
        maxItems,
      );
      const { items: wires, truncated: wiresTruncated } = truncateArray(
        projection.wires.map((wire) => ({
          id: wire.id,
          sourcePinId: wire.sourcePinId,
          targetPinId: wire.targetPinId,
          pointsNm: wire.pointsNm,
        })),
        maxItems,
      );
      const output: DesignerGetSchematicConnectivityOutput = {
        design: {
          id: design.head.id,
          name: design.head.name,
          revision: projection.revision,
        },
        parts,
        primitives: projection.primitives.map((primitive) => ({
          id: primitive.id,
          kind: primitive.kind,
          pinId: `primitive:${primitive.id}`,
          text:
            primitive.kind === "gnd"
              ? "GND"
              : primitive.kind === "pwr"
                ? primitive.railText
                : primitive.portalText,
          positionNm: primitive.positionNm,
        })),
        nets: input.includeNets === false ? undefined : nets,
        wires: input.includeWires === false ? undefined : wires,
      };
      return {
        ok: true,
        data: output,
        sources: [
          {
            id: `design_${design.head.id}`,
            kind: "design",
            refId: design.head.id,
            label: design.head.name,
          },
        ],
        warnings: [],
        truncated: partsTruncated || netsTruncated || wiresTruncated,
        limits: execCtx.limits,
      };
    },
  };
}

// ─── designer_propose_schematic_edits ──────────────────────────────────

interface DesignerProposeSchematicEditsInput {
  designId?: string;
  action_id?: string;
  title: string;
  summary: string;
  parts?: Array<{
    componentId: string;
    value?: string;
    positionNm?: { x: number; y: number };
    rotationDeg?: 0 | 90 | 180 | 270;
    mirrored?: boolean;
    properties?: Record<string, string>;
  }>;
  labels?: Array<{ text: string; positionNm: { x: number; y: number } }>;
  powerPorts?: Array<{
    kind: "gnd" | "pwr" | "net_portal";
    text?: string;
    positionNm: { x: number; y: number };
    rotationDeg?: 0 | 90 | 180 | 270;
  }>;
  wires?: Array<{
    source: WireEndpoint;
    target: WireEndpoint;
    netName?: string;
    reason?: string;
  }>;
}

export function makeDesignerProposeSchematicEditsTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions = {},
): AiTool<
  DesignerProposeSchematicEditsInput,
  SchematicProposalEnvelope | null
> {
  return {
    definition: {
      name: "designer_propose_schematic_edits",
      version: "1",
      effect: "write",
      capability: "designer.write.schematic.propose_edits",
      description:
        "Batch small schematic edits: place library parts, add net labels / power ports / net portals, and wire existing pins. Do NOT pass coordinates — omit positionNm and wire geometry; the layout is auto-arranged from connectivity and wires are auto-routed when this proposal applies. Just choose components and how their pins connect. Non-destructive, so it auto-applies. To wire freshly-placed parts, run this once to place them, then call designer_get_schematic_connectivity and wire by REF.PIN.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          action_id: { type: "string", description: ACTION_ID_DESC },
          title: { type: "string" },
          summary: { type: "string" },
          parts: {
            type: "array",
            description: "Library components to place.",
            items: {
              type: "object",
              properties: {
                componentId: { type: "string" },
                value: { type: "string" },
                positionNm: {
                  type: "object",
                  description:
                    "Optional. Omit it — placement is auto-arranged from connectivity after this proposal applies. Only pass coordinates to pin a specific part.",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  required: ["x", "y"],
                },
                rotationDeg: { type: "integer", enum: [0, 90, 180, 270] },
                mirrored: { type: "boolean" },
                properties: {
                  type: "object",
                  additionalProperties: { type: "string" },
                },
              },
              required: ["componentId"],
            },
          },
          labels: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                positionNm: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  required: ["x", "y"],
                },
              },
              required: ["text", "positionNm"],
            },
          },
          powerPorts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["gnd", "pwr", "net_portal"] },
                text: {
                  type: "string",
                  description:
                    'Rail/portal name (e.g. "+5V", "SDA"); ignored for gnd.',
                },
                positionNm: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  required: ["x", "y"],
                },
                rotationDeg: { type: "integer", enum: [0, 90, 180, 270] },
              },
              required: ["kind", "positionNm"],
            },
          },
          wires: {
            type: "array",
            description:
              "Connect existing pins (or a pin to a named net). Geometry is auto-routed.",
            items: {
              type: "object",
              properties: {
                source: ENDPOINT_SCHEMA,
                target: ENDPOINT_SCHEMA,
                netName: { type: "string" },
                reason: { type: "string" },
              },
              required: ["source", "target"],
            },
          },
        },
        required: ["title", "summary"],
      },
    },
    async execute(execCtx, input) {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer)
        return failedTool("Designer module not available.", execCtx.limits);
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({
        chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok)
        return failedTool(resolvedDesign.warning, execCtx.limits);
      const designId = resolvedDesign.designId;
      const designRecord = await designer.getDesign(designId);
      if (!designRecord)
        return failedTool(`Design not found: ${designId}`, execCtx.limits);
      const idempotencyWarnings: string[] = [];
      const actionId = normalizeActionId(input.action_id, idempotencyWarnings);
      if (actionId) {
        const dedup = dedupByActionId<SchematicProposalEnvelope>(
          conversation,
          chatId,
          designId,
          actionId,
          execCtx.limits,
        );
        if (dedup) return dedup;
      }
      // Need the projection to wire pins and to pick a non-overlapping start
      // for parts that omit positionNm (the common case — placement is then
      // auto-arranged from connectivity by the appended arrange op).
      const needsProjection =
        (input.wires?.length ?? 0) > 0 ||
        (input.parts ?? []).some((part) => !part.positionNm);
      const schematic = needsProjection
        ? await designer.getSchematicProjection(designId)
        : null;
      if (input.wires?.length && !schematic) {
        return failedTool(
          `Schematic projection not found: ${designId}`,
          execCtx.limits,
        );
      }
      const index = schematic ? buildProjectionIndex(schematic) : null;
      const placementStart = schematic
        ? resolvePlacementStart(schematic)
        : { x: 0, y: 0 };
      const autoPlaceCount = (input.parts ?? [])
        .slice(0, 20)
        .filter((part) => !part.positionNm).length;
      const autoPlaceCols = Math.max(
        1,
        Math.min(8, Math.ceil(Math.sqrt(Math.max(1, autoPlaceCount)))),
      );
      let autoPlaceIndex = 0;

      const proposalId = crypto.randomUUID();
      const sources: AiSourceRef[] = [
        {
          id: `design_${designId}`,
          kind: "design",
          refId: designId,
          label: designRecord.head.name,
        },
      ];
      const warnings: string[] = [...idempotencyWarnings];
      const operations: SchematicProposalEnvelope["operations"] = [];
      if ((input.parts?.length ?? 0) > 20)
        warnings.push("Only the first 20 part operation(s) were included.");
      if ((input.labels?.length ?? 0) > 20)
        warnings.push("Only the first 20 label operation(s) were included.");
      if ((input.powerPorts?.length ?? 0) > 20)
        warnings.push(
          "Only the first 20 power/portal operation(s) were included.",
        );
      if ((input.wires?.length ?? 0) > 20)
        warnings.push("Only the first 20 wire operation(s) were included.");

      for (const part of (input.parts ?? []).slice(0, 20)) {
        const detail = await designer.resolveLibraryComponentForPlacement(
          part.componentId,
        );
        if (!detail) {
          warnings.push(
            `${part.componentId}: Installed library component not found.`,
          );
          continue;
        }
        // Use the model's coordinates only if given; otherwise drop the part on
        // a temporary non-overlapping grid (the arrange pass relays it anyway).
        let positionNm: { x: number; y: number };
        if (part.positionNm) {
          positionNm = snapPoint(part.positionNm);
        } else {
          positionNm = {
            x: snapNm(
              placementStart.x +
                (autoPlaceIndex % autoPlaceCols) * DEFAULT_GRID_SPACING_X_NM,
            ),
            y: snapNm(
              placementStart.y +
                Math.floor(autoPlaceIndex / autoPlaceCols) *
                  DEFAULT_GRID_SPACING_Y_NM,
            ),
          };
          autoPlaceIndex += 1;
        }
        const placeCommand: DesignerCommandEnvelope["command"] = {
          type: "place_part",
          componentId: part.componentId,
          positionNm,
          rotationDeg: part.rotationDeg ?? 0,
          mirrored: part.mirrored === true,
        };
        operations.push({
          id: `${proposalId}:place:${operations.length}`,
          kind: "designer.place_part",
          title: `Place ${detail.component.name}`,
          summary: `Place ${detail.component.name} at ${placeCommand.positionNm.x}, ${placeCommand.positionNm.y} nm.`,
          riskLevel: "medium",
          payload: placeCommand,
          updatePartAfterCreate:
            part.value !== undefined || part.properties !== undefined
              ? {
                  ...(part.value !== undefined ? { value: part.value } : {}),
                  ...(part.properties !== undefined
                    ? { propertiesJson: part.properties }
                    : {}),
                }
              : undefined,
          sources: [
            {
              id: `library_component_${part.componentId}`,
              kind: "library-component",
              refId: part.componentId,
              label: detail.component.name,
            },
          ],
          warnings: [],
        });
        sources.push({
          id: `library_component_${part.componentId}`,
          kind: "library-component",
          refId: part.componentId,
          label: detail.component.name,
        });
      }

      for (const label of (input.labels ?? []).slice(0, 20)) {
        const text = typeof label.text === "string" ? label.text.trim() : "";
        if (!text) {
          warnings.push("Skipped label: text must not be empty.");
          continue;
        }
        const command: DesignerCommandEnvelope["command"] = {
          type: "upsert_label",
          text,
          positionNm: snapPoint(label.positionNm),
        };
        operations.push({
          id: `${proposalId}:label:${operations.length}`,
          kind: "designer.upsert_label",
          title: `Add label ${text}`,
          summary: `Add net label ${text}.`,
          riskLevel: "medium",
          payload: command,
          sources: [],
          warnings: [],
        });
      }

      for (const port of (input.powerPorts ?? []).slice(0, 20)) {
        const positionNm = snapPoint(port.positionNm);
        const rotationDeg = port.rotationDeg ?? 0;
        if (
          port.kind !== "gnd" &&
          port.kind !== "pwr" &&
          port.kind !== "net_portal"
        ) {
          warnings.push(
            `Skipped power/portal: unsupported kind ${String(port.kind)}.`,
          );
          continue;
        }
        const command: DesignerCommandEnvelope["command"] =
          port.kind === "gnd"
            ? { type: "place_gnd_port", positionNm, rotationDeg }
            : port.kind === "pwr"
              ? {
                  type: "place_pwr_port",
                  positionNm,
                  rotationDeg,
                  railText: port.text?.trim() || "VCC",
                }
              : {
                  type: "place_net_portal",
                  positionNm,
                  rotationDeg,
                  portalText: port.text?.trim() || "NET",
                };
        operations.push({
          id: `${proposalId}:port:${operations.length}`,
          kind: `designer.${command.type}`,
          title: `Add ${port.kind} port`,
          summary: `Add ${port.kind} port${port.text ? ` ${port.text}` : ""}.`,
          riskLevel: "medium",
          payload: command,
          sources: [],
          warnings: [],
        });
      }

      for (const wire of (input.wires ?? []).slice(0, 20)) {
        if (!schematic || !index) {
          warnings.push("Skipped wire: schematic projection unavailable.");
          continue;
        }
        const src = resolveWireEndpoint(schematic, wire.source, index);
        if (!src.ok) {
          warnings.push(`Skipped wire: ${src.error}`);
          continue;
        }
        const tgt = resolveWireEndpoint(schematic, wire.target, index);
        if (!tgt.ok) {
          warnings.push(`Skipped wire: ${tgt.error}`);
          continue;
        }
        if (src.kind === "net" && tgt.kind === "net") {
          warnings.push(
            `Skipped wire: cannot connect two nets ("${src.net}" and "${tgt.net}").`,
          );
          continue;
        }
        if (src.kind === "net" || tgt.kind === "net") {
          const pinId =
            src.kind === "pin"
              ? src.pinId
              : tgt.kind === "pin"
                ? tgt.pinId
                : null;
          const netName =
            src.kind === "net" ? src.net : tgt.kind === "net" ? tgt.net : null;
          if (!pinId || !netName) {
            warnings.push(
              "Skipped net connect: need exactly one pin and one net.",
            );
            continue;
          }
          const plan = planNetConnect(schematic, pinId, netName, index);
          if (!plan.ok) {
            warnings.push(`Skipped net connect: ${plan.error}`);
            continue;
          }
          operations.push({
            id: `${proposalId}:net:${operations.length}`,
            kind: `designer.${plan.plan.primitiveCommand.type}`,
            title: `Connect ${netName}`,
            summary: wire.reason ?? `Connect ${pinId} to net ${netName}.`,
            riskLevel: "high",
            payload: plan.plan.primitiveCommand,
            linkWireToCreatedPrimitive: { sourcePinId: plan.plan.sourcePinId },
            sources: [],
            warnings: [],
          });
          continue;
        }
        operations.push({
          id: `${proposalId}:wire:${operations.length}`,
          kind: "designer.create_wire",
          title: "Create wire",
          summary: wire.reason ?? `Wire ${src.pinId} to ${tgt.pinId}.`,
          riskLevel: "high",
          payload: {
            type: "create_wire",
            sourcePinId: src.pinId,
            targetPinId: tgt.pinId,
          },
          sources: [],
          warnings: [],
        });
      }

      // Append a deterministic arrange pass ONLY when this proposal adds
      // connectivity (wires or power/ground/portal flags). Arrange groups
      // net-connected parts and re-routes wires — but with NO connectivity it
      // would scatter every part into its own singleton block and flatten a
      // clean placement grid into one long row. So bare placement is left as
      // placed; arrange kicks in once there are nets to lay out around.
      const addedConnectivity = operations.some(
        (op) =>
          op.kind === "designer.create_wire" ||
          op.kind === "designer.place_gnd_port" ||
          op.kind === "designer.place_pwr_port" ||
          op.kind === "designer.place_net_portal",
      );
      if (addedConnectivity) {
        operations.push({
          id: `${proposalId}:arrange:${operations.length}`,
          kind: "designer.auto_arrange_schematic",
          title: "Auto-arrange schematic",
          summary:
            "Group connected parts and re-route wires for a clean layout.",
          riskLevel: "medium",
          payload: { type: "auto_arrange_schematic" },
          sources: [],
          warnings: [],
        });
      }

      if (operations.length === 0) {
        return {
          ok: false,
          data: null,
          sources,
          warnings:
            warnings.length > 0
              ? [...warnings, "No valid schematic operations were proposed."]
              : ["No valid schematic operations were proposed."],
          truncated: warnings.some((warning) =>
            warning.startsWith("Only the first"),
          ),
          limits: execCtx.limits,
        };
      }

      await contextResolver.maybeAutoBindDesign(chatId, designId);

      const envelope: SchematicProposalEnvelope = {
        id: proposalId,
        kind: "designer_schematic_edits",
        toolName: "designer_propose_schematic_edits",
        ...(actionId ? { actionId } : {}),
        title: input.title.trim() || "Schematic edit proposal",
        summary:
          input.summary.trim() ||
          `Propose ${operations.length} schematic operation(s).`,
        riskLevel: operations.some(
          (operation) => operation.riskLevel === "high",
        )
          ? "high"
          : "medium",
        designId,
        baseRevision: designRecord.head.revision,
        operations,
        payload: input,
        sources,
        warnings,
      };
      return finalizeAndMaybeApply({
        designer,
        conversation,
        chatId,
        designId,
        baseRevision: designRecord.head.revision,
        envelope,
        warnings,
        sources,
        limits: execCtx.limits,
        options,
      });
    },
  };
}

// ─── designer_arrange_schematic ────────────────────────────────────────

interface DesignerArrangeSchematicInput {
  designId?: string;
  action_id?: string;
}

export function makeDesignerArrangeSchematicTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions = {},
): AiTool<DesignerArrangeSchematicInput, SchematicProposalEnvelope | null> {
  return {
    definition: {
      name: "designer_arrange_schematic",
      version: "1",
      effect: "write",
      capability: "designer.write.schematic.arrange",
      description:
        "Tidy the whole schematic: deterministically group net-connected parts with routing channels, slide power/ground flags with their pins, and re-route every wire around bodies, flags and other wires. Non-destructive, auto-applies, single undo step. Use when the layout looks messy or overlapping.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          action_id: { type: "string", description: ACTION_ID_DESC },
        },
      },
    },
    async execute(execCtx, input) {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer)
        return failedTool("Designer module not available.", execCtx.limits);
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({
        chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok)
        return failedTool(resolvedDesign.warning, execCtx.limits);
      const designId = resolvedDesign.designId;
      const designRecord = await designer.getDesign(designId);
      if (!designRecord)
        return failedTool(`Design not found: ${designId}`, execCtx.limits);
      const idempotencyWarnings: string[] = [];
      const actionId = normalizeActionId(input.action_id, idempotencyWarnings);
      if (actionId) {
        const dedup = dedupByActionId<SchematicProposalEnvelope>(
          conversation,
          chatId,
          designId,
          actionId,
          execCtx.limits,
        );
        if (dedup) return dedup;
      }

      const proposalId = crypto.randomUUID();
      const sources: AiSourceRef[] = [
        {
          id: `design_${designId}`,
          kind: "design",
          refId: designId,
          label: designRecord.head.name,
        },
      ];
      const envelope: SchematicProposalEnvelope = {
        id: proposalId,
        kind: "designer_schematic_edits",
        toolName: "designer_arrange_schematic",
        ...(actionId ? { actionId } : {}),
        title: "Arrange schematic",
        summary: "Re-group parts and re-route wires for a clean layout.",
        riskLevel: "medium",
        designId,
        baseRevision: designRecord.head.revision,
        operations: [
          {
            id: `${proposalId}:arrange:0`,
            kind: "designer.auto_arrange_schematic",
            title: "Auto-arrange schematic",
            summary:
              "Group connected parts and re-route wires for a clean layout.",
            riskLevel: "medium",
            payload: { type: "auto_arrange_schematic" },
            sources: [],
            warnings: [],
          },
        ],
        payload: input,
        sources,
        warnings: idempotencyWarnings,
      };
      await contextResolver.maybeAutoBindDesign(chatId, designId);
      return finalizeAndMaybeApply({
        designer,
        conversation,
        chatId,
        designId,
        baseRevision: designRecord.head.revision,
        envelope,
        warnings: idempotencyWarnings,
        sources,
        limits: execCtx.limits,
        options,
      });
    },
  };
}

// ─── designer_propose_schematic_wires ──────────────────────────────────

interface DesignerProposeSchematicWiresInput {
  designId?: string;
  action_id?: string;
  title: string;
  summary: string;
  wires?: Array<{
    source: WireEndpoint;
    target: WireEndpoint;
    netName?: string;
    reason?: string;
  }>;
  junctions?: Array<{
    source: PinTarget;
    wireId: string;
    targetPointNm: { x: number; y: number };
    reason?: string;
  }>;
}

export function makeDesignerProposeSchematicWiresTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions = {},
): AiTool<
  DesignerProposeSchematicWiresInput,
  SchematicProposalEnvelope | null
> {
  return {
    definition: {
      name: "designer_propose_schematic_wires",
      version: "1",
      effect: "write",
      capability: "designer.write.schematic.propose_wires",
      description:
        'Wire schematic pins together, or connect a pin to a named net. Address pins by "REF.PIN" (e.g. "U1.VCC", "R1.2") — call designer_get_schematic_connectivity first to learn references and pin names. Do NOT pass coordinates: routing is automatic and obstacle-aware. After wiring, the whole sheet is auto-arranged — components are MOVED to group what is now connected and wires re-routed cleanly. Non-destructive, so it auto-applies.',
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          action_id: { type: "string", description: ACTION_ID_DESC },
          title: { type: "string" },
          summary: { type: "string" },
          wires: {
            type: "array",
            description:
              "Connections to make. Each joins a source to a target; geometry is auto-routed.",
            items: {
              type: "object",
              properties: {
                source: ENDPOINT_SCHEMA,
                target: ENDPOINT_SCHEMA,
                netName: {
                  type: "string",
                  description: "Optional display label for the resulting net.",
                },
                reason: { type: "string" },
              },
              required: ["source", "target"],
            },
          },
          junctions: {
            type: "array",
            description:
              "Tap a pin onto an existing wire at an exact on-wire point (creates a junction).",
            items: {
              type: "object",
              properties: {
                source: PIN_TARGET_SCHEMA,
                wireId: {
                  type: "string",
                  description:
                    "ID of the existing wire to tap (from connectivity).",
                },
                targetPointNm: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  required: ["x", "y"],
                  description: "A point lying on the target wire (nanometers).",
                },
                reason: { type: "string" },
              },
              required: ["source", "wireId", "targetPointNm"],
            },
          },
        },
        required: ["title", "summary"],
      },
    },
    async execute(execCtx, input) {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer)
        return failedTool("Designer module not available.", execCtx.limits);
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({
        chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok)
        return failedTool(resolvedDesign.warning, execCtx.limits);
      const designId = resolvedDesign.designId;
      const designRecord = await designer.getDesign(designId);
      if (!designRecord)
        return failedTool(`Design not found: ${designId}`, execCtx.limits);
      const schematic = await designer.getSchematicProjection(designId);
      if (!schematic)
        return failedTool(
          `Schematic projection not found: ${designId}`,
          execCtx.limits,
        );

      const idempotencyWarnings: string[] = [];
      const actionId = normalizeActionId(input.action_id, idempotencyWarnings);
      if (actionId) {
        const dedup = dedupByActionId<SchematicProposalEnvelope>(
          conversation,
          chatId,
          designId,
          actionId,
          execCtx.limits,
        );
        if (dedup) return dedup;
      }
      const proposalId = crypto.randomUUID();
      const warnings: string[] = [...idempotencyWarnings];
      const operations: SchematicProposalEnvelope["operations"] = [];
      if ((input.wires?.length ?? 0) > 40)
        warnings.push("Only the first 40 wire operation(s) were included.");
      if ((input.junctions?.length ?? 0) > 40)
        warnings.push("Only the first 40 junction operation(s) were included.");
      const index = buildProjectionIndex(schematic);
      const wireById = new Map(schematic.wires.map((wire) => [wire.id, wire]));
      const sources: AiSourceRef[] = [
        {
          id: `design_${designId}`,
          kind: "design",
          refId: designId,
          label: designRecord.head.name,
        },
        {
          id: `schematic_${designId}`,
          kind: "schematic",
          refId: designId,
          label: `${designRecord.head.name} schematic`,
        },
      ];

      for (const wire of (input.wires ?? []).slice(0, 40)) {
        const src = resolveWireEndpoint(schematic, wire.source, index);
        if (!src.ok) {
          warnings.push(
            `Skipped wire: ${src.error}${src.candidates ? ` Candidates: ${src.candidates.join(", ")}` : ""}`,
          );
          continue;
        }
        const tgt = resolveWireEndpoint(schematic, wire.target, index);
        if (!tgt.ok) {
          warnings.push(
            `Skipped wire: ${tgt.error}${tgt.candidates ? ` Candidates: ${tgt.candidates.join(", ")}` : ""}`,
          );
          continue;
        }
        if (src.kind === "net" && tgt.kind === "net") {
          warnings.push(
            `Skipped wire: cannot connect two nets ("${src.net}" and "${tgt.net}") without a pin.`,
          );
          continue;
        }
        if (src.kind === "net" || tgt.kind === "net") {
          const pinId =
            src.kind === "pin"
              ? src.pinId
              : tgt.kind === "pin"
                ? tgt.pinId
                : null;
          const netName =
            src.kind === "net" ? src.net : tgt.kind === "net" ? tgt.net : null;
          if (!pinId || !netName) {
            warnings.push(
              "Skipped net connect: need exactly one pin and one net.",
            );
            continue;
          }
          const plan = planNetConnect(schematic, pinId, netName, index);
          if (!plan.ok) {
            warnings.push(`Skipped net connect: ${plan.error}`);
            continue;
          }
          operations.push({
            id: `${proposalId}:net:${operations.length}`,
            kind: `designer.${plan.plan.primitiveCommand.type}`,
            title: `Connect ${netName}`,
            summary: wire.reason ?? `Connect ${pinId} to net ${netName}.`,
            riskLevel: "high",
            payload: plan.plan.primitiveCommand,
            linkWireToCreatedPrimitive: { sourcePinId: plan.plan.sourcePinId },
            sources,
            warnings: [],
          });
          continue;
        }
        operations.push({
          id: `${proposalId}:wire:${operations.length}`,
          kind: "designer.create_wire",
          title: wire.netName ? `Wire ${wire.netName}` : "Create wire",
          summary: wire.reason ?? `Wire ${src.pinId} to ${tgt.pinId}.`,
          riskLevel: "high",
          payload: {
            type: "create_wire",
            sourcePinId: src.pinId,
            targetPinId: tgt.pinId,
          },
          sources,
          warnings: [],
        });
      }

      for (const junction of (input.junctions ?? []).slice(0, 40)) {
        const src = resolvePinTarget(schematic, junction.source, index);
        if (!src.ok) {
          warnings.push(
            `Skipped junction: ${src.error}${src.candidates ? ` Candidates: ${src.candidates.join(", ")}` : ""}`,
          );
          continue;
        }
        const existingWire = wireById.get(junction.wireId);
        if (!existingWire) {
          warnings.push(
            `Skipped junction: wire ${junction.wireId} does not exist.`,
          );
          continue;
        }
        if (!pointOnWire(junction.targetPointNm, existingWire)) {
          warnings.push(
            `Skipped junction: target point is not on wire ${junction.wireId}.`,
          );
          continue;
        }
        operations.push({
          id: `${proposalId}:junction:${operations.length}`,
          kind: "designer.create_wire_junction",
          title: "Create junction wire",
          summary:
            junction.reason ?? `Tap ${src.pinId} onto wire ${junction.wireId}.`,
          riskLevel: "high",
          payload: {
            type: "create_wire_junction",
            sourcePinId: src.pinId,
            wireId: junction.wireId,
            targetPointNm: junction.targetPointNm,
          },
          sources,
          warnings: [],
        });
      }

      // Wiring changes connectivity, so re-arrange the whole sheet afterward:
      // the layout engine MOVES components to group what's now connected and
      // re-routes every wire cleanly. Runs last, seeing all the new wires.
      if (operations.length > 0) {
        operations.push({
          id: `${proposalId}:arrange:${operations.length}`,
          kind: "designer.auto_arrange_schematic",
          title: "Auto-arrange schematic",
          summary: "Move connected parts together and re-route wires cleanly.",
          riskLevel: "medium",
          payload: { type: "auto_arrange_schematic" },
          sources: [],
          warnings: [],
        });
      }

      if (operations.length === 0) {
        return {
          ok: false,
          data: null,
          sources,
          warnings:
            warnings.length > 0
              ? [
                  ...warnings,
                  "No valid schematic wire operations were proposed.",
                ]
              : ["No valid schematic wire operations were proposed."],
          truncated: warnings.some((warning) =>
            warning.startsWith("Only the first"),
          ),
          limits: execCtx.limits,
        };
      }

      await contextResolver.maybeAutoBindDesign(chatId, designId);

      const envelope: SchematicProposalEnvelope = {
        id: proposalId,
        kind: "designer_schematic_wires",
        toolName: "designer_propose_schematic_wires",
        ...(actionId ? { actionId } : {}),
        title: input.title.trim() || "Schematic wiring proposal",
        summary:
          input.summary.trim() ||
          `Propose ${operations.length} schematic wire operation(s).`,
        riskLevel: "high",
        designId,
        baseRevision: designRecord.head.revision,
        operations,
        payload: input,
        sources,
        warnings,
      };
      return finalizeAndMaybeApply({
        designer,
        conversation,
        chatId,
        designId,
        baseRevision: designRecord.head.revision,
        envelope,
        warnings,
        sources,
        limits: execCtx.limits,
        options,
      });
    },
  };
}

// ─── designer_propose_schematic_updates ────────────────────────────────

interface DesignerProposeSchematicUpdatesInput {
  designId?: string;
  action_id?: string;
  title: string;
  summary: string;
  partUpdates?: Array<{
    /** Part to update, addressed by UUID (`partId`) or reference (`ref`, e.g. "U1"). */
    partId?: string;
    ref?: string;
    positionNm?: { x: number; y: number };
    rotationDeg?: 0 | 90 | 180 | 270;
    mirrored?: boolean;
    reference?: string;
    value?: string;
    properties?: Record<string, string>;
    reason?: string;
  }>;
  labelUpdates?: Array<{
    labelId: string;
    text?: string;
    positionNm?: { x: number; y: number };
    reason?: string;
  }>;
  primitiveUpdates?: Array<{
    primitiveId: string;
    positionNm?: { x: number; y: number };
    rotationDeg?: 0 | 90 | 180 | 270;
    text?: string;
    reason?: string;
  }>;
}

export function makeDesignerProposeSchematicUpdatesTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions = {},
): AiTool<
  DesignerProposeSchematicUpdatesInput,
  SchematicProposalEnvelope | null
> {
  return {
    definition: {
      name: "designer_propose_schematic_updates",
      version: "1",
      effect: "write",
      capability: "designer.write.schematic.propose_updates",
      description:
        'Move/rotate/mirror schematic parts, edit part value/reference/properties, move/rename labels, or move/rotate/retext power & net-portal primitives. Address parts by "partId" or reference "ref" (e.g. "U1"). Connected wires reflow automatically on move/rotate/mirror. Non-destructive, so it auto-applies.',
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          action_id: { type: "string", description: ACTION_ID_DESC },
          title: { type: "string" },
          summary: { type: "string" },
          partUpdates: {
            type: "array",
            description:
              "Changes to existing parts. Each entry needs partId or ref.",
            items: {
              type: "object",
              properties: {
                partId: {
                  type: "string",
                  description: "Part UUID (from connectivity).",
                },
                ref: {
                  type: "string",
                  description:
                    'Reference designator, e.g. "U1". Alternative to partId.',
                },
                positionNm: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  required: ["x", "y"],
                  description:
                    "New position (nanometers). Connected wires reflow automatically.",
                },
                rotationDeg: { type: "integer", enum: [0, 90, 180, 270] },
                mirrored: { type: "boolean" },
                reference: {
                  type: "string",
                  description: "New reference designator.",
                },
                value: { type: "string" },
                properties: {
                  type: "object",
                  additionalProperties: { type: "string" },
                },
                reason: { type: "string" },
              },
            },
          },
          labelUpdates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                labelId: { type: "string" },
                text: { type: "string" },
                positionNm: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  required: ["x", "y"],
                },
                reason: { type: "string" },
              },
              required: ["labelId"],
            },
          },
          primitiveUpdates: {
            type: "array",
            description: "Changes to gnd/pwr/net-portal primitives.",
            items: {
              type: "object",
              properties: {
                primitiveId: { type: "string" },
                positionNm: {
                  type: "object",
                  properties: { x: { type: "number" }, y: { type: "number" } },
                  required: ["x", "y"],
                },
                rotationDeg: { type: "integer", enum: [0, 90, 180, 270] },
                text: {
                  type: "string",
                  description: "Rail/portal text (ignored for gnd).",
                },
                reason: { type: "string" },
              },
              required: ["primitiveId"],
            },
          },
        },
        required: ["title", "summary"],
      },
    },
    async execute(execCtx, input) {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer)
        return failedTool("Designer module not available.", execCtx.limits);
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({
        chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok)
        return failedTool(resolvedDesign.warning, execCtx.limits);
      const designId = resolvedDesign.designId;
      const designRecord = await designer.getDesign(designId);
      if (!designRecord)
        return failedTool(`Design not found: ${designId}`, execCtx.limits);
      const schematic = await designer.getSchematicProjection(designId);
      if (!schematic)
        return failedTool(
          `Schematic projection not found: ${designId}`,
          execCtx.limits,
        );

      const idempotencyWarnings: string[] = [];
      const actionId = normalizeActionId(input.action_id, idempotencyWarnings);
      if (actionId) {
        const dedup = dedupByActionId<SchematicProposalEnvelope>(
          conversation,
          chatId,
          designId,
          actionId,
          execCtx.limits,
        );
        if (dedup) return dedup;
      }
      const proposalId = crypto.randomUUID();
      const warnings: string[] = [...idempotencyWarnings];
      const operations: SchematicProposalEnvelope["operations"] = [];
      if ((input.partUpdates?.length ?? 0) > 40)
        warnings.push(
          "Only the first 40 part update operation(s) were included.",
        );
      if ((input.labelUpdates?.length ?? 0) > 40)
        warnings.push(
          "Only the first 40 label update operation(s) were included.",
        );
      if ((input.primitiveUpdates?.length ?? 0) > 40)
        warnings.push(
          "Only the first 40 primitive update operation(s) were included.",
        );
      const index = buildProjectionIndex(schematic);
      const partById = new Map(schematic.parts.map((part) => [part.id, part]));
      const labelById = new Map(
        schematic.labels.map((label) => [label.id, label]),
      );
      const primitiveById = new Map(
        schematic.primitives.map((primitive) => [primitive.id, primitive]),
      );
      const sources: AiSourceRef[] = [
        {
          id: `design_${designId}`,
          kind: "design",
          refId: designId,
          label: designRecord.head.name,
        },
      ];

      const pushOperation = (
        command: DesignerCommandEnvelope["command"],
        title: string,
        summary: string,
      ): void => {
        operations.push({
          id: `${proposalId}:update:${operations.length}`,
          kind: `designer.${command.type}`,
          title,
          summary,
          riskLevel: "medium",
          payload: command,
          sources,
          warnings: [],
        });
      };

      for (const update of (input.partUpdates ?? []).slice(0, 40)) {
        const target = update.partId ?? update.ref;
        if (!target) {
          warnings.push("Skipped part update: provide partId or ref.");
          continue;
        }
        const resolved = resolvePartTarget(schematic, target, index);
        if (!resolved.ok) {
          warnings.push(
            `Skipped part update: ${resolved.error}${resolved.candidates ? ` Candidates: ${resolved.candidates.join(", ")}` : ""}`,
          );
          continue;
        }
        const partId = resolved.partId;
        const part = partById.get(partId)!;
        if (update.positionNm) {
          pushOperation(
            {
              type: "move_part",
              partId,
              positionNm: snapPoint(update.positionNm),
            },
            `Move ${part.reference}`,
            update.reason ?? `Move ${part.reference}.`,
          );
        }
        if (update.rotationDeg !== undefined) {
          pushOperation(
            {
              type: "rotate_part",
              partId,
              rotationDeg: update.rotationDeg,
            },
            `Rotate ${part.reference}`,
            update.reason ??
              `Rotate ${part.reference} to ${update.rotationDeg}°.`,
          );
        }
        if (update.mirrored !== undefined) {
          pushOperation(
            {
              type: "mirror_part",
              partId,
              mirrored: update.mirrored,
            },
            `${update.mirrored ? "Mirror" : "Unmirror"} ${part.reference}`,
            update.reason ??
              `${update.mirrored ? "Mirror" : "Unmirror"} ${part.reference}.`,
          );
        }
        if (
          update.reference !== undefined ||
          update.value !== undefined ||
          update.properties !== undefined
        ) {
          pushOperation(
            {
              type: "update_part_properties",
              partId,
              ...(update.reference !== undefined
                ? { reference: update.reference }
                : {}),
              ...(update.value !== undefined ? { value: update.value } : {}),
              ...(update.properties !== undefined
                ? { propertiesJson: update.properties }
                : {}),
            },
            `Update ${part.reference}`,
            update.reason ?? `Update ${part.reference} properties.`,
          );
        }
      }

      for (const update of (input.labelUpdates ?? []).slice(0, 40)) {
        const label = labelById.get(update.labelId);
        if (!label) {
          warnings.push(
            `Skipped label update ${update.labelId}: label does not exist.`,
          );
          continue;
        }
        const text =
          update.text === undefined ? label.text : update.text.trim();
        if (!text) {
          warnings.push(
            `Skipped label update ${update.labelId}: text must not be empty.`,
          );
          continue;
        }
        pushOperation(
          {
            type: "upsert_label",
            labelId: update.labelId,
            text,
            positionNm: update.positionNm
              ? snapPoint(update.positionNm)
              : label.positionNm,
          },
          `Update label ${label.text}`,
          update.reason ?? `Update label ${label.text} to ${text}.`,
        );
      }

      for (const update of (input.primitiveUpdates ?? []).slice(0, 40)) {
        const primitive = primitiveById.get(update.primitiveId);
        if (!primitive) {
          warnings.push(
            `Skipped primitive update ${update.primitiveId}: primitive does not exist.`,
          );
          continue;
        }
        if (update.positionNm) {
          pushOperation(
            {
              type: "move_primitive",
              primitiveId: update.primitiveId,
              positionNm: snapPoint(update.positionNm),
            },
            `Move ${primitive.kind} port`,
            update.reason ?? `Move ${primitive.kind} port.`,
          );
        }
        if (update.rotationDeg !== undefined) {
          pushOperation(
            {
              type: "rotate_primitive",
              primitiveId: update.primitiveId,
              rotationDeg: update.rotationDeg,
            },
            `Rotate ${primitive.kind} port`,
            update.reason ??
              `Rotate ${primitive.kind} port to ${update.rotationDeg}°.`,
          );
        }
        if (update.text !== undefined) {
          const text = update.text.trim();
          if (primitive.kind === "gnd") {
            warnings.push(
              `Skipped primitive text update ${update.primitiveId}: GND text is fixed.`,
            );
          } else if (!text) {
            warnings.push(
              `Skipped primitive text update ${update.primitiveId}: text must not be empty.`,
            );
          } else {
            pushOperation(
              {
                type: "update_primitive_text",
                primitiveId: update.primitiveId,
                text,
              },
              `Update ${primitive.kind} text`,
              update.reason ?? `Update ${primitive.kind} text to ${text}.`,
            );
          }
        }
      }

      if (operations.length === 0) {
        return {
          ok: false,
          data: null,
          sources,
          warnings:
            warnings.length > 0
              ? [
                  ...warnings,
                  "No valid schematic update operations were proposed.",
                ]
              : ["No valid schematic update operations were proposed."],
          truncated: warnings.some((warning) =>
            warning.startsWith("Only the first"),
          ),
          limits: execCtx.limits,
        };
      }

      await contextResolver.maybeAutoBindDesign(chatId, designId);

      const envelope: SchematicProposalEnvelope = {
        id: proposalId,
        kind: "designer_schematic_updates",
        toolName: "designer_propose_schematic_updates",
        ...(actionId ? { actionId } : {}),
        title: input.title.trim() || "Schematic update proposal",
        summary:
          input.summary.trim() ||
          `Propose ${operations.length} schematic update operation(s).`,
        riskLevel: "medium",
        designId,
        baseRevision: designRecord.head.revision,
        operations,
        payload: input,
        sources,
        warnings,
      };
      return finalizeAndMaybeApply({
        designer,
        conversation,
        chatId,
        designId,
        baseRevision: designRecord.head.revision,
        envelope,
        warnings,
        sources,
        limits: execCtx.limits,
        options,
      });
    },
  };
}

// ─── designer_propose_schematic_deletions ──────────────────────────────

interface DesignerProposeSchematicDeletionsInput {
  designId?: string;
  action_id?: string;
  title: string;
  summary: string;
  entities: Array<{
    entityId: string;
    entityKind: "part" | "wire" | "label" | "primitive";
    reason?: string;
  }>;
}

export function makeDesignerProposeSchematicDeletionsTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions = {},
): AiTool<
  DesignerProposeSchematicDeletionsInput,
  SchematicProposalEnvelope | null
> {
  return {
    definition: {
      name: "designer_propose_schematic_deletions",
      version: "1",
      effect: "write",
      capability: "designer.write.schematic.propose_deletions",
      description:
        'Delete existing schematic parts, wires, labels, or primitives. Destructive: stays pending for explicit user confirmation (does NOT auto-apply). Parts may be addressed by reference (e.g. "U1") or ID; wires/labels/primitives by ID.',
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          action_id: { type: "string", description: ACTION_ID_DESC },
          title: { type: "string" },
          summary: { type: "string" },
          entities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                entityId: {
                  type: "string",
                  description:
                    'Entity ID; for parts a reference like "U1" is also accepted.',
                },
                entityKind: {
                  type: "string",
                  enum: ["part", "wire", "label", "primitive"],
                },
                reason: { type: "string" },
              },
              required: ["entityId", "entityKind"],
            },
          },
        },
        required: ["title", "summary", "entities"],
      },
    },
    async execute(execCtx, input) {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer)
        return failedTool("Designer module not available.", execCtx.limits);
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({
        chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok)
        return failedTool(resolvedDesign.warning, execCtx.limits);
      const designId = resolvedDesign.designId;
      const designRecord = await designer.getDesign(designId);
      if (!designRecord)
        return failedTool(`Design not found: ${designId}`, execCtx.limits);
      const schematic = await designer.getSchematicProjection(designId);
      if (!schematic)
        return failedTool(
          `Schematic projection not found: ${designId}`,
          execCtx.limits,
        );

      const index = buildProjectionIndex(schematic);
      const exists = new Set([
        ...schematic.parts.map((entity) => `part:${entity.id}`),
        ...schematic.wires.map((entity) => `wire:${entity.id}`),
        ...schematic.labels.map((entity) => `label:${entity.id}`),
        ...schematic.primitives.map((entity) => `primitive:${entity.id}`),
      ]);
      const proposalId = crypto.randomUUID();
      const sources: AiSourceRef[] = [
        {
          id: `design_${designId}`,
          kind: "design",
          refId: designId,
          label: designRecord.head.name,
        },
      ];
      const idempotencyWarnings: string[] = [];
      const actionId = normalizeActionId(input.action_id, idempotencyWarnings);
      if (actionId) {
        const dedup = dedupByActionId<SchematicProposalEnvelope>(
          conversation,
          chatId,
          designId,
          actionId,
          execCtx.limits,
        );
        if (dedup) return dedup;
      }
      const warnings: string[] = [...idempotencyWarnings];
      const operations: SchematicProposalEnvelope["operations"] = [];
      if ((input.entities?.length ?? 0) > 40)
        warnings.push("Only the first 40 delete operation(s) were included.");
      for (const entity of (input.entities ?? []).slice(0, 40)) {
        // Parts may be addressed by reference; resolve to the real ID.
        let entityId = entity.entityId;
        if (entity.entityKind === "part") {
          const resolved = resolvePartTarget(schematic, entity.entityId, index);
          if (!resolved.ok) {
            warnings.push(
              `Skipped delete part ${entity.entityId}: ${resolved.error}`,
            );
            continue;
          }
          entityId = resolved.partId;
        }
        const key = `${entity.entityKind}:${entityId}`;
        if (!exists.has(key)) {
          warnings.push(`Skipped delete ${key}: entity does not exist.`);
          continue;
        }
        operations.push({
          id: `${proposalId}:delete:${operations.length}`,
          kind: "designer.delete_entity",
          title: `Delete ${entity.entityKind}`,
          summary: entity.reason ?? `Delete ${entity.entityKind} ${entityId}.`,
          riskLevel: "destructive",
          payload: {
            type: "delete_entity",
            entityId,
            entityKind: entity.entityKind,
          },
          sources,
          warnings: [],
        });
      }
      if (operations.length === 0) {
        return {
          ok: false,
          data: null,
          sources,
          warnings:
            warnings.length > 0
              ? [
                  ...warnings,
                  "No valid schematic delete operations were proposed.",
                ]
              : ["No valid schematic delete operations were proposed."],
          truncated: warnings.some((warning) =>
            warning.startsWith("Only the first"),
          ),
          limits: execCtx.limits,
        };
      }

      await contextResolver.maybeAutoBindDesign(chatId, designId);
      const envelope: SchematicProposalEnvelope = {
        id: proposalId,
        kind: "designer_schematic_deletions",
        toolName: "designer_propose_schematic_deletions",
        ...(actionId ? { actionId } : {}),
        title: input.title.trim() || "Schematic deletion proposal",
        summary:
          input.summary.trim() ||
          `Delete ${operations.length} schematic entity/entities.`,
        riskLevel: "destructive",
        designId,
        baseRevision: designRecord.head.revision,
        operations,
        payload: input,
        sources,
        warnings,
      };
      return finalizeAndMaybeApply({
        designer,
        conversation,
        chatId,
        designId,
        baseRevision: designRecord.head.revision,
        envelope,
        warnings,
        sources,
        limits: execCtx.limits,
        options,
      });
    },
  };
}

function snapPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: snapNm(point.x), y: snapNm(point.y) };
}

/** JSON Schema fragment for a wire endpoint (pin or named net). */
const ENDPOINT_SCHEMA = {
  description:
    'Pin or net. A pin: "U1.VCC" / "U1.1", or { ref, pin }, or { pinId }. A net: { net: "GND" } (auto-places a power/ground/net-portal primitive and wires to it).',
  oneOf: [
    { type: "string" },
    {
      type: "object",
      properties: { ref: { type: "string" }, pin: { type: "string" } },
      required: ["ref", "pin"],
    },
    {
      type: "object",
      properties: { pinId: { type: "string" } },
      required: ["pinId"],
    },
    {
      type: "object",
      properties: { net: { type: "string" } },
      required: ["net"],
    },
  ],
} as const;

/** JSON Schema fragment for a pin-only target. */
const PIN_TARGET_SCHEMA = {
  description: 'A pin: "U1.VCC" / "U1.1", or { ref, pin }, or { pinId }.',
  oneOf: [
    { type: "string" },
    {
      type: "object",
      properties: { ref: { type: "string" }, pin: { type: "string" } },
      required: ["ref", "pin"],
    },
    {
      type: "object",
      properties: { pinId: { type: "string" } },
      required: ["pinId"],
    },
  ],
} as const;

/**
 * Persist a schematic proposal and (for non-destructive proposals with no
 * warnings) auto-apply it immediately so AI edits land like direct actions
 * (revertible via designer undo). Destructive proposals stay pending unless a
 * session policy opts them in. Centralizes the create+apply boilerplate shared
 * by all four schematic-write tools.
 */
async function finalizeAndMaybeApply(params: {
  designer: DesignerSDK;
  conversation: ConversationStore;
  chatId: string;
  designId: string;
  baseRevision: number;
  envelope: SchematicProposalEnvelope;
  warnings: string[];
  sources: AiSourceRef[];
  limits: AiToolResult["limits"];
  options: DesignerToolOptions;
}): Promise<AiToolResult<SchematicProposalEnvelope | null>> {
  const {
    designer,
    conversation,
    chatId,
    designId,
    baseRevision,
    envelope,
    warnings,
    sources,
    limits,
    options,
  } = params;
  conversation.createWriteProposal({
    id: envelope.id,
    chatId,
    kind: envelope.kind,
    designId,
    baseRevision,
    proposal: envelope,
    envelope,
  });
  // Auto-apply is decided by the session policy callback. Production wiring
  // (assistant-service) allows non-destructive schematic proposals by default
  // and gates destructive ones behind an explicit allowance.
  //
  // Per-item skips (an unresolvable wire/part) must NOT block the rest: a
  // non-destructive proposal auto-applies its valid ops via allowPartial. But a
  // TRUNCATED proposal (">40 included") stays pending so the model/user resends
  // the dropped tail rather than silently committing a partial circuit, and a
  // destructive proposal with any warning stays pending (explicit confirm).
  const isDestructive = envelope.riskLevel === "destructive";
  const truncated = warnings.some((w) => w.startsWith("Only the first"));
  const autoApply =
    envelope.operations.length > 0 &&
    !truncated &&
    (!isDestructive || warnings.length === 0) &&
    options.isSessionAutoApplyAllowed?.({
      chatId,
      toolName: envelope.toolName,
      proposalKind: envelope.kind,
      riskLevel: envelope.riskLevel,
    }) === true;
  const finalWarnings = [...warnings];
  // Build-time skips/truncation reported to the model even when nothing applies.
  const buildSkipped: WriteToolModelData["skipped"] = warnings.map((w) => ({
    id: "build",
    reason: w,
  }));
  let toolOk = true;
  let toolStatus: "ok" | "partial" = "ok";
  let modelData: WriteToolModelData = {
    appliedCount: 0,
    skipped: buildSkipped,
    status: buildSkipped.length > 0 ? "partial" : "pending",
  };
  let summary = `Staged ${envelope.operations.length} operation(s) on ${envelope.title}.`;
  if (autoApply) {
    // applySchematicProposalOperations can throw (e.g. revision race). Never let
    // that crash the tool call: record the proposal as failed and surface it.
    try {
      const applyResult = await applySchematicProposalOperations({
        designer,
        designId,
        baseRevision,
        envelope,
        allowPartial: !isDestructive,
      });
      conversation.updateWriteProposalStatus(
        chatId,
        envelope.id,
        writeProposalTerminalStatus(applyResult),
        applyResult,
      );
      // Surface BOTH outright failures AND F5a partial ops (primary landed but
      // follow-up wiring failed — recorded as applied + error) so the model
      // actually sees the deficiency instead of a misleading clean count.
      const failedSkips: WriteToolModelData["skipped"] = applyResult.operations
        .filter(
          (op) =>
            op.status === "failed" ||
            (op.status === "applied" && op.error != null),
        )
        .map((op) => ({ id: op.operationId, reason: op.error ?? "failed" }));
      const skipped = [...buildSkipped, ...failedSkips];
      // A failed/partial apply must surface ok:false/partial — never ok:true.
      if (applyResult.status === "applied") {
        toolOk = true;
        toolStatus = "ok";
        modelData = {
          appliedCount: applyResult.appliedCount,
          skipped,
          status: "ok",
        };
        summary = `Applied ${applyResult.appliedCount} operation(s).`;
      } else {
        // A partial apply (some ops failed/skipped) is NOT a success: surface
        // ok:false so the model/loop treats it as a deficiency to correct.
        toolOk = false;
        toolStatus = "partial";
        modelData = {
          appliedCount: applyResult.appliedCount,
          skipped,
          status: "partial",
        };
        const followUpFailed = applyResult.operations.filter(
          (op) => op.status === "applied" && op.error != null,
        ).length;
        summary = `Applied ${applyResult.appliedCount} op(s); failed ${applyResult.failedCount}, skipped ${applyResult.skippedCount}${followUpFailed ? `, ${followUpFailed} with failed follow-up wiring` : ""}.`;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      conversation.updateWriteProposalStatus(chatId, envelope.id, "failed", {
        proposalId: envelope.id,
        status: "failed",
        designId,
        appliedCount: 0,
        skippedCount: 0,
        failedCount: envelope.operations.length,
        operations: [],
        message,
      });
      finalWarnings.push(`Auto-apply failed: ${message}`);
      toolOk = false;
      toolStatus = "partial";
      modelData = {
        appliedCount: 0,
        skipped: [...buildSkipped, { id: "apply", reason: message }],
        status: "partial",
      };
      summary = `Auto-apply failed: ${message}`;
    }
  }
  return {
    ok: toolOk,
    status: toolStatus,
    summary,
    data: envelope,
    modelData,
    sources,
    warnings: finalWarnings,
    truncated: finalWarnings.some((w) => w.startsWith("Only the first")),
    limits,
  };
}

export async function applySchematicProposalOperations(input: {
  designer: DesignerSDK;
  designId: string;
  baseRevision: number | null;
  envelope: SchematicProposalEnvelope;
  allowPartial?: boolean;
}): Promise<SchematicApplyResult> {
  const design = await input.designer.getDesign(input.designId);
  if (!design) throw new Error(`Design not found: ${input.designId}`);
  if (
    input.baseRevision !== null &&
    design.head.revision !== input.baseRevision
  ) {
    throw new Error(
      `Design changed since proposal was created (expected revision ${input.baseRevision}, current ${design.head.revision}). Regenerate the proposal.`,
    );
  }
  if (
    (input.envelope.warnings?.length ?? 0) > 0 &&
    input.allowPartial !== true
  ) {
    throw new Error(
      "Proposal has warnings or skipped items. Confirm partial apply first.",
    );
  }
  let baseRevision = input.baseRevision;
  const operations: SchematicApplyResult["operations"] = [];
  // Destructive proposals are all-or-nothing; non-destructive proposals
  // skip-and-continue so one bad operation does not block the rest.
  const stopOnError = input.envelope.riskLevel === "destructive";
  let stoppedAtOperationId: string | undefined;

  const dispatch = (command: DesignerCommandEnvelope["command"]) =>
    input.designer.dispatchCommand(input.designId, {
      commandId: crypto.randomUUID(),
      sessionId: AI_DESIGNER_SESSION_ID,
      aggregateId: input.designId,
      baseRevision,
      issuedAt: Date.now(),
      command,
    });

  for (const operation of input.envelope.operations) {
    const revisionBefore = baseRevision;
    const result = await dispatch(operation.payload);
    if (result.ok !== true) {
      operations.push({
        operationId: operation.id,
        status: "failed",
        revisionBefore,
        error: result.code,
        result,
      });
      // A revision conflict invalidates `baseRevision` for every remaining op,
      // so always stop (continuing would just fail the whole tail identically).
      if (stopOnError || result.code === "REVISION_CONFLICT") {
        stoppedAtOperationId = operation.id;
        break;
      }
      continue;
    }
    baseRevision = result.revision;
    let revisionAfter = result.revision;
    let failedFollowUp: { error: string; result: unknown } | null = null;

    // place_part → optional value/properties update.
    if (
      operation.payload.type === "place_part" &&
      operation.updatePartAfterCreate &&
      result.createdEntityId
    ) {
      const updateResult = await dispatch({
        type: "update_part_properties",
        partId: result.createdEntityId,
        ...(operation.updatePartAfterCreate.value !== undefined
          ? { value: operation.updatePartAfterCreate.value }
          : {}),
        ...(operation.updatePartAfterCreate.propertiesJson !== undefined
          ? { propertiesJson: operation.updatePartAfterCreate.propertiesJson }
          : {}),
      });
      if (updateResult.ok !== true) {
        failedFollowUp = { error: updateResult.code, result: updateResult };
      } else {
        baseRevision = updateResult.revision;
        revisionAfter = updateResult.revision;
      }
    }

    // net-connect → wire the source pin to the just-created primitive's pin.
    if (
      !failedFollowUp &&
      operation.linkWireToCreatedPrimitive &&
      result.createdEntityId
    ) {
      const wireResult = await dispatch({
        type: "create_wire",
        sourcePinId: operation.linkWireToCreatedPrimitive.sourcePinId,
        targetPinId: `primitive:${result.createdEntityId}`,
      });
      if (wireResult.ok !== true) {
        failedFollowUp = { error: wireResult.code, result: wireResult };
      } else {
        baseRevision = wireResult.revision;
        revisionAfter = wireResult.revision;
      }
    }

    if (failedFollowUp) {
      // F5a: the PRIMARY mutation already landed (createdEntityId exists); only
      // the follow-up wire failed. Report the op as applied — so the created
      // entity is counted (truthful) and not re-created on a correction re-run —
      // but keep the follow-up `error`; `followUpFailedCount` below forces the
      // overall result to "partial" (ok:false), so this is never a clean success.
      operations.push({
        operationId: operation.id,
        status: "applied",
        revisionBefore,
        revisionAfter,
        createdEntityId: result.createdEntityId,
        error: failedFollowUp.error,
        result: failedFollowUp.result,
      });
      if (stopOnError) {
        stoppedAtOperationId = operation.id;
        break;
      }
      continue;
    }

    operations.push({
      operationId: operation.id,
      status: "applied",
      revisionBefore,
      revisionAfter,
      createdEntityId: result.createdEntityId,
      result,
    });
  }

  const appliedCount = operations.filter(
    (entry) => entry.status === "applied",
  ).length;
  const failedCount = operations.filter(
    (entry) => entry.status === "failed",
  ).length;
  // F5a: an op whose primary landed but whose follow-up failed is recorded as
  // applied + carries an `error`. It counts toward appliedCount (entity exists)
  // yet must drop the result out of clean "applied" into "partial".
  const followUpFailedCount = operations.filter(
    (entry) => entry.status === "applied" && entry.error != null,
  ).length;
  // Operations not reached after an early stop, PLUS items dropped at
  // proposal-build time (which never enter `operations[]`). ANY build warning —
  // a per-item skip OR a truncation ("Only the first …") — means the proposal
  // is incomplete, so the status must never read "applied".
  const warningList = input.envelope.warnings ?? [];
  const buildSkipped = warningList.filter(
    (w) => !w.startsWith("Only the first"),
  ).length;
  const loopSkipped = input.envelope.operations.length - operations.length;
  const skippedCount = loopSkipped + buildSkipped;
  const incomplete =
    failedCount > 0 ||
    followUpFailedCount > 0 ||
    skippedCount > 0 ||
    warningList.length > 0;
  const status: SchematicApplyResult["status"] = !incomplete
    ? "applied"
    : appliedCount > 0
      ? "partial"
      : "failed";
  return {
    proposalId: input.envelope.id,
    status,
    designId: input.designId,
    appliedCount,
    skippedCount,
    failedCount,
    ...(stoppedAtOperationId ? { stoppedAtOperationId } : {}),
    operations,
    message:
      status === "applied"
        ? `Applied ${appliedCount} schematic operation(s).`
        : `Applied ${appliedCount}, failed ${failedCount}, skipped ${skippedCount}${followUpFailedCount ? `, ${followUpFailedCount} with failed follow-up wiring` : ""} schematic operation(s).`,
  };
}

export async function applyDesignerPlaceComponentsProposal(input: {
  designer: DesignerSDK;
  proposal: AssistantPlacementProposal;
  designId: string;
  baseRevision: number | null;
  allowPartial: boolean;
}): Promise<{
  proposalId: string;
  status: "applied";
  designId: string;
  applied: Array<{
    componentId: string;
    componentName: string;
    partId: string | null;
    revision: number;
  }>;
  skipped: AssistantPlacementProposal["skipped"];
  results: Awaited<ReturnType<DesignerSDK["dispatchCommand"]>>[];
}> {
  if (input.proposal.skipped.length > 0 && !input.allowPartial) {
    throw new Error(
      "Proposal has skipped components. Confirm partial apply first.",
    );
  }
  const design = await input.designer.getDesign(input.designId);
  if (!design) throw new Error(`Design not found: ${input.designId}`);
  if (
    input.baseRevision !== null &&
    design.head.revision !== input.baseRevision
  ) {
    throw new Error(
      `Design changed since proposal was created (expected revision ${input.baseRevision}, current ${design.head.revision}). Regenerate the proposal.`,
    );
  }

  let baseRevision: number | null = input.baseRevision;
  const applied: Array<{
    componentId: string;
    componentName: string;
    partId: string | null;
    revision: number;
  }> = [];
  const results: Awaited<ReturnType<DesignerSDK["dispatchCommand"]>>[] = [];
  const failWithPartial = (message: string): never => {
    throw new AssistantProposalApplyError(message, {
      proposalId: input.proposal.proposalId,
      status: applied.length > 0 ? "partial" : "failed",
      designId: input.designId,
      applied,
      skipped: input.proposal.skipped,
      results,
      message,
    });
  };
  for (const placement of input.proposal.placements) {
    const envelope: DesignerCommandEnvelope = {
      commandId: crypto.randomUUID(),
      sessionId: AI_DESIGNER_SESSION_ID,
      aggregateId: input.designId,
      baseRevision,
      issuedAt: Date.now(),
      command: {
        type: "place_part",
        componentId: placement.componentId,
        positionNm: placement.positionNm,
        rotationDeg: placement.rotationDeg,
        mirrored: placement.mirrored,
      },
    };
    const result = await input.designer.dispatchCommand(
      input.designId,
      envelope,
    );
    results.push(result);
    if (result.ok !== true) {
      failWithPartial(
        `Failed to place ${placement.componentName}: ${result.code}`,
      );
    }
    const placedResult = result as {
      ok: true;
      revision: number;
      createdEntityId: string | null;
    };
    baseRevision = placedResult.revision;
    let appliedRevision = placedResult.revision;
    if (
      placedResult.createdEntityId &&
      (placement.value !== undefined || placement.properties !== undefined)
    ) {
      const propertiesJson =
        placement.properties !== undefined
          ? {
              ...placement.properties,
              ...(placement.value !== undefined
                ? { intendedValue: placement.value }
                : {}),
            }
          : placement.value !== undefined
            ? { intendedValue: placement.value }
            : undefined;
      const updateEnvelope: DesignerCommandEnvelope = {
        commandId: crypto.randomUUID(),
        sessionId: AI_DESIGNER_SESSION_ID,
        aggregateId: input.designId,
        baseRevision,
        issuedAt: Date.now(),
        command: {
          type: "update_part_properties",
          partId: placedResult.createdEntityId,
          ...(placement.value !== undefined ? { value: placement.value } : {}),
          ...(propertiesJson ? { propertiesJson } : {}),
        },
      };
      const updateResult = await input.designer.dispatchCommand(
        input.designId,
        updateEnvelope,
      );
      results.push(updateResult);
      if (updateResult.ok !== true) {
        failWithPartial(
          `Failed to annotate ${placement.componentName}: ${updateResult.code}`,
        );
      }
      const annotatedResult = updateResult as {
        ok: true;
        revision: number;
        createdEntityId: string | null;
      };
      baseRevision = annotatedResult.revision;
      appliedRevision = annotatedResult.revision;
    }
    applied.push({
      componentId: placement.componentId,
      componentName: placement.componentName,
      partId: placedResult.createdEntityId,
      revision: appliedRevision,
    });
  }
  return {
    proposalId: input.proposal.proposalId,
    status: "applied",
    designId: input.designId,
    applied,
    skipped: input.proposal.skipped,
    results,
  };
}

export class AssistantProposalApplyError extends Error {
  constructor(
    message: string,
    readonly applyResult: unknown,
  ) {
    super(message);
    this.name = "AssistantProposalApplyError";
  }
}

export function isAssistantProposalApplyError(
  err: unknown,
): err is AssistantProposalApplyError {
  return err instanceof AssistantProposalApplyError;
}

// ─── register entry point ──────────────────────────────────────────────

export function registerDesignerTools(
  registry: AiToolRegistry,
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions = {},
): void {
  registry.register(
    makeDesignerResolveDesignTool(contextResolver) as unknown as AiTool,
  );
  registry.register(
    makeDesignerGetDesignSummaryTool(ctx, contextResolver) as unknown as AiTool,
  );
  registry.register(
    makeDesignerGetPartDetailTool(ctx, contextResolver) as unknown as AiTool,
  );
  registry.register(
    makeDesignerGetSchematicConnectivityTool(
      ctx,
      contextResolver,
    ) as unknown as AiTool,
  );
  registry.register(
    makeDesignerCreateDesignTool(ctx, contextResolver) as unknown as AiTool,
  );
  registry.register(
    makeDesignerProposeSchematicEditsTool(
      ctx,
      contextResolver,
      conversation,
      options,
    ) as unknown as AiTool,
  );
  registry.register(
    makeDesignerProposeSchematicWiresTool(
      ctx,
      contextResolver,
      conversation,
      options,
    ) as unknown as AiTool,
  );
  registry.register(
    makeDesignerArrangeSchematicTool(
      ctx,
      contextResolver,
      conversation,
      options,
    ) as unknown as AiTool,
  );
  registry.register(
    makeDesignerProposeSchematicUpdatesTool(
      ctx,
      contextResolver,
      conversation,
      options,
    ) as unknown as AiTool,
  );
  registry.register(
    makeDesignerProposeSchematicDeletionsTool(
      ctx,
      contextResolver,
      conversation,
      options,
    ) as unknown as AiTool,
  );
  registry.register(
    makeDesignerPlaceComponentsTool(
      ctx,
      contextResolver,
      conversation,
      options,
    ) as unknown as AiTool,
  );
}
