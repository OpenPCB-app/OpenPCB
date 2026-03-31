import React from "react";
import LeftSidebar from "./LeftSidebar";
import { ScreenRouter } from "./ScreenRouter";
import { SettingsDialog } from "@/settings";
import { ReconnectionOverlay } from "@/components/health/ReconnectionOverlay";
import { Toaster } from "@/components/ui/toaster";
import { UpdateChecker } from "@/components/update/UpdateChecker";
import { UpdateDialog } from "@/components/update/UpdateDialog";
import { useHotkeys } from "react-hotkeys-hook";
import { useNavigationStore } from "@/stores/navigation-store";

export default function Layout() {
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const navigateToHome = useNavigationStore((s) => s.navigateToHome);
  const navigateToDesign = useNavigationStore((s) => s.navigateToDesign);
  const navigateToNotes = useNavigationStore((s) => s.navigateToNotes);
  const navigateToNewChat = useNavigationStore((s) => s.navigateToNewChat);
  const navigateToLibrary = useNavigationStore((s) => s.navigateToLibrary);

  // Global hotkeys: Ctrl+1-5 for view switching
  useHotkeys("ctrl+1", () => navigateToHome(), {
    enableOnFormTags: true,
    preventDefault: true,
  });
  useHotkeys("ctrl+2", () => navigateToDesign(), {
    enableOnFormTags: true,
    preventDefault: true,
  });
  useHotkeys("ctrl+3", () => navigateToNotes(), {
    enableOnFormTags: true,
    preventDefault: true,
  });
  useHotkeys("ctrl+4", () => navigateToNewChat(), {
    enableOnFormTags: true,
    preventDefault: true,
  });
  useHotkeys("ctrl+5", () => navigateToLibrary(), {
    enableOnFormTags: true,
    preventDefault: true,
  });
  useHotkeys("ctrl+,", () => setSettingsOpen(true), {
    enableOnFormTags: true,
    enableOnContentEditable: true,
    preventDefault: true,
  });

  return (
    <>
      <div className="grid h-screen grid-cols-[48px_1fr] grid-rows-[1fr]">
        {/* Left icon rail */}
        <LeftSidebar onSettingsClick={() => setSettingsOpen(true)} />

        {/* Main content — no top bar, each view owns its header */}
        <main className="col-start-2 row-start-1 min-h-0 overflow-hidden border-l border-border-subtle bg-bg-primary">
          <ScreenRouter />
        </main>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ReconnectionOverlay />
      <Toaster />
      <UpdateChecker />
      <UpdateDialog />
    </>
  );
}
