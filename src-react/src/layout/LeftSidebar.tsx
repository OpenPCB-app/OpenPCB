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
  { screen: "library", icon: Package, label: "Library" },
  { screen: "chat", icon: MessageSquare, label: "Chat" },
  { screen: "notes", icon: FileText, label: "Notes" },
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
    <aside className="col-start-1 row-start-1 flex w-20 flex-col items-center justify-between bg-rail-bg border-r border-border-subtle">
      {/* Logo + Tauri drag region */}
      <div className="flex flex-col items-center w-full">
        <button
          className="flex h-16 w-16 items-center justify-center"
          onClick={navigateToHome}
          aria-label="OpenPCB Home"
        >
          <svg
            width="32"
            height="32"
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
        <nav className="flex flex-col items-center gap-2 mt-2">
          {NAV_ITEMS.map((item) => {
            const isActive = currentScreen === item.screen;
            return (
              <button
                key={item.screen}
                className={cn(
                  "flex flex-col items-center justify-center w-16 rounded-xl py-2 transition-colors",
                  isActive
                    ? "bg-rail-active text-brand"
                    : "text-icon-muted hover:bg-rail-hover hover:text-icon-default",
                )}
                aria-label={item.label}
                onClick={() => navigate(item.screen)}
              >
                <item.icon className="h-6 w-6" strokeWidth={1.5} />
                <span
                  className={cn(
                    "mt-1 text-xs leading-tight",
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
      <div className="flex flex-col items-center gap-2 pb-3">
        <button
          className="flex flex-col items-center justify-center w-16 rounded-xl py-2 text-icon-muted hover:bg-rail-hover hover:text-icon-default transition-colors"
          aria-label="Settings"
          onClick={onSettingsClick}
        >
          <Settings className="h-6 w-6" strokeWidth={1.5} />
          <span className="mt-1 text-xs leading-tight text-text-tertiary">
            Settings
          </span>
        </button>

        {/* User avatar placeholder */}
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-input text-text-secondary text-sm font-medium">
          U
        </div>
      </div>
    </aside>
  );
}
