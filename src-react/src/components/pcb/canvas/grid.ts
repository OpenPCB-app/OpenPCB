import type { GridStyle, Viewport } from "../types";
import { schematicToScreen, screenToSchematic } from "./viewport";

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
  const topLeft = screenToSchematic(0, 0, viewport);
  const bottomRight = screenToSchematic(width, height, viewport);

  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
  };
}

export function getGridPixelSpacing(
  gridSizeNm: number,
  viewport: Viewport,
): number {
  return gridSizeNm * viewport.zoom;
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

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  gridSize: number,
  style: GridStyle = "dots",
): void {
  if (gridSize <= 0) {
    throw new RangeError("gridSize must be greater than 0");
  }

  const { offsetX, offsetY } = viewport;

  const gridPx = getGridPixelSpacing(gridSize, viewport);
  if (gridPx < 2) return;

  const bounds = getSnappedGridBounds(
    getVisibleSchematicBounds(width, height, viewport),
    gridSize,
  );

  // Render based on style
  switch (style) {
    case "dots":
      renderDotGrid(ctx, bounds, viewport, gridSize, gridPx, width, height);
      break;
    case "lines":
      renderLineGrid(ctx, bounds, viewport, gridSize, gridPx, width, height);
      break;
    case "cross":
      renderCrossGrid(ctx, bounds, viewport, gridSize, gridPx, width, height);
      break;
  }

  // Origin crosshair (always rendered)
  const ox = offsetX;
  const oy = offsetY;
  if (ox >= -10 && ox <= width + 10 && oy >= -10 && oy <= height + 10) {
    ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
    ctx.lineWidth = 1;
    const crossSize = 12;
    ctx.beginPath();
    ctx.moveTo(ox - crossSize, oy);
    ctx.lineTo(ox + crossSize, oy);
    ctx.moveTo(ox, oy - crossSize);
    ctx.lineTo(ox, oy + crossSize);
    ctx.stroke();
  }
}

function renderDotGrid(
  ctx: CanvasRenderingContext2D,
  bounds: SchematicBounds,
  viewport: Viewport,
  gridSize: number,
  gridPx: number,
  width: number,
  height: number,
): void {
  const dotRadius = Math.max(0.5, viewport.zoom * 0.25);

  ctx.fillStyle =
    gridPx > 15 ? "rgba(148, 163, 184, 0.35)" : "rgba(148, 163, 184, 0.2)";

  for (let x = bounds.left; x <= bounds.right; x += gridSize) {
    for (let y = bounds.top; y <= bounds.bottom; y += gridSize) {
      const screen = schematicToScreen(x, y, viewport);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Major grid lines for dot style (subtle)
  const majorGridSize = gridSize * 5;
  const majorGridPx = getGridPixelSpacing(majorGridSize, viewport);

  if (majorGridPx > 30) {
    const majorBounds = getSnappedGridBounds(
      getVisibleSchematicBounds(width, height, viewport),
      majorGridSize,
    );

    ctx.strokeStyle = "rgba(148, 163, 184, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = majorBounds.left; x <= majorBounds.right; x += majorGridSize) {
      const screen = schematicToScreen(x, 0, viewport);
      ctx.moveTo(screen.x, 0);
      ctx.lineTo(screen.x, height);
    }

    for (let y = majorBounds.top; y <= majorBounds.bottom; y += majorGridSize) {
      const screen = schematicToScreen(0, y, viewport);
      ctx.moveTo(0, screen.y);
      ctx.lineTo(width, screen.y);
    }

    ctx.stroke();
  }
}

function renderLineGrid(
  ctx: CanvasRenderingContext2D,
  bounds: SchematicBounds,
  viewport: Viewport,
  gridSize: number,
  gridPx: number,
  width: number,
  height: number,
): void {
  // Primary grid lines
  ctx.strokeStyle =
    gridPx > 10 ? "rgba(148, 163, 184, 0.25)" : "rgba(148, 163, 184, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let x = bounds.left; x <= bounds.right; x += gridSize) {
    const screen = schematicToScreen(x, 0, viewport);
    ctx.moveTo(screen.x, 0);
    ctx.lineTo(screen.x, height);
  }

  for (let y = bounds.top; y <= bounds.bottom; y += gridSize) {
    const screen = schematicToScreen(0, y, viewport);
    ctx.moveTo(0, screen.y);
    ctx.lineTo(width, screen.y);
  }

  ctx.stroke();

  // Major grid lines (every 5 units)
  const majorGridSize = gridSize * 5;
  const majorGridPx = getGridPixelSpacing(majorGridSize, viewport);

  if (majorGridPx > 25) {
    const majorBounds = getSnappedGridBounds(
      getVisibleSchematicBounds(width, height, viewport),
      majorGridSize,
    );

    ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = majorBounds.left; x <= majorBounds.right; x += majorGridSize) {
      const screen = schematicToScreen(x, 0, viewport);
      ctx.moveTo(screen.x, 0);
      ctx.lineTo(screen.x, height);
    }

    for (let y = majorBounds.top; y <= majorBounds.bottom; y += majorGridSize) {
      const screen = schematicToScreen(0, y, viewport);
      ctx.moveTo(0, screen.y);
      ctx.lineTo(width, screen.y);
    }

    ctx.stroke();
  }
}

function renderCrossGrid(
  ctx: CanvasRenderingContext2D,
  bounds: SchematicBounds,
  viewport: Viewport,
  gridSize: number,
  gridPx: number,
  _width: number,
  _height: number,
): void {
  const crossSize = Math.max(3, gridPx * 0.3);

  ctx.strokeStyle =
    gridPx > 10 ? "rgba(148, 163, 184, 0.4)" : "rgba(148, 163, 184, 0.25)";
  ctx.lineWidth = 1;

  for (let x = bounds.left; x <= bounds.right; x += gridSize) {
    for (let y = bounds.top; y <= bounds.bottom; y += gridSize) {
      const screen = schematicToScreen(x, y, viewport);
      ctx.beginPath();
      ctx.moveTo(screen.x - crossSize, screen.y);
      ctx.lineTo(screen.x + crossSize, screen.y);
      ctx.moveTo(screen.x, screen.y - crossSize);
      ctx.lineTo(screen.x, screen.y + crossSize);
      ctx.stroke();
    }
  }
}
