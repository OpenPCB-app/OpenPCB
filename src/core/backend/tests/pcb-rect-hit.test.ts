import { describe, expect, test } from "bun:test";
import {
  placementBoundsMm,
  placementContainedInRect,
  placementIntersectsRect,
  traceContainedInRect,
  traceIntersectsRect,
} from "../../../modules/designer/frontend/pcb/pcb-rect-hit";
import type { PcbPlacedPart, PcbTrace } from "../../../sdks";

function buildPlacement(opts: {
  positionMm: { x: number; y: number };
  rotationDeg?: number;
  mirrored?: boolean;
  bounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
}): PcbPlacedPart {
  const previewBounds =
    opts.bounds === undefined
      ? { minX: -1, minY: -0.5, maxX: 1, maxY: 0.5 }
      : opts.bounds;
  return {
    id: "p1",
    partId: "part",
    componentId: "comp",
    reference: "R1",
    positionMm: opts.positionMm,
    rotationDeg: opts.rotationDeg ?? 0,
    mirrored: opts.mirrored ?? false,
    layer: "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "fp",
      mountType: null,
      sourceHash: null,
      preview:
        previewBounds === null
          ? null
          : {
              kind: "footprint",
              units: "mm",
              name: "fp",
              pads: [],
              graphics: [],
              labels: [],
              bounds: previewBounds,
              warnings: [],
            },
    },
  };
}

const innerRect = { minX: -2, minY: -2, maxX: 2, maxY: 2 };

describe("placementBoundsMm", () => {
  test("rotation 0 + position translation", () => {
    const placement = buildPlacement({ positionMm: { x: 5, y: 10 } });
    expect(placementBoundsMm(placement)).toEqual({
      minX: 4,
      minY: 9.5,
      maxX: 6,
      maxY: 10.5,
    });
  });

  test("rotation 90° swaps width/height", () => {
    const placement = buildPlacement({
      positionMm: { x: 0, y: 0 },
      rotationDeg: 90,
    });
    const b = placementBoundsMm(placement);
    expect(b).not.toBeNull();
    // Local (1,0.5) → 90° → (-0.5, 1). Tightest AABB after rotating 4 corners.
    expect(b!.minX).toBeCloseTo(-0.5);
    expect(b!.maxX).toBeCloseTo(0.5);
    expect(b!.minY).toBeCloseTo(-1);
    expect(b!.maxY).toBeCloseTo(1);
  });

  test("mirrored flips x", () => {
    const placement = buildPlacement({
      positionMm: { x: 0, y: 0 },
      mirrored: true,
      bounds: { minX: 0, minY: -0.5, maxX: 2, maxY: 0.5 },
    });
    const b = placementBoundsMm(placement);
    expect(b).not.toBeNull();
    expect(b!.minX).toBeCloseTo(-2);
    expect(b!.maxX).toBeCloseTo(0);
  });

  test("returns null when preview is missing", () => {
    const placement = buildPlacement({
      positionMm: { x: 0, y: 0 },
      bounds: null,
    });
    expect(placementBoundsMm(placement)).toBeNull();
  });
});

describe("placement rect predicates", () => {
  test("contained: placement fully inside rect", () => {
    const placement = buildPlacement({ positionMm: { x: 0, y: 0 } });
    expect(placementContainedInRect(placement, innerRect)).toBe(true);
  });
  test("not contained when partially outside", () => {
    const placement = buildPlacement({ positionMm: { x: 1.5, y: 0 } });
    // local (-1..1, -0.5..0.5) shifted by (1.5,0) → (0.5..2.5, -0.5..0.5)
    expect(placementContainedInRect(placement, innerRect)).toBe(false);
    expect(placementIntersectsRect(placement, innerRect)).toBe(true);
  });
  test("not intersecting when fully outside", () => {
    const placement = buildPlacement({ positionMm: { x: 10, y: 10 } });
    expect(placementIntersectsRect(placement, innerRect)).toBe(false);
  });
});

function buildTrace(pointsMm: Array<{ x: number; y: number }>): PcbTrace {
  return {
    id: "t1",
    netId: null,
    netClassId: "default",
    layer: "F.Cu",
    widthMm: 0.25,
    pointsNm: pointsMm.map((p) => ({ x: p.x * 1_000_000, y: p.y * 1_000_000 })),
    segmentMode: "manhattan-45",
  };
}

describe("trace rect predicates", () => {
  test("contained: every vertex inside", () => {
    const trace = buildTrace([
      { x: -1, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(traceContainedInRect(trace, innerRect)).toBe(true);
  });
  test("crossing: vertex outside but segment crosses", () => {
    const trace = buildTrace([
      { x: -5, y: 0 },
      { x: 5, y: 0 },
    ]);
    expect(traceContainedInRect(trace, innerRect)).toBe(false);
    expect(traceIntersectsRect(trace, innerRect)).toBe(true);
  });
  test("trace fully outside does not intersect", () => {
    const trace = buildTrace([
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ]);
    expect(traceIntersectsRect(trace, innerRect)).toBe(false);
  });
  test("U-shape hugs from outside (AABB overlaps but no segment crosses)", () => {
    // Polyline (-3,3)→(-3,-3)→(3,-3)→(3,3). All vertices outside (minX=-3 maxX=3 etc).
    // The horizontal bottom segment passes through y=-3 just outside rect (rect is -2..2 in y).
    // Actually let's craft a clear case where bbox overlaps but no segment intersects.
    // Use: (-3,-3) → (-3,3) → (3,3) → (3,-3). The vertical segments are at x=±3.
    // Rect = -2..2. So segments are entirely outside the rect's x range. No intersection.
    const trace = buildTrace([
      { x: -3, y: -3 },
      { x: -3, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: -3 },
    ]);
    expect(traceIntersectsRect(trace, innerRect)).toBe(false);
  });
});
