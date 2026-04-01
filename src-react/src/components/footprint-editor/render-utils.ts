/**
 * Footprint Editor Rendering Utilities
 *
 * Canvas2D rendering functions for pads, graphics, and grid.
 */

import type { Viewport, Millimeters, PadDefinition, FootprintGraphic } from "./types";
import { footprintToScreen, mmToPixels } from "./viewport";

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const COLORS = {
  background: "#0f172a",
  gridDot: "rgba(148, 163, 184, 0.3)",
  gridDotFaint: "rgba(148, 163, 184, 0.15)",
  gridMajorLine: "rgba(148, 163, 184, 0.08)",
  originCross: "rgba(148, 163, 184, 0.25)",// Pads
  padFill: "#c9a227",
  padStroke: "#f4d03f",
  padSelectedStroke: "#38bdf8",
  padSelectedFill: "rgba(56, 189, 248, 0.2)",
  padNumber: "#1e293b",
  padNumberLight: "#e2e8f0",
  // Layers
  courtyard: "rgba(255, 193, 7, 0.3)",
  courtyardStroke: "rgba(255, 193, 7, 0.6)",
  silkscreen: "#94a3b8",
  fabOutline: "#64748b",
  fabFill: "rgba(100, 116, 139, 0.1)",
  // Pin 1 marker
  pin1Marker: "#38bdf8",
} as const;

// ---------------------------------------------------------------------------
// Grid Rendering
// ---------------------------------------------------------------------------

interface GridBounds {
  minX: Millimeters;
  minY: Millimeters;
  maxX: Millimeters;
  maxY: Millimeters;
}

function getVisibleGridBounds(
  width: number,
  height: number,
  viewport: Viewport,
): GridBounds {
  const topLeft = { x: 0, y: 0 };
  const bottomRight = { x: width, y: height };
  // Convert screen to footprint coordinates
  const scale = 50 * viewport.zoom; // PIXELS_PER_MM * zoom
  return {
    minX: (topLeft.x - viewport.offsetX) / scale,
    minY: (viewport.offsetY - bottomRight.y) / scale,
    maxX: (bottomRight.x - viewport.offsetX) / scale,
    maxY: (viewport.offsetY - topLeft.y) / scale,
  };
}

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  gridSize: Millimeters,
): void {
  const gridPx = mmToPixels(gridSize, viewport.zoom);
  if (gridPx < 4) return;

  const bounds = getVisibleGridBounds(width, height, viewport);
  const snappedMinX = Math.floor(bounds.minX / gridSize) * gridSize;
  const snappedMinY = Math.floor(bounds.minY / gridSize) * gridSize;
  const snappedMaxX = Math.ceil(bounds.maxX / gridSize) * gridSize;
  const snappedMaxY = Math.ceil(bounds.maxY / gridSize) * gridSize;

  const dotRadius = Math.max(0.5, viewport.zoom * 0.015);
  ctx.fillStyle = gridPx > 20 ? COLORS.gridDot : COLORS.gridDotFaint;

  // Draw grid dots
  for (let x = snappedMinX; x <= snappedMaxX; x += gridSize) {
    for (let y = snappedMinY; y <= snappedMaxY; y += gridSize) {
      const screen = footprintToScreen(x, y, viewport);
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Major grid lines (10xgrid)
  const majorGridSize = gridSize * 10;
  const majorGridPx = mmToPixels(majorGridSize, viewport.zoom);
  if (majorGridPx > 40) {
    const majorMinX = Math.floor(bounds.minX / majorGridSize) * majorGridSize;
    const majorMinY = Math.floor(bounds.minY / majorGridSize) * majorGridSize;
    const majorMaxX = Math.ceil(bounds.maxX / majorGridSize) * majorGridSize;
    const majorMaxY = Math.ceil(bounds.maxY / majorGridSize) * majorGridSize;

    ctx.strokeStyle = COLORS.gridMajorLine;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = majorMinX; x <= majorMaxX; x += majorGridSize) {
      const screen = footprintToScreen(x, 0, viewport);
      ctx.moveTo(screen.x, 0);
      ctx.lineTo(screen.x, height);
    }

    for (let y = majorMinY; y <= majorMaxY; y += majorGridSize) {
      const screen = footprintToScreen(0, y, viewport);
      ctx.moveTo(0, screen.y);
      ctx.lineTo(width, screen.y);
    }

    ctx.stroke();
  }

  // Origin cross
  const origin = footprintToScreen(0, 0, viewport);
  if (origin.x >= -10 && origin.x <= width + 10 && origin.y >= -10 && origin.y <= height + 10) {
    ctx.strokeStyle = COLORS.originCross;
    ctx.lineWidth = 1;
    const crossSize = 15;
    ctx.beginPath();
    ctx.moveTo(origin.x - crossSize, origin.y);
    ctx.lineTo(origin.x + crossSize, origin.y);
    ctx.moveTo(origin.x, origin.y - crossSize);
    ctx.lineTo(origin.x, origin.y + crossSize);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Pad Rendering
// ---------------------------------------------------------------------------

function drawRotatedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
): void {
  if (rotation === 0) {
    ctx.rect(x - width / 2, y - height / 2, width, height);
    return;
  }

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Four corners before rotation
  const hw = width / 2;
  const hh = height / 2;
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];

  ctx.beginPath();
  corners.forEach((corner, i) => {
    const rx = corner.x * cos - corner.y * sin;
    const ry = corner.x * sin + corner.y * cos;
    if (i === 0) {
      ctx.moveTo(x + rx, y + ry);
    } else {
      ctx.lineTo(x + rx, y + ry);
    }
  });
  ctx.closePath();
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  rotation = 0,
): void {
  const hw = width / 2;
  const hh = height / 2;
  ctx.save();
  ctx.translate(x, y);
  if (rotation !== 0) {
    ctx.rotate((rotation * Math.PI) / 180);
  }
  ctx.beginPath();
  ctx.moveTo(-hw + radius, -hh);
  ctx.lineTo(hw - radius, -hh);
  ctx.arcTo(hw, -hh, hw, -hh + radius, radius);
  ctx.lineTo(hw, hh - radius);
  ctx.arcTo(hw, hh, hw - radius, hh, radius);
  ctx.lineTo(-hw + radius, hh);
  ctx.arcTo(-hw, hh, -hw, hh - radius, radius);
  ctx.lineTo(-hw, -hh + radius);
  ctx.arcTo(-hw, -hh, -hw + radius, -hh, radius);
  ctx.closePath();
  ctx.restore();
}

export function renderPad(
  ctx: CanvasRenderingContext2D,
  pad: PadDefinition,
  viewport: Viewport,
  selected: boolean,
): void {
  const screen = footprintToScreen(pad.position.x, pad.position.y, viewport);
  const screenWidth = mmToPixels(pad.size.width, viewport.zoom);
  const screenHeight = mmToPixels(pad.size.height, viewport.zoom);
  const scale = viewport.zoom;

  ctx.save();

  // Draw pad shape
  if (pad.shape === "roundrect" && pad.roundrectRatio) {
    // roundrect: roundrectRatio is 0-0.5, representing fraction of smaller dimension
    const smallerDim = Math.min(screenWidth, screenHeight);
    const radius = (pad.roundrectRatio * smallerDim) / 2;
    drawRoundRect(ctx, screen.x, screen.y, screenWidth, screenHeight, radius, pad.rotation);
  } else if (pad.shape === "circle") {
    const radius = Math.min(screenWidth, screenHeight) / 2;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  } else if (pad.shape === "oval") {
    const rotation = (pad.rotation * Math.PI) / 180;
    const hw = screenWidth / 2;
    const hh = screenHeight / 2;
    ctx.beginPath();
    ctx.ellipse(screen.x, screen.y, hw, hh, rotation, 0, Math.PI * 2);
  } else {
    // Default: rect or trapezoid (trapezoid rendered as rect for now)
    drawRotatedRect(ctx, screen.x, screen.y, screenWidth, screenHeight, pad.rotation);
  }

  // Fill and stroke
  ctx.fillStyle = selected ? COLORS.padSelectedFill : COLORS.padFill;
  ctx.strokeStyle = selected ? COLORS.padSelectedStroke : COLORS.padStroke;
  ctx.lineWidth = selected ? 2 : 1;
  ctx.fill();
  ctx.stroke();

  ctx.restore();

  // Draw pad number
  if (pad.number) {
    const fontSize = Math.max(8, Math.min(14, scale * 0.35));
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = selected ? COLORS.padNumberLight : COLORS.padNumber;
    ctx.fillText(pad.number, screen.x, screen.y);
  }
}

// ---------------------------------------------------------------------------
// Graphics Rendering
// ---------------------------------------------------------------------------

export function renderGraphic(
  ctx: CanvasRenderingContext2D,
  graphic: FootprintGraphic,
  viewport: Viewport,
): void {
  ctx.save();

  // Set style based on layer
  switch (graphic.layer) {
    case "F.CrtYd":
      ctx.strokeStyle = COLORS.courtyardStroke;
      ctx.setLineDash([4, 2]);
      break;
    case "F.SilkS":
      ctx.strokeStyle = COLORS.silkscreen;
      break;
    case "F.Fab":
      ctx.strokeStyle = COLORS.fabOutline;
      ctx.fillStyle = COLORS.fabFill;
      break;
    default:
      ctx.strokeStyle = COLORS.fabOutline;
  }

  ctx.lineWidth = mmToPixels(graphic.strokeWidth, viewport.zoom);

  switch (graphic.type) {
    case "line": {
      const start = footprintToScreen(graphic.start.x, graphic.start.y, viewport);
      const end = footprintToScreen(graphic.end.x, graphic.end.y, viewport);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      break;
    }
    case "rect": {
      const w = mmToPixels(graphic.width, viewport.zoom);
      const h = mmToPixels(graphic.height, viewport.zoom);
      const start = footprintToScreen(
        graphic.position.x - graphic.width / 2,
        graphic.position.y + graphic.height / 2,
        viewport,
      );
      ctx.beginPath();
      ctx.rect(start.x, start.y, w, h);
      if (graphic.filled) {
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case "circle": {
      const center = footprintToScreen(graphic.center.x, graphic.center.y, viewport);
      const radius = mmToPixels(graphic.radius, viewport.zoom);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      if (graphic.filled) {
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case "arc": {
      const center = footprintToScreen(graphic.center.x, graphic.center.y, viewport);
      const radius = mmToPixels(graphic.radius, viewport.zoom);
      const startAngle = (graphic.startAngle * Math.PI) / 180;
      const endAngle = (graphic.endAngle * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, startAngle, endAngle);
      ctx.stroke();
      break;
    }
    case "polygon": {
      if (graphic.points.length < 2) break;
      const first = footprintToScreen(graphic.points[0]!.x, graphic.points[0]!.y, viewport);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < graphic.points.length; i++) {
        const pt = footprintToScreen(graphic.points[i]!.x, graphic.points[i]!.y, viewport);
        ctx.lineTo(pt.x, pt.y);
      }
      if (graphic.filled) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case "text": {
      const pos = footprintToScreen(graphic.position.x, graphic.position.y, viewport);
      const fontSize = Math.max(8, mmToPixels(graphic.fontSize, viewport.zoom));
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = COLORS.silkscreen;
      const rad = (graphic.rotation * Math.PI) / 180;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(-rad); // negative because Y is flipped
      ctx.fillText(graphic.content, 0, 0);
      ctx.restore();
      break;
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Pin 1 Marker
// ---------------------------------------------------------------------------

export function renderPin1Marker(
  ctx: CanvasRenderingContext2D,
  position: { x: Millimeters; y: Millimeters },
  viewport: Viewport,
  markerType: "dot" | "octagon" | "bevel" = "dot",
): void {
  const screen = footprintToScreen(position.x, position.y, viewport);
  const size = mmToPixels(0.8, viewport.zoom);

  ctx.save();
  ctx.strokeStyle = COLORS.pin1Marker;
  ctx.fillStyle = COLORS.pin1Marker;
  ctx.lineWidth = 2;

  switch (markerType) {
    case "dot":
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, size / 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "octagon":
      ctx.beginPath();
      const sides = 8;
      const radius = size / 2;
      for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI) / sides;
        const x = screen.x + radius * Math.cos(angle);
        const y = screen.y + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    case "bevel":
      ctx.beginPath();
      ctx.moveTo(screen.x - size / 2, screen.y - size / 2);
      ctx.lineTo(screen.x + size / 2, screen.y - size / 2);
      ctx.lineTo(screen.x + size / 2, screen.y + size / 2);
      ctx.lineTo(screen.x - size / 2, screen.y + size / 2);
      ctx.closePath();
      ctx.stroke();
      break;
  }

  ctx.restore();
}
