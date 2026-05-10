import { useEffect, useMemo, useRef } from "react";
import type { InteractionHandler } from "../interaction/types";
import {
  isEditableShortcutTarget,
  isRedoShortcut,
  isUndoShortcut,
  matchesKey,
} from "../utils/keyboard-shortcuts";
import type { EditorTool } from "./types";

export interface UseToolDispatchOptions<TId extends string> {
  /** Currently-active tool id, driven by caller's store. */
  readonly activeToolId: TId;
  /** Factory that returns a fresh tool instance for the given id. */
  readonly createTool: (id: TId) => EditorTool<TId>;
  /** Single-character keyboard shortcuts to tool ids, e.g. `{ v: "select", l: "line" }`. */
  readonly toolShortcuts: Readonly<Record<string, TId>>;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /**
   * Optional handler for shortcuts that depend on editor state
   * (e.g. R rotates when a selection exists, otherwise falls through to "Rect tool").
   * Return `true` when the key was consumed.
   */
  readonly onContextualKey?: (event: KeyboardEvent) => boolean;
  readonly setActiveTool: (id: TId) => void;
}

/**
 * Bridges the active `EditorTool` to an `InteractionHandler` consumed by
 * `EdaCanvas`, and registers a window-level keyboard listener for undo/redo,
 * tool-switching, and caller-supplied contextual shortcuts.
 *
 * Listeners are registered once on mount; callback bodies read from refs so
 * updated closures (e.g. a Zustand-derived `setActiveTool`) are honoured
 * without re-registering the listener.
 */
export function useToolDispatch<TId extends string>({
  activeToolId,
  createTool,
  toolShortcuts,
  onUndo,
  onRedo,
  onContextualKey,
  setActiveTool,
}: UseToolDispatchOptions<TId>): InteractionHandler {
  const toolRef = useRef<EditorTool<TId>>(createTool(activeToolId));

  const onUndoRef = useRef(onUndo);
  const onRedoRef = useRef(onRedo);
  const onContextualKeyRef = useRef(onContextualKey);
  const setActiveToolRef = useRef(setActiveTool);
  const toolShortcutsRef = useRef(toolShortcuts);

  onUndoRef.current = onUndo;
  onRedoRef.current = onRedo;
  onContextualKeyRef.current = onContextualKey;
  setActiveToolRef.current = setActiveTool;
  toolShortcutsRef.current = toolShortcuts;

  useEffect(() => {
    toolRef.current.onDeactivate?.();
    toolRef.current = createTool(activeToolId);
    toolRef.current.onActivate?.();
  }, [activeToolId, createTool]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) return;

      if (isUndoShortcut(event)) {
        event.preventDefault();
        onUndoRef.current();
        return;
      }
      if (isRedoShortcut(event)) {
        event.preventDefault();
        onRedoRef.current();
        return;
      }

      if (onContextualKeyRef.current?.(event)) {
        return;
      }

      for (const [key, toolId] of Object.entries(toolShortcutsRef.current)) {
        if (matchesKey(event, key) && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          setActiveToolRef.current(toolId);
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
      onContextMenu(event) {
        toolRef.current.onContextMenu?.(event);
      },
    }),
    [],
  );
}
