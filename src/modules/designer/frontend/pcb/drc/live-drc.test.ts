import { describe, expect, test } from "vitest";
import type {
  PcbBoardSettings,
  PcbDrcRule,
  PcbKeepout,
  PcbNetClass,
  PcbPlacedPart,
  PcbTrace,
} from "../../../../../sdks";
import { createRuleResolver } from "../../../../../shared/drc/rule-resolver";
import { runLiveDrc, type RunDrcInput } from "./live-drc";

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
  overrides: { drcRules?: PcbDrcRule[]; clearanceFloorMm?: number } = {},
): PcbBoardSettings {
  return {
    outline: {
      kind: "rect",
      widthMm: 100,
      heightMm: 100,
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

function resolver(
  overrides: { drcRules?: PcbDrcRule[]; clearanceFloorMm?: number } = {},
) {
  return createRuleResolver(boardSettings(overrides), NET_NAMES, {
    validCopperLayers: ["F.Cu", "B.Cu"],
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

/** One 1×1 mm F.Cu pad at `centerMm`, addressed `U1|1`. */
function placementWithPad(centerMm: { x: number; y: number }): PcbPlacedPart {
  return {
    id: "U1",
    partId: "part-u1",
    componentId: "comp-u1",
    reference: "U1",
    positionMm: centerMm,
    rotationDeg: 0,
    mirrored: false,
    layer: "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads: [
          {
            id: "pad-1",
            number: "1",
            shape: "rect",
            centerMm: { x: 0, y: 0 },
            widthMm: 1,
            heightMm: 1,
            rotationDeg: 0,
          },
        ],
        graphics: [],
        labels: [],
        bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
        warnings: [],
      },
    },
  };
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

function input(overrides: Partial<RunDrcInput> = {}): RunDrcInput {
  return {
    traceNm: [
      { x: -5 * NM, y: 5 * NM },
      { x: 15 * NM, y: 5 * NM },
    ],
    traceWidthMm: 0.25,
    netId: "net-a",
    layer: "F.Cu",
    traces: [],
    placements: [],
    padNetMap: new Map(),
    resolver: resolver(),
    ...overrides,
  };
}

/**
 * Pending trace along y = 0, x ∈ [0, 10], 0.2 mm wide (half 0.1) on `net-a`,
 * so a neighbour of the same width at y = d has an edge-to-edge gap of
 * `d − 0.2`.
 */
function routing(overrides: Partial<RunDrcInput> = {}): RunDrcInput {
  return input({
    traceNm: [
      { x: 0, y: 0 },
      { x: 10 * NM, y: 0 },
    ],
    traceWidthMm: 0.2,
    ...overrides,
  });
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

describe("runLiveDrc — clearance comes from the rule resolver", () => {
  test("the NEIGHBOUR's net class raises the requirement", () => {
    // gap = 0.9 − 0.2 = 0.7; implicit = max(board 0.2, default 0.25, wide 0.8).
    const violations = runLiveDrc(
      routing({
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
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe("trace-trace");
    // The parity number: batch resolves the same 0.8 for this pair (§9).
    expect(violations[0]!.requiredMm).toBeCloseTo(0.8, 9);
    expect(violations[0]!.distanceMm).toBeCloseTo(0.7, 9);
  });

  test("the same geometry against a default-class net is clean", () => {
    const violations = runLiveDrc(
      routing({
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
      }),
    );
    expect(violations).toEqual([]);
  });

  test("the PENDING class comes from the net, not the session", () => {
    // `net-gnd` is named GND, so it resolves to the `gnd` class (0.6) — the
    // session's stored netClassId is not an input at all any more (§3).
    const traces = [
      neighbour(
        "t1",
        [
          { x: 0, y: 0.6 },
          { x: 10, y: 0.6 },
        ],
        "net-c",
      ),
    ];
    expect(runLiveDrc(routing({ netId: "net-gnd", traces }))).toHaveLength(1);
    expect(
      runLiveDrc(routing({ netId: "net-gnd", traces }))[0]!.requiredMm,
    ).toBeCloseTo(0.6, 9);
    // The same pair on a default-class net (0.25) clears the 0.4 mm gap.
    expect(runLiveDrc(routing({ netId: "net-a", traces }))).toEqual([]);
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
    expect(runLiveDrc(routing({ traces }))).toHaveLength(1);
    // …allowed once an explicit rule relaxes the pair to 0.15.
    expect(
      runLiveDrc(
        routing({ traces, resolver: resolver({ drcRules: [netRule(0.15)] }) }),
      ),
    ).toEqual([]);
  });

  test("the clearance floor clamps a relaxing rule back up", () => {
    const violations = runLiveDrc(
      routing({
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
        resolver: resolver({
          drcRules: [netRule(0.15)],
          clearanceFloorMm: 0.3,
        }),
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.requiredMm).toBeCloseTo(0.3, 9);
  });
});

describe("runLiveDrc — area scopes are evaluated per sub-segment", () => {
  const withArea = () => resolver({ drcRules: [areaRule(0.05)] });

  test("both evaluation points inside the area ⇒ relaxed", () => {
    const violations = runLiveDrc(
      routing({
        traces: [
          neighbour(
            "t1",
            [
              { x: 1, y: 0.3 },
              { x: 2, y: 0.3 },
            ],
            "net-b",
          ),
        ],
        resolver: withArea(),
      }),
    );
    expect(violations).toEqual([]);
  });

  test("a neighbour outside the area keeps the class tier", () => {
    const violations = runLiveDrc(
      routing({
        traces: [
          neighbour(
            "t1",
            [
              { x: 7, y: 0.3 },
              { x: 8, y: 0.3 },
            ],
            "net-b",
          ),
        ],
        resolver: withArea(),
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.requiredMm).toBeCloseTo(0.8, 9);
  });

  test("ONE segment pair with a second hotspot outside the area is refused", () => {
    // The closest approach is constant along the overlap, and the witness a
    // single resolution would pick lies INSIDE the relaxing area. Splitting
    // both sides at the area ring exposes the outside half (§4.4, Astra #1).
    const violations = runLiveDrc(
      routing({
        traces: [
          neighbour(
            "t1",
            [
              { x: 3, y: 0.3 },
              { x: 8, y: 0.3 },
            ],
            "net-b",
          ),
        ],
        resolver: withArea(),
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.requiredMm).toBeCloseTo(0.8, 9);
  });
});

describe("runLiveDrc — short tier", () => {
  test("a 50 nm gap between different known nets is refused at required 0", () => {
    const violations = runLiveDrc(
      routing({
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
        resolver: resolver({ drcRules: [netRule(0)] }),
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.type).toBe("trace-short");
    expect(violations[0]!.requiredMm).toBe(0);
  });

  test("copper that overlaps a foreign pad is a short, not a clearance breach", () => {
    const violations = runLiveDrc(
      routing({
        traceNm: [
          { x: 4 * NM, y: 0 },
          { x: 6 * NM, y: 0 },
        ],
        placements: [placementWithPad({ x: 5, y: 0 })],
        padNetMap: new Map([["U1|1", "net-b"]]),
        resolver: resolver({ drcRules: [netRule(0)] }),
      }),
    );
    expect(violations.map((v) => v.type)).toEqual(["trace-short"]);
    expect(violations[0]!.offendingId).toBe("U1:1");
  });
});

describe("runLiveDrc — trace-pad", () => {
  test("a pad on a 0.8 mm class blocks at 0.8, not at the board tier", () => {
    const placements = [placementWithPad({ x: 5, y: 5 })];
    // Pad copper spans x ∈ [4.5, 5.5]; the segment ends 0.7 mm short of it,
    // so the edge-to-edge gap is 0.7 − 0.1 = 0.6 mm.
    const pending = routing({
      traceNm: [
        { x: 0, y: 5 * NM },
        { x: 3.8 * NM, y: 5 * NM },
      ],
      placements,
    });
    const wide = runLiveDrc({
      ...pending,
      padNetMap: new Map([["U1|1", "net-b"]]),
    });
    expect(wide).toHaveLength(1);
    expect(wide[0]!.type).toBe("trace-pad");
    expect(wide[0]!.offendingId).toBe("U1:1");
    expect(wide[0]!.requiredMm).toBeCloseTo(0.8, 9);
    expect(wide[0]!.distanceMm).toBeCloseTo(0.6, 9);
    // Default class (0.25) clears the same geometry.
    expect(
      runLiveDrc({ ...pending, padNetMap: new Map([["U1|1", "net-c"]]) }),
    ).toEqual([]);
  });
});

describe("runLiveDrc — trace-keepout", () => {
  test("a segment crossing the keepout reports one violation", () => {
    const violations = runLiveDrc(input({ keepouts: [keepout()] }));
    expect(violations).toEqual([
      {
        segmentIndex: 0,
        type: "trace-keepout",
        offendingId: "k1",
        distanceMm: 0,
        requiredMm: 0,
      },
    ]);
  });

  test("a segment whose edge lies on the boundary is legal (clearance 0)", () => {
    // Centreline 0.125 mm above the top edge with half-width 0.125 mm: the
    // stadium touches y = 10 but never enters the open interior (contract §4).
    const violations = runLiveDrc(
      input({
        traceNm: [
          { x: -5 * NM, y: 10.125 * NM },
          { x: 15 * NM, y: 10.125 * NM },
        ],
        keepouts: [keepout()],
      }),
    );
    expect(violations).toEqual([]);
  });

  test("a keepout on another layer does not affect the route", () => {
    const violations = runLiveDrc(
      input({ keepouts: [keepout({ layers: ["B.Cu"] })] }),
    );
    expect(violations).toEqual([]);
  });

  test("restrictions.tracks off means the keepout never blocks a trace", () => {
    const violations = runLiveDrc(
      input({
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
      }),
    );
    expect(violations).toEqual([]);
  });

  test("two segments through the same keepout report one violation each", () => {
    const violations = runLiveDrc(
      input({
        traceNm: [
          { x: -5 * NM, y: 5 * NM },
          { x: 5 * NM, y: 5 * NM },
          { x: 5 * NM, y: 15 * NM },
        ],
        keepouts: [keepout()],
      }),
    );
    expect(violations.map((v) => v.segmentIndex)).toEqual([0, 1]);
    expect(violations.every((v) => v.type === "trace-keepout")).toBe(true);
  });

  test("no keepouts input leaves the existing checks untouched", () => {
    expect(runLiveDrc(input())).toEqual([]);
  });
});

describe("runLiveDrc — trace-keepout, concave ring and disabled rows", () => {
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

  test("a segment inside the notch of a concave keepout is legal (exact predicate, not the AABB)", () => {
    const violations = runLiveDrc(
      input({
        traceNm: [
          { x: 3 * NM, y: 9 * NM },
          { x: 7 * NM, y: 9 * NM },
        ],
        keepouts: [concave],
      }),
    );
    expect(violations).toEqual([]);
  });

  test("a segment entering an arm of the same keepout is flagged", () => {
    const violations = runLiveDrc(
      input({
        traceNm: [
          { x: 3 * NM, y: 9 * NM },
          { x: 9 * NM, y: 9 * NM },
        ],
        keepouts: [concave],
      }),
    );
    expect(violations.map((v) => v.type)).toEqual(["trace-keepout"]);
  });

  test("a disabled keepout affects nothing (contract §3.5)", () => {
    const violations = runLiveDrc(
      input({ keepouts: [keepout({ enabled: false })] }),
    );
    expect(violations).toEqual([]);
  });
});
