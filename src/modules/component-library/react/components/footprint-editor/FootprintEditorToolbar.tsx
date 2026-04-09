/**
 * FootprintEditorToolbar Component
 *
 * Toolbar for zoom, grid, and undo/redo controls.
 */

import { useCallback, useRef } from "react";
import { ZoomIn, ZoomOut, Maximize2, Grid, Undo, Redo } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { useFootprintEditorStore, useCanUndo, useCanRedo } from "./footprint-editor-store";
import { GRID_SIZES, type GridSizeKey } from "./types";
import { importFootprintFile } from "./import-utils";
import type { FootprintDraft } from "./types";

interface FootprintEditorToolbarProps {
  onImportedDraft?: (draft: FootprintDraft) => void;
}

const GRID_OPTIONS: { key: GridSizeKey; label: string }[] = [
  { key: "fine", label: "0.05mm" },
  { key: "normal", label: "0.1mm" },
  { key: "coarse", label: "0.25mm" },
  { key: "very_coarse", label: "0.5mm" },
];

export function FootprintEditorToolbar({ onImportedDraft }: FootprintEditorToolbarProps) {
  const viewport = useFootprintEditorStore((s) => s.chrome.viewport);
  const gridSize = useFootprintEditorStore((s) => s.chrome.gridSize);
  const showGrid = useFootprintEditorStore((s) => s.chrome.showGrid);
  const setViewport = useFootprintEditorStore((s) => s.setViewport);
  const setDraft = useFootprintEditorStore((s) => s.setDraft);
  const setGridSize = useFootprintEditorStore((s) => s.setGridSize);
  const toggleGrid = useFootprintEditorStore((s) => s.toggleGrid);
  const resetViewport = useFootprintEditorStore((s) => s.resetViewport);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const undo = useFootprintEditorStore((s) => s.undo);
  const redo = useFootprintEditorStore((s) => s.redo);
  const importInputRef = useRef<HTMLInputElement>(null);

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

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      try {
        const draft = await importFootprintFile(file);
        onImportedDraft?.(draft);
        if (!onImportedDraft) {
          setDraft(draft);
        }
        const modelRefs = draft.importPreservation?.model3dReferences.length ?? 0;
        const warnings = draft.importPreservation?.warnings ?? [];
        toast({
          title: "Footprint imported",
          description:
            warnings.length > 0
              ? warnings.map((warning) => warning.message).join(" • ")
              : modelRefs > 0
                ? `Imported ${file.name} with ${modelRefs} referenced 3D model${modelRefs === 1 ? "" : "s"}`
                : `Imported ${file.name}`,
        });
      } catch (error) {
        toast({
          title: "Import failed",
          description:
            error instanceof Error ? error.message : "Unable to parse KiCAD footprint",
          variant: "destructive",
        });
      }
    },
    [onImportedDraft, setDraft],
  );

  return (
    <div className="flex items-center gap-2 border-b border-border-default bg-bg-secondary px-4 py-2">
      <input
        ref={importInputRef}
        type="file"
        accept=".kicad_mod"
        onChange={handleImportChange}
        className="hidden"
      />

      <button
        onClick={handleImportClick}
        className="p-1.5 rounded hover:bg-bg-elevated text-text-secondary hover:text-text-primary transition-colors"
        title="Import KiCAD Footprint (.kicad_mod)"
      >
        <UploadIcon className="h-4 w-4" />
      </button>

      {/* Divider */}
      <div className="w-px h-5 bg-border-default" />

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

function UploadIcon(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 20h16" />
    </svg>
  );
}
