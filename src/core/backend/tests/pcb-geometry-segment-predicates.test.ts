/**
 * The shared segment kernel (docs/pcb-hardening/02-geometry-contract.md §2).
 * One inclusive contact predicate, one strict crossing predicate, and one
 * contact-parameter set — all closed at GEOM_EPS_MM, all treating collinearity
 * as a LENGTH rather than a raw cross product.
 */
import { describe, expect, test } from "bun:test";
import {
  distance,
  isCollinear,
  orient,
  pointOnSegment,
  ringSelfIntersects,
  segmentContactParams,
  segmentsCrossTransversally,
  segmentsIntersect,
} from "../../../shared/pcb-geometry/segment-predicates";
import {
  polylineToPolylineClosestPoints,
  segmentToSegmentDistance,
} from "../../../shared/pcb-geometry/pcb-trace-geometry";
import { GEOM_EPS_MM } from "../../../shared/pcb-geometry/tolerance";

const p = (x: number, y: number) => ({ x, y });

describe("segmentsIntersect (inclusive contact)", () => {
  test("proper crossing", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
    expect(
      segmentsCrossTransversally(p(0, 0), p(10, 10), p(0, 10), p(10, 0)),
    ).toBe(true);
  });

  test("T-touch and shared endpoint are contacts but not crossings", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(5, 5))).toBe(true);
    expect(
      segmentsCrossTransversally(p(0, 0), p(10, 0), p(5, 0), p(5, 5)),
    ).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(10, 0), p(10, 5))).toBe(true);
    expect(
      segmentsCrossTransversally(p(0, 0), p(10, 0), p(10, 0), p(10, 5)),
    ).toBe(false);
  });

  test("collinear overlap is a contact, collinear disjoint is not", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(15, 0))).toBe(true);
    expect(
      segmentsCrossTransversally(p(0, 0), p(10, 0), p(5, 0), p(15, 0)),
    ).toBe(false);
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(11, 0), p(15, 0))).toBe(false);
  });

  test("parallel offset segments do not touch", () => {
    expect(segmentsIntersect(p(0, 0), p(10, 0), p(0, 5), p(10, 5))).toBe(false);
  });

  test("0.01 mm segments crossing at 0.3° cross (the old |rxs| guard said no)", () => {
    // rxs = 1e-4 · sin(0.3°) = 5.2e-7, below the former 1e-6 constant, although
    // the segments genuinely cross at their midpoints.
    const a = p(0, 0);
    const b = p(0.01, 0);
    const half = 0.005;
    const ang = (0.3 * Math.PI) / 180;
    const c = p(half - half * Math.cos(ang), -half * Math.sin(ang));
    const d = p(half + half * Math.cos(ang), half * Math.sin(ang));
    expect(segmentsCrossTransversally(a, b, c, d)).toBe(true);
    expect(segmentsIntersect(a, b, c, d)).toBe(true);
  });

  test("the closed boundary is exactly GEOM_EPS_MM wide", () => {
    const a = p(0, 0);
    const b = p(10, 0);
    expect(segmentsIntersect(a, b, p(5, 4e-7), p(5, 5))).toBe(true);
    expect(segmentsIntersect(a, b, p(5, 6e-7), p(5, 5))).toBe(false);
    expect(pointOnSegment(p(5, 4e-7), a, b)).toBe(true);
    expect(pointOnSegment(p(5, 6e-7), a, b)).toBe(false);
    expect(GEOM_EPS_MM).toBe(5e-7);
  });

  test("orient / isCollinear are length-scaled", () => {
    expect(orient(p(0, 0), p(1, 0), p(0, 1))).toBeCloseTo(1, 12);
    // c is 4e-7 mm off a 10 mm line: collinear. 6e-7 is not.
    expect(isCollinear(p(0, 0), p(10, 0), p(5, 4e-7))).toBe(true);
    expect(isCollinear(p(0, 0), p(10, 0), p(5, 6e-7))).toBe(false);
    // A degenerate base collapses to point coincidence.
    expect(isCollinear(p(1, 1), p(1, 1), p(1, 1))).toBe(true);
    expect(isCollinear(p(1, 1), p(1, 1), p(1, 2))).toBe(false);
  });
});

describe("segmentContactParams", () => {
  test("a transversal crossing yields one parameter", () => {
    const ts = segmentContactParams(p(0, 0), p(10, 0), p(5, -5), p(5, 5));
    expect(ts).toEqual([0.5]);
  });

  test("a collinear overlap yields both ends of the overlap, sorted", () => {
    const ts = segmentContactParams(p(0, 0), p(10, 0), p(5, 0), p(15, 0));
    expect(ts[0]).toBeCloseTo(0.5, 12);
    expect(ts[ts.length - 1]).toBeCloseTo(1, 12);
    for (let i = 1; i < ts.length; i += 1) {
      expect(ts[i]!).toBeGreaterThanOrEqual(ts[i - 1]!);
    }
  });

  test("a T-touch yields the touched endpoint's parameter", () => {
    expect(segmentContactParams(p(0, 0), p(10, 0), p(3, 0), p(3, 5))).toEqual([
      0.3,
    ]);
  });

  test("a degenerate ab reduces to its endpoint test", () => {
    expect(
      segmentContactParams(p(5, 0), p(5, 0), p(0, 0), p(10, 0)),
    ).toEqual([0]);
    expect(segmentContactParams(p(5, 5), p(5, 5), p(0, 0), p(10, 0))).toEqual(
      [],
    );
  });

  test("no contact yields no parameters", () => {
    expect(segmentContactParams(p(0, 0), p(10, 0), p(0, 5), p(10, 5))).toEqual(
      [],
    );
  });
});

describe("segment distances survive the inclusive predicate", () => {
  test("segmentToSegmentDistance values are unchanged", () => {
    expect(
      segmentToSegmentDistance(p(0, 0), p(10, 10), p(0, 10), p(10, 0)),
    ).toBe(0);
    expect(
      segmentToSegmentDistance(p(0, 0), p(10, 0), p(10, 0), p(10, 5)),
    ).toBe(0);
    expect(segmentToSegmentDistance(p(0, 0), p(10, 0), p(0, 5), p(10, 5))).toBe(
      5,
    );
    expect(
      segmentToSegmentDistance(p(0, 0), p(10, 0), p(12, 3), p(20, 9)),
    ).toBeCloseTo(3.605551275463989, 12);
    expect(segmentToSegmentDistance(p(0, 0), p(10, 0), p(5, 0), p(15, 0))).toBe(
      0,
    );
  });

  test("closest points on a collinear overlap and a T-touch stay finite", () => {
    const overlap = polylineToPolylineClosestPoints(
      [p(0, 0), p(10, 0)],
      [p(5, 0), p(15, 0)],
    );
    expect(overlap.distance).toBe(0);
    expect(Number.isFinite(overlap.a.x) && Number.isFinite(overlap.a.y)).toBe(
      true,
    );
    expect(Number.isFinite(overlap.b.x) && Number.isFinite(overlap.b.y)).toBe(
      true,
    );
    const tee = polylineToPolylineClosestPoints(
      [p(0, 0), p(10, 0)],
      [p(5, 0), p(5, 5)],
    );
    expect(tee.distance).toBe(0);
    expect(Number.isFinite(tee.a.x) && Number.isFinite(tee.a.y)).toBe(true);
    expect(Number.isFinite(tee.b.x) && Number.isFinite(tee.b.y)).toBe(true);
  });
});

describe("ringSelfIntersects", () => {
  test("catches a self-touching ring and clears a simple one", () => {
    expect(
      ringSelfIntersects([p(0, 0), p(10, 0), p(10, 5), p(5, 5), p(5, 0)]),
    ).toBe(true);
    expect(ringSelfIntersects([p(0, 0), p(10, 0), p(10, 5), p(0, 5)])).toBe(
      false,
    );
  });
});

// --------------------------------------------------------------------------
// Differential check against the pre-move `segmentsIntersectInclusive`
// --------------------------------------------------------------------------

const COLLINEAR_EPS = 1e-9;

function ccw(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  q: { x: number; y: number },
) {
  return (
    q.x <= Math.max(a.x, b.x) + COLLINEAR_EPS &&
    q.x >= Math.min(a.x, b.x) - COLLINEAR_EPS &&
    q.y <= Math.max(a.y, b.y) + COLLINEAR_EPS &&
    q.y >= Math.min(a.y, b.y) - COLLINEAR_EPS
  );
}

/** Verbatim copy of the pre-S2 `outline-geometry.segmentsIntersectInclusive`. */
function legacyIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const d1 = ccw(a, b, c);
  const d2 = ccw(a, b, d);
  const d3 = ccw(c, d, a);
  const d4 = ccw(c, d, b);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  if (Math.abs(d1) <= COLLINEAR_EPS && onSegment(a, b, c)) return true;
  if (Math.abs(d2) <= COLLINEAR_EPS && onSegment(a, b, d)) return true;
  if (Math.abs(d3) <= COLLINEAR_EPS && onSegment(c, d, a)) return true;
  if (Math.abs(d4) <= COLLINEAR_EPS && onSegment(c, d, b)) return true;
  return false;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test("matches the legacy inclusive predicate on 10 000 non-degenerate pairs", () => {
  const rand = lcg(20260907);
  const pt = () => p(rand() * 10, rand() * 10);
  let compared = 0;
  for (let i = 0; i < 10_000; i += 1) {
    const a = pt();
    const b = pt();
    const c = pt();
    const d = pt();
    const ab = distance(a, b);
    const cd = distance(c, d);
    if (ab < 1e-3 || cd < 1e-3) continue;
    const margin = Math.min(
      Math.abs(orient(a, b, c)) / ab,
      Math.abs(orient(a, b, d)) / ab,
      Math.abs(orient(c, d, a)) / cd,
      Math.abs(orient(c, d, b)) / cd,
    );
    if (margin <= 1e-6) continue; // near-degenerate: the two rules may differ
    compared += 1;
    expect(segmentsIntersect(a, b, c, d)).toBe(legacyIntersect(a, b, c, d));
  }
  expect(compared).toBeGreaterThan(9_000);
});

// --------------------------------------------------------------------------
// Reviewer-critical findings (contract §9.1a)
// --------------------------------------------------------------------------

describe("reviewer findings 1 and 4", () => {
  test("closest points on a collinear overlap sit at the overlap MIDPOINT", () => {
    const cp = polylineToPolylineClosestPoints(
      [{ x: 0, y: 0 }, { x: 2, y: 0 }],
      [{ x: 1, y: 0 }, { x: 3, y: 0 }],
    );
    expect(cp.distance).toBe(0);
    expect(cp.a.x).toBeCloseTo(1.5, 12);
    expect(cp.a.y).toBeCloseTo(0, 12);
    expect(cp.b.x).toBeCloseTo(1.5, 12);
    // Direction of either polyline must not move the marker.
    const flipped = polylineToPolylineClosestPoints(
      [{ x: 2, y: 0 }, { x: 0, y: 0 }],
      [{ x: 3, y: 0 }, { x: 1, y: 0 }],
    );
    expect(flipped.a.x).toBeCloseTo(1.5, 12);
  });

  test("collinear but disjoint segments contribute no contact parameters", () => {
    expect(
      segmentContactParams(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 14, y: 0 },
        { x: 20, y: 0 },
      ),
    ).toEqual([]);
    // A collinear point touching the segment is a real contact at t = 0.5.
    const touch = segmentContactParams(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 0 },
    );
    expect(touch.length).toBeGreaterThan(0);
    for (const t of touch) expect(t).toBeCloseTo(0.5, 12);
  });
});

describe("Astra §9.2 run 2, #6: sub-nanometre segments keep their end point", () => {
  test("the end of a 0.9 nm segment lies on it", () => {
    expect(pointOnSegment({ x: 9e-7, y: 0 }, { x: 0, y: 0 }, { x: 9e-7, y: 0 })).toBe(true);
    expect(pointOnSegment({ x: 4.5e-7, y: 4e-7 }, { x: 0, y: 0 }, { x: 9e-7, y: 0 })).toBe(true);
  });
});
