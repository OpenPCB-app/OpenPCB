/**
 * FootprintEditorToolbar Component
 *
 * Toolbar for zoom, grid, and undo/redo controls.
 */

import { useCallback } from "react";
import { ZoomIn, ZoomOut, Maximize2, Grid, Undo, Redo } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFootprintEditorStore, useCanUndo, useCanRedo } from "./footprint-editor-store";
import { GRID_SIZES, type GridSizeKey } from "./types";

const GRID_OPTIONS: { key: GridSizeKey; label: string }[] = [
  { key: "fine", label: "0.05mm" },
  { key: "normal", label: "0.1mm" },
  { key: "coarse", label: "0.25mm" },
  { key: "very_coarse", label: "0.5mm" },
];

export function FootprintEditorToolbar() {
  const viewport = useFootprintEditorStore((s) => s.chrome.viewport);
  const gridSize = useFootprintEditorStore((s) => s.chrome.gridSize);
  const showGrid = useFootprintEditorStore((s) => s.chrome.showGrid);
  const setViewport = useFootprintEditorStore((s) => s.setViewport);
  const setGridSize = useFootprintEditorStore((s) => s.setGridSize);
  const toggleGrid = useFootprintEditorStore((s) => s.toggleGrid);
  const resetViewport = useFootprintEditorStore((s) => s.resetViewport);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const undo = useFootprintEditorStore((s) => s.undo);
  const redo = useFootprintEditorStore((s) => s.redo);

  const handleZoomIn = useCallback(() => {
    setViewport({
      ...viewport,
      zoom: Math.min(50, viewport.zoom * 1.2),
    });
  }, [viewport, setViewport]);

  const handleZoomOut = useCallback(() => {
    setViewport({
      ...viewport,
      zoom: Math.max(0.1, viewport.zoom / 1.2),
    });
  }, [viewport, setViewport]);

  const handleFit = useCallback(() => {
    resetViewport();
  }, [resetViewport]);

  const handleGridSizeChange = useCallback(
    (key: GridSizeKey) => {
      setGridSize(GRID_SIZES[key]);
    },
    [setGridSize],
  );

  const currentGridKey = GRID_OPTIONS.find(
    (opt) => GRID_SIZES[opt.key] === gridSize,
  )?.key ?? "normal";

  return (
    <div className="flex items-center gap-2 border-b border-border-default bg-bg-secondary px-4 py-2">
      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={handleZoomOut}
          className="p-1.5 rounded hover:bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors"
          title="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="text-xs text-text-muted min-w-[3rem] text-center">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          className="p-1.5 rounded hover:bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors"
          title="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={handleFit}
          className="p-1.5 rounded hover:bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors"
          title="Fit to view"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-border-default" />

      {/* Grid controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleGrid}
          className={cn(
            "p-1.5 rounded transition-colors",
            showGrid
              ? "bg-brand-bg text-brand"
              : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary",
          )}
          title={showGrid ? "Hide grid" : "Show grid"}
        >
          <Grid className="h-4 w-4" />
        </button>
        <select
          value={currentGridKey}
          onChange={(e) => handleGridSizeChange(e.target.value as GridSizeKey)}
          className="h-7 rounded bg-bg-input px-2 text-xs text-text-primary border border-border-default focus:border-border-strong focus:outline-none"
        >
          {GRID_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-border-default" />

      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          onClick={undo}
          disabled={!canUndo}
          className={cn(
            "p-1.5 rounded transition-colors",
            canUndo
              ? "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
              : "text-text-muted cursor-not-allowed",
          )}
          title="Undo (Ctrl+Z)"
        >
          <Undo className="h-4 w-4" />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className={cn(
            "p-1.5 rounded transition-colors",
            canRedo
              ? "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
              : "text-text-muted cursor-not-allowed",
          )}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}