import { describe, expect, test } from "vitest";
import type { PcbTrace, PcbVia } from "../../../../../sdks";
import {
  buildDiscRing,
  buildTraceMaskPolygons,
  buildTraceSegmentStadium,
  isSameNetAsPour,
  viaCrossesLayer,
  type ClipperRing,
} from "./copper-fill-trace-geometry";

function ringBounds(ring: ClipperRing): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return ring.reduce(
    (acc, [x, y]) => ({
      minX: Math.min(acc.minX, x),
      maxX: Math.max(acc.maxX, x),
      minY: Math.min(acc.minY, y),
      maxY: Math.max(acc.maxY, y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

function makeTrace(overrides: Partial<PcbTrace> = {}): PcbTrace {
  return {
    id: "t1",
    netId: null,
    netClassId: "default",
    layer: "F.Cu",
    widthMm: 0.2,
    pointsNm: [
      { x: 0, y: 0 },
      { x: 10_000_000, y: 0 }, // 10 mm
    ],
    segmentMode: "manhattan-90",
    ...overrides,
  };
}

function makeVia(overrides: Partial<PcbVia> = {}): PcbVia {
  return {
    id: "v1",
    netId: null,
    netClassId: "default",
    centerMm: { x: 0, y: 0 },
    diameterMm: 0.6,
    drillMm: 0.3,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    protection: "tented",
    ...overrides,
  };
}

describe("buildTraceSegmentStadium", () => {
  test("horizontal segment has expected bounds (length + 2·r width, 2·r height)", () => {
    // 10 mm horizontal, width 0.2 mm, clearance 0.2 mm → r = 0.3 mm
    const ring = buildTraceSegmentStadium({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.3);
    expect(ring).not.toBeNull();
    const bounds = ringBounds(ring!);
    expect(bounds.minX).toBeCloseTo(-0.3, 6);
    expect(bounds.maxX).toBeCloseTo(10.3, 6);
    expect(bounds.minY).toBeCloseTo(-0.3, 6);
    expect(bounds.maxY).toBeCloseTo(0.3, 6);
  });

  test("ring has 4 rect corners plus 2·(capSegments-1) cap vertices", () => {
    const ring = buildTraceSegmentStadium(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      0.1,
      16,
    );
    expect(ring).not.toBeNull();
    // 4 long-edge endpoints + 2 caps × (16-1) extra cap vertices = 34
    expect(ring!.length).toBe(34);
  });

  test("vertical segment perpendicular direction is correct", () => {
    const ring = buildTraceSegmentStadium({ x: 0, y: 0 }, { x: 0, y: 10 }, 0.3);
    expect(ring).not.toBeNull();
    const bounds = ringBounds(ring!);
    expect(bounds.minX).toBeCloseTo(-0.3, 6);
    expect(bounds.maxX).toBeCloseTo(0.3, 6);
    expect(bounds.minY).toBeCloseTo(-0.3, 6);
    expect(bounds.maxY).toBeCloseTo(10.3, 6);
  });

  test("45° diagonal segment bounding box is dominated by the endpoint caps", () => {
    // For a 45° segment, the endpoint half-discs reach the full ±r in cardinal
    // directions (the away-side half-disc at A=(0,0) contains the point (-r,0)
    // because the cardinal direction lies within the half-plane facing away
    // from B). So bbox = [-r, -r, len+r, len+r], not the perpendicular reach.
    const ring = buildTraceSegmentStadium(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      0.3,
    );
    expect(ring).not.toBeNull();
    const bounds = ringBounds(ring!);
    expect(bounds.minX).toBeCloseTo(-0.3, 2);
    expect(bounds.maxX).toBeCloseTo(10.3, 2);
    expect(bounds.minY).toBeCloseTo(-0.3, 2);
    expect(bounds.maxY).toBeCloseTo(10.3, 2);
  });

  test("zero-length segment degenerates into a disc", () => {
    const ring = buildTraceSegmentStadium({ x: 5, y: 5 }, { x: 5, y: 5 }, 0.3);
    expect(ring).not.toBeNull();
    const bounds = ringBounds(ring!);
    expect(bounds.minX).toBeCloseTo(4.7, 6);
    expect(bounds.maxX).toBeCloseTo(5.3, 6);
    expect(bounds.minY).toBeCloseTo(4.7, 6);
    expect(bounds.maxY).toBeCloseTo(5.3, 6);
  });

  test("returns null for non-positive radius", () => {
    expect(
      buildTraceSegmentStadium({ x: 0, y: 0 }, { x: 1, y: 0 }, 0),
    ).toBeNull();
    expect(
      buildTraceSegmentStadium({ x: 0, y: 0 }, { x: 1, y: 0 }, -0.1),
    ).toBeNull();
  });
});

describe("buildDiscRing", () => {
  test("segment count derives from chord-error formula and clamps", () => {
    // tiny r → clamped to floor (16)
    expect(buildDiscRing({ x: 0, y: 0 }, 0.001).length).toBe(16);
    // huge r → clamped to ceiling (96)
    expect(buildDiscRing({ x: 0, y: 0 }, 100).length).toBe(96);
    // typical via r = 0.3 mm, maxError = 0.005 mm → n ≈ 25 (within clamp)
    const typical = buildDiscRing({ x: 0, y: 0 }, 0.3);
    expect(typical.length).toBeGreaterThanOrEqual(16);
    expect(typical.length).toBeLessThanOrEqual(96);
  });

  test("inscribed-polygon disc bounds are within chord-error of the true circle", () => {
    // Polygon vertices lie ON the circle. The bbox shrinks inward by up to
    // chord-error (~0.005 mm) whenever no vertex lands exactly on ±x or ±y;
    // it never extends past the ideal circle. So minX ∈ [center-r, center-r+ε]
    // and maxX ∈ [center+r-ε, center+r].
    const ring = buildDiscRing({ x: 1, y: 2 }, 0.5);
    const bounds = ringBounds(ring);
    expect(bounds.minX).toBeGreaterThanOrEqual(0.5);
    expect(bounds.minX).toBeLessThan(0.505);
    expect(bounds.maxX).toBeGreaterThan(1.495);
    expect(bounds.maxX).toBeLessThanOrEqual(1.5);
    expect(bounds.minY).toBeGreaterThanOrEqual(1.5);
    expect(bounds.maxY).toBeLessThanOrEqual(2.5);
  });
});

describe("buildTraceMaskPolygons", () => {
  test("single segment polyline emits exactly one stadium polygon", () => {
    const polygons = buildTraceMaskPolygons(makeTrace(), 0.2);
    expect(polygons).toHaveLength(1);
    expect(polygons[0]!).toHaveLength(1); // single ring, no holes
  });

  test("L-shaped Manhattan polyline emits one stadium per segment", () => {
    const trace = makeTrace({
      pointsNm: [
        { x: 0, y: 0 },
        { x: 10_000_000, y: 0 },
        { x: 10_000_000, y: 10_000_000 },
      ],
    });
    const polygons = buildTraceMaskPolygons(trace, 0.2);
    expect(polygons).toHaveLength(2);
  });

  test("polyline with <2 points returns empty", () => {
    const trace = makeTrace({ pointsNm: [{ x: 0, y: 0 }] });
    expect(buildTraceMaskPolygons(trace, 0.2)).toHaveLength(0);
  });

  test("non-positive effective radius returns empty", () => {
    const trace = makeTrace({ widthMm: 0 });
    expect(buildTraceMaskPolygons(trace, 0)).toHaveLength(0);
  });
});

describe("viaCrossesLayer", () => {
  test("through via F.Cu↔B.Cu crosses every copper layer", () => {
    const via = makeVia({ fromLayer: "F.Cu", toLayer: "B.Cu" });
    expect(viaCrossesLayer(via, "F.Cu")).toBe(true);
    expect(viaCrossesLayer(via, "In1.Cu")).toBe(true);
    expect(viaCrossesLayer(via, "In2.Cu")).toBe(true);
    expect(viaCrossesLayer(via, "B.Cu")).toBe(true);
  });

  test("partial-span via covers only its range", () => {
    const via = makeVia({ fromLayer: "F.Cu", toLayer: "In1.Cu" });
    expect(viaCrossesLayer(via, "F.Cu")).toBe(true);
    expect(viaCrossesLayer(via, "In1.Cu")).toBe(true);
    expect(viaCrossesLayer(via, "In2.Cu")).toBe(false);
    expect(viaCrossesLayer(via, "B.Cu")).toBe(false);
  });

  test("from/to reversed still works", () => {
    const via = makeVia({ fromLayer: "B.Cu", toLayer: "F.Cu" });
    expect(viaCrossesLayer(via, "In1.Cu")).toBe(true);
  });
});

describe("isSameNetAsPour", () => {
  test("matches when both are equal non-null strings", () => {
    expect(isSameNetAsPour("GND", "GND")).toBe(true);
  });

  test("never matches when either side is null", () => {
    expect(isSameNetAsPour(null, "GND")).toBe(false);
    expect(isSameNetAsPour("GND", null)).toBe(false);
    expect(isSameNetAsPour(null, null)).toBe(false);
  });

  test("does not match different net ids", () => {
    expect(isSameNetAsPour("VCC", "GND")).toBe(false);
  });
});
