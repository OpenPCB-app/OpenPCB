/**
 * The exact arc kernel and the canonical contour
 * (docs/pcb-hardening/12-exact-geometry-contract.md §2).
 *
 * The distance and intersection kernels are judged against DENSE SAMPLING, not
 * against a second closed form: 16384 samples per curve, and the exact answer
 * must be at or below the sampled minimum (it is a true minimum over a superset)
 * and within 1e-6 mm of it (it is the RIGHT minimum). `pointToArcDistance` is
 * validated first against raw point sampling with no oracle logic at all, and
 * only then reused as the inner term of the curve-to-curve oracles.
 */
import { describe, expect, test } from "bun:test";
import type {
  PcbBoardContour,
  PcbBoardOutline,
  PcbOutlineSegment,
  PcbPointMm,
} from "../../../sdks";
import {
  canonicalContour,
  canonicalDisplacementBound,
} from "../../../shared/pcb-geometry/canonical-contour";
import {
  arcArcIntersections,
  arcPointAt,
  arcToArcDistance,
  type ExactArc,
  exactArcFromPoints,
  pointToArcDistance,
  pointToPrimDistance,
  primsIntersect,
  segmentArcIntersections,
  segmentToArcDistance,
} from "../../../shared/pcb-geometry/exact-arcs";
import { pointInExactRing } from "../../../shared/pcb-geometry/exact-ring";
import {
  exactContour,
  exactContourBounds,
  exactRingSignedArea,
  outlineChordBoundMm,
} from "../../../shared/pcb-geometry/exact-contour";
import {
  contourSignedArea,
  flattenOutline,
  MAX_ARC_SEGMENTS,
  MAX_CHORD_DEVIATION_MM,
} from "../../../shared/pcb-geometry/outline-geometry";
import { pointInPolygon } from "../../../shared/pcb-geometry/pcb-clearance-geometry";
import { projectPointToSegment } from "../../../shared/pcb-geometry/segment-predicates";
import { GEOM_EPS_MM } from "../../../shared/pcb-geometry/tolerance";

const p = (x: number, y: number): PcbPointMm => ({ x, y });
const SAMPLES = 16_384;
/** Sampling is a SUPERSET minimum, so the exact answer may never exceed it. */
const SAMPLE_TOL_MM = 1e-6;

function arc(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  sweep: number,
): ExactArc {
  const c = p(cx, cy);
  return {
    kind: "arc",
    c,
    r,
    a0,
    sweep,
    a: { x: cx + Math.cos(a0) * r, y: cy + Math.sin(a0) * r },
    b: { x: cx + Math.cos(a0 + sweep) * r, y: cy + Math.sin(a0 + sweep) * r },
  };
}

function arcSamples(a: ExactArc, n = SAMPLES): PcbPointMm[] {
  const out: PcbPointMm[] = [];
  for (let i = 0; i <= n; i += 1) {
    out.push(arcPointAt(a, a.a0 + (a.sweep * i) / n));
  }
  return out;
}

function agreesWithSampling(exactMm: number, sampledMm: number): void {
  expect(exactMm).toBeLessThanOrEqual(sampledMm + 1e-12);
  expect(sampledMm - exactMm).toBeLessThan(SAMPLE_TOL_MM);
}

// --------------------------------------------------------------------------
// 1. Point ↔ arc — raw sampling, no oracle logic
// --------------------------------------------------------------------------

describe("pointToArcDistance", () => {
  const quarters: Array<[string, ExactArc]> = [
    ["Q1", arc(0, 0, 1, 0, Math.PI / 2)],
    ["Q2", arc(0, 0, 1, Math.PI / 2, Math.PI / 2)],
    ["Q3", arc(0, 0, 1, Math.PI, Math.PI / 2)],
    ["Q4", arc(0, 0, 1, -Math.PI / 2, Math.PI / 2)],
    ["CW across 0", arc(0, 0, 1, Math.PI / 4, -Math.PI / 2)],
    ["three quarters", arc(2, -1, 3, 0.3, (3 * Math.PI) / 2)],
    ["full circle", arc(-1, 4, 2.5, 1.1, Math.PI * 2)],
  ];

  for (const [name, a] of quarters) {
    test(`matches dense sampling in every direction (${name})`, () => {
      const samples = arcSamples(a);
      for (let k = 0; k < 32; k += 1) {
        const t = (k / 32) * Math.PI * 2;
        for (const radius of [0, 0.25, 1, 1.5, 4]) {
          const q = p(a.c.x + Math.cos(t) * radius, a.c.y + Math.sin(t) * radius);
          let sampled = Infinity;
          for (const s of samples) {
            const d = Math.hypot(s.x - q.x, s.y - q.y);
            if (d < sampled) sampled = d;
          }
          agreesWithSampling(pointToArcDistance(q, a), sampled);
        }
      }
    });
  }

  test("a point AT the centre is exactly r away, witnessed at the start", () => {
    const a = arc(3, -2, 1.75, Math.PI / 3, Math.PI / 2);
    expect(pointToArcDistance(a.c, a)).toBe(1.75);
  });

  test("a zero-radius arc collapses to its centre", () => {
    const a = arc(1, 1, 0, 0, Math.PI);
    expect(pointToArcDistance(p(4, 5), a)).toBeCloseTo(5, 12);
  });
});

// --------------------------------------------------------------------------
// 2. Segment ↔ arc
// --------------------------------------------------------------------------

function sampledSegToArc(
  s0: PcbPointMm,
  s1: PcbPointMm,
  a: ExactArc,
): number {
  let best = Infinity;
  for (const s of arcSamples(a)) {
    const d = projectPointToSegment(s, s0, s1).distance;
    if (d < best) best = d;
  }
  return best;
}

describe("segmentToArcDistance", () => {
  const unit = arc(0, 0, 1, 0, Math.PI);

  const cases: Array<[string, PcbPointMm, PcbPointMm, ExactArc]> = [
    ["separated, radial foot in range", p(-3, 2), p(3, 2), unit],
    ["separated, foot out of range", p(-3, -2), p(3, -2), unit],
    ["inside the circle", p(-0.4, 0.1), p(0.4, 0.1), unit],
    ["centre on the segment", p(-0.5, 0), p(0.5, 0), unit],
    ["endpoint-driven", p(2, 0), p(4, 4), unit],
    ["zero-length segment", p(0, 3), p(0, 3), unit],
    ["zero-length segment at the centre", p(0, 0), p(0, 0), unit],
    ["cw arc, other quadrant", p(-4, -4), p(-2, 0.5), arc(0, 0, 2, 1, -2.5)],
    ["nested far away", p(40, 40), p(41, 42), arc(0, 0, 1, 0, Math.PI * 2)],
  ];

  for (const [name, s0, s1, a] of cases) {
    test(name, () => {
      agreesWithSampling(
        segmentToArcDistance(s0, s1, a),
        sampledSegToArc(s0, s1, a),
      );
    });
  }

  test("a crossing chord whose endpoints are both far from the arc is 0", () => {
    // The candidate families alone read 0.030 here: the chord at y = 0.9 cuts
    // the unit semicircle at x = ±0.436 while every endpoint stays clear.
    expect(segmentToArcDistance(p(-0.5, 0.9), p(0.5, 0.9), unit)).toBe(0);
    expect(segmentArcIntersections(p(-0.5, 0.9), p(0.5, 0.9), unit)).toHaveLength(2);
  });

  test("tangency is one point, and the distance is 0", () => {
    const hits = segmentArcIntersections(p(-2, 1), p(2, 1), unit);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.x).toBeCloseTo(0, 6);
    expect(hits[0]!.y).toBeCloseTo(1, 6);
  });

  test("a segment that only grazes the arc's endpoint intersects there", () => {
    const hits = segmentArcIntersections(p(1, 0), p(3, 3), unit);
    expect(hits).toHaveLength(1);
    expect(hits[0]!).toEqual(p(1, 0));
  });

  test("a zero-length segment ON the arc intersects; one off it does not", () => {
    expect(segmentArcIntersections(p(0, 1), p(0, 1), unit)).toHaveLength(1);
    expect(segmentArcIntersections(p(0, 1.5), p(0, 1.5), unit)).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// 3. Arc ↔ arc
// --------------------------------------------------------------------------

function sampledArcToArc(a: ExactArc, b: ExactArc): number {
  let best = Infinity;
  for (const s of arcSamples(a)) {
    const d = pointToArcDistance(s, b);
    if (d < best) best = d;
  }
  return best;
}

describe("arcToArcDistance", () => {
  const cases: Array<[string, ExactArc, ExactArc]> = [
    ["separated circles", arc(0, 0, 1, 0, Math.PI), arc(5, 0, 1, 0, Math.PI * 2)],
    ["nested circles", arc(0, 0, 3, 0, Math.PI * 2), arc(1, 0, 1, 0, Math.PI * 2)],
    [
      "nested, only the far side in range",
      arc(0, 0, 3, Math.PI / 2, Math.PI),
      arc(1, 0, 1, -Math.PI / 2, Math.PI),
    ],
    ["concentric, ranges overlap", arc(0, 0, 2, 0, Math.PI), arc(0, 0, 3, 0.5, 1)],
    [
      "concentric, ranges disjoint",
      arc(0, 0, 2, 0, Math.PI / 4),
      arc(0, 0, 3, Math.PI, Math.PI / 4),
    ],
    [
      "same circle, disjoint ranges",
      arc(0, 0, 2, 0, Math.PI / 4),
      arc(0, 0, 2, Math.PI / 2, Math.PI / 4),
    ],
    [
      "opposite quadrants of separated circles",
      arc(-4, -4, 2, Math.PI / 2, Math.PI / 2),
      arc(4, 4, 1.5, -Math.PI, Math.PI / 2),
    ],
    ["cw vs ccw", arc(0, 0, 1, 2, -3), arc(0, 3.5, 1, 0.2, 2.2)],
  ];

  for (const [name, a, b] of cases) {
    test(name, () => {
      const exact = arcToArcDistance(a, b);
      agreesWithSampling(exact, sampledArcToArc(a, b));
      // Symmetric by construction, and the same number either way round.
      expect(arcToArcDistance(b, a)).toBeCloseTo(exact, 12);
    });
  }

  test("concentric circles report the radial gap at a shared angle", () => {
    const a = arc(0, 0, 2, 0, Math.PI);
    const b = arc(0, 0, 3, 0.5, 1);
    expect(arcToArcDistance(a, b)).toBeCloseTo(1, 12);
  });

  test("coincident circles with overlapping ranges are a retrace", () => {
    const a = arc(0, 0, 2, 0, Math.PI);
    const b = arc(0, 0, 2, Math.PI / 2, Math.PI);
    const hits = arcArcIntersections(a, b);
    expect(hits.overlap).toBe(true);
    expect(arcToArcDistance(a, b)).toBe(0);
  });

  test("coincident circles with disjoint ranges are not a retrace", () => {
    const a = arc(0, 0, 2, 0, Math.PI / 4);
    const b = arc(0, 0, 2, Math.PI / 2, Math.PI / 4);
    expect(arcArcIntersections(a, b).overlap).toBe(false);
    expect(arcToArcDistance(a, b)).toBeGreaterThan(0);
  });

  test("externally tangent circles meet at exactly one point", () => {
    const hits = arcArcIntersections(
      arc(0, 0, 1, 0, Math.PI * 2),
      arc(2, 0, 1, 0, Math.PI * 2),
    );
    expect(hits.points).toHaveLength(1);
    expect(hits.points[0]!.x).toBeCloseTo(1, 6);
    expect(hits.points[0]!.y).toBeCloseTo(0, 6);
  });

  test("internally tangent circles meet at exactly one point", () => {
    const hits = arcArcIntersections(
      arc(0, 0, 3, 0, Math.PI * 2),
      arc(1, 0, 2, 0, Math.PI * 2),
    );
    expect(hits.points).toHaveLength(1);
    expect(hits.points[0]!.x).toBeCloseTo(3, 6);
    expect(hits.points[0]!.y).toBeCloseTo(0, 6);
  });

  test("crossing circles meet at two points, each on both arcs", () => {
    const a = arc(0, 0, 1, 0, Math.PI * 2);
    const b = arc(1, 0, 1, 0, Math.PI * 2);
    const hits = arcArcIntersections(a, b);
    expect(hits.points).toHaveLength(2);
    for (const hit of hits.points) {
      expect(pointToArcDistance(hit, a)).toBeLessThanOrEqual(GEOM_EPS_MM);
      expect(pointToArcDistance(hit, b)).toBeLessThanOrEqual(GEOM_EPS_MM);
    }
    expect(primsIntersect(a, b)).toBe(true);
  });

  test("nested circles never intersect", () => {
    expect(
      primsIntersect(arc(0, 0, 3, 0, Math.PI * 2), arc(0.5, 0, 1, 0, Math.PI * 2)),
    ).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 4. Segment ↔ segment through the prim dispatch
// --------------------------------------------------------------------------

describe("primsIntersect on straight pieces", () => {
  const seg = (a: PcbPointMm, b: PcbPointMm) =>
    ({ kind: "seg", a, b }) as const;

  test("collinear overlap is a contact", () => {
    expect(primsIntersect(seg(p(0, 0), p(10, 0)), seg(p(5, 0), p(15, 0)))).toBe(
      true,
    );
  });

  test("collinear but disjoint is not", () => {
    expect(primsIntersect(seg(p(0, 0), p(10, 0)), seg(p(11, 0), p(15, 0)))).toBe(
      false,
    );
  });

  test("a zero-length segment on another segment is a contact", () => {
    expect(primsIntersect(seg(p(5, 0), p(5, 0)), seg(p(0, 0), p(10, 0)))).toBe(
      true,
    );
    expect(primsIntersect(seg(p(5, 1), p(5, 1)), seg(p(0, 0), p(10, 0)))).toBe(
      false,
    );
  });
});

// --------------------------------------------------------------------------
// 5. pointInExactRing
// --------------------------------------------------------------------------

const line = (x: number, y: number): PcbOutlineSegment => ({
  type: "line",
  to: p(x, y),
});
const arcSeg = (
  x: number,
  y: number,
  cx: number,
  cy: number,
  cw = false,
): PcbOutlineSegment => ({ type: "arc", to: p(x, y), centerMm: p(cx, cy), cw });

function contour(
  start: PcbPointMm,
  segments: PcbOutlineSegment[],
): PcbBoardContour {
  return {
    kind: "contour",
    widthMm: 0,
    heightMm: 0,
    centerMm: p(0, 0),
    start,
    segments,
  };
}

/** Deterministic pseudo-random sampler — no `Math.random` in a DRC test. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

describe("pointInExactRing", () => {
  const roundrect: PcbBoardOutline = {
    kind: "roundrect",
    widthMm: 20,
    heightMm: 12,
    centerMm: p(0, 0),
    cornerRadiusMm: 5,
  };

  test("agrees with pointInPolygon on a finely flattened ring", () => {
    const exact = exactContour(roundrect);
    const prims = "prims" in exact ? exact.prims : [];
    const fine = flattenOutline(roundrect, { stepMultiplier: 64 });
    const rnd = lcg(20260911);
    let compared = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const q = p(rnd() * 26 - 13, rnd() * 18 - 9);
      // Away from the boundary the chord error (≤ 2e-5 here) cannot flip the
      // verdict, so the two models must agree exactly.
      let clearance = Infinity;
      for (const prim of prims) {
        const d = pointToPrimDistance(q, prim);
        if (d < clearance) clearance = d;
      }
      if (clearance < 1e-3) continue;
      compared += 1;
      expect(pointInExactRing(exact, q) === "inside").toBe(
        pointInPolygon(q, fine),
      );
    }
    expect(compared).toBeGreaterThan(9000);
  });

  test("the boundary is reported as its own answer", () => {
    const exact = exactContour(roundrect);
    expect(pointInExactRing(exact, p(10, 0))).toBe("boundary");
    expect(pointInExactRing(exact, p(0, 6))).toBe("boundary");
    expect(pointInExactRing(exact, p(0, 0))).toBe("inside");
    expect(pointInExactRing(exact, p(0, 100))).toBe("outside");
  });

  const circle: PcbBoardOutline = {
    kind: "circle",
    widthMm: 6,
    heightMm: 6,
    centerMm: p(1, 2),
  };

  test("a ray through the two shared vertices of a two-arc circle", () => {
    const exact = exactContour(circle);
    // y = c.y passes through BOTH arc endpoints; each is a monotone crossing
    // and must be counted exactly once.
    expect(pointInExactRing(exact, p(1, 2))).toBe("inside");
    expect(pointInExactRing(exact, p(-10, 2))).toBe("outside");
    expect(pointInExactRing(exact, p(10, 2))).toBe("outside");
  });

  test("a ray through a y-extremum: a maximum gives none, a minimum two", () => {
    const exact = exactContour(circle);
    // Top (local max, interior of the first arc): zero crossings either side.
    expect(pointInExactRing(exact, p(-10, 5))).toBe("outside");
    expect(pointInExactRing(exact, p(10, 5))).toBe("outside");
    // Bottom (local min, interior of the second arc): two crossings, so a point
    // to the left is still OUTSIDE — the multiplicity is what keeps it even.
    expect(pointInExactRing(exact, p(-10, -1))).toBe("outside");
  });

  test("a ray along a horizontal segment and through a segment–arc vertex", () => {
    // A stadium: two horizontal segments joined by two semicircular caps.
    const stadium = contour(p(-5, -3), [
      line(5, -3),
      arcSeg(5, 3, 5, 0),
      line(-5, 3),
      arcSeg(-5, -3, -5, 0),
    ]);
    const exact = exactContour(stadium);
    // y = -3 runs ALONG the bottom segment and through both of its vertices.
    // The horizontal piece is ignored; the two cap pieces that own that y decide.
    expect(pointInExactRing(exact, p(0, -3))).toBe("boundary");
    expect(pointInExactRing(exact, p(-20, -3))).toBe("outside");
    expect(pointInExactRing(exact, p(20, -3))).toBe("outside");
    expect(pointInExactRing(exact, p(0, 0))).toBe("inside");
    expect(pointInExactRing(exact, p(7.9, 0))).toBe("inside");
    expect(pointInExactRing(exact, p(8.1, 0))).toBe("outside");
  });

  test("a tangent point on the ray is on the boundary, not a crossing", () => {
    const exact = exactContour(circle);
    // The cap of the circle: exactly one tangent touch at (1, 5).
    expect(pointInExactRing(exact, p(1, 5))).toBe("boundary");
  });
});

// --------------------------------------------------------------------------
// 6. canonicalContour
// --------------------------------------------------------------------------

describe("canonicalContour", () => {
  test("a conforming contour comes back verbatim (same array identity)", () => {
    const c = contour(p(0, 0), [line(10, 0), arcSeg(15, 5, 10, 5), line(0, 5), line(0, 0)]);
    expect(canonicalContour(c).segments).toBe(c.segments);
  });

  test("is idempotent", () => {
    const c = contour(p(0, 0), [arcSeg(10, 0.05, 5, 0), line(0, 10), line(0, 0)]);
    const once = canonicalContour(c);
    const twice = canonicalContour(once);
    expect(twice.segments).toEqual(once.segments);
    expect(twice.segments).toBe(once.segments);
  });

  test("a single arc's end moves by at most max(1e-3, 1e-3·r)", () => {
    // Arcs separated by lines: each run is one arc long, so the bound is the
    // band itself rather than the chained multiple.
    const c = contour(p(1, 0), [
      arcSeg(0, 1.0009, 0, 0),
      line(0, 0),
      line(-1, 0),
      arcSeg(0, -1.0007, 0, 0, true),
      line(0, 0),
      line(1, 0),
    ]);
    const canonical = canonicalContour(c);
    const bound = canonicalDisplacementBound(c);
    expect(bound).toBeCloseTo(1e-3, 12);
    const authored = c.segments;
    for (let i = 0; i < authored.length; i += 1) {
      const moved = Math.hypot(
        canonical.segments[i]!.to.x - authored[i]!.to.x,
        canonical.segments[i]!.to.y - authored[i]!.to.y,
      );
      expect(moved).toBeLessThanOrEqual(bound);
    }
  });

  test("consecutive arcs CHAIN: the second endpoint moves 0.0018", () => {
    // Three same-centre quarter arcs at authored radii 1 / 1.0009 / 1.0018.
    const c = contour(p(1, 0), [
      arcSeg(0, 1.0009, 0, 0),
      arcSeg(-1.0018, 0, 0, 0),
      line(0, 0),
      line(1, 0),
    ]);
    const canonical = canonicalContour(c);
    const first = canonical.segments[0]!.to;
    const second = canonical.segments[1]!.to;
    expect(Math.hypot(first.x - 0, first.y - 1.0009)).toBeCloseTo(0.0009, 9);
    expect(Math.hypot(second.x + 1.0018, second.y)).toBeCloseTo(0.0018, 9);
    // Both ends sit on the start-radius circle of 1.
    expect(Math.hypot(first.x, first.y)).toBeCloseTo(1, 12);
    expect(Math.hypot(second.x, second.y)).toBeCloseTo(1, 12);
    // The a-priori bound covers the chained displacement.
    expect(canonicalDisplacementBound(c)).toBeGreaterThanOrEqual(0.0018);
  });

  test("Astra #9: the closure gap becomes an explicit 0.0005 mm segment", () => {
    const c = contour(p(1, 0), [
      line(0, 0),
      line(-1.0005, 0),
      arcSeg(1, 0, 0, 0, true),
    ]);
    const canonical = canonicalContour(c);
    expect(canonical.segments).toHaveLength(4);
    const closing = canonical.segments[3]!;
    expect(closing.type).toBe("line");
    expect(closing.to).toEqual(p(1, 0));
    const arcEnd = canonical.segments[2]!.to;
    expect(arcEnd.x).toBeCloseTo(1.0005, 12);
    expect(Math.hypot(arcEnd.x - 1, arcEnd.y)).toBeCloseTo(0.0005, 12);
    // ... and adding it a second time is a no-op.
    expect(canonicalContour(canonical).segments).toBe(canonical.segments);
  });

  test("no closing segment when the chain already lands on start", () => {
    const c = contour(p(1, 0), [line(0, 0), line(-1, 0), arcSeg(1, 0, 0, 0, true)]);
    expect(canonicalContour(c).segments).toHaveLength(3);
  });
});

// --------------------------------------------------------------------------
// 7. exactContour: area, bounds, the ellipse arm
// --------------------------------------------------------------------------

describe("exactContour", () => {
  const fixtures: Array<[string, PcbBoardContour]> = [
    [
      "quarter-arc corner",
      contour(p(0, 0), [line(10, 0), arcSeg(15, 5, 10, 5), line(15, 20), line(0, 20), line(0, 0)]),
    ],
    [
      "clockwise notch",
      contour(p(0, 0), [line(10, 0), arcSeg(6, 0, 8, 0, true), line(6, 8), line(0, 8), line(0, 0)]),
    ],
    [
      "reversed winding",
      contour(p(0, 0), [line(0, 20), line(15, 20), arcSeg(10, 0, 10, 5, true), line(0, 0)]),
    ],
    [
      "mismatched radii (canonicalised)",
      contour(p(1, 0), [arcSeg(0, 1.0009, 0, 0), arcSeg(-1.0018, 0, 0, 0), line(0, 0), line(1, 0)]),
    ],
  ];

  for (const [name, c] of fixtures) {
    test(`exactRingSignedArea reproduces contourSignedArea (${name})`, () => {
      const canonical = canonicalContour(c);
      const chord = contourSignedArea(canonical.start, canonical.segments);
      const exact = exactRingSignedArea(exactContour(c));
      expect(Math.abs(exact - chord)).toBeLessThanOrEqual(
        1e-12 * Math.max(1, Math.abs(chord)),
      );
    });
  }

  test("a circle is two 180° arcs; an ellipse is chords", () => {
    const round = exactContour({
      kind: "circle",
      widthMm: 8,
      heightMm: 8,
      centerMm: p(2, -1),
    });
    expect("prims" in round).toBe(true);
    if (!("prims" in round)) throw new Error("unreachable");
    expect(round.prims).toHaveLength(2);
    expect(exactRingSignedArea(round)).toBeCloseTo(Math.PI * 16, 9);

    const oval = exactContour({
      kind: "circle",
      widthMm: 8,
      heightMm: 4,
      centerMm: p(2, -1),
    });
    expect("prims" in oval).toBe(false);
    if ("prims" in oval) throw new Error("unreachable");
    expect(oval.kind).toBe("chords");
    expect(oval.boundMm).toBeGreaterThanOrEqual(MAX_CHORD_DEVIATION_MM);
  });

  test("a roundrect at full radius drops its zero-length edges", () => {
    const ring = exactContour({
      kind: "roundrect",
      widthMm: 10,
      heightMm: 4,
      centerMm: p(0, 0),
      cornerRadiusMm: 2,
    });
    if (!("prims" in ring)) throw new Error("unreachable");
    for (const prim of ring.prims) {
      expect(Math.hypot(prim.b.x - prim.a.x, prim.b.y - prim.a.y)).toBeGreaterThan(
        GEOM_EPS_MM,
      );
    }
    // Area = the 6 × 4 core plus the two semicircular caps of radius 2.
    expect(exactRingSignedArea(ring)).toBeCloseTo(6 * 4 + Math.PI * 4, 9);
  });

  test("bounds use the true arc extrema, not the chord vertices", () => {
    // Three quarters of the unit circle, starting east and sweeping CCW to
    // south: the true extrema at (0, 1) and (-1, 0) are interior to the arc.
    const c = contour(p(1, 0), [arcSeg(0, -1, 0, 0), line(0, 0), line(1, 0)]);
    const b = exactContourBounds(exactContour(c));
    expect(b.minX).toBeCloseTo(-1, 12);
    expect(b.maxX).toBeCloseTo(1, 12);
    expect(b.minY).toBeCloseTo(-1, 12);
    expect(b.maxY).toBeCloseTo(1, 12);
  });

  test("every prim ring is exactly closed", () => {
    for (const [, c] of fixtures) {
      const ring = exactContour(c);
      if (!("prims" in ring)) throw new Error("unreachable");
      for (let i = 0; i < ring.prims.length; i += 1) {
        const here = ring.prims[i]!;
        const next = ring.prims[(i + 1) % ring.prims.length]!;
        expect(here.b.x).toBe(next.a.x);
        expect(here.b.y).toBe(next.a.y);
      }
    }
  });
});

// --------------------------------------------------------------------------
// 8. The per-ring chord bound
// --------------------------------------------------------------------------

describe("outlineChordBoundMm", () => {
  test("a shape with no arcs carries no bound", () => {
    expect(
      outlineChordBoundMm({
        kind: "rect",
        widthMm: 10,
        heightMm: 10,
        centerMm: p(0, 0),
      }),
    ).toBe(0);
  });

  test("an ordinary arc carries the chord deviation", () => {
    expect(
      outlineChordBoundMm({
        kind: "roundrect",
        widthMm: 20,
        heightMm: 12,
        centerMm: p(0, 0),
        cornerRadiusMm: 5,
      }),
    ).toBeCloseTo(MAX_CHORD_DEVIATION_MM, 12);
  });

  test("an r = 2000 arc capped at MAX_ARC_SEGMENTS carries the cap residual", () => {
    const r = 2000;
    const bound = outlineChordBoundMm({
      kind: "circle",
      widthMm: r * 2,
      heightMm: r * 2,
      centerMm: p(0, 0),
    });
    // A circle FLATTENS as one 2π sweep, capped at 512 chords: the step is
    // 2π/512 and the circumscribed residual is r·(sec(π/512) − 1) ≈ 0.038,
    // which is the number contract 12 §4 quotes for r = 2000.
    const expected = r * (1 / Math.cos(Math.PI / MAX_ARC_SEGMENTS) - 1);
    expect(bound).toBeCloseTo(expected, 12);
    expect(bound).toBeCloseTo(0.0377, 4);
    expect(bound).toBeGreaterThan(MAX_CHORD_DEVIATION_MM);
  });
});
