import { describe, expect, test } from "bun:test";
import { collectDrills } from "../../../modules/designer/frontend/pcb/pcb-drills";
import type { PcbPlacedPart, PcbVia } from "../../../sdks";
import type {
  FootprintRenderModel,
  FootprintRenderSourcePad,
} from "../../../shared/rendering/types";

function pad(
  number: string,
  centerMm: { x: number; y: number },
  drillDiameterMm?: number,
): FootprintRenderSourcePad {
  return {
    id: `pad-${number}`,
    number,
    shape: "circle",
    centerMm,
    widthMm: 1,
    heightMm: 1,
    rotationDeg: 0,
    ...(drillDiameterMm !== undefined ? { drillDiameterMm } : {}),
    layer: "F.Cu",
  };
}

function placement(
  opts: {
    id?: string;
    positionMm?: { x: number; y: number };
    rotationDeg?: number;
    mirrored?: boolean;
    layer?: "F.Cu" | "B.Cu" | "In1.Cu" | "In2.Cu";
    pads?: FootprintRenderSourcePad[];
  } = {},
): PcbPlacedPart {
  const preview: FootprintRenderModel | null = opts.pads
    ? {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads: opts.pads,
        graphics: [],
        labels: [],
        bounds: null,
        warnings: [],
      }
    : null;
  return {
    id: opts.id ?? "pl-1",
    partId: "part-1",
    componentId: "comp-1",
    reference: "R1",
    positionMm: opts.positionMm ?? { x: 0, y: 0 },
    rotationDeg: opts.rotationDeg ?? 0,
    mirrored: opts.mirrored ?? false,
    layer: opts.layer ?? "F.Cu",
    footprint: {
      footprintId: "fp1",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview,
    },
  };
}

function via(centerMm: { x: number; y: number }, drillMm: number): PcbVia {
  return {
    id: `via-${centerMm.x}-${centerMm.y}`,
    netId: "n1",
    netClassId: "default",
    centerMm,
    diameterMm: drillMm + 0.4,
    drillMm,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    protection: "none",
    provenance: "route",
  };
}

describe("collectDrills", () => {
  test("empty inputs produce no drills", () => {
    expect(collectDrills([], [])).toEqual([]);
  });

  test("includes vias with positive drill", () => {
    const v = via({ x: 5, y: 10 }, 0.4);
    const drills = collectDrills([v], []);
    expect(drills).toHaveLength(1);
    expect(drills[0]).toEqual({ centerMm: { x: 5, y: 10 }, radiusMm: 0.2 });
  });

  test("vias with zero drill are skipped", () => {
    const v: PcbVia = { ...via({ x: 0, y: 0 }, 0.4), drillMm: 0 };
    expect(collectDrills([v], [])).toEqual([]);
  });

  test("includes pad drills translated by placement origin", () => {
    const pl = placement({
      positionMm: { x: 10, y: 20 },
      pads: [pad("1", { x: 2, y: 1 }, 0.8)],
    });
    const drills = collectDrills([], [pl]);
    expect(drills).toHaveLength(1);
    expect(drills[0]).toEqual({
      centerMm: { x: 12, y: 21 },
      radiusMm: 0.4,
    });
  });

  test("90deg rotation rotates pad offset", () => {
    const pl = placement({
      positionMm: { x: 0, y: 0 },
      rotationDeg: 90,
      pads: [pad("1", { x: 2, y: 1 }, 1)],
    });
    const drills = collectDrills([], [pl]);
    // Exact trig leaves sub-femtometer FP noise at orthogonal angles; the value
    // is -1 within float precision (and far below the 0.1 µm fill grid).
    expect(drills[0]!.centerMm.x).toBeCloseTo(-1, 9);
    expect(drills[0]!.centerMm.y).toBeCloseTo(2, 9);
    expect(drills[0]!.radiusMm).toBe(0.5);
  });

  test("arbitrary (non-orthogonal) rotation places the drill exactly", () => {
    // Regression: the old `Math.round(deg/90)*90` snapped this to 0° and put the
    // hole at (2,0). Pad at (2,0) rotated 45° → (2cos45, 2sin45) = (√2, √2).
    const pl = placement({
      positionMm: { x: 0, y: 0 },
      rotationDeg: 45,
      pads: [pad("1", { x: 2, y: 0 }, 1)],
    });
    const drills = collectDrills([], [pl]);
    expect(drills[0]!.centerMm.x).toBeCloseTo(Math.SQRT2, 6);
    expect(drills[0]!.centerMm.y).toBeCloseTo(Math.SQRT2, 6);
  });

  test("mirrored placement flips X", () => {
    const pl = placement({
      positionMm: { x: 0, y: 0 },
      mirrored: true,
      pads: [pad("1", { x: 2, y: 1 }, 1)],
    });
    const drills = collectDrills([], [pl]);
    expect(drills[0]).toEqual({ centerMm: { x: -2, y: 1 }, radiusMm: 0.5 });
  });

  test("B.Cu layer mirrors X like explicit mirrored flag", () => {
    const pl = placement({
      positionMm: { x: 0, y: 0 },
      layer: "B.Cu",
      pads: [pad("1", { x: 2, y: 1 }, 1)],
    });
    const drills = collectDrills([], [pl]);
    expect(drills[0]).toEqual({ centerMm: { x: -2, y: 1 }, radiusMm: 0.5 });
  });

  test("pads without drillDiameterMm are skipped", () => {
    const pl = placement({
      positionMm: { x: 0, y: 0 },
      pads: [pad("1", { x: 2, y: 1 }), pad("2", { x: 3, y: 2 }, 0)],
    });
    expect(collectDrills([], [pl])).toEqual([]);
  });

  test("combines vias + pad drills in deterministic order (vias first)", () => {
    const v = via({ x: 0, y: 0 }, 0.4);
    const pl = placement({
      positionMm: { x: 5, y: 5 },
      pads: [pad("1", { x: 0, y: 0 }, 1)],
    });
    const drills = collectDrills([v], [pl]);
    expect(drills).toHaveLength(2);
    expect(drills[0]?.centerMm).toEqual({ x: 0, y: 0 });
    expect(drills[1]?.centerMm).toEqual({ x: 5, y: 5 });
  });

  test("includes free holes (appended after pads)", () => {
    const v = via({ x: 0, y: 0 }, 0.4);
    const pl = placement({
      positionMm: { x: 5, y: 5 },
      pads: [pad("1", { x: 0, y: 0 }, 1)],
    });
    const drills = collectDrills(
      [v],
      [pl],
      [
        {
          id: "fh-1",
          centerMm: { x: 50, y: 60 },
          drillMm: 3.2,
          lockedAt: null,
        },
      ],
    );
    expect(drills).toHaveLength(3);
    expect(drills[2]).toEqual({ centerMm: { x: 50, y: 60 }, radiusMm: 1.6 });
  });

  test("free holes with non-positive drill are skipped", () => {
    const drills = collectDrills(
      [],
      [],
      [
        { id: "fh-1", centerMm: { x: 1, y: 1 }, drillMm: 0, lockedAt: null },
        { id: "fh-2", centerMm: { x: 2, y: 2 }, drillMm: -1, lockedAt: null },
      ],
    );
    expect(drills).toEqual([]);
  });
});
