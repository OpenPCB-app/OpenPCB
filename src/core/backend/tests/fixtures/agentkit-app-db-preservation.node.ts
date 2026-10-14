import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SingleProcessTaskRunner } from "agentkit/runner-local";
import { startBackendRuntime, type StartedBackendRuntime } from "../../runtime";
import { resetSharedSqliteForTesting } from "../../db/sqlite-client";
import { buildCoreLibraryFixture } from "../helpers/core-library-fixture-data";

const root = await mkdtemp(path.join(os.tmpdir(), "openpcb-app-db-preservation-"));
const appDatabase = path.join(root, "app.sqlite");
const agentDatabase = path.join(root, "agentkit.sqlite");
process.env.NODE_ENV = "production";
process.env.OPENPCB_DB_PATH = appDatabase;
process.env.APP_DATA_DIR = root;
process.env.OPENPCB_WORKSPACE_ROOT = path.resolve("src");
process.env.OPENPCB_BUNDLED_LIBRARY_PATH = path.join(root, "core-library.opclib");
await writeFile(process.env.OPENPCB_BUNDLED_LIBRARY_PATH, buildCoreLibraryFixture());
const token = "d".repeat(64);
const secretStore = {
  get: async () => null, set: async () => {}, delete: async () => {}, listRefs: async () => [],
};
after(async () => { await rm(root, { recursive: true, force: true }); });

async function boot(): Promise<StartedBackendRuntime> {
  resetSharedSqliteForTesting();
  return startBackendRuntime({ host: "127.0.0.1", port: 0, secretStore,
    localApi: { token, rendererOrigins: ["http://127.0.0.1:1420"] } });
}

async function call(runtime: StartedBackendRuntime, route: string, body?: unknown) {
  const response = await fetch(`${runtime.url}/api/modules${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-OpenPCB-Token": token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/** Rows of every table the assistant does not own; its settings/credential rows may change by design. */
function applicationDigest(): Record<string, string> {
  const database = new Database(appDatabase, { readonly: true });
  try {
    const tables = (database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[])
      .map((row) => row.name).filter((name) => !name.startsWith("assistant_") && !name.startsWith("sqlite_"));
    return Object.fromEntries(tables.map((name) => [name, createHash("sha256")
      .update(JSON.stringify(database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all())).digest("hex")]));
  } finally { database.close(); }
}

async function fileDigests(directory = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await fileDigests(file));
    else if (!/^(app|agentkit)\.sqlite/.test(entry.name)) {
      result[path.relative(root, file)] = createHash("sha256").update(await readFile(file)).digest("hex");
    }
  }
  return result;
}

async function snapshot() {
  return { rows: applicationDigest(), files: await fileDigests() };
}

async function assertDesignsUsable(runtime: StartedBackendRuntime, designId: string): Promise<void> {
  const designer = runtime.snapshot.modules.find((module) => module.id === "designer");
  assert.equal(designer?.status, "loaded", designer?.reason);
  const design = await call(runtime, `/designer/designs/${designId}`);
  assert.equal(design.status, 200, JSON.stringify(design.body));
}

test("assistant init, induced failures and restart never change a populated application database", async () => {
  let runtime: StartedBackendRuntime | undefined;
  try {
    runtime = await boot();
    const created = await call(runtime, "/designer/designs", { name: "Preserved board" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const designId = String((created.body.data as { design: { id: string } }).design.id);
    assert.equal((await call(runtime, "/knowledge/pages", { title: "Preserved notes" })).status, 201);
    assert.equal((await call(runtime, "/assistant/v1/chats", { title: "Assistant history" })).status, 201);
    await runtime.close(); runtime = undefined;
    const baseline = await snapshot();
    assert.ok(Object.keys(baseline.rows).some((name) => name.startsWith("designer_")));
    assert.ok(Object.keys(baseline.rows).some((name) => name.startsWith("library_")));
    assert.ok(Object.keys(baseline.rows).some((name) => name.startsWith("knowledge_")));

    runtime = await boot();
    assert.deepEqual((await call(runtime, "/assistant/availability")).body, { available: true });
    await runtime.close(); runtime = undefined;
    assert.deepEqual(await snapshot(), baseline, "healthy restart");

    const healthyAssistant = await readFile(agentDatabase);
    const corrupt = Buffer.from("not an sqlite database ".repeat(400));
    await writeFile(agentDatabase, corrupt);
    runtime = await boot();
    const corruptState = (await call(runtime, "/assistant/availability")).body;
    assert.equal(corruptState.available, false);
    assert.equal(corruptState.code, "ASSISTANT_DATABASE_CORRUPT");
    assert.equal(corruptState.databasePath, agentDatabase);
    await assertDesignsUsable(runtime, designId);
    assert.equal((await call(runtime, "/assistant/v1/chats")).status, 404);
    // The Tasks monitor reads these routes; it must see the same reason, not a missing route.
    assert.equal(runtime.snapshot.modules.find((module) => module.id === "tasks")?.status, "loaded");
    const runs = await call(runtime, "/assistant/v1/runs?limit=50");
    assert.equal(runs.status, 503);
    assert.equal(runs.body.code, "ASSISTANT_DATABASE_CORRUPT");
    assert.equal(runs.body.detail, corruptState.message);
    await runtime.close(); runtime = undefined;
    assert.deepEqual(await readFile(agentDatabase), corrupt);
    assert.deepEqual(await snapshot(), baseline, "corrupt assistant database");

    await writeFile(agentDatabase, healthyAssistant);
    const startWorker = SingleProcessTaskRunner.prototype.startWorker;
    SingleProcessTaskRunner.prototype.startWorker = async () => { throw new Error("induced AgentKit worker failure"); };
    try {
      runtime = await boot();
      assert.equal((await call(runtime, "/assistant/availability")).body.code, "ASSISTANT_RUNTIME_FAILED");
      await assertDesignsUsable(runtime, designId);
      await runtime.close(); runtime = undefined;
    } finally { SingleProcessTaskRunner.prototype.startWorker = startWorker; }
    assert.deepEqual(await snapshot(), baseline, "induced host boot failure");

    runtime = await boot();
    assert.deepEqual((await call(runtime, "/assistant/availability")).body, { available: true });
    const chats = await call(runtime, "/assistant/v1/chats");
    assert.ok(JSON.stringify(chats.body).includes("Assistant history"));
    await runtime.close(); runtime = undefined;
    assert.deepEqual(await snapshot(), baseline, "restart after failures");
    assert.ok((await stat(agentDatabase)).size > 0);
  } finally {
    await runtime?.close();
  }
});
