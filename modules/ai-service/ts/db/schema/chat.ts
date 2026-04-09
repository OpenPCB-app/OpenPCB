/**
 * Chat Schema
 *
 * Represents a conversation chat. Contains messages and belongs to a workspace/project.
 *
 * Enhanced for AI Task Management System:
 * - provider field tracks last used AI provider
 * - model field tracks last used model
 *
 * See: TASK_SYSTEM_SPECIFICATION.md
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps, softDelete } from "./base";
import { workspace } from "./workspace";
import { project } from "./project";
import { folder } from "./folder";

export const chat = sqliteTable(
  "chat",
  {
    ...uuidPrimaryKey,
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "set null",
    }),
    folderId: text("folder_id").references(() => folder.id, {
      onDelete: "set null",
    }),
    title: text("title"),
    summary: text("summary"), // AI-generated summary

    // AI Provider configuration (last used)
    provider: text("provider"), // Last used provider (e.g., 'openai', 'ollama')
    model: text("model"), // Last used model for this chat

    systemPrompt: text("system_prompt"), // Chat-specific system prompt
    // TODO: Deprecated in favor of 'favorite' table. Remove in next major version.
    isPinned: integer("is_pinned", { mode: "boolean" })
      .notNull()
      .default(false),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order"), // Manual sort position
    // Icon configuration
    iconName: text("icon_name"), // Icon name from ChatIconName
    iconColor: text("icon_color"), // Icon color from ChatIconColor
    // Category for filtering (e.g., 'brainstorming_node' for idea chats)
    category: text("category"),
    // Denormalized fields (maintained by triggers)
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }),
    metadata: text("metadata", { mode: "json" }).$type<ChatMetadata>(),
    ...timestamps,
    ...softDelete,
  },
  (table) => ({
    workspaceIdx: index("idx_chat_workspace").on(table.workspaceId),
    projectIdx: index("idx_chat_project").on(table.projectId),
    folderIdx: index("idx_chat_folder").on(table.folderId),
    providerIdx: index("idx_chat_provider").on(table.provider),
    categoryIdx: index("idx_chat_category").on(table.category),
    lastMessageIdx: index("idx_chat_last_message").on(
      table.workspaceId,
      table.lastMessageAt,
    ),
    pinnedIdx: index("idx_chat_pinned").on(table.workspaceId, table.isPinned),
    archivedIdx: index("idx_chat_archived").on(
      table.workspaceId,
      table.isArchived,
    ),
  }),
);

export type Chat = typeof chat.$inferSelect;
export type NewChat = typeof chat.$inferInsert;

export interface ChatMetadata {
  provider?: string; // AI provider used for this chat
  contextRef?: {
    type: string;
    id: string;
  } | null;
  [key: string]: unknown;
}
