/**
 * S9 WP2 — the two indexes (broad-phase contract 08 §2).
 *
 * Four properties, each the one the rest of the session leans on:
 *   · the grid is a superset of every item whose COPPER is within the halo
 *     (§2.1, §1 L1) — asserted against the same kernel the pair bodies use,
 *     not against AABBs, because v2 files a trace per sub-segment;
 *   · the region index reproduces the unindexed predicates EXACTLY (§2.2,
 *     §1 L2/L3), including the PIP operand orientation of Astra A1 #3;
 *   · every halo of §5 really is an upper bound of what the checks compare
 *     against, over the golden corpus and synthetic boards;
 *   · `stats` is results-neutral (§7).
 *
 * The caps (§2.1) are exercised on BOTH sides: an item just under and just
 * over the cell cap, a subject just under and just over the sub-segment cap.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import {
  createBroadPhase,
  type BroadPhaseKind,
} from "../../../shared/drc/broad-phase";
import {
  aabbGap,
  buildDrcContext,
  buildDrcItems,
  holeBounds,
  type DrcTrace,
} from "../../../shared/drc/drc-context";
import { runDrc } from "../../../shared/drc/drc-engine";
import { traceTraceGap } from "../../../shared/drc/pair-gap";
import { createDrcRunStats } from "../../../shared/drc/types";
import { ipc2221SpacingMm } from "../../../shared/drc/ipc2221-spacing";
import {
  buildBoardRegion,
  discInsideRegion,
  polygonInsideRegion,
  regionBoundaryDistancePoint,
  regionBoundaryDistancePolyline,
  regionBoundaryDistanceRing,
  regionContainsPoint,
  segmentInsideRegion,
  stadiumInsideRegion,
  type BoardRegion,
} from "../../../shared/pcb-geometry/board-region";
import {
  pointInPolygon,
  pointInPolygonEdges,
} from "../../../shared/pcb-geometry/pcb-clearance-geometry";
import { buildRegionIndex } from "../../../shared/pcb-geometry/region-index";
import type { RingBounds } from "../../../shared/pcb-geometry/region-rings";
import { GEOM_EPS_MM } from "../../../shared/pcb-geometry/tolerance";
import type {
  DesignerPcbProjection,
  DrcPairKind,
  DrcViolation,
  PcbBoardCutout,
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbNetClass,
  PcbPointMm,
} from "../../../sdks/designer";
import {
  checkPendingCopper,
  type PendingCopper,
} from "../../../shared/drc/legality";
import { fixtureToProjection } from "./helpers/drc-golden";
import {
  board,
  boardWithRules,
  freeHole,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

/** Deterministic LCG — a fixture, not a random test. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const CELL_MM = 2;

/** Every pair kind a clearance can resolve for — the halos must bound them all. */
const PAIR_KINDS: DrcPairKind[] = [
  "traceToTrace",
  "traceToPad",
  "traceToVia",
  "padToPad",
  "padToVia",
  "viaToVia",
  "pourToTrace",
  "pourToPad",
  "pourToVia",
  "pourToPour",
];

// --- grid v2 ----------------------------------------------------------------

/** A `DrcTrace` from a polyline — only the fields the grid and the kernel read. */
function synthTrace(
  id: string,
  pointsMm: PcbPointMm[],
  halfWidthMm: number,
): DrcTrace {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pointsMm) {
    minX = Math.min(minX, p.x - halfWidthMm);
    minY = Math.min(minY, p.y - halfWidthMm);
    maxX = Math.max(maxX, p.x + halfWidthMm);
    maxY = Math.max(maxY, p.y + halfWidthMm);
  }
  return {
    id,
    netId: null,
    layer: "F.Cu",
    widthMm: halfWidthMm * 2,
    halfWidthMm,
    pointsMm,
    bounds: { minX, minY, maxX, maxY },
    mid: pointsMm[0] ?? { x: 0, y: 0 },
  };
}

function boxAt(x: number, y: number, r: number): RingBounds {
  return { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r };
}

/**
 * 400 traces of five deliberately awkward shapes: 45° runs (the case v2 is
 * built for), long diagonals past the cell cap, coordinates on exact `CELL_MM`
 * multiples (a cell boundary is where a `Math.floor` can round the wrong way),
 * one-point discs (Astra A1 #1) and zero-length segments.
 */
function seedTraces(seed: number): DrcTrace[] {
  const rnd = lcg(seed);
  const out: DrcTrace[] = [];
  for (let i = 0; i < 400; i += 1) {
    const x = rnd() * 90 - 45;
    const y = rnd() * 60 - 30;
    const r = 0.05 + rnd() * 0.25;
    if (i % 37 === 0) {
      // Past the cell cap: an `oversized` entry, returned by every query.
      out.push(synthTrace(`t${i}`, [{ x, y }, { x: x + 600, y: y + 600 }], r));
    } else if (i % 13 === 0) {
      out.push(synthTrace(`t${i}`, [{ x, y }], r)); // a disc of copper
    } else if (i % 11 === 0) {
      out.push(synthTrace(`t${i}`, [{ x, y }, { x, y }], r)); // zero length
    } else if (i % 5 === 0) {
      const cx = Math.round(x / CELL_MM) * CELL_MM;
      const cy = Math.round(y / CELL_MM) * CELL_MM;
      const n = 1 + Math.floor(rnd() * 4);
      out.push(
        synthTrace(
          `t${i}`,
          [
            { x: cx, y: cy },
            { x: cx + n * CELL_MM, y: cy },
            { x: cx + n * CELL_MM, y: cy + n * CELL_MM },
          ],
          r,
        ),
      );
    } else {
      const d = 1 + rnd() * 30;
      out.push(
        synthTrace(
          `t${i}`,
          [
            { x, y },
            { x: x + d, y: y + d },
            { x: x + d + d / 2, y: y + d },
          ],
          r,
        ),
      );
    }
  }
  return out;
}

describe("grid v2 is a superset of every item whose copper is within the halo", () => {
  const HALO = 0.5;

  for (const seed of [20260901, 20260902, 20260903]) {
    test(`seed ${seed}: nearPolyline covers every trace within the halo`, () => {
      const traces = seedTraces(seed);
      const rnd = lcg(seed ^ 0x5f5f);
      const pads = Array.from({ length: 200 }, () =>
        boxAt(rnd() * 90 - 45, rnd() * 60 - 30, 0.3 + rnd() * 0.4),
      );
      const vias = Array.from({ length: 200 }, () =>
        boxAt(rnd() * 90 - 45, rnd() * 60 - 30, 0.3),
      );
      const bp = createBroadPhase({ traces, pads, vias, holes: [] });

      for (let i = 0; i < traces.length; i += 1) {
        const a = traces[i]!;
        const found = new Set(
          bp.nearPolyline("traces", a.pointsMm, a.halfWidthMm, HALO),
        );
        for (let j = 0; j < traces.length; j += 1) {
          // `traceTraceGap` is the kernel the pair bodies use; it reports
          // `Infinity` for a polyline with fewer than two points, which the
          // clearance loops skip anyway.
          if (traceTraceGap(a, traces[j]!).gap > HALO) continue;
          expect(found.has(j)).toBe(true);
        }
        // Pads / vias are box entries, so the AABB superset still holds there.
        const padHits = new Set(bp.near("pads", a.bounds, HALO));
        for (let j = 0; j < pads.length; j += 1) {
          if (aabbGap(a.bounds, pads[j]!) > HALO) continue;
          expect(padHits.has(j)).toBe(true);
        }
        const viaHits = new Set(bp.near("vias", a.bounds, HALO));
        for (let j = 0; j < vias.length; j += 1) {
          if (aabbGap(a.bounds, vias[j]!) > HALO) continue;
          expect(viaHits.has(j)).toBe(true);
        }
      }
    });

    test(`seed ${seed}: results are ascending, unique and box-query safe`, () => {
      const traces = seedTraces(seed);
      const bp = createBroadPhase({
        traces,
        pads: [],
        vias: [],
        holes: [],
      });
      for (let i = 0; i < traces.length; i += 5) {
        const a = traces[i]!;
        for (const hits of [
          bp.near("traces", a.bounds, HALO),
          bp.nearPolyline("traces", a.pointsMm, a.halfWidthMm, HALO),
        ]) {
          expect(hits).toEqual([...new Set(hits)].sort((x, y) => x - y));
          // A box query is still an AABB superset for traces filed per piece?
          // No — but it must never MISS an item whose copper meets the box.
          expect(hits.includes(i)).toBe(true);
        }
      }
    });
  }

  test("a one-point trace is a disc of copper, not an unindexed hole (A1 #1)", () => {
    const disc = synthTrace("disc", [{ x: 10, y: 10 }], 0.4);
    const bp = createBroadPhase({
      traces: [disc],
      pads: [],
      vias: [],
      holes: [],
    });
    // Within the disc's own copper radius…
    expect(bp.near("traces", boxAt(10.3, 10, 0.05), 0)).toEqual([0]);
    expect(bp.nearPolyline("traces", [{ x: 10.3, y: 10 }], 0.05, 0)).toEqual([
      0,
    ]);
    // …and clear of it.
    expect(bp.near("traces", boxAt(14, 10, 0.05), 0)).toEqual([]);
  });

  test("an empty polyline files nothing and matches nothing", () => {
    const bp = createBroadPhase({
      traces: [synthTrace("empty", [], 0.3), synthTrace("t", [{ x: 0, y: 0 }], 0.3)],
      pads: [],
      vias: [],
      holes: [],
    });
    expect(bp.near("traces", boxAt(0, 0, 5), 0)).toEqual([1]);
    expect(bp.nearPolyline("traces", [], 0.3, 100)).toEqual([]);
  });

  describe("the caps, from both sides", () => {
    const far = boxAt(1e5, 1e5, 1);
    const oversized = (t: DrcTrace): boolean =>
      createBroadPhase({ traces: [t], pads: [], vias: [], holes: [] })
        .near("traces", far, 0)
        .length > 0;

    test("the cell cap: ~1 000 distinct cells is indexed, ~1 050 is not", () => {
      // `fileItem` now counts DISTINCT cells across all of an item's pieces
      // (a `Set` of cell keys, capped at `MAX_CELLS_PER_ITEM = 1024`) — not a
      // per-piece SUM (WP4 R2 correction; the old sum over-counted every
      // shared cell between adjacent 2mm pieces, so a plain 350mm straight
      // trace was wrongly `oversized`). A zero-width run at y = 0.5 (row 0
      // throughout: floor(0.5/2) = 0) starting at x = 0.5 spans
      // `floor(x1/2) - floor(0.5/2) + 1 = floor(x1/2) + 1` distinct x-cells:
      // x1 = 2000.5 -> floor(1000.25)+1 = 1001 cells (indexed);
      // x1 = 2100.5 -> floor(1050.25)+1 = 1051 cells (> 1024, oversized).
      expect(
        oversized(synthTrace("under", [{ x: 0.5, y: 0.5 }, { x: 2000.5, y: 0.5 }], 0)),
      ).toBe(false);
      expect(
        oversized(synthTrace("over", [{ x: 0.5, y: 0.5 }, { x: 2100.5, y: 0.5 }], 0)),
      ).toBe(true);
    });

    test("the cell cap on a diagonal: 600 mm is indexed, 750 mm is not", () => {
      // A 45° run touches roughly 1.5-2 distinct cells per 2mm of length (it
      // crosses both a column and a row boundary about every other cell), so
      // the distinct-cell cap binds at a shorter diagonal length than the
      // axis-aligned case above; the exact boundary (verified empirically
      // against the real `near()` behaviour) is ~684mm, so 600mm sits
      // comfortably under it and 750mm comfortably over.
      expect(
        oversized(synthTrace("d600", [{ x: 0, y: 0 }, { x: 600, y: 600 }], 0)),
      ).toBe(false);
      expect(
        oversized(synthTrace("d750", [{ x: 0, y: 0 }, { x: 750, y: 750 }], 0)),
      ).toBe(true);
    });

    test("a non-finite coordinate and x = 2^54 are oversized, and the build ends", () => {
      expect(oversized(synthTrace("nan", [{ x: NaN, y: 0 }, { x: 1, y: 1 }], 0))).toBe(
        true,
      );
      // 2^54 mm / 2 mm = 2^53, which is NOT a safe integer: the cell loop's
      // unit increment would no longer advance (Astra A1 #4).
      expect(
        oversized(
          synthTrace("huge", [{ x: 2 ** 54, y: 0 }, { x: 2 ** 54 + 1, y: 0 }], 0),
        ),
      ).toBe(true);
    });

    test("the sub-segment cap on the QUERY side: 4 000 points index, 5 000 do not", () => {
      const others = [
        synthTrace("near", [{ x: 0, y: 0 }, { x: 1, y: 0 }], 0.1),
        synthTrace("far", [{ x: 900, y: 900 }, { x: 901, y: 900 }], 0.1),
      ];
      const bp = createBroadPhase({
        traces: others,
        pads: [],
        vias: [],
        holes: [],
      });
      const serpentine = (n: number): PcbPointMm[] =>
        Array.from({ length: n }, (_, i) => ({ x: (i % 2) * 1.5, y: i * 0.4 }));
      expect(bp.nearPolyline("traces", serpentine(4000), 0, 0)).toEqual([0]);
      // Past MAX_SUBSEGMENTS_PER_ITEM the subject cannot be cut, so the query
      // fails OPEN — every index, unfiltered.
      expect(bp.nearPolyline("traces", serpentine(5000), 0, 0)).toEqual([0, 1]);
    });

    test("an oversized item is returned by every query, unfiltered", () => {
      const bp = createBroadPhase({
        traces: [
          synthTrace("ok", [{ x: 0, y: 0 }, { x: 1, y: 0 }], 0.1),
          synthTrace("nan", [{ x: NaN, y: NaN }, { x: 1, y: 1 }], 0.1),
          // Distinct-cell counting (see the two tests above): a 0.1mm-radius
          // 45° diagonal needs to run past ~750mm before it crosses the
          // 1024-distinct-cell cap (600mm, formerly used here, no longer
          // does) — verified empirically.
          synthTrace("long", [{ x: 0, y: 0 }, { x: 1200, y: 1200 }], 0.1),
        ],
        pads: [],
        vias: [],
        holes: [],
      });
      for (const q of [boxAt(0, 0, 0.1), boxAt(5000, 5000, 0.1)]) {
        const hits = bp.near("traces", q, 0);
        expect(hits).toContain(1);
        expect(hits).toContain(2);
      }
      const hits = bp.nearPolyline("traces", [{ x: 5000, y: 5000 }], 0, 0);
      expect(hits).toEqual([1, 2]);
    });
  });

  test("the context exposes both query forms over the same items", () => {
    const p = projection({
      board: board(),
      traces: [
        trace("t0", "a", [[0, 0], [10, 10]]),
        trace("t1", "b", [[0, 20], [10, 30]]),
      ],
      vias: [via("v0", { netId: "a", center: { x: 5, y: 5 } })],
      freeHoles: [freeHole("h0", { x: 5, y: 5 }, 0.6)],
    });
    const ctx = buildDrcItems(p);
    const t = ctx.traces[0]!;
    expect(
      ctx.nearPolyline("traces", t.pointsMm, t.halfWidthMm, ctx.maxClearanceBoundMm),
    ).toEqual([0]);
    expect(ctx.near("vias", t.bounds, ctx.maxClearanceBoundMm)).toEqual([0]);
    // Both the via barrel and the free hole are drills, and they are 0 mm
    // apart — the hole grid returns both from either box.
    expect(ctx.holes).toHaveLength(2);
    expect(
      ctx.near("holes", holeBounds(ctx.holes[0]!), ctx.maxHoleBoundMm),
    ).toEqual([0, 1]);
    expect(ctx.broadPhase).toBe("grid");
    expect(buildDrcItems(p, { broadPhase: "exhaustive" }).broadPhase).toBe(
      "exhaustive",
    );
  });
});

// --- the region edge index ---------------------------------------------------

const OUTLINES: Array<{
  name: string;
  outline: PcbBoardOutline;
  cutouts: PcbBoardCutout[];
}> = [
  {
    name: "roundrect + circle cutouts",
    outline: {
      kind: "roundrect",
      widthMm: 80,
      heightMm: 56,
      centerMm: { x: 40, y: 28 },
      cornerRadiusMm: 6,
    },
    cutouts: [
      {
        id: "c0",
        shape: {
          kind: "circle",
          widthMm: 10,
          heightMm: 10,
          centerMm: { x: 20, y: 20 },
        },
      },
      {
        id: "c1",
        shape: {
          kind: "circle",
          widthMm: 6,
          heightMm: 6,
          centerMm: { x: 58, y: 34 },
        },
      },
      {
        id: "c2",
        shape: {
          kind: "roundrect",
          widthMm: 12,
          heightMm: 8,
          centerMm: { x: 40, y: 44 },
          cornerRadiusMm: 2,
        },
      },
    ],
  },
  {
    name: "contour with arcs + a circle cutout",
    outline: {
      kind: "contour",
      widthMm: 70,
      heightMm: 50,
      centerMm: { x: 35, y: 25 },
      start: { x: 0, y: 0 },
      segments: [
        { type: "line", to: { x: 50, y: 0 } },
        { type: "arc", to: { x: 70, y: 20 }, centerMm: { x: 50, y: 20 }, cw: false },
        { type: "line", to: { x: 70, y: 40 } },
        { type: "arc", to: { x: 50, y: 50 }, centerMm: { x: 50, y: 40 }, cw: false },
        { type: "line", to: { x: 0, y: 50 } },
        { type: "line", to: { x: 0, y: 0 } },
      ],
    },
    cutouts: [
      {
        id: "c0",
        shape: {
          kind: "circle",
          widthMm: 14,
          heightMm: 14,
          centerMm: { x: 30, y: 26 },
        },
      },
    ],
  },
];

function regionsUnderTest(): Array<{ name: string; region: BoardRegion }> {
  return OUTLINES.map(({ name, outline, cutouts }) => ({
    name,
    region: buildBoardRegion(outline, cutouts, { bias: "board-inner" }),
  }));
}

/** Points that sit exactly where a float or a band boundary can flip a test. */
function adversarialPoints(region: BoardRegion): PcbPointMm[] {
  const out: PcbPointMm[] = [];
  for (const e of region.edges) {
    out.push({ ...e.a }); // a vertex
    out.push({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }); // on the edge
    // Just off the edge, inside the eps band the closed rules spend.
    out.push({ x: e.a.x + GEOM_EPS_MM / 2, y: e.a.y - GEOM_EPS_MM / 2 });
    // Snapped onto a row-band boundary, where `Math.floor(y / CELL_MM)` steps.
    out.push({ x: e.a.x, y: Math.round(e.a.y / CELL_MM) * CELL_MM });
  }
  // Inside a cutout, within eps of the OUTER ring's y — the "0.0094 mm" case
  // the per-ring rule exists for.
  for (let h = 0; h < region.holes.length; h += 1) {
    const hb = region.ringBounds[h + 1]!;
    out.push({ x: (hb.minX + hb.maxX) / 2, y: (hb.minY + hb.maxY) / 2 });
    out.push({ x: hb.minX + GEOM_EPS_MM / 2, y: (hb.minY + hb.maxY) / 2 });
  }
  return out;
}

describe("the region edge index answers exactly what the full scan does", () => {
  test("PIP operand orientation: the constructed near-edge case (Astra A1 #3)", () => {
    // The ring loop evaluates the edge (C, A) as (a, b) = (A, C); reading
    // `region.edges` forward would evaluate it as (C, A) and land on
    // -225.49999904632568 instead of -225.5, flipping the parity.
    const A = { x: -8e9, y: -8e9 };
    const B = { x: 8e9, y: 8000000051 };
    const C = { x: 8e9, y: -8e9 };
    const p = { x: -225.5, y: -200 };
    const edges = [
      { a: A, b: B },
      { a: B, b: C },
      { a: C, b: A },
    ];
    const forward = (): boolean => {
      let inside = false;
      for (const e of edges) {
        const a = e.a;
        const b = e.b;
        if (
          a.y > p.y !== b.y > p.y &&
          p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
        ) {
          inside = !inside;
        }
      }
      return inside;
    };
    expect(pointInPolygon(p, [A, B, C])).toBe(true);
    expect(pointInPolygonEdges(p, edges)).toBe(true);
    // Not vacuous: the forward operand order really does disagree here.
    expect(forward()).toBe(false);
  });

  for (const { name, region } of regionsUnderTest()) {
    const index = buildRegionIndex(region);

    test(`${name}: regionContainsPoint over 1e5 points + the boundary cases`, () => {
      const rnd = lcg(0x9e3779b9);
      const b = region.bounds;
      const pts: PcbPointMm[] = adversarialPoints(region);
      const random = 100_000 - pts.length;
      for (let i = 0; i < random; i += 1) {
        pts.push({
          x: b.minX - 2 + rnd() * (b.maxX - b.minX + 4),
          y: b.minY - 2 + rnd() * (b.maxY - b.minY + 4),
        });
      }
      let mismatches = 0;
      for (const p of pts) {
        if (
          regionContainsPoint(region, p, GEOM_EPS_MM, index) !==
          regionContainsPoint(region, p)
        ) {
          mismatches += 1;
        }
      }
      expect(mismatches).toBe(0);
      // Not vacuous: the sample straddles the boundary.
      const inside = pts.filter((p) => regionContainsPoint(region, p)).length;
      expect(inside).toBeGreaterThan(1000);
      expect(inside).toBeLessThan(pts.length - 1000);
    }, 120_000);

    test(`${name}: the three distance functions, haloed and unhaloed`, () => {
      const rnd = lcg(0x85ebca6b);
      const b = region.bounds;
      const pt = (): PcbPointMm => ({
        x: b.minX - 2 + rnd() * (b.maxX - b.minX + 4),
        y: b.minY - 2 + rnd() * (b.maxY - b.minY + 4),
      });
      const HALO = 1.5;
      let haloedHits = 0;
      for (let i = 0; i < 10_000; i += 1) {
        const a = pt();
        const c = { x: a.x + rnd() * 8 - 4, y: a.y + rnd() * 8 - 4 };
        const d = { x: a.x + rnd() * 8 - 4, y: a.y + rnd() * 8 - 4 };
        const ring = [a, c, d];

        const exactPoint = regionBoundaryDistancePoint(region, a);
        const exactPoly = regionBoundaryDistancePolyline(region, [a, c, d]);
        const exactRing = regionBoundaryDistanceRing(region, ring);
        expect(regionBoundaryDistancePoint(region, a, index)).toBe(exactPoint);
        expect(regionBoundaryDistancePolyline(region, [a, c, d], index)).toBe(
          exactPoly,
        );
        expect(regionBoundaryDistanceRing(region, ring, index)).toBe(exactRing);

        // §1 L2, stated exactly: the halo restricts the min to a SUPERSET of
        // the edges within it, so the value is the exact one whenever the
        // exact one is at or below the halo, and otherwise some value still
        // above the halo (often `Infinity`, but a superset may keep a farther
        // edge) — a difference no comparison at or below the halo can see.
        for (const [exact, haloed] of [
          [exactPoint, regionBoundaryDistancePoint(region, a, index, HALO)],
          [
            exactPoly,
            regionBoundaryDistancePolyline(region, [a, c, d], index, HALO),
          ],
          [exactRing, regionBoundaryDistanceRing(region, ring, index, HALO)],
        ] as const) {
          expect(haloed).toBeGreaterThanOrEqual(exact);
          if (exact <= HALO) {
            expect(haloed).toBe(exact);
            haloedHits += 1;
          } else {
            expect(haloed).toBeGreaterThan(HALO);
          }
        }
      }
      expect(haloedHits).toBeGreaterThan(100);
    }, 120_000);

    test(`${name}: the containment predicates, indexed === unindexed`, () => {
      const rnd = lcg(0xc2b2ae35);
      const b = region.bounds;
      const pt = (): PcbPointMm => ({
        x: b.minX - 2 + rnd() * (b.maxX - b.minX + 4),
        y: b.minY - 2 + rnd() * (b.maxY - b.minY + 4),
      });
      let trueCount = 0;
      for (let i = 0; i < 10_000; i += 1) {
        const a = pt();
        const c = { x: a.x + rnd() * 10 - 5, y: a.y + rnd() * 10 - 5 };
        const d = { x: a.x + rnd() * 10 - 5, y: a.y + rnd() * 10 - 5 };
        const ring = [a, c, d];
        const r = 0.05 + rnd() * 0.6;

        const seg = segmentInsideRegion(region, a, c);
        expect(segmentInsideRegion(region, a, c, GEOM_EPS_MM, index)).toBe(seg);
        const poly = polygonInsideRegion(region, ring);
        expect(polygonInsideRegion(region, ring, GEOM_EPS_MM, index)).toBe(poly);
        const stad = stadiumInsideRegion(region, [a, c, d], r);
        expect(
          stadiumInsideRegion(region, [a, c, d], r, GEOM_EPS_MM, index),
        ).toBe(stad);
        const one = stadiumInsideRegion(region, [a], r);
        expect(stadiumInsideRegion(region, [a], r, GEOM_EPS_MM, index)).toBe(one);
        const disc = discInsideRegion(region, a, r);
        expect(discInsideRegion(region, a, r, GEOM_EPS_MM, index)).toBe(disc);
        if (seg) trueCount += 1;
      }
      // Not vacuous: the sample contains both verdicts.
      expect(trueCount).toBeGreaterThan(100);
      expect(trueCount).toBeLessThan(9_900);
    }, 180_000);
  }

  test("edgesStraddling is the closed y-band of one ring, with no grace", () => {
    const region = regionsUnderTest()[0]!.region;
    const index = buildRegionIndex(region);
    const rnd = lcg(0x27d4eb2f);
    for (let i = 0; i < 2_000; i += 1) {
      const y = region.bounds.minY - 1 + rnd() * (region.bounds.maxY - region.bounds.minY + 2);
      for (let ring = 0; ring < region.ringBounds.length; ring += 1) {
        const got = new Set(index.edgesStraddling(y, ring));
        for (let e = 0; e < region.edges.length; e += 1) {
          const edge = region.edges[e]!;
          if (edge.ring !== ring) {
            expect(got.has(e)).toBe(false);
            continue;
          }
          // Every edge whose crossing test could fire must be in the band.
          if (edge.a.y > y !== edge.b.y > y) expect(got.has(e)).toBe(true);
        }
      }
    }
  }, 60_000);

  test("an unindexable edge is returned by every query of its ring", () => {
    // A 10^9 mm edge spans 5 × 10^8 rows; filing it would be the DoS Astra
    // A1 #7 describes, so it goes to `oversized` and every query gets it.
    const region = buildBoardRegion(
      {
        kind: "contour",
        widthMm: 2e9,
        heightMm: 2e9,
        centerMm: { x: 0, y: 0 },
        start: { x: -1e9, y: -1e9 },
        segments: [
          { type: "line", to: { x: 1e9, y: -1e9 } },
          { type: "line", to: { x: 1e9, y: 1e9 } },
          { type: "line", to: { x: -1e9, y: -1e9 } },
        ],
      },
      [],
      { bias: "board-inner" },
    );
    const index = buildRegionIndex(region);
    expect(region.edges.length).toBeGreaterThan(0);
    const all = region.edges.map((_, i) => i);
    expect(index.edgesNear({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0, 0)).toEqual(
      all,
    );
    expect(index.edgesStraddling(0, 0)).toEqual(all);
    // …and a non-finite y still answers, rather than silently returning none.
    expect(index.edgesStraddling(NaN, 0)).toEqual(all);
  });
});

// --- the halos of §5 ---------------------------------------------------------

const GOLDEN_DIR = path.resolve(import.meta.dir, "fixtures/drc/golden");

function goldenProjections(): Array<{ name: string; p: DesignerPcbProjection }> {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
    .sort()
    .map((f) => ({
      name: f.replace(/\.json$/, ""),
      p: fixtureToProjection(
        JSON.parse(readFileSync(path.join(GOLDEN_DIR, f), "utf8")),
      ),
    }));
}

const HV_CLASSES: PcbNetClass[] = [
  { id: "default", name: "Default", clearanceMm: 0.2, traceWidthMm: 0.25, viaDiameterMm: 0.6, viaDrillMm: 0.3, voltageV: 0, color: "#888888", defaultViaProtection: "none" },
  { id: "mains", name: "Mains", clearanceMm: 0.4, traceWidthMm: 0.5, viaDiameterMm: 0.8, viaDrillMm: 0.4, voltageV: 400, color: "#cc3333", defaultViaProtection: "none" },
  { id: "neg", name: "Neg", clearanceMm: 0.3, traceWidthMm: 0.3, viaDiameterMm: 0.6, viaDrillMm: 0.3, voltageV: -120, color: "#3333cc", defaultViaProtection: "none" },
];

/** Synthetic boards that reach the rule kinds the goldens do not. */
function syntheticProjections(): Array<{ name: string; p: DesignerPcbProjection }> {
  const hv = boardWithRules({
    netClasses: HV_CLASSES,
    perNetClassAssignments: { a: "mains", b: "neg" },
    clearance: { copperToBoardEdgeMm: 0.4, holeToBoardEdgeMm: 0.35 },
    drcRules: [
      {
        id: "r-edge",
        name: "tight edge",
        enabled: true,
        priority: 0,
        constraint: { kind: "edgeClearance", minMm: 1.75 },
        scopes: [],
      },
      {
        id: "r-edge-off",
        name: "disabled edge",
        enabled: false,
        priority: 0,
        constraint: { kind: "edgeClearance", minMm: 3.5 },
        scopes: [],
      },
      {
        id: "r-hole",
        name: "wide drills",
        enabled: true,
        priority: 0,
        constraint: { kind: "holeToHole", minMm: 1.1 },
        scopes: [],
      },
    ],
  });
  return [
    {
      name: "hv + edge/hole rules",
      p: projection({
        board: hv,
        netNames: { a: "A", b: "B", c: "C" },
        traces: [
          trace("t0", "a", [[2, 2], [20, 2]]),
          trace("t1", "b", [[2, 4], [20, 4]]),
          trace("t2", null, [[2, 6], [20, 6]]),
        ],
        vias: [
          via("v0", { netId: "a", center: { x: 6, y: 8 } }),
          via("v1", { netId: "b", center: { x: 7, y: 8 } }),
        ],
        placements: [
          placement("U1", {
            positionMm: { x: 12, y: 12 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1), pad("2", { x: 2, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "U1|1": "a", "U1|2": "b" },
        freeHoles: [
          freeHole("h0", { x: 4, y: 16 }, 0.8),
          freeHole("h1", { x: 5, y: 16 }, 0.8),
        ],
      }),
    },
    {
      name: "no classes, no rules",
      p: projection({
        board: board(),
        netNames: { a: "A" },
        traces: [trace("t0", "a", [[1, 1], [9, 1]])],
      }),
    },
  ];
}

describe("every halo of §5 bounds what the checks compare against", () => {
  const corpus = [...goldenProjections(), ...syntheticProjections()];
  expect(corpus.length).toBeGreaterThanOrEqual(7);

  for (const { name, p } of corpus) {
    test(`${name}: clearance / edge / hole / creepage`, () => {
      const ctx = buildDrcContext(p);
      const layers = [...ctx.validCopperLayers] as PcbCopperLayerId[];

      // One representative (net, point) per item, capped so the O(reps²) sweep
      // stays a test rather than a benchmark. Real points, so area scopes fire.
      const reps: Array<{ netId: string | null; pointMm: PcbPointMm }> = [];
      const push = (netId: string | null, pointMm: PcbPointMm): void => {
        if (reps.length < 40) reps.push({ netId, pointMm });
      };
      ctx.traces.forEach((t, i) => {
        if (i % 3 === 0) push(t.netId, t.mid);
      });
      ctx.pads.forEach((pd, i) => {
        if (i % 3 === 0) push(pd.netId, pd.center);
      });
      ctx.vias.forEach((v, i) => {
        if (i % 3 === 0) push(v.netId, v.center);
      });
      push(null, { x: 0, y: 0 });
      expect(reps.length).toBeGreaterThan(1);

      for (const kind of PAIR_KINDS) {
        for (const layer of layers) {
          for (const a of reps) {
            for (const b of reps) {
              expect(
                ctx.resolver.clearance(kind, layer, a, b).mm,
              ).toBeLessThanOrEqual(ctx.maxClearanceBoundMm);
            }
          }
        }
      }

      // edgeClearance: the real per-item geometry every board site passes.
      for (const t of ctx.traces) {
        expect(
          ctx.resolver.scalar("edgeClearance", {
            netId: t.netId,
            layers: [t.layer],
            geometry: {
              kind: "polyline",
              pointsMm: t.pointsMm,
              halfWidthMm: t.halfWidthMm,
            },
          }).mm,
        ).toBeLessThanOrEqual(ctx.maxEdgeBoundMm);
      }
      for (const pd of ctx.pads) {
        expect(
          ctx.resolver.scalar("edgeClearance", {
            netId: pd.netId,
            layers: pd.layers,
            geometry: { kind: "ring", ring: pd.ring },
          }).mm,
        ).toBeLessThanOrEqual(ctx.maxEdgeBoundMm);
      }
      for (const v of ctx.vias) {
        expect(
          ctx.resolver.scalar("edgeClearance", {
            netId: v.netId,
            layers: v.layers,
            geometry: {
              kind: "disc",
              center: v.center,
              radiusMm: v.radiusMm,
            },
          }).mm,
        ).toBeLessThanOrEqual(ctx.maxEdgeBoundMm);
      }
      expect(ctx.holeToBoardEdgeMm).toBeLessThanOrEqual(ctx.maxEdgeBoundMm);
      expect(
        ctx.designRules.clearance.copperToBoardEdgeMm,
      ).toBeLessThanOrEqual(ctx.maxEdgeBoundMm);

      // holeToHole, on the drill geometry the check resolves with.
      const allLayers = layers;
      const holeGeom = (h: (typeof ctx.holes)[number]) =>
        h.slot
          ? ({
              kind: "segment" as const,
              a: h.slot.a,
              b: h.slot.b,
              halfWidthMm: h.slot.widthMm / 2,
            })
          : ({
              kind: "disc" as const,
              center: h.center,
              radiusMm: h.drillMm / 2,
            });
      const holes = ctx.holes.slice(0, 60);
      for (let i = 0; i < holes.length; i += 1) {
        for (let j = i + 1; j < holes.length; j += 1) {
          expect(
            ctx.resolver.scalarPair(
              "holeToHole",
              {
                netId: holes[i]!.netId,
                layers: allLayers,
                geometry: holeGeom(holes[i]!),
              },
              {
                netId: holes[j]!.netId,
                layers: allLayers,
                geometry: holeGeom(holes[j]!),
              },
            ).mm,
          ).toBeLessThanOrEqual(ctx.maxHoleBoundMm);
        }
      }

      // Creepage: the resolver maxes over the pair's layer columns, and
      // B2 >= B1 (and >= B4) on every band — so the B2 value at the widest
      // differential (one side possibly a classless 0 V net) bounds every pair.
      // The differential itself is never signed (13 §2).
      const volts = [0, ...ctx.netClasses.map((c) => c.voltageV ?? 0)];
      for (const u of volts) {
        for (const v of volts) {
          for (const column of ["B1", "B2", "B4"] as const) {
            expect(
              ipc2221SpacingMm(Math.abs(u - v), column),
            ).toBeLessThanOrEqual(ctx.maxCreepageBoundMm);
          }
        }
      }
    }, 60_000);
  }

  test("the creepage halo really moves with the classes (not vacuous)", () => {
    const low = buildDrcItems(projection({ board: board() }));
    const high = buildDrcItems(
      projection({ board: boardWithRules({ netClasses: HV_CLASSES }) }),
    );
    expect(high.maxCreepageBoundMm).toBeGreaterThan(low.maxCreepageBoundMm);
    // max - min over V ∪ {0} = 400 - (-120) = 520 V, past the 500 V band.
    expect(high.maxCreepageBoundMm).toBeCloseTo(
      ipc2221SpacingMm(520, "B2") + GEOM_EPS_MM,
      12,
    );
  });

  test("the edge halo takes the disabled rule too (not vacuous)", () => {
    const ctx = buildDrcItems(
      projection({
        board: boardWithRules({
          clearance: { copperToBoardEdgeMm: 0.5 },
          drcRules: [
            {
              id: "r",
              name: "off but counted",
              enabled: false,
              priority: 0,
              constraint: { kind: "edgeClearance", minMm: 2.25 },
              scopes: [],
            },
          ],
        }),
      }),
    );
    expect(ctx.maxEdgeBoundMm).toBe(2.25);
  });
});

// --- stats -------------------------------------------------------------------

describe("stats are results-neutral (§7)", () => {
  let judgedAcrossCorpus = 0;
  let prefilteredAcrossCorpus = 0;
  for (const { name, p } of goldenProjections()) {
    test(`${name}: the report is byte-identical with and without stats`, () => {
      const stats = createDrcRunStats();
      const withStats = JSON.stringify(runDrc(p, { stats }));
      const without = JSON.stringify(runDrc(p));
      expect(withStats).toBe(without);
      // Every counter is summed over the corpus, never asserted per golden: a
      // board whose violations all come from the non-pair checks legitimately
      // judges no pair — and once the checks enumerate through the grid (WP3),
      // one whose copper is nowhere near the halo offers the prefilter nothing
      // either (`golden-areas-2l` is exactly that board).
      prefilteredAcrossCorpus += stats.prefilterTests;
      judgedAcrossCorpus += (
        Object.values(stats.pairsJudged) as number[]
      ).reduce((a, b) => a + b, 0);
    }, 60_000);
  }

  test("the corpus reaches the per-pair bodies", () => {
    expect(prefilteredAcrossCorpus).toBeGreaterThan(0);
    expect(judgedAcrossCorpus).toBeGreaterThan(0);
  });
});

// --- the mode switch over the one enumeration WP2 owns -----------------------

describe("judgeCopperPairs agrees in both modes (§1, §3)", () => {
  /**
   * The gate is the one enumeration this work package rewired, and the piece
   * filing is exactly what could drop a pair from it. A dense 45° field with
   * long diagonals, discs and drills is judged in both modes; the two verdict
   * lists must be identical, id for id and number for number.
   */
  const dense = (): DesignerPcbProjection => {
    const rnd = lcg(0x5bf03635);
    const traces = Array.from({ length: 120 }, (_, i) => {
      const x = rnd() * 50 - 25;
      const y = rnd() * 30 - 15;
      const d = 1 + rnd() * 12;
      return trace(`bt${i}`, i % 9 === 0 ? null : `n${i % 6}`, [
        [x, y],
        [x + d, y + d],
        [x + d + 2, y + d],
      ]);
    });
    const vias = Array.from({ length: 60 }, (_, i) =>
      via(`bv${i}`, {
        netId: `n${i % 6}`,
        center: { x: rnd() * 50 - 25, y: rnd() * 30 - 15 },
      }),
    );
    const holes = Array.from({ length: 40 }, (_, i) =>
      freeHole(`bh${i}`, { x: rnd() * 50 - 25, y: rnd() * 30 - 15 }, 0.7),
    );
    return projection({
      board: board(),
      netNames: Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [`n${i}`, `N${i}`]),
      ),
      traces,
      vias,
      freeHoles: holes,
    });
  };

  test("pending × board verdicts are identical", () => {
    const p = dense();
    const gridStats = createDrcRunStats();
    const exhaustiveStats = createDrcRunStats();
    const grid = buildDrcItems(p, { stats: gridStats });
    const exhaustive = buildDrcItems(p, {
      broadPhase: "exhaustive",
      stats: exhaustiveStats,
    });
    expect(grid.broadPhase).toBe("grid");
    expect(exhaustive.broadPhase).toBe("exhaustive");

    const pending: PendingCopper = {
      traces: [
        trace("pending:trace:0", "n1", [[-24, -14], [24, 14]]),
        trace("pending:trace:1", null, [[-20, 10], [20, -10]]),
        trace("pending:trace:2", "n3", [[0, 0], [0, 0]]),
      ],
      vias: [
        via("pending:via:0", { netId: "n1", center: { x: 3, y: 3 } }),
        via("pending:via:1", { netId: null, center: { x: -7, y: 4 } }),
      ],
    };
    const shape = (v: DrcViolation[]) =>
      v.map((x) => ({
        id: x.id,
        code: x.code,
        layer: x.layer,
        severity: x.severity,
        measuredMm: x.measuredMm,
        requiredMm: x.requiredMm,
        message: x.message,
      }));
    const a = shape(checkPendingCopper(grid, pending));
    const b = shape(checkPendingCopper(exhaustive, pending));
    expect(a).toEqual(b);
    // Not vacuous: the dense field really does produce verdicts, and the two
    // modes really are two different enumerations (§7 (iii)).
    expect(a.length).toBeGreaterThan(0);
    expect(gridStats.prefilterTests).toBeLessThan(
      exhaustiveStats.prefilterTests,
    );
    for (const kind of PAIR_KINDS) {
      expect(gridStats.pairsJudged[kind]).toBeLessThanOrEqual(
        exhaustiveStats.pairsJudged[kind],
      );
    }
  });
});

// --- the kinds the grid indexes ---------------------------------------------

test("every BroadPhaseKind answers both query forms", () => {
  const kinds: BroadPhaseKind[] = ["traces", "pads", "vias", "holes"];
  const bp = createBroadPhase({
    traces: [synthTrace("t", [{ x: 0, y: 0 }, { x: 1, y: 0 }], 0.1)],
    pads: [boxAt(0, 0, 0.5)],
    vias: [boxAt(0, 0, 0.3)],
    holes: [boxAt(0, 0, 0.2)],
  });
  for (const kind of kinds) {
    expect(bp.near(kind, boxAt(0, 0, 0.1), 0)).toEqual([0]);
    expect(bp.nearPolyline(kind, [{ x: 0, y: 0 }], 0, 0)).toEqual([0]);
    expect(bp.near(kind, boxAt(500, 500, 0.1), 0)).toEqual([]);
  }
});
