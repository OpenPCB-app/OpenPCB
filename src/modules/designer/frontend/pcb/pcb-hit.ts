import type { PcbPlacedPart, PcbPointMm } from "../../../../sdks";

function inverseTransform(
  worldDelta: PcbPointMm,
  rotationDeg: number,
  mirrored: boolean,
): PcbPointMm {
  const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360;
  let local: PcbPointMm;
  switch (r) {
    case 90:
      local = { x: worldDelta.y, y: -worldDelta.x };
      break;
    case 180:
      local = { x: -worldDelta.x, y: -worldDelta.y };
      break;
    case 270:
      local = { x: -worldDelta.y, y: worldDelta.x };
      break;
    default:
      local = { x: worldDelta.x, y: worldDelta.y };
  }
  return mirrored ? { x: -local.x, y: local.y } : local;
}

export function hitPlacement(
  placements: readonly PcbPlacedPart[],
  cursorMm: PcbPointMm,
): PcbPlacedPart | null {
  for (const placement of placements) {
    const bounds = placement.footprint.preview?.bounds;
    if (!bounds) continue;
    const delta = {
      x: cursorMm.x - placement.positionMm.x,
      y: cursorMm.y - placement.positionMm.y,
    };
    const local = inverseTransform(
      delta,
      placement.rotationDeg,
      placement.mirrored,
    );
    if (
      local.x >= bounds.minX &&
      local.x <= bounds.maxX &&
      local.y >= bounds.minY &&
      local.y <= bounds.maxY
    ) {
      return placement;
    }
  }
  return null;
}
