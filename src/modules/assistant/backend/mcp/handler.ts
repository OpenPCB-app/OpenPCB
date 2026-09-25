import {
  createMcpHandler,
  localhostAllowedOrigins,
  originValidationResponse,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import type { AiToolRegistry } from "@openpcb/ai-core";
import type { ContextResolver } from "../context-resolver";
import type { ConversationStore } from "../conversation-store";
import type { AssistantSettings } from "../../../../sdks/assistant";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { checkMcpAuth } from "./auth";
import { buildMcpServer } from "./server";
import type { McpCallRecorder } from "./call-recorder";
import {
  normalizeClientKey,
  type McpClientIdentity,
  type McpConnectionRegistry,
} from "./connections";

/**
 * HTTP face of the MCP server.
 *
 * The endpoint is Streamable HTTP served straight out of the module router:
 * OpenPCB routes only ever see a Web `Request` and must return a `Response`
 * (`core/contracts/modules/backend-module.ts`), which is exactly the shape
 * `createMcpHandler` produces. No Node req/res adapter is involved.
 *
 * `createMcpHandler` serves 2025-era clients statelessly (a fresh server per
 * POST, GET/DELETE answer 405) and 2026-era clients per request. Nothing about
 * a client survives between requests inside the SDK, so identity travels in
 * headers and is handed to the server factory as `authInfo`.
 */

export const MCP_CLIENT_HEADER = "x-openpcb-mcp-client";
export const MCP_CLIENT_NAME_HEADER = "x-openpcb-mcp-client-name";
export const MCP_INSTANCE_HEADER = "x-openpcb-mcp-instance";

/**
 * Client identity. `clientKey` must be derived the same way on every request
 * of a conversation, so it comes only from headers: the bundled shim sets
 * `X-OpenPCB-MCP-Client` explicitly (from the client's announced name), and
 * direct HTTP clients fall back to their User-Agent. The display name comes
 * from the shim's name header, else the `initialize` clientInfo, else the key.
 */
export function identityFor(req: Request, parsedBody: unknown): McpClientIdentity {
  const explicit = req.headers.get(MCP_CLIENT_HEADER)?.trim();
  const ua = req.headers.get("user-agent")?.trim();
  const clientKey = normalizeClientKey(explicit || ua || "unknown-client");
  const clientName =
    req.headers.get(MCP_CLIENT_NAME_HEADER)?.trim() ||
    announcedClientName(parsedBody) ||
    explicit ||
    clientKey;
  const instanceId = req.headers.get(MCP_INSTANCE_HEADER)?.trim() || clientKey;
  return { clientKey, clientName, instanceId };
}

/** The name the client announced at `initialize`, if this request is one. */
function announcedClientName(parsedBody: unknown): string | null {
  if (typeof parsedBody !== "object" || parsedBody === null) return null;
  const body = parsedBody as { method?: unknown; params?: unknown };
  if (body.method !== "initialize") return null;
  const params = body.params as { clientInfo?: { name?: unknown } } | undefined;
  const name = params?.clientInfo?.name;
  return typeof name === "string" && name.trim().length > 0
    ? name.trim()
    : null;
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }),
    {
      status,
      headers: {
        "content-type": "application/json",
        ...(status === 401
          ? { "www-authenticate": 'Bearer realm="OpenPCB MCP"' }
          : {}),
      },
    },
  );
}

export interface McpEndpointDeps {
  ctx: CoreBackendModuleContext;
  appVersion: string;
  contextResolver: ContextResolver;
  conversation: ConversationStore;
  connections: McpConnectionRegistry;
  recorder: McpCallRecorder;
  getSettings(): AssistantSettings;
  /**
   * Tool registry for this endpoint. `allowWrites` selects whether write tools
   * are present at all; the caller caches it so Ajv does not recompile every
   * schema on each request.
   */
  getRegistry(allowWrites: boolean): AiToolRegistry;
  pendingProposalHint: (chatTitle: string) => string;
}

export class McpEndpoint {
  private handler: McpHttpHandler | null = null;

  constructor(private readonly deps: McpEndpointDeps) {}

  private ensureHandler(): McpHttpHandler {
    if (this.handler) return this.handler;
    this.handler = createMcpHandler((ctx) => {
      const extra = ctx.authInfo?.extra as
        | { identity?: McpClientIdentity }
        | undefined;
      const identity = extra?.identity ?? {
        clientKey: "unknown-client",
        clientName: "unknown-client",
        instanceId: "unknown-client",
      };
      const settings = this.deps.getSettings();
      return buildMcpServer(identity, {
        ctx: this.deps.ctx,
        appVersion: this.deps.appVersion,
        registry: this.deps.getRegistry(settings.mcpAllowWrites),
        connections: this.deps.connections,
        recorder: this.deps.recorder,
        contextResolver: this.deps.contextResolver,
        conversation: this.deps.conversation,
        allowWrites: settings.mcpAllowWrites,
        pendingProposalHint: this.deps.pendingProposalHint,
      });
    });
    return this.handler;
  }

  async fetch(req: Request): Promise<Response> {
    // Settings gate first: a disabled server should look disabled, not
    // unauthorised, so the shim can tell the user what to switch on.
    if (!this.deps.getSettings().mcpEnabled) {
      return jsonRpcError(
        503,
        -32000,
        "OpenPCB's MCP server is disabled. Enable it in OpenPCB Settings → Assistant → MCP.",
      );
    }

    // DNS-rebinding guard. A request with no Origin passes (non-browser MCP
    // clients send none); a present Origin must be loopback.
    const rejected = originValidationResponse(req, localhostAllowedOrigins());
    if (rejected) return rejected;

    const authFailure = checkMcpAuth(req);
    if (authFailure) {
      return jsonRpcError(
        authFailure.code === "unauthorized" ? 401 : 500,
        -32001,
        authFailure.message,
      );
    }

    // Read the body here so the announced client name is available before the
    // server factory runs, then hand the parsed value to the SDK — the stream
    // can only be consumed once.
    let parsedBody: unknown;
    if (req.method === "POST") {
      try {
        parsedBody = await req.json();
      } catch {
        return jsonRpcError(400, -32700, "Request body is not valid JSON.");
      }
    }

    const identity = identityFor(req, parsedBody);
    return this.ensureHandler().fetch(req, {
      ...(parsedBody === undefined ? {} : { parsedBody }),
      authInfo: {
        token: "",
        clientId: identity.clientKey,
        scopes: [],
        extra: { identity },
      },
    });
  }

  /**
   * Tell 2026-era clients with an open `subscriptions/listen` stream that the
   * tool and prompt lists changed (the user toggled writes, or the server).
   * 2025-era clients are served statelessly and cannot be pushed to — the
   * bundled shim polls `/mcp-state` and synthesizes the notification for them.
   */
  notifyToolsChanged(): void {
    if (!this.handler) return;
    this.handler.notify.toolsChanged();
    this.handler.notify.promptsChanged();
  }

  async close(): Promise<void> {
    await this.handler?.close();
    this.handler = null;
  }
}
