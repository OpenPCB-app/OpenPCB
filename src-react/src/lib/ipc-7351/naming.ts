/**
 * IPC-7351B Land Pattern Naming Convention
 *
 * Generates standardized names like RESC2012X65N, SOP65P640X120-16N
 *
 * Format: [FAMILY_PREFIX][Dimensions][DensityLetter]
 * - Dimensions in metric (0.1mm units for body, 0.01mm for pitch)
 * - Density: M=Most, N=Nominal, L=Least
 */

import type { ComponentDimensions, DensityLevel } from "./types";
import { DENSITY_SUFFIX } from "./types";

// ---------------------------------------------------------------------------
// IPC Family Prefixes
// ---------------------------------------------------------------------------

/** Standard IPC-7351B family prefix mapping */
export const IPC_FAMILY_PREFIXES = {
  // 2-terminal passives
  resistor_chip: "RESC",
  capacitor_chip: "CAPC",
  capacitor_chip_polarized: "CAPCP",
  capacitor_molded: "CAPM",
  capacitor_molded_polarized: "CAPMP",
  capacitor_aluminum_electrolytic: "CAPAE",
  inductor_chip: "INDC",
  inductor_molded: "INDM",
  diode_chip: "DIOC",
  diode_molded: "DIOM",
  resistor_melf: "RESMELF",
  diode_melf: "DIOMELF",
  fuse_molded: "FUSM",
  led_molded: "LEDM",
  crystal: "XTAL",

  // Gull-wing dual
  soic: "SOIC",
  sop: "SOP",
  ssop: "SSOP",
  tsop: "TSOP",
  tssop: "TSSOP",
  cfp: "CFP",

  // Gull-wing quad
  qfp: "QFP",
  sqfp: "SQFP",
  tqfp: "TQFP",
  cqfp: "CQFP",

  // J-lead
  soj: "SOJ",
  plcc: "PLCC",

  // No-lead
  qfn: "QFN",
  pqfn: "PQFN",
  son: "SON",
  pson: "PSON",
  dfn: "DFN",
  lcc: "LCC",

  // Discrete semiconductor
  sot: "SOT",
  sod: "SOD",
  dpak: "DPAK",
  dip: "DIP",

  // Array
  bga: "BGA",
  lga: "LGA",
} as const;

export type IpcFamilyPrefix =
  (typeof IPC_FAMILY_PREFIXES)[keyof typeof IPC_FAMILY_PREFIXES];

// ---------------------------------------------------------------------------
// Dimension Encoding
// ---------------------------------------------------------------------------

/** Encode a dimension in mm to IPC format (0.1mm units, no leading zeros) */
function encodeDim(mm: number): string {
  return String(Math.round(mm * 10));
}

/** Encode a dimension in mm to IPC format (0.1mm units, 2-digit minimum) */
function encodeDim2(mm: number): string {
  return String(Math.round(mm * 10)).padStart(2, "0");
}

/** Encode a dimension in mm to IPC 2-3 digit height format (0.01mm units) */
function encodeHeight(mm: number): string {
  const units = Math.round(mm * 100);
  return String(units);
}

/** Encode pitch in mm (0.01mm units, 2+ digits) */
function encodePitch(mm: number): string {
  const units = Math.round(mm * 100);
  return String(units);
}

// ---------------------------------------------------------------------------
// Name Generation
// ---------------------------------------------------------------------------

/**
 * Generate IPC-7351B compliant land pattern name.
 *
 * @param prefix - IPC family prefix (e.g., "RESC", "SOP", "QFN")
 * @param dims - Component dimensions
 * @param density - Density level
 * @returns IPC name string (e.g., "RESC2012X65N")
 */
export function generateIpcName(
  prefix: string,
  dims: ComponentDimensions,
  density: DensityLevel,
): string {
  const suffix = DENSITY_SUFFIX[density];
  const bodyL = dims.bodyL ?? (dims.Lmin + dims.Lmax) / 2;
  const bodyW = dims.bodyW ?? (dims.Wmin + dims.Wmax) / 2;

  // 2-terminal chip: PREFIX + BodyL(2dig) + BodyW(2dig) + XHeight + Density
  // e.g., RESC2012X65N (L=2.0→20, W=1.2→12)
  if (isChipPrefix(prefix)) {
    const lwPart = `${encodeDim2(bodyL)}${encodeDim2(bodyW)}`;
    const heightPart = dims.height ? `X${encodeHeight(dims.height)}` : "";
    return `${prefix}${lwPart}${heightPart}${suffix}`;
  }

  // Multi-pin leaded: PREFIX + PitchP + LeadSpanOrBody + XHeight - PinCount + Density
  // e.g., SOP65P640X120-16N, QFN50P500X500X80-33N
  if (dims.pitch && dims.pinCount) {
    const pitchPart = `${encodePitch(dims.pitch)}P`;
    const spanL = encodeDim(bodyL);
    const spanW = encodeDim(bodyW);
    const heightPart = dims.height ? `X${encodeHeight(dims.height)}` : "";

    // Quad packages include both dimensions
    if (isQuadPrefix(prefix)) {
      return `${prefix}${pitchPart}${spanL}X${spanW}${heightPart}-${dims.pinCount}${suffix}`;
    }

    // Dual-row packages use lead span
    return `${prefix}${pitchPart}${spanL}${heightPart}-${dims.pinCount}${suffix}`;
  }

  // Fallback: PREFIX + BodyLW + Density
  return `${prefix}${encodeDim2(bodyL)}${encodeDim2(bodyW)}${suffix}`;
}

function isChipPrefix(prefix: string): boolean {
  return /^(RESC|CAPC|CAPCP|CAPM|CAPMP|CAPAE|INDC|INDM|INDP|DIOC|DIOM|FUSM|LEDM|XTAL|RESMELF|DIOMELF)$/.test(
    prefix,
  );
}

function isQuadPrefix(prefix: string): boolean {
  return /^(QFP|SQFP|TQFP|TSQFP|CQFP|QFN|PQFN|PLCC|BGA|LGA)$/.test(prefix);
}
