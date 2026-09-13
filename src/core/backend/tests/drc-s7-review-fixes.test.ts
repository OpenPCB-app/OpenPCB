/**
 * S7 review fixes (R1 — the adversarial pass over the engine + copper
 * geometry). Each test names the finding it closes; contract 06 §§4, 6, 7.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import type {
  DesignerPcbProjection,
  DrcRuleCode,
  DrcViolation,
} from "../../../sdks/designer";
import {
  board,
  boardWithRules,
  freeHole,
  freePad,
  pad,
  placement,
  projection,
  trace,
} from "./helpers/drc-fixtures";

function of(report: { violations: DrcViolation[] }, code: DrcRuleCode) {
  return report.violations.filter((v) => v.code === code);
}
const bytes = (p: DesignerPcbProjection): string => JSON.stringify(runDrc(p));
const ids = (report: { violations: DrcViolation[] }): string[] =>
  report.violations.map((v) => v.id);

describe("R1 #1 — hole↔hole pairs are canonical (§7)", () => {
  const holes = (order: "ab" | "ba"): DesignerPcbProjection => {
    const a = freeHole("hh_a", { x: 10, y: 10 }, 1);
    const b = freeHole("hh_b", { x: 11.1, y: 10 }, 1); // 0.1 mm edge gap
    return projection({
      board: board({ fabricator: "jlcpcb_2l" }),
      freeHoles: order === "ab" ? [a, b] : [b, a],
    });
  };
  test("reversing freeHoles leaves the report byte-identical", () => {
    const report = runDrc(holes("ab"));
    expect(of(report, "HOLE_TO_HOLE")).toHaveLength(1);
    expect(bytes(holes("ab"))).toBe(bytes(holes("ba")));
  });
});

describe("R1 #2 — one pin's several copper shapes are one item (§6)", () => {
  /** Pad "1" as two rectangles, both within reach of one NPTH hole. */
  const twoShapes = (order: "ab" | "ba"): DesignerPcbProjection => {
    const a = pad("1", { x: -0.6, y: 0 }, 1, 1);
    const b = pad("1", { x: 0.6, y: 0 }, 1, 1);
    return projection({
      placements: [
        placement("U1", {
          positionMm: { x: 10, y: 10 },
          pads: order === "ab" ? [a, b] : [b, a],
        }),
      ],
      padNets: { "U1|1": "n1" },
      netNames: { n1: "A" },
      freeHoles: [freeHole("npth", { x: 10, y: 11.2 }, 0.8)],
    });
  };
  test("one COPPER_TO_HOLE with a unique id, the closer shape as witness", () => {
    const report = runDrc(twoShapes("ab"));
    const hits = of(report, "COPPER_TO_HOLE");
    expect(hits).toHaveLength(1);
    expect(new Set(ids(report)).size).toBe(ids(report).length);
    expect(bytes(twoShapes("ab"))).toBe(bytes(twoShapes("ba")));
  });
  test("a pin's own two drills are never a hole↔hole pair", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("U1", {
            positionMm: { x: 10, y: 10 },
            pads: [
              pad("1", { x: -0.6, y: 0 }, 1.2, 1.2, { drillDiameterMm: 0.6 }),
              pad("1", { x: 0.6, y: 0 }, 1.2, 1.2, { drillDiameterMm: 0.6 }),
            ],
          }),
        ],
        padNets: { "U1|1": "n1" },
        netNames: { n1: "A" },
      }),
    );
    expect(of(report, "HOLE_TO_HOLE")).toHaveLength(0);
  });
});

describe("R1 #4 — bounding-rectangle pads stay out of the intra-footprint short tier (§4)", () => {
  test("two trapezoid pads whose boxes overlap are not a short", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("U1", {
            positionMm: { x: 10, y: 10 },
            pads: [
              pad("1", { x: -0.5, y: 0 }, 1.2, 1, { shape: "trapezoid" }),
              pad("2", { x: 0.5, y: 0 }, 1.2, 1, { shape: "trapezoid" }),
            ],
          }),
        ],
        padNets: { "U1|1": "a", "U1|2": "b" },
        netNames: { a: "A", b: "B" },
      }),
    );
    expect(of(report, "NET_SHORT_CIRCUIT")).toHaveLength(0);
    expect(of(report, "PAD_TO_PAD_CLEARANCE")).toHaveLength(0);
  });
  test("the same overlap with exact rectangles is still a short", () => {
    const report = runDrc(
      projection({
        placements: [
          placement("U1", {
            positionMm: { x: 10, y: 10 },
            pads: [
              pad("1", { x: -0.5, y: 0 }, 1.2, 1),
              pad("2", { x: 0.5, y: 0 }, 1.2, 1),
            ],
          }),
        ],
        padNets: { "U1|1": "a", "U1|2": "b" },
        netNames: { a: "A", b: "B" },
      }),
    );
    expect(of(report, "NET_SHORT_CIRCUIT")).toHaveLength(1);
  });
});

describe("R1 #6 — a multi-shape unassigned pad bridges deterministically (§4, §7)", () => {
  const bridge = (order: "ab" | "ba"): DesignerPcbProjection => {
    const s1 = pad("9", { x: -2, y: 0 }, 1.2, 1.2);
    const s2 = pad("9", { x: 2, y: 0 }, 1.2, 1.2);
    return projection({
      placements: [
        placement("U1", {
          positionMm: { x: 10, y: 10 },
          pads: [
            pad("1", { x: -2.9, y: 0 }, 1, 1),
            pad("2", { x: 2.9, y: 0 }, 1, 1),
            ...(order === "ab" ? [s1, s2] : [s2, s1]),
          ],
        }),
      ],
      padNets: { "U1|1": "n1", "U1|2": "n2" },
      netNames: { n1: "A", n2: "B" },
    });
  };
  test("shape order changes nothing", () => {
    const report = runDrc(bridge("ab"));
    expect(of(report, "NET_SHORT_CIRCUIT")).toHaveLength(1);
    expect(bytes(bridge("ab"))).toBe(bytes(bridge("ba")));
  });
});

describe("R1 #7 — a polygon pad crossing the edge measures negative (§6)", () => {
  test("never serialises as 0", () => {
    const report = runDrc(
      projection({
        board: board({
          outline: {
            kind: "rect",
            widthMm: 50,
            heightMm: 30,
            centerMm: { x: 0, y: 0 },
          },
        }),
        freePads: [
          freePad("fp", {
            shape: "rect",
            widthMm: 1,
            heightMm: 1,
            center: { x: -24.9, y: 0 },
            netId: "n1",
          }),
        ],
        netNames: { n1: "A" },
      }),
    );
    const edge = of(report, "COPPER_TO_BOARD_EDGE");
    expect(edge).toHaveLength(1);
    expect(edge[0]!.measuredMm!).toBeLessThan(0);
    expect(JSON.stringify(edge[0]!.measuredMm)).not.toBe("0");
    expect(of(report, "COPPER_OFF_BOARD")).toHaveLength(1);
  });
});

describe("outline problems are one id per spot (§6)", () => {
  test("two touching-pair problems on one cutout are two violations", () => {
    const box = (id: string, x0: number, y0: number, x1: number, y1: number) => ({
      id,
      shape: {
        kind: "contour" as const,
        widthMm: x1 - x0,
        heightMm: y1 - y0,
        centerMm: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
        start: { x: x0, y: y0 },
        segments: [
          { type: "line" as const, to: { x: x1, y: y0 } },
          { type: "line" as const, to: { x: x1, y: y1 } },
          { type: "line" as const, to: { x: x0, y: y1 } },
          { type: "line" as const, to: { x: x0, y: y0 } },
        ],
      },
    });
    const report = runDrc(
      projection({
        board: board({
          cutouts: [
            box("A", -3, -1, 3, 1),
            box("B", -2, -2, -1, 2),
            box("C", 1, -2, 2, 2),
          ],
        }),
        traces: [trace("t", null, [[20, 20], [30, 20]])],
      }),
    );
    const bad = of(report, "BOARD_OUTLINE_INVALID");
    expect(bad).toHaveLength(2);
    expect(new Set(ids(report)).size).toBe(ids(report).length);
  });
});

describe("Astra S7 #2 — creepage never skips an intra-footprint pair", () => {
  test("two pads of one footprint, 100 V apart, closer than IPC-2221 allows", () => {
    const report = runDrc(
      projection({
        board: boardWithRules({
          clearance: { padToPadMm: 0.8 },
          netClasses: [
            { id: "hv", name: "HV", clearanceMm: 0.2, traceWidthMm: 0.2, viaDiameterMm: 0.6, viaDrillMm: 0.3, color: "#f00", defaultViaProtection: "tented", voltageV: 100 },
            { id: "lv", name: "LV", clearanceMm: 0.2, traceWidthMm: 0.2, viaDiameterMm: 0.6, viaDrillMm: 0.3, color: "#00f", defaultViaProtection: "tented", voltageV: 0 },
          ],
          perNetClassAssignments: { a: "hv", b: "lv" },
        }),
        placements: [
          placement("U1", {
            positionMm: { x: 10, y: 10 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1), pad("2", { x: 1.4, y: 0 }, 1, 1)],
          }),
        ],
        padNets: { "U1|1": "a", "U1|2": "b" },
        netNames: { a: "HV_NET", b: "LV_NET" },
      }),
    );
    // The ordinary clearance tier does not judge pads of one footprint, so the
    // "ordinary rule already dominates" shortcut must not apply either.
    expect(of(report, "CREEPAGE_DISTANCE")).toHaveLength(1);
    expect(of(report, "PAD_TO_PAD_CLEARANCE")).toHaveLength(0);
  });
});

describe("Astra S7 #3 — two distinct drills of one pin still overlap", () => {
  test("HOLE_TO_HOLE fires for overlapping same-pin drills, not for one coincident drill", () => {
    const twoDrills = (dx: number) =>
      runDrc(
        projection({
          placements: [
            placement("U1", {
              positionMm: { x: 10, y: 10 },
              pads: [
                pad("1", { x: -dx, y: 0 }, 1.2, 1.2, { drillDiameterMm: 0.6 }),
                pad("1", { x: dx, y: 0 }, 1.2, 1.2, { drillDiameterMm: 0.6 }),
              ],
            }),
          ],
          padNets: { "U1|1": "n1" },
          netNames: { n1: "A" },
        }),
      );
    expect(of(twoDrills(0.15), "HOLE_TO_HOLE")).toHaveLength(1);
    expect(of(twoDrills(0), "HOLE_TO_HOLE")).toHaveLength(0);
  });
});

describe("Astra S7 #4 — a collapsed id keeps the most severe draft", () => {
  test("an error under a stricter area rule survives a warning on the same pin", () => {
    const rule = (id: string, mm: number, severity: "error" | "warning", x0: number, x1: number) => ({
      id,
      name: id,
      enabled: true,
      priority: 1,
      severity,
      constraint: { kind: "edgeClearance" as const, minMm: mm },
      scopes: [
        {
          kind: "area" as const,
          polygonMm: [
            { x: x0, y: -20 },
            { x: x1, y: -20 },
            { x: x1, y: 20 },
            { x: x0, y: 20 },
          ],
        },
      ],
    });
    const report = runDrc(
      projection({
        board: boardWithRules({
          outline: { kind: "rect", widthMm: 100, heightMm: 100, centerMm: { x: 0, y: 0 } },
          clearance: { copperToBoardEdgeMm: 0.1 },
          drcRules: [rule("warn", 0.3, "warning", 49, 50), rule("err", 2, "error", 48, 49)],
        }),
        placements: [
          placement("U1", {
            positionMm: { x: 0, y: 0 },
            pads: [pad("1", { x: 49.3, y: 10 }, 1, 1), pad("1", { x: 48.5, y: -10 }, 1, 1)],
          }),
        ],
        padNets: { "U1|1": "n1" },
        netNames: { n1: "A" },
      }),
    );
    const edge = of(report, "COPPER_TO_BOARD_EDGE");
    expect(edge).toHaveLength(1);
    expect(edge[0]!.severity).toBe("error");
    expect(report.summary.errors).toBeGreaterThanOrEqual(1);
  });
});

describe("Astra S7 #6 — length groups and diff pairs are order-independent (§7)", () => {
  // Re-fixtured for S14: both nets are PINNED at two pads and each is routed
  // as a connected run, so the path model measures them (a trace-only net has
  // no routed length at all, contract 14 §2.7) and every member is split
  // across two trace records, which is what the reversal actually exercises.
  const tinyPin = (id: string, x: number, y: number) =>
    placement(id, {
      positionMm: { x, y },
      pads: [pad("1", { x: 0, y: 0 }, 0.2, 0.2)],
    });
  const withGroups = (reverse: boolean): DesignerPcbProjection => {
    const traces = [
      trace("t1", "n1", [[0, 0], [1, 0]]),
      trace("t2", "n1", [[1, 0], [3, 0]]),
      trace("p1", "dp_p", [[5, 5], [7, 5]]),
      trace("p2", "dp_p", [[7, 5], [10, 5]]),
      trace("n1x", "dp_n", [[5, 5.3], [9, 5.3]]),
    ];
    return projection({
      board: board({
        lengthMatchGroups: [
          { id: "g", name: "G", netIds: ["n1"], target: { kind: "absolute", mm: 2 }, toleranceMm: 0.1 },
        ],
        diffPairs: [
          { id: "dp", name: "DP", pNetId: "dp_p", nNetId: "dp_n", gapMm: 0.1, maxSkewMm: 0.1 },
        ],
      }),
      placements: [
        tinyPin("A1", 0, 0),
        tinyPin("A2", 3, 0),
        tinyPin("DP1", 5, 5),
        tinyPin("DP2", 10, 5),
        tinyPin("DN1", 5, 5.3),
        tinyPin("DN2", 9, 5.3),
      ],
      padNets: {
        "A1|1": "n1",
        "A2|1": "n1",
        "DP1|1": "dp_p",
        "DP2|1": "dp_p",
        "DN1|1": "dp_n",
        "DN2|1": "dp_n",
      },
      traces: reverse ? [...traces].reverse() : traces,
      netNames: { n1: "A", dp_p: "DP_P", dp_n: "DP_N" },
    });
  };
  test("reversing traces changes neither ids nor markers", () => {
    expect(bytes(withGroups(false))).toBe(bytes(withGroups(true)));
    expect(of(runDrc(withGroups(false)), "DIFF_PAIR_SKEW")).toHaveLength(1);
    expect(of(runDrc(withGroups(false)), "NET_LENGTH_OUT_OF_RANGE")).toHaveLength(1);
  });
});

describe("Astra S7 #8 — a major arc does not flip the milling winding", () => {
  test("a 270° clockwise cutout arc: the material tip at the origin is not an internal corner", () => {
    const report = runDrc(
      projection({
        board: board({
          fabricator: "jlcpcb_2l",
          outline: { kind: "rect", widthMm: 60, heightMm: 60, centerMm: { x: 0, y: 0 } },
          cutouts: [
            {
              id: "arc",
              shape: {
                kind: "contour",
                widthMm: 4,
                heightMm: 4,
                centerMm: { x: 0, y: 0 },
                start: { x: 2, y: 0 },
                segments: [
                  { type: "arc", to: { x: 0, y: 2 }, centerMm: { x: 0, y: 0 }, cw: true },
                  { type: "line", to: { x: 0, y: 0 } },
                  { type: "line", to: { x: 2, y: 0 } },
                ],
              },
            },
          ],
        }),
        traces: [trace("t", null, [[20, 20], [25, 20]])],
      }),
    );
    const hits = of(report, "OUTLINE_INTERNAL_RADIUS");
    expect(hits.every((h) => Math.hypot(h.locationMm!.x, h.locationMm!.y) > 1e-6)).toBe(true);
  });
});
