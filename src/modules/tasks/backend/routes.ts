import type { CoreBackendModuleContext, ModuleRouterHandle } from "../../../core/contracts/modules/backend-module";
import { getTaskRuntime } from "./runtime-singleton";
import type { CreateTaskInput, TaskFilter, TaskStatus } from "../../../sdks/tasks";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readBody<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

function parseFilter(query: URLSearchParams): TaskFilter {
  const status = query.get("status") as TaskStatus | null;
  return {
    ...(status ? { status } : {}),
    ...(query.get("type") ? { type: query.get("type") ?? undefined } : {}),
    ...(query.get("queueKey") ? { queueKey: query.get("queueKey") ?? undefined } : {}),
    ...(query.get("scopeId") ? { scopeId: query.get("scopeId") ?? undefined } : {}),
    ...(query.get("limit") ? { limit: Number(query.get("limit")) } : {}),
  };
}

function sse(data: unknown, event?: string): string {
  return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
}

export function registerRoutes(router: ModuleRouterHandle, _ctx: CoreBackendModuleContext): void {
  router.get("/tasks", async (ctx) => json(await getTaskRuntime().listTasks(parseFilter(ctx.query))));

  router.post("/tasks", async (ctx) => {
    const body = await readBody<CreateTaskInput>(ctx.req);
    return json(await getTaskRuntime().createTask(body), 201);
  });

  router.get("/tasks/:id", async (ctx) => json(await getTaskRuntime().getTask(ctx.params.getOrThrow("id"))));
  router.post("/tasks/:id/cancel", async (ctx) => {
    await getTaskRuntime().cancelTask(ctx.params.getOrThrow("id"));
    return json({ ok: true });
  });
  router.post("/tasks/:id/retry", async (ctx) => {
    await getTaskRuntime().retryTask(ctx.params.getOrThrow("id"));
    return json({ ok: true });
  });
  router.get("/tasks/:id/chunks", async (ctx) => json(await getTaskRuntime().storage.getChunks(ctx.params.getOrThrow("id"), Number(ctx.query.get("fromSeq") ?? 0))));
  router.get("/tasks/:id/events", async (ctx) => json(await getTaskRuntime().storage.listEvents(ctx.params.getOrThrow("id"))));
  router.get("/queues", async () => json(getTaskRuntime().getQueueStatus()));

  router.get("/tasks/:id/stream", async (ctx) => {
    const taskId = ctx.params.getOrThrow("id");
    const runtime = getTaskRuntime();
    const encoder = new TextEncoder();
    const terminalEvents = new Set(["task.completed", "task.failed", "task.cancelled", "task.paused"]);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const events = await runtime.storage.listEvents(taskId);
        for (const event of events) {
          controller.enqueue(encoder.encode(sse(event, event.type)));
        }
        const last = events.at(-1);
        if (last && terminalEvents.has(last.type)) {
          controller.close();
          return;
        }
        const unsubscribe = runtime.onTaskEvent(taskId, (event) => {
          controller.enqueue(encoder.encode(sse(event, event.type)));
          if (terminalEvents.has(event.type)) {
            unsubscribe();
            try { controller.close(); } catch { /* closed */ }
          }
        });
        ctx.req.signal.addEventListener("abort", () => {
          unsubscribe();
          try { controller.close(); } catch { /* closed */ }
        });
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  });
}
