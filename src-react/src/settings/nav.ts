import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Info,
  Settings as SettingsIcon,
  KeyRound,
  Server,
} from "lucide-react";

export type SettingsNavItem = {
  id:
    | "general"
    | "api-keys"
    | "mcp-servers"
    | "usage"
    | "interface"
    | "external-tools"
    | "personalization"
    | "audio"
    | "data-controls"
    | "account"
    | "about";
  label: string;
  icon: LucideIcon;
  order: number;
};

export const settingsNavItems: SettingsNavItem[] = [
  { id: "general", label: "General", icon: SettingsIcon, order: 1 },
  { id: "api-keys", label: "API Keys", icon: KeyRound, order: 2 },
  { id: "mcp-servers", label: "MCP Servers", icon: Server, order: 2.2 },
  { id: "usage", label: "Usage & Billing", icon: BarChart3, order: 2.5 },
  { id: "about", label: "About", icon: Info, order: 3 },
];
