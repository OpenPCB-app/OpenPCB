import type { ToolSpec } from "@shared/types/tool-spec.types";

/**
 * ToolCatalog - Metadata registry for ToolSpec objects.
 * 
 * This catalog stores tool specifications (metadata, schemas, guards) 
 * but does not handle tool execution. It ensures that tool names 
 * follow the required namespace conventions and prevents duplicates.
 * 
 * Singleton pattern: Use getToolCatalog() to access the instance.
 */
export class ToolCatalog {
  private specs = new Map<string, ToolSpec>();
  private static instance: ToolCatalog | null = null;

  private constructor() {}

  static getInstance(): ToolCatalog {
    if (!ToolCatalog.instance) {
      ToolCatalog.instance = new ToolCatalog();
    }
    return ToolCatalog.instance;
  }

  static reset(): void {
    ToolCatalog.instance = null;
  }

  /**
   * Register a tool specification.
   * @throws Error if name format invalid or already registered.
   */
  register(spec: ToolSpec): void {
    this.validateNamespace(spec);

    if (this.specs.has(spec.name)) {
      throw new Error(`Tool '${spec.name}' is already registered in the catalog.`);
    }

    this.specs.set(spec.name, spec);
  }

  get(name: string): Readonly<ToolSpec> | undefined {
    return this.specs.get(name);
  }

  unregister(name: string): boolean {
    return this.specs.delete(name);
  }

  list(): ReadonlyArray<Readonly<ToolSpec>> {
    return Array.from(this.specs.values());
  }

  has(name: string): boolean {
    return this.specs.has(name);
  }

  clear(): void {
    this.specs.clear();
  }

  private validateNamespace(spec: ToolSpec): void {
    const name = spec.name;

    // Transitional legacy compatibility for provider-emitted edit_content.
    if (spec.scope === "core" && name === "edit_content") {
      return;
    }

    // Prefix: [a-z][a-z0-9-]*
    const namespaceRegex = /^[a-z][a-z0-9-]*\..+$/;

    if (!namespaceRegex.test(name)) {
      throw new Error(
        `Invalid tool name format: '${name}'. Must follow <namespace>.<name> convention.`
      );
    }

    const dotIndex = name.indexOf(".");
    const prefix = name.substring(0, dotIndex);

    if (spec.scope === "core" && prefix !== "core") {
      throw new Error(
        `Core tool '${name}' must use 'core' namespace prefix.`
      );
    }

    if (spec.scope === "module" && prefix === "core") {
      throw new Error(
        `Module tool '${name}' cannot use reserved 'core' namespace.`
      );
    }
  }
}

export function initToolCatalog(): ToolCatalog {
  return ToolCatalog.getInstance();
}

export function getToolCatalog(): ToolCatalog {
  return ToolCatalog.getInstance();
}
