import type {
  PcbDrillSlot,
  PcbFreeHole,
  PcbFreePad,
  PcbPlacedPart,
  PcbPointMm,
  PcbVia,
} from "../../../sdks";
import { placementMirrorX } from "../../../sdks/designer/pcb-helpers";

/**
 * Centreline of an oblong drill: the routed stadium runs from `a` to `b` with
 * radius `widthMm / 2`. Same interpretation as the Excellon writer's `G85`
 * slot and the DRC's `slotCenterline` — the three must agree or the fab routes
 * something the board never cleared for.
 */
export interface DrillSlotCenterline {
  a: PcbPointMm;
  b: PcbPointMm;
  widthMm: number;
}

export interface DrillInstance {
  centerMm: PcbPointMm;
  radiusMm: number;
  /**
   * Present when the drill is a routed slot rather than a round hit. Consumers
   * that model a drill as a disc may ignore it; anything that must not overhang
   * the real hole (the pour's apertures) has to clear the whole stadium.
   */
  slot?: DrillSlotCenterline;
}

/**
 * The slot a `drillSlot` describes, or `null` for a round hole. `lengthMm` is
 * the overall long dimension along `angleDeg`, so the cap centres are inset by
 * `widthMm / 2`; `lengthMm <= widthMm` degenerates to a round hole.
 */
export function drillSlotCenterline(
  centerMm: PcbPointMm,
  drillSlot: PcbDrillSlot | null | undefined,
): DrillSlotCenterline | null {
  if (!drillSlot || drillSlot.lengthMm <= drillSlot.widthMm) return null;
  const half = (drillSlot.lengthMm - drillSlot.widthMm) / 2;
  const rad = (drillSlot.angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  return {
    a: { x: centerMm.x - dx, y: centerMm.y - dy },
    b: { x: centerMm.x + dx, y: centerMm.y + dy },
    widthMm: drillSlot.widthMm,
  };
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
      const slot = drillSlotCenterline(hole.centerMm, hole.drillSlot);
      out.push({
        centerMm: hole.centerMm,
        radiusMm: hole.drillMm / 2,
        ...(slot ? { slot } : {}),
      });
    }
  }
  for (const pad of freePads) {
    if (pad.drillMm !== null && pad.drillMm > 0) {
      const slot = drillSlotCenterline(pad.centerMm, pad.drillSlot);
      out.push({
        centerMm: pad.centerMm,
        radiusMm: pad.drillMm / 2,
        ...(slot ? { slot } : {}),
      });
    }
  }
  return out;
}
