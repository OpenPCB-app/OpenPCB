# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OpenPCB — desktop PCB design suite. Bun HTTP backend + React 19/Vite/Tailwind 4 frontend + Electron shell + SQLite (Drizzle). Package manager: **bun** (bun.lock present) at workspace level, but the root uses npm workspaces.

Current branch `aggresive-cleanup` is mid-restructuring. See "Known inconsistencies" below — several npm scripts and configs still reference legacy paths (`src-ts`, `src-react`, `core/backend`, `core/frontend`) that have been moved under `src/core/*` and `src/modules/*`. Verify paths before running scripts.

## Commands

Run from repo root unless noted.

**Dev**

- `npm run dev` — backend (Bun) + frontend (Vite) in browser mode
- `npm run dev:electron` — backend + frontend + electron shell
- `npm run dev:backend` — Bun backend only (`src/core/backend/main.ts`, port 3000)
- `npm run dev:frontend` — Vite dev server (port 1420, proxies `/api` → 3000)

**Build / check**

- `npm run build` — bun sidecar + frontend + electron bundle + dist
- `npm run typecheck` — `tsc -b` over the composite project (references in `tsconfig.json`)
- `npm run lint` — currently only runs `lint` in the frontend workspace if present

**Tests**

- Backend (Bun): `cd src/core/backend && bun test` (root `test:backend` script points at the stale `core/backend` path)
- Frontend (Vitest): `cd src/core/frontend && npx vitest run` (root `test:react` script points at the stale `core/frontend` path; root `vitest.config.ts` also references legacy `src-ts`/`src-react` aliases)
- Single test file: `bun test path/to/file.test.ts` or `npx vitest run path/to/file.test.tsx`
- E2E: `npm run test:e2e` — Playwright, spawns both dev servers via `playwright.config.ts`

**Modules / codegen** (these scripts originate from the legacy tree — inspect before running)

- `npm run module` — interactive module CLI (`scripts/module-cli.ts`)
- `npm run module:validate`, `npm run module:codegen`, `npm run modules:generate`
- `npm run db:generate|migrate|push|studio|check` — Drizzle Kit; note `drizzle.config.ts` still points to `src-ts/src/db/schema` and `modules/*/ts/db/schema.ts` (stale paths)

## Architecture

The codebase follows a layered architecture documented in `docs/PROPOSED_ARCHITECTURE.md`. The **intended** import direction is:

```
electron/  →  core/backend (spawned as child)
modules/*  →  sdks/ + shared/  →  core/
```

Layer rules (ESLint enforcement not yet wired up):

- `core/` — pure infrastructure: HTTP, router, module-loader, app shell. No business logic.
- `shared/` — ECS engine, command bus, patch algebra, canvas engine, shared types. Used by modules.
- `sdks/` — pure interfaces + public types between modules (no implementations).
- `modules/*` — self-contained vertical slices (backend + frontend + DB schema + domain).

### Actual top-level layout

```
src/
├── core/
│   ├── backend/        Bun HTTP runtime, module loader, router
│   │   ├── main.ts     entry — boots ModuleRuntime then createHttpServer
│   │   ├── http/       server, CORS, request context, problem-details
│   │   ├── router/     HttpRouter, ModuleRouter, route matcher, registry
│   │   ├── modules/    module-loader.ts, manifest-discovery.ts, sdk-registry.ts
│   │   ├── db/         sqlite-client, module-db-factory, transaction-runner
│   │   ├── migrations/ module-migrator (runs per-module SQL migrations)
│   │   ├── controllers/ health, diagnostics, module-runtime-diagnostics
│   │   ├── contracts/  backend-local contracts (errors, etc.)
│   │   └── tests/      Bun test suite for router/runtime/health
│   ├── frontend/       React 19 + Vite 7 + Tailwind 4 (own package.json)
│   │   └── src/        App → RuntimeProvider → BootstrapProvider → ThemeProvider → AppShell → AppRouter
│   └── contracts/      app/* (runtime, bootstrap, routes) + modules/* (manifest, backend-module, sdk)
├── modules/
│   └── component-library/   currently the only concrete module
│       ├── manifest.json    required, schema enforced by manifest-discovery
│       ├── module.backend.ts  Bun barrel: exports { manifest, definition }
│       ├── module.frontend.ts
│       └── backend/ frontend/ react/
└── shared/             backend/ + frontend/ shared code (in progress)

electron/               Electron main + preload (separate workspace)
scripts/                module CLI, codegen, bun sidecar compile
docs/                   PROPOSED_ARCHITECTURE.md, COMMAND_PATTERN.md, DATA_MODEL.md
```

### Module system (runtime)

`src/core/backend/modules/module-loader.ts` (`ModuleRuntime`) drives boot:

1. `discoverModuleManifests(workspaceRoot)` walks `modules/*` — **note the loader resolves `workspaceRoot` to `../../..` from its own file, which currently points at `src/core/`, so the discovery directory is `src/core/modules` not `src/modules/`.** Override with `OPENPCB_WORKSPACE_ROOT` or fix the resolution. This is one of the active cleanup gaps.
2. Validates + normalizes manifests (`id`, `namespace`, `apiVersion: 2`, `sidebar`, `dependsOn`).
3. Topologically loads modules, applying `backend/migrations/` per module before `onActivate`.
4. Dynamic-imports the backend barrel (`module.backend.ts`) and expects an exported `ModuleDefinition` (`definition`, `default`, or `backendModule`).
5. Lifecycle: `onActivate → registerSdk → registerRoutes(router, context)`. The returned `ModuleRouter` is added to `ModuleRouterRegistry`, which the HTTP server then mounts.
6. SDKs register into `RuntimeSdkRegistry` so cross-module resolution works without direct imports.

Frontend counterpart lives in `src/core/frontend/src` (providers + AppShell + AppRouter). The frontend fetches the module registry from the backend and lazy-loads module frontends.

### Command pattern / designer domain

The designer domain is being moved out of `core/backend/designer/` into `modules/designer/` (see `docs/COMMAND_PATTERN.md` and `docs/DATA_MODEL.md`). A large number of `src/core/backend/designer/**` files appear as `AD` (added/deleted staged) in the current branch — this is in-progress code. Do not assume paths under `core/backend/designer` are authoritative; prefer the direction described in `docs/PROPOSED_ARCHITECTURE.md`.

Commands flow: frontend builds `CommandEnvelope` → backend use-case checks idempotency → loads canonical `DesignWorld` → validates `baseRevision` → command bus dispatches → handler plans patches → patches applied to world → persisted → invalidation event published → `CommandResult` returned. Reads go through a separate `SchematicProjection`.

### Dev ports / proxy

- Backend: `127.0.0.1:3000` (env: `PORT`, `HOST`)
- Frontend: `127.0.0.1:1420`, proxies `/api` and `/ws` to the backend
- Electron waits on `http-get://127.0.0.1:1420` before launching

## TypeScript

- Composite build via `tsconfig.json` referencing `src/core/backend`, `src/core/frontend`, `src/core/frontend/tsconfig.node.json`.
- `tsconfig.base.json` enables `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`. Path alias: `@modules/*` → `src/modules/*`.
- Frontend Vite adds `@` → `src/core/frontend/src` and `@modules` → `src/modules`.
- `npx tsc` (not global) per user-global rules. Use `bun` when bun.lock exists.

## Known inconsistencies (cleanup branch)

These are broken today and should be fixed rather than worked around silently:

- Root `package.json` `workspaces` lists `src/electron` but the actual dir is `electron/`.
- Many root scripts still reference `src-ts`, `src-react`, `core/backend`, `core/frontend` (e.g. `test:backend`, `test:react`, `db:generate`, `gen:check`, `vitest.config.ts`). Corresponding paths are now under `src/core/*`.
- `ModuleRuntime` workspaceRoot computes to `src/core/` instead of repo root (discovery searches `src/core/modules`, not `src/modules`).
- `bunfig.toml` preloads `./src-ts/test/setup.ts` (no longer exists).

When editing, verify the real path you're operating on and prefer updating stale references over duplicating them.
