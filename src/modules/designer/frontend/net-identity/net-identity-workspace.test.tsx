// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDesignerWorkspace } from "../hooks/useDesignerWorkspace";
import { getDesignerCommandCoordinator } from "../lib/command-coordinator";

const api = vi.hoisted(() => ({ listDesigns: vi.fn(), searchComponents: vi.fn(), getSchematicProjection: vi.fn(),
  getHistory: vi.fn(), dispatch: vi.fn(), undo: vi.fn(), redo: vi.fn() }));
vi.mock("../api", () => ({ createDesignerApi: () => api }));
let root: Root, workspace: ReturnType<typeof useDesignerWorkspace>, backend: string;
beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.resetAllMocks();
  backend = `http://identity-${crypto.randomUUID()}`;
  api.listDesigns.mockResolvedValue([]); api.searchComponents.mockResolvedValue([]);
  api.getSchematicProjection.mockResolvedValue({ designId: "a", revision: 7, parts: [], wires: [], labels: [], nets: [], primitives: [], junctions: [] });
  api.getHistory.mockResolvedValue({ canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 });
  root = createRoot(document.createElement("div"));
  function Capture() { workspace = useDesignerWorkspace({ backendURL: backend, moduleId: "designer", initialDesignId: "a" }); return null; }
  await act(async () => root.render(<Capture />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("exposes the exact coordinator scope and repairs through its PCB history lane", async () => {
  const coordinator = getDesignerCommandCoordinator(api, `${backend}/api/modules/designer`);
  expect(workspace.state.commandScope).toBe(coordinator.scope);
  const reads = api.getSchematicProjection.mock.calls.length, histories = api.getHistory.mock.calls.length;
  api.dispatch.mockResolvedValue({ ok: true, revision: 8, createdEntityId: null });
  await act(async () => workspace.actions.dispatchCommand({ type: "pcb_rebind_net_references", bindings: [{ fromNetId: "old", toNetId: null }] }));
  expect(api.dispatch).toHaveBeenCalledTimes(1);
  expect(api.dispatch.mock.calls[0]![1]).toMatchObject({ baseRevision: 7, sessionId: "designer-pcb-session", command: { type: "pcb_rebind_net_references" } });
  expect(api.getSchematicProjection).toHaveBeenCalledTimes(reads);
  expect(api.getHistory).toHaveBeenCalledTimes(histories);
  api.getSchematicProjection.mockResolvedValue({ ...workspace.state.projection!, revision: 8 });
  await act(async () => {
    workspace.actions.notifyExternalRevisionBump("a", 8);
    await Promise.all([workspace.actions.refreshProjection(), workspace.actions.refreshHistory()]);
  });
  expect(api.getSchematicProjection).toHaveBeenCalledTimes(reads + 1);
  expect(api.getHistory).toHaveBeenCalledTimes(histories + 1);
  expect(workspace.state.projection?.revision).toBe(8);
});
it("keeps net repair outside generic atomic batches", async () => {
  await expect(workspace.actions.dispatchCommandsBatch([{ type: "pcb_rebind_net_references", bindings: [] }])).rejects.toThrow("cannot be included");
  expect(api.dispatch).not.toHaveBeenCalled();
});
