import type {
  DesignerPcbProjection,
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbFreePad,
  PcbPlacedPart,
  PcbVia,
} from "../../../../../sdks/designer/types";
import {
  ApertureTable,
  type AperFunction,
  type ApertureShape,
} from "../apertures";
import {
  effectivePadRotationDeg,
  isOrthogonalSwap,
  projectLocal,
} from "../transform";
import { gerberDim, xyOperand } from "../units";
import { flattenOutline } from "../../pcb/outline-geometry";
import { textToStrokes } from "../text/stroke-font";
// Single source of truth for poured copper: the SAME kernel the canvas renders,
// so the manufactured plane matches the on-screen copper exactly. The kernel is
// pure geometry (clipper2 + math; no React/R3F) and runs under Bun. (Lives under
// frontend/ today; a future cleanup may relocate the pure kernel to shared/.)
import {
  buildCopperFillPourPaths,
  resolveCopperFillClearanceMm,
} from "../../../frontend/pcb/layers/copper-fill-geometry";

/**
 * Build a complete Gerber X2 file for one fabrication layer.
 *
 * Strategy:
 *   1. Collect every drawable object that touches this layer.
 *   2. Allocate apertures in deterministic order.
 *   3. Emit header (FS, MO, X2 attributes, aperture macros, aperture defs).
 *   4. Emit draw operations (flashes for pads/vias, line segments for
 *      traces and outlines).
 *   5. Emit trailer (`M02*`).
 *
 * Outputs CRLF line endings (Ucamco recommends `\r\n` for fab tools).
 */

export type GerberLayerKind =
  | "copper.top"
  | "copper.bottom"
  | "copper.inner1"
  | "copper.inner2"
  | "mask.top"
  | "mask.bottom"
  | "paste.top"
  | "paste.bottom"
  | "silk.top"
  | "silk.bottom"
  | "edge_cuts";

const SOFTWARE_VENDOR = "OpenPCB";
const SOFTWARE_NAME = "OpenPCB Manufacturing Export";
const SOFTWARE_VERSION = "0.1";

const NL = "\r\n";

interface BuildContext {
  proj: DesignerPcbProjection;
  warnings: string[];
  /**
   * Pre-built per-pad net lookup: key is `${placementId}|${padNumber}`,
   * value is the resolved netId. Optional — when absent, per-pad `.TO.N`
   * attributes are omitted (still spec-legal; fab AOI tools that want
   * them will not flag the export, just skip optical-net validation).
   */
  padNetIds?: Map<string, string>;
}

export function buildGerberLayer(
  proj: DesignerPcbProjection,
  layerKind: GerberLayerKind,
  warnings: string[],
  padNetIds?: Map<string, string>,
  createdAt: string = new Date().toISOString(),
): string {
  const ctx: BuildContext = { proj, warnings, padNetIds };
  const aperTable = new ApertureTable();
  const body: string[] = [];

  switch (layerKind) {
    case "copper.top":
      emitCopper(ctx, aperTable, body, "F.Cu", "L1,Top");
      break;
    case "copper.bottom":
      emitCopper(ctx, aperTable, body, "B.Cu", "L2,Bot");
      break;
    case "copper.inner1":
      emitCopper(ctx, aperTable, body, "In1.Cu", "L2,Inr");
      break;
    case "copper.inner2":
      emitCopper(ctx, aperTable, body, "In2.Cu", "L3,Inr");
      break;
    case "mask.top":
      emitMask(ctx, aperTable, body, "top");
      break;
    case "mask.bottom":
      emitMask(ctx, aperTable, body, "bottom");
      break;
    case "paste.top":
      emitPaste(ctx, aperTable, body, "top");
      break;
    case "paste.bottom":
      emitPaste(ctx, aperTable, body, "bottom");
      break;
    case "silk.top":
      emitSilk(ctx, aperTable, body, "top");
      break;
    case "silk.bottom":
      emitSilk(ctx, aperTable, body, "bottom");
      break;
    case "edge_cuts":
      emitEdgeCuts(ctx, aperTable, body);
      break;
  }

  // Header lines emitted after body collection (so apertures are complete).
  const header: string[] = [];
  emitHeader(header, layerKind, proj.board.layerCount, createdAt);
  for (const macro of aperTable.emitMacros()) header.push(macro);
  for (const def of aperTable.emitDefinitions()) header.push(def);
  // LP D — polarity dark (positive) is the default and applies to the
  // entire image. Emit explicitly for clarity.
  header.push("%LPD*%");

  return [...header, ...body, "M02*"].join(NL) + NL;
}

// =========================================================================
// Header
// =========================================================================

function emitHeader(
  out: string[],
  layer: GerberLayerKind,
  layerCount: number,
  createdAt: string,
): void {
  out.push(`G04 ${SOFTWARE_NAME} v${SOFTWARE_VERSION}*`);
  out.push(
    `%TF.GenerationSoftware,${SOFTWARE_VENDOR},${SOFTWARE_NAME},${SOFTWARE_VERSION}*%`,
  );
  out.push(`%TF.CreationDate,${createdAt}*%`);
  out.push(`%TF.FileFunction,${gerberFileFunctionAttr(layer, layerCount)}*%`);
  out.push(`%TF.FilePolarity,${gerberPolarityAttr(layer)}*%`);
  out.push(`%TF.SameCoordinates,Original*%`);
  // Coordinate format and units. Must precede any coordinate command.
  out.push("%FSLAX46Y46*%");
  out.push("%MOMM*%");
}

export function gerberFileFunctionAttr(
  layer: GerberLayerKind,
  layerCount: number,
): string {
  switch (layer) {
    // Copper layers carry a 1-based physical L-code (top=L1, bottom=L<count>)
    // and the layer-type qualifier `,Signal`. Both are required for JLCPCB /
    // PCBWay X2 layer auto-identification (filenames are non-Protel, so the
    // attribute is the only signal). Bottom was previously hardcoded `L2`,
    // which mislabels B.Cu as inner L2 on a 4-layer stackup.
    case "copper.top":
      return "Copper,L1,Top,Signal";
    case "copper.bottom":
      return `Copper,L${layerCount},Bot,Signal`;
    case "copper.inner1":
      return "Copper,L2,Inr,Signal";
    case "copper.inner2":
      return "Copper,L3,Inr,Signal";
    case "mask.top":
      return "Soldermask,Top";
    case "mask.bottom":
      return "Soldermask,Bot";
    case "paste.top":
      return "Paste,Top";
    case "paste.bottom":
      return "Paste,Bot";
    case "silk.top":
      return "Legend,Top";
    case "silk.bottom":
      return "Legend,Bot";
    case "edge_cuts":
      return "Profile,NP";
  }
}

export function gerberPolarityAttr(
  layer: GerberLayerKind,
): "Positive" | "Negative" {
  // Mask layers are conventionally negative in Gerber X2 (the file
  // describes where mask is *removed*). All others are positive.
  if (layer === "mask.top" || layer === "mask.bottom") return "Negative";
  return "Positive";
}

// =========================================================================
// Copper layer
// =========================================================================

function emitCopper(
  ctx: BuildContext,
  apers: ApertureTable,
  out: string[],
  layer: PcbCopperLayerId,
  _stackLabel: string,
): void {
  const { proj } = ctx;

  // 0. Copper pour FIRST: pads/traces/vias paint on top, so the pour's clear
  //    (LPC) antipad holes never erase them (KiCad's zone-then-objects order).
  //    No-op on layers without a configured pour.
  emitCopperPour(ctx, out, layer);

  // 1. Vias — annulus on every copper layer the via spans.
  for (const via of proj.vias) {
    if (!viaTouchesLayer(via, layer)) continue;
    const code = apers.allocate(
      { kind: "circle", diameterMm: via.diameterMm },
      "ViaPad",
    );
    emitNetAttr(out, resolveNetName(ctx, via.netId, via.netName ?? null));
    out.push(`D${code}*`);
    out.push(`${xyOperand(via.centerMm.x, via.centerMm.y)}D03*`);
    emitClearAttr(out);
  }

  // 2. Footprint pads (THT pads appear on every copper layer; SMD pads
  //    appear on the placement's side only).
  for (const placement of proj.placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    for (const pad of pads) {
      if (!padTouchesCopperLayer(pad, placement, layer)) continue;
      const aperShape = padApertureShape(pad, placement);
      if (!aperShape) {
        ctx.warnings.push(
          `Pad ${placement.reference}.${pad.number} shape '${pad.shape}' not supported by exporter yet`,
        );
        continue;
      }
      const fn: AperFunction =
        (pad.drillDiameterMm ?? 0) > 0 ? "ComponentPad" : "SMDPad,CuDef";
      const code = apers.allocate(aperShape, fn);
      const center = projectLocal(placement, pad.centerMm);
      emitNetAttr(out, resolveNetNameForPad(ctx, placement, pad.number));
      out.push(
        `%TO.P,${escapeAttr(placement.reference)},${escapeAttr(pad.number)}*%`,
      );
      out.push(`D${code}*`);
      out.push(`${xyOperand(center.x, center.y)}D03*`);
      emitClearAttr(out);
    }
  }

  // 3. Free pads (F5 manually-dropped pads).
  for (const pad of proj.freePads) {
    if (!freePadTouchesCopperLayer(pad, layer)) continue;
    const aperShape = freePadApertureShape(pad);
    if (!aperShape) {
      ctx.warnings.push(
        `Free pad ${pad.id} shape '${pad.shape}' not supported`,
      );
      continue;
    }
    const fn: AperFunction =
      pad.padType === "smd" ? "SMDPad,CuDef" : "ComponentPad";
    const code = apers.allocate(aperShape, fn);
    emitNetAttr(out, resolveNetName(ctx, pad.netId, null));
    out.push(`D${code}*`);
    out.push(`${xyOperand(pad.centerMm.x, pad.centerMm.y)}D03*`);
    emitClearAttr(out);
  }

  // 4. Traces — polylines using a round aperture matching the trace width.
  for (const trace of proj.traces) {
    if (trace.layer !== layer) continue;
    if (trace.pointsNm.length < 2) continue;
    const code = apers.allocate(
      { kind: "circle", diameterMm: trace.widthMm },
      "Conductor",
    );
    emitNetAttr(out, resolveNetName(ctx, trace.netId, trace.netName ?? null));
    out.push(`D${code}*`);
    // G01 = linear interpolation mode (default in many fab tools but
    // explicit is safer for spec compliance).
    out.push("G01*");
    for (let i = 0; i < trace.pointsNm.length; i++) {
      const pt = trace.pointsNm[i]!;
      const xMm = pt.x / 1_000_000;
      const yMm = pt.y / 1_000_000;
      out.push(`${xyOperand(xMm, yMm)}${i === 0 ? "D02*" : "D01*"}`);
    }
    emitClearAttr(out);
  }
}

// =========================================================================
// Copper pour (filled zones / planes)
// =========================================================================

/**
 * Emit the layer's copper pour as positive `G36/G37` regions, using the SAME
 * fill kernel the canvas renders so the manufactured plane is byte-identical to
 * the on-screen copper (clearance halos, thermal necks, island pruning included).
 *
 * Each island's outer contour is a dark (LPD) region; its antipad/clearance
 * holes are clear (LPC) regions — the spec-preferred "polarity" method for holes
 * over cut-ins. Pours are configured per layer in the design's persisted view
 * state (`copperFillLayers` / `copperFillPourNetIds`); absent → no pour, which
 * is spec-valid. Must run before pads/traces/vias (they paint over the holes).
 */
function emitCopperPour(
  ctx: BuildContext,
  out: string[],
  layer: PcbCopperLayerId,
): void {
  const view = ctx.proj.board.viewState;
  if (!view || !view.copperFillLayers.includes(layer)) return;
  const dr = ctx.proj.board.designRules;
  const pourNetId = view.copperFillPourNetIds[layer] ?? null;
  const islands = buildCopperFillPourPaths({
    layer,
    outline: ctx.proj.board.outline,
    placements: ctx.proj.placements,
    traces: ctx.proj.traces,
    vias: ctx.proj.vias,
    pourNetId,
    padNetIds: ctx.padNetIds ?? new Map<string, string>(),
    clearanceMm: resolveCopperFillClearanceMm(dr.clearance),
    copperToBoardEdgeMm: dr.clearance.copperToBoardEdgeMm,
    cutouts: ctx.proj.board.cutouts,
    freeHoles: ctx.proj.freeHoles,
    freePads: ctx.proj.freePads,
    minThicknessMm: dr.minimums.traceWidthMm,
  });
  if (islands.length === 0) return;

  const netName = resolveNetName(ctx, pourNetId, null);
  for (const island of islands) {
    const outer = island[0];
    if (!outer || outer.length < 3) continue;
    emitNetAttr(out, netName);
    emitRegion(out, outer);
    if (island.length > 1) {
      // Clear (LPC) regions cut the antipads/clearance gaps back out of the
      // pour, then restore dark for the next island.
      out.push("%LPC*%");
      for (let h = 1; h < island.length; h++) {
        const hole = island[h]!;
        if (hole.length >= 3) emitRegion(out, hole);
      }
      out.push("%LPD*%");
    }
    emitClearAttr(out);
  }
}

/** One `G36 … G37` filled region from a closed ring of `{x, y}` mm points. */
function emitRegion(
  out: string[],
  ring: ReadonlyArray<{ x: number; y: number }>,
): void {
  out.push("G36*");
  out.push("G01*");
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    out.push(`${xyOperand(p.x, p.y)}${i === 0 ? "D02*" : "D01*"}`);
  }
  // A region contour must be closed; add the closing segment if the kernel
  // didn't already repeat the first vertex.
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (!pointsEqual(first, last)) {
    out.push(`${xyOperand(first.x, first.y)}D01*`);
  }
  out.push("G37*");
}

// Stackup order used to determine which copper layers a via spans.
// Indices are increasing from top to bottom of the board.
const COPPER_LAYER_ORDER: ReadonlyArray<PcbCopperLayerId> = [
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
];

function viaTouchesLayer(via: PcbVia, layer: PcbCopperLayerId): boolean {
  // Through / blind / buried vias all span a contiguous range
  // [fromLayer, toLayer] in stackup order; a via touches `layer` iff that
  // layer is anywhere in the range. Endpoints-only logic missed inner
  // copper layers for through-vias on 4-layer boards.
  const fromIdx = COPPER_LAYER_ORDER.indexOf(via.fromLayer);
  const toIdx = COPPER_LAYER_ORDER.indexOf(via.toLayer);
  const layerIdx = COPPER_LAYER_ORDER.indexOf(layer);
  if (fromIdx === -1 || toIdx === -1 || layerIdx === -1) {
    // Unknown layer ids — fall back to endpoint match so we never silently
    // drop the via's annulus.
    return layer === via.fromLayer || layer === via.toLayer;
  }
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  return layerIdx >= lo && layerIdx <= hi;
}

function padTouchesCopperLayer(
  pad: { drillDiameterMm?: number; layer?: string },
  placement: PcbPlacedPart,
  layer: PcbCopperLayerId,
): boolean {
  const drilled = (pad.drillDiameterMm ?? 0) > 0;
  if (drilled) {
    // THT pads appear on every copper layer.
    return (
      layer === "F.Cu" ||
      layer === "B.Cu" ||
      layer === "In1.Cu" ||
      layer === "In2.Cu"
    );
  }
  // SMD: choose side from placement layer + mirror, or from explicit pad.layer.
  if (pad.layer && (pad.layer === "F.Cu" || pad.layer === "B.Cu")) {
    return pad.layer === layer;
  }
  const placementOnBottom = placement.layer === "B.Cu";
  return (placementOnBottom ? "B.Cu" : "F.Cu") === layer;
}

function padApertureShape(
  pad: {
    shape: string;
    widthMm: number;
    heightMm: number;
    rotationDeg: number;
    roundrectRatio?: number;
  },
  placement: PcbPlacedPart,
): ApertureShape | null {
  const rot = effectivePadRotationDeg(placement, pad.rotationDeg);
  const swap = isOrthogonalSwap(rot);
  const w = swap ? pad.heightMm : pad.widthMm;
  const h = swap ? pad.widthMm : pad.heightMm;
  switch (pad.shape) {
    case "circle":
      return { kind: "circle", diameterMm: pad.widthMm };
    case "rect":
      return { kind: "rect", widthMm: w, heightMm: h };
    case "oval":
      return { kind: "obround", widthMm: w, heightMm: h };
    case "roundrect": {
      const r = (pad.roundrectRatio ?? 0.25) * Math.min(w, h);
      // Degrade to a plain rect when the corner radius rounds to zero —
      // otherwise the roundrect macro emits zero-diameter corner circles
      // that some parsers reject.
      if (r < 1e-6) return { kind: "rect", widthMm: w, heightMm: h };
      return { kind: "roundrect", widthMm: w, heightMm: h, radiusMm: r };
    }
    case "trapezoid":
      // Trapezoid is a KiCad-imported pad shape; approximate as the
      // bounding rectangle so the pad still appears in copper. Slight
      // copper overage is safer than a missing pad.
      return { kind: "rect", widthMm: w, heightMm: h };
    default:
      return null;
  }
}

function freePadTouchesCopperLayer(
  pad: PcbFreePad,
  layer: PcbCopperLayerId,
): boolean {
  if (pad.padType === "smd") return pad.layer === layer;
  // Through-hole / std / conn — present on F.Cu + B.Cu.
  if (
    pad.padType === "std" ||
    pad.padType === "hole" ||
    pad.padType === "conn"
  ) {
    return layer === "F.Cu" || layer === "B.Cu";
  }
  return false;
}

function freePadApertureShape(pad: PcbFreePad): ApertureShape | null {
  switch (pad.shape) {
    case "circle":
      return { kind: "circle", diameterMm: pad.widthMm };
    case "rect":
      return {
        kind: "rect",
        widthMm: pad.widthMm,
        heightMm: pad.heightMm,
      };
    case "oval":
      return {
        kind: "obround",
        widthMm: pad.widthMm,
        heightMm: pad.heightMm,
      };
    case "roundrect": {
      const r =
        (pad.roundrectRatio ?? 0.25) * Math.min(pad.widthMm, pad.heightMm);
      if (r < 1e-6) {
        return { kind: "rect", widthMm: pad.widthMm, heightMm: pad.heightMm };
      }
      return {
        kind: "roundrect",
        widthMm: pad.widthMm,
        heightMm: pad.heightMm,
        radiusMm: r,
      };
    }
    default:
      return null;
  }
}

// =========================================================================
// Soldermask layer
// =========================================================================

function emitMask(
  ctx: BuildContext,
  apers: ApertureTable,
  out: string[],
  side: "top" | "bottom",
): void {
  const layer: PcbCopperLayerId = side === "top" ? "F.Cu" : "B.Cu";
  // Board-level mask expansion drives every pad/via opening (per-free-pad
  // overrides still win below); falls back to the typical 50 µm default.
  const expansionDefault = ctx.proj.board.solderMaskExpansionMm ?? 0.05;

  for (const placement of ctx.proj.placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    for (const pad of pads) {
      if (!padTouchesCopperLayer(pad, placement, layer)) continue;
      const aperShape = padApertureShape(pad, placement);
      if (!aperShape) continue;
      const expanded = inflateShape(aperShape, expansionDefault);
      const code = apers.allocate(expanded, "SolderMask");
      const center = projectLocal(placement, pad.centerMm);
      out.push(`D${code}*`);
      out.push(`${xyOperand(center.x, center.y)}D03*`);
    }
  }
  for (const pad of ctx.proj.freePads) {
    if (!freePadTouchesCopperLayer(pad, layer)) continue;
    const aperShape = freePadApertureShape(pad);
    if (!aperShape) continue;
    const expansion = pad.solderMaskExpansionMm ?? expansionDefault;
    const expanded = inflateShape(aperShape, expansion);
    const code = apers.allocate(expanded, "SolderMask");
    out.push(`D${code}*`);
    out.push(`${xyOperand(pad.centerMm.x, pad.centerMm.y)}D03*`);
  }
  // Vias on this side: only when not tented. v0 defaults to tented vias
  // (no mask opening). Skip unless explicitly untented.
  for (const via of ctx.proj.vias) {
    if (via.protection !== "none") continue;
    if (!viaTouchesLayer(via, layer)) continue;
    const code = apers.allocate(
      { kind: "circle", diameterMm: via.diameterMm + expansionDefault * 2 },
      "SolderMask",
    );
    out.push(`D${code}*`);
    out.push(`${xyOperand(via.centerMm.x, via.centerMm.y)}D03*`);
  }
}

function inflateShape(shape: ApertureShape, deltaMm: number): ApertureShape {
  const d = deltaMm * 2;
  switch (shape.kind) {
    case "circle":
      return { kind: "circle", diameterMm: shape.diameterMm + d };
    case "rect":
      return {
        kind: "rect",
        widthMm: shape.widthMm + d,
        heightMm: shape.heightMm + d,
      };
    case "obround":
      return {
        kind: "obround",
        widthMm: shape.widthMm + d,
        heightMm: shape.heightMm + d,
      };
    case "roundrect":
      return {
        kind: "roundrect",
        widthMm: shape.widthMm + d,
        heightMm: shape.heightMm + d,
        radiusMm: shape.radiusMm + deltaMm,
      };
  }
}

// =========================================================================
// Solder paste
// =========================================================================

function emitPaste(
  ctx: BuildContext,
  apers: ApertureTable,
  out: string[],
  side: "top" | "bottom",
): void {
  const layer: PcbCopperLayerId = side === "top" ? "F.Cu" : "B.Cu";
  // Solder-paste stencil apertures: the board paste expansion (usually 0, or a
  // small NEGATIVE inset that shrinks the stencil opening) is applied per pad.
  const pasteExpansion = ctx.proj.board.solderPasteExpansionMm ?? 0;
  // Paste applies to SMD pads only — THT pads get no paste aperture.
  for (const placement of ctx.proj.placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    for (const pad of pads) {
      if ((pad.drillDiameterMm ?? 0) > 0) continue;
      if (!padTouchesCopperLayer(pad, placement, layer)) continue;
      const base = padApertureShape(pad, placement);
      if (!base) continue;
      const aperShape = expandPaste(base, pasteExpansion);
      if (!aperShape) continue;
      const code = apers.allocate(aperShape, "SolderPaste");
      const center = projectLocal(placement, pad.centerMm);
      out.push(`D${code}*`);
      out.push(`${xyOperand(center.x, center.y)}D03*`);
    }
  }
  for (const pad of ctx.proj.freePads) {
    if (pad.padType !== "smd") continue;
    if (pad.layer !== layer) continue;
    const base = freePadApertureShape(pad);
    if (!base) continue;
    const aperShape = expandPaste(base, pasteExpansion);
    if (!aperShape) continue;
    const code = apers.allocate(aperShape, "SolderPaste");
    out.push(`D${code}*`);
    out.push(`${xyOperand(pad.centerMm.x, pad.centerMm.y)}D03*`);
  }
}

/**
 * Apply a paste expansion (usually 0 or negative) to a pad aperture, returning
 * null when the inset collapses the opening to non-positive size (that pad then
 * gets no paste — the correct result for an over-large negative expansion).
 */
function expandPaste(
  shape: ApertureShape,
  expansionMm: number,
): ApertureShape | null {
  if (expansionMm === 0) return shape;
  const expanded = inflateShape(shape, expansionMm);
  return shapeMinDim(expanded) > 0 ? expanded : null;
}

function shapeMinDim(shape: ApertureShape): number {
  switch (shape.kind) {
    case "circle":
      return shape.diameterMm;
    case "rect":
    case "obround":
    case "roundrect":
      return Math.min(shape.widthMm, shape.heightMm);
  }
}

// =========================================================================
// Silkscreen
// =========================================================================

function emitSilk(
  ctx: BuildContext,
  apers: ApertureTable,
  out: string[],
  side: "top" | "bottom",
): void {
  // v0: emit overlay text + shapes targeted at the F.SilkS / B.SilkS layers.
  const silkLayer = side === "top" ? "F.SilkS" : "B.SilkS";

  for (const shape of ctx.proj.overlayShapes) {
    if (shape.layer !== silkLayer) continue;
    const strokeWidth =
      (shape as { strokeWidthMm?: number }).strokeWidthMm ?? 0.15;
    const code = apers.allocate(
      { kind: "circle", diameterMm: strokeWidth },
      "NonConductor",
    );
    emitShapeStrokes(out, shape, code);
  }

  // Overlay text → single-stroke polylines drawn with a round NonConductor
  // aperture (stroke width ~15% of cap height, floored at 0.1 mm).
  for (const overlay of ctx.proj.overlayTexts) {
    if (overlay.layer !== silkLayer) continue;
    if (!overlay.text) continue;
    const strokeWidth = Math.max(0.1, overlay.fontSizeMm * 0.15);
    const code = apers.allocate(
      { kind: "circle", diameterMm: strokeWidth },
      "NonConductor",
    );
    const polylines = textToStrokes(overlay.text, {
      originMm: overlay.positionMm,
      sizeMm: overlay.fontSizeMm,
      rotationDeg: overlay.rotationDeg,
      mirror: overlay.mirror,
      justify: overlay.justify,
    });
    for (const poly of polylines) {
      if (poly.length < 2) continue;
      out.push(`D${code}*`);
      out.push("G01*");
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        out.push(`${xyOperand(p.x, p.y)}${i === 0 ? "D02*" : "D01*"}`);
      }
    }
  }
}

function emitShapeStrokes(
  out: string[],
  shape: { kind: string; pointsMm?: Array<{ x: number; y: number }> },
  apertureCode: number,
): void {
  // Generic polyline stroke (rect / polygon / polyline shapes share this).
  const pts = shape.pointsMm ?? [];
  if (pts.length < 2) return;
  out.push(`D${apertureCode}*`);
  out.push("G01*");
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]!;
    out.push(`${xyOperand(pt.x, pt.y)}${i === 0 ? "D02*" : "D01*"}`);
  }
}

// =========================================================================
// Edge.Cuts (board outline)
// =========================================================================

function emitEdgeCuts(
  ctx: BuildContext,
  apers: ApertureTable,
  out: string[],
): void {
  const outline = ctx.proj.board.outline;
  if (!outline) {
    ctx.warnings.push("Board has no outline; Edge.Cuts file is empty");
    return;
  }
  // Profile uses a thin round aperture (0.1 mm is the de-facto convention).
  const code = apers.allocate({ kind: "circle", diameterMm: 0.1 }, "Profile");
  out.push(`D${code}*`);
  out.push("G01*");
  // Outer board contour, then one closed contour per internal cutout — each is
  // a separate Profile loop (KiCad-compatible: outermost = edge, inner = holes).
  emitContour(out, outlinePoints(outline));
  for (const cut of ctx.proj.board.cutouts ?? []) {
    emitContour(out, flattenOutline(cut.shape));
  }
}

/** Emit one closed Edge.Cuts contour as move-to + draw-to commands. */
function emitContour(
  out: string[],
  pts: Array<{ x: number; y: number }>,
): void {
  if (pts.length < 2) return;
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]!;
    out.push(`${xyOperand(pt.x, pt.y)}${i === 0 ? "D02*" : "D01*"}`);
  }
  // Close the loop back to the first point unless already closed.
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (!pointsEqual(first, last)) {
    out.push(`${xyOperand(first.x, first.y)}D01*`);
  }
}

function pointsEqual(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  // Equal at the Gerber coordinate resolution (1 µm).
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function outlinePoints(
  outline: PcbBoardOutline,
): Array<{ x: number; y: number }> {
  // All shape kinds flatten through the shared helper (arcs discretised).
  return flattenOutline(outline);
}

// =========================================================================
// X2 attribute helpers
// =========================================================================

function emitNetAttr(out: string[], netName: string | null): void {
  if (!netName) return;
  out.push(`%TO.N,${escapeAttr(netName)}*%`);
}

function emitClearAttr(out: string[]): void {
  out.push("%TD*%");
}

function escapeAttr(s: string): string {
  // Spec: comma, asterisk, percent, backslash must be escaped with `\xx`
  // (two-hex-digit byte). All other ASCII passes through. Non-ASCII is
  // permitted but conservative fabs choke on it; we just keep ASCII.
  return s.replace(/[,*%\\]/g, (ch) => {
    const code = ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    return `\\${code}`;
  });
}

function resolveNetName(
  ctx: BuildContext,
  netId: string | null,
  fallbackName: string | null,
): string | null {
  if (netId && ctx.proj.netNames[netId]) return ctx.proj.netNames[netId]!;
  if (fallbackName) return fallbackName;
  return null;
}

function resolveNetNameForPad(
  ctx: BuildContext,
  placement: PcbPlacedPart,
  padNumber: string,
): string | null {
  // Lookup populated by the orchestrator when a schematic projection is
  // available. Falls back to null when the export is PCB-only (no
  // schematic) or when the pad isn't correlated to any net.
  if (!ctx.padNetIds) return null;
  const netId = ctx.padNetIds.get(`${placement.id}|${padNumber}`);
  if (!netId) return null;
  return ctx.proj.netNames[netId] ?? null;
}
