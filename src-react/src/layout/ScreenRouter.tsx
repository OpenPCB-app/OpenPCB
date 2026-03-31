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

export function ScreenRouter() {
  const currentScreen = useNavigationStore((s) => s.currentScreen);

  useEffect(() => {
    initializeNavigationFromHash();
    return setupHashChangeListener();
  }, []);

  switch (currentScreen) {
    case "home":
      return <HomeScreen />;
    case "design":
      return <DesignScreen />;
    case "notes":
      return <NotesScreen />;
    case "chat":
      return <ChatScreen />;
    case "library":
      return <LibraryScreen />;
    default:
      return <HomeScreen />;
  }
}
