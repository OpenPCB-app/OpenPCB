import type { Viewport } from "../types";

/** Render the schematic grid on a Canvas2D context */
export function renderGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  gridSize: number,
): void {
  const { offsetX, offsetY, zoom } = viewport;

  // Grid spacing in pixels
  const gridPx = gridSize * zoom;

  // Don't draw grid if too small
  if (gridPx < 4) return;

  // Calculate visible range in schematic coordinates
  const left = -offsetX / zoom;
  const top = -offsetY / zoom;
  const right = (width - offsetX) / zoom;
  const bottom = (height - offsetY) / zoom;

  // Snap to grid boundaries
  const startX = Math.floor(left / gridSize) * gridSize;
  const startY = Math.floor(top / gridSize) * gridSize;
  const endX = Math.ceil(right / gridSize) * gridSize;
  const endY = Math.ceil(bottom / gridSize) * gridSize;

  // Minor grid (dots)
  const dotRadius = Math.max(0.5, zoom * 0.3);

  ctx.fillStyle =
    gridPx > 20
      ? "rgba(148, 163, 184, 0.3)" // visible dots
      : "rgba(148, 163, 184, 0.15)"; // subtle dots

  for (let x = startX; x <= endX; x += gridSize) {
    for (let y = startY; y <= endY; y += gridSize) {
      const sx = x * zoom + offsetX;
      const sy = y * zoom + offsetY;
      ctx.beginPath();
      ctx.arc(sx, sy, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Major grid lines (every 10 grid units)
  const majorGridSize = gridSize * 10;
  const majorGridPx = majorGridSize * zoom;

  if (majorGridPx > 40) {
    const majorStartX = Math.floor(left / majorGridSize) * majorGridSize;
    const majorStartY = Math.floor(top / majorGridSize) * majorGridSize;
    const majorEndX = Math.ceil(right / majorGridSize) * majorGridSize;
    const majorEndY = Math.ceil(bottom / majorGridSize) * majorGridSize;

    ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = majorStartX; x <= majorEndX; x += majorGridSize) {
      const sx = x * zoom + offsetX;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
    }

    for (let y = majorStartY; y <= majorEndY; y += majorGridSize) {
      const sy = y * zoom + offsetY;
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
    }

    ctx.stroke();
  }

  // Origin crosshair
  const ox = offsetX;
  const oy = offsetY;
  if (ox >= -10 && ox <= width + 10 && oy >= -10 && oy <= height + 10) {
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 1;
    const crossSize = 15;
    ctx.beginPath();
    ctx.moveTo(ox - crossSize, oy);
    ctx.lineTo(ox + crossSize, oy);
    ctx.moveTo(ox, oy - crossSize);
    ctx.lineTo(ox, oy + crossSize);
    ctx.stroke();
  }
}
