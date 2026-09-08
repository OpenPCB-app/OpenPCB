/**
 * Advisory board-outline milling checks, shared by DRC. Pure geometry.
 *
 *  - Internal (concave) corner radius: a routed inner corner can't be sharper
 *    than the router-bit radius. Read from the contour's arc segments; an arc is
 *    "internal" when its center lies outside the board (it bulges inward).
 *  - Slot / neck width: the narrowest gap between non-adjacent outline edges —
 *    the board's minimum routed feature width.
 */
import type { PcbBoardOutline, PcbPointMm } from "../../../sdks";
// The shared segment kernel (S2 geometry contract §2) — a superset of the
// private endpoint-projection helper this file used to carry: it also reports 0
// for edges that actually touch, which a validated ring never has.
import { segmentToSegmentDistance } from "../../pcb-geometry/pcb-trace-geometry";
import { segmentsIntersect } from "../../pcb-geometry/segment-predicates";

const EPS_MM = 1e-4;

function ringSignedArea(ring: readonly PcbPointMm[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export interface InternalRadiusHit {
  locationMm: PcbPointMm;
  radiusMm: number;
}

/**
 * Concave (inner) corners a router bit can't cut: arc corners tighter than
 * `minRadiusMm`, plus sharp line-line concave corners (effective radius 0).
 * Covers polygon + contour outlines; parametric convex shapes have none.
 *
 * Concavity is decided by winding: a corner is concave when it turns AGAINST the
 * outline winding (a right/cw turn in a CCW outline, or vice versa). Winding is
 * robust where "is the center inside?" is boundary-ambiguous (fillet centers sit
 * on the edge line).
 */
export function findSmallInternalRadii(
  outline: PcbBoardOutline,
  minRadiusMm: number,
): InternalRadiusHit[] {
  if (outline.kind !== "contour" && outline.kind !== "polygon") return [];
  // Vertex ring + per-edge arc info; edge i connects verts[i] → verts[(i+1)%n].
  const verts: PcbPointMm[] = [];
  const arcs: (null | { centerMm: PcbPointMm; cw: boolean })[] = [];
  if (outline.kind === "polygon") {
    for (const p of outline.pointsMm) {
      verts.push({ x: p.x, y: p.y });
      arcs.push(null);
    }
  } else {
    verts.push({ x: outline.start.x, y: outline.start.y });
    for (let i = 0; i < outline.segments.length - 1; i += 1) {
      verts.push({ x: outline.segments[i]!.to.x, y: outline.segments[i]!.to.y });
    }
    for (const seg of outline.segments) {
      arcs.push(
        seg.type === "arc"
          ? { centerMm: seg.centerMm, cw: seg.cw }
          : null,
      );
    }
  }
  const n = verts.length;
  if (n < 3) return [];
  const ccw = ringSignedArea(verts) > 0;
  const hits: InternalRadiusHit[] = [];

  // Concave arcs tighter than the bit radius.
  for (let i = 0; i < n; i += 1) {
    const arc = arcs[i];
    if (!arc) continue;
    const from = verts[i]!;
    const r = Math.hypot(from.x - arc.centerMm.x, from.y - arc.centerMm.y);
    if (arc.cw === ccw && r < minRadiusMm - EPS_MM) {
      hits.push({ locationMm: { x: from.x, y: from.y }, radiusMm: r });
    }
  }

  // Sharp concave line-line corners (radius 0). Skip vertices flanked by an arc
  // — those are fillet tangent points, already covered by the arc check.
  for (let j = 0; j < n; j += 1) {
    const inEdge = (j - 1 + n) % n;
    if (arcs[inEdge] || arcs[j]) continue;
    const p = verts[(j - 1 + n) % n]!;
    const v = verts[j]!;
    const q = verts[(j + 1) % n]!;
    const cross = (v.x - p.x) * (q.y - v.y) - (v.y - p.y) * (q.x - v.x);
    const concave = ccw ? cross < 0 : cross > 0;
    if (concave && minRadiusMm > 0) {
      hits.push({ locationMm: { x: v.x, y: v.y }, radiusMm: 0 });
    }
  }
  return hits;
}

/**
 * Coarse vertex ring for slot detection: arc endpoints only, so tessellation
 * chords of one smooth curve never read as a narrow gap against each other.
 * Returns null for convex parametric shapes (rect / roundrect / circle) — they
 * have no slot or neck by construction.
 */
export function boardSlotRing(outline: PcbBoardOutline): PcbPointMm[] | null {
  switch (outline.kind) {
    case "rect":
    case "roundrect":
    case "circle":
      return null;
    case "polygon":
      return outline.pointsMm.map((p) => ({ x: p.x, y: p.y }));
    case "contour":
      return [
        { x: outline.start.x, y: outline.start.y },
        ...outline.segments.slice(0, -1).map((s) => ({ x: s.to.x, y: s.to.y })),
      ];
  }
}

export interface SlotHit {
  locationMm: PcbPointMm;
  gapMm: number;
}

/**
 * The narrowest gap between non-adjacent edges of the (open) ring, when it is
 * below `minWidthMm` — else null. One report for the thinnest neck / slot.
 */
export function findNarrowestSlot(
  ring: readonly PcbPointMm[],
  minWidthMm: number,
): SlotHit | null {
  const n = ring.length;
  if (n < 4) return null;
  let best: SlotHit | null = null;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    for (let j = i + 1; j < n; j += 1) {
      // Skip adjacent edges + the wrap-around pair (they share a vertex).
      if ((j + 1) % n === i || (i + 1) % n === j) continue;
      const c = ring[j]!;
      const d = ring[(j + 1) % n]!;
      // Edges that touch or cross are an invalid outline (BOARD_OUTLINE_INVALID
      // reports that), not a slot; this coarse arc-endpoint ring is never
      // validated, so the case is reachable here.
      if (segmentsIntersect(a, b, c, d)) continue;
      const gap = segmentToSegmentDistance(a, b, c, d);
      if (gap < minWidthMm - EPS_MM && (!best || gap < best.gapMm)) {
        best = {
          gapMm: gap,
          locationMm: { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 },
        };
      }
    }
  }
  return best;
}
