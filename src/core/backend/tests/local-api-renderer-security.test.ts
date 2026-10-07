import { describe, expect, test } from "bun:test";
import { configureDevelopmentLocalApi, createLocalApiClient, localApiFetch } from "../../../shared/frontend/http/local-api";

const BOOTSTRAP = { url: "http://127.0.0.1:54321", token: "a".repeat(64) };

describe("local API renderer transport", () => {
  test("explicit development client uses ephemeral header, prevents redirects and keeps stream options", async () => {
    let request: Request | null = null;
    let sentOptions: RequestInit | undefined;
    const controller = new AbortController();
    const client = createLocalApiClient(BOOTSTRAP, async (input, init) => {
      request = new Request(input, init);
      sentOptions = init;
      return Response.json({ ok: true });
    });
    const response = await client("/api/modules/assistant/runs/one/events", {
      signal: controller.signal, headers: { Accept: "text/event-stream", "Last-Event-ID": "42" },
    });
    expect(response.status).toBe(200);
    const sent = request as unknown as Request;
    expect(sent.headers.get("X-OpenPCB-Token")).toBe(BOOTSTRAP.token);
    expect(sent.headers.get("Accept")).toBe("text/event-stream");
    expect(sent.headers.get("Last-Event-ID")).toBe("42");
    expect(sent.url).not.toContain(BOOTSTRAP.token);
    expect(sent.redirect).toBe("error");
    expect(sentOptions?.credentials).toBe("omit");
    controller.abort();
    expect(sent.signal.aborted).toBe(true);
  });

  test("other origins, credentials, generic routes and inbound MCP never receive app header", async () => {
    let calls = 0;
    const client = createLocalApiClient(BOOTSTRAP, async () => { calls++; return new Response(); });
    for (const target of ["http://evil.test/api/modules/assistant/work", "http://127.0.0.1:54322/api/modules/tasks/work",
      "http://localhost:54321/api/modules/assistant/work", "http://user:pass@127.0.0.1:54321/api/modules/assistant/work",
      "/api/modules/library/download", "/api/diagnostics", "/api/modules/assistant/mcp"]) {
      await expect(client(target)).rejects.toThrow("Local API target refused");
    }
    expect(calls).toBe(0);
  });

  test("Request headers merge; caller cannot overwrite token or redirect policy", async () => {
    let sent: Request | undefined;
    const client = createLocalApiClient(BOOTSTRAP, async (input, init) => {
      sent = new Request(input, init); return new Response();
    });
    await client(new Request(`${BOOTSTRAP.url}/api/modules/tasks/work`, {
      headers: { "content-type": "application/json", "X-OpenPCB-Token": "wrong" },
    }), { headers: { "X-OpenPCB-Token": "also-wrong", "Last-Event-ID": "7" }, redirect: "follow" });
    expect(sent?.headers.get("X-OpenPCB-Token")).toBe(BOOTSTRAP.token);
    expect(sent?.headers.get("content-type")).toBe("application/json");
    expect(sent?.headers.get("Last-Event-ID")).toBe("7");
    expect(sent?.redirect).toBe("error");
  });

  test("production browser cannot configure developer bootstrap; absent trusted IPC fails closed", async () => {
    expect(() => configureDevelopmentLocalApi(BOOTSTRAP)).toThrow("Local API bootstrap refused");
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    try {
      await expect(localApiFetch(`${BOOTSTRAP.url}/api/modules/assistant/work`)).rejects.toThrow("Local API bootstrap unavailable");
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("bootstrap validation and caller mutation cannot change trusted target", async () => {
    for (const bootstrap of [{ ...BOOTSTRAP, url: "https://127.0.0.1:54321" }, { ...BOOTSTRAP, url: "http://evil.test" },
      { ...BOOTSTRAP, token: "short" }, { ...BOOTSTRAP, url: `${BOOTSTRAP.url}?token=canary` }]) {
      expect(() => createLocalApiClient(bootstrap)).toThrow("Local API bootstrap refused");
    }
    const mutable = { ...BOOTSTRAP };
    let sent: Request | undefined;
    const client = createLocalApiClient(mutable, async (input, init) => { sent = new Request(input, init); return new Response(); });
    mutable.url = "http://evil.test";
    mutable.token = "wrong";
    await client("/api/modules/tasks/work");
    expect(sent?.url).toBe(`${BOOTSTRAP.url}/api/modules/tasks/work`);
    expect(sent?.headers.get("X-OpenPCB-Token")).toBe(BOOTSTRAP.token);
  });
});
