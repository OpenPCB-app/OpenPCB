import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps, softDelete } from "./base";
import { workspace } from "./workspace";
import { project } from "./project";

export const design = sqliteTable(
  "design",
  {
    ...uuidPrimaryKey,
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order"),
    ...timestamps,
    ...softDelete,
  },
  (table) => ({
    workspaceIdx: index("idx_design_workspace").on(table.workspaceId),
    projectIdx: index("idx_design_project").on(table.projectId),
    sortIdx: index("idx_design_sort").on(table.projectId, table.sortOrder),
  }),
);

export type Design = typeof design.$inferSelect;
export type NewDesign = typeof design.$inferInsert;
