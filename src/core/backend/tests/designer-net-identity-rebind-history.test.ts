import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { AppError } from "../../contracts/errors";
import { designHeads, pcbEntities } from "../../../modules/designer/backend/schema";
import { writeNetIdentityState } from "../../../modules/designer/backend/net-identity/state-store";
import { getSharedDb, getSharedSqlite } from "../db/sqlite-client";
import { identityState, openIdentityRuntime, send, setupRuntimeCleanup } from "./helpers/net-identity-runtime";
import { allDesignerRows, copper, fullReferences, identityRows, OLD, payloadSnapshot, readPayload, rebindRuntime,
  repair, REPAIR_SESSION, tamperHistory, updatePayload } from "./helpers/net-rebind-runtime";

setupRuntimeCleanup();

async function conflict(work: () => Promise<unknown>): Promise<void> {
  let caught: unknown;
  try { await work(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(AppError);
  expect(caught as AppError).toMatchObject({ status: 409, extras: { code: "NET_REBIND_HISTORY_CONFLICT" } });
}

describe("repair raw history integration", () => {
  test("raw unknown geometry, board scopes and removed rows survive repair/undo/redo after reboot", async () => {
    let runtime = await rebindRuntime();
    fullReferences(runtime);
    const before = payloadSnapshot(runtime.designId), identities = identityRows(runtime.designId);
    expect((await repair(runtime)).ok).toBe(true);
    const after = payloadSnapshot(runtime.designId);
    expect(after).not.toEqual(before);
    runtime = { ...runtime, ...await openIdentityRuntime(runtime.file) };
    expect(await runtime.store.undo(runtime.designId, REPAIR_SESSION)).toMatchObject({ ok: true, history: { undoDepth: 0, redoDepth: 1 } });
    expect(payloadSnapshot(runtime.designId)).toEqual(before);
    expect(identityRows(runtime.designId)).toBe(identities);
    runtime = { ...runtime, ...await openIdentityRuntime(runtime.file) };
    expect(await runtime.store.redo(runtime.designId, REPAIR_SESSION)).toMatchObject({ ok: true, history: { undoDepth: 1, redoDepth: 0 } });
    expect(payloadSnapshot(runtime.designId)).toEqual(after);
    expect(identityRows(runtime.designId)).toBe(identities);
  });

  test("other session geometry and live view settings survive undo/redo", async () => {
    const runtime = await rebindRuntime(), rowId = copper(runtime, "trace");
    expect((await repair(runtime)).ok).toBe(true);
    const pointsNm = [{ x: 10_000_000, y: 20_000_000 }, { x: 30_000_000, y: 20_000_000 }];
    await send(runtime, runtime.designId, { type: "pcb_update_trace_geometry", traceId: rowId, pointsNm, legality: "off" }, "B");
    await send(runtime, runtime.designId, { type: "pcb_set_active_layer", layer: "B.Cu" }, "B");
    await send(runtime, runtime.designId, { type: "pcb_set_visible_layers", visibleLayers: ["B.Cu"] }, "B");
    await send(runtime, runtime.designId, { type: "pcb_set_view_state", patch: { ratsnestVisible: false } }, "B");
    const board = getSharedDb().select().from(pcbEntities).where(eq(pcbEntities.kind, "board_settings")).get()!;
    const liveBoard = readPayload(board.id), identities = identityRows(runtime.designId);
    expect((await runtime.store.undo(runtime.designId, REPAIR_SESSION)).ok).toBe(true);
    expect(readPayload(rowId)).toMatchObject({ netId: OLD, pointsNm });
    expect(readPayload(board.id)).toEqual(liveBoard);
    expect((await runtime.store.redo(runtime.designId, REPAIR_SESSION)).ok).toBe(true);
    expect(readPayload(rowId)).toMatchObject({ netId: runtime.target, pointsNm });
    expect(readPayload(board.id)).toEqual(liveBoard);
    expect(identityRows(runtime.designId)).toBe(identities);
  });

  test("board field inverse preserves newer view and unrelated requirement fields", async () => {
    const runtime = await rebindRuntime(), rows = fullReferences(runtime);
    await repair(runtime);
    updatePayload(rows.board, { activeLayer: "B.Cu", visibleLayers: ["B.Cu"], viewState: { futureView: 42 }, currentLimits: { futureRequirement: 7 } });
    const live = readPayload(rows.board);
    expect((await runtime.store.undo(runtime.designId, REPAIR_SESSION)).ok).toBe(true);
    expect(readPayload(rows.board)).toMatchObject({ activeLayer: live.activeLayer, visibleLayers: live.visibleLayers,
      viewState: live.viewState, currentLimits: live.currentLimits });
    expect((readPayload(rows.board).drcRules as unknown[]).length).toBe(3);
  });

  test.each(["same-field", "missing-row", "affected-section"])("%s conflict retains every row, head and persisted stack", async (kind) => {
    const runtime = await rebindRuntime(), rows = fullReferences(runtime);
    await repair(runtime);
    if (kind === "same-field") updatePayload(rows.trace, { netId: runtime.other });
    if (kind === "missing-row") getSharedDb().delete(pcbEntities).where(eq(pcbEntities.id, rows.trace)).run();
    if (kind === "affected-section") updatePayload(rows.board, { drcRules: [{ id: "other-session-rule" }] });
    const before = allDesignerRows();
    await conflict(() => runtime.store.undo(runtime.designId, REPAIR_SESSION));
    expect(allDesignerRows()).toBe(before);
  });

  test.each(["missing-carrier", "mixed-patch", "wrong-command", "wrong-aggregate", "wrong-payload", "missing-envelope"])("tampered %s fails closed without consuming history", async (kind) => {
    const runtime = await rebindRuntime();
    copper(runtime, "trace"); await repair(runtime);
    tamperHistory(runtime.designId, (entry) => {
      const envelope = entry.envelope as { command: { type: string }; aggregateId: string };
      const patches = entry.inversePatches as { component: { payload: { designId: string } } }[];
      if (kind === "missing-carrier") entry.inversePatches = [];
      if (kind === "mixed-patch") (entry.inversePatches as unknown[]).push({ kind: "noop" });
      if (kind === "wrong-command") envelope.command.type = "pcb_add_trace";
      if (kind === "wrong-aggregate") envelope.aggregateId = "another-design";
      if (kind === "wrong-payload") patches[0]!.component.payload.designId = "another-design";
      if (kind === "missing-envelope") delete entry.envelope;
    });
    const before = allDesignerRows();
    await conflict(() => runtime.store.undo(runtime.designId, REPAIR_SESSION));
    expect(allDesignerRows()).toBe(before);
  });

  test("repair redo restores historical inactive target without identity reactivation", async () => {
    const runtime = await rebindRuntime(), trace = copper(runtime, "trace");
    await repair(runtime);
    expect((await runtime.store.undo(runtime.designId, REPAIR_SESSION)).ok).toBe(true);
    await send(runtime, runtime.designId, { type: "delete_entity", entityKind: "label", entityId: runtime.targetLabelId }, "B");
    expect(identityState(runtime.designId).active.some((net) => net.id === runtime.target)).toBe(false);
    const identities = identityRows(runtime.designId);
    expect((await runtime.store.redo(runtime.designId, REPAIR_SESSION)).ok).toBe(true);
    expect(readPayload(trace).netId).toBe(runtime.target);
    expect(identityRows(runtime.designId)).toBe(identities);
  });

  test("legacy replay refuses rather than using generic typed history", async () => {
    const runtime = await rebindRuntime();
    copper(runtime, "trace"); await repair(runtime);
    writeNetIdentityState(getSharedDb(), { ...identityState(runtime.designId), status: "legacy_restored", active: [] });
    const before = allDesignerRows();
    await conflict(() => runtime.store.undo(runtime.designId, REPAIR_SESSION));
    expect(allDesignerRows()).toBe(before);
  });

  test.each([-1, Number.MAX_SAFE_INTEGER])("corrupt/exhausted revision %s refuses before raw changes", async (revision) => {
    const runtime = await rebindRuntime();
    copper(runtime, "trace"); await repair(runtime);
    getSharedDb().update(designHeads).set({ revision }).where(eq(designHeads.id, runtime.designId)).run();
    const before = allDesignerRows();
    await conflict(() => runtime.store.undo(runtime.designId, REPAIR_SESSION));
    expect(allDesignerRows()).toBe(before);
  });

  test("mid-replay storage failure rolls back raw changes, revision and history movement", async () => {
    const runtime = await rebindRuntime();
    copper(runtime, "one"); copper(runtime, "two"); await repair(runtime);
    const sqlite = getSharedSqlite();
    sqlite.exec("CREATE TEMP TABLE replay_counter (value INTEGER); INSERT INTO replay_counter VALUES (0)");
    sqlite.exec("CREATE TEMP TRIGGER fail_replay BEFORE UPDATE ON designer_pcb_entities BEGIN UPDATE replay_counter SET value = value + 1; SELECT CASE WHEN (SELECT value FROM replay_counter) = 2 THEN RAISE(ABORT, 'mid-replay failure') END; END");
    const before = allDesignerRows();
    await expect(runtime.store.undo(runtime.designId, REPAIR_SESSION)).rejects.toThrow("mid-replay failure");
    expect(allDesignerRows()).toBe(before);
  });
});
