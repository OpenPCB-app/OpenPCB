import { create } from "zustand";

export type Screen = "home" | "project" | "design" | "notes" | "chat" | "library" | "import";
export type DesignTab = "schematic" | "pcb" | "3d" | "bom";

interface NavigationState {
  currentScreen: Screen;
  chatId: string | null;
  currentProjectId: string | null;
  currentDesignId: string | null;
  currentNotePageId: string | null;
  previousScreen: Screen | null;
  designTab: DesignTab;
  sidebarCollapsed: boolean;

  setScreen: (screen: Screen) => void;
  navigateToHome: () => void;
  navigateToProject: (projectId: string | null) => void;
  navigateToDesign: (projectId?: string | null, designId?: string | null) => void;
  navigateToNotes: (pageId?: string | null) => void;
  navigateToChat: (chatId: string | null) => void;
  navigateToNewChat: () => void;
  navigateToLibrary: () => void;
  navigateToImport: () => void;
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

function updateUrlHash(
  screen: Screen,
  id?: string | null,
  secondaryId?: string | null,
): void {
  let hash = "";
  switch (screen) {
    case "project":
      hash = id ? `#project-${id}` : "#project";
      break;
    case "design":
      if (secondaryId && id) {
        hash = `#design-project:${id}:${secondaryId}`;
      } else if (secondaryId) {
        hash = `#design-workspace:${secondaryId}`;
      } else if (id) {
        hash = `#design-project:${id}`;
      } else {
        hash = "#design";
      }
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
    case "import":
      hash = "#import";
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
  currentDesignId: null,
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
      currentDesignId: null,
    });
    updateUrlHash("home");
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
    updateUrlHash("home");
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
    updateUrlHash("design", nextProjectId, nextDesignId);
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

  navigateToImport: () => {
    set({
      previousScreen: get().currentScreen,
      currentScreen: "import",
      chatId: null,
    });
    updateUrlHash("import");
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
  } else if (hash.startsWith("#project-")) {
    // Projects feature is temporarily disabled - redirect to home
    useNavigationStore.getState().navigateToHome();
  } else if (hash.startsWith("#design-")) {
    if (hash.startsWith("#design-project:")) {
      const payload = hash.substring(16);
      const [projectId, designId] = payload.split(":");
      useNavigationStore.getState().navigateToDesign(projectId, designId ?? null);
    } else if (hash.startsWith("#design-workspace:")) {
      const designId = hash.substring(18);
      useNavigationStore.getState().navigateToDesign(null, designId);
    } else {
      const payload = hash.substring(8);
      const [projectId, designId] = payload.split(":");
      useNavigationStore.getState().navigateToDesign(projectId, designId ?? null);
    }
  } else if (hash === "#project") {
    useNavigationStore.getState().navigateToHome();
  } else if (hash === "#design") {
    useNavigationStore.getState().navigateToDesign(null, null);
  } else if (hash.startsWith("#notes-")) {
    const pageId = hash.substring(7);
    useNavigationStore.getState().navigateToNotes(pageId);
  } else if (hash === "#notes") {
    useNavigationStore.getState().navigateToNotes();
  } else if (hash === "#library") {
    useNavigationStore.getState().navigateToLibrary();
  } else if (hash === "#import") {
    useNavigationStore.getState().navigateToImport();
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
    } else if (hash.startsWith("#project-")) {
      // Projects feature is temporarily disabled - redirect to home
      if (state.currentScreen !== "home") {
        useNavigationStore.setState({
          currentScreen: "home",
          currentProjectId: null,
          currentDesignId: null,
        });
      }
    } else if (hash.startsWith("#design-")) {
      if (hash.startsWith("#design-project:")) {
        const payload = hash.substring(16);
        const [projectId, designId] = payload.split(":");
        if (
          state.currentScreen !== "design" ||
          projectId !== state.currentProjectId ||
          (designId ?? null) !== state.currentDesignId
        ) {
          useNavigationStore.setState({
            currentScreen: "design",
            currentProjectId: projectId,
            currentDesignId: designId ?? null,
          });
        }
      } else if (hash.startsWith("#design-workspace:")) {
        const designId = hash.substring(18);
        if (
          state.currentScreen !== "design" ||
          state.currentProjectId !== null ||
          designId !== state.currentDesignId
        ) {
          useNavigationStore.setState({
            currentScreen: "design",
            currentProjectId: null,
            currentDesignId: designId,
          });
        }
      } else {
        const payload = hash.substring(8);
        const [projectId, designId] = payload.split(":");
        if (
          state.currentScreen !== "design" ||
          projectId !== state.currentProjectId ||
          (designId ?? null) !== state.currentDesignId
        ) {
          useNavigationStore.setState({
            currentScreen: "design",
            currentProjectId: projectId,
            currentDesignId: designId ?? null,
          });
        }
      }
    } else if (hash === "#project") {
      // Projects feature is temporarily disabled - redirect to home
      if (state.currentScreen !== "home") {
        useNavigationStore.setState({ currentScreen: "home" });
      }
    } else if (hash === "#design") {
      if (
        state.currentScreen !== "design" ||
        state.currentProjectId !== null ||
        state.currentDesignId !== null
      ) {
        useNavigationStore.setState({
          currentScreen: "design",
          currentProjectId: null,
          currentDesignId: null,
        });
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
    } else if (hash === "#import") {
      if (state.currentScreen !== "import") {
        useNavigationStore.setState({ currentScreen: "import" });
      }
    }
  };

  window.addEventListener("hashchange", handleHashChange);
  return () => window.removeEventListener("hashchange", handleHashChange);
}
