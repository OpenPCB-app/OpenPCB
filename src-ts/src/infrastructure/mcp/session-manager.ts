import type { JSONSchema7 } from "json-schema";
import { MCP_STDIO_SESSION_DEFAULTS } from "./resilience-config";

export type McpSessionState = "started" | "connected" | "failed";

export interface StdioMcpServerConfig {
  id: string;
  alias: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpSessionManagerConfig {
  requestTimeoutMs: number;
  connectTimeoutMs: number;
  maxConnectAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  circuitOpenMs: number;
}

export interface McpSessionSummary {
  serverId: string;
  serverAlias: string;
  state: McpSessionState;
  connected: boolean;
  circuitOpenUntil: number;
  lastConnectAttempts: number;
  lastError?: string;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: JSONSchema7;
}

interface McpJsonRpcSuccess {
  jsonrpc: "2.0";
  id: number;
  result: unknown;
}

interface McpJsonRpcError {
  jsonrpc: "2.0";
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type McpJsonRpcResponse = McpJsonRpcSuccess | McpJsonRpcError;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface WritableStdin {
  write(data: string | Uint8Array): unknown;
}

interface SessionEntry {
  config: StdioMcpServerConfig;
  process: Bun.Subprocess | null;
  state: McpSessionState;
  connected: boolean;
  pending: Map<number, PendingRequest>;
  nextRequestId: number;
  stdoutBuffer: string;
  circuitOpenUntil: number;
  connectFailures: number;
  lastConnectAttempts: number;
  lastError?: string;
}

export class McpSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "McpSessionError";
    this.code = code;
  }
}

export class StdioMcpSessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly config: McpSessionManagerConfig;
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  constructor(config?: Partial<McpSessionManagerConfig>) {
    this.config = {
      ...MCP_STDIO_SESSION_DEFAULTS,
      ...config,
    };
  }

  async start(server: StdioMcpServerConfig): Promise<void> {
    const existing = this.sessions.get(server.id);
    if (existing) {
      await this.disposeSession(existing);
    }

    const entry: SessionEntry = {
      config: {
        ...server,
        args: server.args ?? [],
      },
      process: null,
      state: "started",
      connected: false,
      pending: new Map(),
      nextRequestId: 1,
      stdoutBuffer: "",
      circuitOpenUntil: 0,
      connectFailures: 0,
      lastConnectAttempts: 0,
    };

    this.sessions.set(server.id, entry);
    await this.spawnProcess(entry);
  }

  async connect(serverId: string): Promise<void> {
    const entry = this.requireSession(serverId);
    if (Date.now() < entry.circuitOpenUntil) {
      throw new McpSessionError(
        "MCP_STDIO_CIRCUIT_OPEN",
        `connect blocked for server '${entry.config.alias}' until ${new Date(entry.circuitOpenUntil).toISOString()}`,
      );
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= this.config.maxConnectAttempts; attempt++) {
      entry.lastConnectAttempts = attempt;
      try {
        if (!entry.process) {
          await this.spawnProcess(entry);
        }

        await this.request(
          entry,
          "initialize",
          {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
              name: "openpcb",
              version: "1.0.0",
            },
          },
          this.config.connectTimeoutMs,
        );

        await this.notify(entry, "notifications/initialized", {});

        entry.connected = true;
        entry.state = "connected";
        entry.connectFailures = 0;
        entry.lastError = undefined;
        entry.circuitOpenUntil = 0;
        return;
      } catch (error) {
        lastError = error;
        entry.connected = false;
        entry.state = "failed";
        entry.lastError = stringifyError(error);
        await this.disposeProcess(entry);

        if (attempt < this.config.maxConnectAttempts) {
          await sleep(this.nextRetryDelay(attempt));
        }
      }
    }

    entry.connectFailures += 1;
    entry.circuitOpenUntil = Date.now() + this.config.circuitOpenMs;
    throw new McpSessionError(
      "MCP_STDIO_CONNECT_FAILED",
      `failed to connect '${entry.config.alias}' after ${entry.lastConnectAttempts} attempt(s): ${stringifyError(lastError)}`,
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
    const result = await this.request(entry, "tools/list", {}, this.config.requestTimeoutMs);
    const tools = (result as { tools?: unknown }).tools;
    if (!Array.isArray(tools)) {
      throw new McpSessionError(
        "MCP_STDIO_INVALID_RESPONSE",
        `tools/list response missing tools array for '${entry.config.alias}'`,
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
    return this.request(
      entry,
      "tools/call",
      {
        name,
        arguments: args,
      },
      this.config.requestTimeoutMs,
    );
  }

  async close(serverId: string): Promise<void> {
    const entry = this.sessions.get(serverId);
    if (!entry) {
      return;
    }
    await this.disposeSession(entry);
    this.sessions.delete(serverId);
  }

  async dispose(): Promise<void> {
    const entries = Array.from(this.sessions.values());
    for (const entry of entries) {
      await this.disposeSession(entry);
    }
    this.sessions.clear();
  }

  private requireSession(serverId: string): SessionEntry {
    const entry = this.sessions.get(serverId);
    if (!entry) {
      throw new McpSessionError(
        "MCP_STDIO_SESSION_NOT_FOUND",
        `unknown mcp session '${serverId}'`,
      );
    }
    return entry;
  }

  private requireConnected(serverId: string): SessionEntry {
    const entry = this.requireSession(serverId);
    if (!entry.connected || !entry.process) {
      throw new McpSessionError(
        "MCP_STDIO_NOT_CONNECTED",
        `session '${entry.config.alias}' is not connected`,
      );
    }
    return entry;
  }

  private async spawnProcess(entry: SessionEntry): Promise<void> {
    entry.stdoutBuffer = "";
    entry.pending.clear();

    const spawnOptions = {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...processEnv(),
        ...(entry.config.env ?? {}),
      },
    } as unknown as Bun.SpawnOptions;

    const process = Bun.spawn(
      [entry.config.command, ...(entry.config.args ?? [])],
      spawnOptions,
    );

    entry.process = process;
    entry.state = "started";
    entry.connected = false;

    void this.consumeStdout(entry, process);
    void this.consumeStderr(entry, process);

    process.exited.then((exitCode) => {
      if (entry.process !== process) {
        return;
      }
      entry.process = null;
      if (entry.connected) {
        entry.connected = false;
        entry.state = "failed";
        entry.lastError = `process exited with code ${exitCode}`;
      }
      this.failPending(entry, new McpSessionError("MCP_STDIO_PROCESS_EXITED", `process exited with code ${exitCode}`));
    });
  }

  private async consumeStdout(
    entry: SessionEntry,
    process: Bun.Subprocess,
  ): Promise<void> {
    const stdout = process.stdout;
    if (!stdout || typeof stdout === "number") {
      return;
    }

    const reader = stdout.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        if (!value) {
          continue;
        }
        entry.stdoutBuffer += this.textDecoder.decode(value, { stream: true });
        this.drainFrames(entry);
      }
    } catch {
      this.failPending(
        entry,
        new McpSessionError("MCP_STDIO_READ_FAILED", "failed reading stdout"),
      );
    }
  }

  private async consumeStderr(
    _entry: SessionEntry,
    process: Bun.Subprocess,
  ): Promise<void> {
    const stderr = process.stderr;
    if (!stderr || typeof stderr === "number") {
      return;
    }
    const reader = stderr.getReader();
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) {
          break;
        }
      }
    } catch {
      return;
    }
  }

  private drainFrames(entry: SessionEntry): void {
    while (true) {
      const headerEnd = entry.stdoutBuffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }

      const header = entry.stdoutBuffer.slice(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        entry.stdoutBuffer = "";
        return;
      }

      const length = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (entry.stdoutBuffer.length < bodyEnd) {
        return;
      }

      const body = entry.stdoutBuffer.slice(bodyStart, bodyEnd);
      entry.stdoutBuffer = entry.stdoutBuffer.slice(bodyEnd);

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        continue;
      }
      this.handleResponse(entry, parsed);
    }
  }

  private handleResponse(entry: SessionEntry, parsed: unknown): void {
    if (typeof parsed !== "object" || parsed === null) {
      return;
    }

    const response = parsed as Partial<McpJsonRpcResponse> & { id?: unknown };
    if (typeof response.id !== "number") {
      return;
    }

    const pending = entry.pending.get(response.id);
    if (!pending) {
      return;
    }

    entry.pending.delete(response.id);
    clearTimeout(pending.timeout);

    if ("error" in response && response.error) {
      const error = response.error;
      pending.reject(
        new McpSessionError(
          "MCP_STDIO_REMOTE_ERROR",
          `${error.code ?? "unknown"}: ${error.message ?? "request failed"}`,
        ),
      );
      return;
    }

    pending.resolve((response as { result?: unknown }).result);
  }

  private async request(
    entry: SessionEntry,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    if (!entry.process || !isWritableStdin(entry.process.stdin)) {
      throw new McpSessionError(
        "MCP_STDIO_PROCESS_NOT_RUNNING",
        `stdio process is not running for '${entry.config.alias}'`,
      );
    }

    const id = entry.nextRequestId++;
    const frame = {
      jsonrpc: "2.0" as const,
      id,
      method,
      params,
    };

    const resultPromise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        entry.pending.delete(id);
        reject(
          new McpSessionError(
            "MCP_STDIO_REQUEST_TIMEOUT",
            `${method} timed out after ${timeoutMs}ms for '${entry.config.alias}'`,
          ),
        );
      }, timeoutMs);

      entry.pending.set(id, {
        resolve,
        reject,
        timeout,
      });
    });

    const stdin = entry.process.stdin;
    this.writeFrame(stdin, frame);
    return resultPromise;
  }

  private async notify(
    entry: SessionEntry,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    if (!entry.process || !isWritableStdin(entry.process.stdin)) {
      throw new McpSessionError(
        "MCP_STDIO_PROCESS_NOT_RUNNING",
        `stdio process is not running for '${entry.config.alias}'`,
      );
    }

    const stdin = entry.process.stdin;
    this.writeFrame(stdin, {
      jsonrpc: "2.0",
      method,
      params,
    });
  }

  private writeFrame(stdin: WritableStdin, payload: unknown): void {
    const json = JSON.stringify(payload);
    const byteLength = this.textEncoder.encode(json).length;
    const framed = `Content-Length: ${byteLength}\r\n\r\n${json}`;

    stdin.write(framed);
  }

  private failPending(entry: SessionEntry, error: Error): void {
    for (const [id, pending] of entry.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      entry.pending.delete(id);
    }
  }

  private nextRetryDelay(attempt: number): number {
    const exponential = this.config.retryBaseDelayMs * Math.pow(2, attempt - 1);
    return Math.min(this.config.retryMaxDelayMs, exponential);
  }

  private async disposeSession(entry: SessionEntry): Promise<void> {
    await this.disposeProcess(entry);
    entry.connected = false;
  }

  private async disposeProcess(entry: SessionEntry): Promise<void> {
    if (!entry.process) {
      return;
    }

    const active = entry.process;
    entry.process = null;
    this.failPending(
      entry,
      new McpSessionError("MCP_STDIO_PROCESS_CLOSED", `session '${entry.config.alias}' closed`),
    );

    try {
      active.kill();
    } catch {
      return;
    }

    try {
      await active.exited;
    } catch {
      return;
    }
  }
}

function processEnv(): Record<string, string | undefined> {
  if (typeof process !== "undefined" && process.env) {
    return process.env;
  }
  return {};
}

function isWritableStdin(value: unknown): value is WritableStdin {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { write?: unknown }).write === "function"
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
