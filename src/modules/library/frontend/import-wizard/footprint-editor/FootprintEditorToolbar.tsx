import { memo, type ReactElement } from "react";
import {
  Circle,
  Magnet,
  Minus,
  MousePointer2,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  Spline,
  Square,
  SquareDot,
  Type,
  Undo2,
} from "lucide-react";
// Magnet → alignment-guides toggle; Ruler → dimensions toggle.
import type { LucideIcon } from "lucide-react";
import {
  PCB_LAYER_COLORS,
  LAYER_TOOL_HINTS,
} from "../../../../../shared/frontend/canvas/layers";
import { rotateSelection } from "./actions";
import { useFootprintEditorStore } from "./useFootprintEditorStore";
import type { FootprintEditorToolId } from "./types";
import { PCB_EDITOR_LAYERS } from "./types";

interface ToolDef {
  id: FootprintEditorToolId;
  icon: LucideIcon;
  label: string;
  shortcut: string;
}

const TOOLS: ToolDef[] = [
  { id: "select", icon: MousePointer2, label: "Select", shortcut: "V" },
  { id: "line", icon: Minus, label: "Line", shortcut: "L" },
  { id: "rect", icon: Square, label: "Rect", shortcut: "R" },
  { id: "circle", icon: Circle, label: "Circle", shortcut: "C" },
  { id: "arc", icon: Spline, label: "Arc", shortcut: "A" },
  { id: "pad", icon: SquareDot, label: "Pad", shortcut: "D" },
  { id: "text", icon: Type, label: "Text", shortcut: "T" },
];

function ToolButton({
  tool,
  active,
  hinted,
  onClick,
}: {
  tool: ToolDef;
  active: boolean;
  /** True when this tool is "recommended" for the current active layer. */
  hinted: boolean;
  onClick: () => void;
}): ReactElement {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${tool.label} (${tool.shortcut})`}
      className={`relative inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
        active
          ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
          : "border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      } ${hinted && !active ? "ring-1 ring-emerald-400/50 dark:ring-emerald-500/40" : ""}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {hinted && !active && (
        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 dark:bg-emerald-500" />
      )}
    </button>
  );
}

export const FootprintEditorToolbar = memo(
  function FootprintEditorToolbar(): ReactElement {
    const activeTool = useFootprintEditorStore((s) => s.activeTool);
    const undoStack = useFootprintEditorStore((s) => s.undoStack);
    const redoStack = useFootprintEditorStore((s) => s.redoStack);
    const gridVisible = useFootprintEditorStore((s) => s.gridVisible);
    const guidesVisible = useFootprintEditorStore((s) => s.alignmentGuidesVisible);
    const dimensionsVisible = useFootprintEditorStore((s) => s.dimensionsVisible);
    const selectionSize = useFootprintEditorStore((s) => s.selectedIds.size);
    const activeLayer = useFootprintEditorStore((s) => s.activeLayer);
    const rotateDisabled = selectionSize === 0;

    const layerColor =
      PCB_LAYER_COLORS[activeLayer as keyof typeof PCB_LAYER_COLORS] ??
      "#94a3b8";

    const hintedTools = LAYER_TOOL_HINTS[activeLayer] ?? new Set<string>();

    return (
      <div className="mx-auto inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/90">
        {TOOLS.map((tool) => (
          <ToolButton
            key={tool.id}
            tool={tool}
            active={activeTool === tool.id}
            hinted={hintedTools.has(tool.id)}
            onClick={() =>
              useFootprintEditorStore.getState().setActiveTool(tool.id)
            }
          />
        ))}

        <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

        {/* Active layer indicator + picker */}
        <div className="relative">
          <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <span
              className="inline-block h-3 w-3 rounded-sm border border-slate-300 dark:border-slate-600"
              style={{ backgroundColor: layerColor }}
            />
            <select
              value={activeLayer}
              onChange={(e) =>
                useFootprintEditorStore
                  .getState()
                  .setActiveLayer(e.currentTarget.value)
              }
              className="cursor-pointer appearance-none border-none bg-transparent p-0 text-xs outline-none"
            >
              {PCB_EDITOR_LAYERS.map((layer) => (
                <option key={layer} value={layer}>
                  {layer}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

        <button
          type="button"
          onClick={() => rotateSelection(90)}
          disabled={rotateDisabled}
          title="Rotate 90° CCW (R)"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => rotateSelection(-90)}
          disabled={rotateDisabled}
          title="Rotate 90° CW (Shift+R)"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>

        <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

        <button
          type="button"
          onClick={() => useFootprintEditorStore.getState().undo()}
          disabled={undoStack.length === 0}
          title="Undo (Cmd+Z)"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => useFootprintEditorStore.getState().redo()}
          disabled={redoStack.length === 0}
          title="Redo (Cmd+Shift+Z)"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>

        <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

        <button
          type="button"
          onClick={() =>
            useFootprintEditorStore.getState().toggleAlignmentGuidesVisible()
          }
          title="Alignment guides + magnetic snap (Shift+G)"
          className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-colors ${
            guidesVisible
              ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
              : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Magnet className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() =>
            useFootprintEditorStore.getState().toggleDimensionsVisible()
          }
          title="Show dimensions + distances"
          className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-colors ${
            dimensionsVisible
              ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
              : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Ruler className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={() =>
            useFootprintEditorStore
              .getState()
              .setGridVisible(!useFootprintEditorStore.getState().gridVisible)
          }
          className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
            gridVisible
              ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
              : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          Grid
        </button>
      </div>
    );
  },
);
