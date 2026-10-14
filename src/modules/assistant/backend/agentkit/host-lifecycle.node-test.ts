import assert from "node:assert/strict";
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import type { ModuleRouteHandler, ModuleRouterHandle } from "../../../../core/contracts/modules/backend-module";
import { createOpenPcbAgentKitHost, type OpenPcbAgentKitHost } from "../agentkit-host";
import { createAssistantModuleDefinition } from "../index";
import { AGENTKIT_MONITOR_TOKEN, type TasksSDK } from "../../../../sdks/tasks";
import { addProvider, applier, completed, fixture, nativeBinding, waitTerminal } from "./host-test-fixture";

type Damage = (path: string, healthy: Buffer) => void;
const DAMAGE: Array<{ name: string; code: string; damage: Damage }> = [
  { name: "corrupt bytes", code: "ASSISTANT_DATABASE_CORRUPT",
    damage: (path, healthy) => writeFileSync(path, Buffer.concat([healthy.subarray(0, 100), Buffer.alloc(healthy.length - 100, 0xa5)])) },
  { name: "truncated", code: "ASSISTANT_DATABASE_CORRUPT",
    damage: (path, healthy) => writeFileSync(path, healthy.subarray(0, 1500)) },
  { name: "not a database", code: "ASSISTANT_DATABASE_CORRUPT",
    damage: (path) => writeFileSync(path, "assistant history exported as plain text\n".repeat(200)) },
  { name: "unreadable", code: "ASSISTANT_DATABASE_UNREADABLE",
    damage: (path) => chmodSync(path, 0o000) },
];

function capturingRouter() {
  const routes = new Map<string, ModuleRouteHandler>();
  const add = (method: string) => (path: string, handler: ModuleRouteHandler) => { routes.set(`${method} ${path}`, handler); };
  const router: ModuleRouterHandle = { get: add("GET"), post: add("POST"), put: add("PUT"), patch: add("PATCH"), delete: add("DELETE") };
  return { routes, router };
}

test("damaged or unreadable agentkit.sqlite degrades the assistant module and is never rewritten", async (t) => {
  for (const { name, code, damage } of DAMAGE) {
    if (name === "unreadable" && process.getuid?.() === 0) { t.diagnostic("root ignores file modes; unreadable case skipped"); continue; }
    const f = fixture();
    const options = { ...f, contributors: [], proposalApplier: applier, providerFactory: completed };
    try {
      await (await createOpenPcbAgentKitHost(options)).close();
      const healthy = readFileSync(f.databasePath);
      damage(f.databasePath, healthy);
      const mode = statSync(f.databasePath).mode;
      const bytes = name === "unreadable" ? healthy : readFileSync(f.databasePath);
      await assert.rejects(createOpenPcbAgentKitHost(options), name);

      const definition = createAssistantModuleDefinition({ agentkit: {
        databasePath: f.databasePath, applicationDatabasePath: f.applicationDatabasePath, nativeBinding } });
      const registered = new Map<string, unknown>();
      const context = { ...f.context, sdk: { ...f.context.sdk,
        registerValue: (token: string, value: unknown) => { registered.set(token, value); } } };
      await definition.onActivate!(context);
      const { routes, router } = capturingRouter();
      await definition.registerRoutes!(router, context);
      assert.deepEqual([...routes.keys()], ["GET /availability", "GET /v1/runs", "GET /v1/runs/:runId",
        "POST /v1/runs/:runId/cancel", "POST /v1/runs/:runId/resume"], name);
      const availability = await (await routes.get("GET /availability")!({} as never)).json() as Record<string, unknown>;
      assert.equal(availability.available, false, name);
      assert.equal(availability.code, code, name);
      assert.equal(availability.databasePath, f.databasePath, name);
      assert.match(String(availability.message), /Designs and libraries are unaffected; the file was left in place/, name);
      const runs = await routes.get("GET /v1/runs")!({ req: new Request("http://127.0.0.1/api/modules/assistant/v1/runs") } as never);
      assert.equal(runs.status, 503, name);
      assert.equal(runs.headers.get("content-type"), "application/problem+json", name);
      assert.deepEqual(await runs.json(), { type: "https://openpcb.dev/problems/assistant-unavailable",
        title: "Assistant unavailable", status: 503, detail: availability.message,
        instance: "/api/modules/assistant/v1/runs", code, databasePath: f.databasePath }, name);
      const monitor = registered.get(AGENTKIT_MONITOR_TOKEN) as TasksSDK | undefined;
      await assert.rejects(monitor!.listTasks(), (error: unknown) => error instanceof Error
        && (error as Error & { code?: string }).code === code && error.message === availability.message, name);
      assert.deepEqual([...registered.keys()], [AGENTKIT_MONITOR_TOKEN], name);
      await definition.onDeactivate!(f.context);

      assert.equal(statSync(f.databasePath).mode, mode, name);
      if (name === "unreadable") chmodSync(f.databasePath, 0o600);
      assert.deepEqual(readFileSync(f.databasePath), bytes, name);
      if (name === "unreadable") await (await createOpenPcbAgentKitHost(options)).close();
    } finally { f.cleanup(); }
  }
});

function activeResources(): string[] {
  return process.getActiveResourcesInfo().filter((type) => type !== "TTYWrap").sort();
}

function listenerCounts(): Record<string, number> {
  return Object.fromEntries(process.eventNames().map((event) => [String(event), process.listenerCount(event)]));
}

/** AgentKit unrefs its timers, so they never show up as active resources; track them directly. */
function trackTimers() {
  const original = { setTimeout, setInterval, clearTimeout, clearInterval };
  const live = new Map<unknown, string>();
  globalThis.setInterval = ((handler: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const timer = original.setInterval(handler, ms, ...args);
    live.set(timer, `interval ${ms}`);
    return timer;
  }) as typeof setInterval;
  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const timer = original.setTimeout((...values: unknown[]) => { live.delete(timer); handler(...values); }, ms, ...args);
    live.set(timer, `timeout ${ms}`);
    return timer;
  }) as typeof setTimeout;
  globalThis.clearInterval = ((timer: Parameters<typeof clearInterval>[0]) => { live.delete(timer); original.clearInterval(timer); }) as typeof clearInterval;
  globalThis.clearTimeout = ((timer: Parameters<typeof clearTimeout>[0]) => { live.delete(timer); original.clearTimeout(timer); }) as typeof clearTimeout;
  return {
    live,
    pause: (ms: number) => new Promise<void>((resolve) => original.setTimeout(resolve, ms)),
    restore: () => { Object.assign(globalThis, original); },
  };
}

test("repeated boot, run and close leave no live handles, timers, listeners or path reservations", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  const timers = trackTimers();
  try {
    const provider = await addProvider(f.providers);
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    await settle();
    const resources = activeResources();
    const listeners = listenerCounts();
    for (let cycle = 0; cycle < 5; cycle++) {
      host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier, providerFactory: completed });
      const chat = await host.store.conversations.createChat({ id: `leak-${cycle}` });
      const run = await host.submitMessage({ chatId: chat.id, providerId: provider.id, content: "cycle" });
      assert.equal((await waitTerminal(host, run.runId)).status, "completed");
      assert.ok([...timers.live.values()].some((kind) => kind.startsWith("interval")), "host timers are tracked");
      await host.close(); host = undefined;
      await settle();
      assert.deepEqual([...timers.live.values()].filter((kind) => kind.startsWith("interval")), [], `cycle ${cycle} intervals`);
      for (let wait = 0; wait < 100 && timers.live.size; wait++) await timers.pause(20);
      assert.deepEqual([...timers.live.values()], [], `cycle ${cycle} timeouts`);
      assert.deepEqual(activeResources(), resources, `cycle ${cycle} resources`);
      assert.deepEqual(listenerCounts(), listeners, `cycle ${cycle} listeners`);
    }
  } finally { timers.restore(); await host?.close(); f.cleanup(); }
});
