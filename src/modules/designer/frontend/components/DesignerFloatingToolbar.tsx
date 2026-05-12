import {
  ArrowRightFromLine,
  ChevronsDown,
  Grid3X3,
  Minus,
  Plus,
  ScanSearch,
  Search,
  Undo2,
  Redo2,
  Zap,
} from "lucide-react";
import type { ReactElement } from "react";

interface DesignerFloatingToolbarProps {
  gridVisible: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onToggleGrid: () => void;
  onPlaceComponent?: () => void;
  onPlaceGnd?: () => void;
  onPlacePwr?: () => void;
  onPlaceNetPortal?: () => void;
}

export function DesignerFloatingToolbar({
  gridVisible,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFit,
  onToggleGrid,
  onPlaceComponent,
  onPlaceGnd,
  onPlacePwr,
  onPlaceNetPortal,
}: DesignerFloatingToolbarProps): ReactElement {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white/95 px-2 py-1 shadow-sm backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/90">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Undo"
        aria-label="Undo"
      >
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Redo"
        aria-label="Redo"
      >
        <Redo2 className="h-3.5 w-3.5" />
      </button>

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <button
        type="button"
        onClick={onZoomOut}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Zoom out"
        aria-label="Zoom out"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Zoom in"
        aria-label="Zoom in"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onFit}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        title="Fit"
        aria-label="Fit schematic"
      >
        <ScanSearch className="h-3.5 w-3.5" />
      </button>

      {onPlaceComponent || onPlaceGnd || onPlacePwr || onPlaceNetPortal ? (
        <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
      ) : null}

      {onPlaceComponent ? (
        <button
          type="button"
          onClick={onPlaceComponent}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          title="Place component (⌘/Ctrl K)"
          aria-label="Place component"
        >
          <Search className="h-3.5 w-3.5" />
          Components
        </button>
      ) : null}

      {onPlaceGnd ? (
        <button
          type="button"
          onClick={onPlaceGnd}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          title="Place GND port (G)"
          aria-label="Place GND port"
        >
          <ChevronsDown className="h-3.5 w-3.5" />
          GND
        </button>
      ) : null}
      {onPlacePwr ? (
        <button
          type="button"
          onClick={onPlacePwr}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          title="Place power port (P)"
          aria-label="Place power port"
        >
          <Zap className="h-3.5 w-3.5" />
          PWR
        </button>
      ) : null}
      {onPlaceNetPortal ? (
        <button
          type="button"
          onClick={onPlaceNetPortal}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          title="Place net portal (H)"
          aria-label="Place net portal"
        >
          <ArrowRightFromLine className="h-3.5 w-3.5" />
          Portal
        </button>
      ) : null}
    </div>
  );
}
