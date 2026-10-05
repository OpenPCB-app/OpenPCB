import {
  SCHEMATIC_GRID_NM,
  snapPointNm,
} from "../../../../shared/domain/editor-grid";

export function duplicateSchematicPositionNm(
  point: { x: number; y: number },
  snap: boolean,
) {
  return snapPointNm(
    { x: point.x + 2 * SCHEMATIC_GRID_NM, y: point.y + 2 * SCHEMATIC_GRID_NM },
    snap ? SCHEMATIC_GRID_NM : 0,
  );
}

/** Gesture-only axis alignment; never a normalization pass over stored geometry. */
export function snapWireWaypointNm(
  cursor: { x: number; y: number },
  previous: { x: number; y: number },
  gridNm: number,
  pixelsPerMm: number,
): { x: number; y: number } {
  const tolerance = Math.min(
    50_000,
    Math.round(3_000_000 / Math.max(1, pixelsPerMm)),
  );
  const snapped = snapPointNm(cursor, gridNm);
  return {
    x: Math.abs(cursor.x - previous.x) <= tolerance ? previous.x : snapped.x,
    y: Math.abs(cursor.y - previous.y) <= tolerance ? previous.y : snapped.y,
  };
}
