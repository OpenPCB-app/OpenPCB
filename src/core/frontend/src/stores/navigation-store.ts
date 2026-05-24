import { create } from "zustand";
import type { AppRoute } from "../../../contracts/app/routes";

interface NavigationState {
  currentRoute: AppRoute;
  navigateHome: () => void;
  navigateToModule: (
    moduleId: string,
    designId?: string,
    params?: Record<string, string>,
  ) => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  currentRoute: { kind: "home" },
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
}));
