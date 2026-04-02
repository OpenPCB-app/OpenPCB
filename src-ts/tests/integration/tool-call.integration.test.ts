import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseAccess } from "../../src/db";
import { runMigrations } from "../../src/db/migrate";
import { generateUUIDv7 } from "../../src/db/schema/base";
import type { MessagePayload, Task } from "../../src/db/schema/task";
import {
  TaskExecutor,
  type ExecutionEvent,
} from "../../src/domain/services/queue/task-executor";
import { TaskQueueManager } from "../../src/domain/services/queue/task-queue-manager";
import { ToolDispatcher } from "../../src/domain/services/tools/tool-dispatcher";
import { ToolRegistry } from "../../src/domain/services/tools/tool-registry";
import {
  McpToolRegistryBridge,
  type McpToolRuntime,
} from "../../src/domain/services/mcp/mcp-tool-registry-bridge";
import type {
  ChatResult,
  KernelProviderEngine,
  StreamCallbacks,
  ToolCall,
  ToolDefinition,
} from "../../src/infrastructure/ai-providers/engine";
import { ProviderRegistry } from "../../src/infrastructure/ai-providers/registry";
import { ModelLoadCache } from "../../src/infrastructure/cache/model-load-cache";
import {
  initializeChatManager,
  type ChatManager,
  type ContextMessage,
} from "../../src/domain/services/chat-manager";

const TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: "echo",
    description: "Echo back provided input",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
      required: ["message"],
    },
  },
};

const TOOL_CALL: ToolCall = {
  id: generateUUIDv7(),
  type: "function",
  function: {
    name: "echo",
    arguments: JSON.stringify({ message: "ping" }),
  },
};

describe("Tool call integration", () => {
  let db: DatabaseAccess;
  let dbDir: string;
  let task: Task;
  let chatId: string;
  let assistantMessageId: string;
  let chatManager: ChatManager;

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), "openpcb-tool-call-"));
    const dbFilePath = join(dbDir, "tool-call-test.db");

    DatabaseAccess.reset();
    db = DatabaseAccess.getInstance({ filePath: dbFilePath, logger: false });
    await runMigrations();

    chatManager = initializeChatManager(db);

    const workspace = await db.workspaces.create({
      name: "Tool Call Workspace",
      settings: {},
    });

    const chat = await db.chats.create({
      workspaceId: workspace.id,
      title: "Tool Call Chat",
      provider: "test-provider",
      model: "test-model",
    });

    chatId = chat.id;
    assistantMessageId = generateUUIDv7();

    const payload: MessagePayload = {
      chatId,
      messages: [{ role: "user", content: "Call the echo tool" }],
      userMessage: "Call the echo tool",
      stream: true,
      tools: [TOOL_DEFINITION],
      toolChoice: "auto",
    };

    task = await db.tasks.create({
      type: "message",
      status: "queued",
      priority: 5,
      provider: "test-provider",
      model: "test-model",
      dependsOn: null,
      waitingTasks: [],
      payload,
      workspaceId: workspace.id,
      chatId,
      assistantMessageId,
    });

    await db.messages.create({
      id: assistantMessageId,
      chatId,
      role: "assistant",
      content: { type: "text", text: "" },
      taskId: task.id,
      provider: "test-provider",
      model: "test-model",
    });
  });

  afterAll(() => {
    DatabaseAccess.reset();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("should emit tool_result and persist ordered tool events without tool-role messages", async () => {
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(
      TOOL_DEFINITION,
      {
        execute: async (args) => ({ echoed: args.message }),
      },
      { moduleId: "test.module" },
    );

    const toolDispatcher = new ToolDispatcher(db, toolRegistry);

    const mockEngine: KernelProviderEngine = {
      providerId: "test-provider",
      name: "Test Provider",
      requiresApiKey: false,
      defaultBaseURL: undefined,
      initialize: async () => {},
      checkStatus: async () => ({
        available: true,
        checkedAt: new Date().toISOString(),
      }),
      listModels: async () => [],
      getModel: () => undefined,
      chat: async () => ({ text: "" }),
      stream: async (
        _request: unknown,
        callbacks: StreamCallbacks,
      ): Promise<ChatResult> => {
        const result: ChatResult = {
          text: "",
          finishReason: "tool_calls",
          toolCalls: [TOOL_CALL],
        };
        callbacks.onComplete?.(result);
        return result;
      },
      abort: () => {},
      dispose: () => {},
      isModelLoaded: async () => true,
      getLoadedModels: async () => [],
      preloadModel: async () => true,
    };

    const providerRegistry = new ProviderRegistry();
    providerRegistry.register("test-provider", () => mockEngine);

    const queueManager = new TaskQueueManager({
      debug: false,
      agingIntervalMs: 60000,
    });
    const modelLoadCache = new ModelLoadCache();

    const executor = new TaskExecutor(
      db,
      providerRegistry,
      queueManager,
      modelLoadCache,
      undefined,
      { saveIntervalTokens: 5, debug: false },
    );

    executor.setToolDispatcher(toolDispatcher);

    let capturedFollowupSpec: unknown = null;
    let followupSpecResolver: (() => void) | null = null;
    const followupSpecPromise = new Promise<void>((resolve) => {
      followupSpecResolver = resolve;
    });
    executor.setFollowupTaskCreator(async (spec) => {
      const messages = await chatManager.loadChatContext(spec.chatId);
      capturedFollowupSpec = { ...spec, messages };
      followupSpecResolver?.();
    });

    const events: ExecutionEvent[] = [];
    const lifecycleEvents: ExecutionEvent[] = [];
    const unsubscribeLifecycle = executor.on((event) => {
      lifecycleEvents.push(event);
    });
    const toolResultPromise = new Promise<ExecutionEvent>((resolve, reject) => {
      const unsubscribe = executor.on((event) => {
        events.push(event);
        if (event.type === "task.tool_result") {
          clearTimeout(timeout);
          unsubscribe();
          resolve(event);
        }
      });

      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for tool_result event"));
      }, 5000);
    });

    try {
      const executionResult = await executor.execute(task);
      expect(executionResult.status).toBe("completed");
      expect(capturedFollowupSpec).not.toBeNull();

      const toolResultEvent = await toolResultPromise;

      expect(events.some((event) => event.type === "task.tool_call")).toBe(
        true,
      );
      const completedIndex = lifecycleEvents.findIndex(
        (event) => event.type === "task.completed",
      );
      const toolResultIndex = lifecycleEvents.findIndex(
        (event) => event.type === "task.tool_result",
      );
      expect(toolResultIndex).toBeGreaterThanOrEqual(0);
      expect(completedIndex).toBeGreaterThan(toolResultIndex);

      const toolResultData = toolResultEvent.data as {
        toolCallId?: string;
        toolName?: string;
        seq?: number;
        result?: unknown;
        isError?: boolean;
      };

      expect(toolResultData.toolCallId).toBe(TOOL_CALL.id);
      expect(toolResultData.toolName).toBe("echo");
      expect(toolResultData.isError).toBeUndefined();
      expect(typeof toolResultData.seq).toBe("number");

      const persistedEvents =
        await db.taskToolEvents.listByAssistantMessageId(assistantMessageId);
      expect(persistedEvents).toHaveLength(2);

      const callEvent = persistedEvents.find(
        (event) => event.kind === "tool-call",
      );
      const resultEvent = persistedEvents.find(
        (event) => event.kind === "tool-result",
      );

      expect(callEvent).toBeDefined();
      expect(resultEvent).toBeDefined();
      expect(callEvent?.toolCallId).toBe(TOOL_CALL.id);
      expect(callEvent?.toolName).toBe("echo");
      expect(resultEvent?.toolCallId).toBe(TOOL_CALL.id);
      expect(resultEvent?.toolName).toBe("echo");
      expect(resultEvent?.result).toEqual({ echoed: "ping" });
      expect(resultEvent?.seq ?? 0).toBeGreaterThan(callEvent?.seq ?? -1);

      const persistedMessages = await db.messages.findByChat(chatId);
      const toolRoleMessages = persistedMessages.filter(
        (message) => message.role === "tool",
      );
      expect(toolRoleMessages).toHaveLength(0);

      await followupSpecPromise;

      expect(capturedFollowupSpec).not.toBeNull();
      const followupSpec = capturedFollowupSpec as {
        assistantMessageId?: string;
        messages?: ContextMessage[];
      } | null;
      if (!followupSpec) {
        throw new Error("Follow-up spec was not captured");
      }
      expect(followupSpec.assistantMessageId).toBe(assistantMessageId);
      const followupMessages = followupSpec.messages ?? [];
      const toolResultContext = followupMessages.some(
        (message) =>
          message.content.includes("Tool result") &&
          message.content.includes(TOOL_CALL.id),
      );
      expect(toolResultContext).toBe(true);
    } finally {
      unsubscribeLifecycle();
      queueManager.stopAgingTimer();
      providerRegistry.dispose();
    }
  }, 15000);

  it("should route MCP tool calls through ToolDispatcher and keep follow-up cycle intact", async () => {
    const toolRegistry = new ToolRegistry();

    const runtimeCalls: Array<{
      serverId: string;
      toolName: string;
      args: Record<string, unknown>;
    }> = [];

    const mcpRuntime: McpToolRuntime = {
      listTools: async (_serverId: string) => [
        {
          name: "fetch.info",
          description: "Fetches info",
          inputSchema: {
            type: "object",
            properties: {
              topic: { type: "string" },
            },
            required: ["topic"],
          },
        },
      ],
      callTool: async (
        serverId: string,
        name: string,
        args: Record<string, unknown>,
      ) => {
        runtimeCalls.push({
          serverId,
          toolName: name,
          args,
        });
        return {
          content: [
            {
              type: "text",
              text: `topic:${String(args.topic ?? "")}`,
            },
          ],
        };
      },
    };

    const bridge = new McpToolRegistryBridge(toolRegistry, mcpRuntime);
    const disposeBridge = await bridge.registerServerTools({
      serverId: "mcp-server-1",
      serverAlias: "knowledge",
    });

    const mcpToolDefinition = toolRegistry
      .list()
      .map((entry) => entry.definition)
      .find((tool) => tool.function.name === "mcp.knowledge.fetch.info");
    if (!mcpToolDefinition) {
      throw new Error(
        "Expected MCP tool definition mcp.knowledge.fetch.info to be registered",
      );
    }

    const toolDispatcher = new ToolDispatcher(db, toolRegistry);

    const mcpToolCall: ToolCall = {
      id: generateUUIDv7(),
      type: "function",
      function: {
        name: mcpToolDefinition.function.name,
        arguments: JSON.stringify({ topic: "ping" }),
      },
    };

    const mockEngine: KernelProviderEngine = {
      providerId: "test-provider",
      name: "Test Provider",
      requiresApiKey: false,
      defaultBaseURL: undefined,
      initialize: async () => {},
      checkStatus: async () => ({
        available: true,
        checkedAt: new Date().toISOString(),
      }),
      listModels: async () => [],
      getModel: () => undefined,
      chat: async () => ({ text: "" }),
      stream: async (
        _request: unknown,
        callbacks: StreamCallbacks,
      ): Promise<ChatResult> => {
        const result: ChatResult = {
          text: "",
          finishReason: "tool_calls",
          toolCalls: [mcpToolCall],
        };
        callbacks.onComplete?.(result);
        return result;
      },
      abort: () => {},
      dispose: () => {},
      isModelLoaded: async () => true,
      getLoadedModels: async () => [],
      preloadModel: async () => true,
    };

    const providerRegistry = new ProviderRegistry();
    providerRegistry.register("test-provider", () => mockEngine);

    const queueManager = new TaskQueueManager({
      debug: false,
      agingIntervalMs: 60000,
    });
    const modelLoadCache = new ModelLoadCache();
    const executor = new TaskExecutor(
      db,
      providerRegistry,
      queueManager,
      modelLoadCache,
      undefined,
      { saveIntervalTokens: 5, debug: false },
    );
    executor.setToolDispatcher(toolDispatcher);

    let capturedFollowupSpec: unknown = null;
    let followupResolver: (() => void) | null = null;
    const followupPromise = new Promise<void>((resolve) => {
      followupResolver = resolve;
    });

    executor.setFollowupTaskCreator(async (spec) => {
      const messages = await chatManager.loadChatContext(spec.chatId);
      capturedFollowupSpec = { ...spec, messages };
      followupResolver?.();
    });

    const executionEvents: ExecutionEvent[] = [];
    const unsubscribe = executor.on((event) => {
      executionEvents.push(event);
    });

    const mcpPayload: MessagePayload = {
      chatId,
      messages: [{ role: "user", content: "Use the MCP tool" }],
      userMessage: "Use the MCP tool",
      stream: true,
      tools: [mcpToolDefinition],
      toolChoice: "auto",
      allowedTools: [mcpToolDefinition.function.name],
    };

    const mcpTask = await db.tasks.create({
      type: "message",
      status: "queued",
      priority: 5,
      provider: "test-provider",
      model: "test-model",
      dependsOn: null,
      waitingTasks: [],
      payload: mcpPayload,
      workspaceId: task.workspaceId,
      chatId,
      assistantMessageId: generateUUIDv7(),
    });

    await db.messages.create({
      id: mcpTask.assistantMessageId!,
      chatId,
      role: "assistant",
      content: { type: "text", text: "" },
      taskId: mcpTask.id,
      provider: "test-provider",
      model: "test-model",
    });

    try {
      const executionResult = await executor.execute(mcpTask);
      expect(executionResult.status).toBe("completed");

      expect(runtimeCalls).toHaveLength(1);
      expect(runtimeCalls[0]?.serverId).toBe("mcp-server-1");
      expect(runtimeCalls[0]?.toolName).toBe("fetch.info");
      expect(runtimeCalls[0]?.args).toMatchObject({ topic: "ping" });

      const toolCallEvent = executionEvents.find(
        (event) => event.type === "task.tool_call",
      );
      const toolResultEvent = executionEvents.find(
        (event) => event.type === "task.tool_result",
      );
      const completedEventIndex = executionEvents.findIndex(
        (event) => event.type === "task.completed",
      );
      const toolResultIndex = executionEvents.findIndex(
        (event) => event.type === "task.tool_result",
      );

      expect(toolCallEvent).toBeDefined();
      expect(toolResultEvent).toBeDefined();
      expect(toolResultIndex).toBeGreaterThanOrEqual(0);
      expect(completedEventIndex).toBeGreaterThan(toolResultIndex);

      const persistedEvents = await db.taskToolEvents.listByAssistantMessageId(
        mcpTask.assistantMessageId!,
      );
      expect(persistedEvents).toHaveLength(2);
      expect(persistedEvents[0]?.kind).toBe("tool-call");
      expect(persistedEvents[0]?.toolName).toBe(
        mcpToolDefinition.function.name,
      );
      expect(persistedEvents[1]?.kind).toBe("tool-result");
      expect(persistedEvents[1]?.toolName).toBe(
        mcpToolDefinition.function.name,
      );

      await followupPromise;
      expect(capturedFollowupSpec).not.toBeNull();
      const followupSpec = capturedFollowupSpec as {
        assistantMessageId?: string;
        messages?: ContextMessage[];
      } | null;
      if (!followupSpec) {
        throw new Error("Follow-up spec was not captured");
      }
      expect(followupSpec.assistantMessageId).toBe(
        mcpTask.assistantMessageId ?? undefined,
      );

      const followupMessages = followupSpec.messages ?? [];
      const hasMcpResultContext = followupMessages.some(
        (message) =>
          message.content.includes("Tool result") &&
          message.content.includes("mcp.knowledge.fetch.info"),
      );
      expect(hasMcpResultContext).toBe(true);
    } finally {
      unsubscribe();
      disposeBridge();
      queueManager.stopAgingTimer();
      providerRegistry.dispose();
    }
  }, 15000);
});
