import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface DesignerTabsState {
  openDesignIds: string[];
  activeDesignId: string | null;
}

export interface DesignerTabsActions {
  openTab(designId: string): void;
  closeTab(designId: string): { nextActiveId: string | null };
  closeOthers(designId: string): void;
  closeAll(): void;
  reorder(fromIndex: number, toIndex: number): void;
  setActive(designId: string | null): void;
  pruneMissing(knownIds: Set<string>): void;
}

export type DesignerTabsStore = DesignerTabsState & DesignerTabsActions;

function neighbor(ids: readonly string[], removedIndex: number): string | null {
  if (ids.length === 0) return null;
  if (removedIndex < ids.length) return ids[removedIndex] ?? null;
  return ids[ids.length - 1] ?? null;
}

export const useDesignerTabsStore = create<DesignerTabsStore>()(
  persist(
    (set, get) => ({
      openDesignIds: [],
      activeDesignId: null,

      openTab(designId) {
        if (!designId) return;
        const { openDesignIds, activeDesignId } = get();
        if (openDesignIds.includes(designId)) {
          if (activeDesignId !== designId) {
            set({ activeDesignId: designId });
          }
          return;
        }
        set({
          openDesignIds: [...openDesignIds, designId],
          activeDesignId: designId,
        });
      },

      closeTab(designId) {
        const { openDesignIds, activeDesignId } = get();
        const index = openDesignIds.indexOf(designId);
        if (index === -1) {
          return { nextActiveId: activeDesignId };
        }
        const next = openDesignIds.filter((_, i) => i !== index);
        let nextActive = activeDesignId;
        if (activeDesignId === designId) {
          nextActive = neighbor(next, index);
        }
        set({ openDesignIds: next, activeDesignId: nextActive });
        return { nextActiveId: nextActive };
      },

      closeOthers(designId) {
        const { openDesignIds } = get();
        if (!openDesignIds.includes(designId)) return;
        set({ openDesignIds: [designId], activeDesignId: designId });
      },

      closeAll() {
        set({ openDesignIds: [], activeDesignId: null });
      },

      reorder(fromIndex, toIndex) {
        const { openDesignIds } = get();
        if (
          fromIndex === toIndex ||
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= openDesignIds.length ||
          toIndex >= openDesignIds.length
        ) {
          return;
        }
        const next = openDesignIds.slice();
        const [moved] = next.splice(fromIndex, 1);
        if (!moved) return;
        next.splice(toIndex, 0, moved);
        set({ openDesignIds: next });
      },

      setActive(designId) {
        const { openDesignIds, activeDesignId } = get();
        if (designId === null) {
          if (activeDesignId !== null) set({ activeDesignId: null });
          return;
        }
        if (!openDesignIds.includes(designId)) {
          set({
            openDesignIds: [...openDesignIds, designId],
            activeDesignId: designId,
          });
          return;
        }
        if (activeDesignId !== designId) {
          set({ activeDesignId: designId });
        }
      },

      pruneMissing(knownIds) {
        const { openDesignIds, activeDesignId } = get();
        const filtered = openDesignIds.filter((id) => knownIds.has(id));
        if (
          filtered.length === openDesignIds.length &&
          (activeDesignId === null || knownIds.has(activeDesignId))
        ) {
          return;
        }
        const nextActive =
          activeDesignId && knownIds.has(activeDesignId)
            ? activeDesignId
            : (filtered[0] ?? null);
        set({ openDesignIds: filtered, activeDesignId: nextActive });
      },
    }),
    {
      name: "openpcb.designer.tabs.v1",
      partialize: (state) => ({
        openDesignIds: state.openDesignIds,
        activeDesignId: state.activeDesignId,
      }),
    },
  ),
);
