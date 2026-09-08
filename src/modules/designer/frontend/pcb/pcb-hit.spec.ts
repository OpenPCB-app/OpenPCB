import { describe, test, expect } from "vitest";
import {
  hitAll,
  hitTrace,
  hitVia,
  hitPlacement,
  hitPad,
  hitKeepout,
  hitZone,
  zoneRings,
  padCopperLayer,
} from "./pcb-hit";
import type {
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  PcbCopperLayerId,
  PcbKeepout,
  PcbZone,
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

    test("reports the clicked pad's copper layer", () => {
      const placements = [
        makePlacement({
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

      expect(hitPad(placements, { x: 10, y: 10 })?.layer).toBe("F.Cu");
    });
  });

  describe("padCopperLayer", () => {
    const frontPlacement = makePlacement({ layer: "F.Cu" });
    const backPlacement = makePlacement({ layer: "B.Cu" });

    test("SMD pad on a front placement → F.Cu", () => {
      expect(padCopperLayer(frontPlacement, { layer: "F.Cu" })).toBe("F.Cu");
    });

    test("SMD pad on a back placement flips F↔B → B.Cu", () => {
      expect(padCopperLayer(backPlacement, { layer: "F.Cu" })).toBe("B.Cu");
    });

    test("SMD pad with no explicit layer defaults to the front side", () => {
      expect(padCopperLayer(frontPlacement, {})).toBe("F.Cu");
      expect(padCopperLayer(backPlacement, {})).toBe("B.Cu");
    });

    test("through-hole pad (has drill) spans all layers → null", () => {
      expect(
        padCopperLayer(frontPlacement, { layer: "F.Cu", drillDiameterMm: 0.8 }),
      ).toBeNull();
    });
  });

  describe("hitZone / hitKeepout", () => {
    const SQUARE = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    const makeZone = (overrides: Partial<PcbZone> = {}): PcbZone => ({
      id: "zone-1",
      name: null,
      enabled: true,
      lockedAt: null,
      layer: "F.Cu",
      netId: null,
      netName: null,
      region: { kind: "polygon", pointsMm: SQUARE },
      priority: 0,
      ...overrides,
    });

    const makeKeepout = (
      overrides: Partial<PcbKeepout> = {},
    ): PcbKeepout => ({
      id: "keepout-1",
      name: null,
      enabled: true,
      lockedAt: null,
      layers: ["F.Cu"],
      pointsMm: SQUARE,
      restrictions: {
        tracks: true,
        vias: true,
        pads: true,
        copperPour: true,
        footprints: true,
      },
      ...overrides,
    });

    const allowAll = () => true;

    test("hitZone finds a point near the ring edge", () => {
      const zone = makeZone();
      const hit = hitZone([zone], { x: 5, y: 0.1 }, {
        toleranceMm: 0.5,
        layerAllowed: allowAll,
        activeLayer: null,
      });
      expect(hit?.zone).toBe(zone);
      expect(hit?.ringIndex).toBe(0);
    });

    test("hitZone misses the interior — edge-only, never point-in-polygon", () => {
      const zone = makeZone();
      const hit = hitZone([zone], { x: 5, y: 5 }, {
        toleranceMm: 0.5,
        layerAllowed: allowAll,
        activeLayer: null,
      });
      expect(hit).toBeNull();
    });

    test("hitZone skips a board-region zone", () => {
      const board = makeZone({ region: { kind: "board" } });
      const hit = hitZone([board], { x: 5, y: 0.1 }, {
        toleranceMm: 0.5,
        layerAllowed: allowAll,
        activeLayer: null,
      });
      expect(hit).toBeNull();
    });

    test("hitZone respects layerAllowed", () => {
      const zone = makeZone({ layer: "B.Cu" });
      const hit = hitZone([zone], { x: 5, y: 0.1 }, {
        toleranceMm: 0.5,
        layerAllowed: (l) => l === "F.Cu",
        activeLayer: null,
      });
      expect(hit).toBeNull();
    });

    test("hitZone stays hittable when disabled", () => {
      const zone = makeZone({ enabled: false });
      const hit = hitZone([zone], { x: 5, y: 0.1 }, {
        toleranceMm: 0.5,
        layerAllowed: allowAll,
        activeLayer: null,
      });
      expect(hit?.zone).toBe(zone);
    });

    test("hitZone prefers the active layer over a closer edge on another layer", () => {
      const front = makeZone({ id: "z-front", layer: "F.Cu" });
      const back = makeZone({
        id: "z-back",
        layer: "B.Cu",
        // Bottom edge sits exactly on the cursor — strictly closer than
        // front's (distance 0.02) — yet the active-layer preference must
        // still pick `front`.
        region: {
          kind: "polygon",
          pointsMm: [
            { x: 0, y: 0.02 },
            { x: 10, y: 0.02 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      });
      const hit = hitZone([front, back], { x: 5, y: 0.02 }, {
        toleranceMm: 0.5,
        layerAllowed: allowAll,
        activeLayer: "F.Cu",
      });
      expect(hit?.zone).toBe(front);
    });

    // Cutout rings are hit like the outer ring, addressed by `ringIndex`
    // (copper-pour contract §11) — that index is what the vertex tools edit.
    test("hitZone reports ringIndex i+1 for the i-th cutout", () => {
      const zone = makeZone({
        region: {
          kind: "polygon",
          pointsMm: SQUARE,
          holesMm: [
            [
              { x: 2, y: 2 },
              { x: 4, y: 2 },
              { x: 4, y: 4 },
              { x: 2, y: 4 },
            ],
            [
              { x: 6, y: 6 },
              { x: 8, y: 6 },
              { x: 8, y: 8 },
              { x: 6, y: 8 },
            ],
          ],
        },
      });
      const opts = {
        toleranceMm: 0.5,
        layerAllowed: allowAll,
        activeLayer: null,
      };
      expect(hitZone([zone], { x: 3, y: 2.1 }, opts)?.ringIndex).toBe(1);
      expect(hitZone([zone], { x: 7, y: 6.1 }, opts)?.ringIndex).toBe(2);
      expect(hitZone([zone], { x: 5, y: 0.1 }, opts)?.ringIndex).toBe(0);
      // Still no interior hit: inside the cutout is inside no ring.
      expect(hitZone([zone], { x: 3, y: 3 }, opts)).toBeNull();
    });

    test("zoneRings lists the outer ring first, then each cutout", () => {
      const hole = [
        { x: 2, y: 2 },
        { x: 4, y: 2 },
        { x: 4, y: 4 },
        { x: 2, y: 4 },
      ];
      expect(
        zoneRings(
          makeZone({
            region: { kind: "polygon", pointsMm: SQUARE, holesMm: [hole] },
          }),
        ),
      ).toEqual([SQUARE, hole]);
      expect(zoneRings(makeZone({ region: { kind: "board" } }))).toEqual([]);
    });

    test("hitKeepout allowed when any of its layers passes layerAllowed", () => {
      const keepout = makeKeepout({ layers: ["In1.Cu", "F.Cu"] });
      const hit = hitKeepout([keepout], { x: 5, y: 0.1 }, {
        toleranceMm: 0.5,
        layerAllowed: (l) => l === "F.Cu",
        activeLayer: null,
      });
      expect(hit).toBe(keepout);
    });

    test("hitKeepout is null when no layer passes layerAllowed", () => {
      const keepout = makeKeepout({ layers: ["In1.Cu"] });
      const hit = hitKeepout([keepout], { x: 5, y: 0.1 }, {
        toleranceMm: 0.5,
        layerAllowed: (l) => l === "F.Cu",
        activeLayer: null,
      });
      expect(hit).toBeNull();
    });

    test("hitAll orders zone/keepout hits after placements", () => {
      const placement = makePlacement();
      const zone = makeZone({ layer: "F.Cu" });
      const keepout = makeKeepout({ layers: ["F.Cu"] });
      const candidates = hitAll({
        placements: [placement],
        traces: [],
        vias: [],
        cursorMm: { x: 5, y: 0.1 },
        activeLayer: "F.Cu",
        zones: [zone],
        keepouts: [keepout],
      });
      expect(candidates.map((c) => c.kind)).toEqual([
        "placement",
        "zone",
        "keepout",
      ]);
    });

    test("hitAll finds no zone/keepout when the arrays are omitted", () => {
      const candidates = hitAll({
        placements: [],
        traces: [],
        vias: [],
        cursorMm: { x: 5, y: 0.1 },
        activeLayer: "F.Cu",
      });
      expect(candidates).toEqual([]);
    });
  });
});
