// Precomputed, mm-domain view of a PCB projection for the DRC engine.
//
// Resolves the data-model gotchas once, up front, so the individual checks stay
// simple: trace points are converted nm→mm; footprint/free pads become world
// polygons grouped by the copper layer(s) they occupy (through-hole spans both
// sides — fixes live-drc's "all pads on the active layer" approximation); vias
// become circles spanning their barrel layers; every primitive carries an AABB
// for the O(n²) broad-phase prefilter.

import type {
  DesignerPcbProjection,
  DrcAnchor,
  PcbCopperLayerId,
  PcbDesignRules,
  PcbFabricatorId,
  PcbNetClass,
  PcbPointMm,
  PcbVia,
  RatsnestSegment,
} from "../../../../sdks/designer";
import { isValidViaSpan } from "../../../../sdks/designer";
import {
  createRuleResolver,
  DEFAULT_HOLE_TO_HOLE_MM,
  type RuleResolver,
} from "../../../../shared/drc/rule-resolver";
import {
  buildCopperRecords,
  type CopperPadAnchor,
} from "../../../../shared/pcb-connectivity/copper-records";
import type {
  ConnectivityResult,
  CopperItem,
} from "../../../../shared/pcb-connectivity";
import {
  computeBoardConnectivity,
  type BoardPourFill,
} from "../pcb/board-connectivity";
import {
  collectCopperZones,
  collectKeepouts,
  pourParamsForZone,
  type CopperAreaWarning,
  type EffectiveCopperZone,
  type EffectiveKeepout,
  type ZonePourNets,
} from "../../../../shared/pcb-areas";
import {
  buildCopperFillIslands,
  type CopperFillResult,
} from "../../../../shared/rendering/copper-fill/copper-fill-geometry";
import { buildBoardRegion, type BoardRegion } from "../pcb/board-region";
import { placementKeepoutExtentMm } from "../pcb/placement-extent";
import type { DrcOptions } from "./types";
import type { RingBounds } from "../pcb/pad-outline";
import type { Point } from "../pcb/pcb-trace-geometry";

/** Default minimums when a (pre-DRC) board lacks the optional rule field. */
export { DEFAULT_HOLE_TO_HOLE_MM } from "../../../../shared/drc/rule-resolver";
export const DEFAULT_HOLE_TO_BOARD_EDGE_MM = 0.3;
export const DEFAULT_BOARD_THICKNESS_MM = 1.6;

// The tolerance policy moved to pcb/tolerance.ts (P1 epsilon unification) so
// fab validators and creation gates share it; re-exported here because every
// check imports it from the context module.
export { below, DRC_EPS_MM } from "../pcb/tolerance";

export interface DrcTrace {
  id: string;
  netId: string | null;
  layer: PcbCopperLayerId;
  widthMm: number;
  halfWidthMm: number;
  pointsMm: Point[];
  bounds: RingBounds;
  mid: PcbPointMm;
}

export interface DrcPad {
  anchor: DrcAnchor;
  netId: string | null;
  layers: PcbCopperLayerId[];
  ring: PcbPointMm[];
  bounds: RingBounds;
  center: PcbPointMm;
  /**
   * True when the pad declared an explicit copper layer not valid for this
   * stackup (e.g. In1.Cu on a 2-layer board). Flagged as PAD_LAYER_MISMATCH;
   * such pads are still collision-checked on every valid layer (fallback) so
   * they cannot mask a short (audit B5-PAD-LAYER, B5-VIA-MASK).
   */
  declaredLayerInvalid: boolean;
}

export interface DrcViaGeom {
  via: PcbVia;
  netId: string | null;
  center: PcbPointMm;
  radiusMm: number;
  layers: PcbCopperLayerId[];
  bounds: RingBounds;
  /**
   * True when the via's declared span resolves to no valid copper layers on
   * this stackup. Flagged as VIA_LAYER_SPAN; the via is still checked on ALL
   * valid layers (clamp-with-fallback) so its copper can't escape short
   * detection (audit B5-VIA-MASK).
   */
  layerSpanInvalid: boolean;
  /**
   * True when the via's declared TYPE topology is invalid for the stackup
   * (e.g. a "blind" via spanning both outer layers, a reversed span, or a
   * non-adjacent microvia). Also surfaces as VIA_LAYER_SPAN.
   */
  viaTypeInvalid: boolean;
}

/** Any drilled hole (via barrel / TH pad / std-or-NPTH free pad / free hole). */
export interface DrcHole {
  anchor: DrcAnchor;
  /** Hole class: via barrel / plated component hole / non-plated hole. */
  kind: "via" | "pth" | "npth";
  /** Net the hole's copper belongs to (null for mechanical / NPTH holes). */
  netId: string | null;
  center: PcbPointMm;
  drillMm: number;
  /**
   * Copper pad outer diameter (mm) for the annular-ring check. Set for plated
   * pads with a defined copper extent (TH footprint pads, free `std` pads);
   * undefined for vias (checked via `DrcViaGeom`) and bare mechanical holes.
   */
  padOdMm?: number;
  /**
   * Slot centerline (mm) for oblong drills, so edge/spacing checks use the true
   * slot geometry instead of a round-hole model (audit B2-5 template). Absent
   * for round holes.
   */
  slot?: { a: PcbPointMm; b: PcbPointMm; widthMm: number };
}

export interface DrcContext {
  projection: DesignerPcbProjection;
  designRules: PcbDesignRules;
  netClasses: PcbNetClass[];
  fabricator: PcbFabricatorId;
  validCopperLayers: Set<PcbCopperLayerId>;
  traces: DrcTrace[];
  pads: DrcPad[];
  vias: DrcViaGeom[];
  /** Every drilled hole on the board, for hole-to-hole spacing. */
  holes: DrcHole[];
  /** Finished board thickness (mm); for via aspect-ratio. */
  boardThicknessMm: number;
  /** Minimum edge-to-edge hole spacing (mm). */
  holeToHoleMm: number;
  /** Minimum drill-edge-to-board-edge spacing (mm). */
  holeToBoardEdgeMm: number;
  /** Flattened board outline ring (mm) + internal cutout rings. */
  outlineRing: Point[];
  cutoutRings: Point[][];
  /**
   * The S2 board region (biased "board-inner" for legality; §4). `outlineRing`
   * / `cutoutRings` above are its unbiased rings, kept as a separate field only
   * because outline validity's self-intersection / zero-area tests run on them
   * (§4 table) — every containment/off-board/hole check goes through
   * `boardRegion` instead.
   */
  boardRegion: BoardRegion;
  /**
   * The effective copper areas (zone/keepout contract §3.1) — explicit zones
   * then the synthesized board zones, with every view-state default resolved.
   * The ONLY zone list a check may read; `projection.zones` is the persisted
   * shape, which says nothing about what actually pours.
   */
  copperZones: readonly EffectiveCopperZone[];
  /** The effective keepouts (contract §3.1); `checks/keepouts.ts` consumes them. */
  keepouts: readonly EffectiveKeepout[];
  /**
   * Everything the ONE derivation refused, zones' warnings then keepouts', each
   * in the derivation's sorted order. `checks/zones.ts` maps them to
   * `ZONE_INVALID` / `ZONE_EMPTY_FILL` (§13.2) — DRC consumes the derivation,
   * it never re-derives.
   */
  copperAreaWarnings: readonly CopperAreaWarning[];
  ratsnest: RatsnestSegment[];
  netNames: Record<string, string>;
  /**
   * Clearance contribution of a net's class (mm), or 0 when the net / class is
   * unknown. Resolved LIVE from the net id every time (audit B3-2/B1-2): the
   * stored `netClassId` on traces/vias is a creation-time hint that can go
   * stale after a reassignment, so DRC never consults it. Net class can only
   * *tighten* clearance; the board design rule is the floor.
   */
  netClassClearanceMm(netId: string | null): number;
  /** Resolved net-class id for a net (live; never the stored id). */
  netClassIdOf(netId: string | null): string;
  /**
   * The ONE rule resolver for this run (rule-semantics contract §9): every
   * clearance pair, every scalar minimum and every rule-validity problem this
   * report contains comes out of it. `netClassClearanceMm` / `netClassIdOf`
   * above forward to it, so a check can never resolve a class two ways.
   */
  resolver: RuleResolver;
  /**
   * Every piece of copper on the board as a connectivity-graph node, under the
   * FAIL-SAFE layer policy (contract §2 "Two layer policies"), plus one node
   * per filled pour island. Deliberately NOT derived from `ctx.pads` /
   * `ctx.vias`: those carry the CLAMP policy, where a layer-invalid pad or via
   * is checked on every valid copper layer so it cannot mask a short — as a
   * connectivity node it would instead manufacture a connection on every layer
   * and silently join every net it overlaps. Computed lazily and memoized, so a
   * `runDrc` that skips the `dfm` class pays nothing.
   */
  copperItems(): readonly CopperItem[];
  /** Components + contact records over `copperItems()` (memoized). */
  connectivity(): ConnectivityResult;
  /**
   * The fill verdict of EVERY effective copper zone, net-less ones included, in
   * `copperZones` order — computed once per run and shared (copper-pour
   * contract §9): the connectivity pour nodes and `checks/copper-pour.ts` read
   * the same islands, so DRC's electrical verdict and its dead-copper report can
   * never be about two different pieces of copper. Lazy for the same reason
   * `copperItems()` is: a run that skips the pour-bearing classes pays nothing.
   */
  pourResults(): ReadonlyArray<{
    zone: EffectiveCopperZone;
    result: CopperFillResult;
  }>;
  /**
   * World-space extent of a placement for the keepout `footprints` restriction
   * (contract §4), or null when the footprint describes no area. Lazily
   * resolved and cached: the courtyard branch walks every preview graphic, and
   * a board with many keepouts would otherwise redo it per keepout.
   */
  placementExtent(placementId: string): readonly PcbPointMm[] | null;
}

/** Widen a copper record's pad anchor to the DRC anchor union. */
function padAnchor(anchor: CopperPadAnchor): DrcAnchor {
  return anchor.kind === "pad"
    ? {
        kind: "pad",
        placementId: anchor.placementId,
        padNumber: anchor.padNumber,
      }
    : { kind: "freePad", freePadId: anchor.freePadId };
}

/**
 * Slot centerline for an oblong drill, or undefined for a round hole. The slot
 * runs `lengthMm` along `angleDeg` through `center`; endpoints are inset by
 * `widthMm/2` so a & b are the centers of the rounded caps.
 */
function slotCenterline(
  center: PcbPointMm,
  drillSlot: { lengthMm: number; widthMm: number; angleDeg: number } | null | undefined,
): { a: PcbPointMm; b: PcbPointMm; widthMm: number } | undefined {
  if (!drillSlot || drillSlot.lengthMm <= drillSlot.widthMm) return undefined;
  const half = (drillSlot.lengthMm - drillSlot.widthMm) / 2;
  const rad = (drillSlot.angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  return {
    a: { x: center.x - dx, y: center.y - dy },
    b: { x: center.x + dx, y: center.y + dy },
    widthMm: drillSlot.widthMm,
  };
}

export function buildDrcContext(
  projection: DesignerPcbProjection,
  options: DrcOptions = {},
): DrcContext {
  const { board } = projection;
  const cutouts = board.cutouts ?? [];
  // The S2 legality region (contract §4): biased so every arc's chord lies on
  // the board side of the true curve. Built once, up front, so every check
  // (containment, off-board, hole-to-edge, outline validity) shares one region.
  const boardRegion = buildBoardRegion(board.outline, cutouts, {
    bias: "board-inner",
  });
  // One derivation of the copper areas and keepouts for the whole DRC run
  // (contract §3.1): the connectivity pours below and `checks/copper-pour.ts`
  // both read it, so they can never disagree about what pours.
  const zoneAreas = collectCopperZones({
    zones: projection.zones,
    layerCount: board.layerCount,
    knownNetIds: new Set(Object.keys(projection.netNames ?? {})),
  });
  const keepoutAreas = collectKeepouts({
    keepouts: projection.keepouts ?? [],
    layerCount: board.layerCount,
  });
  const copperZones = zoneAreas.zones;
  const keepouts = keepoutAreas.keepouts;
  // Zones' warnings first, then the keepouts' — the order `checks/zones.ts`
  // reports them in, and the one DRC ever sees.
  const copperAreaWarnings: CopperAreaWarning[] = [
    ...zoneAreas.warnings,
    ...keepoutAreas.warnings,
  ];
  // One shared resolution of every piece of copper geometry (the same records
  // connectivity consumes); DRC applies its own clamp layer policy below.
  const records = buildCopperRecords({
    layerCount: board.layerCount,
    placements: projection.placements,
    padNetIds: new Map(Object.entries(projection.padNets ?? {})),
    freePads: projection.freePads,
    traces: projection.traces,
    vias: projection.vias,
  });
  const validCopperLayers = new Set<PcbCopperLayerId>(
    records.validCopperLayers,
  );

  // Copy every array / point object out of the records at this boundary: the
  // same records also back the connectivity items (`copperItems()` below), and
  // a check that reordered or mutated a DRC primitive in place would otherwise
  // silently corrupt the connectivity graph.
  const traces: DrcTrace[] = records.traces.map((t) => ({
    id: t.id,
    netId: t.netId,
    layer: t.layer,
    widthMm: t.widthMm,
    halfWidthMm: t.halfWidthMm,
    pointsMm: t.pointsMm.map((p) => ({ x: p.x, y: p.y })),
    bounds: { ...t.bounds },
    mid: { ...t.mid },
  }));

  // Clamp-with-fallback (audit B5-VIA-MASK, symmetric with vias): an
  // invalid-layer pad is checked on ALL valid copper layers so its copper
  // still collides with everything until repaired — never masks a short.
  const pads: DrcPad[] = records.pads.map((p) => ({
    anchor: padAnchor(p.anchor),
    netId: p.netId,
    layers: p.declaredLayerInvalid
      ? [...validCopperLayers]
      : [...p.resolvedLayers],
    ring: p.ring.map((v) => ({ x: v.x, y: v.y })),
    bounds: { ...p.bounds },
    center: { ...p.center },
    declaredLayerInvalid: p.declaredLayerInvalid,
  }));

  const holes: DrcHole[] = [];
  // Footprint pads lead the record order, so this reproduces the old
  // placement × pad hole order; free-pad holes follow below because the
  // copper-less NPTH `hole` type has no copper record at all.
  for (const p of records.pads) {
    if (p.anchor.kind !== "pad" || p.drillMm <= 0) continue;
    holes.push({
      anchor: padAnchor(p.anchor),
      kind: "pth",
      netId: p.netId,
      center: { ...p.center },
      drillMm: p.drillMm,
      padOdMm: Math.min(p.widthMm, p.heightMm),
    });
  }
  for (const freePad of projection.freePads) {
    const drill = freePad.drillMm ?? 0;
    if (
      drill > 0 &&
      (freePad.padType === "std" || freePad.padType === "hole")
    ) {
      const isStd = freePad.padType === "std";
      const padSlot = slotCenterline(freePad.centerMm, freePad.drillSlot);
      holes.push({
        anchor: { kind: "freePad", freePadId: freePad.id },
        kind: isStd ? "pth" : "npth",
        netId: isStd ? freePad.netId : null,
        center: freePad.centerMm,
        drillMm: drill,
        ...(isStd
          ? { padOdMm: Math.min(freePad.widthMm, freePad.heightMm) }
          : {}),
        ...(padSlot ? { slot: padSlot } : {}),
      });
    }
  }
  for (const hole of projection.freeHoles) {
    const holeSlot = slotCenterline(hole.centerMm, hole.drillSlot);
    holes.push({
      anchor: { kind: "freeHole", freeHoleId: hole.id },
      kind: "npth",
      netId: null,
      center: hole.centerMm,
      drillMm: hole.drillMm,
      ...(holeSlot ? { slot: holeSlot } : {}),
    });
  }

  const vias: DrcViaGeom[] = records.vias.map((v) => ({
    via: v.via,
    netId: v.netId,
    center: { ...v.center },
    radiusMm: v.radiusMm,
    // Clamp-with-fallback (audit B5-VIA-MASK): a layer-invalid via is checked
    // on every valid copper layer so its physical barrel copper still collides
    // with everything until repaired — it must not vanish from clearance/short.
    layers: v.layerSpanInvalid ? [...validCopperLayers] : [...v.span],
    layerSpanInvalid: v.layerSpanInvalid,
    viaTypeInvalid:
      !v.layerSpanInvalid &&
      !isValidViaSpan(
        v.via.fromLayer,
        v.via.toLayer,
        v.via.viaType,
        board.layerCount,
      ).ok,
    bounds: { ...v.bounds },
  }));

  for (const vg of vias) {
    holes.push({
      anchor: { kind: "via", viaId: vg.via.id },
      kind: "via",
      netId: vg.netId,
      center: vg.center,
      drillMm: vg.via.drillMm,
    });
  }

  const netNames = projection.netNames ?? {};

  // Every net id the rule table could legitimately reference: the projection's
  // named nets PLUS any net a primitive carries but the name map lost — a rule
  // scoped to a copper-bearing net must not be reported as dangling.
  const knownNetIds = new Set<string>(Object.keys(netNames));
  for (const t of traces) if (t.netId) knownNetIds.add(t.netId);
  for (const p of pads) if (p.netId) knownNetIds.add(p.netId);
  for (const v of vias) if (v.netId) knownNetIds.add(v.netId);
  const resolver = createRuleResolver(board, netNames, {
    // Ordered stackup, so a `layer` scope is judged against the real board and
    // multi-layer pairs resolve F.Cu → … → B.Cu (§4.3).
    validCopperLayers: [...records.validCopperLayers],
    knownNetIds,
  });

  const placementById = new Map(projection.placements.map((p) => [p.id, p]));
  // Pad rings grouped by owner, for the last-resort extent branch. Built from
  // `pads` (already copied out of the records) so the accessor stays O(1).
  const padRingsByPlacement = new Map<string, PcbPointMm[][]>();
  for (const p of pads) {
    if (p.anchor.kind !== "pad") continue;
    const rings = padRingsByPlacement.get(p.anchor.placementId);
    if (rings) rings.push(p.ring);
    else padRingsByPlacement.set(p.anchor.placementId, [p.ring]);
  }
  const placementExtentCache = new Map<string, PcbPointMm[] | null>();

  // Lazily built once per context: only the `dfm` dangling check (and future
  // pour-anchoring / routed-length consumers) need the graph, and each enabled
  // pour layer costs a full fill-kernel run.
  let copperItemsCache: readonly CopperItem[] | undefined;
  let connectivityCache: ConnectivityResult | undefined;
  let pourResultsCache:
    | ReadonlyArray<{ zone: EffectiveCopperZone; result: CopperFillResult }>
    | undefined;
  const padNetIds = new Map(Object.entries(projection.padNets ?? {}));
  const ensurePourResults = () => {
    if (pourResultsCache === undefined) {
      // ONE resolver per DRC run (contract §9): the pour resolves through the
      // context's own, not a second one built from the same board — otherwise
      // `problems` and `knownNetIds` could diverge between the report and the
      // fill that produced its copper.
      const nets: ZonePourNets = { resolver };
      pourResultsCache = copperZones.map((zone) => ({
        zone,
        // `records` are the context's own, built from the SAME copper above —
        // an identical input, so the kernel's own build is pure overhead here.
        result: buildCopperFillIslands({
          layerCount: board.layerCount,
          outline: board.outline,
          placements: projection.placements,
          traces: projection.traces,
          vias: projection.vias,
          padNetIds,
          records,
          copperToBoardEdgeMm: board.designRules.clearance.copperToBoardEdgeMm,
          cutouts,
          freeHoles: projection.freeHoles,
          freePads: projection.freePads,
          ...pourParamsForZone(
            zone,
            board.designRules,
            keepouts,
            copperZones,
            nets,
          ),
        }),
      }));
    }
    return pourResultsCache;
  };
  const ensureConnectivity = (): ConnectivityResult => {
    if (connectivityCache === undefined) {
      // Net-bound zones only, in derivation order — the position here is the
      // `pourIndex` of `pour:<layer>:<net>:<pourIndex>:<island>`, unchanged.
      const pours: BoardPourFill[] = [];
      for (const { zone, result } of ensurePourResults()) {
        if (zone.netId === null) continue;
        pours.push({ layer: zone.layer, netId: zone.netId, result });
      }
      const { items, result } = computeBoardConnectivity({
        layerCount: board.layerCount,
        placements: projection.placements,
        padNetIds,
        freePads: projection.freePads,
        traces: projection.traces,
        vias: projection.vias,
        pours,
      });
      copperItemsCache = items;
      connectivityCache = result;
    }
    return connectivityCache;
  };

  return {
    projection,
    designRules: board.designRules,
    netClasses: board.netClasses,
    fabricator: board.fabricator,
    validCopperLayers,
    traces,
    pads,
    vias,
    holes,
    boardThicknessMm: board.boardThicknessMm ?? DEFAULT_BOARD_THICKNESS_MM,
    holeToHoleMm:
      board.designRules.minimums.holeToHoleMm ?? DEFAULT_HOLE_TO_HOLE_MM,
    holeToBoardEdgeMm:
      board.designRules.clearance.holeToBoardEdgeMm ??
      DEFAULT_HOLE_TO_BOARD_EDGE_MM,
    // Already canonicalised by buildBoardRegion — no second flatten.
    outlineRing: boardRegion.unbiasedOuter,
    cutoutRings: boardRegion.unbiasedHoles,
    boardRegion,
    copperZones,
    keepouts,
    copperAreaWarnings,
    ratsnest: projection.ratsnest,
    netNames,
    netClassClearanceMm: resolver.netClassClearanceMm,
    netClassIdOf: resolver.netClassIdOf,
    resolver,
    copperItems() {
      ensureConnectivity();
      return copperItemsCache!;
    },
    connectivity: ensureConnectivity,
    pourResults: ensurePourResults,
    placementExtent(placementId) {
      const cached = placementExtentCache.get(placementId);
      if (cached !== undefined) return cached;
      const placement = placementById.get(placementId);
      const extent = placement
        ? placementKeepoutExtentMm(
            placement,
            padRingsByPlacement.get(placementId) ?? [],
            options.lookupRawFootprint,
          )
        : null;
      placementExtentCache.set(placementId, extent);
      return extent;
    },
  };
}

/** AABB-to-AABB minimum gap (0 if overlapping). Broad-phase prefilter. */
export function aabbGap(a: RingBounds, b: RingBounds): number {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
  return Math.sqrt(dx * dx + dy * dy);
}

export function layersOverlap(
  a: readonly PcbCopperLayerId[],
  b: readonly PcbCopperLayerId[],
): boolean {
  for (const layer of a) if (b.includes(layer)) return true;
  return false;
}
