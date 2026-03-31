import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import {
  tag,
  chatTag,
  projectTag,
  type Tag,
  type NewTag,
  type ChatTag,
  type ProjectTag,
} from "../schema/tag";
import { BaseRepository } from "./base";
import { eq, and, or, isNull, asc, sql } from "drizzle-orm";
import { withQueryLogging } from "../decorators";
import { generateUUIDv7 } from "../schema/base";

export class TagRepository extends BaseRepository<typeof tag, Tag, NewTag> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, tag, logger, "Tag");
  }

  async findByWorkspace(workspaceId: string): Promise<Tag[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByWorkspace",
      async () => {
        return this.db
          .select()
          .from(tag)
          .where(eq(tag.workspaceId, workspaceId))
          .orderBy(asc(tag.sortOrder), asc(tag.name));
      },
    );
  }

  async findWorkspaceLevelTags(workspaceId: string): Promise<Tag[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findWorkspaceLevelTags",
      async () => {
        return this.db
          .select()
          .from(tag)
          .where(and(eq(tag.workspaceId, workspaceId), isNull(tag.projectId)))
          .orderBy(asc(tag.sortOrder), asc(tag.name));
      },
    );
  }

  async findByProject(projectId: string): Promise<Tag[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByProject",
      async () => {
        return this.db
          .select()
          .from(tag)
          .where(eq(tag.projectId, projectId))
          .orderBy(asc(tag.sortOrder), asc(tag.name));
      },
    );
  }

  async findAvailableForProject(
    workspaceId: string,
    projectId: string,
  ): Promise<Tag[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findAvailableForProject",
      async () => {
        return this.db
          .select()
          .from(tag)
          .where(
            and(
              eq(tag.workspaceId, workspaceId),
              or(isNull(tag.projectId), eq(tag.projectId, projectId)),
            ),
          )
          .orderBy(asc(tag.sortOrder), asc(tag.name));
      },
    );
  }

  async existsInScope(
    workspaceId: string,
    projectId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<boolean> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "existsInScope",
      async () => {
        const conditions = [
          eq(tag.workspaceId, workspaceId),
          eq(tag.name, name),
        ];

        if (projectId) {
          conditions.push(eq(tag.projectId, projectId));
        } else {
          conditions.push(isNull(tag.projectId));
        }

        const result = await this.db
          .select({ count: sql<number>`count(*)` })
          .from(tag)
          .where(and(...conditions));

        const count = result[0]?.count ?? 0;

        if (excludeId && count === 1) {
          const existing = await this.db
            .select()
            .from(tag)
            .where(and(...conditions))
            .limit(1);
          return existing[0]?.id !== excludeId;
        }

        return count > 0;
      },
    );
  }

  async getMaxSortOrder(
    workspaceId: string,
    projectId: string | null,
  ): Promise<number> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "getMaxSortOrder",
      async () => {
        const conditions = [eq(tag.workspaceId, workspaceId)];
        if (projectId) {
          conditions.push(eq(tag.projectId, projectId));
        } else {
          conditions.push(isNull(tag.projectId));
        }

        const result = await this.db
          .select({ maxOrder: sql<number>`COALESCE(MAX(sort_order), 0)` })
          .from(tag)
          .where(and(...conditions));

        return result[0]?.maxOrder ?? 0;
      },
    );
  }

  async addTagToChat(chatId: string, tagId: string): Promise<ChatTag> {
    return withQueryLogging(
      this.logger,
      "ChatTag",
      "addTagToChat",
      async () => {
        const id = generateUUIDv7();
        await this.db
          .insert(chatTag)
          .values({
            id,
            chatId,
            tagId,
            createdAt: new Date(),
          })
          .onConflictDoNothing();

        const result = await this.db
          .select()
          .from(chatTag)
          .where(and(eq(chatTag.chatId, chatId), eq(chatTag.tagId, tagId)))
          .limit(1);

        if (!result[0]) {
          throw new Error(
            `Failed to create or find ChatTag for chat ${chatId} and tag ${tagId}`,
          );
        }
        return result[0];
      },
    );
  }

  async removeTagFromChat(chatId: string, tagId: string): Promise<void> {
    return withQueryLogging(
      this.logger,
      "ChatTag",
      "removeTagFromChat",
      async () => {
        await this.db
          .delete(chatTag)
          .where(and(eq(chatTag.chatId, chatId), eq(chatTag.tagId, tagId)));
      },
    );
  }

  async findTagsForChat(chatId: string): Promise<Tag[]> {
    return withQueryLogging(
      this.logger,
      "ChatTag",
      "findTagsForChat",
      async () => {
        const result = await this.db
          .select({ tag })
          .from(chatTag)
          .innerJoin(tag, eq(chatTag.tagId, tag.id))
          .where(eq(chatTag.chatId, chatId))
          .orderBy(asc(tag.sortOrder), asc(tag.name));

        return result.map((r) => r.tag);
      },
    );
  }

  async findChatsForTag(tagId: string): Promise<string[]> {
    return withQueryLogging(
      this.logger,
      "ChatTag",
      "findChatsForTag",
      async () => {
        const result = await this.db
          .select({ chatId: chatTag.chatId })
          .from(chatTag)
          .where(eq(chatTag.tagId, tagId));

        return result.map((r) => r.chatId);
      },
    );
  }

  async chatHasTag(chatId: string, tagId: string): Promise<boolean> {
    return withQueryLogging(this.logger, "ChatTag", "chatHasTag", async () => {
      const result = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(chatTag)
        .where(and(eq(chatTag.chatId, chatId), eq(chatTag.tagId, tagId)));

      return (result[0]?.count ?? 0) > 0;
    });
  }

  async removeAllTagsFromChat(chatId: string): Promise<void> {
    return withQueryLogging(
      this.logger,
      "ChatTag",
      "removeAllTagsFromChat",
      async () => {
        await this.db.delete(chatTag).where(eq(chatTag.chatId, chatId));
      },
    );
  }

  async addTagToProject(projectId: string, tagId: string): Promise<ProjectTag> {
    return withQueryLogging(
      this.logger,
      "ProjectTag",
      "addTagToProject",
      async () => {
        const id = generateUUIDv7();
        await this.db
          .insert(projectTag)
          .values({
            id,
            projectId,
            tagId,
            createdAt: new Date(),
          })
          .onConflictDoNothing();

        const result = await this.db
          .select()
          .from(projectTag)
          .where(
            and(
              eq(projectTag.projectId, projectId),
              eq(projectTag.tagId, tagId),
            ),
          )
          .limit(1);

        if (!result[0]) {
          throw new Error(
            `Failed to create or find ProjectTag for project ${projectId} and tag ${tagId}`,
          );
        }
        return result[0];
      },
    );
  }

  async removeTagFromProject(projectId: string, tagId: string): Promise<void> {
    return withQueryLogging(
      this.logger,
      "ProjectTag",
      "removeTagFromProject",
      async () => {
        await this.db
          .delete(projectTag)
          .where(
            and(
              eq(projectTag.projectId, projectId),
              eq(projectTag.tagId, tagId),
            ),
          );
      },
    );
  }

  async findTagsForProject(projectId: string): Promise<Tag[]> {
    return withQueryLogging(
      this.logger,
      "ProjectTag",
      "findTagsForProject",
      async () => {
        const result = await this.db
          .select({ tag })
          .from(projectTag)
          .innerJoin(tag, eq(projectTag.tagId, tag.id))
          .where(eq(projectTag.projectId, projectId))
          .orderBy(asc(tag.sortOrder), asc(tag.name));

        return result.map((r) => r.tag);
      },
    );
  }

  async findProjectsForTag(tagId: string): Promise<string[]> {
    return withQueryLogging(
      this.logger,
      "ProjectTag",
      "findProjectsForTag",
      async () => {
        const result = await this.db
          .select({ projectId: projectTag.projectId })
          .from(projectTag)
          .where(eq(projectTag.tagId, tagId));

        return result.map((r) => r.projectId);
      },
    );
  }

  async projectHasTag(projectId: string, tagId: string): Promise<boolean> {
    return withQueryLogging(
      this.logger,
      "ProjectTag",
      "projectHasTag",
      async () => {
        const result = await this.db
          .select({ count: sql<number>`count(*)` })
          .from(projectTag)
          .where(
            and(
              eq(projectTag.projectId, projectId),
              eq(projectTag.tagId, tagId),
            ),
          );

        return (result[0]?.count ?? 0) > 0;
      },
    );
  }

  async removeAllTagsFromProject(projectId: string): Promise<void> {
    return withQueryLogging(
      this.logger,
      "ProjectTag",
      "removeAllTagsFromProject",
      async () => {
        await this.db
          .delete(projectTag)
          .where(eq(projectTag.projectId, projectId));
      },
    );
  }
}
