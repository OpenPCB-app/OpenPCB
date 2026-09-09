import type { PcbPointMm } from "../../../../sdks/designer";
import {
  circleToPolygonDistance,
  polygonToPolygonDistance,
  polylineToPolygonDistance,
  segmentToPolygonDistance,
  segmentToRingClosestPoints,
} from "../pcb/pcb-clearance-geometry";
import {
  distance,
  pointToPolylineDistance,
  polylineToPolylineClosestPoints,
  projectPointToSegment,
  segmentClosestPoints,
  segmentToSegmentDistance,
} from "../pcb/pcb-trace-geometry";
import type { DrcHole, DrcPad, DrcTrace, DrcViaGeom } from "./drc-context";

/**
 * The ONE place DRC turns two items into a gap — clearance, creepage and the
 * copper-to-hole check consume it (contract 06 §3), so a pair kind cannot be
 * measured two ways by two checks.
 *
 * Every kernel returns the EDGE-TO-EDGE gap in mm (negative on overlap, where
 * the underlying kernel says so) plus the marker location the clearance check
 * has always reported for that pair kind: the closest-approach midpoint for
 * polyline pairs, the pad or via centre for a pad / via pair, the hole centre
 * for a hole pair. Nothing here compares against a requirement or knows about
 * epsilons — that is the caller's tier.
 */
export interface PairGap {
  gap: number;
  location: PcbPointMm;
}

/** Any copper item a gap can be measured to. */
export type DrcCopperItem = DrcTrace | DrcPad | DrcViaGeom;

/**
 * Traces in canonical (anchor-key) order. Any per-net accumulation or "first
 * trace" witness must walk this, not `ctx.traces`: float sums are not
 * associative and a marker taken from index 0 follows array order otherwise
 * (contract 06 §7).
 */
export function canonicalTraces(traces: readonly DrcTrace[]): DrcTrace[] {
  return [...traces].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function midpoint(a: PcbPointMm, b: PcbPointMm): PcbPointMm {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// --- trace ↔ trace -----------------------------------------------------------

export function traceTraceGap(u: DrcTrace, v: DrcTrace): PairGap {
  const closest = polylineToPolylineClosestPoints(u.pointsMm, v.pointsMm);
  return {
    gap: closest.distance - (u.halfWidthMm + v.halfWidthMm),
    location: midpoint(closest.a, closest.b),
  };
}

/** One sub-segment pair of two traces; `halfSum` = both half widths. */
export function segmentSegmentGap(
  ua: PcbPointMm,
  ub: PcbPointMm,
  va: PcbPointMm,
  vb: PcbPointMm,
  halfSum: number,
): PairGap {
  const cp = segmentClosestPoints(ua, ub, va, vb);
  return { gap: cp.distance - halfSum, location: midpoint(cp.a, cp.b) };
}

// --- trace ↔ pad / via -------------------------------------------------------

export function tracePadGap(t: DrcTrace, pad: DrcPad): PairGap {
  const gap = pad.disc
    ? pointToPolylineDistance(pad.disc.center, t.pointsMm).distance -
      pad.disc.radiusMm -
      t.halfWidthMm
    : polylineToPolygonDistance(t.pointsMm, pad.ring) - t.halfWidthMm;
  return { gap, location: pad.center };
}

export function segmentPadGap(
  a: PcbPointMm,
  b: PcbPointMm,
  halfWidthMm: number,
  pad: DrcPad,
): PairGap {
  const gap = pad.disc
    ? projectPointToSegment(pad.disc.center, a, b).distance -
      pad.disc.radiusMm -
      halfWidthMm
    : segmentToRingClosestPoints(a, b, pad.ring).distance - halfWidthMm;
  return { gap, location: pad.center };
}

export function traceViaGap(t: DrcTrace, via: DrcViaGeom): PairGap {
  return {
    gap:
      pointToPolylineDistance(via.center, t.pointsMm).distance -
      (t.halfWidthMm + via.radiusMm),
    location: via.center,
  };
}

export function segmentViaGap(
  a: PcbPointMm,
  b: PcbPointMm,
  halfWidthMm: number,
  via: DrcViaGeom,
): PairGap {
  return {
    gap:
      projectPointToSegment(via.center, a, b).distance -
      (halfWidthMm + via.radiusMm),
    location: via.center,
  };
}

// --- pad / via ↔ pad / via ---------------------------------------------------

export function padPadGap(a: DrcPad, b: DrcPad): PairGap {
  const location = midpoint(a.center, b.center);
  if (a.disc && b.disc) {
    return {
      gap:
        distance(a.disc.center, b.disc.center) -
        (a.disc.radiusMm + b.disc.radiusMm),
      location,
    };
  }
  if (a.disc) {
    return {
      gap: circleToPolygonDistance(a.disc.center, a.disc.radiusMm, b.ring),
      location,
    };
  }
  if (b.disc) {
    return {
      gap: circleToPolygonDistance(b.disc.center, b.disc.radiusMm, a.ring),
      location,
    };
  }
  return { gap: polygonToPolygonDistance(a.ring, b.ring), location };
}

export function padViaGap(pad: DrcPad, via: DrcViaGeom): PairGap {
  const gap = pad.disc
    ? distance(pad.disc.center, via.center) -
      (pad.disc.radiusMm + via.radiusMm)
    : circleToPolygonDistance(via.center, via.radiusMm, pad.ring);
  return { gap, location: via.center };
}

export function viaViaGap(a: DrcViaGeom, b: DrcViaGeom): PairGap {
  return {
    gap: distance(a.center, b.center) - (a.radiusMm + b.radiusMm),
    location: midpoint(a.center, b.center),
  };
}

// --- copper ↔ drilled hole ---------------------------------------------------

/**
 * A hole as copper sees it: a disc of `drillMm / 2`, or — for an oblong drill —
 * the routed stadium of `slot.widthMm / 2` around the slot centreline. Same
 * interpretation the Excellon writer and the pour apertures use, so the copper
 * DRC clears exactly the hole the fab routes.
 */
function holeStadium(hole: DrcHole): {
  a: PcbPointMm;
  b: PcbPointMm;
  radiusMm: number;
  round: boolean;
} {
  if (hole.slot) {
    return {
      a: hole.slot.a,
      b: hole.slot.b,
      radiusMm: hole.slot.widthMm / 2,
      round: false,
    };
  }
  return {
    a: hole.center,
    b: hole.center,
    radiusMm: hole.drillMm / 2,
    round: true,
  };
}

function isTrace(item: DrcCopperItem): item is DrcTrace {
  return "pointsMm" in item;
}

function isPad(item: DrcCopperItem): item is DrcPad {
  return "ring" in item;
}

/** Minimum distance from a polyline's centreline to segment AB. */
function polylineToSegmentDistance(
  polyline: readonly PcbPointMm[],
  a: PcbPointMm,
  b: PcbPointMm,
): number {
  // A one-point polyline is a disc of copper (contract 06 §2 keeps the
  // defensive branch): `Infinity` here would fail OPEN against a slot.
  if (polyline.length === 1) return projectPointToSegment(polyline[0]!, a, b).distance;
  let best = Infinity;
  for (let i = 1; i < polyline.length; i += 1) {
    const d = segmentToSegmentDistance(polyline[i - 1]!, polyline[i]!, a, b);
    if (d < best) best = d;
  }
  return best;
}

export function copperHoleGap(item: DrcCopperItem, hole: DrcHole): PairGap {
  const s = holeStadium(hole);
  return { gap: gapToStadium(item, s), location: hole.center };
}

function gapToStadium(
  item: DrcCopperItem,
  s: { a: PcbPointMm; b: PcbPointMm; radiusMm: number; round: boolean },
): number {
  if (isTrace(item)) {
    const centreline = s.round
      ? pointToPolylineDistance(s.a, item.pointsMm).distance
      : polylineToSegmentDistance(item.pointsMm, s.a, s.b);
    return centreline - s.radiusMm - item.halfWidthMm;
  }
  if (isPad(item)) {
    if (item.disc) {
      const centre = s.round
        ? distance(item.disc.center, s.a)
        : projectPointToSegment(item.disc.center, s.a, s.b).distance;
      return centre - item.disc.radiusMm - s.radiusMm;
    }
    return s.round
      ? circleToPolygonDistance(s.a, s.radiusMm, item.ring)
      : segmentToPolygonDistance(s.a, s.b, item.ring) - s.radiusMm;
  }
  const centre = s.round
    ? distance(item.center, s.a)
    : projectPointToSegment(item.center, s.a, s.b).distance;
  return centre - item.radiusMm - s.radiusMm;
}
