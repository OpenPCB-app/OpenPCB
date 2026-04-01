/**
 * IPC-7351B+C Land Pattern Calculator Types
 *
 * Type definitions for the IPC-7351 calculation engine.
 * All dimensions in millimeters.
 */

/** IPC density levels controlling pad size and courtyard */
export type DensityLevel = "most" | "nominal" | "least";

/** IPC density level suffix letters for naming convention */
export const DENSITY_SUFFIX: Record<DensityLevel, string> = {
  most: "M",
  nominal: "N",
  least: "L",
};

/** Lead types determining which fillet goal table to use */
export type LeadType =
  | "chip_rectangular"
  | "gull_wing_large"
  | "gull_wing_small"
  | "j_lead"
  | "flat_no_lead"
  | "pullback_no_lead"
  | "bga";

/** Solder fillet goals (toe, heel, side) in mm */
export interface FilletGoals {
  /** Toe fillet — solder extension beyond outer lead edge */
  Jt: number;
  /** Heel fillet — solder extension beyond inner lead edge */
  Jh: number;
  /** Side fillet — solder extension beyond side of lead */
  Js: number;
}

/** Fabrication and placement tolerances */
export interface FabricationTolerances {
  /** PCB fabrication tolerance (mm). Default: 0.05 */
  F: number;
  /** Pick-and-place placement tolerance (mm). Default: 0.025 */
  P: number;
}

export const DEFAULT_FAB_TOLERANCES: FabricationTolerances = {
  F: 0.05,
  P: 0.025,
};

/**
 * Component dimensions from datasheet.
 * L = overall length (toe-to-toe), S = inner gap (heel-to-heel), W = lead width.
 * For leaded packages: T = terminal (lead) length.
 */
export interface ComponentDimensions {
  /** Minimum overall length (mm) */
  Lmin: number;
  /** Maximum overall length (mm) */
  Lmax: number;
  /** Minimum inner gap between leads (mm). For chip: derived from L - 2*Tmax */
  Smin: number;
  /** Maximum inner gap between leads (mm). For chip: derived from L - 2*Tmin */
  Smax: number;
  /** Minimum lead width (mm) */
  Wmin: number;
  /** Maximum lead width (mm) */
  Wmax: number;
  /** Component height (mm) — used for naming convention */
  height?: number;
  /** Lead pitch for multi-pin packages (mm) */
  pitch?: number;
  /** Total pin count */
  pinCount?: number;
  /** Nominal body length (mm) — for naming */
  bodyL?: number;
  /** Nominal body width (mm) — for naming */
  bodyW?: number;
}

/** Result of pad dimension calculation for one density level */
export interface PadCalculationResult {
  /** Pad length in direction perpendicular to component body (mm) */
  padLength: number;
  /** Pad width parallel to component body (mm) */
  padWidth: number;
  /** Distance between pad centers (mm) */
  centerToCenter: number;
  /** Outer span of pads: Zmax (mm) */
  outerSpan: number;
  /** Inner gap between pads: Gmin (mm) */
  innerGap: number;
  /** Courtyard width — total X extent + excess (mm) */
  courtyardWidth: number;
  /** Courtyard height — total Y extent + excess (mm) */
  courtyardHeight: number;
}

/** Full output for a single density calculation */
export interface CalculatorOutput {
  densityLevel: DensityLevel;
  pads: PadCalculationResult;
  courtyardExcess: number;
  ipcName: string;
}

/** BGA-specific dimensions (different calculation model) */
export interface BgaDimensions {
  ballDiameter: number;
  pitch: number;
  cols: number;
  rows: number;
  bodyL: number;
  bodyW: number;
  height?: number;
  /** true = non-solder-mask-defined (pad < ball), false = SMD (pad >= ball) */
  nsmd: boolean;
}
