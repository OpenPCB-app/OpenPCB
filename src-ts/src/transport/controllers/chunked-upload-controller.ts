import type { RouteContext } from "../router";
import { ResponseBuilder } from "../../core/utils/response-builder";
import type { ChunkedUploadService } from "../../domain/services/chunked-upload-service";
import { ValidationError, NotFoundError } from "../../core/errors";

const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB max chunk size

export class ChunkedUploadController {
  constructor(private uploadService: ChunkedUploadService) {}

  async initiate(ctx: RouteContext): Promise<Response> {
    try {
      const body = await ctx.req.json() as {
        originalName: string;
        mimeType: string;
        totalSize: number;
        workspaceId: string;
        projectId?: string;
        spaceId?: string;
        chunkSize?: number;
      };

      if (!body.originalName || !body.mimeType || !body.totalSize || !body.workspaceId) {
        return ResponseBuilder.badRequest("Missing required fields: originalName, mimeType, totalSize, workspaceId");
      }

      const session = await this.uploadService.initiate({
        originalName: body.originalName,
        mimeType: body.mimeType,
        totalSize: body.totalSize,
        context: {
          workspaceId: body.workspaceId,
          projectId: body.projectId,
          spaceId: body.spaceId,
        },
        chunkSize: body.chunkSize,
      });

      return ResponseBuilder.created({ session });
    } catch (err) {
      if (err instanceof ValidationError) {
        return ResponseBuilder.badRequest(err.message);
      }
      return ResponseBuilder.error("INITIATE_FAILED", err instanceof Error ? err.message : "Failed to initiate upload", 500);
    }
  }

  async uploadChunk(ctx: RouteContext): Promise<Response> {
    try {
      const sessionId = ctx.params.getOrThrow("sessionId");
      const chunkIndexParam = ctx.params.getOrThrow("chunkIndex");
      const chunkIndex = parseInt(chunkIndexParam, 10);

      if (isNaN(chunkIndex)) {
        return ResponseBuilder.badRequest("Invalid chunk index");
      }

      // Read chunk data from request body
      const contentType = ctx.req.headers.get("content-type") || "";

      let buffer: Buffer;
      if (contentType.includes("application/octet-stream")) {
        buffer = Buffer.from(await ctx.req.arrayBuffer());
      } else if (contentType.includes("multipart/form-data")) {
        const formData = await ctx.req.formData();
        const chunk = formData.get("chunk") as File | null;
        if (!chunk) {
          return ResponseBuilder.badRequest("Missing chunk in form data");
        }
        buffer = Buffer.from(await chunk.arrayBuffer());
      } else {
        return ResponseBuilder.badRequest("Content-Type must be application/octet-stream or multipart/form-data");
      }

      if (buffer.length > MAX_CHUNK_SIZE) {
        return ResponseBuilder.badRequest(`Chunk size exceeds maximum ${MAX_CHUNK_SIZE} bytes`);
      }

      const result = await this.uploadService.uploadChunk(sessionId, {
        chunkIndex,
        buffer,
      });

      return ResponseBuilder.success(result);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return ResponseBuilder.notFound("UploadSession", ctx.params.get("sessionId") || "");
      }
      if (err instanceof ValidationError) {
        return ResponseBuilder.badRequest(err.message);
      }
      return ResponseBuilder.error("CHUNK_UPLOAD_FAILED", err instanceof Error ? err.message : "Failed to upload chunk", 500);
    }
  }

  async complete(ctx: RouteContext): Promise<Response> {
    try {
      const sessionId = ctx.params.getOrThrow("sessionId");
      const file = await this.uploadService.complete(sessionId);
      return ResponseBuilder.success({ file });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return ResponseBuilder.notFound("UploadSession", ctx.params.get("sessionId") || "");
      }
      if (err instanceof ValidationError) {
        return ResponseBuilder.badRequest(err.message);
      }
      return ResponseBuilder.error("COMPLETE_FAILED", err instanceof Error ? err.message : "Failed to complete upload", 500);
    }
  }

  async abort(ctx: RouteContext): Promise<Response> {
    try {
      const sessionId = ctx.params.getOrThrow("sessionId");
      await this.uploadService.abort(sessionId);
      return ResponseBuilder.success({ aborted: true });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return ResponseBuilder.notFound("UploadSession", ctx.params.get("sessionId") || "");
      }
      return ResponseBuilder.error("ABORT_FAILED", err instanceof Error ? err.message : "Failed to abort upload", 500);
    }
  }

  async getProgress(ctx: RouteContext): Promise<Response> {
    try {
      const sessionId = ctx.params.getOrThrow("sessionId");
      const progress = await this.uploadService.getProgress(sessionId);
      return ResponseBuilder.success({ progress });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return ResponseBuilder.notFound("UploadSession", ctx.params.get("sessionId") || "");
      }
      return ResponseBuilder.error("PROGRESS_FAILED", err instanceof Error ? err.message : "Failed to get progress", 500);
    }
  }
}
