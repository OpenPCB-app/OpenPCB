/**
 * File Version Schema
 *
 * Stores file version history. Each version references a blob.
 * Enables version control for files with rollback capability.
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { file } from "./file";
import { fileBlob } from "./file-blob";

export const fileVersion = sqliteTable(
  "file_version",
  {
    ...uuidPrimaryKey,
    fileId: text("file_id")
      .notNull()
      .references(() => file.id, { onDelete: "cascade" }),
    blobId: text("blob_id")
      .notNull()
      .references(() => fileBlob.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdBy: text("created_by"),
    comment: text("comment"),
    ...timestamps,
  },
  (table) => ({
    fileIdx: index("idx_file_version_file").on(table.fileId),
    versionIdx: index("idx_file_version_number").on(table.fileId, table.versionNumber),
  })
);

export type FileVersion = typeof fileVersion.$inferSelect;
export type NewFileVersion = typeof fileVersion.$inferInsert;
