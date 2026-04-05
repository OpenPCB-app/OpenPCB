/**
 * Canvas Core — Grid Renderer
 *
 * Shared grid rendering supporting dots, lines, and cross styles.
 * Works with the canonical Y-down viewport from ./viewport.ts.
 */

import type { GridColors, GridStyle, Viewport } from "./types";
import { worldToScreen, screenToWorld } from "./viewport";

// ---------------------------------------------------------------------------
// Bounds helpers
// ---------------------------------------------------------------------------

interface VisibleBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function getVisibleBounds(
  width: number,
  height: number,
  viewport: Viewport,
): VisibleBounds {
  const topLeft = screenToWorld(0, 0, viewport);
  const bottomRight = screenToWorld(width, height, viewport);
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
  };
}

function snapBounds(bounds: VisibleBounds, gridSize: number): VisibleBounds {
  return {
    left: Math.floor(bounds.left / gridSize) * gridSize,
    top: Math.floor(bounds.top / gridSize) * gridSize,
    right: Math.ceil(bounds.right / gridSize) * gridSize,
    bottom: Math.ceil(bounds.bottom / gridSize) * gridSize,
  };
}

// ---------------------------------------------------------------------------
// Public helpers (re-exported for consumers that need them)
// ---------------------------------------------------------------------------

export function getGridPixelSpacing(
  gridSizeNm: number,
  viewport: Viewport,
): number {
  return gridSizeNm * viewport.zoom;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const DEFAULT_COLORS: GridColors = {
  dot: "rgba(148, 163, 184, 0.35)",
  dotFaint: "rgba(148, 163, 184, 0.2)",
  majorLine: "rgba(148, 163, 184, 0.1)",
  originCross: "rgba(148, 163, 184, 0.4)",
};

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  gridSize: number,
  style: GridStyle = "dots",
  colors?: GridColors,
): void {
  if (gridSize <= 0) {
    throw new RangeError("gridSize must be greater than 0");
  }

  const c = colors ?? DEFAULT_COLORS;
  const gridPx = getGridPixelSpacing(gridSize, viewport);
  if (gridPx < 2) return;

  const bounds = snapBounds(
    getVisibleBounds(width, height, viewport),
    gridSize,
  );

  switch (style) {
    case "dots":
      renderDotGrid(ctx, bounds, viewport, gridSize, gridPx, width, height, c);
      break;
    case "lines":
      renderLineGrid(ctx, bounds, viewport, gridSize, gridPx, width, height, c);
      break;
    case "cross":
      renderCrossGrid(ctx, bounds, viewport, gridSize, gridPx, c);
      break;
  }

  // Origin crosshair (always rendered)
  const { offsetX, offsetY } = viewport;
  if (
    offsetX >= -10 &&
    offsetX <= width + 10 &&
    offsetY >= -10 &&
    offsetY <= height + 10
  ) {
    ctx.strokeStyle = c.originCross;
    ctx.lineWidth = 1;
    const crossSize = 12;
    ctx.beginPath();
    ctx.moveTo(offsetX - crossSize, offsetY);
    ctx.lineTo(offsetX + crossSize, offsetY);
    ctx.moveTo(offsetX, offsetY - crossSize);
    ctx.lineTo(offsetX, offsetY + crossSize);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Style implementations
// ---------------------------------------------------------------------------

function renderDotGrid(
  ctx: CanvasRenderingContext2D,
  bounds: VisibleBounds,
  viewport: Viewport,
  gridSize: number,
  gridPx: number,
  width: number,
  height: number,
  colors: GridColors,
): void {
  const dotRadius = Math.max(0.5, viewport.zoom * 0.25);
  ctx.fillStyle = gridPx > 15 ? colors.dot : colors.dotFaint;

  for (let x = bounds.left; x <= bounds.right; x += gridSize) {
    for (let y = bounds.top; y <= bounds.bottom; y += gridSize) {
      const screen = worldToScreen(x, y, viewport);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Major grid lines (subtle, every 5 units)
  const majorGridSize = gridSize * 5;
  const majorGridPx = getGridPixelSpacing(majorGridSize, viewport);

  if (majorGridPx > 30) {
    const majorBounds = snapBounds(
      getVisibleBounds(width, height, viewport),
      majorGridSize,
    );

    ctx.strokeStyle = colors.majorLine;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = majorBounds.left; x <= majorBounds.right; x += majorGridSize) {
      const screen = worldToScreen(x, 0, viewport);
      ctx.moveTo(screen.x, 0);
      ctx.lineTo(screen.x, height);
    }

    for (let y = majorBounds.top; y <= majorBounds.bottom; y += majorGridSize) {
      const screen = worldToScreen(0, y, viewport);
      ctx.moveTo(0, screen.y);
      ctx.lineTo(width, screen.y);
    }

    ctx.stroke();
  }
}

function renderLineGrid(
  ctx: CanvasRenderingContext2D,
  bounds: VisibleBounds,
  viewport: Viewport,
  gridSize: number,
  gridPx: number,
  width: number,
  height: number,
  colors: GridColors,
): void {
  ctx.strokeStyle = gridPx > 10 ? colors.dot : colors.dotFaint;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let x = bounds.left; x <= bounds.right; x += gridSize) {
    const screen = worldToScreen(x, 0, viewport);
    ctx.moveTo(screen.x, 0);
    ctx.lineTo(screen.x, height);
  }

  for (let y = bounds.top; y <= bounds.bottom; y += gridSize) {
    const screen = worldToScreen(0, y, viewport);
    ctx.moveTo(0, screen.y);
    ctx.lineTo(width, screen.y);
  }

  ctx.stroke();

  // Major grid lines (every 5 units)
  const majorGridSize = gridSize * 5;
  const majorGridPx = getGridPixelSpacing(majorGridSize, viewport);

  if (majorGridPx > 25) {
    const majorBounds = snapBounds(
      getVisibleBounds(width, height, viewport),
      majorGridSize,
    );

    ctx.strokeStyle = colors.originCross;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = majorBounds.left; x <= majorBounds.right; x += majorGridSize) {
      const screen = worldToScreen(x, 0, viewport);
      ctx.moveTo(screen.x, 0);
      ctx.lineTo(screen.x, height);
    }

    for (let y = majorBounds.top; y <= majorBounds.bottom; y += majorGridSize) {
      const screen = worldToScreen(0, y, viewport);
      ctx.moveTo(0, screen.y);
      ctx.lineTo(width, screen.y);
    }

    ctx.stroke();
  }
}

function renderCrossGrid(
  ctx: CanvasRenderingContext2D,
  bounds: VisibleBounds,
  viewport: Viewport,
  gridSize: number,
  gridPx: number,
  colors: GridColors,
): void {
  const crossSize = Math.max(3, gridPx * 0.3);
  ctx.strokeStyle = gridPx > 10 ? colors.dot : colors.dotFaint;
  ctx.lineWidth = 1;

  for (let x = bounds.left; x <= bounds.right; x += gridSize) {
    for (let y = bounds.top; y <= bounds.bottom; y += gridSize) {
      const screen = worldToScreen(x, y, viewport);
      ctx.beginPath();
      ctx.moveTo(screen.x - crossSize, screen.y);
      ctx.lineTo(screen.x + crossSize, screen.y);
      ctx.moveTo(screen.x, screen.y - crossSize);
      ctx.lineTo(screen.x, screen.y + crossSize);
      ctx.stroke();
    }
  }
}
