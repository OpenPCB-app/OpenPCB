/**
 * The exact curved-geometry kernel (exact-geometry contract 12 §2.2, §2.3).
 * Closed-form only — no iteration, no sampling, no randomness — so every answer
 * is a deterministic function of its input (12 §7).
 *
 * Every `*Distance` returns the TRUE distance: 0 only on a true intersection.
 * Predicates apply {@link GEOM_EPS_MM} themselves — a within-epsilon approach is
 * contact for a predicate, not a zero distance for a measurement.
 *
 * Tolerances are dimension-specific. {@link GEOM_EPS_MM} is a LENGTH (mm) and is
 * the only tolerance any contact test uses; {@link ARC_ANGLE_EPS_RAD} is an
 * ANGLE (radians) and guards angular-range arithmetic alone. A squared length is
 * never compared with either.
 */
import type { PcbPointMm } from "../../sdks";
import { segmentToSegmentDistance } from "./pcb-trace-geometry";
import {
  distance,
  pointOnSegment,
  projectPointToSegment,
  segmentContactParams,
  segmentsIntersect,
} from "./segment-predicates";
import { GEOM_EPS_MM } from "./tolerance";

/** A straight boundary piece. Endpoints may coincide (a degenerate segment). */
export interface ExactSeg {
  kind: "seg";
  a: PcbPointMm;
  b: PcbPointMm;
}

/**
 * A circular boundary piece: the circle of radius `r` about `c`, swept from
 * angle `a0` by the SIGNED `sweep` (positive = counter-clockwise), with
 * `0 < |sweep| <= 2π`.
 *
 * `a` / `b` are the ring's own start and end VERTICES, carried alongside the
 * circle parameters rather than re-derived from them. Contract §2.2 lists only
 * the circle parameters, but `c + r·(cos a0, sin a0)` is not bit-identical to
 * the vertex it was measured from, and two facts depend on bit-identity: the
 * ring must be exactly closed for the half-open ray rule of §2.3 to count a
 * shared vertex once, and {@link exactRingSignedArea} must reproduce
 * `contourSignedArea` (§2.2). The circle parameters drive all the geometry; the
 * vertices drive ring topology.
 */
export interface ExactArc {
  kind: "arc";
  c: PcbPointMm;
  r: number;
  a0: number;
  sweep: number;
  a: PcbPointMm;
  b: PcbPointMm;
}

export type ExactPrim = ExactSeg | ExactArc;

/** A ring of exact primitives, closed (the last prim ends at the first's start). */
export interface ExactPrimRing {
  prims: ExactPrim[];
}

/**
 * The ellipse escape hatch (12 §2.4): a shape with no finite circular-arc form
 * enters every exact consumer as its default flattening plus the deviation
 * bound, and is never certified "exact" through it.
 */
export interface ExactChordRing {
  kind: "chords";
  ring: PcbPointMm[];
  boundMm: number;
}

export type ExactRing = ExactPrimRing | ExactChordRing;

export interface RingBoundsMm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Angular noise floor (RADIANS). Only angular-range arithmetic spends it: an
 * intersection candidate is always re-tested by LENGTH against both primitives,
 * so this value never decides a contact on its own.
 */
export const ARC_ANGLE_EPS_RAD = 1e-12;

const TAU = Math.PI * 2;

// --------------------------------------------------------------------------
// Construction, angles and sampling
// --------------------------------------------------------------------------

function wrapPositive(angle: number): number {
  const m = angle % TAU;
  return m < 0 ? m + TAU : m;
}

/**
 * The ONE arc constructor: the circle of the START radius about `centerMm`,
 * swept in the authored direction to the angle of `end` (12 §2.1). Callers pass
 * points whose radii already agree — {@link canonicalContour} is what guarantees
 * that — so `r` describes both ends.
 */
export function exactArcFromPoints(
  start: PcbPointMm,
  end: PcbPointMm,
  centerMm: PcbPointMm,
  cw: boolean,
): ExactArc {
  const r = Math.hypot(start.x - centerMm.x, start.y - centerMm.y);
  const a0 = Math.atan2(start.y - centerMm.y, start.x - centerMm.x);
  let a1 = Math.atan2(end.y - centerMm.y, end.x - centerMm.x);
  // The same normalisation `outline-geometry.arcTo` uses: a sweep in (0, 2π].
  if (cw) {
    while (a1 >= a0) a1 -= TAU;
  } else {
    while (a1 <= a0) a1 += TAU;
  }
  return { kind: "arc", c: centerMm, r, a0, sweep: a1 - a0, a: start, b: end };
}

export function arcPointAt(arc: ExactArc, angle: number): PcbPointMm {
  return {
    x: arc.c.x + Math.cos(angle) * arc.r,
    y: arc.c.y + Math.sin(angle) * arc.r,
  };
}

/** Offset in [0, 2π) of `angle` from the arc start, along the sweep direction. */
export function arcAngleOffset(arc: ExactArc, angle: number): number {
  return wrapPositive(arc.sweep >= 0 ? angle - arc.a0 : arc.a0 - angle);
}

/** The angle at `offset` along the sweep — the inverse of {@link arcAngleOffset}. */
export function arcAngleAtOffset(arc: ExactArc, offset: number): number {
  return arc.a0 + (arc.sweep >= 0 ? offset : -offset);
}

/** True when `angle` lies in the arc's swept range (closed, angular eps). */
export function angleInArc(
  arc: ExactArc,
  angle: number,
  epsRad = ARC_ANGLE_EPS_RAD,
): boolean {
  const span = Math.abs(arc.sweep);
  if (span >= TAU - epsRad) return true;
  const off = arcAngleOffset(arc, angle);
  // The second clause is the wrap: an angle a hair BEFORE the start.
  return off <= span + epsRad || off >= TAU - epsRad;
}

/** True when the two arcs' angular ranges share at least one angle. */
export function arcsShareAngle(p: ExactArc, q: ExactArc): boolean {
  if (Math.abs(p.sweep) >= TAU - ARC_ANGLE_EPS_RAD) return true;
  if (Math.abs(q.sweep) >= TAU - ARC_ANGLE_EPS_RAD) return true;
  // Two circular intervals overlap iff an endpoint of one lies in the other.
  for (const a of [p.a0, p.a0 + p.sweep, q.a0, q.a0 + q.sweep]) {
    if (angleInArc(p, a) && angleInArc(q, a)) return true;
  }
  return false;
}

/**
 * The closest point of the arc to `p`. A point AT the centre is equidistant
 * from every arc point; the contract pins the witness to the arc's start so the
 * answer is deterministic (12 §2.3).
 */
export function closestPointOnArc(p: PcbPointMm, arc: ExactArc): PcbPointMm {
  const dx = p.x - arc.c.x;
  const dy = p.y - arc.c.y;
  if (dx === 0 && dy === 0) return arc.a;
  let best = arc.a;
  let bestD = distance(p, arc.a);
  const endD = distance(p, arc.b);
  if (endD < bestD) {
    best = arc.b;
    bestD = endD;
  }
  const angle = Math.atan2(dy, dx);
  if (angleInArc(arc, angle)) {
    const foot = arcPointAt(arc, angle);
    if (distance(p, foot) <= bestD) return foot;
  }
  return best;
}

// --------------------------------------------------------------------------
// Distances
// --------------------------------------------------------------------------

export function pointToArcDistance(p: PcbPointMm, arc: ExactArc): number {
  const dx = p.x - arc.c.x;
  const dy = p.y - arc.c.y;
  const d = Math.hypot(dx, dy);
  // At the centre every arc point is exactly `r` away; no angle is meaningful.
  if (d === 0) return arc.r;
  let best = Infinity;
  if (angleInArc(arc, Math.atan2(dy, dx))) best = Math.abs(d - arc.r);
  const s = distance(p, arc.a);
  if (s < best) best = s;
  const e = distance(p, arc.b);
  if (e < best) best = e;
  return best;
}

/**
 * Segment ↔ arc. The only interior–interior stationary point is the segment
 * point nearest the CENTRE projected radially: the closest-pair condition asks
 * the connector to be radial at the arc and normal at the segment, which forces
 * the segment point to be the foot of the centre. Everything else is an
 * endpoint of one against the other — and an intersection, which the candidate
 * families cannot see (a chord can cross an arc with every endpoint far away).
 */
export function segmentToArcDistance(
  a: PcbPointMm,
  b: PcbPointMm,
  arc: ExactArc,
): number {
  if (segmentArcIntersections(a, b, arc).length > 0) return 0;
  let best = projectPointToSegment(arc.a, a, b).distance;
  const e = projectPointToSegment(arc.b, a, b).distance;
  if (e < best) best = e;
  const da = pointToArcDistance(a, arc);
  if (da < best) best = da;
  const db = pointToArcDistance(b, arc);
  if (db < best) best = db;
  const foot = projectPointToSegment(arc.c, a, b);
  const fx = foot.x - arc.c.x;
  const fy = foot.y - arc.c.y;
  const fd = Math.hypot(fx, fy);
  if (fd > 0 && angleInArc(arc, Math.atan2(fy, fx))) {
    const radial = Math.abs(fd - arc.r);
    if (radial < best) best = radial;
  }
  return best;
}

/**
 * Arc ↔ arc. Interior–interior stationary points lie on the line of centres,
 * which gives FOUR candidate pairs (external and internal on each side); an arc
 * keeps only the ones whose angles it actually sweeps. Concentric circles have
 * a continuum of witnesses at the constant distance `|r1 − r2|`; coincident
 * circles with overlapping ranges retrace each other and are distance 0.
 */
export function arcToArcDistance(p: ExactArc, q: ExactArc): number {
  const hits = arcArcIntersections(p, q);
  if (hits.overlap || hits.points.length > 0) return 0;
  let best = Infinity;
  for (const e of [p.a, p.b]) {
    const d = pointToArcDistance(e, q);
    if (d < best) best = d;
  }
  for (const e of [q.a, q.b]) {
    const d = pointToArcDistance(e, p);
    if (d < best) best = d;
  }
  const dx = q.c.x - p.c.x;
  const dy = q.c.y - p.c.y;
  const d = Math.hypot(dx, dy);
  if (d <= GEOM_EPS_MM) {
    if (arcsShareAngle(p, q)) {
      const radial = Math.abs(p.r - q.r);
      if (radial < best) best = radial;
    }
    return best;
  }
  const ux = dx / d;
  const uy = dy / d;
  for (const sp of [1, -1]) {
    for (const sq of [1, -1]) {
      const ap = Math.atan2(sp * uy, sp * ux);
      const aq = Math.atan2(sq * uy, sq * ux);
      if (!angleInArc(p, ap) || !angleInArc(q, aq)) continue;
      const cand = distance(arcPointAt(p, ap), arcPointAt(q, aq));
      if (cand < best) best = cand;
    }
  }
  return best;
}

// --------------------------------------------------------------------------
// Intersections
// --------------------------------------------------------------------------

function dedupePoints(points: readonly PcbPointMm[], eps: number): PcbPointMm[] {
  // Deterministic order (12 §7): the candidate lists are tiny, so the O(n²)
  // dedupe on a sorted list is both exact and cheap.
  const sorted = [...points].sort((m, n) => m.x - n.x || m.y - n.y);
  const out: PcbPointMm[] = [];
  for (const p of sorted) {
    if (out.some((q) => distance(p, q) <= eps)) continue;
    out.push(p);
  }
  return out;
}

/**
 * Points within `eps` of BOTH the segment and the arc. Tangency collapses the
 * two quadratic roots to one point; a zero-length segment has no quadratic at
 * all and is decided by its own endpoint (12 §2.3). Collinear / endpoint
 * contacts enter as candidates and survive the same length filter.
 */
export function segmentArcIntersections(
  a: PcbPointMm,
  b: PcbPointMm,
  arc: ExactArc,
  eps = GEOM_EPS_MM,
): PcbPointMm[] {
  const candidates: PcbPointMm[] = [a, b, arc.a, arc.b];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 > 0) {
    const fx = a.x - arc.c.x;
    const fy = a.y - arc.c.y;
    const lin = 2 * (fx * dx + fy * dy);
    const cst = fx * fx + fy * fy - arc.r * arc.r;
    const disc = lin * lin - 4 * len2 * cst;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      for (const raw of [
        (-lin - root) / (2 * len2),
        (-lin + root) / (2 * len2),
      ]) {
        const t = Math.max(0, Math.min(1, raw));
        candidates.push({ x: a.x + dx * t, y: a.y + dy * t });
      }
    }
  }
  return dedupePoints(
    candidates.filter(
      (p) => pointOnSegment(p, a, b, eps) && pointToArcDistance(p, arc) <= eps,
    ),
    eps,
  );
}

export interface ArcArcHits {
  points: PcbPointMm[];
  /** Coincident circles whose ranges overlap — a boundary retrace, not a point. */
  overlap: boolean;
}

export function arcArcIntersections(
  p: ExactArc,
  q: ExactArc,
  eps = GEOM_EPS_MM,
): ArcArcHits {
  const dx = q.c.x - p.c.x;
  const dy = q.c.y - p.c.y;
  const d = Math.hypot(dx, dy);
  if (d <= eps && Math.abs(p.r - q.r) <= eps) {
    return { points: [], overlap: arcsShareAngle(p, q) };
  }
  const candidates: PcbPointMm[] = [p.a, p.b, q.a, q.b];
  if (d > eps && d <= p.r + q.r + eps && d >= Math.abs(p.r - q.r) - eps) {
    const along = (d * d + p.r * p.r - q.r * q.r) / (2 * d);
    const half = Math.sqrt(Math.max(0, p.r * p.r - along * along));
    const ux = dx / d;
    const uy = dy / d;
    const bx = p.c.x + along * ux;
    const by = p.c.y + along * uy;
    for (const s of half > 0 ? [1, -1] : [1]) {
      candidates.push({ x: bx - s * half * uy, y: by + s * half * ux });
    }
  }
  return {
    points: dedupePoints(
      candidates.filter(
        (pt) =>
          pointToArcDistance(pt, p) <= eps && pointToArcDistance(pt, q) <= eps,
      ),
      eps,
    ),
    overlap: false,
  };
}

export function primsIntersect(
  p: ExactPrim,
  q: ExactPrim,
  eps = GEOM_EPS_MM,
): boolean {
  if (p.kind === "seg") {
    if (q.kind === "seg") return segmentsIntersect(p.a, p.b, q.a, q.b, eps);
    return segmentArcIntersections(p.a, p.b, q, eps).length > 0;
  }
  if (q.kind === "seg") {
    return segmentArcIntersections(q.a, q.b, p, eps).length > 0;
  }
  const hits = arcArcIntersections(p, q, eps);
  return hits.overlap || hits.points.length > 0;
}

export function pointToPrimDistance(p: PcbPointMm, prim: ExactPrim): number {
  return prim.kind === "seg"
    ? projectPointToSegment(p, prim.a, prim.b).distance
    : pointToArcDistance(p, prim);
}

export function segmentToPrimDistance(
  a: PcbPointMm,
  b: PcbPointMm,
  prim: ExactPrim,
): number {
  return prim.kind === "seg"
    ? segmentToSegmentDistance(a, b, prim.a, prim.b)
    : segmentToArcDistance(a, b, prim);
}

export function primDistance(p: ExactPrim, q: ExactPrim): number {
  if (p.kind === "seg") return segmentToPrimDistance(p.a, p.b, q);
  if (q.kind === "seg") return segmentToPrimDistance(q.a, q.b, p);
  return arcToArcDistance(p, q);
}

/** Every intersection point of two primitives (an overlap contributes its ends). */
export function primIntersectionPoints(
  p: ExactPrim,
  q: ExactPrim,
  eps = GEOM_EPS_MM,
): PcbPointMm[] {
  if (p.kind === "seg") {
    if (q.kind === "arc") return segmentArcIntersections(p.a, p.b, q, eps);
    // The contact set of two segments is a point or a collinear interval; both
    // are described by the parameters `segmentContactParams` already yields.
    const out: PcbPointMm[] = [];
    for (const t of segmentContactParams(p.a, p.b, q.a, q.b, eps)) {
      out.push({
        x: p.a.x + (p.b.x - p.a.x) * t,
        y: p.a.y + (p.b.y - p.a.y) * t,
      });
    }
    return dedupePoints(out, eps);
  }
  if (q.kind === "seg") return segmentArcIntersections(q.a, q.b, p, eps);
  return arcArcIntersections(p, q, eps).points;
}
