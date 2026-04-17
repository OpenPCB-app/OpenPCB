import { useEffect, useMemo, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { buildFootprintRenderModel } from "../../../../../shared/rendering/footprint-preview-builder";
import { EdaCanvas } from "../../../../../shared/frontend/canvas/interaction";
import { GridShader } from "../../../../../shared/frontend/canvas/primitives";
import { FootprintRenderLayer } from "../../../../../shared/frontend/canvas/scene";
import { SelectionRectOverlay } from "../../../../../shared/frontend/canvas/selection";
import { eventToMmRaw } from "../../../../../shared/frontend/canvas/tools/tool-utils";
import type { InteractionHandler } from "../../../../../shared/frontend/canvas/interaction/types";
import { useFootprintEditorStore } from "./useFootprintEditorStore";
import { useFootprintEditorToolHandler } from "./use-footprint-editor-tool";
import { FootprintSelectionOverlay } from "./FootprintSelectionOverlay";
import { FootprintPreviewOverlay } from "./FootprintPreviewOverlay";
import { FootprintTextEditorOverlay } from "./FootprintTextEditorOverlay";

function InvalidateOnChange() {
  const invalidate = useThree((s) => s.invalidate);
  const pads = useFootprintEditorStore((s) => s.pads);
  const graphics = useFootprintEditorStore((s) => s.graphics);
  const labels = useFootprintEditorStore((s) => s.labels);
  const previewGraphic = useFootprintEditorStore((s) => s.previewGraphic);
  const selectedIds = useFootprintEditorStore((s) => s.selectedIds);
  const selectionRect = useFootprintEditorStore((s) => s.selectionRect);
  const layerVisibility = useFootprintEditorStore((s) => s.layerVisibility);

  useEffect(() => {
    invalidate();
  }, [
    invalidate,
    pads,
    graphics,
    labels,
    previewGraphic,
    selectedIds,
    selectionRect,
    layerVisibility,
  ]);

  return null;
}

function EditorCanvasContent({
  handler,
}: {
  handler: InteractionHandler;
}): ReactElement {
  const pads = useFootprintEditorStore((s) => s.pads);
  const graphics = useFootprintEditorStore((s) => s.graphics);
  const labels = useFootprintEditorStore((s) => s.labels);
  const gridVisible = useFootprintEditorStore((s) => s.gridVisible);
  const gridSizeMm = useFootprintEditorStore((s) => s.gridSizeMm);
  const previewGraphic = useFootprintEditorStore((s) => s.previewGraphic);
  const selectedIds = useFootprintEditorStore((s) => s.selectedIds);
  const selectionRect = useFootprintEditorStore((s) => s.selectionRect);
  const layerVisibility = useFootprintEditorStore((s) => s.layerVisibility);
  const activeLayer = useFootprintEditorStore((s) => s.activeLayer);
  const footprintName = useFootprintEditorStore((s) => s.footprintName);

  const visibleLayers = useMemo(() => [...layerVisibility], [layerVisibility]);

  // Inactive layers are dimmed at ~30% brightness
  const dimmedLayers = useMemo(() => {
    const set = new Set<string>();
    for (const layer of layerVisibility) {
      if (layer !== activeLayer) set.add(layer);
    }
    return set;
  }, [layerVisibility, activeLayer]);

  const renderSource = useMemo(
    () => useFootprintEditorStore.getState().toFootprintRenderSource(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pads, graphics, labels, footprintName],
  );

  const model = useMemo(
    () =>
      buildFootprintRenderModel(renderSource, {
        preserveOrigin: true,
        includeLayerNames: visibleLayers,
        includePadLayerNames: visibleLayers,
      }),
    [renderSource, visibleLayers],
  );

  const hasContent =
    pads.length > 0 || graphics.length > 0 || labels.length > 0;

  return (
    <EdaCanvas
      readOnly={false}
      interactionHandler={handler}
      className="h-full w-full"
      backgroundColor="#0f172a"
      initialZoom={40}
    >
      <InvalidateOnChange />
      <GridShader gridSize={gridSizeMm} visible={gridVisible} alpha={0.18} />
      {hasContent && (
        <FootprintRenderLayer
          model={model}
          useLayerColors
          dimmedLayers={dimmedLayers}
        />
      )}
      {previewGraphic && <FootprintPreviewOverlay graphic={previewGraphic} />}
      <FootprintSelectionOverlay
        selectedIds={selectedIds}
        pads={pads}
        graphics={graphics}
        labels={labels}
      />
      <SelectionRectOverlay
        a={selectionRect?.a ?? null}
        b={selectionRect?.b ?? null}
      />
    </EdaCanvas>
  );
}

export function FootprintEditorCanvas({
  className,
}: {
  className?: string;
}): ReactElement {
  const toolHandler = useFootprintEditorToolHandler();

  const handler: InteractionHandler = useMemo(
    () => ({
      onPointerDown(event) {
        toolHandler.onPointerDown?.(event);
      },
      onPointerMove(event) {
        useFootprintEditorStore.getState().setCursorMm(eventToMmRaw(event));
        toolHandler.onPointerMove?.(event);
      },
      onPointerUp(event) {
        toolHandler.onPointerUp?.(event);
      },
      onPointerLeave() {
        useFootprintEditorStore.getState().setCursorMm(null);
      },
    }),
    [toolHandler],
  );

  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      <EditorCanvasContent handler={handler} />
      <FootprintTextEditorOverlay />
    </div>
  );
}
