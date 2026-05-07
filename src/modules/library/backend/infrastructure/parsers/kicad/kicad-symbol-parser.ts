/**
 * KiCad Symbol Library Parser (.kicad_sym)
 *
 * Parses KiCad 8 symbol library files into normalized internal format.
 * Preserves raw data for provenance and surfaces unsupported constructs as warnings.
 */

import {
  type SExpr,
  parseSexpr,
  findNode,
  findNodes,
  getStringValue,
  getNumberValue,
  serializeSexpr,
} from "./sexpr-parser";

export interface ParsedKicadSymbol {
  name: string;
  kicadId: string | null;
  pins: ParsedPin[];
  units: number;
  properties: Record<string, string>;
  bodyGraphics: ParsedBodyGraphic[];
  warnings: ParsedWarning[];
  rawSource: string;
  /** Font size (mm) of the symbol's `Reference` property, when present. */
  referenceFontSizeMm?: number;
  /** Font size (mm) of the symbol's `Value` property, when present. */
  valueFontSizeMm?: number;
}

export interface ParsedBodyGraphic {
  unit: number;
  node: SExpr[];
}

export interface ParsedPin {
  name: string;
  number: string;
  electricalType: string;
  direction: string;
  position: { x: number; y: number };
  length: number;
  rotation: number;
  unit: number;
  hidden: boolean;
  /** Font size (mm) for the pin name label, when the source provided one. */
  nameFontSizeMm?: number;
  /** Font size (mm) for the pin number label, when the source provided one. */
  numberFontSizeMm?: number;
}

export interface ParsedWarning {
  code: string;
  message: string;
}

const KNOWN_GRAPHIC_TYPES = new Set([
  "rectangle",
  "polyline",
  "circle",
  "arc",
  "text",
  "bezier",
]);

const KNOWN_PIN_TYPES = new Set([
  "input",
  "output",
  "bidirectional",
  "tri_state",
  "passive",
  "free",
  "unspecified",
  "power_in",
  "power_out",
  "open_collector",
  "open_emitter",
  "no_connect",
]);

/**
 * Read a `(effects (font (size W H)))` block inside `parent`, returning the
 * width value in mm (KiCad uses square text — width and height match). Returns
 * null if the block is absent or malformed; callers should fall back to the
 * KLC default of 1.27 mm.
 */
function readFontSizeMm(parent: SExpr[] | null | undefined): number | null {
  if (!parent) return null;
  const effects = findNode(parent, "effects");
  if (!effects) return null;
  const font = findNode(effects, "font");
  if (!font) return null;
  const size = findNode(font, "size");
  if (!size) return null;
  const width = getNumberValue(size, 1);
  return width !== null && Number.isFinite(width) && width > 0 ? width : null;
}

/**
 * Parse a .kicad_sym file content into an array of symbol definitions.
 */
export function parseKicadSymbolLib(content: string): {
  symbols: ParsedKicadSymbol[];
  version: number | null;
  generator: string | null;
} {
  const tree = parseSexpr(content);
  if (!Array.isArray(tree)) {
    throw new Error("Not a valid KiCad symbol library file");
  }

  if (tree[0] === "symbol") {
    return {
      symbols: [parseSymbol(tree)],
      version: null,
      generator: null,
    };
  }

  if (tree[0] !== "kicad_symbol_lib") {
    throw new Error("Not a valid KiCad symbol library file");
  }

  const versionNode = findNode(tree, "version");
  const generatorNode = findNode(tree, "generator");
  const version = versionNode ? getNumberValue(versionNode) : null;
  const generator = generatorNode ? getStringValue(generatorNode) : null;

  const symbolNodes = findNodes(tree, "symbol");
  const symbols = symbolNodes.map((node) => parseSymbol(node));

  return { symbols, version, generator };
}

function parseSymbol(node: SExpr[]): ParsedKicadSymbol {
  const name = getStringValue(node) ?? "unknown";
  const warnings: ParsedWarning[] = [];

  // Properties
  const properties: Record<string, string> = {};
  let referenceFontSizeMm: number | undefined;
  let valueFontSizeMm: number | undefined;
  const propertyNodes = findNodes(node, "property");
  for (const prop of propertyNodes) {
    const key = getStringValue(prop, 1);
    const value = getStringValue(prop, 2);
    if (key && value !== null) {
      properties[key] = value;
    }
    if (key === "Reference") {
      const fontSize = readFontSizeMm(prop);
      if (fontSize !== null) referenceFontSizeMm = fontSize;
    } else if (key === "Value") {
      const fontSize = readFontSizeMm(prop);
      if (fontSize !== null) valueFontSizeMm = fontSize;
    }
  }

  // Count units and parse pins/graphics from sub-symbols
  const subSymbols = findNodes(node, "symbol");
  const pins: ParsedPin[] = [];
  const bodyGraphics: ParsedBodyGraphic[] = [];
  const unitSet = new Set<number>();

  for (const sub of subSymbols) {
    const subName = getStringValue(sub) ?? "";
    const unitMatch = subName.match(/_(\d+)_(\d+)$/);
    const unit = unitMatch ? parseInt(unitMatch[1]!, 10) : 0;
    unitSet.add(unit);

    // Parse pins
    const pinNodes = findNodes(sub, "pin");
    for (const pin of pinNodes) {
      const parsed = parsePin(pin, unit);
      if (parsed) pins.push(parsed);
    }

    // Parse graphics
    for (const child of sub) {
      if (!Array.isArray(child)) continue;
      const tag = child[0];
      if (typeof tag !== "string") continue;

      if (KNOWN_GRAPHIC_TYPES.has(tag)) {
        bodyGraphics.push({ unit, node: child });
      } else if (tag !== "pin" && tag !== "symbol") {
        // Unknown graphic element
        warnings.push({
          code: "unsupported_construct",
          message: `Unknown graphic element "${tag}" in sub-symbol`,
        });
        bodyGraphics.push({ unit, node: child }); // preserve it
      }
    }
  }

  // Filter out unit 0 (shared graphics) from unit count
  const signalUnits = [...unitSet].filter((u) => u > 0);
  const units = signalUnits.length > 0 ? Math.max(...signalUnits) : 1;

  return {
    name,
    kicadId: null,
    pins,
    units,
    properties,
    bodyGraphics,
    warnings,
    rawSource: serializeSexpr(node),
    referenceFontSizeMm,
    valueFontSizeMm,
  };
}

function parsePin(node: SExpr[], unit: number): ParsedPin | null {
  // (pin TYPE DIRECTION (at X Y ROT) (length L) (name "N" ...) (number "N" ...))
  const electricalType = getStringValue(node, 1) ?? "unspecified";
  const direction = getStringValue(node, 2) ?? "line";

  if (!KNOWN_PIN_TYPES.has(electricalType)) {
    // Still parse it but it might be unusual
  }

  const atNode = findNode(node, "at");
  const lengthNode = findNode(node, "length");
  const nameNode = findNode(node, "name");
  const numberNode = findNode(node, "number");

  if (!atNode || !nameNode || !numberNode) return null;

  const nameFontSizeMm = readFontSizeMm(nameNode) ?? undefined;
  const numberFontSizeMm = readFontSizeMm(numberNode) ?? undefined;

  return {
    name: getStringValue(nameNode) ?? "",
    number: getStringValue(numberNode) ?? "",
    electricalType,
    direction,
    position: {
      x: getNumberValue(atNode, 1) ?? 0,
      y: getNumberValue(atNode, 2) ?? 0,
    },
    length: lengthNode ? (getNumberValue(lengthNode) ?? 0) : 0,
    rotation: getNumberValue(atNode, 3) ?? 0,
    unit,
    hidden: node.includes("hide"),
    nameFontSizeMm,
    numberFontSizeMm,
  };
}
