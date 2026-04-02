/**
 * Base Schema Patterns
 *
 * Common column definitions and patterns used across all database schemas.
 * These patterns ensure consistency and reduce boilerplate.
 */

import { text, integer } from "drizzle-orm/sqlite-core";
import { v7 as uuidv7 } from "uuid";

/**
 * Standard timestamp columns for all entities
 *
 * - createdAt: Set once on creation
 * - updatedAt: Updated on every modification
 */
/**
 * Standard timestamp columns for all entities
 *
 * - createdAt: Set once on creation
 * - updatedAt: Updated on every modification
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
 * Soft delete column
 *
 * When set, indicates the entity is logically deleted but preserved in database.
 * Allows for restoration and maintains referential integrity.
 */
export const softDelete = {
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
} as const;

/**
 * UUIDv7 primary key column
 *
 * UUIDv7s are time-ordered identifiers stored as text.
 */
export const uuidPrimaryKey = {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),
} as const;

/**
 * Generate a new UUIDv7
 *
 * @returns A new UUIDv7 string
 *
 * @example
 * const id = generateUUIDv7();
 * // => "018fbe29-d573-7ed2-8bc4-4c5a0bdb1f10"
 */
export function generateUUIDv7(): string {
  return uuidv7();
}
