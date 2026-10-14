import { useEffect, useRef, type RefObject } from "react";
import { useContextMenuStore } from "../context-menu";

const NO_CONTROLS: readonly HTMLElement[] = [];

function ownsFocus(
  surfaces: readonly HTMLElement[],
  target: EventTarget | null,
  ownerId?: string,
): boolean {
  if (surfaces.some((surface) => surface.contains(target as Node | null)))
    return true;
  if (!ownerId || !(target instanceof Element)) return false;
  return (
    target
      .closest('[role="menu"][data-shortcut-owner]')
      ?.getAttribute("data-shortcut-owner") === ownerId
  );
}

function focusCanvasRoot(root: HTMLElement, event: PointerEvent): void {
  const target = event.composedPath()[0];
  if (!(target instanceof Element) || target.tagName !== "CANVAS") return;
  // Keep the browser default focus move from stealing a newly opened menu.
  event.preventDefault();
  root.focus({ preventScroll: true });
}

function subscribeScope(
  root: HTMLElement,
  controls: readonly HTMLElement[],
  ownerId: string | undefined,
  abandon: () => void,
  releaseHeldKeys: () => void,
): () => void {
  const surfaces = [root, ...controls];
  let active = true;
  const focusCanvas = (event: PointerEvent) => focusCanvasRoot(root, event);
  const focusOut = (event: FocusEvent) => {
    if (!ownsFocus(surfaces, event.target, ownerId)) return;
    releaseHeldKeys();
    if (event.relatedTarget) {
      if (!ownsFocus(surfaces, event.relatedTarget, ownerId)) abandon();
      return;
    }
    // Portal removal restores focus during layout cleanup after a null focusout.
    queueMicrotask(() => {
      if (active && !ownsFocus(surfaces, document.activeElement, ownerId))
        abandon();
    });
  };
  const visibility = () => {
    if (document.hidden) abandon();
  };
  root.addEventListener("pointerdown", focusCanvas, true);
  document.addEventListener("focusout", focusOut);
  window.addEventListener("blur", abandon);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    active = false;
    root.removeEventListener("pointerdown", focusCanvas, true);
    document.removeEventListener("focusout", focusOut);
    window.removeEventListener("blur", abandon);
    document.removeEventListener("visibilitychange", visibility);
  };
}

interface EditorScopeOptions {
  identity?: string | null;
  ownerId?: string;
  ownedControls?: readonly HTMLElement[];
  onDeactivate(): void;
  releaseHeldKeys?(): void;
}

/** Owned controls/menus retain gestures but never acquire canvas command permission. */
export function useEditorShortcutScope(
  rootRef: RefObject<HTMLElement | null>,
  options: EditorScopeOptions,
): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const { identity, ownerId, ownedControls = NO_CONTROLS } = options;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const release = () => optionsRef.current.releaseHeldKeys?.();
    const abandon = () => {
      release();
      const menu = useContextMenuStore.getState();
      if (ownerId && menu.ownerId === ownerId) menu.closeMenu();
      optionsRef.current.onDeactivate();
    };
    const unsubscribe = subscribeScope(
      root,
      ownedControls,
      ownerId,
      abandon,
      release,
    );
    return () => {
      unsubscribe();
      abandon();
    };
  }, [rootRef, identity, ownedControls, ownerId]);
}
