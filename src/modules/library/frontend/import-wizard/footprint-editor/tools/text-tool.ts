import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import { eventToEditorMm } from "../../grid-snap";
import type { FootprintEditorTool } from "../types";
import { useFootprintEditorStore } from "../useFootprintEditorStore";

export function createTextTool(): FootprintEditorTool {
  return {
    id: "text",
    cursor: "text",

    onActivate() {
      useFootprintEditorStore.getState().cancelTextEdit();
    },

    onDeactivate() {
      useFootprintEditorStore.getState().cancelTextEdit();
    },

    onPointerDown(event: InteractionEvent) {
      const store = useFootprintEditorStore.getState();
      if (store.textEditor) return;
      const point = eventToEditorMm(event, store);
      store.beginTextEdit(
        null,
        point,
        event.screenPoint.x,
        event.screenPoint.y,
        "",
      );
    },

    onKeyDown(event: KeyboardEvent) {
      const store = useFootprintEditorStore.getState();
      if (event.key === "Escape" && store.textEditor) {
        event.preventDefault();
        store.cancelTextEdit();
      }
    },
  };
}
