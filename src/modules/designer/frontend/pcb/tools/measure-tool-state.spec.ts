import { describe, expect, test } from "vitest";
import {
  formatMeasureLabel,
  initialMeasureToolState,
  measureBetween,
  measureToolReducer,
  type MeasureAnchor,
} from "./measure-tool-state";

const anchor = (x: number, y: number): MeasureAnchor => ({
  kind: "grid",
  pointMm: { x, y },
});

describe("measure tool state", () => {
  test("click starts, second click locks, clear resets", () => {
    const measuring = measureToolReducer(initialMeasureToolState, {
      kind: "click",
      anchor: anchor(0, 0),
    });
    expect(measuring.kind).toBe("measuring");

    const locked = measureToolReducer(measuring, {
      kind: "click",
      anchor: anchor(3, 4),
    });
    expect(locked.kind).toBe("locked");

    const cleared = measureToolReducer(locked, { kind: "clear" });
    expect(cleared).toEqual(initialMeasureToolState);
  });

  test("locked click starts a new measurement", () => {
    const locked = measureToolReducer(
      measureToolReducer(initialMeasureToolState, {
        kind: "click",
        anchor: anchor(0, 0),
      }),
      { kind: "click", anchor: anchor(1, 1) },
    );
    const next = measureToolReducer(locked, {
      kind: "click",
      anchor: anchor(2, 2),
    });

    expect(next).toEqual({ kind: "measuring", start: anchor(2, 2) });
  });

  test("formats distance and delta readout", () => {
    expect(measureBetween({ x: 0, y: 0 }, { x: 3, y: 4 }).distanceMm).toBe(5);
    expect(formatMeasureLabel({ x: 0, y: 0 }, { x: 3, y: 4 }, false)).toBe(
      "5.000 mm",
    );
    expect(formatMeasureLabel({ x: 0, y: 0 }, { x: 3, y: 4 }, true)).toBe(
      "5.000 mm  Δx 3.000 mm  Δy 4.000 mm",
    );
  });
});
