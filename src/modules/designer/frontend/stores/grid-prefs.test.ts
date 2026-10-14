// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { useGridPreferences } from "./grid-prefs";
import { handleGridShortcut } from "../hooks/use-grid-hotkeys";

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  useGridPreferences.setState({
    schematic: { mm: 1.27, visible: true, snap: true },
    pcb: { mm: 0.25, visible: true, snap: true },
  });
});
it("visibility never changes snapping or the other editor", () => {
  useGridPreferences.getState().toggleVisible("schematic");
  expect(useGridPreferences.getState().schematic).toEqual({
    mm: 1.27,
    visible: false,
    snap: true,
  });
  expect(useGridPreferences.getState().pcb).toEqual({
    mm: 0.25,
    visible: true,
    snap: true,
  });
});
it("validates persisted preferences and preserves an explicitly disabled snap", async () => {
  localStorage.setItem(
    "openpcb.designer.grid.v1",
    JSON.stringify({
      state: {
        schematic: { mm: 2, snap: false },
        pcb: { mm: -1, visible: "false" },
      },
      version: 0,
    }),
  );
  await useGridPreferences.persist.rehydrate();
  expect(useGridPreferences.getState().schematic).toEqual({
    mm: 1.27,
    visible: true,
    snap: false,
  });
  expect(useGridPreferences.getState().pcb).toEqual({
    mm: 0.25,
    visible: true,
    snap: true,
  });
});
it("grid shortcuts require canvas focus, ignore text, repeats and modals", () => {
  const root = document.createElement("section");
  root.tabIndex = 0;
  const input = document.createElement("input");
  root.append(input);
  document.body.append(root);
  root.addEventListener("keydown", (event) =>
    handleGridShortcut(event, root, "pcb"),
  );
  const send = (
    target: HTMLElement,
    key: string,
    shiftKey = false,
    repeat = false,
  ) =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        shiftKey,
        repeat,
        bubbles: true,
        cancelable: true,
      }),
    );
  input.focus();
  send(input, "S", true);
  expect(useGridPreferences.getState().pcb.snap).toBe(true);
  root.focus();
  send(root, "S", true, true);
  expect(useGridPreferences.getState().pcb.snap).toBe(true);
  send(root, "S", true);
  expect(useGridPreferences.getState().pcb.snap).toBe(false);
  send(root, "n");
  expect(useGridPreferences.getState().pcb.mm).toBe(0.5);
  send(root, "N", true);
  expect(useGridPreferences.getState().pcb.mm).toBe(0.25);
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);
  send(root, "S", true);
  send(root, "n");
  expect(useGridPreferences.getState().pcb.snap).toBe(false);
  expect(useGridPreferences.getState().pcb.mm).toBe(0.25);
});
