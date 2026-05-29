import { create } from "zustand";
import type { AppRoute, SettingsTab } from "../../../contracts/app/routes";

interface NavigationState {
  currentRoute: AppRoute;
  // Snapshot of the screen to restore when settings closes (null while not in settings).
  returnTo: AppRoute | null;
  // Remembers the last-opened settings tab so re-opening lands where you left off.
  lastSettingsTab: SettingsTab;
  navigateHome: () => void;
  navigateToModule: (
    moduleId: string,
    designId?: string,
    params?: Record<string, string>,
  ) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setSettingsTab: (tab: SettingsTab) => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  currentRoute: { kind: "home" },
  returnTo: null,
  lastSettingsTab: "general",
  navigateHome: () => {
    if (get().currentRoute.kind === "home") return;
    set({ currentRoute: { kind: "home" } });
  },
  navigateToModule: (moduleId, designId, params) => {
    const current = get().currentRoute;
    // Always re-set when params change so consumers re-react even if module/design unchanged.
    if (
      current.kind === "module" &&
      current.moduleId === moduleId &&
      current.designId === designId &&
      !params
    ) {
      return;
    }
    set({ currentRoute: { kind: "module", moduleId, designId, params } });
  },
  openSettings: (tab) => {
    const { currentRoute, lastSettingsTab } = get();
    const nextTab = tab ?? lastSettingsTab;
    set({
      // Don't overwrite the snapshot when toggling tabs from within settings.
      returnTo:
        currentRoute.kind === "settings" ? get().returnTo : currentRoute,
      currentRoute: { kind: "settings", tab: nextTab },
      lastSettingsTab: nextTab,
    });
  },
  closeSettings: () => {
    if (get().currentRoute.kind !== "settings") return;
    set({ currentRoute: get().returnTo ?? { kind: "home" }, returnTo: null });
  },
  setSettingsTab: (tab) => {
    if (get().currentRoute.kind !== "settings") return;
    set({ currentRoute: { kind: "settings", tab }, lastSettingsTab: tab });
  },
}));
