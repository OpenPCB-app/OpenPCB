// Strict validation shared by drawn / generated / KiCad commit paths.
// A footprint must have at least one pad, every pad must have a non-empty
// number, and pin numbers from the paired symbol must be a subset of pad
// numbers (so net-pad correlation never silently fails on the PCB tab).

import type {
  FootprintRenderSourcePad,
  SymbolRenderSource,
} from "../../../../shared/rendering/types";
import { ImportValidationError } from "./inspect-kicad";

/** Structural minimum for a symbol describing only the pins we care about
 * for pad coverage. Both `SymbolRenderSource` and `NormalizedImportedSymbol`
 * satisfy this. */
export interface SymbolPinsLike {
  readonly name: string;
  readonly pins: ReadonlyArray<{
    readonly id?: string;
    readonly originPinKey?: string;
    readonly number: string | null | undefined;
  }>;
}

/** Structural minimum — both FootprintRenderSource and FootprintRenderModel
 * satisfy this. Avoids forcing callers to convert between the two. */
export interface FootprintWithPads {
  readonly name: string;
  readonly pads: readonly FootprintRenderSourcePad[];
}

export interface PadValidationOptions {
  /** When true (default), reject footprints with zero pads. Set false only
   * for the explicit "no footprint yet" placeholder path. */
  requirePads?: boolean;
}

export function validateFootprintPads(
  footprint: FootprintWithPads,
  options: PadValidationOptions = {},
): void {
  const requirePads = options.requirePads ?? true;
  const pads = footprint.pads;

  if (requirePads && pads.length === 0) {
    throw new ImportValidationError(
      `Footprint "${footprint.name}" has no pads. Add at least one pad before committing.`,
    );
  }

  const empties: number[] = [];
  pads.forEach((pad: FootprintRenderSourcePad, index: number) => {
    if ((pad.number ?? "").trim().length === 0) {
      empties.push(index);
    }
  });
  if (empties.length > 0) {
    throw new ImportValidationError(
      `Footprint "${footprint.name}" has ${empties.length} pad(s) with empty number (indices: ${empties.join(", ")}). Every pad must have a non-empty number.`,
    );
  }
}

export function validateSymbolPinsCoverFootprintPads(
  symbol: SymbolPinsLike | SymbolRenderSource,
  footprint: FootprintWithPads,
): void {
  const padNumbers = new Set(
    footprint.pads.map((p) => (p.number ?? "").trim()),
  );
  const missing: string[] = [];
  const sym = symbol as SymbolPinsLike;
  for (const pin of sym.pins) {
    const num = (pin.number ?? "").trim();
    if (num.length === 0) {
      const ident = pin.id ?? pin.originPinKey ?? "(unknown)";
      throw new ImportValidationError(
        `Symbol "${sym.name}" has a pin with no number (id ${ident}). Every pin must have a number to bind to a footprint pad.`,
      );
    }
    if (!padNumbers.has(num)) {
      missing.push(num);
    }
  }
  if (missing.length > 0) {
    throw new ImportValidationError(
      `Symbol "${sym.name}" has pin numbers not present in footprint "${footprint.name}": [${missing.join(", ")}]. Available pad numbers: [${[...padNumbers].join(", ")}].`,
    );
  }
}
