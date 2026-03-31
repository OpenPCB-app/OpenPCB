import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { DatabaseAccess } from "../../db";
import { McpService } from "./mcp-service";
import { ToolRegistry } from "./tools/tool-registry";
import { StdioMcpSessionManager } from "../../infrastructure/mcp/session-manager";
import { HttpMcpSessionManager } from "../../infrastructure/mcp/http-mcp-session-manager";

type ProtoSnapshot = {
  stdio: {
    start: typeof StdioMcpSessionManager.prototype.start;
    connect: typeof StdioMcpSessionManager.prototype.connect;
    listTools: typeof StdioMcpSessionManager.prototype.listTools;
    close: typeof StdioMcpSessionManager.prototype.close;
  };
  http: {
    start: typeof HttpMcpSessionManager.prototype.start;
    connect: typeof HttpMcpSessionManager.prototype.connect;
    listTools: typeof HttpMcpSessionManager.prototype.listTools;
    close: typeof HttpMcpSessionManager.prototype.close;
  };
};

function createDbMock(): DatabaseAccess {
  const servers = [
    {
      id: "stdio-enabled",
      alias: "stdio-enabled",
      displayName: "Stdio enabled",
      transport: "stdio",
      command: "bun",
      args: ["-e", ""],
      env: null,
      url: null,
      headers: null,
      enabled: true,
    },
    {
      id: "http-enabled",
      alias: "http-enabled",
      displayName: "Http enabled",
      transport: "http",
      command: null,
      args: null,
      env: null,
      url: "https://mcp.example.com",
      headers: null,
      enabled: true,
    },
    {
      id: "disabled",
      alias: "disabled",
      displayName: "Disabled",
      transport: "stdio",
      command: "bun",
      args: ["-e", ""],
      env: null,
      url: null,
      headers: null,
      enabled: false,
    },
    {
      id: "invalid-enabled",
      alias: "invalid-enabled",
      displayName: "Invalid enabled",
      transport: "stdio",
      command: null,
      args: null,
      env: null,
      url: null,
      headers: null,
      enabled: true,
    },
  ] as const;

  const byId = new Map<string, (typeof servers)[number]>(
    servers.map((server) => [server.id, server]),
  );

  return {
    mcpServers: {
      findAll: mock(async () => [...servers]),
      findById: mock(async (id: string) => byId.get(id) ?? null),
    },
  } as unknown as DatabaseAccess;
}

describe("mcp-service resilience startup hydration", () => {
  let snapshot: ProtoSnapshot;

  beforeEach(() => {
    snapshot = {
      stdio: {
        start: StdioMcpSessionManager.prototype.start,
        connect: StdioMcpSessionManager.prototype.connect,
        listTools: StdioMcpSessionManager.prototype.listTools,
        close: StdioMcpSessionManager.prototype.close,
      },
      http: {
        start: HttpMcpSessionManager.prototype.start,
        connect: HttpMcpSessionManager.prototype.connect,
        listTools: HttpMcpSessionManager.prototype.listTools,
        close: HttpMcpSessionManager.prototype.close,
      },
    };
  });

  afterEach(() => {
    StdioMcpSessionManager.prototype.start = snapshot.stdio.start;
    StdioMcpSessionManager.prototype.connect = snapshot.stdio.connect;
    StdioMcpSessionManager.prototype.listTools = snapshot.stdio.listTools;
    StdioMcpSessionManager.prototype.close = snapshot.stdio.close;

    HttpMcpSessionManager.prototype.start = snapshot.http.start;
    HttpMcpSessionManager.prototype.connect = snapshot.http.connect;
    HttpMcpSessionManager.prototype.listTools = snapshot.http.listTools;
    HttpMcpSessionManager.prototype.close = snapshot.http.close;
  });

  it("rehydrates enabled configured MCP servers on startup and attempts reconnect", async () => {
    const stdioStart = mock(async () => {});
    const stdioConnect = mock(async () => {});
    const stdioListTools = mock(async () => []);
    const stdioClose = mock(async () => {});

    const httpStart = mock(async () => {});
    const httpConnect = mock(async () => {});
    const httpListTools = mock(async () => []);
    const httpClose = mock(async () => {});

    StdioMcpSessionManager.prototype.start = stdioStart as typeof StdioMcpSessionManager.prototype.start;
    StdioMcpSessionManager.prototype.connect = stdioConnect as typeof StdioMcpSessionManager.prototype.connect;
    StdioMcpSessionManager.prototype.listTools = stdioListTools as typeof StdioMcpSessionManager.prototype.listTools;
    StdioMcpSessionManager.prototype.close = stdioClose as typeof StdioMcpSessionManager.prototype.close;

    HttpMcpSessionManager.prototype.start = httpStart as typeof HttpMcpSessionManager.prototype.start;
    HttpMcpSessionManager.prototype.connect = httpConnect as typeof HttpMcpSessionManager.prototype.connect;
    HttpMcpSessionManager.prototype.listTools = httpListTools as typeof HttpMcpSessionManager.prototype.listTools;
    HttpMcpSessionManager.prototype.close = httpClose as typeof HttpMcpSessionManager.prototype.close;

    const service = new McpService(createDbMock(), new ToolRegistry());
    expect(service).toBeInstanceOf(McpService);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(stdioStart).toHaveBeenCalledTimes(1);
    expect(stdioConnect).toHaveBeenCalledTimes(1);
    expect(httpStart).toHaveBeenCalledTimes(1);
    expect(httpConnect).toHaveBeenCalledTimes(1);

    expect(stdioConnect).toHaveBeenCalledWith("stdio-enabled");
    expect(httpConnect).toHaveBeenCalledWith("http-enabled");
  });

  it("continues startup hydration after one reconnect failure", async () => {
    const stdioStart = mock(async () => {});
    const stdioConnect = mock(async (id: string) => {
      if (id === "stdio-enabled") {
        throw new Error("MCP_STDIO_CONNECT_FAILED");
      }
    });
    const stdioListTools = mock(async () => []);
    const stdioClose = mock(async () => {});

    const httpStart = mock(async () => {});
    const httpConnect = mock(async () => {});
    const httpListTools = mock(async () => []);
    const httpClose = mock(async () => {});

    StdioMcpSessionManager.prototype.start = stdioStart as typeof StdioMcpSessionManager.prototype.start;
    StdioMcpSessionManager.prototype.connect = stdioConnect as typeof StdioMcpSessionManager.prototype.connect;
    StdioMcpSessionManager.prototype.listTools = stdioListTools as typeof StdioMcpSessionManager.prototype.listTools;
    StdioMcpSessionManager.prototype.close = stdioClose as typeof StdioMcpSessionManager.prototype.close;

    HttpMcpSessionManager.prototype.start = httpStart as typeof HttpMcpSessionManager.prototype.start;
    HttpMcpSessionManager.prototype.connect = httpConnect as typeof HttpMcpSessionManager.prototype.connect;
    HttpMcpSessionManager.prototype.listTools = httpListTools as typeof HttpMcpSessionManager.prototype.listTools;
    HttpMcpSessionManager.prototype.close = httpClose as typeof HttpMcpSessionManager.prototype.close;

    const service = new McpService(createDbMock(), new ToolRegistry());
    expect(service).toBeInstanceOf(McpService);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(stdioStart).toHaveBeenCalledTimes(1);
    expect(stdioConnect).toHaveBeenCalledTimes(1);
    expect(httpStart).toHaveBeenCalledTimes(1);
    expect(httpConnect).toHaveBeenCalledTimes(1);
  });
});
