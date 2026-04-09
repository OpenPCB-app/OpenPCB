import type { RouteContext } from "../router";
import type { IMessageService } from "../../domain/services/message-service";
import { ResponseBuilder } from "../../core/utils/response-builder";

export class MessageActionController {
  constructor(private messageService: IMessageService) {}

  async editMessage(ctx: RouteContext): Promise<Response> {
    const messageId = ctx.params.getOrThrow("id");

    let parsed: unknown;
    try {
      parsed = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const content = this.extractEditContent(parsed);
    if (!content) {
      return ResponseBuilder.badRequest("content is required and must be a non-empty string");
    }

    const result = await this.messageService.editMessage(messageId, content);

    return ResponseBuilder.success(result);
  }

  async resendMessage(ctx: RouteContext): Promise<Response> {
    const messageId = ctx.params.getOrThrow("id");
    const result = await this.messageService.resendMessage(messageId);
    return ResponseBuilder.success(result);
  }

  async regenerateMessage(ctx: RouteContext): Promise<Response> {
    const messageId = ctx.params.getOrThrow("id");
    const result = await this.messageService.regenerateMessage(messageId);
    return ResponseBuilder.success(result);
  }

  private extractEditContent(body: unknown): string | null {
    if (!body || typeof body !== "object") {
      return null;
    }

    const value = body as { content?: unknown };
    if (typeof value.content === "string") {
      const trimmed = value.content.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (
      value.content &&
      typeof value.content === "object" &&
      (value.content as { type?: unknown }).type === "text" &&
      typeof (value.content as { text?: unknown }).text === "string"
    ) {
      const text = (value.content as { text: string }).text.trim();
      return text.length > 0 ? text : null;
    }

    return null;
  }
}
