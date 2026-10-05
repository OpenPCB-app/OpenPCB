import { Button } from "@shared/frontend/ui/button";
import { Select } from "@shared/frontend/ui/select";
import { PCB_GRID_PRESETS_MM } from "../../../../shared/domain/editor-grid";
import { useGridPreferences, type GridEditor } from "../stores/grid-prefs";

export function GridControls({ editor }: { editor: GridEditor }) {
  const grid = useGridPreferences((state) => state[editor]);
  const { toggleVisible, toggleSnap, setPcbPitch } =
    useGridPreferences.getState();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        aria-label="Show grid"
        aria-pressed={grid.visible}
        onClick={() => toggleVisible(editor)}
      >
        Grid {grid.visible ? "on" : "off"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Snap to grid"
        aria-pressed={grid.snap}
        title="Snap to grid (Shift+S)"
        onClick={() => toggleSnap(editor)}
      >
        Snap {grid.snap ? "on" : "off"}
      </Button>
      {editor === "pcb" ? (
        <Select
          size="sm"
          aria-label="PCB grid spacing"
          title="Grid spacing (N / Shift+N)"
          value={String(grid.mm)}
          onChange={(value) => setPcbPitch(Number(value))}
          options={PCB_GRID_PRESETS_MM.map((mm) => ({
            id: String(mm),
            label: `${mm} mm`,
          }))}
        />
      ) : (
        <span>{grid.mm} mm</span>
      )}
    </div>
  );
}
