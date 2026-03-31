# Tool System

## Overview
The OpenPCB tool system provides a robust framework for defining, registering, and executing AI tools. It supports both built-in core tools and dynamically loaded module tools with strict namespace enforcement, runtime validation, and provider-agnostic adapters.

### Architecture
```text
AI Provider (OpenAI/Ollama)
    ↓ StandardToolCall
BaseToolAdapter (Format Conversion)
    ↓ ToolSpec
ToolDispatcher (Validation & Execution)
    ↓
ToolRegistry (Storage) ↔ ToolCatalog (Metadata)
    ↓
ToolHandler (Implementation)
```

## ToolSpec vs ToolDefinition
- **ToolSpec (New)**: Separates metadata from execution. Includes versioning, scope, guards, and provider hints. Preferred for all new tools.
- **ToolDefinition (Legacy)**: OpenAI-style function definition. Supported for backward compatibility with existing modules.

## Registration Flow
Tools are registered via `ToolRegistry.register()`.
1. **Validation**: Namespaces are checked (`core.*` for core, `<moduleId>.*` for modules).
2. **Cataloging**: Metadata is stored in the `ToolCatalog` singleton.
3. **Storage**: The handler and definition are stored in the `ToolRegistry` map.

## Validation Pipeline
The `ToolDispatcher` executes tools using a multi-stage pipeline:
1. **Context Injection**: Automatically injects `workspace_id` and `project_id` from active context.
2. **Schema Validation**: Uses **AJV** to validate arguments against the tool's `inputSchema`.
3. **Guard Execution**: Runs all registered `ToolGuard`s (e.g., `WorkspaceContextGuard`).
4. **Handler Execution**: Invokes the tool's `execute()` function.
5. **Persistence**: Saves the tool result as a message in the chat history.

## Provider Adapter System
Adapters (`BaseToolAdapter`) normalize communication with AI providers:
- `convertTool(spec)`: Converts `ToolSpec` to provider-specific format.
- `convertToolCall(raw)`: Standardizes provider tool calls into `StandardToolCall`.
- `getCapabilities()`: Reports support for `tool_choice` and parallel execution.

| Provider | Adapter | Parallel Tools | Tool Choice |
|----------|---------|----------------|-------------|
| OpenAI | `OpenAIAdapter` | Yes | Yes |
| Ollama | `OllamaAdapter` | No | No |

## Namespace Rules
- **Core Scope**: MUST use `core.` prefix (e.g., `core.edit_content`).
- **Module Scope**: MUST use `<moduleId>.` prefix (e.g., `knowledge.create_page`).
- Reserved: The `core` namespace is reserved for kernel tools.

## Module Tool Best Practices
1. **Define Spec**: Create a `ToolSpec` in a dedicated file.
2. **Implement Handler**: Create a factory function to inject services into the `ToolHandler`.
3. **Register**: Call `ctx.core.toolRegistry.registerTool` in the module's `onActivate` hook.
4. **Guards**: Use declarative guards like `requireWorkspaceContext()` to enforce requirements.

### Example: Module Tool
```typescript
// tools/my-tool.ts
export const myToolSpec: ToolSpec = {
  name: "my-module.do_something",
  scope: "module",
  version: "1.0",
  description: "Does something useful",
  inputSchema: {
    type: "object",
    properties: {
      param: { type: "string" }
    },
    required: ["param"]
  },
  guards: [requireWorkspaceContext()]
};

export function createMyToolHandler(service: MyService): ToolHandler {
  return {
    execute: async (args) => {
      return await service.perform(args.param);
    }
  };
}

// module.ts
onActivate(ctx) {
  ctx.core.toolRegistry.registerTool(
    myToolSpec, 
    createMyToolHandler(myService)
  );
}
```

## Error Handling
The system uses structured `ToolError` objects:
- **Phases**: `validation`, `guard`, `execution`, `serialization`.
- **Codes**: `VALIDATION_FAILED`, `AUTH_REQUIRED`, `CONTEXT_MISSING`, `EXECUTION_ERROR`, etc.
- **Retryability**: Automatically determined based on the error code.

## Auto-Cleanup
The `ModuleLoader` tracks all tools registered by a module. When `unloadModule()` is called, it automatically unregisters the tools from both `ToolRegistry` and `ToolCatalog` to prevent memory leaks and stale tool definitions.

## Content Editing
The `core.edit_content` tool (and legacy `edit_content`) uses the `ContentTargetResolver` to route edits to specific implementations (e.g., `knowledge.page`). It is registered as a standard tool, removing special-case logic from the dispatcher.

## Where to Look

| File | Purpose |
|------|---------|
| `shared/types/tool-spec.types.ts` | `ToolSpec`, `ToolGuard`, `ToolScope` definitions |
| `shared/types/tool-error.types.ts` | `ToolError` structure and helper functions |
| `domain/services/tools/tool-registry.ts` | Central registry for tool implementations |
| `domain/services/tools/tool-catalog.ts` | Metadata registry for tool specifications |
| `domain/services/tools/tool-dispatcher.ts` | Execution engine with AJV validation |
| `domain/services/tools/tool-guards.ts` | Built-in guards (Workspace, Project, Auth) |
| `infrastructure/ai-providers/adapters/` | Provider-specific tool format adapters |
| `domain/services/content-editor/` | Content target resolution for `edit_content` |

## Creating New Tools

Use the `/tool-create` skill for step-by-step guidance on creating new tools.
It covers ToolSpec definition, handler factories, registration, guards, and testing.
