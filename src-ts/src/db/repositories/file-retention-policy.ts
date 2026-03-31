import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import {
  fileRetentionPolicy,
  type FileRetentionPolicy,
  type NewFileRetentionPolicy,
} from "../schema/file-retention-policy";
import { BaseRepository } from "./base";
import { eq, and } from "drizzle-orm";
import { withQueryLogging } from "../decorators";

export class FileRetentionPolicyRepository extends BaseRepository<
  typeof fileRetentionPolicy,
  FileRetentionPolicy,
  NewFileRetentionPolicy
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, fileRetentionPolicy, logger, "FileRetentionPolicy");
  }

  /**
   * Find all enabled policies for a workspace
   */
  async findEnabledByWorkspace(workspaceId: string): Promise<FileRetentionPolicy[]> {
    return withQueryLogging(this.logger, this.entityName, 'findEnabledByWorkspace', async () => {
      return await this.db
        .select()
        .from(fileRetentionPolicy)
        .where(and(
          eq(fileRetentionPolicy.workspaceId, workspaceId),
          eq(fileRetentionPolicy.enabled, true)
        ));
    });
  }

  /**
   * Find all policies for a workspace
   */
  async findByWorkspace(workspaceId: string): Promise<FileRetentionPolicy[]> {
    return withQueryLogging(this.logger, this.entityName, 'findByWorkspace', async () => {
      return await this.db
        .select()
        .from(fileRetentionPolicy)
        .where(eq(fileRetentionPolicy.workspaceId, workspaceId));
    });
  }

  /**
   * Get all enabled policies
   */
  async findAllEnabled(): Promise<FileRetentionPolicy[]> {
    return withQueryLogging(this.logger, this.entityName, 'findAllEnabled', async () => {
      return await this.db
        .select()
        .from(fileRetentionPolicy)
        .where(eq(fileRetentionPolicy.enabled, true));
    });
  }

  /**
   * Update last run timestamp
   */
  async updateLastRun(id: string): Promise<void> {
    return withQueryLogging(this.logger, this.entityName, 'updateLastRun', async () => {
      await this.db
        .update(fileRetentionPolicy)
        .set({
          lastRunAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(fileRetentionPolicy.id, id));
    });
  }

  /**
   * Toggle policy enabled status
   */
  async setEnabled(id: string, enabled: boolean): Promise<FileRetentionPolicy> {
    return withQueryLogging(this.logger, this.entityName, 'setEnabled', async () => {
      await this.db
        .update(fileRetentionPolicy)
        .set({
          enabled,
          updatedAt: new Date(),
        })
        .where(eq(fileRetentionPolicy.id, id));

      return await this.findByIdOrThrow(id);
    });
  }
}
