/**
 * Symbol Editor Viewport Utilities
 *
 * Coordinate transforms and snapping for the symbol editor canvas.
 * Similar to schematic editor viewport but tuned for symbol authoring.
 */

import type { Point, Viewport, Nanometers, Bounds } from "./types";
import { MIN_ZOOM, MAX_ZOOM } from "./types";

// ---------------------------------------------------------------------------
// Coordinate Transforms
// ---------------------------------------------------------------------------

/**
 * Convert symbol-local coordinates (nanometers) to screen coordinates (pixels).
 */
export function symbolToScreen(
  x: Nanometers,
  y: Nanometers,
  viewport: Viewport,
): Point {
  // Scale factor: pixels per nanometer
  const scale = viewport.zoom / 1_000_000; // 1 zoom = 1 pixel per mm
  return {
    x: x * scale + viewport.offsetX,
    y: -y * scale + viewport.offsetY, // Flip Y: positive Y is up in symbol space
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
  return {
    x: (screenX - viewport.offsetX) / scale,
    y: -(screenY - viewport.offsetY) / scale, // Flip Y
  };
}

/**
 * Convert DOM event coordinates to screen-relative coordinates.
 */
export function domEventToScreen(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
): Point {
  return {
    x: clientX - canvasRect.left,
    y: clientY - canvasRect.top,
  };
}

// ---------------------------------------------------------------------------
// Grid Snapping
// ---------------------------------------------------------------------------

/**
 * Snap a point to the nearest grid intersection.
 */
export function snapToGrid(point: Point, gridSize: Nanometers): Point {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

/**
 * Snap a single value to the nearest grid line.
 */
export function snapValueToGrid(
  value: Nanometers,
  gridSize: Nanometers,
): Nanometers {
  return Math.round(value / gridSize) * gridSize;
}

// ---------------------------------------------------------------------------
// Viewport Utilities
// ---------------------------------------------------------------------------

/**
 * Clamp zoom to valid range.
 */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Default zoom level for symbol editor.
 * With scale = zoom/1_000_000, a zoom of 50 gives 50 pixels per mm.
 */
const DEFAULT_SYMBOL_ZOOM = 50;

/**
 * Create a viewport centered on the origin.
 */
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

/**
 * Fit viewport to show given bounds with padding.
 */
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

  // Calculate zoom to fit bounds with padding
  const availableWidth = canvasWidth - padding * 2;
  const availableHeight = canvasHeight - padding * 2;

  const scaleX =
    boundsWidth > 0 ? availableWidth / (boundsWidth / 1_000_000) : Infinity;
  const scaleY =
    boundsHeight > 0 ? availableHeight / (boundsHeight / 1_000_000) : Infinity;
  const minZ = zoomLimits?.min ?? MIN_ZOOM;
  const maxZ = zoomLimits?.max ?? MAX_ZOOM;
  const zoom = Math.min(maxZ, Math.max(minZ, Math.min(scaleX, scaleY)));

  // Center on bounds
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  const scale = zoom / 1_000_000;
  return {
    offsetX: canvasWidth / 2 - centerX * scale,
    offsetY: canvasHeight / 2 + centerY * scale, // Flip Y
    zoom,
  };
}

// ---------------------------------------------------------------------------
// Bounds Utilities
// ---------------------------------------------------------------------------

/**
 * Check if a point is inside bounds (in symbol coordinates).
 */
export function pointInBounds(point: Point, bounds: Bounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * Expand bounds to include a point.
 */
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

/**
 * Merge two bounds.
 */
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

/**
 * Add padding to bounds.
 */
export function padBounds(bounds: Bounds, padding: Nanometers): Bounds {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}
