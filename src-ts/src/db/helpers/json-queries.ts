/**
 * JSON Query Helpers
 *
 * Utilities for querying JSON columns in SQLite.
 */

import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/**
 * Check if JSON column contains a value at a specific path
 *
 * @example
 * db.select().from(threads).where(
 *   jsonContains(threads.metadata, "$.tags", "important")
 * );
 */
export function jsonContains(column: any, path: string, value: unknown): SQL {
  return sql`json_extract(${column}, ${path}) = ${JSON.stringify(value)}`;
}

/**
 * Extract value from JSON column
 *
 * @example
 * db.select({
 *   id: message.id,
 *   role: jsonExtract<string>(message.content, "$.role")
 * }).from(message);
 */
export function jsonExtract<T>(column: any, path: string): SQL<T> {
  return sql<T>`json_extract(${column}, ${path})`;
}

/**
 * Check if JSON array contains a value
 *
 * @example
 * db.select().from(projects).where(
 *   jsonArrayContains(projects.metadata, "$.tags", "urgent")
 * );
 */
export function jsonArrayContains(column: any, path: string, value: unknown): SQL {
  return sql`EXISTS (
    SELECT 1 FROM json_each(json_extract(${column}, ${path}))
    WHERE value = ${JSON.stringify(value)}
  )`;
}

/**
 * Get length of JSON array
 *
 * @example
 * db.select({
 *   id: project.id,
 *   tagCount: jsonArrayLength(project.metadata, "$.tags")
 * }).from(project);
 */
export function jsonArrayLength(column: any, path: string): SQL<number> {
  return sql<number>`json_array_length(${column}, ${path})`;
}

/**
 * Check if JSON path exists
 *
 * @example
 * db.select().from(workspace).where(
 *   jsonPathExists(workspace.settings, "$.theme")
 * );
 */
export function jsonPathExists(column: any, path: string): SQL {
  return sql`json_extract(${column}, ${path}) IS NOT NULL`;
}

/**
 * Update JSON value at path (for UPDATE statements)
 *
 * @example
 * db.update(workspace)
 *   .set({ settings: jsonSet(workspace.settings, "$.theme", "dark") })
 *   .where(eq(workspace.id, workspaceId));
 */
export function jsonSet(column: any, path: string, value: unknown): SQL {
  return sql`json_set(${column}, ${path}, ${JSON.stringify(value)})`;
}

/**
 * Remove JSON path (for UPDATE statements)
 *
 * @example
 * db.update(workspace)
 *   .set({ settings: jsonRemove(workspace.settings, "$.oldField") })
 *   .where(eq(workspace.id, workspaceId));
 */
export function jsonRemove(column: any, path: string): SQL {
  return sql`json_remove(${column}, ${path})`;
}

/**
 * Merge JSON objects (for UPDATE statements)
 *
 * @example
 * db.update(workspace)
 *   .set({
 *     settings: jsonPatch(workspace.settings, { theme: "dark", fontSize: 14 })
 *   })
 *   .where(eq(workspace.id, workspaceId));
 */
export function jsonPatch(column: any, patch: Record<string, unknown>): SQL {
  return sql`json_patch(${column}, ${JSON.stringify(patch)})`;
}
