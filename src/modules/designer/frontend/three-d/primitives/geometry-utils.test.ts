import { describe, expect, test } from "vitest";
import type {
  DesignerPcbProjection,
  PcbPlacedPart,
  PcbVia,
} from "../../../../../sdks";
import {
  boardOutlineBoundsMm,
  boardOutlineToShape,
  boardSubstrateShape,
  nmToMm,
  padsToMeshInputs,
  tracePointsToMeshSegments,
  traceToMeshInputs,
  viasToMeshInputs,
} from "./geometry-utils";

describe("3D board geometry utilities", () => {
  test("converts nanometers to millimeters", () => {
    expect(nmToMm(1_000_000)).toBe(1);
    expect(nmToMm(-2_540_000)).toBe(-2.54);
  });

  test("converts trace polylines into mesh segments", () => {
    const segments = tracePointsToMeshSegments(
      [
        { x: 0, y: 0 },
        { x: 1_000_000, y: 0 },
        { x: 1_000_000, y: 2_000_000 },
      ],
      0.25,
    );

    expect(segments).toEqual([
      {
        startMm: { x: 0, y: 0 },
        endMm: { x: 1, y: 0 },
        widthMm: 0.25,
      },
      {
        startMm: { x: 1, y: 0 },
        endMm: { x: 1, y: 2 },
        widthMm: 0.25,
      },
    ]);
  });

  test("adds length, center, and angle for trace mesh inputs", () => {
    const [segment] = traceToMeshInputs({
      id: "trace-1",
      netId: "net-1",
      netClassId: "default",
      layer: "F.Cu",
      widthMm: 0.5,
      pointsNm: [
        { x: 0, y: 0 },
        { x: 3_000_000, y: 4_000_000 },
      ],
      segmentMode: "manhattan-45",
    });

    expect(segment).toMatchObject({
      id: "trace-1:0",
      traceId: "trace-1",
      centerMm: { x: 1.5, y: 2 },
      lengthMm: 5,
      widthMm: 0.5,
    });
    expect(segment?.angleRad).toBeCloseTo(Math.atan2(4, 3));
  });

  test("calculates board outline bounds and shape points", () => {
    const outline: DesignerPcbProjection["board"]["outline"] = {
      kind: "rect",
      widthMm: 20,
      heightMm: 10,
      centerMm: { x: 5, y: -2 },
    };

    expect(boardOutlineBoundsMm(outline)).toEqual({
      minX: -5,
      minY: -7,
      maxX: 15,
      maxY: 3,
    });

    const points = boardOutlineToShape(outline).getPoints();
    expect(points[0]).toMatchObject({ x: -5, y: -7 });
    expect(points[2]).toMatchObject({ x: 15, y: 3 });
  });

  test("creates pad mesh inputs without mutating placement data", () => {
    const placement = {
      id: "U1-pcb",
      partId: "U1",
      componentId: "component-1",
      reference: "U1",
      positionMm: { x: 10, y: 20 },
      rotationDeg: 90,
      mirrored: false,
      layer: "B.Cu",
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
              centerMm: { x: -1, y: 0 },
              widthMm: 1.2,
              heightMm: 0.6,
              rotationDeg: 0,
              layer: "F.Cu",
            },
          ],
          graphics: [],
          labels: [],
          bounds: null,
          warnings: [],
        },
      },
    } satisfies PcbPlacedPart;

    const inputs = padsToMeshInputs([placement]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      id: "U1-pcb:pad-1",
      placementId: "U1-pcb",
      layer: "B.Cu",
      zSurfaceMm: -1.6,
    });
    expect(placement.footprint.preview?.pads[0]?.centerMm).toEqual({
      x: -1,
      y: 0,
    });
  });

  test("punches one substrate hole per in-board drill, skips out-of-bounds", () => {
    const projection = {
      designId: "d",
      revision: 1,
      board: {
        outline: {
          kind: "rect",
          widthMm: 20,
          heightMm: 10,
          centerMm: { x: 0, y: 0 },
        },
      },
      placements: [
        {
          id: "J1-pcb",
          partId: "J1",
          componentId: "c1",
          reference: "J1",
          positionMm: { x: 0, y: 0 },
          rotationDeg: 0,
          mirrored: false,
          layer: "F.Cu",
          footprint: {
            footprintId: "fp",
            name: "PinHeader",
            mountType: "thru_hole",
            sourceHash: null,
            preview: {
              kind: "footprint",
              units: "mm",
              name: "PinHeader",
              pads: [
                {
                  id: "pad-1",
                  number: "1",
                  shape: "circle",
                  centerMm: { x: 0, y: 0 },
                  widthMm: 1.7,
                  heightMm: 1.7,
                  rotationDeg: 0,
                  drillDiameterMm: 1.0,
                  layer: "F.Cu",
                },
                {
                  id: "pad-2",
                  number: "2",
                  shape: "rect",
                  centerMm: { x: 2.54, y: 0 },
                  widthMm: 1.5,
                  heightMm: 1.5,
                  rotationDeg: 0,
                  layer: "F.Cu",
                },
              ],
              graphics: [],
              labels: [],
              bounds: null,
              warnings: [],
            },
          },
        },
      ],
      traces: [],
      vias: [
        {
          id: "via-1",
          netId: "n1",
          netClassId: "default",
          centerMm: { x: 5, y: 2 },
          diameterMm: 0.6,
          drillMm: 0.4,
          fromLayer: "F.Cu",
          toLayer: "B.Cu",
          viaType: "through",
          protection: "tented",
        },
      ],
      freeHoles: [
        // Outside the 20×10 board → must be skipped by the bbox guard.
        { id: "h1", centerMm: { x: 100, y: 100 }, drillMm: 2 },
      ],
      freePads: [],
      overlayTexts: [],
      overlayShapes: [],
      zones: [],
      ratsnest: [],
      netNames: {},
      warnings: [],
    } as unknown as DesignerPcbProjection;

    const shape = boardSubstrateShape(projection);
    // pad-1 drill + via-1 drill = 2; pad-2 (SMD, no drill) and the off-board
    // free hole contribute nothing.
    expect(shape.holes).toHaveLength(2);
  });

  test("creates via mesh inputs with safe defaults", () => {
    const vias: PcbVia[] = [
      {
        id: "via-1",
        netId: "net-1",
        netClassId: "default",
        centerMm: { x: 2, y: 3 },
        diameterMm: 0,
        drillMm: 0,
        fromLayer: "F.Cu",
        toLayer: "B.Cu",
        viaType: "through",
        protection: "tented",
      },
    ];

    expect(viasToMeshInputs(vias)).toEqual([
      {
        id: "via-1",
        centerMm: { x: 2, y: 3 },
        diameterMm: 0.6,
        drillMm: 0.3,
      },
    ]);
  });
});
