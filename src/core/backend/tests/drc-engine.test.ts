import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { createDefaultPcbBoardSettings } from "../../../modules/designer/backend/pcb/pcb-defaults";
import type { FootprintRenderSourcePad } from "../../../shared/rendering/types";
import type {
  DesignerPcbProjection,
  DrcReport,
  DrcRuleCode,
  PcbBoardSettings,
  PcbFreeHole,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../sdks/designer";

const TS = "2026-01-01T00:00:00.000Z";
const MM = 1_000_000;

// Pad-less unit fixtures dangle by construction; these advisory DFM codes are
// incidental to the property under test (P5 dangling check).
/**
 * The `dfm`-class advisories these clearance / short tests are not about. The
 * copper-shape codes joined the list in S12: two IDENTICAL same-net traces are
 * a legitimate `TRACE_OVERLAP` (and a 0° `TRACE_ACUTE_ANGLE` at each shared
 * end) — the duplicate copper the item model cannot see (DFM contract 11 §5.7)
 * — which says nothing about the clearance verdict asserted here.
 */
const ADVISORY_DFM = new Set([
  "TRACK_DANGLING",
  "VIA_DANGLING",
  "COPPER_CONNECTION_WIDTH",
  "COPPER_SLIVER",
  "COPPER_SHAPE_UNCHECKED",
  "TRACE_ACUTE_ANGLE",
  "TRACE_OVERLAP",
]);
function realCodes(report: DrcReport) {
  return report.violations.map((v) => v.code).filter((c) => !ADVISORY_DFM.has(c));
}

function board(overrides: Partial<PcbBoardSettings> = {}): PcbBoardSettings {
  return { ...createDefaultPcbBoardSettings(TS), ...overrides };
}

function withMinTraceWidth(mm: number): PcbBoardSettings {
  const base = createDefaultPcbBoardSettings(TS);
  return {
    ...base,
    designRules: {
      ...base.designRules,
      minimums: { ...base.designRules.minimums, traceWidthMm: mm },
    },
  };
}

function projection(
  parts: Partial<DesignerPcbProjection> = {},
): DesignerPcbProjection {
  return {
    designId: "d1",
    revision: 1,
    board: parts.board ?? board(),
    placements: parts.placements ?? [],
    traces: parts.traces ?? [],
    vias: parts.vias ?? [],
    freeHoles: parts.freeHoles ?? [],
    freePads: parts.freePads ?? [],
    overlayTexts: parts.overlayTexts ?? [],
    overlayShapes: parts.overlayShapes ?? [],
    zones: parts.zones ?? [],
    keepouts: [],
    ratsnest: parts.ratsnest ?? [],
    netNames: parts.netNames ?? {},
    padNets: parts.padNets,
    warnings: [],
  };
}

function trace(
  id: string,
  netId: string | null,
  pts: Array<[number, number]>,
  opts: {
    widthMm?: number;
    layer?: PcbTrace["layer"];
    netClassId?: string;
  } = {},
): PcbTrace {
  return {
    id,
    netId,
    netClassId: opts.netClassId ?? "default",
    layer: opts.layer ?? "F.Cu",
    widthMm: opts.widthMm ?? 0.2,
    pointsNm: pts.map(([x, y]) => ({ x: x * MM, y: y * MM })),
    segmentMode: "manhattan-90",
  };
}

function via(
  id: string,
  opts: {
    netId?: string | null;
    center?: { x: number; y: number };
    diameterMm?: number;
    drillMm?: number;
    fromLayer?: PcbVia["fromLayer"];
    toLayer?: PcbVia["toLayer"];
  } = {},
): PcbVia {
  return {
    id,
    netId: opts.netId ?? null,
    netClassId: "default",
    centerMm: opts.center ?? { x: 0, y: 0 },
    diameterMm: opts.diameterMm ?? 0.8,
    drillMm: opts.drillMm ?? 0.4,
    fromLayer: opts.fromLayer ?? "F.Cu",
    toLayer: opts.toLayer ?? "B.Cu",
    viaType: "through",
    protection: "tented",
    provenance: "route",
  };
}

function freeHole(
  id: string,
  center: { x: number; y: number },
  drillMm: number,
): PcbFreeHole {
  return { id, centerMm: center, drillMm, lockedAt: null };
}

function rectPad(
  number: string,
  center: { x: number; y: number },
  w: number,
  h: number,
): FootprintRenderSourcePad {
  return {
    id: `pad-${number}`,
    number,
    shape: "rect",
    centerMm: center,
    widthMm: w,
    heightMm: h,
    rotationDeg: 0,
  };
}

function placement(
  id: string,
  opts: {
    positionMm?: { x: number; y: number };
    layer?: PcbPlacedPart["layer"];
    mirrored?: boolean;
    pads?: FootprintRenderSourcePad[];
    reference?: string;
  } = {},
): PcbPlacedPart {
  return {
    id,
    partId: id,
    componentId: "c",
    reference: opts.reference ?? id,
    positionMm: opts.positionMm ?? { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: opts.mirrored ?? false,
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
        pads: opts.pads ?? [],
        graphics: [],
        labels: [],
        bounds: null,
        warnings: [],
      },
    },
  };
}

function codes(report: DrcReport): DrcRuleCode[] {
  return report.violations.map((v) => v.code);
}

describe("runDrc — clearance", () => {
  test("trace-to-trace clearance fails just below the rule", () => {
    // widths 0.2 (half 0.1); centers 0.4 apart → edge gap 0.2 < 0.25 rule.
    const report = runDrc(
      projection({
        traces: [
          trace("a", "n1", [
            [0, 0],
            [10, 0],
          ]),
          trace("b", "n2", [
            [0, 0.4],
            [10, 0.4],
          ]),
        ],
      }),
    );
    expect(codes(report)).toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("trace-to-trace clearance passes just above the rule", () => {
    // centers 0.5 apart → edge gap 0.3 ≥ 0.25 rule and ≥ 0.127 fab.
    const report = runDrc(
      projection({
        traces: [
          trace("a", "n1", [
            [0, 0],
            [10, 0],
          ]),
          trace("b", "n2", [
            [0, 0.5],
            [10, 0.5],
          ]),
        ],
      }),
    );
    expect(realCodes(report)).toHaveLength(0);
  });

  test("same-net traces are never flagged (clearance or short)", () => {
    const report = runDrc(
      projection({
        traces: [
          trace("a", "n1", [
            [0, 0],
            [10, 0],
          ]),
          trace("b", "n1", [
            [0, 0],
            [10, 0],
          ]),
        ],
      }),
    );
    expect(realCodes(report)).toHaveLength(0);
  });

  // S8 (contract 06 §4 / 07 §4): unassigned copper that TOUCHES a named net is
  // an extension of it — neither a clearance error (it was, until S8) nor a
  // short. Only a null-net item that is merely close is still judged.
  test("null-net overlap is an extension: neither a clearance error nor a short", () => {
    const report = runDrc(
      projection({
        traces: [
          trace("a", null, [
            [0, 0],
            [10, 0],
          ]),
          trace("b", "n2", [
            [5, -5],
            [5, 5],
          ]),
        ],
      }),
    );
    expect(codes(report)).not.toContain("TRACE_TO_TRACE_CLEARANCE");
    expect(codes(report)).not.toContain("NET_SHORT_CIRCUIT");
  });

  test("null-net copper merely close to a named net is still a clearance error", () => {
    const report = runDrc(
      projection({
        traces: [
          trace("a", null, [
            [0, 0],
            [10, 0],
          ]),
          // 0.15 mm edge gap: not touching, below the 0.25 mm rule.
          trace("b", "n2", [
            [0, 0.35],
            [10, 0.35],
          ]),
        ],
      }),
    );
    expect(codes(report)).toContain("TRACE_TO_TRACE_CLEARANCE");
    expect(codes(report)).not.toContain("NET_SHORT_CIRCUIT");
  });

  test("different known nets crossing is a short", () => {
    const report = runDrc(
      projection({
        traces: [
          trace("a", "n1", [
            [0, 0],
            [10, 0],
          ]),
          trace("b", "n2", [
            [5, -5],
            [5, 5],
          ]),
        ],
      }),
    );
    expect(codes(report)).toContain("NET_SHORT_CIRCUIT");
    expect(codes(report)).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("different layers do not clear-check against each other", () => {
    const report = runDrc(
      projection({
        traces: [
          trace("a", "n1", [
            [0, 0],
            [10, 0],
          ]),
          trace(
            "b",
            "n2",
            [
              [5, -5],
              [5, 5],
            ],
            { layer: "B.Cu" },
          ),
        ],
      }),
    );
    expect(realCodes(report)).toHaveLength(0);
  });
});

describe("runDrc — trace ↔ pad (mirror handling)", () => {
  // Placement on B.Cu at (10,0), pad local (2,0) → mirrored world x = 10-2 = 8.
  const pl = placement("U1", {
    positionMm: { x: 10, y: 0 },
    layer: "B.Cu",
    pads: [rectPad("1", { x: 2, y: 0 }, 0.5, 0.5)],
  });

  test("vertical trace through the mirrored pad position violates", () => {
    const report = runDrc(
      projection({
        placements: [pl],
        // Named pad: since S8 a null-net pad touched by a trace is an extension
        // of it, and this test is about the mirror geometry, not that tier.
        padNets: { "U1|1": "n1" },
        traces: [
          trace(
            "t",
            "n2",
            [
              [8, -5],
              [8, 5],
            ],
            { layer: "B.Cu" },
          ),
        ],
      }),
    );
    // The trace runs THROUGH the mirrored pad, so the contact is the short
    // tier's verdict, not a clearance deficit — either proves the pad sits at
    // world x = 8.
    expect(codes(report)).toContain("NET_SHORT_CIRCUIT");
  });

  test("trace at the non-mirrored x is clear (proves X-mirror applied)", () => {
    const report = runDrc(
      projection({
        placements: [pl],
        traces: [
          trace(
            "t",
            "n2",
            [
              [12, -5],
              [12, 5],
            ],
            { layer: "B.Cu" },
          ),
        ],
      }),
    );
    expect(realCodes(report)).toHaveLength(0);
  });
});

describe("runDrc — trace ↔ via", () => {
  test("trace too close to a different-net via violates", () => {
    // via radius 0.4 at (5,1); trace half 0.1 at y=0 → gap = 1-0.4-0.1 = 0.5 ≥ 0.25 ok
    const ok = runDrc(
      projection({
        traces: [
          trace("t", "n1", [
            [0, 0],
            [10, 0],
          ]),
        ],
        vias: [via("v", { netId: "n2", center: { x: 5, y: 1 } })],
      }),
    );
    expect(codes(ok)).not.toContain("TRACE_TO_VIA_CLEARANCE");

    // via at (5,0.6) → gap = 0.6-0.4-0.1 = 0.1 < 0.25 → violation
    const bad = runDrc(
      projection({
        traces: [
          trace("t", "n1", [
            [0, 0],
            [10, 0],
          ]),
        ],
        vias: [via("v", { netId: "n2", center: { x: 5, y: 0.6 } })],
      }),
    );
    expect(codes(bad)).toContain("TRACE_TO_VIA_CLEARANCE");
  });
});

describe("runDrc — manufacturability", () => {
  test("trace width below minimum", () => {
    const report = runDrc(
      projection({
        traces: [
          trace(
            "t",
            "n1",
            [
              [0, 0],
              [10, 0],
            ],
            { widthMm: 0.15 },
          ),
        ],
      }),
    );
    expect(codes(report)).toContain("TRACE_WIDTH_MIN");
  });

  test("via annular ring below minimum", () => {
    // diameter 0.9 drill 0.6 → annular 0.15 < 0.2; diameter ≥ 0.8, drill ≥ 0.4 → no other min errors
    const report = runDrc(
      projection({ vias: [via("v", { diameterMm: 0.9, drillMm: 0.6 })] }),
    );
    expect(codes(report)).toContain("ANNULAR_RING_MIN");
    expect(codes(report)).not.toContain("VIA_DIAMETER_MIN");
    expect(codes(report)).not.toContain("VIA_DRILL_MIN");
  });

  test("compliant via produces no violations", () => {
    const report = runDrc(
      projection({ vias: [via("v", { diameterMm: 0.8, drillMm: 0.4 })] }),
    );
    expect(realCodes(report)).toHaveLength(0);
  });

  test("fabricator trace-width warning fires below fab min (design min relaxed)", () => {
    // design min 0.05 (relaxed), width 0.08 ≥ 0.05 (no error) but < 0.10 fab
    // floor (2026-07 JLCPCB, P8 refresh) → warning only
    const report = runDrc(
      projection({
        board: withMinTraceWidth(0.05),
        traces: [
          trace(
            "t",
            "n1",
            [
              [0, 0],
              [10, 0],
            ],
            { widthMm: 0.08 },
          ),
        ],
      }),
    );
    expect(codes(report)).toContain("FAB_TRACE_WIDTH");
    expect(codes(report)).not.toContain("TRACE_WIDTH_MIN");
  });

  test("custom fabricator suppresses all fab warnings", () => {
    const report = runDrc(
      projection({
        board: board({ fabricator: "custom" }),
        traces: [
          trace(
            "t",
            "n1",
            [
              [0, 0],
              [10, 0],
            ],
            { widthMm: 0.05 },
          ),
        ],
      }),
    );
    expect(codes(report)).toContain("TRACE_WIDTH_MIN");
    expect(codes(report).filter((c) => c.startsWith("FAB_"))).toHaveLength(0);
  });
});

describe("runDrc — constraints + structural + connectivity", () => {
  test("trace on a non-stackup layer (2-layer board)", () => {
    const report = runDrc(
      projection({
        traces: [
          trace(
            "t",
            "n1",
            [
              [0, 0],
              [10, 0],
            ],
            { layer: "In1.Cu" },
          ),
        ],
      }),
    );
    expect(codes(report)).toContain("TRACE_LAYER_MISMATCH");
  });

  test("In1.Cu is valid on a 4-layer board", () => {
    const report = runDrc(
      projection({
        board: board({ layerCount: 4 }),
        traces: [
          trace(
            "t",
            "n1",
            [
              [0, 0],
              [10, 0],
            ],
            { layer: "In1.Cu" },
          ),
        ],
      }),
    );
    expect(codes(report)).not.toContain("TRACE_LAYER_MISMATCH");
  });

  test("placed part with no pads", () => {
    const report = runDrc(
      projection({ placements: [placement("U1", { pads: [] })] }),
    );
    expect(codes(report)).toContain("PLACED_PART_MISSING_FOOTPRINT");
  });

  test("unconnected net from the engine's own ratsnest", () => {
    // Two pads on one net with no copper between them. The engine derives the
    // ratsnest from its OWN connectivity (contract 06 §1), so this reports
    // whether or not the projection carries a `ratsnest` field.
    const report = runDrc(
      projection({
        placements: [
          placement("A", {
            positionMm: { x: 0, y: 0 },
            pads: [rectPad("1", { x: 0, y: 0 }, 1, 1)],
          }),
          placement("B", {
            positionMm: { x: 5, y: 0 },
            pads: [rectPad("1", { x: 0, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "A|1": "n1", "B|1": "n1" },
        netNames: { n1: "VCC" },
      }),
    );
    const unconnected = report.violations.filter(
      (v) => v.code === "UNCONNECTED_NET",
    );
    expect(unconnected).toHaveLength(1);
    expect(unconnected[0]!.severity).toBe("error");
    expect(unconnected[0]!.message).toContain("VCC");
  });
});

describe("runDrc — ids, waivers, ignore", () => {
  const proj = projection({
    traces: [
      trace("a", "n1", [
        [0, 0],
        [10, 0],
      ]),
      trace("b", "n2", [
        [0, 0.4],
        [10, 0.4],
      ]),
    ],
  });

  test("violation ids are stable across runs (order-independent)", () => {
    const r1 = runDrc(proj);
    const r2 = runDrc(proj);
    expect(r1.violations.map((v) => v.id).sort()).toEqual(
      r2.violations.map((v) => v.id).sort(),
    );
  });

  test("waived violation is marked and excluded from summary", () => {
    const base = runDrc(proj);
    const id = base.violations[0]!.id;
    const waived = runDrc(proj, { waivedIds: [id] });
    const v = waived.violations.find((x) => x.id === id);
    expect(v?.waived).toBe(true);
    expect(waived.summary.errors).toBe(base.summary.errors - 1);
  });

  test("ignored rule-class drops violations entirely", () => {
    const report = runDrc(proj, { ignoredRuleClasses: ["clearance"] });
    expect(codes(report)).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("summary + countsByCode reflect emitted violations", () => {
    const report = runDrc(proj);
    expect(report.summary.errors).toBeGreaterThanOrEqual(1);
    expect(report.countsByCode.TRACE_TO_TRACE_CLEARANCE).toBeGreaterThanOrEqual(
      1,
    );
  });
});

describe("runDrc — nm→mm conversion sanity", () => {
  test("1 mm-separated traces are clear (conversion applied, not raw nm)", () => {
    const report = runDrc(
      projection({
        traces: [
          trace(
            "a",
            "n1",
            [
              [0, 0],
              [10, 0],
            ],
            { widthMm: 0.2 },
          ),
          trace(
            "b",
            "n2",
            [
              [0, 1],
              [10, 1],
            ],
            { widthMm: 0.2 },
          ),
        ],
      }),
    );
    // edge gap = 1 - 0.2 = 0.8 mm ≥ rule; if nm leaked through, gap would be huge but still clear.
    expect(realCodes(report)).toHaveLength(0);
  });
});

describe("runDrc — P2 checks", () => {
  test("via-to-via clearance: close different-net vias violate, far ones pass", () => {
    const bad = runDrc(
      projection({
        vias: [
          via("a", { netId: "n1", center: { x: 0, y: 0 } }),
          via("b", { netId: "n2", center: { x: 0.9, y: 0 } }), // gap = 0.9 - 0.8 = 0.1 < 0.3
        ],
      }),
    );
    expect(codes(bad)).toContain("VIA_TO_VIA_CLEARANCE");

    const ok = runDrc(
      projection({
        vias: [
          via("a", { netId: "n1", center: { x: 0, y: 0 } }),
          via("b", { netId: "n2", center: { x: 3, y: 0 } }),
        ],
      }),
    );
    expect(codes(ok)).not.toContain("VIA_TO_VIA_CLEARANCE");
  });

  test("pad-to-pad clearance flags separate footprints, not intra-footprint pads", () => {
    // Two separate placements, pads 0.2 mm apart, different nets → violation.
    const separate = runDrc(
      projection({
        placements: [
          placement("A", {
            positionMm: { x: 0, y: 0 },
            pads: [rectPad("1", { x: 0, y: 0 }, 1, 1)],
          }),
          placement("B", {
            positionMm: { x: 1.2, y: 0 },
            pads: [rectPad("1", { x: 0, y: 0 }, 1, 1)], // edge gap = 1.2 - 1.0 = 0.2 < 0.25
          }),
        ],
        padNets: { "A|1": "n1", "B|1": "n2" },
      }),
    );
    expect(codes(separate)).toContain("PAD_TO_PAD_CLEARANCE");

    // One footprint with two close, different-net pads → NOT flagged (footprint's job).
    const intra = runDrc(
      projection({
        placements: [
          placement("U1", {
            pads: [
              rectPad("1", { x: -0.3, y: 0 }, 0.5, 0.5),
              rectPad("2", { x: 0.3, y: 0 }, 0.5, 0.5),
            ],
          }),
        ],
        padNets: { "U1|1": "n1", "U1|2": "n2" },
      }),
    );
    expect(codes(intra)).not.toContain("PAD_TO_PAD_CLEARANCE");
  });

  test("copper-to-board-edge warns near the outline", () => {
    // Default board 50×30 centered at origin → right edge at x=25.
    const near = runDrc(
      projection({
        traces: [
          trace("t", "n1", [
            [24.9, 0],
            [24.9, 5],
          ]),
        ], // ~0.0 mm to edge < 0.5
      }),
    );
    expect(codes(near)).toContain("COPPER_TO_BOARD_EDGE");

    const center = runDrc(
      projection({
        traces: [
          trace("t", "n1", [
            [0, 0],
            [5, 0],
          ]),
        ],
      }),
    );
    expect(codes(center)).not.toContain("COPPER_TO_BOARD_EDGE");
  });

  test("off-board copper: a via outside the outline", () => {
    const report = runDrc(
      projection({ vias: [via("v", { center: { x: 100, y: 0 } })] }),
    );
    expect(codes(report)).toContain("COPPER_OFF_BOARD");
  });

  test("hole-to-hole spacing (free holes, mechanical)", () => {
    const report = runDrc(
      projection({
        freeHoles: [
          freeHole("h1", { x: 0, y: 0 }, 0.4),
          freeHole("h2", { x: 0.5, y: 0 }, 0.4), // gap = 0.5 - 0.4 = 0.1 < 0.25
        ],
      }),
    );
    expect(codes(report)).toContain("HOLE_TO_HOLE");
  });

  test("via aspect ratio exceeds fab maximum (thick board)", () => {
    const report = runDrc(
      projection({
        board: board({ boardThicknessMm: 5 }), // 5 / 0.4 = 12.5 : 1 > 10 (jlcpcb_2l)
        vias: [via("v", { diameterMm: 0.8, drillMm: 0.4 })],
      }),
    );
    expect(codes(report)).toContain("VIA_ASPECT_RATIO");
    // 0.8/0.4 via is otherwise compliant — no min errors.
    expect(codes(report)).not.toContain("VIA_DRILL_MIN");
  });

  test("via layer span: degenerate same-layer via", () => {
    const report = runDrc(
      projection({
        vias: [via("v", { fromLayer: "F.Cu", toLayer: "F.Cu" })],
      }),
    );
    expect(codes(report)).toContain("VIA_LAYER_SPAN");
  });
});

describe("runDrc — per-net class assignment", () => {
  function wideClassBoard(): PcbBoardSettings {
    const def = createDefaultPcbBoardSettings(TS);
    const base = def.netClasses[0]!;
    return board({
      netClasses: [
        ...def.netClasses,
        { ...base, id: "wide", name: "Wide", clearanceMm: 2.0 },
      ],
    });
  }

  // Pad on net n1 (1×1 at origin → edge x=0.5); vertical trace on n2 at x=1.0
  // (half 0.1 → edge x=0.9) → gap 0.4 mm. Passes the 0.25 default rule, but not
  // a 2.0 mm net-class clearance. Net names are non-matching, so without an
  // explicit assignment the pad's net resolves to the default class.
  const proj = (assignments?: Record<string, string>): DesignerPcbProjection =>
    projection({
      board: {
        ...wideClassBoard(),
        ...(assignments ? { perNetClassAssignments: assignments } : {}),
      },
      netNames: { n1: "FOO", n2: "BAR" },
      placements: [
        placement("A", { pads: [rectPad("1", { x: 0, y: 0 }, 1, 1)] }),
      ],
      traces: [
        trace("t", "n2", [
          [1, -5],
          [1, 5],
        ]),
      ],
      padNets: { "A|1": "n1" },
    });

  test("no assignment → pad uses default clearance (no violation)", () => {
    expect(codes(runDrc(proj()))).not.toContain("TRACE_TO_PAD_CLEARANCE");
  });

  test("assigning the pad's net to a wide class tightens clearance → violation", () => {
    expect(codes(runDrc(proj({ n1: "wide" })))).toContain(
      "TRACE_TO_PAD_CLEARANCE",
    );
  });

  // Regression for audit B3-2: a trace on a reassigned net must resolve its
  // class LIVE (from the net), not from its stale stored netClassId — so trace
  // and pad on the same net agree. t1 carries stored "default" but its net n1
  // is assigned "wide"; a foreign trace 0.4 mm away must flag.
  test("trace uses the live net class, not its stored netClassId", () => {
    const report = runDrc(
      projection({
        board: {
          ...wideClassBoard(),
          perNetClassAssignments: { n1: "wide" },
        },
        netNames: { n1: "FOO", n2: "BAR" },
        traces: [
          trace("t1", "n1", [[0, 0], [10, 0]], { netClassId: "default" }),
          trace("t2", "n2", [[0, 0.6], [10, 0.6]]),
        ],
      }),
    );
    expect(codes(report)).toContain("TRACE_TO_TRACE_CLEARANCE");
  });
});

/**
 * S6 §8 — `runDrc` DEFAULTS its suppression options from the projection, so the
 * HTTP routes, the SDK (assistant, MCP) and the cloud apply path all produce
 * the same report for the same projection. An explicit option still wins.
 */
describe("S6 §8 — options default from the projection", () => {
  function clearancePair(over: Partial<PcbBoardSettings> = {}) {
    return projection({
      board: { ...board(), ...over },
      netNames: { n1: "A", n2: "B" },
      traces: [
        trace("a", "n1", [[0, 0], [10, 0]]),
        trace("b", "n2", [[0, 0.4], [10, 0.4]]),
      ],
    });
  }

  test("board.drcSeverityOverrides is honoured with no options at all", () => {
    const report = runDrc(
      clearancePair({
        drcSeverityOverrides: { TRACE_TO_TRACE_CLEARANCE: "warning" },
      }),
    );
    const v = report.violations.find(
      (x) => x.code === "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(v!.severity).toBe("warning");
  });

  test("an explicit EMPTY override map wins over the board's", () => {
    const report = runDrc(
      clearancePair({
        drcSeverityOverrides: { TRACE_TO_TRACE_CLEARANCE: "warning" },
      }),
      { severityOverrides: {} },
    );
    const v = report.violations.find(
      (x) => x.code === "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(v!.severity).toBe("error");
  });

  test("waivers and class ignores default from viewState", () => {
    const base = runDrc(clearancePair());
    const id = base.violations.find(
      (v) => v.code === "TRACE_TO_TRACE_CLEARANCE",
    )!.id;

    const waived = runDrc(
      clearancePair({
        viewState: {
          ...board().viewState!,
          drcWaivedViolationIds: [id],
        },
      }),
    );
    expect(
      waived.violations.find((v) => v.code === "TRACE_TO_TRACE_CLEARANCE")!
        .waived,
    ).toBe(true);
    expect(waived.summary.errors).toBe(base.summary.errors - 1);

    const ignored = runDrc(
      clearancePair({
        viewState: {
          ...board().viewState!,
          drcIgnoredRuleClasses: ["clearance"],
        },
      }),
    );
    expect(codes(ignored)).not.toContain("TRACE_TO_TRACE_CLEARANCE");
    // An explicit empty array asks for the unfiltered report.
    expect(
      codes(
        runDrc(
          clearancePair({
            viewState: {
              ...board().viewState!,
              drcIgnoredRuleClasses: ["clearance"],
            },
          }),
          { ignoredRuleClasses: [] },
        ),
      ),
    ).toContain("TRACE_TO_TRACE_CLEARANCE");
  });
});

/** S6 §2.1 / §10 — every reason the resolver can refuse a rule for. */
describe("S6 §2.1 — rule validity reporting", () => {
  const ok = {
    id: "r",
    name: "Rule",
    enabled: true,
    priority: 1,
    scopes: [],
    constraint: { kind: "clearance" as const, mm: 0.5 },
  };
  const withRules = (drcRules: unknown[]) =>
    projection({
      board: {
        ...board(),
        drcRules: drcRules as PcbBoardSettings["drcRules"],
      },
      netNames: { n1: "A", n2: "B" },
      traces: [
        trace("a", "n1", [[0, 0], [10, 0]]),
        trace("b", "n2", [[0, 0.6], [10, 0.6]]),
      ],
    });
  const messageOf = (rules: unknown[], code: DrcRuleCode) =>
    runDrc(withRules(rules)).violations.find((v) => v.code === code)?.message;

  test("malformed: no id, no name, a bad constraint, a bad scope", () => {
    expect(messageOf([{ ...ok, id: 123 }], "DRC_RULE_INVALID")).toContain(
      "rule has no id",
    );
    expect(messageOf([{ ...ok, name: null }], "DRC_RULE_INVALID")).toContain(
      "rule has no name",
    );
    expect(
      messageOf(
        [{ ...ok, constraint: { kind: "clearance", mm: -1 } }],
        "DRC_RULE_INVALID",
      ),
    ).toContain("negative");
    expect(
      messageOf(
        [{ ...ok, scopes: [{ kind: "net", netIds: "n1" }] }],
        "DRC_RULE_INVALID",
      ),
    ).toContain("netIds");
    expect(
      messageOf(
        [{ ...ok, scopes: [{ kind: "pairKind", pairKinds: ["nope"] }] }],
        "DRC_RULE_INVALID",
      ),
    ).toContain("unknown pair kind");
  });

  test("duplicate_id: the first occurrence in array order is the one that keeps working", () => {
    const report = runDrc(
      withRules([
        { ...ok, id: "dup", constraint: { kind: "clearance", mm: 0.5 } },
        { ...ok, id: "dup", constraint: { kind: "clearance", mm: 5 } },
      ]),
    );
    expect(
      report.violations.find((v) => v.code === "DRC_RULE_INVALID")!.message,
    ).toContain("already used");
    // The 0.5 rule (the first) is the one that resolved, not the 5 mm dupe.
    expect(
      report.violations.find((v) => v.code === "TRACE_TO_TRACE_CLEARANCE")!
        .requiredMm,
    ).toBeCloseTo(0.5, 9);
  });

  test("a DISABLED row owns no id — an enabled rule may reuse it", () => {
    // A disabled rule is absent (§2.1). Treating it as an id owner turned the
    // rule that actually resolves into a `duplicate_id` drop — fail-OPEN for a
    // tightening rule, and silent from the user's side because the disabled row
    // reports nothing either.
    const report = runDrc(
      withRules([
        { ...ok, id: "dup", enabled: false, constraint: { kind: "clearance", mm: 0.1 } },
        { ...ok, id: "dup", enabled: true, constraint: { kind: "clearance", mm: 5 } },
      ]),
    );
    expect(codes(report)).not.toContain("DRC_RULE_INVALID");
    expect(
      report.violations.find((v) => v.code === "TRACE_TO_TRACE_CLEARANCE")!
        .requiredMm,
    ).toBeCloseTo(5, 9);
  });

  test("area_polygon_invalid: too few points, zero area, self-intersecting", () => {
    const area = (polygonMm: Array<{ x: number; y: number }>) => [
      { ...ok, scopes: [{ kind: "area", polygonMm }] },
    ];
    expect(
      messageOf(area([{ x: 0, y: 0 }, { x: 1, y: 0 }]), "DRC_RULE_INVALID"),
    ).toContain("fewer than 3");
    expect(
      messageOf(
        area([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]),
        "DRC_RULE_INVALID",
      ),
    ).toContain("degenerate");
    expect(
      messageOf(
        // A bow-tie with NON-zero area, so it fails on self-intersection
        // rather than on the degenerate-area test above it.
        area([
          { x: 0, y: 0 },
          { x: 4, y: 4 },
          { x: 4, y: 0 },
          { x: 0, y: 3 },
        ]),
        "DRC_RULE_INVALID",
      ),
    ).toContain("self-intersects");
  });

  test("area_limit: the 32nd DISTINCT polygon invalidates its own rule", () => {
    const areaRule = (i: number) => ({
      ...ok,
      id: `a${i}`,
      name: `Area ${i}`,
      scopes: [
        {
          kind: "area",
          polygonMm: [
            { x: i, y: 0 },
            { x: i + 0.5, y: 0 },
            { x: i + 0.5, y: 0.5 },
            { x: i, y: 0.5 },
          ],
        },
      ],
    });
    const rules = Array.from({ length: 32 }, (_, i) => areaRule(i));
    const report = runDrc(withRules(rules));
    const invalid = report.violations.filter(
      (v) => v.code === "DRC_RULE_INVALID",
    );
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.message).toContain("Area 31");
    expect(invalid[0]!.message).toContain("31 distinct area polygons");
    // 31 rules survive: the cap is on POLYGONS, not on rules.
    expect(runDrc(withRules(rules.slice(0, 31))).violations).not.toContainEqual(
      expect.objectContaining({ code: "DRC_RULE_INVALID" }),
    );
  });

  test("scope_kind_not_allowed: pairKind on a scalar rule", () => {
    expect(
      messageOf(
        [
          {
            ...ok,
            constraint: { kind: "trackWidth", minMm: 0.3 },
            scopes: [{ kind: "pairKind", pairKinds: ["traceToTrace"] }],
          },
        ],
        "DRC_RULE_INVALID",
      ),
    ).toContain("no meaning on a trackWidth rule");
  });

  test("ineffective: unknown net, unknown class, unknown layer — the rule stays active", () => {
    expect(
      messageOf(
        [{ ...ok, scopes: [{ kind: "net", netIds: ["ghost"] }] }],
        "DRC_RULE_INEFFECTIVE",
      ),
    ).toContain("ghost");
    expect(
      messageOf(
        [{ ...ok, scopes: [{ kind: "netClass", netClassIds: ["ghost"] }] }],
        "DRC_RULE_INEFFECTIVE",
      ),
    ).toContain("ghost");
    expect(
      messageOf(
        [{ ...ok, scopes: [{ kind: "layer", layers: ["In7.Cu"] }] }],
        "DRC_RULE_INEFFECTIVE",
      ),
    ).toContain("In7.Cu");
    // A rule scoped to an unknown net PLUS a real one still enforces.
    expect(
      codes(
        runDrc(
          withRules([
            { ...ok, scopes: [{ kind: "net", netIds: ["ghost", "n1"] }] },
          ]),
        ),
      ),
    ).toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("several reasons on ONE rule become ONE violation, not colliding ids", () => {
    const report = runDrc(
      withRules([
        {
          ...ok,
          scopes: [
            { kind: "net", netIds: ["ghost"] },
            { kind: "layer", layers: ["In7.Cu"] },
          ],
        },
      ]),
    );
    const hits = report.violations.filter(
      (v) => v.code === "DRC_RULE_INEFFECTIVE",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("ghost");
    expect(hits[0]!.message).toContain("In7.Cu");
    expect(new Set(report.violations.map((v) => v.id)).size).toBe(
      report.violations.length,
    );
  });

  test("a disabled rule is neither invalid nor ineffective — it is absent", () => {
    const report = runDrc(
      withRules([{ ...ok, enabled: false, constraint: { kind: "clearance", mm: -1 } }]),
    );
    expect(codes(report)).not.toContain("DRC_RULE_INVALID");
    expect(codes(report)).not.toContain("DRC_RULE_INEFFECTIVE");
  });

  test("DRC_RULE_INVALID is non-overridable and non-waivable", () => {
    const proj = withRules([{ ...ok, id: 123 }]);
    const ignored = runDrc(proj, {
      severityOverrides: { DRC_RULE_INVALID: "ignore" },
      ignoredRuleClasses: ["structural"],
    });
    const v = ignored.violations.find((x) => x.code === "DRC_RULE_INVALID");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
    expect(runDrc(proj, { waivedIds: [v!.id] }).violations.find(
      (x) => x.code === "DRC_RULE_INVALID",
    )!.waived).toBeUndefined();
  });

  test("determinism: reversed input arrays with area rules → identical id set", () => {
    const p = withRules([
      {
        ...ok,
        id: "area",
        priority: 10,
        scopes: [
          {
            kind: "area",
            polygonMm: [
              { x: 2, y: -2 },
              { x: 8, y: -2 },
              { x: 8, y: 2 },
              { x: 2, y: 2 },
            ],
          },
        ],
        constraint: { kind: "clearance", mm: 0.1 },
      },
      { ...ok, id: "global", priority: 1, constraint: { kind: "clearance", mm: 0.9 } },
    ]);
    const forward = runDrc(p);
    const reversed = runDrc({ ...p, traces: [...p.traces].reverse() });
    expect(reversed.violations.map((v) => v.id).sort()).toEqual(
      forward.violations.map((v) => v.id).sort(),
    );
  });
});
