/**
 * S6 §5 — SCALAR scoped rules (trackWidth / viaDiameter / viaDrill /
 * annularRing / holeToHole / edgeClearance). These were persisted-but-inert
 * before S6: every board that stored one gains the violations it should always
 * have had (contract §12.1), so each kind is pinned here.
 *
 * Shape per kind: a tightening rule enforces and names itself; a rule at or
 * below the board minimum is reported `DRC_RULE_INEFFECTIVE` and changes
 * nothing; and the scope predicates (net / netClass / layer / area) select.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import type {
  DesignerPcbProjection,
  DrcReport,
  DrcRuleCode,
  PcbDrcRule,
  PcbPointMm,
} from "../../../sdks/designer";
import {
  boardWithRules,
  codes,
  freeHole,
  freePad,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

const rule = (over: Partial<PcbDrcRule>): PcbDrcRule => ({
  id: over.id ?? "r",
  name: over.name ?? "Scalar rule",
  enabled: over.enabled ?? true,
  priority: over.priority ?? 1,
  scopes: over.scopes ?? [],
  constraint: over.constraint ?? { kind: "trackWidth", minMm: 0.3 },
  ...(over.severity ? { severity: over.severity } : {}),
});

function run(
  rules: PcbDrcRule[],
  parts: Partial<DesignerPcbProjection>,
): DrcReport {
  return runDrc(
    projection({
      ...parts,
      board: boardWithRules({ fabricator: "custom", drcRules: rules }),
    }),
  );
}

function only(report: DrcReport, code: DrcRuleCode) {
  return report.violations.filter((v) => v.code === code);
}

const box = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): PcbPointMm[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

// A trace 0.25 mm wide — above the board's 0.2 minimum, below a 0.3 rule.
const THIN = { widthMm: 0.25 };

describe("scalar rules — trackWidth", () => {
  test("a tightening rule enforces, names itself and sets requiredMm", () => {
    const report = run([rule({ name: "Wide traces" })], {
      netNames: { n1: "SIG" },
      traces: [trace("t", "n1", [[0, 0], [10, 0]], THIN)],
    });
    const hits = only(report, "TRACE_WIDTH_MIN");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.requiredMm).toBeCloseTo(0.3, 9);
    expect(hits[0]!.measuredMm).toBeCloseTo(0.25, 9);
    expect(hits[0]!.message).toContain('(rule "Wide traces")');
  });

  test("the rule's severity applies to the violation it caused", () => {
    const report = run([rule({ severity: "warning" })], {
      netNames: { n1: "SIG" },
      traces: [trace("t", "n1", [[0, 0], [10, 0]], THIN)],
    });
    expect(only(report, "TRACE_WIDTH_MIN")[0]!.severity).toBe("warning");
  });

  test("a value at or below the board minimum is INEFFECTIVE, not enforced", () => {
    const report = run(
      [rule({ name: "Too loose", constraint: { kind: "trackWidth", minMm: 0.15 } })],
      { netNames: { n1: "SIG" }, traces: [trace("t", "n1", [[0, 0], [10, 0]], THIN)] },
    );
    expect(only(report, "TRACE_WIDTH_MIN")).toHaveLength(0);
    const problem = only(report, "DRC_RULE_INEFFECTIVE")[0];
    expect(problem).toBeDefined();
    expect(problem!.message).toContain("Too loose");
    expect(problem!.message).toContain("below the board minimum");
  });

  test("a clamped rule is attributed, and the message says it was clamped", () => {
    // The rule matched first (so it shadowed anything below it) but its 0.15
    // did not survive the board's 0.2 minimum. Naming it without saying so
    // would read as "this rule asked for 0.200 mm", which it never did.
    const report = run(
      [rule({ name: "Too loose", constraint: { kind: "trackWidth", minMm: 0.15 } })],
      {
        netNames: { n1: "SIG" },
        traces: [trace("t", "n1", [[0, 0], [10, 0]], { widthMm: 0.1 })],
      },
    );
    const hits = only(report, "TRACE_WIDTH_MIN");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.requiredMm).toBeCloseTo(0.2, 9);
    expect(hits[0]!.message).toContain(
      'rule "Too loose", clamped to the board minimum 0.200 mm',
    );
  });

  test("net scope selects the item's own net (not 'either', that is pairs)", () => {
    const report = run([rule({ scopes: [{ kind: "net", netIds: ["n1"] }] })], {
      netNames: { n1: "SIG", n2: "OTHER" },
      traces: [
        trace("t1", "n1", [[0, 0], [10, 0]], THIN),
        trace("t2", "n2", [[0, 2], [10, 2]], THIN),
      ],
    });
    const hits = only(report, "TRACE_WIDTH_MIN");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.anchors).toEqual([{ kind: "trace", traceId: "t1" }]);
  });

  test("netClass scope resolves the class from the NET, live", () => {
    const report = run(
      [rule({ scopes: [{ kind: "netClass", netClassIds: ["gnd"] }] })],
      {
        netNames: { g: "GND", s: "SIG" },
        traces: [
          // The stored netClassId is a creation-time hint and must be ignored.
          trace("tg", "g", [[0, 0], [10, 0]], { ...THIN, netClassId: "default" }),
          trace("ts", "s", [[0, 2], [10, 2]], { ...THIN, netClassId: "gnd" }),
        ],
      },
    );
    const hits = only(report, "TRACE_WIDTH_MIN");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.anchors).toEqual([{ kind: "trace", traceId: "tg" }]);
  });

  test("layer scope selects the layers the item occupies", () => {
    const report = run(
      [rule({ scopes: [{ kind: "layer", layers: ["B.Cu"] }] })],
      {
        netNames: { n1: "SIG" },
        traces: [
          trace("tf", "n1", [[0, 0], [10, 0]], THIN),
          trace("tb", "n1", [[0, 2], [10, 2]], { ...THIN, layer: "B.Cu" }),
        ],
      },
    );
    const hits = only(report, "TRACE_WIDTH_MIN");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.layer).toBe("B.Cu");
  });

  test("area scope: a trace ENTERING the area is caught, one outside is not", () => {
    const report = run(
      [rule({ scopes: [{ kind: "area", polygonMm: box(5, -1, 20, 1) }] })],
      {
        netNames: { n1: "SIG" },
        traces: [
          // Runs from outside the area into it — a superset match (§4.2).
          trace("tin", "n1", [[0, 0], [10, 0]], THIN),
          trace("tout", "n1", [[-20, -5], [-15, -5]], THIN),
        ],
      },
    );
    const hits = only(report, "TRACE_WIDTH_MIN");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.anchors).toEqual([{ kind: "trace", traceId: "tin" }]);
  });
});

describe("scalar rules — via kinds", () => {
  const aVia = { netId: "n1" as string | null, center: { x: 0, y: 0 } };

  test("viaDiameter tightens", () => {
    const report = run(
      [rule({ name: "Fat vias", constraint: { kind: "viaDiameter", minMm: 1 } })],
      { netNames: { n1: "SIG" }, vias: [via("v", aVia)] },
    );
    const hits = only(report, "VIA_DIAMETER_MIN");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.requiredMm).toBeCloseTo(1, 9);
    expect(hits[0]!.message).toContain('(rule "Fat vias")');
  });

  test("viaDrill tightens", () => {
    const report = run(
      [rule({ constraint: { kind: "viaDrill", minMm: 0.5 } })],
      { netNames: { n1: "SIG" }, vias: [via("v", aVia)] },
    );
    expect(only(report, "VIA_DRILL_MIN")[0]!.requiredMm).toBeCloseTo(0.5, 9);
  });

  test("annularRing tightens (vias only — THT pad rings stay board-only)", () => {
    const report = run(
      [rule({ constraint: { kind: "annularRing", minMm: 0.3 } })],
      { netNames: { n1: "SIG" }, vias: [via("v", aVia)] },
    );
    const hits = only(report, "ANNULAR_RING_MIN");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.requiredMm).toBeCloseTo(0.3, 9);
    expect(hits[0]!.measuredMm).toBeCloseTo(0.2, 9);
  });

  test("a layer scope matches the via's resolved SPAN", () => {
    const through = { netNames: { n1: "SIG" }, vias: [via("v", aVia)] };
    // A through via spans F.Cu..B.Cu, so a B.Cu-scoped rule reaches it.
    expect(
      only(
        run(
          [
            rule({
              scopes: [{ kind: "layer", layers: ["B.Cu"] }],
              constraint: { kind: "viaDiameter", minMm: 1 },
            }),
          ],
          through,
        ),
        "VIA_DIAMETER_MIN",
      ),
    ).toHaveLength(1);
    // A layer this 2-layer stackup does not have reaches nothing, and says so.
    const missing = run(
      [
        rule({
          scopes: [{ kind: "layer", layers: ["In1.Cu"] }],
          constraint: { kind: "viaDiameter", minMm: 1 },
        }),
      ],
      through,
    );
    expect(only(missing, "VIA_DIAMETER_MIN")).toHaveLength(0);
    expect(only(missing, "DRC_RULE_INEFFECTIVE")[0]!.message).toContain(
      "In1.Cu",
    );
  });
});

describe("scalar rules — holeToHole (the one PAIR-scoped scalar)", () => {
  // Two NPTH drills 0.5 mm apart edge to edge: clean at the 0.25 board minimum.
  const holes = {
    freeHoles: [
      freeHole("h1", { x: 0, y: 0 }, 1),
      freeHole("h2", { x: 1.5, y: 0 }, 1),
    ],
  };

  test("a tightening rule enforces on the pair", () => {
    const report = run(
      [rule({ name: "Wide drills", constraint: { kind: "holeToHole", minMm: 0.8 } })],
      holes,
    );
    const hits = only(report, "HOLE_TO_HOLE");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.requiredMm).toBeCloseTo(0.8, 9);
    expect(hits[0]!.measuredMm).toBeCloseTo(0.5, 9);
    expect(hits[0]!.message).toContain('(rule "Wide drills")');
  });

  test("net scope matches when EITHER hole qualifies", () => {
    const plated = {
      netNames: { na: "A", nb: "B" },
      freePads: [
        freePad("p1", {
          padType: "std",
          center: { x: 0, y: 0 },
          widthMm: 1.6,
          heightMm: 1.6,
          drillMm: 1,
          netId: "na",
        }),
        freePad("p2", {
          padType: "std",
          center: { x: 1.5, y: 0 },
          widthMm: 1.6,
          heightMm: 1.6,
          drillMm: 1,
          netId: "nb",
        }),
      ],
    };
    const hits = only(
      run(
        [
          rule({
            scopes: [{ kind: "net", netIds: ["na"] }],
            constraint: { kind: "holeToHole", minMm: 0.8 },
          }),
        ],
        plated,
      ),
      "HOLE_TO_HOLE",
    );
    expect(hits).toHaveLength(1);
  });

  test("area scope needs BOTH holes inside — the drill, not the copper", () => {
    // An NPTH has no copper at all (Astra run 1 #5), so the scope geometry is
    // the drill disc; both discs sit inside this box.
    const bothIn = run(
      [
        rule({
          scopes: [{ kind: "area", polygonMm: box(-2, -2, 4, 2) }],
          constraint: { kind: "holeToHole", minMm: 0.8 },
        }),
      ],
      holes,
    );
    expect(only(bothIn, "HOLE_TO_HOLE")).toHaveLength(1);

    const oneIn = run(
      [
        rule({
          scopes: [{ kind: "area", polygonMm: box(-2, -2, 0.9, 2) }],
          constraint: { kind: "holeToHole", minMm: 0.8 },
        }),
      ],
      holes,
    );
    expect(only(oneIn, "HOLE_TO_HOLE")).toHaveLength(0);
  });
});

describe("scalar rules — edgeClearance", () => {
  // Trace 1.0 mm from the x = −25 board edge; gap = 1.0 − 0.1 = 0.9, clean at
  // the board's 0.5 mm copperToBoardEdge.
  const nearEdge = {
    netNames: { n1: "SIG" },
    traces: [trace("t", "n1", [[-24, 0], [0, 0]])],
  };

  test("a tightening rule raises the required board-edge clearance", () => {
    const report = run(
      [rule({ name: "Edge keepout", constraint: { kind: "edgeClearance", minMm: 1 } })],
      nearEdge,
    );
    const hits = only(report, "COPPER_TO_BOARD_EDGE");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.requiredMm).toBeCloseTo(1, 9);
    expect(hits[0]!.measuredMm).toBeCloseTo(0.9, 9);
    expect(hits[0]!.message).toContain('(rule "Edge keepout")');
  });

  test("it reaches vias and pads too", () => {
    const report = run(
      [rule({ constraint: { kind: "edgeClearance", minMm: 1 } })],
      {
        netNames: { n1: "SIG" },
        vias: [via("v", { netId: "n1", center: { x: -24, y: 0 } })],
        freePads: [
          freePad("p", { center: { x: 0, y: -14 }, widthMm: 1, heightMm: 1 }),
        ],
      },
    );
    const hits = only(report, "COPPER_TO_BOARD_EDGE");
    expect(hits.map((h) => h.anchors[0]!.kind).sort()).toEqual([
      "freePad",
      "via",
    ]);
  });

  test("board minimum still applies where no rule matches", () => {
    const report = run(
      [
        rule({
          scopes: [{ kind: "net", netIds: ["nobody"] }],
          constraint: { kind: "edgeClearance", minMm: 1 },
        }),
      ],
      nearEdge,
    );
    expect(only(report, "COPPER_TO_BOARD_EDGE")).toHaveLength(0);
  });
});

describe("scalar rules — validity", () => {
  test("a pairKind scope on a scalar rule is INVALID and not applied", () => {
    const report = run(
      [
        rule({
          name: "Bad scope",
          scopes: [{ kind: "pairKind", pairKinds: ["traceToTrace"] }],
        }),
      ],
      { netNames: { n1: "SIG" }, traces: [trace("t", "n1", [[0, 0], [10, 0]], THIN)] },
    );
    expect(only(report, "TRACE_WIDTH_MIN")).toHaveLength(0);
    const invalid = only(report, "DRC_RULE_INVALID")[0];
    expect(invalid).toBeDefined();
    expect(invalid!.severity).toBe("error");
    expect(invalid!.message).toContain("Bad scope");
    expect(invalid!.anchors).toEqual([{ kind: "rule", ruleId: "r" }]);
  });

  test("first match wins across scalar rules of one kind (not max-of-all)", () => {
    const report = run(
      [
        rule({ id: "low", priority: 1, constraint: { kind: "trackWidth", minMm: 0.9 } }),
        rule({ id: "high", priority: 9, constraint: { kind: "trackWidth", minMm: 0.3 } }),
      ],
      { netNames: { n1: "SIG" }, traces: [trace("t", "n1", [[0, 0], [10, 0]], THIN)] },
    );
    expect(only(report, "TRACE_WIDTH_MIN")[0]!.requiredMm).toBeCloseTo(0.3, 9);
  });

  test("a scalar rule of another kind never leaks into this one", () => {
    const report = run(
      [rule({ constraint: { kind: "viaDiameter", minMm: 5 } })],
      { netNames: { n1: "SIG" }, traces: [trace("t", "n1", [[0, 0], [10, 0]], THIN)] },
    );
    expect(codes(report)).not.toContain("TRACE_WIDTH_MIN");
  });
});
