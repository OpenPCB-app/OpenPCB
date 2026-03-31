/**
 * ToolSpec Abstraction Layer Types
 * 
 * This file defines the new ToolSpec format which separates tool metadata 
 * from execution, including guards, scopes, and provider hints.
 * 
 * RELATIONSHIP:
 * - ToolSpec is the NEW way to define tools in OpenPCB.
 * - ToolDefinition (from engine.ts) is the LEGACY format used by AI providers.
 * - ToolSpec can be converted to ToolDefinition for backward compatibility.
 */

/**
 * Scope of the tool.
 * - 'core': Built-in tools provided by the OpenPCB kernel.
 * - 'module': Tools provided by external modules/plugins.
 */
export type ToolScope = "core" | "module";

/**
 * Context provided to tool guards for validation.
 */
export interface ToolGuardContext {
  workspaceId?: string;
  projectId?: string;
  moduleId?: string;
  taskId?: string;
  [key: string]: unknown;
}

/**
 * Result of a guard validation.
 */
export type GuardResult = {
  pass: boolean;
  error?: string;
};

/**
 * A guard that validates tool execution before it happens.
 */
export interface ToolGuard {
  /** Unique identifier for the guard type (e.g., 'permission', 'rate-limit') */
  type: string;
  /** Validation function */
  validate: (context: ToolGuardContext) => Promise<GuardResult>;
}

/**
 * ToolSpec defines the metadata and requirements for a tool.
 * 
 * NAMESPACE CONVENTION:
 * - Core tools MUST use the 'core.' prefix (e.g., 'core.readFile').
 * - Module tools MUST use the '<moduleId>.' prefix (e.g., 'my-module.doSomething').
 */
export interface ToolSpec {
  /** 
   * Unique name of the tool including namespace.
   * Format: <namespace>.<name>
   */
  name: string;

  /** 
   * Version of the tool specification.
   * @default "1.0"
   */
  version: string;

  /** Scope of the tool */
  scope: ToolScope;

  /** Human-readable description of what the tool does */
  description: string;

  /** 
   * JSON Schema for the tool's input parameters.
   * Must be a valid JSON Schema object.
   */
  inputSchema: Record<string, unknown>;

  /** 
   * Optional JSON Schema for the tool's output.
   */
  outputSchema?: Record<string, unknown>;

  /** 
   * Array of guards that must pass before the tool can be executed.
   * Conceptually defaults to an empty array if not provided.
   */
  guards: ToolGuard[];

  /** 
   * Provider-specific hints or configurations.
   * Used to pass extra metadata to specific AI providers (e.g., OpenAI-specific fields).
   */
  providerHints?: Record<string, unknown>;
}

/**
 * Utility type to convert ToolSpec to the legacy ToolDefinition format.
 * 
 * Note: This is used for backward compatibility with AI provider engines
 * that expect the OpenAI-style function definition.
 */
export type ToolSpecToDefinition<T extends ToolSpec> = {
  type: "function";
  function: {
    name: T["name"];
    description: T["description"];
    parameters: T["inputSchema"];
  };
};
