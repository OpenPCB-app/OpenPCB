/**
 * TaskQueueManager Unit Tests
 *
 * Tests priority queue operations, slot management, and concurrency control.
 */

import { describe, expect, it, mock, beforeEach } from "bun:test";
import { TaskQueueManager, type QueueConfig } from "./task-queue-manager";
import type { Task, TaskStatus } from "../../../db/schema/task";

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "message",
    status: "queued" as TaskStatus,
    priority: 5,
    provider: "ollama",
    model: "llama3",
    dependsOn: null,
    waitingTasks: [],
    payload: { messages: [{ role: "user", content: "test" }] },
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

// ─── Basic Operations ──────────────────────────────────────────────────────────

describe("TaskQueueManager", () => {
  let queueManager: TaskQueueManager;

  beforeEach(() => {
    queueManager = new TaskQueueManager({ maxConcurrentPerProvider: 3, debug: false });
  });

  describe("enqueue", () => {
    it("should add task to provider queue", () => {
      const task = createMockTask({ provider: "ollama" });
      queueManager.enqueue(task);

      const status = queueManager.getQueueStatus("ollama");
      expect(status.queuedTasks).toBe(1);
      expect(status.activeTasks).toBe(0);
    });

    it("should not add duplicate task", () => {
      const task = createMockTask({ id: "dupe-task", provider: "ollama" });
      queueManager.enqueue(task);
      queueManager.enqueue(task); // Try to add again

      const status = queueManager.getQueueStatus("ollama");
      expect(status.queuedTasks).toBe(1);
    });

    it("should create separate queues per provider", () => {
      const ollamaTask = createMockTask({ provider: "ollama" });
      const openaiTask = createMockTask({ provider: "openai" });

      queueManager.enqueue(ollamaTask);
      queueManager.enqueue(openaiTask);

      expect(queueManager.getQueueStatus("ollama").queuedTasks).toBe(1);
      expect(queueManager.getQueueStatus("openai").queuedTasks).toBe(1);
      expect(queueManager.getTotalQueuedCount()).toBe(2);
    });
  });

  describe("dequeue", () => {
    it("should return highest priority task first", () => {
      const lowPriority = createMockTask({ id: "low", provider: "ollama", priority: 1 });
      const highPriority = createMockTask({ id: "high", provider: "ollama", priority: 10 });
      const midPriority = createMockTask({ id: "mid", provider: "ollama", priority: 5 });

      queueManager.enqueue(lowPriority);
      queueManager.enqueue(highPriority);
      queueManager.enqueue(midPriority);

      const dequeued = queueManager.dequeue("ollama");
      expect(dequeued?.id).toBe("high");
    });

    it("should use FIFO for same priority", () => {
      const first = createMockTask({ id: "first", provider: "ollama", priority: 5 });
      const second = createMockTask({ id: "second", provider: "ollama", priority: 5 });

      queueManager.enqueue(first);
      // Small delay to ensure different enqueue time
      queueManager.enqueue(second);

      const dequeued1 = queueManager.dequeue("ollama");
      expect(dequeued1?.id).toBe("first");

      queueManager.releaseSlot("ollama", "first");

      const dequeued2 = queueManager.dequeue("ollama");
      expect(dequeued2?.id).toBe("second");
    });

    it("should mark dequeued task as active", () => {
      const task = createMockTask({ provider: "ollama" });
      queueManager.enqueue(task);

      queueManager.dequeue("ollama");

      expect(queueManager.isTaskActive(task.id)).toBe(true);
      expect(queueManager.getQueueStatus("ollama").activeTasks).toBe(1);
    });

    it("should return null when queue empty", () => {
      const result = queueManager.dequeue("nonexistent");
      expect(result).toBeNull();
    });

    it("should return null when no slots available", () => {
      // Fill up all slots
      for (let i = 0; i < 3; i++) {
        const task = createMockTask({ id: `fill-${i}`, provider: "ollama" });
        queueManager.enqueue(task);
        queueManager.dequeue("ollama");
      }

      // Try to add and dequeue another
      const extraTask = createMockTask({ id: "extra", provider: "ollama" });
      queueManager.enqueue(extraTask);

      const result = queueManager.dequeue("ollama");
      expect(result).toBeNull();
    });
  });

  describe("releaseSlot", () => {
    it("should free up slot for new tasks", () => {
      const task1 = createMockTask({ id: "task1", provider: "ollama" });
      const task2 = createMockTask({ id: "task2", provider: "ollama" });

      queueManager.enqueue(task1);
      queueManager.enqueue(task2);

      // Dequeue first task (marks as active)
      queueManager.dequeue("ollama");
      expect(queueManager.getQueueStatus("ollama").activeTasks).toBe(1);

      // Release slot
      queueManager.releaseSlot("ollama", task1.id);
      expect(queueManager.getQueueStatus("ollama").activeTasks).toBe(0);
      expect(queueManager.isTaskActive(task1.id)).toBe(false);
    });
  });

  describe("removeFromQueue", () => {
    it("should remove queued task", () => {
      const task = createMockTask({ id: "to-remove", provider: "ollama" });
      queueManager.enqueue(task);

      const removed = queueManager.removeFromQueue("to-remove");

      expect(removed).toBe(true);
      expect(queueManager.getQueueStatus("ollama").queuedTasks).toBe(0);
    });

    it("should return false if task not found", () => {
      const removed = queueManager.removeFromQueue("nonexistent");
      expect(removed).toBe(false);
    });
  });
});

// ─── Concurrency Control ───────────────────────────────────────────────────────

describe("TaskQueueManager Concurrency", () => {
  it("should respect maxConcurrentPerProvider", () => {
    const queueManager = new TaskQueueManager({ maxConcurrentPerProvider: 2 });

    // Enqueue 5 tasks
    for (let i = 0; i < 5; i++) {
      queueManager.enqueue(createMockTask({ id: `task-${i}`, provider: "ollama" }));
    }

    // Dequeue should only succeed twice
    expect(queueManager.dequeue("ollama")).not.toBeNull();
    expect(queueManager.dequeue("ollama")).not.toBeNull();
    expect(queueManager.dequeue("ollama")).toBeNull(); // No slots left

    const status = queueManager.getQueueStatus("ollama");
    expect(status.activeTasks).toBe(2);
    expect(status.queuedTasks).toBe(3);
    expect(status.availableSlots).toBe(0);
  });

  it("should allow concurrent tasks across providers", () => {
    const queueManager = new TaskQueueManager({ maxConcurrentPerProvider: 1 });

    queueManager.enqueue(createMockTask({ id: "ollama-1", provider: "ollama" }));
    queueManager.enqueue(createMockTask({ id: "openai-1", provider: "openai" }));

    // Both should dequeue successfully (different providers)
    expect(queueManager.dequeue("ollama")).not.toBeNull();
    expect(queueManager.dequeue("openai")).not.toBeNull();

    expect(queueManager.getTotalActiveCount()).toBe(2);
  });
});

// ─── Config Validation ─────────────────────────────────────────────────────────

describe("TaskQueueManager Config", () => {
  it("should reject invalid concurrent limit (too low)", () => {
    const queueManager = new TaskQueueManager();
    expect(() => queueManager.setMaxConcurrent(0)).toThrow();
    expect(() => queueManager.setMaxConcurrent(-1)).toThrow();
  });

  it("should reject invalid concurrent limit (too high)", () => {
    const queueManager = new TaskQueueManager();
    expect(() => queueManager.setMaxConcurrent(101)).toThrow();
    expect(() => queueManager.setMaxConcurrent(1000)).toThrow();
  });

  it("should accept valid concurrent limit", () => {
    const queueManager = new TaskQueueManager();
    expect(() => queueManager.setMaxConcurrent(1)).not.toThrow();
    expect(() => queueManager.setMaxConcurrent(50)).not.toThrow();
    expect(() => queueManager.setMaxConcurrent(100)).not.toThrow();
  });
});

// ─── Callback Integration ──────────────────────────────────────────────────────

describe("TaskQueueManager processQueue", () => {
  it("should call onTaskReady callback", async () => {
    const queueManager = new TaskQueueManager({ maxConcurrentPerProvider: 2 });
    const executedTasks: string[] = [];

    queueManager.onTaskReady(async (task) => {
      executedTasks.push(task.id);
    });

    const task1 = createMockTask({ id: "cb-task-1", provider: "ollama" });
    const task2 = createMockTask({ id: "cb-task-2", provider: "ollama" });

    queueManager.enqueue(task1);
    queueManager.enqueue(task2);

    await queueManager.processQueue("ollama");

    // Both should have been executed (maxConcurrent=2)
    expect(executedTasks).toContain("cb-task-1");
    expect(executedTasks).toContain("cb-task-2");
  });

  it("should release slot on callback error", async () => {
    const queueManager = new TaskQueueManager({ maxConcurrentPerProvider: 1 });

    queueManager.onTaskReady(async (task) => {
      throw new Error("Simulated failure");
    });

    const task = createMockTask({ id: "error-task", provider: "ollama" });
    queueManager.enqueue(task);

    await queueManager.processQueue("ollama");

    // Wait for async error handling
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Slot should be released after error
    expect(queueManager.getQueueStatus("ollama").activeTasks).toBe(0);
  });
});

// ─── Cleanup Methods ───────────────────────────────────────────────────────────

describe("TaskQueueManager Cleanup", () => {
  it("should clear all queues", () => {
    const queueManager = new TaskQueueManager();

    queueManager.enqueue(createMockTask({ provider: "ollama" }));
    queueManager.enqueue(createMockTask({ provider: "openai" }));

    queueManager.clear();

    expect(queueManager.getTotalQueuedCount()).toBe(0);
    expect(queueManager.getAllQueueStatus()).toEqual([]);
  });

  it("should clear specific provider queue", () => {
    const queueManager = new TaskQueueManager();

    queueManager.enqueue(createMockTask({ provider: "ollama" }));
    queueManager.enqueue(createMockTask({ provider: "openai" }));

    queueManager.clearProvider("ollama");

    expect(queueManager.getQueueStatus("ollama").queuedTasks).toBe(0);
    expect(queueManager.getQueueStatus("openai").queuedTasks).toBe(1);
  });

  it("should cleanup empty queues", () => {
    const queueManager = new TaskQueueManager();

    const task = createMockTask({ provider: "ollama" });
    queueManager.enqueue(task);
    queueManager.removeFromQueue(task.id);

    const cleaned = queueManager.cleanupEmptyQueues();

    expect(cleaned).toBe(1);
    expect(queueManager.getAllQueueStatus()).toEqual([]);
  });

  it("should not cleanup queues with active tasks", () => {
    const queueManager = new TaskQueueManager();

    const task = createMockTask({ provider: "ollama" });
    queueManager.enqueue(task);
    queueManager.dequeue("ollama"); // Mark as active

    const cleaned = queueManager.cleanupEmptyQueues();

    expect(cleaned).toBe(0);
    expect(queueManager.getAllQueueStatus().length).toBe(1);
  });
});

// ─── Status Queries ────────────────────────────────────────────────────────────

describe("TaskQueueManager Status", () => {
  it("should return correct queue status", () => {
    const queueManager = new TaskQueueManager({ maxConcurrentPerProvider: 3 });

    queueManager.enqueue(createMockTask({ id: "t1", provider: "ollama" }));
    queueManager.enqueue(createMockTask({ id: "t2", provider: "ollama" }));
    queueManager.dequeue("ollama"); // Mark t1 as active

    const status = queueManager.getQueueStatus("ollama");

    expect(status.provider).toBe("ollama");
    expect(status.queuedTasks).toBe(1);
    expect(status.activeTasks).toBe(1);
    expect(status.availableSlots).toBe(2);
    expect(status.maxConcurrent).toBe(3);
  });

  it("should return status for nonexistent provider", () => {
    const queueManager = new TaskQueueManager({ maxConcurrentPerProvider: 3 });

    const status = queueManager.getQueueStatus("nonexistent");

    expect(status.provider).toBe("nonexistent");
    expect(status.queuedTasks).toBe(0);
    expect(status.activeTasks).toBe(0);
    expect(status.availableSlots).toBe(3);
  });

  it("should track active tasks correctly", () => {
    const queueManager = new TaskQueueManager();

    const task = createMockTask({ id: "active-test", provider: "ollama" });
    queueManager.enqueue(task);

    expect(queueManager.isTaskActive("active-test")).toBe(false);

    queueManager.dequeue("ollama");

    expect(queueManager.isTaskActive("active-test")).toBe(true);
    expect(queueManager.getActiveTasks("ollama")).toContain("active-test");
  });
});
