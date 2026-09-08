import { describe, expect, test } from "vitest";
import type { PcbPointMm } from "../../../../sdks";
import {
  deleteRingVertex,
  hitRingEdge,
  hitRingVertex,
  insertRingVertex,
  moveRingVertex,
} from "./pcb-ring-edit";

const SQUARE: PcbPointMm[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("hitRingVertex", () => {
  test("finds the nearest vertex within tolerance", () => {
    expect(hitRingVertex(SQUARE, { x: 0.2, y: 0.1 }, 0.5)).toBe(0);
    expect(hitRingVertex(SQUARE, { x: 9.8, y: 9.9 }, 0.5)).toBe(2);
  });

  test("returns null when nothing is within tolerance", () => {
    expect(hitRingVertex(SQUARE, { x: 5, y: 5 }, 0.5)).toBeNull();
  });
});

describe("hitRingEdge", () => {
  test("finds the midpoint of an edge", () => {
    const hit = hitRingEdge(SQUARE, { x: 5, y: 0.1 }, 0.5);
    expect(hit).not.toBeNull();
    expect(hit!.edgeIndex).toBe(0);
    expect(hit!.pointMm.x).toBeCloseTo(5, 6);
    expect(hit!.pointMm.y).toBeCloseTo(0, 6);
  });

  test("wraps to the closing edge (last vertex → first)", () => {
    const hit = hitRingEdge(SQUARE, { x: 0.1, y: 5 }, 0.5);
    expect(hit).not.toBeNull();
    expect(hit!.edgeIndex).toBe(3);
  });

  test("excludes the vertex-tolerance zone at either endpoint", () => {
    // Near vertex (10,0): within edge-projection distance but inside the
    // vertex exclusion radius — must not report an edge hit here.
    expect(hitRingEdge(SQUARE, { x: 9.8, y: 0.1 }, 0.5)).toBeNull();
  });

  test("returns null when nothing is within tolerance", () => {
    expect(hitRingEdge(SQUARE, { x: 5, y: 5 }, 0.5)).toBeNull();
  });
});

describe("moveRingVertex", () => {
  test("moves only the targeted vertex, preserving order", () => {
    const next = moveRingVertex(SQUARE, 1, { x: 20, y: 0 });
    expect(next).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });
});

describe("insertRingVertex", () => {
  test("inserts right after edgeIndex", () => {
    const next = insertRingVertex(SQUARE, 0, { x: 5, y: 0 });
    expect(next).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  test("inserting after the wrap-around edge appends", () => {
    const next = insertRingVertex(SQUARE, 3, { x: 0, y: 5 });
    expect(next).toEqual([...SQUARE, { x: 0, y: 5 }]);
  });
});

describe("deleteRingVertex", () => {
  test("removes the vertex, preserving order", () => {
    const next = deleteRingVertex(SQUARE, 1);
    expect(next).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  test("returns null at a triangle", () => {
    const triangle: PcbPointMm[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    expect(deleteRingVertex(triangle, 0)).toBeNull();
  });
});
