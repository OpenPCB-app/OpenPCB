/**
 * Board and footprint graphics (`gr_*`, `fp_*`, footprint `property` text) as
 * they appear in a `.kicad_pcb` (H14 §3.10.3). Coordinates are raw file mm:
 * board-absolute for `gr_*`, footprint-local for `fp_*`. Every style field
 * OpenPCB cannot show is kept so the planner can report what it drops.
 */

import {
  type SExpr,
  findNode,
  findNodes,
  getNumberValue,
  getStringValue,
} from "@openpcb/kicad-parsers";
import {
  type KicadPointMm,
  readAtRotation,
  readPointTagged,
  readUuid,
  tessellateArcChords,
} from "./kicad-pcb-common";

export type ParsedKicadPcbGraphicKind =
  "text" | "line" | "rect" | "circle" | "arc" | "poly";

export interface ParsedKicadPcbTextStyle {
  value: string;
  /** KiCad `(size H W)`; `null` when the file carries no size. */
  sizeMm: { h: number; w: number } | null;
  thicknessMm: number | null;
  justifyH: "left" | "center" | "right";
  justifyV: "top" | "center" | "bottom";
  mirror: boolean;
  /** `(layer "F.SilkS" knockout)`. */
  knockout: boolean;
  hidden: boolean;
  /** The `(at x y θ)` angle as written (absolute for footprint text). */
  rotationDeg: number;
  bold: boolean;
  italic: boolean;
  /** `(font (face "…"))` — a TrueType face; `null` = KiCad stroke font. */
  font: string | null;
}

export interface ParsedKicadPcbGraphic {
  kind: ParsedKicadPcbGraphicKind;
  /** Source token (`gr_text`, `fp_line`, `property`, …). */
  token: string;
  layer: string;
  strokeWidthMm: number | null;
  fill: boolean;
  /**
   * line / rect: `[start, end]`; circle: `[center, end]`; arc:
   * `[start, mid, end]`; poly: vertices (contour arcs chord-flattened);
   * text: `[at]`.
   */
  points: KicadPointMm[];
  text: ParsedKicadPcbTextStyle | null;
  uuid: string | null;
  /** Footprint `property` name (`Reference`, `Value`, …) for property text. */
  propertyName?: string;
}

const SHAPE_KINDS: Readonly<Record<string, ParsedKicadPcbGraphicKind>> = {
  line: "line",
  rect: "rect",
  circle: "circle",
  arc: "arc",
  poly: "poly",
  text: "text",
};

/** Every top-level `gr_line|rect|circle|arc|poly|text`, in file order. */
export function parseBoardGraphics(expr: SExpr[]): ParsedKicadPcbGraphic[] {
  return parseGraphicChildren(expr, "gr_");
}

/**
 * A footprint's `fp_*` graphics plus every `property` that is drawn (it
 * carries an `(at …)` and a `(layer …)`), in file order.
 */
export function parseFootprintGraphics(
  footprint: SExpr[],
): ParsedKicadPcbGraphic[] {
  return parseGraphicChildren(footprint, "fp_");
}

function parseGraphicChildren(
  parent: SExpr[],
  prefix: "gr_" | "fp_",
): ParsedKicadPcbGraphic[] {
  const out: ParsedKicadPcbGraphic[] = [];
  for (const child of parent) {
    if (!Array.isArray(child) || typeof child[0] !== "string") continue;
    const token = child[0];
    const parsed =
      token === "property" && prefix === "fp_"
        ? parsePropertyText(child)
        : token.startsWith(prefix)
          ? parseGraphic(child, token, SHAPE_KINDS[token.slice(prefix.length)])
          : null;
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseGraphic(
  node: SExpr[],
  token: string,
  kind: ParsedKicadPcbGraphicKind | undefined,
): ParsedKicadPcbGraphic | null {
  if (!kind) return null;
  const points = readGraphicPoints(node, kind);
  if (!points) return null;
  const base: ParsedKicadPcbGraphic = {
    kind,
    token,
    layer: getStringValue(findNode(node, "layer") ?? [], 1) ?? "",
    strokeWidthMm: readStrokeWidth(node),
    fill: readFill(node),
    points,
    text: null,
    uuid: readUuid(node),
  };
  if (kind !== "text") return base;
  // `(gr_text "txt" …)` / `(fp_text user|reference|value "txt" …)`.
  const valueIndex = token === "fp_text" ? 2 : 1;
  const value = getStringValue(node, valueIndex);
  if (value === null) return null;
  return { ...base, text: readTextStyle(node, value, valueIndex) };
}

function parsePropertyText(node: SExpr[]): ParsedKicadPcbGraphic | null {
  const name = getStringValue(node, 1);
  const value = getStringValue(node, 2);
  const at = readPointTagged(findNode(node, "at"));
  const layer = getStringValue(findNode(node, "layer") ?? [], 1);
  if (name === null || value === null || !at || !layer) return null;
  return {
    kind: "text",
    token: "property",
    layer,
    strokeWidthMm: null,
    fill: false,
    points: [at],
    text: readTextStyle(node, value, 2),
    uuid: readUuid(node),
    propertyName: name,
  };
}

function readGraphicPoints(
  node: SExpr[],
  kind: ParsedKicadPcbGraphicKind,
): KicadPointMm[] | null {
  const tagged = (...tags: string[]): KicadPointMm[] | null => {
    const out: KicadPointMm[] = [];
    for (const tag of tags) {
      const p = readPointTagged(findNode(node, tag));
      if (!p) return null;
      out.push(p);
    }
    return out;
  };
  switch (kind) {
    case "line":
    case "rect":
      return tagged("start", "end");
    case "circle":
      return tagged("center", "end");
    case "arc":
      // Legacy `(angle …)` arcs (KiCad 5) carry no mid point: unreadable.
      return tagged("start", "mid", "end");
    case "text":
      return tagged("at");
    case "poly":
      return readPolyPoints(node);
  }
}

/** `(pts (xy …) (arc (start)(mid)(end)) …)`, arcs chord-flattened. */
function readPolyPoints(node: SExpr[]): KicadPointMm[] | null {
  const pts = findNode(node, "pts");
  if (!pts) return null;
  const out: KicadPointMm[] = [];
  for (const child of pts.slice(1)) {
    if (!Array.isArray(child)) continue;
    if (child[0] === "xy") {
      const p = readPointTagged(child);
      if (p) out.push(p);
      continue;
    }
    if (child[0] !== "arc") continue;
    const s = readPointTagged(findNode(child, "start"));
    const m = readPointTagged(findNode(child, "mid"));
    const e = readPointTagged(findNode(child, "end"));
    if (!s || !m || !e) continue;
    const chords = tessellateArcChords(s, m, e, 16);
    const last = out[out.length - 1];
    const skipFirst = last && last.xMm === s.xMm && last.yMm === s.yMm;
    out.push(...(skipFirst ? chords.slice(1) : chords));
  }
  return out.length > 0 ? out : null;
}

/** KiCad 7+ `(stroke (width w) …)`, else the legacy `(width w)`. */
function readStrokeWidth(node: SExpr[]): number | null {
  const stroke = findNode(node, "stroke");
  const width = findNode(stroke ?? node, "width");
  return width ? getNumberValue(width, 1) : null;
}

/** `(fill solid|yes|true)` → filled; `none`/`no`/absent → outline only. */
function readFill(node: SExpr[]): boolean {
  const fill = findNode(node, "fill");
  if (!fill) return false;
  const value = getStringValue(fill, 1);
  return value === "solid" || value === "yes" || value === "true";
}

/** `valueIndex`: where the text value sits, so a text literally reading `hide` is not a flag. */
function readTextStyle(
  node: SExpr[],
  value: string,
  valueIndex: number,
): ParsedKicadPcbTextStyle {
  const layerNode = findNode(node, "layer");
  const effects = findNode(node, "effects") ?? [];
  const font = findNode(effects, "font") ?? [];
  const size = findNode(font, "size");
  const h = size ? getNumberValue(size, 1) : null;
  const w = size ? getNumberValue(size, 2) : null;
  const justify = findNode(effects, "justify") ?? [];
  const has = (atom: string): boolean => justify.includes(atom);
  return {
    value,
    sizeMm: h !== null && w !== null ? { h, w } : null,
    thicknessMm: getNumberValue(findNode(font, "thickness") ?? [], 1),
    justifyH: has("left") ? "left" : has("right") ? "right" : "center",
    justifyV: has("top") ? "top" : has("bottom") ? "bottom" : "center",
    mirror: has("mirror"),
    knockout: (layerNode ?? []).includes("knockout"),
    hidden:
      readFlag(node.slice(valueIndex + 1), "hide") || readFlag(effects, "hide"),
    rotationDeg: readAtRotation(findNode(node, "at")),
    bold: readFlag(font, "bold"),
    italic: readFlag(font, "italic"),
    font: getStringValue(findNode(font, "face") ?? [], 1),
  };
}

/** A bare atom (`hide`, KiCad ≤ 7) or a `(hide yes)` node (KiCad 8+). */
function readFlag(node: SExpr[], tag: string): boolean {
  if (node.includes(tag)) return true;
  const found = findNodes(node, tag)[0];
  if (!found) return false;
  const value = getStringValue(found, 1);
  return value === null || value === "yes" || value === "true";
}
