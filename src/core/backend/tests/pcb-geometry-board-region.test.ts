/**
 * The board region and its containment / overlap predicates
 * (docs/pcb-hardening/02-geometry-contract.md §4, §5), including the Astra
 * spec-attack findings the contract absorbed (§9.1 F1, F2, F3, F5, F7).
 *
 * The region is a CLOSED set: the outer ring's interior and boundary minus the
 * interior of every hole. Every predicate is closed at GEOM_EPS_MM.
 */
import { describe, expect, test } from "bun:test";
import type {
  PcbBoardCutout,
  PcbBoardOutline,
  PcbOutlineSegment,
  PcbPointMm,
} from "../../../sdks";
import {
  type BoardRegion,
  buildBoardRegion,
  discInsideRegion,
  pointInOutline,
  polygonInsideRegion,
  regionBoundaryDistancePoint,
  regionBoundaryDistancePolyline,
  regionBoundaryDistanceRing,
  regionContainsPoint,
  ringsIntersect,
  ringStrictlyInside,
  segmentInsideRegion,
  stadiumInsideRegion,
  } from "../../../shared/pcb-geometry/board-region";
import { pointToPrimDistance } from "../../../shared/pcb-geometry/exact-arcs";
import {
  pointInExactRing,
  ringPrims,
} from "../../../shared/pcb-geometry/exact-ring";
import {
  ExactBudgetExceeded,
  exactInsideRegion,
  exactSignedMargin,
} from "../../../shared/pcb-geometry/region-exact";
import {
  roundedInsideRegion,
  roundedPenetration,
  signedMargin,
} from "../../../shared/pcb-geometry/region-rounded";
import {
  flattenOutline,
  MAX_ARC_SEGMENTS,
  MAX_CHORD_DEVIATION_MM,
} from "../../../shared/pcb-geometry/outline-geometry";
import {
  pointInPolygon,
  pointToPolygonDistance,
  pointToRingEdgeDistance,
  polygonToPolygonDistance,
  polylineToRingEdgeDistance,
  ringToRingEdgeDistance,
} from "../../../shared/pcb-geometry/pcb-clearance-geometry";
import {
  ringOrientation,
  ringSignedArea,
} from "../../../shared/pcb-geometry/ring-utils";
import { ringSelfIntersects } from "../../../shared/pcb-geometry/segment-predicates";
import { GEOM_EPS_MM } from "../../../shared/pcb-geometry/tolerance";

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const p = (x: number, y: number): PcbPointMm => ({ x, y });
const line = (x: number, y: number): PcbOutlineSegment => ({
  type: "line",
  to: p(x, y),
});
const arcTo = (
  x: number,
  y: number,
  cx: number,
  cy: number,
  cw = false,
): PcbOutlineSegment => ({
  type: "arc",
  to: p(x, y),
  centerMm: p(cx, cy),
  cw,
});

const rect = (w: number, h: number, cx = 0, cy = 0): PcbBoardOutline => ({
  kind: "rect",
  widthMm: w,
  heightMm: h,
  centerMm: p(cx, cy),
});

const polygonOutline = (pts: PcbPointMm[]): PcbBoardOutline => ({
  kind: "polygon",
  widthMm: 0,
  heightMm: 0,
  centerMm: p(0, 0),
  pointsMm: pts,
});

const contour = (
  start: PcbPointMm,
  segments: PcbOutlineSegment[],
): PcbBoardOutline => ({
  kind: "contour",
  widthMm: 0,
  heightMm: 0,
  centerMm: p(0, 0),
  start,
  segments,
});

const circleCut = (id: string, r: number, cx: number, cy: number): PcbBoardCutout => ({
  id,
  shape: { kind: "circle", widthMm: r * 2, heightMm: r * 2, centerMm: p(cx, cy) },
});

const contourCut = (
  id: string,
  start: PcbPointMm,
  segments: PcbOutlineSegment[],
): PcbBoardCutout => ({
  id,
  shape: {
    kind: "contour",
    widthMm: 0,
    heightMm: 0,
    centerMm: p(0, 0),
    start,
    segments,
  },
});

/** Closed rectangular contour cutout, counter-clockwise. */
const boxCut = (
  id: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): PcbBoardCutout =>
  contourCut(id, p(x0, y0), [
    line(x1, y0),
    line(x1, y1),
    line(x0, y1),
    line(x0, y0),
  ]);

const board100 = rect(100, 100);
const INNER = { bias: "board-inner" } as const;
const PLAIN = { bias: "none" } as const;

const squareRing = (halfMm: number, cx = 0, cy = 0): PcbPointMm[] => [
  p(cx - halfMm, cy - halfMm),
  p(cx + halfMm, cy - halfMm),
  p(cx + halfMm, cy + halfMm),
  p(cx - halfMm, cy + halfMm),
];

const boxRing = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): PcbPointMm[] => [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)];

// --------------------------------------------------------------------------
// 1. Bias
// --------------------------------------------------------------------------

describe("bias: the biased region is a subset of the true board", () => {
  test("a roundrect outer ring is inscribed and carries no zero-length edge", () => {
    const outline: PcbBoardOutline = {
      kind: "roundrect",
      widthMm: 60,
      heightMm: 40,
      centerMm: p(0, 0),
      cornerRadiusMm: 20,
    };
    const region = buildBoardRegion(outline, [], INNER);
    for (const v of region.outer) {
      // Inside the true roundrect: within r of the inner rectangle's clamp.
      const cx = Math.max(-10, Math.min(10, v.x));
      const cy = Math.max(0, Math.min(0, v.y));
      expect(Math.hypot(v.x - cx, v.y - cy)).toBeLessThanOrEqual(20 + 1e-12);
    }
    for (let i = 0; i < region.outer.length; i += 1) {
      const a = region.outer[i]!;
      const b = region.outer[(i + 1) % region.outer.length]!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(5e-7);
    }
  });

  test("a circular cutout is circumscribed — the true circle is inside the hole ring", () => {
    const region = buildBoardRegion(board100, [circleCut("c", 5, 0, 0)], INNER);
    const hole = region.holes[0]!;
    for (let k = 0; k < 720; k += 1) {
      const a = (k / 720) * Math.PI * 2;
      const s = p(Math.cos(a) * 5, Math.sin(a) * 5);
      expect(pointToPolygonDistance(s, hole)).toBeLessThan(1e-9);
    }
  });

  test("a concave notch is circumscribed, and CW/CCW authoring give one region", () => {
    // Square board with a semicircular notch (r = 5, centre (0, 20)) milled
    // into the top edge.
    const ccwBoard = contour(p(-20, -20), [
      line(20, -20),
      line(20, 20),
      line(5, 20),
      arcTo(-5, 20, 0, 20, true),
      line(-20, 20),
      line(-20, -20),
    ]);
    const cwBoard = contour(p(-20, -20), [
      line(-20, 20),
      line(-5, 20),
      arcTo(5, 20, 0, 20, false),
      line(20, 20),
      line(20, -20),
      line(-20, -20),
    ]);
    const ccw = buildBoardRegion(ccwBoard, [], INNER);
    const cw = buildBoardRegion(cwBoard, [], INNER);
    expect(ringOrientation(ccw.outer)).toBe(1);
    expect(ringOrientation(cw.outer)).toBe(-1);
    expect(cw.outer.length).toBe(ccw.outer.length);
    // Same region: identical containment verdicts on a dense grid.
    for (let ix = 0; ix <= 40; ix += 1) {
      for (let iy = 0; iy <= 40; iy += 1) {
        const q = p(-21 + ix, -21 + iy);
        expect(regionContainsPoint(cw, q)).toBe(regionContainsPoint(ccw, q));
      }
    }
    // The biased notch is cut deeper than the true one: mid-chord samples of
    // the true notch arc land outside the board polygon.
    const steps = ccw.outer.length;
    let outside = 0;
    for (let k = 0; k < 64; k += 1) {
      const a = Math.PI + ((k + 0.5) / 64) * Math.PI;
      const s = p(Math.cos(a) * 5, 20 + Math.sin(a) * 5);
      if (!pointInPolygon(s, ccw.outer)) outside += 1;
    }
    expect(outside).toBe(64);
    expect(steps).toBeGreaterThan(6);
  });

  test("a peninsula arc bulging into a hole is inscribed, a bulging hole edge is not", () => {
    // Rectangular cutout [10,30] x [-5,5] with a rounded peninsula of BOARD
    // pushed up into it from below: the arc's centre (20,-6) lies in the board,
    // so inscribing it is what grows the hole.
    const radius = Math.hypot(2, 1);
    const peninsula = contourCut("c", p(10, -5), [
      line(18, -5),
      arcTo(22, -5, 20, -6, true),
      line(30, -5),
      line(30, 5),
      line(10, 5),
      line(10, -5),
    ]);
    const inHole = buildBoardRegion(board100, [peninsula], INNER).holes[0]!;
    const onArc = inHole.filter(
      (v) => Math.abs(Math.hypot(v.x - 20, v.y + 6) - radius) < 1e-12,
    );
    expect(onArc.length).toBeGreaterThan(4);

    // The mirror case: an arc whose centre is inside the hole must NOT be
    // inscribed, or the hole would shrink and the board would grow.
    const bulge = contourCut("c", p(10, -5), [
      line(30, -5),
      line(30, 5),
      line(10, 5),
      arcTo(10, -5, 10, 0, false),
    ]);
    const outHole = buildBoardRegion(board100, [bulge], INNER).holes[0]!;
    const onBulge = outHole.filter(
      (v) => Math.abs(Math.hypot(v.x - 10, v.y) - 5) < 1e-12,
    );
    expect(onBulge.length).toBe(2); // only the exact arc endpoints
  });

  test("a degenerate bow-tie never throws and is left unbiased", () => {
    const bowtie = contour(p(0, 0), [
      line(10, 10),
      line(10, 0),
      line(0, 10),
      line(0, 0),
    ]);
    const region = buildBoardRegion(bowtie, [], INNER);
    expect(ringOrientation(region.outer)).toBe(0);
    expect(region.fallbacks).toEqual([]);
    expect(region.outer).toEqual(region.unbiasedOuter);
  });

  test("a full-radius roundrect cutout keeps its duplicate vertex canonicalised away", () => {
    const cut: PcbBoardCutout = {
      id: "slot",
      shape: {
        kind: "roundrect",
        widthMm: 10,
        heightMm: 4,
        centerMm: p(0, 0),
        cornerRadiusMm: 2,
      },
    };
    const region = buildBoardRegion(board100, [cut], INNER);
    const hole = region.holes[0]!;
    for (let i = 0; i < hole.length; i += 1) {
      const a = hole[i]!;
      const b = hole[(i + 1) % hole.length]!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(5e-7);
    }
    expect(ringSelfIntersects(hole)).toBe(false);
  });

  test("Astra F1: refinement resolves a chord crossing an authored spur", () => {
    const outer = rect(4, 5, 1, -0.5); // [-1, 3] x [-3, 2]
    const cut = contourCut("f1", p(1, 0), [
      arcTo(0, 1, 0, 0, false),
      line(2, -2),
      line(1.1, 0.2),
      line(0.996, 0.1),
      line(1.1, 0.05),
      line(1, 0),
    ]);
    const region = buildBoardRegion(outer, [cut], INNER);
    expect(ringSelfIntersects(region.holes[0]!)).toBe(false);
    expect(region.fallbacks).toEqual([]);
    expect(regionContainsPoint(region, p(0.998, 0.1))).toBe(false);
    expect(discInsideRegion(region, p(0.998, 0.1), 0.0005)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 2. regionContainsPoint
// --------------------------------------------------------------------------

describe("regionContainsPoint (closed, per ring)", () => {
  const region = buildBoardRegion(board100, [circleCut("c", 2, 20, 0)], PLAIN);

  test("interior, exact corner and exact edge are all on the board", () => {
    expect(regionContainsPoint(region, p(0, 0))).toBe(true);
    expect(regionContainsPoint(region, p(50, 50))).toBe(true);
    expect(regionContainsPoint(region, p(50, 0))).toBe(true);
  });

  test("the boundary band is exactly GEOM_EPS_MM wide", () => {
    expect(regionContainsPoint(region, p(50 + 3e-7, 0))).toBe(true);
    expect(regionContainsPoint(region, p(50 + 6e-7, 0))).toBe(false);
  });

  test("a cutout's interior is off the board, its boundary is on it", () => {
    expect(regionContainsPoint(region, p(20, 0))).toBe(false);
    const onHole = region.holes[0]![0]!;
    expect(regionContainsPoint(region, onHole)).toBe(true);
  });

  test("Astra F5: a hole vertex inside a NEIGHBOURING hole is off the board", () => {
    // The first tangent-chain vertex of hole A sits at angle π/n, radius
    // sec(π/n); with hole B centred 2 mm away along that direction, the vertex
    // lies sec(π/n) − 1 inside B's TRUE circle (0.0094 mm for the 23-gon Astra
    // assumed, 0.0012 mm for the 64-gon floor now in force — both > eps).
    const n = buildBoardRegion(rect(10, 10), [circleCut("a", 1, 0, 0)], INNER)
      .holes[0]!.length;
    const ang = Math.PI / n;
    const second = p(2 * Math.cos(ang), 2 * Math.sin(ang));
    const region2 = buildBoardRegion(
      rect(10, 10),
      [circleCut("a", 1, 0, 0), circleCut("b", 1, second.x, second.y)],
      INNER,
    );
    const target = p(1, Math.tan(ang));
    let nearest = region2.holes[0]![0]!;
    for (const v of region2.holes[0]!) {
      if (
        Math.hypot(v.x - target.x, v.y - target.y) <
        Math.hypot(nearest.x - target.x, nearest.y - target.y)
      ) {
        nearest = v;
      }
    }
    expect(Math.hypot(nearest.x - target.x, nearest.y - target.y)).toBeLessThan(
      0.01,
    );
    // It sits ~0.0094 mm inside the second true hole.
    expect(Math.hypot(nearest.x - second.x, nearest.y - second.y)).toBeLessThan(
      1,
    );
    expect(regionContainsPoint(region2, nearest)).toBe(false);
  });

  test("pointInOutline agrees with the region it rebuilds", () => {
    expect(pointInOutline(board100, [circleCut("c", 2, 20, 0)], p(0, 0))).toBe(
      true,
    );
    expect(pointInOutline(board100, [circleCut("c", 2, 20, 0)], p(20, 0))).toBe(
      false,
    );
    expect(pointInOutline(board100, undefined, p(60, 0))).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 3. segmentInsideRegion
// --------------------------------------------------------------------------

describe("segmentInsideRegion", () => {
  const withHole = buildBoardRegion(board100, [circleCut("c", 2, 20, 0)], PLAIN);

  test("B4-1: a trace crossing a cutout is not inside", () => {
    expect(segmentInsideRegion(withHole, p(-40, 0), p(40, 0))).toBe(false);
  });

  test("a chord between two cutout vertices crosses the hole", () => {
    const hole = withHole.holes[0]!;
    const a = hole[0]!;
    const b = hole[Math.floor(hole.length / 2)]!;
    expect(segmentInsideRegion(withHole, a, b)).toBe(false);
  });

  test("grazing a single cutout vertex from outside stays inside", () => {
    const hole = withHole.holes[0]!;
    let rightmost = hole[0]!;
    for (const v of hole) if (v.x > rightmost.x) rightmost = v;
    expect(
      segmentInsideRegion(
        withHole,
        p(rightmost.x, rightmost.y - 5),
        p(rightmost.x, rightmost.y + 5),
      ),
    ).toBe(true);
  });

  test("a collinear run that continues past an edge into the cutout is not inside", () => {
    // Rect [10,20]x[-2,2] with a chimney [14,16]x[2,6]: the line y = 2 carries
    // two boundary edges and, between them, the chimney's interior.
    const chimney = contourCut("t", p(10, -2), [
      line(20, -2),
      line(20, 2),
      line(16, 2),
      line(16, 6),
      line(14, 6),
      line(14, 2),
      line(10, 2),
      line(10, -2),
    ]);
    const region = buildBoardRegion(board100, [chimney], PLAIN);
    expect(segmentInsideRegion(region, p(19, 2), p(17, 2))).toBe(true);
    expect(segmentInsideRegion(region, p(18, 2), p(15, 2))).toBe(false);
  });

  test("an L-shaped board rejects an arm-to-arm shortcut across the notch", () => {
    const lBoard = polygonOutline([
      p(0, 0),
      p(60, 0),
      p(60, 20),
      p(20, 20),
      p(20, 60),
      p(0, 60),
    ]);
    const region = buildBoardRegion(lBoard, [], PLAIN);
    expect(regionContainsPoint(region, p(50, 10))).toBe(true);
    expect(regionContainsPoint(region, p(10, 50))).toBe(true);
    expect(segmentInsideRegion(region, p(50, 10), p(10, 50))).toBe(false);
    // Both endpoints off the board short-circuits on the endpoint test.
    expect(segmentInsideRegion(region, p(80, 80), p(90, 90))).toBe(false);
  });

  test("an air sliver thinner than 2·eps is invisible; 1 µm is not", () => {
    // Documented limit (§5): a penetration thinner than the coordinate quantum
    // is not partitioned. A 2e-7 mm slit collapses under canonicalisation.
    const hairline = buildBoardRegion(board100, [boxCut("s", 0, -5, 2e-7, 5)], PLAIN);
    expect(segmentInsideRegion(hairline, p(-1, 0), p(1, 0))).toBe(true);
    const micron = buildBoardRegion(board100, [boxCut("s", 0, -5, 1e-3, 5)], PLAIN);
    expect(segmentInsideRegion(micron, p(-1, 0), p(1, 0))).toBe(false);
  });

  test("a zero-length segment reduces to the endpoint test", () => {
    expect(segmentInsideRegion(withHole, p(0, 0), p(0, 0))).toBe(true);
    expect(segmentInsideRegion(withHole, p(20, 0), p(20, 0))).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 4. polygonInsideRegion
// --------------------------------------------------------------------------

describe("polygonInsideRegion", () => {
  test("B4-2: a pad with a slot through it is not on the board", () => {
    const slot: PcbBoardCutout = {
      id: "slot",
      shape: {
        kind: "roundrect",
        widthMm: 8,
        heightMm: 1,
        centerMm: p(0, 0),
        cornerRadiusMm: 0.4,
      },
    };
    const region = buildBoardRegion(board100, [slot], INNER);
    expect(polygonInsideRegion(region, squareRing(1.5))).toBe(false);
  });

  test("a pad spanning a concave notch with every vertex inside is rejected", () => {
    const lBoard = polygonOutline([
      p(0, 0),
      p(60, 0),
      p(60, 20),
      p(20, 20),
      p(20, 60),
      p(0, 60),
    ]);
    const region = buildBoardRegion(lBoard, [], PLAIN);
    const ring = [p(50, 5), p(5, 50), p(5, 5)];
    for (const v of ring) expect(regionContainsPoint(region, v)).toBe(true);
    expect(polygonInsideRegion(region, ring)).toBe(false);
  });

  test("a pad wholly containing a small cutout is rejected", () => {
    const region = buildBoardRegion(board100, [circleCut("c", 1, 0, 0)], INNER);
    expect(polygonInsideRegion(region, squareRing(2.5))).toBe(false);
  });

  test("Astra F2: a pad exactly filling a square cutout is off the board", () => {
    const region = buildBoardRegion(board100, [boxCut("c", 18, -2, 22, 2)], PLAIN);
    expect(polygonInsideRegion(region, boxRing(18, -2, 22, 2))).toBe(false);
    // Abutting the cutout along one full edge is legal.
    expect(polygonInsideRegion(region, boxRing(22, -2, 26, 2))).toBe(true);
  });

  test("a strip inside a cutout with every vertex on its boundary is rejected", () => {
    const region = buildBoardRegion(board100, [boxCut("c", 18, -2, 22, 2)], PLAIN);
    const strip = boxRing(18, -1, 22, 1);
    for (const v of strip) expect(regionContainsPoint(region, v)).toBe(true);
    expect(polygonInsideRegion(region, strip)).toBe(false);
  });

  test("a ring exactly filling the board is inside; a larger one is not", () => {
    const region = buildBoardRegion(board100, [], PLAIN);
    expect(polygonInsideRegion(region, squareRing(50))).toBe(true);
    expect(polygonInsideRegion(region, squareRing(100))).toBe(false);
    // Straddling one edge by 0.25 mm.
    expect(polygonInsideRegion(region, boxRing(49.75, -1, 50.25, 1))).toBe(
      false,
    );
  });

  test("a duplicated vertex changes nothing", () => {
    const region = buildBoardRegion(board100, [circleCut("c", 1, 0, 0)], PLAIN);
    const deduped = squareRing(2.5);
    const duplicated = [deduped[0]!, deduped[0]!, ...deduped.slice(1)];
    expect(polygonInsideRegion(region, duplicated)).toBe(
      polygonInsideRegion(region, deduped),
    );
    const clean = buildBoardRegion(board100, [], PLAIN);
    const cleanRing = squareRing(5);
    expect(
      polygonInsideRegion(clean, [cleanRing[0]!, cleanRing[0]!, ...cleanRing.slice(1)]),
    ).toBe(polygonInsideRegion(clean, cleanRing));
  });
});

// --------------------------------------------------------------------------
// 5. Stadiums and discs
// --------------------------------------------------------------------------

describe("stadiumInsideRegion / discInsideRegion", () => {
  const board = buildBoardRegion(rect(50, 30), [], PLAIN);
  const withHole = buildBoardRegion(rect(50, 30), [circleCut("c", 2, 0, 0)], PLAIN);

  test("a 0.2 mm trace exactly at its own half-width from the edge is inside", () => {
    expect(
      stadiumInsideRegion(board, [p(24.9, -5), p(24.9, 5)], 0.1),
    ).toBe(true);
    expect(
      stadiumInsideRegion(board, [p(24.901, -5), p(24.901, 5)], 0.1),
    ).toBe(false);
  });

  test("a centreline closer to a cutout than its half-width is outside", () => {
    const hole = withHole.holes[0]!;
    const gap = 0.05;
    const x = pointToRingEdgeDistance(p(0, 0), hole) + gap;
    expect(stadiumInsideRegion(withHole, [p(x, -0.5), p(x, 0.5)], 0.1)).toBe(
      false,
    );
  });

  test("a zero-width centreline on the edge is inside", () => {
    expect(stadiumInsideRegion(board, [p(25, -5), p(25, 5)], 0)).toBe(true);
    expect(stadiumInsideRegion(board, [], 0.1)).toBe(true);
  });

  test("a via tangent to a cutout is inside; one centred in it is not", () => {
    const hole = withHole.holes[0]!;
    const center = p(6, 0);
    const r = pointToRingEdgeDistance(center, hole);
    expect(discInsideRegion(withHole, center, r)).toBe(true);
    expect(discInsideRegion(withHole, center, r + 0.01)).toBe(false);
    expect(discInsideRegion(withHole, p(0, 0), 0.1)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// 6. Ring relations
// --------------------------------------------------------------------------

describe("ringsIntersect / ringStrictlyInside", () => {
  const circleRing = (r: number, cx: number, cy: number) =>
    flattenOutline({
      kind: "circle",
      widthMm: r * 2,
      heightMm: r * 2,
      centerMm: p(cx, cy),
    });

  test("crossing bars with no vertex containment still intersect", () => {
    expect(
      ringsIntersect(boxRing(-10, -0.25, 10, 0.25), boxRing(-0.25, -10, 0.25, 10)),
    ).toBe(true);
  });

  test("Astra F3: rectangles sharing supporting edges intersect", () => {
    expect(ringsIntersect(boxRing(0, 0, 2, 1), boxRing(1, 0, 3, 1))).toBe(true);
    expect(ringsIntersect(boxRing(0, 0, 2, 1), boxRing(0, 0, 2, 1))).toBe(true);
    expect(ringsIntersect(boxRing(0, 0, 10, 10), boxRing(10, 0, 20, 10))).toBe(
      true,
    );
    expect(ringsIntersect(boxRing(0, 0, 2, 1), boxRing(5, 0, 7, 1))).toBe(false);
  });

  test("tangent circles are a contact", () => {
    expect(ringsIntersect(circleRing(5, -5, 0), circleRing(5, 5, 0))).toBe(true);
  });

  test("strict containment excludes any boundary contact", () => {
    expect(ringStrictlyInside(circleRing(1, 0, 0), circleRing(5, 0, 0))).toBe(
      true,
    );
    // A square whose corner touches the outer ring's boundary is not strict.
    const outer = squareRing(5);
    expect(ringStrictlyInside(boxRing(0, 0, 5, 5), outer)).toBe(false);
    expect(ringStrictlyInside(boxRing(0, 0, 4, 4), outer)).toBe(true);
  });

  test("Astra F7: only the biased rings catch a 0.005 mm circular breach", () => {
    // Chord count of an r = 1 hole under the rule in force; the breach is half
    // the inscribed sagitta 1 − cos(π/n), so the unbiased chords stop short of
    // the edge while the true circle crosses it (Astra used n = 23, 0.005 mm).
    const n = buildBoardRegion(rect(10, 10), [circleCut("a", 1, 0, 0)], PLAIN)
      .holes[0]!.length;
    const ang = Math.PI / n;
    const breach = (1 - Math.cos(ang)) / 2;
    const nx = Math.cos(ang);
    const ny = Math.sin(ang);
    // Rotated rectangular board whose near edge sits (1 − breach) from the
    // origin, so a true r = 1 cutout at the origin breaches it by `breach`.
    const cx = -(10 - (1 - breach)) * nx;
    const cy = -(10 - (1 - breach)) * ny;
    const corner = (u: number, v: number) =>
      p(cx + nx * u - ny * v, cy + ny * u + nx * v);
    const boardOutline = polygonOutline([
      corner(-10, -10),
      corner(10, -10),
      corner(10, 10),
      corner(-10, 10),
    ]);
    const cut = circleCut("c", 1, 0, 0);
    const biased = buildBoardRegion(boardOutline, [cut], INNER);
    const plain = buildBoardRegion(boardOutline, [cut], PLAIN);
    expect(ringStrictlyInside(biased.holes[0]!, biased.outer)).toBe(false);
    // The unbiased chords stop a full sagitta short and miss the breach.
    expect(ringStrictlyInside(plain.holes[0]!, plain.outer)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 7. Boundary distances and the clearance kernel
// --------------------------------------------------------------------------

describe("boundary distances match today's ring-edge kernels", () => {
  const cut = circleCut("c", 2, 20, 0);
  const region = buildBoardRegion(board100, [cut], PLAIN);
  const rings = [region.outer, ...region.holes];
  const minOver = (f: (ring: PcbPointMm[]) => number) =>
    Math.min(...rings.map(f));

  test("point", () => {
    const value = regionBoundaryDistancePoint(region, p(0, 0));
    expect(value).toBe(minOver((r) => pointToRingEdgeDistance(p(0, 0), r)));
    expect(value).toBeCloseTo(18, 12);
  });

  test("polyline", () => {
    const poly = [p(0, 0), p(0, 10)];
    const value = regionBoundaryDistancePolyline(region, poly);
    expect(value).toBe(minOver((r) => polylineToRingEdgeDistance(poly, r)));
    expect(value).toBeCloseTo(18, 12);
  });

  test("ring", () => {
    const ring = squareRing(0.5);
    const value = regionBoundaryDistanceRing(region, ring);
    expect(value).toBe(minOver((r) => ringToRingEdgeDistance(ring, r)));
    expect(value).toBeCloseTo(17.5, 12);
  });

  test("polygonToPolygonDistance is 0 for crossing rings with no vertex inside", () => {
    const a = boxRing(-5, -1, 5, 1);
    const b = boxRing(-1, -5, 1, 5);
    for (const v of a) expect(pointInPolygon(v, b)).toBe(false);
    for (const v of b) expect(pointInPolygon(v, a)).toBe(false);
    expect(polygonToPolygonDistance(a, b)).toBe(0);
  });
});

// --------------------------------------------------------------------------
// Reviewer-critical finding 3 (contract §9.1a): undefined orientation fails
// CLOSED in the hole-interior test
// --------------------------------------------------------------------------

describe("degenerate rings on a hole edge are reported off the board", () => {
  const contourCut = (id: string, pts: PcbPointMm[]): PcbBoardCutout => ({
    id,
    shape: {
      kind: "contour",
      widthMm: 0,
      heightMm: 0,
      centerMm: pts[0]!,
      start: pts[0]!,
      segments: [
        ...pts.slice(1).map((q): PcbOutlineSegment => ({ type: "line", to: q })),
        { type: "line", to: pts[0]! },
      ],
    },
  });

  test("a bow-tie ring identical to a bow-tie hole is not on the board", () => {
    const bowtie = [p(2, 2), p(6, 2), p(2, 4), p(6, 4)];
    const region = buildBoardRegion(rect(10, 10), [contourCut("bt", bowtie)], PLAIN);
    expect(ringOrientation(bowtie)).toBe(0);
    expect(polygonInsideRegion(region, bowtie)).toBe(false);
  });

  test("a sub-area ring identical to a sub-area hole is not on the board", () => {
    const tiny = [p(5, 5), p(5.0005, 5), p(5.0005, 5.001), p(5, 5.001)];
    const region = buildBoardRegion(rect(10, 10), [contourCut("t", tiny)], PLAIN);
    expect(ringOrientation(tiny)).toBe(0);
    expect(polygonInsideRegion(region, tiny)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Astra §9.2 (adversarial-verify): a sliver-thin cutout whose shallow arc
// flattens to one chord must still keep its bias — orientation comes from the
// EXACT contour, not from the flattened ring (which flips sign here).
// --------------------------------------------------------------------------

describe("shallow-arc sliver cutout keeps the safe bias", () => {
  const sagitta = 0.005;
  const half = 5;
  const r = (half * half + sagitta * sagitta) / (2 * sagitta);
  const A = p(0, 0);
  const B = p(10, 0);
  const C = p(5, 0.002);
  const crescent: PcbBoardCutout = {
    id: "crescent",
    shape: {
      kind: "contour",
      widthMm: 10,
      heightMm: sagitta,
      centerMm: p(5, 0),
      start: A,
      segments: [
        // Arc bulging UP to y = sagitta, centre far below, traversed A → B.
        { type: "arc", to: B, centerMm: p(5, sagitta - r), cw: true },
        { type: "line", to: C },
        { type: "line", to: A },
      ],
    },
  };
  const region = buildBoardRegion(rect(40, 40), [crescent], INNER);

  test("the flattened unbiased ring has the opposite orientation (the trap)", () => {
    // Unbiased: one chord A→B, then C — a triangle ABOVE the chord, CCW,
    // while the true crescent (arc above, C-line below) runs clockwise.
    expect(ringOrientation(region.unbiasedHoles[0]!)).toBe(1);
  });

  test("copper inside the true crescent is off the board", () => {
    // Between the C-line apex (0.002) and the true arc apex (0.005).
    expect(regionContainsPoint(region, p(5, 0.0035))).toBe(false);
    expect(discInsideRegion(region, p(5, 0.0035), 0.001)).toBe(false);
    // The biased hole ring encloses the true arc apex.
    expect(pointInPolygon(p(5, sagitta - 1e-9), region.holes[0]!)).toBe(true);
    expect(region.fallbacks).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Astra §9.2 run 2: outer-ring sliver (look-ahead monotone refinement) and
// arc endpoints with mismatched radii.
//
// RE-TARGETED for S12b (exact-geometry contract 12 §2.1). The annulus rule —
// sample a mismatched-radius arc on the smaller radius when inscribing and the
// larger when circumscribing, joined to the AUTHORED endpoints by radial stubs —
// is retired: a tolerance is not a curve. The canonical curve is the circle of
// the START radius with the authored `to` projected radially onto it, so the
// hole ring below loses its two radial-stub vertices and its arc ends at
// (0, 1) instead of the authored (0, 0.9991). Every verdict is unchanged; only
// the ring's bytes near that endpoint move, by the 0.0009 mm mismatch.
// --------------------------------------------------------------------------

describe("look-ahead refinement and the canonical arc curve", () => {
  test("a sliver-thin outer contour stays inside the true board", () => {
    const sagitta = 0.005;
    // 2 mm chord: r = (h² + s²) / 2s with half-chord h = 1.
    const r = (1 + sagitta * sagitta) / (2 * sagitta);
    const outline: PcbBoardOutline = {
      kind: "contour",
      widthMm: 2,
      heightMm: sagitta,
      centerMm: p(1, 0.0025),
      start: p(0, 0),
      segments: [
        { type: "arc", to: p(2, 0), centerMm: p(1, sagitta - r), cw: true },
        { type: "line", to: p(1, 0.002) },
        { type: "line", to: p(0, 0) },
      ],
    };
    const region = buildBoardRegion(outline, [], INNER);
    expect(region.fallbacks).toEqual([]);
    // Inside the true crescent (between the C-line apex and the arc apex).
    expect(regionContainsPoint(region, p(1, 0.0035))).toBe(true);
    // Below the C-line: outside the true board, where the coarse triangle was.
    expect(regionContainsPoint(region, p(1, 0.001))).toBe(false);
  });

  test("a hole arc with a shorter end radius encloses the canonical circle", () => {
    const cut: PcbBoardCutout = {
      id: "m",
      shape: {
        kind: "contour",
        widthMm: 1,
        heightMm: 1,
        centerMm: p(0.5, 0.5),
        start: p(1, 0),
        segments: [
          { type: "arc", to: p(0, 0.9991), centerMm: p(0, 0), cw: false },
          { type: "line", to: p(0, 0) },
          { type: "line", to: p(1, 0) },
        ],
      },
    };
    const region = buildBoardRegion(rect(10, 10), [cut], INNER);
    // 0.0004 mm inside the start-radius circle, next to the shorter endpoint.
    expect(regionContainsPoint(region, p(0.001, 0.9996))).toBe(false);
    expect(discInsideRegion(region, p(0.001, 0.9996), 0.0001)).toBe(false);
    // The authored endpoint is no longer a ring vertex: the arc ends on the
    // canonical circle of the START radius (1), and no radial stub survives.
    const hole = region.holes[0]!;
    expect(
      hole.some((q) => Math.abs(q.x) < 1e-15 && Math.abs(q.y - 0.9991) < 1e-15),
    ).toBe(false);
    const exact = region.exact.holes[0]!;
    if (!("prims" in exact)) throw new Error("expected exact primitives");
    const arcPrim = exact.prims.find((prim) => prim.kind === "arc");
    if (!arcPrim || arcPrim.kind !== "arc") throw new Error("expected an arc");
    expect(arcPrim.r).toBeCloseTo(1, 12);
    expect(Math.hypot(arcPrim.b.x, arcPrim.b.y)).toBeCloseTo(1, 12);
  });
});

// --------------------------------------------------------------------------
// S12b: the certified interval (exact-geometry contract 12 §4)
// --------------------------------------------------------------------------

/** Deterministic pseudo-random sampler — no `Math.random` in a DRC test. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function exactContains(region: BoardRegion, q: PcbPointMm): boolean {
  if (pointInExactRing(region.exact.outer, q) === "outside") return false;
  for (const hole of region.exact.holes) {
    if (pointInExactRing(hole, q) === "inside") return false;
  }
  return true;
}

function exactClearanceMm(region: BoardRegion, q: PcbPointMm): number {
  let best = Infinity;
  for (const ring of [region.exact.outer, ...region.exact.holes]) {
    for (const prim of ringPrims(ring)) {
      const d = pointToPrimDistance(q, prim);
      if (d < best) best = d;
    }
  }
  return best;
}

describe("R_inner ⊆ R_true ⊆ R_outer", () => {
  /** `golden-cutouts-2l`'s board: a 15 mm-cornered roundrect with 5 cutouts. */
  const cutoutsBoard: PcbBoardOutline = {
    kind: "roundrect",
    widthMm: 80,
    heightMm: 60,
    centerMm: p(0, 0),
    cornerRadiusMm: 15,
  };
  const cutoutsCuts: PcbBoardCutout[] = [
    circleCut("c1", 3, 20, 10),
    {
      id: "c2",
      shape: {
        kind: "roundrect",
        widthMm: 10,
        heightMm: 4,
        cornerRadiusMm: 2,
        centerMm: p(-20, 12),
      },
    },
    {
      id: "c3",
      shape: {
        kind: "roundrect",
        widthMm: 3,
        heightMm: 12,
        cornerRadiusMm: 1,
        centerMm: p(0, -15),
      },
    },
    circleCut("c4", 2, -24, -14),
    circleCut("c5", 2, -24, -9.5),
  ];

  /** A free-form arc board: a bulging outer contour with an arc-walled cutout. */
  const arcBoard: PcbBoardOutline = contour(p(-20, -12), [
    line(20, -12),
    arcTo(20, 12, 20, 0),
    line(-20, 12),
    line(-20, -12),
  ]);
  const arcCuts: PcbBoardCutout[] = [
    contourCut("notch", p(-6, 0), [
      arcTo(6, 0, 0, 0, true),
      line(6, -4),
      line(-6, -4),
      line(-6, 0),
    ]),
    circleCut("round", 3.5, 8, 6),
  ];

  const boards: Array<[string, PcbBoardOutline, PcbBoardCutout[], number]> = [
    ["golden-cutouts-2l", cutoutsBoard, cutoutsCuts, 45],
    ["synthetic arc rings", arcBoard, arcCuts, 24],
  ];

  for (const [name, outline, cuts, half] of boards) {
    test(`inner ⇒ exact ⇒ outer on 10⁴ points (${name})`, () => {
      const inner = buildBoardRegion(outline, cuts, INNER);
      const outer = inner.outerBias;
      const rnd = lcg(90210);
      let insideInner = 0;
      let outsideOuter = 0;
      for (let i = 0; i < 10_000; i += 1) {
        const q = p(rnd() * half * 2.4 - half * 1.2, rnd() * half * 2.4 - half * 1.2);
        // Both models are CLOSED at GEOM_EPS_MM and the chord rings sit up to
        // `maxBoundMm` off the true curve, so only the boundary band itself is
        // excluded — everything else must obey the inclusion.
        if (exactClearanceMm(inner, q) <= inner.maxBoundMm + GEOM_EPS_MM) continue;
        const lo = regionContainsPoint(inner, q);
        const mid = exactContains(inner, q);
        const hi = regionContainsPoint(outer.region, q, GEOM_EPS_MM, outer.index);
        if (lo) {
          insideInner += 1;
          expect(mid).toBe(true);
        }
        if (mid) expect(hi).toBe(true);
        if (!hi) {
          outsideOuter += 1;
          expect(mid).toBe(false);
        }
      }
      // The fixtures must actually exercise both sides.
      expect(insideInner).toBeGreaterThan(500);
      expect(outsideOuter).toBeGreaterThan(500);
    });
  }

  test("the outer-bias region is a superset of the inner one", () => {
    const inner = buildBoardRegion(cutoutsBoard, cutoutsCuts, INNER);
    // The outer outline circumscribes (wider bbox) and every hole inscribes
    // (smaller bbox) — both grow the material.
    expect(inner.outerBias.region.bounds.maxX).toBeGreaterThanOrEqual(
      inner.bounds.maxX,
    );
    for (let h = 0; h < inner.holes.length; h += 1) {
      const innerArea = Math.abs(ringSignedArea(inner.holes[h]!));
      const outerArea = Math.abs(ringSignedArea(inner.outerBias.holes[h]!));
      expect(outerArea).toBeLessThanOrEqual(innerArea + 1e-9);
    }
    // `outerBias` of the superset is itself — the mirror of the mirror is not
    // a third region.
    expect(inner.outerBias.region.outerBias.region).toBe(inner.outerBias.region);
  });

  test("boundMm is per ring and the cap residual for an r = 2000 arc", () => {
    const region = buildBoardRegion(
      { kind: "rect", widthMm: 10, heightMm: 10, centerMm: p(0, 0) },
      [circleCut("huge", 2000, 0, 0), circleCut("small", 1, 3, 3)],
      INNER,
    );
    expect(region.boundMm[0]).toBe(0); // a rect carries no arc at all
    expect(region.boundMm[1]).toBeCloseTo(
      2000 * (1 / Math.cos(Math.PI / MAX_ARC_SEGMENTS) - 1),
      12,
    );
    expect(region.boundMm[2]).toBeCloseTo(MAX_CHORD_DEVIATION_MM, 12);
    expect(region.maxBoundMm).toBe(region.boundMm[1]!);
  });

  test("the derived fields are lazy and invisible to serialisation", () => {
    const region = buildBoardRegion(board100, [circleCut("c", 5, 0, 0)], INNER);
    expect(Object.keys(region)).toEqual([
      "outer",
      "holes",
      "unbiasedOuter",
      "unbiasedHoles",
      "bounds",
      "ringBounds",
      "edges",
      "fallbacks",
    ]);
    expect(region.maxBoundMm).toBeCloseTo(MAX_CHORD_DEVIATION_MM, 12);
  });
});

// --------------------------------------------------------------------------
// S12b: rounded and exact containment (12 §1.2, §4)
// --------------------------------------------------------------------------

describe("roundedInsideRegion", () => {
  const board = buildBoardRegion(rect(10, 10, 5, 5), [], INNER);

  test("a rect core half off the board is OUTSIDE, not 'one point inside'", () => {
    const core = boxRing(9, 4, 11, 6);
    expect(regionContainsPoint(board, p(9, 4))).toBe(true);
    expect(roundedInsideRegion(board, { core, radiusMm: 0 })).toBe(false);
    expect(roundedPenetration(board, { core, radiusMm: 0 })).toBeCloseTo(1, 9);
    expect(signedMargin(board, { core, radiusMm: 0 })).toBeCloseTo(-1, 9);
  });

  test("a one-point core is a disc; a two-point core is a stadium", () => {
    expect(roundedInsideRegion(board, { core: [p(5, 5)], radiusMm: 1 })).toBe(true);
    expect(roundedInsideRegion(board, { core: [p(0.5, 5)], radiusMm: 1 })).toBe(
      false,
    );
    expect(
      roundedInsideRegion(board, { core: [p(2, 5), p(8, 5)], radiusMm: 1 }),
    ).toBe(true);
    expect(
      roundedInsideRegion(board, { core: [p(2, 5), p(8, 5)], radiusMm: 6 }),
    ).toBe(false);
  });

  test("coincident core points reduce to the lower-arity form", () => {
    // A `w === h` oval: a two-point spine whose points coincide.
    expect(
      roundedInsideRegion(board, { core: [p(5, 5), p(5, 5)], radiusMm: 4.9 }),
    ).toBe(true);
    expect(
      roundedInsideRegion(board, { core: [p(5, 5), p(5, 5)], radiusMm: 5.1 }),
    ).toBe(false);
  });

  test("the signed margin is the clearance inside and the penetration outside", () => {
    expect(
      signedMargin(board, { core: [p(5, 5)], radiusMm: 1 }, undefined, 10),
    ).toBeCloseTo(4, 9);
    expect(signedMargin(board, { core: [p(-2, 5)], radiusMm: 1 })).toBeCloseTo(
      -3,
      9,
    );
  });
});

describe("exactInsideRegion", () => {
  /**
   * Astra run 1 #3: a board `[−2, 2] × [−2, 0]` with a semicircular notch of
   * r = 1.3 about the origin opening downward from the top edge. Every vertex
   * of the strip `[−0.15, 0.15] × [−1.31, −1.296]` sits in material, but its
   * TOP EDGE passes through the notch — the recipe "vertices inside plus an
   * unsigned distance" accepts it, and the edge-splitting recipe must not.
   */
  const notched = contour(p(-2, 0), [
    line(-2, -2),
    line(2, -2),
    line(2, 0),
    line(1.3, 0),
    arcTo(-1.3, 0, 0, 0, true),
    line(-2, 0),
  ]);
  const region = buildBoardRegion(notched, [], INNER);
  const strip = boxRing(-0.15, -1.31, 0.15, -1.296);

  test("every vertex of the Astra #3 strip is in material", () => {
    for (const v of strip) {
      expect(pointInExactRing(region.exact.outer, v)).toBe("inside");
    }
  });

  test("but the strip is NOT exact-inside — its top edge crosses the notch", () => {
    expect(exactInsideRegion(region.exact, { core: strip, radiusMm: 0 })).toBe(
      false,
    );
  });

  test("a failed containment never reports a non-negative margin (R1)", () => {
    // No core VERTEX is outside, so the raw penetration is 0; a margin of 0
    // would read as a PASS through the certified interval.
    const margin = exactSignedMargin(region.exact, { core: strip, radiusMm: 0 }, 1);
    expect(margin.inside).toBe(false);
    expect(margin.marginMm).toBeLessThanOrEqual(-GEOM_EPS_MM);
    // The chord siblings carry the same clamp, so the interval still brackets.
    const lo = signedMargin(region, { core: strip, radiusMm: 0 }, undefined, 1);
    const hi = signedMargin(
      region.outerBias.region,
      { core: strip, radiusMm: 0 },
      region.outerBias.index,
      1,
    );
    expect(lo).toBeLessThanOrEqual(-GEOM_EPS_MM);
    expect(lo).toBeLessThanOrEqual(margin.marginMm);
    expect(margin.marginMm).toBeLessThanOrEqual(hi);
  });

  test("dropping the strip clear of the notch makes it exact-inside", () => {
    const clear = boxRing(-0.15, -1.4, 0.15, -1.35);
    expect(exactInsideRegion(region.exact, { core: clear, radiusMm: 0 })).toBe(
      true,
    );
    const margin = exactSignedMargin(
      region.exact,
      { core: clear, radiusMm: 0 },
      1,
    );
    expect(margin.inside).toBe(true);
    expect(margin.certain).toBe(true);
    // The nearest boundary is the notch arc, 1.3 − hypot(0.15, 1.35) away.
    expect(margin.marginMm).toBeCloseTo(1.35 - 1.3, 9);
  });

  test("a radius that reaches the notch fails even with the core clear", () => {
    const clear = boxRing(-0.15, -1.4, 0.15, -1.35);
    expect(
      exactInsideRegion(region.exact, { core: clear, radiusMm: 0.2 }),
    ).toBe(false);
  });

  test("an exhausted budget throws rather than passing silently", () => {
    expect(() =>
      exactInsideRegion(
        region.exact,
        { core: strip, radiusMm: 0 },
        { budget: { comparisons: 1 } },
      ),
    ).toThrow(ExactBudgetExceeded);
  });

  test("an ellipse cutout is never certified exact", () => {
    const withEllipse = buildBoardRegion(rect(40, 40), [
      {
        id: "oval",
        shape: {
          kind: "circle",
          widthMm: 8,
          heightMm: 4,
          centerMm: p(0, 0),
        },
      },
    ], INNER);
    const margin = exactSignedMargin(
      withEllipse.exact,
      { core: [p(0, 15)], radiusMm: 0.5 },
      100,
    );
    expect(margin.certain).toBe(false);
    // ... and a ring far enough away that the ellipse is not consulted is.
    expect(
      exactSignedMargin(
        withEllipse.exact,
        { core: [p(0, 15)], radiusMm: 0.5 },
        0.1,
      ).certain,
    ).toBe(true);
  });
});

describe("the canonical closing segment is ordinary boundary geometry", () => {
  // Astra #9 at board scale: the CW semicircle's authored end misses `start`
  // by 0.005 mm, so the canonical ring closes with an explicit 0.005 mm line.
  const board = contour(p(10, 0), [
    line(0, 0),
    line(-10.005, 0),
    arcTo(10, 0, 0, 0, true),
  ]);
  const region = buildBoardRegion(board, [], INNER);

  test("the exact ring carries the closing segment", () => {
    const exact = region.exact.outer;
    if (!("prims" in exact)) throw new Error("expected exact primitives");
    expect(exact.prims).toHaveLength(4);
    const closing = exact.prims[3]!;
    expect(closing.kind).toBe("seg");
    expect(Math.hypot(closing.b.x - closing.a.x, closing.b.y - closing.a.y)).toBeCloseTo(
      0.005,
      12,
    );
    expect(closing.b).toEqual(p(10, 0));
  });

  test("it separates material from air like any other edge", () => {
    // The CW sweep from angle π to 0 runs over the TOP, so the board is the
    // upper half-disc; the closing segment is the only piece of the bottom edge
    // between x = 10 and x = 10.005, and without it the ring would leak there.
    expect(pointInExactRing(region.exact.outer, p(10.002, 0.001))).toBe("inside");
    expect(pointInExactRing(region.exact.outer, p(10.002, -0.001))).toBe("outside");
    // A shape straddling the closing edge is not inside the board.
    expect(
      exactInsideRegion(region.exact, {
        core: [p(10.002, 0.001), p(10.002, -0.001)],
        radiusMm: 0,
      }),
    ).toBe(false);
  });
});
