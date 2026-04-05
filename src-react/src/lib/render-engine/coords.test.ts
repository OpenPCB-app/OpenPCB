import { describe, expect, it } from "vitest";
import {
  Units,
  degreesToRadians,
  radiansToDegrees,
  snapToGrid,
  mergeBounds,
  expandBounds,
  pointInBounds,
  isBoundsValid,
  boundsCenter,
  boundsSize,
  EMPTY_BOUNDS,
  GRID_PRESETS,
  type Vec2,
  type Bounds,
} from "./coords";

// ---------------------------------------------------------------------------
// Unit Conversions
// ---------------------------------------------------------------------------

describe("Units", () => {
  it("nmToMm converts correctly", () => {
    expect(Units.nmToMm(1_000_000)).toBe(1);
    expect(Units.nmToMm(0)).toBe(0);
    expect(Units.nmToMm(500_000)).toBe(0.5);
  });

  it("mmToNm converts correctly", () => {
    expect(Units.mmToNm(1)).toBe(1_000_000);
    expect(Units.mmToNm(0)).toBe(0);
    expect(Units.mmToNm(0.254)).toBeCloseTo(254_000);
  });

  it("nmToMils converts correctly", () => {
    expect(Units.nmToMils(25_400)).toBe(1);
    expect(Units.nmToMils(1_270_000)).toBe(50);
  });

  it("milsToNm converts correctly", () => {
    expect(Units.milsToNm(1)).toBe(25_400);
    expect(Units.milsToNm(50)).toBe(1_270_000);
    expect(Units.milsToNm(100)).toBe(2_540_000);
  });

  it("round-trips are lossless", () => {
    expect(Units.nmToMm(Units.mmToNm(2.54))).toBeCloseTo(2.54);
    expect(Units.mmToNm(Units.nmToMm(1_270_000))).toBeCloseTo(1_270_000);
    expect(Units.nmToMils(Units.milsToNm(50))).toBeCloseTo(50);
    expect(Units.milsToNm(Units.nmToMils(1_270_000))).toBeCloseTo(1_270_000);
  });
});

// ---------------------------------------------------------------------------
// Angle Conversions
// ---------------------------------------------------------------------------

describe("degreesToRadians / radiansToDegrees", () => {
  it("converts 0 degrees", () => {
    expect(degreesToRadians(0)).toBe(0);
  });

  it("converts 90 degrees", () => {
    expect(degreesToRadians(90)).toBeCloseTo(Math.PI / 2);
  });

  it("converts 180 degrees", () => {
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI);
  });

  it("converts 360 degrees", () => {
    expect(degreesToRadians(360)).toBeCloseTo(2 * Math.PI);
  });

  it("converts negative degrees", () => {
    expect(degreesToRadians(-90)).toBeCloseTo(-Math.PI / 2);
  });

  it("round-trips lossless", () => {
    for (const deg of [0, 45, 90, 135, 180, 270, 360, -30]) {
      expect(radiansToDegrees(degreesToRadians(deg))).toBeCloseTo(deg);
    }
  });
});

// ---------------------------------------------------------------------------
// Grid Snapping
// ---------------------------------------------------------------------------

describe("snapToGrid", () => {
  const grid50mil = GRID_PRESETS.STANDARD; // 1_270_000 nm

  it("snaps to nearest grid point", () => {
    const result = snapToGrid({ x: 600_000, y: 700_000 }, grid50mil);
    expect(result.x).toBe(0);
    expect(result.y).toBe(1_270_000);
  });

  it("point on grid stays unchanged", () => {
    const onGrid: Vec2 = { x: 1_270_000, y: 2_540_000 };
    const result = snapToGrid(onGrid, grid50mil);
    expect(result.x).toBe(onGrid.x);
    expect(result.y).toBe(onGrid.y);
  });

  it("snaps negative coordinates", () => {
    // -700_000 / 1_270_000 = -0.55 → rounds to -1 → -1_270_000
    const result = snapToGrid({ x: -1_000_000, y: -700_000 }, grid50mil);
    expect(result.x).toBe(-1_270_000);
    expect(result.y).toBe(-1_270_000);
  });

  it("throws on non-positive gridSize", () => {
    expect(() => snapToGrid({ x: 0, y: 0 }, 0)).toThrow();
    expect(() => snapToGrid({ x: 0, y: 0 }, -100)).toThrow();
  });

  it("works with fine grid", () => {
    const result = snapToGrid({ x: 130_000, y: 240_000 }, GRID_PRESETS.FINE);
    expect(result.x).toBe(Units.mmToNm(0.25)); // 250_000
    expect(result.y).toBe(Units.mmToNm(0.25));
  });
});

// ---------------------------------------------------------------------------
// Bounds Utilities
// ---------------------------------------------------------------------------

describe("Bounds utilities", () => {
  const boundsA: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 200 };
  const boundsB: Bounds = { minX: 50, minY: -50, maxX: 150, maxY: 100 };

  describe("mergeBounds", () => {
    it("produces union of two bounds", () => {
      const merged = mergeBounds(boundsA, boundsB);
      expect(merged.minX).toBe(0);
      expect(merged.minY).toBe(-50);
      expect(merged.maxX).toBe(150);
      expect(merged.maxY).toBe(200);
    });

    it("merging with EMPTY_BOUNDS returns original", () => {
      const merged = mergeBounds(boundsA, EMPTY_BOUNDS);
      expect(merged.minX).toBe(0);
      expect(merged.maxX).toBe(100);
    });
  });

  describe("expandBounds", () => {
    it("expands by padding", () => {
      const expanded = expandBounds(boundsA, 10);
      expect(expanded.minX).toBe(-10);
      expect(expanded.minY).toBe(-10);
      expect(expanded.maxX).toBe(110);
      expect(expanded.maxY).toBe(210);
    });
  });

  describe("pointInBounds", () => {
    it("returns true for point inside", () => {
      expect(pointInBounds({ x: 50, y: 100 }, boundsA)).toBe(true);
    });

    it("returns true for point on edge", () => {
      expect(pointInBounds({ x: 0, y: 0 }, boundsA)).toBe(true);
    });

    it("returns false for point outside", () => {
      expect(pointInBounds({ x: -1, y: 0 }, boundsA)).toBe(false);
    });
  });

  describe("isBoundsValid", () => {
    it("returns true for valid bounds", () => {
      expect(isBoundsValid(boundsA)).toBe(true);
    });

    it("returns false for EMPTY_BOUNDS", () => {
      expect(isBoundsValid(EMPTY_BOUNDS)).toBe(false);
    });

    it("returns false for inverted bounds", () => {
      expect(isBoundsValid({ minX: 100, minY: 0, maxX: 0, maxY: 0 })).toBe(
        false,
      );
    });
  });

  describe("boundsCenter", () => {
    it("returns center point", () => {
      const center = boundsCenter(boundsA);
      expect(center.x).toBe(50);
      expect(center.y).toBe(100);
    });
  });

  describe("boundsSize", () => {
    it("returns width and height", () => {
      const size = boundsSize(boundsA);
      expect(size.width).toBe(100);
      expect(size.height).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
// Grid Presets
// ---------------------------------------------------------------------------

describe("GRID_PRESETS", () => {
  it("FINE is 0.25mm", () => {
    expect(GRID_PRESETS.FINE).toBe(250_000);
  });

  it("STANDARD is 50 mils (1.27mm)", () => {
    expect(GRID_PRESETS.STANDARD).toBe(1_270_000);
  });

  it("COARSE is 100 mils (2.54mm)", () => {
    expect(GRID_PRESETS.COARSE).toBe(2_540_000);
  });
});
