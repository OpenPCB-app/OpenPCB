import { afterEach, describe, expect, it } from "bun:test";
import {
  StdioMcpSessionManager,
  type McpSessionManagerConfig,
  type StdioMcpServerConfig,
} from "./session-manager";

function createFixtureScript(options?: {
  initializeDelayMs?: number;
  listDelayMs?: number;
  callDelayMs?: number;
}): string {
  const initializeDelayMs = options?.initializeDelayMs ?? 0;
  const listDelayMs = options?.listDelayMs ?? 0;
  const callDelayMs = options?.callDelayMs ?? 0;

  return `
const encoder = new TextEncoder();
let buffer = "";
const initDelay = ${initializeDelayMs};
const listDelay = ${listDelayMs};
const callDelay = ${callDelayMs};

function writeFrame(payload) {
  const json = JSON.stringify(payload);
  const bytes = encoder.encode(json);
  process.stdout.write("Content-Length: " + bytes.length + "\\r\\n\\r\\n" + json);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleRequest(message) {
  if (!message || typeof message !== "object") return;
  if (message.jsonrpc !== "2.0" || typeof message.id === "undefined") return;

  if (message.method === "initialize") {
    if (initDelay > 0) await sleep(initDelay);
    writeFrame({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "fixture", version: "1.0.0" },
        capabilities: { tools: { listChanged: false } },
      },
    });
    return;
  }

  if (message.method === "tools/list") {
    if (listDelay > 0) await sleep(listDelay);
    writeFrame({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "echo tool",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string" }
              },
              required: ["text"],
              additionalProperties: false,
            },
          },
        ],
      },
    });
    return;
  }

  if (message.method === "tools/call") {
    if (callDelay > 0) await sleep(callDelay);
    const text = message.params && message.params.arguments && message.params.arguments.text;
    writeFrame({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: String(text ?? "") }],
      },
    });
    return;
  }

  writeFrame({
    jsonrpc: "2.0",
    id: message.id,
    error: {
      code: -32601,
      message: "Method not found",
    },
  });
}

async function drain() {
  while (true) {
    const sep = buffer.indexOf("\\r\\n\\r\\n");
    if (sep < 0) return;

    const header = buffer.slice(0, sep);
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) {
      buffer = "";
      return;
    }
    const length = Number(match[1]);
    const bodyStart = sep + 4;
    if (buffer.length < bodyStart + length) return;

    const body = buffer.slice(bodyStart, bodyStart + length);
    buffer = buffer.slice(bodyStart + length);

    let message;
    try {
      message = JSON.parse(body);
    } catch {
      continue;
    }
    await handleRequest(message);
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  await drain();
});
`;
}

function createBrokenScript(exitCode = 1): string {
  return `setTimeout(() => process.exit(${exitCode}), 5);`;
}

function createServerConfig(alias: string, script: string): StdioMcpServerConfig {
  return {
    id: `server-${alias}`,
    alias,
    command: "bun",
    args: ["-e", script],
  };
}

function createManagerConfig(overrides?: Partial<McpSessionManagerConfig>): McpSessionManagerConfig {
  return {
    requestTimeoutMs: 150,
    connectTimeoutMs: 150,
    maxConnectAttempts: 3,
    retryBaseDelayMs: 10,
    retryMaxDelayMs: 20,
    circuitOpenMs: 40,
    ...overrides,
  };
}

describe("stdio-mcp-session-manager", () => {
  const managers: StdioMcpSessionManager[] = [];

  afterEach(async () => {
    while (managers.length > 0) {
      const manager = managers.pop();
      if (manager) {
        await manager.dispose();
      }
    }
  });

  it("supports start/connect/list/call/close lifecycle", async () => {
    const manager = new StdioMcpSessionManager(createManagerConfig());
    managers.push(manager);

    const config = createServerConfig("fixture", createFixtureScript());

    await manager.start(config);
    await manager.connect(config.id);

    const sessions = manager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.serverAlias).toBe("fixture");
    expect(sessions[0]?.state).toBe("connected");

    const tools = await manager.listTools(config.id);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("echo");

    const callResult = await manager.callTool(config.id, "echo", { text: "hello" });
    expect(callResult).toEqual({
      content: [{ type: "text", text: "hello" }],
    });

    await manager.close(config.id);
    const afterClose = manager.listSessions();
    expect(afterClose).toHaveLength(0);
  });

  it("retries failed connect with bounded exponential backoff", async () => {
    const manager = new StdioMcpSessionManager(
      createManagerConfig({
        maxConnectAttempts: 3,
        retryBaseDelayMs: 5,
        retryMaxDelayMs: 20,
      }),
    );
    managers.push(manager);

    const config = createServerConfig("failing", createBrokenScript());
    await manager.start(config);

    await expect(manager.connect(config.id)).rejects.toThrow(
      "MCP_STDIO_CONNECT_FAILED",
    );

    const status = manager.getSessionStatus(config.id);
    expect(status?.lastConnectAttempts).toBe(3);
  });

  it("opens circuit breaker after repeated connect failures", async () => {
    const manager = new StdioMcpSessionManager(
      createManagerConfig({
        maxConnectAttempts: 2,
        retryBaseDelayMs: 5,
        retryMaxDelayMs: 10,
        circuitOpenMs: 80,
      }),
    );
    managers.push(manager);

    const config = createServerConfig("circuit", createBrokenScript());
    await manager.start(config);

    await expect(manager.connect(config.id)).rejects.toThrow(
      "MCP_STDIO_CONNECT_FAILED",
    );

    await expect(manager.connect(config.id)).rejects.toThrow(
      "MCP_STDIO_CIRCUIT_OPEN",
    );

    await new Promise((resolve) => setTimeout(resolve, 90));

    await expect(manager.connect(config.id)).rejects.toThrow(
      "MCP_STDIO_CONNECT_FAILED",
    );
  });

  it("enforces bounded request timeout for list and call", async () => {
    const manager = new StdioMcpSessionManager(
      createManagerConfig({
        requestTimeoutMs: 30,
      }),
    );
    managers.push(manager);

    const config = createServerConfig(
      "slow",
      createFixtureScript({ listDelayMs: 80, callDelayMs: 80 }),
    );

    await manager.start(config);
    await manager.connect(config.id);

    await expect(manager.listTools(config.id)).rejects.toThrow(
      "MCP_STDIO_REQUEST_TIMEOUT",
    );

    await expect(manager.callTool(config.id, "echo", { text: "timeout" })).rejects.toThrow(
      "MCP_STDIO_REQUEST_TIMEOUT",
    );
  });
});
