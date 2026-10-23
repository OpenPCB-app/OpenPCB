import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { DesignerCommand } from "../../../sdks/designer";
import { loadSchematicProjection } from "../../../modules/designer/backend/projection-read";
import { executeDesignerCommand } from "../../../modules/designer/backend/command-executor";
import { pcbEntities, netIdentityState as stateTable, schematicWires } from "../../../modules/designer/backend/schema";
import { writeNetIdentityState } from "../../../modules/designer/backend/net-identity/state-store";
import { getSharedDb } from "../db/sqlite-client";
import { body, connected, identityState, openIdentityRuntime, placed, rawRuntimeState, send, setupRuntimeCleanup } from "./helpers/net-identity-runtime";

setupRuntimeCleanup();

describe("store durable net identity dispatch", () => {
  test("design, schematic, PCB, BOM and history reads ensure identity before loading", async () => {
    const runtime = await openIdentityRuntime();
    for (const read of [
      (id: string) => runtime.store.getDesign(id),
      (id: string) => runtime.store.getSchematicProjection(id),
      (id: string) => runtime.store.getPcbProjection(id),
      (id: string) => runtime.store.getBomProjection(id),
      (id: string) => runtime.store.getHistory(id, "A"),
    ]) {
      const design = await runtime.store.createDesign();
      getSharedDb().delete(stateTable).where(eq(stateTable.designId, design.id)).run();
      expect(await read(design.id)).not.toBeNull();
      expect(identityState(design.id)).toMatchObject({ status: "active", provenance: { origin: "legacy-migration" } });
    }
  });

  test("native wire, schematic moves, rotation and refdes preserve copper/rule ownership after reopen", async () => {
    let runtime = await openIdentityRuntime();
    const design = await runtime.store.createDesign();
    expect(identityState(design.id)).toMatchObject({ status: "active", active: [], nextSeq: 1, provenance: { origin: "native" } });
    const chain = await connected(runtime, design.id);
    const board = (await runtime.store.getPcbProjection(design.id))!.board;
    await send(runtime, design.id, { type: "pcb_add_trace", netId: chain.netId, netClassId: board.netClasses[0]!.id,
      layer: "F.Cu", widthMm: 0.25, pointsNm: [{ x: 2_000_000, y: 2_000_000 }, { x: 4_000_000, y: 2_000_000 }], segmentMode: "manhattan-90" });
    await send(runtime, design.id, { type: "pcb_set_design_rules", perNetClassAssignments: { [chain.netId]: board.netClasses[0]!.id },
      lengthMatchGroups: [{ id: "length", name: "Length", netIds: [chain.netId], target: { kind: "absolute", mm: 10 }, toleranceMm: 0 }] });
    const rawPcb = getSharedDb().select().from(pcbEntities).where(eq(pcbEntities.designId, design.id)).all();
    for (const command of [
      { type: "move_part", partId: chain.first.partId, positionNm: { x: -4_000_000, y: -2_000_000 } },
      { type: "rotate_part", partId: chain.first.partId, rotationDeg: 90 },
      { type: "update_part_properties", partId: chain.first.partId, reference: "R17" },
    ] as const) {
      expect((await send(runtime, design.id, command)).netIdentity).toBeUndefined();
      expect(identityState(design.id).active.map((record) => record.id)).toEqual([chain.netId]);
    }
    runtime = await openIdentityRuntime(runtime.file);
    expect((await runtime.store.getSchematicProjection(design.id))!.nets.some((net) => net.id === chain.netId)).toBe(true);
    expect(getSharedDb().select().from(pcbEntities).where(eq(pcbEntities.designId, design.id)).all()).toEqual(rawPcb);
    expect((await runtime.store.getBomProjection(design.id))!.rows.some((row) => row.refs.some((ref) => ref.refdes === "R17"))).toBe(true);
  });

  test("idempotent split replay preserves events and does not run ensure or touch rows", async () => {
    const runtime = await openIdentityRuntime();
    const design = await runtime.store.createDesign();
    const chain = await connected(runtime, design.id);
    const envelope = body(design.id, { type: "delete_entity", entityKind: "wire", entityId: chain.wireId });
    const first = await runtime.store.dispatchCommand(design.id, envelope);
    expect(first).toMatchObject({ ok: true, netIdentity: { events: [{ kind: "split", netId: chain.netId }] } });
    if (!first.ok) throw new Error(JSON.stringify(first));
    getSharedDb().delete(stateTable).where(eq(stateTable.designId, design.id)).run();
    const before = rawRuntimeState(design.id);
    expect(await runtime.store.dispatchCommand(design.id, envelope)).toEqual({ ...first, idempotent: true });
    expect(rawRuntimeState(design.id)).toEqual(before);
    expect(identityState(design.id)).toBeNull();
  });

  test("failed result leaves identity untouched; changed failure sync rolls all writes back", async () => {
    const runtime = await openIdentityRuntime();
    const design = await runtime.store.createDesign();
    const chain = await connected(runtime, design.id);
    const before = rawRuntimeState(design.id);
    expect(await runtime.store.dispatchCommand(design.id, body(design.id, {
      type: "delete_entity", entityKind: "wire", entityId: "missing",
    }))).toEqual({ ok: false, code: "ENTITY_NOT_FOUND", entityKind: "wire", entityId: "missing" });
    expect(rawRuntimeState(design.id)).toEqual(before);
    getSharedDb().delete(schematicWires).where(eq(schematicWires.id, chain.wireId)).run();
    const stale = rawRuntimeState(design.id);
    expect((await runtime.store.dispatchCommand(design.id, body(design.id, {
      type: "delete_entity", entityKind: "wire", entityId: "missing-again",
    }))).ok).toBe(false);
    expect(rawRuntimeState(design.id)).toEqual(stale);
    expect(JSON.stringify(runtime.errors)).toContain("failed command changed net identity: delete_entity");
  });

  test("neutral commands skip production sync and assert without identity writes in development", async () => {
    const runtime = await openIdentityRuntime();
    const design = await runtime.store.createDesign();
    const chain = await connected(runtime, design.id);
    getSharedDb().delete(schematicWires).where(eq(schematicWires.id, chain.wireId)).run();
    process.env.NODE_ENV = "production";
    const prior = identityState(design.id);
    await send(runtime, design.id, { type: "pcb_add_free_hole", centerMm: { x: 40, y: 40 }, drillMm: 1 });
    expect(identityState(design.id)).toEqual(prior);
    process.env.NODE_ENV = "development";
    const before = rawRuntimeState(design.id);
    const hole = { type: "pcb_add_free_hole", centerMm: { x: 50, y: 50 }, drillMm: 1 } as const;
    const commands: DesignerCommand[] = [hole, { type: "batch_commands", commands: [hole] }];
    for (const command of commands) {
      expect((await runtime.store.dispatchCommand(design.id, body(design.id, command))).ok).toBe(false);
      expect(rawRuntimeState(design.id)).toEqual(before);
    }
    expect(JSON.stringify(runtime.errors)).toContain("schematic-neutral command changed membership: pcb_add_free_hole");
  });

  for (const status of ["migration_failed", "legacy_restored"] as const) {
    test(`${status} stays editable in legacy mode`, async () => {
      const runtime = await openIdentityRuntime();
      const design = await runtime.store.createDesign();
      const first = await placed(runtime, design.id, 0, 0);
      const second = await placed(runtime, design.id, 10_000_000, 0);
      writeNetIdentityState(getSharedDb(), { ...identityState(design.id), status, active: [],
        lastError: status === "migration_failed" ? "test failure" : null });
      await send(runtime, design.id, { type: "create_wire", sourcePinId: first.pinId, targetPinId: second.pinId });
      expect(identityState(design.id).status).toBe(status);
      expect((await runtime.store.getSchematicProjection(design.id))!.nets[0]!.id).toStartWith("pt:");
      expect((await runtime.store.getPcbProjection(design.id))!.designId).toBe(design.id);
      expect((await runtime.store.undo(design.id, "A")).ok).toBe(true);
      expect(identityState(design.id).status).toBe(status);
    });
  }

  test("pending IDs exist only in intermediate batch projection, never persisted after commit", async () => {
    const runtime = await openIdentityRuntime();
    const design = await runtime.store.createDesign();
    const first = await placed(runtime, design.id, 0, 0);
    const second = await placed(runtime, design.id, 10_000_000, 0);
    const observed: string[] = [];
    expect(() => getSharedDb().transaction((tx) => {
      const projection = loadSchematicProjection(tx, design.id)!;
      const result = executeDesignerCommand({ tx, designId: design.id, revision: projection.revision,
        identityMode: "durable", timestamp: new Date().toISOString(), projection, placeComponentDetail: null,
        command: { type: "create_wire", sourcePinId: first.pinId, targetPinId: second.pinId } });
      expect(result.ok).toBe(true);
      observed.push(...loadSchematicProjection(tx, design.id)!.nets.map((net) => net.id));
      throw new Error("rollback pending probe");
    })).toThrow("rollback pending probe");
    await send(runtime, design.id, { type: "batch_commands", commands: [
      { type: "create_wire", sourcePinId: first.pinId, targetPinId: second.pinId },
      { type: "update_part_properties", partId: first.partId, value: "batch" },
    ] });
    expect(observed.some((netId) => netId.startsWith("pending:"))).toBe(true);
    expect(identityState(design.id).active).toHaveLength(1);
    expect(JSON.stringify(rawRuntimeState(design.id))).not.toContain("pending:");
    expect((await runtime.store.getSchematicProjection(design.id))!.nets.every((net) => !net.id.startsWith("pending:"))).toBe(true);
  });
});
