import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  PCB_GRID_MM,
  PCB_GRID_PRESETS_MM,
  SCHEMATIC_GRID_MM,
} from "../../../../shared/domain/editor-grid";

export type GridEditor = "schematic" | "pcb";
export interface GridPreferences {
  visible: boolean;
  snap: boolean;
  mm: number;
}
interface GridStore {
  schematic: GridPreferences;
  pcb: GridPreferences;
  toggleVisible(editor: GridEditor): void;
  toggleSnap(editor: GridEditor): void;
  setPcbPitch(mm: number): void;
  cyclePcbPitch(direction: 1 | -1): void;
}
function preferences(value: unknown, editor: GridEditor): GridPreferences {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const mm =
    editor === "schematic"
      ? SCHEMATIC_GRID_MM
      : (PCB_GRID_PRESETS_MM.find((pitch) => pitch === record.mm) ??
        PCB_GRID_MM);
  return {
    visible: typeof record.visible === "boolean" ? record.visible : true,
    snap: typeof record.snap === "boolean" ? record.snap : true,
    mm,
  };
}

export const useGridPreferences = create<GridStore>()(
  persist(
    (set, get) => ({
      schematic: preferences(null, "schematic"),
      pcb: preferences(null, "pcb"),
      toggleVisible: (editor) =>
        set({
          [editor]: { ...get()[editor], visible: !get()[editor].visible },
        }),
      toggleSnap: (editor) =>
        set({ [editor]: { ...get()[editor], snap: !get()[editor].snap } }),
      setPcbPitch: (mm) => {
        if (PCB_GRID_PRESETS_MM.some((pitch) => pitch === mm))
          set({ pcb: { ...get().pcb, mm } });
      },
      cyclePcbPitch: (direction) => {
        const current = PCB_GRID_PRESETS_MM.findIndex(
          (pitch) => pitch === get().pcb.mm,
        );
        const index =
          (current + direction + PCB_GRID_PRESETS_MM.length) %
          PCB_GRID_PRESETS_MM.length;
        get().setPcbPitch(PCB_GRID_PRESETS_MM[index]!);
      },
    }),
    {
      name: "openpcb.designer.grid.v1",
      partialize: ({ schematic, pcb }) => ({ schematic, pcb }),
      merge: (persisted, current) => {
        const record =
          persisted && typeof persisted === "object"
            ? (persisted as Record<string, unknown>)
            : {};
        return {
          ...current,
          schematic: preferences(record.schematic, "schematic"),
          pcb: preferences(record.pcb, "pcb"),
        };
      },
    },
  ),
);
