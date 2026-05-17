import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetTaskRuntimeForTesting } from "../../../modules/tasks/backend/runtime-singleton";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";

// Pin DB path at module-load time; the tasks singleton caches storage bound
// to one sqlite, so all tests in this file must share one DB path.
const TASKS_DB_PATH = path.join(
  os.tmpdir(),
  `openpcb-tasks-${Date.now()}-${crypto.randomUUID()}.sqlite`,
);
process.env.OPENPCB_DB_PATH = TASKS_DB_PATH;
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

const tempDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "openpcb-tasks-"));
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

async function bootTasksWorkspace(): Promise<{
  server: ReturnType<typeof createHttpServer>;
  moduleRuntime: ModuleRuntime;
}> {
  process.env.OPENPCB_DB_PATH = TASKS_DB_PATH;
  resetSharedSqliteForTesting();
  resetTaskRuntimeForTesting();
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

describe("tasks runtime", () => {
  test("creates and completes echo task", async () => {
    const { server } = await bootTasksWorkspace();

    const createResponse = await server.fetch(
      new Request("http://localhost/api/modules/tasks/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "tasks.echo",
          payload: { message: "hello" },
        }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const body = (await createResponse.json()) as {
      task: { id: string; status: string };
    };
    expect(body.task.status).toBeOneOf([
      "pending",
      "queued",
      "running",
      "completed",
    ]);
  });

  test("lists tasks", async () => {
    const { server } = await bootTasksWorkspace();

    await server.fetch(
      new Request("http://localhost/api/modules/tasks/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "tasks.echo", payload: { message: "a" } }),
      }),
    );

    const listResponse = await server.fetch(
      new Request("http://localhost/api/modules/tasks/tasks"),
    );
    expect(listResponse.status).toBe(200);
    const body = (await listResponse.json()) as Array<{ id: string }>;
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test("cancel queued task", async () => {
    const { server } = await bootTasksWorkspace();

    const createResponse = await server.fetch(
      new Request("http://localhost/api/modules/tasks/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "tasks.echo",
          payload: { message: "x", delayMs: 5000 },
        }),
      }),
    );
    const { task } = (await createResponse.json()) as { task: { id: string } };

    const cancelResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/tasks/tasks/${task.id}/cancel`,
        { method: "POST" },
      ),
    );
    expect(cancelResponse.status).toBe(200);

    const getResponse = await server.fetch(
      new Request(`http://localhost/api/modules/tasks/tasks/${task.id}`),
    );
    const fetched = (await getResponse.json()) as { status: string };
    expect(fetched.status).toBe("cancelled");
  });

  test("retry failed task", async () => {
    const { server } = await bootTasksWorkspace();

    const createResponse = await server.fetch(
      new Request("http://localhost/api/modules/tasks/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "unknown.type", payload: {} }),
      }),
    );
    const { task } = (await createResponse.json()) as { task: { id: string } };

    // Wait for failure
    await new Promise((resolve) => setTimeout(resolve, 200));

    const retryResponse = await server.fetch(
      new Request(`http://localhost/api/modules/tasks/tasks/${task.id}/retry`, {
        method: "POST",
      }),
    );
    expect(retryResponse.status).toBe(200);

    const getResponse = await server.fetch(
      new Request(`http://localhost/api/modules/tasks/tasks/${task.id}`),
    );
    const fetched = (await getResponse.json()) as {
      status: string;
      retryCount: number;
    };
    expect(fetched.status).toBe("queued");
    expect(fetched.retryCount).toBe(1);
  });

  test("chunks are persisted", async () => {
    const { server } = await bootTasksWorkspace();

    const createResponse = await server.fetch(
      new Request("http://localhost/api/modules/tasks/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "tasks.echo",
          payload: { message: "chunky" },
        }),
      }),
    );
    const { task } = (await createResponse.json()) as { task: { id: string } };

    // Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 300));

    const chunksResponse = await server.fetch(
      new Request(`http://localhost/api/modules/tasks/tasks/${task.id}/chunks`),
    );
    const chunks = (await chunksResponse.json()) as Array<{ content: string }>;
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some((c) => c.content === "chunky")).toBe(true);
  });
});
