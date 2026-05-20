/**
 * Shim around `@openpcb/opclib-pack`'s ZIP extractor. Wraps the package's
 * `OpclibFormatError` (extends Error) as OpenPCB's `ImportValidationError`
 * (extends `ValidationError extends AppError`) so the HTTP error middleware
 * maps malformed-archive failures to 400 problem-details responses.
 */
import {
  extractZipEntries as packageExtractZipEntries,
  decodeTextEntry as packageDecodeTextEntry,
  OpclibFormatError,
  ZIP_LIMITS,
  type ZipEntryContent,
} from "@openpcb/opclib-pack";
import { ImportValidationError } from "../inspect-kicad";

export { ZIP_LIMITS, type ZipEntryContent };

function translate(error: unknown): never {
  if (error instanceof OpclibFormatError) {
    throw new ImportValidationError(error.message);
  }
  throw error;
}

export function extractZipEntries(input: Uint8Array): ZipEntryContent[] {
  try {
    return packageExtractZipEntries(input);
  } catch (error) {
    translate(error);
  }
}

export function decodeTextEntry(entry: ZipEntryContent): string {
  try {
    return packageDecodeTextEntry(entry);
  } catch (error) {
    translate(error);
  }
}
