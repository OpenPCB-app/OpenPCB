import {
  useCallback,
  useEffect,
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
import {
  SchematicCanvas,
  type SchematicCanvasHandle,
} from "./components/SchematicCanvas";
import { ComponentCommandPalette } from "./components/ComponentCommandPalette";
import { ToastProvider, useToast } from "./hooks/use-toast";
import { useDesignerWorkspace } from "./hooks/useDesignerWorkspace";
import { PcbCanvas } from "./pcb/PcbCanvas";
import { Board3DCanvas } from "./three-d/Board3DCanvas";
import type { LibraryComponent } from "../../../sdks";
import type { ModuleSpaceProps } from "./types";
import { SCHEMATIC_GRID_MM } from "./types";
import { isEditableShortcutTarget } from "../../../shared/frontend/canvas/utils/keyboard-shortcuts";

const MIN_LEFT = 240;
const MAX_LEFT = 520;
const DEFAULT_COMPONENT_LIMIT = 8;

function commonComponentRank(component: LibraryComponent): number {
  const text = [component.name, component.description, ...component.tags]
    .join(" ")
    .toLowerCase();
  if (text.includes("resistor")) return 0;
  if (text.includes("capacitor") || /\bcap\b/.test(text)) return 1;
  if (text.includes("led")) return 2;
  if (text.includes("diode")) return 3;
  if (text.includes("transistor") || text.includes("mosfet")) return 4;
  if (text.includes("connector") || text.includes("header")) return 5;
  if (text.includes("opamp") || text.includes("mcu") || /\bic\b/.test(text)) {
    return 6;
  }
  return 100;
}

function sortCommonComponents(
  components: LibraryComponent[],
): LibraryComponent[] {
  return [...components].sort((a, b) => {
    const rankDelta = commonComponentRank(a) - commonComponentRank(b);
    if (rankDelta !== 0) return rankDelta;
    return a.name.localeCompare(b.name);
  });
}

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

function DesignerSpaceInner({
  moduleId,
  backendURL,
  designId,
}: ModuleSpaceProps): ReactElement {
  const { addToast } = useToast();
  const { state, actions } = useDesignerWorkspace({
    backendURL,
    moduleId,
    initialDesignId: designId,
    onNotify: addToast,
  });
  const [leftWidth, setLeftWidth] = useState(300);
  const [zoomPercent, setZoomPercent] = useState(70);
  const [gridVisible, setGridVisible] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pcbDrcCount, setPcbDrcCount] = useState(0);
  const [pcbBoardSlot, setPcbBoardSlot] = useState<HTMLDivElement | null>(null);
  const canvasRef = useRef<SchematicCanvasHandle | null>(null);
  const canOpenPalette = state.activeView === "schem" && !!state.projection;

  const openComponentPalette = useCallback(() => {
    if (canOpenPalette) {
      setPaletteOpen(true);
    }
  }, [canOpenPalette]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) {
        return;
      }
      const hasModifier = event.metaKey || event.ctrlKey;
      if (hasModifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openComponentPalette();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openComponentPalette]);

  const handlePaletteSelect = useCallback(
    async (componentId: string) => {
      setPaletteOpen(false);
      try {
        const detail = await actions.resolvePlacement(componentId);
        if (!canvasRef.current) {
          addToast("Open a schematic before placing components", "warning");
          return;
        }
        canvasRef.current.armComponentPlacement(detail);
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : "Failed to resolve component",
          "error",
        );
      }
    },
    [actions.resolvePlacement, addToast],
  );

  const searchPaletteComponents = useCallback(
    (q: string) => actions.searchComponentsByQuery(q).catch(() => []),
    [actions.searchComponentsByQuery],
  );

  const loadPaletteDefaults = useCallback(async () => {
    const recentIds: string[] = [];
    const seen = new Set<string>();
    const parts = state.projection?.parts ?? [];
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const componentId = parts[index]?.componentId;
      if (!componentId || seen.has(componentId)) continue;
      seen.add(componentId);
      recentIds.push(componentId);
      if (recentIds.length >= DEFAULT_COMPONENT_LIMIT) break;
    }

    if (recentIds.length > 0) {
      const details = await Promise.all(
        recentIds.map((componentId) =>
          actions.resolvePlacement(componentId).catch(() => null),
        ),
      );
      const components = details
        .map((detail) => detail?.component ?? null)
        .filter(
          (component): component is LibraryComponent => component !== null,
        );
      if (components.length > 0) {
        return { label: "Recently used", components };
      }
    }

    const components = await actions.searchComponentsByQuery("");
    return {
      label: "Common components",
      components: sortCommonComponents(components).slice(
        0,
        DEFAULT_COMPONENT_LIMIT,
      ),
    };
  }, [
    actions.resolvePlacement,
    actions.searchComponentsByQuery,
    state.projection?.parts,
  ]);

  const selectedDesign = useMemo(
    () =>
      state.designs.find((design) => design.id === state.selectedDesignId) ??
      null,
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
        canOpenPalette={canOpenPalette}
        onOpenPalette={openComponentPalette}
      />

      {state.error ? (
        <div className="border-b border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        <div style={{ width: leftWidth }} className="shrink-0">
          <DesignerSidebar
            state={state}
            actions={actions}
            activeView={state.activeView}
            pcbSlotRef={setPcbBoardSlot}
          />
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
          ) : state.activeView === "pcb" ? (
            <PcbCanvas
              backendURL={backendURL}
              moduleId={moduleId}
              designId={state.selectedDesignId}
              dispatchCommand={actions.dispatchCommand}
              notifyExternalRevisionBump={actions.notifyExternalRevisionBump}
              onDrcCountChange={setPcbDrcCount}
              boardPanelTarget={pcbBoardSlot}
            />
          ) : state.activeView === "3d" ? (
            <Board3DCanvas
              backendURL={backendURL}
              moduleId={moduleId}
              selectedDesignId={state.selectedDesignId}
              error={state.error}
            />
          ) : (
            <DesignerPlaceholderView view={state.activeView} />
          )}

          {state.activeView === "schem" && state.projection ? (
            <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
              <div className="pointer-events-auto">
                <DesignerFloatingToolbar
                  gridVisible={gridVisible}
                  onToggleGrid={() => setGridVisible((v) => !v)}
                  canUndo={state.canUndo}
                  canRedo={state.canRedo}
                  onUndo={() => void actions.undo()}
                  onRedo={() => void actions.redo()}
                  onZoomIn={() => canvasRef.current?.zoomIn()}
                  onZoomOut={() => canvasRef.current?.zoomOut()}
                  onFit={() => canvasRef.current?.fit()}
                  onPlaceComponent={openComponentPalette}
                  onPlaceGnd={() => canvasRef.current?.armPrimitive("gnd")}
                  onPlacePwr={() => canvasRef.current?.armPrimitive("pwr")}
                  onPlaceNetPortal={() =>
                    canvasRef.current?.armPrimitive("net_portal")
                  }
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ComponentCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onSelect={handlePaletteSelect}
        searchComponents={searchPaletteComponents}
        loadDefaultComponents={loadPaletteDefaults}
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
