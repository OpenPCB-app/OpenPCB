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
import { placementMirrorX, transformPadCenterMm } from "./pad-geometry";

const CIRCLE_SEGMENTS = 48;
const ARC_SEGMENTS_PER_CORNER = 6;

interface ShapeInput {
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
function shapeRingAroundOrigin(pad: ShapeInput): PcbPointMm[] {
  const hw = pad.widthMm / 2;
  const hh = pad.heightMm / 2;
  let base: PcbPointMm[];
  switch (pad.shape) {
    case "circle":
      base = ellipseRing(hw, hh);
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

/** Footprint pad → world-space polygon ring, through the placement transform. */
export function padOutlineWorldMm(
  placement: PcbPlacedPart,
  pad: FootprintRenderSourcePad,
): PcbPointMm[] {
  const ring = shapeRingAroundOrigin(pad);
  const mirrored = placementMirrorX(placement);
  return ring.map((v) => {
    // footprint-local vertex = shape ring + pad center
    const local = { x: v.x + pad.centerMm.x, y: v.y + pad.centerMm.y };
    const t = transformPadCenterMm(local, placement.rotationDeg, mirrored);
    return {
      x: placement.positionMm.x + t.x,
      y: placement.positionMm.y + t.y,
    };
  });
}

/** Free pad → world-space polygon ring (centerMm is already world). */
export function freePadOutlineWorldMm(freePad: PcbFreePad): PcbPointMm[] {
  const ring = shapeRingAroundOrigin({
    shape: freePad.shape,
    widthMm: freePad.widthMm,
    heightMm: freePad.heightMm,
    rotationDeg: freePad.rotationDeg,
    roundrectRatio: freePad.roundrectRatio,
  });
  return ring.map((v) => ({
    x: v.x + freePad.centerMm.x,
    y: v.y + freePad.centerMm.y,
  }));
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
