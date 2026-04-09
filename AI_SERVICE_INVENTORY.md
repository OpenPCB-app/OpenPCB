# AI Chat Backend Files Inventory
## Thorough Read-Only Exploration Report

### Project Structure Overview
- **src-ts/src**: TypeScript backend codebase (316 TS files)
- **modules/ai-service**: Existing module (minimal: manifest, module.ts, React components)
- **src-ts/src/kernel**: Task system (runtime-critical, shared)
- **src-ts/src/domain/services**: Business logic layer
- **src-ts/src/db**: Persistence layer (schema + repositories)
- **src-ts/src/infrastructure**: Infrastructure integrations
- **src-ts/src/transport**: HTTP routing & controllers

---

## 1. GROUPED FILE INVENTORY

### A. Chat/Message Core (Conversation Management)
**Location**: `src-ts/src/domain/services/` + `src-ts/src/db/`

#### Service Layer
- `/src-ts/src/domain/services/chat-service.ts` (323L)
  - Interface: IChatService
  - Methods: list, get, getWithMessages, create, update, delete, bulkDelete
  - Returns ChatMetadata (lightweight) or ChatRecord (with messages)
  
- `/src-ts/src/domain/services/chat-manager.ts` (700+L)
  - Singleton service for message persistence & chat context
  - Core method: getWithMessages(chatId) → loads full conversation
  - Used by TaskOrchestrator for context injection

- `/src-ts/src/domain/services/message-service.ts` (438L)
  - Interface: IMessageService
  - Methods: createMessage, editMessage, resendMessage, regenerateMessage, searchMessages
  - **CRITICAL**: Coordinates ChatManager + TaskOrchestrator
  - Creates MessageTask when message sent
  - Singleton pattern (unlike other services)

- `/src-ts/src/domain/services/chat-task-lock.ts`
  - Prevents race conditions on chat task creation
  - Per-chat locking mechanism

#### Persistence Layer
- `/src-ts/src/db/schema/chat.ts` (88L)
  - Table: chats
  - Fields: id, workspaceId, title, folderId, projectId, category, contextType, contextId, metadata
  
- `/src-ts/src/db/schema/message.ts` (149L)
  - Table: messages
  - Complex structure: role, content (TIPTAP/HTML/Markdown), metadata, branchIndex, parentId
  - ContentPart union: text, image, document, tool_result, code
  
- `/src-ts/src/db/repositories/chat.ts` (221L)
  - Methods: findByWorkspace, findById, create, update, delete, bulkDelete
  - Supports: folder/project/category/context filtering
  
- `/src-ts/src/db/repositories/message.ts` (400+L)
  - Methods: findByChat, findActivePath, create, update, search, getMessageBranch
  - Handles message branching (conversation trees)

#### Mappers
- `/src-ts/src/domain/mappers/chat-mapper.ts`
  - Transforms: DB Chat ↔ ChatMetadata/ChatRecord

#### Test Files
- `/src-ts/src/domain/services/chat-service.tool-events.test.ts`
- `/src-ts/src/domain/services/message-service.test.ts`

---

### B. Streaming & Task Execution
**Location**: `src-ts/src/domain/services/` + `src-ts/src/domain/services/queue/`

#### Streaming Service
- `/src-ts/src/domain/services/stream-service.ts` (1309L)
  - Interface: IStreamService
  - Methods: createChatStream, abortStream, replayProgress, getActiveChatTask
  - **KEY**: Creates ReadableStream from TaskExecutor events
  - Event bridge: ExecutionEvent → SSE event
  - Supports replay modes: 'full' (all history) | 'final' (completion only)

#### Task Orchestration (Runtime Core)
- `/src-ts/src/domain/services/queue/task-orchestrator.ts` (687L)
  - **ORCHESTRATOR**: Wires TaskSystem + ChatManager + QueueManager + TaskExecutor
  - Coordinates full task lifecycle
  - Event handlers → task state transitions
  - Creates followup MessageTasks (tool results)
  - **STAYS IN CORE**: Runtime is shared, not AI-specific

- `/src-ts/src/domain/services/queue/task-executor.ts` (1200+L)
  - Executes tasks against AI providers
  - Handles streaming, tool calls, retries
  - Emits ExecutionEvent (progress/data/error/complete)
  - Tool dispatch → ToolDispatcher
  - **STAYS IN CORE**: Provider-agnostic execution engine

- `/src-ts/src/domain/services/queue/task-queue-manager.ts` (300+L)
  - Per-provider queuing
  - Deduplicates model loads
  - **STAYS IN CORE**: Queue management independent of AI

- `/src-ts/src/domain/services/queue/chunk-buffer.ts`
  - Time-based message chunk batching before DB persistence

- `/src-ts/src/domain/services/queue/assistant-message-persistence.ts`
  - Batch-persists assistant message chunks to DB

- `/src-ts/src/domain/services/queue/task-load-dependency-coordinator.ts`
  - Coordinates LoadTask → MessageTask dependency flow

- `/src-ts/src/domain/services/queue/task-startup-recovery.ts`
  - Recovers incomplete tasks on server startup

#### Task System Core
- `/src-ts/src/domain/services/task-system.ts` (713L)
  - Interface: ITaskSystem
  - State machine: pending → queued → running → streaming → completed
  - Methods: createMessageTask, createLoadTask, startTask, pauseTask, completeTask
  - **STAYS IN CORE**: Runtime orchestrator, not AI-specific

#### Tests
- `/src-ts/src/domain/services/stream-service.*.test.ts` (chain, license, reasoning, replay)
- `/src-ts/src/domain/services/queue/task-orchestrator.test.ts`
- `/src-ts/src/domain/services/task-system.test.ts`

---

### C. AI Providers & Model Management
**Location**: `src-ts/src/infrastructure/ai-providers/`

#### Provider Configuration & Registry
- `/src-ts/src/infrastructure/ai-providers/registry.ts`
  - Global provider registry
  - Health checks, status caching
  - Model listing

- `/src-ts/src/infrastructure/ai-providers/api-key-store.ts`
  - Runtime + DB persistence of API keys
  - Hydrates registry from stored keys

- `/src-ts/src/infrastructure/ai-providers/config.ts`
  - Provider definitions (OpenAI, Anthropic, etc.)

- `/src-ts/src/infrastructure/ai-providers/engine.ts`
  - Base Engine interface
  - Load balancing, model management

#### Provider Adapters (Protocol Adapters)
- `/src-ts/src/infrastructure/ai-providers/adapters/base-adapter.ts`
  - Abstract adapter pattern

- `/src-ts/src/infrastructure/ai-providers/adapters/openai-adapter.ts`
  - OpenAI chat completions → internal format

- `/src-ts/src/infrastructure/ai-providers/adapters/anthropic-adapter.ts`
  - Anthropic API → internal format

- `/src-ts/src/infrastructure/ai-providers/adapters/ollama-adapter.ts`
  - Ollama local models → internal format
  - Tests: ollama-adapter.test.ts

#### Provider Engines
- `/src-ts/src/infrastructure/ai-providers/engines/openai.ts`
- `/src-ts/src/infrastructure/ai-providers/engines/anthropic.ts`
- `/src-ts/src/infrastructure/ai-providers/engines/ollama.ts`
- `/src-ts/src/infrastructure/ai-providers/engines/openrouter.ts`
- `/src-ts/src/infrastructure/ai-providers/engines/github-copilot.ts`
- `/src-ts/src/infrastructure/ai-providers/engines/local.ts`
- `/src-ts/src/infrastructure/ai-providers/engines/mock-openai.ts`
- `/src-ts/src/infrastructure/ai-providers/engines/mod.ts` (aggregator)

#### Tests
- `engines/ollama.test.ts`
- `engines/provider-tool-message-conversion.test.ts`
- `adapters/openai-adapter.test.ts`
- `adapters/ollama-adapter.test.ts`

---

### D. Provider Business Logic
**Location**: `src-ts/src/domain/services/`

- `/src-ts/src/domain/services/provider-service.ts` (217L)
  - Interface: IProviderService
  - Methods: listProviders, getProvider, checkHealth, getLoadedModels, setApiKey, removeApiKey
  - Uses: ProviderRegistry + ProviderApiKeyStore
  - **Can move**: Independent of chat/message logic

- `/src-ts/src/domain/services/provider-resolver.ts`
  - Resolves provider from workspaceId/userId
  - User preferences → provider selection

---

### E. Tool System (AI Tool Execution)
**Location**: `src-ts/src/domain/services/tools/`

#### Tool Registry & Dispatch
- `/src-ts/src/domain/services/tools/tool-registry.ts`
  - Central tool catalog
  - Registers: MCP tools, built-in tools, module tools
  - Lookup by name

- `/src-ts/src/domain/services/tools/tool-dispatcher.ts` (416L)
  - Executes tool calls
  - Schema validation, context injection
  - Integrates with ToolRegistry
  - **CRITICAL COUPLING**: Used by TaskExecutor during tool loop

- `/src-ts/src/domain/services/tools/tool-catalog.ts`
  - Tool definitions aggregator

- `/src-ts/src/domain/services/tools/tool-guards.ts`
  - Authorization checks for tools

#### Built-in Tools (Core Tools)
- `/src-ts/src/domain/services/tools/core/`
  - `list-chats.ts`: Lists user chats (tool for context)
  - `get-context.ts`: Retrieves context (content, projects)
  - `projects.ts`: Project metadata
  - `list-files.ts`: File listing
  - `bookmarks-favorites.ts`: Bookmark/favorite access
  - `search.ts`: Full-text search
  - `shared/`: pagination, field-selection utilities

#### Custom Edit Tools
- `/src-ts/src/domain/services/tools/edit-content-tool.ts` (200+L)
  - AI-powered content editing
  - Uses ContentEditorService

- `/src-ts/src/domain/services/tools/format-content-tool.ts`
  - Content formatting via AI

- `/src-ts/src/domain/services/tools/create-page-tool.test.ts`

- `/src-ts/src/domain/services/tools/knowledge-create-page-tool.ts`

#### Tests
- `tools/core/__tests__/`: registration, list-chats, shared, pagination, smoke tests
- `tools/*.test.ts`: tool-specific tests

---

### F. Transport Layer (HTTP Routes)
**Location**: `src-ts/src/transport/`

#### Controllers (Thin HTTP Handlers)
- `/src-ts/src/transport/controllers/chat-controller.ts` (249L)
  - Routes: GET /api/chats, POST /api/chats/:id/messages, POST /api/chats/:id/fork
  - Delegates to: ChatService, MessageService

- `/src-ts/src/transport/controllers/message-action-controller.ts` (200+L)
  - Routes: POST edit/resend/regenerate message
  - Delegates to: MessageService

- `/src-ts/src/transport/controllers/stream-controller.ts` (103L)
  - Routes: POST /api/stream/chat, /stream/abort/:taskId, /stream/replay/:taskId
  - Delegates to: StreamService

- `/src-ts/src/transport/controllers/provider-controller.ts` (93L)
  - Routes: GET /api/providers, /providers/:id/health, /providers/:id/api-key
  - Delegates to: ProviderService

- `/src-ts/src/transport/controllers/task-controller.ts`
  - Routes: GET /api/tasks, task status/cancellation

#### Router & HTTP Infrastructure
- `/src-ts/src/transport/router/core-router.ts` (2561L)
  - Main HTTP router with OpenAPI metadata
  - Resolves all controllers from DI
  - Registers all routes

- `/src-ts/src/transport/router/BaseHttpRouter.ts`
  - Base routing class

- `/src-ts/src/transport/router/route-parser.ts`

- `/src-ts/src/transport/http/ModuleRouter.ts`
  - Module endpoint routing

- `/src-ts/src/transport/http/helpers.ts`
  - CORS headers, trusted origins

- `/src-ts/src/transport/middleware/error-handler.ts`

#### WebSocket
- `/src-ts/src/transport/ws/WsManager.ts`
- `/src-ts/src/transport/ws/WsRouter.ts`

#### Tests
- `controllers/stream-controller.test.ts`
- `controllers/message-action-controller.test.ts`

---

### G. Shared Types & Schemas
**Location**: `src-ts/src/core/schemas/` + `src-ts/src/types/`

#### OpenAPI/Validation Schemas
- `/src-ts/src/core/schemas/chat.schema.ts`
  - ChatMetadataSchema, ChatListResponseSchema, ChatResponseSchema
  - CreateChatInputSchema, UpdateChatInputSchema

- `/src-ts/src/core/schemas/stream.schema.ts`
  - StreamChatRequestSchema, StreamStartResponseSchema

- `/src-ts/src/core/schemas/provider.schema.ts`
  - ProviderInfoSchema, ProviderResponseSchema

- `/src-ts/src/core/schemas/task.schema.ts`
  - TaskMetaSchema, TaskResponseSchema

- `/src-ts/src/core/schemas/responses.ts`
  - DeletedResponseSchema, common patterns

- `/src-ts/src/core/schemas/index.ts`
  - Schema aggregator

- `/src-ts/src/core/schemas/base.ts`
- `/src-ts/src/core/schemas/common.ts`

#### Type Definitions
- `/src-ts/src/types/bun-globals.d.ts`
- `/src-ts/src/types/bun-sqlite.d.ts`

#### Shared Validation
- `/src-ts/src/shared/validation/ajv-validator.ts`

---

### H. Database Layer
**Location**: `src-ts/src/db/`

#### Schemas (Drizzle ORM)
- `schema/chat.ts` (88L)
- `schema/message.ts` (149L)
- `schema/provider.ts` (43L)
- `schema/provider-api-key.ts` (17L)
- `schema/provider-oauth.ts` (21L)
- `schema/task.ts` (368L) - Complex task state schema
- `schema/task-tool-event.ts` (47L)
- `schema/index.ts` (66L) - Schema aggregator
- Other: file, project, usage, workspace schemas

#### Repositories
- `repositories/chat.ts` (221L)
- `repositories/message.ts` (400+L)
- `repositories/provider.ts`
- `repositories/provider-api-key.ts`
- `repositories/task.ts`
- `repositories/task-tool-event.ts`
- `repositories/task-chunk.ts`
- Other: file, workspace, project repos

#### Core DB
- `index.ts` - DatabaseAccess interface
- `schema/base.ts` - UUID generation
- `migrate.ts` - Migration runner
- `query-logger.ts` - Query profiling

---

### I. Dependency Injection & Configuration
**Location**: `src-ts/src/core/di/`

- `/src-ts/src/core/di/container.ts` (137L)
  - Simple DI container with singleton/transient scopes
  - Service tokens (symbols) for type safety

- `/src-ts/src/core/di/setup.ts` (372L)
  - DI setup function
  - Registers all services: ChatService, MessageService, StreamService, ProviderService
  - Registers controllers: ChatController, StreamController, ProviderController
  - Configures singleton vs transient scopes

---

### J. Kernel (Runtime Task System - SHARED)
**Location**: `src-ts/src/kernel/`

- `/src-ts/src/kernel/init.ts`
  - Kernel initialization entrypoint

- `/src-ts/src/kernel/tasks/types.ts` (100L)
  - TaskStatus enum (pending, queued, running, streaming, completed, failed)
  - TaskType enum (message, load, embedding, content_edit)
  - Task interface (generic)
  - TaskEvent interface

- `/src-ts/src/kernel/tasks/instance.ts`
  - TaskManager singleton instance

- `/src-ts/src/kernel/tasks/manager.ts`
  - TaskManager interface & implementation

- `/src-ts/src/kernel/tasks/store.ts`
  - In-memory task state store

- `/src-ts/src/kernel/providers/types.ts`
  - Provider runtime types

- `/src-ts/src/kernel/providers/registry.ts`
- `/src-ts/src/kernel/providers/resolver.ts`

---

### K. Content Editing Service (AI-Powered Content Editing)
**Location**: `src-ts/src/domain/services/content-editor/`

- `/src-ts/src/domain/services/content-editor/content-editor-service.ts` (400+L)
  - AI-driven content editing system
  - Works with TaskOrchestrator (creates ContentEditTask)
  - Snapshot/rollback support

- `/src-ts/src/domain/services/content-editor/content-target.interface.ts`
- `/src-ts/src/domain/services/content-editor/content-target-registry.ts`
- `/src-ts/src/domain/services/content-editor/prompt-builder.ts`
- `/src-ts/src/domain/services/content-editor/output-parser.ts`
- `/src-ts/src/domain/services/content-editor/format-operations.ts`

---

### L. MCP (Model Context Protocol) Integration
**Location**: `src-ts/src/domain/services/` + `src-ts/src/infrastructure/mcp/`

- `/src-ts/src/domain/services/mcp-service.ts` (500+L)
  - MCP server management & tool bridging
  - Registry of MCP servers
  - Tool dispatch via MCP

- `/src-ts/src/domain/services/mcp/mcp-contracts.ts`
- `/src-ts/src/domain/services/mcp/mcp-tool-identity-policy.ts`
- `/src-ts/src/domain/services/mcp/mcp-tool-registry-bridge.ts`

- `/src-ts/src/infrastructure/mcp/`
  - MCP protocol implementation

---

### M. Mentions & Conversation Context
**Location**: `src-ts/src/domain/services/`

- `/src-ts/src/domain/services/mention-registry.ts`
  - Mention markers & resolution

- `/src-ts/src/domain/services/mention-content-resolver.ts`
  - Resolves mention content (chats, files, projects)

---

### N. Utilities & Supporting Services
**Location**: `src-ts/src/domain/services/` + `src-ts/src/domain/utils/`

#### Services
- `/src-ts/src/domain/services/usage-service.ts`
  - Usage tracking for providers
  
- `/src-ts/src/domain/services/task-manager.ts`
  - TaskManager wrapper

- `/src-ts/src/domain/services/task-service.ts`
  - Task query/status service

- `/src-ts/src/domain/services/license-util.ts`
  - License enforcement (payment gates)

#### Utilities
- `/src-ts/src/domain/utils/html-to-tiptap.ts`
- `/src-ts/src/domain/utils/markdown-to-tiptap.ts`
- `/src-ts/src/domain/utils/tiptap-to-html.ts`
- `/src-ts/src/domain/utils/tiptap-to-markdown.ts`
- `/src-ts/src/domain/utils/mention-parser.ts`

---

### O. Module System
**Location**: `src-ts/src/modules/`

- `/src-ts/src/modules/ModuleLoader.ts`
  - Dynamic module loading
- `/src-ts/src/modules/ModuleContext.ts`
- `/src-ts/src/modules/Logger.ts`
- `/src-ts/src/modules/EventBus.ts`

---

## 2. OWNERSHIP MAP

### Core Runtime (MUST STAY)
These define the execution model - shared by all domains:
- **kernel/tasks/types.ts** - Task lifecycle types
- **kernel/tasks/manager.ts** - Task management
- **kernel/tasks/store.ts** - Task state
- **domain/services/task-system.ts** - State machine
- **domain/services/queue/task-orchestrator.ts** - Task execution orchestration
- **domain/services/queue/task-executor.ts** - Provider execution engine
- **domain/services/queue/task-queue-manager.ts** - Queue management
- **domain/services/task-manager.ts** - TaskManager service wrapper

### AI Chat Cluster (MOVE TO ai-service MODULE)
Directly implements chat/streaming/provider workflow:
- **Chat Management**: chat-service.ts, chat-manager.ts, message-service.ts, chat-task-lock.ts
- **Streaming**: stream-service.ts
- **Provider Ops**: provider-service.ts, provider-resolver.ts
- **Tools**: tool-registry.ts, tool-dispatcher.ts, tool-catalog.ts, tools/* (core + custom)
- **Message Content Editing**: content-editor/*
- **DB Layer (Chat/Message)**: 
  - schema/chat.ts, schema/message.ts
  - repositories/chat.ts, repositories/message.ts
- **Schemas**: core/schemas/chat.schema.ts, core/schemas/stream.schema.ts, core/schemas/provider.schema.ts
- **Transport**: controllers/chat-controller.ts, controllers/stream-controller.ts, controllers/provider-controller.ts, controllers/message-action-controller.ts
- **Tests**: All *test.ts files for above

### Shared Infrastructure (EXTRACT TO SHARED)
Used by multiple domains, runtime-agnostic:
- **AI Provider Catalog**: infrastructure/ai-providers/* (adapters, engines, registry, api-key-store, config)
- **MCP Integration**: domain/services/mcp-service.ts, domain/services/mcp/*, infrastructure/mcp/*
- **Tool Dispatch**: tools/tool-dispatcher.ts (used by TaskExecutor)
- **Queue System**: domain/services/queue/* (except assistant-message-persistence)
- **Utilities**: domain/utils/* (text format conversions)
- **Validation**: core/schemas/*, shared/validation/*

### Framework Layer (STAYS IN CORE)
Meta-infrastructure for any domain:
- **DI Container**: core/di/container.ts, core/di/setup.ts
- **HTTP Routing**: transport/router/*, transport/http/*
- **Error Handling**: core/errors/
- **Database**: db/* (migrations, query logging, base access)
- **Module System**: modules/*
- **Kernel Init**: kernel/init.ts, kernel/providers/*

---

## 3. FILES SAFE TO MOVE

### Tier 1: Direct Moves (Zero Dependencies on Non-AI Code)
```
domain/services/chat-service.ts
domain/services/chat-manager.ts
domain/services/message-service.ts
domain/services/stream-service.ts
domain/services/chat-task-lock.ts
domain/services/provider-service.ts
domain/services/provider-resolver.ts
domain/services/tools/tool-dispatcher.ts
domain/services/tools/tool-registry.ts
domain/services/tools/tool-catalog.ts
domain/services/tools/core/list-chats.ts
domain/services/tools/core/get-context.ts
domain/services/tools/core/projects.ts
domain/services/tools/core/list-files.ts
domain/services/tools/core/bookmarks-favorites.ts
domain/services/tools/core/search.ts
domain/services/tools/core/shared/*
domain/services/tools/edit-content-tool.ts
domain/services/tools/format-content-tool.ts
domain/services/tools/create-page-tool.test.ts
domain/services/tools/knowledge-create-page-tool.ts
domain/services/content-editor/*
transport/controllers/chat-controller.ts
transport/controllers/stream-controller.ts
transport/controllers/provider-controller.ts
transport/controllers/message-action-controller.ts
db/schema/chat.ts
db/schema/message.ts
db/repositories/chat.ts
db/repositories/message.ts
core/schemas/chat.schema.ts
core/schemas/stream.schema.ts
core/schemas/provider.schema.ts
(All associated test files)
```

### Tier 2: Moves with Minimal Wrapping (Small Adaptation Layer Needed)
```
infrastructure/ai-providers/* (entire directory)
  - Currently used from core/di/setup.ts
  - Needs: Export ProviderRegistry, ProviderApiKeyStore from module
  
domain/services/mcp-service.ts
  - Calls: ChatService, TaskOrchestrator
  - Needs: Inject as dependencies

domain/services/tools/tool-dispatcher.ts (already listed Tier 1)
  - Used by: TaskExecutor
  - Current: Bidirectional coupling via TaskExecutor.setFollowupTaskCreator()
  - Needs: Define module boundary for tool result → new message flow
```

---

## 4. FILES THAT MUST STAY IN CORE

### Absolutely Core (Shared Execution Model)
```
kernel/tasks/types.ts               # Task lifecycle types
kernel/tasks/manager.ts              # Task management
kernel/tasks/store.ts                # Task state tracking
kernel/tasks/instance.ts             # Singleton instance
kernel/init.ts                       # Kernel bootstrap
domain/services/task-system.ts       # State machine (non-movable)
domain/services/queue/task-orchestrator.ts  # Orchestrator (non-movable)
domain/services/queue/task-executor.ts      # Execution engine (non-movable)
domain/services/queue/task-queue-manager.ts # Queue logic (non-movable)
domain/services/queue/chunk-buffer.ts
domain/services/queue/task-load-dependency-coordinator.ts
domain/services/queue/task-startup-recovery.ts
domain/services/task-manager.ts
domain/services/task-service.ts
```

### Infrastructure Foundation
```
core/di/container.ts                # DI container
core/di/setup.ts                    # Service setup (needs updates)
core/errors/                        # Error types
core/utils/                         # Response builders, time utils
core/schemas/base.ts                # Base schema utilities
core/schemas/common.ts              # Common patterns
core/schemas/responses.ts           # Response schemas
transport/router/                   # HTTP routing (all files)
transport/middleware/               # Middleware
transport/http/                     # HTTP infrastructure
transport/ws/                       # WebSocket
db/index.ts                         # DatabaseAccess interface
db/migrate.ts                       # Migration runner
db/schema/base.ts                   # UUID generation
db/query-logger.ts                  # Query logging
kernel/providers/                   # Provider runtime types
shared/validation/                  # Schema validation
types/                              # Type definitions
modules/                            # Module system
```

### Non-Movable Service Dependencies
```
domain/services/workspace-service.ts
domain/services/project-service.ts
domain/services/design-service.ts
domain/services/folder-service.ts
domain/services/favorite-service.ts
domain/services/tag-service.ts
domain/services/bookmark-service.ts
domain/services/branch-service.ts
domain/services/usage-service.ts
domain/services/file-service.ts
domain/services/license-util.ts (used by StreamService)
domain/mappers/                     # General mappers
```

---

## 5. RISKY/AMBIGUOUS FILES

### High-Risk (Complex Dependencies, Unclear Ownership)
```
domain/services/queue/assistant-message-persistence.ts
  RISK: Persists assistant message chunks during streaming
  CONTEXT: Used by TaskExecutor (stays in core)
  DECISION: Could move, but requires careful streaming coordination
  RECOMMENDED: Keep in queue/ but export for module use

domain/services/stream-service.ts
  RISK: Bridges TaskExecutor events → SSE stream
  CONTEXT: Depends on LicenseUtil, TaskOrchestrator, TaskSystem
  DECISION: Can move to module with proper injection
  BOUNDARY: Clear interface at ReadableStream level
  RECOMMENDED: MOVE (is inherently AI-specific)

domain/services/mention-registry.ts
domain/services/mention-content-resolver.ts
  RISK: Resolves mentions (chats, files, projects) - cross-domain
  CONTEXT: Used by ChatService and message content
  DECISION: Chat-specific mention resolution should move
  BUT: Tool system also uses mentions
  RECOMMENDED: MOVE (inherently AI/chat feature)

core/di/setup.ts
  RISK: Wires entire dependency graph
  DECISION: STAYS but needs surgery
  RECOMMENDED: Extract AI service registration to separate function
```

### Medium-Risk (Manageable with Clear Boundaries)
```
domain/services/tools/core/get-context.ts
  RISK: Retrieves context (content/projects/chats) - information model
  DECISION: Chat-specific context retrieval
  RECOMMENDED: MOVE (inherently AI task context)

domain/services/mcp-service.ts
  RISK: Heavy dependencies on ChatService, TaskOrchestrator, ToolRegistry
  DECISION: Core MCP protocol vs AI-specific MCP extensions
  RECOMMENDED: Extract protocol layer → core, AI extensions → module

infrastructure/ai-providers/registry.ts
infrastructure/ai-providers/api-key-store.ts
  RISK: Global singletons, initialization order sensitive
  DECISION: Provider catalog is independent of chat
  RECOMMENDED: MOVE (independent service layer)
```

### Low-Risk (Clear Boundaries, Easy to Move)
```
domain/services/provider-service.ts
  RISK: Clean interface, minimal dependencies
  DECISION: Provider management is separate concern
  RECOMMENDED: MOVE

domain/utils/markdown-to-tiptap.ts, etc.
  RISK: Utilities with no cross-domain knowledge
  DECISION: General-purpose text converters
  RECOMMENDED: MOVE (or extract to shared)
```

---

## 6. CROSS-CUTTING CONCERNS

### 1. Task System Runtime Coupling
**Problem**: TaskExecutor creates follow-up MessageTasks → requires ChatManager context
**Current**: TaskExecutor.setFollowupTaskCreator() callback pattern
**Solution**: 
- Keep TaskExecutor in core (tool loop execution is generic)
- Module provides callback to create MessageTask
- TaskExecutor stays agnostic to chat model

### 2. License Enforcement
**Problem**: StreamService checks license before creating stream
**Current**: LicenseUtil injected into StreamService
**Solution**:
- Wrap LicenseUtil in module's StreamService
- Or: Check in controller before delegating to service

### 3. Provider Registry Initialization
**Problem**: ProviderRegistry is global singleton
**Current**: Initialized in main.ts before DI setup
**Solution**:
- Extract initialization to module setup
- Export ProviderRegistry from module factory
- Core requests from module via DI

### 4. Message Branching & Context Loading
**Problem**: ChatManager loads full conversation with branch traversal
**Current**: Tightly coupled to Message schema design
**Solution**:
- Keep ChatManager logic in module
- Exposes clean interface: getWithMessages(chatId) → ChatRecord
- Returns standard types from core schemas

### 5. Tool Dispatch in TaskExecutor
**Problem**: TaskExecutor calls ToolDispatcher during execution loop
**Current**: Direct dependency injection
**Solution**:
- ToolDispatcher stays available to module
- TaskExecutor calls it via injected interface
- Module provides tool handlers

---

## 7. IMPLEMENTATION RECOMMENDATION

### Phase 1: Preparation (No Code Changes)
1. Extract existing `modules/ai-service` structure
2. Plan directory organization within module
3. Map file destinations
4. Identify injection points in core

### Phase 2: Core Adaptation Layer
Create new exports in core for module consumption:
```typescript
// src/kernel/exports.ts
export { TaskOrchestrator, type TaskOrchestrator };
export { TaskExecutor, type ExecutionEvent };
export { TaskSystem, type MessageTaskSpec };
export { ChatManager } from domain/services;
export { ToolDispatcher } from domain/services/tools;
```

### Phase 3: Move Chat/Message Services
Move in order:
1. DB layer (schemas + repositories)
2. Service layer (ChatService, MessageService)
3. Stream service (depends on above)
4. Transport layer (controllers)

### Phase 4: Move Providers
1. Infrastructure (ai-providers/*)
2. ProviderService
3. Provider routes in core-router

### Phase 5: Integration
1. Module exports aggregate services
2. Update core DI setup to call module factory
3. Export module services back to core as needed
4. Update transport router for module routes

---

## Summary Statistics

**AI Chat Files**: ~120 files (including tests)
**Shared Infrastructure**: ~40 files (providers, MCP, tools)
**Core Runtime**: ~30 files (task system, kernel)
**Transport/DI**: ~50 files (framework layer)

**Safe to Move Immediately**: 80-90 files
**Needs Adaptation**: 30-40 files
**Must Stay in Core**: 40-50 files
