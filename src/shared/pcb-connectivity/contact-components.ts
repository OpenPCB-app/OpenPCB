/**
 * Contact components: WHICH touching segment pairs are one physical join, and
 * where that join sits (SI contract 14 §1).
 *
 * Two pairs belong to one component when their contact SPANS overlap on BOTH
 * traces. Index adjacency was tried and is wrong: a narrow vee whose limbs
 * cross one trace a tenth of a millimetre apart has those crossings on
 * ADJACENT limb segments, yet they are two joins fifty millimetres apart along
 * the vee, and merging them hid the loop the vee closes.
 */
import type { PcbPointMm } from "../../sdks/designer";
import {
  projectPointToSegment,
  segmentClosestPoints,
  segmentToSegmentDistance,
} from "../pcb-geometry/pcb-trace-geometry";
import { segmentSublevelInterval } from "../pcb-geometry/segment-sublevel";
import type { JunctionInterval } from "./net-path-types";
import { arcOf, pointAtArc, segmentBounds, traceArc, type TraceArc } from "./trace-arc";

/** Two segments of one trace are "non-adjacent" from two indices apart. */
const SELF_SEGMENT_GAP = 2;

/** The shared polyline primitives take mutable arrays and never mutate them. */
const asPath = (pts: readonly PcbPointMm[]): PcbPointMm[] => pts as PcbPointMm[];

// ---------------------------------------------------------------------------
// Contact components between two trace centrelines (or one trace and itself)
// ---------------------------------------------------------------------------

export interface SegmentPair {
  i: number;
  j: number;
  distanceMm: number;
  /** The contact span this pair covers on A, in A's global arc length. */
  src: JunctionInterval;
  /** The same span on B, in B's global arc length. */
  tgt: JunctionInterval;
}

function findRoot(parent: number[], i: number): number {
  let root = i;
  while (parent[root] !== root) root = parent[root]!;
  let walk = i;
  while (parent[walk] !== root) {
    const next = parent[walk]!;
    parent[walk] = root;
    walk = next;
  }
  return root;
}

const overlaps = (x: JunctionInterval, y: JunctionInterval): boolean =>
  x.s0 <= y.s1 && y.s0 <= x.s1;

/**
 * Touching segment pairs, grouped into contact components. Two pairs are one
 * component when their CONTACT SPANS overlap on BOTH traces — the same run of
 * copper, reached from two segments of a corner or a collinear subdivision.
 *
 * Index adjacency is not enough and was wrong: a narrow vee whose two limbs
 * cross one trace half a millimetre apart has its crossings on ADJACENT limb
 * segments, yet they are two distinct joins fifty millimetres apart along the
 * vee — merging them hid a genuine loop. Span overlap on both sides is the
 * physical statement, and it needs no index heuristic at all.
 *
 * O(k log k + overlaps) by a sweep on the source span.
 */
export function contactComponents(pairs: SegmentPair[]): SegmentPair[][] {
  const parent = pairs.map((_, k) => k);
  const order = pairs
    .map((_, k) => k)
    .sort((x, y) => pairs[x]!.src.s0 - pairs[y]!.src.s0 || x - y);
  const active: number[] = [];
  for (const k of order) {
    const cur = pairs[k]!;
    let kept = 0;
    for (const a of active) {
      if (pairs[a]!.src.s1 >= cur.src.s0) active[kept++] = a;
    }
    active.length = kept;
    for (const a of active) {
      // The source spans already overlap (the sweep window); the target spans
      // decide whether this is the same physical contact.
      if (!overlaps(pairs[a]!.tgt, cur.tgt)) continue;
      const rx = findRoot(parent, a);
      const ry = findRoot(parent, k);
      if (rx !== ry) parent[Math.max(rx, ry)] = Math.min(rx, ry);
    }
    active.push(k);
  }
  const byRoot = new Map<number, SegmentPair[]>();
  pairs.forEach((pair, k) => {
    const root = findRoot(parent, k);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(pair);
    else byRoot.set(root, [pair]);
  });
  return [...byRoot.values()].sort(
    (x, y) =>
      Math.min(...x.map((p) => p.src.s0)) - Math.min(...y.map((p) => p.src.s0)) ||
      Math.min(...x.map((p) => p.i)) - Math.min(...y.map((p) => p.i)) ||
      Math.min(...x.map((p) => p.j)) - Math.min(...y.map((p) => p.j)),
  );
}

/** The contact span of one segment pair, in the source trace's arc length. */
function contactSpan(
  arc: TraceArc,
  index: number,
  other0: PcbPointMm,
  other1: PcbPointMm,
  reachMm: number,
  fallbackAt: PcbPointMm,
): JunctionInterval {
  const span = segmentSublevelInterval(
    arc.points[index]!,
    arc.points[index + 1]!,
    { kind: "segment", a: other0, b: other1 },
    reachMm,
  );
  const base = arc.prefix[index]!;
  // The sublevel set is non-empty exactly when the pair touches, so this only
  // guards the ulp window at the boundary: fall back to the witness point.
  if (!span) {
    const at = arcOf(arc, index, fallbackAt);
    return { s0: at, s1: at };
  }
  return { s0: base + span.s0, s1: base + span.s1 };
}

/**
 * Touching segment pairs, found through a sorted-minX sweep over the segments
 * rather than the full cross product: a 2 000-point meander asked 4 million
 * exact distance questions to answer "this trace does not touch itself".
 */
export function segmentPairs(
  arcA: TraceArc,
  arcB: TraceArc,
  reachMm: number,
  selfContact: boolean,
): SegmentPair[] {
  interface Entry {
    side: 0 | 1;
    index: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }
  // Half the reach on each side, so two inflated boxes overlap exactly when the
  // raw segments are within `reachMm` of each other.
  const halo = reachMm / 2;
  const entries: Entry[] = [];
  const add = (side: 0 | 1, arc: TraceArc): void => {
    for (let i = 0; i + 1 < arc.points.length; i += 1) {
      const p = arc.points[i]!;
      const q = arc.points[i + 1]!;
      // Zero-length segments are skipped as sources: the records boundary does
      // not sanitise `pointsMm`, and a degenerate segment adds no arc length.
      if (p.x === q.x && p.y === q.y) continue;
      entries.push({ side, index: i, ...segmentBounds(p, q, halo) });
    }
  };
  add(0, arcA);
  if (!selfContact) add(1, arcB);
  if (entries.length < 2) return [];
  // Sweep along the axis the segments are THINNER on. A serpentine meander is
  // 1 000 full-width horizontals: swept on x every one of them overlaps every
  // other and the sweep degenerates to the cross product it exists to avoid,
  // while on y each sees only its neighbours.
  let spanX = 0;
  let spanY = 0;
  for (const e of entries) {
    spanX += e.maxX - e.minX;
    spanY += e.maxY - e.minY;
  }
  const alongY = spanY < spanX;
  const lo = (e: Entry): number => (alongY ? e.minY : e.minX);
  const hi = (e: Entry): number => (alongY ? e.maxY : e.maxX);
  const crossLo = (e: Entry): number => (alongY ? e.minX : e.minY);
  const crossHi = (e: Entry): number => (alongY ? e.maxX : e.maxY);
  entries.sort((x, y) => lo(x) - lo(y) || x.side - y.side || x.index - y.index);

  const pairs: SegmentPair[] = [];
  for (let x = 0; x < entries.length; x += 1) {
    const e = entries[x]!;
    for (let y = x + 1; y < entries.length; y += 1) {
      const f = entries[y]!;
      if (lo(f) > hi(e)) break;
      if (crossLo(e) > crossHi(f) || crossLo(f) > crossHi(e)) continue;
      let i: number;
      let j: number;
      if (selfContact) {
        i = Math.min(e.index, f.index);
        j = Math.max(e.index, f.index);
        if (j - i < SELF_SEGMENT_GAP) continue;
      } else {
        if (e.side === f.side) continue;
        i = e.side === 0 ? e.index : f.index;
        j = e.side === 0 ? f.index : e.index;
      }
      const a0 = arcA.points[i]!;
      const a1 = arcA.points[i + 1]!;
      const b0 = arcB.points[j]!;
      const b1 = arcB.points[j + 1]!;
      const d = segmentToSegmentDistance(a0, a1, b0, b1);
      if (d > reachMm) continue;
      const cp = segmentClosestPoints(a0, a1, b0, b1);
      pairs.push({
        i,
        j,
        distanceMm: d,
        src: contactSpan(arcA, i, b0, b1, reachMm, cp.a),
        tgt: contactSpan(arcB, j, a0, a1, reachMm, cp.b),
      });
    }
  }
  // Restore the canonical enumeration order the witness tie-break assumes.
  pairs.sort((x, y) => x.i - y.i || x.j - y.j);
  return pairs;
}

/**
 * The canonical point of one contact component, as arc lengths on both sides.
 *
 * Order of preference (§1, no parallelism test anywhere): the centrelines'
 * closest approach — exact at a crossing, unique for non-parallel segments —
 * unless the MIDPOINT of the component's contact interval on `a` achieves the
 * same distance, which is exactly the parallel / collinear case and is where
 * the contract puts the join.
 */
export function componentWitness(
  arcA: TraceArc,
  arcB: TraceArc,
  component: SegmentPair[],
): { sA: number; sB: number; pointMm: PcbPointMm } {
  let best = component[0]!;
  for (const pair of component) {
    if (
      pair.distanceMm < best.distanceMm ||
      (pair.distanceMm === best.distanceMm &&
        (pair.i < best.i || (pair.i === best.i && pair.j < best.j)))
    ) {
      best = pair;
    }
  }
  const cp = segmentClosestPoints(
    arcA.points[best.i]!,
    arcA.points[best.i + 1]!,
    arcB.points[best.j]!,
    arcB.points[best.j + 1]!,
  );
  const nearest = {
    sA: arcOf(arcA, best.i, cp.a),
    sB: arcOf(arcB, best.j, cp.b),
    pointMm: cp.a,
  };

  let lo = Infinity;
  let hi = -Infinity;
  for (const pair of component) {
    if (pair.src.s0 < lo) lo = pair.src.s0;
    if (pair.src.s1 > hi) hi = pair.src.s1;
  }
  if (lo > hi) return nearest;
  const mid = (lo + hi) / 2;
  const midPoint = pointAtArc(arcA, mid);
  // Measured against the COMPONENT's partner segments, not the whole polyline:
  // a trace meeting itself would otherwise find the source segment at distance
  // zero and place both ends of the junction on the same node.
  let midDistance = Infinity;
  let midS = 0;
  for (const j of [...new Set(component.map((pair) => pair.j))].sort(
    (x, y) => x - y,
  )) {
    const proj = projectPointToSegment(
      midPoint,
      arcB.points[j]!,
      arcB.points[j + 1]!,
    );
    if (proj.distance < midDistance) {
      midDistance = proj.distance;
      midS = arcOf(arcB, j, { x: proj.x, y: proj.y });
    }
  }
  // `<=` is the parallel / collinear branch: a strictly convex approach has a
  // unique minimum the midpoint cannot match, so this needs no epsilon.
  if (!(midDistance <= best.distanceMm)) return nearest;
  return { sA: mid, sB: midS, pointMm: midPoint };
}

/**
 * The NON-ADJACENT segment pairs of one polyline whose copper touches — the
 * prefiltered enumeration `traceSelf` runs, exported because the prefilter is
 * the one place a missed candidate would silently drop a junction. It must
 * equal the naive cross product for every polyline; `net-path.test.ts` checks
 * that directly rather than trusting the sweep.
 */
export function touchingSelfSegments(
  points: readonly PcbPointMm[],
  halfWidthMm: number,
  epsMm: number,
): Array<readonly [number, number]> {
  const arc = traceArc(points);
  return segmentPairs(arc, arc, 2 * halfWidthMm + epsMm, true).map(
    (pair) => [pair.i, pair.j] as const,
  );
}

