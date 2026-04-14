# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenPCB — desktop PCB design suite. Bun HTTP backend + React 19/Vite 7/Tailwind 4 frontend + Electron shell + SQLite (Drizzle ORM). Package manager: **bun** (bun.lock present) at workspace level, root uses npm workspaces.

Branch `aggresive-cleanup` is mid-restructuring. Many npm scripts and configs still reference legacy paths (`src-ts`, `src-react`, `core/backend`, `core/frontend`) — actual code is under `src/core/*` and `src/modules/*`. **Verify paths before running scripts.**

## Commands

Run from repo root unless noted.

**Dev**

- `npm run dev` — backend (Bun) + frontend (Vite) in browser mode
- `npm run dev:electron` — backend + frontend + Electron shell
- `npm run dev:backend` — Bun backend only (`src/core/backend/main.ts`, port 3000)
- `npm run dev:frontend` — Vite dev server (port 1420, proxies `/api` → 3000)

**Build / check**

- `npm run build` — bun sidecar + frontend + electron bundle + dist
- `npm run typecheck` — `tsc -b` over composite project
- `npm run lint` — runs `lint` in frontend workspace if present

**Tests**

- Backend (Bun): `cd src/core/backend && bun test` (root `test:backend` points at stale `core/backend`)
- Frontend (Vitest): `cd src/core/frontend && npx vitest run` (root `test:react` points at stale `core/frontend`)
- Single test file: `bun test path/to/file.test.ts` or `npx vitest run path/to/file.test.tsx`
- E2E: `npm run test:e2e` — Playwright (Chrome), spawns both dev servers

**Modules / codegen** (legacy paths — inspect before running)

- `npm run module` — interactive module CLI (`scripts/module-cli.ts`)
- `npm run module:validate`, `npm run module:codegen`, `npm run modules:generate`
- `npm run gen` — full codegen pipeline (modules → SDK → OpenAPI → orval)
- `npm run db:generate|migrate|push|studio|check` — Drizzle Kit (config has stale paths)

## Architecture

Layered architecture per `docs/PROPOSED_ARCHITECTURE.md`. Import direction:

```
electron/  →  core/backend (spawned as child)
modules/*  →  sdks/ + shared/  →  core/
```

Layer rules (ESLint not yet wired):

- `core/` — pure infrastructure: HTTP, router, module-loader, app shell. **Zero business logic.**
- `shared/` — canvas engine, shared types. Used by modules.
- `sdks/` — pure interfaces + public types between modules (no implementations).
- `modules/*` — self-contained vertical slices (backend + frontend + DB schema + domain).

### Layout

```
src/
├── core/
│   ├── backend/        Bun HTTP runtime, module loader, router
│   │   ├── main.ts     entry — boots ModuleRuntime then createHttpServer
│   │   ├── http/       server, CORS, middleware, problem-details
│   │   ├── router/     HttpRouter, ModuleRouter, route matcher, registry
│   │   ├── modules/    module-loader.ts, manifest-discovery.ts, sdk-registry.ts
│   │   ├── db/         sqlite-client, module-db-factory, transaction-runner
│   │   ├── migrations/ module-migrator (per-module SQL migrations)
│   │   ├── controllers/ health, diagnostics
│   │   ├── contracts/  AppError hierarchy (ValidationError, NotFoundError, etc.)
│   │   ├── diagnostics/ error buffer + store
│   │   ├── logging/    JSON structured logger
│   │   └── tests/      Bun test suite
│   ├── frontend/       React 19 + Vite 7 + Tailwind 4 (own package.json)
│   │   └── src/        App → RuntimeProvider → BootstrapProvider → ThemeProvider → AppShell → AppRouter
│   └── contracts/      app/* (runtime, bootstrap, routes) + modules/* (manifest, backend-module, sdk)
├── modules/
│   └── library/        only concrete module (formerly component-library)
│       ├── manifest.json    schema enforced by manifest-discovery
│       ├── module.backend.ts  barrel: exports { manifest, definition }
│       ├── module.frontend.ts barrel: exports { manifest, Space (lazy) }
│       ├── backend/     index.ts (definition), routes.ts, queries.ts, schema.ts, seed.ts, migrations/, import/
│       └── frontend/    Space.tsx
└── shared/
    ├── backend/         (placeholder)
    └── frontend/canvas/ canvas engine

electron/               Electron main + preload + backend-manager (separate workspace)
scripts/                module CLI, codegen, bun sidecar compile
docs/                   PROPOSED_ARCHITECTURE.md, COMMAND_PATTERN.md, DATA_MODEL.md
tests/e2e/              Playwright E2E tests
```

### Module system

`ModuleRuntime` (`src/core/backend/modules/module-loader.ts`) drives boot:

1. `discoverModuleManifests(workspaceRoot)` walks `modules/*` — **the loader resolves `workspaceRoot` to `../../..` from its own file, landing at `src/core/`, so discovery searches `src/core/modules` not `src/modules/`.** Override with `OPENPCB_WORKSPACE_ROOT` env var. Active cleanup gap.
2. Validates + normalizes manifests (`id`, `namespace`, `apiVersion: 2`, `sidebar`, `dependsOn`).
3. Topological sort with cycle detection, resolves `dependsOn`.
4. Per module: applies `backend/migrations/*.sql` → dynamic-imports `module.backend.ts` → expects `ModuleDefinition` export (`definition`, `default`, or `backendModule`).
5. Lifecycle: `onActivate → registerSdk → registerRoutes(router, ctx)`.
6. SDKs go into `RuntimeSdkRegistry`; routes into `ModuleRouterRegistry`.

**Module route URL pattern:** `/api/modules/{moduleId}/{subpath}` — the registry rewrites URL to just the subpath before dispatching to the module's router.

**Module manifest schema:** `id` (kebab-case), `label`, `namespace` (dot-separated), `version`, `apiVersion: 2`, `kind: "space"|"tool"`, `sidebar: { label, icon (Lucide name), order, group? }`, `runtime: { backendEntry?, frontendEntry? }`, `dependsOn: [{ id, minVersion?, optional? }]`.

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

Context provides: `moduleId`, `manifest`, `db` (prefixed SQLite via Drizzle), `sdk` (RuntimeSdkRegistry), `logger`.

### Frontend module loading

Frontend uses `import.meta.glob("../../../../modules/*/module.frontend.ts")` to discover modules. Each `module.frontend.ts` exports `{ manifest, Space }` where `Space` is a lazy React component receiving `{ moduleId, namespace, backendURL }`. Navigation is Zustand-based (`useNavigationStore`), no React Router.

### Backend HTTP stack

Boot: `main.ts` → `ModuleRuntime.bootstrap()` → `createHttpServer()` → `Bun.serve()`.

Middleware chain: requestId → logging → CORS → error handler.

Built-in routes:

- `GET /api/health` → `{ ok: true, data: { status: "ok" } }`
- `GET /api/diagnostics` → error stats (ring buffer, last 100)
- `GET /api/modules/registry` → module list for frontend

Errors use **RFC 7807 problem-details** (`application/problem+json`). `AppError` subclasses: `ValidationError` (400), `NotFoundError` (404), `MethodNotAllowedError` (405). Custom types prefixed `https://openpcb.dev/problems/`.

### Database

Single SQLite file via Bun native driver + Drizzle ORM. Each module gets a `DrizzleModuleDbClient` with `tablePrefix` (e.g., `library_`). Migrations are `.sql` files in `backend/migrations/`, tracked in `openpcb_migrations` table, applied transactionally with `BEGIN IMMEDIATE`.

Path resolution: `OPENPCB_DB_PATH` env → dev: `dev-data/openpcb.sqlite` → prod: `~/.openpcb/data.sqlite`.

### Command pattern / designer domain

Designer domain being moved from `core/backend/designer/` into `modules/designer/` (see `docs/COMMAND_PATTERN.md`, `docs/DATA_MODEL.md`). Do not assume paths under `core/backend/designer` are authoritative.

Flow: `CommandEnvelope` → idempotency check → load `DesignWorld` → validate `baseRevision` → command bus dispatch → handler plans patches → apply → persist → publish invalidation → return `CommandResult`. Reads via `SchematicProjection`.

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
| `OPENPCB_WORKSPACE_ROOT`    | (derived from import.meta.dir)  | Module discovery root — set to repo root to fix discovery |
| `OPENPCB_ALLOWED_ORIGINS`   | localhost:1420, :3000, tauri    | Comma-separated CORS origins                              |
| `OPENPCB_DEBUG_DIAGNOSTICS` | false                           | Enable `/api/diagnostics/debug/modules` endpoint          |
| `NODE_ENV`                  | —                               | `development` for dev; suppresses request logging in test |

## TypeScript

- Composite build via `tsconfig.json` referencing `src/core/backend`, `src/core/frontend`, `src/core/frontend/tsconfig.node.json`.
- `tsconfig.base.json`: strict, ES2022 target, bundler moduleResolution, `noUncheckedIndexedAccess`, `noImplicitOverride`. Path alias: `@modules/*` → `src/modules/*`.
- Frontend Vite aliases: `@` → `src/core/frontend/src`, `@modules` → `src/modules`.

## Known inconsistencies (cleanup branch)

Fix these rather than working around silently:

- Root `package.json` `workspaces` lists `src/electron` but actual dir is `electron/`.
- Many root scripts reference `src-ts`, `src-react`, `core/backend`, `core/frontend` (e.g. `test:backend`, `test:react`, `db:generate`, `gen:check`, `build:frontend`). Real paths are `src/core/*`.
- `ModuleRuntime` workspaceRoot resolves to `src/core/` instead of repo root (discovery searches `src/core/modules`, not `src/modules`).
- `drizzle.config.ts` schema paths point to `src-ts/src/db/schema` and `modules/*/ts/db/schema.ts` (stale).
- `bunfig.toml` preloads `./src-ts/test/setup.ts` (no longer exists).

When editing, verify the real path and prefer updating stale references over duplicating them.

## Skills (slash commands)

Five domain-specific skills are configured in `.claude/skills/`. Use `/skill-name` or let auto-triggers invoke them. Each skill loads detailed reference material — use them instead of guessing EDA conventions.

| Skill                | When to use                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/component-library` | Component wizard, symbol/footprint editors, KiCad `.kicad_sym`/`.kicad_mod` import, variant data model, library↔designer linking, built-in component seeding, ComponentPalette/ComponentDetailPage UI                                                                                                                                                          |
| `/schematic-editor`  | Symbol placement, wire routing (Manhattan 90°-only), net labels, pin connections, junction detection, net extraction algorithm, ERC, netlist, tool modes (select/placement/wire/netLabel), undo/redo                                                                                                                                                           |
| `/pcb-layout`        | Trace routing (Manhattan + 45°), via placement (V key layer switch), pad rendering, ratsnest (MST), board outline, component placement, net classes, footprint rendering from KiCad payload, grid presets, Gerber export                                                                                                                                       |
| `/r3f-eda-rendering` | **Any** visual rendering in EDA editors. R3F orthographic + demand rendering (`invalidate()`). Critical rules: never Canvas2D, never `frameloop="always"`, never raw Three.js imperatively, no depthTest. Coordinate pipeline: nanometers (store) → mm (scene) → px (screen). Render order constants. InstancedMesh, LineSegments2, text, hit-testing patterns |
| `/eda-standards`     | IPC-2221B clearance tables, trace width formula/lookup, manufacturer presets (JLCPCB/PCBWay), layer naming (F.Cu/B.Cu/Edge.Cuts), via specs, copper weight, grid standards, 2-layer FR4 stackup, DRC rule values. **Values only, no code patterns**                                                                                                            |

**Skill selection guidance:**

- Modifying any canvas/visual code → `/r3f-eda-rendering` first, then the domain skill (`/schematic-editor` or `/pcb-layout`)
- Working on library module backend/frontend → `/component-library`
- Need a DRC value, clearance rule, or trace width → `/eda-standards`
- Skills have `references/` subdirs with detailed specs (routing algorithms, hit-testing, net extraction, design rules). The skill loads these automatically.
