/**
 * KiCAD Footprint Import Utilities
 *
 * Parse .kicad_mod files and convert to FootprintDraft.
 */

import type {
  FootprintDraft,
  PadDefinition,
  FootprintGraphic,
  PadShape,
  PadType,
} from "./types";
import { createPad, createEmptyDraft } from "./types";

// ---------------------------------------------------------------------------
// KiCAD S-Expression Parser (simplified)
// ---------------------------------------------------------------------------

interface SExpr {
  name: string;
  children: SExpr[];
  value?: string | number;
}

function parseSExprSimple(source: string): SExpr | null {
  const tokens = tokenize(source);
  let pos = 0;
  return parseExpr();

  function tokenize(src: string): (string | number)[] {
    const result: (string | number)[] = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === "(" || ch === ")") {
        result.push(ch);
        i++;
      } else if (ch === '"') {
        // String literal
        i++;
        let str = "";
        while (i < src.length && src[i] !== '"') {
          if (src[i] === "\\") {
            str += src[i + 1] ?? "";
            i += 2;
          } else {
            str += src[i];
            i++;
          }
        }
        i++; // Skip closing quote
        result.push(str);
      } else if (/\s/.test(ch)) {
        i++;
      } else {
        // Symbol or number
        let token = "";
        while (i < src.length && !/[\s()"']/.test(src[i]!)) {
          token += src[i];
          i++;
        }
        const num = parseFloat(token);
        result.push(isNaN(num) ? token : num);
      }
    }
    return result;
  }

  function parseExpr(): SExpr | null {
    if (pos >= tokens.length || tokens[pos] !== "(") return null;
    pos++; // Skip (
    const name = tokens[pos];
    if (typeof name !== "string" || name === "(" || name === ")") return null;
    pos++;
    const children: SExpr[] = [];
    while (pos < tokens.length && tokens[pos] !== ")") {
      if (tokens[pos] === "(") {
        const child = parseExpr();
        if (child) children.push(child);
      } else {
        const value = tokens[pos];
        if (typeof value === "string" || typeof value === "number") {
          children.push({ name: String(value), children: [], value });
        }
        pos++;
      }
    }
    if (tokens[pos] === ")") pos++; // Skip )
    return { name, children };
  }
}

function findChild(expr: SExpr, name: string): SExpr | undefined {
  return expr.children.find((c) => c.name === name);
}

function findChildren(expr: SExpr, name: string): SExpr[] {
  return expr.children.filter((c) => c.name === name);
}

function getString(expr: SExpr, index = 0): string | undefined {
  const child = expr.children[index];
  if (child && typeof child.value === "string") return child.value;
  if (child && child.children.length === 0) return child.name;
  return undefined;
}

function getNumber(expr: SExpr, index = 0): number | undefined {
  const child = expr.children[index];
  if (child && typeof child.value === "number") return child.value;
  if (child) {
    const num = parseFloat(child.name);
    if (!isNaN(num)) return num;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// KiCAD to FootprintDraft Conversion
// ---------------------------------------------------------------------------

const PAD_SHAPE_MAP: Record<string, PadShape> = {
  rect: "rect",
  circle: "circle",
  oval: "oval",
  roundrect: "roundrect",
  trapezoid: "trapezoid",
};

const PAD_TYPE_MAP: Record<string, PadType> = {
  smd: "smd",
  thru_hole: "thru_hole",
  np_thru_hole: "np_thru_hole",
  connect: "connect",
};

function convertKiCadPad(padExpr: SExpr, id: string): PadDefinition | null {
  const number = getString(padExpr, 0);
  const type = getString(padExpr, 1);
  const shape = getString(padExpr, 2);
  
  if (!number || !type || !shape) return null;

  const atExpr = findChild(padExpr, "at");
  const sizeExpr = findChild(padExpr, "size");
  const layersExpr = findChild(padExpr, "layers");
  const drillExpr = findChild(padExpr, "drill");
  const rrExpr = findChild(padExpr, "roundrect_rratio");

  const x = atExpr ? (getNumber(atExpr, 0) ?? 0) : 0;
  const y = atExpr ? (getNumber(atExpr, 1) ?? 0) : 0;
  const rotation = atExpr ? (getNumber(atExpr, 2) ?? 0) : 0;

  const width = sizeExpr ? (getNumber(sizeExpr, 0) ?? 1) : 1;
  const height = sizeExpr ? (getNumber(sizeExpr, 1) ?? 1) : 1;

  const layers: string[] = [];
  if (layersExpr) {
    for (let i = 0; i < layersExpr.children.length; i++) {
      const layer = getString(layersExpr, i);
      if (layer) layers.push(layer);
    }
  }

  const drillDiameter = drillExpr ? getNumber(drillExpr, 0) : undefined;

  const roundrectRatio = rrExpr ? getNumber(rrExpr, 0) : undefined;

  return createPad(id, {
    number,
    name: "",
    type: PAD_TYPE_MAP[type] ?? "smd",
    shape: PAD_SHAPE_MAP[shape] ?? "rect",
    position: { x, y },
    size: { width, height },
    rotation,
    roundrectRatio,
    layers: layers.length > 0 ? layers as PadDefinition["layers"] : ["F.Cu", "F.Mask"],
    drillDiameter,
  });
}

function convertKiCadGraphic(expr: SExpr, layer: string, id: string): FootprintGraphic | null {
  const strokeWidthExpr = findChild(expr, "width");
  const strokeWidth = strokeWidthExpr ? getNumber(strokeWidthExpr, 0) ?? 0.12 : 0.12;

  const startExpr = findChild(expr, "start");
  const endExpr = findChild(expr, "end");
  const centerExpr = findChild(expr, "center");

  switch (expr.name) {
    case "fp_line":
      if (!startExpr || !endExpr) return null;
      return {
        id,
        type: "line",
        layer: layer as FootprintGraphic["layer"],
        strokeWidth,
        start: {
          x: getNumber(startExpr, 0) ?? 0,
          y: getNumber(startExpr, 1) ?? 0,
        },
        end: {
          x: getNumber(endExpr, 0) ?? 0,
          y: getNumber(endExpr, 1) ?? 0,
        },
      };

    case "fp_rect":
      if (!startExpr || !endExpr) return null;
      return {
        id,
        type: "rect",
        layer: layer as FootprintGraphic["layer"],
        strokeWidth,
        position: {
          x: ((getNumber(startExpr, 0) ?? 0) + (getNumber(endExpr, 0) ?? 0)) / 2,
          y: ((getNumber(startExpr, 1) ?? 0) + (getNumber(endExpr, 1) ?? 0)) / 2,
        },
        width: Math.abs((getNumber(endExpr, 0) ?? 0) - (getNumber(startExpr, 0) ?? 0)),
        height: Math.abs((getNumber(endExpr, 1) ?? 0) - (getNumber(startExpr, 1) ?? 0)),
        filled: false,
      };

    case "fp_circle":
      if (!centerExpr || !endExpr) return null;
      return {
        id,
        type: "circle",
        layer: layer as FootprintGraphic["layer"],
        strokeWidth,
        center: {
          x: getNumber(centerExpr, 0) ?? 0,
          y: getNumber(centerExpr, 1) ?? 0,
        },
        radius: Math.sqrt(
          Math.pow((getNumber(endExpr, 0) ?? 0) - (getNumber(centerExpr, 0) ?? 0), 2) +
          Math.pow((getNumber(endExpr, 1) ?? 0) - (getNumber(centerExpr, 1) ?? 0), 2)
        ),
        filled: false,
      };

    case "fp_arc":
      // Arc parsing is complex, skip for now
      return null;

    case "fp_poly":
      // Polygon parsing is complex, skip for now
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main Import Function
// ---------------------------------------------------------------------------

/**
 * Parse a KiCAD .kicad_mod file and convert to a FootprintDraft.
 */
export function parseKicadModFile(source: string, fileName?: string): FootprintDraft {
  const expr = parseSExprSimple(source);
  if (!expr || expr.name !== "footprint") {
    throw new Error("Invalid KiCAD footprint file: missing (footprint ...) root");
  }

  const name = getString(expr, 0) ?? "Unknown";
  const draft = createEmptyDraft(crypto.randomUUID());
  draft.preset = "import";
  draft.config = { kind: "import", sourceFileName: fileName ?? "" };
  draft.metadata.name = name;
  draft.metadata.reference = name.split("_")[0] ?? "";

  const warnings: { code: string; message: string }[] = [];

  // Parse pads
  const padExprs = findChildren(expr, "pad");
  for (const padExpr of padExprs) {
    const pad = convertKiCadPad(padExpr, crypto.randomUUID());
    if (pad) {
      draft.pads.push(pad);
    } else {
      warnings.push({ code: "pad_parse_failed", message: `Failed to parse pad` });
    }
  }

  // Parse graphics
  const graphicTags = ["fp_line", "fp_rect", "fp_circle", "fp_arc", "fp_poly"];
  for (const tag of graphicTags) {
    const graphicExprs = findChildren(expr, tag);
    for (const graphicExpr of graphicExprs) {
      const layerExpr = findChild(graphicExpr, "layer");
      const layer = layerExpr ? getString(layerExpr, 0) ?? "F.Fab" : "F.Fab";
      const graphic = convertKiCadGraphic(graphicExpr, layer, crypto.randomUUID());
      if (graphic) {
        draft.graphics.push(graphic);
      }
    }
  }

  draft.importPreservation = {
    rawSource: source,
    sourceFileName: fileName ?? "",
    warnings,
  };

  return draft;
}

/**
 * Import file handler for drag-drop or file input.
 */
export async function importFootprintFile(file: File): Promise<FootprintDraft> {
  const content = await file.text();
  return parseKicadModFile(content, file.name);
}