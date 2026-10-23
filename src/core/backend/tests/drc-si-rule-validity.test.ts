import { describe, expect, test } from "bun:test";
import type {
  DesignerPcbProjection,
  DrcRuleCode,
  DrcViolation,
  PcbDiffPair,
  PcbLengthMatchGroup,
} from "../../../sdks/designer";
import { buildDrcContext } from "../../../shared/drc/drc-context";
import { runDrc } from "../../../shared/drc/drc-engine";
import {
  board, freePad, pad, placement, projection, trace, via,
} from "./helpers/drc-fixtures";

const GROUP: PcbLengthMatchGroup = {
  id: "length",
  name: "Data bus",
  netIds: ["a"],
  target: { kind: "absolute", mm: 10 },
  toleranceMm: 0.3,
};
const PAIR: PcbDiffPair = {
  id: "pair",
  name: "Data pair",
  pNetId: "p",
  nNetId: "n",
  gapMm: 0.2,
};

function scene(
  groups: PcbLengthMatchGroup[] = [],
  pairs: PcbDiffPair[] = [],
): DesignerPcbProjection {
  return projection({
    board: board({
      fabricator: "custom",
      outline: {
        kind: "rect", widthMm: 100, heightMm: 100, centerMm: { x: 0, y: 0 },
      },
      lengthMatchGroups: groups,
      diffPairs: pairs,
    }),
  });
}

function routedScene(
  lengthsMm: number[],
  group: PcbLengthMatchGroup = GROUP,
): DesignerPcbProjection {
  const result = scene([group]);
  result.padNets = {};
  for (const [index, lengthMm] of lengthsMm.entries()) {
    const netId = group.netIds[index]!;
    const y = index * 3;
    // Half-millimetre pads remove exactly 0.5 mm from the route span.
    const end = lengthMm + 0.5;
    for (const [suffix, x] of [["start", 0], ["end", end]] as const) {
      const id = `${netId}-${suffix}`;
      result.placements.push(
        placement(id, {
          positionMm: { x, y },
          pads: [pad("1", { x: 0, y: 0 }, 0.5, 0.5)],
        }),
      );
      result.padNets[`${id}|1`] = netId;
    }
    result.traces.push(trace(netId, netId, [[0, y], [end, y]]));
    result.netNames![netId] = netId;
  }
  return result;
}

function rows(
  result: DesignerPcbProjection,
  code: DrcRuleCode,
): DrcViolation[] {
  return runDrc(result).violations.filter((row) => row.code === code);
}

describe("SI length tolerance boundaries", () => {
  test.each([
    [9.7, false],
    [10.3, false],
    [9.700001, false],
    [10.299999, false],
    [9.699999, false],
    [10.300001, false],
    [9.699998, true],
    [10.300002, true],
  ])("absolute routed length %s mm respects the 1 nm grace", (lengthMm, violation) => {
    const result = routedScene([lengthMm]);
    const path = buildDrcContext(result).netPaths().netPath("a");
    expect(path.kind).toBe("defined");
    if (path.kind === "defined") expect(path.lengthMm).toBeCloseTo(lengthMm, 12);
    expect(rows(result, "NET_LENGTH_OUT_OF_RANGE")).toHaveLength(violation ? 1 : 0);
  });

  test("the original 0.3 mm terminal clipping case passes exactly on target tolerance", () => {
    const result = routedScene([9.7]);
    result.traces = [trace("a", "a", [[0, 0], [10, 0]])];
    result.placements = [0, 10].map((x, index) =>
      placement(`a-${index === 0 ? "start" : "end"}`, {
        positionMm: { x, y: 0 },
        pads: [pad("1", { x: 0, y: 0 }, 0.3, 0.3)],
      }),
    );
    const path = buildDrcContext(result).netPaths().netPath("a");
    expect(path.kind === "defined" && path.lengthMm).toBe(9.7);
    expect(rows(result, "NET_LENGTH_OUT_OF_RANGE")).toEqual([]);
  });

  test.each([
    [9.7, false],
    [9.700001, false],
    [9.699999, false],
    [9.699998, true],
  ])("longest routed length %s mm respects the same grace", (lengthMm, violation) => {
    const result = routedScene([lengthMm, 10], {
      ...GROUP, netIds: ["a", "b"], target: { kind: "longest" },
    });
    const violations = rows(result, "NET_LENGTH_OUT_OF_RANGE");
    expect(violations).toHaveLength(violation ? 1 : 0);
    if (violation) {
      expect(violations[0]!.anchors[0]).toEqual({ kind: "net", netId: "a" });
    }
  });
});

describe("SI dangling rule references", () => {
  test("each missing length-group member is reported once per group", () => {
    const result = scene([
      { ...GROUP, netIds: ["gone-b", "gone-a", "gone-b", "present"] },
      { ...GROUP, id: "second", netIds: ["gone-a"] },
    ]);
    result.netNames = { present: "Unrouted" };
    const violations = rows(result, "DRC_RULE_INEFFECTIVE");
    expect(violations).toHaveLength(3);
    expect(new Set(violations.map((row) => row.id)).size).toBe(3);
    for (const row of violations) {
      expect(row.message).toContain("does not exist");
      expect(row.anchors.some((anchor) => anchor.kind === "lengthGroup")).toBe(true);
      expect(row.anchors.some((anchor) =>
        anchor.kind === "net" && anchor.netId.startsWith("gone-"),
      )).toBe(true);
    }
    const reordered = structuredClone(result);
    reordered.board.lengthMatchGroups!
      .reverse().forEach((group) => group.netIds.reverse());
    expect(rows(reordered, "DRC_RULE_INEFFECTIVE")).toEqual(violations);
  });

  test("a missing member does not suppress valid length verdicts", () => {
    const result = routedScene([8], { ...GROUP, netIds: ["a", "gone"] });
    expect(rows(result, "DRC_RULE_INEFFECTIVE")).toHaveLength(1);
    expect(rows(result, "NET_LENGTH_OUT_OF_RANGE")).toHaveLength(1);
  });

  test.each([true, false])("missing pair member(s) report once per row, gap target present: %s", (withGap) => {
    const pair = withGap ? PAIR : { ...PAIR, gapMm: undefined };
    const result = scene([], [pair]);
    expect(rows(result, "DRC_RULE_INEFFECTIVE")).toHaveLength(1);
    expect(rows(result, "DRC_RULE_INEFFECTIVE")[0]!.message)
      .toBe("Diff pair Data pair has no effect: nets n, p no longer exist. Rebind or remove it.");
    result.netNames = { p: "Present" };
    const violations = rows(result, "DRC_RULE_INEFFECTIVE");
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toBe("Diff pair Data pair has no effect: net n no longer exists. Rebind or remove it.");
    expect(violations[0]!.anchors).toEqual([{ kind: "rule", ruleId: expect.stringContaining("diffPair:unknown-net:") }]);
    expect(rows(result, "DIFF_PAIR_UNCOUPLED_LENGTH")).toEqual([]);
  });

  test("unknown pair rows retain owner identities across table order and member reversal", () => {
    const result = scene([], [PAIR, { ...PAIR, id: "copy" }]);
    const original = rows(result, "DRC_RULE_INEFFECTIVE");
    expect(original).toHaveLength(2);
    result.board.diffPairs!.reverse();
    expect(rows(result, "DRC_RULE_INEFFECTIVE")).toEqual(original);
    const single = rows(scene([], [PAIR]), "DRC_RULE_INEFFECTIVE");
    expect(single).toHaveLength(1);
    result.board.diffPairs = [{ ...PAIR, pNetId: "n", nNetId: "p" }];
    expect(rows(result, "DRC_RULE_INEFFECTIVE")).toEqual(single);
    result.board.diffPairs = [{ ...PAIR, nNetId: "other-missing" }];
    expect(rows(result, "DRC_RULE_INEFFECTIVE").map((row) => row.id))
      .not.toEqual(single.map((row) => row.id));
  });

  test("resolver-invalid rows are not diagnosed again as missing pairs", () => {
    const result = scene([], [{ ...PAIR, nNetId: "p" }]);
    expect(rows(result, "DRC_RULE_INVALID")).toHaveLength(1);
    expect(rows(result, "DRC_RULE_INEFFECTIVE")).toEqual([]);
  });

  test("a missing partner cannot turn an existing path into an uncoupled violation", () => {
    const result = routedScene([20]);
    result.board.lengthMatchGroups = [];
    result.board.diffPairs = [{ ...PAIR, pNetId: "a", maxUncoupledMm: 1 }];
    expect(rows(result, "DRC_RULE_INEFFECTIVE")).toHaveLength(1);
    expect(rows(result, "DIFF_PAIR_UNCOUPLED_LENGTH")).toEqual([]);
  });

  test("known nets lacking routes or terminals retain their existing silent contract", () => {
    const result = scene([{ ...GROUP, netIds: ["p", "n"] }], [PAIR]);
    result.netNames = { p: "Data_P", n: "Data_N" };
    expect(rows(result, "DRC_RULE_INEFFECTIVE")).toEqual([]);
    expect(rows(result, "NET_LENGTH_UNDEFINED")).toEqual([]);
    const open = routedScene([10, 10], { ...GROUP, netIds: ["p", "n"] });
    open.board.diffPairs = [PAIR];
    open.traces = [];
    expect(rows(open, "DRC_RULE_INEFFECTIVE")).toEqual([]);
    expect(rows(open, "NET_LENGTH_UNDEFINED")).toEqual([]);
  });

  test("copper-carried IDs stay known for length groups but cannot activate explicit pairs", () => {
    const result = scene([{ ...GROUP, netIds: ["trace", "pad", "via", "free"] }], [
      { ...PAIR, pNetId: "trace", nNetId: "pad" },
      { ...PAIR, id: "second", pNetId: "via", nNetId: "free" },
    ]);
    result.traces = [trace("t", "trace", [[0, 0], [1, 0]])];
    result.placements = [
      placement("p", { pads: [pad("1", { x: 4, y: 0 }, 0.5, 0.5)] }),
    ];
    result.padNets = { "p|1": "pad" };
    result.vias = [via("v", { netId: "via", center: { x: 8, y: 0 } })];
    result.freePads = [freePad("f", { netId: "free", center: { x: 12, y: 0 } })];
    const violations = rows(result, "DRC_RULE_INEFFECTIVE");
    expect(violations).toHaveLength(2);
    expect(violations.map((row) => row.message).sort()).toEqual([
      "Diff pair Data pair has no effect: nets free, via no longer exist. Rebind or remove it.",
      "Diff pair Data pair has no effect: nets pad, trace no longer exist. Rebind or remove it.",
    ]);
    expect(rows(result, "DIFF_PAIR_GAP")).toEqual([]);
    result.board.diffPairs = [];
    expect(rows(result, "DRC_RULE_INEFFECTIVE")).toEqual([]);
  });
});
