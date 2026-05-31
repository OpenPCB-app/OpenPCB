/**
 * Symbol body extent for schematic auto-placement & wire obstacles.
 *
 * Returns the half-width / half-height of a part's drawn body around its
 * origin, in integer nanometers. The extent is symmetric (max absolute reach
 * on each axis) so the AABB `origin ± (halfW, halfH)` always *contains* the
 * real body regardless of how off-centre the symbol bounds are — that keeps the
 * placement overlap guarantee simple and conservative.
 *
 * Deterministic: a single mm→nm round at the boundary, integer math thereafter.
 */
import { SCHEMATIC_GRID_NM } from "@openpcb/rendering-core";
import type { DesignerPlacedPart } from "../../../../sdks/designer/types";

export interface BodyExtentNm {
  halfW: number;
  halfH: number;
}

/** Single, deterministic mm→nm conversion (1 mm = 1e6 nm). */
function mmToNm(mm: number): number {
  return Math.round(mm * 1_000_000);
}

/**
 * Half-extents around the part origin, accounting for 90/270 rotation (which
 * swaps the axes). Falls back to the pin AABB when the symbol carries no
 * bounds, and never returns less than one grid step so a point-like symbol
 * still reserves a real cell.
 */
export function partBodyExtentNm(part: DesignerPlacedPart): BodyExtentNm {
  const bounds = part.symbol.preview.bounds;
  let halfW = 0;
  let halfH = 0;
  if (bounds) {
    halfW = Math.max(
      Math.abs(mmToNm(bounds.minX)),
      Math.abs(mmToNm(bounds.maxX)),
    );
    halfH = Math.max(
      Math.abs(mmToNm(bounds.minY)),
      Math.abs(mmToNm(bounds.maxY)),
    );
  } else {
    for (const pin of part.pins) {
      halfW = Math.max(halfW, Math.abs(pin.localPositionNm.x));
      halfH = Math.max(halfH, Math.abs(pin.localPositionNm.y));
    }
  }
  const rot = ((part.rotationDeg % 360) + 360) % 360;
  if (rot === 90 || rot === 270) {
    const swap = halfW;
    halfW = halfH;
    halfH = swap;
  }
  const min = SCHEMATIC_GRID_NM;
  return { halfW: Math.max(halfW, min), halfH: Math.max(halfH, min) };
}
