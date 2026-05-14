// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { TaskRuntime } from "../../../modules/tasks/backend/runtime/task-runtime";
import { OpenPcbTaskStorage } from "../../../modules/tasks/backend/storage/openpcb-task-storage";

describe("TaskRuntime", () => {
  function createMockStorage(): OpenPcbTaskStorage {
    const rows = new Map<string, unknown>();
    const chunks = new Map<string, Array<Record<string, unknown>>>();
    const events = new Map<string, Array<Record<string, unknown>>>();

    return {
      createTask: async (input) => {
        const id = input.id ?? crypto.randomUUID();
        const task = {
          id,
          type: input.type,
          status: input.status ?? "pending",
          priority: input.priority ?? 5,
          queueKey: input.queueKey ?? "default",
          dependsOn: input.dependsOn ?? null,
          waitingTasks: [],
          payload: input.payload,
          result: null,
          error: null,
          retryCount: 0,
          maxRetries: input.maxRetries ?? 3,
          requestId: input.requestId ?? null,
          correlation: input.correlation ?? null,
          tags: input.tags ?? [],
          metadata: input.metadata ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        };
        rows.set(id, task);
        return task as ReturnType<OpenPcbTaskStorage["createTask"]>;
      },
      updateTask: async (id, patch) => {
        const current = rows.get(id) as Record<string, unknown>;
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
        rows.set(id, next);
        return next as ReturnType<OpenPcbTaskStorage["updateTask"]>;
      },
      getTask: async (id) => (rows.get(id) as ReturnType<OpenPcbTaskStorage["getTask"]> | undefined) ?? null,
      listTasks: async () => [...rows.values()] as ReturnType<OpenPcbTaskStorage["listTasks"]>,
      addWaitingTask: async (parentId, childId) => {
        const task = rows.get(parentId) as Record<string, unknown>;
        const waiting = [...(task.waitingTasks as string[]), childId];
        rows.set(parentId, { ...task, waitingTasks: waiting });
        return rows.get(parentId) as ReturnType<OpenPcbTaskStorage["addWaitingTask"]>;
      },
      removeWaitingTask: async (parentId, childId) => {
        const task = rows.get(parentId) as Record<string, unknown>;
        const waiting = (task.waitingTasks as string[]).filter((id) => id !== childId);
        rows.set(parentId, { ...task, waitingTasks: waiting });
        return rows.get(parentId) as ReturnType<OpenPcbTaskStorage["removeWaitingTask"]>;
      },
      findWaitingOn: async (taskId) => {
        return [...rows.values()].filter((row: unknown) => (row as Record<string, unknown>).dependsOn === taskId && (row as Record<string, unknown>).status === "waiting") as ReturnType<OpenPcbTaskStorage["findWaitingOn"]>;
      },
      findRunning: async () => [...rows.values()].filter((row: unknown) => ["running", "streaming"].includes((row as Record<string, unknown>).status as string)) as ReturnType<OpenPcbTaskStorage["findRunning"]>,
      appendChunks: async (taskId, inputs) => {
        const list = chunks.get(taskId) ?? [];
        const created = inputs.map((input, index) => ({
          id: crypto.randomUUID(),
          taskId,
          seq: index,
          content: input.content,
          kind: input.kind ?? "text",
          metadata: input.metadata ?? null,
          createdAt: new Date().toISOString(),
        }));
        list.push(...created);
        chunks.set(taskId, list);
        return created as ReturnType<OpenPcbTaskStorage["appendChunks"]>;
      },
      getChunks: async (taskId) => (chunks.get(taskId) ?? []) as ReturnType<OpenPcbTaskStorage["getChunks"]>,
      appendEvent: async (event) => {
        const list = events.get(event.taskId) ?? [];
        const persisted = { ...event, id: crypto.randomUUID() };
        list.push(persisted);
        events.set(event.taskId, list);
        return persisted as ReturnType<OpenPcbTaskStorage["appendEvent"]>;
      },
      listEvents: async (taskId) => (events.get(taskId) ?? []) as ReturnType<OpenPcbTaskStorage["listEvents"]>,
    } as unknown as OpenPcbTaskStorage;
  }

  test("creates task and runs echo executor", async () => {
    const storage = createMockStorage();
    const runtime = new TaskRuntime(storage, { info: () => {}, error: () => {} });
    runtime.registerExecutor("tasks.echo", {
      async execute(taskCtx) {
        await taskCtx.emitChunk({ content: "ok", kind: "text" });
        return { done: true };
      },
    });

    const result = await runtime.createTask({ type: "tasks.echo", payload: {} });
    expect(result.task.status).toBeOneOf(["pending", "queued", "running", "completed"]);

    // Allow async execution to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const task = await runtime.getTask(result.task.id);
    expect(task.status).toBe("completed");
    expect(task.result?.success).toBe(true);
  });

  test("cancels running task", async () => {
    const storage = createMockStorage();
    const runtime = new TaskRuntime(storage, { info: () => {}, error: () => {} });
    runtime.registerExecutor("tasks.slow", {
      async execute(taskCtx) {
        await new Promise((resolve, reject) => {
          taskCtx.signal.addEventListener("abort", () => reject(new Error("aborted")));
          setTimeout(() => resolve(undefined), 5000);
        });
        return {};
      },
    });

    const result = await runtime.createTask({ type: "tasks.slow", payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await runtime.cancelTask(result.task.id);

    const task = await runtime.getTask(result.task.id);
    expect(task.status).toBe("cancelled");
  });

  test("dependency completed triggers child", async () => {
    const storage = createMockStorage();
    const runtime = new TaskRuntime(storage, { info: () => {}, error: () => {} });
    runtime.registerExecutor("tasks.echo", {
      async execute(taskCtx) {
        await taskCtx.emitChunk({ content: "echo", kind: "text" });
        return {};
      },
    });

    const parent = await runtime.createTask({ type: "tasks.echo", payload: {} });
    const child = await runtime.createTask({ type: "tasks.echo", payload: {}, dependsOn: parent.task.id });

    expect(child.task.status).toBe("waiting");

    await new Promise((resolve) => setTimeout(resolve, 150));

    const updatedChild = await runtime.getTask(child.task.id);
    expect(updatedChild.status).toBe("completed");
  });

  test("dependency failed pauses child", async () => {
    const storage = createMockStorage();
    const runtime = new TaskRuntime(storage, { info: () => {}, error: () => {} });
    runtime.registerExecutor("tasks.fail", {
      async execute() {
        throw new Error("boom");
      },
    });
    runtime.registerExecutor("tasks.echo", {
      async execute(taskCtx) {
        await taskCtx.emitChunk({ content: "echo", kind: "text" });
        return {};
      },
    });

    const parent = await runtime.createTask({ type: "tasks.fail", payload: {} });
    const child = await runtime.createTask({ type: "tasks.echo", payload: {}, dependsOn: parent.task.id });

    await new Promise((resolve) => setTimeout(resolve, 150));

    const updatedChild = await runtime.getTask(child.task.id);
    expect(updatedChild.status).toBe("paused");
  });
});
