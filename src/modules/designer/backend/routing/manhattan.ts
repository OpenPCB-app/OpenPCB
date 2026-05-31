/**
 * Shared Manhattan (orthogonal) geometry helpers for schematic wires.
 *
 * Single source of truth for the path builders that were previously duplicated
 * across `wire-geometry.ts`, `commands/create-wire.ts`, and the frontend
 * `SchematicCanvas.tsx`. All math is integer-nanometer and deterministic:
 *  - no `Math.random` / `Date.now`,
 *  - no `Math.sqrt` (distance comparisons use exact bigint squared distance or
 *    integer Manhattan distance, both safe past 2^53),
 *  - coordinates are validated as safe integers by callers at the boundary.
 */

import { SCHEMATIC_GRID_NM } from "@openpcb/rendering-core";

export type Point = { x: number; y: number };

export { SCHEMATIC_GRID_NM };

export function pointKey(point: Point): string {
  return `${point.x}:${point.y}`;
}

/** Drop consecutive duplicate points. */
export function sanitizePath(points: Point[]): Point[] {
  const output: Point[] = [];
  for (const point of points) {
    const prev = output[output.length - 1];
    if (!prev || pointKey(prev) !== pointKey(point)) {
      output.push({ x: point.x, y: point.y });
    }
  }
  return output;
}

/** True iff every consecutive pair is axis-aligned (orthogonal). */
export function isManhattanPath(points: Point[]): boolean {
  if (points.length < 2) return true;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const next = points[i]!;
    if (prev.x !== next.x && prev.y !== next.y) return false;
  }
  return true;
}

/**
 * Build an orthogonal polyline that passes through every anchor in order.
 * Diagonal hops are split into a horizontal-then-vertical leg. The first
 * anchor is preserved exactly; the last anchor is reached exactly.
 */
export function buildManhattanPathThroughAnchors(anchors: Point[]): Point[] {
  if (anchors.length <= 1) return anchors.map((p) => ({ x: p.x, y: p.y }));
  const path: Point[] = [{ x: anchors[0]!.x, y: anchors[0]!.y }];
  for (let index = 1; index < anchors.length; index += 1) {
    const next = anchors[index]!;
    const prev = path[path.length - 1]!;
    if (prev.x === next.x || prev.y === next.y) {
      path.push({ x: next.x, y: next.y });
    } else {
      path.push({ x: next.x, y: prev.y }, { x: next.x, y: next.y });
    }
  }
  return sanitizePath(path);
}

/** Remove interior points that are collinear with their neighbours. */
export function simplifyCollinearPath(points: Point[]): Point[] {
  const deduped = sanitizePath(points);
  if (deduped.length <= 2) return deduped;
  const output: Point[] = [deduped[0]!];
  for (let index = 1; index < deduped.length - 1; index += 1) {
    const prev = output[output.length - 1]!;
    const curr = deduped[index]!;
    const next = deduped[index + 1]!;
    const isVertical = prev.x === curr.x && curr.x === next.x;
    const isHorizontal = prev.y === curr.y && curr.y === next.y;
    if (!isVertical && !isHorizontal) output.push(curr);
  }
  output.push(deduped[deduped.length - 1]!);
  return sanitizePath(output);
}

export function snapToGrid(
  point: Point,
  gridNm: number = SCHEMATIC_GRID_NM,
): Point {
  if (gridNm <= 0) return { x: point.x, y: point.y };
  return {
    x: Math.round(point.x / gridNm) * gridNm,
    y: Math.round(point.y / gridNm) * gridNm,
  };
}

/**
 * Repair an arbitrary (possibly non-orthogonal, off-grid) caller-supplied path
 * into a valid Manhattan polyline with EXACT endpoints. Interior anchors are
 * snapped to the grid; endpoints are forced to the true pin coordinates (which
 * may be off-grid). Always returns an orthogonal, simplified path.
 */
export function repairToManhattan(
  points: Point[],
  source: Point,
  target: Point,
  gridNm: number = SCHEMATIC_GRID_NM,
): Point[] {
  const interior = points
    .slice(1, Math.max(1, points.length - 1))
    .map((p) => snapToGrid(p, gridNm));
  const anchors = [source, ...interior, target];
  const path = simplifyCollinearPath(buildManhattanPathThroughAnchors(anchors));
  // Guarantee exact endpoints even after snapping/simplification.
  path[0] = { x: source.x, y: source.y };
  path[path.length - 1] = { x: target.x, y: target.y };
  return sanitizePath(path);
}

/** Integer-safe Manhattan distance (stays well within Number.MAX_SAFE_INTEGER). */
export function manhattanDistance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Orthogonal projection of `point` onto segment [a,b], clamped to the segment.
 * Returns the (integer-rounded) projected point plus the EXACT squared distance
 * as a bigint, so nearest-segment comparisons are deterministic and overflow
 * free even for full-sheet coordinates.
 */
export function orthogonalProjection(
  rawPoint: Point,
  rawA: Point,
  rawB: Point,
): { point: Point; distanceSq: bigint } {
  // Coerce to integers: BigInt() throws on fractional inputs, and callers may
  // pass coordinates that picked up float rounding noise upstream.
  const point = { x: Math.round(rawPoint.x), y: Math.round(rawPoint.y) };
  const a = { x: Math.round(rawA.x), y: Math.round(rawA.y) };
  const b = { x: Math.round(rawB.x), y: Math.round(rawB.y) };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = BigInt(dx) * BigInt(dx) + BigInt(dy) * BigInt(dy);
  let projX: number;
  let projY: number;
  if (lenSq === 0n) {
    projX = a.x;
    projY = a.y;
  } else {
    const num =
      BigInt(point.x - a.x) * BigInt(dx) + BigInt(point.y - a.y) * BigInt(dy);
    if (num <= 0n) {
      projX = a.x;
      projY = a.y;
    } else if (num >= lenSq) {
      projX = b.x;
      projY = b.y;
    } else {
      // Floor-division of bigint, then back to number (within segment bounds).
      projX = a.x + Number((num * BigInt(dx)) / lenSq);
      projY = a.y + Number((num * BigInt(dy)) / lenSq);
    }
  }
  const ex = BigInt(point.x - projX);
  const ey = BigInt(point.y - projY);
  return { point: { x: projX, y: projY }, distanceSq: ex * ex + ey * ey };
}
