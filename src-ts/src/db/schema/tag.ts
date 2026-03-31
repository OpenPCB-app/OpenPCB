/**
 * Tag Schema
 *
 * Tags for organizing chats and projects within workspaces.
 * Supports both workspace-level tags (projectId = NULL) and project-scoped tags.
 *
 * See: PHASES.md Phase 2.1
 */

import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { uuidPrimaryKey, timestamps } from "./base";
import { workspace } from "./workspace";
import { project } from "./project";
import { chat } from "./chat";

/**
 * Tag table
 *
 * Tags can be:
 * - Workspace-level (projectId = NULL): Visible across entire workspace
 * - Project-scoped (projectId != NULL): Only visible within that project
 */
export const tag = sqliteTable(
  "tag",
  {
    ...uuidPrimaryKey,
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    color: text("color"), // Hex color e.g., "#FF5733"
    sortOrder: integer("sort_order"),
    ...timestamps,
  },
  (table) => ({
    // Unique constraint: tag name must be unique within scope (workspace + optional project)
    workspaceProjectNameIdx: uniqueIndex("idx_tag_workspace_project_name").on(
      table.workspaceId,
      sql`COALESCE(${table.projectId}, '')`,
      table.name,
    ),
    workspaceIdx: index("idx_tag_workspace").on(table.workspaceId),
    projectIdx: index("idx_tag_project").on(table.projectId),
    sortIdx: index("idx_tag_sort").on(table.workspaceId, table.sortOrder),
  }),
);

export type Tag = typeof tag.$inferSelect;
export type NewTag = typeof tag.$inferInsert;

/**
 * Chat-Tag junction table
 *
 * Associates tags with chats (many-to-many)
 */
export const chatTag = sqliteTable(
  "chat_tag",
  {
    ...uuidPrimaryKey,
    chatId: text("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$default(() => new Date()),
  },
  (table) => ({
    uniqueIdx: uniqueIndex("idx_chat_tag_unique").on(table.chatId, table.tagId),
    chatIdx: index("idx_chat_tag_chat").on(table.chatId),
    tagIdx: index("idx_chat_tag_tag").on(table.tagId),
  }),
);

export type ChatTag = typeof chatTag.$inferSelect;
export type NewChatTag = typeof chatTag.$inferInsert;

/**
 * Project-Tag junction table
 *
 * Associates tags with projects (many-to-many)
 * Note: This is for tagging projects themselves, not for project-scoped tags
 */
export const projectTag = sqliteTable(
  "project_tag",
  {
    ...uuidPrimaryKey,
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$default(() => new Date()),
  },
  (table) => ({
    uniqueIdx: uniqueIndex("idx_project_tag_unique").on(
      table.projectId,
      table.tagId,
    ),
    projectIdx: index("idx_project_tag_project").on(table.projectId),
    tagIdx: index("idx_project_tag_tag").on(table.tagId),
  }),
);

export type ProjectTag = typeof projectTag.$inferSelect;
export type NewProjectTag = typeof projectTag.$inferInsert;
