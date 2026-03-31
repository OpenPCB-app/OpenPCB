/**
 * Module File Utilities
 *
 * Provides module-friendly file operations with context auto-injection.
 * Simplifies file API for module developers.
 */

import type {
  FileRecord,
  FileVersionRecord,
  FileQueryParams,
} from "@shared/types/file.types";
import * as fileClient from "@shared/sdk/file-client";

export interface ModuleFileContext {
  workspaceId: string;
  projectId?: string;
  spaceId?: string;
}

export interface UploadOptions {
  tags?: string[];
  metadata?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  process?: boolean;
}

export interface ChunkedUploadOptions extends UploadOptions {
  chunkSize?: number;
  onProgress?: (progress: number) => void;
}

export interface FileFilters {
  mimeType?: string;
  status?: "active" | "trashed";
  tags?: string[];
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

/**
 * ModuleFileClient - File operations with auto-injected context
 *
 * Usage:
 * ```ts
 * const files = new ModuleFileClient({ workspaceId: "..." });
 * const file = await files.upload(blob);
 * ```
 */
export class ModuleFileClient {
  constructor(private context: ModuleFileContext) {}

  /**
   * Upload a file
   */
  async upload(file: File | Blob, options?: UploadOptions): Promise<FileRecord> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("workspaceId", this.context.workspaceId);

    if (this.context.projectId) {
      formData.append("projectId", this.context.projectId);
    }
    if (this.context.spaceId) {
      formData.append("spaceId", this.context.spaceId);
    }
    if (options?.tags) {
      formData.append("tags", JSON.stringify(options.tags));
    }
    if (options?.metadata) {
      formData.append("metadata", JSON.stringify(options.metadata));
    }
    if (options?.permissions) {
      formData.append("permissions", JSON.stringify(options.permissions));
    }

    return await fileClient.uploadFile(formData);
  }

  /**
   * Upload a large file using chunked upload
   */
  async uploadChunked(file: File, options?: ChunkedUploadOptions): Promise<FileRecord> {
    return await fileClient.uploadFileChunked(
      file,
      {
        workspaceId: this.context.workspaceId,
        projectId: this.context.projectId,
        spaceId: this.context.spaceId,
      },
      {
        chunkSize: options?.chunkSize,
        onProgress: options?.onProgress,
      }
    );
  }

  /**
   * Get file metadata
   */
  async getMetadata(fileId: string): Promise<FileRecord> {
    return await fileClient.getFileMeta(fileId);
  }

  /**
   * List files in current context
   */
  async list(filters?: FileFilters): Promise<FileRecord[]> {
    const params: FileQueryParams = {
      workspaceId: this.context.workspaceId,
      projectId: this.context.projectId,
      spaceId: this.context.spaceId,
      ...filters,
    };
    return await fileClient.listFiles(params);
  }

  /**
   * Delete file (move to trash)
   */
  async delete(fileId: string): Promise<FileRecord> {
    return await fileClient.softDeleteFile(fileId);
  }

  /**
   * Restore file from trash
   */
  async restore(fileId: string): Promise<FileRecord> {
    return await fileClient.restoreFile(fileId);
  }

  /**
   * Update file metadata
   */
  async updateMetadata(fileId: string, metadata: Record<string, unknown>): Promise<FileRecord> {
    return await fileClient.updateFileMetadata(fileId, metadata);
  }

  // Versioning

  /**
   * Upload a new version of a file
   */
  async uploadVersion(fileId: string, file: File | Blob, comment?: string): Promise<FileVersionRecord> {
    const result = await fileClient.uploadVersion(fileId, file, { comment });
    return result.version;
  }

  /**
   * List all versions of a file
   */
  async listVersions(fileId: string): Promise<FileVersionRecord[]> {
    return await fileClient.listVersions(fileId);
  }

  /**
   * Restore a previous version
   */
  async restoreVersion(fileId: string, version: number): Promise<FileRecord> {
    return await fileClient.restoreVersion(fileId, version);
  }

  // Utilities

  /**
   * Get content URL for a file
   */
  getContentUrl(fileId: string): string {
    return `/api/files/${encodeURIComponent(fileId)}/content`;
  }

  /**
   * Get thumbnail URL for a file
   */
  getThumbnailUrl(fileId: string): string {
    return `/api/files/${encodeURIComponent(fileId)}/thumbnail`;
  }

  /**
   * Get version content URL
   */
  getVersionContentUrl(fileId: string, version: number): string {
    return `/api/files/${encodeURIComponent(fileId)}/versions/${version}/content`;
  }
}

/**
 * Create a file client with context
 */
export function createFileClient(context: ModuleFileContext): ModuleFileClient {
  return new ModuleFileClient(context);
}

// Batch operations

/**
 * Upload multiple files
 */
export async function uploadFiles(
  files: Array<{ file: File | Blob; options?: UploadOptions }>,
  context: ModuleFileContext
): Promise<FileRecord[]> {
  const client = new ModuleFileClient(context);
  return Promise.all(files.map(({ file, options }) => client.upload(file, options)));
}

/**
 * Delete multiple files
 */
export async function deleteFiles(fileIds: string[]): Promise<void> {
  await Promise.all(fileIds.map(id => fileClient.softDeleteFile(id)));
}

/**
 * Restore multiple files
 */
export async function restoreFiles(fileIds: string[]): Promise<FileRecord[]> {
  return Promise.all(fileIds.map(id => fileClient.restoreFile(id)));
}
