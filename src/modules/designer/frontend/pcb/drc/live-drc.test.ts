/**
 * Live legality — the route tool's gate is the SHARED pending-copper core run
 * on a per-projection context (live-parity contract 07 §1). These tests pin
 * what the canvas depends on: the resolver tiers a verdict reports, the area
 * split, the short tier, the item model (rotated pads, through-hole pads on the
 * far side, vias, non-plated holes), the board tier, the refuse set and the
 * session → pending-copper mapping.
 *
 * Nothing here re-implements geometry; every number is the number batch DRC
 * reports for the same pair.
 */
import { describe, expect, test } from "vitest";
import type {
  DrcRuleCode,
  DrcViolation,
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbDrcRule,
  PcbFreeHole,
  PcbKeepout,
  PcbNetClass,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../../../sdks";
import {
  buildDrcItems,
  type LegalityContext,
  type LegalityInput,
} from "../../../../../shared/drc/drc-context";
import type { FootprintRenderSourcePad } from "../../../../../shared/rendering/types";
import type { RouteSession } from "../tools/route-tool-state";
import {
  blockingViolations,
  pendingCopperFromSession,
  runLiveDrc,
  type PendingCopper,
} from "./live-drc";

const NM = 1_000_000;

/** netId → display name. `net-gnd` resolves to the `gnd` class by NAME (§3). */
const NET_NAMES: Record<string, string> = {
  "net-a": "A",
  "net-b": "B",
  "net-c": "C",
  "net-gnd": "GND",
};

/** 5×2 mm rule area covering x ∈ [0, 5] of the pending trace's corridor. */
const AREA_POLYGON = [
  { x: 0, y: -1 },
  { x: 5, y: -1 },
  { x: 5, y: 1 },
  { x: 0, y: 1 },
];

function netClass(id: string, clearanceMm: number): PcbNetClass {
  return {
    id,
    name: id,
    traceWidthMm: 0.25,
    clearanceMm,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#d4d4d8",
    defaultViaProtection: "tented",
  };
}

/**
 * Board tier 0.2 mm, default class 0.25, `wide` 0.8 (assigned to `net-b`),
 * `gnd` 0.6 (reached by the GND name heuristic). Every clearance assertion
 * below reads one of those four tiers, so the number in the expectation names
 * which tier won.
 */
function boardSettings(
  overrides: {
    drcRules?: PcbDrcRule[];
    clearanceFloorMm?: number;
    widthMm?: number;
    heightMm?: number;
  } = {},
): PcbBoardSettings {
  return {
    outline: {
      kind: "rect",
      widthMm: overrides.widthMm ?? 100,
      heightMm: overrides.heightMm ?? 100,
      centerMm: { x: 0, y: 0 },
    },
    activeLayer: "F.Cu",
    visibleLayers: ["F.Cu", "B.Cu"],
    designRules: {
      clearance: {
        traceToTraceMm: 0.2,
        traceToPadMm: 0.2,
        padToPadMm: 0.2,
        traceToViaMm: 0.2,
        viaToViaMm: 0.2,
        copperToBoardEdgeMm: 0.5,
      },
      minimums: {
        traceWidthMm: 0.2,
        drillSizeMm: 0.4,
        annularRingMm: 0.2,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
        ...(overrides.clearanceFloorMm !== undefined
          ? { clearanceMm: overrides.clearanceFloorMm }
          : {}),
      },
    },
    netClasses: [
      netClass("default", 0.25),
      netClass("wide", 0.8),
      netClass("gnd", 0.6),
    ],
    perNetClassAssignments: { "net-b": "wide" },
    ...(overrides.drcRules ? { drcRules: overrides.drcRules } : {}),
    tracePresets: [0.2, 0.25],
    fabricator: "custom",
    layerCount: 2,
    displayMode: "normal",
    solderMaskExpansionMm: 0.075,
    solderPasteExpansionMm: -0.05,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The ONE context the gate judges against — the same one the canvas builds. */
function context(
  overrides: Partial<LegalityInput> & {
    board?: PcbBoardSettings;
  } = {},
): LegalityContext {
  return buildDrcItems({
    board: overrides.board ?? boardSettings(),
    placements: overrides.placements ?? [],
    traces: overrides.traces ?? [],
    vias: overrides.vias ?? [],
    freePads: overrides.freePads ?? [],
    freeHoles: overrides.freeHoles ?? [],
    zones: overrides.zones ?? [],
    keepouts: overrides.keepouts ?? [],
    padNets: overrides.padNets ?? {},
    netNames: overrides.netNames ?? NET_NAMES,
  });
}

/** Committed neighbour trace; points are mm, converted to the stored nm. */
function neighbour(
  id: string,
  pointsMm: Array<{ x: number; y: number }>,
  netId: string,
  widthMm = 0.2,
): PcbTrace {
  return {
    id,
    netId,
    netClassId: "default",
    layer: "F.Cu",
    widthMm,
    pointsNm: pointsMm.map((p) => ({ x: p.x * NM, y: p.y * NM })),
    segmentMode: "manhattan-45",
  };
}

/** The pending run under the cursor. */
function pending(
  pointsMm: Array<{ x: number; y: number }>,
  opts: {
    netId?: string | null;
    widthMm?: number;
    layer?: PcbCopperLayerId;
  } = {},
): PendingCopper {
  return {
    traces: [
      {
        id: "pending:trace:0",
        netId: opts.netId ?? "net-a",
        netClassId: "default",
        layer: opts.layer ?? "F.Cu",
        widthMm: opts.widthMm ?? 0.2,
        pointsNm: pointsMm.map((p) => ({ x: p.x * NM, y: p.y * NM })),
        segmentMode: "manhattan-45",
      },
    ],
    vias: [],
  };
}

function footprintPad(
  number: string,
  centerMm: { x: number; y: number },
  widthMm: number,
  heightMm: number,
  opts: { drillDiameterMm?: number } = {},
): FootprintRenderSourcePad {
  return {
    id: `pad-${number}`,
    number,
    shape: "rect",
    centerMm,
    widthMm,
    heightMm,
    rotationDeg: 0,
    ...(opts.drillDiameterMm !== undefined
      ? { drillDiameterMm: opts.drillDiameterMm }
      : {}),
  };
}

function placement(
  id: string,
  positionMm: { x: number; y: number },
  pads: FootprintRenderSourcePad[],
  opts: { rotationDeg?: number; layer?: PcbPlacedPart["layer"] } = {},
): PcbPlacedPart {
  return {
    id,
    partId: `part-${id}`,
    componentId: `comp-${id}`,
    reference: id,
    positionMm,
    rotationDeg: opts.rotationDeg ?? 0,
    mirrored: false,
    layer: opts.layer ?? "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
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

/** One 1×1 mm F.Cu pad at `centerMm`, addressed `U1|1`. */
function placementWithPad(centerMm: { x: number; y: number }): PcbPlacedPart {
  return placement("U1", centerMm, [footprintPad("1", { x: 0, y: 0 }, 1, 1)]);
}

/** 10×10 mm square keepout at the origin, tracks forbidden on F.Cu. */
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
      tracks: true,
      vias: false,
      pads: false,
      copperPour: false,
      footprints: false,
    },
    ...overrides,
  };
}

function freeHole(centerMm: { x: number; y: number }): PcbFreeHole {
  return { id: "h1", centerMm, drillMm: 1, lockedAt: null };
}

function via(
  id: string,
  centerMm: { x: number; y: number },
  netId: string | null,
): PcbVia {
  return {
    id,
    netId,
    netClassId: "default",
    centerMm,
    diameterMm: 0.8,
    drillMm: 0.4,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    protection: "tented",
    provenance: "route",
  };
}

/** Relaxes every pair whose BOTH evaluation points sit inside AREA_POLYGON. */
function areaRule(mm: number): PcbDrcRule {
  return {
    id: "area-relax",
    name: "Area relax",
    enabled: true,
    priority: 10,
    scopes: [{ kind: "area", polygonMm: AREA_POLYGON }],
    constraint: { kind: "clearance", mm },
  };
}

/** Relaxes anything touching `net-b`, area-independent. */
function netRule(mm: number): PcbDrcRule {
  return {
    id: "relax-b",
    name: "Relax B",
    enabled: true,
    priority: 10,
    scopes: [{ kind: "net", netIds: ["net-b"] }],
    constraint: { kind: "clearance", mm },
  };
}

/** The verdicts of one code — the tier under test, never the whole report. */
function ofCode(
  violations: readonly DrcViolation[],
  code: DrcRuleCode,
): DrcViolation[] {
  return violations.filter((v) => v.code === code);
}

function codes(violations: readonly DrcViolation[]): DrcRuleCode[] {
  return [...new Set(violations.map((v) => v.code))].sort();
}

/**
 * The pending run this file routes: along y = 0, x ∈ [0, 10], 0.2 mm wide
 * (half 0.1) on `net-a`, so a neighbour of the same width at y = d has an
 * edge-to-edge gap of `d − 0.2`.
 */
const ROUTING = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
];

describe("runLiveDrc — clearance comes from the shared resolver", () => {
  test("the NEIGHBOUR's net class raises the requirement", () => {
    // gap = 0.9 − 0.2 = 0.7; implicit = max(board 0.2, default 0.25, wide 0.8).
    const ctx = context({
      traces: [
        neighbour(
          "t1",
          [
            { x: 0, y: 0.9 },
            { x: 10, y: 0.9 },
          ],
          "net-b",
        ),
      ],
    });
    const hits = ofCode(
      runLiveDrc({ ctx, pending: pending(ROUTING) }),
      "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(hits).toHaveLength(1);
    // The parity number: batch resolves the same 0.8 for this pair (§9).
    expect(hits[0]!.requiredMm).toBeCloseTo(0.8, 9);
    expect(hits[0]!.measuredMm).toBeCloseTo(0.7, 9);
  });

  test("the same geometry against a default-class net is clean", () => {
    const ctx = context({
      traces: [
        neighbour(
          "t1",
          [
            { x: 0, y: 0.9 },
            { x: 10, y: 0.9 },
          ],
          "net-c",
        ),
      ],
    });
    expect(runLiveDrc({ ctx, pending: pending(ROUTING) })).toEqual([]);
  });

  test("the PENDING class comes from the net, not the session", () => {
    // `net-gnd` is named GND, so it resolves to the `gnd` class (0.6) — the
    // session's stored netClassId is not an input at all any more (§3).
    const ctx = context({
      traces: [
        neighbour(
          "t1",
          [
            { x: 0, y: 0.6 },
            { x: 10, y: 0.6 },
          ],
          "net-c",
        ),
      ],
    });
    const gnd = ofCode(
      runLiveDrc({ ctx, pending: pending(ROUTING, { netId: "net-gnd" }) }),
      "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(gnd).toHaveLength(1);
    expect(gnd[0]!.requiredMm).toBeCloseTo(0.6, 9);
    // The same pair on a default-class net (0.25) clears the 0.4 mm gap.
    expect(runLiveDrc({ ctx, pending: pending(ROUTING) })).toEqual([]);
  });

  test("a net-scoped rule relaxes below the class tier", () => {
    const traces = [
      neighbour(
        "t1",
        [
          { x: 0, y: 0.4 },
          { x: 10, y: 0.4 },
        ],
        "net-b",
      ),
    ];
    // gap 0.2: refused at the 0.8 class tier…
    expect(
      ofCode(
        runLiveDrc({ ctx: context({ traces }), pending: pending(ROUTING) }),
        "TRACE_TO_TRACE_CLEARANCE",
      ),
    ).toHaveLength(1);
    // …allowed once an explicit rule relaxes the pair to 0.15.
    const relaxed = context({
      traces,
      board: boardSettings({ drcRules: [netRule(0.15)] }),
    });
    expect(
      ofCode(
        runLiveDrc({ ctx: relaxed, pending: pending(ROUTING) }),
        "TRACE_TO_TRACE_CLEARANCE",
      ),
    ).toEqual([]);
  });

  test("the clearance floor clamps a relaxing rule back up", () => {
    const ctx = context({
      traces: [
        neighbour(
          "t1",
          [
            { x: 0, y: 0.4 },
            { x: 10, y: 0.4 },
          ],
          "net-b",
        ),
      ],
      board: boardSettings({
        drcRules: [netRule(0.15)],
        clearanceFloorMm: 0.3,
      }),
    });
    const hits = ofCode(
      runLiveDrc({ ctx, pending: pending(ROUTING) }),
      "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.requiredMm).toBeCloseTo(0.3, 9);
  });
});

describe("runLiveDrc — area scopes are evaluated per sub-segment", () => {
  const withArea = (traces: PcbTrace[]) =>
    context({ traces, board: boardSettings({ drcRules: [areaRule(0.05)] }) });

  test("both evaluation points inside the area ⇒ relaxed", () => {
    const ctx = withArea([
      neighbour(
        "t1",
        [
          { x: 1, y: 0.3 },
          { x: 2, y: 0.3 },
        ],
        "net-b",
      ),
    ]);
    expect(
      ofCode(
        runLiveDrc({ ctx, pending: pending(ROUTING) }),
        "TRACE_TO_TRACE_CLEARANCE",
      ),
    ).toEqual([]);
  });

  test("a neighbour outside the area keeps the class tier", () => {
    const ctx = withArea([
      neighbour(
        "t1",
        [
          { x: 7, y: 0.3 },
          { x: 8, y: 0.3 },
        ],
        "net-b",
      ),
    ]);
    const hits = ofCode(
      runLiveDrc({ ctx, pending: pending(ROUTING) }),
      "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.requiredMm).toBeCloseTo(0.8, 9);
  });

  test("ONE segment pair with a second hotspot outside the area is refused", () => {
    // The closest approach is constant along the overlap, and the witness a
    // single resolution would pick lies INSIDE the relaxing area. Splitting
    // both sides at the area ring exposes the outside half (§4.4, Astra #1).
    const ctx = withArea([
      neighbour(
        "t1",
        [
          { x: 3, y: 0.3 },
          { x: 8, y: 0.3 },
        ],
        "net-b",
      ),
    ]);
    const hits = ofCode(
      runLiveDrc({ ctx, pending: pending(ROUTING) }),
      "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.requiredMm).toBeCloseTo(0.8, 9);
  });
});

describe("runLiveDrc — short tier", () => {
  test("a 50 nm gap between different known nets is a short at required 0", () => {
    const ctx = context({
      // 0.20005 mm centre-to-centre − 0.2 mm of copper = 50 nm of air.
      traces: [
        neighbour(
          "t1",
          [
            { x: 0, y: 0.20005 },
            { x: 10, y: 0.20005 },
          ],
          "net-b",
        ),
      ],
      board: boardSettings({ drcRules: [netRule(0)] }),
    });
    const hits = ofCode(
      runLiveDrc({ ctx, pending: pending(ROUTING) }),
      "NET_SHORT_CIRCUIT",
    );
    expect(hits).toHaveLength(1);
  });

  test("copper that overlaps a foreign pad is a short, not a clearance breach", () => {
    const ctx = context({
      placements: [placementWithPad({ x: 5, y: 0 })],
      padNets: { "U1|1": "net-b" },
      board: boardSettings({ drcRules: [netRule(0)] }),
    });
    const violations = runLiveDrc({
      ctx,
      pending: pending([
        { x: 4, y: 0 },
        { x: 6, y: 0 },
      ]),
    });
    expect(codes(violations)).toContain("NET_SHORT_CIRCUIT");
    expect(codes(violations)).not.toContain("TRACE_TO_PAD_CLEARANCE");
  });
});

describe("runLiveDrc — pads", () => {
  test("a pad on a 0.8 mm class blocks at 0.8, not at the board tier", () => {
    // Pad copper spans x ∈ [4.5, 5.5]; the segment ends 0.7 mm short of it,
    // so the edge-to-edge gap is 0.7 − 0.1 = 0.6 mm.
    const run = pending([
      { x: 0, y: 5 },
      { x: 3.8, y: 5 },
    ]);
    const wide = ofCode(
      runLiveDrc({
        ctx: context({
          placements: [placementWithPad({ x: 5, y: 5 })],
          padNets: { "U1|1": "net-b" },
        }),
        pending: run,
      }),
      "TRACE_TO_PAD_CLEARANCE",
    );
    expect(wide).toHaveLength(1);
    expect(wide[0]!.requiredMm).toBeCloseTo(0.8, 9);
    expect(wide[0]!.measuredMm).toBeCloseTo(0.6, 9);
    // Default class (0.25) clears the same geometry.
    expect(
      runLiveDrc({
        ctx: context({
          placements: [placementWithPad({ x: 5, y: 5 })],
          padNets: { "U1|1": "net-c" },
        }),
        pending: run,
      }),
    ).toEqual([]);
  });

  test("a rotated non-square pad is judged as ROTATED (B5-LIVE-ROT-PAD)", () => {
    // U1 at (5,5) rotated 90°, pad 2.0×0.5 local. The TRUE rotated copper is
    // 0.5×2.0 — x ∈ [4.75, 5.25], y ∈ [4, 6]. The model this replaced never
    // swapped the extents, so it used x ∈ [4, 6], y ∈ [4.75, 5.25]: the two
    // boxes disagree on BOTH runs below, in opposite directions.
    const ctx = context({
      placements: [
        placement(
          "U1",
          { x: 5, y: 5 },
          [footprintPad("1", { x: 0, y: 0 }, 2.0, 0.5)],
          { rotationDeg: 90 },
        ),
      ],
      padNets: { "U1|1": "net-c" },
    });
    // Vertical run at x = 5.35 (copper x ∈ [5.25, 5.45]), y 3 → 4.3: it
    // touches the true rotated pad's right edge inside its y span — a dead
    // short. The un-swapped box ends at y = 4.75 and called this clean.
    expect(
      codes(
        runLiveDrc({
          ctx,
          pending: pending([
            { x: 5.35, y: 3 },
            { x: 5.35, y: 4.3 },
          ]),
        }),
      ),
    ).toContain("NET_SHORT_CIRCUIT");
    // Horizontal run at y = 5, x 3 → 4.3 (copper x ≤ 4.4): 0.35 mm from the
    // true pad's left edge, clear of the 0.25 mm default-class tier. The
    // un-swapped box reached x = 4 and would have called this a short.
    expect(
      runLiveDrc({
        ctx,
        pending: pending([
          { x: 3, y: 5 },
          { x: 4.3, y: 5 },
        ]),
      }),
    ).toEqual([]);
  });

  test("a through-hole pad on the far side blocks on B.Cu (B5-LIVE-TH-PAD-SIDE)", () => {
    // U1 is an F.Cu placement, but its pad is drilled: the barrel's copper
    // reaches B.Cu, so a B.Cu route through it is a short, not a clean pass.
    const ctx = context({
      placements: [
        placement("U1", { x: 5, y: 5 }, [
          footprintPad("1", { x: 0, y: 0 }, 1.6, 1.6, {
            drillDiameterMm: 0.8,
          }),
        ]),
      ],
      padNets: { "U1|1": "net-b" },
    });
    const violations = runLiveDrc({
      ctx,
      pending: pending(
        [
          { x: 3, y: 5 },
          { x: 7, y: 5 },
        ],
        { netId: "net-c", layer: "B.Cu" },
      ),
    });
    expect(violations.length).toBeGreaterThan(0);
    expect(codes(violations)).toContain("NET_SHORT_CIRCUIT");
  });
});

describe("runLiveDrc — vias and holes", () => {
  test("a foreign via too close to the run is a traceToVia breach", () => {
    // Via copper radius 0.4 at (5, 0.65): centre-to-centreline 0.65, so the
    // edge gap is 0.65 − 0.4 − 0.1 = 0.15 mm against a 0.8 mm requirement.
    const ctx = context({ vias: [via("v1", { x: 5, y: 0.65 }, "net-b")] });
    const hits = ofCode(
      runLiveDrc({ ctx, pending: pending(ROUTING) }),
      "TRACE_TO_VIA_CLEARANCE",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.requiredMm).toBeCloseTo(0.8, 9);
    expect(hits[0]!.measuredMm).toBeCloseTo(0.15, 9);
  });

  test("a non-plated hole too close to the run is COPPER_TO_HOLE", () => {
    // 1 mm drill at (5, 0.5): drill edge 0.5 − 0.5 = 0 from the centreline,
    // so the copper is 0.1 mm INSIDE the hole. copperToHole falls back to the
    // 0.5 mm board-edge rule.
    const ctx = context({ freeHoles: [freeHole({ x: 5, y: 0.5 })] });
    const hits = ofCode(
      runLiveDrc({ ctx, pending: pending(ROUTING) }),
      "COPPER_TO_HOLE",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.requiredMm).toBeCloseTo(0.5, 9);
  });

  test("the same hole 2 mm away is clean", () => {
    const ctx = context({ freeHoles: [freeHole({ x: 5, y: 2 })] });
    expect(runLiveDrc({ ctx, pending: pending(ROUTING) })).toEqual([]);
  });
});

describe("runLiveDrc — board edge and off-board", () => {
  /** 10×10 mm board centred at the origin: copper is legal in x,y ∈ [−5, 5]. */
  const small = () =>
    context({ board: boardSettings({ widthMm: 10, heightMm: 10 }) });

  test("a run leaving the outline is COPPER_OFF_BOARD", () => {
    const violations = runLiveDrc({
      ctx: small(),
      pending: pending([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ]),
    });
    expect(codes(violations)).toContain("COPPER_OFF_BOARD");
  });

  test("a run inside but within copperToBoardEdge is COPPER_TO_BOARD_EDGE", () => {
    // Copper edge at y = 4.9 + 0.1 = 5.0 … the run sits 0.2 mm from the edge,
    // under the 0.5 mm rule but still on the board.
    const violations = runLiveDrc({
      ctx: small(),
      pending: pending([
        { x: -3, y: 4.7 },
        { x: 3, y: 4.7 },
      ]),
    });
    expect(codes(violations)).toContain("COPPER_TO_BOARD_EDGE");
    expect(codes(violations)).not.toContain("COPPER_OFF_BOARD");
  });

  test("a run well inside the same board is clean", () => {
    expect(
      runLiveDrc({
        ctx: small(),
        pending: pending([
          { x: -3, y: 0 },
          { x: 3, y: 0 },
        ]),
      }),
    ).toEqual([]);
  });
});

describe("runLiveDrc — keepouts", () => {
  test("a run crossing the keepout reports one violation", () => {
    const ctx = context({ keepouts: [keepout()] });
    const violations = runLiveDrc({
      ctx,
      pending: pending([
        { x: -5, y: 5 },
        { x: 15, y: 5 },
      ]),
    });
    expect(codes(violations)).toEqual(["KEEPOUT_VIOLATION"]);
    expect(violations[0]!.anchors).toContainEqual({
      kind: "keepout",
      keepoutId: "k1",
    });
  });

  test("a run whose edge lies on the boundary is legal (clearance 0)", () => {
    // Centreline 0.1 mm above the top edge with half-width 0.1 mm: the stadium
    // touches y = 10 but never enters the open interior (contract §4).
    const ctx = context({ keepouts: [keepout()] });
    expect(
      runLiveDrc({
        ctx,
        pending: pending([
          { x: -5, y: 10.1 },
          { x: 15, y: 10.1 },
        ]),
      }),
    ).toEqual([]);
  });

  test("a keepout on another layer does not affect the route", () => {
    const ctx = context({ keepouts: [keepout({ layers: ["B.Cu"] })] });
    expect(
      runLiveDrc({
        ctx,
        pending: pending([
          { x: -5, y: 5 },
          { x: 15, y: 5 },
        ]),
      }),
    ).toEqual([]);
  });

  test("restrictions.tracks off means the keepout never blocks a trace", () => {
    const ctx = context({
      keepouts: [
        keepout({
          restrictions: {
            tracks: false,
            vias: true,
            pads: true,
            copperPour: true,
            footprints: true,
          },
        }),
      ],
    });
    expect(
      runLiveDrc({
        ctx,
        pending: pending([
          { x: -5, y: 5 },
          { x: 15, y: 5 },
        ]),
      }),
    ).toEqual([]);
  });

  test("a disabled keepout affects nothing (contract §3.5)", () => {
    const ctx = context({ keepouts: [keepout({ enabled: false })] });
    expect(
      runLiveDrc({
        ctx,
        pending: pending([
          { x: -5, y: 5 },
          { x: 15, y: 5 },
        ]),
      }),
    ).toEqual([]);
  });

  test("no keepouts leaves the run clean", () => {
    expect(
      runLiveDrc({
        ctx: context(),
        pending: pending([
          { x: -5, y: 5 },
          { x: 15, y: 5 },
        ]),
      }),
    ).toEqual([]);
  });
});

describe("runLiveDrc — concave keepout ring", () => {
  /** U-shaped keepout: arms x∈[0,2] and x∈[8,10] for y∈[0,10], base y∈[0,2]. */
  const concave = keepout({
    id: "ku",
    pointsMm: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 8, y: 10 },
      { x: 8, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 10 },
      { x: 0, y: 10 },
    ],
  });

  test("a run inside the notch is legal (exact predicate, not the AABB)", () => {
    expect(
      runLiveDrc({
        ctx: context({ keepouts: [concave] }),
        pending: pending([
          { x: 3, y: 9 },
          { x: 7, y: 9 },
        ]),
      }),
    ).toEqual([]);
  });

  test("a run entering an arm of the same keepout is flagged", () => {
    expect(
      codes(
        runLiveDrc({
          ctx: context({ keepouts: [concave] }),
          pending: pending([
            { x: 3, y: 9 },
            { x: 9, y: 9 },
          ]),
        }),
      ),
    ).toEqual(["KEEPOUT_VIOLATION"]);
  });
});

describe("runLiveDrc — replacements", () => {
  test("`replaces` drops the board's copy, so a reshape is not its own neighbour", () => {
    const existing = neighbour(
      "t1",
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      "net-a",
    );
    const ctx = context({ traces: [existing] });
    const reshaped: PendingCopper = {
      traces: [
        {
          ...existing,
          netId: "net-c",
          pointsNm: [
            { x: 0, y: 0.05 * NM },
            { x: 10 * NM, y: 0.05 * NM },
          ],
        },
      ],
      vias: [],
    };
    // Reusing a board id WITHOUT declaring it replaced is refused outright:
    // the shared core cannot give a right verdict there, so it gives none.
    expect(() => runLiveDrc({ ctx, pending: reshaped })).toThrow(/replaces/);
    // Judged with `replaces`: the board no longer holds the trace being edited.
    expect(runLiveDrc({ ctx, pending: reshaped, replaces: ["t1"] })).toEqual(
      [],
    );

    // Not vacuous — the same geometry under a FRESH id is a dead short against
    // the copy still on the board.
    expect(
      codes(
        runLiveDrc({
          ctx,
          pending: {
            traces: [{ ...reshaped.traces[0]!, id: "pending:trace:0" }],
            vias: [],
          },
        }),
      ),
    ).toContain("NET_SHORT_CIRCUIT");
  });
});

describe("blockingViolations", () => {
  test("refuses the clearance tier and drops the reported-only warnings", () => {
    // `net-b` is explicitly assigned the `wide` class (0.25 mm nominal width),
    // so a 0.2 mm run on it is a NETCLASS_TRACE_WIDTH warning — reported in
    // `L`, never in the refuse set (07 §6).
    const ctx = context({
      traces: [
        neighbour(
          "t1",
          [
            { x: 0, y: 0.9 },
            { x: 10, y: 0.9 },
          ],
          "net-c",
        ),
      ],
    });
    const violations = runLiveDrc({
      ctx,
      pending: pending(ROUTING, { netId: "net-b" }),
    });
    expect(codes(violations)).toContain("NETCLASS_TRACE_WIDTH");
    expect(codes(violations)).toContain("TRACE_TO_TRACE_CLEARANCE");
    expect(codes(blockingViolations(ctx, violations))).toEqual([
      "TRACE_TO_TRACE_CLEARANCE",
    ]);
  });

  test("a waived violation never blocks", () => {
    const ctx = context({
      traces: [
        neighbour(
          "t1",
          [
            { x: 0, y: 0.9 },
            { x: 10, y: 0.9 },
          ],
          "net-b",
        ),
      ],
    });
    const violations = runLiveDrc({ ctx, pending: pending(ROUTING) });
    const clearance = ofCode(violations, "TRACE_TO_TRACE_CLEARANCE")[0]!;
    expect(blockingViolations(ctx, violations)).toHaveLength(1);
    expect(blockingViolations(ctx, [{ ...clearance, waived: true }])).toEqual(
      [],
    );
  });
});

describe("pendingCopperFromSession", () => {
  const board = boardSettings();

  function session(overrides: Partial<RouteSession> = {}): RouteSession {
    return {
      anchorNm: { x: 0, y: 0 },
      waypointsNm: [],
      layer: "F.Cu",
      segmentMode: "manhattan-45",
      netId: "net-a",
      netClassId: "default",
      widthMm: 0.25,
      widthSource: "netclass",
      posture: "auto",
      boundaries: [],
      ...overrides,
    };
  }

  test("no boundaries and no ghost is empty copper", () => {
    expect(pendingCopperFromSession(session(), null, board)).toEqual({
      traces: [],
      vias: [],
    });
  });

  test("the ghost run becomes the trace one past the last boundary", () => {
    const ghost = [
      { x: 0, y: 0 },
      { x: 5 * NM, y: 0 },
    ];
    const out = pendingCopperFromSession(session(), ghost, board);
    expect(out.vias).toEqual([]);
    expect(out.traces).toHaveLength(1);
    expect(out.traces[0]).toMatchObject({
      id: "pending:trace:0",
      netId: "net-a",
      netClassId: "default",
      layer: "F.Cu",
      widthMm: 0.25,
      segmentMode: "manhattan-45",
    });
    expect(out.traces[0]!.pointsNm).toEqual(ghost);
  });

  test("a one-point ghost contributes nothing", () => {
    expect(
      pendingCopperFromSession(session(), [{ x: 0, y: 0 }], board).traces,
    ).toEqual([]);
  });

  test("finished runs and vias carry the session's net class defaults", () => {
    const s = session({
      boundaries: [
        {
          run: {
            layer: "F.Cu",
            widthMm: 0.25,
            segmentMode: "manhattan-45",
            pointsNm: [
              { x: 0, y: 0 },
              { x: 2 * NM, y: 0 },
            ],
          },
          via: { centerNm: { x: 2 * NM, y: 0 } },
          prevLayer: "F.Cu",
          prevWidthMm: 0.25,
          prevWidthSource: "netclass",
        },
      ],
    });
    const out = pendingCopperFromSession(
      s,
      [
        { x: 2 * NM, y: 0 },
        { x: 6 * NM, y: 0 },
      ],
      board,
    );
    expect(out.traces.map((t) => t.id)).toEqual([
      "pending:trace:0",
      "pending:trace:1",
    ]);
    expect(out.vias).toHaveLength(1);
    expect(out.vias[0]).toMatchObject({
      id: "pending:via:0",
      netId: "net-a",
      // From the `default` net class, since the session set no override.
      diameterMm: 0.8,
      drillMm: 0.4,
      fromLayer: "F.Cu",
      toLayer: "B.Cu",
      viaType: "through",
      protection: "tented",
      provenance: "route",
    });
  });

  test("route-time overrides win over the class defaults", () => {
    const s = session({
      viaDiameterMmOverride: 1.2,
      viaDrillMmOverride: 0.6,
      boundaries: [
        {
          via: {
            centerNm: { x: 0, y: 0 },
            diameterMmOverride: 1.2,
            drillMmOverride: 0.6,
          },
          prevLayer: "F.Cu",
          prevWidthMm: 0.25,
          prevWidthSource: "netclass",
        },
      ],
    });
    const out = pendingCopperFromSession(s, null, board);
    expect(out.vias[0]).toMatchObject({ diameterMm: 1.2, drillMm: 0.6 });
  });

  // R2 #3 / contract 07 §6: the server builders upgrade the DEFAULT class to
  // a per-net assignment; the pending copper must carry the class the server
  // will store, or netClass-scoped rules resolve against the wrong class live.
  test("a per-net assignment upgrades the session's default class, not an explicit one", () => {
    const ghost = [
      { x: 0, y: 0 },
      { x: 5 * NM, y: 0 },
    ];
    const upgraded = pendingCopperFromSession(
      session({ netId: "net-b", netClassId: "default" }),
      ghost,
      board,
    );
    expect(upgraded.traces[0]?.netClassId).toBe("wide");
    const explicit = pendingCopperFromSession(
      session({ netId: "net-b", netClassId: "gnd" }),
      ghost,
      board,
    );
    expect(explicit.traces[0]?.netClassId).toBe("gnd");
  });

  test("the copper it builds is what the gate judges", () => {
    const ctx = context({ keepouts: [keepout()] });
    const s = session({ widthMm: 0.2 });
    const out = pendingCopperFromSession(
      s,
      [
        { x: -5 * NM, y: 5 * NM },
        { x: 15 * NM, y: 5 * NM },
      ],
      board,
    );
    expect(codes(runLiveDrc({ ctx, pending: out }))).toEqual([
      "KEEPOUT_VIOLATION",
    ]);
  });
});

describe("one call per frame — a multi-shape unassigned pin", () => {
  /**
   * U1 pin "1" is ONE logical pin drawn as TWO copper shapes (left at x = 5,
   * right at x = 8) and it carries no net. A pending run touching it bridges
   * its net through the pin, so a run on `net-a` plus the committed `net-c`
   * trace on the right shape is a `NET_SHORT_CIRCUIT` anchored on the pin.
   *
   * The marker — and with it the location-hashed violation id — follows the
   * closest approach, so it MOVES when the ghost touches the earlier-sorting
   * (left) shape while the finished run already touches the right one. Site A
   * used to judge the finished runs and the whole session in two calls and
   * merge them by id; those two ids differ here, so the HUD counted the same
   * bridge twice while `finishRoute` — one call over the whole session —
   * counted it once. One call per frame is the fix.
   */
  const twoShapePin = placement("U1", { x: 5, y: 0 }, [
    footprintPad("1", { x: 0, y: 0 }, 1, 1),
    footprintPad("1", { x: 3, y: 0 }, 1, 1),
  ]);

  /** A different net already on the RIGHT shape, so the bridge is a short. */
  const otherNetTrace = neighbour(
    "t-other",
    [
      { x: 8, y: 5 },
      { x: 8, y: 0.6 },
    ],
    "net-c",
  );

  function run(id: string, fromXMm: number, toXMm: number): PcbTrace {
    return {
      id,
      netId: "net-a",
      netClassId: "default",
      layer: "F.Cu",
      widthMm: 0.2,
      pointsNm: [
        { x: fromXMm * NM, y: 0 },
        { x: toXMm * NM, y: 0 },
      ],
      segmentMode: "manhattan-45",
    };
  }

  /** Finished run into the RIGHT shape; ghost into the LEFT one. */
  const finishedRun = run("pending:trace:0", 12, 8);
  const ghostRun = run("pending:trace:1", 0, 5);
  const wholeSession: PendingCopper = {
    traces: [finishedRun, ghostRun],
    vias: [],
  };

  const ctx = () =>
    context({ placements: [twoShapePin], traces: [otherNetTrace] });

  test("the whole session in ONE call reports the bridge once", () => {
    const shorts = ofCode(
      runLiveDrc({ ctx: ctx(), pending: wholeSession }),
      "NET_SHORT_CIRCUIT",
    );
    expect(shorts).toHaveLength(1);
    // The marker sits on the shape the GHOST touches, not the finished run's.
    expect(shorts[0]!.locationMm).toEqual({ x: 5, y: 0 });
  });

  test("judging the finished runs separately gives the bridge a different id", () => {
    const c = ctx();
    const finishedOnly = ofCode(
      runLiveDrc({ ctx: c, pending: { traces: [finishedRun], vias: [] } }),
      "NET_SHORT_CIRCUIT",
    );
    const whole = ofCode(
      runLiveDrc({ ctx: c, pending: wholeSession }),
      "NET_SHORT_CIRCUIT",
    );
    expect(finishedOnly).toHaveLength(1);
    expect(whole).toHaveLength(1);
    // Same bridge, marker moved from the right shape to the left one.
    expect(finishedOnly[0]!.locationMm).toEqual({ x: 8, y: 0 });
    expect(whole[0]!.locationMm).toEqual({ x: 5, y: 0 });
    expect(whole[0]!.id).not.toBe(finishedOnly[0]!.id);
    // The regression this pins: a merge by id would have shown TWO.
    expect(new Set([...finishedOnly, ...whole].map((v) => v.id)).size).toBe(2);
  });

  test("site A and the commit gate count the same conflicts", () => {
    // Both submit the whole session as one subject set, so they cannot differ.
    const c = ctx();
    const siteA = blockingViolations(
      c,
      runLiveDrc({ ctx: c, pending: wholeSession }),
    );
    const siteB = blockingViolations(
      c,
      runLiveDrc({ ctx: c, pending: wholeSession }),
    );
    expect(siteA.map((v) => v.id)).toEqual(siteB.map((v) => v.id));
    expect(siteA).toHaveLength(1);
  });
});
