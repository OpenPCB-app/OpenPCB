import { describe, expect, test } from "vitest";
import type { PcbFreePad, PcbPlacedPart, PcbTrace, PcbVia } from "../../../../sdks";
import { findMeasureSnapTarget } from "./measure-snap";

const makePlacement = (
  overrides: Partial<PcbPlacedPart> = {},
): PcbPlacedPart => ({
  id: "p1",
  partId: "part1",
  componentId: "c1",
  reference: "U1",
  positionMm: { x: 10, y: 10 },
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
      pads: [
        {
          id: "pad1",
          number: "1",
          rotationDeg: 0,
          centerMm: { x: 2, y: 0 },
          widthMm: 1,
          heightMm: 1,
          shape: "rect",
          layer: "F.Cu",
        },
      ],
      graphics: [],
      bounds: { minX: -2, maxX: 3, minY: -1, maxY: 1 },
    },
  },
  ...overrides,
});

const makeTrace = (overrides: Partial<PcbTrace> = {}): PcbTrace => ({
  id: "t1",
  netId: null,
  netClassId: "default",
  layer: "F.Cu",
  widthMm: 0.2,
  pointsNm: [
    { x: 0, y: 0 },
    { x: 5_000_000, y: 0 },
  ],
  segmentMode: "manhattan-90",
  ...overrides,
});

const makeVia = (overrides: Partial<PcbVia> = {}): PcbVia => ({
  id: "v1",
  netId: null,
  netClassId: "default",
  centerMm: { x: 20, y: 20 },
  diameterMm: 0.6,
  drillMm: 0.3,
  fromLayer: "F.Cu",
  toLayer: "B.Cu",
  viaType: "through",
  protection: "tented",
  provenance: "route",
  ...overrides,
});

const makeFreePad = (overrides: Partial<PcbFreePad> = {}): PcbFreePad => ({
  id: "fp1",
  centerMm: { x: 30, y: 30 },
  rotationDeg: 0,
  padType: "smd",
  shape: "rect",
  widthMm: 1,
  heightMm: 1,
  drillMm: null,
  layer: "F.Cu",
  netId: null,
  solderMaskExpansionMm: null,
  solderPasteExpansionMm: null,
  lockedAt: null,
  ...overrides,
});

describe("findMeasureSnapTarget", () => {
  test("snaps to footprint origin", () => {
    const target = findMeasureSnapTarget({
      cursorMm: { x: 10.1, y: 9.9 },
      toleranceMm: 0.5,
      placements: [makePlacement()],
      traces: [],
      vias: [],
      freePads: [],
      activeLayer: "F.Cu",
    });

    expect(target?.kind).toBe("footprint-origin");
    expect(target?.pointMm).toEqual({ x: 10, y: 10 });
  });

  test("pad center outranks nearby footprint origin", () => {
    const target = findMeasureSnapTarget({
      cursorMm: { x: 11.9, y: 10 },
      toleranceMm: 3,
      placements: [makePlacement()],
      traces: [],
      vias: [],
      freePads: [],
      activeLayer: "F.Cu",
    });

    expect(target?.kind).toBe("pad-center");
    expect(target?.pointMm).toEqual({ x: 12, y: 10 });
  });

  test("handles rotated placement pad centers", () => {
    const target = findMeasureSnapTarget({
      cursorMm: { x: 10, y: 12.1 },
      toleranceMm: 0.5,
      placements: [makePlacement({ rotationDeg: 90 })],
      traces: [],
      vias: [],
      freePads: [],
      activeLayer: "F.Cu",
    });

    expect(target?.kind).toBe("pad-center");
    expect(target?.pointMm).toEqual({ x: 10, y: 12 });
  });

  test("snaps to trace vertices, vias, and free pad centers", () => {
    const traceTarget = findMeasureSnapTarget({
      cursorMm: { x: 5.1, y: 0 },
      toleranceMm: 0.5,
      placements: [],
      traces: [makeTrace()],
      vias: [],
      freePads: [],
      activeLayer: "F.Cu",
    });
    expect(traceTarget?.kind).toBe("trace-point");
    expect(traceTarget?.pointMm).toEqual({ x: 5, y: 0 });

    const viaTarget = findMeasureSnapTarget({
      cursorMm: { x: 20, y: 20.2 },
      toleranceMm: 0.5,
      placements: [],
      traces: [],
      vias: [makeVia()],
      freePads: [],
      activeLayer: "F.Cu",
    });
    expect(viaTarget?.kind).toBe("via-center");

    const freePadTarget = findMeasureSnapTarget({
      cursorMm: { x: 30.2, y: 30 },
      toleranceMm: 0.5,
      placements: [],
      traces: [],
      vias: [],
      freePads: [makeFreePad()],
      activeLayer: "F.Cu",
    });
    expect(freePadTarget?.kind).toBe("free-pad-center");
  });
});
