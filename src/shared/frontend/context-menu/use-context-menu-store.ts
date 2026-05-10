import { create } from "zustand";
import type {
  ContextMenuOpenInput,
  ContextMenuPoint,
  ContextMenuState,
} from "./types";

function countEnabledItems(state: ContextMenuState): number {
  if (!state.open) return 0;
  let count = 0;
  for (const group of state.groups) {
    for (const item of group.items) {
      if (item.kind === "action" && !item.disabled) {
        count++;
      }
    }
  }
  return count;
}

function clampIndex(state: ContextMenuState, rawIndex: number): number {
  const enabledCount = countEnabledItems(state);
  if (enabledCount === 0) return -1;
  let idx = rawIndex % enabledCount;
  if (idx < 0) idx += enabledCount;
  return idx;
}

interface ContextMenuStore extends ContextMenuState {
  showMenu: (input: ContextMenuOpenInput) => void;
  closeMenu: () => void;
  moveFocus: (delta: number) => void;
  focusFirst: () => void;
  focusLast: () => void;
  selectFocused: () => void;
}

export const useContextMenuStore = create<ContextMenuStore>((set, get) => ({
  open: false,
  scope: null,
  position: { x: 0, y: 0 },
  groups: [],
  title: null,
  focusedIndex: 0,

  showMenu: (input) =>
    set({
      open: true,
      scope: input.scope,
      position: input.position,
      groups: input.groups,
      title: input.title ?? null,
      focusedIndex: 0,
    }),

  closeMenu: () =>
    set({
      open: false,
      scope: null,
      groups: [],
      title: null,
      focusedIndex: 0,
    }),

  moveFocus: (delta) =>
    set((state) => {
      if (!state.open) return state;
      const enabledCount = countEnabledItems(state);
      if (enabledCount === 0) return { focusedIndex: -1 };
      return { focusedIndex: clampIndex(state, state.focusedIndex + delta) };
    }),

  focusFirst: () =>
    set((state) => {
      if (!state.open) return state;
      const enabledCount = countEnabledItems(state);
      if (enabledCount === 0) return { focusedIndex: -1 };
      return { focusedIndex: 0 };
    }),

  focusLast: () =>
    set((state) => {
      if (!state.open) return state;
      const enabledCount = countEnabledItems(state);
      if (enabledCount === 0) return { focusedIndex: -1 };
      return { focusedIndex: enabledCount - 1 };
    }),

  selectFocused: () => {
    const state = get();
    if (!state.open) return;
    let currentIdx = 0;
    for (const group of state.groups) {
      for (const item of group.items) {
        if (item.kind === "action" && !item.disabled) {
          if (currentIdx === state.focusedIndex) {
            item.onSelect();
            get().closeMenu();
            return;
          }
          currentIdx++;
        }
      }
    }
  },
}));

export function openContextMenu(input: ContextMenuOpenInput): void {
  useContextMenuStore.getState().showMenu(input);
}

export function closeContextMenu(): void {
  useContextMenuStore.getState().closeMenu();
}
