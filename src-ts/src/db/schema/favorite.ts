/**
 * Favorite Schema
 *
 * User favorites for quick access to threads.
 */

import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey } from "./base";
import { workspace } from "./workspace";
import { chat } from "./chat";

export const favorite = sqliteTable(
  "favorite",
  {
    ...uuidPrimaryKey,
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chat.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order"), // Manual ordering within favorites
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    workspaceChatIdx: uniqueIndex("idx_favorite_workspace_chat").on(
      table.workspaceId,
      table.chatId
    ),
    sortIdx: index("idx_favorite_sort").on(table.workspaceId, table.sortOrder),
  })
);

export type Favorite = typeof favorite.$inferSelect;
export type NewFavorite = typeof favorite.$inferInsert;
