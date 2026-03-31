import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { fileVersion, type FileVersion, type NewFileVersion } from "../schema/file-version";
import { BaseRepository } from "./base";
import { eq, and, desc } from "drizzle-orm";
import { withQueryLogging } from "../decorators";

export class FileVersionRepository extends BaseRepository<
  typeof fileVersion,
  FileVersion,
  NewFileVersion
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, fileVersion, logger, "FileVersion");
  }

  /**
   * Find all versions for a file, ordered by version number descending
   */
  async findByFile(fileId: string): Promise<FileVersion[]> {
    return withQueryLogging(this.logger, this.entityName, 'findByFile', async () => {
      return await this.db
        .select()
        .from(fileVersion)
        .where(eq(fileVersion.fileId, fileId))
        .orderBy(desc(fileVersion.versionNumber));
    });
  }

  /**
   * Find a specific version of a file
   */
  async findByFileAndVersion(fileId: string, version: number): Promise<FileVersion | null> {
    return withQueryLogging(this.logger, this.entityName, 'findByFileAndVersion', async () => {
      const result = await this.db
        .select()
        .from(fileVersion)
        .where(and(
          eq(fileVersion.fileId, fileId),
          eq(fileVersion.versionNumber, version)
        ))
        .limit(1);
      return result[0] ?? null;
    });
  }

  /**
   * Get the latest version for a file
   */
  async getLatestVersion(fileId: string): Promise<FileVersion | null> {
    return withQueryLogging(this.logger, this.entityName, 'getLatestVersion', async () => {
      const result = await this.db
        .select()
        .from(fileVersion)
        .where(eq(fileVersion.fileId, fileId))
        .orderBy(desc(fileVersion.versionNumber))
        .limit(1);
      return result[0] ?? null;
    });
  }

  /**
   * Get the next version number for a file
   */
  async getNextVersionNumber(fileId: string): Promise<number> {
    const latest = await this.getLatestVersion(fileId);
    return latest ? latest.versionNumber + 1 : 1;
  }

  /**
   * Delete all versions for a file
   */
  async deleteByFile(fileId: string): Promise<void> {
    return withQueryLogging(this.logger, this.entityName, 'deleteByFile', async () => {
      await this.db
        .delete(fileVersion)
        .where(eq(fileVersion.fileId, fileId));
    });
  }
}
