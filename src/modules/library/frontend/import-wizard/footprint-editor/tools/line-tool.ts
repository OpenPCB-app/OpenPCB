import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type { PointMm } from "../../../../../../shared/rendering/types";
import { eventToEditorMm } from "../../grid-snap";
import type { FootprintEditorTool } from "../types";
import { useFootprintEditorStore } from "../useFootprintEditorStore";

export function createLineTool(): FootprintEditorTool {
  let startPoint: PointMm | null = null;

  return {
    id: "line",
    cursor: "crosshair",

    onActivate() {
      startPoint = null;
    },

    onDeactivate() {
      startPoint = null;
      useFootprintEditorStore.getState().setPreviewGraphic(null);
    },

    onPointerDown(event: InteractionEvent) {
      const store = useFootprintEditorStore.getState();
      const point = eventToEditorMm(event, store);

      if (!startPoint) {
        startPoint = point;
        return;
      }

      store.pushSnapshot();
      store.addGraphic(
        { kind: "line", a: startPoint, b: point, strokeWidthMm: 0.15 },
        store.activeLayer,
      );
      store.setPreviewGraphic(null);
      startPoint = null;
    },

    onPointerMove(event: InteractionEvent) {
      if (!startPoint) return;
      const store = useFootprintEditorStore.getState();
      const point = eventToEditorMm(event, store);
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
        useFootprintEditorStore.getState().setPreviewGraphic(null);
      }
    },
  };
}
