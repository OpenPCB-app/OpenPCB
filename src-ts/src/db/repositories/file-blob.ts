import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { fileBlob, type FileBlob, type NewFileBlob } from "../schema/file-blob";
import { BaseRepository } from "./base";
import { eq, sql } from "drizzle-orm";
import { withQueryLogging } from "../decorators";

export class FileBlobRepository extends BaseRepository<
  typeof fileBlob,
  FileBlob,
  NewFileBlob
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, fileBlob, logger, "FileBlob");
  }

  async findByChecksum(checksum: string): Promise<FileBlob | null> {
    return withQueryLogging(this.logger, this.entityName, 'findByChecksum', async () => {
      const result = await this.db
        .select()
        .from(fileBlob)
        .where(eq(fileBlob.checksum, checksum))
        .limit(1);
      return result[0] ?? null;
    });
  }

  async incrementRefCount(id: string): Promise<void> {
    return withQueryLogging(this.logger, this.entityName, 'incrementRefCount', async () => {
      await this.db
        .update(fileBlob)
        .set({ 
          refCount: sql`${fileBlob.refCount} + 1`,
          updatedAt: new Date()
        })
        .where(eq(fileBlob.id, id));
    });
  }

  async decrementRefCount(id: string): Promise<number> {
    return withQueryLogging(this.logger, this.entityName, 'decrementRefCount', async () => {
      await this.db
        .update(fileBlob)
        .set({ 
          refCount: sql`MAX(0, ${fileBlob.refCount} - 1)`,
          updatedAt: new Date()
        })
        .where(eq(fileBlob.id, id));

      const blob = await this.findByIdOrThrow(id);
      return blob.refCount;
    });
  }

  async findOrphaned(): Promise<FileBlob[]> {
    return withQueryLogging(this.logger, this.entityName, 'findOrphaned', async () => {
      return await this.db
        .select()
        .from(fileBlob)
        .where(eq(fileBlob.refCount, 0));
    });
  }
}
