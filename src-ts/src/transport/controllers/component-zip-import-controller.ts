/**
 * Component ZIP Import Controller
 *
 * API endpoints for unified ZIP-based component import flow:
 * - Upload ZIP file
 * - Get job status and preview
 * - Resolve conflicts
 * - Approve and save to library
 */

import type { RouteContext } from "../router";
import { ResponseBuilder } from "../../core/utils/response-builder";
import type { IComponentZipImportService } from "../../domain/services/component-zip-import-service";
import type { UserResolution } from "../../db/schema/component-import-job";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

interface ResolveConflictRequest {
  resolution: UserResolution;
}

interface ApproveRequest {
  metadata?: {
    componentName?: string;
    mpn?: string;
    manufacturer?: string;
    description?: string;
    referencePrefix?: string;
  };
}

export class ComponentZipImportController {
  constructor(private importService: IComponentZipImportService) {}

  /**
   * POST /api/components/import-zip
   * Upload a ZIP file containing KiCAD symbol, footprint, and optional 3D model
   */
  async uploadZip(ctx: RouteContext): Promise<Response> {
    try {
      const formData = await ctx.req.formData();
      const file = formData.get("file") as File | null;
      const workspaceId = formData.get("workspaceId") as string | null;

      if (!file) {
        return ResponseBuilder.badRequest("Missing file");
      }

      if (!workspaceId) {
        return ResponseBuilder.badRequest("Missing workspaceId");
      }

      if (!file.name.endsWith(".zip")) {
        return ResponseBuilder.badRequest("File must be a ZIP archive");
      }

      if (file.size > MAX_FILE_SIZE) {
        return ResponseBuilder.badRequest("File exceeds 50MB limit");
      }

      const job = await this.importService.uploadZip(file, workspaceId);
      return ResponseBuilder.success({ job });
    } catch (err) {
      if (err instanceof Error && err.name === "ImportValidationError") {
        return ResponseBuilder.error(
          "VALIDATION_ERROR",
          err.message,
          400,
        );
      }
      return ResponseBuilder.error(
        "UPLOAD_FAILED",
        err instanceof Error ? err.message : "Failed to upload file",
        500,
      );
    }
  }

  /**
   * GET /api/components/import-zip/:jobId/status
   * Get current job status and progress
   */
  async getStatus(ctx: RouteContext): Promise<Response> {
    try {
      const jobId = ctx.params.get("jobId");
      if (!jobId) {
        return ResponseBuilder.badRequest("Missing jobId");
      }

      const status = await this.importService.getJobStatus(jobId);
      return ResponseBuilder.success({ status });
    } catch (err) {
      return ResponseBuilder.error(
        "STATUS_FAILED",
        err instanceof Error ? err.message : "Failed to get job status",
        500,
      );
    }
  }

  /**
   * GET /api/components/import-zip/:jobId/preview
   * Get preview data for the import job
   */
  async getPreview(ctx: RouteContext): Promise<Response> {
    try {
      const jobId = ctx.params.get("jobId");
      if (!jobId) {
        return ResponseBuilder.badRequest("Missing jobId");
      }

      const preview = await this.importService.getJobPreview(jobId);
      return ResponseBuilder.success({ preview });
    } catch (err) {
      return ResponseBuilder.error(
        "PREVIEW_FAILED",
        err instanceof Error ? err.message : "Failed to get preview",
        500,
      );
    }
  }

  /**
   * POST /api/components/import-zip/:jobId/resolve
   * Resolve a conflict (create_new, update_existing, or skip)
   */
  async resolveConflict(ctx: RouteContext): Promise<Response> {
    try {
      const jobId = ctx.params.get("jobId");
      if (!jobId) {
        return ResponseBuilder.badRequest("Missing jobId");
      }

      const body = await ctx.req.json() as ResolveConflictRequest;
      if (!body.resolution) {
        return ResponseBuilder.badRequest("Missing resolution");
      }

      await this.importService.resolveConflict(jobId, body.resolution);
      return ResponseBuilder.success({ message: "Conflict resolved" });
    } catch (err) {
      return ResponseBuilder.error(
        "RESOLVE_FAILED",
        err instanceof Error ? err.message : "Failed to resolve conflict",
        500,
      );
    }
  }

  /**
   * POST /api/components/import-zip/:jobId/approve
   * Approve the import and save to library
   */
  async approve(ctx: RouteContext): Promise<Response> {
    try {
      const jobId = ctx.params.get("jobId");
      if (!jobId) {
        return ResponseBuilder.badRequest("Missing jobId");
      }

      const body = await ctx.req.json() as ApproveRequest;
      const result = await this.importService.approveAndSave(jobId, body.metadata);

      if (!result.success) {
        return ResponseBuilder.error(
          "SAVE_FAILED",
          result.error || "Failed to save component",
          500,
        );
      }

      return ResponseBuilder.success({
        familyId: result.familyId,
        componentName: result.componentName,
        message: "Component imported successfully",
      });
    } catch (err) {
      return ResponseBuilder.error(
        "APPROVE_FAILED",
        err instanceof Error ? err.message : "Failed to approve import",
        500,
      );
    }
  }

  /**
   * POST /api/components/import-zip/:jobId/cancel
   * Cancel an import job
   */
  async cancel(ctx: RouteContext): Promise<Response> {
    try {
      const jobId = ctx.params.get("jobId");
      if (!jobId) {
        return ResponseBuilder.badRequest("Missing jobId");
      }

      await this.importService.cancelJob(jobId);
      return ResponseBuilder.success({ message: "Import cancelled" });
    } catch (err) {
      return ResponseBuilder.error(
        "CANCEL_FAILED",
        err instanceof Error ? err.message : "Failed to cancel import",
        500,
      );
    }
  }
}
