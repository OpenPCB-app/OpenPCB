/**
 * THE filled-set gap of the DFM overlay checks (DFM contract 11 §3, §4).
 *
 * Every artwork verdict on this session's overlays is about two FILLED sets —
 * deposited ink, an opened window in the mask, a piece of copper — not about
 * two outlines. An unsigned perimeter distance is wrong for all of them: it
 * reports ZERO both for "touching" and for "one lies entirely inside the
 * other", so a silk line printed across a pad and a mask opening swallowing a
 * neighbouring pad would both read as a clean tangency (Astra run 1 #9, #17).
 *
 * So the gap is SIGNED: positive when the sets are disjoint (the edge
 * distance), zero when their boundaries touch, negative when their interiors
 * meet — and containment is probed BEFORE any edge distance is trusted. The
 * two callers (`checks/silkscreen.ts`, `checks/solder-mask.ts`) share these
 * bodies, so a silk-to-opening gap and an opening-to-opening gap can never be
 * two different measurements of the same situation.
 */
import type { PcbPointMm } from "../../../sdks/designer";
import {
  pointInPolygon,
  pointToRingEdgeDistance,
  polylineToRingEdgeDistance,
  ringToRingEdgeDistance,
  segmentToRingClosestPoints,
} from "../../pcb-geometry/pcb-clearance-geometry";
import { splitParamsAgainstRing } from "../../pcb-geometry/region-rings";
import { GEOM_EPS_MM } from "../../pcb-geometry/tolerance";

export interface FilledGap {
  /** Signed: > 0 disjoint, 0 tangent, < 0 interiors meet. */
  gapMm: number;
  /** Where the minimum is attained — the penetrating point when negative. */
  at: PcbPointMm;
}

/**
 * Signed gap between a STADIUM (the segment `a`→`b` swept by a disc of
 * `halfWidthMm`) and the filled set bounded by `ring`.
 *
 * A centreline with both endpoints outside the ring and a POSITIVE perimeter
 * distance cannot have entered it — entering would cross the boundary and make
 * that distance zero — so the outside branch is exact and the stadium's gap is
 * the centreline distance minus the half width.
 *
 * Inside, the WITNESS matters as much as the number: the violation id hashes a
 * 0.1 mm location bucket, so a marker at an arbitrary end of a 20 mm silk line
 * that crosses a pad points the user at the wrong place and keys a waiver to
 * it. A penetrating ENDPOINT is its own witness; a segment that passes clean
 * THROUGH the ring has no endpoint inside, so it is clipped to the ring and the
 * midpoint of its inside run is the witness — the middle of the ink that landed
 * on the pad.
 */
export function stadiumGapToRing(
  a: PcbPointMm,
  b: PcbPointMm,
  halfWidthMm: number,
  ring: readonly PcbPointMm[],
): FilledGap {
  if (ring.length < 3) return { gapMm: Infinity, at: a };
  const aIn = pointInPolygon(a, ring);
  const bIn = pointInPolygon(b, ring);
  const dPerim = polylineToRingEdgeDistance([a, b], ring);
  if (!aIn && !bIn && dPerim > 0) {
    const cp = segmentToRingClosestPoints(a, b, ring);
    return { gapMm: dPerim - halfWidthMm, at: cp.onSegment };
  }
  if (aIn || bIn) {
    const depthA = aIn ? pointToRingEdgeDistance(a, ring) : -Infinity;
    const depthB = bIn ? pointToRingEdgeDistance(b, ring) : -Infinity;
    const at = depthA >= depthB ? a : b;
    return { gapMm: -(Math.max(depthA, depthB, 0) + halfWidthMm), at };
  }
  // A clean crossing: both ends outside, the boundary between them.
  const at = insideMidpoint(a, b, ring);
  if (!at) return { gapMm: -halfWidthMm, at: a };
  return {
    gapMm: -(pointToRingEdgeDistance(at, ring) + halfWidthMm),
    at,
  };
}

/**
 * The midpoint of the LONGEST run of `a`→`b` that lies inside `ring`, or null
 * when no run does. The segment is split at every contact with the boundary, so
 * membership is constant over each piece and one midpoint probe decides it
 * (the same construction `splitSegmentAtRings` is built on).
 */
function insideMidpoint(
  a: PcbPointMm,
  b: PcbPointMm,
  ring: readonly PcbPointMm[],
): PcbPointMm | null {
  const params = splitParamsAgainstRing(a, b, ring, GEOM_EPS_MM);
  const at = (t: number): PcbPointMm => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  let best: { span: number; mid: number } | null = null;
  for (let i = 1; i < params.length; i += 1) {
    const t0 = params[i - 1]!;
    const t1 = params[i]!;
    const span = t1 - t0;
    if (span <= 0) continue;
    const mid = (t0 + t1) / 2;
    if (!pointInPolygon(at(mid), ring)) continue;
    if (!best || span > best.span) best = { span, mid };
  }
  return best ? at(best.mid) : null;
}

/**
 * Signed gap between two closed RINGS as filled sets.
 *
 * A vertex of either strictly inside the other is a real overlap, and its
 * distance to the other's perimeter is the penetration depth. Perimeters that
 * cross with NO vertex of either inside the other — two rectangles in a plus —
 * report zero, the tangency reading. That corner is not a fail-open for either
 * caller: the mask check treats `gap <= 0` as "no dam between them", and the
 * silk check also sees a filled region's OUTLINE stroke, whose segments cross
 * the ring and report the penetration as a stadium.
 */
export function ringGapToRing(
  ringA: readonly PcbPointMm[],
  ringB: readonly PcbPointMm[],
): FilledGap {
  const fallback = ringA[0] ?? ringB[0] ?? { x: 0, y: 0 };
  if (ringA.length < 3 || ringB.length < 3) {
    return { gapMm: Infinity, at: fallback };
  }
  let depth = 0;
  let at: PcbPointMm | null = null;
  const deeper = (v: PcbPointMm, d: number): void => {
    // A strict `>` would let the SCAN order decide a tie, and the two rings are
    // scanned in the caller's operand order — so equal depths are broken by the
    // smaller point instead. Every witness this module returns has to be a
    // function of the geometry alone: it is hashed into the violation id (§7).
    if (at === null || d > depth || (d === depth && smaller(v, at))) {
      depth = d;
      at = v;
    }
  };
  for (const v of ringA) {
    if (pointInPolygon(v, ringB)) deeper(v, pointToRingEdgeDistance(v, ringB));
  }
  for (const v of ringB) {
    if (pointInPolygon(v, ringA)) deeper(v, pointToRingEdgeDistance(v, ringA));
  }
  if (at !== null) return { gapMm: -depth, at };
  const dPerim = ringToRingEdgeDistance(ringA, ringB);
  // Both directions, then the smaller point: scanning one ring's segments
  // against the other is not symmetric when the closest pair is not unique
  // (two parallel edges), and a marker that flips with the operand order flips
  // the violation id with it.
  const ab = closestOnRings(ringA, ringB);
  const ba = closestOnRings(ringB, ringA);
  return { gapMm: dPerim, at: smaller(ab, ba) ? ab : ba };
}

/** Lexicographic (x, then y) — the total order every witness tie falls back on. */
function smaller(a: PcbPointMm, b: PcbPointMm): boolean {
  return a.x !== b.x ? a.x < b.x : a.y < b.y;
}

/** Midpoint of the two closest perimeter points — the marker of a clean gap. */
function closestOnRings(
  ringA: readonly PcbPointMm[],
  ringB: readonly PcbPointMm[],
): PcbPointMm {
  let best = Infinity;
  let at: PcbPointMm = ringA[0] ?? { x: 0, y: 0 };
  for (let i = 0; i < ringA.length; i += 1) {
    const a = ringA[i]!;
    const b = ringA[(i + 1) % ringA.length]!;
    const cp = segmentToRingClosestPoints(a, b, ringB);
    const mid = {
      x: (cp.onSegment.x + cp.onRing.x) / 2,
      y: (cp.onSegment.y + cp.onRing.y) / 2,
    };
    if (cp.distance < best || (cp.distance === best && smaller(mid, at))) {
      best = cp.distance;
      at = mid;
    }
  }
  return at;
}
