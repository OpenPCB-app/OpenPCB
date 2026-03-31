import type { ChatConfig } from "../types";
import type { ProjectRecord } from "@shared/types";

/** Available preset names for common chat configurations */
export type PresetName = "main" | "embedded" | "project" | "module";

/** A preset is a partial ChatConfig with a name identifier */
export interface ChatPreset extends Partial<ChatConfig> {
  /** Which preset this configuration represents */
  name: PresetName;
  /** Human-readable description of the preset's purpose */
  description?: string;
}

/** Factory function that creates a ChatPreset from typed options */
export type PresetFactory<TOptions = void> = (options: TOptions) => ChatPreset;

/** Options for creating an embedded chat preset */
export interface EmbeddedChatOptions {
  /** Maximum height CSS value for the embedded container */
  maxHeight?: string;
  /** Whether to show the header bar */
  showHeader?: boolean;
}

/** Options for creating a project-scoped chat preset */
export interface ProjectChatOptions {
  /** Project identifier (required for project scoping) */
  projectId: string;
  /** Project record for displaying the project badge */
  projectContext: ProjectRecord;
  /** Callback when user navigates back from project chat */
  onBack?: () => void;
}

/** Options for creating a module-specific chat preset */
export interface ModuleChatOptions {
  /** Module identifier (required for module scoping) */
  moduleId: string;
  /** Space identifier within the module */
  spaceId?: string;
  /** Custom system prompt for this module's AI behavior */
  systemPrompt?: string;
  /** Restrict available tools to this list */
  allowedTools?: string[];
}
