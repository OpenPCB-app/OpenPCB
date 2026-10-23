import { describe, expect, test } from "bun:test";
import type { DesignerNetReferenceSite } from "../../../sdks/designer/net-identity";
import type { NetReference } from "../../../shared/electrical-identity/references";
import {
  copperReferenceKey, type CopperReferenceEvidence, type LegacyContactEvidence,
} from "../../../modules/designer/backend/net-identity/evidence-types";
import {
  classifyLegacyReference, type LegacyReferenceClassification, type LegacyReferenceContext,
} from "../../../modules/designer/backend/net-identity/migration-classify";
import {
  netReferenceDecisionKey, netReferenceProvenance,
} from "../../../modules/designer/backend/net-identity/reference-key";

const SITES: DesignerNetReferenceSite[] = [
  { kind: "trace", traceId: "item" }, { kind: "via", viaId: "item" },
  { kind: "freePad", freePadId: "item" }, { kind: "zone", zoneId: "item" },
  { kind: "netClassAssignment" }, { kind: "lengthGroup", groupId: "group" },
  { kind: "diffPair", pairId: "pair", member: "p" },
  { kind: "drcRule", ruleId: "rule", scopeIndex: 2 },
];

function reference(site: DesignerNetReferenceSite = SITES[0]!): NetReference {
  return {
    site, netId: "legacy", netName: null,
    refClass: ["trace", "via", "freePad", "zone"].includes(site.kind) ? "copper" : "rule",
  };
}

function physical(ref: NetReference): boolean {
  return ["trace", "via", "freePad"].includes(ref.site.kind);
}

function emptyEvidence(): LegacyContactEvidence {
  return {
    islands: [], islandOf: new Map(), evidenceByRef: new Map(),
    pooledByLegacyRoot: new Map(), pourDisabledReasons: [],
  };
}

function contextFor(
  ref: NetReference, mapped: string | null = "r", nets: string[] = ["r"],
): LegacyReferenceContext {
  const evidence = emptyEvidence();
  if (physical(ref)) {
    const key = copperReferenceKey(ref.site.kind as "trace" | "via" | "freePad", "item");
    evidence.evidenceByRef.set(key, {
      refKey: key, islands: [], directPadNets: new Set(nets),
      padNets: new Set(nets), pourNetIds: new Set(), pour: false,
    });
  }
  evidence.pooledByLegacyRoot.set("legacy", new Set(nets));
  return {
    legacyRootIds: new Map(mapped === null ? [] : [["legacy", mapped]]),
    namedIdsByUpperName: new Map(), legacyAutoRootsByUpperName: new Map(), evidence,
  };
}

function bound(netId: string, method: "rootAndContact" | "rootAndPour" | "contact" | "nameHint" | "autoNameHint", clearName = false): LegacyReferenceClassification {
  return { kind: "bound", netId, method, clearName };
}

function quarantined(reason: "root_only" | "conflict" | "short" | "no_evidence" | "stale_root" | "unknown_name" | "ambiguous_name", candidates: string[], suggestedNetId: string | null = null): LegacyReferenceClassification {
  return { kind: "quarantine", reason, candidates, suggestedNetId };
}

describe("legacy root classification", () => {
  for (const site of SITES) {
    test(`${site.kind}: every root/evidence table branch`, () => {
      const ref = reference(site);
      const copper = physical(ref);
      const cases: Array<[string | null, string[], LegacyReferenceClassification]> = [
        ["r", ["r"], bound("r", "rootAndContact")],
        [null, ["x"], copper ? bound("x", "contact") : quarantined("stale_root", ["x"], "x")],
        ["r", [], quarantined("root_only", ["r"], "r")],
        ["r", ["x"], quarantined("conflict", ["r", "x"], copper ? "x" : null)],
        ["r", ["x", "y"], quarantined(copper ? "short" : "conflict", ["r", "x", "y"])],
        [null, ["x", "y"], quarantined(copper ? "short" : "conflict", ["x", "y"])],
        ["r", ["r", "x"], quarantined(copper ? "short" : "conflict", ["r", "x"])],
        [null, [], quarantined("no_evidence", [])],
      ];
      for (const [mapped, evidence, expected] of cases) {
        expect(classifyLegacyReference(ref, contextFor(ref, mapped, evidence))).toEqual(expected);
      }
    });
  }

  test("physical copper uses only evidenceByRef; zones/rules use only pooled legacy-root proof", () => {
    const trace = reference();
    const context = contextFor(trace);
    context.evidence.pooledByLegacyRoot.set("legacy", new Set(["wrong", "other"]));
    expect(classifyLegacyReference(trace, context)).toEqual(bound("r", "rootAndContact"));
    expect(classifyLegacyReference(reference(SITES[1]), context)).toEqual(quarantined("root_only", ["r"], "r"));
    expect(classifyLegacyReference(reference(SITES[3]), context)).toEqual(quarantined("conflict", ["other", "r", "wrong"]));
    expect(classifyLegacyReference(reference(SITES[4]), context)).toEqual(quarantined("conflict", ["other", "r", "wrong"]));
  });

  test("disabled zones still classify with pooled evidence without changing enabled semantics", () => {
    const ref = { ...reference(SITES[3]), refClass: "inert-copper" as const };
    expect(classifyLegacyReference(ref, contextFor(ref, null, ["x"]))).toEqual(quarantined("stale_root", ["x"], "x"));
    expect(classifyLegacyReference(ref, contextFor(ref))).toEqual(bound("r", "rootAndContact"));
    expect(ref.refClass).toBe("inert-copper");
  });

  test("rootAndPour requires absent direct proof and present pour proof for the bound target", () => {
    const ref = reference();
    const context = contextFor(ref);
    const proof = context.evidence.evidenceByRef.values().next().value as CopperReferenceEvidence;
    proof.directPadNets.clear();
    proof.pourNetIds.add("r");
    proof.pour = true;
    expect(classifyLegacyReference(ref, context)).toEqual(bound("r", "rootAndPour"));
    proof.directPadNets.add("r");
    expect(classifyLegacyReference(ref, context)).toEqual(bound("r", "rootAndContact"));
    proof.directPadNets.clear();
    proof.pourNetIds.clear();
    expect(classifyLegacyReference(ref, context)).toEqual(bound("r", "rootAndContact"));
    proof.pourNetIds.add("r");
    expect(classifyLegacyReference(reference(SITES[3]), context)).toEqual(bound("r", "rootAndContact"));
  });

  test("multi-target candidates deduplicate and use raw code-unit order", () => {
    const ref = reference();
    expect(classifyLegacyReference(ref, contextFor(ref, "A", ["ä", "a", "Z"])))
      .toEqual(quarantined("short", ["A", "Z", "a", "ä"]));
  });
});

describe("legacy name-hint classification", () => {
  test.each([null, "", " \n\t "])("absent/blank hint without netId has no reference: %j", (netName) => {
    const ref = { ...reference(), netId: null, netName };
    expect(classifyLegacyReference(ref, contextFor(ref))).toEqual({ kind: "none" });
  });

  test("nonnull root precedes name hint, including blank root; no pattern or id inference", () => {
    const ref = { ...reference(), netName: " VCC " };
    const context = contextFor(ref, "root-winner", ["root-winner"]);
    context.namedIdsByUpperName = new Map([["VCC", ["hint-loser"]]]);
    expect(classifyLegacyReference(ref, context)).toEqual(bound("root-winner", "rootAndContact"));
    const blank = { ...ref, netId: "" };
    context.legacyRootIds = new Map([["", "blank-root-winner"]]);
    const proof = context.evidence.evidenceByRef.values().next().value as CopperReferenceEvidence;
    proof.padNets = new Set(["blank-root-winner"]);
    expect(classifyLegacyReference(blank, context)).toEqual(bound("blank-root-winner", "rootAndContact"));
    expect(classifyLegacyReference({ ...ref, netId: "net:apparently-durable:1" }, context)).toEqual(bound("blank-root-winner", "contact"));
  });

  test("one named net wins by upper(trim) lookup and preserves exact authored name", () => {
    const ref = { ...reference(), netId: null, netName: " vCc " };
    const context = contextFor(ref, null, []);
    context.namedIdsByUpperName = new Map([["VCC", ["named"]]]);
    expect(classifyLegacyReference(ref, context)).toEqual(bound("named", "nameHint"));
    expect(ref.netName).toBe(" vCc ");
    context.namedIdsByUpperName = new Map([["NET_5", ["explicit-net-name"]]]);
    expect(classifyLegacyReference({ ...ref, netName: "Net_5" }, context)).toEqual(bound("explicit-net-name", "nameHint"));
    expect(classifyLegacyReference({ ...ref, netName: "Net_6" }, context)).toEqual(quarantined("unknown_name", []));
  });

  for (const site of SITES) {
    test(`${site.kind}: singleton auto-name root reruns evidence table and clears only bound hints`, () => {
      const ref = { ...reference(site), netId: null, netName: " Display name without pattern " };
      for (const [mapped, nets] of [["r", ["r"]], [null, ["x"]], ["r", []], ["r", ["x"]], ["r", ["x", "y"]], [null, []]] as Array<[string | null, string[]]>) {
        const context = contextFor(ref, mapped, nets);
        context.legacyAutoRootsByUpperName = new Map([["DISPLAY NAME WITHOUT PATTERN", ["legacy"]]]);
        const rootResult = classifyLegacyReference({ ...ref, netId: "legacy" }, context);
        expect(classifyLegacyReference(ref, context)).toEqual(rootResult.kind === "bound"
          ? { ...rootResult, method: "autoNameHint", clearName: true }
          : rootResult);
      }
    });
  }

  test("named and auto-name ambiguity counts distinct source entries, candidates map to unique nets", () => {
    const ref = { ...reference(), netId: null, netName: "name" };
    const context = contextFor(ref);
    context.legacyRootIds = new Map([["auto-a", "b"], ["auto-b", "b"]]);
    for (const [named, roots, expected] of [
      [["z", "a"], [], ["a", "z"]],
      [[], ["auto-a", "auto-b"], ["b"]],
      [["b"], ["auto-a"], ["b"]],
      [["z"], ["auto-a", "unknown-auto-root"], ["b", "z"]],
    ] as string[][][]) {
      context.namedIdsByUpperName = new Map([["NAME", named!]]);
      context.legacyAutoRootsByUpperName = new Map([["NAME", roots!]]);
      expect(classifyLegacyReference(ref, context)).toEqual(quarantined("ambiguous_name", expected!));
    }
  });

  test("duplicate map entries do not invent name ambiguity", () => {
    const ref = { ...reference(), netId: null, netName: "name" };
    const context = contextFor(ref);
    context.namedIdsByUpperName = new Map([["NAME", ["named", "named"]]]);
    expect(classifyLegacyReference(ref, context)).toEqual(bound("named", "nameHint"));
    context.namedIdsByUpperName = new Map();
    context.legacyAutoRootsByUpperName = new Map([["NAME", ["legacy", "legacy"]]]);
    expect(classifyLegacyReference(ref, context)).toEqual(bound("r", "autoNameHint", true));
  });

  test("classification never mutates references, context maps, sets or candidate arrays", () => {
    const ref = { ...reference(), netId: null, netName: "Name" };
    const context = contextFor(ref, "r", ["z", "a"]);
    context.namedIdsByUpperName = new Map([["NAME", ["z", "a", "z"]]]);
    context.legacyAutoRootsByUpperName = new Map([["NAME", ["legacy"]]]);
    const before = structuredClone({ ref, context });
    classifyLegacyReference(ref, context);
    classifyLegacyReference({ ...ref, netId: "legacy" }, context);
    expect({ ref, context }).toEqual(before);
  });
});

describe("stable net-reference provenance and decision keys", () => {
  test("every reference site maps to the storage kind/id contract", () => {
    const expected = [
      ["trace", "item"], ["via", "item"], ["free_pad", "item"], ["zone", "item"],
      ["net_class_assignment", "perNetClassAssignments"], ["length_group", "group"],
      ["diff_pair", '["pair","p"]'], ["drc_rule", '["rule",2]'],
    ] as const;
    SITES.forEach((site, index) => {
      expect(netReferenceProvenance(reference(site))).toEqual({
        refKind: expected[index]![0], refId: expected[index]![1], legacyValue: "legacy",
      });
    });
  });

  test("provenance keeps exact root/name values and null/blank hints mean no reference", () => {
    const ref = reference();
    expect(netReferenceProvenance({ ...ref, netName: "ignored" })!.legacyValue).toBe("legacy");
    expect(netReferenceProvenance({ ...ref, netId: "", netName: "ignored" })!.legacyValue).toBe("");
    expect(netReferenceProvenance({ ...ref, netId: null, netName: " vCc \n" })!.legacyValue).toBe(" vCc \n");
    for (const netName of [null, "", " \n"]) expect(netReferenceProvenance({ ...ref, netId: null, netName })).toBeNull();
  });

  test("JSON tuple keys do not collide on separators, member/scope positions or exact values", () => {
    const references = [
      { ...reference({ kind: "lengthGroup", groupId: "a|b" }), netId: "c" },
      { ...reference({ kind: "lengthGroup", groupId: "a" }), netId: "b|c" },
      reference({ kind: "diffPair", pairId: 'a","p', member: "n" }),
      reference({ kind: "diffPair", pairId: 'a","n', member: "p" }),
      reference({ kind: "diffPair", pairId: "pair", member: "n" }),
      reference({ kind: "diffPair", pairId: "pair", member: "p" }),
      reference({ kind: "drcRule", ruleId: "rule", scopeIndex: 1 }),
      reference({ kind: "drcRule", ruleId: "rule", scopeIndex: 2 }),
      { ...reference(), netName: null }, { ...reference(), netName: "" },
      { ...reference(), netName: " VCC " }, { ...reference(), netName: "VCC" },
    ];
    const before = structuredClone(references);
    expect(new Set(references.map(netReferenceDecisionKey)).size).toBe(references.length);
    expect(netReferenceDecisionKey(reference({ kind: "lengthGroup", groupId: "duplicate" })))
      .toBe(netReferenceDecisionKey(structuredClone(reference({ kind: "lengthGroup", groupId: "duplicate" }))));
    expect(references).toEqual(before);
  });

  test("identical repeated occurrences share decisions while different stored members remain distinct", () => {
    const ref = reference({ kind: "lengthGroup", groupId: "bus" });
    expect([ref, structuredClone(ref)].map(netReferenceDecisionKey)).toEqual([netReferenceDecisionKey(ref), netReferenceDecisionKey(ref)]);
    expect(netReferenceDecisionKey({ ...ref, netId: "different-legacy-member" })).not.toBe(netReferenceDecisionKey(ref));
    expect(netReferenceDecisionKey(reference(SITES[0]))).not.toBe(netReferenceDecisionKey(reference(SITES[1])));
  });
});
