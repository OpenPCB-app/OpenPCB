/**
 * WHERE a pour island touches a trace (SI contract 14 §2.6).
 *
 * The pour rule is not "how many nodes does this island reach" — every trace
 * carries at least two cut nodes, so that question answers "bypassed" for any
 * island that so much as grazes a routed trace. What decides a bypass is how
 * many SEPARATE places the island touches the measured path: an island lying
 * along one continuous stretch is a plane stitched at one place, while two
 * separated stretches are a second conductor in parallel with the copper
 * between them.
 *
 * Membership stays S1's answer (`memberKeys`); this file only locates it.
 */
import type { PcbPointMm } from "../../sdks/designer";
import { segmentSublevelInterval } from "../pcb-geometry/segment-sublevel";
import type { JunctionInterval } from "./net-path-types";
import { pointToIslandDistance } from "./touch";
import { mergeIntervals, segmentBounds, type TraceArc } from "./trace-arc";

/**
 * Parameter `t ∈ [0, 1]` at which `a→b` crosses the line of `u→v` inside both
 * segments, or null for a parallel / non-crossing pair. Collinear overlap needs
 * no parameter: the proximity band below already covers it.
 */
function crossParam(
  a: PcbPointMm,
  b: PcbPointMm,
  u: PcbPointMm,
  v: PcbPointMm,
): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = v.x - u.x;
  const sy = v.y - u.y;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return null;
  const qx = u.x - a.x;
  const qy = u.y - a.y;
  const t = (qx * sy - qy * sx) / denom;
  const w = (qx * ry - qy * rx) / denom;
  if (t < 0 || t > 1 || w < 0 || w > 1) return null;
  return t;
}

/**
 * Arc-length spans of `arc` between `fromMm` and `toMm` where a trace of half
 * width `halfWidthMm` has copper on the island: within `hw + eps` of any ring
 * edge, or with its centreline inside the filled region.
 */
export function islandSpansOnTrace(
  arc: TraceArc,
  halfWidthMm: number,
  rings: ReadonlyArray<ReadonlyArray<PcbPointMm>>,
  epsMm: number,
  fromMm: number,
  toMm: number,
): JunctionInterval[] {
  const radius = halfWidthMm + epsMm;
  const outer = rings[0];
  if (!outer || outer.length < 3) return [];
  let islandMinX = Infinity;
  let islandMinY = Infinity;
  let islandMaxX = -Infinity;
  let islandMaxY = -Infinity;
  for (const v of outer) {
    if (v.x < islandMinX) islandMinX = v.x;
    if (v.y < islandMinY) islandMinY = v.y;
    if (v.x > islandMaxX) islandMaxX = v.x;
    if (v.y > islandMaxY) islandMaxY = v.y;
  }
  const spans: JunctionInterval[] = [];
  for (let i = 0; i + 1 < arc.points.length; i += 1) {
    const a = arc.points[i]!;
    const b = arc.points[i + 1]!;
    if (a.x === b.x && a.y === b.y) continue;
    const base = arc.prefix[i]!;
    const length = arc.prefix[i + 1]! - base;
    if (base > toMm || base + length < fromMm) continue;
    const box = segmentBounds(a, b, radius);
    if (
      box.minX > islandMaxX ||
      box.maxX < islandMinX ||
      box.minY > islandMaxY ||
      box.maxY < islandMinY
    ) {
      continue;
    }
    const cuts: number[] = [0, length];
    for (const ring of rings) {
      for (let k = 0; k < ring.length; k += 1) {
        const u = ring[k]!;
        const v = ring[(k + 1) % ring.length]!;
        if (
          Math.min(u.x, v.x) > box.maxX ||
          Math.max(u.x, v.x) < box.minX ||
          Math.min(u.y, v.y) > box.maxY ||
          Math.max(u.y, v.y) < box.minY
        ) {
          continue;
        }
        const band = segmentSublevelInterval(
          a,
          b,
          { kind: "segment", a: u, b: v },
          radius,
        );
        if (band) spans.push({ s0: base + band.s0, s1: base + band.s1 });
        const t = crossParam(a, b, u, v);
        if (t !== null) cuts.push(t * length);
      }
    }
    // Between two consecutive boundary crossings the centreline is wholly in
    // or wholly out of the filled region, so one midpoint decides the span.
    // A segment with NO crossings is classified too: one wholly enclosed by the
    // island has none, and skipping it split a single continuous contact in two
    // the moment a collinear vertex subdivided the run.
    cuts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < cuts.length; k += 1) {
      const lo = cuts[k]!;
      const hi = cuts[k + 1]!;
      if (hi <= lo) continue;
      const mid = (lo + hi) / 2;
      const t = mid / length;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (pointToIslandDistance(p, rings) === 0) {
        spans.push({ s0: base + lo, s1: base + hi });
      }
    }
  }
  const clipped: JunctionInterval[] = [];
  for (const span of mergeIntervals(spans)) {
    const s0 = Math.max(span.s0, fromMm);
    const s1 = Math.min(span.s1, toMm);
    if (s0 <= s1) clipped.push({ s0, s1 });
  }
  return clipped;
}
