/**
 * Ring housekeeping shared by the flattener and the board region: dedupe,
 * signed area, orientation. Pure, mm domain (S2 geometry contract §3, §4).
 *
 * Rings are OPEN — the closing edge from `ring[n-1]` back to `ring[0]` is
 * implied — so "consecutive coincident vertices" includes the wrap pair.
 */
import type { PcbPointMm } from "../../sdks";
import { GEOM_EPS_MM } from "./tolerance";

/**
 * Drop consecutive coincident vertices, including the wrap pair. A duplicated
 * vertex is a zero-length edge, and every self-intersection test reads a
 * zero-length edge sitting on its neighbour as a self-touch — which is how
 * every full-radius roundrect outline used to be reported invalid.
 */
export function canonicalizeRing(
  ring: readonly PcbPointMm[],
  eps = GEOM_EPS_MM,
): PcbPointMm[] {
  const out: PcbPointMm[] = [];
  for (const p of ring) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) <= eps) continue;
    out.push({ x: p.x, y: p.y });
  }
  while (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(last.x - first.x, last.y - first.y) > eps) break;
    out.pop();
  }
  return out;
}

/** Shoelace signed area (mm²): positive for a counter-clockwise ring. */
export function ringSignedArea(ring: readonly PcbPointMm[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Area below this (mm²) is not a usable orientation — a bow-tie or a sliver. */
export const DEGENERATE_AREA_MM2 = 1e-6;

/**
 * +1 counter-clockwise, −1 clockwise, 0 when the ring carries no usable
 * orientation (fewer than 3 vertices, zero area, a bow-tie). Callers must
 * treat 0 as "no interior side is known" rather than throwing: the DRC context
 * is built before `checkOutline` gets a chance to reject the shape.
 */
export function ringOrientation(ring: readonly PcbPointMm[]): 1 | -1 | 0 {
  if (ring.length < 3) return 0;
  const area = ringSignedArea(ring);
  if (Math.abs(area) < DEGENERATE_AREA_MM2) return 0;
  return area > 0 ? 1 : -1;
}

/**
 * The ring with counter-clockwise (positive signed area) orientation — a copy
 * reversed when it was clockwise, the same array otherwise. Polygon booleans
 * with a non-zero fill rule treat two opposite-winding rings as CANCELLING
 * where they overlap (winding +1 −1 = 0), so every ring that enters a union or
 * subtraction as an independent solid must carry one orientation (Astra S4 #1).
 */
export function ensureCcwRing(ring: readonly PcbPointMm[]): readonly PcbPointMm[] {
  return ringSignedArea(ring) < 0 ? [...ring].reverse() : ring;
}

