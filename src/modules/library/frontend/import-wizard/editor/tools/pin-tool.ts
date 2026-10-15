import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type { EditorTool } from "../types";
import { useSymbolEditorStore } from "../useSymbolEditorStore";
import { eventToEditorMm } from "../../grid-snap";

/**
 * Pin tool — click to place a pin at the snapped location.
 * Auto-generates sequential pin numbers. Name defaults to the pin number.
 * Rotation defaults to 180° (pin pointing left, body-end on right).
 */
export function createPinTool(): EditorTool {
  let pinCounter = 1;

  return {
    id: "pin",
    cursor: "crosshair",

    onActivate() {
      // Count existing pins to set starting number
      const state = useSymbolEditorStore.getState();
      pinCounter = state.pins.length + 1;
    },

    onDeactivate() {
      useSymbolEditorStore.getState().setPreviewGraphic(null);
    },

    onPointerDown(event: InteractionEvent) {
      const store = useSymbolEditorStore.getState();
      const point = eventToEditorMm(event, store);
      const defaults = store.pinDefaults;

      store.pushSnapshot();
      store.addPin({
        name: String(pinCounter),
        number: String(pinCounter),
        electricalType: defaults.electricalType,
        positionMm: point,
        lengthMm: defaults.lengthMm,
        rotationDeg: defaults.rotationDeg,
      });
      pinCounter++;
    },

    onPointerMove(event: InteractionEvent) {
      const store = useSymbolEditorStore.getState();
      const point = eventToEditorMm(event, store);

      // Show a preview dot at the cursor position
      store.setPreviewGraphic({
        kind: "circle",
        center: point,
        radiusMm: 0.2,
        fill: "solid",
        strokeWidthMm: 0,
      });
    },

    onKeyDown(event: KeyboardEvent) {
      // The hover preview is not a gesture: leave Escape unconsumed so the
      // dispatcher returns to the Select tool.
      if (event.key === "Escape") {
        useSymbolEditorStore.getState().setPreviewGraphic(null);
      }
    },
  };
}
