import { DEFAULT_SCHEMATIC_ZOOM, SCHEMATIC_GRID_MM } from "../defaults";
import { SymbolRenderLayer } from "../scene";
import { PreviewCanvasShell } from "./PreviewCanvasShell";
import type { SymbolPreviewCanvasProps } from "./types";

export function SymbolPreviewCanvas({
  model,
  emptyMessage = "No symbol preview",
  className,
  style,
  backgroundColor = "#0f172a",
  showGrid = true,
  fitPaddingPx = 24,
  minSpanMm = 2,
  initialZoom = DEFAULT_SCHEMATIC_ZOOM,
}: SymbolPreviewCanvasProps) {
  return (
    <PreviewCanvasShell
      hasModel={model !== null}
      bounds={model?.bounds ?? null}
      emptyMessage={emptyMessage}
      gridSize={SCHEMATIC_GRID_MM}
      className={className}
      style={style}
      backgroundColor={backgroundColor}
      showGrid={showGrid}
      fitPaddingPx={fitPaddingPx}
      minSpanMm={minSpanMm}
      initialZoom={initialZoom}
    >
      {model ? <SymbolRenderLayer model={model} /> : null}
    </PreviewCanvasShell>
  );
}
