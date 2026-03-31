import type { Point, Viewport } from "../types";

export const SCHEMATIC_ROUND_TRIP_TOLERANCE_NM = 1e-6;

export type CanvasBounds = Pick<DOMRect, "left" | "top">;

export function domEventToScreen(
  clientX: number,
  clientY: number,
  canvasBounds: CanvasBounds,
): Point {
  return {
    x: clientX - canvasBounds.left,
    y: clientY - canvasBounds.top,
  };
}

export function canvasToScreen(canvasX: number, canvasY: number): Point {
  return {
    x: canvasX,
    y: canvasY,
  };
}

function ensureZoom(zoom: number): number {
  if (zoom <= 0) {
    throw new RangeError("viewport.zoom must be greater than 0");
  }
  return zoom;
}

export function screenToSchematic(
  screenX: number,
  screenY: number,
  viewport: Viewport,
): Point {
  const zoom = ensureZoom(viewport.zoom);

  return {
    x: (screenX - viewport.offsetX) / zoom,
    y: (screenY - viewport.offsetY) / zoom,
  };
}

export function schematicToScreen(
  schematicX: number,
  schematicY: number,
  viewport: Viewport,
): Point {
  const zoom = ensureZoom(viewport.zoom);

  return {
    x: schematicX * zoom + viewport.offsetX,
    y: schematicY * zoom + viewport.offsetY,
  };
}

export function nmToMm(nm: number): number {
  return nm / 1_000_000;
}

export function mmToNm(mm: number): number {
  return mm * 1_000_000;
}

export function snapToGrid(point: Point, gridSize: number): Point {
  if (gridSize <= 0) {
    throw new RangeError("gridSize must be greater than 0");
  }

  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

export function isWithinRoundTripTolerance(
  actual: Point,
  expected: Point,
  toleranceNm: number = SCHEMATIC_ROUND_TRIP_TOLERANCE_NM,
): boolean {
  return (
    Math.abs(actual.x - expected.x) <= toleranceNm &&
    Math.abs(actual.y - expected.y) <= toleranceNm
  );
}
