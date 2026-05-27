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
  type DesignerDesignSummary,
  type DesignerSDK,
  type DesignerCommandEnvelope,
  type DesignerSchematicProjection,
  type DesignerPcbProjection,
} from "../../../../sdks";
import type { ContextResolver } from "../context-resolver";
import type { ConversationStore } from "../conversation-store";

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
    | "designer_propose_schematic_deletions";
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
}): { ok: true; designId: string; label?: string } | { ok: false; warning: string } {
  const primary = input.chatId
    ? input.contextResolver.getPrimaryDesign(input.chatId)
    : undefined;
  if (primary?.status === "missing") {
    return {
      ok: false,
      warning: "The bound design is missing. Choose another design before continuing.",
    };
  }
  if (primary && input.requestedDesignId && input.requestedDesignId !== primary.refId) {
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
      warning: "No design specified. Resolve a design first via designer_resolve_design.",
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

function summarizeCreatedDesign(created: DesignerDesignSummary): DesignerCreateDesignOutput["design"] {
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
  const xs = projection.parts.map((part) => part.positionNm.x);
  const ys = projection.parts.map((part) => part.positionNm.y);
  return {
    x: snapNm(Math.max(...xs) + DEFAULT_GRID_SPACING_X_NM),
    y: snapNm(Math.min(...ys)),
  };
}

function expandPlacementInputs(
  input: DesignerPlaceComponentsInput,
): Array<{
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
        "Create a pending approval proposal to place installed library components onto the bound design's schematic canvas. Does not mutate the design until the user clicks Apply.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
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
                  description: "Optional displayed part value/intended value, e.g. 330Ω, 10k, 10µF, red LED.",
                },
                properties: {
                  type: "object",
                  description: "Optional string metadata such as color, role, tolerance, voltage, current, or package intent.",
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
      if (!resolvedDesign.ok) return failedTool(resolvedDesign.warning, execCtx.limits);
      const designId = resolvedDesign.designId;
      const [designRecord, projection] = await Promise.all([
        designer.getDesign(designId),
        designer.getSchematicProjection(designId),
      ]);
      if (!designRecord || !projection) {
        return failedTool(`Design not found or unavailable: ${designId}`, execCtx.limits);
      }

      const requested = expandPlacementInputs(input);
      const placementInputTruncated = countRequestedPlacements(input) > MAX_PLACEMENTS_PER_PROPOSAL;
      if (requested.length === 0) {
        return failedTool("No components requested for placement.", execCtx.limits);
      }
      const columns = Math.max(
        1,
        Math.min(input.layout?.columns ?? Math.ceil(Math.sqrt(requested.length)), 8),
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
            y: snapNm(start.y + Math.floor(idx / columns) * DEFAULT_GRID_SPACING_Y_NM),
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
          warnings: skipped.length > 0
            ? skipped.map((item) => `${item.componentId}: ${item.reason}`)
            : ["No valid installed components were resolved for placement."],
          truncated: placementInputTruncated,
          limits: execCtx.limits,
        };
      }

      await contextResolver.maybeAutoBindDesign(chatId, designId);

      const proposalId = crypto.randomUUID();
      const proposalWarnings = skipped.map((item) => `${item.componentId}: ${item.reason}`);
      if (placementInputTruncated) {
        proposalWarnings.push(`Only the first ${MAX_PLACEMENTS_PER_PROPOSAL} requested placement(s) were included.`);
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
        requiresPartialConfirmation: skipped.length > 0 || placementInputTruncated,
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
        } catch (err) {
          conversation.updateWriteProposalStatus(
            chatId,
            proposalId,
            writeProposalTerminalStatus(
              isAssistantProposalApplyError(err) ? err.applyResult : null,
            ),
            isAssistantProposalApplyError(err)
              ? err.applyResult
              : { message: err instanceof Error ? err.message : String(err) },
          );
        }
      }
      return {
        ok: placements.length > 0,
        data: proposal,
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
}): PlacementProposalEnvelope {
  return {
    id: input.proposal.proposalId,
    kind: "designer_place_components",
    toolName: "designer_place_components",
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

function failedTool<T>(message: string, limits: AiToolResult<T>["limits"]): AiToolResult<T | null> {
  return {
    ok: false,
    data: null,
    sources: [],
    warnings: [message],
    truncated: false,
    limits,
  };
}

function writeProposalTerminalStatus(result: unknown): "applied" | "partial" | "failed" {
  if (result && typeof result === "object" && "status" in result) {
    const status = (result as { status?: unknown }).status;
    if (status === "applied" || status === "partial") return status;
  }
  return "failed";
}

function netNameByPinId(projection: DesignerSchematicProjection): Map<string, string> {
  const map = new Map<string, string>();
  for (const net of projection.nets) {
    for (const pinId of net.pinIds) map.set(pinId, net.name);
  }
  return map;
}

function allExistingPinIds(projection: DesignerSchematicProjection): Set<string> {
  return new Set([
    ...projection.parts.flatMap((part) => part.pins.map((pin) => pin.id)),
    ...projection.primitives.map((primitive) => `primitive:${primitive.id}`),
  ]);
}

function isManhattanPath(points: Array<{ x: number; y: number }>): boolean {
  if (points.length < 2) return true;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const next = points[i]!;
    if (prev.x !== next.x && prev.y !== next.y) return false;
  }
  return true;
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
): AiTool<DesignerGetSchematicConnectivityInput, DesignerGetSchematicConnectivityOutput | null> {
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
      if (!designer) return failedTool("Designer module not available.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({
        chatId: execCtx.chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok) return failedTool(resolvedDesign.warning, execCtx.limits);
      const design = await designer.getDesign(resolvedDesign.designId);
      if (!design) return failedTool(`Design not found: ${resolvedDesign.designId}`, execCtx.limits);
      const projection = await designer.getSchematicProjection(resolvedDesign.designId);
      if (!projection) return failedTool(`Schematic projection not found: ${resolvedDesign.designId}`, execCtx.limits);
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
        sources: [{ id: `design_${design.head.id}`, kind: "design", refId: design.head.id, label: design.head.name }],
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
  title: string;
  summary: string;
  parts?: Array<{
    componentId: string;
    value?: string;
    positionNm: { x: number; y: number };
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
    sourcePinId: string;
    targetPinId: string;
    pointsNm?: Array<{ x: number; y: number }>;
  }>;
}

export function makeDesignerProposeSchematicEditsTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions = {},
): AiTool<DesignerProposeSchematicEditsInput, SchematicProposalEnvelope | null> {
  return {
    definition: {
      name: "designer_propose_schematic_edits",
      version: "1",
      effect: "write",
      capability: "designer.write.schematic.propose_edits",
      description:
        "Create a pending proposal for small schematic edits: place parts, add labels/power ports/net portals, and optionally wire existing pins. Does not mutate unless session auto-apply is enabled or user applies it.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          parts: { type: "array", items: { type: "object" } },
          labels: { type: "array", items: { type: "object" } },
          powerPorts: { type: "array", items: { type: "object" } },
          wires: { type: "array", items: { type: "object" } },
        },
        required: ["title", "summary"],
      },
    },
    async execute(execCtx, input) {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer) return failedTool("Designer module not available.", execCtx.limits);
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({
        chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok) return failedTool(resolvedDesign.warning, execCtx.limits);
      const designId = resolvedDesign.designId;
      const designRecord = await designer.getDesign(designId);
      if (!designRecord) return failedTool(`Design not found: ${designId}`, execCtx.limits);
      const schematic = input.wires?.length
        ? await designer.getSchematicProjection(designId)
        : null;
      if (input.wires?.length && !schematic) {
        return failedTool(`Schematic projection not found: ${designId}`, execCtx.limits);
      }
      const existingPinIds = schematic ? allExistingPinIds(schematic) : new Set<string>();

      const proposalId = crypto.randomUUID();
      const sources: AiSourceRef[] = [
        {
          id: `design_${designId}`,
          kind: "design",
          refId: designId,
          label: designRecord.head.name,
        },
      ];
      const warnings: string[] = [];
      const operations: SchematicProposalEnvelope["operations"] = [];
      if ((input.parts?.length ?? 0) > 20) warnings.push("Only the first 20 part operation(s) were included.");
      if ((input.labels?.length ?? 0) > 20) warnings.push("Only the first 20 label operation(s) were included.");
      if ((input.powerPorts?.length ?? 0) > 20) warnings.push("Only the first 20 power/portal operation(s) were included.");
      if ((input.wires?.length ?? 0) > 20) warnings.push("Only the first 20 wire operation(s) were included.");

      for (const part of (input.parts ?? []).slice(0, 20)) {
        const detail = await designer.resolveLibraryComponentForPlacement(part.componentId);
        if (!detail) {
          warnings.push(`${part.componentId}: Installed library component not found.`);
          continue;
        }
        const placeCommand: DesignerCommandEnvelope["command"] = {
          type: "place_part",
          componentId: part.componentId,
          positionNm: snapPoint(part.positionNm),
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
          updatePartAfterCreate: part.value !== undefined || part.properties !== undefined
            ? {
                ...(part.value !== undefined ? { value: part.value } : {}),
                ...(part.properties !== undefined ? { propertiesJson: part.properties } : {}),
              }
            : undefined,
          sources: [{ id: `library_component_${part.componentId}`, kind: "library-component", refId: part.componentId, label: detail.component.name }],
          warnings: [],
        });
        sources.push({ id: `library_component_${part.componentId}`, kind: "library-component", refId: part.componentId, label: detail.component.name });
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
        if (port.kind !== "gnd" && port.kind !== "pwr" && port.kind !== "net_portal") {
          warnings.push(`Skipped power/portal: unsupported kind ${String(port.kind)}.`);
          continue;
        }
        const command: DesignerCommandEnvelope["command"] = port.kind === "gnd"
          ? { type: "place_gnd_port", positionNm, rotationDeg }
          : port.kind === "pwr"
            ? { type: "place_pwr_port", positionNm, rotationDeg, railText: port.text?.trim() || "VCC" }
            : { type: "place_net_portal", positionNm, rotationDeg, portalText: port.text?.trim() || "NET" };
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
        if (
          !existingPinIds.has(wire.sourcePinId) ||
          !existingPinIds.has(wire.targetPinId)
        ) {
          warnings.push(
            `Skipped wire ${wire.sourcePinId} -> ${wire.targetPinId}: pin IDs must already exist in the current schematic projection.`,
          );
          continue;
        }
        const pointsNm = wire.pointsNm?.map(snapPoint);
        if (pointsNm && !isManhattanPath(pointsNm)) {
          warnings.push(
            `Skipped wire ${wire.sourcePinId} -> ${wire.targetPinId}: pointsNm must be Manhattan/orthogonal.`,
          );
          continue;
        }
        const command: DesignerCommandEnvelope["command"] = {
          type: "create_wire",
          sourcePinId: wire.sourcePinId,
          targetPinId: wire.targetPinId,
          ...(pointsNm && pointsNm.length > 0 ? { pointsNm } : {}),
        };
        operations.push({
          id: `${proposalId}:wire:${operations.length}`,
          kind: "designer.create_wire",
          title: "Create wire",
          summary: `Wire ${wire.sourcePinId} to ${wire.targetPinId}.`,
          riskLevel: "high",
          payload: command,
          sources: [],
          warnings: [],
        });
      }

      if (operations.length === 0) {
        return {
          ok: false,
          data: null,
          sources,
          warnings: warnings.length > 0
            ? [...warnings, "No valid schematic operations were proposed."]
            : ["No valid schematic operations were proposed."],
          truncated: warnings.some((warning) => warning.startsWith("Only the first")),
          limits: execCtx.limits,
        };
      }

      await contextResolver.maybeAutoBindDesign(chatId, designId);

      const envelope: SchematicProposalEnvelope = {
        id: proposalId,
        kind: "designer_schematic_edits",
        toolName: "designer_propose_schematic_edits",
        title: input.title.trim() || "Schematic edit proposal",
        summary: input.summary.trim() || `Propose ${operations.length} schematic operation(s).`,
        riskLevel: operations.some((operation) => operation.riskLevel === "high") ? "high" : "medium",
        designId,
        baseRevision: designRecord.head.revision,
        operations,
        payload: input,
        sources,
        warnings,
      };
      conversation.createWriteProposal({
        id: proposalId,
        chatId,
        kind: "designer_schematic_edits",
        designId,
        baseRevision: designRecord.head.revision,
        proposal: envelope,
        envelope,
      });
      if (
        warnings.length === 0 &&
        options.isSessionAutoApplyAllowed?.({
          chatId,
          toolName: "designer_propose_schematic_edits",
          proposalKind: "designer_schematic_edits",
          riskLevel: envelope.riskLevel,
        }) === true
      ) {
        const applyResult = await applySchematicProposalOperations({
          designer,
          designId,
          baseRevision: designRecord.head.revision,
          envelope,
          allowPartial: false,
        });
        conversation.updateWriteProposalStatus(
          chatId,
          proposalId,
          writeProposalTerminalStatus(applyResult),
          applyResult,
        );
      }
      return { ok: true, data: envelope, sources, warnings, truncated: warnings.some((warning) => warning.startsWith("Only the first")), limits: execCtx.limits };
    },
  };
}

// ─── designer_propose_schematic_wires ──────────────────────────────────

interface DesignerProposeSchematicWiresInput {
  designId?: string;
  title: string;
  summary: string;
  wires?: Array<{
    sourcePinId: string;
    targetPinId: string;
    netName?: string;
    pointsNm?: Array<{ x: number; y: number }>;
    reason?: string;
  }>;
  junctions?: Array<{
    sourcePinId: string;
    wireId: string;
    targetPointNm: { x: number; y: number };
    pointsNm?: Array<{ x: number; y: number }>;
    reason?: string;
  }>;
}

export function makeDesignerProposeSchematicWiresTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions = {},
): AiTool<DesignerProposeSchematicWiresInput, SchematicProposalEnvelope | null> {
  return {
    definition: {
      name: "designer_propose_schematic_wires",
      version: "1",
      effect: "write",
      capability: "designer.write.schematic.propose_wires",
      description:
        "Create a pending proposal to wire existing schematic pins or add junction wires using exact pin IDs from designer_get_schematic_connectivity. Does not mutate until applied unless session auto-apply is enabled.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          wires: { type: "array", items: { type: "object" } },
          junctions: { type: "array", items: { type: "object" } },
        },
        required: ["title", "summary"],
      },
    },
    async execute(execCtx, input) {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer) return failedTool("Designer module not available.", execCtx.limits);
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({
        chatId,
        requestedDesignId: input.designId,
        contextResolver,
      });
      if (!resolvedDesign.ok) return failedTool(resolvedDesign.warning, execCtx.limits);
      const designId = resolvedDesign.designId;
      const designRecord = await designer.getDesign(designId);
      if (!designRecord) return failedTool(`Design not found: ${designId}`, execCtx.limits);
      const schematic = await designer.getSchematicProjection(designId);
      if (!schematic) return failedTool(`Schematic projection not found: ${designId}`, execCtx.limits);

      const proposalId = crypto.randomUUID();
      const warnings: string[] = [];
      const operations: SchematicProposalEnvelope["operations"] = [];
      if ((input.wires?.length ?? 0) > 40) warnings.push("Only the first 40 wire operation(s) were included.");
      if ((input.junctions?.length ?? 0) > 40) warnings.push("Only the first 40 junction operation(s) were included.");
      const existingPinIds = allExistingPinIds(schematic);
      const wireById = new Map(schematic.wires.map((wire) => [wire.id, wire]));
      const sources: AiSourceRef[] = [
        { id: `design_${designId}`, kind: "design", refId: designId, label: designRecord.head.name },
        { id: `schematic_${designId}`, kind: "schematic", refId: designId, label: `${designRecord.head.name} schematic` },
      ];

      for (const wire of (input.wires ?? []).slice(0, 40)) {
        if (!existingPinIds.has(wire.sourcePinId) || !existingPinIds.has(wire.targetPinId)) {
          warnings.push(`Skipped wire ${wire.sourcePinId} -> ${wire.targetPinId}: pin IDs must already exist in the current schematic projection.`);
          continue;
        }
        const pointsNm = wire.pointsNm?.map(snapPoint);
        if (pointsNm && !isManhattanPath(pointsNm)) {
          warnings.push(`Skipped wire ${wire.sourcePinId} -> ${wire.targetPinId}: pointsNm must be Manhattan/orthogonal.`);
          continue;
        }
        const command: DesignerCommandEnvelope["command"] = {
          type: "create_wire",
          sourcePinId: wire.sourcePinId,
          targetPinId: wire.targetPinId,
          ...(pointsNm && pointsNm.length > 0 ? { pointsNm } : {}),
        };
        operations.push({
          id: `${proposalId}:wire:${operations.length}`,
          kind: "designer.create_wire",
          title: wire.netName ? `Wire ${wire.netName}` : "Create wire",
          summary: wire.reason ?? `Wire ${wire.sourcePinId} to ${wire.targetPinId}.`,
          riskLevel: "high",
          payload: command,
          sources,
          warnings: [],
        });
      }

      for (const junction of (input.junctions ?? []).slice(0, 40)) {
        const targetPointNm = snapPoint(junction.targetPointNm);
        const existingWire = wireById.get(junction.wireId);
        if (!existingPinIds.has(junction.sourcePinId)) {
          warnings.push(`Skipped junction wire from ${junction.sourcePinId}: source pin ID must already exist.`);
          continue;
        }
        if (!existingWire) {
          warnings.push(`Skipped junction wire to ${junction.wireId}: target wire ID does not exist.`);
          continue;
        }
        if (!pointOnWire(targetPointNm, existingWire)) {
          warnings.push(`Skipped junction wire to ${junction.wireId}: target point is not on that wire.`);
          continue;
        }
        const pointsNm = junction.pointsNm?.map(snapPoint);
        if (pointsNm && !isManhattanPath(pointsNm)) {
          warnings.push(`Skipped junction wire to ${junction.wireId}: pointsNm must be Manhattan/orthogonal.`);
          continue;
        }
        const command: DesignerCommandEnvelope["command"] = {
          type: "create_wire_junction",
          sourcePinId: junction.sourcePinId,
          wireId: junction.wireId,
          targetPointNm,
          ...(pointsNm && pointsNm.length > 0 ? { pointsNm } : {}),
        };
        operations.push({
          id: `${proposalId}:junction:${operations.length}`,
          kind: "designer.create_wire_junction",
          title: "Create junction wire",
          summary: junction.reason ?? `Wire ${junction.sourcePinId} to junction on ${junction.wireId}.`,
          riskLevel: "high",
          payload: command,
          sources,
          warnings: [],
        });
      }

      if (operations.length === 0) {
        return {
          ok: false,
          data: null,
          sources,
          warnings: warnings.length > 0
            ? [...warnings, "No valid schematic wire operations were proposed."]
            : ["No valid schematic wire operations were proposed."],
          truncated: warnings.some((warning) => warning.startsWith("Only the first")),
          limits: execCtx.limits,
        };
      }

      await contextResolver.maybeAutoBindDesign(chatId, designId);

      const envelope: SchematicProposalEnvelope = {
        id: proposalId,
        kind: "designer_schematic_wires",
        toolName: "designer_propose_schematic_wires",
        title: input.title.trim() || "Schematic wiring proposal",
        summary: input.summary.trim() || `Propose ${operations.length} schematic wire operation(s).`,
        riskLevel: "high",
        designId,
        baseRevision: designRecord.head.revision,
        operations,
        payload: input,
        sources,
        warnings,
      };
      conversation.createWriteProposal({
        id: proposalId,
        chatId,
        kind: "designer_schematic_wires",
        designId,
        baseRevision: designRecord.head.revision,
        proposal: envelope,
        envelope,
      });
      if (
        warnings.length === 0 &&
        options.isSessionAutoApplyAllowed?.({
          chatId,
          toolName: "designer_propose_schematic_wires",
          proposalKind: "designer_schematic_wires",
          riskLevel: envelope.riskLevel,
        }) === true
      ) {
        const applyResult = await applySchematicProposalOperations({
          designer,
          designId,
          baseRevision: designRecord.head.revision,
          envelope,
          allowPartial: false,
        });
        conversation.updateWriteProposalStatus(
          chatId,
          proposalId,
          writeProposalTerminalStatus(applyResult),
          applyResult,
        );
      }
      return { ok: true, data: envelope, sources, warnings, truncated: warnings.some((warning) => warning.startsWith("Only the first")), limits: execCtx.limits };
    },
  };
}

// ─── designer_propose_schematic_updates ────────────────────────────────

interface DesignerProposeSchematicUpdatesInput {
  designId?: string;
  title: string;
  summary: string;
  partUpdates?: Array<{
    partId: string;
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
): AiTool<DesignerProposeSchematicUpdatesInput, SchematicProposalEnvelope | null> {
  return {
    definition: {
      name: "designer_propose_schematic_updates",
      version: "1",
      effect: "write",
      capability: "designer.write.schematic.propose_updates",
      description:
        "Create a pending proposal to move/rotate/mirror schematic parts, edit part values/properties, move/update labels, or move/rotate/update power/net portal primitives.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          partUpdates: { type: "array", items: { type: "object" } },
          labelUpdates: { type: "array", items: { type: "object" } },
          primitiveUpdates: { type: "array", items: { type: "object" } },
        },
        required: ["title", "summary"],
      },
    },
    async execute(execCtx, input) {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer) return failedTool("Designer module not available.", execCtx.limits);
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({ chatId, requestedDesignId: input.designId, contextResolver });
      if (!resolvedDesign.ok) return failedTool(resolvedDesign.warning, execCtx.limits);
      const designId = resolvedDesign.designId;
      const designRecord = await designer.getDesign(designId);
      if (!designRecord) return failedTool(`Design not found: ${designId}`, execCtx.limits);
      const schematic = await designer.getSchematicProjection(designId);
      if (!schematic) return failedTool(`Schematic projection not found: ${designId}`, execCtx.limits);

      const proposalId = crypto.randomUUID();
      const warnings: string[] = [];
      const operations: SchematicProposalEnvelope["operations"] = [];
      if ((input.partUpdates?.length ?? 0) > 40) warnings.push("Only the first 40 part update operation(s) were included.");
      if ((input.labelUpdates?.length ?? 0) > 40) warnings.push("Only the first 40 label update operation(s) were included.");
      if ((input.primitiveUpdates?.length ?? 0) > 40) warnings.push("Only the first 40 primitive update operation(s) were included.");
      const partById = new Map(schematic.parts.map((part) => [part.id, part]));
      const labelById = new Map(schematic.labels.map((label) => [label.id, label]));
      const primitiveById = new Map(schematic.primitives.map((primitive) => [primitive.id, primitive]));
      const sources: AiSourceRef[] = [
        { id: `design_${designId}`, kind: "design", refId: designId, label: designRecord.head.name },
      ];

      const pushOperation = (command: DesignerCommandEnvelope["command"], title: string, summary: string): void => {
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
        const part = partById.get(update.partId);
        if (!part) {
          warnings.push(`Skipped part update ${update.partId}: part does not exist.`);
          continue;
        }
        if (update.positionNm) {
          pushOperation(
            { type: "move_part", partId: update.partId, positionNm: snapPoint(update.positionNm) },
            `Move ${part.reference}`,
            update.reason ?? `Move ${part.reference}.`,
          );
        }
        if (update.rotationDeg !== undefined) {
          pushOperation(
            { type: "rotate_part", partId: update.partId, rotationDeg: update.rotationDeg },
            `Rotate ${part.reference}`,
            update.reason ?? `Rotate ${part.reference} to ${update.rotationDeg}°.` ,
          );
        }
        if (update.mirrored !== undefined) {
          pushOperation(
            { type: "mirror_part", partId: update.partId, mirrored: update.mirrored },
            `${update.mirrored ? "Mirror" : "Unmirror"} ${part.reference}`,
            update.reason ?? `${update.mirrored ? "Mirror" : "Unmirror"} ${part.reference}.`,
          );
        }
        if (update.reference !== undefined || update.value !== undefined || update.properties !== undefined) {
          pushOperation(
            {
              type: "update_part_properties",
              partId: update.partId,
              ...(update.reference !== undefined ? { reference: update.reference } : {}),
              ...(update.value !== undefined ? { value: update.value } : {}),
              ...(update.properties !== undefined ? { propertiesJson: update.properties } : {}),
            },
            `Update ${part.reference}`,
            update.reason ?? `Update ${part.reference} properties.`,
          );
        }
      }

      for (const update of (input.labelUpdates ?? []).slice(0, 40)) {
        const label = labelById.get(update.labelId);
        if (!label) {
          warnings.push(`Skipped label update ${update.labelId}: label does not exist.`);
          continue;
        }
        const text = update.text === undefined ? label.text : update.text.trim();
        if (!text) {
          warnings.push(`Skipped label update ${update.labelId}: text must not be empty.`);
          continue;
        }
        pushOperation(
          {
            type: "upsert_label",
            labelId: update.labelId,
            text,
            positionNm: update.positionNm ? snapPoint(update.positionNm) : label.positionNm,
          },
          `Update label ${label.text}`,
          update.reason ?? `Update label ${label.text} to ${text}.`,
        );
      }

      for (const update of (input.primitiveUpdates ?? []).slice(0, 40)) {
        const primitive = primitiveById.get(update.primitiveId);
        if (!primitive) {
          warnings.push(`Skipped primitive update ${update.primitiveId}: primitive does not exist.`);
          continue;
        }
        if (update.positionNm) {
          pushOperation(
            { type: "move_primitive", primitiveId: update.primitiveId, positionNm: snapPoint(update.positionNm) },
            `Move ${primitive.kind} port`,
            update.reason ?? `Move ${primitive.kind} port.`,
          );
        }
        if (update.rotationDeg !== undefined) {
          pushOperation(
            { type: "rotate_primitive", primitiveId: update.primitiveId, rotationDeg: update.rotationDeg },
            `Rotate ${primitive.kind} port`,
            update.reason ?? `Rotate ${primitive.kind} port to ${update.rotationDeg}°.` ,
          );
        }
        if (update.text !== undefined) {
          const text = update.text.trim();
          if (primitive.kind === "gnd") {
            warnings.push(`Skipped primitive text update ${update.primitiveId}: GND text is fixed.`);
          } else if (!text) {
            warnings.push(`Skipped primitive text update ${update.primitiveId}: text must not be empty.`);
          } else {
            pushOperation(
              { type: "update_primitive_text", primitiveId: update.primitiveId, text },
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
          warnings: warnings.length > 0
            ? [...warnings, "No valid schematic update operations were proposed."]
            : ["No valid schematic update operations were proposed."],
          truncated: warnings.some((warning) => warning.startsWith("Only the first")),
          limits: execCtx.limits,
        };
      }

      await contextResolver.maybeAutoBindDesign(chatId, designId);

      const envelope: SchematicProposalEnvelope = {
        id: proposalId,
        kind: "designer_schematic_updates",
        toolName: "designer_propose_schematic_updates",
        title: input.title.trim() || "Schematic update proposal",
        summary: input.summary.trim() || `Propose ${operations.length} schematic update operation(s).`,
        riskLevel: "medium",
        designId,
        baseRevision: designRecord.head.revision,
        operations,
        payload: input,
        sources,
        warnings,
      };
      conversation.createWriteProposal({ id: proposalId, chatId, kind: envelope.kind, designId, baseRevision: designRecord.head.revision, proposal: envelope, envelope });
      if (warnings.length === 0 && options.isSessionAutoApplyAllowed?.({ chatId, toolName: envelope.toolName, proposalKind: envelope.kind, riskLevel: envelope.riskLevel }) === true) {
        const applyResult = await applySchematicProposalOperations({ designer, designId, baseRevision: designRecord.head.revision, envelope, allowPartial: false });
        conversation.updateWriteProposalStatus(chatId, proposalId, writeProposalTerminalStatus(applyResult), applyResult);
      }
      return { ok: true, data: envelope, sources, warnings, truncated: warnings.some((warning) => warning.startsWith("Only the first")), limits: execCtx.limits };
    },
  };
}

// ─── designer_propose_schematic_deletions ──────────────────────────────

interface DesignerProposeSchematicDeletionsInput {
  designId?: string;
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
): AiTool<DesignerProposeSchematicDeletionsInput, SchematicProposalEnvelope | null> {
  return {
    definition: {
      name: "designer_propose_schematic_deletions",
      version: "1",
      effect: "write",
      capability: "designer.write.schematic.propose_deletions",
      description:
        "Create a destructive pending proposal to delete existing schematic parts, wires, labels, or primitives. Use only after explicit user confirmation.",
      inputSchema: {
        type: "object",
        properties: {
          designId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          entities: { type: "array", items: { type: "object" } },
        },
        required: ["title", "summary", "entities"],
      },
    },
    async execute(execCtx, input) {
      const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
      if (!designer) return failedTool("Designer module not available.", execCtx.limits);
      const chatId = execCtx.chatId;
      if (!chatId) return failedTool("Chat context missing.", execCtx.limits);
      const resolvedDesign = resolveDesignForTool({ chatId, requestedDesignId: input.designId, contextResolver });
      if (!resolvedDesign.ok) return failedTool(resolvedDesign.warning, execCtx.limits);
      const designId = resolvedDesign.designId;
      const designRecord = await designer.getDesign(designId);
      if (!designRecord) return failedTool(`Design not found: ${designId}`, execCtx.limits);
      const schematic = await designer.getSchematicProjection(designId);
      if (!schematic) return failedTool(`Schematic projection not found: ${designId}`, execCtx.limits);

      const exists = new Set([
        ...schematic.parts.map((entity) => `part:${entity.id}`),
        ...schematic.wires.map((entity) => `wire:${entity.id}`),
        ...schematic.labels.map((entity) => `label:${entity.id}`),
        ...schematic.primitives.map((entity) => `primitive:${entity.id}`),
      ]);
      const proposalId = crypto.randomUUID();
      const sources: AiSourceRef[] = [{ id: `design_${designId}`, kind: "design", refId: designId, label: designRecord.head.name }];
      const warnings: string[] = [];
      const operations: SchematicProposalEnvelope["operations"] = [];
      if ((input.entities?.length ?? 0) > 40) warnings.push("Only the first 40 delete operation(s) were included.");
      for (const entity of (input.entities ?? []).slice(0, 40)) {
        const key = `${entity.entityKind}:${entity.entityId}`;
        if (!exists.has(key)) {
          warnings.push(`Skipped delete ${key}: entity does not exist.`);
          continue;
        }
        operations.push({
          id: `${proposalId}:delete:${operations.length}`,
          kind: "designer.delete_entity",
          title: `Delete ${entity.entityKind}`,
          summary: entity.reason ?? `Delete ${entity.entityKind} ${entity.entityId}.`,
          riskLevel: "destructive",
          payload: { type: "delete_entity", entityId: entity.entityId, entityKind: entity.entityKind },
          sources,
          warnings: [],
        });
      }
      if (operations.length === 0) {
        return {
          ok: false,
          data: null,
          sources,
          warnings: warnings.length > 0
            ? [...warnings, "No valid schematic delete operations were proposed."]
            : ["No valid schematic delete operations were proposed."],
          truncated: warnings.some((warning) => warning.startsWith("Only the first")),
          limits: execCtx.limits,
        };
      }

      await contextResolver.maybeAutoBindDesign(chatId, designId);
      const envelope: SchematicProposalEnvelope = {
        id: proposalId,
        kind: "designer_schematic_deletions",
        toolName: "designer_propose_schematic_deletions",
        title: input.title.trim() || "Schematic deletion proposal",
        summary: input.summary.trim() || `Delete ${operations.length} schematic entity/entities.`,
        riskLevel: "destructive",
        designId,
        baseRevision: designRecord.head.revision,
        operations,
        payload: input,
        sources,
        warnings,
      };
      conversation.createWriteProposal({ id: proposalId, chatId, kind: envelope.kind, designId, baseRevision: designRecord.head.revision, proposal: envelope, envelope });
      if (warnings.length === 0 && options.isSessionAutoApplyAllowed?.({ chatId, toolName: envelope.toolName, proposalKind: envelope.kind, riskLevel: envelope.riskLevel }) === true) {
        const applyResult = await applySchematicProposalOperations({ designer, designId, baseRevision: designRecord.head.revision, envelope, allowPartial: false });
        conversation.updateWriteProposalStatus(chatId, proposalId, writeProposalTerminalStatus(applyResult), applyResult);
      }
      return { ok: true, data: envelope, sources, warnings, truncated: warnings.some((warning) => warning.startsWith("Only the first")), limits: execCtx.limits };
    },
  };
}

function snapPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: snapNm(point.x), y: snapNm(point.y) };
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
  if ((input.envelope.warnings?.length ?? 0) > 0 && input.allowPartial !== true) {
    throw new Error("Proposal has warnings or skipped items. Confirm partial apply first.");
  }
  let baseRevision = input.baseRevision;
  const operations: SchematicApplyResult["operations"] = [];
  const failResult = (
    operation: SchematicProposalEnvelope["operations"][number],
    commandId: string,
    revisionBefore: number | null,
    error: string,
    result?: unknown,
  ): SchematicApplyResult => {
    operations.push({
      operationId: operation.id,
      status: "failed",
      commandId,
      revisionBefore,
      error,
      result,
    });
    const appliedCount = operations.filter((entry) => entry.status === "applied").length;
    return {
      proposalId: input.envelope.id,
      status: appliedCount > 0 ? "partial" : "failed",
      designId: input.designId,
      appliedCount,
      skippedCount: 0,
      failedCount: 1,
      stoppedAtOperationId: operation.id,
      operations,
      message: `Stopped after ${operation.title} failed: ${error}`,
    };
  };
  for (const operation of input.envelope.operations) {
    const commandId = crypto.randomUUID();
    const revisionBefore = baseRevision;
    const result = await input.designer.dispatchCommand(input.designId, {
      commandId,
      sessionId: AI_DESIGNER_SESSION_ID,
      aggregateId: input.designId,
      baseRevision,
      issuedAt: Date.now(),
      command: operation.payload,
    });
    if (result.ok !== true) {
      return failResult(operation, commandId, revisionBefore, result.code, result);
    }
    baseRevision = result.revision;
    let revisionAfter = result.revision;
    if (
      operation.payload.type === "place_part" &&
      operation.updatePartAfterCreate &&
      result.createdEntityId
    ) {
      const updateCommandId = crypto.randomUUID();
      const updateResult = await input.designer.dispatchCommand(input.designId, {
        commandId: updateCommandId,
        sessionId: AI_DESIGNER_SESSION_ID,
        aggregateId: input.designId,
        baseRevision,
        issuedAt: Date.now(),
        command: {
          type: "update_part_properties",
          partId: result.createdEntityId,
          ...(operation.updatePartAfterCreate.value !== undefined ? { value: operation.updatePartAfterCreate.value } : {}),
          ...(operation.updatePartAfterCreate.propertiesJson !== undefined
            ? { propertiesJson: operation.updatePartAfterCreate.propertiesJson }
            : {}),
        },
      });
      if (updateResult.ok !== true) {
        return failResult(operation, updateCommandId, baseRevision, updateResult.code, updateResult);
      }
      baseRevision = updateResult.revision;
      revisionAfter = updateResult.revision;
    }
    operations.push({
      operationId: operation.id,
      status: "applied",
      commandId,
      revisionBefore,
      revisionAfter,
      createdEntityId: result.createdEntityId,
      result,
    });
  }
  return {
    proposalId: input.envelope.id,
    status: "applied",
    designId: input.designId,
    appliedCount: operations.length,
    skippedCount: 0,
    failedCount: 0,
    operations,
    message: `Applied ${operations.length} schematic operation(s).`,
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
    throw new Error("Proposal has skipped components. Confirm partial apply first.");
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
    const result = await input.designer.dispatchCommand(input.designId, envelope);
    results.push(result);
    if (result.ok !== true) {
      failWithPartial(`Failed to place ${placement.componentName}: ${result.code}`);
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
      const propertiesJson = placement.properties !== undefined
        ? {
            ...placement.properties,
            ...(placement.value !== undefined ? { intendedValue: placement.value } : {}),
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
    makeDesignerGetSchematicConnectivityTool(ctx, contextResolver) as unknown as AiTool,
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
