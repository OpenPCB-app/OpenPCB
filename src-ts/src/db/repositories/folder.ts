import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { folder, type Folder, type NewFolder } from "../schema/folder";
import { chat } from "../schema/chat";
import { BaseRepository } from "./base";
import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { withQueryLogging } from "../decorators";
import type { FolderWithChatCount } from "@shared/types/folder.types";

export class FolderRepository extends BaseRepository<
  typeof folder,
  Folder,
  NewFolder
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, folder, logger, "Folder");
  }

  async findByWorkspace(workspaceId: string): Promise<Folder[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByWorkspace",
      async () => {
        return await this.db
          .select()
          .from(folder)
          .where(eq(folder.workspaceId, workspaceId))
          .orderBy(folder.sortOrder, folder.name);
      },
    );
  }

  async findByProject(projectId: string): Promise<Folder[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByProject",
      async () => {
        return await this.db
          .select()
          .from(folder)
          .where(eq(folder.projectId, projectId))
          .orderBy(folder.sortOrder, folder.name);
      },
    );
  }

  async findByWorkspaceWithChatCount(
    workspaceId: string,
  ): Promise<FolderWithChatCount[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByWorkspaceWithChatCount",
      async () => {
        const folders = await this.findByWorkspace(workspaceId);
        return this.attachChatCounts(folders);
      },
    );
  }

  async findByProjectWithChatCount(
    projectId: string,
  ): Promise<FolderWithChatCount[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByProjectWithChatCount",
      async () => {
        const folders = await this.findByProject(projectId);
        return this.attachChatCounts(folders);
      },
    );
  }

  async countChatsInFolder(folderId: string): Promise<number> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "countChatsInFolder",
      async () => {
        const result = await this.db
          .select({ count: sql<number>`count(*)` })
          .from(chat)
          .where(and(eq(chat.folderId, folderId), isNull(chat.deletedAt)));
        return result[0]?.count ?? 0;
      },
    );
  }

  async moveChatsFolderToRoot(folderId: string): Promise<number> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "moveChatsFolderToRoot",
      async () => {
        return this.db.transaction(async (tx) => {
          const result = await tx
            .select({ count: sql<number>`count(*)` })
            .from(chat)
            .where(and(eq(chat.folderId, folderId), isNull(chat.deletedAt)));
          const count = result[0]?.count ?? 0;

          await tx
            .update(chat)
            .set({ folderId: null, updatedAt: new Date() })
            .where(and(eq(chat.folderId, folderId), isNull(chat.deletedAt)));

          return count;
        });
      },
    );
  }

  async deleteChatsInFolder(folderId: string): Promise<number> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "deleteChatsInFolder",
      async () => {
        return this.db.transaction(async (tx) => {
          const result = await tx
            .select({ count: sql<number>`count(*)` })
            .from(chat)
            .where(and(eq(chat.folderId, folderId), isNull(chat.deletedAt)));
          const count = result[0]?.count ?? 0;

          await tx
            .update(chat)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(chat.folderId, folderId), isNull(chat.deletedAt)));

          return count;
        });
      },
    );
  }

  private async attachChatCounts(
    folders: Folder[],
  ): Promise<FolderWithChatCount[]> {
    if (folders.length === 0) return [];

    const folderIds = folders.map((f) => f.id);
    const counts = await this.db
      .select({
        folderId: chat.folderId,
        count: sql<number>`count(*)`,
      })
      .from(chat)
      .where(and(inArray(chat.folderId, folderIds), isNull(chat.deletedAt)))
      .groupBy(chat.folderId);

    const countMap = new Map(counts.map((c) => [c.folderId, c.count]));

    return folders.map((f) => ({
      ...f,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
      chatCount: countMap.get(f.id) ?? 0,
    }));
  }
}
