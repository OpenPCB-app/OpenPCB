import type { DatabaseAccess } from "../../../db";
import type { ActiveContext } from "../../../db/schema/task";
import type { ToolCall } from "../../../infrastructure/ai-providers/engine";
import type { ToolExecutionContext } from "./tool-registry";
import { ToolRegistry } from "./tool-registry";
import { generateUUIDv7 } from "../../../db/schema/base";
import { validateArgs } from "../../../shared/validation/ajv-validator";
import { createToolError } from "../../../../shared/types/tool-error.types";

export interface ToolDispatcherEvent {
  type: "task.tool_result";
  taskId: string;
  data: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError?: boolean;
    seq?: number;
  };
  timestamp: string;
}

export interface ToolDispatcherConfig {
  emitEvent?: (event: ToolDispatcherEvent) => void;
}

export interface ToolCallInput {
  id?: string;
  name?: string;
  args?: unknown;
  function?: {
    name?: string;
    arguments?: unknown;
  };
}

export interface ToolExecutionInput {
  taskId: string;
  chatId: string;
  provider: string;
  model: string;
  assistantMessageId: string;
  workspaceId?: string;
  projectId?: string;
  toolCall: ToolCall | ToolCallInput;
  activeContext?: ActiveContext;
  seq?: number;
}

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
  seq?: number;
  contextMessage: { role: "assistant"; content: string };
}

export class ToolDispatcher {
  constructor(
    private readonly db: DatabaseAccess,
    private readonly toolRegistry: ToolRegistry,
    private readonly config: ToolDispatcherConfig = {},
  ) {}

  async executeTool(input: ToolExecutionInput): Promise<ToolExecutionResult> {
    const normalized = this.normalizeToolCall(input.toolCall);
    const toolName = normalized.name;
    const toolCallId = normalized.id || generateUUIDv7();
    let args = normalized.args;

    if (toolName) {
      args = await this.injectContextArgs(args, input);
    }

    let result: unknown;
    let isError = false;

    try {
      if (!toolName) {
        throw new Error("Tool name is required");
      }

      const tool = this.toolRegistry.get(toolName);
      const context: ToolExecutionContext = {
        moduleId: tool.moduleId,
        taskId: input.taskId,
        activeContext: input.activeContext as Record<string, unknown> | undefined,
        provider: input.provider,
        model: input.model,
      };

      // Schema validation
      const schema = tool.definition?.function?.parameters;
      if (
        schema &&
        typeof schema === "object" &&
        ("properties" in schema || "required" in schema || "type" in schema)
      ) {
        try {
          const validation = validateArgs(schema as Record<string, unknown>, args);
          if (!validation.valid) {
            isError = true;
            result = createToolError(
              "VALIDATION_FAILED",
              `Validation failed for tool '${toolName}'`,
              {
                phase: "validation",
                details: { errors: validation.errors },
              },
            );
          }
        } catch (schemaError) {
          console.error(
            `[ToolDispatcher] Schema compilation failed for tool '${toolName}':`,
            schemaError,
          );
          // Non-fatal: proceed to execution
        }
      }

      // Guard execution (only if validation passed)
      if (!isError && tool.spec?.guards) {
        for (const guard of tool.spec.guards) {
          const guardContext = {
            workspaceId:
              typeof args.workspace_id === "string"
                ? args.workspace_id
                : input.activeContext?.workspaceId ?? input.workspaceId,
            projectId:
              typeof args.project_id === "string"
                ? args.project_id
                : input.activeContext?.projectId ?? input.projectId,
            moduleId: tool.moduleId,
          };
          const guardResult = await guard.validate(guardContext);
          if (!guardResult.pass) {
            isError = true;
            const errorCode =
              guard.type === "auth" ? "AUTH_REQUIRED" : "CONTEXT_MISSING";
            result = createToolError(
              errorCode,
              guardResult.error ||
                `Guard '${guard.type}' failed for tool '${toolName}'`,
              {
                phase: "guard",
                details: { guardType: guard.type },
              },
            );
            break;
          }
        }
      }

      // Handler execution (only if validation and guards passed)
      if (!isError) {
        result = await tool.handler.execute(args, context);

        const outputSchema = tool.spec?.outputSchema;
        if (
          outputSchema &&
          typeof outputSchema === "object" &&
          ("properties" in outputSchema || "required" in outputSchema || "type" in outputSchema)
        ) {
          try {
            const outputValidation = validateArgs(outputSchema as Record<string, unknown>, result);
            if (!outputValidation.valid) {
              isError = true;
              result = createToolError(
                "SCHEMA_ERROR",
                `Output schema validation failed for tool '${toolName}'`,
                {
                  phase: "serialization",
                  details: { errors: outputValidation.errors },
                },
              );
            }
          } catch (schemaError) {
            console.error(
              `[ToolDispatcher] Output schema compilation failed for tool '${toolName}':`,
              schemaError,
            );
          }
        }
      }
    } catch (err) {
      isError = true;
      result = {
        error: {
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }

    await this.persistToolResultEvent({
      chatId: input.chatId,
      assistantMessageId: input.assistantMessageId,
      taskId: input.taskId,
      toolCallId,
      toolName,
      result,
      isError,
      seq: input.seq,
    });

    this.emitToolResult({
      taskId: input.taskId,
      toolCallId,
      toolName,
      result,
      isError,
      seq: input.seq,
    });

    return {
      toolCallId,
      toolName: toolName || "",
      result,
      isError,
      seq: input.seq,
      contextMessage: {
        role: "assistant",
        content: this.formatToolResultForContext({
          toolCallId,
          toolName,
          result,
          isError,
        }),
      },
    };
  }

  private normalizeToolCall(toolCall: ToolCall | ToolCallInput): {
    id?: string;
    name?: string;
    args: Record<string, unknown>;
  } {
    const hasFunction = "function" in toolCall && !!toolCall.function;
    const rawArgs = hasFunction
      ? toolCall.function?.arguments
      : "args" in toolCall
        ? toolCall.args
        : undefined;
    const name = hasFunction
      ? toolCall.function?.name
      : "name" in toolCall
        ? toolCall.name
        : undefined;
    const id = toolCall.id;

    return {
      id,
      name,
      args: this.normalizeArgs(rawArgs),
    };
  }

  private normalizeArgs(rawArgs: unknown): Record<string, unknown> {
    if (typeof rawArgs === "string") {
      const parsed = this.safeParseJson(rawArgs);
      if (this.isRecord(parsed)) {
        return parsed;
      }
      return { raw: rawArgs };
    }

    if (this.isRecord(rawArgs)) {
      return rawArgs;
    }

    if (rawArgs === undefined) {
      return {};
    }

    return { value: rawArgs };
  }

  private async injectContextArgs(
    args: Record<string, unknown>,
    input: ToolExecutionInput,
  ): Promise<Record<string, unknown>> {
    const injected = { ...args };
    const workspaceFromContext = input.activeContext?.workspaceId;
    const projectFromContext = input.activeContext?.projectId;

    const hasWorkspaceId =
      typeof injected.workspace_id === "string" &&
      injected.workspace_id.length > 0;
    const hasProjectId =
      typeof injected.project_id === "string" &&
      injected.project_id.length > 0;

    let resolvedWorkspaceId = hasWorkspaceId
      ? (injected.workspace_id as string)
      : workspaceFromContext ?? input.workspaceId;
    let resolvedProjectId = hasProjectId
      ? (injected.project_id as string)
      : projectFromContext ?? input.projectId;

    if ((!resolvedWorkspaceId || !resolvedProjectId) && input.chatId) {
      const chat = await this.db.chats.findById(input.chatId);
      if (!resolvedWorkspaceId && chat?.workspaceId) {
        resolvedWorkspaceId = chat.workspaceId;
      }
      if (!resolvedProjectId && chat?.projectId) {
        resolvedProjectId = chat.projectId;
      }
    }

    if (!hasWorkspaceId && resolvedWorkspaceId) {
      injected.workspace_id = resolvedWorkspaceId;
    }

    if (!hasProjectId && resolvedProjectId) {
      injected.project_id = resolvedProjectId;
    }

    return injected;
  }

  private safeParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private async persistToolResultEvent(params: {
    chatId: string;
    assistantMessageId: string;
    taskId: string;
    toolCallId: string;
    toolName: string | undefined;
    result: unknown;
    isError: boolean;
    seq?: number;
  }): Promise<void> {
    const {
      chatId,
      assistantMessageId,
      taskId,
      toolCallId,
      toolName,
      result,
      isError,
      seq,
    } = params;

    await this.db.taskToolEvents.appendToolResult({
      chatId,
      assistantMessageId,
      taskId,
      seq,
      toolCallId,
      toolName: toolName || "",
      result,
      isError,
    });
  }

  private emitToolResult(params: {
    taskId: string;
    toolCallId: string;
    toolName: string | undefined;
    result: unknown;
    isError: boolean;
    seq?: number;
  }): void {
    if (!this.config.emitEvent) {
      return;
    }

    this.config.emitEvent({
      type: "task.tool_result",
      taskId: params.taskId,
      data: {
        toolCallId: params.toolCallId,
        toolName: params.toolName || "",
        result: params.result,
        isError: params.isError || undefined,
        seq: params.seq,
      },
      timestamp: new Date().toISOString(),
    });
  }

  private formatToolResultForContext(params: {
    toolCallId: string;
    toolName: string | undefined;
    result: unknown;
    isError: boolean;
  }): string {
    const name = params.toolName ? ` ${params.toolName}` : "";
    const status = params.isError ? "Tool error" : "Tool result";
    const suffix = params.toolCallId ? ` (${params.toolCallId})` : "";
    const resultText = this.safeStringify(params.result);
    return `${status}${name}${suffix}: ${resultText}`;
  }

  private safeStringify(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
