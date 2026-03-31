import type { ToolHandler } from "@shared/types/tool.types";
import type { ToolSpec } from "@shared/types/tool-spec.types";
import type { McpToolDefinition } from "../../../infrastructure/mcp/session-manager";
import { ToolRegistry } from "../tools/tool-registry";
import {
  McpToolIdentityError,
  buildCanonicalMcpToolId,
  buildMcpCanonicalToolIndex,
} from "./mcp-tool-identity-policy";

export interface McpToolRuntime {
  listTools(serverId: string): Promise<McpToolDefinition[]>;
  callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface RegisterMcpServerToolsInput {
  serverId: string;
  serverAlias: string;
  toolAliases?: Record<string, string>;
}

export class McpToolRegistryBridge {
  private readonly serverDisposers = new Map<string, Array<() => void>>();

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly runtime: McpToolRuntime,
  ) {}

  async registerServerTools(input: RegisterMcpServerToolsInput): Promise<() => void> {
    this.unregisterServerTools(input.serverId);

    const tools = await this.runtime.listTools(input.serverId);
    const identityInputs = tools.map((tool) => ({
      serverAlias: input.serverAlias,
      toolName: tool.name,
      toolAlias: input.toolAliases?.[tool.name],
    }));

    buildMcpCanonicalToolIndex(identityInputs);

    const disposers: Array<() => void> = [];
    try {
      for (const tool of tools) {
        const canonical = buildCanonicalMcpToolId({
          serverAlias: input.serverAlias,
          toolName: tool.name,
          toolAlias: input.toolAliases?.[tool.name],
        });

        if (this.toolRegistry.has(canonical.canonicalId)) {
          throw new McpToolIdentityError(
            "MCP_CANONICAL_ID_COLLISION",
            `canonical id '${canonical.canonicalId}' already registered`,
          );
        }

        const spec: ToolSpec = {
          name: canonical.canonicalId,
          scope: "module",
          version: "1.0",
          description:
            tool.description?.trim() ||
            `MCP tool '${tool.name}' from server '${input.serverAlias}'`,
          inputSchema: normalizeInputSchema(tool.inputSchema),
          guards: [],
        };

        const handler: ToolHandler = {
          execute: (args) => this.runtime.callTool(input.serverId, tool.name, args),
        };

        const dispose = this.toolRegistry.register(spec, handler, {
          moduleId: "mcp",
        });

        disposers.push(dispose);
      }
    } catch (error) {
      for (const dispose of disposers) {
        safeDispose(dispose);
      }
      throw error;
    }

    this.serverDisposers.set(input.serverId, disposers);

    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      this.unregisterServerTools(input.serverId);
    };
  }

  unregisterServerTools(serverId: string): void {
    const disposers = this.serverDisposers.get(serverId);
    if (!disposers) {
      return;
    }

    for (const dispose of disposers) {
      safeDispose(dispose);
    }
    this.serverDisposers.delete(serverId);
  }

  dispose(): void {
    for (const serverId of this.serverDisposers.keys()) {
      this.unregisterServerTools(serverId);
    }
  }
}

function normalizeInputSchema(schema: unknown): Record<string, unknown> {
  const normalized = isRecord(schema) ? { ...schema } : {};
  if (normalized.type !== "object") {
    normalized.type = "object";
  }
  if (!isRecord(normalized.properties)) {
    normalized.properties = {};
  }

  normalized.additionalProperties = true;
  return normalized;
}

function safeDispose(dispose: () => void): void {
  try {
    dispose();
  } catch {
    return;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
