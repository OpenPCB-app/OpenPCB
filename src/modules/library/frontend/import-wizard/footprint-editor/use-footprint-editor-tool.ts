import { useCallback, type RefObject } from "react";
import type { InteractionHandler } from "../../../../../shared/frontend/canvas/interaction/types";
import { useScopedToolDispatch } from "../../../../../shared/frontend/canvas/tools/use-scoped-tool-dispatch";
import { matchesShortcut } from "../../../../../shared/frontend/ui/shortcut";
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
  V: "select",
  L: "line",
  R: "rect",
  C: "circle",
  A: "arc",
  D: "pad",
  T: "text",
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

export function useFootprintEditorToolHandler(
  rootRef: RefObject<HTMLElement | null>,
): InteractionHandler {
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
    const state = useFootprintEditorStore.getState();
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

  return useScopedToolDispatch<FootprintEditorToolId>({
    rootRef,
    activeToolId: activeTool,
    idleToolId: "select",
    createTool: createFootprintEditorTool,
    toolShortcuts: TOOL_SHORTCUTS,
    onUndo,
    onRedo,
    onContextualKey,
    setActiveTool,
  });
}
