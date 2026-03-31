/**
 * Chunked Upload Service
 *
 * Handles resumable file uploads with chunking support.
 * Chunks are stored temporarily and assembled on completion.
 */

import type { DatabaseAccess } from "../../db";
import type { FileStorage } from "../../infrastructure/storage/file-storage";
import type { FileService } from "./file-service";
import type { FileRecord, FileContext } from "@shared/types/file.types";
import { ValidationError, NotFoundError } from "../../core/errors";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/** Default chunk size: 5MB */
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

/** Session expiration: 24 hours */
const SESSION_EXPIRATION_MS = 24 * 60 * 60 * 1000;

/** Maximum file size: 500MB for chunked uploads */
const MAX_CHUNKED_FILE_SIZE = 500 * 1024 * 1024;

export interface InitiateUploadInput {
  originalName: string;
  mimeType: string;
  totalSize: number;
  context: FileContext;
  chunkSize?: number;
}

export interface UploadSessionInfo {
  sessionId: string;
  chunkSize: number;
  totalChunks: number;
  expiresAt: string;
}

export interface ChunkData {
  chunkIndex: number;
  buffer: Buffer;
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

export interface IChunkedUploadService {
  initiate(input: InitiateUploadInput): Promise<UploadSessionInfo>;
  uploadChunk(sessionId: string, chunk: ChunkData): Promise<ChunkUploadResult>;
  complete(sessionId: string): Promise<FileRecord>;
  abort(sessionId: string): Promise<void>;
  getProgress(sessionId: string): Promise<UploadProgress>;
  cleanupExpired(): Promise<number>;
}

export class ChunkedUploadService implements IChunkedUploadService {
  private tempDir: string;

  constructor(
    private db: DatabaseAccess,
    private storage: FileStorage,
    private fileService: FileService,
    basePath: string
  ) {
    this.tempDir = path.join(basePath, "uploads", "chunks");
    this.ensureTempDir();
  }

  private ensureTempDir(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async initiate(input: InitiateUploadInput): Promise<UploadSessionInfo> {
    if (input.totalSize > MAX_CHUNKED_FILE_SIZE) {
      throw new ValidationError(
        `File size ${input.totalSize} exceeds maximum ${MAX_CHUNKED_FILE_SIZE}`
      );
    }

    if (!input.context.workspaceId) {
      throw new ValidationError("workspaceId is required");
    }

    const chunkSize = input.chunkSize || DEFAULT_CHUNK_SIZE;
    const totalChunks = Math.ceil(input.totalSize / chunkSize);
    const expiresAt = new Date(Date.now() + SESSION_EXPIRATION_MS);

    const session = await this.db.uploadSessions.create({
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId ?? null,
      spaceId: input.context.spaceId ?? null,
      originalName: input.originalName,
      mimeType: input.mimeType,
      totalSize: input.totalSize,
      uploadedSize: 0,
      chunkSize,
      totalChunks,
      uploadedChunks: [],
      status: "active",
      expiresAt,
      fileId: null,
    });

    // Create session directory for chunks
    const sessionDir = this.getSessionDir(session.id);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    return {
      sessionId: session.id,
      chunkSize,
      totalChunks,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async uploadChunk(sessionId: string, chunk: ChunkData): Promise<ChunkUploadResult> {
    const session = await this.db.uploadSessions.findActiveById(sessionId);
    if (!session) {
      throw new NotFoundError("UploadSession", sessionId);
    }

    // Validate chunk index
    if (chunk.chunkIndex < 0 || chunk.chunkIndex >= session.totalChunks) {
      throw new ValidationError(
        `Invalid chunk index ${chunk.chunkIndex}. Expected 0-${session.totalChunks - 1}`
      );
    }

    // Check session not expired
    if (new Date() > session.expiresAt) {
      await this.db.uploadSessions.markFailed(sessionId);
      throw new ValidationError("Upload session expired");
    }

    // Store chunk
    const chunkPath = this.getChunkPath(sessionId, chunk.chunkIndex);
    fs.writeFileSync(chunkPath, chunk.buffer);

    // Update session progress
    const updatedSession = await this.db.uploadSessions.updateProgress(
      sessionId,
      chunk.chunkIndex,
      chunk.buffer.length
    );

    const uploadedChunks = updatedSession.uploadedChunks || [];
    const missingChunks = await this.db.uploadSessions.getMissingChunks(sessionId);
    const isComplete = missingChunks.length === 0;

    return {
      chunkIndex: chunk.chunkIndex,
      uploadedChunks,
      missingChunks,
      progress: uploadedChunks.length / session.totalChunks,
      isComplete,
    };
  }

  async complete(sessionId: string): Promise<FileRecord> {
    const session = await this.db.uploadSessions.findActiveById(sessionId);
    if (!session) {
      throw new NotFoundError("UploadSession", sessionId);
    }

    // Verify all chunks are uploaded
    const isComplete = await this.db.uploadSessions.isComplete(sessionId);
    if (!isComplete) {
      const missingChunks = await this.db.uploadSessions.getMissingChunks(sessionId);
      throw new ValidationError(
        `Upload incomplete. Missing chunks: ${missingChunks.join(", ")}`
      );
    }

    // Assemble chunks into final file
    const buffer = await this.assembleChunks(sessionId, session.totalChunks);

    // Upload via FileService
    const result = await this.fileService.upload({
      buffer,
      originalName: session.originalName,
      mimeType: session.mimeType,
      context: {
        workspaceId: session.workspaceId,
        projectId: session.projectId ?? undefined,
        spaceId: session.spaceId ?? undefined,
      },
    });

    // Mark session completed
    await this.db.uploadSessions.markCompleted(sessionId, result.file.id);

    // Cleanup chunks
    this.cleanupSessionDir(sessionId);

    return result.file;
  }

  async abort(sessionId: string): Promise<void> {
    const session = await this.db.uploadSessions.findById(sessionId);
    if (!session) {
      throw new NotFoundError("UploadSession", sessionId);
    }

    // Mark as failed
    await this.db.uploadSessions.markFailed(sessionId);

    // Cleanup chunks
    this.cleanupSessionDir(sessionId);
  }

  async getProgress(sessionId: string): Promise<UploadProgress> {
    const session = await this.db.uploadSessions.findById(sessionId);
    if (!session) {
      throw new NotFoundError("UploadSession", sessionId);
    }

    const uploadedChunks = session.uploadedChunks || [];
    const missingChunks = await this.db.uploadSessions.getMissingChunks(sessionId);

    return {
      sessionId,
      uploadedChunks,
      missingChunks,
      uploadedSize: session.uploadedSize,
      totalSize: session.totalSize,
      progress: uploadedChunks.length / session.totalChunks,
      isComplete: missingChunks.length === 0,
    };
  }

  async cleanupExpired(): Promise<number> {
    const expiredCount = await this.db.uploadSessions.markExpiredSessions();

    // Get expired sessions and cleanup their directories
    const expiredSessions = await this.db.uploadSessions.findExpired();
    for (const session of expiredSessions) {
      this.cleanupSessionDir(session.id);
    }

    return expiredCount;
  }

  // Private helpers

  private getSessionDir(sessionId: string): string {
    return path.join(this.tempDir, sessionId);
  }

  private getChunkPath(sessionId: string, chunkIndex: number): string {
    return path.join(this.getSessionDir(sessionId), `chunk_${chunkIndex}`);
  }

  private async assembleChunks(sessionId: string, totalChunks: number): Promise<Buffer> {
    const chunks: Buffer[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = this.getChunkPath(sessionId, i);
      if (!fs.existsSync(chunkPath)) {
        throw new ValidationError(`Missing chunk ${i}`);
      }
      chunks.push(fs.readFileSync(chunkPath));
    }

    return Buffer.concat(chunks);
  }

  private cleanupSessionDir(sessionId: string): void {
    const sessionDir = this.getSessionDir(sessionId);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`Failed to cleanup session directory ${sessionDir}:`, err);
      }
    }
  }
}
