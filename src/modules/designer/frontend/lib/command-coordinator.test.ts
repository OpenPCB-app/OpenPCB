import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesignerBatchCommandsCommand, DesignerCommandOkResult, DesignerNetIdentityEvent } from "../../../../sdks/designer";
import { toast } from "../../../../shared/frontend/ui/toast-store";
import { createNetIdentityActivityStore, selectNetIdentityActivity, useNetIdentityActivityStore } from "../net-identity/net-identity-activity-store";
import { DesignerCommandCoordinator, getDesignerCommandCoordinator, NetMergeDeclinedError, SCHEMATIC_SESSION } from "./command-coordinator";

type Api = ConstructorParameters<typeof DesignerCommandCoordinator>[0];
const history = { canUndo: true, canRedo: false, undoDepth: 1, redoDepth: 0 };
const command = { type: "delete_entity" as const, entityKind: "wire" as const, entityId: "wire" };
const dependents = { traces: 1, vias: 0, zones: 0, freePads: 0, netClassAssignment: false,
  lengthGroupIds: [], diffPairIds: [], drcRuleIds: [] };
const event = (hasDependents = true): DesignerNetIdentityEvent => ({
  kind: "split", netId: "signal", netName: "Signal", keptPinCount: 2, hasDependents,
  newNets: [{ netId: "branch", netName: "Branch", pinCount: 1 }], dependents,
});
const success = (revision = 1, events = [event()]): DesignerCommandOkResult => ({
  ok: true, revision, createdEntityId: null, netIdentity: { events },
});
function mockApi() {
  return {
    dispatch: vi.fn<Api["dispatch"]>().mockResolvedValue(success()),
    getSchematicProjection: vi.fn<Api["getSchematicProjection"]>().mockResolvedValue({
      designId: "design", revision: 0, parts: [], wires: [], labels: [], nets: [], primitives: [], junctions: [],
    }),
    undo: vi.fn<Api["undo"]>().mockResolvedValue({ ok: true, revision: 2, history, netIdentity: { events: [event()] } }),
    redo: vi.fn<Api["redo"]>().mockResolvedValue({ ok: true, revision: 3, history, netIdentity: { events: [event()] } }),
  };
}
let store: ReturnType<typeof createNetIdentityActivityStore>;
let api: ReturnType<typeof mockApi>;
beforeEach(() => {
  store = createNetIdentityActivityStore(); api = mockApi();
  vi.spyOn(useNetIdentityActivityStore, "getState").mockImplementation(() => store.getState());
  vi.spyOn(toast, "warning").mockReturnValue("warning");
});
afterEach(() => vi.restoreAllMocks());

describe("coordinated net identity activity", () => {
  it("records every successful event but warns only for dependent events", async () => {
    api.dispatch.mockResolvedValue(success(1, [event(false), event(), {
      kind: "removed", netId: "old", netName: "Old power", hasDependents: true, dependents,
    }]));
    const coordinator = new DesignerCommandCoordinator(api, "backend");
    await expect(coordinator.dispatch("design", command)).resolves.toMatchObject({ ok: true });
    expect(store.getState().entries.map((entry) => entry.event.kind)).toEqual(["split", "split", "removed"]);
    expect(toast.warning).toHaveBeenCalledTimes(2);
    expect(vi.mocked(toast.warning).mock.calls.map(([message]) => message)).toEqual([
      "Net 'Signal' split; new nets: 'Branch'. Review copper and rules.",
      "Net 'Old power' removed. Review copper and rules.",
    ]);
    expect(coordinator.queue.snapshot("design")).toMatchObject({ revision: 1, state: "acknowledged", retained: [] });
  });

  it("a response without dependent events is listed without a warning", async () => {
    api.dispatch.mockResolvedValue(success(1, [event(false)]));
    await new DesignerCommandCoordinator(api).dispatch("design", command);
    expect(store.getState().entries).toHaveLength(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("records undo and redo before refresh, preserving their directions", async () => {
    const coordinator = new DesignerCommandCoordinator(api, "backend");
    const refresh = vi.fn(async () => {
      expect(store.getState().entries).toHaveLength(refresh.mock.calls.length);
      expect(toast.warning).toHaveBeenCalledTimes(refresh.mock.calls.length);
    });
    await coordinator.history("design", SCHEMATIC_SESSION, "undo", refresh);
    await coordinator.history("design", SCHEMATIC_SESSION, "redo", refresh);
    expect(store.getState().entries.map((entry) => [entry.source, entry.revision])).toEqual([["undo", 2], ["redo", 3]]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("records the first observed idempotent success and dedupes retry after coordinator reopen", async () => {
    const scope = `backend:${crypto.randomUUID()}`;
    api.dispatch.mockResolvedValue({ ...success(5), idempotent: true });
    const first = getDesignerCommandCoordinator(api, scope);
    await first.dispatch("design", command);
    const reopened = getDesignerCommandCoordinator(api, scope);
    expect(reopened).toBe(first);
    await reopened.dispatch("design", command);
    expect(store.getState().entries).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("isolates backend scopes and design ids, including private unscoped instances", async () => {
    const a = new DesignerCommandCoordinator(api, "a"), b = new DesignerCommandCoordinator(api, "b");
    await a.dispatch("one", command); await a.dispatch("two", command); await b.dispatch("one", command);
    expect(selectNetIdentityActivity("a", "one")(store.getState())).toHaveLength(1);
    expect(selectNetIdentityActivity("a", "two")(store.getState())).toHaveLength(1);
    expect(selectNetIdentityActivity("b", "one")(store.getState())).toHaveLength(1);
    const privateA = new DesignerCommandCoordinator(api), privateB = new DesignerCommandCoordinator(api);
    expect(privateA.scope).not.toBe(privateB.scope);
    await privateA.dispatch("one", command); await privateB.dispatch("one", command);
    expect(store.getState().entries).toHaveLength(5);
    expect(new Set(vi.mocked(toast.warning).mock.calls.map(([, options]) => options?.id)).size).toBe(5);
  });

  it("records only the confirmed success on merge retry", async () => {
    api.dispatch.mockResolvedValueOnce({ ok: false, code: "NET_MERGE_REQUIRES_CONFIRM", message: "Confirm", nets: [] })
      .mockResolvedValueOnce(success());
    const coordinator = new DesignerCommandCoordinator(api);
    coordinator.confirmNetMerge = vi.fn().mockResolvedValue(true);
    await coordinator.dispatch("design", { type: "move_part", partId: "part", positionNm: { x: 1, y: 2 } });
    expect(api.dispatch).toHaveBeenCalledTimes(2);
    expect(api.dispatch.mock.calls[1]![1].command).toMatchObject({ confirmMerge: true });
    expect(store.getState().entries).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("confirms gated batch steps with fresh id and the same revision, preserving other data", async () => {
    const batch: DesignerBatchCommandsCommand = { type: "batch_commands", commands: [
      { type: "upsert_label", labelId: "label", text: "A", positionNm: { x: 1, y: 2 } },
      { type: "place_gnd_port", positionNm: { x: 0, y: 0 } },
      { type: "place_pwr_port", railText: "VCC", positionNm: { x: 0, y: 0 } },
      { type: "place_net_portal", portalText: "A", positionNm: { x: 0, y: 0 } },
      { type: "update_primitive_text", primitiveId: "primitive", text: "A" },
      { type: "move_primitive", primitiveId: "primitive", positionNm: { x: 3, y: 4 } },
      { type: "rotate_primitive", primitiveId: "primitive", rotationDeg: 90 },
      { type: "move_part", partId: "part", positionNm: { x: 5, y: 6 }, confirmMerge: false },
      { type: "rotate_part", partId: "part", rotationDeg: 180 },
      { type: "mirror_part", partId: "part", mirrored: true },
      { type: "duplicate_part", partId: "part", positionNm: { x: 7, y: 8 } },
      { type: "update_wire_geometry", wireId: "wire", pointsNm: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      { type: "auto_arrange_schematic", originNm: { x: 9, y: 10 }, scope: "all" },
      { type: "create_wire", sourcePinId: "a", targetPinId: "b" }, command,
    ] };
    const original = structuredClone(batch);
    api.dispatch.mockResolvedValueOnce({ ok: false, code: "NET_MERGE_REQUIRES_CONFIRM", message: "Confirm", nets: [] })
      .mockResolvedValueOnce(success());
    const coordinator = new DesignerCommandCoordinator(api);
    coordinator.confirmNetMerge = vi.fn().mockResolvedValue(true);
    await coordinator.dispatch("design", batch);
    const [first, second] = api.dispatch.mock.calls.map(([, envelope]) => envelope);
    expect(first!.baseRevision).toBe(0); expect(second!.baseRevision).toBe(first!.baseRevision);
    expect(second!.commandId).not.toBe(first!.commandId); expect(second!.sessionId).toBe(first!.sessionId);
    expect(second!.command).toEqual({ ...batch, commands: batch.commands.map((step, index) => index < 13 ? { ...step, confirmMerge: true } : step) });
    expect(Object.hasOwn(second!.command, "confirmMerge")).toBe(false);
    expect(batch).toEqual(original); expect(api.dispatch).toHaveBeenCalledTimes(2);
    expect(store.getState().entries).toHaveLength(1);
  });

  it("declining batch merge sends no retry and leaves the batch intact", async () => {
    const batch: DesignerBatchCommandsCommand = { type: "batch_commands", commands: [
      { type: "move_part", partId: "part", positionNm: { x: 1, y: 2 } }, command,
    ] }, original = structuredClone(batch);
    api.dispatch.mockResolvedValueOnce({ ok: false, code: "NET_MERGE_REQUIRES_CONFIRM", message: "Confirm", nets: [] });
    const coordinator = new DesignerCommandCoordinator(api);
    coordinator.confirmNetMerge = vi.fn().mockResolvedValue(false);
    await expect(coordinator.dispatch("design", batch)).rejects.toBeInstanceOf(NetMergeDeclinedError);
    expect(api.dispatch).toHaveBeenCalledTimes(1); expect(batch).toEqual(original);
    expect(store.getState().entries).toEqual([]);
  });

  it("declined merges and rejected commands produce no activity", async () => {
    api.dispatch.mockResolvedValueOnce({ ok: false, code: "NET_MERGE_REQUIRES_CONFIRM", message: "Confirm", nets: [] })
      .mockResolvedValueOnce({ ok: false, code: "OPERATION_IDENTITY_CONFLICT", commandId: "old" });
    const coordinator = new DesignerCommandCoordinator(api);
    await expect(coordinator.dispatch("design", command)).rejects.toBeInstanceOf(NetMergeDeclinedError);
    await expect(coordinator.dispatch("design", command)).rejects.toThrow();
    expect(store.getState().entries).toEqual([]);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("failed history creates no activity and does not refresh", async () => {
    api.undo.mockResolvedValue({ ok: false, code: "HISTORY_EMPTY", direction: "undo", history });
    const refresh = vi.fn(async () => {});
    await expect(new DesignerCommandCoordinator(api).history("design", SCHEMATIC_SESSION, "undo", refresh)).rejects.toThrow("Nothing to undo");
    expect(refresh).not.toHaveBeenCalled();
    expect(store.getState().entries).toEqual([]);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("conflict reapply records its eventual committed result once", async () => {
    api.dispatch.mockResolvedValueOnce({ ok: false, code: "REVISION_CONFLICT", conflict: { expected: 0, actual: 1 } })
      .mockResolvedValueOnce(success(2));
    const coordinator = new DesignerCommandCoordinator(api);
    await expect(coordinator.dispatch("design", command)).rejects.toThrow("Design changed elsewhere");
    expect(store.getState().entries).toHaveLength(0);
    const retained = coordinator.queue.snapshot("design").retained[0]!;
    await coordinator.reapply("design", retained.id);
    expect(store.getState().entries).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(coordinator.queue.snapshot("design").retained).toEqual([]);
  });

  it("throwing activity writes cannot reject committed commands, block their queue, or skip history refresh", async () => {
    vi.spyOn(store.getState(), "append").mockImplementation(() => { throw new Error("activity failed"); });
    api.dispatch.mockResolvedValueOnce(success(1)).mockResolvedValueOnce(success(2));
    const coordinator = new DesignerCommandCoordinator(api), refresh = vi.fn(async () => {});
    await expect(Promise.all([coordinator.dispatch("design", command), coordinator.dispatch("design", command)]))
      .resolves.toHaveLength(2);
    await expect(coordinator.history("design", SCHEMATIC_SESSION, "redo", refresh)).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(coordinator.queue.snapshot("design")).toMatchObject({ revision: 3, state: "acknowledged", pending: 0, retained: [] });
  });

  it("throwing toast writes do not skip later events, command acknowledgement, or history refresh", async () => {
    vi.mocked(toast.warning).mockImplementation(() => { throw new Error("toast failed"); });
    api.dispatch.mockResolvedValue(success(1, [event(), event()]));
    const coordinator = new DesignerCommandCoordinator(api), refresh = vi.fn(async () => {});
    await expect(coordinator.dispatch("design", command)).resolves.toMatchObject({ ok: true, revision: 1 });
    await expect(coordinator.history("design", SCHEMATIC_SESSION, "undo", refresh)).resolves.toBeUndefined();
    expect(store.getState().entries).toHaveLength(3);
    expect(toast.warning).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(coordinator.queue.snapshot("design").retained).toEqual([]);
  });

  it("a throwing activity subscriber cannot turn stored success into retained failure", async () => {
    const unsubscribe = store.subscribe(() => { throw new Error("render failed"); });
    const coordinator = new DesignerCommandCoordinator(api), refresh = vi.fn(async () => {});
    api.dispatch.mockResolvedValueOnce(success(1)).mockResolvedValueOnce(success(2));
    try {
      await expect(Promise.all([coordinator.dispatch("design", command), coordinator.dispatch("design", command)]))
        .resolves.toHaveLength(2);
      await expect(coordinator.history("design", SCHEMATIC_SESSION, "redo", refresh)).resolves.toBeUndefined();
      expect(store.getState().entries).toHaveLength(3);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(coordinator.queue.snapshot("design")).toMatchObject({ revision: 3, pending: 0, retained: [] });
    } finally { unsubscribe(); }
  });

  it("malformed observer data cannot reject an acknowledged command", async () => {
    const netIdentity = { get events(): DesignerNetIdentityEvent[] { throw new Error("broken activity data"); } };
    api.dispatch.mockResolvedValue({ ...success(), netIdentity });
    const coordinator = new DesignerCommandCoordinator(api);
    await expect(coordinator.dispatch("design", command)).resolves.toMatchObject({ ok: true, revision: 1 });
    expect(coordinator.queue.snapshot("design")).toMatchObject({ revision: 1, pending: 0, retained: [] });
    expect(store.getState().entries).toEqual([]);
  });
});
