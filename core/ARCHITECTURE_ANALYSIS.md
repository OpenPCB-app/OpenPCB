# OpenPCB `core/` — Architecture Analysis

> Audience: senior TS engineers. Scope: `core/` only (backend, frontend, contracts, with focus on `designer/`).

---

## 1. Top-level layout

```
core/
├── contracts/        ← shared TS types (no runtime)
│   ├── app/          ← runtime/bootstrap/routes/backend target
│   └── modules/      ← module manifest, registry, SDK tokens, capabilities
├── backend/          ← Bun HTTP server + module host + designer domain
│   ├── main.ts       ← entrypoint
│   ├── runtime/      ← HTTP, middleware, router, module loader, diagnostics
│   └── designer/     ← CQRS/ES design domain (commands, patches, projections)
└── frontend/         ← React/Vite shell + editor canvas + designer client
    ├── src/          ← app shell (providers, router, screens, settings)
    └── designer/     ← transport-agnostic designer client & state
```

**Key idea:** `core/` is a **plugin host**. It knows nothing about schematic/PCB features per se — those live in `modules/` (designer, component-library, knowledge, ai-service). The *one* domain that lives inside `core/` itself is the **designer foundation** (`backend/designer/` + `frontend/designer/`), which is the canonical CQRS engine that the `designer` *module* plugs into.

---

## 2. High-level block diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         core/contracts                     │
│  app/* (AppRuntime, BootstrapState, AppRoute)               │
│  modules/* (Manifest, Registry, SDK tokens, Capabilities)   │
└───────────────▲──────────────────────────────▲──────────────┘
                │ imports (types only)         │
  ┌─────────────┴──────────────┐   ┌───────────┴─────────────┐
  │       core/backend         │   │      core/frontend      │
  │                            │   │                         │
  │  main.ts ── Bun server     │   │  main.tsx               │
  │    │                       │   │    │                    │
  │    ▼                       │   │    ▼                    │
  │  runtime/                  │   │  src/app/               │
  │   ├ http/  (server,cors,   │   │   ├ providers (Boot,    │
  │   │   problem-details)     │   │   │   Runtime)          │
  │   ├ middleware (reqId,     │   │   ├ AppRouter/AppShell  │
  │   │   logging, error, cors)│   │   ├ screens (Home,      │
  │   ├ router/ (ModuleRouter, │   │   │   ModuleScreen)     │
  │   │   registry, matcher)   │   │   └ modules/            │
  │   ├ modules/               │   │       ModuleSpaceHost   │
  │   │   ├ ModuleRuntime      │   │                         │
  │   │   ├ manifest-discovery │   │  src/editor-canvas/     │
  │   │   ├ sdk-registry       │   │   (R3F/DOM canvas,      │
  │   │   ├ module-db-handle   │   │    grid, symbols, pads, │
  │   │   └ projects-capability│   │    camera, interaction) │
  │   ├ diagnostics/           │   │                         │
  │   └ controllers/ (health,  │   │  src/settings/          │
  │       diagnostics)         │   │   (SettingsDialog +     │
  │                            │   │    panels)              │
  │  designer/                 │   │                         │
  │   ├ contracts/ (entity,    │   │  designer/              │
  │   │   patch, projection,   │   │   ├ ports/ (Command-,   │
  │   │   event, commands/*)   │   │   │  Query-, EventStream│
  │   ├ domain/ (DesignWorld,  │   │   │  transports)        │
  │   │   commands + handlers, │   │   ├ runtime/ (Designer- │
  │   │   patches, systems,    │   │   │  Client, in-memory  │
  │   │   projections, history)│   │   │  transports)        │
  │   ├ application/ (Dispatch,│   │   └ state/ (DesignCache,│
  │   │   Undo, Redo, Query,   │   │      schematic session, │
  │   │   foundation factory)  │   │      selection, pending)│
  │   └ persistence/           │   │                         │
  │      ├ ports/ (repos,      │   └──────────┬──────────────┘
  │      │  tx, clock, ids,    │              │ HTTP/in-memory
  │      │  eventPublisher)    │              │
  │      ├ records/            │◀─────────────┘
  │      └ memory/ (in-mem     │
  │         impls of all ports)│
  └────────────────────────────┘
```

---

## 3. `core/backend` — runtime host

### 3.1 Startup flow (`backend/main.ts`)

```
main.ts
  │
  ├─ new DiagnosticsStore(100)          ← ring buffer for errors/logs
  ├─ new ModuleRouterRegistry()         ← map<moduleId, ModuleRouter>
  ├─ new ModuleRuntime({ registry })    ← loader + SDK registry + projects cap
  │     └─ bootstrap():
  │         1. discoverModuleManifests(workspaceRoot)
  │         2. topo-resolve dependsOn (pending→loaded/skipped/failed)
  │         3. for each loadable module:
  │              • import <moduleDir>/core/backend-entry.ts
  │              • expects export `backendModule: CoreBackendModuleDefinition`
  │              • build CoreBackendModuleContext { manifest, sdk, logger,
  │                  db: SqliteModuleDbHandle, core.projects }
  │              • definition.registerRoutes(router, ctx)
  │              • moduleRegistry.register(router)
  │              • definition.registerSdk(ctx)   ← publishes tokens in
  │              • definition.onActivate(ctx)        RuntimeSdkRegistry
  │
  ├─ createHttpServer({ host, port, diagnosticsStore, moduleRegistry,
  │                     moduleRuntime })
  │     builds middleware chain:
  │       request-id → logging → cors → error
  │       → HttpRouter (health, diagnostics, module-runtime controllers)
  │       → ModuleRouterRegistry.dispatch(req)   (module-prefixed routes)
  │
  └─ server.start()  → stdout JSON handshake consumed by Electron parent
       { serverPort, startupContractVersion:1, loadedModules, … }
```

### 3.2 Module contract

**Manifest** (`contracts/modules/manifest.ts`)

```
ModuleManifest {
  id, label, namespace, version, apiVersion,
  kind: "space"|"service"|"integration"|"widget"|"system",
  ui: { moduleEntry, primarySpace?, registerAsSpaceInTopBar?, sidebarLabel? },
  runtime?: { backendEntry?, frontendEntry? },
  dependsOn: ModuleDependency[],
  defaultPinned
}
```

**Backend module definition** (`runtime/modules/backend-module.ts`)

```
CoreBackendModuleDefinition {
  id,
  registerRoutes?(router, ctx),
  registerSdk?(ctx),
  onActivate?(ctx),
  onDeactivate?(ctx),
  errorBoundary?
}

CoreBackendModuleContext {
  moduleId, manifest,
  sdk: RuntimeSdkRegistry,   ← DI container keyed by MODULE_SDK_TOKENS
  logger,
  db: SqliteModuleDbHandle,  ← per-module SQLite file (drizzle-compatible)
  core: { projects: ProjectsCapability }
}
```

**SDK tokens** (`contracts/modules/sdk-map.ts`) — typed DI keys:

| Token | Provider module | Consumed by |
|---|---|---|
| `AIServiceSDK` | `ai-service` | component-library, designer, knowledge |
| `ComponentLibrarySDK` | `component-library` | designer |
| `DesignerSDK` | `designer` | — |
| `KnowledgeSDK` | `knowledge` | — |
| `core.projects` | **core** itself | component-library, designer, knowledge |

### 3.3 HTTP pipeline

```
Bun.serve
  └─ createHttpServer
       ├─ request-id middleware
       ├─ request-logging
       ├─ cors (cors.ts + cors-middleware)
       ├─ error middleware → problem-details (RFC 7807)
       └─ HttpRouter
            ├─ /health                  (HealthController)
            ├─ /diagnostics/*           (DiagnosticsController, ModuleRuntimeDiagnosticsController)
            └─ /modules/:id/*           (ModuleRouterRegistry → per-module ModuleRouter)
                  └─ ModuleRouter uses RouteDefinition + RouteMatcher + RouteParams
```

---

## 4. `core/backend/designer/` — the CQRS design engine

This is the **heart of the editor**. It is an **event-sourced, patch-based, revision-stamped** design world with optimistic concurrency.

### 4.1 Layered structure (clean / hex architecture)

```
┌─────────────────────────────────────────────────────────────┐
│ contracts/   ← pure types, no deps on domain                │
│   entity, entity-kind, component-kind, component-map,       │
│   components/* (sheet_meta, transform_2d, symbol_snapshot,  │
│       footprint_snapshot, wire_geometry, wire_net_ref, …)   │
│   patch, event, projection, revision, ids, units, geometry, │
│   errors, commands/* (envelopes + typed command DTOs)       │
└─────────────────────────────────────────────────────────────┘
                        ▲
                        │ (types only)
┌─────────────────────────────────────────────────────────────┐
│ domain/      ← pure functions, no I/O                       │
│   design-world.ts   DesignWorld { head, entities, netMembers}│
│   invariants.ts     assertEntityInvariant                   │
│   entity-selectors.ts                                       │
│   patches/                                                  │
│     patch-builder.ts   apply-patches.ts   invert-patches.ts │
│     stamp-patches.ts (tag with revision)                    │
│   systems/                                                  │
│     net-rebuild-system.ts  ← rebuilds nets when topology    │
│     reference-allocator.ts ← R1, C2, U3…                    │
│     wire-normalizer.ts                                      │
│   projections/                                              │
│     build-schematic-projection.ts                           │
│   history/                                                  │
│     history-entry.ts, undo-session-registry.ts              │
│   commands/                                                 │
│     command-bus, command-handler, command-registry,         │
│     create-default-command-registry,                        │
│     handlers/ (place-part, move-entities, delete-entities,  │
│       set-part-value, create-wire)                          │
└─────────────────────────────────────────────────────────────┘
                        ▲
                        │
┌─────────────────────────────────────────────────────────────┐
│ application/ ← use-cases, orchestrate ports + domain        │
│   dispatch-command.usecase.ts   (see §4.3)                  │
│   undo.usecase.ts / redo.usecase.ts                         │
│   get-schematic-projection.usecase.ts                       │
│   world-persistence.mapper.ts  (records ⇄ domain)           │
│   create-in-memory-foundation.ts (wires everything up)      │
└─────────────────────────────────────────────────────────────┘
                        ▲
                        │ (ports)
┌─────────────────────────────────────────────────────────────┐
│ persistence/                                                │
│   ports/  ← interfaces: DesignHeadRepository,               │
│      DesignEntityRepository, DesignNetMemberRepository,     │
│      DesignCommandLogRepository, EventPublisher,            │
│      TransactionRunner, Clock, IdGenerator                  │
│   records/ ← DB row DTOs                                    │
│   memory/  ← in-memory implementations of every port        │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Data model (ECS-ish)

```
DesignWorld
 ├─ head: { designId, revision, nextAutoNetOrdinals, referenceCounters }
 ├─ entities: Map<EntityId, DesignEntity>
 │     DesignEntity = { id, designId, kind, createdRev, updatedRev,
 │                      components: ComponentBag }
 │     kinds: "sheet" | "part_instance" | "wire" | "net"
 │     components (partial bag):
 │       sheet_meta, sheet_ref, transform_2d, part_origin_ref,
 │       symbol_snapshot, footprint_snapshot, instance_fields,
 │       wire_geometry, wire_end_hints, wire_net_ref, net_meta
 └─ netMembers: NetMemberRef[]  (netId → entity+pinKey, kind: wire|part_pin)
```

**Patches** are the only way the world mutates:

```
DesignPatch =
  | upsert_entity        | delete_entity
  | set_component        | remove_component
  | replace_net_members  | set_design_head
```

### 4.3 Command dispatch flow

```
  Envelope<Command>
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ DispatchCommandUsecase.execute(envelope)                  │
│  (inside TransactionRunner.runInTransaction)              │
│                                                           │
│  1. Idempotency: commandLog.findByCommandId?              │
│       → if exists, validate & replay stored result        │
│  2. Load world:                                           │
│       head + entities + netMembers via ports              │
│       (or buildEmptyWorld with default "sheet-root")      │
│  3. Optimistic concurrency:                               │
│       baseRevision must match head.revision               │
│       else → { ok:false, code:"REVISION_CONFLICT" }       │
│  4. Plan: CommandBus.execute(world, envelope, services)   │
│       → PlannedCommand { patches, affectedIds,            │
│                          topologyChanged }                │
│  5. Validate invariants on upserted entities              │
│  6. stampPatchesForRevision(nextRev)                      │
│     inverse = invertPatches(world, patches)               │
│     applyPatches(world, patches)                          │
│  7. if topologyChanged → rebuildNets(world)               │
│       append more patches + inverse + invalidated="nets"  │
│  8. Persist:                                              │
│       headRepo.upsert, entityRepo.replaceForDesign,       │
│       netMemberRepo.replaceForDesign                      │
│       commandLog.append({forward, inverse, affected})     │
│  9. undoRegistry.pushUndo(designId, sessionId, commandId) │
│ 10. eventPublisher.publish(DesignInvalidatedEvent)        │
│ 11. return CommandSuccessResult {                         │
│       commandId, designId,                                │
│       acceptedRevision, nextRevision,                     │
│       forwardPatches, affectedEntityIds,                  │
│       invalidated: ["schematic"|"nets"]                   │
│     }                                                     │
└───────────────────────────────────────────────────────────┘
```

**Undo/Redo:** `UndoSessionRegistry` keeps per-(design,session) stacks of `commandId`s. `UndoUsecase` loads the log entry, applies `inversePatches`, bumps revision, publishes an invalidated event, and moves the id to the redo stack (and vice-versa).

**Projections:** `GetSchematicProjectionUsecase` + `build-schematic-projection.ts` derive a read-model (`SchematicProjection`) containing `sheets`, `parts`, `wires`, `nets` — the frontend never sees raw ECS state.

### 4.4 Command handlers (plug-in style)

```
CommandRegistry ← register(handler)
  handlers/
    PlacePartHandler       ← place_part
    MoveEntitiesHandler    ← move_entities
    DeleteEntitiesHandler  ← delete_entities
    SetPartValueHandler    ← set_part_value
    CreateWireHandler      ← create_wire (topologyChanged=true)

CommandBus.execute(world, envelope, { allocateReference })
  → handler.plan(world, command, services)
  → PlannedCommand { patches, affectedEntityIds, topologyChanged }
```

Handlers are **pure planners**: they read the world and return patches, never mutating directly. The use-case is responsible for stamping, inverting, applying, and persisting.

---

## 5. `core/frontend/designer/` — the client side

Mirror-image of the backend designer: ports + transports + client + cache state.

```
DesignerClient
  ├─ commandTransport: CommandTransport
  │     dispatch(envelope)  undo(ids)  redo(ids)
  ├─ queryTransport:   QueryTransport
  │     getSchematicProjection(designId)
  └─ eventStream:      EventStream
        subscribe(designId, fromRevision, handler)
```

**Two wirings** (both use the same client interface):

1. **In-memory** (`create-in-memory-designer-client.ts`):
   calls `createInMemoryDesignerFoundation()` from the backend package and wraps the use-cases directly — ideal for unit tests and Electron single-process mode.
2. **HTTP/SSE** transports (scaffolded via `ports/*`, to be implemented by the designer module).

### State slices (`frontend/designer/state/`)

```
DesignCacheState      ← projection + revision + status machine
   status: idle → loading → ready → stale/conflict/error
   pendingInvalidated: ("schematic"|"nets")[]

PendingCommandState   ← in-flight commandIds for optimistic UI
SchematicSessionState ← current designId, sessionId, baseRevision
SelectionState        ← selected EntityIds
```

### Reconcile flow

```
  user action
      │
      ▼
  build CommandEnvelope (client-generated commandId, sessionId, baseRevision)
      │
      ▼
  DesignerClient.dispatch ─────────► backend DispatchCommandUsecase
      │                                     │
      │  CommandResult                      │  publishes DesignInvalidatedEvent
      ▼                                     ▼
  reconcileCommandResult(state)       eventStream.subscribe → reconcileEvent
     → status "stale"                   → mark staleRevision
     → knownRevision = nextRevision
      │
      ▼
  queryTransport.getSchematicProjection(designId)
      │
      ▼
  completeProjectionLoad(state, projection)
     → status "ready"
```

Conflicts (`REVISION_CONFLICT`) flip state to `conflict` and expose `serverRevision` so the UI can re-fetch and let the user retry.

---

## 6. `core/frontend` — app shell (everything **outside** `designer/`)

```
main.tsx
  └─ <ThemeProvider>
       └─ <BootstrapProvider>      ← detects runtime (web|electron),
            │                        resolves backendURL, fetches module
            │                        registry → BootstrapState
            ▼
          <RuntimeProvider>
            └─ <App>
                 └─ <AppShell>
                      ├─ <LeftSidebar> (modules as spaces)
                      ├─ <AppRouter>   (AppRoute: home | module)
                      │     ├─ <HomeScreen>
                      │     └─ <ModuleScreen>
                      │           └─ <ModuleSpaceHost>
                      │                (dyn-imports module's frontend-entry,
                      │                 renders its Space component)
                      └─ <SettingsDialog> + panels (General, About)
```

**`editor-canvas/`** is a reusable 2D EDA canvas (independent of designer):
`EdaCanvas`, `useEdaCamera`, grid shader, symbol/pad/pin primitives, drag-drop overlay, keyboard shortcuts, mm/nm coordinate helpers, layer model, color utils. Modules (designer, component-library preview, …) consume it.

---

## 7. Dependency graph (module level)

```
           contracts/modules ────┐
              ▲                  │
              │                  ▼
  ┌──────── backend/runtime  ◀── backend/designer/contracts
  │             │                    ▲
  │             │ loads              │ types only
  │             ▼                    │
  │        modules/* (plugins) ──────┘
  │             ▲
  │             │ SDK tokens (DI)
  │             │
  └──────── frontend/src/app ──► frontend/designer ──► backend/designer
                                   (types + in-mem use-cases import)
```

Key observation: **`frontend/designer` imports types and the in-memory foundation from `backend/designer`.** That is only safe because the backend designer layer is written as pure TS with no Node-only APIs at the `domain`/`application`/`persistence/memory` layers. Bun-specific code lives in `backend/runtime`.

---

## 8. What each `designer/` subfolder contains (quick reference)

### `core/backend/designer/`

| Folder | Purpose |
|---|---|
| `contracts/` | Pure types: `entity`, `entity-kind`, `component-kind`, `component-map`, `components/*` (per-component schemas), `commands/*` (envelope + typed DTOs + result), `patch`, `event`, `projection`, `revision`, `ids`, `units`, `geometry`, `errors` |
| `domain/` | Pure engine: `design-world`, `invariants`, `entity-selectors`, `patches/*`, `systems/*` (nets, refs, wire-normalize), `projections/*`, `history/*`, `commands/*` (bus, registry, handlers) |
| `application/` | Use-cases: `dispatch-command`, `undo`, `redo`, `get-schematic-projection`, `world-persistence.mapper`, `create-in-memory-foundation` |
| `persistence/ports/` | Port interfaces (repos, tx, clock, id-gen, event-pub) |
| `persistence/records/` | Row DTOs used by ports |
| `persistence/memory/` | In-memory implementations of every port |
| `tests/integration/` | End-to-end usecase tests (`designer-foundation.test.ts`) |

### `core/frontend/designer/`

| Folder | Purpose |
|---|---|
| `ports/` | `CommandTransport`, `QueryTransport`, `EventStream` interfaces |
| `runtime/` | `DesignerClient`, `create-in-memory-designer-client`, in-memory transports, `dispatch-command`, `reconcile-command-result`, `reconcile-event` |
| `state/` | `DesignCacheState`, `PendingCommandState`, `SchematicSessionState`, `SelectionState` |
| `tests/` | `runtime-reconcile.test.ts` |

---

## 9. Architectural properties worth noting

- **Hexagonal** design in `backend/designer/`: domain is pure; application depends on ports; persistence/memory are adapters. Swapping in a SQLite/drizzle adapter is a drop-in replacement.
- **CQRS + event-sourced log**: every mutation is a `CommandEnvelope` producing a `commandLog` entry with `forwardPatches` + `inversePatches`. Deterministic replay and undo are "free".
- **Optimistic concurrency** via `baseRevision`. Conflicts are first-class `CommandConflictResult`s, never thrown.
- **Idempotency** via `commandId` lookup at the top of `DispatchCommandUsecase`.
- **Read-model separation**: UI consumes `SchematicProjection`, not entities — keeps the wire format stable across domain refactors.
- **Module host pattern**: core is feature-empty. All PCB features (designer, component-library, knowledge, ai-service) live in `modules/` and plug in via `backendModule` exports, typed SDK tokens, and frontend `FrontendModuleEntry { Space }` components.
- **Transport-agnostic frontend client**: the same `DesignerClient` runs against in-memory (Electron single-process) or future HTTP/SSE transports, without touching UI code.

---

## 10. Suggested reading order to get fluent

1. `contracts/modules/manifest.ts`, `sdk-map.ts`, `registry.ts` — the plugin contract.
2. `backend/main.ts` → `runtime/modules/module-loader.ts` → `backend-module.ts` — bootstrap.
3. `backend/designer/contracts/entity.ts`, `component-kind.ts`, `patch.ts` — data model.
4. `backend/designer/domain/design-world.ts`, `patches/*`, `commands/command-bus.ts`, one handler (e.g. `create-wire.handler.ts`).
5. `backend/designer/application/dispatch-command.usecase.ts` — the whole transactional recipe.
6. `backend/designer/application/create-in-memory-foundation.ts` — DI wiring.
7. `frontend/designer/runtime/designer-client.ts` + `in-memory-transports.ts` + `reconcile-command-result.ts` — client round-trip.
8. `frontend/src/app/providers/BootstrapProvider.tsx` → `ModuleSpaceHost.tsx` — how the UI mounts a module.

---

**Sources (local files, relative to `core/`):** `backend/main.ts`, `backend/runtime/index.ts`, `backend/runtime/modules/module-loader.ts`, `backend/runtime/modules/backend-module.ts`, `backend/designer/application/dispatch-command.usecase.ts`, `backend/designer/application/create-in-memory-foundation.ts`, `backend/designer/domain/design-world.ts`, `backend/designer/domain/commands/command-bus.ts`, `backend/designer/contracts/{entity,patch,projection,event,component-kind}.ts`, `contracts/modules/{manifest,sdk-map,registry,capabilities,frontend-entry}.ts`, `frontend/designer/runtime/{designer-client,in-memory-transports,create-in-memory-designer-client,reconcile-command-result}.ts`, `frontend/designer/state/design-cache.state.ts`.
