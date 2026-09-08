// Courtyard serialization (both provenance paths + the placement transform) and the
// board content digest that gates stale cloud results.
import { describe, expect, test } from "bun:test";

import { buildBoardSnapshot } from "../../../modules/designer/backend/pcb/board-snapshot";
import { computeBoardContentDigest } from "../../../modules/designer/backend/pcb/board-content-digest";
import {
  convexHull,
  placementCourtyardWorldMm,
} from "../../../modules/designer/backend/pcb/courtyard";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import type { FootprintRenderSourcePad } from "../../../shared/rendering/types";
import type {
  DesignerPcbProjection,
  PcbPlacedPart,
  PcbPointMm,
} from "../../../sdks/designer";

const TS = "2026-01-01T00:00:00.000Z";

/** A 2×2 mm courtyard square centred on the footprint origin, as render-model graphics. */
const CRTYD_SQUARE = [
  {
    kind: "rect" as const,
    x: -1,
    y: -1,
    width: 2,
    height: 2,
    fill: "none" as const,
    strokeWidthMm: 0.05,
    layer: "F.CrtYd",
  },
];

function pad(number: string, center: PcbPointMm): FootprintRenderSourcePad {
  return {
    id: `pad-${number}`,
    number,
    shape: "rect",
    centerMm: center,
    widthMm: 1,
    heightMm: 1,
    rotationDeg: 0,
  };
}

function placement(overrides: Partial<PcbPlacedPart> = {}): PcbPlacedPart {
  const graphics = (overrides as any).__graphics ?? [];
  return {
    id: "U1",
    partId: "U1",
    componentId: "c",
    reference: "U1",
    positionMm: { x: 10, y: 10 },
    rotationDeg: 0,
    mirrored: false,
    layer: "F.Cu",
    ...overrides,
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads: [pad("1", { x: -0.5, y: 0 }), pad("2", { x: 0.5, y: 0 })],
        graphics,
        labels: [],
        bounds: null,
        warnings: [],
      },
      ...(overrides.footprint ?? {}),
    },
  } as PcbPlacedPart;
}

function projection(parts: Partial<DesignerPcbProjection> = {}): DesignerPcbProjection {
  return {
    designId: "d1",
    revision: 7,
    board: parts.board ?? createDefaultPcbBoardSettings(TS),
    placements: parts.placements ?? [],
    traces: parts.traces ?? [],
    vias: parts.vias ?? [],
    freeHoles: parts.freeHoles ?? [],
    freePads: parts.freePads ?? [],
    overlayTexts: parts.overlayTexts ?? [],
    overlayShapes: parts.overlayShapes ?? [],
    zones: parts.zones ?? [],
    keepouts: [],
    ratsnest: parts.ratsnest ?? [],
    netNames: parts.netNames ?? {},
    padNets: parts.padNets,
    warnings: [],
  };
}

function bounds(ring: PcbPointMm[]) {
  return {
    minX: Math.min(...ring.map((p) => p.x)),
    maxX: Math.max(...ring.map((p) => p.x)),
    minY: Math.min(...ring.map((p) => p.y)),
    maxY: Math.max(...ring.map((p) => p.y)),
  };
}

describe("convexHull", () => {
  test("degenerate input yields no ring rather than a bad one", () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([]);
    // collinear points have no area — a 2-D polygon cannot be built from them
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toEqual([]);
  });

  test("winds counter-clockwise", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 1, y: 1 }, // interior point is dropped
    ]);
    expect(hull).toHaveLength(4);
    const area =
      hull.reduce((sum, p, i) => {
        const n = hull[(i + 1) % hull.length]!;
        return sum + (p.x * n.y - n.x * p.y);
      }, 0) / 2;
    expect(area).toBeGreaterThan(0); // positive ⇒ CCW
  });
});

describe("placementCourtyardWorldMm", () => {
  test("no courtyard graphics ⇒ null (never a synthesized ring)", () => {
    expect(placementCourtyardWorldMm(placement())).toBeNull();
  });

  test("render-model courtyard is transformed into world space", () => {
    const ring = placementCourtyardWorldMm(
      placement({ __graphics: CRTYD_SQUARE } as never),
    )!;
    expect(ring).toHaveLength(4);
    expect(bounds(ring)).toEqual({ minX: 9, maxX: 11, minY: 9, maxY: 11 });
  });

  test("rotation is applied about the footprint origin", () => {
    const ring = placementCourtyardWorldMm(
      placement({
        __graphics: [{ ...CRTYD_SQUARE[0]!, x: 0, y: -1, width: 4, height: 2 }],
        rotationDeg: 90,
      } as never),
    )!;
    // a 4×2 courtyard offset +x becomes 2×4 offset +y after a 90° CCW rotation
    expect(bounds(ring)).toEqual({ minX: 9, maxX: 11, minY: 10, maxY: 14 });
  });

  test("a mirrored (back-side) placement flips X and stays counter-clockwise", () => {
    const ring = placementCourtyardWorldMm(
      placement({
        __graphics: [{ ...CRTYD_SQUARE[0]!, x: 0, y: -1, width: 4, height: 2 }],
        mirrored: true,
        layer: "B.Cu",
      } as never),
    )!;
    expect(bounds(ring)).toEqual({ minX: 6, maxX: 10, minY: 9, maxY: 11 });
    const area =
      ring.reduce((sum, p, i) => {
        const n = ring[(i + 1) % ring.length]!;
        return sum + (p.x * n.y - n.x * p.y);
      }, 0) / 2;
    expect(area).toBeGreaterThan(0);
  });

  test("KiCad-imported footprints recover their courtyard from the raw record", () => {
    // The importer strips CrtYd before persistence, so the render model has none — the
    // full parsed footprint survives in library_footprints.data_json.raw.
    const raw = {
      raw: {
        graphics: [
          {
            type: "rect",
            layer: "F.CrtYd",
            data: { start: { x: -1.5, y: -1 }, end: { x: 1.5, y: 1 } },
          },
          { type: "line", layer: "F.SilkS", data: { start: { x: -9, y: -9 }, end: { x: 9, y: 9 } } },
        ],
      },
    };
    const ring = placementCourtyardWorldMm(placement(), () => raw)!;
    // silkscreen must not leak into the courtyard
    expect(bounds(ring)).toEqual({ minX: 8.5, maxX: 11.5, minY: 9, maxY: 11 });
  });

  test("the render model wins over the raw record when both have geometry", () => {
    const ring = placementCourtyardWorldMm(
      placement({ __graphics: CRTYD_SQUARE } as never),
      () => ({
        raw: {
          graphics: [
            {
              type: "rect",
              layer: "F.CrtYd",
              data: { start: { x: -50, y: -50 }, end: { x: 50, y: 50 } },
            },
          ],
        },
      }),
    )!;
    expect(bounds(ring).maxX).toBe(11);
  });
});

describe("buildBoardSnapshot courtyards", () => {
  test("emits courtyardPolygon when available and warns when none are", () => {
    const withCourtyard = buildBoardSnapshot(
      projection({ placements: [placement({ __graphics: CRTYD_SQUARE } as never)] }),
      { placeOptions: {} },
    );
    expect(withCourtyard.snapshot.placements![0]!.courtyardPolygon).toHaveLength(4);
    expect(withCourtyard.warnings.join(" ")).not.toContain("courtyard");

    const without = buildBoardSnapshot(projection({ placements: [placement()] }), {
      placeOptions: {},
    });
    // ...and a route-only snapshot stays quiet: the router never reads courtyards.
    const routeOnly = buildBoardSnapshot(projection({ placements: [placement()] }));
    expect(routeOnly.warnings.join(" ")).not.toContain("courtyard");
    expect(without.snapshot.placements![0]!.courtyardPolygon).toBeUndefined();
    expect(without.warnings.join(" ")).toContain("courtyard");
  });
});

describe("computeBoardContentDigest", () => {
  const base = projection({ placements: [placement()] });

  test("is stable across repeated computation", () => {
    expect(computeBoardContentDigest(base)).toBe(computeBoardContentDigest(base));
  });

  test("ignores view-state churn — the whole reason it exists", () => {
    // pcb_set_view_state bumps the revision, so a pan/zoom during a cloud run must NOT
    // invalidate the result.
    const panned = projection({
      placements: [placement()],
      board: {
        ...base.board,
        viewState: { ...base.board.viewState!, viewSide: "bottom" as const },
      },
    });
    expect(computeBoardContentDigest(panned)).toBe(computeBoardContentDigest(base));
  });

  test("ignores derived data and array order", () => {
    const reordered = projection({
      placements: [placement({ id: "U2", reference: "U2" }), placement()],
      netNames: { n1: "GND" },
      ratsnest: [
        {
          netId: "n1",
          netClassId: "default",
          fromMm: { x: 0, y: 0 },
          toMm: { x: 1, y: 1 },
          from: { kind: "pad", placementId: "U1", padNumber: "1" },
          to: { kind: "pad", placementId: "U2", padNumber: "1" },
        },
      ] as never,
    });
    const sameContent = projection({
      placements: [placement(), placement({ id: "U2", reference: "U2" })],
    });
    expect(computeBoardContentDigest(reordered)).toBe(
      computeBoardContentDigest(sameContent),
    );
  });

  test("changes on a real edit", () => {
    const moved = projection({
      placements: [placement({ positionMm: { x: 12, y: 10 } })],
    });
    expect(computeBoardContentDigest(moved)).not.toBe(computeBoardContentDigest(base));

    const rotated = projection({ placements: [placement({ rotationDeg: 90 })] });
    expect(computeBoardContentDigest(rotated)).not.toBe(computeBoardContentDigest(base));

    const flipped = projection({
      placements: [placement({ mirrored: true, layer: "B.Cu" })],
    });
    expect(computeBoardContentDigest(flipped)).not.toBe(computeBoardContentDigest(base));

    const routed = projection({
      placements: [placement()],
      traces: [
        {
          id: "t1",
          layer: "F.Cu",
          widthMm: 0.2,
          netId: "n1",
          netName: "GND",
          netClassId: "default",
          pointsNm: [
            { x: 0, y: 0 },
            { x: 1_000_000, y: 0 },
          ],
          segmentMode: "manhattan-45",
        },
      ] as never,
    });
    expect(computeBoardContentDigest(routed)).not.toBe(computeBoardContentDigest(base));

    const ruled = projection({
      placements: [placement()],
      board: {
        ...base.board,
        designRules: {
          ...base.board.designRules,
          clearance: { ...base.board.designRules.clearance, traceToTraceMm: 0.3 },
        },
      },
    });
    expect(computeBoardContentDigest(ruled)).not.toBe(computeBoardContentDigest(base));
  });
});
