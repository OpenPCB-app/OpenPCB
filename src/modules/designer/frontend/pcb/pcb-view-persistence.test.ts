import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePcbViewStore } from "./pcb-view-store";
import type { DesignerDispatchResult } from "../../../../sdks";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(async () => {
  await usePcbViewStore.getState().flush();
  usePcbViewStore.getState().setDispatcher(null);
  vi.useRealTimers();
});
it("flushes a delayed view edit through its outgoing design dispatcher", async () => {
  const a = vi.fn().mockResolvedValue({ ok: true, revision: 1 });
  const b = vi.fn().mockResolvedValue({ ok: true, revision: 41 });
  const store = usePcbViewStore.getState();
  store.hydrateFromProjection({
    designId: "a",
    viewState: undefined,
    activeLayer: "F.Cu",
    visibleLayers: ["F.Cu"],
  });
  store.setDispatcher(a);
  store.setViewSide("bottom");
  store.setDispatcher(b);
  store.hydrateFromProjection({
    designId: "b",
    viewState: undefined,
    activeLayer: "F.Cu",
    visibleLayers: ["F.Cu"],
  });
  await vi.advanceTimersByTimeAsync(201);
  expect(a).toHaveBeenCalledTimes(1);
  expect(a.mock.calls[0][0]).toEqual({
    type: "pcb_set_view_state",
    patch: { viewSide: "bottom" },
  });
  expect(b).not.toHaveBeenCalled();
  expect(usePcbViewStore.getState().viewState.viewSide).toBe("top");
});
it("old acknowledgements do not clear protection of newer pending fields", async () => {
  let resolve!: (result: DesignerDispatchResult) => void;
  const first = new Promise<DesignerDispatchResult>((done) => {
    resolve = done;
  });
  const dispatch = vi
    .fn()
    .mockReturnValueOnce(first)
    .mockResolvedValue({ ok: true, revision: 2 });
  const store = usePcbViewStore.getState();
  store.hydrateFromProjection({
    designId: "a",
    viewState: undefined,
    activeLayer: "F.Cu",
    visibleLayers: ["F.Cu"],
  });
  store.setDispatcher(dispatch);
  store.setLayerOpacity("F.Cu", 0.5);
  await vi.advanceTimersByTimeAsync(201);
  store.setLayerOpacity("F.Cu", 0.7);
  resolve({ ok: true, revision: 1, createdEntityId: null });
  await Promise.resolve();
  store.hydrateFromProjection({
    designId: "a",
    viewState: undefined,
    activeLayer: "F.Cu",
    visibleLayers: ["F.Cu"],
  });
  expect(usePcbViewStore.getState().viewState.perLayerOpacity["F.Cu"]).toBe(
    0.7,
  );
  await vi.advanceTimersByTimeAsync(201);
  expect(dispatch).toHaveBeenCalledTimes(2);
});
