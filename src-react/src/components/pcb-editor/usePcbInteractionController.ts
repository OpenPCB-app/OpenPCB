import { useCallback, useRef } from "react";
import { usePcbStore } from "@/stores/pcb-store";
import {
  hitTestPcb,
  getPadWorldPosition,
  findPadNet,
} from "./canvas/pcb-hit-test";
import { screenToPcb, snapToGrid } from "./canvas/pcb-viewport";
import type { Point2D } from "./pcb-types";

const DRAG_THRESHOLD_PX = 5;

type InteractionState =
  | { type: "idle" }
    | {
      type: "pending_drag";
      placementId: string;
      startScreen: Point2D;
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
    }
  | { type: "routing" };

export function usePcbInteractionController() {
  const stateRef = useRef<InteractionState>({ type: "idle" });

  const selectEntity = usePcbStore((s) => s.selectEntity);
  const clearSelection = usePcbStore((s) => s.clearSelection);
  const beginPlacementMove = usePcbStore((s) => s.beginPlacementMove);
  const movePlacement = usePcbStore((s) => s.movePlacement);

  const handleMouseDown = useCallback(
    (
      screenX: number,
      screenY: number,
      canvasBounds: DOMRect,
      additiveSelection: boolean,
    ) => {
      const store = usePcbStore.getState();
      if (!store.document) return;

      const localX = screenX - canvasBounds.left;
      const localY = screenY - canvasBounds.top;
      const worldPoint = screenToPcb(localX, localY, store.viewport);

      const hit = hitTestPcb(
        store.document.placements,
        store.document.traces,
        store.document.vias,
        worldPoint,
        store.activeLayer,
      );

      if (store.activeTool === "route") {
        if (store.routingSession) {
          if (hit?.kind === "pad") {
            const hitNetId = findPadNet(
              store.document.placements,
              store.document.nets,
              hit.placementId,
              hit.padNumber,
            );
            if (hitNetId === store.routingSession.netId) {
              const padPos = getPadWorldPosition(
                store.document.placements,
                hit.placementId,
                hit.padNumber,
              );
              if (padPos) {
                store.completeRoute(padPos);
                stateRef.current = { type: "idle" };
              }
            }
          } else {
            store.addRoutingCorner(worldPoint);
          }
        } else {
          if (hit?.kind === "pad") {
            const placement = store.document.placements.find(
              (p) => p.id === hit.placementId,
            );
            if (placement) {
              const padPos = getPadWorldPosition(
                store.document.placements,
                hit.placementId,
                hit.padNumber,
              );
              if (padPos) {
                store.startRouting(
                  {
                    componentId: placement.schematicSymbolId,
                    padNumber: hit.padNumber,
                  },
                  padPos,
                );
                stateRef.current = { type: "routing" };
              }
            }
          }
        }
        return;
      }

      if (hit?.kind === "trace") {
        selectEntity(hit.traceId, additiveSelection);
        stateRef.current = { type: "idle" };
        return;
      }

      if (hit?.kind === "via") {
        selectEntity(hit.viaId, additiveSelection);
        stateRef.current = { type: "idle" };
        return;
      }

      if (hit?.kind === "placement" || hit?.kind === "pad") {
        const placementId = hit.placementId;
        const placement = store.document.placements.find(
          (p) => p.id === placementId,
        );
        if (!placement) return;

        selectEntity(placementId, additiveSelection);

        stateRef.current = {
          type: "pending_drag",
          placementId,
          startScreen: { x: screenX, y: screenY },
          startWorld: worldPoint,
          originalPosition: { ...placement.position },
          hasStartedUndoBoundary: false,
        };
      } else {
        clearSelection();
        stateRef.current = { type: "idle" };
      }
    },
    [selectEntity, clearSelection],
  );

  const handleMouseMove = useCallback(
    (screenX: number, screenY: number, canvasBounds: DOMRect) => {
      const state = stateRef.current;
      const store = usePcbStore.getState();

      const localX = screenX - canvasBounds.left;
      const localY = screenY - canvasBounds.top;
      const worldPoint = screenToPcb(localX, localY, store.viewport);

      if (store.routingSession) {
        store.updateRoutingPreview(worldPoint);
        return;
      }

      if (state.type === "pending_drag") {
        const dx = screenX - state.startScreen.x;
        const dy = screenY - state.startScreen.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance >= DRAG_THRESHOLD_PX) {
          stateRef.current = {
            type: "dragging",
            placementId: state.placementId,
            startWorld: state.startWorld,
            originalPosition: state.originalPosition,
            hasStartedUndoBoundary: false,
          };
        }
      }

      if (stateRef.current.type === "dragging") {
        if (!stateRef.current.hasStartedUndoBoundary) {
          beginPlacementMove(stateRef.current.placementId);
          stateRef.current = {
            ...stateRef.current,
            hasStartedUndoBoundary: true,
          };
        }

        const movedPoint = {
          x:
            stateRef.current.originalPosition.x +
            (worldPoint.x - stateRef.current.startWorld.x),
          y:
            stateRef.current.originalPosition.y +
            (worldPoint.y - stateRef.current.startWorld.y),
        };
        const snapped = snapToGrid(movedPoint, store.gridSize);
        movePlacement(stateRef.current.placementId, snapped);
      }
    },
    [beginPlacementMove, movePlacement],
  );

  const handleMouseUp = useCallback(() => {
    const store = usePcbStore.getState();
    if (store.routingSession) return;
    stateRef.current = { type: "idle" };
  }, []);

  const isDragging = useCallback(() => {
    return stateRef.current.type === "dragging";
  }, []);

  const isRouting = useCallback(() => {
    return usePcbStore.getState().routingSession !== null;
  }, []);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    isDragging,
    isRouting,
  };
}
