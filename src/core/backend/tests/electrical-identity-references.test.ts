import { describe, expect, test } from "bun:test";
import type { DesignerNetReferenceSite } from "../../../sdks/designer";
import {
  enumerateNetReferences,
  judgeNetReference,
  rewriteNetReferences,
  type NetReference,
  type NetReferenceSource,
} from "../../../shared/electrical-identity/references";

function fixture() {
  return {
    futureSource: { values: [1, 2] },
    board: {
      futureBoard: { keep: true },
      perNetClassAssignments: { b: "class-b", a: "class-a", dest: "class-dest" } as Record<string, string>,
      lengthMatchGroups: [{
        id: "bus", name: "Bus", netIds: ["a", "b", "a"],
        target: { kind: "longest" as const, futureTarget: 1 }, toleranceMm: 0,
        futureGroup: { keep: true },
      }],
      diffPairs: [{
        id: "pair", name: "Pair", pNetId: "a", nNetId: "b", gapMm: 0.2,
        futurePair: { keep: true },
      }],
      drcRules: [{
        id: "rule", name: "Rule", enabled: true, priority: 1,
        scopes: [
          { kind: "net" as const, netIds: ["a", "b", "a"], futureScope: 1 },
          { kind: "netClass" as const, netClassIds: ["class-a"] },
        ],
        constraint: { kind: "clearance" as const, mm: 0.2, futureConstraint: 7 },
        futureRule: { keep: true },
      }],
    },
    traces: [{ id: "trace", netId: "a" as string | null, netName: "Old trace", pointsNm: [{ x: 1, y: 2 }], futureTrace: 1 }],
    vias: [{ id: "via", netId: "b" as string | null, netName: "Old via", centerMm: { x: 1, y: 2 }, futureVia: 2 }],
    freePads: [{ id: "pad", netId: "c" as string | null, futurePad: 3 }],
    zones: [
      { id: "on", enabled: true, netId: "a" as string | null, netName: "Old zone", futureZone: 4 },
      { id: "off", enabled: false, netId: null as string | null, netName: "Hint", futureZone: 5 },
    ],
  };
}

function empty() {
  return { board: {}, traces: [], vias: [], freePads: [], zones: [] } satisfies NetReferenceSource;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe("electrical reference enumeration", () => {
  test("every site, duplicate occurrence and disabled zone is retained in canonical order", () => {
    const src = freeze(fixture());
    const refs = enumerateNetReferences(src);
    expect(refs.map((ref) => [ref.site.kind, ref.netId])).toEqual([
      ["diffPair", "b"], ["diffPair", "a"],
      ["drcRule", "a"], ["drcRule", "a"], ["drcRule", "b"],
      ["freePad", "c"],
      ["lengthGroup", "a"], ["lengthGroup", "a"], ["lengthGroup", "b"],
      ["netClassAssignment", "a"], ["netClassAssignment", "b"], ["netClassAssignment", "dest"],
      ["trace", "a"], ["via", "b"], ["zone", null], ["zone", "a"],
    ]);
    expect(refs[0]!.site).toEqual({ kind: "diffPair", pairId: "pair", member: "n" });
    expect(refs[2]!.site).toEqual({ kind: "drcRule", ruleId: "rule", scopeIndex: 0 });
    expect(refs[5]!.site).toEqual({ kind: "freePad", freePadId: "pad" });
    expect(refs[6]!.site).toEqual({ kind: "lengthGroup", groupId: "bus" });
    expect(refs[12]!.site).toEqual({ kind: "trace", traceId: "trace" });
    expect(refs[13]!.site).toEqual({ kind: "via", viaId: "via" });
    expect(refs[14]).toEqual({
      site: { kind: "zone", zoneId: "off" }, netId: null, netName: "Hint", refClass: "inert-copper",
    });
    expect(refs[15]!.refClass).toBe("copper");
  });

  test("ordering uses code units, not locale, and is independent of input collection order", () => {
    const src = {
      ...empty(),
      board: { perNetClassAssignments: Object.fromEntries(["é", "a", "_", "Z"].map((id) => [id, "class"])) },
      traces: ["é", "a", "_", "Z"].map((id) => ({ id, netId: id })),
    };
    const refs = enumerateNetReferences(src);
    expect(refs.map((ref) => ref.netId)).toEqual(["Z", "_", "a", "é", "Z", "_", "a", "é"]);
    expect(enumerateNetReferences({
      ...src, traces: [...src.traces].reverse(),
      board: { perNetClassAssignments: Object.fromEntries(Object.entries(src.board.perNetClassAssignments).reverse()) },
    })).toEqual(refs);
    const rich = fixture();
    const reversed = structuredClone(rich);
    reversed.zones.reverse();
    reversed.board.lengthMatchGroups[0]!.netIds.reverse();
    reversed.board.drcRules[0]!.scopes[0]!.netIds?.reverse();
    expect(enumerateNetReferences(reversed)).toEqual(enumerateNetReferences(rich));
  });

  test("enumeration exposes no references to caller-owned row objects", () => {
    const src = fixture();
    const before = structuredClone(src);
    const refs = enumerateNetReferences(src);
    refs[0]!.netId = "changed";
    const site: DesignerNetReferenceSite = refs[0]!.site;
    if (site.kind === "diffPair") site.pairId = "changed";
    expect(src).toEqual(before);
  });

  test("string order compares raw code units, not JSON escape spellings", () => {
    const ids = ["a ", "a\\", "a\n", "\u0001", "a\""];
    const refs = enumerateNetReferences({
      ...empty(), traces: ids.map((id) => ({ id, netId: id })),
    });
    expect(refs.map((ref) => ref.netId)).toEqual(["\u0001", "a\n", "a ", "a\"", "a\\"]);
  });

  test("scope sites retain numeric indices and route callbacks to their original occurrences", () => {
    const rule = fixture().board.drcRules[0]!;
    const scopes = Array.from({ length: 12 }, (_, index) => ({
      kind: "net" as const, netIds: ["same"], futureScope: index,
    }));
    const src = { ...empty(), board: { drcRules: [{ ...rule, scopes }] } };
    expect(enumerateNetReferences(src).map((ref) =>
      ref.site.kind === "drcRule" ? ref.site.scopeIndex : -1))
      .toEqual(Array.from({ length: 12 }, (_, index) => index));
    const result = rewriteNetReferences(src, (ref) =>
      ref.site.kind === "drcRule" && ref.site.scopeIndex === 10 ? "new" : undefined);
    expect(result.board.drcRules[0]!.scopes.map((scope) => scope.netIds[0]))
      .toEqual(Array.from({ length: 12 }, (_, index) => index === 10 ? "new" : "same"));
    expect(result.board.drcRules[0]!.scopes.map((scope) => scope.futureScope))
      .toEqual(Array.from({ length: 12 }, (_, index) => index));
  });
});

test("reference verdicts use active identity before provenance and retain dangling identity", () => {
  const base: NetReference = { netId: "active", netName: "Wrong hint", refClass: "copper", site: { kind: "trace", traceId: "t" } };
  const active = new Set(["active", "nc:part:pin"]);
  expect(judgeNetReference(base, active)).toBe("bound");
  expect(judgeNetReference({ ...base, netId: "nc:part:pin" }, active)).toBe("bound");
  expect(judgeNetReference({ ...base, netId: "retired", netName: "active" }, active)).toBe("inactive");
  expect(judgeNetReference({ ...base, netId: "foreign" }, active)).toBe("inactive");
  expect(judgeNetReference({ ...base, netId: null }, active)).toBe("unresolved-name");
  expect(judgeNetReference({ ...base, netId: null, refClass: "inert-copper" }, active)).toBe("unresolved-name");
  expect(judgeNetReference({ ...base, netId: null, netName: "  " }, active)).toBe("none");
  expect(judgeNetReference({ ...base, netId: null, netName: null }, active)).toBe("none");
});

describe("electrical reference rewriting", () => {
  test("callbacks observe the complete original snapshot exactly once in enumeration order", () => {
    const src = freeze(fixture());
    const before = structuredClone(src);
    const calls: NetReference[] = [];
    const result = rewriteNetReferences(src, (ref) => {
      expect(src).toEqual(before);
      calls.push(structuredClone(ref));
      return ref.netId === "a" ? "new-a" : undefined;
    });
    expect(calls).toEqual(enumerateNetReferences(src));
    expect(result.board.perNetClassAssignments).toEqual({ b: "class-b", dest: "class-dest", "new-a": "class-a" });
    expect(result.board.lengthMatchGroups[0]!.netIds).toEqual(["new-a", "b"]);
    expect(result.board.diffPairs[0]).toMatchObject({ pNetId: "new-a", nNetId: "b" });
    expect(result.board.drcRules[0]!.scopes[0]).toMatchObject({ netIds: ["new-a", "b"] });
    expect(src).toEqual(before);
  });

  test("full payload, nested unknown fields, provenance and optional absence survive binding", () => {
    const src = freeze(fixture());
    const result = rewriteNetReferences(src, () => "bound");
    const netScope = src.board.drcRules[0]!.scopes[0]!;
    if (netScope.kind !== "net") throw new Error("fixture must start with a net scope");
    expect(result.traces[0]).toEqual({ ...src.traces[0]!, netId: "bound" });
    expect(result.vias[0]).toEqual({ ...src.vias[0]!, netId: "bound" });
    expect(result.freePads[0]).toEqual({ ...src.freePads[0]!, netId: "bound" });
    expect(result.zones[1]).toEqual({ ...src.zones[1]!, netId: "bound", enabled: false });
    expect(result.board.futureBoard).toEqual(src.board.futureBoard);
    expect(result.board.lengthMatchGroups[0]).toEqual({ ...src.board.lengthMatchGroups[0]!, netIds: ["bound"] });
    expect(result.board.drcRules[0]).toEqual({
      ...src.board.drcRules[0]!, scopes: [
        { ...netScope, netIds: ["bound"] },
        src.board.drcRules[0]!.scopes[1]!,
      ],
    });
    expect(result.board.diffPairs).toEqual([]);
    result.futureSource.values.push(3);
    expect(src.futureSource.values).toEqual([1, 2]);
    expect(Object.hasOwn(result.freePads[0]!, "netName")).toBe(false);
  });

  test("clear nulls copper names, disables zones and removes empty rule declarations", () => {
    const src = freeze(fixture());
    const result = rewriteNetReferences(src, () => null);
    for (const row of [...result.traces, ...result.vias, ...result.zones]) {
      expect(row).toMatchObject({ netId: null, netName: null });
    }
    expect(result.freePads[0]).toEqual({ ...src.freePads[0]!, netId: null });
    expect(Object.hasOwn(result.freePads[0]!, "netName")).toBe(false);
    expect(result.zones.every((zone) => !zone.enabled)).toBe(true);
    expect(result.board.perNetClassAssignments).toEqual({});
    expect(result.board.lengthMatchGroups).toEqual([]);
    expect(result.board.diffPairs).toEqual([]);
    expect(result.board.drcRules).toEqual([]);
    expect(src.board.drcRules[0]!.scopes[0]).toMatchObject({ netIds: ["a", "b", "a"] });
  });

  test("clearing one pair member removes its pair; empty net scope removes whole rule, never match-all", () => {
    const src = fixture();
    const partial = rewriteNetReferences(src, (ref) => ref.netId === "a" ? null : undefined);
    expect(partial.board.diffPairs).toEqual([]);
    expect(partial.board.lengthMatchGroups[0]!.netIds).toEqual(["b"]);
    expect(partial.board.drcRules[0]!.scopes[0]).toMatchObject({ netIds: ["b"] });
    const rules = [
      { ...src.board.drcRules[0]!, id: "two", scopes: [{ kind: "net" as const, netIds: ["a"] }, { kind: "net" as const, netIds: ["b"] }] },
      { ...src.board.drcRules[0]!, id: "global", scopes: [] },
      { ...src.board.drcRules[0]!, id: "classes", scopes: [{ kind: "netClass" as const, netClassIds: ["class"] }] },
    ];
    const result = rewriteNetReferences({ ...src, board: { drcRules: rules } }, (ref) => ref.netId === "a" ? null : undefined);
    expect(result.board.drcRules.map((rule) => rule.id)).toEqual(["global", "classes"]);
    expect(result.board.drcRules[0]!.scopes).toEqual([]);
  });

  test("member deduplication preserves first surviving order; removed rows keep others' metadata", () => {
    const src = fixture();
    src.board.lengthMatchGroups[0]!.netIds = ["z", "b", "a", "b", "c"];
    src.board.drcRules[0]!.scopes[0]!.netIds = ["z", "b", "a", "b", "c"];
    const result = rewriteNetReferences(src, (ref) => ref.netId === "a" ? "b" : ref.netId === "z" ? null : undefined);
    expect(result.board.lengthMatchGroups[0]!.netIds).toEqual(["b", "c"]);
    expect(result.board.drcRules[0]!.scopes[0]).toMatchObject({ netIds: ["b", "c"], futureScope: 1 });
  });

  test("assignment destinations win, source ties use code units, and permutations cannot change winners", () => {
    const orders = [["a", "Z", "_", "dest"], ["dest", "_", "Z", "a"], ["_", "a", "dest", "Z"]];
    for (const order of orders) {
      const assignments = Object.fromEntries(order.map((id) => [id, `class-${id}`]));
      const src = { ...empty(), board: { perNetClassAssignments: assignments } };
      const kept = rewriteNetReferences(src, (ref) => ref.netId === "dest" ? undefined : "dest");
      expect(kept.board.perNetClassAssignments).toEqual({ dest: "class-dest" });
      const moved = rewriteNetReferences(src, (ref) => ref.netId === "dest" ? "elsewhere" : "new");
      expect(moved.board.perNetClassAssignments).toEqual({ elsewhere: "class-dest", new: "class-Z" });
    }
  });

  test("assignment chains and swaps apply simultaneously without cascading or reserved deleted keys", () => {
    const src = { ...empty(), board: { perNetClassAssignments: { a: "A", b: "B" } as Record<string, string> } };
    expect(rewriteNetReferences(src, (ref) => ref.netId === "a" ? "b" : "c").board.perNetClassAssignments)
      .toEqual({ b: "A", c: "B" });
    expect(rewriteNetReferences(src, (ref) => ref.netId === "a" ? "b" : "a").board.perNetClassAssignments)
      .toEqual({ a: "B", b: "A" });
    expect(rewriteNetReferences(src, (ref) => ref.netId === "a" ? "b" : null).board.perNetClassAssignments)
      .toEqual({ b: "A" });
  });

  test("absent optional fields remain absent and explicit empty arrays remain present", () => {
    const src = { ...empty(), traces: [{ id: "none", netId: null }] };
    expect(rewriteNetReferences(src, () => undefined)).toEqual(src);
    const explicit = { ...src, board: { lengthMatchGroups: [], diffPairs: [], drcRules: [], perNetClassAssignments: {} } };
    expect(rewriteNetReferences(explicit, () => undefined)).toEqual(explicit);
    const result = rewriteNetReferences(src, () => undefined);
    expect(Object.hasOwn(result.traces[0]!, "netName")).toBe(false);
    for (const field of ["lengthMatchGroups", "diffPairs", "drcRules", "perNetClassAssignments"]) {
      expect(Object.hasOwn(result.board, field)).toBe(false);
    }
  });

  test("prototype-like assignment keys are preserved as data", () => {
    const assignments = Object.fromEntries([["__proto__", "prototype-class"], ["a", "A"]]);
    const result = rewriteNetReferences({ ...empty(), board: { perNetClassAssignments: assignments } },
      (ref) => ref.netId === "a" ? "constructor" : undefined);
    expect(Object.hasOwn(result.board.perNetClassAssignments, "__proto__")).toBe(true);
    expect(Object.entries(result.board.perNetClassAssignments)
      .find(([name]) => name === "constructor")?.[1]).toBe("A");
    expect(Object.getPrototypeOf(result.board.perNetClassAssignments)).toBe(Object.prototype);
  });

  test("callback failure leaves every input row and nested payload unchanged", () => {
    const src = freeze(fixture());
    const before = structuredClone(src);
    let calls = 0;
    expect(() => rewriteNetReferences(src, () => {
      calls += 1;
      if (calls === 5) throw new Error("binding rejected");
      return "new";
    })).toThrow("binding rejected");
    expect(src).toEqual(before);
  });

  test("undefined and same-ID mappings preserve untouched malformed legacy rows exactly", () => {
    const src = fixture();
    const group = src.board.lengthMatchGroups[0]!;
    const pair = src.board.diffPairs[0]!;
    const rule = src.board.drcRules[0]!;
    const legacy = freeze({
      ...src,
      board: {
        ...src.board,
        lengthMatchGroups: [{ ...group, id: "empty", netIds: [] }, group],
        diffPairs: [{ ...pair, pNetId: "a", nNetId: "a" }],
        drcRules: [
          { ...rule, id: "empty", scopes: [{ kind: "net" as const, netIds: [] }] },
          rule,
        ],
      },
    });
    expect(rewriteNetReferences(legacy, () => undefined)).toEqual(legacy);
    expect(rewriteNetReferences(legacy, (ref) => ref.netId ?? undefined)).toEqual(legacy);
    expect(JSON.stringify(rewriteNetReferences(legacy, () => undefined))).toBe(JSON.stringify(legacy));
    expect(JSON.stringify(rewriteNetReferences(legacy, (ref) => ref.netId ?? undefined))).toBe(JSON.stringify(legacy));
    const repairedTrace = rewriteNetReferences(legacy,
      (ref) => ref.site.kind === "trace" ? "repaired" : undefined);
    expect(repairedTrace.board).toEqual(legacy.board);
    const repairedGroup = rewriteNetReferences(legacy,
      (ref) => ref.site.kind === "lengthGroup" && ref.site.groupId === "bus" && ref.netId === "a"
        ? "repaired" : undefined);
    expect(repairedGroup.board.lengthMatchGroups[0]).toEqual(legacy.board.lengthMatchGroups[0]);
    expect(repairedGroup.board.lengthMatchGroups[1]!.netIds).toEqual(["repaired", "b"]);
    expect(repairedGroup.board.diffPairs).toEqual(legacy.board.diffPairs);
    expect(repairedGroup.board.drcRules).toEqual(legacy.board.drcRules);
  });
});
