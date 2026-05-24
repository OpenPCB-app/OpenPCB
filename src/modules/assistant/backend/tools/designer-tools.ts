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
  type DesignerSDK,
  type DesignerSchematicProjection,
  type DesignerPcbProjection,
} from "../../../../sdks";
import type { ContextResolver } from "../context-resolver";

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
      const result = await contextResolver.resolveDesign(chatId, input.query);
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
      const primary = execCtx.chatId
        ? contextResolver.getPrimaryDesign(execCtx.chatId)
        : undefined;
      const designId = input.designId ?? primary?.refId;
      if (!designId) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: [
            "No design specified. Resolve a design first via designer_resolve_design or provide designId.",
          ],
          truncated: false,
          limits: execCtx.limits,
        };
      }
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
      const primary = execCtx.chatId
        ? contextResolver.getPrimaryDesign(execCtx.chatId)
        : undefined;
      const designId = input.designId ?? primary?.refId;
      if (!designId) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: ["No design specified."],
          truncated: false,
          limits: execCtx.limits,
        };
      }
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
          label: primary?.label ?? designId,
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

// ─── register entry point ──────────────────────────────────────────────

export function registerDesignerTools(
  registry: AiToolRegistry,
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
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
}
