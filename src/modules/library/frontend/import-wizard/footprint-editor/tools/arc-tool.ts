import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type { PointMm } from "../../../../../../shared/rendering/types";
import { eventToMm } from "../../../../../../shared/frontend/canvas/tools/tool-utils";
import type { FootprintEditorTool } from "../types";
import { useFootprintEditorStore } from "../useFootprintEditorStore";

export function createArcTool(): FootprintEditorTool {
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
      useFootprintEditorStore.getState().setPreviewGraphic(null);
    },

    onPointerDown(event: InteractionEvent) {
      const store = useFootprintEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);

      if (!startPoint) {
        startPoint = point;
        return;
      }
      if (!midPoint) {
        midPoint = point;
        return;
      }

      store.pushSnapshot();
      store.addGraphic(
        {
          kind: "arc3",
          start: startPoint,
          mid: midPoint,
          end: point,
          strokeWidthMm: 0.15,
        },
        store.activeLayer,
      );
      store.setPreviewGraphic(null);
      startPoint = null;
      midPoint = null;
    },

    onPointerMove(event: InteractionEvent) {
      if (!startPoint) return;
      const store = useFootprintEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);

      if (!midPoint) {
        store.setPreviewGraphic({
          kind: "line",
          a: startPoint,
          b: point,
          strokeWidthMm: 0.15,
        });
      } else {
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
            useFootprintEditorStore.getState().setPreviewGraphic({
              kind: "line",
              a: startPoint,
              b: startPoint,
              strokeWidthMm: 0.15,
            });
          }
        } else if (startPoint) {
          event.preventDefault();
          startPoint = null;
          useFootprintEditorStore.getState().setPreviewGraphic(null);
        }
      }
    },
  };
}
