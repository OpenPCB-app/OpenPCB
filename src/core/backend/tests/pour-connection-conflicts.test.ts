/**
 * Same-net pour connection conflicts (H19 / OPENPCB-67 §3.9.1): two enabled
 * same-net pours covering one pad must resolve its connection identically, or
 * the per-net union silently keeps the more-copper one.
 */
import { describe, expect, test } from "bun:test";
import { collectCopperZones } from "../../../shared/pcb-areas/copper-zones";
import { findPourConnectionConflicts } from "../../../shared/pcb-areas/pour-connection-conflicts";
import { buildCopperRecords } from "../../../shared/pcb-connectivity/copper-records";
import type {
  PcbBoardSettings,
  PcbFreePad,
  PcbPlacedPart,
  PcbZone,
  PcbZonePadConnection,
} from "../../../sdks/designer";
import { board, boardWithRules, freePad, pad, placement } from "./helpers/drc-fixtures";

const SQUARE = [
  { x: -5, y: -5 },
  { x: 5, y: -5 },
  { x: 5, y: 5 },
  { x: -5, y: 5 },
];

function zone(
  id: string,
  opts: {
    board?: boolean;
    layer?: PcbZone["layer"];
    netId?: string | null;
    padConnection?: PcbZonePadConnection;
    thermal?: PcbZone["thermal"];
    minWidthMm?: number | null;
    enabled?: boolean;
    pointsMm?: { x: number; y: number }[];
    holesMm?: { x: number; y: number }[][];
  } = {},
): PcbZone {
  const layer = opts.layer ?? "F.Cu";
  return {
    id: opts.board ? `board:${layer}` : id,
    name: null,
    enabled: opts.enabled ?? true,
    lockedAt: null,
    layer,
    netId: opts.netId === undefined ? "GND" : opts.netId,
    netName: null,
    region: opts.board
      ? { kind: "board" }
      : {
          kind: "polygon",
          pointsMm: opts.pointsMm ?? SQUARE,
          ...(opts.holesMm ? { holesMm: opts.holesMm } : {}),
        },
    priority: 0,
    ...(opts.padConnection ? { padConnection: opts.padConnection } : {}),
    ...(opts.thermal !== undefined ? { thermal: opts.thermal } : {}),
    ...(opts.minWidthMm !== undefined ? { minWidthMm: opts.minWidthMm } : {}),
  };
}

const THT = placement("J1", {
  pads: [pad("1", { x: 0, y: 0 }, 1.6, 1.6, { shape: "circle", drillDiameterMm: 0.8 })],
});
const SMD = placement("U1", { pads: [pad("1", { x: 0, y: 0 }, 1, 0.6)] });

function run(args: {
  zones: PcbZone[];
  placements?: PcbPlacedPart[];
  freePads?: PcbFreePad[];
  padNets?: Record<string, string>;
  board?: PcbBoardSettings;
}) {
  const settings = args.board ?? board();
  const placements = args.placements ?? [THT];
  const padNets =
    args.padNets ??
    Object.fromEntries(placements.map((p) => [`${p.id}|1`, "GND"]));
  const freePads = args.freePads ?? [];
  const records = buildCopperRecords({
    layerCount: settings.layerCount,
    placements,
    padNetIds: new Map(Object.entries(padNets)),
    freePads,
    traces: [],
    vias: [],
  });
  const zones = collectCopperZones({
    zones: args.zones,
    layerCount: settings.layerCount,
    knownNetIds: new Set(["GND", "VCC"]),
  }).zones;
  return findPourConnectionConflicts({
    zones,
    records,
    freePads,
    designRules: settings.designRules,
  });
}

describe("findPourConnectionConflicts", () => {
  test("solid board + thermal polygon, same net, over a THT pad → one conflict", () => {
    const conflicts = run({
      zones: [
        zone("b", { board: true }),
        zone("z1", { padConnection: "thermal", thermal: { gapMm: 0.4, spokeWidthMm: 0.4 } }),
      ],
    });
    expect(conflicts).toEqual([
      {
        layer: "F.Cu",
        netId: "GND",
        pad: { kind: "pad", placementId: "J1", padNumber: "1" },
        zones: [
          { zoneId: "board:F.Cu", isBoard: true, resolved: "solid", gapMm: null, spokeWidthMm: null },
          { zoneId: "z1", isBoard: false, resolved: "thermal", gapMm: 0.4, spokeWidthMm: 0.4 },
        ],
      },
    ]);
  });

  test("board pour inheriting the polygon's thermal with the same gap/spoke → none", () => {
    const thermal = { gapMm: 0.4, spokeWidthMm: 0.4 };
    expect(
      run({
        zones: [
          zone("b", { board: true, padConnection: "thermal", thermal }),
          zone("z1", { padConnection: "thermal", thermal }),
        ],
      }),
    ).toEqual([]);
  });

  test("an absent thermal resolves to the kernel defaults, so it matches explicit defaults", () => {
    expect(
      run({
        zones: [
          zone("b", { board: true, padConnection: "thermal" }),
          zone("z1", { padConnection: "thermal", thermal: { gapMm: 0.4, spokeWidthMm: 0.4 } }),
        ],
      }),
    ).toEqual([]);
  });

  test("thermal gap 0.4 vs 0.5 → conflict", () => {
    const conflicts = run({
      zones: [
        zone("z1", { padConnection: "thermal", thermal: { gapMm: 0.4, spokeWidthMm: 0.4 } }),
        zone("z2", { padConnection: "thermal", thermal: { gapMm: 0.5, spokeWidthMm: 0.4 } }),
      ],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.zones.map((z) => z.gapMm)).toEqual([0.4, 0.5]);
  });

  test("spoke widths below the min-width floor resolve equal → none", () => {
    expect(
      run({
        board: boardWithRules({ minimums: { traceWidthMm: 0.3 } }),
        zones: [
          zone("z1", { padConnection: "thermal", thermal: { gapMm: 0.4, spokeWidthMm: 0.2 } }),
          zone("z2", { padConnection: "thermal", thermal: { gapMm: 0.4, spokeWidthMm: 0.25 } }),
        ],
      }),
    ).toEqual([]);
  });

  test("a zone min-width raising one zone's spoke → conflict", () => {
    const thermal = { gapMm: 0.4, spokeWidthMm: 0.4 };
    const conflicts = run({
      zones: [
        zone("z1", { padConnection: "thermal", thermal }),
        zone("z2", { padConnection: "thermal", thermal, minWidthMm: 0.5 }),
      ],
    });
    expect(conflicts.map((c) => c.zones.map((z) => z.spokeWidthMm))).toEqual([[0.4, 0.5]]);
  });

  test("thruHoleThermal vs thermal: SMD pad conflicts (none vs thermal), THT pad does not", () => {
    const zones = [
      zone("z1", { padConnection: "thruHoleThermal" }),
      zone("z2", { padConnection: "thermal" }),
    ];
    const smd = run({ zones, placements: [SMD] });
    expect(smd).toHaveLength(1);
    expect(smd[0]!.zones.map((z) => z.resolved)).toEqual(["none", "thermal"]);
    expect(run({ zones, placements: [THT] })).toEqual([]);
  });

  test("a std free pad without a drill is drilled for thruHoleThermal, as in the kernel", () => {
    const freePads = [freePad("fp1", { padType: "std", netId: "GND", drillMm: null })];
    const zones = [
      zone("z1", { padConnection: "thruHoleThermal" }),
      zone("z2", { padConnection: "thermal" }),
    ];
    expect(run({ zones, placements: [], freePads })).toEqual([]);
    const smdPads = [freePad("fp2", { padType: "smd", netId: "GND" })];
    expect(
      run({ zones, placements: [], freePads: smdPads }).map((c) => c.pad),
    ).toEqual([{ kind: "freePad", freePadId: "fp2" }]);
  });

  test("a pad outside the polygon, or inside its cutout, is not covered → none", () => {
    const outside = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ];
    expect(
      run({
        zones: [
          zone("b", { board: true }),
          zone("z1", { padConnection: "thermal", pointsMm: outside }),
        ],
      }),
    ).toEqual([]);
    const hole = [
      { x: -2, y: -2 },
      { x: 2, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: 2 },
    ];
    expect(
      run({
        zones: [
          zone("b", { board: true }),
          zone("z1", { padConnection: "thermal", holesMm: [hole] }),
        ],
      }),
    ).toEqual([]);
  });

  test("different nets → none", () => {
    expect(
      run({
        zones: [
          zone("b", { board: true }),
          zone("z1", { padConnection: "thermal", netId: "VCC" }),
        ],
      }),
    ).toEqual([]);
  });

  test("a disabled zone is ignored", () => {
    expect(
      run({
        zones: [
          zone("b", { board: true, enabled: false }),
          zone("z1", { padConnection: "thermal" }),
        ],
      }),
    ).toEqual([]);
  });

  test("order is deterministic: (layer, netId, pad key) whatever the input order", () => {
    const placements = [
      placement("J2", {
        pads: [pad("1", { x: 1, y: 1 }, 1.6, 1.6, { shape: "circle", drillDiameterMm: 0.8 })],
      }),
      THT,
    ];
    const zones = [
      zone("b", { board: true }),
      zone("z1", { padConnection: "thermal" }),
      zone("bb", { board: true, layer: "B.Cu" }),
      zone("z2", { padConnection: "thermal", layer: "B.Cu" }),
    ];
    const forward = run({ zones, placements });
    const reversed = run({
      zones: [...zones].reverse(),
      placements: [...placements].reverse(),
    });
    expect(forward).toEqual(reversed);
    expect(
      forward.map((c) => `${c.layer}:${c.pad.kind === "pad" ? c.pad.placementId : ""}`),
    ).toEqual(["B.Cu:J1", "B.Cu:J2", "F.Cu:J1", "F.Cu:J2"]);
  });
});
