/**
 * Footprint Editor Viewport Utilities
 *
 * Coordinate transformations between millimeters (internal) and pixels (screen).
 * Convention: Y-axis points UP in footprint space (standard PCB convention).
 */

import type { Viewport, Point, Millimeters } from "./types";

/** Pixels per millimeter at zoom level 1 */
const PIXELS_PER_MM = 50;

/**
 * Convert footprint coordinates (mm) to screen coordinates (pixels).
 * Footprint space: Y-up, origin at center.
 * Screen space: Y-down, origin at top-left.
 */
export function footprintToScreen(
  x: Millimeters,
  y: Millimeters,
  viewport: Viewport,
): { x: number; y: number } {
  const px = x * PIXELS_PER_MM * viewport.zoom + viewport.offsetX;
  const py = -y * PIXELS_PER_MM * viewport.zoom + viewport.offsetY;
  return { x: px, y: py };
}

/**
 * Convert screen coordinates (pixels) to footprint coordinates (mm).
 */
export function screenToFootprint(
  screenX: number,
  screenY: number,
  viewport: Viewport,
): Point {
  const x = (screenX - viewport.offsetX) / (PIXELS_PER_MM * viewport.zoom);
  const y = (viewport.offsetY - screenY) / (PIXELS_PER_MM * viewport.zoom);
  return { x, y };
}

/**
 * Convert DOM event coordinates to screen coordinates.
 */
export function domEventToScreen(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): { x: number; y: number } {
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

/**
 * Snap a point to the nearest grid intersection.
 */
export function snapToGrid(point: Point, gridSize: Millimeters): Point {
  if (gridSize <= 0) return point;
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

/**
 * Create a viewport centered on the origin (0, 0).
 */
export function createCenteredViewport(
  canvasWidth: number,
  canvasHeight: number,
  zoom = 1,
): Viewport {
  return {
    offsetX: canvasWidth / 2,
    offsetY: canvasHeight / 2,
    zoom,
  };
}

/**
 * Calculate the visible bounds in footprint coordinates.
 */
export function getVisibleFootprintBounds(
  canvasWidth: number,
  canvasHeight: number,
  viewport: Viewport,
): { minX: Millimeters; minY: Millimeters; maxX: Millimeters; maxY: Millimeters } {
  const topLeft = screenToFootprint(0, 0, viewport);
  const bottomRight = screenToFootprint(canvasWidth, canvasHeight, viewport);
  return {
    minX: Math.min(topLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, bottomRight.y),
    maxX: Math.max(topLeft.x, bottomRight.x),
    maxY: Math.max(topLeft.y, bottomRight.y),
  };
}

/**
 * Convert millimeters to pixels at current zoom.
 */
export function mmToPixels(mm: Millimeters, zoom: number): number {
  return mm * PIXELS_PER_MM * zoom;
}

/**
 * Convert pixels to millimeters at current zoom.
 */
export function pixelsToMm(pixels: number, zoom: number): Millimeters {
  return pixels / (PIXELS_PER_MM * zoom);
}

/**
 * Calculate the bounding box of a set of points.
 */
export function getBoundsOfPoints(points: Point[]): { minX: Millimeters; minY: Millimeters; maxX: Millimeters; maxY: Millimeters } | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Get the bounding box of a pad (including rotation).
 */
export function getPadBounds(
  pad: { position: Point; size: { width: Millimeters; height: Millimeters }; rotation: number }
): { minX: Millimeters; minY: Millimeters; maxX: Millimeters; maxY: Millimeters } {
  const { position, size, rotation } = pad;
  const hw = size.width / 2;
  const hh = size.height / 2;
  
  if (rotation === 0 || size.width === size.height) {
    return {
      minX: position.x - hw,
      minY: position.y - hh,
      maxX: position.x + hw,
      maxY: position.y + hh,
    };
  }
  
  // Rotated rectangle bounds
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const rotatedHw = hw * cos + hh * sin;
  const rotatedHh = hw * sin + hh * cos;
  
  return {
    minX: position.x - rotatedHw,
    minY: position.y - rotatedHh,
    maxX: position.x + rotatedHw,
    maxY: position.y + rotatedHh,
  };
}

/**
 * Check if a screen point is near a footprint point (within threshold pixels).
 */
export function isNearPoint(
  screenX: number,
  screenY: number,
  targetX: Millimeters,
  targetY: Millimeters,
  viewport: Viewport,
  thresholdPixels = 10,
): boolean {
  const targetScreen = footprintToScreen(targetX, targetY, viewport);
  const dx = screenX - targetScreen.x;
  const dy = screenY - targetScreen.y;
  return Math.sqrt(dx * dx + dy * dy) <= thresholdPixels;
}