import { useEffect, useState } from "react";
import { useBootstrap } from "./providers/BootstrapProvider";
import { LeftSidebar } from "./components/LeftSidebar";
import { AppRouter } from "./AppRouter";
import { SettingsDialog } from "@/settings";
import { AppContextMenu } from "./components/AppContextMenu";
import {
  openContextMenu,
  useContextMenuStore,
} from "@shared/frontend/context-menu";

function LoadingScreen() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-50 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
      Initializing OpenPCB...
    </div>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="max-w-xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        {message}
      </div>
    </div>
  );
}

export function AppShell() {
  const { status, error } = useBootstrap();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isComma = event.key === ",";
      const hasModifier = event.metaKey || event.ctrlKey;
      if (!isComma || !hasModifier) {
        return;
      }

      event.preventDefault();
      setSettingsOpen(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const suppressNativeContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    document.addEventListener("contextmenu", suppressNativeContextMenu, true);
    return () =>
      document.removeEventListener(
        "contextmenu",
        suppressNativeContextMenu,
        true,
      );
  }, []);

  if (status === "loading" || status === "idle") {
    return <LoadingScreen />;
  }

  if (status === "error") {
    return <ErrorScreen message={error ?? "Failed to bootstrap app"} />;
  }

  return (
    <>
      <div
        className="grid h-full w-full grid-cols-[80px_1fr]"
        onContextMenu={(event) => {
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
                    shortcut: "Ctrl+,",
                    onSelect: () => setSettingsOpen(true),
                  },
                ],
              },
            ],
          });
        }}
      >
        <LeftSidebar onSettingsClick={() => setSettingsOpen(true)} />
        <main className="h-full min-h-0 min-w-0">
          <AppRouter />
        </main>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AppContextMenu />
    </>
  );
}
