import { describe, expect, it } from "vitest";
import type { PointNm } from "./route-tool-state";
import {
  classifySegment,
  dragTraceSegment,
  projectPerpendicular,
} from "./trace-drag-state";

const p = (x: number, y: number): PointNm => ({ x, y });

function segments(points: PointNm[]): Array<[PointNm, PointNm]> {
  const out: Array<[PointNm, PointNm]> = [];
  for (let i = 1; i < points.length; i += 1)
    out.push([points[i - 1]!, points[i]!]);
  return out;
}

describe("classifySegment", () => {
  it("identifies orientation", () => {
    expect(classifySegment(p(0, 0), p(10, 0))).toBe("horizontal");
    expect(classifySegment(p(0, 0), p(0, 10))).toBe("vertical");
    expect(classifySegment(p(0, 0), p(10, 10))).toBe("diagonal");
    expect(classifySegment(p(0, 0), p(10, -10))).toBe("diagonal");
    expect(classifySegment(p(0, 0), p(10, 5))).toBe("other");
    expect(classifySegment(p(0, 0), p(0, 0))).toBe("other");
  });
});

describe("projectPerpendicular", () => {
  it("keeps only the perpendicular component for an axis segment", () => {
    // horizontal segment → only Y survives
    expect(projectPerpendicular(p(7, 5), p(0, 0), p(10, 0))).toEqual(p(0, 5));
    // vertical segment → only X survives
    expect(projectPerpendicular(p(7, 5), p(0, 0), p(0, 10))).toEqual(p(7, 0));
  });

  it("projects onto the 45° normal for a diagonal segment", () => {
    // segment dir (1,1); delta (4,0) → perp = (2,-2)
    expect(projectPerpendicular(p(4, 0), p(0, 0), p(10, 10))).toEqual(p(2, -2));
  });
});

describe("dragTraceSegment — 90° mode", () => {
  const mode = "manhattan-90" as const;

  it("nudges an interior horizontal segment, neighbors stretch", () => {
    // vertical, horizontal, vertical
    const pts = [p(0, 0), p(0, 10), p(20, 10), p(20, 0)];
    const r = dragTraceSegment(pts, 1, p(3, 5), mode);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.pointsNm).toEqual([p(0, 0), p(0, 15), p(20, 15), p(20, 0)]);
    for (const [a, b] of segments(r.pointsNm)) {
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it("ignores drag along the segment direction", () => {
    const pts = [p(0, 0), p(0, 10), p(20, 10), p(20, 0)];
    // pure horizontal delta on a horizontal segment → no perpendicular motion
    const r = dragTraceSegment(pts, 1, p(8, 0), mode);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.pointsNm).toEqual(pts);
  });

  it("offsets a single straight segment while anchoring both terminals", () => {
    const pts = [p(0, 0), p(20, 0)];
    const r = dragTraceSegment(pts, 0, p(0, 5), mode);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    // terminals preserved
    expect(r.pointsNm[0]).toEqual(p(0, 0));
    expect(r.pointsNm[r.pointsNm.length - 1]).toEqual(p(20, 0));
    // forms a staple offset to y=5 via vertical jogs
    expect(r.pointsNm).toEqual([p(0, 0), p(0, 5), p(20, 5), p(20, 0)]);
  });
});

describe("dragTraceSegment — 45° mode", () => {
  const mode = "manhattan-45" as const;

  it("nudges an axis segment and re-solves the diagonal neighbor to stay 45°", () => {
    // diagonal then horizontal
    const pts = [p(0, 0), p(10, 10), p(30, 10)];
    const r = dragTraceSegment(pts, 1, p(0, 5), mode);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    // every segment must be axis-aligned or true 45°
    for (const [a, b] of segments(r.pointsNm)) {
      const adx = Math.abs(b.x - a.x);
      const ady = Math.abs(b.y - a.y);
      expect(adx === 0 || ady === 0 || adx === ady).toBe(true);
    }
    // terminals preserved
    expect(r.pointsNm[0]).toEqual(p(0, 0));
    expect(r.pointsNm[r.pointsNm.length - 1]).toEqual(p(30, 10));
  });

  it("translates a diagonal segment while preserving its slope", () => {
    const pts = [p(0, 0), p(0, 10), p(10, 20), p(10, 30)];
    const r = dragTraceSegment(pts, 1, p(4, -4), mode);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    for (const [a, b] of segments(r.pointsNm)) {
      const adx = Math.abs(b.x - a.x);
      const ady = Math.abs(b.y - a.y);
      expect(adx === 0 || ady === 0 || adx === ady).toBe(true);
    }
  });
});

describe("dragTraceSegment — rejection", () => {
  it("rejects a non-axis/non-45 segment", () => {
    const pts = [p(0, 0), p(10, 3), p(20, 0)];
    const r = dragTraceSegment(pts, 0, p(0, 5), "manhattan-45");
    expect(r.kind).toBe("rejected");
  });

  it("rejects an out-of-range segment index", () => {
    const pts = [p(0, 0), p(10, 0)];
    expect(dragTraceSegment(pts, 5, p(0, 5), "manhattan-90").kind).toBe(
      "rejected",
    );
  });
});
