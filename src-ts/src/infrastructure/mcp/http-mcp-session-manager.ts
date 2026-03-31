import type {
  McpSessionState,
  McpSessionSummary,
  McpToolDefinition,
} from "./session-manager";
import { MCP_HTTP_SESSION_DEFAULTS } from "./resilience-config";

export interface HttpMcpServerConfig {
  id: string;
  alias: string;
  endpoint: string;
  headers?: Record<string, string>;
}

export interface HttpMcpSessionManagerConfig {
  requestTimeoutMs: number;
  connectTimeoutMs: number;
  maxConnectAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  reconnectMaxAttempts: number;
  reconnectBackoffFactor: number;
  circuitOpenMs: number;
  protocolVersion: string;
}

interface HttpSessionEntry {
  config: HttpMcpServerConfig;
  state: McpSessionState;
  connected: boolean;
  connectFailures: number;
  lastConnectAttempts: number;
  circuitOpenUntil: number;
  lastError?: string;
  negotiatedProtocolVersion: string;
  nextRequestId: number;
  sessionId: string | null;
  reconnectInFlight: Promise<void> | null;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type Deps = {
  fetchImpl: typeof fetch;
  sleep: (delayMs: number) => Promise<void>;
};

export class HttpMcpSessionManager {
  private readonly sessions = new Map<string, HttpSessionEntry>();
  private readonly config: HttpMcpSessionManagerConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(config?: Partial<HttpMcpSessionManagerConfig>, deps?: Partial<Deps>) {
    this.config = {
      ...MCP_HTTP_SESSION_DEFAULTS,
      ...config,
    };
    this.fetchImpl = deps?.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.sleep = deps?.sleep ?? sleep;
  }

  async start(server: HttpMcpServerConfig): Promise<void> {
    this.sessions.set(server.id, {
      config: {
        ...server,
        headers: server.headers ?? {},
      },
      state: "started",
      connected: false,
      connectFailures: 0,
      lastConnectAttempts: 0,
      circuitOpenUntil: 0,
      negotiatedProtocolVersion: this.config.protocolVersion,
      nextRequestId: 0,
      sessionId: null,
      reconnectInFlight: null,
    });
  }

  async connect(serverId: string): Promise<void> {
    const entry = this.requireSession(serverId);
    if (Date.now() < entry.circuitOpenUntil) {
      throw new Error(
        `MCP_HTTP_CIRCUIT_OPEN: connect blocked for server '${entry.config.alias}' until ${new Date(entry.circuitOpenUntil).toISOString()}`,
      );
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.config.maxConnectAttempts; attempt++) {
      entry.lastConnectAttempts = attempt;
      try {
        await this.sendRequest(
          entry,
          "initialize",
          {
            protocolVersion: entry.negotiatedProtocolVersion,
            capabilities: { tools: {} },
            clientInfo: { name: "openpcb", version: "1.0.0" },
          },
          this.config.connectTimeoutMs,
        );

        await this.sendNotification(
          entry,
          "notifications/initialized",
          {},
          this.config.connectTimeoutMs,
        );

        entry.connected = true;
        entry.state = "connected";
        entry.lastError = undefined;
        entry.connectFailures = 0;
        entry.circuitOpenUntil = 0;
        return;
      } catch (error) {
        lastError = error;
        entry.connected = false;
        entry.state = "failed";
        entry.lastError = stringifyError(error);

        if (attempt < this.config.maxConnectAttempts) {
          await this.sleep(this.nextConnectDelay(attempt));
        }
      }
    }

    entry.connectFailures += 1;
    entry.circuitOpenUntil = Date.now() + this.config.circuitOpenMs;
    throw new Error(
      `MCP_HTTP_CONNECT_FAILED: failed to connect '${entry.config.alias}' after ${entry.lastConnectAttempts} attempt(s): ${stringifyError(lastError)}`,
    );
  }

  listSessions(): McpSessionSummary[] {
    return Array.from(this.sessions.values()).map((entry) => ({
      serverId: entry.config.id,
      serverAlias: entry.config.alias,
      state: entry.state,
      connected: entry.connected,
      circuitOpenUntil: entry.circuitOpenUntil,
      lastConnectAttempts: entry.lastConnectAttempts,
      lastError: entry.lastError,
    }));
  }

  getSessionStatus(serverId: string): McpSessionSummary | null {
    const entry = this.sessions.get(serverId);
    if (!entry) {
      return null;
    }

    return {
      serverId: entry.config.id,
      serverAlias: entry.config.alias,
      state: entry.state,
      connected: entry.connected,
      circuitOpenUntil: entry.circuitOpenUntil,
      lastConnectAttempts: entry.lastConnectAttempts,
      lastError: entry.lastError,
    };
  }

  async listTools(serverId: string): Promise<McpToolDefinition[]> {
    const entry = this.requireConnected(serverId);
    const result = (await this.withReconnect(entry, async () =>
      this.sendRequest(entry, "tools/list", {}, this.config.requestTimeoutMs),
    )) as { tools?: unknown };

    const tools = result.tools;
    if (!Array.isArray(tools)) {
      throw new Error(
        `MCP_HTTP_INVALID_RESPONSE: tools/list response missing tools array for '${entry.config.alias}'`,
      );
    }

    return tools
      .filter((item): item is McpToolDefinition => {
        return (
          typeof item === "object" &&
          item !== null &&
          typeof (item as { name?: unknown }).name === "string"
        );
      })
      .map((item) => ({
        name: item.name,
        description: item.description,
        inputSchema: item.inputSchema,
      }));
  }

  async callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const entry = this.requireConnected(serverId);
    return this.withReconnect(entry, async () =>
      this.sendRequest(
        entry,
        "tools/call",
        {
          name,
          arguments: args,
        },
        this.config.requestTimeoutMs,
      ),
    );
  }

  async close(serverId: string): Promise<void> {
    this.sessions.delete(serverId);
  }

  async dispose(): Promise<void> {
    this.sessions.clear();
  }

  private requireSession(serverId: string): HttpSessionEntry {
    const entry = this.sessions.get(serverId);
    if (!entry) {
      throw new Error(`MCP_HTTP_SESSION_NOT_FOUND: unknown mcp session '${serverId}'`);
    }
    return entry;
  }

  private requireConnected(serverId: string): HttpSessionEntry {
    const entry = this.requireSession(serverId);
    if (!entry.connected) {
      throw new Error(`MCP_HTTP_NOT_CONNECTED: session '${entry.config.alias}' is not connected`);
    }
    return entry;
  }

  private async withReconnect<T>(
    entry: HttpSessionEntry,
    operation: () => Promise<T>,
  ): Promise<T> {
    let reconnectAttempts = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (!isReconnectableError(error) || this.config.reconnectMaxAttempts <= 0) {
          throw error;
        }

        if (reconnectAttempts >= this.config.reconnectMaxAttempts) {
          throw new Error(
            `MCP_HTTP_RECONNECT_EXHAUSTED: reconnect attempts exhausted for '${entry.config.alias}' after ${reconnectAttempts} retries`,
          );
        }

        const delayMs = this.nextReconnectDelay(reconnectAttempts);
        reconnectAttempts += 1;

        await this.sleep(delayMs);
        await this.connectWithDedup(entry);
      }
    }
  }

  private async connectWithDedup(entry: HttpSessionEntry): Promise<void> {
    if (entry.reconnectInFlight) {
      return entry.reconnectInFlight;
    }

    const reconnectPromise = (async () => {
      entry.connected = false;
      await this.connect(entry.config.id);
    })();

    entry.reconnectInFlight = reconnectPromise;
    try {
      await reconnectPromise;
    } finally {
      if (entry.reconnectInFlight === reconnectPromise) {
        entry.reconnectInFlight = null;
      }
    }
  }

  private async sendNotification(
    entry: HttpSessionEntry,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<void> {
    await this.sendJsonRpc(entry, method, params, false, timeoutMs);
  }

  private async sendRequest(
    entry: HttpSessionEntry,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const response = await this.sendJsonRpc(entry, method, params, true, timeoutMs);

    if (!response || typeof response !== "object") {
      throw new Error(`MCP_HTTP_INVALID_RESPONSE: invalid JSON-RPC response for '${method}'`);
    }

    if (response.error) {
      throw new Error(
        `MCP_HTTP_REMOTE_ERROR: ${response.error.code} ${response.error.message}`,
      );
    }

    return response.result;
  }

  private async sendJsonRpc(
    entry: HttpSessionEntry,
    method: string,
    params: Record<string, unknown>,
    expectResponse: boolean,
    timeoutMs: number,
  ): Promise<JsonRpcResponse | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const id = expectResponse ? String(++entry.nextRequestId) : undefined;

    try {
      const headers = new Headers(entry.config.headers);
      headers.set("content-type", "application/json");
      if (entry.sessionId) {
        headers.set("mcp-session-id", entry.sessionId);
      }

      const response = await this.fetchImpl(entry.config.endpoint, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        }),
      });

      const sessionIdHeader =
        response.headers.get("mcp-session-id") ?? response.headers.get("Mcp-Session-Id");
      if (sessionIdHeader) {
        entry.sessionId = sessionIdHeader;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} on '${method}'`);
      }

      if (!expectResponse) {
        return undefined;
      }

      const raw = await response.text();
      if (!raw) {
        throw new Error(`MCP_HTTP_INVALID_RESPONSE: empty JSON-RPC response for '${method}'`);
      }

      const payload = JSON.parse(raw) as JsonRpcResponse;
      if (
        method === "initialize" &&
        payload.result &&
        typeof payload.result === "object" &&
        typeof (payload.result as { protocolVersion?: unknown }).protocolVersion === "string"
      ) {
        entry.negotiatedProtocolVersion = (payload.result as { protocolVersion: string })
          .protocolVersion;
      }

      return payload;
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(
          `MCP_HTTP_REQUEST_TIMEOUT: ${method} timed out after ${timeoutMs}ms for '${entry.config.alias}'`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private nextConnectDelay(attempt: number): number {
    const exponential = this.config.retryBaseDelayMs * Math.pow(2, attempt - 1);
    return Math.min(this.config.retryMaxDelayMs, exponential);
  }

  private nextReconnectDelay(attempt: number): number {
    const exponential =
      this.config.retryBaseDelayMs *
      Math.pow(this.config.reconnectBackoffFactor, attempt);
    return Math.min(this.config.retryMaxDelayMs, Math.floor(exponential));
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || error.message.includes("AbortError");
}

function isReconnectableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("socket hang up") ||
    msg.includes("timed out") ||
    msg.startsWith("http 5")
  );
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "unknown error");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
