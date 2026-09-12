/**
 * IPC-2221B conductor spacing (Table 6-1) and the IPC-2221 conductor
 * (current-versus-width) formula — the pinned transcription of electrical
 * contract 13 §6.
 *
 * SOURCES (§6.1). IPC-2221B itself is paywalled and has NOT been read: every
 * value below is a secondary transcription, and two independent ones fetched on
 * 2026-09-11 agree row for row:
 *   1. KiCad 8 `pcb_calculator/calculator_panels/panel_electrical_spacing_ipc2221.cpp`,
 *      commit `942661fc10e172febf9d9990de2471d4b1020618` — the pre-IPC-2221C
 *      table (seven columns B1, B2, B3, B4, A5, A6, A7) with the note "For
 *      voltages greater than 500V, the (per volt) table values must be added to
 *      the 500V values … 0.25 mm + (100V x 0.0025)".
 *   2. smpspowersupply.com/ipc2221pcbclearance.html (Lazar Rozenblat),
 *      "IPC-2221B PCB Trace Spacing / Clearance by Voltage", columns B1, B2, B4,
 *      whose worked values above 500 V (1000 V: 1.5 / 5 / 2.33 mm) confirm the
 *      "500 V value plus slope times excess" rule.
 * The current formula's constants (k = 0.048 external / 0.024 internal,
 * b = 0.44, c = 0.725) are KiCad 8 `panel_track_width.cpp` at the same commit.
 *
 * EDITION B IS PINNED. KiCad's later commit
 * `3ff0b3cc57dd043ac6b159611d85a01374df7a88` transcribes IPC-2221C (Dec 2023)
 * with different values (B2 0.6 → 0.64 mm in the 31–150 V bands, B4 0.13 → 0.3,
 * 0.4 → 0.8, 0.8 → 1.6 mm, an eighth column). The two editions are never mixed.
 */
import type { PcbCopperLayerId } from "../../sdks/designer";

/**
 * The conductor columns OpenPCB models (§1.2). B3 (altitude) and the assembly
 * columns A5–A7 are stated limits, not gaps to fill in later without a source.
 */
export type IpcSpacingColumn = "B1" | "B2" | "B4";

interface SpacingBand {
  /** Inclusive upper bound of the differential (V) for this band (§6.2). */
  maxV: number;
  /** B1 — internal conductors. */
  b1Mm: number;
  /** B2 — external, uncoated, sea level to 3050 m. */
  b2Mm: number;
  /** B4 — external, permanent polymer coating, any elevation. */
  b4Mm: number;
}

/** IPC-2221B Table 6-1, mm, transcribed from the two sources above (§6.2). */
const BANDS: readonly SpacingBand[] = [
  { maxV: 15, b1Mm: 0.05, b2Mm: 0.1, b4Mm: 0.05 },
  { maxV: 30, b1Mm: 0.05, b2Mm: 0.1, b4Mm: 0.05 },
  { maxV: 50, b1Mm: 0.1, b2Mm: 0.6, b4Mm: 0.13 },
  { maxV: 100, b1Mm: 0.1, b2Mm: 0.6, b4Mm: 0.13 },
  { maxV: 150, b1Mm: 0.2, b2Mm: 0.6, b4Mm: 0.4 },
  { maxV: 170, b1Mm: 0.2, b2Mm: 1.25, b4Mm: 0.4 },
  { maxV: 250, b1Mm: 0.2, b2Mm: 1.25, b4Mm: 0.4 },
  { maxV: 300, b1Mm: 0.2, b2Mm: 1.25, b4Mm: 0.4 },
  { maxV: 500, b1Mm: 0.25, b2Mm: 2.5, b4Mm: 0.8 },
];

/**
 * Above 500 V: the 500 V value PLUS the per-volt slope times the excess (§6.2).
 * Distinguishable from the alternative reading `slope × V` only in B1 and B4
 * (600 V: B1 0.5 mm versus 1.5 mm) — B2's `2.5 + 0.005·(V − 500)` equals
 * `0.005·V`, so a B2 test cannot tell the two apart.
 */
const ABOVE_500: Readonly<Record<IpcSpacingColumn, { baseMm: number; slopeMmPerV: number }>> = {
  B1: { baseMm: 0.25, slopeMmPerV: 0.0025 },
  B2: { baseMm: 2.5, slopeMmPerV: 0.005 },
  B4: { baseMm: 0.8, slopeMmPerV: 0.00305 },
};

function bandValue(band: SpacingBand, column: IpcSpacingColumn): number {
  return column === "B1" ? band.b1Mm : column === "B2" ? band.b2Mm : band.b4Mm;
}

/** An `In*.Cu` layer is an internal conductor; `F.Cu` / `B.Cu` are external. */
export function isInternalCopperLayer(layer: PcbCopperLayerId): boolean {
  return layer !== "F.Cu" && layer !== "B.Cu";
}

/**
 * The conductor column for a pair on `layer` (§1.2). B4 is available only with
 * the user's `outerConductors: "coated"` declaration AND with neither item of
 * the pair exposed on that face: an exposed conductor is an uncoated one
 * whatever the board-level setting says (Astra run 0).
 */
export function spacingColumn(
  layer: PcbCopperLayerId,
  opts: { coated: boolean; exposed: boolean },
): IpcSpacingColumn {
  if (isInternalCopperLayer(layer)) return "B1";
  return opts.coated && !opts.exposed ? "B4" : "B2";
}

/**
 * Minimum conductor-to-conductor spacing (mm) for a voltage differential.
 *
 * THROWS on a non-finite or negative differential (§2, Astra run 1 #12): a
 * `NaN` used to resolve to the 2.5 mm band and pass an 800 V pair silently.
 * Every caller derives `diffV` from validated class intervals, so reaching this
 * with garbage is a programming error, not board data.
 */
export function ipc2221SpacingMm(
  diffV: number,
  column: IpcSpacingColumn,
): number {
  if (!Number.isFinite(diffV) || diffV < 0) {
    throw new Error(
      `ipc2221SpacingMm: differential must be finite and >= 0, got ${diffV}`,
    );
  }
  // Bands are STEPPED, never interpolated: `Δ <= maxV` selects the band, so
  // 15.5 V falls in 16–30 (§6.2). No geometric epsilon is borrowed.
  for (const band of BANDS) {
    if (diffV <= band.maxV) return bandValue(band, column);
  }
  const { baseMm, slopeMmPerV } = ABOVE_500[column];
  return baseMm + slopeMmPerV * (diffV - 500);
}

/**
 * IPC-2221 minimum trace width (mm) to carry `currentA` at `tempRiseC` on the
 * given copper weight (§6.3):
 *   area(mil²) = (I / (k·ΔT^0.44))^(1/0.725);  width(mil) = area / (oz × 1.378)
 * with `thickness = oz × 1.378 mil` (1 oz/ft² ≈ 35 µm ≈ 1.378 mil) and
 * 1 mil = 0.0254 mm exactly.
 *
 * THROWS on a non-positive or non-finite input (§5, Astra run 1 #9): returning
 * 0 mm for a zero rise or a zero copper weight made every trace pass. The
 * caller reports such a board as `DRC_RULE_INVALID` and judges no trace.
 *
 * THROWS again if the RESULT is not finite (Astra run 2): finite inputs can
 * overflow the formula — 1e225 A on 1.7e308 oz overflows both the area and the
 * thickness and answers `NaN`, which `below()` reads as "not narrower". The
 * magnitude limits in `voltage-term.ts` (`MAX_DECLARED_CURRENT_A` and its
 * twins) keep this unreachable from board data, so it is a programming-error
 * guard exactly like the input one, never a verdict.
 */
export function requiredTraceWidthMm(
  currentA: number,
  tempRiseC: number,
  copperOz: number,
  isInternal: boolean,
): number {
  for (const [name, v] of [
    ["currentA", currentA],
    ["tempRiseC", tempRiseC],
    ["copperOz", copperOz],
  ] as const) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(
        `requiredTraceWidthMm: ${name} must be finite and > 0, got ${v}`,
      );
    }
  }
  const k = isInternal ? 0.024 : 0.048;
  const areaMil2 = Math.pow(currentA / (k * Math.pow(tempRiseC, 0.44)), 1 / 0.725);
  const thicknessMil = copperOz * 1.378;
  const widthMil = areaMil2 / thicknessMil;
  const widthMm = widthMil * 0.0254; // mil → mm
  if (!Number.isFinite(widthMm)) {
    throw new Error(
      `requiredTraceWidthMm: ${currentA} A at ${tempRiseC} °C on ${copperOz} oz overflows the formula`,
    );
  }
  return widthMm;
}
