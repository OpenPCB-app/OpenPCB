import type {
  BoundsMm,
  PointMm,
  PreviewGraphic,
} from "../../../../shared/rendering/types";
import { boundsFromGraphics } from "../../../../shared/rendering/geometry";

/** AABB in mm spanning two corners (order-independent). */
export function computeAabbFromPoints(a: PointMm, b: PointMm): BoundsMm {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

export function isPointInAabb(point: PointMm, bounds: BoundsMm): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * True when the graphic's full AABB lies inside `bounds`.
 * Enclosure semantics: partial overlap does NOT count.
 */
export function isGraphicFullyInsideAabb(
  graphic: PreviewGraphic,
  bounds: BoundsMm,
): boolean {
  const g = boundsFromGraphics([graphic]);
  if (!g) return false;
  return (
    g.minX >= bounds.minX &&
    g.maxX <= bounds.maxX &&
    g.minY >= bounds.minY &&
    g.maxY <= bounds.maxY
  );
}

/**
 * Returns a non-zero area measure of `bounds`; used by callers to short-circuit
 * zero-size drag rectangles (single-click on empty canvas).
 */
export function isAabbNonEmpty(bounds: BoundsMm): boolean {
  return bounds.maxX > bounds.minX && bounds.maxY > bounds.minY;
}

/** Two AABBs overlap (touching edges count as overlap). */
export function aabbOverlap(a: BoundsMm, b: BoundsMm): boolean {
  return !(
    a.maxX < b.minX ||
    a.minX > b.maxX ||
    a.maxY < b.minY ||
    a.minY > b.maxY
  );
}

/** `outer` fully contains `inner` (touching edges count as contained). */
export function aabbContains(outer: BoundsMm, inner: BoundsMm): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

/**
 * True if the line segment p→q intersects the AABB. Slab method.
 * Endpoints inside or on the boundary count as intersection.
 */
export function segmentIntersectsAabb(
  p: PointMm,
  q: PointMm,
  b: BoundsMm,
): boolean {
  if (isPointInAabb(p, b) || isPointInAabb(q, b)) return true;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let tMin = 0;
  let tMax = 1;
  if (dx === 0) {
    if (p.x < b.minX || p.x > b.maxX) return false;
  } else {
    const t1 = (b.minX - p.x) / dx;
    const t2 = (b.maxX - p.x) / dx;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return false;
  }
  if (dy === 0) {
    if (p.y < b.minY || p.y > b.maxY) return false;
  } else {
    const t1 = (b.minY - p.y) / dy;
    const t2 = (b.maxY - p.y) / dy;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return false;
  }
  return true;
}

/** Polyline (≥1 pt) is fully inside AABB iff every vertex is inside. */
export function polylineContainedInAabb(
  points: ReadonlyArray<PointMm>,
  b: BoundsMm,
): boolean {
  if (points.length === 0) return false;
  for (const p of points) {
    if (!isPointInAabb(p, b)) return false;
  }
  return true;
}

/** Polyline crosses AABB iff any vertex is inside OR any segment intersects. */
export function polylineIntersectsAabb(
  points: ReadonlyArray<PointMm>,
  b: BoundsMm,
): boolean {
  if (points.length === 0) return false;
  for (const p of points) {
    if (isPointInAabb(p, b)) return true;
  }
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const c = points[i]!;
    if (segmentIntersectsAabb(a, c, b)) return true;
  }
  return false;
}
