import type {
  ParsedKicadSymbol,
  ParsedKicadSymbolGraphic,
  ParsedKicadSymbolPin,
  KicadImportWarning,
} from "../../lib/api/component-api";
import type {
  ArcGraphic,
  CircleGraphic,
  PinSide,
  Point,
  PolygonGraphic,
  RectGraphic,
  SymbolDraft,
  SymbolGraphic,
  SymbolPin,
  TextGraphic,
} from "./types";
import {
  DEFAULT_BODY_HEIGHT,
  DEFAULT_BODY_WIDTH,
  DEFAULT_PIN_LENGTH,
  GRID_SIZES,
  createEmptyDraft,
  PASSIVE_BODY_WIDTH,
  PASSIVE_BODY_HEIGHT,
} from "./types";

type KicadNode = unknown[];

export type ImportedSymbolClassificationKind =
  | "two-terminal-passive"
  | "rectangular-ic"
  | "multi-unit-rectangular-ic"
  | "unsupported";

export type ImportedSymbolClassification =
  | {
      kind:
        | "two-terminal-passive"
        | "rectangular-ic"
        | "multi-unit-rectangular-ic";
      reason: null;
    }
  | {
      kind: "unsupported";
      reason: string;
    };

const NM_PER_MM = 1_000_000;
const IMPORT_GRID_STEP_NM = GRID_SIZES.normal;
const IMPORT_GRID_PITCH_NM = IMPORT_GRID_STEP_NM * 2;
const IMPORTED_IC_MIN_BODY_WIDTH_NM = IMPORT_GRID_STEP_NM * 4;
const IMPORTED_IC_MAX_BODY_WIDTH_NM = IMPORT_GRID_STEP_NM * 8;
const IMPORT_NORMALIZATION_SKIPPED_WARNING_CODE =
  "import_normalization_skipped";

function mmToNm(value: number): number {
  return Math.round(value * NM_PER_MM);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNode(value: unknown): KicadNode | null {
  return Array.isArray(value) ? value : null;
}

function nodeTag(node: KicadNode): string | null {
  return typeof node[0] === "string" ? node[0] : null;
}

function findChild(node: KicadNode | null, tag: string): KicadNode | null {
  if (!node) return null;
  for (const child of node) {
    if (!Array.isArray(child)) continue;
    if (child[0] === tag) return child;
  }
  return null;
}

function findChildren(node: KicadNode | null, tag: string): KicadNode[] {
  if (!node) return [];
  return node.filter(
    (child): child is KicadNode => Array.isArray(child) && child[0] === tag,
  );
}

function parsePointNode(node: KicadNode | null): Point | null {
  if (!node) return null;
  const x = toNumber(node[1]);
  const y = toNumber(node[2]);
  if (x === null || y === null) return null;
  return { x: mmToNm(x), y: mmToNm(y) };
}

function parseStrokeWidthMm(node: KicadNode): number {
  const strokeNode = findChild(node, "stroke");
  const widthNode = findChild(strokeNode, "width");
  return toNumber(widthNode?.[1]) ?? 0.2;
}

function parseFill(node: KicadNode): boolean {
  const fillNode = findChild(node, "fill");
  const typeNode = findChild(fillNode, "type");
  const fillType = typeof typeNode?.[1] === "string" ? typeNode[1] : "none";
  return fillType !== "none";
}

function mapElectricalType(input: string): SymbolPin["electricalType"] {
  switch (input) {
    case "passive":
    case "input":
    case "output":
    case "bidirectional":
    case "power_in":
    case "power_out":
    case "open_collector":
    case "open_emitter":
    case "unspecified":
      return input;
    case "tri_state":
      return "bidirectional";
    default:
      return "unspecified";
  }
}

function rotationToSide(rotation: number): SymbolPin["side"] {
  const normalized = ((Math.round(rotation) % 360) + 360) % 360;
  if (normalized === 0) return "left";
  if (normalized === 90) return "bottom";
  if (normalized === 180) return "right";
  if (normalized === 270) return "top";
  return "left";
}

function createSupportedClassification(
  kind: Exclude<ImportedSymbolClassificationKind, "unsupported">,
): ImportedSymbolClassification {
  return { kind, reason: null };
}

function createUnsupportedClassification(
  reason: string,
): ImportedSymbolClassification {
  return { kind: "unsupported", reason };
}

function describeUnsupportedMultiUnitReason(
  unit: number,
  classification: ImportedSymbolClassification,
): string {
  if (classification.kind === "unsupported") {
    return `multi-unit symbol has unsupported unit ${unit}: ${classification.reason}`;
  }

  return `multi-unit symbol has non-rectangular unit ${unit}: classified as ${classification.kind}`;
}

function hasSingleRectangleBody(graphics: ParsedKicadSymbolGraphic[]): boolean {
  return (
    graphics.filter((graphic) => {
      const node = toNode(graphic.node);
      return node !== null && nodeTag(node) === "rectangle";
    }).length === 1
  );
}

function getSideCounts(
  pins: ParsedKicadSymbolPin[],
): Record<SymbolPin["side"], number> {
  const counts: Record<SymbolPin["side"], number> = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  };

  for (const pin of pins) {
    counts[rotationToSide(pin.rotation)] += 1;
  }

  return counts;
}

function getUsedSides(
  sideCounts: Record<SymbolPin["side"], number>,
): SymbolPin["side"][] {
  return (Object.entries(sideCounts) as Array<[SymbolPin["side"], number]>)
    .filter(([, count]) => count > 0)
    .map(([side]) => side);
}

function isOppositeSidePair(sides: SymbolPin["side"][]): boolean {
  if (sides.length !== 2) {
    return false;
  }

  return (
    (sides.includes("left") && sides.includes("right")) ||
    (sides.includes("top") && sides.includes("bottom"))
  );
}

function classifySingleUnitSymbol(
  pins: ParsedKicadSymbolPin[],
  graphics: ParsedKicadSymbolGraphic[],
): ImportedSymbolClassification {
  if (pins.length === 0) {
    return createUnsupportedClassification(
      "graphics-only symbol has no pins to classify",
    );
  }

  const visiblePins = pins.filter((pin) => !pin.hidden);
  if (visiblePins.length === 0) {
    return createUnsupportedClassification(
      "symbol has no visible pins to classify",
    );
  }

  const sideCounts = getSideCounts(pins);
  const usedSides = getUsedSides(sideCounts);
  const hasRectangleBody = hasSingleRectangleBody(graphics);

  if (pins.length === 2 && isOppositeSidePair(usedSides)) {
    return createSupportedClassification("two-terminal-passive");
  }

  if (
    pins.length === 3 &&
    hasRectangleBody &&
    sideCounts.left === 1 &&
    sideCounts.right === 1 &&
    ((sideCounts.top === 1 && sideCounts.bottom === 0) ||
      (sideCounts.bottom === 1 && sideCounts.top === 0))
  ) {
    return createSupportedClassification("rectangular-ic");
  }

  if (
    pins.length >= 3 &&
    sideCounts.left > 0 &&
    sideCounts.right > 0 &&
    sideCounts.top === 0 &&
    sideCounts.bottom === 0 &&
    (graphics.length === 0 || hasRectangleBody)
  ) {
    return createSupportedClassification("rectangular-ic");
  }

  if (usedSides.length >= 3) {
    return createUnsupportedClassification(
      `pin distribution spans ${usedSides.length} sides`,
    );
  }

  if (
    pins.length >= 3 &&
    sideCounts.left > 0 &&
    sideCounts.right > 0 &&
    sideCounts.top === 0 &&
    sideCounts.bottom === 0 &&
    graphics.length > 0 &&
    !hasRectangleBody
  ) {
    return createUnsupportedClassification(
      "ic-like pin layout lacks a single rectangular body graphic",
    );
  }

  return createUnsupportedClassification(
    "pin layout does not match supported v1 archetypes",
  );
}

export function classifyImportedSymbol(
  parsed: Pick<ParsedKicadSymbol, "pins" | "bodyGraphics" | "units">,
): ImportedSymbolClassification {
  const unitCount = Math.max(parsed.units, 1);
  if (unitCount <= 1) {
    return classifySingleUnitSymbol(parsed.pins, parsed.bodyGraphics);
  }

  const pinsByUnit = new Map<number, ParsedKicadSymbolPin[]>();
  for (const pin of parsed.pins) {
    const unit = getUnitNumber(pin.unit);
    pinsByUnit.set(unit, [...(pinsByUnit.get(unit) ?? []), pin]);
  }

  const graphicsByUnit = new Map<number, ParsedKicadSymbolGraphic[]>();
  for (const graphic of parsed.bodyGraphics) {
    const unit = graphic.unit > 0 ? graphic.unit : 0;
    graphicsByUnit.set(unit, [...(graphicsByUnit.get(unit) ?? []), graphic]);
  }

  const sharedGraphics = graphicsByUnit.get(0) ?? [];

  for (let unit = 1; unit <= unitCount; unit += 1) {
    const pins = pinsByUnit.get(unit) ?? [];
    const graphics = graphicsByUnit.get(unit) ?? sharedGraphics;
    const classification = classifySingleUnitSymbol(pins, graphics);
    if (classification.kind !== "rectangular-ic") {
      return createUnsupportedClassification(
        describeUnsupportedMultiUnitReason(unit, classification),
      );
    }
  }

  return createSupportedClassification("multi-unit-rectangular-ic");
}

function convertPin(pin: ParsedKicadSymbolPin): SymbolPin {
  return {
    id: crypto.randomUUID(),
    name: pin.name,
    number: pin.number,
    electricalType: mapElectricalType(pin.electricalType),
    side: rotationToSide(pin.rotation),
    position: {
      x: mmToNm(pin.position.x),
      y: mmToNm(pin.position.y),
    },
    length: mmToNm(pin.length),
  };
}

function cloneGraphicWithId(graphic: SymbolGraphic, id: string): SymbolGraphic {
  return { ...graphic, id } as SymbolGraphic;
}

function convertRectangle(node: KicadNode, index: number): RectGraphic | null {
  const start = parsePointNode(findChild(node, "start"));
  const end = parsePointNode(findChild(node, "end"));
  if (!start || !end) return null;

  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  return {
    id: `kicad-rect-${index}`,
    type: "rect",
    x: minX,
    y: minY,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    filled: parseFill(node),
    strokeWidth: parseStrokeWidthMm(node),
    zIndex: index,
  };
}

function convertPolyline(
  node: KicadNode,
  index: number,
): PolygonGraphic | null {
  const ptsNode = findChild(node, "pts");
  const xyNodes = findChildren(ptsNode, "xy");
  const points = xyNodes
    .map((xyNode) => parsePointNode(xyNode))
    .filter((point): point is Point => point !== null);
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const closed = Boolean(
    first && last && first.x === last.x && first.y === last.y,
  );

  return {
    id: `kicad-poly-${index}`,
    type: "polygon",
    points,
    filled: parseFill(node),
    closed,
    strokeWidth: parseStrokeWidthMm(node),
    zIndex: index,
  };
}

function convertCircle(node: KicadNode, index: number): CircleGraphic | null {
  const center = parsePointNode(findChild(node, "center"));
  if (!center) return null;

  const radiusNode = findChild(node, "radius");
  const radiusMm = toNumber(radiusNode?.[1]);
  if (radiusMm !== null) {
    return {
      id: `kicad-circle-${index}`,
      type: "circle",
      cx: center.x,
      cy: center.y,
      radius: mmToNm(radiusMm),
      filled: parseFill(node),
      strokeWidth: parseStrokeWidthMm(node),
      zIndex: index,
    };
  }

  const end = parsePointNode(findChild(node, "end"));
  if (!end) return null;

  return {
    id: `kicad-circle-${index}`,
    type: "circle",
    cx: center.x,
    cy: center.y,
    radius: Math.hypot(end.x - center.x, end.y - center.y),
    filled: parseFill(node),
    strokeWidth: parseStrokeWidthMm(node),
    zIndex: index,
  };
}

function solveCircleFromThreePoints(
  start: Point,
  mid: Point,
  end: Point,
): {
  cx: number;
  cy: number;
  radius: number;
} | null {
  const x1 = start.x;
  const y1 = start.y;
  const x2 = mid.x;
  const y2 = mid.y;
  const x3 = end.x;
  const y3 = end.y;

  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) < 1e-9) return null;

  const ux =
    ((x1 * x1 + y1 * y1) * (y2 - y3) +
      (x2 * x2 + y2 * y2) * (y3 - y1) +
      (x3 * x3 + y3 * y3) * (y1 - y2)) /
    d;
  const uy =
    ((x1 * x1 + y1 * y1) * (x3 - x2) +
      (x2 * x2 + y2 * y2) * (x1 - x3) +
      (x3 * x3 + y3 * y3) * (x2 - x1)) /
    d;

  return {
    cx: ux,
    cy: uy,
    radius: Math.hypot(x1 - ux, y1 - uy),
  };
}

function convertArc(node: KicadNode, index: number): ArcGraphic | null {
  const start = parsePointNode(findChild(node, "start"));
  const mid = parsePointNode(findChild(node, "mid"));
  const end = parsePointNode(findChild(node, "end"));
  if (!start || !mid || !end) return null;

  const circle = solveCircleFromThreePoints(start, mid, end);
  if (!circle) return null;

  const startAngle =
    (Math.atan2(start.y - circle.cy, start.x - circle.cx) * 180) / Math.PI;
  const endAngle =
    (Math.atan2(end.y - circle.cy, end.x - circle.cx) * 180) / Math.PI;

  return {
    id: `kicad-arc-${index}`,
    type: "arc",
    cx: circle.cx,
    cy: circle.cy,
    radius: circle.radius,
    startAngle,
    endAngle,
    strokeWidth: parseStrokeWidthMm(node),
    zIndex: index,
  };
}

function convertText(node: KicadNode, index: number): TextGraphic | null {
  const content = typeof node[1] === "string" ? node[1] : "";
  const atNode = findChild(node, "at");
  const point = parsePointNode(atNode);
  if (!point) return null;

  const rotation = toNumber(atNode?.[3]) ?? 0;
  const fontSizeNode = findChild(
    findChild(findChild(node, "effects"), "font"),
    "size",
  );
  const fontSizeMm = toNumber(fontSizeNode?.[1]) ?? 1.27;

  return {
    id: `kicad-text-${index}`,
    type: "text",
    x: point.x,
    y: point.y,
    content,
    fontSize: fontSizeMm,
    rotation,
    zIndex: index,
  };
}

export function convertBodyGraphic(
  node: unknown,
  index: number,
): SymbolGraphic | null {
  const list = toNode(node);
  if (!list) return null;

  const tag = nodeTag(list);
  if (!tag) return null;

  if (tag === "rectangle") return convertRectangle(list, index);
  if (tag === "polyline") return convertPolyline(list, index);
  if (tag === "circle") return convertCircle(list, index);
  if (tag === "arc") return convertArc(list, index);
  if (tag === "text") return convertText(list, index);

  return null;
}

function addGraphicBounds(
  graphic: SymbolGraphic,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  if (graphic.type === "line") {
    bounds.minX = Math.min(bounds.minX, graphic.x1, graphic.x2);
    bounds.minY = Math.min(bounds.minY, graphic.y1, graphic.y2);
    bounds.maxX = Math.max(bounds.maxX, graphic.x1, graphic.x2);
    bounds.maxY = Math.max(bounds.maxY, graphic.y1, graphic.y2);
    return;
  }

  if (graphic.type === "rect") {
    bounds.minX = Math.min(bounds.minX, graphic.x);
    bounds.minY = Math.min(bounds.minY, graphic.y);
    bounds.maxX = Math.max(bounds.maxX, graphic.x + graphic.width);
    bounds.maxY = Math.max(bounds.maxY, graphic.y + graphic.height);
    return;
  }

  if (graphic.type === "circle") {
    bounds.minX = Math.min(bounds.minX, graphic.cx - graphic.radius);
    bounds.minY = Math.min(bounds.minY, graphic.cy - graphic.radius);
    bounds.maxX = Math.max(bounds.maxX, graphic.cx + graphic.radius);
    bounds.maxY = Math.max(bounds.maxY, graphic.cy + graphic.radius);
    return;
  }

  if (graphic.type === "arc") {
    bounds.minX = Math.min(bounds.minX, graphic.cx - graphic.radius);
    bounds.minY = Math.min(bounds.minY, graphic.cy - graphic.radius);
    bounds.maxX = Math.max(bounds.maxX, graphic.cx + graphic.radius);
    bounds.maxY = Math.max(bounds.maxY, graphic.cy + graphic.radius);
    return;
  }

  if (graphic.type === "polygon") {
    for (const point of graphic.points) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
    return;
  }

  if (graphic.type === "bezier") {
    for (const point of graphic.points) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
    return;
  }

  bounds.minX = Math.min(bounds.minX, graphic.x);
  bounds.minY = Math.min(bounds.minY, graphic.y);
  bounds.maxX = Math.max(bounds.maxX, graphic.x);
  bounds.maxY = Math.max(bounds.maxY, graphic.y);
}

function getBodyDimensions(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): { width: number; height: number } {
  if (pins.length === 0 && graphics.length === 0) {
    return { width: DEFAULT_BODY_WIDTH, height: DEFAULT_BODY_HEIGHT };
  }

  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const pin of pins) {
    bounds.minX = Math.min(bounds.minX, pin.position.x);
    bounds.minY = Math.min(bounds.minY, pin.position.y);
    bounds.maxX = Math.max(bounds.maxX, pin.position.x);
    bounds.maxY = Math.max(bounds.maxY, pin.position.y);
  }

  for (const graphic of graphics) {
    addGraphicBounds(graphic, bounds);
  }

  const width = Math.max(DEFAULT_BODY_WIDTH, bounds.maxX - bounds.minX);
  const height = Math.max(DEFAULT_BODY_HEIGHT, bounds.maxY - bounds.minY);
  return { width, height };
}

function getContentBounds(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (pins.length === 0 && graphics.length === 0) {
    return null;
  }

  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const pin of pins) {
    let bodyEndX = pin.position.x;
    let bodyEndY = pin.position.y;
    if (pin.side === "left") bodyEndX += pin.length;
    if (pin.side === "right") bodyEndX -= pin.length;
    if (pin.side === "top") bodyEndY -= pin.length;
    if (pin.side === "bottom") bodyEndY += pin.length;

    bounds.minX = Math.min(bounds.minX, pin.position.x, bodyEndX);
    bounds.minY = Math.min(bounds.minY, pin.position.y, bodyEndY);
    bounds.maxX = Math.max(bounds.maxX, pin.position.x, bodyEndX);
    bounds.maxY = Math.max(bounds.maxY, pin.position.y, bodyEndY);
  }

  for (const graphic of graphics) {
    addGraphicBounds(graphic, bounds);
  }

  return bounds;
}

function translateGraphics(
  graphics: SymbolGraphic[],
  dx: number,
  dy: number,
): SymbolGraphic[] {
  return graphics.map((graphic) => {
    switch (graphic.type) {
      case "line":
        return {
          ...graphic,
          x1: graphic.x1 + dx,
          y1: graphic.y1 + dy,
          x2: graphic.x2 + dx,
          y2: graphic.y2 + dy,
        };
      case "rect":
        return { ...graphic, x: graphic.x + dx, y: graphic.y + dy };
      case "circle":
        return { ...graphic, cx: graphic.cx + dx, cy: graphic.cy + dy };
      case "arc":
        return { ...graphic, cx: graphic.cx + dx, cy: graphic.cy + dy };
      case "polygon":
        return {
          ...graphic,
          points: graphic.points.map((point) => ({
            x: point.x + dx,
            y: point.y + dy,
          })),
        };
      case "bezier":
        return {
          ...graphic,
          points: graphic.points.map((point) => ({
            x: point.x + dx,
            y: point.y + dy,
          })) as typeof graphic.points,
        };
      case "text":
        return { ...graphic, x: graphic.x + dx, y: graphic.y + dy };
      default: {
        const exhaustive: never = graphic;
        return exhaustive;
      }
    }
  });
}

function centerImportedContent(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): { pins: SymbolPin[]; graphics: SymbolGraphic[] } {
  const bounds = getContentBounds(pins, graphics);
  if (!bounds) {
    return { pins, graphics };
  }

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  return {
    pins: pins.map((pin) => ({
      ...pin,
      position: {
        x: pin.position.x - centerX,
        y: pin.position.y - centerY,
      },
    })),
    graphics: translateGraphics(graphics, -centerX, -centerY),
  };
}

function clampImportedIcBodyWidth(height: number): number {
  return Math.max(
    IMPORTED_IC_MIN_BODY_WIDTH_NM,
    Math.min(IMPORTED_IC_MAX_BODY_WIDTH_NM, height),
  );
}

function snapToImportGrid(value: number): number {
  return Math.round(value / IMPORT_GRID_STEP_NM) * IMPORT_GRID_STEP_NM;
}

function getGraphicBounds(
  graphics: SymbolGraphic[],
  includeText = true,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const filtered = includeText
    ? graphics
    : graphics.filter((graphic) => graphic.type !== "text");
  if (filtered.length === 0) {
    return null;
  }

  return getContentBounds([], filtered);
}

function getSidePinCounts(pins: SymbolPin[]): Record<PinSide, number> {
  const counts: Record<PinSide, number> = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  };

  for (const pin of pins) {
    counts[pin.side] += 1;
  }

  return counts;
}

function getCanonicalSideAxisPositions(side: PinSide, count: number): number[] {
  if (count <= 0) {
    return [];
  }

  const positions = Array.from({ length: count }, (_, index) =>
    snapToImportGrid((index - (count - 1) / 2) * IMPORT_GRID_PITCH_NM),
  );

  return side === "left" || side === "right"
    ? [...positions].sort((a, b) => b - a)
    : positions;
}

function normalizeRectGraphicToBounds(
  graphic: RectGraphic,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): RectGraphic {
  return {
    ...graphic,
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

function scaleGraphicPoint(
  point: Point,
  sourceBounds: { minX: number; minY: number; maxX: number; maxY: number },
  targetBounds: { minX: number; minY: number; maxX: number; maxY: number },
): Point {
  const sourceWidth = sourceBounds.maxX - sourceBounds.minX;
  const sourceHeight = sourceBounds.maxY - sourceBounds.minY;
  const targetWidth = targetBounds.maxX - targetBounds.minX;
  const targetHeight = targetBounds.maxY - targetBounds.minY;
  const normalizedX =
    sourceWidth === 0 ? 0.5 : (point.x - sourceBounds.minX) / sourceWidth;
  const normalizedY =
    sourceHeight === 0 ? 0.5 : (point.y - sourceBounds.minY) / sourceHeight;

  return {
    x: targetBounds.minX + normalizedX * targetWidth,
    y: targetBounds.minY + normalizedY * targetHeight,
  };
}

function scaleGraphicsIntoBounds(
  graphics: SymbolGraphic[],
  sourceBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null,
  targetBounds: { minX: number; minY: number; maxX: number; maxY: number },
): SymbolGraphic[] {
  if (!sourceBounds) {
    return graphics;
  }

  const sourceWidth = sourceBounds.maxX - sourceBounds.minX;
  const sourceHeight = sourceBounds.maxY - sourceBounds.minY;
  const targetWidth = targetBounds.maxX - targetBounds.minX;
  const targetHeight = targetBounds.maxY - targetBounds.minY;
  const scaleX = sourceWidth === 0 ? 1 : targetWidth / sourceWidth;
  const scaleY = sourceHeight === 0 ? 1 : targetHeight / sourceHeight;
  const uniformScale = Math.min(Math.abs(scaleX), Math.abs(scaleY));

  return graphics.map((graphic) => {
    switch (graphic.type) {
      case "text": {
        const pos = scaleGraphicPoint(
          { x: graphic.x, y: graphic.y },
          sourceBounds,
          targetBounds,
        );
        return {
          ...graphic,
          x: pos.x,
          y: pos.y,
          fontSize: graphic.fontSize * uniformScale,
        };
      }
      case "line": {
        const start = scaleGraphicPoint(
          { x: graphic.x1, y: graphic.y1 },
          sourceBounds,
          targetBounds,
        );
        const end = scaleGraphicPoint(
          { x: graphic.x2, y: graphic.y2 },
          sourceBounds,
          targetBounds,
        );
        return {
          ...graphic,
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
        };
      }
      case "rect": {
        const topLeft = scaleGraphicPoint(
          { x: graphic.x, y: graphic.y },
          sourceBounds,
          targetBounds,
        );
        const bottomRight = scaleGraphicPoint(
          { x: graphic.x + graphic.width, y: graphic.y + graphic.height },
          sourceBounds,
          targetBounds,
        );
        return {
          ...graphic,
          x: topLeft.x,
          y: topLeft.y,
          width: bottomRight.x - topLeft.x,
          height: bottomRight.y - topLeft.y,
        };
      }
      case "circle": {
        const center = scaleGraphicPoint(
          { x: graphic.cx, y: graphic.cy },
          sourceBounds,
          targetBounds,
        );
        return {
          ...graphic,
          cx: center.x,
          cy: center.y,
          radius: graphic.radius * uniformScale,
        };
      }
      case "arc": {
        const center = scaleGraphicPoint(
          { x: graphic.cx, y: graphic.cy },
          sourceBounds,
          targetBounds,
        );
        return {
          ...graphic,
          cx: center.x,
          cy: center.y,
          radius: graphic.radius * uniformScale,
        };
      }
      case "polygon":
        return {
          ...graphic,
          points: graphic.points.map((point) =>
            scaleGraphicPoint(point, sourceBounds, targetBounds),
          ),
        };
      case "bezier":
        return {
          ...graphic,
          points: graphic.points.map((point) =>
            scaleGraphicPoint(point, sourceBounds, targetBounds),
          ) as typeof graphic.points,
        };
      default:
        return graphic;
    }
  });
}

function getBodyGraphicBoundsForDraft(
  graphics: SymbolGraphic[],
): { width: number; height: number } | null {
  const bounds = getGraphicBounds(graphics, false);
  if (!bounds) {
    return null;
  }

  return {
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

function getNormalizedDraftBodyDimensions(
  classification: ImportedSymbolClassification,
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): { width: number; height: number } {
  const graphicBounds = getBodyGraphicBoundsForDraft(graphics);
  if (classification.kind === "two-terminal-passive") {
    return (
      graphicBounds ?? {
        width: PASSIVE_BODY_WIDTH,
        height: PASSIVE_BODY_HEIGHT,
      }
    );
  }

  if (
    classification.kind === "rectangular-ic" ||
    classification.kind === "multi-unit-rectangular-ic"
  ) {
    return (
      graphicBounds ?? {
        width: DEFAULT_BODY_WIDTH,
        height: DEFAULT_BODY_HEIGHT,
      }
    );
  }

  return getBodyDimensions(pins, graphics);
}

function normalizeTwoTerminalPassiveLayout(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): { pins: SymbolPin[]; graphics: SymbolGraphic[] } {
  const isVertical = pins.some(
    (pin) => pin.side === "top" || pin.side === "bottom",
  );
  const bodyWidth = isVertical ? PASSIVE_BODY_HEIGHT : PASSIVE_BODY_WIDTH;
  const bodyHeight = isVertical ? PASSIVE_BODY_WIDTH : PASSIVE_BODY_HEIGHT;
  const halfBodyWidth = bodyWidth / 2;
  const halfBodyHeight = bodyHeight / 2;
  const targetBounds = {
    minX: -halfBodyWidth,
    minY: -halfBodyHeight,
    maxX: halfBodyWidth,
    maxY: halfBodyHeight,
  };

  return {
    pins: pins.map((pin) => ({
      ...pin,
      position:
        pin.side === "left"
          ? { x: -(halfBodyWidth + DEFAULT_PIN_LENGTH), y: 0 }
          : pin.side === "right"
            ? { x: halfBodyWidth + DEFAULT_PIN_LENGTH, y: 0 }
            : pin.side === "top"
              ? { x: 0, y: halfBodyHeight + DEFAULT_PIN_LENGTH }
              : { x: 0, y: -(halfBodyHeight + DEFAULT_PIN_LENGTH) },
      length: DEFAULT_PIN_LENGTH,
    })),
    graphics:
      graphics.length > 0
        ? scaleGraphicsIntoBounds(
            graphics,
            getGraphicBounds(graphics, false),
            targetBounds,
          )
        : [
            {
              id: crypto.randomUUID(),
              type: "rect",
              zIndex: 0,
              x: targetBounds.minX,
              y: targetBounds.minY,
              width: bodyWidth,
              height: bodyHeight,
              filled: false,
              strokeWidth: 0.0254,
            },
          ],
  };
}

function normalizeRectangularIcLayout(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): { pins: SymbolPin[]; graphics: SymbolGraphic[] } {
  const sideCounts = getSidePinCounts(pins);
  const verticalPinCount = Math.max(sideCounts.left, sideCounts.right, 1);
  const horizontalPinCount = Math.max(sideCounts.top, sideCounts.bottom, 1);
  const bodyHeight = snapToImportGrid(
    Math.max(
      DEFAULT_BODY_HEIGHT,
      (verticalPinCount + 1) * IMPORT_GRID_PITCH_NM,
    ),
  );
  const bodyWidth = snapToImportGrid(
    Math.max(
      clampImportedIcBodyWidth(bodyHeight),
      DEFAULT_BODY_WIDTH,
      (horizontalPinCount + 1) * IMPORT_GRID_PITCH_NM,
    ),
  );
  const halfBodyWidth = bodyWidth / 2;
  const halfBodyHeight = bodyHeight / 2;
  const axisPositions: Record<PinSide, number[]> = {
    left: getCanonicalSideAxisPositions("left", sideCounts.left),
    right: getCanonicalSideAxisPositions("right", sideCounts.right),
    top: getCanonicalSideAxisPositions("top", sideCounts.top),
    bottom: getCanonicalSideAxisPositions("bottom", sideCounts.bottom),
  };
  const sideIndexes: Record<PinSide, number> = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  };
  const rectBounds = {
    minX: -halfBodyWidth,
    minY: -halfBodyHeight,
    maxX: halfBodyWidth,
    maxY: halfBodyHeight,
  };
  const bodyGraphic = graphics.find((graphic) => graphic.type === "rect") as
    | RectGraphic
    | undefined;

  return {
    pins: pins.map((pin) => {
      const slotIndex = sideIndexes[pin.side];
      sideIndexes[pin.side] += 1;
      const axis = axisPositions[pin.side][slotIndex] ?? 0;

      return {
        ...pin,
        position:
          pin.side === "left"
            ? { x: -(halfBodyWidth + DEFAULT_PIN_LENGTH), y: axis }
            : pin.side === "right"
              ? { x: halfBodyWidth + DEFAULT_PIN_LENGTH, y: axis }
              : pin.side === "top"
                ? { x: axis, y: halfBodyHeight + DEFAULT_PIN_LENGTH }
                : { x: axis, y: -(halfBodyHeight + DEFAULT_PIN_LENGTH) },
        length: DEFAULT_PIN_LENGTH,
      };
    }),
    graphics: [
      normalizeRectGraphicToBounds(
        bodyGraphic ?? {
          id: crypto.randomUUID(),
          type: "rect",
          zIndex: 0,
          x: rectBounds.minX,
          y: rectBounds.minY,
          width: bodyWidth,
          height: bodyHeight,
          filled: false,
          strokeWidth: 0.0254,
        },
        rectBounds,
      ),
      ...graphics.filter((graphic) => graphic.type === "text"),
    ],
  };
}

function normalizeImportedSchematicContent(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
  classification: ImportedSymbolClassification,
): { pins: SymbolPin[]; graphics: SymbolGraphic[] } {
  if (classification.kind === "two-terminal-passive") {
    return normalizeTwoTerminalPassiveLayout(pins, graphics);
  }

  if (
    classification.kind === "rectangular-ic" ||
    classification.kind === "multi-unit-rectangular-ic"
  ) {
    return normalizeRectangularIcLayout(pins, graphics);
  }

  return { pins, graphics };
}

function toWarningMessages(
  parserWarnings: KicadImportWarning[],
  droppedGraphics: number,
  symbolCount: number,
  unitCount: number,
  classification: ImportedSymbolClassification,
): KicadImportWarning[] {
  const warnings = [...parserWarnings];

  if (droppedGraphics > 0) {
    warnings.push({
      code: "unsupported_graphics_dropped",
      message: `${droppedGraphics} unsupported KiCAD graphic elements were skipped`,
    });
  }

  if (symbolCount > 1) {
    warnings.push({
      code: "multi_symbol_file",
      message: `File contains ${symbolCount} symbols; imported the first symbol only`,
    });
  }

  if (unitCount > 1) {
    warnings.push({
      code: "multi_unit_combined",
      message: `Combined ${unitCount} symbol units into one editable view`,
    });
  }

  if (classification.kind === "unsupported") {
    warnings.push({
      code: IMPORT_NORMALIZATION_SKIPPED_WARNING_CODE,
      message:
        unitCount > 1
          ? `Skipped canonical normalization for all ${unitCount} units and preserved converted geometry because ${classification.reason}`
          : `Skipped canonical normalization and preserved converted geometry because ${classification.reason}`,
    });
  }

  return warnings;
}

function convertGraphics(
  bodyGraphics: ParsedKicadSymbolGraphic[],
  startIndex = 0,
): { graphics: SymbolGraphic[]; droppedGraphics: number } {
  let droppedGraphics = 0;
  const graphics = bodyGraphics
    .map((entry, index) => {
      const converted = convertBodyGraphic(entry.node, startIndex + index);
      if (!converted) {
        droppedGraphics += 1;
      }
      return converted;
    })
    .filter((graphic): graphic is SymbolGraphic => graphic !== null);

  return { graphics, droppedGraphics };
}

function getUnitNumber(unit: number): number {
  return unit > 0 ? unit : 1;
}

function getNormalizedUnitContent(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
  classification: ImportedSymbolClassification,
): {
  pins: SymbolPin[];
  graphics: SymbolGraphic[];
  width: number;
  height: number;
} {
  const centered = centerImportedContent(pins, graphics);
  const normalized = normalizeImportedSchematicContent(
    centered.pins,
    centered.graphics,
    classification,
  );
  const bounds = getContentBounds(normalized.pins, normalized.graphics);
  return {
    ...normalized,
    width: bounds ? bounds.maxX - bounds.minX : DEFAULT_BODY_WIDTH,
    height: bounds ? bounds.maxY - bounds.minY : DEFAULT_BODY_HEIGHT,
  };
}

function combineUnits(
  parsed: ParsedKicadSymbol,
  classification: ImportedSymbolClassification,
): {
  pins: SymbolPin[];
  graphics: SymbolGraphic[];
  droppedGraphics: number;
} {
  const parsedPinsByUnit = new Map<number, ParsedKicadSymbolPin[]>();
  for (const pin of parsed.pins) {
    const unit = getUnitNumber(pin.unit);
    parsedPinsByUnit.set(unit, [...(parsedPinsByUnit.get(unit) ?? []), pin]);
  }

  const graphicsByUnit = new Map<number, ParsedKicadSymbolGraphic[]>();
  for (const graphic of parsed.bodyGraphics) {
    const unit = graphic.unit > 0 ? graphic.unit : 0;
    graphicsByUnit.set(unit, [...(graphicsByUnit.get(unit) ?? []), graphic]);
  }

  const sharedGraphics = graphicsByUnit.get(0) ?? [];
  const unitCount = Math.max(parsed.units, 1);
  const units = Array.from({ length: unitCount }, (_, index) => index + 1);
  const unitClassification =
    classification.kind === "multi-unit-rectangular-ic"
      ? createSupportedClassification("rectangular-ic")
      : createUnsupportedClassification("unit-level normalization not required");
  const normalizedUnits = [] as Array<{
    pins: SymbolPin[];
    graphics: SymbolGraphic[];
    width: number;
    height: number;
  }>;
  let graphicIndex = 0;
  let droppedGraphics = 0;

  for (const unit of units) {
    const unitPins = (parsedPinsByUnit.get(unit) ?? []).map(convertPin);
    const unitGraphicsSource = graphicsByUnit.get(unit);
    const { graphics, droppedGraphics: dropped } = convertGraphics(
      unitGraphicsSource && unitGraphicsSource.length > 0
        ? unitGraphicsSource
        : sharedGraphics,
      graphicIndex,
    );
    graphicIndex +=
      (unitGraphicsSource && unitGraphicsSource.length > 0
        ? unitGraphicsSource.length
        : sharedGraphics.length) + 1;
    droppedGraphics += dropped;
    normalizedUnits.push(
      getNormalizedUnitContent(unitPins, graphics, unitClassification),
    );
  }

  if (normalizedUnits.length <= 1) {
    const single =
      normalizedUnits[0] ?? getNormalizedUnitContent([], [], unitClassification);
    return {
      pins: single.pins,
      graphics: single.graphics,
      droppedGraphics,
    };
  }

  const cols =
    normalizedUnits.length <= 3
      ? normalizedUnits.length
      : Math.ceil(Math.sqrt(normalizedUnits.length));
  const rows = Math.ceil(normalizedUnits.length / cols);
  const gutterX = DEFAULT_BODY_WIDTH / 2;
  const gutterY = DEFAULT_BODY_HEIGHT / 2;
  const colWidths = Array.from({ length: cols }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);

  normalizedUnits.forEach((unit, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    colWidths[col] = Math.max(
      colWidths[col] ?? 0,
      unit.width || DEFAULT_BODY_WIDTH,
    );
    rowHeights[row] = Math.max(
      rowHeights[row] ?? 0,
      unit.height || DEFAULT_BODY_HEIGHT,
    );
  });

  const totalWidth =
    colWidths.reduce((sum, value) => sum + value, 0) +
    gutterX * Math.max(cols - 1, 0);
  const totalHeight =
    rowHeights.reduce((sum, value) => sum + value, 0) +
    gutterY * Math.max(rows - 1, 0);

  const combinedPins: SymbolPin[] = [];
  const combinedGraphics: SymbolGraphic[] = [];

  normalizedUnits.forEach((unit, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const offsetX =
      -totalWidth / 2 +
      colWidths.slice(0, col).reduce((sum, value) => sum + value, 0) +
      gutterX * col +
      (colWidths[col] ?? DEFAULT_BODY_WIDTH) / 2;
    const offsetY =
      totalHeight / 2 -
      rowHeights.slice(0, row).reduce((sum, value) => sum + value, 0) -
      gutterY * row -
      (rowHeights[row] ?? DEFAULT_BODY_HEIGHT) / 2;

    combinedPins.push(
      ...unit.pins.map((pin) => ({
        ...pin,
        id: crypto.randomUUID(),
        position: {
          x: pin.position.x + offsetX,
          y: pin.position.y + offsetY,
        },
      })),
    );
    combinedGraphics.push(
      ...translateGraphics(unit.graphics, offsetX, offsetY).map((graphic) =>
        cloneGraphicWithId(graphic, crypto.randomUUID()),
      ),
    );
  });

  return { pins: combinedPins, graphics: combinedGraphics, droppedGraphics };
}

export function convertParsedKicadSymbolToDraft(
  parsed: ParsedKicadSymbol,
  fileName: string,
  symbolCount = 1,
): SymbolDraft {
  const draft = createEmptyDraft(crypto.randomUUID());
  const classification = classifyImportedSymbol(parsed);
  const { pins, graphics, droppedGraphics } = combineUnits(parsed, classification);
  const centered =
    parsed.units > 1
      ? { pins, graphics }
      : centerImportedContent(pins, graphics);
  const normalized =
    parsed.units > 1
      ? centered
      : normalizeImportedSchematicContent(
          centered.pins,
          centered.graphics,
          classification,
        );

  if (normalized.pins.length === 0 && normalized.graphics.length === 0) {
    throw new Error("Imported symbol contains no renderable pins or graphics");
  }

  const bodyDimensions = getNormalizedDraftBodyDimensions(
    classification,
    normalized.pins,
    normalized.graphics,
  );

  return {
    ...draft,
    metadata: {
      name: parsed.properties.Value ?? parsed.name,
      referencePrefix: parsed.properties.Reference ?? "U",
      description: parsed.properties.Description ?? "",
    },
    body: {
      kind: "blank",
      width: bodyDimensions.width,
      height: bodyDimensions.height,
    },
    pins: normalized.pins,
    graphics: normalized.graphics,
    importPreservation: {
      rawSource: parsed.rawSource,
      sourceFileName: fileName,
      warnings: toWarningMessages(
        parsed.warnings,
        droppedGraphics,
        symbolCount,
        parsed.units,
        classification,
      ),
      unitCount: parsed.units,
      graphicsEditable: true,
    },
  };
}

export async function importKicadSymbolFile(file: File): Promise<SymbolDraft> {
  const content = await file.text();
  const { parseKicadSymbolImport } = await import(
    "../../lib/api/component-api"
  );
  const parsed = await parseKicadSymbolImport(content, file.name);
  return convertParsedKicadSymbolToDraft(
    parsed.symbol,
    parsed.fileName ?? file.name,
    parsed.availableSymbols.length,
  );
}
