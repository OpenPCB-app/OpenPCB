import { describe, expect, test } from "vitest";
import type { DesignerPcbProjection, PcbPlacedPart, PcbVia } from "../../../../../sdks";
import {
  boardOutlineBoundsMm,
  boardOutlineToShape,
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
    expect(placement.footprint.preview?.pads[0]?.centerMm).toEqual({ x: -1, y: 0 });
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
