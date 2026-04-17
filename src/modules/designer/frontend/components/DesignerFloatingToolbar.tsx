import {
  Crosshair,
  Grid3X3,
  Minus,
  MousePointer2,
  Plus,
  ScanSearch,
  Type,
  Undo2,
  Redo2,
  Move,
} from "lucide-react";
import type { ReactElement } from "react";
import type { ToolMode } from "../types";

interface DesignerFloatingToolbarProps {
  tool: ToolMode;
  gridVisible: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onToolChange: (tool: ToolMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onToggleGrid: () => void;
}

function ToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: ReactElement;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
        active
          ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
          : "border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

export function DesignerFloatingToolbar({
  tool,
  gridVisible,
  canUndo = false,
  canRedo = false,
  onToolChange,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFit,
  onToggleGrid,
}: DesignerFloatingToolbarProps): ReactElement {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/90">
      <ToolButton
        active={tool === "select"}
        title="Select"
        onClick={() => onToolChange("select")}
      >
        <MousePointer2 className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={tool === "place"}
        title="Move/Place"
        onClick={() => onToolChange("place")}
      >
        <Move className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={tool === "wire"}
        title="Wire"
        onClick={() => onToolChange("wire")}
      >
        <Minus className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={tool === "label"}
        title="Label"
        onClick={() => onToolChange("label")}
      >
        <Type className="h-3.5 w-3.5" />
      </ToolButton>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Undo"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Redo"
      >
        <Redo2 className="h-3.5 w-3.5" />
      </button>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <button
        type="button"
        onClick={onZoomOut}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Zoom out"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Zoom in"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onFit}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Fit"
      >
        <ScanSearch className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={onToggleGrid}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
          gridVisible
            ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
            : "border-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        }`}
        title="Toggle grid"
      >
        <Grid3X3 className="h-3.5 w-3.5" />
        Grid
      </button>
      <button
        type="button"
        onClick={() => onToolChange("select")}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Select mode"
      >
        <Crosshair className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
