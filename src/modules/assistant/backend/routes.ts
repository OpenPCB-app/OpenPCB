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
import { getAssistantService } from "./assistant-service";

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
  router.get("/chats/:id", (ctx) => {
    const chat = getAssistantService().conversation.getChat(chatId(ctx));
    if (!chat) throw new NotFoundError("Chat not found");
    return json(chat);
  });
  router.delete("/chats/:id", (ctx) => {
    getAssistantService().conversation.deleteChat(chatId(ctx));
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
      ),
      201,
    ),
  );

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
        messageIds?.length
          ? { messageIds }
          : messageId
            ? { messageId }
            : {},
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
      ),
    );
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
  router.post("/providers/:id/models/refresh", async (ctx) =>
    json(
      await getAssistantService().refreshProviderModels(
        ctx.params.getOrThrow("id"),
      ),
    ),
  );
  router.post("/providers/:id/test", async (ctx) =>
    json(
      await getAssistantService().testProvider(
        ctx.params.getOrThrow("id"),
        await body<{ includeCompletion?: boolean }>(ctx.req).catch(() => ({})),
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
      ),
    ),
  );

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
