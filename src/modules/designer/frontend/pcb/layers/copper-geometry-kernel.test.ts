import { describe, expect, test } from "vitest";
import type { PathD, PathsD } from "clipper2-ts";
import {
  area,
  difference,
  offsetRound,
  removeOnlyFillet,
  toShapes,
  union,
} from "./copper-geometry-kernel";

/** Axis-aligned rectangle (CCW) as a Clipper PathD, centred at (cx,cy). */
function rect(cx: number, cy: number, w: number, h: number): PathD {
  const hw = w / 2;
  const hh = h / 2;
  return [
    { x: cx - hw, y: cy - hh },
    { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh },
    { x: cx - hw, y: cy + hh },
  ];
}

describe("copper-geometry-kernel", () => {
  test("toShapes of a square → 1 shape, no holes", () => {
    const shapes = toShapes([rect(0, 0, 10, 10)]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.holes).toHaveLength(0);
  });

  test("difference carves a hole (annulus) and toShapes preserves it", () => {
    const annulus: PathsD = difference(
      [rect(0, 0, 10, 10)],
      [rect(0, 0, 4, 4)],
    );
    expect(area(annulus)).toBeCloseTo(100 - 16, 1);
    const shapes = toShapes(annulus);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.holes).toHaveLength(1);
  });

  test("union merges overlapping rectangles into one shape", () => {
    const merged = union([rect(-2, 0, 6, 6)], [rect(2, 0, 6, 6)]);
    // 6×6 + 6×6 − 2×6 overlap = 36 + 36 − 12 = 60.
    expect(area(merged)).toBeCloseTo(60, 1);
    expect(toShapes(merged)).toHaveLength(1);
  });

  test("offsetRound: +δ grows + rounds corners, −δ shrinks", () => {
    const grown = offsetRound([rect(0, 0, 10, 10)], 1);
    expect(area(grown)).toBeGreaterThan(100);
    // Rounded corners → far more than the 4 original vertices.
    expect(grown[0]!.length).toBeGreaterThan(8);
    const shrunk = offsetRound([rect(0, 0, 10, 10)], -1);
    expect(area(shrunk)).toBeLessThan(100);
    expect(area(shrunk)).toBeGreaterThan(0);
  });

  test("removeOnlyFillet is anti-extensive (never adds copper)", () => {
    const sq: PathsD = [rect(0, 0, 10, 10)];
    const filleted = removeOnlyFillet(sq, 0.5);
    // A round opening only trims convex corners → area must not exceed input.
    expect(area(filleted)).toBeLessThanOrEqual(area(sq) + 1e-6);
    expect(area(filleted)).toBeGreaterThan(area(sq) - 1); // only corners lost
  });

  test("removeOnlyFillet severs a sub-min-width neck (sliver removal)", () => {
    // Two blobs bridged by a 0.1 mm-tall neck; opening by r=0.2 cuts it.
    const dumbbell = union(
      [rect(-3, 0, 4.2, 5)], // x ∈ [-5.1,-0.9]
      [rect(3, 0, 4.2, 5)], //  x ∈ [ 0.9, 5.1]
      [rect(0, 0, 2, 0.1)], //  bridge, overlaps both
    );
    expect(toShapes(dumbbell)).toHaveLength(1); // connected before
    const opened = removeOnlyFillet(dumbbell, 0.2);
    expect(toShapes(opened)).toHaveLength(2); // neck severed
  });

  test("fail-closed / empty-input invariants", () => {
    expect(toShapes([])).toHaveLength(0);
    expect(union()).toHaveLength(0);
    expect(difference([rect(0, 0, 4, 4)], [])).toHaveLength(1);
    // Degenerate zero-area ring → no shape.
    const degenerate: PathD = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(toShapes([degenerate])).toHaveLength(0);
  });
});
