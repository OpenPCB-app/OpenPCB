/**
 * Message Repository
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { message, type Message, type NewMessage } from "../schema/message";
import { BaseRepository } from "./base";
import { eq, and, isNull, asc, sql, inArray, lt, isNotNull } from "drizzle-orm";
import { parseSQLiteError } from "../errors";

export class MessageRepository extends BaseRepository<
  typeof message,
  Message,
  NewMessage
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, message, logger, "Message");
  }

  /**
   * Find messages by chat
   */
  async findByChat(chatId: string): Promise<Message[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(message)
        .where(and(eq(message.chatId, chatId), isNull(message.deletedAt)))
        .orderBy(asc(message.createdAt));

      const duration = performance.now() - start;
      this.logger.logQuery("Message.findByChat", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Message.findByChat [FAILED]", duration);
      throw parseSQLiteError(err, "Message.findByChat");
    }
  }

  /**
   * Find active conversation path (isActive = true)
   */
  async findActivePath(chatId: string): Promise<Message[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(message)
        .where(
          and(
            eq(message.chatId, chatId),
            eq(message.isActive, true),
            isNull(message.deletedAt),
          ),
        )
        .orderBy(asc(message.depth), asc(message.createdAt));

      const duration = performance.now() - start;
      this.logger.logQuery("Message.findActivePath", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Message.findActivePath [FAILED]", duration);
      throw parseSQLiteError(err, "Message.findActivePath");
    }
  }

  /**
   * Find branches for a message (same parent, different branchIndex)
   */
  async findBranches(parentMessageId: string): Promise<Message[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(message)
        .where(
          and(
            eq(message.parentMessageId, parentMessageId),
            isNull(message.deletedAt),
          ),
        )
        .orderBy(asc(message.branchIndex));

      const duration = performance.now() - start;
      this.logger.logQuery("Message.findBranches", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Message.findBranches [FAILED]", duration);
      throw parseSQLiteError(err, "Message.findBranches");
    }
  }

  /**
   * Find message by task ID
   */
  async findByTaskId(taskId: string): Promise<Message | null> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(message)
        .where(and(eq(message.taskId, taskId), isNull(message.deletedAt)))
        .limit(1);

      const duration = performance.now() - start;
      this.logger.logQuery("Message.findByTaskId", duration);
      return result[0] ?? null;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Message.findByTaskId [FAILED]", duration);
      throw parseSQLiteError(err, "Message.findByTaskId");
    }
  }

  /**
   * Create a new branch message
   */
  async createBranch(
    data: Omit<NewMessage, "id" | "createdAt" | "updatedAt" | "branchIndex">,
  ): Promise<Message> {
    const start = performance.now();
    try {
      // Find max branchIndex for this parent
      const siblings = data.parentMessageId
        ? await this.findBranches(data.parentMessageId)
        : [];

      const maxBranchIndex =
        siblings.length > 0
          ? Math.max(...siblings.map((s) => s.branchIndex))
          : -1;

      const newMessage = await this.create({
        ...data,
        branchIndex: maxBranchIndex + 1,
      });

      const duration = performance.now() - start;
      this.logger.logQuery("Message.createBranch", duration);
      return newMessage;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Message.createBranch [FAILED]", duration);
      throw parseSQLiteError(err, "Message.createBranch");
    }
  }

  /**
   * Set message as active in conversation path
   */
  async setActive(id: string, chatId: string): Promise<void> {
    const start = performance.now();
    try {
      // Deactivate all messages at this depth
      const msg = await this.findByIdOrThrow(id);

      await this.db
        .update(message)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(message.chatId, chatId), eq(message.depth, msg.depth)));

      // Activate this message
      await this.update(id, { isActive: true });

      const duration = performance.now() - start;
      this.logger.logQuery("Message.setActive", duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Message.setActive [FAILED]", duration);
      throw parseSQLiteError(err, "Message.setActive");
    }
  }

  async search(
    query: string,
    options?: { workspaceId?: string; chatId?: string; limit?: number },
  ): Promise<Message[]> {
    const start = performance.now();
    try {
      const limit = options?.limit ?? 50;

      // Sanitize FTS5 special characters to prevent query injection
      const sanitizedQuery = query
        .replace(/["*^]/g, "")
        .replace(/[()]/g, " ")
        .trim();

      if (!sanitizedQuery) {
        return [];
      }

      const ftsQuery = sql`
        SELECT m.id
        FROM message m
        INNER JOIN message_fts fts ON m.rowid = fts.rowid
        INNER JOIN chat c ON m.chat_id = c.id
        WHERE message_fts MATCH ${sanitizedQuery}
        AND m.deleted_at IS NULL
        ${options?.workspaceId ? sql`AND c.workspace_id = ${options.workspaceId}` : sql``}
        ${options?.chatId ? sql`AND m.chat_id = ${options.chatId}` : sql``}
        ORDER BY bm25(message_fts)
        LIMIT ${limit}
      `;
      const resultRows = await this.db.all<{ id: string }>(ftsQuery);
      if (resultRows.length === 0) {
        const duration = performance.now() - start;
        this.logger.logQuery("Message.search", duration);
        return [];
      }

      const resultIds = resultRows.map((row) => row.id);
      const result = await this.db
        .select()
        .from(message)
        .where(inArray(message.id, resultIds));
      const messageById = new Map(result.map((row) => [row.id, row]));
      const ordered = resultIds
        .map((id) => messageById.get(id))
        .filter((row): row is Message => row !== undefined);

      const duration = performance.now() - start;
      this.logger.logQuery("Message.search", duration);
      return ordered;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Message.search [FAILED]", duration);
      throw parseSQLiteError(err, "Message.search");
    }
  }

  async cleanupInactiveBranches(retentionDays: number = 90): Promise<number> {
    const start = performance.now();
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const inactiveBranches = await this.db
        .select({ id: message.id })
        .from(message)
        .where(
          and(
            eq(message.isActive, false),
            isNull(message.deletedAt),
            lt(message.updatedAt, cutoffDate),
          ),
        );

      if (inactiveBranches.length === 0) {
        const duration = performance.now() - start;
        this.logger.logQuery(
          "Message.cleanupInactiveBranches (0 found)",
          duration,
        );
        return 0;
      }

      const ids = inactiveBranches.map((m) => m.id);
      const now = new Date();

      await this.db
        .update(message)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(message.id, ids));

      const duration = performance.now() - start;
      this.logger.logQuery(
        `Message.cleanupInactiveBranches (${ids.length} archived)`,
        duration,
      );
      return ids.length;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery(
        "Message.cleanupInactiveBranches [FAILED]",
        duration,
      );
      throw parseSQLiteError(err, "Message.cleanupInactiveBranches");
    }
  }

  async hardDeleteSoftDeleted(retentionDays: number = 180): Promise<number> {
    const start = performance.now();
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const toDelete = await this.db
        .select({ id: message.id })
        .from(message)
        .where(
          and(isNotNull(message.deletedAt), lt(message.deletedAt, cutoffDate)),
        );

      if (toDelete.length === 0) {
        const duration = performance.now() - start;
        this.logger.logQuery(
          "Message.hardDeleteSoftDeleted (0 found)",
          duration,
        );
        return 0;
      }

      const ids = toDelete.map((m) => m.id);

      await this.db.delete(message).where(inArray(message.id, ids));

      const duration = performance.now() - start;
      this.logger.logQuery(
        `Message.hardDeleteSoftDeleted (${ids.length} deleted)`,
        duration,
      );
      return ids.length;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Message.hardDeleteSoftDeleted [FAILED]", duration);
      throw parseSQLiteError(err, "Message.hardDeleteSoftDeleted");
    }
  }
}
