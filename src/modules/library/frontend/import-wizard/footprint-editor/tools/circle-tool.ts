import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type { PointMm } from "../../../../../../shared/rendering/types";
import { eventToMm } from "../../../../../../shared/frontend/canvas/tools/tool-utils";
import type { FootprintEditorTool } from "../types";
import { isCopperLayer } from "../types";
import { useFootprintEditorStore } from "../useFootprintEditorStore";

export function createCircleTool(): FootprintEditorTool {
  let center: PointMm | null = null;

  return {
    id: "circle",
    cursor: "crosshair",

    onActivate() {
      center = null;
    },

    onDeactivate() {
      center = null;
      useFootprintEditorStore.getState().setPreviewGraphic(null);
    },

    onPointerDown(event: InteractionEvent) {
      const store = useFootprintEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);

      if (!center) {
        center = point;
        return;
      }

      const radius = Math.sqrt(
        (point.x - center.x) ** 2 + (point.y - center.y) ** 2,
      );
      if (radius > 0) {
        // On copper, a circle becomes a (round) pad by default; the ⌘/Ctrl
        // modifier flips to a filled copper graphic instead.
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
            shape: "circle",
            centerMm: center,
            widthMm: radius * 2,
            heightMm: radius * 2,
            rotationDeg: 0,
            layer: store.activeLayer,
          });
        } else {
          store.addGraphic(
            {
              kind: "circle",
              center,
              radiusMm: radius,
              fill: isCopper ? "solid" : "none",
              strokeWidthMm: 0.15,
            },
            store.activeLayer,
          );
        }
      }
      store.setPreviewGraphic(null);
      center = null;
    },

    onPointerMove(event: InteractionEvent) {
      if (!center) return;
      const store = useFootprintEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);
      const radius = Math.sqrt(
        (point.x - center.x) ** 2 + (point.y - center.y) ** 2,
      );
      store.setPreviewGraphic({
        kind: "circle",
        center,
        radiusMm: radius,
        fill: isCopperLayer(store.activeLayer) ? "solid" : "none",
        strokeWidthMm: 0.15,
      });
    },

    onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && center) {
        event.preventDefault();
        center = null;
        useFootprintEditorStore.getState().setPreviewGraphic(null);
      }
    },
  };
}
