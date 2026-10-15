import { snapCoordinateMm } from "../../../../shared/domain/editor-grid";
import type { InteractionEvent } from "../../../../shared/frontend/canvas/interaction/types";
import { eventToMmRaw } from "../../../../shared/frontend/canvas/tools/tool-utils";
import type { PointMm } from "../../../../shared/rendering/types";

/** The snap inputs both library editor stores carry. */
export interface EditorSnapState {
  gridSizeMm: number;
  snapEnabled: boolean;
}

/**
 * The designer's grid policy (shared/domain/editor-grid) for the library
 * editors: snapping follows the snap setting, never grid visibility, and an
 * unsnapped point still lands on an integer nanometre.
 */
export function snapEditorPointMm(
  point: PointMm,
  state: EditorSnapState,
): PointMm {
  const pitchMm = state.snapEnabled ? state.gridSizeMm : 0;
  return {
    x: snapCoordinateMm(point.x, pitchMm),
    y: snapCoordinateMm(point.y, pitchMm),
  };
}

export function eventToEditorMm(
  event: InteractionEvent,
  state: EditorSnapState,
): PointMm {
  return snapEditorPointMm(eventToMmRaw(event), state);
}
