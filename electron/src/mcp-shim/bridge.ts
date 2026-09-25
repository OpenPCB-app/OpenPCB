/**
 * The stdio half of the bridge: the MCP server Claude Code (or any stdio
 * client) actually talks to.
 *
 * It is a 2025-era server toward the client, and deliberately more than a
 * pipe, because the old pipe failed in every way that matters on a desktop:
 *
 * - **It works while OpenPCB is closed.** `initialize`, `ping` and the list
 *   methods are answered here, so the client registers the server instead of
 *   marking it failed. Tool calls then return a readable "start OpenPCB"
 *   result instead of hanging.
 * - **It survives app restarts.** Every forwarded request is a stateless POST;
 *   on a connection failure or a 401 the portfile is re-read and the request
 *   retried once against the new port and token (`upstream.ts`).
 * - **It keeps the client's tool list current.** The backend cannot push to a
 *   stateless 2025-era client, so the bridge polls the backend's state probe
 *   and emits `notifications/*\/list_changed` when OpenPCB starts, stops, or
 *   the user toggles MCP / writes.
 * - **Cancellation works.** `notifications/cancelled` aborts the in-flight
 *   HTTP request, which aborts the tool's signal on the server.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, type DiscoveryEnv } from "./portfile";
import { Upstream, UpstreamError, type JsonRpcMessage, type McpState } from "./upstream";

export const BRIDGE_VERSION = "2";

/** 2025-era protocol revisions this bridge will negotiate, newest first. */
export const LEGACY_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

const OFFLINE_INSTRUCTIONS =
  "OpenPCB is not running right now, so its design tools are unavailable. Ask the user to start the OpenPCB desktop app (and enable Settings → Assistant → MCP); the tool list refreshes automatically once it is up.";

const TOOLS_CACHE_FILE = "mcp-tools-cache.json";

export interface BridgeOptions {
  discovery: DiscoveryEnv;
  /** Sends a message to the client (stdout). */
  send: (message: JsonRpcMessage) => void;
  /** Stable per-process id; keys the design pin on the server. */
  instanceId: string;
  /** Overrides the client key derived from `clientInfo.name`. */
  clientKeyOverride?: string;
  pollMs?: number;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "mcp-client"
  );
}

function errorResponse(
  id: JsonRpcMessage["id"],
  code: number,
  message: string,
): JsonRpcMessage {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export class McpBridge {
  readonly upstream: Upstream;
  private clientName = "MCP client";
  private clientKey: string;
  private protocolVersion: string | null = null;
  private initialized = false;
  private readonly inFlight = new Map<string, AbortController>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeen: { up: boolean; state: string | null; epoch: number } = {
    up: false,
    state: null,
    epoch: 0,
  };
  private toolsCache: unknown | null = null;
  private closed = false;

  constructor(private readonly options: BridgeOptions) {
    this.clientKey = options.clientKeyOverride ?? "mcp-client";
    this.upstream = new Upstream({
      discovery: options.discovery,
      fetchImpl: options.fetchImpl,
      log: options.log,
      headers: () => ({
        "x-openpcb-mcp-client": this.clientKey,
        "x-openpcb-mcp-client-name": this.clientName,
        "x-openpcb-mcp-instance": this.options.instanceId,
        ...(this.protocolVersion
          ? { "mcp-protocol-version": this.protocolVersion }
          : {}),
      }),
    });
    this.toolsCache = this.readToolsCache();
  }

  // ─── lifecycle ──────────────────────────────────────────────────────

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.options.pollMs ?? 3_000);
    // Never keep the process alive just for polling; stdin does that.
    (this.pollTimer as { unref?: () => void }).unref?.();
  }

  close(): void {
    this.closed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
  }

  /**
   * One polling tick: tell the client to re-list when OpenPCB came up or went
   * down, when the endpoint changed (a restart: new port, token or pid —
   * even one the poll did not see happen), or when the backend's state
   * fingerprint changed: enabled / writes, the hash of the full tool
   * contracts, the app version, or the boot generation. A restart into an
   * update that keeps every tool name but changes a schema is caught by all
   * three of the last.
   */
  async poll(): Promise<void> {
    if (this.closed) return;
    this.upstream.refresh();
    const up = this.upstream.portfile !== null;
    const epoch = this.upstream.epoch;
    let state: McpState | null = null;
    if (up) state = await this.upstream.state();
    const fingerprint = state
      ? [state.enabled, state.allowWrites, state.toolset, state.appVersion, state.generation ?? ""].join(":")
      : null;
    const changed =
      up !== this.lastSeen.up ||
      epoch !== this.lastSeen.epoch ||
      (fingerprint !== null && fingerprint !== this.lastSeen.state);
    this.lastSeen = { up, epoch, state: fingerprint ?? (up ? this.lastSeen.state : null) };
    if (changed && this.initialized) this.notifyListsChanged();
  }

  private notifyListsChanged(): void {
    for (const method of [
      "notifications/tools/list_changed",
      "notifications/prompts/list_changed",
      "notifications/resources/list_changed",
    ]) {
      this.options.send({ jsonrpc: "2.0", method });
    }
  }

  // ─── client → bridge ────────────────────────────────────────────────

  async handleClientMessage(message: JsonRpcMessage): Promise<void> {
    if (message.method === undefined) return; // a response: we never ask the client anything
    if (message.id === undefined || message.id === null) {
      this.handleNotification(message);
      return;
    }
    const response = await this.handleRequest(message);
    if (response) this.options.send(response);
  }

  private handleNotification(message: JsonRpcMessage): void {
    switch (message.method) {
      case "notifications/initialized":
        this.initialized = true;
        return;
      case "notifications/cancelled": {
        const requestId = message.params?.requestId;
        if (requestId !== undefined) {
          this.inFlight.get(String(requestId))?.abort();
        }
        return;
      }
      default:
        // roots/list_changed and friends: nothing on a stateless upstream
        // could act on them.
        return;
    }
  }

  private async handleRequest(message: JsonRpcMessage): Promise<JsonRpcMessage | null> {
    switch (message.method) {
      case "initialize":
        return this.initialize(message);
      case "ping":
        return { jsonrpc: "2.0", id: message.id, result: {} };
      case "server/discover":
        // We are a 2025-era server: "method not found" is the definitive
        // signal that makes a 2026-era client fall back to `initialize`.
        return errorResponse(message.id, -32601, "Method not found: server/discover");
      default:
        return this.forward(message);
    }
  }

  private async initialize(message: JsonRpcMessage): Promise<JsonRpcMessage> {
    const params = (message.params ?? {}) as {
      protocolVersion?: string;
      clientInfo?: { name?: string };
    };
    if (params.clientInfo?.name) {
      this.clientName = params.clientInfo.name;
      if (!this.options.clientKeyOverride) this.clientKey = slug(params.clientInfo.name);
    }
    const requested = params.protocolVersion ?? "";
    this.protocolVersion = LEGACY_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : LEGACY_PROTOCOL_VERSIONS[0]!;

    // Prefer the app's own answer (instructions, server version); fall back
    // to a local one so the client registers the server either way.
    try {
      const upstream = await this.upstream.post(message);
      const result = upstream?.result as
        | { protocolVersion?: string; capabilities?: Record<string, unknown> }
        | undefined;
      if (result) {
        if (result.protocolVersion) this.protocolVersion = result.protocolVersion;
        this.lastSeen = { ...this.lastSeen, up: true, epoch: this.upstream.epoch };
        return {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            ...result,
            capabilities: {
              ...(result.capabilities ?? {}),
              tools: { listChanged: true },
              prompts: { listChanged: true },
              resources: { listChanged: true },
            },
          },
        };
      }
    } catch (error) {
      this.options.log?.(
        `initialize answered locally: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.lastSeen = { up: false, state: null, epoch: this.upstream.epoch };
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: this.protocolVersion,
        capabilities: {
          tools: { listChanged: true },
          prompts: { listChanged: true },
          resources: { listChanged: true },
        },
        serverInfo: { name: "openpcb", version: `bridge-${BRIDGE_VERSION}` },
        instructions: OFFLINE_INSTRUCTIONS,
      },
    };
  }

  private async forward(message: JsonRpcMessage): Promise<JsonRpcMessage> {
    const key = String(message.id);
    const controller = new AbortController();
    this.inFlight.set(key, controller);
    try {
      const response = await this.upstream.post(message, {
        signal: controller.signal,
        onNotification: (notification) => this.options.send(notification),
      });
      if (!response) {
        return errorResponse(message.id, -32603, "OpenPCB returned no response.");
      }
      if (message.method === "tools/list" && response.result) {
        this.writeToolsCache(response.result);
      }
      return { ...response, id: message.id };
    } catch (error) {
      return this.fallback(message, error);
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** What to answer when the app cannot. */
  private fallback(message: JsonRpcMessage, error: unknown): JsonRpcMessage {
    const text =
      error instanceof UpstreamError
        ? error.message
        : `OpenPCB bridge error: ${error instanceof Error ? error.message : String(error)}`;
    if (error instanceof UpstreamError && error.kind === "cancelled") {
      return errorResponse(message.id, -32800, "Request cancelled.");
    }
    switch (message.method) {
      case "tools/call":
        // A tool result, not a protocol error: the model reads it and can
        // tell the user what to do.
        return {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text }],
            structuredContent: {
              ok: false,
              status: "error",
              summary: text,
              warnings: [],
              error: { message: text },
              truncated: false,
              data: null,
            },
            isError: true,
          },
        };
      case "tools/list":
        // Keep the last known tools visible so the model knows what OpenPCB
        // offers; calling them explains that the app must be started.
        return {
          jsonrpc: "2.0",
          id: message.id,
          result: this.toolsCache ?? { tools: [] },
        };
      case "prompts/list":
        return { jsonrpc: "2.0", id: message.id, result: { prompts: [] } };
      case "resources/list":
        return { jsonrpc: "2.0", id: message.id, result: { resources: [] } };
      case "resources/templates/list":
        return { jsonrpc: "2.0", id: message.id, result: { resourceTemplates: [] } };
      default:
        return errorResponse(message.id, -32000, text);
    }
  }

  // ─── tools cache ────────────────────────────────────────────────────

  private cachePath(): string | null {
    const dir = cacheDir(this.options.discovery, this.upstream.portfilePath);
    return dir ? join(dir, TOOLS_CACHE_FILE) : null;
  }

  private readToolsCache(): unknown | null {
    const path = this.cachePath();
    if (!path || !existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { tools?: unknown };
      return Array.isArray(parsed.tools) ? parsed : null;
    } catch {
      return null;
    }
  }

  private writeToolsCache(result: unknown): void {
    this.toolsCache = result;
    const path = this.cachePath();
    if (!path) return;
    try {
      mkdirSync(join(path, ".."), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(result), { encoding: "utf8", mode: 0o600 });
      renameSync(tmp, path);
    } catch (error) {
      this.options.log?.(`could not write tools cache: ${String(error)}`);
    }
  }
}
