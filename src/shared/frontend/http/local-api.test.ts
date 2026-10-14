import { afterEach, describe, expect, it, vi } from "vitest";

/** Fresh module per test: the bootstrap cache is module state, as in the renderer. */
async function freshFetch() {
  vi.resetModules();
  return (await import("./local-api")).localApiFetch;
}

const TOKEN = "a".repeat(64);

function preload(urls: string[]) {
  const bootstrap = vi.fn(async () => ({ url: urls.shift() ?? "http://127.0.0.1:1", token: TOKEN }));
  vi.stubGlobal("window", { electronAPI: { localApi: { bootstrap } } });
  return bootstrap;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("localApiFetch bootstrap cache", () => {
  it("asks trusted IPC again after a connection failure and targets the backend's new port", async () => {
    const bootstrap = preload(["http://127.0.0.1:40001", "http://127.0.0.1:40002"]);
    const localApiFetch = await freshFetch();
    const targets: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: Request | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      targets.push(url);
      if (url.startsWith("http://127.0.0.1:40001")) throw new TypeError("fetch failed");
      return Response.json({ ok: true });
    }));

    await expect(localApiFetch("/api/modules/assistant/v1/chats")).rejects.toThrow("fetch failed");
    const response = await localApiFetch("/api/modules/assistant/v1/chats");

    expect(response.status).toBe(200);
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(targets).toEqual([
      "http://127.0.0.1:40001/api/modules/assistant/v1/chats",
      "http://127.0.0.1:40002/api/modules/assistant/v1/chats",
    ]);
  });

  it("refreshes once when an absolute target names the restarted backend's new port", async () => {
    const bootstrap = preload(["http://127.0.0.1:40004", "http://127.0.0.1:40005", "http://127.0.0.1:40005"]);
    const localApiFetch = await freshFetch();
    const targets: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: Request | URL) => {
      targets.push(input instanceof Request ? input.url : String(input));
      return Response.json({ ok: true });
    }));

    await localApiFetch("http://127.0.0.1:40004/api/modules/assistant/v1/chats");
    expect((await localApiFetch("http://127.0.0.1:40005/api/modules/assistant/v1/chats")).status).toBe(200);
    await localApiFetch("http://127.0.0.1:40005/api/modules/tasks/v1/runs");
    await expect(localApiFetch("http://evil.example/api/modules/assistant/v1/chats"))
      .rejects.toThrow("Local API target refused");

    expect(bootstrap).toHaveBeenCalledTimes(3);
    expect(targets).toEqual([
      "http://127.0.0.1:40004/api/modules/assistant/v1/chats",
      "http://127.0.0.1:40005/api/modules/assistant/v1/chats",
      "http://127.0.0.1:40005/api/modules/tasks/v1/runs",
    ]);
  });

  it("keeps the cached bootstrap for HTTP errors, aborts and refused targets", async () => {
    const bootstrap = preload(["http://127.0.0.1:40003"]);
    const localApiFetch = await freshFetch();
    vi.stubGlobal("fetch", vi.fn(async (_input: Request | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return new Response(null, { status: 503 });
    }));
    const controller = new AbortController();
    controller.abort();

    expect((await localApiFetch("/api/modules/tasks/v1/runs")).status).toBe(503);
    await expect(localApiFetch("/api/modules/tasks/v1/runs", { signal: controller.signal })).rejects.toThrow("aborted");
    await expect(localApiFetch("/api/diagnostics")).rejects.toThrow("Local API target refused");
    await localApiFetch("/api/modules/tasks/v1/runs");

    expect(bootstrap).toHaveBeenCalledTimes(1);
  });
});
