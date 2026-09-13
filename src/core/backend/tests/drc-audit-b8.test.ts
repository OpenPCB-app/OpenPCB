/**
 * Audit regression suite B8 — findings registered by the S14 SI-correctness
 * session (docs/drc/OPEN_FINDINGS.md "S14"). Post-fix expectations under the
 * path model of docs/pcb-hardening/14-si-contract.md, live since WP3. Every
 * net here has TWO pad terminals: under the path model a
 * trace-only net has no routed length (reason `terminals`), so a fixture
 * without pads would go silent for the wrong reason instead of flipping.
 *
 * The probes that produced the "Was" numbers are the pre-fix engine run on the
 * same geometry without pads (scratchpad s14/probe.test.ts, 2026-09-13).
 */
import { describe, expect, test } from "bun:test";
import type {
  DesignerPcbProjection,
  DrcRuleCode,
  PcbBoardSettings,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../sdks/designer";
import { runDrc } from "../../../shared/drc/drc-engine";
import { resolveDiffPairs } from "../../../shared/drc/diff-pair-resolver";
import { board, pad, placement, projection, trace, via } from "./helpers/drc-fixtures";

const NET_LENGTH_UNDEFINED: DrcRuleCode = "NET_LENGTH_UNDEFINED";

const BIG = {
  kind: "rect",
  widthMm: 100,
  heightMm: 100,
  centerMm: { x: 0, y: 0 },
} as const;

/** One 0.6 × 0.6 mm SMD pin at (x, y) on F.Cu, bound to `netId`. */
function pin(
  id: string,
  x: number,
  y: number,
): { part: PcbPlacedPart; key: string } {
  return {
    part: placement(id, {
      positionMm: { x, y },
      pads: [pad("1", { x: 0, y: 0 }, 0.6, 0.6)],
    }),
    key: `${id}|1`,
  };
}

interface PairFixture {
  traces: PcbTrace[];
  vias?: PcbVia[];
  pins: Array<[string, number, number, string]>; // id, x, y, net
  dp?: Partial<PcbBoardSettings["diffPairs"] extends (infer T)[] | undefined ? T : never>;
}

function pairProjection(f: PairFixture): DesignerPcbProjection {
  const parts = f.pins.map(([id, x, y]) => pin(id, x, y));
  const padNets: Record<string, string> = {};
  f.pins.forEach(([, , , net], i) => {
    padNets[parts[i]!.key] = net;
  });
  return projection({
    board: {
      ...board(),
      outline: BIG,
      diffPairs: [
        {
          id: "dp",
          name: "X",
          pNetId: "p",
          nNetId: "n",
          gapMm: 0.15,
          gapTolMm: 0.05,
          maxUncoupledMm: 5,
          maxSkewMm: 0.5,
          ...(f.dp ?? {}),
        },
      ],
    },
    netNames: { p: "X_P", n: "X_N" },
    placements: parts.map((p) => p.part),
    traces: f.traces,
    vias: f.vias ?? [],
    padNets,
  });
}

const siCodes = (p: DesignerPcbProjection): string[] =>
  runDrc(p)
    .violations.filter((v) => v.code.startsWith("DIFF_PAIR"))
    .map((v) => v.code)
    .sort();

describe("B8 — routed length and diff-pair coupling are measures over the copper path", () => {
  // B8-1: two coincident N traces cover only half of P, yet the sum-of-polylines
  // length and the per-segment-pair coupling both double-count them.
  // Was: no violation. Now: the duplicate copper is a loop on N → N's length
  // is undefined and says so (no skew row); P's own path is fine and its
  // coupling is measured against N's COPPER, so the 10 mm P runs beside no N
  // copper are reported as uncoupled. Nothing passes silently.
  test("B8-1: duplicate copper never manufactures coupled length or routed length", () => {
    const report = runDrc(
      pairProjection({
        pins: [["P1", 0, 0, "p"], ["P2", 20, 0, "p"], ["N1", 0, 0.35, "n"], ["N2", 10, 0.35, "n"]],
        traces: [
          trace("tp", "p", [[0, 0], [20, 0]]),
          trace("tn1", "n", [[0, 0.35], [10, 0.35]]),
          trace("tn2", "n", [[0, 0.35], [10, 0.35]]),
        ],
      }),
    );
    const codes = report.violations.map((v) => v.code);
    expect(codes).toContain(NET_LENGTH_UNDEFINED);
    expect(codes).not.toContain("DIFF_PAIR_SKEW");
    expect(codes).toContain("DIFF_PAIR_UNCOUPLED_LENGTH");
    const row = report.violations.find((v) => v.code === NET_LENGTH_UNDEFINED)!;
    expect(row.message).toContain("loop");
    expect(row.anchors.some((a) => a.kind === "diffPair")).toBe(true);
    // P's copper path runs 0.3 → 19.7 (pad interiors clipped, 19.4 mm); N
    // copper reaches x ≤ 10 + sqrt(0.9² − 0.35²) under the default coupling
    // window G = 4·0.15 + 0.1 = 0.7 → coupled ≈ 10.53, uncoupled ≈ 8.87.
    const unc = report.violations.find((v) => v.code === "DIFF_PAIR_UNCOUPLED_LENGTH")!;
    expect(unc.measuredMm!).toBeGreaterThan(8.5);
    expect(unc.measuredMm!).toBeLessThan(9.2);
  });

  // B8-1b: a 10 mm partial copy lying on a 20 mm N touches N at ONE contact
  // component, so it is a pruned branch: the path is N alone (20 mm), the
  // pair is clean, and the overlapping copper is `TRACE_OVERLAP`'s (DFM).
  // Was: N summed to 30 mm → 10 mm skew + 10 mm uncoupled.
  test("B8-1b: a partial duplicate is a branch, never extra length", () => {
    const report = runDrc(
      pairProjection({
        pins: [["P1", 0, 0, "p"], ["P2", 20, 0, "p"], ["N1", 0, 0.35, "n"], ["N2", 20, 0.35, "n"]],
        traces: [
          trace("tp", "p", [[0, 0], [20, 0]]),
          trace("tn1", "n", [[0, 0.35], [20, 0.35]]),
          trace("tn2", "n", [[5, 0.35], [15, 0.35]]),
        ],
      }),
    );
    const codes = report.violations.map((v) => v.code);
    expect(codes).not.toContain(NET_LENGTH_UNDEFINED);
    expect(codes.filter((c) => c.startsWith("DIFF_PAIR"))).toEqual([]);
    expect(codes).toContain("TRACE_OVERLAP");
  });

  // B8-2: the gap was sampled at ONE closest point per segment pair. A
  // diverging N (edge gap 0.15 → 1.15 mm over 20 mm) was fully coupled and on
  // target. Was: no violation. Now: only the run within target + tol is
  // coupled; the rest is uncoupled (≥ 15 mm > 5 mm).
  test("B8-2: a diverging partner is uncoupled where its gap leaves the window", () => {
    const p = pairProjection({
      pins: [["P1", 0, 0, "p"], ["P2", 20, 0, "p"], ["N1", 0, 0.35, "n"], ["N2", 20, 1.35, "n"]],
      traces: [
        trace("tp", "p", [[0, 0], [20, 0]]),
        trace("tn", "n", [[0, 0.35], [20, 1.35]]),
      ],
    });
    const report = runDrc(p);
    const codes = report.violations.map((v) => v.code);
    expect(codes).toContain("DIFF_PAIR_UNCOUPLED_LENGTH");
    expect(codes).toContain("DIFF_PAIR_GAP");
    // g(x) = 0.15 + x/20. Coupled while g ≤ G = 0.7 → x ≤ 11; P's copper path
    // is 0.3 → 19.7 (19.4 mm) → coupled 10.7, uncoupled 8.7. Off-tolerance
    // (wide) while 0.2 < g ≤ 0.7 → x ∈ (1, 11] → 10 mm.
    const unc = report.violations.find((v) => v.code === "DIFF_PAIR_UNCOUPLED_LENGTH")!;
    expect(unc.measuredMm!).toBeGreaterThan(8.3);
    expect(unc.measuredMm!).toBeLessThan(9.1);
    // `DIFF_PAIR_GAP` reports the MAX over the two members, not their sum
    // (contract §4.2 as amended): N diverges from P exactly as P diverges from
    // N, so the same off-band stretch is in both members' sets — N's measured
    // over its own slightly longer arc (20.025 mm for the same 20 mm of x),
    // which is why the number is a hair over 10.
    const gap = report.violations.find((v) => v.code === "DIFF_PAIR_GAP")!;
    expect(gap.measuredMm!).toBeGreaterThan(9.5);
    expect(gap.measuredMm!).toBeLessThan(10.6);
  });

  // B8-2b: a 6 mm hole in the partner (two N traces with a gap between them)
  // is invisible to any per-segment-pair scheme. Now: the hole is uncoupled P.
  test("B8-2b: a hole in the partner is uncoupled length, measured exactly", () => {
    const p = pairProjection({
      pins: [["P1", 0, 0, "p"], ["P2", 20, 0, "p"], ["N1", 0, 0.35, "n"], ["N2", 20, 0.35, "n"]],
      traces: [
        trace("tp", "p", [[0, 0], [20, 0]]),
        trace("tn1", "n", [[0, 0.35], [7, 0.35]]),
        trace("tn2", "n", [[13, 0.35], [20, 0.35]]),
      ],
      dp: { maxUncoupledMm: 1 },
    });
    const report = runDrc(p);
    // N itself is open (two fragments, one pin each side) → its length is
    // undefined for the pair; P's uncoupled measure is still reported.
    const row = report.violations.find(
      (v) => v.code === "DIFF_PAIR_UNCOUPLED_LENGTH",
    );
    expect(row).toBeDefined();
    // The hole is 6 mm wide; under G = 0.7 the N end caps reach
    // sqrt((0.7 + 0.2)² − 0.35²) ≈ 0.83 mm into it from each side → ≈ 4.34 mm
    // of P beside no N copper.
    expect(row!.measuredMm!).toBeGreaterThan(4.1);
    expect(row!.measuredMm!).toBeLessThan(4.6);
  });

  // B8-3: coupled length was N's projection onto P's axis, so swapping the
  // pair's P and N changed the number (0.60 vs 0.68 mm). Now: symmetric.
  test("B8-3: swapping pNetId / nNetId is byte-identical", () => {
    const geometry: PairFixture = {
      pins: [["P1", 0, 0, "p"], ["P2", 20, 0, "p"], ["N1", 0, 0.35, "n"], ["N2", 19.4, 5.2, "n"]],
      traces: [
        trace("tp", "p", [[0, 0], [20, 0]]),
        trace("tn", "n", [[0, 0.35], [19.4, 5.2]]),
      ],
      // A WIDE coupling window rather than a wide tolerance: a band that
      // reaches past its own window is a refused table (R2), and the identity
      // assertion would then compare two empty arrays.
      dp: {
        gapTolMm: 0.05,
        couplingMaxGapMm: 10,
        maxUncoupledMm: 0.1,
        maxSkewMm: 50,
      },
    };
    const a = pairProjection(geometry);
    const b = pairProjection(geometry);
    b.board.diffPairs = [{ ...b.board.diffPairs![0]!, pNetId: "n", nNetId: "p" }];
    const rows = (p: DesignerPcbProjection) =>
      runDrc(p).violations.filter((v) => v.code.startsWith("DIFF_PAIR"));
    const strip = (p: DesignerPcbProjection) =>
      JSON.stringify(
        rows(p).map((v) => [v.code, v.measuredMm, v.locationMm, v.id]),
      );
    // Non-vacuity: two empty arrays are equal for the wrong reason.
    expect(rows(a).length).toBeGreaterThan(0);
    expect(strip(a)).toBe(strip(b));
  });

  // B8-4: a dangling 10 mm stub on P inflated its routed length, so an equal
  // pair reported 10 mm skew. Now: the stub is a pruned branch (TRACK_DANGLING
  // owns it); skew is 0.
  test("B8-4: branches, stubs and fragments are not routed length", () => {
    const p = pairProjection({
      pins: [["P1", 0, 0, "p"], ["P2", 20, 0, "p"], ["N1", 0, 0.35, "n"], ["N2", 20, 0.35, "n"]],
      traces: [
        trace("tp", "p", [[0, 0], [20, 0]]),
        trace("tps", "p", [[10, 0], [10, -10]]),
        trace("tn", "n", [[0, 0.35], [20, 0.35]]),
      ],
    });
    const codes = runDrc(p).violations.map((v) => v.code);
    expect(codes).not.toContain("DIFF_PAIR_SKEW");
    expect(codes).not.toContain("DIFF_PAIR_UNCOUPLED_LENGTH");
    expect(codes).toContain("TRACK_DANGLING");
  });

  // B8-5: a layer change through a via contributed nothing. P routed half on
  // B.Cu through two through vias (Ø 0.8) gains 2 × 1.6 mm of barrel and loses
  // the copper inside the four barrel discs (4 × 0.4 mm — copper inside a
  // terminal or a via is not routed length, contract 14 §2.2), so the path is
  // 1.6 mm longer than N. Was: skew 0.
  test("B8-5: a through via contributes the board thickness to the path", () => {
    const p = pairProjection({
      pins: [["P1", 0, 0, "p"], ["P2", 20, 0, "p"], ["N1", 0, 0.35, "n"], ["N2", 20, 0.35, "n"]],
      traces: [
        trace("tp1", "p", [[0, 0], [8, 0]]),
        trace("tp2", "p", [[8, 0], [12, 0]], { layer: "B.Cu" }),
        trace("tp3", "p", [[12, 0], [20, 0]]),
        trace("tn", "n", [[0, 0.35], [20, 0.35]]),
      ],
      vias: [
        via("v1", { netId: "p", center: { x: 8, y: 0 } }),
        via("v2", { netId: "p", center: { x: 12, y: 0 } }),
      ],
      // 1.6 mm of skew has to EXCEED the threshold to be reported; the 3 mm
      // this fixture was written with is above the very number it asserts.
      dp: { maxSkewMm: 0.5, maxUncoupledMm: 50 },
    });
    const row = runDrc(p).violations.find((v) => v.code === "DIFF_PAIR_SKEW")!;
    expect(row).toBeDefined();
    expect(Math.abs(row.measuredMm! - 1.6)).toBeLessThan(1e-6);
  });

  // B8-6: the bare `P` / `N` suffix rule paired unrelated nets (VIP / VIN),
  // and the frontend carried a second, different suffix table.
  test("B8-6: VIP / VIN are not a differential pair", () => {
    expect(
      resolveDiffPairs(undefined, { a: "VIP", b: "VIN", c: "CLK_P", d: "CLK_N" }).map(
        (dp) => dp.name,
      ),
    ).toEqual(["CLK"]);
  });

  // B8-7 (frontend, Vitest): the route / tune HUD summed trace polylines in
  // six places with a `longest` semantic that excluded the session net. The
  // regression lives beside the hook (`use-net-path-lengths.test.ts`).
});
