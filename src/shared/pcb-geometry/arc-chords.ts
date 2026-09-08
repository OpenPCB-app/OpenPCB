/**
 * One chord sampler, two constructions, one tolerance (S2 geometry contract
 * §3). {@link MAX_CHORD_DEVIATION_MM} bounds the distance between the flattened
 * boundary and the true curve, on the side the construction promises:
 *
 *  - **inscribed** — vertices sit on the true arc, so the chords lie on the
 *    centre side of it (the polygon is inside a convex curve).
 *  - **circumscribed** — a tangent chain: every edge lies on a tangent line of
 *    the arc, so the polygon encloses the arc AND meets its neighbouring
 *    segments without a dip. Pushing the arc's own endpoints outward instead
 *    (the `pad-outline.ts` construction) is not enclosing at the joins.
 *
 * Every arc emits the exact end point; the start point belongs to the previous
 * segment.
 */
import type { PcbPointMm } from "../../sdks";

export type ArcBias = "inscribed" | "circumscribed";

/**
 * Legacy fixed count for a full circle. No longer used — circles and ellipses
 * go through {@link arcSegmentCount} like every other arc — but still exported
 * because it is part of this module's published surface.
 */
export const DEFAULT_ARC_SEGMENTS = 64;

/**
 * Maximum chord deviation (mm) when discretising an arc — the single tolerance
 * shared by rendering, DRC, DXF tessellation, and Gerber so every consumer
 * agrees on how finely a curve flattens.
 */
export const MAX_CHORD_DEVIATION_MM = 0.01;

/**
 * Historical floor. The real floor is now `θ <= π/2` (below), which is a bound
 * on the step ANGLE, not on the count: a full circle always gets at least 4
 * steps and a quarter arc at least 1. The constant is kept exported for
 * compatibility with existing importers; do not use it as a floor.
 */
export const MIN_ARC_SEGMENTS = 2;

export const MAX_ARC_SEGMENTS = 512;

/**
 * Hard cap on the step angle for BOTH constructions: a two-chord "circle" has
 * zero area, and a tangent step of π puts vertices at infinity.
 */
const MAX_STEP_RAD = Math.PI / 2;

function maxStepRad(radiusMm: number, bias: ArcBias): number {
  const r = Math.abs(radiusMm);
  // A non-positive or non-finite radius has no meaningful sagitta; fall back to
  // the angular floor rather than an acos domain error.
  if (!Number.isFinite(r) || r <= 0) return MAX_STEP_RAD;
  const d = MAX_CHORD_DEVIATION_MM;
  // Inscribed sagitta r(1 − cos(θ/2)) ≤ d; circumscribed radial excess
  // r(sec(θ/2) − 1) ≤ d — a strictly tighter rule, so a tangent chain stepped
  // by the inscribed rule overshoots (0.010016 mm at r = 2.07 with 32 steps).
  const cosHalf = bias === "inscribed" ? 1 - d / r : r / (r + d);
  return 2 * Math.acos(Math.max(-1, Math.min(1, cosHalf)));
}

/**
 * Number of chords for an arc of `radiusMm` sweeping `sweepRad` under `bias`,
 * so the deviation stays within {@link MAX_CHORD_DEVIATION_MM} on the promised
 * side, with every step at most π/2. Clamped to {@link MAX_ARC_SEGMENTS}.
 * `stepMultiplier` is the refinement knob (§3 topology rule).
 */
export function arcSegmentCount(
  radiusMm: number,
  sweepRad: number,
  bias: ArcBias = "inscribed",
  stepMultiplier = 1,
): number {
  // A non-finite sweep or multiplier is bad input, not a reason to emit NaN
  // vertices: fall back to one chord / no refinement.
  const sweep = Number.isFinite(sweepRad) ? Math.abs(sweepRad) : 0;
  const mult =
    Number.isFinite(stepMultiplier) && stepMultiplier > 1 ? stepMultiplier : 1;
  const byDeviation = Math.ceil(
    sweep / Math.max(1e-9, maxStepRad(radiusMm, bias)),
  );
  const byAngle = Math.ceil(sweep / MAX_STEP_RAD);
  const steps = Math.max(1, byDeviation, byAngle) * mult;
  return Math.min(MAX_ARC_SEGMENTS, steps);
}

/**
 * Chord vertices for the arc from angle `a0` to `a1` about `center`, EXCLUDING
 * the start point (the previous segment emitted it) and ending on a copy of the
 * exact `end` — never a start-radius reprojection, so a caller whose arc
 * endpoints differ slightly in radius still closes without a gap. The sweep
 * sign follows `a1 - a0`; callers normalise it.
 */
export function arcChordPoints(
  center: PcbPointMm,
  radiusMm: number,
  a0: number,
  a1: number,
  steps: number,
  bias: ArcBias,
  end: PcbPointMm,
): PcbPointMm[] {
  // Enforce the θ ≤ π/2 floor here too: a caller bypassing `arcSegmentCount`
  // must never get a tangent step of π (vertices at infinity).
  // Non-finite geometry cannot be sampled: emit the end point alone (a line)
  // rather than an unbounded loop of NaN vertices (Astra §9.2 #8).
  if (
    !Number.isFinite(a0) ||
    !Number.isFinite(a1) ||
    !Number.isFinite(radiusMm) ||
    !Number.isFinite(center.x) ||
    !Number.isFinite(center.y)
  ) {
    return [{ x: end.x, y: end.y }];
  }
  const requested = Number.isFinite(steps) ? Math.floor(steps) : 1;
  const n = Math.min(
    MAX_ARC_SEGMENTS,
    Math.max(1, requested, Math.ceil(Math.abs(a1 - a0) / MAX_STEP_RAD)),
  );
  const pts: PcbPointMm[] = [];
  if (bias === "circumscribed") {
    const theta = (a1 - a0) / n;
    const r = radiusMm / Math.cos(theta / 2);
    for (let k = 0; k < n; k += 1) {
      const a = a0 + theta / 2 + k * theta;
      pts.push({
        x: center.x + Math.cos(a) * r,
        y: center.y + Math.sin(a) * r,
      });
    }
  } else {
    for (let k = 1; k < n; k += 1) {
      const a = a0 + ((a1 - a0) * k) / n;
      pts.push({
        x: center.x + Math.cos(a) * radiusMm,
        y: center.y + Math.sin(a) * radiusMm,
      });
    }
  }
  pts.push({ x: end.x, y: end.y });
  return pts;
}

/**
 * Closed ring (no duplicate closing point) for a full ellipse. The tangent
 * chain is the affine image of the circle's — affine maps preserve tangency —
 * so both radii scale by `sec(π/steps)` and the vertices sit on the angle
 * bisectors.
 */
export function ellipseChordRing(
  center: PcbPointMm,
  rx: number,
  ry: number,
  steps: number,
  bias: ArcBias,
): PcbPointMm[] {
  const requested = Number.isFinite(steps) ? Math.floor(steps) : 4;
  const n = Math.max(4, requested);
  const scale = bias === "circumscribed" ? 1 / Math.cos(Math.PI / n) : 1;
  const offset = bias === "circumscribed" ? 0.5 : 0;
  const pts: PcbPointMm[] = [];
  for (let k = 0; k < n; k += 1) {
    const a = ((k + offset) / n) * Math.PI * 2;
    pts.push({
      x: center.x + Math.cos(a) * rx * scale,
      y: center.y + Math.sin(a) * ry * scale,
    });
  }
  return pts;
}
