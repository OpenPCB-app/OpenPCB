import { useNavigationStore } from "./stores/navigation-store";
import { HomeScreen } from "./screens/HomeScreen";
import { ModuleScreen } from "./screens/ModuleScreen";

export function AppRouter() {
  const currentRoute = useNavigationStore((state) => state.currentRoute);

  if (currentRoute.kind === "home") {
    return <HomeScreen />;
  }

  if (currentRoute.kind === "module") {
    return <ModuleScreen moduleId={currentRoute.moduleId} designId={currentRoute.designId} />;
  }

  return <HomeScreen />;
}
