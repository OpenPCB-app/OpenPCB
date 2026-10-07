import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import Database from "better-sqlite3";
import { startBackendRuntime, type StartedBackendRuntime } from "../../runtime";
import { ModuleRuntime } from "../../modules/module-loader";
import { ModuleRouterRegistry } from "../../router/module-registry";
import { buildCoreLibraryFixture } from "../helpers/core-library-fixture-data";
import type { ModuleDefinition } from "../../../contracts/modules/backend-module";

const root = await mkdtemp(path.join(os.tmpdir(), "openpcb-lifecycle-"));
process.env.NODE_ENV = "production";
process.env.OPENPCB_DB_PATH = path.join(root, "app.sqlite");
process.env.APP_DATA_DIR = root;
process.env.OPENPCB_WORKSPACE_ROOT = path.resolve("src");
process.env.OPENPCB_BUNDLED_LIBRARY_PATH = path.join(
  root,
  "core-library.opclib",
);
await writeFile(
  process.env.OPENPCB_BUNDLED_LIBRARY_PATH,
  buildCoreLibraryFixture(),
);
const token = "b".repeat(64);
const security = { token, rendererOrigins: ["http://127.0.0.1:1420"] };
const secretStore = {
  async get() {
    return null;
  },
  async set() {},
  async delete() {},
  async listRefs() {
    return [];
  },
};
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function workspace(
  definitions: ModuleDefinition[],
  dependencies: Record<string, string[]> = {},
) {
  const directory = await mkdtemp(path.join(root, "modules-"));
  await mkdir(path.join(directory, "modules"));
  for (const definition of definitions) {
    const moduleDirectory = path.join(directory, "modules", definition.id);
    await mkdir(moduleDirectory);
    await writeFile(
      path.join(moduleDirectory, "manifest.json"),
      JSON.stringify({
        id: definition.id,
        label: definition.id,
        version: "1.0.0",
        apiVersion: 2,
        namespace: `space.${definition.id}`,
        kind: "space",
        sidebar: { label: definition.id, icon: "Box", order: 0 },
        runtime: { backendEntry: "module.backend.mjs" },
        dependsOn: (dependencies[definition.id] ?? []).map((id) => ({
          id: id.replace(/^\?/, ""),
          optional: id.startsWith("?"),
        })),
      }),
    );
  }
  const registry = new ModuleRouterRegistry();
  const runtime = new ModuleRuntime({
    moduleRegistry: registry,
    workspaceRoot: directory,
    staticModules: new Map(
      definitions.map((definition) => [definition.id, { definition }]),
    ),
  });
  return { runtime, registry };
}

test("module shutdown stops admission, reverses dependencies, cleans every hook once despite errors", async () => {
  const events: string[] = [];
  const { runtime, registry } = await workspace(
    [
      {
        id: "base",
        registerRoutes(router) {
          router.get("/read", () => new Response("base"));
        },
        async onDeactivate() {
          events.push("base");
        },
      },
      {
        id: "child",
        registerRoutes(router) {
          router.get("/read", () => new Response("child"));
        },
        async onDeactivate() {
          events.push("child");
          assert.equal(registry.get("base"), undefined);
          throw new Error("child cleanup failure");
        },
      },
    ],
    { child: ["base"] },
  );
  await runtime.bootstrap();
  const first = runtime.shutdown();
  const second = runtime.shutdown();
  assert.equal(first, second);
  await assert.rejects(first, AggregateError);
  assert.deepEqual(events, ["child", "base"]);
  assert.equal(registry.get("child"), undefined);
  await assert.rejects(second, AggregateError);
  assert.deepEqual(events, ["child", "base"]);
});

test("shutdown retains optional dependencies until dependent cleanup completes", async () => {
  const stopped: string[] = [];
  const { runtime } = await workspace(
    [
      {
        id: "adependent",
        onDeactivate() {
          stopped.push("adependent");
        },
      },
      {
        id: "zoptional",
        onDeactivate() {
          stopped.push("zoptional");
        },
      },
    ],
    { adependent: ["?zoptional"] },
  );
  await runtime.bootstrap();
  await runtime.shutdown();
  assert.deepEqual(stopped, ["adependent", "zoptional"]);
});

test("module activation and registration failures dispose initialized service", async () => {
  const disposed: string[] = [];
  const { runtime, registry } = await workspace([
    {
      id: "activation",
      async onActivate() {
        throw new Error("activation failure");
      },
      onDeactivate() {
        disposed.push("activation");
      },
    },
    {
      id: "registration",
      onActivate() {},
      registerRoutes() {
        throw new Error("registration failure");
      },
      onDeactivate() {
        disposed.push("registration");
      },
    },
  ]);
  await runtime.bootstrap();
  assert.deepEqual(disposed.sort(), ["activation", "registration"]);
  assert.equal(runtime.snapshot().loadedModules.length, 0);
  assert.equal(registry.get("registration"), undefined);
  await runtime.shutdown();
  assert.equal(disposed.length, 2);
});

async function modelServer() {
  let calls = 0;
  const server = createServer((request, response) => {
    if (request.url?.endsWith("/models")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "fixture" }] }));
      return;
    }
    if (!request.url?.endsWith("/chat/completions")) {
      response.writeHead(404);
      response.end();
      return;
    }
    calls++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Streaming" }, finish_reason: null }] })}\n\n`,
    );
    response.on("close", () => response.end());
    request.resume();
  });
  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    server,
    port: address.port,
    calls: () => calls,
    close: () => closeServer(server),
  };
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}
async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
async function request(
  runtime: StartedBackendRuntime,
  route: string,
  input: unknown,
  method = "POST",
) {
  return fetch(`${runtime.url}/api/modules/assistant${route}`, {
    method,
    headers: {
      "X-OpenPCB-Token": token,
      "content-type": "application/json",
      "Idempotency-Key": "lifecycle-submission",
    },
    body: JSON.stringify(input),
  });
}
async function waitUntil(check: () => boolean, milliseconds = 5000) {
  const deadline = Date.now() + milliseconds;
  while (!check() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check());
}

function assertLoaded(runtime: StartedBackendRuntime) {
  const assistant = runtime.snapshot.modules.find(
    (module) => module.id === "assistant",
  );
  assert.equal(assistant?.status, "loaded", assistant?.reason);
}

test("real runtime closes active model and SSE without deadlock, reopens same DB with zero inference", async () => {
  const model = await modelServer();
  let runtime: StartedBackendRuntime | undefined;
  try {
    runtime = await startBackendRuntime({
      host: "127.0.0.1",
      port: 0,
      localApi: security,
      secretStore,
    });
    assertLoaded(runtime);
    assert.equal(
      (
        await request(
          runtime,
          "/providers/lmstudio",
          {
            enabled: true,
            baseUrl: `http://127.0.0.1:${model.port}/v1`,
            defaultModel: "fixture",
          },
          "PATCH",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          runtime,
          "/settings",
          { defaultProviderId: "lmstudio" },
          "PATCH",
        )
      ).status,
      200,
    );
    const chatResponse = await request(runtime, "/v1/chats", {
      title: "Active shutdown",
    });
    const chat = (await chatResponse.json()) as { id: string };
    const submission = await request(runtime, `/v1/chats/${chat.id}/messages`, {
      content: "Hold model stream",
    });
    assert.equal(submission.status, 201);
    const run = (await submission.json()) as { runId: string };
    await waitUntil(() => model.calls() === 1);
    const stream = await fetch(
      `${runtime.url}/api/modules/assistant/v1/runs/${run.runId}/stream`,
      { headers: { "X-OpenPCB-Token": token } },
    );
    assert.equal(stream.status, 200);
    const drained = stream.text().catch(() => "closed");
    const closing = runtime.close();
    assert.equal(runtime.close(), closing);
    await Promise.race([
      closing,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Runtime close deadlocked")), 5000),
      ),
    ]);
    await drained;
    await assert.rejects(
      fetch(`${runtime.url}/api/modules/assistant/v1/chats`, {
        headers: { "X-OpenPCB-Token": token },
      }),
    );
    const database = new Database(path.join(root, "agentkit.sqlite"), {
      readonly: true,
    });
    const stored = database
      .prepare("SELECT status FROM tasks WHERE task_id = ?")
      .get(run.runId) as { status: string };
    database.close();
    assert.equal(stored.status, "cancelled");
    runtime = await startBackendRuntime({
      host: "127.0.0.1",
      port: 0,
      localApi: security,
      secretStore,
    });
    assertLoaded(runtime);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(model.calls(), 1);
    const original = await fetch(
      `${runtime.url}/api/modules/assistant/v1/runs/${run.runId}`,
      { headers: { "X-OpenPCB-Token": token } },
    );
    assert.equal(
      ((await original.json()) as { status: string }).status,
      "cancelled",
    );
    assert.ok((await readFile(path.join(root, "app.sqlite"))).length);
  } finally {
    await runtime?.close();
    await model.close();
  }
});

test("occupied listener startup disposes host so same AgentKit DB can reopen", async () => {
  const occupied = createServer();
  await listen(occupied);
  const address = occupied.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(
      startBackendRuntime({
        host: "127.0.0.1",
        port: address.port,
        localApi: security,
        secretStore,
      }),
      /EADDRINUSE/,
    );
    const runtime = await startBackendRuntime({
      host: "127.0.0.1",
      port: 0,
      localApi: security,
      secretStore,
    });
    assertLoaded(runtime);
    await runtime.close();
  } finally {
    await closeServer(occupied);
  }
});
