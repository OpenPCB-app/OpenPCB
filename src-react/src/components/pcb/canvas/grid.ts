import type { Viewport } from "../types";
import { screenToWorld, worldToScreen } from "./viewport";

export type GridStyle = "dots" | "lines" | "cross";

export interface GridColors {
  dot: string;
  dotFaint: string;
  intermediateLine: string;
  majorLine: string;
  originCross: string;
}

const DEFAULT_COLORS: GridColors = {
  dot: "rgba(148, 163, 184, 0.12)",
  dotFaint: "rgba(148, 163, 184, 0.06)",
  intermediateLine: "rgba(148, 163, 184, 0.18)",
  majorLine: "rgba(148, 163, 184, 0.28)",
  originCross: "rgba(148, 163, 184, 0.4)",
};

export interface SchematicBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function getGridPixelSpacing(
  gridSizeNm: number,
  viewport: Viewport,
): number {
  return gridSizeNm * viewport.zoom;
}

export function getVisibleSchematicBounds(
  width: number,
  height: number,
  viewport: Viewport,
): SchematicBounds {
  const topLeft = screenToWorld(0, 0, viewport);
  const bottomRight = screenToWorld(width, height, viewport);
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
  };
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
  colors?: GridColors,
): void {
  if (gridSize <= 0) {
    throw new RangeError("gridSize must be greater than 0");
  }

  const palette = colors ?? DEFAULT_COLORS;
  const gridPx = getGridPixelSpacing(gridSize, viewport);
  if (gridPx < 2) {
    return;
  }

  const bounds = getSnappedGridBounds(
    getVisibleSchematicBounds(width, height, viewport),
    gridSize,
  );

  switch (style) {
    case "dots":
      renderDotGrid(
        ctx,
        bounds,
        viewport,
        gridSize,
        gridPx,
        width,
        height,
        palette,
      );
      break;
    case "lines":
      renderLineGrid(
        ctx,
        bounds,
        viewport,
        gridSize,
        gridPx,
        width,
        height,
        palette,
      );
      break;
    case "cross":
      renderCrossGrid(ctx, bounds, viewport, gridSize, gridPx, palette);
      break;
  }

  const { offsetX, offsetY } = viewport;
  if (
    offsetX >= -10 &&
    offsetX <= width + 10 &&
    offsetY >= -10 &&
    offsetY <= height + 10
  ) {
    ctx.strokeStyle = palette.originCross;
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

function renderDotGrid(
  ctx: CanvasRenderingContext2D,
  bounds: SchematicBounds,
  viewport: Viewport,
  gridSize: number,
  gridPx: number,
  width: number,
  height: number,
  colors: GridColors,
) {
  const dotRadius = Math.max(0.5, viewport.zoom * 0.2);
  ctx.fillStyle = gridPx > 15 ? colors.dot : colors.dotFaint;

  for (let x = bounds.left; x <= bounds.right; x += gridSize) {
    for (let y = bounds.top; y <= bounds.bottom; y += gridSize) {
      const screen = worldToScreen(x, y, viewport);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const intermediateGridSize = gridSize * 5;
  const majorGridSize = gridSize * 10;
  const intermediateGridPx = getGridPixelSpacing(
    intermediateGridSize,
    viewport,
  );
  const majorGridPx = getGridPixelSpacing(majorGridSize, viewport);

  if (intermediateGridPx > 20) {
    const intermediateBounds = getSnappedGridBounds(
      getVisibleSchematicBounds(width, height, viewport),
      intermediateGridSize,
    );

    ctx.strokeStyle = colors.intermediateLine;
    ctx.lineWidth = 0.5;
    ctx.beginPath();

    for (
      let x = intermediateBounds.left;
      x <= intermediateBounds.right;
      x += intermediateGridSize
    ) {
      if (x % majorGridSize === 0) continue;
      const screen = worldToScreen(x, 0, viewport);
      ctx.moveTo(screen.x, 0);
      ctx.lineTo(screen.x, height);
    }

    for (
      let y = intermediateBounds.top;
      y <= intermediateBounds.bottom;
      y += intermediateGridSize
    ) {
      if (y % majorGridSize === 0) continue;
      const screen = worldToScreen(0, y, viewport);
      ctx.moveTo(0, screen.y);
      ctx.lineTo(width, screen.y);
    }

    ctx.stroke();
  }

  if (majorGridPx > 30) {
    const majorBounds = getSnappedGridBounds(
      getVisibleSchematicBounds(width, height, viewport),
      majorGridSize,
    );

    ctx.strokeStyle = colors.majorLine;
    ctx.lineWidth = 0.5;
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
  bounds: SchematicBounds,
  viewport: Viewport,
  gridSize: number,
  gridPx: number,
  width: number,
  height: number,
  colors: GridColors,
) {
  const intermediateGridSize = gridSize * 5;
  const majorGridSize = gridSize * 10;
  const intermediateGridPx = getGridPixelSpacing(
    intermediateGridSize,
    viewport,
  );
  const majorGridPx = getGridPixelSpacing(majorGridSize, viewport);

  ctx.strokeStyle = gridPx > 10 ? colors.dot : colors.dotFaint;
  ctx.lineWidth = 0.5;
  ctx.beginPath();

  for (let x = bounds.left; x <= bounds.right; x += gridSize) {
    if (x % intermediateGridSize === 0) continue;
    const screen = worldToScreen(x, 0, viewport);
    ctx.moveTo(screen.x, 0);
    ctx.lineTo(screen.x, height);
  }

  for (let y = bounds.top; y <= bounds.bottom; y += gridSize) {
    if (y % intermediateGridSize === 0) continue;
    const screen = worldToScreen(0, y, viewport);
    ctx.moveTo(0, screen.y);
    ctx.lineTo(width, screen.y);
  }

  ctx.stroke();

  if (intermediateGridPx > 15) {
    const intermediateBounds = getSnappedGridBounds(
      getVisibleSchematicBounds(width, height, viewport),
      intermediateGridSize,
    );

    ctx.strokeStyle = colors.intermediateLine;
    ctx.lineWidth = 0.5;
    ctx.beginPath();

    for (
      let x = intermediateBounds.left;
      x <= intermediateBounds.right;
      x += intermediateGridSize
    ) {
      if (x % majorGridSize === 0) continue;
      const screen = worldToScreen(x, 0, viewport);
      ctx.moveTo(screen.x, 0);
      ctx.lineTo(screen.x, height);
    }

    for (
      let y = intermediateBounds.top;
      y <= intermediateBounds.bottom;
      y += intermediateGridSize
    ) {
      if (y % majorGridSize === 0) continue;
      const screen = worldToScreen(0, y, viewport);
      ctx.moveTo(0, screen.y);
      ctx.lineTo(width, screen.y);
    }

    ctx.stroke();
  }

  if (majorGridPx > 25) {
    const majorBounds = getSnappedGridBounds(
      getVisibleSchematicBounds(width, height, viewport),
      majorGridSize,
    );

    ctx.strokeStyle = colors.majorLine;
    ctx.lineWidth = 0.5;
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
  bounds: SchematicBounds,
  viewport: Viewport,
  gridSize: number,
  gridPx: number,
  colors: GridColors,
) {
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
