import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { Value } from "@sinclair/typebox/value";
import { ProviderDtoSchema, SettingsDtoSchema, ModelDtoSchema } from "agentkit/contracts";
import { createAgentKitClient } from "agentkit/client";
import { isolatedHttpDomain, waitUntil } from "./agentkit-http-domain";
import { PROVIDER_PROBE_TIMEOUT_MS } from "../../../../modules/assistant/backend/agentkit/provider-preferences";

const KEY = "fixture-provider-key/%+never-real";
const JSON_HEADERS = { "content-type": "application/json" };
const payload = (body: unknown, method = "POST"): RequestInit => ({
  method, headers: JSON_HEADERS, body: JSON.stringify(body),
});

async function modelEndpoint() {
  const requests: Array<{ url: string; authorization: string | undefined; body: unknown }> = [];
  let fail = false;
  let gate: Promise<void> | undefined;
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({ url: req.url ?? "", authorization: req.headers.authorization,
      body: body ? JSON.parse(body) : null });
    await gate;
    res.setHeader("content-type", "application/json");
    if (fail) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: `Rejected ${KEY} ${encodeURIComponent(KEY)}` } }));
    } else if (req.url === "/v1/models") {
      res.end(JSON.stringify({ data: [{ id: "fixture-b" }, { id: "fixture-a" }, { id: "fixture-b" }] }));
    } else {
      res.end(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: {
        tool_calls: [{ id: "probe", type: "function", function: { name: "echo", arguments: '{"text":"ok"}' } }],
      } }] }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests,
    fail: () => { fail = true; },
    block: () => {
      const before = requests.length;
      let release!: () => void;
      gate = new Promise<void>((resolve) => { release = resolve; });
      return { release, wait: () => waitUntil(() => requests.length > before) };
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }) };
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return body;
}

test("Provider REST rejects credential claims before mutation or transport", async () => {
  const domain = await isolatedHttpDomain();
  const endpoint = await modelEndpoint();
  try {
    const before = domain.service.host.providers.listProviders();
    for (const prefix of ["", "/v1"]) {
      for (const field of ["apiKey", "clearApiKey", "secretRef", "apiKeySecretRef", "metadata", "extraHeaders"]) {
        const claim = { [field]: field === "metadata" ? { apiKeySecretRef: "provider/forged" } : KEY };
        for (const [route, method] of [
          [`${prefix}/providers`, "POST"], [`${prefix}/providers/lmstudio`, "PATCH"],
          [`${prefix}/providers/lmstudio/test`, "POST"], [`${prefix}/providers/lmstudio/models/refresh`, "POST"],
          [`${prefix}/providers/lmstudio/capabilities/refresh`, "POST"],
        ]) {
          const response = await domain.request(route!, payload(claim, method));
          assert.equal(response.status, 400, `${route}/${field}`);
          assert(!(await response.text()).includes(KEY));
        }
      }
      const cloud = await domain.request(`${prefix}/providers`, payload({ kind: "openpcb-cloud" }));
      assert.equal(cloud.status, 400);
    }
    assert.deepEqual(domain.service.host.providers.listProviders(), before);
    assert.equal(endpoint.requests.length, 0);
    const denied = await domain.request("/v1/providers/lmstudio/models/refresh", { method: "POST" }, null);
    assert.equal(denied.status, 401);
    for (const body of [{ metadata: { secretRef: "provider/forged" } }, { maxToolIterations: 9 }, { toolCalling: "invalid" }]) {
      const deniedSettings = await domain.request("/v1/settings", payload(body, "PATCH"));
      assert.equal(deniedSettings.status, 400);
    }
  } finally { await endpoint.close(); await domain.close(); }
});

test("Stale model, capability and connection probes cannot overwrite new provider settings", async () => {
  const domain = await isolatedHttpDomain();
  const oldEndpoint = await modelEndpoint();
  const newEndpoint = await modelEndpoint();
  try {
    for (const operation of ["models/refresh", "capabilities/refresh", "test"]) {
      await domain.service.host.providers.updateProvider("lmstudio", {
        baseUrl: oldEndpoint.baseUrl, defaultModel: "before-probe", apiKey: KEY,
      });
      domain.service.host.providers.replaceModels("lmstudio", ["current-cache"]);
      domain.service.host.providers.saveCapabilities("lmstudio", { streaming: false, toolCalling: false, modelList: false });
      const blocked = oldEndpoint.block();
      const pending = domain.request(`/v1/providers/lmstudio/${operation}`, { method: "POST" });
      await blocked.wait();
      await domain.service.host.providers.updateProvider("lmstudio", {
        baseUrl: newEndpoint.baseUrl, defaultModel: "current-model", apiKey: `${KEY}-rotated`,
      });
      blocked.release();
      const response = await pending;
      assert.equal(response.status, 409, operation);
      assert.equal((await response.json() as { code: string }).code, "revision_conflict");
      assert.equal(domain.service.host.providers.getProvider("lmstudio")?.defaultModel, "current-model");
      assert.deepEqual(domain.service.host.providers.listModels("lmstudio").map((model) => model.modelId), ["current-cache"]);
      assert.equal(domain.service.host.providers.getCapabilities("lmstudio")?.streaming, false);
    }
    const providers = domain.service.host.providers;
    const expected = await providers.snapshotProvider("lmstudio");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const owner = providers.credentials.serialize("lmstudio", () => held);
    const rotation = providers.updateProvider("lmstudio", { defaultModel: "rotated-again", apiKey: `${KEY}-next` });
    const guarded = providers.updateProvider("lmstudio", { defaultModel: "stale-catalogue-model" }, expected);
    const rejected = assert.rejects(guarded,
      (error: unknown) => error instanceof Error && "code" in error && error.code === "revision_conflict");
    release();
    await Promise.all([owner, rotation, rejected]);
    assert.equal(providers.getProvider("lmstudio")?.defaultModel, "rotated-again");
  } finally { await oldEndpoint.close(); await newEndpoint.close(); await domain.close(); }
});

test("Caller abort and the explicit deadline stop real provider HTTP probes before persistence", async () => {
  const domain = await isolatedHttpDomain();
  const endpoint = await modelEndpoint();
  try {
    await domain.service.host.providers.updateProvider("lmstudio", { baseUrl: endpoint.baseUrl, defaultModel: "current-model" });
    for (const operation of ["models/refresh", "capabilities/refresh", "test"]) {
      const abort = new AbortController();
      const blocked = endpoint.block();
      const pending = domain.request(`/v1/providers/lmstudio/${operation}`, { method: "POST", signal: abort.signal });
      await blocked.wait();
      abort.abort();
      const response = await pending;
      assert.equal(response.status, 500);
      blocked.release();
      assert.equal(domain.service.host.providers.listModels("lmstudio").length, 0);
      assert.equal(domain.service.host.providers.getCapabilities("lmstudio"), null);
    }
    const blocked = endpoint.block();
    const started = Date.now();
    const pending = domain.request("/v1/providers/lmstudio/models/refresh", { method: "POST" });
    await blocked.wait();
    assert.equal((await pending).status, 500);
    assert(Date.now() - started < PROVIDER_PROBE_TIMEOUT_MS + 2000);
    blocked.release();
    assert.equal(domain.service.host.providers.getProvider("lmstudio")?.defaultModel, "current-model");
    assert.equal(domain.service.host.providers.listModels("lmstudio").length, 0);
  } finally { await endpoint.close(); await domain.close(); }
});

test("AgentKit client settings and five provider kinds use the app vault for real HTTP probes", async () => {
  const domain = await isolatedHttpDomain();
  const endpoint = await modelEndpoint();
  try {
    const client = createAgentKitClient({ baseUrl: "http://127.0.0.1:3000/api/modules/assistant",
      fetch: (input, init) => domain.request(new URL(String(input)).pathname.replace("/api/modules/assistant", ""), init) });
    for (const kind of ["openai", "openrouter", "openai-compatible", "lmstudio", "omlx"]) {
      const provider = await client.createProvider({ kind, label: `Fixture ${kind}`, baseUrl: endpoint.baseUrl,
        defaultModel: "old-model", enabled: true });
      assert(Value.Check(ProviderDtoSchema, provider));
      await domain.service.host.providers.updateProvider(provider.id, { apiKey: KEY });
      const publicProvider = await domain.request(`/v1/providers/${provider.id}`);
      const status = await publicProvider.json() as { hasApiKey: boolean; isBuiltin: boolean; capabilities: unknown };
      assert.equal(status.hasApiKey, true);
      assert.equal(status.isBuiltin, false);
      assert.equal(status.capabilities, null);
      const models = await client.refreshProviderModels({ providerId: provider.id });
      assert.deepEqual(models.map((model) => model.modelId), ["fixture-a", "fixture-b"]);
      assert(models.every((model) => Value.Check(ModelDtoSchema, model)));
      assert.equal((await client.listProviders()).find((value) => value.id === provider.id)?.defaultModel, "fixture-b");
      assert.deepEqual(await client.testProvider({ providerId: provider.id }), { ok: true });
      const caps = await domain.request(`/v1/providers/${provider.id}/capabilities/refresh`, { method: "POST" });
      assert.equal(caps.status, 200);
      assert.equal((await caps.json() as { toolCalling: boolean }).toolCalling, true);
      const off = await domain.request(`/v1/providers/${provider.id}/tool-calling`, payload({ mode: "off" }, "PUT"));
      assert.deepEqual(await off.json(), { mode: "off", effective: false });
      const settings = await client.updateSettings({ defaultProviderId: provider.id, defaultModel: "fixture-a",
        writePolicyMode: "confirm_all_writes", contextSizePreference: "large", toolCalling: "auto" });
      assert(Value.Check(SettingsDtoSchema, settings));
      assert.equal(settings.defaultModel, "fixture-a");
      assert.equal(settings.toolCalling, "auto");
      assert.equal(domain.service.host.settings.getSettings().toolExecutionPolicy, "confirm_all_writes");
      const opaque = JSON.stringify(await client.listProviders());
      assert(!opaque.includes(KEY) && !opaque.includes("SecretRef") && !opaque.includes("secretRef"));
      await client.deleteProvider({ providerId: provider.id });
    }
    assert(endpoint.requests.some((req) => req.url === "/v1/chat/completions"));
    assert(endpoint.requests.every((req) => req.authorization === `Bearer ${KEY}`));
    assert(endpoint.requests.every((req) => !JSON.stringify(req.body).includes(KEY)));
  } finally { await endpoint.close(); await domain.close(); }
});

test("Failed probes retain legacy result distinctions and redact provider echoes", async () => {
  const domain = await isolatedHttpDomain();
  const endpoint = await modelEndpoint();
  try {
    await domain.service.host.providers.updateProvider("lmstudio", { baseUrl: endpoint.baseUrl, apiKey: KEY });
    endpoint.fail();
    for (const prefix of ["", "/v1"]) {
      const tested = await domain.request(`${prefix}/providers/lmstudio/test`, payload({ includeCompletion: true }));
      assert.equal(tested.status, 200);
      const text = await tested.text();
      assert(!text.includes(KEY) && !text.includes(encodeURIComponent(KEY)));
      const result = JSON.parse(text) as { ok: boolean; error?: string; message?: string; completionTested?: boolean };
      assert.equal(result.ok, false);
      assert((result.error ?? result.message)?.includes("List models failed:"));
      if (!prefix) assert.equal(result.completionTested, true);
      const caps = await domain.request(`${prefix}/providers/lmstudio/capabilities`);
      assert.equal((await caps.json() as { toolCalling: boolean }).toolCalling, false);
      const refresh = await domain.request(`${prefix}/providers/lmstudio/models/refresh`, { method: "POST" });
      assert.equal(refresh.status, 500);
      const refreshError = await refresh.text();
      assert(!refreshError.includes(KEY) && !refreshError.includes(encodeURIComponent(KEY)));
      const missing = await domain.request(`${prefix}/providers/absent/models/refresh`, { method: "POST" });
      assert.equal(missing.status, 404);
    }
    await domain.service.host.providers.updateProvider("lmstudio", { enabled: false });
    const disabled = await domain.request("/v1/providers/lmstudio/test", { method: "POST" });
    assert.equal(disabled.status, 400);
    assert((await disabled.text()).includes("Provider disabled:"));
    await domain.service.host.providers.updateProvider("openai", { enabled: true });
    const missingKey = await domain.request("/v1/providers/openai/test", { method: "POST" });
    assert.equal(missingKey.status, 400);
    assert((await missingKey.text()).includes("API key required for provider:"));
  } finally { await endpoint.close(); await domain.close(); }
});
