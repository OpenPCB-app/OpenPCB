/**
 * File Schema
 *
 * File metadata and context. References file_blob for actual storage.
 * Supports workspace/project/space context, versioning, and soft delete.
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps, softDelete } from "./base";
import { fileBlob } from "./file-blob";

export const file = sqliteTable(
  "file",
  {
    ...uuidPrimaryKey,
    blobId: text("blob_id")
      .notNull()
      .references(() => fileBlob.id, { onDelete: "restrict" }),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(), // Denormalized for fast query

    // Versioning
    currentVersion: integer("current_version").notNull().default(1),

    // Context - workspaceId required, project optional
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id"),
    spaceId: text("space_id"),

    // Optional context metadata
    tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
    permissions: text("permissions", { mode: "json" }).$type<Record<string, unknown>>(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),

    // Soft delete fields
    status: text("status").notNull().default("active"), // active | trashed
    trashedAt: integer("trashed_at", { mode: "timestamp_ms" }),
    trashedBy: text("trashed_by"),

    ...timestamps,
    ...softDelete,
  },
  (table) => ({
    blobIdx: index("idx_file_blob").on(table.blobId),
    workspaceIdx: index("idx_file_workspace").on(table.workspaceId),
    projectIdx: index("idx_file_project").on(table.projectId),
    spaceIdx: index("idx_file_space").on(table.spaceId),
    statusIdx: index("idx_file_status").on(table.status),
    trashedAtIdx: index("idx_file_trashed_at").on(table.trashedAt),
  })
);

export type File = typeof file.$inferSelect;
export type NewFile = typeof file.$inferInsert;

export type FileStatus = "active" | "trashed";

export interface FileContext {
  workspaceId: string;
  projectId?: string | null;
  spaceId?: string | null;
}
