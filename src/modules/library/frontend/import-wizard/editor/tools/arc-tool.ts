import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type { PointMm } from "../../../../../../shared/rendering/types";
import type { EditorTool } from "../types";
import { useSymbolEditorStore } from "../useSymbolEditorStore";
import { eventToMm } from "./tool-utils";

export function createArcTool(): EditorTool {
  let startPoint: PointMm | null = null;
  let midPoint: PointMm | null = null;

  return {
    id: "arc",
    cursor: "crosshair",

    onActivate() {
      startPoint = null;
      midPoint = null;
    },

    onDeactivate() {
      startPoint = null;
      midPoint = null;
      useSymbolEditorStore.getState().setPreviewGraphic(null);
    },

    onPointerDown(event: InteractionEvent) {
      const store = useSymbolEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm);

      if (!startPoint) {
        startPoint = point;
        return;
      }

      if (!midPoint) {
        midPoint = point;
        return;
      }

      // Third click — commit arc
      store.pushSnapshot();
      store.addGraphic({
        kind: "arc3",
        start: startPoint,
        mid: midPoint,
        end: point,
        strokeWidthMm: 0.15,
      });
      store.setPreviewGraphic(null);
      startPoint = null;
      midPoint = null;
    },

    onPointerMove(event: InteractionEvent) {
      if (!startPoint) return;
      const store = useSymbolEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm);

      if (!midPoint) {
        // Show line from start to cursor
        store.setPreviewGraphic({
          kind: "line",
          a: startPoint,
          b: point,
          strokeWidthMm: 0.15,
        });
      } else {
        // Show arc preview
        store.setPreviewGraphic({
          kind: "arc3",
          start: startPoint,
          mid: midPoint,
          end: point,
          strokeWidthMm: 0.15,
        });
      }
    },

    onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (midPoint) {
          event.preventDefault();
          midPoint = null;
          if (startPoint) {
            useSymbolEditorStore.getState().setPreviewGraphic({
              kind: "line",
              a: startPoint,
              b: startPoint,
              strokeWidthMm: 0.15,
            });
          }
        } else if (startPoint) {
          event.preventDefault();
          startPoint = null;
          useSymbolEditorStore.getState().setPreviewGraphic(null);
        }
      }
    },
  };
}
