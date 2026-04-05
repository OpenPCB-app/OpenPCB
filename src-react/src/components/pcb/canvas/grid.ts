/**
 * Schematic Canvas Grid
 *
 * Thin wrapper around shared canvas-core grid renderer.
 * Re-exports everything for backward compatibility.
 */

export { renderGrid, getGridPixelSpacing } from "@/lib/canvas-core/grid";

import type { Viewport } from "../types";
import { screenToWorld } from "@/lib/canvas-core/viewport";

export interface SchematicBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function getVisibleSchematicBounds(
  width: number,
  height: number,
  viewport: Viewport,
): SchematicBounds {
  const topLeft = screenToWorld(0, 0, viewport);
  const bottomRight = screenToWorld(width, height, viewport);
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
  };
}

export function getSnappedGridBounds(
  bounds: SchematicBounds,
  gridSizeNm: number,
): SchematicBounds {
  return {
    left: Math.floor(bounds.left / gridSizeNm) * gridSizeNm,
    top: Math.floor(bounds.top / gridSizeNm) * gridSizeNm,
    right: Math.ceil(bounds.right / gridSizeNm) * gridSizeNm,
    bottom: Math.ceil(bounds.bottom / gridSizeNm) * gridSizeNm,
  };
}
