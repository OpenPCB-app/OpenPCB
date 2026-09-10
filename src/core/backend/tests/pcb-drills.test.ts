import { describe, expect, test } from "bun:test";
import {
  collectDrills,
  footprintPadDrill,
  padDrillFields,
  type FootprintPadDrillFields,
} from "../../../modules/designer/frontend/pcb/pcb-drills";
import { padOutlineWorldMm } from "../../../shared/pcb-geometry/pad-outline";
import type { PcbPlacedPart, PcbPointMm, PcbVia } from "../../../sdks";
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

/**
 * A render-source pad carrying the S11 drill attributes. They are absent from
 * the PINNED `@openpcb/rendering-core` pad type (the sibling checkout has them,
 * unreleased), which is exactly why every read goes through `padDrillFields` —
 * contract 10 §2.1.
 */
type DrilledPad = FootprintRenderSourcePad & FootprintPadDrillFields;

/** Angle of `a -> b`, folded into [0, 180) — a slot axis has no direction. */
function axisDeg(a: PcbPointMm, b: PcbPointMm): number {
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return ((deg % 180) + 180) % 180;
}

describe("padDrillFields — the one narrowing read (contract 10 §2.1)", () => {
  test("a pad with no attributes is plated, unslotted and uncentred", () => {
    expect(padDrillFields(pad("1", { x: 0, y: 0 }, 0.8))).toEqual({
      plated: true,
      drillSlotMm: null,
      drillOffsetMm: null,
    });
  });

  test("only `plated: false` means non-plated; a (0,0) offset is no offset", () => {
    const base = pad("1", { x: 0, y: 0 }, 0.8);
    const withFields = (extra: FootprintPadDrillFields): DrilledPad => ({
      ...base,
      ...extra,
    });
    expect(padDrillFields(withFields({ plated: true })).plated).toBe(true);
    expect(padDrillFields(withFields({ plated: false })).plated).toBe(false);
    expect(
      padDrillFields(withFields({ drillOffsetMm: { x: 0, y: 0 } }))
        .drillOffsetMm,
    ).toBeNull();
    expect(
      padDrillFields(withFields({ drillOffsetMm: { x: 0.4, y: 0 } }))
        .drillOffsetMm,
    ).toEqual({ x: 0.4, y: 0 });
  });

  test("a non-finite or non-positive slot dimension is no slot", () => {
    const base = pad("1", { x: 0, y: 0 }, 0.8);
    for (const bad of [
      { widthMm: 0, heightMm: 0.5 },
      { widthMm: 1.8, heightMm: 0 },
      { widthMm: Number.NaN, heightMm: 0.5 },
      { widthMm: 1.8, heightMm: Number.POSITIVE_INFINITY },
    ]) {
      const p: DrilledPad = { ...base, drillSlotMm: bad };
      expect(padDrillFields(p).drillSlotMm).toBeNull();
    }
  });
});

describe("footprintPadDrill — the slot frame (contract 10 §1.2)", () => {
  const slotted = (rotationDeg: number): DrilledPad => ({
    ...pad("1", { x: 0, y: 0 }, 0.5),
    rotationDeg,
    drillSlotMm: { widthMm: 1.8, heightMm: 0.5 },
  });

  test("pad 45 deg on a placement 30 deg gives a 75 deg slot; mirrored gives -15", () => {
    const pl = (mirrored: boolean): PcbPlacedPart =>
      placement({
        positionMm: { x: 0, y: 0 },
        rotationDeg: 30,
        mirrored,
        pads: [slotted(45)],
      });

    const up = footprintPadDrill(slotted(45), pl(false))!;
    expect(axisDeg(up.slot!.a, up.slot!.b)).toBeCloseTo(75, 9);
    const mirroredDrill = footprintPadDrill(slotted(45), pl(true))!;
    expect(axisDeg(mirroredDrill.slot!.a, mirroredDrill.slot!.b)).toBeCloseTo(
      165,
      9,
    ); // -15 deg, folded into [0, 180)

    // The SAME convention the copper takes: a thin `rect` pad of the slot's
    // dimensions has its long axis along the slot's.
    for (const mirrored of [false, true]) {
      const thin = {
        ...slotted(45),
        shape: "rect" as const,
        widthMm: 1.8,
        heightMm: 0.5,
      };
      const ring = padOutlineWorldMm(pl(mirrored), thin);
      // The rect ring is [-hw,-hh], [hw,-hh], [hw,hh], [-hw,hh]: the long axis
      // runs between the midpoints of the two short edges.
      const midA = {
        x: (ring[0]!.x + ring[3]!.x) / 2,
        y: (ring[0]!.y + ring[3]!.y) / 2,
      };
      const midB = {
        x: (ring[1]!.x + ring[2]!.x) / 2,
        y: (ring[1]!.y + ring[2]!.y) / 2,
      };
      const drill = footprintPadDrill(slotted(45), pl(mirrored))!;
      expect(axisDeg(midA, midB)).toBeCloseTo(
        axisDeg(drill.slot!.a, drill.slot!.b),
        9,
      );
    }
  });

  test("the tool is the narrow axis and the centreline half-span is (max - min)/2", () => {
    const drill = footprintPadDrill(
      slotted(0),
      placement({ pads: [slotted(0)] }),
    )!;
    expect(drill.drillMm).toBe(0.5);
    expect(drill.slot!.widthMm).toBe(0.5);
    expect(drill.slot!.a).toEqual({ x: -0.65, y: 0 });
    expect(drill.slot!.b).toEqual({ x: 0.65, y: 0 });
  });

  test("a square slot degenerates to a round hit of the SLOT tool, not of drillDiameterMm", () => {
    // Contract 10 §1.2 (Astra run 2b #2): a `(drill oval 0.5 0.5)` is routed
    // with a 0.5 bit whatever the narrow-axis mirror in `drillDiameterMm` says
    // — the centreline vanishes, the tool does not.
    const p: DrilledPad = {
      ...pad("1", { x: 0, y: 0 }, 0.8),
      drillSlotMm: { widthMm: 0.5, heightMm: 0.5 },
    };
    const drill = footprintPadDrill(p, placement({ pads: [p] }))!;
    expect(drill.slot).toBeUndefined();
    expect(drill.drillMm).toBe(0.5);
  });

  test("a drill offset is a PAD-local vector through the composed frame", () => {
    const offsetPad: DrilledPad = {
      ...pad("1", { x: 0, y: 0 }, 0.8),
      drillOffsetMm: { x: 0.4, y: 0 },
    };
    // Placement 90 deg, pad rotation 0 -> world rotation 90: (0.4, 0) -> (0, 0.4).
    const upright = footprintPadDrill(
      offsetPad,
      placement({ rotationDeg: 90, pads: [offsetPad] }),
    )!;
    expect(upright.centerMm.x).toBeCloseTo(0, 12);
    expect(upright.centerMm.y).toBeCloseTo(0.4, 12);
    // Mirrored: reflect X first (0.4, 0) -> (-0.4, 0), then rotate 90 deg.
    const mirrored = footprintPadDrill(
      offsetPad,
      placement({ rotationDeg: 90, mirrored: true, pads: [offsetPad] }),
    )!;
    expect(mirrored.centerMm.x).toBeCloseTo(0, 12);
    expect(mirrored.centerMm.y).toBeCloseTo(-0.4, 12);
  });

  test("plating comes from the attribute; no positive drill is no drill", () => {
    const npth: DrilledPad = { ...pad("1", { x: 0, y: 0 }, 0.8), plated: false };
    expect(footprintPadDrill(npth, placement({ pads: [npth] }))!.plated).toBe(
      false,
    );
    const dry = pad("1", { x: 0, y: 0 });
    expect(footprintPadDrill(dry, placement({ pads: [dry] }))).toBeNull();
    const zero = pad("1", { x: 0, y: 0 }, 0);
    expect(footprintPadDrill(zero, placement({ pads: [zero] }))).toBeNull();
  });

  test("collectDrills carries the slot through and keeps its order", () => {
    const p: DrilledPad = {
      ...pad("1", { x: 2, y: 0 }, 0.5),
      drillSlotMm: { widthMm: 1.8, heightMm: 0.5 },
    };
    const drills = collectDrills(
      [via({ x: 0, y: 0 }, 0.4)],
      [placement({ positionMm: { x: 10, y: 0 }, pads: [p] })],
    );
    expect(drills).toHaveLength(2);
    expect(drills[1]!.centerMm).toEqual({ x: 12, y: 0 });
    expect(drills[1]!.radiusMm).toBe(0.25);
    expect(drills[1]!.slot).toEqual({
      a: { x: 11.35, y: 0 },
      b: { x: 12.65, y: 0 },
      widthMm: 0.5,
    });
  });
});
