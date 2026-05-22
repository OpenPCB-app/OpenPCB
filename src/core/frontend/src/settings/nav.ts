import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Info,
  Library,
  Settings as SettingsIcon,
  User,
} from "lucide-react";

export type SettingsNavItem = {
  id: "general" | "account" | "libraries" | "assistant" | "about";
  label: string;
  icon: LucideIcon;
  order: number;
  requiresCloud?: boolean;
  requiresModule?: string;
};

export const settingsNavItems: SettingsNavItem[] = [
  { id: "general", label: "General", icon: SettingsIcon, order: 1 },
  {
    id: "account",
    label: "Account",
    icon: User,
    order: 2,
    requiresCloud: true,
  },
  {
    id: "libraries",
    label: "Libraries",
    icon: Library,
    order: 3,
    requiresModule: "library",
  },
  {
    id: "assistant",
    label: "Assistant",
    icon: Bot,
    order: 4,
    requiresModule: "assistant",
  },
  { id: "about", label: "About", icon: Info, order: 5 },
];
