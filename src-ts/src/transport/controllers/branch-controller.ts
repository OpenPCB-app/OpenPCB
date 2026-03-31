import type { RouteContext } from "../router";
import type { IBranchService } from "../../domain/services/branch-service";
import { ResponseBuilder } from "../../core/utils/response-builder";

export class BranchController {
  constructor(private branchService: IBranchService) {}

  async getBranches(ctx: RouteContext): Promise<Response> {
    const chatId = ctx.params.getOrThrow("id");
    const result = await this.branchService.getBranchTree(chatId);
    return ResponseBuilder.success(result);
  }

  async getAlternateBranches(ctx: RouteContext): Promise<Response> {
    const messageId = ctx.params.getOrThrow("id");
    const result = await this.branchService.getAlternateBranches(messageId);
    return ResponseBuilder.success(result);
  }

  async createBranch(ctx: RouteContext): Promise<Response> {
    const parentMessageId = ctx.params.getOrThrow("id");

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return ResponseBuilder.badRequest("Request body must be a JSON object");
    }
    const parsed = body as Record<string, unknown>;
    if (parsed.content === undefined) {
      return ResponseBuilder.badRequest("content is required");
    }
    if (
      parsed.role !== undefined &&
      parsed.role !== "user" &&
      parsed.role !== "assistant"
    ) {
      return ResponseBuilder.badRequest("role must be 'user' or 'assistant'");
    }

    const result = await this.branchService.createBranch(parentMessageId, {
      content: parsed.content,
      role: parsed.role as "user" | "assistant" | undefined,
      provider: parsed.provider as string | undefined,
      model: parsed.model as string | undefined,
    });

    return ResponseBuilder.created(result);
  }

  async activateBranch(ctx: RouteContext): Promise<Response> {
    const messageId = ctx.params.getOrThrow("id");
    const result = await this.branchService.activateBranch(messageId);
    return ResponseBuilder.success(result);
  }

  async archiveBranch(ctx: RouteContext): Promise<Response> {
    const messageId = ctx.params.getOrThrow("id");
    const result = await this.branchService.archiveBranch(messageId);
    return ResponseBuilder.success(result);
  }
}
