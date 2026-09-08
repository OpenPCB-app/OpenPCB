/**
 * The read-time zone upgrade and the keepout parse
 * (docs/pcb-hardening/03-zone-keepout-contract.md §2.1, §3.3). One row of this
 * suite per row of the contract's upgrade table: a v1 payload becomes a v2
 * record identically wherever it is read, and a row that cannot be trusted is
 * rejected rather than guessed at.
 */
import { describe, expect, test } from "bun:test";
import {
  isZoneHoleInvalidity,
  parsePcbKeepoutRecord,
  upgradePcbZoneRecord,
  zoneRegionValidity,
  zoneRingValidity,
} from "../../../shared/pcb-areas/zone-parse";

const SQUARE = [
  { x: -5, y: -5 },
  { x: 5, y: -5 },
  { x: 5, y: 5 },
  { x: -5, y: 5 },
];

function v1(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "z1",
    netName: "GND",
    netId: "n1",
    layer: "F.Cu",
    polygonPointsMm: SQUARE,
    hatchEdgeMm: 0.5,
    fillType: "solid",
    ...overrides,
  };
}

function v2(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "z1",
    name: null,
    enabled: true,
    lockedAt: null,
    layer: "F.Cu",
    netId: "n1",
    netName: "GND",
    region: { kind: "polygon", pointsMm: SQUARE },
    priority: 0,
    ...overrides,
  };
}

describe("v1 → v2 upgrade", () => {
  test("polygonPointsMm becomes a polygon region, verbatim", () => {
    const { zone, warnings } = upgradePcbZoneRecord(v1());
    expect(warnings).toEqual([]);
    expect(zone).toEqual({
      id: "z1",
      name: null,
      enabled: true,
      lockedAt: null,
      layer: "F.Cu",
      netId: "n1",
      netName: "GND",
      region: { kind: "polygon", pointsMm: SQUARE },
      priority: 0,
    });
  });

  test("a persisted netId is kept (the v1 loader dropped it)", () => {
    expect(upgradePcbZoneRecord(v1({ netId: "n7" })).zone?.netId).toBe("n7");
  });

  test("connection becomes padConnection", () => {
    expect(upgradePcbZoneRecord(v1({ connection: "thermal" })).zone?.padConnection).toBe(
      "thermal",
    );
    // A v1 row never carried the two new modes; only the v2 field does.
    expect(upgradePcbZoneRecord(v1({ connection: "bogus" })).zone?.padConnection).toBe(
      undefined,
    );
    expect(
      upgradePcbZoneRecord(v2({ padConnection: "thruHoleThermal" })).zone?.padConnection,
    ).toBe("thruHoleThermal");
  });

  test("priority coercion: missing / non-finite / negative / fractional", () => {
    expect(upgradePcbZoneRecord(v1()).zone?.priority).toBe(0);
    expect(upgradePcbZoneRecord(v1({ priority: Number.NaN })).zone?.priority).toBe(0);
    expect(upgradePcbZoneRecord(v1({ priority: -4 })).zone?.priority).toBe(0);
    expect(upgradePcbZoneRecord(v1({ priority: 2.9 })).zone?.priority).toBe(2);
    expect(upgradePcbZoneRecord(v1({ priority: "3" })).zone?.priority).toBe(0);
  });

  test("name and lockedAt default to null", () => {
    const { zone } = upgradePcbZoneRecord(v1({ name: "GND pour", lockedAt: "t0" }));
    expect(zone?.name).toBe("GND pour");
    expect(zone?.lockedAt).toBe("t0");
    expect(upgradePcbZoneRecord(v1()).zone?.name).toBeNull();
    expect(upgradePcbZoneRecord(v1()).zone?.lockedAt).toBeNull();
  });

  test("hatchEdgeMm is dropped silently", () => {
    const { zone, warnings } = upgradePcbZoneRecord(v1({ hatchEdgeMm: 1.5 }));
    expect(warnings).toEqual([]);
    expect(zone).not.toHaveProperty("hatchEdgeMm");
  });

  test("a hatched fill warns and is filled solid", () => {
    const { zone, warnings } = upgradePcbZoneRecord(v1({ fillType: "hatched" }));
    expect(zone).not.toBeNull();
    expect(zone).not.toHaveProperty("fillType");
    expect(warnings).toEqual([
      {
        code: "zone_hatched_fill_as_solid",
        zoneId: "z1",
        detail: "Hatched fill is not supported; the zone is filled solid.",
      },
    ]);
  });
});

describe("the legacy net-less row never starts pouring", () => {
  test("no netId and no netName → disabled, with a warning", () => {
    const { zone, warnings } = upgradePcbZoneRecord(
      v1({ netId: undefined, netName: null }),
    );
    expect(zone?.enabled).toBe(false);
    expect(warnings.map((w) => w.code)).toEqual(["zone_legacy_netless_disabled"]);
  });

  test("an empty / whitespace netName counts as net-less", () => {
    expect(upgradePcbZoneRecord(v1({ netId: null, netName: "" })).zone?.enabled).toBe(
      false,
    );
    expect(upgradePcbZoneRecord(v1({ netId: null, netName: "  " })).zone?.enabled).toBe(
      false,
    );
  });

  test("a net-less row that persists `enabled` keeps its own value", () => {
    const { zone, warnings } = upgradePcbZoneRecord(
      v1({ netId: null, netName: null, enabled: true }),
    );
    expect(zone?.enabled).toBe(true);
    expect(warnings).toEqual([]);
  });

  test("a netId alone, or a netName alone, stays enabled", () => {
    expect(upgradePcbZoneRecord(v1({ netName: null })).zone?.enabled).toBe(true);
    expect(upgradePcbZoneRecord(v1({ netId: null })).zone?.enabled).toBe(true);
  });

  test("the rule is v1-only: a v2 row without `enabled` defaults to true", () => {
    const { zone, warnings } = upgradePcbZoneRecord(
      v2({ enabled: undefined, netId: null, netName: null }),
    );
    expect(zone?.enabled).toBe(true);
    expect(warnings).toEqual([]);
  });
});

describe("board rows", () => {
  test("a persisted board region upgrades and round-trips", () => {
    // Since S3b the per-layer copper fill IS a row (contract §2.1 / §12.1): a
    // board region carries no points and must survive read → write → read.
    const raw = v2({
      id: "board:F.Cu",
      region: { kind: "board" },
      pointsMm: undefined,
      padConnection: "solid",
    });
    const { zone, warnings } = upgradePcbZoneRecord(raw);
    expect(warnings).toEqual([]);
    expect(zone).toEqual({
      id: "board:F.Cu",
      name: null,
      enabled: true,
      lockedAt: null,
      layer: "F.Cu",
      netId: "n1",
      netName: "GND",
      region: { kind: "board" },
      priority: 0,
      padConnection: "solid",
    });
    // The payload the store writes back parses to the identical record.
    expect(
      upgradePcbZoneRecord(JSON.parse(JSON.stringify(zone))).zone,
    ).toEqual(zone);
  });

  test("an unknown region kind is still rejected", () => {
    expect(
      upgradePcbZoneRecord(v2({ region: { kind: "circle" } })).zone,
    ).toBeNull();
  });
});

describe("rejected rows", () => {
  test("no id, a non-copper layer, or unparsable points", () => {
    expect(upgradePcbZoneRecord(v1({ id: undefined })).zone).toBeNull();
    expect(upgradePcbZoneRecord(v1({ layer: "F.SilkS" })).zone).toBeNull();
    expect(upgradePcbZoneRecord(v1({ polygonPointsMm: undefined })).zone).toBeNull();
    expect(
      upgradePcbZoneRecord(v1({ polygonPointsMm: [{ x: 0, y: "1" }, ...SQUARE] })).zone,
    ).toBeNull();
    expect(upgradePcbZoneRecord(v1({ polygonPointsMm: SQUARE.slice(0, 2) })).zone).toBeNull();
    expect(upgradePcbZoneRecord(null).zone).toBeNull();
    expect(upgradePcbZoneRecord("zone").zone).toBeNull();
    expect(upgradePcbZoneRecord([]).zone).toBeNull();
  });

  test("a v2 row with a malformed region is rejected without a warning", () => {
    expect(upgradePcbZoneRecord(v2({ region: { kind: "circle" } }))).toEqual({
      zone: null,
      warnings: [],
    });
    expect(
      upgradePcbZoneRecord(v2({ region: { kind: "polygon", pointsMm: "nope" } })).zone,
    ).toBeNull();
  });

  test("an invalid ring is NOT rejected at parse time (the derivation skips it)", () => {
    const bowTie = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const { zone, warnings } = upgradePcbZoneRecord(v1({ polygonPointsMm: bowTie }));
    expect(zone).not.toBeNull();
    expect(warnings).toEqual([]);
  });
});

describe("optional overrides", () => {
  test("non-finite / negative clearance and minWidth are dropped", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, null, "0.2"]) {
      const { zone } = upgradePcbZoneRecord(v2({ clearanceMm: bad, minWidthMm: bad }));
      expect(zone).not.toHaveProperty("clearanceMm");
      expect(zone).not.toHaveProperty("minWidthMm");
    }
    const { zone } = upgradePcbZoneRecord(v2({ clearanceMm: 0.3, minWidthMm: 0 }));
    expect(zone?.clearanceMm).toBe(0.3);
    expect(zone?.minWidthMm).toBe(0);
  });

  test("a thermal with a non-finite or non-positive member is dropped", () => {
    expect(
      upgradePcbZoneRecord(v2({ thermal: { gapMm: 0.5, spokeWidthMm: 0.4 } })).zone
        ?.thermal,
    ).toEqual({ gapMm: 0.5, spokeWidthMm: 0.4 });
    for (const bad of [
      { gapMm: 0, spokeWidthMm: 0.4 },
      { gapMm: 0.5, spokeWidthMm: -1 },
      { gapMm: Number.NaN, spokeWidthMm: 0.4 },
      { gapMm: 0.5 },
      "thermal",
    ]) {
      expect(upgradePcbZoneRecord(v2({ thermal: bad })).zone).not.toHaveProperty(
        "thermal",
      );
    }
  });

  test("islandRemoval: the two literals, a min area, and malformed input", () => {
    expect(upgradePcbZoneRecord(v2({ islandRemoval: "always" })).zone?.islandRemoval).toBe(
      "always",
    );
    expect(upgradePcbZoneRecord(v2({ islandRemoval: "never" })).zone?.islandRemoval).toBe(
      "never",
    );
    expect(
      upgradePcbZoneRecord(v2({ islandRemoval: { minAreaMm2: 2 } })).zone?.islandRemoval,
    ).toEqual({ minAreaMm2: 2 });
    for (const bad of ["sometimes", { minAreaMm2: "2" }, {}, 3]) {
      expect(upgradePcbZoneRecord(v2({ islandRemoval: bad })).zone).not.toHaveProperty(
        "islandRemoval",
      );
    }
  });
});

describe("zoneRingValidity", () => {
  test("a square is ok", () => {
    expect(zoneRingValidity(SQUARE)).toBe("ok");
  });

  test("fewer than three vertices, before and after canonicalisation", () => {
    expect(zoneRingValidity([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe("tooFewPoints");
    expect(
      zoneRingValidity([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe("tooFewPoints");
  });

  test("a non-finite vertex", () => {
    expect(zoneRingValidity([{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, ...SQUARE])).toBe(
      "nonFinite",
    );
    expect(
      zoneRingValidity([{ x: 0, y: 0 }, { x: 1, y: Number.POSITIVE_INFINITY }, ...SQUARE]),
    ).toBe("nonFinite");
  });

  test("a bow-tie self-intersects", () => {
    expect(
      zoneRingValidity([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe("selfIntersecting");
  });

  test("a collinear sliver has no usable area", () => {
    expect(
      zoneRingValidity([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    ).toBe("zeroArea");
  });

  test("a duplicated vertex is canonicalised away, not reported invalid", () => {
    expect(
      zoneRingValidity([
        { x: -5, y: -5 },
        { x: -5, y: -5 },
        { x: 5, y: -5 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ]),
    ).toBe("ok");
  });
});

describe("parsePcbKeepoutRecord", () => {
  function keepout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "k1",
      layers: ["F.Cu", "B.Cu"],
      pointsMm: SQUARE,
      restrictions: { tracks: true, vias: true },
      ...overrides,
    };
  }

  test("a full row parses, with the unset restrictions false", () => {
    expect(parsePcbKeepoutRecord(keepout())).toEqual({
      id: "k1",
      name: null,
      enabled: true,
      lockedAt: null,
      layers: ["F.Cu", "B.Cu"],
      pointsMm: SQUARE,
      restrictions: {
        tracks: true,
        vias: true,
        pads: false,
        copperPour: false,
        footprints: false,
      },
    });
  });

  test("fail-closed rejections", () => {
    expect(parsePcbKeepoutRecord(keepout({ id: undefined }))).toBeNull();
    expect(parsePcbKeepoutRecord(keepout({ layers: [] }))).toBeNull();
    expect(parsePcbKeepoutRecord(keepout({ layers: undefined }))).toBeNull();
    expect(parsePcbKeepoutRecord(keepout({ layers: ["F.Cu", "F.SilkS"] }))).toBeNull();
    expect(parsePcbKeepoutRecord(keepout({ pointsMm: SQUARE.slice(0, 2) }))).toBeNull();
    expect(parsePcbKeepoutRecord(keepout({ pointsMm: undefined }))).toBeNull();
    expect(parsePcbKeepoutRecord(null)).toBeNull();
  });

  test("duplicate layers collapse; enabled and restrictions default", () => {
    const parsed = parsePcbKeepoutRecord(
      keepout({ layers: ["F.Cu", "F.Cu"], restrictions: undefined, enabled: false }),
    );
    expect(parsed?.layers).toEqual(["F.Cu"]);
    expect(parsed?.enabled).toBe(false);
    expect(parsed?.restrictions).toEqual({
      tracks: false,
      vias: false,
      pads: false,
      copperPour: false,
      footprints: false,
    });
  });

  test("an invalid ring parses (the derivation skips it), like a zone", () => {
    expect(
      parsePcbKeepoutRecord(
        keepout({
          pointsMm: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 10, y: 0 },
            { x: 0, y: 10 },
          ],
        }),
      ),
    ).not.toBeNull();
  });
});

describe("R1 review hardening", () => {
  test("a negative island threshold is malformed and dropped", () => {
    const { zone } = upgradePcbZoneRecord(v2({ islandRemoval: { minAreaMm2: -5 } }));
    expect(zone?.islandRemoval).toBeUndefined();
  });

  test("an empty-string netId reads as null", () => {
    const { zone } = upgradePcbZoneRecord(v2({ netId: "" }));
    expect(zone?.netId).toBeNull();
  });

  test("ring validity rejects strictly below the degenerate area, like the outline check", () => {
    // |area| = 1e-6 exactly: kept (not below the threshold).
    expect(
      zoneRingValidity([
        { x: 0, y: 0 },
        { x: 2e-3, y: 0 },
        { x: 0, y: 1e-3 },
      ]),
    ).toBe("ok");
    expect(
      zoneRingValidity([
        { x: 0, y: 0 },
        { x: 1e-3, y: 0 },
        { x: 0, y: 1e-3 },
      ]),
    ).toBe("zeroArea");
  });
});

/**
 * Zone cutouts (docs/pcb-hardening/04-copper-pour-contract.md §11): what parses
 * into `holesMm`, and the one validity test every writer and the derivation
 * share. Every failure is fail-closed — a region that cannot be subtracted
 * exactly is refused, never repaired by dropping the offending hole.
 */
describe("zone holes — parse", () => {
  const HOLE = [
    { x: -2, y: -2 },
    { x: 2, y: -2 },
    { x: 2, y: 2 },
    { x: -2, y: 2 },
  ];

  test("holesMm parses through the same point parser as the outer ring", () => {
    const { zone } = upgradePcbZoneRecord(
      v2({ region: { kind: "polygon", pointsMm: SQUARE, holesMm: [HOLE] } }),
    );
    expect(zone?.region.kind === "polygon" ? zone.region.holesMm : null).toEqual(
      [HOLE],
    );
  });

  test("an empty hole list normalises to an absent key", () => {
    const { zone } = upgradePcbZoneRecord(
      v2({ region: { kind: "polygon", pointsMm: SQUARE, holesMm: [] } }),
    );
    expect(zone?.region).not.toHaveProperty("holesMm");
  });

  test("a malformed hole list REJECTS the row (dropping it would pour more)", () => {
    for (const holesMm of [
      "nope",
      [[{ x: 0, y: 0 }]],
      [[{ x: 0, y: "1" }, { x: 1, y: 1 }, { x: 1, y: 0 }]],
    ]) {
      expect(
        upgradePcbZoneRecord(
          v2({ region: { kind: "polygon", pointsMm: SQUARE, holesMm } }),
        ).zone,
      ).toBeNull();
    }
  });

  test("the v1 upgrade never produces holes", () => {
    const { zone } = upgradePcbZoneRecord(v1({ holesMm: [HOLE] }));
    expect(zone?.region).toEqual({ kind: "polygon", pointsMm: SQUARE });
  });
});

describe("zoneRegionValidity (copper-pour contract §11)", () => {
  const inner = (s: number) => [
    { x: -s, y: -s },
    { x: s, y: -s },
    { x: s, y: s },
    { x: -s, y: s },
  ];
  const shifted = (dx: number, s = 1) =>
    inner(s).map((p) => ({ x: p.x + dx, y: p.y }));
  const polygon = (holesMm?: { x: number; y: number }[][]) =>
    ({ kind: "polygon", pointsMm: SQUARE, ...(holesMm ? { holesMm } : {}) }) as const;

  test("a board region and a hole-less polygon are ok", () => {
    expect(zoneRegionValidity({ kind: "board" })).toBe("ok");
    expect(zoneRegionValidity(polygon())).toBe("ok");
  });

  test("one hole strictly inside is ok", () => {
    expect(zoneRegionValidity(polygon([inner(2)]))).toBe("ok");
  });

  test("two disjoint holes are ok", () => {
    expect(zoneRegionValidity(polygon([shifted(-3), shifted(3)]))).toBe("ok");
  });

  test("the outer ring is judged first, with its own reason", () => {
    expect(
      zoneRegionValidity({
        kind: "polygon",
        pointsMm: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
        holesMm: [inner(1)],
      }),
    ).toBe("selfIntersecting");
  });

  test("hole_ring_invalid: a cutout that is not a usable ring", () => {
    expect(
      zoneRegionValidity(
        polygon([
          [
            { x: -2, y: -2 },
            { x: 2, y: 2 },
            { x: 2, y: -2 },
            { x: -2, y: 2 },
          ],
        ]),
      ),
    ).toBe("hole_ring_invalid");
  });

  test("hole_outside_outer: a vertex outside, and a hole entirely outside", () => {
    expect(zoneRegionValidity(polygon([shifted(6, 2)]))).toBe(
      "hole_outside_outer",
    );
    expect(zoneRegionValidity(polygon([shifted(20, 2)]))).toBe(
      "hole_outside_outer",
    );
  });

  test("hole_touches_outer: every vertex is inside but an edge crosses the outline", () => {
    // A U-shaped zone with a slot between x = -1 and x = 1. The cutout keeps
    // both its ends in the arms (strictly inside) yet its edges jump the slot,
    // so the vertex test alone would let this through.
    const U = [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: 1, y: 5 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: -1, y: 5 },
      { x: -5, y: 5 },
    ];
    expect(
      zoneRegionValidity({
        kind: "polygon",
        pointsMm: U,
        holesMm: [
          [
            { x: -3, y: 2 },
            { x: 3, y: 2 },
            { x: 3, y: 3 },
            { x: -3, y: 3 },
          ],
        ],
      }),
    ).toBe("hole_touches_outer");
  });

  test("holes_overlap: two cutouts sharing area, and two that only touch", () => {
    expect(zoneRegionValidity(polygon([shifted(-0.5), shifted(0.5)]))).toBe(
      "holes_overlap",
    );
    // Contact alone is enough — disjoint means disjoint as FILLED regions.
    expect(zoneRegionValidity(polygon([shifted(-1), shifted(1)]))).toBe(
      "holes_overlap",
    );
  });

  test("holes_nested: a cutout inside another cutout", () => {
    expect(zoneRegionValidity(polygon([inner(3), inner(1)]))).toBe(
      "holes_nested",
    );
  });

  test("isZoneHoleInvalidity separates hole reasons from ring reasons", () => {
    expect(isZoneHoleInvalidity("holes_nested")).toBe(true);
    expect(isZoneHoleInvalidity("selfIntersecting")).toBe(false);
    expect(isZoneHoleInvalidity("ok")).toBe(false);
  });
});
