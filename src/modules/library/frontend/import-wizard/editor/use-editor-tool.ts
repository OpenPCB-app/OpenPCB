import { useCallback, type RefObject } from "react";
import type { InteractionHandler } from "../../../../../shared/frontend/canvas/interaction/types";
import { useScopedToolDispatch } from "../../../../../shared/frontend/canvas/tools/use-scoped-tool-dispatch";
import { matchesShortcut } from "../../../../../shared/frontend/ui/shortcut";
import { rotateSelection } from "./actions";
import { useSymbolEditorStore } from "./useSymbolEditorStore";
import type { EditorTool, EditorToolId } from "./types";
import {
  createArcTool,
  createCircleTool,
  createLineTool,
  createPinTool,
  createRectTool,
  createSelectTool,
  createTextTool,
} from "./tools";

const TOOL_SHORTCUTS: Record<string, EditorToolId> = {
  V: "select",
  L: "line",
  R: "rect",
  C: "circle",
  A: "arc",
  P: "pin",
  T: "text",
};

function createSymbolEditorTool(id: EditorToolId): EditorTool {
  switch (id) {
    case "select":
      return createSelectTool();
    case "line":
      return createLineTool();
    case "rect":
      return createRectTool();
    case "circle":
      return createCircleTool();
    case "arc":
      return createArcTool();
    case "pin":
      return createPinTool();
    case "text":
      return createTextTool();
  }
}

/**
 * Bridges the Symbol editor's active tool to an InteractionHandler for EdaCanvas
 * and registers keyboard shortcuts scoped to `rootRef`. Tool dispatch +
 * undo/redo/tool-switch are handled by the shared useScopedToolDispatch hook;
 * contextual rotation (R/Shift+R with a selection) is supplied here because
 * it's domain-specific.
 */
export function useEditorToolHandler(
  rootRef: RefObject<HTMLElement | null>,
): InteractionHandler {
  const activeTool = useSymbolEditorStore((s) => s.activeTool);

  const onUndo = useCallback(() => useSymbolEditorStore.getState().undo(), []);
  const onRedo = useCallback(() => useSymbolEditorStore.getState().redo(), []);
  const setActiveTool = useCallback(
    (id: EditorToolId) => useSymbolEditorStore.getState().setActiveTool(id),
    [],
  );

  const onContextualKey = useCallback((event: KeyboardEvent): boolean => {
    const state = useSymbolEditorStore.getState();
    // Shift+S toggles grid snapping, as in the designer; visibility is separate.
    if (matchesShortcut(event, "Shift+S")) {
      event.preventDefault();
      state.setSnapEnabled(!state.snapEnabled);
      return true;
    }
    // Shift+G toggles Figma-style alignment guides + magnetic snap.
    if (matchesShortcut(event, "Shift+G")) {
      event.preventDefault();
      state.toggleAlignmentGuidesVisible();
      return true;
    }

    const clipboard: Record<string, () => void> = {
      "Mod+A": state.selectAll,
      "Mod+C": state.copySelection,
      "Mod+V": () => state.paste(),
      "Mod+D": state.duplicateSelection,
    };
    for (const [spec, run] of Object.entries(clipboard)) {
      if (matchesShortcut(event, spec)) {
        event.preventDefault();
        run();
        return true;
      }
    }

    // Contextual R / Shift+R = rotate selection (only when Select tool has one).
    if (matchesShortcut(event, "R") || matchesShortcut(event, "Shift+R")) {
      if (state.activeTool === "select" && state.selectedIds.size > 0) {
        event.preventDefault();
        rotateSelection(event.shiftKey ? -90 : 90);
        return true;
      }
    }
    return false;
  }, []);

  return useScopedToolDispatch<EditorToolId>({
    rootRef,
    activeToolId: activeTool,
    idleToolId: "select",
    createTool: createSymbolEditorTool,
    toolShortcuts: TOOL_SHORTCUTS,
    onUndo,
    onRedo,
    onContextualKey,
    setActiveTool,
  });
}
