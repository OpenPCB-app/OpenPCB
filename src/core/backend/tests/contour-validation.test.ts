import { describe, expect, test } from "bun:test";
import type { PcbBoardContour, PcbOutlineSegment } from "../../../sdks";
import {
  arcSegmentCount,
  flattenOutline,
  MAX_ARC_SEGMENTS,
  MIN_ARC_SEGMENTS,
  ringSelfIntersects,
  segmentsIntersectInclusive,
} from "../../../shared/rendering/pcb/outline-geometry";
import {
  normalizeContour,
  validateContour,
} from "../../../shared/rendering/pcb/contour-validation";
import { canonicalContour } from "../../../shared/pcb-geometry/canonical-contour";

function contour(
  start: { x: number; y: number },
  segments: PcbOutlineSegment[],
): PcbBoardContour {
  return { kind: "contour", widthMm: 0, heightMm: 0, centerMm: { x: 0, y: 0 }, start, segments };
}

const line = (x: number, y: number): PcbOutlineSegment => ({ type: "line", to: { x, y } });
const arc = (
  x: number,
  y: number,
  cx: number,
  cy: number,
  cw = false,
): PcbOutlineSegment => ({ type: "arc", to: { x, y }, centerMm: { x: cx, y: cy }, cw });

describe("normalizeContour", () => {
  test("appends an explicit closing edge when the last segment does not end at start", () => {
    const c = normalizeContour(contour({ x: 0, y: 0 }, [line(10, 0), line(0, 10)]));
    const last = c.segments[c.segments.length - 1]!;
    expect(last.to).toEqual({ x: 0, y: 0 });
    expect(c.segments).toHaveLength(3);
  });

  test("drops zero-length line edges", () => {
    const c = normalizeContour(
      contour({ x: 0, y: 0 }, [line(10, 0), line(10, 0), line(0, 10), line(0, 0)]),
    );
    // The duplicate (10,0) edge is removed; triangle + explicit closure remains.
    expect(c.segments).toHaveLength(3);
  });

  test("snaps a near-coincident closure exactly onto start", () => {
    const c = normalizeContour(
      contour({ x: 0, y: 0 }, [line(10, 0), line(0, 10), line(0.0001, -0.0001)]),
    );
    expect(c.segments[c.segments.length - 1]!.to).toEqual({ x: 0, y: 0 });
  });

  test("recomputes the cached bbox", () => {
    const c = normalizeContour(contour({ x: 0, y: 0 }, [line(20, 0), line(20, 10), line(0, 10)]));
    expect(c.widthMm).toBeCloseTo(20, 6);
    expect(c.heightMm).toBeCloseTo(10, 6);
    expect(c.centerMm.x).toBeCloseTo(10, 6);
    expect(c.centerMm.y).toBeCloseTo(5, 6);
  });
});

describe("validateContour", () => {
  test("accepts a valid closed triangle", () => {
    const c = normalizeContour(contour({ x: 0, y: 0 }, [line(10, 0), line(0, 10)]));
    expect(validateContour(c)).toEqual({ ok: true });
  });

  test("rejects fewer than 3 segments", () => {
    const c = contour({ x: 0, y: 0 }, [line(10, 0), line(0, 0)]);
    const r = validateContour(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "too-few-segments")).toBe(true);
  });

  test("rejects an un-closed contour (explicit closure required)", () => {
    const c = contour({ x: 0, y: 0 }, [line(10, 0), line(10, 10), line(0, 10)]);
    const r = validateContour(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "not-closed")).toBe(true);
  });

  test("rejects an arc whose endpoints are not equidistant from its center", () => {
    const c = contour({ x: 0, y: 0 }, [arc(10, 2, 5, 0), line(0, 10), line(0, 0)]);
    const r = validateContour(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "arc-radius-mismatch")).toBe(true);
  });

  test("rejects a self-intersecting bow-tie", () => {
    const c = contour({ x: 0, y: 0 }, [line(10, 10), line(10, 0), line(0, 10), line(0, 0)]);
    const r = validateContour(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "self-intersects")).toBe(true);
  });

  test("accepts a contour with a well-formed arc", () => {
    const c = normalizeContour(contour({ x: 0, y: 0 }, [line(10, 0), arc(0, 10, 5, 5), line(0, 0)]));
    expect(validateContour(c)).toEqual({ ok: true });
  });
});

describe("segmentsIntersectInclusive (proper + touch + collinear)", () => {
  const p = (x: number, y: number) => ({ x, y });
  test("detects a proper crossing", () => {
    expect(segmentsIntersectInclusive(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
  });
  test("detects a T-touch (endpoint on the other segment)", () => {
    expect(segmentsIntersectInclusive(p(0, 0), p(10, 0), p(5, 0), p(5, 5))).toBe(true);
  });
  test("detects a collinear overlap", () => {
    expect(segmentsIntersectInclusive(p(0, 0), p(10, 0), p(5, 0), p(15, 0))).toBe(true);
  });
  test("returns false for parallel non-touching segments", () => {
    expect(segmentsIntersectInclusive(p(0, 0), p(10, 0), p(0, 5), p(10, 5))).toBe(false);
  });
  test("ringSelfIntersects catches a self-touching ring", () => {
    expect(
      ringSelfIntersects([p(0, 0), p(10, 0), p(10, 5), p(5, 5), p(5, 0)]),
    ).toBe(true);
  });
});

describe("arc discretisation (chord contract + exact endpoint)", () => {
  test("segment count grows with radius and clamps", () => {
    expect(arcSegmentCount(0.001, Math.PI)).toBe(MIN_ARC_SEGMENTS);
    expect(arcSegmentCount(100, Math.PI / 2)).toBeGreaterThan(arcSegmentCount(3, Math.PI / 2));
    expect(arcSegmentCount(1e6, Math.PI * 2)).toBe(MAX_ARC_SEGMENTS);
  });

  /**
   * RE-TARGETED for S12b (exact-geometry contract 12 §2.1). This used to assert
   * that flattening emitted the AUTHORED endpoint of a mismatched-radius arc
   * verbatim ("lands exactly on its endpoint"). The annulus arm that made that
   * true is retired: a tolerance is not a curve, so the one canonical curve is
   * the circle of the START radius and the authored `to` is projected radially
   * onto it. The byte change is confined to arcs whose authored radii differ by
   * more than GEOM_EPS_MM — here 0.00025 mm, which moves the emitted endpoint by
   * the same 0.00025 mm.
   */
  test("flattened arc lands on the CANONICAL endpoint of a radius mismatch", () => {
    // rFrom = 5.0, rTo = hypot(5, 0.05) ≈ 5.00025 — within the validator's tol.
    const c = contour({ x: 0, y: 0 }, [arc(10, 0.05, 5, 0), line(0, 10), line(0, 0)]);
    const canonical = canonicalContour(c).segments[0]!;
    if (canonical.type !== "arc") throw new Error("expected an arc");
    const end = canonical.to;
    // On the start-radius circle, and moved by exactly the authored mismatch.
    expect(Math.hypot(end.x - 5, end.y)).toBeCloseTo(5, 12);
    expect(Math.hypot(end.x - 10, end.y - 0.05)).toBeCloseTo(
      Math.hypot(5, 0.05) - 5,
      12,
    );
    const ring = flattenOutline(c);
    expect(ring.some((p) => p.x === end.x && p.y === end.y)).toBe(true);
    expect(ring.some((p) => p.x === 10 && p.y === 0.05)).toBe(false);
  });
});
