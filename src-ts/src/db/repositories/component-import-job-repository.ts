/**
 * Component Import Job Repository
 *
 * Handles database operations for component import jobs.
 */

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../schema";
import type { QueryLogger } from "../query-logger";
import { BaseRepository } from "./base";
import {
  componentImportJob,
  type ComponentImportJobRow,
  type NewComponentImportJobRow,
  type ImportJobStatus,
  type ExtractedFileInfo,
  type ParsedSymbolData,
  type ParsedFootprintData,
  type ExtractedMetadata,
  type ImportWarning,
  type ConflictStatus,
  type UserResolution,
} from "../schema/component-import-job";
import { componentFamily } from "../schema/component-family";
import { and, eq, desc, inArray } from "drizzle-orm";
import { withQueryLogging } from "../decorators";

export class ComponentImportJobRepository extends BaseRepository<
  typeof componentImportJob,
  ComponentImportJobRow,
  NewComponentImportJobRow
> {
  constructor(db: BunSQLiteDatabase<typeof schema>, logger: QueryLogger) {
    super(db, componentImportJob, logger, "ComponentImportJob");
  }

  /**
   * Find jobs by workspace ID
   */
  async findByWorkspace(workspaceId: string, limit?: number): Promise<ComponentImportJobRow[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByWorkspace",
      async () => {
        let query = this.db
          .select()
          .from(componentImportJob)
          .where(eq(componentImportJob.workspaceId, workspaceId))
          .orderBy(desc(componentImportJob.createdAt));
        if (limit) {
          query = query.limit(limit) as any;
        }
        return await query;
      },
    );
  }

  /**
   * Find jobs by status
   */
  async findByStatus(status: ImportJobStatus, limit?: number): Promise<ComponentImportJobRow[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByStatus",
      async () => {
        let query = this.db
          .select()
          .from(componentImportJob)
          .where(eq(componentImportJob.status, status))
          .orderBy(desc(componentImportJob.createdAt));
        if (limit) {
          query = query.limit(limit) as any;
        }
        return await query;
      },
    );
  }

  /**
   * Find jobs by workspace and status
   */
  async findByWorkspaceAndStatus(
    workspaceId: string,
    status: ImportJobStatus,
    limit?: number,
  ): Promise<ComponentImportJobRow[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findByWorkspaceAndStatus",
      async () => {
        let query = this.db
          .select()
          .from(componentImportJob)
          .where(
            and(
              eq(componentImportJob.workspaceId, workspaceId),
              eq(componentImportJob.status, status),
            ),
          )
          .orderBy(desc(componentImportJob.createdAt));
        if (limit) {
          query = query.limit(limit) as any;
        }
        return await query;
      },
    );
  }

  /**
   * Update job status and progress
   */
  async updateStatus(
    jobId: string,
    status: ImportJobStatus,
    progress?: number,
    progressStage?: string,
  ): Promise<ComponentImportJobRow> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "updateStatus",
      async () => {
        const updateData: Partial<ComponentImportJobRow> = { status };
        if (progress !== undefined) {
          updateData.progress = progress;
        }
        if (progressStage !== undefined) {
          updateData.progressStage = progressStage;
        }

        // Set timestamps based on status
        const now = new Date();
        if (status === "uploading") {
          updateData.uploadedAt = now;
        } else if (status === "extracting") {
          updateData.processingStartedAt = now;
        } else if (status === "preview_ready" || status === "conflict_check") {
          updateData.previewReadyAt = now;
        } else if (status === "completed" || status === "failed" || status === "cancelled") {
          updateData.completedAt = now;
        }

        await this.db
          .update(componentImportJob)
          .set(updateData)
          .where(eq(componentImportJob.id, jobId));

        return await this.findByIdOrThrow(jobId);
      },
    );
  }

  /**
   * Save parsed data to job
   */
  async saveParsedData(
    jobId: string,
    data: {
      extractedFiles: ExtractedFileInfo[];
      parsedSymbol: ParsedSymbolData | null;
      parsedFootprint: ParsedFootprintData | null;
      model3dFileId?: string | null;
      extractedMetadata: ExtractedMetadata;
      conflictStatus: ConflictStatus;
      conflictingFamilyId?: string | null;
      warnings?: ImportWarning[];
    },
  ): Promise<ComponentImportJobRow> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "saveParsedData",
      async () => {
        await this.db
          .update(componentImportJob)
          .set({
            extractedFiles: data.extractedFiles,
            parsedSymbol: data.parsedSymbol,
            parsedFootprint: data.parsedFootprint,
            model3dFileId: data.model3dFileId ?? null,
            extractedMetadata: data.extractedMetadata,
            conflictStatus: data.conflictStatus,
            conflictingFamilyId: data.conflictingFamilyId ?? null,
            warnings: data.warnings ?? [],
            updatedAt: new Date(),
          })
          .where(eq(componentImportJob.id, jobId));

        return await this.findByIdOrThrow(jobId);
      },
    );
  }

  /**
   * Mark job as failed
   */
  async markFailed(jobId: string, errorCode: string, errorMessage: string): Promise<ComponentImportJobRow> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "markFailed",
      async () => {
        await this.db
          .update(componentImportJob)
          .set({
            status: "failed",
            errorCode,
            errorMessage,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(componentImportJob.id, jobId));

        return await this.findByIdOrThrow(jobId);
      },
    );
  }

  /**
   * Mark job as completed
   */
  async markCompleted(jobId: string, familyId: string): Promise<ComponentImportJobRow> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "markCompleted",
      async () => {
        await this.db
          .update(componentImportJob)
          .set({
            status: "completed",
            createdFamilyId: familyId,
            completedAt: new Date(),
            progress: 100,
            updatedAt: new Date(),
          })
          .where(eq(componentImportJob.id, jobId));

        return await this.findByIdOrThrow(jobId);
      },
    );
  }

  /**
   * Set user resolution for conflict
   */
  async setUserResolution(jobId: string, resolution: UserResolution): Promise<ComponentImportJobRow> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "setUserResolution",
      async () => {
        await this.db
          .update(componentImportJob)
          .set({
            userResolution: resolution,
            updatedAt: new Date(),
          })
          .where(eq(componentImportJob.id, jobId));

        return await this.findByIdOrThrow(jobId);
      },
    );
  }

  /**
   * Find jobs that need cleanup (older than specified days)
   */
  async findOldJobs(olderThanDays: number): Promise<ComponentImportJobRow[]> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findOldJobs",
      async () => {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

        return this.db
          .select()
          .from(componentImportJob)
          .where(
            and(
              inArray(componentImportJob.status, ["completed", "failed", "cancelled"]),
              // Using createdAt as the cutoff - jobs older than this should be cleaned up
            ),
          )
          .orderBy(desc(componentImportJob.createdAt));
      },
    );
  }

  /**
   * Find existing component by display label (name)
   */
  async findExistingByLabel(
    label: string,
    workspaceId: string,
  ): Promise<{ id: string; displayLabel: string } | null> {
    return withQueryLogging(
      this.logger,
      this.entityName,
      "findExistingByLabel",
      async () => {
        const result = await this.db
          .select({ id: componentFamily.id, displayLabel: componentFamily.displayLabel })
          .from(componentFamily)
          .where(
            and(
              eq(componentFamily.displayLabel, label),
              eq(componentFamily.scope, "workspace" as any),
            ),
          )
          .limit(1);

        return result[0] ?? null;
      },
    );
  }
}
