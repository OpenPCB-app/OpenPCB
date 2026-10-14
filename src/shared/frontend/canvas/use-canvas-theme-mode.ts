import { useSyncExternalStore } from "react";
import type { CanvasThemeMode } from "./theme";

function readCanvasThemeMode(): CanvasThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.colorMode === "light"
    ? "light"
    : "dark";
}

function subscribeCanvasTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-color-mode"],
  });
  return () => observer.disconnect();
}

/** Use the shell's resolved theme without importing its React provider into modules. */
export function useCanvasThemeMode(): CanvasThemeMode {
  return useSyncExternalStore(
    subscribeCanvasTheme,
    readCanvasThemeMode,
    () => "dark",
  );
}
