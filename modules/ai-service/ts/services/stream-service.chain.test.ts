import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { StreamService } from "./stream-service";
import type { DatabaseAccess } from "../../db";
import type { TaskOrchestrator } from "./queue/task-orchestrator";
import type { ExecutionEvent } from "./queue/task-executor";
import type { ToolRegistry } from "./tools/tool-registry";
import { LicenseUtil } from "./license-util";

function createMessageTask(taskId: string, status: string) {
  return {
    id: taskId,
    type: "message",
    status,
    provider: "openai",
    model: "gpt-4o",
    chatId: "chat-1",
    metadata: null,
    dependsOn: null,
  };
}

function createDefaultOrchestrator(overrides?: Record<string, unknown>): TaskOrchestrator {
  return {
    getChatManager: mock(() => ({
      createChat: mock(async () => ({ id: "chat-1" })),
    })),
    createUserMessage: mock(async () => ({ id: "user-msg-1" })),
    createAssistantMessage: mock(async () => ({ id: "assistant-msg-1" })),
    createMessageTask: mock(async () => ({
      task: {
        id: "task-1",
        status: "pending",
        provider: "openai",
        model: "gpt-4o",
        assistantMessageId: "assistant-msg-1",
      },
      queueStatus: {
        provider: "openai",
        queuedTasks: 0,
        activeTasks: 1,
        availableSlots: 2,
      },
    })),
    getTaskDependency: mock(async () => ({ dependsOn: null, loadTaskId: null })),
    cancelTask: mock(async () => {}),
    onExecutionEvent: mock(() => () => {}),
    ...(overrides ?? {}),
  } as unknown as TaskOrchestrator;
}

describe("StreamService tool-chain continuity", () => {
  let enforceAllowedSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    enforceAllowedSpy = spyOn(LicenseUtil, "enforceAllowed").mockResolvedValue(undefined);
  });

  afterEach(() => {
    enforceAllowedSpy.mockRestore();
  });

  it("keeps SSE open across tool follow-up tasks and emits done only for final completion", async () => {
    const taskById = new Map<string, ReturnType<typeof createMessageTask>>([
      ["task-1", createMessageTask("task-1", "streaming")],
      ["task-2", createMessageTask("task-2", "waiting")],
    ]);
    let activeTaskIds: string[] = [];

    const mockDb = {
      tasks: {
        findById: mock(async (taskId: string) => taskById.get(taskId) ?? null),
        findByStatus: mock(async () => activeTaskIds.map((taskId) => taskById.get(taskId))),
      },
      chats: {
        update: mock(async () => ({})),
      },
    } as unknown as DatabaseAccess;

    type EventCallback = (event: ExecutionEvent) => void;
    let eventCallback: EventCallback | null = null;

    const mockOrchestrator = createDefaultOrchestrator({
      onExecutionEvent: mock((callback: (event: ExecutionEvent) => void) => {
        eventCallback = callback;
        return () => {
          eventCallback = null;
        };
      }),
    });

    const service = new StreamService(mockDb, mockOrchestrator);
    const result = await service.createChatStream({
      provider: "openai",
      model: "gpt-4o",
      text: "Use a tool and continue",
    });

    const sseEvents: Array<Record<string, unknown>> = [];
    const reader = result.stream.getReader();
    const decoder = new TextDecoder();

    const readPromise = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const lines = text.split("\n").filter((line) => line.startsWith("data: "));
        for (const line of lines) {
          try {
            sseEvents.push(JSON.parse(line.slice(6)));
          } catch {
            // Ignore malformed payloads in test harness.
          }
        }
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 25));
    const emit = eventCallback!;

    emit({
      type: "task.tool_call",
      taskId: "task-1",
      data: {
        id: "call-1",
        function: { name: "echo", arguments: "{\"message\":\"hello\"}" },
      },
      timestamp: new Date().toISOString(),
    });

    activeTaskIds = ["task-2"];
    emit({
      type: "task.completed",
      taskId: "task-1",
      data: {
        data: { content: "" },
        tokensUsed: { prompt: 5, completion: 2, total: 7 },
      },
      timestamp: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    emit({
      type: "task.started",
      taskId: "task-2",
      timestamp: new Date().toISOString(),
    });

    emit({
      type: "task.token",
      taskId: "task-2",
      data: { token: "Final answer" },
      timestamp: new Date().toISOString(),
    });

    activeTaskIds = [];
    emit({
      type: "task.completed",
      taskId: "task-2",
      data: {
        data: { content: "Final answer" },
        tokensUsed: { prompt: 8, completion: 4, total: 12 },
      },
      timestamp: new Date().toISOString(),
    });

    await readPromise;

    const inProgressEvents = sseEvents.filter((event) => event.event === "in-progress");
    const doneEvents = sseEvents.filter((event) => event.event === "done");
    const tokenEvents = sseEvents.filter((event) => event.event === "token");

    expect(inProgressEvents.length).toBeGreaterThan(0);
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]?.text).toBe("Final answer");
    expect(tokenEvents.some((event) => event.delta === "Final answer")).toBe(true);
    const continuationLookups = (mockDb.tasks.findById as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(([taskId]) => taskId === "task-2");
    expect(continuationLookups).toHaveLength(1);
  });

  it("does not attach tools when toolChoice is omitted", async () => {
    const mockDb = {
      tasks: {
        findById: mock(async () => null),
        findByStatus: mock(async () => []),
      },
      chats: {
        update: mock(async () => ({})),
      },
    } as unknown as DatabaseAccess;

    const mockOrchestrator = createDefaultOrchestrator();
    const service = new StreamService(mockDb, mockOrchestrator);

    const result = await service.createChatStream({
      provider: "openai",
      model: "gpt-4o",
      text: "No tool choice",
      activeContext: { workspaceId: "ws-1" },
    });
    await result.stream.cancel();

    const spec = (mockOrchestrator.createMessageTask as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as {
      tools?: unknown[];
      toolChoice?: string;
    };
    expect(spec?.tools).toBeUndefined();
    expect(spec?.toolChoice).toBeUndefined();
  });

  it("does not attach tools when toolChoice is none", async () => {
    const mockDb = {
      tasks: {
        findById: mock(async () => null),
        findByStatus: mock(async () => []),
      },
      chats: {
        update: mock(async () => ({})),
      },
    } as unknown as DatabaseAccess;

    const mockOrchestrator = createDefaultOrchestrator();
    const service = new StreamService(mockDb, mockOrchestrator);

    const result = await service.createChatStream({
      provider: "openai",
      model: "gpt-4o",
      text: "No tools",
      toolChoice: "none",
      activeContext: { workspaceId: "ws-1" },
    });
    await result.stream.cancel();

    const spec = (mockOrchestrator.createMessageTask as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as {
      tools?: unknown[];
      toolChoice?: string;
    };
    expect(spec?.tools).toBeUndefined();
    expect(spec?.toolChoice).toBeUndefined();
  });

  it("excludes edit_content when no activeContext is provided", async () => {
    const mockDb = {
      tasks: {
        findById: mock(async () => null),
        findByStatus: mock(async () => []),
      },
      chats: {
        update: mock(async () => ({})),
      },
    } as unknown as DatabaseAccess;

    const mockOrchestrator = createDefaultOrchestrator();
    const customToolRegistry = {
      list: () => [
        {
          definition: {
            type: "function" as const,
            function: {
              name: "core.echo",
              description: "Echo",
              parameters: {},
            },
          },
        },
      ],
    } as unknown as ToolRegistry;

    const service = new StreamService(mockDb, mockOrchestrator, customToolRegistry);
    const result = await service.createChatStream({
      provider: "openai",
      model: "gpt-4o",
      text: "Tool run",
      toolChoice: "auto",
    });
    await result.stream.cancel();

    const spec = (mockOrchestrator.createMessageTask as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as {
      tools?: Array<{ function: { name: string } }>;
    };

    expect(spec.tools?.map((tool) => tool.function.name)).toEqual(["core.echo"]);
    expect(spec.tools?.some((tool) => tool.function.name === "edit_content")).toBe(false);
  });

  it("normalizes edit_content aliases in allowedTools filtering", async () => {
    const mockDb = {
      tasks: {
        findById: mock(async () => null),
        findByStatus: mock(async () => []),
      },
      chats: {
        update: mock(async () => ({})),
      },
    } as unknown as DatabaseAccess;

    const mockOrchestrator = createDefaultOrchestrator();
    const service = new StreamService(mockDb, mockOrchestrator);
    const result = await service.createChatStream({
      provider: "openai",
      model: "gpt-4o",
      text: "Rewrite this document",
      toolChoice: "auto",
      allowedTools: ["core.edit_content"],
      activeContext: {
        workspaceId: "ws-1",
        activeTarget: {
          targetType: "writer.document",
          targetId: "doc-1",
        },
      },
    });
    await result.stream.cancel();

    const spec = (mockOrchestrator.createMessageTask as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]?.[0] as {
      tools?: Array<{ function: { name: string } }>;
      allowedTools?: string[];
    };

    expect(spec.tools?.map((tool) => tool.function.name)).toEqual(["edit_content"]);
    expect(spec.allowedTools).toEqual(
      expect.arrayContaining(["edit_content", "core.edit_content"]),
    );
  });
});
