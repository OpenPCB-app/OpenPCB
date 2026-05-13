import type { LucideIcon } from "lucide-react";
import { Bot, Info, Settings as SettingsIcon } from "lucide-react";

export type SettingsNavItem = {
  id: "general" | "assistant" | "about";
  label: string;
  icon: LucideIcon;
  order: number;
};

export const settingsNavItems: SettingsNavItem[] = [
  { id: "general", label: "General", icon: SettingsIcon, order: 1 },
  { id: "assistant", label: "Assistant", icon: Bot, order: 2 },
  { id: "about", label: "About", icon: Info, order: 3 },
];
