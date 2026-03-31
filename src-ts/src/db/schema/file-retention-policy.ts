/**
 * File Retention Policy Schema
 *
 * Defines retention rules for automatic file cleanup.
 * Supports age-based and size-based retention with configurable actions.
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";

/** Retention rule types */
export type RetentionRuleType = "age" | "size" | "status";

/** Retention actions */
export type RetentionAction = "delete" | "archive" | "notify";

/** Retention rule definition */
export interface RetentionRule {
  type: RetentionRuleType;
  condition: {
    olderThanDays?: number;
    status?: "trashed";
    totalSizeExceeds?: number; // bytes
  };
  action: RetentionAction;
}

export const fileRetentionPolicy = sqliteTable(
  "file_retention_policy",
  {
    ...uuidPrimaryKey,
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    rules: text("rules", { mode: "json" }).$type<RetentionRule[]>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => ({
    workspaceIdx: index("idx_retention_policy_workspace").on(table.workspaceId),
    enabledIdx: index("idx_retention_policy_enabled").on(table.enabled),
  })
);

export type FileRetentionPolicy = typeof fileRetentionPolicy.$inferSelect;
export type NewFileRetentionPolicy = typeof fileRetentionPolicy.$inferInsert;
