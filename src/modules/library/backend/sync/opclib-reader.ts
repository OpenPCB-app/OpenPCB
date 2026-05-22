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
  verifyManifest,
  type OpclibSignature,
  type TrustedKeyResolver,
  type VerifyManifestResult,
} from "@openpcb/opclib-pack";
