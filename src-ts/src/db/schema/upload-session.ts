/**
 * Upload Session Schema
 *
 * Tracks chunked upload sessions for resumable uploads.
 * Sessions expire after a configurable timeout.
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";

/** Session statuses */
export type UploadSessionStatus = "active" | "completed" | "failed" | "expired";

export const uploadSession = sqliteTable(
  "upload_session",
  {
    ...uuidPrimaryKey,
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id"),
    spaceId: text("space_id"),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    totalSize: integer("total_size").notNull(),
    uploadedSize: integer("uploaded_size").notNull().default(0),
    chunkSize: integer("chunk_size").notNull(),
    totalChunks: integer("total_chunks").notNull(),
    uploadedChunks: text("uploaded_chunks", { mode: "json" }).$type<number[]>().default([]),
    status: text("status").notNull().default("active"), // active | completed | failed | expired
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    fileId: text("file_id"), // Set when upload is completed
    ...timestamps,
  },
  (table) => ({
    workspaceIdx: index("idx_upload_session_workspace").on(table.workspaceId),
    statusIdx: index("idx_upload_session_status").on(table.status),
    expiresAtIdx: index("idx_upload_session_expires").on(table.expiresAt),
  })
);

export type UploadSession = typeof uploadSession.$inferSelect;
export type NewUploadSession = typeof uploadSession.$inferInsert;
