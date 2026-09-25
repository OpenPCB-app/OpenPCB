import { useEffect, useRef } from "react";
import { matchesShortcut } from "../ui/shortcut";
import { isShortcutBlocked } from "./shortcut-guard";

export interface GlobalShortcutOptions {
  /** Default true. */
  enabled?: boolean;
  /** Fire while typing in a field (modals/menus still block). Default false. */
  allowInEditable?: boolean;
}

/**
 * Window keydown shortcut behind `isShortcutBlocked`. `spec` uses the
 * `formatShortcut` syntax (`"N"`, `"Mod+K"`, `"Escape"`); pass several to
 * bind aliases. The handler may return `false` to decline the key (then
 * `preventDefault` is skipped and other listeners can take it).
 */
export function useGlobalShortcut(
  spec: string | readonly string[],
  handler: (event: KeyboardEvent) => void | boolean,
  options: GlobalShortcutOptions = {},
): void {
  const { enabled = true, allowInEditable = false } = options;
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  const specs = typeof spec === "string" ? [spec] : spec;
  const specKey = specs.join("\u0000");

  useEffect(() => {
    if (!enabled) return;
    const bound = specKey.split("\u0000").filter((s) => s.length > 0);
    if (bound.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!bound.some((s) => matchesShortcut(event, s))) return;
      if (isShortcutBlocked(event, { allowInEditable })) return;
      if (handlerRef.current(event) === false) return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, allowInEditable, specKey]);
}
