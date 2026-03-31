import { z } from "zod";
import type { RouteContext } from "../router";
import { ResponseBuilder } from "../../core/utils/response-builder";
import { MentionRegistry } from "../../domain/services/mention-registry";
import type {
  MentionSearchResponse,
  MentionStalenessResponse,
  MentionStalenessInfo,
} from "@shared/types/mention";

// Validation schemas
const MentionSearchSchema = z.object({
  query: z.string().min(0).max(200),
  workspaceId: z.string().uuid(),
  chatId: z.string().uuid().optional(),  // Optional for new chats
  limit: z.number().int().positive().max(50).optional(),
  entityTypes: z.array(z.string().min(1).max(50)).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

const MentionStalenessSchema = z.object({
  mentions: z.array(
    z.object({
      entityType: z.string().min(1).max(50),
      entityId: z.string().uuid(),
      snapshotCreatedAt: z.string(), // Required for staleness check
    })
  ).max(100),
});

export class MentionController {
  async search(ctx: RouteContext): Promise<Response> {
    let body: z.infer<typeof MentionSearchSchema>;
    try {
      const rawBody = await ctx.req.json();
      body = MentionSearchSchema.parse(rawBody);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return ResponseBuilder.badRequest(
          `Validation error: ${err.issues.map((issue) => issue.message).join(", ")}`
        );
      }
      return ResponseBuilder.badRequest("Invalid request body");
    }

    const registry = MentionRegistry.get();
    const results = await registry.search(
      {
        query: body.query,
        workspaceId: body.workspaceId,
        chatId: body.chatId,
        limit: body.limit ?? 10,
        filters: body.filters,
      },
      body.entityTypes,
    );

    const response: MentionSearchResponse = {
      results,
      hasMore: results.length >= (body.limit ?? 10),
    };

    return ResponseBuilder.success(response);
  }

  async resolve(ctx: RouteContext): Promise<Response> {
    const entityType = ctx.params.getOrThrow("entityType");
    const entityId = ctx.params.getOrThrow("entityId");
    const workspaceId = ctx.query.get("workspaceId");

    if (!workspaceId) {
      return ResponseBuilder.badRequest("workspaceId query param required");
    }

    const registry = MentionRegistry.get();
    const entity = await registry.resolve(entityType, entityId, workspaceId);

    if (!entity) {
      return ResponseBuilder.notFound("Entity not found");
    }

    return ResponseBuilder.success({ entity });
  }

  async checkStaleness(ctx: RouteContext): Promise<Response> {
    let body: z.infer<typeof MentionStalenessSchema>;
    try {
      const rawBody = await ctx.req.json();
      body = MentionStalenessSchema.parse(rawBody);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return ResponseBuilder.badRequest(
          `Validation error: ${err.issues.map((issue) => issue.message).join(", ")}`
        );
      }
      return ResponseBuilder.badRequest("Invalid request body");
    }

    const registry = MentionRegistry.get();
    const results: Record<string, MentionStalenessInfo> = {};

    await Promise.all(
      body.mentions.map(async (mention) => {
        const key = `${mention.entityType}:${mention.entityId}`;
        results[key] = await registry.checkStaleness(
          mention.entityType,
          mention.entityId,
          mention.snapshotCreatedAt,
        );
      }),
    );

    const response: MentionStalenessResponse = { results };
    return ResponseBuilder.success(response);
  }

  async getTypes(_ctx: RouteContext): Promise<Response> {
    const registry = MentionRegistry.get();
    const types = registry.getEntityTypes();
    return ResponseBuilder.success({ types });
  }

  async getNavigationPath(ctx: RouteContext): Promise<Response> {
    const entityType = ctx.params.getOrThrow("entityType");
    const entityId = ctx.params.getOrThrow("entityId");

    const registry = MentionRegistry.get();
    const path = await registry.getNavigationPath(entityType, entityId);

    if (!path) {
      return ResponseBuilder.notFound(
        "Entity not found or no navigation available",
      );
    }

    return ResponseBuilder.success({ path });
  }
}
