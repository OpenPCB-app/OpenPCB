/**
 * Workspace Types - V2 Kernel
 *
 * Defines workspace record structure for SQLite storage and API responses.
 */

/** Workspace settings */
export interface WorkspaceSettings {
  theme?: "light" | "dark" | "system";
  language?: string;
  defaultProvider?: string;
  defaultModel?: string;
  [key: string]: unknown;
}

/** Full workspace record (for storage) */
export interface WorkspaceRecord {
  id: string; // UUID v7
  name: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  settings: WorkspaceSettings;
}

/** Create input for new workspace */
export interface CreateWorkspaceInput {
  name: string;
  settings?: WorkspaceSettings;
}

/** Update input for existing workspace */
export interface UpdateWorkspaceInput {
  name?: string;
  settings?: WorkspaceSettings;
}
