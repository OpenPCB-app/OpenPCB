import { useMemo } from "react";
import { FootprintRenderLayer, footprintGeometryBounds, footprintVisualBounds } from "../scene";
import { PreviewCanvasShell } from "./PreviewCanvasShell";
import type { FootprintPreviewCanvasProps } from "./types";

export function FootprintPreviewCanvas({
  model,
  emptyMessage = "No footprint preview",
  fitToGeometryOnly = false,
  className,
  style,
  backgroundColor = "#0f172a",
  showGrid = true,
  fitPaddingPx = 24,
  minSpanMm = 2,
  initialZoom = 24,
}: FootprintPreviewCanvasProps) {
  const fittedBounds = useMemo(() => {
    if (!model) {
      return null;
    }
    if (fitToGeometryOnly) {
      return footprintGeometryBounds(model) ?? model.bounds;
    }
    return footprintVisualBounds(model) ?? model.bounds;
  }, [fitToGeometryOnly, model]);

  return (
    <PreviewCanvasShell
      hasModel={model !== null}
      bounds={fittedBounds}
      emptyMessage={emptyMessage}
      gridSize={0.5}
      className={className}
      style={style}
      backgroundColor={backgroundColor}
      showGrid={showGrid}
      fitPaddingPx={fitPaddingPx}
      minSpanMm={minSpanMm}
      initialZoom={initialZoom}
    >
      {model ? <FootprintRenderLayer model={model} /> : null}
    </PreviewCanvasShell>
  );
}
