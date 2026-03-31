import { useSchematicStore } from "@/stores/schematic-store";

export function DesignStatusBar() {
  const viewport = useSchematicStore((s) => s.chrome.viewport);
  const zoom = viewport ? Math.round(viewport.zoom * 100) : 100;

  return (
    <div className="flex h-8 items-center justify-between border-t border-border-default bg-bg-tertiary px-3 text-xs">
      {/* Left: ERC/DRC status */}
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success" />
          <span className="text-text-secondary">ERC: 0 errors</span>
        </span>
      </div>

      {/* Center: zoom + grid */}
      <div className="flex items-center gap-4">
        <button className="text-text-secondary hover:text-text-primary transition-colors">
          Zoom: {zoom}%
        </button>
        <button className="text-text-secondary hover:text-text-primary transition-colors">
          Grid: 50mil
        </button>
      </div>

      {/* Right: save status */}
      <div className="flex items-center gap-2">
        <span className="text-text-muted">Saved</span>
      </div>
    </div>
  );
}
