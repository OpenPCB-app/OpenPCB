/**
 * IPC-2221 conductor spacing (Table 6-1) and the IPC-2221 current/width
 * formula. Numeric values are transcribed from the secondary sources cited in
 * DRC_AUDIT_REPORT.md §8 (smpspowersupply.com, sfcircuits.com, ema-eda.com,
 * corroborated ≥2×); IPC-2221 itself is paywalled. Treat as secondary.
 *
 * Columns: B1 = internal conductors; B2 = external uncoated, ≤ 3050 m. Higher
 * voltages between conductors demand wider spacing (arc-over + creepage).
 */

interface SpacingBand {
  /** Inclusive upper bound of peak voltage (V) for this band. */
  maxV: number;
  b1Mm: number; // internal
  b2Mm: number; // external uncoated, sea level
}

// Table 6-1 (voltage between conductors, DC or AC peak). Values in mm.
const BANDS: SpacingBand[] = [
  { maxV: 15, b1Mm: 0.05, b2Mm: 0.1 },
  { maxV: 30, b1Mm: 0.05, b2Mm: 0.1 },
  { maxV: 50, b1Mm: 0.1, b2Mm: 0.6 },
  { maxV: 100, b1Mm: 0.1, b2Mm: 0.6 },
  { maxV: 150, b1Mm: 0.2, b2Mm: 0.6 },
  { maxV: 170, b1Mm: 0.2, b2Mm: 1.25 },
  { maxV: 250, b1Mm: 0.2, b2Mm: 1.25 },
  { maxV: 300, b1Mm: 0.2, b2Mm: 1.25 },
  { maxV: 500, b1Mm: 0.25, b2Mm: 2.5 },
];

/**
 * Minimum conductor-to-conductor spacing (mm) for the voltage difference and
 * layer column. Above 500 V, spacing grows per-volt (B2: 2.5 mm + 0.005 mm/V;
 * B1: 0.25 mm + 0.0025 mm/V over 500 V).
 */
export function ipc2221SpacingMm(
  voltageDiff: number,
  column: "B1" | "B2",
): number {
  const v = Math.abs(voltageDiff);
  if (v > 500) {
    return column === "B1"
      ? 0.25 + 0.0025 * (v - 500)
      : 2.5 + 0.005 * (v - 500);
  }
  for (const band of BANDS) {
    if (v <= band.maxV) return column === "B1" ? band.b1Mm : band.b2Mm;
  }
  return column === "B1" ? 0.25 : 2.5;
}

/**
 * IPC-2221 minimum trace width (mm) to carry `currentA` at `tempRiseC` on the
 * given copper weight. Constants per .claude/skills/eda-standards/references/
 * trace-width.md (external k=0.048, internal k=0.024, b=0.44, c=0.725);
 * thickness = copperOz × 1.378 mil (1 oz ≈ 35 µm ≈ 1.378 mil).
 *   area(mil²) = (I / (k·ΔT^b))^(1/c);  width(mil) = area / (oz × 1.378)
 */
export function requiredTraceWidthMm(
  currentA: number,
  tempRiseC: number,
  copperOz: number,
  isInternal: boolean,
): number {
  if (currentA <= 0 || tempRiseC <= 0 || copperOz <= 0) return 0;
  const k = isInternal ? 0.024 : 0.048;
  const areaMil2 = Math.pow(currentA / (k * Math.pow(tempRiseC, 0.44)), 1 / 0.725);
  const thicknessMil = copperOz * 1.378;
  const widthMil = areaMil2 / thicknessMil;
  return widthMil * 0.0254; // mil → mm
}
