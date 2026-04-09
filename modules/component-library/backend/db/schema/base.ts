/**
 * Base Schema Patterns
 *
 * Common column definitions and patterns used across module schemas.
 */

import { text, integer } from "drizzle-orm/sqlite-core";
import { v7 as uuidv7 } from "uuid";

/**
 * Standard timestamp columns for all entities.
 */
export const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$default(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$default(() => new Date())
    .$onUpdate(() => new Date()),
} as const;

/**
 * Soft delete column.
 */
export const softDelete = {
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
} as const;

/**
 * UUIDv7 primary key column.
 */
export const uuidPrimaryKey = {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
} as const;

/**
 * Generate a new UUIDv7.
 */
export function generateUUIDv7(): string {
  return uuidv7();
}
