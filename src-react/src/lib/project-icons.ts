import type { LucideIcon } from "lucide-react";
import {
  Briefcase,
  BriefcaseIcon,
  Code,
  CodeIcon,
  Database,
  DatabaseIcon,
  Folder,
  FolderIcon,
  Globe,
  GlobeIcon,
  Layout,
  LayoutIcon,
  MessageSquare,
  Monitor,
  Settings,
  Terminal,
  TerminalIcon,
  Zap,
} from "lucide-react";
import {
  PROJECT_ICON_IDS,
  normalizeProjectIconId,
  type ProjectIconId,
} from "@shared/types";

export const PROJECT_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
  "#f43f5e",
  "#64748b",
  "#000000",
] as const;

export const PROJECT_ICON_OPTIONS: Array<{
  id: ProjectIconId;
  icon: LucideIcon;
}> = [
  { id: "briefcase", icon: Briefcase },
  { id: "code", icon: Code },
  { id: "database", icon: Database },
  { id: "folder", icon: Folder },
  { id: "globe", icon: Globe },
  { id: "layout", icon: Layout },
  { id: "message-square", icon: MessageSquare },
  { id: "monitor", icon: Monitor },
  { id: "settings", icon: Settings },
  { id: "terminal", icon: Terminal },
  { id: "zap", icon: Zap },
];

const PROJECT_ICON_MAP: Record<ProjectIconId, LucideIcon> = {
  briefcase: BriefcaseIcon,
  code: CodeIcon,
  database: DatabaseIcon,
  folder: FolderIcon,
  globe: GlobeIcon,
  layout: LayoutIcon,
  "message-square": MessageSquare,
  monitor: Monitor,
  settings: Settings,
  terminal: TerminalIcon,
  zap: Zap,
};

export function getProjectIcon(icon: string | null | undefined): LucideIcon {
  const normalized = normalizeProjectIconId(icon);
  if (!normalized) {
    return BriefcaseIcon;
  }
  return PROJECT_ICON_MAP[normalized];
}

export { PROJECT_ICON_IDS };
