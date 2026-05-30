import { describe, expect, test } from "vitest";
import type { PcbPlacedPart, PcbTrace } from "../../../../sdks";
import type { FootprintRenderSourcePad } from "../../../../shared/rendering";
import { buildPadNetIds } from "./pcb-pad-nets";

const NM = 1_000_000; // mm → nm

function pad(
  number: string,
  centerMm: { x: number; y: number },
): FootprintRenderSourcePad {
  return {
    id: `pad-${number}`,
    number,
    shape: "rect",
    centerMm,
    widthMm: 1,
    heightMm: 1,
    rotationDeg: 0,
    layer: "F.Cu",
  };
}

function placement(
  overrides: Partial<PcbPlacedPart> = {},
  pads: FootprintRenderSourcePad[] = [pad("1", { x: 3, y: 0 })],
): PcbPlacedPart {
  return {
    id: "U1",
    partId: "p1",
    componentId: "c1",
    reference: "U1",
    positionMm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    layer: "F.Cu",
    footprint: {
      footprintId: "fp1",
      name: "FP",
      mountType: "smd",
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads,
        graphics: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
    ...overrides,
  };
}

function trace(endMm: { x: number; y: number }, netId: string): PcbTrace {
  return {
    id: `t-${netId}`,
    netId,
    netClassId: "default",
    layer: "F.Cu",
    widthMm: 0.25,
    pointsNm: [
      { x: -10 * NM, y: -10 * NM },
      { x: endMm.x * NM, y: endMm.y * NM },
    ],
    segmentMode: "manhattan-90",
  };
}

describe("buildPadNetIds", () => {
  test("resolves a pad net from a trace endpoint on a TOP placement", () => {
    // F.Cu placement, pad local (3,0), no mirror → world (3,0).
    const map = buildPadNetIds(
      [],
      [placement()],
      [trace({ x: 3, y: 0 }, "N1")],
    );
    expect(map.get("U1|1")).toBe("N1");
  });

  test("resolves a B.Cu placement pad via its MIRRORED world centre (NEW-1)", () => {
    // B.Cu placement mirrors X (placementMirrorX), so pad local (3,0) → (-3,0).
    // Regression: with `mirrored`-only the index used (3,0) and never matched.
    const map = buildPadNetIds(
      [],
      [placement({ layer: "B.Cu" })],
      [trace({ x: -3, y: 0 }, "GND")],
    );
    expect(map.get("U1|1")).toBe("GND");
  });

  test("a trace at the UN-mirrored B.Cu position does NOT match", () => {
    const map = buildPadNetIds(
      [],
      [placement({ layer: "B.Cu" })],
      [trace({ x: 3, y: 0 }, "GND")],
    );
    expect(map.get("U1|1")).toBeUndefined();
  });

  test("ratsnest endpoints resolve nets directly (no coordinate math)", () => {
    const map = buildPadNetIds(
      [
        {
          netId: "VCC",
          netClassId: "power",
          fromMm: { x: 0, y: 0 },
          toMm: { x: 1, y: 1 },
          fromPlacementId: "U1",
          fromPadNumber: "1",
          toPlacementId: "U2",
          toPadNumber: "3",
        },
      ],
      [],
      [],
    );
    expect(map.get("U1|1")).toBe("VCC");
    expect(map.get("U2|3")).toBe("VCC");
  });
});
