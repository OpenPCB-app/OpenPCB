import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type { PointMm } from "../../../../../../shared/rendering/types";
import { eventToMm } from "../../../../../../shared/frontend/canvas/tools/tool-utils";
import type { FootprintEditorTool } from "../types";
import { isCopperLayer } from "../types";
import { useFootprintEditorStore } from "../useFootprintEditorStore";

export function createRectTool(): FootprintEditorTool {
  let startPoint: PointMm | null = null;

  return {
    id: "rect",
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
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);

      if (!startPoint) {
        startPoint = point;
        return;
      }

      const x = Math.min(startPoint.x, point.x);
      const y = Math.min(startPoint.y, point.y);
      const width = Math.abs(point.x - startPoint.x);
      const height = Math.abs(point.y - startPoint.y);

      if (width > 0 && height > 0) {
        // On copper, a rectangle becomes a pad by default; the ⌘/Ctrl modifier
        // (or the sidebar toggle) flips to a filled copper graphic instead.
        const isCopper = isCopperLayer(store.activeLayer);
        const modifier = event.modifiers.meta || event.modifiers.ctrl;
        const makePad =
          isCopper &&
          (modifier
            ? store.copperDrawMode === "graphic"
            : store.copperDrawMode === "pad");

        store.pushSnapshot();
        if (makePad) {
          store.addPad({
            number: store.nextPadNumber(),
            shape: "rect",
            centerMm: { x: x + width / 2, y: y + height / 2 },
            widthMm: width,
            heightMm: height,
            rotationDeg: 0,
            layer: store.activeLayer,
          });
        } else {
          store.addGraphic(
            {
              kind: "rect",
              x,
              y,
              width,
              height,
              fill: isCopper ? "solid" : "none",
              strokeWidthMm: 0.15,
            },
            store.activeLayer,
          );
        }
      }
      store.setPreviewGraphic(null);
      startPoint = null;
    },

    onPointerMove(event: InteractionEvent) {
      if (!startPoint) return;
      const store = useFootprintEditorStore.getState();
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
        fill: isCopperLayer(store.activeLayer) ? "solid" : "none",
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
