import { useEffect, useMemo, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { buildSymbolRenderModel } from "../../../../../shared/rendering/symbol-preview-builder";
import { EdaCanvas } from "../../../../../shared/frontend/canvas/interaction";
import { GridShader } from "../../../../../shared/frontend/canvas/primitives";
import { SymbolRenderLayer } from "../../../../../shared/frontend/canvas/scene";
import { SelectionRectOverlay } from "../../../../../shared/frontend/canvas/selection";
import { eventToMmRaw } from "../../../../../shared/frontend/canvas/tools/tool-utils";
import type { InteractionHandler } from "../../../../../shared/frontend/canvas/interaction/types";
import { useSymbolEditorStore } from "./useSymbolEditorStore";
import { useEditorToolHandler } from "./use-editor-tool";
import { PreviewGraphicOverlay } from "./PreviewGraphicOverlay";
import { SelectionOverlay } from "./SelectionOverlay";
import { TextEditorOverlay } from "./TextEditorOverlay";

/** Kicks invalidate whenever store-driven props change inside the Canvas. */
function InvalidateOnChange() {
  const invalidate = useThree((s) => s.invalidate);
  const graphics = useSymbolEditorStore((s) => s.graphics);
  const pins = useSymbolEditorStore((s) => s.pins);
  const labels = useSymbolEditorStore((s) => s.labels);
  const previewGraphic = useSymbolEditorStore((s) => s.previewGraphic);
  const selectedIds = useSymbolEditorStore((s) => s.selectedIds);
  const selectionRect = useSymbolEditorStore((s) => s.selectionRect);

  useEffect(() => {
    invalidate();
  }, [
    invalidate,
    graphics,
    pins,
    labels,
    previewGraphic,
    selectedIds,
    selectionRect,
  ]);

  return null;
}

function EditorCanvasContent({
  handler,
}: {
  handler: InteractionHandler;
}): ReactElement {
  const graphics = useSymbolEditorStore((s) => s.graphics);
  const pins = useSymbolEditorStore((s) => s.pins);
  const labels = useSymbolEditorStore((s) => s.labels);
  const gridVisible = useSymbolEditorStore((s) => s.gridVisible);
  const gridSizeMm = useSymbolEditorStore((s) => s.gridSizeMm);
  const previewGraphic = useSymbolEditorStore((s) => s.previewGraphic);
  const selectedIds = useSymbolEditorStore((s) => s.selectedIds);
  const selectionRect = useSymbolEditorStore((s) => s.selectionRect);
  const referencePrefix = useSymbolEditorStore((s) => s.referencePrefix);

  const renderSource = useMemo(
    () => useSymbolEditorStore.getState().toSymbolRenderSource(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphics, pins, labels, referencePrefix],
  );

  const model = useMemo(
    () => buildSymbolRenderModel(renderSource, { preserveOrigin: true }),
    [renderSource],
  );

  return (
    <EdaCanvas
      readOnly={false}
      interactionHandler={handler}
      className="h-full w-full"
      backgroundColor="#0f172a"
      initialZoom={40}
      themeMode="dark"
    >
      <InvalidateOnChange />
      <GridShader gridSize={gridSizeMm} visible={gridVisible} alpha={0.18} />
      {(graphics.length > 0 || pins.length > 0 || labels.length > 0) && (
        <SymbolRenderLayer model={model} />
      )}
      {previewGraphic && <PreviewGraphicOverlay graphic={previewGraphic} />}
      <SelectionOverlay
        selectedIds={selectedIds}
        graphics={graphics}
        pins={pins}
        labels={labels}
      />
      <SelectionRectOverlay
        a={selectionRect?.a ?? null}
        b={selectionRect?.b ?? null}
      />
    </EdaCanvas>
  );
}

export function SymbolEditorCanvas({
  className,
}: {
  className?: string;
}): ReactElement {
  const toolHandler = useEditorToolHandler();

  // Wrap the tool handler to additionally track the live cursor position
  // in mm-space. Paste uses `cursorMm` when the user hits Cmd/Ctrl+V.
  const handler: InteractionHandler = useMemo(
    () => ({
      onPointerDown(event) {
        toolHandler.onPointerDown?.(event);
      },
      onPointerMove(event) {
        useSymbolEditorStore.getState().setCursorMm(eventToMmRaw(event));
        toolHandler.onPointerMove?.(event);
      },
      onPointerUp(event) {
        toolHandler.onPointerUp?.(event);
      },
      onPointerLeave() {
        useSymbolEditorStore.getState().setCursorMm(null);
        toolHandler.onPointerLeave?.();
      },
    }),
    [toolHandler],
  );

  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      <EditorCanvasContent handler={handler} />
      <TextEditorOverlay />
    </div>
  );
}
