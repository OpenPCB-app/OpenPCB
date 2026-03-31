import {
  LayoutDashboard,
  PenTool,
  FileText,
  MessageSquare,
  Package,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useNavigationStore, type Screen } from "@/stores/navigation-store";
import { cn } from "@/lib/utils";

interface NavItem {
  screen: Screen;
  icon: LucideIcon;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { screen: "home", icon: LayoutDashboard, label: "Home" },
  { screen: "design", icon: PenTool, label: "Design" },
  { screen: "notes", icon: FileText, label: "Notes" },
  { screen: "chat", icon: MessageSquare, label: "Chat" },
  { screen: "library", icon: Package, label: "Library" },
];

interface LeftSidebarProps {
  onSettingsClick: () => void;
}

export default function LeftSidebar({ onSettingsClick }: LeftSidebarProps) {
  const currentScreen = useNavigationStore((s) => s.currentScreen);
  const navigateToHome = useNavigationStore((s) => s.navigateToHome);
  const navigateToDesign = useNavigationStore((s) => s.navigateToDesign);
  const navigateToNotes = useNavigationStore((s) => s.navigateToNotes);
  const navigateToNewChat = useNavigationStore((s) => s.navigateToNewChat);
  const navigateToLibrary = useNavigationStore((s) => s.navigateToLibrary);

  const navigate = (screen: Screen) => {
    switch (screen) {
      case "home":
        navigateToHome();
        break;
      case "design":
        navigateToDesign();
        break;
      case "notes":
        navigateToNotes();
        break;
      case "chat":
        navigateToNewChat();
        break;
      case "library":
        navigateToLibrary();
        break;
    }
  };

  return (
    <aside className="col-start-1 row-start-1 flex w-12 flex-col items-center justify-between bg-rail-bg border-r border-border-subtle">
      {/* Logo + Tauri drag region */}
      <div className="flex flex-col items-center w-full">
        <button
          data-tauri-drag-region
          className="flex h-12 w-12 items-center justify-center"
          onClick={navigateToHome}
          aria-label="OpenPCB Home"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className="text-brand"
          >
            <rect
              x="3"
              y="3"
              width="18"
              height="18"
              rx="3"
              stroke="currentColor"
              strokeWidth="2"
            />
            <circle cx="8" cy="8" r="1.5" fill="currentColor" />
            <circle cx="16" cy="8" r="1.5" fill="currentColor" />
            <circle cx="8" cy="16" r="1.5" fill="currentColor" />
            <circle cx="16" cy="16" r="1.5" fill="currentColor" />
            <line
              x1="8"
              y1="8"
              x2="16"
              y2="16"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>

        {/* Navigation items */}
        <nav className="flex flex-col items-center gap-1 mt-1">
          {NAV_ITEMS.map((item) => {
            const isActive = currentScreen === item.screen;
            return (
              <button
                key={item.screen}
                className={cn(
                  "flex flex-col items-center justify-center w-10 rounded-xl py-1.5 transition-colors",
                  isActive
                    ? "bg-rail-active text-brand"
                    : "text-icon-muted hover:bg-rail-hover hover:text-icon-default",
                )}
                aria-label={item.label}
                onClick={() => navigate(item.screen)}
              >
                <item.icon className="h-5 w-5" strokeWidth={1.5} />
                <span
                  className={cn(
                    "mt-0.5 text-[7px] leading-tight",
                    isActive ? "font-medium text-brand" : "text-text-tertiary",
                  )}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col items-center gap-1 pb-2">
        <button
          className="flex flex-col items-center justify-center w-10 rounded-xl py-1.5 text-icon-muted hover:bg-rail-hover hover:text-icon-default transition-colors"
          aria-label="Settings"
          onClick={onSettingsClick}
        >
          <Settings className="h-5 w-5" strokeWidth={1.5} />
          <span className="mt-0.5 text-[7px] leading-tight text-text-tertiary">
            Settings
          </span>
        </button>

        {/* User avatar placeholder */}
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-input text-text-secondary text-[10px] font-medium">
          U
        </div>
      </div>
    </aside>
  );
}
