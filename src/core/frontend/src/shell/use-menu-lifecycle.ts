import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { clampMenuPosition } from "./context-menu-policy";

export function useMenuPosition(
  menuRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  position: { x: number; y: number },
  content: unknown,
) {
  const [clamped, setClamped] = useState(position);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    const measure = () =>
      setClamped(
        clampMenuPosition(position, menu.getBoundingClientRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [menuRef, open, position, content]);
  return clamped;
}

export function useMenuFocus(
  menuRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  focusedIndex: number,
) {
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !menu) return;
    const previous = document.activeElement;
    menu.focus();
    return () => {
      // Keep intentional focus moves (e.g. a dialog opened by an action).
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (menu.contains(document.activeElement) ||
          document.activeElement === document.body)
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [menuRef, open]);
  useLayoutEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    items?.[focusedIndex]?.focus({ preventScroll: true });
  }, [menuRef, open, focusedIndex]);
}

export function useMenuDismiss(
  menuRef: RefObject<HTMLDivElement | null>,
  open: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      )
        return;
      close();
    };
    // Canvas menus can open during pointerdown; capture has already passed then.
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [menuRef, open, close]);
}
