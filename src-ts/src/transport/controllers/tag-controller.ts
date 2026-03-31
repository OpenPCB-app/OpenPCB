import type { RouteContext } from "../router";
import type { ITagService } from "../../domain/services/tag-service";
import { ResponseBuilder } from "../../core/utils/response-builder";

export class TagController {
  constructor(private tagService: ITagService) {}

  async list(ctx: RouteContext): Promise<Response> {
    const url = new URL(ctx.req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || null;
    const projectId = url.searchParams.get("projectId")?.trim() || null;

    if (!workspaceId) {
      return ResponseBuilder.badRequest("Missing workspaceId query parameter");
    }

    const tags = await this.tagService.listByWorkspace(workspaceId, projectId);
    return ResponseBuilder.success({ tags });
  }

  async get(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const tag = await this.tagService.get(id);
    return ResponseBuilder.success({ tag });
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
    if (
      !parsed.name ||
      typeof parsed.name !== "string" ||
      (parsed.name as string).trim() === ""
    ) {
      return ResponseBuilder.badRequest("name is required and cannot be empty");
    }
    if (
      parsed.projectId !== undefined &&
      parsed.projectId !== null &&
      typeof parsed.projectId !== "string"
    ) {
      return ResponseBuilder.badRequest("projectId must be a string or null");
    }
    if (
      parsed.color !== undefined &&
      parsed.color !== null &&
      typeof parsed.color !== "string"
    ) {
      return ResponseBuilder.badRequest("color must be a string or null");
    }
    if (
      parsed.sortOrder !== undefined &&
      typeof parsed.sortOrder !== "number"
    ) {
      return ResponseBuilder.badRequest("sortOrder must be a number");
    }

    const tag = await this.tagService.create({
      workspaceId: parsed.workspaceId,
      projectId: parsed.projectId as string | null | undefined,
      name: parsed.name,
      color: parsed.color as string | null | undefined,
      sortOrder: parsed.sortOrder as number | undefined,
    });
    return ResponseBuilder.created({ tag });
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
    if (parsed.name !== undefined) {
      if (typeof parsed.name !== "string") {
        return ResponseBuilder.badRequest("name must be a string");
      }
      if ((parsed.name as string).trim() === "") {
        return ResponseBuilder.badRequest("name cannot be empty");
      }
    }
    if (
      parsed.color !== undefined &&
      parsed.color !== null &&
      typeof parsed.color !== "string"
    ) {
      return ResponseBuilder.badRequest("color must be a string or null");
    }
    if (
      parsed.sortOrder !== undefined &&
      parsed.sortOrder !== null &&
      typeof parsed.sortOrder !== "number"
    ) {
      return ResponseBuilder.badRequest("sortOrder must be a number or null");
    }

    const tag = await this.tagService.update(id, {
      name: parsed.name as string | undefined,
      color: parsed.color as string | null | undefined,
      sortOrder: parsed.sortOrder as number | null | undefined,
    });
    return ResponseBuilder.success({ tag });
  }

  async delete(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const result = await this.tagService.remove(id);
    return ResponseBuilder.success(result);
  }

  async addTagToChat(ctx: RouteContext): Promise<Response> {
    const chatId = ctx.params.getOrThrow("chatId");
    const tagId = ctx.params.getOrThrow("tagId");
    await this.tagService.addTagToChat(chatId, tagId);
    return ResponseBuilder.success({ added: true });
  }

  async removeTagFromChat(ctx: RouteContext): Promise<Response> {
    const chatId = ctx.params.getOrThrow("chatId");
    const tagId = ctx.params.getOrThrow("tagId");
    await this.tagService.removeTagFromChat(chatId, tagId);
    return ResponseBuilder.success({ removed: true });
  }

  async getChatTags(ctx: RouteContext): Promise<Response> {
    const chatId = ctx.params.getOrThrow("chatId");
    const tags = await this.tagService.getTagsForChat(chatId);
    return ResponseBuilder.success({ tags });
  }

  async addTagToProject(ctx: RouteContext): Promise<Response> {
    const projectId = ctx.params.getOrThrow("projectId");
    const tagId = ctx.params.getOrThrow("tagId");
    await this.tagService.addTagToProject(projectId, tagId);
    return ResponseBuilder.success({ added: true });
  }

  async removeTagFromProject(ctx: RouteContext): Promise<Response> {
    const projectId = ctx.params.getOrThrow("projectId");
    const tagId = ctx.params.getOrThrow("tagId");
    await this.tagService.removeTagFromProject(projectId, tagId);
    return ResponseBuilder.success({ removed: true });
  }

  async getProjectTags(ctx: RouteContext): Promise<Response> {
    const projectId = ctx.params.getOrThrow("projectId");
    const tags = await this.tagService.getTagsForProject(projectId);
    return ResponseBuilder.success({ tags });
  }
}
