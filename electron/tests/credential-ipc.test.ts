import { describe, expect, test } from "bun:test";
import { CredentialError } from "../../src/core/contracts/credentials/secret-store";
import type { ProviderCredentialAccess } from "../../src/core/contracts/credentials/renderer";
import { handleCredentialRequest, registerCredentialIpc, type CredentialSender, type CredentialTrust } from "../src/main/credential-ipc";

const CANARY = "typed-api-key-canary-never-return";

function fixture(): {
  event: CredentialSender;
  trust: CredentialTrust;
  access: ProviderCredentialAccess;
  calls: string[];
} {
  const frame = { url: "http://127.0.0.1:1420/settings" };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  const calls: string[] = [];
  return {
    event: { sender, senderFrame: frame },
    trust: { mainContents: () => sender, rendererOrigin: () => "http://127.0.0.1:1420" },
    access: {
      async set(providerId, apiKey) { calls.push(`set:${providerId}`); return { configured: apiKey === CANARY, apiKey }; },
      async clear(providerId) { calls.push(`clear:${providerId}`); return { configured: false }; },
      async status(providerId) { calls.push(`status:${providerId}`); return { configured: true }; },
    },
    calls,
  };
}

describe("narrow provider credential IPC", () => {
  test("returns configured status only, even if a backend accidentally includes key material", async () => {
    const { event, trust, access, calls } = fixture();
    const result = await handleCredentialRequest("set", event, [{ providerId: "openai", apiKey: CANARY }], trust, access);
    expect(result).toEqual({ ok: true, value: { configured: true } });
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(calls).toEqual(["set:openai"]);
    expect(await handleCredentialRequest("clear", event, [{ providerId: "openai" }], trust, access))
      .toEqual({ ok: true, value: { configured: false } });
    expect(await handleCredentialRequest("status", event, [{ providerId: "openai" }], trust, access))
      .toEqual({ ok: true, value: { configured: true } });
  });

  test("unknown window, subframe, missing frame, destroyed window and absent trusted window fail closed", async () => {
    const { event, trust, access, calls } = fixture();
    const candidates: Array<{ event: CredentialSender; trust: CredentialTrust }> = [
      { event: { ...event, sender: { ...event.sender } }, trust },
      { event: { ...event, senderFrame: { url: event.sender.mainFrame.url } }, trust },
      { event: { ...event, senderFrame: null }, trust },
      { event, trust: { ...trust, mainContents: () => null } },
      { event, trust: { ...trust, rendererOrigin: () => null } },
    ];
    for (const candidate of candidates) {
      expect(await handleCredentialRequest("set", candidate.event, [{ providerId: "openai", apiKey: CANARY }], candidate.trust, access))
        .toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
    event.sender.isDestroyed = () => true;
    expect(await handleCredentialRequest("status", event, [{ providerId: "openai" }], trust, access))
      .toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(calls).toEqual([]);
  });

  for (const origin of ["http://127.0.0.1:1421", "http://localhost:1420", "https://127.0.0.1:1420", "http://127.0.0.1.evil.test:1420", "data:text/html,test", "not a URL"]) {
    test(`rejects origin ${origin}`, async () => {
      const { event, trust, access, calls } = fixture();
      event.sender.mainFrame.url = origin;
      expect(await handleCredentialRequest("status", event, [{ providerId: "openai" }], trust, access))
        .toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect(calls).toEqual([]);
    });
  }

  test("schema, namespace, extra arguments, control characters and byte limits reject before backend access", async () => {
    const { event, trust, access, calls } = fixture();
    const invalid: unknown[][] = [
      [], [null], [[]], [{ providerId: "openai" }], [{ providerId: "openai", apiKey: "" }],
      [{ providerId: "openai", apiKey: "   " }], [{ providerId: "openai", apiKey: "key\nheader" }],
      [{ providerId: "provider/opaque", apiKey: CANARY }], [{ providerId: "__proto__", apiKey: CANARY }],
      [{ providerId: "constructor", apiKey: CANARY }], [{ providerId: "../openai", apiKey: CANARY }],
      [{ providerId: "x".repeat(129), apiKey: CANARY }], [{ providerId: "openai", apiKey: 123 }],
      [{ providerId: "openai", apiKey: CANARY, secretRef: "arbitrary" }],
      [{ providerId: "openai", apiKey: "x".repeat(16 * 1024 + 1) }],
      [{ providerId: "openai", apiKey: "界".repeat(6000) }],
      [{ providerId: "openai", apiKey: CANARY }, "extra"],
    ];
    for (const request of invalid) {
      expect(await handleCredentialRequest("set", event, request, trust, access))
        .toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    }
    expect(calls).toEqual([]);
  });

  test("unavailable service and injected errors expose no raw exception detail", async () => {
    const { event, trust, access } = fixture();
    expect(await handleCredentialRequest("status", event, [{ providerId: "openai" }], trust, null))
      .toMatchObject({ ok: false, error: { code: "NOT_READY" } });
    access.status = async () => { throw new Error(`Authorization: Bearer ${CANARY}`); };
    let result = await handleCredentialRequest("status", event, [{ providerId: "openai" }], trust, access);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_READY" } });
    access.status = async () => {
      const error = new CredentialError("LOCKED");
      error.message = CANARY;
      throw error;
    };
    result = await handleCredentialRequest("status", event, [{ providerId: "openai" }], trust, access);
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(result).toMatchObject({ ok: false, error: { code: "LOCKED" } });
  });

  test("no provider read handler; cloud compatibility restricts exact keys and trusted sender", async () => {
    const { event, trust, access } = fixture();
    const handlers = new Map<string, (event: CredentialSender, ...arguments_: unknown[]) => unknown>();
    const cloudCalls: string[] = [];
    registerCredentialIpc({ handle: (channel, handler) => { handlers.set(channel, handler); } }, trust, () => access, {
      async get(key) { cloudCalls.push(key); return "cloud-session"; },
      async set(key) { cloudCalls.push(key); },
      async remove(key) { cloudCalls.push(key); },
    });
    expect(handlers.has("credentials:get")).toBe(false);
    const get = handlers.get("secure-storage:get")!;
    expect(await get(event, "openpcb.auth")).toBe("cloud-session");
    for (const key of ["provider/openai", "session/secret", "arbitrary", "openpcb.auth-other"]) {
      await expect(get(event, key)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
    await expect(get({ ...event, senderFrame: null }, "openpcb.auth"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(handlers.get("secure-storage:set")!(event, "openpcb.auth", "x".repeat(256 * 1024 + 1)))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(cloudCalls).toEqual(["openpcb.auth"]);
  });
});
