import { describe, test, expect } from "vitest";
import { matchAxis, sortFeatures, type AxisFeature } from "./axis-match";

const f = (
  coordMm: number,
  sourceId: string,
  crossMin = 0,
  crossMax = 1,
): AxisFeature => ({ coordMm, crossMin, crossMax, sourceId });

describe("axis-match", () => {
  test("matches a feature within tolerance", () => {
    const sorted = sortFeatures([f(10, "a"), f(20, "b")]);
    const [m] = matchAxis(
      sorted,
      [{ coordMm: 10.05, crossMin: 0, crossMax: 1 }],
      0.1,
    );
    expect(m).not.toBeNull();
    expect(m!.coordMm).toBe(10);
    expect(m!.deltaMm).toBeCloseTo(-0.05, 6);
    expect(m!.sourceIds).toEqual(["a"]);
  });

  test("returns null beyond tolerance", () => {
    const sorted = sortFeatures([f(10, "a")]);
    const [m] = matchAxis(
      sorted,
      [{ coordMm: 10.5, crossMin: 0, crossMax: 1 }],
      0.1,
    );
    expect(m).toBeNull();
  });

  test("groups collinear features into one match with all source ids", () => {
    const sorted = sortFeatures([
      f(10, "a", 0, 2),
      f(10, "b", 5, 7),
      f(10, "c", -3, -1),
    ]);
    const [m] = matchAxis(
      sorted,
      [{ coordMm: 10.02, crossMin: 1, crossMax: 1.5 }],
      0.1,
    );
    expect(m!.sourceIds.slice().sort()).toEqual(["a", "b", "c"]);
    // span = union of query + matched features cross-extents
    expect(m!.crossMin).toBe(-3);
    expect(m!.crossMax).toBe(7);
  });

  test("picks the nearest feature when several are within tolerance", () => {
    const sorted = sortFeatures([f(10.08, "far"), f(10.01, "near")]);
    const [m] = matchAxis(
      sorted,
      [{ coordMm: 10, crossMin: 0, crossMax: 1 }],
      0.2,
    );
    expect(m!.coordMm).toBeCloseTo(10.01, 6);
    expect(m!.sourceIds).toEqual(["near"]);
  });

  test("handles empty inputs", () => {
    expect(
      matchAxis([], [{ coordMm: 0, crossMin: 0, crossMax: 1 }], 0.1),
    ).toEqual([null]);
    expect(matchAxis(sortFeatures([f(0, "a")]), [], 0.1)).toEqual([]);
  });

  test("returns one entry per query, in order", () => {
    const sorted = sortFeatures([f(0, "a"), f(100, "b")]);
    const res = matchAxis(
      sorted,
      [
        { coordMm: 0.01, crossMin: 0, crossMax: 1 },
        { coordMm: 50, crossMin: 0, crossMax: 1 },
        { coordMm: 100.02, crossMin: 0, crossMax: 1 },
      ],
      0.1,
    );
    expect(res).toHaveLength(3);
    expect(res[0]!.sourceIds).toEqual(["a"]);
    expect(res[1]).toBeNull();
    expect(res[2]!.sourceIds).toEqual(["b"]);
  });
});
