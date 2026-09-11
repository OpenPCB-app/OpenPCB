/**
 * Gerber X2 coordinate format helpers.
 *
 * Format spec: `%FSLAX46Y46*%`
 *   - L: leading zeros omitted
 *   - A: absolute coordinates
 *   - X4.6 / Y4.6: 4 integer digits + 6 decimal digits per axis
 *
 * Units: `%MOMM*%` — all coordinates in millimeters.
 *
 * Practical effect: 1 mm = 1_000_000 in the emitted integer. Max
 * representable extent before format overflow is ±9999.999999 mm,
 * far beyond any real board.
 */

const COORD_SCALE = 1_000_000;

/**
 * Format a millimeter value as a Gerber X2 coordinate integer string.
 * Negative values keep their leading minus sign. Leading zeros are
 * already omitted by `toString()`; the format spec compensates.
 */
export function gerberCoord(mm: number): string {
  return gerberNm(mm).toString();
}

/**
 * The integer nanometre a millimetre value is emitted as — the SAME rounding
 * {@link gerberCoord} applies, exposed so a caller that must subtract two
 * emitted coordinates (Gerber arc `I`/`J` offsets, exact-geometry contract 12
 * §6) does the subtraction on the quantised integers rather than in mm. A
 * millimetre difference rounded afterwards would not reconstruct the centre the
 * neighbouring arc piece was measured from.
 */
export function gerberNm(mm: number): number {
  if (!Number.isFinite(mm)) {
    throw new Error(`gerberCoord: non-finite value ${mm}`);
  }
  return Math.round(mm * COORD_SCALE);
}

/**
 * Format a millimeter scalar as a Gerber decimal number (up to 6 decimals,
 * trailing zeros trimmed). Used for both aperture dimensions (always
 * non-negative — width / height / radius) and aperture-macro primitive
 * parameters (which include signed center coordinates), so negatives are
 * preserved verbatim.
 */
export function gerberDim(mm: number): string {
  if (!Number.isFinite(mm)) {
    throw new Error(`gerberDim: non-finite value ${mm}`);
  }
  // Six decimals is more than enough for sub-micron precision and
  // matches the coordinate format's resolution.
  const sign = mm < 0 ? "-" : "";
  const fixed = Math.abs(mm).toFixed(6);
  // Trim trailing zeros and trailing dot.
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  // A value that rounds to 0 has no sign.
  return trimmed === "0" ? "0" : `${sign}${trimmed}`;
}

/**
 * Format an X/Y pair as a Gerber coordinate operand (no leading space).
 * Always emits both axes for clarity; modal-coordinate optimization
 * (omitting unchanged axes) is a future micro-optimization.
 */
export function xyOperand(xMm: number, yMm: number): string {
  return `X${gerberCoord(xMm)}Y${gerberCoord(yMm)}`;
}

/** {@link xyOperand} for a point already quantised by {@link gerberNm}. */
export function xyOperandNm(xNm: number, yNm: number): string {
  return `X${xNm}Y${yNm}`;
}

/**
 * The `I`/`J` operand of a circular interpolation: the SIGNED offset from the
 * arc piece's start point to the arc centre, in the same X4.6 integer grid as
 * the coordinates (multi-quadrant `G75` reading).
 */
export function ijOperandNm(iNm: number, jNm: number): string {
  return `I${iNm}J${jNm}`;
}
