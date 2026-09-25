# OpenPCB — Developer Guide

Architecture, running from source, and the internals reference. This is the single human-facing
architecture document for the repo: if a fact about how OpenPCB is built belongs anywhere, it
belongs here.

- PR process, conventions and the pre-PR checklist → [`CONTRIBUTING.md`](CONTRIBUTING.md)
- User-facing overview and downloads → [`README.md`](README.md)
- What is shipped and what is planned → [`ROADMAP.md`](ROADMAP.md)
- Agent instructions and the invariants an automated contributor needs →
  [`CLAUDE.md`](CLAUDE.md), which points back here for everything a human and an agent need
  identically

## Tech stack

| Layer         | Choice                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| Desktop       | Electron (backend hosted in the main process)                                          |
| Backend       | Bun HTTP server, RFC 7807 problem-details, JSON structured logging                     |
| Database      | SQLite via Drizzle ORM, one file, per-module table prefixes                            |
| Frontend      | React 19, Vite 7, Tailwind 4, Zustand, Radix UI, Lucide icons                          |
| Rendering     | React Three Fiber + three.js, orthographic camera, demand rendering                    |
| Geometry      | `polygon-clipping`, in-house Manhattan / 45° routers, MST ratsnest                     |
| 3D import     | `occt-import-js` (STEP → GLB) in a Web Worker                                          |
| Tests         | Bun Test (backend), Vitest (frontend), Playwright (e2e, Chromium)                      |
| Observability | Sentry (`@sentry/electron`, `@sentry/react`, `@sentry/node`) — opt-in, off by default   |
| Packaging     | `electron-builder` → dmg/zip (mac), Setup.exe + nupkg (win), deb/rpm/AppImage (linux)  |

Packaging is **electron-builder**, not Electron Forge. Older notes in the repo history say Forge;
they are wrong.

## Layer model

OpenPCB enforces one-way layer dependencies:

```
electron/  ──►  core/backend (started in-process by Electron main)

modules/*  ──►  sdks/ + shared/  ──►  core/
```

| Layer       | Responsibility                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `core/`     | Pure infrastructure: HTTP server, router, module loader, DB factory, error contracts. No business logic. |
| `shared/`   | ECS world, command/patch infrastructure, canvas engine, geometry, DRC and routing primitives, UI primitives. |
| `sdks/`     | Pure inter-module contracts — interfaces and types only, no implementations.                        |
| `modules/*` | Self-contained vertical slices: manifest + backend + frontend + migrations + domain logic.          |
| `electron/` | OS shell: windows, IPC, protocol handling, updater, lifecycle, MCP shim.                             |

A module must not import `src/core/backend/*` or `src/core/frontend/*` — go through
`src/core/contracts/*`, `src/sdks/*` and `src/shared/*`. Modules must not import each other
directly either; cross-module access goes through an SDK token. **Nothing enforces this at build
time yet** — ESLint boundary rules are not wired, so it is caught in review.

### Repository layout

```
src/
├── core/
│   ├── backend/        Bun HTTP runtime, module loader, router, DB (own workspace)
│   ├── frontend/       React + Vite + Tailwind (own workspace)
│   └── contracts/      app/* + modules/* contracts + feature-flags/
├── modules/            assistant · designer · knowledge · library · tasks
├── sdks/               public inter-module contracts
└── shared/
    ├── domain/             ECS world, commands, events, revision, patch/history
    ├── drc/                shared DRC primitives
    ├── pcb-geometry/       PCB geometry
    ├── pcb-routing/        PCB routing
    ├── schematic-routing/  schematic wire routing
    ├── rendering/          re-export shim over @openpcb/rendering-core (see below)
    └── frontend/           canvas engine, context menu, UI primitives
electron/               Electron main + preload + MCP shim (separate workspace)
scripts/                module CLI, codegen, tooling
docs/                   designer notes, DRC open findings, proposals, design notes
tests/e2e/              Playwright
```

`src/shared/` has seven subtrees, listed above. There is no `src/shared/backend/`.

### Re-export shims

Parts of the tree are **thin re-export shims over published `@openpcb/*` packages**. Editing them
changes nothing at runtime — the behaviour lives in the sibling `shared/` repo, consumed here via
per-package GitHub tags.

| Package                   | Shimmed at                                                                                                              | Owns                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `@openpcb/rendering-core` | `src/shared/rendering/*`, `src/shared/frontend/canvas/defaults.ts`                                                       | render-model builders, IPC-7351B generator, parametric footprints, KLC constants |
| `@openpcb/kicad-import`   | `src/modules/library/backend/import/*`, `.../infrastructure/parsers/kicad/*`                                             | KiCad → normalized library shape, validation, heuristics, 3D linking      |
| `@openpcb/opclib-pack`    | `src/modules/library/backend/sync/{opclib-reader,canonical-json,types}.ts`, `.../import/archive/extract-zip.ts`          | `.opclib` pack/unpack, canonical JSON, ZIP extraction, manifest validation |
| `@openpcb/step-to-glb`    | `src/modules/library/frontend/three-d/*`                                                                                 | STEP → GLB conversion in a Web Worker                                    |
| `@openpcb/kicad-parsers`  | imported directly, no shim                                                                                               | KiCad s-expression / symbol / footprint parsers                          |
| `@openpcb/r3f-eda-canvas` | installed but **not integrated** — `src/shared/frontend/canvas/` is still in-tree                                        | R3F canvas engine, primitives, scene renderers                           |

To change any of that behaviour, change it in the `shared/` repo, publish a tag and re-pin here.
For local iteration against a sibling checkout: `npm run shared:link`, `npm run shared:status`,
`npm run shared:unlink`.

## Modules

| Module      | Kind  | Depends on | Scope                                                                            |
| ----------- | ----- | ---------- | -------------------------------------------------------------------------------- |
| `library`   | space | —          | component catalog: symbols, footprints, KiCad import, built-in seeding, 3D models |
| `designer`  | space | `library`  | schematic + PCB editor: commands, history, projections, ECS world, DRC, export    |
| `knowledge` | space | —          | documentation pages: rich-text editor and tree, PDF-as-page, text/markdown import |
| `tasks`     | tool  | —          | task tracking and SSE progress                                                    |
| `assistant` | space | `tasks`    | AI assistant (OpenAI / Ollama / LM Studio providers); hosts the MCP server        |

`designer` declares a required dependency on `library`.

### Module system

`ModuleRuntime` (`src/core/backend/modules/module-loader.ts`) drives boot:

1. Discover manifests under `<workspaceRoot>/modules/*`. `workspaceRoot` resolution is a
   three-candidate fallback — the module directory's `../../..`, then `process.cwd()/src`, then
   `process.cwd()`. Set `OPENPCB_WORKSPACE_ROOT` only when running from an unusual working
   directory; the default finds `src/modules` in a normal checkout.
2. Validate and normalize each manifest (`id`, `namespace`, `apiVersion: 2`, `sidebar`,
   `dependsOn`).
3. Topological sort with cycle detection, resolving `dependsOn`.
4. Per module: apply `backend/migrations/*.sql`, then dynamic-import `module.backend.ts` and expect
   a `ModuleDefinition` export (`definition`, `default` or `backendModule`).
5. Lifecycle: `onActivate` → `registerSdk` → `registerRoutes(router, ctx)`.
6. SDKs land in the `RuntimeSdkRegistry` keyed by `MODULE_SDK_TOKENS`; routes land in the
   `ModuleRouterRegistry`.

The module context carries `moduleId`, `manifest`, `db` (a prefixed SQLite client via Drizzle —
tables are prefixed `library_`, `designer_`, …), `sdk` and `logger`.

### Module HTTP routing

- Module routes are mounted at `/api/modules/{moduleId}/{subpath}`; the registry rewrites the URL to
  `{subpath}` before dispatching to the module's own router.
- Core routes: `GET /api/health`, `GET /api/diagnostics`, `GET /api/modules/registry`. The registry
  route is a core route, not module dispatch.
- Errors are `application/problem+json` (RFC 7807), with custom problem types prefixed
  `https://openpcb.dev/problems/`.

### Frontend module loading

`ModuleSpaceHost.tsx` uses `import.meta.glob` to discover `module.frontend.ts` files. Each exports
`{ manifest, Space }`, where `Space` is a lazy React component receiving
`{ moduleId, namespace, backendURL }`. Navigation is Zustand-based (`useNavigationStore`) — there is
no React Router.

### SDK dependency injection

- Consume another module's SDK with `ctx.sdk.get<T>(MODULE_SDK_TOKENS.LIBRARY)`.
- Publish your own in the `registerSdk()` hook.
- The frontend consumes **generated** typed stubs at `src/core/frontend/src/generated/sdk/`.
  Regenerate with `npm run sdk:generate` (or `npm run gen`) and commit the result.

## Designer internals

### The command pattern

Every designer mutation flows through a `CommandEnvelope`
(`{ commandId, sessionId, aggregateId, baseRevision, issuedAt, command }`):

```
CommandEnvelope
  → idempotency check (command log; a duplicate commandId is rejected)
  → load DesignWorld (ECS)
  → validate baseRevision (REVISION_CONFLICT on mismatch)
  → command-bus dispatch
  → handler plans patches
  → apply + persist
  → publish invalidation
  → CommandResult (with the inverse patch, which is what makes undo possible)
```

Reads go through projections (`projection-read.ts`, `projection-world.ts`). PCB placements are
auto-synced from schematic changes. Per-session undo/redo is persisted across runtime reloads.

Two rules when adding a command: the `DesignerCommand` union in `src/sdks/designer/types.ts` must
gain an entry, and every command field needs a parser entry in the module's `routes.ts` — **a field
with no parser is silently dropped over HTTP**.

### The data model, in brief

- The designer world is an **ECS** (entities + components) persisted as JSON blobs in
  `designer_`-prefixed tables. There is no relational schema per entity type.
- **Nets are not persisted.** There is no nets table; net names and junctions are rebuilt on every
  projection by a union-find over exact integer-nanometre coordinates. Net ids are therefore
  *ephemeral* — they change when a part moves or a wire is added. Never persist a net id. Key
  persisted data on the placement/pad pair or the pin id instead; for named nets, the upper-cased
  net **name** is the durable cross-edit identifier.
- Board settings are stored as **one JSON blob**, so adding a field needs no migration — but it
  still needs a command field, a parser entry and a UI surface.
- In the library module, a component takes N footprints through a join table; identity is the
  footprint's own id and there is no separate "variant" entity, despite the word appearing in the
  UI copy.

Deeper invariants — net identity in full, pad addressing, DRC extension points, courtyard
provenance, headless harnesses — are in [`src/modules/designer/AGENTS.md`](src/modules/designer/AGENTS.md)
and [`src/modules/library/AGENTS.md`](src/modules/library/AGENTS.md). Read those before changing
either module's persistence.

### Coordinate contract

**world = nanometres · scene = millimetres · screen = pixels**, with `NM_TO_SCENE = 1_000_000`.

Integer nanometres are the persisted unit everywhere, deliberately: exact boolean polygon
operations, exact transform composition, lossless save and load, and DRC that is deterministic
across machines. Do not introduce floating-point storage units.

Editor rendering is React Three Fiber only — demand rendering with `invalidate()`, no Canvas2D, no
`frameloop="always"`, no imperative three.js scene mutation.

## Database

One SQLite file, opened through a singleton client with WAL and foreign keys enabled. Each module
receives a `DrizzleModuleDbClient` with its own table prefix.

Migrations are `.sql` files under `<module>/backend/migrations/`, applied in lexicographic order,
split on `--> statement-breakpoint`, tracked in the `openpcb_migrations` table and wrapped in
`BEGIN IMMEDIATE`. **They apply automatically on backend startup** — `npm run db:migrate` is a
deliberate no-op message, and you should never add a standalone migration runner.

Path resolution: `OPENPCB_DB_PATH` → dev `dev-data/openpcb.sqlite` → prod `~/.openpcb/data.sqlite`.

## Security model

OpenPCB is a single-user desktop app with no auth layer. **Loopback is the security boundary.**

- The backend binds `127.0.0.1` by default. Do not bind `0.0.0.0` — many endpoints are
  unauthenticated by design.
- The CORS allowlist (`OPENPCB_ALLOWED_ORIGINS`) is the only same-origin boundary. It makes browsers
  refuse cross-origin reads; it does not stop anything that can already reach the loopback socket.
- Two endpoints depend entirely on that assumption:
  `GET /api/modules/library/models/export` streams the entire library as a ZIP, and
  `POST /api/modules/library/models/import` writes content-addressed assets and DB rows for any
  caller.
- If the boundary ever widens — multi-user, a remote backend, a browser-extension surface — those
  two endpoints must be gated and every unauthenticated module endpoint re-audited before shipping.
- The MCP endpoint is the one surface with an additional check: a bearer token from
  `OPENPCB_MCP_TOKEN` plus a loopback-only origin check.

## Running from source

Requirements: **Node 20+** (an active LTS is recommended), **npm 10+**, **Bun ≥ 1.3** for the
backend runtime and test suite.

```bash
git clone https://github.com/OpenPCB-app/OpenPCB.git
cd OpenPCB
npm install
```

Install at the root only. The root uses npm workspaces (`src/core/backend`, `src/core/frontend`,
`electron`); `shared/` and `CoreLibrary/` are **sibling repositories** consumed through published
GitHub tags, not workspace members. Bun is the backend runtime and test runner, not the package
manager.

### Browser mode (dev backend + Vite)

```bash
npm run dev
# backend  → http://127.0.0.1:3000
# frontend → http://127.0.0.1:1420  (proxies /api and /ws → 3000)
```

### Desktop mode

```bash
npm run dev:electron     # alias: dev:desktop
```

Electron waits on `http-get://127.0.0.1:1420` before opening a window. In desktop mode the backend
binds an **ephemeral port**, so never hardcode 3000 outside standalone dev.

### Against sibling CoreLibrary sources

Place `CoreLibrary` beside this checkout, install its dependencies once, then:

```bash
cd ../CoreLibrary && bun install && bun run validate
cd ../OpenPCB
npm run dev:corelib           # browser dev, packs ../CoreLibrary first
npm run dev:electron:corelib  # desktop dev, packs ../CoreLibrary first
```

The local pack is built as `999.0.0-dev` into `../CoreLibrary/dist` and is preferred **only** in
development. Release and packaged builds always use the fetched, verified `.opclib`.

### Building installers

```bash
npm run build            # frontend bundle + electron-builder make for the current OS
npm run make:mac   --workspace electron
npm run make:win   --workspace electron
npm run make:linux --workspace electron
```

`npm run build` runs `npm run corelib:fetch` first. That step is not a download convenience — it
**verifies** the fetched component library: SHA-256 of the pack, its Ed25519 signature against the
committed trusted key, the manifest id, and the component count. A failure here is a library
integrity failure, not a bundler problem; do not work around it by skipping the fetch.

CI builds and publishes installers (dmg/zip, Setup.exe/nupkg, deb/rpm/AppImage) from `v*` tags.

## Command reference

Run from the repo root unless noted.

| Command                        | What it does                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `npm run dev`                  | Backend + Vite (browser mode)                                                |
| `npm run dev:electron`         | Vite + Electron shell with the backend hosted in main                        |
| `npm run dev:backend`          | Bun backend only (`--watch`, port 3000)                                      |
| `npm run dev:frontend`         | Vite dev server only (port 1420)                                             |
| `npm run dev:browser`          | Backend + the Playwright UI runner against it                                |
| `npm run dev:corelib`          | Pack `../CoreLibrary`, then browser dev                                      |
| `npm run dev:electron:corelib` | Pack `../CoreLibrary`, then desktop dev                                      |
| `npm run build`                | `corelib:fetch` → frontend bundle → electron-builder make                    |
| `npm run corelib:fetch`        | Fetch + verify the bundled `.opclib` (SHA-256, Ed25519, manifest id, count)  |
| `npm run typecheck`            | Composite `tsc -b` over backend, frontend and modules — **excludes `electron/`** |
| `npm run typecheck:frontend`   | `tsc --noEmit` in `src/core/frontend` only                                    |
| `npm run test:backend`         | Bun test suite                                                               |
| `npm run test:react`           | Vitest                                                                       |
| `npm run test:e2e`             | Playwright (Chromium)                                                        |
| `npm run module`               | Interactive module CLI                                                       |
| `npm run module:create`        | Scaffold a new module                                                        |
| `npm run module:validate`      | Validate all module manifests                                                |
| `npm run module:codegen`       | Full module codegen pipeline (registry + SDK)                                |
| `npm run modules:generate`     | Module registry codegen → `src/core/frontend/src/generated/modules.ts`       |
| `npm run sdk:generate`         | SDK stub codegen → `src/core/frontend/src/generated/sdk/`                    |
| `npm run scripts:build`        | Compile `scripts/` (prerequisite for the two codegen commands above)         |
| `npm run gen`                  | Alias for `module:codegen`                                                   |
| `npm run gen:check`            | Fail if the generated registry or SDK stubs are dirty                        |
| `npm run gen:contracts`        | Regenerate `board-snapshot.generated.ts` from the contract types             |
| `npm run gen:contracts -- --check` | Fail if the generated contract types are dirty — **this one runs in CI**  |
| `npm run db:generate`          | Drizzle Kit generate                                                         |
| `npm run db:studio`            | Drizzle Kit studio                                                           |
| `npm run db:migrate`           | No-op message; module migrations apply on backend startup                    |
| `npm run shared:link`          | Point `@openpcb/*` at a sibling `../shared/` checkout                        |
| `npm run shared:status`        | Show which `@openpcb/*` packages are linked                                  |
| `npm run shared:unlink`        | Restore the GitHub-tag installs                                              |
| `npm run release:sourcemaps`   | Upload sourcemaps after a release                                            |

Backend tests are Bun and frontend tests are Vitest — never cross them. Vitest's `include` is scoped
to `src/core/frontend/src/**`, so pure-logic frontend reducers are tested under Bun alongside the
backend suite.

Single-file runs:

```bash
cd src/core/backend  && bun test tests/<file>.test.ts
cd src/core/frontend && npx vitest run path/to/file.test.tsx
```

Playwright runs Chromium only against baseURL `http://127.0.0.1:1420`, and resets its own SQLite
database at `/tmp/openpcb-e2e.sqlite*` through `OPENPCB_DB_PATH`.

## Environment variables

| Variable                     | Default                          | Purpose                                                        |
| ---------------------------- | -------------------------------- | -------------------------------------------------------------- |
| `PORT`                       | `3000`                           | Backend port (standalone dev; desktop uses an ephemeral port)   |
| `HOST`                       | `127.0.0.1`                      | Backend bind address — do not widen                             |
| `OPENPCB_DB_PATH`            | dev `dev-data/openpcb.sqlite`    | SQLite path (prod `~/.openpcb/data.sqlite`)                     |
| `OPENPCB_WORKSPACE_ROOT`     | derived                          | Module discovery root; set only for an unusual cwd              |
| `OPENPCB_ALLOWED_ORIGINS`    | localhost:1420, :3000            | Comma-separated CORS allowlist                                  |
| `OPENPCB_DEBUG_DIAGNOSTICS`  | `false`                          | Enables `/api/diagnostics/debug/modules`                        |
| `OPENPCB_MCP_TOKEN`          | generated per launch             | Bearer token for the MCP endpoint                               |
| `OPENPCB_MCP_PORTFILE`       | `<APP_DATA_DIR>/mcp.json`        | stdio bridge: read this discovery file instead of the per-OS default (tests, multiple installs) |
| `OPENPCB_MCP_CLIENT`         | client's `clientInfo.name`       | stdio bridge: override the client key (keys the MCP chats); must be stable |
| `OPENPCB_MCP_POLL_MS`        | `3000`                           | stdio bridge: how often it re-checks the app's MCP state for `list_changed` |
| `OPENPCB_E2E_NO_WEBSERVER`   | unset                            | Set to `1` to stop Playwright starting its own servers          |
| `AUTO_LAYOUT_URL`            | dev `http://localhost:3002`, packaged `https://autolayout.cloud.openpcb.app` | Cloud Auto Layout / Route Board service base URL. Legacy `AUTO_ROUTER_URL` / `AUTO_PLACE_URL` still honoured (same merged service). Point it at `cloud-infra/devstack` for local work |
| `NODE_ENV`                   | —                                | `development` / `test`; any non-prod value turns feature flags on |
| `VITE_FEATURE_<FLAG>`        | unset                            | Per-build frontend feature-flag override (`1/true/on`, `0/false/off`) |
| `OPENPCB_FEATURE_<FLAG>`     | unset                            | The same override for the backend                               |

`<FLAG>` is the flag id upper-cased with `.` replaced by `_` — `cloud.autolayout` becomes
`CLOUD_AUTOLAYOUT`.

## Feature flags

Feature flags are a per-feature build-target gate, separate from the whole-module `availability`
gate. The registry at `src/core/contracts/feature-flags/registry.ts` is the single source of truth:
each flag is `{ availability: "all" | "dev" }`, where `"dev"` means enabled in development and
hidden from release builds. Graduating a feature means flipping its entry to `"all"`.

A flag gates **both** its UI surface and its backend routes, so a flag-off route returning 404 in a
release build is expected behaviour, not a bug. Graduating a flag also obliges you to write release
notes: everything behind it was invisible to users until the flip, so the flip is the release event.

Two families of flags exist today — PCB route-tool and DRC behaviours, and the cloud features. Read
the registry for the current list rather than trusting any document.

## Creating a new module

```bash
npm run module:create     # interactive scaffolder
npm run module:validate   # validate all manifests
npm run gen               # regenerate the module registry + SDK stubs, then commit them
```

The module CLI does **registry and SDK codegen only**. There is no Rust, no Tauri, no Cargo and no
bridge anywhere in this repository, whatever older script documentation claimed; if you find a
reference to `cargo`, `bridge:generate` or `types:generate` in the docs, it is stale and should be
deleted rather than followed.

A module needs:

```
src/modules/<id>/
├── manifest.json            # id, namespace, apiVersion: 2, kind, sidebar, dependsOn
├── module.backend.ts        # exports a ModuleDefinition (default | definition | backendModule)
├── module.frontend.ts       # exports { manifest, Space }
├── backend/
│   ├── migrations/0000_*.sql
│   └── routes.ts
└── frontend/Space.tsx
```

Manifest fields: `id` (kebab-case), `label`, `namespace` (dot-separated), `version`,
`apiVersion: 2`, `kind: "space" | "tool"`, `sidebar: { label, icon, order, group? }`,
`runtime: { backendEntry?, frontendEntry? }`, `dependsOn: [{ id, minVersion?, optional? }]`, and an
optional `defaultPinned`.

The `ModuleDefinition` contract lives in `src/core/contracts/modules/backend-module.ts`:

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

The `id` must match `manifest.json`.

## TypeScript

- Composite build: the root `tsconfig.json` references `src/core/backend`, `src/core/frontend`,
  `src/core/frontend/tsconfig.node.json` and `tsconfig.modules.json`.
- `tsconfig.modules.json` covers `src/modules/**`, `src/shared/**`, `src/sdks/**` and
  `src/core/contracts/**` (noEmit, jsx).
- `tsconfig.base.json` is strict: ES2022 target, bundler module resolution,
  `noUncheckedIndexedAccess`, `noImplicitOverride`.
- Path aliases:

| Alias        | Resolves to                  | Scope          |
| ------------ | ---------------------------- | -------------- |
| `@modules/*` | `src/modules/*`              | everywhere     |
| `@sdks/*`    | `src/sdks/*`                 | everywhere     |
| `@shared/*`  | `src/shared/*`               | everywhere     |
| `@/*`        | `src/core/frontend/src/*`    | frontend only  |

Vite mirrors these aliases — when you add one, add it in both `tsconfig.base.json` and
`src/core/frontend/vite.config.ts` or the frontend build will diverge from the typechecker.

## Troubleshooting

- **Backend will not boot.** Check that `OPENPCB_DB_PATH` is writable. Module migrations run
  transactionally at startup, so a half-written migration fails the boot rather than corrupting the
  database. `GET /api/diagnostics` carries the last errors.
- **A module does not appear.** Re-run `npm run gen` and commit the generated files; confirm
  `manifest.json` has `apiVersion: 2` and a unique `id`; check the topological order in the boot
  logs for an unresolved `dependsOn`.
- **`npm run build` fails in `corelib:fetch`.** That is the integrity gate — SHA-256, Ed25519
  signature, manifest id or component count did not match. Re-fetch; if it still fails, the pack or
  the trusted key is wrong. Do not bypass it.
- **CI fails on codegen.** Run `npm run gen`, `npm run gen:check` and
  `npm run gen:contracts -- --check` locally and commit whatever changed.
- **Typecheck is green but Electron is broken.** `npm run typecheck` excludes the `electron/`
  workspace; build it explicitly.
- **Edits to `src/shared/rendering/` do nothing.** Those files are re-export shims over
  `@openpcb/rendering-core`. Change the sibling `shared/` repo, publish a tag, re-pin.
- **STEP/3D conversion appears stuck.** The import commits first and conversion runs in the
  background; use the retry control in the Library 3D preview.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the quick start, the pre-PR checklist and the commit
and PR conventions.
