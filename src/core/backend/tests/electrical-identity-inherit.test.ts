import { describe, expect, test } from "bun:test";
import {
  reconcileElectricalIdentity,
  type ActiveElectricalNet,
  type ElectricalComponent,
  type ElectricalIdentityInput,
  type ElectricalIdentityResult,
  type ElectricalMember,
  type ElectricalPredecessorComparator,
} from "../../../shared/electrical-identity";

const pin = (id: string): ElectricalMember => ({ kind: "pin", id });
const wire = (id: string): ElectricalMember => ({ kind: "wire", id });
const label = (id: string): ElectricalMember => ({ kind: "label", id });
const old = (
  id: string,
  ...members: ElectricalMember[]
): ActiveElectricalNet => ({ id, members });
const current = (
  key: string,
  ...members: ElectricalMember[]
): ElectricalComponent => ({ key, members });
const token = (member: ElectricalMember): string =>
  JSON.stringify([member.kind, member.id]);

type Options = Partial<
  Omit<ElectricalIdentityInput, "previousActive" | "currentComponents">
>;
function inherit(
  previousActive: readonly ActiveElectricalNet[],
  currentComponents: readonly ElectricalComponent[],
  options: Options = {},
): ElectricalIdentityResult {
  let next = 0;
  return reconcileElectricalIdentity({
    previousActive,
    currentComponents,
    allocateId: () => `new-${next++}`,
    successorPolicy: "inherit-most-pins",
    ...options,
  });
}
const prefer =
  (...ranked: string[]): ElectricalPredecessorComparator =>
  (first, second) =>
    (ranked.includes(first) ? ranked.indexOf(first) : ranked.length) -
    (ranked.includes(second) ? ranked.indexOf(second) : ranked.length);
const survivor = (left: ActiveElectricalNet, right: ActiveElectricalNet) =>
  current("merged", ...left.members, ...right.members);

describe("inherit-most-pins: split keeper and merge survivor", () => {
  test("the fragment with the most pins keeps the ID; the rest allocate; nothing retires", () => {
    const result = inherit(
      [old("net", pin("a"), pin("b"), pin("c"), wire("w1"), wire("w2"))],
      [
        current("left", pin("a"), pin("b"), wire("w1")),
        current("right", pin("c"), wire("w2")),
      ],
    );
    expect([...result.componentNetIds]).toEqual([
      ["left", "net"],
      ["right", "new-0"],
    ]);
    expect(result.preservedIds).toEqual(["net"]);
    expect(result.createdIds).toEqual(["new-0"]);
    expect(result.retirements).toEqual([]);
    expect(result.transitions).toEqual([
      {
        kind: "split",
        predecessorIds: ["net"],
        successorIds: ["net", "new-0"],
        inherited: [{ fromId: "net", componentKey: "left" }],
      },
    ]);
  });

  test("a pure split always keeps its single predecessor, even into lone pins", () => {
    const result = inherit(
      [old("net", pin("a"), pin("b"), pin("c"))],
      [current("z", pin("a")), current("y", pin("b")), current("x", pin("c"))],
    );
    expect(result.componentNetIds.get("z")).toBe("net");
    expect(result.createdIds).toHaveLength(2);
    expect(result.retirements).toEqual([]);
  });

  test("the predecessor with the most pins survives a merge; losers retire merged and go inert", () => {
    const big = old("z-big", pin("a"), pin("b"), pin("c"));
    const small = old("a-small", pin("d"), wire("w"), label("l"));
    const result = inherit([big, small], [survivor(big, small)]);
    expect(result.componentNetIds.get("merged")).toBe("z-big");
    expect(result.retirements).toEqual([
      { id: "a-small", reason: "merged", successorIds: ["z-big"] },
    ]);
    expect(result.transitions).toEqual([
      {
        kind: "merge",
        predecessorIds: ["a-small", "z-big"],
        successorIds: ["z-big"],
        inherited: [{ fromId: "z-big", componentKey: "merged" }],
      },
    ]);
  });

  test("split then re-merge returns to the kept ID and retires the fragment ID", () => {
    const split = inherit(
      [old("net", pin("a"), pin("b"), pin("c"))],
      [current("left", pin("a"), pin("b")), current("right", pin("c"))],
    );
    const merged = inherit(
      split.nextActive,
      [current("whole", pin("a"), pin("b"), pin("c"))],
      {
        allocateId: () => "unused",
      },
    );
    expect(merged.componentNetIds.get("whole")).toBe("net");
    expect(merged.retirements).toEqual([
      { id: "new-0", reason: "merged", successorIds: ["net"] },
    ]);
  });
});

describe("inherit-most-pins: tie keys in order", () => {
  test("0 class beats pin overlap (H08: user-named beats auto-named)", () => {
    const auto = old("auto", pin("a"), pin("b"), pin("c")),
      named = old("named", pin("d"));
    const merged = [survivor(auto, named)];
    expect(inherit([auto, named], merged).componentNetIds.get("merged")).toBe(
      "auto",
    );
    expect(
      inherit([auto, named], merged, {
        comparePredecessorClass: prefer("named"),
      }).componentNetIds.get("merged"),
    ).toBe("named");
  });

  test("1 pin overlap beats successor pins (split) and predecessor pins (merge)", () => {
    const split = inherit(
      [old("net", pin("a"), pin("b"), pin("c"))],
      [
        current("left", pin("a"), pin("b")),
        current("right", pin("c"), pin("x"), pin("y"), pin("z")),
      ],
    );
    expect(split.componentNetIds.get("left")).toBe("net");
    const merge = inherit(
      [
        old("p", pin("a"), pin("gone-1"), pin("gone-2")),
        old("q", pin("b"), pin("d")),
      ],
      [current("m", pin("a"), pin("b"), pin("d"))],
    );
    expect(merge.componentNetIds.get("m")).toBe("q");
  });

  test("2 successor pins beat member overlap (split)", () => {
    const result = inherit(
      [old("net", pin("a"), pin("b"), wire("w1"), wire("w2"), wire("w3"))],
      [
        current("wired", pin("a"), wire("w1"), wire("w2"), wire("w3")),
        current("bigger", pin("b"), pin("n")),
      ],
    );
    expect(result.componentNetIds.get("bigger")).toBe("net");
  });

  test("3 predecessor pins beat the predecessor comparator (merge)", () => {
    const result = inherit(
      [old("p", pin("a"), pin("gone")), old("q", pin("b"))],
      [current("m", pin("a"), pin("b"))],
      { comparePredecessors: prefer("q") },
    );
    expect(result.componentNetIds.get("m")).toBe("p");
  });

  test("4 the predecessor comparator beats member overlap: equal pins, only one carries copper", () => {
    const wired = old("wired", pin("a"), wire("w1"), wire("w2")),
      copper = old("copper", pin("b"));
    const merged = [survivor(wired, copper)];
    expect(inherit([wired, copper], merged).componentNetIds.get("merged")).toBe(
      "wired",
    );
    expect(
      inherit([wired, copper], merged, {
        comparePredecessors: prefer("copper"),
      }).componentNetIds.get("merged"),
    ).toBe("copper");
  });

  test("4 overrides 6: numeric seq beats code-unit text, and dependents beat seq", () => {
    const ten = old("net:aaaaaaaaaa:10", pin("a")),
      nine = old("net:aaaaaaaaaa:9", pin("b"));
    const merged = [survivor(ten, nine)];
    const seq = (id: string): number => Number(id.split(":")[2]);
    const dependents = new Map([["net:aaaaaaaaaa:10", 3]]);
    const binder: ElectricalPredecessorComparator = (first, second) =>
      (dependents.get(second) ?? 0) - (dependents.get(first) ?? 0) ||
      seq(first) - seq(second);
    expect(inherit([ten, nine], merged).componentNetIds.get("merged")).toBe(
      ten.id,
    );
    expect(
      inherit([ten, nine], merged, {
        comparePredecessors: (a, b) => seq(a) - seq(b),
      }).componentNetIds.get("merged"),
    ).toBe(nine.id);
    expect(
      inherit([ten, nine], merged, {
        comparePredecessors: binder,
      }).componentNetIds.get("merged"),
    ).toBe(ten.id);
  });

  test("5 member overlap beats predecessor text (merge) and successor membership (split)", () => {
    const merge = inherit(
      [old("a-net", pin("a")), old("b-net", pin("b"), wire("w"))],
      [current("m", pin("a"), pin("b"), wire("w"))],
    );
    expect(merge.componentNetIds.get("m")).toBe("b-net");
    const split = inherit(
      [old("net", pin("a"), pin("b"), wire("w"))],
      [current("first", pin("a")), current("second", pin("b"), wire("w"))],
    );
    expect(split.componentNetIds.get("second")).toBe("net");
  });

  test("6 predecessor text, then 7 successor membership (never the component key)", () => {
    const merge = inherit(
      [old("b", pin("x")), old("a", pin("y"))],
      [current("m", pin("x"), pin("y"))],
    );
    expect(merge.componentNetIds.get("m")).toBe("a");
    const split = inherit(
      [old("net", pin("a"), pin("b"))],
      [current("z-key", pin("a")), current("a-key", pin("b"))],
    );
    expect(split.componentNetIds.get("z-key")).toBe("net");
  });

  test("a NaN preference is a tie; hooks only ever compare two different predecessors", () => {
    const calls: Array<[string, string]> = [];
    const record =
      (result: number): ElectricalPredecessorComparator =>
      (first, second) => {
        calls.push([first, second]);
        return result;
      };
    const previous = [old("b", pin("x")), old("a", pin("y"))];
    const merged = [current("m", pin("x"), pin("y"))];
    const nan = inherit(previous, merged, {
      comparePredecessorClass: record(Number.NaN),
      comparePredecessors: record(Number.NaN),
    });
    expect(nan.componentNetIds.get("m")).toBe("a");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([first, second]) => first !== second)).toBe(true);
    calls.length = 0;
    inherit(
      [old("net", pin("a"), pin("b"))],
      [current("l", pin("a")), current("r", pin("b"))],
      {
        comparePredecessorClass: record(1),
        comparePredecessors: record(1),
      },
    );
    expect(calls).toEqual([]);
  });
});

describe("inherit-most-pins: many-to-many", () => {
  test("a cluster with an unmatched predecessor retires it reconfigured; heirs are one-to-one", () => {
    const result = inherit(
      [
        old("p", pin("a"), pin("b"), pin("c")),
        old("q", pin("d")),
        old("r", pin("e")),
      ],
      [
        current("c1", pin("a"), pin("b"), pin("d")),
        current("c2", pin("c"), pin("e")),
      ],
    );
    expect([...result.componentNetIds]).toEqual([
      ["c1", "p"],
      ["c2", "r"],
    ]);
    expect(result.retirements).toEqual([
      { id: "q", reason: "reconfigured", successorIds: ["p"] },
    ]);
    expect(result.transitions).toEqual([
      {
        kind: "reconfigure",
        predecessorIds: ["p", "q", "r"],
        successorIds: ["p", "r"],
        inherited: [
          { fromId: "p", componentKey: "c1" },
          { fromId: "r", componentKey: "c2" },
        ],
      },
    ]);
  });

  test("an unmatched successor allocates while every predecessor is inherited", () => {
    const result = inherit(
      [old("p", pin("a"), pin("b")), old("q", pin("c"), pin("d"))],
      [
        current("c1", pin("a"), pin("c")),
        current("c2", pin("b")),
        current("c3", pin("d")),
      ],
    );
    expect([...result.componentNetIds]).toEqual([
      ["c1", "p"],
      ["c2", "new-0"],
      ["c3", "q"],
    ]);
    expect(result.retirements).toEqual([]);
    expect(result.transitions[0]!.successorIds).toEqual(["new-0", "p", "q"]);
  });
});

describe("inherit-most-pins: transitions, reuse and validation", () => {
  const mixedPrevious = [
    old("kept", pin("k")),
    old("gone", pin("g")),
    old("split", pin("s1"), pin("s2")),
    old("m1", pin("m1")),
    old("m2", pin("m2"), pin("m3")),
  ];
  const mixedCurrent = [
    current("kept", pin("k"), pin("k2")),
    current("s-left", pin("s1")),
    current("s-right", pin("s2")),
    current("merged", pin("m1"), pin("m2"), pin("m3")),
    current("fresh", pin("f")),
  ];

  test("continuity, removal and creation are not transitions; both policies report the same clusters", () => {
    const retire = reconcileElectricalIdentity({
      previousActive: mixedPrevious,
      currentComponents: mixedCurrent,
      allocateId: (() => {
        let next = 0;
        return () => `new-${next++}`;
      })(),
      successorPolicy: "retire",
    });
    const kept = inherit(mixedPrevious, mixedCurrent);
    const shape = (result: ElectricalIdentityResult) =>
      result.transitions.map(({ kind, predecessorIds }) => ({
        kind,
        predecessorIds,
      }));
    expect(shape(retire)).toEqual([
      { kind: "merge", predecessorIds: ["m1", "m2"] },
      { kind: "split", predecessorIds: ["split"] },
    ]);
    expect(shape(kept)).toEqual(shape(retire));
    expect(retire.transitions.every((row) => row.inherited.length === 0)).toBe(
      true,
    );
    expect(kept.transitions.map((row) => row.inherited)).toEqual([
      [{ fromId: "m2", componentKey: "merged" }],
      [{ fromId: "split", componentKey: "s-left" }],
    ]);
    expect(kept.retirements).toEqual([
      { id: "gone", reason: "removed", successorIds: [] },
      { id: "m1", reason: "merged", successorIds: ["m2"] },
    ]);
  });

  test("the allocator runs once per fresh successor and can recycle no inherited, retiring or ledger ID", () => {
    const requests: string[] = [];
    const result = inherit(mixedPrevious, mixedCurrent, {
      allocateId: (request) => {
        requests.push(request.componentKey);
        return `fresh-${requests.length}`;
      },
    });
    expect(requests).toEqual(["fresh", "s-right"]);
    expect(result.createdIds).toEqual(["fresh-1", "fresh-2"]);
    for (const collision of ["split", "m1", "gone", "historical"])
      expect(() =>
        inherit(mixedPrevious, mixedCurrent, {
          retiredIds: ["historical"],
          allocateId: () => collision,
        }),
      ).toThrow("Allocated ID collision");
  });

  test("an invalid policy or hook fails before any allocation", () => {
    const malformed: unknown[] = [
      { successorPolicy: undefined },
      { successorPolicy: "most-pins" },
      { successorPolicy: null },
      { comparePredecessors: 1 },
      { comparePredecessors: null },
      { comparePredecessorClass: "named" },
    ];
    for (const candidate of malformed) {
      let calls = 0;
      expect(() =>
        inherit(mixedPrevious, mixedCurrent, {
          ...(candidate as Options),
          allocateId: () => `call-${calls++}`,
        }),
      ).toThrow(/successorPolicy|must be a function/);
      expect(calls).toBe(0);
    }
  });
});

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function shuffle<T>(values: readonly T[], next: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}
function groups(
  members: readonly ElectricalMember[],
  next: () => number,
): ElectricalMember[][] {
  const result: ElectricalMember[][] = Array.from(
    { length: 1 + Math.floor(next() * 7) },
    () => [],
  );
  for (const member of members)
    result[Math.floor(next() * result.length)]!.push(member);
  return result.filter((group) => group.length > 0);
}
const shared = (
  first: readonly ElectricalMember[],
  second: readonly ElectricalMember[],
  pinsOnly = false,
) =>
  first.filter(
    (member) =>
      (!pinsOnly || member.kind === "pin") &&
      second.some((other) => token(other) === token(member)),
  ).length;
function snapshot(result: ElectricalIdentityResult): string {
  return JSON.stringify({
    ...result,
    componentNetIds: [...result.componentNetIds],
  });
}

test("200 seeded partitions: permutation invariant, one-to-one heirs, best-ranked survivors, no reuse", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const next = random(seed);
    const members = Array.from({ length: 20 }, (_, index) =>
      index % 3 === 2
        ? wire(`w-${index}`)
        : index % 7 === 6
          ? label(`l-${index}`)
          : pin(`p-${index}`),
    );
    // Mixed durable and unsequenced IDs: the binder-style preference must tie (NaN) between the latter.
    const previous = groups(members, next).map((group, index) =>
      old(
        index % 4 === 3 ? `legacy-${index}` : `net:s:${index * 3 + 1}`,
        ...group,
      ),
    );
    const named = new Set(
      previous.filter(() => next() < 0.3).map((net) => net.id),
    );
    const dependents = new Map(
      previous.map((net) => [net.id, Math.floor(next() * 3)]),
    );
    const seq = (id: string) =>
      id.startsWith("net:") ? Number(id.split(":")[2]) : Infinity;
    const options: Options = {
      retiredIds: ["net:s:1000"],
      comparePredecessorClass: (a, b) =>
        Number(named.has(b)) - Number(named.has(a)),
      comparePredecessors: (a, b) =>
        dependents.get(b)! - dependents.get(a)! || seq(a) - seq(b),
    };
    const components = groups(
      [
        ...members.filter(() => next() > 0.15),
        pin(`added-${seed}`),
        wire(`added-w-${seed}`),
      ],
      next,
    ).map((group, index) => current(`component-${index}`, ...group));
    let allocations = 0;
    const run = (nets: ActiveElectricalNet[], parts: ElectricalComponent[]) =>
      inherit(nets, parts, {
        ...options,
        allocateId: () => `fresh-${allocations++}`,
      });
    const result = run(previous, components);
    expect(allocations).toBe(result.createdIds.length);
    allocations = 0;
    const permuted = run(
      shuffle(previous, next).map((net) =>
        old(net.id, ...shuffle(net.members, next)),
      ),
      shuffle(components, next).map((component) =>
        current(component.key, ...shuffle(component.members, next)),
      ),
    );
    expect(snapshot(permuted)).toBe(snapshot(result));

    const retired = new Set(result.retirements.map((row) => row.id));
    const preserved = new Set(result.preservedIds);
    expect(
      previous.every((net) => retired.has(net.id) !== preserved.has(net.id)),
    ).toBe(true);
    for (const id of result.createdIds)
      expect(previous.some((net) => net.id === id) || id === "net:s:1000").toBe(
        false,
      );
    const heirs = new Map<string, string>();
    for (const component of components) {
      const id = result.componentNetIds.get(component.key)!;
      const predecessor = previous.find((net) => net.id === id);
      if (!predecessor) continue;
      expect(heirs.has(id)).toBe(false);
      heirs.set(id, component.key);
      expect(shared(predecessor.members, component.members)).toBeGreaterThan(0);
    }
    for (const transition of result.transitions) {
      const successors = components.filter((component) =>
        transition.successorIds.includes(
          result.componentNetIds.get(component.key)!,
        ),
      );
      expect([...transition.predecessorIds].sort()).toEqual([
        ...transition.predecessorIds,
      ]);
      const predecessors = transition.predecessorIds.map((id) =>
        previous.find((net) => net.id === id)!,
      );
      expect(transition.inherited).toEqual(
        predecessors
          .filter((net) => heirs.has(net.id))
          .map((net) => ({ fromId: net.id, componentKey: heirs.get(net.id)! })),
      );
      if (transition.kind === "split") {
        const [only] = predecessors;
        const best = Math.max(
          ...successors.map((component) =>
            shared(only!.members, component.members, true),
          ),
        );
        const heir = successors.find(
          (component) => component.key === heirs.get(only!.id),
        )!;
        expect(shared(only!.members, heir.members, true)).toBe(best);
      }
      if (transition.kind === "merge") {
        const [only] = successors;
        const winner = predecessors.find(
          (net) => net.id === result.componentNetIds.get(only!.key),
        )!;
        const topClass = predecessors.some((net) => named.has(net.id));
        expect(named.has(winner.id)).toBe(topClass);
        const rivals = predecessors.filter(
          (net) => named.has(net.id) === topClass,
        );
        const best = Math.max(
          ...rivals.map((net) => shared(net.members, only!.members, true)),
        );
        expect(shared(winner.members, only!.members, true)).toBe(best);
      }
      const reason = (
        {
          split: "split",
          merge: "merged",
          reconfigure: "reconfigured",
        } as const
      )[transition.kind];
      for (const id of transition.predecessorIds)
        if (retired.has(id))
          expect(result.retirements.find((row) => row.id === id)!.reason).toBe(
            reason,
          );
    }
  }
});
