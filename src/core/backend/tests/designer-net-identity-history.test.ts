import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getSharedDb } from "../db/sqlite-client";
import { netIdentityState, schematicWires, sessionHistories } from "../../../modules/designer/backend/schema";
import { readNetIdentityRetired } from "../../../modules/designer/backend/net-identity/state-store";
import { body, connected, identityState, openIdentityRuntime, placed, rawRuntimeState, send, setupRuntimeCleanup } from "./helpers/net-identity-runtime";

setupRuntimeCleanup();

function activeJson(designId: string) {
  return getSharedDb().select().from(netIdentityState).where(eq(netIdentityState.designId, designId)).get()!.activeJson;
}

describe("durable identity through store history", () => {
  test("split undo redo restores exact active JSON, ledger reactivation and monotonic sequence after reboot", async () => {
    let runtime = await openIdentityRuntime();
    const design = await runtime.store.createDesign();
    const pins = [];
    for (let index = 0; index < 4; index += 1) pins.push(await placed(runtime, design.id, index * 10_000_000, 0));
    const wires: string[] = [];
    for (let index = 0; index < 3; index += 1) wires.push((await send(runtime, design.id, {
      type: "create_wire", sourcePinId: pins[index]!.pinId, targetPinId: pins[index + 1]!.pinId,
    }, "setup")).createdEntityId!);
    const netId = identityState(design.id).active[0]!.id;
    const original = activeJson(design.id);
    const priorWatermark = identityState(design.id).nextSeq;
    const split = await send(runtime, design.id, { type: "delete_entity", entityKind: "wire", entityId: wires[1]! });
    expect(split.netIdentity!.events[0]).toMatchObject({ kind: "split", netId });
    expect(identityState(design.id).active).toHaveLength(2);
    const newId = identityState(design.id).active.find((record) => record.id !== netId)!.id;
    const splitJson = activeJson(design.id);
    const watermark = identityState(design.id).nextSeq;
    expect(watermark).toBe(priorWatermark + 1);
    runtime = await openIdentityRuntime(runtime.file);
    expect((await runtime.store.undo(design.id, "A")).ok).toBe(true);
    expect(activeJson(design.id)).toBe(original);
    expect(identityState(design.id).nextSeq).toBeGreaterThanOrEqual(watermark);
    expect(readNetIdentityRetired(getSharedDb(), design.id)).toContainEqual(expect.objectContaining({ netId: newId, reason: "history" }));
    expect((await runtime.store.redo(design.id, "A")).ok).toBe(true);
    expect(activeJson(design.id)).toBe(splitJson);
    expect(identityState(design.id).nextSeq).toBeGreaterThanOrEqual(watermark);
    expect(readNetIdentityRetired(getSharedDb(), design.id).some((row) => row.netId === newId)).toBe(true);
  });

  test("cross-session contested undo keeps Z with two pins, retires X merged and reports X dependents", async () => {
    const runtime = await openIdentityRuntime();
    const design = await runtime.store.createDesign();
    const chain = await connected(runtime, design.id);
    const board = (await runtime.store.getPcbProjection(design.id))!.board;
    await send(runtime, design.id, { type: "pcb_set_design_rules", perNetClassAssignments: { [chain.netId]: board.netClasses[0]!.id } }, "PCB");
    await send(runtime, design.id, { type: "delete_entity", entityKind: "wire", entityId: chain.wireId }, "A");
    await send(runtime, design.id, { type: "create_wire", sourcePinId: chain.second.pinId, targetPinId: chain.third.pinId }, "B");
    const z = identityState(design.id).active.find((record) => record.id !== chain.netId)!.id;
    const undone = await runtime.store.undo(design.id, "A");
    expect(undone.ok).toBe(true);
    if (!undone.ok) throw new Error(JSON.stringify(undone));
    expect(identityState(design.id).active.map((record) => record.id)).toEqual([z]);
    expect(identityState(design.id).active[0]!.members.filter((member) => member.kind === "pin")).toHaveLength(3);
    expect(readNetIdentityRetired(getSharedDb(), design.id)).toContainEqual(expect.objectContaining({
      netId: chain.netId, reason: "merged", successorIds: [z],
    }));
    expect(undone.netIdentity!.events).toContainEqual(expect.objectContaining({ kind: "merge", survivorNetId: z, hasDependents: true,
      retired: [expect.objectContaining({ netId: chain.netId, dependents: expect.objectContaining({ netClassAssignment: true }) })] }));
  });

  test("combined replay census comes from postpatch PCB references", async () => {
    const runtime = await openIdentityRuntime();
    const design = await runtime.store.createDesign();
    const chain = await connected(runtime, design.id);
    const board = (await runtime.store.getPcbProjection(design.id))!.board;
    await send(runtime, design.id, { type: "batch_commands", commands: [
      { type: "delete_entity", entityKind: "wire", entityId: chain.wireId },
      { type: "pcb_set_design_rules", perNetClassAssignments: { [chain.netId]: board.netClasses[0]!.id } },
    ] }, "A");
    await send(runtime, design.id, { type: "create_wire", sourcePinId: chain.second.pinId, targetPinId: chain.third.pinId }, "B");
    const undone = await runtime.store.undo(design.id, "A");
    expect(undone.ok).toBe(true);
    if (!undone.ok) throw new Error(JSON.stringify(undone));
    expect(undone.netIdentity!.events).toContainEqual(expect.objectContaining({ kind: "merge", hasDependents: false,
      retired: [expect.objectContaining({ netId: chain.netId, dependents: expect.objectContaining({ netClassAssignment: false }) })] }));
    expect((await runtime.store.getPcbProjection(design.id))!.board.perNetClassAssignments ?? {}).toEqual({});
  });

  test("ensure archives preidentity history before hydration and OCC uses migrated head", async () => {
    const runtime = await openIdentityRuntime();
    const design = await runtime.store.createDesign();
    await connected(runtime, design.id);
    getSharedDb().delete(netIdentityState).where(eq(netIdentityState.designId, design.id)).run();
    const oldEnvelope = body(design.id, { type: "upsert_label", text: "AFTER", positionNm: { x: 50_000_000, y: 50_000_000 } }, "setup");
    expect((await runtime.store.getHistory(design.id, "setup")).undoDepth).toBe(0);
    expect(getSharedDb().select().from(sessionHistories).where(eq(sessionHistories.designId, design.id)).all()).toEqual([]);
    const before = rawRuntimeState(design.id);
    expect(await runtime.store.dispatchCommand(design.id, oldEnvelope)).toMatchObject({ ok: false, code: "REVISION_CONFLICT" });
    expect(rawRuntimeState(design.id)).toEqual(before);
    expect((await runtime.store.undo(design.id, "setup")).ok).toBe(false);
  });

  test("direct replay ensures and archives old stacks before consuming an entry", async () => {
    const runtime = await openIdentityRuntime();
    const design = await runtime.store.createDesign();
    await connected(runtime, design.id);
    const wires = getSharedDb().select().from(schematicWires).where(eq(schematicWires.designId, design.id)).all();
    getSharedDb().delete(netIdentityState).where(eq(netIdentityState.designId, design.id)).run();
    expect(await runtime.store.undo(design.id, "setup")).toMatchObject({ ok: false, code: "HISTORY_EMPTY" });
    expect(identityState(design.id).status).toBe("active");
    expect(getSharedDb().select().from(schematicWires).where(eq(schematicWires.designId, design.id)).all()).toEqual(wires);
    expect((await runtime.store.getHistory(design.id, "setup")).undoDepth).toBe(0);
  });
});
