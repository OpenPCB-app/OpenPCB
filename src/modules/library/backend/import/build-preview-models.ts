import {
  buildFootprintRenderModel,
  buildSymbolRenderModel,
  type FootprintRenderModel,
  type FootprintRenderSource,
  type FootprintRenderSourcePad,
  type PointMm,
  type PreviewGraphic,
  type PreviewLabel,
  type PreviewWarning,
  type SymbolRenderModel,
  type SymbolRenderSource,
  type SymbolRenderSourceGraphic,
  type SymbolRenderSourceLabel,
  type SymbolRenderSourcePin,
} from "../../../../shared/rendering";
import type { ParsedKicadFootprint } from "../infrastructure/parsers/kicad/kicad-footprint-parser";
import type { ParsedKicadSymbol } from "../infrastructure/parsers/kicad/kicad-symbol-parser";

type SNode = Array<string | number | SNode>;

function asSNode(value: unknown): SNode | null {
  return Array.isArray(value) ? (value as SNode) : null;
}

function nodeTag(node: SNode | null): string | null {
  if (!node) {
    return null;
  }
  const tag = node[0];
  return typeof tag === "string" ? tag : null;
}

function childNode(node: SNode | null, tag: string): SNode | null {
  if (!node) {
    return null;
  }
  for (const entry of node) {
    if (!Array.isArray(entry)) {
      continue;
    }
    if (entry[0] === tag) {
      return entry as SNode;
    }
  }
  return null;
}

function children(node: SNode | null, tag: string): SNode[] {
  if (!node) {
    return [];
  }
  const out: SNode[] = [];
  for (const entry of node) {
    if (!Array.isArray(entry)) {
      continue;
    }
    if (entry[0] === tag) {
      out.push(entry as SNode);
    }
  }
  return out;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function valueAt(node: SNode | null, index: number): number | null {
  if (!node) {
    return null;
  }
  return toNumber(node[index]);
}

function textAt(node: SNode | null, index: number): string | null {
  if (!node) {
    return null;
  }
  const value = node[index];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function parsePointFromChild(node: SNode | null, tag: string): PointMm | null {
  const pointNode = childNode(node, tag);
  const x = valueAt(pointNode, 1);
  const y = valueAt(pointNode, 2);
  if (x === null || y === null) {
    return null;
  }
  return { x, y };
}

function parseStrokeWidth(node: SNode): number {
  const stroke = childNode(node, "stroke");
  const widthNode = childNode(stroke, "width");
  return valueAt(widthNode, 1) ?? 0.15;
}

function parseFill(node: SNode): "none" | "solid" {
  const fillNode = childNode(node, "fill");
  const typeNode = childNode(fillNode, "type");
  const type = textAt(typeNode, 1) ?? "none";
  return type === "none" ? "none" : "solid";
}

function parsePointsNode(node: SNode): PointMm[] {
  const pts = childNode(node, "pts");
  const out: PointMm[] = [];
  for (const xyNode of children(pts, "xy")) {
    const x = valueAt(xyNode, 1);
    const y = valueAt(xyNode, 2);
    if (x === null || y === null) {
      continue;
    }
    out.push({ x, y });
  }
  return out;
}

function symbolGraphicFromNode(
  node: SNode,
  warnings: PreviewWarning[],
): PreviewGraphic | null {
  const tag = nodeTag(node);
  if (!tag) {
    return null;
  }

  if (tag === "rectangle") {
    const start = parsePointFromChild(node, "start");
    const end = parsePointFromChild(node, "end");
    if (!start || !end) {
      return null;
    }
    const minX = Math.min(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    return {
      kind: "rect",
      x: minX,
      y: minY,
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
      fill: parseFill(node),
      strokeWidthMm: parseStrokeWidth(node),
    };
  }

  if (tag === "polyline") {
    const points = parsePointsNode(node);
    if (points.length < 2) {
      return null;
    }
    const first = points[0];
    const last = points[points.length - 1];
    const closed =
      !!first &&
      !!last &&
      Math.abs(first.x - last.x) < 1e-6 &&
      Math.abs(first.y - last.y) < 1e-6;
    return {
      kind: "polyline",
      points,
      closed,
      fill: parseFill(node),
      strokeWidthMm: parseStrokeWidth(node),
    };
  }

  if (tag === "bezier") {
    const points = parsePointsNode(node);
    if (points.length !== 4) {
      warnings.push({
        code: "bezier_points_invalid",
        message: "Bezier element without four control points was skipped",
      });
      return null;
    }
    return {
      kind: "bezier",
      points: [points[0]!, points[1]!, points[2]!, points[3]!],
      strokeWidthMm: parseStrokeWidth(node),
    };
  }

  if (tag === "circle") {
    const center = parsePointFromChild(node, "center");
    const radiusNode = childNode(node, "radius");
    const radius = valueAt(radiusNode, 1);
    if (!center || radius === null) {
      return null;
    }
    return {
      kind: "circle",
      center,
      radiusMm: Math.abs(radius),
      fill: parseFill(node),
      strokeWidthMm: parseStrokeWidth(node),
    };
  }

  if (tag === "arc") {
    const start = parsePointFromChild(node, "start");
    const mid = parsePointFromChild(node, "mid");
    const end = parsePointFromChild(node, "end");
    if (!start || !mid || !end) {
      warnings.push({
        code: "arc_format_unsupported",
        message: "Arc without start/mid/end was skipped",
      });
      return null;
    }
    return {
      kind: "arc3",
      start,
      mid,
      end,
      strokeWidthMm: parseStrokeWidth(node),
    };
  }

  if (tag === "text") {
    return null;
  }

  warnings.push({
    code: "symbol_graphic_unsupported",
    message: `Unsupported symbol graphic '${tag}' was skipped`,
  });
  return null;
}

function pointFromUnknown(value: unknown): PointMm | null {
  if (Array.isArray(value)) {
    const x = toNumber(value[0]);
    const y = toNumber(value[1]);
    if (x === null || y === null) {
      return null;
    }
    return { x, y };
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const x = toNumber(record.x);
  const y = toNumber(record.y);
  if (x === null || y === null) {
    return null;
  }
  return { x, y };
}

function footprintGraphicFromParsed(
  graphic: ParsedKicadFootprint["graphics"][number],
  warnings: PreviewWarning[],
): { graphic: PreviewGraphic | null; label: PreviewLabel | null } {
  const layer = graphic.layer;

  if (graphic.type === "line") {
    const start = pointFromUnknown(graphic.data.start);
    const end = pointFromUnknown(graphic.data.end);
    if (!start || !end) {
      return { graphic: null, label: null };
    }
    return {
      graphic: {
        kind: "line",
        a: start,
        b: end,
        strokeWidthMm: toNumber(graphic.data.width) ?? 0.12,
        layer,
      },
      label: null,
    };
  }

  if (graphic.type === "rect") {
    const start = pointFromUnknown(graphic.data.start);
    const end = pointFromUnknown(graphic.data.end);
    if (!start || !end) {
      return { graphic: null, label: null };
    }
    return {
      graphic: {
        kind: "rect",
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
        fill: "none",
        strokeWidthMm: toNumber(graphic.data.width) ?? 0.12,
        layer,
      },
      label: null,
    };
  }

  if (graphic.type === "circle") {
    const center = pointFromUnknown(graphic.data.center);
    const end = pointFromUnknown(graphic.data.end);
    if (!center || !end) {
      return { graphic: null, label: null };
    }
    return {
      graphic: {
        kind: "circle",
        center,
        radiusMm: Math.hypot(end.x - center.x, end.y - center.y),
        fill: "none",
        strokeWidthMm: toNumber(graphic.data.width) ?? 0.12,
        layer,
      },
      label: null,
    };
  }

  if (graphic.type === "arc") {
    const start = pointFromUnknown(graphic.data.start);
    const mid = pointFromUnknown(graphic.data.mid);
    const end = pointFromUnknown(graphic.data.end);
    if (!start || !mid || !end) {
      warnings.push({
        code: "footprint_arc_format_unsupported",
        message: "Footprint arc without start/mid/end was skipped",
      });
      return { graphic: null, label: null };
    }
    return {
      graphic: {
        kind: "arc3",
        start,
        mid,
        end,
        strokeWidthMm: toNumber(graphic.data.width) ?? 0.12,
        layer,
      },
      label: null,
    };
  }

  if (graphic.type === "poly") {
    const rawPoints = Array.isArray(graphic.data.pts) ? graphic.data.pts : [];
    const points: PointMm[] = [];
    for (const rawPoint of rawPoints) {
      if (!Array.isArray(rawPoint)) {
        continue;
      }
      if (rawPoint[0] !== "xy") {
        continue;
      }
      const x = toNumber(rawPoint[1]);
      const y = toNumber(rawPoint[2]);
      if (x === null || y === null) {
        continue;
      }
      points.push({ x, y });
    }
    if (points.length < 2) {
      return { graphic: null, label: null };
    }
    return {
      graphic: {
        kind: "polyline",
        points,
        closed: true,
        fill: "none",
        strokeWidthMm: toNumber(graphic.data.width) ?? 0.12,
        layer,
      },
      label: null,
    };
  }

  if (graphic.type === "text") {
    const args = Array.isArray(graphic.data.__args) ? graphic.data.__args : [];
    const contentRaw = args[1] ?? args[0];
    const content = typeof contentRaw === "string" ? contentRaw : "";
    const at = Array.isArray(graphic.data.at) ? graphic.data.at : [];
    const x = toNumber(at[0]) ?? 0;
    const y = toNumber(at[1]) ?? 0;
    const rotationDeg = toNumber(at[2]) ?? 0;
    return {
      graphic: null,
      label: {
        id: `fp-text:${layer}:${x}:${y}:${content}`,
        text: normalizeFootprintText(content),
        at: { x, y },
        fontSizeMm: 0.8,
        rotationDeg,
        anchorX: "center",
        anchorY: "middle",
        layer,
        role: "footprint-text",
      },
    };
  }

  warnings.push({
    code: "footprint_graphic_unsupported",
    message: `Unsupported footprint graphic '${graphic.type}' was skipped`,
  });
  return { graphic: null, label: null };
}

function normalizeFootprintText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "";
  }

  return trimmed
    .replace(/\$\{REFERENCE\}/g, "REF**")
    .replace(/\$\{VALUE\}/g, "VALUE")
    .replace(/\$\{[^}]+\}/g, "TEXT");
}

export function buildSymbolPreviewFromParsed(
  symbol: ParsedKicadSymbol,
): SymbolRenderModel {
  const warnings: PreviewWarning[] = [...symbol.warnings];

  const pins: SymbolRenderSourcePin[] = symbol.pins.map((pin, index) => {
    const number = pin.number.trim().length > 0 ? pin.number : null;
    const id =
      number !== null
        ? `u${pin.unit}:${number}`
        : `u${pin.unit}:idx${index + 1}`;
    return {
      id,
      name: pin.name,
      number,
      electricalType: pin.electricalType,
      positionMm: {
        x: pin.position.x,
        y: pin.position.y,
      },
      lengthMm: pin.length,
      rotationDeg: pin.rotation,
      unit: pin.unit,
      hidden: pin.hidden,
    };
  });

  const graphics: SymbolRenderSourceGraphic[] = [];
  const labels: SymbolRenderSourceLabel[] = [];

  for (const bodyGraphic of symbol.bodyGraphics) {
    const node = asSNode(bodyGraphic.node);
    if (!node) {
      continue;
    }

    const tag = nodeTag(node);
    if (tag === "text") {
      const at = childNode(node, "at");
      const x = valueAt(at, 1) ?? 0;
      const y = valueAt(at, 2) ?? 0;
      const rotationDeg = valueAt(at, 3) ?? 0;
      const content = textAt(node, 1) ?? "";
      if (content.trim().length > 0) {
        labels.push({
          unit: bodyGraphic.unit,
          label: {
            id: `symbol-text:${bodyGraphic.unit}:${x}:${y}:${content}`,
            text: content,
            at: { x, y },
            fontSizeMm: 0.8,
            rotationDeg,
            anchorX: "center",
            anchorY: "middle",
          },
        });
      }
      continue;
    }

    const graphic = symbolGraphicFromNode(node, warnings);
    if (!graphic) {
      continue;
    }

    graphics.push({
      unit: bodyGraphic.unit,
      graphic,
    });
  }

  const source: SymbolRenderSource = {
    name: symbol.name,
    unitCount: Math.max(symbol.units, 1),
    referenceText: symbol.properties.Reference ?? "",
    valueText: symbol.properties.Value ?? symbol.name,
    pins,
    graphics,
    labels,
    warnings,
  };

  const model = buildSymbolRenderModel(source, {
    composeAllUnits: true,
    includeHiddenPins: false,
    preserveOrigin: true,
  });

  return model;
}

export function buildFootprintPreviewFromParsed(
  footprint: ParsedKicadFootprint,
): FootprintRenderModel {
  const warnings: PreviewWarning[] = [...footprint.warnings];

  const pads: FootprintRenderSourcePad[] = footprint.pads.map((pad, index) => {
    const isRenderedShape =
      pad.shape === "circle" ||
      pad.shape === "rect" ||
      pad.shape === "oval" ||
      pad.shape === "roundrect";

    if (!isRenderedShape) {
      warnings.push({
        code: "footprint_pad_shape_degraded",
        message: `Pad ${pad.number || index + 1} shape '${pad.shape}' rendered as rect`,
      });
    }

    const normalizedNumber = (pad.number ?? "").trim();
    return {
      id: `${normalizedNumber || "?"}:${index}`,
      number: normalizedNumber,
      shape: isRenderedShape ? pad.shape : "rect",
      centerMm: { x: pad.position.x, y: pad.position.y },
      widthMm: pad.size.width,
      heightMm: pad.size.height,
      rotationDeg: pad.rotation,
      roundrectRatio: pad.roundrectRatio,
      drillDiameterMm: pad.drillDiameter,
      layer: pad.layers[0],
    };
  });

  const graphics: PreviewGraphic[] = [];
  const labels: PreviewLabel[] = [];

  for (const graphic of footprint.graphics) {
    const parsed = footprintGraphicFromParsed(graphic, warnings);
    if (parsed.graphic) {
      graphics.push(parsed.graphic);
    }
    if (parsed.label) {
      labels.push(parsed.label);
    }
  }

  const source: FootprintRenderSource = {
    name: footprint.name,
    pads,
    graphics,
    labels,
    warnings,
  };

  return buildFootprintRenderModel(source, {
    includeLayerNames: [
      "F.SilkS",
      "B.SilkS", // KiCad 7
      "F.Silkscreen",
      "B.Silkscreen", // KiCad 8+
      "F.Fab",
      "B.Fab", // KiCad 7
      "F.Fabrication",
      "B.Fabrication", // KiCad 8+
    ],
    includePadLayerNames: ["F.Cu", "B.Cu"],
  });
}
