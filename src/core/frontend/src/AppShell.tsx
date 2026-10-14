import { useBootstrap } from "./providers/BootstrapProvider";
import { LeftSidebar } from "./components/LeftSidebar";
import { TitleBar } from "./components/TitleBar";
import { AppRouter } from "./AppRouter";
import { AppContextMenu } from "./components/AppContextMenu";
import { useNavigationStore } from "./stores/navigation-store";
import { useSettingsHotkeys } from "./settings/hooks/useSettingsHotkeys";
import { openContextMenu } from "@shared/frontend/context-menu";
import { ErrorBoundary } from "@shared/frontend/ui/error-boundary";
import { formatShortcut } from "@shared/frontend/ui/shortcut";
import { Recovery } from "./shell/Recovery";
import { BootstrapFailure } from "./shell/BootstrapFailure";
import { reportRenderError } from "./shell/GlobalErrors";
import { shouldOpenAppMenu } from "./shell/context-menu-policy";

function LoadingScreen() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-app text-sm text-text-secondary">
      Initializing OpenPCB...
    </div>
  );
}

export function AppShell() {
  const { status, error, retry } = useBootstrap();
  const currentRoute = useNavigationStore((state) => state.currentRoute);
  const openSettings = useNavigationStore((state) => state.openSettings);

  useSettingsHotkeys();

  if (status === "loading" || status === "idle") {
    return <LoadingScreen />;
  }

  if (status === "error") {
    return (
      <BootstrapFailure
        message={error ?? "Failed to bootstrap app"}
        onRetry={retry}
      />
    );
  }

  return (
    <>
      <div className="flex h-full w-full flex-col bg-surface-app text-text">
        <TitleBar />
        <div
          className="grid min-h-0 flex-1 grid-cols-[80px_1fr]"
          onContextMenu={(event) => {
            if (!shouldOpenAppMenu(event)) return;
            event.preventDefault();
            openContextMenu({
              scope: "app",
              position: { x: event.clientX, y: event.clientY },
              title: "OpenPCB",
              groups: [
                {
                  id: "app",
                  items: [
                    {
                      kind: "action",
                      id: "settings",
                      label: "Settings",
                      shortcut: formatShortcut("Mod+,"),
                      onSelect: () => openSettings(),
                    },
                  ],
                },
              ],
            });
          }}
        >
          <LeftSidebar onSettingsClick={() => openSettings()} />
          <main className="h-full min-h-0 min-w-0">
            <ErrorBoundary
              scope="route"
              resetKeys={[
                currentRoute.kind,
                currentRoute.kind === "module" ? currentRoute.moduleId : null,
              ]}
              onError={reportRenderError}
              fallback={(props) => <Recovery {...props} />}
            >
              <AppRouter />
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <AppContextMenu />
    </>
  );
}
