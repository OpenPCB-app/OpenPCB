/**
 * Symbol Editor Toolbar
 *
 * Toolbar with undo/redo, grid controls, and view actions.
 */

import { useCallback, useRef } from "react";
import { toast } from "@/components/ui/use-toast";
import { useSymbolEditorStore, useCanUndo, useCanRedo } from "./symbol-editor-store";
import { GRID_SIZES, type GridSizeKey } from "./types";
import { importKicadSymbolFile } from "./kicad-import";
import type { SymbolDraft } from "./types";

interface SymbolEditorToolbarProps {
  onImportedDraft?: (draft: SymbolDraft) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SymbolEditorToolbar({ onImportedDraft }: SymbolEditorToolbarProps) {
  const undo = useSymbolEditorStore((s) => s.undo);
  const redo = useSymbolEditorStore((s) => s.redo);
  const setDraft = useSymbolEditorStore((s) => s.setDraft);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const importInputRef = useRef<HTMLInputElement>(null);

  const gridSize = useSymbolEditorStore((s) => s.chrome.gridSize);
  const showGrid = useSymbolEditorStore((s) => s.chrome.showGrid);
  const setGridSize = useSymbolEditorStore((s) => s.setGridSize);
  const toggleGrid = useSymbolEditorStore((s) => s.toggleGrid);
  const resetViewport = useSymbolEditorStore((s) => s.resetViewport);

  const handleGridSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const key = e.target.value as GridSizeKey;
      setGridSize(GRID_SIZES[key]);
    },
    [setGridSize],
  );

  const getCurrentGridKey = (): GridSizeKey => {
    for (const [key, value] of Object.entries(GRID_SIZES)) {
      if (value === gridSize) return key as GridSizeKey;
    }
    return "normal";
  };

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

        try {
          const imported = await importKicadSymbolFile(file);
          onImportedDraft?.(imported);
          if (!onImportedDraft) {
            setDraft(imported);
          }
          const warningCount = imported.importPreservation?.warnings.length ?? 0;

        toast({
          title: "Symbol imported",
          description:
            warningCount > 0
              ? imported.importPreservation?.warnings.map((warning) => warning.message).join(" • ")
              : `Imported ${file.name}`,
        });
      } catch (error) {
        toast({
          title: "Import failed",
          description:
            error instanceof Error ? error.message : "Unable to parse KiCAD symbol",
          variant: "destructive",
        });
      }
    },
    [onImportedDraft, setDraft],
  );

  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
      <input
        ref={importInputRef}
        type="file"
        accept=".kicad_sym"
        onChange={handleImportChange}
        className="hidden"
      />

      <button
        onClick={handleImportClick}
        className="rounded p-1.5 text-sm transition-colors hover:bg-accent"
        title="Import KiCAD Symbol (.kicad_sym)"
      >
        <UploadIcon />
      </button>

      <div className="h-4 w-px bg-border" />

      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="rounded p-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
          title="Undo (Ctrl+Z)"
        >
          <UndoIcon />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="rounded p-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
          title="Redo (Ctrl+Shift+Z)"
        >
          <RedoIcon />
        </button>
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Grid controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleGrid}
          className={`rounded p-1.5 text-sm transition-colors ${
            showGrid ? "bg-accent" : "hover:bg-accent"
          }`}
          title="Toggle Grid"
        >
          <GridIcon />
        </button>
        <select
          value={getCurrentGridKey()}
          onChange={handleGridSizeChange}
          className="rounded border border-border bg-background px-2 py-1 text-xs"
          title="Grid Size"
        >
          <option value="fine">Fine (0.025")</option>
          <option value="normal">Normal (0.05")</option>
          <option value="coarse">Coarse (0.1")</option>
        </select>
      </div>

      <div className="h-4 w-px bg-border" />

      {/* View controls */}
      <button
        onClick={resetViewport}
        className="rounded p-1.5 text-sm transition-colors hover:bg-accent"
        title="Reset View"
      >
        <CenterIcon />
      </button>

      <div className="flex-1" />

      {/* Help text */}
      <span className="text-xs text-muted-foreground">
        Shift+drag to pan | Scroll to zoom | Del to delete
      </span>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 20h16" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function UndoIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 10h10a5 5 0 0 1 5 5v2" />
      <path d="M3 10l5-5M3 10l5 5" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 10H11a5 5 0 0 0-5 5v2" />
      <path d="M21 10l-5-5M21 10l-5 5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  );
}

function CenterIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}
