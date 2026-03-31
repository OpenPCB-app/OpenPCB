import { create } from "zustand";

export type Screen = "home" | "design" | "notes" | "chat" | "library";
export type DesignTab = "schematic" | "pcb" | "3d" | "bom";

interface NavigationState {
  currentScreen: Screen;
  chatId: string | null;
  currentProjectId: string | null;
  currentNotePageId: string | null;
  previousScreen: Screen | null;
  designTab: DesignTab;
  sidebarCollapsed: boolean;

  setScreen: (screen: Screen) => void;
  navigateToHome: () => void;
  navigateToDesign: (projectId?: string | null) => void;
  navigateToNotes: (pageId?: string | null) => void;
  navigateToChat: (chatId: string | null) => void;
  navigateToNewChat: () => void;
  navigateToLibrary: () => void;
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

function updateUrlHash(screen: Screen, id?: string | null): void {
  let hash = "";
  switch (screen) {
    case "design":
      hash = id ? `#design-${id}` : "#design";
      break;
    case "notes":
      hash = id ? `#notes-${id}` : "#notes";
      break;
    case "chat":
      hash = id ? `#chat-${id}` : "#chat";
      break;
    case "library":
      hash = "#library";
      break;
    case "home":
    default:
      // Clear hash for home
      history.pushState(
        "",
        document.title,
        window.location.pathname + window.location.search,
      );
      return;
  }
  window.location.hash = hash;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  currentScreen: "home",
  chatId: null,
  currentProjectId: null,
  currentNotePageId: null,
  previousScreen: null,
  designTab: "schematic",
  sidebarCollapsed: getPersistedSidebarState(),

  setScreen: (screen) => set({ currentScreen: screen }),

  navigateToHome: () => {
    set({
      currentScreen: "home",
      chatId: null,
      currentProjectId: null,
    });
    updateUrlHash("home");
  },

  navigateToDesign: (projectId) => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "design",
      currentProjectId: projectId ?? get().currentProjectId,
      chatId: null,
    });
    updateUrlHash("design", projectId ?? get().currentProjectId);
  },

  navigateToNotes: (pageId) => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "notes",
      currentNotePageId: pageId ?? get().currentNotePageId,
      chatId: null,
    });
    updateUrlHash("notes", pageId);
  },

  navigateToChat: (chatId) => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "chat",
      chatId,
    });
    updateUrlHash("chat", chatId);
  },

  navigateToNewChat: () => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "chat",
      chatId: null,
    });
    updateUrlHash("chat");
  },

  navigateToLibrary: () => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "library",
      chatId: null,
    });
    updateUrlHash("library");
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

  const hash = window.location.hash;
  if (hash.startsWith("#chat-")) {
    const chatId = hash.substring(6);
    useNavigationStore.getState().navigateToChat(chatId);
  } else if (hash.startsWith("#chat")) {
    useNavigationStore.getState().navigateToNewChat();
  } else if (hash.startsWith("#design-")) {
    const projectId = hash.substring(8);
    useNavigationStore.getState().navigateToDesign(projectId);
  } else if (hash === "#design") {
    useNavigationStore.getState().navigateToDesign();
  } else if (hash.startsWith("#notes-")) {
    const pageId = hash.substring(7);
    useNavigationStore.getState().navigateToNotes(pageId);
  } else if (hash === "#notes") {
    useNavigationStore.getState().navigateToNotes();
  } else if (hash === "#library") {
    useNavigationStore.getState().navigateToLibrary();
  }
}

export function setupHashChangeListener(): () => void {
  const handleHashChange = () => {
    const hash = window.location.hash;
    const state = useNavigationStore.getState();

    if (hash.startsWith("#chat-")) {
      const chatId = hash.substring(6);
      if (chatId !== state.chatId) {
        useNavigationStore.setState({
          currentScreen: "chat",
          chatId,
        });
      }
    } else if (hash === "#chat") {
      if (state.currentScreen !== "chat") {
        useNavigationStore.setState({
          currentScreen: "chat",
          chatId: null,
        });
      }
    } else if (hash.startsWith("#design-")) {
      const projectId = hash.substring(8);
      if (
        state.currentScreen !== "design" ||
        projectId !== state.currentProjectId
      ) {
        useNavigationStore.setState({
          currentScreen: "design",
          currentProjectId: projectId,
        });
      }
    } else if (hash === "#design") {
      if (state.currentScreen !== "design") {
        useNavigationStore.setState({ currentScreen: "design" });
      }
    } else if (hash.startsWith("#notes-")) {
      const pageId = hash.substring(7);
      if (
        state.currentScreen !== "notes" ||
        pageId !== state.currentNotePageId
      ) {
        useNavigationStore.setState({
          currentScreen: "notes",
          currentNotePageId: pageId,
        });
      }
    } else if (hash === "#notes") {
      if (state.currentScreen !== "notes") {
        useNavigationStore.setState({ currentScreen: "notes" });
      }
    } else if (hash === "#library") {
      if (state.currentScreen !== "library") {
        useNavigationStore.setState({ currentScreen: "library" });
      }
    }
  };

  window.addEventListener("hashchange", handleHashChange);
  return () => window.removeEventListener("hashchange", handleHashChange);
}
