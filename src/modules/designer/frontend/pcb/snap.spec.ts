import { describe, test, expect } from "vitest";
import { findSnapTarget } from "./snap";
import type {
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  PcbCopperLayerId,
} from "../../../../sdks";

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
      bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },

    },
  },
  ...overrides,
});

const makeTrace = (overrides: Partial<PcbTrace> = {}): PcbTrace => ({
  id: "t1",
  netId: "net1",
  netClassId: "default",
  layer: "F.Cu",
  widthMm: 0.2,
  pointsNm: [
    { x: 10_000_000, y: 10_000_000 },
    { x: 20_000_000, y: 10_000_000 },
  ],
  segmentMode: "manhattan-90",
  ...overrides,
});

const makeVia = (overrides: Partial<PcbVia> = {}): PcbVia => ({
  id: "v1",
  netId: "net1",
  netClassId: "default",
  centerMm: { x: 15, y: 15 },
  diameterMm: 0.6,
  drillMm: 0.3,
  fromLayer: "F.Cu",
  toLayer: "B.Cu",
  viaType: "through",
  protection: "tented",
  ...overrides,
});

describe("snap", () => {
  describe("findSnapTarget", () => {
    test("returns null when no primitives are near cursor", () => {
      const placements: PcbPlacedPart[] = [];
      const traces: PcbTrace[] = [];
      const vias: PcbVia[] = [];
      const cursorMm = { x: 0, y: 0 };
      const toleranceMm = 1;
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = findSnapTarget({
        cursorMm,
        toleranceMm,
        placements,
        traces,
        vias,
        activeLayer,
      });

      expect(result).toBeNull();
    });

    test("returns pad-center when cursor is near a pad", () => {
      const placements = [
        makePlacement({
          id: "p1",
          positionMm: { x: 10, y: 10 },
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
                  centerMm: { x: 0, y: 0 },
                  widthMm: 2,
                  heightMm: 2,
                  shape: "rect",
                  layer: "F.Cu",
                },
              ],
              graphics: [],
              bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
            },
          },
        }),
      ];
      const traces: PcbTrace[] = [];
      const vias: PcbVia[] = [];
      const cursorMm = { x: 10.2, y: 10.2 };
      const toleranceMm = 1;
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = findSnapTarget({
        cursorMm,
        toleranceMm,
        placements,
        traces,
        vias,
        activeLayer,
      });

      expect(result).not.toBeNull();
      expect(result!.kind).toBe("pad-center");
      expect(result!.pointMm.x).toBeCloseTo(10, 1);
      expect(result!.pointMm.y).toBeCloseTo(10, 1);

    });

    test("returns trace-endpoint when cursor is near trace start/end", () => {
      const placements: PcbPlacedPart[] = [];
      const traces = [
        makeTrace({
          id: "t1",
          pointsNm: [
            { x: 10_000_000, y: 10_000_000 },
            { x: 20_000_000, y: 10_000_000 },
          ],
        }),
      ];
      const vias: PcbVia[] = [];
      const cursorMm = { x: 10.1, y: 10.1 };
      const toleranceMm = 1;
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = findSnapTarget({
        cursorMm,
        toleranceMm,
        placements,
        traces,
        vias,
        activeLayer,
      });

      expect(result).not.toBeNull();
      expect(result!.kind).toBe("trace-endpoint");
    });

    test("returns via-center when cursor is near a via", () => {
      const placements: PcbPlacedPart[] = [];
      const traces: PcbTrace[] = [];
      const vias = [makeVia({ id: "v1", centerMm: { x: 15, y: 15 } })];
      const cursorMm = { x: 15.2, y: 15.2 };
      const toleranceMm = 1;
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = findSnapTarget({
        cursorMm,
        toleranceMm,
        placements,
        traces,
        vias,
        activeLayer,
      });

      expect(result).not.toBeNull();
      expect(result!.kind).toBe("via-center");
      expect(result!.pointMm.x).toBeCloseTo(15, 1);
      expect(result!.pointMm.y).toBeCloseTo(15, 1);
    });

    test("respects activeLayer for trace endpoint snap", () => {
      const placements: PcbPlacedPart[] = [];
      const traces = [
        makeTrace({
          layer: "B.Cu",
          pointsNm: [
            { x: 10_000_000, y: 10_000_000 },
            { x: 20_000_000, y: 10_000_000 },
          ],
        }),
      ];
      const vias: PcbVia[] = [];
      const cursorMm = { x: 10.1, y: 10.1 };
      const toleranceMm = 1;
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = findSnapTarget({
        cursorMm,
        toleranceMm,
        placements,
        traces,
        vias,
        activeLayer,
      });

      expect(result).toBeNull();
    });

    test("respects options.snapPads = false", () => {
      const placements = [
        makePlacement({
          id: "p1",
          positionMm: { x: 10, y: 10 },
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
                  centerMm: { x: 0, y: 0 },
                  widthMm: 2,
                  heightMm: 2,
                  shape: "rect",
                  layer: "F.Cu",
                },
              ],
              graphics: [],
              bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
            },
          },
        }),
      ];
      const traces = [
        makeTrace({
          pointsNm: [
            { x: 10_000_000, y: 10_000_000 },
            { x: 20_000_000, y: 10_000_000 },
          ],
        }),
      ];
      const vias: PcbVia[] = [];
      const cursorMm = { x: 10.1, y: 10.1 };
      const toleranceMm = 1;
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = findSnapTarget({
        cursorMm,
        toleranceMm,
        placements,
        traces,
        vias,
        activeLayer,
        options: { snapPads: false },
      });

      expect(result).not.toBeNull();
      expect(result!.kind).toBe("trace-endpoint");

    });

    test("respects options.snapTraceEndpoints = false", () => {
      const placements: PcbPlacedPart[] = [];
      const traces = [
        makeTrace({
          pointsNm: [
            { x: 10_000_000, y: 10_000_000 },
            { x: 20_000_000, y: 10_000_000 },
          ],
        }),
      ];
      const vias = [makeVia({ centerMm: { x: 10, y: 10 } })];
      const cursorMm = { x: 10.1, y: 10.1 };
      const toleranceMm = 1;
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = findSnapTarget({
        cursorMm,
        toleranceMm,
        placements,
        traces,
        vias,
        activeLayer,
        options: { snapTraceEndpoints: false },
      });

      expect(result).not.toBeNull();
      expect(result!.kind).toBe("via-center");
    });

    test("respects options.snapVias = false", () => {
      const placements: PcbPlacedPart[] = [];
      const traces: PcbTrace[] = [];
      const vias = [makeVia({ centerMm: { x: 10, y: 10 } })];
      const cursorMm = { x: 10.1, y: 10.1 };
      const toleranceMm = 1;
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = findSnapTarget({
        cursorMm,
        toleranceMm,
        placements,
        traces,
        vias,
        activeLayer,
        options: { snapVias: false },
      });

      expect(result).toBeNull();
    });

    test("tie-break: pad-center beats trace-endpoint beats via-center", () => {
      const placements = [
        makePlacement({
          id: "p1",
          positionMm: { x: 10, y: 10 },
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
                  centerMm: { x: 0, y: 0 },
                  widthMm: 2,
                  heightMm: 2,
                  shape: "rect",
                  layer: "F.Cu",
                },
              ],
              graphics: [],
              bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
            },
          },
        }),
      ];
      const traces = [
        makeTrace({
          pointsNm: [
            { x: 10_000_000, y: 10_000_000 },
            { x: 20_000_000, y: 10_000_000 },
          ],
        }),
      ];
      const vias = [makeVia({ centerMm: { x: 10, y: 10 } })];
      const cursorMm = { x: 10.05, y: 10.05 };
      const toleranceMm = 1;
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = findSnapTarget({
        cursorMm,
        toleranceMm,
        placements,
        traces,
        vias,
        activeLayer,
      });

      expect(result).not.toBeNull();
      expect(result!.kind).toBe("pad-center");

    });
  });
});
