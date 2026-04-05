/**
 * Schematic Canvas Viewport
 *
 * Re-exports shared canvas-core viewport utilities with schematic-specific aliases.
 */

import type { Bounds, Point, Viewport } from "../types";
import {
  worldToScreen,
  screenToWorld,
  domEventToScreen as coreDomEventToScreen,
  clampZoom as coreClampZoom,
  snapToGrid as coreSnapToGrid,
  createCenteredViewport as coreCreateCenteredViewport,
  fitViewportToBounds as coreFitViewportToBounds,
  isWithinRoundTripTolerance as coreIsWithinRoundTripTolerance,
  nmToMm as coreNmToMm,
  mmToNm as coreMmToNm,
  MIN_VIEWPORT_ZOOM,
  MAX_VIEWPORT_ZOOM,
  DEFAULT_SCHEMATIC_ZOOM,
  DEFAULT_VIEWPORT_WIDTH_PX,
  DEFAULT_VIEWPORT_HEIGHT_PX,
  ROUND_TRIP_TOLERANCE_NM,
} from "@/lib/canvas-core";
import type { CanvasBounds } from "@/lib/canvas-core";

// Re-export constants
export {
  MIN_VIEWPORT_ZOOM,
  MAX_VIEWPORT_ZOOM,
  DEFAULT_SCHEMATIC_ZOOM,
  DEFAULT_VIEWPORT_WIDTH_PX,
  DEFAULT_VIEWPORT_HEIGHT_PX,
};

export const SCHEMATIC_ROUND_TRIP_TOLERANCE_NM = ROUND_TRIP_TOLERANCE_NM;

export type { CanvasBounds };

// Re-export with schematic-specific names (backward compat)
export function domEventToScreen(
  clientX: number,
  clientY: number,
  canvasBounds: CanvasBounds,
): Point {
  return coreDomEventToScreen(clientX, clientY, canvasBounds);
}

export function canvasToScreen(canvasX: number, canvasY: number): Point {
  return { x: canvasX, y: canvasY };
}

export function clampViewportZoom(zoom: number): number {
  return coreClampZoom(zoom);
}

export function createCenteredViewport(
  width: number = DEFAULT_VIEWPORT_WIDTH_PX,
  height: number = DEFAULT_VIEWPORT_HEIGHT_PX,
  zoom: number = DEFAULT_SCHEMATIC_ZOOM,
): Viewport {
  return coreCreateCenteredViewport(width, height, zoom);
}

export function fitViewportToBounds(
  bounds: Bounds | null,
  width: number = DEFAULT_VIEWPORT_WIDTH_PX,
  height: number = DEFAULT_VIEWPORT_HEIGHT_PX,
  paddingPx: number = 80,
): Viewport {
  return coreFitViewportToBounds(bounds, width, height, paddingPx);
}

export function screenToSchematic(
  screenX: number,
  screenY: number,
  viewport: Viewport,
): Point {
  return screenToWorld(screenX, screenY, viewport);
}

export function schematicToScreen(
  schematicX: number,
  schematicY: number,
  viewport: Viewport,
): Point {
  return worldToScreen(schematicX, schematicY, viewport);
}

export function nmToMm(nm: number): number {
  return coreNmToMm(nm);
}

export function mmToNm(mm: number): number {
  return coreMmToNm(mm);
}

export function snapToGrid(point: Point, gridSize: number): Point {
  return coreSnapToGrid(point, gridSize);
}

export function isWithinRoundTripTolerance(
  actual: Point,
  expected: Point,
  toleranceNm: number = SCHEMATIC_ROUND_TRIP_TOLERANCE_NM,
): boolean {
  return coreIsWithinRoundTripTolerance(actual, expected, toleranceNm);
}
