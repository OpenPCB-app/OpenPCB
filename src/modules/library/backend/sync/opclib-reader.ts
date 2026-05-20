/**
 * Re-export shim around `@openpcb/opclib-pack` reader functions. Preserves the
 * existing import paths used by `bootstrap.ts` and `opclib-importer.ts`.
 */
export {
  OpclibFormatError,
  OpclibValidationError,
  readOpclibFromPath,
  readOpclibFromBytes,
  readAssetJson,
  readAssetBytes,
} from "@openpcb/opclib-pack";
