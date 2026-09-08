// Pad geometry helpers — pure functions, mm units (PCB convention).
// Convention: a part's symbol pin `number` MUST equal its footprint pad `number`.
// Mismatches surface via warnings in net-pad-correlation, never silently dropped.

import type { FootprintRenderSourcePad } from "../rendering/types";
import type { PcbPlacedPart, PcbPointMm } from "../../sdks/designer";
import { placementMirrorX as sdkPlacementMirrorX } from "../../sdks/designer/pcb-helpers";
import { normalizeRotationDeg } from "./rotation";

export function transformPadCenterMm(
  localMm: PcbPointMm,
  partRotationDeg: number,
  mirrored: boolean,
): PcbPointMm {
  const mirroredX = mirrored ? -localMm.x : localMm.x;
  const mirroredY = localMm.y;

  // Cardinal rotations (the only ones the editor produces) keep their exact
  // integer transform. KiCad-imported boards can carry arbitrary angles; handle
  // those with a general rotation so pad geometry (and DRC) matches the placed
  // copper instead of snapping to the nearest 90°.
  const norm = ((partRotationDeg % 360) + 360) % 360;
  if (norm % 90 !== 0) {
    const r = (norm * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return {
      x: mirroredX * c - mirroredY * s,
      y: mirroredX * s + mirroredY * c,
    };
  }

  switch (normalizeRotationDeg(partRotationDeg)) {
    case 90:
      return { x: -mirroredY, y: mirroredX };
    case 180:
      return { x: -mirroredX, y: -mirroredY };
    case 270:
      return { x: mirroredY, y: -mirroredX };
    default:
      return { x: mirroredX, y: mirroredY };
  }
}

// Re-export the SDK helper so existing backend imports don't change.
export const placementMirrorX = sdkPlacementMirrorX;

export function padWorldPositionMm(
  placement: PcbPlacedPart,
  pad: Pick<FootprintRenderSourcePad, "centerMm">,
): PcbPointMm {
  const transformed = transformPadCenterMm(
    pad.centerMm,
    placement.rotationDeg,
    placementMirrorX(placement),
  );
  return {
    x: placement.positionMm.x + transformed.x,
    y: placement.positionMm.y + transformed.y,
  };
}

export function placementPads(
  placement: PcbPlacedPart,
): readonly FootprintRenderSourcePad[] {
  return placement.footprint.preview?.pads ?? [];
}

/**
 * World-space axis-aligned half extents of a pad's bounding box. Cardinal
 * placement rotations swap width/height exactly; arbitrary (KiCad-import)
 * angles get the rotated-rect AABB, which slightly overestimates at the
 * corners. Mirroring never changes extents. Matches the AABB approximation of
 * the frontend pad hit-test (pcb-hit.ts hitPad). Used by the routing obstacle
 * map; connectivity uses the exact pad ring (`pcb-connectivity/`), not an AABB.
 */
export function padWorldHalfExtentsMm(
  placement: PcbPlacedPart,
  pad: Pick<FootprintRenderSourcePad, "widthMm" | "heightMm">,
): { x: number; y: number } {
  const hw = pad.widthMm / 2;
  const hh = pad.heightMm / 2;
  const norm = ((placement.rotationDeg % 360) + 360) % 360;
  if (norm % 90 !== 0) {
    const r = (norm * Math.PI) / 180;
    const c = Math.abs(Math.cos(r));
    const s = Math.abs(Math.sin(r));
    return { x: hw * c + hh * s, y: hw * s + hh * c };
  }
  const swap =
    normalizeRotationDeg(placement.rotationDeg) === 90 ||
    normalizeRotationDeg(placement.rotationDeg) === 270;
  return { x: swap ? hh : hw, y: swap ? hw : hh };
}
