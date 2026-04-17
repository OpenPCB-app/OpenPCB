import { useCallback } from "react";
import type { InteractionHandler } from "../../../../../shared/frontend/canvas/interaction/types";
import { matchesKey } from "../../../../../shared/frontend/canvas/utils/keyboard-shortcuts";
import { useToolDispatch } from "../../../../../shared/frontend/canvas/tools/use-tool-dispatch";
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
  v: "select",
  l: "line",
  r: "rect",
  c: "circle",
  a: "arc",
  p: "pin",
  t: "text",
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
 * and registers keyboard shortcuts. Tool dispatch + undo/redo/tool-switch are
 * handled by the shared useToolDispatch hook; contextual rotation (R/Shift+R
 * with a selection) is supplied here because it's domain-specific.
 */
export function useEditorToolHandler(): InteractionHandler {
  const activeTool = useSymbolEditorStore((s) => s.activeTool);

  const onUndo = useCallback(() => useSymbolEditorStore.getState().undo(), []);
  const onRedo = useCallback(() => useSymbolEditorStore.getState().redo(), []);
  const setActiveTool = useCallback(
    (id: EditorToolId) => useSymbolEditorStore.getState().setActiveTool(id),
    [],
  );

  const onContextualKey = useCallback((event: KeyboardEvent): boolean => {
    // Clipboard + select-all: Cmd/Ctrl+A/C/V/D
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (matchesKey(event, "a") && !event.shiftKey) {
        event.preventDefault();
        useSymbolEditorStore.getState().selectAll();
        return true;
      }
      if (matchesKey(event, "c") && !event.shiftKey) {
        event.preventDefault();
        useSymbolEditorStore.getState().copySelection();
        return true;
      }
      if (matchesKey(event, "v") && !event.shiftKey) {
        event.preventDefault();
        useSymbolEditorStore.getState().paste();
        return true;
      }
      if (matchesKey(event, "d") && !event.shiftKey) {
        event.preventDefault();
        useSymbolEditorStore.getState().duplicateSelection();
        return true;
      }
    }

    // Contextual R / Shift+R = rotate selection (only when Select tool has one).
    if (
      matchesKey(event, "r") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const state = useSymbolEditorStore.getState();
      if (state.activeTool === "select" && state.selectedIds.size > 0) {
        event.preventDefault();
        rotateSelection(event.shiftKey ? -90 : 90);
        return true;
      }
    }
    return false;
  }, []);

  return useToolDispatch<EditorToolId>({
    activeToolId: activeTool,
    createTool: createSymbolEditorTool,
    toolShortcuts: TOOL_SHORTCUTS,
    onUndo,
    onRedo,
    onContextualKey,
    setActiveTool,
  });
}
