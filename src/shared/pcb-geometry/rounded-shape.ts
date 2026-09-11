/**
 * The exact copper-silhouette kernel (exact-geometry contract 12 §1). Every
 * copper primitive OpenPCB has is the Minkowski sum of a CONVEX core with a
 * disc — a circle pad is a point, an oval pad or a trace sub-segment a spine, a
 * roundrect pad its four inner corners, a rect / trapezoid / custom pad its ring
 * with radius 0 — and for two such filled sets
 *
 *     d(K_A ⊕ B_rA, K_B ⊕ B_rB) = max(0, d(K_A, K_B) − rA − rB)
 *
 * so the gap is EXACT under rotation and reflection where the circumscribed
 * chord ring is only an upper bound on the copper (sec(π/48) ≈ 0.21 % of an
 * oval's cap radius, sec(π/24) ≈ 0.86 % of a roundrect's corner radius).
 *
 * Two properties the callers depend on:
 *
 * - **Radii are summed FIRST.** `(0.2 − 0.05) − 0.05` is `0.10000000000000002`
 *   while `0.2 − (0.05 + 0.05)` is `0.1`; grouping them as the pad / via disc
 *   arithmetic always has keeps a pair of true circles byte-identical to S12
 *   (§1.2, Astra run 1 #16).
 * - **Arity dispatch, not one polygon primitive.** `polygonToPolygonDistance`
 *   returns `Infinity` for a ring of fewer than two points, so a one-point core
 *   MUST take the point primitive or a circle pad half inside a keepout passes
 *   every arm (§1.2, Astra run 1 #1). When both radii are 0 the dispatch lands
 *   on exactly the primitive the pair kernels called before, on the same ring,
 *   so every `rect` / `trapezoid` / `custom` verdict is unchanged.
 */
import type { PcbPointMm } from "../../sdks/designer";
import { ringsOverlapPositiveArea } from "./area-overlap";
import {
  pointInPolygon,
  pointToPolygonDistance,
  polygonToPolygonDistance,
  polylineToPolygonDistance,
  segmentToPolygonDistance,
  segmentToRingClosestPoints,
} from "./pcb-clearance-geometry";
import {
  distance,
  pointToPolylineDistance,
  projectPointToSegment,
  segmentToSegmentDistance,
} from "./pcb-trace-geometry";
import type { RoundedShape } from "./rounded-shape-types";
import { CONNECT_EPS_MM, GEOM_EPS_MM } from "./tolerance";

/**
 * The longest core §1.1 builds from a radius: a roundrect's four corners, or
 * the four-vertex bounding rect a `rect` / `trapezoid` / `custom` pad carries
 * as its ring. Longer operands are RINGS — the second operand of
 * {@link roundedOverlapsRing}, or the `radiusMm = 0` fallback a pad with an
 * unusable dimension keeps — and they must reach the primitives verbatim: a
 * collapse there would both cost an O(n²) scan per pair and move the bytes of
 * the ring path it exists to reproduce.
 */
const MAX_CORE_POINTS = 4;

/** A disc of copper: a via, a drilled hole, a trace end cap. */
export function roundedPoint(
  center: PcbPointMm,
  radiusMm: number,
): RoundedShape {
  return { core: [center], radiusMm };
}

/** A stadium of copper: one trace sub-segment, or a routed slot. */
export function roundedSegment(
  a: PcbPointMm,
  b: PcbPointMm,
  radiusMm: number,
): RoundedShape {
  return { core: [a, b], radiusMm };
}

/**
 * Coincident core points collapse to the LOWER arity before dispatch (§1.1): a
 * `w === h` oval spine and a full-radius roundrect corner pair are legal cores
 * whose points coincide, and they must read as one point, never as a
 * zero-length edge that a polygon primitive would walk.
 */
function collapseCore(
  core: readonly PcbPointMm[],
): readonly PcbPointMm[] {
  if (core.length < 2 || core.length > MAX_CORE_POINTS) return core;
  const out: PcbPointMm[] = [];
  for (const p of core) {
    if (!out.some((q) => q.x === p.x && q.y === p.y)) out.push(p);
  }
  return out.length === core.length ? core : out;
}

/**
 * Exact Euclidean distance between two convex point sets of 1..n points, 0 when
 * they meet. Dispatched by arity: 1 = point, 2 = segment, 3+ = convex polygon.
 */
export function convexDistance(
  a: readonly PcbPointMm[],
  b: readonly PcbPointMm[],
): number {
  const A = collapseCore(a);
  const B = collapseCore(b);
  // No core is no copper: `Infinity` fails open exactly as every ring primitive
  // in `pcb-clearance-geometry.ts` does for a degenerate ring.
  if (A.length === 0 || B.length === 0) return Infinity;
  if (A.length === 1) {
    if (B.length === 1) return distance(A[0]!, B[0]!);
    if (B.length === 2) {
      return projectPointToSegment(A[0]!, B[0]!, B[1]!).distance;
    }
    return pointToPolygonDistance(A[0]!, B);
  }
  if (B.length === 1) {
    if (A.length === 2) {
      return projectPointToSegment(B[0]!, A[0]!, A[1]!).distance;
    }
    return pointToPolygonDistance(B[0]!, A);
  }
  if (A.length === 2) {
    if (B.length === 2) {
      return segmentToSegmentDistance(A[0]!, A[1]!, B[0]!, B[1]!);
    }
    return segmentToPolygonDistance(A[0]!, A[1]!, B);
  }
  if (B.length === 2) return segmentToPolygonDistance(B[0]!, B[1]!, A);
  return polygonToPolygonDistance(A, B);
}

/**
 * Edge-to-edge gap between two rounded shapes; negative on overlap. The
 * magnitude of a negative value is a LOWER BOUND on the penetration depth, not
 * the depth (two coincident `r = 0` squares return 0) — the short tier reads
 * only `gap <= SHORT_EPS_MM` and no consumer reports it as a measurement.
 */
export function roundedGap(a: RoundedShape, b: RoundedShape): number {
  return convexDistance(a.core, b.core) - (a.radiusMm + b.radiusMm);
}

/** Copper contact within `eps` (connectivity contract 01 §2). */
export function roundedTouch(
  a: RoundedShape,
  b: RoundedShape,
  eps: number = CONNECT_EPS_MM,
): boolean {
  return roundedGap(a, b) <= eps;
}

/**
 * Gap between a trace's whole centreline and a rounded shape. A polyline is not
 * convex, so it cannot be a `RoundedShape`; the distance is the minimum over
 * its sub-segments, which is what `pointToPolylineDistance` /
 * `polylineToPolygonDistance` already compute. Keeping those two primitives
 * (rather than folding the polyline through `convexDistance` segment by
 * segment) is what makes the `r = 0` result byte-identical to S12's ring path.
 */
export function roundedPolylineGap(
  points: readonly PcbPointMm[],
  halfWidthMm: number,
  shape: RoundedShape,
): number {
  const core = collapseCore(shape.core);
  const centreline =
    core.length === 1
      ? pointToPolylineDistance(core[0]!, points as PcbPointMm[]).distance
      : polylineToPolygonDistance(points, core);
  return centreline - (halfWidthMm + shape.radiusMm);
}

/**
 * Gap between ONE trace sub-segment and a rounded shape (rule semantics §4.4
 * splits a trace at every area crossing before judging it).
 *
 * The polygon arm is `segmentToRingClosestPoints`, not `convexDistance`'s
 * `segmentToPolygonDistance`: the two differ by up to `GEOM_EPS_MM` at an
 * inclusive contact (`segmentToSegmentDistance` short-circuits to 0 through
 * `segmentsIntersect`, the closest-points form falls through to the endpoint
 * projections), and this is the primitive every trace↔pad sub-segment gap has
 * been measured with. §1.2's byte identity for `rect` pads is stated on the
 * pair kernels, not on one shared polygon primitive.
 */
export function roundedSegmentGap(
  a: PcbPointMm,
  b: PcbPointMm,
  halfWidthMm: number,
  shape: RoundedShape,
): number {
  const core = collapseCore(shape.core);
  const centreline =
    core.length === 1
      ? projectPointToSegment(core[0]!, a, b).distance
      : segmentToRingClosestPoints(a, b, core).distance;
  return centreline - (halfWidthMm + shape.radiusMm);
}

/**
 * Does the rounded shape's OPEN interior meet the open interior of `ring`
 * (zone/keepout contract 03 §4: a keepout has clearance 0, so copper that only
 * grazes its boundary is legal)? Dimension-aware, because a point or segment
 * core has no 2-D interior of its own:
 *
 * 1. the core comes closer to the ring than the radius — the disc sweeps in;
 * 2. a core point is strictly inside — a small pad wholly inside the ring;
 * 3. a 3+-point core's own interior meets the ring's.
 */
export function roundedOverlapsRing(
  shape: RoundedShape,
  ring: readonly PcbPointMm[],
  eps: number = GEOM_EPS_MM,
): boolean {
  const core = collapseCore(shape.core);
  if (core.length === 0 || ring.length < 3) return false;
  if (convexDistance(core, ring) < shape.radiusMm - eps) return true;
  for (const p of core) {
    if (pointInPolygon(p, ring)) return true;
  }
  return core.length >= 3 && ringsOverlapPositiveArea(core, ring, eps);
}
