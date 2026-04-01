/**
 * IPC-7351B+C Land Pattern Calculator
 *
 * Standalone module for calculating IPC-compliant SMD land patterns.
 */

export type {
  DensityLevel,
  LeadType,
  FilletGoals,
  FabricationTolerances,
  ComponentDimensions,
  PadCalculationResult,
  CalculatorOutput,
  BgaDimensions,
} from "./types";

export { DEFAULT_FAB_TOLERANCES, DENSITY_SUFFIX } from "./types";

export {
  calculatePadDimensions,
  calculateBgaPadDiameter,
  calculateBgaCourtyard,
  calculateAllDensities,
  selectLeadType,
  roundToGrid,
  GULL_WING_PITCH_THRESHOLD,
} from "./calculator";

export {
  generateIpcName,
  IPC_FAMILY_PREFIXES,
  type IpcFamilyPrefix,
} from "./naming";

export {
  FILLET_GOALS,
  COURTYARD_EXCESS,
  SILKSCREEN_WIDTH,
  FAB_LINE_WIDTH,
  BGA_PAD_RATIOS,
} from "./fillet-tables";
