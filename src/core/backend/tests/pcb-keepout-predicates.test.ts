/**
 * `keepoutAffects` (docs/pcb-hardening/03-zone-keepout-contract.md §4): item
 * class × restriction × layer scope, per the table in §4. A keepout has
 * clearance 0 — touching the boundary is legal, `GEOM_EPS_MM` closer is not.
 */
import { describe, expect, test } from "bun:test";
import {
  keepoutAffects,
  keepoutsAffecting,
  keepoutRestrictionFor,
  type KeepoutItem,
} from "../../../shared/pcb-areas/keepout-predicates";
import { GEOM_EPS_MM } from "../../../shared/pcb-geometry/tolerance";
import type { PcbKeepout, PcbKeepoutRestrictions } from "../../../sdks/designer";
import { keepoutRow } from "./helpers/pcb-zone-fixtures";

const SQUARE_10 = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

function restrictions(
  overrides: Partial<PcbKeepoutRestrictions> = {},
): PcbKeepoutRestrictions {
  return {
    tracks: false,
    vias: false,
    pads: false,
    copperPour: false,
    footprints: false,
    ...overrides,
  };
}

/**
 * The shared keepout row (S4), narrowed for these tests: the fixture's
 * all-forbidden default is replaced by an all-ALLOWED base, so every case below
 * has to name the one restriction it is about.
 */
function keepout(overrides: Partial<PcbKeepout> = {}): PcbKeepout {
  return keepoutRow("k1", ["F.Cu"], SQUARE_10, {}, {
    restrictions: restrictions(),
    ...overrides,
  });
}

function traceItem(overrides: Partial<Extract<KeepoutItem, { kind: "trace" }>> = {}): KeepoutItem {
  return {
    kind: "trace",
    layer: "F.Cu",
    pointsMm: [{ x: 2, y: 5 }, { x: 8, y: 5 }],
    widthMm: 0.2,
    ...overrides,
  };
}

describe("keepoutRestrictionFor", () => {
  test("maps item kind to restriction flag", () => {
    expect(keepoutRestrictionFor(traceItem())).toBe("tracks");
    expect(
      keepoutRestrictionFor({
        kind: "via",
        layers: new Set(["F.Cu"]),
        centerMm: { x: 5, y: 5 },
        diameterMm: 0.6,
      }),
    ).toBe("vias");
    expect(
      keepoutRestrictionFor({
        kind: "pad",
        layers: new Set(["F.Cu"]),
        ringMm: SQUARE_10,
      }),
    ).toBe("pads");
    expect(
      keepoutRestrictionFor({
        kind: "placement",
        sideLayer: "F.Cu",
        hullMm: SQUARE_10,
      }),
    ).toBe("footprints");
  });
});

describe("trace vs keepout", () => {
  test("fully inside → affected", () => {
    const k = keepout({ restrictions: restrictions({ tracks: true }) });
    expect(keepoutAffects(k, traceItem())).toBe(true);
  });

  test("crossing the boundary → affected", () => {
    const k = keepout({ restrictions: restrictions({ tracks: true }) });
    const item = traceItem({ pointsMm: [{ x: -5, y: 5 }, { x: 5, y: 5 }] });
    expect(keepoutAffects(k, item)).toBe(true);
  });

  test("fully outside → not affected", () => {
    const k = keepout({ restrictions: restrictions({ tracks: true }) });
    const item = traceItem({
      pointsMm: [{ x: 20, y: 5 }, { x: 30, y: 5 }],
    });
    expect(keepoutAffects(k, item)).toBe(false);
  });

  test("edge-tangent at exactly half width → not affected", () => {
    const k = keepout({ restrictions: restrictions({ tracks: true }) });
    // Centreline 0.1mm outside the boundary (x=10), half-width 0.1mm: the
    // stadium edge is exactly tangent to the keepout boundary.
    const item = traceItem({
      pointsMm: [{ x: 10.1, y: 3 }, { x: 10.1, y: 7 }],
      widthMm: 0.2,
    });
    expect(keepoutAffects(k, item)).toBe(false);
  });

  test("1e-6 mm closer than tangent → affected", () => {
    const k = keepout({ restrictions: restrictions({ tracks: true }) });
    const item = traceItem({
      pointsMm: [{ x: 10.1 - 1e-6, y: 3 }, { x: 10.1 - 1e-6, y: 7 }],
      widthMm: 0.2,
    });
    expect(keepoutAffects(k, item)).toBe(true);
  });

  test("on a non-keepout layer → not affected", () => {
    const k = keepout({
      layers: ["B.Cu"],
      restrictions: restrictions({ tracks: true }),
    });
    expect(keepoutAffects(k, traceItem({ layer: "F.Cu" }))).toBe(false);
  });

  test("tracks restriction flag off → not affected even though geometry overlaps", () => {
    const k = keepout({ restrictions: restrictions({ tracks: false }) });
    expect(keepoutAffects(k, traceItem())).toBe(false);
  });
});

describe("via vs keepout", () => {
  function viaItem(
    overrides: Partial<Extract<KeepoutItem, { kind: "via" }>> = {},
  ): KeepoutItem {
    return {
      kind: "via",
      layers: new Set(["F.Cu", "In1.Cu"]),
      centerMm: { x: 5, y: 5 },
      diameterMm: 0.6,
      ...overrides,
    };
  }

  test("span includes keepout layer → affected", () => {
    const k = keepout({
      layers: ["In1.Cu"],
      restrictions: restrictions({ vias: true }),
    });
    expect(keepoutAffects(k, viaItem())).toBe(true);
  });

  test("span excludes keepout layer (B.Cu) → not affected", () => {
    const k = keepout({
      layers: ["B.Cu"],
      restrictions: restrictions({ vias: true }),
    });
    expect(keepoutAffects(k, viaItem())).toBe(false);
  });

  test("disc grazing the boundary by < eps → not affected", () => {
    const k = keepout({ restrictions: restrictions({ vias: true }) });
    // radius 0.3, centre at x = 10 + 0.3 - eps/2 → distance to boundary is
    // r - eps/2, i.e. within eps of tangent: not affected.
    const item = viaItem({
      centerMm: { x: 10 + 0.3 - GEOM_EPS_MM / 2, y: 5 },
      diameterMm: 0.6,
    });
    expect(keepoutAffects(k, item)).toBe(false);
  });
});

describe("pad vs keepout", () => {
  function padItem(
    overrides: Partial<Extract<KeepoutItem, { kind: "pad" }>> = {},
  ): KeepoutItem {
    return {
      kind: "pad",
      layers: new Set(["F.Cu"]),
      ringMm: [
        { x: 4, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 6 },
        { x: 4, y: 6 },
      ],
      ...overrides,
    };
  }

  test("SMD pad on B.Cu vs F.Cu keepout → not affected", () => {
    const k = keepout({
      layers: ["F.Cu"],
      restrictions: restrictions({ pads: true }),
    });
    expect(keepoutAffects(k, padItem({ layers: new Set(["B.Cu"]) }))).toBe(
      false,
    );
  });

  test("THT pad (all layers) vs inner keepout → affected", () => {
    const k = keepout({
      layers: ["In1.Cu"],
      restrictions: restrictions({ pads: true }),
    });
    const item = padItem({ layers: new Set(["F.Cu", "In1.Cu", "B.Cu"]) });
    expect(keepoutAffects(k, item)).toBe(true);
  });

  test("circle pad uses the exact disc", () => {
    const k = keepout({ restrictions: restrictions({ pads: true }) });
    const inside = padItem({
      disc: { centerMm: { x: 5, y: 5 }, radiusMm: 0.5 },
    });
    expect(keepoutAffects(k, inside)).toBe(true);

    const outside = padItem({
      disc: { centerMm: { x: 20, y: 5 }, radiusMm: 0.5 },
    });
    expect(keepoutAffects(k, outside)).toBe(false);
  });

  test("pads restriction flag off → not affected", () => {
    const k = keepout({ restrictions: restrictions({ pads: false }) });
    expect(keepoutAffects(k, padItem())).toBe(false);
  });
});

describe("placement vs keepout", () => {
  function placementItem(
    overrides: Partial<Extract<KeepoutItem, { kind: "placement" }>> = {},
  ): KeepoutItem {
    return {
      kind: "placement",
      sideLayer: "F.Cu",
      hullMm: [
        { x: 4, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 6 },
        { x: 4, y: 6 },
      ],
      ...overrides,
    };
  }

  test("overlapping hull, sideLayer F.Cu vs keepout {F.Cu} → affected", () => {
    const k = keepout({
      layers: ["F.Cu"],
      restrictions: restrictions({ footprints: true }),
    });
    expect(keepoutAffects(k, placementItem())).toBe(true);
  });

  test("overlapping hull, sideLayer F.Cu vs keepout {In1.Cu} → not affected", () => {
    const k = keepout({
      layers: ["In1.Cu"],
      restrictions: restrictions({ footprints: true }),
    });
    expect(keepoutAffects(k, placementItem())).toBe(false);
  });

  test("footprints restriction flag off → not affected", () => {
    const k = keepout({
      layers: ["F.Cu"],
      restrictions: restrictions({ footprints: false }),
    });
    expect(keepoutAffects(k, placementItem())).toBe(false);
  });
});

describe("enabled / multi-layer / order", () => {
  test("enabled: false → always false, regardless of geometry or restrictions", () => {
    const k = keepout({
      enabled: false,
      restrictions: restrictions({
        tracks: true,
        vias: true,
        pads: true,
        footprints: true,
      }),
    });
    expect(keepoutAffects(k, traceItem())).toBe(false);
  });

  test("multi-layer keepout affects an item on any of its layers", () => {
    const k = keepout({
      layers: ["F.Cu", "In1.Cu", "B.Cu"],
      restrictions: restrictions({ tracks: true }),
    });
    expect(keepoutAffects(k, traceItem({ layer: "In1.Cu" }))).toBe(true);
    expect(keepoutAffects(k, traceItem({ layer: "B.Cu" }))).toBe(true);
  });

  test("keepoutsAffecting returns affected ids in input order", () => {
    const affecting = keepout({
      id: "k-affecting",
      restrictions: restrictions({ tracks: true }),
    });
    const notAffecting = keepout({
      id: "k-not-affecting",
      layers: ["B.Cu"],
      restrictions: restrictions({ tracks: true }),
    });
    const alsoAffecting = keepout({
      id: "k-also-affecting",
      restrictions: restrictions({ tracks: true }),
    });
    expect(
      keepoutsAffecting(
        [affecting, notAffecting, alsoAffecting],
        traceItem(),
      ),
    ).toEqual(["k-affecting", "k-also-affecting"]);
  });
});

describe("non-finite input", () => {
  test("non-finite trace point → not affected", () => {
    const k = keepout({ restrictions: restrictions({ tracks: true }) });
    const item = traceItem({
      pointsMm: [{ x: Number.NaN, y: 5 }, { x: 8, y: 5 }],
    });
    expect(keepoutAffects(k, item)).toBe(false);
  });

  test("non-finite keepout ring point → not affected", () => {
    const k = keepout({
      pointsMm: [
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      restrictions: restrictions({ tracks: true }),
    });
    expect(keepoutAffects(k, traceItem())).toBe(false);
  });
});

describe("degenerate items are never affected", () => {
  const keepout: PcbKeepout = {
    id: "k-deg",
    name: null,
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
      tracks: true,
      vias: true,
      pads: true,
      copperPour: true,
      footprints: true,
    },
  };
  test("a zero-area pad sliver sitting on the boundary is not affected", () => {
    // Fails closed inside ringsOverlapPositiveArea (orientation 0) — the
    // contract keeps such copper out of the predicate entirely.
    expect(
      keepoutAffects(keepout, {
        kind: "pad",
        layers: new Set(["F.Cu"]),
        ringMm: [
          { x: -0.0005, y: 4 },
          { x: 0, y: 4 },
          { x: 0, y: 4.0005 },
        ],
      }),
    ).toBe(false);
  });
  test("a zero-width trace and a zero-diameter via inside are not affected", () => {
    expect(
      keepoutAffects(keepout, {
        kind: "trace",
        layer: "F.Cu",
        pointsMm: [{ x: 2, y: 5 }, { x: 8, y: 5 }],
        widthMm: 0,
      }),
    ).toBe(false);
    expect(
      keepoutAffects(keepout, {
        kind: "via",
        layers: new Set(["F.Cu"]),
        centerMm: { x: 5, y: 5 },
        diameterMm: 0,
      }),
    ).toBe(false);
  });
  test("a degenerate keepout ring affects nothing", () => {
    expect(
      keepoutAffects(
        { ...keepout, pointsMm: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] },
        { kind: "via", layers: new Set(["F.Cu"]), centerMm: { x: 5, y: 0 }, diameterMm: 1 },
      ),
    ).toBe(false);
  });
});

describe("raw keepout rings", () => {
  test("a self-intersecting keepout ring affects nothing (no interior side)", () => {
    const bowtie: PcbKeepout = {
      id: "k-bow",
      name: null,
      enabled: true,
      lockedAt: null,
      layers: ["F.Cu"],
      pointsMm: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      restrictions: { tracks: true, vias: true, pads: true, copperPour: true, footprints: true },
    };
    expect(
      keepoutAffects(bowtie, {
        kind: "via",
        layers: new Set(["F.Cu"]),
        centerMm: { x: 5, y: 2 },
        diameterMm: 1,
      }),
    ).toBe(false);
  });
});
