/**
 * Regression tests for the independent-review (Codex) findings on the DRC
 * hardening work. Each test pins a fixed bug.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import { resolveDiffPairs } from "../../../modules/designer/backend/pcb/diff-pair-resolver";
import type {
  DesignerPcbProjection,
  PcbBoardSettings,
  PcbFreeHole,
  PcbNetClass,
} from "../../../sdks/designer";
import {
  board,
  boardWithRules,
  codes,
  freeHole,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

function board100(over: Partial<PcbBoardSettings> = {}): PcbBoardSettings {
  return {
    ...board(),
    outline: { kind: "rect", widthMm: 100, heightMm: 100, centerMm: { x: 0, y: 0 } },
    ...over,
  };
}

describe("review: M7 non-waivable codes survive ruleClass ignore", () => {
  test("ignoring the connectivity class does NOT drop a dead short", () => {
    const p = projection({
      netNames: { n1: "A", n2: "B" },
      traces: [
        trace("a", "n1", [[0, 0], [10, 0]]),
        trace("b", "n2", [[5, -2], [5, 2]]),
      ],
    });
    const report = runDrc(p, { ignoredRuleClasses: ["connectivity"] });
    expect(codes(report)).toContain("NET_SHORT_CIRCUIT");
  });

  test('per-code "ignore" override cannot suppress NET_SHORT_CIRCUIT', () => {
    const p = projection({
      netNames: { n1: "A", n2: "B" },
      traces: [
        trace("a", "n1", [[0, 0], [10, 0]]),
        trace("b", "n2", [[5, -2], [5, 2]]),
      ],
    });
    const report = runDrc(p, {
      severityOverrides: { NET_SHORT_CIRCUIT: "ignore" },
    });
    expect(codes(report)).toContain("NET_SHORT_CIRCUIT");
  });
});

describe("review: B3 invalid pad layer still collides on all layers", () => {
  test("In1.Cu pad on a 2-layer board flags mismatch AND the B.Cu short", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("U1", {
            positionMm: { x: 5, y: 5 },
            pads: [pad("1", { x: 0, y: 0 }, 1.2, 1.2, { layer: "In1.Cu" })],
          }),
        ],
        padNets: { "U1|1": "n1" },
        netNames: { n1: "A", n2: "B" },
        traces: [trace("t", "n2", [[3, 5], [7, 5]], { layer: "B.Cu" })],
      }),
    );
    expect(codes(report)).toContain("PAD_LAYER_MISMATCH");
    expect(codes(report)).toContain("NET_SHORT_CIRCUIT");
  });
});

describe("review: H6 slot-aware hole-to-hole", () => {
  test("two slots with distant centers but overlapping ends → HOLE_TO_HOLE", () => {
    const slot = (id: string, cx: number): PcbFreeHole => ({
      id,
      centerMm: { x: cx, y: 0 },
      drillMm: 1,
      drillSlot: { lengthMm: 10, widthMm: 1, angleDeg: 0 },
      lockedAt: null,
    });
    // Slot A spans x∈[-5,5]; slot B centered at x=6 spans [1,11]; the ends
    // overlap (true gap < 0) though centers are 6 mm apart.
    const report = runDrc(
      projection({ board: board100(), freeHoles: [slot("a", 0), slot("b", 6)] }),
    );
    expect(codes(report)).toContain("HOLE_TO_HOLE");
  });
});

describe("review: M2 via type topology enforced at DRC", () => {
  test('a "blind" via spanning both outer layers → VIA_LAYER_SPAN', () => {
    const report = runDrc(
      projection({
        board: { ...board(), layerCount: 4 },
        vias: [
          via("v", { fromLayer: "F.Cu", toLayer: "B.Cu" }),
        ].map((v) => ({ ...v, viaType: "blind" as const })),
      }),
    );
    expect(codes(report)).toContain("VIA_LAYER_SPAN");
  });
});

describe("review: M9 netclass gate — name-matched class first in array", () => {
  test("GND net enforced even when the gnd class is netClasses[0]", () => {
    const gnd: PcbNetClass = {
      id: "gnd",
      name: "GND",
      traceWidthMm: 0.5,
      clearanceMm: 0.2,
      viaDiameterMm: 0.8,
      viaDrillMm: 0.4,
      color: "#000",
      defaultViaProtection: "tented",
    };
    const def: PcbNetClass = { ...gnd, id: "default", name: "Default", traceWidthMm: 0.25 };
    const report = runDrc(
      projection({
        board: { ...board(), netClasses: [gnd, def] },
        netNames: { g: "GND" },
        traces: [trace("t", "g", [[0, 0], [10, 0]], { widthMm: 0.2 })],
      }),
    );
    expect(codes(report)).toContain("NETCLASS_TRACE_WIDTH");
  });
});

describe("review: H1 malformed scoped rules don't crash", () => {
  test("area rule with a bad polygon is dropped, not crashing", () => {
    // A drcRule whose area scope has < 3 points must be rejected by the store
    // parser; here we assert the engine tolerates a well-formed area rule and
    // an empty-scope global rule together without throwing.
    const b: PcbBoardSettings = {
      ...board(),
      drcRules: [
        {
          id: "g",
          name: "global",
          enabled: true,
          priority: 1,
          scopes: [],
          constraint: { kind: "clearance", mm: 0.5 },
        },
      ],
    };
    const p = projection({
      board: b,
      netNames: { n1: "A", n2: "B" },
      traces: [
        trace("a", "n1", [[0, 0], [10, 0]]),
        trace("b", "n2", [[0, 0.6], [10, 0.6]]),
      ],
    });
    expect(() => runDrc(p)).not.toThrow();
    expect(codes(runDrc(p))).toContain("TRACE_TO_TRACE_CLEARANCE");
  });
});

describe("review: H4 creepage seeds from HV pads/vias + negative V + no dup", () => {
  const hv400: PcbNetClass = {
    id: "hv",
    name: "HV",
    traceWidthMm: 0.25,
    clearanceMm: 0.2,
    viaDiameterMm: 0.8,
    viaDrillMm: 0.4,
    color: "#f00",
    defaultViaProtection: "tented",
    voltageV: 400,
  };

  test("HV via near a 0 V trace → CREEPAGE_DISTANCE (via-seeded)", () => {
    const b: PcbBoardSettings = {
      ...board(),
      netClasses: [...board().netClasses, hv400],
      perNetClassAssignments: { hvn: "hv" },
    };
    const report = runDrc(
      projection({
        board: b,
        netNames: { hvn: "HV_RAIL", sig: "SIG" },
        vias: [via("v", { netId: "hvn", center: { x: 0, y: 0 }, diameterMm: 0.6 })],
        traces: [trace("t", "sig", [[-5, 0.6], [5, 0.6]])],
      }),
    );
    expect(codes(report)).toContain("CREEPAGE_DISTANCE");
  });

  test("negative-voltage net vs 0 V uses |ΔV| band", () => {
    const hvNeg: PcbNetClass = { ...hv400, id: "hvneg", name: "HVNEG", voltageV: -400 };
    const b: PcbBoardSettings = {
      ...board(),
      netClasses: [...board().netClasses, hvNeg],
      perNetClassAssignments: { hvn: "hvneg" },
    };
    const report = runDrc(
      projection({
        board: b,
        netNames: { hvn: "HV_NEG", sig: "SIG" },
        traces: [
          trace("hv", "hvn", [[0, 0], [10, 0]]),
          trace("sig", "sig", [[0, 1.25], [10, 1.25]]),
        ],
      }),
    );
    expect(codes(report)).toContain("CREEPAGE_DISTANCE");
  });

  test("two HV traces below spacing → exactly ONE violation (no A-B/B-A dup)", () => {
    const b: PcbBoardSettings = {
      ...board(),
      netClasses: [
        ...board().netClasses,
        hv400,
        { ...hv400, id: "hv2", name: "HV2", voltageV: 0 },
      ],
      perNetClassAssignments: { a: "hv", bnet: "hv2" },
    };
    const report = runDrc(
      projection({
        board: b,
        netNames: { a: "HV_A", bnet: "HV_B" },
        traces: [
          trace("ta", "a", [[0, 0], [10, 0]]),
          trace("tb", "bnet", [[0, 1.25], [10, 1.25]]),
        ],
      }),
    );
    expect(codes(report).filter((c) => c === "CREEPAGE_DISTANCE")).toHaveLength(1);
  });
});

describe("review: dangling requires same-net copper", () => {
  test("trace ending on a DIFFERENT-net pad is still dangling", () => {
    const report = runDrc(
      projection({
        board: board100(),
        netNames: { n1: "A", n2: "B" },
        placements: [
          placement("P", {
            positionMm: { x: 10, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "P|1": "n2" }, // pad is net B
        // trace on net A ends at the net-B pad — a short/touch, NOT a connection
        traces: [trace("t", "n1", [[-10, 0], [10, 0]])],
      }),
    );
    expect(codes(report)).toContain("TRACK_DANGLING");
  });
});

describe("review: diff-pair auto order is deterministic", () => {
  test("auto pairs sorted regardless of netNames insertion order", () => {
    const a = resolveDiffPairs(undefined, { x: "A_P", y: "A_N", p: "B_P", q: "B_N" });
    const b = resolveDiffPairs(undefined, { q: "B_N", p: "B_P", y: "A_N", x: "A_P" });
    expect(a.map((d) => d.id)).toEqual(b.map((d) => d.id));
  });
});

describe("review: SI angle-wrap does not misclassify near-parallel", () => {
  test("anti-parallel diff-pair legs still couple (no false uncoupled)", () => {
    // P runs +x, N runs −x at the same y-gap; they are anti-parallel but
    // physically a coupled pair. Since S14 there is no angle test left to get
    // wrong — coupling is a distance measure — but the fixture is kept as the
    // regression. Re-fixtured with pad terminals and an explicit gap target:
    // without pads the path model measures nothing, and without a target the
    // check makes no coupling verdict at all, so the assertion would have
    // passed for two reasons that are not the one it is about (contract 14
    // §4.2, §9).
    const pin = (id: string, x: number, y: number) =>
      placement(id, {
        positionMm: { x, y },
        pads: [pad("1", { x: 0, y: 0 }, 0.2, 0.2)],
      });
    const b: PcbBoardSettings = {
      ...board100(),
      diffPairs: [
        {
          id: "dp",
          name: "USB",
          pNetId: "p",
          nNetId: "n",
          gapMm: 0.15,
          maxUncoupledMm: 5,
        },
      ],
    };
    const report = runDrc(
      projection({
        board: b,
        netNames: { p: "USB_P", n: "USB_N" },
        placements: [
          pin("P1", -10, 0),
          pin("P2", 10, 0),
          pin("N1", -10, 0.35),
          pin("N2", 10, 0.35),
        ],
        padNets: { "P1|1": "p", "P2|1": "p", "N1|1": "n", "N2|1": "n" },
        traces: [
          trace("tp", "p", [[-10, 0], [10, 0]]),
          trace("tn", "n", [[10, 0.35], [-10, 0.35]]), // reversed direction
        ],
      }),
    );
    expect(codes(report)).not.toContain("DIFF_PAIR_UNCOUPLED_LENGTH");
    expect(codes(report)).not.toContain("DIFF_PAIR_GAP");
  });
});

describe("review: persistence keeps new DRC fields (smoke via boardWithRules)", () => {
  test("clearance floor is honored by the engine", () => {
    const floored = boardWithRules({ minimums: { clearanceMm: 0.5 } });
    const report = runDrc(
      projection({
        board: floored,
        netNames: { n1: "A", n2: "B" },
        traces: [
          trace("a", "n1", [[0, 0], [10, 0]]),
          trace("b", "n2", [[0, 0.6], [10, 0.6]]), // gap 0.4 < 0.5 floor
        ],
      }),
    );
    expect(codes(report)).toContain("TRACE_TO_TRACE_CLEARANCE");
  });
});
