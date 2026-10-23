import { describe, expect, test } from "bun:test";
import {
  reconcileElectricalIdentity,
  type ActiveElectricalNet,
  type ElectricalComponent,
  type ElectricalIdentityInput,
  type ElectricalIdentityResult,
  type ElectricalMember,
  type ElectricalNetAllocation,
} from "../../../shared/electrical-identity";

const pin = (id: string): ElectricalMember => ({ kind: "pin", id });
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
function allocate(): (request: ElectricalNetAllocation) => string {
  let next = 0;
  return () => `new-${next++}`;
}
function reconcile(
  previousActive: readonly ActiveElectricalNet[],
  currentComponents: readonly ElectricalComponent[],
): ElectricalIdentityResult {
  return reconcileElectricalIdentity({
    successorPolicy: "retire",
    previousActive,
    currentComponents,
    allocateId: allocate(),
  });
}
function snapshot(result: ElectricalIdentityResult): string {
  return JSON.stringify({
    ...result,
    componentNetIds: [...result.componentNetIds],
  });
}

describe("electrical identity continuity", () => {
  test("stable pin/wire/label/primitive IDs preserve a net despite unrelated geometry and names", () => {
    const members: ElectricalMember[] = [
      pin("part-A:pin-2"),
      pin("part-B:pin-1"),
      { kind: "wire", id: "wire-1" },
      { kind: "label", id: "label-1" },
      { kind: "primitive", id: "junction-1" },
    ];
    const before = {
      ...old("durable-net", ...members),
      x: 0,
      y: 0,
      rotation: 0,
      reference: "R1",
      name: "GND",
      aliases: ["ground"],
    };
    const after = {
      ...current("changed-derived-component", ...members.slice().reverse()),
      x: 10160000,
      y: -10160000,
      rotation: 90,
      reference: "R9",
      name: "earth",
      aliases: ["changed"],
    };
    const result = reconcile([before], [after]);
    expect(result.preservedIds).toEqual(["durable-net"]);
    expect(result.createdIds).toEqual([]);
    expect(result.retirements).toEqual([]);
    expect(result.componentNetIds.get(after.key)).toBe("durable-net");
    expect(result.nextActive[0]!.members.map(token)).toEqual(
      members.map(token).sort(),
    );
  });

  test("adding then removing one pin keeps one-to-one continuity", () => {
    const added = reconcile(
      [old("stable", pin("a"), pin("b"))],
      [current("first", pin("a"), pin("b"), pin("c"))],
    );
    const removed = reconcile(added.nextActive, [
      current("second", pin("a"), pin("c")),
    ]);
    expect(added.preservedIds).toEqual(["stable"]);
    expect(removed.preservedIds).toEqual(["stable"]);
    expect(removed.nextActive).toEqual([old("stable", pin("a"), pin("c"))]);
  });

  test("complete member replacement retires instead of preserving a reused transient component key", () => {
    const result = reconcile(
      [old("old", pin("gone"))],
      [current("old-coordinate", pin("unrelated"))],
    );
    expect(result.createdIds).toEqual(["new-0"]);
    expect(result.preservedIds).toEqual([]);
    expect(result.retirements).toEqual([
      { id: "old", reason: "removed", successorIds: [] },
    ]);
  });

  test("an unrelated pin at an old coordinate cannot steal ID or assignment", () => {
    const before = {
      ...old("routed", pin("resistor-a"), pin("resistor-b")),
      x: 0,
      y: 0,
    };
    const moved = {
      ...current("moved", pin("resistor-a"), pin("resistor-b")),
      x: 10,
      y: 10,
    };
    const unrelated = {
      ...current("old-coordinate", pin("capacitor")),
      x: 0,
      y: 0,
    };
    const result = reconcile([before], [moved, unrelated]);
    expect(result.componentNetIds.get("moved")).toBe("routed");
    expect(result.componentNetIds.get("old-coordinate")).toBe("new-0");
    expect(
      result.nextActive.find((net) => net.id === "routed")!.members,
    ).toEqual([pin("resistor-a"), pin("resistor-b")]);
  });

  test("removed old nets retire; zero-overlap new nets allocate; an empty graph is valid", () => {
    expect(reconcile([old("removed", pin("a"))], []).retirements).toEqual([
      { id: "removed", reason: "removed", successorIds: [] },
    ]);
    expect(reconcile([], [current("new", pin("b"))]).createdIds).toEqual([
      "new-0",
    ]);
    expect(snapshot(reconcile([], []))).toBe(
      JSON.stringify({
        nextActive: [],
        componentNetIds: [],
        createdIds: [],
        preservedIds: [],
        retirements: [],
        transitions: [],
      }),
    );
  });

  test("typed namespaces and escaped IDs never collide", () => {
    const strange: ElectricalMember[] = [
      pin("wire:a"),
      { kind: "wire", id: "a" },
      pin('x\"],[\"wire\",\"y'),
      { kind: "label", id: "same" },
      { kind: "primitive", id: "same" },
    ];
    const result = reconcile(
      strange.map((member, index) => old(`net-${index}`, member)),
      strange.map((member, index) => current(`component-${index}`, member)),
    );
    expect(result.preservedIds).toHaveLength(strange.length);
    expect(
      reconcile(
        [old("pin-net", pin("same"))],
        [current("wire", { kind: "wire", id: "same" })],
      ).preservedIds,
    ).toEqual([]);
  });
});

describe("explicit electrical retirement", () => {
  test("a split retires every predecessor even when a branch contains most members", () => {
    const result = reconcile(
      [old("split-old", pin("a"), pin("b"), pin("c"))],
      [current("left", pin("a"), pin("b")), current("right", pin("c"))],
    );
    expect(result.preservedIds).toEqual([]);
    expect(result.retirements).toEqual([
      { id: "split-old", reason: "split", successorIds: ["new-0", "new-1"] },
    ]);
  });

  test("a merge retires all predecessors and allocates one fresh successor", () => {
    const result = reconcile(
      [old("first", pin("a")), old("second", pin("b"))],
      [current("merged", pin("a"), pin("b"))],
    );
    expect(result.preservedIds).toEqual([]);
    expect(result.retirements).toEqual([
      { id: "first", reason: "merged", successorIds: ["new-0"] },
      { id: "second", reason: "merged", successorIds: ["new-0"] },
    ]);
  });

  test("asymmetric many-to-many labels all predecessors reconfigured but lists only direct successors", () => {
    const result = reconcile(
      [
        old("first", pin("a"), pin("b")),
        old("second", pin("c")),
        old("unaffected", pin("d")),
      ],
      [
        current("left", pin("a")),
        current("right", pin("b"), pin("c")),
        current("other", pin("d")),
      ],
    );
    expect(result.preservedIds).toEqual(["unaffected"]);
    expect(result.retirements).toEqual([
      { id: "first", reason: "reconfigured", successorIds: ["new-0", "new-1"] },
      { id: "second", reason: "reconfigured", successorIds: ["new-1"] },
    ]);
  });

  test("split IDs stay reserved across subsequent transitions", () => {
    const split = reconcile(
      [old("retired-net", pin("a"), pin("b"))],
      [current("a", pin("a")), current("b", pin("b"))],
    );
    expect(() =>
      reconcileElectricalIdentity({
        successorPolicy: "retire",
        previousActive: split.nextActive,
        currentComponents: [current("unrelated", pin("c"))],
        retiredIds: split.retirements.map((row) => row.id),
        allocateId: () => "retired-net",
      }),
    ).toThrow("Allocated ID collision");
  });
});

describe("validation and deterministic allocation", () => {
  test("all malformed membership/IDs fail before any allocation", () => {
    const valid: ElectricalIdentityInput = {
      successorPolicy: "retire",
      previousActive: [old("old", pin("a"))],
      currentComponents: [current("new", pin("b"))],
      allocateId: allocate(),
    };
    const malformed: unknown[] = [
      {
        ...valid,
        previousActive: [old("old", pin("a")), old("old", pin("c"))],
      },
      {
        ...valid,
        currentComponents: [current("new", pin("b")), current("new", pin("c"))],
      },
      { ...valid, previousActive: [old("", pin("a"))] },
      { ...valid, currentComponents: [current(" ", pin("b"))] },
      { ...valid, previousActive: [old("old")] },
      { ...valid, currentComponents: [current("new")] },
      { ...valid, previousActive: [old("old", pin("a"), pin("a"))] },
      { ...valid, currentComponents: [current("new", pin("b"), pin("b"))] },
      {
        ...valid,
        previousActive: [old("old", pin("a")), old("other", pin("a"))],
      },
      {
        ...valid,
        currentComponents: [
          current("new", pin("b")),
          current("other", pin("b")),
        ],
      },
      { ...valid, currentComponents: [current("new", pin(""))] },
      {
        ...valid,
        currentComponents: [
          { key: "new", members: [{ kind: "coordinate", id: "0:0" }] },
        ],
      },
      { ...valid, retiredIds: [""] },
      { ...valid, retiredIds: ["retired", "retired"] },
      { ...valid, retiredIds: ["old"] },
      { ...valid, retiredIds: null },
      { ...valid, previousActive: null },
      { ...valid, currentComponents: [null] },
      { ...valid, currentComponents: [{ key: "new", members: null }] },
      { ...valid, currentComponents: [{ key: 1, members: [pin("b")] }] },
    ];
    for (const candidate of malformed) {
      let calls = 0;
      const input = {
        ...(candidate as ElectricalIdentityInput),
        allocateId: () => {
          calls++;
          return "new";
        },
      };
      expect(() => reconcileElectricalIdentity(input)).toThrow();
      expect(calls).toBe(0);
    }
    expect(() =>
      reconcileElectricalIdentity({
        ...valid,
        allocateId: null,
      } as unknown as ElectricalIdentityInput),
    ).toThrow("allocateId");
  });

  test("allocator cannot recycle any prior active, historical or newly allocated ID", () => {
    for (const collision of ["retiring", "preserving", "historical"]) {
      expect(() =>
        reconcileElectricalIdentity({
          successorPolicy: "retire",
          previousActive: [
            old("retiring", pin("a")),
            old("preserving", pin("b")),
          ],
          currentComponents: [
            current("kept", pin("b")),
            current("new", pin("c")),
          ],
          retiredIds: ["historical"],
          allocateId: () => collision,
        }),
      ).toThrow("Allocated ID collision");
    }
    expect(() =>
      reconcileElectricalIdentity({
        successorPolicy: "retire",
        previousActive: [],
        currentComponents: [current("one", pin("a")), current("two", pin("b"))],
        allocateId: () => "duplicate",
      }),
    ).toThrow("Allocated ID collision");
    for (const invalid of ["", " ", 1, null]) {
      expect(() =>
        reconcileElectricalIdentity({
          successorPolicy: "retire",
          previousActive: [],
          currentComponents: [current("one", pin("a"))],
          allocateId: () => invalid,
        } as unknown as ElectricalIdentityInput),
      ).toThrow("Allocated ID must be a nonempty string");
    }
  });

  test("allocation receives canonical members in membership order before component key", () => {
    const requests: ElectricalNetAllocation[] = [];
    const result = reconcileElectricalIdentity({
      successorPolicy: "retire",
      previousActive: [],
      currentComponents: [
        current("A", pin("z")),
        current("Z", pin("b"), pin("a")),
      ],
      allocateId: (request) => {
        requests.push(request);
        return `allocated-${requests.length}`;
      },
    });
    expect(requests).toEqual([
      { componentKey: "Z", members: [pin("a"), pin("b")] },
      { componentKey: "A", members: [pin("z")] },
    ]);
    expect([...result.componentNetIds]).toEqual([
      ["A", "allocated-2"],
      ["Z", "allocated-1"],
    ]);
    expect(Object.isFrozen(requests[0])).toBe(true);
    expect(Object.isFrozen(requests[0]!.members)).toBe(true);
    expect(Object.isFrozen(requests[0]!.members[0])).toBe(true);
  });

  test("canonical output uses code-unit ordering, including hostile map keys", () => {
    const ids = ["ä", "a", "Z", "A", "__proto__", "constructor"];
    const result = reconcile(
      ids.map((id) => old(id, pin(id))),
      ids.map((id) => current(id, pin(id))),
    );
    expect(result.preservedIds).toEqual([
      "A",
      "Z",
      "__proto__",
      "a",
      "constructor",
      "ä",
    ]);
    expect(result.nextActive.map((net) => net.id)).toEqual([
      ...result.preservedIds,
    ]);
    expect([...result.componentNetIds.keys()]).toEqual([
      ...result.preservedIds,
    ]);
    expect(result.componentNetIds.get("__proto__")).toBe("__proto__");
  });

  test("frozen inputs never mutate, and returned membership never aliases the input", () => {
    const member = Object.freeze(pin("a")),
      members = Object.freeze([member]);
    const previous = Object.freeze([Object.freeze(old("old", ...members))]);
    const components = Object.freeze([
      Object.freeze(current("current", ...members)),
    ]);
    Object.freeze(previous[0]!.members);
    Object.freeze(components[0]!.members);
    const before = JSON.stringify({ previous, components });
    const result = reconcile(previous, components);
    expect(JSON.stringify({ previous, components })).toBe(before);
    expect(result.nextActive[0]!.members).not.toBe(components[0]!.members);
    expect(result.nextActive[0]!.members[0]).not.toBe(member);
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
function partitions(
  members: readonly ElectricalMember[],
  next: () => number,
): ElectricalMember[][] {
  const groups: ElectricalMember[][] = Array.from(
    { length: 1 + Math.floor(next() * 8) },
    () => [],
  );
  for (const member of members)
    groups[Math.floor(next() * groups.length)]!.push(member);
  return groups.filter((group) => group.length > 0);
}
function hasOverlap(
  first: readonly ElectricalMember[],
  second: readonly ElectricalMember[],
): boolean {
  return first.some((member) =>
    second.some((other) => token(member) === token(other)),
  );
}

test("200 seeded partitions preserve only one-to-one overlaps, reserve every old ID, and ignore input permutations", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const next = random(seed),
      members = Array.from({ length: 24 }, (_, index) =>
        pin(`member-${index}`),
      );
    const previous = partitions(members, next).map((group, index) =>
      old(`old-${index}`, ...group),
    );
    const components = partitions(
      [...members.filter(() => next() > 0.2), pin(`added-${seed}`)],
      next,
    ).map((group, index) => current(`component-${index}`, ...group));
    const result = reconcile(previous, components);
    const permuted = reconcile(
      shuffle(previous, next).map((net) =>
        old(net.id, ...shuffle(net.members, next)),
      ),
      shuffle(components, next).map((component) =>
        current(component.key, ...shuffle(component.members, next)),
      ),
    );
    expect(snapshot(permuted)).toBe(snapshot(result));
    expect(new Set(result.nextActive.map((net) => net.id)).size).toBe(
      components.length,
    );
    expect([...result.componentNetIds.keys()]).toEqual(
      components.map((component) => component.key).sort(),
    );
    for (const component of components) {
      const predecessors = previous.filter((net) =>
        hasOverlap(net.members, component.members),
      );
      const preserved =
        predecessors.length === 1 &&
        components.filter((candidate) =>
          hasOverlap(predecessors[0]!.members, candidate.members),
        ).length === 1;
      const id = result.componentNetIds.get(component.key)!;
      if (preserved) expect(id).toBe(predecessors[0]!.id);
      else expect(previous.some((net) => net.id === id)).toBe(false);
      expect(
        result.nextActive.find((net) => net.id === id)!.members.map(token),
      ).toEqual(component.members.map(token).sort());
    }
    for (const predecessor of previous) {
      const retirement = result.retirements.find(
        (row) => row.id === predecessor.id,
      );
      expect(Boolean(retirement)).toBe(
        !result.preservedIds.includes(predecessor.id),
      );
      if (retirement)
        expect(retirement.successorIds).toEqual(
          components
            .filter((component) =>
              hasOverlap(predecessor.members, component.members),
            )
            .map((component) => result.componentNetIds.get(component.key)!)
            .sort(),
        );
    }
  }
});
