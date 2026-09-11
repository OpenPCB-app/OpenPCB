import type {
  DesignerPcbProjection,
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbFreePad,
  PcbPointMm,
} from "../../../../../sdks/designer/types";
import { copperLayersForCount } from "../../../../../sdks/designer/stackup";
import { copperToHoleClearanceMm } from "../../../../../shared/drc/rule-resolver";
import { freePadCopperLayers } from "../../../../../shared/rendering/pad-copper-layers";
import { ApertureTable, type AperFunction } from "../apertures";
// The artwork MODEL (DFM contract 11 §1): the silkscreen strokes / regions and
// the mask openings are built once, in `shared/`, and this writer only emits
// them. It owns no silk or mask geometry of its own — the DFM checks judge the
// same objects the fab receives.
import {
  apertureFromShape,
  inflateShape,
  type ApertureShape,
} from "../../../../../shared/rendering/pcb/artwork/aperture-shape";
import {
  buildMaskOpenings,
  viaTouchesLayer,
  type MaskOpening,
  buildPadShapeIndex,
} from "../../../../../shared/rendering/pcb/artwork/mask-artwork";
import {
  buildSilkArtwork,
  type SilkArtwork,
} from "../../../../../shared/rendering/pcb/artwork/silk-artwork";
import { gerberDim, xyOperand } from "../units";
// The S1 copper records are the ONE resolution of pad copper the pour,
// connectivity and DRC read; the artwork flashes from them too, so the fab
// receives the geometry DRC judged (manufacturability contract 10 §6.1).
import {
  buildCopperRecords,
  padRecordKey,
  type CopperRecords,
  type PadCopperRecord,
} from "../../../../../shared/pcb-connectivity";
import type { PadCopperShape } from "../../../../../shared/pcb-geometry/pad-annular";
import { flattenOutline } from "../../../../../shared/rendering/pcb/outline-geometry";
// The ONE exact reading of every outline kind (12 §2.2) — the Profile, the
// outline verdict and the certified board-edge interval all read this ring.
import { exactContour } from "../../../../../shared/pcb-geometry/exact-contour";
import {
  emitChordLoop,
  emitExactRing,
  ringHasArc,
  ringIsEmittable,
  type InterpolationState,
} from "./arcs";
// Single source of truth for poured copper: the SAME kernel the canvas renders,
// so the manufactured plane matches the on-screen copper exactly. The kernel is
// pure geometry (clipper2 + math; no React/R3F) and runs under Bun. Lives in
// shared/ so backend and canvas import one implementation.
import {
  buildCopperFillIslands,
  sortCopperFillIslands,
  unionPourIslands,
} from "../../../../../shared/rendering/copper-fill/copper-fill-geometry";
import { AppError } from "../../../../../core/contracts/errors";
import {
  collectCopperZones,
  collectKeepouts,
  pourParamsForZone,
  zonePourNets,
  type EffectiveKeepout,
} from "../../../../../shared/pcb-areas";

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
   * Per-pad net lookup, `${placementId}|${padNumber}` → netId, taken from the
   * projection's OWN `padNets` (copper-pour contract §9): the same authoritative
   * map the fill, connectivity and DRC read. The exporter used to re-derive it
   * from the schematic correlation, so a pad the pour merged could still flash
   * without a `%TO.N` — two answers to one question.
   */
  padNetIds: ReadonlyMap<string, string>;
  /**
   * The effective keepouts of this projection, derived ONCE per build: every
   * `copperPour` keepout is subtracted from every pour on its layers (contract
   * §4), so the artwork carves exactly what the canvas and DRC do.
   */
  keepouts: readonly EffectiveKeepout[];
  /**
   * The S1 copper records of this projection, built ONCE per layer build and
   * shared by the copper / mask / paste pad loops AND the pour (contract 10
   * §6.1). A record carries the frame DRC judges: the world centre, the
   * composed rotation, the mirror, the resolved copper layers (including the
   * explicit-layer side flip a mirrored placement gets, which the mask loop
   * used to miss) and the net. A copper-LESS unplated pad has NO record and
   * therefore no flash (§2.3); its mask relief comes from the mask artwork.
   */
  records: CopperRecords;
  /**
   * The pad's world frame + shape per record key. Records carry the geometry
   * but not the shape KIND (`circle` / `rect` / …) or the roundrect ratio, and
   * the aperture needs both.
   */
  padShapes: ReadonlyMap<string, PadCopperShape>;
  /** `placementId` → refdes, for the `%TO.P` component-pad attribute. */
  referenceById: ReadonlyMap<string, string>;
  /** Free pads by id — `padType` and the per-pad expansions records omit. */
  freePadById: ReadonlyMap<string, PcbFreePad>;
  /**
   * The silkscreen and solder-mask ARTWORK of this projection, built ONCE per
   * export (DFM contract 11 §1). `emitSilk` / `emitMask` walk these lists in
   * order and add no geometry: the aperture-allocation order IS the model
   * order, which is what keeps a board with only overlay lines and polylines
   * byte-identical to S11 (§1.4).
   */
  silk: SilkArtwork;
  maskOpenings: readonly MaskOpening[];
  /**
   * Data errors the mask model could not turn into an opening (a drill relief
   * with no positive size). Surfaced by `emitMask`, so they reach the export
   * warnings once per mask FILE — the file that lost the opening.
   */
  maskWarnings: readonly string[];
}

/** Key of one pad record — the same identity `copper-items.ts` assigns. */
const recordKey = (record: PadCopperRecord): string => padRecordKey(record);

export function buildGerberLayer(
  proj: DesignerPcbProjection,
  layerKind: GerberLayerKind,
  warnings: string[],
  createdAt: string = new Date().toISOString(),
): string {
  const padNetIds = new Map(Object.entries(proj.padNets ?? {}));
  const records = buildCopperRecords({
    layerCount: proj.board.layerCount,
    placements: proj.placements,
    padNetIds,
    freePads: proj.freePads,
    traces: proj.traces,
    vias: proj.vias,
  });
  const padShapes = buildPadShapeIndex(proj.placements, proj.freePads);
  const maskWarnings: string[] = [];
  const ctx: BuildContext = {
    proj,
    warnings,
    padNetIds,
    keepouts: collectKeepouts({
      keepouts: proj.keepouts ?? [],
      layerCount: proj.board.layerCount,
    }).keepouts,
    records,
    padShapes,
    referenceById: new Map(proj.placements.map((p) => [p.id, p.reference])),
    freePadById: new Map(proj.freePads.map((p) => [p.id, p])),
    silk: buildSilkArtwork({
      placements: proj.placements,
      overlayShapes: proj.overlayShapes,
      overlayTexts: proj.overlayTexts,
    }),
    maskOpenings: buildMaskOpenings({
      solderMaskExpansionMm: proj.board.solderMaskExpansionMm,
      layerCount: proj.board.layerCount,
      placements: proj.placements,
      freePads: proj.freePads,
      vias: proj.vias,
      records,
      padShapes,
      warnings: maskWarnings,
    }),
    maskWarnings,
  };
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

  // 2. Pads — footprint pads in placement × preview order, then free pads,
  //    flashed from the S1 copper RECORDS (contract 10 §6.1). The record
  //    already resolved which copper layers the pad occupies (THT and `*.Cu`
  //    on every layer, an explicit-layer SMD pad side-flipped on a mirrored
  //    placement) and carries the world centre and composed rotation DRC
  //    judges; the exporter's own transform snapped placement rotation to 90°
  //    steps and negated instead of conjugating a mirrored pad's own angle.
  //    A copper-less unplated pad has no record and therefore no flash (§2.3).
  for (const record of ctx.records.pads) {
    if (!record.resolvedLayers.includes(layer)) continue;
    const aperShape = apertureFromRecord(ctx, record);
    if (!aperShape) {
      ctx.warnings.push(unsupportedShapeWarning(ctx, record));
      continue;
    }
    const fn = copperAperFunction(ctx, record);
    const code = apers.allocate(aperShape, fn);
    emitNetAttr(out, resolveNetName(ctx, record.netId, null));
    // "Washer pads or any pads that are not part of a component cannot have a
    // .P attached" (Ucamco spec 2022.02, `.P` object attribute), so a ringed
    // NPTH pad flashes without one.
    if (record.anchor.kind === "pad" && fn !== "WasherPad") {
      out.push(
        `%TO.P,${escapeAttr(
          ctx.referenceById.get(record.anchor.placementId) ?? "",
        )},${escapeAttr(record.anchor.padNumber)}*%`,
      );
    }
    out.push(`D${code}*`);
    out.push(`${xyOperand(record.center.x, record.center.y)}D03*`);
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
 * The layer carries ONE region set — the UNION of every zone's islands
 * (copper-pour contract §9). Emitting pour-by-pour is unsound: a later same-net
 * pour's `LPC` antipad holes are cut out of the accumulated dark copper, so
 * where two same-net zones overlap with different clearances the second pour's
 * holes erase the first pour's copper. After §3.3's precedence carve only
 * same-net overlaps survive, so the union changes no electrical answer.
 *
 * Each island's outer contour is a dark (LPD) region; its antipad/clearance
 * holes are clear (LPC) regions — the spec-preferred "polarity" method for holes
 * over cut-ins. Which copper areas exist comes from `collectCopperZones` — the
 * one derivation the canvas, DRC and the snapshot also read — so a layer with
 * no effective zone emits no pour, which is spec-valid. Must run before
 * pads/traces/vias (they paint over the holes).
 */
function emitCopperPour(
  ctx: BuildContext,
  out: string[],
  layer: PcbCopperLayerId,
): void {
  const board = ctx.proj.board;
  const dr = board.designRules;
  const common = {
    layerCount: board.layerCount,
    outline: board.outline,
    // The SAME records the pad loops flash from — built once per layer build,
    // never a second resolution of the same copper (contract 10 §6.1).
    records: ctx.records,
    placements: ctx.proj.placements,
    traces: ctx.proj.traces,
    vias: ctx.proj.vias,
    padNetIds: ctx.padNetIds,
    copperToBoardEdgeMm: dr.clearance.copperToBoardEdgeMm,
    copperToHoleMm: copperToHoleClearanceMm(dr),
    cutouts: board.cutouts,
    freeHoles: ctx.proj.freeHoles,
    freePads: ctx.proj.freePads,
  };

  // ONE loop over the effective copper areas on this layer (zone/keepout
  // contract §3.1 / §7) — board zones and explicit zones are the same thing to
  // the fill kernel, so artwork can no longer disagree with the canvas.
  const { zones } = collectCopperZones({
    zones: ctx.proj.zones,
    layerCount: board.layerCount,
    knownNetIds: new Set(Object.keys(ctx.proj.netNames)),
  });
  const nets = zonePourNets(board, ctx.proj.netNames);
  // Rings grouped by pour net: same-net pours are unioned (their overlaps are
  // one copper, contract §9), different-net pours never overlap after the §3.3
  // precedence carve, so each union keeps its own `%TO.N`.
  const ringsByNet = new Map<string | null, PcbPointMm[][][]>();
  for (const zone of zones) {
    if (zone.layer !== layer) continue;
    const result = buildCopperFillIslands({
      ...common,
      ...pourParamsForZone(zone, dr, ctx.keepouts, zones, nets),
    });
    // Fail the export rather than ship a layer that silently lost a plane
    // (contract §8/§9): a bailed fill is not "this zone pours nothing".
    if (result.status === "failed") {
      throw new AppError(
        `Copper pour for zone "${zone.id}" on ${layer} could not be filled (${result.reason}); the export would omit its copper`,
        422,
        "Copper pour failed",
        "https://openpcb.dev/problems/copper-pour-failed",
        { zoneId: zone.id, layer, reason: result.reason },
      );
    }
    if (result.islands.length === 0) continue;
    const bucket = ringsByNet.get(zone.netId) ?? [];
    for (const island of result.islands) bucket.push(island.rings);
    ringsByNet.set(zone.netId, bucket);
  }
  // One list across nets in the §8 total order: an island nested in another
  // net's clearance void has a strictly larger `minX`, so its ancestor is
  // emitted first and the ancestor's `LPC` hole never erases it.
  const islands: Array<{
    rings: PcbPointMm[][];
    areaMm2: number;
    netId: string | null;
  }> = [];
  for (const netId of [...ringsByNet.keys()].sort(compareNetIds)) {
    for (const island of unionLayerPours(ringsByNet.get(netId)!, netId, layer)) {
      islands.push({ ...island, netId });
    }
  }
  emitPourIslands(ctx, out, sortCopperFillIslands(islands));
}

/**
 * The per-net union, with a kernel failure (a clipper throw or a collapsed
 * union) reported the same way a failed per-zone fill is: a typed problem the
 * export route returns, never a bare 500 and never a layer without its plane.
 */
function unionLayerPours(
  pours: PcbPointMm[][][],
  netId: string | null,
  layer: PcbCopperLayerId,
): ReturnType<typeof unionPourIslands> {
  try {
    return unionPourIslands(pours);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AppError(
      `Copper pours of net "${netId ?? "(no net)"}" on ${layer} could not be merged for export (${reason}); the export would omit their copper`,
      422,
      "Copper pour failed",
      "https://openpcb.dev/problems/copper-pour-failed",
      { netId, layer, reason },
    );
  }
}

/** `null` (net-less copper) first, then ids in code-point order. */
function compareNetIds(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/** Emit a pour's islands as `G36/G37` dark regions with `%LPC%` antipad holes. */
function emitPourIslands(
  ctx: BuildContext,
  out: string[],
  islands: ReadonlyArray<{
    rings: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
    netId: string | null;
  }>,
): void {
  for (const island of islands) {
    const outer = island.rings[0];
    if (!outer || outer.length < 3) continue;
    emitNetAttr(out, resolveNetName(ctx, island.netId, null));
    emitRegion(out, outer);
    if (island.rings.length > 1) {
      // Clear (LPC) regions cut the antipads/clearance gaps back out of the
      // pour, then restore dark for the next island.
      out.push("%LPC*%");
      for (let h = 1; h < island.rings.length; h++) {
        const hole = island.rings[h]!;
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

/**
 * THE aperture of one copper record: the record's world shape resolved by the
 * shared artwork model (contract 10 §6.2, DFM contract 11 §1.3). Null for a
 * pad whose shape has no true outline in the render source — the caller warns.
 */
function apertureFromRecord(
  ctx: BuildContext,
  record: PadCopperRecord,
): ApertureShape | null {
  const shape = ctx.padShapes.get(recordKey(record));
  if (!shape) return null;
  return apertureFromShape(shape, record.rotationDeg);
}

/** X2 aperture function of a pad record's copper (contract 10 §6.4). */
function copperAperFunction(
  ctx: BuildContext,
  record: PadCopperRecord,
): AperFunction {
  if (record.anchor.kind === "freePad") {
    const pad = ctx.freePadById.get(record.anchor.freePadId);
    return pad?.padType === "smd" ? "SMDPad,CuDef" : "ComponentPad";
  }
  if (record.drillMm > 0) {
    // An unplated drill's copper is mechanical — a washer, not a lead pad.
    return record.plated ? "ComponentPad" : "WasherPad";
  }
  return "SMDPad,CuDef";
}

function unsupportedShapeWarning(
  ctx: BuildContext,
  record: PadCopperRecord,
): string {
  const shape = ctx.padShapes.get(recordKey(record))?.shape ?? "unknown";
  if (record.anchor.kind === "freePad") {
    return `Free pad ${record.anchor.freePadId} shape '${shape}' not supported`;
  }
  const reference = ctx.referenceById.get(record.anchor.placementId) ?? "";
  return `Pad ${reference}.${record.anchor.padNumber} shape '${shape}' not supported by exporter yet`;
}

// =========================================================================
// Soldermask layer
// =========================================================================

/**
 * Flash the mask model's openings for this face, in model order (DFM contract
 * 11 §1.3 / §1.4). Every rule — the per-side expansion, the copper-less drill
 * relief, the free-pad layer policy, the untented-via opening — lives in
 * `buildMaskOpenings`, so the DFM checks measure exactly what is flashed here.
 */
function emitMask(
  ctx: BuildContext,
  apers: ApertureTable,
  out: string[],
  side: "top" | "bottom",
): void {
  // Distinct messages only: the model derives both faces in one pass, so a
  // broken drill would otherwise be reported once per face per file.
  for (const warning of new Set(ctx.maskWarnings)) ctx.warnings.push(warning);
  for (const opening of ctx.maskOpenings) {
    if (opening.face !== side) continue;
    const code = apers.allocate(opening.shape, "SolderMask");
    out.push(`D${code}*`);
    out.push(`${xyOperand(opening.centerMm.x, opening.centerMm.y)}D03*`);
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
  // Paste applies to SMD records only (contract §6.4): a record carrying a
  // drill — or an unplated one — is never stencilled, whatever else it is.
  for (const record of ctx.records.pads) {
    if (record.drillMm > 0 || !record.plated) continue;
    if (!record.resolvedLayers.includes(layer)) continue;
    if (
      record.anchor.kind === "freePad" &&
      ctx.freePadById.get(record.anchor.freePadId)?.padType !== "smd"
    ) {
      // A free pad declares its own kind; only `smd` is a stencilled pad.
      continue;
    }
    const base = apertureFromRecord(ctx, record);
    if (!base) continue;
    const aperShape = expandPaste(base, pasteExpansion);
    if (!aperShape) continue;
    const code = apers.allocate(aperShape, "SolderPaste");
    out.push(`D${code}*`);
    out.push(`${xyOperand(record.center.x, record.center.y)}D03*`);
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

/**
 * Emit the silkscreen artwork model for this face (DFM contract 11 §1.2 /
 * §1.4): every stroke as `D02` + `D01`s with a round `NonConductor` aperture of
 * the stroke width, then every filled shape as a `G36 … G37` region.
 *
 * Aperture allocation order IS model order, which is what keeps a board whose
 * only silk is overlay lines / polylines / text byte-identical to S11. The
 * writer contributes no geometry: footprint silk graphics, reference
 * designators and the closed form of an overlay rect / circle / polygon all
 * come from `buildSilkArtwork`, so the DFM checks judge what the fab receives.
 */
function emitSilk(
  ctx: BuildContext,
  apers: ApertureTable,
  out: string[],
  side: "top" | "bottom",
): void {
  for (const stroke of ctx.silk.strokes) {
    if (stroke.face !== side) continue;
    if (stroke.pointsMm.length < 2) continue;
    const code = apers.allocate(
      { kind: "circle", diameterMm: stroke.widthMm },
      "NonConductor",
    );
    out.push(`D${code}*`);
    // G01 = linear interpolation mode (default in many fab tools but
    // explicit is safer for spec compliance).
    out.push("G01*");
    for (let i = 0; i < stroke.pointsMm.length; i++) {
      const p = stroke.pointsMm[i]!;
      out.push(`${xyOperand(p.x, p.y)}${i === 0 ? "D02*" : "D01*"}`);
    }
  }
  const regions = ctx.silk.regions.filter((region) => region.face === side);
  if (regions.length === 0) return;
  // Legend files never switch polarity; state the dark polarity the regions
  // are filled with anyway, as the pour emitter does around its holes.
  out.push("%LPD*%");
  for (const region of regions) {
    if (region.ring.length < 3) continue;
    emitRegion(out, region.ring);
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
  // The loops are the EXACT rings (exact-geometry contract 12 §6): an authored
  // arc travels to the fab as a true arc, not as the chords the canvas draws.
  const shapes: PcbBoardOutline[] = [outline];
  for (const cut of ctx.proj.board.cutouts ?? []) {
    shapes.push(cut.shape);
  }
  const rings = shapes.map((shape) => exactContour(shape));
  // G75 — multi-quadrant circular interpolation — is stated once, before any
  // arc move, and ONLY when an arc is actually emitted, so a rect / polygon
  // Profile is byte-identical to the pre-arc file. A ring that falls back to
  // chords below emits no arc and so must not vote for G75 either.
  if (rings.some((ring) => ringIsEmittable(ring) && ringHasArc(ring))) {
    out.push("G75*");
  }
  const state: InterpolationState = { mode: "G01" };
  shapes.forEach((shape, index) => {
    if (emitExactRing(out, rings[index]!, state)) return;
    // A contour that reduces to a single primitive (a full-circle arc — already
    // BOARD_OUTLINE_INVALID) has no exact loop. Ship its chord flattening
    // anyway: a Profile file missing a loop is a board with no edge at all.
    emitChordLoop(out, state, flattenOutline(shape));
    ctx.warnings.push(degenerateOutlineWarning(shape, index));
  });
}

/** Which loop fell back to chords, and why — one line per degenerate ring. */
function degenerateOutlineWarning(
  shape: PcbBoardOutline,
  index: number,
): string {
  const which = index === 0 ? "Board outline" : `Cutout ${index}`;
  return (
    `${which} (${shape.kind}) is degenerate — it encloses no closed contour; ` +
    "Edge.Cuts exported as its chord approximation"
  );
}

function pointsEqual(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  // Equal at the Gerber coordinate resolution (1 µm).
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
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
// `resolveNetNameForPad` is gone: a footprint pad's net now comes off its
// copper record, whose `netId` IS `padNetIds.get(`${placementId}|${number}`)`
// (`footprintPadRecords`), so `resolveNetName(ctx, record.netId, null)` returns
// exactly what the removed helper did — one lookup instead of two.
