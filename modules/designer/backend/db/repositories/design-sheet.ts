import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { BaseRepository } from "./base";
import {
  designSheet,
  type DesignSheetRow,
  type NewDesignSheetRow,
} from "../schema/design-sheet";
import { and, eq, isNull, asc } from "drizzle-orm";
import { parseSQLiteError } from "../errors";
import type { ProjectDocumentBundle } from "@shared/types/pcb.types";

export class DesignSheetRepository extends BaseRepository<
  typeof designSheet,
  DesignSheetRow,
  NewDesignSheetRow
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, designSheet, logger, "DesignSheet");
  }

  async findByDesign(designId: string): Promise<DesignSheetRow[]> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(designSheet)
        .where(
          and(
            eq(designSheet.designId, designId),
            isNull(designSheet.deletedAt),
          ),
        )
        .orderBy(asc(designSheet.sheetIndex));

      const duration = performance.now() - start;
      this.logger.logQuery("DesignSheet.findByDesign", duration);
      return result;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("DesignSheet.findByDesign [FAILED]", duration);
      throw parseSQLiteError(err, "DesignSheet.findByDesign");
    }
  }

  async findByDesignAndIndex(
    designId: string,
    sheetIndex: number,
  ): Promise<DesignSheetRow | null> {
    const start = performance.now();
    try {
      const result = await this.db
        .select()
        .from(designSheet)
        .where(
          and(
            eq(designSheet.designId, designId),
            eq(designSheet.sheetIndex, sheetIndex),
            isNull(designSheet.deletedAt),
          ),
        )
        .limit(1);

      const duration = performance.now() - start;
      this.logger.logQuery("DesignSheet.findByDesignAndIndex", duration);
      return result[0] ?? null;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery(
        "DesignSheet.findByDesignAndIndex [FAILED]",
        duration,
      );
      throw parseSQLiteError(err, "DesignSheet.findByDesignAndIndex");
    }
  }

  async upsertContent(
    designId: string,
    sheetIndex: number,
    content: ProjectDocumentBundle,
    contentHash: string,
  ): Promise<DesignSheetRow> {
    const start = performance.now();
    try {
      const existing = await this.findByDesignAndIndex(designId, sheetIndex);

      if (existing) {
        const now = new Date();
        await this.db
          .update(designSheet)
          .set({
            content,
            contentHash,
            updatedAt: now,
          })
          .where(eq(designSheet.id, existing.id));

        const duration = performance.now() - start;
        this.logger.logQuery("DesignSheet.upsertContent", duration);
        return await this.findByIdOrThrow(existing.id);
      }

      const sheet = await this.create({
        designId,
        sheetIndex,
        title: `Sheet ${sheetIndex + 1}`,
        content,
        contentHash,
      });

      const duration = performance.now() - start;
      this.logger.logQuery("DesignSheet.upsertContent", duration);
      return sheet;
    } catch (err) {
      const duration = performance.now() - start;
      this.logger.logQuery("DesignSheet.upsertContent [FAILED]", duration);
      throw parseSQLiteError(err, "DesignSheet.upsertContent");
    }
  }
}
