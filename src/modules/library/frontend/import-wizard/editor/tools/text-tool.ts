import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import { eventToEditorMm } from "../../grid-snap";
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
      const store = useSymbolEditorStore.getState();
      if (event.key === "Escape" && store.textEditor) {
        event.preventDefault();
        store.cancelTextEdit();
      }
    },
  };
}
