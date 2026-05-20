/**
 * Thin shim around `@openpcb/kicad-import`.
 *
 * Translates the package's `KicadImportValidationError` (extends Error) into
 * OpenPCB's `ImportValidationError` (extends `ValidationError extends AppError`)
 * so the HTTP error middleware maps it to a 400 problem-details response.
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

function translatePackageError(error: unknown): never {
  if (error instanceof KicadImportValidationError) {
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
