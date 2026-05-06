// Pad geometry helpers — pure functions, mm units (PCB convention).
// Convention: a part's symbol pin `number` MUST equal its footprint pad `number`.
// Mismatches surface via warnings in net-pad-correlation, never silently dropped.

import type { FootprintRenderSourcePad } from "../../../../shared/rendering/types";
import type { PcbPlacedPart, PcbPointMm } from "../../../../sdks/designer";
import { normalizeRotationDeg } from "../commands/place-part";

export function transformPadCenterMm(
  localMm: PcbPointMm,
  partRotationDeg: number,
  mirrored: boolean,
): PcbPointMm {
  const rotation = normalizeRotationDeg(partRotationDeg);
  const mirroredX = mirrored ? -localMm.x : localMm.x;
  const mirroredY = localMm.y;

  switch (rotation) {
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

export function padWorldPositionMm(
  placement: PcbPlacedPart,
  pad: Pick<FootprintRenderSourcePad, "centerMm">,
): PcbPointMm {
  const transformed = transformPadCenterMm(
    pad.centerMm,
    placement.rotationDeg,
    placement.mirrored,
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
