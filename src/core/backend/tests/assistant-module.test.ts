import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetAssistantServiceForTesting } from "../../../modules/assistant/backend/assistant-service";
import { getAssistantService } from "../../../modules/assistant/backend/assistant-service";
import { resetTaskRuntimeForTesting } from "../../../modules/tasks/backend/runtime-singleton";
import { getSharedSqlite, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "test-key";
// Pin DB path at module-load time so the assistant singleton (cached per
// process) stays bound to a single sqlite for the whole file. Other test
// files using isolateTestDb mutate this env mid-run, so re-pin in
// bootAssistantWorkspace as well and reset the shared client.
const ASSISTANT_DB_PATH = path.join(
  os.tmpdir(),
  `openpcb-assistant-${Date.now()}-${crypto.randomUUID()}.sqlite`,
);
process.env.OPENPCB_DB_PATH = ASSISTANT_DB_PATH;

const tempDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "openpcb-assistant-"));
  tempDirs.push(workspace);
  await mkdir(path.join(workspace, "modules"), { recursive: true });
  return workspace;
}

async function writeModule(
  workspace: string,
  moduleId: string,
  manifest: Record<string, unknown>,
  backendEntrySource: string,
): Promise<void> {
  const moduleDir = path.join(workspace, "modules", moduleId);
  await mkdir(moduleDir, { recursive: true });
  await writeFile(
    path.join(moduleDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(moduleDir, "module.backend.mjs"),
    backendEntrySource,
    "utf8",
  );
  const realMigrations = path.resolve(
    import.meta.dir,
    "../../../modules",
    moduleId,
    "backend/migrations",
  );
  await cp(realMigrations, path.join(moduleDir, "backend", "migrations"), {
    recursive: true,
  });
}

function baseManifest(moduleId: string): Record<string, unknown> {
  return {
    id: moduleId,
    label: moduleId,
    version: "1.0.0",
    apiVersion: 2,
    namespace: `space.${moduleId}`,
    kind: "space",
    sidebar: { label: moduleId, icon: "Box", order: 10 },
    runtime: { backendEntry: "module.backend.mjs" },
    dependsOn: [],
  };
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

async function bootAssistantWorkspace(): Promise<{
  server: ReturnType<typeof createHttpServer>;
  moduleRuntime: ModuleRuntime;
}> {
  process.env.OPENPCB_DB_PATH = ASSISTANT_DB_PATH;
  resetSharedSqliteForTesting();
  resetTaskRuntimeForTesting();
  resetAssistantServiceForTesting();
  const workspace = await createWorkspace();

  const tasksManifest = {
    ...baseManifest("tasks"),
    kind: "tool",
    sidebar: {
      label: "Tasks",
      icon: "ListChecks",
      order: 90,
      group: "system",
      hidden: true,
    },
  };
  const tasksBackend = `
    import { initializeTaskRuntime } from "../../../../../src/modules/tasks/backend/runtime-singleton";
    import { buildTasksSdk } from "../../../../../src/modules/tasks/backend/sdk";
    import { registerRoutes } from "../../../../../src/modules/tasks/backend/routes";
    export default {
      id: "tasks",
      async onActivate(ctx) {
        await initializeTaskRuntime(ctx);
      },
      registerSdk(ctx) {
        ctx.sdk.registerValue("TasksSDK", buildTasksSdk());
      },
      registerRoutes(router, ctx) {
        registerRoutes(router, ctx);
      },
    };
  `;
  await writeModule(workspace, "tasks", tasksManifest, tasksBackend);

  const assistantManifest = {
    ...baseManifest("assistant"),
    dependsOn: [{ id: "tasks", minVersion: "0.1.0", optional: false }],
  };
  const assistantBackend = `
    import { initializeAssistantService } from "../../../../../src/modules/assistant/backend/assistant-service";
    import { buildAssistantSdk } from "../../../../../src/modules/assistant/backend/sdk";
    import { registerRoutes } from "../../../../../src/modules/assistant/backend/routes";
    export default {
      id: "assistant",
      onActivate(ctx) {
        initializeAssistantService(ctx);
      },
      registerSdk(ctx) {
        ctx.sdk.registerValue("AssistantSDK", buildAssistantSdk());
      },
      registerRoutes(router, ctx) {
        registerRoutes(router, ctx);
      },
    };
  `;
  await writeModule(
    workspace,
    "assistant",
    assistantManifest,
    assistantBackend,
  );

  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: workspace,
  });
  await moduleRuntime.bootstrap();

  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });

  return { server, moduleRuntime };
}

describe("assistant module", () => {
  test("creates chat", async () => {
    const { server } = await bootAssistantWorkspace();

    const response = await server.fetch(
      new Request("http://localhost/api/modules/assistant/chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Test chat" }),
      }),
    );
    expect(response.status).toBe(201);
    const chat = (await response.json()) as { id: string; title: string };
    expect(chat.id).not.toBe("undefined");
    expect(chat.title).toBe("Test chat");
  });

  test("lists chats", async () => {
    const { server } = await bootAssistantWorkspace();

    await server.fetch(
      new Request("http://localhost/api/modules/assistant/chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "A" }),
      }),
    );

    const response = await server.fetch(
      new Request("http://localhost/api/modules/assistant/chats"),
    );
    expect(response.status).toBe(200);
    const chats = (await response.json()) as Array<{ title: string }>;
    expect(chats.length).toBeGreaterThanOrEqual(1);
  });

  test("submit message creates user message and assistant placeholder", async () => {
    const { server } = await bootAssistantWorkspace();

    const chatResponse = await server.fetch(
      new Request("http://localhost/api/modules/assistant/chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const chat = (await chatResponse.json()) as { id: string };

    const submitResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/assistant/chats/${chat.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "hello" }),
        },
      ),
    );
    expect(submitResponse.status).toBe(201);
    const result = (await submitResponse.json()) as {
      userMessage: { role: string };
      assistantMessage: { role: string; taskId: string | null };
      taskId: string;
    };
    expect(result.userMessage.role).toBe("user");
    expect(result.assistantMessage.role).toBe("assistant");
    expect(result.assistantMessage.taskId).not.toBeNull();
  });

  test("submit message rejects undefined chat id without 500", async () => {
    const { server } = await bootAssistantWorkspace();

    const response = await server.fetch(
      new Request(
        "http://localhost/api/modules/assistant/chats/undefined/messages",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "hello" }),
        },
      ),
    );

    expect(response.status).toBe(400);
    const problem = (await response.json()) as { detail?: string };
    expect(problem.detail).toContain("valid chat id");
  });

  test("list messages returns not found for missing chat", async () => {
    const { server } = await bootAssistantWorkspace();
    const missingChatId = crypto.randomUUID();

    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/assistant/chats/${missingChatId}/messages`,
      ),
    );

    expect(response.status).toBe(404);
  });

  test("messages endpoint returns latest page with cursor", async () => {
    const { server } = await bootAssistantWorkspace();
    const chatResponse = await server.fetch(
      new Request("http://localhost/api/modules/assistant/chats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Paged" }),
      }),
    );
    const chat = (await chatResponse.json()) as { id: string };
    const store = getAssistantService().conversation;
    for (let i = 0; i < 6; i++) {
      store.createMessage({ chatId: chat.id, role: "user", content: `m${i}` });
      await Bun.sleep(2);
    }

    const firstResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/assistant/chats/${chat.id}/messages?limit=3`,
      ),
    );
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as {
      items: Array<{ id: string; content: string }>;
      hasMore: boolean;
      nextCursor: string | null;
    };
    expect(first.items.map((m) => m.content)).toEqual(["m3", "m4", "m5"]);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const olderResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/assistant/chats/${chat.id}/messages?limit=3&before=${encodeURIComponent(first.nextCursor!)}`,
      ),
    );
    const older = (await olderResponse.json()) as {
      items: Array<{ content: string }>;
      hasMore: boolean;
    };
    expect(older.items.map((m) => m.content)).toEqual(["m0", "m1", "m2"]);
    expect(older.hasMore).toBe(false);
  });

  test("exposes tools list", async () => {
    const { server } = await bootAssistantWorkspace();

    const response = await server.fetch(
      new Request("http://localhost/api/modules/assistant/tools"),
    );
    expect(response.status).toBe(200);
    const tools = (await response.json()) as Array<{
      name: string;
      effect: string;
    }>;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.some((tool) => tool.name === "designer_place_components")).toBe(
      true,
    );
    expect(tools.some((tool) => tool.name === "designer_create_design")).toBe(
      true,
    );
    expect(tools.some((tool) => tool.name === "library_resolve_bom")).toBe(true);
  });

  test("providers endpoint returns defaults", async () => {
    const { server } = await bootAssistantWorkspace();

    const response = await server.fetch(
      new Request("http://localhost/api/modules/assistant/providers"),
    );
    expect(response.status).toBe(200);
    const providers = (await response.json()) as Array<{
      id: string;
      defaultModel: string;
      isBuiltin: boolean;
      hasApiKey: boolean;
    }>;
    expect(providers.length).toBeGreaterThanOrEqual(1);
    const openai = providers.find((p) => p.id === "openai");
    expect(openai?.defaultModel).toBe("gpt-4o-mini");
    expect(openai?.isBuiltin).toBe(true);
  });

  test("settings endpoint returns assistant defaults", async () => {
    const { server } = await bootAssistantWorkspace();

    const response = await server.fetch(
      new Request("http://localhost/api/modules/assistant/settings"),
    );
    expect(response.status).toBe(200);
    const settings = (await response.json()) as {
      defaultProviderId: string;
      toolExecutionPolicy: string;
    };
    expect(settings.defaultProviderId).toBe("openai");
    expect(settings.toolExecutionPolicy).toBe("auto_readonly_confirm_writes");
    expect("enableWriteToolsBeta" in settings).toBe(false);
  });

  test("settings schema excludes historical write beta flag", async () => {
    await bootAssistantWorkspace();

    const columns = getSharedSqlite()
      .query<{ name: string }, []>("PRAGMA table_info(assistant_settings)")
      .all()
      .map((column) => column.name);

    expect(columns).toContain("allow_raw_tool_data");
    expect(columns).not.toContain("enable_write_tools_beta");
  });

  test("context binding deletion is scoped to chat", async () => {
    const { server } = await bootAssistantWorkspace();
    const service = getAssistantService();
    const chatA = service.createChat({ title: "A" });
    const chatB = service.createChat({ title: "B" });
    const bindingA = service.conversation.createBinding(chatA.id, {
      id: crypto.randomUUID(),
      kind: "design",
      refId: "design-a",
      label: "Design A",
      role: "primary",
      status: "active",
    });
    service.conversation.createBinding(chatB.id, {
      id: crypto.randomUUID(),
      kind: "design",
      refId: "design-b",
      label: "Design B",
      role: "primary",
      status: "active",
    });

    const response = await server.fetch(
      new Request(
        `http://localhost/api/modules/assistant/chats/${chatB.id}/context-bindings/${bindingA.id}`,
        { method: "DELETE" },
      ),
    );

    expect(response.status).toBe(200);
    expect(service.listContextBindings(chatA.id)).toHaveLength(1);
    expect(service.listContextBindings(chatB.id)).toHaveLength(1);
  });
});
