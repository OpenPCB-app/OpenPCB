// Clearance-distance primitives for DRC. Pure functions, mm units.
//
// Clearance is a *minimum-distance predicate*, so exact-polygon clearance needs
// only segment/point-to-polygon distance — NOT polygon boolean ops. Every
// primitive returns 0 on overlap/containment so a caller can compute
//   gap = dist(A, B) - (halfA + halfB)
// and treat `gap <= 0` as a short and `gap < required` as a clearance breach.
//
// Built on the shared segment primitives in pcb-trace-geometry.ts (no
// duplication, no external geometry dependency).

import {
  type Point,
  projectPointToSegment,
  segmentToSegmentDistance,
} from "./pcb-trace-geometry";

/** Ray-cast point-in-polygon for a closed ring (last point implicitly closes). */
export function pointInPolygon(point: Point, ring: readonly Point[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const straddles = a.y > point.y !== b.y > point.y;
    if (
      straddles &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Minimum distance from a point to a closed polygon ring. 0 if inside. */
export function pointToPolygonDistance(
  point: Point,
  ring: readonly Point[],
): number {
  if (ring.length < 2) return Infinity;
  if (pointInPolygon(point, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const d = projectPointToSegment(point, a, b).distance;
    if (d < best) best = d;
  }
  return best;
}

/** Minimum distance from segment AB to a closed polygon ring. 0 on overlap. */
export function segmentToPolygonDistance(
  a: Point,
  b: Point,
  ring: readonly Point[],
): number {
  if (ring.length < 2) return Infinity;
  // Either endpoint inside the polygon → overlap.
  if (pointInPolygon(a, ring) || pointInPolygon(b, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const c = ring[i]!;
    const d = ring[(i + 1) % ring.length]!;
    const dist = segmentToSegmentDistance(a, b, c, d);
    if (dist < best) best = dist;
    if (best === 0) return 0;
  }
  return best;
}

/** Minimum distance from a polyline to a closed polygon ring. 0 on overlap. */
export function polylineToPolygonDistance(
  polyline: readonly Point[],
  ring: readonly Point[],
): number {
  if (polyline.length < 2 || ring.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < polyline.length; i += 1) {
    const d = segmentToPolygonDistance(polyline[i - 1]!, polyline[i]!, ring);
    if (d < best) best = d;
    if (best === 0) return 0;
  }
  return best;
}

/** Minimum edge-to-edge distance between two closed polygon rings. 0 on overlap. */
export function polygonToPolygonDistance(
  ringA: readonly Point[],
  ringB: readonly Point[],
): number {
  if (ringA.length < 2 || ringB.length < 2) return Infinity;
  // Containment either way → overlap.
  if (pointInPolygon(ringA[0]!, ringB) || pointInPolygon(ringB[0]!, ringA)) {
    return 0;
  }
  let best = Infinity;
  for (let i = 0; i < ringA.length; i += 1) {
    const a = ringA[i]!;
    const b = ringA[(i + 1) % ringA.length]!;
    const d = segmentToPolygonDistance(a, b, ringB);
    if (d < best) best = d;
    if (best === 0) return 0;
  }
  return best;
}

/**
 * Minimum distance from a circle (center + radius) to a polygon ring. Negative
 * when the circle overlaps the polygon (clamped at the center-to-ring distance
 * minus the radius). 0 exactly at tangency.
 */
export function circleToPolygonDistance(
  center: Point,
  radius: number,
  ring: readonly Point[],
): number {
  return pointToPolygonDistance(center, ring) - radius;
}

// --- Distance to a ring's PERIMETER (edges), ignoring inside/outside. Used for
// board-edge clearance, where copper sits *inside* the outline but we still
// want its distance to the boundary (the filled-polygon helpers above return 0
// when contained, which is wrong for edge clearance). ---

/** Minimum distance from a point to the closed ring's edges. */
export function pointToRingEdgeDistance(
  p: Point,
  ring: readonly Point[],
): number {
  if (ring.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const d = projectPointToSegment(p, a, b).distance;
    if (d < best) best = d;
  }
  return best;
}

/** Minimum distance from a polyline to the closed ring's edges. */
export function polylineToRingEdgeDistance(
  polyline: readonly Point[],
  ring: readonly Point[],
): number {
  if (polyline.length < 2 || ring.length < 2) return Infinity;
  let best = Infinity;
  for (let s = 1; s < polyline.length; s += 1) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const d = segmentToSegmentDistance(polyline[s - 1]!, polyline[s]!, a, b);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Minimum edge-to-edge distance between two closed rings' perimeters. */
export function ringToRingEdgeDistance(
  ringA: readonly Point[],
  ringB: readonly Point[],
): number {
  if (ringA.length < 2 || ringB.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < ringA.length; i += 1) {
    const a = ringA[i]!;
    const b = ringA[(i + 1) % ringA.length]!;
    for (let j = 0; j < ringB.length; j += 1) {
      const c = ringB[j]!;
      const d = ringB[(j + 1) % ringB.length]!;
      const dist = segmentToSegmentDistance(a, b, c, d);
      if (dist < best) best = dist;
    }
  }
  return best;
}
