import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type { PointMm } from "../../../../../../shared/rendering/types";
import type { EditorTool } from "../types";
import { useSymbolEditorStore } from "../useSymbolEditorStore";
import { eventToMm } from "../../../../../../shared/frontend/canvas/tools/tool-utils";

export function createLineTool(): EditorTool {
  let startPoint: PointMm | null = null;

  return {
    id: "line",
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

      // Second click — commit line
      store.pushSnapshot();
      store.addGraphic({
        kind: "line",
        a: startPoint,
        b: point,
        strokeWidthMm: 0.15,
      });
      store.setPreviewGraphic(null);
      startPoint = null;
    },

    onPointerMove(event: InteractionEvent) {
      if (!startPoint) return;
      const store = useSymbolEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);

      store.setPreviewGraphic({
        kind: "line",
        a: startPoint,
        b: point,
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
