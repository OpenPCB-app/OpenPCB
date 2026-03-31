import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { bookmark, type Bookmark, type NewBookmark } from "../schema/bookmark";
import { message } from "../schema/message";
import { BaseRepository } from "./base";
import { eq, and, desc, sql } from "drizzle-orm";
import { withQueryLogging } from "../decorators";
import type { BookmarkWithMessage } from "@shared/types/bookmark.types";

export class BookmarkRepository extends BaseRepository<
  typeof bookmark,
  Bookmark,
  NewBookmark
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, bookmark, logger, "Bookmark");
  }

  async findByWorkspace(workspaceId: string): Promise<BookmarkWithMessage[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByWorkspace",
      async () => {
        const result = await this.db
          .select({
            id: bookmark.id,
            workspaceId: bookmark.workspaceId,
            chatId: bookmark.chatId,
            messageId: bookmark.messageId,
            note: bookmark.note,
            createdAt: bookmark.createdAt,
            messageRole: message.role,
            messageContent: message.content,
            messageChatId: message.chatId,
          })
          .from(bookmark)
          .leftJoin(message, eq(bookmark.messageId, message.id))
          .where(eq(bookmark.workspaceId, workspaceId))
          .orderBy(desc(bookmark.createdAt));

        return result.map((row) => ({
          id: row.id,
          workspaceId: row.workspaceId,
          chatId: row.chatId,
          messageId: row.messageId,
          note: row.note,
          createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
          message: row.messageId
            ? {
                id: row.messageId,
                role: row.messageRole ?? "user",
                content: row.messageContent,
                chatId: row.messageChatId ?? "",
              }
            : null,
        }));
      },
    );
  }

  async findByChat(chatId: string): Promise<BookmarkWithMessage[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByChat",
      async () => {
        const result = await this.db
          .select({
            id: bookmark.id,
            workspaceId: bookmark.workspaceId,
            chatId: bookmark.chatId,
            messageId: bookmark.messageId,
            note: bookmark.note,
            createdAt: bookmark.createdAt,
            messageRole: message.role,
            messageContent: message.content,
            messageChatId: message.chatId,
          })
          .from(bookmark)
          .leftJoin(message, eq(bookmark.messageId, message.id))
          .where(eq(bookmark.chatId, chatId))
          .orderBy(desc(bookmark.createdAt));

        return result.map((row) => ({
          id: row.id,
          workspaceId: row.workspaceId,
          chatId: row.chatId,
          messageId: row.messageId,
          note: row.note,
          createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
          message: row.messageId
            ? {
                id: row.messageId,
                role: row.messageRole ?? "user",
                content: row.messageContent,
                chatId: row.messageChatId ?? "",
              }
            : null,
        }));
      },
    );
  }

  async findByMessageId(messageId: string): Promise<Bookmark | null> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByMessageId",
      async () => {
        const result = await this.db
          .select()
          .from(bookmark)
          .where(eq(bookmark.messageId, messageId))
          .limit(1);
        return result[0] ?? null;
      },
    );
  }

  async existsForMessage(
    workspaceId: string,
    messageId: string,
  ): Promise<boolean> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "existsForMessage",
      async () => {
        const result = await this.db
          .select({ count: sql<number>`count(*)` })
          .from(bookmark)
          .where(
            and(
              eq(bookmark.workspaceId, workspaceId),
              eq(bookmark.messageId, messageId),
            ),
          );
        return (result[0]?.count ?? 0) > 0;
      },
    );
  }

  async deleteByMessageId(messageId: string): Promise<void> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "deleteByMessageId",
      async () => {
        await this.db.delete(bookmark).where(eq(bookmark.messageId, messageId));
      },
    );
  }
}
