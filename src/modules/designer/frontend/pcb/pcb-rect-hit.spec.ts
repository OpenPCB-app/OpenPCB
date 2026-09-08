import { describe, expect, test } from "vitest";
import type { PcbPointMm } from "../../../../sdks";
import { ringContainedInRect, ringIntersectsRect } from "./pcb-rect-hit";

const SQUARE: PcbPointMm[] = [
  { x: 2, y: 2 },
  { x: 4, y: 2 },
  { x: 4, y: 4 },
  { x: 2, y: 4 },
];

describe("ringContainedInRect", () => {
  test("true when the rect fully contains the ring", () => {
    const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(ringContainedInRect(SQUARE, rect)).toBe(true);
  });

  test("false when the ring straddles the rect boundary", () => {
    const rect = { minX: 0, minY: 0, maxX: 3, maxY: 10 };
    expect(ringContainedInRect(SQUARE, rect)).toBe(false);
  });

  test("false when the ring is fully disjoint from the rect", () => {
    const rect = { minX: 100, minY: 100, maxX: 110, maxY: 110 };
    expect(ringContainedInRect(SQUARE, rect)).toBe(false);
  });
});

describe("ringIntersectsRect", () => {
  test("true when the rect fully contains the ring", () => {
    const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(ringIntersectsRect(SQUARE, rect)).toBe(true);
  });

  test("true when the ring straddles the rect boundary", () => {
    const rect = { minX: 0, minY: 0, maxX: 3, maxY: 10 };
    expect(ringIntersectsRect(SQUARE, rect)).toBe(true);
  });

  test("false when the ring is fully disjoint from the rect", () => {
    const rect = { minX: 100, minY: 100, maxX: 110, maxY: 110 };
    expect(ringIntersectsRect(SQUARE, rect)).toBe(false);
  });
});
