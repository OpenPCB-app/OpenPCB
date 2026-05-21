/**
 * Flatten multiple .kicad_sch sheets into a single sheet-shaped array suitable
 * for the schematic inserter.
 *
 * v1 strategy:
 *   - The root sheet stays unchanged.
 *   - Sub-sheets keep all their entities, but any refdes that collides with a
 *     refdes on an earlier sheet is suffixed with `_S{N}` where N is the
 *     1-based sub-sheet index. The PCB inserter resolves footprints by the
 *     original refdes (KiCad embeds the original Reference property on the
 *     footprint in `.kicad_pcb`), so the suffix only affects schematic-side
 *     uniqueness without breaking PCB→schematic part correlation.
 *   - Hierarchical labels on sub-sheets and their parent's `(sheet (pin ...))`
 *     tokens share the same NET name string (per KiCad spec), so cross-sheet
 *     net continuity falls out of the existing label-based net extractor
 *     without additional rewriting.
 *
 * Returns the same array shape the inserter consumes (one entry per sheet).
 */

import type { ParsedKicadSchematic } from "../../../../library/backend/infrastructure/parsers/kicad/kicad-schematic-parser";
import type { KicadProjectImportWarning } from "../../../../../sdks/designer";

export interface FlattenResult {
  sheets: ParsedKicadSchematic[];
  /** Map of (sheetIdx, originalRefdes) → newRefdes after dedup. */
  refdesRewrites: Map<string, string>;
  warnings: KicadProjectImportWarning[];
}

export function flattenSheets(
  schematics: ParsedKicadSchematic[],
): FlattenResult {
  const warnings: KicadProjectImportWarning[] = [];
  const refdesRewrites = new Map<string, string>();
  const seenRefdes = new Set<string>();
  const out: ParsedKicadSchematic[] = [];

  for (let sheetIdx = 0; sheetIdx < schematics.length; sheetIdx += 1) {
    const sheet = schematics[sheetIdx]!;
    if (sheetIdx === 0) {
      // Root sheet — index existing refdeses; no rewrite needed.
      for (const sym of sheet.symbols) seenRefdes.add(sym.reference);
      out.push(sheet);
      continue;
    }
    let hasCollision = false;
    const renamedSymbols = sheet.symbols.map((sym) => {
      if (!seenRefdes.has(sym.reference)) {
        seenRefdes.add(sym.reference);
        return sym;
      }
      hasCollision = true;
      const newRef = `${sym.reference}_S${sheetIdx}`;
      refdesRewrites.set(`${sheetIdx}:${sym.reference}`, newRef);
      seenRefdes.add(newRef);
      return { ...sym, reference: newRef };
    });
    if (hasCollision) {
      warnings.push({
        code: "refdes_collision_renamed",
        severity: "info",
        message: `Renamed ${refdesRewrites.size} refdes(es) on sub-sheet ${sheetIdx} (collisions during hierarchical flatten).`,
      });
    }
    out.push({ ...sheet, symbols: renamedSymbols });
  }

  return { sheets: out, refdesRewrites, warnings };
}
