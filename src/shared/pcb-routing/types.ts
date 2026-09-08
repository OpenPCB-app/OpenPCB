import type { PcbTraceSegmentMode } from "../../sdks/designer";

/**
 * Pure interactive PCB routing helpers (auto-finish, walkaround, meander).
 *
 * Units policy: all coordinates and paths are INTEGER NANOMETERS. Clearances
 * and widths enter in mm and are converted exactly once at module entry.
 * Deterministic: no Math.random / Date.now; caps are structural (expansion
 * counts), never wall-clock.
 */
export interface PointNm {
  x: number;
  y: number;
}

/**
 * Axis-aligned keep-out, already clearance-inflated by the obstacle builder.
 * `id` is stable per source object so walkaround hysteresis can recognize the
 * same cluster across pointer moves:
 *   "trace:<traceId>:<segIndex>" | "pad:<placementId>|<padNumber>" | "via:<viaId>"
 *     | "keepout:<keepoutId>"
 */
export interface ObstacleRectNm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
}

export type RouteMode = PcbTraceSegmentMode;

export const NM_PER_MM = 1_000_000;

export function mmToNm(mm: number): number {
  return Math.round(mm * NM_PER_MM);
}
