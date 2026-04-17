import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import {
  eventToMm,
  normalizeRotationDeg,
} from "../../../../../../shared/frontend/canvas/tools/tool-utils";
import type { FootprintEditorTool } from "../types";
import { useFootprintEditorStore } from "../useFootprintEditorStore";

export function createPadTool(): FootprintEditorTool {
  let padCounter = 1;

  return {
    id: "pad",
    cursor: "crosshair",

    onActivate() {
      const state = useFootprintEditorStore.getState();
      padCounter = state.pads.length + 1;
    },

    onDeactivate() {
      useFootprintEditorStore.getState().setPreviewGraphic(null);
    },

    onPointerDown(event: InteractionEvent) {
      const store = useFootprintEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);
      const defaults = store.padDefaults;

      // Shift+click with exactly one selected pad → symmetric mirror across Y-axis (x=0)
      if (event.modifiers.shift && store.selectedIds.size === 1) {
        const selectedId = [...store.selectedIds][0]!;
        const sourcePad = store.pads.find((p) => p.id === selectedId);
        if (sourcePad) {
          store.pushSnapshot();
          const mirroredNumber = String(padCounter);
          store.addPad({
            number: mirroredNumber,
            shape: sourcePad.shape,
            centerMm: { x: -sourcePad.centerMm.x, y: sourcePad.centerMm.y },
            widthMm: sourcePad.widthMm,
            heightMm: sourcePad.heightMm,
            rotationDeg: normalizeRotationDeg(180 - sourcePad.rotationDeg),
            roundrectRatio: sourcePad.roundrectRatio,
            drillDiameterMm: sourcePad.drillDiameterMm,
            layer: sourcePad.layer,
          });
          padCounter++;
          return;
        }
      }

      // Normal placement from pad defaults
      store.pushSnapshot();
      const layer =
        defaults.drillDiameterMm && defaults.drillDiameterMm > 0
          ? "*.Cu"
          : defaults.layer;

      store.addPad({
        number: String(padCounter),
        shape: defaults.shape,
        centerMm: point,
        widthMm: defaults.widthMm,
        heightMm:
          defaults.shape === "circle" ? defaults.widthMm : defaults.heightMm,
        rotationDeg: defaults.rotationDeg,
        roundrectRatio:
          defaults.shape === "roundrect" ? defaults.roundrectRatio : undefined,
        drillDiameterMm:
          defaults.drillDiameterMm && defaults.drillDiameterMm > 0
            ? defaults.drillDiameterMm
            : undefined,
        layer,
      });
      padCounter++;
    },

    onPointerMove(event: InteractionEvent) {
      const store = useFootprintEditorStore.getState();
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);
      // Show preview dot at cursor
      store.setPreviewGraphic({
        kind: "circle",
        center: point,
        radiusMm: 0.2,
        fill: "solid",
        strokeWidthMm: 0,
      });
    },

    onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        useFootprintEditorStore.getState().setPreviewGraphic(null);
      }
    },
  };
}
