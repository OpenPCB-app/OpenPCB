import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type { PointMm } from "../../../../../../shared/rendering/types";
import type { EditorTool } from "../types";
import { useSymbolEditorStore } from "../useSymbolEditorStore";
import { eventToMm } from "../../../../../../shared/frontend/canvas/tools/tool-utils";

export function createRectTool(): EditorTool {
  let startPoint: PointMm | null = null;

  return {
    id: "rect",
    cursor: "crosshair",

    onActivate() {
      startPoint = null;
    },

    onDeactivate() {
      startPoint = null;
      useSymbolEditorStore.getState().setPreviewGraphic(null);
    },

    onPointerDown(event: InteractionEvent) {
      const store = useSymbolEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);

      if (!startPoint) {
        startPoint = point;
        return;
      }

      // Second click — commit rect
      const x = Math.min(startPoint.x, point.x);
      const y = Math.min(startPoint.y, point.y);
      const width = Math.abs(point.x - startPoint.x);
      const height = Math.abs(point.y - startPoint.y);

      if (width > 0 && height > 0) {
        store.pushSnapshot();
        store.addGraphic({
          kind: "rect",
          x,
          y,
          width,
          height,
          fill: "none",
          strokeWidthMm: 0.15,
        });
      }
      store.setPreviewGraphic(null);
      startPoint = null;
    },

    onPointerMove(event: InteractionEvent) {
      if (!startPoint) return;
      const store = useSymbolEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);

      const x = Math.min(startPoint.x, point.x);
      const y = Math.min(startPoint.y, point.y);
      const width = Math.abs(point.x - startPoint.x);
      const height = Math.abs(point.y - startPoint.y);

      store.setPreviewGraphic({
        kind: "rect",
        x,
        y,
        width,
        height,
        fill: "none",
        strokeWidthMm: 0.15,
      });
    },

    onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && startPoint) {
        event.preventDefault();
        startPoint = null;
        useSymbolEditorStore.getState().setPreviewGraphic(null);
      }
    },
  };
}
