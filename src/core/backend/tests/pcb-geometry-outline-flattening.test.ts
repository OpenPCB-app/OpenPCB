/**
 * Outline flattening after the move to the geometry kernel
 * (docs/pcb-hardening/02-geometry-contract.md §3, §4). Default (`bias: "none"`)
 * output stays byte-identical to the pre-move implementation, which is copied
 * into this file as a reference oracle; the authorised changes are the circle /
 * ellipse step rule, the dropped duplicate vertex on a full-radius roundrect,
 * and ring canonicalisation.
 */
import { describe, expect, test } from "bun:test";
import type {
  PcbBoardContour,
  PcbBoardOutline,
  PcbOutlineSegment,
  PcbPointMm,
} from "../../../sdks";
import { arcSegmentCount } from "../../../shared/pcb-geometry/arc-chords";
import { flattenOutline } from "../../../shared/pcb-geometry/outline-geometry";

// --------------------------------------------------------------------------
// Reference oracle: the pre-S2 flattener, verbatim
// --------------------------------------------------------------------------

const LEGACY_MAX_CHORD_DEVIATION_MM = 0.01;
const LEGACY_MIN_ARC_SEGMENTS = 2;
const LEGACY_MAX_ARC_SEGMENTS = 512;

function legacyArcSegmentCount(radiusMm: number, sweepRad: number): number {
  const r = Math.abs(radiusMm);
  const sweep = Math.abs(sweepRad);
  if (r <= LEGACY_MAX_CHORD_DEVIATION_MM || sweep <= 0) {
    return LEGACY_MIN_ARC_SEGMENTS;
  }
  const maxStep =
    2 * Math.acos(Math.max(-1, 1 - LEGACY_MAX_CHORD_DEVIATION_MM / r));
  const steps = Math.ceil(sweep / Math.max(1e-6, maxStep));
  return Math.min(
    LEGACY_MAX_ARC_SEGMENTS,
    Math.max(LEGACY_MIN_ARC_SEGMENTS, steps),
  );
}

function legacyArcPoints(
  start: PcbPointMm,
  end: PcbPointMm,
  center: PcbPointMm,
  cw: boolean,
): PcbPointMm[] {
  const r = Math.hypot(start.x - center.x, start.y - center.y);
  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  let a1 = Math.atan2(end.y - center.y, end.x - center.x);
  if (cw) {
    while (a1 >= a0) a1 -= Math.PI * 2;
  } else {
    while (a1 <= a0) a1 += Math.PI * 2;
  }
  const steps = legacyArcSegmentCount(r, Math.abs(a1 - a0));
  const pts: PcbPointMm[] = [];
  for (let i = 1; i <= steps; i += 1) {
    if (i === steps) {
      pts.push({ x: end.x, y: end.y });
      break;
    }
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
  }
  return pts;
}

function legacyRoundRectPoints(
  center: PcbPointMm,
  widthMm: number,
  heightMm: number,
  cornerRadiusMm: number,
): PcbPointMm[] {
  const hw = widthMm / 2;
  const hh = heightMm / 2;
  const r = Math.max(0, Math.min(cornerRadiusMm, hw, hh));
  if (r <= 0) {
    return [
      { x: center.x + hw, y: center.y - hh },
      { x: center.x + hw, y: center.y + hh },
      { x: center.x - hw, y: center.y + hh },
      { x: center.x - hw, y: center.y - hh },
    ];
  }
  const off = (p: PcbPointMm): PcbPointMm => ({
    x: center.x + p.x,
    y: center.y + p.y,
  });
  const pts: PcbPointMm[] = [];
  const start = off({ x: hw, y: hh - r });
  pts.push(start);
  pts.push(
    ...legacyArcPoints(
      start,
      off({ x: hw - r, y: hh }),
      off({ x: hw - r, y: hh - r }),
      false,
    ),
  );
  pts.push(off({ x: -(hw - r), y: hh }));
  pts.push(
    ...legacyArcPoints(
      off({ x: -(hw - r), y: hh }),
      off({ x: -hw, y: hh - r }),
      off({ x: -(hw - r), y: hh - r }),
      false,
    ),
  );
  pts.push(off({ x: -hw, y: -(hh - r) }));
  pts.push(
    ...legacyArcPoints(
      off({ x: -hw, y: -(hh - r) }),
      off({ x: -(hw - r), y: -hh }),
      off({ x: -(hw - r), y: -(hh - r) }),
      false,
    ),
  );
  pts.push(off({ x: hw - r, y: -hh }));
  pts.push(
    ...legacyArcPoints(
      off({ x: hw - r, y: -hh }),
      off({ x: hw, y: -(hh - r) }),
      off({ x: hw - r, y: -(hh - r) }),
      false,
    ),
  );
  return pts;
}

function legacyContourPoints(
  start: PcbPointMm,
  segments: readonly PcbOutlineSegment[],
): PcbPointMm[] {
  const pts: PcbPointMm[] = [{ x: start.x, y: start.y }];
  let prev = start;
  for (const seg of segments) {
    if (seg.type === "line") {
      pts.push({ x: seg.to.x, y: seg.to.y });
    } else {
      pts.push(...legacyArcPoints(prev, seg.to, seg.centerMm, seg.cw));
    }
    prev = seg.to;
  }
  if (
    pts.length > 1 &&
    Math.abs(pts[pts.length - 1]!.x - start.x) < 1e-9 &&
    Math.abs(pts[pts.length - 1]!.y - start.y) < 1e-9
  ) {
    pts.pop();
  }
  return pts;
}

// --------------------------------------------------------------------------

const line = (x: number, y: number): PcbOutlineSegment => ({
  type: "line",
  to: { x, y },
});
const arc = (
  x: number,
  y: number,
  cx: number,
  cy: number,
  cw = false,
): PcbOutlineSegment => ({
  type: "arc",
  to: { x, y },
  centerMm: { x: cx, y: cy },
  cw,
});

function contour(
  start: PcbPointMm,
  segments: PcbOutlineSegment[],
): PcbBoardContour {
  return {
    kind: "contour",
    widthMm: 0,
    heightMm: 0,
    centerMm: { x: 0, y: 0 },
    start,
    segments,
  };
}

describe("default flattening is byte-identical to the pre-move implementation", () => {
  test("roundrect 20 × 10 r = 2", () => {
    const outline: PcbBoardOutline = {
      kind: "roundrect",
      widthMm: 20,
      heightMm: 10,
      centerMm: { x: 1, y: -2 },
      cornerRadiusMm: 2,
    };
    expect(flattenOutline(outline)).toEqual(
      legacyRoundRectPoints({ x: 1, y: -2 }, 20, 10, 2),
    );
  });

  test("a contour with one 90° arc", () => {
    const c = contour({ x: 0, y: 0 }, [
      line(10, 0),
      arc(15, 5, 10, 5),
      line(15, 20),
      line(0, 20),
      line(0, 0),
    ]);
    expect(flattenOutline(c)).toEqual(
      legacyContourPoints(c.start, c.segments),
    );
  });

  test("polygon points pass through unchanged", () => {
    const outline: PcbBoardOutline = {
      kind: "polygon",
      widthMm: 20,
      heightMm: 20,
      centerMm: { x: 0, y: 0 },
      pointsMm: [
        { x: -10, y: -10 },
        { x: 10, y: -10 },
        { x: 10, y: 10 },
        { x: -10, y: 10 },
      ],
    };
    expect(flattenOutline(outline)).toEqual(outline.pointsMm);
  });

  test("`bias: \"none\"` is the default", () => {
    const c = contour({ x: 0, y: 0 }, [
      line(10, 0),
      arc(15, 5, 10, 5),
      line(0, 5),
      line(0, 0),
    ]);
    expect(flattenOutline(c, { bias: "none" })).toEqual(flattenOutline(c));
  });
});

describe("authorised flattening changes", () => {
  test("circles use the chord rule, not a fixed 64-gon", () => {
    const ring = flattenOutline({
      kind: "circle",
      widthMm: 60,
      heightMm: 60,
      centerMm: { x: 0, y: 0 },
    });
    expect(ring.length).toBe(arcSegmentCount(30, Math.PI * 2));
    expect(ring.length).toBe(122);
  });

  test("a full-radius roundrect emits no zero-length edge", () => {
    const ring = flattenOutline({
      kind: "roundrect",
      widthMm: 10,
      heightMm: 4,
      centerMm: { x: 0, y: 0 },
      cornerRadiusMm: 2,
    });
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(5e-7);
    }
  });

  test("a trailing point within GEOM_EPS_MM of the start is dropped", () => {
    const c = contour({ x: 0, y: 0 }, [
      line(10, 0),
      line(10, 10),
      line(3e-7, 3e-7),
    ]);
    const ring = flattenOutline(c);
    expect(ring).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });
});

// --------------------------------------------------------------------------
// Reviewer-critical findings 8 and 9 (contract §9.1a)
// --------------------------------------------------------------------------

describe("canonicalisation and the circle floor", () => {
  test("an explicitly closed polygon loses its repeated closing vertex", () => {
    const ring = flattenOutline({
      kind: "polygon",
      widthMm: 10,
      heightMm: 10,
      centerMm: { x: 5, y: 5 },
      pointsMm: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 0 },
      ],
    });
    expect(ring.length).toBe(3);
  });

  test("full circles never drop below the legacy 64 chords", () => {
    const small = flattenOutline({
      kind: "circle",
      widthMm: 2,
      heightMm: 2,
      centerMm: { x: 0, y: 0 },
    });
    expect(small.length).toBe(64);
    const large = flattenOutline({
      kind: "circle",
      widthMm: 60,
      heightMm: 60,
      centerMm: { x: 0, y: 0 },
    });
    expect(large.length).toBe(arcSegmentCount(30, Math.PI * 2));
    expect(large.length).toBeGreaterThan(64);
  });
});
