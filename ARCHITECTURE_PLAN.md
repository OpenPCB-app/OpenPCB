# OpenPCB Architecture Plan

## 1. Current Architecture

### Three-Layer Runtime

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Frontend (Vite :1420)                   │
│  Components ─ Stores (Zustand) ─ Hooks ─ API Clients ─ Canvas  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP / WebSocket
┌──────────────────────────▼──────────────────────────────────────┐
│                  Bun Sidecar (dynamic port)                     │
│  Transport ─ Domain Services ─ Infrastructure ─ DB (SQLite)     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Bridge IPC (JSON namespace routing)
┌──────────────────────────▼──────────────────────────────────────┐
│                   Rust Tauri Shell                               │
│  Bridge Router ─ Sidecar Manager ─ Secrets Vault ─ Updater     │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Details

#### React Frontend (`src-react/`)

| Aspect      | Detail                                                   |
| ----------- | -------------------------------------------------------- |
| Framework   | React 19, Vite 7, TypeScript strict                      |
| State       | Zustand 5 (10 stores: app, auth, chat, navigation, etc.) |
| UI Library  | Radix UI + Shadcn/UI (48 components), Tailwind 4         |
| Editors     | TipTap 3 (rich text), Custom Canvas2D (schematic)        |
| 3D Viewer   | Three.js + React Three Fiber, OCCT WASM (STEP parser)    |
| API Clients | 18 fetch-based clients in `lib/api/`                     |
| Hooks       | 35+ custom hooks for all domain operations               |
| Screens     | 8 screen types: home, design, notes, chat, library, etc. |
| Testing     | Vitest (happy-dom), 45 colocated test files              |

#### Bun Sidecar Backend (`src-ts/`)

| Aspect        | Detail                                                       |
| ------------- | ------------------------------------------------------------ |
| Runtime       | Bun 1.2, Hono HTTP framework                                 |
| Architecture  | DDD: kernel → domain → infrastructure → transport            |
| Database      | SQLite via Drizzle ORM, 42 tables, 35+ repositories          |
| AI Providers  | 5 engines: OpenAI, Ollama, OpenRouter, GitHub Copilot, Local |
| Task System   | 9-state machine: pending→queued→waiting→running→streaming→…  |
| Module System | Manifest-driven, isolated DB prefixes, HTTP/WS per module    |
| Services      | 33+ domain services, DI container                            |
| API Endpoints | 70+ REST endpoints across 15+ resource types                 |
| Testing       | Bun test runner, 76 unit + 8 integration tests               |

#### Rust Tauri Shell (`src-tauri/`)

| Aspect     | Detail                                                       |
| ---------- | ------------------------------------------------------------ |
| Framework  | Tauri 2.0, 8 plugins (os, log, shell, opener, etc.)          |
| Bridge IPC | Namespace routing: `core` (3 cmd), `bun` (3), `secrets` (12) |
| Secrets    | Stronghold vault (Argon2 KDF) for API keys, sessions, JWT    |
| Sidecar    | Spawns Bun process, port discovery, health checks            |
| License    | Ed25519 JWT verification, grace period, offline cache        |
| Code Gen   | Specta → TypeScript bindings, bridge introspection           |
| Crates     | 4 workspace crates: main, bridge, bridge-macros, common      |

### Module System

```
modules/
├── _kit/           # Shared SDK: createModule(), TipTap extensions, file utils
└── knowledge/      # Active module: knowledge base with pages + search
    ├── manifest.json   # V2 API, namespace "space.knowledge", DB prefix "knowledge_"
    ├── ts/             # Bun backend: routes, DB schema, services
    ├── react/          # Frontend: Space.tsx entry point
    └── shared/         # Shared types
```

Lifecycle: Discovery → Registration → `onActivate(ctx)` → `onDeactivate()`
Isolation: `ctx.db`, `ctx.logger`, `ctx.events` — no global state access
Endpoints: `/api/modules/<id>/*` and `/ws/modules/<id>`

### Code Generation Pipeline

```
npm run gen
├── npm run modules:generate     # Module registry from manifests
├── npm run bindings:generate    # Tauri Specta → TypeScript
├── npm run bridge:generate      # Bridge types (Rust ↔ TS)
├── npm run sdk:generate         # SDK generation
├── npm run gen:openapi          # OpenAPI spec from Hono routes
└── npm run gen:sdk:orval        # Orval client SDK from OpenAPI
```

---

## 2. Identified Issues

### 2.1 Legacy Naming

| Location                                     | Current Name                  | Origin                    | Impact                                     |
| -------------------------------------------- | ----------------------------- | ------------------------- | ------------------------------------------ |
| `src-tauri/crates/bridge/Cargo.toml`         | `one_mind_bridge`             | OneMind project           | All Rust source references this crate name |
| `src-tauri/crates/common-modules/Cargo.toml` | `one_mind_module_support`     | OneMind project           | Referenced in bridge macros                |
| `src-tauri/Cargo.lock`                       | `name = "OneMind"`            | Stale lock file           | Auto-regenerates                           |
| `src-react/package-lock.json`                | `"name": "OneMind-app"`       | Stale lock file           | Cosmetic but confusing                     |
| 2 integration test files                     | `onemind-` temp dir prefixes  | OneMind project           | Test artifacts                             |
| `bridge-macros/src/lib.rs`                   | `::one_mind_bridge::` codegen | Generated from crate name | ~15 occurrences                            |

### 2.2 Dead Code

| Item                         | Location                          | Type              | Evidence                                                    |
| ---------------------------- | --------------------------------- | ----------------- | ----------------------------------------------------------- |
| `greet()` function           | `src-tauri/src/commands.rs:44`    | Demo code         | Zero callers in frontend or backend                         |
| `start_backend_progress()`   | `src-tauri/src/commands.rs:55`    | Demo code         | Zero callers; emits undefined `BackendProgress` type        |
| `BackendNotification` struct | `src-tauri/src/commands.rs:14`    | Demo support      | Only used by `start_backend_progress()`                     |
| `BackendProgress` event      | `src-tauri/src/core_bridge.rs:12` | Undefined type    | Type doesn't exist in `commands.rs` — potential build error |
| `CoreSDK` wrapper            | `src-ts/shared/sdk/index.ts:37`   | Deprecated compat | 1 remaining caller (`app-store.ts`), marked `@deprecated`   |
| `now()` in base.ts           | `src-ts/src/db/schema/base.ts:71` | Deprecated util   | Zero callers; replaced by `core/utils/time`                 |

### 2.3 Deprecated APIs with Active Callers (DO NOT REMOVE)

| Item                        | Location                                         | Callers                           | Why Deferred                                |
| --------------------------- | ------------------------------------------------ | --------------------------------- | ------------------------------------------- |
| `isPinned` column           | `db/schema/chat.ts:41`                           | 7 backend files                   | Requires data migration to `favorite` table |
| `fileReferenceId` field     | `db/schema/message.ts:123`                       | stream-service + chat-mapper      | Requires code migration to `fileId`         |
| `chatToChat()` method       | `domain/mappers/chat-mapper.ts:82`               | `chatToChatWithMessages()` + list | Internal dependency chain                   |
| `EDIT_CONTENT_TOOL` const   | `domain/services/tools/edit-content-tool.ts:163` | 3 refs in stream-service          | Active streaming integration                |
| `ProjectMetadata` interface | `shared/types/project.types.ts:76`               | DB schema, SDK, 3 type files      | Used as `$type<>` in Drizzle schema         |
| Legacy task types           | `db/schema/task.ts:53-54`                        | Schema enum only                  | Existing DB rows may reference them         |

### 2.4 Commented-Out Code (Disabled Projects Feature)

| File                    | Lines     | Content                               |
| ----------------------- | --------- | ------------------------------------- |
| `ScreenRouter.tsx:9`    | 1 line    | Commented `ProjectScreen` import      |
| `HomeScreen.tsx:9-20`   | ~12 lines | Commented project state/hooks imports |
| `ChatScreen.tsx:76`     | 1 line    | Commented project lookup              |
| `ProjectBadge.tsx:3-54` | ~50 lines | Full commented implementation block   |
| `engines/mod.ts`        | 1 line    | Commented `LocalEngine` export        |

### 2.5 On-Disk Legacy Directories

| Directory    | Size   | Status                                 |
| ------------ | ------ | -------------------------------------- |
| `OneMind/`   | 1.1 GB | Gitignored, separate complete project  |
| `pcb_draft/` | 644 MB | Gitignored, legacy WASM-based monorepo |

These are not tracked by git and don't affect the build. Removal is a disk cleanup decision for the developer.

---

## 3. Target Architecture

The target architecture **preserves the existing 3-layer structure** — it's well-designed and appropriate. Changes focus on naming consistency, dead code removal, and documentation.

### 3.1 Naming Consistency

```
Before:                          After:
one_mind_bridge         →        openpcb_bridge
one_mind_module_support →        openpcb_module_support
OneMind-app (lock)      →        openpcb-app (regenerated)
onemind-* (tests)       →        openpcb-* (test prefixes)
```

### 3.2 Clean Core Bridge

```
Before:                          After:
CoreBridge                       CoreBridge
├── greet (demo)          →      ├── serverStatus (production)
├── serverStatus          →      └── (events removed — both were demo)
├── startBackendProgress  →
└── events: notification, →
    progress (undefined!)
```

### 3.3 Clean SDK Layer

```
Before:                          After:
shared/sdk/index.ts              shared/sdk/index.ts
├── Re-exports (keep)     →      ├── Re-exports (keep)
└── CoreSDK wrapper       →      └── (removed, callers migrated)
    (deprecated)
```

### 3.4 Clean Commented Code

All disabled-feature comments removed. Infrastructure (DB tables, API endpoints, component files) preserved for future re-enablement.

---

## 4. Design Patterns

### 4.1 Patterns Currently in Use

| Pattern           | Implementation                                                                         | Location                                             |
| ----------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Repository**    | 35+ data access classes wrapping Drizzle ORM queries                                   | `src-ts/src/db/repositories/`                        |
| **Adapter**       | `BaseToolAdapter` + 4 provider-specific adapters (OpenAI, Ollama, OpenRouter, Copilot) | `src-ts/src/infrastructure/ai-providers/adapters/`   |
| **Singleton**     | 12+ services with `initialize*()`/`get*()` pattern + module-scoped instances           | Throughout `src-ts/src/domain/services/`             |
| **Factory**       | `ProviderRegistry` creates engine instances by provider ID                             | `src-ts/src/infrastructure/ai-providers/registry.ts` |
| **Observer**      | Event bus in module system; Tauri event emission for bridge events                     | `src-ts/src/modules/`, `src-tauri/crates/bridge/`    |
| **Strategy**      | AI engines implement common `Engine` interface; interchangeable at runtime             | `src-ts/src/infrastructure/ai-providers/engines/`    |
| **Bridge**        | Namespace-based IPC routing: frontend → Tauri `bridge_invoke` → handler dispatch       | `src-tauri/crates/bridge/src/lib.rs`                 |
| **State Machine** | Task lifecycle: 9 states with defined transitions, dependencies, retry logic           | `src-ts/src/domain/services/task-system.ts`          |
| **DDD Layering**  | kernel → domain → infrastructure → transport; strict import direction                  | `src-ts/src/` directory structure                    |
| **Mediator**      | `TaskOrchestrator` wires TaskSystem + QueueManager + Executor                          | `src-ts/src/domain/services/queue/`                  |
| **Guard**         | `ToolGuards` (WorkspaceContextGuard, ProjectContextGuard) enforce auth/context         | `src-ts/src/domain/services/tools/`                  |
| **Registry**      | `ToolRegistry`, `ContentTargetRegistry`, `MentionRegistry` — plugin-like registration  | Multiple service locations                           |

### 4.2 SOLID Compliance Assessment

| Principle                     | Grade | Notes                                                                                                                                                                                              |
| ----------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** — Single Responsibility | B+    | Most services well-scoped. StreamService (51K LOC) and ContentEditorService (48K LOC) are large but coherent. Future opportunity: extract sub-concerns.                                            |
| **O** — Open/Closed           | A     | Provider system fully extensible via registry. Module system extends without modifying core. Tool system pluggable.                                                                                |
| **L** — Liskov Substitution   | A     | AI engine interface is properly polymorphic. All engines substitute cleanly.                                                                                                                       |
| **I** — Interface Segregation | A-    | ToolSpec separate from ToolHandler. Bridge namespace handler well-scoped. Some repository base class methods could be narrower.                                                                    |
| **D** — Dependency Inversion  | B     | DI container exists (`core/di/setup.ts`) but 12+ singletons bypass it with module-scoped `initialize/get` pattern. Not a bug — pragmatic choice for Bun's module system — but reduces testability. |

### 4.3 Recommendations (Future, Not This Cleanup)

1. **Consolidate singletons into DI container** — migrate `init/get` pattern services to constructor injection via the existing DI container. Improves testability and makes dependency graph explicit.
2. **Extract StreamService sub-concerns** — token buffering, reasoning block handling, and SSE formatting could be separate collaborators.
3. **Type-narrow repository base class** — `BaseRepository` methods use `as any` casts for Drizzle query building. Consider generic type constraints.

---

## 5. Phased Execution Roadmap

### Phase 1: Legacy Naming (Low Risk)

- Rename `one_mind_bridge` → `openpcb_bridge` across all Rust crates
- Rename `one_mind_module_support` → `openpcb_module_support`
- Update all `use`/`import` references in 6+ Rust source files
- Regenerate Cargo.lock and package-lock.json
- Fix test temp dir prefixes
- **Verify**: `cargo check`, `npm run test:ts`

### Phase 2: Dead Demo Code (Low Risk)

- Remove `greet`, `start_backend_progress`, `BackendNotification`, event specs
- Simplify `commands.rs` to only `ServerStatus` + `server_status()`
- **Verify**: `cargo check`, no frontend callers (confirmed)

### Phase 3: Deprecated Code (Medium Risk)

- Remove `CoreSDK` wrapper, migrate 1 caller
- Remove unused `now()` from `base.ts`
- Document SKIP items with reasoning
- **Verify**: `npm run test:ts`, `npm run test:react`, `npx tsc --noEmit`

### Phase 4: Commented-Out Code (Low Risk)

- Clean disabled Projects feature comments in 4 React files
- Remove commented `LocalEngine` export
- **Verify**: `npm run test:react`, visual check

### Post-Cleanup Verification

1. `cargo check --manifest-path src-tauri/Cargo.toml`
2. `cd src-ts && npx tsc --noEmit`
3. `npx tsc -p src-react/tsconfig.json --noEmit`
4. `npm run test:ts`
5. `npm run test:react`
6. `npm run dev` — full app starts in browser
7. `npx playwright test` — E2E passes

---

## 6. Statistics Snapshot

| Metric                       | Count                          |
| ---------------------------- | ------------------------------ |
| TypeScript files (src-ts)    | 371                            |
| TypeScript files (src-react) | 363                            |
| React components             | 150+                           |
| Custom hooks                 | 35+                            |
| Zustand stores               | 10                             |
| Domain services              | 33+                            |
| Database tables              | 42                             |
| Repositories                 | 35+                            |
| API endpoints                | 70+                            |
| AI provider engines          | 5                              |
| Test files (unit)            | 121 (76 backend + 45 frontend) |
| Test files (integration)     | 8                              |
| Rust crates                  | 4                              |
| Active modules               | 1 (knowledge)                  |
| Codegen scripts              | 6                              |
