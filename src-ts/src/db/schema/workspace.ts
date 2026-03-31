/**
 * Workspace Schema
 *
 * Top-level organizational unit. All other entities belong to a workspace.
 */

import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps, softDelete } from "./base";
import type { WorkspaceSettings } from "../../../shared/types/workspace.types";

export type { WorkspaceSettings };

export const workspace = sqliteTable("workspace", {
  ...uuidPrimaryKey,
  name: text("name").notNull(),
  settings: text("settings", { mode: "json" }).$type<WorkspaceSettings>(),
  ...timestamps,
  ...softDelete,
});

export type Workspace = typeof workspace.$inferSelect;
export type NewWorkspace = typeof workspace.$inferInsert;
