import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { DesignerFloatingToolbar } from "./components/DesignerFloatingToolbar";
import { DesignerHeader } from "./components/DesignerHeader";
import { DesignerPlaceholderView } from "./components/DesignerPlaceholderView";
import { DesignerSidebar } from "./components/DesignerSidebar";
import { DesignerStatusBar } from "./components/DesignerStatusBar";
import { SchematicCanvas, type SchematicCanvasHandle } from "./components/SchematicCanvas";
import { ToastProvider, useToast } from "./hooks/use-toast";
import { useDesignerWorkspace } from "./hooks/useDesignerWorkspace";
import type { ModuleSpaceProps } from "./types";
import { SCHEMATIC_GRID_MM } from "./types";

const MIN_LEFT = 240;
const MAX_LEFT = 520;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function CanvasEmptyState({ message }: { message: string }): ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-950">
      <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  );
}

function DesignerSpaceInner({ moduleId, backendURL, designId }: ModuleSpaceProps): ReactElement {
  const { addToast } = useToast();
  const { state, actions } = useDesignerWorkspace({
    backendURL,
    moduleId,
    initialDesignId: designId,
    onNotify: addToast,
  });
  const [leftWidth, setLeftWidth] = useState(300);
  const [zoomPercent, setZoomPercent] = useState(70);
  const [gridVisible, setGridVisible] = useState(false);
  const canvasRef = useRef<SchematicCanvasHandle | null>(null);

  const selectedDesign = useMemo(
    () => state.designs.find((design) => design.id === state.selectedDesignId) ?? null,
    [state.designs, state.selectedDesignId],
  );

  const selectionSummary = useMemo(() => {
    if (state.selectedPinId) {
      return `Pin: ${state.selectedPinId}`;
    }
    if (state.selectedPartId) {
      return `Part: ${state.selectedPartId}`;
    }
    if (state.selectedLabelId) {
      return `Label: ${state.selectedLabelId}`;
    }
    return "Select";
  }, [state.selectedLabelId, state.selectedPartId, state.selectedPinId]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftWidth;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setLeftWidth(clamp(startWidth + delta, MIN_LEFT, MAX_LEFT));
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const canvasContent = () => {
    if (!state.selectedDesignId) {
      return (
        <CanvasEmptyState message="Select or create a design to start editing" />
      );
    }
    if (!state.projection) {
      return <CanvasEmptyState message="Loading schematic..." />;
    }
    return (
      <SchematicCanvas
        ref={canvasRef}
        projection={state.projection}
        selectedPartId={state.selectedPartId}
        selectedPinId={state.selectedPinId}
        selectedLabelId={state.selectedLabelId}
        wireSourcePinId={state.wireSourcePinId}
        labelDraftText={state.labelDraftText}
        gridVisible={gridVisible}
        draggingComponentId={state.draggingComponentId}
        dragPlacementLoading={state.dragPlacementLoading}
        dragPlacementDetail={state.dragPlacementDetail}
        dragGhostNm={state.dragGhostNm}
        actions={actions}
        onZoomChange={setZoomPercent}
      />
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-slate-950">
      <DesignerHeader
        activeView={state.activeView}
        selectedDesign={selectedDesign}
        designs={state.designs}
        creatingDesign={state.creatingDesign}
        onViewChange={actions.setActiveView}
        onSelectDesign={actions.selectDesign}
        onCreateDesign={actions.createDesign}
      />

      {state.error ? (
        <div className="border-b border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        <div style={{ width: leftWidth }} className="shrink-0">
          <DesignerSidebar state={state} actions={actions} />
        </div>

        <div
          className="group relative w-1 shrink-0 cursor-col-resize bg-slate-800/40 hover:bg-violet-600/60"
          onPointerDown={startResize}
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-700 group-hover:bg-violet-400" />
        </div>

        <div className="relative min-h-0 min-w-0 flex-1">
          {state.activeView === "schem" ? (
            canvasContent()
          ) : (
            <DesignerPlaceholderView view={state.activeView} />
          )}

          {state.activeView === "schem" && state.projection ? (
            <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
              <div className="pointer-events-auto">
                <DesignerFloatingToolbar
                  gridVisible={gridVisible}
                  canUndo={state.canUndo}
                  canRedo={state.canRedo}
                  onUndo={() => void actions.undo()}
                  onRedo={() => void actions.redo()}
                  onZoomIn={() => canvasRef.current?.zoomIn()}
                  onZoomOut={() => canvasRef.current?.zoomOut()}
                  onFit={() => canvasRef.current?.fit()}
                  onToggleGrid={() => setGridVisible((value) => !value)}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <DesignerStatusBar
        gridMm={SCHEMATIC_GRID_MM}
        zoom={zoomPercent}
        selection={selectionSummary}
      />
    </div>
  );
}

export function DesignerSpace(props: ModuleSpaceProps): ReactElement {
  return (
    <ToastProvider>
      <DesignerSpaceInner {...props} />
    </ToastProvider>
  );
}
