import { afterEach, describe, expect, test } from "bun:test";
import { SqliteAssistantStore } from "agentkit/adapters-sqlite";
import { PROVIDER_SECRET_REF_KEY } from "agentkit/host";
import { pinProviderGeneration, buildAgentKitProviderClient } from "../../../modules/assistant/backend/agentkit/providers";
import { ProviderStore } from "../../../modules/assistant/backend/provider-store";
import { buildAiProviderClient } from "../../../modules/assistant/backend/providers/openpcb-provider-factory";
import {
  CANARY,
  FakeVault,
  fixture,
  input,
  insertLegacy,
  credentialRow,
  closeProviderFixtures,
} from "./fixtures/provider-credentials";

afterEach(closeProviderFixtures);

describe("provider vault boundary", () => {
  test("canonical provider generations retain nonsecret endpoint/model/ref through rotation and deletion", async () => {
    const { store } = fixture();
    const canonical = new SqliteAssistantStore(":memory:");
    const provider = await store.createProvider(input({ kind: "openai", apiKey: CANARY }));
    const pinned = await pinProviderGeneration(store, canonical, provider.id, "selected-model");
    expect(pinned.baseUrl).toBe("http://127.0.0.1:43210/v1");
    expect(JSON.stringify(pinned)).not.toContain(CANARY);
    expect(Object.hasOwn(pinned, "apiKey")).toBe(false);
    await store.updateProvider(provider.id, { apiKey: "replacement-secret", baseUrl: "http://127.0.0.1:43211/v1", defaultModel: "replacement-model" });
    await store.deleteProvider(provider.id);
    const seen: Array<{ url: string; authorization: string; model: unknown }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (request: unknown, options?: RequestInit) => {
      seen.push({ url: String(request), authorization: new Headers(options?.headers).get("authorization") ?? "",
        model: (JSON.parse(String(options?.body)) as Record<string, unknown>).model });
      return new Response('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    try {
      const reference = String(pinned.metadata?.[PROVIDER_SECRET_REF_KEY]);
      const client = buildAgentKitProviderClient({ ...pinned, apiKey: await store.credentials.resolve(reference) });
      for await (const _event of client.streamChat({ runId: "pin-test", model: pinned.defaultModel, messages: [{ role: "user", content: "Hello" }] })) { /* Drain real transport. */ }
      expect(seen).toEqual([{ url: "http://127.0.0.1:43210/v1/chat/completions", authorization: `Bearer ${CANARY}`, model: "selected-model" }]);
      expect(await canonical.providers.getProvider(pinned.id)).toEqual(pinned);
    } finally { globalThis.fetch = previousFetch; canonical.close(); }
  });

  test("new keys never enter SQLite, public DTOs or prefix/suffix previews", async () => {
    const vault = new FakeVault();
    const { store, database, ctx } = fixture(vault);
    const provider = await store.createProvider(input({ apiKey: CANARY }));
    const row = credentialRow(database, provider.id);
    expect(row.api_key).toBeNull();
    expect(row.secret_ref).toMatch(/^provider\/[0-9a-f-]{36}$/);
    expect(provider.apiKeyPreview).toBe("••••");
    expect(JSON.stringify(store.listProviders())).not.toContain(CANARY);
    expect(
      JSON.stringify(store.getProviderInternal(provider.id)),
    ).not.toContain(CANARY);
    expect(database.serialize().toString()).not.toContain(CANARY);
    expect(
      await new ProviderStore(ctx).resolveApiKey(
        await store.snapshotProvider(provider.id),
      ),
    ).toBe(CANARY);
  });

  test("legacy migration clears only after write/readback, preserving endpoint/model and restart", async () => {
    const { store, database, ctx } = fixture();
    insertLegacy(database);
    await store.credentials.migrate("legacy");
    expect(credentialRow(database, "legacy").api_key).toBeNull();
    const restart = new ProviderStore(ctx);
    const snapshot = await restart.snapshotProvider("legacy");
    expect(snapshot.baseUrl).toBe("https://api.openai.com/v1");
    expect(snapshot.defaultModel).toBe("fixture-model");
    expect(await restart.resolveApiKey(snapshot)).toBe(CANARY);
    expect(snapshot.apiKeyPreview).toBe("••••");
  });

  for (const mode of ["write", "read", "mismatch", "commit"] as const) {
    test(`interrupted ${mode} migration retains the old valid copy and retries`, async () => {
      const vault = new FakeVault();
      const { store, database, ctx, failCommits } = fixture(vault);
      insertLegacy(database);
      vault.failWrite = mode === "write";
      vault.failRead = mode === "read";
      vault.mismatch = mode === "mismatch";
      failCommits(mode === "commit");
      let message = "";
      try {
        await store.credentials.migrate("legacy");
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(CANARY);
      expect(credentialRow(database, "legacy")).toEqual({
        api_key: CANARY,
        secret_ref: null,
      });
      vault.failWrite = false;
      vault.failRead = false;
      vault.mismatch = false;
      failCommits(false);
      const restart = new ProviderStore(ctx);
      expect(
        await restart.resolveApiKey(await restart.snapshotProvider("legacy")),
      ).toBe(CANARY);
    });
  }

  test("migration checks current DB copy before clearing after asynchronous readback", async () => {
    const vault = new FakeVault();
    const { store, database } = fixture(vault);
    insertLegacy(database);
    vault.beforeRead = () => {
      database
        .query(
          "UPDATE assistant_provider_config SET api_key=? WHERE id='legacy'",
        )
        .run("replacement-secret");
    };
    await expect(store.credentials.migrate("legacy")).rejects.toThrow(
      "could not be durably saved",
    );
    expect(credentialRow(database, "legacy")).toEqual({
      api_key: "replacement-secret",
      secret_ref: null,
    });
  });

  test("failed rotation preserves association; successful rotation and clear keep pinned refs usable", async () => {
    const vault = new FakeVault();
    const { store, database } = fixture(vault);
    const provider = await store.createProvider(input({ apiKey: CANARY }));
    const pinned = await store.snapshotProvider(provider.id);
    vault.failWrite = true;
    await expect(
      store.updateProvider(provider.id, { apiKey: "new-secret" }),
    ).rejects.toThrow("could not be durably saved");
    expect(credentialRow(database, provider.id).secret_ref).toBe(
      pinned.secretRef!,
    );
    vault.failWrite = false;
    await store.updateProvider(provider.id, {
      apiKey: "new-secret",
      baseUrl: "http://127.0.0.1:43211/v1",
    });
    expect(await store.resolveApiKey(pinned)).toBe(CANARY);
    const next = await store.snapshotProvider(provider.id);
    expect(next.secretRef).not.toBe(pinned.secretRef);
    expect(await store.resolveApiKey(next)).toBe("new-secret");
    await store.updateProvider(provider.id, { clearApiKey: true });
    expect(store.credentialStatus(provider.id)).toEqual({ configured: false });
    expect(await store.resolveApiKey(next)).toBe("new-secret");
    await store.deleteProvider(provider.id);
    expect(await store.resolveApiKey(pinned)).toBe(CANARY);
  });

  test("concurrent migration/rotation uses one provider lock across store instances", async () => {
    const vault = new FakeVault();
    const { store, database, ctx } = fixture(vault);
    insertLegacy(database);
    const other = new ProviderStore(ctx);
    await Promise.all([
      store.credentials.migrate("legacy"),
      other.updateProvider("legacy", { apiKey: "second-secret" }),
      store.updateProvider("legacy", { apiKey: "third-secret" }),
    ]);
    expect(vault.maxActive).toBe(1);
    expect(credentialRow(database, "legacy").api_key).toBeNull();
    expect(
      await store.resolveApiKey(await store.snapshotProvider("legacy")),
    ).toBe("third-secret");
  });

  test("unavailable vault preserves no-key local providers and rejects all new plaintext writes", async () => {
    const { store, database } = fixture(null);
    const local = await store.createProvider(input({ kind: "lmstudio" }));
    expect(
      (await buildAiProviderClient(await store.snapshotProvider(local.id)))
        .kind,
    ).toBe("lmstudio");
    expect(
      await store.resolveApiKey(await store.snapshotProvider(local.id)),
    ).toBeUndefined();
    await expect(
      store.createProvider(input({ apiKey: CANARY })),
    ).rejects.toThrow("OS credential encryption is unavailable");
    await expect(
      store.updateProvider(local.id, { apiKey: CANARY }),
    ).rejects.toThrow("OS credential encryption is unavailable");
    expect(credentialRow(database, local.id)).toEqual({
      api_key: null,
      secret_ref: null,
    });
    insertLegacy(database);
    await expect(store.snapshotProvider("legacy")).rejects.toThrow(
      "OS credential encryption is unavailable",
    );
    expect(credentialRow(database, "legacy").api_key).toBe(CANARY);
    expect(
      store.listProviders().some((provider) => provider.kind === "openai"),
    ).toBe(true);
    expect(
      store.listProviders().some((provider) => provider.kind === "openrouter"),
    ).toBe(true);
  });

  test("disabling managed cloud keeps every API-key/local kind and tool overrides", async () => {
    const previous = process.env.OPENPCB_FEATURE_CLOUD_ASSISTANT_PROVIDERS;
    process.env.OPENPCB_FEATURE_CLOUD_ASSISTANT_PROVIDERS = "0";
    try {
      const { store } = fixture();
      expect(store.listProviders().map((provider) => provider.kind)).toEqual(
        expect.arrayContaining(["openai", "openrouter", "lmstudio", "omlx"]),
      );
      for (const kind of [
        "openai",
        "openrouter",
        "openai-compatible",
        "lmstudio",
        "omlx",
      ] as const) {
        const provider = await store.createProvider(
          input({ kind, apiKey: CANARY }),
        );
        for (const mode of ["on", "off", "auto"] as const) {
          store.setToolCallingMode(provider.id, mode);
          expect(store.getToolCallingMode(provider.id)).toBe(mode);
          if (mode !== "auto") {
            expect(
              (await store.snapshotProvider(provider.id)).capabilities
                ?.toolCalling,
            ).toBe(mode === "on");
          }
        }
        expect(
          (
            await buildAiProviderClient(
              await store.snapshotProvider(provider.id),
              {
                resolveApiKey: (value) => store.resolveApiKey(value),
              },
            )
          ).kind,
        ).toBe(kind);
      }
    } finally {
      if (previous === undefined)
        delete process.env.OPENPCB_FEATURE_CLOUD_ASSISTANT_PROVIDERS;
      else process.env.OPENPCB_FEATURE_CLOUD_ASSISTANT_PROVIDERS = previous;
    }
  });

  test("factory resolves only injected saved refs, rejecting missing keys without network calls", async () => {
    const { store } = fixture();
    const provider = await store.createProvider(
      input({ kind: "openai", apiKey: CANARY }),
    );
    const snapshot = await store.snapshotProvider(provider.id);
    await expect(buildAiProviderClient(snapshot)).rejects.toThrow(
      "API key required",
    );
    const resolved: string[] = [];
    const client = await buildAiProviderClient(snapshot, {
      resolveApiKey: async (value) => {
        resolved.push(value.secretRef!);
        return store.resolveApiKey(value);
      },
    });
    expect(client.kind).toBe("openai");
    expect(resolved).toEqual([snapshot.secretRef!]);
  });

  test("provider error echoes cannot leak saved keys through warnings, events or diagnostics", async () => {
    const { store } = fixture();
    const provider = await store.createProvider(
      input({ kind: "openai", apiKey: CANARY }),
    );
    const previousFetch = globalThis.fetch;
    const authorized: string[] = [];
    globalThis.fetch = (async (_request: unknown, options?: RequestInit) => {
      authorized.push(new Headers(options?.headers).get("authorization") ?? "");
      return new Response(`Rejected Bearer ${CANARY}`, { status: 401 });
    }) as typeof fetch;
    try {
      const client = await buildAiProviderClient(
        await store.snapshotProvider(provider.id),
        {
          resolveApiKey: (value) => store.resolveApiKey(value),
        },
      );
      let failure = "";
      try {
        await client.listModels();
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      expect(failure).toContain("401");
      expect(failure).toContain("[REDACTED]");
      const capabilities = await client.capabilities(
        undefined,
        "fixture-model",
      );
      store.saveCapabilities(provider.id, capabilities);
      const events = [];
      for await (const event of client.streamChat({
        runId: "run_canary",
        model: "fixture-model",
        messages: [],
      })) {
        events.push(event);
      }
      const diagnostics = JSON.stringify({
        failure,
        events,
        capabilities,
        provider: store.getProvider(provider.id),
      });
      expect(diagnostics).not.toContain(CANARY);
      expect(events.some((event) => event.type === "run.failed")).toBe(true);
      expect(authorized.every((value) => value === `Bearer ${CANARY}`)).toBe(
        true,
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
