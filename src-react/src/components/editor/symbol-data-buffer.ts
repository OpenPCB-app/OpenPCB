import {
  parseKicadSymbolImport,
  type ComponentType,
} from "@/lib/api/component-api";
import { convertParsedKicadSymbolToDraft } from "@/components/symbol-editor/kicad-import";
import {
  DEFAULT_BODY_HEIGHT,
  DEFAULT_BODY_WIDTH,
  DEFAULT_PIN_LENGTH,
  createEmptyDraft,
  type SymbolDraft,
  type SymbolGraphic,
  type SymbolPin,
} from "@/components/symbol-editor/types";
import type { SymbolGraphic as BackendSymbolGraphic } from "@shared/types/component-semantics.types";

type SymbolData = ComponentType["symbolData"];

const PIN_SPACING = 2_540_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toPointArray(value: unknown): Array<{ x: number; y: number }> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const points: Array<{ x: number; y: number }> = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const x = toNumber(item.x);
    const y = toNumber(item.y);
    if (x === null || y === null) {
      return null;
    }
    points.push({ x, y });
  }
  return points;
}

function toBackendGraphic(value: unknown): BackendSymbolGraphic | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  switch (value.type) {
    case "line": {
      const x1 = toNumber(value.x1);
      const y1 = toNumber(value.y1);
      const x2 = toNumber(value.x2);
      const y2 = toNumber(value.y2);
      const strokeWidth = toNumber(value.strokeWidth);
      if (
        x1 === null ||
        y1 === null ||
        x2 === null ||
        y2 === null ||
        strokeWidth === null
      ) {
        return null;
      }
      return { type: "line", x1, y1, x2, y2, strokeWidth };
    }
    case "rect": {
      const x = toNumber(value.x);
      const y = toNumber(value.y);
      const width = toNumber(value.width);
      const height = toNumber(value.height);
      const filled = toBoolean(value.filled);
      const strokeWidth = toNumber(value.strokeWidth);
      if (
        x === null ||
        y === null ||
        width === null ||
        height === null ||
        filled === null ||
        strokeWidth === null
      ) {
        return null;
      }
      return { type: "rect", x, y, width, height, filled, strokeWidth };
    }
    case "circle": {
      const cx = toNumber(value.cx);
      const cy = toNumber(value.cy);
      const radius = toNumber(value.radius);
      const filled = toBoolean(value.filled);
      const strokeWidth = toNumber(value.strokeWidth);
      if (
        cx === null ||
        cy === null ||
        radius === null ||
        filled === null ||
        strokeWidth === null
      ) {
        return null;
      }
      return { type: "circle", cx, cy, radius, filled, strokeWidth };
    }
    case "arc": {
      const cx = toNumber(value.cx);
      const cy = toNumber(value.cy);
      const radius = toNumber(value.radius);
      const startAngle = toNumber(value.startAngle);
      const endAngle = toNumber(value.endAngle);
      const strokeWidth = toNumber(value.strokeWidth);
      if (
        cx === null ||
        cy === null ||
        radius === null ||
        startAngle === null ||
        endAngle === null ||
        strokeWidth === null
      ) {
        return null;
      }
      return { type: "arc", cx, cy, radius, startAngle, endAngle, strokeWidth };
    }
    case "polygon": {
      const points = toPointArray(value.points);
      const filled = toBoolean(value.filled);
      const closed = toBoolean(value.closed);
      const strokeWidth = toNumber(value.strokeWidth);
      if (
        points === null ||
        filled === null ||
        closed === null ||
        strokeWidth === null
      ) {
        return null;
      }
      return { type: "polygon", points, filled, closed, strokeWidth };
    }
    case "text": {
      const x = toNumber(value.x);
      const y = toNumber(value.y);
      const content = typeof value.content === "string" ? value.content : null;
      const fontSize = toNumber(value.fontSize);
      const rotation = toNumber(value.rotation);
      if (
        x === null ||
        y === null ||
        content === null ||
        fontSize === null ||
        rotation === null
      ) {
        return null;
      }
      return { type: "text", x, y, content, fontSize, rotation };
    }
    default:
      return null;
  }
}

function backendGraphicToEditor(
  graphic: BackendSymbolGraphic,
  index: number,
): SymbolGraphic {
  const base = { id: `component-symbol-${index}`, zIndex: index };
  return { ...graphic, ...base };
}

function toBodyBounds(
  graphics: SymbolGraphic[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (graphics.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const expand = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const graphic of graphics) {
    switch (graphic.type) {
      case "line":
        expand(graphic.x1, graphic.y1);
        expand(graphic.x2, graphic.y2);
        break;
      case "rect":
        expand(graphic.x, graphic.y);
        expand(graphic.x + graphic.width, graphic.y + graphic.height);
        break;
      case "circle":
        expand(graphic.cx - graphic.radius, graphic.cy - graphic.radius);
        expand(graphic.cx + graphic.radius, graphic.cy + graphic.radius);
        break;
      case "arc":
        expand(graphic.cx - graphic.radius, graphic.cy - graphic.radius);
        expand(graphic.cx + graphic.radius, graphic.cy + graphic.radius);
        break;
      case "polygon":
        for (const point of graphic.points) {
          expand(point.x, point.y);
        }
        break;
      case "bezier":
        for (const point of graphic.points) {
          expand(point.x, point.y);
        }
        break;
      case "text":
        expand(graphic.x, graphic.y);
        break;
    }
  }

  if (minX === Number.POSITIVE_INFINITY) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

function toFallbackPins(
  pinDefinitions: SymbolData["pinDefinitions"],
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
): SymbolPin[] {
  if (pinDefinitions.length === 0) {
    return [];
  }

  const left: Array<{
    index: number;
    name: string;
    electricalType: SymbolPin["electricalType"];
  }> = [];
  const right: Array<{
    index: number;
    name: string;
    electricalType: SymbolPin["electricalType"];
  }> = [];

  pinDefinitions.forEach((pin, index) => {
    const normalizedName = pin.name.trim() || `${index + 1}`;
    const entry = {
      index,
      name: normalizedName,
      electricalType: pin.electricalType,
    };
    if (
      pin.electricalType === "output" ||
      pin.electricalType === "open_collector" ||
      pin.electricalType === "open_emitter"
    ) {
      right.push(entry);
      return;
    }
    left.push(entry);
  });

  while (left.length > right.length + 1) {
    const shifted = left.pop();
    if (shifted) {
      right.push(shifted);
    }
  }

  const bodyMinX = bounds?.minX ?? -DEFAULT_BODY_WIDTH / 2;
  const bodyMaxX = bounds?.maxX ?? DEFAULT_BODY_WIDTH / 2;
  const bodyCenterY = bounds ? (bounds.minY + bounds.maxY) / 2 : 0;

  const layout = (
    sidePins: Array<{
      index: number;
      name: string;
      electricalType: SymbolPin["electricalType"];
    }>,
    side: SymbolPin["side"],
  ): SymbolPin[] => {
    const totalHeight = (sidePins.length - 1) * PIN_SPACING;
    return sidePins.map((pin, lineIndex) => ({
      id: `component-pin-${pin.index}`,
      name: pin.name,
      number: String(pin.index + 1),
      electricalType: pin.electricalType,
      side,
      length: DEFAULT_PIN_LENGTH,
      position: {
        x:
          side === "left"
            ? bodyMinX - DEFAULT_PIN_LENGTH
            : bodyMaxX + DEFAULT_PIN_LENGTH,
        y: bodyCenterY + totalHeight / 2 - lineIndex * PIN_SPACING,
      },
    }));
  };

  return [...layout(left, "left"), ...layout(right, "right")];
}

function createFallbackDraftFromSymbolData(
  component: ComponentType,
): SymbolDraft {
  const symbolData = component.symbolData;
  const backendGraphics = (symbolData.bodyGraphics ?? [])
    .map(toBackendGraphic)
    .filter((graphic): graphic is BackendSymbolGraphic => graphic !== null);
  const graphics = backendGraphics.map(backendGraphicToEditor);
  const bounds = toBodyBounds(graphics);
  const width = Math.max(
    DEFAULT_BODY_WIDTH,
    bounds ? bounds.maxX - bounds.minX : DEFAULT_BODY_WIDTH,
  );
  const height = Math.max(
    DEFAULT_BODY_HEIGHT,
    bounds ? bounds.maxY - bounds.minY : DEFAULT_BODY_HEIGHT,
  );

  return {
    ...createEmptyDraft(component.id),
    metadata: {
      name: component.displayLabel,
      description: component.description,
      referencePrefix: symbolData.referencePrefix || "U",
    },
    body: {
      kind: graphics.length === 0 ? "ic_box" : "blank",
      width,
      height,
    },
    pins: toFallbackPins(symbolData.pinDefinitions, bounds),
    graphics,
    importPreservation: symbolData.rawKicadSource
      ? {
          rawSource: symbolData.rawKicadSource,
          sourceFileName: null,
          warnings: [],
          unitCount: symbolData.unitCount,
          graphicsEditable: true,
        }
      : null,
  };
}

function transformBodyPresetToGraphics(
  body: SymbolDraft["body"],
): BackendSymbolGraphic[] {
  const halfWidth = body.width / 2;
  const halfHeight = body.height / 2;

  switch (body.kind) {
    case "blank":
      return [];
    case "opamp":
    case "diode":
      return [
        {
          type: "polygon",
          points: [
            { x: -halfWidth, y: -halfHeight },
            { x: halfWidth, y: 0 },
            { x: -halfWidth, y: halfHeight },
          ],
          filled: false,
          closed: true,
          strokeWidth: 0.254,
        },
      ];
    case "transistor":
      return [
        {
          type: "circle",
          cx: 0,
          cy: 0,
          radius: Math.max(halfWidth, halfHeight),
          filled: false,
          strokeWidth: 0.254,
        },
      ];
    default:
      return [
        {
          type: "rect",
          x: -halfWidth,
          y: -halfHeight,
          width: body.width,
          height: body.height,
          filled: false,
          strokeWidth: 0.254,
        },
      ];
  }
}

function transformDraftGraphics(
  graphics: SymbolDraft["graphics"],
): BackendSymbolGraphic[] {
  const transformed: BackendSymbolGraphic[] = [];
  for (const graphic of graphics) {
    if (graphic.type === "bezier") {
      continue;
    }
    const { id: _id, zIndex: _zIndex, ...rest } = graphic;
    transformed.push(rest as BackendSymbolGraphic);
  }
  return transformed;
}

export async function loadSymbolDraftFromComponent(
  component: ComponentType,
): Promise<{ draft: SymbolDraft; warning: string | null }> {
  if (component.symbolData.rawKicadSource) {
    try {
      const parsed = await parseKicadSymbolImport(
        component.symbolData.rawKicadSource,
      );
      const parsedDraft = convertParsedKicadSymbolToDraft(
        parsed.symbol,
        component.displayLabel,
      );
      return {
        draft: {
          ...parsedDraft,
          metadata: {
            ...parsedDraft.metadata,
            name: component.displayLabel,
            description: component.description,
            referencePrefix:
              component.symbolData.referencePrefix ||
              parsedDraft.metadata.referencePrefix,
          },
        },
        warning: null,
      };
    } catch {
      return {
        draft: createFallbackDraftFromSymbolData(component),
        warning:
          "Unable to parse saved KiCad symbol source. Loaded fallback editable symbol layout.",
      };
    }
  }

  return {
    draft: createFallbackDraftFromSymbolData(component),
    warning: null,
  };
}

export function transformSymbolDraftToComponentSymbolData(
  draft: SymbolDraft,
  existingSymbolData?: SymbolData,
): SymbolData {
  const referencePrefix =
    draft.metadata.referencePrefix.trim().toUpperCase().slice(0, 5) || "U";
  const pinDefinitions = draft.pins.map((pin, index) => ({
    name: pin.name.trim() || pin.number.trim() || `PIN${index + 1}`,
    electricalType: pin.electricalType || "unspecified",
  }));

  return {
    referencePrefix,
    pinDefinitions,
    properties: existingSymbolData?.properties ?? {},
    unitCount:
      draft.importPreservation?.unitCount ?? existingSymbolData?.unitCount ?? 1,
    bodyGraphics: [
      ...transformBodyPresetToGraphics(draft.body),
      ...transformDraftGraphics(draft.graphics),
    ],
    rawKicadSource:
      draft.importPreservation?.rawSource ??
      existingSymbolData?.rawKicadSource ??
      null,
    symbolTemplate: existingSymbolData?.symbolTemplate ?? null,
  };
}
