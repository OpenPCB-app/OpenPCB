import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Info,
  Library,
  Lock,
  Settings as SettingsIcon,
  User,
} from "lucide-react";
import type { SettingsTab } from "../../../contracts/app/routes";

export type { SettingsTab };

export interface SettingsNavItem {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
  // When set, the item is only shown if the named module is loaded.
  requiresModule?: string;
}

export interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: "Workspace",
    items: [
      { id: "general", label: "General", icon: SettingsIcon },
      {
        id: "libraries",
        label: "Libraries",
        icon: Library,
        requiresModule: "library",
      },
    ],
  },
  {
    label: "Cloud & AI",
    items: [
      { id: "account", label: "Account", icon: User },
      {
        id: "assistant",
        label: "Assistant",
        icon: Bot,
        requiresModule: "assistant",
      },
    ],
  },
  {
    label: "System",
    items: [
      { id: "privacy", label: "Privacy", icon: Lock },
      { id: "about", label: "About", icon: Info },
    ],
  },
];

// Flat, ordered list of all tab ids — handy for default-tab resolution / guards.
export const ALL_SETTINGS_TABS: SettingsTab[] = SETTINGS_NAV.flatMap((group) =>
  group.items.map((item) => item.id),
);
