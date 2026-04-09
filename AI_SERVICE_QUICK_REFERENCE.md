# AI Service Inventory - Quick Reference Tables

## FILE MOVE DECISION MATRIX

### TIER 1: MOVE IMMEDIATELY (0 adaptation needed)
| File | Lines | Purpose | Type | Risk |
|------|-------|---------|------|------|
| chat-service.ts | 323 | Chat CRUD | Service | ✓ Safe |
| chat-manager.ts | 700+ | Message persistence & context | Service | ✓ Safe |
| message-service.ts | 438 | Message operations | Service | ✓ Safe |
| stream-service.ts | 1309 | SSE streaming bridge | Service | ✓ Safe |
| chat-task-lock.ts | ? | Race condition prevention | Utility | ✓ Safe |
| provider-service.ts | 217 | Provider management | Service | ✓ Safe |
| provider-resolver.ts | ? | Provider selection | Service | ✓ Safe |
| tool-dispatcher.ts | 416 | Tool execution | Service | ✓ Safe |
| tool-registry.ts | ? | Tool catalog | Service | ✓ Safe |
| tool-catalog.ts | ? | Tool aggregator | Utility | ✓ Safe |
| tool-guards.ts | ? | Tool authorization | Utility | ✓ Safe |
| content-editor/* | 400+ | AI content editing | Service cluster | ✓ Safe |
| chat-controller.ts | 249 | HTTP chat routes | Controller | ✓ Safe |
| stream-controller.ts | 103 | HTTP streaming routes | Controller | ✓ Safe |
| provider-controller.ts | 93 | HTTP provider routes | Controller | ✓ Safe |
| message-action-controller.ts | 200+ | HTTP message routes | Controller | ✓ Safe |
| chat.schema.ts | 88 | DB table | Schema | ✓ Safe |
| message.schema.ts | 149 | DB table | Schema | ✓ Safe |
| chat.repository.ts | 221 | DB access | Repository | ✓ Safe |
| message.repository.ts | 400+ | DB access | Repository | ✓ Safe |
| chat.schema.zod.ts | ? | OpenAPI schema | Schema | ✓ Safe |
| stream.schema.zod.ts | ? | OpenAPI schema | Schema | ✓ Safe |
| provider.schema.zod.ts | ? | OpenAPI schema | Schema | ✓ Safe |

### TIER 2: MOVE WITH WRAPPING (1-2 changes needed)
| File | Lines | Current Coupling | Adaptation Required |
|------|-------|------------------|---------------------|
| infrastructure/ai-providers/* | 600+ | Core DI setup | Export ProviderRegistry from module |
| domain/services/mcp-service.ts | 500+ | ChatService dependency | Inject ChatService interface |
| domain/services/mention-registry.ts | ? | Cross-domain mentions | Extract interface, implement in module |
| domain/services/mention-content-resolver.ts | ? | Cross-domain resolution | Implement resolver in module |
| tools/core/get-context.ts | ? | Context retrieval | Move with chat context |

### TIER 3: MUST STAY IN CORE (Runtime foundation)
| File | Lines | Reason | Impact |
|------|-------|--------|--------|
| kernel/tasks/types.ts | 100 | Shared task lifecycle enum | All domains use TaskStatus |
| kernel/tasks/manager.ts | ? | Task runtime state | Shared by all async operations |
| domain/services/task-system.ts | 713 | State machine | Core execution model |
| domain/services/queue/task-orchestrator.ts | 687 | Wires everything | Coordinates all task execution |
| domain/services/queue/task-executor.ts | 1200+ | Executes against providers | Generic execution engine |
| domain/services/queue/task-queue-manager.ts | 300+ | Per-provider queueing | Generic queuing logic |
| core/di/container.ts | 137 | DI infrastructure | Framework-level |
| core/di/setup.ts | 372 | Service wiring | Needs surgical updates |
| transport/router/core-router.ts | 2561 | HTTP routing | Framework-level |

---

## DEPENDENCY GRAPH (Move Order)

```
Layer 1 (Foundation - No Dependencies)
├── DB Schemas: chat.ts, message.ts, provider.ts
├── DB Repositories: chat.ts, message.ts
└── Schemas: chat.schema.ts, stream.schema.ts, provider.schema.ts

Layer 2 (Business Logic - Depends on Layer 1)
├── ChatService (uses: Chat schema + repo)
├── MessageService (uses: Message schema + repo, ChatService)
├── ProviderService (uses: Provider schema + repo)
└── Tools: tool-registry.ts, tool-dispatcher.ts, tool-catalog.ts

Layer 3 (Higher-Order Services - Depends on Layer 2)
├── ChatManager (uses: MessageService, ChatService)
├── StreamService (uses: TaskOrchestrator, ChatManager, MessageService)
├── MCP Service (uses: ChatService, TaskOrchestrator, ToolRegistry)
└── ContentEditorService (uses: TaskOrchestrator)

Layer 4 (Transport - Depends on Layer 3)
├── ChatController (uses: ChatService, MessageService)
├── StreamController (uses: StreamService)
├── ProviderController (uses: ProviderService)
└── MessageActionController (uses: MessageService)

Layer 5 (Infrastructure - Shared)
└── infrastructure/ai-providers/* (used by all AI operations)
```

---

## CROSS-CUTTING CONCERNS MATRIX

| Concern | Current Location | Usage Points | Resolution |
|---------|-----------------|--------------|-----------|
| **Task Execution** | kernel/tasks/ + domain/services/queue/ | TaskExecutor → Tool callbacks | Module provides tool callbacks, core stays runtime |
| **License Enforcement** | domain/services/license-util.ts | StreamService checks before stream | Wrap in module StreamService |
| **Provider Registry** | infrastructure/ai-providers/registry.ts | Global singleton in main.ts | Export from module, DI injection |
| **Message Branching** | domain/services/message-service.ts + DB | ChatService, MessageService | Keep in module, expose clean interface |
| **Tool Dispatch** | domain/services/tools/tool-dispatcher.ts | Called by TaskExecutor | ToolDispatcher in module, TaskExecutor calls via interface |
| **Mention Resolution** | domain/services/mention-*.ts | ChatService, message content | Extract interface, implement in module |

---

## CRITICAL COUPLING POINTS

### 1. **TaskExecutor → Tool Loop** (Bidirectional)
```
Core (TaskExecutor) → Module (Tool Handler)
  Problem: TaskExecutor calls ToolDispatcher
  Solution: TaskExecutor calls injected tool handler
  Risk: LOW (already callback pattern)
  
Module (Tool Handler) → Core (Follow-up Task)
  Problem: Tool result creates new MessageTask
  Solution: Module provides callback: createMessageTaskFromToolResult()
  Risk: LOW (async via callback)
```

### 2. **StreamService → TaskOrchestrator** (One-way)
```
Module (StreamService) ← Core (TaskOrchestrator)
  Problem: StreamService needs TaskOrchestrator to create tasks
  Solution: Inject TaskOrchestrator into StreamService
  Risk: LOW (clean injection point)
```

### 3. **DI Setup** (Needs Reorg)
```
Current: core/di/setup.ts wires everything
Problem: ChatService, MessageService, StreamService need factory calls
Solution: 
  - Core exports minimal DI setup
  - Module exports AI service factory
  - Core calls module factory during bootstrap
Risk: MEDIUM (requires refactoring DI registration)
```

### 4. **Message Content Persistence** (During Streaming)
```
Core (TaskExecutor) → Module (ChunkBuffer) → DB (Message chunks)
  Problem: TaskExecutor batches chunks, module persists to DB
  Solution: Keep chunk-buffer in core, export to module usage
  Risk: LOW (interface-based, async batching)
```

---

## SCHEMA MIGRATION CHECKLIST

### Tables to Move
- [ ] chats
- [ ] messages
- [ ] Provide migration from core to module

### Tables to Extract (Provider-specific)
- [ ] provider_api_keys (may share with components)
- [ ] provider_oauth (may share with components)
- [ ] Clarify multi-domain vs single-domain

### Tables to Keep in Core
- [ ] tasks (runtime state)
- [ ] task_chunks (runtime state)
- [ ] task_tool_events (runtime state)

---

## CONTROLLER ROUTE CONSOLIDATION

### Routes to Move to Module
```
POST /api/chats                        → ChatController
GET  /api/chats                        → ChatController
GET  /api/chats/:id                    → ChatController
POST /api/chats/:id/messages           → ChatController
POST /api/chats/:id/fork               → ChatController
DELETE /api/chats/:id                  → ChatController
DELETE /api/chats (bulk)               → ChatController

POST /api/stream/chat                  → StreamController
POST /api/stream/abort/:taskId         → StreamController
GET  /api/stream/replay/:taskId        → StreamController

GET  /api/providers                    → ProviderController
GET  /api/providers/:id                → ProviderController
GET  /api/providers/:id/health         → ProviderController
GET  /api/providers/:id/loaded         → ProviderController
POST /api/providers/:id/api-key        → ProviderController
DELETE /api/providers/:id/api-key      → ProviderController

POST /api/chats/:id/messages/:msgId/edit        → MessageActionController
POST /api/chats/:id/messages/:msgId/resend      → MessageActionController
POST /api/chats/:id/messages/:msgId/regenerate → MessageActionController
```

### Routes That Stay in Core
```
GET  /api/tasks                        → TaskController
GET  /api/tasks/:id                    → TaskController
POST /api/tasks/:id/cancel             → TaskController
```

---

## SERVICE INJECTION PATTERN

### Core Provides (Singletons)
```typescript
- DatabaseAccess
- ProviderRegistry (via module)
- ProviderApiKeyStore (via module)
- TaskManager
- TaskOrchestrator
```

### Module Provides (to Core)
```typescript
- ChatService
- MessageService
- StreamService
- ProviderService
- ToolRegistry
- ToolDispatcher
- MCP Service
```

### DI Bootstrap Order
```
1. Initialize core infrastructure (DB, logger, etc.)
2. Initialize kernel (TaskManager, TaskOrchestrator)
3. Call module.setup() to create AI services
4. Register module services in DI
5. Create CoreRouter with updated DI
```

---

## SAFETY CHECKLIST

Before moving each file:

- [ ] No imports from non-AI services (workspace, project, design, etc.)
- [ ] OR explicit interface boundary defined
- [ ] Tests don't depend on moved-away infrastructure
- [ ] DB access goes through repository interface
- [ ] DI injection clear (not service locator pattern)
- [ ] No circular dependencies created
- [ ] Type definitions exportable without core knowledge
- [ ] No global state except singletons in kernel
- [ ] All error types imported from core/errors

---

## File Count Summary

| Category | Count | Total Lines |
|----------|-------|------------|
| Chat Services | 5 | 1500+ |
| Message Services | 2 | 600+ |
| Stream Services | 1 | 1300+ |
| Provider Services | 10 | 800+ |
| Tools | 20 | 1500+ |
| Content Editing | 10 | 1200+ |
| MCP | 8 | 800+ |
| Controllers | 4 | 600+ |
| Schemas | 5 | 500+ |
| DB Layer | 4 | 1000+ |
| **Subtotal (Movable)** | **~70** | **~9700+** |
| Core Infrastructure | 50+ | 3000+ |
| Kernel/Runtime | 20+ | 1500+ |
| **TOTAL** | **~140+** | **~14200+** |

