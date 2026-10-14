// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TaskRunSummary } from "../../../sdks/tasks";
import { TasksSpace } from "./Space";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), navigate: vi.fn() }));
vi.mock("../../../shared/frontend/http/local-api", () => ({ localApiFetch: mocks.fetch }));
vi.mock("../../../core/frontend/src/stores/navigation-store", () => ({ useNavigationStore: () => mocks.navigate }));
let container: HTMLDivElement;
let root: Root;
function run(index: number, status: TaskRunSummary["status"] = "completed"): TaskRunSummary {
  return { taskId: `run-${index}`, kind: "openpcb.local-chat-turn", scopeId: "scope", status,
    chatId: `chat-${index}`, designId: null, enqueuedAt: "2026-10-07T12:00:00.000Z", startedAt: null,
    finishedAt: null, attemptCount: 1, error: null };
}
async function mount(backendURL: string | null = "http://127.0.0.1:3000") {
  await act(async () => root.render(<TasksSpace moduleId="tasks" namespace="space.tasks" backendURL={backendURL} />));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(item => item.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); mocks.fetch.mockReset(); mocks.navigate.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

test("empty runs and backend errors remain distinct", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ items: [], nextCursor: null }));
  await mount(); expect(container.textContent).toContain("No assistant runs yet.");
  mocks.fetch.mockResolvedValue(Response.json({ detail: "Host is unavailable." }, { status: 503 }));
  await click("Refresh"); expect(container.querySelector('[role="alert"]')?.textContent).toBe("Host is unavailable.");
  expect(container.textContent).not.toContain("No assistant runs yet.");
});

test("missing backend displays a concrete error without sending requests", async () => {
  await mount(null); expect(container.textContent).toContain("Backend is unavailable.");
  expect(mocks.fetch).not.toHaveBeenCalled();
});

test("loads more than 50 runs and opens the corresponding chat", async () => {
  const calls: string[] = [];
  mocks.fetch.mockImplementation(async (url: string) => {
    calls.push(url); const second = new URL(url).searchParams.has("cursor");
    return Response.json({ items: Array.from({ length: second ? 5 : 50 }, (_, index) => run(second ? index + 50 : index)), nextCursor: second ? null : "page-two" });
  });
  await mount(); expect(container.querySelectorAll("button").length).toBe(52);
  await click("Load more runs"); expect(container.querySelectorAll("button").length).toBe(56);
  expect(calls.some(url => url.endsWith("limit=50&cursor=page-two"))).toBe(true);
  expect(container.textContent).toContain("run-54"); expect(container.textContent).not.toContain("Load more runs");
  await click("Open chat"); expect(mocks.navigate).toHaveBeenCalledWith("assistant", undefined, { chatId: "chat-0" });
});

test("Stop and Continue use only canonical lifecycle routes and surface conflicts", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method });
    if (url.endsWith("/resume")) return Response.json({ detail: "Run is no longer interrupted." }, { status: 409 });
    if (url.endsWith("/cancel")) return Response.json({ ok: true });
    return Response.json({ items: [run(1, "running"), run(2, "interrupted"), run(3, "cancelled")], nextCursor: null });
  });
  await mount(); expect(container.textContent).toContain("Stop preserves completed design changes");
  expect([...container.querySelectorAll("button")].filter(button => button.textContent === "Continue")).toHaveLength(1);
  await click("Stop"); await click("Continue");
  expect(calls.filter(call => call.method === "POST")).toEqual([
    { url: "http://127.0.0.1:3000/api/modules/assistant/v1/runs/run-1/cancel", method: "POST" },
    { url: "http://127.0.0.1:3000/api/modules/assistant/v1/runs/run-2/resume", method: "POST" },
  ]);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Run is no longer interrupted.");
});

test("a response slower than the poll interval is not aborted and clears loading when it lands", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    let release!: (response: Response) => void;
    const signals: AbortSignal[] = [];
    mocks.fetch.mockImplementation((_url: string, init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Promise<Response>((resolve) => { release = resolve; });
    });
    await mount();
    await act(async () => { vi.advanceTimersByTime(16_000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(signals[0]!.aborted).toBe(false);
    expect(container.textContent).toContain("Loading runs…");
    await act(async () => { release(Response.json({ items: [run(1)], nextCursor: null })); });
    expect(container.textContent).not.toContain("Loading runs…");
    expect(container.textContent).toContain("run-1");
    mocks.fetch.mockImplementation(async () => Response.json({ items: [run(1), run(2)], nextCursor: null }));
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("run-2");
  } finally { vi.useRealTimers(); }
});

test("malformed bodies and object-valued problem fields show an error with a working retry", async () => {
  mocks.fetch.mockImplementation(async () => new Response("<html>proxy error</html>", { status: 200 }));
  await mount();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("The run monitor returned a malformed response.");
  expect(container.textContent).not.toContain("Loading runs…");
  mocks.fetch.mockImplementation(async () => Response.json({ items: "nope", nextCursor: null }));
  await click("Retry");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("The run monitor returned a malformed response.");
  mocks.fetch.mockImplementation(async () => Response.json({ detail: { code: "x" }, title: "Run monitor offline" }, { status: 503 }));
  await click("Retry");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Run monitor offline");
  mocks.fetch.mockImplementation(async () => Response.json({ detail: { code: "x" } }, { status: 500 }));
  await click("Retry");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Request failed (500)");
  mocks.fetch.mockImplementation(async () => Response.json({
    items: [{ ...run(7, "failed"), error: { code: "PROVIDER", message: "boom" } }], nextCursor: null }));
  await click("Retry");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain('{"code":"PROVIDER","message":"boom"}');
});

test("polling after Load more refreshes only the first page and keeps loaded older runs", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const calls: string[] = [];
    let head = Array.from({ length: 50 }, (_, index) => run(index + 1));
    mocks.fetch.mockImplementation(async (url: string) => {
      calls.push(url);
      return new URL(url).searchParams.has("cursor")
        ? Response.json({ items: [run(51), run(52)], nextCursor: null })
        : Response.json({ items: head, nextCursor: "page-two" });
    });
    await mount();
    await click("Load more runs");
    expect(calls).toHaveLength(2);
    head = [run(0, "running"), ...head.slice(0, 49)];
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(calls).toHaveLength(3);
    expect(new URL(calls[2]!).searchParams.has("cursor")).toBe(false);
    const ids = [...container.querySelectorAll(".break-all")].map((item) => item.textContent!.split(" · ")[0]);
    expect(ids[0]).toBe("run-0");
    expect(ids).toEqual(expect.arrayContaining(["run-50", "run-52"]));
    expect(new Set(ids).size).toBe(ids.length);
  } finally { vi.useRealTimers(); }
});

test("rows link to the owning design when the run's chat is bound", async () => {
  mocks.fetch.mockImplementation(async () => Response.json({ items: [{ ...run(1), designId: "design-9" }, run(2)], nextCursor: null }));
  await mount();
  expect([...container.querySelectorAll("button")].filter((button) => button.textContent === "Open design")).toHaveLength(1);
  await click("Open design");
  expect(mocks.navigate).toHaveBeenCalledWith("designer", "design-9");
});

test("a degraded assistant renders the same unavailable state instead of an error, and clears on recovery", async () => {
  const problem = { type: "https://openpcb.dev/problems/assistant-unavailable", title: "Assistant unavailable", status: 503,
    detail: "The assistant database at /data/agentkit.sqlite is damaged.", code: "ASSISTANT_DATABASE_CORRUPT",
    databasePath: "/data/agentkit.sqlite" };
  mocks.fetch.mockImplementation(async () => new Response(JSON.stringify(problem),
    { status: 503, headers: { "content-type": "application/problem+json" } }));
  await mount();
  const panel = container.querySelector('[data-testid="assistant-unavailable"]');
  expect(panel?.textContent).toContain("Assistant unavailable");
  expect(panel?.textContent).toContain(problem.detail);
  expect(panel?.textContent).toContain("ASSISTANT_DATABASE_CORRUPT");
  expect(panel?.querySelector("code")?.textContent).toBe("/data/agentkit.sqlite");
  expect(container.textContent).not.toContain("Request failed");
  expect(container.textContent).not.toContain("No assistant runs yet.");
  expect(container.textContent).not.toContain("Loading runs…");
  mocks.fetch.mockImplementation(async () => Response.json({ items: [run(1)], nextCursor: null }));
  await click("Refresh");
  expect(container.querySelector('[data-testid="assistant-unavailable"]')).toBeNull();
  expect(container.textContent).toContain("run-1");
});
