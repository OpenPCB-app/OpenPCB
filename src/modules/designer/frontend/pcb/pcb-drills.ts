import type {
  PcbFreeHole,
  PcbFreePad,
  PcbPlacedPart,
  PcbPointMm,
  PcbVia,
} from "../../../../sdks";
import { placementMirrorX } from "../../../../sdks/designer/pcb-helpers";

export interface DrillInstance {
  centerMm: PcbPointMm;
  radiusMm: number;
}

function transformLocal(
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

/**
 * Unified drill list across every drilled object on the board:
 * - Through vias (`via.drillMm`)
 * - Plated/unplated pad drills on every placed footprint
 * - Free-standing mechanical holes (F5 — mounting / tooling)
 *
 * Single source of truth consumed by:
 *  - `DrillLayer` (lime outline rings)
 *  - `BoardFill` (`ShapeGeometry.holes[]` cutouts in the substrate)
 *  - Future Gerber/Excellon export
 */
export function collectDrills(
  vias: ReadonlyArray<PcbVia>,
  placements: ReadonlyArray<PcbPlacedPart>,
  freeHoles: ReadonlyArray<PcbFreeHole> = [],
  freePads: ReadonlyArray<PcbFreePad> = [],
): DrillInstance[] {
  const out: DrillInstance[] = [];
  for (const via of vias) {
    if (via.drillMm > 0) {
      out.push({ centerMm: via.centerMm, radiusMm: via.drillMm / 2 });
    }
  }
  for (const placement of placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    const mirrored = placementMirrorX(placement);
    for (const pad of pads) {
      const drill = pad.drillDiameterMm;
      if (!drill || drill <= 0) continue;
      const offset = transformLocal(
        pad.centerMm,
        placement.rotationDeg,
        mirrored,
      );
      out.push({
        centerMm: {
          x: placement.positionMm.x + offset.x,
          y: placement.positionMm.y + offset.y,
        },
        radiusMm: drill / 2,
      });
    }
  }
  for (const hole of freeHoles) {
    if (hole.drillMm > 0) {
      out.push({ centerMm: hole.centerMm, radiusMm: hole.drillMm / 2 });
    }
  }
  for (const pad of freePads) {
    if (pad.drillMm !== null && pad.drillMm > 0) {
      out.push({ centerMm: pad.centerMm, radiusMm: pad.drillMm / 2 });
    }
  }
  return out;
}
