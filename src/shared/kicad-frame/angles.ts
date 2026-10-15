/**
 * KF1 §3.1.2 angle normalization (docs/pcb-hardening/KF1-kicad-frame-contract.md).
 *
 * Snap BEFORE the modulo: snapping after it would turn −1e-12 into 360.
 * Fractional angles are kept — never `Math.round` outside the 1e-9 snap.
 * Equivalent to KF1's `((d % 360) + 360) % 360`, but adds 360 only to negative
 * remainders: `(0.1 + 360) % 360` is 0.10000000000002274, not 0.1.
 */
const SNAP_EPS_DEG = 1e-9;

/** Normalize degrees to [0, 360); `−0` and `360` both map to `0`. */
export function norm360(deg: number): number {
  const nearest = Math.round(deg);
  const snapped = Math.abs(deg - nearest) < SNAP_EPS_DEG ? nearest : deg;
  const rem = snapped % 360;
  const wrapped = rem < 0 ? rem + 360 : rem;
  return wrapped === 360 || wrapped === 0 ? 0 : wrapped;
}
