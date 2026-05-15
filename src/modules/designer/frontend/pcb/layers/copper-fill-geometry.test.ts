import { describe, expect, test } from "vitest";
import type { PcbPlacedPart, PcbTrace, PcbVia } from "../../../../../sdks";
import {
  buildCopperFillGeometrySpec,
  padContributesToCopperLayer,
} from "./copper-fill-geometry";

const outline = {
  kind: "rect" as const,
  widthMm: 20,
  heightMm: 10,
  centerMm: { x: 0, y: 0 },
};

function placement(overrides: Partial<PcbPlacedPart> = {}): PcbPlacedPart {
  return {
    id: "U1-pcb",
    partId: "U1",
    componentId: "component-1",
    reference: "U1",
    positionMm: { x: 2, y: 3 },
    rotationDeg: 90,
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
        pads: [
          {
            id: "pad-1",
            number: "1",
            shape: "rect",
            centerMm: { x: 1, y: 0 },
            widthMm: 1,
            heightMm: 0.5,
            rotationDeg: 0,
            layer: "F.Cu",
          },
        ],
        graphics: [],
        labels: [],
        bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
        warnings: [],
      },
    },
    ...overrides,
  };
}

describe("copper fill geometry", () => {
  test("shrinks fill by copper-to-board-edge clearance", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [],
      traces: [],
      vias: [],
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0.5,
    });

    expect(spec.fill).toEqual({
      center: { x: 0, y: 0 },
      widthMm: 19,
      heightMm: 9,
    });
  });

  test("creates same-layer trace clearance capsules", () => {
    const trace: PcbTrace = {
      id: "trace-1",
      netId: "net-1",
      netClassId: "default",
      layer: "F.Cu",
      widthMm: 0.4,
      pointsNm: [
        { x: 0, y: 0 },
        { x: 4_000_000, y: 0 },
      ],
      segmentMode: "manhattan-90",
    };

    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [],
      traces: [trace],
      vias: [],
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    const cutout = spec.cutouts.find((c) => c.id === "trace:trace-1:0");
    expect(cutout?.positionMm).toEqual({ x: 2, y: 0 });
    expect(cutout?.rotationDeg).toBeCloseTo(0);
    expect(cutout?.shape.getPoints(0).some((p) => p.y > 0.39)).toBe(true);
  });

  test("maps mirrored front pads onto bottom copper", () => {
    const p = placement({ layer: "B.Cu" });
    const pad = p.footprint.preview!.pads[0]!;

    expect(padContributesToCopperLayer(pad, "B.Cu", true)).toBe(true);
    expect(padContributesToCopperLayer(pad, "F.Cu", true)).toBe(false);

    const spec = buildCopperFillGeometrySpec({
      layer: "B.Cu",
      outline,
      placements: [p],
      traces: [],
      vias: [],
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.cutouts.some((c) => c.id === "pad:U1-pcb:pad-1")).toBe(true);
  });

  test("through-vias clear every copper layer", () => {
    const via: PcbVia = {
      id: "via-1",
      netId: "net-1",
      netClassId: "default",
      centerMm: { x: 1, y: 2 },
      diameterMm: 0.8,
      drillMm: 0.4,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
      viaType: "through",
      protection: "tented",
    };

    const spec = buildCopperFillGeometrySpec({
      layer: "In1.Cu",
      outline,
      placements: [],
      traces: [],
      vias: [via],
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    expect(spec.cutouts).toHaveLength(1);
    expect(spec.cutouts[0]?.id).toBe("via:via-1");
  });

  test("adds component-body keepouts on the placement layer", () => {
    const spec = buildCopperFillGeometrySpec({
      layer: "F.Cu",
      outline,
      placements: [placement()],
      traces: [],
      vias: [],
      clearanceMm: 0.2,
      copperToBoardEdgeMm: 0,
    });

    const keepout = spec.cutouts.find((c) => c.id === "placement:U1-pcb");
    expect(keepout?.positionMm).toEqual({ x: 2, y: 3 });
    expect(keepout?.rotationDeg).toBe(90);
  });
});
