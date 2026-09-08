/**
 * OPEN-set overlap predicates — "does the open interior of this shape meet the
 * open interior of this ring?" (S3a zone/keepout contract §4). Pure, mm domain.
 *
 * These are the dual of the closed-set relations in `region-rings.ts` /
 * `board-region.ts` (S2 geometry contract §5). The board region asks "is this
 * copper INSIDE the board", and answers YES on the boundary, because copper
 * that ends exactly on the outline is manufacturable. A keepout asks "is this
 * copper INSIDE the forbidden area", and must answer NO on the boundary,
 * because a keepout has clearance 0: copper whose edge lies on the keepout
 * boundary is legal. Both rules are stated at the same `GEOM_EPS_MM`, so an
 * eps-thick band around every boundary belongs to NEITHER interior — a shape
 * that only grazes the ring is not overlapping, and a shape that penetrates it
 * by more than eps is.
 *
 * Why these three are complete for their object classes:
 *
 * - `ringsOverlapPositiveArea` — if two simple polygons have interiors that
 *   meet in positive area then either ∂A meets int(B), or ∂B meets int(A), or
 *   the two boundaries coincide. (int(B) is connected; if ∂A never enters it,
 *   int(B) is wholly inside or wholly outside int(A), so B ⊆ A, and then ∂B
 *   lies in int(A) ∪ ∂A — if it also never enters int(A) the boundaries are
 *   equal.) `holeInteriorMeetsRing` decides exactly "∂X meets int(Y), or the
 *   two share a collinear boundary piece whose interior sides agree", so
 *   running it in both directions covers every case, including containment
 *   either way and identical rings. Rings that only touch at a vertex, are
 *   tangent, or share an edge with their interiors on opposite sides are not
 *   overlapping.
 * - `stadiumOverlapsRing` — a stadium is the Minkowski sum of its centreline
 *   with a disc of radius `hw`. Its interior meets int(K) iff some centreline
 *   point is inside K, or the centreline comes closer than `hw` to ∂K. A
 *   centreline that enters K crosses ∂K, so distance 0; a centreline that stays
 *   outside and no closer than `hw` sweeps nothing into int(K). Sampling the
 *   VERTICES for the inside test is therefore enough whenever `hw > eps`: a
 *   centreline whose interior points are inside K but whose vertices are not
 *   has crossed ∂K and is caught by the distance clause.
 * - `discOverlapsRing` — the same argument with a single centreline point.
 *
 * Stated limits, all inside the eps band and far below anything
 * manufacturable. For `hw ≤ eps` (respectively `r ≤ eps`) the object has an
 * empty open interior — degenerate copper (S1: not copper) — and the answer is
 * always false, whatever the centreline does. The two distance clauses are not
 * the same kind of distance, which tilts the eps band in opposite directions:
 * `pointToRingEdgeDistance` is an exact projection distance, so
 * `discOverlapsRing` MISSES a centre that lies inside K but within eps of ∂K
 * when `eps < r ≤ 2·eps` (fail-open by at most eps, the S2 §5 allowance);
 * `polylineToRingEdgeDistance` is built on `segmentToSegmentDistance`, which
 * short-circuits to 0 through the inclusive `segmentsIntersect`, so a
 * centreline anywhere within eps of ∂K reads as distance 0 and
 * `stadiumOverlapsRing` reports an overlap for every `hw > eps` (fail-closed on
 * the eps band). Both verdicts sit inside the tolerance the contract allows —
 * neither is a licence to widen it, and the tests pin both.
 *
 * Rings are OPEN (the closing edge is implicit) and MUST already be
 * canonicalised by the caller (`canonicalizeRing`), exactly as
 * `ringSelfIntersects` and `ringsIntersect` require: a duplicated vertex is a
 * zero-length edge that every neighbour touches. Canonicalisation is the
 * caller's job so these stay pure predicates.
 */
import type { PcbPointMm } from "../../sdks";
import {
  pointToRingEdgeDistance,
  polylineToRingEdgeDistance,
} from "./pcb-clearance-geometry";
import {
  boundsMeet,
  boundsOfPoints,
  holeInteriorMeetsRing,
  strictlyInsideRing,
} from "./region-rings";
import { GEOM_EPS_MM } from "./tolerance";

/** Non-negative reach for the broad phase; a NaN or negative extent reaches 0. */
function reachOf(value: number): number {
  return value > 0 ? value : 0;
}

/**
 * Do the two rings' open interiors share positive area? Symmetric. Touching at
 * a vertex, tangency and a shared edge with opposing interiors are all false;
 * containment either way and identical rings are true. Degenerate orientation
 * on a shared collinear piece is fail-closed (`interiorSidesAgree` returns
 * true), i.e. reported as overlapping.
 */
export function ringsOverlapPositiveArea(
  ringA: readonly PcbPointMm[],
  ringB: readonly PcbPointMm[],
  eps = GEOM_EPS_MM,
): boolean {
  if (ringA.length < 3 || ringB.length < 3) return false;
  if (!boundsMeet(boundsOfPoints(ringA), boundsOfPoints(ringB), eps)) {
    return false;
  }
  return (
    holeInteriorMeetsRing(ringA, ringB, eps) ||
    holeInteriorMeetsRing(ringB, ringA, eps)
  );
}

/**
 * Does the open interior of the disc `(center, radiusMm)` meet the open
 * interior of `ring`? A disc with `radiusMm ≤ eps` has no open interior and
 * never overlaps; otherwise a centre strictly inside, or closer than the radius
 * to the boundary, overlaps.
 */
export function discOverlapsRing(
  center: PcbPointMm,
  radiusMm: number,
  ring: readonly PcbPointMm[],
  eps = GEOM_EPS_MM,
): boolean {
  if (ring.length < 3 || !(radiusMm > eps)) return false;
  if (
    !boundsMeet(
      boundsOfPoints([center]),
      boundsOfPoints(ring),
      reachOf(radiusMm) + eps,
    )
  ) {
    return false;
  }
  if (strictlyInsideRing(center, ring, eps)) return true;
  return pointToRingEdgeDistance(center, ring) < radiusMm - eps;
}

/**
 * Does the open interior of the stadium swept by `points` with half-width
 * `halfWidthMm` meet the open interior of `ring`? A single-point polyline is a
 * disc of that radius; an empty polyline or a half-width `≤ eps` sweeps no
 * open interior at all.
 */
export function stadiumOverlapsRing(
  points: readonly PcbPointMm[],
  halfWidthMm: number,
  ring: readonly PcbPointMm[],
  eps = GEOM_EPS_MM,
): boolean {
  if (ring.length < 3 || points.length === 0 || !(halfWidthMm > eps)) {
    return false;
  }
  if (points.length === 1) {
    return discOverlapsRing(points[0]!, halfWidthMm, ring, eps);
  }
  if (
    !boundsMeet(
      boundsOfPoints(points),
      boundsOfPoints(ring),
      reachOf(halfWidthMm) + eps,
    )
  ) {
    return false;
  }
  for (const v of points) {
    if (strictlyInsideRing(v, ring, eps)) return true;
  }
  return polylineToRingEdgeDistance(points, ring) < halfWidthMm - eps;
}
