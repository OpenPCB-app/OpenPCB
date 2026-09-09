// buildBoardSnapshot: projection → cloud auto-router BoardSnapshot.
// Verifies the unit contract (traces nm, everything else mm), pad-outline
// expansion (through-hole spans both layers), the empty-pours / zones-warning
// rule, net-class filtering, and determinism.
import { describe, expect, test } from "bun:test";
import { buildBoardSnapshot } from "../../../modules/designer/backend/pcb/board-snapshot";
import { buildSnapshotPourIslands } from "../../../modules/designer/backend/pcb/board-snapshot-pours";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import { boardZoneRow, keepoutRow } from "./helpers/pcb-zone-fixtures";
import type { FootprintRenderSourcePad } from "../../../shared/rendering/types";
import type {
  DesignerPcbProjection,
  PcbBoardSettings,
  PcbFreeHole,
  PcbFreePad,
  PcbKeepout,
  PcbPointMm,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  PcbZone,
  PourIsland,
  RatsnestSegment,
} from "../../../sdks/designer";

const TS = "2026-01-01T00:00:00.000Z";

function board(overrides: Partial<PcbBoardSettings> = {}): PcbBoardSettings {
  return { ...createDefaultPcbBoardSettings(TS), ...overrides };
}

function projection(
  parts: Partial<DesignerPcbProjection> = {},
): DesignerPcbProjection {
  return {
    designId: "d1",
    revision: 7,
    board: parts.board ?? board(),
    placements: parts.placements ?? [],
    traces: parts.traces ?? [],
    vias: parts.vias ?? [],
    freeHoles: parts.freeHoles ?? [],
    freePads: parts.freePads ?? [],
    overlayTexts: parts.overlayTexts ?? [],
    overlayShapes: parts.overlayShapes ?? [],
    zones: parts.zones ?? [],
    keepouts: parts.keepouts ?? [],
    ratsnest: parts.ratsnest ?? [],
    netNames: parts.netNames ?? {},
    padNets: parts.padNets,
    warnings: [],
  };
}

function smdPad(
  number: string,
  center: { x: number; y: number },
): FootprintRenderSourcePad {
  return {
    id: `pad-${number}`,
    number,
    shape: "rect",
    centerMm: center,
    widthMm: 1,
    heightMm: 1,
    rotationDeg: 0,
  };
}

function thPad(
  number: string,
  center: { x: number; y: number },
): FootprintRenderSourcePad {
  return { ...smdPad(number, center), shape: "circle", drillDiameterMm: 0.4 };
}

function placement(
  id: string,
  pads: FootprintRenderSourcePad[],
  positionMm = { x: 0, y: 0 },
  mountType: string | null = null,
): PcbPlacedPart {
  return {
    id,
    partId: id,
    componentId: "c",
    reference: id,
    positionMm,
    rotationDeg: 0,
    mirrored: false,
    layer: "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType,
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
  };
}

function freePad(overrides: Partial<PcbFreePad> = {}): PcbFreePad {
  return {
    id: "fp1",
    centerMm: { x: 0, y: 0 },
    rotationDeg: 0,
    padType: "smd",
    shape: "circle",
    widthMm: 1,
    heightMm: 1,
    drillMm: null,
    layer: "F.Cu",
    netId: null,
    solderMaskExpansionMm: null,
    solderPasteExpansionMm: null,
    lockedAt: null,
    ...overrides,
  };
}

function via(overrides: Partial<PcbVia> = {}): PcbVia {
  return {
    id: "v1",
    netId: "net_a",
    netClassId: "default",
    centerMm: { x: 0, y: 0 },
    diameterMm: 0.6,
    drillMm: 0.3,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    protection: "tented",
    provenance: "route",
    ...overrides,
  };
}

function rats(netId: string, netClassId = "default"): RatsnestSegment {
  return {
    netId,
    netClassId,
    fromMm: { x: 1, y: 1 },
    toMm: { x: 9, y: 1 },
    from: { kind: "pad", placementId: "U1", padNumber: "1" },
    to: { kind: "pad", placementId: "U2", padNumber: "1" },
  };
}

function zone(overrides: Partial<PcbZone> = {}): PcbZone {
  return {
    id: "z1",
    name: null,
    enabled: true,
    lockedAt: null,
    netName: "GND",
    netId: "net_gnd",
    layer: "F.Cu",
    region: {
      kind: "polygon",
      pointsMm: [
        { x: -10, y: -5 },
        { x: 10, y: -5 },
        { x: 10, y: 5 },
        { x: -10, y: 5 },
      ],
    },
    priority: 0,
    ...overrides,
  };
}

/** The board-wide GND fill, now a persisted board zone row on F.Cu. */
const FILL_ZONES = [boardZoneRow("F.Cu", "net_gnd")];

function freeHole(overrides: Partial<PcbFreeHole> = {}): PcbFreeHole {
  return {
    id: "h1",
    centerMm: { x: 0, y: 0 },
    drillMm: 1,
    lockedAt: null,
    ...overrides,
  };
}

function ringArea(ring: readonly PcbPointMm[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!a || !b) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function maxDecimalPlaces(value: number): number {
  const text = value.toString();
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

function definedPours(pours: PourIsland[] | undefined): PourIsland[] {
  expect(pours).toBeDefined();
  return pours ?? [];
}

describe("buildBoardSnapshot", () => {
  test("maps a simple 2-net board, pours always empty", () => {
    const proj = projection({
      placements: [
        placement("U1", [
          smdPad("1", { x: 0, y: 0 }),
          smdPad("2", { x: 2, y: 0 }),
        ]),
      ],
      padNets: { "U1|1": "net_a", "U1|2": "net_b" },
      netNames: { net_a: "NET_A", net_b: "NET_B" },
      ratsnest: [rats("net_a")],
    });

    const { snapshot, warnings } = buildBoardSnapshot(proj);

    expect(snapshot.designId).toBe("d1");
    expect(snapshot.baseRevision).toBe(7);
    expect(snapshot.pours).toEqual([]);
    expect(snapshot.stackup.copperLayers).toEqual(["F.Cu", "B.Cu"]);
    expect(snapshot.designRules.fabPresetId).toBe(proj.board.fabricator);
    // Copied, not aliased: the builder strips desktop-only routing hints
    // (diffPairGapMm) to keep the cloud wire schema byte-stable.
    expect(snapshot.netClasses).toEqual(proj.board.netClasses);
    expect(snapshot.netClasses!.every((c) => !("diffPairGapMm" in c))).toBe(
      true,
    );
    expect(snapshot.ratsnest).toHaveLength(1);
    // outline is one ring of >=3 mm points (small magnitude)
    expect(snapshot.board.outline).toHaveLength(1);
    expect(snapshot.board.outline[0]!.length).toBeGreaterThanOrEqual(3);
    // two SMD pads → two single-layer pad outlines, nets resolved from padNets
    expect(snapshot.padOutlines).toHaveLength(2);
    expect(snapshot.padOutlines!.every((p) => p.layer === "F.Cu")).toBe(true);
    expect(snapshot.padOutlines!.map((p) => p.netId).sort()).toEqual([
      "net_a",
      "net_b",
    ]);
    expect(warnings).toEqual([]);
  });

  test("trace pointsNm pass through as integer nanometers (no conversion)", () => {
    const trace: PcbTrace = {
      id: "t1",
      netId: "net_a",
      netClassId: "default",
      layer: "F.Cu",
      widthMm: 0.2,
      pointsNm: [
        { x: 5_000_000, y: 5_000_000 },
        { x: 45_000_000, y: 5_000_000 },
      ],
      segmentMode: "manhattan-45",
    };
    const { snapshot } = buildBoardSnapshot(
      projection({ traces: [trace], ratsnest: [rats("net_a")] }),
    );
    expect(snapshot.traces).toHaveLength(1);
    expect(snapshot.traces![0]!.pointsNm).toEqual([
      { x: 5_000_000, y: 5_000_000 },
      { x: 45_000_000, y: 5_000_000 },
    ]);
  });

  // The wire schema is byte-stable: `ClearanceRules` / `MinimumRules` in the
  // vendored `board-snapshot.generated.ts` declare neither S6 key, and the
  // cloud router routes at the implicit tier (rule-semantics contract §13).
  test("the S6 desktop-only design-rule keys are stripped from the snapshot", () => {
    const base = createDefaultPcbBoardSettings(TS);
    const { snapshot } = buildBoardSnapshot(
      projection({
        board: board({
          designRules: {
            clearance: {
              ...base.designRules.clearance,
              pourToCopperMm: 0.45,
              copperToHoleMm: 0.35,
            },
            minimums: { ...base.designRules.minimums, clearanceMm: 0.12 },
          },
        }),
      }),
    );
    expect("pourToCopperMm" in snapshot.designRules.clearance).toBe(false);
    expect("copperToHoleMm" in snapshot.designRules.clearance).toBe(false);
    expect("clearanceMm" in snapshot.designRules.minimums).toBe(false);
    // Everything else still ships verbatim.
    expect(snapshot.designRules.clearance.traceToTraceMm).toBe(
      base.designRules.clearance.traceToTraceMm,
    );
    expect(snapshot.designRules.minimums.traceWidthMm).toBe(
      base.designRules.minimums.traceWidthMm,
    );
  });

  test("through-hole pad spans both copper layers", () => {
    const { snapshot } = buildBoardSnapshot(
      projection({
        placements: [placement("U1", [thPad("1", { x: 0, y: 0 })])],
        padNets: { "U1|1": "net_a" },
      }),
    );
    expect(snapshot.padOutlines).toHaveLength(2);
    expect(snapshot.padOutlines!.map((p) => p.layer).sort()).toEqual([
      "B.Cu",
      "F.Cu",
    ]);
  });

  test("copper zones produce a warning but pours stay empty", () => {
    const { snapshot, warnings } = buildBoardSnapshot(
      projection({ zones: [zone()], ratsnest: [rats("net_a")] }),
    );
    expect(snapshot.pours).toEqual([]);
    expect(warnings.some((w) => w.includes("zone"))).toBe(true);
  });

  test("explicit zone emits pour island when serializePours is true", () => {
    const { snapshot, warnings } = buildBoardSnapshot(
      projection({
        zones: [zone()],
        netNames: { net_gnd: "GND" },
        ratsnest: [rats("net_gnd")],
      }),
      { serializePours: true },
    );
    expect(warnings.some((w) => w.includes("zone"))).toBe(false);
    const pours = definedPours(snapshot.pours);
    expect(pours).toHaveLength(1);
    const pour = pours.at(0);
    expect(pour?.layer).toBe("F.Cu");
    expect(pour?.pourNetId).toBe("net_gnd");
    expect(pour?.islandId.startsWith("pour-")).toBe(true);
    expect(pour?.rings.length).toBeGreaterThan(0);
  });

  test("board-wide fill emits pour island when serializePours is true", () => {
    const { snapshot } = buildBoardSnapshot(
      projection({
        board: board(),
        zones: FILL_ZONES,
        netNames: { net_gnd: "GND" },
        ratsnest: [rats("net_gnd")],
      }),
      { serializePours: true },
    );
    const pours = definedPours(snapshot.pours);
    expect(pours).toHaveLength(1);
    expect(pours.at(0)?.layer).toBe("F.Cu");
    expect(pours.at(0)?.pourNetId).toBe("net_gnd");
  });

  test("serialized pour islands are deterministic", () => {
    const make = () =>
      JSON.stringify(
        buildBoardSnapshot(
          projection({
            board: board(),
            zones: FILL_ZONES,
            freeHoles: [freeHole()],
            netNames: { net_gnd: "GND" },
            ratsnest: [rats("net_gnd")],
          }),
          { serializePours: true },
        ).snapshot.pours,
      );
    expect(make()).toBe(make());
  });

  test("serialized pour island id is a stable content-addressed hash", () => {
    // Pins the wire contract: `islandId` is
    // `pour-${fnv1a64(sourceOrder|geometryOrder)}` — content-addressed off the
    // effective zone id and the normalized ring geometry, sorted by
    // (sourceOrder, geometryOrder). A silent change to that derivation (hash
    // input order, ring normalization, quantization) would break every
    // consumer that persists or diffs `islandId` across runs, so this pins the
    // literal value rather than only re-asserting equality-with-itself.
    const { snapshot } = buildBoardSnapshot(
      projection({
        board: board(),
        zones: FILL_ZONES,
        freeHoles: [freeHole()],
        netNames: { net_gnd: "GND" },
        ratsnest: [rats("net_gnd")],
      }),
      { serializePours: true },
    );
    const pours = definedPours(snapshot.pours);
    // Re-pinned once during S5 itself: the Astra run 2 fixes (every extent
    // inset by one grid step, obstacle winding normalisation) moved the ring
    // by 0.1 µm and with it the content hash. Any later change of this literal
    // is a wire-contract change for the cloud autorouter.
    expect(pours.map((p) => p.islandId)).toEqual(["pour-05b59122ec5b86e9"]);
  });

  test("serialized pour rings are quantized and normalized", () => {
    const { snapshot } = buildBoardSnapshot(
      projection({
        board: board(),
        zones: FILL_ZONES,
        freeHoles: [freeHole()],
        netNames: { net_gnd: "GND" },
        ratsnest: [rats("net_gnd")],
      }),
      { serializePours: true },
    );
    const pour = definedPours(snapshot.pours).at(0);
    expect(pour).toBeDefined();
    const rings = pour?.rings ?? [];
    const outer = rings.at(0) ?? [];
    expect(ringArea(outer)).toBeGreaterThan(0);
    for (const ring of rings) {
      for (const point of ring) {
        expect(maxDecimalPlaces(point.x)).toBeLessThanOrEqual(4);
        expect(maxDecimalPlaces(point.y)).toBeLessThanOrEqual(4);
      }
    }
    const holes = rings.slice(1);
    expect(holes.length).toBeGreaterThan(0);
    expect(holes.every((ring) => ringArea(ring) < 0)).toBe(true);
  });

  test("a copperPour keepout is a hole in the serialized pour island", () => {
    // Fill parity (contract §13.3): the snapshot subtracts the same keepouts
    // the canvas, the Gerber and DRC do, so the autorouter is never told about
    // copper the board will not manufacture.
    const KEEPOUT: PcbPointMm[] = [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: -5, y: 5 },
    ];
    const build = (keepouts: PcbKeepout[]) =>
      buildBoardSnapshot(
        projection({
          board: board(),
          zones: FILL_ZONES,
          keepouts,
          netNames: { net_gnd: "GND" },
          ratsnest: [rats("net_gnd")],
        }),
        { serializePours: true },
      ).snapshot;

    const plain = definedPours(build([]).pours).at(0)!;
    expect(plain.rings.slice(1)).toHaveLength(0);

    const carved = definedPours(
      build([
        keepoutRow("k1", ["F.Cu"], KEEPOUT, {
          tracks: false,
          vias: false,
          pads: false,
          footprints: false,
          copperPour: true,
        }),
      ]).pours,
    ).at(0)!;
    const holes = carved.rings.slice(1);
    expect(holes).toHaveLength(1);
    const xs = holes[0]!.map((p) => p.x);
    const ys = holes[0]!.map((p) => p.y);
    // The kernel inflates the ring by one output-grid step (0.1 µm) before
    // subtracting, so the hole is the keepout plus at most that much.
    expect(Math.min(...xs)).toBeCloseTo(-5, 3);
    expect(Math.max(...xs)).toBeCloseTo(5, 3);
    expect(Math.min(...ys)).toBeCloseTo(-5, 3);
    expect(Math.max(...ys)).toBeCloseTo(5, 3);
  });

  test("net-class filtering drops non-routable ratsnest targets", () => {
    const proj = projection({
      ratsnest: [rats("net_a", "default"), rats("net_p", "power")],
    });
    const { snapshot } = buildBoardSnapshot(proj, {
      routableNetClassIds: ["default"],
    });
    expect(snapshot.ratsnest).toHaveLength(1);
    expect(snapshot.ratsnest![0]!.netClassId).toBe("default");
  });

  test("free-pad-anchored airwires are dropped with a warning", () => {
    const freePadSeg: RatsnestSegment = {
      ...rats("net_a"),
      from: { kind: "freePad", freePadId: "tp1" },
    };
    const { snapshot, warnings } = buildBoardSnapshot(
      projection({ ratsnest: [rats("net_a"), freePadSeg] }),
    );
    expect(snapshot.ratsnest).toHaveLength(1);
    expect(snapshot.ratsnest![0]!.fromPlacementId).toBe("U1");
    expect(
      warnings.some((w) =>
        w.includes("1 airwire(s) anchored on free pads were not sent"),
      ),
    ).toBe(true);
  });

  test("defaults options.portfolio to the production default (4)", () => {
    const { snapshot } = buildBoardSnapshot(
      projection({ ratsnest: [rats("net_a")] }),
    );
    expect(snapshot.options?.portfolio).toBe(4);
  });

  test("a caller-supplied routeOption overrides the portfolio default", () => {
    const { snapshot } = buildBoardSnapshot(
      projection({ ratsnest: [rats("net_a")] }),
      { routeOptions: { portfolio: 1, allowVias: false } },
    );
    expect(snapshot.options?.portfolio).toBe(1);
    expect(snapshot.options?.allowVias).toBe(false);
  });

  test("is a deterministic pure function (equal output on repeat)", () => {
    const make = () =>
      buildBoardSnapshot(
        projection({
          placements: [placement("U1", [smdPad("1", { x: 0, y: 0 })])],
          padNets: { "U1|1": "net_a" },
          netNames: { net_a: "NET_A" },
          ratsnest: [rats("net_a")],
        }),
      ).snapshot;
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });

  test("stamps schemaVersion on every snapshot", () => {
    const { snapshot } = buildBoardSnapshot(projection());
    expect(snapshot.schemaVersion).toBe("1.0");
  });

  test("NPTH free pad emits a freeHole, no padOutline (data-loss fix)", () => {
    const proj = projection({
      freePads: [
        freePad({
          id: "h1",
          padType: "hole",
          drillMm: 0.8,
          centerMm: { x: 3, y: 4 },
        }),
      ],
    });
    const { snapshot } = buildBoardSnapshot(proj);
    expect(snapshot.padOutlines).toHaveLength(0);
    expect(snapshot.freeHoles).toHaveLength(1);
    expect(snapshot.freeHoles![0]).toEqual({
      id: "free:h1",
      centerMm: { x: 3, y: 4 },
      drillMm: 0.8,
    });
  });

  // S7 D3: the ONE drill derivation — a drill is a drill whatever `padType`
  // says, and an `smd` / `conn` drill reaches the fab as a non-plated hit.
  test("a drilled `smd` free pad is BOTH copper and a freeHole obstacle", () => {
    const { snapshot } = buildBoardSnapshot(
      projection({
        freePads: [
          freePad({
            id: "tp1",
            padType: "smd",
            drillMm: 0.9,
            centerMm: { x: 3, y: 4 },
          }),
        ],
      }),
    );
    expect(snapshot.freeHoles).toHaveLength(1);
    expect(snapshot.freeHoles![0]).toEqual({
      id: "free:tp1",
      centerMm: { x: 3, y: 4 },
      drillMm: 0.9,
    });
    // Its copper is still one layer — the declared one.
    expect(snapshot.padOutlines!.map((p) => p.layer)).toEqual(["F.Cu"]);
  });

  test("a `conn` free pad's copper is on the one layer it declares", () => {
    const { snapshot } = buildBoardSnapshot(
      projection({
        freePads: [freePad({ id: "c1", padType: "conn", layer: "B.Cu" })],
      }),
    );
    expect(snapshot.padOutlines!.map((p) => p.layer)).toEqual(["B.Cu"]);
    // No drill → no obstacle.
    expect(snapshot.freeHoles ?? []).toHaveLength(0);
  });

  test("a plated `std` free pad spans the stackup and is no NPTH obstacle", () => {
    const { snapshot } = buildBoardSnapshot(
      projection({
        freePads: [freePad({ id: "s1", padType: "std", drillMm: 0.6 })],
      }),
    );
    expect(snapshot.padOutlines!.map((p) => p.layer)).toEqual([
      "F.Cu",
      "B.Cu",
    ]);
    expect(snapshot.freeHoles ?? []).toHaveLength(0);
  });

  test("oblong free hole degrades drillMm to the slot length, with a warning", () => {
    const proj = projection({
      freeHoles: [
        freeHole({
          id: "h1",
          drillMm: 0.8,
          drillSlot: { lengthMm: 2, widthMm: 0.8, angleDeg: 0 },
        }),
      ],
    });
    const { snapshot, warnings } = buildBoardSnapshot(proj);
    expect(snapshot.freeHoles![0]!.drillMm).toBe(2);
    expect(warnings.some((w) => w.includes("h1") && w.includes("oblong"))).toBe(
      true,
    );
  });

  test("round free hole (no slot, or slot not longer) keeps drillMm unchanged, no warning", () => {
    const proj = projection({
      freeHoles: [freeHole({ id: "h1", drillMm: 0.8 })],
      ratsnest: [rats("net_a")],
    });
    const { snapshot, warnings } = buildBoardSnapshot(proj);
    expect(snapshot.freeHoles![0]!.drillMm).toBe(0.8);
    expect(warnings).toEqual([]);
  });

  test("oblong NPTH free pad also degrades drillMm to the slot length, with a warning", () => {
    const proj = projection({
      freePads: [
        freePad({
          id: "h1",
          padType: "hole",
          drillMm: 0.5,
          drillSlot: { lengthMm: 1.5, widthMm: 0.5, angleDeg: 90 },
        }),
      ],
    });
    const { snapshot, warnings } = buildBoardSnapshot(proj);
    expect(snapshot.freeHoles![0]!.drillMm).toBe(1.5);
    expect(
      warnings.some((w) => w.includes("free:h1") && w.includes("oblong")),
    ).toBe(true);
  });

  test("mountType projects smd/tht from library metadata, omits unrecognized/null", () => {
    const proj = projection({
      placements: [
        placement("U1", [smdPad("1", { x: 0, y: 0 })], { x: 0, y: 0 }, "smd"),
        placement(
          "U2",
          [smdPad("1", { x: 0, y: 0 })],
          { x: 5, y: 0 },
          "through_hole",
        ),
        placement("U3", [smdPad("1", { x: 0, y: 0 })], { x: 10, y: 0 }, "SMD"),
        placement(
          "U4",
          [smdPad("1", { x: 0, y: 0 })],
          { x: 15, y: 0 },
          "virtual",
        ),
        placement("U5", [smdPad("1", { x: 0, y: 0 })], { x: 20, y: 0 }, null),
      ],
    });
    const { snapshot } = buildBoardSnapshot(proj);
    const byId = new Map(snapshot.placements!.map((p) => [p.id, p]));
    expect(byId.get("U1")?.mountType).toBe("smd");
    expect(byId.get("U2")?.mountType).toBe("tht");
    expect(byId.get("U3")?.mountType).toBe("smd"); // case-insensitive
    expect(byId.get("U4")?.mountType).toBeUndefined(); // "virtual" unrecognized
    expect(byId.get("U5")?.mountType).toBeUndefined(); // null
    expect(Object.hasOwn(byId.get("U4")!, "mountType")).toBe(false);
    expect(Object.hasOwn(byId.get("U5")!, "mountType")).toBe(false);
  });

  test("a blind/buried/micro via emits a warning; serialized as an unchanged through-span obstacle", () => {
    const proj = projection({
      vias: [
        via({
          id: "v1",
          viaType: "blind",
          fromLayer: "F.Cu",
          toLayer: "In1.Cu",
        }),
      ],
      board: board({ layerCount: 4 }),
    });
    const { snapshot, warnings } = buildBoardSnapshot(proj);
    expect(snapshot.vias).toHaveLength(1);
    const emitted = snapshot.vias![0]!;
    expect(emitted).toEqual({
      id: "v1",
      netId: "net_a",
      centerMm: { x: 0, y: 0 },
      diameterMm: 0.6,
      drillMm: 0.3,
      fromLayer: "F.Cu",
      toLayer: "In1.Cu",
      isHoleOnly: false,
    });
    expect(warnings.some((w) => w.includes("v1") && w.includes("blind"))).toBe(
      true,
    );
  });

  test("a through via emits no warning", () => {
    const proj = projection({
      vias: [via({ id: "v1", viaType: "through" })],
      ratsnest: [rats("net_a")],
    });
    const { warnings } = buildBoardSnapshot(proj);
    expect(warnings).toEqual([]);
  });

  test("a zone whose fill fails contributes no islands and one named warning", () => {
    // copper-pour contract §8: `failed` != `empty`. A non-finite obstacle
    // coordinate makes the fill kernel bail (see
    // copper-fill-kernel-s5.test.ts case (h)) rather than silently pour zero
    // copper — the caller must be told, by zone id and layer, not just handed
    // an empty island list indistinguishable from "nothing there".
    const badTrace: PcbTrace = {
      id: "bad",
      netId: "vcc",
      netClassId: "default",
      layer: "F.Cu",
      widthMm: 0.2,
      pointsNm: [
        { x: Number.NaN, y: 0 },
        { x: 2_000_000, y: 0 },
      ],
      segmentMode: "manhattan-90",
    };
    const proj = projection({
      board: board(),
      zones: FILL_ZONES,
      netNames: { net_gnd: "GND" },
      traces: [badTrace],
    });
    const warnings: string[] = [];
    const islands = buildSnapshotPourIslands(proj, warnings);
    expect(islands).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("board:F.Cu");
    expect(warnings[0]).toContain("F.Cu");
  });
});
