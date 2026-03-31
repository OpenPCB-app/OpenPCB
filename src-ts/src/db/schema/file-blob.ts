/**
 * File Blob Schema
 *
 * Stores physical file blobs with checksum-based deduplication.
 * Multiple file records can reference the same blob.
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";

export const fileBlob = sqliteTable(
  "file_blob",
  {
    ...uuidPrimaryKey,
    checksum: text("checksum").notNull().unique(), // SHA256 hash
    sizeBytes: integer("size_bytes").notNull(),
    mimeType: text("mime_type").notNull(),
    storagePath: text("storage_path").notNull(), // Relative to APP_DATA_DIR/files/
    refCount: integer("ref_count").notNull().default(0), // Number of file records referencing this blob
    ...timestamps,
  },
  (table) => ({
    checksumIdx: index("idx_file_blob_checksum").on(table.checksum),
  })
);

export type FileBlob = typeof fileBlob.$inferSelect;
export type NewFileBlob = typeof fileBlob.$inferInsert;
