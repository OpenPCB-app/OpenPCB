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

export function makeDesignerPlaceComponentsTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
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

      await contextResolver.maybeAutoBindDesign(chatId, designId);

      const requested = expandPlacementInputs(input);
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
          truncated: requested.length >= MAX_PLACEMENTS_PER_PROPOSAL,
          limits: execCtx.limits,
        };
      }

      const proposalId = crypto.randomUUID();
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
        requiresPartialConfirmation: skipped.length > 0,
      };
      conversation.createWriteProposal({
        id: proposalId,
        chatId,
        kind: "designer_place_components",
        designId,
        baseRevision: designRecord.head.revision,
        proposal,
      });

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
      return {
        ok: placements.length > 0,
        data: proposal,
        sources,
        warnings: skipped.map((item) => `${item.componentId}: ${item.reason}`),
        truncated: requested.length >= MAX_PLACEMENTS_PER_PROPOSAL,
        limits: execCtx.limits,
      };
    },
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
    if (!result.ok) throw new Error(`Failed to place ${placement.componentName}: ${result.code}`);
    baseRevision = result.revision;
    if (result.createdEntityId && (placement.value || placement.properties)) {
      const propertiesJson = placement.properties
        ? { ...placement.properties, ...(placement.value ? { intendedValue: placement.value } : {}) }
        : placement.value
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
          partId: result.createdEntityId,
          ...(placement.value ? { value: placement.value } : {}),
          ...(propertiesJson ? { propertiesJson } : {}),
        },
      };
      const updateResult = await input.designer.dispatchCommand(
        input.designId,
        updateEnvelope,
      );
      results.push(updateResult);
      if (!updateResult.ok) {
        throw new Error(
          `Failed to annotate ${placement.componentName}: ${updateResult.code}`,
        );
      }
      baseRevision = updateResult.revision;
    }
    applied.push({
      componentId: placement.componentId,
      componentName: placement.componentName,
      partId: result.createdEntityId,
      revision: baseRevision,
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

// ─── register entry point ──────────────────────────────────────────────

export function registerDesignerTools(
  registry: AiToolRegistry,
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
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
    makeDesignerCreateDesignTool(ctx, contextResolver) as unknown as AiTool,
  );
  registry.register(
    makeDesignerPlaceComponentsTool(
      ctx,
      contextResolver,
      conversation,
    ) as unknown as AiTool,
  );
}
