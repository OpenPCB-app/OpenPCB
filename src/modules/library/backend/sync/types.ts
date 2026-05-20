/**
 * Re-exports the `.opclib` manifest types from `@openpcb/opclib-pack` so
 * existing import paths under this module (`./types`) keep resolving.
 */
export type {
  OpclibManifest,
  OpclibLibraryHeader,
  OpclibAssetEntry,
  OpclibFootprintEntry,
  OpclibModel3dEntry,
  OpclibComponentEntry,
  OpclibPackage,
  ImportCounts,
  ImportResult,
  InstallOrigin,
} from "@openpcb/opclib-pack";
