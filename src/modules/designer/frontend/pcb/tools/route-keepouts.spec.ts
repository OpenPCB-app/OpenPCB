import { describe, expect, test } from "vitest";
import type { PcbCopperLayerId, PcbKeepout } from "../../../../../sdks";
import { viaKeepoutBlock } from "./route-keepouts";

/** 10×10 mm square keepout at the origin, vias forbidden on F.Cu. */
function keepout(overrides: Partial<PcbKeepout> = {}): PcbKeepout {
  return {
    id: "k1",
    name: "K1",
    enabled: true,
    lockedAt: null,
    layers: ["F.Cu"],
    pointsMm: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    restrictions: {
      tracks: false,
      vias: true,
      pads: false,
      copperPour: false,
      footprints: false,
    },
    ...overrides,
  };
}

const FRONT: ReadonlySet<PcbCopperLayerId> = new Set<PcbCopperLayerId>([
  "F.Cu",
]);
const BACK: ReadonlySet<PcbCopperLayerId> = new Set<PcbCopperLayerId>(["B.Cu"]);

describe("viaKeepoutBlock", () => {
  test("a via inside the keepout is blocked and names the keepout", () => {
    const k = keepout();
    expect(
      viaKeepoutBlock([k], {
        centerMm: { x: 5, y: 5 },
        diameterMm: 0.8,
        layers: FRONT,
      }),
    ).toBe(k);
  });

  test("a via clear of the keepout is legal", () => {
    expect(
      viaKeepoutBlock([keepout()], {
        centerMm: { x: 20, y: 5 },
        diameterMm: 0.8,
        layers: FRONT,
      }),
    ).toBeNull();
  });

  test("a via whose span misses the keepout layers is legal", () => {
    expect(
      viaKeepoutBlock([keepout()], {
        centerMm: { x: 5, y: 5 },
        diameterMm: 0.8,
        layers: BACK,
      }),
    ).toBeNull();
  });

  test("restrictions.vias off means the keepout never blocks a via", () => {
    const k = keepout({
      restrictions: {
        tracks: true,
        vias: false,
        pads: true,
        copperPour: true,
        footprints: true,
      },
    });
    expect(
      viaKeepoutBlock([k], {
        centerMm: { x: 5, y: 5 },
        diameterMm: 0.8,
        layers: FRONT,
      }),
    ).toBeNull();
  });

  test("a disc that only touches the boundary is legal (clearance 0)", () => {
    // Centre 0.4 mm outside the left edge with radius 0.4 mm: tangent, so the
    // open interiors do not meet (contract §4).
    expect(
      viaKeepoutBlock([keepout()], {
        centerMm: { x: -0.4, y: 5 },
        diameterMm: 0.8,
        layers: FRONT,
      }),
    ).toBeNull();
  });

  test("a through via is blocked by an inner-layer keepout", () => {
    const k = keepout({ layers: ["In1.Cu"] });
    expect(
      viaKeepoutBlock([k], {
        centerMm: { x: 5, y: 5 },
        diameterMm: 0.8,
        layers: new Set<PcbCopperLayerId>(["F.Cu", "In1.Cu", "B.Cu"]),
      }),
    ).toBe(k);
  });
});
