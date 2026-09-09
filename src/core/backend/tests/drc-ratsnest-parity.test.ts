/**
 * Loader-vs-engine ratsnest parity (batch-DRC contract 06 §1, D7). D7 split
 * `computeRatsnest` into `ratsnestFromConnectivity` (the MST half) + its own
 * connectivity run, so `checks/connectivity.ts` can run the MST over the
 * SAME connectivity result the rest of the DRC run reasons about, instead of
 * re-running the kernel a second time. This test proves the split changed
 * nothing observable: for every golden fixture, the loader's
 * `fixtureToProjection(fixture).ratsnest` (which calls `computeRatsnest`, the
 * ORIGINAL kernel-plus-MST path) deep-equals the engine's own derivation —
 * `ratsnestFromConnectivity` called on `buildDrcContext(projection)` exactly
 * as `checks/connectivity.ts` calls it.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import * as path from "node:path";
import { buildDrcContext } from "../../../modules/designer/backend/drc/drc-context";
import {
  ratsnestFromConnectivity,
  ratsnestNetIds,
} from "../../../modules/designer/backend/pcb/ratsnest";
import type { RatsnestSegment } from "../../../sdks/designer";
import { fixtureToProjection } from "./helpers/drc-golden";

const GOLDEN_DIR = path.resolve(import.meta.dir, "fixtures/drc/golden");

const goldens = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
  .sort();

/** Sort key matching the brief: (netId, from, to). */
function sortKey(seg: RatsnestSegment): string {
  return JSON.stringify([seg.netId, seg.from, seg.to]);
}

function sorted(segs: readonly RatsnestSegment[]): RatsnestSegment[] {
  return [...segs].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
}

describe("DRC ratsnest parity — loader vs engine", () => {
  test("corpus is non-empty", () => {
    expect(goldens.length).toBeGreaterThanOrEqual(1);
  });

  for (const file of goldens) {
    const name = file.replace(/\.json$/, "");
    test(`${name}: loader ratsnest equals the engine's derivation`, async () => {
      const fixture = JSON.parse(
        await Bun.file(path.join(GOLDEN_DIR, file)).text(),
      );
      // The loader path: computeRatsnest, exactly as loadPcbProjection wires
      // it — only reachable when the fixture asks `computeRatsnest: true`
      // (drc-golden.ts helper), which every golden fixture does.
      const projection = fixtureToProjection({ ...fixture, computeRatsnest: true });
      const loaderRatsnest = projection.ratsnest;

      // The engine path: exactly checks/connectivity.ts's call.
      const ctx = buildDrcContext(projection);
      const padNetIds = new Map(Object.entries(projection.padNets ?? {}));
      const engineRatsnest = ratsnestFromConnectivity({
        items: ctx.copperItems(),
        result: ctx.connectivity(),
        records: ctx.copperRecords,
        netNames: new Map(Object.entries(ctx.netNames)),
        netClasses: ctx.netClasses,
        ...(projection.board.perNetClassAssignments !== undefined
          ? { perNetClassAssignments: projection.board.perNetClassAssignments }
          : {}),
        netIds: ratsnestNetIds({
          padNetIds,
          freePads: projection.freePads,
        }),
      });

      expect(sorted(engineRatsnest)).toEqual(sorted(loaderRatsnest));
    });
  }
});
