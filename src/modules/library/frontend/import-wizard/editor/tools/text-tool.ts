import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import { eventToMm } from "../../../../../../shared/frontend/canvas/tools/tool-utils";
import type { EditorTool } from "../types";
import { useSymbolEditorStore } from "../useSymbolEditorStore";

/**
 * Text annotation tool — click to open an inline text input at the cursor;
 * typing + Enter commits a new PreviewLabel to the editor store.
 *
 * The input itself is rendered by SymbolEditorCanvas when
 * `store.textEditor !== null`. This tool just opens that session.
 */
export function createTextTool(): EditorTool {
  return {
    id: "text",
    cursor: "text",

    onActivate() {
      useSymbolEditorStore.getState().cancelTextEdit();
    },

    onDeactivate() {
      useSymbolEditorStore.getState().cancelTextEdit();
    },

    onPointerDown(event: InteractionEvent) {
      const store = useSymbolEditorStore.getState();
      if (store.textEditor) return; // already editing — ignore
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
        useSymbolEditorStore.getState().cancelTextEdit();
      }
    },
  };
}
