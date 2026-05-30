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
  // Mirror X then rotate CCW by the EXACT angle — must match
  // `applyPlacementTransform` (copper-fill-geometry.ts) and the 3D mirror
  // formula. The previous `Math.round(rotationDeg/90)*90` snapped every
  // placement to an orthogonal angle, misplacing drills on parts rotated to
  // e.g. 45°. Orthogonal angles are unchanged (cos/sin collapse to ±1/0).
  const mx = mirrored ? -localMm.x : localMm.x;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cos * mx - sin * localMm.y,
    y: sin * mx + cos * localMm.y,
  };
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
