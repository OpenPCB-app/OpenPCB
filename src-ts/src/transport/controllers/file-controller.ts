import type { RouteContext } from "../router";
import { ResponseBuilder } from "../../core/utils/response-builder";
import type { FileService } from "../../domain/services/file-service";
import { ValidationError, NotFoundError } from "../../core/errors";
import type { FileQueryParams } from "@shared/types/file.types";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export class FileController {
  constructor(private fileService: FileService) {}

  async upload(ctx: RouteContext): Promise<Response> {
    try {
      const contentType = ctx.req.headers.get("content-type") || "";
      if (!contentType.includes("multipart/form-data")) {
        return ResponseBuilder.badRequest("Content-Type must be multipart/form-data");
      }

      const formData = await ctx.req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return ResponseBuilder.badRequest("Missing file in request");
      }
      if (file.size > MAX_FILE_SIZE) {
        return ResponseBuilder.badRequest(`File size exceeds maximum ${MAX_FILE_SIZE} bytes`);
      }

      const workspaceId = formData.get("workspaceId") as string | null;
      const projectId = formData.get("projectId") as string | null;
      const spaceId = formData.get("spaceId") as string | null;
      const tagsJson = formData.get("tags") as string | null;
      const metadataJson = formData.get("metadata") as string | null;
      const permissionsJson = formData.get("permissions") as string | null;

      if (!workspaceId) {
        return ResponseBuilder.badRequest("workspaceId is required");
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      const result = await this.fileService.upload({
        buffer,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        context: {
          workspaceId,
          projectId: projectId || undefined,
          spaceId: spaceId || undefined,
        },
        tags: tagsJson ? JSON.parse(tagsJson) : undefined,
        metadata: metadataJson ? JSON.parse(metadataJson) : undefined,
        permissions: permissionsJson ? JSON.parse(permissionsJson) : undefined,
      });

      return ResponseBuilder.created({ file: result.file });
    } catch (err) {
      if (err instanceof ValidationError) {
        return ResponseBuilder.badRequest(err.message);
      }
      return ResponseBuilder.error("UPLOAD_FAILED", err instanceof Error ? err.message : "Upload failed", 500);
    }
  }

  async list(ctx: RouteContext): Promise<Response> {
    try {
      const url = new URL(ctx.req.url);
      const params: FileQueryParams = {
        workspaceId: url.searchParams.get("workspaceId") || undefined,
        projectId: url.searchParams.get("projectId") || undefined,
        spaceId: url.searchParams.get("spaceId") || undefined,
        chatId: url.searchParams.get("chatId") || undefined,
        mimeType: url.searchParams.get("mimeType") || undefined,
        status: (url.searchParams.get("status") as any) || undefined,
        fromDate: url.searchParams.get("fromDate") || undefined,
        toDate: url.searchParams.get("toDate") || undefined,
        limit: url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!) : undefined,
      };

      const tagsParam = url.searchParams.get("tags");
      if (tagsParam) {
        params.tags = tagsParam.split(",");
      }

      const files = await this.fileService.list(params);
      return ResponseBuilder.success({ files });
    } catch (err) {
      return ResponseBuilder.error("LIST_FAILED", err instanceof Error ? err.message : "Failed to list files", 500);
    }
  }

  async getMeta(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");
      const file = await this.fileService.get(id);
      if (!file) {
        return ResponseBuilder.notFound("File", id);
      }
      return ResponseBuilder.success({ file });
    } catch (err) {
      return ResponseBuilder.error("GET_FAILED", err instanceof Error ? err.message : "Failed to get file", 500);
    }
  }

  async getContent(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");
      const fileWithBlob = await this.fileService.getWithBlob(id);
      if (!fileWithBlob) {
        return ResponseBuilder.notFound("File", id);
      }

      const buffer = await this.fileService.getContent(id);

      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": fileWithBlob.mimeType,
          "Content-Length": buffer.length.toString(),
          "Content-Disposition": `inline; filename=\"${encodeURIComponent(fileWithBlob.originalName)}\"`,
        },
      });
    } catch (err) {
      return ResponseBuilder.error("CONTENT_FAILED", err instanceof Error ? err.message : "Failed to get file content", 500);
    }
  }

  async updateMetadata(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");
      const body = (await ctx.req.json()) as { metadata: Record<string, unknown> };
      if (!body.metadata) {
        return ResponseBuilder.badRequest("Missing metadata in request body");
      }

      const file = await this.fileService.updateMetadata(id, body.metadata);
      return ResponseBuilder.success({ file });
    } catch (err) {
      return ResponseBuilder.error("UPDATE_FAILED", err instanceof Error ? err.message : "Failed to update metadata", 500);
    }
  }

  async softDelete(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");
      const file = await this.fileService.softDelete(id);
      return ResponseBuilder.success({ file });
    } catch (err) {
      return ResponseBuilder.error("DELETE_FAILED", err instanceof Error ? err.message : "Failed to delete file", 500);
    }
  }

  async restore(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");
      const file = await this.fileService.restore(id);
      return ResponseBuilder.success({ file });
    } catch (err) {
      return ResponseBuilder.error("RESTORE_FAILED", err instanceof Error ? err.message : "Failed to restore file", 500);
    }
  }

  async emptyTrash(ctx: RouteContext): Promise<Response> {
    try {
      const url = new URL(ctx.req.url);
      const workspaceId = url.searchParams.get("workspaceId") || undefined;
      const contextFilter = workspaceId
        ? {
            workspaceId,
            projectId: url.searchParams.get("projectId") || undefined,
            spaceId: url.searchParams.get("spaceId") || undefined,
          }
        : undefined;

      const result = await this.fileService.emptyTrash(contextFilter);
      return ResponseBuilder.success(result);
    } catch (err) {
      return ResponseBuilder.error("EMPTY_TRASH_FAILED", err instanceof Error ? err.message : "Failed to empty trash", 500);
    }
  }

  // Versioning endpoints

  async uploadVersion(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");
      const contentType = ctx.req.headers.get("content-type") || "";
      if (!contentType.includes("multipart/form-data")) {
        return ResponseBuilder.badRequest("Content-Type must be multipart/form-data");
      }

      const formData = await ctx.req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return ResponseBuilder.badRequest("Missing file in request");
      }
      if (file.size > MAX_FILE_SIZE) {
        return ResponseBuilder.badRequest(`File size exceeds maximum ${MAX_FILE_SIZE} bytes`);
      }

      const createdBy = formData.get("createdBy") as string | null;
      const comment = formData.get("comment") as string | null;

      const buffer = Buffer.from(await file.arrayBuffer());

      const result = await this.fileService.uploadVersion(id, {
        buffer,
        createdBy: createdBy || undefined,
        comment: comment || undefined,
      });

      return ResponseBuilder.created({ version: result.version, file: result.file });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return ResponseBuilder.notFound("File", ctx.params.get("id") || "");
      }
      if (err instanceof ValidationError) {
        return ResponseBuilder.badRequest(err.message);
      }
      return ResponseBuilder.error("VERSION_UPLOAD_FAILED", err instanceof Error ? err.message : "Failed to upload version", 500);
    }
  }

  async listVersions(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");
      const versions = await this.fileService.listVersions(id);
      return ResponseBuilder.success({ versions });
    } catch (err) {
      return ResponseBuilder.error("LIST_VERSIONS_FAILED", err instanceof Error ? err.message : "Failed to list versions", 500);
    }
  }

  async getVersion(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");
      const versionParam = ctx.params.getOrThrow("version");
      const version = parseInt(versionParam, 10);
      if (isNaN(version)) {
        return ResponseBuilder.badRequest("Invalid version number");
      }

      const versionRecord = await this.fileService.getVersion(id, version);
      if (!versionRecord) {
        return ResponseBuilder.notFound("Version", `${id}:${version}`);
      }

      return ResponseBuilder.success({ version: versionRecord });
    } catch (err) {
      return ResponseBuilder.error("GET_VERSION_FAILED", err instanceof Error ? err.message : "Failed to get version", 500);
    }
  }

  async getVersionContent(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");
      const versionParam = ctx.params.getOrThrow("version");
      const version = parseInt(versionParam, 10);
      if (isNaN(version)) {
        return ResponseBuilder.badRequest("Invalid version number");
      }

      const file = await this.fileService.get(id);
      if (!file) {
        return ResponseBuilder.notFound("File", id);
      }

      const buffer = await this.fileService.getVersionContent(id, version);

      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": file.mimeType,
          "Content-Length": buffer.length.toString(),
          "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalName)}"`,
        },
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        return ResponseBuilder.badRequest(err.message);
      }
      return ResponseBuilder.error("VERSION_CONTENT_FAILED", err instanceof Error ? err.message : "Failed to get version content", 500);
    }
  }

  async restoreVersion(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");
      const versionParam = ctx.params.getOrThrow("version");
      const version = parseInt(versionParam, 10);
      if (isNaN(version)) {
        return ResponseBuilder.badRequest("Invalid version number");
      }

      const file = await this.fileService.restoreVersion(id, version);
      return ResponseBuilder.success({ file });
    } catch (err) {
      if (err instanceof ValidationError) {
        return ResponseBuilder.badRequest(err.message);
      }
      return ResponseBuilder.error("RESTORE_VERSION_FAILED", err instanceof Error ? err.message : "Failed to restore version", 500);
    }
  }

  async deleteVersion(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");
      const versionParam = ctx.params.getOrThrow("version");
      const version = parseInt(versionParam, 10);
      if (isNaN(version)) {
        return ResponseBuilder.badRequest("Invalid version number");
      }

      await this.fileService.deleteVersion(id, version);
      return ResponseBuilder.success({ deleted: true });
    } catch (err) {
      if (err instanceof ValidationError) {
        return ResponseBuilder.badRequest(err.message);
      }
      return ResponseBuilder.error("DELETE_VERSION_FAILED", err instanceof Error ? err.message : "Failed to delete version", 500);
    }
  }

  // Processing endpoints

  async processFile(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");

      // Check if file can be processed
      const file = await this.fileService.get(id);
      if (!file) {
        return ResponseBuilder.notFound("File", id);
      }

      if (!this.fileService.canProcess(file.mimeType)) {
        return ResponseBuilder.badRequest(`File type ${file.mimeType} cannot be processed`);
      }

      // Parse processing options from body
      let options = {};
      try {
        const body = await ctx.req.json();
        options = body || {};
      } catch {
        // No body or invalid JSON, use defaults
      }

      const result = await this.fileService.processFile(id, options);
      return ResponseBuilder.success({
        processed: true,
        hasThumbnail: !!result.thumbnail,
        metadata: result.metadata,
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return ResponseBuilder.notFound("File", ctx.params.get("id") || "");
      }
      return ResponseBuilder.error("PROCESS_FAILED", err instanceof Error ? err.message : "Failed to process file", 500);
    }
  }

  async getThumbnail(ctx: RouteContext): Promise<Response> {
    try {
      const id = ctx.params.getOrThrow("id");

      const thumbnail = await this.fileService.getThumbnail(id);
      if (!thumbnail) {
        return ResponseBuilder.notFound("Thumbnail", id);
      }

      return new Response(thumbnail.buffer, {
        status: 200,
        headers: {
          "Content-Type": thumbnail.mimeType,
          "Content-Length": thumbnail.buffer.length.toString(),
          "Cache-Control": "public, max-age=31536000", // 1 year cache
        },
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return ResponseBuilder.notFound("File", ctx.params.get("id") || "");
      }
      return ResponseBuilder.error("THUMBNAIL_FAILED", err instanceof Error ? err.message : "Failed to get thumbnail", 500);
    }
  }
}
