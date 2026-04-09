import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { BaseRepository } from "./base";
import { design, type Design, type NewDesign } from "../schema/design";
import { and, eq, isNull, asc } from "drizzle-orm";
import { parseSQLiteError } from "../errors";

export class DesignRepository extends BaseRepository<
  typeof design,
  Design,
  NewDesign
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, design, logger, "Design");
  }

  async findByScope(
    workspaceId: string,
    projectId: string | null,
  ): Promise<Design[]> {
    const start = performance.now();
    try {
      const conditions = [
        eq(design.workspaceId, workspaceId),
        isNull(design.deletedAt),
      ];

      if (projectId) {
        conditions.push(eq(design.projectId, projectId));
      } else {
        conditions.push(isNull(design.projectId));
      }

      const result = await this.db
        .select()
        .from(design)
        .where(and(...conditions))
        .orderBy(asc(design.sortOrder), asc(design.name));

      const duration = performance.now() - start;
      this.logger.logQuery("Design.findByScope", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Design.findByScope [FAILED]", duration);
      throw parseSQLiteError(err, "Design.findByScope");
    }
  }

  async softDeleteByProject(projectId: string): Promise<void> {
    const start = performance.now();
    try {
      const now = new Date();
      await this.db
        .update(design)
        .set({ deletedAt: now, updatedAt: now } as never)
        .where(and(eq(design.projectId, projectId), isNull(design.deletedAt)));

      const duration = performance.now() - start;
      this.logger.logQuery("Design.softDeleteByProject", duration);
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("Design.softDeleteByProject [FAILED]", duration);
      throw parseSQLiteError(err, "Design.softDeleteByProject");
    }
  }
}
