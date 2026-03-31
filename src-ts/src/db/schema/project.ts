import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps, softDelete } from "./base";
import { workspace } from "./workspace";
import type {
  ProjectMetadata,
  ProjectAIConfig,
  ProjectRAGConfig,
  ProjectPreferences,
} from "../../../shared/types/project.types";

export type {
  ProjectMetadata,
  ProjectAIConfig,
  ProjectRAGConfig,
  ProjectPreferences,
};

export const project = sqliteTable(
  "project",
  {
    ...uuidPrimaryKey,
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    icon: text("icon"),
    color: text("color"),
    sortOrder: integer("sort_order"),
    aiConfig: text("ai_config", { mode: "json" }).$type<ProjectAIConfig>(),
    ragConfig: text("rag_config", { mode: "json" }).$type<ProjectRAGConfig>(),
    preferences: text("preferences", {
      mode: "json",
    }).$type<ProjectPreferences>(),
    metadata: text("metadata", { mode: "json" }).$type<ProjectMetadata>(),
    ...timestamps,
    ...softDelete,
  },
  (table) => ({
    workspaceIdx: index("idx_project_workspace").on(table.workspaceId),
    statusIdx: index("idx_project_status").on(table.workspaceId, table.status),
  }),
);

export type Project = typeof project.$inferSelect;
export type NewProject = typeof project.$inferInsert;
