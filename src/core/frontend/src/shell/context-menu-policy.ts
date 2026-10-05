import { isEditableTarget } from "@shared/frontend/keyboard/shortcut-guard";

interface ContextEvent {
  defaultPrevented: boolean;
  target: EventTarget | null;
  nativeEvent?: { composedPath(): EventTarget[] };
}

export function shouldOpenAppMenu(event: ContextEvent): boolean {
  if (event.defaultPrevented) return false;
  if (typeof window !== "undefined" && window.getSelection()?.toString())
    return false;
  const targets = event.nativeEvent?.composedPath() ?? [event.target];
  return !targets.some((target) => {
    if (isEditableTarget(target)) return true;
    return (
      target instanceof Element &&
      Boolean(
        target.closest(
          'canvas,[role="dialog"],[role="alertdialog"],[role="menu"]',
        ),
      )
    );
  });
}

export function clampMenuPosition(
  position: { x: number; y: number },
  size: {
    width: number;
    height: number;
  },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(position.x, viewport.width - size.width - 8)),
    y: Math.max(8, Math.min(position.y, viewport.height - size.height - 8)),
  };
}
