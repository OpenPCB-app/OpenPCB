import type { ToolDefinition } from "../../src/infrastructure/ai-providers/engine";
import type { ToolSpec } from "./tool-spec.types";

export type { ToolDefinition };

export type ToolDisposable = () => void;

export interface ToolExecutionContext {
  moduleId?: string;
  taskId: string;
  activeContext?: Record<string, unknown>;
  provider?: string;
  model?: string;
}

export interface ToolHandler {
  execute(
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> | unknown;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
  moduleId?: string;
  spec?: ToolSpec;
}

export interface ToolRegistrationOptions {
  override?: boolean;
  moduleId?: string;
}

export type RegisterToolFunction = (
  definitionOrSpec: ToolDefinition | ToolSpec,
  handler: ToolHandler,
  options?: ToolRegistrationOptions,
) => ToolDisposable;
