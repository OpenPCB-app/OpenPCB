import { memo, type ReactElement } from "react";
import {
  Circle,
  Grid3X3,
  Minus,
  MousePointer2,
  Redo2,
  RotateCcw,
  RotateCw,
  Spline,
  Square,
  Type,
  Undo2,
  Pin,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { rotateSelection } from "./actions";
import { useSymbolEditorStore } from "./useSymbolEditorStore";
import type { EditorToolId } from "./types";

interface ToolDef {
  id: EditorToolId;
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
  { id: "pin", icon: Pin, label: "Pin", shortcut: "P" },
  { id: "text", icon: Type, label: "Text", shortcut: "T" },
];

function ToolButton({
  tool,
  active,
  onClick,
}: {
  tool: ToolDef;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  const Icon = tool.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${tool.label} (${tool.shortcut})`}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
        active
          ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
          : "border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

export const EditorToolbar = memo(function EditorToolbar(): ReactElement {
  const activeTool = useSymbolEditorStore((s) => s.activeTool);
  const undoStack = useSymbolEditorStore((s) => s.undoStack);
  const redoStack = useSymbolEditorStore((s) => s.redoStack);
  const gridVisible = useSymbolEditorStore((s) => s.gridVisible);
  const selectionSize = useSymbolEditorStore((s) => s.selectedIds.size);
  const rotateDisabled = selectionSize === 0;

  return (
    <div className="mx-auto inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/90">
      {TOOLS.map((tool) => (
        <ToolButton
          key={tool.id}
          tool={tool}
          active={activeTool === tool.id}
          onClick={() => useSymbolEditorStore.getState().setActiveTool(tool.id)}
        />
      ))}

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <button
        type="button"
        onClick={() => rotateSelection(90)}
        disabled={rotateDisabled}
        title="Rotate selection 90° CCW (R)"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => rotateSelection(-90)}
        disabled={rotateDisabled}
        title="Rotate selection 90° CW (Shift+R)"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <RotateCw className="h-3.5 w-3.5" />
      </button>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <button
        type="button"
        onClick={() => useSymbolEditorStore.getState().undo()}
        disabled={undoStack.length === 0}
        title="Undo (Cmd+Z)"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => useSymbolEditorStore.getState().redo()}
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
          useSymbolEditorStore
            .getState()
            .setGridVisible(!useSymbolEditorStore.getState().gridVisible)
        }
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
          gridVisible
            ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
            : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        }`}
      >
        <Grid3X3 className="h-3.5 w-3.5" />
        Grid
      </button>
    </div>
  );
});
