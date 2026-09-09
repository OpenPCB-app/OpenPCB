#!/usr/bin/env bun
// DRC broad-phase bench (contract 08 §7) — per-check timing and enumeration
// stats, grid vs exhaustive, on the seeded synthetic generator (or a golden).
// Run from the repo root:
//
//   bun scripts/drc-bench.ts --items 1000 --items 10000
//   bun scripts/drc-bench.ts --items 5000 --mode grid --seed 7
//   bun scripts/drc-bench.ts --golden census
//
// Args: --items N (repeatable; default 1000 5000 10000 20000), --seed
// (default 12345), --mode grid|exhaustive|both (default both), --cell
// (bench-only broad-phase cell size — IGNORED: `buildDrcItems`/`buildDrcContext`
// do not currently expose a `cellMm` option, only `createBroadPhase` itself
// does; noted, not wired), --golden NAME (times the named golden fixture
// instead of / in addition to the synthetic sizes).
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { buildDrcContext, buildDrcItems } from "../src/shared/drc/drc-context";
import { checkBoard } from "../src/shared/drc/checks/board";
import { checkClearance } from "../src/shared/drc/checks/clearance";
import { checkCopperToHole } from "../src/shared/drc/checks/copper-to-hole";
import { checkElectrical } from "../src/shared/drc/checks/electrical";
import { checkKeepouts } from "../src/shared/drc/checks/keepouts";
import { runDrc } from "../src/shared/drc/drc-engine";
import { createDrcRunStats, type DrcBroadPhaseMode } from "../src/shared/drc/types";
import type { DesignerPcbProjection } from "../src/sdks/designer";
import { synthesizeBoard } from "../src/core/backend/tests/helpers/drc-synthetic";
import { fixtureToProjection } from "../src/core/backend/tests/helpers/drc-golden";

// --- args --------------------------------------------------------------------

function parseArgs(argv: string[]): {
  items: number[];
  seed: number;
  modes: DrcBroadPhaseMode[];
  cell: number | undefined;
  golden: string | undefined;
} {
  const items: number[] = [];
  let seed = 12345;
  let modeArg = "both";
  let cell: number | undefined;
  let golden: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--items") items.push(Number(argv[++i]));
    else if (a === "--seed") seed = Number(argv[++i]);
    else if (a === "--mode") modeArg = String(argv[++i]);
    else if (a === "--cell") cell = Number(argv[++i]);
    else if (a === "--golden") golden = String(argv[++i]);
  }
  const modes: DrcBroadPhaseMode[] =
    modeArg === "grid"
      ? ["grid"]
      : modeArg === "exhaustive"
        ? ["exhaustive"]
        : ["grid", "exhaustive"];
  return {
    items: items.length > 0 ? items : [1000, 5000, 10000, 20000],
    seed,
    modes,
    cell,
    golden,
  };
}

// --- timing --------------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Median of 3 wall-clock reps (ms). */
function timeMs(fn: () => void): number {
  const reps = [0, 0, 0].map(() => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  });
  return median(reps);
}

interface Row {
  label: string;
  mode: DrcBroadPhaseMode;
  buildDrcItemsMs: number;
  buildDrcContextMs: number;
  checkClearanceMs: number;
  checkBoardMs: number;
  checkCopperToHoleMs: number;
  checkKeepoutsMs: number;
  checkElectricalMs: number;
  connectivityMs: number;
  runDrcMs: number;
  prefilterTests: number;
  pairsJudgedTotal: number;
  edgeTests: number;
}

function benchProjection(
  label: string,
  p: DesignerPcbProjection,
  mode: DrcBroadPhaseMode,
): Row {
  const opts = mode === "grid" ? {} : { broadPhase: mode as const };

  const buildDrcItemsMs = timeMs(() => {
    buildDrcItems(p, opts);
  });
  const buildDrcContextMs = timeMs(() => {
    buildDrcContext(p, opts);
  });

  // The context is built ONCE, outside every check's timer (WP4 R2 item 7:
  // the previous version rebuilt it inside each `timeMs` closure, so every
  // per-check column above was secretly `buildDrcContext + check`, not the
  // check alone). Every check function is a pure read over `ctx` — no check
  // mutates or memoizes anything on it — so reusing this ONE context across
  // all 3 timing reps is exactly "time the check alone".
  const ctx = buildDrcContext(p, opts);
  const checkClearanceMs = timeMs(() => {
    checkClearance(ctx);
  });
  const checkBoardMs = timeMs(() => {
    checkBoard(ctx);
  });
  const checkCopperToHoleMs = timeMs(() => {
    checkCopperToHole(ctx);
  });
  const checkKeepoutsMs = timeMs(() => {
    checkKeepouts(ctx);
  });
  const checkElectricalMs = timeMs(() => {
    checkElectrical(ctx);
  });
  // `connectivity()` MEMOIZES on the context (unlike every check above), so
  // reusing one `ctx` across reps would time a cold call once and two
  // free cache hits — a fresh context per rep keeps this one meaningful.
  const connectivityMs = median(
    [0, 0, 0].map(() => {
      const t0 = performance.now();
      buildDrcContext(p, opts).connectivity();
      return performance.now() - t0;
    }),
  );
  const runDrcMs = timeMs(() => {
    runDrc(p, opts);
  });

  const stats = createDrcRunStats();
  runDrc(p, { ...opts, stats });
  const pairsJudgedTotal = Object.values(stats.pairsJudged).reduce(
    (a, b) => a + b,
    0,
  );

  return {
    label,
    mode,
    buildDrcItemsMs,
    buildDrcContextMs,
    checkClearanceMs,
    checkBoardMs,
    checkCopperToHoleMs,
    checkKeepoutsMs,
    checkElectricalMs,
    connectivityMs,
    runDrcMs,
    prefilterTests: stats.prefilterTests,
    pairsJudgedTotal,
    edgeTests: stats.edgeTests,
  };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function printTable(rows: Row[]): void {
  const header = [
    "board",
    "mode",
    "buildDrcItems (ms)",
    "buildDrcContext (ms)",
    "checkClearance (ms)",
    "checkBoard (ms)",
    "checkCopperToHole (ms)",
    "checkKeepouts (ms)",
    "checkElectrical (ms)",
    "connectivity() (ms)",
    "runDrc (ms)",
  ];
  console.log(`| ${header.join(" | ")} |`);
  console.log(`| ${header.map(() => "---").join(" | ")} |`);
  for (const r of rows) {
    console.log(
      `| ${r.label} | ${r.mode} | ${fmt(r.buildDrcItemsMs)} | ${fmt(
        r.buildDrcContextMs,
      )} | ${fmt(r.checkClearanceMs)} | ${fmt(r.checkBoardMs)} | ${fmt(
        r.checkCopperToHoleMs,
      )} | ${fmt(r.checkKeepoutsMs)} | ${fmt(r.checkElectricalMs)} | ${fmt(
        r.connectivityMs,
      )} | ${fmt(r.runDrcMs)} |`,
    );
  }
  console.log();
  console.log("Stats counters:");
  console.log("| board | mode | prefilterTests | pairsJudged (total) | edgeTests |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const r of rows) {
    console.log(
      `| ${r.label} | ${r.mode} | ${r.prefilterTests} | ${r.pairsJudgedTotal} | ${r.edgeTests} |`,
    );
  }
}

// --- main ------------------------------------------------------------------

function main(): void {
  const { items, seed, modes, cell, golden } = parseArgs(process.argv.slice(2));
  if (cell !== undefined) {
    console.log(
      `[drc-bench] --cell ${cell} ignored: buildDrcItems/buildDrcContext do not ` +
        "expose a cellMm option (only createBroadPhase itself does; contract " +
        "08 §7 lists it as a knob \"if WP2 exposed the option\" — it did not " +
        "thread one through the context builder).",
    );
  }

  const rows: Row[] = [];

  for (const n of items) {
    const p = synthesizeBoard({
      seed,
      items: n,
      longDiagonals: true,
      hvNets: true,
    });
    for (const mode of modes) {
      rows.push(benchProjection(`synthetic ${n}`, p, mode));
    }
  }

  if (golden) {
    const GOLDEN_DIR = path.resolve(import.meta.dir, "../src/core/backend/tests/fixtures/drc/golden");
    const file = `golden-${golden}-2l.json`;
    const fixture = JSON.parse(readFileSync(path.join(GOLDEN_DIR, file), "utf8"));
    const p = fixtureToProjection(fixture);
    for (const mode of modes) {
      rows.push(benchProjection(`golden ${golden}`, p, mode));
    }
  }

  printTable(rows);
}

main();
