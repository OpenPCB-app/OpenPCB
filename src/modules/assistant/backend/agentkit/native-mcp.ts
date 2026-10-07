import { createMcpServerHandler, createStagedToolSource, type McpServerHandler } from "agentkit/mcp-server";
import { defaultClock, defaultIds, type AssistantStore, type ProposalService, type SessionWritePolicy, type ToolGuard } from "agentkit/host";
import { resolveToolLimits } from "agentkit/core";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { ContextResolver } from "../context-resolver";
import type { NativeContextStore } from "./native-context-store";
import { createNativeMcpContributor } from "./native-mcp-tools";
import { createNativeContextProvider } from "./native-verification";
import type { NativeMcpActors, NativeMcpSettings } from "./native-mcp-actors";
import { listMcpResources, readMcpResource } from "../mcp/resources";
import { MCP_PROMPT_DEFINITIONS, getMcpPrompt } from "../mcp/prompts";
import { revokeNativeActorGrants } from "./native-session-grants";

export interface NativeMcpEndpointOptions {
  context: CoreBackendModuleContext;
  host: { store: AssistantStore; proposals: ProposalService; policy: SessionWritePolicy };
  contextResolver: ContextResolver;
  contextStore: NativeContextStore;
  actors: NativeMcpActors;
  getSettings(): NativeMcpSettings & { contextSizePreference?: "small" | "medium" | "large" };
  getToken?(): string | undefined;
  readOnly?: boolean;
  appVersion?: string;
}

export function createNativeMcpEndpoint(options: NativeMcpEndpointOptions) {
  let handler: McpServerHandler | undefined;
  let retiring: McpServerHandler | undefined;
  let key: string | undefined;
  let closed = false;
  let refresh: Promise<void> = Promise.resolve();
  const dispose = async () => {
    retiring ??= handler;
    handler = undefined;
    key = undefined;
    revokeEndpointActors(options);
    await retiring?.dispose();
    retiring = undefined;
  };
  return {
    async fetch(request: Request): Promise<Response> {
      if (closed) return unavailable("OpenPCB MCP server is closed.");
      const settings = options.getSettings();
      const token = options.getToken ? options.getToken() : process.env.OPENPCB_MCP_TOKEN;
      const nextKey = JSON.stringify([settings.mcpEnabled, settings.mcpAllowWrites, settings.contextSizePreference, token]);
      // Each request still observes its own failure; only the scheduling tail recovers.
      refresh = refresh.catch(() => undefined).then(async () => {
        if (nextKey === key || closed) return;
        await dispose();
        if (closed) return;
        if (settings.mcpEnabled && token) handler = buildHandler(options, token, settings);
        key = nextKey;
      });
      await refresh;
      if (closed) return unavailable("OpenPCB MCP server is closed.");
      if (!settings.mcpEnabled) return unavailable("OpenPCB's MCP server is disabled. Enable it in Settings → Assistant → MCP.");
      if (!token) return unavailable("MCP server has no token configured (OPENPCB_MCP_TOKEN is unset). Restart OpenPCB.");
      return handler!.fetch(request);
    },
    async close(): Promise<void> {
      closed = true;
      const errors: unknown[] = [];
      try { await refresh; } catch (error) { errors.push(error); }
      try { await dispose(); } catch (error) { errors.push(error); }
      finally { revokeEndpointActors(options); }
      if (errors.length) throw errors.length === 1 ? errors[0] : new AggregateError(errors, "MCP endpoint cleanup failed");
    },
  };
}

function revokeEndpointActors(options: NativeMcpEndpointOptions): void {
  for (const { actorScope, chatId } of options.actors.sessions()) {
    revokeNativeActorGrants(options.host.policy, actorScope, chatId);
    options.contextStore.deleteChatContext(chatId);
  }
  options.actors.clear();
}

function buildHandler(options: NativeMcpEndpointOptions, token: string, settings: ReturnType<NativeMcpEndpointOptions["getSettings"]>): McpServerHandler {
  const writesEnabled = settings.mcpAllowWrites && !options.readOnly;
  const guard: ToolGuard = {
    isVisible: ({ tool }) => tool.effect === "read" || writesEnabled,
    canExecute: ({ actorId, chatId, tool }) => actorId && chatId && options.actors.has(`mcp:${actorId}`, chatId) &&
      (tool.effect === "read" || options.actors.canWrite(`mcp:${actorId}`, chatId))
      ? { allowed: true } : { allowed: false, reason: "MCP_ACTOR_DENIED" },
  };
  const source = createStagedToolSource({
    contributors: [createNativeMcpContributor({ ...options, store: options.host.store, proposals: options.host.proposals, readOnly: !writesEnabled })],
    context: createNativeContextProvider(options.contextResolver), guards: [guard], writePolicy: options.host.policy,
    limits: resolveToolLimits({ preference: settings.contextSizePreference ?? "small" }), clock: defaultClock, ids: defaultIds,
  });
  return createMcpServerHandler({
    tools: { ...source, async closeSession(scope) {
      await source.closeSession?.(scope);
      if (!scope.actorId) return;
      options.host.policy.revokeActor(`mcp:${scope.actorId}`);
      const chatId = options.actors.close(scope.actorId, scope.chatId);
      if (chatId) {
        revokeNativeActorGrants(options.host.policy, `mcp:${scope.actorId}`, chatId);
        options.contextStore.deleteChatContext(chatId);
      }
    } },
    resources: { list: () => listMcpResources(options.context), read: (uri) => readMcpResource(options.context, uri) },
    prompts: { list: async () => MCP_PROMPT_DEFINITIONS, get: async (name, args) => getMcpPrompt(name, args) },
    auth: { bearerToken: token }, writesEnabled, allowedHosts: ["127.0.0.1", "localhost", "[::1]"], allowedOrigins: ["http://127.0.0.1", "http://localhost", "app://openpcb"],
    serverInfo: { name: "openpcb", version: options.appVersion ?? "0.1.0" },
    maxConcurrentCallsPerSession: 1, maxRequestBytes: 1_048_576,
    async sessionScope(headers) {
      const display = headers.get("x-openpcb-mcp-client")?.slice(0, 120) || "External client";
      const chat = await options.host.store.conversations.createChat({ title: `MCP · ${display}`, metadata: { source: "mcp-server" } });
      options.actors.admitSessionChat(chat.id);
      return { chatId: chat.id, principal: "openpcb-mcp" };
    },
  });
}

function unavailable(message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }),
    { status: 503, headers: { "content-type": "application/json" } });
}
