/**
 * Content Edit Lock Schema
 *
 * Prevents concurrent edits to the same content target.
 * Locks are acquired at edit start and released on completion/cancel.
 * TTL-based expiration prevents deadlocks from crashed processes.
 */

import { sqliteTable, text, integer, index, unique } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey } from "./base";

/**
 * Default lock TTL in milliseconds (60 seconds)
 * Should be long enough for AI streaming but short enough to recover from crashes
 */
export const DEFAULT_LOCK_TTL_MS = 60_000;

export const contentEditLock = sqliteTable(
  "content_edit_lock",
  {
    ...uuidPrimaryKey,

    // Target reference (must be unique - only one lock per target)
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),

    // Edit operation holding the lock
    editId: text("edit_id").notNull(),

    // Who acquired the lock (for debugging)
    acquiredBy: text("acquired_by"), // e.g., "content-editor-service"

    // Lock timestamps
    acquiredAt: integer("acquired_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),

    // When lock expires (auto-release for crash recovery)
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    // Unique constraint ensures only one lock per target
    targetUnique: unique("uq_cel_target").on(table.targetType, table.targetId),
    editIdx: index("idx_cel_edit").on(table.editId),
    expiresIdx: index("idx_cel_expires").on(table.expiresAt),
  })
);

export type ContentEditLock = typeof contentEditLock.$inferSelect;
export type NewContentEditLock = typeof contentEditLock.$inferInsert;
