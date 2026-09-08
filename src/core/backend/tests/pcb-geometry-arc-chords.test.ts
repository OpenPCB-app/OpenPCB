/**
 * The arc chord sampler (docs/pcb-hardening/02-geometry-contract.md §3): two
 * constructions, one tolerance, one step rule, `θ <= π/2` for both. The
 * inscribed polygon stays inside a convex curve; the circumscribed tangent
 * chain encloses it and joins its neighbours without a dip.
 */
import { describe, expect, test } from "bun:test";
import type { PcbPointMm } from "../../../sdks";
import {
  arcChordPoints,
  arcSegmentCount,
  ellipseChordRing,
  MAX_ARC_SEGMENTS,
  MAX_CHORD_DEVIATION_MM,
} from "../../../shared/pcb-geometry/arc-chords";
import {
  pointInPolygon,
  pointToPolygonDistance,
} from "../../../shared/pcb-geometry/pcb-clearance-geometry";
import { ringSignedArea } from "../../../shared/pcb-geometry/ring-utils";

const ORIGIN: PcbPointMm = { x: 0, y: 0 };
const TWO_PI = Math.PI * 2;

/** Max |‖p − c‖ − r| over the polyline, densely sampled along every edge. */
function maxRadialDeviation(
  pts: readonly PcbPointMm[],
  center: PcbPointMm,
  r: number,
  closed: boolean,
): number {
  const last = closed ? pts.length : pts.length - 1;
  let worst = 0;
  for (let i = 0; i < last; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    for (let s = 0; s <= 32; s += 1) {
      const t = s / 32;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const d = Math.abs(Math.hypot(x - center.x, y - center.y) - r);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** Distance from `center` to the infinite line through a and b. */
function lineDistance(center: PcbPointMm, a: PcbPointMm, b: PcbPointMm): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cross = dx * (center.y - a.y) - dy * (center.x - a.x);
  return Math.abs(cross) / Math.hypot(dx, dy);
}

function arcChain(
  r: number,
  a0: number,
  a1: number,
  bias: "inscribed" | "circumscribed",
): PcbPointMm[] {
  const steps = arcSegmentCount(r, Math.abs(a1 - a0), bias);
  const start = { x: Math.cos(a0) * r, y: Math.sin(a0) * r };
  const end = { x: Math.cos(a1) * r, y: Math.sin(a1) * r };
  return [start, ...arcChordPoints(ORIGIN, r, a0, a1, steps, bias, end)];
}

describe("step rule", () => {
  test("keeps every step at or below π/2 — no two-chord circles", () => {
    for (const r of [0.001, 0.004, 0.005, 0.05, 0.1]) {
      expect(arcSegmentCount(r, TWO_PI)).toBeGreaterThanOrEqual(4);
      expect(arcSegmentCount(r, TWO_PI, "circumscribed")).toBeGreaterThanOrEqual(
        4,
      );
      expect(arcSegmentCount(r, Math.PI / 2)).toBeGreaterThanOrEqual(1);
    }
  });

  test("clamps at MAX_ARC_SEGMENTS and doubles under stepMultiplier", () => {
    expect(arcSegmentCount(1e6, TWO_PI)).toBe(MAX_ARC_SEGMENTS);
    expect(arcSegmentCount(5000, TWO_PI)).toBe(MAX_ARC_SEGMENTS);
    const base = arcSegmentCount(2, Math.PI / 2);
    expect(arcSegmentCount(2, Math.PI / 2, "inscribed", 2)).toBe(base * 2);
    expect(arcSegmentCount(2, Math.PI / 2, "inscribed", 4)).toBe(base * 4);
  });

  test("the circumscribed rule is stricter where the inscribed one overshoots", () => {
    // Astra F6: a tangent chain stepped by the inscribed rule deviates
    // 0.010016 mm at r = 2.07 with 32 steps.
    const r = 2.07;
    const inscribedSteps = arcSegmentCount(r, TWO_PI, "inscribed");
    expect(inscribedSteps).toBe(32);
    const overshoot = r * (1 / Math.cos(Math.PI / inscribedSteps) - 1);
    expect(overshoot).toBeGreaterThan(MAX_CHORD_DEVIATION_MM);
    const tangentSteps = arcSegmentCount(r, TWO_PI, "circumscribed");
    expect(tangentSteps).toBe(33);
    expect(r * (1 / Math.cos(Math.PI / tangentSteps) - 1)).toBeLessThanOrEqual(
      MAX_CHORD_DEVIATION_MM,
    );
  });
});

describe("inscribed construction", () => {
  test("puts every vertex exactly on the circle", () => {
    const ring = ellipseChordRing(ORIGIN, 12, 12, 64, "inscribed");
    for (const v of ring) {
      expect(Math.abs(Math.hypot(v.x, v.y) - 12)).toBeLessThan(1e-12);
    }
  });
});

describe("circumscribed construction", () => {
  test("every edge lies on a tangent line of the arc", () => {
    const chain = arcChain(7, 0, Math.PI / 2, "circumscribed");
    expect(chain.length).toBeGreaterThan(2);
    for (let i = 1; i < chain.length; i += 1) {
      expect(Math.abs(lineDistance(ORIGIN, chain[i - 1]!, chain[i]!) - 7)).
        toBeLessThan(1e-9);
    }
  });

  test("encloses the true arc, joins included", () => {
    const r = 7;
    const a0 = 0;
    const a1 = Math.PI / 2;
    const chain = arcChain(r, a0, a1, "circumscribed");
    // Close the fan through the centre so containment is a real question.
    const fan = [ORIGIN, ...chain];
    for (let k = 1; k < 719; k += 1) {
      const a = a0 + ((a1 - a0) * k) / 719;
      const s = { x: Math.cos(a) * r, y: Math.sin(a) * r };
      expect(pointInPolygon(s, fan)).toBe(true);
    }
  });
});

describe("chord deviation stays within tolerance", () => {
  test.each([0.1, 1, 2.07, 20, 200])("r = %p full circle and quarter arc", (r) => {
    for (const bias of ["inscribed", "circumscribed"] as const) {
      const steps = arcSegmentCount(r, TWO_PI, bias);
      const ring = ellipseChordRing(ORIGIN, r, r, steps, bias);
      expect(maxRadialDeviation(ring, ORIGIN, r, true)).toBeLessThanOrEqual(
        MAX_CHORD_DEVIATION_MM + 1e-12,
      );
      const chain = arcChain(r, 0, Math.PI / 2, bias);
      expect(maxRadialDeviation(chain, ORIGIN, r, false)).toBeLessThanOrEqual(
        MAX_CHORD_DEVIATION_MM + 1e-12,
      );
    }
  });

  test("at the 512 cap the deviation is the capped formula, not the tolerance", () => {
    const r = 5000;
    const inscribed = ellipseChordRing(ORIGIN, r, r, 512, "inscribed");
    expect(maxRadialDeviation(inscribed, ORIGIN, r, true)).toBeCloseTo(
      r * (1 - Math.cos(Math.PI / 512)),
      6,
    );
    const circumscribed = ellipseChordRing(ORIGIN, r, r, 512, "circumscribed");
    expect(maxRadialDeviation(circumscribed, ORIGIN, r, true)).toBeCloseTo(
      r * (1 / Math.cos(Math.PI / 512) - 1),
      6,
    );
  });

  test("sub-tolerance radii still produce a finite ring with positive area", () => {
    for (const r of [0.005, 0.004]) {
      for (const bias of ["inscribed", "circumscribed"] as const) {
        const steps = arcSegmentCount(r, TWO_PI, bias);
        const ring = ellipseChordRing(ORIGIN, r, r, steps, bias);
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y))).
          toBe(true);
        expect(Math.abs(ringSignedArea(ring))).toBeGreaterThan(0);
      }
    }
  });
});

describe("endpoints and sweep direction", () => {
  test("both constructions end on the exact end point", () => {
    const end = { x: 3.000000123, y: -1.5 };
    for (const bias of ["inscribed", "circumscribed"] as const) {
      const pts = arcChordPoints(ORIGIN, 3, 0, Math.PI / 3, 5, bias, end);
      expect(pts[pts.length - 1]).toEqual(end);
    }
  });

  test("a clockwise sweep mirrors the counter-clockwise one", () => {
    const r = 4;
    const ccw = arcChain(r, 0, Math.PI / 2, "inscribed");
    const cw = arcChain(r, Math.PI / 2, 0, "inscribed");
    expect(cw.length).toBe(ccw.length);
    for (let i = 0; i < cw.length; i += 1) {
      expect(cw[i]!.x).toBeCloseTo(ccw[ccw.length - 1 - i]!.x, 12);
      expect(cw[i]!.y).toBeCloseTo(ccw[ccw.length - 1 - i]!.y, 12);
    }
  });

  test("a 350° sweep stays within tolerance in both constructions", () => {
    const r = 6;
    const sweep = (350 * Math.PI) / 180;
    for (const bias of ["inscribed", "circumscribed"] as const) {
      const chain = arcChain(r, 0, sweep, bias);
      expect(maxRadialDeviation(chain, ORIGIN, r, false)).toBeLessThanOrEqual(
        MAX_CHORD_DEVIATION_MM + 1e-12,
      );
    }
  });
});

describe("ellipses", () => {
  test("the circumscribed ring encloses the true ellipse and the inscribed one", () => {
    const rx = 30;
    const ry = 10;
    const steps = arcSegmentCount(Math.max(rx, ry), TWO_PI, "circumscribed");
    const outerRing = ellipseChordRing(ORIGIN, rx, ry, steps, "circumscribed");
    // `pointToPolygonDistance` is 0 inside and the true gap outside, so it also
    // accepts the tangent points, which sit exactly on the enclosing boundary.
    for (let k = 0; k < 720; k += 1) {
      const a = (k / 720) * TWO_PI;
      const s = { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
      expect(pointToPolygonDistance(s, outerRing)).toBeLessThan(1e-9);
    }
    const innerRing = ellipseChordRing(
      ORIGIN,
      rx,
      ry,
      arcSegmentCount(Math.max(rx, ry), TWO_PI, "inscribed"),
      "inscribed",
    );
    for (const v of innerRing) {
      expect(pointToPolygonDistance(v, outerRing)).toBeLessThan(1e-9);
    }
    // Edge midpoints of the inscribed ring are strictly inside the enclosing one.
    for (let i = 0; i < innerRing.length; i += 1) {
      const a = innerRing[i]!;
      const b = innerRing[(i + 1) % innerRing.length]!;
      expect(
        pointInPolygon({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, outerRing),
      ).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// Reviewer-critical finding 5 (contract §9.1a): finite output on bad input
// --------------------------------------------------------------------------

describe("non-finite and under-stepped input stays finite", () => {
  const o: PcbPointMm = { x: 0, y: 0 };
  const finite = (pts: readonly PcbPointMm[]) =>
    pts.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y));

  test("arcSegmentCount tolerates a NaN sweep and multiplier", () => {
    expect(arcSegmentCount(5, Number.NaN)).toBe(1);
    expect(arcSegmentCount(5, Math.PI / 2, "inscribed", Number.NaN)).toBe(
      arcSegmentCount(5, Math.PI / 2),
    );
  });

  test("arcChordPoints enforces the θ ≤ π/2 floor itself", () => {
    const pts = arcChordPoints(o, 5, 0, Math.PI * 2, 2, "circumscribed", {
      x: 5,
      y: 0,
    });
    expect(finite(pts)).toBe(true);
    // Four steps ⇒ θ = π/2 ⇒ tangent vertices at r·sec(π/4) = r·√2.
    for (const q of pts) expect(Math.hypot(q.x, q.y)).toBeLessThan(5 * Math.SQRT2 + 1e-9);
    expect(pts.length).toBeGreaterThanOrEqual(4);
  });

  test("ellipseChordRing with a NaN count still returns a ring", () => {
    const ring = ellipseChordRing(o, 5, 5, Number.NaN, "inscribed");
    expect(ring.length).toBeGreaterThanOrEqual(4);
    expect(finite(ring)).toBe(true);
  });
});

describe("Astra §9.2 run 2, #8: non-finite angles cannot loop", () => {
  test("an infinite end angle yields one finite point", () => {
    const pts = arcChordPoints({ x: 0, y: 0 }, 1, 0, Number.POSITIVE_INFINITY, 1, "circumscribed", { x: 1, y: 0 });
    expect(pts.length).toBe(1);
    expect(Number.isFinite(pts[0]!.x) && Number.isFinite(pts[0]!.y)).toBe(true);
  });

  test("a huge requested count is capped", () => {
    const pts = arcChordPoints({ x: 0, y: 0 }, 1, 0, Math.PI / 2, 1e9, "inscribed", { x: 0, y: 1 });
    expect(pts.length).toBeLessThanOrEqual(MAX_ARC_SEGMENTS);
  });
});
