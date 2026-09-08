/**
 * Epsilon boundary matrix — encodes the CURRENT comparison regimes of the DRC
 * engine (DRC_AUDIT_REPORT.md §3.1) as executable rows:
 *
 *   R1  below(v, limit) = v < limit − 1e-6   — manufacturability/board minimums
 *   R2  clearanceViolated(gap, required) = gap < required − 5e-7 — clearance
 *       tier (S6 §1: exact-spec passes, including when the double that derived
 *       the gap lands a few ulps short; a 1 nm deficit still fires)
 *   R3  gap <= SHORT_EPS_MM (1e-4, inclusive) — short tier
 *   R4  below()/exceeds() in fab validators + aspect ratio (unified in P1;
 *       kills the (0.7−0.4)/2 float false positive, audit B2-1)
 *
 * P1 (epsilon unification) landed: every comparison shares pcb/tolerance.ts.
 * Any change to this table is a conscious policy change, not a refactor.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import type {
  DesignerPcbProjection,
  DrcRuleCode,
} from "../../../sdks/designer";
import { clearanceViolated } from "../../../shared/pcb-geometry/tolerance";
import {
  boardWithRules,
  codes,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";

interface MatrixRow {
  name: string;
  regime: "R1" | "R2" | "R3" | "R4";
  build: () => DesignerPcbProjection;
  expectCodes: DrcRuleCode[];
}

/**
 * R2 rows defeat the default net-class clearance floor (0.25) with null nets
 * + an unknown netClassId, so `required` is exactly the board rule (0.127).
 * Null nets also mean the short tier cannot fire (differentKnownNet is false)
 * — these rows isolate the clearance comparison and nothing else.
 */
function bareClearancePair(
  centerlineSpacingMm: number,
  widthB = 0.2,
): DesignerPcbProjection {
  return projection({
    board: boardWithRules({
      fabricator: "custom",
      clearance: { traceToTraceMm: 0.127 },
    }),
    traces: [
      trace("a", null, [[0, 0], [10, 0]], { netClassId: "nc-none" }),
      trace(
        "b",
        null,
        [
          [0, centerlineSpacingMm],
          [10, centerlineSpacingMm],
        ],
        { netClassId: "nc-none", widthMm: widthB },
      ),
    ],
  });
}

/** R3 rows: known different nets, default rules (required 0.25). */
function shortLadderPair(centerlineSpacingMm: number): DesignerPcbProjection {
  return projection({
    board: boardWithRules({ fabricator: "custom" }),
    netNames: { n1: "A", n2: "B" },
    traces: [
      trace("a", "n1", [[0, 0], [10, 0]]),
      trace("b", "n2", [
        [0, centerlineSpacingMm],
        [10, centerlineSpacingMm],
      ]),
    ],
  });
}

/** R1 rows: single trace vs minimums.traceWidthMm = 0.2. */
function widthProbe(widthMm: number): DesignerPcbProjection {
  return projection({
    board: boardWithRules({
      fabricator: "custom",
      minimums: { traceWidthMm: 0.2 },
    }),
    traces: [trace("t", null, [[0, 0], [10, 0]], { widthMm })],
  });
}

const ROWS: MatrixRow[] = [
  // --- R2: bare `<` clearance tier (trace width 0.2 ⇒ edge gap = spacing − 0.2) ---
  {
    name: "R2 clearance: gap exactly = rule (0.127) → clean",
    regime: "R2",
    build: () => bareClearancePair(0.327),
    expectCodes: [],
  },
  {
    // Trace coords are integer-nm quantized, so a sub-eps gap deficit is only
    // expressible through widthMm (a raw float): deficit here is 2.5e-7 mm.
    // A deficit of EXACTLY eps (1 nm) is the boundary and ULP-dependent by
    // design — deliberately not asserted.
    name: "R2 clearance: sub-eps deficit (2.5e-7 via width) → clean (below() grace, P1)",
    regime: "R2",
    build: () => bareClearancePair(0.327, 0.2000005),
    expectCodes: [],
  },
  {
    // S6 §1 / Astra run 1 #10: `0.3 − (0.1 + 0.1) === 0.09999999999999998`,
    // which a bare `<` rejects against a 0.1 mm rule at exact physical
    // equality. The 0.5 nm grace of `clearanceViolated` is exactly this case.
    name: "R2 clearance: derived-float equality (0.3 − 0.1 − 0.1 vs 0.1) → clean",
    regime: "R2",
    build: () =>
      projection({
        board: boardWithRules({
          fabricator: "custom",
          clearance: { traceToTraceMm: 0.1 },
        }),
        traces: [
          trace("a", null, [[0, 0], [10, 0]], { netClassId: "nc-none" }),
          trace("b", null, [[0, 0.3], [10, 0.3]], { netClassId: "nc-none" }),
        ],
      }),
    expectCodes: [],
  },
  {
    // P-A2: the grace is 0.5 nm, so the smallest deficit the nanometre
    // coordinate grid can even express — 1 nm — still fires. This is the row
    // that stops `clearanceViolated`'s tolerance from being widened.
    name: "R2 clearance: deficit exactly 1 nm (the grid quantum) → fires",
    regime: "R2",
    build: () => bareClearancePair(0.326999),
    expectCodes: ["TRACE_TO_TRACE_CLEARANCE"],
  },
  {
    name: "R2 clearance: gap = rule − 2 µm → fires (outside any grace)",
    regime: "R2",
    build: () => bareClearancePair(0.326998),
    expectCodes: ["TRACE_TO_TRACE_CLEARANCE"],
  },
  // --- R1: below() minimums ---
  {
    name: "R1 width: exactly at minimum → clean",
    regime: "R1",
    build: () => widthProbe(0.2),
    expectCodes: [],
  },
  {
    name: "R1 width: deficit 5e-7 (< eps 1e-6) → clean (grace)",
    regime: "R1",
    build: () => widthProbe(0.1999995),
    expectCodes: [],
  },
  {
    name: "R1 width: deficit 2e-6 (> eps) → fires",
    regime: "R1",
    build: () => widthProbe(0.199998),
    expectCodes: ["TRACE_WIDTH_MIN"],
  },
  {
    name: "R1 annular: (0.3−0.1)/2 float = 0.09999999999999999 vs min 0.1 → clean",
    regime: "R1",
    build: () =>
      projection({
        board: boardWithRules({
          fabricator: "custom",
          minimums: {
            annularRingMm: 0.1,
            drillSizeMm: 0.1,
            viaDrillMm: 0.1,
            viaDiameterMm: 0.3,
          },
        }),
        vias: [via("v", { diameterMm: 0.3, drillMm: 0.1 })],
      }),
    expectCodes: [],
  },
  // --- R3: inclusive short tier (SHORT_EPS_MM = 1e-4) ---
  {
    name: "R3 short: edges exactly touching (gap 0) → NET_SHORT_CIRCUIT",
    regime: "R3",
    build: () => shortLadderPair(0.2),
    expectCodes: ["NET_SHORT_CIRCUIT"],
  },
  {
    name: "R3 short: gap exactly SHORT_EPS (100 nm) → NET_SHORT_CIRCUIT (inclusive)",
    regime: "R3",
    build: () => shortLadderPair(0.2001),
    expectCodes: ["NET_SHORT_CIRCUIT"],
  },
  {
    name: "R3 short: gap 150 nm (> SHORT_EPS) → clearance, not short",
    regime: "R3",
    build: () => shortLadderPair(0.20015),
    expectCodes: ["TRACE_TO_TRACE_CLEARANCE"],
  },
  {
    name: "R3 short: overlap (negative gap) → NET_SHORT_CIRCUIT",
    regime: "R3",
    build: () => shortLadderPair(0.1),
    expectCodes: ["NET_SHORT_CIRCUIT"],
  },
  // --- R4: fab validators, bare `<` on derived floats ---
  {
    name: "R4 fab annular (audit B2-1): (0.7−0.4)/2 float vs 0.15 → clean (below(), P1)",
    regime: "R4",
    build: () =>
      projection({
        board: boardWithRules({
          fabricator: "jlcpcb_2l",
          minimums: { annularRingMm: 0.1, viaDiameterMm: 0.6 },
        }),
        vias: [via("v", { diameterMm: 0.7, drillMm: 0.4 })],
      }),
    expectCodes: [],
  },
  {
    name: "R4 aspect: ratio exactly at limit (4.0/0.4 = 10) → clean (exceeds())",
    regime: "R4",
    build: () =>
      projection({
        board: boardWithRules({
          fabricator: "jlcpcb_2l",
          boardThicknessMm: 4.0,
        }),
        vias: [via("v", { diameterMm: 0.8, drillMm: 0.4 })],
      }),
    expectCodes: [],
  },
  {
    name: "R4 aspect: ratio 11 > limit 10 → VIA_ASPECT_RATIO",
    regime: "R4",
    build: () =>
      projection({
        board: boardWithRules({
          fabricator: "jlcpcb_2l",
          boardThicknessMm: 4.4,
        }),
        vias: [via("v", { diameterMm: 0.8, drillMm: 0.4 })],
      }),
    expectCodes: ["VIA_ASPECT_RATIO"],
  },
];

// Pad-less boundary fixtures dangle by construction; these advisory DFM codes
// (P5) are orthogonal to the epsilon comparison under test.
const ADVISORY = new Set(["TRACK_DANGLING", "VIA_DANGLING"]);

describe("DRC epsilon boundary matrix", () => {
  for (const row of ROWS) {
    test(row.name, () => {
      const report = runDrc(row.build());
      const got = codes(report)
        .filter((c) => !ADVISORY.has(c))
        .sort();
      expect(got).toEqual([...row.expectCodes].sort());
    });
  }
});

/**
 * The R2 boundary stated directly on the helper, so a change to the tolerance
 * fails here whatever the fixtures happen to round to (S6 §1, probes P-A0..A2).
 */
describe("R2 boundary — clearanceViolated", () => {
  test("P-A0: exact equality is clean", () => {
    expect(clearanceViolated(0.127, 0.127)).toBe(false);
  });

  test("P-A1: derived-float equality is clean (0.3 − 0.1 − 0.1 vs 0.1)", () => {
    expect(0.3 - (0.1 + 0.1)).toBe(0.09999999999999998); // pin the arithmetic
    expect(clearanceViolated(0.3 - (0.1 + 0.1), 0.1)).toBe(false);
  });

  test("P-A2: a 1 nm deficit — the smallest the grid expresses — fires", () => {
    expect(clearanceViolated(0.127 - 1e-6, 0.127)).toBe(true);
  });

  test("the grace is half a nanometre, not more", () => {
    expect(clearanceViolated(0.127 - 4e-7, 0.127)).toBe(false);
    expect(clearanceViolated(0.127 - 6e-7, 0.127)).toBe(true);
  });
});
