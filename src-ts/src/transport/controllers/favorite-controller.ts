import type { RouteContext } from "../router";
import type { IFavoriteService } from "../../domain/services/favorite-service";
import { ResponseBuilder } from "../../core/utils/response-builder";

export class FavoriteController {
  constructor(private favoriteService: IFavoriteService) {}

  async list(ctx: RouteContext): Promise<Response> {
    const url = new URL(ctx.req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || null;

    if (!workspaceId) {
      return ResponseBuilder.badRequest("Missing workspaceId query parameter");
    }

    const favorites = await this.favoriteService.listByWorkspace(workspaceId);
    return ResponseBuilder.success({ favorites });
  }

  async get(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const favorite = await this.favoriteService.get(id);
    return ResponseBuilder.success({ favorite });
  }

  async add(ctx: RouteContext): Promise<Response> {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;
    if (!parsed.workspaceId || typeof parsed.workspaceId !== "string") {
      return ResponseBuilder.badRequest("Workspace ID is required");
    }
    if (!parsed.chatId || typeof parsed.chatId !== "string") {
      return ResponseBuilder.badRequest("Chat ID is required");
    }

    if (
      parsed.sortOrder !== undefined &&
      typeof parsed.sortOrder !== "number"
    ) {
      return ResponseBuilder.badRequest("sortOrder must be a number");
    }

    const favorite = await this.favoriteService.add({
      workspaceId: parsed.workspaceId,
      chatId: parsed.chatId,
      sortOrder: parsed.sortOrder as number | undefined,
    });
    return ResponseBuilder.created({ favorite });
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
      parsed.sortOrder !== undefined &&
      typeof parsed.sortOrder !== "number"
    ) {
      return ResponseBuilder.badRequest("sortOrder must be a number");
    }

    const favorite = await this.favoriteService.update(id, {
      sortOrder: parsed.sortOrder as number | undefined,
    });
    return ResponseBuilder.success({ favorite });
  }

  async delete(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const result = await this.favoriteService.remove(id);
    return ResponseBuilder.success(result);
  }

  async deleteByChat(ctx: RouteContext): Promise<Response> {
    const chatId = ctx.params.getOrThrow("chatId");
    const result = await this.favoriteService.removeByChat(chatId);
    return ResponseBuilder.success(result);
  }

  async checkStatus(ctx: RouteContext): Promise<Response> {
    const url = new URL(ctx.req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || null;
    const chatId = url.searchParams.get("chatId")?.trim() || null;

    if (!workspaceId) {
      return ResponseBuilder.badRequest("Missing workspaceId query parameter");
    }
    if (!chatId) {
      return ResponseBuilder.badRequest("Missing chatId query parameter");
    }

    const isFavorite = await this.favoriteService.isFavorite(
      workspaceId,
      chatId,
    );
    return ResponseBuilder.success({ isFavorite });
  }
}
