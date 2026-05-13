export type ToolEffect = "read" | "write";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface RegisteredTool {
  definition: ToolDefinition;
  effect: ToolEffect;
  execute(args: unknown): Promise<unknown>;
}

export class AssistantToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.function.name, tool);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  get(name: string): RegisteredTool | null {
    return this.tools.get(name) ?? null;
  }
}
