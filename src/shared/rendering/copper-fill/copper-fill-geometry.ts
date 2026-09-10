// The ONE copper-pour kernel (docs/pcb-hardening/04-copper-pour-contract.md).
//
// Nothing here re-derives copper: pad / via / trace geometry, resolved layers
// and the invalidity flags come from `buildCopperRecords` (S1), the board
// region from `buildBoardRegion` (S2), and every zone parameter from
// `pourParamsForZone` (S3a). The kernel owns exactly one thing — which copper a
// zone produces — and reports whether it could answer at all (§8).
//
// Backend-safe: no `three` import lives under copper-fill/ except
// `copper-fill-shapes.ts`, which is the canvas / 3D view onto this result.

import type { PathD, PathsD } from "clipper2-ts";
import type {
  PcbBoardCutout,
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbLayerCount,
  PcbZoneIslandRemoval,
  PcbZonePadConnection,
  PcbFreeHole,
  PcbFreePad,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../sdks";
import {
  DEGENERATE_AREA_MM2,
  ensureCcwRing,
  ringSignedArea,
} from "../../pcb-geometry/ring-utils";
import { ringStrictlyInside } from "../../pcb-geometry/region-rings";
import { ringsOverlapPositiveArea } from "../../pcb-geometry/area-overlap";
import {
  buildBoardRegion,
  type BoardRegion,
} from "../../pcb-geometry/board-region";
import {
  polylineToRingEdgeDistance,
  ringToRingEdgeDistance,
} from "../../pcb-geometry/pcb-clearance-geometry";
import { pointToIslandDistance } from "../../pcb-connectivity/touch";
import { CONNECT_EPS_MM } from "../../pcb-geometry/tolerance";
import {
  buildCopperRecords,
  type CopperRecords,
  type PadCopperRecord,
  type TraceCopperRecord,
} from "../../pcb-connectivity/copper-records";
import {
  freePadItemKey,
  padItemKey,
  traceItemKey,
  viaItemKey,
} from "../../pcb-connectivity/copper-items";

import {
  collectDrills,
  drillSlotCenterline,
  footprintPadDrill,
  freeHoleDrill,
  freePadDrill,
  type DrillInstance,
} from "../pcb/pcb-drills";
import { placementPads } from "../../pcb-geometry/pad-geometry";
import {
  buildDiscRing,
  buildThermalSpokes,
  buildTraceMaskPolygons,
  buildTraceSegmentStadium,
  isSameNetAsPour,
  type ClipperPolygon,
  type ClipperRing,
} from "./copper-fill-trace-geometry";
import {
  ARC_TOLERANCE_MM,
  type CopperIsland,
  difference,
  intersection,
  multiPolyToPathsD,
  offsetChamfer,
  offsetRound,
  polyToPathsD,
  PRECISION,
  removeOnlyFillet,
  splitIslands,
  union,
} from "./copper-geometry-kernel";

// Minimum disconnected pour-island area below which the island is pruned
// (KiCad `min_island_area`). Connected islands are always kept.
const DEFAULT_MIN_POUR_ISLAND_AREA_MM2 = 1.0;
// Minimum copper width — necks thinner than this are removed by the min-width
// open. Sourced from `designRules.minimums.traceWidthMm` at the call site.
const DEFAULT_MIN_COPPER_THICKNESS_MM = 0.2;
// Aesthetic convex-corner fillet on the pour boundary (Flux look). Clearance
// stays safe because the fillet is a remove-only (anti-extensive) open.
const DEFAULT_POUR_CORNER_RADIUS_MM = 0.4;
// Thermal-relief defaults (IPC-2221: 2–4 spokes, 0.2–0.5 mm). Applied only when
// `padConnection` is `"thermal"` or `"thruHoleThermal"` (drilled pads only);
// the default `"solid"` floods same-net pads.
const DEFAULT_THERMAL_SPOKE_WIDTH_MM = 0.4;
const DEFAULT_THERMAL_RELIEF_GAP_MM = 0.4;
const DEFAULT_THERMAL_SPOKE_COUNT = 4;
// PAD-LOCAL angle of the first spoke (contract §6): 90° puts the four spokes on
// the edge midpoints of a rect / roundrect / oval pad instead of its corners.
const DEFAULT_THERMAL_SPOKE_ANGLE_DEG = 90;
// Slight under-erosion so the chamfer-deflate/round-inflate min-width pass never
// quite reaches the clearance boundary before the re-clip.
const MIN_THICKNESS_EPS_MM = 0.001;
// Polygonal-offset compensation for every round offset (halo, extent inset,
// zone exclusion). The offset's arc chords lie inside the ideal Minkowski
// offset (≤ARC_TOLERANCE_MM), so a bare `clearance` offset can under-cut the
// true clearance by ~2× the arc error at edge midpoints (contract §1).
const CLEARANCE_SAFETY_EPS_MM = 2 * ARC_TOLERANCE_MM;
/**
 * One output-grid step (mm): the kernel quantises results to `PRECISION`
 * decimals, so every FORBIDDEN region (halo, zone hole, zone exclusion,
 * keepout) is inflated by this much before it is subtracted and every ALLOWED
 * outer ring is deflated by it before it clips — nearest-grid rounding moves a
 * vertex by at most q/√2 < q (contract §3.2).
 */
const OUTPUT_GRID_STEP_MM = 10 ** -PRECISION;
const OUTPUT_GRID_SCALE = 10 ** PRECISION;
/**
 * Extra inset for a board region the S2 builder could only flatten unbiased
 * (`fallbacks`): the unbiased chord error and the offset's own chord error plus
 * one output rounding do not fit inside one `ε` (contract §3.1).
 */
const REGION_FALLBACK_EPS_MM = 0.01;

// --- Failure contract (§3, §8) ----------------------------------------------

/**
 * The pour cannot answer. Thrown for the two collapses a clipper op reports as
 * an ordinary empty set but which cannot happen geometrically: a union of
 * positive-area inputs, and a positive dilation of a non-empty set. An erosion
 * or a difference emptying a set is a legitimate result and never throws.
 */
class PourFailure extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PourFailure";
  }
}

/** Union that cannot legitimately empty a non-empty input set. */
function unionOrFail(what: string, ...groups: PathsD[]): PathsD {
  const merged = union(...groups);
  if (merged.length === 0 && groups.some((group) => group.length > 0)) {
    throw new PourFailure(`${what} union collapsed`);
  }
  return merged;
}

/**
 * How far a forbidden region grows before it is subtracted: the clearance, the
 * round offset's own chord compensation `ε` (only when there IS an offset to
 * compensate — a zero clearance subtracts the exact shape), and one output grid
 * step so nearest-grid rounding can never land inside it (§3.2, §5).
 */
function forbiddenDeltaMm(clearanceMm: number): number {
  // A NaN / Infinite clearance must not silently degrade to "no gap": every
  // numeric guard below reads `NaN > 0` as false, which would pour a
  // different-net obstacle un-clearanced. Fail the pour instead (§3).
  if (!Number.isFinite(clearanceMm))
    throw new PourFailure("clearance is not a finite number");
  const c = Math.max(0, clearanceMm);
  return (c > 0 ? c + CLEARANCE_SAFETY_EPS_MM : 0) + OUTPUT_GRID_STEP_MM;
}

/** Positive dilation that cannot legitimately empty a non-empty input set. */
function dilateOrFail(paths: PathsD, deltaMm: number, what: string): PathsD {
  if (paths.length === 0 || deltaMm <= 0) return paths;
  const grown = offsetRound(paths, deltaMm);
  if (grown.length === 0) throw new PourFailure(`${what} dilation collapsed`);
  return grown;
}

// --- Bare copper classification (contract §4) --------------------------------

/** Resolved thermal-relief geometry (mm). Null ⇒ solid same-net flood. */
interface ThermalConfig {
  spokeWidthMm: number;
  gapMm: number;
  spokeCount: number;
  /** Pad-LOCAL angle of the first spoke (deg). */
  angleDeg: number;
}

/** `padConnection` for ONE pad, after `"thruHoleThermal"` is resolved. */
type ResolvedPadConnection = "solid" | "thermal" | "none";

/**
 * Resolve `padConnection` for one same-net pad (contract §4).
 * `"thruHoleThermal"` is `"thermal"` for a drilled (through-hole) pad and
 * `"none"` for an undrilled (SMD) one. `"none"` means the pad is treated as
 * DIFFERENT-net copper: it leaves the same-net set entirely — no member, a full
 * clearance halo — which is the fail-safe direction (fewer connections, never
 * more). An absent override keeps `"solid"`.
 */
function resolvePadConnection(
  connection: PcbZonePadConnection | undefined,
  drilled: boolean,
): ResolvedPadConnection {
  switch (connection) {
    case "none":
      return "none";
    case "thermal":
      return "thermal";
    case "thruHoleThermal":
      return drilled ? "thermal" : "none";
    default:
      return "solid";
  }
}

/** One different-net obstacle plus the clearance ITS net resolves to (§5). */
interface ObstacleCopper {
  clearanceMm: number;
  poly: ClipperPolygon;
}

interface BareCopper {
  /** Different-net / unknown-net / layer-invalid copper on this layer. */
  diffNet: ObstacleCopper[];
  /**
   * Every same-net bare-copper polygon tagged with its connectivity item key
   * (`copper-items.ts`), for island membership. A trace contributes one entry
   * per stadium, so keys repeat — membership dedupes.
   */
  sameNetItems: Array<{
    key: string;
    poly: ClipperPolygon;
    /**
     * Exact disc for a via barrel or a circular pad. The sampled rings are
     * polygons, so a disc that overlaps a slanted island edge by a micron can
     * have no polygon intersection at all — membership would then disagree with
     * the connectivity touch predicate, which treats a via as a true circle.
     * Present ⇒ decide membership on the circle, not on the polygon (Astra 6).
     */
    disc?: { center: PcbPointMm; radiusMm: number };
    /**
     * Exact stadium of one trace segment. The polygon above is circumscribed
     * (an obstacle superset), which as POSITIVE evidence of contact would call
     * a fill ending 2 µm short of the true cap a member (Astra S5 run 2 #2);
     * membership is decided on the exact segment distance instead, like S1.
     */
    segment?: { a: PcbPointMm; b: PcbPointMm; halfWidthMm: number };
  }>;
  /**
   * Thermal-relief knockouts (exact `PathsD`, no clearance halo): the relief gap
   * ring around each same-net pad with the spoke bridges carved out. Subtracted
   * from the pour so it reconnects to the pad only through the spokes.
   */
  thermalKnockouts: PathsD[];
}

/**
 * One different-net obstacle the fill must clear, at the point its area-scope
 * membership is judged (rule-semantics contract §6): a pad's or via's centre,
 * a trace SEGMENT's midpoint. The `kind` picks the `pourToTrace` /
 * `pourToPad` / `pourToVia` pair kind the clearance resolves under.
 */
export interface CopperFillObstacle {
  kind: "trace" | "pad" | "via";
  netId: string | null;
  pointMm: PcbPointMm;
}

interface BareCopperInput {
  layer: PcbCopperLayerId;
  records: CopperRecords;
  pourNetId: string | null;
  thermal: ThermalConfig | null;
  padConnection: PcbZonePadConnection | undefined;
  /** Ids of `std` free pads — drilled by definition, whatever `drillMm` says. */
  stdFreePadIds: ReadonlySet<string>;
  /** `max(zone clearance, resolved pour clearance)` for one obstacle (§6). */
  obstacleClearanceMm: (item: CopperFillObstacle) => number;
}

function pointsToPathD(points: ReadonlyArray<PcbPointMm>): PathD {
  return points.map((p) => ({ x: p.x, y: p.y }));
}

function ringToClipperRing(points: ReadonlyArray<PcbPointMm>): ClipperRing {
  return points.map((p): [number, number] => [p.x, p.y]);
}

/** Degenerate copper is not copper (S1 §2) — it may never reach the pour. */
function padRecordHasCopper(record: PadCopperRecord): boolean {
  return record.ring.length >= 3 && Math.abs(ringSignedArea(record.ring)) > 0;
}

/** The item key of a pad record — footprint shape or free pad. */
function padRecordKey(record: PadCopperRecord): string {
  return record.anchor.kind === "pad"
    ? padItemKey(
        record.anchor.placementId,
        record.anchor.padNumber,
        record.occurrence,
      )
    : freePadItemKey(record.anchor.freePadId);
}

/** Stadium chain of one trace record (already mm, contract §4). */
function traceRecordStadiums(
  record: TraceCopperRecord,
): Array<{ poly: ClipperPolygon; midpointMm: PcbPointMm }> {
  if (record.pointsMm.length < 2 || record.halfWidthMm <= 0) return [];
  const out: Array<{ poly: ClipperPolygon; midpointMm: PcbPointMm }> = [];
  for (let i = 1; i < record.pointsMm.length; i += 1) {
    const a = record.pointsMm[i - 1]!;
    const b = record.pointsMm[i]!;
    // Circumscribed caps: a trace obstacle's halo must never be short (§4);
    // the same superset is harmless for same-net copper (R1 finding 2).
    const ring = buildTraceSegmentStadium(a, b, record.halfWidthMm, undefined, true);
    // The segment MIDPOINT is the evaluation point of this obstacle's area
    // membership (rule-semantics §6): one resolution per segment, so a
    // polyline that leaves an area is cleared per segment, not as a whole.
    if (ring)
      out.push({
        poly: [ring],
        midpointMm: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      });
  }
  return out;
}

/** Max distance from `center` to any vertex of `ring` (mm). */
function ringRadius(ring: ClipperRing, center: PcbPointMm): number {
  let r = 0;
  for (const [x, y] of ring)
    r = Math.max(r, Math.hypot(x - center.x, y - center.y));
  return r;
}

/** Signed area of a clipper-tuple ring (>0 ⇒ counter-clockwise). */
function tupleRingSignedArea(ring: ClipperRing): number {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Normalize a clipper-tuple ring to counter-clockwise (positive) winding. */
function toCcw(ring: ClipperRing): ClipperRing {
  return tupleRingSignedArea(ring) < 0 ? [...ring].reverse() : ring;
}

/**
 * Thermal-relief knockout for one same-net pad: the relief gap (pad inflated by
 * `gap`) minus the pad copper and the spoke bridges, so subtracting it leaves a
 * gap ring crossed by `spokeCount` necks.
 *
 * Spokes are laid out in the PAD-LOCAL frame — `angleDeg` is measured from the
 * pad's own x-axis and rotated by `rotationDeg`, the pad's world rotation
 * (contract §6). A fixed world angle aimed the spokes at the corners of a
 * rotated rect / oval pad and could leave it unbridged.
 *
 *
 * Winding MUST be normalized to CCW: `buildTraceSegmentStadium` (spokes) yields
 * clockwise rings and a mirrored (B.Cu) pad ring flips sign — mixing windings
 * under the kernel's NonZero union cancels the overlap into spurious holes, so
 * the spokes would get subtracted instead of bridging the gap.
 *
 * NEVER catches: a lost knockout floods the pad solid, which silently defeats
 * the relief. Any boolean failure fails the whole pour instead (§3, §8).
 */
function buildThermalKnockout(
  worldRing: ClipperRing,
  center: PcbPointMm,
  rotationDeg: number,
  mirrored: boolean,
  thermal: ThermalConfig,
): PathsD {
  // A mirrored (bottom-side) pad's local frame is reflected: its first spoke
  // sits at `180° − angle` in the reflected frame (R1 finding 6), which the
  // default 90° maps onto itself.
  const localAngleDeg = mirrored ? 180 - thermal.angleDeg : thermal.angleDeg;
  const padCcw = toCcw(worldRing);
  const padPaths = polyToPathsD([padCcw]);
  const padInflated = dilateOrFail(
    padPaths,
    thermal.gapMm,
    "thermal relief gap",
  );
  const outerRadius =
    ringRadius(padCcw, center) + thermal.gapMm + thermal.spokeWidthMm;
  const spokes = buildThermalSpokes(
    center,
    outerRadius,
    thermal.spokeWidthMm,
    thermal.spokeCount,
    localAngleDeg + rotationDeg,
  ).map((poly): ClipperPolygon => poly.map(toCcw));
  const carve = unionOrFail(
    "thermal spoke",
    padPaths,
    multiPolyToPathsD(spokes),
  );
  return difference(padInflated, carve);
}

/**
 * Classify every copper record against this layer and pour net (contract §4).
 * A record off the layer is ignored; a record whose declared layer or via span
 * is invalid is a different-net obstacle on EVERY layer — its true position is
 * unknown, so it may neither merge nor be flooded.
 */
function collectBareCopper(input: BareCopperInput): BareCopper {
  const { layer, records, pourNetId, thermal, padConnection } = input;
  const diffNet: ObstacleCopper[] = [];
  const sameNetItems: BareCopper["sameNetItems"] = [];
  const thermalKnockouts: PathsD[] = [];
  // Every obstacle as an independent CCW solid: pad rings arrive CCW, a
  // mirrored pad ring and every stadium arrive CW, and the NonZero union would
  // cancel a CW ring inside a CCW one into a hole — an un-clearanced void the
  // pour then floods (Astra S5 run 2 #1, the keepout lesson of S4 again).
  const pushObstacle = (
    kind: CopperFillObstacle["kind"],
    netId: string | null,
    pointMm: PcbPointMm,
    poly: ClipperPolygon,
  ): void => {
    diffNet.push({
      clearanceMm: input.obstacleClearanceMm({ kind, netId, pointMm }),
      poly: poly.map(toCcw),
    });
  };

  for (const record of records.pads) {
    if (!padRecordHasCopper(record)) continue;
    const onLayer = record.resolvedLayers.includes(layer);
    if (!onLayer && !record.declaredLayerInvalid) continue;
    const poly: ClipperPolygon = [ringToClipperRing(record.ring)];
    if (record.declaredLayerInvalid) {
      pushObstacle("pad", record.netId, record.center, poly);
      continue;
    }
    // A `std` free pad is drilled by definition (S3a) whatever `drillMm` says.
    const drilled =
      record.drillMm > 0 ||
      (record.anchor.kind === "freePad" &&
        input.stdFreePadIds.has(record.anchor.freePadId));
    // An UNPLATED pad's copper ring is MECHANICAL (manufacturability contract
    // 10 §2.4): the connectivity kernel keys such a record PER LAYER and gives
    // every one of those items a NULL net, so no graph component can ever
    // contain it — two rings of one unplated hole are not even each other's
    // node. A ring the graph can never join must not anchor a pour or be
    // joined by one: it takes the pour's ordinary clearance halo, never a
    // thermal knockout and never a membership key. `padNets` may still bind it
    // to a net (a numbered `np_thru_hole` pad); that is the design error
    // `NPTH_PAD_NET` reports, not a licence to weld the pour to it.
    const mode: ResolvedPadConnection =
      record.plated && isSameNetAsPour(record.netId, pourNetId)
        ? resolvePadConnection(padConnection, drilled)
        : "none";
    if (mode === "none") {
      pushObstacle("pad", record.netId, record.center, poly);
      continue;
    }
    sameNetItems.push({
      key: padRecordKey(record),
      poly,
      ...(record.disc ? { disc: record.disc } : {}),
    });
    if (thermal && mode === "thermal" && poly[0]) {
      thermalKnockouts.push(
        buildThermalKnockout(
          poly[0],
          record.center,
          record.rotationDeg,
          record.mirrored,
          thermal,
        ),
      );
    }
  }

  for (const record of records.traces) {
    if (record.layer !== layer) continue;
    const same = isSameNetAsPour(record.netId, pourNetId);
    if (!same) {
      for (const stadium of traceRecordStadiums(record))
        pushObstacle("trace", record.netId, stadium.midpointMm, stadium.poly);
      continue;
    }
    if (record.pointsMm.length < 2 || record.halfWidthMm <= 0) continue;
    for (let i = 1; i < record.pointsMm.length; i += 1) {
      const a = record.pointsMm[i - 1]!;
      const b = record.pointsMm[i]!;
      const ring = buildTraceSegmentStadium(a, b, record.halfWidthMm, undefined, true);
      if (!ring) continue;
      sameNetItems.push({
        key: traceItemKey(record.id),
        poly: [ring],
        segment: { a, b, halfWidthMm: record.halfWidthMm },
      });
    }
  }

  for (const record of records.vias) {
    if (!(record.radiusMm > 0)) continue;
    const onLayer = record.span.includes(layer);
    if (!onLayer && !record.layerSpanInvalid) continue;
    // Circumscribed: the halo of a sampled barrel must never be short (§4).
    const poly: ClipperPolygon = [
      buildDiscRing(record.center, record.radiusMm, undefined, true),
    ];
    if (record.layerSpanInvalid || !isSameNetAsPour(record.netId, pourNetId)) {
      pushObstacle("via", record.netId, record.center, poly);
      continue;
    }
    sameNetItems.push({
      key: viaItemKey(record.via.id),
      poly,
      disc: { center: record.center, radiusMm: record.radiusMm },
    });
  }

  return { diffNet, sameNetItems, thermalKnockouts };
}

/**
 * One drill aperture: the circumscribed disc of a round hole, or — when the
 * drill is oblong — the circumscribed stadium of its centreline. A slot is
 * ROUTED from cap centre to cap centre, so clearing only the central disc
 * leaves pour copper over the metal the fab removes.
 *
 * Circumscribed: a sampled drill must enclose the true hole (§5), else the pour
 * overhangs it by up to 4.8 ‰ of the radius. The stadium arrives clockwise, so
 * it is normalised like every other ring the NonZero unions consume.
 */
function drillAperture(drill: DrillInstance): ClipperPolygon {
  if (!drill.slot) {
    return [buildDiscRing(drill.centerMm, drill.radiusMm, undefined, true)];
  }
  const ring = buildTraceSegmentStadium(
    drill.slot.a,
    drill.slot.b,
    drill.slot.widthMm / 2,
    undefined,
    true,
  );
  return ring
    ? [toCcw(ring)]
    : [buildDiscRing(drill.centerMm, drill.radiusMm, undefined, true)];
}

/** Drill apertures (real holes) as bare shapes — subtracted from every layer. */
function collectApertures(
  vias: ReadonlyArray<PcbVia>,
  placements: ReadonlyArray<PcbPlacedPart>,
  freeHoles: ReadonlyArray<PcbFreeHole>,
  freePads: ReadonlyArray<PcbFreePad>,
): ClipperPolygon[] {
  return collectDrills(vias, placements, freeHoles, freePads).map(drillAperture);
}

/**
 * Non-plated holes: mechanical mounting/tooling holes plus every free pad whose
 * drill is NOT plated — which is every type but `std`, not just `hole`. An
 * `smd` or `conn` pad that carries a drill reaches the fab as a non-plated hit
 * (the ONE derivation, `freePadDrill`), so the pour has to clear its wall too.
 *
 * Unlike plated vias/PTH pads — whose copper plates right to the barrel — a NPTH
 * needs a hole-to-copper clearance ring so the pour doesn't touch the bare
 * drilled edge. Returned as bare shapes (disc, or stadium for a routed slot);
 * the caller round-inflates them by `copperToHoleMm` (§5). (Plated apertures
 * stay exact via `collectApertures`.)
 */
function collectNonPlatedApertures(
  freeHoles: ReadonlyArray<PcbFreeHole>,
  freePads: ReadonlyArray<PcbFreePad>,
  placements: ReadonlyArray<PcbPlacedPart>,
): ClipperPolygon[] {
  const out: ClipperPolygon[] = [];
  for (const hole of freeHoles) {
    const drill = freeHoleDrill(hole);
    if (!drill) continue;
    out.push(
      drillAperture({
        centerMm: drill.centerMm,
        radiusMm: drill.drillMm / 2,
        ...(drill.slot ? { slot: drill.slot } : {}),
      }),
    );
  }
  for (const pad of freePads) {
    const drill = freePadDrill(pad);
    if (!drill || drill.plated) continue;
    out.push(
      drillAperture({
        centerMm: pad.centerMm,
        radiusMm: drill.drillMm / 2,
        ...(drill.slot ? { slot: drill.slot } : {}),
      }),
    );
  }
  // Footprint pads carry non-plated drills too (`np_thru_hole`, mounting
  // holes): the ONE derivation (`footprintPadDrill`, manufacturability
  // contract 10 §1.1) so the pour clears a mounting hole's bare wall exactly
  // as it clears a free hole's. The plated apertures — the bare holes
  // themselves — already come through `collectApertures` -> `collectDrills`,
  // which is slot-aware.
  for (const placement of placements) {
    for (const pad of placementPads(placement)) {
      const drill = footprintPadDrill(pad, placement);
      if (!drill || drill.plated) continue;
      out.push(
        drillAperture({
          centerMm: drill.centerMm,
          radiusMm: drill.drillMm / 2,
          ...(drill.slot ? { slot: drill.slot } : {}),
        }),
      );
    }
  }
  return out;
}

// --- Extent (contract §3.1–§3.4) --------------------------------------------

/** The board region as one polygon-with-holes: outer CCW, cutouts CW. */
function regionPaths(region: BoardRegion): PathsD {
  // No usable outer ring ⇒ no board: emitting the cutouts alone would hand the
  // offset a set of clockwise rings and pour their complement.
  if (region.outer.length < 3) return [];
  const paths: PathsD = [pointsToPathD(ensureCcwRing(region.outer))];
  for (const hole of region.holes) {
    if (hole.length < 3) continue;
    paths.push(pointsToPathD(ensureCcwRing(hole)).reverse());
  }
  return paths;
}

/**
 * `Extent₀ = offset(R_poly, −(e + ε))` (contract §3.1) — ONE round offset over
 * the whole polygon-with-holes, so the outer ring shrinks and every cutout ring
 * grows. `R_poly ⊆ R_true` and the offset over-clears by `ε`, so no copper ends
 * up closer than `e` to a true board edge or cutout. An erosion that empties a
 * tiny board is a legitimate geometric answer, not a failure (§8).
 */
function buildExtent(
  region: BoardRegion,
  edgeMm: number,
  extraInsetMm: number,
): PathsD {
  const paths = regionPaths(region);
  if (paths.length === 0) return paths;
  // Even at a zero edge rule the copper stays one output-grid step inside the
  // board: nearest-grid rounding of the region's own boundary would otherwise
  // put copper up to q/√2 outside the true edge (Astra S5 run 2 #9, §3.2).
  const inset =
    (edgeMm > 0 ? edgeMm + CLEARANCE_SAFETY_EPS_MM : 0) +
    extraInsetMm +
    OUTPUT_GRID_STEP_MM;
  return offsetRound(paths, -inset);
}

/**
 * `Extent₁ = Extent₀ ∩ (int(P_Z) − ∪ int(H_i))` (contract §3.2). The zone's own
 * outline carries NO clearance — copper reaches the drawn line — so the only
 * adjustment is the conservative quantisation: the allowed outer ring is
 * deflated by one grid step, the forbidden holes inflated by one.
 */
function clipToZone(
  extent: PathsD,
  clipPolygonMm: ReadonlyArray<PcbPointMm> | undefined,
  clipHolesMm: ReadonlyArray<ReadonlyArray<PcbPointMm>> | undefined,
): PathsD {
  if (extent.length === 0) return extent;
  const holeRings = (clipHolesMm ?? []).filter((ring) => ring.length >= 3);
  // Holes are subtracted even without an outer ring: dropping them would pour
  // MORE copper than was drawn, which is the one direction that is never safe.
  const holes =
    holeRings.length === 0
      ? []
      : dilateOrFail(
          unionOrFail(
            "zone hole",
            holeRings.map((ring) => pointsToPathD(ensureCcwRing(ring))),
          ),
          OUTPUT_GRID_STEP_MM,
          "zone hole",
        );
  if (!clipPolygonMm || clipPolygonMm.length < 3)
    return difference(extent, holes);
  const outer = offsetRound(
    [pointsToPathD(ensureCcwRing(clipPolygonMm))],
    -OUTPUT_GRID_STEP_MM,
  );
  return intersection(extent, difference(outer, holes));
}

/**
 * `Extent₂ = Extent₁ − ∪ offset(P_{Z'}, c_{ZZ'} + ε)` (contract §3.3): every
 * other effective zone of a different net whose priority is not below this
 * one's carves this fill, computed from the immutable zone POLYGONS so the
 * result never depends on evaluation order. Fail-closed: a non-empty exclusion
 * set that offsets or unions away fails the pour rather than pouring into a
 * neighbour's copper.
 */
function subtractZoneExclusions(
  extent: PathsD,
  zones: ReadonlyArray<{
    pointsMm: ReadonlyArray<PcbPointMm>;
    clearanceMm: number;
  }>,
): PathsD {
  const usable = zones.filter((zone) => zone.pointsMm.length >= 3);
  if (usable.length === 0 || extent.length === 0) return extent;
  const halos: PathsD[] = [];
  for (const zone of usable) {
    const ring: PathsD = [pointsToPathD(ensureCcwRing(zone.pointsMm))];
    halos.push(
      dilateOrFail(ring, forbiddenDeltaMm(zone.clearanceMm), "zone exclusion"),
    );
  }
  return difference(extent, unionOrFail("zone exclusion", ...halos));
}

/** Remove every keepout interior from the extent (contract §3.4). */
function subtractKeepouts(
  extent: PathsD,
  rings: ReadonlyArray<ReadonlyArray<PcbPointMm>>,
): PathsD {
  // Every ring as an independent CCW solid: opposite windings would cancel
  // where two keepouts overlap under the non-zero fill rule (Astra S4 #1). The
  // derivation already normalises; this keeps raw callers safe too.
  const usable = rings.filter((ring) => ring.length >= 3);
  if (usable.length === 0 || extent.length === 0) return extent;
  const merged = unionOrFail(
    "keepout",
    usable.map((ring) => pointsToPathD(ensureCcwRing(ring))),
  );
  return difference(
    extent,
    dilateOrFail(merged, OUTPUT_GRID_STEP_MM, "keepout"),
  );
}

// --- Public parameters and result (contract §2, §8) --------------------------

export interface CopperFillPourParams {
  layer: PcbCopperLayerId;
  /**
   * The board's REAL stackup size. Required: the record layer policy (which
   * layers a `*.Cu` pad occupies, whether a via span is valid) is meaningless
   * without it, and a default would silently pour a 4-layer board as 2.
   */
  layerCount: PcbLayerCount;
  outline: PcbBoardOutline;
  placements: ReadonlyArray<PcbPlacedPart>;
  traces: ReadonlyArray<PcbTrace>;
  vias: ReadonlyArray<PcbVia>;
  /** Net id of the pour on this layer; same-net copper merges (no clearance). */
  pourNetId: string | null;
  /** `${placementId}|${padNumber}` → netId. Missing pads count as unknown net. */
  padNetIds: ReadonlyMap<string, string>;
  /**
   * Pre-built copper records for the SAME inputs (DRC builds them once per
   * context). Absent ⇒ the kernel builds its own; never a different board.
   */
  records?: CopperRecords;
  /** The zone author's own minimum — a floor under `clearanceForItem`. */
  clearanceMm: number;
  /**
   * Clearance to a different-net obstacle `M` (rule-semantics contract §6):
   * `max(c_zone, clearancePour(pourTo<kind>, layer, pourNet, M))`, resolved by
   * the SAME `RuleResolver` batch DRC uses. Required — a default would
   * re-introduce the board-tier-only fill that poured a 0.8 mm net class at
   * 0.5 mm (Astra S5 run 1 #1) and would ignore the per-kind board tier.
   */
  clearanceForItem: (item: CopperFillObstacle) => number;
  copperToBoardEdgeMm: number;
  /**
   * Clearance from poured copper to a NON-PLATED drill wall (mm) —
   * `copperToHoleClearanceMm(designRules)`, the SAME helper DRC's
   * `COPPER_TO_HOLE` reads (batch-DRC contract 06 §4), so the artwork and the
   * report cannot disagree about a hole. ABSENT ⇒ `copperToBoardEdgeMm`, which
   * is the pre-S7 behaviour: a non-plated wall is bare substrate, so the edge
   * rule is what the fill has always applied to it.
   */
  copperToHoleMm?: number;
  cutouts?: ReadonlyArray<PcbBoardCutout>;
  freeHoles?: ReadonlyArray<PcbFreeHole>;
  freePads?: ReadonlyArray<PcbFreePad>;
  /** Min disconnected island area to keep (mm²). Attached islands always kept. */
  minIslandAreaMm2?: number;
  /**
   * Zone override for unattached ("floating") islands — contract §8.
   * `"never"` keeps them all (min area 0); `{ minAreaMm2 }` keeps one when
   * `area ≥ minAreaMm2`; `"always"` removes every unattached island. Attached
   * islands are kept in all three cases. When present this WINS over an
   * explicit `minIslandAreaMm2`; absent ⇒ `minIslandAreaMm2` / the default.
   */
  islandRemoval?: PcbZoneIslandRemoval;
  /** Minimum copper width (mm) — necks below this are removed. */
  minThicknessMm?: number;
  /** Aesthetic convex-corner fillet radius (mm). */
  cornerRadiusMm?: number;
  /**
   * How same-net pads connect to the pour — contract §4. `"solid"` (default)
   * floods over the pad; `"thermal"` leaves a relief gap crossed by spokes
   * (IPC-2221); `"thruHoleThermal"` is `"thermal"` for drilled pads and
   * `"none"` for SMD ones; `"none"` treats same-net pads as different-net
   * copper (full clearance halo, no island membership).
   */
  padConnection?: PcbZonePadConnection;
  /** Thermal spoke width (mm). Default 0.4. Only used when `padConnection` is `"thermal"`. */
  thermalSpokeWidthMm?: number;
  /** Thermal relief gap pad→pour (mm). Default 0.4. */
  thermalReliefGapMm?: number;
  /** Number of spokes per pad. Default 4. */
  thermalSpokeCount?: number;
  /** PAD-LOCAL angle of the first spoke (deg). Default 90 (edge midpoints). */
  thermalSpokeAngleDeg?: number;
  /**
   * Outer ring (mm) of the zone the pour is clipped to. The fillable region
   * becomes `boardInsetExtent ∩ clipPolygon`. Omitted ⇒ board-wide pour.
   */
  clipPolygonMm?: ReadonlyArray<PcbPointMm>;
  /**
   * Hole rings of the SAME zone (contract §11), removed from the extent exactly
   * — a hole is part of the outline and carries no clearance.
   */
  clipHolesMm?: ReadonlyArray<ReadonlyArray<PcbPointMm>>;
  /**
   * Other effective zones on this layer that carve this one (contract §3.3),
   * each with the mutual clearance `max(c_Z, c_{Z'})`. Their polygons — not
   * their fills — so the result is independent of evaluation order.
   */
  excludeZonesMm?: ReadonlyArray<{
    pointsMm: ReadonlyArray<PcbPointMm>;
    clearanceMm: number;
  }>;
  /**
   * Keepout interiors (mm rings) removed from the fillable region — zone /
   * keepout contract §4 `copperPour`. Subtracted after the clip and before any
   * obstacle clearance, inflated by one output-grid step so nearest-grid
   * rounding of the result can never land inside the keepout.
   */
  excludePolygonsMm?: ReadonlyArray<ReadonlyArray<PcbPointMm>>;
}

/** A pour answered, but something about its inputs is worth reporting. */
export interface CopperFillWarning {
  /** A board-region ring could only be flattened unbiased (S2 `fallbacks`). */
  code: "region_ring_unbiased";
  ringIndex: number;
}

export interface CopperFillIsland {
  /** `[outer CCW, ...holes CW]`, quantised to the 0.1 µm output grid. */
  rings: PcbPointMm[][];
  /** `|outer| − Σ|holes|`, mm². */
  areaMm2: number;
  /** Area centroid of the outer ring (mm) — the DRC marker location. */
  centerMm: PcbPointMm;
  /** Sorted S1 item keys of the same-net copper this island merges with. */
  memberKeys: string[];
  /**
   * The island touches same-net bare copper — the island-REMOVAL criterion
   * (§8), not an electrical claim. `memberKeys.length > 0`.
   */
  attached: boolean;
}

export type CopperFillResult =
  | {
      status: "ok";
      islands: CopperFillIsland[];
      warnings: CopperFillWarning[];
    }
  | {
      status: "failed";
      reason: string;
      islands: [];
      warnings: CopperFillWarning[];
    };

/**
 * Is a trace's copper already fully covered by the filled pour islands? Used by
 * the redundant-trace cleanup: a same-net trace that lies entirely within the
 * pour is electrically redundant (the plane already provides that copper) and
 * can be deleted. Conservative — every segment stadium must lie strictly inside
 * a SINGLE island (outer ring, no hole contact), so a bridge between islands or
 * a failed fill yields "not covered" (no deletion), never a false positive.
 */
export function isTraceCoveredByPour(
  trace: PcbTrace,
  islands: ReadonlyArray<ReadonlyArray<ReadonlyArray<PcbPointMm>>>,
): boolean {
  const stadia = buildTraceMaskPolygons(trace, 0, true);
  if (stadia.length === 0 || islands.length === 0) return false;
  const rings: PcbPointMm[][] = [];
  for (const poly of stadia) {
    const ring = poly[0];
    if (!ring || ring.length < 3) return false;
    // Clipper-style `[x, y]` tuples → the `{ x, y }` points the S2 predicates read.
    rings.push(ring.map((pt) => ({ x: pt[0], y: pt[1] })));
  }
  // Covered ⇔ every segment stadium lies strictly inside ONE island's outer
  // ring and meets none of that island's holes. Geometric, not an area ratio:
  // the old "≥ 99.9 % of the mask area" test called a long trace covered when
  // its only uncovered part was the bridge between two islands, and deleting
  // it split the net (Astra S4 #2). A trace spanning two islands can never be
  // inside one of them, so it is never deleted. The tolerance is the kernel's
  // output grid: island rings are quantised, the stadium is not.
  const eps = 2 * OUTPUT_GRID_STEP_MM;
  return islands.some((island) => {
    const [outer, ...holes] = island;
    if (!outer || outer.length < 3) return false;
    // Symmetric hole test: a stadium lying ENTIRELY inside a hole touches no
    // hole boundary, so the one-directional "hole meets ring" test misses it.
    return rings.every(
      (ring) =>
        ringStrictlyInside(ring, outer, eps) &&
        holes.every((hole) => !ringsOverlapPositiveArea(ring, hole, eps)),
    );
  });
}

// --- Island membership (contract §8, S1 §3) ----------------------------------

/** Keys of the same-net items the island merges with (intersect OR abut). */
function islandMemberKeys(
  rings: PcbPointMm[][],
  items: BareCopper["sameNetItems"],
): string[] {
  const paths: PathsD = rings.map((ring) => pointsToPathD(ring));
  const keys = new Set<string>();
  for (const item of items) {
    if (keys.has(item.key)) continue;
    if (item.disc) {
      // Exact circle: inside the copper, or within ε of any ring's edge.
      if (
        pointToIslandDistance(item.disc.center, rings) <=
        item.disc.radiusMm + CONNECT_EPS_MM
      ) {
        keys.add(item.key);
      }
      continue;
    }
    if (item.segment) {
      if (segmentTouchesIsland(item.segment, rings)) keys.add(item.key);
      continue;
    }
    if (intersection(paths, polyToPathsD(item.poly)).length > 0) {
      keys.add(item.key);
      continue;
    }
    const outer = item.poly[0];
    if (outer && abutsAnyRing(outer, rings)) keys.add(item.key);
  }
  return [...keys].sort();
}

/**
 * Exact stadium contact (S1 §3): the island has a point within `halfWidth + ε`
 * of the segment — an end cap touches the copper, the segment runs within
 * reach of a ring edge (a crossing is distance 0), or it lies inside the copper
 * outright (an endpoint's island distance is then 0). A segment inside a hole
 * stays out: its distance to the hole ring exceeds the reach.
 */
function segmentTouchesIsland(
  segment: { a: PcbPointMm; b: PcbPointMm; halfWidthMm: number },
  rings: ReadonlyArray<PcbPointMm[]>,
): boolean {
  const reach = segment.halfWidthMm + CONNECT_EPS_MM;
  if (pointToIslandDistance(segment.a, rings) <= reach) return true;
  if (pointToIslandDistance(segment.b, rings) <= reach) return true;
  const polyline = [segment.a, segment.b];
  for (const ring of rings) {
    if (polylineToRingEdgeDistance(polyline, ring) <= reach) return true;
  }
  return false;
}

/** Does the item's outer ring run within ε of any island ring's perimeter? */
function abutsAnyRing(
  outer: ClipperRing,
  rings: ReadonlyArray<PcbPointMm[]>,
): boolean {
  const ring = outer.map(([x, y]) => ({ x, y }));
  const box = ringExtent(ring);
  for (const islandRing of rings) {
    const islandBox = ringExtent(islandRing);
    if (
      box.minX - CONNECT_EPS_MM > islandBox.maxX ||
      islandBox.minX - CONNECT_EPS_MM > box.maxX ||
      box.minY - CONNECT_EPS_MM > islandBox.maxY ||
      islandBox.minY - CONNECT_EPS_MM > box.maxY
    ) {
      continue;
    }
    if (ringToRingEdgeDistance(ring, islandRing) <= CONNECT_EPS_MM) return true;
  }
  return false;
}

interface RingExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function ringExtent(ring: ReadonlyArray<PcbPointMm>): RingExtent {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

interface IslandOrderKey extends RingExtent {
  areaMm2: number;
  vertexCount: number;
  /** Vertices rotated to start at the lexicographically smallest (x, y). */
  canonical: number[];
}

/**
 * Total order over islands: extent, then area, then the canonical outer ring.
 * Every clause is needed — congruent islands tie on extent AND area, and only
 * the vertex sequence separates them. Rotating to the smallest vertex makes the
 * sequence independent of where clipper started tracing the contour.
 */
function islandOrderKey(
  outer: ReadonlyArray<PcbPointMm>,
  areaMm2: number,
): IslandOrderKey {
  const extent = ringExtent(outer);
  let startIndex = 0;
  for (let i = 1; i < outer.length; i += 1) {
    const p = outer[i]!;
    const best = outer[startIndex]!;
    if (p.x < best.x || (p.x === best.x && p.y < best.y)) startIndex = i;
  }
  const canonical: number[] = [];
  for (let i = 0; i < outer.length; i += 1) {
    const p = outer[(startIndex + i) % outer.length]!;
    canonical.push(p.x, p.y);
  }
  return { ...extent, areaMm2, vertexCount: outer.length, canonical };
}

/**
 * The island total order of contract §8: `(minX, minY, areaMm2, maxX, maxY,
 * vertex count, canonical outer ring)`. Applied INSIDE the kernel so every
 * consumer sees one order, exported so a consumer that indexes islands into
 * pour keys can reproduce it and so it is testable on its own.
 */
export function sortCopperFillIslands<
  T extends { rings: ReadonlyArray<ReadonlyArray<PcbPointMm>>; areaMm2: number },
>(islands: readonly T[]): T[] {
  return islands
    .map((island) => ({
      island,
      order: islandOrderKey(island.rings[0] ?? [], island.areaMm2),
    }))
    .sort((a, b) => compareIslandOrder(a.order, b.order))
    .map(({ island }) => island);
}

function compareIslandOrder(a: IslandOrderKey, b: IslandOrderKey): number {
  const scalar =
    a.minX - b.minX ||
    a.minY - b.minY ||
    a.areaMm2 - b.areaMm2 ||
    a.maxX - b.maxX ||
    a.maxY - b.maxY ||
    a.vertexCount - b.vertexCount;
  if (scalar !== 0) return scalar;
  for (let i = 0; i < a.canonical.length; i += 1) {
    const d = a.canonical[i]! - b.canonical[i]!;
    if (d !== 0) return d;
  }
  return 0;
}

// --- Canonical output rings (contract §8) ------------------------------------

/** Snap to the output grid, killing `-0` so two runs stringify identically. */
function quantizeCoord(value: number): number {
  const rounded = Math.round(value * OUTPUT_GRID_SCALE) / OUTPUT_GRID_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * One canonical ring: quantised, duplicate-free, in the requested winding and
 * rotated to start at its lexicographically smallest vertex. Null when nothing
 * with an orientation survives — clipper can emit a ring that collapses on the
 * output grid.
 */
function canonicalRing(
  ring: ReadonlyArray<PcbPointMm>,
  winding: "ccw" | "cw",
): PcbPointMm[] | null {
  const points: PcbPointMm[] = [];
  for (const p of ring) {
    const q = { x: quantizeCoord(p.x), y: quantizeCoord(p.y) };
    const prev = points[points.length - 1];
    if (prev && prev.x === q.x && prev.y === q.y) continue;
    points.push(q);
  }
  while (points.length > 1) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (first.x !== last.x || first.y !== last.y) break;
    points.pop();
  }
  if (points.length < 3) return null;
  const signed = ringSignedArea(points);
  if (signed === 0) return null;
  const oriented =
    (winding === "ccw" ? signed < 0 : signed > 0) ? [...points].reverse() : points;
  let start = 0;
  for (let i = 1; i < oriented.length; i += 1) {
    const p = oriented[i]!;
    const best = oriented[start]!;
    if (p.x < best.x || (p.x === best.x && p.y < best.y)) start = i;
  }
  return start === 0
    ? oriented
    : [...oriented.slice(start), ...oriented.slice(0, start)];
}

/** Area centroid of a ring (mm); the vertex mean for a degenerate one. */
function areaCentroid(ring: ReadonlyArray<PcbPointMm>): PcbPointMm {
  let doubleArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const cross = p.x * q.y - q.x * p.y;
    doubleArea += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(doubleArea) > 0)
    return { x: cx / (3 * doubleArea), y: cy / (3 * doubleArea) };
  const n = Math.max(1, ring.length);
  let sx = 0;
  let sy = 0;
  for (const p of ring) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / n, y: sy / n };
}

/**
 * One clipper island → the contract's canonical rings: rings canonicalised,
 * holes in the island order, area and centroid accumulated in THAT fixed order
 * so the floating-point result is identical under any input permutation.
 */
function canonicalIsland(
  island: CopperIsland,
): { rings: PcbPointMm[][]; areaMm2: number; centerMm: PcbPointMm } | null {
  const [rawOuter, ...rawHoles] = island.paths;
  const outer = rawOuter ? canonicalRing(rawOuter, "ccw") : null;
  if (!outer) return null;
  const holes = rawHoles
    .map((ring) => canonicalRing(ring, "cw"))
    .filter((ring): ring is PcbPointMm[] => ring !== null)
    .map((ring) => ({ ring, order: islandOrderKey(ring, ringArea(ring)) }))
    .sort((a, b) => compareIslandOrder(a.order, b.order))
    .map(({ ring }) => ring);
  let areaMm2 = ringArea(outer);
  for (const hole of holes) areaMm2 -= ringArea(hole);
  if (!(areaMm2 >= DEGENERATE_AREA_MM2)) return null;
  return { rings: [outer, ...holes], areaMm2, centerMm: areaCentroid(outer) };
}

/** The canonical island plus its S1 membership verdict. */
function toFillIsland(
  island: CopperIsland,
  items: BareCopper["sameNetItems"],
): CopperFillIsland | null {
  const canonical = canonicalIsland(island);
  if (!canonical) return null;
  const memberKeys = islandMemberKeys(canonical.rings, items);
  return { ...canonical, memberKeys, attached: memberKeys.length > 0 };
}

/**
 * The per-layer UNION of several pours' islands (contract §9): the artwork must
 * carry ONE region set per copper layer, or a later same-net pour's `LPC` hole
 * erases an earlier pour's copper where their clearances differ. Re-splits the
 * merged copper and returns the rings in the §8 total order, so a nested island
 * always sorts after the ancestor whose hole contains it.
 *
 * Not a `CopperFillResult`: the union owns no net, no members and no removal
 * criterion — it is artwork, not a connectivity node. Rethrows
 * `CopperKernelError`; the caller must FAIL rather than ship less copper.
 */
export function unionPourIslands(
  pours: ReadonlyArray<ReadonlyArray<ReadonlyArray<PcbPointMm>>>,
): Array<{ rings: PcbPointMm[][]; areaMm2: number }> {
  const paths: PathsD = [];
  for (const rings of pours) {
    for (const ring of rings) paths.push(pointsToPathD(ring));
  }
  if (paths.length === 0) return [];
  const built: Array<{ rings: PcbPointMm[][]; areaMm2: number }> = [];
  for (const island of splitIslands(paths)) {
    const canonical = canonicalIsland(island);
    if (canonical) built.push(canonical);
  }
  // The inputs are kept islands (positive area), so an empty union is a
  // kernel collapse, never a geometric answer (§8) — the same rule
  // `unionOrFail` applies inside the pour; silently emitting no plane is the
  // one direction the artwork must never take (R2 finding 2).
  if (built.length === 0) throw new PourFailure("pour union collapsed");
  return sortCopperFillIslands(built);
}

function ringArea(ring: ReadonlyArray<PcbPointMm>): number {
  return Math.abs(ringSignedArea(ring));
}

// --- The pour ---------------------------------------------------------------

/**
 * Minimum unattached-island area (mm²) for the prune, resolving the zone
 * `islandRemoval` override onto the existing `minIslandAreaMm2` input
 * (contract §8). `"always"` becomes `+Infinity`, which no finite island area
 * can meet — so the prune keeps only attached islands. `islandRemoval` wins
 * over an explicit `minIslandAreaMm2`.
 */
function resolveMinIslandAreaMm2(params: CopperFillPourParams): number {
  const removal = params.islandRemoval;
  if (removal === "always") return Number.POSITIVE_INFINITY;
  if (removal === "never") return 0;
  // A non-finite threshold cannot be compared; fall to the safe tilt (only
  // attached islands survive) rather than silently keeping floating copper.
  if (removal) {
    return Number.isFinite(removal.minAreaMm2)
      ? Math.max(0, removal.minAreaMm2)
      : Number.POSITIVE_INFINITY;
  }
  return Math.max(
    0,
    params.minIslandAreaMm2 ?? DEFAULT_MIN_POUR_ISLAND_AREA_MM2,
  );
}

function sortWarnings(warnings: CopperFillWarning[]): CopperFillWarning[] {
  return [...warnings].sort(
    (a, b) => a.code.localeCompare(b.code) || a.ringIndex - b.ringIndex,
  );
}

/**
 * The single copper-pour kernel: one effective zone's copper on one layer.
 *
 * Pipeline (contract §3, as sets):
 *   1. extent  = board region inset by the edge clearance (S2, inward-biased),
 *                clipped to the zone polygon minus its holes, minus every
 *                higher-or-equal-priority zone of another net, minus every
 *                `copperPour` keepout, then the remove-only fillet.
 *   2. halo    = per-obstacle-net round-inflated different-net copper (§5),
 *                plus drill apertures, NPTH rings and thermal knockouts.
 *   3. raw     = extent − halo.
 *   4. min-width: chamfer-deflate by r then round-inflate by r (r=w/2−1 µm),
 *                 then RE-CLIP `∩ raw ∩ extent − halo` so clearance is exact.
 *   5. islands = split, canonicalise, drop degenerate, keep if area ≥ min OR
 *                attached, then sort into the §8 total order.
 *
 * Any clipper throw, a union of positive-area copper that empties, or a
 * positive dilation of a non-empty set that empties makes the whole pour
 * `failed` — the consumers then ship NO copper for the zone. An empty extent,
 * raw or fill for geometric reasons stays `ok` with zero islands (§8).
 */
export function buildCopperFillIslands(
  params: CopperFillPourParams,
): CopperFillResult {
  const warnings: CopperFillWarning[] = [];
  try {
    return computePourIslands(params, warnings);
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      islands: [],
      warnings: sortWarnings(warnings),
    };
  }
}

function computePourIslands(
  params: CopperFillPourParams,
  warnings: CopperFillWarning[],
): CopperFillResult {
  const edge = Math.max(0, params.copperToBoardEdgeMm);
  const zoneClearance = Math.max(0, params.clearanceMm);
  const cornerRadius = Math.max(
    0,
    params.cornerRadiusMm ?? DEFAULT_POUR_CORNER_RADIUS_MM,
  );
  const minThickness = Math.max(
    0,
    params.minThicknessMm ?? DEFAULT_MIN_COPPER_THICKNESS_MM,
  );
  const minIslandArea = resolveMinIslandAreaMm2(params);
  const thermal = resolveThermalConfig(params, minThickness);

  const freePads = params.freePads ?? [];
  const freeHoles = params.freeHoles ?? [];
  const records =
    params.records ??
    buildCopperRecords({
      layerCount: params.layerCount,
      placements: params.placements,
      padNetIds: params.padNetIds,
      freePads,
      traces: params.traces,
      vias: params.vias,
    });
  const stdFreePadIds = new Set(
    // `std` by TYPE, not by `freePadDrill`: a std pad is drilled by definition
    // whatever `drillMm` says (S3a), and a null drill must not cost it its
    // thermal bond (R1 #3).
    freePads.filter((p) => p.padType === "std").map((p) => p.id),
  );
  const bare = collectBareCopper({
    layer: params.layer,
    records,
    pourNetId: params.pourNetId,
    thermal,
    padConnection: params.padConnection,
    stdFreePadIds,
    obstacleClearanceMm: (item) =>
      Math.max(zoneClearance, params.clearanceForItem(item)),
  });

  const extent = buildPourExtent(params, edge, cornerRadius, warnings);
  if (extent.length === 0) return ok([], warnings);

  // Fail CLOSED, not open: for the *obstacle* set an empty result means "no
  // clearance hole", so a silent collapse would let the pour flood different-net
  // copper un-clearanced (a DRC short). `unionOrFail` / `dilateOrFail` refuse
  // the two collapses that cannot happen geometrically.
  const halos = buildObstacleHalos(bare.diffNet);

  // Drill apertures carry the same one-grid-step guard as every other
  // forbidden region (§3.2): rounding must never place pour copper inside a
  // hole, plated or not.
  const aperturePaths = dilateOrFail(
    multiPolyToPathsD(
      collectApertures(params.vias, params.placements, freeHoles, freePads),
    ),
    OUTPUT_GRID_STEP_MM,
    "drill aperture",
  );
  // Non-plated holes get a hole-to-copper ring (§5); the bare hole itself is
  // already subtracted via `aperturePaths`. The value is DRC's
  // `copperToHoleClearanceMm`, which defaults to the board-edge rule — so an
  // absent key reproduces the pre-S7 artwork exactly.
  const npthHalo = dilateOrFail(
    multiPolyToPathsD(
      collectNonPlatedApertures(freeHoles, freePads, params.placements),
    ),
    forbiddenDeltaMm(Math.max(0, params.copperToHoleMm ?? edge)),
    "non-plated hole",
  );

  const clearanceHoles = unionOrFail(
    "clearance",
    ...halos,
    aperturePaths,
    npthHalo,
    ...bare.thermalKnockouts,
  );

  const raw = difference(extent, clearanceHoles);
  if (raw.length === 0) return ok([], warnings);

  let fill = raw;
  const r = minThickness / 2 - MIN_THICKNESS_EPS_MM;
  if (r > 0) {
    const core = offsetChamfer(raw, -r);
    // The erosion may legitimately empty `core`; the re-inflation of a
    // non-empty core may not (§8 — a positive dilation cannot vanish).
    const restored = dilateOrFail(core, r, "minimum width");
    // Re-clip: round-inflate may bulge past the chamfer-eroded raw, so clamp
    // back inside raw ∩ extent and re-subtract the holes → clearance exact.
    fill = difference(
      intersection(intersection(restored, raw), extent),
      clearanceHoles,
    );
  }
  if (fill.length === 0) return ok([], warnings);

  const built: CopperFillIsland[] = [];
  for (const island of splitIslands(fill)) {
    const made = toFillIsland(island, bare.sameNetItems);
    if (made) built.push(made);
  }
  const kept = built.filter(
    (island) => island.areaMm2 >= minIslandArea || island.attached,
  );
  return ok(sortCopperFillIslands(kept), warnings);
}

/**
 * `Extent₃` (contract §3.1–§3.4): the S2 board region inset by the edge
 * clearance, clipped to the zone polygon minus its holes, minus every
 * higher-or-equal-priority zone of another net, minus every `copperPour`
 * keepout, then the aesthetic remove-only fillet. Anti-extensive throughout, so
 * an empty result is a legitimate "this zone pours nothing".
 */
function buildPourExtent(
  params: CopperFillPourParams,
  edgeMm: number,
  cornerRadiusMm: number,
  warnings: CopperFillWarning[],
): PathsD {
  const region = buildBoardRegion(params.outline, params.cutouts ?? [], {
    bias: "board-inner",
  });
  for (const ringIndex of region.fallbacks)
    warnings.push({ code: "region_ring_unbiased", ringIndex });
  let extent = buildExtent(
    region,
    edgeMm,
    region.fallbacks.length > 0 ? REGION_FALLBACK_EPS_MM : 0,
  );
  extent = clipToZone(extent, params.clipPolygonMm, params.clipHolesMm);
  extent = subtractZoneExclusions(extent, params.excludeZonesMm ?? []);
  extent = subtractKeepouts(extent, params.excludePolygonsMm ?? []);
  // The round opening is anti-extensive in exact arithmetic; clipping it to
  // its input makes that hold under clipper's chord error too, so the fillet
  // can never push copper back into a keepout corner (Astra S5 run 2 Q2).
  const filleted = removeOnlyFillet(extent, cornerRadiusMm);
  return cornerRadiusMm > 0 ? intersection(filleted, extent) : filleted;
}

/**
 * Thermal config, built whenever the resolved mode for ANY pad can be thermal;
 * the per-pad decision (`thruHoleThermal` ⇒ drilled pads only) belongs to the
 * collector. Null ⇒ same-net pads flood solid.
 */
function resolveThermalConfig(
  params: CopperFillPourParams,
  minThicknessMm: number,
): ThermalConfig | null {
  if (
    params.padConnection !== "thermal" &&
    params.padConnection !== "thruHoleThermal"
  ) {
    return null;
  }
  return {
    // Spokes must be ≥ the min-copper-width floor, else the min-width open
    // would erase them and electrically isolate the pad from the pour (§6).
    spokeWidthMm: Math.max(
      minThicknessMm,
      params.thermalSpokeWidthMm ?? DEFAULT_THERMAL_SPOKE_WIDTH_MM,
    ),
    gapMm: Math.max(
      0,
      params.thermalReliefGapMm ?? DEFAULT_THERMAL_RELIEF_GAP_MM,
    ),
    spokeCount: Math.max(
      1,
      params.thermalSpokeCount ?? DEFAULT_THERMAL_SPOKE_COUNT,
    ),
    angleDeg: params.thermalSpokeAngleDeg ?? DEFAULT_THERMAL_SPOKE_ANGLE_DEG,
  };
}

/**
 * `Hₒ = ∪_v offset(O_v, v + ε + q)` (contract §3.5): obstacles grouped by the
 * clearance THEIR net resolves to, each group unioned then inflated once.
 * Groups are visited in ascending numeric key order — a Map's insertion order
 * would leak the record order into the result (§12).
 */
function buildObstacleHalos(obstacles: ReadonlyArray<ObstacleCopper>): PathsD[] {
  const byClearance = new Map<number, ClipperPolygon[]>();
  for (const obstacle of obstacles) {
    // An obstacle thinner than the output grid quantises to nothing inside the
    // union while the union stays non-empty, so its clearance band silently
    // vanishes (Astra S5 run 2 #8). Positive-area copper the kernel cannot
    // represent is a failure, never an un-clearanced pour.
    for (const ring of obstacle.poly) {
      if (!canonicalRing(ring.map(([x, y]) => ({ x, y })), "ccw"))
        throw new PourFailure("obstacle copper below the output resolution");
    }
    const group = byClearance.get(obstacle.clearanceMm);
    if (group) group.push(obstacle.poly);
    else byClearance.set(obstacle.clearanceMm, [obstacle.poly]);
  }
  const halos: PathsD[] = [];
  for (const value of [...byClearance.keys()].sort((a, b) => a - b)) {
    const merged = unionOrFail(
      "obstacle",
      multiPolyToPathsD(byClearance.get(value)!),
    );
    halos.push(dilateOrFail(merged, forbiddenDeltaMm(value), "obstacle halo"));
  }
  return halos;
}

function ok(
  islands: CopperFillIsland[],
  warnings: CopperFillWarning[],
): CopperFillResult {
  return { status: "ok", islands, warnings: sortWarnings(warnings) };
}

/**
 * The rings view onto the pour — Gerber regions, the cloud snapshot and the
 * redundant-trace cleanup. A `failed` pour yields `[]` (no copper); a consumer
 * that must tell a failure from an empty extent reads `buildCopperFillIslands`.
 */
export function buildCopperFillPourPaths(
  params: CopperFillPourParams,
): PcbPointMm[][][] {
  return buildCopperFillIslands(params).islands.map((island) => island.rings);
}
