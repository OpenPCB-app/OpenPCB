import { useEffect, useMemo, useRef, type RefObject } from "react";
import { isShortcutBlocked } from "../../keyboard/shortcut-guard";
import { useEditorShortcutScope } from "../../keyboard/use-editor-shortcut-scope";
import { matchesShortcut } from "../../ui/shortcut";
import type { InteractionHandler } from "../interaction/types";
import type { EditorTool } from "./types";

/*
 * In-tree replacement for the package `useToolDispatch` (T-002): its window
 * listener only skipped plain inputs, so keys typed in dialogs, menus, IMEs
 * or other panels still switched tools, deleted and undid. This dispatcher
 * routes every key through the shared shortcut guard instead.
 */

export interface UseScopedToolDispatchOptions<TId extends string> {
  /** Focusable editor root (canvas + its inline overlays). */
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly activeToolId: TId;
  /** Escape that no tool consumed returns here before it reaches parent layers. */
  readonly idleToolId: TId;
  readonly createTool: (id: TId) => EditorTool<TId>;
  /** `matchesShortcut` specs to tool ids, e.g. `{ V: "select", L: "line" }`. */
  readonly toolShortcuts: Readonly<Record<string, TId>>;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** State-dependent shortcuts; return true when the key was consumed. */
  readonly onContextualKey?: (event: KeyboardEvent) => boolean;
  readonly setActiveTool: (id: TId) => void;
}

/**
 * Keys belong to the editor while focus is inside its root, or while nothing
 * else holds focus (fresh page, focus dropped to body). Any other focused
 * control — a property field, toolbar button, menu — keeps its keys.
 */
export function isEditorKey(
  event: KeyboardEvent,
  root: HTMLElement | null,
  doc: Document = document,
): boolean {
  if (!root) return false;
  const active = doc.activeElement;
  if (active && active !== doc.body && active !== doc.documentElement) {
    if (!root.contains(active)) return false;
    return !isShortcutBlocked(event, { scopeRoot: root, doc });
  }
  return !isShortcutBlocked(event, { doc });
}

export function useScopedToolDispatch<TId extends string>(
  options: UseScopedToolDispatchOptions<TId>,
): InteractionHandler {
  const { rootRef, activeToolId, createTool } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const toolRef = useRef<EditorTool<TId>>(createTool(activeToolId));

  useEffect(() => {
    toolRef.current.onDeactivate?.();
    toolRef.current = createTool(activeToolId);
    toolRef.current.onActivate?.();
  }, [activeToolId, createTool]);

  // Focus leaving the editor (or the window) abandons the in-flight gesture.
  useEditorShortcutScope(rootRef, {
    onDeactivate: () => {
      const tool = toolRef.current;
      tool.onDeactivate?.();
      toolRef.current = optionsRef.current.createTool(tool.id);
      toolRef.current.onActivate?.();
    },
  });

  useEffect(() => {
    // Document bubble: after field/Radix handlers (defaultPrevented is
    // honoured) and before the window-level Escape layer, so a tool that
    // consumes Escape keeps a parent wizard open.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isEditorKey(event, rootRef.current)) return;
      const current = optionsRef.current;
      if (matchesShortcut(event, "Mod+Z")) {
        event.preventDefault();
        current.onUndo();
        return;
      }
      if (
        matchesShortcut(event, "Mod+Shift+Z") ||
        matchesShortcut(event, "Ctrl+Y")
      ) {
        event.preventDefault();
        current.onRedo();
        return;
      }
      if (current.onContextualKey?.(event)) return;
      for (const [spec, toolId] of Object.entries(current.toolShortcuts)) {
        if (matchesShortcut(event, spec)) {
          event.preventDefault();
          current.setActiveTool(toolId as TId);
          return;
        }
      }
      toolRef.current.onKeyDown?.(event);
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        toolRef.current.id !== current.idleToolId
      ) {
        event.preventDefault();
        current.setActiveTool(current.idleToolId);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [rootRef]);

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
