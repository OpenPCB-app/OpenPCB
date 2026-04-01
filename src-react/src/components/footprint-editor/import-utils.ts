/**
 * KiCAD Footprint Import Utilities
 *
 * Convert backend-parsed `.kicad_mod` content into editable FootprintDraft data.
 */

import {
  parseKicadFootprintImport,
  type ParsedKicadFootprint,
} from "@/lib/api/component-api";
import type {
  ArcGraphic,
  CircleGraphic,
  FootprintDraft,
  FootprintGraphic,
  GraphicLayer,
  LineGraphic,
  PadDefinition,
  PadLayer,
  Point,
  PolygonGraphic,
  RectGraphic,
  TextGraphic,
} from "./types";
import { createEmptyDraft, createPad } from "./types";

type LayerName = GraphicLayer | PadLayer;

const SUPPORTED_GRAPHIC_LAYERS = new Set<GraphicLayer>([
  "F.Cu",
  "B.Cu",
  "F.SilkS",
  "B.SilkS",
  "F.Fab",
  "B.Fab",
  "F.CrtYd",
  "B.CrtYd",
]);

const SUPPORTED_PAD_LAYERS = new Set<PadLayer>([
  "F.Cu",
  "B.Cu",
  "F.Mask",
  "B.Mask",
  "F.Paste",
  "B.Paste",
  "*.Cu",
  "*.Mask",
]);

function toLayerName(value: string, fallback: LayerName): LayerName {
  if (SUPPORTED_GRAPHIC_LAYERS.has(value as GraphicLayer)) {
    return value as GraphicLayer;
  }
  if (SUPPORTED_PAD_LAYERS.has(value as PadLayer)) {
    return value as PadLayer;
  }
  return fallback;
}

function toPoint(value: unknown): Point {
  if (Array.isArray(value)) {
    return {
      x: toNumber(value[0]),
      y: toNumber(value[1]),
    };
  }

  const record = value as Record<string, unknown>;
  return {
    x: typeof record.x === "number" ? record.x : 0,
    y: typeof record.y === "number" ? record.y : 0,
  };
}

function getStrokeWidth(data: Record<string, unknown>, fallback = 0.12): number {
  const width = data.width;
  if (typeof width === "number" && Number.isFinite(width)) {
    return width;
  }

  const stroke = data.stroke;
  if (Array.isArray(stroke)) {
    if (typeof stroke[0] === "number") {
      return toNumber(stroke[0], fallback);
    }
    if (Array.isArray(stroke[0]) && stroke[0][0] === "width") {
      return toNumber(stroke[0][1], fallback);
    }
    if (Array.isArray(stroke[1]) && stroke[1][0] === "width") {
      return toNumber(stroke[1][1], fallback);
    }
  }

  return fallback;
}

function getFill(data: Record<string, unknown>): boolean {
  const fill = data.fill;
  if (typeof fill === "string") {
    return fill !== "none";
  }

  if (Array.isArray(fill)) {
    const typeNode = fill.find((entry) => Array.isArray(entry) && entry[0] === "type") as
      | unknown[]
      | undefined;
    return toStringValue(typeNode?.[1], "none") !== "none";
  }

  return false;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function solveArcCenter(start: Point, mid: Point, end: Point): { center: Point; radius: number } | null {
  const d = 2 * (
    start.x * (mid.y - end.y) +
    mid.x * (end.y - start.y) +
    end.x * (start.y - mid.y)
  );
  if (Math.abs(d) < 1e-9) return null;

  const ux =
    ((start.x * start.x + start.y * start.y) * (mid.y - end.y) +
      (mid.x * mid.x + mid.y * mid.y) * (end.y - start.y) +
      (end.x * end.x + end.y * end.y) * (start.y - mid.y)) /
    d;
  const uy =
    ((start.x * start.x + start.y * start.y) * (end.x - mid.x) +
      (mid.x * mid.x + mid.y * mid.y) * (start.x - end.x) +
      (end.x * end.x + end.y * end.y) * (mid.x - start.x)) /
    d;

  return {
    center: { x: ux, y: uy },
    radius: Math.hypot(start.x - ux, start.y - uy),
  };
}

function convertPad(pad: ParsedKicadFootprint["pads"][number]): PadDefinition {
  return createPad(crypto.randomUUID(), {
    number: pad.number,
    name: "",
    type: pad.type,
    shape: pad.shape === "custom" ? "rect" : pad.shape,
    position: { ...pad.position },
    size: { ...pad.size },
    rotation: pad.rotation,
    roundrectRatio: pad.roundrectRatio,
    layers: (pad.layers.map((layer) => toLayerName(layer, "F.Cu")) as PadLayer[]),
    drillDiameter: pad.drillDiameter,
    drillOffset: pad.drillOffset ? { ...pad.drillOffset } : undefined,
  });
}

function convertLineGraphic(layer: GraphicLayer, data: Record<string, unknown>): LineGraphic {
  return {
    id: crypto.randomUUID(),
    type: "line",
    layer,
    strokeWidth: getStrokeWidth(data),
    start: toPoint(data.start),
    end: toPoint(data.end),
  };
}

function convertRectGraphic(layer: GraphicLayer, data: Record<string, unknown>): RectGraphic {
  const start = toPoint(data.start);
  const end = toPoint(data.end);
  return {
    id: crypto.randomUUID(),
    type: "rect",
    layer,
    strokeWidth: getStrokeWidth(data),
    position: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    filled: getFill(data),
  };
}

function convertCircleGraphic(layer: GraphicLayer, data: Record<string, unknown>): CircleGraphic {
  const center = toPoint(data.center);
  const end = toPoint(data.end);
  return {
    id: crypto.randomUUID(),
    type: "circle",
    layer,
    strokeWidth: getStrokeWidth(data),
    center,
    radius: Math.hypot(end.x - center.x, end.y - center.y),
    filled: getFill(data),
  };
}

function convertArcGraphic(layer: GraphicLayer, data: Record<string, unknown>): ArcGraphic | null {
  const start = toPoint(data.start);
  const mid = toPoint(data.mid);
  const end = toPoint(data.end);
  const solved = solveArcCenter(start, mid, end);
  if (!solved) return null;

  return {
    id: crypto.randomUUID(),
    type: "arc",
    layer,
    strokeWidth: getStrokeWidth(data),
    center: solved.center,
    radius: solved.radius,
    startAngle: (Math.atan2(start.y - solved.center.y, start.x - solved.center.x) * 180) / Math.PI,
    endAngle: (Math.atan2(end.y - solved.center.y, end.x - solved.center.x) * 180) / Math.PI,
  };
}

function convertPolygonGraphic(layer: GraphicLayer, data: Record<string, unknown>): PolygonGraphic | null {
  const pts = (data.pts as unknown[] | undefined) ?? [];
  const points = pts
    .map((entry) => {
      if (!Array.isArray(entry) || entry[0] !== "xy") return null;
      return {
        x: toNumber(entry[1]),
        y: toNumber(entry[2]),
      };
    })
    .filter((point): point is Point => point !== null);

  if (points.length < 2) return null;

  return {
    id: crypto.randomUUID(),
    type: "polygon",
    layer,
    strokeWidth: getStrokeWidth(data),
    points,
    filled: getFill(data),
  };
}

function convertTextGraphic(layer: GraphicLayer, data: Record<string, unknown>): TextGraphic {
  const args = Array.isArray(data.__args) ? data.__args : [];
  const at = Array.isArray(data.at) ? data.at : [];
  const effects = Array.isArray(data.effects) ? data.effects : [];
  const font = effects.find((entry) => Array.isArray(entry) && entry[0] === "font") as
    | unknown[]
    | undefined;
  const size = Array.isArray(font)
    ? (font.find((entry) => Array.isArray(entry) && entry[0] === "size") as unknown[] | undefined)
    : undefined;
  const content = toStringValue(args[1], toStringValue(args[0]));

  return {
    id: crypto.randomUUID(),
    type: "text",
    layer,
    strokeWidth: getStrokeWidth(data),
    position: {
      x: toNumber(at[0]),
      y: toNumber(at[1]),
    },
    content,
    fontSize: toNumber(size?.[1], 1),
    rotation: toNumber(at[2]),
  };
}

function convertGraphic(graphic: ParsedKicadFootprint["graphics"][number]): FootprintGraphic | null {
  const layer = toLayerName(graphic.layer, "F.Fab");
  if (!SUPPORTED_GRAPHIC_LAYERS.has(layer as GraphicLayer)) {
    return null;
  }

  if (graphic.type === "line") return convertLineGraphic(layer as GraphicLayer, graphic.data);
  if (graphic.type === "rect") return convertRectGraphic(layer as GraphicLayer, graphic.data);
  if (graphic.type === "circle") return convertCircleGraphic(layer as GraphicLayer, graphic.data);
  if (graphic.type === "arc") return convertArcGraphic(layer as GraphicLayer, graphic.data);
  if (graphic.type === "poly") return convertPolygonGraphic(layer as GraphicLayer, graphic.data);
  if (graphic.type === "text") return convertTextGraphic(layer as GraphicLayer, graphic.data);
  return null;
}

export function convertParsedKicadFootprintToDraft(
  parsed: ParsedKicadFootprint,
  fileName: string,
): FootprintDraft {
  const draft = createEmptyDraft(crypto.randomUUID());
  draft.preset = "import";
  draft.config = { kind: "import", sourceFileName: fileName };
  draft.metadata.name = parsed.name;
  draft.metadata.reference = parsed.name;
  draft.metadata.description = parsed.description;

  draft.pads = parsed.pads.map(convertPad);

  let droppedGraphics = 0;
  let droppedCustomPads = 0;
  draft.graphics = parsed.graphics
    .map((graphic) => {
      const converted = convertGraphic(graphic);
      if (!converted) droppedGraphics += 1;
      return converted;
    })
    .filter((graphic): graphic is FootprintGraphic => graphic !== null);

  for (const pad of parsed.pads) {
    if (pad.shape === "custom") droppedCustomPads += 1;
  }

  draft.importPreservation = {
    rawSource: parsed.rawSource,
    sourceFileName: fileName,
    warnings: [
      ...parsed.warnings,
      ...(droppedGraphics > 0
        ? [{ code: "graphics_dropped", message: `${droppedGraphics} unsupported graphics were skipped` }]
        : []),
      ...(droppedCustomPads > 0
        ? [{ code: "custom_pad_degraded", message: `${droppedCustomPads} custom pads were downgraded to rect pads` }]
        : []),
    ],
    model3dReferences: parsed.model3dRefs.map((ref) => ({
      ...ref,
      offset: { ...ref.offset },
      scale: { ...ref.scale },
      rotation: { ...ref.rotation },
    })),
    attributes: parsed.attributes,
  };

  return draft;
}

export async function importFootprintFile(file: File): Promise<FootprintDraft> {
  const content = await file.text();
  const parsed = await parseKicadFootprintImport(content, file.name);
  return convertParsedKicadFootprintToDraft(parsed.footprint, parsed.fileName ?? file.name);
}
