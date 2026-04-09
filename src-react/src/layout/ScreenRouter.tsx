import { useEffect } from "react";
import {
  useNavigationStore,
  initializeNavigationFromHash,
  setupHashChangeListener,
} from "@/stores/navigation-store";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { HomeScreen } from "@/screens/HomeScreen";
import { ModuleSpace } from "@/modules/ModuleSpace";
import { getSpaceModules } from "@shared/generated/modules";

function resolveModuleId(screen: string, currentModuleId: string | null): string | null {
  return screen === "module" ? currentModuleId : null;
}

function ModuleUnavailable({ moduleId }: { moduleId: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="max-w-lg rounded-lg border border-border-default bg-bg-input p-6 text-center">
        <h2 className="text-lg font-medium text-text-primary">Module unavailable</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Route targets "{moduleId}", but module is not loaded.
        </p>
      </div>
    </div>
  );
}

export function ScreenRouter() {
  const currentScreen = useNavigationStore((s) => s.currentScreen);
  const currentModuleId = useNavigationStore((s) => s.currentModuleId);
  const { loadedModules } = useBackendURL();
  const knownSpaceModuleIds = getSpaceModules().map((m) => m.id);

  useEffect(() => {
    initializeNavigationFromHash();
    return setupHashChangeListener();
  }, []);

  const moduleId = resolveModuleId(currentScreen, currentModuleId);
  const isKnownModule = moduleId ? knownSpaceModuleIds.includes(moduleId) : false;
  const isLoadedModule = moduleId ? loadedModules.includes(moduleId) : false;
  const showModule = Boolean(moduleId && isKnownModule);

  if (showModule) {
    if (!isLoadedModule && moduleId) {
      return <ModuleUnavailable moduleId={moduleId} />;
    }
    if (moduleId) {
      return <ModuleSpace moduleId={moduleId} />;
    }
  }

  return <HomeScreen />;
}
