# src-ts/ — Bun TypeScript Sidecar

Bun HTTP/WebSocket kernel implementing DDD architecture. Handles AI chat streaming, task orchestration, database persistence.

## Structure

```
src-ts/
├── src/
│   ├── main.ts              # Entry: spawns Hono HTTP server
│   ├── kernel/              # Low-level: tasks, init, types
│   │   └── tasks/           # TaskStore, TaskManager, TaskInstance
│   ├── domain/              # Business logic
│   │   ├── services/        # ChatManager, TaskSystem, StreamService
│   │   └── services/queue/  # TaskOrchestrator, TaskExecutor, TaskQueueManager
│   ├── infrastructure/      # External integrations
│   │   ├── ai-providers/    # OpenAI, Ollama, OpenRouter engines
│   │   ├── cache/           # ModelLoadCache
│   │   └── config/          # Secrets, environment
│   ├── transport/           # HTTP layer
│   │   ├── controllers/     # Route handlers
│   │   └── router/          # Hono router setup
│   ├── db/                  # Drizzle ORM
│   │   ├── schema/          # Table definitions
│   │   └── repositories/    # Data access
│   └── modules/             # Module loader, context, events
├── shared/
│   ├── types/               # Shared TypeScript types
│   ├── sdk/                 # Generated HTTP client
│   └── generated/           # Codegen outputs
└── test/                    # Integration tests
```

## Where to Look

| Task | File | Notes |
|------|------|-------|
| Task state machine | `domain/services/task-system.ts` | 9 states, dependency graph |
| Task execution | `domain/services/queue/task-executor.ts` | Provider streaming, error classification |
| Queue management | `domain/services/queue/task-queue-manager.ts` | Per-provider priority queues |
| Orchestration | `domain/services/queue/task-orchestrator.ts` | Wire all components, chat lock |
| SSE streaming | `domain/services/stream-service.ts` | Event bridge to frontend |
| Chat context | `domain/services/chat-manager.ts` | Load messages, chat state |
| OpenAI provider | `infrastructure/ai-providers/engines/openai.ts` | Vision, tools, reasoning |
| Ollama provider | `infrastructure/ai-providers/engines/ollama.ts` | Local models, tag parsing |
| Module loading | `modules/ModuleLoader.ts` | Discover, register, lifecycle |

## Task System Architecture

**Three layers:**
1. **Kernel** (`kernel/tasks/`): TaskStore (cache + SQLite), TaskManager (lifecycle)
2. **Domain** (`domain/services/`): TaskSystem (state machine, dependencies)
3. **Execution** (`domain/services/queue/`): Orchestrator, Executor, QueueManager

**Task states:** pending → queued → waiting → running → streaming → completed/failed/cancelled

**Key patterns:**
- Per-chat serialization via ChatTaskLock
- LoadTask dependency for model loading
- Priority aging prevents starvation
- Crash recovery marks running as paused

## Testing

```bash
bun test                    # All tests
bun test --watch            # Watch mode
bun test src/domain         # Specific directory
```

**Test locations:**
- Unit tests: colocated as `*.test.ts`
- Integration: `test/` and `tests/integration/`
- Preload: `test/setup.ts` (sets NODE_ENV, APP_DATA_DIR)

## Conventions

- **Singleton services**: TaskSystem, TaskQueueManager use init/get pattern
- **Event emission**: Changes propagate via `on()` subscriptions
- **Sync cache + async DB**: TaskStore provides sync API, persists async
- **Error classification**: Transient (retry) vs Fatal (fail immediately)

## Anti-Patterns

| Forbidden | Why |
|-----------|-----|
| Direct provider calls from queue | Keep queue provider-agnostic |
| Skip chat context loading | Spec violation: MessageTask needs full history |
| Use `as any` for tool calls | Type safety—use discriminated unions |
| Empty catch blocks | Swallows errors silently |

## Tool System

For creating new tools, use the `/tool-create` skill. See [domain/services/tools/AGENTS.md](src/domain/services/tools/AGENTS.md) for tool system architecture.
