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
import { SearchCommand } from "@/screens/home/SearchCommand";

export default function Layout() {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);

  const navigateToHome = useNavigationStore((s) => s.navigateToHome);

  // Global hotkeys: keep core-only shortcuts
  useHotkeys("ctrl+1", () => navigateToHome(), {
    enableOnFormTags: true,
    preventDefault: true,
  });
  useHotkeys("meta+1", () => navigateToHome(), {
    enableOnFormTags: true,
    preventDefault: true,
  });
  useHotkeys("ctrl+k", () => setSearchOpen(true), {
    enableOnFormTags: true,
    enableOnContentEditable: true,
    preventDefault: true,
  });
  useHotkeys("meta+k", () => setSearchOpen(true), {
    enableOnFormTags: true,
    enableOnContentEditable: true,
    preventDefault: true,
  });
  useHotkeys("ctrl+,", () => setSettingsOpen(true), {
    enableOnFormTags: true,
    enableOnContentEditable: true,
    preventDefault: true,
  });

  return (
    <>
      <div className="grid h-screen grid-cols-[80px_1fr] grid-rows-[1fr]">
        {/* Left icon rail */}
        <LeftSidebar onSettingsClick={() => setSettingsOpen(true)} />

        {/* Main content — no top bar, each view owns its header */}
        <main className="col-start-2 row-start-1 min-h-0 overflow-hidden border-l border-border-subtle bg-bg-primary">
          <ScreenRouter />
        </main>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} />
      <ReconnectionOverlay />
      <Toaster />
      <UpdateChecker />
      <UpdateDialog />
    </>
  );
}
