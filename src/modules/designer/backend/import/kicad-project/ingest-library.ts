/**
 * Ingest project-embedded symbols + footprints into the OpenPCB library.
 *
 * KiCad's `.kicad_sch` embeds full symbol definitions in `(lib_symbols ...)`,
 * and `.kicad_pcb` embeds full footprint definitions inline in each
 * `(footprint ...)` block. We synthesize per-component virtual `.kicad_sym`
 * and `.kicad_mod` payloads from those embedded blocks and feed them through
 * the existing library `commitKicadImport` pipeline.
 *
 * Pairing strategy:
 *   - Schematic symbol instances carry `(lib_id "Lib:Part")` and a Reference
 *     property (refdes). PCB footprint blocks carry `lib_id` (first quoted
 *     arg) and a Reference property. We pair them by refdes.
 *   - Each (symbolLibId, footprintLibId) pair is committed once and cached.
 *   - Subsequent lookups return the cached componentId.
 */

import type { CoreBackendModuleContext } from "../../../../../core/contracts/modules/backend-module";
import { commitKicadImport } from "../../../../library/backend/import/commit-kicad";
import {
  type SExpr,
  findNodes,
  getStringValue,
  parseSexpr,
  serializeSexpr,
} from "../../../../library/backend/infrastructure/parsers/kicad/sexpr-parser";
import { parseImportBundle } from "../../../../library/backend/import/inspect-kicad";
import type { ParsedKicadSchematic } from "../../../../library/backend/infrastructure/parsers/kicad/kicad-schematic-parser";
import type { ParsedKicadPcb } from "../../../../library/backend/infrastructure/parsers/kicad/kicad-pcb-parser";

export interface IngestionLogEntry {
  symbolLibId: string;
  footprintLibId: string;
  componentId: string;
  reused: boolean;
  refdeses: string[];
}

export interface IngestionResult {
  /** componentId keyed by `${symbolLibId}::${footprintLibId}`. */
  componentByPair: Map<string, string>;
  /** componentId keyed by refdes (the practical lookup the schematic insert uses). */
  componentByRefdes: Map<string, string>;
  /** Full ledger of ingestions for the import report. */
  entries: IngestionLogEntry[];
  /** Refdeses that could not be resolved (no symbol or no footprint match). */
  unresolved: Array<{ refdes: string; reason: string }>;
}

export interface IngestionPlanInput {
  schematics: ParsedKicadSchematic[];
  pcb: ParsedKicadPcb;
  /** Raw .kicad_pcb source text — re-parsed once to extract raw footprint blocks. */
  pcbSource: string;
  /** Lookup hook to reuse OpenPCB library components already matching by name. */
  preexistingLookup: (libId: string) => Promise<string | null>;
}

export async function ingestProjectComponents(
  ctx: CoreBackendModuleContext,
  input: IngestionPlanInput,
): Promise<IngestionResult> {
  const result: IngestionResult = {
    componentByPair: new Map(),
    componentByRefdes: new Map(),
    entries: [],
    unresolved: [],
  };

  // Build lookup tables from raw lib_symbols blocks (across all sheets) and
  // from the PCB footprint list. Both are keyed by the KiCad lib_id token.
  const symbolNodeByLibId = collectSymbolNodes(input.schematics);
  const footprintNodeByLibId = buildFootprintRawMap(input.pcbSource);
  const footprintLibIdByRefdes = buildRefdesToFootprintMap(input.pcb);

  // Iterate every schematic symbol instance across all sheets.
  for (const sheet of input.schematics) {
    for (const symbol of sheet.symbols) {
      if (result.componentByRefdes.has(symbol.reference)) {
        continue; // already resolved on a previous sheet
      }
      const footprintLibId = footprintLibIdByRefdes.get(symbol.reference);
      if (!footprintLibId) {
        result.unresolved.push({
          refdes: symbol.reference,
          reason: `No PCB footprint found for refdes '${symbol.reference}'.`,
        });
        continue;
      }
      const pairKey = `${symbol.libId}::${footprintLibId}`;
      const cached = result.componentByPair.get(pairKey);
      if (cached) {
        result.componentByRefdes.set(symbol.reference, cached);
        const entry = result.entries.find(
          (e) =>
            e.symbolLibId === symbol.libId &&
            e.footprintLibId === footprintLibId,
        );
        if (entry && !entry.refdeses.includes(symbol.reference)) {
          entry.refdeses.push(symbol.reference);
        }
        continue;
      }

      // Try existing library match by part name (last hop after split on ":").
      const preexisting = await input.preexistingLookup(symbol.libId);
      if (preexisting) {
        result.componentByPair.set(pairKey, preexisting);
        result.componentByRefdes.set(symbol.reference, preexisting);
        result.entries.push({
          symbolLibId: symbol.libId,
          footprintLibId,
          componentId: preexisting,
          reused: true,
          refdeses: [symbol.reference],
        });
        continue;
      }

      // Otherwise synthesize + commit.
      const symbolNode = symbolNodeByLibId.get(symbol.libId);
      const footprintNode = footprintNodeByLibId.get(footprintLibId);
      if (!symbolNode) {
        result.unresolved.push({
          refdes: symbol.reference,
          reason: `Schematic lib_symbols missing definition for '${symbol.libId}'.`,
        });
        continue;
      }
      if (!footprintNode) {
        result.unresolved.push({
          refdes: symbol.reference,
          reason: `PCB has no footprint block for lib_id '${footprintLibId}'.`,
        });
        continue;
      }

      try {
        const componentId = ingestSinglePair(ctx, {
          symbolLibId: symbol.libId,
          footprintLibId,
          symbolNode,
          footprintNode,
        });
        result.componentByPair.set(pairKey, componentId);
        result.componentByRefdes.set(symbol.reference, componentId);
        result.entries.push({
          symbolLibId: symbol.libId,
          footprintLibId,
          componentId,
          reused: false,
          refdeses: [symbol.reference],
        });
      } catch (error) {
        result.unresolved.push({
          refdes: symbol.reference,
          reason: `Ingestion failed for ${symbol.libId} / ${footprintLibId}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  return result;
}

function collectSymbolNodes(
  schematics: ParsedKicadSchematic[],
): Map<string, SExpr[]> {
  const out = new Map<string, SExpr[]>();
  for (const sheet of schematics) {
    const raw = sheet.libSymbolsRaw;
    if (!Array.isArray(raw)) continue;
    for (const child of findNodes(raw, "symbol")) {
      const libId = getStringValue(child, 1);
      if (!libId || out.has(libId)) continue;
      out.set(libId, child);
    }
  }
  return out;
}

function buildRefdesToFootprintMap(pcb: ParsedKicadPcb): Map<string, string> {
  const out = new Map<string, string>();
  for (const fp of pcb.footprints) {
    if (!out.has(fp.reference)) out.set(fp.reference, fp.libId);
  }
  return out;
}

interface IngestSinglePairInput {
  symbolLibId: string;
  footprintLibId: string;
  symbolNode: SExpr[];
  footprintNode: SExpr[];
}

function ingestSinglePair(
  ctx: CoreBackendModuleContext,
  input: IngestSinglePairInput,
): string {
  const symbolContent = serializeSexpr(input.symbolNode);
  const footprintContent = serializeSexpr(input.footprintNode);
  const symbolFileName = sanitizeFileName(input.symbolLibId) + ".kicad_sym";
  const footprintFileName =
    sanitizeFileName(input.footprintLibId) + ".kicad_mod";

  // Parse the synthetic bundle to obtain the deterministic IDs that
  // commitKicadImport uses for selection.
  const bundle = parseImportBundle({
    symbolLibrary: { fileName: symbolFileName, content: symbolContent },
    footprints: [{ fileName: footprintFileName, content: footprintContent }],
  });
  const symbol = bundle.normalizedSymbols[0];
  const footprint = bundle.normalizedFootprints[0];
  if (!symbol || !footprint) {
    throw new Error(
      "Synthesized import bundle produced no symbol or footprint",
    );
  }

  const result = commitKicadImport(ctx, {
    symbolLibrary: { fileName: symbolFileName, content: symbolContent },
    footprints: [{ fileName: footprintFileName, content: footprintContent }],
    selection: {
      symbolId: symbol.id,
      footprintId: footprint.id,
    },
    component: {
      name: symbol.name,
      description: `Imported from KiCad project (${input.symbolLibId})`,
      tags: [
        "imported-from-kicad",
        // Per-lib_id marker tag — enables strict library reuse on subsequent
        // imports of the same KiCad project.
        `kicad-lib-id:${input.symbolLibId}`,
        `kicad-footprint-id:${input.footprintLibId}`,
      ],
    },
  });
  return result.componentId;
}

function sanitizeFileName(libId: string): string {
  return libId.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

/**
 * Helper for the inspect step: re-parse the raw .kicad_pcb to extract the raw
 * footprint s-expressions keyed by lib_id. Wired through commit().
 */
export function buildFootprintRawMap(pcbSource: string): Map<string, SExpr[]> {
  const out = new Map<string, SExpr[]>();
  try {
    const tree = parseSexpr(pcbSource);
    if (!Array.isArray(tree)) return out;
    for (const node of findNodes(tree, "footprint")) {
      const libId = typeof node[1] === "string" ? node[1] : null;
      if (libId && !out.has(libId)) {
        out.set(libId, node);
      }
    }
  } catch {
    // Caller already surfaced parser errors; silently return empty.
  }
  return out;
}
