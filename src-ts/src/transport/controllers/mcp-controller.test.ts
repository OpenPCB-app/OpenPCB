import { describe, expect, it, mock } from "bun:test";
import type { RouteContext } from "../router";
import { McpController } from "./mcp-controller";
import type { IMcpService } from "../../domain/services/mcp-service";

function createContext(input: {
  id?: string;
  body?: unknown;
  jsonError?: boolean;
  url?: string;
}): RouteContext {
  return {
    req: {
      url: input.url ?? "http://localhost/api/mcp/servers/server-1",
      json: async () => {
        if (input.jsonError) {
          throw new Error("invalid json");
        }
        return input.body;
      },
    } as Request,
    params: {
      getOrThrow: (key: string) => {
        if (key === "id") {
          return input.id ?? "server-1";
        }
        throw new Error(`Unexpected param: ${key}`);
      },
    } as RouteContext["params"],
    query: new URLSearchParams(),
    url: new URL(input.url ?? "http://localhost/api/mcp/servers/server-1"),
  };
}

function createServiceMock(): IMcpService {
  return {
    listServers: mock(async () => []),
    createServer: mock(async () => ({
      id: "server-1",
      alias: "github",
      displayName: "GitHub",
      transport: "stdio",
      command: "bun",
      args: ["mcp-server.js"],
      env: null,
      url: null,
      headers: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    getServer: mock(async () => ({
      id: "server-1",
      alias: "github",
      displayName: "GitHub",
      transport: "stdio",
      command: "bun",
      args: ["mcp-server.js"],
      env: null,
      url: null,
      headers: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    updateServer: mock(async () => ({
      id: "server-1",
      alias: "github-updated",
      displayName: "GitHub Updated",
      transport: "stdio",
      command: "bun",
      args: ["mcp-server.js"],
      env: null,
      url: null,
      headers: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    deleteServer: mock(async () => true),
    connectServer: mock(async () => ({
      serverId: "server-1",
      connected: true,
      toolCount: 2,
    })),
    disconnectServer: mock(async () => ({
      serverId: "server-1",
      disconnected: true,
    })),
    listServerTools: mock(async () => [
      { name: "search_repositories", description: "Search repositories" },
    ]),
    testToolCall: mock(async () => ({ content: [{ type: "text", text: "ok" }] })),
  };
}

describe("McpController", () => {
  it("supports CRUD endpoints with response envelopes", async () => {
    const controller = new McpController(createServiceMock());

    const listResponse = await controller.listServers(createContext({}));
    const createResponse = await controller.createServer(
      createContext({
        body: {
          alias: "github",
          transport: "stdio",
          command: "bun",
          args: ["mcp-server.js"],
        },
      }),
    );
    const getResponse = await controller.getServer(createContext({ id: "server-1" }));
    const updateResponse = await controller.updateServer(
      createContext({ id: "server-1", body: { alias: "github-updated" } }),
    );
    const deleteResponse = await controller.deleteServer(createContext({ id: "server-1" }));

    expect(listResponse.status).toBe(200);
    expect(createResponse.status).toBe(201);
    expect(getResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);

    const createPayload = (await createResponse.json()) as {
      ok: boolean;
      data: { server: { alias: string } };
    };
    const deletePayload = (await deleteResponse.json()) as {
      ok: boolean;
      data: { deleted: boolean };
    };

    expect(createPayload.ok).toBe(true);
    expect(createPayload.data.server.alias).toBe("github");
    expect(deletePayload.ok).toBe(true);
    expect(deletePayload.data.deleted).toBe(true);
  });

  it("supports connect, disconnect, list-tools and test-call endpoints", async () => {
    const controller = new McpController(createServiceMock());

    const connectResponse = await controller.connectServer(createContext({ id: "server-1" }));
    const toolsResponse = await controller.listTools(createContext({ id: "server-1" }));
    const testCallResponse = await controller.testCall(
      createContext({
        id: "server-1",
        body: {
          toolName: "search_repositories",
          args: { query: "openpcb" },
        },
      }),
    );
    const disconnectResponse = await controller.disconnectServer(
      createContext({ id: "server-1" }),
    );

    expect(connectResponse.status).toBe(200);
    expect(toolsResponse.status).toBe(200);
    expect(testCallResponse.status).toBe(200);
    expect(disconnectResponse.status).toBe(200);

    const toolsPayload = (await toolsResponse.json()) as {
      ok: boolean;
      data: { tools: Array<{ name: string }> };
    };
    const testCallPayload = (await testCallResponse.json()) as {
      ok: boolean;
      data: { result: unknown };
    };

    expect(toolsPayload.ok).toBe(true);
    expect(toolsPayload.data.tools[0]?.name).toBe("search_repositories");
    expect(testCallPayload.ok).toBe(true);
    expect(testCallPayload.data.result).toBeDefined();
  });

  it("returns deterministic 400 validation payloads", async () => {
    const controller = new McpController(createServiceMock());

    const invalidCreate = await controller.createServer(
      createContext({ body: { alias: "", transport: "stdio" } }),
    );
    const invalidTestCall = await controller.testCall(
      createContext({ id: "server-1", body: { args: { query: "x" } } }),
    );
    const invalidJson = await controller.updateServer(
      createContext({ id: "server-1", jsonError: true }),
    );

    expect(invalidCreate.status).toBe(400);
    expect(invalidTestCall.status).toBe(400);
    expect(invalidJson.status).toBe(400);

    const createPayload = (await invalidCreate.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    const testCallPayload = (await invalidTestCall.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };

    expect(createPayload.ok).toBe(false);
    expect(createPayload.error.code).toBe("BAD_REQUEST");
    expect(createPayload.error.message).toBe("alias is required and cannot be empty");
    expect(testCallPayload.ok).toBe(false);
    expect(testCallPayload.error.code).toBe("BAD_REQUEST");
    expect(testCallPayload.error.message).toBe("toolName is required and cannot be empty");
  });
});
