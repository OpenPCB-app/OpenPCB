/**
 * Pre-defined package size tables for common footprint families.
 *
 * Body dimensions sourced from manufacturer datasheets and
 * IPC-7351B recommended land pattern guidelines.
 */

import type {
  ChipParams,
  GullWingDualParams,
  QfnParams,
  QuadFlatParams,
} from "./pad-calculator";

// ── Package family identifiers ──────────────────────────────────────

export type PackageFamily = "chip" | "sot" | "soic" | "qfp" | "qfn";

export interface PresetSize<TParams> {
  /** Imperial size code (e.g. "0402") or package name (e.g. "SOT-23") */
  readonly label: string;
  /** Metric size code if applicable */
  readonly metric: string | null;
  /** Short description */
  readonly subtitle: string;
  /** Parameters for the pad calculator */
  readonly params: TParams;
}

export interface PackageFamilyDef<TParams> {
  readonly id: PackageFamily;
  readonly label: string;
  readonly subtitle: string;
  readonly sizes: readonly PresetSize<TParams>[];
}

// ── Chip (2-terminal passive) ───────────────────────────────────────

export const CHIP_FAMILY: PackageFamilyDef<ChipParams> = {
  id: "chip",
  label: "Chip",
  subtitle: "R, C, L (0201–2512)",
  sizes: [
    {
      label: "0201",
      metric: "0603",
      subtitle: "0.6 x 0.3 mm",
      params: { bodyLengthMm: 0.6, bodyWidthMm: 0.3, terminalLengthMm: 0.15 },
    },
    {
      label: "0402",
      metric: "1005",
      subtitle: "1.0 x 0.5 mm",
      params: { bodyLengthMm: 1.0, bodyWidthMm: 0.5, terminalLengthMm: 0.2 },
    },
    {
      label: "0603",
      metric: "1608",
      subtitle: "1.6 x 0.8 mm",
      params: { bodyLengthMm: 1.6, bodyWidthMm: 0.8, terminalLengthMm: 0.3 },
    },
    {
      label: "0805",
      metric: "2012",
      subtitle: "2.0 x 1.25 mm",
      params: { bodyLengthMm: 2.0, bodyWidthMm: 1.25, terminalLengthMm: 0.4 },
    },
    {
      label: "1206",
      metric: "3216",
      subtitle: "3.2 x 1.6 mm",
      params: { bodyLengthMm: 3.2, bodyWidthMm: 1.6, terminalLengthMm: 0.5 },
    },
    {
      label: "1210",
      metric: "3225",
      subtitle: "3.2 x 2.5 mm",
      params: { bodyLengthMm: 3.2, bodyWidthMm: 2.5, terminalLengthMm: 0.5 },
    },
    {
      label: "2010",
      metric: "5025",
      subtitle: "5.0 x 2.5 mm",
      params: { bodyLengthMm: 5.0, bodyWidthMm: 2.5, terminalLengthMm: 0.6 },
    },
    {
      label: "2512",
      metric: "6332",
      subtitle: "6.3 x 3.2 mm",
      params: { bodyLengthMm: 6.3, bodyWidthMm: 3.2, terminalLengthMm: 0.6 },
    },
  ],
};

// ── SOT (Small Outline Transistor) ──────────────────────────────────

export const SOT_FAMILY: PackageFamilyDef<GullWingDualParams> = {
  id: "sot",
  label: "SOT",
  subtitle: "Small Outline Transistor",
  sizes: [
    {
      label: "SOT-23",
      metric: null,
      subtitle: "3 pins, 0.95 mm pitch",
      params: {
        pinCount: 4, // SOT-23 has 3 pins but uses 4-pin dual-row layout (1 empty)
        pitchMm: 0.95,
        spanMm: 2.4,
        terminalLengthMm: 0.5,
        terminalWidthMm: 0.4,
        bodyWidthMm: 1.3,
        bodyLengthMm: 1.75,
      },
    },
    {
      label: "SOT-23-5",
      metric: null,
      subtitle: "5 pins, 0.95 mm pitch",
      params: {
        pinCount: 6,
        pitchMm: 0.95,
        spanMm: 2.6,
        terminalLengthMm: 0.5,
        terminalWidthMm: 0.3,
        bodyWidthMm: 1.6,
        bodyLengthMm: 2.9,
      },
    },
    {
      label: "SOT-223",
      metric: null,
      subtitle: "4 pins, 2.3 mm pitch",
      params: {
        pinCount: 4,
        pitchMm: 2.3,
        spanMm: 6.5,
        terminalLengthMm: 0.9,
        terminalWidthMm: 0.7,
        bodyWidthMm: 3.5,
        bodyLengthMm: 6.5,
      },
    },
    {
      label: "SOT-323",
      metric: null,
      subtitle: "3 pins, 0.65 mm pitch",
      params: {
        pinCount: 4,
        pitchMm: 0.65,
        spanMm: 2.1,
        terminalLengthMm: 0.4,
        terminalWidthMm: 0.3,
        bodyWidthMm: 1.25,
        bodyLengthMm: 1.35,
      },
    },
  ],
};

// ── SOIC (Small Outline IC) ─────────────────────────────────────────

function soicParams(pinCount: number): GullWingDualParams {
  const isWide = pinCount > 16;
  return {
    pinCount,
    pitchMm: 1.27,
    spanMm: isWide ? 10.3 : 6.0,
    terminalLengthMm: isWide ? 0.6 : 0.5,
    terminalWidthMm: 0.4,
    bodyWidthMm: isWide ? 7.5 : 3.9,
    bodyLengthMm: (pinCount / 2) * 1.27 + 0.5,
  };
}

export const SOIC_FAMILY: PackageFamilyDef<GullWingDualParams> = {
  id: "soic",
  label: "SOIC",
  subtitle: "Small Outline IC",
  sizes: [
    {
      label: "SOIC-8",
      metric: null,
      subtitle: "8 pins, 1.27 mm pitch",
      params: soicParams(8),
    },
    {
      label: "SOIC-14",
      metric: null,
      subtitle: "14 pins, 1.27 mm pitch",
      params: soicParams(14),
    },
    {
      label: "SOIC-16",
      metric: null,
      subtitle: "16 pins, 1.27 mm pitch",
      params: soicParams(16),
    },
    {
      label: "SOIC-28W",
      metric: null,
      subtitle: "28 pins, wide body",
      params: soicParams(28),
    },
  ],
};

// ── QFP (Quad Flat Package) ─────────────────────────────────────────

function qfpParams(pinCount: number, pitchMm: number): QuadFlatParams {
  const pinsPerSide = pinCount / 4;
  const bodySize = Math.max(7.0, pinsPerSide * pitchMm + 1.0);
  const span = bodySize + 2.0;
  return {
    pinCount,
    pitchMm,
    spanXMm: span,
    spanYMm: span,
    terminalLengthMm: 0.6,
    terminalWidthMm: pitchMm * 0.5,
    bodyWidthMm: bodySize,
    bodyLengthMm: bodySize,
  };
}

export const QFP_FAMILY: PackageFamilyDef<QuadFlatParams> = {
  id: "qfp",
  label: "QFP",
  subtitle: "Quad Flat Package",
  sizes: [
    {
      label: "TQFP-32",
      metric: null,
      subtitle: "32 pins, 0.8 mm pitch",
      params: qfpParams(32, 0.8),
    },
    {
      label: "TQFP-48",
      metric: null,
      subtitle: "48 pins, 0.5 mm pitch",
      params: qfpParams(48, 0.5),
    },
    {
      label: "LQFP-64",
      metric: null,
      subtitle: "64 pins, 0.5 mm pitch",
      params: qfpParams(64, 0.5),
    },
    {
      label: "LQFP-100",
      metric: null,
      subtitle: "100 pins, 0.5 mm pitch",
      params: qfpParams(100, 0.5),
    },
  ],
};

// ── QFN (Quad Flat No-lead) ─────────────────────────────────────────

function qfnParams(
  pinCount: number,
  bodySizeMm: number,
  pitchMm: number,
  exposedPadMm?: number,
): QfnParams {
  return {
    pinCount,
    pitchMm,
    bodySizeMm,
    padWidthMm: pitchMm * 0.5,
    padHeightMm: 0.6,
    exposedPadMm,
  };
}

export const QFN_FAMILY: PackageFamilyDef<QfnParams> = {
  id: "qfn",
  label: "QFN",
  subtitle: "Quad Flat No-lead",
  sizes: [
    {
      label: "QFN-16",
      metric: null,
      subtitle: "16 pins, 3x3 mm, 0.5 pitch",
      params: qfnParams(16, 3.0, 0.5, 1.7),
    },
    {
      label: "QFN-20",
      metric: null,
      subtitle: "20 pins, 4x4 mm, 0.5 pitch",
      params: qfnParams(20, 4.0, 0.5, 2.5),
    },
    {
      label: "QFN-24",
      metric: null,
      subtitle: "24 pins, 4x4 mm, 0.5 pitch",
      params: qfnParams(24, 4.0, 0.5, 2.5),
    },
    {
      label: "QFN-32",
      metric: null,
      subtitle: "32 pins, 5x5 mm, 0.5 pitch",
      params: qfnParams(32, 5.0, 0.5, 3.5),
    },
  ],
};

// ── All families ────────────────────────────────────────────────────

export const ALL_FAMILIES = [
  CHIP_FAMILY,
  SOT_FAMILY,
  SOIC_FAMILY,
  QFP_FAMILY,
  QFN_FAMILY,
] as const;

export function getFamilyById(
  id: PackageFamily,
): PackageFamilyDef<unknown> | undefined {
  return ALL_FAMILIES.find((f) => f.id === id);
}
