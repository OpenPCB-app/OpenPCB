import { useEffect } from "react";
import {
  useNavigationStore,
  initializeNavigationFromHash,
  setupHashChangeListener,
} from "@/stores/navigation-store";
import { HomeScreen } from "@/screens/HomeScreen";
import { ChatScreen } from "@/screens/ChatScreen";
import { DesignScreen } from "@/screens/DesignScreen";
import { NotesScreen } from "@/screens/NotesScreen";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { ComponentDetailPage } from "@/components/library/ComponentDetailPage";

export function ScreenRouter() {
  const currentScreen = useNavigationStore((s) => s.currentScreen);
  const currentComponentId = useNavigationStore((s) => s.currentComponentId);

  useEffect(() => {
    initializeNavigationFromHash();
    return setupHashChangeListener();
  }, []);

  switch (currentScreen) {
    case "home":
      return <HomeScreen />;
    // Projects feature is temporarily disabled - redirect to home
    case "project":
      return <HomeScreen />;
    case "design":
      return <DesignScreen />;
    case "notes":
      return <NotesScreen />;
    case "chat":
      return <ChatScreen />;
    case "library":
      return <LibraryScreen />;
    case "import":
      return <LibraryScreen />;
    case "component-detail":
      // Only show detail page for existing components (with ID)
      // New component creation uses the wizard in LibraryScreen
      if (currentComponentId) {
        return <ComponentDetailPage />;
      }
      // Redirect to library if no component ID (shouldn't happen normally)
      return <LibraryScreen />;
    default:
      return <HomeScreen />;
  }
}
