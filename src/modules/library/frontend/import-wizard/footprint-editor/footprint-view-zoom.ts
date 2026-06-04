import { DEFAULT_PCB_ZOOM } from "../../../../../shared/frontend/canvas/defaults";

/**
 * Live px-per-mm zoom of the footprint editor canvas, updated each rendered
 * frame by the `<ZoomTracker>` scene child. Read imperatively by the tools
 * (which live outside React) to size screen-pixel hit/snap tolerances —
 * mirrors the PCB designer's `drcZoomRef` gotcha (`camera.zoom` lags).
 */
export const footprintViewZoom = { current: DEFAULT_PCB_ZOOM };

/** Convert a screen-pixel tolerance to world mm at the current zoom, clamped. */
export function pxToMm(px: number, min = 0.2, max = 4): number {
  const mm = px / Math.max(footprintViewZoom.current, 0.0001);
  return Math.min(Math.max(mm, min), max);
}
