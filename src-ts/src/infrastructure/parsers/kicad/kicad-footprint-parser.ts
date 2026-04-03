import {
  type SExpr,
  parseSexpr,
  findNode,
  findNodes,
  getStringValue,
  getNumberValue,
} from "./sexpr-parser";

// ── Types ──────────────────────────────────────────────────────────

export interface ParsedKicadFootprint {
  name: string;
  description: string;
  tags: string[];
  pads: ParsedPad[];
  graphics: ParsedGraphic[];
  model3dRefs: Model3DRef[];
  attributes: FootprintAttributes;
  warnings: Array<{ code: string; message: string }>;
  rawSource: string;
}

export interface ParsedPad {
  number: string;
  type: "smd" | "thru_hole" | "np_thru_hole" | "connect";
  shape: "circle" | "rect" | "oval" | "roundrect" | "trapezoid" | "custom";
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  layers: string[];
  roundrectRatio?: number;
  drillDiameter?: number;
  drillOffset?: { x: number; y: number };
}

export interface ParsedGraphic {
  type: "line" | "rect" | "circle" | "arc" | "poly" | "text";
  layer: string;
  data: Record<string, unknown>;
}

export interface Model3DRef {
  path: string;
  resolvedFileName: string;
  offset: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

export interface FootprintAttributes {
  type: "smd" | "through_hole" | "virtual" | "unknown";
}

// ── Helpers ────────────────────────────────────────────────────────

const PAD_TYPES = new Set(["smd", "thru_hole", "np_thru_hole", "connect"]);
const PAD_SHAPES = new Set([
  "circle",
  "rect",
  "oval",
  "roundrect",
  "trapezoid",
  "custom",
]);

const GRAPHIC_TAG_MAP: Record<string, ParsedGraphic["type"]> = {
  fp_line: "line",
  fp_rect: "rect",
  fp_circle: "circle",
  fp_arc: "arc",
  fp_poly: "poly",
  fp_text: "text",
};

function parseXyz(node: SExpr[] | null): { x: number; y: number; z: number } {
  if (!node) return { x: 0, y: 0, z: 0 };
  const xyz = findNode(node, "xyz");
  if (!xyz) return { x: 0, y: 0, z: 0 };
  return {
    x: getNumberValue(xyz, 1) ?? 0,
    y: getNumberValue(xyz, 2) ?? 0,
    z: getNumberValue(xyz, 3) ?? 0,
  };
}

function extractLayer(node: SExpr[]): string {
  const layerNode = findNode(node, "layer");
  if (layerNode) return getStringValue(layerNode) ?? "";

  const layersNode = findNode(node, "layers");
  if (layersNode) return getStringValue(layersNode) ?? "";

  return "";
}

function extractLayers(node: SExpr[]): string[] {
  const layersNode = findNode(node, "layers");
  if (!layersNode) return [];
  const result: string[] = [];
  for (let i = 1; i < layersNode.length; i++) {
    const v = layersNode[i];
    if (typeof v === "string") result.push(v);
    else if (typeof v === "number") result.push(String(v));
  }
  return result;
}

function nodeToRecord(node: SExpr[]): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  const args: Array<string | number> = [];
  for (let i = 1; i < node.length; i++) {
    const child = node[i];
    if (Array.isArray(child) && typeof child[0] === "string") {
      const tag = child[0];
      if (child.length === 2 && !Array.isArray(child[1])) {
        rec[tag] = child[1];
      } else {
        rec[tag] = child.slice(1);
      }
    } else if (typeof child === "string" || typeof child === "number") {
      args.push(child);
    }
  }
  if (args.length > 0) {
    rec.__args = args;
  }
  return rec;
}

// ── Main parser ────────────────────────────────────────────────────

export function parseKicadFootprint(source: string): ParsedKicadFootprint {
  const tree = parseSexpr(source);
  // Support both KiCad 6+ (footprint) and KiCad 5 (module) formats
  if (
    !Array.isArray(tree) ||
    (tree[0] !== "footprint" && tree[0] !== "module")
  ) {
    throw new Error(
      "Not a valid KiCad footprint file: missing (footprint ...) or (module ...) root",
    );
  }

  const warnings: Array<{ code: string; message: string }> = [];

  // Name
  const name = getStringValue(tree) ?? "";

  // Description
  const descrNode = findNode(tree, "descr");
  const description = descrNode ? getStringValue(descrNode) ?? "" : "";

  // Tags — may be space-separated string or multiple args
  const tagsNode = findNode(tree, "tags");
  let tags: string[] = [];
  if (tagsNode) {
    for (let i = 1; i < tagsNode.length; i++) {
      const v = tagsNode[i];
      if (typeof v === "string") {
        tags.push(...v.split(/\s+/).filter(Boolean));
      } else if (typeof v === "number") {
        tags.push(String(v));
      }
    }
  }

  // Attributes
  const attrNode = findNode(tree, "attr");
  let attrType: FootprintAttributes["type"] = "unknown";
  if (attrNode) {
    const val = getStringValue(attrNode);
    if (val === "smd") attrType = "smd";
    else if (val === "through_hole") attrType = "through_hole";
    else if (val === "virtual") attrType = "virtual";
  }

  // Pads
  const pads: ParsedPad[] = [];
  for (const padNode of findNodes(tree, "pad")) {
    const padNum = getStringValue(padNode, 1) ?? "";
    const rawType = getStringValue(padNode, 2) ?? "";
    const rawShape = getStringValue(padNode, 3) ?? "";

    const padType = PAD_TYPES.has(rawType)
      ? (rawType as ParsedPad["type"])
      : "smd";
    const padShape = PAD_SHAPES.has(rawShape)
      ? (rawShape as ParsedPad["shape"])
      : "rect";

    const atNode = findNode(padNode, "at");
    const sizeNode = findNode(padNode, "size");
    const rrNode = findNode(padNode, "roundrect_rratio");
    const drillNode = findNode(padNode, "drill");

    const pad: ParsedPad = {
      number: padNum,
      type: padType,
      shape: padShape,
      position: {
        x: atNode ? getNumberValue(atNode, 1) ?? 0 : 0,
        y: atNode ? getNumberValue(atNode, 2) ?? 0 : 0,
      },
      rotation: atNode ? getNumberValue(atNode, 3) ?? 0 : 0,
      size: {
        width: sizeNode ? getNumberValue(sizeNode, 1) ?? 0 : 0,
        height: sizeNode ? getNumberValue(sizeNode, 2) ?? 0 : 0,
      },
      layers: extractLayers(padNode),
    };

    if (rrNode) {
      pad.roundrectRatio = getNumberValue(rrNode) ?? undefined;
    }

    if (drillNode) {
      pad.drillDiameter =
        getNumberValue(drillNode, 1) ?? getNumberValue(drillNode) ?? undefined;
      const offsetNode = findNode(drillNode, "offset");
      if (offsetNode) {
        pad.drillOffset = {
          x: getNumberValue(offsetNode, 1) ?? 0,
          y: getNumberValue(offsetNode, 2) ?? 0,
        };
      }
    }

    if (!PAD_TYPES.has(rawType)) {
      warnings.push({
        code: "unsupported_pad_type",
        message: `Unsupported pad type "${rawType}" defaulted to smd`,
      });
    }
    if (!PAD_SHAPES.has(rawShape)) {
      warnings.push({
        code: "unsupported_pad_shape",
        message: `Unsupported pad shape "${rawShape}" defaulted to rect`,
      });
    }

    pads.push(pad);
  }

  // Graphics
  const graphics: ParsedGraphic[] = [];
  for (const [tag, gType] of Object.entries(GRAPHIC_TAG_MAP)) {
    for (const gNode of findNodes(tree, tag)) {
      graphics.push({
        type: gType,
        layer: extractLayer(gNode),
        data: nodeToRecord(gNode),
      });
    }
  }

  // 3D model references
  const model3dRefs: Model3DRef[] = [];
  for (const modelNode of findNodes(tree, "model")) {
    const path = getStringValue(modelNode) ?? "";
    const normalizedPath = path.replace(/\\/g, "/");
    const lastSlash = normalizedPath.lastIndexOf("/");
    const resolvedFileName =
      lastSlash >= 0 ? normalizedPath.slice(lastSlash + 1) : normalizedPath;

    const offsetNode = findNode(modelNode, "offset");
    const scaleNode = findNode(modelNode, "scale");
    const rotateNode = findNode(modelNode, "rotate");

    model3dRefs.push({
      path,
      resolvedFileName,
      offset: parseXyz(offsetNode),
      scale: parseXyz(scaleNode),
      rotation: parseXyz(rotateNode),
    });
  }

  return {
    name,
    description,
    tags,
    pads,
    graphics,
    model3dRefs,
    attributes: { type: attrType },
    warnings,
    rawSource: source,
  };
}
