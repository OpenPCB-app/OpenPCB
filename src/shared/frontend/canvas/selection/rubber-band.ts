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
