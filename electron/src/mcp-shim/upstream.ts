/**
 * The HTTP half of the bridge: forwards one JSON-RPC message to the OpenPCB
 * backend's Streamable HTTP endpoint and turns every failure into a typed
 * error with a message the model can act on.
 *
 * The backend serves 2025-era clients statelessly (a fresh server per POST),
 * so there is no session to open or resume — each forwarded message is one
 * self-contained POST. That is what makes an app restart survivable: the next
 * POST just goes to the new port with the new token.
 */

import {
  discoverPortfile,
  type DiscoveryEnv,
  type DiscoveryResult,
  type Portfile,
} from "./portfile";

export type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type UpstreamErrorKind =
  | "not-running"
  | "incompatible"
  | "disabled"
  | "unauthorized"
  | "not-available"
  | "cancelled"
  | "protocol";

export class UpstreamError extends Error {
  constructor(
    readonly kind: UpstreamErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface McpState {
  enabled: boolean;
  allowWrites: boolean;
  toolset: string;
  appVersion: string;
}

export interface UpstreamOptions {
  discovery: DiscoveryEnv;
  /** Identity + protocol headers for every POST. */
  headers: () => Record<string, string>;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

function stateUrl(mcpUrl: string): string {
  return mcpUrl.replace(/\/mcp\/?$/, "/mcp-state");
}

async function errorMessageOf(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string } | string;
      };
      if (typeof parsed.error === "string") return parsed.error;
      if (parsed.error?.message) return parsed.error.message;
    } catch {
      // not JSON
    }
    return text.trim().slice(0, 300) || null;
  } catch {
    return null;
  }
}

function sameEndpoint(a: Portfile | null, b: Portfile | null): boolean {
  return Boolean(a && b && a.url === b.url && a.token === b.token && a.pid === b.pid);
}

export class Upstream {
  private current: Portfile | null = null;
  private currentPath: string | null = null;
  private lastDiscovery: DiscoveryResult | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: UpstreamOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get portfile(): Portfile | null {
    return this.current;
  }

  get portfilePath(): string | null {
    return this.currentPath;
  }

  /** Re-read the portfile. Returns whether the endpoint changed. */
  refresh(): boolean {
    const result = discoverPortfile(this.options.discovery);
    this.lastDiscovery = result;
    const next = result.ok ? result.portfile : null;
    const changed = !sameEndpoint(this.current, next) && !(this.current === null && next === null);
    this.current = next;
    this.currentPath = result.ok ? result.path : null;
    return changed;
  }

  private unavailable(): UpstreamError {
    const discovery = this.lastDiscovery;
    if (discovery && !discovery.ok) {
      return new UpstreamError(discovery.reason, discovery.message);
    }
    return new UpstreamError(
      "not-running",
      "OpenPCB is not running. Ask the user to start the OpenPCB app, then retry.",
    );
  }

  private headersFor(portfile: Portfile): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.options.headers(),
      authorization: `Bearer ${portfile.token}`,
    };
  }

  /**
   * POST one message. Resolves with the JSON-RPC response for a request, or
   * null for a notification (202). Notifications the server streams before
   * the response (progress) are handed to `onNotification` as they arrive.
   */
  async post(
    message: JsonRpcMessage,
    options: {
      signal?: AbortSignal;
      onNotification?: (notification: JsonRpcMessage) => void;
    } = {},
  ): Promise<JsonRpcMessage | null> {
    if (!this.current) this.refresh();
    if (!this.current) throw this.unavailable();

    let retried = false;
    for (;;) {
      const portfile: Portfile = this.current;
      let response: Response;
      try {
        response = await this.fetchImpl(portfile.url, {
          method: "POST",
          headers: this.headersFor(portfile),
          body: JSON.stringify(message),
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) {
          throw new UpstreamError("cancelled", "Request cancelled.");
        }
        // The app quit or restarted on a new port: look again, retry once.
        const changed = this.refresh();
        if (!retried && changed && this.current) {
          retried = true;
          continue;
        }
        this.options.log?.(`upstream unreachable: ${String(error)}`);
        throw this.unavailable();
      }

      if (response.status === 401) {
        // A new launch rotates the token; the portfile has the new one.
        const changed = this.refresh();
        if (!retried && changed && this.current) {
          retried = true;
          continue;
        }
        throw new UpstreamError(
          "unauthorized",
          (await errorMessageOf(response)) ??
            "OpenPCB rejected the MCP token. Restart the bridge (/mcp → reconnect).",
        );
      }
      if (response.status === 503) {
        throw new UpstreamError(
          "disabled",
          (await errorMessageOf(response)) ??
            "OpenPCB's MCP server is disabled. Ask the user to enable it in OpenPCB Settings → Assistant → MCP.",
        );
      }
      if (response.status === 404) {
        throw new UpstreamError(
          "not-available",
          "This OpenPCB build does not serve MCP. Ask the user to update OpenPCB.",
        );
      }
      if (response.status === 202) return null;
      if (!response.ok) {
        throw new UpstreamError(
          "protocol",
          `OpenPCB answered HTTP ${response.status}: ${(await errorMessageOf(response)) ?? "no body"}`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream")) {
        return this.readSse(response, message.id ?? null, options.onNotification);
      }
      const text = await response.text();
      if (!text.trim()) return null;
      return JSON.parse(text) as JsonRpcMessage;
    }
  }

  private async readSse(
    response: Response,
    requestId: JsonRpcMessage["id"],
    onNotification?: (notification: JsonRpcMessage) => void,
  ): Promise<JsonRpcMessage | null> {
    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let buffer = "";
    let final: JsonRpcMessage | null = null;
    const handleEvent = (block: string) => {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) return;
      let parsed: JsonRpcMessage;
      try {
        parsed = JSON.parse(data) as JsonRpcMessage;
      } catch {
        return;
      }
      if ("result" in parsed || "error" in parsed) {
        if (requestId === null || parsed.id === requestId) final = parsed;
        return;
      }
      if (parsed.method && parsed.id === undefined) {
        onNotification?.(parsed);
      }
      // Server→client requests (sampling, elicitation) cannot be answered on
      // a stateless endpoint; OpenPCB never sends them.
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let split = buffer.indexOf("\n\n");
        while (split !== -1) {
          handleEvent(buffer.slice(0, split));
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf("\n\n");
        }
      }
      if (done) break;
      if (final) {
        void reader.cancel().catch(() => undefined);
        break;
      }
    }
    if (!final && buffer.trim()) handleEvent(buffer);
    return final;
  }

  /**
   * Poll the backend's state probe. Returns null when the app is unreachable
   * or predates the probe (404) — callers then fall back to up/down tracking.
   */
  async state(): Promise<McpState | null> {
    if (!this.current) this.refresh();
    const portfile = this.current;
    if (!portfile) return null;
    try {
      const response = await this.fetchImpl(stateUrl(portfile.url), {
        headers: { authorization: `Bearer ${portfile.token}` },
      });
      if (!response.ok) return null;
      return (await response.json()) as McpState;
    } catch {
      return null;
    }
  }
}
