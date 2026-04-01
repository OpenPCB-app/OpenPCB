/**
 * IPC-7351B Fillet Goal Tables
 *
 * Solder fillet goals by lead type and density level.
 * Source: IPC-7351B (2010) + KiCad footprint generator reference.
 */

import type { DensityLevel, FilletGoals, LeadType } from "./types";

/**
 * Fillet goals (Jt, Jh, Js) in mm for each lead type × density level.
 * Source: IPC-7351B (2010) Tables 3-1 through 3-7, cross-referenced
 * with KiCad IPC footprint generator (ipc_definitions.yaml).
 *
 * Negative values are intentional per the standard:
 * - Negative Js on fine-pitch gull-wing reduces pad width to prevent bridging
 *   (only safe because Jh keeps heel fillet robust)
 * - Negative Jt on J-leads reflects the curled-under lead geometry
 */
export const FILLET_GOALS: Record<
  LeadType,
  Record<DensityLevel, FilletGoals>
> = {
  // IPC-7351B Table 3-1: Chip end-cap (RESC, CAPC, INDC, DIOC, etc.)
  // Jh=0: lead wraps under body with no inner protrusion
  chip_rectangular: {
    most: { Jt: 0.55, Jh: 0.0, Js: 0.05 },
    nominal: { Jt: 0.35, Jh: 0.0, Js: 0.0 },
    least: { Jt: 0.15, Jh: 0.0, Js: -0.05 },
  },

  // IPC-7351B Table 3-2: Gull-wing, pitch > 0.625mm (SOIC, SOP, SOT, TO)
  gull_wing_large: {
    most: { Jt: 0.55, Jh: 0.45, Js: 0.05 },
    nominal: { Jt: 0.35, Jh: 0.35, Js: 0.03 },
    least: { Jt: 0.15, Jh: 0.25, Js: 0.01 },
  },

  // IPC-7351B Table 3-3: Gull-wing, pitch <= 0.625mm (QFP, TQFP, SSOP)
  gull_wing_small: {
    most: { Jt: 0.55, Jh: 0.45, Js: 0.01 },
    nominal: { Jt: 0.35, Jh: 0.35, Js: -0.03 },
    least: { Jt: 0.15, Jh: 0.25, Js: -0.05 },
  },

  // IPC-7351B Table 3-4: J-lead (SOJ, PLCC)
  // Toe fillet is small because lead curls under; heel is primary structural joint
  j_lead: {
    most: { Jt: 0.1, Jh: 0.55, Js: 0.05 },
    nominal: { Jt: 0.0, Jh: 0.35, Js: 0.03 },
    least: { Jt: -0.1, Jh: 0.15, Js: 0.01 },
  },

  // IPC-7351B Table 3-5: Flat no-lead (QFN, SON, DFN, LCC)
  // Jh=0: exposed terminal flush with package edge; Js negative to prevent bridging
  flat_no_lead: {
    most: { Jt: 0.4, Jh: 0.0, Js: -0.04 },
    nominal: { Jt: 0.3, Jh: 0.0, Js: -0.04 },
    least: { Jt: 0.2, Jh: 0.0, Js: -0.04 },
  },

  // IPC-7351B Table 3-6: Pull-back no-lead (PQFN, PSON)
  // Leads recessed from package edge; smaller fillets than standard QFN
  pullback_no_lead: {
    most: { Jt: 0.1, Jh: 0.1, Js: 0.01 },
    nominal: { Jt: 0.0, Jh: 0.0, Js: 0.0 },
    least: { Jt: -0.1, Jh: -0.1, Js: -0.01 },
  },

  // BGA uses pad-diameter ratios (not fillet goals). These zeros are unused
  // by calculatePadDimensions; BGA pads computed via calculateBgaPadDiameter.
  bga: {
    most: { Jt: 0.0, Jh: 0.0, Js: 0.0 },
    nominal: { Jt: 0.0, Jh: 0.0, Js: 0.0 },
    least: { Jt: 0.0, Jh: 0.0, Js: 0.0 },
  },
};

/** Courtyard excess per density level (mm added per side) */
export const COURTYARD_EXCESS: Record<DensityLevel, number> = {
  most: 0.5,
  nominal: 0.25,
  least: 0.1,
};

/** Silkscreen line width per density level (mm) */
export const SILKSCREEN_WIDTH: Record<DensityLevel, number> = {
  most: 0.15,
  nominal: 0.127,
  least: 0.1,
};

/** Fab layer line width (constant across density levels) */
export const FAB_LINE_WIDTH = 0.1;

/**
 * BGA pad diameter ratios relative to ball diameter.
 * NSMD = Non-Solder-Mask-Defined (pad smaller than ball, mask opening larger)
 * SMD = Solder-Mask-Defined (pad larger than ball, mask constrains)
 */
export const BGA_PAD_RATIOS: Record<
  DensityLevel,
  { nsmd: number; smd: number }
> = {
  most: { nsmd: 0.8, smd: 1.0 },
  nominal: { nsmd: 0.75, smd: 1.0 },
  least: { nsmd: 0.7, smd: 0.95 },
};
