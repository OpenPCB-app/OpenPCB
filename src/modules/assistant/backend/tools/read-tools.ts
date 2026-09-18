import type {
  AiJsonSchemaObject,
  AiTool,
  AiToolRegistry,
  AiToolResult,
} from "@openpcb/ai-core";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS, type DesignerSDK } from "../../../../sdks";

/**
 * Read tools that exist for MCP clients only.
 *
 * The in-app assistant deliberately does NOT get these: its system prompt and
 * Definition-of-Done harness are tuned against the current 15-tool set
 * (`prompt-service.ts`, `verification/run-dod.ts`), and widening the advertised
 * surface changes that loop's behaviour in ways that need measuring separately.
 * An external agent has no such tuning to disturb — it needs breadth (PCB
 * state, DRC, BOM, exports) to be useful at all.
 *
 * Everything here is `effect: "read"`, so none of it is gated on the
 * `mcpAllowWrites` setting.
 */

const NO_DESIGNER: Omit<AiToolResult<null>, "limits"> = {
  ok: false,
  data: null,
  sources: [],
  warnings: ["Designer module is not available."],
  truncated: false,
};

function designerOf(ctx: CoreBackendModuleContext): DesignerSDK | undefined {
  return ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER) ?? undefined;
}

function exportRefusalMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const status = (error as Error & { status?: unknown }).status;
  return status === 422 ? error.message : null;
}

function missingDesign(designId: string | undefined): string {
  return designId
    ? `Design '${designId}' not found.`
    : "No design selected. Open one in OpenPCB, or call designer_list_designs and pass designId.";
}

/** Shared shape: every tool below takes an optional designId. */
const DESIGN_INPUT_SCHEMA: AiJsonSchemaObject = {
  type: "object",
  properties: {
    designId: {
      type: "string",
      description:
        "Target design. Omit to use the design currently focused in the OpenPCB UI.",
    },
  },
};

interface DesignInput {
  designId?: string;
}

function makeListDesignsTool(ctx: CoreBackendModuleContext): AiTool {
  return {
    definition: {
      name: "designer_list_designs",
      version: "1",
      effect: "read",
      capability: "designer.read",
      description:
        "List every design in this OpenPCB installation (id, name, revision, last updated). Use this to discover a designId when the user names a project that is not currently open.",
      inputSchema: { type: "object", properties: {} },
    },
    async execute(execCtx): Promise<AiToolResult<unknown>> {
      const designer = designerOf(ctx);
      if (!designer) return { ...NO_DESIGNER, limits: execCtx.limits };
      const designs = await designer.listDesigns();
      const activeDesignId = designer.getActiveDesignId();
      const rows = designs.map((d) => ({
        id: d.id,
        name: d.name,
        revision: d.revision,
        updatedAt: d.updatedAt,
        active: d.id === activeDesignId,
      }));
      return {
        ok: true,
        data: { designs: rows, activeDesignId },
        modelData: { designs: rows, activeDesignId },
        summary:
          rows.length === 0
            ? "No designs yet."
            : `${rows.length} design(s); active: ${activeDesignId ?? "none"}.`,
        sources: [],
        warnings: [],
        truncated: false,
        limits: execCtx.limits,
      };
    },
  };
}

function makeGetPcbStateTool(ctx: CoreBackendModuleContext): AiTool {
  return {
    definition: {
      name: "designer_get_pcb_state",
      version: "1",
      effect: "read",
      capability: "designer.read.pcb",
      description:
        "Summary of the PCB side of a design: board size/outline/layers, counts of placements, traces, vias and zones, unrouted ratsnest count, and the active net classes. Returns counts and settings, not full geometry — use designer_run_drc for violations.",
      inputSchema: DESIGN_INPUT_SCHEMA,
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const { designId } = (input ?? {}) as DesignInput;
      const designer = designerOf(ctx);
      if (!designer) return { ...NO_DESIGNER, limits: execCtx.limits };
      const pcb = designId ? await designer.getPcbProjection(designId) : null;
      if (!pcb) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: [missingDesign(designId)],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      const board = pcb.board;
      const state = {
        designId: pcb.designId,
        revision: pcb.revision,
        board: {
          // Every outline variant caches a bounding box, so this is the board
          // footprint regardless of shape (see PcbBoardOutline).
          widthMm: board.outline.widthMm,
          heightMm: board.outline.heightMm,
          outlineKind: board.outline.kind,
          layerCount: board.layerCount,
          activeLayer: board.activeLayer,
          visibleLayers: board.visibleLayers,
          boardThicknessMm: board.boardThicknessMm ?? 1.6,
          fabricator: board.fabricator,
        },
        counts: {
          placements: pcb.placements.length,
          traces: pcb.traces.length,
          vias: pcb.vias.length,
          zones: pcb.zones.length,
          keepouts: pcb.keepouts.length,
          freeHoles: pcb.freeHoles.length,
          freePads: pcb.freePads.length,
          unroutedConnections: pcb.ratsnest.length,
        },
        netClasses: board.netClasses?.map((nc) => ({
          id: nc.id,
          name: nc.name,
        })),
        warnings: pcb.warnings,
      };
      return {
        ok: true,
        data: state,
        modelData: state,
        summary: `PCB rev ${pcb.revision}: ${state.counts.placements} placements, ${state.counts.traces} traces, ${state.counts.unroutedConnections} unrouted.`,
        sources: [],
        warnings: pcb.warnings,
        truncated: false,
        limits: execCtx.limits,
      };
    },
  };
}

function makeRunErcTool(ctx: CoreBackendModuleContext): AiTool {
  return {
    definition: {
      name: "designer_run_erc",
      version: "1",
      effect: "read",
      capability: "designer.read.erc",
      description:
        "Run Electrical Rule Check over the schematic and return the violations (unconnected pins, conflicting drivers, missing power). Read-only — it computes from the current projection and persists nothing.",
      inputSchema: DESIGN_INPUT_SCHEMA,
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const { designId } = (input ?? {}) as DesignInput;
      const designer = designerOf(ctx);
      if (!designer) return { ...NO_DESIGNER, limits: execCtx.limits };
      const report = designId ? await designer.runErc(designId) : null;
      if (!report) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: [missingDesign(designId)],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      return {
        ok: true,
        data: report,
        modelData: report,
        summary: `ERC: ${report.violations.length} violation(s).`,
        sources: [],
        warnings: [],
        truncated: false,
        limits: execCtx.limits,
      };
    },
  };
}

function makeRunDrcTool(ctx: CoreBackendModuleContext): AiTool {
  return {
    definition: {
      name: "designer_run_drc",
      version: "1",
      effect: "read",
      capability: "designer.read.drc",
      description:
        "Run Design Rule Check over the PCB and return the violations (clearance, width, annular ring, unrouted nets). OpenPCB stays the authoritative DRC engine — always re-run this after applying layout changes rather than trusting an external calculation.",
      inputSchema: DESIGN_INPUT_SCHEMA,
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const { designId } = (input ?? {}) as DesignInput;
      const designer = designerOf(ctx);
      if (!designer) return { ...NO_DESIGNER, limits: execCtx.limits };
      const report = designId ? await designer.runDrc(designId) : null;
      if (!report) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: [missingDesign(designId)],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      return {
        ok: true,
        data: report,
        modelData: report,
        summary: `DRC: ${report.violations.length} violation(s).`,
        sources: [],
        warnings: [],
        truncated: false,
        limits: execCtx.limits,
      };
    },
  };
}

function makeGetBomTool(ctx: CoreBackendModuleContext): AiTool {
  return {
    definition: {
      name: "designer_get_bom",
      version: "1",
      effect: "read",
      capability: "designer.read.bom",
      description:
        "Bill of materials for a design: grouped lines with reference designators, value, footprint, quantity and MPN, plus a summary of unique/total parts and unresolved rows.",
      inputSchema: DESIGN_INPUT_SCHEMA,
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const { designId } = (input ?? {}) as DesignInput;
      const designer = designerOf(ctx);
      if (!designer) return { ...NO_DESIGNER, limits: execCtx.limits };
      const bom = designId ? await designer.getBomProjection(designId) : null;
      if (!bom) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: [missingDesign(designId)],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      return {
        ok: true,
        data: bom,
        modelData: bom,
        summary: `BOM rev ${bom.revision}: ${bom.rows.length} line(s).`,
        sources: [],
        warnings: bom.warnings,
        truncated: false,
        limits: execCtx.limits,
      };
    },
  };
}

function makeExportManufacturingTool(ctx: CoreBackendModuleContext): AiTool {
  return {
    definition: {
      name: "designer_export_manufacturing",
      version: "1",
      effect: "read",
      capability: "designer.read.export",
      description:
        "Generate the manufacturing bundle (Gerbers, Excellon drills, optional BOM and pick-and-place) and return its manifest: bundle name, per-file names and byte sizes, and any preflight warnings. File contents are NOT returned — read the openpcb://design/{id}/export/gerber resource for the ZIP.",
      inputSchema: {
        type: "object",
        properties: {
          ...DESIGN_INPUT_SCHEMA.properties,
          includeBom: { type: "boolean" },
          includePickAndPlace: { type: "boolean" },
          includeInnerLayers: { type: "boolean" },
        },
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = (input ?? {}) as DesignInput & {
        includeBom?: boolean;
        includePickAndPlace?: boolean;
        includeInnerLayers?: boolean;
      };
      const designer = designerOf(ctx);
      if (!designer) return { ...NO_DESIGNER, limits: execCtx.limits };
      let summary: Awaited<
        ReturnType<DesignerSDK["getManufacturingExportSummary"]>
      > | null = null;
      try {
        summary = args.designId
          ? await designer.getManufacturingExportSummary(args.designId, {
              includeBom: args.includeBom,
              includePickAndPlace: args.includePickAndPlace,
              includeInnerLayers: args.includeInnerLayers,
            })
          : null;
      } catch (error) {
        // The export REFUSES a board it cannot manufacture faithfully (422:
        // non-through vias, more than four copper layers). That is an answer
        // about the design, not a tool failure.
        const refusal = exportRefusalMessage(error);
        if (refusal === null) throw error;
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: [refusal],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      if (!summary) {
        return {
          ok: false,
          data: null,
          sources: [],
          warnings: [missingDesign(args.designId)],
          truncated: false,
          limits: execCtx.limits,
        };
      }
      return {
        ok: true,
        data: summary,
        modelData: summary,
        summary: `Export '${summary.bundleName}': ${summary.files.length} file(s), ${summary.warnings.length} warning(s).`,
        sources: [],
        warnings: summary.warnings,
        truncated: false,
        limits: execCtx.limits,
      };
    },
  };
}

export function registerExtendedReadTools(
  registry: AiToolRegistry,
  ctx: CoreBackendModuleContext,
): void {
  registry.register(makeListDesignsTool(ctx));
  registry.register(makeGetPcbStateTool(ctx));
  registry.register(makeRunErcTool(ctx));
  registry.register(makeRunDrcTool(ctx));
  registry.register(makeGetBomTool(ctx));
  registry.register(makeExportManufacturingTool(ctx));
}
