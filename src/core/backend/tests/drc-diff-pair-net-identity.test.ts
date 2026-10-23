import { describe, expect, test } from "bun:test";
import type { PcbDiffPair } from "../../../sdks/designer";
import { runDrc } from "../../../shared/drc/drc-engine";
import { resolveDiffPairsFull } from "../../../shared/drc/diff-pair-resolver";
import { board, pad, placement, projection, trace } from "./helpers/drc-fixtures";

const PAIR: PcbDiffPair = {
  id: "pair", name: "Data", pNetId: "p", nNetId: "n", gapMm: 0.2,
  maxSkewMm: 0, maxUncoupledMm: 0,
};

function report(pairs: PcbDiffPair[], netNames: Record<string, string>) {
  return runDrc(projection({ board: board({ diffPairs: pairs }), netNames })).violations
    .filter((row) => row.code === "DRC_RULE_INEFFECTIVE" || row.code.startsWith("DIFF_PAIR_"));
}

describe("explicit differential pairs require live schematic net IDs", () => {
  test("one missing member is refused without inference fallback", () => {
    const result = resolveDiffPairsFull([PAIR], { p: "Data_P", replacement: "Data_N" });
    expect(result.pairs).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ reason: "unknown-net", ids: ["pair"], name: "Data", missingNetIds: ["n"] });
    expect(report([PAIR], { p: "Data_P", replacement: "Data_N" })).toMatchObject([{
      code: "DRC_RULE_INEFFECTIVE",
      message: "Diff pair Data has no effect: net n no longer exists. Rebind or remove it.",
    }]);
  });

  test("both missing members share one row with sorted IDs and stable polarity", () => {
    const pair = { ...PAIR, pNetId: "z-missing", nNetId: "a-missing" };
    const reversed = { ...pair, pNetId: pair.nNetId, nNetId: pair.pNetId };
    const before = structuredClone(pair), rows = report([pair], {});
    expect(resolveDiffPairsFull([pair], {}).conflicts[0]).toMatchObject({ missingNetIds: ["a-missing", "z-missing"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.message).toBe("Diff pair Data has no effect: nets a-missing, z-missing no longer exist. Rebind or remove it.");
    expect(report([reversed], {})).toEqual(rows);
    expect(pair).toEqual(before);
  });

  test("table reversal preserves unknown-row violations and stable anchors", () => {
    const pairs = [PAIR, { ...PAIR, id: "second", name: "Other", pNetId: "x", nNetId: "y" }];
    const before = structuredClone(pairs), rows = report(pairs, { p: "Known" });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(report([...pairs].reverse(), { p: "Known" })).toEqual(rows);
    expect(pairs).toEqual(before);
  });

  test("inherited object properties are not active nets", () => {
    const names = Object.assign(Object.create({ n: "Data_N" }) as Record<string, string>, { p: "Data_P" });
    expect(resolveDiffPairsFull([PAIR], names).pairs).toEqual([]);
    expect(resolveDiffPairsFull([PAIR], names).conflicts[0]).toMatchObject({ reason: "unknown-net", missingNetIds: ["n"] });
    expect(resolveDiffPairsFull([{ ...PAIR, nNetId: "constructor" }], { p: "Data_P" }).pairs).toEqual([]);
  });

  test("present unnamed or unrouted nets remain legitimate", () => {
    const names = { p: "", n: "Current unnamed net" };
    expect(resolveDiffPairsFull([PAIR], names)).toMatchObject({ pairs: [PAIR], conflicts: [] });
    expect(report([PAIR], names)).toEqual([]);
  });

  test("missing self-pairs retain structural-invalid priority", () => {
    const pair = { ...PAIR, nNetId: "p" };
    expect(resolveDiffPairsFull([pair], {}).conflicts.map((row) => row.reason)).toEqual(["self-pair"]);
    const rows = runDrc(projection({ board: board({ diffPairs: [pair] }), netNames: {} })).violations;
    expect(rows.filter((row) => row.code === "DRC_RULE_INVALID")).toHaveLength(1);
    expect(rows.filter((row) => row.code === "DRC_RULE_INEFFECTIVE")).toEqual([]);
  });

  test("orphan copper carrying the missing ID cannot restore pair validity", () => {
    const terminals: Array<[string, number, number]> = [["p0", 0, 0], ["p1", 20, 0], ["n0", 0, 0.35], ["n1", 10, 0.35]];
    const scene = projection({
      board: board({ diffPairs: [PAIR] }), netNames: { p: "Data_P" },
      placements: terminals.map(([id, x, y]) =>
        placement(id, { positionMm: { x, y }, pads: [pad("1", { x: 0, y: 0 }, 0.2, 0.2)] })),
      padNets: { "p0|1": "p", "p1|1": "p", "n0|1": "n", "n1|1": "n" },
      traces: [trace("p-trace", "p", [[0, 0], [20, 0]]), trace("n-trace", "n", [[0, 0.35], [10, 0.35]])],
    });
    const rows = runDrc(scene).violations;
    expect(rows.filter((row) => row.code === "DRC_RULE_INEFFECTIVE")).toMatchObject([{
      message: "Diff pair Data has no effect: net n no longer exists. Rebind or remove it.",
    }]);
    expect(rows.filter((row) => row.code.startsWith("DIFF_PAIR_"))).toEqual([]);
  });
});
