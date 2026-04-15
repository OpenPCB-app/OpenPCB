/**
 * IPC-7351B land pattern dimensional additions per density level.
 *
 * Each entry contains toe/heel/side solder fillet additions and courtyard
 * excess. Values in millimeters, derived from IPC-7351B Tables 3-1 through 3-17.
 *
 * Density levels:
 *   most    (Level A) — maximum solder fillet, prototyping / hand solder
 *   nominal (Level B) — standard production
 *   least   (Level C) — high-density / BGA-class boards
 */

export type DensityLevel = "most" | "nominal" | "least";

export interface SolderFilletAdditions {
  /** Toe extension (outward from terminal end) */
  readonly toe: number;
  /** Heel extension (inward toward body center) */
  readonly heel: number;
  /** Side extension (lateral) */
  readonly side: number;
  /** Courtyard excess beyond land pattern edge */
  readonly courtyard: number;
}

export type DensityTable = Readonly<
  Record<DensityLevel, SolderFilletAdditions>
>;

// ── Chip (2-terminal passive: R, C, L) ──────────────────────────────
export const CHIP_ADDITIONS: DensityTable = {
  most: { toe: 0.55, heel: 0.0, side: 0.05, courtyard: 0.5 },
  nominal: { toe: 0.35, heel: 0.0, side: 0.0, courtyard: 0.25 },
  least: { toe: 0.15, heel: 0.0, side: -0.05, courtyard: 0.12 },
};

// ── SOT (Small Outline Transistor — gull-wing, 3–5 pins) ───────────
export const SOT_ADDITIONS: DensityTable = {
  most: { toe: 0.55, heel: 0.45, side: 0.05, courtyard: 0.5 },
  nominal: { toe: 0.35, heel: 0.35, side: 0.03, courtyard: 0.25 },
  least: { toe: 0.15, heel: 0.25, side: 0.01, courtyard: 0.12 },
};

// ── SOIC / SOP (gull-wing dual-row ICs) ─────────────────────────────
export const SOIC_ADDITIONS: DensityTable = {
  most: { toe: 0.55, heel: 0.45, side: 0.05, courtyard: 0.5 },
  nominal: { toe: 0.35, heel: 0.35, side: 0.03, courtyard: 0.25 },
  least: { toe: 0.15, heel: 0.25, side: 0.01, courtyard: 0.12 },
};

// ── QFP (Quad Flat Package — gull-wing quad) ────────────────────────
export const QFP_ADDITIONS: DensityTable = {
  most: { toe: 0.55, heel: 0.45, side: 0.05, courtyard: 0.5 },
  nominal: { toe: 0.35, heel: 0.35, side: 0.03, courtyard: 0.25 },
  least: { toe: 0.15, heel: 0.25, side: 0.01, courtyard: 0.12 },
};

// ── QFN (Quad Flat No-lead — J-bend / flat pad) ────────────────────
export const QFN_ADDITIONS: DensityTable = {
  most: { toe: 0.4, heel: 0.0, side: 0.05, courtyard: 0.5 },
  nominal: { toe: 0.3, heel: 0.0, side: 0.0, courtyard: 0.25 },
  least: { toe: 0.2, heel: 0.0, side: -0.04, courtyard: 0.12 },
};

/** Silkscreen line width (mm) */
export const SILK_LINE_WIDTH = 0.12;

/** Fabrication layer line width (mm) */
export const FAB_LINE_WIDTH = 0.1;

/** Courtyard line width (mm) */
export const COURTYARD_LINE_WIDTH = 0.05;

/** Default silkscreen clearance from pad edge (mm) */
export const SILK_PAD_CLEARANCE = 0.2;
