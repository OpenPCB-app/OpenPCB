/**
 * Shim around `@openpcb/kicad-import` validate-pads helpers. Translates the
 * package's `KicadImportValidationError` into OpenPCB's `ImportValidationError`
 * so HTTP responses keep their 400 problem-details semantics.
 */
import {
  validateFootprintPads as packageValidateFootprintPads,
  validateSymbolPinsCoverFootprintPads as packageValidateSymbolPinsCoverFootprintPads,
  KicadImportValidationError,
  type FootprintWithPads,
  type PadValidationOptions,
  type SymbolPinsLike,
} from "@openpcb/kicad-import";
import type { SymbolRenderSource } from "@openpcb/rendering-core";
import { ImportValidationError } from "./inspect-kicad";

export type { FootprintWithPads, PadValidationOptions, SymbolPinsLike };

function translate(error: unknown): never {
  if (error instanceof KicadImportValidationError) {
    throw new ImportValidationError(error.message);
  }
  throw error;
}

export function validateFootprintPads(
  footprint: FootprintWithPads,
  options: PadValidationOptions = {},
): void {
  try {
    packageValidateFootprintPads(footprint, options);
  } catch (error) {
    translate(error);
  }
}

export function validateSymbolPinsCoverFootprintPads(
  symbol: SymbolPinsLike | SymbolRenderSource,
  footprint: FootprintWithPads,
): void {
  try {
    packageValidateSymbolPinsCoverFootprintPads(symbol, footprint);
  } catch (error) {
    translate(error);
  }
}
