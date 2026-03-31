import type { RouteContext } from "../router";
import { ResponseBuilder } from "../../core/utils/response-builder";
import type {
  CreateMcpServerInput,
  IMcpService,
  UpdateMcpServerInput,
} from "../../domain/services/mcp-service";

export class McpController {
  constructor(private readonly mcpService: IMcpService) {}

  async listServers(_ctx: RouteContext): Promise<Response> {
    const servers = await this.mcpService.listServers();
    return ResponseBuilder.success({ servers });
  }

  async createServer(ctx: RouteContext): Promise<Response> {
    const parsed = await this.parseCreatePayload(ctx);
    if (parsed instanceof Response) {
      return parsed;
    }

    const server = await this.mcpService.createServer(parsed);
    return ResponseBuilder.created({ server });
  }

  async getServer(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const server = await this.mcpService.getServer(id);
    return ResponseBuilder.success({ server });
  }

  async updateServer(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const parsed = await this.parseUpdatePayload(ctx);
    if (parsed instanceof Response) {
      return parsed;
    }

    const server = await this.mcpService.updateServer(id, parsed);
    return ResponseBuilder.success({ server });
  }

  async deleteServer(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const deleted = await this.mcpService.deleteServer(id);
    return ResponseBuilder.success({ deleted });
  }

  async connectServer(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const result = await this.mcpService.connectServer(id);
    return ResponseBuilder.success(result);
  }

  async disconnectServer(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const result = await this.mcpService.disconnectServer(id);
    return ResponseBuilder.success(result);
  }

  async listTools(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const tools = await this.mcpService.listServerTools(id);
    return ResponseBuilder.success({ tools });
  }

  async testCall(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;
    if (!parsed.toolName || typeof parsed.toolName !== "string" || parsed.toolName.trim() === "") {
      return ResponseBuilder.badRequest("toolName is required and cannot be empty");
    }

    if (parsed.args !== undefined && !isRecord(parsed.args)) {
      return ResponseBuilder.badRequest("args must be an object when provided");
    }

    const result = await this.mcpService.testToolCall(
      id,
      parsed.toolName,
      (parsed.args as Record<string, unknown> | undefined) ?? {},
    );
    return ResponseBuilder.success({ result });
  }

  private async parseCreatePayload(
    ctx: RouteContext,
  ): Promise<CreateMcpServerInput | Response> {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;
    if (!parsed.alias || typeof parsed.alias !== "string" || parsed.alias.trim() === "") {
      return ResponseBuilder.badRequest("alias is required and cannot be empty");
    }
    if (parsed.transport !== "stdio" && parsed.transport !== "http") {
      return ResponseBuilder.badRequest("transport must be either 'stdio' or 'http'");
    }

    if (parsed.transport === "stdio") {
      if (
        !parsed.command ||
        typeof parsed.command !== "string" ||
        parsed.command.trim() === ""
      ) {
        return ResponseBuilder.badRequest("command is required for stdio transport");
      }
      if (parsed.args !== undefined && !isStringArray(parsed.args)) {
        return ResponseBuilder.badRequest("args must be a string array when provided");
      }
      if (parsed.env !== undefined && parsed.env !== null && !isStringRecord(parsed.env)) {
        return ResponseBuilder.badRequest("env must be a string map when provided");
      }
    }

    if (parsed.transport === "http") {
      if (!parsed.url || typeof parsed.url !== "string" || parsed.url.trim() === "") {
        return ResponseBuilder.badRequest("url is required for http transport");
      }
      if (
        parsed.headers !== undefined &&
        parsed.headers !== null &&
        !isStringRecord(parsed.headers)
      ) {
        return ResponseBuilder.badRequest("headers must be a string map when provided");
      }
    }

    if (parsed.enabled !== undefined && typeof parsed.enabled !== "boolean") {
      return ResponseBuilder.badRequest("enabled must be a boolean when provided");
    }

    return {
      alias: parsed.alias,
      displayName:
        parsed.displayName === undefined || parsed.displayName === null
          ? null
          : String(parsed.displayName),
      transport: parsed.transport,
      command: typeof parsed.command === "string" ? parsed.command : null,
      args: isStringArray(parsed.args) ? parsed.args : null,
      env: isStringRecord(parsed.env) ? parsed.env : null,
      url: typeof parsed.url === "string" ? parsed.url : null,
      headers: isStringRecord(parsed.headers) ? parsed.headers : null,
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
    };
  }

  private async parseUpdatePayload(
    ctx: RouteContext,
  ): Promise<UpdateMcpServerInput | Response> {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;

    if (parsed.alias !== undefined) {
      if (typeof parsed.alias !== "string" || parsed.alias.trim() === "") {
        return ResponseBuilder.badRequest("alias cannot be empty when provided");
      }
    }

    if (
      parsed.transport !== undefined &&
      parsed.transport !== "stdio" &&
      parsed.transport !== "http"
    ) {
      return ResponseBuilder.badRequest("transport must be either 'stdio' or 'http'");
    }

    if (parsed.args !== undefined && parsed.args !== null && !isStringArray(parsed.args)) {
      return ResponseBuilder.badRequest("args must be a string array when provided");
    }
    if (parsed.env !== undefined && parsed.env !== null && !isStringRecord(parsed.env)) {
      return ResponseBuilder.badRequest("env must be a string map when provided");
    }
    if (
      parsed.headers !== undefined &&
      parsed.headers !== null &&
      !isStringRecord(parsed.headers)
    ) {
      return ResponseBuilder.badRequest("headers must be a string map when provided");
    }
    if (parsed.enabled !== undefined && typeof parsed.enabled !== "boolean") {
      return ResponseBuilder.badRequest("enabled must be a boolean when provided");
    }

    return {
      alias: typeof parsed.alias === "string" ? parsed.alias : undefined,
      displayName:
        parsed.displayName === undefined
          ? undefined
          : parsed.displayName === null
            ? null
            : String(parsed.displayName),
      transport:
        parsed.transport === "stdio" || parsed.transport === "http"
          ? parsed.transport
          : undefined,
      command: typeof parsed.command === "string" ? parsed.command : undefined,
      args: isStringArray(parsed.args) ? parsed.args : undefined,
      env: isStringRecord(parsed.env) ? parsed.env : undefined,
      url: typeof parsed.url === "string" ? parsed.url : undefined,
      headers: isStringRecord(parsed.headers) ? parsed.headers : undefined,
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : undefined,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }

  for (const entryValue of Object.values(value)) {
    if (typeof entryValue !== "string") {
      return false;
    }
  }

  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
