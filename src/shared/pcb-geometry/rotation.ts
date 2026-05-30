// Placement rotation helpers — pure, mm/deg units. Extracted here so both the
// designer backend (commands/projection) and the shared pad-geometry module can
// share one definition without the frontend reaching into backend code.

/**
 * Snap an arbitrary rotation to the nearest cardinal angle the editor produces.
 * (KiCad imports may carry non-cardinal angles; pad geometry handles those with
 * a general rotation — see `transformPadCenterMm`.)
 */
export function normalizeRotationDeg(value: number): 0 | 90 | 180 | 270 {
  const normalized = (((Math.round(value / 90) * 90) % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return 0;
}
