import { describe, expect, test } from "bun:test";
import type { NetReferenceSource } from "../../../shared/electrical-identity/references";
import { createNetDependentsCensus, lazyCensus } from "../../../modules/designer/backend/net-identity/census";

function source(): NetReferenceSource {
  return {
    traces: [{ id: "trace", netId: "inactive" }, { id: "trace", netId: "inactive" }, { id: "named", netId: null, netName: "inactive" }],
    vias: [{ id: "via", netId: "inactive" }, { id: "via", netId: "inactive" }],
    freePads: [{ id: "pad", netId: "inactive" }, { id: "pad", netId: "inactive" }],
    zones: [
      { id: "disabled", netId: "inactive", netName: null, enabled: false },
      { id: "disabled", netId: "inactive", netName: null, enabled: false },
      { id: "enabled", netId: "inactive", netName: null, enabled: true },
      { id: "name-only", netId: null, netName: "inactive", enabled: true },
    ],
    board: {
      perNetClassAssignments: { inactive: "class" },
      lengthMatchGroups: ["ä", "a", "Z", "a"].map((id) => ({ id, name: id, netIds: ["inactive", "inactive"], target: { kind: "longest" }, toleranceMm: 0 })),
      diffPairs: ["pair-z", "pair-a", "pair-z"].map((id) => ({ id, name: id, pNetId: "inactive", nNetId: "inactive" })),
      drcRules: ["rule-z", "rule-a", "rule-z"].map((id) => ({
        id, name: id, enabled: true, priority: 0,
        scopes: [{ kind: "net", netIds: ["inactive", "inactive"] }, { kind: "net", netIds: ["inactive"] }],
        constraint: { kind: "clearance", mm: 0.2 },
      })),
    },
  };
}

const EMPTY = {
  traces: 0, vias: 0, zones: 0, freePads: 0, netClassAssignment: false,
  lengthGroupIds: [], diffPairIds: [], drcRuleIds: [],
};

describe("net dependent census", () => {
  test("unique declared sites include inactive ids and disabled zones, without duplicate member/scope inflation", () => {
    const census = createNetDependentsCensus(source());
    expect(census.get("inactive")).toEqual({
      traces: 1, vias: 1, zones: 2, freePads: 1, netClassAssignment: true,
      lengthGroupIds: ["Z", "a", "ä"], diffPairIds: ["pair-a", "pair-z"], drcRuleIds: ["rule-a", "rule-z"],
    });
    expect(census.count("inactive")).toBe(13);
    expect(census.get("absent")).toEqual(EMPTY);
    expect(census.count("absent")).toBe(0);
    expect(census.count("class")).toBe(0);
  });

  test("net-name-only references do not create id dependents", () => {
    const input: NetReferenceSource = {
      board: {}, traces: [{ id: "trace", netId: null, netName: "VCC" }],
      vias: [{ id: "via", netId: null, netName: "VCC" }], freePads: [],
      zones: [{ id: "zone", netId: null, netName: "VCC", enabled: false }],
    };
    expect(createNetDependentsCensus(input).get("VCC")).toEqual(EMPTY);
  });

  test("ids and entity kinds stay distinct, including nc and malformed blank ids", () => {
    const input: NetReferenceSource = {
      board: {}, traces: [{ id: "same", netId: "nc:pin" }, { id: "same", netId: "other" }],
      vias: [{ id: "same", netId: "nc:pin" }], freePads: [{ id: "same", netId: "" }], zones: [],
    };
    const census = createNetDependentsCensus(input);
    expect(census.count("nc:pin")).toBe(2);
    expect(census.count("other")).toBe(1);
    expect(census.count("")).toBe(1);
  });

  test("returned snapshots protect cache and source from caller mutation", () => {
    const input = source();
    const before = structuredClone(input);
    const census = createNetDependentsCensus(input);
    const row = census.get("inactive");
    row.traces = 999;
    row.lengthGroupIds.push("caller");
    row.diffPairIds.length = 0;
    row.drcRuleIds.reverse();
    const absent = census.get("absent");
    absent.lengthGroupIds.push("caller");
    expect(census.get("inactive").traces).toBe(1);
    expect(census.get("inactive").lengthGroupIds).toEqual(["Z", "a", "ä"]);
    expect(census.get("inactive").diffPairIds).toEqual(["pair-a", "pair-z"]);
    expect(census.get("absent")).toEqual(EMPTY);
    expect(census.count("inactive")).toBe(13);
    expect(input).toEqual(before);
    input.traces = [...input.traces, { id: "later", netId: "inactive" }];
    expect(census.get("inactive").traces).toBe(1);
  });

  test("permuting declarations preserves every census value", () => {
    const input = source();
    const reordered = structuredClone(input);
    reordered.traces = [...reordered.traces].reverse();
    reordered.zones = [...reordered.zones].reverse();
    reordered.board.lengthMatchGroups!.reverse();
    reordered.board.drcRules!.reverse().forEach((row) => row.scopes.reverse());
    expect(createNetDependentsCensus(reordered).get("inactive")).toEqual(createNetDependentsCensus(input).get("inactive"));
  });

  test.each(["get", "count"] as const)("lazy census loads only once after first %s, including unknown ids", (first) => {
    const input = source();
    let calls = 0;
    const census = lazyCensus(() => { calls++; return input; });
    expect(calls).toBe(0);
    input.traces = [...input.traces, { id: "before-first-read", netId: "inactive" }];
    census[first]("absent");
    expect(calls).toBe(1);
    expect(census.get("inactive").traces).toBe(2);
    input.traces = [...input.traces, { id: "after-first-read", netId: "inactive" }];
    expect(census.count("inactive")).toBe(14);
    expect(census.get("inactive").traces).toBe(2);
    expect(census.get("absent")).toEqual(EMPTY);
    expect(calls).toBe(1);
  });
});
