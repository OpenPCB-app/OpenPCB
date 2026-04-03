import { useCallback, useEffect } from "react";
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
  const navigateToComponentEdit = useNavigationStore(
    (s) => s.navigateToComponentEdit,
  );

  useEffect(() => {
    initializeNavigationFromHash();
    return setupHashChangeListener();
  }, []);

  const handleEditComponent = useCallback(
    (componentId: string) => {
      navigateToComponentEdit(componentId);
    },
    [navigateToComponentEdit],
  );

  switch (currentScreen) {
    case "home":
      return <HomeScreen />;
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
      if (currentComponentId) {
        return <ComponentDetailPage onEditComponent={handleEditComponent} />;
      }
      return <LibraryScreen />;
    default:
      return <HomeScreen />;
  }
}
