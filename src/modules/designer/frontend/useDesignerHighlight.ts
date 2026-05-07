// Designer-wide cross-probe highlight state.
// Schematic and PCB views both read/write `highlightedNetId` so that hovering
// a net in one view dims non-matching elements in the other.

import { create } from "zustand";

interface DesignerHighlightState {
  highlightedNetId: string | null;
  pinned: boolean;
  /** Hover-set the highlight (no-op if a pinned highlight is active). */
  hoverNet: (netId: string | null) => void;
  /** Pin the current (or supplied) net so subsequent hovers don't change it. */
  pinNet: (netId: string | null) => void;
  /** Clear both hover and pinned state. */
  clear: () => void;
}

export const useDesignerHighlight = create<DesignerHighlightState>(
  (set, get) => ({
    highlightedNetId: null,
    pinned: false,
    hoverNet: (netId) => {
      if (get().pinned) return;
      set({ highlightedNetId: netId });
    },
    pinNet: (netId) => {
      set({ highlightedNetId: netId, pinned: netId !== null });
    },
    clear: () => set({ highlightedNetId: null, pinned: false }),
  }),
);
