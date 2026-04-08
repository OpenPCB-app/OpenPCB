import type { SymbolGraphic } from "@/components/symbol-editor/types";
import type { RenderedSymbolPin } from "../types";

export interface PinColors {
  pinDot: string;
  pinLabel: string;
  pinConnected: string;
  selectionStroke: string;
  background: string;
}

export interface PinRenderOptions {
  selected?: boolean;
  connectedPinIds?: Set<string>;
  colors?: Partial<PinColors>;
}

const DEFAULT_MIN_STROKE = 1;
const CONNECTOR_RADIUS_PX = 5;
const PIN_LINE_WIDTH_PX = 1.5;
const CONNECTED_RING_EXTRA_PX = 2;
const CONNECTED_RING_LINE_PX = 1.5;

const DEFAULT_PIN_COLORS: PinColors = {
  pinDot: "#f59e0b",
  pinLabel: "#f8fafc",
  pinConnected: "#22c55e",
  selectionStroke: "#38bdf8",
  background: "#0f172a",
};

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
        const point = graphic.points[i]!;
        ctx.lineTo(point.x, point.y);
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

function computeBodyEnd(pin: RenderedSymbolPin) {
  const { side, length } = pin;
  if (!side || typeof length !== "number") {
    return null;
  }

  switch (side) {
    case "left":
      return { x: pin.position.x + length, y: pin.position.y };
    case "right":
      return { x: pin.position.x - length, y: pin.position.y };
    case "top":
      return { x: pin.position.x, y: pin.position.y + length };
    case "bottom":
      return { x: pin.position.x, y: pin.position.y - length };
  }
}

export function renderPinLocal(
  ctx: CanvasRenderingContext2D,
  pin: RenderedSymbolPin,
  zoom: number,
  options: PinRenderOptions = {},
): void {
  const selected = options.selected ?? false;
  const colors = { ...DEFAULT_PIN_COLORS, ...options.colors };
  const safeZoom = Math.max(zoom, Number.EPSILON);
  const connectorRadius = CONNECTOR_RADIUS_PX / safeZoom;
  const pinLineWidth = PIN_LINE_WIDTH_PX / safeZoom;

  const bodyEnd = computeBodyEnd(pin);
  if (bodyEnd) {
    ctx.beginPath();
    ctx.lineWidth = pinLineWidth;
    ctx.moveTo(pin.position.x, pin.position.y);
    ctx.lineTo(bodyEnd.x, bodyEnd.y);
    ctx.stroke();
  }

  if (options.connectedPinIds?.has(pin.id)) {
    const outerRadius = connectorRadius + CONNECTED_RING_EXTRA_PX / safeZoom;
    const outerLineWidth = CONNECTED_RING_LINE_PX / safeZoom;
    ctx.beginPath();
    ctx.strokeStyle = colors.pinConnected;
    ctx.lineWidth = outerLineWidth;
    ctx.arc(pin.position.x, pin.position.y, outerRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.lineWidth = pinLineWidth;
  ctx.fillStyle = selected ? colors.background : colors.pinLabel;
  ctx.strokeStyle = selected ? colors.selectionStroke : colors.pinDot;
  ctx.arc(pin.position.x, pin.position.y, connectorRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export function renderPinsLocal(
  ctx: CanvasRenderingContext2D,
  pins: RenderedSymbolPin[],
  zoom: number,
  options: PinRenderOptions = {},
): void {
  for (const pin of pins) {
    renderPinLocal(ctx, pin, zoom, options);
  }
}
