import type {
  AiJsonSchemaObject,
  AiSourceRef,
  AiTool,
  AiToolExecutionContext,
  AiToolRegistry,
  AiToolResult,
} from "@openpcb/ai-core";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import {
  DRC_RULE_CLASSES,
  MODULE_SDK_TOKENS,
  type DesignerCommandEnvelope,
  type DrcRuleClass,
  type DesignerPcbProjection,
  type DesignerSDK,
  type PcbBoardOutline,
  type PcbCopperLayerId,
  type PcbKeepoutRestrictions,
  type PcbNetClass,
  type PcbPlacedPart,
  type PcbZonePadConnection,
} from "../../../../sdks";
import {
  padWorldPositionMm,
  placementPads,
} from "../../../../shared/pcb-geometry/pad-geometry";
import { buildTracePathThroughAnchors } from "../../../../shared/pcb-geometry/pcb-trace-geometry";
import { resolveNetClassId } from "../../../../shared/pcb-areas/net-class-resolver";
import { NON_OVERRIDABLE } from "../../../../shared/drc/severity";
import type { ContextResolver } from "../context-resolver";
import type { ConversationStore } from "../conversation-store";
import {
  dedupByActionId,
  finalizeAndMaybeApply,
  mcpActorOf,
  resolveDesignForTool,
  type DesignerToolOptions,
  type SchematicProposalEnvelope,
} from "./designer-tools";
import { drcCounts, drcCountsLine } from "./drc-counts";

/**
 * PCB tools for MCP clients (Claude Code).
 *
 * The in-app assistant is schematic-only; none of the ~40 `pcb_*` designer
 * commands had a tool. These close that gap for external agents, MCP-only
 * (CLAUDE.md: the in-app registry's prompt and DoD harness are tuned against
 * its current set).
 *
 * Conventions every tool here follows:
 * - **Millimetres** at the tool boundary; trace geometry is converted to the
 *   integer nanometres the store persists (`NM_PER_MM`), never floats.
 * - **Stable addressing.** Parts by reference designator; pads as `REF.PAD`
 *   (resolved to `${placement.id}|${pad.number}`); nets by NAME, resolved to
 *   the ephemeral net id from a fresh projection immediately before the
 *   proposal is built (`designer/AGENTS.md`: net ids change on edits).
 * - **Through the proposal system** (`finalizeAndMaybeApply`): every write is
 *   persisted, renders as a card in the design chat, dedupes on `action_id`,
 *   auto-applies under the session policy (undoable), and — for deletions and
 *   non-undoable rule changes — waits for the user's approval.
 * - Copper commits use `legality: "refuse"`: an illegal route is rejected with
 *   `PCB_COPPER_ILLEGAL` instead of landing a DRC violation.
 * - No manufacturing constants are invented here: widths, clearances and via
 *   sizes default from the design's own net classes and rules.
 */

const NM_PER_MM = 1_000_000;

// ─── shared helpers ────────────────────────────────────────────────────

type Limits = AiToolResult["limits"];

function failed(message: string, limits: Limits): AiToolResult<null> {
  return {
    ok: false,
    data: null,
    summary: message,
    sources: [],
    warnings: [message],
    truncated: false,
    limits,
  };
}

function round(value: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function designerOf(ctx: CoreBackendModuleContext): DesignerSDK | undefined {
  return ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER) ?? undefined;
}

interface PcbTarget {
  designer: DesignerSDK;
  designId: string;
  pcb: DesignerPcbProjection;
}

async function loadTarget(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  execCtx: AiToolExecutionContext,
  requestedDesignId: string | undefined,
): Promise<PcbTarget | string> {
  const designer = designerOf(ctx);
  if (!designer) return "Designer module is not available.";
  const resolved = resolveDesignForTool({
    chatId: execCtx.chatId,
    requestedDesignId,
    contextResolver,
  });
  if (!resolved.ok) return resolved.warning;
  const pcb = await designer.getPcbProjection(resolved.designId);
  if (!pcb) return `Design '${resolved.designId}' has no PCB.`;
  return { designer, designId: resolved.designId, pcb };
}

/** Case-insensitive net name → current net id. */
function netIdByName(pcb: DesignerPcbProjection, name: string): string | null {
  const wanted = name.trim().toUpperCase();
  for (const [id, netName] of Object.entries(pcb.netNames)) {
    if (netName.trim().toUpperCase() === wanted) return id;
  }
  return null;
}

function netNameOf(pcb: DesignerPcbProjection, netId: string | null | undefined): string | null {
  if (!netId) return null;
  return pcb.netNames[netId] ?? null;
}

function placementByRef(pcb: DesignerPcbProjection, ref: string): PcbPlacedPart | null {
  const wanted = ref.trim().toUpperCase();
  return pcb.placements.find((p) => p.reference.toUpperCase() === wanted) ?? null;
}

interface ResolvedPad {
  placement: PcbPlacedPart;
  padNumber: string;
  positionMm: { x: number; y: number };
  netId: string | null;
}

/** `"U1.3"` → the pad's world position and net. Pad numbers may contain dots, so split on the first. */
function resolvePad(pcb: DesignerPcbProjection, address: string): ResolvedPad | string {
  const dot = address.indexOf(".");
  if (dot <= 0) return `Pad '${address}' must be REF.PAD, e.g. "U1.3".`;
  const ref = address.slice(0, dot);
  const padNumber = address.slice(dot + 1);
  const placement = placementByRef(pcb, ref);
  if (!placement) return `No footprint '${ref}' on the board.`;
  const pad = placementPads(placement).find((p) => p.number === padNumber);
  if (!pad) return `Footprint ${placement.reference} has no pad '${padNumber}'.`;
  return {
    placement,
    padNumber,
    positionMm: padWorldPositionMm(placement, pad),
    netId: pcb.padNets?.[`${placement.id}|${padNumber}`] ?? null,
  };
}

function padAddressOf(pcb: DesignerPcbProjection, placementId: string, padNumber: string): string {
  const placement = pcb.placements.find((p) => p.id === placementId);
  return `${placement?.reference ?? placementId}.${padNumber}`;
}

function sourceFor(designId: string, label: string): AiSourceRef[] {
  return [{ id: `design_${designId}`, kind: "pcb", refId: designId, label }];
}

type Risk = SchematicProposalEnvelope["riskLevel"];

interface ProposeInput {
  conversation: ConversationStore;
  options: DesignerToolOptions;
  execCtx: AiToolExecutionContext;
  target: PcbTarget;
  kind: SchematicProposalEnvelope["kind"];
  toolName: SchematicProposalEnvelope["toolName"];
  title: string;
  summary: string;
  riskLevel: Risk;
  actionId?: string;
  operations: Array<{ title: string; payload: DesignerCommandEnvelope["command"] }>;
  warnings?: string[];
}

/**
 * Persist the operations as a write proposal and let the session policy decide
 * whether it applies now (undoable edits) or waits for the user (deletions,
 * non-undoable rule changes). After an applied copper change, attach the DRC
 * picture so the agent sees what its edit did.
 */
async function propose(input: ProposeInput): Promise<AiToolResult<unknown>> {
  const { execCtx, target } = input;
  const chatId = execCtx.chatId;
  if (!chatId) return failed("Chat context missing.", execCtx.limits);
  if (input.operations.length === 0) {
    return failed("Nothing to do: no operations were built.", execCtx.limits);
  }
  if (input.actionId !== undefined && !ACTION_ID_FORMAT.test(input.actionId)) {
    return failed(
      "action_id may only contain letters, digits and . _ : - (1–200 characters).",
      execCtx.limits,
    );
  }
  if (input.actionId) {
    const dup = dedupByActionId(
      input.conversation,
      chatId,
      target.designId,
      input.actionId,
      execCtx.limits,
      mcpActorOf(execCtx),
    );
    if (dup) return dup as AiToolResult<unknown>;
  }
  const design = await target.designer.getDesign(target.designId);
  if (!design) return failed(`Design '${target.designId}' not found.`, execCtx.limits);
  const proposalId = crypto.randomUUID();
  const sources = sourceFor(target.designId, design.head.name);
  const envelope: SchematicProposalEnvelope = {
    id: proposalId,
    kind: input.kind,
    toolName: input.toolName,
    ...(input.actionId ? { actionId: input.actionId } : {}),
    title: input.title,
    summary: input.summary,
    riskLevel: input.riskLevel,
    designId: target.designId,
    baseRevision: design.head.revision,
    operations: input.operations.map((op, index) => ({
      id: `${proposalId}:${input.kind}:${index}`,
      kind: op.payload.type,
      title: op.title,
      summary: op.title,
      riskLevel: input.riskLevel,
      payload: op.payload,
      sources,
      warnings: [],
    })),
    payload: null,
    sources,
    warnings: input.warnings ?? [],
  };
  const result = await finalizeAndMaybeApply({
    designer: target.designer,
    conversation: input.conversation,
    actor: mcpActorOf(execCtx),
    chatId,
    designId: target.designId,
    baseRevision: design.head.revision,
    envelope,
    warnings: input.warnings ?? [],
    sources,
    limits: execCtx.limits,
    options: input.options,
  });
  const record = input.conversation.getWriteProposal(chatId, proposalId);
  const applied = record?.status === "applied" || record?.status === "partial";
  if (applied && input.kind !== "designer_pcb_rules_edits") {
    const drc = await target.designer.runDrc(target.designId).catch(() => null);
    if (drc) {
      const counts = drcCounts(drc);
      const after = await target.designer.getDesign(target.designId);
      result.modelData = {
        ...(result.modelData as Record<string, unknown>),
        revision: after?.head.revision ?? null,
        drc: counts,
      };
      result.summary = `${result.summary ?? ""} Now: ${drcCountsLine(counts)}`.trim();
    }
  }
  return result as AiToolResult<unknown>;
}

const ACTION_ID: AiJsonSchemaObject = {
  type: "string",
  minLength: 1,
  maxLength: 200,
  description:
    "Stable idempotency key you choose (letters, digits, . _ : -), e.g. `route_VCC_<designId>`. Re-sending it returns the earlier result instead of acting twice; after a rejection or failure, use a new one.",
};

/** Same alphabet the description promises; checked in code (the schema type has no `pattern`). */
const ACTION_ID_FORMAT = /^[A-Za-z0-9._:-]{1,200}$/;

const DESIGN_ID: AiJsonSchemaObject = {
  type: "string",
  description: "Target design. Omit to use the pinned or focused design.",
};

const POINT_MM: AiJsonSchemaObject = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
};

const COPPER_LAYER: AiJsonSchemaObject = {
  type: "string",
  description: 'Copper layer, e.g. "F.Cu", "B.Cu", "In1.Cu".',
};

// ─── read: layout ──────────────────────────────────────────────────────

function netClassSummary(nc: PcbNetClass) {
  return {
    id: nc.id,
    name: nc.name,
    traceWidthMm: nc.traceWidthMm,
    clearanceMm: nc.clearanceMm,
    viaDiameterMm: nc.viaDiameterMm,
    viaDrillMm: nc.viaDrillMm,
  };
}

function makeGetLayoutTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
): AiTool {
  return {
    definition: {
      name: "designer_get_pcb_layout",
      version: "1",
      effect: "read",
      capability: "designer.read.pcb",
      description:
        "PCB geometry for placement and routing: board outline and rules, net classes, footprints (ref, position, rotation, side) with pad positions and nets, per-net copper (traces, vias), unrouted connections as pad pairs (REF.PAD), zones and keepouts. All coordinates in mm. Filter with refs / nets; detail 'summary' omits pads and copper. Read this before pcb_place_footprints or pcb_route.",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          detail: { type: "string", enum: ["summary", "full"] },
          refs: { type: "array", items: { type: "string" }, maxItems: 200 },
          nets: { type: "array", items: { type: "string" }, maxItems: 200 },
        },
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = (input ?? {}) as {
        designId?: string;
        detail?: "summary" | "full";
        refs?: string[];
        nets?: string[];
      };
      const target = await loadTarget(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const { pcb } = target;
      const full = args.detail !== "summary";
      const refFilter = args.refs?.length
        ? new Set(args.refs.map((r) => r.toUpperCase()))
        : null;
      const netFilter = args.nets?.length
        ? new Set(args.nets.map((n) => n.toUpperCase()))
        : null;
      const netWanted = (netId: string | null | undefined) => {
        if (!netFilter) return true;
        const name = netNameOf(pcb, netId);
        return name !== null && netFilter.has(name.toUpperCase());
      };

      const placements = pcb.placements
        .filter((p) => !refFilter || refFilter.has(p.reference.toUpperCase()))
        .map((p) => ({
          ref: p.reference,
          placementId: p.id,
          footprint: p.footprint.name,
          positionMm: { x: round(p.positionMm.x), y: round(p.positionMm.y) },
          rotationDeg: p.rotationDeg,
          side: p.layer === "B.Cu" ? "bottom" : "top",
          ...(full
            ? {
                pads: placementPads(p).map((pad) => {
                  const pos = padWorldPositionMm(p, pad);
                  return {
                    pad: pad.number,
                    net: netNameOf(pcb, pcb.padNets?.[`${p.id}|${pad.number}`]),
                    xMm: round(pos.x),
                    yMm: round(pos.y),
                    widthMm: pad.widthMm,
                    heightMm: pad.heightMm,
                    shape: pad.shape,
                    drilled: (pad.drillDiameterMm ?? 0) > 0,
                  };
                }),
              }
            : {}),
        }));

      const nets = Object.entries(pcb.netNames)
        .filter(([id]) => netWanted(id))
        .map(([id, name]) => {
          const pads = Object.entries(pcb.padNets ?? {})
            .filter(([, netId]) => netId === id)
            .map(([key]) => {
              const [placementId, padNumber] = key.split("|");
              return padAddressOf(pcb, placementId!, padNumber!);
            });
          return {
            name,
            netClass: resolveNetClassId(
              name,
              pcb.board.netClasses,
              pcb.board.perNetClassAssignments,
              id,
            ),
            pads,
            traces: pcb.traces.filter((t) => t.netId === id).length,
            vias: pcb.vias.filter((v) => v.netId === id).length,
            unrouted: pcb.ratsnest.filter((r) => r.netId === id).length,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const endpoint = (e: (typeof pcb.ratsnest)[number]["from"]) =>
        e.kind === "pad" ? padAddressOf(pcb, e.placementId, e.padNumber) : `freePad:${e.freePadId}`;
      const unrouted = pcb.ratsnest
        .filter((r) => netWanted(r.netId))
        .map((r) => ({
          net: netNameOf(pcb, r.netId),
          from: endpoint(r.from),
          to: endpoint(r.to),
          fromMm: { x: round(r.fromMm.x), y: round(r.fromMm.y) },
          toMm: { x: round(r.toMm.x), y: round(r.toMm.y) },
        }));

      const board = pcb.board;
      const data: Record<string, unknown> = {
        designId: pcb.designId,
        revision: pcb.revision,
        board: {
          outline: {
            kind: board.outline.kind,
            widthMm: board.outline.widthMm,
            heightMm: board.outline.heightMm,
            centerMm: board.outline.centerMm,
          },
          layerCount: board.layerCount,
          fabricator: board.fabricator,
          boardThicknessMm: board.boardThicknessMm ?? null,
          clearanceMm: board.designRules.clearance,
          netClasses: board.netClasses.map(netClassSummary),
        },
        placements,
        nets,
        unrouted,
        zones: pcb.zones.map((z) => ({
          id: z.id,
          name: z.name ?? null,
          layer: z.layer,
          net: z.netName ?? netNameOf(pcb, z.netId),
          region: z.region.kind,
        })),
        keepouts: pcb.keepouts.map((k) => ({
          id: k.id,
          name: k.name ?? null,
          layers: k.layers,
        })),
      };
      if (full) {
        data.traces = pcb.traces
          .filter((t) => netWanted(t.netId))
          .map((t) => ({
            id: t.id,
            net: netNameOf(pcb, t.netId),
            layer: t.layer,
            widthMm: t.widthMm,
            pointsMm: t.pointsNm.map((pt) => ({
              x: round(pt.x / NM_PER_MM),
              y: round(pt.y / NM_PER_MM),
            })),
          }));
        data.vias = pcb.vias
          .filter((v) => netWanted(v.netId))
          .map((v) => ({
            id: v.id,
            net: netNameOf(pcb, v.netId),
            xMm: round(v.centerMm.x),
            yMm: round(v.centerMm.y),
            diameterMm: v.diameterMm,
            drillMm: v.drillMm,
          }));
      }
      return {
        ok: true,
        data,
        summary: `PCB rev ${pcb.revision}: ${pcb.placements.length} footprint(s), ${pcb.traces.length} trace(s), ${pcb.vias.length} via(s), ${pcb.ratsnest.length} unrouted connection(s).`,
        sources: sourceFor(pcb.designId, "PCB layout"),
        warnings: pcb.warnings.slice(0, 10),
        truncated: false,
        limits: execCtx.limits,
      };
    },
  };
}

// ─── write: placement ──────────────────────────────────────────────────

interface PlaceInput {
  designId?: string;
  action_id?: string;
  placements: Array<{
    ref: string;
    xMm?: number;
    yMm?: number;
    rotationDeg?: number;
    side?: "top" | "bottom";
  }>;
}

function makePlaceTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions,
): AiTool {
  return {
    definition: {
      name: "pcb_place_footprints",
      version: "1",
      effect: "write",
      capability: "designer.write.pcb.place",
      description:
        "Move, rotate and/or flip footprints on the PCB, by reference designator. Positions are the footprint origin in board mm; rotation is 0/90/180/270; side 'bottom' flips to B.Cu. Applies at once (undoable in OpenPCB) and reports the DRC count afterwards.",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          action_id: ACTION_ID,
          placements: {
            type: "array",
            minItems: 1,
            maxItems: 200,
            items: {
              type: "object",
              properties: {
                ref: { type: "string" },
                xMm: { type: "number" },
                yMm: { type: "number" },
                rotationDeg: { type: "number", enum: [0, 90, 180, 270] },
                side: { type: "string", enum: ["top", "bottom"] },
              },
              required: ["ref"],
            },
          },
        },
        required: ["placements"],
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = input as PlaceInput;
      const target = await loadTarget(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const { pcb } = target;
      const moves: Array<{ placementId: string; positionMm: { x: number; y: number } }> = [];
      const operations: ProposeInput["operations"] = [];
      const warnings: string[] = [];
      const flips: string[] = [];
      for (const entry of args.placements) {
        const placement = placementByRef(pcb, entry.ref);
        if (!placement) {
          warnings.push(`No footprint '${entry.ref}' on the board; skipped.`);
          continue;
        }
        if (entry.xMm !== undefined || entry.yMm !== undefined) {
          moves.push({
            placementId: placement.id,
            positionMm: {
              x: entry.xMm ?? placement.positionMm.x,
              y: entry.yMm ?? placement.positionMm.y,
            },
          });
        }
        if (entry.side) {
          const onBottom = placement.layer === "B.Cu";
          if ((entry.side === "bottom") !== onBottom) flips.push(placement.id);
        }
        if (entry.rotationDeg !== undefined && entry.rotationDeg !== placement.rotationDeg) {
          operations.push({
            title: `Rotate ${placement.reference} to ${entry.rotationDeg}°`,
            payload: {
              type: "pcb_rotate_placement",
              placementId: placement.id,
              rotationDeg: entry.rotationDeg as 0 | 90 | 180 | 270,
            },
          });
        }
      }
      if (moves.length > 0) {
        operations.unshift({
          title: `Move ${moves.length} footprint(s)`,
          payload: { type: "pcb_move_placements", updates: moves },
        });
      }
      if (flips.length > 0) {
        operations.push({
          title: `Flip ${flips.length} footprint(s)`,
          payload: { type: "pcb_flip_placements", placementIds: flips },
        });
      }
      if (operations.length === 0) {
        return failed(
          warnings[0] ?? "Nothing changes: the footprints are already there.",
          execCtx.limits,
        );
      }
      return propose({
        conversation,
        options,
        execCtx,
        target,
        kind: "designer_pcb_place_batch",
        toolName: "pcb_place_footprints",
        title: "Place footprints",
        summary: `Place ${args.placements.length} footprint(s)`,
        riskLevel: "medium",
        actionId: args.action_id,
        operations,
        warnings,
      });
    },
  };
}

// ─── write: routing ────────────────────────────────────────────────────

interface RouteInput {
  designId?: string;
  action_id?: string;
  traces?: Array<{
    net: string;
    layer: string;
    widthMm?: number;
    from?: string;
    to?: string;
    waypointsMm?: Array<{ x: number; y: number }>;
  }>;
  vias?: Array<{ net: string; xMm: number; yMm: number }>;
}

function makeRouteTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions,
): AiTool {
  return {
    definition: {
      name: "pcb_route",
      version: "1",
      effect: "write",
      capability: "designer.write.pcb.route",
      description:
        "Commit copper for named nets as ONE atomic, undoable change: traces (from a pad REF.PAD, through optional waypoints in mm, to a pad) and vias. Waypoints are joined with 45°/90° elbows like the interactive router. Width and via size default to the net's class. Both end pads must be on the named net. OpenPCB refuses copper that would violate DRC (PCB_COPPER_ILLEGAL) — then adjust the path. Read designer_get_pcb_layout first.",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          action_id: ACTION_ID,
          traces: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              properties: {
                net: { type: "string", description: "Net name, e.g. GND or VCC." },
                layer: COPPER_LAYER,
                widthMm: { type: "number", minimum: 0 },
                from: { type: "string", description: 'Start pad, e.g. "U1.3".' },
                to: { type: "string", description: 'End pad, e.g. "R1.1".' },
                waypointsMm: { type: "array", items: POINT_MM, maxItems: 100 },
              },
              required: ["net", "layer"],
            },
          },
          vias: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              properties: {
                net: { type: "string" },
                xMm: { type: "number" },
                yMm: { type: "number" },
              },
              required: ["net", "xMm", "yMm"],
            },
          },
        },
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = input as RouteInput;
      const target = await loadTarget(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const { pcb } = target;
      const board = pcb.board;
      const classFor = (netId: string, name: string): PcbNetClass | null => {
        const id = resolveNetClassId(name, board.netClasses, board.perNetClassAssignments, netId);
        return board.netClasses.find((c) => c.id === id) ?? board.netClasses[0] ?? null;
      };

      const traces: Array<Extract<DesignerCommandEnvelope["command"], { type: "pcb_commit_route" }>["traces"][number]> = [];
      for (const [index, t] of (args.traces ?? []).entries()) {
        const label = `trace ${index + 1} (${t.net})`;
        const netId = netIdByName(pcb, t.net);
        if (!netId) return failed(`${label}: no net named '${t.net}'.`, execCtx.limits);
        const anchorsMm: Array<{ x: number; y: number }> = [];
        for (const [end, address] of [["from", t.from], ["to", t.to]] as const) {
          if (!address) continue;
          const pad = resolvePad(pcb, address);
          if (typeof pad === "string") return failed(`${label}: ${pad}`, execCtx.limits);
          if (pad.netId !== netId) {
            return failed(
              `${label}: pad ${address} is on net ${netNameOf(pcb, pad.netId) ?? "(none)"}, not ${t.net}.`,
              execCtx.limits,
            );
          }
          if (end === "from") anchorsMm.unshift(pad.positionMm);
          else anchorsMm.push(pad.positionMm);
        }
        const middle = t.waypointsMm ?? [];
        const ordered = [
          ...(t.from ? [anchorsMm[0]!] : []),
          ...middle,
          ...(t.to ? [anchorsMm[anchorsMm.length - 1]!] : []),
        ];
        if (ordered.length < 2) {
          return failed(`${label}: give from/to pads and/or at least two waypoints.`, execCtx.limits);
        }
        const netClass = classFor(netId, t.net);
        if (!netClass) return failed("The board has no net classes.", execCtx.limits);
        const anchorsNm = ordered.map((p) => ({
          x: Math.round(p.x * NM_PER_MM),
          y: Math.round(p.y * NM_PER_MM),
        }));
        const pointsNm = buildTracePathThroughAnchors(anchorsNm, "manhattan-45").map((p) => ({
          x: Math.round(p.x),
          y: Math.round(p.y),
        }));
        traces.push({
          layer: t.layer as PcbCopperLayerId,
          pointsNm,
          widthMm: t.widthMm ?? netClass.traceWidthMm,
          netId,
          netClassId: netClass.id,
          segmentMode: "manhattan-45",
        });
      }

      const vias: Array<Extract<DesignerCommandEnvelope["command"], { type: "pcb_commit_route" }>["vias"][number]> = [];
      for (const [index, v] of (args.vias ?? []).entries()) {
        const netId = netIdByName(pcb, v.net);
        if (!netId) return failed(`via ${index + 1}: no net named '${v.net}'.`, execCtx.limits);
        const netClass = classFor(netId, v.net);
        if (!netClass) return failed("The board has no net classes.", execCtx.limits);
        vias.push({ centerMm: { x: v.xMm, y: v.yMm }, netId, netClassId: netClass.id });
      }

      if (traces.length === 0 && vias.length === 0) {
        return failed("Give at least one trace or via.", execCtx.limits);
      }
      const nets = [...new Set([...(args.traces ?? []), ...(args.vias ?? [])].map((x) => x.net))];
      return propose({
        conversation,
        options,
        execCtx,
        target,
        kind: "designer_pcb_route_batch",
        toolName: "pcb_route",
        title: `Route ${nets.join(", ")}`,
        summary: `${traces.length} trace(s), ${vias.length} via(s)`,
        riskLevel: "medium",
        actionId: args.action_id,
        operations: [
          {
            title: `Route ${nets.join(", ")}: ${traces.length} trace(s), ${vias.length} via(s)`,
            payload: { type: "pcb_commit_route", traces, vias, legality: "refuse" },
          },
        ],
      });
    },
  };
}

function makeDeleteRoutingTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions,
): AiTool {
  return {
    definition: {
      name: "pcb_delete_routing",
      version: "1",
      effect: "write",
      capability: "designer.write.pcb.delete",
      description:
        "Delete traces and vias — by id (from designer_get_pcb_layout) and/or every trace and via of named nets. Destructive: it waits for the user's approval in OpenPCB (then call assistant_await_proposal).",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          action_id: ACTION_ID,
          traceIds: { type: "array", items: { type: "string" }, maxItems: 500 },
          viaIds: { type: "array", items: { type: "string" }, maxItems: 500 },
          nets: { type: "array", items: { type: "string" }, maxItems: 50 },
        },
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = (input ?? {}) as {
        designId?: string;
        action_id?: string;
        traceIds?: string[];
        viaIds?: string[];
        nets?: string[];
      };
      const target = await loadTarget(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const { pcb } = target;
      const traceIds = new Set(args.traceIds ?? []);
      const viaIds = new Set(args.viaIds ?? []);
      const warnings: string[] = [];
      for (const name of args.nets ?? []) {
        const netId = netIdByName(pcb, name);
        if (!netId) {
          warnings.push(`No net named '${name}'.`);
          continue;
        }
        for (const t of pcb.traces) if (t.netId === netId) traceIds.add(t.id);
        for (const v of pcb.vias) if (v.netId === netId) viaIds.add(v.id);
      }
      const known = (ids: Set<string>, pool: Array<{ id: string }>) =>
        [...ids].filter((id) => pool.some((x) => x.id === id));
      const traces = known(traceIds, pcb.traces);
      const vias = known(viaIds, pcb.vias);
      if (traces.length + vias.length === 0) {
        return failed(warnings[0] ?? "No matching traces or vias.", execCtx.limits);
      }
      return propose({
        conversation,
        options,
        execCtx,
        target,
        kind: "designer_pcb_deletions",
        toolName: "pcb_delete_routing",
        title: "Delete routing",
        summary: `Delete ${traces.length} trace(s) and ${vias.length} via(s)`,
        riskLevel: "destructive",
        actionId: args.action_id,
        operations: [
          ...traces.map((traceId) => ({
            title: `Delete trace ${traceId}`,
            payload: { type: "pcb_delete_trace" as const, traceId },
          })),
          ...vias.map((viaId) => ({
            title: `Delete via ${viaId}`,
            payload: { type: "pcb_delete_via" as const, viaId },
          })),
        ],
        // Warnings keep a destructive proposal pending; unknown nets are
        // informational here, so report them in the summary instead.
      });
    },
  };
}

// ─── write: board + rules ──────────────────────────────────────────────

function bbox(points: Array<{ x: number; y: number }>) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    centerMm: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

function makeBoardOutlineTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions,
): AiTool {
  return {
    definition: {
      name: "pcb_set_board_outline",
      version: "1",
      effect: "write",
      capability: "designer.write.pcb.board",
      description:
        "Set the board outline: shape 'rect' / 'roundrect' / 'circle' from widthMm × heightMm (+ cornerRadiusMm) around centerMm, or 'polygon' from pointsMm. Existing cutouts are kept. Undoable.",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          action_id: ACTION_ID,
          shape: { type: "string", enum: ["rect", "roundrect", "circle", "polygon"] },
          widthMm: { type: "number", minimum: 0 },
          heightMm: { type: "number", minimum: 0 },
          centerMm: POINT_MM,
          cornerRadiusMm: { type: "number", minimum: 0 },
          pointsMm: { type: "array", items: POINT_MM, minItems: 3, maxItems: 500 },
        },
        required: ["shape"],
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = input as {
        designId?: string;
        action_id?: string;
        shape: "rect" | "roundrect" | "circle" | "polygon";
        widthMm?: number;
        heightMm?: number;
        centerMm?: { x: number; y: number };
        cornerRadiusMm?: number;
        pointsMm?: Array<{ x: number; y: number }>;
      };
      const target = await loadTarget(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const current = target.pcb.board.outline;
      let outline: PcbBoardOutline;
      if (args.shape === "polygon") {
        if (!args.pointsMm || args.pointsMm.length < 3) {
          return failed("A polygon outline needs at least 3 pointsMm.", execCtx.limits);
        }
        outline = { kind: "polygon", pointsMm: args.pointsMm, ...bbox(args.pointsMm) };
      } else {
        if (!args.widthMm || !args.heightMm) {
          return failed(`A ${args.shape} outline needs widthMm and heightMm.`, execCtx.limits);
        }
        const base = {
          widthMm: args.widthMm,
          heightMm: args.heightMm,
          centerMm: args.centerMm ?? current.centerMm,
        };
        outline =
          args.shape === "roundrect"
            ? { kind: "roundrect", ...base, cornerRadiusMm: args.cornerRadiusMm ?? 1 }
            : args.shape === "circle"
              ? { kind: "circle", ...base }
              : { kind: "rect", ...base };
      }
      return propose({
        conversation,
        options,
        execCtx,
        target,
        kind: "designer_pcb_board_edits",
        toolName: "pcb_set_board_outline",
        title: "Set board outline",
        summary: `${args.shape} ${round(outline.widthMm, 3)} × ${round(outline.heightMm, 3)} mm`,
        riskLevel: "medium",
        actionId: args.action_id,
        operations: [
          { title: `Board outline: ${args.shape}`, payload: { type: "pcb_set_board_outline", outline } },
        ],
      });
    },
  };
}

interface RulesInput {
  designId?: string;
  action_id?: string;
  clearanceMm?: Partial<Record<
    "traceToTraceMm" | "traceToPadMm" | "padToPadMm" | "traceToViaMm" | "viaToViaMm" | "copperToBoardEdgeMm",
    number
  >>;
  netClasses?: Array<{
    id?: string;
    name: string;
    traceWidthMm?: number;
    clearanceMm?: number;
    viaDiameterMm?: number;
    viaDrillMm?: number;
  }>;
  netClassAssignments?: Array<{ net: string; netClass: string }>;
  boardThicknessMm?: number;
}

function slugId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "class";
}

function makeDesignRulesTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions,
): AiTool {
  return {
    definition: {
      name: "pcb_set_design_rules",
      version: "1",
      effect: "write",
      capability: "designer.write.pcb.rules",
      description:
        "Change board clearances, add or edit net classes (trace width, clearance, via size), assign nets to classes, or set board thickness. Only the fields you pass change. NOT undoable, so it always waits for the user's approval in OpenPCB (then call assistant_await_proposal). Use values the user or their fab specifies — never guess manufacturing limits. Class assignments are stored per current net id and must be redone if a net is renamed or re-created.",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          action_id: ACTION_ID,
          clearanceMm: {
            type: "object",
            properties: {
              traceToTraceMm: { type: "number", minimum: 0 },
              traceToPadMm: { type: "number", minimum: 0 },
              padToPadMm: { type: "number", minimum: 0 },
              traceToViaMm: { type: "number", minimum: 0 },
              viaToViaMm: { type: "number", minimum: 0 },
              copperToBoardEdgeMm: { type: "number", minimum: 0 },
            },
          },
          netClasses: {
            type: "array",
            maxItems: 50,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                traceWidthMm: { type: "number", minimum: 0 },
                clearanceMm: { type: "number", minimum: 0 },
                viaDiameterMm: { type: "number", minimum: 0 },
                viaDrillMm: { type: "number", minimum: 0 },
              },
              required: ["name"],
            },
          },
          netClassAssignments: {
            type: "array",
            maxItems: 500,
            items: {
              type: "object",
              properties: { net: { type: "string" }, netClass: { type: "string" } },
              required: ["net", "netClass"],
            },
          },
          boardThicknessMm: { type: "number", minimum: 0 },
        },
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = (input ?? {}) as RulesInput;
      const target = await loadTarget(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const board = target.pcb.board;
      const command: Extract<DesignerCommandEnvelope["command"], { type: "pcb_set_design_rules" }> = {
        type: "pcb_set_design_rules",
      };
      const changes: string[] = [];
      if (args.clearanceMm && Object.keys(args.clearanceMm).length > 0) {
        command.designRules = {
          ...board.designRules,
          clearance: { ...board.designRules.clearance, ...args.clearanceMm },
        };
        changes.push(`clearances (${Object.keys(args.clearanceMm).join(", ")})`);
      }
      let classes = board.netClasses;
      if (args.netClasses?.length) {
        const template = board.netClasses[0];
        if (!template) return failed("The board has no net classes to extend.", execCtx.limits);
        classes = [...board.netClasses];
        for (const patch of args.netClasses) {
          const index = classes.findIndex(
            (c) => (patch.id && c.id === patch.id) || c.name.toLowerCase() === patch.name.toLowerCase(),
          );
          if (index >= 0) {
            classes[index] = { ...classes[index]!, ...stripUndefined(patch), id: classes[index]!.id };
            changes.push(`net class ${classes[index]!.name}`);
          } else {
            const missing = (["traceWidthMm", "clearanceMm", "viaDiameterMm", "viaDrillMm"] as const).filter(
              (k) => patch[k] === undefined,
            );
            if (missing.length > 0) {
              return failed(
                `New net class '${patch.name}' needs ${missing.join(", ")} — give the values explicitly.`,
                execCtx.limits,
              );
            }
            classes.push({
              ...template,
              id: patch.id ?? slugId(patch.name),
              name: patch.name,
              traceWidthMm: patch.traceWidthMm!,
              clearanceMm: patch.clearanceMm!,
              viaDiameterMm: patch.viaDiameterMm!,
              viaDrillMm: patch.viaDrillMm!,
            });
            changes.push(`new net class ${patch.name}`);
          }
        }
        command.netClasses = classes;
      }
      if (args.netClassAssignments?.length) {
        const assignments = { ...(board.perNetClassAssignments ?? {}) };
        for (const { net, netClass } of args.netClassAssignments) {
          const netId = netIdByName(target.pcb, net);
          if (!netId) return failed(`No net named '${net}'.`, execCtx.limits);
          const cls = classes.find(
            (c) => c.id === netClass || c.name.toLowerCase() === netClass.toLowerCase(),
          );
          if (!cls) return failed(`No net class '${netClass}'.`, execCtx.limits);
          assignments[netId] = cls.id;
        }
        command.perNetClassAssignments = assignments;
        changes.push(`${args.netClassAssignments.length} net assignment(s)`);
      }
      if (args.boardThicknessMm !== undefined) {
        command.boardThicknessMm = args.boardThicknessMm;
        changes.push(`board thickness ${args.boardThicknessMm} mm`);
      }
      if (changes.length === 0) return failed("No rule changes given.", execCtx.limits);
      return propose({
        conversation,
        options,
        execCtx,
        target,
        kind: "designer_pcb_rules_edits",
        toolName: "pcb_set_design_rules",
        title: "Change design rules",
        summary: `Change ${changes.join("; ")} (not undoable)`,
        riskLevel: "high",
        actionId: args.action_id,
        operations: [{ title: `Design rules: ${changes.join("; ")}`, payload: command }],
      });
    },
  };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

// ─── write: zones, keepouts, waivers ───────────────────────────────────

function makeZoneTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions,
): AiTool {
  return {
    definition: {
      name: "pcb_manage_zone",
      version: "1",
      effect: "write",
      capability: "designer.write.pcb.zone",
      description:
        "Add, update or delete a copper zone (pour). A zone pours a named net on one copper layer over the whole board (region 'board') or a polygon (pointsMm). Add/update apply at once (undoable); delete waits for the user's approval.",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          action_id: ACTION_ID,
          action: { type: "string", enum: ["add", "update", "delete"] },
          zoneId: { type: "string", description: "Required for update/delete." },
          layer: COPPER_LAYER,
          net: { type: "string", description: "Net name to pour, e.g. GND." },
          region: { type: "string", enum: ["board", "polygon"] },
          pointsMm: { type: "array", items: POINT_MM, minItems: 3, maxItems: 500 },
          name: { type: "string" },
          priority: { type: "integer", minimum: 0 },
          padConnection: { type: "string", enum: ["solid", "thermal", "thruHoleThermal", "none"] },
          enabled: { type: "boolean" },
        },
        required: ["action"],
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = input as {
        designId?: string;
        action_id?: string;
        action: "add" | "update" | "delete";
        zoneId?: string;
        layer?: string;
        net?: string;
        region?: "board" | "polygon";
        pointsMm?: Array<{ x: number; y: number }>;
        name?: string;
        priority?: number;
        padConnection?: PcbZonePadConnection;
        enabled?: boolean;
      };
      const target = await loadTarget(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const region =
        args.region === "polygon"
          ? args.pointsMm && args.pointsMm.length >= 3
            ? { kind: "polygon" as const, pointsMm: args.pointsMm }
            : null
          : args.region === "board"
            ? { kind: "board" as const }
            : undefined;
      if (region === null) return failed("A polygon zone needs at least 3 pointsMm.", execCtx.limits);
      if (args.net && !netIdByName(target.pcb, args.net)) {
        return failed(`No net named '${args.net}'.`, execCtx.limits);
      }
      // Named nets persist by name and re-bind on every projection (zone contract).
      const netRef = args.net ? { netId: null, netName: args.net.trim().toUpperCase() } : undefined;
      const exists = (id?: string) => Boolean(id && target.pcb.zones.some((z) => z.id === id));

      let payload: DesignerCommandEnvelope["command"];
      if (args.action === "add") {
        if (!args.layer || !netRef || !region) {
          return failed("Adding a zone needs layer, net and region.", execCtx.limits);
        }
        payload = {
          type: "pcb_add_zone",
          layer: args.layer as PcbCopperLayerId,
          net: netRef,
          region,
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.priority !== undefined ? { priority: args.priority } : {}),
          ...(args.padConnection ? { padConnection: args.padConnection } : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        };
      } else if (args.action === "update") {
        if (!exists(args.zoneId)) return failed(`No zone '${args.zoneId ?? ""}'.`, execCtx.limits);
        payload = {
          type: "pcb_update_zone",
          zoneId: args.zoneId!,
          ...(args.layer ? { layer: args.layer as PcbCopperLayerId } : {}),
          ...(netRef ? { net: netRef } : {}),
          ...(region ? { region } : {}),
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.priority !== undefined ? { priority: args.priority } : {}),
          ...(args.padConnection ? { padConnection: args.padConnection } : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        };
      } else {
        if (!exists(args.zoneId)) return failed(`No zone '${args.zoneId ?? ""}'.`, execCtx.limits);
        payload = { type: "pcb_delete_zone", zoneId: args.zoneId! };
      }
      const destructive = args.action === "delete";
      return propose({
        conversation,
        options,
        execCtx,
        target,
        kind: destructive ? "designer_pcb_deletions" : "designer_pcb_board_edits",
        toolName: "pcb_manage_zone",
        title: `${args.action} zone`,
        summary: `${args.action} zone${args.net ? ` for ${args.net}` : ""}`,
        riskLevel: destructive ? "destructive" : "medium",
        actionId: args.action_id,
        operations: [{ title: `${args.action} zone`, payload }],
      });
    },
  };
}

function makeKeepoutTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions,
): AiTool {
  return {
    definition: {
      name: "pcb_manage_keepout",
      version: "1",
      effect: "write",
      capability: "designer.write.pcb.keepout",
      description:
        "Add, update or delete a keepout area (a polygon in mm on copper layers that forbids tracks / vias / pads / copper pour / footprints). Add/update apply at once (undoable); delete waits for the user's approval.",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          action_id: ACTION_ID,
          action: { type: "string", enum: ["add", "update", "delete"] },
          keepoutId: { type: "string" },
          layers: { type: "array", items: COPPER_LAYER, minItems: 1 },
          pointsMm: { type: "array", items: POINT_MM, minItems: 3, maxItems: 500 },
          forbid: {
            type: "array",
            items: { type: "string", enum: ["tracks", "vias", "pads", "copperPour", "footprints"] },
          },
          name: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["action"],
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = input as {
        designId?: string;
        action_id?: string;
        action: "add" | "update" | "delete";
        keepoutId?: string;
        layers?: string[];
        pointsMm?: Array<{ x: number; y: number }>;
        forbid?: Array<keyof PcbKeepoutRestrictions>;
        name?: string;
        enabled?: boolean;
      };
      const target = await loadTarget(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const restrictions = args.forbid
        ? {
            tracks: args.forbid.includes("tracks"),
            vias: args.forbid.includes("vias"),
            pads: args.forbid.includes("pads"),
            copperPour: args.forbid.includes("copperPour"),
            footprints: args.forbid.includes("footprints"),
          }
        : undefined;
      const exists = (id?: string) => Boolean(id && target.pcb.keepouts.some((k) => k.id === id));
      let payload: DesignerCommandEnvelope["command"];
      if (args.action === "add") {
        if (!args.layers?.length || !args.pointsMm || !restrictions) {
          return failed("Adding a keepout needs layers, pointsMm and forbid.", execCtx.limits);
        }
        payload = {
          type: "pcb_add_keepout",
          layers: args.layers as PcbCopperLayerId[],
          pointsMm: args.pointsMm,
          restrictions,
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        };
      } else if (args.action === "update") {
        if (!exists(args.keepoutId)) return failed(`No keepout '${args.keepoutId ?? ""}'.`, execCtx.limits);
        payload = {
          type: "pcb_update_keepout",
          keepoutId: args.keepoutId!,
          ...(args.layers ? { layers: args.layers as PcbCopperLayerId[] } : {}),
          ...(args.pointsMm ? { pointsMm: args.pointsMm } : {}),
          ...(restrictions ? { restrictions } : {}),
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        };
      } else {
        if (!exists(args.keepoutId)) return failed(`No keepout '${args.keepoutId ?? ""}'.`, execCtx.limits);
        payload = { type: "pcb_delete_keepout", keepoutId: args.keepoutId! };
      }
      const destructive = args.action === "delete";
      return propose({
        conversation,
        options,
        execCtx,
        target,
        kind: destructive ? "designer_pcb_deletions" : "designer_pcb_board_edits",
        toolName: "pcb_manage_keepout",
        title: `${args.action} keepout`,
        summary: `${args.action} keepout`,
        riskLevel: destructive ? "destructive" : "medium",
        actionId: args.action_id,
        operations: [{ title: `${args.action} keepout`, payload }],
      });
    },
  };
}

const REASON: AiJsonSchemaObject = {
  type: "string",
  minLength: 3,
  maxLength: 500,
  description:
    "Why, in the user's words — shown on the approval card. Required when waiving or ignoring.",
};

/**
 * Waive individual violations. A waiver acknowledges ONE known violation (it
 * stays listed with `waived: true` and leaves the error counts), so it is a
 * verification decision the user makes: waiving always waits for approval in
 * the panel. Only ids from the current report can be waived, never a
 * safety-critical code (NON_OVERRIDABLE — shorts, layer-invalid items…),
 * which DRC would ignore anyway. Un-waiving only restores checking, so it
 * applies at once.
 */
function makeWaiveViolationsTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions,
): AiTool {
  return {
    definition: {
      name: "pcb_waive_drc_violations",
      version: "1",
      effect: "write",
      capability: "designer.write.pcb.drc",
      description:
        "Waive (or un-waive) individual DRC violations by id from designer_run_drc. A waived violation stays listed but no longer counts. Waiving ALWAYS waits for the user's approval in OpenPCB (then assistant_await_proposal) and needs a reason; only do it when the user asked. Un-waiving applies at once. Safety-critical codes (shorts, layer-invalid items) cannot be waived.",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          action_id: ACTION_ID,
          waive: { type: "array", items: { type: "string" }, maxItems: 200 },
          unwaive: { type: "array", items: { type: "string" }, maxItems: 500 },
          reason: REASON,
        },
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = (input ?? {}) as {
        designId?: string;
        action_id?: string;
        waive?: string[];
        unwaive?: string[];
        reason?: string;
      };
      const target = await loadTarget(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const current = new Set(target.pcb.board.viewState?.drcWaivedViolationIds ?? []);
      const toWaive = [...new Set(args.waive ?? [])].filter((id) => !current.has(id));
      const toUnwaive = [...new Set(args.unwaive ?? [])].filter((id) => current.has(id));
      if (toWaive.length === 0 && toUnwaive.length === 0) {
        return failed(
          "Nothing to change: every id to waive is already waived and every id to un-waive is not.",
          execCtx.limits,
        );
      }
      const reason = args.reason?.trim() ?? "";
      const waiveTitles: string[] = [];
      if (toWaive.length > 0) {
        if (reason.length < 3) {
          return failed("Waiving needs a reason (what the user accepted and why).", execCtx.limits);
        }
        const report = await target.designer.runDrc(target.designId);
        const byId = new Map((report?.violations ?? []).map((v) => [v.id, v]));
        const unknown = toWaive.filter((id) => !byId.has(id));
        if (unknown.length > 0) {
          return failed(
            `Not in the current DRC report (re-run designer_run_drc; ids change when the geometry does): ${unknown.slice(0, 10).join(", ")}${unknown.length > 10 ? ", …" : ""}.`,
            execCtx.limits,
          );
        }
        const critical = toWaive.filter((id) => NON_OVERRIDABLE.has(byId.get(id)!.code));
        if (critical.length > 0) {
          return failed(
            `These are safety-critical and can never be waived — fix them instead: ${critical
              .map((id) => `${id} (${byId.get(id)!.code})`)
              .join(", ")}.`,
            execCtx.limits,
          );
        }
        for (const id of toWaive) {
          const v = byId.get(id)!;
          waiveTitles.push(`Waive ${v.code}: ${v.message.slice(0, 120)}`);
        }
      }
      const next = new Set(current);
      for (const id of toWaive) next.add(id);
      for (const id of toUnwaive) next.delete(id);
      const waiving = toWaive.length > 0;
      return propose({
        conversation,
        options,
        execCtx,
        target,
        // Waiving suppresses verification: approval-tier. Un-waiving only.
        kind: waiving ? "designer_pcb_drc_waivers" : "designer_pcb_board_edits",
        toolName: "pcb_waive_drc_violations",
        title: waiving
          ? `Waive ${toWaive.length} DRC violation(s)`
          : `Un-waive ${toUnwaive.length} DRC violation(s)`,
        summary: waiving
          ? `Waive ${toWaive.length} violation(s)${toUnwaive.length ? `, un-waive ${toUnwaive.length}` : ""}. Reason: ${reason}`
          : `Restore checking of ${toUnwaive.length} waived violation(s).`,
        riskLevel: waiving ? "high" : "medium",
        actionId: args.action_id,
        operations: [
          {
            title: waiving ? waiveTitles.join("; ").slice(0, 400) : "Un-waive DRC violations",
            payload: {
              type: "pcb_set_view_state",
              patch: { drcWaivedViolationIds: [...next] },
            },
          },
        ],
      });
    },
  };
}

/**
 * Ignore whole DRC rule classes. Unlike a waiver this HIDES every current and
 * future violation of the class from the report — it changes what "DRC
 * passes" means — so ignoring always needs a fresh approval, never covered by
 * a session allowance (NEVER_SESSION_ALLOWED_KINDS). Un-ignoring only
 * restores checking and applies at once.
 */
function makeRuleClassIgnoresTool(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions,
): AiTool {
  const classes = [...DRC_RULE_CLASSES];
  return {
    definition: {
      name: "pcb_set_drc_rule_class_ignores",
      version: "1",
      effect: "write",
      capability: "designer.write.pcb.drc",
      description:
        "Ignore (or stop ignoring) whole DRC rule classes. Ignored classes vanish from designer_run_drc (counted as hidden). Ignoring ALWAYS waits for the user's approval in OpenPCB (then assistant_await_proposal) and needs a reason; only do it when the user explicitly asked. Un-ignoring applies at once.",
      inputSchema: {
        type: "object",
        properties: {
          designId: DESIGN_ID,
          action_id: ACTION_ID,
          ignore: { type: "array", items: { type: "string", enum: classes }, maxItems: classes.length },
          unignore: { type: "array", items: { type: "string", enum: classes }, maxItems: classes.length },
          reason: REASON,
        },
      },
    },
    async execute(execCtx, input): Promise<AiToolResult<unknown>> {
      const args = (input ?? {}) as {
        designId?: string;
        action_id?: string;
        ignore?: DrcRuleClass[];
        unignore?: DrcRuleClass[];
        reason?: string;
      };
      const target = await loadTarget(ctx, contextResolver, execCtx, args.designId);
      if (typeof target === "string") return failed(target, execCtx.limits);
      const current = new Set(target.pcb.board.viewState?.drcIgnoredRuleClasses ?? []);
      const toIgnore = [...new Set(args.ignore ?? [])].filter((c) => !current.has(c));
      const toUnignore = [...new Set(args.unignore ?? [])].filter((c) => current.has(c));
      if (toIgnore.length === 0 && toUnignore.length === 0) {
        return failed("Nothing to change.", execCtx.limits);
      }
      const reason = args.reason?.trim() ?? "";
      let hides = "";
      if (toIgnore.length > 0) {
        if (reason.length < 3) {
          return failed("Ignoring a rule class needs a reason (what the user accepted and why).", execCtx.limits);
        }
        const report = await target.designer.runDrc(target.designId);
        const affected = (report?.violations ?? []).filter(
          (v) => toIgnore.includes(v.ruleClass) && !NON_OVERRIDABLE.has(v.code),
        ).length;
        hides = ` It would hide ${affected} current violation(s) and every future one of these classes.`;
      }
      const next = new Set(current);
      for (const c of toIgnore) next.add(c);
      for (const c of toUnignore) next.delete(c);
      const ignoring = toIgnore.length > 0;
      return propose({
        conversation,
        options,
        execCtx,
        target,
        kind: ignoring ? "designer_pcb_drc_rule_ignores" : "designer_pcb_board_edits",
        toolName: "pcb_set_drc_rule_class_ignores",
        title: ignoring
          ? `Ignore DRC rule class(es): ${toIgnore.join(", ")}`
          : `Check DRC rule class(es) again: ${toUnignore.join(", ")}`,
        summary: ignoring
          ? `Ignore ${toIgnore.join(", ")}.${hides} Reason: ${reason}`
          : `Restore checking of ${toUnignore.join(", ")}.`,
        riskLevel: ignoring ? "high" : "medium",
        actionId: args.action_id,
        operations: [
          {
            title: ignoring ? `Ignore ${toIgnore.join(", ")}` : `Un-ignore ${toUnignore.join(", ")}`,
            payload: {
              type: "pcb_set_view_state",
              patch: { drcIgnoredRuleClasses: [...next] },
            },
          },
        ],
      });
    },
  };
}

// ─── registration ──────────────────────────────────────────────────────

/** Proposal kinds that always wait for the user, whatever their risk level. */
export const APPROVAL_REQUIRED_KINDS: ReadonlySet<string> = new Set([
  "designer_pcb_rules_edits",
  "designer_pcb_drc_waivers",
  "designer_pcb_drc_rule_ignores",
  "designer_design_delete",
]);

/**
 * Approval kinds a session allowance ("allow this tool this session") never
 * covers: every one is a fresh decision. Deleting a design is irreversible;
 * ignoring a rule class changes what "DRC passes" means for the whole board.
 */
export const NEVER_SESSION_ALLOWED_KINDS: ReadonlySet<string> = new Set([
  "designer_pcb_drc_rule_ignores",
  "designer_design_delete",
]);

export function registerMcpPcbTools(
  registry: AiToolRegistry,
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: DesignerToolOptions,
): void {
  registry.register(makeGetLayoutTool(ctx, contextResolver));
  registry.register(makePlaceTool(ctx, contextResolver, conversation, options));
  registry.register(makeRouteTool(ctx, contextResolver, conversation, options));
  registry.register(makeDeleteRoutingTool(ctx, contextResolver, conversation, options));
  registry.register(makeBoardOutlineTool(ctx, contextResolver, conversation, options));
  registry.register(makeDesignRulesTool(ctx, contextResolver, conversation, options));
  registry.register(makeZoneTool(ctx, contextResolver, conversation, options));
  registry.register(makeKeepoutTool(ctx, contextResolver, conversation, options));
  registry.register(makeWaiveViolationsTool(ctx, contextResolver, conversation, options));
  registry.register(makeRuleClassIgnoresTool(ctx, contextResolver, conversation, options));
}
