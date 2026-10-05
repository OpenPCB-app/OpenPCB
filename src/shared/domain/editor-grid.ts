/** Application editing policy, independent of rendering-package visual defaults. */
export const SCHEMATIC_GRID_NM = 1_270_000;
export const SCHEMATIC_GRID_MM = SCHEMATIC_GRID_NM / 1_000_000;
export const PCB_GRID_MM = 0.25;
export const PCB_GRID_PRESETS_MM = [0.05, 0.1, 0.25, 0.5, 1, 1.27] as const;

export function snapCoordinateNm(value: number, gridNm: number): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(gridNm) || gridNm < 0)
    throw new Error(
      "Grid coordinates must be finite; pitch must be a non-negative integer in nm",
    );
  const result =
    gridNm > 0 ? Math.round(value / gridNm) * gridNm : Math.round(value);
  if (!Number.isSafeInteger(result))
    throw new Error("Coordinate exceeds integer-nanometre range");
  return result === 0 ? 0 : result;
}

export function snapPointNm(point: { x: number; y: number }, gridNm: number) {
  return {
    x: snapCoordinateNm(point.x, gridNm),
    y: snapCoordinateNm(point.y, gridNm),
  };
}

export function snapCoordinateMm(value: number, gridMm: number): number {
  return (
    snapCoordinateNm(value * 1_000_000, Math.round(gridMm * 1_000_000)) /
    1_000_000
  );
}

/** Snap the grabbed origin; keep relative offsets of an off-grid group unchanged. */
export function snappedMoveDeltaNm(
  origin: { x: number; y: number },
  delta: { x: number; y: number },
  gridNm: number,
) {
  if (delta.x === 0 && delta.y === 0) return delta;
  const target = snapPointNm(
    { x: origin.x + delta.x, y: origin.y + delta.y },
    gridNm,
  );
  return { x: target.x - origin.x, y: target.y - origin.y };
}
