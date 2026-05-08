import type { BoundsMm, PointMm } from "../../../../shared/rendering/types";

export type MarqueeMode = "window" | "crossing";

export interface MarqueeSession<TSelection> {
  readonly startMm: PointMm;
  readonly currentMm: PointMm;
  readonly additive: boolean;
  readonly baseSelection: TSelection;
  readonly mode: MarqueeMode;
}

export interface MarqueeRect {
  readonly bounds: BoundsMm;
  readonly mode: MarqueeMode;
}

export const MARQUEE_WINDOW_COLOR = "#60a5fa";
export const MARQUEE_CROSSING_COLOR = "#4ade80";

export function colorForMode(mode: MarqueeMode): string {
  return mode === "window" ? MARQUEE_WINDOW_COLOR : MARQUEE_CROSSING_COLOR;
}

export function modeFromDirection(
  start: PointMm,
  current: PointMm,
): MarqueeMode {
  return current.x >= start.x ? "window" : "crossing";
}
