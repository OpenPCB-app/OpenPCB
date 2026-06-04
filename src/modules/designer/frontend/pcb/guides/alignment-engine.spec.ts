import { describe, test, expect } from "vitest";
import type { PcbLayerId, PcbPlacedPart } from "../../../../../sdks";
import {
  buildAlignmentIndex,
  computeAlignmentGuides,
  translateBBox,
  unionBBox,
} from "./alignment-engine";

const makePlacement = (
  overrides: Partial<PcbPlacedPart> = {},
): PcbPlacedPart => ({
  id: "p1",
  partId: "part1",
  componentId: "c1",
  reference: "R1",
  positionMm: { x: 0, y: 0 },
  rotationDeg: 0,
  mirrored: false,
  layer: "F.Cu",
  footprint: {
    footprintId: "fp1",
    name: "TEST",
    mountType: null,
    sourceHash: null,
    preview: {
      kind: "footprint",
      units: "mm",
      name: "TEST",
      labels: [],
      warnings: [],
      pads: [],
      graphics: [],
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    },
  },
  ...overrides,
});

const VIS: ReadonlySet<PcbLayerId> = new Set<PcbLayerId>(["F.Cu", "B.Cu"]);

describe("alignment-engine", () => {
  test("center-X alignment yields an x-center guide + snap correction", () => {
    const other = makePlacement({ id: "other", positionMm: { x: 0, y: 0 } });
    const index = buildAlignmentIndex({
      placements: [other],
      excludeIds: new Set(["drag"]),
      visibleLayers: VIS,
    });
    const dragged = makePlacement({
      id: "drag",
      positionMm: { x: 0.03, y: 10 },
    });
    const { guides, snap } = computeAlignmentGuides({
      index,
      draggedBBoxMm: unionBBox([dragged])!,
      toleranceMm: 0.1,
    });
    const centerX = guides.find((g) => g.axis === "x" && g.kind === "center");
    expect(centerX).toBeDefined();
    expect(centerX!.coordMm).toBe(0);
    expect(snap.dx).toBeCloseTo(-0.03, 6);
    expect(snap.dy).toBe(0);
  });

  test("excludes dragged ids and respects layer visibility", () => {
    const a = makePlacement({ id: "a", positionMm: { x: 0, y: 0 } });
    const hidden = makePlacement({
      id: "b",
      layer: "F.SilkS" as PcbLayerId,
      positionMm: { x: 0, y: 5 },
    });
    const index = buildAlignmentIndex({
      placements: [a, hidden],
      excludeIds: new Set(["a"]),
      visibleLayers: VIS,
    });
    expect(index.xFeatures).toHaveLength(0);
    expect(index.yFeatures).toHaveLength(0);
  });

  test("no guide and no snap beyond tolerance", () => {
    const other = makePlacement({ id: "other", positionMm: { x: 0, y: 0 } });
    const index = buildAlignmentIndex({
      placements: [other],
      excludeIds: new Set(),
      visibleLayers: VIS,
    });
    const dragged = makePlacement({ id: "drag", positionMm: { x: 50, y: 50 } });
    const { guides, snap } = computeAlignmentGuides({
      index,
      draggedBBoxMm: unionBBox([dragged])!,
      toleranceMm: 0.1,
    });
    expect(guides).toHaveLength(0);
    expect(snap).toEqual({ dx: 0, dy: 0 });
  });

  test("edge alignment: dragged left edge snaps to other right edge", () => {
    const other = makePlacement({ id: "other", positionMm: { x: 0, y: 0 } }); // x[-1,1]
    const index = buildAlignmentIndex({
      placements: [other],
      excludeIds: new Set(),
      visibleLayers: VIS,
    });
    const dragged = makePlacement({
      id: "drag",
      positionMm: { x: 1.98, y: 0 },
    }); // minX 0.98
    const { guides, snap } = computeAlignmentGuides({
      index,
      draggedBBoxMm: unionBBox([dragged])!,
      toleranceMm: 0.1,
    });
    const edge = guides.find((g) => g.axis === "x" && g.coordMm === 1);
    expect(edge).toBeDefined();
    expect(snap.dx).toBeCloseTo(0.02, 6);
  });

  test("group union bbox aligns as a whole", () => {
    const other = makePlacement({ id: "other", positionMm: { x: 0, y: 0 } });
    const index = buildAlignmentIndex({
      placements: [other],
      excludeIds: new Set(["g1", "g2"]),
      visibleLayers: VIS,
    });
    // two dragged parts: union center.x = 0.04
    const g1 = makePlacement({ id: "g1", positionMm: { x: -0.96, y: 20 } });
    const g2 = makePlacement({ id: "g2", positionMm: { x: 1.04, y: 20 } });
    const bbox = unionBBox([g1, g2])!; // x[-1.96, 2.04] => center 0.04
    const { snap } = computeAlignmentGuides({
      index,
      draggedBBoxMm: bbox,
      toleranceMm: 0.1,
    });
    // center query 0.04 -> snaps onto 0 (delta -0.04)
    expect(snap.dx).toBeCloseTo(-0.04, 6);
  });

  test("translateBBox shifts bounds", () => {
    expect(
      translateBBox({ minX: 0, minY: 0, maxX: 2, maxY: 2 }, 5, -3),
    ).toEqual({
      minX: 5,
      minY: -3,
      maxX: 7,
      maxY: -1,
    });
  });

  test("equal-spacing centers the dragged box between two neighbors", () => {
    const left = makePlacement({ id: "L", positionMm: { x: 0, y: 0 } }); // x[-1,1]
    const right = makePlacement({ id: "R", positionMm: { x: 10, y: 0 } }); // x[9,11]
    const index = buildAlignmentIndex({
      placements: [left, right],
      excludeIds: new Set(["d"]),
      visibleLayers: VIS,
    });
    const dragged = makePlacement({ id: "d", positionMm: { x: 5.05, y: 0 } });
    const { spacing, snap } = computeAlignmentGuides({
      index,
      draggedBBoxMm: unionBBox([dragged])!,
      toleranceMm: 0.1,
    });
    expect(spacing.length).toBeGreaterThan(0);
    expect(spacing[0]!.axis).toBe("x");
    expect(snap.dx).toBeCloseTo(-0.05, 6); // gaps 3.05 vs 2.95 -> equalize
  });

  test("aligns to the board outline center", () => {
    const index = buildAlignmentIndex({
      placements: [],
      excludeIds: new Set(),
      visibleLayers: VIS,
      boardBoundsMm: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, // center x=10
    });
    const dragged = makePlacement({ id: "d", positionMm: { x: 10.03, y: 50 } });
    const { guides, snap } = computeAlignmentGuides({
      index,
      draggedBBoxMm: unionBBox([dragged])!,
      toleranceMm: 0.1,
    });
    expect(
      guides.find((g) => g.axis === "x" && g.coordMm === 10),
    ).toBeDefined();
    expect(snap.dx).toBeCloseTo(-0.03, 6);
  });
});
