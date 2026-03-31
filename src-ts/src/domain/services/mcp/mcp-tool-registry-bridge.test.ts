import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ToolCatalog } from "../tools/tool-catalog";
import { ToolRegistry } from "../tools/tool-registry";
import { McpToolIdentityError } from "./mcp-tool-identity-policy";
import {
  McpToolRegistryBridge,
  type McpToolRuntime,
} from "./mcp-tool-registry-bridge";

function createRuntime(overrides?: {
  listTools?: () => Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>>;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}): {
  runtime: McpToolRuntime;
  callTool: ReturnType<typeof mock<(serverId: string, name: string, args: Record<string, unknown>) => Promise<unknown>>>;
} {
  const callTool = mock(async (_serverId: string, name: string, args: Record<string, unknown>) => {
    if (overrides?.callTool) {
      return overrides.callTool(name, args);
    }
    return { ok: true, name, args };
  });

  const runtime: McpToolRuntime = {
    listTools: async () => {
      if (overrides?.listTools) {
        return overrides.listTools();
      }
      return [
        {
          name: "search_repositories",
          description: "Search repos",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
      ];
    },
    callTool,
  };

  return { runtime, callTool };
}

describe("mcp-tool-registry-bridge", () => {
  beforeEach(() => {
    ToolCatalog.reset();
  });

  it("registers MCP tools into ToolRegistry with canonical ids", async () => {
    const registry = new ToolRegistry();
    const { runtime, callTool } = createRuntime();
    const bridge = new McpToolRegistryBridge(registry, runtime);

    await bridge.registerServerTools({
      serverId: "server-1",
      serverAlias: "github",
    });

    expect(registry.has("mcp.github.search_repositories")).toBe(true);
    const registered = registry.get("mcp.github.search_repositories");
    expect(registered.spec?.scope).toBe("module");

    const schema = registered.definition.function.parameters as {
      additionalProperties?: boolean;
      required?: string[];
    };
    expect(schema.additionalProperties).toBe(true);
    expect(schema.required).toEqual(["query"]);

    const result = await registered.handler.execute({ query: "openpcb" });
    expect(callTool).toHaveBeenCalledWith("server-1", "search_repositories", {
      query: "openpcb",
    });
    expect(result).toEqual({
      ok: true,
      name: "search_repositories",
      args: { query: "openpcb" },
    });
  });

  it("unregisters bridged tools on disconnect and is idempotent", async () => {
    const registry = new ToolRegistry();
    const { runtime } = createRuntime();
    const bridge = new McpToolRegistryBridge(registry, runtime);

    await bridge.registerServerTools({
      serverId: "server-1",
      serverAlias: "github",
    });
    expect(registry.has("mcp.github.search_repositories")).toBe(true);

    bridge.unregisterServerTools("server-1");
    expect(registry.has("mcp.github.search_repositories")).toBe(false);

    expect(() => bridge.unregisterServerTools("server-1")).not.toThrow();
  });

  it("returns idempotent disposer from registerServerTools", async () => {
    const registry = new ToolRegistry();
    const { runtime } = createRuntime();
    const bridge = new McpToolRegistryBridge(registry, runtime);

    const dispose = await bridge.registerServerTools({
      serverId: "server-1",
      serverAlias: "github",
    });

    expect(registry.has("mcp.github.search_repositories")).toBe(true);
    dispose();
    expect(registry.has("mcp.github.search_repositories")).toBe(false);
    expect(() => dispose()).not.toThrow();
  });

  it("rejects canonical id collisions from alias mapping policy", async () => {
    const registry = new ToolRegistry();
    const { runtime } = createRuntime({
      listTools: async () => [
        { name: "search.repositories" },
        { name: "search_repositories" },
      ],
    });
    const bridge = new McpToolRegistryBridge(registry, runtime);

    await expect(
      bridge.registerServerTools({
        serverId: "server-1",
        serverAlias: "github",
        toolAliases: {
          "search.repositories": "search",
          search_repositories: "search",
        },
      }),
    ).rejects.toBeInstanceOf(McpToolIdentityError);

    await expect(
      bridge.registerServerTools({
        serverId: "server-1",
        serverAlias: "github",
        toolAliases: {
          "search.repositories": "search",
          search_repositories: "search",
        },
      }),
    ).rejects.toThrow("MCP_CANONICAL_ID_COLLISION");
  });

  it("rejects collision when canonical id already registered", async () => {
    const registry = new ToolRegistry();
    registry.register(
      {
        name: "mcp.github.search_repositories",
        scope: "module",
        version: "1.0",
        description: "existing",
        inputSchema: {
          type: "object",
          properties: {},
        },
        guards: [],
      },
      { execute: async () => ({ ok: true }) },
      { moduleId: "mcp" },
    );

    const { runtime } = createRuntime();
    const bridge = new McpToolRegistryBridge(registry, runtime);

    await expect(
      bridge.registerServerTools({
        serverId: "server-1",
        serverAlias: "github",
      }),
    ).rejects.toThrow("MCP_CANONICAL_ID_COLLISION");
  });
});
