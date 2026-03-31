/**
 * Content Edit Snapshot Repository
 *
 * Handles persistence of content snapshots for rollback capability.
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import {
  contentEditSnapshot,
  type ContentEditSnapshot,
  type EditMode,
  type NewContentEditSnapshot,
  type SnapshotStatus,
  type SelectionInfo,
  type TokenUsage,
  type EditError,
} from "../schema/content-edit-snapshot";
import { BaseRepository } from "./base";
import { eq, and, desc, lt, sql } from "drizzle-orm";
import { parseSQLiteError } from "../errors";
import { generateUUIDv7 } from "../schema/base";

export class ContentEditSnapshotRepository extends BaseRepository<
  typeof contentEditSnapshot,
  ContentEditSnapshot,
  NewContentEditSnapshot
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, contentEditSnapshot, logger, "ContentEditSnapshot");
  }

  /**
   * Create a new snapshot for an edit operation
   */
  async createSnapshot(data: {
    editId: string;
    targetType: string;
    targetId: string;
    contentBefore: unknown;
    mode: EditMode;
    selectionInfo?: SelectionInfo | null;
    instruction: string;
    provider: string;
    model: string;
    workspaceId: string;
    expiresAt?: Date;
  }): Promise<ContentEditSnapshot> {
    const start = performance.now();
    try {
      const id = generateUUIDv7();
      const now = new Date();
      // Default expiration: 7 days
      const expiresAt = data.expiresAt ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      await this.db.insert(contentEditSnapshot).values({
        id,
        editId: data.editId,
        targetType: data.targetType,
        targetId: data.targetId,
        contentBefore: data.contentBefore,
        mode: data.mode,
        selectionInfo: data.selectionInfo ?? null,
        instruction: data.instruction,
        provider: data.provider,
        model: data.model,
        workspaceId: data.workspaceId,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        expiresAt,
      });

      const result = await this.findByIdOrThrow(id);
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.createSnapshot", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.createSnapshot [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditSnapshot.createSnapshot");
    }
  }

  /**
   * Find snapshot by edit ID
   */
  async findByEditId(editId: string): Promise<ContentEditSnapshot | null> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(contentEditSnapshot)
        .where(eq(contentEditSnapshot.editId, editId))
        .limit(1);

      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.findByEditId", duration);
      return result[0] ?? null;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.findByEditId [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditSnapshot.findByEditId");
    }
  }

  /**
   * Find snapshots by target
   */
  async findByTarget(
    targetType: string,
    targetId: string,
    options?: { limit?: number; status?: SnapshotStatus }
  ): Promise<ContentEditSnapshot[]> {
    const start = performance.now();
    try {
      const conditions = [
        eq(contentEditSnapshot.targetType, targetType),
        eq(contentEditSnapshot.targetId, targetId),
      ];

      if (options?.status) {
        conditions.push(eq(contentEditSnapshot.status, options.status));
      }

      let query = this.db
        .select()
        .from(contentEditSnapshot)
        .where(and(...conditions))
        .orderBy(desc(contentEditSnapshot.createdAt));

      if (options?.limit) {
        query = query.limit(options.limit) as typeof query;
      }

      const result = await query;
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.findByTarget", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.findByTarget [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditSnapshot.findByTarget");
    }
  }

  /**
   * Mark edit as active (in progress or completed)
   */
  async markActive(editId: string): Promise<void> {
    const start = performance.now();
    try {
      await this.db
        .update(contentEditSnapshot)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(contentEditSnapshot.editId, editId));

      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.markActive", duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.markActive [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditSnapshot.markActive");
    }
  }

  /**
   * Complete edit with final content and token usage
   */
  async completeEdit(
    editId: string,
    data: {
      contentAfter: unknown;
      tokensUsed?: TokenUsage;
    }
  ): Promise<void> {
    const start = performance.now();
    try {
      const now = new Date();
      await this.db
        .update(contentEditSnapshot)
        .set({
          status: "active",
          contentAfter: data.contentAfter,
          tokensUsed: data.tokensUsed ?? null,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(contentEditSnapshot.editId, editId));

      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.completeEdit", duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.completeEdit [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditSnapshot.completeEdit");
    }
  }

  /**
   * Record edit failure
   */
  async failEdit(editId: string, error: EditError): Promise<void> {
    const start = performance.now();
    try {
      const now = new Date();
      await this.db
        .update(contentEditSnapshot)
        .set({
          error,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(contentEditSnapshot.editId, editId));

      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.failEdit", duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.failEdit [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditSnapshot.failEdit");
    }
  }

  /**
   * Mark snapshot as rolled back
   */
  async markRolledBack(editId: string): Promise<void> {
    const start = performance.now();
    try {
      await this.db
        .update(contentEditSnapshot)
        .set({ status: "rolled_back", updatedAt: new Date() })
        .where(eq(contentEditSnapshot.editId, editId));

      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.markRolledBack", duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.markRolledBack [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditSnapshot.markRolledBack");
    }
  }

  /**
   * Get most recent active snapshot for target (for rollback)
   */
  async getMostRecentActive(
    targetType: string,
    targetId: string
  ): Promise<ContentEditSnapshot | null> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(contentEditSnapshot)
        .where(
          and(
            eq(contentEditSnapshot.targetType, targetType),
            eq(contentEditSnapshot.targetId, targetId),
            eq(contentEditSnapshot.status, "active")
          )
        )
        .orderBy(desc(contentEditSnapshot.createdAt))
        .limit(1);

      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.getMostRecentActive", duration);
      return result[0] ?? null;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.getMostRecentActive [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditSnapshot.getMostRecentActive");
    }
  }

  /**
   * Cleanup expired snapshots
   */
  async cleanupExpired(): Promise<number> {
    const start = performance.now();
    try {
      const now = new Date();
      const result = await this.db
        .delete(contentEditSnapshot)
        .where(lt(contentEditSnapshot.expiresAt, now))
        .returning();

      const duration = performance.now() - start;
      this.logger.logQuery(`ContentEditSnapshot.cleanupExpired (${result.length} deleted)`, duration);
      return result.length;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.cleanupExpired [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditSnapshot.cleanupExpired");
    }
  }

  /**
   * Cleanup old snapshots for target (retention policy: keep N most recent)
   */
  async cleanupOldForTarget(
    targetType: string,
    targetId: string,
    keepCount: number = 10
  ): Promise<number> {
    const start = performance.now();
    try {
      // Get IDs to keep (most recent N)
      const toKeep = await this.db
        .select({ id: contentEditSnapshot.id })
        .from(contentEditSnapshot)
        .where(
          and(
            eq(contentEditSnapshot.targetType, targetType),
            eq(contentEditSnapshot.targetId, targetId)
          )
        )
        .orderBy(desc(contentEditSnapshot.createdAt))
        .limit(keepCount);

      const keepIds = toKeep.map((r) => r.id);

      if (keepIds.length === 0) {
        return 0;
      }

      // Delete all except the ones to keep
      const result = await this.db
        .delete(contentEditSnapshot)
        .where(
          and(
            eq(contentEditSnapshot.targetType, targetType),
            eq(contentEditSnapshot.targetId, targetId),
            sql`${contentEditSnapshot.id} NOT IN (${sql.join(
              keepIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
        )
        .returning();

      const duration = performance.now() - start;
      this.logger.logQuery(`ContentEditSnapshot.cleanupOldForTarget (${result.length} deleted)`, duration);
      return result.length;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditSnapshot.cleanupOldForTarget [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditSnapshot.cleanupOldForTarget");
    }
  }
}
