import type { Point2D, PcbViewport } from "../pcb-types";

export const DEFAULT_PCB_ZOOM = 5;
export const MIN_PCB_ZOOM = 0.1;
export const MAX_PCB_ZOOM = 50;
export const DEFAULT_PCB_VIEWPORT_WIDTH = 800;
export const DEFAULT_PCB_VIEWPORT_HEIGHT = 600;

export function clampPcbZoom(zoom: number): number {
  return Math.max(MIN_PCB_ZOOM, Math.min(MAX_PCB_ZOOM, zoom));
}

export function createCenteredPcbViewport(
  width: number = DEFAULT_PCB_VIEWPORT_WIDTH,
  height: number = DEFAULT_PCB_VIEWPORT_HEIGHT,
  zoom: number = DEFAULT_PCB_ZOOM,
): PcbViewport {
  return {
    offsetX: width / 2,
    offsetY: height / 2,
    zoom: clampPcbZoom(zoom),
  };
}

export function fitPcbViewportToBounds(
  boardWidth: number,
  boardHeight: number,
  canvasWidth: number = DEFAULT_PCB_VIEWPORT_WIDTH,
  canvasHeight: number = DEFAULT_PCB_VIEWPORT_HEIGHT,
  paddingPx: number = 40,
): PcbViewport {
  const usableWidth = Math.max(canvasWidth - paddingPx * 2, 1);
  const usableHeight = Math.max(canvasHeight - paddingPx * 2, 1);
  const zoom = clampPcbZoom(
    Math.min(usableWidth / boardWidth, usableHeight / boardHeight),
  );
  const centerX = boardWidth / 2;
  const centerY = boardHeight / 2;

  return {
    offsetX: canvasWidth / 2 - centerX * zoom,
    offsetY: canvasHeight / 2 - centerY * zoom,
    zoom,
  };
}

export function screenToPcb(
  screenX: number,
  screenY: number,
  viewport: PcbViewport,
): Point2D {
  return {
    x: (screenX - viewport.offsetX) / viewport.zoom,
    y: (screenY - viewport.offsetY) / viewport.zoom,
  };
}

export function pcbToScreen(
  pcbX: number,
  pcbY: number,
  viewport: PcbViewport,
): Point2D {
  return {
    x: pcbX * viewport.zoom + viewport.offsetX,
    y: pcbY * viewport.zoom + viewport.offsetY,
  };
}

export function snapToGrid(point: Point2D, gridSize: number): Point2D {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

export function domEventToScreen(
  clientX: number,
  clientY: number,
  canvasBounds: { left: number; top: number },
): Point2D {
  return {
    x: clientX - canvasBounds.left,
    y: clientY - canvasBounds.top,
  };
}
