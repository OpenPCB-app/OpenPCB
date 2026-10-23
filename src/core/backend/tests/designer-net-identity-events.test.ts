import { describe, expect, test } from "bun:test";
import type { NetReferenceSource } from "../../../shared/electrical-identity/references";
import type { DerivedNetComponent } from "../../../modules/designer/backend/projection-world";
import { bindNetIdentity, type BindResult } from "../../../modules/designer/backend/net-identity/bind";
import { createNetDependentsCensus, lazyCensus } from "../../../modules/designer/backend/net-identity/census";
import { buildNetIdentityEvents } from "../../../modules/designer/backend/net-identity/events";
import { formatDurableNetId, NetIdentityStateInvalidError, type ActiveNetRecord } from "../../../modules/designer/backend/net-identity/types";

const SALT = "aaaaaaaaaa";
const id = (seq: number): string => formatDurableNetId(SALT, seq);

function component(key: string, pins: string[], name?: string): DerivedNetComponent {
  return { key, pinIds: pins, wireIds: [], labelIds: [], primitiveIds: [], derivedName: name ?? null, nameSource: name ? "label" : "auto", legacyName: "Net_1" };
}

function record(seq: number, pins: string[], name = `Old ${seq}`): ActiveNetRecord {
  return { id: id(seq), name, nameSource: "auto", members: pins.map((id) => ({ kind: "pin", id })) };
}

function bind(previous: ActiveNetRecord[], components: DerivedNetComponent[]): BindResult {
  return bindNetIdentity({ previousActive: previous, components, salt: SALT, seqWatermark: 20, mode: "commit", pinLabel: (pin) => `Pin ${pin}` });
}

function dependents(netIds: string[] = []): NetReferenceSource {
  return {
    board: {}, traces: netIds.map((netId) => ({ id: `trace:${netId}`, netId })),
    vias: [], freePads: [], zones: [],
  };
}

describe("net identity transition events", () => {
  test("split retains predecessor name, reports kept pins and includes new lone-pin successor", () => {
    const previous = [record(1, ["a", "b", "c"], "Deleted BUS name")];
    const result = bind(previous, [component("left", ["a", "b"]), component("right", ["c"])]);
    const input = dependents();
    input.zones = [{ id: "disabled", netId: id(1), netName: null, enabled: false }];
    const events = buildNetIdentityEvents(previous, result, createNetDependentsCensus(input));
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.kind).toBe("split");
    if (event.kind !== "split") throw new Error("Expected split");
    expect(event.netId).toBe(id(1));
    expect(event.netName).toBe("Deleted BUS name");
    expect(event.keptPinCount).toBe(2);
    expect(event.hasDependents).toBe(true);
    expect(event.dependents.zones).toBe(1);
    expect(event.newNets).toEqual([{ netId: "nc:c", netName: "unconnected-(Pin c)", pinCount: 1 }]);
    expect(buildNetIdentityEvents(previous, result, createNetDependentsCensus(dependents()))[0]!.hasDependents).toBe(false);
  });

  test("split with no retained same-id successor reports zero kept pins", () => {
    const previous = [record(1, ["a", "b", "c"])];
    const result = bind(previous, [component("left", ["a", "b"]), component("right", ["c"])]);
    result.nets = result.nets.map((net) => net.id === id(1) ? { ...net, id: id(2) } : net);
    result.nextActive = result.nextActive.map((net) => ({ ...net, id: id(2) }));
    result.transitions = result.transitions.map((transition) => ({ ...transition, successorIds: [id(2), "nc:c"], inherited: [] }));
    const event = buildNetIdentityEvents(previous, result, createNetDependentsCensus(dependents()))[0]!;
    expect(event.kind === "split" && event.keptPinCount).toBe(0);
  });

  test("merge uses inherited survivor's new name and retired predecessor's old name/pins", () => {
    const previous = [record(1, ["a", "b"], "Deleted signal"), record(2, ["c", "d", "e"], "Old winner")];
    const result = bind(previous, [component("merged", ["a", "b", "c", "d", "e"], "New winner")]);
    const survivorOnly = buildNetIdentityEvents(previous, result, createNetDependentsCensus(dependents([id(2)])));
    expect(survivorOnly).toHaveLength(1);
    const event = survivorOnly[0]!;
    expect(event.kind).toBe("merge");
    if (event.kind !== "merge") throw new Error("Expected merge");
    expect(event.survivorNetId).toBe(id(2));
    expect(event.survivorName).toBe("New winner");
    expect(event.retired.map((row) => [row.netId, row.netName, row.pinCount])).toEqual([[id(1), "Deleted signal", 2]]);
    expect(event.hasDependents).toBe(false);
    expect(buildNetIdentityEvents(previous, result, createNetDependentsCensus(dependents([id(1)])))[0]!.hasDependents).toBe(true);
    expect(buildNetIdentityEvents(previous, result, createNetDependentsCensus(dependents()))[0]!.hasDependents).toBe(false);
  });

  test("reconfigure lists old predecessors and new successors in code-unit order; only retired dependents trigger visibility", () => {
    const previous = [record(9, ["a", "b"]), record(10, ["c", "d"]), record(11, ["e", "f"])];
    const result = bind(previous, [component("left", ["a", "c", "e"]), component("right", ["b", "d", "f"])]);
    const events = buildNetIdentityEvents(previous, result, createNetDependentsCensus(dependents([id(9)])));
    const event = events[0]!;
    expect(event.kind).toBe("reconfigure");
    if (event.kind !== "reconfigure") throw new Error("Expected reconfigure");
    expect(event.predecessors.map((row) => row.netId)).toEqual([id(10), id(11), id(9)]);
    expect(event.successors.map((row) => row.netId)).toEqual([id(10), id(9)]);
    expect(event.predecessors.filter((row) => row.retired).map((row) => row.netId)).toEqual([id(11)]);
    expect(event.hasDependents).toBe(false);
    expect(buildNetIdentityEvents(previous, result, createNetDependentsCensus(dependents([id(11)])))[0]!.hasDependents).toBe(true);
  });

  test("reconfigure includes nc successors and emits with zero dependents and no retired predecessors", () => {
    const previous = [record(1, ["a", "b", "c"]), record(2, ["d", "e", "f"])];
    const result = bind(previous, [component("left", ["a", "d"]), component("right", ["b", "e"]), component("lone-c", ["c"]), component("lone-f", ["f"])]);
    const event = buildNetIdentityEvents(previous, result, createNetDependentsCensus(dependents()))[0]!;
    expect(event.kind).toBe("reconfigure");
    if (event.kind !== "reconfigure") throw new Error("Expected reconfigure");
    expect(event.successors.map((row) => row.netId)).toEqual(["nc:c", "nc:f", id(1), id(2)]);
    expect(event.predecessors.every((row) => !row.retired)).toBe(true);
    expect(event.hasDependents).toBe(false);
  });

  test("removed event requires declared dependents and preserves vanished net's name", () => {
    const previous = [record(1, ["a", "b"], "Gone name"), record(2, ["c", "d"], "Quiet removal")];
    const result = bind(previous, []);
    const events = buildNetIdentityEvents(previous, result, createNetDependentsCensus(dependents([id(1)])));
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("removed");
    if (events[0]!.kind !== "removed") throw new Error("Expected removed");
    expect(events[0]!.netName).toBe("Gone name");
    expect(events[0]!.hasDependents).toBe(true);
    expect(events[0]!.dependents.traces).toBe(1);
    expect(buildNetIdentityEvents(previous, result, createNetDependentsCensus(dependents()))).toEqual([]);
    expect(buildNetIdentityEvents(previous, { ...result, retirements: [] }, createNetDependentsCensus(dependents([id(1)])))).toEqual([]);
  });

  test("nc pins and newly allocated auto nets produce no transition/removal events or census reads", () => {
    let calls = 0;
    const census = lazyCensus(() => { calls++; return dependents(); });
    expect(buildNetIdentityEvents([], bind([], [component("lone", ["a"])]), census)).toEqual([]);
    expect(buildNetIdentityEvents([], bind([], [component("wire", ["a", "b"])]), census)).toEqual([]);
    expect(calls).toBe(0);
  });

  test("binder transition order is retained, while nested successor and predecessor order is stable", () => {
    const previous = [record(1, ["a", "b"]), record(2, ["c", "d"])];
    const components = [component("a", ["a"]), component("b", ["b"]), component("c", ["c"]), component("d", ["d"])];
    const result = bind(previous, components);
    const census = createNetDependentsCensus(dependents());
    const original = buildNetIdentityEvents(previous, result, census);
    const reordered = bind([...previous].reverse(), [...components].reverse());
    expect(buildNetIdentityEvents([...previous].reverse(), reordered, census)).toEqual(original);
    reordered.transitions.reverse();
    expect(buildNetIdentityEvents(previous, reordered, census)).toEqual([...original].reverse());
  });

  test("event snapshots do not mutate inputs or expose census cached arrays", () => {
    const previous = [record(1, ["a", "b"])];
    const result = bind(previous, [component("a", ["a"]), component("b", ["b"])]);
    const input = dependents();
    input.board.lengthMatchGroups = [{ id: "bus", name: "Bus", netIds: [id(1), id(1)], target: { kind: "longest" }, toleranceMm: 0 }];
    const census = createNetDependentsCensus(input);
    const before = structuredClone({ previous, result, input });
    const event = buildNetIdentityEvents(previous, result, census)[0]!;
    if (event.kind !== "split") throw new Error("Expected split");
    event.dependents.lengthGroupIds.push("caller");
    expect(census.get(id(1)).lengthGroupIds).toEqual(["bus"]);
    expect({ previous, result, input }).toEqual(before);
  });

  test("missing transition records or impossible merge survivor fails without invented metadata", () => {
    const previous = [record(1, ["a", "b"]), record(2, ["c", "d", "e"])];
    const result = bind(previous, [component("merged", ["a", "b", "c", "d", "e"])]);
    const census = createNetDependentsCensus(dependents());
    expect(() => buildNetIdentityEvents([], result, census)).toThrow(NetIdentityStateInvalidError);
    expect(() => buildNetIdentityEvents(previous, { ...result, nextActive: [] }, census)).toThrow(NetIdentityStateInvalidError);
  });
});
