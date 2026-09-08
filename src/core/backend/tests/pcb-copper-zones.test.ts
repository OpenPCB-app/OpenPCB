/**
 * The single copper-area derivation and its keepout twin
 * (docs/pcb-hardening/03-zone-keepout-contract.md §3.1). What enters the
 * effective list, what only warns, how a persisted BOARD ZONE row differs from
 * a polygon one, and the total order the pour keys depend on.
 */
import { describe, expect, test } from "bun:test";
import {
  boardZoneId,
  collectCopperZones,
  collectKeepouts,
} from "../../../shared/pcb-areas/copper-zones";
import type {
  PcbCopperLayerId,
  PcbKeepout,
  PcbZone,
} from "../../../sdks/designer";

/**
 * Every net id these fixtures use. `knownNetIds` is required since S4 (§13.3),
 * so a test that is not about staleness passes the full table.
 */
const KNOWN_NETS = new Set(["n1", "n2", "gnd", "other", "whatever"]);

const SQUARE = [
  { x: -5, y: -5 },
  { x: 5, y: -5 },
  { x: 5, y: 5 },
  { x: -5, y: 5 },
];

function zone(overrides: Partial<PcbZone> = {}): PcbZone {
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

/** A persisted board zone row: whole board, id derived from the layer. */
function boardZone(
  layer: PcbCopperLayerId,
  overrides: Partial<PcbZone> = {},
): PcbZone {
  return zone({
    id: boardZoneId(layer),
    layer,
    netId: "gnd",
    netName: null,
    region: { kind: "board" },
    ...overrides,
  });
}

function keepout(overrides: Partial<PcbKeepout> = {}): PcbKeepout {
  return {
    id: "k1",
    name: null,
    enabled: true,
    lockedAt: null,
    layers: ["F.Cu"],
    pointsMm: SQUARE,
    restrictions: {
      tracks: true,
      vias: false,
      pads: false,
      copperPour: false,
      footprints: false,
    },
    ...overrides,
  };
}

describe("explicit zones", () => {
  test("an enabled, valid, net-bound zone enters with its overrides resolved", () => {
    const { zones, warnings } = collectCopperZones({
      zones: [zone({ clearanceMm: 0.4, islandRemoval: "never" })],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(warnings).toEqual([]);
    expect(zones).toEqual([
      {
        id: "z1",
        sourceKind: "zone",
        name: null,
        layer: "F.Cu",
        netId: "n1",
        region: { kind: "polygon", pointsMm: SQUARE },
        priority: 0,
        padConnection: "solid",
        clearanceMm: 0.4,
        islandRemoval: "never",
      },
    ]);
  });

  test("a disabled zone is intent, not a warning", () => {
    expect(
      collectCopperZones({
        zones: [zone({ enabled: false })],
          layerCount: 2,
      knownNetIds: KNOWN_NETS,
      }),
    ).toEqual({ zones: [], warnings: [] });
  });

  test("a layer off the stackup warns and is skipped", () => {
    const { zones, warnings } = collectCopperZones({
      zones: [zone({ layer: "In1.Cu" })],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(zones).toEqual([]);
    expect(warnings.map((w) => [w.code, w.id])).toEqual([
      ["zone_layer_off_stackup", "z1"],
    ]);
    // The same zone is fine on a 4-layer board.
    expect(
      collectCopperZones({
        zones: [zone({ layer: "In1.Cu" })],
          layerCount: 4,
      knownNetIds: KNOWN_NETS,
      }).zones.map((z) => z.layer),
    ).toEqual(["In1.Cu"]);
  });

  test("an invalid ring warns and is skipped", () => {
    const { zones, warnings } = collectCopperZones({
      zones: [
        zone({
          region: {
            kind: "polygon",
            pointsMm: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
              { x: 10, y: 0 },
              { x: 0, y: 10 },
            ],
          },
        }),
      ],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(zones).toEqual([]);
    expect(warnings.map((w) => w.code)).toEqual(["zone_ring_invalid"]);
  });

  test("an unbound net pours nothing and warns", () => {
    const { zones, warnings } = collectCopperZones({
      zones: [zone({ netId: null, netName: "VCC" })],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(zones).toEqual([]);
    expect(warnings.map((w) => [w.code, w.id])).toEqual([
      ["zone_net_unresolved", "z1"],
    ]);
  });

  test("net-less copper (both null, or a blank name) enters with netId null", () => {
    for (const netName of [null, "", "   "]) {
      const { zones, warnings } = collectCopperZones({
        zones: [zone({ netId: null, netName })],
        layerCount: 2,
      knownNetIds: KNOWN_NETS,
      });
      expect(warnings).toEqual([]);
      expect(zones.map((z) => z.netId)).toEqual([null]);
    }
  });

  test("padConnection falls back to the constant default, else the row's own", () => {
    expect(
      collectCopperZones({ zones: [zone()], layerCount: 2 , knownNetIds: KNOWN_NETS}).zones[0]
        ?.padConnection,
    ).toBe("solid");
    expect(
      collectCopperZones({
        zones: [zone({ padConnection: "none" })],
        layerCount: 2,
      knownNetIds: KNOWN_NETS,
      }).zones[0]?.padConnection,
    ).toBe("none");
  });
});

describe("board zones", () => {
  test("a persisted board row enters below every zone, keyed board:<layer>", () => {
    const { zones, warnings } = collectCopperZones({
      zones: [zone({ priority: 0 }), boardZone("F.Cu"), boardZone("B.Cu")],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(warnings).toEqual([]);
    expect(zones.map((z) => z.id)).toEqual(["z1", "board:F.Cu", "board:B.Cu"]);
    const board = zones[1]!;
    expect(board.sourceKind).toBe("board");
    expect(board.region).toEqual({ kind: "board" });
    expect(board.netId).toBe("gnd");
    expect(board.priority).toBe(-1);
    expect(board.padConnection).toBe("solid");
    expect(board.priority).toBeLessThan(zones[0]!.priority);
  });

  test("a board row's own padConnection and overrides are honoured", () => {
    const { zones } = collectCopperZones({
      zones: [
        boardZone("F.Cu", {
          padConnection: "thermal",
          clearanceMm: 0.4,
          islandRemoval: "never",
        }),
      ],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(zones[0]?.padConnection).toBe("thermal");
    expect(zones[0]?.clearanceMm).toBe(0.4);
    expect(zones[0]?.islandRemoval).toBe("never");
  });

  test("board rows follow the stackup order, not the row order", () => {
    const { zones } = collectCopperZones({
      zones: [boardZone("B.Cu"), boardZone("In1.Cu"), boardZone("F.Cu")],
      layerCount: 4,
      knownNetIds: KNOWN_NETS,
    });
    expect(zones.map((z) => z.id)).toEqual([
      "board:F.Cu",
      "board:In1.Cu",
      "board:B.Cu",
    ]);
  });

  test("a board row whose id does not match its layer is skipped", () => {
    const { zones, warnings } = collectCopperZones({
      zones: [boardZone("F.Cu", { id: "board:B.Cu" })],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(zones).toEqual([]);
    expect(warnings.map((w) => [w.code, w.id])).toEqual([
      ["zone_board_id_mismatch", "board:B.Cu"],
    ]);
  });

  test("a board row with no net warns and pours nothing", () => {
    const { zones, warnings } = collectCopperZones({
      zones: [boardZone("F.Cu", { netId: null, netName: null })],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(zones).toEqual([]);
    expect(warnings.map((w) => [w.code, w.id])).toEqual([
      ["board_zone_no_net", "board:F.Cu"],
    ]);
  });

  test("a board row off the stackup warns and is skipped", () => {
    const { zones, warnings } = collectCopperZones({
      zones: [boardZone("In1.Cu")],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(zones).toEqual([]);
    expect(warnings.map((w) => [w.code, w.id])).toEqual([
      ["zone_layer_off_stackup", "board:In1.Cu"],
    ]);
  });

  test("a board row naming a deleted net is stale, not a phantom pour", () => {
    const { zones, warnings } = collectCopperZones({
      zones: [boardZone("F.Cu")],
      layerCount: 2,
      knownNetIds: new Set(["other"]),
    });
    expect(zones).toEqual([]);
    expect(warnings.map((w) => [w.code, w.id])).toEqual([
      ["zone_net_stale", "board:F.Cu"],
    ]);
  });

  test("two board rows on one layer collide on their id and both drop", () => {
    const { zones, warnings } = collectCopperZones({
      zones: [boardZone("F.Cu"), boardZone("F.Cu", { netId: "other" })],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(zones).toEqual([]);
    expect(warnings.map((w) => [w.code, w.id])).toEqual([
      ["zone_id_duplicate", "board:F.Cu"],
    ]);
  });

  test("no board row means no board zone", () => {
    expect(collectCopperZones({ zones: [], layerCount: 2 , knownNetIds: KNOWN_NETS}).zones).toEqual([]);
  });
});

describe("order and determinism", () => {
  const zones = [
    zone({ id: "b", priority: 1 }),
    zone({ id: "a", priority: 1 }),
    zone({ id: "c", priority: 5 }),
    zone({ id: "d", priority: 0 }),
    boardZone("F.Cu"),
    boardZone("B.Cu"),
  ];

  test("priority descending, then id ascending, then the board zones", () => {
    expect(
      collectCopperZones({ zones, layerCount: 2 , knownNetIds: KNOWN_NETS}).zones.map((z) => z.id),
    ).toEqual(["c", "a", "b", "d", "board:F.Cu", "board:B.Cu"]);
  });

  test("permuting the input changes nothing", () => {
    const base = collectCopperZones({ zones, layerCount: 2 , knownNetIds: KNOWN_NETS});
    const permutations = [
      [...zones].reverse(),
      [zones[2]!, zones[5]!, zones[0]!, zones[3]!, zones[4]!, zones[1]!],
      [zones[3]!, zones[1]!, zones[4]!, zones[2]!, zones[5]!, zones[0]!],
    ];
    for (const permuted of permutations) {
      expect(collectCopperZones({ zones: permuted, layerCount: 2 , knownNetIds: KNOWN_NETS})).toEqual(
        base,
      );
    }
  });

  test("the same values in different objects give a deep-equal result", () => {
    const twin = zones.map((z) => structuredClone(z));
    expect(collectCopperZones({ zones: twin, layerCount: 2 , knownNetIds: KNOWN_NETS})).toEqual(
      collectCopperZones({ zones, layerCount: 2 , knownNetIds: KNOWN_NETS}),
    );
  });

  test("the derivation does not mutate its input", () => {
    const input = [
      zone({ id: "b", priority: 1 }),
      zone({ id: "a", priority: 9 }),
      boardZone("F.Cu"),
    ];
    const snapshot = structuredClone(input);
    collectCopperZones({ zones: input, layerCount: 2 , knownNetIds: KNOWN_NETS});
    expect(input).toEqual(snapshot);
  });
});

describe("collectKeepouts", () => {
  test("layers are intersected with the stackup and the ring canonicalised", () => {
    const { keepouts, warnings } = collectKeepouts({
      keepouts: [
        keepout({
          layers: ["B.Cu", "In1.Cu", "F.Cu"],
          pointsMm: [SQUARE[0]!, ...SQUARE],
        }),
      ],
      layerCount: 2,
    });
    expect(warnings).toEqual([]);
    expect(keepouts[0]?.layers).toEqual(["F.Cu", "B.Cu"]);
    expect(keepouts[0]?.pointsMm).toEqual(SQUARE);
  });

  test("a disabled keepout affects nothing, without a warning", () => {
    expect(
      collectKeepouts({ keepouts: [keepout({ enabled: false })], layerCount: 2 }),
    ).toEqual({ keepouts: [], warnings: [] });
  });

  test("no layer on the stackup warns and is skipped", () => {
    const { keepouts, warnings } = collectKeepouts({
      keepouts: [keepout({ layers: ["In1.Cu"] })],
      layerCount: 2,
    });
    expect(keepouts).toEqual([]);
    expect(warnings.map((w) => [w.code, w.id])).toEqual([
      ["keepout_layer_off_stackup", "k1"],
    ]);
  });

  test("an invalid ring warns and is skipped", () => {
    const { keepouts, warnings } = collectKeepouts({
      keepouts: [
        keepout({
          pointsMm: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 20, y: 0 },
          ],
        }),
      ],
      layerCount: 2,
    });
    expect(keepouts).toEqual([]);
    expect(warnings.map((w) => w.code)).toEqual(["keepout_ring_invalid"]);
  });

  test("permuting the input changes nothing", () => {
    const input = [keepout({ id: "k2" }), keepout({ id: "k1" }), keepout({ id: "k3" })];
    const base = collectKeepouts({ keepouts: input, layerCount: 2 });
    expect(base.keepouts.map((k) => k.id)).toEqual(["k1", "k2", "k3"]);
    expect(collectKeepouts({ keepouts: [...input].reverse(), layerCount: 2 })).toEqual(
      base,
    );
  });
});

describe("producer hardening (R1 review)", () => {
  test("a non-finite or fractional priority cannot break the total order", () => {
    const input = [
      zone({ id: "a", priority: 1 }),
      zone({ id: "b", priority: Number.NaN }),
      zone({ id: "d", priority: Number.POSITIVE_INFINITY }),
      zone({ id: "c", priority: 5 }),
      zone({ id: "e", priority: 2.9 }),
    ];
    const base = collectCopperZones({ zones: input, layerCount: 2 , knownNetIds: KNOWN_NETS});
    expect(base.zones.map((z) => [z.id, z.priority])).toEqual([
      ["c", 5],
      ["e", 2],
      ["a", 1],
      ["b", 0],
      ["d", 0],
    ]);
    expect(
      collectCopperZones({ zones: [...input].reverse(), layerCount: 2 , knownNetIds: KNOWN_NETS}),
    ).toEqual(base);
  });

  test("a board row's persisted priority is ignored, never ranked above a zone", () => {
    const out = collectCopperZones({
      zones: [zone({ id: "z", priority: 0 }), boardZone("F.Cu", { priority: 7 })],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(out.zones.map((z) => [z.id, z.priority])).toEqual([
      ["z", 0],
      ["board:F.Cu", -1],
    ]);
  });

  test("warnings are permutation-invariant too", () => {
    const input = [
      zone({ id: "a", layer: "In1.Cu" }),
      zone({ id: "b", netId: null, netName: "MISSING" }),
    ];
    const ab = collectCopperZones({ zones: input, layerCount: 2 , knownNetIds: KNOWN_NETS});
    const ba = collectCopperZones({ zones: [...input].reverse(), layerCount: 2 , knownNetIds: KNOWN_NETS});
    expect(ab.warnings.length).toBe(2);
    expect(ba).toEqual(ab);
  });

  test("the board: id prefix is reserved for board rows", () => {
    const out = collectCopperZones({
      zones: [zone({ id: "board:F.Cu", netId: "n1" }), zone({ id: "ok" })],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(out.zones.map((z) => z.id)).toEqual(["ok"]);
    expect(out.warnings.map((w) => [w.code, w.id])).toEqual([
      ["zone_id_reserved", "board:F.Cu"],
    ]);
  });

  test("duplicate ids drop every holder", () => {
    const out = collectCopperZones({
      zones: [
        zone({ id: "dup", netId: "n1" }),
        zone({ id: "dup", netId: "n2" }),
        zone({ id: "ok" }),
      ],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(out.zones.map((z) => z.id)).toEqual(["ok"]);
    expect(out.warnings.map((w) => [w.code, w.id])).toEqual([
      ["zone_id_duplicate", "dup"],
    ]);
  });

  test("an empty-string net id is null: net-less for a zone, no net for a board row", () => {
    const out = collectCopperZones({
      zones: [
        zone({ id: "z", netId: "", netName: null }),
        boardZone("F.Cu", { netId: "", netName: null }),
      ],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(out.zones.map((z) => [z.id, z.netId])).toEqual([["z", null]]);
    expect(out.warnings.map((w) => w.code)).toEqual(["board_zone_no_net"]);
  });
});

describe("stale persisted net ids (Astra finding 9)", () => {
  test("a netId that names no current net is unbound and warns", () => {
    const out = collectCopperZones({
      zones: [zone({ id: "z", netId: "deleted-net", netName: null })],
      layerCount: 2,
      knownNetIds: new Set(["n1"]),
    });
    expect(out.zones).toEqual([]);
    expect(out.warnings.map((w) => w.code)).toEqual(["zone_net_stale"]);
  });
  test("a netId the table knows is trusted", () => {
    const out = collectCopperZones({
      zones: [zone({ id: "z", netId: "whatever", netName: null })],
      layerCount: 2,
      knownNetIds: new Set(["whatever"]),
    });
    expect(out.zones.map((z) => z.netId)).toEqual(["whatever"]);
  });

  test("an empty net table makes every persisted id stale", () => {
    const out = collectCopperZones({
      zones: [zone({ id: "z", netId: "n1", netName: null })],
      layerCount: 2,
      knownNetIds: new Set(),
    });
    expect(out.zones).toEqual([]);
    expect(out.warnings.map((w) => w.code)).toEqual(["zone_net_stale"]);
  });
});

/**
 * Zone cutouts (docs/pcb-hardening/04-copper-pour-contract.md §11): the
 * derivation carries a valid `holesMm` through untouched and DROPS a zone whose
 * cutouts it cannot subtract — a zone that would pour more than it was drawn
 * with is refused, not repaired.
 */
describe("zone holes", () => {
  const HOLE = [
    { x: -2, y: -2 },
    { x: 2, y: -2 },
    { x: 2, y: 2 },
    { x: -2, y: 2 },
  ];

  test("a valid cutout rides through the effective zone unchanged", () => {
    const row = zone({
      region: { kind: "polygon", pointsMm: SQUARE, holesMm: [HOLE] },
    });
    const { zones, warnings } = collectCopperZones({
      zones: [row],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(warnings).toHaveLength(0);
    expect(zones).toHaveLength(1);
    expect(zones[0]?.region).toBe(row.region);
  });

  test("an invalid cutout drops the zone with zone_hole_invalid", () => {
    const { zones, warnings } = collectCopperZones({
      zones: [
        zone({
          region: {
            kind: "polygon",
            pointsMm: SQUARE,
            // Two cutouts nested inside one another.
            holesMm: [
              HOLE,
              [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
              ],
            ],
          },
        }),
      ],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(zones).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe("zone_hole_invalid");
    expect(warnings[0]?.detail).toContain("holes_nested");
  });

  test("an invalid OUTER ring still reports zone_ring_invalid, not the hole code", () => {
    const { warnings } = collectCopperZones({
      zones: [
        zone({
          region: {
            kind: "polygon",
            pointsMm: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
              { x: 10, y: 0 },
              { x: 0, y: 10 },
            ],
            holesMm: [HOLE],
          },
        }),
      ],
      layerCount: 2,
      knownNetIds: KNOWN_NETS,
    });
    expect(warnings[0]?.code).toBe("zone_ring_invalid");
  });
});
