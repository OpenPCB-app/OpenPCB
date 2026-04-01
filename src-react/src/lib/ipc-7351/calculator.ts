/**
 * IPC-7351B+C Land Pattern Calculator
 *
 * Pure functions implementing the three master equations:
 *   Zmax = Lmin + 2·Jt + √(Cl² + F² + P²)
 *   Gmin = Smax - 2·Jh - √(Cs² + F² + P²)
 *   Xmax = Wmin + 2·Js + √(Cw² + F² + P²)
 *
 * All outputs rounded to 0.05mm grid per IPC specification.
 */

import {
  FILLET_GOALS,
  COURTYARD_EXCESS,
  BGA_PAD_RATIOS,
} from "./fillet-tables";
import type {
  ComponentDimensions,
  DensityLevel,
  FabricationTolerances,
  LeadType,
  PadCalculationResult,
  CalculatorOutput,
  BgaDimensions,
} from "./types";
import { DEFAULT_FAB_TOLERANCES } from "./types";
import { generateIpcName } from "./naming";

// ---------------------------------------------------------------------------
// Grid Rounding
// ---------------------------------------------------------------------------

/** Round to IPC 0.05mm grid, then fix floating-point to 2 decimal places */
export function roundToGrid(value: number, grid = 0.05): number {
  const rounded = Math.round(value / grid) * grid;
  const fixed = Math.round(rounded * 100) / 100;
  return fixed === 0 ? 0 : fixed; // Avoid -0
}

// ---------------------------------------------------------------------------
// RSS Tolerance Combination
// ---------------------------------------------------------------------------

/**
 * Root Sum Square combination of tolerances.
 * Assumes tolerances are independent and normally distributed.
 */
function rss(componentTolerance: number, F: number, P: number): number {
  return Math.sqrt(componentTolerance ** 2 + F ** 2 + P ** 2);
}

// ---------------------------------------------------------------------------
// Core Pad Calculation
// ---------------------------------------------------------------------------

/**
 * Pitch threshold between "large" and "small" gull-wing fillet goals (mm).
 * Packages with pitch <= this value use gull_wing_small fillets.
 * Source: IPC-7351B section 3.2, boundary between Tables 3-2 and 3-3.
 */
export const GULL_WING_PITCH_THRESHOLD = 0.625;

/**
 * Calculate pad dimensions for a 2-terminal or leaded component.
 *
 * @param dims - Component dimensions from datasheet
 * @param leadType - Lead type for fillet goal selection
 * @param density - Density level (most/nominal/least)
 * @param fab - Fabrication/placement tolerances (defaults to 0.05/0.025)
 * @throws Error if dimensions are physically impossible
 */
export function calculatePadDimensions(
  dims: ComponentDimensions,
  leadType: LeadType,
  density: DensityLevel,
  fab: FabricationTolerances = DEFAULT_FAB_TOLERANCES,
): PadCalculationResult {
  // Input validation
  if (dims.Lmin <= 0 || dims.Lmax < dims.Lmin) {
    throw new Error(
      `Invalid L dimensions: Lmin=${dims.Lmin}, Lmax=${dims.Lmax}`,
    );
  }
  if (dims.Smax < dims.Smin) {
    throw new Error(
      `Invalid S dimensions: Smin=${dims.Smin}, Smax=${dims.Smax}`,
    );
  }
  if (dims.Wmin <= 0 || dims.Wmax < dims.Wmin) {
    throw new Error(
      `Invalid W dimensions: Wmin=${dims.Wmin}, Wmax=${dims.Wmax}`,
    );
  }

  const fillets = FILLET_GOALS[leadType][density];
  const courtyardExcess = COURTYARD_EXCESS[density];

  // Component tolerances (always >= 0 after validation)
  const Cl = dims.Lmax - dims.Lmin;
  const Cs = dims.Smax - dims.Smin;
  const Cw = dims.Wmax - dims.Wmin;

  // Three master equations (IPC-7351B Section 3)
  const Zmax = dims.Lmin + 2 * fillets.Jt + rss(Cl, fab.F, fab.P);
  const Gmin = dims.Smax - 2 * fillets.Jh - rss(Cs, fab.F, fab.P);
  const Xmax = dims.Wmin + 2 * fillets.Js + rss(Cw, fab.F, fab.P);

  // Derive pad geometry
  const padLength = roundToGrid((Zmax - Gmin) / 2);
  const padWidth = roundToGrid(Xmax);
  const centerToCenter = roundToGrid((Zmax + Gmin) / 2);
  const outerSpan = roundToGrid(Zmax);
  const innerGap = roundToGrid(Gmin);

  // Courtyard from maximum extent (IPC-7351C: pad extents or body, whichever larger)
  // Width axis: along lead span (outerSpan covers pads, bodyL covers body)
  // Height axis: perpendicular to leads (padWidth covers pads, bodyW covers body)
  const bodyL = dims.bodyL ?? outerSpan;
  const bodyW = dims.bodyW ?? padWidth;
  const courtyardWidth = roundToGrid(
    Math.max(outerSpan, bodyL) + courtyardExcess * 2,
  );
  const courtyardHeight = roundToGrid(
    Math.max(padWidth, bodyW) + courtyardExcess * 2,
  );

  return {
    padLength,
    padWidth,
    centerToCenter,
    outerSpan,
    innerGap,
    courtyardWidth,
    courtyardHeight,
  };
}

// ---------------------------------------------------------------------------
// BGA Calculation (Different Model)
// ---------------------------------------------------------------------------

/**
 * Calculate BGA pad diameter from ball diameter.
 * Uses NSMD/SMD ratio tables per IPC-7351B.
 */
export function calculateBgaPadDiameter(
  ballDiameter: number,
  density: DensityLevel,
  nsmd = true,
): number {
  const ratios = BGA_PAD_RATIOS[density];
  const ratio = nsmd ? ratios.nsmd : ratios.smd;
  return roundToGrid(ballDiameter * ratio);
}

/**
 * Calculate BGA courtyard from grid extent.
 */
export function calculateBgaCourtyard(
  dims: BgaDimensions,
  density: DensityLevel,
): { width: number; height: number } {
  const padDiameter = calculateBgaPadDiameter(
    dims.ballDiameter,
    density,
    dims.nsmd,
  );
  const courtyardExcess = COURTYARD_EXCESS[density];

  const gridWidth = (dims.cols - 1) * dims.pitch + padDiameter;
  const gridHeight = (dims.rows - 1) * dims.pitch + padDiameter;

  // Use max of body size and grid extent
  const extentW = Math.max(gridWidth, dims.bodyL);
  const extentH = Math.max(gridHeight, dims.bodyW);

  return {
    width: roundToGrid(extentW + courtyardExcess * 2),
    height: roundToGrid(extentH + courtyardExcess * 2),
  };
}

// ---------------------------------------------------------------------------
// Multi-Density Convenience
// ---------------------------------------------------------------------------

const DENSITY_LEVELS: DensityLevel[] = ["most", "nominal", "least"];

/**
 * Calculate pad dimensions at all 3 density levels.
 */
export function calculateAllDensities(
  dims: ComponentDimensions,
  leadType: LeadType,
  ipcPrefix: string,
  fab?: FabricationTolerances,
): CalculatorOutput[] {
  return DENSITY_LEVELS.map((density) => {
    const pads = calculatePadDimensions(dims, leadType, density, fab);
    const courtyardExcess = COURTYARD_EXCESS[density];
    const ipcName = generateIpcName(ipcPrefix, dims, density);

    return { densityLevel: density, pads, courtyardExcess, ipcName };
  });
}

// ---------------------------------------------------------------------------
// Lead Type Selection Helper
// ---------------------------------------------------------------------------

/**
 * Determine IPC lead type from package characteristics.
 */
export function selectLeadType(packageType: string, pitch?: number): LeadType {
  const pkg = packageType.toLowerCase();

  // J-lead must be checked before flat_no_lead (PLCC contains "lcc")
  if (["soj", "plcc"].some((p) => pkg.includes(p))) {
    return "j_lead";
  }

  if (["qfn", "dfn", "son", "lcc"].some((p) => pkg.includes(p))) {
    return pkg.includes("pull") || pkg.includes("pqfn") || pkg.includes("pson")
      ? "pullback_no_lead"
      : "flat_no_lead";
  }

  if (["bga", "cga", "lga"].some((p) => pkg.includes(p))) {
    return "bga";
  }

  // Gull-wing: split on IPC pitch threshold (Section 3.2)
  if (["qfp", "sqfp", "tqfp", "ssop", "tssop"].some((p) => pkg.includes(p))) {
    return (pitch ?? 0.5) <= GULL_WING_PITCH_THRESHOLD
      ? "gull_wing_small"
      : "gull_wing_large";
  }

  if (
    ["soic", "sop", "tsop", "sot", "sod", "dpak", "to-", "cfp"].some((p) =>
      pkg.includes(p),
    )
  ) {
    return "gull_wing_large";
  }

  // Default: chip rectangular (resistors, caps, inductors, diodes, etc.)
  return "chip_rectangular";
}
