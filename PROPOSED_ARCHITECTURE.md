# OpenPCB Proposed Architecture v3

## Guiding principles

1. **Strict one-way dependencies**: `modules/ → sdks/ + shared/ → core/`
2. **core/ is pure infrastructure**: HTTP server, DI container, router, app shell — zero business logic
3. **shared/ is the domain platform**: ECS engine, command pattern, canvas engine, shared types
4. **sdks/ is the cross-module contract layer**: pure interfaces + public types, no implementations
5. **modules/ are self-contained vertical slices**: each owns its API, frontend, DB schema, domain logic
6. **electron/ is a thin OS shell**: window management, IPC, process lifecycle

---

## Dependency rules

```
electron/  ──spawns──►  core/backend/main.ts
                         │
modules/*  ─────────►  sdks/*  ─────────►  shared/*  ─────────►  core/*
   │                                          │
   └──────────────────────────────────────────┘  (modules also import shared/ directly)
```

| Layer | May import from | Must NOT import from |
|-------|----------------|---------------------|
| `core/` | Nothing app-specific | shared/, sdks/, modules/ |
| `shared/` | `core/` only | sdks/, modules/ |
| `sdks/` | `shared/` only (for shared types) | core/, modules/ |
| `modules/*` | `shared/`, `sdks/*` | `core/` directly, other modules' internals |
| `electron/` | nothing from src (spawns Bun as child process) | — |

**ESLint boundaries enforcement**: Use `eslint-plugin-boundaries` to make these rules compile-time errors.

---

## Top-level folder structure

```
OpenPCB/
├── electron/                        # Electron shell (thin)
│   ├── main.ts                      # Main process entry
│   ├── preload.ts                   # contextBridge (IPC)
│   ├── backend-manager.ts           # Spawn + monitor Bun process
│   └── menus.ts                     # Native menus
│
├── core/                            # Pure infrastructure
│   ├── backend/                     # Bun HTTP runtime
│   │   ├── main.ts                  # Entry point — boots everything
│   │   ├── http/                    # HTTP server, CORS, request context
│   │   ├── router/                  # Route matching, validation (Hono)
│   │   ├── di/                      # DI container (registration, resolution)
│   │   ├── module-loader/           # Manifest discovery, dependency graph, bootstrap
│   │   ├── middleware/              # Request ID, logging, error handling
│   │   └── diagnostics/             # Health, diagnostics endpoints
│   │
│   ├── frontend/                    # App shell (React 19 + Vite)
│   │   ├── App.tsx                  # Root provider stack
│   │   ├── main.tsx                 # React entry
│   │   ├── shell/                   # AppShell, sidebar, loading gates
│   │   ├── router/                  # Route switch, module route collection
│   │   ├── providers/               # RuntimeProvider, BootstrapProvider, ThemeProvider
│   │   ├── stores/                  # navigation.store, app.store (zustand)
│   │   └── hooks/                   # useBackendPort, useElectronIPC, useTheme
│   │
│   └── contracts/                   # Infrastructure contracts
│       ├── module-manifest.ts       # Module manifest shape
│       ├── module-entry.ts          # Backend/frontend module entry interfaces
│       ├── runtime.ts               # Runtime type (web | electron)
│       ├── di-tokens.ts             # DI token definitions
│       └── http-context.ts          # Request context, route registration types
│
├── shared/                          # Shared domain platform
│   ├── domain/                      # Core domain primitives
│   │   ├── ecs/                     # ECS engine
│   │   │   ├── entity.ts            # Entity definition, EntityId
│   │   │   ├── component-registry.ts # Component type registry
│   │   │   ├── world.ts             # In-memory world state (entity store)
│   │   │   ├── query.ts             # Entity query engine
│   │   │   └── systems.ts           # System runner interface
│   │   │
│   │   ├── commands/                # Command pattern infrastructure
│   │   │   ├── command.ts           # Command interface, CommandEnvelope
│   │   │   ├── command-bus.ts       # Command bus (dispatch, handler registry)
│   │   │   ├── command-result.ts    # CommandResult, validation result
│   │   │   └── history.ts           # Undo/redo session stack
│   │   │
│   │   ├── patches/                 # Patch algebra
│   │   │   ├── patch.ts             # Patch types (upsert, delete, set_component, etc.)
│   │   │   ├── apply.ts             # Apply patches to world
│   │   │   ├── invert.ts            # Invert patches (for undo)
│   │   │   └── stamp.ts            # Stamp revision on patches
│   │   │
│   │   ├── events/                  # Domain event infrastructure
│   │   │   ├── event.ts             # Event interface
│   │   │   ├── event-bus.ts         # Publish/subscribe
│   │   │   └── invalidation.ts      # Invalidation event types
│   │   │
│   │   └── persistence/             # Persistence abstractions
│   │       ├── repository.ts        # Generic repository port interface
│   │       ├── transaction.ts       # Transaction runner interface
│   │       └── migration.ts         # Migration runner contract
│   │
│   ├── types/                       # Shared type definitions
│   │   ├── geometry.ts              # Point, Rect, Transform2D
│   │   ├── ids.ts                   # ID generation, branded types
│   │   ├── revisions.ts             # Revision, RevisionConflict
│   │   ├── units.ts                 # Mils, mm, conversion
│   │   ├── result.ts                # Result<T, E> type
│   │   └── errors.ts                # Shared error codes / problem types
│   │
│   ├── frontend/                    # Shared frontend code
│   │   ├── canvas/                  # Reusable canvas/rendering engine
│   │   │   ├── CanvasHost.tsx       # R3F canvas wrapper
│   │   │   ├── camera/              # Camera controls, zoom, pan
│   │   │   ├── interaction/         # Hit testing, drag, selection box
│   │   │   ├── layers/              # Layer system, visibility, ordering
│   │   │   ├── primitives/          # Grid, crosshair, selection highlight
│   │   │   ├── coordinate/          # Screen↔world transforms
│   │   │   └── types.ts             # Canvas-specific shared types
│   │   │
│   │   ├── components/              # Shared UI primitives
│   │   │   ├── Button.tsx
│   │   │   ├── Dialog.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Panel.tsx
│   │   │   ├── Toolbar.tsx
│   │   │   └── theme/               # Theme tokens, CSS variables
│   │   │
│   │   ├── hooks/                   # Shared React hooks
│   │   │   ├── useCommand.ts        # Generic command dispatch hook
│   │   │   ├── useUndo.ts           # Generic undo/redo hook
│   │   │   ├── useProjection.ts     # Query projection with cache
│   │   │   └── useEventStream.ts    # Subscribe to domain events
│   │   │
│   │   └── stores/                  # Shared store patterns
│   │       └── entity-cache.ts      # Generic entity cache store factory
│   │
│   └── backend/                     # Shared backend utilities
│       ├── db/                      # Database helpers
│       │   ├── connection.ts        # SQLite connection factory
│       │   ├── migration-runner.ts  # Run module migrations
│       │   └── helpers.ts           # Common query patterns
│       │
│       ├── services/                # Shared backend services
│       │   ├── id-generator.ts      # UUID / ULID generation
│       │   └── clock.ts             # Clock abstraction (testable)
│       │
│       └── testing/                 # Shared test utilities
│           ├── in-memory-repos.ts   # Generic in-memory repository
│           └── test-world.ts        # Test world factory
│
├── sdks/                            # Module SDK interfaces (pure contracts)
│   ├── designer/
│   │   ├── index.ts                 # DesignerSDK interface
│   │   ├── types.ts                 # Project, DesignState, Netlist, etc.
│   │   └── events.ts                # Designer-specific events
│   │
│   ├── component-library/
│   │   ├── index.ts                 # ComponentLibrarySDK interface
│   │   ├── types.ts                 # Part, Symbol, Footprint, SearchParams
│   │   └── components.ts            # Re-exported React components (PartPickerDialog, etc.)
│   │
│   ├── ai-service/
│   │   ├── index.ts                 # AIServiceSDK interface
│   │   └── types.ts                 # ChatParams, Provider, ToolResult, etc.
│   │
│   └── knowledge/
│       ├── index.ts                 # KnowledgeSDK interface
│       └── types.ts                 # KnowledgeEntry, SearchResult
│
├── modules/                         # Self-contained feature modules
│   ├── designer/                    # ← detailed below
│   ├── component-library/
│   ├── ai-service/
│   └── knowledge/
│
├── scripts/                         # Build and codegen scripts
├── tests/                           # E2E tests (Playwright)
├── package.json
├── tsconfig.base.json
├── vite.config.ts
└── eslint.config.ts                 # Boundary rules enforced here
```

---

## Module internal structure (designer example)

Every module follows this standard layout:

```
modules/designer/
├── MODULE_MANIFEST.json             # Metadata, dependencies, routes, tools, tables
│
├── index.ts                         # Module entry (registers with core loader)
│
├── backend/
│   ├── domain/                      # Pure business logic (no I/O)
│   │   ├── models/                  # Designer-specific entity component types
│   │   │   ├── sheet.ts             # sheet_meta, sheet_ref components
│   │   │   ├── part-instance.ts     # part_origin_ref, symbol_snapshot, etc.
│   │   │   ├── wire.ts              # wire_geometry, wire_end_hints, wire_net_ref
│   │   │   ├── net.ts               # net_meta, net membership
│   │   │   └── design-rules.ts      # DRC/ERC rule definitions
│   │   │
│   │   ├── commands/                # Command handlers (produce patches, no I/O)
│   │   │   ├── place-part.handler.ts
│   │   │   ├── move-entities.handler.ts
│   │   │   ├── delete-entities.handler.ts
│   │   │   ├── create-wire.handler.ts
│   │   │   ├── set-part-value.handler.ts
│   │   │   └── _registry.ts         # Handler registry for this module
│   │   │
│   │   ├── systems/                 # ECS systems (pure transforms)
│   │   │   ├── net-rebuild.system.ts
│   │   │   ├── wire-normalizer.system.ts
│   │   │   └── reference-allocator.system.ts
│   │   │
│   │   ├── projections/             # Read model builders
│   │   │   └── schematic-projection.ts
│   │   │
│   │   ├── invariants.ts            # Validation rules
│   │   └── entity-selectors.ts      # Read helpers / assertions
│   │
│   ├── application/                 # Use-case orchestration (I/O boundary)
│   │   ├── dispatch-command.usecase.ts
│   │   ├── undo.usecase.ts
│   │   ├── redo.usecase.ts
│   │   ├── get-schematic-projection.usecase.ts
│   │   └── sdk-implementation.ts    # Implements DesignerSDK interface
│   │
│   ├── persistence/                 # Data access
│   │   ├── repositories/
│   │   │   ├── head.repository.ts
│   │   │   ├── entity.repository.ts
│   │   │   ├── net-member.repository.ts
│   │   │   └── command-log.repository.ts
│   │   └── records/                 # DB row shapes
│   │       ├── design-head.record.ts
│   │       ├── entity.record.ts
│   │       └── net-member.record.ts
│   │
│   ├── handlers/                    # HTTP route handlers
│   │   ├── project.handler.ts       # /api/v1/designer/projects/*
│   │   ├── entity.handler.ts        # /api/v1/designer/entities/*
│   │   ├── command.handler.ts       # /api/v1/designer/commands
│   │   └── export.handler.ts        # /api/v1/designer/export (Gerber, KiCad)
│   │
│   ├── tools/                       # AI-callable tools
│   │   ├── place-component.tool.ts
│   │   ├── run-drc.tool.ts
│   │   ├── suggest-fix.tool.ts
│   │   └── get-design-state.tool.ts
│   │
│   └── db/
│       ├── schema.ts                # Table definitions (entities, projects, nets)
│       └── migrations/
│           ├── 001_create_projects.ts
│           └── 002_create_entities.ts
│
├── frontend/
│   ├── screens/
│   │   ├── SchematicEditor.tsx       # Main schematic editing screen
│   │   └── PCBEditor.tsx             # Main PCB editing screen
│   │
│   ├── stores/
│   │   ├── designer.store.ts        # ECS entity cache (uses shared/frontend/stores/entity-cache)
│   │   ├── schematic-view.store.ts  # Zoom, pan, selection, active tool
│   │   └── pcb-view.store.ts        # Layers, cursor mode
│   │
│   ├── components/
│   │   ├── render-engine/            # R3F scenes (uses shared/frontend/canvas/)
│   │   │   ├── SchematicScene.tsx
│   │   │   ├── PCBScene.tsx
│   │   │   └── wrappers/            # SymbolWrapper, FootprintWrapper
│   │   ├── toolbars/
│   │   │   ├── SchematicToolbar.tsx
│   │   │   └── PCBToolbar.tsx
│   │   └── panels/
│   │       ├── PropertiesPanel.tsx
│   │       ├── LayerPanel.tsx
│   │       └── NetPanel.tsx
│   │
│   ├── hooks/
│   │   ├── useDesignEntities.ts      # Query ECS entities (wraps shared useProjection)
│   │   └── usePartPicker.ts          # Opens ComponentLibrary's PartPicker (via SDK)
│   │
│   └── routes.ts                     # Route definitions for this module
│
└── tests/
    ├── domain/
    │   ├── place-part.test.ts
    │   ├── net-rebuild.test.ts
    │   └── undo-redo.test.ts
    └── integration/
        ├── dispatch-command.test.ts
        └── revision-conflict.test.ts
```

---

## What goes where — decision guide

### core/ — "Would a generic app need this?"

If YES → it belongs in `core/`.

| Belongs in core/ | Does NOT belong in core/ |
|---|---|
| HTTP server setup | ECS engine |
| Request/response pipeline | Command pattern |
| DI container | Entity types |
| Module manifest loader | Patch algebra |
| App shell (Layout, sidebar, router) | Canvas/rendering engine |
| Runtime detection (web/electron) | Domain events |
| Health/diagnostics endpoints | Business logic of any kind |
| CORS, middleware, request ID | Shared UI components |

### shared/ — "Do multiple modules need this?"

If YES → it belongs in `shared/`.

| Belongs in shared/ | Does NOT belong in shared/ |
|---|---|
| ECS engine + world state | Designer command handlers |
| Command bus + history | Part search logic |
| Patch algebra (apply/invert) | AI provider implementations |
| Domain event bus | Module-specific screens |
| Canvas engine (camera, layers, interaction) | Module-specific DB schemas |
| Shared UI primitives (Button, Dialog) | Module-specific API handlers |
| Geometry types, ID types | SDK implementations |
| DB connection helpers | |
| In-memory test adapters | |

### sdks/ — "What can other modules call?"

Pure interfaces + public types. No implementations, no business logic.

| Belongs in sdks/ | Does NOT belong in sdks/ |
|---|---|
| `DesignerSDK` interface | `DesignerService` class |
| `Part`, `Symbol`, `Footprint` types | Internal domain models |
| `ChatParams`, `ToolResult` types | Provider implementations |
| Re-exported cross-module React components | Internal React components |

### modules/ — "Is this specific to one feature?"

If YES → it belongs in that module.

| Belongs in modules/ | Does NOT belong in modules/ |
|---|---|
| Command handlers | ECS engine |
| API route handlers | Command bus |
| Frontend screens | Shared UI primitives |
| Module-specific stores | Canvas engine |
| DB schema + migrations | |
| AI tools | |
| SDK implementation | |
| Domain invariants | |

---

## SDK wiring at startup

```
1. core/backend/module-loader scans modules/*/MODULE_MANIFEST.json
2. For each module (respecting dependency order):
   a. Load modules/<id>/index.ts
   b. Module registers its SDK implementation in DI container
   c. Module registers its HTTP handlers in router
   d. Module registers its AI tools in tool registry
   e. Module runs DB migrations
3. When Designer module loads:
   - It resolves ComponentLibrarySDK from DI (already registered by comp-lib)
   - It resolves AIServiceSDK from DI (already registered by ai-service)
   - It injects these into its DesignerService
```

```typescript
// modules/designer/index.ts
import type { ModuleEntry } from '@openpcb/core/contracts';
import type { ComponentLibrarySDK } from '@openpcb/sdks/component-library';
import type { AIServiceSDK } from '@openpcb/sdks/ai-service';
import { DesignerService } from './backend/application/sdk-implementation';

export default {
  name: 'designer',

  async register(ctx) {
    const compLib = ctx.resolve<ComponentLibrarySDK>('ComponentLibrarySDK');
    const ai = ctx.resolve<AIServiceSDK>('AIServiceSDK');
    const db = ctx.resolve('db');

    const service = new DesignerService(compLib, ai, db);
    ctx.register('DesignerSDK', () => service);

    // Register HTTP handlers
    ctx.router.mount('/api/v1/designer', createDesignerRoutes(service));

    // Register AI tools
    ctx.tools.register(designerTools(service));
  },

  async migrate(ctx) {
    await ctx.db.runMigrations('./modules/designer/backend/db/migrations');
  }
} satisfies ModuleEntry;
```

---

## Frontend module loading

```typescript
// core/frontend/router/module-routes.ts
// Collects routes from all module manifests (fetched from backend registry)

export function buildModuleRoutes(registry: ModuleRegistry): Route[] {
  return registry.modules.flatMap(mod => 
    mod.frontend.routes.map(route => ({
      path: route.path,
      moduleId: mod.name,
      screen: route.screen,
      // Lazy-loaded from modules/<id>/frontend/routes.ts
      component: lazy(() => import(`@openpcb/modules/${mod.name}/frontend/routes`))
    }))
  );
}
```

Each module exports its route components:

```typescript
// modules/designer/frontend/routes.ts
import { SchematicEditor } from './screens/SchematicEditor';
import { PCBEditor } from './screens/PCBEditor';

export const routes = {
  SchematicEditor,
  PCBEditor,
};
```

---

## Key architectural improvements over current state

### 1. Designer domain extracted from core/
**Before**: `core/backend/designer/` — business logic inside infrastructure.  
**After**: `modules/designer/backend/domain/` — business logic inside its module.  
The ECS engine and command pattern are in `shared/`, the designer-specific handlers are in the module.

### 2. Frontend/backend coupling broken
**Before**: `core/frontend/designer/` imports directly from `core/backend/designer/application/*`.  
**After**: Frontend imports only from `sdks/designer/` (pure interfaces) and `shared/` (domain primitives).  
In-memory bridge for standalone mode uses shared test utilities.

### 3. SDK contracts separated from implementations
**Before**: No clear SDK boundary — everything in core.  
**After**: `sdks/designer/index.ts` defines the interface, `modules/designer/backend/application/sdk-implementation.ts` implements it. Clean substitution boundary.

### 4. Module loading is symmetric
**Before**: Backend uses manifest-aware loading, frontend uses convention-based glob.  
**After**: Both frontend and backend resolve from `MODULE_MANIFEST.json`. Frontend routes come from manifest, lazy-loaded by screen name.

### 5. Canvas engine is shared
**Before**: `core/frontend/src/editor-canvas/` — sits in core but is domain-specific.  
**After**: `shared/frontend/canvas/` — explicitly shared, used by both designer and component-library modules.

---

## Module manifest format

```jsonc
// modules/designer/MODULE_MANIFEST.json
{
  "name": "designer",
  "version": "1.0.0",
  "description": "Schematic and PCB design editor",
  
  // Dependency order — these modules must load first
  "dependencies": ["component-library", "ai-service"],
  
  // Backend entry
  "backend": {
    "entry": "./index.ts",
    "apiPrefix": "/api/v1/designer"
  },

  // Frontend entry
  "frontend": {
    "entry": "./frontend/routes.ts",
    "routes": [
      { "path": "/schematic/:projectId", "screen": "SchematicEditor" },
      { "path": "/pcb/:projectId", "screen": "PCBEditor" }
    ],
    "navigation": {
      "label": "Designer",
      "icon": "circuit-board",
      "order": 1
    }
  },

  // Database tables this module owns
  "tables": ["projects", "entities", "net_members", "command_log"],

  // AI-callable tools
  "tools": [
    {
      "name": "place_component",
      "description": "Place a component on the schematic",
      "parameters": { "libraryRef": "string", "x": "number", "y": "number" }
    },
    {
      "name": "run_drc",
      "description": "Run design rule check on the PCB",
      "parameters": { "projectId": "string" }
    }
  ]
}
```

---

## TypeScript path aliases

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "paths": {
      "@openpcb/core/*":    ["./core/*"],
      "@openpcb/shared/*":  ["./shared/*"],
      "@openpcb/sdks/*":    ["./sdks/*"],
      "@openpcb/modules/*": ["./modules/*"]
    }
  }
}
```

---

## Boundary enforcement (ESLint)

```javascript
// eslint.config.ts (eslint-plugin-boundaries)
{
  rules: {
    'boundaries/element-types': ['error', {
      default: 'disallow',
      rules: [
        // core/ imports nothing app-specific
        { from: 'core',    allow: ['core'] },
        // shared/ imports only core/
        { from: 'shared',  allow: ['shared', 'core'] },
        // sdks/ imports only shared/
        { from: 'sdks',    allow: ['sdks', 'shared'] },
        // modules/ imports shared/ + sdks/ (but NOT other modules' internals)
        { from: 'modules', allow: ['modules-own', 'shared', 'sdks'] },
        // electron/ imports nothing from src
        { from: 'electron', allow: ['electron'] },
      ]
    }]
  }
}
```

---

## Open decisions for next session

1. **SDK transport** — Should in-process SDKs use direct function calls or go through HTTP loopback? (Direct calls recommended for desktop app.)

2. **Frontend SDK pattern** — Should React-side SDK calls go through HTTP API or shared Zustand stores? (HTTP keeps modules decoupled; stores are faster for real-time.)

3. **ECS storage granularity** — Components as one JSON blob per entity (simpler) vs separate rows per component type (faster queries)?

4. **Module hot-loading** — Should modules be loadable/unloadable at runtime for a future plugin marketplace?

5. **Shared canvas ownership** — Should `shared/frontend/canvas/` be a standalone package with its own tests and release cycle, or just a folder?

6. **Settings/preferences** — Where does the settings UI live? `core/frontend/` (shell-level) or a separate module?
