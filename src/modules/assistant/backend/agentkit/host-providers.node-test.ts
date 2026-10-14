import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { HangingProviderClient } from "agentkit/testing";
import type { AiProviderConfig } from "agentkit/contracts";
import { createOpenPcbAgentKitHost, type OpenPcbAgentKitHost } from "../agentkit-host";
import { ProviderSelectionError, type ProviderSelectionReason } from "../providers/provider-selection";
import { settingsPreferenceDto } from "./provider-preferences";
import { CANARY, addProvider, applier, completed, fixture, waitTerminal } from "./host-test-fixture";

const KINDS = ["openai", "openrouter", "openai-compatible", "lmstudio", "omlx"] as const;

function selectionRefusal(reason: ProviderSelectionReason, message: RegExp) {
  return (error: unknown) => error instanceof ProviderSelectionError && error.reason === reason
    && message.test(error.message);
}

function insertProviderRow(f: ReturnType<typeof fixture>, id: string, kind: string, label: string): void {
  const now = new Date().toISOString();
  f.database.prepare(`INSERT INTO assistant_provider_config
    (id,label,kind,base_url,api_key,default_model,enabled,is_builtin,tool_calling_override,created_at,updated_at)
    VALUES (?, ?, ?, 'https://legacy.invalid/v1', NULL, 'legacy-model', 1, 1, 1, ?, ?)`).run(id, label, kind, now, now);
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

test("admission refuses unlisted models, disabled and unsupported providers distinctly without enqueueing", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  let calls = 0;
  try {
    const provider = await addProvider(f.providers);
    const custom = await addProvider(f.providers, "custom-model");
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier,
      providerFactory: () => { calls++; return completed(); } });
    const chat = await host.store.conversations.createChat({ id: "selection-chat" });
    f.providers.replaceModels(provider.id, ["listed-a", "listed-b"]);
    await assert.rejects(host.submitMessage({ chatId: chat.id, providerId: provider.id, model: "ghost", content: "x" }),
      selectionRefusal("model_not_available", /Model 'ghost' is not offered by provider 'Fixture'/));
    await assert.rejects(host.submitMessage({ chatId: chat.id, providerId: provider.id, content: "x" }),
      selectionRefusal("model_not_available", /'model-one'/));
    const listed = await host.submitMessage({ chatId: chat.id, providerId: provider.id, model: "listed-b", content: "x" });
    assert.equal((await waitTerminal(host, listed.runId)).status, "completed");
    const unlisted = await host.submitMessage({ chatId: chat.id, providerId: custom.id, model: "typed-by-user", content: "x" });
    assert.equal((await waitTerminal(host, unlisted.runId)).status, "completed");

    await f.providers.updateProvider(custom.id, { enabled: false });
    await assert.rejects(host.submitMessage({ chatId: chat.id, providerId: custom.id, content: "x" }),
      selectionRefusal("provider_disabled", /'Fixture' is disabled/));
    insertProviderRow(f, "future-kind", "anthropic-native", "Future");
    await assert.rejects(host.submitMessage({ chatId: chat.id, providerId: "future-kind", content: "x" }),
      selectionRefusal("provider_unsupported", /'anthropic-native' is not supported/));
    assert.equal((await host.store.tasks.listByScope(chat.id)).length, 2);
    assert.equal(calls, 2);
  } finally { await host?.close(); f.cleanup(); }
});

test("offline local service fails its own run distinctly and never falls back to another provider", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  const previousFetch = globalThis.fetch;
  const requested: string[] = [];
  try {
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requested.push(String(input instanceof Request ? input.url : input));
      return previousFetch(input, init);
    }) as typeof fetch;
    const port = await closedPort();
    const remote = await f.providers.createProvider({ label: "Remote", kind: "openai", apiKey: CANARY,
      baseUrl: "https://remote.invalid/v1", defaultModel: "remote-model" });
    const local = await f.providers.createProvider({ label: "Studio", kind: "lmstudio",
      baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: "local-model" });
    for (const id of [remote.id, local.id]) f.providers.saveCapabilities(id, { streaming: true, toolCalling: false, modelList: false });
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier });
    host.settings.updateSettings({ defaultProviderId: remote.id });
    const chat = await host.store.conversations.createChat({ id: "offline-chat" });
    const run = await host.submitMessage({ chatId: chat.id, providerId: local.id, content: "hello" });
    assert.equal((await waitTerminal(host, run.runId)).status, "failed");
    const events = await host.store.tasks.listEvents(run.runId, { limit: 1000 });
    const failure = JSON.stringify(events.filter((event) => event.type === "run.failed"));
    assert.match(failure, new RegExp(`Local provider 'Studio' is offline: nothing accepted the connection at http://127.0.0.1:${port}`));
    assert.ok(requested.length > 0);
    assert.ok(requested.every((url) => url.startsWith(`http://127.0.0.1:${port}/`)), requested.join(","));
  } finally { globalThis.fetch = previousFetch; await host?.close(); f.cleanup(); }
});

test("legacy openpcb-cloud row is hidden as retired and a default pointing at it is cleared without fallback", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  let calls = 0;
  try {
    const usable = await addProvider(f.providers);
    host = await createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier,
      providerFactory: () => { calls++; return completed(); } });
    insertProviderRow(f, "openpcb-cloud", "openpcb-cloud", "OpenPCB Cloud");
    host.settings.getSettings();
    f.database.prepare("UPDATE assistant_settings SET default_provider_id='openpcb-cloud'").run();
    const stored = () => (f.database.prepare("SELECT default_provider_id AS id FROM assistant_settings").get() as { id: string }).id;

    assert.ok(!host.providers.listProviders().some((provider) => provider.id === "openpcb-cloud"));
    assert.equal(host.providers.getProvider("openpcb-cloud"), null);
    assert.equal(host.settings.getSettings().defaultProviderId, "");
    const dto = settingsPreferenceDto(host.settings, host.providers);
    assert.equal(dto.defaultProviderId, undefined);
    assert.deepEqual(dto.metadata, { defaultProviderState: "retired", retiredProviderId: "openpcb-cloud",
      retiredProviderLabel: "OpenPCB Cloud" });

    const chat = await host.store.conversations.createChat({ id: "retired-chat" });
    for (const providerId of [undefined, "openpcb-cloud"]) {
      await assert.rejects(host.submitMessage({ chatId: chat.id, providerId, content: "x" }),
        selectionRefusal("provider_retired", /'OpenPCB Cloud' has been retired/));
    }
    assert.throws(() => host!.settings.updateSettings({ defaultProviderId: "openpcb-cloud" }),
      selectionRefusal("provider_retired", /retired/));
    assert.equal(host.settings.updateSettings({ contextSizePreference: "large" }).defaultProviderId, "");
    assert.equal(stored(), "openpcb-cloud");
    assert.equal(calls, 0);
    assert.equal((await host.store.tasks.listByScope(chat.id)).length, 0);

    assert.equal(host.settings.updateSettings({ defaultProviderId: usable.id }).defaultProviderId, usable.id);
    const run = await host.submitMessage({ chatId: chat.id, content: "x" });
    assert.equal((await waitTerminal(host, run.runId)).status, "completed");
    const preserved = f.database.prepare("SELECT kind FROM assistant_provider_config WHERE id='openpcb-cloud'").get();
    assert.deepEqual(preserved, { kind: "openpcb-cloud" });
  } finally { await host?.close(); f.cleanup(); }
});

test("every provider kind pins default, override, cancellation and restart per run", async () => {
  const f = fixture();
  let host: OpenPcbAgentKitHost | undefined;
  const seen: AiProviderConfig[] = [];
  let blocker = new HangingProviderClient();
  const factory = (config: AiProviderConfig) => { seen.push(config); return config.defaultModel === "block" ? blocker : completed(); };
  const boot = () => createOpenPcbAgentKitHost({ ...f, contributors: [], proposalApplier: applier, providerFactory: factory });
  const pinnedProvider = async (runId: string) => {
    const task = await host!.store.tasks.getTask(runId);
    return host!.store.providers.getProvider(String(task?.payload.providerId));
  };
  try {
    host = await boot();
    for (const kind of KINDS) {
      const [a, b] = await Promise.all(["A", "B"].map((name) => f.providers.createProvider({ label: `${kind}-${name}`, kind,
        baseUrl: `http://127.0.0.1:43101/${name}`, defaultModel: `${kind}-model`, apiKey: CANARY })));
      host.settings.updateSettings({ defaultProviderId: a!.id });
      for (const [mode, probe, expected] of [["on", false, true], ["off", true, false], ["auto", true, true]] as const) {
        f.providers.saveCapabilities(a!.id, { streaming: true, modelList: false, toolCalling: probe });
        f.providers.setToolCallingMode(a!.id, mode);
        const chat = await host.store.conversations.createChat({ id: `${kind}-override-${mode}` });
        const run = await host.submitMessage({ chatId: chat.id, content: mode });
        const capabilities = await host.store.providers.getCapabilities(String((await host.store.tasks.getTask(run.runId))?.payload.providerId));
        assert.equal(capabilities?.toolCalling, expected, `${kind}/${mode}`);
        assert.equal((await waitTerminal(host, run.runId)).status, "completed", `${kind}/${mode}`);
      }

      blocker = new HangingProviderClient();
      const held = await host.store.conversations.createChat({ id: `${kind}-held` });
      const blocked = await host.submitMessage({ chatId: held.id, model: "block", content: "hold", taskId: `${kind}-held-key` });
      await Promise.race([blocker.whenBlocking(), new Promise((_, reject) => setTimeout(() => reject(new Error(`${kind} blocker did not run`)), 1500))]);
      host.settings.updateSettings({ defaultProviderId: b!.id });
      const next = await host.store.conversations.createChat({ id: `${kind}-next` });
      const queued = await host.submitMessage({ chatId: next.id, content: "after change" });
      assert.equal((await pinnedProvider(blocked.runId))?.metadata?.openpcbProviderId, a!.id, kind);
      assert.equal((await pinnedProvider(queued.runId))?.metadata?.openpcbProviderId, b!.id, kind);
      await host.runner.requestCancel(blocked.runId);
      assert.equal((await waitTerminal(host, blocked.runId)).status, "cancelled", kind);
      assert.equal((await waitTerminal(host, queued.runId)).status, "completed", kind);
      assert.equal(seen.at(-1)?.baseUrl, "http://127.0.0.1:43101/B", kind);
      assert.equal(seen.at(-1)?.kind, kind);

      await host.close(); host = undefined;
      const calls = seen.length;
      host = await boot();
      assert.equal((await host.store.tasks.getTask(blocked.runId))?.status, "cancelled", kind);
      const replay = await host.submitMessage({ chatId: held.id, model: "block", content: "hold", taskId: `${kind}-held-key` });
      assert.equal(replay.runId, blocked.runId, kind);
      assert.equal(seen.length, calls, kind);
    }
  } finally { await host?.close(); f.cleanup(); }
});
