import type { LucideIcon } from "lucide-react";
import { Bot, Info, Settings as SettingsIcon, User } from "lucide-react";

export type SettingsNavItem = {
  id: "general" | "account" | "assistant" | "about";
  label: string;
  icon: LucideIcon;
  order: number;
  requiresCloud?: boolean;
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
  { id: "assistant", label: "Assistant", icon: Bot, order: 3 },
  { id: "about", label: "About", icon: Info, order: 4 },
];
