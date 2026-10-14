import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { format } from "node:util";
import { gunzipSync } from "node:zlib";
import { createServer, type IncomingMessage, type Server } from "node:http";
import electronLog from "electron-log/node";
import { startBackendRuntime, type StartedBackendRuntime } from "../../runtime";
import { captureBackendException, initBackendSentry } from "../../sentry";
import { buildCoreLibraryFixture } from "../helpers/core-library-fixture-data";

const CANARY = "OPENPCB_SECRET_CANARY_5c1e9a/%+=never-real";
const ROTATED = `${CANARY}-rotated`;
const SECRETS = [CANARY, ROTATED].flatMap((value) => [value, encodeURIComponent(value)]);
const token = "c".repeat(64);
const root = await mkdtemp(path.join(os.tmpdir(), "openpcb-secret-canary-"));
const captured: string[] = [];
const envelopes: string[] = [];
const sentry = await listen(createServer(async (request, response) => {
  const body = await readBody(request);
  envelopes.push((request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body).toString("utf8"));
  response.writeHead(200, { "content-type": "application/json" });
  response.end("{}");
}));

process.env.NODE_ENV = "production";
process.env.OPENPCB_DB_PATH = path.join(root, "app.sqlite");
process.env.APP_DATA_DIR = root;
process.env.OPENPCB_WORKSPACE_ROOT = path.resolve("src");
process.env.OPENPCB_BUNDLED_LIBRARY_PATH = path.join(root, "core-library.opclib");
process.env.OPENPCB_TELEMETRY_OPT_IN = "1";
process.env.OPENPCB_SENTRY_DSN = `http://canarypublickey@127.0.0.1:${sentry.port}/1`;
await writeFile(process.env.OPENPCB_BUNDLED_LIBRARY_PATH, buildCoreLibraryFixture());
assert.equal(initBackendSentry(), true);
// Electron main routes console into electron-log's file transport (electron/src/main/logger.ts);
// mirror that so the on-disk main.log a user attaches to a bug report is covered too.
const electronLogFile = path.join(root, "logs", "main.log");
electronLog.transports.file.resolvePathFn = () => electronLogFile;
electronLog.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}";
electronLog.transports.file.level = "debug";
electronLog.transports.console.level = false;
for (const level of ["log", "info", "warn", "error", "debug"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    captured.push(format(...args));
    electronLog.functions[level](...args);
    if (process.env.OPENPCB_CANARY_VERBOSE) original(...args);
  };
}

const vault = new Map<string, string>();
const secretStore = {
  get: async (reference: string) => vault.get(reference) ?? null,
  set: async (reference: string, secret: string) => { vault.set(reference, secret); },
  delete: async (reference: string) => { vault.delete(reference); },
  listRefs: async () => [...vault.keys()],
};

after(async () => {
  await sentry.close();
  await rm(root, { recursive: true, force: true });
});

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

/** Echoes whatever credential it receives so every downstream surface sees the raw key. */
async function echoingProvider() {
  let mode: "reject" | "content" = "reject";
  const server = await listen(createServer(async (request, response) => {
    await readBody(request);
    const authorization = request.headers.authorization ?? "";
    if (mode === "content" && request.url?.endsWith("/chat/completions")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      const frame = (delta: Record<string, unknown>, finish: string | null) =>
        `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      response.end(`${frame({ content: `echo ${authorization}` }, null)}${frame({}, "stop")}data: [DONE]\n\n`);
      return;
    }
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: {
      message: `Rejected ${authorization} ${encodeURIComponent(authorization)}`, headers: { authorization },
    } }));
  }));
  return { ...server, baseUrl: `http://127.0.0.1:${server.port}/v1`, setMode: (next: typeof mode) => { mode = next; } };
}

function api(runtime: StartedBackendRuntime, responses: string[]) {
  let key = 0;
  return async (route: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await fetch(`${runtime.url}/api/modules/assistant${route}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { "X-OpenPCB-Token": token, "content-type": "application/json", "Idempotency-Key": `canary-${key++}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    responses.push(text);
    return { status: response.status, json: () => JSON.parse(text) as Record<string, unknown> };
  };
}

async function runTurn(request: ReturnType<typeof api>, providerId: string): Promise<Record<string, unknown>> {
  const chat = (await request("/v1/chats", { body: { title: "Canary" } })).json();
  const submitted = await request(`/v1/chats/${String(chat.id)}/messages`, { body: { content: "echo", providerId } });
  assert.equal(submitted.status, 201);
  const runId = String(submitted.json().runId);
  for (let attempt = 0; attempt < 400; attempt++) {
    const run = (await request(`/v1/runs/${runId}`)).json();
    if (["completed", "failed", "cancelled"].includes(String(run.status))) {
      await request(`/v1/chats/${String(chat.id)}/messages`);
      await request(`/v1/chats/${String(chat.id)}/tool-events`);
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Canary run did not settle");
}

function assertClean(surface: string, text: string): void {
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${surface} leaked a provider credential`);
}

test("credential lifecycle and provider echoes never reach logs, diagnostics, Sentry or public responses", async () => {
  const provider = await echoingProvider();
  const responses: string[] = [];
  let runtime: StartedBackendRuntime | undefined;
  try {
    runtime = await startBackendRuntime({ host: "127.0.0.1", port: 0, secretStore,
      localApi: { token, rendererOrigins: ["http://127.0.0.1:1420"] } });
    const credentials = runtime.providerCredentials;
    assert.ok(credentials);
    const request = api(runtime, responses);
    const created = await request("/v1/providers", { body: { kind: "openai-compatible", label: "Canary",
      baseUrl: provider.baseUrl, defaultModel: "canary-model", enabled: true } });
    assert.equal(created.status, 201);
    const providerId = String(created.json().id);
    assert.deepEqual(await credentials.set(providerId, CANARY), { configured: true });
    assert.deepEqual(await credentials.status(providerId), { configured: true });

    assert.equal((await request(`/v1/providers/${providerId}/test`, { body: {} })).status, 200);
    assert.equal((await request(`/providers/${providerId}/test`, { body: { includeCompletion: true } })).status, 200);
    assert.equal((await request(`/v1/providers/${providerId}/models/refresh`, { body: {} })).status, 500);
    assert.equal((await request(`/v1/providers/${providerId}/capabilities/refresh`, { body: {} })).status, 200);
    assert.equal((await runTurn(request, providerId)).status, "failed");
    provider.setMode("content");
    assert.equal((await runTurn(request, providerId)).status, "completed");

    assert.deepEqual(await credentials.set(providerId, ROTATED), { configured: true });
    provider.setMode("reject");
    assert.equal((await runTurn(request, providerId)).status, "failed");
    assert.deepEqual(await credentials.clear(providerId), { configured: false });
    await request("/v1/providers");
    await request("/v1/settings");
    await fetch(`${runtime.url}/api/modules/assistant-missing/route`, {
      headers: { "X-OpenPCB-Token": token, authorization: `Bearer ${CANARY}` },
    });

    const sentryApi = createRequire(import.meta.url)("@sentry/node") as {
      addBreadcrumb(breadcrumb: Record<string, unknown>): void; flush(timeout: number): Promise<boolean>;
    };
    sentryApi.addBreadcrumb({ message: `Authorization: Bearer ${CANARY}`, data: { apiKey: CANARY } });
    captureBackendException(new Error(`upstream rejected Authorization: Bearer ${CANARY}`), { requestId: "canary" });
    assert.equal(await sentryApi.flush(5000), true);

    const diagnostics = await fetch(`${runtime.url}/api/diagnostics`, { headers: { "X-OpenPCB-Token": token } });
    const diagnosticsText = await diagnostics.text();
    assert.equal(diagnostics.status, 200);
    assert.ok((JSON.parse(diagnosticsText) as { data: { errorCount: number } }).data.errorCount >= 1);
    await runtime.close();
    runtime = undefined;

    assert.ok(captured.some((line) => line.includes('"message":"assistant activated"')),
      "backend JSON logger output was not captured");
    assert.ok(envelopes.some((envelope) => envelope.includes("upstream rejected")), "Sentry event was not delivered");
    assert.ok(envelopes.some((envelope) => envelope.includes("[REDACTED]")));
    assertClean("logger", captured.join("\n"));
    const electronLogText = await readFile(electronLogFile, "utf8");
    assert.ok(electronLogText.includes('"message":"assistant activated"'), "electron-log file output was not captured");
    assertClean("electron-log file", electronLogText);
    assertClean("diagnostics", diagnosticsText);
    assertClean("sentry", envelopes.join("\n"));
    assertClean("public API", responses.join("\n"));
    for (const file of ["app.sqlite", "app.sqlite-wal", "agentkit.sqlite", "agentkit.sqlite-wal"]) {
      const bytes = await readFile(path.join(root, file)).catch(() => null);
      if (bytes) assertClean(file, bytes.toString("latin1"));
    }
  } finally {
    await runtime?.close();
    await provider.close();
  }
});
