/**
 * Bookmark Schema
 *
 * Bookmarks for specific messages within threads.
 */

import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { workspace } from "./workspace";
import { chat } from "./chat";
import { message } from "./message";

export const bookmark = sqliteTable(
  "bookmark",
  {
    ...uuidPrimaryKey,
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chat.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    note: text("note"), // Optional user note about the bookmark
    ...timestamps,
  },
  (table) => ({
    workspaceIdx: index("idx_bookmark_workspace").on(table.workspaceId),
    chatIdx: index("idx_bookmark_chat").on(table.chatId),
    messageIdx: index("idx_bookmark_message").on(table.messageId),
  }),
);

export type Bookmark = typeof bookmark.$inferSelect;
export type NewBookmark = typeof bookmark.$inferInsert;
