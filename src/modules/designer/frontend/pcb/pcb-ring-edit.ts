/**
 * Pure vertex / edge editing for closed rings (zone and keepout outlines).
 * Mirrors `pcb-outline-edit.ts`'s tolerance / nearest-edge conventions, but
 * works directly on a `PcbPointMm[]` closed ring (edge `i` = points[i] →
 * points[(i+1) % n]) rather than an `EditableOutline` — zones and keepouts
 * have no arc segments to special-case.
 */
import type { PcbPointMm } from "../../../../sdks";

type V = PcbPointMm;

function dist(a: V, b: V): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Index of the vertex within `tolMm` of the cursor (nearest wins), or null. */
export function hitRingVertex(
  points: readonly V[],
  cursorMm: V,
  tolMm: number,
): number | null {
  let best: number | null = null;
  let bestD = tolMm;
  points.forEach((v, i) => {
    const d = dist(v, cursorMm);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function projectOnSegment(a: V, b: V, p: V): { pointMm: V; distMm: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t =
    len2 < 1e-12
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  const pointMm = { x: a.x + abx * t, y: a.y + aby * t };
  return { pointMm, distMm: dist(pointMm, p) };
}

/**
 * Nearest ring edge within `tolMm` for inserting a vertex — excludes the
 * vertex-tolerance zone around each endpoint so this never shadows a vertex
 * grab. Edge `i` is `points[i] → points[(i+1) % n]`, wrapping at the last
 * vertex.
 */
export function hitRingEdge(
  points: readonly V[],
  cursorMm: V,
  tolMm: number,
): { edgeIndex: number; pointMm: V } | null {
  const n = points.length;
  let best: { edgeIndex: number; pointMm: V } | null = null;
  let bestD = tolMm;
  for (let i = 0; i < n; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    const proj = projectOnSegment(a, b, cursorMm);
    if (dist(proj.pointMm, a) <= tolMm || dist(proj.pointMm, b) <= tolMm) continue;
    if (proj.distMm <= bestD) {
      bestD = proj.distMm;
      best = { edgeIndex: i, pointMm: proj.pointMm };
    }
  }
  return best;
}

/** Move vertex `i` to `toMm`. Returns a new array; order is preserved. */
export function moveRingVertex(
  points: readonly V[],
  i: number,
  toMm: V,
): V[] {
  return points.map((p, idx) =>
    idx === i ? { x: toMm.x, y: toMm.y } : { x: p.x, y: p.y },
  );
}

/** Insert a vertex at `atMm`, right after `edgeIndex`. */
export function insertRingVertex(
  points: readonly V[],
  edgeIndex: number,
  atMm: V,
): V[] {
  const at = { x: atMm.x, y: atMm.y };
  return [
    ...points.slice(0, edgeIndex + 1).map((p) => ({ x: p.x, y: p.y })),
    at,
    ...points.slice(edgeIndex + 1).map((p) => ({ x: p.x, y: p.y })),
  ];
}

/** Delete vertex `i`. Returns null when the ring would drop below a triangle. */
export function deleteRingVertex(
  points: readonly V[],
  i: number,
): V[] | null {
  if (points.length <= 3) return null;
  return points.filter((_, idx) => idx !== i).map((p) => ({ x: p.x, y: p.y }));
}
