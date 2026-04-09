# Command Pattern in Standalone Designer

This document explains the **current command pattern implementation** in the standalone designer foundation under `core/`.

Primary implementation roots:

- `core/backend/designer`
- `core/frontend/designer`

This is not documentation for the old document-save model. It explains the **new command-driven foundation** only.

Focus:

- command contracts
- handler/registry/bus structure
- patch planning and application
- dispatch flow
- idempotency and revision checks
- undo/redo
- event publication
- frontend runtime expectations
- file ownership and responsibilities
- known limitations

---

## 1. Purpose

The command pattern exists to make backend mutation:

- explicit
- validated
- revision-checked
- replayable
- undoable
- testable

Instead of mutating backend entities directly, all writes should enter through a command envelope, be translated into domain patches, and commit as one revisioned operation.

The current implementation is designed as a **transactional command processor with history**, not a full event-sourced system and not a collaborative CRDT/OT engine.

---

## 2. Scope

### Included

- backend command envelope/result contracts
- command registry and handler model
- patch model used by commands
- dispatch pipeline in application layer
- revision conflict handling
- idempotency handling
- session-scoped undo/redo
- invalidation event publication
- frontend transport/runtime contracts that consume command results

### Excluded

- old `src-ts` / `src-react` mutation paths
- HTTP router/server integration
- Electron/Bun process wiring
- collaborative multi-user merge/rebase protocol
- full frontend rendering logic

---

## 3. High-level architecture

At a high level, the standalone command pipeline works like this:

1. frontend builds `CommandEnvelope`
2. backend use case checks command log for idempotency
3. backend loads current canonical `DesignWorld`
4. backend validates `baseRevision`
5. command bus routes command to typed handler
6. handler plans semantic patches
7. system stamps revision metadata on patches
8. patches are inverted for history
9. patches are applied to in-memory world
10. if topology changed, net rebuild emits additional derived patches
11. world is persisted
12. command log entry is appended
13. undo stack is updated
14. invalidation event is published
15. `CommandResult` is returned

Reads remain separate:

- frontend refetches `SchematicProjection`
- frontend does not currently apply returned patches to cached projection

---

## 4. Main files and responsibilities

## 4.1 Command contracts

Files:

- `core/backend/designer/contracts/commands/command-envelope.ts`
- `core/backend/designer/contracts/commands/command-result.ts`
- `core/backend/designer/contracts/commands/place-part.command.ts`
- `core/backend/designer/contracts/commands/move-entities.command.ts`
- `core/backend/designer/contracts/commands/delete-entities.command.ts`
- `core/backend/designer/contracts/commands/set-part-value.command.ts`
- `core/backend/designer/contracts/commands/create-wire.command.ts`

Responsibilities:

- define transport-safe, serializable command shapes
- define success/conflict result shape
- define union of supported command payloads

## 4.2 Patch and event contracts

Files:

- `core/backend/designer/contracts/patch.ts`
- `core/backend/designer/contracts/event.ts`

Responsibilities:

- define backend mutation language (`DesignPatch`)
- define invalidation event payloads

## 4.3 Command runtime

Files:

- `core/backend/designer/domain/commands/command-handler.ts`
- `core/backend/designer/domain/commands/command-registry.ts`
- `core/backend/designer/domain/commands/command-bus.ts`
- `core/backend/designer/domain/commands/create-default-command-registry.ts`

Responsibilities:

- handler interface
- handler registration
- command routing by discriminant `type`

## 4.4 Command handlers

Files:

- `handlers/place-part.handler.ts`
- `handlers/move-entities.handler.ts`
- `handlers/delete-entities.handler.ts`
- `handlers/set-part-value.handler.ts`
- `handlers/create-wire.handler.ts`

Responsibilities:

- validate command-specific invariants
- inspect current world
- plan semantic patches
- declare whether topology changed

## 4.5 Application use cases

Files:

- `application/dispatch-command.usecase.ts`
- `application/undo.usecase.ts`
- `application/redo.usecase.ts`

Responsibilities:

- own transaction boundary
- load/persist world state
- perform idempotency and revision checks
- call command bus
- handle patch inversion/application
- trigger net rebuild when needed
- update history stacks
- append command log
- publish invalidation event

## 4.6 Supporting domain/persistence helpers

- `domain/patches/apply-patches.ts`
- `domain/patches/invert-patches.ts`
- `domain/patches/stamp-patches.ts`
- `domain/history/undo-session-registry.ts`
- `domain/systems/net-rebuild-system.ts`
- `domain/systems/reference-allocator.ts`
- `application/world-persistence.mapper.ts`
- persistence ports and memory adapters under `persistence/*`

## 4.7 Frontend runtime helpers

Files:

- `core/frontend/designer/ports/command-transport.ts`
- `core/frontend/designer/runtime/designer-client.ts`
- `core/frontend/designer/runtime/dispatch-command.ts`
- `core/frontend/designer/runtime/reconcile-command-result.ts`
- `core/frontend/designer/runtime/reconcile-event.ts`
- `core/frontend/designer/runtime/in-memory-transports.ts`

Responsibilities:

- abstract dispatch/query/event transport
- track pending command state
- turn command results/events into cache-state transitions
- provide in-memory backend/frontend bridge for standalone runtime

---

## 5. Command envelope

Defined in:

- `core/backend/designer/contracts/commands/command-envelope.ts`

Current shape:

```ts
interface CommandEnvelope<TCommand extends DesignerCommand> {
  commandId: CommandId;
  sessionId: SessionId;
  designId?: DesignId;
  baseRevision: Revision | null;
  createDesignIfMissing?: CreateDesignIfMissing;
  command: TCommand;
  issuedAt: number;
}
```

## 5.1 Field semantics

### `commandId`

- idempotency key
- must be stable across client retries
- backend command log is keyed by this value

### `sessionId`

- identifies editor/session history owner
- used for undo/redo stack partitioning
- used in command-id reuse validation

### `designId?`

- may be omitted on first command for a new design
- if omitted, backend generates a new design id

### `baseRevision`

- optimistic concurrency token
- existing design requires non-null current revision
- null is only acceptable when no current design head exists

### `createDesignIfMissing`

- contract exists
- fields:
  - `workspaceId`
  - optional `projectId`
  - optional `name`
- current standalone implementation does **not** yet consume this metadata

### `command`

- discriminated union of specific command payloads

### `issuedAt`

- tracked by frontend pending state
- not currently used by backend business logic

---

## 6. Supported commands

## 6.1 `place_part`

File:

- `contracts/commands/place-part.command.ts`

Important fields:

- `partInstanceId`
- `sheetId`
- `xNm`, `yNm`
- `rotationDeg`
- `mirrored`
- `originRef`
- `symbolSnapshot`
- optional `footprintSnapshot`
- optional `reference`
- optional `value`
- optional `properties`

Handler file:

- `domain/commands/handlers/place-part.handler.ts`

What it does:

- requires sheet existence
- validates finite coords and valid rotation
- rejects duplicate entity id
- allocates reference from prefix if not provided
- rejects duplicate explicit/derived reference
- rejects duplicate pin keys inside snapshot
- emits one `upsert_entity` patch for new `part_instance`
- marks `topologyChanged = true`

## 6.2 `move_entities`

File:

- `contracts/commands/move-entities.command.ts`

Fields:

- `entityIds`
- `deltaXNm`
- `deltaYNm`

Handler file:

- `domain/commands/handlers/move-entities.handler.ts`

What it does:

- requires non-empty target ids
- validates finite deltas
- moves:
  - `part_instance.transform_2d`
  - `wire.wire_geometry`
- emits `set_component` patches
- marks `topologyChanged = true`

Important current caveat:

- unsupported target kinds such as `sheet` and `net` are not explicitly rejected here; they currently produce no movement patches

## 6.3 `delete_entities`

File:

- `contracts/commands/delete-entities.command.ts`

Fields:

- `entityIds`

Handler file:

- `domain/commands/handlers/delete-entities.handler.ts`

What it does:

- rejects deletion of `sheet` entities
- emits `delete_entity` patches for existing requested entities
- additionally deletes wires only when endpoint hints are still geometrically attached to soon-to-be-deleted parts
- marks `topologyChanged = true`

## 6.4 `set_part_value`

File:

- `contracts/commands/set-part-value.command.ts`

Fields:

- `partInstanceId`
- `value`

Handler file:

- `domain/commands/handlers/set-part-value.handler.ts`

What it does:

- requires target entity exists and is `part_instance`
- rewrites `instance_fields.value`
- emits one `set_component` patch
- marks `topologyChanged = false`

## 6.5 `create_wire`

File:

- `contracts/commands/create-wire.command.ts`

Fields:

- `wireId`
- `sheetId`
- `pointsNm`
- optional `startPinRef`
- optional `endPinRef`

Handler file:

- `domain/commands/handlers/create-wire.handler.ts`

What it does:

- requires target sheet exists
- rejects duplicate wire id
- validates finite points
- validates optional pin refs exist on same sheet
- normalizes points through wire normalizer
- requires normalized geometry length >= 2
- if pin refs exist, requires they match first/last point exactly
- emits one `upsert_entity` patch for new `wire`
- marks `topologyChanged = true`

---

## 7. Command result

Defined in:

- `contracts/commands/command-result.ts`

## 7.1 Success shape

```ts
interface CommandSuccessResult {
  ok: true;
  commandId: CommandId;
  designId: DesignId;
  acceptedRevision: Revision | null;
  nextRevision: Revision;
  forwardPatches: DesignPatch[];
  affectedEntityIds: EntityId[];
  invalidated: Array<"schematic" | "nets">;
}
```

### Semantics

- `acceptedRevision`
  - revision before applying the command
- `nextRevision`
  - revision after command commit
- `forwardPatches`
  - full committed effect of the operation
  - includes both direct handler patches and derived net rebuild patches
- `affectedEntityIds`
  - ids touched by direct or derived changes
- `invalidated`
  - coarse read-model invalidation hints for consumers

## 7.2 Conflict shape

```ts
interface CommandConflictResult {
  ok: false;
  code: "REVISION_CONFLICT";
  designId: DesignId;
  serverRevision: Revision;
}
```

### Meaning

- write was rejected before mutation because optimistic revision token did not match current canonical head

---

## 8. Patch model

Defined in:

- `core/backend/designer/contracts/patch.ts`

Current patch ops:

- `upsert_entity`
- `delete_entity`
- `set_component`
- `remove_component`
- `replace_net_members`
- `set_design_head`

## 8.1 Why patches are used

Patches are the mutation language between:

- handlers
- inversion logic
- undo/redo replay
- persistence/logging
- API result payloads

This allows handlers to stay small and lets history operate on a consistent semantic format.

## 8.2 Patch ownership in current code

### Mostly used in normal dispatch

- entity upserts/deletes
- component set/remove
- net member replacement

### Supported but not central in normal dispatch

- `set_design_head`

The head patch type exists because patch engine supports it, but normal dispatch now mutates `world.head` directly and persists it separately.

---

## 9. Patch lifecycle

## 9.1 Planning

Handlers return:

```ts
interface PlannedCommand {
  patches: DesignPatch[];
  affectedEntityIds: string[];
  topologyChanged: boolean;
}
```

This is the boundary between pure command semantics and application orchestration.

## 9.2 Inversion

File:

- `domain/patches/invert-patches.ts`

Behavior:

- computes inverse list against current pre-apply world
- processes patches in reverse order
- supports entity upsert/delete, component set/remove, net membership replacement, head replacement

This powers undo and command log storage.

## 9.3 Revision stamping

File:

- `domain/patches/stamp-patches.ts`

Behavior:

- stamps `upsert_entity` patch payloads with committed `nextRevision`
- preserves original `createdRevision` for existing entities
- optionally preserves already-carried `createdRevision` when recreating historical entities during undo/redo

## 9.4 Apply

File:

- `domain/patches/apply-patches.ts`

Behavior:

- mutates world in-place
- component writes update `entity.updatedRevision = world.head.revision`
- net membership replacement rewrites full `netMembers` array
- head patch replacement is supported

---

## 10. Command bus and registry

## 10.1 Handler interface

Defined in:

- `domain/commands/command-handler.ts`

Shape:

```ts
interface CommandHandler<T extends DesignerCommand> {
  readonly type: T["type"];
  plan(world: DesignWorld, command: T, services: CommandServices): PlannedCommand;
}
```

## 10.2 Command services

Current service contract:

- `allocateReference(prefix: string): string`

Handlers do not talk to persistence or event systems directly.

## 10.3 Registry

File:

- `domain/commands/command-registry.ts`

Responsibilities:

- store map of command type -> handler
- throw if handler missing

## 10.4 Bus

File:

- `domain/commands/command-bus.ts`

Responsibilities:

- route envelope to handler by `command.type`
- return `PlannedCommand`

Bus does **not**:

- perform revision checks
- persist
- invert patches
- publish events

## 10.5 Default handler registration

File:

- `domain/commands/create-default-command-registry.ts`

Registers the current 5 concrete handlers.

---

## 11. Dispatch flow in detail

Main file:

- `application/dispatch-command.usecase.ts`

## 11.1 Step-by-step

### 1. Enter transaction

Everything runs under `TransactionRunner.runInTransaction(...)`.

Current in-memory implementation is pass-through, but the structure is already explicit.

### 2. Determine target design id

- if envelope already has `designId`, use it
- else generate a new one from `IdGeneratorPort`

### 3. Idempotency lookup

`commandLogRepository.findByCommandId(commandId)` is checked first.

If found:

- validate same command id is not being reused for different design/session/type/payload
- return stored success data without re-running the command
- do **not** re-run handler or rewrite world

Important current caveat:

- replay currently hardcodes `invalidated = ["schematic", "nets"]`, even if the original command only invalidated `schematic`

### 4. Load or bootstrap world

- if head exists:
  - load head
  - load entity rows
  - load net member rows
  - map to `DesignWorld`
- else:
  - build empty world
  - insert default root sheet
  - initialize head revision/counters

### 5. Revision conflict check

Rules:

- existing design + `baseRevision === null` => conflict
- existing design + mismatched `baseRevision` => conflict
- brand-new design + `baseRevision === null` => allowed

### 6. Compute revision boundary

- `acceptedRevision = world.head.revision`
- `nextRevision = acceptedRevision + 1`

### 7. Plan command

Call bus:

- `commandBus.execute(world, envelope, services)`

### 8. Validate planned upserts

Current validation pass runs `assertEntityInvariant()` for planned `upsert_entity` patches.

### 9. Stamp patches for committed revision

`stampPatchesForRevision(world, planned.patches, nextRevision)`

### 10. Build inverse patches

`invertPatches(world, planned.patches)` runs before apply.

### 11. Advance world head revision

`world.head.revision = nextRevision`

### 12. Apply planned patches

`applyPatches(world, planned.patches)`

### 13. Rebuild nets if topology changed

If `topologyChanged`:

- run `rebuildNets(world, createEntityId)`
- stamp net patches with same `nextRevision`
- invert derived patches against current world
- apply derived patches
- extend `forwardPatches`, `inversePatches`, `affectedEntityIds`
- set invalidation domains to `schematic + nets`

### 14. Validate affected entities post-apply

Re-check invariants on affected entities still present in world.

### 15. Persist world

- upsert head record
- replace all entity rows for design
- replace all net member rows for design

### 16. Append command log row

Stores:

- command id
- design id
- session id
- base/next revision
- command type/payload
- forward patches
- inverse patches
- affected entity ids

### 17. Push undo stack

`undoRegistry.pushUndo(designId, sessionId, commandId)`

### 18. Publish invalidation event

Publishes `design.invalidated` with:

- design id
- next revision
- source command id
- affected entities
- invalidated domains

### 19. Return success

Return `CommandSuccessResult` to caller.

---

## 12. Idempotency

## 12.1 Mechanism

Idempotency is implemented through command log lookup by `commandId`.

Primary files:

- `application/dispatch-command.usecase.ts`
- `persistence/ports/design-command-log.repository.ts`
- `persistence/memory/in-memory-design-command-log.repository.ts`

## 12.2 What is validated on reuse

If a previous command log entry exists for the same `commandId`, backend ensures reuse is not inconsistent.

Current checks:

- same `designId` when design id was supplied
- same `sessionId`
- same `command.type`
- same serialized `command` payload

If these do not match, backend throws validation error instead of replaying old result.

## 12.3 Why this matters

This allows safe retry under network/process errors if the client resends the same command id.

---

## 13. Revision and optimistic concurrency

## 13.1 Core rule

Every write to an existing design must include the current `baseRevision`.

This gives simple optimistic concurrency.

## 13.2 Conflict path

If revision mismatches:

- command is rejected before planning/apply
- backend returns `REVISION_CONFLICT`
- no world mutation happens

## 13.3 Monotonic revision guarantee

Accepted operations always move:

- `R -> R + 1`

for:

- dispatch
- undo
- redo

Undo/redo therefore do not “restore old revision”. They create a new canonical state at a new revision.

---

## 14. Undo / redo

Main files:

- `application/undo.usecase.ts`
- `application/redo.usecase.ts`
- `domain/history/undo-session-registry.ts`

## 14.1 History storage model

### Durable

Command log stores:

- forward patches
- inverse patches
- command metadata

### Session-local

Undo registry stores in memory:

- undo stack per `(designId, sessionId)`
- redo stack per `(designId, sessionId)`

## 14.2 Undo execution

High-level flow:

1. peek undo target command id from session stack
2. load target command log entry
3. ensure latest command for design came from same session
4. load current world
5. compute `acceptedRevision` / `nextRevision`
6. clone target inverse patches
7. stamp replayed upserts for `nextRevision` while optionally preserving original create revision
8. set `world.head.revision = nextRevision`
9. apply replayed inverse patches
10. validate affected entities
11. persist updated world
12. append new command log row with type `history.undo`
13. pop undo target and push same target onto redo stack
14. publish invalidation event

## 14.3 Redo execution

Same structure as undo, but replays stored forward patches and logs `history.redo`.

## 14.4 Session isolation rule

Current safety rule:

- if latest command log entry for design belongs to another session, undo/redo is rejected

This avoids replaying session-local history across interleaved foreign writes.

## 14.5 Important limitation

Undo/redo stacks are in-memory only in the current standalone implementation.

On backend restart:

- command logs remain conceptually durable only if future persistence stores them
- undo stack positions are lost in current in-memory standalone runtime

---

## 15. Net rebuild as command side effect

Main file:

- `domain/systems/net-rebuild-system.ts`

Command docs must include it because topology-changing commands do not end with just their handler patches.

## 15.1 Trigger

Triggered when handler returns:

- `topologyChanged: true`

Currently for:

- `place_part`
- `move_entities`
- `delete_entities`
- `create_wire`

Not for:

- `set_part_value`

## 15.2 Effect on command result

Net rebuild may add patches for:

- `upsert_entity` of `net`
- `delete_entity` of obsolete net
- `set_component wire_net_ref`
- `remove_component wire_net_ref`
- `replace_net_members`

This means returned `forwardPatches` can be larger than the direct handler output.

## 15.2.1 Important current connectivity caveats

Current net rebuild behavior is intentionally limited:

- a pin joins a net only when it lies on a wire segment on the same sheet
- wire-to-wire connectivity comes from endpoint-on-segment relationships on the same sheet
- two coincident pins with no wire between them do **not** produce a net
- plain segment crossing without endpoint participation is not treated as a connection

## 15.3 Invalidation consequence

When topology changed:

- `invalidated = ["schematic", "nets"]`

---

## 16. Frontend transport/runtime contract

## 16.1 Transport interfaces

Files:

- `ports/command-transport.ts`
- `ports/query-transport.ts`
- `ports/event-stream.ts`

Current transport responsibilities:

- dispatch commands
- perform undo/redo
- fetch schematic projection
- subscribe to invalidation events from revision boundary

## 16.2 `DesignerClient`

File:

- `runtime/designer-client.ts`

Thin facade over command/query/event ports.

## 16.3 Pending command tracking

File:

- `runtime/dispatch-command.ts`

Behavior:

- records pending command entry before dispatch
- clears entry in `finally`
- currently only wraps normal dispatch helper; undo/redo do not yet have equivalent pending wrapper helper

## 16.4 Command result reconciliation

File:

- `runtime/reconcile-command-result.ts`

Current model is **stale-marking**, not local patch apply.

### Success behavior

- set `designId`
- set `knownRevision = nextRevision`
- set `staleRevision = nextRevision`
- set `status = stale`
- merge invalidation domains
- clear conflict state

### Conflict behavior

- set `status = conflict`
- record `conflictServerRevision`
- update `knownRevision` and `staleRevision`

### Important note

Returned `forwardPatches` are not currently consumed by frontend cache logic.

## 16.5 Event reconciliation

File:

- `runtime/reconcile-event.ts`

Behavior for active design:

- update `knownRevision`
- update `staleRevision`
- merge invalidated domains
- keep `loading` status if already loading, otherwise mark `stale`

## 16.6 Projection load completion

Defined in:

- `state/design-cache.state.ts`

Important behavior:

- if loaded projection revision is behind already-known stale revision, cache remains stale
- avoids claiming freshness after stale load completion

---

## 17. In-memory standalone runtime

## 17.1 Backend composition

File:

- `application/create-in-memory-foundation.ts`

Builds:

- command bus with default handlers
- in-memory repositories
- in-memory event publisher
- use cases:
  - dispatch
  - undo
  - redo
  - get projection

## 17.2 Frontend composition

File:

- `runtime/create-in-memory-designer-client.ts`

Creates a `DesignerClient` backed by:

- `InMemoryCommandTransport`
- `InMemoryQueryTransport`
- `InMemoryEventStream`

## 17.3 Event stream behavior

File:

- `runtime/in-memory-transports.ts`

Behavior:

- replay in-memory stored events with `revision > fromRevision`
- then subscribe live through `InMemoryEventPublisher.subscribe()`

Important note:

- suitable for standalone/runtime tests
- not a production event transport

---

## 18. Tests and what they verify

## 18.1 Backend integration tests

File:

- `core/backend/designer/tests/integration/designer-foundation.test.ts`

Current command-pattern-relevant coverage includes:

- first-command create path
- part placement success
- topology-triggered net rebuild preserving prior net identity
- duplicate reference validation
- revision stamping preservation
- `baseRevision` enforcement on existing design
- wire endpoint pin-ref validation
- undo/redo monotonic revision behavior

## 18.2 Frontend runtime tests

File:

- `core/frontend/designer/tests/runtime-reconcile.test.ts`

Current coverage includes:

- successful command marks cache stale, not locally updated
- invalidation event marks cache stale

## 18.3 Important missing tests

Still recommended:

- command idempotency replay same envelope
- command id reuse mismatch failure
- undo/redo blocked after foreign session write
- move + delete interplay with wire endpoint hints
- richer net split/merge tests
- event replay/revision subscription edge cases
- late command result after design switch

---

## 19. Known limitations and caveats

## 19.1 Not full event sourcing

Although command log stores forward/inverse patches, the system is not event sourced.

Why:

- canonical world is persisted directly
- reads do not rebuild world by replaying history
- command log is used for idempotency/history, not as sole source of truth

## 19.2 Frontend does not apply patches optimistically

Even though backend returns `forwardPatches`, frontend currently treats command success as:

- cache stale
- refetch needed

This is deliberate for now, but important for future developers to understand.

## 19.3 Session history is in-memory only

Undo/redo stacks are not durable in standalone runtime.

## 19.4 `createDesignIfMissing` is reserved, not fully implemented

The envelope contains creation metadata but standalone dispatch currently only uses implicit empty-world bootstrap.

## 19.5 Coarse invalidation domains

Only current invalidation areas are:

- `schematic`
- `nets`

No finer-grained projection sync exists yet.

## 19.6 Shared TS contracts are direct imports

Frontend imports backend contract files directly in this standalone phase.

Good for consistency now, but likely too coupled for future service/module boundary work.

---

## 20. How to add a new command later

Recommended path:

1. define payload contract in `contracts/commands/*.command.ts`
2. extend `DesignerCommand` union in `command-envelope.ts`
3. implement handler in `domain/commands/handlers/*`
4. register handler in `create-default-command-registry.ts`
5. make handler return:
   - semantic patches
   - affected ids
   - correct `topologyChanged`
6. add integration tests for:
   - success path
   - revision conflict
   - idempotency
   - undo/redo replay
   - invalidation domains

Important rule:

- if the command can change connectivity, it must set `topologyChanged = true`

---

## 21. Recommended future improvements

High-value next steps:

1. add load/refetch orchestration helpers around frontend cache state
2. decide whether frontend should stay stale/refetch or apply patches locally
3. add CAS semantics to real persistence layer
4. add more explicit sheet lifecycle commands
5. add durable undo/redo strategy if needed
6. add labels/named nets/buses only after net topology tests are strong

---

## 22. Summary

The current standalone designer command system is a **revision-checked, patch-driven mutation pipeline** with:

- typed command envelopes
- handler-based planning
- patch inversion for history
- idempotency by command id
- session-scoped undo/redo
- derived net rebuild for topology changes
- invalidation-driven frontend synchronization

It is already concrete and buildable, but intentionally conservative: backend remains the source of truth, and frontend currently treats successful writes as a signal to refresh projection rather than as permission to mutate cached projection optimistically.
