/**
 * KiCad PCB File Parser (.kicad_pcb)
 *
 * Reference: https://dev-docs.kicad.org/en/file-formats/sexpr-pcb/index.html
 *
 * Extracts the entities OpenPCB's designer module consumes for import:
 *   - copper layer count (layers NAMED F.Cu / B.Cu / InN.Cu, whatever their type)
 *   - footprint placements (lib_id, refdes, value, at, rotation, layer, uuid,
 *     schematic path, attr, pads with pin function, footprint graphics)
 *   - traces (segments — start/end/width/layer/net; no-net copper is kept)
 *   - vias (at/size/drill/layers/net)
 *   - top-level nets (ordinal → name; the name-only `(net "X")` is tolerated)
 *   - board graphics (`gr_*`) with text style fields
 *   - every Edge.Cuts primitive (board and footprint) with exact arcs, plus the
 *     legacy bounding box / single-loop outline
 *   - board setup mask / paste / tenting values
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
import {
  KICAD_COPPER_LAYER_NAME,
  readNetRef,
  readNumberToken,
  readPointTagged,
  readYesNoToken,
  tessellateArcChords,
} from "./kicad-pcb-common";
import { parseFootprint } from "./kicad-pcb-footprint";
import {
  type ParsedKicadPcbGraphic,
  parseBoardGraphics,
} from "./kicad-pcb-graphics";
import {
  type ParsedKicadPcbBoardOutline,
  type ParsedKicadPcbEdgePrimitive,
  computeBoardOutline,
  computeBoardOutlinePolygon,
  parseEdgeCutPrimitives,
} from "./kicad-pcb-outline";
import {
  type ParsedKicadPcbKeepout,
  type ParsedKicadPcbZone,
  parseZoneOrKeepout,
} from "./kicad-pcb-zones";
import type { ParsedKicadProjectWarning } from "./kicad-project-parser";

export type {
  ParsedKicadPcbGraphic,
  ParsedKicadPcbGraphicKind,
  ParsedKicadPcbTextStyle,
} from "./kicad-pcb-graphics";
export type {
  ParsedKicadPcbKeepout,
  ParsedKicadPcbZone,
  ParsedKicadPcbZoneIslandRemoval,
  ParsedKicadPcbZonePadConnection,
} from "./kicad-pcb-zones";
export type {
  ParsedKicadPcbBoardOutline,
  ParsedKicadPcbEdgePrimitive,
  ParsedKicadPcbEdgeSource,
} from "./kicad-pcb-outline";

export interface ParsedKicadPcb {
  version: number | null;
  generator: string | null;
  generatorVersion: string | null;
  /** Copper layers counted by canonical NAME (`/^(F|B|In\d+)\.Cu$/`). */
  copperLayerCount: number;
  /** All declared layers in stack order. */
  layers: ParsedKicadPcbLayer[];
  nets: ParsedKicadPcbNet[];
  footprints: ParsedKicadPcbFootprint[];
  segments: ParsedKicadPcbSegment[];
  vias: ParsedKicadPcbVia[];
  /** Every top-level `gr_*` graphic, all layers, in file order. */
  graphics: ParsedKicadPcbGraphic[];
  /** Every Edge.Cuts primitive: board `gr_*` first, then footprint `fp_*`. */
  edgeCuts: ParsedKicadPcbEdgePrimitive[];
  setup: ParsedKicadPcbSetup;
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

export interface ParsedKicadPcbLayer {
  ordinal: number;
  canonicalName: string;
  type: string;
  userName: string | null;
}

export interface ParsedKicadPcbNet {
  /** `null` for the name-only `(net "name")` spelling. */
  ordinal: number | null;
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
  /** Ordinal among ALL `(footprint …)` tokens in file order (census key). */
  sourceIndex: number;
  uuid: string | null;
  /** `(path "/<sheet uuids…>/<symbol uuid>")` — the schematic link. */
  path: string | null;
  sheetName: string | null;
  sheetFile: string | null;
  attr: ParsedKicadPcbFootprintAttr;
  locked: boolean;
  /** `fp_*` graphics and drawn `property` texts, footprint-local. */
  graphics: ParsedKicadPcbGraphic[];
}

export interface ParsedKicadPcbFootprintAttr {
  type: "smd" | "through_hole" | null;
  boardOnly: boolean;
  excludeFromPosFiles: boolean;
  excludeFromBom: boolean;
  dnp: boolean;
  /** Every atom after the type, verbatim (incl. ones listed above). */
  flags: string[];
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
  /** Explicit `(net N "name")` / `(net "name")` name, else the table's. */
  netName: string | null;
  pinFunction: string | null;
  pinType: string | null;
  uuid: string | null;
}

export interface ParsedKicadPcbSegment {
  start: ParsedKicadPcbPoint;
  end: ParsedKicadPcbPoint;
  widthMm: number;
  layer: string;
  /** `null` with no `(net …)` token (no-net copper, kept) or a name-only net. */
  netOrdinal: number | null;
  /**
   * Net name resolved from the `(net N "name")` table, or the name-only
   * `(net "name")`. Empty string for the ordinal-0 "no net" entry. `null` when
   * the item has no net token or no table entry covers the ordinal — should be
   * treated the same as no-net.
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
  /** `null` with no `(net …)` token (no-net copper, kept) or a name-only net. */
  netOrdinal: number | null;
  /** Net name resolved from the `(net N "name")` table; null when missing. */
  netName: string | null;
  type: "through" | "blind" | "micro";
}

/**
 * Board setup values the importer maps (H14 §3.9). Every field is `null` when
 * the file does not carry the token — no KiCad default is invented here.
 */
export interface ParsedKicadPcbSetup {
  padToMaskClearanceMm: number | null;
  padToPasteClearanceMm: number | null;
  padToPasteClearanceRatio: number | null;
  solderMaskMinWidthMm: number | null;
  allowSoldermaskBridgesInFootprints: boolean | null;
  /**
   * Newer KiCad `(tenting front back)` (atoms, or `(front yes)` children —
   * spelling to verify against KiCad 9 source). `null` when absent.
   */
  tenting: { front: boolean; back: boolean } | null;
  /** `pcbplotparams.viasonmask` — `false` means vias are tented. */
  viasOnMask: boolean | null;
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
  const generatorVersion = getStringValue(
    findNode(expr, "generator_version") ?? [],
    1,
  );

  const layers = parseLayers(expr, warnings);
  // By NAME: a `mixed` / `jumper` inner layer is still copper (H14 §3.9).
  const copperLayerNames = layers
    .map((l) => l.canonicalName)
    .filter((name) => KICAD_COPPER_LAYER_NAME.test(name));
  const copperLayerCount = copperLayerNames.length;

  const { nets, netByOrdinal } = parseNetTable(expr);

  const footprints = findNodes(expr, "footprint")
    .map((node, index) => parseFootprint(node, index, netByOrdinal, warnings))
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
    generatorVersion,
    copperLayerCount,
    layers,
    nets,
    footprints,
    segments,
    vias,
    graphics: parseBoardGraphics(expr),
    edgeCuts: parseEdgeCutPrimitives(expr),
    setup: parseSetup(expr),
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

function parseSegment(
  node: SExpr[],
  netByOrdinal: ReadonlyMap<number, string>,
): ParsedKicadPcbSegment | null {
  const start = readPointTagged(findNode(node, "start"));
  const end = readPointTagged(findNode(node, "end"));
  if (!start || !end) return null;
  const widthMm = getNumberValue(findNode(node, "width") ?? [], 1);
  const layer = getStringValue(findNode(node, "layer") ?? [], 1);
  if (widthMm === null || !layer) return null;
  // A segment without a net token is no-net copper and is kept (H14 §3.10.2).
  return { start, end, widthMm, layer, ...readNetRef(node, netByOrdinal) };
}

function parseVia(
  node: SExpr[],
  netByOrdinal: ReadonlyMap<number, string>,
): ParsedKicadPcbVia | null {
  const at = readPointTagged(findNode(node, "at"));
  if (!at) return null;
  const sizeMm = getNumberValue(findNode(node, "size") ?? [], 1);
  const drillMm = getNumberValue(findNode(node, "drill") ?? [], 1);
  if (sizeMm === null || drillMm === null) return null;
  const layerNode = findNode(node, "layers");
  const layerNames: string[] = layerNode
    ? (layerNode.slice(1).filter((l) => typeof l === "string") as string[])
    : [];
  if (layerNames.length < 2) return null;
  // KiCad board file format: `(via [blind | micro] (at …) (size …) (drill …)
  // (layers …) …)` — the type is a BARE ATOM right after `via`, not a sub-list
  // (dev-docs.kicad.org/en/file-formats/sexpr-pcb, "Via"). `findNode` matches
  // only LIST children, so it never matched and every imported via came back
  // `through`. There are only these two tokens: a BURIED via is written with
  // the `blind` token, and the span tells the two apart (contract 10 §5.3).
  const atoms = node.filter(
    (child): child is string => typeof child === "string",
  );
  const type: "through" | "blind" | "micro" = atoms.includes("micro")
    ? "micro"
    : atoms.includes("blind")
      ? "blind"
      : "through";
  return {
    at,
    sizeMm,
    drillMm,
    layers: [layerNames[0]!, layerNames[1]!],
    ...readNetRef(node, netByOrdinal),
    type,
  };
}

/**
 * The board net table: `(net N "name")`, plus the tolerated name-only
 * `(net "name")` (ordinal `null`). Only ordinal entries feed the lookup that
 * resolves `(net N)` item references.
 */
function parseNetTable(expr: SExpr[]): {
  nets: ParsedKicadPcbNet[];
  netByOrdinal: Map<number, string>;
} {
  const nets: ParsedKicadPcbNet[] = [];
  const netByOrdinal = new Map<number, string>();
  for (const node of findNodes(expr, "net")) {
    if (typeof node[1] === "string") {
      nets.push({ ordinal: null, name: node[1] });
      continue;
    }
    const ordinal = getNumberValue(node, 1);
    if (ordinal === null) continue;
    const resolvedName = getStringValue(node, 2) ?? "";
    nets.push({ ordinal, name: resolvedName });
    netByOrdinal.set(ordinal, resolvedName);
  }
  return { nets, netByOrdinal };
}

/**
 * Tessellate a KiCad `(arc (start) (mid) (end) ...)` track token into chord
 * segments (up to 16 per 90° of sweep, see `tessellateArcChords`). Width /
 * layer / net are preserved on each chord and `originatedFromArc: true` is
 * flagged for the commit pipeline. A collinear arc is one straight chord; a
 * missing point / width / layer yields no segment.
 */
function parseArcAsSegments(
  node: SExpr[],
  netByOrdinal: ReadonlyMap<number, string>,
): ParsedKicadPcbSegment[] {
  const start = readPointTagged(findNode(node, "start"));
  const mid = readPointTagged(findNode(node, "mid"));
  const end = readPointTagged(findNode(node, "end"));
  if (!start || !mid || !end) return [];
  const widthMm = getNumberValue(findNode(node, "width") ?? [], 1);
  const layer = getStringValue(findNode(node, "layer") ?? [], 1);
  if (widthMm === null || !layer) return [];
  const net = readNetRef(node, netByOrdinal);
  const points = tessellateArcChords(start, mid, end, 16);
  const out: ParsedKicadPcbSegment[] = [];
  for (let i = 1; i < points.length; i += 1) {
    out.push({
      start: points[i - 1]!,
      end: points[i]!,
      widthMm,
      layer,
      ...net,
      originatedFromArc: true,
    });
  }
  return out;
}

/** `(setup …)` mask / paste / tenting values and `pcbplotparams.viasonmask`. */
function parseSetup(expr: SExpr[]): ParsedKicadPcbSetup {
  const setup = findNode(expr, "setup");
  const tentingNode = setup ? findNode(setup, "tenting") : null;
  const tented = (side: "front" | "back"): boolean =>
    (tentingNode ?? []).includes(side) ||
    readYesNoToken(tentingNode, side) === true;
  return {
    padToMaskClearanceMm: readNumberToken(setup, "pad_to_mask_clearance"),
    padToPasteClearanceMm: readNumberToken(setup, "pad_to_paste_clearance"),
    padToPasteClearanceRatio: readNumberToken(
      setup,
      "pad_to_paste_clearance_ratio",
    ),
    solderMaskMinWidthMm: readNumberToken(setup, "solder_mask_min_width"),
    allowSoldermaskBridgesInFootprints: readYesNoToken(
      setup,
      "allow_soldermask_bridges_in_footprints",
    ),
    tenting: tentingNode
      ? { front: tented("front"), back: tented("back") }
      : null,
    viasOnMask: readYesNoToken(
      setup ? findNode(setup, "pcbplotparams") : null,
      "viasonmask",
    ),
  };
}
