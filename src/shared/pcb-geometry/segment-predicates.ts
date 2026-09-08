/**
 * The one implementation of every segment-level predicate in the PCB geometry
 * kernel (S2 geometry contract §2). Pure, mm domain, readonly inputs.
 *
 * Collinearity is always expressed as a LENGTH — `|orient(a, b, c)| <= eps *
 * |b - a|` reads "c lies within eps of the line through a and b". The
 * predecessor guard in `pcb-trace-geometry.segmentsIntersect` compared the raw
 * direction cross product (an area-like quantity) with a plain constant and so
 * reported two 0.01 mm segments crossing at 0.3° as parallel.
 */
import { GEOM_EPS_MM } from "./tolerance";

export type Point = { x: number; y: number };

/**
 * Degenerate-segment guard for {@link projectPointToSegment}: `lenSq` is a
 * squared length (mm²), so the threshold is EPS² to stay dimensionally
 * consistent. EPS is the geometry epsilon (0.5 nm): the former 1 nm guard
 * collapsed a 0.9 nm segment to its start, so its own end point read as
 * 0.9 nm away and failed the closed-boundary rule (Astra §9.2 #6).
 */
const EPS = GEOM_EPS_MM;

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Returns closest point on segment AB to P, plus the squared distance. */
export function projectPointToSegment(
  point: Point,
  start: Point,
  end: Point,
): {
  x: number;
  y: number;
  t: number;
  distance: number;
} {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < EPS * EPS) {
    return { x: start.x, y: start.y, t: 0, distance: distance(point, start) };
  }
  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = { x: start.x + dx * t, y: start.y + dy * t };
  return { ...projected, t, distance: distance(point, projected) };
}

/** Signed twice-area of triangle abc: positive when c is left of a→b. */
export function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * True when `c` lies within `eps` of the *line* through `a` and `b`. A
 * degenerate `ab` has no line, so the test collapses to point coincidence.
 */
export function isCollinear(
  a: Point,
  b: Point,
  c: Point,
  eps = GEOM_EPS_MM,
): boolean {
  const len = distance(a, b);
  if (len <= eps) return distance(a, c) <= eps;
  return Math.abs(orient(a, b, c)) <= eps * len;
}

/** True when `p` lies within `eps` of the closed segment `ab`. */
export function pointOnSegment(
  p: Point,
  a: Point,
  b: Point,
  eps = GEOM_EPS_MM,
): boolean {
  return projectPointToSegment(p, a, b).distance <= eps;
}

/** Unclamped parameter of `p` projected onto the line through a→b. */
function rawParam(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
}

/** −1 / 0 / +1, where anything within `tol` of zero is *not* a side. */
function sideSign(value: number, tol: number): number {
  if (value > tol) return 1;
  if (value < -tol) return -1;
  return 0;
}

/**
 * Strict crossing: the endpoints of each segment lie on genuinely opposite
 * sides of the other's line (beyond eps). Touching, sharing an endpoint and
 * collinear overlap all return false. Used only where positive-area overlap
 * matters — a transversal crossing is exactly the case where the line/line
 * solve has a provably non-zero denominator.
 */
export function segmentsCrossTransversally(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  eps = GEOM_EPS_MM,
): boolean {
  const abLen = distance(a, b);
  const cdLen = distance(c, d);
  if (abLen <= eps || cdLen <= eps) return false;
  const s1 = sideSign(orient(a, b, c), eps * abLen);
  const s2 = sideSign(orient(a, b, d), eps * abLen);
  if (s1 === 0 || s2 === 0 || s1 === s2) return false;
  const s3 = sideSign(orient(c, d, a), eps * cdLen);
  const s4 = sideSign(orient(c, d, b), eps * cdLen);
  return s3 !== 0 && s4 !== 0 && s3 !== s4;
}

/**
 * Inclusive contact: a proper crossing, a T-touch (an endpoint on the other
 * segment), a shared endpoint, or a collinear overlap all return true. This is
 * the single replacement for the former `pcb-trace-geometry.segmentsIntersect`
 * (which returned false for near-parallel and collinear input) and
 * `outline-geometry.segmentsIntersectInclusive`.
 */
export function segmentsIntersect(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  eps = GEOM_EPS_MM,
): boolean {
  if (segmentsCrossTransversally(a, b, c, d, eps)) return true;
  return (
    pointOnSegment(c, a, b, eps) ||
    pointOnSegment(d, a, b, eps) ||
    pointOnSegment(a, c, d, eps) ||
    pointOnSegment(b, c, d, eps)
  );
}

/**
 * Every parameter `t ∈ [0, 1]` along `ab` at which `ab` touches `cd`: the
 * crossing parameter of a transversal crossing, the parameter of an endpoint
 * lying on the other segment, and — for a collinear pair — the clamped
 * parameters of BOTH ends of the overlap. Sorted ascending; near-duplicates are
 * left in (the caller dedupes at its own resolution).
 */
export function segmentContactParams(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  eps = GEOM_EPS_MM,
): number[] {
  if (distance(a, b) <= eps) {
    return pointOnSegment(a, c, d, eps) ? [0] : [];
  }
  const out: number[] = [];
  const cdLen = distance(c, d);
  const collinear =
    (isCollinear(a, b, c, eps) && isCollinear(a, b, d, eps)) ||
    (cdLen > eps && isCollinear(c, d, a, eps) && isCollinear(c, d, b, eps));
  if (collinear) {
    // Both ends of the overlap interval, clamped onto ab — only when the
    // segments actually share extent; collinear-but-disjoint pairs touch
    // nowhere and contribute nothing.
    const rc = rawParam(c, a, b);
    const rd = rawParam(d, a, b);
    if (Math.max(rc, rd) >= 0 && Math.min(rc, rd) <= 1) {
      out.push(
        Math.max(0, Math.min(1, rc)),
        Math.max(0, Math.min(1, rd)),
      );
    }
  } else if (segmentsCrossTransversally(a, b, c, d, eps)) {
    const rx = b.x - a.x;
    const ry = b.y - a.y;
    const sx = d.x - c.x;
    const sy = d.y - c.y;
    // Non-zero by construction: a transversal crossing rules out parallelism.
    const rxs = rx * sy - ry * sx;
    const qx = c.x - a.x;
    const qy = c.y - a.y;
    const t = (qx * sy - qy * sx) / rxs;
    out.push(Math.max(0, Math.min(1, t)));
  }
  if (pointOnSegment(a, c, d, eps)) out.push(0);
  if (pointOnSegment(b, c, d, eps)) out.push(1);
  if (pointOnSegment(c, a, b, eps)) out.push(projectPointToSegment(c, a, b).t);
  if (pointOnSegment(d, a, b, eps)) out.push(projectPointToSegment(d, a, b).t);
  out.sort((x, y) => x - y);
  return out;
}

/**
 * True when any two non-adjacent edges of the closed ring touch — a
 * self-intersecting or self-touching (invalid) outline. O(n²); outline rings
 * are small. `ring` is an open ring (the closing edge from `ring[n-1]` back to
 * `ring[0]` is implied) and must already be CANONICALISED
 * (`canonicalizeRing`): a duplicated vertex is a zero-length edge that every
 * neighbour touches, which reads as a self-touch. Canonicalisation is the
 * caller's job so this stays a pure predicate.
 */
export function ringSelfIntersects(
  ring: readonly Point[],
  eps = GEOM_EPS_MM,
): boolean {
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    for (let j = i + 1; j < n; j += 1) {
      // Skip adjacent edges and the wrap-around pair (they share a vertex).
      if ((j + 1) % n === i || (i + 1) % n === j) continue;
      const c = ring[j]!;
      const d = ring[(j + 1) % n]!;
      if (segmentsIntersect(a, b, c, d, eps)) return true;
    }
  }
  return false;
}
