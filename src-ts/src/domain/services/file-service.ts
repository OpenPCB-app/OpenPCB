import type { DatabaseAccess } from "../../db";
import type { FileStorage } from "../../infrastructure/storage/file-storage";
import type {
  FileRecord,
  FileQueryParams,
  FileContext,
  FileWithBlob,
  FileVersionRecord,
  UploadVersionInput,
  FileVersionResult,
} from "@shared/types/file.types";
import { ValidationError, NotFoundError } from "../../core/errors";
import { toFileRecord, toFileVersionRecord } from "../mappers/file-mapper";
import {
  getProcessorRegistry,
  type ProcessingOptions,
  type ProcessingResult,
  DEFAULT_PROCESSING_OPTIONS,
} from "../../infrastructure/processing";
import type { MessageContent, ContentPart } from "../../db/schema/message";

/** Maximum file size: 50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Input for file upload
 */
export interface UploadFileInput {
  /** File buffer content */
  buffer: Buffer;
  /** Original filename */
  originalName: string;
  /** MIME type */
  mimeType: string;
  /** File context (workspace/project/space) */
  context: FileContext;
  /** Optional tags */
  tags?: string[];
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /** Optional permissions */
  permissions?: Record<string, unknown>;
  /** Process file (generate thumbnail, extract metadata) */
  process?: boolean;
  /** Processing options */
  processingOptions?: ProcessingOptions;
}

/**
 * Result of file upload operation
 */
export interface FileUploadResult {
  /** Uploaded file record */
  file: FileRecord;
  /** Whether a new blob was created (false if deduplicated) */
  isNewBlob: boolean;
}

/**
 * FileService interface - File management business logic
 */
export interface IFileService {
  /**
   * Upload a file with content-addressable deduplication
   * @param input - Upload input with buffer and metadata
   * @returns Upload result with file record and deduplication status
   */
  upload(input: UploadFileInput): Promise<FileUploadResult>;

  /**
   * Get file metadata by ID
   * @param id - File ID
   * @returns File record or null if not found
   */
  get(id: string): Promise<FileRecord | null>;

  /**
   * Get file with blob information
   * @param id - File ID
   * @returns File with blob data or null if not found
   */
  getWithBlob(id: string): Promise<FileWithBlob | null>;

  /**
   * Get file content as buffer
   * @param id - File ID
   * @returns File content buffer
   * @throws ValidationError if file not found
   */
  getContent(id: string): Promise<Buffer>;

  /**
   * List files matching query parameters
   * @param params - Query parameters (workspace, project, mime type, etc.)
   * @returns Array of matching file records
   */
  list(params: FileQueryParams): Promise<FileRecord[]>;

  /**
   * Update file metadata
   * @param id - File ID
   * @param metadata - Metadata to merge
   * @returns Updated file record
   */
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<FileRecord>;

  /**
   * Soft delete file (move to trash)
   * @param id - File ID
   * @param userId - Optional user who initiated deletion
   * @returns Updated file record with trashed status
   */
  softDelete(id: string, userId?: string): Promise<FileRecord>;

  /**
   * Restore file from trash
   * @param id - File ID
   * @returns Restored file record
   */
  restore(id: string): Promise<FileRecord>;

  /**
   * Empty trash - permanently delete all trashed files
   * @param contextFilter - Optional filter by workspace/project/space
   * @returns Count of deleted files and freed bytes
   */
  emptyTrash(contextFilter?: FileContext): Promise<{ deletedCount: number; freedBytes: number }>;

  /**
   * Hard delete file (permanent removal)
   * @param id - File ID
   */
  hardDelete(id: string): Promise<void>;

  /**
   * Cleanup orphaned blobs with zero references
   * @returns Number of deleted blobs
   */
  cleanupOrphanedBlobs(): Promise<number>;

  // Versioning methods

  /**
   * Upload a new version of an existing file
   * @param fileId - File ID to create version for
   * @param input - Version upload input with buffer and optional metadata
   * @returns Version result with new version and updated file
   */
  uploadVersion(fileId: string, input: UploadVersionInput): Promise<FileVersionResult>;

  /**
   * List all versions of a file
   * @param fileId - File ID
   * @returns Array of version records, ordered by version number descending
   */
  listVersions(fileId: string): Promise<FileVersionRecord[]>;

  /**
   * Get a specific version of a file
   * @param fileId - File ID
   * @param version - Version number
   * @returns Version record or null if not found
   */
  getVersion(fileId: string, version: number): Promise<FileVersionRecord | null>;

  /**
   * Get version content as buffer
   * @param fileId - File ID
   * @param version - Version number
   * @returns Version content buffer
   * @throws ValidationError if version not found
   */
  getVersionContent(fileId: string, version: number): Promise<Buffer>;

  /**
   * Restore a previous version as the current version
   * @param fileId - File ID
   * @param version - Version number to restore
   * @returns Updated file record pointing to restored version
   */
  restoreVersion(fileId: string, version: number): Promise<FileRecord>;

  /**
   * Delete a specific version (soft delete, decrements blob ref count)
   * @param fileId - File ID
   * @param version - Version number to delete
   */
  deleteVersion(fileId: string, version: number): Promise<void>;

  // Processing methods

  /**
   * Process a file (generate thumbnail, extract metadata)
   * @param fileId - File ID
   * @param options - Processing options
   * @returns Processing result with thumbnail and metadata
   */
  processFile(fileId: string, options?: ProcessingOptions): Promise<ProcessingResult>;

  /**
   * Get file thumbnail
   * @param fileId - File ID
   * @returns Thumbnail buffer and MIME type, or null if not available
   */
  getThumbnail(fileId: string): Promise<{ buffer: Buffer; mimeType: string } | null>;

  /**
   * Check if a file type can be processed
   * @param mimeType - MIME type to check
   * @returns Whether the type can be processed
   */
  canProcess(mimeType: string): boolean;
}

/**
 * FileService - File management business logic
 *
 * Handles file upload with content-addressable deduplication,
 * metadata management, soft/hard delete, and blob cleanup.
 */
export class FileService implements IFileService {
  constructor(
    private db: DatabaseAccess,
    private storage: FileStorage
  ) {}

  async upload(input: UploadFileInput): Promise<FileUploadResult> {
    if (input.buffer.length > MAX_FILE_SIZE) {
      throw new ValidationError(
        `File size ${input.buffer.length} exceeds maximum ${MAX_FILE_SIZE}`
      );
    }

    if (!input.context.workspaceId) {
      throw new ValidationError("workspaceId is required");
    }

    const checksum = await this.storage.computeChecksum(input.buffer);

    let blob = await this.db.fileBlobs.findByChecksum(checksum);
    let isNewBlob = false;

    if (!blob) {
      const storageInfo = await this.storage.store(input.buffer);

      blob = await this.db.fileBlobs.create({
        checksum: storageInfo.checksum,
        sizeBytes: storageInfo.sizeBytes,
        mimeType: input.mimeType,
        storagePath: storageInfo.storagePath,
        refCount: 0,
      });
      isNewBlob = true;
    }

    await this.db.fileBlobs.incrementRefCount(blob.id);

    const file = await this.db.fileRecords.create({
      blobId: blob.id,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: blob.sizeBytes,
      currentVersion: 1,
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId ?? null,
      spaceId: input.context.spaceId ?? null,
      tags: input.tags ?? [],
      metadata: input.metadata ?? null,
      permissions: input.permissions ?? null,
      status: "active",
      trashedAt: null,
      trashedBy: null,
      deletedAt: null,
    });

    // Create initial version record
    await this.db.fileVersions.create({
      fileId: file.id,
      blobId: blob.id,
      versionNumber: 1,
      sizeBytes: blob.sizeBytes,
      createdBy: null,
      comment: "Initial upload",
    });

    // Process file if requested
    if (input.process) {
      try {
        const processingResult = await this.processFileInternal(
          input.buffer,
          input.mimeType,
          input.processingOptions
        );

        // Store thumbnail if generated
        if (processingResult.thumbnail) {
          await this.storeThumbnail(
            file.id,
            processingResult.thumbnail,
            processingResult.thumbnailMimeType || "image/jpeg"
          );
        }

        // Merge processing metadata with existing metadata
        if (Object.keys(processingResult.metadata).length > 0) {
          const mergedMetadata = {
            ...(input.metadata || {}),
            processing: processingResult.metadata,
          };
          await this.db.fileRecords.update(file.id, { metadata: mergedMetadata });
        }
      } catch (err) {
        // Processing failure should not fail the upload
        console.warn("File processing failed:", err);
      }
    }

    // Refresh file record to get updated metadata
    const updatedFile = await this.db.fileRecords.findById(file.id);
    return { file: toFileRecord(updatedFile || file), isNewBlob };
  }

  async get(id: string): Promise<FileRecord | null> {
    const dbFile = await this.db.fileRecords.findById(id);
    return dbFile ? toFileRecord(dbFile) : null;
  }

  async getWithBlob(id: string): Promise<FileWithBlob | null> {
    return await this.db.fileRecords.findWithBlob(id);
  }

  async getContent(id: string): Promise<Buffer> {
    const fileWithBlob = await this.db.fileRecords.findWithBlob(id);
    
    if (!fileWithBlob) {
      throw new ValidationError("File not found");
    }

    return await this.storage.read(fileWithBlob.blob.storagePath);
  }

  async list(params: FileQueryParams): Promise<FileRecord[]> {
    if (params.chatId) {
      return this.listByChatId(params.chatId);
    }

    const dbFiles = await this.db.fileRecords.query(params);
    return dbFiles.map(toFileRecord);
  }

  private async listByChatId(chatId: string): Promise<FileRecord[]> {
    const messages = await this.db.messages.findByChat(chatId);
    const fileIds = new Set<string>();

    for (const message of messages) {
      for (const fileId of this.extractFileIdsFromContent(message.content)) {
        fileIds.add(fileId);
      }
    }

    const files = await this.db.fileRecords.findByIds(Array.from(fileIds));
    return files.map(toFileRecord);
  }

  async updateMetadata(
    id: string,
    metadata: Record<string, unknown>
  ): Promise<FileRecord> {
    const dbFile = await this.db.fileRecords.update(id, { metadata });
    return toFileRecord(dbFile);
  }

  async softDelete(id: string, userId?: string): Promise<FileRecord> {
    const dbFile = await this.db.fileRecords.updateStatus(id, "trashed", userId);
    return toFileRecord(dbFile);
  }

  async restore(id: string): Promise<FileRecord> {
    const dbFile = await this.db.fileRecords.updateStatus(id, "active");
    return toFileRecord(dbFile);
  }

  async emptyTrash(
    contextFilter?: FileContext,
  ): Promise<{ deletedCount: number; freedBytes: number }> {
    const trashedFiles = await this.db.fileRecords.findTrashed(contextFilter);
    
    let deletedCount = 0;
    let freedBytes = 0;

    for (const file of trashedFiles) {
      await this.hardDelete(file.id);
      deletedCount++;
      freedBytes += file.sizeBytes;
    }

    return { deletedCount, freedBytes };
  }

  async hardDelete(id: string): Promise<void> {
    const fileWithBlob = await this.db.fileRecords.findWithBlob(id);
    
    if (!fileWithBlob) {
      return;
    }

    await this.db.fileRecords.delete(id);

    const newRefCount = await this.db.fileBlobs.decrementRefCount(fileWithBlob.blobId);

    if (newRefCount === 0) {
      await this.storage.delete(fileWithBlob.blob.storagePath);
      await this.db.fileBlobs.delete(fileWithBlob.blobId);
    }
  }

  async cleanupOrphanedBlobs(): Promise<number> {
    const orphanedBlobs = await this.db.fileBlobs.findOrphaned();

    for (const blob of orphanedBlobs) {
      await this.storage.delete(blob.storagePath);
      await this.db.fileBlobs.delete(blob.id);
    }

    return orphanedBlobs.length;
  }

  // Versioning methods

  async uploadVersion(fileId: string, input: UploadVersionInput): Promise<FileVersionResult> {
    // Validate file exists
    const existingFile = await this.db.fileRecords.findById(fileId);
    if (!existingFile) {
      throw new NotFoundError("File", fileId);
    }

    if (input.buffer.length > MAX_FILE_SIZE) {
      throw new ValidationError(
        `File size ${input.buffer.length} exceeds maximum ${MAX_FILE_SIZE}`
      );
    }

    const checksum = await this.storage.computeChecksum(input.buffer);

    // Find or create blob
    let blob = await this.db.fileBlobs.findByChecksum(checksum);

    if (!blob) {
      const storageInfo = await this.storage.store(input.buffer);

      blob = await this.db.fileBlobs.create({
        checksum: storageInfo.checksum,
        sizeBytes: storageInfo.sizeBytes,
        mimeType: existingFile.mimeType,
        storagePath: storageInfo.storagePath,
        refCount: 0,
      });
    }

    await this.db.fileBlobs.incrementRefCount(blob.id);

    // Get next version number
    const nextVersion = await this.db.fileVersions.getNextVersionNumber(fileId);

    // Create version record
    const version = await this.db.fileVersions.create({
      fileId,
      blobId: blob.id,
      versionNumber: nextVersion,
      sizeBytes: blob.sizeBytes,
      createdBy: input.createdBy ?? null,
      comment: input.comment ?? null,
    });

    // Update file to point to new blob and version
    const updatedFile = await this.db.fileRecords.update(fileId, {
      blobId: blob.id,
      sizeBytes: blob.sizeBytes,
      currentVersion: nextVersion,
    });

    return {
      version: toFileVersionRecord(version),
      file: toFileRecord(updatedFile),
    };
  }

  async listVersions(fileId: string): Promise<FileVersionRecord[]> {
    const versions = await this.db.fileVersions.findByFile(fileId);
    return versions.map(toFileVersionRecord);
  }

  async getVersion(fileId: string, version: number): Promise<FileVersionRecord | null> {
    const versionRecord = await this.db.fileVersions.findByFileAndVersion(fileId, version);
    return versionRecord ? toFileVersionRecord(versionRecord) : null;
  }

  async getVersionContent(fileId: string, version: number): Promise<Buffer> {
    const versionRecord = await this.db.fileVersions.findByFileAndVersion(fileId, version);
    if (!versionRecord) {
      throw new ValidationError(`Version ${version} not found for file ${fileId}`);
    }

    const blob = await this.db.fileBlobs.findById(versionRecord.blobId);
    if (!blob) {
      throw new ValidationError(`Blob not found for version ${version}`);
    }

    return await this.storage.read(blob.storagePath);
  }

  async restoreVersion(fileId: string, version: number): Promise<FileRecord> {
    // Get the version to restore
    const versionRecord = await this.db.fileVersions.findByFileAndVersion(fileId, version);
    if (!versionRecord) {
      throw new ValidationError(`Version ${version} not found for file ${fileId}`);
    }

    // Get file
    const existingFile = await this.db.fileRecords.findById(fileId);
    if (!existingFile) {
      throw new NotFoundError("File", fileId);
    }

    // Get the blob from the version to restore
    const blob = await this.db.fileBlobs.findById(versionRecord.blobId);
    if (!blob) {
      throw new ValidationError(`Blob not found for version ${version}`);
    }

    // Create new version as restoration
    const nextVersion = await this.db.fileVersions.getNextVersionNumber(fileId);

    // Increment ref count for the restored blob
    await this.db.fileBlobs.incrementRefCount(blob.id);

    // Create new version record
    await this.db.fileVersions.create({
      fileId,
      blobId: blob.id,
      versionNumber: nextVersion,
      sizeBytes: blob.sizeBytes,
      createdBy: null,
      comment: `Restored from version ${version}`,
    });

    // Update file to point to restored blob
    const updatedFile = await this.db.fileRecords.update(fileId, {
      blobId: blob.id,
      sizeBytes: blob.sizeBytes,
      currentVersion: nextVersion,
    });

    return toFileRecord(updatedFile);
  }

  async deleteVersion(fileId: string, version: number): Promise<void> {
    const versionRecord = await this.db.fileVersions.findByFileAndVersion(fileId, version);
    if (!versionRecord) {
      throw new ValidationError(`Version ${version} not found for file ${fileId}`);
    }

    // Check if this is the current version
    const file = await this.db.fileRecords.findById(fileId);
    if (file && file.currentVersion === version) {
      throw new ValidationError("Cannot delete current version. Restore a different version first.");
    }

    // Delete version record
    await this.db.fileVersions.delete(versionRecord.id);

    // Decrement blob ref count
    const newRefCount = await this.db.fileBlobs.decrementRefCount(versionRecord.blobId);

    // If blob is orphaned, delete it
    if (newRefCount === 0) {
      const blob = await this.db.fileBlobs.findById(versionRecord.blobId);
      if (blob) {
        await this.storage.delete(blob.storagePath);
        await this.db.fileBlobs.delete(blob.id);
      }
    }
  }

  // Processing methods

  async processFile(fileId: string, options?: ProcessingOptions): Promise<ProcessingResult> {
    const fileWithBlob = await this.db.fileRecords.findWithBlob(fileId);
    if (!fileWithBlob) {
      throw new NotFoundError("File", fileId);
    }

    const buffer = await this.storage.read(fileWithBlob.blob.storagePath);
    const result = await this.processFileInternal(buffer, fileWithBlob.mimeType, options);

    // Store thumbnail if generated
    if (result.thumbnail) {
      await this.storeThumbnail(fileId, result.thumbnail, result.thumbnailMimeType || "image/jpeg");
    }

    // Update file metadata with processing results
    if (Object.keys(result.metadata).length > 0) {
      const existingMetadata = (fileWithBlob.metadata as Record<string, unknown>) || {};
      const mergedMetadata = {
        ...existingMetadata,
        processing: result.metadata,
      };
      await this.db.fileRecords.update(fileId, { metadata: mergedMetadata });
    }

    return result;
  }

  async getThumbnail(fileId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const file = await this.db.fileRecords.findById(fileId);
    if (!file) {
      throw new NotFoundError("File", fileId);
    }

    // Check if thumbnail exists in metadata
    const metadata = (file.metadata as Record<string, unknown>) || {};
    const thumbnailBlobId = metadata.thumbnailBlobId as string | undefined;

    if (!thumbnailBlobId) {
      return null;
    }

    const blob = await this.db.fileBlobs.findById(thumbnailBlobId);
    if (!blob) {
      return null;
    }

    const buffer = await this.storage.read(blob.storagePath);
    return { buffer, mimeType: blob.mimeType };
  }

  canProcess(mimeType: string): boolean {
    const registry = getProcessorRegistry();
    return registry.canProcess(mimeType);
  }

  // Private helpers

  private async processFileInternal(
    buffer: Buffer,
    mimeType: string,
    options?: ProcessingOptions
  ): Promise<ProcessingResult> {
    const registry = getProcessorRegistry();
    const processor = registry.getProcessor(mimeType);

    if (!processor) {
      return { metadata: {} };
    }

    const processingOptions = { ...DEFAULT_PROCESSING_OPTIONS, ...options };
    return await processor.process(buffer, processingOptions);
  }

  private async storeThumbnail(
    fileId: string,
    thumbnail: Buffer,
    mimeType: string
  ): Promise<void> {
    // Store thumbnail as a blob
    const checksum = await this.storage.computeChecksum(thumbnail);

    let blob = await this.db.fileBlobs.findByChecksum(checksum);
    if (!blob) {
      const storageInfo = await this.storage.store(thumbnail);
      blob = await this.db.fileBlobs.create({
        checksum: storageInfo.checksum,
        sizeBytes: storageInfo.sizeBytes,
        mimeType,
        storagePath: storageInfo.storagePath,
        refCount: 0,
      });
    }

    await this.db.fileBlobs.incrementRefCount(blob.id);

    // Update file metadata with thumbnail blob ID
    const file = await this.db.fileRecords.findById(fileId);
    if (file) {
      const existingMetadata = (file.metadata as Record<string, unknown>) || {};
      await this.db.fileRecords.update(fileId, {
        metadata: {
          ...existingMetadata,
          thumbnailBlobId: blob.id,
        },
      });
    }
  }

  private extractFileIdsFromContent(content: unknown): string[] {
    const parsed = this.parseMessageContent(content);
    if (!parsed || parsed.type !== "multipart" || !Array.isArray(parsed.parts)) {
      return [];
    }

    const fileIds: string[] = [];
    for (const part of parsed.parts) {
      if (!this.isFileLikePart(part)) {
        continue;
      }

      if (typeof part.fileId === "string" && part.fileId.length > 0) {
        fileIds.push(part.fileId);
      }
    }

    return fileIds;
  }

  private parseMessageContent(content: unknown): MessageContent | null {
    if (typeof content === "string") {
      try {
        return JSON.parse(content) as MessageContent;
      } catch {
        return null;
      }
    }

    if (typeof content === "object" && content !== null) {
      return content as MessageContent;
    }

    return null;
  }

  private isFileLikePart(part: ContentPart): boolean {
    return part.type === "file" || part.type === "image";
  }
}
