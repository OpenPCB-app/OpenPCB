import { describe, expect, test } from "bun:test";
import type { NetReferenceSource } from "../../../shared/electrical-identity/references";
import {
  copperReferenceKey, type CopperReferenceKind,
} from "../../../modules/designer/backend/net-identity/evidence-types";
import type { LegacyReferenceContext } from "../../../modules/designer/backend/net-identity/migration-classify";
import { planLegacyNetReferences } from "../../../modules/designer/backend/net-identity/migration-plan";
import { board } from "./helpers/drc-fixtures";

function source(): NetReferenceSource {
  return { board: {}, traces: [], vias: [], freePads: [], zones: [] };
}

function context(mappings: Record<string, string> = {}): LegacyReferenceContext {
  return {
    legacyRootIds: new Map(Object.entries(mappings)),
    namedIdsByUpperName: new Map(), legacyAutoRootsByUpperName: new Map(),
    evidence: {
      islands: [], islandOf: new Map(), evidenceByRef: new Map(), pourDisabledReasons: [],
      pooledByLegacyRoot: new Map(Object.entries(mappings).map(([root, target]) => [root, new Set([target])])),
    },
  };
}

function proof(ctx: LegacyReferenceContext, kind: CopperReferenceKind, id: string, nets: string[], pourOnly = false): void {
  const key = copperReferenceKey(kind, id);
  ctx.evidence.evidenceByRef.set(key, {
    refKey: key, islands: [], padNets: new Set(nets),
    directPadNets: new Set(pourOnly ? [] : nets),
    pourNetIds: new Set(pourOnly ? nets : []), pour: pourOnly,
  });
}

function assignmentSource(assignments: Record<string, string>): NetReferenceSource {
  return { ...source(), board: { perNetClassAssignments: assignments } };
}

describe("assignment collision planning", () => {
  test("code-unit first bound source wins; differing-class loser stays under its original key", () => {
    const input = assignmentSource({ b: "class-b", a: "class-a" });
    const result = planLegacyNetReferences(input, context({ a: "target", b: "target" }));
    expect(result.rewritten.board.perNetClassAssignments).toEqual({ b: "class-b", target: "class-a" });
    expect(result.quarantines).toEqual([{
      refKind: "net_class_assignment", refId: "perNetClassAssignments", legacyValue: "b",
      reason: "assignment_conflict", candidates: ["target"], suggestedNetId: "target",
    }]);
    expect(result.references.total).toBe(2);
    expect(result.references.bound.rootAndContact).toBe(1);
    expect(result.references.quarantined).toEqual({ assignment_conflict: 1 });
  });

  test.each([false, true])("unchanged destination declaration wins even when its key sorts later; self-bound: %s", (selfBound) => {
    const input = assignmentSource({ a: "moved-class", z: "existing-class" });
    const result = planLegacyNetReferences(input, context(selfBound ? { a: "z", z: "z" } : { a: "z" }));
    expect(result.rewritten.board.perNetClassAssignments).toEqual(input.board.perNetClassAssignments);
    expect(result.quarantines.find((row) => row.legacyValue === "a")!.reason).toBe("assignment_conflict");
    expect(result.references.quarantined.assignment_conflict).toBe(1);
  });

  test("equal classes coalesce; equal-to-winner members still coalesce in mixed groups", () => {
    const mappings = context({ a: "target", b: "target", c: "target" });
    const equal = planLegacyNetReferences(assignmentSource({ a: "same", b: "same" }), mappings);
    expect(equal.rewritten.board.perNetClassAssignments).toEqual({ target: "same" });
    expect(equal.quarantines).toEqual([]);
    expect(equal.references.bound.rootAndContact).toBe(2);
    const mixed = planLegacyNetReferences(assignmentSource({ c: "same", b: "other", a: "same" }), mappings);
    expect(mixed.rewritten.board.perNetClassAssignments).toEqual({ b: "other", target: "same" });
    expect(mixed.references.bound.rootAndContact).toBe(2);
    expect(mixed.references.quarantined).toEqual({ assignment_conflict: 1 });
  });

  test("quarantined loser keys reveal cascading collisions until a monotone fixed point", () => {
    const input = assignmentSource({ c: "class-c", b: "class-b", a: "class-a" });
    const result = planLegacyNetReferences(input, context({ a: "x", b: "x", c: "b" }));
    expect(result.rewritten.board.perNetClassAssignments).toEqual({ x: "class-a", b: "class-b", c: "class-c" });
    expect(result.quarantines.map((row) => [row.legacyValue, row.candidates, row.suggestedNetId])).toEqual([
      ["b", ["x"], "x"], ["c", ["b"], "b"],
    ]);
    expect(result.references.bound.rootAndContact).toBe(1);
    expect(result.references.quarantined).toEqual({ assignment_conflict: 2 });
  });

  test("assignment input permutation does not change winner, decisions, counts or provenance", () => {
    const mappings = context({ a: "x", b: "x", c: "b" });
    const first = planLegacyNetReferences(assignmentSource({ a: "A", b: "B", c: "C" }), mappings);
    const second = planLegacyNetReferences(assignmentSource({ c: "C", a: "A", b: "B" }), mappings);
    expect(second.rewritten).toEqual(first.rewritten);
    expect([...second.decisions]).toEqual([...first.decisions]);
    expect(second.quarantines).toEqual(first.quarantines);
    expect(second.references).toEqual(first.references);
  });
});

describe("differential-pair collision planning", () => {
  test("two mapped members collapsing onto one net both quarantine and keep all original pair data", () => {
    const input = {
      ...source(), board: { diffPairs: [{ id: "pair|[x]", name: "Pair", pNetId: "old-p", nNetId: "old-n", gapMm: 0.2, future: { nested: true } }] },
    };
    const result = planLegacyNetReferences(input, context({ "old-p": "shared", "old-n": "shared" }));
    expect(result.rewritten.board.diffPairs).toEqual(input.board.diffPairs);
    expect(result.quarantines).toHaveLength(2);
    expect(result.quarantines.map((row) => [row.reason, row.refId, row.candidates, row.suggestedNetId])).toEqual([
      ["diff_pair_collapsed", '["pair|[x]","n"]', ["shared"], null],
      ["diff_pair_collapsed", '["pair|[x]","p"]', ["shared"], null],
    ]);
    expect(result.references.bound.rootAndContact).toBe(0);
    expect(result.references.quarantined).toEqual({ diff_pair_collapsed: 2 });
  });

  test("one bound member collapsing onto an unchanged member overrides both prior decisions", () => {
    const input = { ...source(), board: { diffPairs: [{ id: "pair", name: "Pair", pNetId: "old", nNetId: "shared" }] } };
    const result = planLegacyNetReferences(input, context({ old: "shared" }));
    expect(result.rewritten.board.diffPairs).toEqual(input.board.diffPairs);
    expect(result.quarantines.every((row) => row.reason === "diff_pair_collapsed")).toBe(true);
    expect(result.references.quarantined).toEqual({ diff_pair_collapsed: 2 });
  });

  test("untouched already-collapsed malformed declaration stays exact; a bound decision triggers quarantine", () => {
    const input = { ...source(), board: { diffPairs: [{ id: "pair", name: "Pair", pNetId: "same", nNetId: "same", gapMm: -1, future: 7 }] } };
    const untouched = planLegacyNetReferences(input, context());
    expect(untouched.rewritten).toEqual(input);
    expect(untouched.references.quarantined).toEqual({ no_evidence: 2 });
    const bound = planLegacyNetReferences(input, context({ same: "same" }));
    expect(bound.rewritten).toEqual(input);
    expect(bound.references.quarantined).toEqual({ diff_pair_collapsed: 2 });
  });

  test("noncollapsed mappings update both members without dropping optional metadata", () => {
    const input = { ...source(), board: { diffPairs: [{ id: "pair", name: "Pair", pNetId: "p", nNetId: "n", future: true }] } };
    const result = planLegacyNetReferences(input, context({ p: "new-p", n: "new-n" }));
    expect(result.rewritten.board.diffPairs).toEqual([{ ...input.board.diffPairs[0]!, pNetId: "new-p", nNetId: "new-n" }]);
    expect(result.quarantines).toEqual([]);
  });

  test("duplicate pair ids reach a monotone fixed point before a shared decision could drop another pair", () => {
    const input = { ...source(), board: { diffPairs: [
      { id: "duplicate", name: "Earlier", pNetId: "a", nNetId: "c", future: "first" },
      { id: "duplicate", name: "Later", pNetId: "a", nNetId: "b", future: "second" },
    ] } };
    const result = planLegacyNetReferences(input, context({ a: "x", b: "x", c: "a" }));
    expect(result.rewritten).toEqual(input);
    expect(result.references.quarantined).toEqual({ diff_pair_collapsed: 4 });
    expect(result.quarantines).toHaveLength(3);
    expect(result.references.bound.rootAndContact).toBe(0);
  });
});

describe("reference rewrites and reports", () => {
  test("changed length groups/scopes deduplicate, while reports count every original occurrence", () => {
    const input = {
      ...source(), board: {
        lengthMatchGroups: [{ id: "group", name: "Bus", netIds: ["a", "a", "b"], target: { kind: "longest" as const }, toleranceMm: 0, future: true }],
        drcRules: [{ id: "rule", name: "Rule", enabled: true, priority: 1, scopes: [{ kind: "net" as const, netIds: ["b", "a", "a"], future: 7 }], constraint: { kind: "clearance" as const, mm: 0.3 }, future: "keep" }],
      },
    };
    const result = planLegacyNetReferences(input, context({ a: "target", b: "target" }));
    expect(result.rewritten.board.lengthMatchGroups[0]!.netIds).toEqual(["target"]);
    expect(result.rewritten.board.lengthMatchGroups[0]!.future).toBe(true);
    expect(result.rewritten.board.drcRules[0]!.scopes).toEqual([{ kind: "net", netIds: ["target"], future: 7 }]);
    expect(result.references.total).toBe(6);
    expect(result.references.bound.rootAndContact).toBe(6);
    expect(result.quarantines).toEqual([]);
  });

  test("duplicate quarantine provenance deduplicates output only; none and repeated members still count", () => {
    const input = {
      ...source(), traces: [{ id: "none", netId: null, netName: " " }],
      board: { lengthMatchGroups: [{ id: "group", name: "Bus", netIds: ["ghost", "ghost"], target: { kind: "longest" as const }, toleranceMm: 0 }] },
    };
    const result = planLegacyNetReferences(input, context());
    expect(result.rewritten).toEqual(input);
    expect(result.references.total).toBe(3);
    expect(result.references.quarantined).toEqual({ no_evidence: 2 });
    expect(result.quarantines).toHaveLength(1);
    expect(result.decisions.size).toBe(2);
  });

  test("auto-name bindings clear only trace/via/zone hints, preserve named hints and disabled zones", () => {
    const input = {
      ...source(), board: { ...board(), futureBoard: { opaque: true } },
      traces: [
        { id: "auto", netId: null, netName: " Auto Name ", future: "trace" },
        { id: "named", netId: null, netName: " vCc ", future: "named" },
        { id: "root", netId: "root", netName: "Net_5", future: "root" },
        { id: "absent", netId: "root", future: "absent" },
      ] as Array<NetReferenceSource["traces"][number] & { future: string }>,
      vias: [{ id: "auto-via", netId: null, netName: "Auto Name", future: "via" }] as Array<NetReferenceSource["vias"][number] & { future: string }>,
      zones: [
        { id: "auto-zone", netId: null, netName: "Auto Name", enabled: false, future: "zone" },
        { id: "named-zone", netId: null, netName: "VCC", enabled: true, future: "named-zone" },
      ] as Array<NetReferenceSource["zones"][number] & { future: string }>,
    };
    const ctx = context({ autoRoot: "auto-target", root: "root-target" });
    ctx.legacyAutoRootsByUpperName = new Map([["AUTO NAME", ["autoRoot"]]]);
    ctx.namedIdsByUpperName = new Map([["VCC", ["named-target"]]]);
    proof(ctx, "trace", "auto", ["auto-target"]);
    proof(ctx, "via", "auto-via", ["auto-target"]);
    proof(ctx, "trace", "root", ["root-target"]);
    proof(ctx, "trace", "absent", ["root-target"]);
    const result = planLegacyNetReferences(input, ctx);
    expect(result.rewritten.traces[0]).toEqual({ ...input.traces[0]!, netId: "auto-target", netName: null });
    expect(result.rewritten.traces[1]).toEqual({ ...input.traces[1]!, netId: "named-target" });
    expect(result.rewritten.traces[2]).toEqual({ ...input.traces[2]!, netId: "root-target" });
    expect(Object.hasOwn(result.rewritten.traces[3]!, "netName")).toBe(false);
    expect(result.rewritten.vias[0]).toEqual({ ...input.vias[0]!, netId: "auto-target", netName: null });
    expect(result.rewritten.zones[0]).toEqual({ ...input.zones[0]!, netId: "auto-target", netName: null });
    expect(result.rewritten.zones[0]!.enabled).toBe(false);
    expect(result.rewritten.zones[1]).toEqual({ ...input.zones[1]!, netId: "named-target" });
    expect(result.rewritten.board).toEqual(input.board);
  });

  test("all five binding methods count separately", () => {
    const input = {
      ...source(), traces: [
        { id: "direct", netId: "direct-root" }, { id: "pour", netId: "pour-root" },
        { id: "contact", netId: "stale-root" },
        { id: "named", netId: null, netName: "VCC" },
        { id: "auto", netId: null, netName: "Net_5" },
      ],
    };
    const ctx = context({ "direct-root": "d", "pour-root": "p", "auto-root": "a" });
    ctx.namedIdsByUpperName = new Map([["VCC", ["n"]]]);
    ctx.legacyAutoRootsByUpperName = new Map([["NET_5", ["auto-root"]]]);
    proof(ctx, "trace", "direct", ["d"]);
    proof(ctx, "trace", "pour", ["p"], true);
    proof(ctx, "trace", "contact", ["c"]);
    proof(ctx, "trace", "auto", ["a"]);
    expect(planLegacyNetReferences(input, ctx).references).toEqual({
      total: 5, bound: { rootAndContact: 1, rootAndPour: 1, contact: 1, nameHint: 1, autoNameHint: 1 }, quarantined: {},
    });
  });

  test("stale physical copper can bind while rule references remain quarantined", () => {
    const input = { ...source(), traces: [{ id: "trace", netId: "stale" }], board: { perNetClassAssignments: { stale: "class" } } };
    const ctx = context();
    ctx.evidence.pooledByLegacyRoot.set("stale", new Set(["target"]));
    proof(ctx, "trace", "trace", ["target"]);
    const result = planLegacyNetReferences(input, ctx);
    expect(result.rewritten.traces[0]!.netId).toBe("target");
    expect(result.rewritten.board.perNetClassAssignments).toEqual({ stale: "class" });
    expect(result.quarantines[0]!.reason).toBe("stale_root");
    expect(result.references.bound.contact).toBe(1);
  });

  test("quarantine provenance uses exact values and JSON tuples survive separators and duplicate occurrences", () => {
    const input = {
      ...source(), traces: [
        { id: "name", netId: null, netName: " unknown \n" },
        { id: "blank-root", netId: "", netName: "ignored" },
      ], board: { lengthMatchGroups: [
        { id: "a|b", name: "Bus", netIds: ["c", "c"], target: { kind: "longest" as const }, toleranceMm: 0 },
        { id: "a", name: "Bus", netIds: ["b|c"], target: { kind: "longest" as const }, toleranceMm: 0 },
      ] },
    };
    const result = planLegacyNetReferences(input, context());
    expect(result.quarantines).toHaveLength(4);
    expect(result.quarantines.map((row) => [row.refId, row.legacyValue])).toEqual([
      ["a", "b|c"], ["a|b", "c"], ["blank-root", ""], ["name", " unknown \n"],
    ]);
    expect(result.references.total).toBe(5);
    expect(result.references.quarantined).toEqual({ no_evidence: 4, unknown_name: 1 });
    expect(result.rewritten).toEqual(input);
  });

  test("complete classification/rewriting leaves input objects, context maps and evidence sets unchanged", () => {
    const input = assignmentSource({ a: "A", b: "B", c: "C" });
    const ctx = context({ a: "x", b: "x", c: "b" });
    const before = structuredClone({ input, ctx });
    const result = planLegacyNetReferences(input, ctx);
    expect({ input, ctx }).toEqual(before);
    expect(result.rewritten).not.toBe(input);
    expect(Object.hasOwn(result.rewritten.board, "diffPairs")).toBe(false);
    expect(Object.hasOwn(result.rewritten.board, "lengthMatchGroups")).toBe(false);
  });
});
