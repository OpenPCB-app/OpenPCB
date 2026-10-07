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
    chatId: `chat-${index}`, enqueuedAt: "2026-10-07T12:00:00.000Z", startedAt: null,
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
