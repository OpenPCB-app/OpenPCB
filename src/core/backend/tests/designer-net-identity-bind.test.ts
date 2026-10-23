import { describe, expect, test } from "bun:test";
import type { ElectricalMember } from "../../../shared/electrical-identity";
import { reconcileElectricalIdentity } from "../../../shared/electrical-identity";
import { bindNetIdentity, type BindInput, type BindResult } from "../../../modules/designer/backend/net-identity/bind";
import { memberToken } from "../../../modules/designer/backend/net-identity/bind-input";
import { sanitizePreviousActive } from "../../../modules/designer/backend/net-identity/bind-sanitize";
import { formatDurableNetId, type ActiveNetRecord } from "../../../modules/designer/backend/net-identity/types";
import { deriveNetComponents, type DerivedNetComponent } from "../../../modules/designer/backend/projection-world";
import { loadLegacyFixtureSource } from "./helpers/legacy-net-fixture-source";

const SALT = "aaaaaaaaaa";
const id = (seq: number): string => formatDurableNetId(SALT, seq);
const pin = (value: string): ElectricalMember => ({ kind: "pin", id: value });
const token = (value: string): string => memberToken(pin(value));

function component(key: string, pins: string[], extra: Partial<DerivedNetComponent> = {}): DerivedNetComponent {
  return { key, pinIds: pins, wireIds: [], labelIds: [], primitiveIds: [], derivedName: null, nameSource: "auto", legacyName: "Net_1", ...extra };
}
function members(value: DerivedNetComponent): ElectricalMember[] {
  return [
    ...value.pinIds.map(pin), ...value.wireIds.map((id) => ({ kind: "wire" as const, id })),
    ...value.labelIds.map((id) => ({ kind: "label" as const, id })),
    ...value.primitiveIds.map((id) => ({ kind: "primitive" as const, id })),
  ];
}
function record(seq: number, pins: string[], extra: Partial<ActiveNetRecord> = {}): ActiveNetRecord {
  return { id: id(seq), name: `Net_${seq}`, nameSource: "auto", members: pins.map(pin), ...extra };
}
function bind(components: DerivedNetComponent[], previousActive: ActiveNetRecord[] = [], extra: Partial<BindInput> = {}): BindResult {
  return bindNetIdentity({ components, previousActive, salt: SALT, seqWatermark: 1, mode: "commit", pinLabel: () => undefined, ...extra });
}

describe("durable binding and fast path", () => {
  test("commit ids use the watermark and numeric order; read results stay ephemeral", () => {
    const components = [component("z", ["b", "c"]), component("a", ["a"], { wireIds: ["w"] }), component("lone", ["l"] )];
    const committed = bind(components, [], { seqWatermark: 9 });
    expect(committed.nets.map((net) => net.id)).toEqual([id(9), id(10), "nc:l"]);
    expect(committed.nextSeq).toBe(11);
    expect(committed.createdIds).toEqual([id(9), id(10)]);
    expect(committed.nextActive).toHaveLength(2);
    const read = bind(components, [], { mode: "read", seqWatermark: 99 });
    expect(read.nets.map((net) => net.id)).toEqual(["nc:l", "pending:0", "pending:1"]);
    expect(read.nets.map((net) => net.name)).toEqual(["unconnected-(l)", "Net_pending_0", "Net_pending_1"]);
    expect(read.nextActive).toEqual([]);
    expect(read.createdIds).toEqual([]);
    expect(read.nextSeq).toBe(1);
    expect(read.inSync).toBe(false);
  });

  test("lone pins never consume a sequence or create durable records", () => {
    const result = bind([component("a", ["p"]), component("b", ["q"])], [], { pinLabel: (pinId) => pinId === "p" ? "R1-2" : undefined });
    expect(result.nets.map((net) => net.name)).toEqual(["unconnected-(R1-2)", "unconnected-(q)"]);
    expect(result.nextSeq).toBe(1);
    expect(result.nextActive).toEqual([]);
    expect(result.createdIds).toEqual([]);
    expect(result.preservedIds).toEqual([]);
    expect(result.inSync).toBe(true);
  });

  test("an exact inherited lone durable record stays durable and skips dependents", () => {
    const result = bind([component("moved", ["a"]), component("new", ["b"])], [record(9, ["a"])], {
      dependentCount: () => { throw new Error("fast path read dependents"); },
    });
    expect(result.nets.map((net) => net.id)).toEqual([id(9), "nc:b"]);
    expect(result.nextActive.map((entry) => entry.id)).toEqual([id(9)]);
    expect(result.preservedIds).toEqual([id(9)]);
    expect(result.inSync).toBe(true);
  });

  test("a real split preserves its durable lone keeper on the next fast-path bind", () => {
    const components = [component("left", ["a"]), component("right", ["b"])];
    const split = bind(components, [record(1, ["a", "b"])]);
    expect(split.nets.map((net) => net.id)).toEqual([id(1), "nc:b"]);
    expect(split.nextActive).toEqual([record(1, ["a"])]);
    expect(split.createdIds).toEqual([]);
    expect(split.nextSeq).toBe(2);
    const next = bind(components, split.nextActive, {
      dependentCount: () => { throw new Error("unexpected fast-path census"); },
    });
    expect(next.nextActive).toEqual(split.nextActive);
    expect(next.inSync).toBe(true);
  });

  test("the fast path preserves the same membership mapping as the kernel", () => {
    const components = [component("new-root", ["b", "a"]), component("lone", ["c"])];
    const previous = [record(10, ["a", "b"]), record(9, ["c"])];
    const fast = bind(components, previous);
    const kernel = reconcileElectricalIdentity({
      previousActive: previous,
      currentComponents: components.map((entry) => ({ key: entry.key, members: members(entry) })),
      successorPolicy: "inherit-most-pins", allocateId: () => { throw new Error("unexpected allocation"); },
    });
    expect(fast.nets.map((net) => [net.legacyRoot, net.id]).sort()).toEqual([...kernel.componentNetIds].sort());
    expect(fast.preservedIds).toEqual([id(9), id(10)]);
    expect(fast.inSync).toBe(true);
  });

  test("move, rotation and reference changes keep durable ids and metadata on frozen source rows", async () => {
    const { projection } = await loadLegacyFixtureSource("f1-routed-clean");
    const before = deriveNetComponents(projection.parts, projection.wires, projection.labels, projection.primitives);
    const initial = bind(before.components);
    const shift = (point: { x: number; y: number }) => ({ x: point.x + 123000000, y: point.y - 81000000 });
    const parts = projection.parts.map((part) => ({ ...part, reference: `${part.reference}_renamed`, rotationDeg: 90, positionNm: shift(part.positionNm), pins: part.pins.map((pin) => ({ ...pin, worldPositionNm: shift(pin.worldPositionNm) })) }));
    const moved = deriveNetComponents(parts, projection.wires.map((wire) => ({ ...wire, pointsNm: wire.pointsNm.map(shift) })),
      projection.labels.map((label) => ({ ...label, positionNm: shift(label.positionNm) })),
      projection.primitives.map((primitive) => ({ ...primitive, positionNm: shift(primitive.positionNm) })));
    const result = bind(moved.components, initial.nextActive);
    expect(result.nextActive).toEqual(initial.nextActive);
    expect(result.inSync).toBe(true);
    expect(result.transitions).toEqual([]);
  });
});

describe("sanitizing prior ownership", () => {
  const previous = (): ActiveNetRecord[] => [record(1, ["a", "x"]), record(2, ["a", "y"])];

  test("exact prior owner wins before value-set membership and lower sequence", () => {
    const priorOwner = new Map([[token("a"), id(2)], [token("x"), id(1)]]);
    const result = bind([component("one", ["x"]), component("two", ["a", "y"])], previous(), { priorOwner });
    expect(result.sanitized).toEqual([{ token: token("a"), keptId: id(2), droppedFrom: [id(1)] }]);
    expect(result.inSync).toBe(false);
  });

  test("a record in the priorOwner value set wins without an exact owner", () => {
    const result = sanitizePreviousActive(previous(), new Map([[token("unrelated"), id(2)]]));
    expect(result.sanitized[0]?.keptId).toBe(id(2));
  });

  test("an absent or nonclaiming exact owner never receives the token", () => {
    const records = [...previous(), record(3, ["z"])];
    const result = sanitizePreviousActive(records, new Map([[token("a"), id(3)]]));
    expect(result.sanitized[0]?.keptId).toBe(id(1));
    expect(result.previous.find((entry) => entry.id === id(3))?.members).toEqual([pin("z")]);
  });

  test("numeric sequence precedes text; final text fallback is defensive for foreign salts", () => {
    const numeric = sanitizePreviousActive([record(10, ["a"]), record(9, ["a"])]);
    expect(numeric.sanitized[0]?.keptId).toBe(id(9));
    const foreign = { ...record(1, ["a"]), id: formatDurableNetId("bbbbbbbbbb", 1) };
    expect(sanitizePreviousActive([foreign, record(1, ["a"])]).sanitized[0]?.keptId).toBe(id(1));
    expect(() => bind([component("a", ["a"])], [foreign])).toThrow("own-salt durable id");
  });

  test("empty records drop; watermark still reserves their highest sequence; input stays unchanged", () => {
    const records = [record(100, ["a"]), record(1, ["a", "b"])];
    const before = JSON.stringify(records);
    const result = bind([component("kept", ["a", "b"]), component("fresh", ["z", "y"])], records);
    expect(result.nextActive.map((entry) => entry.id)).toEqual([id(1), id(101)]);
    expect(result.nextSeq).toBe(102);
    expect(result.sanitized[0]?.droppedFrom).toEqual([id(100)]);
    expect(JSON.stringify(records)).toBe(before);
  });

  test("duplicate members within one prior record are refused", () => {
    expect(() => bind([component("a", ["a"])], [record(1, ["a", "a"])])).toThrow("duplicate member within record");
  });
});

describe("naming priority and freshness", () => {
  test("literal Net_5 label remains explicit and its smaller predecessor beats a larger auto net", () => {
    const previous = [record(1, ["a", "b", "c"]), record(9, ["d"], { name: "Net_5", nameSource: "label" })];
    const result = bind([component("merged", ["a", "b", "c", "d"], { derivedName: "Net_5", nameSource: "label" })], previous);
    expect(result.nets[0]).toMatchObject({ id: id(9), name: "Net_5", autoNamed: false, nameSource: "label" });
    expect(result.retirements[0]?.id).toBe(id(1));
  });

  test("override is explicit, follows inherited id, and yields to current derived names", () => {
    const previous = [record(1, ["a", "b"]), record(2, ["c"], { name: "User", nameSource: "override", displayOverride: "User" })];
    const merged = bind([component("merge", ["a", "b", "c"])], previous);
    expect(merged.nets[0]).toMatchObject({ id: id(2), name: "User", autoNamed: false, nameSource: "override" });
    const named = bind([component("named", ["a", "b", "c"], { derivedName: "GND", nameSource: "gnd" })], merged.nextActive);
    expect(named.nets[0]).toMatchObject({ name: "GND", nameSource: "gnd", autoNamed: false });
    expect(named.nextActive[0]?.displayOverride).toBe("User");
    expect(named.inSync).toBe(false);
    expect(bind([component("unnamed", ["a", "b", "c"])], named.nextActive).nets[0]?.name).toBe("User");
  });

  test("named, then override, then auto names use case-insensitive first-free suffixes", () => {
    const components = [component("auto", ["a"]), component("override", ["b"]),
      component("named", ["c"], { derivedName: "VCC", nameSource: "label" }),
      component("suffix", ["d"], { derivedName: "VCC_1", nameSource: "label" }),
      component("net", ["e"], { derivedName: "Net_1", nameSource: "label" })];
    const previous = [record(1, ["a"]), record(2, ["b"], { name: "vcc", nameSource: "override", displayOverride: "vcc" }),
      record(3, ["c"]), record(4, ["d"]), record(5, ["e"])];
    const result = bind(components, previous);
    expect(result.nets.map((net) => net.name)).toEqual(["Net_1_1", "vcc_2", "VCC", "VCC_1", "Net_1"]);
    expect(result.nets.map((net) => net.autoNamed)).toEqual([true, false, false, false, false]);
  });

  test("renaming or removing a label updates metadata without invented transitions", () => {
    const previous = [record(1, ["a", "b"], { name: "A", nameSource: "label" })];
    const renamed = bind([component("same", ["a", "b"], { derivedName: "B", nameSource: "label" })], previous);
    expect(renamed.nextActive[0]).toMatchObject({ name: "B", nameSource: "label" });
    expect(renamed.inSync).toBe(false);
    const removed = bind([component("same", ["a", "b"])], renamed.nextActive);
    expect(removed.nextActive[0]).toMatchObject({ name: "Net_1", nameSource: "auto" });
    expect(removed.inSync).toBe(false);
    expect(removed.transitions).toEqual([]);
    expect(removed.createdIds).toEqual([]);
    expect(removed.retirements).toEqual([]);
    expect(bind([component("same", ["a", "b"])], removed.nextActive).inSync).toBe(true);
  });

  test("source changes matter even when display text stays Net_1", () => {
    const result = bind([component("same", ["a", "b"])], [record(1, ["a", "b"], { nameSource: "label" })]);
    expect(result.nets[0]?.name).toBe("Net_1");
    expect(result.inSync).toBe(false);
    expect(result.nextActive[0]?.nameSource).toBe("auto");
  });
});

describe("dependents, validation and deterministic results", () => {
  test("equal naming class uses lazy cached dependent count then numeric seq 9 before 10", () => {
    const previous = [record(10, ["a"]), record(9, ["b"])];
    const components = [component("merge", ["a", "b"])];
    expect(bind(components, previous).nets[0]?.id).toBe(id(9));
    const calls: string[] = [];
    const result = bind(components, previous, { dependentCount: (netId) => { calls.push(netId); return netId === id(10) ? 2 : 1; } });
    expect(result.nets[0]?.id).toBe(id(10));
    expect(calls.sort()).toEqual([id(10), id(9)].sort());
  });

  test("dependent census is skipped when pin overlap already decides", () => {
    const result = bind([component("merge", ["a", "b", "c"])], [record(1, ["a", "b"]), record(2, ["c"])], {
      dependentCount: () => { throw new Error("unneeded census"); },
    });
    expect(result.nets[0]?.id).toBe(id(1));
  });

  test("sequence overflow refuses unsafe returned state before allocation", () => {
    expect(() => bind([component("new", ["a", "b"])], [], { seqWatermark: Number.MAX_SAFE_INTEGER })).toThrow("durable sequence exhausted");
    expect(() => bind([], [record(Number.MAX_SAFE_INTEGER, ["a"])])).toThrow("nextSeq");
    expect(bind([component("lone", ["a"])], [], { seqWatermark: Number.MAX_SAFE_INTEGER }).nextSeq).toBe(Number.MAX_SAFE_INTEGER);
  });

  test.each([
    { salt: "invalid" }, { salt: "aaaaaaaaa\n" }, { mode: "future" }, { seqWatermark: 0 }, { seqWatermark: NaN },
    { pinLabel: null }, { dependentCount: null }, { priorOwner: null },
    { components: [component("x", ["a", "a"])] },
    { components: [component("x", ["a"]), component("y", ["a"])] },
    { components: [component("x", ["a"], { nameSource: "auto", derivedName: "BAD" })] },
    { previousActive: [record(1, ["a"], { nameSource: "future" as ActiveNetRecord["nameSource"] })] },
  ])("invalid input refuses binding: %j", (extra) => {
    expect(() => bind([component("valid", ["a"])], [], extra as unknown as Partial<BindInput>)).toThrow();
  });

  test("invalid dependent and pin label callbacks cannot return unsafe results", () => {
    expect(() => bind([component("merge", ["a", "b"])], [record(1, ["a"]), record(2, ["b"])], { dependentCount: () => Infinity })).toThrow("dependentCount");
    expect(() => bind([component("lone", ["a"])], [], { pinLabel: () => "" })).toThrow("pinLabel");
  });

  test("frozen source records, component arrays, and priorOwner maps remain unchanged", () => {
    const components = [component("left", ["a"]), component("right", ["b"])];
    const previous = [record(1, ["a", "b"])];
    const priorOwner = new Map([[token("a"), id(1)]]);
    for (const source of components) {
      [source.pinIds, source.wireIds, source.labelIds, source.primitiveIds].forEach(Object.freeze);
      Object.freeze(source);
    }
    previous.forEach((entry) => { entry.members.forEach(Object.freeze); Object.freeze(entry.members); Object.freeze(entry); });
    Object.freeze(components); Object.freeze(previous);
    const before = JSON.stringify({ components, previous, priorOwner: [...priorOwner] });
    const result = bind(components, previous, { priorOwner });
    (result.nextActive[0]!.members[0]! as { id: string }).id = "output-only";
    result.nets[0]!.pinIds.push("output-only");
    expect(JSON.stringify({ components, previous, priorOwner: [...priorOwner] })).toBe(before);
  });

  test("input and member permutations preserve full result bytes", () => {
    const components = [component("left", ["a", "b", "d"]), component("right", ["c", "e", "f"]), component("fresh", ["g", "h"]), component("lone", ["i"])];
    const previous = [record(10, ["a", "b", "c"]), record(9, ["d", "e", "f"])];
    const before = JSON.stringify({ components, previous });
    const baseline = JSON.stringify(bind(components, previous));
    for (let seed = 1; seed <= 200; seed++) {
      const rotate = <T>(values: T[]): T[] => [...values.slice(seed % values.length), ...values.slice(0, seed % values.length)].reverse();
      const result = bind(rotate(components).map((entry) => ({ ...entry, pinIds: rotate(entry.pinIds) })),
        rotate(previous).map((entry) => ({ ...entry, members: rotate(entry.members) })));
      expect(JSON.stringify(result)).toBe(baseline);
    }
    expect(JSON.stringify({ components, previous })).toBe(before);
  });
});
