export type { DensityLevel, SolderFilletAdditions } from "./ipc-dimensions";
export type {
  PackageFamily,
  PresetSize,
  PackageFamilyDef,
} from "./family-presets";
export { ALL_FAMILIES, getFamilyById } from "./family-presets";
export type {
  GeneratedFootprintResult,
  GeneratedFootprintMetadata,
} from "./generate-footprint";
export { generateFootprint } from "./generate-footprint";
