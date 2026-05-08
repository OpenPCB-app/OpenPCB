import { describe, expect, test } from "bun:test";
import {
  aabbContains,
  aabbOverlap,
  isPointInAabb,
  polylineContainedInAabb,
  polylineIntersectsAabb,
  segmentIntersectsAabb,
} from "../../../shared/frontend/canvas/selection/rubber-band";
import {
  modeFromDirection,
  colorForMode,
  MARQUEE_WINDOW_COLOR,
  MARQUEE_CROSSING_COLOR,
} from "../../../shared/frontend/canvas/selection/marquee-types";

const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

describe("aabbOverlap", () => {
  test("identifies overlap", () => {
    expect(aabbOverlap(rect, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(
      true,
    );
  });
  test("disjoint AABBs do not overlap", () => {
    expect(aabbOverlap(rect, { minX: 20, minY: 0, maxX: 25, maxY: 5 })).toBe(
      false,
    );
  });
  test("edge-touch counts as overlap", () => {
    expect(aabbOverlap(rect, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(
      true,
    );
  });
});

describe("aabbContains", () => {
  test("strict containment", () => {
    expect(aabbContains(rect, { minX: 1, minY: 1, maxX: 9, maxY: 9 })).toBe(
      true,
    );
  });
  test("partial overlap is not containment", () => {
    expect(aabbContains(rect, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(
      false,
    );
  });
  test("equal AABBs are contained", () => {
    expect(aabbContains(rect, rect)).toBe(true);
  });
});

describe("segmentIntersectsAabb", () => {
  test("segment fully inside intersects", () => {
    expect(segmentIntersectsAabb({ x: 1, y: 1 }, { x: 9, y: 9 }, rect)).toBe(
      true,
    );
  });
  test("segment crossing two edges intersects", () => {
    expect(segmentIntersectsAabb({ x: -5, y: 5 }, { x: 15, y: 5 }, rect)).toBe(
      true,
    );
  });
  test("segment fully outside (no crossing) does not intersect", () => {
    expect(
      segmentIntersectsAabb({ x: 11, y: 11 }, { x: 20, y: 20 }, rect),
    ).toBe(false);
  });
});

describe("polylineContainedInAabb", () => {
  test("all vertices inside → contained", () => {
    expect(
      polylineContainedInAabb(
        [
          { x: 1, y: 1 },
          { x: 5, y: 5 },
          { x: 9, y: 9 },
        ],
        rect,
      ),
    ).toBe(true);
  });
  test("one vertex outside → not contained", () => {
    expect(
      polylineContainedInAabb(
        [
          { x: 1, y: 1 },
          { x: 11, y: 5 },
        ],
        rect,
      ),
    ).toBe(false);
  });
});

describe("polylineIntersectsAabb", () => {
  test("interior vertex triggers intersect", () => {
    expect(
      polylineIntersectsAabb(
        [
          { x: -5, y: 5 },
          { x: 1, y: 5 },
          { x: -5, y: 5 },
        ],
        rect,
      ),
    ).toBe(true);
  });
  test("U-shape hugging from outside (AABB overlaps but segments do not cross)", () => {
    // Polyline AABB = (-5..15, 11..15) which does not overlap rect (0..10, 0..10).
    // Segments don't cross either → no intersection.
    expect(
      polylineIntersectsAabb(
        [
          { x: -5, y: 11 },
          { x: -5, y: 15 },
          { x: 15, y: 15 },
          { x: 15, y: 11 },
        ],
        rect,
      ),
    ).toBe(false);
  });
  test("crossing segment triggers intersect", () => {
    expect(
      polylineIntersectsAabb(
        [
          { x: -5, y: 5 },
          { x: 15, y: 5 },
        ],
        rect,
      ),
    ).toBe(true);
  });
});

describe("isPointInAabb", () => {
  test("inside", () => {
    expect(isPointInAabb({ x: 5, y: 5 }, rect)).toBe(true);
  });
  test("outside", () => {
    expect(isPointInAabb({ x: 11, y: 5 }, rect)).toBe(false);
  });
});

describe("modeFromDirection / colorForMode", () => {
  test("L→R is window (current.x ≥ start.x)", () => {
    expect(modeFromDirection({ x: 0, y: 0 }, { x: 10, y: 5 })).toBe("window");
    expect(modeFromDirection({ x: 0, y: 0 }, { x: 0, y: 5 })).toBe("window");
  });
  test("R→L is crossing (current.x < start.x)", () => {
    expect(modeFromDirection({ x: 10, y: 0 }, { x: 0, y: 5 })).toBe("crossing");
  });
  test("colors map per mode", () => {
    expect(colorForMode("window")).toBe(MARQUEE_WINDOW_COLOR);
    expect(colorForMode("crossing")).toBe(MARQUEE_CROSSING_COLOR);
  });
});
