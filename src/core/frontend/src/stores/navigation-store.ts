import { create } from "zustand";
import type { AppRoute } from "../../../contracts/app/routes";

interface NavigationState {
  currentRoute: AppRoute;
  navigateHome: () => void;
  navigateToModule: (moduleId: string, designId?: string) => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  currentRoute: { kind: "home" },
  navigateHome: () => {
    if (get().currentRoute.kind === "home") return;
    set({ currentRoute: { kind: "home" } });
  },
  navigateToModule: (moduleId, designId) => {
    const current = get().currentRoute;
    if (
      current.kind === "module" &&
      current.moduleId === moduleId &&
      current.designId === designId
    ) {
      return;
    }
    set({ currentRoute: { kind: "module", moduleId, designId } });
  },
}));
