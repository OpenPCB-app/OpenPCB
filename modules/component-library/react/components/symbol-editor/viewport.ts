import type { Point, Viewport, Nanometers, Bounds } from "./types";
import { MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM } from "./types";
import { snapPointToGridNm } from "@/lib/render-engine/coords";

export type CanvasBounds = Pick<DOMRect, "left" | "top">;

// ---------------------------------------------------------------------------
// Coordinate Transforms (Y-flipped, zoom in px/mm)
// ---------------------------------------------------------------------------

/**
 * Convert symbol-local coordinates (nanometers) to screen coordinates (pixels).
 */
export function symbolToScreen(
  x: Nanometers,
  y: Nanometers,
  viewport: Viewport,
): Point {
  const scale = viewport.zoom / 1_000_000;
  return {
    x: x * scale + viewport.offsetX,
    y: -y * scale + viewport.offsetY,
  };
}

/**
 * Convert screen coordinates (pixels) to symbol-local coordinates (nanometers).
 */
export function screenToSymbol(
  screenX: number,
  screenY: number,
  viewport: Viewport,
): Point {
  const scale = viewport.zoom / 1_000_000;
  if (scale === 0 || !Number.isFinite(scale)) {
    return { x: 0, y: 0 };
  }
  return {
    x: (screenX - viewport.offsetX) / scale,
    y: -(screenY - viewport.offsetY) / scale,
  };
}

/**
 * Convert DOM event coordinates to screen-relative coordinates.
 */
export function domEventToScreen(
  clientX: number,
  clientY: number,
  canvasRect: CanvasBounds,
): Point {
  return {
    x: clientX - canvasRect.left,
    y: clientY - canvasRect.top,
  };
}

// ---------------------------------------------------------------------------
// Grid Snapping (delegates to core)
// ---------------------------------------------------------------------------

export function snapToGrid(point: Point, gridSize: Nanometers): Point {
  return snapPointToGridNm(point, gridSize);
}

export function snapValueToGrid(
  value: Nanometers,
  gridSize: Nanometers,
): Nanometers {
  return Math.round(value / gridSize) * gridSize;
}

// ---------------------------------------------------------------------------
// Viewport Utilities
// ---------------------------------------------------------------------------

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

const DEFAULT_SYMBOL_ZOOM = DEFAULT_ZOOM;

export function createCenteredViewport(
  canvasWidth: number,
  canvasHeight: number,
  zoom = DEFAULT_SYMBOL_ZOOM,
): Viewport {
  return {
    offsetX: canvasWidth / 2,
    offsetY: canvasHeight / 2,
    zoom: clampZoom(zoom),
  };
}

export function fitViewportToBounds(
  bounds: Bounds | null,
  canvasWidth: number,
  canvasHeight: number,
  padding = 50,
  zoomLimits?: { min?: number; max?: number },
): Viewport {
  if (!bounds) {
    return createCenteredViewport(canvasWidth, canvasHeight);
  }

  const boundsWidth = bounds.maxX - bounds.minX;
  const boundsHeight = bounds.maxY - bounds.minY;

  if (boundsWidth === 0 && boundsHeight === 0) {
    return createCenteredViewport(canvasWidth, canvasHeight);
  }

  const availableWidth = canvasWidth - padding * 2;
  const availableHeight = canvasHeight - padding * 2;

  const scaleX =
    boundsWidth > 0 ? availableWidth / (boundsWidth / 1_000_000) : Infinity;
  const scaleY =
    boundsHeight > 0 ? availableHeight / (boundsHeight / 1_000_000) : Infinity;
  const minZ = zoomLimits?.min ?? MIN_ZOOM;
  const maxZ = zoomLimits?.max ?? MAX_ZOOM;
  const zoom = Math.min(maxZ, Math.max(minZ, Math.min(scaleX, scaleY)));

  if (!Number.isFinite(zoom) || zoom === 0) {
    return createCenteredViewport(canvasWidth, canvasHeight);
  }

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  const scale = zoom / 1_000_000;
  return {
    offsetX: canvasWidth / 2 - centerX * scale,
    offsetY: canvasHeight / 2 + centerY * scale,
    zoom,
  };
}

// ---------------------------------------------------------------------------
// Bounds Utilities
// ---------------------------------------------------------------------------

export function pointInBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

export function expandBoundsWithPoint(
  bounds: Bounds | null,
  point: Point,
): Bounds {
  if (!bounds) {
    return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
  }
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

export function mergeBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function padBounds(bounds: Bounds, padding: Nanometers): Bounds {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}
