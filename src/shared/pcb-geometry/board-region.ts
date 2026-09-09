/**
 * The board as a CLOSED point set — the outer ring's interior and boundary,
 * minus the interior of every hole (hole boundaries stay on the board) — plus
 * the containment predicates every consumer asks it (S2 geometry contract §4,
 * §5). The ring-level helpers live in ./region-rings; this module re-exports
 * their public names so consumers import one path.
 *
 * All predicates are closed at {@link GEOM_EPS_MM}. Stated limit: the closed
 * rules and the stadium shortcut each spend up to eps, so copper may exceed the
 * true region by at most 2·eps (1 nm, the coordinate quantum) without an error,
 * and an air sliver or a penetration thinner than 2·eps is invisible. Nothing
 * manufacturable lives there.
 *
 * Supported coordinate range: |x|, |y| <= 1e9 nm (1 m). Within it the single
 * nm→mm conversion is exact to 1e-13 mm; beyond it a double cannot hold the
 * quotient and the tolerance above is not honoured.
 */
import type { PcbBoardCutout, PcbBoardOutline, PcbPointMm } from "../../sdks";
import {
  pointInPolygon,
  pointInPolygonEdges,
} from "./pcb-clearance-geometry";
import { segmentToSegmentDistance } from "./pcb-trace-geometry";
import {
  distance,
  projectPointToSegment,
  ringSelfIntersects,
  segmentContactParams,
} from "./segment-predicates";
import { canonicalizeRing } from "./ring-utils";
import { flattenOutline, type OutlineBias } from "./outline-geometry";
import type { RegionIndex } from "./region-index";
import {
  boundsContainPoint,
  boundsMeet,
  boundsOfPoints,
  EMPTY_BOUNDS,
  holeInteriorMeetsRing,
  nearRing,
  PARAM_EPS,
  type RingBounds,
  splitParamsAgainstRing,
} from "./region-rings";
import { GEOM_EPS_MM } from "./tolerance";

export {
  boundsOfPoints,
  ringsIntersect,
  ringStrictlyInside,
  strictlyInsideRing,
} from "./region-rings";
export type { RingBounds } from "./region-rings";

/** One boundary edge, tagged with its ring (0 = outer, i+1 = hole i). */
export interface RegionEdge {
  a: PcbPointMm;
  b: PcbPointMm;
  bounds: RingBounds;
  ring: number;
}

export interface BoardRegion {
  outer: PcbPointMm[];
  holes: PcbPointMm[][];
  /** Default ("none") flattening of the same shapes, kept for §6 validity. */
  unbiasedOuter: PcbPointMm[];
  unbiasedHoles: PcbPointMm[][];
  bounds: RingBounds;
  ringBounds: RingBounds[];
  edges: RegionEdge[];
  /** Ring indices whose biased flattening self-crossed even at the cap. */
  fallbacks: number[];
}

export interface BuildBoardRegionOptions {
  /** `"board-inner"` builds the legality region: `R_poly ⊆ R_true`. */
  bias: "none" | "board-inner";
}

/**
 * Only a free-form contour with an arc can gain a self-crossing from chord
 * approximation: rect and polygon carry no arcs at all, and roundrect / circle
 * are convex by construction in both biases. Skipping the O(n²) probe for them
 * keeps `bias: "none"` region builds (rendering, `pointInOutline`) cheap.
 */
function canSelfCrossFromFlattening(shape: PcbBoardOutline): boolean {
  return (
    shape.kind === "contour" && shape.segments.some((s) => s.type === "arc")
  );
}

/**
 * Closed containment of one simple ring in another: every sub-interval of
 * every inner edge (split at its contacts with the outer boundary) has its
 * midpoint inside-or-on the outer ring. Vertex tests alone are not enough —
 * two rings sharing all their vertices can still bound disjoint interiors.
 */
function ringWithinClosed(
  inner: readonly PcbPointMm[],
  outer: readonly PcbPointMm[],
): boolean {
  const eps = GEOM_EPS_MM;
  const insideOrOn = (q: PcbPointMm): boolean =>
    pointInPolygon(q, outer) || nearRing(outer, q, eps);
  for (let i = 0; i < inner.length; i += 1) {
    const a = inner[i]!;
    const b = inner[(i + 1) % inner.length]!;
    if (!insideOrOn(a)) return false;
    const params = splitParamsAgainstRing(a, b, outer, eps);
    let prev = params[0]!;
    for (let k = 1; k < params.length; k += 1) {
      const t = params[k]!;
      if (t - prev <= PARAM_EPS) continue;
      const mid = (prev + t) / 2;
      if (!insideOrOn({ x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid })) {
        return false;
      }
      prev = t;
    }
  }
  return true;
}

/**
 * A correctly-sided flattening is monotone under refinement: the inward
 * polygon grows toward the true shape (coarse ⊆ fine), the outward one shrinks
 * (fine ⊆ coarse). A coarse ring that stays simple but lands on the wrong side
 * of a sliver-thin feature breaks that (Astra §9.2 #1); default flattening has
 * no side and is never monotone-checked.
 */
function refinementMonotone(
  coarse: readonly PcbPointMm[],
  fine: readonly PcbPointMm[],
  bias: OutlineBias,
): boolean {
  if (bias === "inward") return ringWithinClosed(coarse, fine);
  if (bias === "outward") return ringWithinClosed(fine, coarse);
  return true;
}

/**
 * Flatten with `bias`, looking one refinement level ahead: while the ring or
 * its refinement self-intersects, or the two are not monotone, adopt the
 * refinement and look again (§3 topology rule). A ring still self-crossing at
 * the cap is reported as such; the caller decides what that means.
 */
function flattenRefined(
  shape: PcbBoardOutline,
  bias: OutlineBias,
): { ring: PcbPointMm[]; selfIntersects: boolean } {
  let ring = flattenOutline(shape, { bias });
  if (!canSelfCrossFromFlattening(shape)) {
    return { ring, selfIntersects: false };
  }
  let crosses = ringSelfIntersects(ring);
  let stepMultiplier = 1;
  for (;;) {
    const next = flattenOutline(shape, {
      bias,
      stepMultiplier: stepMultiplier * 2,
    });
    if (next.length <= ring.length) break; // the cap stopped the refinement
    const nextCrosses = ringSelfIntersects(next);
    if (!crosses && !nextCrosses && refinementMonotone(ring, next, bias)) break;
    stepMultiplier *= 2;
    ring = next;
    crosses = nextCrosses;
  }
  return { ring, selfIntersects: crosses };
}

function pushRingEdges(
  edges: RegionEdge[],
  ring: readonly PcbPointMm[],
  index: number,
): void {
  // A ring of fewer than two vertices has no perimeter. The per-ring helpers
  // (`pointToRingEdgeDistance` and friends) already return `Infinity` for it;
  // filing a degenerate `(p, p)` edge here made the region-level distances
  // disagree with them — a zero-size cutout canonicalises to one vertex, and
  // that disagreement surfaced as a two-mode DRC divergence (S9, WP3).
  if (ring.length < 2) return;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    edges.push({ a, b, bounds: boundsOfPoints([a, b]), ring: index });
  }
}

/**
 * One rule per arc: inscribe when the arc's centre lies on the region-interior
 * side, circumscribe otherwise. Per ring that is "inward" for the outer ring
 * and "outward" for every hole — both shrink the board region, so the
 * polygonal region is a subset of the true one.
 */
export function buildBoardRegion(
  outline: PcbBoardOutline,
  cutouts: readonly PcbBoardCutout[],
  options: BuildBoardRegionOptions = { bias: "none" },
): BoardRegion {
  const shapes: PcbBoardOutline[] = [outline, ...cutouts.map((c) => c.shape)];
  const biased: PcbPointMm[][] = [];
  const unbiased: PcbPointMm[][] = [];
  const fallbacks: number[] = [];
  for (let i = 0; i < shapes.length; i += 1) {
    const shape = shapes[i]!;
    if (options.bias !== "board-inner") {
      // Render / resize path: plain flattening, no O(n²) topology probe — the
      // refined unbiased rings exist for outline validity, which only the
      // legality build serves. A contour vertex drag rebuilds this per frame.
      const ring = flattenOutline(shape, { bias: "none" });
      unbiased.push(ring);
      biased.push(ring);
      continue;
    }
    const plain = flattenRefined(shape, "none");
    unbiased.push(plain.ring);
    const attempt = flattenRefined(shape, i === 0 ? "inward" : "outward");
    if (attempt.selfIntersects) {
      // Below any manufacturable web: fall back to the unbiased ring, say so.
      fallbacks.push(i);
      biased.push(plain.ring);
    } else {
      biased.push(attempt.ring);
    }
  }
  const edges: RegionEdge[] = [];
  const ringBounds = biased.map((ring) => boundsOfPoints(ring));
  for (let i = 0; i < biased.length; i += 1)
    pushRingEdges(edges, biased[i]!, i);
  return {
    outer: biased[0] ?? [],
    holes: biased.slice(1),
    unbiasedOuter: unbiased[0] ?? [],
    unbiasedHoles: unbiased.slice(1),
    bounds: ringBounds[0] ?? { ...EMPTY_BOUNDS },
    ringBounds,
    edges,
    fallbacks,
  };
}

/** The point's own degenerate AABB — the query box of every point-side index. */
function pointBounds(p: PcbPointMm): RingBounds {
  return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
}

/**
 * `pointInPolygon` for ONE ring, over the row band of `p.y` instead of the
 * whole ring (broad-phase contract 08 §1 L3). The band is a superset of the
 * straddling edges and the toggle is a commutative XOR, so the parity is the
 * ring loop's — provided the operands are the ring loop's, which
 * {@link pointInPolygonEdges} restores.
 */
function indexedPointInRing(
  region: BoardRegion,
  index: RegionIndex,
  ring: number,
  p: PcbPointMm,
): boolean {
  const points = ring === 0 ? region.outer : region.holes[ring - 1]!;
  // The ring loop's own guard: fewer than three vertices is never "inside".
  if (points.length < 3) return false;
  const band: RegionEdge[] = [];
  for (const i of index.edgesStraddling(p.y, ring)) band.push(region.edges[i]!);
  return pointInPolygonEdges(p, band);
}

/** `nearRing` for ONE ring, over the edges the index says are within `eps`. */
function indexedNearRing(
  region: BoardRegion,
  index: RegionIndex,
  ring: number,
  p: PcbPointMm,
  eps: number,
  box: RingBounds,
): boolean {
  // A ring of fewer than two vertices files no edge (`pushRingEdges`), but the
  // unindexed `nearRing` still walks its degenerate `(p, p)` segment and says
  // "near" within eps of the vertex — so the containment answer of a one-vertex
  // OUTER ring must come from the same walk in both modes (R1 #2).
  const points = ring === 0 ? region.outer : region.holes[ring - 1]!;
  if (points.length < 2) return nearRing(points, p, eps);
  for (const i of index.edgesNear(box, eps, ring)) {
    const e = region.edges[i]!;
    if (projectPointToSegment(p, e.a, e.b).distance <= eps) return true;
  }
  return false;
}

/**
 * PER RING, not "near any boundary": inside-or-on the outer ring, and for every
 * hole not strictly inside it. A point on one hole's boundary that lies
 * 0.0094 mm inside a neighbouring hole is off the board; a global "within eps
 * of any edge ⇒ inside" would have admitted it.
 *
 * With `index` the two per-ring tests run over the index's candidate sets
 * (contract 08 §2.2); the answer is the unindexed one, and the per-hole
 * `ringBounds` prefilter is unchanged.
 */
export function regionContainsPoint(
  region: BoardRegion,
  p: PcbPointMm,
  eps = GEOM_EPS_MM,
  index?: RegionIndex,
): boolean {
  const outerBounds = region.ringBounds[0];
  if (outerBounds && !boundsContainPoint(outerBounds, p, eps)) return false;
  if (!index) {
    if (!pointInPolygon(p, region.outer) && !nearRing(region.outer, p, eps)) {
      return false;
    }
    for (let h = 0; h < region.holes.length; h += 1) {
      const hole = region.holes[h]!;
      const hb = region.ringBounds[h + 1];
      if (hb && !boundsContainPoint(hb, p, eps)) continue;
      if (pointInPolygon(p, hole) && !nearRing(hole, p, eps)) return false;
    }
    return true;
  }
  const box = pointBounds(p);
  if (
    !indexedPointInRing(region, index, 0, p) &&
    !indexedNearRing(region, index, 0, p, eps, box)
  ) {
    return false;
  }
  for (let h = 0; h < region.holes.length; h += 1) {
    const hb = region.ringBounds[h + 1];
    if (hb && !boundsContainPoint(hb, p, eps)) continue;
    if (
      indexedPointInRing(region, index, h + 1, p) &&
      !indexedNearRing(region, index, h + 1, p, eps, box)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Minimum distance from `p` to any ring's perimeter.
 *
 * With `index` the min is taken over `edgesNear(pointBox, haloMm)` by the SAME
 * primitive in the SAME argument order, so it equals the full min whenever the
 * full min is at most the halo and is `Infinity` otherwise — a difference no
 * comparison at or below the halo can see (contract 08 §1 L2). An undefined
 * `haloMm` means "every edge", for the sites that REPORT the distance instead
 * of comparing it (§5).
 */
export function regionBoundaryDistancePoint(
  region: BoardRegion,
  p: PcbPointMm,
  index?: RegionIndex,
  haloMm?: number,
): number {
  let best = Infinity;
  if (!index) {
    for (const e of region.edges) {
      const d = projectPointToSegment(p, e.a, e.b).distance;
      if (d < best) best = d;
    }
    return best;
  }
  for (const i of index.edgesNear(pointBounds(p), haloMm ?? Infinity)) {
    const e = region.edges[i]!;
    const d = projectPointToSegment(p, e.a, e.b).distance;
    if (d < best) best = d;
  }
  return best;
}

/** Minimum distance from an open polyline to any ring's perimeter (§1 L2). */
export function regionBoundaryDistancePolyline(
  region: BoardRegion,
  pts: readonly PcbPointMm[],
  index?: RegionIndex,
  haloMm?: number,
): number {
  if (pts.length < 2) return Infinity;
  let best = Infinity;
  for (let s = 1; s < pts.length; s += 1) {
    const a = pts[s - 1]!;
    const b = pts[s]!;
    if (!index) {
      for (const e of region.edges) {
        const d = segmentToSegmentDistance(a, b, e.a, e.b);
        if (d < best) best = d;
      }
      continue;
    }
    const box = boundsOfPoints([a, b]);
    for (const i of index.edgesNear(box, haloMm ?? Infinity)) {
      const e = region.edges[i]!;
      const d = segmentToSegmentDistance(a, b, e.a, e.b);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Minimum distance from a closed ring's perimeter to any ring's perimeter (§1 L2). */
export function regionBoundaryDistanceRing(
  region: BoardRegion,
  ring: readonly PcbPointMm[],
  index?: RegionIndex,
  haloMm?: number,
): number {
  if (ring.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (!index) {
      for (const e of region.edges) {
        const d = segmentToSegmentDistance(a, b, e.a, e.b);
        if (d < best) best = d;
      }
      continue;
    }
    const box = boundsOfPoints([a, b]);
    for (const j of index.edgesNear(box, haloMm ?? Infinity)) {
      const e = region.edges[j]!;
      const d = segmentToSegmentDistance(a, b, e.a, e.b);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Broad phase: ring indices whose eps-inflated bounds meet `bounds`. */
export function ringsNear(
  region: BoardRegion,
  bounds: RingBounds,
  eps = GEOM_EPS_MM,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < region.ringBounds.length; i += 1) {
    if (boundsMeet(region.ringBounds[i]!, bounds, eps)) out.push(i);
  }
  return out;
}

/**
 * Both endpoints inside and every sub-interval midpoint inside. Between two
 * consecutive boundary contacts the segment is entirely inside or entirely
 * outside the polygonal region, so the midpoint decides.
 */
export function segmentInsideRegion(
  region: BoardRegion,
  a: PcbPointMm,
  b: PcbPointMm,
  eps = GEOM_EPS_MM,
  index?: RegionIndex,
): boolean {
  if (distance(a, b) <= eps) return regionContainsPoint(region, a, eps, index);
  if (!regionContainsPoint(region, a, eps, index)) return false;
  if (!regionContainsPoint(region, b, eps, index)) return false;
  const segBounds = boundsOfPoints([a, b]);
  const params: number[] = [0, 1];
  if (!index) {
    const near = new Set(ringsNear(region, segBounds, eps));
    // An object near no ring boundary is decided by the endpoint tests alone.
    if (near.size === 0) return true;
    for (let i = 0; i < region.ringBounds.length; i += 1) {
      if (!near.has(i)) continue;
      const ring = i === 0 ? region.outer : region.holes[i - 1]!;
      // `segmentContactParams` already contributes every boundary vertex within
      // eps of ab (its endpoint-projection clauses), so no second vertex pass.
      for (const t of splitParamsAgainstRing(a, b, ring, eps)) params.push(t);
    }
  } else {
    // Contact parameters straight from the near EDGES, over every ring at once
    // (contract 08 §2.2): `segmentContactParams` yields a parameter only for an
    // edge within eps of ab, and the parameters are sorted afterwards, so the
    // walk below sees the same array. "No edge near ⇒ true" replaces "no ring
    // near ⇒ true": both endpoints are inside and leaving the region would put
    // the segment ON a boundary edge, so the midpoints cannot disagree.
    const nearEdges = index.edgesNear(segBounds, eps);
    if (nearEdges.length === 0) return true;
    for (const i of nearEdges) {
      const e = region.edges[i]!;
      for (const t of segmentContactParams(a, b, e.a, e.b, eps)) params.push(t);
    }
  }
  params.sort((x, y) => x - y);
  let prev = params[0]!;
  for (let i = 1; i < params.length; i += 1) {
    const t = params[i]!;
    if (t - prev <= PARAM_EPS) continue;
    const mid = (prev + t) / 2;
    const p = { x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid };
    if (!regionContainsPoint(region, p, eps, index)) return false;
    prev = t;
  }
  return true;
}

export function polylineInsideRegion(
  region: BoardRegion,
  pts: readonly PcbPointMm[],
  eps = GEOM_EPS_MM,
  index?: RegionIndex,
): boolean {
  if (pts.length === 0) return true;
  if (pts.length === 1) return regionContainsPoint(region, pts[0]!, eps, index);
  for (let i = 1; i < pts.length; i += 1) {
    if (!segmentInsideRegion(region, pts[i - 1]!, pts[i]!, eps, index)) {
      return false;
    }
  }
  return true;
}

/**
 * Every edge inside the region (which already excludes any edge from a hole's
 * interior) AND no hole interior meeting the ring's interior. The outer ring
 * needs no such test: a ring whose boundary lies inside a simply connected
 * region lies inside it.
 */
export function polygonInsideRegion(
  region: BoardRegion,
  ring: readonly PcbPointMm[],
  eps = GEOM_EPS_MM,
  index?: RegionIndex,
): boolean {
  const canonical = canonicalizeRing(ring, eps);
  if (canonical.length === 0) return true;
  if (canonical.length < 3) {
    return polylineInsideRegion(region, canonical, eps, index);
  }
  for (let i = 0; i < canonical.length; i += 1) {
    const a = canonical[i]!;
    const b = canonical[(i + 1) % canonical.length]!;
    if (!segmentInsideRegion(region, a, b, eps, index)) return false;
  }
  const ringBounds = boundsOfPoints(canonical);
  for (let h = 0; h < region.holes.length; h += 1) {
    const hb = region.ringBounds[h + 1];
    if (hb && !boundsMeet(hb, ringBounds, eps)) continue;
    if (holeInteriorMeetsRing(region.holes[h]!, canonical, eps)) return false;
  }
  return true;
}

/**
 * The stadium is the Minkowski sum of the centreline and a disc of radius
 * `halfWidthMm`; a stadium point outside the region would put a boundary point
 * within `halfWidthMm` of the centreline, and a centreline that far from the
 * boundary cannot cross it — so one point decides the side.
 */
export function stadiumInsideRegion(
  region: BoardRegion,
  pts: readonly PcbPointMm[],
  halfWidthMm: number,
  eps = GEOM_EPS_MM,
  index?: RegionIndex,
): boolean {
  if (pts.length === 0) return true;
  if (halfWidthMm <= eps) return polylineInsideRegion(region, pts, eps, index);
  // The halo is the only threshold the comparison below can see: a true gap
  // above `halfWidthMm` comes back `Infinity`, and `Infinity >= r - eps` is the
  // same boolean (contract 08 §1 L2, §5).
  const gap =
    pts.length === 1
      ? regionBoundaryDistancePoint(region, pts[0]!, index, halfWidthMm)
      : regionBoundaryDistancePolyline(region, pts, index, halfWidthMm);
  return (
    gap >= halfWidthMm - eps &&
    regionContainsPoint(region, pts[0]!, eps, index)
  );
}

export function discInsideRegion(
  region: BoardRegion,
  center: PcbPointMm,
  radiusMm: number,
  eps = GEOM_EPS_MM,
  index?: RegionIndex,
): boolean {
  if (radiusMm <= eps) return regionContainsPoint(region, center, eps, index);
  return (
    regionBoundaryDistancePoint(region, center, index, radiusMm) >=
      radiusMm - eps && regionContainsPoint(region, center, eps, index)
  );
}

/**
 * True when `p` is inside the board: inside the outer outline and not strictly
 * inside any cutout. Compatibility export for the frontend resize warning and
 * the board DRC check — it REBUILDS the region on every call, so anything
 * testing more than a handful of points should build the region once with
 * {@link buildBoardRegion} and call {@link regionContainsPoint}.
 */
export function pointInOutline(
  outline: PcbBoardOutline,
  cutouts: readonly PcbBoardCutout[] | undefined,
  p: PcbPointMm,
): boolean {
  const region = buildBoardRegion(outline, cutouts ?? [], { bias: "none" });
  return regionContainsPoint(region, p);
}
