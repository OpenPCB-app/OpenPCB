// The copper around a drill, exactly: a pad's signed distance field and the
// annular ring it implies (manufacturability contract 10 §3). Pure, mm, no
// projection types — the caller supplies the pad's world frame.
//
// Why not `padOutlineWorldMm`: that ring CIRCUMSCRIBES its arcs (it inflates by
// sec(π/48) so clearance over-reports rather than misses), which over-estimates
// the copper and therefore over-estimates the ring — a false-PASS bias in the
// manufacturability direction (§3.2). These formulas are analytic instead.

import type { PcbPointMm } from "../../sdks/designer";
import { transformPadCenterMm } from "./pad-geometry";
import { GEOM_EPS_MM } from "./tolerance";

/** `roundRectRing`'s default when a pad carries no explicit ratio. */
const DEFAULT_ROUNDRECT_RATIO = 0.25;

/**
 * Below this the corner radius is not representable as an arc and the shape IS
 * a rectangle — the same clamp the ring builder and the Gerber writer apply.
 */
const ROUNDRECT_MIN_RADIUS_MM = 1e-6;

/**
 * One pad's copper in its world frame. `rotationDeg` is the COMPOSED rotation
 * (`PadCopperRecord.rotationDeg`: `placement ± pad`, the sign conjugated when
 * mirrored) and `mirrored` says whether the local X axis is reflected, so a
 * pad-local vector `v` reaches the world as `centerMm + R(rotationDeg)·M·v`.
 */
export interface PadCopperShape {
  readonly shape:
    | "circle"
    | "rect"
    | "oval"
    | "roundrect"
    | "trapezoid"
    | "custom";
  readonly widthMm: number;
  readonly heightMm: number;
  readonly roundrectRatio?: number;
  readonly centerMm: PcbPointMm;
  readonly rotationDeg: number;
  readonly mirrored: boolean;
}

/** A drilled object as the ring kernel sees it: a disc, or a routed stadium. */
export interface DrillGeometry {
  readonly centerMm: PcbPointMm;
  /** Tool radius = `drillMm / 2` (the slot WIDTH for a slot). */
  readonly radiusMm: number;
  /** Centreline of a routed slot; absent for a round hit. */
  readonly slot?: { readonly a: PcbPointMm; readonly b: PcbPointMm };
}

/** World point → the pad's unrotated, unmirrored local frame. */
function toShapeLocal(shape: PadCopperShape, pWorld: PcbPointMm): PcbPointMm {
  // The exact inverse of "reflect X, then rotate": `(R·M)⁻¹ = M·R⁻¹`, so the
  // un-mirror comes AFTER the un-rotate. `transformPadCenterMm(v, θ, false)`
  // is `R(θ)·v` and keeps cardinal angles exact.
  const rotated = transformPadCenterMm(
    { x: pWorld.x - shape.centerMm.x, y: pWorld.y - shape.centerMm.y },
    -shape.rotationDeg,
    false,
  );
  return shape.mirrored ? { x: -rotated.x, y: rotated.y } : rotated;
}

/** The pad's local frame → world (`centerMm + R(rot)·M·local`). */
function toWorld(shape: PadCopperShape, local: PcbPointMm): PcbPointMm {
  const t = transformPadCenterMm(local, shape.rotationDeg, shape.mirrored);
  return { x: shape.centerMm.x + t.x, y: shape.centerMm.y + t.y };
}

/** Signed distance to an axis-aligned box, POSITIVE INSIDE (§3.2). */
function rectSdf(p: PcbPointMm, hw: number, hh: number): number {
  const qx = Math.abs(p.x) - hw;
  const qy = Math.abs(p.y) - hh;
  if (qx <= 0 && qy <= 0) return -Math.max(qx, qy);
  return -Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
}

/** Distance from `p` to the segment `a→b` (a degenerate segment is a point). */
function distToSegment(p: PcbPointMm, a: PcbPointMm, b: PcbPointMm): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (!(lenSq > 0)) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The `oval` centre segment (length `|w − h|` along the long axis), local. */
function ovalSpine(shape: PadCopperShape): [PcbPointMm, PcbPointMm] {
  const half = Math.abs(shape.widthMm - shape.heightMm) / 2;
  return shape.widthMm > shape.heightMm
    ? [
        { x: -half, y: 0 },
        { x: half, y: 0 },
      ]
    : [
        { x: 0, y: -half },
        { x: 0, y: half },
      ];
}

/** Corner radius of a `roundrect`, clamped exactly as `roundRectRing` does. */
function roundrectRadiusMm(shape: PadCopperShape): number {
  const ratio = shape.roundrectRatio ?? DEFAULT_ROUNDRECT_RATIO;
  return Math.min(
    ratio * Math.min(shape.widthMm, shape.heightMm),
    shape.widthMm / 2,
    shape.heightMm / 2,
  );
}

/**
 * Signed distance from `pWorld` to the pad's copper boundary — POSITIVE INSIDE
 * the copper, negative outside, for every shape (§3.2). `trapezoid` / `custom`
 * are rectangles in every consumer (contract §0), so they share the `rect` arm.
 */
export function padSignedDistanceMm(
  shape: PadCopperShape,
  pWorld: PcbPointMm,
): number {
  const p = toShapeLocal(shape, pWorld);
  const hw = shape.widthMm / 2;
  const hh = shape.heightMm / 2;
  switch (shape.shape) {
    // A `circle` pad is a disc of `widthMm` — the ONE interpretation (§7).
    case "circle":
      return hw - Math.hypot(p.x, p.y);
    case "oval": {
      const [a, b] = ovalSpine(shape);
      return Math.min(hw, hh) - distToSegment(p, a, b);
    }
    case "roundrect": {
      const r = roundrectRadiusMm(shape);
      if (!(r >= ROUNDRECT_MIN_RADIUS_MM)) return rectSdf(p, hw, hh);
      return rectSdf(p, hw - r, hh - r) + r;
    }
    default:
      return rectSdf(p, hw, hh);
  }
}

/**
 * The minimum copper width around the drill wall (§3.1):
 *
 *   `min over p ∈ drill centreline of sdf_pad(p) − r_tool`
 *
 * The signed distance to a CONVEX set is concave, so the minimum over the slot
 * segment is attained at an endpoint — and every S11 pad shape is convex, so
 * `min(sdf(a), sdf(b))` is exact, O(1) per hole.
 *
 * A POSITIVE result is the true minimum wall-to-copper width: the field is
 * 1-Lipschitz and the straight descent from a centreline point to its nearest
 * boundary point stays inside the copper. A NEGATIVE result is a breakout
 * indicator and a conservative margin (a lower bound of the deficit), not an
 * exact wall measurement (§3.1).
 */
export function annularRingMm(
  shape: PadCopperShape,
  drill: DrillGeometry,
): number {
  const inner = drill.slot
    ? Math.min(
        padSignedDistanceMm(shape, drill.slot.a),
        padSignedDistanceMm(shape, drill.slot.b),
      )
    : padSignedDistanceMm(shape, drill.centerMm);
  return inner - drill.radiusMm;
}

/** Distance from a point to the drilled void's centreline (point or segment). */
function drillCentrelineDistanceMm(
  drill: DrillGeometry,
  p: PcbPointMm,
): number {
  return drill.slot
    ? distToSegment(p, drill.slot.a, drill.slot.b)
    : Math.hypot(p.x - drill.centerMm.x, p.y - drill.centerMm.y);
}

/** Max centreline distance over a set of local points, mapped to world. */
function maxLocalDistance(
  shape: PadCopperShape,
  drill: DrillGeometry,
  locals: readonly PcbPointMm[],
): number {
  let max = 0;
  for (const local of locals) {
    const d = drillCentrelineDistanceMm(drill, toWorld(shape, local));
    if (d > max) max = d;
  }
  return max;
}

/** The four corners of a `w × h` box, local. */
function boxCorners(w: number, h: number): PcbPointMm[] {
  const hw = w / 2;
  const hh = h / 2;
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
}

/**
 * True when the pad's copper lies entirely inside the drilled void — a
 * copper-LESS non-plated pad (§2.3), which owns no copper record at all.
 *
 * Computed as an UPPER BOUND of the farthest copper point from the drill
 * centreline, compared with the tool radius. The bound is what makes the test
 * fail-safe: when it is uncertain the answer is "not contained", and the copper
 * is kept. A `min(w, h)` outer-diameter comparison is NOT a containment test —
 * a 1 × 1 square survives a ⌀1 drill at its corners (Astra run 1 #3).
 */
export function copperInsideDrill(
  shape: PadCopperShape,
  drill: DrillGeometry,
): boolean {
  let farthest: number;
  switch (shape.shape) {
    case "circle":
      farthest =
        drillCentrelineDistanceMm(drill, shape.centerMm) + shape.widthMm / 2;
      break;
    case "oval": {
      const [a, b] = ovalSpine(shape);
      const capRadius = Math.min(shape.widthMm, shape.heightMm) / 2;
      // The caps, bounded by their centre distance + the cap radius, and the
      // exact corners of the straight part between them.
      const straight =
        shape.widthMm > shape.heightMm
          ? boxCorners(shape.widthMm - shape.heightMm, shape.heightMm)
          : boxCorners(shape.widthMm, shape.heightMm - shape.widthMm);
      farthest = Math.max(
        maxLocalDistance(shape, drill, [a, b]) + capRadius,
        maxLocalDistance(shape, drill, straight),
      );
      break;
    }
    case "roundrect": {
      const r = roundrectRadiusMm(shape);
      const centres = boxCorners(shape.widthMm - 2 * r, shape.heightMm - 2 * r);
      farthest = maxLocalDistance(shape, drill, centres) + r;
      break;
    }
    default:
      farthest = maxLocalDistance(
        shape,
        drill,
        boxCorners(shape.widthMm, shape.heightMm),
      );
      break;
  }
  return farthest <= drill.radiusMm + GEOM_EPS_MM;
}
