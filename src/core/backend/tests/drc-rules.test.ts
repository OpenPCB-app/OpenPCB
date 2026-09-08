/**
 * P6 — scoped priority clearance rules. Priority/first-match, relax-above-floor,
 * absolute floor, either-net scope, both-item area scope (BGA relaxation).
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import type {
  DesignerPcbProjection,
  PcbBoardSettings,
  PcbDrcRule,
} from "../../../sdks/designer";
import { computeViolationId } from "../../../modules/designer/backend/drc/violation-id";
import { createRuleResolver } from "../../../shared/drc/rule-resolver";
import {
  board,
  boardWithRules,
  codes,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

// Two different-net traces at a fixed 0.4 mm edge gap; the board clearance rule
// is 0.25, so by default they clear. Rules can tighten (flag) or relax.
function pair(boardSettings: PcbBoardSettings): DesignerPcbProjection {
  return projection({
    board: boardSettings,
    netNames: { hs1: "HS_A", hs2: "HS_B" },
    traces: [
      trace("a", "hs1", [[0, 0], [10, 0]]),
      trace("b", "hs2", [[0, 0.6], [10, 0.6]]),
    ],
  });
}

function withRules(rules: PcbDrcRule[]): PcbBoardSettings {
  return { ...board(), drcRules: rules };
}

const rule = (over: Partial<PcbDrcRule>): PcbDrcRule => ({
  id: over.id ?? "r",
  name: over.name ?? "rule",
  enabled: over.enabled ?? true,
  priority: over.priority ?? 1,
  scopes: over.scopes ?? [],
  constraint: over.constraint ?? { kind: "clearance", mm: 0.25 },
  ...(over.severity ? { severity: over.severity } : {}),
});

describe("DRC scoped rules — clearance", () => {
  test("no rules → default clearance (0.4 gap ≥ 0.25 rule, clean)", () => {
    expect(codes(runDrc(pair(board())))).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("a tightening rule flags the pair (0.4 < 0.5)", () => {
    const b = withRules([rule({ constraint: { kind: "clearance", mm: 0.5 } })]);
    expect(codes(runDrc(pair(b)))).toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("net-scoped rule matches when EITHER item is on the net", () => {
    const b = withRules([
      rule({ scopes: [{ kind: "net", netIds: ["hs1"] }], constraint: { kind: "clearance", mm: 0.5 } }),
    ]);
    expect(codes(runDrc(pair(b)))).toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("priority: higher-priority rule wins (relax overrides tighten)", () => {
    // A low-priority tighten (0.5) would flag; a high-priority relax (0.1)
    // wins first-match and the pair clears.
    const b = withRules([
      rule({ id: "tighten", priority: 1, constraint: { kind: "clearance", mm: 0.5 } }),
      rule({ id: "relax", priority: 10, constraint: { kind: "clearance", mm: 0.1 } }),
    ]);
    expect(codes(runDrc(pair(b)))).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("a rule can relax below the board default, but not below the floor", () => {
    // Board rule 0.25; relax to 0.1 → 0.4 gap clears. But a 0.5 floor overrides
    // the relax, so a 0.4 gap now flags.
    const floored = boardWithRules({ minimums: { clearanceMm: 0.5 } });
    const b: PcbBoardSettings = {
      ...floored,
      drcRules: [rule({ constraint: { kind: "clearance", mm: 0.1 } })],
    };
    expect(codes(runDrc(pair(b)))).toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("area rule relaxes only when BOTH items are inside (BGA fanout)", () => {
    const insideArea = {
      kind: "area" as const,
      polygonMm: [
        { x: -1, y: -1 },
        { x: 11, y: -1 },
        { x: 11, y: 2 },
        { x: -1, y: 2 },
      ],
    };
    // Board tightened to 0.5 globally (both traces flag); an area-scoped relax
    // to 0.1 covers both trace midpoints → clears them.
    const relaxInArea = withRules([
      rule({ id: "global", priority: 1, constraint: { kind: "clearance", mm: 0.5 } }),
      rule({
        id: "bga",
        priority: 10,
        scopes: [insideArea],
        constraint: { kind: "clearance", mm: 0.1 },
      }),
    ]);
    expect(codes(runDrc(pair(relaxInArea)))).not.toContain(
      "TRACE_TO_TRACE_CLEARANCE",
    );

    // Same rules, but the area is elsewhere → the global tighten still flags.
    const relaxElsewhere = withRules([
      rule({ id: "global", priority: 1, constraint: { kind: "clearance", mm: 0.5 } }),
      rule({
        id: "bga",
        priority: 10,
        scopes: [
          {
            kind: "area",
            polygonMm: [
              { x: 50, y: 50 },
              { x: 60, y: 50 },
              { x: 60, y: 60 },
              { x: 50, y: 60 },
            ],
          },
        ],
        constraint: { kind: "clearance", mm: 0.1 },
      }),
    ]);
    expect(codes(runDrc(pair(relaxElsewhere)))).toContain(
      "TRACE_TO_TRACE_CLEARANCE",
    );
  });

  test("disabled rule is inert", () => {
    const b = withRules([
      rule({ enabled: false, constraint: { kind: "clearance", mm: 0.5 } }),
    ]);
    expect(codes(runDrc(pair(b)))).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("determinism: reversed input arrays → identical id set with rules active", () => {
    const b = withRules([
      rule({ scopes: [{ kind: "net", netIds: ["hs1"] }], constraint: { kind: "clearance", mm: 0.5 } }),
    ]);
    const p = pair(b);
    const r1 = runDrc(p);
    const rev = { ...p, traces: [...p.traces].reverse() };
    const r2 = runDrc(rev);
    expect(r2.violations.map((v) => v.id).sort()).toEqual(
      r1.violations.map((v) => v.id).sort(),
    );
  });
});

/**
 * S6 §4.4 — the requirement is evaluated on regions of CONSTANT area
 * membership. Everything below would have been a false pass under the pre-S6
 * "resolve once at the representative points" model.
 */
describe("S6 §4.4 — area rules evaluate per region, not once per pair", () => {
  // Area covers x ∈ [2, 8]; both trace midpoints (x = 5) sit inside it, so the
  // OLD single resolution picked the relaxed 0.10 and the pair's closest
  // approach (0.10, inside) cleared it — while the 0.20 approach OUTSIDE the
  // area was never compared against the 0.25 board rule.
  const AREA_2_TO_8 = {
    kind: "area" as const,
    polygonMm: [
      { x: 2, y: -2 },
      { x: 8, y: -2 },
      { x: 8, y: 2 },
      { x: 2, y: 2 },
    ],
  };

  function twoHotspots(): DesignerPcbProjection {
    return projection({
      board: boardWithRules({
        fabricator: "custom",
        drcRules: [
          rule({
            id: "bga",
            name: "BGA fanout",
            priority: 10,
            scopes: [AREA_2_TO_8],
            constraint: { kind: "clearance", mm: 0.1 },
          }),
        ],
      }),
      netNames: { n1: "A", n2: "B" },
      traces: [
        trace("a", "n1", [[0, 0], [10, 0]]),
        // 0.4 mm away outside the area, 0.3 mm away (gap 0.10) inside it.
        trace("b", "n2", [
          [0, 0.4],
          [2.5, 0.4],
          [2.5, 0.3],
          [7.5, 0.3],
          [7.5, 0.4],
          [10, 0.4],
        ]),
      ],
    });
  }

  test("control: with the area over the WHOLE pair the board is clean", () => {
    // Proves the trap: the pair's closest approach IS 0.10 and IS legal under
    // the relaxed rule, so the pre-S6 single resolution at the (inside)
    // midpoints reported this board clean — the 0.20 approach outside the area
    // was never compared against the board's 0.25.
    const p = twoHotspots();
    const everywhere = {
      ...p,
      board: {
        ...p.board,
        drcRules: [
          rule({
            id: "bga",
            priority: 10,
            scopes: [
              {
                kind: "area",
                polygonMm: [
                  { x: -1, y: -2 },
                  { x: 11, y: -2 },
                  { x: 11, y: 2 },
                  { x: -1, y: 2 },
                ],
              },
            ],
            constraint: { kind: "clearance", mm: 0.1 },
          }),
        ],
      },
    };
    expect(codes(runDrc(everywhere))).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("the two-hotspot trap: the approach OUTSIDE the relaxing area fires", () => {
    const report = runDrc(twoHotspots());
    const v = report.violations.find(
      (x) => x.code === "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(v).toBeDefined();
    // The 0.10 approach inside the area is legal at the relaxed 0.10 rule; the
    // reported breach is the 0.20 approach outside it against the board's 0.25.
    expect(v!.measuredMm).toBeCloseTo(0.2, 9);
    expect(v!.requiredMm).toBeCloseTo(0.25, 9);
    // …and the marker sits outside the area, not at the closest approach.
    expect(v!.locationMm!.x).toBeLessThan(2);
  });

  test("the reported witness survives reversing the input arrays", () => {
    const p = twoHotspots();
    const forward = runDrc(p);
    const reversed = runDrc({ ...p, traces: [...p.traces].reverse() });
    expect(reversed.violations.map((v) => v.id).sort()).toEqual(
      forward.violations.map((v) => v.id).sort(),
    );
    const a = forward.violations.find(
      (v) => v.code === "TRACE_TO_TRACE_CLEARANCE",
    )!;
    const b = reversed.violations.find(
      (v) => v.code === "TRACE_TO_TRACE_CLEARANCE",
    )!;
    expect(b.locationMm).toEqual(a.locationMm);
    expect(b.measuredMm).toBe(a.measuredMm);
  });

  // Astra run 1 #1: ONE segment pair whose closest approach (0.125, left end)
  // is inside the relaxing area while the rest of it is not — there is no
  // second segment pair to iterate, so only the split at the area ring sees it.
  test("a single non-parallel segment pair, split at the area boundary", () => {
    const astraPair = (rightX: number) =>
      projection({
        board: boardWithRules({
          fabricator: "custom",
          drcRules: [
            rule({
              id: "relax",
              priority: 10,
              scopes: [
                {
                  kind: "area",
                  polygonMm: [
                    { x: -0.25, y: -0.25 },
                    { x: rightX, y: -0.25 },
                    { x: rightX, y: 0.75 },
                    { x: -0.25, y: 0.75 },
                  ],
                },
              ],
              constraint: { kind: "clearance", mm: 0.125 },
            }),
          ],
        }),
        netNames: { n1: "A", n2: "B" },
        traces: [
          trace("a", "n1", [[0, 0], [2, 0]], { widthMm: 0.25 }),
          trace("b", "n2", [[0, 0.375], [2, 0.4375]], { widthMm: 0.25 }),
        ],
      });

    // Area over the WHOLE pair: 0.125 everywhere, every gap ≥ 0.125 → clean.
    expect(codes(runDrc(astraPair(3)))).not.toContain(
      "TRACE_TO_TRACE_CLEARANCE",
    );

    // Area over the left part only: the relaxation stops at x = 0.5 and the
    // pair is judged against the board's 0.25 from there on.
    const v = runDrc(astraPair(0.5)).violations.find(
      (x) => x.code === "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(v).toBeDefined();
    expect(v!.requiredMm).toBeCloseTo(0.25, 9);
    // The witness is the LARGEST deficit among the violating sub-segment pairs
    // (§4.4) — the approach just outside the area, not the right end (0.1875).
    expect(v!.measuredMm).toBeGreaterThan(0.125);
    expect(v!.measuredMm).toBeLessThan(0.1875);
    // …and the marker sits at the area boundary the relaxation stops at.
    expect(v!.locationMm!.x).toBeCloseTo(0.5, 1);
  });

  test("an area rule that TIGHTENS applies only where both items are inside", () => {
    const tighten = (polygonMm: Array<{ x: number; y: number }>) =>
      boardWithRules({
        fabricator: "custom",
        drcRules: [
          rule({
            id: "t",
            priority: 10,
            scopes: [{ kind: "area", polygonMm }],
            constraint: { kind: "clearance", mm: 0.6 },
          }),
        ],
      });
    const both = [
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 2 },
      { x: -1, y: 2 },
    ];
    expect(codes(runDrc(pair(tighten(both))))).toContain(
      "TRACE_TO_TRACE_CLEARANCE",
    );
    // Only the lower trace is inside → the tightening never matches.
    const onlyOne = [
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 0.3 },
      { x: -1, y: 0.3 },
    ];
    expect(codes(runDrc(pair(tighten(onlyOne))))).not.toContain(
      "TRACE_TO_TRACE_CLEARANCE",
    );
  });

  test("two area scopes on one rule: BOTH items must share the SAME polygon", () => {
    const areaA = [
      { x: -1, y: -0.4 },
      { x: 11, y: -0.4 },
      { x: 11, y: 0.3 },
      { x: -1, y: 0.3 },
    ];
    const areaB = [
      { x: -1, y: 0.4 },
      { x: 11, y: 0.4 },
      { x: 11, y: 1 },
      { x: -1, y: 1 },
    ];
    const rules = (polys: Array<Array<{ x: number; y: number }>>) => [
      rule({ id: "global", priority: 1, constraint: { kind: "clearance", mm: 0.5 } }),
      rule({
        id: "two-areas",
        priority: 10,
        scopes: polys.map((polygonMm) => ({ kind: "area" as const, polygonMm })),
        constraint: { kind: "clearance", mm: 0.1 },
      }),
    ];
    // One trace in each polygon → NOT the same one → the global tighten stands.
    expect(
      codes(runDrc(pair(withRules(rules([areaA, areaB]))))),
    ).toContain("TRACE_TO_TRACE_CLEARANCE");
    // A third polygon containing both → matched through it, relaxed, clean.
    const bothPoly = [
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 2 },
      { x: -1, y: 2 },
    ];
    expect(
      codes(runDrc(pair(withRules(rules([areaA, bothPoly]))))),
    ).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });
});

/** S6 §4.3 — a pad/via pair resolves on EVERY shared layer and aggregates. */
describe("S6 §4.3 — multi-layer pairs", () => {
  function thtPair(rules: PcbDrcRule[]): DesignerPcbProjection {
    return projection({
      board: boardWithRules({ fabricator: "custom", drcRules: rules }),
      netNames: { n1: "A", n2: "B" },
      placements: [
        placement("U1", {
          positionMm: { x: 0, y: 0 },
          pads: [pad("1", { x: 0, y: 0 }, 1, 1, { drillDiameterMm: 0.5 })],
        }),
        placement("U2", {
          positionMm: { x: 0, y: 1.4 },
          pads: [pad("1", { x: 0, y: 0 }, 1, 1, { drillDiameterMm: 0.5 })],
        }),
      ],
      padNets: { "U1|1": "n1", "U2|1": "n2" },
    });
  }

  test("a B.Cu-only tightening rule reports the violation ON B.Cu", () => {
    const report = runDrc(
      thtPair([
        rule({
          id: "bcu",
          scopes: [{ kind: "layer", layers: ["B.Cu"] }],
          constraint: { kind: "clearance", mm: 0.6 },
        }),
      ]),
    );
    const hits = report.violations.filter(
      (v) => v.code === "PAD_TO_PAD_CLEARANCE",
    );
    // ONE aggregate violation for the pair, not one per layer.
    expect(hits).toHaveLength(1);
    expect(hits[0]!.layer).toBe("B.Cu");
    expect(hits[0]!.requiredMm).toBeCloseTo(0.6, 9);
  });

  test("a uniform rule keeps reporting the FIRST shared layer and its id", () => {
    const report = runDrc(
      thtPair([
        rule({ id: "all", constraint: { kind: "clearance", mm: 0.6 } }),
      ]),
    );
    const v = report.violations.find((x) => x.code === "PAD_TO_PAD_CLEARANCE")!;
    expect(v.layer).toBe("F.Cu");
    expect(v.requiredMm).toBeCloseTo(0.6, 9);
    // Unchanged by construction: with every shared layer violated together, the
    // aggregate reports exactly what the pre-S6 single-layer pass reported.
    expect(v.id).toBe(
      computeViolationId({
        code: "PAD_TO_PAD_CLEARANCE",
        anchors: [
          { kind: "pad", placementId: "U1", padNumber: "1" },
          { kind: "pad", placementId: "U2", padNumber: "1" },
        ],
        layer: "F.Cu",
        locationMm: { x: 0, y: 0.7 },
      }),
    );
  });

  test("layer = FIRST violated in stackup order, requiredMm = max over them", () => {
    // 4-layer board: F.Cu is violated at 0.5 and B.Cu at 0.9, the two inner
    // layers not at all. §4.3 wants the report ON F.Cu carrying B.Cu's number —
    // reporting B.Cu (the largest deficit) would move a violation to a layer
    // the user is not looking at, and reporting 0.5 would understate it.
    const report = runDrc(
      projection({
        board: boardWithRules({
          fabricator: "custom",
          layerCount: 4,
          drcRules: [
            rule({
              id: "f",
              name: "Front",
              scopes: [{ kind: "layer", layers: ["F.Cu"] }],
              constraint: { kind: "clearance", mm: 0.5 },
            }),
            rule({
              id: "b",
              name: "Back",
              scopes: [{ kind: "layer", layers: ["B.Cu"] }],
              constraint: { kind: "clearance", mm: 0.9 },
            }),
          ],
        }),
        netNames: { n1: "A", n2: "B" },
        placements: [
          placement("U1", {
            positionMm: { x: 0, y: 0 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1, { drillDiameterMm: 0.5 })],
          }),
          placement("U2", {
            positionMm: { x: 0, y: 1.4 },
            pads: [pad("1", { x: 0, y: 0 }, 1, 1, { drillDiameterMm: 0.5 })],
          }),
        ],
        padNets: { "U1|1": "n1", "U2|1": "n2" },
      }),
    );
    const hits = report.violations.filter(
      (v) => v.code === "PAD_TO_PAD_CLEARANCE",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.layer).toBe("F.Cu");
    expect(hits[0]!.requiredMm).toBeCloseTo(0.9, 9);
    expect(hits[0]!.measuredMm).toBeCloseTo(0.4, 9);
    // …and the message names the rule that SET 0.9, not the F.Cu one.
    expect(hits[0]!.message).toContain('rule "Back"');
  });

  // Astra run 1 #4: a warning-tier rule on the first shared layer must not hide
  // an error-tier rule on another.
  test("the aggregate takes the MOST severe violated layer's severity", () => {
    const viaPair = (rules: PcbDrcRule[]) =>
      projection({
        board: boardWithRules({ fabricator: "custom", drcRules: rules }),
        netNames: { n1: "A", n2: "B" },
        vias: [
          via("v1", { netId: "n1", center: { x: 0, y: 0 } }),
          via("v2", { netId: "n2", center: { x: 0, y: 0.925 } }),
        ],
      });
    const fCuWarning = rule({
      id: "f",
      priority: 5,
      severity: "warning",
      scopes: [{ kind: "layer", layers: ["F.Cu"] }],
      constraint: { kind: "clearance", mm: 0.5 },
    });
    const bCuError = rule({
      id: "b",
      priority: 5,
      severity: "error",
      scopes: [{ kind: "layer", layers: ["B.Cu"] }],
      constraint: { kind: "clearance", mm: 0.25 },
    });
    const mixed = runDrc(viaPair([fCuWarning, bCuError])).violations.filter(
      (v) => v.code === "VIA_TO_VIA_CLEARANCE",
    );
    expect(mixed).toHaveLength(1);
    expect(mixed[0]!.layer).toBe("F.Cu");
    expect(mixed[0]!.requiredMm).toBeCloseTo(0.5, 9);
    expect(mixed[0]!.severity).toBe("error");

    // Both rules warning → the aggregate is a warning, proving the severity
    // really comes from the rules and not from the code default (error).
    const bothWarning = runDrc(
      viaPair([fCuWarning, { ...bCuError, severity: "warning" }]),
    ).violations.filter((v) => v.code === "VIA_TO_VIA_CLEARANCE");
    expect(bothWarning).toHaveLength(1);
    expect(bothWarning[0]!.severity).toBe("warning");
  });
});

describe("S6 — scope semantics and the floor", () => {
  test("repeated net scopes UNION (a rule on {A} and {B} matches either)", () => {
    const b = withRules([
      rule({
        scopes: [
          { kind: "net", netIds: ["hs1"] },
          { kind: "net", netIds: ["nobody"] },
        ],
        constraint: { kind: "clearance", mm: 0.5 },
      }),
    ]);
    expect(codes(runDrc(pair(b)))).toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("a pairKind scope confines the rule to that kind", () => {
    const b = withRules([
      rule({
        scopes: [{ kind: "pairKind", pairKinds: ["traceToVia"] }],
        constraint: { kind: "clearance", mm: 0.5 },
      }),
    ]);
    expect(codes(runDrc(pair(b)))).not.toContain("TRACE_TO_TRACE_CLEARANCE");
  });

  test("null-net items match no net/class scope but still take the floor", () => {
    const b = boardWithRules({
      fabricator: "custom",
      minimums: { clearanceMm: 0.5 },
      drcRules: [
        rule({
          scopes: [{ kind: "net", netIds: ["n1"] }],
          constraint: { kind: "clearance", mm: 0.1 },
        }),
      ],
    });
    const report = runDrc(
      projection({
        board: b,
        traces: [
          trace("a", null, [[0, 0], [10, 0]], { netClassId: "nc-none" }),
          trace("b", null, [[0, 0.6], [10, 0.6]], { netClassId: "nc-none" }),
        ],
      }),
    );
    const v = report.violations.find(
      (x) => x.code === "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(v).toBeDefined();
    expect(v!.requiredMm).toBeCloseTo(0.5, 9);
    // No rule set the value → the code default decides the severity.
    expect(v!.severity).toBe("error");
  });

  test("a clamped relaxation still SHADOWS lower rules and keeps its severity", () => {
    // Astra run 1 #7: the rule matches first and resolves AS the floor, so it
    // is effective — reported as DRC_RULE_INEFFECTIVE(value_clamped), not
    // dropped — and the severity it carries is the one that applies.
    const b = boardWithRules({
      fabricator: "custom",
      minimums: { clearanceMm: 0.5 },
      drcRules: [
        rule({
          id: "clamped",
          name: "Below the floor",
          severity: "warning",
          constraint: { kind: "clearance", mm: 0.06 },
        }),
      ],
    });
    const report = runDrc(pair(b));
    const v = report.violations.find(
      (x) => x.code === "TRACE_TO_TRACE_CLEARANCE",
    )!;
    expect(v.requiredMm).toBeCloseTo(0.5, 9);
    expect(v.severity).toBe("warning");
    // The rule is attributed — it matched first and shadowed everything below
    // it — but the message must not imply it set 0.5 mm.
    expect(v.message).toContain(
      'rule "Below the floor", clamped to the floor 0.500 mm',
    );
    const problem = report.violations.find(
      (x) => x.code === "DRC_RULE_INEFFECTIVE",
    );
    expect(problem).toBeDefined();
    expect(problem!.message).toContain("Below the floor");
    expect(problem!.message).toContain("below the floor");
  });
});

/** §6 — the pour tier: only an explicitly pour-scoped rule may reach a fill. */
describe("S6 §6 — pour clearance", () => {
  const resolverFor = (rules: PcbDrcRule[]) =>
    createRuleResolver(
      boardWithRules({ fabricator: "custom", drcRules: rules }),
      { n1: "A", n2: "B" },
      { validCopperLayers: ["F.Cu", "B.Cu"] },
    );

  test("board tier per obstacle kind, with pourToCopperMm as the pour floor", () => {
    const r = resolverFor([]);
    // max(0.5, traceToPadMm 0.25) — the fill's own 0.5 mm floor dominates.
    expect(r.boardClearanceByPairKind.pourToPad).toBeCloseTo(0.5, 9);
    expect(r.boardClearanceByPairKind.pourToPour).toBeCloseTo(0.5, 9);
  });

  test("a rule with NO pairKind scope never reaches a pour", () => {
    const r = resolverFor([
      rule({ id: "global", constraint: { kind: "clearance", mm: 0.9 } }),
    ]);
    // It applies to copper–copper…
    expect(
      r.clearance(
        "traceToPad",
        "F.Cu",
        { netId: "n1", pointMm: { x: 0, y: 0 } },
        { netId: "n2", pointMm: { x: 1, y: 0 } },
      ).mm,
    ).toBeCloseTo(0.9, 9);
    // …and not to the fill (contract §6 rule 1, Astra run 1 #14).
    expect(
      r.clearancePour("pourToPad", "F.Cu", "n1", {
        netId: "n2",
        pointMm: { x: 1, y: 0 },
      }).mm,
    ).toBeCloseTo(0.5, 9);
  });

  test("a rule naming pourToPad does reach it", () => {
    const r = resolverFor([
      rule({
        id: "pour",
        scopes: [{ kind: "pairKind", pairKinds: ["pourToPad"] }],
        constraint: { kind: "clearance", mm: 0.9 },
      }),
    ]);
    expect(
      r.clearancePour("pourToPad", "F.Cu", "n1", {
        netId: "n2",
        pointMm: { x: 1, y: 0 },
      }).mm,
    ).toBeCloseTo(0.9, 9);
  });

  test("zone–zone resolves with masks 0 and is symmetric (§6 rule 3)", () => {
    // A centroid is not a point of the other zone's copper, so evaluating an
    // area-scoped pourToPour rule at one of the two centroids makes c(Z, Z')
    // disagree with c(Z', Z). Passing no evaluation point is the whole fix.
    const r = resolverFor([
      rule({
        id: "zz",
        scopes: [
          {
            kind: "area",
            polygonMm: [
              { x: -5, y: -5 },
              { x: 5, y: -5 },
              { x: 5, y: 5 },
              { x: -5, y: 5 },
            ],
          },
          { kind: "pairKind", pairKinds: ["pourToPour"] },
        ],
        constraint: { kind: "clearance", mm: 0.9 },
      }),
    ]);
    const fromA = r.clearancePour("pourToPour", "F.Cu", "n1", null);
    const fromB = r.clearancePour("pourToPour", "F.Cu", "n2", null);
    expect(fromA.mm).toBe(fromB.mm);
    // Masks 0 ⇒ the area-scoped rule cannot match, so the board tier stands.
    expect(fromA.mm).toBeCloseTo(0.5, 9);
    // The same, but keeping the other zone's net for net/class scopes.
    const withNets = (a: string, b: string) =>
      r.clearancePour("pourToPour", "F.Cu", a, { netId: b, pointMm: null }).mm;
    expect(withNets("n1", "n2")).toBe(withNets("n2", "n1"));
    expect(withNets("n1", "n2")).toBeCloseTo(0.5, 9);
    // An obstacle WITH a point inside the area would have applied it — that is
    // exactly the asymmetry zone–zone must not inherit.
    expect(
      r.clearancePour("pourToPour", "F.Cu", "n1", {
        netId: "n2",
        pointMm: { x: 0, y: 0 },
      }).mm,
    ).toBeCloseTo(0.9, 9);
  });

  test("an area scope never RELAXES a pour, but a tightening still applies", () => {
    const area = {
      kind: "area" as const,
      polygonMm: [
        { x: -5, y: -5 },
        { x: 5, y: -5 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ],
    };
    const relax = resolverFor([
      rule({
        id: "relax",
        scopes: [area, { kind: "pairKind", pairKinds: ["pourToPad"] }],
        constraint: { kind: "clearance", mm: 0.1 },
      }),
    ]);
    // The masks-0 term is the un-relaxed board value and always dominates.
    expect(
      relax.clearancePour("pourToPad", "F.Cu", "n1", {
        netId: "n2",
        pointMm: { x: 0, y: 0 },
      }).mm,
    ).toBeCloseTo(0.5, 9);
    const tighten = resolverFor([
      rule({
        id: "tighten",
        scopes: [area, { kind: "pairKind", pairKinds: ["pourToPad"] }],
        constraint: { kind: "clearance", mm: 0.9 },
      }),
    ]);
    expect(
      tighten.clearancePour("pourToPad", "F.Cu", "n1", {
        netId: "n2",
        pointMm: { x: 0, y: 0 },
      }).mm,
    ).toBeCloseTo(0.9, 9);
  });
});

describe("S6 — resolver memo and bound", () => {
  test("the memo keys on the MASKS, not just the nets", () => {
    const r = createRuleResolver(
      boardWithRules({
        fabricator: "custom",
        drcRules: [
          rule({
            id: "in-area",
            scopes: [
              {
                kind: "area",
                polygonMm: [
                  { x: -1, y: -1 },
                  { x: 1, y: -1 },
                  { x: 1, y: 1 },
                  { x: -1, y: 1 },
                ],
              },
            ],
            constraint: { kind: "clearance", mm: 0.9 },
          }),
        ],
      }),
      { n1: "A", n2: "B" },
      { validCopperLayers: ["F.Cu", "B.Cu"] },
    );
    const inside = r.clearance(
      "traceToTrace",
      "F.Cu",
      { netId: "n1", pointMm: { x: 0, y: 0 } },
      { netId: "n2", pointMm: { x: 0.5, y: 0 } },
    );
    const outside = r.clearance(
      "traceToTrace",
      "F.Cu",
      { netId: "n1", pointMm: { x: 50, y: 0 } },
      { netId: "n2", pointMm: { x: 50.5, y: 0 } },
    );
    expect(inside.mm).toBeCloseTo(0.9, 9);
    expect(outside.mm).toBeCloseTo(0.25, 9);
    // Same nets, same layer, same pair kind — only the mask differs.
    expect(inside.rule?.id).toBe("in-area");
    expect(outside.rule).toBeNull();
  });

  test("clearanceBound is an upper bound of anything clearance() can return", () => {
    const r = createRuleResolver(
      boardWithRules({
        fabricator: "custom",
        minimums: { clearanceMm: 0.15 },
        drcRules: [rule({ id: "t", constraint: { kind: "clearance", mm: 1.2 } })],
      }),
      { n1: "A", n2: "B" },
      { validCopperLayers: ["F.Cu", "B.Cu"] },
    );
    expect(r.clearanceBound("traceToTrace", "n1", "n2")).toBeCloseTo(1.2, 9);
    expect(
      r.clearance(
        "traceToTrace",
        "F.Cu",
        { netId: "n1", pointMm: { x: 0, y: 0 } },
        { netId: "n2", pointMm: { x: 1, y: 0 } },
      ).mm,
    ).toBeLessThanOrEqual(r.clearanceBound("traceToTrace", "n1", "n2"));
  });
});


/**
 * S6 §11 — the reported witness (and with it the violation id's 0.1 mm location
 * bucket) may not depend on the order the input arrays arrive in. The FAST path
 * needs the canonical orientation as much as the split path does: the closest-
 * points kernel tests four endpoint candidates in a fixed order with a strict
 * `<`, so a parallel PARTIAL OVERLAP has a genuine tie between its two overlap
 * ends and resolves it to whichever end came from the first argument.
 */
describe("S6 §11 — canonical orientation on the fast path", () => {
  const overlapPair = (offsetMm: number) =>
    projection({
      board: boardWithRules({
        fabricator: "custom",
        clearance: { traceToTraceMm: 1 },
      }),
      netNames: { n1: "A", n2: "B" },
      traces: [
        trace("a", "n1", [[0, 0], [10, 0]]),
        // Overlaps a only on x ∈ [2, 10] — the tie is between x = 2 and x = 10.
        trace("b", "n2", [[2, offsetMm], [20, offsetMm]]),
      ],
    });

  const reportedFor = (p: ReturnType<typeof overlapPair>, code: string) => {
    const forward = runDrc(p).violations.find((v) => v.code === code);
    const reversed = runDrc({ ...p, traces: [...p.traces].reverse() }).violations.find(
      (v) => v.code === code,
    );
    expect(forward).toBeDefined();
    expect(reversed).toBeDefined();
    return [forward!, reversed!] as const;
  };

  test("clearance: reversing the trace array keeps the id and the location", () => {
    const [forward, reversed] = reportedFor(
      overlapPair(0.6),
      "TRACE_TO_TRACE_CLEARANCE",
    );
    expect(reversed.locationMm).toEqual(forward.locationMm);
    expect(reversed.id).toBe(forward.id);
    expect(forward.measuredMm).toBeCloseTo(0.4, 9);
  });

  test("NET_SHORT_CIRCUIT places its marker the same way", () => {
    const [forward, reversed] = reportedFor(
      overlapPair(0.15),
      "NET_SHORT_CIRCUIT",
    );
    expect(reversed.locationMm).toEqual(forward.locationMm);
    expect(reversed.id).toBe(forward.id);
  });

  test("and the whole report is id-identical either way", () => {
    for (const offset of [0.6, 0.15]) {
      const p = overlapPair(offset);
      expect(
        runDrc({ ...p, traces: [...p.traces].reverse() })
          .violations.map((v) => v.id)
          .sort(),
      ).toEqual(runDrc(p).violations.map((v) => v.id).sort());
    }
  });
});
