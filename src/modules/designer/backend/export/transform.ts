import type {
  PcbPlacedPart,
  PcbPointMm,
} from "../../../../sdks/designer/types";
import { placementMirrorX } from "../../../../sdks/designer/pcb-helpers";

/**
 * Rotate a local point about the origin by `rotationDeg` (CCW), optionally
 * mirroring across the X axis first. Snaps the rotation to the nearest 90°
 * step — placements are constrained to right-angle rotations everywhere
 * else in the codebase (see `pcb-drills.ts:transformLocal`).
 */
export function rotateLocal(
  localMm: PcbPointMm,
  rotationDeg: number,
  mirrored: boolean,
): PcbPointMm {
  const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360;
  const mx = mirrored ? -localMm.x : localMm.x;
  switch (r) {
    case 90:
      return { x: -localMm.y, y: mx };
    case 180:
      return { x: -mx, y: -localMm.y };
    case 270:
      return { x: localMm.y, y: -mx };
    default:
      return { x: mx, y: localMm.y };
  }
}

/** Project a footprint-local point into board coordinates. */
export function projectLocal(
  placement: PcbPlacedPart,
  localMm: PcbPointMm,
): PcbPointMm {
  const mirrored = placementMirrorX(placement);
  const r = rotateLocal(localMm, placement.rotationDeg, mirrored);
  return {
    x: placement.positionMm.x + r.x,
    y: placement.positionMm.y + r.y,
  };
}

/**
 * Effective pad rotation in board coordinates: footprint rotation +
 * pad local rotation, mirror-adjusted. Used by rectangular/oblong
 * aperture flashes that need to rotate the *aperture* rather than the
 * point (since Gerber apertures are axis-aligned).
 *
 * For circular pads rotation is irrelevant. For non-axis-aligned
 * rectangular pads on rotated placements, the cleanest spec-compliant
 * approach is an aperture macro with the rotation baked in; v0 picks
 * the simpler convention that placement rotation is in 90° steps so
 * w/h can be swapped without macros.
 */
export function effectivePadRotationDeg(
  placement: PcbPlacedPart,
  padRotationDeg: number,
): number {
  const mirrored = placementMirrorX(placement);
  const base = (placement.rotationDeg ?? 0) + (padRotationDeg ?? 0);
  const mirroredAngle = mirrored ? -base : base;
  return ((mirroredAngle % 360) + 360) % 360;
}

/**
 * Decide whether a rotated rect/oblong aperture needs its width/height
 * swapped. True for 90° and 270° rotations (snapped to nearest 90°).
 */
export function isOrthogonalSwap(rotationDeg: number): boolean {
  const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360;
  return r === 90 || r === 270;
}
