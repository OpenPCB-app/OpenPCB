import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type { PointMm } from "../../../../../../shared/rendering/types";
import { snapToGrid } from "../useSymbolEditorStore";

const NM_PER_MM = 1_000_000;

/** Convert InteractionEvent world point (nm) to scene mm, snapped to grid. */
export function eventToMm(event: InteractionEvent, gridMm: number): PointMm {
  return {
    x: snapToGrid(event.worldPoint.x / NM_PER_MM, gridMm),
    y: snapToGrid(event.worldPoint.y / NM_PER_MM, gridMm),
  };
}

/** Unsnapped mm from event. */
export function eventToMmRaw(event: InteractionEvent): PointMm {
  return {
    x: event.worldPoint.x / NM_PER_MM,
    y: event.worldPoint.y / NM_PER_MM,
  };
}
