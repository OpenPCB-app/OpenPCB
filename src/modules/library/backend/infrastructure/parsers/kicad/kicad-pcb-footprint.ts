/**
 * Placed `(footprint …)` blocks of a `.kicad_pcb`: identity (lib id, refdes,
 * `uuid`, schematic `path`), placement, `attr` flags, pads and footprint
 * graphics. Pad and text `(at x y θ)` angles are copied verbatim — in a board
 * file they already include the footprint angle (H14 §3.5 b), so de-rotating
 * them is the planner's job.
 */

import {
  type SExpr,
  findNode,
  findNodes,
  getNumberValue,
  getStringValue,
} from "@openpcb/kicad-parsers";
import {
  readAtRotation,
  readLockedFlag,
  readNetRef,
  readPointTagged,
  readUuid,
} from "./kicad-pcb-common";
import { parseFootprintGraphics } from "./kicad-pcb-graphics";
import type {
  ParsedKicadPcbFootprint,
  ParsedKicadPcbFootprintAttr,
  ParsedKicadPcbPad,
} from "./kicad-pcb-parser";
import type { ParsedKicadProjectWarning } from "./kicad-project-parser";

/**
 * `sourceIndex` is the footprint's ordinal among ALL `(footprint …)` tokens
 * in file order, including ones this parser skips, so the census and the
 * Edge.Cuts primitives can name the same footprint.
 */
export function parseFootprint(
  node: SExpr[],
  sourceIndex: number,
  netByOrdinal: ReadonlyMap<number, string>,
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
  const at = readPointTagged(findNode(node, "at"));
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
    .map((p) => parsePad(p, netByOrdinal))
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
    sourceIndex,
    uuid: readUuid(node),
    path: getStringValue(findNode(node, "path") ?? [], 1),
    sheetName: getStringValue(findNode(node, "sheetname") ?? [], 1),
    sheetFile: getStringValue(findNode(node, "sheetfile") ?? [], 1),
    attr: readFootprintAttr(node),
    locked: readLockedFlag(node),
    graphics: parseFootprintGraphics(node),
  };
}

/**
 * `(attr smd|through_hole [board_only] [exclude_from_pos_files]
 * [exclude_from_bom] [allow_missing_courtyard] [dnp] …)`. Absent → no type,
 * no flags (KiCad's "unspecified").
 */
function readFootprintAttr(node: SExpr[]): ParsedKicadPcbFootprintAttr {
  const atoms = (findNode(node, "attr") ?? [])
    .slice(1)
    .filter((a): a is string => typeof a === "string");
  const type = atoms.includes("smd")
    ? "smd"
    : atoms.includes("through_hole")
      ? "through_hole"
      : null;
  return {
    type,
    boardOnly: atoms.includes("board_only"),
    excludeFromPosFiles: atoms.includes("exclude_from_pos_files"),
    excludeFromBom: atoms.includes("exclude_from_bom"),
    dnp: atoms.includes("dnp"),
    flags: atoms.filter((a) => a !== "smd" && a !== "through_hole"),
  };
}

function parsePad(
  node: SExpr[],
  netByOrdinal: ReadonlyMap<number, string>,
): ParsedKicadPcbPad | null {
  const number = typeof node[1] === "string" ? node[1] : String(node[1] ?? "");
  const padType = typeof node[2] === "string" ? node[2] : "";
  const shape = typeof node[3] === "string" ? node[3] : "";
  const at = readPointTagged(findNode(node, "at"));
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
  const { netOrdinal, netName } = readNetRef(node, netByOrdinal);
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
    netName,
    pinFunction: getStringValue(findNode(node, "pinfunction") ?? [], 1),
    pinType: getStringValue(findNode(node, "pintype") ?? [], 1),
    uuid: readUuid(node),
  };
}
