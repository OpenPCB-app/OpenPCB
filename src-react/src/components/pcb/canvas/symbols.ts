import type { Bounds, Point, SymbolEntity, Viewport } from "../types";
import { schematicToScreen } from "./viewport";
import { DEFAULT_SCHEMATIC_ZOOM } from "./viewport";
import { getSymbolKindLabel } from "../symbol-display";

const DEFAULT_PIN_SPAN = 1_270_000;
const TWO_TERMINAL_LEAD_INSET = 280_000;
const TWO_TERMINAL_HALF_HEIGHT = 180_000;
const RECT_PADDING_X = 220_000;
const RECT_PADDING_Y = 220_000;
const MIN_RECT_WIDTH = 760_000;
const MIN_RECT_HEIGHT = 760_000;
const CONNECTOR_RADIUS_PX = 5;
const STROKE_WIDTH_PX = 1.75;
const BODY_LABEL_OFFSET_NM = 420_000;
const PIN_LABEL_OFFSET_NM = 220_000;

interface SymbolRenderOptions {
  selected?: boolean;
  preview?: boolean;
}

interface PinExtents {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface TwoTerminalMetrics {
  startX: number;
  endX: number;
  centerY: number;
  bodyLeft: number;
  bodyRight: number;
  bodyTop: number;
  bodyBottom: number;
}

interface SymbolTextLabel {
  text: string;
  point: Point;
}

function getPinExtents(symbol: SymbolEntity): PinExtents | null {
  if (symbol.pins.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const pin of symbol.pins) {
    minX = Math.min(minX, pin.position.x);
    minY = Math.min(minY, pin.position.y);
    maxX = Math.max(maxX, pin.position.x);
    maxY = Math.max(maxY, pin.position.y);
  }

  return { minX, minY, maxX, maxY };
}

function getLocalCenter(symbol: SymbolEntity): Point {
  const extents = getPinExtents(symbol);

  if (!extents) {
    return { x: 0, y: 0 };
  }

  return {
    x: (extents.minX + extents.maxX) / 2,
    y: (extents.minY + extents.maxY) / 2,
  };
}

function getTwoTerminalMetrics(symbol: SymbolEntity): TwoTerminalMetrics {
  const firstPin = symbol.pins[0]?.position ?? {
    x: -DEFAULT_PIN_SPAN / 2,
    y: 0,
  };
  const lastPin = symbol.pins[symbol.pins.length - 1]?.position ?? {
    x: DEFAULT_PIN_SPAN / 2,
    y: 0,
  };

  const startX = Math.min(firstPin.x, lastPin.x);
  const endX = Math.max(firstPin.x, lastPin.x);
  const centerY = (firstPin.y + lastPin.y) / 2;
  const span = Math.max(endX - startX, DEFAULT_PIN_SPAN);
  const leadInset = Math.min(TWO_TERMINAL_LEAD_INSET, span * 0.3);
  const bodyLeft = startX + leadInset;
  const bodyRight = endX - leadInset;

  return {
    startX,
    endX,
    centerY,
    bodyLeft,
    bodyRight,
    bodyTop: centerY - TWO_TERMINAL_HALF_HEIGHT,
    bodyBottom: centerY + TWO_TERMINAL_HALF_HEIGHT,
  };
}

function expandRect(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): Bounds {
  return {
    minX: centerX - width / 2,
    minY: centerY - height / 2,
    maxX: centerX + width / 2,
    maxY: centerY + height / 2,
  };
}

function getRectBodyLocalBounds(symbol: SymbolEntity): Bounds {
  const center = getLocalCenter(symbol);
  const extents = getPinExtents(symbol);
  const width = extents
    ? Math.max(extents.maxX - extents.minX - RECT_PADDING_X, MIN_RECT_WIDTH)
    : MIN_RECT_WIDTH;
  const height = extents
    ? Math.max(
        extents.maxY - extents.minY + RECT_PADDING_Y * 2,
        MIN_RECT_HEIGHT,
      )
    : MIN_RECT_HEIGHT;

  return expandRect(center.x, center.y, width, height);
}

function getTriangleBodyLocalBounds(symbol: SymbolEntity): Bounds {
  const extents = getPinExtents(symbol);
  const center = getLocalCenter(symbol);
  const width = extents
    ? Math.max(extents.maxX - extents.minX + RECT_PADDING_X * 2, 900_000)
    : 900_000;
  const height = extents
    ? Math.max(extents.maxY - extents.minY + RECT_PADDING_Y * 2, 900_000)
    : 900_000;

  return expandRect(center.x, center.y, width, height);
}

function getSinglePinBodyLocalBounds(
  symbol: SymbolEntity,
  width: number,
  height: number,
): Bounds {
  const pin = symbol.pins[0]?.position ?? { x: 0, y: 0 };

  return {
    minX: pin.x - width / 2,
    minY: pin.y,
    maxX: pin.x + width / 2,
    maxY: pin.y + height,
  };
}

export function getSymbolBodyLocalBounds(symbol: SymbolEntity): Bounds {
  if (!symbol.symbolTemplate) {
    throw new Error(`Symbol ${symbol.id} missing symbolTemplate`);
  }
  switch (symbol.symbolTemplate) {
    case "resistor":
    case "capacitor":
    case "inductor":
    case "diode":
    case "led": {
      const metrics = getTwoTerminalMetrics(symbol);
      return {
        minX: metrics.bodyLeft,
        minY: metrics.bodyTop,
        maxX: metrics.bodyRight,
        maxY: metrics.bodyBottom,
      };
    }
    case "opamp":
      return getTriangleBodyLocalBounds(symbol);
    case "generic_ic":
    case "connector": {
      if (symbol.symbolKind === "gnd") {
        return getSinglePinBodyLocalBounds(symbol, 480_000, 420_000);
      }
      if (symbol.symbolKind === "vcc") {
        return {
          ...getSinglePinBodyLocalBounds(symbol, 420_000, 360_000),
          minY: (symbol.pins[0]?.position.y ?? 0) - 360_000,
          maxY: symbol.pins[0]?.position.y ?? 0,
        };
      }
      return getRectBodyLocalBounds(symbol);
    }
    case "npn":
    case "pnp":
    case "nmos":
    case "pmos": {
      const center = getLocalCenter(symbol);
      return expandRect(center.x, center.y, 760_000, 760_000);
    }
    default:
      return getRectBodyLocalBounds(symbol);
  }
}

function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const value = ((rotation % 360) + 360) % 360;

  if (value === 0 || value === 90 || value === 180 || value === 270) {
    return value;
  }

  return 0;
}

export function transformSymbolLocalPoint(
  symbol: SymbolEntity,
  point: Point,
): Point {
  const mirroredPoint =
    symbol.mirrored === true ? { x: -point.x, y: point.y } : point;

  switch (normalizeRotation(symbol.rotation)) {
    case 90:
      return {
        x: symbol.position.x - mirroredPoint.y,
        y: symbol.position.y + mirroredPoint.x,
      };
    case 180:
      return {
        x: symbol.position.x - mirroredPoint.x,
        y: symbol.position.y - mirroredPoint.y,
      };
    case 270:
      return {
        x: symbol.position.x + mirroredPoint.y,
        y: symbol.position.y - mirroredPoint.x,
      };
    default:
      return {
        x: symbol.position.x + mirroredPoint.x,
        y: symbol.position.y + mirroredPoint.y,
      };
  }
}

export function getWorldConnectorAnchors(
  symbol: SymbolEntity,
): Record<string, Point> {
  return Object.fromEntries(
    symbol.pins.map((pin) => [
      pin.id,
      transformSymbolLocalPoint(symbol, pin.position),
    ]),
  );
}

export function getSymbolBodyBounds(symbol: SymbolEntity): Bounds {
  const local = getSymbolBodyLocalBounds(symbol);
  const corners = [
    transformSymbolLocalPoint(symbol, { x: local.minX, y: local.minY }),
    transformSymbolLocalPoint(symbol, { x: local.maxX, y: local.minY }),
    transformSymbolLocalPoint(symbol, { x: local.maxX, y: local.maxY }),
    transformSymbolLocalPoint(symbol, { x: local.minX, y: local.maxY }),
  ];

  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}

function applySymbolTransform(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
  viewport: Viewport,
): void {
  const origin = schematicToScreen(
    symbol.position.x,
    symbol.position.y,
    viewport,
  );

  ctx.translate(origin.x, origin.y);
  ctx.rotate((normalizeRotation(symbol.rotation) * Math.PI) / 180);
  ctx.scale(viewport.zoom * (symbol.mirrored === true ? -1 : 1), viewport.zoom);
  ctx.lineWidth = STROKE_WIDTH_PX / Math.max(viewport.zoom, Number.EPSILON);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

function strokeTwoTerminalLeads(
  ctx: CanvasRenderingContext2D,
  metrics: TwoTerminalMetrics,
): void {
  ctx.beginPath();
  ctx.moveTo(metrics.startX, metrics.centerY);
  ctx.lineTo(metrics.bodyLeft, metrics.centerY);
  ctx.moveTo(metrics.bodyRight, metrics.centerY);
  ctx.lineTo(metrics.endX, metrics.centerY);
  ctx.stroke();
}

function drawRect(ctx: CanvasRenderingContext2D, bounds: Bounds): void {
  ctx.beginPath();
  ctx.rect(
    bounds.minX,
    bounds.minY,
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
  );
  ctx.stroke();
}

function renderResistor(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
): void {
  const metrics = getTwoTerminalMetrics(symbol);
  const zigzagWidth = (metrics.bodyRight - metrics.bodyLeft) / 6;
  const amplitude = (metrics.bodyBottom - metrics.bodyTop) / 2;

  strokeTwoTerminalLeads(ctx, metrics);

  ctx.beginPath();
  ctx.moveTo(metrics.bodyLeft, metrics.centerY);
  for (let index = 0; index < 6; index += 1) {
    const x = metrics.bodyLeft + zigzagWidth * (index + 1);
    const y = metrics.centerY + (index % 2 === 0 ? -amplitude : amplitude);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(metrics.bodyRight, metrics.centerY);
  ctx.stroke();
}

function renderCapacitor(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
): void {
  const metrics = getTwoTerminalMetrics(symbol);
  const plateGap = (metrics.bodyRight - metrics.bodyLeft) * 0.18;

  strokeTwoTerminalLeads(ctx, metrics);

  ctx.beginPath();
  ctx.moveTo(metrics.bodyLeft + plateGap, metrics.bodyTop);
  ctx.lineTo(metrics.bodyLeft + plateGap, metrics.bodyBottom);
  ctx.moveTo(metrics.bodyRight - plateGap, metrics.bodyTop);
  ctx.lineTo(metrics.bodyRight - plateGap, metrics.bodyBottom);
  ctx.stroke();
}

function renderInductor(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
): void {
  const metrics = getTwoTerminalMetrics(symbol);
  const coilWidth = (metrics.bodyRight - metrics.bodyLeft) / 4;

  strokeTwoTerminalLeads(ctx, metrics);

  for (let index = 0; index < 4; index += 1) {
    const centerX = metrics.bodyLeft + coilWidth * index + coilWidth / 2;
    ctx.beginPath();
    ctx.arc(centerX, metrics.centerY, coilWidth / 2, Math.PI, 0);
    ctx.stroke();
  }
}

function renderDiode(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
  led: boolean,
): void {
  const metrics = getTwoTerminalMetrics(symbol);
  const lineX =
    metrics.bodyRight - (metrics.bodyRight - metrics.bodyLeft) * 0.18;

  strokeTwoTerminalLeads(ctx, metrics);

  ctx.beginPath();
  ctx.moveTo(metrics.bodyLeft, metrics.bodyTop);
  ctx.lineTo(lineX, metrics.centerY);
  ctx.lineTo(metrics.bodyLeft, metrics.bodyBottom);
  ctx.closePath();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(lineX, metrics.bodyTop);
  ctx.lineTo(lineX, metrics.bodyBottom);
  ctx.stroke();

  if (!led) {
    return;
  }

  const arrowOffset = 110_000;
  const arrowLength = 160_000;

  ctx.beginPath();
  ctx.moveTo(metrics.bodyRight - arrowLength, metrics.bodyTop - arrowOffset);
  ctx.lineTo(metrics.bodyRight, metrics.bodyTop - arrowOffset - arrowLength);
  ctx.moveTo(
    metrics.bodyRight - 80_000,
    metrics.bodyTop - arrowOffset - arrowLength,
  );
  ctx.lineTo(metrics.bodyRight, metrics.bodyTop - arrowOffset - arrowLength);
  ctx.lineTo(
    metrics.bodyRight - 10_000,
    metrics.bodyTop - arrowOffset - 80_000,
  );

  ctx.moveTo(metrics.bodyRight - arrowLength * 1.3, metrics.bodyTop + 40_000);
  ctx.lineTo(
    metrics.bodyRight - 40_000,
    metrics.bodyTop - arrowLength + 40_000,
  );
  ctx.moveTo(
    metrics.bodyRight - 120_000,
    metrics.bodyTop - arrowLength + 40_000,
  );
  ctx.lineTo(
    metrics.bodyRight - 40_000,
    metrics.bodyTop - arrowLength + 40_000,
  );
  ctx.lineTo(metrics.bodyRight - 50_000, metrics.bodyTop - 40_000);
  ctx.stroke();
}

function renderGround(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
): void {
  const pin = symbol.pins[0]?.position ?? { x: 0, y: 0 };
  const widths = [360_000, 240_000, 120_000];

  ctx.beginPath();
  ctx.moveTo(pin.x, pin.y);
  ctx.lineTo(pin.x, pin.y + 120_000);
  widths.forEach((width, index) => {
    const y = pin.y + 120_000 + index * 90_000;
    ctx.moveTo(pin.x - width / 2, y);
    ctx.lineTo(pin.x + width / 2, y);
  });
  ctx.stroke();
}

function renderPower(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
): void {
  const pin = symbol.pins[0]?.position ?? { x: 0, y: 0 };

  ctx.beginPath();
  ctx.moveTo(pin.x, pin.y);
  ctx.lineTo(pin.x, pin.y - 180_000);
  ctx.lineTo(pin.x - 160_000, pin.y - 20_000);
  ctx.moveTo(pin.x, pin.y - 180_000);
  ctx.lineTo(pin.x + 160_000, pin.y - 20_000);
  ctx.stroke();
}

function renderOpAmp(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
): void {
  const bounds = getTriangleBodyLocalBounds(symbol);

  ctx.beginPath();
  ctx.moveTo(bounds.minX, bounds.minY);
  ctx.lineTo(bounds.maxX, (bounds.minY + bounds.maxY) / 2);
  ctx.lineTo(bounds.minX, bounds.maxY);
  ctx.closePath();
  ctx.stroke();
}

function renderRectangularSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
): void {
  drawRect(ctx, getRectBodyLocalBounds(symbol));
}

function renderBjt(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
  inwardArrow: boolean,
): void {
  const center = getLocalCenter(symbol);
  const radius = 320_000;
  const arrowDirection = inwardArrow ? -1 : 1;

  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.moveTo(center.x - radius - 220_000, center.y);
  ctx.lineTo(center.x - radius, center.y);
  ctx.moveTo(center.x + 40_000, center.y - 80_000);
  ctx.lineTo(center.x + radius + 180_000, center.y - radius);
  ctx.moveTo(center.x + 40_000, center.y + 80_000);
  ctx.lineTo(center.x + radius + 180_000, center.y + radius);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(center.x + radius - 120_000, center.y + arrowDirection * 60_000);
  ctx.lineTo(center.x + radius + 20_000, center.y + arrowDirection * 180_000);
  ctx.lineTo(center.x + radius - 40_000, center.y + arrowDirection * 200_000);
  ctx.stroke();
}

function renderMosfet(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
  pChannel: boolean,
): void {
  const center = getLocalCenter(symbol);
  const halfHeight = 280_000;

  ctx.beginPath();
  ctx.moveTo(center.x - 260_000, center.y - halfHeight);
  ctx.lineTo(center.x - 260_000, center.y + halfHeight);
  ctx.moveTo(center.x - 520_000, center.y);
  ctx.lineTo(center.x - 260_000, center.y);
  ctx.moveTo(center.x + 120_000, center.y - halfHeight);
  ctx.lineTo(center.x + 120_000, center.y + halfHeight);
  ctx.moveTo(center.x + 120_000, center.y - halfHeight);
  ctx.lineTo(center.x + 420_000, center.y - halfHeight);
  ctx.moveTo(center.x + 120_000, center.y + halfHeight);
  ctx.lineTo(center.x + 420_000, center.y + halfHeight);
  ctx.stroke();

  if (!pChannel) {
    return;
  }

  ctx.beginPath();
  ctx.arc(center.x - 130_000, center.y, 70_000, 0, Math.PI * 2);
  ctx.stroke();
}

function renderBody(ctx: CanvasRenderingContext2D, symbol: SymbolEntity): void {
  if (!symbol.symbolTemplate) {
    throw new Error(`Symbol ${symbol.id} missing symbolTemplate`);
  }

  switch (symbol.symbolTemplate) {
    case "resistor":
      renderResistor(ctx, symbol);
      return;
    case "capacitor":
      renderCapacitor(ctx, symbol);
      return;
    case "inductor":
      renderInductor(ctx, symbol);
      return;
    case "diode":
      renderDiode(ctx, symbol, false);
      return;
    case "led":
      renderDiode(ctx, symbol, true);
      return;
    case "npn":
      renderBjt(ctx, symbol, false);
      return;
    case "pnp":
      renderBjt(ctx, symbol, true);
      return;
    case "nmos":
      renderMosfet(ctx, symbol, false);
      return;
    case "pmos":
      renderMosfet(ctx, symbol, true);
      return;
    case "opamp":
      renderOpAmp(ctx, symbol);
      return;
    case "generic_ic":
    case "connector": {
      if (symbol.symbolKind === "gnd") {
        renderGround(ctx, symbol);
        return;
      }
      if (symbol.symbolKind === "vcc") {
        renderPower(ctx, symbol);
        return;
      }
      renderRectangularSymbol(ctx, symbol);
      return;
    }
    default:
      renderRectangularSymbol(ctx, symbol);
      return;
  }
}

function renderPins(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
  viewport: Viewport,
  selected: boolean,
): void {
  const connectorRadius =
    CONNECTOR_RADIUS_PX / Math.max(viewport.zoom, Number.EPSILON);

  for (const pin of symbol.pins) {
    ctx.beginPath();
    ctx.fillStyle = selected ? "#0f172a" : "#f8fafc";
    ctx.strokeStyle = selected ? "#38bdf8" : "#f59e0b";
    ctx.arc(pin.position.x, pin.position.y, connectorRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function getLabelFontSizePx(viewport: Viewport): number {
  const zoomScale = viewport.zoom / DEFAULT_SCHEMATIC_ZOOM;
  return Math.max(10, Math.min(16, 11 + Math.log2(Math.max(zoomScale, 0.25))));
}

function getPrimarySymbolLabel(symbol: SymbolEntity): string {
  if (symbol.symbolKind === "gnd") {
    return getSymbolKindLabel(symbol.symbolKind);
  }

  if (symbol.symbolKind === "vcc") {
    return symbol.value || getSymbolKindLabel(symbol.symbolKind);
  }

  return symbol.reference;
}

function getSecondarySymbolLabel(symbol: SymbolEntity): string | null {
  if (!symbol.value || symbol.value === symbol.reference) {
    return null;
  }

  return symbol.value;
}

function getBodyTextAnchors(symbol: SymbolEntity): {
  primary: Point;
  secondary: Point;
} {
  if (symbol.symbolKind === "gnd") {
    return {
      primary: { x: 0, y: 420_000 },
      secondary: { x: 0, y: 0 },
    };
  }

  if (symbol.symbolKind === "vcc") {
    return {
      primary: { x: 0, y: -420_000 },
      secondary: { x: 0, y: 0 },
    };
  }

  const metrics = getTwoTerminalMetrics(symbol);
  return {
    primary: {
      x: (metrics.startX + metrics.endX) / 2,
      y: metrics.bodyTop - BODY_LABEL_OFFSET_NM,
    },
    secondary: {
      x: (metrics.startX + metrics.endX) / 2,
      y: metrics.bodyBottom + BODY_LABEL_OFFSET_NM,
    },
  };
}

function getPinTextAnchor(symbol: SymbolEntity, pinIndex: number): Point {
  const pin = symbol.pins[pinIndex];
  if (!pin) {
    return { x: 0, y: 0 };
  }

  if (symbol.pins.length === 1) {
    return { x: pin.position.x, y: pin.position.y - PIN_LABEL_OFFSET_NM };
  }

  return {
    x: pin.position.x,
    y:
      pin.position.y +
      (pinIndex === 0 ? -PIN_LABEL_OFFSET_NM : PIN_LABEL_OFFSET_NM),
  };
}

function getSymbolTextLabels(symbol: SymbolEntity): SymbolTextLabel[] {
  const bodyAnchors = getBodyTextAnchors(symbol);
  const labels: SymbolTextLabel[] = [
    {
      text: getPrimarySymbolLabel(symbol),
      point: transformSymbolLocalPoint(symbol, bodyAnchors.primary),
    },
  ];
  const secondary = getSecondarySymbolLabel(symbol);

  if (secondary) {
    labels.push({
      text: secondary,
      point: transformSymbolLocalPoint(symbol, bodyAnchors.secondary),
    });
  }

  for (const [index, pin] of symbol.pins.entries()) {
    labels.push({
      text: pin.name,
      point: transformSymbolLocalPoint(symbol, getPinTextAnchor(symbol, index)),
    });
  }

  return labels;
}

function renderSymbolLabels(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
  viewport: Viewport,
): void {
  const fontSizePx = getLabelFontSizePx(viewport);

  ctx.save();
  ctx.fillStyle = "#cbd5e1";
  ctx.font = `${fontSizePx}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const label of getSymbolTextLabels(symbol)) {
    const screenPoint = schematicToScreen(
      label.point.x,
      label.point.y,
      viewport,
    );
    ctx.fillText(label.text, screenPoint.x, screenPoint.y);
  }

  ctx.restore();
}

export function renderSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
  viewport: Viewport,
  options: SymbolRenderOptions = {},
): void {
  ctx.save();
  applySymbolTransform(ctx, symbol, viewport);
  ctx.strokeStyle = options.selected ? "#e0f2fe" : "#cbd5e1";
  ctx.globalAlpha = options.preview ? 0.75 : 1;
  renderBody(ctx, symbol);
  renderPins(ctx, symbol, viewport, options.selected ?? false);
  ctx.restore();

  if (!options.preview) {
    renderSymbolLabels(ctx, symbol, viewport);
  }
}
