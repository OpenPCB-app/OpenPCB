/**
 * Ring-level helpers and predicates behind the board region (S2 geometry
 * contract §5): AABBs for the broad phase, "inside-or-on" / "strictly inside"
 * point rules, and the two closed-set ring relations. Pure, mm domain.
 *
 * Kept out of `board-region.ts` so neither file outgrows the 500-line budget;
 * `board-region.ts` re-exports the public names, which is the import path every
 * consumer should use.
 */
import type { PcbPointMm } from "../../sdks";
import { pointInPolygon } from "./pcb-clearance-geometry";
import {
  distance,
  isCollinear,
  projectPointToSegment,
  segmentContactParams,
  segmentsIntersect,
} from "./segment-predicates";
import { ringOrientation } from "./ring-utils";
import { GEOM_EPS_MM } from "./tolerance";

export interface RingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const EMPTY_BOUNDS: RingBounds = {
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
};

/** Centre of two AABBs' intersection rectangle — symmetric in a and b. */
export function boundsIntersectionCenter(a: RingBounds, b: RingBounds): PcbPointMm {
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minY = Math.max(a.minY, b.minY);
  const maxY = Math.min(a.maxY, b.maxY);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export function boundsOfPoints(points: readonly PcbPointMm[]): RingBounds {
  if (points.length === 0) return { ...EMPTY_BOUNDS };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function boundsMeet(a: RingBounds, b: RingBounds, eps: number): boolean {
  return (
    a.minX - eps <= b.maxX &&
    a.maxX + eps >= b.minX &&
    a.minY - eps <= b.maxY &&
    a.maxY + eps >= b.minY
  );
}

export function boundsContainPoint(
  b: RingBounds,
  p: PcbPointMm,
  eps: number,
): boolean {
  return (
    p.x >= b.minX - eps &&
    p.x <= b.maxX + eps &&
    p.y >= b.minY - eps &&
    p.y <= b.maxY + eps
  );
}

/** True when `p` lies within `eps` of the closed ring's perimeter. */
export function nearRing(
  ring: readonly PcbPointMm[],
  p: PcbPointMm,
  eps: number,
): boolean {
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (projectPointToSegment(p, a, b).distance <= eps) return true;
  }
  return false;
}

/** Inside the ring AND farther than `eps` from every one of its edges. */
export function strictlyInsideRing(
  p: PcbPointMm,
  ring: readonly PcbPointMm[],
  eps: number,
): boolean {
  return pointInPolygon(p, ring) && !nearRing(ring, p, eps);
}

/** Raw (unclamped) parameter of `p` projected onto the line through a→b. */
function rawParam(p: PcbPointMm, a: PcbPointMm, b: PcbPointMm): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
}

/** Collinear within `eps` AND sharing more than `eps` of extent. */
function collinearOverlap(
  a: PcbPointMm,
  b: PcbPointMm,
  c: PcbPointMm,
  d: PcbPointMm,
  eps: number,
): boolean {
  const len = distance(a, b);
  if (len <= eps) return false;
  if (!isCollinear(a, b, c, eps) || !isCollinear(a, b, d, eps)) return false;
  const tc = rawParam(c, a, b);
  const td = rawParam(d, a, b);
  const lo = Math.max(0, Math.min(tc, td));
  const hi = Math.min(1, Math.max(tc, td));
  return (hi - lo) * len > eps;
}

/**
 * The interior of an edge's ring is to the LEFT of travel when the ring runs
 * counter-clockwise and to the RIGHT when it runs clockwise, so two collinear
 * edges put their interiors on the same side exactly when their orientations
 * agree iff they run in the same direction.
 */
function interiorSidesAgree(
  orientA: 1 | -1 | 0,
  orientB: 1 | -1 | 0,
  a: PcbPointMm,
  b: PcbPointMm,
  c: PcbPointMm,
  d: PcbPointMm,
): boolean {
  // Unknown orientation (a zero-area or bow-tie ring) cannot prove the
  // interiors are on opposite sides — fail CLOSED and call it a meeting, so a
  // degenerate ring lying on a hole edge is reported off the board rather than
  // silently accepted.
  if (orientA === 0 || orientB === 0) return true;
  const sameDirection =
    (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) > 0;
  return (orientA === orientB) === sameDirection;
}

/** Parameters within this of each other describe the same point on a segment. */
export const PARAM_EPS = 1e-12;

/**
 * Sorted, deduped split parameters of segment a→b at every contact with the
 * closed `ring`, always including its own ends.
 */
export function splitParamsAgainstRing(
  a: PcbPointMm,
  b: PcbPointMm,
  ring: readonly PcbPointMm[],
  eps: number,
): number[] {
  const params: number[] = [0, 1];
  for (let j = 0; j < ring.length; j += 1) {
    const c = ring[j]!;
    const d = ring[(j + 1) % ring.length]!;
    for (const t of segmentContactParams(a, b, c, d, eps)) params.push(t);
  }
  params.sort((x, y) => x - y);
  return params;
}

/**
 * Split segment a→b at every contact with every ring, in order from `a` to
 * `b`. Each returned sub-segment lies wholly inside or wholly outside each
 * ring, so any predicate that only depends on ring membership is CONSTANT over
 * it and can be evaluated once, at its midpoint (rule-semantics contract §4.4:
 * a scoped area rule must not be applied to the part of a trace that leaves
 * its area). Sub-segments shorter than `PARAM_EPS` of the parameter range are
 * dropped; a segment that meets no ring comes back whole.
 */
export function splitSegmentAtRings(
  a: PcbPointMm,
  b: PcbPointMm,
  rings: ReadonlyArray<readonly PcbPointMm[]>,
  eps = GEOM_EPS_MM,
): Array<{ a: PcbPointMm; b: PcbPointMm }> {
  const params: number[] = [0, 1];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    for (const t of splitParamsAgainstRing(a, b, ring, eps)) params.push(t);
  }
  params.sort((x, y) => x - y);
  const at = (t: number): PcbPointMm => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const out: Array<{ a: PcbPointMm; b: PcbPointMm }> = [];
  let prev = params[0]!;
  for (let i = 1; i < params.length; i += 1) {
    const t = params[i]!;
    if (t - prev <= PARAM_EPS) continue;
    out.push({ a: at(prev), b: at(t) });
    prev = t;
  }
  // A zero-length segment (or one whose splits all collapsed) still has to be
  // evaluated once — never drop copper from the comparison.
  return out.length > 0 ? out : [{ a, b }];
}

/**
 * Does the hole's interior meet the ring's interior? The ring's boundary is
 * already known to be inside the region, so the only remaining route is through
 * the hole's own boundary: a hole vertex strictly inside the ring, a hole-edge
 * sub-segment strictly inside it, or a shared collinear piece whose interior
 * sides agree (a pad that exactly fills a square cutout).
 */
export function holeInteriorMeetsRing(
  hole: readonly PcbPointMm[],
  ring: readonly PcbPointMm[],
  eps: number,
): boolean {
  const orientHole = ringOrientation(hole);
  const orientRing = ringOrientation(ring);
  for (const v of hole) {
    if (strictlyInsideRing(v, ring, eps)) return true;
  }
  for (let i = 0; i < hole.length; i += 1) {
    const a = hole[i]!;
    const b = hole[(i + 1) % hole.length]!;
    if (distance(a, b) <= eps) continue;
    for (let j = 0; j < ring.length; j += 1) {
      const c = ring[j]!;
      const d = ring[(j + 1) % ring.length]!;
      if (
        collinearOverlap(a, b, c, d, eps) &&
        interiorSidesAgree(orientHole, orientRing, a, b, c, d)
      ) {
        return true;
      }
    }
    const params = splitParamsAgainstRing(a, b, ring, eps);
    let prev = params[0]!;
    for (let k = 1; k < params.length; k += 1) {
      const t = params[k]!;
      if (t - prev <= PARAM_EPS) continue;
      const mid = (prev + t) / 2;
      const p = { x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid };
      if (strictlyInsideRing(p, ring, eps)) return true;
      prev = t;
    }
  }
  return false;
}

function anyEdgePairTouches(
  ringA: readonly PcbPointMm[],
  ringB: readonly PcbPointMm[],
  eps: number,
): boolean {
  for (let i = 0; i < ringA.length; i += 1) {
    const a = ringA[i]!;
    const b = ringA[(i + 1) % ringA.length]!;
    for (let j = 0; j < ringB.length; j += 1) {
      const c = ringB[j]!;
      const d = ringB[(j + 1) % ringB.length]!;
      if (segmentsIntersect(a, b, c, d, eps)) return true;
    }
  }
  return false;
}

/**
 * Closed-set contact. Complete for closed polygons: interiors that meet without
 * any vertex containment must have crossing or touching edges. Both rings must
 * already be canonicalised; the closing edge is implicit.
 */
export function ringsIntersect(
  ringA: readonly PcbPointMm[],
  ringB: readonly PcbPointMm[],
  eps = GEOM_EPS_MM,
): boolean {
  if (ringA.length < 3 || ringB.length < 3) return false;
  for (const v of ringA) {
    if (pointInPolygon(v, ringB) || nearRing(ringB, v, eps)) return true;
  }
  for (const v of ringB) {
    if (pointInPolygon(v, ringA) || nearRing(ringA, v, eps)) return true;
  }
  return anyEdgePairTouches(ringA, ringB, eps);
}

/** Complete: a boundary that leaves B must touch B's boundary. */
export function ringStrictlyInside(
  ringA: readonly PcbPointMm[],
  ringB: readonly PcbPointMm[],
  eps = GEOM_EPS_MM,
): boolean {
  if (ringA.length < 3 || ringB.length < 3) return false;
  for (const v of ringA) {
    if (!strictlyInsideRing(v, ringB, eps)) return false;
  }
  return !anyEdgePairTouches(ringA, ringB, eps);
}
