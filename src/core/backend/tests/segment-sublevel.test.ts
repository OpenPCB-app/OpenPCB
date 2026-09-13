/**
 * SI contract 14 §4.1 — the ONE closed-form segment sublevel primitive. It
 * lives under `src/shared/pcb-geometry/`, which the frontend Vitest `include`
 * does NOT cover, so it is pinned here (Bun) or nowhere.
 *
 * The last test is a brute-force sampling oracle: an independent distance
 * function walked at 1e-4 mm must agree with the closed form on where the
 * sublevel set starts and ends.
 */
import { describe, expect, test } from "bun:test";
import {
  segmentSublevelInterval,
  type ConvexTarget,
  type SublevelInterval,
} from "../../../shared/pcb-geometry/segment-sublevel";
import type { PcbPointMm } from "../../../sdks/designer";

const p = (x: number, y: number): PcbPointMm => ({ x, y });
const SQUARE = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)];

const width = (iv: SublevelInterval | null): number =>
  iv === null ? -1 : iv.s1 - iv.s0;

describe("segmentSublevelInterval — point targets", () => {
  test("a disc chord: half-width sqrt(R² − h²) about the perpendicular foot", () => {
    const iv = segmentSublevelInterval(p(-10, 0), p(10, 0), { kind: "point", p: p(0, 0.35) }, 0.4);
    const half = Math.sqrt(0.4 * 0.4 - 0.35 * 0.35);
    expect(iv).not.toBeNull();
    expect(iv!.s0).toBeCloseTo(10 - half, 12);
    expect(iv!.s1).toBeCloseTo(10 + half, 12);
    // 2·sqrt(0.4² − 0.35²) — the point-target measure the SI kernel inherits.
    expect(width(iv)).toBeCloseTo(0.3872983346207417, 12);
  });

  test("tangency is a point interval, not an empty set", () => {
    const iv = segmentSublevelInterval(p(-10, 0), p(10, 0), { kind: "point", p: p(0, 0.4) }, 0.4);
    expect(iv).not.toBeNull();
    expect(iv!.s0).toBe(iv!.s1);
    expect(iv!.s0).toBeCloseTo(10, 9);
  });

  test("out of reach is null; a negative radius is null even at distance 0", () => {
    expect(
      segmentSublevelInterval(p(0, 0), p(10, 0), { kind: "point", p: p(5, 0.5) }, 0.4),
    ).toBeNull();
    expect(
      segmentSublevelInterval(p(0, 0), p(10, 0), { kind: "point", p: p(5, 0) }, -1e-9),
    ).toBeNull();
  });

  test("the interval is clamped to the source, never extended past it", () => {
    const iv = segmentSublevelInterval(p(0, 0), p(1, 0), { kind: "point", p: p(0.5, 0) }, 10);
    expect(iv).toEqual({ s0: 0, s1: 1 });
  });

  test("board-scale coordinates and a long source keep the chord exact", () => {
    // The quadratic is solved on a RELATIVE vector, so a board 500 mm from the
    // origin must not cost accuracy; a 400 mm source with the target near its
    // far end is the worst cancellation this kernel sees in practice.
    for (const offset of [0, 500]) {
      for (const len of [20, 400]) {
        const q = p(offset + len - 0.5, 0.35);
        const iv = segmentSublevelInterval(p(offset, 0), p(offset + len, 0), { kind: "point", p: q }, 0.4);
        const half = Math.sqrt((0.4 - 0.35) * (0.4 + 0.35));
        expect(Math.abs(iv!.s0 - (len - 0.5 - half))).toBeLessThan(1e-8);
        expect(Math.abs(iv!.s1 - (len - 0.5 + half))).toBeLessThan(1e-8);
      }
    }
  });

  test("a zero-length source is a point test giving [0, 0] or null", () => {
    const hit = segmentSublevelInterval(p(0, 0), p(0, 0), { kind: "point", p: p(0, 0.3) }, 0.4);
    expect(hit).toEqual({ s0: 0, s1: 0 });
    const miss = segmentSublevelInterval(p(0, 0), p(0, 0), { kind: "point", p: p(0, 0.3) }, 0.2);
    expect(miss).toBeNull();
  });
});

describe("segmentSublevelInterval — segment targets", () => {
  test("parallel: the strip over the target's span plus both endpoint discs", () => {
    const iv = segmentSublevelInterval(p(0, 0), p(20, 0), { kind: "segment", a: p(5, 0.3), b: p(15, 0.3) }, 0.5);
    const bulge = Math.sqrt(0.5 * 0.5 - 0.3 * 0.3); // 0.4
    expect(iv!.s0).toBeCloseTo(5 - bulge, 12);
    expect(iv!.s1).toBeCloseTo(15 + bulge, 12);
  });

  test("perpendicular: the band is the target's own offset", () => {
    const iv = segmentSublevelInterval(p(0, -5), p(0, 5), { kind: "segment", a: p(-3, 1), b: p(3, 1) }, 0.5);
    expect(iv!.s0).toBeCloseTo(5.5, 12);
    expect(iv!.s1).toBeCloseTo(6.5, 12);
  });

  test("collinear: the target's span grown by R at both ends", () => {
    const iv = segmentSublevelInterval(p(0, 0), p(10, 0), { kind: "segment", a: p(3, 0), b: p(6, 0) }, 1);
    expect(iv!.s0).toBeCloseTo(2, 12);
    expect(iv!.s1).toBeCloseTo(7, 12);
  });

  test("diverging: the interval ends where the perpendicular offset reaches R", () => {
    const tlen = Math.sqrt(401);
    const iv = segmentSublevelInterval(p(0, 0), p(20, 0), { kind: "segment", a: p(0, 0.35), b: p(20, 1.35) }, 0.9);
    // |perp| from (s, 0) to the target line is (7 + s)/|N|.
    expect(iv!.s0).toBe(0);
    expect(iv!.s1).toBeCloseTo(0.9 * tlen - 7, 10);
  });

  test("a degenerate target segment is a point target, never skipped", () => {
    const point = segmentSublevelInterval(p(-10, 0), p(10, 0), { kind: "point", p: p(0, 0.35) }, 0.4);
    const degenerate = segmentSublevelInterval(
      p(-10, 0),
      p(10, 0),
      { kind: "segment", a: p(0, 0.35), b: p(0, 0.35) },
      0.4,
    );
    expect(degenerate).toEqual(point!);
  });
});

describe("segmentSublevelInterval — convex targets", () => {
  test("1 and 2 points degenerate to the point and segment forms", () => {
    expect(segmentSublevelInterval(p(-10, 0), p(10, 0), { kind: "convex", points: [p(0, 0.35)] }, 0.4)).toEqual(
      segmentSublevelInterval(p(-10, 0), p(10, 0), { kind: "point", p: p(0, 0.35) }, 0.4)!,
    );
    expect(
      segmentSublevelInterval(p(0, 0), p(20, 0), { kind: "convex", points: [p(5, 0.3), p(15, 0.3)] }, 0.5),
    ).toEqual(segmentSublevelInterval(p(0, 0), p(20, 0), { kind: "segment", a: p(5, 0.3), b: p(15, 0.3) }, 0.5)!);
    expect(segmentSublevelInterval(p(0, 0), p(1, 0), { kind: "convex", points: [] }, 1)).toBeNull();
  });

  test("a source deep inside the hull is covered at R = 0 — the edges alone are not", () => {
    const iv = segmentSublevelInterval(p(0.5, 1), p(1.5, 1), { kind: "convex", points: SQUARE }, 0);
    expect(iv).toEqual({ s0: 0, s1: 1 });
  });

  test("a source crossing the hull enters and leaves at the boundary", () => {
    const iv = segmentSublevelInterval(p(-1, 1), p(3, 1), { kind: "convex", points: SQUARE }, 0);
    expect(iv!.s0).toBeCloseTo(1, 12);
    expect(iv!.s1).toBeCloseTo(3, 12);
  });

  test("outside the hull: the edge strip plus the corner discs", () => {
    const iv = segmentSublevelInterval(p(-1, -0.5), p(3, -0.5), { kind: "convex", points: SQUARE }, 0.6);
    const reach = Math.sqrt(0.6 * 0.6 - 0.5 * 0.5);
    expect(iv!.s0).toBeCloseTo(1 - reach, 12);
    expect(iv!.s1).toBeCloseTo(3 + reach, 12);
  });

  test("winding does not matter", () => {
    const cw = segmentSublevelInterval(p(-1, -0.5), p(3, -0.5), { kind: "convex", points: [...SQUARE].reverse() }, 0.6);
    const ccw = segmentSublevelInterval(p(-1, -0.5), p(3, -0.5), { kind: "convex", points: SQUARE }, 0.6);
    expect(cw).toEqual(ccw!);
  });

  test("a zero-area hull still answers from its edges", () => {
    const iv = segmentSublevelInterval(
      p(-10, 0),
      p(10, 0),
      { kind: "convex", points: [p(0, 0.35), p(1, 0.35), p(2, 0.35)] },
      0.4,
    );
    const half = Math.sqrt(0.4 * 0.4 - 0.35 * 0.35);
    expect(iv!.s0).toBeCloseTo(10 - half, 12);
    expect(iv!.s1).toBeCloseTo(12 + half, 12);
  });
});

// ── brute-force oracle ────────────────────────────────────────────────────
// An independent distance function (nothing from pcb-geometry) sampled at
// 1e-4 mm. The sampled extent cannot be off by more than one step at each end.

const SAMPLE_MM = 1e-4;

function distancePointToSegment(q: PcbPointMm, a: PcbPointMm, b: PcbPointMm): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(q.x - a.x, q.y - a.y);
  let t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
}

function distanceToTarget(q: PcbPointMm, target: ConvexTarget): number {
  if (target.kind === "point") return Math.hypot(q.x - target.p.x, q.y - target.p.y);
  if (target.kind === "segment") return distancePointToSegment(q, target.a, target.b);
  const pts = target.points;
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(q.x - pts[0]!.x, q.y - pts[0]!.y);
  let best = Infinity;
  let positive = false;
  let negative = false;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    best = Math.min(best, distancePointToSegment(q, a, b));
    const cross = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
    if (cross > 0) positive = true;
    if (cross < 0) negative = true;
  }
  return pts.length >= 3 && !(positive && negative) ? 0 : best;
}

function sampleExtent(
  a: PcbPointMm,
  b: PcbPointMm,
  target: ConvexTarget,
  radius: number,
): { lo: number; hi: number } | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = len === 0 ? 0 : Math.ceil(len / SAMPLE_MM);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= steps; i += 1) {
    const s = Math.min(i * SAMPLE_MM, len);
    const t = len === 0 ? 0 : s / len;
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (distanceToTarget(q, target) <= radius) {
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
  }
  return lo <= hi ? { lo, hi } : null;
}

/** mulberry32 — a seeded PRNG, so the corpus is the same on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("segmentSublevelInterval — brute-force sampling oracle", () => {
  test("500 seeded random cases agree with 1e-4 mm sampling within 2e-4 mm", () => {
    const rnd = mulberry32(0x5141);
    const span = (lo: number, hi: number) => lo + rnd() * (hi - lo);
    const pt = () => p(span(-1.5, 1.5), span(-1.5, 1.5));
    let checked = 0;
    let nonEmpty = 0;

    for (let i = 0; i < 500; i += 1) {
      const a = pt();
      const b = i % 47 === 0 ? a : pt(); // every 47th case has a zero-length source
      const radius = i % 31 === 0 ? 0 : span(0, 1.2);
      let target: ConvexTarget;
      if (i % 3 === 0) {
        target = { kind: "point", p: pt() };
      } else if (i % 3 === 1) {
        const c = pt();
        target = { kind: "segment", a: c, b: i % 13 === 1 ? c : pt() };
      } else {
        // Points taken in increasing angle around a centre are in convex position.
        const centre = pt();
        const r = span(0.05, 1);
        const count = 3 + Math.floor(rnd() * 4);
        const angles: number[] = [];
        for (let k = 0; k < count; k += 1) angles.push(rnd() * Math.PI * 2);
        angles.sort((x, y) => x - y);
        const points = angles.map((t) => p(centre.x + r * Math.cos(t), centre.y + r * Math.sin(t)));
        target = { kind: "convex", points: i % 5 === 2 ? points.reverse() : points };
      }

      const closed = segmentSublevelInterval(a, b, target, radius);
      const sampled = sampleExtent(a, b, target, radius);
      checked += 1;

      if (sampled === null) {
        // The sampler can only miss a set thinner than its own step.
        expect(closed === null || closed.s1 - closed.s0 <= 2 * SAMPLE_MM).toBe(true);
        continue;
      }
      nonEmpty += 1;
      expect(closed).not.toBeNull();
      expect(Math.abs(closed!.s0 - sampled.lo)).toBeLessThanOrEqual(2e-4);
      expect(Math.abs(closed!.s1 - sampled.hi)).toBeLessThanOrEqual(2e-4);
    }

    expect(checked).toBe(500);
    expect(nonEmpty).toBeGreaterThan(100); // the corpus is not trivially empty
  });
});
