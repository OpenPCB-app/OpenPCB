import { useMemo, useRef } from "react";
import { usePcbStore } from "@/stores/pcb-store";
import { useCanvasColors } from "@/lib/canvas-theme";
import {
  findPadNet,
  getPadRoutingLayer,
  getPadWorldPosition,
  hitTestPcb,
} from "@/components/pcb-editor/canvas/pcb-hit-test";
import { snapPointToGrid } from "@/components/pcb-editor/routing/manhattan-path";
import type { Point2D } from "@/components/pcb-editor/pcb-types";
import { EdaCanvas } from "../interaction/EdaCanvas";
import { GridShader } from "../primitives/GridShader";
import { PcbScene } from "../scenes/PcbScene";
import {
  isDeleteShortcut,
  isEscapeShortcut,
  isRedoShortcut,
  isSelectAllShortcut,
  isUndoShortcut,
  matchesKey,
  parseShaderColor,
  useWindowKeyboardShortcuts,
  type KeyboardShortcutBinding,
} from "../utils";
import type {
  InteractionHandler,
  InteractionEvent,
} from "../interaction/types";
import { Units } from "../coords";
import { createPcbAdapterSceneTransform } from "./pcb-adapter-transform";

const DRAG_THRESHOLD_PX = 5;

type PcbInteractionState =
  | { type: "idle" }
  | {
      type: "pending_drag";
      placementId: string;
      startScreen: { x: number; y: number };
      startWorld: Point2D;
      originalPosition: Point2D;
      hasStartedUndoBoundary: boolean;
    }
  | {
      type: "dragging";
      placementId: string;
      startWorld: Point2D;
      originalPosition: Point2D;
      hasStartedUndoBoundary: boolean;
    };

function getSelectedPlacementId(): string | null {
  const store = usePcbStore.getState();
  const document = store.document;
  if (!document) return null;

  return (
    Array.from(store.selectedIds).find((id) =>
      document.placements.some((placement) => placement.id === id),
    ) ?? null
  );
}

export function PcbCanvasR3F() {
  const document = usePcbStore((state) => state.document);
  const ratsnest = usePcbStore((state) => state.ratsnest);
  const selectedIds = usePcbStore((state) => state.selectedIds);
  const activeLayer = usePcbStore((state) => state.activeLayer);
  const visibleLayers = usePcbStore((state) => state.visibleLayers);
  const gridSize = usePcbStore((state) => state.gridSize);
  const routingSession = usePcbStore((state) => state.routingSession);

  const colors = useCanvasColors();
  const interactionStateRef = useRef<PcbInteractionState>({ type: "idle" });
  const sceneTransform = useMemo(
    () => createPcbAdapterSceneTransform(document?.boardOutline),
    [document?.boardOutline],
  );
  const interactionCoordinateTransform = useMemo(
    () => ({
      sceneUnit: "mm" as const,
      worldUnit: "nm" as const,
      yAxis: "up" as const,
      scenePointToWorldPoint(point: Point2D) {
        return sceneTransform.storePointToWorldPointNm(
          sceneTransform.scenePointToStorePoint(point),
        );
      },
    }),
    [sceneTransform],
  );

  const interactionHandler = useMemo<InteractionHandler>(() => {
    function getStoreWorldPoint(event: InteractionEvent): Point2D {
      return {
        x: Units.nmToMm(event.worldPoint.x),
        y: Units.nmToMm(event.worldPoint.y),
      };
    }

    return {
      onPointerDown(event) {
        const store = usePcbStore.getState();
        const doc = store.document;
        if (!doc) return;

        const worldPoint = getStoreWorldPoint(event);
        const additiveSelection = event.modifiers.ctrl || event.modifiers.meta;
        const hit = hitTestPcb(
          doc.placements,
          doc.traces,
          doc.vias,
          worldPoint,
          store.activeLayer,
        );

        if (store.activeTool === "route") {
          if (store.routingSession) {
            if (hit?.kind === "pad") {
              const hitNetId = findPadNet(
                doc.placements,
                doc.nets,
                hit.placementId,
                hit.padNumber,
              );
              if (hitNetId === store.routingSession.netId) {
                const padPosition = getPadWorldPosition(
                  doc.placements,
                  hit.placementId,
                  hit.padNumber,
                );
                if (padPosition) {
                  store.completeRoute(padPosition);
                  interactionStateRef.current = { type: "idle" };
                  return;
                }
              }
            }

            store.addRoutingCorner(worldPoint);
            interactionStateRef.current = { type: "idle" };
            return;
          }

          if (hit?.kind === "pad") {
            const placement = doc.placements.find(
              (candidate) => candidate.id === hit.placementId,
            );
            const padPosition = getPadWorldPosition(
              doc.placements,
              hit.placementId,
              hit.padNumber,
            );
            const routingLayer = getPadRoutingLayer(
              doc.placements,
              hit.placementId,
              hit.padNumber,
            );

            if (placement && padPosition && routingLayer) {
              store.startRouting(
                {
                  componentId: placement.schematicSymbolId,
                  padNumber: hit.padNumber,
                },
                padPosition,
                routingLayer,
              );
            }
          }

          interactionStateRef.current = { type: "idle" };
          return;
        }

        if (hit?.kind === "trace") {
          store.selectEntity(hit.traceId, additiveSelection);
          interactionStateRef.current = { type: "idle" };
          return;
        }

        if (hit?.kind === "via") {
          store.selectEntity(hit.viaId, additiveSelection);
          interactionStateRef.current = { type: "idle" };
          return;
        }

        if (hit?.kind === "placement" || hit?.kind === "pad") {
          const placementId = hit.placementId;
          const placement = doc.placements.find(
            (candidate) => candidate.id === placementId,
          );
          if (!placement) return;

          store.selectEntity(placementId, additiveSelection);
          interactionStateRef.current = {
            type: "pending_drag",
            placementId,
            startScreen: event.screenPoint,
            startWorld: worldPoint,
            originalPosition: { ...placement.position },
            hasStartedUndoBoundary: false,
          };
          return;
        }

        store.clearSelection();
        interactionStateRef.current = { type: "idle" };
      },

      onPointerMove(event) {
        const store = usePcbStore.getState();
        const worldPoint = getStoreWorldPoint(event);

        if (store.routingSession) {
          store.updateRoutingPreview(worldPoint);
          return;
        }

        const interactionState = interactionStateRef.current;
        if (interactionState.type === "pending_drag") {
          const dx = event.screenPoint.x - interactionState.startScreen.x;
          const dy = event.screenPoint.y - interactionState.startScreen.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance >= DRAG_THRESHOLD_PX) {
            interactionStateRef.current = {
              type: "dragging",
              placementId: interactionState.placementId,
              startWorld: interactionState.startWorld,
              originalPosition: interactionState.originalPosition,
              hasStartedUndoBoundary: interactionState.hasStartedUndoBoundary,
            };
          } else {
            return;
          }
        }

        const draggingState = interactionStateRef.current;
        if (draggingState.type !== "dragging") {
          return;
        }

        if (!draggingState.hasStartedUndoBoundary) {
          store.beginPlacementMove(draggingState.placementId);
          interactionStateRef.current = {
            ...draggingState,
            hasStartedUndoBoundary: true,
          };
        }

        const movedPoint = {
          x:
            draggingState.originalPosition.x +
            (worldPoint.x - draggingState.startWorld.x),
          y:
            draggingState.originalPosition.y +
            (worldPoint.y - draggingState.startWorld.y),
        };
        const snapped = snapPointToGrid(movedPoint, store.gridSize);
        store.movePlacement(draggingState.placementId, snapped);
      },

      onPointerUp() {
        if (usePcbStore.getState().routingSession) {
          return;
        }
        interactionStateRef.current = { type: "idle" };
      },

      onPointerLeave() {
        if (usePcbStore.getState().routingSession) {
          return;
        }
        interactionStateRef.current = { type: "idle" };
      },
    };
  }, []);

  const keyboardShortcuts = useMemo<KeyboardShortcutBinding[]>(
    () => [
      {
        matches: (event) => isUndoShortcut(event),
        run: (event) => {
          event.preventDefault();
          const store = usePcbStore.getState();
          if (store.routingSession) {
            store.cancelRouting();
            store.setActiveTool("select");
            return;
          }
          store.undo();
        },
      },
      {
        matches: (event) =>
          isRedoShortcut(event) ||
          ((event.ctrlKey || event.metaKey) && event.key === "y"),
        run: (event) => {
          event.preventDefault();
          const store = usePcbStore.getState();
          if (store.routingSession) {
            return;
          }
          store.redo();
        },
      },
      {
        matches: isSelectAllShortcut,
        run: (event) => {
          event.preventDefault();
          usePcbStore.getState().selectAllPlacements();
        },
      },
      {
        matches: isDeleteShortcut,
        run: (event) => {
          const store = usePcbStore.getState();
          if (store.routingSession || store.selectedIds.size === 0) {
            return;
          }
          if (event.key === "Backspace") {
            event.preventDefault();
          }
          store.deleteSelectedEntities();
        },
      },
      {
        matches: isEscapeShortcut,
        run: () => {
          const store = usePcbStore.getState();
          if (store.routingSession) {
            store.cancelRouting();
            store.setActiveTool("select");
          } else if (store.selectedIds.size > 0) {
            store.clearSelection();
          } else {
            store.setActiveTool("select");
          }
          interactionStateRef.current = { type: "idle" };
        },
      },
      {
        matches: (event) => matchesKey(event, "r"),
        run: () => {
          const store = usePcbStore.getState();
          if (store.routingSession) {
            return;
          }
          const selectedPlacementId = getSelectedPlacementId();
          if (selectedPlacementId) {
            store.rotatePlacement(selectedPlacementId, 90);
          }
        },
      },
      {
        matches: (event) => matchesKey(event, "f"),
        run: () => {
          const store = usePcbStore.getState();
          if (store.routingSession) {
            store.flipElbowDirection();
            return;
          }
          const selectedPlacementId = getSelectedPlacementId();
          if (selectedPlacementId) {
            store.flipPlacement(selectedPlacementId);
          }
        },
      },
      {
        matches: (event) => matchesKey(event, "v"),
        run: () => {
          const store = usePcbStore.getState();
          if (store.routingSession && store.lastCursorPosition) {
            store.placeRoutingVia(store.lastCursorPosition);
          }
        },
      },
      {
        matches: (event) => event.key === "w",
        run: () => {
          const store = usePcbStore.getState();
          if (store.routingSession) {
            store.cycleTraceWidth(1);
          }
        },
      },
      {
        matches: (event) => event.key === "W",
        run: () => {
          const store = usePcbStore.getState();
          if (store.routingSession) {
            store.cycleTraceWidth(-1);
          }
        },
      },
    ],
    [],
  );

  useWindowKeyboardShortcuts(keyboardShortcuts, {
    ignoreEditableTarget: true,
  });

  return (
    <EdaCanvas
      testId="pcb-canvas"
      interactionHandler={interactionHandler}
      interactionCoordinateTransform={interactionCoordinateTransform}
      gridSize={Units.mmToNm(gridSize)}
      backgroundColor={colors.background}
      initialZoom={4}
    >
      <GridShader
        gridSize={gridSize}
        visible
        color={parseShaderColor(colors.gridDot)}
        alpha={0.25}
      />
      <PcbScene
        document={document}
        ratsnest={ratsnest}
        routingPreview={routingSession?.previewSegments}
        routingPreviewVias={routingSession?.committedVias}
        config={{
          editable: true,
          activeLayer,
          visibleLayers,
          selectedIds,
          gridSize,
        }}
        colors={colors}
        sceneTransform={sceneTransform}
      />
    </EdaCanvas>
  );
}
