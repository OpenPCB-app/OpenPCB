/**
 * Content Edit Snapshot Schema
 *
 * Stores snapshots of content before AI edits for rollback capability.
 * Each edit operation creates a snapshot that can be restored.
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { workspace } from "./workspace";

/**
 * Snapshot status lifecycle:
 * - pending: Edit started, snapshot created
 * - active: Edit in progress or completed successfully
 * - rolled_back: User rolled back to this snapshot
 * - expired: Snapshot cleaned up (retention policy)
 */
export const SNAPSHOT_STATUS = [
  "pending",
  "active",
  "rolled_back",
  "expired",
] as const;

export type SnapshotStatus = (typeof SNAPSHOT_STATUS)[number];

/**
 * Edit modes supported:
 * - replace: Replace entire content
 * - append: Add content at end
 * - selection: Replace selected portion
 * - generate: Let AI extend or refresh content without a specific target range
 */
export const EDIT_MODES = ["replace", "append", "selection", "generate"] as const;

export type EditMode = (typeof EDIT_MODES)[number];

export const contentEditSnapshot = sqliteTable(
  "content_edit_snapshot",
  {
    ...uuidPrimaryKey,

    // Edit operation ID (groups related operations)
    editId: text("edit_id").notNull(),

    // Target reference (module.entity format)
    targetType: text("target_type").notNull(), // e.g., "knowledge.page"
    targetId: text("target_id").notNull(),

    // Content before edit (Tiptap JSON)
    contentBefore: text("content_before", { mode: "json" }).notNull().$type<unknown>(),

    // Edit mode used
    mode: text("mode", { enum: EDIT_MODES }).notNull(),

    // Selection info for selection mode (Tiptap from/to positions)
    selectionInfo: text("selection_info", { mode: "json" }).$type<SelectionInfo | null>(),

    // AI instruction that triggered this edit
    instruction: text("instruction").notNull(),

    // Provider/model used
    provider: text("provider").notNull(),
    model: text("model").notNull(),

    // Snapshot lifecycle
    status: text("status", { enum: SNAPSHOT_STATUS }).notNull().default("pending"),

    // Content after edit (set when edit completes)
    contentAfter: text("content_after", { mode: "json" }).$type<unknown>(),

    // Token usage tracking
    tokensUsed: text("tokens_used", { mode: "json" }).$type<TokenUsage | null>(),

    // Error info if edit failed
    error: text("error", { mode: "json" }).$type<EditError | null>(),

    // Context linking
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),

    // Timestamps
    ...timestamps,

    // When edit completed (success or failure)
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),

    // When snapshot expires (for cleanup)
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  },
  (table) => ({
    editIdx: index("idx_ces_edit").on(table.editId),
    targetIdx: index("idx_ces_target").on(table.targetType, table.targetId),
    statusIdx: index("idx_ces_status").on(table.status),
    workspaceIdx: index("idx_ces_workspace").on(table.workspaceId),
    expiresIdx: index("idx_ces_expires").on(table.expiresAt),
    targetStatusIdx: index("idx_ces_target_status").on(
      table.targetType,
      table.targetId,
      table.status
    ),
  })
);

export type ContentEditSnapshot = typeof contentEditSnapshot.$inferSelect;
export type NewContentEditSnapshot = typeof contentEditSnapshot.$inferInsert;

/**
 * Selection info for selection mode edits
 */
export interface SelectionInfo {
  type: "tiptap";
  from: number;
  to: number;
  // Optional: extracted text for context
  selectedText?: string;
}

/**
 * Token usage for edit operation
 */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

/**
 * Edit error information
 */
export interface EditError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: string;
}
