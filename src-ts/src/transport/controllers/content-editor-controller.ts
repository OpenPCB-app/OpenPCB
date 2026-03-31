/**
 * Content Editor Controller
 *
 * HTTP handlers for AI content editing API.
 * All business logic delegated to ContentEditorService.
 */

import { CORS_HEADERS } from "../http/helpers";
import type { RouteContext } from "../router";
import type { ContentEditorService } from "../../domain/services/content-editor";
import { ResponseBuilder } from "../../core/utils/response-builder";
import { ValidationError } from "../../core/errors";
import {
  TargetNotFoundError,
  TargetLockedError,
  InvalidSelectionError,
  EditNotFoundError,
  RollbackError,
  ProviderError,
  ContentParseError,
} from "../../domain/services/content-editor/errors";

/**
 * ContentEditorController - Thin HTTP handler for content editing
 */
export class ContentEditorController {
  constructor(private contentEditorService: ContentEditorService) {}

  /**
   * POST /api/content-editor/stream
   * Start a streaming edit operation
   */
  async stream(ctx: RouteContext): Promise<Response> {
    const body = await ctx.req.json();

    try {
      const result = await this.contentEditorService.editContentStream({
        target: body.target,
        mode: body.mode,
        instruction: body.instruction,
        selection: body.selection,
        provider: body.provider,
        model: body.model,
        workspaceId: body.workspaceId,
        projectId: body.projectId,
        systemPrompt: body.systemPrompt,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
      });

      // Return SSE response
      return new Response(result.stream, {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Edit-Id": result.editId,
          "X-Snapshot-Id": result.snapshotId,
          ...(result.lockId ? { "X-Lock-Id": result.lockId } : {}),
        },
      });
    } catch (err) {
      return this.handleError(err);
    }
  }

  /**
   * POST /api/content-editor/rollback/:editId
   * Rollback an edit to its snapshot
   */
  async rollback(ctx: RouteContext): Promise<Response> {
    const editId = ctx.params.getOrThrow("editId");

    try {
      await this.contentEditorService.rollback(editId);
      return ResponseBuilder.success({ editId, rolledBack: true });
    } catch (err) {
      return this.handleError(err);
    }
  }

  /**
   * POST /api/content-editor/cancel/:editId
   * Cancel an in-progress edit
   */
  async cancel(ctx: RouteContext): Promise<Response> {
    const editId = ctx.params.getOrThrow("editId");

    try {
      const result = await this.contentEditorService.cancel(editId);
      return ResponseBuilder.success(result);
    } catch (err) {
      return this.handleError(err);
    }
  }

  /**
   * POST /api/content-editor/tool-call
   * Handle tool calls for content editor
   */
  async toolCall(ctx: RouteContext): Promise<Response> {
    const body = await ctx.req.json();

    try {
      const { toolCall, activeContext, provider, model } = body ?? {};

      if (!toolCall) {
        throw new ValidationError("toolCall required");
      }

      if (!activeContext) {
        throw new ValidationError("activeContext required");
      }

      if (!provider || !model) {
        throw new ValidationError("provider and model required");
      }

      const service = this.contentEditorService as ContentEditorService & {
        handleToolCall: (
          toolCall: unknown,
          activeContext: unknown,
          options: { provider: string; model: string }
        ) => Promise<unknown>;
      };

      const result = await service.handleToolCall(toolCall, activeContext, {
        provider,
        model,
      });

      return ResponseBuilder.success(result);
    } catch (err) {
      return this.handleError(err);
    }
  }

  /**
   * GET /api/content-editor/targets
   * List registered content targets
   */
  async getTargets(_ctx: RouteContext): Promise<Response> {
    const targets = this.contentEditorService.getRegisteredTargets();
    return ResponseBuilder.success({ targets });
  }

  /**
   * GET /api/content-editor/history
   * Get edit history for a target
   * Query params: targetType, targetId, limit
   */
  async getHistory(ctx: RouteContext): Promise<Response> {
    const targetType = ctx.query.get("targetType");
    const targetId = ctx.query.get("targetId");
    const limitStr = ctx.query.get("limit");

    if (!targetType || !targetId) {
      throw new ValidationError("targetType and targetId query params required");
    }

    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    const history = await this.contentEditorService.getEditHistory(
      { targetType, targetId },
      limit
    );

    return ResponseBuilder.success({ history });
  }

  /**
   * Map domain errors to HTTP responses
   */
  private handleError(err: unknown): Response {
    if (err instanceof TargetNotFoundError) {
      return ResponseBuilder.notFound(err.message);
    }

    if (err instanceof TargetLockedError) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "TARGET_LOCKED",
            message: err.message,
            lockingEditId: err.lockingEditId,
          },
        }),
        {
          status: 409,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    if (err instanceof InvalidSelectionError) {
      return ResponseBuilder.badRequest(err.message);
    }

    if (err instanceof EditNotFoundError) {
      return ResponseBuilder.notFound(err.message);
    }

    if (err instanceof RollbackError) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "ROLLBACK_FAILED",
            message: err.message,
          },
        }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    if (err instanceof ProviderError) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "PROVIDER_ERROR",
            message: err.message,
          },
        }),
        {
          status: 503,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    if (err instanceof ContentParseError) {
      return ResponseBuilder.badRequest(err.message);
    }

    if (err instanceof ValidationError) {
      return ResponseBuilder.badRequest(err.message);
    }

    // Rethrow unknown errors for global handler
    throw err;
  }
}
