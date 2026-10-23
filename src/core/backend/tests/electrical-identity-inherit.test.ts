import { describe, expect, test } from "bun:test";
import {
  reconcileElectricalIdentity,
  type ActiveElectricalNet,
  type ElectricalComponent,
  type ElectricalIdentityInput,
  type ElectricalIdentityResult,
  type ElectricalMember,
  type ElectricalMemberKind,
} from "../../../shared/electrical-identity";

const member = (id: string, kind: ElectricalMemberKind = "pin"): ElectricalMember => ({ kind, id });
const old = (id: string, ...members: ElectricalMember[]): ActiveElectricalNet => ({ id, members });
const current = (key: string, ...members: ElectricalMember[]): ElectricalComponent => ({ key, members });
const token = (entry: ElectricalMember): string => JSON.stringify([entry.kind, entry.id]);

function reconcile(
  previousActive: readonly ActiveElectricalNet[],
  currentComponents: readonly ElectricalComponent[],
  options: Partial<ElectricalIdentityInput> = {},
): ElectricalIdentityResult {
  let next = 0;
  return reconcileElectricalIdentity({
    previousActive, currentComponents, successorPolicy: "inherit-most-pins",
    allocateId: () => `new-${next++}`, ...options,
  });
}

function snapshot(result: ElectricalIdentityResult): string {
  return JSON.stringify({ ...result, componentNetIds: [...result.componentNetIds] });
}

describe("inheritance score order", () => {
  test("higher predecessor priority wins before pin overlap without inferring names", () => {
    const previous = [old("auto", member("a"), member("b"), member("c")), old("explicit", member("d"))];
    const components = [current("merged", member("a"), member("b"), member("c"), member("d"))];
    expect(reconcile(previous, components).preservedIds).toEqual(["auto"]);
    const result = reconcile(previous, components, { predecessorPriority: (id) => id === "explicit" ? 1 : 0 });
    expect(result.preservedIds).toEqual(["explicit"]);
    expect(result.retirements).toEqual([{ id: "auto", reason: "merged", successorIds: ["explicit"] }]);
  });

  test("pin overlap outranks total member overlap", () => {
    const result = reconcile([
      old("old", member("a"), member("b"), member("w1", "wire"), member("w2", "wire"), member("w3", "wire")),
    ], [
      current("pins", member("a"), member("b")),
      current("wires", member("w1", "wire"), member("w2", "wire"), member("w3", "wire"), member("new1"), member("new2"), member("new3")),
    ]);
    expect(result.componentNetIds.get("pins")).toBe("old");
  });

  test("member overlap outranks current pin count", () => {
    const result = reconcile([
      old("old", member("a"), member("b"), member("w1", "wire"), member("w2", "wire")),
    ], [
      current("members", member("a"), member("w1", "wire"), member("w2", "wire")),
      current("pins", member("b"), member("new1"), member("new2")),
    ]);
    expect(result.componentNetIds.get("members")).toBe("old");
  });

  test("current pin count breaks equal overlap before membership order", () => {
    const result = reconcile([old("old", member("a"), member("z"))], [
      current("A", member("a")), current("Z", member("z"), member("new1"), member("new2")),
    ]);
    expect(result.componentNetIds.get("Z")).toBe("old");
  });

  test("previous pin count outranks the caller comparator", () => {
    let comparisons = 0;
    const result = reconcile([
      old("a-small", member("a")), old("z-big", member("b"), member("removed1"), member("removed2")),
    ], [current("merged", member("a"), member("b"))], {
      comparePredecessors: (first, second) => { comparisons++; return first < second ? -1 : 1; },
    });
    expect(result.preservedIds).toEqual(["z-big"]);
    expect(comparisons).toBe(0);
  });

  test("caller comparator ranks dependents then numeric sequence before opaque id text", () => {
    const previous = [old("net:10", member("a")), old("net:9", member("b"))];
    const components = [current("merged", member("a"), member("b"))];
    const numeric = (id: string): number => Number(id.split(":")[1]);
    expect(reconcile(previous, components, {
      comparePredecessors: (first, second) => numeric(first) - numeric(second),
    }).preservedIds).toEqual(["net:9"]);
    const dependents: Record<string, number> = { "net:10": 2, "net:9": 1 };
    expect(reconcile(previous, components, {
      comparePredecessors: (first, second) => dependents[second]! - dependents[first]! || numeric(first) - numeric(second),
    }).preservedIds).toEqual(["net:10"]);
  });

  test("opaque predecessor ids use code-unit ordering when all scores tie", () => {
    const result = reconcile([old("ä", member("a")), old("Z", member("b"))], [current("merged", member("a"), member("b"))]);
    expect(result.preservedIds).toEqual(["Z"]);
  });

  test("canonical membership outranks component key for one predecessor", () => {
    const result = reconcile([old("old", member("a"), member("z"))], [
      current("A", member("z")), current("Z", member("a")),
    ], { comparePredecessors: () => { throw new Error("same predecessor must not be compared"); } });
    expect(result.componentNetIds.get("Z")).toBe("old");
  });
});

describe("identity transitions", () => {
  test("a split keeps the most pins, unaffected by predecessor priority", () => {
    const previous = [old("old", member("a"), member("b"), member("c"))];
    const components = [current("large", member("a"), member("b")), current("small", member("c"))];
    const baseline = reconcile(previous, components);
    expect(snapshot(reconcile(previous, components, { predecessorPriority: () => -999 }))).toBe(snapshot(baseline));
    expect(baseline.transitions).toEqual([{
      kind: "split", predecessorIds: ["old"], successorIds: ["new-0", "old"],
      inherited: [{ fromId: "old", componentKey: "large" }],
    }]);
    expect(baseline.retirements).toEqual([]);
  });

  test("wire-only components can inherit using member overlap", () => {
    const result = reconcile([old("old", member("a", "wire"), member("b", "label"), member("c", "primitive"))], [
      current("large", member("a", "wire"), member("b", "label")), current("small", member("c", "primitive")),
    ]);
    expect(result.componentNetIds.get("large")).toBe("old");
  });

  test("many-to-many greedy selection can retire an unmatched predecessor", () => {
    const result = reconcile([
      old("p1", member("a"), member("b"), member("c")), old("p2", member("d")),
    ], [current("left", member("a"), member("b"), member("d")), current("right", member("c"))]);
    expect([...result.componentNetIds]).toEqual([["left", "p1"], ["right", "new-0"]]);
    expect(result.retirements).toEqual([{ id: "p2", reason: "reconfigured", successorIds: ["p1"] }]);
    expect(result.transitions).toEqual([{
      kind: "reconfigure", predecessorIds: ["p1", "p2"], successorIds: ["new-0", "p1"],
      inherited: [{ fromId: "p1", componentKey: "left" }],
    }]);
  });

  test("many-to-many can preserve both predecessors without retiring inherited ids", () => {
    const result = reconcile([
      old("p1", member("a"), member("b"), member("c")),
      old("p2", member("d"), member("e"), member("f")),
    ], [current("left", member("a"), member("b"), member("d")), current("right", member("c"), member("e"), member("f"))]);
    expect(result.preservedIds).toEqual(["p1", "p2"]);
    expect(result.retirements).toEqual([]);
    expect(result.transitions[0]?.inherited).toEqual([{ fromId: "p1", componentKey: "left" }, { fromId: "p2", componentKey: "right" }]);
  });

  test("merge transitions expose the survivor and retire only the loser", () => {
    const result = reconcile([old("p1", member("a")), old("p2", member("b"))], [current("merged", member("a"), member("b"))]);
    expect(result.transitions).toEqual([{
      kind: "merge", predecessorIds: ["p1", "p2"], successorIds: ["p1"], inherited: [{ fromId: "p1", componentKey: "merged" }],
    }]);
    expect(result.retirements).toEqual([{ id: "p2", reason: "merged", successorIds: ["p1"] }]);
  });

  test("retire policy keeps prior behavior and reports non-inheriting transitions", () => {
    const result = reconcile([old("p1", member("a")), old("p2", member("b"))], [current("merged", member("a"), member("b"))], { successorPolicy: "retire" });
    expect(result.preservedIds).toEqual([]);
    expect(result.createdIds).toEqual(["new-0"]);
    expect(result.retirements.map((entry) => entry.id)).toEqual(["p1", "p2"]);
    expect(result.transitions).toEqual([{ kind: "merge", predecessorIds: ["p1", "p2"], successorIds: ["new-0"], inherited: [] }]);
  });

  test("one-to-one, removed, and entirely new nets produce no transition", () => {
    const result = reconcile([old("kept", member("a")), old("removed", member("b"))], [current("same", member("a")), current("new", member("c"))]);
    expect(result.transitions).toEqual([]);
    expect(result.retirements).toEqual([{ id: "removed", reason: "removed", successorIds: [] }]);
  });

  test("old active, inherited, retired, and newly allocated ids cannot be recycled", () => {
    for (const collision of ["p1", "p2", "historical"]) {
      expect(() => reconcile([old("p1", member("a")), old("p2", member("b"))], [
        current("merged", member("a"), member("b")), current("new", member("c")),
      ], { retiredIds: ["historical"], allocateId: () => collision })).toThrow("Allocated ID collision");
    }
    expect(() => reconcile([], [current("a", member("a")), current("b", member("b"))], { allocateId: () => "same" })).toThrow("Allocated ID collision");
  });
});

describe("callback and input validation", () => {
  test.each(["predecessorPriority", "comparePredecessors"] as const)("%s must be callable", (field) => {
    let allocations = 0;
    expect(() => reconcile([], [current("new", member("a"))], {
      [field]: null, allocateId: () => { allocations++; return "new"; },
    } as unknown as ElectricalIdentityInput)).toThrow(`${field} must be a function`);
    expect(allocations).toBe(0);
  });

  test("rank is finite, cached once per predecessor, in canonical id order", () => {
    const calls: string[] = [];
    reconcile([old("z", member("a"), member("b")), old("a", member("c")), old("removed", member("d"))], [
      current("one", member("a"), member("c")), current("two", member("b")),
    ], { predecessorPriority: (id) => { calls.push(id); return 0; } });
    expect(calls).toEqual(["a", "removed", "z"]);
  });

  test.each([undefined, null, "future", ""].map((value) => ({ value })))("invalid policy fails before allocation: %j", ({ value }) => {
    let allocations = 0;
    expect(() => reconcile([], [current("new", member("a"))], {
      successorPolicy: value, allocateId: () => { allocations++; return "new"; },
    } as unknown as ElectricalIdentityInput)).toThrow("Invalid electrical successor policy");
    expect(allocations).toBe(0);
  });

  test.each([NaN, Infinity, -Infinity, undefined, null, "1"].map((value) => ({ value })))("invalid priority fails before allocation: %j", ({ value }) => {
    let allocations = 0;
    expect(() => reconcile([old("old", member("a"))], [current("new", member("b"))], {
      predecessorPriority: () => value, allocateId: () => { allocations++; return "new"; },
    } as unknown as ElectricalIdentityInput)).toThrow("Predecessor priority must be a finite number");
    expect(allocations).toBe(0);
  });

  test.each([NaN, Infinity, undefined].map((value) => ({ value })))("invalid comparator fails before unrelated allocations: %j", ({ value }) => {
    let allocations = 0;
    expect(() => reconcile([old("p1", member("a")), old("p2", member("b"))], [
      current("new", member("0")), current("merge", member("a"), member("b")),
    ], { comparePredecessors: () => value, allocateId: () => { allocations++; return "new"; } } as unknown as ElectricalIdentityInput)).toThrow("Predecessor comparison must be a finite number");
    expect(allocations).toBe(0);
  });

  test("callback values and canonical output do not alias caller membership", () => {
    const previous = [old("old", member("a"), member("b"))];
    const components = [current("a", member("a")), current("b", member("b"))];
    for (const record of [...previous, ...components]) {
      record.members.forEach(Object.freeze);
      Object.freeze(record.members);
      Object.freeze(record);
    }
    Object.freeze(previous);
    Object.freeze(components);
    const before = JSON.stringify({ previous, components });
    const result = reconcile(previous, components, {
      predecessorPriority: (id) => { expect(typeof id).toBe("string"); return 0; },
      allocateId: (request) => {
        expect(Object.isFrozen(request)).toBe(true);
        expect(Object.isFrozen(request.members)).toBe(true);
        expect(() => { (request.members[0] as { id: string }).id = "mutated"; }).toThrow();
        return "new";
      },
    });
    expect(JSON.stringify({ previous, components })).toBe(before);
    expect(result.nextActive[0]!.members).not.toBe(components[0]!.members);
    expect(Object.isFrozen(result.transitions)).toBe(true);
    expect(Object.isFrozen(result.transitions[0]?.inherited)).toBe(true);
  });
});

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function shuffle<T>(values: readonly T[], next: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}
function partitions(values: readonly ElectricalMember[], next: () => number): ElectricalMember[][] {
  const groups: ElectricalMember[][] = Array.from({ length: 1 + Math.floor(next() * 8) }, () => []);
  values.forEach((value) => groups[Math.floor(next() * groups.length)]!.push(value));
  return groups.filter((group) => group.length > 0);
}
function overlaps(first: readonly ElectricalMember[], second: readonly ElectricalMember[]): boolean {
  const tokens = new Set(first.map(token));
  return second.some((entry) => tokens.has(token(entry)));
}

test("200 seeded mixed-member graphs preserve inheritance under all input permutations", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const next = random(seed);
    const kinds: ElectricalMemberKind[] = ["pin", "wire", "label", "primitive"];
    const members = Array.from({ length: 24 }, (_, index) => member(`member-${index}`, kinds[index % kinds.length]!));
    const previous = partitions(members, next).map((group, index) => old(`old-${index}`, ...group));
    const components = partitions([...members.filter(() => next() > 0.2), member(`added-${seed}`)], next)
      .map((group, index) => current(`component-${index}`, ...group));
    const options = {
      retiredIds: ["historical"],
      predecessorPriority: (id: string): number => Number(id.split("-")[1]) % 3,
      comparePredecessors: (first: string, second: string): number => Number(first.split("-")[1]) - Number(second.split("-")[1]),
    };
    const result = reconcile(previous, components, options);
    const permuted = reconcile(
      shuffle(previous, next).map((net) => old(net.id, ...shuffle(net.members, next))),
      shuffle(components, next).map((component) => current(component.key, ...shuffle(component.members, next))), options,
    );
    expect(snapshot(permuted)).toBe(snapshot(result));
    expect(new Set(result.nextActive.map((net) => net.id)).size).toBe(components.length);
    expect(result.preservedIds.filter((id) => result.retirements.some((entry) => entry.id === id))).toEqual([]);
    expect([...result.preservedIds, ...result.retirements.map((entry) => entry.id)].sort()).toEqual(previous.map((entry) => entry.id).sort());
    expect(result.createdIds.some((id) => id === "historical" || previous.some((entry) => entry.id === id))).toBe(false);
    for (const component of components) {
      const id = result.componentNetIds.get(component.key)!;
      const inherited = previous.find((entry) => entry.id === id);
      if (inherited) expect(overlaps(inherited.members, component.members)).toBe(true);
      expect(result.nextActive.find((entry) => entry.id === id)!.members.map(token)).toEqual(component.members.map(token).sort());
    }
    for (const retired of result.retirements) {
      const predecessor = previous.find((entry) => entry.id === retired.id)!;
      expect(retired.successorIds).toEqual(components.filter((entry) => overlaps(predecessor.members, entry.members))
        .map((entry) => result.componentNetIds.get(entry.key)!).sort());
      for (const successor of components.filter((entry) => overlaps(predecessor.members, entry.members))) {
        expect(result.preservedIds).toContain(result.componentNetIds.get(successor.key)!);
      }
    }
  }
});
