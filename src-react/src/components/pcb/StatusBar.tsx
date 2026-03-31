import { useSchematicStore } from "@/stores/schematic-store";

export function StatusBar() {
  const viewport = useSchematicStore((s) => s.chrome.viewport);
  const gridSize = useSchematicStore((s) => s.chrome.gridSize);
  const selectedCount = useSchematicStore((s) => s.chrome.selectedEntityIds.size);
  const activeTool = useSchematicStore((s) => s.chrome.activeTool);
  const session = useSchematicStore((s) => s.session);

  const zoomPercent = Math.round(viewport.zoom * 100);
  const gridMm = (gridSize / 1_000_000).toFixed(2);
  const sessionLabel =
    session?.type === "placement"
      ? `Placing ${session.symbolKind.replace(/_/g, " ")}`
      : session?.type === "wire"
        ? `Wiring ${session.sourcePinId}`
        : null;

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
