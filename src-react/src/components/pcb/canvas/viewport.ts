import type { Bounds, Point, Viewport } from "../types";

export const SCHEMATIC_ROUND_TRIP_TOLERANCE_NM = 1e-6;
export const DEFAULT_SCHEMATIC_ZOOM = 1 / 12_700;
export const MIN_VIEWPORT_ZOOM = 1 / 1_000_000;
export const MAX_VIEWPORT_ZOOM = 50;
export const DEFAULT_VIEWPORT_WIDTH_PX = 800;
export const DEFAULT_VIEWPORT_HEIGHT_PX = 600;

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

export function clampViewportZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    throw new RangeError("viewport.zoom must be a finite number");
  }

  return Math.max(MIN_VIEWPORT_ZOOM, Math.min(MAX_VIEWPORT_ZOOM, zoom));
}

export function createCenteredViewport(
  width: number = DEFAULT_VIEWPORT_WIDTH_PX,
  height: number = DEFAULT_VIEWPORT_HEIGHT_PX,
  zoom: number = DEFAULT_SCHEMATIC_ZOOM,
): Viewport {
  return {
    offsetX: width / 2,
    offsetY: height / 2,
    zoom: clampViewportZoom(zoom),
  };
}

export function fitViewportToBounds(
  bounds: Bounds | null,
  width: number = DEFAULT_VIEWPORT_WIDTH_PX,
  height: number = DEFAULT_VIEWPORT_HEIGHT_PX,
  paddingPx: number = 80,
): Viewport {
  if (!bounds) {
    return createCenteredViewport(width, height);
  }

  const contentWidth = Math.max(bounds.maxX - bounds.minX, 2_540_000);
  const contentHeight = Math.max(bounds.maxY - bounds.minY, 2_540_000);
  const usableWidth = Math.max(width - paddingPx * 2, 1);
  const usableHeight = Math.max(height - paddingPx * 2, 1);
  const zoom = clampViewportZoom(
    Math.min(usableWidth / contentWidth, usableHeight / contentHeight),
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  return {
    offsetX: width / 2 - centerX * zoom,
    offsetY: height / 2 - centerY * zoom,
    zoom,
  };
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
