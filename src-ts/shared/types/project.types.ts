export type ProjectStatus = "active" | "archived";

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
  icon?: string | null;
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
  icon?: string;
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
  icon?: string | null;
  color?: string | null;
  sortOrder?: number | null;
  aiConfig?: ProjectAIConfig | null;
  ragConfig?: ProjectRAGConfig | null;
  preferences?: ProjectPreferences | null;
  metadata?: ProjectMetadata | null;
}
