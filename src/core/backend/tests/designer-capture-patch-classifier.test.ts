import { describe, expect, test } from "bun:test";
import type { EcsPatch } from "../../../shared/domain/commands";
import { asEntityId } from "../../../shared/domain/ecs";
import { AppError } from "../../contracts/errors";
import { classifyCopperPatches } from "../../../modules/designer/backend/capture/patch-classifier";
import { buildNetRebindHistoryPatchSet } from "../../../modules/designer/backend/net-identity/rebind-history-patches";
import type {
  RawNetRebindDelta,
  RawNetRebindRowDelta,
  RawNetRebindSlot,
} from "../../../modules/designer/backend/net-identity/rebind-history-types";

const slot = (value: unknown): RawNetRebindSlot => ({ exists: true, value });
const EMPTY = { created: [], modified: [], deleted: [] };

function row(kind: RawNetRebindRowDelta["kind"], id: string): RawNetRebindRowDelta {
  return {
    rowId: `row-${id}`,
    kind,
    payloadId: kind === "board_settings" ? null : id,
    fields: [{ key: "netId", before: slot("old-net"), after: slot("new-net") }],
  };
}

function patches(rows: RawNetRebindRowDelta[]) {
  const delta: RawNetRebindDelta = { version: 1, designId: "design", rows };
  return buildNetRebindHistoryPatchSet(delta);
}

describe("capture copper patch classification", () => {
  test("reference-only trace and via repairs are modifications, using payload IDs", () => {
    const { forwardPatches, inversePatches } = patches([row("trace", "trace"), row("via", "via")]);
    expect(classifyCopperPatches(forwardPatches, inversePatches)).toEqual({
      ...EMPTY,
      modified: [
        { geometryId: "trace", kind: "trace", netId: "new-net" },
        { geometryId: "via", kind: "via", netId: "new-net" },
      ],
    });
    expect(classifyCopperPatches(inversePatches, forwardPatches)).toEqual({
      ...EMPTY,
      modified: [
        { geometryId: "trace", kind: "trace", netId: "old-net" },
        { geometryId: "via", kind: "via", netId: "old-net" },
      ],
    });
  });

  test.each([slot(null), { exists: false } as const])("cleared or absent net IDs classify as null: %j", (after) => {
    const trace = row("trace", "trace");
    trace.fields[0]!.after = after;
    const { forwardPatches, inversePatches } = patches([trace]);
    expect(classifyCopperPatches(forwardPatches, inversePatches).modified).toEqual([
      { geometryId: "trace", kind: "trace", netId: null },
    ]);
    expect(classifyCopperPatches(inversePatches, forwardPatches).modified[0]?.netId).toBe("old-net");
  });

  test("a name-only hint clear is a modification with no inferred net ID", () => {
    const trace = row("trace", "trace");
    trace.fields = [{ key: "netName", before: slot("GND"), after: slot(null) }];
    const { forwardPatches, inversePatches } = patches([trace]);
    for (const [forward, inverse] of [[forwardPatches, inversePatches], [inversePatches, forwardPatches]] as const) {
      expect(classifyCopperPatches(forward, inverse)).toEqual({
        ...EMPTY, modified: [{ geometryId: "trace", kind: "trace", netId: null }],
      });
    }
  });

  test("free pads, zones and rule sections stay outside the trace/via registry", () => {
    const board = row("board_settings", "board");
    board.fields = [{ key: "drcRules", before: slot([{ id: "old-rule" }]), after: slot([]) }];
    const { forwardPatches, inversePatches } = patches([row("free_pad", "pad"), row("zone", "zone"), board]);
    expect(classifyCopperPatches(forwardPatches, inversePatches)).toEqual(EMPTY);
  });

  test("empty repair and ordinary noop contain no copper updates", () => {
    const { forwardPatches, inversePatches } = patches([]);
    expect(classifyCopperPatches(forwardPatches, inversePatches)).toEqual(EMPTY);
    expect(classifyCopperPatches([{ kind: "noop" }], [])).toEqual(EMPTY);
  });

  test("ordinary created, modified and deleted geometry keeps existing classification", () => {
    const copper = (netId: string) => ({ type: "test.copper", payload: { netId } });
    const created = asEntityId("pcb:trace:created"), modified = asEntityId("pcb:via:modified");
    const deleted = asEntityId("pcb:trace:deleted");
    const forward: EcsPatch[] = [
      { kind: "component.set", entityId: created, component: copper("created-net") },
      { kind: "component.set", entityId: modified, component: copper("next-net") },
      { kind: "entity.delete", entityId: deleted },
    ];
    const inverse: EcsPatch[] = [
      { kind: "entity.delete", entityId: created },
      { kind: "component.set", entityId: modified, component: copper("previous-net") },
      { kind: "entity.restore", entityId: deleted, components: { copper: copper("deleted-net") } },
    ];
    expect(classifyCopperPatches(forward, inverse)).toEqual({
      created: [{ geometryId: "created", kind: "trace", netId: "created-net" }],
      modified: [{ geometryId: "modified", kind: "via", netId: "next-net" }],
      deleted: [{ geometryId: "deleted", kind: "trace", netId: "deleted-net" }],
    });
  });

  test.each(["foreign entity", "invalid payload", "mixed carrier", "duplicate carrier"])("malformed %s refuses without inventing updates", (invalid) => {
    const { forwardPatches, inversePatches } = patches([row("trace", "trace")]);
    const malformed: EcsPatch[] = structuredClone(forwardPatches);
    const carrier = malformed[0]!;
    if (carrier.kind !== "component.set") throw new Error("Expected repair carrier");
    if (invalid === "foreign entity") carrier.entityId = asEntityId("pcb:net-reference-rebind:other");
    if (invalid === "invalid payload") Object.assign(carrier.component, { payload: { version: 2, designId: "design", rows: [] } });
    if (invalid === "mixed carrier") malformed.push({ kind: "component.set", entityId: asEntityId("pcb:trace:untrusted"), component: { type: "test.copper", payload: { netId: "invented" } } });
    if (invalid === "duplicate carrier") malformed.push(structuredClone(carrier));
    expect(() => classifyCopperPatches(malformed, inversePatches)).toThrow(AppError);
  });

  test.each(["entityId", "payload", "designId"])("malformed carrier %s accessor never runs", (field) => {
    const { forwardPatches, inversePatches } = patches([row("trace", "trace")]);
    const carrier = forwardPatches[0]!;
    if (carrier.kind !== "component.set") throw new Error("Expected repair carrier");
    let invoked = 0;
    const target = field === "entityId" ? carrier : field === "payload" ? carrier.component : carrier.component.payload;
    Object.defineProperty(target, field, {
      enumerable: true,
      get() { invoked++; throw new Error("must not execute"); },
    });
    expect(() => classifyCopperPatches(forwardPatches, inversePatches)).toThrow();
    expect(invoked).toBe(0);
  });

  test("ordinary classification errors still propagate", () => {
    const component = { type: "test.copper" };
    Object.defineProperty(component, "payload", {
      get() { throw new Error("ordinary payload failure"); },
    });
    expect(() => classifyCopperPatches([
      { kind: "component.set", entityId: asEntityId("pcb:trace:trace"), component },
    ], [])).toThrow("ordinary payload failure");
  });
});
