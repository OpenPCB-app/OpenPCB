import { describe, expect, test } from "vitest";
import type { PcbPointMm } from "../../../../../sdks";
import { keepoutHatchSegments, keepoutRingSegments } from "./KeepoutLayer";

const SQUARE: PcbPointMm[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/** The "U" of a keepout with a notch cut out of its top edge. */
const U_SHAPE: PcbPointMm[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 7, y: 10 },
  { x: 7, y: 3 },
  { x: 3, y: 3 },
  { x: 3, y: 10 },
  { x: 0, y: 10 },
];

/** `[ax, ay, bx, by]` per emitted hatch/outline segment. */
function segments(buffer: Float32Array | null): number[][] {
  if (!buffer) return [];
  const out: number[][] = [];
  for (let i = 0; i < buffer.length; i += 6) {
    out.push([buffer[i]!, buffer[i + 1]!, buffer[i + 3]!, buffer[i + 4]!]);
  }
  return out;
}

/** Even-odd point-in-polygon, independent of the code under test. */
function inside(point: PcbPointMm, ring: ReadonlyArray<PcbPointMm>): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      hit = !hit;
    }
  }
  return hit;
}

describe("keepoutRingSegments", () => {
  test("closes the ring back to the first vertex", () => {
    const segs = segments(keepoutRingSegments(SQUARE));
    expect(segs).toHaveLength(4);
    expect(segs[0]).toEqual([0, 0, 10, 0]);
    expect(segs[3]).toEqual([0, 10, 0, 0]);
  });

  test("rejects a ring with fewer than three vertices", () => {
    expect(
      keepoutRingSegments([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
  });
});

describe("keepoutHatchSegments", () => {
  test("emits 45° lines clipped to the polygon", () => {
    const segs = segments(keepoutHatchSegments(SQUARE, 2));
    expect(segs.length).toBeGreaterThan(0);
    for (const [ax, ay, bx, by] of segs) {
      // x − y is the line's constant, so both endpoints share it and every
      // segment runs at exactly 45°.
      expect(ax! - ay!).toBeCloseTo(bx! - by!, 9);
      expect(bx! - ax!).toBeCloseTo(by! - ay!, 9);
      for (const v of [ax!, ay!, bx!, by!]) {
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(v).toBeLessThanOrEqual(10 + 1e-9);
      }
    }
  });

  test("skips the interior notch of a concave keepout", () => {
    const segs = segments(keepoutHatchSegments(U_SHAPE, 1));
    expect(segs.length).toBeGreaterThan(0);
    for (const [ax, ay, bx, by] of segs) {
      const mid = { x: (ax! + bx!) / 2, y: (ay! + by!) / 2 };
      if (Math.hypot(bx! - ax!, by! - ay!) < 1e-6) continue;
      expect(inside(mid, U_SHAPE)).toBe(true);
    }
  });

  test("anchors the line family on multiples of the spacing", () => {
    const spacing = 2;
    for (const [ax, ay] of segments(keepoutHatchSegments(SQUARE, spacing))) {
      expect((ax! - ay!) % spacing).toBeCloseTo(0, 9);
    }
  });

  test("returns null for a degenerate ring or a non-positive spacing", () => {
    expect(keepoutHatchSegments(SQUARE, 0)).toBeNull();
    expect(keepoutHatchSegments([{ x: 0, y: 0 }], 1)).toBeNull();
  });
});
