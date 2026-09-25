import { NotFoundError, ValidationError } from "../../../core/contracts/errors";
import type {
  CoreBackendModuleContext,
  ModuleRouterHandle,
} from "../../../core/contracts/modules/backend-module";
import type {
  AssistantProviderConfigInput,
  AssistantPromptPresetId,
  AssistantSettings,
  CreateAssistantChatInput,
  SubmitAssistantMessageInput,
} from "../../../sdks/assistant";
import { isFeatureEnabled } from "../../../core/contracts/feature-flags/backend";
import { getAssistantService } from "./assistant-service";
import { checkMcpAuth } from "./mcp/auth";
import { assistantEventStream } from "./events";
import { CopilotHttpError } from "./cloud/copilot-client";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function body<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

function chatId(ctx: { params: { getOrThrow(name: string): string } }): string {
  const id = ctx.params.getOrThrow("id");
  if (id === "undefined" || id === "null")
    throw new ValidationError("A valid chat id is required");
  return id;
}

function requireChat(id: string): void {
  if (!getAssistantService().conversation.getChat(id))
    throw new NotFoundError(`Chat not found: ${id}`);
}

/** S6: per-request cloud credentials (never stored raw — see token-crypto.ts).
 * Mirrors the designer convention (x-cloud-bearer / x-cloud-api-url) plus the
 * copilot service URL. Returns null unless all of bearer+copilotUrl present. */
function cloudCredsFromHeaders(req: Request): {
  bearer: string;
  apiUrl: string;
  copilotUrl: string;
} | null {
  const bearer = req.headers.get("x-cloud-bearer") ?? "";
  const apiUrl = req.headers.get("x-cloud-api-url") ?? "";
  const copilotUrl = req.headers.get("x-cloud-copilot-url") ?? "";
  if (!bearer || !copilotUrl) return null;
  return { bearer, apiUrl, copilotUrl };
}

/** S7: pass copilot HTTP errors (esp. 409 plan-revision CAS) through with their
 * original status so the plan card can react, instead of a generic 500. */
async function proxyCopilot<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    return json(await fn());
  } catch (err) {
    if (err instanceof CopilotHttpError) {
      return json({ error: err.body || err.message }, err.status);
    }
    throw err;
  }
}

function normalizeChatTitle(title: unknown): string {
  if (typeof title !== "string")
    throw new ValidationError("Chat title is required");
  const normalized = title.trim();
  if (!normalized) throw new ValidationError("Chat title is required");
  if (normalized.length > 160)
    throw new ValidationError("Chat title must be 160 characters or fewer");
  return normalized;
}

function normalizeChatIds(chatIds: unknown): string[] {
  if (!Array.isArray(chatIds))
    throw new ValidationError("Chat ids are required");
  const ids = chatIds
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id !== "undefined" && id !== "null");
  const unique = [...new Set(ids)];
  if (unique.length === 0)
    throw new ValidationError("At least one chat id is required");
  if (unique.length > 100)
    throw new ValidationError("Cannot delete more than 100 chats at once");
  return unique;
}

function parseLimit(raw: string | null, fallback = 50): number {
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

export function registerRoutes(
  router: ModuleRouterHandle,
  _ctx: CoreBackendModuleContext,
): void {
  // Designer-scoped chats
  router.get("/design-chats", async (ctx) => {
    const url = new URL(ctx.req.url);
    const designId = url.searchParams.get("designId") ?? "";
    return json(await getAssistantService().listDesignChats(designId));
  });
  router.post("/design-chats", async (ctx) => {
    const input = await body<{
      designId: string;
      title?: string;
      providerConfigId?: string;
      model?: string;
      promptPresetId?: AssistantPromptPresetId;
    }>(ctx.req);
    return json(await getAssistantService().createDesignChat(input), 201);
  });
  router.post("/design-chats/ensure", async (ctx) => {
    const input = await body<{ designId: string }>(ctx.req);
    return json(await getAssistantService().ensureDesignChat(input.designId));
  });

  // Chats
  router.get("/chats", () =>
    json(getAssistantService().conversation.listChats()),
  );
  router.post("/chats", async (ctx) =>
    json(
      getAssistantService().createChat(
        await body<CreateAssistantChatInput>(ctx.req),
      ),
      201,
    ),
  );
  router.post("/chats/bulk-delete", async (ctx) => {
    const input = await body<{ chatIds?: unknown }>(ctx.req);
    const ids = normalizeChatIds(input.chatIds);
    for (const id of ids) requireChat(id);
    for (const id of ids) getAssistantService().conversation.deleteChat(id);
    return json({ ok: true, deleted: ids.length });
  });
  router.get("/chats/:id", (ctx) => {
    const chat = getAssistantService().conversation.getChat(chatId(ctx));
    if (!chat) throw new NotFoundError("Chat not found");
    return json(chat);
  });
  router.patch("/chats/:id", async (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    const input = await body<{ title?: unknown }>(ctx.req);
    return json(
      getAssistantService().conversation.updateChat(id, {
        title: normalizeChatTitle(input.title),
      }),
    );
  });
  router.delete("/chats/:id", (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    getAssistantService().conversation.deleteChat(id);
    return json({ ok: true });
  });
  router.get("/chats/:id/messages", (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    const url = new URL(ctx.req.url);
    return json(
      getAssistantService().conversation.listMessages(id, {
        limit: parseLimit(url.searchParams.get("limit")),
        before: url.searchParams.get("before"),
      }),
    );
  });
  router.post("/chats/:id/messages", async (ctx) =>
    json(
      await getAssistantService().submitMessage(
        chatId(ctx),
        await body<SubmitAssistantMessageInput>(ctx.req),
        cloudCredsFromHeaders(ctx.req),
      ),
      201,
    ),
  );

  // D15: zero-config openpcb-cloud provider seed / disable. Idempotent; the
  // renderer calls seed when a Pro session is present, disable on tier loss.
  router.post("/providers/cloud/seed", async (ctx) => {
    const creds = cloudCredsFromHeaders(ctx.req);
    if (!creds)
      throw new ValidationError("A signed-in cloud session is required");
    return json(await getAssistantService().seedCloudProvider(creds));
  });
  router.post("/providers/cloud/disable", () => {
    getAssistantService().disableCloudProvider();
    return json({ ok: true });
  });

  // Tool events
  router.get("/chats/:id/tool-events", (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    const url = new URL(ctx.req.url);
    const messageId = url.searchParams.get("messageId") ?? undefined;
    const messageIds =
      url.searchParams
        .get("messageIds")
        ?.split(",")
        .map((entry) => entry.trim())
        .filter(Boolean) ?? undefined;
    return json(
      getAssistantService().listToolEvents(
        id,
        messageIds?.length ? { messageIds } : messageId ? { messageId } : {},
      ),
    );
  });

  // Write proposals
  router.get("/chats/:id/write-proposals", (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    return json(getAssistantService().listWriteProposals(id));
  });
  router.post("/chats/:id/write-proposals/:proposalId/apply", async (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    return json(
      await getAssistantService().applyWriteProposal(
        id,
        ctx.params.getOrThrow("proposalId"),
        await body<{ allowPartial?: boolean }>(ctx.req).catch(() => ({})),
        cloudCredsFromHeaders(ctx.req),
      ),
    );
  });
  router.post("/chats/:id/write-proposals/:proposalId/reject", (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    return json(
      getAssistantService().rejectWriteProposal(
        id,
        ctx.params.getOrThrow("proposalId"),
        cloudCredsFromHeaders(ctx.req),
      ),
    );
  });
  // S7: cloud-plan proxy (plan card). Cloud-only — creds required (400 if absent).
  router.get("/chats/:id/cloud-runs/:runId/plan", (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    return proxyCopilot(() =>
      getAssistantService().getCloudPlan(
        id,
        ctx.params.getOrThrow("runId"),
        cloudCredsFromHeaders(ctx.req),
      ),
    );
  });
  router.patch("/chats/:id/cloud-runs/:runId/plan", async (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    const req = await body<Parameters<
      ReturnType<typeof getAssistantService>["patchCloudPlan"]
    >[2]>(ctx.req);
    return proxyCopilot(() =>
      getAssistantService().patchCloudPlan(
        id,
        ctx.params.getOrThrow("runId"),
        req,
        cloudCredsFromHeaders(ctx.req),
      ),
    );
  });
  router.post("/chats/:id/cloud-runs/:runId/plan/approve", (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    return proxyCopilot(() =>
      getAssistantService().approveCloudPlan(
        id,
        ctx.params.getOrThrow("runId"),
        cloudCredsFromHeaders(ctx.req),
      ),
    );
  });
  router.post("/chats/:id/cloud-runs/:runId/resume", async (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    const req = await body<{ message?: string | null }>(ctx.req).catch(() => ({}));
    return proxyCopilot(() =>
      getAssistantService().resumeCloudRun(
        id,
        ctx.params.getOrThrow("runId"),
        req,
        cloudCredsFromHeaders(ctx.req),
      ),
    );
  });
  // Read-only remaining-credits balance (composer footer). Workspace-scoped, not
  // chat-scoped; cloud-only — creds required (400 if absent).
  router.get("/cloud/wallet", (ctx) => {
    const url = new URL(ctx.req.url);
    return proxyCopilot(() =>
      getAssistantService().getCloudWallet(
        url.searchParams.get("workspaceId") ?? "",
        cloudCredsFromHeaders(ctx.req),
      ),
    );
  });

  router.get("/chats/:id/write-policy/session-allow", (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    return json(getAssistantService().listSessionWriteAllowances(id));
  });
  router.post("/chats/:id/write-policy/session-allow", async (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    return json(
      getAssistantService().allowSessionWriteTool(
        id,
        await body<{
          toolName?: unknown;
          proposalKind?: unknown;
          riskLevel?: unknown;
        }>(ctx.req),
      ),
      201,
    );
  });
  router.delete("/chats/:id/write-policy/session-allow/:key", (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    getAssistantService().revokeSessionWriteAllowance(
      id,
      ctx.params.getOrThrow("key"),
    );
    return json({ ok: true });
  });

  // Context bindings
  router.get("/chats/:id/context-bindings", (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    return json(getAssistantService().listContextBindings(id));
  });
  router.delete("/chats/:id/context-bindings/:bindingId", (ctx) => {
    const id = chatId(ctx);
    const bindingId = ctx.params.getOrThrow("bindingId");
    getAssistantService().deleteContextBinding(id, bindingId);
    return json({ ok: true });
  });

  // Prompt presets
  router.get("/prompt-presets", () =>
    json(getAssistantService().listPromptPresets()),
  );

  // Providers
  router.get("/providers", () => json(getAssistantService().listProviders()));
  router.post("/providers", async (ctx) =>
    json(
      getAssistantService().createProvider(
        await body<AssistantProviderConfigInput>(ctx.req),
      ),
      201,
    ),
  );
  router.get("/providers/:id", (ctx) => {
    const provider = getAssistantService().providers.getProvider(
      ctx.params.getOrThrow("id"),
    );
    if (!provider) throw new NotFoundError("Provider not found");
    return json(provider);
  });
  router.put("/providers/:id", async (ctx) =>
    json(
      getAssistantService().updateProvider(
        ctx.params.getOrThrow("id"),
        await body<AssistantProviderConfigInput>(ctx.req),
      ),
    ),
  );
  router.delete("/providers/:id", (ctx) => {
    getAssistantService().deleteProvider(ctx.params.getOrThrow("id"));
    return json({ ok: true });
  });
  router.get("/providers/:id/models", (ctx) =>
    json(getAssistantService().listProviderModels(ctx.params.getOrThrow("id"))),
  );
  // B2: these three forward the request's cloud credentials so the
  // `openpcb-cloud` provider can authenticate (bearer) and attribute (workspace
  // header). Without them all three 401 against the metered proxy. The service
  // ignores the credentials for every other provider kind.
  router.post("/providers/:id/models/refresh", async (ctx) =>
    json(
      await getAssistantService().refreshProviderModels(
        ctx.params.getOrThrow("id"),
        cloudCredsFromHeaders(ctx.req),
      ),
    ),
  );
  router.post("/providers/:id/test", async (ctx) =>
    json(
      await getAssistantService().testProvider(
        ctx.params.getOrThrow("id"),
        await body<{ includeCompletion?: boolean }>(ctx.req).catch(() => ({})),
        cloudCredsFromHeaders(ctx.req),
      ),
    ),
  );
  router.get("/providers/:id/capabilities", (ctx) =>
    json(
      getAssistantService().getProviderCapabilities(
        ctx.params.getOrThrow("id"),
      ),
    ),
  );
  router.post("/providers/:id/capabilities/refresh", async (ctx) =>
    json(
      await getAssistantService().refreshProviderCapabilities(
        ctx.params.getOrThrow("id"),
        cloudCredsFromHeaders(ctx.req),
      ),
    ),
  );
  router.get("/providers/:id/tool-calling", (ctx) =>
    json(getAssistantService().getToolCalling(ctx.params.getOrThrow("id"))),
  );
  router.put("/providers/:id/tool-calling", async (ctx) => {
    const { mode } = await body<{ mode?: string }>(ctx.req);
    if (mode !== "auto" && mode !== "on" && mode !== "off") {
      throw new ValidationError("mode must be one of: auto, on, off");
    }
    return json(
      getAssistantService().setToolCalling(ctx.params.getOrThrow("id"), mode),
    );
  });

  // Tools (read-only list for UI)
  router.get("/tools", () => {
    const registry = (
      getAssistantService().runService as unknown as {
        options: {
          buildRegistry: (allow: boolean) => {
            listDefinitions(): Array<{
              name: string;
              description: string;
              effect: string;
            }>;
          };
        };
      }
    ).options.buildRegistry(false);
    return json(
      registry.listDefinitions().map((def) => ({
        name: def.name,
        effect: def.effect,
        description: def.description,
      })),
    );
  });

  // MCP — Streamable HTTP. The transport uses POST for requests, GET for the
  // server→client stream and DELETE to end a session; ModuleRouterHandle has no
  // `all()`, so register the three and delegate to one handler. OPTIONS is
  // short-circuited upstream by the CORS middleware.
  if (isFeatureEnabled("mcp.server")) {
    const mcp = (ctx: { req: Request }) =>
      getAssistantService().mcp.fetch(ctx.req);
    router.post("/mcp", mcp);
    router.get("/mcp", mcp);
    router.delete("/mcp", mcp);

    // Shim state probe (bearer-gated like the endpoint, but answered even
    // while the server is switched off so the shim can say so).
    router.get("/mcp-state", ({ req }) => {
      const failure = checkMcpAuth(req);
      if (failure) {
        return json(
          { error: failure.message },
          failure.code === "unauthorized" ? 401 : 500,
        );
      }
      return json(getAssistantService().mcpState());
    });

    // Connected clients for the Settings panel (loopback UI, like the rest of
    // this module's routes).
    router.get("/mcp/clients", () =>
      json({ clients: getAssistantService().listMcpClients() }),
    );
  }

  // Live change notifications (chat activity, proposal status) as SSE, so the
  // panel refreshes for changes made outside its own runs — MCP clients above
  // all. Ids only; the panel refetches through the routes above.
  router.get("/events", ({ req }) =>
    assistantEventStream(getAssistantService().events, req.signal),
  );

  // Settings
  router.get("/settings", () => json(getAssistantService().getSettings()));
  router.put("/settings", async (ctx) =>
    json(
      getAssistantService().updateSettings(
        await body<Partial<AssistantSettings>>(ctx.req),
      ),
    ),
  );
}
