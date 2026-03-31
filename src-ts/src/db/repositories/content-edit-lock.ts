/**
 * Content Edit Lock Repository
 *
 * Manages locks for concurrent edit protection.
 * Uses optimistic locking with TTL-based expiration.
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import {
  contentEditLock,
  DEFAULT_LOCK_TTL_MS,
  type ContentEditLock,
  type NewContentEditLock,
} from "../schema/content-edit-lock";
import { BaseRepository } from "./base";
import { eq, and, lt, sql } from "drizzle-orm";
import { parseSQLiteError, DbConflictError } from "../errors";
import { generateUUIDv7 } from "../schema/base";

export class ContentEditLockRepository extends BaseRepository<
  typeof contentEditLock,
  ContentEditLock,
  NewContentEditLock
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, contentEditLock, logger, "ContentEditLock");
  }

  /**
   * Acquire a lock for editing a target
   *
   * @throws DbConflictError if target is already locked
   * @returns The acquired lock
   */
  async acquireLock(
    targetType: string,
    targetId: string,
    editId: string,
    options?: {
      ttlMs?: number;
      acquiredBy?: string;
    }
  ): Promise<ContentEditLock> {
    const start = performance.now();
    const ttlMs = options?.ttlMs ?? DEFAULT_LOCK_TTL_MS;

    try {
      // First, clean up any expired locks for this target
      await this.releaseExpiredLock(targetType, targetId);

      // Check if lock exists
      const existing = await this.findLock(targetType, targetId);
      if (existing) {
        throw new DbConflictError(
          `Target ${targetType}:${targetId} is already locked by edit ${existing.editId}`,
          "ContentEditLock",
          existing.id
        );
      }

      // Create new lock
      const id = generateUUIDv7();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMs);

      await this.db.insert(contentEditLock).values({
        id,
        targetType,
        targetId,
        editId,
        acquiredBy: options?.acquiredBy ?? null,
        acquiredAt: now,
        expiresAt,
      });

      const result = await this.findByIdOrThrow(id);
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.acquireLock", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.acquireLock [FAILED]", duration);

      // Re-throw conflict errors
      if (err instanceof DbConflictError) {
        throw err;
      }

      // Handle unique constraint violation (race condition)
      const parsed = parseSQLiteError(err, "ContentEditLock.acquireLock");
      if (parsed.message.includes("UNIQUE constraint")) {
        throw new DbConflictError(
          `Target ${targetType}:${targetId} is already locked`,
          "ContentEditLock",
          `${targetType}:${targetId}`
        );
      }
      throw parsed;
    }
  }

  /**
   * Release a lock by edit ID
   */
  async releaseLock(editId: string): Promise<boolean> {
    const start = performance.now();
    try {
      const result = await this.db
        .delete(contentEditLock)
        .where(eq(contentEditLock.editId, editId))
        .returning();

      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.releaseLock", duration);
      return result.length > 0;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.releaseLock [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditLock.releaseLock");
    }
  }

  /**
   * Release lock by target
   */
  async releaseLockByTarget(targetType: string, targetId: string): Promise<boolean> {
    const start = performance.now();
    try {
      const result = await this.db
        .delete(contentEditLock)
        .where(
          and(
            eq(contentEditLock.targetType, targetType),
            eq(contentEditLock.targetId, targetId)
          )
        )
        .returning();

      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.releaseLockByTarget", duration);
      return result.length > 0;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.releaseLockByTarget [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditLock.releaseLockByTarget");
    }
  }

  /**
   * Find lock for a target
   */
  async findLock(targetType: string, targetId: string): Promise<ContentEditLock | null> {
    const start = performance.now();
    try {
      const now = new Date();
      const result = await this.db
        .select()
        .from(contentEditLock)
        .where(
          and(
            eq(contentEditLock.targetType, targetType),
            eq(contentEditLock.targetId, targetId),
            // Only return non-expired locks (expiresAt > now)
            sql`${contentEditLock.expiresAt} > ${now.getTime()}`
          )
        )
        .limit(1);

      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.findLock", duration);
      return result[0] ?? null;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.findLock [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditLock.findLock");
    }
  }

  /**
   * Check if target is locked
   */
  async isLocked(targetType: string, targetId: string): Promise<boolean> {
    const lock = await this.findLock(targetType, targetId);
    return lock !== null;
  }

  /**
   * Extend lock TTL
   */
  async extendLock(editId: string, additionalMs?: number): Promise<boolean> {
    const start = performance.now();
    const extension = additionalMs ?? DEFAULT_LOCK_TTL_MS;

    try {
      const existing = await this.db
        .select()
        .from(contentEditLock)
        .where(eq(contentEditLock.editId, editId))
        .limit(1);

      if (!existing[0]) {
        return false;
      }

      const newExpiry = new Date(Date.now() + extension);
      await this.db
        .update(contentEditLock)
        .set({ expiresAt: newExpiry })
        .where(eq(contentEditLock.editId, editId));

      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.extendLock", duration);
      return true;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.extendLock [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditLock.extendLock");
    }
  }

  /**
   * Release expired lock for a specific target
   */
  private async releaseExpiredLock(targetType: string, targetId: string): Promise<void> {
    const start = performance.now();
    try {
      const now = new Date();
      await this.db
        .delete(contentEditLock)
        .where(
          and(
            eq(contentEditLock.targetType, targetType),
            eq(contentEditLock.targetId, targetId),
            lt(contentEditLock.expiresAt, now)
          )
        );

      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.releaseExpiredLock", duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.releaseExpiredLock [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditLock.releaseExpiredLock");
    }
  }

  /**
   * Cleanup all expired locks (maintenance task)
   */
  async cleanupExpired(): Promise<number> {
    const start = performance.now();
    try {
      const now = new Date();
      const result = await this.db
        .delete(contentEditLock)
        .where(lt(contentEditLock.expiresAt, now))
        .returning();

      const duration = performance.now() - start;
      this.logger.logQuery(`ContentEditLock.cleanupExpired (${result.length} deleted)`, duration);
      return result.length;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("ContentEditLock.cleanupExpired [FAILED]", duration);
      throw parseSQLiteError(err, "ContentEditLock.cleanupExpired");
    }
  }
}
