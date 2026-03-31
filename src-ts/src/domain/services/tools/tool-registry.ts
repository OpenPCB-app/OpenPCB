import type { ToolSpec } from "@shared/types/tool-spec.types";
import type {
  ToolDefinition,
  ToolHandler,
  RegisteredTool,
  ToolRegistrationOptions,
} from "@shared/types/tool.types";
import { ToolCatalog } from "./tool-catalog";

export type {
  ToolExecutionContext,
  ToolHandler,
  RegisteredTool,
  ToolRegistrationOptions,
  RegisterToolFunction,
} from "@shared/types/tool.types";

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(
    definitionOrSpec: ToolDefinition | ToolSpec,
    handler: ToolHandler,
    options?: ToolRegistrationOptions,
  ): () => void {
    if (this.isToolSpec(definitionOrSpec)) {
      return this.registerToolSpec(definitionOrSpec, handler, options);
    }
    return this.registerToolDefinition(definitionOrSpec, handler, options);
  }

  private registerToolSpec(
    spec: ToolSpec,
    handler: ToolHandler,
    options?: ToolRegistrationOptions,
  ): () => void {
    const name = spec.name;

    const existing = this.tools.get(name);
    if (existing && !options?.override) {
      throw new Error(`Tool '${name}' already registered. Pass override=true to replace.`);
    }

    // Validate module namespace: module-scoped tools must match moduleId prefix
    if (options?.moduleId && spec.scope === "module") {
      const expectedPrefix = `${options.moduleId}.`;
      if (!name.startsWith(expectedPrefix)) {
        throw new Error(
          `Invalid namespace for module tool '${name}': expected prefix '${expectedPrefix}'`,
        );
      }
    }

    // Register in ToolCatalog (handles namespace format validation)
    const catalog = ToolCatalog.getInstance();
    if (options?.override) {
      catalog.unregister(name);
    }
    catalog.register(spec);

    // Convert ToolSpec → ToolDefinition for backward compatibility
    const definition: ToolDefinition = {
      type: "function",
      function: {
        name: spec.name,
        description: spec.description,
        parameters: spec.inputSchema,
      },
    };

    this.tools.set(name, {
      definition,
      handler,
      moduleId: options?.moduleId,
      spec,
    });

    return () => {
      this.unregister(name);
    };
  }

  private registerToolDefinition(
    definition: ToolDefinition,
    handler: ToolHandler,
    options?: ToolRegistrationOptions,
  ): () => void {
    if (definition.type !== "function") {
      throw new Error("Only function tools are supported for registration");
    }

    const name = definition.function.name;
    if (!name) {
      throw new Error("Tool definition must provide a function name");
    }

    const existing = this.tools.get(name);
    if (existing && !options?.override) {
      throw new Error(`Tool '${name}' already registered. Pass override=true to replace.`);
    }

    this.tools.set(name, {
      definition,
      handler,
      moduleId: options?.moduleId,
    });

    return () => {
      this.unregister(name);
    };
  }

  unregister(toolName: string): boolean {
    const deleted = this.tools.delete(toolName);
    ToolCatalog.getInstance().unregister(toolName);
    return deleted;
  }

  get(toolName: string): RegisteredTool {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' is not registered`);
    }
    return tool;
  }

  getHandler(toolName: string): ToolHandler {
    return this.get(toolName).handler;
  }

  has(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  list(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  clear(): void {
    this.tools.clear();
  }

  private isToolSpec(value: ToolDefinition | ToolSpec): value is ToolSpec {
    return (
      typeof value === "object" &&
      value !== null &&
      "inputSchema" in value &&
      "scope" in value
    );
  }
}
