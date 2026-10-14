import { useEffect, useRef } from "react";
import { isKeyEventConsumed } from "./shortcut-guard";

/*
 * Innermost-wins Escape for hand-rolled overlays (dialogs, popups, choosers)
 * that are not kit Radix Dialogs. One window keydown listener serves a stack:
 * only the most recently opened layer closes, so nested overlays unwind one
 * Escape at a time.
 *
 * The listener sits on `window` in the bubble phase on purpose. Field-level
 * handlers (a dirty NumberInput reverting, a mention list closing) and Radix
 * layers (kit Dialog, DropdownMenu — document capture) run first and
 * `preventDefault` the Escape they consume, which `isKeyEventConsumed` honours
 * along with IME composition and auto-repeat.
 */

interface EscapeLayer {
  onEscape(event: KeyboardEvent): void;
  opener: HTMLElement | null;
  restoreFocus: boolean;
}

const layers: EscapeLayer[] = [];

function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  const top = layers[layers.length - 1];
  if (!top || isKeyEventConsumed(event)) return;
  event.preventDefault();
  top.onEscape(event);
}

function focusedElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body
    ? active
    : null;
}

/** Focus went nowhere (removed with the overlay) — safe to hand it back. */
function isFocusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

function restore(layer: EscapeLayer): void {
  const { opener } = layer;
  if (!layer.restoreFocus || !opener?.isConnected || !isFocusLost()) return;
  opener.focus({ preventScroll: true });
}

export interface EscapeLayerOptions {
  /** Return focus to the element focused when the layer opened. Default true. */
  restoreFocus?: boolean;
}

/**
 * Push an Escape layer; returns its release. The opener is the element
 * focused at push time — push before the overlay moves focus inside itself.
 */
export function pushEscapeLayer(
  onEscape: (event: KeyboardEvent) => void,
  options: EscapeLayerOptions = {},
): () => void {
  const layer: EscapeLayer = {
    onEscape,
    opener: focusedElement(),
    restoreFocus: options.restoreFocus ?? true,
  };
  if (layers.length === 0) window.addEventListener("keydown", onWindowKeyDown);
  layers.push(layer);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = layers.indexOf(layer);
    if (index >= 0) layers.splice(index, 1);
    if (layers.length === 0)
      window.removeEventListener("keydown", onWindowKeyDown);
    restore(layer);
  };
}

export interface UseEscapeLayerOptions extends EscapeLayerOptions {
  /** Default true. Opening (false → true) pushes a fresh layer on top. */
  enabled?: boolean;
}

/**
 * Close-on-Escape for an overlay, stacked innermost-first. Call it before any
 * effect that moves focus into the overlay so the opener is recorded.
 */
export function useEscapeLayer(
  onEscape: (event: KeyboardEvent) => void,
  options: UseEscapeLayerOptions = {},
): void {
  const { enabled = true, restoreFocus = true } = options;
  const handlerRef = useRef(onEscape);
  useEffect(() => {
    handlerRef.current = onEscape;
  });
  useEffect(() => {
    if (!enabled) return;
    return pushEscapeLayer((event) => handlerRef.current(event), {
      restoreFocus,
    });
  }, [enabled, restoreFocus]);
}
