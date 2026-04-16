import { useEffect, useMemo, useRef } from "react";
import type { InteractionHandler } from "../../../../../shared/frontend/canvas/interaction/types";
import {
  isUndoShortcut,
  isRedoShortcut,
  isEditableShortcutTarget,
  matchesKey,
} from "../../../../../shared/frontend/canvas/utils/keyboard-shortcuts";
import type { EditorTool, EditorToolId } from "./types";
import { useSymbolEditorStore } from "./useSymbolEditorStore";
import { rotateSelection } from "./actions";
import {
  createSelectTool,
  createLineTool,
  createRectTool,
  createCircleTool,
  createArcTool,
  createPinTool,
} from "./tools";

const TOOL_SHORTCUTS: Record<string, EditorToolId> = {
  v: "select",
  l: "line",
  r: "rect",
  c: "circle",
  a: "arc",
  p: "pin",
};

function createTool(id: EditorToolId): EditorTool {
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
  }
}

/**
 * Bridges the active EditorTool to an InteractionHandler for EdaCanvas.
 * Also handles keyboard shortcuts for tool switching and undo/redo.
 *
 * Note: No useThree here — this hook runs outside the R3F Canvas.
 * Invalidation is handled by EdaCanvas (pointer events) and React re-renders
 * triggered by Zustand store changes (keyboard actions).
 */
export function useEditorToolHandler(): InteractionHandler {
  const activeTool = useSymbolEditorStore((s) => s.activeTool);
  const toolRef = useRef<EditorTool>(createTool(activeTool));

  // Switch tool when activeTool changes
  useEffect(() => {
    toolRef.current.onDeactivate?.();
    toolRef.current = createTool(activeTool);
    toolRef.current.onActivate?.();
  }, [activeTool]);

  // Global keyboard handler
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) return;

      if (isUndoShortcut(event)) {
        event.preventDefault();
        useSymbolEditorStore.getState().undo();
        return;
      }
      if (isRedoShortcut(event)) {
        event.preventDefault();
        useSymbolEditorStore.getState().redo();
        return;
      }

      // Contextual rotation: R / Shift+R while Select tool has a selection
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
          return;
        }
      }

      for (const [key, toolId] of Object.entries(TOOL_SHORTCUTS)) {
        if (matchesKey(event, key) && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          useSymbolEditorStore.getState().setActiveTool(toolId);
          return;
        }
      }

      toolRef.current.onKeyDown?.(event);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return useMemo<InteractionHandler>(
    () => ({
      onPointerDown(event) {
        toolRef.current.onPointerDown?.(event);
      },
      onPointerMove(event) {
        toolRef.current.onPointerMove?.(event);
      },
      onPointerUp(event) {
        toolRef.current.onPointerUp?.(event);
      },
    }),
    [],
  );
}
