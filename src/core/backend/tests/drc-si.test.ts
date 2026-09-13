/**
 * Signal-integrity diff-pair checks (gap, skew, uncoupled length) + the
 * name-convention / explicit-table resolver, on the S14 path model
 * (docs/pcb-hardening/14-si-contract.md §4, §5).
 *
 * Every net here carries TWO PAD TERMINALS. Under the path model a trace-only
 * net has no routed length at all (reason `terminals`), so a fixture without
 * pads would report nothing — and would pass a `not.toContain` assertion for
 * the wrong reason (contract 14 §9, critique #5).
 *
 * The pads are 0.2 mm — the trace width — so that P and N stay COEXTENSIVE
 * without their pads touching. That matters: coupling is now a measure, so a
 * partner that overhangs its member's ends contributes a real off-band run
 * around the end cap, and an "on-target" fixture built from unequal runs would
 * report a gap violation for a reason that has nothing to do with its target.
 * A pad pair 0.15 mm apart is under the 0.25 mm board rule, so these reports
 * also carry `PAD_TO_PAD_CLEARANCE` rows; no assertion here depends on them.
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import {
  diffPairPartnerName,
  resolveDiffPairs,
  resolveDiffPairsFull,
} from "../../../modules/designer/backend/pcb/diff-pair-resolver";
import type {
  DesignerPcbProjection,
  PcbBoardSettings,
  PcbDiffPair,
  PcbTrace,
} from "../../../sdks/designer";
import { board, codes, pad, placement, projection, trace } from "./helpers/drc-fixtures";

const BIG = {
  kind: "rect",
  widthMm: 100,
  heightMm: 100,
  centerMm: { x: 0, y: 0 },
} as const;

function boardWith(over: Partial<PcbBoardSettings>): PcbBoardSettings {
  return { ...board(), outline: BIG, ...over };
}

/** One 0.2 × 0.2 mm SMD pin at (x, y) on F.Cu. */
function pin(id: string, x: number, y: number) {
  return placement(id, {
    positionMm: { x, y },
    pads: [pad("1", { x: 0, y: 0 }, 0.2, 0.2)],
  });
}

interface PairGeometry {
  /** Pins as [placementId, x, y, netId]. */
  pins: Array<[string, number, number, string]>;
  traces: PcbTrace[];
}

function pairProjection(
  dp: Partial<PcbDiffPair>,
  geometry: PairGeometry,
): DesignerPcbProjection {
  const padNets: Record<string, string> = {};
  for (const [id, , , netId] of geometry.pins) padNets[`${id}|1`] = netId;
  return projection({
    board: boardWith({
      diffPairs: [
        { id: "dp", name: "USB", pNetId: "p", nNetId: "n", ...dp },
      ],
    }),
    netNames: { p: "USB_P", n: "USB_N" },
    placements: geometry.pins.map(([id, x, y]) => pin(id, x, y)),
    traces: geometry.traces,
    padNets,
  });
}

/**
 * P from (0,0) to (lenP,0), N from (0,y) to (lenN,y), each pinned at both
 * ends. With equal lengths the two paths are [0.1, len − 0.1] (the pad
 * interiors are clipped, contract §2.2) and coextensive.
 */
function parallelPair(
  yMm: number,
  opts: { lenP?: number; lenN?: number } = {},
): PairGeometry {
  const lenP = opts.lenP ?? 20;
  const lenN = opts.lenN ?? 20;
  return {
    pins: [
      ["P1", 0, 0, "p"],
      ["P2", lenP, 0, "p"],
      ["N1", 0, yMm, "n"],
      ["N2", lenN, yMm, "n"],
    ],
    traces: [
      trace("tp", "p", [[0, 0], [lenP, 0]]),
      trace("tn", "n", [[0, yMm], [lenN, yMm]]),
    ],
  };
}

describe("diff-pair resolver", () => {
  test("name convention: _P/_N auto-detects a pair", () => {
    const pairs = resolveDiffPairs(undefined, {
      n1: "USB_DP_P",
      n2: "USB_DP_N",
      n3: "SIG",
    });
    expect(pairs).toHaveLength(1);
    expect(new Set([pairs[0]!.pNetId, pairs[0]!.nNetId])).toEqual(
      new Set(["n1", "n2"]),
    );
  });

  test("explicit table wins and claims its nets", () => {
    const pairs = resolveDiffPairs(
      [{ id: "e1", name: "LANE0", pNetId: "a", nNetId: "b" }],
      { a: "FOO_P", b: "FOO_N", c: "BAR_P", d: "BAR_N" },
    );
    // explicit LANE0 + auto BAR
    expect(pairs.map((p) => p.name).sort()).toEqual(["BAR", "LANE0"]);
  });

  test("the bare P / N suffix is gone: VIP / VIN are not a pair (§5)", () => {
    expect(
      resolveDiffPairs(undefined, { a: "VIP", b: "VIN" }).map((p) => p.name),
    ).toEqual([]);
  });

  test("an ambiguous base name is rejected, not resolved by order (§5)", () => {
    const resolution = resolveDiffPairsFull(undefined, {
      a: "CLK_P",
      b: "clk_p",
      c: "CLK_N",
    });
    expect(resolution.pairs).toEqual([]);
    expect(resolution.ambiguous).toEqual(["CLK"]);
  });

  test("two explicit rows over one net set: identical dedupe, different conflict", () => {
    const same = resolveDiffPairsFull(
      [
        { id: "a", name: "X", pNetId: "p", nNetId: "n", gapMm: 0.2 },
        { id: "b", name: "X", pNetId: "p", nNetId: "n", gapMm: 0.2 },
      ],
      {},
    );
    expect(same.pairs).toHaveLength(1);
    expect(same.conflicts).toEqual([]);

    const differing = resolveDiffPairsFull(
      [
        { id: "a", name: "X", pNetId: "p", nNetId: "n", gapMm: 0.2 },
        { id: "b", name: "X", pNetId: "n", nNetId: "p", gapMm: 0.3 },
      ],
      {},
    );
    // The FIRST row stays in force; only the later one is refused.
    expect(differing.pairs.map((p) => p.id)).toEqual(["a"]);
    expect(differing.conflicts.map((c) => [c.reason, ...c.ids])).toEqual([
      ["duplicate", "b", "a"],
    ]);
  });

  test("a row naming one net twice is refused, not dropped in silence (R2)", () => {
    const resolution = resolveDiffPairsFull(
      [{ id: "self", name: "X", pNetId: "p", nNetId: "p" }],
      {},
    );
    expect(resolution.pairs).toEqual([]);
    expect(resolution.conflicts.map((c) => [c.reason, ...c.ids])).toEqual([
      ["self-pair", "self"],
    ]);
  });

  test("two rows sharing one net resolve to neither pair (R2)", () => {
    const resolution = resolveDiffPairsFull(
      [
        { id: "ab", name: "AB", pNetId: "a", nNetId: "b" },
        { id: "ac", name: "AC", pNetId: "a", nNetId: "c" },
        { id: "de", name: "DE", pNetId: "d", nNetId: "e" },
      ],
      {},
    );
    // The untouched row survives; the two fighting over net `a` do not.
    expect(resolution.pairs.map((p) => p.id)).toEqual(["de"]);
    expect(resolution.conflicts).toHaveLength(1);
    expect(resolution.conflicts[0]!.reason).toBe("shared-net");
    expect(resolution.conflicts[0]!.netId).toBe("a");
    expect([...resolution.conflicts[0]!.ids]).toEqual(["ab", "ac"]);
  });

  test("a refused row still claims its nets — no silent fallback to inference", () => {
    // `a`/`b` are named `CLK_P`/`CLK_N`: without the claim, refusing the rows
    // would hand the pair back to the name heuristic with different (default)
    // parameters, which is the rule quietly changing under the designer.
    const resolution = resolveDiffPairsFull(
      [
        { id: "ab", name: "AB", pNetId: "a", nNetId: "b" },
        { id: "ac", name: "AC", pNetId: "a", nNetId: "c" },
      ],
      { a: "CLK_P", b: "CLK_N", c: "OTHER" },
    );
    expect(resolution.pairs).toEqual([]);
  });

  test("a refused SELF-pair row claims its net too (Astra run 2)", () => {
    // The self-pair branch returned before claiming, so `X_P`/`X_N` were then
    // inferred and judged — a row the designer wrote as one pair silently
    // becoming another pair with default parameters.
    const resolution = resolveDiffPairsFull(
      [{ id: "self", name: "X", pNetId: "p", nNetId: "p" }],
      { p: "X_P", n: "X_N" },
    );
    expect(resolution.pairs).toEqual([]);
    expect(resolution.conflicts.map((c) => c.reason)).toEqual(["self-pair"]);
  });

  test("a shared-net refusal ids the FAULT, not the table order (Astra run 2)", () => {
    const ids = (rows: PcbDiffPair[]): string[] =>
      runDrc(
        projection({
          board: boardWith({ diffPairs: rows }),
          netNames: { a: "A", b: "B", c: "C" },
        }),
      )
        .violations.filter((v) => v.code === "DRC_RULE_INVALID")
        .map((v) => v.id)
        .sort();
    const ab: PcbDiffPair = { id: "ab", name: "AB", pNetId: "a", nNetId: "b" };
    const ac: PcbDiffPair = { id: "ac", name: "AC", pNetId: "a", nNetId: "c" };
    expect(ids([ab, ac])).toHaveLength(1);
    expect(ids([ab, ac])).toEqual(ids([ac, ab]));
  });

  test("partner names are case-preserving (§5)", () => {
    expect(diffPairPartnerName("CLK_P")).toBe("CLK_N");
    expect(diffPairPartnerName("lvds0_p")).toBe("lvds0_n");
    expect(diffPairPartnerName("USB_D+")).toBe("USB_D-");
    expect(diffPairPartnerName("CLKP")).toBeNull();
  });
});

describe("DRC — diff-pair checks", () => {
  test("on-target gap → no DIFF_PAIR_GAP", () => {
    // Edge gap 0.35 centreline − 0.2 half-widths = 0.15, exactly the target.
    const report = runDrc(
      pairProjection({ gapMm: 0.15, gapTolMm: 0.05 }, parallelPair(0.35)),
    );
    expect(codes(report)).not.toContain("DIFF_PAIR_GAP");
  });

  test("off-target gap → DIFF_PAIR_GAP over the whole coupled run", () => {
    // Edge gap 0.5: still inside the default window G = 4·0.15 + 0.1 = 0.7, so
    // the run is COUPLED — and every millimetre of it is too wide.
    const report = runDrc(
      pairProjection({ gapMm: 0.15, gapTolMm: 0.05 }, parallelPair(0.7)),
    );
    const row = report.violations.find((v) => v.code === "DIFF_PAIR_GAP");
    expect(row).toBeDefined();
    // Both paths are [0.1, 19.9] and every millimetre of both is coupled and
    // too wide. The verdict is the MAX over the members, not their sum: the
    // 19.8 mm run is ONE stretch of the pair, seen from both sides.
    expect(row!.measuredMm!).toBeCloseTo(19.8, 3);
    expect(row!.message).toContain("too wide");
    // Both members' figures are in the message even though one is the measure.
    expect(row!.message).toContain("USB_P");
    expect(row!.message).toContain("USB_N");
  });

  test("an explicit couplingMaxGapMm decides what counts as coupled", () => {
    // The same 0.5 mm gap, with the window narrowed below it: nothing couples,
    // so there is no off-band run to report and the pair reads as uncoupled.
    const report = runDrc(
      pairProjection(
        { gapMm: 0.15, gapTolMm: 0.05, couplingMaxGapMm: 0.3, maxUncoupledMm: 5 },
        parallelPair(0.7),
      ),
    );
    expect(codes(report)).not.toContain("DIFF_PAIR_GAP");
    expect(codes(report)).toContain("DIFF_PAIR_UNCOUPLED_LENGTH");
  });

  test("length skew → DIFF_PAIR_SKEW", () => {
    // P 25 mm, N 20 mm; both lose 0.2 mm to their pad interiors → skew 5 mm.
    const report = runDrc(
      pairProjection(
        { gapMm: 0.15, maxSkewMm: 0.5, maxUncoupledMm: 50 },
        parallelPair(0.35, { lenP: 25, lenN: 20 }),
      ),
    );
    const row = report.violations.find((v) => v.code === "DIFF_PAIR_SKEW");
    expect(row).toBeDefined();
    expect(row!.measuredMm!).toBeCloseTo(5, 3);
  });

  test("long uncoupled breakout → DIFF_PAIR_UNCOUPLED_LENGTH", () => {
    // P and N each run 30 mm but 20 mm apart → never coupled, so the whole
    // path (30 − 0.2 mm of pad interiors) is uncoupled.
    const report = runDrc(
      pairProjection(
        { gapMm: 0.15, maxUncoupledMm: 5, maxSkewMm: 50 },
        {
          pins: [
            ["P1", -15, -10, "p"],
            ["P2", 15, -10, "p"],
            ["N1", -15, 10, "n"],
            ["N2", 15, 10, "n"],
          ],
          traces: [
            trace("tp", "p", [[-15, -10], [15, -10]]),
            trace("tn", "n", [[-15, 10], [15, 10]]),
          ],
        },
      ),
    );
    const row = report.violations.find(
      (v) => v.code === "DIFF_PAIR_UNCOUPLED_LENGTH",
    );
    expect(row).toBeDefined();
    expect(row!.measuredMm!).toBeCloseTo(29.8, 3);
    expect(row!.anchors.some((a) => a.kind === "net")).toBe(true);
  });

  test("a pair with no gap target is reported, never judged on an invented one", () => {
    const report = runDrc(
      pairProjection({ maxSkewMm: 50, maxUncoupledMm: 0.1 }, parallelPair(0.35)),
    );
    // No target ⇒ no coupling verdicts at all (contract §4.2, Decision 6) …
    expect(codes(report)).not.toContain("DIFF_PAIR_GAP");
    expect(codes(report)).not.toContain("DIFF_PAIR_UNCOUPLED_LENGTH");
    // … and the rule says so instead of going quietly inert.
    const row = report.violations.find((v) => v.code === "DRC_RULE_INEFFECTIVE");
    expect(row?.message).toContain("USB");
  });

  test("a band that starts outside the coupling window is a refused table", () => {
    // t − tol = 0.95 mm, coupling window 0.3 mm: no copper can be both
    // coupled and on target, and `tight` is deliberately not clipped by the
    // window, so every uncoupled millimetre would read as off-band. The rule
    // model refuses the table instead of reporting that (R1).
    const report = runDrc(
      pairProjection(
        { gapMm: 1, gapTolMm: 0.05, couplingMaxGapMm: 0.3 },
        parallelPair(0.35),
      ),
    );
    expect(codes(report).filter((c) => c.startsWith("DIFF_PAIR"))).toEqual([]);
    const row = report.violations.find((v) => v.code === "DRC_RULE_INVALID");
    expect(row?.message).toContain("coupling window");
    expect(row?.message).toContain("0.950");
  });

  test("a band that reaches past the coupling window is a refused table", () => {
    // t + tol = 0.20 mm, window 0.16 mm: copper sitting exactly ON target is
    // outside the window, so a perfectly routed pair would report its whole
    // length as uncoupled. The other half of the same refusal (R2).
    const report = runDrc(
      pairProjection(
        { gapMm: 0.15, gapTolMm: 0.05, couplingMaxGapMm: 0.16, maxUncoupledMm: 1 },
        parallelPair(0.35),
      ),
    );
    expect(codes(report).filter((c) => c.startsWith("DIFF_PAIR"))).toEqual([]);
    const row = report.violations.find((v) => v.code === "DRC_RULE_INVALID");
    expect(row?.message).toContain("coupling window 0.160 mm");
    expect(row?.message).toContain("0.200 mm");
  });

  test("an unmeasured member reads as such in the gap message, never 0.000 mm", () => {
    // N is two fragments with a pin on each — its path is `open`, so it is
    // never measured. Printing 0.000 mm for it would read as "N is clean".
    const report = runDrc(
      pairProjection(
        { gapMm: 0.15, gapTolMm: 0.05, maxUncoupledMm: 50, maxSkewMm: 50 },
        {
          pins: [
            ["P1", 0, 0, "p"],
            ["P2", 20, 0, "p"],
            ["N1", 0, 0.7, "n"],
            ["N2", 20, 0.7, "n"],
          ],
          traces: [
            trace("tp", "p", [[0, 0], [20, 0]]),
            trace("tn1", "n", [[0, 0.7], [7, 0.7]]),
            trace("tn2", "n", [[13, 0.7], [20, 0.7]]),
          ],
        },
      ),
    );
    const row = report.violations.find((v) => v.code === "DIFF_PAIR_GAP");
    expect(row).toBeDefined();
    expect(row!.message).toContain("USB_N not measured");
    expect(row!.message).not.toContain("USB_N 0.000 mm");
  });

  test("a pruned narrow stub never lends its width to a wide run (Astra run 2)", () => {
    // P's measured path is the 0.6 mm run `b`; `a` and `c` are 0.2 mm stubs
    // that TOUCH it, so their endpoints sit on `b`'s centreline. Recovering a
    // segment's width by matching endpoints therefore handed `b`'s retained
    // segments a 0.2 mm half width — a 0.2 mm-too-generous copper gap on both
    // sides, which silenced the verdict entirely.
    const report = runDrc(
      projection({
        board: boardWith({
          diffPairs: [
            {
              id: "dp",
              name: "USB",
              pNetId: "p",
              nNetId: "n",
              gapMm: 0.5,
              gapTolMm: 0.05,
              couplingMaxGapMm: 0.7,
              maxUncoupledMm: 5,
              maxSkewMm: 50,
            },
          ],
        }),
        netNames: { p: "USB_P", n: "USB_N" },
        placements: [
          pin("P1", 0, 0),
          pin("P2", 30, 0),
          pin("N1", 10, 0.7),
          pin("N2", 25, 0.7),
        ],
        padNets: { "P1|1": "p", "P2|1": "p", "N1|1": "n", "N2|1": "n" },
        traces: [
          trace("b", "p", [[0, 0], [30, 0]], { widthMm: 0.6 }),
          trace("a", "p", [[5, 5], [5, 0], [25, 0]], { widthMm: 0.2 }),
          trace("c", "p", [[20, -0.4], [20, -5]], { widthMm: 0.2 }),
          trace("tn", "n", [[10, 0.7], [18, 0.7]], { widthMm: 0.2 }),
        ],
      }),
    );
    // Centres 0.7 mm apart, half widths 0.3 + 0.1 → a 0.3 mm copper gap
    // against a 0.5 ± 0.05 mm target: every coupled millimetre is too tight.
    const gap = report.violations.find((v) => v.code === "DIFF_PAIR_GAP");
    expect(gap).toBeDefined();
    expect(gap!.measuredMm!).toBeCloseTo(8.964, 3);
    expect(gap!.message).toContain("too tight");
    expect(gap!.message).toContain("minimum copper gap 0.300 mm");
    // N is open (its second pin is at x = 25, past the trace), so N is never
    // measured and only P's 20.103 mm of copper beside no N copper counts —
    // 20.669 mm when the pruned stubs were lending `b` their width.
    const unc = report.violations.find(
      (v) => v.code === "DIFF_PAIR_UNCOUPLED_LENGTH",
    );
    expect(unc!.measuredMm!).toBeCloseTo(20.103, 3);
  });

  test("no diff pairs configured → no SI violations", () => {
    const report = runDrc(
      projection({
        netNames: { a: "SIG_A", b: "SIG_B" },
        traces: [
          trace("ta", "a", [[0, 0], [10, 0]]),
          trace("tb", "b", [[0, 5], [10, 5]]),
        ],
      }),
    );
    expect(codes(report).filter((c) => c.startsWith("DIFF_PAIR"))).toEqual([]);
  });

  test("determinism: run twice → byte-identical", () => {
    const p = pairProjection({ gapMm: 0.15 }, parallelPair(0.7));
    expect(JSON.stringify(runDrc(structuredClone(p)))).toBe(
      JSON.stringify(runDrc(structuredClone(p))),
    );
  });
});
