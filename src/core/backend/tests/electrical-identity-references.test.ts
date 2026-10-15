import { describe, expect, test } from "bun:test";
import {
  enumerateNetReferences,
  judgeNetReference,
  rewriteNetReferences,
  type NetReference,
  type NetReferenceClass,
  type NetReferenceSource,
  type NetReferenceVerdict,
} from "../../../shared/electrical-identity/references";
import type { DesignerNetReferenceSite, PcbDrcRule } from "../../../sdks/designer";

const A = "net:aaaaaaaaaa:9";
const B = "net:aaaaaaaaaa:10";
const C = "net:aaaaaaaaaa:11";
const LONE = "nc:part-1:1";

function rule(id: string, scopes: PcbDrcRule["scopes"]): PcbDrcRule {
  return {
    id,
    name: id,
    enabled: true,
    priority: 1,
    scopes,
    constraint: { kind: "clearance", mm: 0.3 },
  };
}

function source(): NetReferenceSource {
  return {
    board: {
      perNetClassAssignments: { [A]: "power", [B]: "signal" },
      lengthMatchGroups: [
        { id: "g1", name: "bus", netIds: [A, C], target: { kind: "longest" }, toleranceMm: 0.5 },
      ],
      diffPairs: [{ id: "d1", name: "usb", pNetId: B, nNetId: C }],
      drcRules: [
        rule("r1", [
          { kind: "layer", layers: ["F.Cu"] },
          { kind: "net", netIds: [A, B] },
        ]),
      ],
    },
    traces: [
      { id: "t1", netId: A },
      { id: "t2", netId: null, netName: "GND" },
    ],
    vias: [{ id: "v1", netId: LONE, netName: null }],
    freePads: [{ id: "f1", netId: null }],
    zones: [
      { id: "z1", netId: B, netName: null, enabled: true },
      { id: "z2", netId: null, netName: "VCC", enabled: false },
    ],
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const sites = (refs: readonly NetReference[]): DesignerNetReferenceSite[] =>
  refs.map((ref) => ref.site);

describe("enumerateNetReferences", () => {
  test("lists every site in the documented order", () => {
    expect(enumerateNetReferences(source())).toEqual([
      { netId: A, netName: null, refClass: "copper", site: { kind: "trace", traceId: "t1" } },
      { netId: null, netName: "GND", refClass: "copper", site: { kind: "trace", traceId: "t2" } },
      { netId: LONE, netName: null, refClass: "copper", site: { kind: "via", viaId: "v1" } },
      { netId: null, netName: null, refClass: "copper", site: { kind: "freePad", freePadId: "f1" } },
      { netId: B, netName: null, refClass: "copper", site: { kind: "zone", zoneId: "z1" } },
      { netId: null, netName: "VCC", refClass: "inert-copper", site: { kind: "zone", zoneId: "z2" } },
      // assignment keys in code-unit order: ":10" sorts before ":9"
      { netId: B, netName: null, refClass: "rule", site: { kind: "netClassAssignment" } },
      { netId: A, netName: null, refClass: "rule", site: { kind: "netClassAssignment" } },
      { netId: A, netName: null, refClass: "rule", site: { kind: "lengthGroup", groupId: "g1" } },
      { netId: C, netName: null, refClass: "rule", site: { kind: "lengthGroup", groupId: "g1" } },
      { netId: B, netName: null, refClass: "rule", site: { kind: "diffPair", pairId: "d1", member: "p" } },
      { netId: C, netName: null, refClass: "rule", site: { kind: "diffPair", pairId: "d1", member: "n" } },
      { netId: A, netName: null, refClass: "rule", site: { kind: "drcRule", ruleId: "r1", scopeIndex: 1 } },
      { netId: B, netName: null, refClass: "rule", site: { kind: "drcRule", ruleId: "r1", scopeIndex: 1 } },
    ]);
  });

  test("keeps source order within each copper kind and rule list", () => {
    const src = source();
    src.traces = [
      { id: "tb", netId: A },
      { id: "ta", netId: A },
    ];
    src.board.drcRules = [
      rule("r2", [{ kind: "net", netIds: [C] }]),
      rule("r1", [{ kind: "net", netIds: [B] }, { kind: "net", netIds: [A] }]),
    ];
    const refs = enumerateNetReferences(src);
    expect(sites(refs.filter((ref) => ref.site.kind === "trace"))).toEqual([
      { kind: "trace", traceId: "tb" },
      { kind: "trace", traceId: "ta" },
    ]);
    expect(sites(refs.filter((ref) => ref.site.kind === "drcRule"))).toEqual([
      { kind: "drcRule", ruleId: "r2", scopeIndex: 0 },
      { kind: "drcRule", ruleId: "r1", scopeIndex: 0 },
      { kind: "drcRule", ruleId: "r1", scopeIndex: 1 },
    ]);
  });

  test("an empty board yields copper references only", () => {
    const src = source();
    src.board = {};
    expect(enumerateNetReferences(src).every((ref) => ref.refClass !== "rule")).toBe(true);
    expect(enumerateNetReferences({ board: {}, traces: [], vias: [], freePads: [], zones: [] })).toEqual([]);
  });

  test("is deterministic and does not mutate its input", () => {
    const src = deepFreeze(source());
    expect(enumerateNetReferences(src)).toEqual(enumerateNetReferences(src));
  });
});

describe("judgeNetReference", () => {
  const active = new Set([A, LONE]);
  const site: DesignerNetReferenceSite = { kind: "netClassAssignment" };
  const cases: Array<[string | null, string | null, NetReferenceVerdict]> = [
    [A, null, "bound"],
    [LONE, null, "bound"],
    [A, "GND", "bound"],
    [B, null, "inactive"],
    [B, "GND", "inactive"],
    ["pending:1", null, "inactive"],
    ["pt:1:2", null, "inactive"],
    [null, "GND", "unresolved-name"],
    [null, "  Net_3 ", "unresolved-name"],
    [null, null, "none"],
    [null, "", "none"],
    [null, "   ", "none"],
  ];
  const classes: NetReferenceClass[] = ["copper", "inert-copper", "rule"];
  for (const refClass of classes) {
    for (const [netId, netName, verdict] of cases) {
      test(`${refClass} ${String(netId)}/${JSON.stringify(netName)} → ${verdict}`, () => {
        expect(judgeNetReference({ netId, netName, refClass, site }, active)).toBe(verdict);
      });
    }
  }

  test("the verdict follows the active set only", () => {
    const ref: NetReference = { netId: B, netName: null, refClass: "rule", site };
    expect(judgeNetReference(ref, new Set())).toBe("inactive");
    expect(judgeNetReference(ref, new Set([B]))).toBe("bound");
  });

  test("a disabled zone is judged like enabled copper, only its class differs", () => {
    const [z2] = enumerateNetReferences(source()).filter(
      (ref) => ref.site.kind === "zone" && ref.site.zoneId === "z2",
    );
    expect(z2!.refClass).toBe("inert-copper");
    expect(judgeNetReference(z2!, active)).toBe("unresolved-name");
  });
});

describe("rewriteNetReferences", () => {
  test("never mutates the input and keeps unchanged items by identity", () => {
    const src = deepFreeze(source());
    const before = structuredClone(src);
    const out = rewriteNetReferences(src, (ref) => (ref.netId === A ? C : undefined));
    expect(src).toEqual(before);
    expect(out).not.toBe(src);
    expect(out.traces[1]).toBe(src.traces[1]);
    expect(out.vias[0]).toBe(src.vias[0]);
    expect(out.zones[0]).toBe(src.zones[0]);
    expect(out.board.diffPairs![0]).toBe(src.board.diffPairs![0]);
    expect(out.traces[0]).toEqual({ id: "t1", netId: C });
  });

  test("an identity map returns structurally equal content with every item shared", () => {
    const src = deepFreeze(source());
    const keep = rewriteNetReferences(src, () => undefined);
    const same = rewriteNetReferences(src, (ref) => (ref.netId === null ? undefined : ref.netId));
    for (const out of [keep, same]) {
      expect(out).toEqual(src);
      expect(out.board.perNetClassAssignments).toBe(src.board.perNetClassAssignments);
      expect(out.board.lengthMatchGroups![0]).toBe(src.board.lengthMatchGroups![0]);
      expect(out.board.drcRules![0]).toBe(src.board.drcRules![0]);
      out.traces.forEach((trace, index) => expect(trace).toBe(src.traces[index]!));
    }
  });

  test("calls the map once per reference, in enumeration order", () => {
    const src = source();
    const seen: NetReference[] = [];
    rewriteNetReferences(src, (ref) => {
      seen.push(ref);
      return undefined;
    });
    expect(seen).toEqual(enumerateNetReferences(src));
  });

  test("keeps fields outside the picked shape", () => {
    const src = {
      ...source(),
      traces: [{ id: "t1", netId: A, widthMm: 0.25, layer: "F.Cu" as const }],
    };
    const out = rewriteNetReferences(src, () => B);
    expect(out.traces[0]).toEqual({ id: "t1", netId: B, widthMm: 0.25, layer: "F.Cu" });
  });

  test("copper bound to an id keeps its name hint as provenance", () => {
    const out = rewriteNetReferences(source(), (ref) => (ref.netName === null ? undefined : A));
    expect(out.traces[1]).toEqual({ id: "t2", netId: A, netName: "GND" });
    expect(out.zones[1]).toEqual({ id: "z2", netId: A, netName: "VCC", enabled: false });
  });

  test("null unbinds copper; a zone is also disabled, never re-enabled", () => {
    const out = rewriteNetReferences(source(), (ref) => (ref.refClass === "rule" ? undefined : null));
    expect(out.traces).toEqual([
      { id: "t1", netId: null },
      { id: "t2", netId: null, netName: null },
    ]);
    expect(out.vias).toEqual([{ id: "v1", netId: null, netName: null }]);
    expect(out.freePads).toEqual([{ id: "f1", netId: null }]);
    expect(out.zones).toEqual([
      { id: "z1", netId: null, netName: null, enabled: false },
      { id: "z2", netId: null, netName: null, enabled: false },
    ]);
  });

  test("null on already net-less copper is a no-op", () => {
    const src = source();
    const out = rewriteNetReferences(src, (ref) => (ref.site.kind === "freePad" ? null : undefined));
    expect(out.freePads[0]).toBe(src.freePads[0]);
  });

  test("assignments re-key; an existing target wins; null removes; keys come out sorted", () => {
    const src = source();
    src.board.perNetClassAssignments = { [A]: "power", [B]: "signal", [C]: "hv" };
    const out = rewriteNetReferences(src, (ref) => {
      if (ref.site.kind !== "netClassAssignment") return undefined;
      if (ref.netId === A) return C; // C already assigned: existing wins
      if (ref.netId === B) return null;
      return undefined;
    });
    expect(out.board.perNetClassAssignments).toEqual({ [C]: "hv" });

    const moved = rewriteNetReferences(src, (ref) =>
      ref.site.kind === "netClassAssignment" && ref.netId === A ? "net:aaaaaaaaaa:1" : undefined,
    );
    expect(Object.keys(moved.board.perNetClassAssignments!)).toEqual([
      "net:aaaaaaaaaa:1",
      B,
      C,
    ]);
    expect(moved.board.perNetClassAssignments!["net:aaaaaaaaaa:1"]).toBe("power");
  });

  test("assignments swap cleanly and rewritten collisions keep the code-unit-first key", () => {
    const src = source();
    src.board.perNetClassAssignments = { [A]: "power", [B]: "signal" };
    const swapped = rewriteNetReferences(src, (ref) =>
      ref.site.kind !== "netClassAssignment" ? undefined : ref.netId === A ? B : A,
    );
    expect(swapped.board.perNetClassAssignments).toEqual({ [A]: "signal", [B]: "power" });

    const collided = rewriteNetReferences(src, (ref) =>
      ref.site.kind === "netClassAssignment" ? C : undefined,
    );
    // B (":10") sorts before A (":9") in code-unit order.
    expect(collided.board.perNetClassAssignments).toEqual({ [C]: "signal" });
  });

  test("length groups map and dedupe in order; a group left empty is removed", () => {
    const src = source();
    src.board.lengthMatchGroups = [
      { id: "g1", name: "a", netIds: [A, B, C], target: { kind: "longest" }, toleranceMm: 1 },
      { id: "g2", name: "b", netIds: [B], target: { kind: "longest" }, toleranceMm: 1 },
    ];
    const out = rewriteNetReferences(src, (ref) => {
      if (ref.site.kind !== "lengthGroup") return undefined;
      if (ref.netId === A) return C;
      if (ref.netId === B) return null;
      return undefined;
    });
    expect(out.board.lengthMatchGroups).toEqual([
      { id: "g1", name: "a", netIds: [C], target: { kind: "longest" }, toleranceMm: 1 },
    ]);
  });

  test("diff pairs map; a collapsed or unbound pair is removed; untouched pairs stay", () => {
    const src = source();
    src.board.diffPairs = [
      { id: "d1", name: "remap", pNetId: A, nNetId: B },
      { id: "d2", name: "collapse", pNetId: A, nNetId: C },
      { id: "d3", name: "unbind", pNetId: B, nNetId: "net:aaaaaaaaaa:5" },
      { id: "d4", name: "same", pNetId: LONE, nNetId: LONE },
    ];
    const out = rewriteNetReferences(src, (ref) => {
      if (ref.site.kind !== "diffPair") return undefined;
      if (ref.site.pairId === "d1" && ref.netId === A) return "net:aaaaaaaaaa:7";
      if (ref.site.pairId === "d2" && ref.netId === A) return C;
      if (ref.site.pairId === "d3" && ref.site.member === "n") return null;
      return undefined;
    });
    expect(out.board.diffPairs).toEqual([
      { id: "d1", name: "remap", pNetId: "net:aaaaaaaaaa:7", nNetId: B },
      { id: "d4", name: "same", pNetId: LONE, nNetId: LONE },
    ]);
  });

  test("DRC net scopes map and dedupe; an emptied net scope removes the rule", () => {
    const src = source();
    src.board.drcRules = [
      rule("keep", [
        { kind: "layer", layers: ["F.Cu"] },
        { kind: "net", netIds: [A, B, C] },
      ]),
      rule("drop", [{ kind: "net", netIds: [B] }]),
      rule("untouched-empty", [{ kind: "net", netIds: [] }]),
    ];
    const out = rewriteNetReferences(src, (ref) => {
      if (ref.site.kind !== "drcRule") return undefined;
      if (ref.netId === A) return C;
      if (ref.netId === B) return null;
      return undefined;
    });
    expect(out.board.drcRules).toEqual([
      rule("keep", [
        { kind: "layer", layers: ["F.Cu"] },
        { kind: "net", netIds: [C] },
      ]),
      rule("untouched-empty", [{ kind: "net", netIds: [] }]),
    ]);
    expect(out.board.drcRules![0]!.scopes[0]).toBe(src.board.drcRules![0]!.scopes[0]!);
  });

  test("absent board fields stay absent", () => {
    const src: NetReferenceSource = { board: {}, traces: [], vias: [], freePads: [], zones: [] };
    expect(rewriteNetReferences(src, () => null)).toEqual(src);
  });
});
