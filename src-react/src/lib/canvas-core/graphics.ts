/**
 * Canvas Core — Graphics Primitive Renderer
 *
 * Renders SymbolGraphic primitives (line, rect, circle, arc, polygon, bezier, text).
 * Two modes:
 *  - renderGraphicLocal: draws in local/nm coords (after ctx.transform — Designer path)
 *  - renderGraphicWorld: transforms each point via a worldToScreen function (Wizard/Preview path)
 */

import type { Point, SymbolGraphic, Viewport } from "./types";

// ---------------------------------------------------------------------------
// Local-space rendering (used after ctx.translate/rotate/scale)
// ---------------------------------------------------------------------------

const DEFAULT_MIN_STROKE = 1;

function setLocalStroke(
  ctx: CanvasRenderingContext2D,
  strokeWidth: number,
  zoom: number,
): void {
  ctx.lineWidth = Math.max(
    strokeWidth,
    DEFAULT_MIN_STROKE / Math.max(zoom, Number.EPSILON),
  );
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

/**
 * Render a single graphic primitive in local symbol space.
 * Assumes canvas context already has symbol transform applied.
 * `zoom` is needed only for stroke width clamping and text font sizing.
 */
export function renderGraphicLocal(
  ctx: CanvasRenderingContext2D,
  graphic: SymbolGraphic,
  zoom: number,
  defaultStrokeWidth: number = DEFAULT_MIN_STROKE,
): void {
  const sw =
    "strokeWidth" in graphic ? graphic.strokeWidth : defaultStrokeWidth / zoom;
  setLocalStroke(ctx, sw, zoom);

  switch (graphic.type) {
    case "line":
      ctx.beginPath();
      ctx.moveTo(graphic.x1, graphic.y1);
      ctx.lineTo(graphic.x2, graphic.y2);
      ctx.stroke();
      return;

    case "rect":
      ctx.beginPath();
      ctx.rect(graphic.x, graphic.y, graphic.width, graphic.height);
      if (graphic.filled) ctx.fill();
      ctx.stroke();
      return;

    case "circle":
      ctx.beginPath();
      ctx.arc(graphic.cx, graphic.cy, graphic.radius, 0, Math.PI * 2);
      if (graphic.filled) ctx.fill();
      ctx.stroke();
      return;

    case "arc":
      ctx.beginPath();
      ctx.arc(
        graphic.cx,
        graphic.cy,
        graphic.radius,
        (graphic.startAngle * Math.PI) / 180,
        (graphic.endAngle * Math.PI) / 180,
        false,
      );
      ctx.stroke();
      return;

    case "polygon":
      if (graphic.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(graphic.points[0]!.x, graphic.points[0]!.y);
      for (let i = 1; i < graphic.points.length; i += 1) {
        const p = graphic.points[i]!;
        ctx.lineTo(p.x, p.y);
      }
      if (graphic.closed) ctx.closePath();
      if (graphic.filled) ctx.fill();
      ctx.stroke();
      return;

    case "bezier": {
      const [p0, p1, p2, p3] = graphic.points;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      ctx.stroke();
      return;
    }

    case "text": {
      ctx.save();
      ctx.translate(graphic.x, graphic.y);
      ctx.rotate((graphic.rotation * Math.PI) / 180);
      ctx.font = `${Math.max(graphic.fontSize, 8 / Math.max(zoom, Number.EPSILON))}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(graphic.content, 0, 0);
      ctx.restore();
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// World-space rendering (transforms each point via worldToScreenFn)
// ---------------------------------------------------------------------------

type WorldToScreenFn = (x: number, y: number, viewport: Viewport) => Point;

function worldStrokeWidthPx(strokeWidth: number, viewport: Viewport): number {
  return Math.max(1, strokeWidth * viewport.zoom);
}

/**
 * Render a single graphic primitive by transforming each coordinate
 * through a worldToScreen function. Used by Symbol Editor and SymbolPreview
 * where the canvas context does NOT have a symbol transform applied.
 */
export function renderGraphicWorld(
  ctx: CanvasRenderingContext2D,
  graphic: SymbolGraphic,
  viewport: Viewport,
  toScreen: WorldToScreenFn,
  bodyStroke: string,
  bodyFill: string,
  labelColor?: string,
): void {
  ctx.save();
  ctx.strokeStyle = bodyStroke;
  ctx.fillStyle = bodyFill;
  ctx.lineWidth =
    "strokeWidth" in graphic
      ? worldStrokeWidthPx(graphic.strokeWidth, viewport)
      : 1;

  switch (graphic.type) {
    case "line": {
      const start = toScreen(graphic.x1, graphic.y1, viewport);
      const end = toScreen(graphic.x2, graphic.y2, viewport);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      break;
    }

    case "rect": {
      const tl = toScreen(graphic.x, graphic.y + graphic.height, viewport);
      const br = toScreen(graphic.x + graphic.width, graphic.y, viewport);
      ctx.beginPath();
      ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      if (graphic.filled) ctx.fill();
      ctx.stroke();
      break;
    }

    case "circle": {
      const center = toScreen(graphic.cx, graphic.cy, viewport);
      const edge = toScreen(graphic.cx + graphic.radius, graphic.cy, viewport);
      ctx.beginPath();
      ctx.arc(center.x, center.y, Math.abs(edge.x - center.x), 0, Math.PI * 2);
      if (graphic.filled) ctx.fill();
      ctx.stroke();
      break;
    }

    case "arc": {
      const center = toScreen(graphic.cx, graphic.cy, viewport);
      const edge = toScreen(graphic.cx + graphic.radius, graphic.cy, viewport);
      const startAngle = (-graphic.startAngle * Math.PI) / 180;
      const endAngle = (-graphic.endAngle * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(
        center.x,
        center.y,
        Math.abs(edge.x - center.x),
        startAngle,
        endAngle,
        false,
      );
      ctx.stroke();
      break;
    }

    case "polygon": {
      if (graphic.points.length < 2) break;
      const first = toScreen(
        graphic.points[0]!.x,
        graphic.points[0]!.y,
        viewport,
      );
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < graphic.points.length; i++) {
        const p = graphic.points[i]!;
        const screen = toScreen(p.x, p.y, viewport);
        ctx.lineTo(screen.x, screen.y);
      }
      if (graphic.closed) ctx.closePath();
      if (graphic.filled) ctx.fill();
      ctx.stroke();
      break;
    }

    case "bezier": {
      const [p0, p1, p2, p3] = graphic.points;
      const s0 = toScreen(p0.x, p0.y, viewport);
      const s1 = toScreen(p1.x, p1.y, viewport);
      const s2 = toScreen(p2.x, p2.y, viewport);
      const s3 = toScreen(p3.x, p3.y, viewport);
      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y);
      ctx.bezierCurveTo(s1.x, s1.y, s2.x, s2.y, s3.x, s3.y);
      ctx.stroke();
      break;
    }

    case "text": {
      const point = toScreen(graphic.x, graphic.y, viewport);
      const fontSize = Math.max(10, graphic.fontSize * viewport.zoom);
      const angle = (-graphic.rotation * Math.PI) / 180;
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.rotate(angle);
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = labelColor ?? bodyStroke;
      ctx.fillText(graphic.content, 0, 0);
      ctx.restore();
      break;
    }
  }

  ctx.restore();
}
