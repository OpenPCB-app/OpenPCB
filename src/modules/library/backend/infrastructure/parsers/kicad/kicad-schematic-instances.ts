/**
 * KiCad schematic instance data (KiCad 7+ per-project `instances`, KiCad 6
 * root `symbol_instances`), `netclass_flag` directive labels and yes/no
 * flags — the H14 S2 additions to `kicad-schematic-parser.ts`.
 */

import {
  type SExpr,
  findNode,
  findNodes,
  getNumberValue,
  getStringValue,
} from "@openpcb/kicad-parsers";
import type {
  ParsedKicadSchNetclassFlag,
  ParsedKicadSchPoint,
  ParsedKicadSchSymbolInstance,
} from "./kicad-schematic-parser";

function readAt(node: SExpr[] | null): ParsedKicadSchPoint | null {
  if (!node) return null;
  const x = getNumberValue(node, 1);
  const y = getNumberValue(node, 2);
  return x === null || y === null ? null : { xMm: x, yMm: y };
}

export function parseNetclassFlag(
  node: SExpr[],
): ParsedKicadSchNetclassFlag | null {
  const at = readAt(findNode(node, "at"));
  if (!at) return null;
  const properties: Record<string, string> = {};
  for (const prop of findNodes(node, "property")) {
    const key = getStringValue(prop, 1);
    const value = getStringValue(prop, 2);
    if (key !== null && value !== null) properties[key] = value;
  }
  // KiCad 7/8 name the field "Netclass"; "Net Class" is accepted defensively.
  const netclass = properties["Netclass"] ?? properties["Net Class"] ?? "";
  return {
    uuid: getStringValue(findNode(node, "uuid") ?? [], 1),
    at,
    rotationDeg: getNumberValue(findNode(node, "at") ?? [], 3) ?? 0,
    netclass: netclass === "" ? null : netclass,
    properties,
  };
}

export type ProjectInstanceRow = ParsedKicadSchSymbolInstance & {
  page: string | null;
};

/** `(instances (project "name" (path "/…" (reference …) (unit …) (page …)) …) …)`. */
export function readProjectInstances(node: SExpr[]): ProjectInstanceRow[] {
  const out: ProjectInstanceRow[] = [];
  for (const project of findNodes(
    findNode(node, "instances") ?? [],
    "project",
  )) {
    out.push(...readInstancePaths(project, getStringValue(project, 1)));
  }
  return out;
}

export function readInstancePaths(
  parent: SExpr[],
  project: string | null,
): ProjectInstanceRow[] {
  return findNodes(parent, "path")
    .map((path) => ({
      project,
      path: getStringValue(path, 1) ?? "",
      reference: getStringValue(findNode(path, "reference") ?? [], 1),
      unit: getNumberValue(findNode(path, "unit") ?? [], 1),
      page: getStringValue(findNode(path, "page") ?? [], 1),
    }))
    .filter((row) => row.path !== "");
}

/** `(tag yes|no)`; absent → `null`. */
export function readYesNo(node: SExpr[], tag: string): boolean | null {
  const found = findNode(node, tag);
  if (!found) return null;
  const value = getStringValue(found, 1);
  return value === null || value === "yes" || value === "true";
}
