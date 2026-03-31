# domain/services/queue/ — Task Execution Engine

The central nervous system for task orchestration, priority-based queuing, and AI provider execution.

## OVERVIEW
Orchestrates the lifecycle of `MessageTask` and `LoadTask` through a multi-stage pipeline using per-provider priority queues and concurrent executors.

## WHERE TO LOOK

| Component | File | Responsibility |
|-----------|------|----------------|
| **Orchestrator** | `task-orchestrator.ts` | Main wiring; manages `ChatTaskLock` and coordinates System/Queue/Executor. |
| **Executor** | `task-executor.ts` | Worker logic; handles provider streaming, token buffering, and error classification. |
| **Queue Manager** | `task-queue-manager.ts` | Per-provider priority queues; slot management and priority aging. |
| **Chunk Buffer** | `chunk-buffer.ts` | Time-based buffering of token chunks for efficient DB persistence. |

## KEY PATTERNS

- **Inversion of Control**: Components communicate via events (`task.token`, `task.completed`) rather than direct coupling.
- **ChatTaskLock**: Ensures strict per-chat serialization; only one `MessageTask` executes per chat at a time.
- **Priority Aging**: Prevents task starvation by boosting `effectivePriority` over time in `TaskQueueManager`.
- **Transient Retry**: Executor classifies errors; transient failures trigger automatic paused-state retry logic.
- **Token Buffering**: `ChunkBuffer` flushes accumulated stream data to DB on time intervals to reduce write pressure.

## CONVENTIONS

- **Lifecycle states**: Transitions strictly follow `pending` → `queued` → `waiting` → `running` → `streaming`.
- **Initialization**: Use `initialize*` functions for singleton-like access within the domain layer.
- **Abort Signaling**: Always propagate `AbortController` through the executor to support task cancellation.
- **Model Load Cache**: Must check/update `ModelLoadCache` during `LoadTask` execution to avoid redundant loads.
