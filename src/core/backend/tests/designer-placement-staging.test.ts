import { describe, expect, test } from "bun:test";
import {
  stageNewPlacements,
  type StagingBounds,
  type StagingFrame,
} from "../../../modules/designer/backend/pcb/placement-staging";

const OUTLINE = { minX: -25, maxX: 25, minY: -15, maxY: 15 };
const frame = (over: Partial<StagingFrame> = {}): StagingFrame => ({
  outlineBbox: OUTLINE,
  boardCenterMm: { x: 0, y: 0 },
  existing: [],
  ...over,
});
const box = (w: number, h: number, cx = 0, cy = 0): StagingBounds => ({
  minX: cx - w / 2,
  maxX: cx + w / 2,
  minY: cy - h / 2,
  maxY: cy + h / 2,
});

interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
function worldRect(
  pos: { xMm: number; yMm: number },
  b: StagingBounds | null,
): Rect {
  const r = b ?? box(5, 5);
  return {
    minX: pos.xMm + r.minX,
    maxX: pos.xMm + r.maxX,
    minY: pos.yMm + r.minY,
    maxY: pos.yMm + r.maxY,
  };
}
const overlap = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

const SEVEN = [
  { id: "p1", bounds: box(10, 4) },
  { id: "p2", bounds: box(3, 3, 0.5, -0.2) },
  { id: "p3", bounds: box(20, 15, -2, 1) },
  { id: "p4", bounds: box(8, 30) },
  { id: "p5", bounds: box(12, 28) },
  { id: "p6", bounds: null },
  { id: "p7", bounds: box(6, 6) },
];

describe("stageNewPlacements", () => {
  test("mixed sizes: no pairwise overlap, all outside outline bbox", () => {
    const out = stageNewPlacements(SEVEN, frame());
    expect(out.size).toBe(7);
    const rects = SEVEN.map((i) => worldRect(out.get(i.id)!, i.bounds));
    for (let i = 0; i < rects.length; i++) {
      expect(rects[i]!.minX).toBeGreaterThanOrEqual(OUTLINE.maxX);
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlap(rects[i]!, rects[j]!)).toBe(false);
      }
    }
  });

  test("deterministic across calls", () => {
    expect([...stageNewPlacements(SEVEN, frame())]).toEqual([
      ...stageNewPlacements(SEVEN, frame()),
    ]);
  });

  test("resync with an added part leaves old slots out of the way", () => {
    const first = stageNewPlacements(SEVEN, frame());
    const existing = SEVEN.map((i) => ({
      xMm: first.get(i.id)!.xMm,
      yMm: first.get(i.id)!.yMm,
      bounds: i.bounds,
    }));
    const added = { id: "p8", bounds: box(9, 9) };
    const next = stageNewPlacements([added], frame({ existing }));
    const nr = worldRect(next.get("p8")!, added.bounds);
    for (const e of existing) {
      expect(overlap(nr, worldRect({ xMm: e.xMm, yMm: e.yMm }, e.bounds))).toBe(
        false,
      );
    }
  });

  test("null bounds fall back to 5x5 cell", () => {
    const out = stageNewPlacements(
      [
        { id: "a", bounds: null },
        { id: "b", bounds: undefined },
      ],
      frame(),
    );
    const a = out.get("a")!;
    const b = out.get("b")!;
    expect(a.xMm).toBe(OUTLINE.maxX + 5 + 2.5);
    expect(a.yMm).toBe(OUTLINE.maxY - 2.5);
    expect(b.yMm).toBe(a.yMm - 5 - 2);
  });

  test("null outline falls back to board center", () => {
    const out = stageNewPlacements(
      [{ id: "a", bounds: box(4, 4) }],
      frame({ outlineBbox: null, boardCenterMm: { x: 10, y: 20 } }),
    );
    expect(out.get("a")).toEqual({ xMm: 17, yMm: 18 });
  });

  test("off-grid frame rounds to integer nm, not 1 um", () => {
    const out = stageNewPlacements(
      [{ id: "a", bounds: box(4, 4) }],
      frame({
        outlineBbox: null,
        boardCenterMm: { x: 10.0001234, y: 20.0000006 },
      }),
    );
    expect(out.get("a")).toEqual({ xMm: 17.000123, yMm: 18.000001 });
  });
});
