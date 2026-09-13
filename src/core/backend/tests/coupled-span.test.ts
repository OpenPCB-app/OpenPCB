/**
 * SI contract 14 §4.2 / §9 — the diff-pair coupled-span kernel. Every expected
 * number below is written as the closed-form expression the contract states,
 * never copied out of a kernel run.
 *
 * `EPS` appears in those expressions because the kernel compares boundaries in
 * the ONE regime (06 §5 / 14 §4.2): `coupled` and the band interior are
 * `≤ limit + DRC_EPS_MM`, `tight` is `< limit − DRC_EPS_MM`.
 *
 * `wide` follows the §4.2 amendment: only a NEAR-PARALLEL partner strip counts,
 * so end caps and outside corners the source merely passes are coupled and
 * out-of-band without being wide.
 */
import { describe, expect, test } from "bun:test";
import {
  coupledSpans,
  type CoupledPath,
  type CoupledSpanParams,
} from "../../../shared/drc/si/coupled-span";
import {
  segmentSublevelInterval,
  type SublevelInterval,
} from "../../../shared/pcb-geometry/segment-sublevel";
import { DRC_EPS_MM } from "../../../shared/pcb-geometry/tolerance";
import type { PcbCopperLayerId, PcbPointMm } from "../../../sdks/designer";

const EPS = DRC_EPS_MM;
const HW = 0.1;
const HALF_SUM = HW + HW;
/** The pre-S14 `COUPLING_ANGLE_DEG`, passed in — the kernel has no default. */
const PARALLEL_MAX_DEG = 15;
/** t = 0.15, tol = 0.05, G = 0.7 — the §9 fixture window. */
const PARAMS: CoupledSpanParams = {
  targetGapMm: 0.15,
  gapTolMm: 0.05,
  couplingMaxGapMm: 0.7,
  parallelMaxDeg: PARALLEL_MAX_DEG,
};

function path(
  points: readonly [number, number][],
  halfWidthMm = HW,
  layer: PcbCopperLayerId = "F.Cu",
): CoupledPath {
  return { layer, pointsMm: points.map(([x, y]) => ({ x, y })), halfWidthMm };
}

/** Radius the kernel uses for `{g ≤ threshold}` on a pair of `HW` polylines. */
const radius = (thresholdMm: number) => thresholdMm + EPS + HALF_SUM;

describe("coupledSpans — the §9 geometry list", () => {
  test("parallel offset on target: fully coupled, nothing tight or wide", () => {
    const r = coupledSpans([path([[0, 0], [20, 0]])], [path([[0, 0.35], [20, 0.35]])], PARAMS);
    expect(r.p.copperLengthMm).toBeCloseTo(20, 12);
    expect(r.p.coupledMm).toBeCloseTo(20, 12);
    expect(r.p.uncoupledMm).toBeCloseTo(0, 12);
    expect(r.p.tightMm).toBe(0);
    expect(r.p.wideMm).toBe(0);
    expect(r.p.offBandMm).toBe(0);
    expect(r.p.bandExitMm).toBeNull();
    expect(r.p.minGapMm).toBeCloseTo(0.15, 12);
    expect(r.n.coupledMm).toBeCloseTo(20, 12);
    expect(r.n.uncoupledMm).toBeCloseTo(0, 12);
  });

  test("diverging partner: coupled where the gap still fits G, wide past t + tol", () => {
    const nLen = Math.sqrt(401); // |(20, 1)|
    // The perpendicular offset from (s, 0) to N's line is (7 + s)/|N|.
    const at = (r: number) => r * nLen - 7;
    const r = coupledSpans([path([[0, 0], [20, 0]])], [path([[0, 0.35], [20, 1.35]])], PARAMS);

    expect(r.p.coupled).toHaveLength(1);
    expect(r.p.coupled[0]!.s0).toBe(0);
    expect(r.p.coupled[0]!.s1).toBeCloseTo(at(radius(0.7)), 9);
    expect(r.p.coupledMm).toBeCloseTo(at(radius(0.7)), 9);
    expect(r.p.uncoupledMm).toBeCloseTo(20 - at(radius(0.7)), 9); // ≈ 8.98
    expect(r.p.tightMm).toBe(0);
    expect(r.p.wideMm).toBeCloseTo(at(radius(0.7)) - at(radius(0.2)), 9);
    expect(r.p.bandExitMm).toBeCloseTo(at(radius(0.2)), 9);
    expect(r.p.bandExitPointMm!.x).toBeCloseTo(at(radius(0.2)), 9);
    expect(r.p.bandExitPointMm!.y).toBe(0);
    expect(r.p.minGapMm).toBeCloseTo(0.15, 9); // at (0, 0) against N's start cap
  });

  test("converging partner: the same measures, mirrored along the source", () => {
    const nLen = Math.sqrt(401);
    const r = coupledSpans([path([[0, 0], [20, 0]])], [path([[0, 1.35], [20, 0.35]])], PARAMS);
    // |perp| from (s, 0) is (27 − s)/|N|, so coupling starts at 27 − R·|N|.
    expect(r.p.coupled).toHaveLength(1);
    expect(r.p.coupled[0]!.s0).toBeCloseTo(27 - radius(0.7) * nLen, 9);
    expect(r.p.coupled[0]!.s1).toBe(20);
    expect(r.p.coupledMm).toBeCloseTo(radius(0.7) * nLen - 7, 9);
  });

  test("a jog: coupled throughout, wide from the corner's reach onwards", () => {
    const r = coupledSpans(
      [path([[0, 0], [20, 0]])],
      [path([[0, 0.35], [9, 0.35], [9, 0.55], [20, 0.55]])],
      PARAMS,
    );
    // Past the jog the nearest copper is the inner corner (9, 0.35) until the
    // far run at y = 0.55 takes over, so the band ends at its disc.
    const wideStart = 9 + Math.sqrt(radius(0.2) ** 2 - 0.35 ** 2);
    expect(r.p.coupledMm).toBeCloseTo(20, 9);
    expect(r.p.tightMm).toBe(0);
    expect(r.p.wide).toHaveLength(1);
    expect(r.p.wide[0]!.s0).toBeCloseTo(wideStart, 9);
    expect(r.p.wide[0]!.s1).toBe(20);
    expect(r.p.wideMm).toBeCloseTo(20 - wideStart, 9);
    expect(r.p.bandExitMm).toBeCloseTo(wideStart, 9);
  });

  test("the C1 hole: a 2 mm gap in the partner, shrunk by the end-cap discs", () => {
    // t = 0.05 puts both straight runs exactly on target, so the only
    // off-band copper is what the hole's end caps leave behind.
    const params: CoupledSpanParams = {
      targetGapMm: 0.05,
      gapTolMm: 0.05,
      couplingMaxGapMm: 0.7,
      parallelMaxDeg: PARALLEL_MAX_DEG,
    };
    const rc = 0.7 + EPS + HALF_SUM;
    const reach = (r: number) => Math.sqrt(r * r - 0.25 * 0.25);
    const r = coupledSpans(
      [path([[0, 0], [20, 0]])],
      [path([[0, 0.25], [9, 0.25]]), path([[11, 0.25], [20, 0.25]])],
      params,
    );

    expect(r.p.coupled).toHaveLength(2);
    expect(r.p.coupled[0]!.s1).toBeCloseTo(9 + reach(rc), 9);
    expect(r.p.coupled[1]!.s0).toBeCloseTo(11 - reach(rc), 9);
    // The hole is 2 mm wide less the two end-cap discs.
    expect(r.p.uncoupledMm).toBeCloseTo(2 - 2 * reach(rc), 9);
    expect(r.p.coupledMm).toBeCloseTo(20 - (2 - 2 * reach(rc)), 9);
    expect(r.p.tightMm).toBe(0);
    // Approaching the hole the gap grows past t + tol, but only around N's end
    // caps — the strips themselves stay on target, so nothing is wide (§4.2
    // amendment; before it this fixture reported ≈ 0.64 mm of DIFF_PAIR_GAP).
    expect(r.p.wideMm).toBe(0);
    expect(r.p.offBandMm).toBe(0);
    expect(r.p.bandExitMm).toBeNull();
  });

  test("a perpendicular approach contributes at most 2·(G + halfSum)", () => {
    const r = coupledSpans([path([[0, 0], [20, 0]])], [path([[10, -5], [10, 5]])], PARAMS);
    expect(r.p.coupledMm).toBeCloseTo(2 * radius(0.7), 9);
    expect(r.p.coupledMm).toBeLessThanOrEqual(2 * (PARAMS.couplingMaxGapMm + HALF_SUM) + 1e-5);
  });

  test("a degenerate partner segment is a point target, not a skipped one", () => {
    const params: CoupledSpanParams = { ...PARAMS, couplingMaxGapMm: 0.2 };
    const r = coupledSpans([path([[-10, 0], [10, 0]])], [path([[0, 0.35], [0, 0.35]])], params);
    // R = 0.2 + eps + 0.2 ≈ 0.4 → 2·sqrt(0.4² − 0.35²) = 0.387298…
    expect(r.p.coupledMm).toBeCloseTo(2 * Math.sqrt(radius(0.2) ** 2 - 0.35 ** 2), 12);
    expect(r.p.coupledMm).toBeCloseTo(0.3872983346207417, 5);
  });

  test("overlapping partner copper is not double-counted", () => {
    const n = path([[0, 0.35], [20, 0.35]]);
    const once = coupledSpans([path([[0, 0], [20, 0]])], [n], PARAMS);
    const twice = coupledSpans([path([[0, 0], [20, 0]])], [n, path([[5, 0.35], [15, 0.35]])], PARAMS);
    expect(twice.p.coupledMm).toBe(once.p.coupledMm);
    expect(twice.p.coupled).toEqual(once.p.coupled);
    expect(twice.p.uncoupledMm).toBe(once.p.uncoupledMm);
  });

  test("a 45 degree departure is coupled and out of band, but not wide", () => {
    // N leaves at 45°: the corner disc and the diagonal's own strip keep P
    // coupled for ~1 mm past the corner at gaps well past t + tol, and none of
    // it is a gap defect — the pair is separating, not mis-routed.
    const r = coupledSpans(
      [path([[0, 0], [20, 0]])],
      [path([[0, 0.35], [10, 0.35], [16, 6.35]])],
      PARAMS,
    );
    expect(r.p.wideMm).toBe(0);
    expect(r.p.offBandMm).toBe(0);
    expect(r.p.bandExitMm).toBeNull();
    expect(r.p.coupledMm).toBeGreaterThan(10.5);
    expect(r.p.coupledMm).toBeLessThan(11.5);
  });

  test("a 10 mm parallel run at a 0.25 mm gap is wide over its whole length", () => {
    // Astra #9's case: the pair really is routed at the wrong gap.
    const r = coupledSpans([path([[0, 0], [10, 0]])], [path([[0, 0.45], [10, 0.45]])], PARAMS);
    expect(r.p.wide).toEqual([{ s0: 0, s1: 10 }]);
    expect(r.p.wideMm).toBe(10);
    expect(r.p.offBandMm).toBe(10);
    expect(r.p.bandExitMm).toBe(0);
    expect(r.p.coupledMm).toBeCloseTo(10, 12);
  });

  test("the angle gate: 10 degrees is beside the source, 20 degrees is not", () => {
    // A 1 mm partner stub centred 0.6 mm off P — every point of it is coupled
    // and out of band, so only the fold angle decides.
    const tilted = (deg: number) => {
      const rad = (deg * Math.PI) / 180;
      const dx = 0.5 * Math.cos(rad);
      const dy = 0.5 * Math.sin(rad);
      return [path([[10 - dx, 0.6 - dy], [10 + dx, 0.6 + dy]])];
    };
    const source = [path([[0, 0], [20, 0]])];

    const shallow = coupledSpans(source, tilted(10), PARAMS).p;
    // The strip is the partner's span re-measured along the source: 1/cos(10°).
    expect(shallow.wideMm).toBeCloseTo(1 / Math.cos((10 * Math.PI) / 180), 9);

    const steep = coupledSpans(source, tilted(20), PARAMS).p;
    expect(steep.wideMm).toBe(0);
    expect(steep.offBandMm).toBe(0);
    expect(steep.coupledMm).toBeGreaterThan(0.5);
  });

  test("anti-parallel partner copper still counts as beside the source", () => {
    const forward = coupledSpans([path([[0, 0], [10, 0]])], [path([[0, 0.45], [10, 0.45]])], PARAMS);
    const reversed = coupledSpans([path([[0, 0], [10, 0]])], [path([[10, 0.45], [0, 0.45]])], PARAMS);
    expect(reversed.p.wideMm).toBe(forward.p.wideMm);
  });

  test("a further partner run never makes an on-target stretch wide", () => {
    // N doubles back 0.75 mm away while its near run holds the target gap. The
    // near run's in-band verdict wins; see the WP2 report's deviation note.
    const r = coupledSpans(
      [path([[0, 0], [20, 0]])],
      [path([[0, 0.35], [20, 0.35]]), path([[0, 0.75], [20, 0.75]])],
      PARAMS,
    );
    expect(r.p.wideMm).toBe(0);
    expect(r.p.offBandMm).toBe(0);
    expect(r.p.coupledMm).toBeCloseTo(20, 12);
  });

  test("the sweep finds a near pair that is last in both index orders", () => {
    // The halo excludes 39 of the 40 pairs, and the one that survives is the
    // last source against the last target — an active-list that pruned too
    // eagerly, or admitted too late, would report it as uncoupled.
    const far: CoupledPath[] = [];
    for (let i = 0; i < 4; i += 1) far.push(path([[i * 50, 0], [i * 50 + 10, 0]]));
    const pPaths = [...far, path([[400, 0], [420, 0]])];
    const nPaths = [...far.map((_, i) => path([[i * 50, 40], [i * 50 + 10, 40]])), path([[400, 0.35], [420, 0.35]])];
    const r = coupledSpans(pPaths, nPaths, PARAMS);
    expect(r.p.copperLengthMm).toBeCloseTo(60, 12);
    expect(r.p.coupledMm).toBeCloseTo(20, 12);
    expect(r.p.uncoupledMm).toBeCloseTo(40, 12);
    expect(r.p.minGapMm).toBeCloseTo(0.15, 12);
    expect(r.p.coupled[0]!.s0).toBeCloseTo(40, 12); // the fifth source starts at 40 mm
  });

  test("swapping the members swaps the outputs byte for byte", () => {
    const a = [path([[0, 0], [20, 0]]), path([[20, 0], [20, 6]], 0.15)];
    const b = [path([[0, 0.35], [19.4, 5.2]], 0.12)];
    const forward = coupledSpans(a, b, PARAMS);
    const reversed = coupledSpans(b, a, PARAMS);
    expect(JSON.stringify(reversed.n)).toBe(JSON.stringify(forward.p));
    expect(JSON.stringify(reversed.p)).toBe(JSON.stringify(forward.n));
  });
});

describe("coupledSpans — the parallelism gate is direction-blind", () => {
  /** A 1 mm partner stub centred 0.6 mm off P: coupled and out of band all along. */
  const stub = (deg: number, reversed = false): CoupledPath[] => {
    const rad = (deg * Math.PI) / 180;
    const dx = 0.5 * Math.cos(rad);
    const dy = 0.5 * Math.sin(rad);
    const ends: [number, number][] = [[10 - dx, 0.6 - dy], [10 + dx, 0.6 + dy]];
    return [path(reversed ? [ends[1]!, ends[0]!] : ends)];
  };
  const SOURCE = [path([[0, 0], [20, 0]])];

  test("Astra run 2 #1: the 15 degree boundary fixture is reversal-proof", () => {
    // An integer-nanometre direction landing on the gate: the atan2 fold made
    // this 0 mm forward and 1.877 mm with N's points reversed.
    const source = [path([[0, 0], [109.552575, 0]])];
    const ends: [number, number][] = [[0, 0.4], [109.552575, 29.754524]];
    const forward = coupledSpans(source, [path(ends)], PARAMS).p;
    const reversed = coupledSpans(source, [path([ends[1]!, ends[0]!])], PARAMS).p;
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(forward.wideMm).toBeGreaterThan(0);
    // Reversing the SOURCE re-origins the arc length, so only the measure can
    // be compared — but it must not move by more than float noise.
    const sourceReversed = coupledSpans(
      [path([[109.552575, 0], [0, 0]])],
      [path(ends)],
      PARAMS,
    ).p;
    expect(sourceReversed.wideMm).toBeCloseTo(forward.wideMm, 12);
  });

  test("a partner at exactly the gate angle answers the same both ways", () => {
    const forward = coupledSpans(SOURCE, stub(PARALLEL_MAX_DEG), PARAMS).p;
    const reversed = coupledSpans(SOURCE, stub(PARALLEL_MAX_DEG, true), PARAMS).p;
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  test("14.999 degrees is beside the source, 15.001 is not — either way round", () => {
    for (const reversed of [false, true]) {
      expect(coupledSpans(SOURCE, stub(14.999, reversed), PARAMS).p.wideMm).toBeCloseTo(
        1 / Math.cos((14.999 * Math.PI) / 180),
        9,
      );
      expect(coupledSpans(SOURCE, stub(15.001, reversed), PARAMS).p.wideMm).toBe(0);
    }
  });

  test("anti-parallel is parallel, and the gate never reads the wrap as square", () => {
    // 179.5° raw = 0.5° folded: a partner drawn back along the source.
    const forward = coupledSpans(SOURCE, stub(0.5), PARAMS).p;
    const antiParallel = coupledSpans(SOURCE, stub(179.5), PARAMS).p;
    expect(antiParallel.wideMm).toBeCloseTo(forward.wideMm, 12);
    expect(forward.wideMm).toBeGreaterThan(0);
  });
});

describe("coupledSpans — the sweep prunes on both axes", () => {
  const subdivide = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    count: number,
  ): [number, number][] =>
    Array.from({ length: count + 1 }, (_, i) => {
      const t = i / count;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t] as [number, number];
    });
  /** (x, y) → (−y, x): exact in binary floats, so nothing else may move. */
  const rotate = (pts: [number, number][]): [number, number][] =>
    pts.map(([x, y]) => [-y, x] as [number, number]);

  test("a finely subdivided route matches the naive reference in both orientations", () => {
    const horizontalP = subdivide(0, 0, 30, 0, 150);
    const horizontalN = subdivide(0, 0.35, 30, 0.35, 150);
    for (const [label, pPts, nPts] of [
      ["horizontal", horizontalP, horizontalN],
      ["vertical", rotate(horizontalP), rotate(horizontalN)],
    ] as const) {
      const pPaths = [path(pPts)];
      const nPaths = [path(nPts)];
      const swept = coupledSpans(pPaths, nPaths, PARAMS).p;
      const naive = naiveMember(pPaths, nPaths, PARAMS);
      expect(swept.coupledMm, label).toBe(naive.coupledMm);
      expect(swept.tightMm, label).toBe(naive.tightMm);
      expect(swept.uncoupledMm, label).toBe(naive.uncoupledMm);
      expect(swept.coupledMm, label).toBeCloseTo(30, 9);
    }
  });

  test("rotating the whole fixture 90 degrees changes no measure", () => {
    const pPts = subdivide(0, 0, 30, 0, 120);
    const nPts = subdivide(0, 0.55, 30, 0.55, 120);
    const flat = coupledSpans([path(pPts)], [path(nPts)], PARAMS).p;
    const turned = coupledSpans([path(rotate(pPts))], [path(rotate(nPts))], PARAMS).p;
    expect(turned.coupledMm).toBeCloseTo(flat.coupledMm, 9);
    expect(turned.wideMm).toBeCloseTo(flat.wideMm, 9);
    expect(turned.uncoupledMm).toBeCloseTo(flat.uncoupledMm, 9);
    expect(flat.wideMm).toBeGreaterThan(29); // the run really is too wide
  });

  test("routes far apart on the swept axis find no candidate at all", () => {
    // Astra run 2 #2's fixture: every x-extent overlaps and no pair is near.
    const pPts = subdivide(0, 0, 0, 30, 400);
    const nPts = subdivide(0, 35, 0, 65, 400);
    for (const [label, a, b] of [
      ["vertical", pPts, nPts],
      ["horizontal", rotate(pPts), rotate(nPts)],
    ] as const) {
      const r = coupledSpans([path(a)], [path(b)], PARAMS).p;
      expect(r.coupledMm, label).toBe(0);
      expect(r.minGapMm, label).toBeNull();
      expect(r.uncoupledMm, label).toBeCloseTo(30, 9);
    }
  });
});

describe("coupledSpans — the comparison regime", () => {
  const at = (yMm: number) => coupledSpans([path([[0, 0], [20, 0]])], [path([[0, yMm], [20, yMm]])], PARAMS);

  test("a gap 1e-9 past t + tol is not wide; 1e-5 past it is", () => {
    // gap = y − halfSum, so y = t + tol + halfSum + δ.
    expect(at(0.2 + HALF_SUM + 1e-9).p.wideMm).toBe(0);
    expect(at(0.2 + HALF_SUM + 1e-5).p.wideMm).toBeCloseTo(20, 9);
  });

  test("a gap 1e-9 below t − tol is not tight; 1e-5 below it is", () => {
    expect(at(0.1 + HALF_SUM - 1e-9).p.tightMm).toBe(0);
    expect(at(0.1 + HALF_SUM - 1e-5).p.tightMm).toBeCloseTo(20, 9);
  });

  test("a gap 1e-9 past G is still coupled; 1e-5 past it is not", () => {
    expect(at(0.7 + HALF_SUM + 1e-9).p.coupledMm).toBeCloseTo(20, 9);
    expect(at(0.7 + HALF_SUM + 1e-5).p.coupledMm).toBe(0);
    expect(at(0.7 + HALF_SUM + 1e-5).p.uncoupledMm).toBeCloseTo(20, 12);
  });
});

describe("coupledSpans — degenerate inputs", () => {
  test("no partner copper on the layer: everything is uncoupled, no witness", () => {
    const r = coupledSpans([path([[0, 0], [20, 0]])], [path([[0, 0.35], [20, 0.35]], HW, "B.Cu")], PARAMS);
    expect(r.p.coupledMm).toBe(0);
    expect(r.p.uncoupledMm).toBeCloseTo(20, 12);
    expect(r.p.minGapMm).toBeNull();
    expect(r.p.minGapPointMm).toBeNull();
    expect(r.p.bandExitMm).toBeNull();
    expect(r.p.bandExitPointMm).toBeNull();
  });

  test("zero-length source segments and one-point paths carry no length", () => {
    const r = coupledSpans(
      [path([[0, 0], [0, 0], [20, 0]]), path([[5, 5]])],
      [path([[0, 0.35], [20, 0.35]])],
      PARAMS,
    );
    expect(r.p.copperLengthMm).toBeCloseTo(20, 12);
    expect(r.p.coupledMm).toBeCloseTo(20, 12);
  });
});

// ── reference implementations ─────────────────────────────────────────────

function mergeRef(list: readonly SublevelInterval[]): SublevelInterval[] {
  if (list.length === 0) return [];
  const sorted = [...list].sort((x, y) => x.s0 - y.s0 || x.s1 - y.s1);
  const out: SublevelInterval[] = [{ ...sorted[0]! }];
  for (const iv of sorted.slice(1)) {
    const last = out[out.length - 1]!;
    if (iv.s0 <= last.s1) last.s1 = Math.max(last.s1, iv.s1);
    else out.push({ ...iv });
  }
  return out;
}

const measureRef = (list: readonly SublevelInterval[]): number =>
  list.reduce((sum, iv) => sum + (iv.s1 - iv.s0), 0);

function subtractRef(a: readonly SublevelInterval[], b: readonly SublevelInterval[]): SublevelInterval[] {
  const out: SublevelInterval[] = [];
  for (const iv of a) {
    let cur = iv.s0;
    for (const hole of b) {
      if (hole.s1 < cur || hole.s0 > iv.s1) continue;
      if (hole.s0 > cur) out.push({ s0: cur, s1: Math.min(hole.s0, iv.s1) });
      cur = Math.max(cur, hole.s1);
    }
    if (cur < iv.s1) out.push({ s0: cur, s1: iv.s1 });
  }
  return out.filter((iv) => iv.s1 > iv.s0);
}

/**
 * The naive all-pairs form of the kernel: no sweep, no halo — every source
 * sub-segment against every same-layer partner sub-segment. The swept kernel
 * must equal it exactly, or the halo is dropping a contributing pair. `wide` is
 * left to the sampling oracle: duplicating the strip rule here would only test
 * the kernel against a copy of itself.
 */
function naiveMember(
  self: readonly CoupledPath[],
  partner: readonly CoupledPath[],
  params: CoupledSpanParams,
): { coupledMm: number; tightMm: number; uncoupledMm: number } {
  const { targetGapMm: t, gapTolMm: tol, couplingMaxGapMm: g } = params;
  const raw: SublevelInterval[][] = [[], []];
  let copperLengthMm = 0;
  for (const src of self) {
    for (let i = 1; i < src.pointsMm.length; i += 1) {
      const a = src.pointsMm[i - 1]!;
      const b = src.pointsMm[i]!;
      const lenMm = Math.hypot(b.x - a.x, b.y - a.y);
      if (lenMm === 0) continue;
      const off = copperLengthMm;
      copperLengthMm += lenMm;
      for (const tgt of partner) {
        if (tgt.layer !== src.layer) continue;
        for (let j = 1; j < tgt.pointsMm.length; j += 1) {
          const halfSum = src.halfWidthMm + tgt.halfWidthMm;
          // Mirrors the kernel's canonical partner lead (contract 06 §7).
          const first = tgt.pointsMm[j - 1]!;
          const second = tgt.pointsMm[j]!;
          const leads = first.x !== second.x ? first.x < second.x : first.y <= second.y;
          const target = {
            kind: "segment" as const,
            a: leads ? first : second,
            b: leads ? second : first,
          };
          const radii = [g + EPS + halfSum, t - tol - EPS + halfSum];
          radii.forEach((r, k) => {
            const iv = sublevel(a, b, target.a, target.b, r);
            if (iv) raw[k]!.push({ s0: off + iv.s0, s1: off + iv.s1 });
          });
        }
      }
    }
  }
  const coupled = mergeRef(raw[0]!);
  return {
    coupledMm: measureRef(coupled),
    tightMm: measureRef(mergeRef(raw[1]!)),
    uncoupledMm: Math.max(0, copperLengthMm - measureRef(coupled)),
  };
}

/** The reference calls the same primitive; only the enumeration differs. */
const sublevel = (
  a: PcbPointMm,
  b: PcbPointMm,
  c: PcbPointMm,
  d: PcbPointMm,
  r: number,
): SublevelInterval | null => segmentSublevelInterval(a, b, { kind: "segment", a: c, b: d }, r);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("coupledSpans — the sweep is not a filter on the answer", () => {
  test("200 seeded random pairs match the naive all-pairs reference exactly", () => {
    const rnd = mulberry32(0x14a2);
    const span = (lo: number, hi: number) => lo + rnd() * (hi - lo);
    const layers: PcbCopperLayerId[] = ["F.Cu", "B.Cu"];
    let nonTrivial = 0;

    for (let i = 0; i < 200; i += 1) {
      const make = (): CoupledPath[] => {
        const count = 1 + Math.floor(rnd() * 2);
        const out: CoupledPath[] = [];
        for (let k = 0; k < count; k += 1) {
          const points: [number, number][] = [];
          const vertices = 2 + Math.floor(rnd() * 3);
          for (let v = 0; v < vertices; v += 1) points.push([span(-4, 4), span(-4, 4)]);
          out.push(path(points, span(0.05, 0.3), layers[Math.floor(rnd() * layers.length)]!));
        }
        return out;
      };
      const pPaths = make();
      const nPaths = make();
      const params: CoupledSpanParams = {
        targetGapMm: span(0.05, 0.4),
        gapTolMm: span(0, 0.1),
        couplingMaxGapMm: span(0.1, 1.5),
        parallelMaxDeg: PARALLEL_MAX_DEG,
      };
      const swept = coupledSpans(pPaths, nPaths, params);
      for (const [member, self, partner] of [
        [swept.p, pPaths, nPaths],
        [swept.n, nPaths, pPaths],
      ] as const) {
        const naive = naiveMember(self, partner, params);
        expect(member.coupledMm).toBe(naive.coupledMm);
        expect(member.tightMm).toBe(naive.tightMm);
        expect(member.uncoupledMm).toBe(naive.uncoupledMm);
        // The amendment can only shrink `wide`: a strip is a subset of the
        // coupled set, and the in-band veto still applies on top.
        expect(member.wideMm).toBeLessThanOrEqual(member.coupledMm + 1e-12);
        expect(member.uncoupledMm).toBeGreaterThanOrEqual(0);
        if (member.coupledMm > 0) nonTrivial += 1;
      }
    }
    expect(nonTrivial).toBeGreaterThan(50);
  });
});

// ── brute-force sampling oracle ───────────────────────────────────────────

const SAMPLE_MM = 1e-4;

function distancePointToSegment(q: PcbPointMm, a: PcbPointMm, b: PcbPointMm): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(q.x - a.x, q.y - a.y);
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2));
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy));
}

/** Perpendicular gap to a partner segment, or null when the foot is off it. */
function perpendicularGap(
  q: PcbPointMm,
  a: PcbPointMm,
  b: PcbPointMm,
  halfSumMm: number,
): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return null; // a cap is not a strip
  const t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2;
  if (t < 0 || t > 1) return null;
  return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy)) - halfSumMm;
}

function foldedDeg(a: PcbPointMm, b: PcbPointMm, c: PcbPointMm, d: PcbPointMm): number {
  const delta = Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(d.y - c.y, d.x - c.x);
  let folded = Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
  if (folded > Math.PI / 2) folded = Math.PI - folded;
  return (folded * 180) / Math.PI;
}

/**
 * Midpoint-rule measures of `{g ≤ G}`, `{g < t − tol}` and the amended wide set,
 * from independent distance functions. Only INTERIOR set boundaries carry error
 * (one sample step each), so a two-boundary fixture stays inside 3e-4 mm.
 */
function oracleMeasures(
  self: readonly CoupledPath[],
  partner: readonly CoupledPath[],
  params: CoupledSpanParams,
): { coupledMm: number; tightMm: number; wideMm: number } {
  let coupled = 0;
  let tight = 0;
  let wide = 0;
  for (const src of self) {
    for (let i = 1; i < src.pointsMm.length; i += 1) {
      const a = src.pointsMm[i - 1]!;
      const b = src.pointsMm[i]!;
      const lenMm = Math.hypot(b.x - a.x, b.y - a.y);
      if (lenMm === 0) continue;
      const steps = Math.ceil(lenMm / SAMPLE_MM);
      const step = lenMm / steps;
      for (let k = 0; k < steps; k += 1) {
        const u = (k + 0.5) * step / lenMm;
        const q = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
        let g = Infinity;
        for (const tgt of partner) {
          if (tgt.layer !== src.layer) continue;
          for (let j = 1; j < tgt.pointsMm.length; j += 1) {
            const d =
              distancePointToSegment(q, tgt.pointsMm[j - 1]!, tgt.pointsMm[j]!) -
              (src.halfWidthMm + tgt.halfWidthMm);
            if (d < g) g = d;
          }
        }
        if (g <= params.couplingMaxGapMm) coupled += step;
        if (g < params.targetGapMm - params.gapTolMm) tight += step;
        // Wide: BESIDE a near-parallel partner run, off-band on its own strip,
        // and not rescued by any nearer partner copper.
        if (g > params.targetGapMm + params.gapTolMm) {
          let beside = false;
          for (const tgt of partner) {
            if (tgt.layer !== src.layer) continue;
            for (let j = 1; j < tgt.pointsMm.length && !beside; j += 1) {
              const c = tgt.pointsMm[j - 1]!;
              const d = tgt.pointsMm[j]!;
              if (foldedDeg(a, b, c, d) > params.parallelMaxDeg) continue;
              const pg = perpendicularGap(q, c, d, src.halfWidthMm + tgt.halfWidthMm);
              if (
                pg !== null &&
                pg > params.targetGapMm + params.gapTolMm &&
                pg <= params.couplingMaxGapMm
              ) {
                beside = true;
              }
            }
          }
          if (beside) wide += step;
        }
      }
    }
  }
  return { coupledMm: coupled, tightMm: tight, wideMm: wide };
}

describe("coupledSpans — brute-force sampling oracle", () => {
  test("the diverging fixture agrees with 1e-4 mm sampling within 3e-4 mm", () => {
    const p = [path([[0, 0], [20, 0]])];
    const n = [path([[0, 0.35], [20, 1.35]])];
    const kernel = coupledSpans(p, n, PARAMS).p;
    const oracle = oracleMeasures(p, n, PARAMS);
    expect(Math.abs(kernel.coupledMm - oracle.coupledMm)).toBeLessThanOrEqual(3e-4);
    expect(Math.abs(kernel.tightMm - oracle.tightMm)).toBeLessThanOrEqual(3e-4);
    expect(Math.abs(kernel.wideMm - oracle.wideMm)).toBeLessThanOrEqual(3e-4);
  });

  test("the C1-hole fixture agrees with 1e-4 mm sampling within 3e-4 mm", () => {
    const params: CoupledSpanParams = {
      targetGapMm: 0.05,
      gapTolMm: 0.05,
      couplingMaxGapMm: 0.7,
      parallelMaxDeg: PARALLEL_MAX_DEG,
    };
    const p = [path([[0, 0], [20, 0]])];
    const n = [path([[0, 0.25], [9, 0.25]]), path([[11, 0.25], [20, 0.25]])];
    const kernel = coupledSpans(p, n, params).p;
    const oracle = oracleMeasures(p, n, params);
    expect(Math.abs(kernel.coupledMm - oracle.coupledMm)).toBeLessThanOrEqual(3e-4);
    expect(Math.abs(kernel.tightMm - oracle.tightMm)).toBeLessThanOrEqual(3e-4);
    expect(Math.abs(kernel.wideMm - oracle.wideMm)).toBeLessThanOrEqual(3e-4);
  });

  test("the 45 degree departure agrees with 1e-4 mm sampling within 3e-4 mm", () => {
    const p = [path([[0, 0], [20, 0]])];
    const n = [path([[0, 0.35], [10, 0.35], [16, 6.35]])];
    const kernel = coupledSpans(p, n, PARAMS).p;
    const oracle = oracleMeasures(p, n, PARAMS);
    expect(Math.abs(kernel.coupledMm - oracle.coupledMm)).toBeLessThanOrEqual(3e-4);
    expect(Math.abs(kernel.tightMm - oracle.tightMm)).toBeLessThanOrEqual(3e-4);
    expect(Math.abs(kernel.wideMm - oracle.wideMm)).toBeLessThanOrEqual(3e-4);
  });

  test("the jog fixture agrees with 1e-4 mm sampling within 3e-4 mm", () => {
    const p = [path([[0, 0], [20, 0]])];
    const n = [path([[0, 0.35], [9, 0.35], [9, 0.55], [20, 0.55]])];
    const kernel = coupledSpans(p, n, PARAMS).p;
    const oracle = oracleMeasures(p, n, PARAMS);
    expect(Math.abs(kernel.coupledMm - oracle.coupledMm)).toBeLessThanOrEqual(3e-4);
    expect(Math.abs(kernel.tightMm - oracle.tightMm)).toBeLessThanOrEqual(3e-4);
    expect(Math.abs(kernel.wideMm - oracle.wideMm)).toBeLessThanOrEqual(3e-4);
  });
});
