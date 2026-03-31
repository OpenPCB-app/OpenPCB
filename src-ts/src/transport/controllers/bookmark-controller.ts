import type { RouteContext } from "../router";
import type { IBookmarkService } from "../../domain/services/bookmark-service";
import { ResponseBuilder } from "../../core/utils/response-builder";

export class BookmarkController {
  constructor(private bookmarkService: IBookmarkService) {}

  async list(ctx: RouteContext): Promise<Response> {
    const url = new URL(ctx.req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || null;
    const chatId = url.searchParams.get("chatId")?.trim() || null;

    if (chatId) {
      const bookmarks = await this.bookmarkService.listByChat(chatId);
      return ResponseBuilder.success({ bookmarks });
    }

    if (!workspaceId) {
      return ResponseBuilder.badRequest(
        "Missing workspaceId or chatId query parameter",
      );
    }

    const bookmarks = await this.bookmarkService.listByWorkspace(workspaceId);
    return ResponseBuilder.success({ bookmarks });
  }

  async get(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const bookmark = await this.bookmarkService.get(id);
    return ResponseBuilder.success({ bookmark });
  }

  async create(ctx: RouteContext): Promise<Response> {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;
    if (!parsed.workspaceId || typeof parsed.workspaceId !== "string") {
      return ResponseBuilder.badRequest("workspaceId is required");
    }
    if (!parsed.messageId || typeof parsed.messageId !== "string") {
      return ResponseBuilder.badRequest("messageId is required");
    }
    if (
      parsed.chatId !== undefined &&
      parsed.chatId !== null &&
      typeof parsed.chatId !== "string"
    ) {
      return ResponseBuilder.badRequest("chatId must be a string or null");
    }
    if (
      parsed.note !== undefined &&
      parsed.note !== null &&
      typeof parsed.note !== "string"
    ) {
      return ResponseBuilder.badRequest("note must be a string or null");
    }

    const bookmark = await this.bookmarkService.create({
      workspaceId: parsed.workspaceId,
      messageId: parsed.messageId,
      chatId: parsed.chatId as string | null | undefined,
      note: parsed.note as string | null | undefined,
    });
    return ResponseBuilder.created({ bookmark });
  }

  async update(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;
    if (
      parsed.note !== undefined &&
      parsed.note !== null &&
      typeof parsed.note !== "string"
    ) {
      return ResponseBuilder.badRequest("note must be a string or null");
    }

    const bookmark = await this.bookmarkService.update(id, {
      note: parsed.note as string | null | undefined,
    });
    return ResponseBuilder.success({ bookmark });
  }

  async delete(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const result = await this.bookmarkService.remove(id);
    return ResponseBuilder.success(result);
  }

  async deleteByMessage(ctx: RouteContext): Promise<Response> {
    const messageId = ctx.params.getOrThrow("messageId");
    const result = await this.bookmarkService.removeByMessage(messageId);
    return ResponseBuilder.success(result);
  }

  async checkStatus(ctx: RouteContext): Promise<Response> {
    const url = new URL(ctx.req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || null;
    const messageId = url.searchParams.get("messageId")?.trim() || null;

    if (!workspaceId) {
      return ResponseBuilder.badRequest("Missing workspaceId query parameter");
    }
    if (!messageId) {
      return ResponseBuilder.badRequest("Missing messageId query parameter");
    }

    const isBookmarked = await this.bookmarkService.isBookmarked(
      workspaceId,
      messageId,
    );
    return ResponseBuilder.success({ isBookmarked });
  }
}
