/**
 * Task Chunk Repository
 *
 * Manages streaming token chunks storage.
 * Supports incremental persistence and efficient replay.
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import {
  taskChunk,
  task,
  type TaskChunk,
  type NewTaskChunk,
} from "../schema/task";
import { BaseRepository } from "./base";
import { eq, and, gt, asc, sql } from "drizzle-orm";
import { withQueryLogging } from "../decorators";
import { generateUUIDv7 } from "../schema/base";

export class TaskChunkRepository extends BaseRepository<
  typeof taskChunk,
  TaskChunk,
  NewTaskChunk
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, taskChunk, logger, "TaskChunk");
  }

  /**
   * Append a single chunk
   */
  async appendChunk(taskId: string, seq: number, content: string): Promise<TaskChunk> {
    return withQueryLogging(this.logger, this.entityName, "appendChunk", async () => {
      const id = generateUUIDv7();
      const now = new Date();

      await this.db.insert(taskChunk).values({
        id,
        taskId,
        seq,
        content,
        createdAt: now,
      });

      return {
        id,
        taskId,
        seq,
        content,
        createdAt: now,
      };
    });
  }

  /**
   * Append multiple chunks in a batch (more efficient)
   */
  async appendChunks(
    taskId: string,
    chunks: Array<{ seq: number; content: string }>
  ): Promise<number> {
    return withQueryLogging(this.logger, this.entityName, "appendChunks", async () => {
      if (chunks.length === 0) return 0;

      const now = new Date();
      const values = chunks.map((chunk) => ({
        id: generateUUIDv7(),
        taskId,
        seq: chunk.seq,
        content: chunk.content,
        createdAt: now,
      }));

      await this.db.insert(taskChunk).values(values);
      return chunks.length;
    });
  }

  /**
   * Get all chunks for a task, optionally starting from a sequence number
   */
  async getChunks(taskId: string, fromSeq?: number): Promise<TaskChunk[]> {
    return withQueryLogging(this.logger, this.entityName, "getChunks", async () => {
      let query = this.db
        .select()
        .from(taskChunk)
        .where(
          fromSeq !== undefined
            ? and(eq(taskChunk.taskId, taskId), gt(taskChunk.seq, fromSeq))
            : eq(taskChunk.taskId, taskId)
        )
        .orderBy(asc(taskChunk.seq));

      return await query;
    });
  }

  /**
   * Get the final concatenated text from all chunks
   */
  async getFinalText(taskId: string): Promise<string> {
    return withQueryLogging(this.logger, this.entityName, "getFinalText", async () => {
      const chunks = await this.db
        .select({ content: taskChunk.content })
        .from(taskChunk)
        .where(eq(taskChunk.taskId, taskId))
        .orderBy(asc(taskChunk.seq));

      return chunks.map((c) => c.content).join("");
    });
  }

  /**
   * Get the highest sequence number for a task
   */
  async getMaxSeq(taskId: string): Promise<number> {
    return withQueryLogging(this.logger, this.entityName, "getMaxSeq", async () => {
      const result = await this.db
        .select({ maxSeq: sql<number>`MAX(${taskChunk.seq})` })
        .from(taskChunk)
        .where(eq(taskChunk.taskId, taskId));

      return result[0]?.maxSeq ?? -1;
    });
  }

  /**
   * Get chunk count for a task
   */
  async getChunkCount(taskId: string): Promise<number> {
    return withQueryLogging(this.logger, this.entityName, "getChunkCount", async () => {
      const result = await this.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(taskChunk)
        .where(eq(taskChunk.taskId, taskId));

      return result[0]?.count ?? 0;
    });
  }

  /**
   * Delete all chunks for a task
   */
  async deleteChunks(taskId: string): Promise<number> {
    return withQueryLogging(this.logger, this.entityName, "deleteChunks", async () => {
      const result = await this.db
        .delete(taskChunk)
        .where(eq(taskChunk.taskId, taskId));

      return (result as any).changes ?? 0;
    });
  }

  /**
   * Cleanup old chunks for completed tasks
   * @param retentionDays Number of days to retain chunks
   * @returns Number of chunks deleted
   */
  async cleanupOldChunks(retentionDays: number = 30): Promise<number> {
    return withQueryLogging(this.logger, this.entityName, "cleanupOldChunks", async () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Delete chunks for completed tasks older than cutoff
      // Using a subquery to find completed tasks
      const result = await this.db.run(sql`
        DELETE FROM ${taskChunk}
        WHERE ${taskChunk.taskId} IN (
          SELECT ${task.id} FROM ${task}
          WHERE ${task.status} = 'completed'
          AND ${task.completedAt} < ${cutoffDate.getTime()}
        )
      `);

      return (result as any).changes ?? 0;
    });
  }

  /**
   * Get total storage size for a task's chunks (in bytes)
   */
  async getStorageSize(taskId: string): Promise<number> {
    return withQueryLogging(this.logger, this.entityName, "getStorageSize", async () => {
      const result = await this.db
        .select({ size: sql<number>`SUM(LENGTH(${taskChunk.content}))` })
        .from(taskChunk)
        .where(eq(taskChunk.taskId, taskId));

      return result[0]?.size ?? 0;
    });
  }
}
