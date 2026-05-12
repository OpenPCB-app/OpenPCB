import { useMemo } from "react";
import { DEFAULT_PCB_ZOOM, PCB_GRID_MM } from "../defaults";
import {
  FootprintRenderLayer,
  footprintGeometryBounds,
  footprintVisualBounds,
} from "../scene";
import { PreviewCanvasShell } from "./PreviewCanvasShell";
import type { FootprintPreviewCanvasProps } from "./types";

/**
 * Hide F.Fab / B.Fab so KiCad's `${REFERENCE}` placeholder text (positioned at
 * the footprint origin / pad-1 center) doesn't overlay pads in Library preview
 * tiles. Matches the PCB canvas's default-hide convention.
 */
const PREVIEW_HIDDEN_LAYERS: ReadonlySet<string> = new Set([
  "F.Fab",
  "B.Fab",
  "F.Fabrication",
  "B.Fabrication",
]);

export function FootprintPreviewCanvas({
  model,
  emptyMessage = "No footprint preview",
  fitToGeometryOnly = false,
  className,
  style,
  backgroundColor = "#131313",
  showGrid = true,
  fitPaddingPx = 24,
  minSpanMm = 2,
  initialZoom = DEFAULT_PCB_ZOOM,
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
      gridSize={PCB_GRID_MM}
      className={className}
      style={style}
      backgroundColor={backgroundColor}
      showGrid={showGrid}
      fitPaddingPx={fitPaddingPx}
      minSpanMm={minSpanMm}
      initialZoom={initialZoom}
    >
      {model ? (
        <FootprintRenderLayer
          model={model}
          hiddenLayers={PREVIEW_HIDDEN_LAYERS}
        />
      ) : null}
    </PreviewCanvasShell>
  );
}
