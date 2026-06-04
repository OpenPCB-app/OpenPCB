import { DEFAULT_SCHEMATIC_ZOOM } from "../../../../../shared/frontend/canvas/defaults";

/**
 * Live px-per-mm zoom of the symbol editor canvas, updated each rendered frame
 * by the `<ZoomTracker>` scene child. Read imperatively by the tools (outside
 * React) to size screen-pixel hit/snap tolerances.
 */
export const symbolViewZoom = { current: DEFAULT_SCHEMATIC_ZOOM };

/** Convert a screen-pixel tolerance to world mm at the current zoom, clamped. */
export function pxToMm(px: number, min = 0.3, max = 6): number {
  const mm = px / Math.max(symbolViewZoom.current, 0.0001);
  return Math.min(Math.max(mm, min), max);
}
