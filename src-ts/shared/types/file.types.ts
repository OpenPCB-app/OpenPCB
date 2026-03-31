export interface FileReferenceRecord {
  id: string;
  messageId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  checksum: string | null;
  metadata: FileMetadata | null;
  createdAt: string;
}

export interface FileMetadata {
  width?: number;
  height?: number;
  duration?: number;
  thumbnailPath?: string;
  [key: string]: unknown;
}

export interface FileReferenceWithChat extends FileReferenceRecord {
  chatId: string | null;
  chatTitle: string | null;
}

export type FileTypeFilter = "image" | "pdf" | "document" | "all";

export interface FileBlobRecord {
  id: string;
  checksum: string;
  sizeBytes: number;
  mimeType: string;
  storagePath: string;
  refCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileRecord {
  id: string;
  blobId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  currentVersion: number;
  workspaceId: string;
  projectId: string | null;
  spaceId: string | null;
  tags: string[];
  permissions: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  status: FileStatus;
  trashedAt: string | null;
  trashedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type FileStatus = "active" | "trashed";

export interface FileContext {
  workspaceId: string;
  projectId?: string | null;
  spaceId?: string | null;
}

export interface FileVersionRecord {
  id: string;
  fileId: string;
  blobId: string;
  versionNumber: number;
  sizeBytes: number;
  createdBy: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadVersionInput {
  buffer: Buffer;
  createdBy?: string;
  comment?: string;
}

export interface FileVersionResult {
  version: FileVersionRecord;
  file: FileRecord;
}

// Chunked upload types

export interface InitiateUploadRequest {
  originalName: string;
  mimeType: string;
  totalSize: number;
  workspaceId: string;
  projectId?: string;
  spaceId?: string;
  chunkSize?: number;
}

export interface UploadSessionInfo {
  sessionId: string;
  chunkSize: number;
  totalChunks: number;
  expiresAt: string;
}

export interface ChunkUploadResult {
  chunkIndex: number;
  uploadedChunks: number[];
  missingChunks: number[];
  progress: number;
  isComplete: boolean;
}

export interface UploadProgress {
  sessionId: string;
  uploadedChunks: number[];
  missingChunks: number[];
  uploadedSize: number;
  totalSize: number;
  progress: number;
  isComplete: boolean;
}

export interface FileUploadInput {
  file: File | Blob;
  context: FileContext;
  tags?: string[];
  metadata?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
}

export interface FileQueryParams {
  workspaceId?: string;
  projectId?: string;
  spaceId?: string;
  chatId?: string;
  mimeType?: string;
  status?: FileStatus;
  tags?: string[];
  fromDate?: string;
  toDate?: string;
  limit?: number;
  cursor?: string;
}

export interface FileWithBlob extends FileRecord {
  blob: FileBlobRecord;
}
