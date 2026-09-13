/**
 * Arc-length parameterisation of a trace centreline — the coordinate every
 * junction and every path edge is expressed in (SI contract 14 §1, §2.3).
 * Prefix sums are computed once per trace so a position is exact and cheap in
 * both directions.
 */
import type { PcbPointMm } from "../../sdks/designer";
import { distance } from "../pcb-geometry/pcb-trace-geometry";
import type { JunctionInterval } from "./net-path-types";

export interface TraceArc {
  readonly points: readonly PcbPointMm[];
  /** `prefix[i]` = arc length from `points[0]` to `points[i]`. */
  readonly prefix: readonly number[];
  readonly lengthMm: number;
}

export function traceArc(points: readonly PcbPointMm[]): TraceArc {
  const prefix: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    prefix.push(prefix[i - 1]! + distance(points[i - 1]!, points[i]!));
  }
  return { points, prefix, lengthMm: prefix[prefix.length - 1] ?? 0 };
}

/** Arc length of a point known to lie on segment `segIndex`. */
export function arcOf(arc: TraceArc, segIndex: number, q: PcbPointMm): number {
  const base = arc.prefix[segIndex];
  const from = arc.points[segIndex];
  if (base === undefined || !from) return 0;
  return base + distance(from, q);
}

/** The centreline point at arc length `s` (clamped to the polyline). */
export function pointAtArc(arc: TraceArc, s: number): PcbPointMm {
  const last = arc.points.length - 1;
  if (last < 0) return { x: 0, y: 0 };
  if (s <= 0) return arc.points[0]!;
  if (s >= arc.lengthMm) return arc.points[last]!;
  let i = 0;
  while (i + 1 < last && arc.prefix[i + 1]! < s) i += 1;
  const a = arc.points[i]!;
  const b = arc.points[i + 1]!;
  const span = arc.prefix[i + 1]! - arc.prefix[i]!;
  const t = span === 0 ? 0 : (s - arc.prefix[i]!) / span;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Merge overlapping / abutting spans; exact comparisons, no tolerance. */
export function mergeIntervals(spans: JunctionInterval[]): JunctionInterval[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.s0 - b.s0 || a.s1 - b.s1);
  const out: JunctionInterval[] = [];
  let cur = { s0: sorted[0]!.s0, s1: sorted[0]!.s1 };
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!;
    if (next.s0 <= cur.s1) {
      if (next.s1 > cur.s1) cur = { s0: cur.s0, s1: next.s1 };
    } else {
      out.push(cur);
      cur = { s0: next.s0, s1: next.s1 };
    }
  }
  out.push(cur);
  return out;
}


/**
 * Largest `t ∈ [0, 1]` at which segment `a→b` is still within `reach` of `p`,
 * or null when no point of the segment is. Solves |a + t·(b−a) − p|² = reach².
 *
 * The ONE copy: the fold-back BOOLEAN (`connectivity-graph.ts`) and the
 * junction that locates the same fold-back both read it, so the two can never
 * disagree about which body segment the cap reaches.
 */
export function farthestWithinReach(
  p: PcbPointMm,
  a: PcbPointMm,
  b: PcbPointMm,
  reach: number,
): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - p.x;
  const fy = a.y - p.y;
  const qa = dx * dx + dy * dy;
  const qc = fx * fx + fy * fy - reach * reach;
  if (qa === 0) return qc <= 0 ? 0 : null;
  const qb = 2 * (fx * dx + fy * dy);
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const lo = Math.max(0, (-qb - root) / (2 * qa));
  const hi = Math.min(1, (-qb + root) / (2 * qa));
  return hi < lo ? null : hi;
}

/** Axis-aligned bounds of one polyline segment, inflated by `halo`. */
export function segmentBounds(
  a: PcbPointMm,
  b: PcbPointMm,
  halo: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(a.x, b.x) - halo,
    minY: Math.min(a.y, b.y) - halo,
    maxX: Math.max(a.x, b.x) + halo,
    maxY: Math.max(a.y, b.y) + halo,
  };
}
