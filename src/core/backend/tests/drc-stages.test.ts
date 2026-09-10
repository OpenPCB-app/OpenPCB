/**
 * Execution contract 09 §6 — the engine's checkpoint seam.
 *
 * `drcDrafts` runs the exported `DRC_STAGES` table in order and calls
 * `options.tick` before every stage; the context calls it before every pour
 * zone. The seam is results-neutral: a run with a tick produces the same
 * drafts and the same report bytes as a run without one, in both broad-phase
 * modes. The stage LIST is pinned on its own because the report is canonical
 * (06 §6) — a reorder of two checks with disjoint codes would still pass a
 * bytes comparison.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { buildDrcItems } from "../../../shared/drc/drc-context";
import {
  DRC_STAGES,
  drcDrafts,
  runDrc,
} from "../../../shared/drc/drc-engine";
import {
  DrcCancelledError,
  type DrcStage,
  type DrcTick,
} from "../../../shared/drc/types";
import { fixtureToProjection } from "./helpers/drc-golden";
import { synthesizeBoard } from "./helpers/drc-synthetic";

const GOLDEN_DIR = path.resolve(import.meta.dir, "fixtures/drc/golden");

const goldens = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
  .sort()
  .map((file) => ({
    name: file.replace(/\.json$/, ""),
    projection: fixtureToProjection(
      JSON.parse(readFileSync(path.join(GOLDEN_DIR, file), "utf8")),
    ),
  }));

const EXPECTED_STAGES: readonly Exclude<DrcStage, "pour">[] = [
  "rules",
  "outline",
  "zones",
  "constraints",
  "structural",
  "manufacturability",
  "netclass",
  "clearance",
  "copperToHole",
  "connectivity",
  "copperPour",
  "dangling",
  "electrical",
  "signalIntegrity",
  "length",
  "board",
  "keepouts",
];

interface TickRecord {
  stage: DrcStage;
  index: number;
  total: number;
  violationsSoFar: number | undefined;
}

function recordingTick(): { tick: DrcTick; ticks: TickRecord[] } {
  const ticks: TickRecord[] = [];
  const tick: DrcTick = (stage, index, total, violationsSoFar) => {
    ticks.push({ stage, index, total, violationsSoFar });
  };
  return { tick, ticks };
}

describe("DRC_STAGES", () => {
  test("is the pre-S10 check order, pinned by name", () => {
    expect(DRC_STAGES.map(([stage]) => stage)).toEqual([...EXPECTED_STAGES]);
    expect(new Set(DRC_STAGES.map(([, fn]) => fn)).size).toBe(
      EXPECTED_STAGES.length,
    );
    // The label→function pairing, not only the labels: swapping two labels
    // against their checks keeps the label list and the function set intact.
    expect(DRC_STAGES.map(([, fn]) => fn.name)).toEqual([
      "checkRules",
      "checkOutline",
      "checkZones",
      "checkConstraints",
      "checkStructural",
      "checkManufacturability",
      "checkNetClass",
      "checkClearance",
      "checkCopperToHole",
      "checkConnectivity",
      "checkCopperPour",
      "checkDangling",
      "checkElectrical",
      "checkSignalIntegrity",
      "checkLength",
      "checkBoard",
      "checkKeepouts",
    ]);
  });
});

describe("tick — stage checkpoints", () => {
  test("every golden ticks the 17 stages in order with a non-decreasing draft count", () => {
    expect(goldens.length).toBeGreaterThanOrEqual(6);
    for (const { name, projection } of goldens) {
      const { tick, ticks } = recordingTick();
      runDrc(projection, { tick });
      const stageTicks = ticks.filter((t) => t.stage !== "pour");
      expect(stageTicks.map((t) => t.stage)).toEqual([...EXPECTED_STAGES]);
      expect(stageTicks.map((t) => t.index)).toEqual(
        EXPECTED_STAGES.map((_, i) => i),
      );
      expect(stageTicks.every((t) => t.total === EXPECTED_STAGES.length)).toBe(
        true,
      );
      let last = -1;
      for (const t of stageTicks) {
        expect(typeof t.violationsSoFar).toBe("number");
        expect(t.violationsSoFar!).toBeGreaterThanOrEqual(last);
        last = t.violationsSoFar!;
      }
      // The first stage sees no drafts; the report holds at least the last count.
      expect(stageTicks[0]!.violationsSoFar).toBe(0);
      expect(name).toBeTruthy();
    }
  });

  test("a pour-bearing golden ticks every zone once, in order, inside the run", () => {
    const pours = goldens.find((g) => g.name === "golden-pours-2l");
    expect(pours).toBeDefined();
    const zones = buildDrcItems(pours!.projection).copperZones.length;
    expect(zones).toBeGreaterThanOrEqual(1);
    const { tick, ticks } = recordingTick();
    runDrc(pours!.projection, { tick });
    const pourTicks = ticks.filter((t) => t.stage === "pour");
    expect(pourTicks.map((t) => t.index)).toEqual(
      Array.from({ length: zones }, (_, i) => i),
    );
    expect(pourTicks.every((t) => t.total === zones)).toBe(true);
    // The pour runs lazily inside a stage, so its ticks sit strictly between
    // the first and the last stage tick.
    const first = ticks.findIndex((t) => t.stage === "pour");
    const lastStage = ticks.length - 1;
    expect(first).toBeGreaterThan(0);
    expect(ticks[lastStage]!.stage).not.toBe("pour");
  });

  test("a board without zones never ticks the pour stage", () => {
    // Every golden carries at least the board's own fill zone (03 §12), so the
    // zone-free board is the S9 synthetic one.
    const projection = synthesizeBoard({ seed: 1, items: 300 });
    expect(buildDrcItems(projection).copperZones.length).toBe(0);
    const { tick, ticks } = recordingTick();
    runDrc(projection, { tick });
    expect(ticks.some((t) => t.stage === "pour")).toBe(false);
    expect(ticks.filter((t) => t.stage !== "pour").length).toBe(
      EXPECTED_STAGES.length,
    );
  });
});

describe("tick — results-neutral", () => {
  test("drafts and report bytes are identical with and without a tick, in both modes", () => {
    for (const { projection } of goldens) {
      for (const broadPhase of ["grid", "exhaustive"] as const) {
        const plainDrafts = JSON.stringify(drcDrafts(projection, { broadPhase }));
        const tickedDrafts = JSON.stringify(
          drcDrafts(projection, { broadPhase, tick: () => {} }),
        );
        expect(tickedDrafts).toBe(plainDrafts);
        const plain = JSON.stringify(runDrc(projection, { broadPhase }));
        const ticked = JSON.stringify(
          runDrc(projection, { broadPhase, tick: () => {} }),
        );
        expect(ticked).toBe(plain);
      }
    }
  });
});

describe("tick — cancellation", () => {
  test("a tick that throws at stage k abandons the run with that error", () => {
    const census = goldens.find((g) => g.name === "golden-census-2l")!;
    for (const k of [0, 7, 16]) {
      const seen: DrcStage[] = [];
      const tick: DrcTick = (stage, index) => {
        seen.push(stage);
        if (stage !== "pour" && index === k) throw new DrcCancelledError();
      };
      expect(() => runDrc(census.projection, { tick })).toThrow(
        DrcCancelledError,
      );
      // Nothing after stage k ran.
      expect(seen.filter((s) => s !== "pour")).toEqual(
        EXPECTED_STAGES.slice(0, k + 1),
      );
    }
  });

  test("a throw inside the pour stage propagates too", () => {
    const pours = goldens.find((g) => g.name === "golden-pours-2l")!;
    const tick: DrcTick = (stage) => {
      if (stage === "pour") throw new DrcCancelledError("mid-pour");
    };
    expect(() => runDrc(pours.projection, { tick })).toThrow("mid-pour");
  });

  test("DrcCancelledError is distinguishable by name and instance", () => {
    const err = new DrcCancelledError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DrcCancelledError");
    expect(err.message).toBe("DRC run cancelled");
  });
});
