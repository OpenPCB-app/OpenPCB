import { describe, expect, test } from "bun:test";
import { SCHEMATIC_GRID_NM } from "../../../shared/schematic-routing/manhattan";
import {
  dragWireSegment,
  wireSegmentAxis,
} from "../../../shared/schematic-routing/segment-drag";

const G = SCHEMATIC_GRID_NM;

describe("wireSegmentAxis", () => {
  test("horizontal segment (shared y)", () => {
    expect(wireSegmentAxis({ x: 0, y: 0 }, { x: 10 * G, y: 0 })).toBe("h");
  });
  test("vertical segment (shared x)", () => {
    expect(wireSegmentAxis({ x: 0, y: 0 }, { x: 0, y: 10 * G })).toBe("v");
  });
  test("degenerate / diagonal → null", () => {
    expect(wireSegmentAxis({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(wireSegmentAxis({ x: 0, y: 0 }, { x: G, y: G })).toBeNull();
  });
});

describe("dragWireSegment", () => {
  test("snaps the moved segment to the absolute grid while preserving off-grid endpoints", () => {
    const path = [
      { x: -11_160_000, y: -3_305_000 },
      { x: -11_160_000, y: -2_900_000 },
      { x: 18_760_000, y: -2_900_000 },
      { x: 18_760_000, y: 1_100_000 },
    ];
    const moved = dragWireSegment(path, 1, { x: 0, y: -4_900_000 }, 1_270_000);
    expect(moved).toEqual([
      path[0]!,
      { x: -11_160_000, y: -7_620_000 },
      { x: 18_760_000, y: -7_620_000 },
      path[3]!,
    ]);
    expect(dragWireSegment(path, 1, { x: 0, y: -4_900_000 }, 0)[1]!.y).toBe(
      -7_800_000,
    );
    expect(dragWireSegment(path, 1, { x: 100, y: 0 }, 1_270_000)).toBe(path);
  });
  // Z-shaped wire: source(0,0) → up → across → down → target.
  const zPath = [
    { x: 0, y: 0 },
    { x: 0, y: 10 * G },
    { x: 10 * G, y: 10 * G },
    { x: 10 * G, y: 0 },
  ];

  test("interior horizontal segment slides in Y; neighbours stretch", () => {
    // Segment index 1 is the horizontal top run (y = 10G). Drag it up 4G.
    const out = dragWireSegment(zPath, 1, { x: 0, y: 4 * G });
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 14 * G },
      { x: 10 * G, y: 14 * G },
      { x: 10 * G, y: 0 },
    ]);
  });

  test("parallel drag component is ignored (no-op)", () => {
    // Horizontal segment: X delta is parallel → dropped → unchanged.
    const out = dragWireSegment(zPath, 1, { x: 5 * G, y: 0 });
    expect(out).toBe(zPath);
  });

  test("first segment touching the source pin inserts a stub", () => {
    // Segment index 0 is vertical (source pin at 0,0). Drag it +X by 6G.
    const out = dragWireSegment(zPath, 0, { x: 6 * G, y: 0 });
    expect(out).toEqual([
      { x: 0, y: 0 }, // pinned source, unchanged
      { x: 6 * G, y: 0 }, // inserted stub corner
      { x: 6 * G, y: 10 * G },
      { x: 10 * G, y: 10 * G },
      { x: 10 * G, y: 0 },
    ]);
  });

  test("last segment touching the target pin inserts a stub", () => {
    // Segment index 2 is vertical (target pin at 10G,0). Drag it +X by 6G.
    const out = dragWireSegment(zPath, 2, { x: 6 * G, y: 0 });
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 * G },
      { x: 16 * G, y: 10 * G },
      { x: 16 * G, y: 0 }, // inserted stub corner
      { x: 10 * G, y: 0 }, // pinned target, unchanged
    ]);
  });

  test("straight horizontal pin-to-pin wire becomes a 4-point staple", () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 10 * G, y: 0 },
    ];
    const out = dragWireSegment(straight, 0, { x: 0, y: 4 * G });
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 4 * G },
      { x: 10 * G, y: 4 * G },
      { x: 10 * G, y: 0 },
    ]);
  });

  test("straight vertical pin-to-pin wire becomes a 4-point staple", () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 0, y: 10 * G },
    ];
    const out = dragWireSegment(straight, 0, { x: 4 * G, y: 0 });
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 4 * G, y: 0 },
      { x: 4 * G, y: 10 * G },
      { x: 0, y: 10 * G },
    ]);
  });

  test("dragging a run onto the baseline collapses collinear points", () => {
    // Drag the Z top run down 10G so it lands on the endpoints' row → the
    // whole wire simplifies back to a straight pin-to-pin segment.
    const out = dragWireSegment(zPath, 1, { x: 0, y: -10 * G });
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 10 * G, y: 0 },
    ]);
  });

  test("zero shift is a no-op returning the original array", () => {
    expect(dragWireSegment(zPath, 1, { x: 0, y: 0 })).toBe(zPath);
  });

  test("out-of-range segment index returns the original array", () => {
    expect(dragWireSegment(zPath, 9, { x: 0, y: 4 * G })).toBe(zPath);
    expect(dragWireSegment(zPath, -1, { x: 0, y: 4 * G })).toBe(zPath);
  });

  test("sub-grid drag snaps to the grid", () => {
    // Delta smaller than half a grid step rounds to zero → no-op.
    const out = dragWireSegment(zPath, 1, { x: 0, y: G / 4 });
    expect(out).toBe(zPath);
  });
});
