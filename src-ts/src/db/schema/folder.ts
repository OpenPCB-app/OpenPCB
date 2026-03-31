import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { workspace } from "./workspace";
import { project } from "./project";

export const folder = sqliteTable(
  "folder",
  {
    ...uuidPrimaryKey,
    workspaceId: text("workspace_id").references(() => workspace.id, {
      onDelete: "cascade",
    }),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    icon: text("icon"),
    color: text("color"),
    sortOrder: integer("sort_order"),
    isExpanded: integer("is_expanded", { mode: "boolean" })
      .notNull()
      .default(true),
    ...timestamps,
  },
  (table) => ({
    workspaceIdx: index("idx_folder_workspace").on(table.workspaceId),
    projectIdx: index("idx_folder_project").on(table.projectId),
  }),
);

export type Folder = typeof folder.$inferSelect;
export type NewFolder = typeof folder.$inferInsert;
