/**
 * KiCad PCB File Parser (.kicad_pcb)
 *
 * Reference: https://dev-docs.kicad.org/en/file-formats/sexpr-pcb/index.html
 *
 * Extracts the entities OpenPCB's designer module consumes for import:
 *   - copper layer count (derived from (layers ...) entries with type=signal|power)
 *   - footprint placements (lib_id, refdes, value, at, rotation, layer)
 *   - traces (segments — start/end/width/layer/net)
 *   - vias (at/size/drill/layers/net)
 *   - top-level nets (ordinal → name)
 *   - board outline bounding box from Edge.Cuts graphics
 *   - zones (counted + collected as warnings, dropped in v1)
 *
 * Coordinate convention: KiCad stores PCB coordinates in mm with up to six
 * decimal places (nm resolution). We pass them through unchanged in mm; the
 * designer commit step is responsible for converting to OpenPCB's internal
 * nanometer integer coordinates.
 */

import {
  type SExpr,
  findNode,
  findNodes,
  getNumberValue,
  getStringValue,
  parseSexpr,
} from "@openpcb/kicad-parsers";
import type { ParsedKicadProjectWarning } from "./kicad-project-parser";

export interface ParsedKicadPcb {
  version: number | null;
  generator: string | null;
  /** Total copper layers (signal + power layer rows). */
  copperLayerCount: number;
  /** All declared layers in stack order. */
  layers: ParsedKicadPcbLayer[];
  nets: ParsedKicadPcbNet[];
  footprints: ParsedKicadPcbFootprint[];
  segments: ParsedKicadPcbSegment[];
  vias: ParsedKicadPcbVia[];
  /** Edge.Cuts bounding box; null when no outline graphics present. */
  boardOutline: ParsedKicadPcbBoardOutline | null;
  /** Edge.Cuts graphic points assembled into a closed polyline; null when none. */
  boardOutlinePolygon: ParsedKicadPcbPoint[] | null;
  /** Zones — outline + net name + layer; fill polygons not preserved in v1. */
  zones: ParsedKicadPcbZone[];
  /** Count of zones encountered (kept for backward-compat reporting). */
  zoneCount: number;
  warnings: ParsedKicadProjectWarning[];
}

export interface ParsedKicadPcbZone {
  netOrdinal: number | null;
  netName: string | null;
  layer: string;
  polygonPointsMm: ParsedKicadPcbPoint[];
  hatchEdgeMm: number;
  /** "solid" or "hatched" — KiCad uses "fill" yes/no with mode tokens. */
  fillType: "solid" | "hatched";
}

export interface ParsedKicadPcbLayer {
  ordinal: number;
  canonicalName: string;
  type: string;
  userName: string | null;
}

export interface ParsedKicadPcbNet {
  ordinal: number;
  name: string;
}

export interface ParsedKicadPcbFootprint {
  libId: string;
  reference: string;
  value: string | null;
  at: ParsedKicadPcbPoint;
  rotationDeg: number;
  layer: string;
  /** Raw property map (Reference / Value / Footprint / custom). */
  properties: Record<string, string>;
  /** Pads as parsed; numbers map to OpenPCB pad.number on commit. */
  pads: ParsedKicadPcbPad[];
  /** 3D model file references (e.g. ${KIPRJMOD}/3dmodels/foo.step). */
  modelRefs: string[];
}

export interface ParsedKicadPcbPad {
  number: string;
  padType: string;
  shape: string;
  at: ParsedKicadPcbPoint;
  rotationDeg: number;
  sizeMm: { widthMm: number; heightMm: number } | null;
  drillMm: number | null;
  layers: string[];
  netOrdinal: number | null;
}

export interface ParsedKicadPcbSegment {
  start: ParsedKicadPcbPoint;
  end: ParsedKicadPcbPoint;
  widthMm: number;
  layer: string;
  netOrdinal: number;
  /**
   * Net name resolved from the `(net N "name")` table. Empty string for the
   * ordinal-0 "no net" entry. `null` when no `(net N)` table entry covers the
   * ordinal — should be treated the same as no-net.
   */
  netName: string | null;
  /** True when this segment was tessellated from an `(arc ...)` track. */
  originatedFromArc?: boolean;
}

export interface ParsedKicadPcbVia {
  at: ParsedKicadPcbPoint;
  sizeMm: number;
  drillMm: number;
  layers: [string, string];
  netOrdinal: number;
  /** Net name resolved from the `(net N "name")` table; null when missing. */
  netName: string | null;
  type: "through" | "blind" | "micro";
}

export interface ParsedKicadPcbBoardOutline {
  minXMm: number;
  minYMm: number;
  maxXMm: number;
  maxYMm: number;
}

export interface ParsedKicadPcbPoint {
  xMm: number;
  yMm: number;
}

export function parseKicadPcb(source: string): ParsedKicadPcb {
  const warnings: ParsedKicadProjectWarning[] = [];
  let expr: SExpr;
  try {
    expr = parseSexpr(source);
  } catch (error) {
    throw new Error(
      `Failed to parse .kicad_pcb: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(expr) || expr[0] !== "kicad_pcb") {
    throw new Error("Not a .kicad_pcb file (missing kicad_pcb root token)");
  }

  const version = getNumberValue(findNode(expr, "version") ?? [], 1);
  const generator = getStringValue(findNode(expr, "generator") ?? [], 1);

  const layers = parseLayers(expr, warnings);
  const copperLayerCount = layers.filter(
    (l) => l.type === "signal" || l.type === "power",
  ).length;

  const nets: ParsedKicadPcbNet[] = [];
  const netByOrdinal = new Map<number, string>();
  for (const node of findNodes(expr, "net")) {
    const ordinal = getNumberValue(node, 1);
    const name = getStringValue(node, 2);
    if (ordinal === null) continue;
    const resolvedName = name ?? "";
    nets.push({ ordinal, name: resolvedName });
    netByOrdinal.set(ordinal, resolvedName);
  }

  const footprints = findNodes(expr, "footprint")
    .map((node) => parseFootprint(node, warnings))
    .filter((f): f is ParsedKicadPcbFootprint => f !== null);

  const segmentsRaw = findNodes(expr, "segment")
    .map((node) => parseSegment(node, netByOrdinal))
    .filter((s): s is ParsedKicadPcbSegment => s !== null);

  // Arc tracks tessellate to 1..N chord segments (Tier 1.3).
  const arcsTessellated: ParsedKicadPcbSegment[] = [];
  for (const arcNode of findNodes(expr, "arc")) {
    arcsTessellated.push(...parseArcAsSegments(arcNode, netByOrdinal));
  }
  const segments = [...segmentsRaw, ...arcsTessellated];

  const vias = findNodes(expr, "via")
    .map((node) => parseVia(node, netByOrdinal))
    .filter((v): v is ParsedKicadPcbVia => v !== null);

  const zones = findNodes(expr, "zone")
    .map((node) => parseZone(node, netByOrdinal))
    .filter((z): z is ParsedKicadPcbZone => z !== null);
  const zoneCount = zones.length;

  const boardOutline = computeBoardOutline(expr);
  const boardOutlinePolygon = computeBoardOutlinePolygon(expr);
  if (!boardOutline) {
    warnings.push({
      code: "board_outline_missing",
      message:
        "No Edge.Cuts graphics found; board outline defaults to 100×80 mm.",
    });
  }

  return {
    version,
    generator,
    copperLayerCount,
    layers,
    nets,
    footprints,
    segments,
    vias,
    boardOutline,
    boardOutlinePolygon,
    zones,
    zoneCount,
    warnings,
  };
}

function parseLayers(
  expr: SExpr[],
  warnings: ParsedKicadProjectWarning[],
): ParsedKicadPcbLayer[] {
  const node = findNode(expr, "layers");
  if (!node) {
    warnings.push({
      code: "layers_missing",
      message: "No (layers ...) section found; layer count will be 0.",
    });
    return [];
  }
  const result: ParsedKicadPcbLayer[] = [];
  for (let i = 1; i < node.length; i++) {
    const entry = node[i];
    if (!Array.isArray(entry)) continue;
    const ordinal =
      typeof entry[0] === "number"
        ? entry[0]
        : Number.isFinite(Number(entry[0]))
          ? Number(entry[0])
          : null;
    const canonicalName =
      typeof entry[1] === "string" ? entry[1] : String(entry[1] ?? "");
    const type =
      typeof entry[2] === "string" ? entry[2] : String(entry[2] ?? "");
    const userName = typeof entry[3] === "string" ? entry[3] : null;
    if (ordinal === null) continue;
    result.push({ ordinal, canonicalName, type, userName });
  }
  return result;
}

function parseFootprint(
  node: SExpr[],
  warnings: ParsedKicadProjectWarning[],
): ParsedKicadPcbFootprint | null {
  const libId = typeof node[1] === "string" ? node[1] : null;
  if (!libId) {
    warnings.push({
      code: "footprint_missing_lib_id",
      message: "Footprint missing lib_id; skipped.",
    });
    return null;
  }
  const at = readAtPoint(findNode(node, "at"));
  if (!at) return null;
  const rotationDeg = readAtRotation(findNode(node, "at"));
  const layer = getStringValue(findNode(node, "layer") ?? [], 1) ?? "F.Cu";
  const properties: Record<string, string> = {};
  // KiCad 7+ canonical form.
  for (const prop of findNodes(node, "property")) {
    const key = getStringValue(prop, 1);
    const value = getStringValue(prop, 2);
    if (key !== null && value !== null) properties[key] = value;
  }
  // KiCad 6 fallback: `(fp_text reference "R1" ...)` / `(fp_text value "10k" ...)`.
  // Only fill in keys the (property ...) pass didn't already populate so v7+
  // files stay authoritative when both forms appear during the v6→v7 rewrite
  // window.
  for (const fp of findNodes(node, "fp_text")) {
    const kind = getStringValue(fp, 1);
    const text = getStringValue(fp, 2);
    if (!kind || text === null) continue;
    if (kind === "reference" && properties["Reference"] === undefined) {
      properties["Reference"] = text;
    } else if (kind === "value" && properties["Value"] === undefined) {
      properties["Value"] = text;
    }
  }
  const reference = properties["Reference"] ?? "?";
  const value = properties["Value"] ?? null;
  const pads = findNodes(node, "pad")
    .map((p) => parsePad(p))
    .filter((p): p is ParsedKicadPcbPad => p !== null);
  const modelRefs = findNodes(node, "model")
    .map((m) => (typeof m[1] === "string" ? m[1] : null))
    .filter((m): m is string => m !== null);
  return {
    libId,
    reference,
    value,
    at,
    rotationDeg,
    layer,
    properties,
    pads,
    modelRefs,
  };
}

function parsePad(node: SExpr[]): ParsedKicadPcbPad | null {
  const number = typeof node[1] === "string" ? node[1] : String(node[1] ?? "");
  const padType = typeof node[2] === "string" ? node[2] : "";
  const shape = typeof node[3] === "string" ? node[3] : "";
  const at = readAtPoint(findNode(node, "at"));
  if (!at) return null;
  const rotationDeg = readAtRotation(findNode(node, "at"));
  const sizeNode = findNode(node, "size");
  const sizeMm = sizeNode
    ? {
        widthMm: getNumberValue(sizeNode, 1) ?? 0,
        heightMm: getNumberValue(sizeNode, 2) ?? 0,
      }
    : null;
  const drillNode = findNode(node, "drill");
  const drillMm = drillNode ? (getNumberValue(drillNode, 1) ?? null) : null;
  const layerNodes = findNode(node, "layers");
  const layers: string[] = layerNodes
    ? (layerNodes.slice(1).filter((l) => typeof l === "string") as string[])
    : [];
  const netNode = findNode(node, "net");
  const netOrdinal = netNode ? getNumberValue(netNode, 1) : null;
  return {
    number,
    padType,
    shape,
    at,
    rotationDeg,
    sizeMm,
    drillMm,
    layers,
    netOrdinal,
  };
}

function parseSegment(
  node: SExpr[],
  netByOrdinal: Map<number, string>,
): ParsedKicadPcbSegment | null {
  const start = readPointTagged(findNode(node, "start"));
  const end = readPointTagged(findNode(node, "end"));
  if (!start || !end) return null;
  const widthMm = getNumberValue(findNode(node, "width") ?? [], 1);
  const layer = getStringValue(findNode(node, "layer") ?? [], 1);
  const netOrdinal = getNumberValue(findNode(node, "net") ?? [], 1);
  if (widthMm === null || !layer || netOrdinal === null) return null;
  return {
    start,
    end,
    widthMm,
    layer,
    netOrdinal,
    netName: netByOrdinal.get(netOrdinal) ?? null,
  };
}

function parseVia(
  node: SExpr[],
  netByOrdinal: Map<number, string>,
): ParsedKicadPcbVia | null {
  const at = readAtPoint(findNode(node, "at"));
  if (!at) return null;
  const sizeMm = getNumberValue(findNode(node, "size") ?? [], 1);
  const drillMm = getNumberValue(findNode(node, "drill") ?? [], 1);
  if (sizeMm === null || drillMm === null) return null;
  const layerNode = findNode(node, "layers");
  const layerNames: string[] = layerNode
    ? (layerNode.slice(1).filter((l) => typeof l === "string") as string[])
    : [];
  if (layerNames.length < 2) return null;
  const netOrdinal = getNumberValue(findNode(node, "net") ?? [], 1);
  if (netOrdinal === null) return null;
  let type: "through" | "blind" | "micro" = "through";
  if (findNode(node, "micro")) type = "micro";
  else if (findNode(node, "blind")) type = "blind";
  return {
    at,
    sizeMm,
    drillMm,
    layers: [layerNames[0]!, layerNames[1]!],
    netOrdinal,
    netName: netByOrdinal.get(netOrdinal) ?? null,
    type,
  };
}

/**
 * Tessellate a KiCad `(arc (start) (mid) (end) ...)` track token into a
 * polyline of chord segments. KiCad's arc carries start, midpoint (NOT center),
 * and end — we recover the circle center geometrically, then walk evenly-spaced
 * angles between start and end through the side containing mid.
 *
 * Resolution: up to 16 chords per 90° of arc sweep. Width/layer/net are
 * preserved on each chord and `originatedFromArc: true` is flagged for the
 * commit pipeline.
 *
 * Returns an empty array when the arc is degenerate (colinear three points,
 * zero width, missing net/layer, etc.) so the caller can ignore it without
 * downstream errors.
 */
function parseArcAsSegments(
  node: SExpr[],
  netByOrdinal: Map<number, string>,
): ParsedKicadPcbSegment[] {
  const start = readPointTagged(findNode(node, "start"));
  const mid = readPointTagged(findNode(node, "mid"));
  const end = readPointTagged(findNode(node, "end"));
  if (!start || !mid || !end) return [];
  const widthMm = getNumberValue(findNode(node, "width") ?? [], 1);
  const layer = getStringValue(findNode(node, "layer") ?? [], 1);
  const netOrdinal = getNumberValue(findNode(node, "net") ?? [], 1);
  if (widthMm === null || !layer || netOrdinal === null) return [];

  // Circumscribed circle of triangle (start, mid, end).
  const ax = start.xMm;
  const ay = start.yMm;
  const bx = mid.xMm;
  const by = mid.yMm;
  const cx = end.xMm;
  const cy = end.yMm;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) {
    // Colinear (zero-radius) — fall back to a single straight chord.
    return [
      {
        start,
        end,
        widthMm,
        layer,
        netOrdinal,
        netName: netByOrdinal.get(netOrdinal) ?? null,
        originatedFromArc: true,
      },
    ];
  }
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d;
  const r = Math.hypot(ax - ux, ay - uy);
  const a0 = Math.atan2(ay - uy, ax - ux);
  const a1 = Math.atan2(by - uy, bx - ux);
  const a2 = Math.atan2(cy - uy, cx - ux);

  // Determine sweep direction by checking whether `mid`'s angle lies on the
  // CCW path from start→end or the CW path. Normalize to [0, 2π).
  const ccwFromStartToMid = mod2pi(a1 - a0);
  const ccwFromStartToEnd = mod2pi(a2 - a0);
  const goesCcw = ccwFromStartToMid <= ccwFromStartToEnd;
  const sweep = goesCcw ? ccwFromStartToEnd : 2 * Math.PI - ccwFromStartToEnd;

  // Up to 16 chords per 90° — round up to integer chord count, clamp ≥1.
  const chordsPerNinety = 16;
  const chords = Math.max(
    1,
    Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * chordsPerNinety),
  );
  const out: ParsedKicadPcbSegment[] = [];
  let prev = start;
  for (let i = 1; i <= chords; i += 1) {
    const t = i / chords;
    const angle = goesCcw ? a0 + sweep * t : a0 - sweep * t;
    const next: ParsedKicadPcbPoint = {
      xMm: ux + r * Math.cos(angle),
      yMm: uy + r * Math.sin(angle),
    };
    out.push({
      start: prev,
      end: i === chords ? end : next,
      widthMm,
      layer,
      netOrdinal,
      netName: netByOrdinal.get(netOrdinal) ?? null,
      originatedFromArc: true,
    });
    prev = i === chords ? end : next;
  }
  return out;
}

function mod2pi(theta: number): number {
  const x = theta % (2 * Math.PI);
  return x < 0 ? x + 2 * Math.PI : x;
}

function computeBoardOutline(expr: SExpr[]): ParsedKicadPcbBoardOutline | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let foundAny = false;

  const accumulatePoint = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    foundAny = true;
  };

  const visitGraphic = (node: SExpr[]): void => {
    const layer = getStringValue(findNode(node, "layer") ?? [], 1);
    if (layer !== "Edge.Cuts") return;
    for (const tag of ["start", "end", "center", "mid"] as const) {
      const p = readPointTagged(findNode(node, tag));
      if (p) accumulatePoint(p.xMm, p.yMm);
    }
    const pts = findNode(node, "pts");
    if (pts) {
      for (const xy of findNodes(pts, "xy")) {
        const x = getNumberValue(xy, 1);
        const y = getNumberValue(xy, 2);
        if (x !== null && y !== null) accumulatePoint(x, y);
      }
    }
  };

  for (const tag of ["gr_line", "gr_rect", "gr_arc", "gr_circle", "gr_poly"]) {
    for (const node of findNodes(expr, tag)) visitGraphic(node);
  }

  if (!foundAny) return null;
  return { minXMm: minX, minYMm: minY, maxXMm: maxX, maxYMm: maxY };
}

/**
 * Best-effort assembly of Edge.Cuts graphics into a single closed polyline.
 * Walks gr_line / gr_arc / gr_rect / gr_circle / gr_poly tokens, tessellates
 * arcs / circles, then chains by nearest-endpoint adjacency. Falls back to
 * the bbox-rect path (callers handle `null`) when the graphics don't form a
 * single closed loop.
 */
function computeBoardOutlinePolygon(
  expr: SExpr[],
): ParsedKicadPcbPoint[] | null {
  type Edge = { a: ParsedKicadPcbPoint; b: ParsedKicadPcbPoint };
  const edges: Edge[] = [];
  const pushEdge = (a: ParsedKicadPcbPoint, b: ParsedKicadPcbPoint): void => {
    if (Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm) < 1e-6) return;
    edges.push({ a, b });
  };

  for (const node of findNodes(expr, "gr_line")) {
    if (getStringValue(findNode(node, "layer") ?? [], 1) !== "Edge.Cuts")
      continue;
    const s = readPointTagged(findNode(node, "start"));
    const e = readPointTagged(findNode(node, "end"));
    if (s && e) pushEdge(s, e);
  }
  for (const node of findNodes(expr, "gr_arc")) {
    if (getStringValue(findNode(node, "layer") ?? [], 1) !== "Edge.Cuts")
      continue;
    const s = readPointTagged(findNode(node, "start"));
    const m = readPointTagged(findNode(node, "mid"));
    const e = readPointTagged(findNode(node, "end"));
    if (!s || !m || !e) continue;
    // Tessellate the arc into chord segments (same algorithm as track arcs).
    const tessellated = tessellateArcChords(s, m, e, 16);
    for (let i = 1; i < tessellated.length; i += 1) {
      pushEdge(tessellated[i - 1]!, tessellated[i]!);
    }
  }
  for (const node of findNodes(expr, "gr_rect")) {
    if (getStringValue(findNode(node, "layer") ?? [], 1) !== "Edge.Cuts")
      continue;
    const s = readPointTagged(findNode(node, "start"));
    const e = readPointTagged(findNode(node, "end"));
    if (!s || !e) continue;
    const corners: ParsedKicadPcbPoint[] = [
      { xMm: s.xMm, yMm: s.yMm },
      { xMm: e.xMm, yMm: s.yMm },
      { xMm: e.xMm, yMm: e.yMm },
      { xMm: s.xMm, yMm: e.yMm },
    ];
    for (let i = 0; i < corners.length; i += 1) {
      pushEdge(corners[i]!, corners[(i + 1) % corners.length]!);
    }
  }
  for (const node of findNodes(expr, "gr_circle")) {
    if (getStringValue(findNode(node, "layer") ?? [], 1) !== "Edge.Cuts")
      continue;
    const center = readPointTagged(findNode(node, "center"));
    const end = readPointTagged(findNode(node, "end"));
    if (!center || !end) continue;
    const r = Math.hypot(end.xMm - center.xMm, end.yMm - center.yMm);
    const segments = 64;
    let prev: ParsedKicadPcbPoint | null = null;
    for (let i = 0; i <= segments; i += 1) {
      const t = (i / segments) * 2 * Math.PI;
      const p: ParsedKicadPcbPoint = {
        xMm: center.xMm + r * Math.cos(t),
        yMm: center.yMm + r * Math.sin(t),
      };
      if (prev) pushEdge(prev, p);
      prev = p;
    }
  }
  for (const node of findNodes(expr, "gr_poly")) {
    if (getStringValue(findNode(node, "layer") ?? [], 1) !== "Edge.Cuts")
      continue;
    const pts = findNode(node, "pts");
    if (!pts) continue;
    const points: ParsedKicadPcbPoint[] = [];
    for (const xy of findNodes(pts, "xy")) {
      const x = getNumberValue(xy, 1);
      const y = getNumberValue(xy, 2);
      if (x !== null && y !== null) points.push({ xMm: x, yMm: y });
    }
    for (let i = 0; i < points.length; i += 1) {
      pushEdge(points[i]!, points[(i + 1) % points.length]!);
    }
  }
  if (edges.length === 0) return null;

  // Chain edges into a single ordered polyline by nearest-endpoint matching.
  const epsilon = 0.01; // mm — KiCad outline endpoints are typically exact.
  const sameish = (a: ParsedKicadPcbPoint, b: ParsedKicadPcbPoint): boolean =>
    Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm) < epsilon;
  const consumed = new Array<boolean>(edges.length).fill(false);
  const start = edges[0]!;
  consumed[0] = true;
  const poly: ParsedKicadPcbPoint[] = [start.a, start.b];
  let tail = start.b;
  for (let safety = 0; safety < edges.length * 2; safety += 1) {
    const next = edges.findIndex(
      (e, i) => !consumed[i] && (sameish(e.a, tail) || sameish(e.b, tail)),
    );
    if (next === -1) break;
    consumed[next] = true;
    const e = edges[next]!;
    tail = sameish(e.a, tail) ? e.b : e.a;
    poly.push(tail);
    if (sameish(tail, start.a)) break; // closed loop
  }
  // Only return when the chain actually closes; otherwise the outline has
  // disjoint segments and the rectangle bbox fallback is safer.
  if (!sameish(poly[poly.length - 1]!, poly[0]!)) return null;
  // Drop the duplicate-closing point.
  if (poly.length > 1) poly.pop();
  return poly;
}

function tessellateArcChords(
  start: ParsedKicadPcbPoint,
  mid: ParsedKicadPcbPoint,
  end: ParsedKicadPcbPoint,
  chordsPerNinety: number,
): ParsedKicadPcbPoint[] {
  const ax = start.xMm;
  const ay = start.yMm;
  const bx = mid.xMm;
  const by = mid.yMm;
  const cx = end.xMm;
  const cy = end.yMm;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return [start, end];
  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d;
  const r = Math.hypot(ax - ux, ay - uy);
  const a0 = Math.atan2(ay - uy, ax - ux);
  const a1 = Math.atan2(by - uy, bx - ux);
  const a2 = Math.atan2(cy - uy, cx - ux);
  const ccwToMid = mod2pi(a1 - a0);
  const ccwToEnd = mod2pi(a2 - a0);
  const goesCcw = ccwToMid <= ccwToEnd;
  const sweep = goesCcw ? ccwToEnd : 2 * Math.PI - ccwToEnd;
  const chords = Math.max(
    1,
    Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * chordsPerNinety),
  );
  const out: ParsedKicadPcbPoint[] = [start];
  for (let i = 1; i <= chords; i += 1) {
    const t = i / chords;
    const angle = goesCcw ? a0 + sweep * t : a0 - sweep * t;
    out.push(
      i === chords
        ? end
        : { xMm: ux + r * Math.cos(angle), yMm: uy + r * Math.sin(angle) },
    );
  }
  return out;
}

function parseZone(
  node: SExpr[],
  netByOrdinal: Map<number, string>,
): ParsedKicadPcbZone | null {
  // Locator helpers — KiCad uses (net N) for ordinal AND (net_name "STRING")
  // for the actual name (since ordinals are unstable across saves).
  const netNode = findNode(node, "net");
  const netOrdinal = netNode ? getNumberValue(netNode, 1) : null;
  const netNameNode = findNode(node, "net_name");
  const netNameExplicit = netNameNode ? getStringValue(netNameNode, 1) : null;
  const netName =
    netNameExplicit ??
    (netOrdinal !== null ? (netByOrdinal.get(netOrdinal) ?? null) : null);
  const layer = getStringValue(findNode(node, "layer") ?? [], 1) ?? "F.Cu";
  // Outline polygon — use the first `(polygon (pts ...))` block; ignore
  // computed `(filled_polygon ...)` blocks (recomputed by OpenPCB later).
  const polygon = findNode(node, "polygon");
  const pts = polygon ? findNode(polygon, "pts") : null;
  const polygonPointsMm: ParsedKicadPcbPoint[] = [];
  if (pts) {
    for (const xy of findNodes(pts, "xy")) {
      const x = getNumberValue(xy, 1);
      const y = getNumberValue(xy, 2);
      if (x !== null && y !== null) polygonPointsMm.push({ xMm: x, yMm: y });
    }
  }
  if (polygonPointsMm.length < 3) return null;
  // Hatch / fill mode tokens are nested; defaults match KiCad's behaviour.
  const hatchNode = findNode(node, "hatch");
  const hatchEdgeMm = hatchNode ? (getNumberValue(hatchNode, 2) ?? 0.5) : 0.5;
  const fillNode = findNode(node, "fill");
  const fillMode = fillNode
    ? (getStringValue(findNode(fillNode, "mode") ?? [], 1) ?? "solid")
    : "solid";
  return {
    netOrdinal,
    netName,
    layer,
    polygonPointsMm,
    hatchEdgeMm,
    fillType: fillMode === "hatch" ? "hatched" : "solid",
  };
}

function readPointTagged(node: SExpr[] | null): ParsedKicadPcbPoint | null {
  if (!node) return null;
  const x = getNumberValue(node, 1);
  const y = getNumberValue(node, 2);
  if (x === null || y === null) return null;
  return { xMm: x, yMm: y };
}

function readAtPoint(node: SExpr[] | null): ParsedKicadPcbPoint | null {
  return readPointTagged(node);
}

function readAtRotation(node: SExpr[] | null): number {
  if (!node) return 0;
  return getNumberValue(node, 3) ?? 0;
}
