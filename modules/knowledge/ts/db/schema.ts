import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { v7 as uuidv7 } from "uuid";
import type { PageProperties, EditorContent } from "../../shared/types";

export const knowledge_page = sqliteTable(
  "module_knowledge_page",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    workspace_id: text("workspace_id").notNull(),

    project_id: text("project_id"),
    parent_id: text("parent_id"),
    is_project_root: integer("is_project_root", { mode: "boolean" }).default(
      false,
    ),
    order_key: text("order_key").notNull(),

    title: text("title").notNull(),
    icon: text("icon"),

    properties_json: text("properties_json", { mode: "json" })
      .$type<PageProperties>()
      .default({}),

    content_engine: text("content_engine").notNull().default("tiptap"),
    content_version: integer("content_version").notNull().default(1),
    content_json: text("content_json", { mode: "json" })
      .$type<EditorContent>()
      .notNull(),
    revision: integer("revision").notNull().default(1),

    created_at: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$default(() => new Date()),
    updated_at: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$default(() => new Date())
      .$onUpdate(() => new Date()),
    deleted_at: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("idx_kp_workspace_project").on(table.workspace_id, table.project_id),
    index("idx_kp_parent").on(table.parent_id),
    index("idx_kp_deleted").on(table.deleted_at),
    index("idx_kp_title").on(table.title),
    index("idx_kp_order").on(table.parent_id, table.order_key),
  ],
);

export type KnowledgePage = typeof knowledge_page.$inferSelect;
export type NewKnowledgePage = typeof knowledge_page.$inferInsert;
