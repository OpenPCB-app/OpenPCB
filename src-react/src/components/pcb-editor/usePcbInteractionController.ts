import { useCallback, useRef } from "react";
import { usePcbStore } from "@/stores/pcb-store";
import { hitTestPcb } from "./canvas/pcb-hit-test";
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
    }
  | {
      type: "dragging";
      placementId: string;
      startWorld: Point2D;
      originalPosition: Point2D;
    };

export function usePcbInteractionController() {
  const stateRef = useRef<InteractionState>({ type: "idle" });

  const selectPlacement = usePcbStore((s) => s.selectPlacement);
  const clearSelection = usePcbStore((s) => s.clearSelection);
  const movePlacement = usePcbStore((s) => s.movePlacement);

  const handleMouseDown = useCallback(
    (screenX: number, screenY: number, canvasBounds: DOMRect) => {
      const store = usePcbStore.getState();
      if (!store.document) return;

      const localX = screenX - canvasBounds.left;
      const localY = screenY - canvasBounds.top;
      const worldPoint = screenToPcb(localX, localY, store.viewport);

      const hit = hitTestPcb(
        store.document.placements,
        worldPoint,
        store.activeLayer,
      );

      if (hit?.kind === "placement" || hit?.kind === "pad") {
        const placementId = hit.placementId;
        const placement = store.document.placements.find(
          (p) => p.id === placementId,
        );
        if (!placement) return;

        selectPlacement(placementId);

        stateRef.current = {
          type: "pending_drag",
          placementId,
          startScreen: { x: screenX, y: screenY },
          startWorld: worldPoint,
          originalPosition: { ...placement.position },
        };
      } else {
        clearSelection();
        stateRef.current = { type: "idle" };
      }
    },
    [selectPlacement, clearSelection],
  );

  const handleMouseMove = useCallback(
    (screenX: number, screenY: number, canvasBounds: DOMRect) => {
      const state = stateRef.current;
      const store = usePcbStore.getState();

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
          };
        }
      }

      if (stateRef.current.type === "dragging") {
        const localX = screenX - canvasBounds.left;
        const localY = screenY - canvasBounds.top;
        const worldPoint = screenToPcb(localX, localY, store.viewport);

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
    [movePlacement],
  );

  const handleMouseUp = useCallback(() => {
    stateRef.current = { type: "idle" };
  }, []);

  const isDragging = useCallback(() => {
    return stateRef.current.type === "dragging";
  }, []);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    isDragging,
  };
}
