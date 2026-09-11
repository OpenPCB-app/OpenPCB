import {
  type BoardRegion,
  discInsideRegion,
  regionBoundaryDistancePoint,
  regionBoundaryDistancePolyline,
  regionContainsPoint,
  stadiumInsideRegion,
} from "../../pcb-geometry/board-region";
import {
  regionBoundaryDistanceRounded,
  roundedInsideRegion,
  roundedPenetration,
} from "../../pcb-geometry/region-rounded";
import {
  type ExactBudget,
  ExactBudgetExceeded,
  exactSignedMargin,
} from "../../pcb-geometry/region-exact";
import type { RoundedShape } from "../../pcb-geometry/rounded-shape-types";
import { GEOM_EPS_MM } from "../../pcb-geometry/tolerance";
import type { PcbPointMm } from "../../../sdks/designer";
import {
  pointToRingEdgeDistance,
  polylineToRingEdgeDistance,
} from "../../pcb-geometry/pcb-clearance-geometry";
import { distance } from "../../pcb-geometry/pcb-trace-geometry";
import { FAB_PRESETS } from "../fab-presets";
import {
  below,
  holeBounds,
  type DrcContext,
  type DrcPad,
  type DrcTrace,
  type LegalityContext,
} from "../drc-context";
import type { ItemSet } from "./clearance-judge";
import { clearanceViolated } from "../../pcb-geometry/tolerance";
import type { DrcViolationDraft } from "../types";
import { segmentToSegmentDistance } from "../../pcb-geometry/pcb-trace-geometry";
import type { DrcHole } from "../drc-context";
import type { RegionIndex } from "../../pcb-geometry/region-index";
import type { ScalarItem } from "../rule-resolver";
import { ruleSuffix } from "../rule-message";
import { anchorKey } from "../violation-id";
/** A hole's scope geometry is its DRILL — an NPTH has no copper (§4.2). */
function holeGeometry(hole: DrcHole): ScalarItem["geometry"] {
  return hole.slot
    ? {
        kind: "segment",
        a: hole.slot.a,
        b: hole.slot.b,
        halfWidthMm: hole.slot.widthMm / 2,
      }
    : { kind: "disc", center: hole.center, radiusMm: hole.drillMm / 2 };
}

/** Edge-to-edge gap between two holes, slot-aware when either carries a slot. */
function holeEdgeGap(a: DrcHole, b: DrcHole, centerGap: number): number {
  if (!a.slot && !b.slot) return centerGap - (a.drillMm / 2 + b.drillMm / 2);
  const segA = a.slot ? [a.slot.a, a.slot.b] : [a.center, a.center];
  const segB = b.slot ? [b.slot.a, b.slot.b] : [b.center, b.center];
  const radA = a.slot ? a.slot.widthMm / 2 : a.drillMm / 2;
  const radB = b.slot ? b.slot.widthMm / 2 : b.drillMm / 2;
  return (
    segmentToSegmentDistance(segA[0]!, segA[1]!, segB[0]!, segB[1]!) -
    (radA + radB)
  );
}

// --- §4: board-edge verdicts on a certified interval -------------------------

/**
 * Primitive comparisons ONE AMBIGUOUS ITEM's exact recomputation may spend
 * (12 §4, §10). PER ITEM, not per run: a shared allowance is consumed in INPUT
 * ORDER, so reversing the pad array changed which items kept a chord verdict
 * (52 ids moved on Astra run 2's board) — a report that depends on enumeration
 * order, which 06 §7 forbids. With its own budget an item's verdict is a
 * function of the item and the board alone.
 *
 * 50 000 is ~8× what the worst real item costs: a 1-point core against a
 * 2 000-primitive outline spends ≈ 6 000 (one ray cast per core vertex, one
 * comparison per primitive for the radius test, one more for the margin), and a
 * 4-point rect core ≈ 5× that. It still bounds the pathological board.
 */
const BOARD_EXACT_ITEM_BUDGET = 50_000;

/** Recorded in the message when an ellipse's chord bound decided a verdict. */
const CHORD_BOUND_NOTE =
  " (an elliptical boundary: judged within its chord bound)";

/**
 * §6: the perimeter distance, negated when the copper is not on the board.
 * A ring that CROSSES the edge has a perimeter distance of 0, which would
 * serialise as `0`, not `-0`; its magnitude is then how far the ring reaches
 * past the boundary (R1 #7), never less than the geometry epsilon.
 *
 * Hoisted to module scope (12 §4) so the oracle body and the indexed body
 * cannot drift: every edit of §1 and §4 lands in both, and this is the one
 * place the report value is formed.
 */
function signed(gap: number, inside: boolean, penetration = 0): number {
  return inside ? gap : -Math.max(Math.abs(gap), penetration, GEOM_EPS_MM);
}

/**
 * The one halo every §4 query carries: the rule bound, the item's own extent and
 * the region's chord bound (Astra run 1 #2).
 *
 * `BoardRegion.maxBoundMm` — like `exact`, `boundMm` and `outerBias` — is a
 * LAZY, NON-ENUMERABLE getter (`region-build.attachDerived`). A region that was
 * spread, cloned or `structuredClone`d has lost it, and `undefined` would make
 * this halo `NaN`: a NaN halo makes every bounds test false, filters every edge
 * out, reads the distance back as `Infinity` and DROPS the verdict in silence.
 * That is exactly the failure mode the halo term exists to prevent, so it fails
 * loudly here instead. Never rebuild a `BoardRegion` by spreading it.
 */
function edgeHaloMm(
  ctx: LegalityContext,
  region: BoardRegion,
  extentMm: number,
): number {
  const halo = ctx.maxEdgeBoundMm + extentMm + region.maxBoundMm;
  if (!Number.isFinite(halo)) {
    throw new Error(
      `[drc/board] board-edge halo is not finite (maxEdgeBoundMm=${ctx.maxEdgeBoundMm}, extent=${extentMm}, BoardRegion.maxBoundMm=${region.maxBoundMm}) — a BoardRegion rebuilt by spreading loses its lazy maxBoundMm / exact / outerBias getters`,
    );
  }
  return halo;
}

/** One item measured against ONE region — the quantities §4 brackets. */
interface EdgeMeasure {
  /** Unsigned perimeter distance less the item's own extent: what §4 compares. */
  gapMm: number;
  inside: boolean;
  /** How far the item reaches past the region; 0 when it is inside. */
  penetrationMm: number;
}

/** A rule's own comparison, as a predicate on a margin (12 §4). */
type EdgeRegime = (marginMm: number, requiredMm: number) => boolean;

/**
 * The measures below are the SAME functional applied to two nested regions, per
 * item kind. That is what makes `m_lo <= m_exact <= m_hi` true: swapping the
 * predicate between the two ends would bracket nothing.
 */
function stadiumMeasure(
  region: BoardRegion,
  index: RegionIndex | undefined,
  pts: readonly PcbPointMm[],
  halfWidthMm: number,
  haloMm: number,
): EdgeMeasure {
  const single = pts.length === 1 ? pts[0]! : null;
  const gapMm =
    (single
      ? regionBoundaryDistancePoint(region, single, index, haloMm)
      : regionBoundaryDistancePolyline(region, pts, index, haloMm)) -
    halfWidthMm;
  return {
    gapMm,
    inside: stadiumInsideRegion(region, pts, halfWidthMm, GEOM_EPS_MM, index),
    penetrationMm: 0,
  };
}

function discMeasure(
  region: BoardRegion,
  index: RegionIndex | undefined,
  center: PcbPointMm,
  radiusMm: number,
  haloMm: number,
): EdgeMeasure {
  return {
    gapMm: regionBoundaryDistancePoint(region, center, index, haloMm) - radiusMm,
    inside: discInsideRegion(region, center, radiusMm, GEOM_EPS_MM, index),
    penetrationMm: 0,
  };
}

/**
 * A pad's measure. A TRUE circle keeps its exact `disc` arithmetic bit for bit
 * (contract 06 §2); every other pad is its ROUNDED shape — a convex core ⊕ a
 * disc (12 §1.2) — instead of the circumscribed `ring`, which cost an oval or
 * roundrect up to a 0.86 %·r false-fail band against the board edge. For a rect
 * pad the core IS the ring and the radius is 0, so the two agree on the bit.
 */
function padMeasure(
  region: BoardRegion,
  index: RegionIndex | undefined,
  pad: DrcPad,
  haloMm: number,
): EdgeMeasure {
  const disc = pad.disc;
  if (disc) return discMeasure(region, index, disc.center, disc.radiusMm, haloMm);
  const inside = roundedInsideRegion(region, pad.rounded, GEOM_EPS_MM, index);
  return {
    gapMm: regionBoundaryDistanceRounded(region, pad.rounded, index, haloMm),
    inside,
    // Reported, never compared, so it is queried UNHALOED (08 §5).
    penetrationMm: inside
      ? 0
      : roundedPenetration(region, pad.rounded, GEOM_EPS_MM, index),
  };
}

function holeMeasure(
  region: BoardRegion,
  index: RegionIndex | undefined,
  hole: DrcHole,
  haloMm: number,
): EdgeMeasure {
  return hole.slot
    ? stadiumMeasure(
        region,
        index,
        [hole.slot.a, hole.slot.b],
        hole.slot.widthMm / 2,
        haloMm,
      )
    : discMeasure(region, index, hole.center, hole.drillMm / 2, haloMm);
}

/** A trace's copper as convex cores ⊕ a disc — one per sub-segment (12 §1.1). */
function traceShapes(t: DrcTrace): RoundedShape[] {
  const pts = t.pointsMm;
  if (pts.length === 1) return [{ core: [pts[0]!], radiusMm: t.halfWidthMm }];
  const out: RoundedShape[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    out.push({ core: [pts[i - 1]!, pts[i]!], radiusMm: t.halfWidthMm });
  }
  return out;
}

function holeShape(hole: DrcHole): RoundedShape {
  return hole.slot
    ? { core: [hole.slot.a, hole.slot.b], radiusMm: hole.slot.widthMm / 2 }
    : { core: [hole.center], radiusMm: hole.drillMm / 2 };
}

interface ExactEdgeState {
  /** Items that exhausted their OWN budget and kept the chord verdict. */
  fallbacks: number;
}

interface EdgeVerdict {
  inside: boolean;
  /** What the rule compares and the message prints. */
  gapMm: number;
  /** The SIGNED report value (06 §6). */
  measuredMm: number;
  /** Appended to a draft's message when the exact layer could not certify. */
  note: string;
}

interface ExactEdgeResult {
  inside: boolean;
  marginMm: number;
  certain: boolean;
}

/** The exact margin of an item: the worst of its shapes (12 §4). */
function exactEdge(
  region: BoardRegion,
  shapes: readonly RoundedShape[],
  haloMm: number,
  budget: ExactBudget,
): ExactEdgeResult {
  let inside = true;
  let gapMm = Infinity;
  let penetrationMm = 0;
  let certain = true;
  for (const shape of shapes) {
    const m = exactSignedMargin(region.exact, shape, haloMm, { budget });
    if (!m.certain) certain = false;
    if (m.inside) {
      if (m.marginMm < gapMm) gapMm = m.marginMm;
      continue;
    }
    inside = false;
    if (-m.marginMm > penetrationMm) penetrationMm = -m.marginMm;
  }
  return { inside, marginMm: inside ? gapMm : -penetrationMm, certain };
}

/**
 * The chord bound a FALLBACK ring carries on BOTH sides (12 §4) — over the UNION
 * of the two builds' fallbacks.
 *
 * A ring can fall back on ONE side only: the inner build's biased flattening may
 * stay simple where the outer build's does not (Astra run 2 #C, a 500 mm board
 * with a 0.0015 mm-thin semicircular slot). That side then loses its inclusion
 * guarantee — its ring is neither a subset nor a superset of the truth — so the
 * interval must widen on it, or the non-enclosing outer ring certifies a FAIL
 * the exact contour passes.
 */
function fallbackBoundMm(region: BoardRegion): number {
  let worst = 0;
  const consider = (r: BoardRegion): void => {
    for (const ring of r.fallbacks) {
      const b = r.boundMm[ring] ?? 0;
      if (b > worst) worst = b;
    }
  };
  consider(region);
  consider(region.outerBias.region);
  return worst;
}

/** The item's own extent — the radius term of the exact query's halo (§4). */
function shapeExtentMm(shapes: readonly RoundedShape[]): number {
  let worst = 0;
  for (const s of shapes) if (s.radiusMm > worst) worst = s.radiusMm;
  return worst;
}

/**
 * §4 — the CERTIFIED INTERVAL. `inner` is today's measurement on the legality
 * region `R_inner ⊆ R_true`; `outer` is the SAME functional on the mirror
 * superset `R_true ⊆ R_outer`, so the true margin is bracketed by the two.
 *
 *  - certified PASS — inside the inner region and the rule passes on the
 *    pessimistic margin;
 *  - certified FAIL — outside the outer region, or the rule fails on the
 *    optimistic one;
 *  - AMBIGUOUS — containment differs or is unknown, or the two ends disagree
 *    about the rule's VERDICT (not merely "the threshold lies in the interval",
 *    Astra run 1 #13).
 *
 * A certified verdict is reported with today's floats, byte for byte. Only an
 * ambiguous one is recomputed exactly, and then the exact verdict AND measure
 * replace the chord ones.
 */
function certifyEdge(
  region: BoardRegion,
  inner: EdgeMeasure,
  outer: EdgeMeasure,
  shapes: readonly RoundedShape[],
  requiredMm: number,
  fails: EdgeRegime,
  state: ExactEdgeState,
): EdgeVerdict {
  const today: EdgeVerdict = {
    inside: inner.inside,
    gapMm: inner.gapMm,
    measuredMm: signed(inner.gapMm, inner.inside, inner.penetrationMm),
    note: "",
  };
  const fb = fallbackBoundMm(region);
  // A fallback ring is the SAME unbiased ring in both regions, so the two ends
  // cannot bracket it; its own chord bound applies symmetrically, and
  // containment within that bound of its boundary is UNKNOWN — an item in a
  // convex arc's omitted chord segment reads outside both (Astra run 1 #13).
  const unknown = fb > 0 && Math.abs(inner.gapMm) <= fb;
  const insideLo = unknown ? false : inner.inside;
  const insideHi = unknown ? true : outer.inside;
  const containmentCertain = insideLo || !insideHi;
  const regimeCertain =
    (insideLo && !fails(inner.gapMm - fb, requiredMm)) ||
    !insideHi ||
    fails(outer.gapMm + fb, requiredMm);
  if (containmentCertain && regimeCertain) return today;
  const budget: ExactBudget = { comparisons: BOARD_EXACT_ITEM_BUDGET };
  try {
    const exactHaloMm =
      shapeExtentMm(shapes) + requiredMm + region.maxBoundMm;
    if (!Number.isFinite(exactHaloMm)) {
      throw new Error(
        `[drc/board] exact halo is not finite (BoardRegion.maxBoundMm=${region.maxBoundMm}) — see edgeHaloMm`,
      );
    }
    const exact = exactEdge(region, shapes, exactHaloMm, budget);
    // A `{ kind: "chords" }` ring (an ellipse) is never exact: it contributes
    // its bound on both sides, so a verdict that depends on it keeps the
    // inner-region answer and says so (12 §4).
    if (!exact.certain) return { ...today, note: CHORD_BOUND_NOTE };
    return {
      inside: exact.inside,
      gapMm: exact.marginMm,
      measuredMm: signed(
        exact.marginMm,
        exact.inside,
        exact.inside ? 0 : -exact.marginMm,
      ),
      note: "",
    };
  } catch (error) {
    if (!(error instanceof ExactBudgetExceeded)) throw error;
    state.fallbacks += 1;
    return today;
  }
}

/**
 * The ONE per-run note an exhausted exact budget owes (12 §4). The COUNT is a
 * function of the items alone — each has its own allowance — so the note does
 * not depend on the order they were enumerated in.
 */
function exactBudgetNote(state: ExactEdgeState): DrcViolationDraft[] {
  if (state.fallbacks === 0) return [];
  return [
    {
      code: "OUTLINE_WEB_UNCHECKED",
      message: `Board-edge verdicts not fully certified: ${state.fallbacks} item${state.fallbacks === 1 ? "" : "s"} exhausted the ${BOARD_EXACT_ITEM_BUDGET}-comparison exact-geometry budget and kept the chord verdict`,
      anchors: [{ kind: "boardEdge" }],
    },
  ];
}

/**
 * Board-relative checks: copper-to-board-edge clearance, copper outside the
 * outline, and hole-to-hole spacing. All distances are to the board outline +
 * cutout perimeters (NOT filled containment), so copper inside the board still
 * has a positive edge clearance.
 *
 * `COPPER_TO_BOARD_EDGE.measuredMm` is SIGNED (contract 06 §6): the perimeter
 * distance alone cannot tell "0.2 mm short of the rule" from "0.2 mm past the
 * edge", and the same number meant both. It is negative exactly when the item
 * is not inside the region — the containment verdict `COPPER_OFF_BOARD`
 * already computes, so the two can never disagree. The COMPARISON is unchanged:
 * it still runs on the unsigned perimeter gap.
 *
 * A circular pad is measured as its exact `disc` where it has one; the sampled
 * `ring` circumscribes the circle (a ~0.2 %·r false-fail band), which on the
 * board edge is a hard error nobody can waive (contract 06 §2).
 */
export function boardItems(
  ctx: LegalityContext,
  items: ItemSet & { holes: readonly DrcHole[] },
  opts: { out: DrcViolationDraft[] },
): void {
  // Mode `"exhaustive"` keeps the pre-S9 per-ring helpers and the unindexed
  // predicates as the oracle (08 §3); the boundary-edge index is the default.
  // Both read the same float: every distance here is a `min` over the region's
  // edges by ONE primitive in ONE argument order, and a float `min` does not
  // care whether the edges were grouped by ring (§1 L2).
  if (ctx.broadPhase === "exhaustive") boardItemsExhaustive(ctx, items, opts);
  else boardItemsIndexed(ctx, items, opts);
}

/**
 * The pre-S9 body (08 §3) — the oracle. Its ENUMERATION and its inner-region
 * primitives are the pre-S9 ones, verbatim; the §4 interval machinery it shares
 * with the indexed body below, so the two cannot disagree about which verdicts
 * are certified.
 */
function boardItemsExhaustive(
  ctx: LegalityContext,
  items: ItemSet & { holes: readonly DrcHole[] },
  opts: { out: DrcViolationDraft[] },
): void {
  const out = opts.out;
  const region = ctx.boardRegion;
  // Edge clearance measures against the BIASED region rings too: on an arc the
  // unbiased chords sit up to 0.01 mm on the wrong side, and a hole's inscribed
  // chords over-measured copper-to-cutout clearance (B4-6 — Astra §9.2 showed a
  // true 0.4949999 mm gap passing a 0.5 mm rule on the unbiased rings).
  const rings = [region.outer, ...region.holes];
  const halo = (extentMm: number): number =>
    edgeHaloMm(ctx, region, extentMm);
  const state: ExactEdgeState = { fallbacks: 0 };

  const edgeDistToBoundary = (
    compute: (ring: readonly { x: number; y: number }[]) => number,
  ): number => {
    // One boundary-distance site (08 §7) — the counter is written, never read.
    if (ctx.stats) ctx.stats.edgeTests += 1;
    let best = Infinity;
    for (const ring of rings) {
      const d = compute(ring);
      if (d < best) best = d;
    }
    return best;
  };

  for (const t of items.traces) {
    if (t.pointsMm.length === 0) continue;
    // A single-point trace is a disc of copper, not a free pass: measure and
    // contain it as one (Astra §9.2 #4 — it used to skip both checks).
    const single = t.pointsMm.length === 1 ? t.pointsMm[0]! : null;
    const gap =
      edgeDistToBoundary((ring) =>
        single
          ? pointToRingEdgeDistance(single, ring)
          : polylineToRingEdgeDistance(t.pointsMm, ring),
      ) - t.halfWidthMm;
    const inside = stadiumInsideRegion(region, t.pointsMm, t.halfWidthMm);
    const traceEdge = ctx.resolver.scalar("edgeClearance", {
      netId: t.netId,
      layers: [t.layer],
      geometry: {
        kind: "polyline",
        pointsMm: t.pointsMm,
        halfWidthMm: t.halfWidthMm,
      },
    });
    const v = certifyEdge(
      region,
      { gapMm: gap, inside, penetrationMm: 0 },
      stadiumMeasure(
        region.outerBias.region,
        region.outerBias.index,
        t.pointsMm,
        t.halfWidthMm,
        halo(t.halfWidthMm),
      ),
      traceShapes(t),
      traceEdge.mm,
      clearanceViolated,
      state,
    );
    if (clearanceViolated(v.gapMm, traceEdge.mm)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ...(traceEdge.rule?.severity
          ? { ruleSeverity: traceEdge.rule.severity }
          : {}),
        message: `Trace is ${v.gapMm.toFixed(3)} mm from the board edge (min ${traceEdge.mm.toFixed(3)} mm)${ruleSuffix(traceEdge)}${v.note}`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
        measuredMm: v.measuredMm,
        requiredMm: traceEdge.mm,
      });
    }
    if (!v.inside) {
      out.push({
        code: "COPPER_OFF_BOARD",
        message: `Trace extends outside the board outline${v.note}`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
      });
    }
  }

  for (const vg of items.vias) {
    const gap =
      edgeDistToBoundary((ring) => pointToRingEdgeDistance(vg.center, ring)) -
      vg.radiusMm;
    // Off-board if the via disc (center + radius) is not fully inside the
    // biased region — replaces the old center-only test plus `gap < 0`.
    const inside = discInsideRegion(region, vg.center, vg.radiusMm);
    const viaEdge = ctx.resolver.scalar("edgeClearance", {
      netId: vg.netId,
      layers: vg.layers,
      geometry: { kind: "disc", center: vg.center, radiusMm: vg.radiusMm },
    });
    const v = certifyEdge(
      region,
      { gapMm: gap, inside, penetrationMm: 0 },
      discMeasure(
        region.outerBias.region,
        region.outerBias.index,
        vg.center,
        vg.radiusMm,
        halo(vg.radiusMm),
      ),
      [{ core: [vg.center], radiusMm: vg.radiusMm }],
      viaEdge.mm,
      clearanceViolated,
      state,
    );
    if (clearanceViolated(v.gapMm, viaEdge.mm)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ...(viaEdge.rule?.severity ? { ruleSeverity: viaEdge.rule.severity } : {}),
        message: `Via is ${v.gapMm.toFixed(3)} mm from the board edge (min ${viaEdge.mm.toFixed(3)} mm)${ruleSuffix(viaEdge)}${v.note}`,
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
        measuredMm: v.measuredMm,
        requiredMm: viaEdge.mm,
      });
    }
    if (!v.inside) {
      out.push({
        code: "COPPER_OFF_BOARD",
        message: `Via is outside the board outline${v.note}`,
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
      });
    }
  }

  for (const pad of items.pads) {
    // The exact disc when the pad is a true circle; the ROUNDED shape (12 §1.2)
    // otherwise — the per-ring fold has no rounded analogue, and for a rect pad
    // the core IS `pad.ring` with radius 0, so the float is the fold's.
    const inner = padMeasure(region, undefined, pad, Infinity);
    if (ctx.stats) ctx.stats.edgeTests += 1;
    const padEdge = ctx.resolver.scalar("edgeClearance", {
      netId: pad.netId,
      layers: pad.layers,
      geometry: { kind: "ring", ring: pad.ring },
    });
    const v = certifyEdge(
      region,
      inner,
      padMeasure(region.outerBias.region, region.outerBias.index, pad, halo(pad.rounded.radiusMm)),
      [pad.rounded],
      padEdge.mm,
      clearanceViolated,
      state,
    );
    if (clearanceViolated(v.gapMm, padEdge.mm)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ...(padEdge.rule?.severity ? { ruleSeverity: padEdge.rule.severity } : {}),
        message: `Pad is ${v.gapMm.toFixed(3)} mm from the board edge (min ${padEdge.mm.toFixed(3)} mm)${ruleSuffix(padEdge)}${v.note}`,
        anchors: [pad.anchor],
        locationMm: pad.center,
        measuredMm: v.measuredMm,
        requiredMm: padEdge.mm,
      });
    }
    // Off-board unless the whole pad is inside the biased region — replaces the
    // vertex-only outline test and the separate cutout-covers-pad vertex test
    // (both folded into the rounded / disc containment).
    if (!v.inside) {
      out.push({
        code: "COPPER_OFF_BOARD",
        message: `Pad is outside the board outline${v.note}`,
        anchors: [pad.anchor],
        locationMm: pad.center,
      });
    }
  }

  // Hole-to-board-edge (audit B4-4): a drilled hole whose edge encroaches on
  // (or crosses) the board outline is a fab reject. Slot-aware — the slot
  // centerline is used when present so the rounded ends are measured, not a
  // round-hole model. Rings = outline + cutouts (a hole must clear cutouts too).
  const holeEdgeReq = ctx.holeToBoardEdgeMm;
  for (const hole of items.holes) {
    const radius = hole.slot ? hole.slot.widthMm / 2 : hole.drillMm / 2;
    const edgeDist = edgeDistToBoundary((ring) =>
      hole.slot
        ? polylineToRingEdgeDistance([hole.slot.a, hole.slot.b], ring)
        : pointToRingEdgeDistance(hole.center, ring),
    );
    const gap = edgeDist - radius;
    // Error when the drill (disc, or slot stadium) is not inside the biased
    // region; warning when inside and merely below the clearance rule.
    const inside = hole.slot
      ? stadiumInsideRegion(region, [hole.slot.a, hole.slot.b], hole.slot.widthMm / 2)
      : discInsideRegion(region, hole.center, hole.drillMm / 2);
    const v = certifyEdge(
      region,
      { gapMm: gap, inside, penetrationMm: 0 },
      holeMeasure(region.outerBias.region, region.outerBias.index, hole, halo(radius)),
      [holeShape(hole)],
      holeEdgeReq,
      below,
      state,
    );
    if (!v.inside) {
      out.push({
        // A drill that is not inside the board region at all is its own code
        // (contract §7) — the former dual-severity HOLE_TO_BOARD_EDGE hid an
        // error and a near-miss warning behind one id.
        code: "HOLE_OFF_BOARD",
        message: `Hole breaches the board edge (${v.gapMm.toFixed(3)} mm)${v.note}`,
        anchors: [hole.anchor],
        locationMm: hole.center,
        measuredMm: v.gapMm,
        requiredMm: holeEdgeReq,
      });
    } else if (below(v.gapMm, holeEdgeReq)) {
      out.push({
        code: "HOLE_TO_BOARD_EDGE",
        message: `Hole is ${v.gapMm.toFixed(3)} mm from the board edge (min ${holeEdgeReq.toFixed(3)} mm)${v.note}`,
        anchors: [hole.anchor],
        locationMm: hole.center,
        measuredMm: v.gapMm,
        requiredMm: holeEdgeReq,
      });
    }
  }
  for (const draft of exactBudgetNote(state)) out.push(draft);
}

/**
 * The same sites in the same order, through the boundary-edge index (08 §4).
 *
 * The per-ring `edgeDistToBoundary` fold is gone: `regionBoundaryDistance*`
 * already takes the min over EVERY ring's edges with the same primitive in the
 * same argument order, so the float is the exhaustive one (§1 L2).
 *
 * Each site is queried with the halo of §5 PLUS the region's chord bound
 * (12 §4): `edgeHalo + r + maxBoundMm`. Without the bound term the index can
 * return no edge at all for a boundary the certified interval depends on, and
 * this body would certify a PASS the exhaustive body calls ambiguous (Astra
 * run 1 #2). Above the halo the distance comes back `Infinity`; that is a value
 * no comparison at or below the halo can tell from the true min, and the sites
 * that REPORT a distance instead of comparing it (a hole that is not inside the
 * region, an outside pad vertex's penetration) are queried UNHALOED.
 */
function boardItemsIndexed(
  ctx: LegalityContext,
  items: ItemSet & { holes: readonly DrcHole[] },
  opts: { out: DrcViolationDraft[] },
): void {
  const out = opts.out;
  const region = ctx.boardRegion;
  const index = ctx.regionIndex;
  const stats = ctx.stats;
  const halo = (extentMm: number): number =>
    edgeHaloMm(ctx, region, extentMm);
  const state: ExactEdgeState = { fallbacks: 0 };

  for (const t of items.traces) {
    if (t.pointsMm.length === 0) continue;
    // A single-point trace is a disc of copper, not a free pass: measure and
    // contain it as one (Astra §9.2 #4 — it used to skip both checks).
    if (stats) stats.edgeTests += 1;
    const inner = stadiumMeasure(
      region,
      index,
      t.pointsMm,
      t.halfWidthMm,
      halo(t.halfWidthMm),
    );
    const traceEdge = ctx.resolver.scalar("edgeClearance", {
      netId: t.netId,
      layers: [t.layer],
      geometry: {
        kind: "polyline",
        pointsMm: t.pointsMm,
        halfWidthMm: t.halfWidthMm,
      },
    });
    const v = certifyEdge(
      region,
      inner,
      stadiumMeasure(
        region.outerBias.region,
        region.outerBias.index,
        t.pointsMm,
        t.halfWidthMm,
        halo(t.halfWidthMm),
      ),
      traceShapes(t),
      traceEdge.mm,
      clearanceViolated,
      state,
    );
    if (clearanceViolated(v.gapMm, traceEdge.mm)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ...(traceEdge.rule?.severity
          ? { ruleSeverity: traceEdge.rule.severity }
          : {}),
        message: `Trace is ${v.gapMm.toFixed(3)} mm from the board edge (min ${traceEdge.mm.toFixed(3)} mm)${ruleSuffix(traceEdge)}${v.note}`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
        measuredMm: v.measuredMm,
        requiredMm: traceEdge.mm,
      });
    }
    if (!v.inside) {
      out.push({
        code: "COPPER_OFF_BOARD",
        message: `Trace extends outside the board outline${v.note}`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
      });
    }
  }

  for (const vg of items.vias) {
    if (stats) stats.edgeTests += 1;
    const inner = discMeasure(
      region,
      index,
      vg.center,
      vg.radiusMm,
      halo(vg.radiusMm),
    );
    const viaEdge = ctx.resolver.scalar("edgeClearance", {
      netId: vg.netId,
      layers: vg.layers,
      geometry: { kind: "disc", center: vg.center, radiusMm: vg.radiusMm },
    });
    const v = certifyEdge(
      region,
      inner,
      discMeasure(
        region.outerBias.region,
        region.outerBias.index,
        vg.center,
        vg.radiusMm,
        halo(vg.radiusMm),
      ),
      [{ core: [vg.center], radiusMm: vg.radiusMm }],
      viaEdge.mm,
      clearanceViolated,
      state,
    );
    if (clearanceViolated(v.gapMm, viaEdge.mm)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ...(viaEdge.rule?.severity ? { ruleSeverity: viaEdge.rule.severity } : {}),
        message: `Via is ${v.gapMm.toFixed(3)} mm from the board edge (min ${viaEdge.mm.toFixed(3)} mm)${ruleSuffix(viaEdge)}${v.note}`,
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
        measuredMm: v.measuredMm,
        requiredMm: viaEdge.mm,
      });
    }
    if (!v.inside) {
      out.push({
        code: "COPPER_OFF_BOARD",
        message: `Via is outside the board outline${v.note}`,
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
      });
    }
  }

  for (const pad of items.pads) {
    if (stats) stats.edgeTests += 1;
    // A ring pad's gap is edge-to-edge already, so it needs no extent added to
    // the halo; a disc or rounded pad's gap subtracts its radius, so its halo
    // carries it. `halo()` adds the widest of them either way.
    const inner = padMeasure(region, index, pad, halo(pad.rounded.radiusMm));
    const padEdge = ctx.resolver.scalar("edgeClearance", {
      netId: pad.netId,
      layers: pad.layers,
      geometry: { kind: "ring", ring: pad.ring },
    });
    const v = certifyEdge(
      region,
      inner,
      padMeasure(region.outerBias.region, region.outerBias.index, pad, halo(pad.rounded.radiusMm)),
      [pad.rounded],
      padEdge.mm,
      clearanceViolated,
      state,
    );
    if (clearanceViolated(v.gapMm, padEdge.mm)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ...(padEdge.rule?.severity ? { ruleSeverity: padEdge.rule.severity } : {}),
        message: `Pad is ${v.gapMm.toFixed(3)} mm from the board edge (min ${padEdge.mm.toFixed(3)} mm)${ruleSuffix(padEdge)}${v.note}`,
        anchors: [pad.anchor],
        locationMm: pad.center,
        measuredMm: v.measuredMm,
        requiredMm: padEdge.mm,
      });
    }
    if (!v.inside) {
      out.push({
        code: "COPPER_OFF_BOARD",
        message: `Pad is outside the board outline${v.note}`,
        anchors: [pad.anchor],
        locationMm: pad.center,
      });
    }
  }

  const holeEdgeReq = ctx.holeToBoardEdgeMm;
  for (const hole of items.holes) {
    const radius = hole.slot ? hole.slot.widthMm / 2 : hole.drillMm / 2;
    // Containment decides which halo the distance may be taken with, so it is
    // resolved FIRST here: an off-board hole REPORTS its gap (§5), so that gap
    // has to be the full min, while an inside hole only ever compares it.
    const contained = hole.slot
      ? stadiumInsideRegion(
          region,
          [hole.slot.a, hole.slot.b],
          hole.slot.widthMm / 2,
          GEOM_EPS_MM,
          index,
        )
      : discInsideRegion(
          region,
          hole.center,
          hole.drillMm / 2,
          GEOM_EPS_MM,
          index,
        );
    if (stats) stats.edgeTests += 1;
    const edgeDist = hole.slot
      ? regionBoundaryDistancePolyline(
          region,
          [hole.slot.a, hole.slot.b],
          index,
          contained ? halo(radius) : undefined,
        )
      : regionBoundaryDistancePoint(
          region,
          hole.center,
          index,
          contained ? halo(radius) : undefined,
        );
    const inner: EdgeMeasure = {
      gapMm: edgeDist - radius,
      inside: contained,
      penetrationMm: 0,
    };
    const v = certifyEdge(
      region,
      inner,
      holeMeasure(region.outerBias.region, region.outerBias.index, hole, halo(radius)),
      [holeShape(hole)],
      holeEdgeReq,
      below,
      state,
    );
    if (!v.inside) {
      out.push({
        code: "HOLE_OFF_BOARD",
        message: `Hole breaches the board edge (${v.gapMm.toFixed(3)} mm)${v.note}`,
        anchors: [hole.anchor],
        locationMm: hole.center,
        measuredMm: v.gapMm,
        requiredMm: holeEdgeReq,
      });
    } else if (below(v.gapMm, holeEdgeReq)) {
      out.push({
        code: "HOLE_TO_BOARD_EDGE",
        message: `Hole is ${v.gapMm.toFixed(3)} mm from the board edge (min ${holeEdgeReq.toFixed(3)} mm)${v.note}`,
        anchors: [hole.anchor],
        locationMm: hole.center,
        measuredMm: v.gapMm,
        requiredMm: holeEdgeReq,
      });
    }
  }
  for (const draft of exactBudgetNote(state)) out.push(draft);
}

/**
 * Hole ↔ hole spacing (mechanical; skip holes of the same footprint) plus the
 * fab tier, for one subject set against one other set (07 §3). Coincident
 * drills (centers within ~1 µm) on the SAME net are a via dropped onto a
 * through-hole pad — a legitimate stack, not a spacing breach. `replaces`
 * filters the OTHER (board) side only.
 */
export function holePairs(
  ctx: LegalityContext,
  subjects: readonly DrcHole[],
  others: readonly DrcHole[],
  opts: { replaces?: ReadonlySet<string>; out: DrcViolationDraft[] },
): void {
  const out = opts.out;
  // A drilled hole passes through the whole stackup, so every valid copper
  // layer is "a layer the item occupies" for a `layer` scope (§4.2).
  const allLayers = [...ctx.validCopperLayers];
  const COINCIDENT_EPS_MM = 1e-3;
  const fabPreset =
    ctx.fabricator === "custom" ? null : (FAB_PRESETS[ctx.fabricator] ?? null);
  // Hoisted: the key of an item is a per-item fact, not a per-pair one, and the
  // board's are precomputed on the context (R1 #2).
  const subjectKeys =
    subjects === ctx.holes ? ctx.holeKeys : subjects.map((h) => anchorKey(h.anchor));
  const otherKeys =
    others === subjects
      ? subjectKeys
      : others === ctx.holes
        ? ctx.holeKeys
        : others.map((h) => anchorKey(h.anchor));
  const self = subjects === others;
  // The grid pays off only for a small subject set against the board's holes;
  // the batch pass (board × board) keeps its full O(n²) loop, which S9 owns.
  const gridded = others === ctx.holes && !self && subjects !== ctx.holes;

  const judgePair = (i: number, j: number): void => {
    if (
      opts.replaces &&
      others[j]!.anchor.kind === "via" &&
      opts.replaces.has((others[j]!.anchor as { viaId: string }).viaId)
    ) {
      return;
    }
    // Canonical orientation (contract 06 §7): the hole with the smaller
    // anchor key leads, so the emitted anchor order — and with it the report
    // bytes — cannot follow `ctx.holes` order (R1 #1).
    const keyI = subjectKeys[i]!;
    const keyJ = otherKeys[j]!;
    const a = keyI < keyJ ? subjects[i]! : others[j]!;
    const b = keyI < keyJ ? others[j]! : subjects[i]!;
    const centerGap = distance(a.center, b.center);
    // Two drills under ONE pad number (a multi-shape pin) are one item only
    // when they are the same physical drill (coincident); two DISTINCT drill
    // hits of one pin still ship in the Excellon file and must still be
    // judged for overlap (R1 #2, Astra S7 #3).
    if (keyI === keyJ && centerGap <= COINCIDENT_EPS_MM) return;
    const drillsOverlap = centerGap < a.drillMm / 2 + b.drillMm / 2;
    // Intra-footprint pad SPACING is the footprint's responsibility — but
    // only when the drills don't physically overlap. Overlapping drills in
    // one footprint are still a broken drill file (audit B4-3).
    if (
      a.anchor.kind === "pad" &&
      b.anchor.kind === "pad" &&
      a.anchor.placementId === b.anchor.placementId &&
      !drillsOverlap
    ) {
      return;
    }
    if (
      centerGap <= COINCIDENT_EPS_MM &&
      a.netId !== null &&
      a.netId === b.netId
    ) {
      return;
    }
    // Slot-aware edge gap: a slotted drill uses its centerline (segment)
    // instead of the round center, so overlapping slot ends between distant
    // centers are still caught (Codex review; audit B2-5 follow-through).
    const gap = holeEdgeGap(a, b, centerGap);
    // `net` / `netClass` match if EITHER hole qualifies, `area` needs BOTH
    // (contract §5.1); the scope geometry is the drill, not the copper.
    const holeReq = ctx.resolver.scalarPair(
      "holeToHole",
      { netId: a.netId, layers: allLayers, geometry: holeGeometry(a) },
      { netId: b.netId, layers: allLayers, geometry: holeGeometry(b) },
    );
    if (below(gap, holeReq.mm)) {
      out.push({
        code: "HOLE_TO_HOLE",
        ...(holeReq.rule?.severity
          ? { ruleSeverity: holeReq.rule.severity }
          : {}),
        message: `Holes are ${gap.toFixed(3)} mm apart (min ${holeReq.mm.toFixed(3)} mm)${ruleSuffix(holeReq)}`,
        anchors: [a.anchor, b.anchor],
        locationMm: {
          x: (a.center.x + b.center.x) / 2,
          y: (a.center.y + b.center.y) / 2,
        },
        measuredMm: gap,
        requiredMm: holeReq.mm,
      });
    } else if (fabPreset) {
      // Fab capability tier (P8): JLCPCB publishes distinct hole-to-hole
      // floors for via-via vs anything involving a component (PTH/NPTH)
      // drill. Only surfaces when the board rule above did not already fire.
      const fabReq =
        a.kind === "via" && b.kind === "via"
          ? fabPreset.holeToHoleViaMm
          : fabPreset.holeToHolePthMm;
      if (below(gap, fabReq)) {
        out.push({
          code: "FAB_HOLE_TO_HOLE",
          message: `Holes are ${gap.toFixed(3)} mm apart (${fabPreset.name} min ${fabReq.toFixed(3)} mm)`,
          anchors: [a.anchor, b.anchor],
          locationMm: {
            x: (a.center.x + b.center.x) / 2,
            y: (a.center.y + b.center.y) / 2,
          },
          measuredMm: gap,
          requiredMm: fabReq,
        });
      }
    }
  };

  // The board's own O(H²) self pass is the one S9 indexes (08 §4); a pending
  // subject set against the board's holes was already gridded before S9, so
  // `"exhaustive"` restores only the pre-S9 double loop below (§3).
  const selfGridded =
    self && subjects === ctx.holes && ctx.broadPhase !== "exhaustive";

  for (let i = 0; i < subjects.length; i += 1) {
    if (gridded || selfGridded) {
      for (const j of ctx.near(
        "holes",
        holeBounds(subjects[i]!),
        ctx.maxHoleBoundMm,
      )) {
        // `j > i` is what `j = i + 1` gave the self loop: the grid is symmetric
        // and would otherwise offer the same unordered pair from both sides.
        if (selfGridded && j <= i) continue;
        judgePair(i, j);
      }
      continue;
    }
    for (let j = self ? i + 1 : 0; j < others.length; j += 1) judgePair(i, j);
  }
}

/**
 * Board-relative checks over the whole board: the per-item edge / off-board
 * tiers, then hole ↔ hole spacing.
 */
export function checkBoard(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  boardItems(ctx, ctx, { out });
  holePairs(ctx, ctx.holes, ctx.holes, { out });
  return out;
}
