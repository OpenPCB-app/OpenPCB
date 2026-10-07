import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { NodeSqliteAssistantStore } from "agentkit/adapters-sqlite-node";
import { CompletedOnlyProviderClient, HangingProviderClient } from "agentkit/testing";
import type { AiProviderConfig } from "agentkit/contracts";
import type { AiProviderClient } from "agentkit/core";
import { TurnRunner, type ProposalApplier } from "agentkit/host";
import { SingleProcessTaskRunner } from "agentkit/runner-local";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { createOpenPcbAgentKitHost, type OpenPcbAgentKitHost } from "../agentkit-host";
import { ProviderStore } from "../provider-store";
import { separateDatabasePath } from "./database-path";
import { startManualRecoverySweep } from "./recovery-sweep";
import { LOCAL_EXECUTION_BUDGETS, REMOTE_EXECUTION_BUDGETS } from "./budgets";

const nativeBinding = process.env.OPENPCB_AGENTKIT_TEST_NATIVE_BINDING;
const CANARY = "AGENTKIT_KEY_CANARY_773a8a12";
const applier: ProposalApplier = {
  apply: async () => { throw new Error("No domain apply expected in host tests"); },
  getOutcome: async () => null,
};

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "openpcb-agentkit-host-"));
  const database = new Database(join(directory, "openpcb.sqlite"), { nativeBinding });
  for (const name of readdirSync("src/modules/assistant/backend/migrations").filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(join("src/modules/assistant/backend/migrations", name), "utf8"));
  }
  const secrets = new Map<string, string>();
  const vault = {
    get: async (reference: string) => secrets.get(reference) ?? null,
    set: async (reference: string, value: string) => { secrets.set(reference, value); },
    delete: async (reference: string) => { secrets.delete(reference); },
    listRefs: async () => [...secrets.keys()],
  };
  const context: CoreBackendModuleContext = {
    moduleId: "assistant", manifest: {} as CoreBackendModuleContext["manifest"],
    db: { moduleId: "assistant", tablePrefix: "assistant_", db: database,
      rawSql<T>(query: string, params: unknown[] = []): T[] {
        const statement = database.prepare(query);
        if (statement.reader) return statement.all(...params) as T[];
        statement.run(...params); return [];
      },
      transaction: (operation) => database.transaction(() => operation(undefined))(),
    },
    sdk: { get: <T>() => vault as T, has: () => true, registerValue: () => {} },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  };
  return { directory, database, context, providers: new ProviderStore(context),
    nativeBinding, databasePath: join(directory, "agentkit.sqlite"), applicationDatabasePath: join(directory, "openpcb.sqlite"),
    cleanup: () => { database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

function completed(): AiProviderClient {
  const provider = new CompletedOnlyProviderClient();
  provider.setScript([{ content: "Host answer" }]);
  return provider;
}

async function waitTerminal(host: OpenPcbAgentKitHost, taskId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = await host.store.tasks.getTask(taskId);
    if (task && ["completed", "failed", "cancelled"].includes(task.status)) return task;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error("Task did not settle");
}

async function addProvider(providers: ProviderStore, model = "model-one") {
  return providers.createProvider({ label: "Fixture", kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:43101/v1", defaultModel: model, enabled: true, apiKey: CANARY });
}

test("real Node store pins provider endpoint, selected model and vault ref across rotation, clear, deletion, restart", async () => {
  const f = fixture();
  const blocker = new HangingProviderClient();
  const seen: AiProviderConfig[] = [];
  let host: OpenPcbAgentKitHost | undefined;
  try {
    const provider = await addProvider(f.providers);
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier,
      providerFactory: (config) => { seen.push(config); return config.defaultModel === "block" ? blocker : completed(); } });
    const first = await host.store.conversations.createChat({ id: "blocking-chat" });
    const second = await host.store.conversations.createChat({ id: "queued-chat" });
    const blocked = await host.submitMessage({ chatId: first.id, providerId: provider.id, model: "block", content: "wait" });
    await Promise.race([blocker.whenBlocking(), new Promise((_, reject) => setTimeout(() => reject(new Error("Blocker did not run")), 1500))]);
    const queued = await host.submitMessage({ chatId: second.id, providerId: provider.id, model: "selected-model", content: "answer", taskId: "pin-test" });
    const task = await host.store.tasks.getTask(queued.runId);
    const pinned = await host.store.providers.getProvider(String(task?.payload.providerId));
    assert.equal(pinned?.apiKey, undefined);
    assert.match(String(pinned?.metadata?.apiKeySecretRef), /^provider\//);
    await f.providers.updateProvider(provider.id, { apiKey: "replacement", baseUrl: "http://127.0.0.1:43102/v1", defaultModel: "replacement" });
    await f.providers.updateProvider(provider.id, { clearApiKey: true });
    await f.providers.deleteProvider(provider.id);
    await host.runner.requestCancel(blocked.runId);
    assert.equal((await waitTerminal(host, queued.runId)).status, "completed");
    assert.equal(seen[1]?.baseUrl, "http://127.0.0.1:43101/v1");
    assert.equal(seen[1]?.defaultModel, "selected-model");
    assert.equal(seen[1]?.apiKey, CANARY);
    assert.ok(!JSON.stringify(await host.store.tasks.getTask(queued.runId)).includes(CANARY));
    await host.close(); host = undefined;
    const bytes = readFileSync(f.databasePath);
    assert.ok(!bytes.includes(Buffer.from(CANARY)));
    const calls = seen.length;
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier,
      providerFactory: (config) => { seen.push(config); return completed(); } });
    const replay = await host.submitMessage({ chatId: second.id, providerId: provider.id, model: "selected-model", content: "answer", taskId: "pin-test" });
    assert.equal(replay.runId, queued.runId);
    assert.equal(seen.length, calls);
  } finally { await host?.close(); f.cleanup(); }
});

test("duplicate boot, unsafe metadata and changed or racing idempotent submissions fail closed", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  try {
    const provider = await addProvider(f.providers);
    const options = { ...f, contributors: [], proposalApplier: applier, providerFactory: completed };
    host = await createOpenPcbAgentKitHost(options);
    await assert.rejects(createOpenPcbAgentKitHost(options), /already running/);
    const chat = await host.store.conversations.createChat({ id: "replay-chat" });
    const input = { chatId: chat.id, providerId: provider.id, content: "same", taskId: "same-key" };
    const results = await Promise.all([host.submitMessage(input), host.submitMessage(input)]);
    assert.equal(results[0]?.runId, results[1]?.runId);
    await assert.rejects(host.submitMessage({ ...input, content: "changed" }), /different request/);
    await assert.rejects(host.submitMessage({ ...input, metadata: { apiKeySecretRef: "provider/hostile" } }), /Credential metadata/);
    await assert.rejects(host.submitMessage({ ...input, metadata: { nested: { secretRef: "hostile" } } }), /Credential metadata/);
    await host.close();
    await assert.rejects(host.submitMessage(input), /closed/);
    host = undefined;
    host = await createOpenPcbAgentKitHost(options);
  } finally { await host?.close(); f.cleanup(); }
});

test("failed boot cleanup preserves boot cause, closes SQLite and releases canonical path", async () => {
  const f = fixture();
  const startWorker = SingleProcessTaskRunner.prototype.startWorker;
  const dispose = TurnRunner.prototype.disposeContributors;
  const close = NodeSqliteAssistantStore.prototype.close;
  let closes = 0;
  const bootError = new Error("injected worker boot failure");
  try {
    SingleProcessTaskRunner.prototype.startWorker = async () => { throw bootError; };
    TurnRunner.prototype.disposeContributors = async () => { throw new Error("injected disposal failure"); };
    NodeSqliteAssistantStore.prototype.close = function () { closes++; return close.call(this); };
    await assert.rejects(createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier }),
      (error: unknown) => error instanceof AggregateError && error.cause === bootError);
    assert.equal(closes, 1);
    SingleProcessTaskRunner.prototype.startWorker = startWorker;
    TurnRunner.prototype.disposeContributors = dispose;
    const reopened = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier });
    await reopened.close();
  } finally {
    SingleProcessTaskRunner.prototype.startWorker = startWorker;
    TurnRunner.prototype.disposeContributors = dispose;
    NodeSqliteAssistantStore.prototype.close = close;
    f.cleanup();
  }
});

test("shutdown cleanup failure still closes SQLite and permits a new host", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  try {
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier });
    host.turns.disposeContributors = async () => { throw new Error("injected disposal failure"); };
    const closed = host.close();
    assert.equal(host.close(), closed);
    await assert.rejects(closed, /AgentKit host shutdown failed/);
    host = undefined;
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier });
  } finally { await host?.close(); f.cleanup(); }
});

test("manual boot interrupts queued work without provider inference; cancel shutdown settles before native close", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  const provider = new HangingProviderClient();
  let calls = 0;
  try {
    const persisted = new NodeSqliteAssistantStore(f.databasePath, { nativeBinding });
    await persisted.tasks.createTask({ taskId: "old-queued", kind: "chat.turn", scopeId: "old-chat", payload: {} });
    persisted.close();
    const config = await addProvider(f.providers);
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier,
      providerFactory: () => { calls++; return provider; } });
    assert.equal((await host.store.tasks.getTask("old-queued"))?.status, "interrupted");
    assert.equal(calls, 0);
    const chat = await host.store.conversations.createChat({ id: "cancel-chat" });
    const run = await host.submitMessage({ chatId: chat.id, providerId: config.id, content: "hold" });
    await Promise.race([provider.whenBlocking(), new Promise((_, reject) => setTimeout(() => reject(new Error("Provider did not run")), 1500))]);
    await host.close(); host = undefined;
    const reopened = new NodeSqliteAssistantStore(f.databasePath, { nativeBinding });
    assert.equal((await reopened.tasks.getTask(run.runId))?.status, "cancelled");
    reopened.close();
  } finally { await host?.close(); f.cleanup(); }
});

test("app budget profiles and real TurnRunner enforce cumulative transport request cap", async () => {
  assert.deepEqual(REMOTE_EXECUTION_BUDGETS, { overallMs: 600000, providerRequests: 24,
    toolCalls: 64, correctionPasses: 3, toolMs: 60000, firstByteMs: 60000, streamIdleMs: 60000 });
  assert.equal(LOCAL_EXECUTION_BUDGETS.firstByteMs, 180000);
  assert.equal(LOCAL_EXECUTION_BUDGETS.streamIdleMs, 90000);
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  let requests = 0;
  try {
    const provider = await addProvider(f.providers);
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier,
      providerFactory: () => ({ ...completed(), id: "counter", kind: "openai-compatible", tracksTransportRequests: true,
        capabilities: async () => ({ streaming: true, toolCalling: true, modelList: false }), listModels: async () => [],
        async *streamChat(input) { for (let i = 0; i < 25; i++) { await input.beforeRequest?.(); requests++; } } }),
    });
    const chat = await host.store.conversations.createChat({ id: "budget-chat" });
    const run = await host.submitMessage({ chatId: chat.id, providerId: provider.id, content: "cap" });
    assert.equal((await waitTerminal(host, run.runId)).status, "failed");
    assert.equal(requests, 24);
    const task = await host.store.tasks.getTask(run.runId);
    assert.match(JSON.stringify(task), /execution_budget_exhausted|providerRequests/);
  } finally { await host?.close(); f.cleanup(); }
});

test("pinned effective tool capability honors manual on/off despite opposing probe values", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  try {
    const provider = await addProvider(f.providers);
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier, providerFactory: completed });
    for (const mode of ["on", "off"] as const) {
      f.providers.saveCapabilities(provider.id, { streaming: true, modelList: true, toolCalling: mode === "off" });
      f.providers.setToolCallingMode(provider.id, mode);
      const chat = await host.store.conversations.createChat({ id: `capability-${mode}` });
      const run = await host.submitMessage({ chatId: chat.id, providerId: provider.id, content: mode });
      const task = await host.store.tasks.getTask(run.runId);
      const capabilities = await host.store.providers.getCapabilities(String(task?.payload.providerId));
      assert.equal(capabilities?.toolCalling, mode === "on");
      await waitTerminal(host, run.runId);
    }
  } finally { await host?.close(); f.cleanup(); }
});

test("failed contributor boot closes native store; separate database and symlink aliases fail closed", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  try {
    const options = { ...f, contributors: [], proposalApplier: applier, providerFactory: completed };
    await assert.rejects(createOpenPcbAgentKitHost({ ...options, databasePath: f.applicationDatabasePath }), /separate database/);
    await assert.rejects(createOpenPcbAgentKitHost({ ...options, contributors: () => { throw new Error("synthetic contributor boot failure"); } }), /synthetic contributor boot failure/);
    host = await createOpenPcbAgentKitHost(options);
    const { symlinkSync } = await import("node:fs");
    const alias = join(f.directory, "alias.sqlite");
    symlinkSync(f.databasePath, alias);
    await assert.rejects(createOpenPcbAgentKitHost({ ...options, databasePath: alias }), /already running/);
  } finally { await host?.close(); f.cleanup(); }
});

test("stalled credential snapshot cannot block cancel shutdown or later write into closed AgentKit store", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  try {
    const provider = await addProvider(f.providers);
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier, providerFactory: completed });
    const chat = await host.store.conversations.createChat({ id: "stalled-pin" });
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const snapshotStarted = new Promise<void>((resolve) => { entered = resolve; });
    const original = host.providers.snapshotProvider.bind(host.providers);
    host.providers.snapshotProvider = async (id) => {
      entered?.();
      await new Promise<void>((resolve) => { release = resolve; });
      return original(id);
    };
    const submit = host.submitMessage({ chatId: chat.id, providerId: provider.id, content: "blocked" });
    const rejected = assert.rejects(submit, /closed/);
    await snapshotStarted;
    await host.close(); host = undefined;
    await rejected;
    release?.();
    await new Promise((done) => setTimeout(done, 5));
    const store = new NodeSqliteAssistantStore(f.databasePath, { nativeBinding });
    assert.equal((await store.tasks.listByScope(chat.id)).length, 0);
    store.close();
  } finally { await host?.close(); f.cleanup(); }
});

test("future native schema refusal preserves bytes and releases duplicate-boot reservation", async () => {
  const f = fixture();
  try {
    const future = new Database(f.databasePath, { nativeBinding });
    future.exec("CREATE TABLE future_sentinel (value TEXT); INSERT INTO future_sentinel VALUES ('preserve'); PRAGMA user_version = 99");
    future.close();
    const before = readFileSync(f.databasePath);
    const options = { ...f, contributors: [], proposalApplier: applier, providerFactory: completed };
    await assert.rejects(createOpenPcbAgentKitHost(options), /schema|version/i);
    assert.deepEqual(readFileSync(f.databasePath), before);
    await assert.rejects(createOpenPcbAgentKitHost(options), /schema|version/i);
    const verify = new Database(f.databasePath, { nativeBinding });
    assert.equal((verify.prepare("SELECT value FROM future_sentinel").get() as { value: string }).value, "preserve");
    verify.close();
  } finally { f.cleanup(); }
});

test("transport request budget remains cumulative across correction passes", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  let requests = 0;
  let verificationCalls = 0;
  const script = new CompletedOnlyProviderClient();
  script.setScript([
    { content: "", toolCalls: [{ id: "read-first", name: "host_read", argumentsJson: "{}" }] },
    { content: "Initial answer" }, { content: "Correction one" }, { content: "Correction two" },
  ]);
  try {
    const config = await addProvider(f.providers);
    host = await createOpenPcbAgentKitHost({ ...f, proposalApplier: applier,
      contributors: [{ namespace: "openpcb", contribute: async () => [{
        definition: { name: "host_read", version: "1", effect: "read", capability: "host.read", description: "Read synthetic host fixture",
          inputSchema: { type: "object", properties: {}, additionalProperties: false } },
        execute: async (context) => ({ ok: true, data: {}, summary: "Synthetic host read", sources: [], warnings: [], truncated: false, limits: context.limits }),
      }] }],
      verification: { verify: async () => { verificationCalls++;
        return { status: "partial", checks: [], deficiencies: Array.from({ length: 5 - verificationCalls }, (_, i) => `Missing ${i}`) }; } },
      providerFactory: () => ({ id: "correction-counter", kind: "openai-compatible", tracksTransportRequests: true,
        capabilities: () => script.capabilities(), listModels: () => script.listModels(),
        async *streamChat(input) {
          for (let i = 0; i < 7; i++) { await input.beforeRequest?.(); requests++; }
          yield* script.streamChat(input);
        } }),
    });
    const tools = await host.toolCatalog.listTools();
    assert.deepEqual(tools.map((tool) => [tool.namespace, tool.definition.name]), [["openpcb", "host_read"]]);
    const chat = await host.store.conversations.createChat({ id: "cumulative-chat" });
    const run = await host.submitMessage({ chatId: chat.id, providerId: config.id, content: "correct" });
    assert.equal((await waitTerminal(host, run.runId)).status, "failed");
    assert.ok(verificationCalls >= 2);
    assert.equal(requests, 24);
  } finally { await host?.close(); f.cleanup(); }
});

test("all five providers use real AgentKit transport; authorization echoes never persist", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  try {
    globalThis.fetch = (async (_request: unknown, options?: RequestInit) => {
      requests.push(new Headers(options?.headers).get("authorization") ?? "");
      return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: CANARY }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier });
    for (const kind of ["openai", "openrouter", "openai-compatible", "lmstudio", "omlx"] as const) {
      const provider = await f.providers.createProvider({ label: kind, kind, baseUrl: "http://127.0.0.1:43101/v1", defaultModel: "model-one", apiKey: CANARY });
      f.providers.saveCapabilities(provider.id, { streaming: true, toolCalling: false, modelList: false });
      const chat = await host.store.conversations.createChat({ id: `transport-${kind}` });
      const run = await host.submitMessage({ chatId: chat.id, providerId: provider.id, content: "echo" });
      assert.equal((await waitTerminal(host, run.runId)).status, "completed");
      const message = await host.store.conversations.getMessage(run.assistantMessageId);
      assert.equal(message?.content, "[REDACTED]");
      await f.providers.deleteProvider(provider.id);
    }
    assert.deepEqual(requests, Array.from({ length: 5 }, () => `Bearer ${CANARY}`));
    await host.close(); host = undefined;
    assert.ok(!readFileSync(f.databasePath).includes(Buffer.from(CANARY)));
  } finally { globalThis.fetch = previousFetch; await host?.close(); f.cleanup(); }
});

test("local provider without configured key works without trusted vault", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  try {
    const provider = await f.providers.createProvider({ label: "No key", kind: "lmstudio", baseUrl: "http://127.0.0.1:43101/v1", defaultModel: "local" });
    f.context.sdk.get = () => null;
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier, providerFactory: completed });
    const chat = await host.store.conversations.createChat({ id: "local-no-vault" });
    const run = await host.submitMessage({ chatId: chat.id, providerId: provider.id, content: "local" });
    assert.equal((await waitTerminal(host, run.runId)).status, "completed");
  } finally { await host?.close(); f.cleanup(); }
});

test("unset/test environment resolves actual home application database; aliases cannot become AgentKit database", async () => {
  const previousMode = process.env.NODE_ENV;
  const previousPath = process.env.OPENPCB_DB_PATH;
  try {
    delete process.env.OPENPCB_DB_PATH;
    for (const mode of [undefined, "test", "production"] as const) {
      if (mode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = mode;
      await assert.rejects(separateDatabasePath(join(homedir(), ".openpcb/data.sqlite")), /separate database/);
    }
    process.env.OPENPCB_DB_PATH = "";
    process.env.NODE_ENV = "test";
    await assert.rejects(separateDatabasePath(join(homedir(), ".openpcb/data.sqlite")), /separate database/);
    process.env.NODE_ENV = "development";
    await assert.rejects(separateDatabasePath("dev-data/openpcb.sqlite"), /separate database/);
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
    if (previousPath === undefined) delete process.env.OPENPCB_DB_PATH; else process.env.OPENPCB_DB_PATH = previousPath;
  }
});

test("fresh crash lease waits for expiry then manual sweep interrupts with zero model calls", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  let sweep: ReturnType<typeof startManualRecoverySweep> | undefined;
  let instant = Date.now();
  const clock = { now: () => new Date(instant), nowIso: () => new Date(instant).toISOString() };
  let calls = 0;
  try {
    const persisted = new NodeSqliteAssistantStore(f.databasePath, { clock, nativeBinding });
    await persisted.tasks.createTask({ taskId: "crashed-running", kind: "chat.turn", scopeId: "crashed-chat", payload: {} });
    const claimed = await persisted.tasks.claimNext({ ownerId: "dead-process", now: clock.now(), scopesBusy: [] });
    assert.equal(claimed?.task.taskId, "crashed-running");
    persisted.close();
    host = await createOpenPcbAgentKitHost({ ...f, clock, contributors: [], proposalApplier: applier,
      providerFactory: () => { calls++; return completed(); } });
    assert.equal((await host.store.tasks.getTask("crashed-running"))?.status, "running");
    sweep = startManualRecoverySweep(host.runner, undefined, 5);
    instant += 40_000;
    for (let i = 0; i < 100; i++) {
      if ((await host.store.tasks.getTask("crashed-running"))?.status === "interrupted") break;
      await new Promise((done) => setTimeout(done, 5));
    }
    assert.equal((await host.store.tasks.getTask("crashed-running"))?.status, "interrupted");
    assert.equal(calls, 0);
  } finally { await sweep?.stop(); await host?.close(); f.cleanup(); }
});

test("split raw/URI credential echoes cannot be reconstructed from real durable delta replay", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  const previousFetch = globalThis.fetch;
  const secret = `${CANARY}+/=é`;
  let representation = secret;
  try {
    globalThis.fetch = (async (_request: unknown, _options?: RequestInit) => {
      const chunks = ["before ", ...representation, " after"];
      const frames = chunks.map((content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`).join("");
      return new Response(`${frames}data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const provider = await f.providers.createProvider({ label: "Split echo", kind: "openai-compatible", baseUrl: "http://127.0.0.1:43101/v1", defaultModel: "model", apiKey: secret });
    f.providers.saveCapabilities(provider.id, { streaming: true, toolCalling: false, modelList: false });
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier });
    for (const encoded of [false, true]) {
      representation = encoded ? encodeURIComponent(secret) : secret;
      const chat = await host.store.conversations.createChat({ id: `split-key-${encoded}` });
      const run = await host.submitMessage({ chatId: chat.id, providerId: provider.id, content: "echo" });
      assert.equal((await waitTerminal(host, run.runId)).status, "completed");
      const events = await host.store.tasks.listEvents(run.runId, { limit: 1000 });
      const deltas = events.filter((event) => event.type === "run.message.delta")
        .map((event) => (event as unknown as { data: { delta: string } }).data.delta).join("");
      assert.equal(deltas, "before [REDACTED] after");
      assert.ok(!JSON.stringify(events).includes(secret));
      assert.ok(!JSON.stringify(events).includes(encodeURIComponent(secret)));
      assert.equal((await host.store.conversations.getMessage(run.assistantMessageId))?.content, deltas);
    }
    await host.close(); host = undefined;
    assert.ok(!readFileSync(f.databasePath).includes(Buffer.from(secret)));
  } finally { globalThis.fetch = previousFetch; await host?.close(); f.cleanup(); }
});
