// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  DesignerSchematicProjection,
  DesignerDispatchResult,
} from "../../../../sdks";
import { useDesignerWorkspace } from "./useDesignerWorkspace";
import { getDesignerCommandCoordinator } from "../lib/command-coordinator";

const api = vi.hoisted(() => ({
  listDesigns: vi.fn(),
  searchComponents: vi.fn(),
  getSchematicProjection: vi.fn(),
  getHistory: vi.fn(),
  dispatch: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
}));
vi.mock("../api", () => ({ createDesignerApi: () => api }));
const history = { canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 };
const projection = (
  designId: string,
  revision: number,
): DesignerSchematicProjection => ({
  designId,
  revision,
  parts: [],
  wires: [],
  labels: [],
  nets: [],
  primitives: [],
  junctions: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let root: Root;
let workspace: ReturnType<typeof useDesignerWorkspace>;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  api.listDesigns.mockResolvedValue([]);
  api.searchComponents.mockResolvedValue([]);
  api.getSchematicProjection.mockImplementation(async (id: string) =>
    projection(id, id === "a" ? 15 : 40),
  );
  api.getHistory.mockResolvedValue(history);
  root = createRoot(document.createElement("div"));
  function Capture() {
    workspace = useDesignerWorkspace({
      moduleId: "designer",
      initialDesignId: "a",
    });
    return null;
  }
  await act(async () => root.render(<Capture />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("serializes rapid PCB edits with the acknowledged revision", async () => {
  const first = deferred<DesignerDispatchResult>();
  api.dispatch
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ ok: true, revision: 17, createdEntityId: null });
  let a!: Promise<DesignerDispatchResult>, b!: Promise<DesignerDispatchResult>;
  await act(async () => {
    a = workspace.actions.dispatchCommand({
      type: "pcb_move_placement",
      placementId: "j1",
      positionMm: { x: 1, y: 2 },
    });
    b = workspace.actions.dispatchCommand({
      type: "pcb_move_placement",
      placementId: "r2",
      positionMm: { x: 3, y: 4 },
    });
  });
  const before = api.dispatch.mock.calls.length;
  await act(async () => {
    first.resolve({ ok: true, revision: 16, createdEntityId: null });
    await Promise.all([a, b]);
  });
  expect(before).toBe(1);
  expect(api.dispatch.mock.calls.map((call) => call[1].baseRevision)).toEqual([
    15, 16,
  ]);
});

it("late design A projection cannot replace design B", async () => {
  const late = deferred<DesignerSchematicProjection>();
  api.getSchematicProjection.mockReturnValueOnce(late.promise);
  let refresh!: Promise<void>;
  await act(async () => {
    refresh = workspace.actions.refreshProjection();
  });
  await act(async () => workspace.actions.selectDesign("b"));
  await act(async () => {
    late.resolve(projection("a", 16));
    await refresh;
  });
  expect(workspace.state.projection?.designId).toBe("b");
});

it("submits a logical multi-entity action as one atomic batch", async () => {
  api.dispatch.mockResolvedValue({
    ok: true,
    revision: 16,
    createdEntityId: null,
  });
  const commands = [
    {
      type: "move_part" as const,
      partId: "r1",
      positionNm: { x: 1270000, y: 0 },
    },
    {
      type: "move_part" as const,
      partId: "r2",
      positionNm: { x: 2540000, y: 0 },
    },
  ];
  await act(async () => workspace.actions.dispatchCommandsBatch(commands));
  expect(api.dispatch).toHaveBeenCalledTimes(1);
  expect(api.dispatch.mock.calls[0][1].command).toEqual({
    type: "batch_commands",
    commands,
  });
});

it("an acknowledgement from A never supplies B's next revision", async () => {
  const first = deferred<DesignerDispatchResult>();
  api.dispatch
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ ok: true, revision: 41, createdEntityId: null });
  let pending!: Promise<DesignerDispatchResult>;
  await act(async () => {
    pending = workspace.actions.dispatchCommand({
      type: "pcb_delete_placement",
      placementId: "a-part",
    });
  });
  await act(async () => workspace.actions.selectDesign("b"));
  await act(async () => {
    first.resolve({ ok: true, revision: 16, createdEntityId: null });
    await pending;
  });
  await act(async () => {
    await workspace.actions.dispatchCommand({
      type: "pcb_delete_placement",
      placementId: "b-part",
    });
  });
  expect(
    api.dispatch.mock.calls.map(([id, envelope]) => [
      id,
      envelope.baseRevision,
    ]),
  ).toEqual([
    ["a", 15],
    ["b", 40],
  ]);
  expect(workspace.state.projection?.designId).toBe("b");
});

it("delayed consumers keep their originating design callback", async () => {
  const oldDispatch = workspace.actions.dispatchCommand;
  api.dispatch.mockResolvedValue({
    ok: true,
    revision: 16,
    createdEntityId: null,
  });
  await act(async () => workspace.actions.selectDesign("b"));
  await act(async () => {
    await oldDispatch({ type: "pcb_delete_placement", placementId: "a-part" });
  });
  expect(api.dispatch.mock.calls[0][0]).toBe("a");
  expect(workspace.state.projection?.designId).toBe("b");
});

it("conflict retains failed and unsent edits without replay after refresh", async () => {
  const first = deferred<DesignerDispatchResult>();
  api.dispatch.mockReturnValueOnce(first.promise);
  let settled!: Promise<PromiseSettledResult<DesignerDispatchResult>[]>;
  await act(async () => {
    settled = Promise.allSettled([
      workspace.actions.dispatchCommand({
        type: "pcb_delete_placement",
        placementId: "a-part",
      }),
      workspace.actions.dispatchCommand({
        type: "pcb_delete_placement",
        placementId: "another",
      }),
    ]);
  });
  await act(async () => {
    first.resolve({
      ok: false,
      code: "REVISION_CONFLICT",
      conflict: { expected: 15, actual: 16 },
    });
    await settled;
  });
  expect(api.dispatch).toHaveBeenCalledTimes(1);
  expect(
    workspace.state.commandQueue?.retained.map((edit) => edit.state),
  ).toEqual(["conflicted", "cancelled"]);
  await act(async () => workspace.actions.refreshProjection());
  expect(api.dispatch).toHaveBeenCalledTimes(1);
  expect(workspace.state.commandQueue?.retained).toHaveLength(2);
});

it("coalesces repeated Undo while queued behind a write", async () => {
  const first = deferred<DesignerDispatchResult>();
  api.dispatch.mockReturnValueOnce(first.promise);
  api.undo.mockResolvedValue({ ok: true, revision: 17, history });
  api.getSchematicProjection.mockResolvedValue(projection("a", 17));
  let done!: Promise<unknown>;
  await act(async () => {
    const move = workspace.actions.dispatchCommand({
      type: "pcb_delete_placement",
      placementId: "a-part",
    });
    done = Promise.all([
      move,
      workspace.actions.undo(),
      workspace.actions.undo(),
    ]);
  });
  expect(api.undo).not.toHaveBeenCalled();
  await act(async () => {
    first.resolve({ ok: true, revision: 16, createdEntityId: null });
    await done;
  });
  expect(api.undo).toHaveBeenCalledTimes(1);
  expect(workspace.state.commandQueue?.revision).toBe(17);
});

it("a malformed batch never partially dispatches", async () => {
  await expect(
    workspace.actions.dispatchCommandsBatch([
      { type: "delete_entity", entityId: "r1", entityKind: "part" },
      { type: "batch_commands", commands: [] },
    ]),
  ).rejects.toThrow("cannot be included");
  expect(api.dispatch).not.toHaveBeenCalled();
});

it("explicit conflict reapply reads the new revision and uses a new command ID", async () => {
  api.dispatch.mockResolvedValueOnce({
    ok: false,
    code: "REVISION_CONFLICT",
    conflict: { expected: 15, actual: 16 },
  });
  await act(async () => {
    await workspace.actions
      .dispatchCommand({ type: "pcb_delete_placement", placementId: "a-part" })
      .catch(() => undefined);
  });
  const retained = workspace.state.commandQueue!.retained[0]!;
  api.getSchematicProjection.mockResolvedValue(projection("a", 16));
  api.dispatch.mockResolvedValueOnce({
    ok: true,
    revision: 17,
    createdEntityId: null,
  });
  await act(async () => workspace.actions.reapplyRetainedCommand(retained.id));
  expect(api.dispatch.mock.calls.map((call) => call[1].baseRevision)).toEqual([
    15, 16,
  ]);
  expect(api.dispatch.mock.calls[0][1].commandId).not.toBe(
    api.dispatch.mock.calls[1][1].commandId,
  );
  expect(workspace.state.commandQueue?.retained).toEqual([]);
});

it("an uncertain transport failure cannot be reapplied", async () => {
  api.dispatch.mockRejectedValueOnce(new Error("connection lost after write"));
  await act(async () => {
    await workspace.actions
      .dispatchCommand({ type: "pcb_delete_placement", placementId: "a-part" })
      .catch(() => undefined);
  });
  const retained = workspace.state.commandQueue!.retained[0]!;
  await act(async () => {
    await expect(
      workspace.actions.reapplyRetainedCommand(retained.id),
    ).rejects.toThrow("Only a confirmed");
  });
  expect(api.dispatch).toHaveBeenCalledTimes(1);
  expect(workspace.state.commandQueue?.retained).toHaveLength(1);
});

it("retains rejected edits across module remount and prevents unattended close", async () => {
  const scope = `http://isolated-${crypto.randomUUID()}/designer`;
  const first = getDesignerCommandCoordinator(api, scope);
  api.dispatch.mockRejectedValueOnce(new Error("lost acknowledgement"));
  await first
    .dispatch("a", { type: "pcb_delete_placement", placementId: "a-part" })
    .catch(() => undefined);
  const remounted = getDesignerCommandCoordinator(api, scope);
  expect(remounted.queue.snapshot("a").retained).toHaveLength(1);
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(
    getDesignerCommandCoordinator(
      api,
      `${scope}/other`,
    ).queue.hasUnsettledEdits(),
  ).toBe(false);
  remounted.queue.discardRetained("a");
});
