import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type { PointMm } from "../../../../../../shared/rendering/types";
import type { EditorTool } from "../types";
import { useSymbolEditorStore } from "../useSymbolEditorStore";
import { eventToMm } from "../../../../../../shared/frontend/canvas/tools/tool-utils";

export function createCircleTool(): EditorTool {
  let center: PointMm | null = null;

  return {
    id: "circle",
    cursor: "crosshair",

    onActivate() {
      center = null;
    },

    onDeactivate() {
      center = null;
      useSymbolEditorStore.getState().setPreviewGraphic(null);
    },

    onPointerDown(event: InteractionEvent) {
      const store = useSymbolEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);

      if (!center) {
        center = point;
        return;
      }

      const radius = Math.sqrt(
        (point.x - center.x) ** 2 + (point.y - center.y) ** 2,
      );
      if (radius > 0) {
        store.pushSnapshot();
        store.addGraphic({
          kind: "circle",
          center,
          radiusMm: radius,
          fill: "none",
          strokeWidthMm: 0.15,
        });
      }
      store.setPreviewGraphic(null);
      center = null;
    },

    onPointerMove(event: InteractionEvent) {
      if (!center) return;
      const store = useSymbolEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);

      const radius = Math.sqrt(
        (point.x - center.x) ** 2 + (point.y - center.y) ** 2,
      );
      store.setPreviewGraphic({
        kind: "circle",
        center,
        radiusMm: radius,
        fill: "none",
        strokeWidthMm: 0.15,
      });
    },

    onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && center) {
        event.preventDefault();
        center = null;
        useSymbolEditorStore.getState().setPreviewGraphic(null);
      }
    },
  };
}
