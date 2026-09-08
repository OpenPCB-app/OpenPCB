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
 *   - zones (copper areas) and keepouts (KiCad "rule areas") — S3a contract §8
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
import type {
  PcbBoardContour,
  PcbOutlineSegment,
  PcbPointMm,
} from "../../../../../../sdks/designer";
import {
  type OutlineBias,
  computeOutlineBboxMm,
  flattenOutline,
} from "../../../../../../shared/pcb-geometry/outline-geometry";
import { ringStrictlyInside } from "../../../../../../shared/pcb-geometry/region-rings";
import { canonicalizeRing } from "../../../../../../shared/pcb-geometry/ring-utils";
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
  /** Copper zones — one entry per `(zone …)` node without a `(keepout …)`. */
  zones: ParsedKicadPcbZone[];
  /** Count of copper zones encountered (kept for backward-compat reporting). */
  zoneCount: number;
  /** KiCad "rule areas" — `(zone …)` nodes that carry a `(keepout …)` child. */
  keepouts: ParsedKicadPcbKeepout[];
  /** Count of rule areas encountered. */
  keepoutCount: number;
  warnings: ParsedKicadProjectWarning[];
}

/**
 * A copper zone as it appears in the file (S3a contract §8). Every optional
 * token is `null` when the file does not carry it — no numeric default is
 * invented here, so the insert step can leave the corresponding `PcbZone`
 * override absent and inherit the board rule.
 */
export interface ParsedKicadPcbZone {
  netOrdinal: number | null;
  /** `null` for ordinal 0 or an empty name — net-less copper (contract §3.2). */
  netName: string | null;
  /**
   * Canonical layer names after `F&B.Cu` / `*.Cu` expansion against THIS
   * file's copper layer table. Non-copper names are kept so the insert step
   * can warn about them.
   */
  layers: string[];
  name: string | null;
  /** Integer ≥ 0; `0` when the file carries no `(priority …)`. */
  priority: number;
  padConnection: ParsedKicadPcbZonePadConnection | null;
  clearanceMm: number | null;
  minThicknessMm: number | null;
  thermal: { gapMm: number; spokeWidthMm: number } | null;
  islandRemoval: ParsedKicadPcbZoneIslandRemoval | null;
  /** `(fill (mode hatch))` — imported as a solid fill with a warning. */
  fillModeHatch: boolean;
  locked: boolean;
  /** First contour only, arcs flattened INSCRIBED. */
  polygonPointsMm: ParsedKicadPcbPoint[];
  /**
   * Further `(polygon …)` blocks lying OUTSIDE the first contour — second
   * outlines. Dropping one pours less copper than drawn, which is safe.
   */
  extraContours: number;
  /**
   * Further `(polygon …)` blocks lying strictly INSIDE the first contour —
   * cutouts (copper-pour contract §11). Their arcs are flattened OUTWARD, the
   * opposite bias to the outline's: a cutout may only grow, so the zone never
   * pours more copper than the file draws.
   */
  holes: ParsedKicadPcbPoint[][];
}

export type ParsedKicadPcbZonePadConnection =
  "solid" | "thermal" | "thruHoleThermal" | "none";

export type ParsedKicadPcbZoneIslandRemoval =
  "always" | "never" | { minAreaMm2: number };

/** A KiCad rule area — `(zone … (keepout …))`. Rule areas make no copper. */
export interface ParsedKicadPcbKeepout {
  name: string | null;
  /** Canonical layer names, expanded exactly as {@link ParsedKicadPcbZone}. */
  layers: string[];
  /** `true` = the object class is forbidden inside the area. */
  restrictions: {
    tracks: boolean;
    vias: boolean;
    pads: boolean;
    copperPour: boolean;
    footprints: boolean;
  };
  locked: boolean;
  /** First contour only, arcs flattened CIRCUMSCRIBED. */
  polygonPointsMm: ParsedKicadPcbPoint[];
  /**
   * Further `(polygon …)` blocks, holes included. Ignoring a hole only makes
   * the forbidden area larger, so every one of them is simply dropped.
   */
  extraContours: number;
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

  const copperLayerNames = layers
    .filter((l) => l.type === "signal" || l.type === "power")
    .map((l) => l.canonicalName);
  const zones: ParsedKicadPcbZone[] = [];
  const keepouts: ParsedKicadPcbKeepout[] = [];
  for (const node of findNodes(expr, "zone")) {
    const parsed = parseZoneOrKeepout(
      node,
      netByOrdinal,
      copperLayerNames,
      warnings,
    );
    if (!parsed) continue;
    if (parsed.kind === "keepout") keepouts.push(parsed.keepout);
    else zones.push(parsed.zone);
  }
  const zoneCount = zones.length;
  const keepoutCount = keepouts.length;

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
    keepouts,
    keepoutCount,
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

type ParsedZoneOrKeepout =
  | { kind: "zone"; zone: ParsedKicadPcbZone }
  | { kind: "keepout"; keepout: ParsedKicadPcbKeepout };

/**
 * Classify one `(zone …)` node (S3a contract §8): a node carrying a direct
 * `(keepout …)` child is a KiCad rule area, everything else is copper.
 * Rule-area contours are flattened CIRCUMSCRIBED (the forbidden region may
 * only grow); copper contours INSCRIBED (copper may only shrink).
 */
function parseZoneOrKeepout(
  node: SExpr[],
  netByOrdinal: Map<number, string>,
  copperLayerNames: readonly string[],
  warnings: ParsedKicadProjectWarning[],
): ParsedZoneOrKeepout | null {
  const keepoutNode = findNode(node, "keepout");
  const name = getStringValue(findNode(node, "name") ?? [], 1);
  const layers = readZoneLayers(node, copperLayerNames);
  const locked = readLockedFlag(node);
  // Outline polygons — the first `(polygon (pts …))` block is the contour;
  // computed `(filled_polygon …)` blocks are recomputed by OpenPCB later.
  // Region side, not construction — the S2 sampler picks per arc (see
  // `readContourPoints`): a zone may never gain copper, a keepout may never
  // lose forbidden area.
  const bias: OutlineBias = keepoutNode ? "outward" : "inward";
  const polygonNodes = findNodes(node, "polygon");
  const contours = polygonNodes.map((c) => readContourPoints(c, bias));
  const polygonPointsMm = contours[0] ?? [];
  if (polygonPointsMm.length < 3) return null;

  if (keepoutNode) {
    return {
      kind: "keepout",
      keepout: {
        name,
        layers,
        restrictions: readKeepoutRestrictions(keepoutNode),
        locked,
        polygonPointsMm,
        extraContours: contours.length - 1,
      },
    };
  }

  if (!layers.some(isCopperLayerName)) {
    warnings.push({
      code: "zone_no_copper_layer",
      message: `Zone ${describeZone(name)} resolves to no copper layer (${layers.join(", ") || "none"}); dropped.`,
    });
    return null;
  }

  const fillNode = findNode(node, "fill");
  return {
    kind: "zone",
    zone: {
      ...readZoneNet(node, netByOrdinal),
      layers,
      name,
      priority: readZonePriority(node),
      padConnection: readZonePadConnection(node),
      clearanceMm: readZoneClearanceMm(node),
      minThicknessMm: readNumberToken(node, "min_thickness"),
      thermal: readZoneThermal(node, fillNode),
      islandRemoval: readZoneIslandRemoval(fillNode),
      fillModeHatch:
        getStringValue(findNode(fillNode ?? [], "mode") ?? [], 1) === "hatch",
      locked,
      polygonPointsMm,
      // Classification runs against the OUTWARD flattening of the outline —
      // NOT the inward `polygonPointsMm` the zone pours (see below); only the
      // points KEPT for a cutout are re-flattened outward (§11).
      ...classifyExtraContours(
        readContourPoints(polygonNodes[0]!, "outward"),
        contours.slice(1),
        polygonNodes.slice(1).map((c) => readContourPoints(c, "outward")),
      ),
    },
  };
}

/**
 * Split the contours after the first into holes (strictly inside the outline)
 * and second outlines (everything else) — contract §8. A second outline is
 * dropped (less copper: safe); a hole is KEPT, from `outwardExtras`, the same
 * contours re-flattened with the cutout bias (copper-pour contract §11).
 *
 * `outline` is the OUTWARD flattening of the first contour — a superset of the
 * true outer, so anything strictly inside the true outer is strictly inside it.
 * Classifying against the inward flattening the zone pours is not fail-safe: a
 * chord that cuts inside a shallow arc can cross a hole that the true outer
 * contains, demoting the hole to a second outline and DROPPING it, which pours
 * copper inside the shape the file draws as a cutout. A hole whose kept outward
 * ring then fails `zoneRegionValidity` against the inward outer is not dropped
 * either — the insert step imports the zone disabled (`zone_hole_invalid_import`).
 */
function classifyExtraContours(
  outline: readonly ParsedKicadPcbPoint[],
  extras: readonly ParsedKicadPcbPoint[][],
  outwardExtras: readonly ParsedKicadPcbPoint[][],
): { extraContours: number; holes: ParsedKicadPcbPoint[][] } {
  if (extras.length === 0) return { extraContours: 0, holes: [] };
  const outlineRing = canonicalizeRing(toRingMm(outline));
  let extraContours = 0;
  const holes: ParsedKicadPcbPoint[][] = [];
  for (const [i, extra] of extras.entries()) {
    const ring = canonicalizeRing(toRingMm(extra));
    if (ring.length >= 3 && ringStrictlyInside(ring, outlineRing)) {
      holes.push(outwardExtras[i] ?? extra);
    } else {
      extraContours += 1;
    }
  }
  return { extraContours, holes };
}

function toRingMm(
  points: readonly ParsedKicadPcbPoint[],
): { x: number; y: number }[] {
  return points.map((p) => ({ x: p.xMm, y: p.yMm }));
}

function describeZone(name: string | null): string {
  return name ? `'${name}'` : "(unnamed)";
}

/** `F.Cu`, `B.Cu` and `In1.Cu`..`In30.Cu` — the ids `PcbCopperLayerId` allows. */
function isCopperLayerName(name: string): boolean {
  return /^(F|B|In([1-9]|[12][0-9]|30))\.Cu$/.test(name);
}

/**
 * `(layer "F.Cu")` and `(layers "F.Cu" "B.Cu")`, with `F&B.Cu` and `*.Cu`
 * expanded against THIS file's copper stackup. Non-copper names survive so the
 * insert step can warn about them; duplicates are collapsed.
 */
function readZoneLayers(
  node: SExpr[],
  copperLayerNames: readonly string[],
): string[] {
  const tokens: string[] = [];
  const single = findNode(node, "layer");
  if (single) {
    const value = getStringValue(single, 1);
    if (value) tokens.push(value);
  }
  const multi = findNode(node, "layers");
  if (multi) {
    for (let i = 1; i < multi.length; i += 1) {
      const value = multi[i];
      if (typeof value === "string") tokens.push(value);
    }
  }
  const out: string[] = [];
  for (const token of tokens) {
    const expanded =
      token === "*.Cu"
        ? [...copperLayerNames]
        : token === "F&B.Cu"
          ? ["F.Cu", "B.Cu"]
          : [token];
    for (const layer of expanded) {
      if (!out.includes(layer)) out.push(layer);
    }
  }
  return out;
}

/** Both the modern `(locked yes)` node and the legacy bare `locked` atom. */
function readLockedFlag(node: SExpr[]): boolean {
  for (const child of node) {
    if (child === "locked") return true;
    if (Array.isArray(child) && child[0] === "locked") {
      const value = getStringValue(child, 1);
      return value === null || value === "yes" || value === "true";
    }
  }
  return false;
}

function readKeepoutRestrictions(
  keepoutNode: SExpr[],
): ParsedKicadPcbKeepout["restrictions"] {
  const forbidden = (...tags: string[]): boolean =>
    tags.some(
      (tag) =>
        getStringValue(findNode(keepoutNode, tag) ?? [], 1) === "not_allowed",
    );
  return {
    tracks: forbidden("tracks"),
    vias: forbidden("vias"),
    pads: forbidden("pads"),
    copperPour: forbidden("copperpour", "copper_pour"),
    footprints: forbidden("footprints"),
  };
}

/**
 * The one place a `(polygon …)` becomes points — outlines, holes and second
 * outlines alike. The `pts` list is rebuilt as a `PcbBoardContour` (`(xy …)` →
 * line, `(arc (start)(mid)(end))` → arc about the three points' circumcircle)
 * and handed to the S2 sampler, which reads the contour's EXACT signed area,
 * derives which side of each arc its centre is on, and picks inscribed or
 * tangent-chain per arc so the ring lands on the requested side. A fixed bias
 * per kind is wrong at a concave arc: the notch bulges the other way, so an
 * inscribed chord across it would add copper inside the notch (Astra §8).
 *
 * `bias` is therefore the REGION side, not a construction: `"inward"` for a
 * zone (polygon ⊆ true region — never more copper than drawn) and `"outward"`
 * for a keepout (polygon ⊇ true region — never a smaller forbidden area).
 * A contour with no arcs flattens to exactly its `xy` points.
 */
function readContourPoints(
  polygon: SExpr[],
  bias: OutlineBias,
): ParsedKicadPcbPoint[] {
  const pts = findNode(polygon, "pts");
  if (!pts) return [];
  let start: PcbPointMm | null = null;
  const segments: PcbOutlineSegment[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    const child = pts[i];
    if (!Array.isArray(child)) continue;
    if (child[0] === "xy") {
      const x = getNumberValue(child, 1);
      const y = getNumberValue(child, 2);
      if (x === null || y === null) continue;
      if (start) segments.push({ type: "line", to: { x, y } });
      else start = { x, y };
      continue;
    }
    if (child[0] !== "arc") continue;
    const from = readPointTagged(findNode(child, "start"));
    const mid = readPointTagged(findNode(child, "mid"));
    const end = readPointTagged(findNode(child, "end"));
    if (!from || !mid || !end) continue;
    if (!start) start = { x: from.xMm, y: from.yMm };
    segments.push(arcSegmentFrom3Points(from, mid, end));
  }
  if (!start) return [];
  const base: PcbBoardContour = {
    kind: "contour",
    // The flattener reads only `start` + `segments`; the cached bbox is filled
    // in from the geometry so the record is not carrying invented numbers.
    widthMm: 0,
    heightMm: 0,
    centerMm: { x: 0, y: 0 },
    start,
    segments,
  };
  const contour: PcbBoardContour = { ...base, ...computeOutlineBboxMm(base) };
  return flattenOutline(contour, { bias }).map((p) => ({
    xMm: p.x,
    yMm: p.y,
  }));
}

/**
 * One `(arc (start)(mid)(end))` as a contour segment: the circle through the
 * three points, with the sweep direction read off the mid point. `cw` is in the
 * stored-mm frame the S2 sampler uses (`cw === false` puts the centre to the
 * LEFT of travel), which is the same raw KiCad frame the signed area is taken
 * in — so the two agree regardless of KiCad's y-down convention. A collinear /
 * degenerate arc degrades to a straight segment.
 */
function arcSegmentFrom3Points(
  start: ParsedKicadPcbPoint,
  mid: ParsedKicadPcbPoint,
  end: ParsedKicadPcbPoint,
): PcbOutlineSegment {
  const to: PcbPointMm = { x: end.xMm, y: end.yMm };
  const circle = circumcircleOf(start, mid, end);
  if (!circle) return { type: "line", to };
  const a0 = Math.atan2(start.yMm - circle.cy, start.xMm - circle.cx);
  const aMid = Math.atan2(mid.yMm - circle.cy, mid.xMm - circle.cx);
  const aEnd = Math.atan2(end.yMm - circle.cy, end.xMm - circle.cx);
  const ccwToEnd = mod2pi(aEnd - a0);
  const goesCcw = mod2pi(aMid - a0) <= ccwToEnd;
  return {
    type: "arc",
    to,
    centerMm: { x: circle.cx, y: circle.cy },
    cw: !goesCcw,
  };
}

function circumcircleOf(
  a: ParsedKicadPcbPoint,
  b: ParsedKicadPcbPoint,
  c: ParsedKicadPcbPoint,
): { cx: number; cy: number; r: number } | null {
  const [ax, ay] = [a.xMm, a.yMm];
  const [bx, by] = [b.xMm, b.yMm];
  const [cx, cy] = [c.xMm, c.yMm];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return null;
  const sa = ax * ax + ay * ay;
  const sb = bx * bx + by * by;
  const sc = cx * cx + cy * cy;
  const ux = (sa * (by - cy) + sb * (cy - ay) + sc * (ay - by)) / d;
  const uy = (sa * (cx - bx) + sb * (ax - cx) + sc * (bx - ax)) / d;
  if (!Number.isFinite(ux) || !Number.isFinite(uy)) return null;
  return { cx: ux, cy: uy, r: Math.hypot(ax - ux, ay - uy) };
}

/**
 * KiCad writes `(net N)` for the ordinal and `(net_name "STRING")` for the
 * name (ordinals are unstable across saves). Ordinal 0 or an empty name is
 * net-less copper (contract §3.2), never a net called "".
 */
function readZoneNet(
  node: SExpr[],
  netByOrdinal: Map<number, string>,
): { netOrdinal: number | null; netName: string | null } {
  const netNode = findNode(node, "net");
  const netOrdinal = netNode ? getNumberValue(netNode, 1) : null;
  const netNameNode = findNode(node, "net_name");
  const explicit = netNameNode ? getStringValue(netNameNode, 1) : null;
  const resolved =
    explicit ??
    (netOrdinal !== null ? (netByOrdinal.get(netOrdinal) ?? null) : null);
  const netName = netOrdinal === 0 || !resolved ? null : resolved;
  return { netOrdinal, netName };
}

function readZonePriority(node: SExpr[]): number {
  const value = readNumberToken(node, "priority");
  if (value === null || value < 0) return 0;
  return Math.floor(value);
}

/**
 * `(connect_pads yes|no|thru_hole_only …)`. KiCad omits the value token for its
 * thermal-relief default and writes only the nested `(clearance …)`, so a bare
 * node means thermal, not solid. The contract's `thermal_reliefs` spelling is
 * accepted too. An absent node leaves the override absent (board default).
 */
function readZonePadConnection(
  node: SExpr[],
): ParsedKicadPcbZonePadConnection | null {
  const connect = findNode(node, "connect_pads");
  if (!connect) return null;
  const value = getStringValue(connect, 1);
  if (value === null) return "thermal";
  if (value === "yes" || value === "true") return "solid";
  if (value === "no" || value === "false") return "none";
  if (value === "thru_hole_only") return "thruHoleThermal";
  if (value === "thermal_reliefs" || value === "thermal") return "thermal";
  return null;
}

/** `(connect_pads … (clearance x))`, falling back to a zone-level `(clearance x)`. */
function readZoneClearanceMm(node: SExpr[]): number | null {
  const connect = findNode(node, "connect_pads");
  const nested = connect ? readNumberToken(connect, "clearance") : null;
  return nested ?? readNumberToken(node, "clearance");
}

/** Only a complete `(thermal_gap g)` + `(thermal_bridge_width w)` pair counts. */
function readZoneThermal(
  node: SExpr[],
  fillNode: SExpr[] | null,
): { gapMm: number; spokeWidthMm: number } | null {
  const gapMm =
    readNumberToken(fillNode, "thermal_gap") ??
    readNumberToken(node, "thermal_gap");
  const spokeWidthMm =
    readNumberToken(fillNode, "thermal_bridge_width") ??
    readNumberToken(node, "thermal_bridge_width");
  if (gapMm === null || spokeWidthMm === null) return null;
  return { gapMm, spokeWidthMm };
}

/**
 * `(island_removal_mode 0|1|2)`; mode 2 additionally needs `(island_area_min a)`
 * — without it there is no area to honour and no default may be invented, so
 * the override stays absent.
 */
function readZoneIslandRemoval(
  fillNode: SExpr[] | null,
): ParsedKicadPcbZoneIslandRemoval | null {
  const mode = readNumberToken(fillNode, "island_removal_mode");
  if (mode === 0) return "always";
  if (mode === 1) return "never";
  if (mode !== 2) return null;
  const minAreaMm2 = readNumberToken(fillNode, "island_area_min");
  return minAreaMm2 === null ? null : { minAreaMm2 };
}

function readNumberToken(node: SExpr[] | null, tag: string): number | null {
  if (!node) return null;
  const found = findNode(node, tag);
  if (!found) return null;
  const value = getNumberValue(found, 1);
  return value !== null && Number.isFinite(value) ? value : null;
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
