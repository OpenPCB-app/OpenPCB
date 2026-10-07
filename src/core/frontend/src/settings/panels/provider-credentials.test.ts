import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RendererCredentials } from "../../../../contracts/credentials/renderer";
import { providerMetadata, removeProviderKey, saveProviderDraft, type ProviderDraft } from "./provider-credentials";

const CANARY = "sk-renderer-secret-canary-915b8a";
const BASE = "http://127.0.0.1:3000/api/modules/assistant";
const draft: ProviderDraft = {
  label: "Fixture", kind: "openai-compatible", baseUrl: "http://127.0.0.1:1234/v1",
  apiKey: CANARY, defaultModel: "fixture", enabled: true,
};
const provider = { id: "fixture", hasApiKey: false, apiKeyPreview: null };

function bridge(configured: boolean): RendererCredentials {
  return {
    set: vi.fn(async () => ({ ok: true as const, value: { configured: true } })),
    clear: vi.fn(async () => ({ ok: true as const, value: { configured: false } })),
    status: vi.fn(async () => ({ ok: true as const, value: { configured } })),
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { electronAPI: { localApi: { bootstrap: async () => ({ url: "http://127.0.0.1:3000", token: "a".repeat(64) }) } } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("provider credential boundary", () => {
  test("metadata whitelist excludes both credentials fields, including empty create drafts", () => {
    expect(providerMetadata({ ...draft, apiKey: "", clearApiKey: true } as ProviderDraft & { clearApiKey: boolean })).toEqual({
      label: draft.label, kind: draft.kind, baseUrl: draft.baseUrl,
      defaultModel: draft.defaultModel, enabled: true,
    });
  });

  test("set durably confirms IPC status then reloads public provider; no secret in any HTTP request", async () => {
    const credentials = bridge(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(provider))
      .mockResolvedValueOnce(Response.json({ ...provider, hasApiKey: true, apiKeyPreview: "••••" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await saveProviderDraft(BASE, "fixture", draft, credentials);
    expect(credentials.set).toHaveBeenCalledWith({ providerId: "fixture", apiKey: CANARY });
    expect(credentials.status).toHaveBeenCalledWith({ providerId: "fixture" });
    expect(result.hasApiKey).toBe(true);
    expect(result.apiKeyPreview).toBe("••••");
    expect(fetchMock.mock.calls[1]?.[1]?.headers.get("X-OpenPCB-Token")).toBe("a".repeat(64));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(CANARY);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("apiKey");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("clearApiKey");
    expect(draft.apiKey).toBe(CANARY);
  });

  test("locked IPC rejects save, retains draft, and never reloads or falls back to HTTP key writes", async () => {
    const credentials = bridge(true);
    credentials.set = vi.fn(async () => ({ ok: false, error: { code: "LOCKED", message: "Unlock the system keychain and retry." } }));
    const fetchMock = vi.fn().mockResolvedValue(Response.json(provider));
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveProviderDraft(BASE, "fixture", draft, credentials)).rejects.toThrow("LOCKED: Unlock the system keychain and retry.");
    expect(draft.apiKey).toBe(CANARY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(credentials.status).not.toHaveBeenCalled();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(CANARY);
  });

  test("missing bridge refuses key save and removal with desktop-required guidance before HTTP", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveProviderDraft(BASE, "fixture", draft)).rejects.toThrow("Open OpenPCB desktop");
    await expect(removeProviderKey(BASE, "fixture")).rejects.toThrow("Browser mode cannot access the OS keychain");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(draft.apiKey).toBe(CANARY);
  });

  test("metadata-only browser saves work without a credential bridge", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(provider));
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveProviderDraft(BASE, "fixture", { ...draft, apiKey: "" })).resolves.toEqual(provider);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("apiKey");
  });

  test("clear uses only IPC, confirms absent status, and reloads masked provider", async () => {
    const credentials = bridge(false);
    const fetchMock = vi.fn().mockResolvedValue(Response.json(provider));
    vi.stubGlobal("fetch", fetchMock);
    expect((await removeProviderKey(BASE, "fixture", credentials)).hasApiKey).toBe(false);
    expect(credentials.clear).toHaveBeenCalledWith({ providerId: "fixture" });
    expect(credentials.status).toHaveBeenCalledWith({ providerId: "fixture" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${BASE}/providers/fixture`);
    expect(fetchMock.mock.calls[0]?.[1]?.headers.get("X-OpenPCB-Token")).toBe("a".repeat(64));
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  test("unconfirmed status and failed public reload do not return save success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(provider)));
    await expect(saveProviderDraft(BASE, "fixture", draft, bridge(false))).rejects.toThrow("did not confirm");
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(provider))
      .mockResolvedValueOnce(new Response("", { status: 503, statusText: "Unavailable" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveProviderDraft(BASE, "fixture", draft, bridge(true))).rejects.toThrow("Unavailable");
    expect(draft.apiKey).toBe(CANARY);
  });
});
