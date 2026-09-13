// Copper-touch predicates. Pure, mm domain, no state.
//
// Every predicate answers one question: is the minimum distance between two
// pieces of copper within `eps`? Nets and layers are the caller's business —
// these functions are geometry only, so the graph can gate on layers once and
// the contact-record pass can reuse the same primitives.

import type { PcbCopperLayerId, PcbPointMm } from "../../sdks/designer";
import {
  pointInPolygon,
  pointToRingEdgeDistance,
  ringToRingEdgeDistance,
} from "../pcb-geometry/pcb-clearance-geometry";
import {
  pointToPolylineDistance,
  polylineToPolylineDistance,
} from "../pcb-geometry/pcb-trace-geometry";
import {
  roundedGap,
  roundedPoint,
  roundedPolylineGap,
  roundedTouch,
} from "../pcb-geometry/rounded-shape";
import type { RingBounds } from "../pcb-geometry/pad-outline";
import { CONNECT_EPS_MM } from "../pcb-geometry/tolerance";
import type {
  CopperItem,
  PadCopperItem,
  PourCopperItem,
  TraceCopperItem,
  ViaCopperItem,
} from "./copper-items";

// The shared polyline primitives take mutable arrays but never mutate them.
// Items hold readonly points, so widen at the call site — copying per candidate
// pair would dominate the O(n) sweep inner loop.
const asPath = (pts: readonly PcbPointMm[]): PcbPointMm[] => pts as PcbPointMm[];

/** Copper layers an item occupies (empty for a layer-invalid pad / via). */
export function itemLayers(item: CopperItem): readonly PcbCopperLayerId[] {
  switch (item.kind) {
    case "pad":
    case "via":
      return item.layers;
    case "trace":
    case "pour":
      return [item.layer];
  }
}

/** True when the item's copper exists on `layer`. */
export function occupiesLayer(
  item: CopperItem,
  layer: PcbCopperLayerId,
): boolean {
  return itemLayers(item).includes(layer);
}

/** Layers both items occupy, in `a`'s order. */
export function sharedLayers(
  a: CopperItem,
  b: CopperItem,
): PcbCopperLayerId[] {
  const other = itemLayers(b);
  return itemLayers(a).filter((l) => other.includes(l));
}

/** Axis-aligned bounds overlap, both inflated by `eps`. */
export function boundsOverlap(
  a: RingBounds,
  b: RingBounds,
  eps: number,
): boolean {
  return (
    a.minX - eps <= b.maxX + eps &&
    b.minX - eps <= a.maxX + eps &&
    a.minY - eps <= b.maxY + eps &&
    b.minY - eps <= a.maxY + eps
  );
}

/**
 * Distance from a point to a filled island: 0 inside the outer ring and
 * outside every hole, else the minimum distance to any ring's edges (so a
 * point inside a hole measures to the hole boundary, not to the outer ring).
 */
export function pointToIslandDistance(
  p: PcbPointMm,
  rings: ReadonlyArray<ReadonlyArray<PcbPointMm>>,
): number {
  const outer = rings[0];
  if (!outer || outer.length < 3) return Infinity;
  if (pointInPolygon(p, outer)) {
    let inHole = false;
    for (let i = 1; i < rings.length; i += 1) {
      if (pointInPolygon(p, rings[i]!)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return 0;
  }
  let best = Infinity;
  for (const ring of rings) {
    const d = pointToRingEdgeDistance(p, ring);
    if (d < best) best = d;
  }
  return best;
}

/**
 * The verdict a copper-touch decision was made on: the distance that was
 * measured and the reach it was compared against. `distanceMm <= reachMm` IS
 * the predicate — the two numbers are kept apart, never pre-subtracted into a
 * gap, because `d <= h + eps` and `d - h <= eps` disagree by an ulp at the
 * boundary and every S1 verdict was made with the former.
 */
export interface CopperTouchWitness {
  readonly distanceMm: number;
  readonly reachMm: number;
}

const witness = (
  distanceMm: number,
  reachMm: number,
): CopperTouchWitness | null =>
  distanceMm <= reachMm ? { distanceMm, reachMm } : null;

/** Membership is already a decision; 0 / Infinity carries it as a distance. */
const membership = (member: boolean): CopperTouchWitness | null =>
  witness(member ? 0 : Infinity, 0);

/**
 * Pad geometry for a touch test: the pad's EXACT copper (exact-geometry
 * contract 12 §1.3). The circumscribed outline ring used to decide this, which
 * fabricated contact between two same-net oval / roundrect pads physically
 * ~2 µm apart — they read CONNECTED, so `UNCONNECTED_NET` stayed silent and,
 * the pads being same-net, no clearance check saw them either (Astra S7 #5).
 *
 * Cores are subsets of their rings, so IN REAL ARITHMETIC no pair that was
 * OPEN can become CONNECTED and only fabricated contacts are removed. In
 * FLOAT the claim holds only outside a ±1 ulp window around
 * `CONNECT_EPS_MM`: this predicate used to group a circle pair's radii
 * successively (`Math.hypot(…) − rA − rB`) and `roundedGap` groups them first
 * over `Math.sqrt` (`distance(…) − (rA + rB)`), so a pair sitting at EXACTLY
 * the 0.5 nm contact tolerance can flip either way by one ulp of that
 * regrouping. One kernel is worth that: `pair-gap.ts` had already grouped
 * first, so the two halves of the same question used to disagree with each
 * other. `pcb-geometry-rounded-shape.test.ts` pins the window.
 */
function padTouch(
  pad: PadCopperItem,
  other: CopperItem,
  eps: number,
): CopperTouchWitness | null {
  switch (other.kind) {
    case "pad":
      return witness(roundedGap(pad.rounded, other.rounded), eps);
    case "trace":
      return witness(
        roundedPolylineGap(other.pointsMm, other.halfWidthMm, pad.rounded),
        eps,
      );
    case "via":
      return witness(
        roundedGap(pad.rounded, roundedPoint(other.center, other.radiusMm)),
        eps,
      );
    case "pour":
      return membership(other.memberKeys.has(pad.key));
  }
}

function traceTouch(
  trace: TraceCopperItem,
  other: CopperItem,
  eps: number,
): CopperTouchWitness | null {
  switch (other.kind) {
    case "pad":
      return padTouch(other, trace, eps);
    case "trace":
      return witness(
        polylineToPolylineDistance(
          asPath(trace.pointsMm),
          asPath(other.pointsMm),
        ),
        trace.halfWidthMm + other.halfWidthMm + eps,
      );
    case "via":
      return witness(
        pointToPolylineDistance(other.center, asPath(trace.pointsMm)).distance,
        other.radiusMm + trace.halfWidthMm + eps,
      );
    case "pour":
      return membership(other.memberKeys.has(trace.key));
  }
}

function viaTouch(
  via: ViaCopperItem,
  other: CopperItem,
  eps: number,
): CopperTouchWitness | null {
  switch (other.kind) {
    case "pad":
      return padTouch(other, via, eps);
    case "trace":
      return traceTouch(other, via, eps);
    case "via":
      return witness(
        Math.hypot(
          via.center.x - other.center.x,
          via.center.y - other.center.y,
        ),
        via.radiusMm + other.radiusMm + eps,
      );
    case "pour":
      return membership(other.memberKeys.has(via.key));
  }
}

/**
 * Do two items' copper touch? Purely geometric — the caller must already have
 * established that they share a copper layer. Pour membership is decided by
 * the fill kernel's polygon intersection, so an island only "touches" the
 * items it lists; islands of one pour are disjoint by construction, islands of
 * different pours on the same net and layer merge where they overlap
 * (`pourTouch`).
 */
export function copperTouchWitness(
  a: CopperItem,
  b: CopperItem,
  eps: number = CONNECT_EPS_MM,
): CopperTouchWitness | null {
  switch (a.kind) {
    case "pad":
      return padTouch(a, b, eps);
    case "trace":
      return traceTouch(a, b, eps);
    case "via":
      return viaTouch(a, b, eps);
    case "pour":
      return b.kind === "pour"
        ? membership(pourTouch(a, b, eps))
        : copperTouchWitness(b, a, eps);
  }
}

/** The ONE oracle: touching IS having a witness (SI contract 14 §1). */
export function copperTouch(
  a: CopperItem,
  b: CopperItem,
  eps: number = CONNECT_EPS_MM,
): boolean {
  return copperTouchWitness(a, b, eps) !== null;
}

/**
 * Two filled islands of the same net and layer. Islands of ONE pour are
 * disjoint by construction, so they never touch; islands of two different pours
 * — overlapping zones, or a zone over a board-wide fill — are separate polygon
 * sets over the same copper and must merge where they overlap or abut.
 */
function pourTouch(
  a: PourCopperItem,
  b: PourCopperItem,
  eps: number,
): boolean {
  if (a.pourIndex === b.pourIndex) return false;
  for (const p of a.rings[0] ?? []) {
    if (pointToIslandDistance(p, b.rings) === 0) return true;
  }
  for (const p of b.rings[0] ?? []) {
    if (pointToIslandDistance(p, a.rings) === 0) return true;
  }
  for (const ringA of a.rings) {
    for (const ringB of b.rings) {
      if (ringToRingEdgeDistance(ringA, ringB) <= eps) return true;
    }
  }
  return false;
}

/**
 * Does a trace's end cap — the disc of radius `halfWidthMm` at endpoint
 * `endIndex` (0 = first point, 1 = last) — touch `other`'s copper on the
 * trace's layer? This is the stub test: body overlap elsewhere along the trace
 * does not rescue a dangling end.
 */
export function endCapTouches(
  trace: TraceCopperItem,
  endIndex: 0 | 1,
  other: CopperItem,
  eps: number = CONNECT_EPS_MM,
): boolean {
  if (!occupiesLayer(other, trace.layer)) return false;
  const p =
    endIndex === 0
      ? trace.pointsMm[0]
      : trace.pointsMm[trace.pointsMm.length - 1];
  if (!p) return false;
  const hw = trace.halfWidthMm;
  switch (other.kind) {
    // The end cap is a disc of radius `hw` at `p`; the pad is its exact copper,
    // the SAME shape `padTouch` judges (12 §1.3). Judging the cap on the pad's
    // circumscribed ring here made the two disagree: the graph called a 2 µm
    // gap OPEN — raising `UNCONNECTED_NET` — while this predicate called the
    // same end cap connected, so `TRACK_DANGLING` stayed silent (R1 #2).
    case "pad":
      return roundedTouch(roundedPoint(p, hw), other.rounded, eps);
    case "trace":
      return (
        pointToPolylineDistance(p, asPath(other.pointsMm)).distance <=
        hw + other.halfWidthMm + eps
      );
    case "via":
      return (
        Math.hypot(p.x - other.center.x, p.y - other.center.y) <=
        hw + other.radiusMm + eps
      );
    case "pour":
      return pointToIslandDistance(p, other.rings) <= hw + eps;
  }
}

/**
 * Does the via's barrel disc touch `other`'s copper on `layer`? Used per span
 * layer for the "connects on ≥ 2 layers" test.
 */
export function viaTouchesOnLayer(
  via: ViaCopperItem,
  other: CopperItem,
  layer: PcbCopperLayerId,
  eps: number = CONNECT_EPS_MM,
): boolean {
  if (!occupiesLayer(other, layer)) return false;
  switch (other.kind) {
    // The barrel disc against the pad's exact copper — the same shape
    // `padTouch` judges, so the ">= 2 layers" test cannot contradict the graph
    // that already called this pair open (R1 #2).
    case "pad":
      return roundedTouch(
        roundedPoint(via.center, via.radiusMm),
        other.rounded,
        eps,
      );
    case "trace":
      return (
        pointToPolylineDistance(via.center, asPath(other.pointsMm)).distance <=
        via.radiusMm + other.halfWidthMm + eps
      );
    case "via":
      return (
        Math.hypot(
          via.center.x - other.center.x,
          via.center.y - other.center.y,
        ) <=
        via.radiusMm + other.radiusMm + eps
      );
    case "pour":
      return pointToIslandDistance(via.center, other.rings) <= via.radiusMm + eps;
  }
}
