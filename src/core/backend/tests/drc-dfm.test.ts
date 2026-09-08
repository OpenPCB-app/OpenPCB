/**
 * P5 free-win check suites: outline validity, hole-to-board-edge (slot-aware),
 * dangling copper, net-class dimension enforcement, zone-pour. Known-good AND
 * known-bad per check + a per-family determinism assertion.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import type {
  DesignerPcbProjection,
  PcbBoardSettings,
  PcbNetClass,
} from "../../../sdks/designer";
import {
  board,
  codes,
  freeHole,
  freePad,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

function board100(overrides: Partial<PcbBoardSettings> = {}): PcbBoardSettings {
  return {
    ...board(),
    outline: { kind: "rect", widthMm: 100, heightMm: 100, centerMm: { x: 0, y: 0 } },
    ...overrides,
  };
}

// A net whose copper links two pads: trace ends land inside both pad rings, so
// neither end dangles — a "clean" connectivity baseline.
function connectedNet(): DesignerPcbProjection {
  return projection({
    board: board100(),
    netNames: { n1: "SIG" },
    placements: [
      placement("A", { positionMm: { x: 0, y: 0 }, pads: [pad("1", { x: 0, y: 0 }, 1, 1)] }),
      placement("B", { positionMm: { x: 10, y: 0 }, pads: [pad("1", { x: 0, y: 0 }, 1, 1)] }),
    ],
    padNets: { "A|1": "n1", "B|1": "n1" },
    traces: [trace("t", "n1", [[0, 0], [10, 0]])],
  });
}

describe("DFM — board outline validity", () => {
  test("valid rect outline → no BOARD_OUTLINE_INVALID", () => {
    expect(codes(runDrc(projection({ board: board100() })))).not.toContain(
      "BOARD_OUTLINE_INVALID",
    );
  });

  test("self-intersecting polygon → BOARD_OUTLINE_INVALID", () => {
    const report = runDrc(
      projection({
        board: {
          ...board(),
          outline: {
            kind: "polygon",
            widthMm: 10,
            heightMm: 10,
            centerMm: { x: 5, y: 5 },
            pointsMm: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
              { x: 10, y: 0 },
              { x: 0, y: 10 },
            ],
          },
        },
      }),
    );
    expect(codes(report)).toContain("BOARD_OUTLINE_INVALID");
  });

  test("cutout extending outside the board → BOARD_OUTLINE_INVALID", () => {
    const report = runDrc(
      projection({
        board: {
          ...board100(),
          cutouts: [
            {
              id: "c1",
              // Circle centered on the edge → half its vertices are off-board.
              shape: { kind: "circle", widthMm: 10, heightMm: 10, centerMm: { x: 50, y: 0 } },
            },
          ],
        },
      }),
    );
    expect(codes(report)).toContain("BOARD_OUTLINE_INVALID");
  });
});

describe("DFM — hole to board edge", () => {
  test("hole well inside the board → no violation", () => {
    expect(
      codes(runDrc(projection({ board: board100(), freeHoles: [freeHole("h", { x: 0, y: 0 }, 2)] }))),
    ).not.toContain("HOLE_TO_BOARD_EDGE");
  });

  // S6 §7 split the former dual-severity code: a drill that is not inside the
  // board region at all is HOLE_OFF_BOARD (error), not a near-miss warning.
  test("hole drill crossing the edge → HOLE_OFF_BOARD (error)", () => {
    const report = runDrc(
      projection({ board: board100(), freeHoles: [freeHole("h", { x: 49.2, y: 0 }, 3)] }),
    );
    const v = report.violations.find((x) => x.code === "HOLE_OFF_BOARD");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("error");
    expect(codes(report)).not.toContain("HOLE_TO_BOARD_EDGE");
  });

  test("hole near (but inside) the edge → warning", () => {
    // center x=49, drill 1 → edge at 49.5, board edge 50 → gap 0.5? no: gap =
    // 50-49-0.5 = 0.5 ≥ 0.3, clean. Use x=49.4 → gap 0.1 < 0.3 → warning.
    const report = runDrc(
      projection({ board: board100(), freeHoles: [freeHole("h", { x: 49.4, y: 0 }, 1)] }),
    );
    const v = report.violations.find((x) => x.code === "HOLE_TO_BOARD_EDGE");
    expect(v).toBeDefined();
    expect(v!.severity).toBe("warning");
  });

  test("slotted hole measured on its true length, not the round model", () => {
    // Round drill 1mm at x=48.6 → edge gap = 50-48.6-0.5 = 0.9 (clean). But a
    // 4mm slot along X reaches x=48.6+2=50.6, crossing the edge.
    const report = runDrc(
      projection({
        board: board100(),
        freeHoles: [
          {
            id: "s",
            centerMm: { x: 48.6, y: 0 },
            drillMm: 1,
            drillSlot: { lengthMm: 4, widthMm: 1, angleDeg: 0 },
            lockedAt: null,
          },
        ],
      }),
    );
    expect(codes(report)).toContain("HOLE_OFF_BOARD");
  });
});

describe("DFM — dangling copper", () => {
  test("both trace ends on pads → not dangling", () => {
    expect(codes(runDrc(connectedNet()))).not.toContain("TRACK_DANGLING");
  });

  test("trace with a free end → TRACK_DANGLING", () => {
    const base = connectedNet();
    // Extend the trace past pad B into empty space.
    base.traces = [trace("t", "n1", [[0, 0], [10, 0], [20, 0]])];
    expect(codes(runDrc(base))).toContain("TRACK_DANGLING");
  });

  test("mid-segment stitching via touching a trace interior → not dangling", () => {
    // Via at (5,0) on the trace interior, connected on F.Cu (trace) — but it
    // needs 2 layers; add a B.Cu trace ending at the via so it connects twice.
    const p = connectedNet();
    p.traces = [
      trace("f", "n1", [[0, 0], [10, 0]], { layer: "F.Cu" }),
      trace("b", "n1", [[5, 0], [5, 8]], { layer: "B.Cu" }),
    ];
    p.vias = [via("v", { netId: "n1", center: { x: 5, y: 0 } })];
    // B-trace top end (5,8) dangles, but the via itself connects both layers.
    expect(codes(runDrc(p))).not.toContain("VIA_DANGLING");
  });

  test("via connecting only one layer → VIA_DANGLING", () => {
    const p = connectedNet();
    p.vias = [via("v", { netId: "n1", center: { x: 40, y: 40 } })]; // isolated
    expect(codes(runDrc(p))).toContain("VIA_DANGLING");
  });
});

describe("DFM — net-class dimension enforcement", () => {
  const wide: PcbNetClass = {
    id: "wide",
    name: "Wide",
    traceWidthMm: 0.5,
    clearanceMm: 0.2,
    viaDiameterMm: 1.0,
    viaDrillMm: 0.5,
    color: "#fff",
    defaultViaProtection: "tented",
  };

  test("unclassified net at default width → NOT flagged (no false noise)", () => {
    // n1 falls to the array-order default class; its 0.2 trace must not flag
    // against the default class's 0.25 nominal.
    expect(codes(runDrc(connectedNet()))).not.toContain("NETCLASS_TRACE_WIDTH");
  });

  test("explicitly-assigned net routed below class width → NETCLASS_TRACE_WIDTH", () => {
    const base = board100();
    const report = runDrc(
      projection({
        board: {
          ...base,
          netClasses: [...base.netClasses, wide],
          perNetClassAssignments: { n1: "wide" },
        },
        netNames: { n1: "SIG" },
        traces: [trace("t", "n1", [[0, 0], [10, 0]], { widthMm: 0.25 })],
      }),
    );
    expect(codes(report)).toContain("NETCLASS_TRACE_WIDTH");
  });

  test("assigned net's undersized via → NETCLASS_VIA_DIAMETER + DRILL", () => {
    const base = board100();
    const report = runDrc(
      projection({
        board: {
          ...base,
          netClasses: [...base.netClasses, wide],
          perNetClassAssignments: { n1: "wide" },
        },
        netNames: { n1: "SIG" },
        vias: [via("v", { netId: "n1", diameterMm: 0.6, drillMm: 0.3 })],
      }),
    );
    expect(codes(report)).toContain("NETCLASS_VIA_DIAMETER");
    expect(codes(report)).toContain("NETCLASS_VIA_DRILL");
  });
});

describe("DFM — zone pour", () => {
  test("floating island inside an explicit zone → ISOLATED_COPPER_ISLAND", () => {
    const report = runDrc(
      projection({
        board: board100(),
        netNames: { n1: "GND" },
        zones: [
          {
            id: "z1",
            name: null,
            enabled: true,
            lockedAt: null,
            netName: "GND",
            netId: "n1",
            layer: "F.Cu",
            region: {
              kind: "polygon",
              pointsMm: [
                { x: -5, y: -5 },
                { x: 5, y: -5 },
                { x: 5, y: 5 },
                { x: -5, y: 5 },
              ],
            },
            priority: 0,
          },
        ],
      }),
    );
    const v = report.violations.find((x) => x.code === "ISOLATED_COPPER_ISLAND");
    expect(v).toBeDefined();
    expect(v!.anchors.some((a) => a.kind === "zone")).toBe(true);
  });
});

describe("DFM — determinism", () => {
  test("run twice → byte-identical report", () => {
    const p = board100Fixture();
    expect(JSON.stringify(runDrc(structuredClone(p)))).toBe(
      JSON.stringify(runDrc(structuredClone(p))),
    );
  });
});

function board100Fixture(): DesignerPcbProjection {
  const p = connectedNet();
  p.freeHoles = [freeHole("h", { x: 49.2, y: 0 }, 3)];
  p.zones = [
    {
      id: "z1",
      name: null,
      enabled: true,
      lockedAt: null,
      netName: "GND",
      netId: "n1",
      layer: "F.Cu",
      region: {
        kind: "polygon",
        pointsMm: [
          { x: -20, y: -20 },
          { x: -10, y: -20 },
          { x: -10, y: -10 },
          { x: -20, y: -10 },
        ],
      },
      priority: 0,
    },
  ];
  void freePad; // reserved for future slot fixtures
  return p;
}
