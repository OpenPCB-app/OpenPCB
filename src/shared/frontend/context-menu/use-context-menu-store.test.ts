import { describe, expect, it, beforeEach } from "vitest";
import {
  useContextMenuStore,
  openContextMenu,
  closeContextMenu,
} from "./use-context-menu-store";

describe("useContextMenuStore", () => {
  beforeEach(() => {
    useContextMenuStore.setState({
      open: false,
      scope: null,
      position: { x: 0, y: 0 },
      groups: [],
      title: null,
      focusedIndex: 0,
    });
  });

  it("opens menu with showMenu", () => {
    useContextMenuStore.getState().showMenu({
      scope: "app",
      position: { x: 100, y: 200 },
      groups: [
        {
          id: "g1",
          items: [
            { kind: "action", id: "a1", label: "Action 1", onSelect: () => {} },
          ],
        },
      ],
    });

    const state = useContextMenuStore.getState();
    expect(state.open).toBe(true);
    expect(state.scope).toBe("app");
    expect(state.position).toEqual({ x: 100, y: 200 });
    expect(state.groups).toHaveLength(1);
    expect(state.focusedIndex).toBe(0);
  });

  it("closes menu with closeMenu", () => {
    useContextMenuStore.getState().showMenu({
      scope: "app",
      position: { x: 0, y: 0 },
      groups: [
        {
          id: "g1",
          items: [
            { kind: "action", id: "a1", label: "Action 1", onSelect: () => {} },
          ],
        },
      ],
    });

    useContextMenuStore.getState().closeMenu();
    const state = useContextMenuStore.getState();
    expect(state.open).toBe(false);
    expect(state.groups).toHaveLength(0);
  });

  it("moveFocus cycles through enabled items", () => {
    useContextMenuStore.getState().showMenu({
      scope: "app",
      position: { x: 0, y: 0 },
      groups: [
        {
          id: "g1",
          items: [
            { kind: "action", id: "a1", label: "A1", onSelect: () => {} },
            { kind: "action", id: "a2", label: "A2", onSelect: () => {} },
            { kind: "action", id: "a3", label: "A3", onSelect: () => {} },
          ],
        },
      ],
    });

    const store = useContextMenuStore.getState();
    expect(store.focusedIndex).toBe(0);

    store.moveFocus(1);
    expect(useContextMenuStore.getState().focusedIndex).toBe(1);

    store.moveFocus(1);
    expect(useContextMenuStore.getState().focusedIndex).toBe(2);

    store.moveFocus(1);
    expect(useContextMenuStore.getState().focusedIndex).toBe(0);
  });

  it("moveFocus skips disabled items", () => {
    useContextMenuStore.getState().showMenu({
      scope: "app",
      position: { x: 0, y: 0 },
      groups: [
        {
          id: "g1",
          items: [
            {
              kind: "action",
              id: "a1",
              label: "A1",
              disabled: true,
              onSelect: () => {},
            },
            { kind: "action", id: "a2", label: "A2", onSelect: () => {} },
          ],
        },
      ],
    });

    const store = useContextMenuStore.getState();
    expect(store.focusedIndex).toBe(0);

    store.moveFocus(1);
    expect(useContextMenuStore.getState().focusedIndex).toBe(0);
  });

  it("selectFocused invokes onSelect and closes menu", () => {
    let called = false;
    useContextMenuStore.getState().showMenu({
      scope: "app",
      position: { x: 0, y: 0 },
      groups: [
        {
          id: "g1",
          items: [
            {
              kind: "action",
              id: "a1",
              label: "A1",
              onSelect: () => {
                called = true;
              },
            },
          ],
        },
      ],
    });

    useContextMenuStore.getState().selectFocused();
    expect(called).toBe(true);
    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it("focusFirst and focusLast work correctly", () => {
    useContextMenuStore.getState().showMenu({
      scope: "app",
      position: { x: 0, y: 0 },
      groups: [
        {
          id: "g1",
          items: [
            { kind: "action", id: "a1", label: "A1", onSelect: () => {} },
            { kind: "action", id: "a2", label: "A2", onSelect: () => {} },
            { kind: "action", id: "a3", label: "A3", onSelect: () => {} },
          ],
        },
      ],
    });

    const store = useContextMenuStore.getState();
    store.moveFocus(2);
    expect(useContextMenuStore.getState().focusedIndex).toBe(2);

    store.focusFirst();
    expect(useContextMenuStore.getState().focusedIndex).toBe(0);

    store.focusLast();
    expect(useContextMenuStore.getState().focusedIndex).toBe(2);
  });

  it("openContextMenu helper works", () => {
    openContextMenu({
      scope: "schematic",
      position: { x: 50, y: 60 },
      groups: [],
    });

    const state = useContextMenuStore.getState();
    expect(state.open).toBe(true);
    expect(state.scope).toBe("schematic");
    expect(state.position).toEqual({ x: 50, y: 60 });
  });

  it("closeContextMenu helper works", () => {
    openContextMenu({
      scope: "app",
      position: { x: 0, y: 0 },
      groups: [],
    });

    closeContextMenu();
    expect(useContextMenuStore.getState().open).toBe(false);
  });
});
