/**
 * WP4 — the broad-phase oracle harness (contract 08 §7): proves that the
 * grid v2 / region-index enumerations (WP2/WP3) never disagree with the
 * pre-S9 exhaustive enumerations, kept verbatim as the oracle.
 *
 * Three kinds of equality, on every board this file drives:
 *  (i)   draft-multiset identity — `drcDrafts(P, exhaustive)` and
 *        `drcDrafts(P, {})` are the same SET of drafts (sorted, stringified);
 *        `drcDrafts` is a WP3 export — if it has not landed yet, the
 *        draft-level assertion is skipped (logged once) and only the
 *        report-level assertion (ii) runs, per the WP4 brief.
 *  (ii)  report-byte identity — `JSON.stringify(runDrc(P, exhaustive))` ===
 *        `JSON.stringify(runDrc(P))`.
 *  (iii) stats inequalities — the grid enumeration never judges MORE pairs
 *        or runs MORE prefilter tests than the exhaustive one, and is
 *        strictly cheaper on the dense corpus (contract 08 §7).
 *
 * Plus: non-vacuity (every DrcRuleCode but ZONE_FILL_FAILED is actually
 * provoked somewhere in this corpus), the §5 halo inequalities over the
 * corpus's own (kind, netA, netB) triples, and a mutation check that proves
 * the oracle is live (a halved halo drops real pairs).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { drcDrafts, runDrc } from "../../../shared/drc/drc-engine";
import { buildDrcContext, buildDrcItems } from "../../../shared/drc/drc-context";
import { checkBoard } from "../../../shared/drc/checks/board";
import { checkClearance, judgeCopperPairs } from "../../../shared/drc/checks/clearance";
import { checkCopperToHole } from "../../../shared/drc/checks/copper-to-hole";
import { checkPendingCopper } from "../../../shared/drc/legality";
import type { PendingCopper } from "../../../shared/drc/legality";
import { createDrcRunStats } from "../../../shared/drc/types";
import type {
  DrcOptions,
  DrcRunStats,
  DrcViolationDraft,
} from "../../../shared/drc/types";
import { RULE_CLASS_BY_CODE } from "../../../shared/drc/severity";
import { traceTraceGap } from "../../../shared/drc/pair-gap";
import type {
  DesignerPcbProjection,
  DrcPairKind,
  DrcRuleCode,
  PcbTrace,
} from "../../../sdks/designer";
import { fixtureToProjection } from "./helpers/drc-golden";
import {
  board,
  boardWithRules,
  freeHole,
  freePad,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";
import {
  SYNTHETIC_CORPUS,
  synthesizeBoard,
  type SynthesizeOpts,
} from "./helpers/drc-synthetic";
import {
  buildFixture,
  reversedEverything,
  singleReversalBuilders,
} from "./helpers/drc-determinism-fixture";

const GOLDEN_DIR = path.resolve(import.meta.dir, "fixtures/drc/golden");
const GOLDEN_FILES = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
  .sort();

// --- optional WP3 export ----------------------------------------------------


function sortedDraftsJson(drafts: readonly DrcViolationDraft[]): string {
  return drafts
    .map((d) => JSON.stringify(d))
    .sort()
    .join("\n");
}

/** (i) draft multiset identity, when available, and (ii) report-byte identity. */
function assertModeIdentity(p: DesignerPcbProjection, label: string): void {
  // The draft level is the stronger clause (contract 08 §1): two draft sets can
  // finalise to equal bytes, so it is asserted unconditionally, never skipped.
  const exhaustive = sortedDraftsJson(drcDrafts(p, { broadPhase: "exhaustive" }));
  const grid = sortedDraftsJson(drcDrafts(p, {}));
  expect(exhaustive, `${label}: draft multiset differs`).toBe(grid);
  expect(
    JSON.stringify(runDrc(p, { broadPhase: "exhaustive" })),
    `${label}: report bytes differ`,
  ).toBe(JSON.stringify(runDrc(p)));
}

// --- (i)+(ii) on the goldens -------------------------------------------------

describe("oracle: goldens", () => {
  for (const file of GOLDEN_FILES) {
    const name = file.replace(/\.json$/, "");
    test(`${name}: grid == exhaustive`, async () => {
      const fixture = JSON.parse(
        await Bun.file(path.join(GOLDEN_DIR, file)).text(),
      );
      assertModeIdentity(fixtureToProjection(fixture), name);
    });
  }
});

// --- (i)+(ii) on the determinism fixture + its eight reversals --------------

describe("oracle: determinism fixture and reversals", () => {
  test("base fixture: grid == exhaustive", () => {
    assertModeIdentity(buildFixture(), "determinism base");
  });

  for (const [name, build] of singleReversalBuilders()) {
    test(`reversing ${name} alone: grid == exhaustive`, () => {
      assertModeIdentity(build(), `reversed ${name}`);
    });
  }

  test("reversing all eight arrays: grid == exhaustive", () => {
    assertModeIdentity(reversedEverything(), "reversed everything");
  });
});

// --- (i)+(ii)+(iii) on the seeded synthetic corpus ---------------------------

const CORPUS_CODES = new Map<string, Set<DrcRuleCode>>();
/** Populated by `runCorpusBoard`, reused by the "strictly cheaper" test
 * below instead of re-synthesising and re-running all 18 boards a second
 * time (WP4 R2 finding). */
const CORPUS_STATS = new Map<
  string,
  { grid: DrcRunStats; exhaustive: DrcRunStats }
>();

function runCorpusBoard(
  name: string,
  items: number,
  p: DesignerPcbProjection,
): { stats: { grid: DrcRunStats; exhaustive: DrcRunStats } } {
  assertModeIdentity(p, name);

  const gridStats = createDrcRunStats();
  const report = runDrc(p, { stats: gridStats });
  const exhaustiveStats = createDrcRunStats();
  runDrc(p, { broadPhase: "exhaustive", stats: exhaustiveStats });

  CORPUS_CODES.set(name, new Set(report.violations.map((v) => v.code)));
  CORPUS_STATS.set(name, { grid: gridStats, exhaustive: exhaustiveStats });

  expect(report.violations.length, `${name}: no violations at all`).toBeGreaterThanOrEqual(1);
  // `items` (the generator's OWN size knob), not a substring match on the
  // generated `designId` (WP4 R2 finding: `p.designId.includes("5000")`
  // would also match, e.g., a hypothetical 15000-item board, and says
  // nothing when the board is exactly the dense-gate size).
  if (items >= 5000) {
    expect(
      report.violations.length,
      `${name}: dense board under 200 violations`,
    ).toBeGreaterThanOrEqual(200);
    // The dense-board prefilter gate (contract 08 §7 (iii)) runs on EVERY
    // 5000-item board, not just whichever one happened to be seen last.
    expect(
      gridStats.prefilterTests * 10,
      `${name}: grid.prefilterTests * 10 not < exhaustive.prefilterTests`,
    ).toBeLessThan(exhaustiveStats.prefilterTests);
  }

  for (const kind of Object.keys(gridStats.pairsJudged) as DrcPairKind[]) {
    expect(
      gridStats.pairsJudged[kind],
      `${name}: grid judged more ${kind} pairs than exhaustive`,
    ).toBeLessThanOrEqual(exhaustiveStats.pairsJudged[kind]);
  }
  expect(
    gridStats.prefilterTests,
    `${name}: grid ran more prefilter tests than exhaustive`,
  ).toBeLessThanOrEqual(exhaustiveStats.prefilterTests);

  return { stats: { grid: gridStats, exhaustive: exhaustiveStats } };
}

describe("oracle: synthetic corpus", () => {
  for (const entry of SYNTHETIC_CORPUS) {
    // The corpus's own budget for a dense board is 30 s (see the comment on the
    // 5000-item entries); the per-entry test was relying on Bun's 5 s default,
    // which the S12 DFM stages pushed it past. Stated, not inherited.
    test(
      entry.name,
      () => {
        const p = synthesizeBoard(entry.opts);
        runCorpusBoard(entry.name, entry.opts.items, p);
      },
      30_000,
    );
  }

  test("stats: grid is strictly cheaper on at least one board per pair kind", () => {
    // Reuses the stats `runCorpusBoard` already computed above — this test
    // runs AFTER the per-entry loop (registration order), so `CORPUS_STATS`
    // is fully populated; no board is re-synthesised or re-run here.
    expect(CORPUS_STATS.size).toBe(SYNTHETIC_CORPUS.length);
    const perKindStrict = new Set<DrcPairKind>();
    for (const { grid, exhaustive } of CORPUS_STATS.values()) {
      for (const kind of Object.keys(grid.pairsJudged) as DrcPairKind[]) {
        if (grid.pairsJudged[kind] < exhaustive.pairsJudged[kind]) {
          perKindStrict.add(kind);
        }
      }
    }
    // Only the TRACE-involving kinds can show a strict reduction in
    // `pairsJudged`: their candidates are filed per SUB-SEGMENT (08 §2.1), so
    // `nearPolyline` is tighter than the item's own AABB and can drop a
    // candidate the exhaustive loop's AABB-only `farApart` still reaches.
    // `padToPad` / `padToVia` / `viaToVia` are filed as plain AABBs, so
    // `near()` returns exactly the AABB-within-halo set — the SAME
    // information `farApart` already re-derives per pair — and the two
    // enumerations reach the body for the identical set of pairs on every
    // board (confirmed empirically across the whole corpus): `pairsJudged`
    // for those three kinds is `<=` (asserted per board above) but can never
    // go strict without per-sub-segment filing for box items too, which is
    // out of S9's design (08 §2.1 files traces, not pads/vias, per piece).
    // `pourTo*` kinds are entirely unwired by `checkClearance` (contract 08
    // §0: pour candidate discovery is S10 budget) — never incremented in
    // either mode, so `<=` holds trivially and strict `<` is impossible.
    const strictCapableKinds: readonly DrcPairKind[] = [
      "traceToTrace",
      "traceToPad",
      "traceToVia",
    ];
    const notStrict = strictCapableKinds.filter((k) => !perKindStrict.has(k));
    expect(
      notStrict,
      `trace-involving pair kinds never strictly cheaper in grid mode: ${notStrict.join(", ")}`,
    ).toEqual([]);

    // The dense-board prefilter gate itself now runs per-board, inside
    // `runCorpusBoard`, for EVERY 5000-item board (WP4 R2 item 11) — just
    // confirm at least one such board actually exists in the corpus.
    const dense5000 = SYNTHETIC_CORPUS.filter((e) => e.opts.items >= 5000);
    expect(dense5000.length, "no 5000-item board in the corpus").toBeGreaterThanOrEqual(1);
  });

  test("waivers: taking 3 ids from an exhaustive run and re-running both modes still agrees", () => {
    for (const entry of SYNTHETIC_CORPUS.slice(0, 2)) {
      const p = synthesizeBoard(entry.opts);
      const exhaustiveReport = runDrc(p, { broadPhase: "exhaustive" });
      const waivedIds = exhaustiveReport.violations.slice(0, 3).map((v) => v.id);
      if (waivedIds.length === 0) continue;
      const withWaivers: DesignerPcbProjection = {
        ...p,
        board: {
          ...p.board,
          viewState: {
            ...(p.board.viewState ?? {
              displayMode: "normal",
              viewSide: "top",
              perLayerOpacity: {},
              layerPreset: "custom",
              ratsnestVisible: true,
            }),
            drcIgnoredRuleClasses: p.board.viewState?.drcIgnoredRuleClasses ?? [],
            drcWaivedViolationIds: waivedIds,
          },
        },
      };
      assertModeIdentity(withWaivers, `${entry.name} + waivers`);
    }
  });

  test("non-vacuity: every DrcRuleCode but ZONE_FILL_FAILED is provoked", () => {
    const allCodes = Object.keys(RULE_CLASS_BY_CODE) as DrcRuleCode[];
    const union = new Set<DrcRuleCode>();
    for (const codes of CORPUS_CODES.values()) {
      for (const c of codes) union.add(c);
    }
    // Also fold in the golden corpus, which the synthetic generator does not
    // aim to reproduce every rare code of (per-fixture hand-crafted codes).
    for (const file of GOLDEN_FILES) {
      const fixture = JSON.parse(
        readFileSync(path.join(GOLDEN_DIR, file), "utf8"),
      );
      const report = runDrc(fixtureToProjection(fixture));
      for (const v of report.violations) union.add(v.code);
    }
    // The same two kernel-failure codes `drc-golden.test.ts` pins as
    // CORPUS_EXCEPTIONS. `ZONE_FILL_FAILED` needs a Clipper refusal no board
    // geometry reaches; `COPPER_SHAPE_UNCHECKED` needs one of those, a
    // 250 000-vertex unit or a 64-neck group (DFM contract 11 §5.5). The
    // `nonFinite` corpus entries DO currently provoke the latter through the
    // fail-closed union, but that is a property of one generator flag, not of
    // the code — both stay pinned by their own unit tests.
    const KERNEL_ONLY: readonly DrcRuleCode[] = [
      "COPPER_SHAPE_UNCHECKED",
      // The exact-geometry layer's twin, same reasoning (12 §4, §5) — a kernel
      // refusal, a capped flattening or an exhausted comparison budget.
      "OUTLINE_WEB_UNCHECKED",
      "ZONE_FILL_FAILED",
    ];
    const missing = allCodes.filter(
      (c) => !KERNEL_ONLY.includes(c) && !union.has(c),
    );
    expect(missing, `codes never provoked: ${missing.join(", ")}`).toEqual([]);
  });

  /**
   * The corpus's OWN code union — the synthetic generator alone, no goldens
   * (recorded at WP4 R2 close). A floor so a future generator change that
   * silently stops provoking a code the CORPUS itself used to cover fails
   * loudly, instead of being masked by the goldens picking up the slack
   * (WP4 R2 item 8).
   */
  const CORPUS_OWN_CODE_FLOOR: readonly DrcRuleCode[] = [
    "ANNULAR_RING_MIN",
    "COPPER_OFF_BOARD",
    "COPPER_TO_BOARD_EDGE",
    "COPPER_TO_HOLE",
    "CREEPAGE_DISTANCE",
    "DRILL_SIZE_MIN",
    "FAB_ANNULAR_RING",
    "FAB_HOLE_TO_HOLE",
    "HOLE_OFF_BOARD",
    "HOLE_TO_HOLE",
    "KEEPOUT_VIOLATION",
    "NETCLASS_TRACE_WIDTH",
    "NETCLASS_VIA_DIAMETER",
    "NETCLASS_VIA_DRILL",
    "NET_SHORT_CIRCUIT",
    "PAD_TO_PAD_CLEARANCE",
    "PAD_TO_VIA_CLEARANCE",
    "TRACE_TO_PAD_CLEARANCE",
    "TRACE_TO_TRACE_CLEARANCE",
    "TRACE_TO_VIA_CLEARANCE",
    "TRACE_WIDTH_MIN",
    "TRACK_DANGLING",
    "UNCONNECTED_NET",
    "VIA_DANGLING",
    "VIA_DIAMETER_MIN",
    "VIA_DRILL_MIN",
    "VIA_TO_VIA_CLEARANCE",
    "ZONE_INVALID",
  ];

  test("non-vacuity: the corpus's OWN code union is at least the recorded floor", () => {
    const union = new Set<DrcRuleCode>();
    for (const codes of CORPUS_CODES.values()) {
      for (const c of codes) union.add(c);
    }
    const missing = CORPUS_OWN_CODE_FLOOR.filter((c) => !union.has(c));
    expect(
      missing,
      `corpus stopped provoking codes it used to: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  test("nonFinite: the generated NaN vertex actually lands in traces (WP4 R2 item 1)", () => {
    // `nonFinite: true` on >= 2 corpus entries (one 300, one 1500 — see
    // SYNTHETIC_CORPUS "s2-300-nonfinite" / "s15-1500-nonfinite"): the flag
    // used to be dead (no entry set it). Confirms the NaN-carrying "nonfinite"
    // trace lands in `ctx.traces` and that `polylinePieces` marks it
    // `oversized` — a far-field `near()` query (well away from every real
    // trace on the board) returns its index unfiltered (contract 08 §2.1
    // "fail open": a NaN coordinate makes every exact comparison false, so
    // an oversized item must be returned by every query instead of filtered).
    for (const name of ["s2-300-nonfinite", "s15-1500-nonfinite"]) {
      const entry = SYNTHETIC_CORPUS.find((e) => e.name === name)!;
      expect(entry.opts.nonFinite, `${name} should set nonFinite: true`).toBe(true);
      const p = synthesizeBoard(entry.opts);
      const ctx = buildDrcItems(p);
      const idx = ctx.traces.findIndex((t) => t.id === "nonfinite");
      expect(idx, `${name}: no "nonfinite" trace in ctx.traces`).toBeGreaterThanOrEqual(0);
      const farBox = { minX: 1e7, minY: 1e7, maxX: 1e7 + 1, maxY: 1e7 + 1 };
      const found = ctx.near("traces", farBox, 0);
      expect(
        found.includes(idx),
        `${name}: the NaN-carrying trace was not returned by a far-field query — not oversized`,
      ).toBe(true);
    }
  });
});

// --- halo inequalities (§5), over the corpus's own (kind, net, net) triples --

/** Evenly-spaced sample of at most `cap` elements, always including the ends. */
function sampleEvenly<T>(items: readonly T[], cap: number): T[] {
  if (items.length <= cap) return [...items];
  const out: T[] = [];
  const step = (items.length - 1) / (cap - 1);
  for (let i = 0; i < cap; i += 1) {
    out.push(items[Math.round(i * step)]!);
  }
  return out;
}

function polygonCentroid(points: readonly { x: number; y: number }[]): {
  x: number;
  y: number;
} {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

describe("oracle: halo inequalities (contract 08 §5)", () => {
  const PAIR_KINDS: readonly DrcPairKind[] = [
    "traceToTrace",
    "traceToPad",
    "traceToVia",
    "padToPad",
    "padToVia",
    "viaToVia",
  ];

  for (const entry of SYNTHETIC_CORPUS.filter((e) => e.opts.items <= 1500)) {
    test(`${entry.name}: clearance/edge/hole halos bound the resolver`, () => {
      const p = synthesizeBoard(entry.opts);
      const ctx = buildDrcItems(p);

      const netIds = new Set<string | null>([null]);
      for (const t of ctx.traces) netIds.add(t.netId);
      for (const pd of ctx.pads) netIds.add(pd.netId);
      for (const v of ctx.vias) netIds.add(v.netId);
      const nets = [...netIds];
      const layers = [...ctx.validCopperLayers];

      // Sample points (WP4 R2 item 3): (0,0), every AREA scope's centroid
      // (from `p.board.drcRules` — the polygons `resolver.clearance` reads,
      // where a point actually matters), and a bounded, evenly-strided
      // sample of every trace/pad/via CENTRE on the board — not just the
      // origin, which never resolves an area-scoped rule at all.
      const points: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
      for (const rule of p.board.drcRules ?? []) {
        for (const scope of rule.scopes) {
          if (scope.kind === "area") points.push(polygonCentroid(scope.polygonMm));
        }
      }
      const itemCenters: Array<{ x: number; y: number }> = [
        ...ctx.traces.map((t) => t.mid),
        ...ctx.pads.map((pd) => pd.center),
        ...ctx.vias.map((v) => v.center),
      ];
      points.push(...sampleEvenly(itemCenters, 20));

      for (const kind of PAIR_KINDS) {
        for (const a of nets) {
          for (const b of nets) {
            for (const layer of layers) {
              for (const point of points) {
                const { mm } = ctx.resolver.clearance(
                  kind,
                  layer,
                  { netId: a, pointMm: point },
                  { netId: b, pointMm: point },
                );
                expect(
                  mm,
                  `${entry.name} ${kind} ${String(a)}/${String(b)} @ ${layer} ${JSON.stringify(point)}`,
                ).toBeLessThanOrEqual(ctx.maxClearanceBoundMm);
              }
            }
          }
        }
      }

      // §5 (iv), edge / hole legs: sample the board's OWN copper geometries
      // (WP4 R2 item 4) — a trace's polyline, a pad's ring/disc, a via's
      // disc — not a synthetic zero-radius disc at (0,0), which never
      // exercised the generator's (now-present) `edgeClearance` /
      // `holeToHole` rules at all.
      const traceGeoms = sampleEvenly(ctx.traces, 10).map((t) => ({
        netId: t.netId,
        layers: [t.layer],
        geometry: {
          kind: "polyline" as const,
          pointsMm: t.pointsMm,
          halfWidthMm: t.halfWidthMm,
        },
      }));
      const padGeoms = sampleEvenly(ctx.pads, 10).map((pd) => ({
        netId: pd.netId,
        layers: pd.layers,
        geometry: pd.disc
          ? { kind: "disc" as const, center: pd.disc.center, radiusMm: pd.disc.radiusMm }
          : { kind: "ring" as const, ring: pd.ring },
      }));
      const viaGeoms = sampleEvenly(ctx.vias, 10).map((v) => ({
        netId: v.netId,
        layers: v.layers,
        geometry: { kind: "disc" as const, center: v.center, radiusMm: v.radiusMm },
      }));

      for (const item of [...traceGeoms, ...padGeoms, ...viaGeoms]) {
        for (const layer of layers) {
          const edge = ctx.resolver.scalar("edgeClearance", {
            netId: item.netId,
            layers: [layer],
            geometry: item.geometry,
          });
          expect(edge.mm, `edgeClearance @ ${layer}`).toBeLessThanOrEqual(
            ctx.maxEdgeBoundMm,
          );
        }
      }

      // holeToHole: real hole PAIRS off the board's own `ctx.holes` (a
      // bounded, evenly-strided sample of consecutive pairs so an N-hole
      // board doesn't cost O(N^2)).
      const holeSample = sampleEvenly(ctx.holes, 12);
      const holeGeom = (h: (typeof ctx.holes)[number]) =>
        h.slot
          ? {
              kind: "segment" as const,
              a: h.slot.a,
              b: h.slot.b,
              halfWidthMm: h.slot.widthMm / 2,
            }
          : { kind: "disc" as const, center: h.center, radiusMm: h.drillMm / 2 };
      for (let i = 0; i < holeSample.length; i += 1) {
        for (let j = i + 1; j < holeSample.length; j += 1) {
          const ha = holeSample[i]!;
          const hb = holeSample[j]!;
          for (const layer of layers) {
            const hh = ctx.resolver.scalarPair(
              "holeToHole",
              { netId: ha.netId, layers: [layer], geometry: holeGeom(ha) },
              { netId: hb.netId, layers: [layer], geometry: holeGeom(hb) },
            );
            expect(hh.mm, `holeToHole @ ${layer}`).toBeLessThanOrEqual(
              ctx.maxHoleBoundMm,
            );
          }
        }
      }
    });
  }
});

// --- micro-fixtures ----------------------------------------------------------

const NETS = { a: "A", b: "B" };

describe("oracle: micro-fixtures", () => {
  test("two traces at edge gap exactly at the rule, and +-1nm (Astra A2 #4)", () => {
    // A2 #4: with 0.2mm-wide traces the EDGE gap is the centreline
    // separation MINUS both half-widths (0.1mm each), so hitting an edge gap
    // of exactly `rule` needs a centreline separation of
    // `rule + 2 * halfWidthMm` = 0.25 + 0.2 = 0.45mm — the previous version
    // of this fixture used `0.1 + rule` (0.35mm), which is not the boundary
    // it claimed to be. Coordinates are quantised to integer nm through the
    // fixture helper, so the +-1nm cases are `0.45mm +- 1e-6mm` exactly.
    const rule = 0.25;
    const b = boardWithRules({ clearance: { traceToTraceMm: rule } });
    const build = (sepMm: number): DesignerPcbProjection =>
      projection({
        board: b,
        netNames: NETS,
        traces: [
          trace("t1", "a", [[0, 0], [10, 0]], { widthMm: 0.2 }),
          trace("t2", "b", [[0, sepMm], [10, sepMm]], { widthMm: 0.2 }),
        ],
      });

    const cases: Array<[string, number, number, boolean]> = [
      ["exactly at the rule", 0.45, 0.25, false],
      ["+1nm over the rule (clears)", 0.45 + 1e-6, 0.25 + 1e-6, false],
      ["-1nm under the rule (violates)", 0.45 - 1e-6, 0.25 - 1e-6, true],
    ];

    for (const [label, sepMm, expectedGap, expectViolation] of cases) {
      const p = build(sepMm);
      const ctx = buildDrcItems(p);
      const gap = traceTraceGap(ctx.traces[0]!, ctx.traces[1]!).gap;
      expect(gap, `${label}: realised copper gap`).toBeCloseTo(expectedGap, 9);
      const req = ctx.resolver.clearance(
        "traceToTrace",
        "F.Cu",
        { netId: "a", pointMm: { x: 0, y: 0 } },
        { netId: "b", pointMm: { x: 0, y: sepMm } },
      ).mm;
      expect(req, `${label}: resolved requirement`).toBe(0.25);

      // Only compare modes AFTER pinning the exact geometry above.
      assertModeIdentity(p, `edge gap ${label}`);

      const codes = runDrc(p).violations.map((v) => v.code);
      if (expectViolation) {
        expect(codes, `${label}: expected a violation`).toContain(
          "TRACE_TO_TRACE_CLEARANCE",
        );
      } else {
        expect(codes, `${label}: expected no violation`).not.toContain(
          "TRACE_TO_TRACE_CLEARANCE",
        );
      }
    }
  });

  test("trace vertex x exactly 2.0 (cell boundary)", () => {
    const p = projection({
      board: board(),
      netNames: NETS,
      traces: [trace("t1", "a", [[2.0, 0], [8, 3]], { widthMm: 0.2 })],
    });
    assertModeIdentity(p, "vertex at x=2.0");
  });

  test("degenerate cutout (one-vertex ring): grid == exhaustive, BOARD_OUTLINE_INVALID in both", () => {
    // A zero-size cutout canonicalises to a ring of ONE vertex (10, 10) — WP3
    // found `region.edges` used to file a `(p, p)` self-edge for it while the
    // per-ring helpers returned `Infinity`, a two-mode divergence in
    // `boardItems`; fixed at the root in `pushRingGeometry`
    // (`src/shared/pcb-geometry/board-region.ts`: rings under two vertices
    // file no edge — contract 08 §9). This pins that both modes agree, and
    // that the one-vertex ring (no usable area) still reports
    // BOARD_OUTLINE_INVALID in both modes.
    const b = board();
    b.cutouts = [
      {
        id: "c0",
        shape: {
          kind: "roundrect",
          widthMm: 0,
          heightMm: 0,
          cornerRadiusMm: 0,
          centerMm: { x: 10, y: 10 },
        },
      },
    ];
    const p = projection({
      board: b,
      netNames: NETS,
      // A via 0.4mm from the degenerate point.
      vias: [via("v1", { netId: "a", center: { x: 10, y: 10.4 } })],
      // A trace passing 0.3mm from the degenerate point.
      traces: [trace("t1", "b", [[5, 10.3], [15, 10.3]], { widthMm: 0.2 })],
      // A pad centred exactly on the degenerate point.
      placements: [
        placement("U1", {
          positionMm: { x: 10, y: 10 },
          pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
        }),
      ],
      padNets: { "U1|1": "a" },
    });

    assertModeIdentity(p, "degenerate one-vertex cutout");

    const gridCodes = runDrc(p).violations.map((v) => v.code);
    const exhaustiveCodes = runDrc(p, { broadPhase: "exhaustive" }).violations.map(
      (v) => v.code,
    );
    expect(gridCodes).toContain("BOARD_OUTLINE_INVALID");
    expect(exhaustiveCodes).toContain("BOARD_OUTLINE_INVALID");
  });

  test("one-vertex OUTER ring (zero-size board outline): grid == exhaustive, BOARD_OUTLINE_INVALID in both", () => {
    // Engine review (R1): a zero-size RECT outline (not a cutout this time —
    // the board's own outer ring) also flattens to one vertex (10, 10) —
    // before R1's fix in `board-region.ts`'s `indexedNearRing`, grid mode
    // emitted EXTRA `COPPER_OFF_BOARD` / `HOLE_OFF_BOARD` drafts here that
    // exhaustive mode did not. A trace, a via and a pad sit near the vertex,
    // one of them (the via) within 1e-7mm of it.
    const b = boardWithRules({
      outline: {
        kind: "rect",
        widthMm: 0,
        heightMm: 0,
        centerMm: { x: 10, y: 10 },
      },
    });
    const p = projection({
      board: b,
      netNames: NETS,
      traces: [trace("t1", "a", [[5, 10.0001], [15, 10.0001]], { widthMm: 0.2 })],
      vias: [via("v1", { netId: "a", center: { x: 10 + 1e-7, y: 10 } })],
      placements: [
        placement("U1", {
          positionMm: { x: 10, y: 10 },
          pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
        }),
      ],
      padNets: { "U1|1": "a" },
    });

    assertModeIdentity(p, "one-vertex outer ring");

    const gridCodes = runDrc(p).violations.map((v) => v.code);
    const exhaustiveCodes = runDrc(p, { broadPhase: "exhaustive" }).violations.map(
      (v) => v.code,
    );
    expect(gridCodes).toContain("BOARD_OUTLINE_INVALID");
    expect(exhaustiveCodes).toContain("BOARD_OUTLINE_INVALID");
  });

  test("two coincident drilled free pads: each other's copper-to-hole partner", () => {
    // `padType: "conn"` free pads carry COPPER (a pad ring, like a component
    // pad) but their drill still reaches the fab as a non-plated hit
    // (contract 06 §2, `freePadDrill`: `plated: pad.padType === "std"`) — so
    // a `conn` pad's OWN hole is `npth`, and two coincident `conn` pads are
    // literally each other's COPPER_TO_HOLE partner in both directions. This
    // is exactly the case `copper-to-hole.ts`'s own comment names: "two
    // coincident drilled free pads are each other's copper AND hole, their
    // two drafts hash to one id" — the canonical-anchor-orientation fix.
    // Different nets, so they also collide as PAD_TO_PAD / NET_SHORT_CIRCUIT
    // and HOLE_TO_HOLE — this fixture is about COPPER_TO_HOLE specifically.
    const p = projection({
      board: board(),
      netNames: NETS,
      freePads: [
        freePad("fpA", {
          center: { x: 5, y: 5 },
          netId: "a",
          padType: "conn",
          drillMm: 0.4,
          widthMm: 1,
          heightMm: 1,
        }),
        freePad("fpB", {
          center: { x: 5, y: 5 },
          netId: "b",
          padType: "conn",
          drillMm: 0.4,
          widthMm: 1,
          heightMm: 1,
        }),
      ],
    });

    assertModeIdentity(p, "coincident conn free pads");

    const report = runDrc(p);
    expect(report.violations.map((v) => v.code)).toContain("COPPER_TO_HOLE");
    // Exactly one COPPER_TO_HOLE violation post-finalise (the two-drafts,
    // one-id, canonical-anchor collapse).
    expect(
      report.violations.filter((v) => v.code === "COPPER_TO_HOLE").length,
    ).toBe(1);

    // Reversing `freePads` alone must still be byte-identical in both modes.
    const reversed: DesignerPcbProjection = {
      ...p,
      freePads: [...p.freePads].reverse(),
    };
    assertModeIdentity(reversed, "coincident conn free pads, freePads reversed");
    expect(JSON.stringify(runDrc(reversed))).toBe(JSON.stringify(report));
  });

  test("via exactly copperToBoardEdgeMm + radius from the outline", () => {
    const b = board();
    const edgeMm = b.designRules.clearance.copperToBoardEdgeMm;
    const radius = 0.4;
    const halfW = b.outline.kind === "rect" ? b.outline.widthMm / 2 : 25;
    const p = projection({
      board: b,
      netNames: NETS,
      vias: [
        via("v1", {
          netId: "a",
          center: { x: halfW - edgeMm - radius, y: 0 },
          diameterMm: radius * 2,
        }),
      ],
    });
    assertModeIdentity(p, "via exactly at the edge halo");
  });

  /**
   * Whether an item is `oversized` (contract 08 §2.1): returned by EVERY
   * `near` query, unfiltered — so a query far from an item's real geometry
   * still returns it iff the item is oversized. `haloMm: 0` keeps the probe
   * box tight; `farBox` is nowhere near any real geometry in these fixtures.
   */
  function isOversizedTrace(p: DesignerPcbProjection, traceId: string): boolean {
    const ctx = buildDrcItems(p);
    const idx = ctx.traces.findIndex((t) => t.id === traceId);
    const farBox = { minX: 1e7, minY: 1e7, maxX: 1e7 + 1, maxY: 1e7 + 1 };
    return ctx.near("traces", farBox, 0).includes(idx);
  }

  test("cell cap (MAX_CELLS_PER_ITEM = 1024): exact boundary, both sides", () => {
    // `fileItem` (`src/shared/drc/broad-phase.ts`) counts DISTINCT cells
    // across all of an item's pieces (a `Set` of cell keys, capped at
    // `MAX_CELLS_PER_ITEM = 1024`) — a per-piece SUM would over-count every
    // cell shared between adjacent 2mm pieces (WP4 R2 correction, applied
    // mid-round after a bug fix landed in `fileItem` itself). An axis-aligned
    // 0.2mm-wide trace at y = 1.0 (half-width 0.1, so its box stays in row 0
    // throughout: `floor(0.9/2) = floor(1.1/2) = 0`) from x = 0.5 to x1 spans
    // `floor(x1/2) - floor(0.5/2) + 1 = floor(x1/2) + 1` distinct x-cells:
    // x1 = 2000.5 -> 1001 cells (indexed); x1 = 2100.5 -> 1051 cells
    // (> 1024, oversized). Verified empirically before pinning.
    const bigBoard = boardWithRules({
      outline: { kind: "rect", widthMm: 4300, heightMm: 100, centerMm: { x: 2100, y: 1 } },
    });
    const under = projection({
      board: bigBoard,
      traces: [trace("under", "a", [[0.5, 1.0], [2000.5, 1.0]], { widthMm: 0.2 })],
    });
    const over = projection({
      board: bigBoard,
      traces: [trace("over", "a", [[0.5, 1.0], [2100.5, 1.0]], { widthMm: 0.2 })],
    });
    assertModeIdentity(under, "cell cap: 1001 distinct cells (not oversized)");
    assertModeIdentity(over, "cell cap: 1051 distinct cells (oversized)");
    expect(isOversizedTrace(under, "under"), "1001 cells should NOT be oversized").toBe(
      false,
    );
    expect(isOversizedTrace(over, "over"), "1051 cells SHOULD be oversized").toBe(true);
  });

  test("sub-segment cap (MAX_SUBSEGMENTS_PER_ITEM = 4096): 4095 vs 4097 pieces", () => {
    // A zig-zag of 1mm segments (each <= cellMm=2mm, so each is exactly one
    // piece per `polylinePieces`), CONFINED to a small area (a handful of
    // 2mm cells) — since `fileItem` now counts DISTINCT cells, keeping the
    // path inside a small bounding box keeps the cell count low (well under
    // 1024) regardless of piece count, so the SUB-SEGMENT cap (4096) is what
    // actually binds here, isolated from the cell cap. Verified empirically:
    // 4095 pieces -> not oversized, 4097 -> oversized (`polylinePieces`
    // itself bails once `out.length + n > MAX_SUBSEGMENTS_PER_ITEM`).
    const zigzag = (id: string, segments: number): PcbTrace => {
      const pts: Array<[number, number]> = [];
      let x = 0;
      let y = 0;
      pts.push([x, y]);
      for (let i = 0; i < segments; i += 1) {
        const dir = i % 4;
        if (dir === 0) x += 1;
        else if (dir === 1) y += 1;
        else if (dir === 2) x -= 1;
        else y -= 1;
        // A tiny drift every 8 segments keeps the path from exactly
        // retracing itself while staying confined to a small area.
        if (i % 8 === 7) {
          x += 0.01;
          y += 0.01;
        }
        pts.push([x, y]);
      }
      return trace(id, "a", pts, { widthMm: 0.2 });
    };
    const p4095 = projection({ board: board(), traces: [zigzag("t4095", 4095)] });
    const p4097 = projection({ board: board(), traces: [zigzag("t4097", 4097)] });
    assertModeIdentity(p4095, "sub-segment cap: 4095 pieces (not oversized)");
    assertModeIdentity(p4097, "sub-segment cap: 4097 pieces (oversized)");
    expect(isOversizedTrace(p4095, "t4095"), "4095 pieces should NOT be oversized").toBe(
      false,
    );
    expect(isOversizedTrace(p4097, "t4097"), "4097 pieces SHOULD be oversized").toBe(true);
  }, 30_000);

  test("a via at x = 2^54 mm (safe-integer cell-index bail)", () => {
    // Astra A1 #4 / contract 08 §2.1: finite does not guarantee a safely
    // enumerable cell index (`2**53 + 1 === 2**53`); `cellRange` bails to
    // `oversized` past that. `2^54` is finite but well past the safe-integer
    // boundary at `CELL_MM = 2` scale.
    const bigX = 2 ** 54;
    const p = projection({
      board: boardWithRules({
        outline: {
          kind: "rect",
          widthMm: 50,
          heightMm: 30,
          centerMm: { x: bigX, y: 0 },
        },
      }),
      netNames: NETS,
      vias: [via("v1", { netId: "a", center: { x: bigX, y: 0 } })],
    });
    assertModeIdentity(p, "via at x = 2^54 mm");
  });

  test("HV pad pair exactly at the B2 spacing for 400V", () => {
    const b = boardWithRules({
      netClasses: [
        {
          id: "hvA",
          name: "HV-A",
          traceWidthMm: 0.3,
          clearanceMm: 0.1,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          color: "#f00",
          defaultViaProtection: "tented",
          voltageV: 0,
        },
        {
          id: "hvB",
          name: "HV-B",
          traceWidthMm: 0.3,
          clearanceMm: 0.1,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          color: "#00f",
          defaultViaProtection: "tented",
          voltageV: 400,
        },
      ],
    });
    b.perNetClassAssignments = { a: "hvA", b: "hvB" };
    // B2 @ 400V = 2.5 mm (Table 6-1 band <=500V not exceeded -> 1.25mm band
    // actually applies at <=300V; 400V falls in the >300<=500 -> 2.5mm band).
    const spacing = 2.5;
    const p = projection({
      board: b,
      netNames: NETS,
      placements: [
        placement("U1", {
          pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
        }),
        placement("U2", {
          positionMm: { x: 1 + spacing, y: 0 },
          pads: [pad("1", { x: 0, y: 0 }, 1, 1)],
        }),
      ],
      padNets: { "U1|1": "a", "U2|1": "b" },
    });
    assertModeIdentity(p, "HV pad pair at exact B2 spacing");
  });

  test("NaN-voltage class with a finite 800V pair (Astra A2 #1)", () => {
    // A grid-mode FALSE NEGATIVE before the fix: an UNUSED net class with
    // `voltageV: NaN` used to corrupt `maxCreepageBoundMm` down to a finite
    // (wrong) 2.5mm instead of failing open — a real 800V pair (+400V vs
    // -400V, B2 requirement 4mm) with a 3.0mm copper gap is a genuine
    // CREEPAGE_DISTANCE violation that a 2.5mm halo would silently drop from
    // grid mode's candidate discovery. `maxCreepageBoundMm` must be
    // `Infinity` whenever ANY class carries a non-finite voltage (fail open,
    // not fail silent).
    const b = boardWithRules({
      clearance: { traceToTraceMm: 0.25 },
      netClasses: [
        {
          id: "default",
          name: "Default",
          traceWidthMm: 0.2,
          clearanceMm: 0.2,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          color: "#888",
          defaultViaProtection: "tented",
        },
        {
          id: "hvpos",
          name: "HV+",
          traceWidthMm: 0.2,
          clearanceMm: 0.2,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          color: "#f00",
          defaultViaProtection: "tented",
          voltageV: 400,
        },
        {
          id: "hvneg",
          name: "HV-",
          traceWidthMm: 0.2,
          clearanceMm: 0.2,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          color: "#00f",
          defaultViaProtection: "tented",
          voltageV: -400,
        },
        // Unused by any net — the class that used to corrupt the halo.
        {
          id: "nanclass",
          name: "NaN class",
          traceWidthMm: 0.2,
          clearanceMm: 0.2,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          color: "#0f0",
          defaultViaProtection: "tented",
          voltageV: NaN,
        },
      ],
    });
    b.perNetClassAssignments = { a: "hvpos", b: "hvneg" };
    const p = projection({
      board: b,
      netNames: NETS,
      traces: [
        trace("t1", "a", [[10, 10], [11, 10]], { widthMm: 0.2 }),
        trace("t2", "b", [[10, 13.2], [11, 13.2]], { widthMm: 0.2 }),
      ],
    });

    expect(buildDrcItems(p).maxCreepageBoundMm).toBe(Infinity);

    assertModeIdentity(p, "NaN-voltage class, finite 800V pair");

    const gridCodes = runDrc(p).violations.map((v) => v.code);
    const exhaustiveCodes = runDrc(p, { broadPhase: "exhaustive" }).violations.map(
      (v) => v.code,
    );
    expect(gridCodes).toContain("CREEPAGE_DISTANCE");
    expect(exhaustiveCodes).toContain("CREEPAGE_DISTANCE");
  });

  test("multi-shape pin inside a pads-forbidden keepout: reversing the footprint's pads array (Astra A2 #2)", () => {
    // An inherited determinism hole in `finalizeReport`'s unmeasured-draft
    // merge, now fixed: the survivor keeps the SMALLER `locationMm` — two
    // shapes of one pin (pad number "1" at (0,0) and (2,0), both inside a
    // `pads: true` keepout) must report the identical `KEEPOUT_VIOLATION`
    // regardless of which shape's draft the footprint's `pads` array put
    // first.
    const buildPads = (reversedOrder: boolean) => {
      const shapes = [
        pad("1", { x: 0, y: 0 }, 0.5, 0.5),
        pad("1", { x: 2, y: 0 }, 0.5, 0.5),
      ];
      return reversedOrder ? [...shapes].reverse() : shapes;
    };
    const build = (reversedOrder: boolean): DesignerPcbProjection =>
      projection({
        board: board(),
        netNames: NETS,
        placements: [placement("U1", { pads: buildPads(reversedOrder) })],
        padNets: { "U1|1": "a" },
        keepouts: [
          {
            id: "k1",
            name: "K1",
            enabled: true,
            lockedAt: null,
            layers: ["F.Cu"],
            pointsMm: [
              { x: -2, y: -2 },
              { x: 4, y: -2 },
              { x: 4, y: 2 },
              { x: -2, y: 2 },
            ],
            restrictions: {
              tracks: false,
              vias: false,
              pads: true,
              copperPour: false,
              footprints: false,
            },
          },
        ],
      });

    const forward = build(false);
    const reversedPads = build(true);

    assertModeIdentity(forward, "multi-shape pin in keepout, forward pad order");
    assertModeIdentity(reversedPads, "multi-shape pin in keepout, reversed pad order");

    expect(JSON.stringify(runDrc(forward))).toBe(JSON.stringify(runDrc(reversedPads)));
    expect(
      JSON.stringify(runDrc(forward, { broadPhase: "exhaustive" })),
    ).toBe(JSON.stringify(runDrc(reversedPads, { broadPhase: "exhaustive" })));
  });

  test("hole outside the board, far from every edge (HOLE_OFF_BOARD gap in both modes)", () => {
    const b = board();
    const halfW = b.outline.kind === "rect" ? b.outline.widthMm / 2 : 25;
    const p = projection({
      board: b,
      netNames: NETS,
      freeHoles: [freeHole("h1", { x: halfW + 50, y: 0 }, 0.6)],
    });
    const gridReport = runDrc(p);
    const exhaustiveReport = runDrc(p, { broadPhase: "exhaustive" });
    const gridV = gridReport.violations.find((v) => v.code === "HOLE_OFF_BOARD");
    const exhaustiveV = exhaustiveReport.violations.find(
      (v) => v.code === "HOLE_OFF_BOARD",
    );
    expect(gridV).toBeDefined();
    expect(exhaustiveV).toBeDefined();
    expect(gridV!.measuredMm).toBe(exhaustiveV!.measuredMm);
    assertModeIdentity(p, "hole far off board");
  });

  test("two overlapping holes", () => {
    const p = projection({
      board: board(),
      netNames: NETS,
      freeHoles: [
        freeHole("h1", { x: 0, y: 0 }, 1),
        freeHole("h2", { x: 0.2, y: 0 }, 1),
      ],
    });
    assertModeIdentity(p, "overlapping holes");
  });

  test("a slot outside the board", () => {
    const b = board();
    const halfW = b.outline.kind === "rect" ? b.outline.widthMm / 2 : 25;
    const h = freeHole("slot1", { x: halfW + 30, y: 0 }, 0.6);
    h.drillSlot = { lengthMm: 3, widthMm: 0.6, angleDeg: 0 };
    const p = projection({ board: b, netNames: NETS, freeHoles: [h] });
    assertModeIdentity(p, "slot outside the board");
  });

  test("a one-point trace inside a keepout", () => {
    const p: DesignerPcbProjection = {
      ...projection({ board: board(), netNames: NETS }),
      traces: [trace("pt", "a", [[0, 0]], { widthMm: 0.3 })],
      keepouts: [
        {
          id: "k1",
          name: "K1",
          enabled: true,
          lockedAt: null,
          layers: ["F.Cu"],
          pointsMm: [
            { x: -3, y: -3 },
            { x: 3, y: -3 },
            { x: 3, y: 3 },
            { x: -3, y: 3 },
          ],
          restrictions: {
            tracks: true,
            vias: true,
            pads: true,
            copperPour: true,
            footprints: false,
          },
        },
      ],
    };
    assertModeIdentity(p, "one-point trace inside a keepout");
  });

  test("a whole board translated to x ~= 1e6 mm", () => {
    const OFFSET = 1_000_000;
    const base = boardWithRules({
      outline: {
        kind: "rect",
        widthMm: 50,
        heightMm: 30,
        centerMm: { x: OFFSET, y: 0 },
      },
    });
    const p = projection({
      board: base,
      netNames: NETS,
      traces: [
        trace("t1", "a", [
          [OFFSET - 5, 0],
          [OFFSET + 5, 0],
        ]),
        trace("t2", "b", [
          [OFFSET - 5, 0.1],
          [OFFSET + 5, 0.1],
        ]),
      ],
    });
    assertModeIdentity(p, "board translated near 1e6 mm");
  });

  test("positive null-net bridge and a replaces event, in both modes", () => {
    // An unassigned board trace ("n1") end-touches two named board traces
    // ("ba" on net a, ending where n1 starts) — the pending trace on net "b"
    // then bridges through n1's unassigned copper (07 §4 pattern).
    const p = projection({
      board: board(),
      netNames: NETS,
      traces: [
        trace("ba", "a", [[0, 0], [4, 0]]),
        trace("n1", null, [[4, 0], [6, 0]]),
      ],
    });
    const ctxGrid = buildDrcItems(p);
    const ctxExhaustive = buildDrcItems(p, { broadPhase: "exhaustive" });

    const pending: PendingCopper = {
      traces: [trace("p1", "b", [[6, 0], [10, 0]])],
      vias: [],
    };

    const gridViolations = checkPendingCopper(ctxGrid, pending);
    const exhaustiveViolations = checkPendingCopper(ctxExhaustive, pending);
    expect(JSON.stringify(gridViolations)).toBe(
      JSON.stringify(exhaustiveViolations),
    );
    expect(
      gridViolations.map((v) => v.code),
      "expected the positive bridge to fire NET_SHORT_CIRCUIT",
    ).toContain("NET_SHORT_CIRCUIT");

    // A `replaces` event: the pending copper supersedes the bridge item
    // itself, excluded from both sides — same board item, same result in
    // both modes.
    const gridReplaces = checkPendingCopper(ctxGrid, pending, {
      replaces: ["n1"],
    });
    const exhaustiveReplaces = checkPendingCopper(ctxExhaustive, pending, {
      replaces: ["n1"],
    });
    expect(JSON.stringify(gridReplaces)).toBe(
      JSON.stringify(exhaustiveReplaces),
    );
  });

  test("two drafts with one id, different witnesses (two shapes of one pin vs one trace)", () => {
    // The data model DOES express two shapes of one pin (WP4 R2 correction
    // of the earlier "over-literal for this data model" comment): a
    // placement's `pads` array simply carries two `FootprintRenderSourcePad`
    // entries with the SAME `number` — `anchorKey` hashes a pad anchor on
    // `{placementId, padNumber}` alone, so both shapes are ONE logical
    // anchor with two `DrcPad` geometries. Both shapes sit close to an
    // HV-classed trace: `CREEPAGE_DISTANCE` is NOT location-hashed
    // (`violation-id.ts` `LOCATION_HASHED_CODES`), so its id depends only on
    // the (pad, trace) anchor pair and BOTH shapes' drafts collapse to one id
    // regardless of witness location; `TRACE_TO_PAD_CLEARANCE` IS
    // location-hashed (0.1mm bucket), so the two shapes are placed within
    // 0.1mm of each other so their witnesses land in the same bucket too.
    const b = boardWithRules({
      clearance: { traceToPadMm: 0.3 },
      netClasses: [
        {
          id: "hvA",
          name: "HV-A",
          traceWidthMm: 0.3,
          clearanceMm: 0.1,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          color: "#f00",
          defaultViaProtection: "tented",
          voltageV: 0,
        },
        {
          id: "hvB",
          name: "HV-B",
          traceWidthMm: 0.3,
          clearanceMm: 0.1,
          viaDiameterMm: 0.8,
          viaDrillMm: 0.4,
          color: "#00f",
          defaultViaProtection: "tented",
          voltageV: 400,
        },
      ],
    });
    b.perNetClassAssignments = { a: "hvA", b: "hvB" };
    const p = projection({
      board: b,
      netNames: NETS,
      placements: [
        placement("U1", {
          pads: [
            pad("1", { x: 0, y: 0 }, 1, 1),
            // A second shape under the SAME pad number, offset 0.03/0.02mm —
            // a different measured gap to the trace, same 0.1mm location
            // bucket.
            pad("1", { x: 0.03, y: 0.02 }, 1.4, 1),
          ],
        }),
      ],
      padNets: { "U1|1": "a" },
      traces: [trace("t1", "b", [[-5, 0.65], [5, 0.65]], { widthMm: 0.2 })],
    });

    // Pre-finalise: two shapes -> (at least) two drafts per code, different
    // `measuredMm`, surviving identically in both modes.
    const gridDrafts = drcDrafts(p, {});
    const creepageDrafts = gridDrafts.filter((d) => d.code === "CREEPAGE_DISTANCE");
    const clearanceDrafts = gridDrafts.filter(
      (d) => d.code === "TRACE_TO_PAD_CLEARANCE",
    );
    expect(
      creepageDrafts.length,
      "expected two CREEPAGE_DISTANCE drafts (one per pad shape)",
    ).toBeGreaterThanOrEqual(2);
    expect(
      clearanceDrafts.length,
      "expected two TRACE_TO_PAD_CLEARANCE drafts (one per pad shape)",
    ).toBeGreaterThanOrEqual(2);
    expect(
      new Set(creepageDrafts.map((d) => d.measuredMm)).size,
      "the two shapes' witnesses should measure differently",
    ).toBeGreaterThanOrEqual(2);

    assertModeIdentity(p, "duplicate pad number, two witnesses");

    // Post-finalise: exactly one violation per code for this anchor pair —
    // the worse-witness collapse (`finalizeReport`) is doing its job.
    const report = runDrc(p);
    const forAnchorPair = (code: string) =>
      report.violations.filter(
        (v) =>
          v.code === code &&
          v.anchors.some((a) => a.kind === "pad" && a.padNumber === "1"),
      );
    expect(forAnchorPair("CREEPAGE_DISTANCE").length).toBe(1);
    expect(forAnchorPair("TRACE_TO_PAD_CLEARANCE").length).toBe(1);
  });

  test("near-edge PIP case (Astra A1 #3 constructed ring)", () => {
    const bigA = { x: -8e9, y: -8e9 };
    // Contract 08 §2.2 / §11 states 8_000_000_051, not 8_000_000.51 — off by
    // 1000x (WP4 R2 finding).
    const bigB = { x: 8e9, y: 8_000_000_051 };
    const bigC = { x: 8e9, y: -8e9 };
    const p = projection({
      board: boardWithRules({
        outline: {
          kind: "polygon",
          widthMm: 1.6e10,
          heightMm: 1.6e10,
          centerMm: { x: 0, y: 0 },
          pointsMm: [bigA, bigB, bigC],
        },
      }),
      netNames: NETS,
      vias: [via("v1", { netId: "a", center: { x: -225.5, y: -200 } })],
    });
    // This is an extreme-coordinate outline; the point is that grid and
    // exhaustive PIP agree bit for bit, not that the report is meaningful.
    assertModeIdentity(p, "near-edge PIP case");
  });
});

// --- mutation check: proves the oracle is live (contract 08 §7) -------------

describe("oracle: mutation check (the harness bites)", () => {
  test("a halved clearance halo drops real pairs — strict subset of the true draft set", () => {
    // A dense background board, PLUS one deliberately engineered pair whose
    // gap sits strictly between `bound / 2` and `bound`: an area-tightening
    // rule pushes the pair's ACTUAL required clearance to 0.9mm (which also
    // dominates `maxClearanceBoundMm`, since it is the largest term the bound
    // maxes over), so a 0.7mm gap is a real violation (0.7 < 0.9) but is
    // ABOVE half the bound (0.7 > 0.45) — exactly the pair the contract
    // promises exists (08 §7 "the corpus contains pairs between halo/2 and
    // halo"), so halving the halo must drop it.
    const background = synthesizeBoard({ seed: 999, items: 800 });
    const dense: DesignerPcbProjection = {
      ...background,
      board: {
        ...background.board,
        drcRules: [
          ...(background.board.drcRules ?? []),
          {
            id: "mutation-tighten",
            name: "Mutation tighten",
            enabled: true,
            priority: 100,
            scopes: [
              {
                kind: "area",
                polygonMm: [
                  { x: -10, y: -10 },
                  { x: 10, y: -10 },
                  { x: 10, y: 10 },
                  { x: -10, y: 10 },
                ],
              },
            ],
            constraint: { kind: "clearance", mm: 0.9 },
          },
        ],
      },
      netNames: { ...background.netNames, mut1: "MUT1", mut2: "MUT2" },
      traces: [
        ...background.traces,
        trace("mut-a", "mut1", [[-5, 0], [5, 0]], { widthMm: 0.2 }),
        trace("mut-b", "mut2", [[-5, 0.9], [5, 0.9]], { widthMm: 0.2 }),
      ],
    };
    const ctx = buildDrcItems(dense);

    // `judgeCopperPairs(ctx, subjects, others, …)` ALSO calls
    // `judgeWithinSubjects` unconditionally (an exhaustive, halo-free i<j
    // scan over `subjects` itself) — passing the WHOLE board as both
    // `subjects` and `others` would run that full self-pairing path and mask
    // any halo mutation entirely. The halo only gates the SUBJECT-vs-OTHERS
    // traversal, so the subject here is the one deliberate trace (`mut-a`,
    // the live/server-gate shape: one pending item vs. the board) and
    // `others` is the (buggy) whole-board context.
    const mutA = ctx.traces.find((t) => t.id === "mut-a")!;
    const subjects = { traces: [mutA], pads: [], vias: [] };

    const correctOut: DrcViolationDraft[] = [];
    judgeCopperPairs(ctx, subjects, ctx, { out: correctOut });

    // Deliberately wrong: halve the one halo the grid query trusts. If the
    // grid ever queried with a halo this broken, this proves the oracle
    // (drafts equality) would catch it — the corpus contains real pairs
    // between halo/2 and halo.
    const buggyCtx = { ...ctx, maxClearanceBoundMm: ctx.maxClearanceBoundMm / 2 };
    const wrongOut: DrcViolationDraft[] = [];
    judgeCopperPairs(buggyCtx, subjects, buggyCtx, { out: wrongOut });

    const key = (d: DrcViolationDraft) => JSON.stringify(d);
    const correctSet = new Set(correctOut.map(key));
    const wrongSet = new Set(wrongOut.map(key));

    for (const k of wrongSet) {
      expect(correctSet.has(k), "wrong draft not present in the correct set").toBe(
        true,
      );
    }
    expect(
      wrongSet.size,
      "halving the halo did not drop anything — fixture is not dense enough " +
        "to exercise the mutation (pairs between halo/2 and halo are required)",
    ).toBeLessThan(correctSet.size);
  });

  test("a halved halo, threaded through the BATCH checks, produces strictly fewer drafts (WP4 R2 item 12)", () => {
    // Extends the mutation check beyond `judgeCopperPairs` to the batch
    // enumerations themselves — `checkClearance`, `checkBoard`,
    // `checkCopperToHole` (every check that queries `ctx.near` /
    // `ctx.nearPolyline` with an explicit halo argument; NOT `checkKeepouts`,
    // which always queries with `haloMm: 0` — halving 0 changes nothing, so it
    // is excluded on purpose, and NOT `checkElectrical`, which since S13 has no
    // enumeration at all: the IPC-2221 spacing verdict is a constituent of
    // `checkClearance`'s pair judge and the current verdict is per item).
    // For each check, a COPY
    // of the grid context whose `near` / `nearPolyline` silently halve every
    // requested halo before delegating to the real ones — every check still
    // reads its own (unhalved) `ctx.maxClearanceBoundMm` etc. to decide WHAT
    // halo to pass, so this is a pure candidate-discovery mutation, not a
    // halo-computation one (matching R2's probe construction,
    // `scratchpad/s9/r2/probe-mutation2.ts`).
    //
    // WHICH board shows a strict drop is check- and board-density-dependent
    // (a check with too few marginal pairs on one board shows none — that is
    // not a harness bug, the corpus just did not happen to contain one THERE)
    // — so this scans the corpus (bounded to items <= 1500 for time) and
    // requires at least one board per check to demonstrate the drop, exactly
    // like the per-kind "strictly cheaper" stats test above.
    const CHECKS: ReadonlyArray<
      [string, (ctx: Parameters<typeof checkClearance>[0]) => DrcViolationDraft[]]
    > = [
      ["checkClearance", checkClearance],
      ["checkBoard", checkBoard],
      ["checkCopperToHole", checkCopperToHole],
    ];
    const demonstrated = new Set<string>();

    for (const entry of SYNTHETIC_CORPUS.filter((e) => e.opts.items <= 1500)) {
      const p = synthesizeBoard(entry.opts);
      const exhaustiveCtx = buildDrcContext(p, { broadPhase: "exhaustive" });
      const gridCtx = buildDrcContext(p, {});

      const near = gridCtx.near;
      const nearPolyline = gridCtx.nearPolyline;
      const buggyCtx = {
        ...gridCtx,
        near: (kind: Parameters<typeof near>[0], bounds: Parameters<typeof near>[1], haloMm: number) =>
          near(kind, bounds, haloMm / 2),
        nearPolyline: (
          kind: Parameters<typeof nearPolyline>[0],
          pointsMm: Parameters<typeof nearPolyline>[1],
          halfWidthMm: number,
          haloMm: number,
        ) => nearPolyline(kind, pointsMm, halfWidthMm, haloMm / 2),
      } as unknown as Parameters<typeof checkClearance>[0];

      for (const [name, fn] of CHECKS) {
        const exhaustive = sortedDraftsJson(fn(exhaustiveCtx));
        const grid = fn(gridCtx);
        const gridJson = sortedDraftsJson(grid);
        expect(exhaustive, `${entry.name} ${name}: grid != exhaustive before mutation`).toBe(
          gridJson,
        );
        const buggy = fn(buggyCtx);
        // Subset property always holds, whether or not this board happens to
        // demonstrate a strict drop for this check.
        const gridSet = new Set(gridJson.split("\n"));
        for (const d of buggy) {
          expect(
            gridSet.has(JSON.stringify(d)),
            `${entry.name} ${name}: a halved-halo draft is not in the true set`,
          ).toBe(true);
        }
        if (buggy.length < grid.length) demonstrated.add(name);
      }
    }

    const notDemonstrated = CHECKS.map(([name]) => name).filter(
      (name) => !demonstrated.has(name),
    );
    expect(
      notDemonstrated,
      `no corpus board demonstrated a halved-halo drop for: ${notDemonstrated.join(", ")}`,
    ).toEqual([]);
  }, 30_000);
});
