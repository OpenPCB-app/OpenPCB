import type { LucideIcon } from "lucide-react";
import {
  Info,
  Settings as SettingsIcon,
} from "lucide-react";

export type SettingsNavItem = {
  id: "general" | "about";
  label: string;
  icon: LucideIcon;
  order: number;
};

export const settingsNavItems: SettingsNavItem[] = [
  { id: "general", label: "General", icon: SettingsIcon, order: 1 },
  { id: "about", label: "About", icon: Info, order: 2 },
];
