import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { DatabaseAccess } from "../../../db";
import type { ToolDefinition } from "../../../infrastructure/ai-providers/engine";
import type { ToolSpec } from "../../../../shared/types/tool-spec.types";
import { ToolDispatcher } from "./tool-dispatcher";
import { ToolRegistry } from "./tool-registry";
import { createToolError } from "../../../../shared/types/tool-error.types";

const TASK_ID = "task-1";
const CHAT_ID = "chat-1";
const PROVIDER = "test-provider";
const MODEL = "test-model";

function createMockDb(): DatabaseAccess {
  const mockDb = {
    chats: {
      findById: async () => null,
    },
    taskToolEvents: {
      appendToolResult: async () => ({
        id: "event-1",
      }),
    },
  } as unknown as DatabaseAccess;

  return mockDb;
}

function createDefinition(name: string, parameters: Record<string, unknown>): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description: `Test tool ${name}`,
      parameters,
    },
  };
}

describe("ToolDispatcher validation", () => {
  let toolRegistry: ToolRegistry;
  let dispatcher: ToolDispatcher;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    dispatcher = new ToolDispatcher(createMockDb(), toolRegistry);
  });

  describe("validation success", () => {
    it("valid args pass schema validation", async () => {
      const execute = mock(async () => ({ ok: true }));
      toolRegistry.register(
        createDefinition("echo.valid", {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        }),
        { execute },
      );

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: { id: "call-valid", name: "echo.valid", args: { message: "hello" } },
      });

      expect(result.isError).toBe(false);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(result.result).toEqual({ ok: true });
    });

    it("tool with no schema executes without validation", async () => {
      const execute = mock(async () => ({ ok: true }));
      toolRegistry.register(createDefinition("echo.no-schema", {}), { execute });

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: { id: "call-no-schema", name: "echo.no-schema", args: { anything: true } },
      });

      expect(result.isError).toBe(false);
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("extra properties allowed when additionalProperties is true", async () => {
      const capturedArgs: Record<string, unknown>[] = [];
      toolRegistry.register(
        createDefinition("echo.extra", {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
          additionalProperties: true,
        }),
        {
          execute: (args) => {
            capturedArgs.push(args);
            return { ok: true };
          },
        },
      );

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: {
          id: "call-extra",
          name: "echo.extra",
          args: { message: "hello", extraField: 42 },
        },
      });

      expect(result.isError).toBe(false);
      expect(capturedArgs[0]).toEqual({ message: "hello", extraField: 42 });
    });
  });

  describe("validation failures", () => {
    it("missing required field returns validation ToolError", async () => {
      const execute = mock(async () => ({ shouldNotRun: true }));
      toolRegistry.register(
        createDefinition("echo.required", {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        }),
        { execute },
      );

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: { id: "call-required", name: "echo.required", args: {} },
      });

      const expected = createToolError(
        "VALIDATION_FAILED",
        "Validation failed for tool 'echo.required'",
        { phase: "validation" },
      );

      expect(result.isError).toBe(true);
      expect(execute).toHaveBeenCalledTimes(0);
      expect(result.result).toMatchObject({
        code: expected.code,
        message: expected.message,
        phase: expected.phase,
        retryable: expected.retryable,
      });
    });

    it("wrong type returns validation ToolError", async () => {
      const execute = mock(async () => ({ shouldNotRun: true }));
      toolRegistry.register(
        createDefinition("echo.type", {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        }),
        { execute },
      );

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: { id: "call-type", name: "echo.type", args: { message: 123 } },
      });

      expect(result.isError).toBe(true);
      expect(execute).toHaveBeenCalledTimes(0);
      expect(result.result).toMatchObject({
        code: "VALIDATION_FAILED",
        phase: "validation",
      });
    });

    it("returns multiple AJV validation errors with allErrors enabled", async () => {
      const execute = mock(async () => ({ shouldNotRun: true }));
      toolRegistry.register(
        createDefinition("echo.multi", {
          type: "object",
          properties: {
            message: { type: "string" },
            category: { type: "string" },
          },
          required: ["message", "category"],
        }),
        { execute },
      );

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: { id: "call-multi", name: "echo.multi", args: {} },
      });

      const details = (result.result as { details?: { errors?: unknown[] } }).details;
      expect(result.isError).toBe(true);
      expect(execute).toHaveBeenCalledTimes(0);
      expect(Array.isArray(details?.errors)).toBe(true);
      expect((details?.errors ?? []).length).toBeGreaterThan(1);
    });
  });

  describe("schema edge cases", () => {
    it("malformed schema is non-fatal and handler still executes", async () => {
      const execute = mock(async () => ({ ok: true }));
      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

      toolRegistry.register(
        createDefinition("echo.bad-schema", {
          type: "invalid-type",
        }),
        { execute },
      );

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: { id: "call-bad-schema", name: "echo.bad-schema", args: { x: 1 } },
      });

      expect(result.isError).toBe(false);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      consoleErrorSpy.mockRestore();
    });
  });

  describe("output schema validation", () => {
    it("returns SCHEMA_ERROR when tool output does not match outputSchema", async () => {
      const spec: ToolSpec = {
        name: "test.module.output-invalid",
        scope: "module",
        version: "1.0",
        description: "output validation test",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
          required: ["message"],
        },
        outputSchema: {
          type: "object",
          properties: {
            status: { type: "string" },
          },
          required: ["status"],
        },
        guards: [],
      };

      toolRegistry.register(
        spec,
        {
          execute: async () => ({ status: 200 }),
        },
        { moduleId: "test.module" },
      );

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: {
          id: "call-output-invalid",
          name: "test.module.output-invalid",
          args: { message: "hello" },
        },
      });

      expect(result.isError).toBe(true);
      expect(result.result).toMatchObject({
        code: "SCHEMA_ERROR",
        phase: "serialization",
      });
    });

    it("passes when tool output matches outputSchema", async () => {
      const execute = mock(async () => ({ status: "ok" }));
      const spec: ToolSpec = {
        name: "test.module.output-valid",
        scope: "module",
        version: "1.0",
        description: "output validation success",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
          required: ["message"],
        },
        outputSchema: {
          type: "object",
          properties: {
            status: { type: "string" },
          },
          required: ["status"],
        },
        guards: [],
      };

      toolRegistry.register(spec, { execute }, { moduleId: "test.module" });

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: {
          id: "call-output-valid",
          name: "test.module.output-valid",
          args: { message: "hello" },
        },
      });

      expect(result.isError).toBe(false);
      expect(result.result).toEqual({ status: "ok" });
      expect(execute).toHaveBeenCalledTimes(1);
    });
  });

  describe("context injection", () => {
    it("injects workspace_id from activeContext when missing", async () => {
      let seenArgs: Record<string, unknown> | undefined;
      toolRegistry.register(
        createDefinition("echo.inject-workspace", {
          type: "object",
          properties: {
            message: { type: "string" },
            workspace_id: { type: "string" },
          },
          required: ["message", "workspace_id"],
        }),
        {
          execute: (args) => {
            seenArgs = args;
            return { ok: true };
          },
        },
      );

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        activeContext: { workspaceId: "ws-from-context" },
        toolCall: {
          id: "call-inject-workspace",
          name: "echo.inject-workspace",
          args: { message: "hello" },
        },
      });

      expect(result.isError).toBe(false);
      expect(seenArgs?.workspace_id).toBe("ws-from-context");
    });

    it("does not override workspace_id already present in args", async () => {
      let seenArgs: Record<string, unknown> | undefined;
      toolRegistry.register(
        createDefinition("echo.keep-workspace", {
          type: "object",
          properties: {
            message: { type: "string" },
            workspace_id: { type: "string" },
          },
          required: ["message", "workspace_id"],
        }),
        {
          execute: (args) => {
            seenArgs = args;
            return { ok: true };
          },
        },
      );

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        activeContext: { workspaceId: "ws-from-context" },
        toolCall: {
          id: "call-keep-workspace",
          name: "echo.keep-workspace",
          args: { message: "hello", workspace_id: "ws-explicit" },
        },
      });

      expect(result.isError).toBe(false);
      expect(seenArgs?.workspace_id).toBe("ws-explicit");
    });
  });

  describe("guard execution", () => {
    it("guard failure returns ToolError with CONTEXT_MISSING", async () => {
      const execute = mock(async () => ({ ok: true }));
      const guard = {
        type: "workspace-context" as const,
        validate: async () => ({ pass: false as const, error: "No workspace" }),
      };
      const spec: ToolSpec = {
        name: "guarded.tool",
        scope: "module",
        version: "1.0",
        description: "guarded tool",
        inputSchema: { type: "object", properties: {} },
        guards: [guard],
      };
      toolRegistry.register(spec, { execute }, { moduleId: "guarded" });

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: {
          id: "tc1",
          type: "function",
          function: { name: "guarded.tool", arguments: "{}" },
        },
      });

      expect(result.isError).toBe(true);
      expect(result.result).toMatchObject({
        code: "CONTEXT_MISSING",
        phase: "guard",
      });
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe("execution metadata and errors", () => {
    it("passes execution context metadata to handler", async () => {
      let seenContext: Record<string, unknown> | undefined;
      toolRegistry.register(
        createDefinition("echo.context", {}),
        {
          execute: (_args, context) => {
            seenContext = context as Record<string, unknown>;
            return { ok: true };
          },
        },
        { moduleId: "module.test" },
      );

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        activeContext: { workspaceId: "ws-1", projectId: "pr-1" },
        toolCall: { id: "call-context", name: "echo.context", args: { message: "hi" } },
      });

      expect(result.isError).toBe(false);
      expect(seenContext).toEqual({
        moduleId: "module.test",
        taskId: TASK_ID,
        activeContext: { workspaceId: "ws-1", projectId: "pr-1" },
        provider: PROVIDER,
        model: MODEL,
      });
    });

    it("handler throw is returned as execution error", async () => {
      toolRegistry.register(createDefinition("echo.throw", {}), {
        execute: () => {
          throw new Error("handler exploded");
        },
      });

      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: { id: "call-throw", name: "echo.throw", args: {} },
      });

      expect(result.isError).toBe(true);
      expect(result.result).toEqual({ error: { message: "handler exploded" } });
    });

    it("missing tool name produces required-name error", async () => {
      const result = await dispatcher.executeTool({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        provider: PROVIDER,
        model: MODEL,
        assistantMessageId: "assistant-msg-1",
        toolCall: { id: "call-missing-name", args: {} },
      });

      expect(result.isError).toBe(true);
      expect(result.result).toEqual({ error: { message: "Tool name is required" } });
    });
  });
});
