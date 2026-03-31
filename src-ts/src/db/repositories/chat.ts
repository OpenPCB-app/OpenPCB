/**
 * Chat Repository
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { chat, type Chat, type NewChat } from "../schema/chat";
import { BaseRepository } from "./base";
import { eq, and, isNull, desc, sql, inArray } from "drizzle-orm";
import { parseSQLiteError } from "../errors";

export class ChatRepository extends BaseRepository<typeof chat, Chat, NewChat> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, chat, logger, "Chat");
  }

  /**
   * Find chats by workspace with optional filters
   */
  async findByWorkspace(
    workspaceId: string,
    limit?: number,
    options?: {
      folderId?: string | null;
      excludeCategories?: string[];
      projectId?: string | null;
      category?: string | null;
      contextType?: string;
      contextId?: string;
    },
  ): Promise<Chat[]> {
    const start = performance.now();
    try {
      const conditions = [
        eq(chat.workspaceId, workspaceId),
        isNull(chat.deletedAt),
      ];

      // Filter by folderId if provided
      // null = get chats without a folder (root level)
      // string = get chats in that specific folder
      // undefined = get all chats (no folder filter)
      if (options?.folderId !== undefined) {
        if (options.folderId === null) {
          conditions.push(isNull(chat.folderId));
        } else {
          conditions.push(eq(chat.folderId, options.folderId));
        }
      }

      if (options?.projectId !== undefined) {
        if (options.projectId === null) {
          conditions.push(isNull(chat.projectId));
        } else {
          conditions.push(eq(chat.projectId, options.projectId));
        }
      }

      if (options?.category !== undefined) {
        if (options.category === null) {
          conditions.push(isNull(chat.category));
        } else {
          conditions.push(eq(chat.category, options.category));
        }
      }

      if (options?.contextType) {
        conditions.push(
          sql`json_extract(${chat.metadata}, '$.contextRef.type') = ${options.contextType}`,
        );
      }

      if (options?.contextId) {
        conditions.push(
          sql`json_extract(${chat.metadata}, '$.contextRef.id') = ${options.contextId}`,
        );
      }

      // Exclude specific categories (e.g., 'brainstorming_node')
      if (options?.excludeCategories?.length) {
        for (const cat of options.excludeCategories) {
          conditions.push(
            sql`(${chat.category} IS NULL OR ${chat.category} != ${cat})`
          );
        }
      }

      let query = this.db
        .select()
        .from(chat)
        .where(and(...conditions))
        .orderBy(desc(chat.lastMessageAt));

      if (limit) {
        query = query.limit(limit) as any;
      }

      const result = await query;
      const duration = performance.now() - start;
      this.logger.logQuery("Chat.findByWorkspace", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Chat.findByWorkspace [FAILED]", duration);
      throw parseSQLiteError(err, "Chat.findByWorkspace");
    }
  }

  /**
   * Find pinned chats by workspace
   */
  async findPinned(workspaceId: string): Promise<Chat[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(chat)
        .where(
          and(
            eq(chat.workspaceId, workspaceId),
            eq(chat.isPinned, true),
            isNull(chat.deletedAt),
          ),
        )
        .orderBy(chat.sortOrder, desc(chat.lastMessageAt));

      const duration = performance.now() - start;
      this.logger.logQuery("Chat.findPinned", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Chat.findPinned [FAILED]", duration);
      throw parseSQLiteError(err, "Chat.findPinned");
    }
  }

  /**
   * Increment message count
   */
  async incrementMessageCount(id: string): Promise<void> {
    const start = performance.now();
    try {
      await this.db
        .update(chat)
        .set({
          messageCount: sql`${chat.messageCount} + 1`,
          updatedAt: new Date(),
        } as any)
        .where(eq(chat.id, id));

      const duration = performance.now() - start;
      this.logger.logQuery("Chat.incrementMessageCount", duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Chat.incrementMessageCount [FAILED]", duration);
      throw parseSQLiteError(err, "Chat.incrementMessageCount");
    }
  }

  /**
   * Update last message timestamp
   */
  async updateLastMessage(id: string, timestamp?: number): Promise<void> {
    const start = performance.now();
    try {
      await this.db
        .update(chat)
        .set({
          lastMessageAt: timestamp ? new Date(timestamp) : new Date(),
          updatedAt: new Date(),
        } as any)
        .where(eq(chat.id, id));

      const duration = performance.now() - start;
      this.logger.logQuery("Chat.updateLastMessage", duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Chat.updateLastMessage [FAILED]", duration);
      throw parseSQLiteError(err, "Chat.updateLastMessage");
    }
  }

  /**
   * Toggle pin status
   */
  async togglePin(id: string): Promise<Chat> {
    const start = performance.now();
    try {
      const current = await this.findByIdOrThrow(id);
      const result = await this.update(id, { isPinned: !current.isPinned });

      const duration = performance.now() - start;
      this.logger.logQuery("Chat.togglePin", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Chat.togglePin [FAILED]", duration);
      throw parseSQLiteError(err, "Chat.togglePin");
    }
  }

  async bulkSoftDelete(ids: string[]): Promise<number> {
    const start = performance.now();
    try {
      const now = new Date();
      await this.db
        .update(chat)
        .set({ deletedAt: now, updatedAt: now } as any)
        .where(and(inArray(chat.id, ids), isNull(chat.deletedAt)));

      const duration = performance.now() - start;
      this.logger.logQuery("Chat.bulkSoftDelete", duration);
      return ids.length;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Chat.bulkSoftDelete [FAILED]", duration);
      throw parseSQLiteError(err, "Chat.bulkSoftDelete");
    }
  }
}
