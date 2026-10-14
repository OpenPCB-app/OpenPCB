import { useEffect, type RefObject } from "react";
import { isShortcutBlocked } from "@shared/frontend/keyboard/shortcut-guard";
import { matchesShortcut } from "@shared/frontend/ui/shortcut";
import { useGridPreferences, type GridEditor } from "../stores/grid-prefs";

export function handleGridShortcut(
  event: KeyboardEvent,
  root: HTMLElement | null,
  editor: GridEditor,
): void {
  if (isShortcutBlocked(event, { scopeRoot: root })) return;
  const store = useGridPreferences.getState();
  if (matchesShortcut(event, "Shift+S")) {
    event.preventDefault();
    store.toggleSnap(editor);
  } else if (
    editor === "pcb" &&
    (matchesShortcut(event, "N") || matchesShortcut(event, "Shift+N"))
  ) {
    event.preventDefault();
    store.cyclePcbPitch(event.shiftKey ? -1 : 1);
  }
}

export function useGridHotkeys(
  root: RefObject<HTMLElement | null>,
  editor: GridEditor,
): void {
  useEffect(() => {
    const element = root.current;
    const keydown = (event: KeyboardEvent) =>
      handleGridShortcut(event, element, editor);
    element?.addEventListener("keydown", keydown);
    return () => element?.removeEventListener("keydown", keydown);
  }, [root, editor]);
}
