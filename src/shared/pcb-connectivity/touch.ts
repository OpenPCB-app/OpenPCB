// Copper-touch predicates. Pure, mm domain, no state.
//
// Every predicate answers one question: is the minimum distance between two
// pieces of copper within `eps`? Nets and layers are the caller's business —
// these functions are geometry only, so the graph can gate on layers once and
// the contact-record pass can reuse the same primitives.

import type { PcbCopperLayerId, PcbPointMm } from "../../sdks/designer";
import {
  circleToPolygonDistance,
  pointInPolygon,
  pointToRingEdgeDistance,
  polygonToPolygonDistance,
  polylineToPolygonDistance,
  ringToRingEdgeDistance,
} from "../pcb-geometry/pcb-clearance-geometry";
import {
  pointToPolylineDistance,
  polylineToPolylineDistance,
} from "../pcb-geometry/pcb-trace-geometry";
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

function discGap(
  a: { center: PcbPointMm; radiusMm: number },
  b: { center: PcbPointMm; radiusMm: number },
): number {
  return (
    Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) -
    a.radiusMm -
    b.radiusMm
  );
}

/**
 * Pad geometry for a touch test: the exact disc of a circular pad, else its
 * (circumscribed) outline ring. Oval and roundrect arcs keep the conservative
 * polygon — a ~0.2 % over-reach of the arc radius, recorded as the S2 residual.
 */
function padTouch(
  pad: PadCopperItem,
  other: CopperItem,
  eps: number,
): boolean {
  switch (other.kind) {
    case "pad":
      if (pad.disc && other.disc) return discGap(pad.disc, other.disc) <= eps;
      if (pad.disc) {
        return (
          circleToPolygonDistance(
            pad.disc.center,
            pad.disc.radiusMm,
            other.ring,
          ) <= eps
        );
      }
      if (other.disc) {
        return (
          circleToPolygonDistance(
            other.disc.center,
            other.disc.radiusMm,
            pad.ring,
          ) <= eps
        );
      }
      return polygonToPolygonDistance(pad.ring, other.ring) <= eps;
    case "trace":
      if (pad.disc) {
        return (
          pointToPolylineDistance(pad.disc.center, asPath(other.pointsMm))
            .distance <=
          pad.disc.radiusMm + other.halfWidthMm + eps
        );
      }
      return (
        polylineToPolygonDistance(other.pointsMm, pad.ring) <=
        other.halfWidthMm + eps
      );
    case "via":
      if (pad.disc) {
        return (
          discGap(pad.disc, { center: other.center, radiusMm: other.radiusMm }) <=
          eps
        );
      }
      return (
        circleToPolygonDistance(other.center, other.radiusMm, pad.ring) <= eps
      );
    case "pour":
      return other.memberKeys.has(pad.key);
  }
}

function traceTouch(
  trace: TraceCopperItem,
  other: CopperItem,
  eps: number,
): boolean {
  switch (other.kind) {
    case "pad":
      return padTouch(other, trace, eps);
    case "trace":
      return (
        polylineToPolylineDistance(asPath(trace.pointsMm), asPath(other.pointsMm)) <=
        trace.halfWidthMm + other.halfWidthMm + eps
      );
    case "via":
      return (
        pointToPolylineDistance(other.center, asPath(trace.pointsMm)).distance <=
        other.radiusMm + trace.halfWidthMm + eps
      );
    case "pour":
      return other.memberKeys.has(trace.key);
  }
}

function viaTouch(
  via: ViaCopperItem,
  other: CopperItem,
  eps: number,
): boolean {
  switch (other.kind) {
    case "pad":
      return padTouch(other, via, eps);
    case "trace":
      return traceTouch(other, via, eps);
    case "via":
      return (
        Math.hypot(via.center.x - other.center.x, via.center.y - other.center.y) <=
        via.radiusMm + other.radiusMm + eps
      );
    case "pour":
      return other.memberKeys.has(via.key);
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
export function copperTouch(
  a: CopperItem,
  b: CopperItem,
  eps: number = CONNECT_EPS_MM,
): boolean {
  switch (a.kind) {
    case "pad":
      return padTouch(a, b, eps);
    case "trace":
      return traceTouch(a, b, eps);
    case "via":
      return viaTouch(a, b, eps);
    case "pour":
      return b.kind === "pour" ? pourTouch(a, b, eps) : copperTouch(b, a, eps);
  }
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
    case "pad":
      if (other.disc) {
        return (
          Math.hypot(p.x - other.disc.center.x, p.y - other.disc.center.y) <=
          hw + other.disc.radiusMm + eps
        );
      }
      return circleToPolygonDistance(p, hw, other.ring) <= eps;
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
    case "pad":
      if (other.disc) {
        return (
          discGap({ center: via.center, radiusMm: via.radiusMm }, other.disc) <=
          eps
        );
      }
      return (
        circleToPolygonDistance(via.center, via.radiusMm, other.ring) <= eps
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
