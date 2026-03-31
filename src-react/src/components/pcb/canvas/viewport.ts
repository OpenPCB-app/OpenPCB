import type { Point, Viewport } from "../types";

/** Convert screen pixel coordinates to schematic nanometer coordinates */
export function screenToSchematic(
  screenX: number,
  screenY: number,
  viewport: Viewport,
): Point {
  return {
    x: (screenX - viewport.offsetX) / viewport.zoom,
    y: (screenY - viewport.offsetY) / viewport.zoom,
  };
}

/** Convert schematic nanometer coordinates to screen pixel coordinates */
export function schematicToScreen(
  schematicX: number,
  schematicY: number,
  viewport: Viewport,
): Point {
  return {
    x: schematicX * viewport.zoom + viewport.offsetX,
    y: schematicY * viewport.zoom + viewport.offsetY,
  };
}

/** Nanometers to millimeters for display */
export function nmToMm(nm: number): number {
  return nm / 1_000_000;
}

/** Millimeters to nanometers */
export function mmToNm(mm: number): number {
  return mm * 1_000_000;
}

/** Snap a point to the nearest grid intersection */
export function snapToGrid(point: Point, gridSize: number): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}
