import { useEffect } from "react";
import { useNavigationStore } from "../../stores/navigation-store";

/**
 * App-shell-level settings shortcuts. Register exactly once.
 * - Cmd/Ctrl + ,  → open settings from anywhere
 * - Esc           → close settings, but only while on the settings screen
 *                   (so it never steals Esc from the canvas/editor)
 */
export function useSettingsHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hasModifier = event.metaKey || event.ctrlKey;

      if (event.key === "," && hasModifier) {
        event.preventDefault();
        useNavigationStore.getState().openSettings();
        return;
      }

      if (event.key === "Escape") {
        const { currentRoute, closeSettings } = useNavigationStore.getState();
        if (currentRoute.kind === "settings") {
          event.preventDefault();
          closeSettings();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
