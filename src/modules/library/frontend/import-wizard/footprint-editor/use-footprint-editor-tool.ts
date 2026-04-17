import { useCallback } from "react";
import type { InteractionHandler } from "../../../../../shared/frontend/canvas/interaction/types";
import { matchesKey } from "../../../../../shared/frontend/canvas/utils/keyboard-shortcuts";
import { useToolDispatch } from "../../../../../shared/frontend/canvas/tools/use-tool-dispatch";
import { rotateSelection } from "./actions";
import { useFootprintEditorStore } from "./useFootprintEditorStore";
import type { FootprintEditorTool, FootprintEditorToolId } from "./types";
import {
  createArcTool,
  createCircleTool,
  createLineTool,
  createPadTool,
  createRectTool,
  createSelectTool,
  createTextTool,
} from "./tools";

const TOOL_SHORTCUTS: Record<string, FootprintEditorToolId> = {
  v: "select",
  l: "line",
  r: "rect",
  c: "circle",
  a: "arc",
  d: "pad",
  t: "text",
};

function createFootprintEditorTool(
  id: FootprintEditorToolId,
): FootprintEditorTool {
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
    case "pad":
      return createPadTool();
    case "text":
      return createTextTool();
  }
}

export function useFootprintEditorToolHandler(): InteractionHandler {
  const activeTool = useFootprintEditorStore((s) => s.activeTool);

  const onUndo = useCallback(
    () => useFootprintEditorStore.getState().undo(),
    [],
  );
  const onRedo = useCallback(
    () => useFootprintEditorStore.getState().redo(),
    [],
  );
  const setActiveTool = useCallback(
    (id: FootprintEditorToolId) =>
      useFootprintEditorStore.getState().setActiveTool(id),
    [],
  );

  const onContextualKey = useCallback((event: KeyboardEvent): boolean => {
    // Clipboard + select-all: Cmd/Ctrl+A/C/V/D
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      if (matchesKey(event, "a") && !event.shiftKey) {
        event.preventDefault();
        useFootprintEditorStore.getState().selectAll();
        return true;
      }
      if (matchesKey(event, "c") && !event.shiftKey) {
        event.preventDefault();
        useFootprintEditorStore.getState().copySelection();
        return true;
      }
      if (matchesKey(event, "v") && !event.shiftKey) {
        event.preventDefault();
        useFootprintEditorStore.getState().paste();
        return true;
      }
      if (matchesKey(event, "d") && !event.shiftKey) {
        event.preventDefault();
        useFootprintEditorStore.getState().duplicateSelection();
        return true;
      }
    }

    // Contextual R / Shift+R = rotate selection
    if (
      matchesKey(event, "r") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const state = useFootprintEditorStore.getState();
      if (state.activeTool === "select" && state.selectedIds.size > 0) {
        event.preventDefault();
        rotateSelection(event.shiftKey ? -90 : 90);
        return true;
      }
    }
    return false;
  }, []);

  return useToolDispatch<FootprintEditorToolId>({
    activeToolId: activeTool,
    createTool: createFootprintEditorTool,
    toolShortcuts: TOOL_SHORTCUTS,
    onUndo,
    onRedo,
    onContextualKey,
    setActiveTool,
  });
}
