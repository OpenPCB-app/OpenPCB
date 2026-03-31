/**
 * Workspace Repository
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { workspace, type Workspace, type NewWorkspace, type WorkspaceSettings } from "../schema/workspace";
import { BaseRepository } from "./base";
import { isNull } from "drizzle-orm";
import { parseSQLiteError } from "../errors";

export class WorkspaceRepository extends BaseRepository<
  typeof workspace,
  Workspace,
  NewWorkspace
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, workspace, logger, "Workspace");
  }

  /**
   * Find all active (non-deleted) workspaces
   */
  override async findActive(): Promise<Workspace[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(workspace)
        .where(isNull(workspace.deletedAt))
        .orderBy(workspace.name);

      const duration = performance.now() - start;
      this.logger.logQuery("Workspace.findActive", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Workspace.findActive [FAILED]", duration);
      throw parseSQLiteError(err, "Workspace.findActive");
    }
  }

  /**
   * Update workspace settings
   */
  async updateSettings(id: string, settings: Partial<WorkspaceSettings>): Promise<Workspace> {
    const start = performance.now();
    try {
      const current = await this.findByIdOrThrow(id);
      const mergedSettings = { ...current.settings, ...settings };

      const result = await this.update(id, { settings: mergedSettings });

      const duration = performance.now() - start;
      this.logger.logQuery("Workspace.updateSettings", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Workspace.updateSettings [FAILED]", duration);
      throw parseSQLiteError(err, "Workspace.updateSettings");
    }
  }
}
