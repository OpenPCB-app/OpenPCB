/**
 * The KiCad import census (H14 §3.6.1): an independent walk of the RAW
 * s-expression — never the parsers' output — counting SOURCE UNITS. One
 * source token is one unit. Planners later report how many of those units
 * they represent (`plannedUnits`) or drop with a coded warning
 * (`droppedUnits`); `build-plan` reconciles `sourceUnits == planned + dropped`.
 *
 * Board: every top-level child token of `kicad_pcb`, every child token of each
 * `footprint`, every child token of each `pad`, and pads per type.
 * Schematic: every top-level child token of each sheet FILE weighted by how
 * many sheet INSTANCES use it (the instance tree is computed by
 * `sheet-instances.ts`); files no instance uses count once each under
 * `sch.sheet_unreferenced` and never enter the symbol counts.
 *
 * The census also applies the blocker trigger rule to every token OpenPCB
 * cannot represent, so a lost manufacturing input is never silent.
 */

import { type SExpr, parseSexpr, serializeSexpr } from "@openpcb/kicad-parsers";
import type { KicadProjectImportWarning } from "../../../../../../sdks/designer";
import { type KicadImportWarningCode, kicadImportWarning } from "../report";
import {
  FOOTPRINT_CLASSES,
  PAD_CLASSES,
  PCB_CLASSES,
  SCH_CLASSES,
  SETUP_CLASSES,
  type TokenClassTable,
  censusLossClass,
  isEdgeOrManufacturingLayer,
} from "./census-classes";

export { censusLossClass } from "./census-classes";

export type CensusWhere = "pcb" | "sch" | "footprint" | "pad" | "setup";
export type CensusTokenClass = "handled" | "benign" | "unsupported";
export type CensusLossClass = "capability" | "cosmetic" | "info";

export interface CensusRow {
  /** `pcb.segment`, `pcb.footprint.fp_line`, `pcb.pad.solder_mask_margin`, `pcb.pad_type.smd`, `sch.symbol_instance`, … */
  entity: string;
  where: CensusWhere;
  token: string;
  tokenClass: CensusTokenClass;
  sourceUnits: number;
}

/** One source token OpenPCB cannot represent (an `unsupported` token or a modifier). */
export interface CensusFinding {
  where: CensusWhere;
  token: string;
  lossClass: CensusLossClass;
  /** The layers the trigger rule judged (the token's own, else its pad's). */
  layers: string[];
  /** The token's arguments, serialized (`0.102`, `2`, `"F.Cu"` …). */
  value: string;
  /** File-order index among `(footprint …)` tokens; `null` off-footprint. */
  footprintIndex: number | null;
  reference: string | null;
  padNumber: string | null;
  /** Schematic file path for `sch` findings. */
  file: string | null;
  /** Source units this finding stands for (sheet-instance weighted). */
  units: number;
}

export interface KicadSourceCensus {
  /** Sorted by `entity` (code-unit order). */
  rows: CensusRow[];
  /** In source order. */
  findings: CensusFinding[];
  /** `unsupported` tokens aggregated, as `KicadImportPlanSummary.unsupported`. */
  unsupported: Array<{ token: string; count: number; where: CensusWhere }>;
  unreferencedSheets: string[];
}

interface Tally {
  rows: Map<string, CensusRow>;
  findings: CensusFinding[];
}

function newTally(): Tally {
  return { rows: new Map(), findings: [] };
}

function bump(
  tally: Tally,
  entity: string,
  where: CensusWhere,
  token: string,
  tokenClass: CensusTokenClass,
  units: number,
): void {
  const row = tally.rows.get(entity);
  if (row) row.sourceUnits += units;
  else
    tally.rows.set(entity, {
      entity,
      where,
      token,
      tokenClass,
      sourceUnits: units,
    });
}

function classOf(table: TokenClassTable, token: string): CensusTokenClass {
  if (table.handled.has(token)) return "handled";
  if (table.benign.has(token)) return "benign";
  return "unsupported";
}

/** List children only: atoms (lib ids, pad numbers, `locked`) are not tokens. */
function childTokens(node: readonly SExpr[]): SExpr[][] {
  const out: SExpr[][] = [];
  for (const child of node.slice(1)) {
    if (Array.isArray(child) && typeof child[0] === "string") out.push(child);
  }
  return out;
}

function ownLayers(node: readonly SExpr[]): string[] {
  const out: string[] = [];
  for (const child of childTokens(node)) {
    if (child[0] !== "layer" && child[0] !== "layers") continue;
    for (const value of child.slice(1)) {
      if (typeof value === "string" && value !== "knockout") out.push(value);
    }
  }
  return out;
}

function valueOf(node: readonly SExpr[]): string {
  return node.slice(1).map(serializeSexpr).join(" ");
}

function parseRoot(source: string, root: string): SExpr[] {
  const expr = parseSexpr(source);
  if (!Array.isArray(expr) || expr[0] !== root)
    throw new Error(`Not a ${root} file`);
  return expr;
}

interface FindingContext {
  where: CensusWhere;
  footprintIndex: number | null;
  reference: string | null;
  padNumber: string | null;
  file: string | null;
  units: number;
}

function addFinding(
  tally: Tally,
  node: readonly SExpr[],
  ctx: FindingContext,
  fallbackLayers: readonly string[] = [],
): void {
  const token = String(node[0]);
  const own = ownLayers(node);
  const layers = own.length > 0 ? own : [...fallbackLayers];
  tally.findings.push({
    ...ctx,
    token,
    lossClass: censusLossClass(token, layers),
    layers,
    value: valueOf(node),
  });
}

/** Census of one `.kicad_pcb` source. */
export function censusBoard(source: string): KicadSourceCensus {
  const expr = parseRoot(source, "kicad_pcb");
  const tally = newTally();
  let footprintIndex = 0;
  for (const node of childTokens(expr)) {
    const token = String(node[0]);
    const tokenClass = classOf(PCB_CLASSES, token);
    bump(tally, `pcb.${token}`, "pcb", token, tokenClass, 1);
    const base: FindingContext = {
      where: "pcb",
      footprintIndex: null,
      reference: null,
      padNumber: null,
      file: null,
      units: 1,
    };
    if (tokenClass === "unsupported") addFinding(tally, node, base);
    if (token === "setup") censusSetup(tally, node);
    if (token === "footprint") {
      censusFootprint(tally, node, footprintIndex);
      footprintIndex += 1;
    }
  }
  return finish(tally, []);
}

function censusSetup(tally: Tally, setup: readonly SExpr[]): void {
  for (const node of childTokens(setup)) {
    if (classOf(SETUP_CLASSES, String(node[0])) !== "unsupported") continue;
    addFinding(tally, node, {
      where: "setup",
      footprintIndex: null,
      reference: null,
      padNumber: null,
      file: null,
      units: 1,
    });
  }
}

function footprintReference(footprint: readonly SExpr[]): string | null {
  for (const child of childTokens(footprint)) {
    if (child[0] === "property" && child[1] === "Reference")
      return typeof child[2] === "string" ? child[2] : null;
    if (child[0] === "fp_text" && child[1] === "reference")
      return typeof child[2] === "string" ? child[2] : null;
  }
  return null;
}

function censusFootprint(
  tally: Tally,
  footprint: readonly SExpr[],
  footprintIndex: number,
): void {
  const ctx: FindingContext = {
    where: "footprint",
    footprintIndex,
    reference: footprintReference(footprint),
    padNumber: null,
    file: null,
    units: 1,
  };
  for (const node of childTokens(footprint)) {
    const token = String(node[0]);
    const tokenClass = classOf(FOOTPRINT_CLASSES, token);
    bump(tally, `pcb.footprint.${token}`, "footprint", token, tokenClass, 1);
    if (tokenClass === "unsupported") addFinding(tally, node, ctx);
    // `fp_*` drawings are handled on silk / fab / courtyard / Edge.Cuts; on
    // copper, mask or paste the footprint model cannot carry them (net ties,
    // antennas, mask openings) — §3.6.1 lists `fp_*` on `*.Cu` as a modifier.
    else if (
      token.startsWith("fp_") &&
      ownLayers(node).some(
        (l) => isEdgeOrManufacturingLayer(l) && l !== "Edge.Cuts",
      )
    )
      addFinding(tally, node, ctx);
    if (token === "pad") censusPad(tally, node, ctx);
  }
}

function censusPad(
  tally: Tally,
  pad: readonly SExpr[],
  footprintCtx: FindingContext,
): void {
  const padType = typeof pad[2] === "string" ? pad[2] : "unknown";
  bump(tally, `pcb.pad_type.${padType}`, "pad", padType, "handled", 1);
  const layers = ownLayers(pad);
  const ctx: FindingContext = {
    ...footprintCtx,
    where: "pad",
    padNumber: typeof pad[1] === "string" ? pad[1] : String(pad[1] ?? ""),
  };
  for (const node of childTokens(pad)) {
    const token = String(node[0]);
    const tokenClass = padTokenClass(node);
    bump(tally, `pcb.pad.${token}`, "pad", token, tokenClass, 1);
    if (tokenClass === "unsupported") addFinding(tally, node, ctx, layers);
  }
}

/**
 * `(remove_unused_layers no)` is exactly what OpenPCB produces (every layer of
 * the stack keeps its ring), so only `yes` is a loss.
 */
function padTokenClass(node: readonly SExpr[]): CensusTokenClass {
  const token = String(node[0]);
  if (token === "remove_unused_layers")
    return node[1] === "no" || node[1] === "false" ? "handled" : "unsupported";
  return classOf(PAD_CLASSES, token);
}

export interface CensusSchematicInput {
  /** Every sheet file of the project, keyed by archive-relative path. */
  sheets: ReadonlyArray<{ path: string; source: string }>;
  /** Instances per sheet path, from the sheet-instance tree. */
  instanceCounts: ReadonlyMap<string, number>;
}

/** Census of a project's schematic files, weighted by sheet instances. */
export function censusSchematic(
  input: CensusSchematicInput,
): KicadSourceCensus {
  const tally = newTally();
  const unreferenced: string[] = [];
  const sheets = [...input.sheets].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  for (const sheet of sheets) {
    const units = input.instanceCounts.get(sheet.path) ?? 0;
    if (units <= 0) {
      unreferenced.push(sheet.path);
      bump(tally, "sch.sheet_unreferenced", "sch", "sheet", "unsupported", 1);
      continue;
    }
    const expr = parseRoot(sheet.source, "kicad_sch");
    for (const node of childTokens(expr)) {
      const token = String(node[0]);
      const tokenClass = classOf(SCH_CLASSES, token);
      const entity =
        token === "symbol" ? "sch.symbol_instance" : `sch.${token}`;
      bump(tally, entity, "sch", token, tokenClass, units);
      if (tokenClass !== "unsupported") continue;
      addFinding(tally, node, {
        where: "sch",
        footprintIndex: null,
        reference: null,
        padNumber: null,
        file: sheet.path,
        units,
      });
    }
  }
  return finish(tally, unreferenced);
}

function finish(tally: Tally, unreferenced: string[]): KicadSourceCensus {
  const rows = [...tally.rows.values()].sort((a, b) =>
    a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : 0,
  );
  return {
    rows,
    findings: tally.findings,
    unsupported: aggregateUnsupported(tally.findings),
    unreferencedSheets: unreferenced,
  };
}

function aggregateUnsupported(
  findings: readonly CensusFinding[],
): KicadSourceCensus["unsupported"] {
  const byKey = new Map<string, KicadSourceCensus["unsupported"][number]>();
  for (const f of findings) {
    const key = `${f.where}\u0000${f.token}`;
    const entry = byKey.get(key);
    if (entry) entry.count += f.units;
    else byKey.set(key, { token: f.token, count: f.units, where: f.where });
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => entry);
}

/** Board census + schematic census as one report (rows re-sorted). */
export function mergeCensus(
  ...parts: readonly KicadSourceCensus[]
): KicadSourceCensus {
  const tally = newTally();
  for (const part of parts) {
    for (const row of part.rows)
      bump(
        tally,
        row.entity,
        row.where,
        row.token,
        row.tokenClass,
        row.sourceUnits,
      );
    tally.findings.push(...part.findings);
  }
  return finish(
    tally,
    parts.flatMap((p) => p.unreferencedSheets),
  );
}

export interface CensusWarningOptions {
  /** Plan-local placement key of the footprint with this file-order index. */
  placementKey(footprintIndex: number): string;
  /**
   * §3.6.1: a modifier whose value equals what OpenPCB will produce raises
   * nothing (e.g. a pad mask margin equal to the imported board expansion).
   * Needs the rules plan, so the caller decides. Default: nothing is.
   */
  representable?(finding: CensusFinding): boolean;
}

const FOOTPRINT_CODE: Record<CensusLossClass, KicadImportWarningCode> = {
  capability: "footprint_manufacturing_token_unsupported",
  cosmetic: "footprint_cosmetic_token_unsupported",
  info: "footprint_token_ignored",
};

const SOURCE_CODE: Record<CensusLossClass, KicadImportWarningCode> = {
  capability: "source_construct_unsupported",
  cosmetic: "source_construct_unsupported_cosmetic",
  info: "source_construct_ignored",
};

const LOSS_ORDER: readonly CensusLossClass[] = [
  "capability",
  "cosmetic",
  "info",
];

/**
 * Catalog warnings for the census findings: one per (footprint, loss class)
 * with the placement as subject, one per loss class for board / setup /
 * schematic tokens, and `sheet_unreferenced`. Deterministic order.
 */
export function censusWarnings(
  census: KicadSourceCensus,
  options: CensusWarningOptions,
): KicadProjectImportWarning[] {
  const kept = census.findings.filter(
    (f) => !(options.representable?.(f) ?? false),
  );
  const byFootprint = new Map<number, CensusFinding[]>();
  const loose: CensusFinding[] = [];
  for (const f of kept) {
    if (f.footprintIndex === null) loose.push(f);
    else
      byFootprint.set(f.footprintIndex, [
        ...(byFootprint.get(f.footprintIndex) ?? []),
        f,
      ]);
  }
  const out: KicadProjectImportWarning[] = [];
  for (const index of [...byFootprint.keys()].sort((a, b) => a - b)) {
    const findings = byFootprint.get(index)!;
    for (const lossClass of LOSS_ORDER) {
      const group = findings.filter((f) => f.lossClass === lossClass);
      if (group.length === 0) continue;
      const reference = group[0]!.reference;
      out.push(
        kicadImportWarning(FOOTPRINT_CODE[lossClass], {
          subjectKeys: [options.placementKey(index)],
          details: {
            ...(reference ? { items: [reference] } : {}),
            tokens: unique(group.map((f) => f.token)),
            values: group.map(describeFinding),
          },
        }),
      );
    }
  }
  for (const lossClass of LOSS_ORDER) {
    const group = loose.filter((f) => f.lossClass === lossClass);
    if (group.length === 0) continue;
    out.push(
      kicadImportWarning(SOURCE_CODE[lossClass], {
        details: { tokens: unique(group.map((f) => f.token)) },
      }),
    );
  }
  if (census.unreferencedSheets.length > 0) {
    out.push(
      kicadImportWarning("sheet_unreferenced", {
        details: { items: [...census.unreferencedSheets] },
      }),
    );
  }
  return out;
}

function describeFinding(f: CensusFinding): string {
  const where =
    f.padNumber !== null ? `pad ${f.padNumber || "(unnumbered)"} ` : "";
  return `${where}${f.token} ${f.value}`.trim();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
