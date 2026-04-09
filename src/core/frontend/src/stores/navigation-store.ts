import { create } from "zustand";
import type { AppRoute } from "../../../contracts/app/routes";

interface NavigationState {
  currentRoute: AppRoute;
  navigateHome: () => void;
  navigateToModule: (moduleId: string) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  currentRoute: { kind: "home" },
  navigateHome: () => set({ currentRoute: { kind: "home" } }),
  navigateToModule: (moduleId) =>
    set({ currentRoute: { kind: "module", moduleId } }),
}));
