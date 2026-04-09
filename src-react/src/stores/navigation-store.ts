import { create } from "zustand";
import {
  parseHashToRoute,
  routeToHash,
  type NavigationRoute,
  type Screen,
} from "@/navigation/routes";

export type { Screen };
export type DesignTab = "schematic" | "pcb" | "3d" | "bom";

interface NavigationState {
  currentScreen: Screen;
  currentModuleId: string | null;
  chatId: string | null;
  currentProjectId: string | null;
  currentDesignId: string | null;
  currentNotePageId: string | null;
  currentComponentId: string | null;
  editComponentId: string | null;
  previousScreen: Screen | null;
  designTab: DesignTab;
  sidebarCollapsed: boolean;

  setScreen: (screen: Screen) => void;
  navigateToHome: () => void;
  navigateToProject: (projectId: string | null) => void;
  navigateToModule: (moduleId: string) => void;
  navigateToDesign: (
    projectId?: string | null,
    designId?: string | null,
  ) => void;
  navigateToNotes: (pageId?: string | null) => void;
  navigateToChat: (chatId: string | null) => void;
  navigateToNewChat: () => void;
  navigateToLibrary: () => void;
  navigateToImport: () => void;
  navigateToComponentDetail: (componentId?: string | null) => void;
  navigateToComponentEdit: (componentId: string) => void;
  clearEditComponentId: () => void;
  navigateBack: () => void;
  setDesignTab: (tab: DesignTab) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const SIDEBAR_COLLAPSED_KEY = "openpcb-sidebar-collapsed";

function getPersistedSidebarState(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function persistSidebarState(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    /* empty */
  }
}

function updateUrlHash(route: NavigationRoute): void {
  const hash = routeToHash(route);
  if (!hash) {
    history.pushState(
      "",
      document.title,
      window.location.pathname + window.location.search,
    );
    return;
  }

  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

function moduleForLegacyScreen(screen: Screen): string | null {
  switch (screen) {
    case "design":
      return "designer";
    case "notes":
      return "knowledge";
    case "chat":
      return "ai-service";
    case "library":
      return "component-library";
    default:
      return null;
  }
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  currentScreen: "home",
  currentModuleId: null,
  chatId: null,
  currentProjectId: null,
  currentDesignId: null,
  currentNotePageId: null,
  currentComponentId: null,
  editComponentId: null,
  previousScreen: null,
  designTab: "schematic",
  sidebarCollapsed: getPersistedSidebarState(),

  setScreen: (screen) => set({ currentScreen: screen }),

  navigateToHome: () => {
    set({
      currentScreen: "home",
      currentModuleId: null,
      chatId: null,
      currentProjectId: null,
      currentDesignId: null,
      currentNotePageId: null,
      currentComponentId: null,
    });
    updateUrlHash({ screen: "home" });
  },

  navigateToProject: (_projectId) => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "home",
      currentModuleId: null,
      currentProjectId: null,
      currentDesignId: null,
      chatId: null,
    });
    updateUrlHash({ screen: "home" });
  },

  navigateToModule: (moduleId) => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "module",
      currentModuleId: moduleId,
      chatId: null,
      currentNotePageId: null,
      currentComponentId: null,
    });
    updateUrlHash({ screen: "module", moduleId });
  },

  navigateToDesign: (_projectId, _designId) => {
    get().navigateToModule("designer");
  },

  navigateToNotes: (_pageId) => {
    get().navigateToModule("knowledge");
  },

  navigateToChat: (_chatId) => {
    get().navigateToModule("ai-service");
  },

  navigateToNewChat: () => {
    get().navigateToModule("ai-service");
  },

  navigateToLibrary: () => {
    get().navigateToModule("component-library");
  },

  navigateToImport: () => {
    get().navigateToHome();
  },

  navigateToComponentDetail: (_componentId) => {
    get().navigateToModule("component-library");
  },

  navigateToComponentEdit: (_componentId) => {
    get().navigateToModule("component-library");
  },

  clearEditComponentId: () => {
    set({ editComponentId: null });
  },

  navigateBack: () => {
    const previousScreen = get().previousScreen;
    if (!previousScreen) {
      get().navigateToHome();
      return;
    }

    const moduleId = moduleForLegacyScreen(previousScreen);
    if (previousScreen === "module" && get().currentModuleId) {
      get().navigateToModule(get().currentModuleId as string);
      return;
    }
    if (moduleId) {
      get().navigateToModule(moduleId);
      return;
    }

    get().navigateToHome();
  },

  setDesignTab: (tab) => set({ designTab: tab }),

  toggleSidebar: () => {
    const newState = !get().sidebarCollapsed;
    persistSidebarState(newState);
    set({ sidebarCollapsed: newState });
  },

  setSidebarCollapsed: (collapsed) => {
    persistSidebarState(collapsed);
    set({ sidebarCollapsed: collapsed });
  },
}));

export function initializeNavigationFromHash(): void {
  if (typeof window === "undefined") return;

  const route = parseHashToRoute(window.location.hash);
  if (!route) return;

  const state = useNavigationStore.getState();
  switch (route.screen) {
    case "module":
      state.navigateToModule(route.moduleId);
      break;
    case "chat":
      state.navigateToChat(route.chatId);
      break;
    case "design":
      state.navigateToDesign(route.projectId, route.designId);
      break;
    case "notes":
      state.navigateToNotes(route.pageId);
      break;
    case "library":
      state.navigateToLibrary();
      break;
    case "import":
      state.navigateToImport();
      break;
    case "component-detail":
      state.navigateToComponentDetail(route.componentId);
      break;
    case "project":
      state.navigateToProject(route.projectId);
      break;
    case "home":
    default:
      state.navigateToHome();
      break;
  }
}

export function setupHashChangeListener(): () => void {
  const handleHashChange = () => {
    const route = parseHashToRoute(window.location.hash);
    if (!route) return;

    const state = useNavigationStore.getState();

    switch (route.screen) {
      case "module":
        if (
          state.currentScreen !== "module" ||
          state.currentModuleId !== route.moduleId
        ) {
          useNavigationStore.setState({
            currentScreen: "module",
            currentModuleId: route.moduleId,
          });
        }
        break;
      case "chat":
        if (state.currentScreen !== "module" || state.currentModuleId !== "ai-service") {
          useNavigationStore.setState({
            currentScreen: "module",
            currentModuleId: "ai-service",
            chatId: route.chatId,
          });
        }
        break;
      case "design":
        if (state.currentScreen !== "module" || state.currentModuleId !== "designer") {
          useNavigationStore.setState({
            currentScreen: "module",
            currentModuleId: "designer",
          });
        }
        break;
      case "notes":
        if (state.currentScreen !== "module" || state.currentModuleId !== "knowledge") {
          useNavigationStore.setState({
            currentScreen: "module",
            currentModuleId: "knowledge",
          });
        }
        break;
      case "library":
        if (
          state.currentScreen !== "module" ||
          state.currentModuleId !== "component-library"
        ) {
          useNavigationStore.setState({
            currentScreen: "module",
            currentModuleId: "component-library",
          });
        }
        break;
      case "project":
      case "home":
      default:
        if (
          state.currentScreen !== "home" ||
          state.currentModuleId !== null ||
          state.currentProjectId !== null ||
          state.currentDesignId !== null
        ) {
          useNavigationStore.setState({
            currentScreen: "home",
            currentModuleId: null,
            currentProjectId: null,
            currentDesignId: null,
          });
        }
        break;
    }
  };

  window.addEventListener("hashchange", handleHashChange);
  return () => window.removeEventListener("hashchange", handleHashChange);
}
