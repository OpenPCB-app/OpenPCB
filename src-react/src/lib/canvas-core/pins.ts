/**
 * Canvas Core — Pin Renderer
 *
 * Renders symbol pins in local symbol space (after ctx.transform).
 * Draws: connection dot, pin line (to body), connected indicator ring.
 * Name/number labels handled separately by each canvas.
 */

import type { RenderablePin, Point } from "./types";

// ---------------------------------------------------------------------------
// Constants (screen-space px, divided by zoom at render time)
// ---------------------------------------------------------------------------

export const CONNECTOR_RADIUS_PX = 5;
export const PIN_LINE_WIDTH_PX = 1.5;
const CONNECTED_RING_EXTRA_PX = 2;
const CONNECTED_RING_LINE_PX = 1.5;

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export interface PinColors {
  pinDot: string;
  pinLabel: string;
  pinConnected: string;
  selectionStroke: string;
  background: string;
}

const DEFAULT_PIN_COLORS: PinColors = {
  pinDot: "#f59e0b",
  pinLabel: "#f8fafc",
  pinConnected: "#22c55e",
  selectionStroke: "#38bdf8",
  background: "#0f172a",
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PinRenderOptions {
  selected?: boolean;
  connectedPinIds?: Set<string>;
  colors?: Partial<PinColors>;
}

// ---------------------------------------------------------------------------
// Local-space pin rendering (after applySymbolTransform)
// ---------------------------------------------------------------------------

function computeBodyEnd(pin: RenderablePin): Point | null {
  const { side, length } = pin;
  if (!side || typeof length !== "number") return null;

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

/**
 * Render a single pin in local symbol space.
 * `zoom` is the viewport zoom (px/nm), used to keep dots/lines constant screen size.
 */
export function renderPinLocal(
  ctx: CanvasRenderingContext2D,
  pin: RenderablePin,
  zoom: number,
  options: PinRenderOptions = {},
): void {
  const selected = options.selected ?? false;
  const c = { ...DEFAULT_PIN_COLORS, ...options.colors };
  const safeZoom = Math.max(zoom, Number.EPSILON);
  const connectorRadius = CONNECTOR_RADIUS_PX / safeZoom;
  const pinLineWidth = PIN_LINE_WIDTH_PX / safeZoom;

  // Pin line (from tip to body edge)
  const bodyEnd = computeBodyEnd(pin);
  if (bodyEnd) {
    ctx.beginPath();
    ctx.lineWidth = pinLineWidth;
    ctx.moveTo(pin.position.x, pin.position.y);
    ctx.lineTo(bodyEnd.x, bodyEnd.y);
    ctx.stroke();
  }

  // Connected indicator ring
  if (options.connectedPinIds?.has(pin.id)) {
    const outerRadius = connectorRadius + CONNECTED_RING_EXTRA_PX / safeZoom;
    const outerLineWidth = CONNECTED_RING_LINE_PX / safeZoom;
    ctx.beginPath();
    ctx.strokeStyle = c.pinConnected;
    ctx.lineWidth = outerLineWidth;
    ctx.arc(pin.position.x, pin.position.y, outerRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Connection dot
  ctx.beginPath();
  ctx.lineWidth = pinLineWidth;
  ctx.fillStyle = selected ? c.background : c.pinLabel;
  ctx.strokeStyle = selected ? c.selectionStroke : c.pinDot;
  ctx.arc(pin.position.x, pin.position.y, connectorRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/**
 * Render all pins for a symbol in local space.
 */
export function renderPinsLocal(
  ctx: CanvasRenderingContext2D,
  pins: RenderablePin[],
  zoom: number,
  options: PinRenderOptions = {},
): void {
  for (const pin of pins) {
    renderPinLocal(ctx, pin, zoom, options);
  }
}
