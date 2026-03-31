export type ProjectStatus = "active" | "archived";

export const PROJECT_ICON_IDS = [
  "briefcase",
  "code",
  "database",
  "folder",
  "globe",
  "layout",
  "message-square",
  "monitor",
  "settings",
  "terminal",
  "zap",
] as const;

export type ProjectIconId = (typeof PROJECT_ICON_IDS)[number];

const LEGACY_PROJECT_ICON_ALIASES: Record<string, ProjectIconId> = {
  Box: "briefcase",
  Briefcase: "briefcase",
  Code: "code",
  Cpu: "monitor",
  Database: "database",
  File: "folder",
  Folder: "folder",
  Globe: "globe",
  Layers: "layout",
  Layout: "layout",
  Package: "briefcase",
  Terminal: "terminal",
  Settings: "settings",
  Zap: "zap",
  Monitor: "monitor",
  "message-square": "message-square",
};

export function normalizeProjectIconId(
  icon: string | null | undefined,
): ProjectIconId | null | undefined {
  if (icon === undefined) return undefined;
  if (icon === null) return null;

  const normalized = icon.trim();
  if (normalized.length === 0) return null;

  if ((PROJECT_ICON_IDS as readonly string[]).includes(normalized)) {
    return normalized as ProjectIconId;
  }

  return LEGACY_PROJECT_ICON_ALIASES[normalized] ?? "briefcase";
}

export interface ProjectAIConfig {
  defaultProvider?: string;
  defaultModel?: string;
  systemPrompt?: string;
  systemPromptMode?: "append" | "replace";
  temperature?: number;
  maxTokens?: number;
}

export interface ProjectRAGConfig {
  contextFileIds?: string[];
  contextNotes?: string;
  embeddingModel?: string;
}

export interface ProjectPreferences {
  showInSidebar?: boolean;
  expandedByDefault?: boolean;
  pinnedChats?: string[];
}

/** @deprecated Use specific config fields (aiConfig, ragConfig, preferences) instead */
export interface ProjectMetadata {
  [key: string]: unknown;
}

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  status: ProjectStatus;
  icon?: ProjectIconId | string | null;
  color?: string | null;
  sortOrder?: number | null;
  aiConfig?: ProjectAIConfig | null;
  ragConfig?: ProjectRAGConfig | null;
  preferences?: ProjectPreferences | null;
  metadata?: ProjectMetadata | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface CreateProjectInput {
  workspaceId: string;
  name: string;
  description?: string;
  status?: ProjectStatus;
  icon?: ProjectIconId | string;
  color?: string;
  sortOrder?: number;
  aiConfig?: ProjectAIConfig;
  ragConfig?: ProjectRAGConfig;
  preferences?: ProjectPreferences;
  metadata?: ProjectMetadata;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  icon?: ProjectIconId | string | null;
  color?: string | null;
  sortOrder?: number | null;
  aiConfig?: ProjectAIConfig | null;
  ragConfig?: ProjectRAGConfig | null;
  preferences?: ProjectPreferences | null;
  metadata?: ProjectMetadata | null;
}
