/**
 * KiCad Schematic File Parser (.kicad_sch)
 *
 * Reference: https://dev-docs.kicad.org/en/file-formats/sexpr-schematic/index.html
 *
 * Extracts the minimum set of entities OpenPCB's designer module consumes:
 *   - symbol instances (lib_id, refdes, value, at, rotation, unit, uuid)
 *   - wires (point chain)
 *   - junctions
 *   - labels + global labels
 *   - power symbols (refdes prefix #PWR / lib_id `power:*`)
 *   - hierarchical sheet references (flagged for v1 flatten)
 *   - no_connect markers
 *
 * Unsupported / ignored: bus, bus_entry, polyline graphics, text boxes,
 * symbol body re-definitions (lib_symbols is preserved raw for the
 * library-ingestion step but not parsed here).
 *
 * All coordinates are kept in KiCad's native mm units. Rotation is degrees
 * (0/90/180/270). Sub-tokens that fail to validate emit warnings rather
 * than throw — partial schematics still load.
 */

import {
  type SExpr,
  findNode,
  findNodes,
  getNumberValue,
  getStringValue,
  parseSexpr,
} from "./sexpr-parser";

export interface ParsedKicadSchematic {
  version: number | null;
  generator: string | null;
  symbols: ParsedKicadSchSymbol[];
  wires: ParsedKicadSchWire[];
  junctions: ParsedKicadSchJunction[];
  labels: ParsedKicadSchLabel[];
  globalLabels: ParsedKicadSchLabel[];
  /**
   * `(hierarchical_label "NAME" (shape ...) (at X Y rot) ...)` — these stitch
   * sub-sheet nets to the parent sheet's `(sheet (pin "NAME" ...))` entries
   * by string equality on NAME (per KiCad spec). For OpenPCB's flat designer
   * model we treat them like local labels for connectivity purposes.
   */
  hierarchicalLabels: ParsedKicadSchLabel[];
  powerSymbols: ParsedKicadSchPowerSymbol[];
  hierarchicalSheets: ParsedKicadSchSheet[];
  noConnects: ParsedKicadSchPoint[];
  /** Raw `(lib_symbols ...)` block, for library-ingestion phase. */
  libSymbolsRaw: SExpr | null;
  warnings: ParsedKicadProjectWarning[];
}

export interface ParsedKicadSchSymbol {
  uuid: string | null;
  libId: string;
  reference: string;
  value: string | null;
  unit: number;
  at: ParsedKicadSchPoint;
  rotationDeg: number;
  /** True when refdes starts with `#PWR` (KiCad power symbol convention). */
  isPower: boolean;
  /** Raw properties (Reference, Value, Footprint, Datasheet, custom). */
  properties: Record<string, string>;
}

export interface ParsedKicadSchPowerSymbol {
  uuid: string | null;
  reference: string;
  /** Net name carried in the Value property (GND, +3V3, …). */
  netName: string;
  at: ParsedKicadSchPoint;
  rotationDeg: number;
}

export interface ParsedKicadSchWire {
  uuid: string | null;
  points: ParsedKicadSchPoint[];
  /** True when at least one segment is not strictly horizontal or vertical. */
  hasDiagonal: boolean;
}

export interface ParsedKicadSchJunction {
  uuid: string | null;
  at: ParsedKicadSchPoint;
}

export interface ParsedKicadSchLabel {
  uuid: string | null;
  text: string;
  at: ParsedKicadSchPoint;
  rotationDeg: number;
  /** input|output|bidirectional|tri_state|passive (global labels only). */
  shape: string | null;
}

export interface ParsedKicadSchSheet {
  uuid: string | null;
  sheetName: string;
  sheetFile: string;
  at: ParsedKicadSchPoint;
  size: { widthMm: number; heightMm: number };
  pins: ParsedKicadSchSheetPin[];
}

export interface ParsedKicadSchSheetPin {
  name: string;
  electricalType: string;
  at: ParsedKicadSchPoint;
  rotationDeg: number;
}

export interface ParsedKicadSchPoint {
  xMm: number;
  yMm: number;
}

export interface ParsedKicadProjectWarning {
  code: string;
  message: string;
}

export function parseKicadSchematic(source: string): ParsedKicadSchematic {
  const warnings: ParsedKicadProjectWarning[] = [];
  let expr: SExpr;
  try {
    expr = parseSexpr(source);
  } catch (error) {
    throw new Error(
      `Failed to parse .kicad_sch: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(expr) || expr[0] !== "kicad_sch") {
    throw new Error("Not a .kicad_sch file (missing kicad_sch root token)");
  }

  const version = getNumberValue(findNode(expr, "version") ?? [], 1);
  const generator = getStringValue(findNode(expr, "generator") ?? [], 1);
  const libSymbolsRaw = findNode(expr, "lib_symbols");

  const symbols: ParsedKicadSchSymbol[] = [];
  const powerSymbols: ParsedKicadSchPowerSymbol[] = [];
  for (const node of findNodes(expr, "symbol")) {
    const parsed = parseSymbolInstance(node, warnings);
    if (!parsed) continue;
    if (parsed.isPower) {
      powerSymbols.push({
        uuid: parsed.uuid,
        reference: parsed.reference,
        netName: parsed.value ?? parsed.reference.replace(/^#PWR0*/, ""),
        at: parsed.at,
        rotationDeg: parsed.rotationDeg,
      });
    } else {
      symbols.push(parsed);
    }
  }

  const wires = findNodes(expr, "wire")
    .map((node) => parseWire(node, warnings))
    .filter((w): w is ParsedKicadSchWire => w !== null);

  const junctions = findNodes(expr, "junction")
    .map((node) => parseJunction(node))
    .filter((j): j is ParsedKicadSchJunction => j !== null);

  const labels = findNodes(expr, "label")
    .map((node) => parseLabel(node, null))
    .filter((l): l is ParsedKicadSchLabel => l !== null);

  const globalLabels = findNodes(expr, "global_label")
    .map((node) => parseLabel(node, "global"))
    .filter((l): l is ParsedKicadSchLabel => l !== null);

  const hierarchicalLabels = findNodes(expr, "hierarchical_label")
    .map((node) => parseLabel(node, "global"))
    .filter((l): l is ParsedKicadSchLabel => l !== null);

  const noConnects = findNodes(expr, "no_connect")
    .map((node) => readAtPoint(findNode(node, "at")))
    .filter((p): p is ParsedKicadSchPoint => p !== null);

  const hierarchicalSheets = findNodes(expr, "sheet")
    .map((node) => parseSheet(node, warnings))
    .filter((s): s is ParsedKicadSchSheet => s !== null);
  if (hierarchicalSheets.length > 0) {
    warnings.push({
      code: "hierarchical_sheets_flattened",
      message: `Schematic contains ${hierarchicalSheets.length} hierarchical sheet(s); v1 flattens them at commit time.`,
    });
  }

  return {
    version,
    generator,
    symbols,
    wires,
    junctions,
    labels,
    globalLabels,
    hierarchicalLabels,
    powerSymbols,
    hierarchicalSheets,
    noConnects,
    libSymbolsRaw: libSymbolsRaw ?? null,
    warnings,
  };
}

function parseSymbolInstance(
  node: SExpr[],
  warnings: ParsedKicadProjectWarning[],
): ParsedKicadSchSymbol | null {
  const libIdNode = findNode(node, "lib_id");
  const libId = libIdNode ? getStringValue(libIdNode, 1) : null;
  if (!libId) {
    warnings.push({
      code: "symbol_missing_lib_id",
      message: "Symbol instance missing lib_id; skipped.",
    });
    return null;
  }
  const at = readAtPoint(findNode(node, "at"));
  if (!at) {
    warnings.push({
      code: "symbol_missing_at",
      message: `Symbol '${libId}' missing (at ...); skipped.`,
    });
    return null;
  }
  const rotationDeg = readAtRotation(findNode(node, "at"));
  const uuid = getStringValue(findNode(node, "uuid") ?? [], 1);
  const unit = getNumberValue(findNode(node, "unit") ?? [], 1) ?? 1;

  const properties: Record<string, string> = {};
  for (const prop of findNodes(node, "property")) {
    const key = getStringValue(prop, 1);
    const value = getStringValue(prop, 2);
    if (key !== null && value !== null) properties[key] = value;
  }
  const reference = properties["Reference"] ?? "?";
  const value = properties["Value"] ?? null;
  const isPower = reference.startsWith("#PWR") || libId.startsWith("power:");

  return {
    uuid,
    libId,
    reference,
    value,
    unit,
    at,
    rotationDeg,
    isPower,
    properties,
  };
}

function parseWire(
  node: SExpr[],
  warnings: ParsedKicadProjectWarning[],
): ParsedKicadSchWire | null {
  const pts = findNode(node, "pts");
  if (!pts) return null;
  const points: ParsedKicadSchPoint[] = [];
  for (const xy of findNodes(pts, "xy")) {
    const x = getNumberValue(xy, 1);
    const y = getNumberValue(xy, 2);
    if (x === null || y === null) continue;
    points.push({ xMm: x, yMm: y });
  }
  if (points.length < 2) return null;
  let hasDiagonal = false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.xMm !== b.xMm && a.yMm !== b.yMm) {
      hasDiagonal = true;
      break;
    }
  }
  if (hasDiagonal) {
    warnings.push({
      code: "wire_diagonal",
      message:
        "Diagonal wire segment found; OpenPCB will Manhattan-normalize on commit.",
    });
  }
  return {
    uuid: getStringValue(findNode(node, "uuid") ?? [], 1),
    points,
    hasDiagonal,
  };
}

function parseJunction(node: SExpr[]): ParsedKicadSchJunction | null {
  const at = readAtPoint(findNode(node, "at"));
  if (!at) return null;
  return { uuid: getStringValue(findNode(node, "uuid") ?? [], 1), at };
}

function parseLabel(
  node: SExpr[],
  kind: "global" | null,
): ParsedKicadSchLabel | null {
  const text = getStringValue(node, 1);
  if (text === null) return null;
  const at = readAtPoint(findNode(node, "at"));
  if (!at) return null;
  const rotationDeg = readAtRotation(findNode(node, "at"));
  const shape =
    kind === "global"
      ? (getStringValue(findNode(node, "shape") ?? [], 1) ?? null)
      : null;
  return {
    uuid: getStringValue(findNode(node, "uuid") ?? [], 1),
    text,
    at,
    rotationDeg,
    shape,
  };
}

function parseSheet(
  node: SExpr[],
  warnings: ParsedKicadProjectWarning[],
): ParsedKicadSchSheet | null {
  const at = readAtPoint(findNode(node, "at"));
  if (!at) return null;
  const sizeNode = findNode(node, "size");
  const widthMm = sizeNode ? (getNumberValue(sizeNode, 1) ?? 0) : 0;
  const heightMm = sizeNode ? (getNumberValue(sizeNode, 2) ?? 0) : 0;
  const props: Record<string, string> = {};
  for (const prop of findNodes(node, "property")) {
    const key = getStringValue(prop, 1);
    const value = getStringValue(prop, 2);
    if (key !== null && value !== null) props[key] = value;
  }
  const sheetName = props["Sheetname"] ?? props["Sheet name"] ?? "Sheet";
  const sheetFile = props["Sheetfile"] ?? props["Sheet file"] ?? "";
  if (!sheetFile) {
    warnings.push({
      code: "sheet_missing_file",
      message: `Hierarchical sheet '${sheetName}' missing Sheetfile property.`,
    });
  }
  const pins: ParsedKicadSchSheetPin[] = [];
  for (const pinNode of findNodes(node, "pin")) {
    const name = getStringValue(pinNode, 1);
    const electricalType = getStringValue(pinNode, 2);
    const pinAt = readAtPoint(findNode(pinNode, "at"));
    if (!name || !electricalType || !pinAt) continue;
    pins.push({
      name,
      electricalType,
      at: pinAt,
      rotationDeg: readAtRotation(findNode(pinNode, "at")),
    });
  }
  return {
    uuid: getStringValue(findNode(node, "uuid") ?? [], 1),
    sheetName,
    sheetFile,
    at,
    size: { widthMm, heightMm },
    pins,
  };
}

function readAtPoint(node: SExpr[] | null): ParsedKicadSchPoint | null {
  if (!node) return null;
  const x = getNumberValue(node, 1);
  const y = getNumberValue(node, 2);
  if (x === null || y === null) return null;
  return { xMm: x, yMm: y };
}

function readAtRotation(node: SExpr[] | null): number {
  if (!node) return 0;
  return getNumberValue(node, 3) ?? 0;
}
