import type { File as DBFile } from "../../db/schema/file";
import type { FileBlob as DBFileBlob } from "../../db/schema/file-blob";
import type { FileVersion as DBFileVersion } from "../../db/schema/file-version";
import type { FileRecord, FileBlobRecord, FileVersionRecord, FileStatus } from "@shared/types/file.types";

export function toFileRecord(dbFile: DBFile): FileRecord {
  return {
    ...dbFile,
    status: dbFile.status as FileStatus,
    tags: dbFile.tags ?? [],
    createdAt: dbFile.createdAt.toISOString(),
    updatedAt: dbFile.updatedAt.toISOString(),
    trashedAt: dbFile.trashedAt?.toISOString() ?? null,
    deletedAt: dbFile.deletedAt?.toISOString() ?? null,
  };
}

export function toFileBlobRecord(dbBlob: DBFileBlob): FileBlobRecord {
  return {
    ...dbBlob,
    createdAt: dbBlob.createdAt.toISOString(),
    updatedAt: dbBlob.updatedAt.toISOString(),
  };
}

export function toFileVersionRecord(dbVersion: DBFileVersion): FileVersionRecord {
  return {
    id: dbVersion.id,
    fileId: dbVersion.fileId,
    blobId: dbVersion.blobId,
    versionNumber: dbVersion.versionNumber,
    sizeBytes: dbVersion.sizeBytes,
    createdBy: dbVersion.createdBy,
    comment: dbVersion.comment,
    createdAt: dbVersion.createdAt.toISOString(),
    updatedAt: dbVersion.updatedAt.toISOString(),
  };
}
