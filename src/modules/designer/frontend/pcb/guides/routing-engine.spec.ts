import { describe, test, expect } from "vitest";
import type {
  PcbCopperLayerId,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../../../sdks";
import { computeRouteGuides } from "./routing-engine";
import { isRayGuide, type RayGuide } from "./guide-types";

const placementWithPad = (
  id: string,
  centerMm: { x: number; y: number },
): PcbPlacedPart => ({
  id,
  partId: "p",
  componentId: "c",
  reference: id,
  positionMm: { x: 0, y: 0 },
  rotationDeg: 0,
  mirrored: false,
  layer: "F.Cu",
  footprint: {
    footprintId: "fp",
    name: "FP",
    mountType: null,
    sourceHash: null,
    preview: {
      kind: "footprint",
      units: "mm",
      name: "FP",
      labels: [],
      warnings: [],
      pads: [{ number: "1", centerMm } as never],
      graphics: [],
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    },
  },
});

const EMPTY = {
  placements: [] as PcbPlacedPart[],
  traces: [] as PcbTrace[],
  vias: [] as PcbVia[],
  activeLayer: "F.Cu" as PcbCopperLayerId,
  netId: null,
  toleranceMm: 0.1,
};

describe("routing-engine", () => {
  test("axis posture emits only horizontal/vertical rays (no 45)", () => {
    const { guides } = computeRouteGuides({
      ...EMPTY,
      anchorMm: { x: 0, y: 0 },
      cursorMm: { x: 5, y: 0.02 }, // near the horizontal ray
      posture: "axis",
    });
    const rays = guides.filter(isRayGuide) as RayGuide[];
    expect(rays.some((r) => r.kind === "ray-axis")).toBe(true);
    expect(rays.some((r) => r.kind === "ray-45")).toBe(false);
  });

  test("diagonal posture emits a 45 ray, no axis ray", () => {
    const { guides } = computeRouteGuides({
      ...EMPTY,
      anchorMm: { x: 0, y: 0 },
      cursorMm: { x: 5, y: 5.02 }, // near the +45 ray
      posture: "diagonal",
    });
    const rays = guides.filter(isRayGuide) as RayGuide[];
    expect(rays.some((r) => r.kind === "ray-45")).toBe(true);
    expect(rays.some((r) => r.kind === "ray-axis")).toBe(false);
  });

  test("horizontal ray snaps the cursor onto the axis", () => {
    const { snapPointMm } = computeRouteGuides({
      ...EMPTY,
      anchorMm: { x: 0, y: 0 },
      cursorMm: { x: 5, y: 0.03 },
      posture: "axis",
    });
    expect(snapPointMm).not.toBeNull();
    expect(snapPointMm!.y).toBeCloseTo(0, 6); // projected onto y=0
    expect(snapPointMm!.x).toBeCloseTo(5, 6);
  });

  test("extend-direction only with a prior vertex", () => {
    const withPrior = computeRouteGuides({
      ...EMPTY,
      anchorMm: { x: 10, y: 0 },
      priorMm: { x: 0, y: 0 }, // last segment ran +x
      cursorMm: { x: 15, y: 0.02 },
      posture: "axis",
    });
    expect(
      (withPrior.guides.filter(isRayGuide) as RayGuide[]).some(
        (r) => r.kind === "extend-direction",
      ),
    ).toBe(true);

    const noPrior = computeRouteGuides({
      ...EMPTY,
      anchorMm: { x: 10, y: 0 },
      cursorMm: { x: 15, y: 0.02 },
      posture: "axis",
    });
    expect(
      (noPrior.guides.filter(isRayGuide) as RayGuide[]).some(
        (r) => r.kind === "extend-direction",
      ),
    ).toBe(false);
  });

  test("collinear-pad line appears when cursor shares a pad column", () => {
    const { guides, snapPointMm } = computeRouteGuides({
      ...EMPTY,
      placements: [placementWithPad("U1", { x: 20, y: 30 })], // pad world (20,30)
      anchorMm: { x: 0, y: 0 },
      cursorMm: { x: 20.04, y: 50 }, // shares X=20 with the pad
      posture: "axis",
    });
    const collinear = guides.find(
      (g) => "axis" in g && g.kind === "collinear-pad",
    );
    expect(collinear).toBeDefined();
    expect(snapPointMm!.x).toBeCloseTo(20, 6);
  });
});
