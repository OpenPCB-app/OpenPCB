import type { RouteContext } from "../router";
import type { IChatService } from "../../domain/services";
import type { IMessageService } from "../../domain/services/message-service";
import { ResponseBuilder } from "../../core/utils/response-builder";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_CHAT_LIMIT,
} from "../../domain/constants";
import { getChatManager } from "../../domain/services/chat-manager";
import { BusinessError, NotFoundError } from "../../core/errors";

/**
 * ChatController - Thin HTTP handler for chats
 * All business logic delegated to ChatService and MessageService
 */
export class ChatController {
  constructor(
    private chatService: IChatService,
    private messageService: IMessageService,
  ) { }

  /**
   * POST /api/chats/:id/fork
   * Fork chat from a message
   */
  async fork(ctx: RouteContext): Promise<Response> {
    const chatId = ctx.params.getOrThrow("id");

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;
    const fromMessageId = parsed?.fromMessageId;

    if (!fromMessageId || typeof fromMessageId !== "string") {
      return ResponseBuilder.badRequest(
        "fromMessageId is required and must be a string",
      );
    }

    try {
      const result = await getChatManager().forkChat(chatId, fromMessageId);
      return ResponseBuilder.success({
        chat: { id: result.chatId, title: result.title },
        messageCount: result.messageCount,
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return ResponseBuilder.notFound(err.entity || "Resource", err.id);
      }
      if (err instanceof BusinessError) {
        return ResponseBuilder.badRequest(err.message);
      }
      return ResponseBuilder.error("FORK_FAILED", "Failed to fork chat", 500, err);
    }
  }

  /**
   * GET /api/chats?workspaceId=...&limit=...&folderId=...&excludeCategories=...&projectId=...&category=...&contextType=...&contextId=...
   * folderId filter: omit = all chats, "null" = root level only, <id> = specific folder
   * excludeCategories: comma-separated list of categories to exclude (e.g., "brainstorming_node")
   * projectId filter: omit = all chats, "null" = workspace-level chats only, <id> = specific project
   */
  async list(ctx: RouteContext): Promise<Response> {
    const workspaceId = ctx.query.get("workspaceId") || DEFAULT_WORKSPACE_ID;
    const limitStr = ctx.query.get("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : DEFAULT_CHAT_LIMIT;
    const folderIdParam = ctx.query.get("folderId");
    const excludeCategoriesParam = ctx.query.get("excludeCategories");
    const projectIdParam = ctx.query.get("projectId");
    const categoryParam = ctx.query.get("category");
    const contextTypeParam = ctx.query.get("contextType");
    const contextIdParam = ctx.query.get("contextId");

    const options: {
      folderId?: string | null;
      excludeCategories?: string[];
      projectId?: string | null;
      category?: string | null;
      contextType?: string;
      contextId?: string;
    } = {};
    if (folderIdParam !== null) {
      options.folderId = folderIdParam === "null" ? null : folderIdParam;
    }
    if (excludeCategoriesParam) {
      options.excludeCategories = excludeCategoriesParam.split(",").filter(Boolean);
    }
    if (projectIdParam !== null) {
      options.projectId = projectIdParam === "null" ? null : projectIdParam;
    }
    if (categoryParam !== null) {
      options.category = categoryParam === "null" ? null : categoryParam;
    }
    if (contextTypeParam) {
      options.contextType = contextTypeParam;
    }
    if (contextIdParam) {
      options.contextId = contextIdParam;
    }

    const chats = await this.chatService.list(workspaceId, limit, options);
    return ResponseBuilder.success({ chats, total: chats.length });
  }

  /**
   * GET /api/chats/:id
   */
  async get(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const chat = await this.chatService.get(id);
    return ResponseBuilder.success({ chat });
  }

  /**
   * POST /api/chats
   */
  async create(ctx: RouteContext): Promise<Response> {
    const body = await ctx.req.json();
    const workspaceId = body.workspaceId || DEFAULT_WORKSPACE_ID;
    const chat = await this.chatService.create(body, workspaceId);
    return ResponseBuilder.created({ chat });
  }

  /**
   * PATCH /api/chats/:id
   */
  async update(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const body = await ctx.req.json();
    const chat = await this.chatService.update(id, body);
    return ResponseBuilder.success({ chat });
  }

  /**
   * DELETE /api/chats/:id
   */
  async delete(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    await this.chatService.delete(id);
    return ResponseBuilder.success({ deleted: true });
  }

  /**
   * POST /api/chats/bulk-delete
   */
  async bulkDelete(ctx: RouteContext): Promise<Response> {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;
    const ids = parsed?.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return ResponseBuilder.badRequest(
        "ids array is required and must not be empty",
      );
    }

    if (!ids.every((id) => typeof id === "string")) {
      return ResponseBuilder.badRequest("All ids must be strings");
    }

    const deletedCount = await this.chatService.bulkDelete(ids as string[]);
    return ResponseBuilder.success({ deleted: true, count: deletedCount });
  }

  /**
   * GET /api/chats/:id/messages
   */
  async getMessages(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const chatRecord = await this.chatService.getWithMessages(id);
    return ResponseBuilder.success({ messages: chatRecord.messages });
  }

  /**
   * POST /api/chats/:id/messages
   *
   * Create a user message and AI task for response generation.
   * See: TASK_SYSTEM_SPECIFICATION.md Section 6.1
   *
   * Request body: { content, provider?, model?, priority? }
   * Response: { taskId, userMessageId, status, dependsOn? }
   */
  async createMessage(ctx: RouteContext): Promise<Response> {
    const chatId = ctx.params.getOrThrow("id");

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;
    const content = parsed?.content;

    if (!content || typeof content !== "string") {
      return ResponseBuilder.badRequest(
        "Message content is required and must be a string",
      );
    }

    if (content.trim().length === 0) {
      return ResponseBuilder.badRequest("Message content cannot be empty");
    }

    const result = await this.messageService.createMessage(chatId, {
      content,
      provider: parsed.provider as string | undefined,
      model: parsed.model as string | undefined,
      priority: parsed.priority as number | undefined,
    });

    return ResponseBuilder.accepted(result);
  }

  /**
   * GET /api/messages/search?q=...&workspaceId=...&chatId=...&limit=...
   */
  async searchMessages(ctx: RouteContext): Promise<Response> {
    const query = ctx.query.get("q");
    if (!query || query.trim().length === 0) {
      return ResponseBuilder.badRequest('Query parameter "q" is required');
    }

    const workspaceId = ctx.query.get("workspaceId") || undefined;
    const chatId = ctx.query.get("chatId") || undefined;
    const limitStr = ctx.query.get("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : 50;

    const messages = await this.messageService.searchMessages(query, {
      workspaceId,
      chatId,
      limit,
    });

    return ResponseBuilder.success({ messages, total: messages.length });
  }
}
