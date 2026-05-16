import { describe, test, expect } from "vitest";
import { hitAll, hitTrace, hitVia, hitPlacement, hitPad } from "./pcb-hit";
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
      name: "R_0805",
      pads: [],
      graphics: [],
      labels: [],
      bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
      warnings: [],
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
  provenance: "route",
  ...overrides,
});

describe("pcb-hit", () => {
  describe("hitAll", () => {
    test("returns ordered candidate list", () => {
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
          id: "t1",
          pointsNm: [
            { x: 10_000_000, y: 10_000_000 },
            { x: 20_000_000, y: 10_000_000 },
          ],
        }),
      ];
      const vias = [makeVia({ id: "v1", centerMm: { x: 10, y: 10 } })];
      const cursorMm = { x: 10, y: 10 };
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = hitAll({
        placements,
        traces,
        vias,
        cursorMm,
        activeLayer,
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]!.kind).toBe("pad");
    });

    test("excludes traces on non-visible layers", () => {
      const placements: PcbPlacedPart[] = [];
      const traces = [makeTrace({ layer: "B.Cu" })];
      const vias: PcbVia[] = [];
      const cursorMm = { x: 15, y: 10 };
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = hitAll({
        placements,
        traces,
        vias,
        cursorMm,
        activeLayer,
      });

      const traceHits = result.filter((c) => c.kind === "trace");
      expect(traceHits).toHaveLength(0);
    });

    test("excludes vias when not visible (hitAll includes all vias)", () => {
      const placements: PcbPlacedPart[] = [];
      const traces: PcbTrace[] = [];
      const vias = [makeVia({ centerMm: { x: 10, y: 10 } })];
      const cursorMm = { x: 10, y: 10 };
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = hitAll({
        placements,
        traces,
        vias,
        cursorMm,
        activeLayer,
      });

      const viaHits = result.filter((c) => c.kind === "via");
      expect(viaHits).toHaveLength(1);
    });

    test("returns candidates in priority order: pad > trace > via > placement", () => {
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
          id: "t1",
          pointsNm: [
            { x: 10_000_000, y: 10_000_000 },
            { x: 20_000_000, y: 10_000_000 },
          ],
        }),
      ];
      const vias = [makeVia({ id: "v1", centerMm: { x: 10, y: 10 } })];
      const cursorMm = { x: 10, y: 10 };
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = hitAll({
        placements,
        traces,
        vias,
        cursorMm,
        activeLayer,
      });

      expect(result[0]!.kind).toBe("pad");
      const traceIdx = result.findIndex((c) => c.kind === "trace");
      const viaIdx = result.findIndex((c) => c.kind === "via");
      const placementIdx = result.findIndex((c) => c.kind === "placement");
      expect(traceIdx).toBeGreaterThan(0);
      expect(viaIdx).toBeGreaterThan(traceIdx);
      expect(placementIdx).toBeGreaterThan(viaIdx);
    });
  });

  describe("hitTrace", () => {
    test("returns null when cursor is far from trace", () => {
      const traces = [
        makeTrace({
          pointsNm: [
            { x: 10_000_000, y: 10_000_000 },
            { x: 20_000_000, y: 10_000_000 },
          ],
        }),
      ];
      const cursorMm = { x: 0, y: 0 };
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = hitTrace(traces, cursorMm, activeLayer);

      expect(result).toBeNull();
    });

    test("respects activeLayer (only traces on that layer)", () => {
      const traces = [
        makeTrace({
          layer: "F.Cu",
          pointsNm: [
            { x: 10_000_000, y: 10_000_000 },
            { x: 20_000_000, y: 10_000_000 },
          ],
        }),
        makeTrace({
          id: "t2",
          layer: "B.Cu",
          pointsNm: [
            { x: 10_000_000, y: 10_000_000 },
            { x: 20_000_000, y: 10_000_000 },
          ],
        }),
      ];
      const cursorMm = { x: 15, y: 10 };
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = hitTrace(traces, cursorMm, activeLayer);

      expect(result).not.toBeNull();
      expect(result!.trace.layer).toBe("F.Cu");
    });

    test("returns trace hit when cursor is near trace", () => {
      const traces = [
        makeTrace({
          widthMm: 0.2,
          pointsNm: [
            { x: 10_000_000, y: 10_000_000 },
            { x: 20_000_000, y: 10_000_000 },
          ],
        }),
      ];
      const cursorMm = { x: 15, y: 10.1 };
      const activeLayer: PcbCopperLayerId = "F.Cu";

      const result = hitTrace(traces, cursorMm, activeLayer);

      expect(result).not.toBeNull();
      expect(result!.trace.id).toBe("t1");
    });
  });

  describe("hitVia", () => {
    test("returns nearest via within tolerance", () => {
      const vias = [
        makeVia({ id: "v1", centerMm: { x: 10, y: 10 }, diameterMm: 0.6 }),
        makeVia({ id: "v2", centerMm: { x: 30, y: 30 }, diameterMm: 0.6 }),
      ];
      const cursorMm = { x: 10.2, y: 10.2 };

      const result = hitVia(vias, cursorMm);

      expect(result).not.toBeNull();
      expect(result!.id).toBe("v1");
    });

    test("returns null when cursor is outside via", () => {
      const vias = [makeVia({ centerMm: { x: 10, y: 10 }, diameterMm: 0.6 })];
      const cursorMm = { x: 20, y: 20 };

      const result = hitVia(vias, cursorMm);

      expect(result).toBeNull();
    });
  });

  describe("hitPlacement", () => {
    test("returns placement whose bounding box contains cursor", () => {
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
              pads: [],
              graphics: [],
              bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
            },
          },
        }),
      ];
      const cursorMm = { x: 12, y: 12 };

      const result = hitPlacement(placements, cursorMm);

      expect(result).not.toBeNull();
      expect(result!.id).toBe("p1");
    });

    test("returns null when cursor is outside bounding box", () => {
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
              pads: [],
              graphics: [],
              bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
            },
          },
        }),
      ];
      const cursorMm = { x: 20, y: 20 };

      const result = hitPlacement(placements, cursorMm);

      expect(result).toBeNull();
    });
  });

  describe("hitPad", () => {
    test("returns pad hit when cursor is near pad", () => {
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
      const cursorMm = { x: 10.5, y: 10.5 };

      const result = hitPad(placements, cursorMm);

      expect(result).not.toBeNull();
      expect(result!.placementId).toBe("p1");
      expect(result!.padNumber).toBe("1");
    });

    test("returns null when cursor is far from pad", () => {
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
      const cursorMm = { x: 50, y: 50 };

      const result = hitPad(placements, cursorMm);

      expect(result).toBeNull();
    });
  });
});
