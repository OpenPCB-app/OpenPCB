/**
 * Thin shim around `@openpcb/kicad-import`.
 *
 * Translates the package's `KicadImportValidationError` (extends Error) and the
 * parsers' plain `Error`s into OpenPCB's `ImportValidationError` (extends
 * `ValidationError extends AppError`) so the HTTP error middleware maps them
 * to a 400 problem-details response.
 */
import {
  parseImportBundle as packageParseImportBundle,
  buildInspectResponse as packageBuildInspectResponse,
  KicadImportValidationError,
  type NormalizedImportedSymbol as PackageNormalizedImportedSymbol,
  type NormalizedImportedFootprint as PackageNormalizedImportedFootprint,
  type ParsedImportBundle as PackageParsedImportBundle,
} from "@openpcb/kicad-import";
import { ValidationError } from "../../../../core/contracts/errors";
import type { InspectKicadRequest, InspectKicadResponse } from "./types";

export class ImportValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * The KiCad parsers under the package reject malformed user files with a
 * plain `Error` ("Not a valid KiCad symbol library file", "Unexpected end of
 * input…"). Everything parsed here is the user's file content, so such an error
 * is bad input (400), not a server fault (500). Error subclasses (TypeError,
 * RangeError, …) are programming faults and still surface as 500.
 */
function translatePackageError(error: unknown): never {
  if (
    error instanceof KicadImportValidationError ||
    (error instanceof Error && error.constructor === Error)
  ) {
    throw new ImportValidationError(error.message);
  }
  throw error;
}

export function parseImportBundle(
  input: InspectKicadRequest,
): PackageParsedImportBundle {
  try {
    return packageParseImportBundle(input);
  } catch (error) {
    translatePackageError(error);
  }
}

export function buildInspectResponse(
  input: InspectKicadRequest,
): InspectKicadResponse {
  try {
    return packageBuildInspectResponse(input);
  } catch (error) {
    translatePackageError(error);
  }
}

export type NormalizedImportedSymbol = PackageNormalizedImportedSymbol;
export type NormalizedImportedFootprint = PackageNormalizedImportedFootprint;
export type ParsedImportBundle = PackageParsedImportBundle;
