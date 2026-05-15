import { describe, expect, test } from "vitest";
import * as THREE from "three";
import type { PcbPlacedPart, PcbTrace, PcbVia } from "../../../../../sdks";
import type { FootprintRenderSourcePad } from "../../../../../shared/rendering";
import {
  buildCopperFillGeometrySpec,
  resolveCopperFillClearanceMm,
} from "./copper-fill-geometry";

const outline = {
  kind: "rect" as const,
  widthMm: 20,
  heightMm: 10,
  centerMm: { x: 0, y: 0 },
};

// Empty-input sentinel — keeps each test signature short. Cast at the use site
// so TypeScript still narrows the call site when fields are overridden.
const noTraces: ReadonlyArray<PcbTrace> = [];
const noVias: ReadonlyArray<PcbVia> = [];
const emptyPadNets: ReadonlyMap<string, string> = new Map();

function pad(
  id: string,
  centerMm: { x: number; y: number },
  widthMm: number,
  heightMm: number,
  overrides: Partial<FootprintRenderSourcePad> = {},
): FootprintRenderSourcePad {
  return {
    id,
    number: id,
    shape: "rect",
    centerMm,
    widthMm,
    heightMm,
    rotationDeg: 0,
    layer: "F.Cu",
    ...overrides,
  };
}

function placement(
  pads: FootprintRenderSourcePad[],
  overrides: Partial<PcbPlacedPart> = {},
): PcbPlacedPart {
  return {
    id: "U1-pcb",
    partId: "U1",
    componentId: "component-1",
    reference: "U1",
    positionMm: { x: 2, y: 3 },
    rotationDeg: 0,
    mirrored: false,
    layer: "F.Cu",
    footprint: {
      footprintId: "fp-1",
      name: "SOIC",
      mountType: "smd",
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "SOIC",
        pads,
        graphics: [],
        labels: [],
        bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
        warnings: [],
      },
    },
    ...overrides,
  };
}

function trace(overrides: Partial<PcbTrace> = {}): PcbTrace {
  return {
    id: "t1",
    netId: null,
    netClassId: "default",
    layer: "F.Cu",
    widthMm: 0.2,
    pointsNm: [
      { x: 0, y: 0 },
      { x: 5_000_000, y: 0 }, // 5 mm
    ],
    segmentMode: "manhattan-90",
    ...overrides,
  };
}

function via(overrides: Partial<PcbVia> = {}): PcbVia {
  return {
    id: "v1",
    netId: null,
    netClassId: "default",
    centerMm: { x: 0, y: 0 },
    diameterMm: 0.6,
    drillMm: 0.3,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    protection: "tented",
    ...overrides,
  };
}

function shapeBounds(shape: THREE.Shape): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return shape.getPoints(0).reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

describe("copper fill geometry", () => {
  test("uses a conservative zone-pour clearance floor", () => {
    expect(
      resolveCopperFillClearanceMm({
        traceToTraceMm: 0.2,
        traceToPadMm: 0.25,
        padToPadMm: 0.25,
        traceToViaMm: 0.2,
        viaToViaMm: 0.3,
        copperToBoardEdgeMm: 0.5,
      }),
    ).toBe(0.5);

    expect(
      resolveCopperFillClearanceMm({
        traceToTraceMm: 0.2,
        traceToPadMm: 0.6,
        padToPadMm: 0.25,
        traceToViaMm: 0.2,
        viaToViaMm: 0.3,
        copperToBoardEdgeMm: 0.5,
      }),
    ).toBe(0.6);
  });

  test("shrinks fill by copper-to-board-edge clearance", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [],
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0.5,
    });

    expect(spec.fill).toEqual({
      center: { x: 0, y: 0 },
      widthMm: 19,
      heightMm: 9,
    });
  });

  test("bakes placement transform into world-coord mask polygon", () => {
    // Placement default fixture has positionMm = {2, 3}. The pad sits at the
    // footprint origin, inflated to 2×2 mm. After applying the placement
    // transform, world-coord bounds of the pad halo are (1..3, 2..4).
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.5,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(1);
    expect(spec.masks[0]!.positionMm).toEqual({ x: 0, y: 0 });
    expect(spec.masks[0]!.rotationDeg).toBe(0);
    expect(spec.masks[0]!.scaleX).toBe(1);
    // Common case (no islands pruned): the mask polygon == the inflated pad
    // outline in world coords. No pour rect, no holes — the mask just paints
    // the pad halo region in board-bg color over the underlying pour.
    expect(spec.masks[0]!.shape.holes).toHaveLength(0);
    const bounds = shapeBounds(spec.masks[0]!.shape);
    expect(bounds.minX).toBeCloseTo(1, 1);
    expect(bounds.maxX).toBeCloseTo(3, 1);
    expect(bounds.minY).toBeCloseTo(2, 1);
    expect(bounds.maxY).toBeCloseTo(4, 1);
  });

  test("merges close pads into one smoothed outer mask", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [
        placement([
          pad("1", { x: -0.35, y: 0 }, 0.3, 0.8),
          pad("2", { x: 0.35, y: 0 }, 0.3, 0.8),
        ]),
      ],
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.5,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(1);
    expect(spec.masks[0]!.shape.getPoints(0).length).toBeGreaterThan(8);
  });

  test("keeps distant pad groups separate within one footprint", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [
        placement([
          pad("1", { x: -3, y: 0 }, 0.5, 0.5),
          pad("2", { x: 3, y: 0 }, 0.5, 0.5),
        ]),
      ],
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.5,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(2);
  });

  test("fills inner holes and keeps only the outer IC mask outline", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [
        placement([
          pad("top", { x: 0, y: 1 }, 2.6, 0.4),
          pad("right", { x: 1, y: 0 }, 0.4, 2.6),
          pad("bottom", { x: 0, y: -1 }, 2.6, 0.4),
          pad("left", { x: -1, y: 0 }, 0.4, 2.6),
        ]),
      ],
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.35,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(1);
    expect(spec.masks[0]!.shape.holes).toHaveLength(0);
  });

  test("bakes mirror + rotate + translate into the mask polygon vertices", () => {
    // Pad at footprint-local (1, 0), inflated to 1.5×1.5. Placement transform
    // is mirror-X (scaleX = -1), rotate 90° CCW, translate to (5, 6).
    // Per applyPlacementTransform: (x, y) → (5 − y, 6 − x).
    // So local bounds (0.25..1.75, −0.75..0.75) become world (4.25..5.75,
    // 4.25..5.75) — pad centre maps to (5, 5).
    const spec = buildCopperFillGeometrySpec({
      layer: "B.Cu",
      outline,
      placements: [
        placement([pad("1", { x: 1, y: 0 }, 0.5, 0.5)], {
          positionMm: { x: 5, y: 6 },
          rotationDeg: 90,
          mirrored: true,
          layer: "B.Cu",
        }),
      ],
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.5,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(1);
    expect(spec.masks[0]!.positionMm).toEqual({ x: 0, y: 0 });
    expect(spec.masks[0]!.rotationDeg).toBe(0);
    expect(spec.masks[0]!.scaleX).toBe(1);
    const bounds = shapeBounds(spec.masks[0]!.shape);
    expect(bounds.minX).toBeCloseTo(4.25, 1);
    expect(bounds.maxX).toBeCloseTo(5.75, 1);
    expect(bounds.minY).toBeCloseTo(4.25, 1);
    expect(bounds.maxY).toBeCloseTo(5.75, 1);
  });

  test("skips placements without pads", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [placement([])],
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.5,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(0);
  });

  test("fill is null when it is zero-sized", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline: {
        kind: "rect",
        widthMm: 0,
        heightMm: 0,
        centerMm: { x: 0, y: 0 },
      },
      placements: [],
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.fill).toBeNull();
    expect(spec.masks).toHaveLength(0);
  });
});

describe("copper fill — trace knockouts", () => {
  test("emits a single mask polygon for one isolated trace", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [],
      traces: [trace()],
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(1);
    expect(spec.masks[0]!.id).toMatch(/^pour-mask:F\.Cu:/);
    // World-coord polygon → identity transform.
    expect(spec.masks[0]!.positionMm).toEqual({ x: 0, y: 0 });
    expect(spec.masks[0]!.rotationDeg).toBe(0);
    expect(spec.masks[0]!.scaleX).toBe(1);
  });

  test("same-net trace is merged silently (no mask emitted)", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [],
      traces: [trace({ netId: "GND" })],
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: "GND",
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(0);
  });

  test("null trace netId always knocks out, even when pour has a net", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [],
      traces: [trace({ netId: null })],
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: "GND",
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(1);
  });

  test("null pour net knocks out every trace (no merge target)", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [],
      traces: [
        trace({ id: "ta", netId: "GND" }),
        trace({ id: "tb", netId: "VCC" }),
      ],
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    // Two non-overlapping traces collinear at y=0 → unioned into 1 polygon.
    // Critical: both must contribute (neither skipped by same-net merge).
    expect(spec.masks.length).toBeGreaterThanOrEqual(1);
  });

  test("traces on a different layer are filtered out", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [],
      traces: [trace({ layer: "B.Cu" })],
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(0);
  });

  test("L-shaped polyline unions into a single connected mask", () => {
    const lTrace = trace({
      pointsNm: [
        { x: 0, y: 0 },
        { x: 5_000_000, y: 0 },
        { x: 5_000_000, y: 5_000_000 },
      ],
    });
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [],
      traces: [lTrace],
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    // Two stadia overlap at the corner → union flattens into 1 outer ring.
    expect(spec.masks).toHaveLength(1);
  });
});

describe("copper fill — via knockouts", () => {
  test("emits a disc mask for an isolated via", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [],
      traces: noTraces,
      vias: [via()],
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(1);
    expect(spec.masks[0]!.id).toMatch(/^pour-mask:F\.Cu:/);
    const bounds = shapeBounds(spec.masks[0]!.shape);
    // diameter 0.6 + clearance 0.2 → outer radius 0.5 mm
    expect(bounds.maxX).toBeCloseTo(0.5, 2);
    expect(bounds.maxY).toBeCloseTo(0.5, 2);
  });

  test("same-net via is merged silently", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [],
      traces: noTraces,
      vias: [via({ netId: "GND" })],
      padNetIds: emptyPadNets,
      pourNetId: "GND",
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(0);
  });

  test("through via cuts every copper layer the pour is active on", () => {
    const params = {
      outline,
      placements: [],
      traces: noTraces,
      vias: [via({ netId: "VCC" })],
      padNetIds: emptyPadNets,
      pourNetId: "GND" as string | null,
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    };
    for (const layer of ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"] as const) {
      const spec = buildCopperFillGeometrySpec({ ...params, layer });
      expect(spec.masks).toHaveLength(1);
    }
  });
});

describe("copper fill — mixed pad + trace + via inputs", () => {
  test("emits one unified mask polygon per disjoint knockout region", () => {
    // Pad, trace, and via are at distinct non-overlapping world locations →
    // the global union produces 3 disjoint polygons. Ordering is up to
    // polygon-clipping; we only assert count and unified id prefix.
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [
        placement([pad("1", { x: -5, y: 0 }, 1, 1)], {
          positionMm: { x: -5, y: -3 },
        }),
      ],
      traces: [
        trace({
          pointsNm: [
            { x: 0, y: 2_000_000 },
            { x: 5_000_000, y: 2_000_000 },
          ],
          netId: "VCC",
        }),
      ],
      vias: [via({ centerMm: { x: 4, y: -2 }, netId: "VCC" })],
      padNetIds: emptyPadNets,
      pourNetId: "GND",
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(3);
    for (const mask of spec.masks) {
      expect(mask.id).toMatch(/^pour-mask:F\.Cu:/);
      expect(mask.positionMm).toEqual({ x: 0, y: 0 });
    }
  });
});

describe("copper fill — island removal", () => {
  test("prunes a small enclosed pour island below the area threshold", () => {
    // Four overlapping rectangular pads forming a hollow ring around the
    // origin. The halos merge into a single ring polygon whose inner hole
    // is the visible pour island; we size the hole so it lands well below
    // the 1.0 mm² threshold and gets pruned.
    //
    //   Top bar : (0,  0.5)  2.0 × 0.2  → halo 2.4 × 0.6 covers y ∈ (0.2, 0.8)
    //   Bottom  : (0, -0.5)  2.0 × 0.2  → halo 2.4 × 0.6 covers y ∈ (-0.8,-0.2)
    //   Left bar: (-0.5, 0)  0.2 × 2.0  → halo 0.6 × 2.4 covers x ∈ (-0.8,-0.2)
    //   Right   : ( 0.5, 0)  0.2 × 2.0  → halo 0.6 × 2.4 covers x ∈ (0.2, 0.8)
    //
    // The four halos overlap at the four corners → polygon-clipping union
    // yields ONE polygon with an inner hole at x,y ∈ (-0.2, 0.2) ≈ 0.16 mm².
    const ringOutline = {
      kind: "rect" as const,
      widthMm: 6,
      heightMm: 6,
      centerMm: { x: 0, y: 0 },
    };
    const ringPads = [
      placement([pad("top", { x: 0, y: 0.5 }, 2.0, 0.2)], {
        id: "U-top",
        positionMm: { x: 0, y: 0 },
      }),
      placement([pad("bot", { x: 0, y: -0.5 }, 2.0, 0.2)], {
        id: "U-bot",
        positionMm: { x: 0, y: 0 },
      }),
      placement([pad("left", { x: -0.5, y: 0 }, 0.2, 2.0)], {
        id: "U-left",
        positionMm: { x: 0, y: 0 },
      }),
      placement([pad("right", { x: 0.5, y: 0 }, 0.2, 2.0)], {
        id: "U-right",
        positionMm: { x: 0, y: 0 },
      }),
    ];

    const without = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline: ringOutline,
      placements: ringPads,
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
      minIslandAreaMm2: 0, // disable prune for the control case
    });
    const withPrune = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline: ringOutline,
      placements: ringPads,
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
      minIslandAreaMm2: 1.0,
    });

    // Control (prune disabled): one mask polygon (the ring) with one hole
    // (the central pour island). Pour shows through the hole.
    expect(without.masks).toHaveLength(1);
    expect(without.masks[0]!.shape.holes.length).toBeGreaterThanOrEqual(1);

    // With prune: the central island is below threshold and gets covered.
    // The mask topology collapses to a solid shape (ring inner hole filled).
    expect(withPrune.masks).toHaveLength(1);
    expect(withPrune.masks[0]!.shape.holes).toHaveLength(0);
  });

  test("preserves large pour islands above the area threshold", () => {
    // Single pad at center, inflated to 2×2 mm halo. The surrounding pour
    // (20×10 minus 4 mm²) is way above any sane threshold and must remain
    // a single mask polygon (the pad halo) with no extra pruning artefacts.
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [
        placement([pad("1", { x: 0, y: 0 }, 1, 1)], {
          positionMm: { x: 0, y: 0 },
        }),
      ],
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.5,
      copperToBoardEdgeMm: 0,
      minIslandAreaMm2: 1.0,
    });

    expect(spec.masks).toHaveLength(1);
    expect(spec.masks[0]!.shape.holes).toHaveLength(0);
    const bounds = shapeBounds(spec.masks[0]!.shape);
    // pad halo bbox = 2×2 around origin
    expect(bounds.minX).toBeCloseTo(-1, 1);
    expect(bounds.maxX).toBeCloseTo(1, 1);
  });

  test("entire pour pruned when fill rect is smaller than threshold", () => {
    // Pour rect 0.5×0.5 = 0.25 mm² < threshold 1.0 → whole pour is one tiny
    // island, gets pruned. Mask = full pour rect.
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline: {
        kind: "rect",
        widthMm: 0.5,
        heightMm: 0.5,
        centerMm: { x: 0, y: 0 },
      },
      placements: [],
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: null,
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
      minIslandAreaMm2: 1.0,
    });

    expect(spec.fill).not.toBeNull();
    expect(spec.masks).toHaveLength(1);
    const bounds = shapeBounds(spec.masks[0]!.shape);
    // mask covers entire fill rect
    expect(bounds.maxX - bounds.minX).toBeCloseTo(0.5, 5);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(0.5, 5);
  });
});

describe("copper fill — same-net pad merge", () => {
  test("pads on pour net with safe clearance skip the halo (merge into pour)", () => {
    // Single pad at world (2, 3), inflated to 2×2 with clearance 0.5 → halo
    // bounds (1..3, 2..4). With padNetIds tagging it as GND and pourNetId =
    // "GND", the pad is on the pour net and no other features are within
    // clearance → merge: no mask emitted.
    const padNets = new Map<string, string>([["U1-pcb|1", "GND"]]);
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
      traces: noTraces,
      vias: noVias,
      padNetIds: padNets,
      pourNetId: "GND",
      clearanceMm: 0.5,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(0);
  });

  test("same-net pad keeps halo when within clearance of a different-net feature", () => {
    // GND pad at world (1.5, 0), 1×1  → bare bounds (1..2, -0.5..0.5)
    // VCC pad at world (3, 0), 1×1    → bare bounds (2.5..3.5, -0.5..0.5)
    // Bare-edge gap = 0.5 mm < clearance 1.0 → with clearance 1.0 the VCC
    // halo (1.5..4.5) overlaps the GND bare outline (1..2). Safety guard
    // must trigger and emit the GND halo as well.
    const padNets = new Map<string, string>([
      ["U1-pcb|1", "GND"],
      ["U2-pcb|1", "VCC"],
    ]);
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [
        placement([pad("1", { x: 1.5, y: 0 }, 1, 1)], {
          id: "U1-pcb",
          positionMm: { x: 0, y: 0 },
        }),
        placement([pad("1", { x: 3, y: 0 }, 1, 1)], {
          id: "U2-pcb",
          positionMm: { x: 0, y: 0 },
        }),
      ],
      traces: noTraces,
      vias: noVias,
      padNetIds: padNets,
      pourNetId: "GND",
      clearanceMm: 1.0,
      copperToBoardEdgeMm: 0,
    });

    // Both halos union into a single mask polygon covering both pads.
    expect(spec.masks.length).toBeGreaterThanOrEqual(1);
    const totalBounds = spec.masks.reduce(
      (acc, m) => {
        const b = shapeBounds(m.shape);
        return {
          minX: Math.min(acc.minX, b.minX),
          maxX: Math.max(acc.maxX, b.maxX),
          minY: Math.min(acc.minY, b.minY),
          maxY: Math.max(acc.maxY, b.maxY),
        };
      },
      {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      },
    );
    // GND pad halo left edge ≈ 0; VCC pad halo right edge ≈ 4.5. If the GND
    // halo had been suppressed, minX would land around 1.5 instead of 0.
    expect(totalBounds.minX).toBeLessThan(0.1);
    expect(totalBounds.maxX).toBeGreaterThan(4.4);
  });

  test("pad missing from padNetIds is treated as different-net (always halo)", () => {
    // pourNetId is GND but padNetIds is empty → pad's netId resolves to
    // unknown → emit halo as if it were on a different net.
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
      traces: noTraces,
      vias: noVias,
      padNetIds: emptyPadNets,
      pourNetId: "GND",
      clearanceMm: 0.5,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(1);
  });

  test("mixes safe-merge and forced-halo pads in one footprint", () => {
    // Two pads on the same multi-pad footprint: pad 1 is on GND (pour net)
    // with no neighbour nearby → safe merge. Pad 2 is on VCC → always halo.
    // The output must contain only pad 2's halo.
    const padNets = new Map<string, string>([
      ["U1-pcb|1", "GND"],
      ["U1-pcb|2", "VCC"],
    ]);
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [
        placement(
          [
            pad("1", { x: -3, y: 0 }, 0.5, 0.5),
            pad("2", { x: 3, y: 0 }, 0.5, 0.5),
          ],
          { id: "U1-pcb", positionMm: { x: 0, y: 0 } },
        ),
      ],
      traces: noTraces,
      vias: noVias,
      padNetIds: padNets,
      pourNetId: "GND",
      clearanceMm: 0.3,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.masks).toHaveLength(1);
    const bounds = shapeBounds(spec.masks[0]!.shape);
    // Only the VCC pad halo (centred at world (3, 0)) should be present —
    // GND pad at (-3, 0) merges.
    expect(bounds.minX).toBeGreaterThan(2);
    expect(bounds.maxX).toBeLessThan(4);
  });
});

describe("copper fill — pad layer filtering", () => {
  // Regression block for the SMD-pads-leaking-onto-opposite-layer bug:
  // a top-side SMD pad must NOT punch through the B.Cu pour and vice versa.
  // Through-hole pads (`*.Cu` or drillDiameterMm > 0) still cut every layer.

  function buildSpec(
    layer: "F.Cu" | "B.Cu",
    pads: FootprintRenderSourcePad[],
    placementOverrides: Partial<PcbPlacedPart> = {},
    extra: {
      pourNetId?: string | null;
      padNetIds?: ReadonlyMap<string, string>;
    } = {},
  ) {
    return buildCopperFillGeometrySpec({
      layer,
      outline,
      placements: [placement(pads, placementOverrides)],
      traces: noTraces,
      vias: noVias,
      padNetIds: extra.padNetIds ?? emptyPadNets,
      pourNetId: extra.pourNetId ?? null,
      clearanceMm: 0.5,
      copperToBoardEdgeMm: 0,
    });
  }

  test("SMD F.Cu pad on F.Cu placement: knockout on F.Cu, none on B.Cu", () => {
    const p = pad("1", { x: 0, y: 0 }, 1, 1, { layer: "F.Cu" });
    expect(buildSpec("F.Cu", [p]).masks).toHaveLength(1);
    expect(buildSpec("B.Cu", [p]).masks).toHaveLength(0);
  });

  test("SMD F.Cu pad on B.Cu placement: flips to B.Cu", () => {
    // Placement-layer flip remaps pad.layer F.Cu → B.Cu, mirroring the visual
    // behaviour of `FootprintRenderLayer`.
    const p = pad("1", { x: 0, y: 0 }, 1, 1, { layer: "F.Cu" });
    expect(buildSpec("F.Cu", [p], { layer: "B.Cu" }).masks).toHaveLength(0);
    expect(buildSpec("B.Cu", [p], { layer: "B.Cu" }).masks).toHaveLength(1);
  });

  test("SMD B.Cu pad on F.Cu placement: stays on B.Cu", () => {
    const p = pad("1", { x: 0, y: 0 }, 1, 1, { layer: "B.Cu" });
    expect(buildSpec("F.Cu", [p]).masks).toHaveLength(0);
    expect(buildSpec("B.Cu", [p]).masks).toHaveLength(1);
  });

  test("THT *.Cu pad with drill cuts every copper layer", () => {
    const p = pad("1", { x: 0, y: 0 }, 1, 1, {
      layer: "*.Cu",
      drillDiameterMm: 0.9,
    });
    expect(buildSpec("F.Cu", [p]).masks).toHaveLength(1);
    expect(buildSpec("B.Cu", [p]).masks).toHaveLength(1);
  });

  test("THT pad with drill but missing pad.layer still spans all layers", () => {
    // drillDiameterMm > 0 is the model-wide SMD/THT discriminator and wins
    // over an absent pad.layer.
    const p = pad("1", { x: 0, y: 0 }, 1, 1, {
      layer: undefined,
      drillDiameterMm: 0.9,
    });
    expect(buildSpec("F.Cu", [p]).masks).toHaveLength(1);
    expect(buildSpec("B.Cu", [p]).masks).toHaveLength(1);
  });

  test("SMD pad with missing layer falls back to placement.layer", () => {
    const p = pad("1", { x: 0, y: 0 }, 1, 1, { layer: undefined });
    // Top-placed → F.Cu only.
    expect(buildSpec("F.Cu", [p]).masks).toHaveLength(1);
    expect(buildSpec("B.Cu", [p]).masks).toHaveLength(0);
    // Bottom-placed → B.Cu only.
    expect(buildSpec("F.Cu", [p], { layer: "B.Cu" }).masks).toHaveLength(0);
    expect(buildSpec("B.Cu", [p], { layer: "B.Cu" }).masks).toHaveLength(1);
  });

  test("QFP IC-body silhouette emits on placement layer only", () => {
    // 4-pad ring whose halos enclose a central region (triggers the IC-body
    // silhouette path); all on F.Cu — must produce one knockout on F.Cu and
    // nothing on B.Cu.
    const ringPads = [
      pad("top", { x: 0, y: 1 }, 2.6, 0.4, { layer: "F.Cu" }),
      pad("right", { x: 1, y: 0 }, 0.4, 2.6, { layer: "F.Cu" }),
      pad("bottom", { x: 0, y: -1 }, 2.6, 0.4, { layer: "F.Cu" }),
      pad("left", { x: -1, y: 0 }, 0.4, 2.6, { layer: "F.Cu" }),
    ];
    expect(buildSpec("F.Cu", ringPads).masks).toHaveLength(1);
    expect(buildSpec("B.Cu", ringPads).masks).toHaveLength(0);
  });

  test("mixed SMD + THT footprint: B.Cu sees only the THT pad", () => {
    const mixedPads = [
      pad("1", { x: -2, y: 0 }, 1, 1, { layer: "F.Cu" }),
      pad("2", { x: -1, y: 0 }, 1, 1, { layer: "F.Cu" }),
      pad("3", { x: 1, y: 0 }, 1, 1, { layer: "F.Cu" }),
      pad("4", { x: 2, y: 0 }, 1, 1, { layer: "F.Cu" }),
      pad("5", { x: 4, y: 0 }, 1, 1, {
        layer: "*.Cu",
        drillDiameterMm: 0.9,
      }),
    ];
    // Top fill: all 5 pads contribute (different-net halos union into one
    // mask polygon for the 4 closely-spaced SMD pads + a separate one for
    // the standalone THT pad). Exact count depends on adjacency; just
    // assert at least one mask and that B.Cu has strictly fewer (the THT
    // contribution survives but the SMD ones do not).
    const top = buildSpec("F.Cu", mixedPads);
    const bot = buildSpec("B.Cu", mixedPads);
    expect(top.masks.length).toBeGreaterThan(0);
    expect(bot.masks).toHaveLength(1);
    const botBounds = shapeBounds(bot.masks[0]!.shape);
    // Only the THT pad at world x = 4 + placement offset (2) = 6 survives
    // on B.Cu. SMD pads at world x ∈ [0..4] would be filtered out.
    expect(botBounds.minX).toBeGreaterThan(4);
  });

  test("same-net SMD pad on F.Cu pour: filtered before same-net merge on B.Cu", () => {
    // Top-placed SMD pad whose net matches the F.Cu pour:
    //   F.Cu → pad merges into pour → 0 masks (existing same-net behaviour).
    //   B.Cu → pad filtered out before same-net path → 0 masks.
    // Both layers end up with no mask but for different reasons; what we're
    // guarding here is that layer filtering precedes same-net merge so the
    // safety-fallback halo can never sneak in on the opposite side.
    const p = pad("1", { x: 0, y: 0 }, 1, 1, { layer: "F.Cu" });
    const padNets = new Map([["U1-pcb|1", "GND"]]);
    expect(
      buildSpec("F.Cu", [p], {}, { pourNetId: "GND", padNetIds: padNets })
        .masks,
    ).toHaveLength(0);
    expect(
      buildSpec("B.Cu", [p], {}, { pourNetId: "GND", padNetIds: padNets })
        .masks,
    ).toHaveLength(0);
  });
});
