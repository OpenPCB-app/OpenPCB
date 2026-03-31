import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { file, type File, type NewFile, type FileStatus } from "../schema/file";
import { fileBlob } from "../schema/file-blob";
import { BaseRepository } from "./base";
import { eq, and, gte, lte, desc, inArray, isNull } from "drizzle-orm";
import { withQueryLogging } from "../decorators";
import type { FileQueryParams, FileWithBlob } from "@shared/types/file.types";

export class FileRepository extends BaseRepository<
  typeof file,
  File,
  NewFile
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, file, logger, "File");
  }

  async findWithBlob(id: string): Promise<FileWithBlob | null> {
    return withQueryLogging(this.logger, this.entityName, 'findWithBlob', async () => {
      const result = await this.db
        .select()
        .from(file)
        .innerJoin(fileBlob, eq(file.blobId, fileBlob.id))
        .where(eq(file.id, id))
        .limit(1);

      if (!result[0]) return null;

      const fileData = result[0].file;
      const blobData = result[0].file_blob;

      return {
        ...fileData,
        status: fileData.status as FileStatus,
        createdAt: fileData.createdAt.toISOString(),
        updatedAt: fileData.updatedAt.toISOString(),
        trashedAt: fileData.trashedAt?.toISOString() ?? null,
        deletedAt: fileData.deletedAt?.toISOString() ?? null,
        tags: fileData.tags ?? [],
        permissions: fileData.permissions ?? null,
        metadata: fileData.metadata ?? null,
        blob: {
          ...blobData,
          createdAt: blobData.createdAt.toISOString(),
          updatedAt: blobData.updatedAt.toISOString(),
        },
      };
    });
  }

  async query(params: FileQueryParams): Promise<File[]> {
    return withQueryLogging(this.logger, this.entityName, 'query', async () => {
      const conditions = [];

      if (params.workspaceId) {
        conditions.push(eq(file.workspaceId, params.workspaceId));
      }
      if (params.projectId) {
        conditions.push(eq(file.projectId, params.projectId));
      }
      if (params.spaceId) {
        conditions.push(eq(file.spaceId, params.spaceId));
      }
      if (params.mimeType) {
        conditions.push(eq(file.mimeType, params.mimeType));
      }
      if (params.status) {
        conditions.push(eq(file.status, params.status));
      }
      if (params.fromDate) {
        conditions.push(gte(file.createdAt, new Date(params.fromDate)));
      }
      if (params.toDate) {
        conditions.push(lte(file.createdAt, new Date(params.toDate)));
      }

      let query = this.db
        .select()
        .from(file)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(file.createdAt));

      if (params.limit) {
        query = query.limit(params.limit) as any;
      }

      const results = await query;

      if (params.tags && params.tags.length > 0) {
        return results.filter((f) => {
          const fileTags = f.tags ?? [];
          return params.tags!.some((tag) => fileTags.includes(tag));
        });
      }

      return results;
    });
  }

  async findByIds(ids: string[]): Promise<File[]> {
    return withQueryLogging(this.logger, this.entityName, "findByIds", async () => {
      if (ids.length === 0) {
        return [];
      }

      return await this.db
        .select()
        .from(file)
        .where(and(inArray(file.id, ids), isNull(file.deletedAt)))
        .orderBy(desc(file.createdAt));
    });
  }

  async updateStatus(id: string, status: FileStatus, trashedBy?: string): Promise<File> {
    return withQueryLogging(this.logger, this.entityName, 'updateStatus', async () => {
      const updates: any = {
        status,
        updatedAt: new Date(),
      };

      if (status === 'trashed') {
        updates.trashedAt = new Date();
        if (trashedBy) {
          updates.trashedBy = trashedBy;
        }
      } else if (status === 'active') {
        updates.trashedAt = null;
        updates.trashedBy = null;
      }

      await this.db
        .update(file)
        .set(updates)
        .where(eq(file.id, id));

      return await this.findByIdOrThrow(id);
    });
  }

  async findTrashed(contextFilter?: {
    workspaceId?: string;
    projectId?: string | null;
    spaceId?: string | null;
  }): Promise<File[]> {
    return withQueryLogging(this.logger, this.entityName, 'findTrashed', async () => {
      const conditions = [eq(file.status, 'trashed')];

      if (contextFilter?.workspaceId) {
        conditions.push(eq(file.workspaceId, contextFilter.workspaceId));
      }
      if (contextFilter?.projectId) {
        conditions.push(eq(file.projectId, contextFilter.projectId));
      }
      if (contextFilter?.spaceId) {
        conditions.push(eq(file.spaceId, contextFilter.spaceId));
      }

      return await this.db
        .select()
        .from(file)
        .where(and(...conditions))
        .orderBy(desc(file.trashedAt));
    });
  }
}
