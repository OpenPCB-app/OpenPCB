import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import {
  uploadSession,
  type UploadSession,
  type NewUploadSession,
  type UploadSessionStatus,
} from "../schema/upload-session";
import { BaseRepository } from "./base";
import { eq, and, lt, inArray } from "drizzle-orm";
import { withQueryLogging } from "../decorators";

export class UploadSessionRepository extends BaseRepository<
  typeof uploadSession,
  UploadSession,
  NewUploadSession
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, uploadSession, logger, "UploadSession");
  }

  /**
   * Find active session by ID
   */
  async findActiveById(id: string): Promise<UploadSession | null> {
    return withQueryLogging(this.logger, this.entityName, 'findActiveById', async () => {
      const result = await this.db
        .select()
        .from(uploadSession)
        .where(and(
          eq(uploadSession.id, id),
          eq(uploadSession.status, "active")
        ))
        .limit(1);
      return result[0] ?? null;
    });
  }

  /**
   * Update session progress with uploaded chunk
   */
  async updateProgress(
    id: string,
    chunkIndex: number,
    _chunkSize: number
  ): Promise<UploadSession> {
    return withQueryLogging(this.logger, this.entityName, 'updateProgress', async () => {
      void _chunkSize;
      const session = await this.findByIdOrThrow(id);
      const uploadedChunks = [...(session.uploadedChunks || [])];

      if (!uploadedChunks.includes(chunkIndex)) {
        uploadedChunks.push(chunkIndex);
        uploadedChunks.sort((a, b) => a - b);
      }

      const uploadedSize = uploadedChunks.length * session.chunkSize;

      await this.db
        .update(uploadSession)
        .set({
          uploadedChunks,
          uploadedSize: Math.min(uploadedSize, session.totalSize),
          updatedAt: new Date(),
        })
        .where(eq(uploadSession.id, id));

      return await this.findByIdOrThrow(id);
    });
  }

  /**
   * Mark session as completed with file ID
   */
  async markCompleted(id: string, fileId: string): Promise<UploadSession> {
    return withQueryLogging(this.logger, this.entityName, 'markCompleted', async () => {
      await this.db
        .update(uploadSession)
        .set({
          status: "completed" as UploadSessionStatus,
          fileId,
          uploadedSize: (await this.findByIdOrThrow(id)).totalSize,
          updatedAt: new Date(),
        })
        .where(eq(uploadSession.id, id));

      return await this.findByIdOrThrow(id);
    });
  }

  /**
   * Mark session as failed
   */
  async markFailed(id: string): Promise<UploadSession> {
    return withQueryLogging(this.logger, this.entityName, 'markFailed', async () => {
      await this.db
        .update(uploadSession)
        .set({
          status: "failed" as UploadSessionStatus,
          updatedAt: new Date(),
        })
        .where(eq(uploadSession.id, id));

      return await this.findByIdOrThrow(id);
    });
  }

  /**
   * Find expired sessions
   */
  async findExpired(): Promise<UploadSession[]> {
    return withQueryLogging(this.logger, this.entityName, 'findExpired', async () => {
      return await this.db
        .select()
        .from(uploadSession)
        .where(and(
          eq(uploadSession.status, "active"),
          lt(uploadSession.expiresAt, new Date())
        ));
    });
  }

  /**
   * Mark expired sessions
   */
  async markExpiredSessions(): Promise<number> {
    return withQueryLogging(this.logger, this.entityName, 'markExpiredSessions', async () => {
      const expired = await this.findExpired();
      if (expired.length === 0) return 0;

      await this.db
        .update(uploadSession)
        .set({
          status: "expired" as UploadSessionStatus,
          updatedAt: new Date(),
        })
        .where(inArray(uploadSession.id, expired.map(s => s.id)));

      return expired.length;
    });
  }

  /**
   * Find sessions by workspace
   */
  async findByWorkspace(workspaceId: string): Promise<UploadSession[]> {
    return withQueryLogging(this.logger, this.entityName, 'findByWorkspace', async () => {
      return await this.db
        .select()
        .from(uploadSession)
        .where(eq(uploadSession.workspaceId, workspaceId));
    });
  }

  /**
   * Get missing chunks for a session
   */
  async getMissingChunks(id: string): Promise<number[]> {
    const session = await this.findByIdOrThrow(id);
    const uploadedChunks = new Set(session.uploadedChunks || []);
    const missing: number[] = [];

    for (let i = 0; i < session.totalChunks; i++) {
      if (!uploadedChunks.has(i)) {
        missing.push(i);
      }
    }

    return missing;
  }

  /**
   * Check if all chunks are uploaded
   */
  async isComplete(id: string): Promise<boolean> {
    const session = await this.findByIdOrThrow(id);
    const uploadedChunks = session.uploadedChunks || [];
    return uploadedChunks.length >= session.totalChunks;
  }
}
