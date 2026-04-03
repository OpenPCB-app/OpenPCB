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
    // Clear hash for home
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

export const useNavigationStore = create<NavigationState>((set, get) => ({
  currentScreen: "home",
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
      chatId: null,
      currentProjectId: null,
      currentDesignId: null,
    });
    updateUrlHash({ screen: "home" });
  },

  navigateToProject: (_projectId) => {
    // Projects feature is temporarily disabled - redirect to home
    set({
      previousScreen: get().currentScreen,
      currentScreen: "home",
      currentProjectId: null,
      currentDesignId: null,
      chatId: null,
    });
    updateUrlHash({ screen: "home" });
  },

  navigateToDesign: (projectId, designId) => {
    const nextProjectId =
      projectId === undefined ? get().currentProjectId : projectId;
    const nextDesignId =
      designId === undefined ? get().currentDesignId : designId;

    set({
      previousScreen: get().currentScreen,
      currentScreen: "design",
      currentProjectId: nextProjectId,
      currentDesignId: nextDesignId,
      chatId: null,
    });
    updateUrlHash({
      screen: "design",
      projectId: nextProjectId,
      designId: nextDesignId,
    });
  },

  navigateToNotes: (pageId) => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "notes",
      currentNotePageId: pageId ?? get().currentNotePageId,
      chatId: null,
    });
    updateUrlHash({
      screen: "notes",
      pageId: pageId ?? get().currentNotePageId,
    });
  },

  navigateToChat: (chatId) => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "chat",
      chatId,
    });
    updateUrlHash({ screen: "chat", chatId });
  },

  navigateToNewChat: () => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "chat",
      chatId: null,
    });
    updateUrlHash({ screen: "chat", chatId: null });
  },

  navigateToLibrary: () => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "library",
      chatId: null,
    });
    updateUrlHash({ screen: "library" });
  },

  navigateToImport: () => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "import",
      chatId: null,
    });
    updateUrlHash({ screen: "import" });
  },

  navigateToComponentDetail: (componentId) => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "component-detail",
      currentComponentId: componentId ?? null,
      chatId: null,
    });
    updateUrlHash({
      screen: "component-detail",
      componentId: componentId ?? null,
    });
  },

  navigateToComponentEdit: (componentId) => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "library",
      editComponentId: componentId,
      chatId: null,
    });
    updateUrlHash({ screen: "library" });
  },

  clearEditComponentId: () => {
    set({ editComponentId: null });
  },

  navigateBack: () => {
    const { previousScreen } = get();
    if (previousScreen) {
      // Navigate to the previous screen
      switch (previousScreen) {
        case "library":
          get().navigateToLibrary();
          break;
        case "home":
          get().navigateToHome();
          break;
        case "design":
          get().navigateToDesign();
          break;
        default:
          get().navigateToHome();
      }
    } else {
      get().navigateToHome();
    }
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
  if (!route) {
    return;
  }

  const state = useNavigationStore.getState();
  switch (route.screen) {
    case "chat":
      if (route.chatId) {
        state.navigateToChat(route.chatId);
      } else {
        state.navigateToNewChat();
      }
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
      if (route.componentId) {
        state.navigateToComponentDetail(route.componentId);
      } else {
        state.navigateToLibrary();
      }
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
    if (!route) {
      return;
    }

    const state = useNavigationStore.getState();

    switch (route.screen) {
      case "chat":
        if (state.currentScreen !== "chat" || state.chatId !== route.chatId) {
          useNavigationStore.setState({
            currentScreen: "chat",
            chatId: route.chatId,
          });
        }
        break;
      case "design":
        if (
          state.currentScreen !== "design" ||
          state.currentProjectId !== route.projectId ||
          state.currentDesignId !== route.designId
        ) {
          useNavigationStore.setState({
            currentScreen: "design",
            currentProjectId: route.projectId,
            currentDesignId: route.designId,
          });
        }
        break;
      case "notes":
        if (
          state.currentScreen !== "notes" ||
          state.currentNotePageId !== route.pageId
        ) {
          useNavigationStore.setState({
            currentScreen: "notes",
            currentNotePageId: route.pageId,
          });
        }
        break;
      case "library":
        if (state.currentScreen !== "library") {
          useNavigationStore.setState({ currentScreen: "library" });
        }
        break;
      case "import":
        if (state.currentScreen !== "import") {
          useNavigationStore.setState({ currentScreen: "import" });
        }
        break;
      case "component-detail":
        if (
          state.currentScreen !== "component-detail" ||
          state.currentComponentId !== route.componentId
        ) {
          useNavigationStore.setState({
            currentScreen: "component-detail",
            currentComponentId: route.componentId,
          });
        }
        break;
      case "project":
      case "home":
      default:
        if (
          state.currentScreen !== "home" ||
          state.currentProjectId !== null ||
          state.currentDesignId !== null
        ) {
          useNavigationStore.setState({
            currentScreen: "home",
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
