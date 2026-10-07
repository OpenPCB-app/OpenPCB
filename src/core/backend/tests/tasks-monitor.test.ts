import { afterEach, describe, expect, test } from "bun:test";
import { SqliteAssistantStore } from "agentkit/adapters-sqlite";
import { SingleProcessTaskRunner } from "agentkit/runner-local";
import { createRunMonitor } from "../../../modules/assistant/backend/agentkit/run-monitor";
import { buildTasksSdk } from "../../../modules/tasks/backend/sdk";
import { AGENTKIT_MONITOR_TOKEN } from "../../../sdks/tasks";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";

let store: SqliteAssistantStore | undefined;
afterEach(() => { store?.close(); store = undefined; });

function fixture() {
  store = new SqliteAssistantStore(":memory:");
  const runner = new SingleProcessTaskRunner({ store, recoveryMode: "manual" });
  return { store, runner, monitor: createRunMonitor(store, runner) };
}

describe("Tasks monitors canonical AgentKit runs", () => {
  test("empty pages and missing runs have explicit read-model results", async () => {
    const { monitor } = fixture();
    expect(await monitor.listTasks()).toEqual({ items: [], nextCursor: null });
    expect(await monitor.getTask("missing")).toBeNull();
  });

  test("more than 50 runs page without duplicates and omit execution payload/credentials", async () => {
    const { store, monitor } = fixture();
    for (let index = 0; index < 55; index++) {
      await store.tasks.createTask({ taskId: `run-${String(index).padStart(3, "0")}`, kind: "chat.turn", scopeId: "chat-a",
        payload: { chatId: "chat-a", providerId: "private-generation", apiKeySecretRef: "provider/private", content: "private input" } });
    }
    const first = await monitor.listTasks({ limit: 50 });
    const second = await monitor.listTasks({ limit: 50, cursor: first.nextCursor! });
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.taskId)).size).toBe(55);
    expect(first.items.every((item) => item.chatId === "chat-a")).toBe(true);
    expect(JSON.stringify(first)).not.toContain("private");
    await expect(monitor.listTasks({ limit: 51 })).rejects.toThrow("1 to 50");
    await expect(monitor.listTasks({ cursor: "invalid" })).rejects.toThrow("cursor is invalid");
    await expect(monitor.listTasks({ chatId: "chat-b", cursor: first.nextCursor! })).rejects.toThrow("cursor is invalid");
  });

  test("chat filter, Stop and Continue use the same canonical durable task state", async () => {
    const { store, runner, monitor } = fixture();
    await store.tasks.createTask({ taskId: "cancelled-run", kind: "chat.turn", scopeId: "chat-a", payload: { chatId: "chat-a" } });
    await store.tasks.createTask({ taskId: "continued-run", kind: "chat.turn", scopeId: "chat-b", payload: { chatId: "chat-b" } });
    expect((await monitor.listTasks({ chatId: "chat-a" })).items.map((item) => item.taskId)).toEqual(["cancelled-run"]);
    await monitor.cancelTask("cancelled-run");
    expect((await store.tasks.getTask("cancelled-run"))?.status).toBe("cancelled");
    await runner.recover();
    expect((await monitor.getTask("continued-run"))?.status).toBe("interrupted");
    await monitor.resumeTask("continued-run");
    expect((await store.tasks.getTask("continued-run"))?.status).toBe("queued");
    await expect(monitor.resumeTask("continued-run")).rejects.toThrow();
  });

  test("Tasks SDK delegates to the registered monitor and fails clearly without it", async () => {
    const { monitor } = fixture();
    let available = false;
    const context = { sdk: { get: (token: string) => token === AGENTKIT_MONITOR_TOKEN && available ? monitor : null } } as CoreBackendModuleContext;
    const sdk = buildTasksSdk(context);
    expect(() => sdk.listTasks()).toThrow("AgentKit run monitor is unavailable");
    available = true;
    expect(await sdk.listTasks()).toEqual({ items: [], nextCursor: null });
    expect("createTask" in sdk).toBe(false);
    expect("registerExecutor" in sdk).toBe(false);
  });
});
