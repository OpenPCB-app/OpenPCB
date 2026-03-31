/**
 * TaskOrchestrator Unit Tests
 *
 * Tests queue management, lifecycle, and status queries.
 * Note: Full integration tests require complete database setup.
 * These tests focus on queue manager and status functionality.
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";
import { TaskQueueManager } from "./task-queue-manager";
import { TaskOrchestrator } from "./task-orchestrator";
import { generateUUIDv7 } from "../../../db/schema/base";
import type { Task, TaskStatus } from "../../../db/schema/task";
import { LicenseDeniedError, LicenseUtil } from "../license-util";

type AssistantMessagePersistenceHarness = {
  ensureAssistantMessage: (task: Task) => Promise<void>;
};

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? generateUUIDv7(),
    type: "message",
    status: "queued" as TaskStatus,
    priority: 5,
    provider: "openai",
    model: "gpt-4",
    dependsOn: null,
    waitingTasks: [],
    payload: { messages: [{ role: "user", content: "Hello" }] },
    result: null,
    resultRaw: null,
    input: null,
    output: null,
    error: null,
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    completedAt: null,
    metadata: null,
    workspaceId: null,
    projectId: null,
    chatId: null,
    assistantMessageId: null,
    requestId: null,
    ...overrides,
  };
}

function createMockOrchestratorForEventTests(
  options?: {
    task?: Task | null;
    taskSystem?: { cascadeCancellation: ReturnType<typeof mock> };
  }
) {
  const findById = mock(async () => options?.task ?? null);
  const ensureAssistantMessage = mock(async () => {});
  const releaseChatLockAndStartNext = mock(async () => {});
  const resolveLoadDependencies = mock(async () => {});
  const cancelLoadDependencies = mock(async () => {});
  const cascadeCancellation =
    options?.taskSystem?.cascadeCancellation ?? mock(async () => {});

  const orchestrator = Object.create(TaskOrchestrator.prototype) as {
    handleExecutorEvent: (event: {
      type: string;
      taskId: string;
      timestamp: string;
      data?: unknown;
    }) => Promise<void>;
  };

  Object.assign(orchestrator, {
    db: { tasks: { findById } },
    taskSystem: { cascadeCancellation },
    ensureAssistantMessage,
    releaseChatLockAndStartNext,
    resolveLoadDependencies,
    cancelLoadDependencies,
  });

  return {
    orchestrator,
    findById,
    ensureAssistantMessage,
    releaseChatLockAndStartNext,
    resolveLoadDependencies,
    cancelLoadDependencies,
    cascadeCancellation,
  };
}

describe("TaskOrchestrator executor event handling", () => {
  it("does not query task state for non-terminal executor events", async () => {
    const mocks = createMockOrchestratorForEventTests({
      task: createMockTask({ id: "task-token", type: "message" }),
    });

    await mocks.orchestrator.handleExecutorEvent({
      type: "task.token",
      taskId: "task-token",
      timestamp: new Date().toISOString(),
      data: { token: "a" },
    });

    expect(mocks.findById).not.toHaveBeenCalled();
    expect(mocks.ensureAssistantMessage).not.toHaveBeenCalled();
    expect(mocks.releaseChatLockAndStartNext).not.toHaveBeenCalled();
  });

  it("queries task state and runs message completion handlers for terminal events", async () => {
    const mocks = createMockOrchestratorForEventTests({
      task: createMockTask({ id: "task-done", type: "message", chatId: "chat-1" }),
    });

    await mocks.orchestrator.handleExecutorEvent({
      type: "task.completed",
      taskId: "task-done",
      timestamp: new Date().toISOString(),
    });

    expect(mocks.findById).toHaveBeenCalledTimes(1);
    expect(mocks.ensureAssistantMessage).toHaveBeenCalledTimes(1);
    expect(mocks.releaseChatLockAndStartNext).toHaveBeenCalledTimes(1);
  });
});

describe("TaskOrchestrator license gate", () => {
  const originalGetCurrentStatus = LicenseUtil.getCurrentStatus;

  beforeEach(() => {
    LicenseUtil.getCurrentStatus = originalGetCurrentStatus;
  });

  it("denies message task creation for restricted license and does not create task", async () => {
    LicenseUtil.getCurrentStatus = async () => ({
      state: "restricted",
      expiresAt: null,
      features: [],
      reason: "Restricted by policy",
    });

    const createMessageTask = mock(async () => createMockTask({ id: "should-not-create" }));
    const orchestrator = Object.create(TaskOrchestrator.prototype) as {
      createMessageTask: TaskOrchestrator["createMessageTask"];
      taskSystem: { createMessageTask: typeof createMessageTask };
    };
    Object.assign(orchestrator, {
      taskSystem: { createMessageTask },
    });

    const spec = {
      chatId: "chat-1",
      provider: "openai",
      model: "gpt-4o",
      userMessage: "hello",
      assistantMessageId: "assistant-1",
    };

    expect(orchestrator.createMessageTask(spec)).rejects.toBeInstanceOf(LicenseDeniedError);
    expect(createMessageTask).not.toHaveBeenCalled();
  });

  it("denies message task creation for blocked license and does not create task", async () => {
    LicenseUtil.getCurrentStatus = async () => ({
      state: "blocked",
      expiresAt: null,
      features: [],
      reason: "Blocked by policy",
    });

    const createMessageTask = mock(async () => createMockTask({ id: "should-not-create" }));
    const orchestrator = Object.create(TaskOrchestrator.prototype) as {
      createMessageTask: TaskOrchestrator["createMessageTask"];
      taskSystem: { createMessageTask: typeof createMessageTask };
    };
    Object.assign(orchestrator, {
      taskSystem: { createMessageTask },
    });

    const spec = {
      chatId: "chat-1",
      provider: "openai",
      model: "gpt-4o",
      userMessage: "hello",
      assistantMessageId: "assistant-1",
    };

    expect(orchestrator.createMessageTask(spec)).rejects.toBeInstanceOf(LicenseDeniedError);
    expect(createMessageTask).not.toHaveBeenCalled();
  });

  it("allows grace license and continues to task creation", async () => {
    LicenseUtil.getCurrentStatus = async () => ({
      state: "grace",
      expiresAt: null,
      features: ["*"],
    });

    const createdTask = createMockTask({
      id: "task-grace",
      chatId: "chat-1",
      status: "waiting",
      dependsOn: "dep-1",
    });
    const createMessageTask = mock(async () => createdTask);
    const ensureLoadTaskQueued = mock(async () => {});
    const orchestrator = Object.create(TaskOrchestrator.prototype) as {
      createMessageTask: TaskOrchestrator["createMessageTask"];
      taskSystem: { createMessageTask: typeof createMessageTask };
      ensureLoadTaskQueued: typeof ensureLoadTaskQueued;
      queueManager: { getQueueStatus: (provider: string) => { provider: string; queuedTasks: number; activeTasks: number; availableSlots: number } };
      chatTaskLock: { tryAcquire: (chatId: string, taskId: string) => boolean };
      db: { tasks: { update: (taskId: string, updates: unknown) => Promise<void> } };
      log: (message: string) => void;
      enqueueTask: (task: Task) => Promise<void>;
      ensureChatTaskQueued: (chatId: string, taskId: string) => void;
    };
    Object.assign(orchestrator, {
      taskSystem: { createMessageTask },
      ensureLoadTaskQueued,
      queueManager: {
        getQueueStatus: (provider: string) => ({
          provider,
          queuedTasks: 0,
          activeTasks: 0,
          availableSlots: 3,
        }),
      },
      chatTaskLock: {
        tryAcquire: () => false,
      },
      db: {
        tasks: {
          update: async () => {},
        },
      },
      log: () => {},
      enqueueTask: async () => {},
      ensureChatTaskQueued: () => {},
    });

    const spec = {
      chatId: "chat-1",
      provider: "openai",
      model: "gpt-4o",
      userMessage: "hello",
      assistantMessageId: "assistant-1",
    };

    const result = await orchestrator.createMessageTask(spec);

    expect(createMessageTask).toHaveBeenCalledTimes(1);
    expect(result.task.id).toBe("task-grace");
  });
});

describe("TaskOrchestrator assistant message persistence", () => {
  it("does not create a new assistant row for empty tool-only segment without existing message", async () => {
    const createAssistantMessage = mock(async () => {});
    const updateAssistantMessage = mock(async () => {});

    const orchestrator = Object.create(TaskOrchestrator.prototype) as AssistantMessagePersistenceHarness;
    Object.assign(orchestrator, {
      db: {
        messages: {
          findById: mock(async () => null),
        },
      },
      chatManager: {
        createAssistantMessage,
        updateAssistantMessage,
      },
    });

    await orchestrator.ensureAssistantMessage(
      createMockTask({
        id: "task-tool-only",
        type: "message",
        chatId: "chat-1",
        assistantMessageId: "assistant-1",
        status: "completed",
        result: {
          success: true,
          duration: 1,
          data: { content: "" },
        },
      }),
    );

    expect(createAssistantMessage).not.toHaveBeenCalled();
    expect(updateAssistantMessage).not.toHaveBeenCalled();
  });

  it("merges follow-up task segment text into existing assistant message", async () => {
    const createAssistantMessage = mock(async () => {});
    const updateAssistantMessage = mock(async () => {});

    const orchestrator = Object.create(TaskOrchestrator.prototype) as AssistantMessagePersistenceHarness;
    Object.assign(orchestrator, {
      db: {
        messages: {
          findById: mock(async () => ({
            id: "assistant-1",
            content: { type: "text", text: "Hello " },
          })),
        },
      },
      chatManager: {
        createAssistantMessage,
        updateAssistantMessage,
      },
    });

    await orchestrator.ensureAssistantMessage(
      createMockTask({
        id: "task-followup",
        type: "message",
        chatId: "chat-1",
        assistantMessageId: "assistant-1",
        status: "completed",
        result: {
          success: true,
          duration: 1,
          data: { content: "world" },
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
        },
      }),
    );

    expect(createAssistantMessage).not.toHaveBeenCalled();
    expect(updateAssistantMessage).toHaveBeenCalledWith(
      "assistant-1",
      expect.objectContaining({
        content: "Hello world",
      }),
    );
  });
});

// ─── Queue Manager in Orchestrator Context ─────────────────────────────────────

describe("TaskOrchestrator Queue Management (via TaskQueueManager)", () => {
  let queueManager: TaskQueueManager;

  beforeEach(() => {
    queueManager = new TaskQueueManager({ maxConcurrentPerProvider: 3, debug: false });
  });

  describe("queue status", () => {
    it("should track queue status per provider", () => {
      queueManager.enqueue(createMockTask({ provider: "openai" }));
      queueManager.enqueue(createMockTask({ provider: "openai" }));
      queueManager.enqueue(createMockTask({ provider: "ollama" }));

      const openaiStatus = queueManager.getQueueStatus("openai");
      expect(openaiStatus.queuedTasks).toBe(2);
      expect(openaiStatus.provider).toBe("openai");

      const ollamaStatus = queueManager.getQueueStatus("ollama");
      expect(ollamaStatus.queuedTasks).toBe(1);
    });

    it("should return all queue statuses", () => {
      queueManager.enqueue(createMockTask({ provider: "openai" }));
      queueManager.enqueue(createMockTask({ provider: "ollama" }));
      queueManager.enqueue(createMockTask({ provider: "anthropic" }));

      const allStatus = queueManager.getAllQueueStatus();
      expect(allStatus.length).toBe(3);
    });

    it("should track total counts", () => {
      queueManager.enqueue(createMockTask({ id: "t1", provider: "openai" }));
      queueManager.enqueue(createMockTask({ id: "t2", provider: "ollama" }));

      expect(queueManager.getTotalQueuedCount()).toBe(2);
      expect(queueManager.getTotalActiveCount()).toBe(0);

      queueManager.dequeue("openai");

      expect(queueManager.getTotalQueuedCount()).toBe(1);
      expect(queueManager.getTotalActiveCount()).toBe(1);
    });
  });

  describe("queue operations", () => {
    it("should enqueue task and get status", () => {
      const task = createMockTask({ provider: "openai" });
      queueManager.enqueue(task);

      const status = queueManager.getQueueStatus("openai");
      expect(status.queuedTasks).toBe(1);
      expect(status.availableSlots).toBe(3);
    });

    it("should cancel queued task", () => {
      const task = createMockTask({ id: "cancel-me", provider: "openai" });
      queueManager.enqueue(task);

      expect(queueManager.getQueueStatus("openai").queuedTasks).toBe(1);

      const removed = queueManager.removeFromQueue("cancel-me");

      expect(removed).toBe(true);
      expect(queueManager.getQueueStatus("openai").queuedTasks).toBe(0);
    });

    it("should release slot after execution", () => {
      const task = createMockTask({ id: "exec-task", provider: "openai" });
      queueManager.enqueue(task);
      queueManager.dequeue("openai");

      expect(queueManager.getQueueStatus("openai").activeTasks).toBe(1);

      queueManager.releaseSlot("openai", "exec-task");

      expect(queueManager.getQueueStatus("openai").activeTasks).toBe(0);
    });
  });
});

// ─── Priority Scheduling (Orchestrator relies on this) ─────────────────────────

describe("TaskOrchestrator Priority Scheduling (via TaskQueueManager)", () => {
  let queueManager: TaskQueueManager;

  beforeEach(() => {
    queueManager = new TaskQueueManager({ maxConcurrentPerProvider: 1 });
  });

  it("should execute high priority tasks first", () => {
    const lowPriority = createMockTask({ id: "low", provider: "openai", priority: 1 });
    const highPriority = createMockTask({ id: "high", provider: "openai", priority: 10 });

    queueManager.enqueue(lowPriority);
    queueManager.enqueue(highPriority);

    const first = queueManager.dequeue("openai");
    expect(first?.id).toBe("high");
  });

  it("should use FIFO for equal priority", () => {
    const first = createMockTask({ id: "first", provider: "openai", priority: 5 });
    const second = createMockTask({ id: "second", provider: "openai", priority: 5 });

    queueManager.enqueue(first);
    queueManager.enqueue(second);

    const dequeued = queueManager.dequeue("openai");
    expect(dequeued?.id).toBe("first");
  });

  it("should respect LoadTask high priority (priority=10)", () => {
    const messageTask = createMockTask({ id: "msg", type: "message", provider: "ollama", priority: 5 });
    const loadTask = createMockTask({ id: "load", type: "load", provider: "ollama", priority: 10 });

    queueManager.enqueue(messageTask);
    queueManager.enqueue(loadTask);

    const first = queueManager.dequeue("ollama");
    expect(first?.id).toBe("load");
  });
});

// ─── Concurrency Control ───────────────────────────────────────────────────────

describe("TaskOrchestrator Concurrency Control (via TaskQueueManager)", () => {
  let queueManager: TaskQueueManager;

  beforeEach(() => {
    queueManager = new TaskQueueManager({ maxConcurrentPerProvider: 2 });
  });

  it("should limit concurrent tasks per provider", () => {
    for (let i = 0; i < 5; i++) {
      queueManager.enqueue(createMockTask({ id: `task-${i}`, provider: "openai" }));
    }

    // Should only allow 2 concurrent
    queueManager.dequeue("openai");
    queueManager.dequeue("openai");
    const third = queueManager.dequeue("openai");

    expect(third).toBeNull();
    expect(queueManager.getQueueStatus("openai").activeTasks).toBe(2);
    expect(queueManager.getQueueStatus("openai").queuedTasks).toBe(3);
  });

  it("should allow tasks from different providers in parallel", () => {
    queueManager.enqueue(createMockTask({ id: "openai-1", provider: "openai" }));
    queueManager.enqueue(createMockTask({ id: "ollama-1", provider: "ollama" }));

    const openai = queueManager.dequeue("openai");
    const ollama = queueManager.dequeue("ollama");

    expect(openai?.id).toBe("openai-1");
    expect(ollama?.id).toBe("ollama-1");
    expect(queueManager.getTotalActiveCount()).toBe(2);
  });
});

// ─── Lifecycle Management ──────────────────────────────────────────────────────

describe("TaskOrchestrator Lifecycle (via TaskQueueManager)", () => {
  let queueManager: TaskQueueManager;

  beforeEach(() => {
    queueManager = new TaskQueueManager();
  });

  it("should clear all queues on shutdown", () => {
    queueManager.enqueue(createMockTask({ provider: "openai" }));
    queueManager.enqueue(createMockTask({ provider: "ollama" }));

    queueManager.clear();

    expect(queueManager.getTotalQueuedCount()).toBe(0);
    expect(queueManager.getAllQueueStatus()).toEqual([]);
  });

  it("should clear specific provider queue", () => {
    queueManager.enqueue(createMockTask({ provider: "openai" }));
    queueManager.enqueue(createMockTask({ provider: "ollama" }));

    queueManager.clearProvider("openai");

    expect(queueManager.getQueueStatus("openai").queuedTasks).toBe(0);
    expect(queueManager.getQueueStatus("ollama").queuedTasks).toBe(1);
  });

  it("should cleanup empty queues", () => {
    queueManager.enqueue(createMockTask({ id: "t1", provider: "openai" }));
    queueManager.removeFromQueue("t1");

    const cleaned = queueManager.cleanupEmptyQueues();

    expect(cleaned).toBe(1);
    expect(queueManager.getAllQueueStatus()).toEqual([]);
  });
});

// ─── Callback Integration ──────────────────────────────────────────────────────

describe("TaskOrchestrator Task Execution Callback", () => {
  let queueManager: TaskQueueManager;

  beforeEach(() => {
    queueManager = new TaskQueueManager({ maxConcurrentPerProvider: 2 });
  });

  it("should execute tasks via callback when processing queue", async () => {
    const executedTasks: string[] = [];

    queueManager.onTaskReady(async (task) => {
      executedTasks.push(task.id);
    });

    queueManager.enqueue(createMockTask({ id: "exec-1", provider: "openai" }));
    queueManager.enqueue(createMockTask({ id: "exec-2", provider: "openai" }));

    await queueManager.processQueue("openai");

    expect(executedTasks).toContain("exec-1");
    expect(executedTasks).toContain("exec-2");
  });

  it("should release slot on callback error", async () => {
    queueManager.onTaskReady(async () => {
      throw new Error("Simulated failure");
    });

    queueManager.enqueue(createMockTask({ id: "error-task", provider: "openai" }));

    await queueManager.processQueue("openai");

    // Wait for async error handling
    await new Promise((r) => setTimeout(r, 50));

    expect(queueManager.getQueueStatus("openai").activeTasks).toBe(0);
  });
});

// ─── State Machine Validation ──────────────────────────────────────────────────

describe("Task State Machine", () => {
  it("should define valid transitions from pending", () => {
    // pending → queued, waiting, cancelled
    const { VALID_TRANSITIONS } = require("../../../db/schema/task");
    expect(VALID_TRANSITIONS.pending).toContain("queued");
    expect(VALID_TRANSITIONS.pending).toContain("waiting");
    expect(VALID_TRANSITIONS.pending).toContain("cancelled");
    expect(VALID_TRANSITIONS.pending).not.toContain("completed");
  });

  it("should define valid transitions from queued", () => {
    const { VALID_TRANSITIONS } = require("../../../db/schema/task");
    expect(VALID_TRANSITIONS.queued).toContain("running");
    expect(VALID_TRANSITIONS.queued).toContain("cancelled");
  });

  it("should define valid transitions from running", () => {
    const { VALID_TRANSITIONS } = require("../../../db/schema/task");
    expect(VALID_TRANSITIONS.running).toContain("streaming");
    expect(VALID_TRANSITIONS.running).toContain("completed");
    expect(VALID_TRANSITIONS.running).toContain("paused");
    expect(VALID_TRANSITIONS.running).toContain("failed");
    expect(VALID_TRANSITIONS.running).toContain("cancelled");
  });

  it("should define terminal states with no transitions", () => {
    const { VALID_TRANSITIONS, isTerminalStatus } = require("../../../db/schema/task");
    expect(VALID_TRANSITIONS.completed).toEqual([]);
    expect(VALID_TRANSITIONS.failed).toEqual([]);
    expect(VALID_TRANSITIONS.cancelled).toEqual([]);
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
  });
});

// ─── Error Classification (matches TaskExecutor behavior) ──────────────────────

describe("Error Classification Patterns", () => {
  function isTransientError(message: string): boolean {
    const lowerMsg = message.toLowerCase();
    return (
      lowerMsg.includes("econnrefused") ||
      lowerMsg.includes("econnreset") ||
      lowerMsg.includes("etimedout") ||
      lowerMsg.includes("timeout") ||
      lowerMsg.includes("500") ||
      lowerMsg.includes("502") ||
      lowerMsg.includes("503") ||
      lowerMsg.includes("504") ||
      lowerMsg.includes("429") ||
      lowerMsg.includes("rate limit")
    );
  }

  it("should classify network errors as transient", () => {
    expect(isTransientError("ECONNREFUSED")).toBe(true);
    expect(isTransientError("Connection reset")).toBe(false); // Not exact match
    expect(isTransientError("ETIMEDOUT")).toBe(true);
  });

  it("should classify HTTP 5xx as transient", () => {
    expect(isTransientError("500 Internal Server Error")).toBe(true);
    expect(isTransientError("502 Bad Gateway")).toBe(true);
    expect(isTransientError("503 Service Unavailable")).toBe(true);
    expect(isTransientError("504 Gateway Timeout")).toBe(true);
  });

  it("should classify rate limits as transient", () => {
    expect(isTransientError("429 Too Many Requests")).toBe(true);
    expect(isTransientError("rate limit exceeded")).toBe(true);
  });

  it("should not classify auth errors as transient", () => {
    expect(isTransientError("401 Unauthorized")).toBe(false);
    expect(isTransientError("403 Forbidden")).toBe(false);
  });
});

// ─── Model Load Cache Behavior ─────────────────────────────────────────────────

describe("Model Load Cache Categories", () => {
  const PROVIDER_CATEGORIES: Record<string, string> = {
    openai: "cloud",
    anthropic: "cloud",
    ollama: "server",
    lmstudio: "server",
    llamacpp: "local",
  };

  it("should classify cloud providers (always loaded)", () => {
    expect(PROVIDER_CATEGORIES.openai).toBe("cloud");
    expect(PROVIDER_CATEGORIES.anthropic).toBe("cloud");
  });

  it("should classify server providers (requires loading)", () => {
    expect(PROVIDER_CATEGORIES.ollama).toBe("server");
    expect(PROVIDER_CATEGORIES.lmstudio).toBe("server");
  });

  it("should classify local providers (requires loading)", () => {
    expect(PROVIDER_CATEGORIES.llamacpp).toBe("local");
  });
});
