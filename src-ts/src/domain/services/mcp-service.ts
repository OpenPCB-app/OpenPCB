import { NotFoundError, ValidationError } from "../../core/errors";
import type { DatabaseAccess } from "../../db";
import type {
  McpServer,
  McpServerHeaders,
  McpServerTransport,
  McpServerEnv,
} from "../../db/schema/mcp-server";
import { McpToolRegistryBridge } from "./mcp/mcp-tool-registry-bridge";
import {
  StdioMcpSessionManager,
  type McpToolDefinition,
  type StdioMcpServerConfig,
} from "../../infrastructure/mcp/session-manager";
import {
  HttpMcpSessionManager,
  type HttpMcpServerConfig,
} from "../../infrastructure/mcp/http-mcp-session-manager";
import type { ToolRegistry } from "./tools/tool-registry";

export interface CreateMcpServerInput {
  alias: string;
  displayName?: string | null;
  transport: McpServerTransport;
  command?: string | null;
  args?: string[] | null;
  env?: McpServerEnv | null;
  url?: string | null;
  headers?: McpServerHeaders | null;
  enabled?: boolean;
}

export interface UpdateMcpServerInput {
  alias?: string;
  displayName?: string | null;
  transport?: McpServerTransport;
  command?: string | null;
  args?: string[] | null;
  env?: McpServerEnv | null;
  url?: string | null;
  headers?: McpServerHeaders | null;
  enabled?: boolean;
}

export interface McpConnectResult {
  serverId: string;
  connected: true;
  toolCount: number;
}

export interface McpDisconnectResult {
  serverId: string;
  disconnected: true;
}

export interface McpListedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface IMcpService {
  listServers(): Promise<McpServer[]>;
  createServer(input: CreateMcpServerInput): Promise<McpServer>;
  getServer(id: string): Promise<McpServer>;
  updateServer(id: string, patch: UpdateMcpServerInput): Promise<McpServer>;
  deleteServer(id: string): Promise<boolean>;
  connectServer(id: string): Promise<McpConnectResult>;
  disconnectServer(id: string): Promise<McpDisconnectResult>;
  listServerTools(id: string): Promise<McpListedTool[]>;
  testToolCall(id: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

interface ConnectedSession {
  transport: McpServerTransport;
  disposeTools: () => void;
}

export class McpService implements IMcpService {
  private readonly stdioManager = new StdioMcpSessionManager();
  private readonly httpManager = new HttpMcpSessionManager();
  private readonly toolBridge: McpToolRegistryBridge;
  private readonly connectedSessions = new Map<string, ConnectedSession>();
  private readonly startupHydrationPromise: Promise<void>;

  constructor(
    private readonly db: DatabaseAccess,
    toolRegistry: ToolRegistry,
  ) {
    this.toolBridge = new McpToolRegistryBridge(toolRegistry, {
      listTools: async (serverId: string) => this.listToolsForConnectedServer(serverId),
      callTool: async (serverId: string, name: string, args: Record<string, unknown>) =>
        this.callToolForConnectedServer(serverId, name, args),
    });
    this.startupHydrationPromise = this.rehydrateEnabledServersOnStartup().catch((error) => {
      console.warn(
        `[McpService] Startup MCP hydration failed: ${stringifyError(error)}`,
      );
    });
    void this.startupHydrationPromise;
  }

  async listServers(): Promise<McpServer[]> {
    return this.db.mcpServers.findAll();
  }

  async createServer(input: CreateMcpServerInput): Promise<McpServer> {
    return this.db.mcpServers.create(input);
  }

  async getServer(id: string): Promise<McpServer> {
    const server = await this.db.mcpServers.findById(id);
    if (!server) {
      throw new NotFoundError("MCP server", id);
    }
    return server;
  }

  async updateServer(id: string, patch: UpdateMcpServerInput): Promise<McpServer> {
    await this.getServer(id);
    return this.db.mcpServers.update(id, omitUndefined(patch));
  }

  async deleteServer(id: string): Promise<boolean> {
    await this.disconnectServer(id);
    return this.db.mcpServers.delete(id);
  }

  async connectServer(id: string): Promise<McpConnectResult> {
    const server = await this.getServer(id);
    if (!server.enabled) {
      throw new ValidationError("MCP server is disabled");
    }

    await this.disconnectServer(id);

    try {
      if (server.transport === "stdio") {
        await this.stdioManager.start(this.mapToStdioConfig(server));
        await this.stdioManager.connect(id);
      } else {
        await this.httpManager.start(this.mapToHttpConfig(server));
        await this.httpManager.connect(id);
      }

      this.connectedSessions.set(server.id, {
        transport: server.transport,
        disposeTools: () => {
          return;
        },
      });

      const disposeTools = await this.toolBridge.registerServerTools({
        serverId: server.id,
        serverAlias: server.alias,
      });
      this.connectedSessions.set(server.id, {
        transport: server.transport,
        disposeTools,
      });

      const tools = await this.listToolsForConnectedServer(server.id);
      return {
        serverId: server.id,
        connected: true,
        toolCount: tools.length,
      };
    } catch (error) {
      await this.forceClose(server.id, server.transport);
      throw error;
    }
  }

  async disconnectServer(id: string): Promise<McpDisconnectResult> {
    const existing = this.connectedSessions.get(id);
    if (existing) {
      existing.disposeTools();
      this.connectedSessions.delete(id);
      await this.forceClose(id, existing.transport);
      return { serverId: id, disconnected: true };
    }

    const persisted = await this.db.mcpServers.findById(id);
    if (persisted) {
      await this.forceClose(id, persisted.transport);
    }

    this.toolBridge.unregisterServerTools(id);
    return { serverId: id, disconnected: true };
  }

  async listServerTools(id: string): Promise<McpListedTool[]> {
    const tools = await this.listToolsForConnectedServer(id);
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : undefined,
    }));
  }

  async testToolCall(
    id: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return this.callToolForConnectedServer(id, toolName, args);
  }

  private async listToolsForConnectedServer(serverId: string): Promise<McpToolDefinition[]> {
    const connected = this.connectedSessions.get(serverId);
    if (!connected) {
      throw new ValidationError("MCP server is not connected");
    }

    if (connected.transport === "stdio") {
      return this.stdioManager.listTools(serverId);
    }
    return this.httpManager.listTools(serverId);
  }

  private async callToolForConnectedServer(
    serverId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const connected = this.connectedSessions.get(serverId);
    if (!connected) {
      throw new ValidationError("MCP server is not connected");
    }

    if (connected.transport === "stdio") {
      return this.stdioManager.callTool(serverId, name, args);
    }
    return this.httpManager.callTool(serverId, name, args);
  }

  private async forceClose(serverId: string, transport: McpServerTransport): Promise<void> {
    if (transport === "stdio") {
      await this.stdioManager.close(serverId);
      return;
    }
    await this.httpManager.close(serverId);
  }

  private mapToStdioConfig(server: McpServer): StdioMcpServerConfig {
    if (!server.command?.trim()) {
      throw new ValidationError("stdio transport requires command");
    }

    return {
      id: server.id,
      alias: server.alias,
      command: server.command,
      args: server.args ?? [],
      env: server.env ?? undefined,
    };
  }

  private mapToHttpConfig(server: McpServer): HttpMcpServerConfig {
    if (!server.url?.trim()) {
      throw new ValidationError("http transport requires url");
    }

    return {
      id: server.id,
      alias: server.alias,
      endpoint: server.url,
      headers: server.headers ?? undefined,
    };
  }

  private async rehydrateEnabledServersOnStartup(): Promise<void> {
    const servers = await this.db.mcpServers.findAll();

    for (const server of servers) {
      if (!this.isHydrationEligible(server)) {
        continue;
      }

      try {
        await this.connectServer(server.id);
      } catch (error) {
        console.warn(
          `[McpService] Startup reconnect failed for '${server.alias}' (${server.id}): ${stringifyError(error)}`,
        );
      }
    }
  }

  private isHydrationEligible(server: McpServer): boolean {
    if (!server.enabled) {
      return false;
    }

    if (server.transport === "stdio") {
      return Boolean(server.command?.trim());
    }

    if (server.transport === "http") {
      return Boolean(server.url?.trim());
    }

    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function omitUndefined<T extends object>(value: T): T {
  const out = {} as T;
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (entryValue !== undefined) {
      out[key as keyof T] = entryValue as T[keyof T];
    }
  }
  return out;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "unknown error");
}
