/**
 * S6 §4.4 kernels: `segmentClosestPoints`, `segmentToRingClosestPoints` and
 * `splitSegmentAtRings`. These live under `src/shared/pcb-geometry/`, which the
 * frontend Vitest `include` does NOT cover — they are pinned here (Bun) or
 * nowhere.
 */
import { describe, expect, test } from "bun:test";
import { segmentToRingClosestPoints } from "../../../shared/pcb-geometry/pcb-clearance-geometry";
import { segmentClosestPoints } from "../../../shared/pcb-geometry/pcb-trace-geometry";
import { splitSegmentAtRings } from "../../../shared/pcb-geometry/region-rings";

const p = (x: number, y: number) => ({ x, y });
/** Unit square (0,0)–(2,2), counter-clockwise. */
const SQUARE = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)];

describe("segmentClosestPoints", () => {
  test("parallel segments: the gap is the perpendicular offset", () => {
    const r = segmentClosestPoints(p(0, 0), p(2, 0), p(0, 0.4), p(2, 0.4));
    expect(r.distance).toBeCloseTo(0.4, 12);
    expect(r.a.y).toBeCloseTo(0, 12);
    expect(r.b.y).toBeCloseTo(0.4, 12);
  });

  test("crossing segments: distance 0 at the intersection, both points equal", () => {
    const r = segmentClosestPoints(p(0, 0), p(2, 0), p(1, -1), p(1, 1));
    expect(r.distance).toBe(0);
    expect(r.a).toEqual(r.b);
    expect(r.a.x).toBeCloseTo(1, 12);
    expect(r.a.y).toBeCloseTo(0, 12);
  });

  test("collinear overlap: distance 0 at the MIDDLE of the overlap", () => {
    // A stable marker spot: not whichever overlap end a projection visits first.
    const r = segmentClosestPoints(p(0, 0), p(4, 0), p(2, 0), p(6, 0));
    expect(r.distance).toBe(0);
    expect(r.a.x).toBeCloseTo(3, 12);
    expect(r.a).toEqual(r.b);
  });

  test("degenerate (zero-length) segment behaves as its point", () => {
    const r = segmentClosestPoints(p(1, 1), p(1, 1), p(0, 0), p(2, 0));
    expect(r.distance).toBeCloseTo(1, 12);
    expect(r.a).toEqual(p(1, 1));
    expect(r.b.y).toBeCloseTo(0, 12);
  });

  test("skew segments: the minimum is an endpoint projection", () => {
    const r = segmentClosestPoints(p(0, 0), p(1, 0), p(2, 1), p(3, 3));
    expect(r.distance).toBeCloseTo(Math.hypot(1, 1), 12);
  });
});

describe("segmentToRingClosestPoints", () => {
  test("outside the ring: the perpendicular distance to the nearest edge", () => {
    const r = segmentToRingClosestPoints(p(-1, 3), p(3, 3), SQUARE);
    expect(r.distance).toBeCloseTo(1, 12);
    expect(r.onRing.y).toBeCloseTo(2, 12);
  });

  test("touching the ring: distance 0", () => {
    const r = segmentToRingClosestPoints(p(-1, 2), p(3, 2), SQUARE);
    expect(r.distance).toBe(0);
  });

  test("one endpoint inside: distance 0 (the filled-polygon convention)", () => {
    const r = segmentToRingClosestPoints(p(1, 1), p(5, 5), SQUARE);
    expect(r.distance).toBe(0);
  });

  test("wholly inside, meeting no edge: still distance 0", () => {
    const r = segmentToRingClosestPoints(p(0.8, 1), p(1.2, 1), SQUARE);
    expect(r.distance).toBe(0);
  });

  test("a ring with fewer than two points has no distance", () => {
    expect(segmentToRingClosestPoints(p(0, 0), p(1, 0), [p(0, 0)]).distance).toBe(
      Infinity,
    );
  });
});

describe("splitSegmentAtRings", () => {
  test("a segment crossing a ring is split into inside and outside parts", () => {
    const parts = splitSegmentAtRings(p(-1, 1), p(3, 1), [SQUARE]);
    expect(parts).toHaveLength(3);
    expect(parts[0]!.a.x).toBeCloseTo(-1, 12);
    expect(parts[0]!.b.x).toBeCloseTo(0, 12);
    expect(parts[1]!.b.x).toBeCloseTo(2, 12);
    expect(parts[2]!.b.x).toBeCloseTo(3, 12);
    // Contiguous and in order from a to b.
    expect(parts[0]!.b).toEqual(parts[1]!.a);
    expect(parts[1]!.b).toEqual(parts[2]!.a);
  });

  test("a segment that meets no ring comes back whole", () => {
    const parts = splitSegmentAtRings(p(-5, -5), p(-4, -5), [SQUARE]);
    expect(parts).toEqual([{ a: p(-5, -5), b: p(-4, -5) }]);
  });

  test("a zero-length segment is still evaluated once", () => {
    expect(splitSegmentAtRings(p(1, 1), p(1, 1), [SQUARE])).toHaveLength(1);
  });

  test("splits accumulate across several rings, in order", () => {
    const far = [p(4, 0), p(6, 0), p(6, 2), p(4, 2)];
    const parts = splitSegmentAtRings(p(-1, 1), p(7, 1), [SQUARE, far]);
    expect(parts).toHaveLength(5);
    const xs = parts.map((s) => s.a.x);
    expect(xs).toEqual([...xs].sort((m, n) => m - n));
  });
});
