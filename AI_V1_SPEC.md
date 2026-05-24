# AI V1 Specification and Implementation Plan

Status: implementation-ready planning document  
Primary implementation target: `OpenPCB/` Assistant product beta  
Reusable foundation target: `shared/packages/ai-core` as `@openpcb/ai-core`  
Future consumer: `Cloud/` AI features

This document is intended for a fresh AI coding-agent session. It contains product decisions, architecture boundaries, implementation phases, API/type sketches, test requirements, and acceptance criteria.

---

## 0. Agent preflight

Before implementing:

1. Read:
   - `/Users/andrejvysny/workspace/openpcb/AGENTS.md`
   - `/Users/andrejvysny/workspace/openpcb/OpenPCB/AGENTS.md`
   - `/Users/andrejvysny/workspace/openpcb/OpenPCB/CLAUDE.md`
   - `/Users/andrejvysny/workspace/openpcb/shared/README.md`
   - `/Users/andrejvysny/workspace/openpcb/shared/DEVELOPING.md`
2. Do not commit, push, pull, or tag unless explicitly asked.
3. Use `OpenPCB/` for app commands, `shared/` for shared package commands.
4. OpenPCB consumes shared packages from GitHub tags by default. For local shared-package work:
   - `cd shared && npm run build && npm run dev`
   - in consumer: `cd OpenPCB && npm run shared:link`
   - restore: `npm run shared:unlink`
5. Package managers:
   - `shared/`: npm workspace, tests use Bun.
   - `OpenPCB/`: npm workspaces, Bun backend runtime/tests.
   - `Cloud/`: Bun.

---

## 1. Executive summary

Build AI v1 as a reusable AI substrate, not an OpenPCB-only chat feature.

Create a new shared package:

```txt
shared/packages/ai-core
package name: @openpcb/ai-core
```

`@openpcb/ai-core` is a headless, pure TypeScript package that provides provider interfaces, OpenAI-compatible transport, tool registry, run-loop primitives, context bindings, source/citation types, output limits, prompt composition, and generic search/rerank pipeline interfaces.

OpenPCB Assistant becomes the first product adapter that uses this package. It remains responsible for persistence, module routes, Tasks/SSE integration, Designer/Library tool adapters, provider settings UI, and OpenPCB-specific prompt text.

Cloud can later reuse the same shared core for provider capability handling, prompt composition, citations, generic search/rewrite/rerank interfaces, and tool/result contracts while keeping auth, quota, Supabase/Postgres, pgvector, and Hono routes Cloud-specific.

---

## 2. Product decisions

### 2.1 V1 scope

V1 is a product beta of the standalone Assistant module.

Must have:

- Standalone Assistant UI.
- Read-only grounded AI answers.
- Auto tool calling.
- Local OpenPCB Library component search.
- Component details.
- Natural design lookup.
- Design summary.
- Part detail by reference.
- Provider setup/onboarding.
- Prompt presets.
- Inline expandable source chips.
- Structured tool/result cards.

V1 constraints only, not architecture constraints:

- One primary design per chat.
- Local library only for actual component results.
- Standalone Assistant only, not Designer sidebar.
- Read-only tools only.
- No files/RAG.

Architecture must already allow later:

- Multi-design/project chats.
- In-Designer chat/sidebar.
- Selection/net/part context from editor.
- Datasheet/file RAG.
- Write tools with diff/approval/undo.
- Cloud/supplier component search.
- Design reviews.
- Persistent memory/knowledge base.
- Simulation/code execution.
- Auto-layout/autorouting.

### 2.2 Provider decisions

V1 provider kinds:

- `openai`
- `openai-compatible`
- `lmstudio`
- `omlx`

Notes:

- oMLX has an OpenAI-compatible API.
- `lmstudio` and `omlx` are first-class provider kinds in OpenPCB UI/settings but use OpenAI-compatible transport internally.
- Providers without reliable tool calling are allowed in chat-only mode with a clear warning.
- Tool-call capability is validated via provider presets, settings test, and first-message fallback/downgrade.

### 2.3 Prompt decisions

Ship three prompt presets:

1. Strict Grounded — default.
2. Friendly Tutorial.
3. Minimal Concise.

Prompt setting is per chat with a global default in settings.

### 2.4 Context decisions

- User refers to designs naturally by name.
- If design reference is ambiguous or missing for a design-specific task, ask clarification.
- First successfully resolved design binds the chat as the primary design.
- If user asks about another design in the same chat, explain that v1 chats are scoped to one design and offer starting a new chat.
- If a bound design is deleted/unavailable, unbind and ask user to choose another design.

These are v1 behavior rules only. Storage and core contracts must support multiple context bindings.

### 2.5 Component-search decisions

- First optimized demo: `Find a 3.3V regulator for 500mA`.
- Source for actual results in v1: local OpenPCB Library only.
- Search should optimize for requirement fit, not only exact string match.
- Implementation: hybrid LLM query rewrite plus backend normalization/ranking.
- If no good local match: provide clearly marked generic suggestions and text guidance to import/create the component.
- Cloud/supplier search is later.

---

## 3. Current state summary

### 3.1 OpenPCB Assistant current state

Relevant files:

- `OpenPCB/src/modules/assistant/manifest.json`
- `OpenPCB/src/modules/assistant/backend/assistant-service.ts`
- `OpenPCB/src/modules/assistant/backend/routes.ts`
- `OpenPCB/src/modules/assistant/backend/providers/openai-compatible.ts`
- `OpenPCB/src/modules/assistant/backend/providers/types.ts`
- `OpenPCB/src/modules/assistant/backend/settings-store.ts`
- `OpenPCB/src/modules/assistant/backend/tools/tool-registry.ts`
- `OpenPCB/src/modules/assistant/backend/tools/register-core-tools.ts`
- `OpenPCB/src/modules/assistant/frontend/Space.tsx`
- `OpenPCB/src/core/frontend/src/settings/panels/AssistantPanel.tsx`
- `OpenPCB/src/sdks/assistant/types.ts`

Current capabilities:

- Assistant module exists but is marked dev-only.
- Standalone Assistant space exists.
- Provider settings UI exists.
- OpenAI-compatible streaming exists.
- Chat persistence exists.
- Tasks/SSE integration exists.
- Existing tools are minimal/read-only: library search and design listing.
- Write-tool approval scaffold exists but v1 should remain read-only.

Current limitations to fix:

- Assistant is dev-only; v1 should be product beta.
- Provider/tool contracts are too app-specific and should move into shared core.
- Tool names may use dots; provider-safe names should use underscores.
- Tool messages are not preserved as native `tool` role with `tool_call_id`.
- System prompts/presets are not fully modeled.
- Tool event/result cards and source chips need stronger metadata.
- Library/Designer dependencies should be optional for Assistant.
- Result caps/citations/source refs need standardization.
- Provider capability model is insufficient for local/tool-less models.

### 3.2 Relevant OpenPCB SDKs

Designer SDK currently exposes useful read APIs:

- `listDesigns()`
- `getDesign(designId)`
- `getSchematicProjection(designId)`
- `getPcbProjection(designId)`
- `runErc(designId)`
- `searchLibraryComponents(params)`
- `resolveLibraryComponentForPlacement(componentId)`

Library SDK currently exposes useful read APIs:

- `resolveComponent(componentId)`
- `getSymbol(symbolId)`
- `getFootprint(footprintId)`
- `getComponentDetail(componentId)`
- `searchComponents(params)`
- `resolveComponentForPlacement(componentId)`
- `listTags(options)`

Tasks SDK exposes async run/event/chunk primitives and SSE routes already used by Assistant.

### 3.3 Shared current state

Existing packages:

- `@openpcb/kicad-parsers`
- `@openpcb/rendering-core`
- `@openpcb/kicad-import`
- `@openpcb/step-to-glb`
- `@openpcb/r3f-eda-canvas`
- `@openpcb/opclib-pack`
- `@openpcb/command-pattern`
- `@openpcb/contracts`

`@openpcb/contracts` already has Assistant SDK wire types under:

- `shared/packages/contracts/src/sdks/assistant/types.ts`

It currently defines only basic Assistant DTOs and provider kinds `openai | openai-compatible`.

### 3.4 Cloud current AI state

Relevant files:

- `Cloud/src/modules/ai/routes/component-search.ts`
- `Cloud/src/modules/ai/providers/index.ts`
- `Cloud/src/modules/ai/usage-counter.ts`

Current Cloud AI is narrow:

- Component search route.
- Embedding via OpenAI.
- LLM rerank via Vercel AI SDK.
- Quota via DB function.
- Requires auth + Pro tier.
- Uses Postgres RPC `match_components(...)`/halfvec.

Cloud should later use shared AI interfaces, not OpenPCB app code.

---

## 4. Architecture split

### 4.1 `@openpcb/ai-core` owns

Headless reusable functionality:

- Provider interfaces.
- OpenAI-compatible fetch client.
- OpenAI/LM Studio/oMLX/OpenAI-compatible provider preset metadata.
- Tool definition types.
- Tool registry.
- Tool argument/result validation helpers where feasible without heavy deps.
- Tool-call run-loop primitives.
- Streaming run events.
- Context binding model.
- Source/citation model.
- Prompt preset composition API.
- Adaptive output-cap helpers.
- Generic search/rewrite/rerank pipeline interfaces.
- Deterministic tests for core behavior.

It must not import:

- OpenPCB core/module contracts.
- OpenPCB Designer/Library SDKs.
- OpenPCB Tasks module types.
- Cloud Hono/auth/db code.
- React/DOM/Electron.
- Provider SDKs.

Runtime dependency policy:

- Prefer zero runtime dependencies.
- May depend on `@openpcb/contracts` only if necessary, but avoid circular dependency.
- Do not depend on OpenAI/Anthropic/Vercel AI SDKs.
- Use global `fetch` for OpenAI-compatible transport.

### 4.2 `@openpcb/contracts` owns

Wire contracts and SDK DTOs:

- Public Assistant SDK DTOs.
- Re-export or mirror selected `@openpcb/ai-core` types.
- Module SDK token remains here: `MODULE_SDK_TOKENS.ASSISTANT`.

Important design choice to decide during implementation:

- Option A: `@openpcb/contracts` depends on `@openpcb/ai-core` and re-exports shared AI types.
- Option B: `@openpcb/contracts` duplicates minimal wire-compatible AI DTOs to avoid dependency direction.

Recommended: Option A if no circular dependency occurs. Make `@openpcb/ai-core` not depend on `@openpcb/contracts`. Then `contracts` can depend on `ai-core`.

### 4.3 OpenPCB owns

OpenPCB-specific adapters and product UX:

- Assistant module DB schema/migrations/stores.
- Module routes.
- Tasks/SSE integration.
- Provider settings storage and secrets handling.
- Designer/Library SDK tool adapters.
- Context resolver against local designs/library.
- Prompt preset text.
- Assistant UI.
- Settings UI.
- Tool cards/source chips.
- Local quickstart for LM Studio/oMLX.

### 4.4 Cloud owns later

Cloud-specific adapters:

- Hono route handlers.
- Auth, workspace/tenant boundaries, Pro tier gates.
- Quota/usage accounting.
- Provider key loading from Cloud env/secrets.
- Supabase/Postgres/pgvector queries.
- Embedding storage/search.
- Mapping Cloud component DB rows to shared AI result/source shapes.

Cloud can reuse:

- Provider interface/types.
- Prompt composition.
- Source/citation/result envelopes.
- Search/rewrite/rerank pipeline interfaces.
- OpenAI-compatible client if desired.

---

## 5. `@openpcb/ai-core` package specification

### 5.1 Package metadata

Create:

```txt
shared/packages/ai-core/package.json
shared/packages/ai-core/tsconfig.json
shared/packages/ai-core/tsconfig.build.json
shared/packages/ai-core/src/index.ts
shared/packages/ai-core/tests/*.test.ts
```

Suggested `package.json` shape, matching existing shared packages:

```jsonc
{
  "name": "@openpcb/ai-core",
  "version": "0.1.0",
  "description": "Headless AI runtime primitives for OpenPCB ecosystem: providers, tools, context, citations, prompts, and run events.",
  "license": "AGPL-3.0-or-later",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./*": {
      "types": "./dist/*.d.ts",
      "import": "./dist/*.js"
    }
  },
  "files": ["dist", "src", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "bun test tests",
    "prepack": "npm run build",
    "prepare": "npm run build",
    "dev": "tsc -p tsconfig.build.json --watch"
  },
  "devDependencies": {
    "@types/bun": "^1.3.5",
    "typescript": "^5.8.3"
  }
}
```

Update `shared/package.json` workspace automatically covers `packages/*`.

Update `shared/README.md` package table after implementation.

### 5.2 Recommended source layout

```txt
src/
  index.ts
  ids.ts
  json-schema.ts
  providers/
    types.ts
    openai-compatible.ts
    presets.ts
    sse.ts
  tools/
    types.ts
    registry.ts
    limits.ts
    validation.ts
  runs/
    types.ts
    run-loop.ts
    events.ts
  context/
    bindings.ts
    resolver.ts
  prompts/
    types.ts
    compose.ts
  sources/
    source-ref.ts
  search/
    pipeline.ts
```

Keep files small and pure. No framework imports.

### 5.3 JSON schema type

Avoid adding Ajv/Zod in v1 core. Define a minimal JSON-schema-compatible type for tool declarations.

```ts
export type AiJsonPrimitiveType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export interface AiJsonSchemaObject {
  type?: AiJsonPrimitiveType | AiJsonPrimitiveType[];
  description?: string;
  properties?: Record<string, AiJsonSchemaObject>;
  required?: string[];
  items?: AiJsonSchemaObject;
  enum?: Array<string | number | boolean | null>;
  additionalProperties?: boolean | AiJsonSchemaObject;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}
```

Consumers may validate with Zod/Ajv if they want. Core can provide lightweight required-field checks only.

### 5.4 Provider types

```ts
export type AiProviderKind = "openai" | "openai-compatible" | "lmstudio" | "omlx";

export interface AiProviderConfig {
  id: string;
  label: string;
  kind: AiProviderKind;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface AiProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  modelList: boolean;
  vision?: boolean;
  jsonMode?: boolean;
  maxContextTokens?: number;
  checkedAt?: string;
  warning?: string;
}

export interface AiProviderModel {
  providerId: string;
  modelId: string;
  displayName: string | null;
  contextWindowTokens?: number;
  supportsToolCalling?: boolean;
  fetchedAt: string;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: AiToolCall[];
  metadata?: Record<string, unknown>;
}

export interface AiChatRequest {
  model: string;
  messages: AiChatMessage[];
  tools?: AiToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface AiProviderClient {
  id: string;
  kind: AiProviderKind;
  capabilities(): Promise<AiProviderCapabilities>;
  listModels(): Promise<AiProviderModel[]>;
  streamChat(input: AiChatRequest): AsyncIterable<AiRunEvent>;
}
```

### 5.5 OpenAI-compatible transport

Implement in `@openpcb/ai-core` as pure `fetch` code.

Responsibilities:

- Normalize base URL.
- `GET /models` model listing.
- `POST /chat/completions` streaming.
- Parse SSE lines.
- Emit normalized `AiRunEvent`s for text deltas, tool-call deltas/completions, usage, finish, error.
- Support OpenAI-compatible tool schema:
  - `{ type: "function", function: { name, description, parameters } }`
- Provider kinds `openai`, `openai-compatible`, `lmstudio`, `omlx` share this transport.

Do not import OpenAI SDK.

Provider presets should be metadata only:

```ts
export interface AiProviderPreset {
  kind: AiProviderKind;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
  docsUrl?: string;
  notes?: string;
}
```

Initial presets:

- OpenAI: `https://api.openai.com/v1`, model `gpt-4o-mini`, API key required.
- LM Studio: `http://127.0.0.1:1234/v1`, model placeholder `local-model`, no API key by default.
- oMLX: OpenAI-compatible kind, base URL/model to document/configure; no hardcoded uncertain defaults unless confirmed during implementation.
- Custom OpenAI-compatible: `http://127.0.0.1:1234/v1`, model `local-model`.

### 5.6 Tool definitions and registry

```ts
export type AiToolEffect = "read" | "write";

export interface AiToolDefinition {
  name: string; // provider-safe: /^[a-zA-Z0-9_-]+$/
  version: string;
  effect: AiToolEffect;
  capability: string;
  description: string;
  inputSchema: AiJsonSchemaObject;
  outputSchema?: AiJsonSchemaObject;
}

export interface AiToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export type AiToolStatus = "requested" | "running" | "succeeded" | "failed" | "rejected";

export interface AiToolExecutionContext {
  runId: string;
  chatId?: string;
  userId?: string;
  bindings: AiContextBinding[];
  limits: AiToolLimits;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface AiTool<TInput = unknown, TOutput = unknown> {
  definition: AiToolDefinition;
  execute(ctx: AiToolExecutionContext, input: TInput): Promise<AiToolResult<TOutput>>;
}
```

Registry behavior:

- Register tools by provider-safe `name`.
- Reject duplicate names.
- Validate names.
- Return only definitions to provider.
- Execute by name.
- Apply policy helpers for read/write.
- Core supports write tools generically, but OpenPCB v1 registers only read tools.

### 5.7 Tool result and citations

```ts
export interface AiSourceRef {
  id: string;
  kind:
    | "design"
    | "schematic"
    | "pcb"
    | "net"
    | "part"
    | "library-component"
    | "symbol"
    | "footprint"
    | "file"
    | "tool"
    | "external";
  label: string;
  refId?: string;
  path?: string;
  excerpt?: string;
  metadata?: Record<string, unknown>;
}

export interface AiToolLimits {
  profile: "small" | "medium" | "large";
  maxBytes: number;
  maxItems?: number;
}

export interface AiToolResult<T = unknown> {
  ok: boolean;
  data: T;
  sources: AiSourceRef[];
  warnings: string[];
  truncated: boolean;
  limits: AiToolLimits;
}
```

### 5.8 Context binding model

```ts
export type AiContextBindingKind =
  | "design"
  | "library-component"
  | "symbol"
  | "footprint"
  | "file"
  | "selection"
  | "net"
  | "part";

export interface AiContextBinding {
  id: string;
  kind: AiContextBindingKind;
  refId: string;
  label: string;
  role: "primary" | "reference" | "comparison";
  status: "active" | "missing" | "stale";
  metadata?: Record<string, unknown>;
}
```

Core should not enforce one-design-per-chat. OpenPCB v1 adapter enforces that.

### 5.9 Run events and run loop

```ts
export type AiRunEventType =
  | "run.started"
  | "run.message.delta"
  | "run.tool.requested"
  | "run.tool.running"
  | "run.tool.succeeded"
  | "run.tool.failed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

export interface AiRunEvent<TData = unknown> {
  type: AiRunEventType;
  runId: string;
  timestamp: string;
  data?: TData;
}
```

Run loop should:

1. Compose system prompt.
2. Send messages + tool definitions to provider.
3. Stream text deltas.
4. Collect completed tool calls.
5. Validate/execute tools.
6. Append `tool` role messages.
7. Continue provider loop until final answer or max iterations.
8. Emit normalized events.

Suggested safeguards:

- `maxToolIterations` default: 4.
- `maxToolCallsPerIteration` default: 8.
- timeout/cancel via `AbortSignal`.
- all tool execution errors become tool result warnings/errors, not process crashes.

### 5.10 Prompt composition API

Core owns composition mechanics, not product text.

```ts
export interface AiPromptPreset {
  id: string;
  label: string;
  description: string;
  systemText: string;
}

export interface AiPromptContextBlock {
  id: string;
  title: string;
  content: string;
  priority: number;
}

export function composeSystemPrompt(input: {
  preset: AiPromptPreset;
  blocks?: AiPromptContextBlock[];
  toolInstructions?: string;
}): string;
```

OpenPCB provides preset text.

### 5.11 Adaptive output caps

Core helper:

```ts
export type AiContextSizePreference = "small" | "medium" | "large";

export function resolveToolLimits(input: {
  preference: AiContextSizePreference;
  modelContextTokens?: number;
  requestedMaxBytes?: number;
}): AiToolLimits;
```

Suggested defaults:

- small: 16-32 KB/tool.
- medium: 64 KB/tool.
- large: 128 KB/tool.

Use model context size when known. OpenPCB settings controls preference.

### 5.12 Generic search/rerank pipeline interfaces

For future Cloud reuse. Keep interfaces only in v1.

```ts
export interface AiSearchQueryRewriteResult {
  query: string;
  keywords: string[];
  filters: Record<string, string | number | boolean | string[]>;
  assumptions: string[];
}

export interface AiCandidateSearchAdapter<TCandidate> {
  search(input: AiSearchQueryRewriteResult, limit: number): Promise<TCandidate[]>;
}

export interface AiRerankResult {
  id: string;
  score: number;
  reason: string;
}
```

OpenPCB component search can use the same concepts locally. Cloud later maps this to embeddings/pgvector.

---

## 6. OpenPCB Assistant v1 specification

### 6.1 Manifest and dependencies

Current manifest has `availability: "dev"`. For product beta:

- Remove `availability: "dev"` or replace with app-supported beta metadata if available.
- Keep `tasks` required.
- Treat `library` and `designer` as optional tool providers.

Desired dependency strategy:

- Manifest depends on `tasks` only.
- At backend runtime, Assistant tries to resolve LibrarySDK and DesignerSDK when registering/executing tools.
- Tools unavailable if SDK missing; UI can show unavailable tool count/status.

Do not hard-require Library/Designer in manifest unless module runtime needs ordering. If ordering issue exists, solve with lazy SDK lookup in tool execution.

### 6.2 Service decomposition

Avoid growing `assistant-service.ts` into a god class.

Introduce or refactor toward:

```txt
backend/
  assistant-service.ts          // facade/orchestration only
  conversation-store.ts         // chats/messages/context bindings persistence
  provider-store.ts             // provider configs/models/capabilities/secrets
  prompt-service.ts             // OpenPCB preset text + selection
  run-service.ts                // bridges ai-core run loop to Tasks
  context-resolver.ts           // natural design/part/component lookup
  tools/
    openpcb-tool-registry.ts
    library-tools.ts
    designer-tools.ts
  providers/
    openpcb-provider-factory.ts // builds ai-core clients from stored config
```

Keep routes thin.

### 6.3 Persistence model

OpenPCB existing Assistant store should be extended, not replaced blindly.

Need to persist:

- chats
- messages
- provider configs
- provider models
- provider capabilities
- context bindings
- tool events/results
- assistant message source summaries/cards
- settings: default provider, default prompt preset, tool policy, context-size preference, raw debug toggle

Recommended new or extended records:

```ts
type AssistantChatRecord = {
  id: string;
  title: string;
  providerConfigId: string;
  model: string;
  promptPresetId: string;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
};

type AssistantContextBindingRecord = AiContextBinding & {
  chatId: string;
  createdAt: string;
  updatedAt: string;
};

type AssistantToolEventRecord = {
  id: string;
  chatId: string;
  taskId: string | null;
  messageId: string | null;
  toolCallId: string;
  toolName: string;
  status: AiToolStatus;
  argumentsJson: string;
  resultJson: string | null;
  errorJson: string | null;
  sourcesJson: string;
  createdAt: string;
  updatedAt: string;
};
```

V1 result card storage decision:

- Persist structured tool events/results.
- Attach compact source/tool summaries to assistant message metadata.

### 6.4 Settings

Assistant settings should include:

```ts
type AssistantSettings = {
  defaultProviderId: string;
  defaultPromptPresetId: "strict-grounded" | "friendly-tutorial" | "minimal-concise";
  toolExecutionPolicy: "auto_readonly_confirm_writes" | "confirm_all_writes" | "auto_all";
  contextSizePreference: "small" | "medium" | "large";
  allowRawToolData: boolean; // advanced debug toggle only
};
```

For v1, UI should not allow write tools even if policy has write-related names. Keep policy for future compatibility.

### 6.5 Provider settings

Provider config should support:

- kind: `openai | openai-compatible | lmstudio | omlx`
- base URL
- API key
- default model
- enabled
- builtin/provider preset flag
- cached capabilities
- cached models

Provider capabilities should store:

```ts
type ProviderCapabilities = {
  streaming: boolean;
  toolCalling: boolean;
  modelList: boolean;
  vision?: boolean;
  jsonMode?: boolean;
  maxContextTokens?: number;
  checkedAt: string;
  warning?: string;
};
```

Capability validation:

- Provider presets provide initial assumed values.
- Settings `Test` runs model list and optional completion.
- Add tiny tool-call probe if provider claims tool support.
- If first real message fails due to tool support, downgrade chat to chat-only and show warning.

### 6.6 OpenPCB prompt presets

Default: Strict Grounded

```txt
You are OpenPCB Assistant, a read-only PCB design copilot. For project, library, schematic, PCB, net, part, or component facts, use available tools before answering. Cite tool-backed sources, ask clarification when context is ambiguous, and clearly mark uncertainty. Do not claim that you changed the design.
```

Friendly Tutorial

```txt
You are OpenPCB Assistant, a patient PCB design tutor. Explain concepts clearly, use simple steps, and help the user learn while still grounding project-specific claims in tools. Ask clarifying questions when needed and point out risks without overwhelming the user.
```

Minimal Concise

```txt
You are OpenPCB Assistant, a concise PCB engineering assistant. Answer briefly, prioritize actionable facts, use tools for grounded project/library claims, cite sources, and avoid unnecessary explanation.
```

Additional tool instruction block for all presets:

```txt
Tool rules:
- Use tools for OpenPCB project/library facts.
- Prefer compact targeted tools before broad summaries.
- If a tool result is truncated, say so.
- Use only read-only tools in this version.
- If a requested design/part/component is ambiguous, ask for clarification.
- If no local library component matches, say no installed component matches and optionally suggest generic unavailable parts/import guidance.
```

### 6.7 Context behavior

OpenPCB v1 rules implemented in adapter, not core:

- Chat may have many `AiContextBinding` records structurally, but UI/logic allows max one active primary `design` binding.
- Natural design lookup happens before design-specific tools when no bound design exists.
- First resolved design creates active primary binding.
- Ambiguous design lookup returns clarification with candidate designs.
- Asking about a different design while one is bound returns guidance to start new chat.
- Deleted/missing design marks binding missing, unbinds active context, and asks user to choose another design.

### 6.8 Tool names

Use provider-safe underscore names:

- `library_search_components`
- `library_get_component_detail`
- `designer_resolve_design`
- `designer_get_design_summary`
- `designer_get_part_detail`

Do not use dots in tool names.

---

## 7. OpenPCB v1 tool specifications

All tools are read-only in v1.

All tools return `AiToolResult<T>`.

All tools must:

- Use compact summaries by default.
- Respect `AiToolLimits`.
- Populate `sources`.
- Set `truncated` when output is capped.
- Never return binary/GLB/STEP/raw model blobs.
- Return raw data only if `allowRawToolData` is true and requested through debug path.

### 7.1 `library_search_components`

Purpose: find installed library components matching natural-language requirements.

Input:

```ts
type LibrarySearchComponentsInput = {
  query: string;
  requirements?: {
    function?: string;
    voltage?: string;
    current?: string;
    package?: string;
    mountType?: string;
    value?: string;
    tolerance?: string;
    tags?: string[];
  };
  limit?: number;
};
```

Output:

```ts
type LibrarySearchComponentsOutput = {
  rewrittenQuery: string;
  normalizedRequirements: Record<string, string | string[]>;
  results: Array<{
    componentId: string;
    name: string;
    description: string;
    tags: string[];
    isBuiltin: boolean;
    score: number;
    reasons: string[];
    detailAvailable: boolean;
  }>;
  noLocalMatch: boolean;
  genericSuggestions: Array<{
    label: string;
    reason: string;
    availability: "not-installed";
  }>;
  importGuidance: string | null;
};
```

Behavior:

1. LLM may call the tool with raw query and optional parsed requirements.
2. Backend normalizes common electronics requirements:
   - voltage/current strings
   - package names
   - passive values
   - regulator/capacitor/resistor keywords
   - tags
3. Search local Library SDK.
4. Rank by requirement fit using heuristics over name/description/tags/details.
5. If no match, return empty results plus generic suggestions/import guidance.

V1 actual results must be installed local components only.

### 7.2 `library_get_component_detail`

Purpose: compact full detail for one installed library component.

Input:

```ts
type LibraryGetComponentDetailInput = {
  componentId: string;
  includeRaw?: boolean; // honored only with advanced debug toggle
};
```

Output:

```ts
type LibraryGetComponentDetailOutput = {
  component: {
    id: string;
    name: string;
    description: string;
    tags: string[];
    isBuiltin: boolean;
  };
  symbol: {
    id: string;
    name: string;
    referencePrefix: string | null;
    pinCount: number;
    keyPins: Array<{ number: string | null; name: string; electricalType: string }>;
    warnings: string[];
  };
  footprint: {
    id: string;
    name: string;
    mountType: string | null;
    padCount: number;
    packageCode: { imperial: string | null; metric: string | null };
    warnings: string[];
    model3dStatus?: string | null;
  };
  footprintVariants: Array<{
    footprintId: string;
    variantLabel: string;
    isDefault: boolean;
    mountType: string | null;
    padCount: number;
    packageCode: { imperial: string | null; metric: string | null };
  }>;
  provenance: {
    sourceKind: string | null;
    sourceFormat: string | null;
    fileName: string | null;
    importedAt: string | null;
    sourceHash: string | null;
  } | null;
  raw?: unknown;
};
```

Use `LibrarySDK.getComponentDetail` and `resolveComponentForPlacement` where useful. Keep output compact.

### 7.3 `designer_resolve_design`

Purpose: natural lookup for design names and chat binding.

Input:

```ts
type DesignerResolveDesignInput = {
  query: string;
  allowAlreadyBound?: boolean;
};
```

Output:

```ts
type DesignerResolveDesignOutput = {
  status: "resolved" | "ambiguous" | "not-found" | "already-bound-to-other-design";
  resolvedDesign?: {
    id: string;
    name: string;
    revision: number;
    updatedAt: string;
  };
  candidates: Array<{
    id: string;
    name: string;
    revision: number;
    updatedAt: string;
    reason: string;
  }>;
  message: string;
};
```

Behavior:

- Search `DesignerSDK.listDesigns()`.
- Exact/fuzzy name matching.
- If one clear match and chat has no primary design, bind it.
- If multiple matches, ask clarification.
- If chat already bound to another design, return `already-bound-to-other-design` and tell user to start new chat.

### 7.4 `designer_get_design_summary`

Purpose: compact all-in-one overview for a design.

Input:

```ts
type DesignerGetDesignSummaryInput = {
  designId?: string; // optional if chat has primary design binding
};
```

Output:

```ts
type DesignerGetDesignSummaryOutput = {
  design: { id: string; name: string; revision: number; updatedAt: string };
  schematic: {
    partCount: number;
    wireCount: number;
    labelCount: number;
    primitiveCount: number;
    junctionCount: number;
    netCount: number;
    parts: Array<{ id: string; reference: string; value: string; componentId: string }>;
    nets: Array<{ id: string; name: string; pinCount: number; labelCount: number }>;
  };
  pcb: {
    available: boolean;
    board?: {
      outline: string;
      fabricator: string;
      layerCount: number;
      activeLayer: string;
    };
    placementCount: number;
    traceCount: number;
    viaCount: number;
    freePadCount: number;
    freeHoleCount: number;
    ratsnestCount: number;
    warnings: string[];
  };
  erc?: {
    errors: number;
    warnings: number;
    infos: number;
    topViolations: Array<{ code: string; severity: string; message: string }>;
  };
};
```

Data sources:

- `DesignerSDK.listDesigns()`/`getDesign()` for head.
- `getSchematicProjection()`.
- `getPcbProjection()`.
- `runErc()`.

### 7.5 `designer_get_part_detail`

Purpose: explain one placed schematic part/reference and its PCB placement if any.

Input:

```ts
type DesignerGetPartDetailInput = {
  designId?: string;
  referenceOrPartId: string; // e.g. U1, R3, C5, or internal id
};
```

Output:

```ts
type DesignerGetPartDetailOutput = {
  status: "resolved" | "ambiguous" | "not-found";
  candidates?: Array<{ id: string; reference: string; value: string; componentId: string }>;
  part?: {
    id: string;
    reference: string;
    value: string;
    componentId: string;
    positionNm: { x: number; y: number };
    rotationDeg: number;
    mirrored: boolean;
    pins: Array<{
      id: string;
      number: string | null;
      name: string;
      electricalType: string;
      netId: string | null;
      netName: string | null;
    }>;
    footprint: {
      footprintId: string;
      name: string;
      mountType: string | null;
    };
    pcbPlacement?: {
      placementId: string;
      positionMm: { x: number; y: number };
      rotationDeg: number;
      layer: string;
      mirrored: boolean;
    };
  };
};
```

Behavior:

- Resolve reference first within bound design.
- Ask on ambiguity.
- Include connected net names by mapping schematic projection nets to pin IDs.
- Include PCB placement by matching part ID/reference/component where available.

---

## 8. OpenPCB frontend UX spec

### 8.1 Assistant onboarding

If no working provider:

- Show setup screen before first chat.
- Offer local quickstart sections for LM Studio and oMLX.
- Offer OpenAI/custom OpenAI-compatible setup.
- Show example prompts but disable send until provider works or explicitly allow chat-only if configured.

### 8.2 Header controls

- Provider selector.
- Model selector/input.
- Prompt preset selector.
- Provider capability badge:
  - green: streaming + tools available.
  - yellow: chat-only/no tools.
  - red: unavailable/misconfigured.

No manual design selector in v1. Design binding happens through natural lookup. Later Designer sidebar can attach context directly.

### 8.3 Messages

- Render normal assistant prose.
- Render structured tool cards from persisted events/metadata.
- Render inline source chips under assistant answer.
- Source chip click opens expandable card with source kind/label/excerpt/metadata.
- If provider is chat-only, show warning near composer: `This provider is running without grounded OpenPCB tools.`

### 8.4 Component search result cards

For `library_search_components`, show hybrid prose + cards:

- Name.
- Description.
- Tags.
- Score/reasons.
- `View details` action or deep link to library component detail.
- If no local match: show generic suggestions clearly marked `Not installed` and text guidance to import/create in Library.

### 8.5 Tool cards

Tool card states:

- requested
- running
- succeeded
- failed
- rejected

Cards show:

- tool name
- compact args summary
- status
- compact result summary
- source count
- warnings/truncation indicator

---

## 9. Cloud future reuse plan

Do not implement Cloud changes in OpenPCB AI v1 unless explicitly requested. Design shared core so this is straightforward later.

Cloud later should:

- Add dependency on `@openpcb/ai-core`.
- Keep Hono route handlers in `Cloud/src/modules/ai/routes/*`.
- Keep auth/Pro tier/quota in Cloud.
- Keep embeddings and pgvector/Postgres RPC in Cloud.
- Use shared source/result/prompt/provider types.
- Optionally wrap Vercel AI SDK as an `AiProviderClient`, or use shared OpenAI-compatible client where suitable.
- Map existing component search to shared pipeline interfaces.

Cloud component search split:

- Shared: query rewrite/rerank interface shapes, source/result envelopes.
- Cloud: embedding model, `match_components`, quota, auth, streaming HTTP response.

---

## 10. Implementation phases

### Phase 0 — preflight and branch hygiene

1. Check git status in `OpenPCB/`, `shared/`, and optionally `Cloud/`.
2. Do not commit unless asked.
3. Start with shared package tests, then OpenPCB integration.
4. If editing shared and OpenPCB together, use local link workflow.

### Phase 1 — create `@openpcb/ai-core`

In `shared/`:

1. Add `packages/ai-core` package.
2. Add types/modules:
   - providers
   - tools
   - context bindings
   - sources
   - prompts
   - run events
   - output caps
   - search pipeline interfaces
3. Implement OpenAI-compatible fetch client.
4. Implement SSE parser.
5. Implement tool registry.
6. Implement prompt composer.
7. Implement output cap helper.
8. Add Bun tests:
   - provider preset normalization
   - SSE parser
   - tool registry duplicate/name validation
   - prompt composition
   - output cap resolver
   - tool result/source serialization
9. Run:
   - `cd shared && npm run build`
   - `cd shared && npm run typecheck`
   - `cd shared && npm test`

### Phase 2 — update `@openpcb/contracts`

In `shared/packages/contracts`:

1. Extend Assistant contracts:
   - provider kind includes `lmstudio`, `omlx`.
   - settings include prompt preset/context size/raw debug.
   - provider capabilities/model metadata.
   - context binding DTOs.
   - tool event/source DTOs.
2. Prefer importing/re-exporting from `@openpcb/ai-core` if dependency direction is clean.
3. Update package dependency to `@openpcb/ai-core` if needed.
4. Add/adjust tests if contracts package has test coverage.
5. Build shared again.

### Phase 3 — wire OpenPCB dependency

In `OpenPCB/`:

1. Add dependency:
   - local linked during development, eventual GitHub tag `@openpcb/ai-core`.
2. Ensure shared link includes new package. Update scripts if needed.
3. Update imports in Assistant module to use shared/contracts AI types.
4. Run codegen if SDK contracts changed:
   - `cd OpenPCB && npm run gen`

### Phase 4 — refactor OpenPCB Assistant backend

1. Remove product dev-only flag from manifest.
2. Add/extend migrations for:
   - prompt preset id on chats.
   - context bindings.
   - tool events/results.
   - provider capabilities.
   - settings fields.
3. Split backend services:
   - provider store/factory
   - conversation store
   - prompt service
   - run service
   - context resolver
   - tool registration
4. Replace current provider loop with `@openpcb/ai-core` OpenAI-compatible client/run primitives.
5. Preserve Tasks/SSE behavior by translating `AiRunEvent` to Tasks chunks/events.
6. Preserve existing routes where possible; add routes for:
   - prompt presets
   - tool events
   - provider capabilities
   - context bindings if needed by UI
7. Ensure provider configs support `lmstudio` and `omlx`.

### Phase 5 — implement OpenPCB tools

Register only read tools:

1. `library_search_components`
2. `library_get_component_detail`
3. `designer_resolve_design`
4. `designer_get_design_summary`
5. `designer_get_part_detail`

Implementation notes:

- Lazy-resolve SDKs at execution time.
- If SDK missing, return failed tool result with clear warning.
- Use compact response shaping utilities.
- Add source refs for every successful result.
- Add truncation/caps.
- Never return raw projection unless advanced debug toggle and hard cap.

### Phase 6 — frontend updates

1. Assistant product beta UI.
2. Provider setup/onboarding screen.
3. Local quickstart for LM Studio + oMLX.
4. Provider capability badge/warnings.
5. Prompt preset selector.
6. Tool cards.
7. Source chips + expandable cards.
8. Component result cards.
9. Chat-only warning mode.
10. Better loading/cancel behavior if feasible.

### Phase 7 — tests

Shared tests:

- `@openpcb/ai-core` pure tests.
- `@openpcb/contracts` type/build tests.

OpenPCB backend tests:

- Tool registry.
- Provider mock tool loop.
- Context binding first resolved design.
- Ambiguous design asks clarification.
- Library component search.
- Component detail.
- Design summary.
- Part detail.
- Provider capability downgrade.

OpenPCB frontend tests:

- Onboarding.
- Prompt preset selector.
- Provider warning/badge.
- Component result cards.
- Tool cards.
- Source chips.

E2E smoke:

- Configure mock OpenAI-compatible provider.
- Ask: `Find a 3.3V regulator for 500mA`.
- Verify tool call occurred.
- Verify grounded result card or no-local-match guidance.
- Verify source chips/tool cards render.

Commands:

```bash
cd shared && npm run build && npm run typecheck && npm test
cd OpenPCB && npm run typecheck
cd OpenPCB && npm run gen:check
cd OpenPCB && npm run test:backend
cd OpenPCB && npm run test:react
cd OpenPCB && npm run test:e2e
```

Use focused tests during development.

---

## 11. Acceptance criteria

V1 is complete when all are true:

### Shared core

- `@openpcb/ai-core` exists and builds.
- It has no React/DOM/Hono/DB/provider-SDK dependencies.
- It exports provider, tool, context, source, prompt, run-event, output-limit, and search pipeline primitives.
- OpenAI-compatible client can stream text and normalize tool calls against a mock provider.
- Tool registry validates names and rejects duplicates.
- Tests pass.

### Contracts

- Assistant contract types include provider kinds `lmstudio` and `omlx`.
- Assistant settings include prompt preset, context size, and raw debug toggle.
- Context binding/tool event/source types are available to OpenPCB frontend/backend through contracts/shared types.

### OpenPCB backend

- Assistant is product beta, not dev-only.
- Provider settings support OpenAI, OpenAI-compatible, LM Studio, and oMLX.
- Provider capability checks support model list, completion, and tool-call probe where possible.
- Chat-only providers are allowed but clearly marked.
- First resolved design binds chat via future-proof context binding storage.
- Asking about another design in a bound chat asks user to start a new chat.
- Deleted/missing bound design unbinds and asks clarification.
- Required five tools work and return `AiToolResult` with source refs and caps.
- No v1 tool mutates design/library data.
- Tool events/results persist.

### OpenPCB frontend

- User sees provider setup screen if provider missing.
- User can configure/use LM Studio or oMLX as first-class provider kind.
- User can choose prompt preset.
- User sees provider capability badge.
- User sees chat-only warning when tools unavailable.
- User sees component search result cards.
- User sees tool cards.
- User sees inline source chips expandable into cards.

### Demo flows

1. User asks: `Find a 3.3V regulator for 500mA`.
   - Assistant auto-calls `library_search_components`.
   - If local matches exist, it returns component cards with reasons/sources.
   - If not, it says no installed component matches and gives generic suggestions/import guidance.
2. User asks about a design by name.
   - Assistant resolves or asks clarification.
   - First resolved design binds the chat.
3. User asks: `Summarize this design`.
   - Assistant calls `designer_get_design_summary`.
   - Answer cites design/schematic/PCB sources.
4. User asks: `Explain U1`.
   - Assistant calls `designer_get_part_detail`.
   - Ambiguity asks clarification.

---

## 12. Important implementation constraints

- Keep v1 read-only.
- Do not add write tools yet.
- Do not add files/RAG yet.
- Do not add Designer sidebar yet.
- Do not expose raw projections by default.
- Do not include binary model data in AI tool results.
- Do not import OpenPCB app internals into shared packages.
- Do not import Cloud internals into shared packages.
- Keep shared package pure and deterministic.
- Keep OpenPCB module code importing from `core/contracts/*`, `sdks/*`, `shared/*`, and shared npm packages, not core internals.

---

## 13. Known risks and mitigation

### Provider tool-call incompatibility

Risk: local OpenAI-compatible providers may not support tool calls consistently.

Mitigation:

- Capability probe.
- First-message fallback.
- Chat-only warning.
- No hard failure for chat-only usage.

### Token bloat from design projections

Risk: schematic/PCB projections can become huge.

Mitigation:

- Compact summary tools.
- Adaptive caps.
- Raw debug only.
- Truncation warnings.

### Shared package dependency direction

Risk: contracts/core circular dependencies.

Mitigation:

- `ai-core` should not depend on `contracts`.
- `contracts` may depend on/re-export `ai-core`, or duplicate minimal wire types.

### Assistant service complexity

Risk: one massive service file becomes hard to evolve.

Mitigation:

- Split provider/conversation/prompt/run/context/tool services.

### V1 decisions becoming permanent

Risk: one-design-per-chat/local-only assumptions leak into schema.

Mitigation:

- Store generic `AiContextBinding[]`.
- Treat v1 constraints as adapter/UI rules only.

---

## 14. Future roadmap after v1

Likely sequence:

1. In-Designer sidebar using same backend/core.
2. Selection-aware context binding.
3. Net detail and PCB routing/ratsnest tools.
4. ERC/DRC design review workflow.
5. Datasheet/file attachment RAG.
6. Cloud/supplier component search.
7. Persistent project/user memory.
8. Preview-only write tools with command diff.
9. Approved write tools with undo/redo.
10. Simulation/code execution sandbox.
11. Auto-layout/autorouting last.

---

## 15. Final unresolved items

These should be resolved during implementation:

1. Exact oMLX default base URL/model docs. oMLX is OpenAI-compatible, but avoid hardcoding unverified defaults.
2. Whether `@openpcb/contracts` imports/re-exports `@openpcb/ai-core` types or duplicates minimal DTOs.
3. Exact DB migration names and backward compatibility for existing Assistant data.
4. Exact mock OpenAI-compatible server implementation for tests.
5. Whether to release/tag shared packages immediately or rely on local link until feature stabilizes.
