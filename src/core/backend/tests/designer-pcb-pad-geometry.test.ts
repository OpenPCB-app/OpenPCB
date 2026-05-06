import { describe, expect, test } from "bun:test";
import {
  padWorldPositionMm,
  transformPadCenterMm,
} from "../../../modules/designer/backend/pcb/pad-geometry";
import type { PcbPlacedPart } from "../../../sdks/designer";

const localPad = { x: 2, y: 1 };

describe("transformPadCenterMm", () => {
  test("identity: 0deg, no mirror", () => {
    expect(transformPadCenterMm(localPad, 0, false)).toEqual({ x: 2, y: 1 });
  });
  test("90deg, no mirror", () => {
    expect(transformPadCenterMm(localPad, 90, false)).toEqual({ x: -1, y: 2 });
  });
  test("180deg, no mirror", () => {
    expect(transformPadCenterMm(localPad, 180, false)).toEqual({
      x: -2,
      y: -1,
    });
  });
  test("270deg, no mirror", () => {
    expect(transformPadCenterMm(localPad, 270, false)).toEqual({ x: 1, y: -2 });
  });
  test("0deg, mirrored (flip X)", () => {
    expect(transformPadCenterMm(localPad, 0, true)).toEqual({ x: -2, y: 1 });
  });
  test("90deg, mirrored", () => {
    expect(transformPadCenterMm(localPad, 90, true)).toEqual({ x: -1, y: -2 });
  });
  test("180deg, mirrored", () => {
    expect(transformPadCenterMm(localPad, 180, true)).toEqual({ x: 2, y: -1 });
  });
  test("270deg, mirrored", () => {
    expect(transformPadCenterMm(localPad, 270, true)).toEqual({ x: 1, y: 2 });
  });
});

describe("padWorldPositionMm", () => {
  test("translates pad by placement origin", () => {
    const placement: PcbPlacedPart = {
      id: "p1",
      partId: "part1",
      componentId: "comp1",
      reference: "R1",
      positionMm: { x: 10, y: 20 },
      rotationDeg: 0,
      mirrored: false,
      layer: "F.Cu",
      footprint: {
        footprintId: "fp1",
        name: "FP",
        mountType: null,
        sourceHash: null,
        preview: null,
      },
    };
    expect(padWorldPositionMm(placement, { centerMm: { x: 1, y: 0 } })).toEqual(
      {
        x: 11,
        y: 20,
      },
    );
  });
  test("rotates pad about placement origin (90deg)", () => {
    const placement: PcbPlacedPart = {
      id: "p1",
      partId: "part1",
      componentId: "comp1",
      reference: "R1",
      positionMm: { x: 10, y: 20 },
      rotationDeg: 90,
      mirrored: false,
      layer: "F.Cu",
      footprint: {
        footprintId: "fp1",
        name: "FP",
        mountType: null,
        sourceHash: null,
        preview: null,
      },
    };
    expect(padWorldPositionMm(placement, { centerMm: { x: 1, y: 0 } })).toEqual(
      {
        x: 10,
        y: 21,
      },
    );
  });
});
