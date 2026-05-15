import * as THREE from "three";
import type { FootprintRenderSourcePad } from "../../../rendering/types";

/**
 * Pad shape → 2D polygon path used to build mask / paste aperture geometry.
 *
 * Convention: returned `THREE.Path` is in local pad coordinates (pad center
 * at origin, pad axes aligned with X / Y). Caller is responsible for
 * applying the pad's rotation and the placement-level transform.
 *
 * `expansionMm` outsets (positive) or insets (negative) the aperture by a
 * uniform amount on every side. Defaults to `0`.
 */
export function padAperturePath(
  pad: FootprintRenderSourcePad,
  expansionMm: number = 0,
): THREE.Path {
  const path = new THREE.Path();
  const w = pad.widthMm + 2 * expansionMm;
  const h = pad.heightMm + 2 * expansionMm;
  if (w <= 0 || h <= 0) return path;

  switch (pad.shape) {
    case "circle":
      addCirclePath(path, 0, 0, Math.min(w, h) / 2);
      return path;
    case "oval":
      addOvalPath(path, w, h);
      return path;
    case "roundrect":
      addRoundRectPath(path, w, h, pad.roundrectRatio ?? 0.25);
      return path;
    case "rect":
    case "trapezoid":
    case "custom":
    default:
      addRectPath(path, w, h);
      return path;
  }
}

function addRectPath(path: THREE.Path, w: number, h: number): void {
  const hw = w / 2;
  const hh = h / 2;
  path.moveTo(-hw, -hh);
  path.lineTo(hw, -hh);
  path.lineTo(hw, hh);
  path.lineTo(-hw, hh);
  path.closePath();
}

function addCirclePath(
  path: THREE.Path,
  cx: number,
  cy: number,
  r: number,
  segments: number = 32,
): void {
  if (r <= 0) return;
  path.moveTo(cx + r, cy);
  for (let i = 1; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    path.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  path.closePath();
}

function addOvalPath(path: THREE.Path, w: number, h: number): void {
  const r = Math.min(w, h) / 2;
  const isHoriz = w >= h;
  if (isHoriz) {
    const straight = w - 2 * r;
    const hs = straight / 2;
    // Start at right semicircle top
    path.moveTo(hs, r);
    arcSegments(path, hs, 0, r, Math.PI / 2, -Math.PI / 2, 16);
    path.lineTo(-hs, -r);
    arcSegments(path, -hs, 0, r, -Math.PI / 2, -Math.PI * 1.5, 16);
    path.closePath();
  } else {
    const straight = h - 2 * r;
    const hs = straight / 2;
    path.moveTo(r, hs);
    arcSegments(path, 0, hs, r, 0, Math.PI, 16);
    path.lineTo(-r, -hs);
    arcSegments(path, 0, -hs, r, Math.PI, Math.PI * 2, 16);
    path.closePath();
  }
}

function arcSegments(
  path: THREE.Path,
  cx: number,
  cy: number,
  r: number,
  startA: number,
  endA: number,
  segments: number,
): void {
  for (let i = 1; i <= segments; i++) {
    const a = startA + ((endA - startA) * i) / segments;
    path.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}

function addRoundRectPath(
  path: THREE.Path,
  w: number,
  h: number,
  ratio: number,
): void {
  const r = Math.max(0, Math.min(w, h) * Math.max(0, Math.min(0.5, ratio)));
  const hw = w / 2;
  const hh = h / 2;
  if (r <= 0) {
    addRectPath(path, w, h);
    return;
  }
  // Trace clockwise from top-right corner end of arc
  path.moveTo(hw, hh - r);
  arcSegments(path, hw - r, hh - r, r, 0, Math.PI / 2, 8);
  path.lineTo(-hw + r, hh);
  arcSegments(path, -hw + r, hh - r, r, Math.PI / 2, Math.PI, 8);
  path.lineTo(-hw, -hh + r);
  arcSegments(path, -hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, 8);
  path.lineTo(hw - r, -hh);
  arcSegments(path, hw - r, -hh + r, r, Math.PI * 1.5, Math.PI * 2, 8);
  path.closePath();
}

/**
 * Apply a 2D rotation (deg) + translation to every point in a Path. Returns
 * a new Path so the caller may attach it as a hole on a parent Shape.
 */
export function transformPath(
  path: THREE.Path,
  rotationDeg: number,
  tx: number,
  ty: number,
  mirrorX: boolean = false,
): THREE.Path {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const out = new THREE.Path();
  const pts = path.getPoints(0);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const px = mirrorX ? -p.x : p.x;
    const x = px * c - p.y * s + tx;
    const y = px * s + p.y * c + ty;
    if (i === 0) out.moveTo(x, y);
    else out.lineTo(x, y);
  }
  out.closePath();
  return out;
}

/**
 * Cast a THREE.Path as a Shape so it can be used as a Shape hole. Three
 * accepts Path objects directly for `.holes`, but TypeScript types prefer
 * Shape — this helper centralizes the cast.
 */
export function pathAsShape(path: THREE.Path): THREE.Shape {
  // THREE.Shape extends Path; the runtime accepts a plain Path in `.holes`.
  return path as unknown as THREE.Shape;
}
