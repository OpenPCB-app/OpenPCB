import { describe, expect, test } from "bun:test";
import {
  buildTracePathThroughAnchors,
  pointToPolylineDistance,
  polylineToAabbDistance,
  polylineToPolylineDistance,
  validate45Path,
  validate90Path,
} from "../../../modules/designer/backend/pcb/pcb-trace-geometry";

describe("validate90Path", () => {
  test("accepts axis-aligned polyline", () => {
    expect(
      validate90Path([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toBeNull();
  });

  test("rejects diagonal segment", () => {
    expect(
      validate90Path([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toMatch(/not axis-aligned/);
  });

  test("rejects too-short path", () => {
    expect(validate90Path([{ x: 0, y: 0 }])).toMatch(/at least 2/);
  });
});

describe("validate45Path", () => {
  test("accepts a 45° diagonal", () => {
    expect(
      validate45Path([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 10, y: 5 },
      ]),
    ).toBeNull();
  });

  test("rejects arbitrary angle", () => {
    expect(
      validate45Path([
        { x: 0, y: 0 },
        { x: 10, y: 3 },
      ]),
    ).toMatch(/45°-routable/);
  });
});

describe("buildTracePathThroughAnchors", () => {
  test("90° mode inserts horizontal-then-vertical elbow", () => {
    const path = buildTracePathThroughAnchors(
      [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ],
      "manhattan-90",
    );
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
    expect(validate90Path(path)).toBeNull();
  });

  test("45° mode default (auto/axis-first) produces axis-aligned + diagonal", () => {
    const path = buildTracePathThroughAnchors(
      [
        { x: 0, y: 0 },
        { x: 10, y: 3 },
      ],
      "manhattan-45",
    );
    // axis-first from no prior: horizontal 7 then 45° diagonal of length 3.
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 7, y: 0 },
      { x: 10, y: 3 },
    ]);
    expect(validate45Path(path)).toBeNull();
  });

  test("45° mode with posture=diagonal produces diagonal + axis-aligned", () => {
    const path = buildTracePathThroughAnchors(
      [
        { x: 0, y: 0 },
        { x: 10, y: 3 },
      ],
      "manhattan-45",
      "diagonal",
    );
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 3 },
      { x: 10, y: 3 },
    ]);
    expect(validate45Path(path)).toBeNull();
  });

  test("90° mode with posture=axis vs diagonal picks different bends", () => {
    const axisFirst = buildTracePathThroughAnchors(
      [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ],
      "manhattan-90",
      "axis",
    );
    expect(axisFirst).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);

    const diagonalFirst = buildTracePathThroughAnchors(
      [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ],
      "manhattan-90",
      "diagonal",
    );
    expect(diagonalFirst).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ]);
  });

  test("auto posture continues a horizontal prior segment without zig-zag", () => {
    // Prior segment (anchor 0 → anchor 1) is horizontal; the elbow from 1 → 2
    // should also start horizontal so the path flows smoothly.
    const path = buildTracePathThroughAnchors(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 12, y: 4 },
      ],
      "manhattan-45",
    );
    // From (5,0): axis-first → horizontal to (8,0), then diagonal 4 to (12,4).
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 }, // sanitized passthrough
      { x: 8, y: 0 },
      { x: 12, y: 4 },
    ]);
  });

  test("pure 45° (Δx === Δy) is a single diagonal segment", () => {
    const path = buildTracePathThroughAnchors(
      [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      "manhattan-45",
    );
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  test("axis-aligned input passes through unchanged", () => {
    const path = buildTracePathThroughAnchors(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      "manhattan-90",
    );
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });
});

describe("polyline distance helpers", () => {
  test("pointToPolylineDistance reports closest segment", () => {
    const result = pointToPolylineDistance({ x: 5, y: 1 }, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(result.distance).toBeCloseTo(1);
    expect(result.segmentIndex).toBe(0);
  });

  test("polylineToPolylineDistance returns 0 when polylines cross", () => {
    const a = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    const b = [
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ];
    expect(polylineToPolylineDistance(a, b)).toBeCloseTo(0);
  });

  test("polylineToAabbDistance returns 0 when polyline endpoint is inside box", () => {
    const poly = [
      { x: 5, y: 5 },
      { x: 20, y: 20 },
    ];
    expect(
      polylineToAabbDistance(poly, {
        minX: 0,
        minY: 0,
        maxX: 10,
        maxY: 10,
      }),
    ).toBeCloseTo(0);
  });

  test("polylineToAabbDistance reports distance for outside polyline", () => {
    const poly = [
      { x: 20, y: 5 },
      { x: 30, y: 5 },
    ];
    expect(
      polylineToAabbDistance(poly, {
        minX: 0,
        minY: 0,
        maxX: 10,
        maxY: 10,
      }),
    ).toBeCloseTo(10);
  });
});
