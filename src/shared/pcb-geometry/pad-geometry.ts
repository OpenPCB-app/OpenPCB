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
