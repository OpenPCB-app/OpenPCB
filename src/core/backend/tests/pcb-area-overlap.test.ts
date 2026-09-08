/**
 * The OPEN-set positive-area overlap predicates
 * (docs/pcb-hardening/03-zone-keepout-contract.md §4): does the open interior
 * of a ring / stadium / disc meet the open interior of another ring?
 *
 * These are the dual of the CLOSED board-region relations in S2 §5 — a keepout
 * has clearance 0, so touching its boundary within GEOM_EPS_MM is legal and is
 * NOT an overlap. Every predicate is open at GEOM_EPS_MM.
 */
import { describe, expect, test } from "bun:test";
import type { PcbPointMm } from "../../../sdks";
import {
  discOverlapsRing,
  ringsOverlapPositiveArea,
  stadiumOverlapsRing,
} from "../../../shared/pcb-geometry/area-overlap";
import {
  pointInPolygon,
  ringToRingEdgeDistance,
} from "../../../shared/pcb-geometry/pcb-clearance-geometry";
import { canonicalizeRing } from "../../../shared/pcb-geometry/ring-utils";
import { GEOM_EPS_MM } from "../../../shared/pcb-geometry/tolerance";

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const p = (x: number, y: number): PcbPointMm => ({ x, y });

/** Counter-clockwise axis-aligned box ring. */
const boxRing = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): PcbPointMm[] => [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)];

const reversed = (ring: readonly PcbPointMm[]): PcbPointMm[] =>
  [...ring].reverse();

/** The unit fixture: a 10 x 10 square with its lower-left corner at the origin. */
const SQUARE = boxRing(0, 0, 10, 10);

/**
 * A C-shape opening to the right: the solid left arm is x in [0, 4], the mouth
 * is the rectangle (4, 10) x (3, 7), which is OUTSIDE the polygon.
 */
const C_SHAPE: PcbPointMm[] = [
  p(0, 0),
  p(10, 0),
  p(10, 3),
  p(4, 3),
  p(4, 7),
  p(10, 7),
  p(10, 10),
  p(0, 10),
];

/** Every winding combination must give one answer. */
const bothWindings = (
  a: readonly PcbPointMm[],
  b: readonly PcbPointMm[],
): boolean[] => [
  ringsOverlapPositiveArea(a, b),
  ringsOverlapPositiveArea(b, a),
  ringsOverlapPositiveArea(reversed(a), b),
  ringsOverlapPositiveArea(a, reversed(b)),
  ringsOverlapPositiveArea(reversed(a), reversed(b)),
];

const expectOverlap = (
  a: readonly PcbPointMm[],
  b: readonly PcbPointMm[],
  want: boolean,
): void => {
  for (const got of bothWindings(a, b)) expect(got).toBe(want);
};

// --------------------------------------------------------------------------
// 1. ringsOverlapPositiveArea
// --------------------------------------------------------------------------

describe("ringsOverlapPositiveArea", () => {
  test("fewer than three vertices never overlaps", () => {
    expect(ringsOverlapPositiveArea([], SQUARE)).toBe(false);
    expect(ringsOverlapPositiveArea([p(1, 1), p(2, 2)], SQUARE)).toBe(false);
    expect(ringsOverlapPositiveArea(SQUARE, [p(1, 1), p(2, 2)])).toBe(false);
  });

  test("disjoint rings do not overlap", () => {
    expectOverlap(SQUARE, boxRing(20, 20, 30, 30), false);
    expectOverlap(SQUARE, boxRing(10.5, 0, 20, 10), false);
  });

  test("crossing bars overlap although no vertex is inside either", () => {
    const horizontal = boxRing(-10, -1, 10, 1);
    const vertical = boxRing(-1, -10, 1, 10);
    for (const v of horizontal) expect(pointInPolygon(v, vertical)).toBe(false);
    for (const v of vertical) expect(pointInPolygon(v, horizontal)).toBe(false);
    expectOverlap(horizontal, vertical, true);
  });

  test("containment overlaps in both directions", () => {
    const inner = boxRing(2, 2, 6, 6);
    expect(ringsOverlapPositiveArea(inner, SQUARE)).toBe(true);
    expect(ringsOverlapPositiveArea(SQUARE, inner)).toBe(true);
    expectOverlap(SQUARE, inner, true);
  });

  test("identical rings overlap, in either winding", () => {
    expectOverlap(SQUARE, [...SQUARE], true);
    expect(ringsOverlapPositiveArea(SQUARE, reversed(SQUARE))).toBe(true);
    // A rotation of the same vertex list is the same ring.
    const rotated = [...SQUARE.slice(2), ...SQUARE.slice(0, 2)];
    expectOverlap(SQUARE, rotated, true);
  });

  test("a full shared edge with interiors on opposite sides does not overlap", () => {
    expectOverlap(SQUARE, boxRing(10, 0, 20, 10), false);
    expectOverlap(SQUARE, boxRing(-10, 0, 0, 10), false);
    // A partial shared edge is the same answer.
    expectOverlap(SQUARE, boxRing(10, 2, 20, 8), false);
  });

  test("a shared edge with the interiors on the SAME side overlaps", () => {
    // Shares the left, bottom and right edges of the square; its interior sits
    // on the same side of each of them.
    expectOverlap(SQUARE, boxRing(0, 0, 10, 4), true);
  });

  test("a vertex touch alone does not overlap", () => {
    expectOverlap(SQUARE, boxRing(10, 10, 20, 20), false);
    expectOverlap(SQUARE, boxRing(-10, -10, 0, 0), false);
  });

  test("tangency — an edge touching a vertex — does not overlap", () => {
    const diamond = [p(10, 5), p(15, 0), p(20, 5), p(15, 10)];
    expectOverlap(SQUARE, diamond, false);
  });

  test("a bar through the mouth of a C-shape overlaps its arm", () => {
    // Both bar vertices are outside the C, and every C vertex is outside the
    // bar: only a sub-segment midpoint proves the overlap.
    const bar = boxRing(-2, 4, 12, 6);
    for (const v of bar) expect(pointInPolygon(v, C_SHAPE)).toBe(false);
    for (const v of C_SHAPE) expect(pointInPolygon(v, bar)).toBe(false);
    expectOverlap(C_SHAPE, bar, true);
  });

  test("a bar sitting inside the C's mouth does not overlap", () => {
    expectOverlap(C_SHAPE, boxRing(5, 4, 9, 6), false);
  });

  test("the boundary band is exactly GEOM_EPS_MM wide", () => {
    expect(GEOM_EPS_MM).toBe(5e-7);
    // Overlap depth 4e-7 (< eps) is float noise; 6e-7 (> eps) is an overlap.
    expectOverlap(SQUARE, boxRing(10 - 4e-7, 2, 20, 8), false);
    expectOverlap(SQUARE, boxRing(10 - 6e-7, 2, 20, 8), true);
    // Mirrored: the square penetrating the neighbour from the other side.
    expectOverlap(SQUARE, boxRing(-20, 2, 4e-7, 8), false);
    expectOverlap(SQUARE, boxRing(-20, 2, 6e-7, 8), true);
    // Exactly abutting stays clear.
    expectOverlap(SQUARE, boxRing(10, 2, 20, 8), false);
  });
});

// --------------------------------------------------------------------------
// 2. stadiumOverlapsRing
// --------------------------------------------------------------------------

describe("stadiumOverlapsRing", () => {
  test("an empty polyline or a degenerate ring sweeps nothing", () => {
    expect(stadiumOverlapsRing([], 1, SQUARE)).toBe(false);
    expect(stadiumOverlapsRing([p(5, 5), p(6, 6)], 1, [p(0, 0), p(1, 1)])).toBe(
      false,
    );
  });

  test("a centreline outside at exactly the half-width does not overlap", () => {
    const outside = [p(12, 0), p(12, 10)];
    expect(stadiumOverlapsRing(outside, 2, SQUARE)).toBe(false);
    // Closer than the half-width by more than eps.
    expect(stadiumOverlapsRing(outside, 2 + 1e-6, SQUARE)).toBe(true);
    // Closer by less than eps is still float noise.
    expect(stadiumOverlapsRing(outside, 2 + 4e-7, SQUARE)).toBe(false);
  });

  test("a centreline crossing the ring overlaps with both vertices outside", () => {
    const across = [p(-5, 5), p(15, 5)];
    for (const v of across) expect(pointInPolygon(v, SQUARE)).toBe(false);
    expect(stadiumOverlapsRing(across, 0.1, SQUARE)).toBe(true);
  });

  test("a vertex strictly inside overlaps at any usable width", () => {
    expect(stadiumOverlapsRing([p(5, 5), p(20, 5)], 0.05, SQUARE)).toBe(true);
    expect(stadiumOverlapsRing([p(5, 5), p(20, 5)], 1e-6, SQUARE)).toBe(true);
    // A half-width at or below eps has no open interior: degenerate copper,
    // never overlapping — even with a vertex deep inside.
    expect(stadiumOverlapsRing([p(5, 5), p(20, 5)], GEOM_EPS_MM, SQUARE)).toBe(
      false,
    );
    expect(stadiumOverlapsRing([p(5, 5), p(20, 5)], 0, SQUARE)).toBe(false);
  });

  test("a chord between two boundary points overlaps only with real width", () => {
    const chord = [p(0, 5), p(10, 5)];
    expect(stadiumOverlapsRing(chord, 0.2, SQUARE)).toBe(true);
    // hw ≤ eps is degenerate copper with no open interior.
    expect(stadiumOverlapsRing(chord, 0, SQUARE)).toBe(false);
    expect(stadiumOverlapsRing(chord, GEOM_EPS_MM, SQUARE)).toBe(false);
  });

  test("a multi-vertex centreline is tested per segment", () => {
    // An L whose corner sits in the C's mouth but whose second leg cuts the arm.
    const l = [p(12, 5), p(6, 5), p(6, 12)];
    expect(stadiumOverlapsRing(l, 0.1, C_SHAPE)).toBe(true);
    // The same L clipped to the mouth touches nothing.
    expect(
      stadiumOverlapsRing([p(12, 5), p(6, 5), p(6, 6.5)], 0.1, C_SHAPE),
    ).toBe(false);
  });

  test("the eps band is fail-CLOSED for a stadium", () => {
    // `polylineToRingEdgeDistance` short-circuits to 0 through the inclusive
    // `segmentsIntersect`, so a centreline within eps of the boundary reads as
    // distance 0 and every usable half-width overlaps. Pinned deliberately: it
    // is the opposite tilt from the disc below.
    const grazingInside = [p(10 - 4e-7, 2), p(10 - 4e-7, 8)];
    const grazingOutside = [p(10 + 4e-7, 2), p(10 + 4e-7, 8)];
    expect(stadiumOverlapsRing(grazingInside, 8e-7, SQUARE)).toBe(true);
    expect(stadiumOverlapsRing(grazingOutside, 8e-7, SQUARE)).toBe(true);
    // Below the degenerate-copper threshold nothing is reported either way.
    expect(stadiumOverlapsRing(grazingInside, GEOM_EPS_MM, SQUARE)).toBe(false);
    expect(stadiumOverlapsRing(grazingOutside, GEOM_EPS_MM, SQUARE)).toBe(
      false,
    );
  });

  test("a single-point polyline behaves as a disc", () => {
    expect(stadiumOverlapsRing([p(5, 5)], 0, SQUARE)).toBe(false);
    expect(stadiumOverlapsRing([p(5, 5)], 1e-6, SQUARE)).toBe(true);
    expect(stadiumOverlapsRing([p(12, 5)], 1, SQUARE)).toBe(false);
    expect(stadiumOverlapsRing([p(12, 5)], 2, SQUARE)).toBe(false);
    expect(stadiumOverlapsRing([p(12, 5)], 2 + 1e-6, SQUARE)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 3. discOverlapsRing
// --------------------------------------------------------------------------

describe("discOverlapsRing", () => {
  test("a degenerate ring never overlaps", () => {
    expect(discOverlapsRing(p(0, 0), 5, [p(0, 0), p(1, 0)])).toBe(false);
  });

  test("a centre strictly inside overlaps at any usable radius", () => {
    expect(discOverlapsRing(p(5, 5), 1, SQUARE)).toBe(true);
    expect(discOverlapsRing(p(5, 5), 1e-6, SQUARE)).toBe(true);
    // A radius at or below eps has no open interior: never overlapping.
    expect(discOverlapsRing(p(5, 5), GEOM_EPS_MM, SQUARE)).toBe(false);
    expect(discOverlapsRing(p(5, 5), 0, SQUARE)).toBe(false);
  });

  test("the radius band is exactly GEOM_EPS_MM wide", () => {
    const centre = p(12, 5); // 2 mm outside the right edge
    expect(discOverlapsRing(centre, 2 + 1e-6, SQUARE)).toBe(true);
    expect(discOverlapsRing(centre, 2, SQUARE)).toBe(false);
    expect(discOverlapsRing(centre, 2 + GEOM_EPS_MM, SQUARE)).toBe(false);
    expect(discOverlapsRing(centre, 2 - 1e-6, SQUARE)).toBe(false);
  });

  test("a centre on the boundary overlaps only with a usable radius", () => {
    expect(discOverlapsRing(p(10, 5), 0.5, SQUARE)).toBe(true);
    expect(discOverlapsRing(p(10, 5), 0, SQUARE)).toBe(false);
    expect(discOverlapsRing(p(10, 5), GEOM_EPS_MM, SQUARE)).toBe(false);
    // A corner is boundary too.
    expect(discOverlapsRing(p(10, 10), 0.5, SQUARE)).toBe(true);
    expect(discOverlapsRing(p(10, 10), 0, SQUARE)).toBe(false);
  });

  test("the eps band is fail-OPEN for a disc", () => {
    // `pointToRingEdgeDistance` is exact, so a centre inside the ring but
    // within eps of it is neither strictly inside nor closer than r - eps while
    // eps < r <= 2 * eps. Sub-nanometre; pinned so the tilt stays deliberate.
    expect(discOverlapsRing(p(10 - 4e-7, 5), 8e-7, SQUARE)).toBe(false);
    expect(discOverlapsRing(p(10 - 4e-7, 5), 2e-6, SQUARE)).toBe(true);
  });

  test("a disc inside the C's mouth reaches the arm only when wide enough", () => {
    expect(discOverlapsRing(p(6, 5), 1.9, C_SHAPE)).toBe(false);
    expect(discOverlapsRing(p(6, 5), 2.1, C_SHAPE)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 4. Randomized cross-check against an exact convex intersection area
// --------------------------------------------------------------------------

/** Deterministic PRNG — the cross-check must never be flaky. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Andrew's monotone chain — counter-clockwise hull, no collinear vertices. */
function convexHull(points: readonly PcbPointMm[]): PcbPointMm[] {
  const pts = [...points].sort((u, v) => u.x - v.x || u.y - v.y);
  const cross = (o: PcbPointMm, a: PcbPointMm, b: PcbPointMm): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (source: PcbPointMm[]): PcbPointMm[] => {
    const out: PcbPointMm[] = [];
    for (const q of source) {
      while (
        out.length >= 2 &&
        cross(out[out.length - 2]!, out[out.length - 1]!, q) <= 0
      ) {
        out.pop();
      }
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/** Sutherland-Hodgman: subject ∩ clip, both convex and counter-clockwise. */
function clipConvex(
  subject: readonly PcbPointMm[],
  clip: readonly PcbPointMm[],
): PcbPointMm[] {
  let out: PcbPointMm[] = [...subject];
  for (let i = 0; i < clip.length && out.length > 0; i += 1) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const side = (q: PcbPointMm): number =>
      (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k += 1) {
      const cur = input[k]!;
      const prev = input[(k + input.length - 1) % input.length]!;
      const sCur = side(cur);
      const sPrev = side(prev);
      if (sCur >= 0) {
        if (sPrev < 0) {
          const t = sPrev / (sPrev - sCur);
          out.push(
            p(prev.x + (cur.x - prev.x) * t, prev.y + (cur.y - prev.y) * t),
          );
        }
        out.push(cur);
      } else if (sPrev >= 0) {
        const t = sPrev / (sPrev - sCur);
        out.push(
          p(prev.x + (cur.x - prev.x) * t, prev.y + (cur.y - prev.y) * t),
        );
      }
    }
  }
  return out;
}

function ringArea(ring: readonly PcbPointMm[]): number {
  if (ring.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const u = ring[i]!;
    const v = ring[(i + 1) % ring.length]!;
    a += u.x * v.y - v.x * u.y;
  }
  return Math.abs(a) / 2;
}

describe("randomized cross-check on convex rings", () => {
  test("agrees with an exact convex intersection area away from the eps band", () => {
    const rand = mulberry32(0x5eed_beef);
    let checkedOverlapping = 0;
    let checkedDisjoint = 0;

    for (let i = 0; i < 2000; i += 1) {
      const ring = (): PcbPointMm[] => {
        const cx = (rand() - 0.5) * 10;
        const cy = (rand() - 0.5) * 10;
        const n = 3 + Math.floor(rand() * 6);
        const cloud: PcbPointMm[] = [];
        for (let k = 0; k < n; k += 1) {
          cloud.push(p(cx + (rand() - 0.5) * 6, cy + (rand() - 0.5) * 6));
        }
        return canonicalizeRing(convexHull(cloud));
      };
      const a = ring();
      const b = ring();
      if (a.length < 3 || b.length < 3) continue;

      const area = ringArea(clipConvex(a, b));
      const got = ringsOverlapPositiveArea(a, b);

      if (area > 1e-4) {
        // Comfortably positive area — must be reported as overlapping.
        expect(got).toBe(true);
        checkedOverlapping += 1;
      } else if (area === 0 && ringToRingEdgeDistance(a, b) > 1e-3) {
        // Empty intersection and well clear of the eps band on both sides.
        expect(got).toBe(false);
        checkedDisjoint += 1;
      }
    }

    // The corpus must actually exercise both verdicts.
    expect(checkedOverlapping).toBeGreaterThan(200);
    expect(checkedDisjoint).toBeGreaterThan(200);
  });
});

describe("nearly coincident rings (Astra finding 5)", () => {
  test("two squares offset by less than eps overlap through the collinear-piece rule", () => {
    const sq = (a: number, b: number) => [p(a, a), p(b, a), p(b, b), p(a, b)];
    const d = 2.5e-7;
    expect(ringsOverlapPositiveArea(sq(1, 2), sq(1 + d, 2 + d))).toBe(true);
    expect(ringsOverlapPositiveArea(sq(1, 2), sq(1 + 6e-7, 2 + 6e-7))).toBe(true);
    expect(
      ringsOverlapPositiveArea(sq(1, 2), [
        p(1 + d, 1 - d),
        p(2 + d, 1 + d),
        p(2 - d, 2 + d),
        p(1 - d, 2 - d),
      ]),
    ).toBe(true);
  });
});
