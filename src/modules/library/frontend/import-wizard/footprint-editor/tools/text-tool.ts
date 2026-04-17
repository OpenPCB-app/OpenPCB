import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import { eventToMm } from "../../../../../../shared/frontend/canvas/tools/tool-utils";
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
      const point = eventToMm(event, store.gridSizeMm, store.gridVisible);
      store.beginTextEdit(
        null,
        point,
        event.screenPoint.x,
        event.screenPoint.y,
        "",
      );
    },

    onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        useFootprintEditorStore.getState().cancelTextEdit();
      }
    },
  };
}
