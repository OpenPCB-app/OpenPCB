import { useState, useCallback } from "react";
import { useSchematicStore } from "@/stores/schematic-store";
import { usePcbStore } from "@/stores/pcb-store";
import { getSymbolKindLabel } from "./symbol-display";
import {
  useSchematicAutoSave,
  type SaveStatus,
} from "@/hooks/useSchematicAutoSave";
import type { DesignTab } from "@/stores/navigation-store";

function SchematicStatusBar() {
  const viewport = useSchematicStore((s) => s.chrome.viewport);
  const gridSize = useSchematicStore((s) => s.chrome.gridSize);
  const selectedCount = useSchematicStore(
    (s) => s.chrome.selectedEntityIds.size,
  );
  const activeTool = useSchematicStore((s) => s.chrome.activeTool);
  const session = useSchematicStore((s) => s.session);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const handleSaveStatus = useCallback((status: SaveStatus) => {
    setSaveStatus(status);
    if (status === "saved") {
      const timer = setTimeout(() => setSaveStatus("idle"), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  useSchematicAutoSave(handleSaveStatus);

  const zoomPercent = Math.round(viewport.zoom * 100);
  const gridMm = (gridSize / 1_000_000).toFixed(2);
  const sessionLabel =
    session?.type === "placement"
      ? `Placing ${getSymbolKindLabel(session.symbolKind)}`
      : session?.type === "wire"
        ? `Wiring ${session.sourcePinId}`
        : null;

  const saveLabel =
    saveStatus === "saving"
      ? "Saving..."
      : saveStatus === "saved"
        ? "Saved"
        : saveStatus === "error"
          ? "Save failed"
          : null;

  return (
    <div className="flex h-6 items-center gap-4 border-t border-border bg-surface px-3 text-[11px] text-muted-foreground">
      <span>Grid: {gridMm}mm</span>
      <span>Zoom: {zoomPercent}%</span>
      {selectedCount > 0 && <span>{selectedCount} selected</span>}
      {sessionLabel && <span>{sessionLabel}</span>}
      <div className="flex-1" />
      {saveLabel && (
        <span
          className={
            saveStatus === "error" ? "text-red-500" : "text-muted-foreground"
          }
        >
          {saveLabel}
        </span>
      )}
      <span className="capitalize">{activeTool}</span>
    </div>
  );
}

function PcbStatusBar() {
  const viewport = usePcbStore((s) => s.viewport);
  const gridSize = usePcbStore((s) => s.gridSize);
  const selectedCount = usePcbStore((s) => s.selectedIds.size);
  const activeTool = usePcbStore((s) => s.activeTool);
  const routingSession = usePcbStore((s) => s.routingSession);

  const zoomPercent = Math.round(viewport.zoom * 100);
  const gridMm = gridSize.toFixed(2);
  const sessionLabel = routingSession ? `Routing ${routingSession.netId}` : null;

  return (
    <div className="flex h-6 items-center gap-4 border-t border-border bg-surface px-3 text-[11px] text-muted-foreground">
      <span>Grid: {gridMm}mm</span>
      <span>Zoom: {zoomPercent}%</span>
      {selectedCount > 0 && <span>{selectedCount} selected</span>}
      {sessionLabel && <span>{sessionLabel}</span>}
      <div className="flex-1" />
      <span className="capitalize">{activeTool}</span>
    </div>
  );
}

export function StatusBar({ designTab }: { designTab: DesignTab }) {
  if (designTab === "pcb") {
    return <PcbStatusBar />;
  }

  return <SchematicStatusBar />;
}
