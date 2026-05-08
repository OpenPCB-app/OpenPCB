# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenPCB — desktop PCB design suite. Bun HTTP backend + React 19/Vite 7/Tailwind 4 frontend + Electron shell + SQLite (Drizzle ORM). Root uses **npm workspaces**; backend uses Bun runtime + Bun test; root-level lockfile is `bun.lock` (kept for tooling) but installs go through npm.

Branch `aggresive-cleanup` is mid-restructuring. Most paths have been migrated to `src/core/*`, `src/modules/*`, `src/sdks/*`, `src/shared/*`, but a few stale references remain in `bunfig.toml` and some scripts. **Verify paths before running unfamiliar scripts.**

## Commands

Run from repo root unless noted.

**Dev**

- `npm run dev` — backend (Bun) + frontend (Vite), browser mode
- `npm run dev:electron` — backend + frontend + Electron shell (waits on `http://127.0.0.1:1420`)
- `npm run dev:backend` — Bun backend only (`src/core/backend/main.ts`, port 3000, `--watch`)
- `npm run dev:frontend` — Vite dev server only (port 1420, proxies `/api` and `/ws` → 3000)

**Build / check**

- `npm run build` — bun sidecar compile + frontend bundle + electron build + dist
- `npm run typecheck` — `tsc -b` over composite project (core/backend, core/frontend, modules)
- `npm run lint` — misnomer: runs `tsc --noEmit` in `src/core/frontend` (no ESLint wired). Same effect as typecheck for the frontend workspace.

**Tests**

- Backend (Bun): `npm run test:backend` → `npm run test --workspace src/core/backend` → `bun test`
- Frontend (Vitest): `npm run test:react` → `npm run test --workspace src/core/frontend` → `vitest run`
- Single backend test: `cd src/core/backend && bun test tests/<file>.test.ts`
- Single frontend test: `cd src/core/frontend && npx vitest run path/to/file.test.tsx`
- E2E: `npm run test:e2e` — Playwright (Chrome). `npm run dev:browser` opens Playwright UI against the dev backend.

**Modules / codegen**

- `npm run module` — interactive module CLI (`scripts/module-cli.ts`)
- `npm run module:validate` / `npm run module:codegen` / `npm run modules:generate`
- `npm run gen` — alias for `module:codegen` only (does **not** chain `gen:openapi` or `gen:sdk:orval`; run those separately if needed). `npm run gen:check` fails if `src/core/frontend/src/generated/` is dirty.
- `npm run db:generate|push|studio|check` — Drizzle Kit. `db:migrate` is a no-op message; module SQL migrations are applied automatically on backend startup.

## Architecture

Layered architecture per `docs/PROPOSED_ARCHITECTURE.md`. Import direction:

```
electron/  →  core/backend (spawned as child)
modules/*  →  sdks/ + shared/  →  core/
```

Layer rules (ESLint not yet wired):

- `core/` — pure infrastructure: HTTP, router, module-loader, app shell, DB factory, error contracts. **Zero business logic.**
- `shared/` — canvas engine, ECS world, command/patch infrastructure, shared types. Used by modules.
- `sdks/` — pure interfaces + public types between modules (`@sdks/library`, `@sdks/designer`). No implementations.
- `modules/*` — self-contained vertical slices (backend + frontend + DB schema + domain logic).

### Layout

```
src/
├── core/
│   ├── backend/        Bun HTTP runtime, module loader, router (own workspace)
│   │   ├── main.ts     entry — boots ModuleRuntime then createHttpServer
│   │   ├── http/       server, CORS, middleware, problem-details
│   │   ├── router/     HttpRouter, ModuleRouter, route matcher, registry
│   │   ├── modules/    module-loader.ts, manifest-discovery.ts, sdk-registry.ts
│   │   ├── db/         sqlite-client, module-db-factory, transaction-runner
│   │   ├── migrations/ module-migrator (per-module SQL migrations)
│   │   ├── controllers/ health, diagnostics
│   │   ├── contracts/  AppError hierarchy
│   │   ├── diagnostics/ error buffer + store
│   │   ├── logging/    JSON structured logger
│   │   └── tests/      Bun test suite (designer-commands, designer-pcb, library-integration, …)
│   ├── frontend/       React 19 + Vite 7 + Tailwind 4 (own workspace)
│   │   └── src/        App → RuntimeProvider → BootstrapProvider → ThemeProvider → AppShell → AppRouter
│   └── contracts/      app/* (runtime, bootstrap, routes) + modules/* (manifest, backend-module, sdk facades)
├── modules/
│   ├── library/        component library: symbols, footprints, KiCad import, seeding
│   └── designer/       schematic + PCB editor (commands, history, projection, ECS world, store, wire-geometry, pcb/)
│       └── backend/migrations/0000…0004_pcb_foundation.sql
├── sdks/               public inter-module contracts
│   ├── index.ts        MODULE_SDK_TOKENS = { LIBRARY, DESIGNER }
│   ├── library/        types.ts, index.ts
│   └── designer/       types.ts, events.ts, index.ts
└── shared/
    ├── backend/        ECS world, command/patch/history infrastructure
    └── frontend/canvas/ canvas engine + theme-aware layers

electron/               Electron main + preload + backend-manager (separate workspace)
scripts/                module-cli.ts, gen-modules.ts, gen-sdk.ts, generate-openapi.ts, compile-bun-sidecar.ts
docs/                   PROPOSED_ARCHITECTURE.md, COMMAND_PATTERN.md, DATA_MODEL.md
tests/e2e/              Playwright E2E tests
```

### Module system

`ModuleRuntime` (`src/core/backend/modules/module-loader.ts`) drives boot:

1. `discoverModuleManifests(workspaceRoot)` walks `<workspaceRoot>/modules/*`. Default workspaceRoot = `path.resolve(import.meta.dir, "../../..")` from `src/core/backend/modules/` → resolves to `src/`, so discovery searches `src/modules/`. Override with `OPENPCB_WORKSPACE_ROOT` if needed.
2. Validates + normalizes manifests (`id`, `namespace`, `apiVersion: 2`, `sidebar`, `dependsOn`).
3. Topological sort with cycle detection, resolves `dependsOn` (e.g., `designer` depends on `library`).
4. Per module: applies `backend/migrations/*.sql` → dynamic-imports `module.backend.ts` → expects `ModuleDefinition` export (`definition`, `default`, or `backendModule`).
5. Lifecycle: `onActivate → registerSdk → registerRoutes(router, ctx)`.
6. SDKs registered in `RuntimeSdkRegistry` keyed by `MODULE_SDK_TOKENS`; routes mounted in `ModuleRouterRegistry`.

**Module route URL pattern:** `/api/modules/{moduleId}/{subpath}` — registry rewrites URL to just `{subpath}` before dispatching to the module's router.

**Module manifest schema:** `id` (kebab-case), `label`, `namespace` (dot-separated), `version`, `apiVersion: 2`, `kind: "space"|"tool"`, `sidebar: { label, icon (Lucide name), order, group? }`, `runtime: { backendEntry?, frontendEntry? }`, `dependsOn: [{ id, minVersion?, optional? }]`, optional `defaultPinned`.

**Module definition contract** (`src/core/contracts/modules/backend-module.ts`):

```typescript
interface ModuleDefinition {
  id: string;
  onActivate?(ctx: CoreBackendModuleContext): Promise<void> | void;
  registerSdk?(ctx: CoreBackendModuleContext): Promise<void> | void;
  registerRoutes?(
    router: ModuleRouterHandle,
    ctx: CoreBackendModuleContext,
  ): Promise<void> | void;
}
```

Context: `moduleId`, `manifest`, `db` (prefixed SQLite via Drizzle, e.g., tables prefixed `library_` / `designer_`), `sdk` (RuntimeSdkRegistry), `logger`.

### Frontend module loading

`src/core/frontend/src/components/ModuleSpaceHost.tsx` uses `import.meta.glob` to discover `module.frontend.ts` files. Each exports `{ manifest, Space }` where `Space` is a lazy React component receiving `{ moduleId, namespace, backendURL }`. Navigation is **Zustand-based** (`useNavigationStore`), no React Router.

### Backend HTTP stack

Boot: `main.ts` → `ModuleRuntime.bootstrap()` → `createHttpServer()` → `Bun.serve()`.

Middleware chain: requestId → logging → CORS → error handler.

Built-in routes:

- `GET /api/health` → `{ ok: true, data: { status: "ok" } }`
- `GET /api/diagnostics` → error stats (ring buffer, last 100)
- `GET /api/modules/registry` → module list for frontend

Errors use **RFC 7807 problem-details** (`application/problem+json`). `AppError` subclasses: `ValidationError` (400), `NotFoundError` (404), `MethodNotAllowedError` (405). Custom problem types prefixed `https://openpcb.dev/problems/`.

### Database

Single SQLite file via Bun native driver + Drizzle ORM. Each module gets a `DrizzleModuleDbClient` with `tablePrefix`. Migrations are `.sql` files in `<module>/backend/migrations/`, tracked in `openpcb_migrations` table, applied transactionally with `BEGIN IMMEDIATE`.

Path resolution: `OPENPCB_DB_PATH` env → dev: `dev-data/openpcb.sqlite` → prod: `~/.openpcb/data.sqlite`.

### Designer command pattern

See `docs/COMMAND_PATTERN.md`, `docs/DATA_MODEL.md`. Designer backend (`src/modules/designer/backend/`) implements:

- ECS world (entities/components) persisted as JSON blobs (decision locked in `TODO.md`)
- Command flow: `CommandEnvelope` → idempotency check (command log) → load `DesignWorld` → validate `baseRevision` → command-bus dispatch → handler plans patches → apply → persist → publish invalidation → return `CommandResult`
- Patches/inverse via `shared/backend` ECS + patch infrastructure → enables undo/redo
- Reads via `SchematicProjection` (`projection-read.ts`, `projection-world.ts`)
- Per-session undo/redo persisted across runtime reloads (`history-persistence.ts`, `history-state.ts`)
- PCB foundation in progress (Phase 3): board settings, placements auto-synced from schematic, traces/vias/ratsnest pending

Files: `command-executor.ts`, `commands/`, `history-*.ts`, `projection-*.ts`, `store.ts`, `wire-geometry.ts`, `pcb/`.

### Dev ports / proxy

- Backend: `127.0.0.1:3000` (env: `PORT`, `HOST`)
- Frontend: `127.0.0.1:1420`, proxies `/api` and `/ws` to backend
- Electron waits on `http-get://127.0.0.1:1420` before launching

## Environment variables

| Variable                    | Default                         | Purpose                                                   |
| --------------------------- | ------------------------------- | --------------------------------------------------------- |
| `PORT`                      | 3000                            | Backend server port                                       |
| `HOST`                      | 127.0.0.1                       | Backend bind address                                      |
| `OPENPCB_DB_PATH`           | `dev-data/openpcb.sqlite` (dev) | SQLite database path                                      |
| `OPENPCB_WORKSPACE_ROOT`    | derived from `import.meta.dir`  | Module discovery root (defaults to repo `src/`)           |
| `OPENPCB_ALLOWED_ORIGINS`   | localhost:1420, :3000, tauri    | Comma-separated CORS origins                              |
| `OPENPCB_DEBUG_DIAGNOSTICS` | false                           | Enable `/api/diagnostics/debug/modules` endpoint          |
| `NODE_ENV`                  | —                               | `development` for dev; suppresses request logging in test |

## TypeScript

- Composite build via `tsconfig.json` referencing `src/core/backend/tsconfig.json`, `src/core/frontend/tsconfig.json`, `src/core/frontend/tsconfig.node.json`, `tsconfig.modules.json`.
- `tsconfig.modules.json` covers `src/modules/**`, `src/shared/**`, `src/sdks/**`, `src/core/contracts/**` (noEmit, jsx).
- `tsconfig.base.json`: strict, ES2022 target, bundler `moduleResolution`, `noUncheckedIndexedAccess`, `noImplicitOverride`.
- Path aliases (root tsconfig.base + frontend tsconfig.modules):
  - `@modules/*` → `src/modules/*`
  - `@sdks/*` → `src/sdks/*`
  - `@shared/*` → `src/shared/*`
  - `@/*` → `src/core/frontend/src/*` (frontend only)
- Frontend Vite aliases mirror these; verify in `src/core/frontend/vite.config.ts` when adding new aliases.

## Open infra TODOs

- ESLint boundary-enforcement rules are not yet wired (`TODO.md` Backlog). Module → core imports are caught by review only.
- Frontend Vitest `include` is scoped to `src/core/frontend/src/**`; pure-logic frontend reducers tested under Bun (e.g. `src/core/backend/tests/route-tool-state.test.ts`) live with the backend test suite.

When editing, always use the `src/core/*`, `src/modules/*`, `src/sdks/*`, `src/shared/*` prefixes. The pre-restructure `src-ts/`, `src-react/`, root-level `core/`, `modules/`, `sdks/`, `legacy/` directories no longer exist; never reintroduce references to them.

## Skills (slash commands)

Five domain-specific skills are configured in `.claude/skills/`. Use `/skill-name` or let auto-triggers invoke them. Each skill loads detailed reference material — use them instead of guessing EDA conventions.

| Skill                | When to use                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/library`           | Component wizard, symbol/footprint editors, KiCad `.kicad_sym`/`.kicad_mod` import, variant data model, library↔designer linking, built-in component seeding, ComponentPalette/ComponentDetailPage UI                                                                                                                                                          |
| `/schematic-editor`  | Symbol placement, wire routing (Manhattan 90°-only), net labels, pin connections, junction detection, net extraction algorithm, ERC, netlist, tool modes (select/placement/wire/netLabel), undo/redo                                                                                                                                                           |
| `/pcb-layout`        | Trace routing (Manhattan + 45°), via placement (V key layer switch), pad rendering, ratsnest (MST), board outline, component placement, net classes, footprint rendering from KiCad payload, grid presets, Gerber export                                                                                                                                       |
| `/r3f-eda-rendering` | **Any** visual rendering in EDA editors. R3F orthographic + demand rendering (`invalidate()`). Critical rules: never Canvas2D, never `frameloop="always"`, never raw Three.js imperatively, no depthTest. Coordinate pipeline: nanometers (store) → mm (scene) → px (screen). Render order constants. InstancedMesh, LineSegments2, text, hit-testing patterns |
| `/eda-standards`     | IPC-2221B clearance tables, trace width formula/lookup, manufacturer presets (JLCPCB/PCBWay), layer naming (F.Cu/B.Cu/Edge.Cuts), via specs, copper weight, grid standards, 2-layer FR4 stackup, DRC rule values. **Values only, no code patterns**                                                                                                            |

**Skill selection guidance:**

- Modifying any canvas/visual code → `/r3f-eda-rendering` first, then the domain skill (`/schematic-editor` or `/pcb-layout`)
- Working on library module backend/frontend → `/library`
- Need a DRC value, clearance rule, or trace width → `/eda-standards`
- Skills have `references/` subdirs with detailed specs (routing algorithms, hit-testing, net extraction, design rules). The skill loads these automatically.
