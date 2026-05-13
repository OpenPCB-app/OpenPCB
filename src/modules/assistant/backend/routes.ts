import { NotFoundError, ValidationError } from "../../../core/contracts/errors";
import type { CoreBackendModuleContext, ModuleRouterHandle } from "../../../core/contracts/modules/backend-module";
import type { AssistantProviderConfigInput, AssistantSettings, CreateAssistantChatInput, SubmitAssistantMessageInput } from "../../../sdks/assistant";
import { getAssistantService } from "./assistant-service";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

async function body<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

function chatId(ctx: { params: { getOrThrow(name: string): string } }): string {
  const id = ctx.params.getOrThrow("id");
  if (id === "undefined" || id === "null") throw new ValidationError("A valid chat id is required");
  return id;
}

function requireChat(id: string): void {
  if (!getAssistantService().store.getChat(id)) throw new NotFoundError(`Chat not found: ${id}`);
}

export function registerRoutes(router: ModuleRouterHandle, _ctx: CoreBackendModuleContext): void {
  router.get("/chats", () => json(getAssistantService().store.listChats()));
  router.post("/chats", async (ctx) => json(getAssistantService().createChat(await body<CreateAssistantChatInput>(ctx.req)), 201));
  router.get("/chats/:id", (ctx) => {
    const chat = getAssistantService().store.getChat(chatId(ctx));
    if (!chat) throw new NotFoundError("Chat not found");
    return json(chat);
  });
  router.delete("/chats/:id", (ctx) => {
    getAssistantService().store.deleteChat(chatId(ctx));
    return json({ ok: true });
  });
  router.get("/chats/:id/messages", (ctx) => {
    const id = chatId(ctx);
    requireChat(id);
    return json(getAssistantService().store.listMessages(id));
  });
  router.post("/chats/:id/messages", async (ctx) => json(await getAssistantService().submitMessage(chatId(ctx), await body<SubmitAssistantMessageInput>(ctx.req)), 201));
  router.get("/providers", () => json(getAssistantService().listProviders()));
  router.post("/providers", async (ctx) => json(getAssistantService().createProviderConfig(await body<AssistantProviderConfigInput>(ctx.req)), 201));
  router.get("/providers/:id", (ctx) => {
    const provider = getAssistantService().settings.getProvider(ctx.params.getOrThrow("id"));
    if (!provider) throw new NotFoundError("Provider not found");
    return json(provider);
  });
  router.put("/providers/:id", async (ctx) => json(getAssistantService().updateProviderConfig(ctx.params.getOrThrow("id"), await body<AssistantProviderConfigInput>(ctx.req))));
  router.delete("/providers/:id", (ctx) => {
    getAssistantService().deleteProviderConfig(ctx.params.getOrThrow("id"));
    return json({ ok: true });
  });
  router.get("/providers/:id/models", (ctx) => json(getAssistantService().listProviderModels(ctx.params.getOrThrow("id"))));
  router.post("/providers/:id/models/refresh", async (ctx) => json(await getAssistantService().refreshProviderModels(ctx.params.getOrThrow("id"))));
  router.post("/providers/:id/test", async (ctx) => json(await getAssistantService().testProvider(ctx.params.getOrThrow("id"), await body<{ includeCompletion?: boolean }>(ctx.req).catch(() => ({})))));
  router.get("/tools", () => json(getAssistantService().tools.list().map((tool) => ({ name: tool.definition.function.name, effect: tool.effect, description: tool.definition.function.description }))));
  router.get("/tasks/:taskId/tool-events", (ctx) => json(getAssistantService().store.listToolEvents(ctx.params.getOrThrow("taskId"))));
  router.post("/tool-events/:id/approve", async (ctx) => {
    const result = await getAssistantService().approveToolEvent(ctx.params.getOrThrow("id"));
    return json(result);
  });
  router.post("/tool-events/:id/reject", (ctx) => {
    getAssistantService().rejectToolEvent(ctx.params.getOrThrow("id"));
    return json({ ok: true });
  });
  router.get("/settings", () => json(getAssistantService().getSettings()));
  router.put("/settings", async (ctx) => json(getAssistantService().updateSettings(await body<Partial<AssistantSettings>>(ctx.req))));
}
