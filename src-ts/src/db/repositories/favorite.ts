import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { favorite, type Favorite, type NewFavorite } from "../schema/favorite";
import { chat } from "../schema/chat";
import { BaseRepository } from "./base";
import { eq, and, asc, sql } from "drizzle-orm";
import { withQueryLogging } from "../decorators";
import type { FavoriteWithChat } from "@shared/types/favorite.types";

export class FavoriteRepository extends BaseRepository<
  typeof favorite,
  Favorite,
  NewFavorite
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, favorite, logger, "Favorite");
  }

  async findByWorkspace(workspaceId: string): Promise<FavoriteWithChat[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByWorkspace",
      async () => {
        const result = await this.db
          .select({
            id: favorite.id,
            workspaceId: favorite.workspaceId,
            chatId: favorite.chatId,
            sortOrder: favorite.sortOrder,
            createdAt: favorite.createdAt,
            chatTitle: chat.title,
            chatUpdatedAt: chat.updatedAt,
          })
          .from(favorite)
          .leftJoin(chat, eq(favorite.chatId, chat.id))
          .where(eq(favorite.workspaceId, workspaceId))
          .orderBy(asc(favorite.sortOrder), asc(favorite.createdAt));

        return result.map((row) => ({
          id: row.id,
          workspaceId: row.workspaceId,
          chatId: row.chatId,
          sortOrder: row.sortOrder,
          createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
          chat: row.chatId
            ? {
                id: row.chatId,
                title: row.chatTitle ?? "Untitled",
                updatedAt:
                  row.chatUpdatedAt?.toISOString() ?? new Date().toISOString(),
              }
            : null,
        }));
      },
    );
  }

  async findByChatId(chatId: string): Promise<Favorite | null> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByChatId",
      async () => {
        const result = await this.db
          .select()
          .from(favorite)
          .where(eq(favorite.chatId, chatId))
          .limit(1);
        return result[0] ?? null;
      },
    );
  }

  async existsForChat(workspaceId: string, chatId: string): Promise<boolean> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "existsForChat",
      async () => {
        const result = await this.db
          .select({ count: sql<number>`count(*)` })
          .from(favorite)
          .where(
            and(
              eq(favorite.workspaceId, workspaceId),
              eq(favorite.chatId, chatId),
            ),
          );
        return (result[0]?.count ?? 0) > 0;
      },
    );
  }

  async deleteByChatId(chatId: string): Promise<void> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "deleteByChatId",
      async () => {
        await this.db.delete(favorite).where(eq(favorite.chatId, chatId));
      },
    );
  }

  async getMaxSortOrder(workspaceId: string): Promise<number> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "getMaxSortOrder",
      async () => {
        const result = await this.db
          .select({ maxOrder: sql<number>`COALESCE(MAX(sort_order), 0)` })
          .from(favorite)
          .where(eq(favorite.workspaceId, workspaceId));
        return result[0]?.maxOrder ?? 0;
      },
    );
  }
}
