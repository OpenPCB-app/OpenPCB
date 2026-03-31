/**
 * Project Repository
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { project, type Project, type NewProject } from "../schema/project";
import { BaseRepository } from "./base";
import { eq, and, isNull } from "drizzle-orm";
import { parseSQLiteError } from "../errors";

export class ProjectRepository extends BaseRepository<
  typeof project,
  Project,
  NewProject
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, project, logger, "Project");
  }

  /**
   * Find projects by workspace
   */
  async findByWorkspace(workspaceId: string): Promise<Project[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(project)
        .where(
          and(
            eq(project.workspaceId, workspaceId),
            isNull(project.deletedAt)
          )
        )
        .orderBy(project.name);

      const duration = performance.now() - start;
      this.logger.logQuery("Project.findByWorkspace", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Project.findByWorkspace [FAILED]", duration);
      throw parseSQLiteError(err, "Project.findByWorkspace");
    }
  }

  /**
   * Find active projects by workspace and status
   */
  async findActiveByWorkspace(workspaceId: string): Promise<Project[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(project)
        .where(
          and(
            eq(project.workspaceId, workspaceId),
            eq(project.status, "active"),
            isNull(project.deletedAt)
          )
        )
        .orderBy(project.name);

      const duration = performance.now() - start;
      this.logger.logQuery("Project.findActiveByWorkspace", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Project.findActiveByWorkspace [FAILED]", duration);
      throw parseSQLiteError(err, "Project.findActiveByWorkspace");
    }
  }
}
