// Precomputed, mm-domain view of a PCB projection for the DRC engine.
//
// Resolves the data-model gotchas once, up front, so the individual checks stay
// simple: trace points are converted nm→mm; footprint/free pads become world
// polygons grouped by the copper layer(s) they occupy (through-hole spans both
// sides — fixes live-drc's "all pads on the active layer" approximation); vias
// become circles spanning their barrel layers; every primitive carries an AABB
// for the O(n²) broad-phase prefilter. Drilled holes come from the ONE drill
// derivation per object (`footprintPadDrill` / `freePadDrill` /
// `drillSlotCenterline`, contract 10 §1.1), so EVERY drilled pad is a `DrcHole`
// whether or not it carries copper — including the `smd` / `conn` free pads
// whose drill the Excellon writer and the pour have always treated as a
// non-plated hit (contract 06 §2).

import type {
  DesignerPcbProjection,
  DrcAnchor,
  DrcPairKind,
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbDesignRules,
  PcbFabricatorId,
  PcbFreeHole,
  PcbFreePad,
  PcbLayerCount,
  PcbNetClass,
  PcbPlacedPart,
  PcbPointMm,
  PcbVia,
} from "../../sdks/designer";
import {
  DEFAULT_BOARD_THICKNESS_MM,
  isValidViaSpan,
} from "../../sdks/designer";
import {
  createBroadPhase,
  type BroadPhaseNear,
  type BroadPhaseNearPolyline,
} from "./broad-phase";
import {
  placementCourtyardRegionsMm,
  type PlacementCourtyardRegions,
} from "../pcb-geometry/courtyard-rings";
import {
  buildSilkArtwork,
  type SilkArtwork,
} from "../rendering/pcb/artwork/silk-artwork";
import {
  buildMaskOpenings,
  buildPadShapeIndex,
  type MaskFace,
  type MaskOpening,
} from "../rendering/pcb/artwork/mask-artwork";
import { apertureShapeRing } from "../rendering/pcb/artwork/aperture-shape";
// Type-only for the context; the VALUE is the check's own documented default
// (contract 11 §6). `checks/courtyard.ts` type-imports this module, so the
// edge is one-way at runtime.
import { DEFAULT_COURTYARD_FALLBACK_MM } from "./checks/courtyard";
// Type-only (erased at runtime): `checks/clearance-judge.ts` imports values
// from this module, so a value import here would be a real cycle.
import type { BridgeEntry } from "./checks/clearance-judge";
import { outlineProblems } from "./checks/outline";
import { anchorKey } from "./violation-id";
import { FAB_PRESETS } from "./fab-presets";
import { GEOM_EPS_MM, SHORT_EPS_MM } from "../pcb-geometry/tolerance";
import {
  boardMinimumFor,
  copperToHoleClearanceMm,
  createRuleResolver,
  type RuleResolver,
} from "./rule-resolver";
import {
  buildCopperRecords,
  type CopperPadAnchor,
} from "../pcb-connectivity/copper-records";
import { padRecordKey } from "../pcb-connectivity/copper-items";
import type {
  ConnectivityResult,
  CopperItem,
  CopperRecords,
} from "../pcb-connectivity";
import {
  footprintPadDrill,
  freeHoleDrill,
  freePadDrill,
} from "../rendering/pcb/pcb-drills";
import {
  annularRingMm,
  type DrillGeometry,
} from "../pcb-geometry/pad-annular";
import {
  freePadCopperShape,
  padCopperShape,
  placementPads,
} from "../pcb-geometry/pad-geometry";
import {
  computeBoardConnectivity,
  type BoardPourFill,
} from "../pcb-connectivity/board-connectivity";
import {
  collectCopperZones,
  collectKeepouts,
  pourParamsForZone,
  type CopperAreaWarning,
  type EffectiveCopperZone,
  type EffectiveKeepout,
  type ZonePourNets,
} from "../pcb-areas";
import {
  buildCopperFillIslands,
  type CopperFillResult,
} from "../rendering/copper-fill/copper-fill-geometry";
import { buildBoardRegion, type BoardRegion } from "../pcb-geometry/board-region";
import {
  buildRegionIndex,
  type RegionIndex,
} from "../pcb-geometry/region-index";
import { ipc2221SpacingMm } from "./ipc2221-spacing";
import { placementKeepoutExtentMm } from "../pcb-geometry/placement-extent";
import type {
  DrcBroadPhaseMode,
  DrcOptions,
  DrcRunStats,
  DrcTick,
  DrcViolationDraft,
} from "./types";
import {
  DEFAULT_COPPER_SHAPE_BUDGETS,
  type CopperShapeBudgets,
} from "../rendering/copper-fill/copper-shape-kernel";
import { boundsOfPoints } from "../pcb-geometry/region-rings";
import type { RingBounds } from "../pcb-geometry/pad-outline";
import type { Point } from "../pcb-geometry/pcb-trace-geometry";

/** Default minimums when a (pre-DRC) board lacks the optional rule field. */
export const DEFAULT_HOLE_TO_BOARD_EDGE_MM = 0.3;

// The tolerance policy moved to pcb/tolerance.ts (P1 epsilon unification) so
// fab validators and creation gates share it; re-exported here because every
// check imports it from the context module.
export { below, DRC_EPS_MM } from "../pcb-geometry/tolerance";

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
  /**
   * The S1 item key of the pad's copper record (`padRecordKey`, no layer) —
   * the SAME identity a mask opening's `ownerKey` carries. The anchor cannot
   * stand in for it: one pin with several copper shapes is several records
   * under one anchor, so `checks/solder-mask.ts` could not tell an opening's
   * own pad from its neighbour's without it (DFM contract 11 §4).
   */
  key: string;
  netId: string | null;
  layers: PcbCopperLayerId[];
  ring: PcbPointMm[];
  bounds: RingBounds;
  center: PcbPointMm;
  /**
   * Exact disc of a TRUE circular pad, carried straight from the copper record.
   * `ring` circumscribes arcs (it inflates by sec(π/48) so DRC over-reports
   * rather than misses), which is a ~0.2 %·r false-fail band on a circle; a
   * check that has an exact circle path uses this instead. Absent for every
   * non-circular pad.
   */
  disc?: { center: PcbPointMm; radiusMm: number };
  /**
   * False for a `custom` / `trapezoid` pad, whose `ring` is a bounding
   * rectangle: a declared superset the clearance tiers may over-report on but
   * the intra-footprint SHORT tier must not judge (contract 06 §4, R1 #4).
   */
  exactShape: boolean;
  /**
   * True when the pad declared an explicit copper layer not valid for this
   * stackup (e.g. In1.Cu on a 2-layer board). Flagged as PAD_LAYER_MISMATCH;
   * such pads are still collision-checked on every valid layer (fallback) so
   * they cannot mask a short (audit B5-PAD-LAYER, B5-VIA-MASK).
   */
  declaredLayerInvalid: boolean;
  /**
   * The pad's drill wall is plated (contract 10 §2). False copper is
   * mechanical: it keeps its net for clearance and the pour, but carries no
   * connectivity — `checks/structural.ts` reports a net bound to such a pad.
   */
  plated: boolean;
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

/** Where the items sharing one anchor key live, as indices into the context. */
export interface AnchorItemIndex {
  traces: readonly number[];
  pads: readonly number[];
  vias: readonly number[];
}

/** Any drilled hole (via barrel / TH pad / std-or-NPTH free pad / free hole). */
export interface DrcHole {
  anchor: DrcAnchor;
  /** Hole class: via barrel / plated component hole / non-plated hole. */
  kind: "via" | "pth" | "npth";
  /** Net the hole's copper belongs to (null for mechanical / NPTH holes). */
  netId: string | null;
  center: PcbPointMm;
  /** Tool diameter (mm) — the slot WIDTH for a routed slot. */
  drillMm: number;
  /**
   * Slot centerline (mm) for oblong drills, so edge/spacing checks use the true
   * slot geometry instead of a round-hole model (audit B2-5). Absent for round
   * holes.
   */
  slot?: { a: PcbPointMm; b: PcbPointMm; widthMm: number };
  /**
   * The EXACT minimum copper width around the drill wall (manufacturability
   * contract 10 §3), computed once here and carried on the hole. Set when the
   * hole has copper around it — every `pth`, and an `npth` that owns a ring;
   * undefined for vias (their concentric ring is judged on `DrcViaGeom`) and
   * for copper-less holes. A NEGATIVE value is a breakout margin, not an exact
   * wall measurement (§3.1). It replaces the pre-S11 bounding-box outer
   * diameter, which mis-measured every oval, roundrect, rotated, offset or
   * slotted pad (B2-6).
   */
  annularRingMm?: number;
}

/**
 * Everything `buildDrcItems` needs. A `DesignerPcbProjection` satisfies it
 * structurally, and so does the row form the command dispatcher already holds
 * (live-parity contract 07 §6) — the point of the narrower type is that the
 * legality core never sees `ratsnest`, `warnings` or the projection's identity.
 */
export type LegalityInput = Pick<
  DesignerPcbProjection,
  | "board"
  | "placements"
  | "traces"
  | "vias"
  | "freePads"
  | "freeHoles"
  | "zones"
  | "keepouts"
  | "padNets"
  | "netNames"
>;

/**
 * The EAGER physical model of a board: every item, area, region and rule value
 * a pair or per-item judgement reads, and nothing that needs the connectivity
 * graph or a pour (07 §2 D2). Batch DRC extends it with the lazy layer;
 * `legality.ts` runs the pending-copper gate on it alone.
 */
export interface LegalityContext {
  board: PcbBoardSettings;
  placements: readonly PcbPlacedPart[];
  layerCount: PcbLayerCount;
  designRules: PcbDesignRules;
  netClasses: PcbNetClass[];
  fabricator: PcbFabricatorId;
  validCopperLayers: Set<PcbCopperLayerId>;
  traces: DrcTrace[];
  pads: DrcPad[];
  vias: DrcViaGeom[];
  /** Every drilled hole on the board, for hole-to-hole spacing. */
  holes: DrcHole[];
  /**
   * `anchorKey` of `holes[i]`, precomputed. The hole pair loop is O(n²) in the
   * keys and used to rebuild them on every call — a per-item fact paid per
   * pair, and on the interactive path (R1 #2).
   */
  holeKeys: readonly string[];
  /** Finished board thickness (mm); for via aspect-ratio. */
  boardThicknessMm: number;
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
  /**
   * The one copper-geometry resolution this run is built on. Exposed because
   * `checks/connectivity.ts` derives its OWN ratsnest from `connectivity()` +
   * these records (contract 06 §1) instead of trusting the caller's
   * `projection.ratsnest`: one model, one fill, no second kernel run.
   */
  copperRecords: CopperRecords;
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
   * Upper bound of EVERY clearance any pair on this board can resolve to: the
   * board tier of every pair kind, every enabled clearance rule and the floor
   * (all folded into `clearanceBound`), the largest net-class contribution
   * (either item of a pair may raise the implicit tier, and a neighbour's net
   * is not known when a query window is sized), the fabricator minimum and the
   * short epsilon. The one halo the broad phase may be queried with.
   */
  maxClearanceBoundMm: number;
  /**
   * The hole-side twin of `maxClearanceBoundMm`: an upper bound of every value
   * a hole pair or a copper↔NPTH pair can resolve to — the copper-to-hole
   * clearance, the board `holeToHole` minimum, every explicit `holeToHole`
   * rule, the fabricator's two hole floors and the short epsilon. The one halo
   * `near("holes", …)` may be queried with (R1 #2).
   */
  maxHoleBoundMm: number;
  /**
   * The board's `BOARD_OUTLINE_INVALID` drafts, computed ONCE — `checkOutline`
   * returns a copy of exactly these, so the gate's view of the outline and the
   * report's cannot drift, and `runDrc` does not pay for the verdict twice
   * (R1 #5).
   */
  outlineDrafts: readonly DrcViolationDraft[];
  /**
   * `BOARD_OUTLINE_INVALID` would fire on this board. The commit gate reports
   * rather than refuses `COPPER_OFF_BOARD` / `COPPER_TO_BOARD_EDGE` when it is
   * set (07 §6): rerouting cannot fix an outline.
   */
  outlineInvalid: boolean;
  /**
   * The halo of the board-edge tiers: `copperToBoardEdgeMm`, the resolved
   * `holeToBoardEdgeMm` and every `edgeClearance` rule's `minMm` (enabled or
   * not — a larger bound is always superset-safe). The one halo the boundary
   * edge index may be queried with where the value is COMPARED (08 §5).
   */
  maxEdgeBoundMm: number;
  /**
   * The creepage halo: `ipc2221SpacingMm(max(V ∪ {0}) − min(V ∪ {0}), "B2")`
   * over every net class's `voltageV`, plus the geometry epsilon. A pair's
   * voltage difference is `u.voltage − v.voltage` with one side possibly 0 V,
   * so the widest difference is max − min over `V ∪ {0}`; `ipc2221SpacingMm` is
   * monotone in |ΔV| and the B2 column dominates B1 on every band (08 §5).
   */
  maxCreepageBoundMm: number;
  /**
   * Which enumeration the checks discover candidates with (08 §3).
   * `"exhaustive"` keeps the pre-S9 loops as the oracle; both modes report the
   * same bytes.
   */
  broadPhase: DrcBroadPhaseMode;
  /**
   * Grid broad phase over the four item arrays — a SUPERSET of every item
   * within the halo, so a caller that follows it with the exact `aabbGap`
   * filter reaches the batch verdict.
   */
  near: BroadPhaseNear;
  /**
   * The polyline form of {@link near}, for a TRACE subject: the union of the
   * subject's own sub-segment boxes (08 §2.1). Tighter than the subject's AABB
   * on a diagonal, and a superset of every item whose copper is within the
   * halo — which is all the pair bodies need (§1 L1).
   */
  nearPolyline: BroadPhaseNearPolyline;
  /**
   * Boundary-edge index over `boardRegion` (08 §2.2) — the region predicates'
   * optional trailing argument. Built once with the context.
   */
  regionIndex: RegionIndex;
  /**
   * Enumeration counters for the oracle harness and the bench (08 §7), or
   * `undefined`. Written, never read: a run with stats reports the same bytes.
   */
  stats: DrcRunStats | undefined;
  /**
   * Memo of an unassigned BOARD item's own null-net touches, by anchor key
   * (07 §7): the bridge completion is a function of the board alone, so a
   * route session pays one broad-phase walk per touched item per revision
   * rather than one per pointer move. `null` = computed, touches nothing.
   * Only filled for an empty `replaces` set — `replaces` changes the board.
   */
  boardBridgeCache: Map<string, BridgeEntry | null>;
  /**
   * `placement.reference` by id, built on first use — `checks/keepouts.ts`
   * needs it for a pad's subject noun and used to rebuild it from every
   * placement on every call (R1 #2).
   */
  placementReference(placementId: string): string;
  /**
   * Copper items grouped by `anchorKey`, built on first use (Astra R2 #3). A
   * pin is several `DrcPad` shapes under ONE key, so the bridge completion has
   * to walk them all — and it used to find them by scanning every trace, pad
   * and via PER KEY: a pending run touching 100 unassigned board traces on a
   * 5 000-item board paid 100 full passes on the first pointer move. One
   * memoised O(board) pass instead.
   */
  itemsByAnchorKey(): ReadonlyMap<string, AnchorItemIndex>;
}

export interface DrcContext extends LegalityContext {
  projection: DesignerPcbProjection;
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
  /**
   * The run's execution checkpoint (contract 09 §6), for the checks that do
   * PER-ITEM work and so cannot be checkpointed by `drcDrafts`'s per-stage call
   * alone — the pour ticks through `options.tick` directly, `copper-shape.ts`
   * through this. `DrcOptions.tick` stays the only seam; this is the same
   * function, not a second one.
   */
  tick: DrcTick | undefined;
  /**
   * The resolved copper-shape engineering limits (DFM contract 11 §5.5) —
   * defaults unless a test lowered them through `DrcOptions`.
   */
  copperShapeBudgets: CopperShapeBudgets;
  /**
   * The placement's courtyard REGION per face (DFM contract 11 §2.1), lazily
   * resolved and cached beside `placementExtent` — the pair loop asks for every
   * placement once per partner, and stitching the graphics is not free.
   *
   * Deliberately NOT `placementExtent`: that is a convex HULL, which fills a
   * U-shaped connector's cut-out and a donut's hole, so two parts that nest
   * correctly would read as overlapping.
   */
  placementCourtyard(placementId: string): PlacementCourtyardRegions;
  /**
   * THE silkscreen artwork of this board (DFM contract 11 §1.2) — the same
   * model the Gerber writer emits. Lazy: a run that skips the `dfm` class pays
   * nothing.
   */
  silkArtwork(): SilkArtwork;
  /** THE solder-mask openings of one FACE, with a broad phase over them (§1.3). */
  maskIndex(face: MaskFace): MaskFaceIndex;
}

/**
 * One face's mask openings, their rings and an index over them. The rings are
 * built ONCE here because both DFM consumers need them: `checks/silkscreen.ts`
 * measures legend ink against them and `checks/solder-mask.ts` measures them
 * against each other and against copper.
 */
export interface MaskFaceIndex {
  openings: readonly MaskOpening[];
  /** `apertureShapeRing` of `openings[i]`, in the same order. */
  rings: ReadonlyArray<readonly PcbPointMm[]>;
  bounds: readonly RingBounds[];
  /**
   * Box query over `bounds`, filed under the `pads` kind — the openings are
   * flashed apertures, so their filed geometry IS their AABB and a query is a
   * superset of every opening within the halo (08 §2.1).
   */
  near: BroadPhaseNear;
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

/** A drill derivation as the annular-ring kernel takes it (contract 10 §3). */
function drillGeometry(
  centerMm: PcbPointMm,
  drill: { drillMm: number; slot?: { a: PcbPointMm; b: PcbPointMm } },
): DrillGeometry {
  return {
    centerMm,
    radiusMm: drill.drillMm / 2,
    ...(drill.slot ? { slot: { a: drill.slot.a, b: drill.slot.b } } : {}),
  };
}

/** The four DRC item arrays of one copper-record set, under the clamp policy. */
export interface DrcItems {
  traces: DrcTrace[];
  pads: DrcPad[];
  vias: DrcViaGeom[];
  holes: DrcHole[];
}

/**
 * Records → DRC primitives. Factored out of `buildDrcItems` because
 * `legality.ts` maps the PENDING copper's records with exactly this function:
 * one clamp policy, one hole derivation, one bounds convention for the board's
 * items and the ones about to be committed (07 §4).
 */
export function itemsFromRecords(
  records: CopperRecords,
  validCopperLayers: ReadonlySet<PcbCopperLayerId>,
  layerCount: PcbLayerCount,
  freePads: readonly PcbFreePad[],
  freeHoles: readonly PcbFreeHole[],
  placements: readonly PcbPlacedPart[],
): DrcItems {
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
    key: padRecordKey(p),
    netId: p.netId,
    layers: p.declaredLayerInvalid
      ? [...validCopperLayers]
      : [...p.resolvedLayers],
    ring: p.ring.map((v) => ({ x: v.x, y: v.y })),
    bounds: { ...p.bounds },
    center: { ...p.center },
    // Copied, not aliased — same reason as every other field here: a check that
    // mutated it in place would corrupt the connectivity records.
    ...(p.disc
      ? { disc: { center: { ...p.disc.center }, radiusMm: p.disc.radiusMm } }
      : {}),
    exactShape: p.exactShape,
    declaredLayerInvalid: p.declaredLayerInvalid,
    plated: p.plated,
  }));

  // Holes are derived from the DRILLED OBJECTS, never from the copper records
  // (contract 10 §1.3): a drilled pad yields exactly one hole whether it has
  // copper or not, so a copper-less non-plated pad still faces DRILL_SIZE_MIN,
  // HOLE_TO_HOLE, HOLE_TO_BOARD_EDGE, HOLE_OFF_BOARD and COPPER_TO_HOLE. The
  // records are consulted only for what the COPPER says: the net a plated pad
  // carries, and whether an unplated pad owns a ring at all.
  const padNetByAnchor = new Map<string, string | null>();
  const recordedShapes = new Set<string>();
  const recordedFreePads = new Set<string>();
  for (const p of records.pads) {
    if (p.anchor.kind !== "pad") {
      recordedFreePads.add(p.anchor.freePadId);
      continue;
    }
    const key = `${p.anchor.placementId}|${p.anchor.padNumber}`;
    // First occurrence wins; every occurrence of one pin carries the same
    // `padNets` net, so the choice is only about which object is read.
    if (!padNetByAnchor.has(key)) padNetByAnchor.set(key, p.netId);
    recordedShapes.add(`${key}|${p.occurrence}`);
  }

  const holes: DrcHole[] = [];
  // Placements × preview pads, then free pads, then free holes, then vias
  // (§1.3). Projection order, never sorted: the report's byte identity under
  // input reversal comes from the canonical sort, not from the hole order.
  for (const placement of placements) {
    const occurrenceByNumber = new Map<string, number>();
    for (const pad of placementPads(placement)) {
      const occurrence = occurrenceByNumber.get(pad.number) ?? 0;
      occurrenceByNumber.set(pad.number, occurrence + 1);
      const drill = footprintPadDrill(pad, placement);
      if (!drill) continue;
      const anchorKey = `${placement.id}|${pad.number}`;
      const hasRing =
        drill.plated || recordedShapes.has(`${anchorKey}|${occurrence}`);
      holes.push({
        anchor: {
          kind: "pad",
          placementId: placement.id,
          padNumber: pad.number,
        },
        kind: drill.plated ? "pth" : "npth",
        // Unplated copper carries no net through the hole (§2.4).
        netId: drill.plated ? (padNetByAnchor.get(anchorKey) ?? null) : null,
        center: { ...drill.centerMm },
        drillMm: drill.drillMm,
        ...(drill.slot ? { slot: drill.slot } : {}),
        ...(hasRing
          ? {
              annularRingMm: annularRingMm(
                padCopperShape(placement, pad),
                drillGeometry(drill.centerMm, drill),
              ),
            }
          : {}),
      });
    }
  }
  // EVERY drilled free pad, not just `std` / `hole`: the drill of an `smd` or
  // `conn` pad reaches the fab as a non-plated hit (contract 06 §2), so it must
  // face the same minimum / spacing / edge checks as a free hole.
  for (const freePad of freePads) {
    const drill = freePadDrill(freePad);
    if (!drill) continue;
    // A `hole` free pad has no copper record at all — no ring to measure.
    const hasRing = drill.plated || recordedFreePads.has(freePad.id);
    holes.push({
      anchor: { kind: "freePad", freePadId: freePad.id },
      kind: drill.plated ? "pth" : "npth",
      netId: drill.plated ? freePad.netId : null,
      center: freePad.centerMm,
      drillMm: drill.drillMm,
      ...(drill.slot ? { slot: drill.slot } : {}),
      ...(hasRing
        ? {
            annularRingMm: annularRingMm(
              freePadCopperShape(freePad),
              drillGeometry(freePad.centerMm, drill),
            ),
          }
        : {}),
    });
  }
  for (const hole of freeHoles) {
    // THE one free-hole derivation: the tool is the slot width whenever a slot
    // is declared, so DRC and Excellon can never disagree about the bit
    // (Astra run 2b #1).
    const drill = freeHoleDrill(hole);
    if (!drill) continue;
    holes.push({
      anchor: { kind: "freeHole", freeHoleId: hole.id },
      kind: "npth",
      netId: null,
      center: drill.centerMm,
      drillMm: drill.drillMm,
      ...(drill.slot ? { slot: drill.slot } : {}),
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
        layerCount,
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

  return { traces, pads, vias, holes };
}

/** Every pair kind a clearance can resolve for; `maxClearanceBoundMm` maxes them. */
const DRC_PAIR_KINDS: readonly DrcPairKind[] = [
  "traceToTrace",
  "traceToPad",
  "traceToVia",
  "padToPad",
  "padToVia",
  "viaToVia",
  "pourToTrace",
  "pourToPad",
  "pourToVia",
  "pourToPour",
];

/** The fabricator's clearance floor, or 0 for `custom` (its own opt-out). */
export function fabMinClearanceMm(fabricator: PcbFabricatorId): number {
  return fabricator === "custom"
    ? 0
    : (FAB_PRESETS[fabricator]?.minClearanceMm ?? 0);
}

/**
 * The one halo that cannot skip a violating pair: every term `clearanceBound`
 * maxes, over every pair kind and every net class (an unknown neighbour's class
 * may raise the implicit tier), plus the fab tier and the short epsilon —
 * exactly the terms `checks/clearance.ts` compares `aabbGap` against.
 */
function maxClearanceBound(
  board: PcbBoardSettings,
  resolver: RuleResolver,
): number {
  let max = Math.max(SHORT_EPS_MM, fabMinClearanceMm(board.fabricator));
  for (const kind of DRC_PAIR_KINDS) {
    max = Math.max(max, resolver.clearanceBound(kind, null, null));
  }
  for (const cls of board.netClasses) max = Math.max(max, cls.clearanceMm);
  return max;
}

/**
 * The hole-side halo: every term a hole pair or a copper↔NPTH pair can resolve
 * to. Disabled and invalid rules are included on purpose — a larger bound is
 * always superset-safe, and this must never skip a violating pair.
 */
function maxHoleBound(board: PcbBoardSettings): number {
  const preset =
    board.fabricator === "custom"
      ? null
      : (FAB_PRESETS[board.fabricator] ?? null);
  let max = Math.max(
    SHORT_EPS_MM,
    copperToHoleClearanceMm(board.designRules),
    boardMinimumFor("holeToHole", board.designRules),
    preset ? Math.max(preset.holeToHoleViaMm, preset.holeToHolePthMm) : 0,
  );
  for (const rule of board.drcRules ?? []) {
    if (rule.constraint.kind === "holeToHole") {
      max = Math.max(max, rule.constraint.minMm);
    }
  }
  return max;
}

/**
 * The board-edge halo: `scalar("edgeClearance", …).mm` is either an
 * `edgeClearance` rule's value or the board value, so the max over both bounds
 * every value the edge tiers can compare against. Disabled and invalid rules
 * are included on purpose — a larger bound is always superset-safe.
 */
function maxEdgeBound(
  board: PcbBoardSettings,
  holeToBoardEdgeMm: number,
): number {
  let max = Math.max(
    board.designRules.clearance.copperToBoardEdgeMm,
    holeToBoardEdgeMm,
  );
  for (const rule of board.drcRules ?? []) {
    if (rule.constraint.kind === "edgeClearance") {
      max = Math.max(max, rule.constraint.minMm);
    }
  }
  return max;
}

/**
 * The creepage halo: the IPC-2221 B2 spacing of the WIDEST voltage difference
 * any pair on this board can present. One side of a pair may be an unassigned
 * or classless net at 0 V, so the difference is bounded by
 * `max(V ∪ {0}) − min(V ∪ {0})` (not `max|V|`); `ipc2221SpacingMm` is monotone
 * non-decreasing in |ΔV| and B2 ≥ B1 on every band, and `strictestSpacing`
 * maxes over the layer column — so B2 at the widest difference bounds it.
 */
function maxCreepageBound(board: PcbBoardSettings): number {
  let lo = 0;
  let hi = 0;
  for (const cls of board.netClasses) {
    const v = cls.voltageV ?? 0;
    // A non-finite voltage anywhere on the board makes the halo FAIL OPEN:
    // `Infinity` turns every creepage query into "every index". Skipping it
    // left the halo at the finite classes' value while the NaN pair still
    // demanded the 2.5 mm band (R1 #3); PROPAGATING it was worse — a NaN
    // difference resolves to that 2.5 mm band, which is BELOW what a finite
    // pair on the same board can require (an 800 V pair needs 4 mm), so the
    // finite pair was silently dropped (Astra A2 #1). Only an infinite halo
    // bounds both.
    if (!Number.isFinite(v)) return Number.POSITIVE_INFINITY;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return ipc2221SpacingMm(hi - lo, "B2") + GEOM_EPS_MM;
}

/** The drill's own extent: the disc, or the slot stadium, as a box. */
export function holeBounds(hole: DrcHole): RingBounds {
  if (hole.slot) {
    const r = hole.slot.widthMm / 2;
    return {
      minX: Math.min(hole.slot.a.x, hole.slot.b.x) - r,
      minY: Math.min(hole.slot.a.y, hole.slot.b.y) - r,
      maxX: Math.max(hole.slot.a.x, hole.slot.b.x) + r,
      maxY: Math.max(hole.slot.a.y, hole.slot.b.y) + r,
    };
  }
  const r = hole.drillMm / 2;
  return {
    minX: hole.center.x - r,
    minY: hole.center.y - r,
    maxX: hole.center.x + r,
    maxY: hole.center.y + r,
  };
}

/**
 * The eager half of the context (07 §2 D2): items, areas, region, rules, the
 * clearance bound, outline validity and the broad phase. No connectivity, no
 * pour, no projection — everything a pending-copper judgement needs and
 * nothing that costs a fill.
 */
export function buildDrcItems(
  input: LegalityInput,
  options: Pick<DrcOptions, "broadPhase" | "stats"> = {},
): LegalityContext {
  const { board } = input;
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
    zones: input.zones,
    layerCount: board.layerCount,
    knownNetIds: new Set(Object.keys(input.netNames ?? {})),
  });
  const keepoutAreas = collectKeepouts({
    keepouts: input.keepouts ?? [],
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
    placements: input.placements,
    padNetIds: new Map(Object.entries(input.padNets ?? {})),
    freePads: input.freePads,
    traces: input.traces,
    vias: input.vias,
  });
  const validCopperLayers = new Set<PcbCopperLayerId>(
    records.validCopperLayers,
  );

  const { traces, pads, vias, holes } = itemsFromRecords(
    records,
    validCopperLayers,
    board.layerCount,
    input.freePads,
    input.freeHoles,
    input.placements,
  );

  const netNames = input.netNames ?? {};
  // Lazy: only `checks/keepouts.ts` needs it, and only when a keepout exists.
  let referenceById: Map<string, string> | undefined;
  // Lazy: only the null-net bridge completion needs it, and only when a pending
  // item actually touches unassigned board copper.
  let anchorIndex: Map<string, AnchorItemIndex> | undefined;

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

  const holeToBoardEdgeMm =
    board.designRules.clearance.holeToBoardEdgeMm ??
    DEFAULT_HOLE_TO_BOARD_EDGE_MM;
  // One grid, two query forms: the trace entries are per sub-segment, so the
  // polyline form has to come out of the SAME build as the box form (08 §2.1).
  const broadPhase = createBroadPhase({
    traces,
    pads: pads.map((p) => p.bounds),
    vias: vias.map((v) => v.bounds),
    holes: holes.map(holeBounds),
  });

  const legality: LegalityContext = {
    board,
    placements: input.placements,
    layerCount: board.layerCount,
    designRules: board.designRules,
    netClasses: board.netClasses,
    fabricator: board.fabricator,
    validCopperLayers,
    traces,
    pads,
    vias,
    holes,
    holeKeys: holes.map((h) => anchorKey(h.anchor)),
    boardThicknessMm: board.boardThicknessMm ?? DEFAULT_BOARD_THICKNESS_MM,
    holeToBoardEdgeMm,
    // Already canonicalised by buildBoardRegion — no second flatten.
    outlineRing: boardRegion.unbiasedOuter,
    cutoutRings: boardRegion.unbiasedHoles,
    boardRegion,
    copperZones,
    keepouts,
    copperAreaWarnings,
    copperRecords: records,
    netNames,
    netClassClearanceMm: resolver.netClassClearanceMm,
    netClassIdOf: resolver.netClassIdOf,
    resolver,
    maxClearanceBoundMm: maxClearanceBound(board, resolver),
    maxHoleBoundMm: maxHoleBound(board),
    maxEdgeBoundMm: maxEdgeBound(board, holeToBoardEdgeMm),
    maxCreepageBoundMm: maxCreepageBound(board),
    broadPhase: options.broadPhase ?? "grid",
    // Filled immediately below — `outlineProblems` needs the region fields this
    // very object carries, so the one computation runs after the literal.
    outlineDrafts: [],
    outlineInvalid: false,
    near: broadPhase.near,
    nearPolyline: broadPhase.nearPolyline,
    regionIndex: buildRegionIndex(boardRegion),
    stats: options.stats,
    boardBridgeCache: new Map(),
    itemsByAnchorKey() {
      if (anchorIndex === undefined) {
        anchorIndex = new Map<string, AnchorItemIndex>();
        const entry = (key: string): AnchorItemIndex => {
          let e = anchorIndex!.get(key);
          if (!e) {
            e = { traces: [], pads: [], vias: [] };
            anchorIndex!.set(key, e);
          }
          return e;
        };
        traces.forEach((t, i) => {
          (entry(anchorKey({ kind: "trace", traceId: t.id })).traces as number[]).push(i);
        });
        pads.forEach((pd, i) => {
          (entry(anchorKey(pd.anchor)).pads as number[]).push(i);
        });
        vias.forEach((v, i) => {
          (entry(anchorKey({ kind: "via", viaId: v.via.id })).vias as number[]).push(i);
        });
      }
      return anchorIndex;
    },
    placementReference(placementId) {
      if (referenceById === undefined) {
        referenceById = new Map(
          input.placements.map((pl) => [pl.id, pl.reference] as const),
        );
      }
      return referenceById.get(placementId) ?? placementId;
    },
  };
  legality.outlineDrafts = outlineProblems(legality);
  legality.outlineInvalid = legality.outlineDrafts.length > 0;
  return legality;
}

/**
 * The full batch context: the eager items plus the lazy connectivity / pour /
 * placement-extent layer no pending-copper judgement needs.
 */
export function buildDrcContext(
  projection: DesignerPcbProjection,
  options: DrcOptions = {},
): DrcContext {
  const legality = buildDrcItems(projection, {
    broadPhase: options.broadPhase,
    stats: options.stats,
  });
  const { board } = projection;
  const cutouts = board.cutouts ?? [];
  const {
    copperZones,
    keepouts,
    copperRecords: records,
    resolver,
    pads,
  } = legality;

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
  const courtyardCache = new Map<string, PlacementCourtyardRegions>();
  // Absent reads as the IPC-7351B level B courtyard excess (contract 11 §6).
  const courtyardFallbackMm =
    board.designRules.dfm?.courtyardFallbackMm ?? DEFAULT_COURTYARD_FALLBACK_MM;

  // Lazily built once per context: only the `dfm` dangling check (and future
  // pour-anchoring / routed-length consumers) need the graph, and each enabled
  // pour layer costs a full fill-kernel run.
  let copperItemsCache: readonly CopperItem[] | undefined;
  let connectivityCache: ConnectivityResult | undefined;
  let pourResultsCache:
    | ReadonlyArray<{ zone: EffectiveCopperZone; result: CopperFillResult }>
    | undefined;
  // The two artwork models (contract 11 §1), lazy for the same reason the pour
  // is: a run that does not reach the DFM checks pays for neither.
  let silkCache: SilkArtwork | undefined;
  let maskOpeningsCache: readonly MaskOpening[] | undefined;
  const maskIndexCache = new Map<MaskFace, MaskFaceIndex>();
  const ensureMaskOpenings = (): readonly MaskOpening[] => {
    if (maskOpeningsCache === undefined) {
      maskOpeningsCache = buildMaskOpenings({
        solderMaskExpansionMm: board.solderMaskExpansionMm,
        layerCount: board.layerCount,
        placements: projection.placements,
        freePads: projection.freePads,
        vias: projection.vias,
        // The context's OWN records — the same copper every other check reads,
        // so an opening can never be resolved against a second derivation.
        records,
        padShapes: buildPadShapeIndex(projection.placements, projection.freePads),
      });
    }
    return maskOpeningsCache;
  };
  const padNetIds = new Map(Object.entries(projection.padNets ?? {}));
  const ensurePourResults = () => {
    if (pourResultsCache === undefined) {
      // ONE resolver per DRC run (contract §9): the pour resolves through the
      // context's own, not a second one built from the same board — otherwise
      // `problems` and `knownNetIds` could diverge between the report and the
      // fill that produced its copper.
      const nets: ZonePourNets = { resolver };
      const results: Array<{ zone: EffectiveCopperZone; result: CopperFillResult }> = [];
      for (let i = 0; i < copperZones.length; i += 1) {
        const zone = copperZones[i]!;
        // Execution checkpoint before every zone (contract 09 §6): one zone is
        // the indivisible unit of pour work, so this is where a cancel lands.
        options.tick?.("pour", i, copperZones.length);
        results.push({
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
            copperToHoleMm: copperToHoleClearanceMm(board.designRules),
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
        });
      }
      pourResultsCache = results;
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
    ...legality,
    projection,
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
    placementCourtyard(placementId) {
      const cached = courtyardCache.get(placementId);
      if (cached) return cached;
      const placement = placementById.get(placementId);
      const regions: PlacementCourtyardRegions = placement
        ? placementCourtyardRegionsMm(
            placement,
            options.lookupRawFootprint,
            courtyardFallbackMm,
          )
        : { top: [], bottom: [], source: null, malformed: false };
      courtyardCache.set(placementId, regions);
      return regions;
    },
    silkArtwork() {
      if (silkCache === undefined) {
        silkCache = buildSilkArtwork({
          placements: projection.placements,
          overlayShapes: projection.overlayShapes,
          overlayTexts: projection.overlayTexts,
        });
      }
      return silkCache;
    },
    maskIndex(face) {
      const cached = maskIndexCache.get(face);
      if (cached) return cached;
      const openings = ensureMaskOpenings().filter((o) => o.face === face);
      const rings = openings.map((o) => apertureShapeRing(o.shape, o.centerMm));
      const bounds = rings.map((ring) => boundsOfPoints(ring));
      const { near } = createBroadPhase({
        traces: [],
        pads: bounds,
        vias: [],
        holes: [],
      });
      const index: MaskFaceIndex = { openings, rings, bounds, near };
      maskIndexCache.set(face, index);
      return index;
    },
    tick: options.tick,
    copperShapeBudgets: {
      ...DEFAULT_COPPER_SHAPE_BUDGETS,
      ...options.copperShapeBudgets,
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
