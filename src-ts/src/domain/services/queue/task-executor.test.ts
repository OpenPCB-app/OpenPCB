/**
 * TaskExecutor Unit Tests
 *
 * Tests task execution, streaming, error handling, and cancellation.
 */

import { describe, expect, it, mock, beforeEach, spyOn } from "bun:test";
import { TaskExecutor, type ExecutionEvent, type ExecutorConfig } from "./task-executor";
import type { Task, TaskStatus, MessagePayload, LoadPayload } from "../../../db/schema/task";
import type { ChatRequest, ChatResult, StreamCallbacks, ToolDefinition } from "../../../infrastructure/ai-providers/engine";

// ─── Mock Setup ────────────────────────────────────────────────────────────────

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
    payload: {
      chatId: "chat-123",
      messages: [{ role: "user", content: "Hello" }],
      userMessage: "Hello",
      stream: true,
    } as MessagePayload,
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
    assistantMessageId: "assistant-1",
    requestId: null,
    ...overrides,
  };
}

function createMockDependencies() {
  const mockDb = {
    tasks: {
      update: mock(async () => {}),
      findById: mock(async () => null),
    },
    taskChunks: {
      deleteChunks: mock(async () => 0),
    },
    taskToolEvents: {
      listByAssistantMessageId: mock(async () => []),
      appendToolCall: mock(async () => ({})),
      appendToolResult: mock(async () => ({})),
    },
  };

  const mockEngine = {
    stream: mock(async (request: any, callbacks: StreamCallbacks): Promise<ChatResult> => {
      // Simulate streaming tokens
      callbacks.onToken?.("Hello");
      callbacks.onToken?.(", ");
      callbacks.onToken?.("World!");
      callbacks.onComplete?.({
        text: "Hello, World!",
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      } as ChatResult);
      return {
        text: "Hello, World!",
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    }),
    isModelLoaded: mock(async () => false),
    preloadModel: mock(async () => true),
  };

  const mockProviderRegistry = {
    get: mock(async () => mockEngine),
  };

  const mockQueueManager = {
    releaseSlot: mock(() => {}),
    processQueue: mock(async () => {}),
  };

  const mockModelLoadCache = {
    markLoaded: mock(() => {}),
    isLoaded: mock(async () => false),
    releaseLoadLock: mock(() => {}),
    releaseLoadLockWithError: mock(() => {}),
  };

  return {
    mockDb,
    mockEngine,
    mockProviderRegistry,
    mockQueueManager,
    mockModelLoadCache,
  };
}

// ─── Basic Execution Tests ─────────────────────────────────────────────────────

describe("TaskExecutor", () => {
  let executor: TaskExecutor;
  let mocks: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mocks = createMockDependencies();
    executor = new TaskExecutor(
      mocks.mockDb as any,
      mocks.mockProviderRegistry as any,
      mocks.mockQueueManager as any,
      mocks.mockModelLoadCache as any,
      undefined, // chunkBuffer (optional)
      { saveIntervalTokens: 10, debug: false }
    );
  });

  describe("execute", () => {
    it("should execute message task and return completed result", async () => {
      const task = createMockTask();

      const result = await executor.execute(task);

      expect(result.status).toBe("completed");
      expect(result.taskId).toBe(task.id);
      expect(result.result).toBeDefined();
      expect(result.result?.success).toBe(true);
    });

    it("should transition to running then streaming", async () => {
      const task = createMockTask();
      const statusUpdates: string[] = [];

      (mocks.mockDb.tasks.update as any).mockImplementation(async (_id: string, data: any) => {
        if (data.status) statusUpdates.push(data.status);
        return {} as any; // Return mock task
      });

      await executor.execute(task);

      expect(statusUpdates).toContain("running");
      expect(statusUpdates).toContain("streaming");
      expect(statusUpdates).toContain("completed");
    });

    it("should release slot after execution", async () => {
      const task = createMockTask();

      await executor.execute(task);

      expect(mocks.mockQueueManager.releaseSlot).toHaveBeenCalled();
      expect(mocks.mockQueueManager.processQueue).toHaveBeenCalled();
    });

    it("should throw on unknown task type", async () => {
      const task = createMockTask({ type: "unknown" as any });

      const result = await executor.execute(task);

      expect(result.status).toBe("failed");
      expect(result.error?.message).toContain("Unknown task type");
    });
  });

  describe("streaming", () => {
    it("should emit token events during streaming", async () => {
      const task = createMockTask();
      const events: ExecutionEvent[] = [];

      executor.on((event) => events.push(event));

      await executor.execute(task);

      const tokenEvents = events.filter((e) => e.type === "task.token");
      expect(tokenEvents.length).toBeGreaterThan(0);
    });

    it("should accumulate content from tokens", async () => {
      const task = createMockTask();

      const result = await executor.execute(task);

      expect(result.result?.data).toHaveProperty("content", "Hello, World!");
    });

    it("should include usage information", async () => {
      const task = createMockTask();

      const result = await executor.execute(task);

      expect(result.result?.tokensUsed).toEqual({
        prompt: 10,
        completion: 5,
        total: 15,
      });
    });

    it("waits for tool execution and follow-up task creation before emitting completion", async () => {
      const task = createMockTask({
        payload: {
          chatId: "chat-tool",
          messages: [{ role: "user", content: "Call tool" }],
          userMessage: "Call tool",
          stream: true,
          allowedTools: ["echo.tool"],
        } as MessagePayload,
      });

      mocks.mockEngine.stream.mockImplementationOnce(
        async (_request: ChatRequest, callbacks: StreamCallbacks): Promise<ChatResult> => {
          callbacks.onComplete?.({
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"hi\"}" },
              },
            ],
          });
          return {
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"hi\"}" },
              },
            ],
          };
        },
      );

      const fakeToolDispatcher = {
        executeTool: mock(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            toolCallId: "call-1",
            toolName: "echo.tool",
            result: { ok: true },
            isError: false,
            seq: 1,
            contextMessage: { role: "assistant", content: "Tool result" },
          };
        }),
      };
      executor.setToolDispatcher(fakeToolDispatcher as any);

      const followupCreator = mock(async () => {});
      executor.setFollowupTaskCreator(followupCreator);

      const lifecycleEvents: ExecutionEvent[] = [];
      executor.on((event) => lifecycleEvents.push(event));

      const result = await executor.execute(task);

      expect(result.status).toBe("completed");
      expect(fakeToolDispatcher.executeTool).toHaveBeenCalledTimes(1);
      expect(followupCreator).toHaveBeenCalledTimes(1);
      expect(followupCreator).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantMessageId: task.assistantMessageId,
          allowedTools: ["echo.tool"],
        }),
      );

      const toolResultIndex = lifecycleEvents.findIndex((event) => event.type === "task.tool_result");
      const completedIndex = lifecycleEvents.findIndex((event) => event.type === "task.completed");
      expect(toolResultIndex).toBeGreaterThanOrEqual(0);
      expect(completedIndex).toBeGreaterThan(toolResultIndex);
    });

    it("emits and persists fallback tool_result when dispatcher throws", async () => {
      const task = createMockTask({
        payload: {
          chatId: "chat-tool-error",
          messages: [{ role: "user", content: "Call tool" }],
          userMessage: "Call tool",
          stream: true,
          allowedTools: ["echo.tool"],
        } as MessagePayload,
      });

      mocks.mockEngine.stream.mockImplementationOnce(
        async (_request: ChatRequest, callbacks: StreamCallbacks): Promise<ChatResult> => {
          callbacks.onComplete?.({
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-err",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"hi\"}" },
              },
            ],
          });
          return {
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-err",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"hi\"}" },
              },
            ],
          };
        },
      );

      const dispatcher = {
        executeTool: mock(async () => {
          throw new Error("dispatcher exploded");
        }),
      };
      executor.setToolDispatcher(dispatcher as any);

      const followupCreator = mock(async () => {});
      executor.setFollowupTaskCreator(followupCreator);

      const lifecycleEvents: ExecutionEvent[] = [];
      executor.on((event) => lifecycleEvents.push(event));

      const result = await executor.execute(task);

      expect(result.status).toBe("completed");
      expect(dispatcher.executeTool).toHaveBeenCalledTimes(1);
      expect(mocks.mockDb.taskToolEvents.appendToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: "call-err",
          toolName: "echo.tool",
          isError: true,
          result: expect.objectContaining({
            error: expect.objectContaining({
              code: "TOOL_DISPATCH_FAILED",
            }),
          }),
        }),
      );

      const toolResultEvent = lifecycleEvents.find(
        (event) => event.type === "task.tool_result",
      );
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent?.data).toEqual(
        expect.objectContaining({
          toolCallId: "call-err",
          toolName: "echo.tool",
          isError: true,
          result: expect.objectContaining({
            error: expect.objectContaining({
              code: "TOOL_DISPATCH_FAILED",
            }),
          }),
        }),
      );

      expect(followupCreator).toHaveBeenCalledTimes(1);
    });

    it("increments tool-chain depth in follow-up providerOptions", async () => {
      const tools: ToolDefinition[] = [
        {
          type: "function",
          function: {
            name: "echo.tool",
            description: "Echo",
            parameters: {},
          },
        },
      ];

      const task = createMockTask({
        payload: {
          chatId: "chat-tool-depth",
          messages: [{ role: "user", content: "Call tool" }],
          userMessage: "Call tool",
          stream: true,
          tools,
          toolChoice: "auto",
          providerOptions: { __toolChainDepth: 2, keep: "value" },
          allowedTools: ["echo.tool"],
        } as MessagePayload,
      });

      mocks.mockEngine.stream.mockImplementationOnce(
        async (_request: ChatRequest, callbacks: StreamCallbacks): Promise<ChatResult> => {
          callbacks.onComplete?.({
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"hi\"}" },
              },
            ],
          });
          return {
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"hi\"}" },
              },
            ],
          };
        },
      );

      executor.setToolDispatcher({
        executeTool: mock(async () => ({
          toolCallId: "call-1",
          toolName: "echo.tool",
          result: { ok: true },
          isError: false,
          seq: 1,
          contextMessage: { role: "assistant", content: "Tool result" },
        })),
      } as any);

      const followupCreator = mock(async () => {});
      executor.setFollowupTaskCreator(followupCreator);

      await executor.execute(task);

      const followupSpec = followupCreator.mock.calls[0]?.[0] as MessagePayload & {
        providerOptions?: Record<string, unknown>;
        allowedTools?: string[];
      };
      expect(followupSpec.providerOptions).toEqual({
        __toolChainDepth: 3,
        keep: "value",
      });
      expect(followupSpec.tools).toEqual(tools);
      expect(followupSpec.toolChoice).toBe("auto");
      expect(followupSpec.allowedTools).toEqual(["echo.tool"]);
    });

    it("treats core.edit_content and edit_content as equivalent allowed tool aliases", async () => {
      const tools: ToolDefinition[] = [
        {
          type: "function",
          function: {
            name: "edit_content",
            description: "Edit content",
            parameters: {},
          },
        },
      ];

      const task = createMockTask({
        payload: {
          chatId: "chat-tool-alias",
          messages: [{ role: "user", content: "Rewrite the document" }],
          userMessage: "Rewrite the document",
          stream: true,
          tools,
          toolChoice: "auto",
          allowedTools: ["core.edit_content"],
        } as MessagePayload,
      });

      let requestToolNames: string[] | undefined;
      mocks.mockEngine.stream.mockImplementationOnce(
        async (request: ChatRequest, callbacks: StreamCallbacks): Promise<ChatResult> => {
          requestToolNames = request.tools?.map((tool) => tool.function.name);
          callbacks.onComplete?.({
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "edit_content",
                  arguments: "{\"mode\":\"replace\",\"content\":\"Updated\"}",
                },
              },
            ],
          });
          return {
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "edit_content",
                  arguments: "{\"mode\":\"replace\",\"content\":\"Updated\"}",
                },
              },
            ],
          };
        },
      );

      const dispatcher = {
        executeTool: mock(async () => ({
          toolCallId: "call-1",
          toolName: "edit_content",
          result: { success: true },
          isError: false,
          seq: 1,
          contextMessage: { role: "assistant", content: "Tool result" },
        })),
      };
      executor.setToolDispatcher(dispatcher as any);

      const followupCreator = mock(async () => {});
      executor.setFollowupTaskCreator(followupCreator);

      await executor.execute(task);

      expect(requestToolNames).toEqual(["edit_content"]);
      expect(dispatcher.executeTool).toHaveBeenCalledTimes(1);
      expect(followupCreator).toHaveBeenCalledTimes(1);
    });

    it("normalizes duplicate provider toolCallIds to unique IDs", async () => {
      const task = createMockTask({
        payload: {
          chatId: "chat-tool-duplicate-id",
          messages: [{ role: "user", content: "Call duplicate tools" }],
          userMessage: "Call duplicate tools",
          stream: true,
          allowedTools: ["echo.tool"],
        } as MessagePayload,
      });

      mocks.mockEngine.stream.mockImplementationOnce(
        async (_request: ChatRequest, callbacks: StreamCallbacks): Promise<ChatResult> => {
          callbacks.onComplete?.({
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "dup-call",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"one\"}" },
              },
              {
                id: "dup-call",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"two\"}" },
              },
            ],
          });
          return {
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "dup-call",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"one\"}" },
              },
              {
                id: "dup-call",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"two\"}" },
              },
            ],
          };
        },
      );

      const fakeToolDispatcher = {
        executeTool: mock(async (input: { toolCall: { id: string; function: { name: string } } }) => ({
          toolCallId: input.toolCall.id,
          toolName: input.toolCall.function.name,
          result: { ok: true },
          isError: false,
          seq: 1,
          contextMessage: { role: "assistant", content: "Tool result" },
        })),
      };
      executor.setToolDispatcher(fakeToolDispatcher as any);
      executor.setFollowupTaskCreator(mock(async () => {}));

      await executor.execute(task);

      const dispatchedIds = fakeToolDispatcher.executeTool.mock.calls.map(
        (call: unknown[]) => (call[0] as { toolCall: { id: string } }).toolCall.id,
      );
      expect(dispatchedIds).toHaveLength(2);
      expect(dispatchedIds[0]).toBe("dup-call");
      expect(dispatchedIds[1]).not.toBe("dup-call");
      expect(dispatchedIds[1]).toMatch(/^dup-call__dup\d+$/);

      const persistedIds = (mocks.mockDb.taskToolEvents.appendToolCall as any).mock.calls.map(
        (call: unknown[]) => (call[0] as { toolCallId: string }).toolCallId,
      );
      expect(new Set(persistedIds).size).toBe(2);
    });

    it("forces plain-text follow-up when tool-chain depth reaches the cap", async () => {
      const tools: ToolDefinition[] = [
        {
          type: "function",
          function: {
            name: "echo.tool",
            description: "Echo",
            parameters: {},
          },
        },
      ];

      const task = createMockTask({
        payload: {
          chatId: "chat-tool-cap",
          messages: [{ role: "user", content: "Call tool" }],
          userMessage: "Call tool",
          stream: true,
          tools,
          toolChoice: "auto",
          providerOptions: { __toolChainDepth: 5 },
          allowedTools: ["echo.tool"],
        } as MessagePayload,
      });

      mocks.mockEngine.stream.mockImplementationOnce(
        async (_request: ChatRequest, callbacks: StreamCallbacks): Promise<ChatResult> => {
          callbacks.onComplete?.({
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"hi\"}" },
              },
            ],
          });
          return {
            text: "",
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "echo.tool", arguments: "{\"message\":\"hi\"}" },
              },
            ],
          };
        },
      );

      executor.setToolDispatcher({
        executeTool: mock(async () => ({
          toolCallId: "call-1",
          toolName: "echo.tool",
          result: { ok: true },
          isError: false,
          seq: 1,
          contextMessage: { role: "assistant", content: "Tool result" },
        })),
      } as any);

      const followupCreator = mock(async () => {});
      executor.setFollowupTaskCreator(followupCreator);

      await executor.execute(task);

      const followupSpec = followupCreator.mock.calls[0]?.[0] as {
        tools?: unknown[];
        toolChoice?: string;
        providerOptions?: Record<string, unknown>;
        allowedTools?: string[];
      };
      expect(followupSpec.providerOptions?.__toolChainDepth).toBe(6);
      expect(followupSpec.tools).toBeUndefined();
      expect(followupSpec.toolChoice).toBeUndefined();
      expect(followupSpec.allowedTools).toEqual(["echo.tool"]);
    });
  });
});

// ─── Event System Tests ────────────────────────────────────────────────────────

describe("TaskExecutor Events", () => {
  let executor: TaskExecutor;
  let mocks: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mocks = createMockDependencies();
    executor = new TaskExecutor(
      mocks.mockDb as any,
      mocks.mockProviderRegistry as any,
      mocks.mockQueueManager as any,
      mocks.mockModelLoadCache as any
    );
  });

  it("should emit task.started event", async () => {
    const task = createMockTask();
    const events: ExecutionEvent[] = [];

    executor.on((event) => events.push(event));
    await executor.execute(task);

    expect(events.some((e) => e.type === "task.started")).toBe(true);
  });

  it("should emit task.streaming event", async () => {
    const task = createMockTask();
    const events: ExecutionEvent[] = [];

    executor.on((event) => events.push(event));
    await executor.execute(task);

    expect(events.some((e) => e.type === "task.streaming")).toBe(true);
  });

  it("should emit task.completed event", async () => {
    const task = createMockTask();
    const events: ExecutionEvent[] = [];

    executor.on((event) => events.push(event));
    await executor.execute(task);

    expect(events.some((e) => e.type === "task.completed")).toBe(true);
  });

  it("should allow unsubscribing from events", async () => {
    const task = createMockTask();
    const events: ExecutionEvent[] = [];

    const unsubscribe = executor.on((event) => events.push(event));
    unsubscribe();

    await executor.execute(task);

    expect(events.length).toBe(0);
  });

  it("should handle listener errors gracefully", async () => {
    const task = createMockTask();

    executor.on(() => {
      throw new Error("Listener error");
    });

    // Should not throw
    const result = await executor.execute(task);
    expect(result.status).toBe("completed");
  });
});

// ─── Cancellation Tests ────────────────────────────────────────────────────────

describe("TaskExecutor Cancellation", () => {
  let executor: TaskExecutor;
  let mocks: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mocks = createMockDependencies();
    executor = new TaskExecutor(
      mocks.mockDb as any,
      mocks.mockProviderRegistry as any,
      mocks.mockQueueManager as any,
      mocks.mockModelLoadCache as any
    );
  });

  it("should cancel running task", async () => {
    const task = createMockTask();

    // Mock slow streaming
    mocks.mockEngine.stream.mockImplementation(async (request, callbacks) => {
      // Check for abort
      if (request.signal?.aborted) {
        callbacks.onAbort?.({ text: "partial" });
        throw new DOMException("Aborted", "AbortError");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { text: "", finishReason: "stop" };
    });

    // Start execution but cancel immediately
    const execPromise = executor.execute(task);
    const cancelled = executor.cancel(task.id);

    expect(cancelled).toBe(true);

    const result = await execPromise;
    expect(result.status).toBe("cancelled");
  });

  it("should return false when cancelling non-running task", () => {
    const cancelled = executor.cancel("nonexistent");
    expect(cancelled).toBe(false);
  });

  it("should emit task.cancelled event", async () => {
    const task = createMockTask();
    const events: ExecutionEvent[] = [];

    mocks.mockEngine.stream.mockImplementation(async (request, callbacks) => {
      if (request.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { text: "", finishReason: "stop" };
    });

    executor.on((event) => events.push(event));

    const execPromise = executor.execute(task);
    executor.cancel(task.id);

    await execPromise;

    expect(events.some((e) => e.type === "task.cancelled")).toBe(true);
  });
});

// ─── Error Handling Tests ──────────────────────────────────────────────────────

describe("TaskExecutor Error Handling", () => {
  let executor: TaskExecutor;
  let mocks: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mocks = createMockDependencies();
    executor = new TaskExecutor(
      mocks.mockDb as any,
      mocks.mockProviderRegistry as any,
      mocks.mockQueueManager as any,
      mocks.mockModelLoadCache as any
    );
  });

  it("should classify network errors as transient", async () => {
    const task = createMockTask();

    mocks.mockEngine.stream.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await executor.execute(task);

    expect(result.error?.type).toBe("transient");
    expect(result.error?.retryable).toBe(true);
  });

  it("should classify auth errors as fatal", async () => {
    const task = createMockTask({ retryCount: 3, maxRetries: 3 });

    mocks.mockEngine.stream.mockRejectedValue(new Error("401 Unauthorized"));

    const result = await executor.execute(task);

    expect(result.status).toBe("failed");
    expect(result.error?.type).toBe("fatal");
    expect(result.error?.retryable).toBe(false);
  });

  it("should classify HTTP 5xx as transient", async () => {
    const task = createMockTask();

    mocks.mockEngine.stream.mockRejectedValue(new Error("502 Bad Gateway"));

    const result = await executor.execute(task);

    expect(result.error?.type).toBe("transient");
    expect(result.error?.retryable).toBe(true);
  });

  it("should pause task for retry on transient error", async () => {
    const task = createMockTask({ retryCount: 0, maxRetries: 3 });

    mocks.mockEngine.stream.mockRejectedValue(new Error("timeout"));

    const result = await executor.execute(task);

    expect(result.status).toBe("paused");
    expect(result.error?.retryable).toBe(true);
  });

  it("should fail task after max retries", async () => {
    const task = createMockTask({ retryCount: 2, maxRetries: 3 });

    mocks.mockEngine.stream.mockRejectedValue(new Error("timeout"));

    const result = await executor.execute(task);

    expect(result.status).toBe("failed");
  });

  it("should emit task.failed event on error", async () => {
    const task = createMockTask({ retryCount: 3, maxRetries: 3 });
    const events: ExecutionEvent[] = [];

    mocks.mockEngine.stream.mockRejectedValue(new Error("fatal error"));

    executor.on((event) => events.push(event));
    await executor.execute(task);

    expect(events.some((e) => e.type === "task.failed")).toBe(true);
  });
});

// ─── Load Task Tests ───────────────────────────────────────────────────────────

describe("TaskExecutor Load Tasks", () => {
  let executor: TaskExecutor;
  let mocks: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mocks = createMockDependencies();
    executor = new TaskExecutor(
      mocks.mockDb as any,
      mocks.mockProviderRegistry as any,
      mocks.mockQueueManager as any,
      mocks.mockModelLoadCache as any
    );
  });

  it("should execute load task", async () => {
    const task = createMockTask({
      type: "load",
      payload: { modelPath: "/path/to/model", targetProvider: "ollama" } as LoadPayload,
    });

    mocks.mockEngine.preloadModel.mockResolvedValue(true);

    const result = await executor.execute(task);

    expect(result.status).toBe("completed");
    expect(result.result?.data).toHaveProperty("modelLoaded", true);
  });

  it("should skip preload if model already loaded", async () => {
    const task = createMockTask({
      type: "load",
      payload: { modelPath: "/path/to/model", targetProvider: "ollama" } as LoadPayload,
    });

    mocks.mockEngine.isModelLoaded.mockResolvedValue(true);

    const result = await executor.execute(task);

    expect(result.status).toBe("completed");
    expect(mocks.mockEngine.preloadModel).not.toHaveBeenCalled();
  });

  it("should release load lock in cache after success", async () => {
    const task = createMockTask({
      type: "load",
      payload: { modelPath: "/path/to/model", targetProvider: "ollama" } as LoadPayload,
    });

    mocks.mockEngine.preloadModel.mockResolvedValue(true);

    await executor.execute(task);

    expect(mocks.mockModelLoadCache.releaseLoadLock).toHaveBeenCalledWith(
      task.provider,
      task.model
    );
  });

  it("should fail if preload fails", async () => {
    const task = createMockTask({
      type: "load",
      retryCount: 3,
      maxRetries: 3,
      payload: { modelPath: "/path/to/model", targetProvider: "ollama" } as LoadPayload,
    });

    mocks.mockEngine.preloadModel.mockResolvedValue(false);

    const result = await executor.execute(task);

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("Failed to preload model");
  });

  it("should emit task.completed for load tasks", async () => {
    const task = createMockTask({
      type: "load",
      payload: { modelPath: "/path/to/model", targetProvider: "ollama" } as LoadPayload,
    });
    const events: ExecutionEvent[] = [];

    mocks.mockEngine.isModelLoaded.mockResolvedValue(true);
    executor.on((event) => events.push(event));

    await executor.execute(task);

    expect(events.some((e) => e.type === "task.completed")).toBe(true);
  });
});

// ─── Payload Validation Tests ──────────────────────────────────────────────────

describe("TaskExecutor Payload Validation", () => {
  let executor: TaskExecutor;
  let mocks: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mocks = createMockDependencies();
    executor = new TaskExecutor(
      mocks.mockDb as any,
      mocks.mockProviderRegistry as any,
      mocks.mockQueueManager as any,
      mocks.mockModelLoadCache as any
    );
  });

  it("should fail on invalid message payload (missing messages)", async () => {
    const task = createMockTask({
      payload: { chatId: "chat-123" } as any, // Missing messages
    });

    const result = await executor.execute(task);

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("Invalid MessagePayload");
  });

  it("should fail on invalid message payload (non-array messages)", async () => {
    const task = createMockTask({
      payload: { chatId: "chat-123", messages: "not-an-array" } as any,
    });

    const result = await executor.execute(task);

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("Invalid MessagePayload");
  });

  it("should fail on missing provider", async () => {
    const task = createMockTask();

    mocks.mockProviderRegistry.get.mockResolvedValue(null as any);

    const result = await executor.execute(task);

    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("Provider not found");
  });
});

// ─── FinishReason Mapping Tests ────────────────────────────────────────────────

describe("TaskExecutor finishReason mapping", () => {
  let executor: TaskExecutor;
  let mocks: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mocks = createMockDependencies();
    executor = new TaskExecutor(
      mocks.mockDb as any,
      mocks.mockProviderRegistry as any,
      mocks.mockQueueManager as any,
      mocks.mockModelLoadCache as any
    );
  });

  it("should map 'stop' to 'stop'", async () => {
    const task = createMockTask();

    mocks.mockEngine.stream.mockResolvedValue({
      text: "test",
      finishReason: "stop",
    });

    const result = await executor.execute(task);

    expect(result.result?.finishReason).toBe("stop");
  });

  it("should map 'length' to 'length'", async () => {
    const task = createMockTask();

    mocks.mockEngine.stream.mockResolvedValue({
      text: "test",
      finishReason: "length",
    });

    const result = await executor.execute(task);

    expect(result.result?.finishReason).toBe("length");
  });

  it("should map 'content_filter' to 'stop'", async () => {
    const task = createMockTask();

    mocks.mockEngine.stream.mockResolvedValue({
      text: "test",
      finishReason: "content_filter",
    });

    const result = await executor.execute(task);

    expect(result.result?.finishReason).toBe("stop");
  });

  it("should map 'tool_calls' to 'stop'", async () => {
    const task = createMockTask();

    mocks.mockEngine.stream.mockResolvedValue({
      text: "test",
      finishReason: "tool_calls",
    });

    const result = await executor.execute(task);

    expect(result.result?.finishReason).toBe("stop");
  });

  it("should map undefined to 'stop'", async () => {
    const task = createMockTask();

    mocks.mockEngine.stream.mockResolvedValue({
      text: "test",
      finishReason: undefined,
    });

    const result = await executor.execute(task);

    expect(result.result?.finishReason).toBe("stop");
  });
});

// ─── Tool Request Tests ─────────────────────────────────────────────────────

describe("TaskExecutor tool request", () => {
  let executor: TaskExecutor;
  let mocks: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mocks = createMockDependencies();
    executor = new TaskExecutor(
      mocks.mockDb as any,
      mocks.mockProviderRegistry as any,
      mocks.mockQueueManager as any,
      mocks.mockModelLoadCache as any
    );
  });

  it("passes tools and toolChoice into the provider request", async () => {
    const tools: ToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "search",
          description: "Search tool",
          parameters: {},
        },
      },
    ];

    const task = createMockTask({
      payload: {
        chatId: "chat-123",
        messages: [{ role: "user", content: "Use tools" }],
        userMessage: "Use tools",
        stream: true,
        tools,
        toolChoice: "required",
      } as MessagePayload,
    });

    let capturedRequest: ChatRequest | undefined;

    mocks.mockEngine.stream.mockImplementation(async (request, callbacks) => {
      capturedRequest = request;
      callbacks.onToken?.("tool");
      callbacks.onComplete?.({
        text: "tool response",
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
      return {
        text: "tool response",
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });

    await executor.execute(task);

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.tools).toEqual(tools);
    expect(capturedRequest?.toolChoice).toBe("required");
  });
});
