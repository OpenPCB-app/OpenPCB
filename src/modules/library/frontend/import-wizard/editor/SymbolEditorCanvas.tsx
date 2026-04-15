import { useEffect, useMemo, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { buildSymbolRenderModel } from "../../../../../shared/rendering/symbol-preview-builder";
import { EdaCanvas } from "../../../../../shared/frontend/canvas/interaction";
import { GridShader } from "../../../../../shared/frontend/canvas/primitives";
import { SymbolRenderLayer } from "../../../../../shared/frontend/canvas/scene";
import { useSymbolEditorStore } from "./useSymbolEditorStore";
import { useEditorToolHandler } from "./use-editor-tool";
import { PreviewGraphicOverlay } from "./PreviewGraphicOverlay";
import { SelectionOverlay } from "./SelectionOverlay";

/** Kicks invalidate whenever store-driven props change inside the Canvas. */
function InvalidateOnChange() {
  const invalidate = useThree((s) => s.invalidate);
  const graphics = useSymbolEditorStore((s) => s.graphics);
  const pins = useSymbolEditorStore((s) => s.pins);
  const previewGraphic = useSymbolEditorStore((s) => s.previewGraphic);
  const selectedIds = useSymbolEditorStore((s) => s.selectedIds);

  useEffect(() => {
    invalidate();
  }, [invalidate, graphics, pins, previewGraphic, selectedIds]);

  return null;
}

function EditorCanvasContent({
  handler,
}: {
  handler: ReturnType<typeof useEditorToolHandler>;
}): ReactElement {
  const graphics = useSymbolEditorStore((s) => s.graphics);
  const pins = useSymbolEditorStore((s) => s.pins);
  const gridVisible = useSymbolEditorStore((s) => s.gridVisible);
  const gridSizeMm = useSymbolEditorStore((s) => s.gridSizeMm);
  const previewGraphic = useSymbolEditorStore((s) => s.previewGraphic);
  const selectedIds = useSymbolEditorStore((s) => s.selectedIds);
  const referencePrefix = useSymbolEditorStore((s) => s.referencePrefix);

  const renderSource = useMemo(
    () => useSymbolEditorStore.getState().toSymbolRenderSource(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphics, pins, referencePrefix],
  );

  const model = useMemo(
    () => buildSymbolRenderModel(renderSource),
    [renderSource],
  );

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
      {(graphics.length > 0 || pins.length > 0) && (
        <SymbolRenderLayer model={model} />
      )}
      {previewGraphic && <PreviewGraphicOverlay graphic={previewGraphic} />}
      <SelectionOverlay
        selectedIds={selectedIds}
        graphics={graphics}
        pins={pins}
      />
    </EdaCanvas>
  );
}

export function SymbolEditorCanvas({
  className,
}: {
  className?: string;
}): ReactElement {
  const handler = useEditorToolHandler();

  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      <EditorCanvasContent handler={handler} />
    </div>
  );
}
