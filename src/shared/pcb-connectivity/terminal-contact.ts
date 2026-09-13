/**
 * Terminal attachment and interior clipping (SI contract 14 §2.2).
 *
 * A terminal's copper is a convex core ⊕ a disc (a pad's `rounded`, a via's
 * barrel). Against it a trace centreline has two sublevel sets, each ONE closed
 * interval per segment: `INSIDE` (inside the terminal's copper — clipped out of
 * the path, both boundaries attached) and `TOUCH` (the S1 contact condition —
 * used only when the centreline never enters).
 */
import type { PcbPointMm } from "../../sdks/designer";
import {
  pointInPolygon,
  pointToPolygonDistance,
} from "../pcb-geometry/pcb-clearance-geometry";
import {
  distance,
  projectPointToSegment,
  segmentClosestPoints,
} from "../pcb-geometry/pcb-trace-geometry";
import { roundedPoint } from "../pcb-geometry/rounded-shape";
import type { RoundedShape } from "../pcb-geometry/rounded-shape-types";
import {
  segmentSublevelInterval,
  type ConvexTarget,
} from "../pcb-geometry/segment-sublevel";
import type { PadCopperItem, ViaCopperItem } from "./copper-items";
import type { JunctionInterval } from "./net-path-types";
import { arcOf, mergeIntervals, pointAtArc, type TraceArc } from "./trace-arc";

/** The shared polyline primitives take mutable arrays and never mutate them. */
const asPath = (pts: readonly PcbPointMm[]): PcbPointMm[] => pts as PcbPointMm[];

// ---------------------------------------------------------------------------
// Terminal contacts (§2.2)
// ---------------------------------------------------------------------------

export function terminalShape(item: PadCopperItem | ViaCopperItem): RoundedShape {
  return item.kind === "pad"
    ? item.rounded
    : roundedPoint(item.center, item.radiusMm);
}

export function convexTarget(core: readonly PcbPointMm[]): ConvexTarget | null {
  if (core.length === 0) return null;
  if (core.length === 1) return { kind: "point", p: core[0]! };
  if (core.length === 2) return { kind: "segment", a: core[0]!, b: core[1]! };
  return { kind: "convex", points: asPath(core) };
}

/** Closed-form sublevel spans of the whole centreline, in global arc length. */
export function centrelineSpans(
  arc: TraceArc,
  target: ConvexTarget,
  radiusMm: number,
): JunctionInterval[] {
  const spans: JunctionInterval[] = [];
  for (let i = 0; i + 1 < arc.points.length; i += 1) {
    const a = arc.points[i]!;
    const b = arc.points[i + 1]!;
    if (a.x === b.x && a.y === b.y) continue;
    const span = segmentSublevelInterval(a, b, target, radiusMm);
    if (!span) continue;
    const base = arc.prefix[i]!;
    spans.push({ s0: base + span.s0, s1: base + span.s1 });
  }
  return mergeIntervals(spans);
}

/** Closest point of segment `ab` to a convex core, exact for every arity. */
function closestOnSegmentToCore(
  a: PcbPointMm,
  b: PcbPointMm,
  core: readonly PcbPointMm[],
): { distanceMm: number; point: PcbPointMm } {
  if (core.length === 1) {
    const proj = projectPointToSegment(core[0]!, a, b);
    return { distanceMm: proj.distance, point: { x: proj.x, y: proj.y } };
  }
  if (core.length === 2) {
    const cp = segmentClosestPoints(a, b, core[0]!, core[1]!);
    return { distanceMm: cp.distance, point: cp.a };
  }
  if (pointInPolygon(a, core)) return { distanceMm: 0, point: a };
  if (pointInPolygon(b, core)) return { distanceMm: 0, point: b };
  let best = { distanceMm: Infinity, point: a };
  for (let i = 0; i < core.length; i += 1) {
    const cp = segmentClosestPoints(
      a,
      b,
      core[i]!,
      core[(i + 1) % core.length]!,
    );
    if (cp.distance < best.distanceMm) {
      best = { distanceMm: cp.distance, point: cp.a };
    }
  }
  return best;
}

/** Distance from a point to a convex core, the arity dispatch of the kernel. */
function coreDistance(p: PcbPointMm, core: readonly PcbPointMm[]): number {
  if (core.length === 1) return distance(p, core[0]!);
  if (core.length === 2) {
    return projectPointToSegment(p, core[0]!, core[1]!).distance;
  }
  return pointToPolygonDistance(p, core);
}

/**
 * Where a trace attaches to a terminal inside ONE contact component whose
 * copper the centreline never enters (§2.2): the point of minimum centreline
 * distance within that component, or the MIDPOINT of its `TOUCH` span when the
 * distance is constant over it — detected by exact equality, so there is no
 * parallelism epsilon here either.
 *
 * The search is restricted to the span. A trace that passes the SAME terminal
 * twice has two components, and a global minimum would answer for both of them
 * with one parameter — losing the second contact entirely.
 */
export function attachParameter(
  arc: TraceArc,
  core: readonly PcbPointMm[],
  span: JunctionInterval,
): number {
  let bestDistance = Infinity;
  let bestS = (span.s0 + span.s1) / 2;
  for (let i = 0; i + 1 < arc.points.length; i += 1) {
    const from = arc.prefix[i]!;
    const to = arc.prefix[i + 1]!;
    if (to <= span.s0 || from >= span.s1) continue;
    const lo = Math.max(from, span.s0);
    const hi = Math.min(to, span.s1);
    if (hi <= lo) continue;
    const a = lo === from ? arc.points[i]! : pointAtArc(arc, lo);
    const b = hi === to ? arc.points[i + 1]! : pointAtArc(arc, hi);
    if (a.x === b.x && a.y === b.y) continue;
    const near = closestOnSegmentToCore(a, b, core);
    if (near.distanceMm < bestDistance) {
      bestDistance = near.distanceMm;
      bestS = lo + distance(a, near.point);
    }
  }
  const mid = (span.s0 + span.s1) / 2;
  return coreDistance(pointAtArc(arc, mid), core) <= bestDistance ? mid : bestS;
}
