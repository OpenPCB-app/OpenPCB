import {
  copperLayersForCount,
  type DrcAnchor,
  type PcbCopperLayerId,
  type PcbPointMm,
} from "../../../sdks/designer";
import {
  CopperKernelError,
  runKernelQuietly,
} from "../../rendering/copper-fill/copper-geometry-kernel";
import {
  analyseGroup,
  buildCopperUnits,
  CopperShapeBudgetError,
  groupComponents,
  orientIslandRings,
  ANGLE_EPS_DEG,
  DEFAULT_ACUTE_ANGLE_DEG,
  DEFAULT_SLIVER_MIN_LENGTH_MM,
  DEFAULT_SLIVER_WIDTH_MM,
  EROSION_MARGIN_MM,
  type CopperShapeItem,
  type CopperUnit,
  type CopperUnitSkip,
  type ShapeTruncation,
} from "../../rendering/copper-fill/copper-shape-kernel";
import {
  buildDiscRing,
  buildTraceSegmentStadium,
  type ClipperRing,
} from "../../rendering/copper-fill/copper-fill-trace-geometry";
import { ensureCcwRing } from "../../pcb-geometry/ring-utils";
import { GEOM_EPS_MM } from "../../pcb-geometry/tolerance";
import {
  distance,
  projectPointToSegment,
  isCollinear,
  segmentsCrossTransversally,
} from "../../pcb-geometry/segment-predicates";
import { segmentClosestPoints } from "../../pcb-geometry/pcb-trace-geometry";
import { pointInPolygon } from "../../pcb-geometry/pcb-clearance-geometry";
import type { RingBounds } from "../../pcb-geometry/pad-outline";
import type { DrcContext, DrcTrace } from "../drc-context";
import type { DrcViolationDraft } from "../types";
import { anchorKey } from "../violation-id";

/**
 * Copper shape — the DFM check that judges COPPER ITSELF rather than the gap
 * between two pieces of it (DFM contract 11 §5).
 *
 *  - `COPPER_CONNECTION_WIDTH` — copper that narrows below `w` somewhere in the
 *    middle of one net's own copper. Located by bisection on the erosion radius
 *    (§5.3), because the morphological OPENING has a blind spot at short necks
 *    and the closest points of two fully eroded cores can sit in an unrelated
 *    slit rather than at the neck that joins them.
 *  - `COPPER_SLIVER` — copper that is thinner than `w` everywhere: an annulus, a
 *    hairline appendage, an acid-trap spike (§5.4).
 *  - `COPPER_SHAPE_UNCHECKED` — the explicit "we did not answer" (§5.5). A
 *    kernel throw, a unit over the vertex budget and a truncated neck list all
 *    report rather than pass silently.
 *  - `TRACE_ACUTE_ANGLE` / `TRACE_OVERLAP` — the two junction-level DFM facts
 *    the union cannot see once the copper is merged (§5.6, §5.7).
 *
 * Batch only by construction: this is a `DRC_STAGES` entry, `legality.ts` never
 * runs it and none of these codes joins `LIVE_CODES`.
 */
export function checkCopperShape(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const dfm = ctx.designRules.dfm;
  // `w` is capped by the board's own minimum trace width (§5.1): a web as wide
  // as the narrowest trace the board allows is never a neck, however small the
  // configured sliver width is.
  const w = Math.min(
    optLength(dfm?.sliverWidthMm) ?? DEFAULT_SLIVER_WIDTH_MM,
    ctx.designRules.minimums.traceWidthMm,
  );
  const radiusMm = w / 2 - EROSION_MARGIN_MM;
  if (radiusMm > 0) {
    const minLengthMm =
      optLength(dfm?.sliverMinLengthMm) ?? DEFAULT_SLIVER_MIN_LENGTH_MM;
    for (const draft of shapeDrafts(ctx, w, radiusMm, minLengthMm)) {
      out.push(draft);
    }
  } else {
    // A board whose effective web width leaves no erosion radius gets an
    // explicit verdict, not silence (R2 #7): the shape half of this check did
    // not run, and §5.5 allows exactly one way to say so.
    out.push({
      code: "COPPER_SHAPE_UNCHECKED",
      message: `Effective web width ${w.toFixed(4)} mm is below the ${(2 * EROSION_MARGIN_MM).toFixed(3)} mm floor — copper shape not checked`,
      anchors: [{ kind: "boardEdge" }],
    });
  }
  const limitDeg =
    optAngleDeg(dfm?.acuteAngleDeg) ?? DEFAULT_ACUTE_ANGLE_DEG;
  for (const draft of junctionDrafts(ctx, limitDeg)) out.push(draft);
  return out;
}

/**
 * `optNum` semantics (§6): only a finite stored number has a say. Lengths must
 * be positive — a zero sliver width is not a rule, it is an absent one — while
 * the ANGLE limit accepts 0, which is the user asking for no wedge reports at
 * all rather than for the 90° default.
 */
function optLength(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function optAngleDeg(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

// --- §5.1–§5.5: units, necks, slivers ---------------------------------------

function shapeDrafts(
  ctx: DrcContext,
  w: number,
  radiusMm: number,
  minLengthMm: number,
): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const budgets = ctx.copperShapeBudgets;
  const units: CopperUnit[] = [];
  const skipped: CopperUnitSkip[] = [];
  for (const layer of stackup(ctx)) {
    const { byNet, nullNet } = layerItems(ctx, layer);
    if (byNet.size === 0 && nullNet.length === 0) continue;
    const built = buildCopperUnits({
      layer,
      byNet,
      nullNet,
      budgets,
      anchorKeyOf: anchorKey,
    });
    for (const unit of built.units) units.push(unit);
    for (const skip of built.skipped) skipped.push(skip);
  }

  for (const skip of skipped) {
    out.push({
      code: "COPPER_SHAPE_UNCHECKED",
      message: `Copper shape not checked on ${unitLabel(ctx, skip.netId)} / ${skip.layer}: ${skipReason(skip, budgets)}`,
      anchors: [skip.anchor],
      layer: skip.layer,
    });
  }

  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i]!;
    // Execution checkpoint per unit AND per erosion inside it (contract 09 §6):
    // one unit is the indivisible piece of copper-shape work.
    ctx.tick?.("copperShapeUnit", i, units.length);
    const tick = () => ctx.tick?.("copperShapeUnit", i, units.length);
    try {
      // Quiet: a kernel refusal here becomes `COPPER_SHAPE_UNCHECKED` below, and
      // a reported verdict is not a warning (R2 note).
      for (const draft of runKernelQuietly(() =>
        unitDrafts(ctx, unit, w, radiusMm, minLengthMm, tick),
      )) {
        out.push(draft);
      }
    } catch (error) {
      if (error instanceof CopperShapeBudgetError) {
        out.push({
          code: "COPPER_SHAPE_UNCHECKED",
          message: `Copper shape not checked on ${unitLabel(ctx, unit.netId)} / ${unit.layer}: the ${budgets.maxEdgeComparisonsPerUnit} edge-comparison budget was exhausted`,
          anchors: [unit.anchor],
          layer: unit.layer,
        });
        continue;
      }
      if (!(error instanceof CopperKernelError)) throw error;
      out.push({
        code: "COPPER_SHAPE_UNCHECKED",
        message: `Copper shape not checked on ${unitLabel(ctx, unit.netId)} / ${unit.layer}: the copper kernel refused the geometry`,
        anchors: [unit.anchor],
        layer: unit.layer,
      });
    }
  }
  return out;
}

/** Why a unit was refused, in the words its report uses (§5.5). */
function skipReason(
  skip: CopperUnitSkip,
  budgets: { vertexBudget: number; maxEdgeComparisonsPerUnit: number },
): string {
  if (skip.reason === "budget") {
    return `${skip.inputVertexCount} input vertices exceed the ${budgets.vertexBudget} budget`;
  }
  if (skip.reason === "work") {
    return `the ${budgets.maxEdgeComparisonsPerUnit} edge-comparison budget was exhausted`;
  }
  return "the copper kernel refused the geometry";
}

function unitDrafts(
  ctx: DrcContext,
  unit: CopperUnit,
  w: number,
  radiusMm: number,
  minLengthMm: number,
  tick: () => void,
): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const budgets = ctx.copperShapeBudgets;
  // ONE erosion budget for the whole unit (§5.5), shared by every group.
  const budget = { remaining: budgets.maxErosionsPerUnit };
  // ONE geometric work allowance for the whole unit, like the erosions.
  const work = { remaining: budgets.maxEdgeComparisonsPerUnit, tick };
  const label = unitLabel(ctx, unit.netId);
  let unlocated = 0;
  let lowerBound = false;
  let truncation: ShapeTruncation = "none";
  let unexamined = 0;
  let groupCount = 0;

  for (const group of groupComponents(unit.paths, work)) {
    groupCount += 1;
    const found = analyseGroup(group, radiusMm, {
      budgets,
      budget,
      work,
      minLengthMm,
      tick,
    });
    if (!found.examined) {
      unexamined += 1;
      continue;
    }
    unlocated += found.unlocatedCount;
    if (found.unlocatedIsLowerBound) lowerBound = true;
    if (found.truncation !== "none" && truncation === "none") {
      truncation = found.truncation;
    }
    for (const neck of found.necks) {
      out.push({
        code: "COPPER_CONNECTION_WIDTH",
        message: `Copper on ${label} narrows to ≈${neck.widthMm.toFixed(3)} mm (< ${w.toFixed(3)} mm) at ${point(neck.locationMm)}`,
        anchors: [unit.anchor],
        locationMm: neck.locationMm,
        layer: unit.layer,
        measuredMm: neck.widthMm,
        requiredMm: w,
      });
    }
    for (const sliver of found.slivers) {
      out.push({
        code: "COPPER_SLIVER",
        message: `Copper sliver on ${label}: ≈${sliver.thicknessMm.toFixed(3)} mm thick, ${sliver.lengthMm.toFixed(1)} mm long`,
        anchors: [unit.anchor],
        locationMm: sliver.locationMm,
        layer: unit.layer,
        measuredMm: sliver.thicknessMm,
        requiredMm: w,
      });
    }
  }

  // Truncation is EXPLICIT, never a completeness claim (§5.5), and it NAMES
  // what stopped it (R2 #8): a neck cap drops a known number of located
  // candidates, while an exhausted erosion budget stopped the search itself and
  // can only give a lower bound. Both facts go in ONE draft — they share an
  // anchor, a layer and therefore an id.
  const parts: string[] = [];
  if (unlocated > 0) {
    const cause =
      truncation === "erosionBudget"
        ? `erosion budget ${budgets.maxErosionsPerUnit}`
        : `cap ${budgets.maxNecksPerUnit}`;
    const qualifier = lowerBound ? "at least " : "";
    parts.push(
      `${qualifier}${unlocated} more neck${unlocated === 1 ? "" : "s"} not located (${cause})`,
    );
  }
  if (unexamined > 0) {
    parts.push(
      `${unexamined} of ${groupCount} copper piece${groupCount === 1 ? "" : "s"} not examined (erosion budget ${budgets.maxErosionsPerUnit})`,
    );
  }
  if (parts.length > 0) {
    out.push({
      code: "COPPER_SHAPE_UNCHECKED",
      message: `Copper shape not fully checked on ${label} / ${unit.layer}: ${parts.join("; ")}`,
      anchors: [unit.anchor],
      layer: unit.layer,
    });
  }
  return out;
}

/** Copper layers in stackup order, restricted to the ones this board has. */
function stackup(ctx: DrcContext): PcbCopperLayerId[] {
  return copperLayersForCount(ctx.layerCount).filter((l) =>
    ctx.validCopperLayers.has(l),
  );
}

interface LayerItems {
  byNet: Map<string, CopperShapeItem[]>;
  nullNet: CopperShapeItem[];
}

/**
 * Every piece of copper on one layer, in canonical input order (§5.1). NO ITEM
 * IS EXCLUDED FOR BEING NARROW: two sub-`w` traces side by side are a `w`-wide
 * connection, and a lone sub-`w` trace between two pads is reported here as the
 * neck it is AND by the width rules — both are true.
 *
 * Trace stadiums and via discs are built CIRCUMSCRIBED so a `w`-wide item's
 * inscribed radius is never below `w/2`: an inscribed 16-cap stadium has
 * inradius `(w/2)·cos(π/32)`, which loses to the erosion radius at any `w`.
 */
function layerItems(ctx: DrcContext, layer: PcbCopperLayerId): LayerItems {
  const byNet = new Map<string, CopperShapeItem[]>();
  const nullNet: CopperShapeItem[] = [];
  const add = (netId: string | null, item: CopperShapeItem): void => {
    if (netId === null) {
      nullNet.push(item);
      return;
    }
    const list = byNet.get(netId);
    if (list) list.push(item);
    else byNet.set(netId, [item]);
  };

  for (const pad of ctx.pads) {
    if (!pad.layers.includes(layer)) continue;
    if (pad.ring.length < 3) continue;
    add(pad.netId, {
      key: `${anchorKey(pad.anchor)}|${ringKey(pad.ring)}`,
      anchor: pad.anchor,
      rings: [ccw(pad.ring)],
    });
  }

  for (const trace of ctx.traces) {
    if (trace.layer !== layer) continue;
    if (trace.halfWidthMm <= 0) continue;
    const anchor: DrcAnchor = { kind: "trace", traceId: trace.id };
    const key = anchorKey(anchor);
    for (let i = 1; i < trace.pointsMm.length; i += 1) {
      const ring = buildTraceSegmentStadium(
        trace.pointsMm[i - 1]!,
        trace.pointsMm[i]!,
        trace.halfWidthMm,
        undefined,
        true,
      );
      if (!ring) continue;
      add(trace.netId, {
        key: `${key}|${String(i).padStart(8, "0")}`,
        anchor,
        rings: [ccw(fromClipperRing(ring))],
      });
    }
    // A one-point trace still carries a cap's worth of copper.
    if (trace.pointsMm.length === 1) {
      const ring = buildDiscRing(trace.pointsMm[0]!, trace.halfWidthMm, 32, true);
      add(trace.netId, {
        key: `${key}|00000000`,
        anchor,
        rings: [ccw(fromClipperRing(ring))],
      });
    }
  }

  for (const via of ctx.vias) {
    if (!via.layers.includes(layer)) continue;
    if (via.radiusMm <= 0) continue;
    const anchor: DrcAnchor = { kind: "via", viaId: via.via.id };
    add(via.netId, {
      key: anchorKey(anchor),
      anchor,
      rings: [ccw(fromClipperRing(buildDiscRing(via.center, via.radiusMm, undefined, true)))],
    });
  }

  let zoneIndex = -1;
  for (const { zone, result } of ctx.pourResults()) {
    zoneIndex += 1;
    if (zone.layer !== layer || result.status !== "ok") continue;
    const anchor: DrcAnchor = { kind: "zone", zoneId: zone.id };
    for (let i = 0; i < result.islands.length; i += 1) {
      const island = result.islands[i]!;
      const rings = orientIslandRings(island.rings);
      if (rings.length === 0) continue;
      add(zone.netId, {
        key: `pour:${String(zoneIndex).padStart(6, "0")}:${String(i).padStart(6, "0")}`,
        anchor,
        rings,
      });
    }
  }

  return { byNet, nullNet };
}

function fromClipperRing(ring: ClipperRing): PcbPointMm[] {
  return ring.map(([x, y]) => ({ x, y }));
}

function ccw(ring: readonly PcbPointMm[]): PcbPointMm[] {
  return ensureCcwRing(ring).map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Geometric tie-break for the canonical input order: two copper SHAPES of one
 * pad share an anchor key, so the key alone is not a total order over the
 * union's inputs (contract 06 §7).
 */
function ringKey(ring: readonly PcbPointMm[]): string {
  let minX = Infinity;
  let minY = Infinity;
  for (const p of ring) {
    if (p.x < minX || (p.x === minX && p.y < minY)) {
      minX = p.x;
      minY = p.y;
    }
  }
  return `${minX.toFixed(6)},${minY.toFixed(6)}`;
}

function unitLabel(ctx: DrcContext, netId: string | null): string {
  return netId === null
    ? "unassigned copper"
    : `net ${ctx.netNames[netId] ?? netId}`;
}

function point(p: PcbPointMm): string {
  return `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`;
}

// --- §5.6 / §5.7: trace junctions -------------------------------------------

/** One reportable wedge or overlap, before it becomes a draft. */
interface JunctionEvent {
  anchors: DrcAnchor[];
  locationMm: PcbPointMm;
  angleDeg: number;
}

function junctionDrafts(ctx: DrcContext, limitDeg: number): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const cover = coverIndex(ctx);
  const keys = ctx.traces.map((t) => anchorKey({ kind: "trace", traceId: t.id }));

  const emitAcute = (
    trace: DrcTrace,
    event: JunctionEvent,
    nets: ReadonlySet<string | null>,
  ): void => {
    // A COLLINEAR, same-direction junction is not a copper-free wedge: the two
    // stadiums lie on top of each other and there is no acid trap between them.
    // That is `TRACE_OVERLAP`'s feature, and reporting it here as well made
    // every duplicated stub and every fold carry two codes for one fact. An
    // angle near 180° — the straight continuation — already passes the limit.
    if (event.angleDeg <= ANGLE_EPS_DEG) return;
    if (!(event.angleDeg < limitDeg - ANGLE_EPS_DEG)) return;
    // A covered wedge is filled by that copper and is not an acid trap (§5.6).
    if (cover(trace.layer, event.locationMm, nets)) return;
    out.push({
      code: "TRACE_ACUTE_ANGLE",
      message: `Acute copper wedge on ${trace.layer}: trace copper meets at ${event.angleDeg.toFixed(1)}° (< ${limitDeg}°)`,
      anchors: event.anchors,
      locationMm: event.locationMm,
      layer: trace.layer,
    });
  };

  const emitOverlap = (layer: PcbCopperLayerId, overlap: OverlapEvent): void => {
    out.push({
      code: "TRACE_OVERLAP",
      message: `Traces on ${layer} run over each other for ${overlap.lengthMm.toFixed(3)} mm at ${point(overlap.locationMm)}`,
      anchors: overlap.anchors,
      locationMm: overlap.locationMm,
      layer,
    });
  };

  for (let i = 0; i < ctx.traces.length; i += 1) {
    const a = ctx.traces[i]!;
    // (a) interior vertices of one trace.
    for (const event of interiorWedges(a)) {
      emitAcute(a, event, new Set([a.netId]));
    }
    // A trace that doubles back over itself (§5.7): the same copper twice, on
    // one trace, which no different-trace pair loop can see.
    for (const overlap of selfOverlaps(a)) emitOverlap(a.layer, overlap);
    // The copper superset the broad phase offers; a junction or a crossing
    // always overlaps copper, so a zero halo is enough (08 §2.1).
    for (const j of ctx.nearPolyline("traces", a.pointsMm, a.halfWidthMm, 0)) {
      if (j === i) continue;
      const b = ctx.traces[j]!;
      // Canonical pair orientation: each unordered pair is judged once, from
      // the smaller anchor key, so input order cannot double- or half-report.
      if (!(keys[i]! < keys[j]!)) continue;
      if (a.layer !== b.layer) continue;
      if (!netsCompatible(a.netId, b.netId)) continue;
      const nets = new Set<string | null>([a.netId, b.netId]);
      for (const event of pairWedges(a, b)) emitAcute(a, event, nets);
      for (const overlap of collinearOverlaps(a, b)) emitOverlap(a.layer, overlap);
    }
  }
  return out;
}

/** Same net, or either side unassigned — a different-net contact is a short. */
function netsCompatible(a: string | null, b: string | null): boolean {
  return a === b || a === null || b === null;
}

/**
 * §5.6 (a): the angle between the two segments meeting at an interior vertex.
 * Zero-length segments are skipped by walking to the next DISTINCT point, so a
 * duplicated vertex is not a 0° wedge; a genuine 180° reversal IS `θ = 0` and
 * reports.
 */
function interiorWedges(trace: DrcTrace): JunctionEvent[] {
  const pts = trace.pointsMm;
  const out: JunctionEvent[] = [];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i]!;
    const prev = previousDistinct(pts, i);
    const next = nextDistinct(pts, i);
    if (prev === null || next === null) continue;
    const angleDeg = angleBetween(
      { x: pts[prev]!.x - p.x, y: pts[prev]!.y - p.y },
      { x: pts[next]!.x - p.x, y: pts[next]!.y - p.y },
    );
    if (angleDeg === null) continue;
    out.push({
      // Segment `k` joins `pointsMm[k]` and `pointsMm[k+1]` — the two that
      // meet at vertex `i` are `i − 1` and `i`.
      anchors: [
        { kind: "segment", traceId: trace.id, index: i - 1 },
        { kind: "segment", traceId: trace.id, index: i },
      ],
      locationMm: { x: p.x, y: p.y },
      angleDeg,
    });
  }
  return out;
}

/**
 * §5.6 (b) endpoint-to-endpoint and (c) endpoint-to-interior junctions, plus
 * (d) interior crossings.
 *
 * The junction threshold is `min(halfWidth_a, halfWidth_b)`, not
 * `CONNECT_EPS_MM`: the persisted integer-nanometre grid puts two ends of one
 * routed corner up to 1 nm apart, and their cap copper still overlaps — the
 * wedge is physically there.
 */
function pairWedges(a: DrcTrace, b: DrcTrace): JunctionEvent[] {
  const out: JunctionEvent[] = [];
  const threshold = Math.min(a.halfWidthMm, b.halfWidthMm);

  for (const ea of endpoints(a)) {
    for (const eb of endpoints(b)) {
      if (distance(ea.point, eb.point) > threshold) continue;
      const angleDeg = angleBetween(ea.direction, eb.direction);
      if (angleDeg === null) continue;
      out.push({
        anchors: [
          { kind: "segment", traceId: a.id, index: ea.segmentIndex },
          { kind: "segment", traceId: b.id, index: eb.segmentIndex },
        ],
        // The midpoint, so the location does not depend on which trace led.
        locationMm: {
          x: (ea.point.x + eb.point.x) / 2,
          y: (ea.point.y + eb.point.y) / 2,
        },
        angleDeg,
      });
    }
  }

  for (const [end, host] of [
    [a, b],
    [b, a],
  ] as const) {
    const hostEnds = endpoints(host);
    for (const e of endpoints(end)) {
      // Already an endpoint-to-endpoint junction — case (b) owns it.
      if (hostEnds.some((h) => distance(e.point, h.point) <= threshold)) continue;
      // A T that lands on an INTERIOR VERTEX of the host meets two segments at
      // once. It is ONE wedge, not two (R2 #6): judge both and keep the
      // smaller angle, anchored on the host segment that forms it.
      const handled = new Set<number>();
      for (let v = 1; v < host.pointsMm.length - 1; v += 1) {
        if (distance(e.point, host.pointsMm[v]!) > threshold) continue;
        let best: JunctionEvent | null = null;
        for (const seg of [v - 1, v]) {
          handled.add(seg);
          const s0 = host.pointsMm[seg]!;
          const s1 = host.pointsMm[seg + 1]!;
          const angleDeg = smallerAngle(
            angleBetween(e.direction, { x: s1.x - s0.x, y: s1.y - s0.y }),
          );
          if (angleDeg === null) continue;
          if (best === null || angleDeg < best.angleDeg) {
            best = {
              anchors: [
                { kind: "segment", traceId: end.id, index: e.segmentIndex },
                { kind: "segment", traceId: host.id, index: seg },
              ],
              locationMm: { x: e.point.x, y: e.point.y },
              angleDeg,
            };
          }
        }
        if (best) out.push(best);
      }
      for (let i = 0; i + 1 < host.pointsMm.length; i += 1) {
        if (handled.has(i)) continue;
        const s0 = host.pointsMm[i]!;
        const s1 = host.pointsMm[i + 1]!;
        const hit = projectPointToSegment(e.point, s0, s1);
        if (hit.distance > threshold) continue;
        const angleDeg = smallerAngle(
          angleBetween(e.direction, { x: s1.x - s0.x, y: s1.y - s0.y }),
        );
        if (angleDeg === null) continue;
        out.push({
          anchors: [
            { kind: "segment", traceId: end.id, index: e.segmentIndex },
            { kind: "segment", traceId: host.id, index: i },
          ],
          locationMm: { x: e.point.x, y: e.point.y },
          angleDeg,
        });
      }
    }
  }

  for (let i = 1; i < a.pointsMm.length; i += 1) {
    const a0 = a.pointsMm[i - 1]!;
    const a1 = a.pointsMm[i]!;
    for (let j = 1; j < b.pointsMm.length; j += 1) {
      const b0 = b.pointsMm[j - 1]!;
      const b1 = b.pointsMm[j]!;
      if (!segmentsCrossTransversally(a0, a1, b0, b1)) continue;
      const angleDeg = smallerAngle(
        angleBetween({ x: a1.x - a0.x, y: a1.y - a0.y }, { x: b1.x - b0.x, y: b1.y - b0.y }),
      );
      if (angleDeg === null) continue;
      // Transversal ⇒ the closest points coincide at the crossing.
      const cross = segmentClosestPoints(a0, a1, b0, b1).a;
      out.push({
        anchors: [
          { kind: "segment", traceId: a.id, index: i - 1 },
          { kind: "segment", traceId: b.id, index: j - 1 },
        ],
        locationMm: { x: cross.x, y: cross.y },
        angleDeg,
      });
    }
  }
  return out;
}

interface TraceEnd {
  point: PcbPointMm;
  /** Direction from the endpoint INTO the trace. */
  direction: PcbPointMm;
  /** 0-based: segment `k` joins `pointsMm[k]` and `pointsMm[k+1]`. */
  segmentIndex: number;
}

function endpoints(trace: DrcTrace): TraceEnd[] {
  const pts = trace.pointsMm;
  if (pts.length < 2) return [];
  const out: TraceEnd[] = [];
  const first = nextDistinct(pts, 0);
  if (first !== null) {
    out.push({
      point: pts[0]!,
      direction: { x: pts[first]!.x - pts[0]!.x, y: pts[first]!.y - pts[0]!.y },
      segmentIndex: 0,
    });
  }
  const last = pts.length - 1;
  const back = previousDistinct(pts, last);
  if (back !== null) {
    out.push({
      point: pts[last]!,
      direction: {
        x: pts[back]!.x - pts[last]!.x,
        y: pts[back]!.y - pts[last]!.y,
      },
      segmentIndex: last - 1,
    });
  }
  return out;
}

function previousDistinct(
  pts: readonly PcbPointMm[],
  index: number,
): number | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (distance(pts[i]!, pts[index]!) > GEOM_EPS_MM) return i;
  }
  return null;
}

function nextDistinct(
  pts: readonly PcbPointMm[],
  index: number,
): number | null {
  for (let i = index + 1; i < pts.length; i += 1) {
    if (distance(pts[i]!, pts[index]!) > GEOM_EPS_MM) return i;
  }
  return null;
}

/** Angle in degrees between two direction vectors, or null when degenerate. */
function angleBetween(u: PcbPointMm, v: PcbPointMm): number | null {
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (lu <= GEOM_EPS_MM || lv <= GEOM_EPS_MM) return null;
  const cos = Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** The smaller of the two angles a line makes with another — `θ` or `180 − θ`. */
function smallerAngle(angleDeg: number | null): number | null {
  return angleDeg === null ? null : Math.min(angleDeg, 180 - angleDeg);
}

interface OverlapEvent {
  anchors: DrcAnchor[];
  locationMm: PcbPointMm;
  lengthMm: number;
}

/**
 * §5.7, the WITHIN-trace arm: two segments of ONE trace that are collinear and
 * whose projections share length — the trace runs back over its own copper.
 *
 * ALL pairs, not just adjacent ones (R2 #5): a trace that loops away and comes
 * back lays the same copper twice just as a fold does, and the different-trace
 * loop below can never see either. Segments are taken in DISTINCT form (R2 #3):
 * a duplicated vertex makes a zero-length segment, and pairing blindly over
 * consecutive indices then compares a real segment with a point and reports
 * nothing at all. A straight continuation shares only its shared vertex, so its
 * overlap is zero and it is filtered by the same `GEOM_EPS_MM` test.
 */
function selfOverlaps(trace: DrcTrace): OverlapEvent[] {
  const segments = distinctSegments(trace.pointsMm);
  const out: OverlapEvent[] = [];
  for (let x = 0; x < segments.length; x += 1) {
    for (let y = x + 1; y < segments.length; y += 1) {
      const a = segments[x]!;
      const b = segments[y]!;
      const event = collinearOverlap(a, b, trace.id, trace.id);
      if (event) out.push(event);
    }
  }
  return out;
}

/** A trace's segments with every zero-length one dropped, index preserved. */
interface TraceSegment {
  index: number;
  a: PcbPointMm;
  b: PcbPointMm;
  lengthMm: number;
}

function distinctSegments(pts: readonly PcbPointMm[]): TraceSegment[] {
  const out: TraceSegment[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const lengthMm = distance(a, b);
    if (lengthMm <= GEOM_EPS_MM) continue;
    out.push({ index: i - 1, a, b, lengthMm });
  }
  return out;
}

/**
 * The overlap of two collinear segments, or null. Shared by both §5.7 arms so
 * a fold and a duplicate are measured and located the same way.
 */
function collinearOverlap(
  a: TraceSegment,
  b: TraceSegment,
  traceA: string,
  traceB: string,
): OverlapEvent | null {
  if (!isCollinear(a.a, a.b, b.a) || !isCollinear(a.a, a.b, b.b)) return null;
  const t0 = param(b.a, a.a, a.b, a.lengthMm);
  const t1 = param(b.b, a.a, a.b, a.lengthMm);
  const lo = Math.max(0, Math.min(t0, t1));
  const hi = Math.min(a.lengthMm, Math.max(t0, t1));
  const overlap = hi - lo;
  if (overlap <= GEOM_EPS_MM) return null;
  const mid = (lo + hi) / 2 / a.lengthMm;
  return {
    anchors: [
      { kind: "segment", traceId: traceA, index: a.index },
      { kind: "segment", traceId: traceB, index: b.index },
    ],
    locationMm: {
      x: a.a.x + (a.b.x - a.a.x) * mid,
      y: a.a.y + (a.b.y - a.a.y) * mid,
    },
    lengthMm: overlap,
  };
}

/**
 * §5.7, the BETWEEN-trace arm: two segments of DIFFERENT traces on one layer
 * that are collinear and whose projections share more than `GEOM_EPS_MM` of
 * length. Different-net overlap is `NET_SHORT_CIRCUIT`'s; this covers the
 * same-net and null-net duplicates the item model cannot see.
 */
function collinearOverlaps(a: DrcTrace, b: DrcTrace): OverlapEvent[] {
  const out: OverlapEvent[] = [];
  for (const sa of distinctSegments(a.pointsMm)) {
    for (const sb of distinctSegments(b.pointsMm)) {
      const event = collinearOverlap(sa, sb, a.id, b.id);
      if (event) out.push(event);
    }
  }
  return out;
}

/** Arc-length parameter of `p` projected onto the line a0→a1 (mm from a0). */
function param(
  p: PcbPointMm,
  a0: PcbPointMm,
  a1: PcbPointMm,
  len: number,
): number {
  return ((p.x - a0.x) * (a1.x - a0.x) + (p.y - a0.y) * (a1.y - a0.y)) / len;
}

/**
 * "Is this junction point already inside same-net pad / via / pour copper?"
 * (§5.6). Built once per run: the pour islands carry no broad-phase index, so
 * they get their own AABB list rather than a full scan per junction.
 */
function coverIndex(
  ctx: DrcContext,
): (
  layer: PcbCopperLayerId,
  p: PcbPointMm,
  nets: ReadonlySet<string | null>,
) => boolean {
  let islands:
    | Array<{
        layer: PcbCopperLayerId;
        netId: string | null;
        rings: PcbPointMm[][];
        bounds: RingBounds;
      }>
    | undefined;
  const ensureIslands = () => {
    if (islands) return islands;
    islands = [];
    for (const { zone, result } of ctx.pourResults()) {
      if (result.status !== "ok") continue;
      for (const island of result.islands) {
        const outer = island.rings[0];
        if (!outer || outer.length < 3) continue;
        islands.push({
          layer: zone.layer,
          netId: zone.netId,
          rings: island.rings,
          bounds: ringBox(outer),
        });
      }
    }
    return islands;
  };

  return (layer, p, nets) => {
    const box: RingBounds = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    for (const i of ctx.near("pads", box, 0)) {
      const pad = ctx.pads[i]!;
      if (!pad.layers.includes(layer) || !nets.has(pad.netId)) continue;
      if (pad.disc) {
        if (distance(p, pad.disc.center) <= pad.disc.radiusMm) return true;
      } else if (pointInPolygon(p, pad.ring)) return true;
    }
    for (const i of ctx.near("vias", box, 0)) {
      const via = ctx.vias[i]!;
      if (!via.layers.includes(layer) || !nets.has(via.netId)) continue;
      if (distance(p, via.center) <= via.radiusMm) return true;
    }
    for (const island of ensureIslands()) {
      if (island.layer !== layer || !nets.has(island.netId)) continue;
      const b = island.bounds;
      if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
      if (!pointInPolygon(p, island.rings[0]!)) continue;
      let inHole = false;
      for (let k = 1; k < island.rings.length; k += 1) {
        if (pointInPolygon(p, island.rings[k]!)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  };
}

function ringBox(ring: readonly PcbPointMm[]): RingBounds {
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
