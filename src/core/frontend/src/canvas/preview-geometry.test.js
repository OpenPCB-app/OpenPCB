import { describe, expect, it } from "vitest";
import { graphicStrokeSegments } from "../../../../shared/frontend/canvas/preview/geometry";

describe("preview geometry segments", () => {
  it("builds line and rect segments", () => {
    expect(
      graphicStrokeSegments({
        kind: "line",
        a: { x: 1, y: 2 },
        b: { x: 3, y: 4 },
        strokeWidthMm: 0.1,
      }),
    ).toEqual([[1, 2, 3, 4]]);

    const rect = graphicStrokeSegments({
      kind: "rect",
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      fill: "none",
      strokeWidthMm: 0.1,
    });
    expect(rect).toHaveLength(4);
  });

  it("builds circle, polyline, arc and bezier segments", () => {
    const circle = graphicStrokeSegments({
      kind: "circle",
      center: { x: 0, y: 0 },
      radiusMm: 1,
      fill: "none",
      strokeWidthMm: 0.1,
    });
    expect(circle).toHaveLength(24);

    const poly = graphicStrokeSegments({
      kind: "polyline",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      closed: true,
      fill: "none",
      strokeWidthMm: 0.1,
    });
    expect(poly).toHaveLength(3);

    const arc = graphicStrokeSegments({
      kind: "arc3",
      start: { x: 1, y: 0 },
      mid: { x: 0, y: 1 },
      end: { x: -1, y: 0 },
      strokeWidthMm: 0.1,
    });
    expect(arc.length).toBeGreaterThan(1);

    const bezier = graphicStrokeSegments({
      kind: "bezier",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      strokeWidthMm: 0.1,
    });
    expect(bezier).toHaveLength(20);
  });
});
