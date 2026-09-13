/**
 * The ONE closed-form sublevel primitive (SI contract 14 §4.1).
 *
 * For a straight source segment `M(s) = a + s·û`, `s ∈ [0, |ab|]`, and a CONVEX
 * target `T`, the set `{s : dist(M(s), T) ≤ radius}` is empty, a single point or
 * ONE closed interval — the distance from a point moving linearly to a convex
 * set is convex in `s`. Both §2.2 (a terminal's INSIDE / TOUCH partition of a
 * trace centreline) and §4.2 (diff-pair coupled spans) read it, so there is one
 * definition of "how much of this segment is within R of that copper".
 *
 * The answer is exact, never sampled. `T ⊕ B_radius` decomposes into the target
 * itself, one rectangular band per edge and one disc per vertex; each piece
 * meets the line in an interval solved in closed form (four half-planes for a
 * band, a quadratic for a disc), and convexity makes `[min, max]` of those
 * pieces the whole answer even when a piece is missed entirely.
 */
import type { PcbPointMm } from "../../sdks/designer";
import { convexDistance } from "./rounded-shape";

/** `0 ≤ s0 ≤ s1 ≤ |ab|`, arc length along `a → b`. */
export interface SublevelInterval {
  s0: number;
  s1: number;
}

/** A convex target: 1 point = a point, 2 = a segment, 3+ = a convex polygon. */
export type ConvexTarget =
  | { kind: "point"; p: PcbPointMm }
  | { kind: "segment"; a: PcbPointMm; b: PcbPointMm }
  | { kind: "convex"; points: PcbPointMm[] };

function targetPoints(target: ConvexTarget): readonly PcbPointMm[] {
  switch (target.kind) {
    case "point":
      return [target.p];
    case "segment":
      return [target.a, target.b];
    case "convex":
      return target.points;
  }
}

/** Running clip of `s ∈ [lo, hi]` by the half-plane `coef·s ≤ rhs`. */
interface Clip {
  lo: number;
  hi: number;
}

function clipHalfPlane(clip: Clip, coef: number, rhs: number): void {
  if (coef > 0) {
    const bound = rhs / coef;
    if (bound < clip.hi) clip.hi = bound;
  } else if (coef < 0) {
    const bound = rhs / coef;
    if (bound > clip.lo) clip.lo = bound;
  } else if (rhs < 0) {
    // A constraint with no `s` dependence that is already violated.
    clip.lo = Infinity;
    clip.hi = -Infinity;
  }
}

/** `{s : |a + s·û − p| ≤ radius}`, or null. */
function discSpan(
  ax: number,
  ay: number,
  ux: number,
  uy: number,
  p: PcbPointMm,
  radius: number,
): Clip | null {
  const fx = ax - p.x;
  const fy = ay - p.y;
  // |f + s·û|² = s² + 2 s (f·û) + |f|², with |û| = 1.
  const half = fx * ux + fy * uy;
  const disc = half * half - (fx * fx + fy * fy - radius * radius);
  if (!(disc >= 0)) return null;
  const root = Math.sqrt(disc);
  return { lo: -half - root, hi: -half + root };
}

/**
 * `{s : the foot of a + s·û on the edge u→v lies on the edge AND its distance
 * to the edge line is ≤ radius}` — the rectangular half of the edge's stadium.
 * The two caps are the vertex discs, so the union covers `edge ⊕ B_radius`.
 */
function bandSpan(
  ax: number,
  ay: number,
  ux: number,
  uy: number,
  u: PcbPointMm,
  v: PcbPointMm,
  radius: number,
): Clip | null {
  const ex = v.x - u.x;
  const ey = v.y - u.y;
  const eLen = Math.hypot(ex, ey);
  if (eLen === 0) return null;
  const tx = ex / eLen;
  const ty = ey / eLen;
  const dx = ax - u.x;
  const dy = ay - u.y;
  // (P − u)·t̂ = A + s·B, (P − u)·n̂ = C + s·D with n̂ = (−t̂.y, t̂.x).
  const A = dx * tx + dy * ty;
  const B = ux * tx + uy * ty;
  const C = -dx * ty + dy * tx;
  const D = -ux * ty + uy * tx;
  const clip: Clip = { lo: -Infinity, hi: Infinity };
  clipHalfPlane(clip, -B, A); // A + sB ≥ 0
  clipHalfPlane(clip, B, eLen - A); // A + sB ≤ eLen
  clipHalfPlane(clip, D, radius - C); // C + sD ≤ radius
  clipHalfPlane(clip, -D, radius + C); // C + sD ≥ −radius
  return clip.lo > clip.hi ? null : clip;
}

/** Twice the signed area of a ring (shoelace); sign carries the orientation. */
function signedDoubleArea(ring: readonly PcbPointMm[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum;
}

/**
 * `{s : a + s·û ∈ K}` for a convex ring `K`, by clipping against every edge's
 * inward half-plane. A degenerate (zero-area) ring is skipped — its edge bands
 * already cover it, so the caller loses nothing.
 */
function interiorSpan(
  ax: number,
  ay: number,
  ux: number,
  uy: number,
  ring: readonly PcbPointMm[],
): Clip | null {
  const area = signedDoubleArea(ring);
  if (area === 0) return null;
  const inward = area > 0 ? 1 : -1;
  const clip: Clip = { lo: -Infinity, hi: Infinity };
  for (let i = 0; i < ring.length; i += 1) {
    const u = ring[i]!;
    const v = ring[(i + 1) % ring.length]!;
    const ex = v.x - u.x;
    const ey = v.y - u.y;
    // cross(e, P − u) = cross(e, a − u) + s·cross(e, û); inside is ≥ 0 when the
    // ring runs counter-clockwise, ≤ 0 when it runs clockwise.
    const base = inward * (ex * (ay - u.y) - ey * (ax - u.x));
    const slope = inward * (ex * uy - ey * ux);
    clipHalfPlane(clip, -slope, base);
    if (clip.lo > clip.hi) return null;
  }
  return clip;
}

/**
 * `{s ∈ [0, |ab|] : dist(a + s·û, target) ≤ radius}`: empty (null), a point
 * (`s0 === s1`) or ONE closed interval. `radius < 0` → null; a zero-length
 * `ab` degenerates to a point test.
 */
export function segmentSublevelInterval(
  a: PcbPointMm,
  b: PcbPointMm,
  target: ConvexTarget,
  radius: number,
): SublevelInterval | null {
  if (!(radius >= 0)) return null;
  const points = targetPoints(target);
  if (points.length === 0) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    // `convexDistance` is the arity-dispatched kernel the copper predicates
    // use, so a degenerate source cannot answer differently from them.
    return convexDistance([a], points) <= radius ? { s0: 0, s1: 0 } : null;
  }
  const ux = dx / len;
  const uy = dy / len;
  let lo = Infinity;
  let hi = -Infinity;
  const take = (clip: Clip | null): void => {
    if (!clip || clip.lo > clip.hi) return;
    if (clip.lo < lo) lo = clip.lo;
    if (clip.hi > hi) hi = clip.hi;
  };
  for (const p of points) take(discSpan(a.x, a.y, ux, uy, p, radius));
  if (points.length === 2) {
    take(bandSpan(a.x, a.y, ux, uy, points[0]!, points[1]!, radius));
  } else if (points.length >= 3) {
    for (let i = 0; i < points.length; i += 1) {
      const u = points[i]!;
      const v = points[(i + 1) % points.length]!;
      take(bandSpan(a.x, a.y, ux, uy, u, v, radius));
    }
    take(interiorSpan(a.x, a.y, ux, uy, points));
  }
  if (lo > hi) return null;
  const s0 = lo < 0 ? 0 : lo;
  const s1 = hi > len ? len : hi;
  return s0 > s1 ? null : { s0, s1 };
}
