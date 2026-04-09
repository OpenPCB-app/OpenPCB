import { useEffect } from "react";

export interface KeyboardShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly target: EventTarget | null;
  preventDefault(): void;
}

export interface KeyboardShortcutBinding {
  readonly matches: (event: KeyboardShortcutEvent) => boolean;
  readonly run: (event: KeyboardEvent) => void;
}

export interface KeyboardShortcutOptions {
  readonly ignoreEditableTarget?: boolean;
}

export function matchesKey(
  event: Pick<KeyboardShortcutEvent, "key">,
  key: string,
): boolean {
  return event.key.toLowerCase() === key.toLowerCase();
}

export function isDeleteShortcut(event: Pick<KeyboardShortcutEvent, "key">): boolean {
  return matchesKey(event, "Delete") || matchesKey(event, "Backspace");
}

export function isEscapeShortcut(event: Pick<KeyboardShortcutEvent, "key">): boolean {
  return matchesKey(event, "Escape");
}

export function isUndoShortcut(
  event: Pick<KeyboardShortcutEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey">,
): boolean {
  return (event.ctrlKey || event.metaKey) && matchesKey(event, "z") && !event.shiftKey;
}

export function isRedoShortcut(
  event: Pick<KeyboardShortcutEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey">,
): boolean {
  return (event.ctrlKey || event.metaKey) && matchesKey(event, "z") && event.shiftKey;
}

export function isSelectAllShortcut(
  event: Pick<KeyboardShortcutEvent, "key" | "ctrlKey" | "metaKey">,
): boolean {
  return (event.ctrlKey || event.metaKey) && matchesKey(event, "a");
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

export function useWindowKeyboardShortcuts(
  bindings: readonly KeyboardShortcutBinding[],
  options: KeyboardShortcutOptions = {},
): void {
  const { ignoreEditableTarget = false } = options;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (ignoreEditableTarget && isEditableShortcutTarget(event.target)) {
        return;
      }
      for (const binding of bindings) {
        if (binding.matches(event)) {
          binding.run(event);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [bindings, ignoreEditableTarget]);
}
