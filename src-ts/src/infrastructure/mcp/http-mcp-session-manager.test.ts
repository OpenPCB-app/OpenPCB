import { afterEach, describe, expect, it } from "bun:test";
import {
  HttpMcpSessionManager,
  type HttpMcpServerConfig,
  type HttpMcpSessionManagerConfig,
} from "./http-mcp-session-manager";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
};

type MockCall = {
  url: string;
  request: JsonRpcRequest;
  headers: Headers;
  signal?: AbortSignal;
};

const originalFetch = globalThis.fetch;

function createServerConfig(alias: string): HttpMcpServerConfig {
  return {
    id: `http-${alias}`,
    alias,
    endpoint: "https://mcp.example.com",
  };
}

function createManagerConfig(
  overrides?: Partial<HttpMcpSessionManagerConfig>,
): HttpMcpSessionManagerConfig {
  return {
    requestTimeoutMs: 30,
    connectTimeoutMs: 30,
    maxConnectAttempts: 2,
    retryBaseDelayMs: 5,
    retryMaxDelayMs: 20,
    reconnectMaxAttempts: 2,
    reconnectBackoffFactor: 2,
    circuitOpenMs: 60,
    protocolVersion: "2025-06-18",
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("http-mcp-session-manager", () => {
  it("supports start/connect/list/call/close lifecycle with official init order", async () => {
    const calls: MockCall[] = [];
    const responses = [
      rpcResult("1", {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "fixture", version: "1.0.0" },
        capabilities: { tools: {} },
      }),
      rpcNotificationAck(),
      rpcResult("2", {
        tools: [
          {
            name: "search_repositories",
            description: "search",
            inputSchema: { type: "object" },
          },
        ],
      }),
      rpcResult("3", {
        content: [{ type: "text", text: "hello" }],
      }),
    ];

    globalThis.fetch = buildMockFetch(calls, () => responses.shift() ?? rpcNotificationAck());

    const manager = new HttpMcpSessionManager(createManagerConfig());
    const server = createServerConfig("fixture");
    await manager.start(server);
    await manager.connect(server.id);

    const sessions = manager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.state).toBe("connected");
    expect(calls.map((call) => call.request.method).slice(0, 2)).toEqual([
      "initialize",
      "notifications/initialized",
    ]);

    const tools = await manager.listTools(server.id);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("search_repositories");

    const result = await manager.callTool(server.id, "search_repositories", {
      query: "openpcb",
    });
    expect(result).toEqual({ content: [{ type: "text", text: "hello" }] });

    await manager.close(server.id);
    expect(manager.listSessions()).toHaveLength(0);
  });

  it("reconnects after disconnect with bounded backoff and retries request", async () => {
    const calls: MockCall[] = [];
    const sleepDelays: number[] = [];
    let callIndex = 0;

    globalThis.fetch = buildMockFetch(calls, () => {
      callIndex += 1;
      if (callIndex === 1) {
        return rpcResult("1", {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "fixture", version: "1.0.0" },
          capabilities: { tools: {} },
        });
      }
      if (callIndex === 2) {
        return rpcNotificationAck();
      }
      if (callIndex === 3) {
        throw new Error("ECONNRESET: socket hang up");
      }
      if (callIndex === 4) {
        return rpcResult("4", {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "fixture", version: "1.0.0" },
          capabilities: { tools: {} },
        });
      }
      if (callIndex === 5) {
        return rpcNotificationAck();
      }
      return rpcResult("6", {
        tools: [{ name: "search_repositories" }],
      });
    });

    const manager = new HttpMcpSessionManager(createManagerConfig(), {
      sleep: async (delayMs) => {
        sleepDelays.push(delayMs);
      },
    });
    const server = createServerConfig("reconnect");
    await manager.start(server);
    await manager.connect(server.id);

    const tools = await manager.listTools(server.id);
    expect(tools).toHaveLength(1);
    expect(sleepDelays).toEqual([5]);

    const initCalls = calls
      .map((call) => call.request.method)
      .filter((method) => method === "initialize");
    expect(initCalls).toHaveLength(2);
  });

  it("fails after max reconnect attempts and never retries infinitely", async () => {
    const calls: MockCall[] = [];
    const sleepDelays: number[] = [];

    globalThis.fetch = buildMockFetch(calls, ({ request }) => {
      if (request.method === "initialize") {
        return rpcResult("init", {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "fixture", version: "1.0.0" },
          capabilities: { tools: {} },
        });
      }
      if (request.method === "notifications/initialized") {
        return rpcNotificationAck();
      }
      throw new Error("ETIMEDOUT");
    });

    const manager = new HttpMcpSessionManager(createManagerConfig(), {
      sleep: async (delayMs) => {
        sleepDelays.push(delayMs);
      },
    });
    const server = createServerConfig("bounded");
    await manager.start(server);
    await manager.connect(server.id);

    await expect(manager.listTools(server.id)).rejects.toThrow(
      "MCP_HTTP_RECONNECT_EXHAUSTED",
    );
    expect(sleepDelays).toEqual([5, 10]);
    expect(calls.length).toBeLessThanOrEqual(12);
  });

  it("deduplicates reconnect attempts during concurrent reconnect storms", async () => {
    const calls: MockCall[] = [];
    let failingToolListCallsRemaining = 2;

    globalThis.fetch = buildMockFetch(calls, ({ request }) => {
      if (request.method === "initialize") {
        return rpcResult("init", {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "fixture", version: "1.0.0" },
          capabilities: { tools: {} },
        });
      }
      if (request.method === "notifications/initialized") {
        return rpcNotificationAck();
      }
      if (request.method === "tools/list") {
        if (failingToolListCallsRemaining > 0) {
          failingToolListCallsRemaining -= 1;
          throw new Error("ECONNRESET: socket hang up");
        }

        return rpcResult("tools", {
          tools: [{ name: "search_repositories" }],
        });
      }

      return rpcResult("ok", {});
    });

    const manager = new HttpMcpSessionManager(createManagerConfig(), {
      sleep: async () => {},
    });
    const server = createServerConfig("storm");
    await manager.start(server);

    const originalConnect = manager.connect.bind(manager);
    let connectCalls = 0;
    (manager as HttpMcpSessionManager & { connect: (serverId: string) => Promise<void> }).connect = async (
      serverId: string,
    ) => {
      connectCalls += 1;
      await originalConnect(serverId);
    };

    await manager.connect(server.id);

    const [firstTools, secondTools] = await Promise.all([
      manager.listTools(server.id),
      manager.listTools(server.id),
    ]);

    expect(firstTools).toHaveLength(1);
    expect(secondTools).toHaveLength(1);
    expect(connectCalls).toBe(2);

    const initializeCalls = calls.filter((call) => call.request.method === "initialize");
    expect(initializeCalls).toHaveLength(2);
  });

  it("enforces bounded call timeout for tools/call", async () => {
    const calls: MockCall[] = [];

    globalThis.fetch = buildMockFetch(calls, ({ request, signal }) => {
      if (request.method === "initialize") {
        return rpcResult("1", {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "fixture", version: "1.0.0" },
          capabilities: { tools: {} },
        });
      }

      if (request.method === "notifications/initialized") {
        return rpcNotificationAck();
      }

      if (request.method === "tools/call") {
        return new Promise<Response>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("AbortError")));
        });
      }

      return rpcResult("tools", { tools: [] });
    });

    const manager = new HttpMcpSessionManager(
      createManagerConfig({
        requestTimeoutMs: 15,
        reconnectMaxAttempts: 0,
      }),
    );
    const server = createServerConfig("timeout");
    await manager.start(server);
    await manager.connect(server.id);

    await expect(manager.callTool(server.id, "search_repositories", {})).rejects.toThrow(
      "MCP_HTTP_REQUEST_TIMEOUT",
    );
  });

  it("opens circuit breaker after repeated connect failures", async () => {
    globalThis.fetch = buildMockFetch([], () => {
      throw new Error("ECONNREFUSED");
    });

    const manager = new HttpMcpSessionManager(
      createManagerConfig({
        maxConnectAttempts: 2,
        circuitOpenMs: 80,
      }),
    );
    const server = createServerConfig("circuit");
    await manager.start(server);

    await expect(manager.connect(server.id)).rejects.toThrow("MCP_HTTP_CONNECT_FAILED");
    await expect(manager.connect(server.id)).rejects.toThrow("MCP_HTTP_CIRCUIT_OPEN");

    await new Promise((resolve) => setTimeout(resolve, 90));
    await expect(manager.connect(server.id)).rejects.toThrow("MCP_HTTP_CONNECT_FAILED");
  });
});

function buildMockFetch(
  calls: MockCall[],
  responder: (call: MockCall) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const request = JSON.parse(bodyText || "{}") as JsonRpcRequest;
    const call: MockCall = {
      url: typeof input === "string" ? input : input.toString(),
      request,
      headers: new Headers(init?.headers),
      signal: init?.signal ?? undefined,
    };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
}

function rpcResult(id: string, result: unknown): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      result,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function rpcNotificationAck(): Response {
  return new Response(null, { status: 202 });
}
