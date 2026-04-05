import type { Bounds, Point, SymbolEntity, Viewport } from "../types";
import type { SymbolColors } from "@/lib/canvas-theme";
import { schematicToScreen } from "./viewport";
import { DEFAULT_SCHEMATIC_ZOOM } from "./viewport";
import { getSymbolKindLabel } from "../symbol-display";
import { renderGraphicLocal } from "@/lib/canvas-core/graphics";
import { renderPinsLocal } from "@/lib/canvas-core/pins";

const RECT_PADDING_X = 220_000;
const RECT_PADDING_Y = 220_000;
const MIN_RECT_WIDTH = 760_000;
const MIN_RECT_HEIGHT = 760_000;
const STROKE_WIDTH_PX = 1.75;
const BODY_LABEL_OFFSET_NM = 420_000;
const PIN_LABEL_OFFSET_NM = 220_000;

interface SymbolRenderOptions {
  selected?: boolean;
  preview?: boolean;
  colors?: SymbolColors;
  connectedPinIds?: Set<string>;
}

interface PinExtents {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface SymbolTextLabel {
  text: string;
  point: Point;
  align?: CanvasTextAlign;
}

function hasImportedSymbolBody(symbol: SymbolEntity): boolean {
  return Boolean(symbol.graphics && symbol.graphics.length > 0);
}

function hasImportedPinMetadata(symbol: SymbolEntity): boolean {
  return symbol.pins.some((pin) => pin.side && typeof pin.length === "number");
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

export function getSymbolBodyLocalBounds(symbol: SymbolEntity): Bounds {
  // Use pre-computed bounds from the component library (always present for primitives-based symbols)
  if (symbol.bodyBounds) {
    return symbol.bodyBounds;
  }

  // Fallback: compute bounds from pin positions
  const extents = getPinExtents(symbol);
  if (!extents) {
    return { minX: -380_000, minY: -380_000, maxX: 380_000, maxY: 380_000 };
  }

  const center = getLocalCenter(symbol);
  const width = Math.max(
    extents.maxX - extents.minX + RECT_PADDING_X * 2,
    MIN_RECT_WIDTH,
  );
  const height = Math.max(
    extents.maxY - extents.minY + RECT_PADDING_Y * 2,
    MIN_RECT_HEIGHT,
  );
  return {
    minX: center.x - width / 2,
    minY: center.y - height / 2,
    maxX: center.x + width / 2,
    maxY: center.y + height / 2,
  };
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

function renderBody(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
  viewport: Viewport,
): void {
  if (!symbol.graphics || symbol.graphics.length === 0) {
    return;
  }

  for (const graphic of symbol.graphics) {
    renderGraphicLocal(ctx, graphic, viewport.zoom, STROKE_WIDTH_PX);
  }
}

function renderPins(
  ctx: CanvasRenderingContext2D,
  symbol: SymbolEntity,
  viewport: Viewport,
  options: SymbolRenderOptions = {},
): void {
  renderPinsLocal(ctx, symbol.pins, viewport.zoom, {
    selected: options.selected,
    connectedPinIds: options.connectedPinIds,
    colors: options.colors
      ? {
          pinDot: options.colors.pinDot,
          pinLabel: options.colors.pinLabel,
          pinConnected: options.colors.pinConnected,
          selectionStroke: options.colors.selectionStroke,
          background: options.colors.background,
        }
      : undefined,
  });
}

function getLabelFontSizePx(viewport: Viewport): number {
  const zoomScale = viewport.zoom / DEFAULT_SCHEMATIC_ZOOM;
  return Math.max(10, Math.min(16, 11 + Math.log2(Math.max(zoomScale, 0.25))));
}

function getPrimarySymbolLabel(symbol: SymbolEntity): string {
  if (symbol.linkStatus === "missing") {
    return `${symbol.reference} ⚠`;
  }

  if (symbol.symbolKind === "gnd") {
    return symbol.value || "GND";
  }

  if (symbol.symbolKind === "vcc") {
    return symbol.value || getSymbolKindLabel(symbol.symbolKind);
  }

  return symbol.reference;
}

function getSecondarySymbolLabel(symbol: SymbolEntity): string | null {
  if (hasImportedSymbolBody(symbol)) {
    return null;
  }

  if (symbol.symbolKind === "gnd" || symbol.symbolKind === "vcc") {
    return null;
  }

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
      primary: { x: 0, y: 420_000 },
      secondary: { x: 0, y: 0 },
    };
  }

  const bounds = getSymbolBodyLocalBounds(symbol);
  return {
    primary: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: bounds.minY - BODY_LABEL_OFFSET_NM,
    },
    secondary: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: bounds.maxY + BODY_LABEL_OFFSET_NM,
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

function getImportedPinNameLabel(
  pin: SymbolEntity["pins"][number],
): SymbolTextLabel | null {
  if (
    !pin.side ||
    typeof pin.length !== "number" ||
    pin.name.trim().length === 0
  ) {
    return null;
  }

  switch (pin.side) {
    case "left":
      return {
        text: pin.name,
        point: { x: pin.position.x + pin.length + 120_000, y: pin.position.y },
        align: "left",
      };
    case "right":
      return {
        text: pin.name,
        point: { x: pin.position.x - pin.length - 120_000, y: pin.position.y },
        align: "right",
      };
    case "top":
      return {
        text: pin.name,
        point: { x: pin.position.x, y: pin.position.y + pin.length + 160_000 },
        align: "center",
      };
    case "bottom":
      return {
        text: pin.name,
        point: { x: pin.position.x, y: pin.position.y - pin.length - 160_000 },
        align: "center",
      };
  }
}

function getImportedPinNumberLabel(
  pin: SymbolEntity["pins"][number],
): SymbolTextLabel | null {
  if (
    !pin.side ||
    typeof pin.number !== "string" ||
    pin.number.trim().length === 0
  ) {
    return null;
  }

  switch (pin.side) {
    case "left":
      return {
        text: pin.number,
        point: { x: pin.position.x - 180_000, y: pin.position.y },
        align: "right",
      };
    case "right":
      return {
        text: pin.number,
        point: { x: pin.position.x + 180_000, y: pin.position.y },
        align: "left",
      };
    case "top":
      return {
        text: pin.number,
        point: { x: pin.position.x, y: pin.position.y - 180_000 },
        align: "center",
      };
    case "bottom":
      return {
        text: pin.number,
        point: { x: pin.position.x, y: pin.position.y + 180_000 },
        align: "center",
      };
  }
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

  if (symbol.symbolKind === "gnd" || symbol.symbolKind === "vcc") {
    return labels;
  }

  if (hasImportedPinMetadata(symbol)) {
    for (const pin of symbol.pins) {
      const numberLabel = getImportedPinNumberLabel(pin);
      if (numberLabel) {
        labels.push({
          ...numberLabel,
          point: transformSymbolLocalPoint(symbol, numberLabel.point),
        });
      }

      const nameLabel = getImportedPinNameLabel(pin);
      if (nameLabel) {
        labels.push({
          ...nameLabel,
          point: transformSymbolLocalPoint(symbol, nameLabel.point),
        });
      }
    }

    return labels;
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
  colors?: SymbolColors,
): void {
  const fontSizePx = getLabelFontSizePx(viewport);

  ctx.save();
  ctx.fillStyle = colors?.valueLabel ?? "#cbd5e1";
  ctx.font = `${fontSizePx}px sans-serif`;
  ctx.textBaseline = "middle";

  for (const label of getSymbolTextLabels(symbol)) {
    ctx.textAlign = label.align ?? "center";
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
  if (options.selected) {
    ctx.strokeStyle = options.colors?.selectionStroke ?? "#e0f2fe";
  } else if (symbol.linkStatus === "missing") {
    ctx.strokeStyle = "#f97316";
  } else {
    ctx.strokeStyle = options.colors?.bodyStroke ?? "#cbd5e1";
  }
  ctx.globalAlpha = options.preview ? 0.75 : 1;
  renderBody(ctx, symbol, viewport);
  renderPins(ctx, symbol, viewport, options);
  ctx.restore();

  if (!options.preview) {
    renderSymbolLabels(ctx, symbol, viewport, options.colors);
  }
}
