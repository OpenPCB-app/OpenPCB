import { describe, expect, test } from "bun:test";
import type { DesignerCommand } from "../../../sdks/designer";
import { getSharedSqlite } from "../db/sqlite-client";
import { body, identityState, openIdentityRuntime, placed, send, setupRuntimeCleanup, type IdentityRuntime } from "./helpers/net-identity-runtime";

setupRuntimeCleanup();
const MM = 1_000_000;

function rawRows(): string {
  const sqlite = getSharedSqlite();
  const tables = sqlite.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'designer_%' ORDER BY name").all();
  return JSON.stringify(tables.map(({ name }) => ({ name, rows: sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all() })));
}

async function wires(runtime: IdentityRuntime, id: string, crossing = false, named = true) {
  const coordinates = crossing ? [[0, 0], [10, 0], [5, -5], [5, 5]] : [[0, 0], [10, 0], [20, 0], [30, 0]];
  const parts = [];
  for (const [x, y] of coordinates) parts.push(await placed(runtime, id, x! * MM, y! * MM));
  for (const [first, second] of [[0, 1], [2, 3]]) await send(runtime, id, {
    type: "create_wire", sourcePinId: parts[first!]!.pinId, targetPinId: parts[second!]!.pinId,
    pointsNm: [coordinates[first!]!, coordinates[second!]!].map(([x, y]) => ({ x: x! * MM, y: y! * MM })),
  });
  if (named) for (const [index, text] of [[0, "VCC"], [2, "GND"]] as const) await send(runtime, id, {
    type: "upsert_label", text, positionNm: { x: coordinates[index]![0]! * MM, y: coordinates[index]![1]! * MM },
  });
  return parts;
}

async function refusesThenConfirms(runtime: IdentityRuntime, id: string, command: DesignerCommand): Promise<void> {
  const before = (await runtime.store.getSchematicProjection(id))!, activeIds = identityState(id).active.map(row => row.id).sort();
  const history = await runtime.store.getHistory(id, "A"), raw = rawRows(), original = JSON.stringify(command);
  expect(await runtime.store.dispatchCommand(id, body(id, command))).toMatchObject({ ok: false, code: "NET_MERGE_REQUIRES_CONFIRM" });
  expect(rawRows()).toBe(raw);
  expect(JSON.stringify(command)).toBe(original);
  expect(await runtime.store.getHistory(id, "A")).toEqual(history);
  expect((await runtime.store.getSchematicProjection(id))!.revision).toBe(before.revision);
  const result = await send(runtime, id, { ...command, confirmMerge: true } as DesignerCommand);
  expect(result.netIdentity?.events.some(event => event.kind === "merge")).toBe(true);
  expect((await runtime.store.getHistory(id, "A")).undoDepth).toBe(history.undoDepth + 1);
  expect((await runtime.store.undo(id, "A")).ok).toBe(true);
  expect((await runtime.store.getSchematicProjection(id))!.nets).toEqual(before.nets);
  expect(identityState(id).active.map(row => row.id).sort()).toEqual(activeIds);
}

describe("geometry merge safety through the real store", () => {
  test("move_part refuses VCC/GND short atomically, consent and undo restore identity", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    const parts = await wires(runtime, design.id);
    await refusesThenConfirms(runtime, design.id, { type: "move_part", partId: parts[1]!.partId, positionNm: { x: 20 * MM, y: 0 } });
  });

  for (const type of ["place_part", "duplicate_part"] as const) test(`${type} refuses joining an unconnected named crossing`, async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    const parts = await wires(runtime, design.id, true);
    const command: DesignerCommand = type === "place_part"
      ? { type, componentId: "passive", positionNm: { x: 5 * MM, y: 0 } }
      : { type, partId: parts[0]!.partId, positionNm: { x: 5 * MM, y: 0 } };
    await refusesThenConfirms(runtime, design.id, command);
  });

  test("primitive text collision uses the naming policy and rolls back all durable rows", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    await send(runtime, design.id, { type: "place_pwr_port", railText: "A", positionNm: { x: 0, y: 0 } });
    const portal = await send(runtime, design.id, { type: "place_net_portal", portalText: "B", positionNm: { x: 10 * MM, y: 0 } });
    await refusesThenConfirms(runtime, design.id, { type: "update_primitive_text", primitiveId: portal.createdEntityId!, text: "A" });
  });

  test("anonymous geometry merges silently but naming retains anonymous multipin protection", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    await wires(runtime, design.id, true, false);
    const before = rawRows();
    expect(await runtime.store.dispatchCommand(design.id, body(design.id, { type: "place_gnd_port", positionNm: { x: 5 * MM, y: 0 } })))
      .toMatchObject({ ok: false, code: "NET_MERGE_REQUIRES_CONFIRM", nets: [{ name: null, pinCount: 2 }, { name: null, pinCount: 2 }] });
    expect(rawRows()).toBe(before);
    expect((await send(runtime, design.id, { type: "place_part", componentId: "passive", positionNm: { x: 5 * MM, y: 0 } })).ok).toBe(true);
    expect((await runtime.store.getSchematicProjection(design.id))!.nets).toHaveLength(1);
  });

  test("an explicit Net_5 label remains named for geometry protection", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    const parts = await wires(runtime, design.id);
    const projection = (await runtime.store.getSchematicProjection(design.id))!, label = projection.labels.find(row => row.text === "VCC")!;
    await send(runtime, design.id, { type: "upsert_label", labelId: label.id, text: "Net_5", positionNm: label.positionNm });
    expect((await runtime.store.getSchematicProjection(design.id))!.nets.find(row => row.name === "Net_5")!.autoNamed).toBe(false);
    const before = rawRows();
    expect(await runtime.store.dispatchCommand(design.id, body(design.id, { type: "move_part", partId: parts[1]!.partId, positionNm: { x: 20 * MM, y: 0 } })))
      .toMatchObject({ ok: false, code: "NET_MERGE_REQUIRES_CONFIRM" });
    expect(rawRows()).toBe(before);
  });

  test("an unnamed drag merges silently and intentional wiring still joins named nets", async () => {
    const runtime = await openIdentityRuntime(), anonymous = await runtime.store.createDesign();
    const parts = await wires(runtime, anonymous.id, false, false);
    const move = await send(runtime, anonymous.id, { type: "move_part", partId: parts[1]!.partId, positionNm: { x: 20 * MM, y: 0 } });
    expect(move.netIdentity?.events.some(event => event.kind === "merge")).toBe(true);
    expect((await runtime.store.getSchematicProjection(anonymous.id))!.nets).toHaveLength(1);
    const named = await runtime.store.createDesign(), namedParts = await wires(runtime, named.id);
    expect((await send(runtime, named.id, { type: "create_wire", sourcePinId: namedParts[1]!.pinId, targetPinId: namedParts[2]!.pinId })).ok).toBe(true);
    expect((await runtime.store.getSchematicProjection(named.id))!.nets).toHaveLength(1);
  });

  test("mixed batch retains naming protection, but a confirmed naming step leaves only geometry policy", async () => {
    const runtime = await openIdentityRuntime(), design = await runtime.store.createDesign();
    const parts = await wires(runtime, design.id, true, false);
    const naming = { type: "upsert_label" as const, text: "Unrelated", positionNm: { x: 100 * MM, y: 100 * MM } };
    const geometry = { type: "duplicate_part" as const, partId: parts[0]!.partId, positionNm: { x: 5 * MM, y: 0 } };
    const before = rawRows();
    expect(await runtime.store.dispatchCommand(design.id, body(design.id, { type: "batch_commands", commands: [geometry, naming] })))
      .toMatchObject({ ok: false, code: "NET_MERGE_REQUIRES_CONFIRM" });
    expect(rawRows()).toBe(before);
    expect((await send(runtime, design.id, { type: "batch_commands", commands: [geometry, { ...naming, confirmMerge: true }] })).ok).toBe(true);
    expect((await runtime.store.getSchematicProjection(design.id))!.nets).toHaveLength(2);
  });
});
