// Resolve a pad to its world-space outline polygon (mm) for exact-polygon DRC
// clearance. Honors the pad's own rotationDeg AND the placement's
// rotation/mirror (B.Cu flips X). Circles/ovals/roundrects are polygonized;
// rect is exact; trapezoid/custom fall back to the bounding rect (the
// render-source schema carries no skew fields).

import type { FootprintRenderSourcePad } from "../rendering/types";
import type {
  PcbFreePad,
  PcbPlacedPart,
  PcbPointMm,
} from "../../sdks/designer";
import {
  padWorldPositionMm,
  placementMirrorX,
  transformPadCenterMm,
} from "./pad-geometry";
import type { RoundedShape } from "./rounded-shape-types";

const CIRCLE_SEGMENTS = 48;
const ARC_SEGMENTS_PER_CORNER = 6;

/**
 * The dimensions a pad ring is built from. Exported because the artwork model
 * builds a MASK OPENING's ring from the same builders (DFM contract 11 §1.3):
 * an opening must circumscribe its true shape exactly as a pad ring does, or
 * the DFM checks would measure a different boundary from the one the fab gets.
 */
export interface ShapeInput {
  shape: string;
  widthMm: number;
  heightMm: number;
  rotationDeg: number;
  roundrectRatio?: number | null;
}

function rotate(p: PcbPointMm, deg: number): PcbPointMm {
  if (!deg) return p;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function arc(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  segments: number,
  out: PcbPointMm[],
): void {
  // Circumscribe: push sample points out to the tangent-polygon radius so the
  // polygon ENCLOSES the true arc (edges tangent at their midpoints). DRC then
  // over-reports rather than missing a clearance/short the inscribed (chord)
  // approximation would round away. Inflation = sec(halfStep) (~0.2–0.9%).
  const rr = r / Math.cos(Math.abs(a1 - a0) / segments / 2);
  for (let i = 0; i <= segments; i += 1) {
    const a = a0 + (a1 - a0) * (i / segments);
    out.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
}

function ellipseRing(rx: number, ry: number): PcbPointMm[] {
  // Circumscribe (see `arc`): inflate the radii so the polygon encloses the
  // true circle/ellipse for conservative DRC.
  const k = 1 / Math.cos(Math.PI / CIRCLE_SEGMENTS);
  const pts: PcbPointMm[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
    const a = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    pts.push({ x: Math.cos(a) * rx * k, y: Math.sin(a) * ry * k });
  }
  return pts;
}

/** Obround / stadium: rectangle with semicircular caps on the short sides. */
function stadiumRing(w: number, h: number): PcbPointMm[] {
  const hw = w / 2;
  const hh = h / 2;
  const out: PcbPointMm[] = [];
  if (w >= h) {
    const r = hh;
    const cx = hw - r;
    arc(cx, 0, r, -Math.PI / 2, Math.PI / 2, CIRCLE_SEGMENTS / 2, out); // right cap
    arc(-cx, 0, r, Math.PI / 2, (3 * Math.PI) / 2, CIRCLE_SEGMENTS / 2, out); // left cap
  } else {
    const r = hw;
    const cy = hh - r;
    arc(0, cy, r, 0, Math.PI, CIRCLE_SEGMENTS / 2, out); // top cap
    arc(0, -cy, r, Math.PI, 2 * Math.PI, CIRCLE_SEGMENTS / 2, out); // bottom cap
  }
  return out;
}

function rectRing(hw: number, hh: number): PcbPointMm[] {
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
}

function roundRectRing(w: number, h: number, ratio: number): PcbPointMm[] {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(ratio * Math.min(w, h), hw, hh);
  if (r <= 0) return rectRing(hw, hh);
  const cxp = hw - r;
  const cyp = hh - r;
  const seg = ARC_SEGMENTS_PER_CORNER;
  const out: PcbPointMm[] = [];
  arc(cxp, cyp, r, 0, Math.PI / 2, seg, out); // top-right
  arc(-cxp, cyp, r, Math.PI / 2, Math.PI, seg, out); // top-left
  arc(-cxp, -cyp, r, Math.PI, (3 * Math.PI) / 2, seg, out); // bottom-left
  arc(cxp, -cyp, r, (3 * Math.PI) / 2, 2 * Math.PI, seg, out); // bottom-right
  return out;
}

/** Build the pad outline centered at the origin, rotated by its own rotationDeg. */
export function shapeRingAroundOrigin(pad: ShapeInput): PcbPointMm[] {
  const hw = pad.widthMm / 2;
  const hh = pad.heightMm / 2;
  let base: PcbPointMm[];
  switch (pad.shape) {
    // A `circle` pad is a disc of `widthMm` — the ONE interpretation the
    // record's exact `disc`, the annular kernel and the Gerber writer share
    // (manufacturability contract 10 §7). An unequal height is a data defect
    // the importer and the hydrator normalise; the ring never reads it, so
    // `ring`, `bounds` and `disc` cannot disagree (S11 R1 #1).
    case "circle":
      base = ellipseRing(hw, hw);
      break;
    case "oval":
      base = stadiumRing(pad.widthMm, pad.heightMm);
      break;
    case "roundrect":
      base = roundRectRing(
        pad.widthMm,
        pad.heightMm,
        pad.roundrectRatio ?? 0.25,
      );
      break;
    // rect, trapezoid, custom → bounding rect (exact for rect; conservative else)
    default:
      base = rectRing(hw, hh);
      break;
  }
  return pad.rotationDeg ? base.map((p) => rotate(p, pad.rotationDeg)) : base;
}

/**
 * ONE footprint-local vertex through the placement transform. Extracted so the
 * ring and the exact rounded CORE go through the same chain vertex by vertex —
 * rotate, add the pad centre, then `transformPadCenterMm` — never a composed
 * matrix, which yields 6.1e-17 where the chain yields 0 at 90° and would move
 * `measuredMm` at the last bit (exact-geometry contract 12 §1.1).
 */
function padWorldVertex(
  v: PcbPointMm,
  centerMm: PcbPointMm,
  placement: PcbPlacedPart,
  mirrored: boolean,
): PcbPointMm {
  // footprint-local vertex = shape ring + pad center
  const local = { x: v.x + centerMm.x, y: v.y + centerMm.y };
  const t = transformPadCenterMm(local, placement.rotationDeg, mirrored);
  return {
    x: placement.positionMm.x + t.x,
    y: placement.positionMm.y + t.y,
  };
}

/** Footprint pad → world-space polygon ring, through the placement transform. */
export function padOutlineWorldMm(
  placement: PcbPlacedPart,
  pad: FootprintRenderSourcePad,
): PcbPointMm[] {
  const ring = shapeRingAroundOrigin(pad);
  const mirrored = placementMirrorX(placement);
  return ring.map((v) => padWorldVertex(v, pad.centerMm, placement, mirrored));
}

/** The shape a free pad's ring and rounded core are both built from. */
function freePadShapeInput(freePad: PcbFreePad): ShapeInput {
  return {
    shape: freePad.shape,
    widthMm: freePad.widthMm,
    heightMm: freePad.heightMm,
    rotationDeg: freePad.rotationDeg,
    roundrectRatio: freePad.roundrectRatio,
  };
}

/** Free pad → world-space polygon ring (centerMm is already world). */
export function freePadOutlineWorldMm(freePad: PcbFreePad): PcbPointMm[] {
  const ring = shapeRingAroundOrigin(freePadShapeInput(freePad));
  return ring.map((v) => ({
    x: v.x + freePad.centerMm.x,
    y: v.y + freePad.centerMm.y,
  }));
}

/**
 * A dimension that can define a radius. `discOf` applies the same rule to the
 * exact disc (`!(widthMm > 0)` ⇒ no disc), and it is load-bearing here for a
 * different reason: a non-positive dimension yields a NEGATIVE radius, and
 * `gap = d − (rA + rB)` then reports a gap LARGER than the copper's — a false
 * PASS, where the circumscribed ring these pads used to be judged on is merely
 * conservative.
 */
function radiusDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** The spine of `stadiumRing`: its two cap centres, from the same `w >= h` switch. */
function stadiumSpine(w: number, h: number): RoundedShape {
  const hw = w / 2;
  const hh = h / 2;
  if (w >= h) {
    const r = hh;
    const cx = hw - r;
    return {
      core: [
        { x: -cx, y: 0 },
        { x: cx, y: 0 },
      ],
      radiusMm: r,
    };
  }
  const r = hw;
  const cy = hh - r;
  return {
    core: [
      { x: 0, y: -cy },
      { x: 0, y: cy },
    ],
    radiusMm: r,
  };
}

/**
 * The four corner centres of `roundRectRing`, from its clamping formula. `null`
 * when the corner radius clamps to 0 — the shape is then the rect its ring
 * already is.
 */
function roundRectCore(w: number, h: number, ratio: number): RoundedShape | null {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(ratio * Math.min(w, h), hw, hh);
  // `roundRectRing` falls back to `rectRing` on `r <= 0`; a NaN ratio passes
  // that test and would build a NaN core, so require a usable radius outright.
  if (!radiusDimension(r)) return null;
  const cxp = hw - r;
  const cyp = hh - r;
  return {
    core: [
      { x: cxp, y: cyp },
      { x: -cxp, y: cyp },
      { x: -cxp, y: -cyp },
      { x: cxp, y: -cyp },
    ],
    radiusMm: r,
  };
}

/**
 * The pad's EXACT shape as a convex core ⊕ a disc (exact-geometry contract 12
 * §1.1), centred at the origin and rotated by its own `rotationDeg` — the shape
 * {@link shapeRingAroundOrigin} circumscribes. `null` for `rect` / `trapezoid` /
 * `custom`, whose exact shape IS that ring with radius 0 (S12c owns the true
 * trapezoid / custom outlines), so the caller references the ring it already
 * built instead of rebuilding one here.
 *
 * `null` ALSO for a pad whose radius-defining dimension is not finite and
 * positive (see {@link radiusDimension}): such a pad keeps the ring it has
 * always been judged on rather than gaining a negative radius.
 */
export function shapeRoundedAroundOrigin(pad: ShapeInput): RoundedShape | null {
  let base: RoundedShape | null;
  switch (pad.shape) {
    // `heightMm` is IGNORED, exactly as `ellipseRing(hw, hw)` ignores it — so
    // it is not required to be usable either, or a `circle` pad with a defect
    // height would carry a `disc` the exact shape disagreed with.
    case "circle":
      base = radiusDimension(pad.widthMm)
        ? { core: [{ x: 0, y: 0 }], radiusMm: pad.widthMm / 2 }
        : null;
      break;
    // The stadium reads BOTH dimensions: `w >= h` picks the spine axis and the
    // other half-dimension is the cap radius.
    case "oval":
      base =
        radiusDimension(pad.widthMm) && radiusDimension(pad.heightMm)
          ? stadiumSpine(pad.widthMm, pad.heightMm)
          : null;
      break;
    case "roundrect":
      base =
        radiusDimension(pad.widthMm) && radiusDimension(pad.heightMm)
          ? roundRectCore(
              pad.widthMm,
              pad.heightMm,
              pad.roundrectRatio ?? 0.25,
            )
          : null;
      break;
    default:
      base = null;
      break;
  }
  if (!base || !pad.rotationDeg) return base;
  return {
    core: base.core.map((p) => rotate(p, pad.rotationDeg)),
    radiusMm: base.radiusMm,
  };
}

/**
 * Footprint pad → its world-space rounded shape. `ring` MUST be this pad's
 * {@link padOutlineWorldMm} output: a `rect` / `trapezoid` / `custom` pad's
 * exact shape is that very array, and referencing it is what keeps the two from
 * drifting apart.
 */
export function padRoundedWorldMm(
  placement: PcbPlacedPart,
  pad: FootprintRenderSourcePad,
  ring: readonly PcbPointMm[],
): RoundedShape {
  const local = shapeRoundedAroundOrigin(pad);
  if (!local) return { core: ring, radiusMm: 0 };
  // A circle's core is the pad CENTRE, and `padWorldPositionMm` is exactly that
  // one vertex's chain — the same call the copper record's exact `disc` takes,
  // so core and disc cannot disagree by a bit.
  if (pad.shape === "circle") {
    return {
      core: [padWorldPositionMm(placement, pad)],
      radiusMm: local.radiusMm,
    };
  }
  const mirrored = placementMirrorX(placement);
  return {
    core: local.core.map((v) =>
      padWorldVertex(v, pad.centerMm, placement, mirrored),
    ),
    radiusMm: local.radiusMm,
  };
}

/** Free pad → its world-space rounded shape (`centerMm` is already world). */
export function freePadRoundedWorldMm(
  freePad: PcbFreePad,
  ring: readonly PcbPointMm[],
): RoundedShape {
  const local = shapeRoundedAroundOrigin(freePadShapeInput(freePad));
  if (!local) return { core: ring, radiusMm: 0 };
  if (freePad.shape === "circle") {
    return {
      core: [{ x: freePad.centerMm.x, y: freePad.centerMm.y }],
      radiusMm: local.radiusMm,
    };
  }
  return {
    core: local.core.map((v) => ({
      x: v.x + freePad.centerMm.x,
      y: v.y + freePad.centerMm.y,
    })),
    radiusMm: local.radiusMm,
  };
}

export interface RingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Axis-aligned bounds of a polygon ring (used for the DRC broad-phase prefilter). */
export function ringBounds(ring: readonly PcbPointMm[]): RingBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
