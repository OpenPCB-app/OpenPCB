import { describe, expect, test } from "bun:test";
import { AppError } from "../../contracts/errors";
import type { EcsPatch } from "../../../shared/domain/commands";
import type { DesignerWorldComponent } from "../../../modules/designer/backend/projection-world";
import type { RawNetRebindDelta } from "../../../modules/designer/backend/net-identity/rebind-history-types";
import { buildNetRebindHistoryPatchSet, readNetRebindHistoryDelta } from "../../../modules/designer/backend/net-identity/rebind-history-patches";

const DESIGN = "design", COMMAND = "pcb_rebind_net_references";
const TYPE = "designer.net_reference_rebind", ENTITY = `pcb:net-reference-rebind:${DESIGN}`;
function delta(): RawNetRebindDelta {
  return { version: 1, designId: DESIGN, rows: [{ rowId: "trace-row", kind: "trace", payloadId: "trace", fields: [
    { key: "netId", before: { exists: true, value: "old" }, after: { exists: true, value: "new" } },
    { key: "netName", before: { exists: true, value: null }, after: { exists: false } },
  ] }] };
}
function carrier(payload: unknown = delta()): Record<string, unknown> {
  return { kind: "component.set", entityId: ENTITY, component: { type: TYPE, payload } };
}
function read(patches: unknown, command = COMMAND): RawNetRebindDelta | null {
  return readNetRebindHistoryDelta(DESIGN, command, patches as readonly EcsPatch<DesignerWorldComponent>[]);
}
function conflict(work: () => unknown): void {
  let caught: unknown;
  try { work(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).status).toBe(409);
  expect((caught as AppError).extras?.code).toBe("NET_REBIND_HISTORY_CONFLICT");
}

describe("net rebind history patch carrier", () => {
  test("builds exact forward and explicit inverse carriers, with detached data", () => {
    const input = delta(), original = structuredClone(input), patches = buildNetRebindHistoryPatchSet(input);
    expect(patches.forwardPatches as unknown).toEqual([carrier(input)]);
    const inverse = structuredClone(input);
    for (const field of inverse.rows[0]!.fields) [field.before, field.after] = [field.after, field.before];
    expect(patches.inversePatches as unknown).toEqual([carrier(inverse)]);
    expect(read(patches.forwardPatches)).toEqual(input);
    expect(read(patches.inversePatches)).toEqual(inverse);
    const returned = read(patches.forwardPatches)!;
    returned.rows[0]!.fields[0]!.after = { exists: false };
    expect(read(patches.forwardPatches)).toEqual(original);
    expect(input).toEqual(original);
  });

  test("empty builder returns no patches but empty repair history is refused", () => {
    expect(buildNetRebindHistoryPatchSet({ ...delta(), rows: [] })).toEqual({ forwardPatches: [], inversePatches: [] });
    conflict(() => read([])); conflict(() => read([carrier({ ...delta(), rows: [] })]));
  });

  test("ordinary histories return null", () => {
    expect(read([], "place_part")).toBeNull();
    expect(read([{ kind: "noop" }, { kind: "entity.ensure", entityId: "part:one" },
      { kind: "component.set", entityId: "part:one", component: { type: "designer.entity", kind: "part", payload: {} } },
      { kind: "component.remove", entityId: "part:one", componentType: "designer.entity" },
      { kind: "entity.restore", entityId: "part:one", components: { "designer.entity": { type: "designer.entity", kind: "part", payload: {} } } },
    ], "place_part")).toBeNull();
  });

  const invalid: Array<[string, () => unknown]> = [
    ["not array", () => ({})], ["null array", () => null], ["sparse array", () => new Array(1)],
    ["extra array key", () => Object.assign([carrier()], { extra: true })], ["null patch", () => [null]],
    ["ordinary repair patch", () => [{ kind: "noop" }]], ["mixed", () => [carrier(), { kind: "noop" }]],
    ["repeated", () => [carrier(), carrier()]], ["wrong kind", () => [{ ...carrier(), kind: "entity.restore" }]],
    ["wrong entity", () => [{ ...carrier(), entityId: "pcb:net-reference-rebind:other" }]],
    ["extra patch key", () => [{ ...carrier(), extra: true }]],
    ["wrong component", () => [{ ...carrier(), component: { type: "designer.pcb_trace", payload: delta() } }]],
    ["extra component key", () => [{ ...carrier(), component: { type: TYPE, payload: delta(), extra: true } }]],
    ["missing component", () => [{ kind: "component.set", entityId: ENTITY }]],
    ["null component", () => [{ ...carrier(), component: null }]],
    ["future version", () => [carrier({ ...delta(), version: 2 })]],
    ["foreign owner", () => [carrier({ ...delta(), designId: "other" })]],
    ["malformed delta", () => [carrier({ ...delta(), arbitrary: true })]],
  ];
  test.each(invalid)("%s is a history conflict", (_name, value) => conflict(() => read(value())));

  const reserved: Record<string, unknown>[] = [
    { kind: "component.set", entityId: "part:one", component: { type: TYPE, payload: delta() } },
    { kind: "component.remove", entityId: "part:one", componentType: TYPE },
    { kind: "entity.restore", entityId: "part:one", components: { [TYPE]: { type: "future", payload: {} } } },
    { kind: "entity.restore", entityId: "part:one", components: { future: { type: TYPE, payload: delta() } } },
    { kind: "future", entityId: "part:one", component: { type: TYPE, payload: delta() } },
    ...["entity.ensure", "entity.delete", "entity.restore", "component.set", "component.remove", "future"].map((kind) => ({ kind, entityId: `${ENTITY}:future` })),
  ];
  test.each(reserved)("reserved carrier cannot enter ordinary command %j", (patch) => conflict(() => read([patch], "place_part")));

  test("getters are rejected without invocation across outer, component and payload carriers", () => {
    let invoked = 0;
    const getter = () => { invoked++; throw new Error("must not run"); };
    const outer = Object.defineProperty({}, "entityId", { enumerable: true, get: getter });
    const component = Object.defineProperty({ type: TYPE }, "payload", { enumerable: true, get: getter });
    const payload = delta();
    Object.defineProperty(payload.rows[0]!.fields[0]!.before, "exists", { enumerable: true, get: getter });
    const array = Object.defineProperty([], "0", { enumerable: true, get: getter });
    for (const patches of [[outer], [{ ...carrier(), component }], [carrier(payload)], array]) conflict(() => read(patches));
    conflict(() => read([outer], "place_part"));
    conflict(() => buildNetRebindHistoryPatchSet(payload));
    expect(invoked).toBe(0);
  });
});
