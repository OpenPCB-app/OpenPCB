import { useGlobalShortcut } from "@shared/frontend/keyboard/use-global-shortcut";
import { useNavigationStore } from "../../stores/navigation-store";

/** Register once in the shell; local field and overlay handlers keep their keys. */
export function useSettingsHotkeys(): void {
  useGlobalShortcut(
    "Mod+,",
    () => useNavigationStore.getState().openSettings(),
    { allowInEditable: true },
  );
  useGlobalShortcut("Escape", () => {
    const { currentRoute, closeSettings } = useNavigationStore.getState();
    if (currentRoute.kind !== "settings") return false;
    closeSettings();
  });
}
