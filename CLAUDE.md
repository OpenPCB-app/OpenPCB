# CLAUDE.md

Agent instructions for this repository. This is the single entry point — `AGENTS.md` is a pointer
stub, and only `electron/`, `src/modules/designer/` and `src/modules/library/` carry nested
`AGENTS.md` files, each scoped to what is local to that tree.

**This file carries architecture and invariants only.** Progress, phases and status belong in
`ROADMAP.md` and `TODO.md`. If you find yourself adding a phase name or a completion state here,
put it there instead.

For anything a human and an agent need identically — the full command list, environment variables,
TypeScript path aliases, module scaffolding, troubleshooting — read **`DEVELOPER.md`**. This file
records only the deltas and traps that are not obvious from it.

## Project

OpenPCB — desktop PCB design suite. Bun HTTP backend + React 19 / Vite 7 / Tailwind 4 frontend +
Electron shell + SQLite (Drizzle ORM). Root uses **npm workspaces** (`src/core/backend`,
`src/core/frontend`, `electron`); Bun is the backend runtime and test runner, not the root package
manager. The root `bun.lock` is stale — `package-lock.json` is dependency truth.

## Working agreements

- **Do not auto commit, push, pull or tag.** Only when explicitly asked.
- Use the `src/core/*`, `src/modules/*`, `src/sdks/*`, `src/shared/*` prefixes. The pre-restructure
  `src-ts/`, `src-react/` and root-level `core/`, `modules/`, `sdks/`, `legacy/` directories no
  longer exist; never reintroduce references to them.
- Never invent manufacturing constants. Load `/eda-standards` (see Skills).
- When this file conflicts with executable config, trust the config and fix this file.

## Architecture

Strict one-way layer dependencies:

```
electron/  ──►  core/backend (started in-process by Electron main)
           ──►  shared/drc/worker (only `setDrcWorkerEntry` / `disposeDrcWorker` — the S10 worker entry override)

modules/*  ──►  sdks/ + shared/  ──►  core/
```

| Layer       | Responsibility                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `core/`     | Pure infrastructure: HTTP, router, module loader, app shell, DB factory, error contracts. **Zero business logic.** |
| `shared/`   | ECS world, command/patch infrastructure, canvas engine, geometry, DRC/routing primitives, UI primitives. |
| `sdks/`     | Pure interfaces and public types between modules. **No implementations.**                            |
| `modules/*` | Self-contained vertical slices: manifest + backend + frontend + migrations + domain logic.           |

Modules must not import `src/core/backend/*` or `src/core/frontend/*`. Go through
`src/core/contracts/*`, `src/sdks/*` and `src/shared/*`. Nothing enforces this yet — ESLint boundary
rules are not wired, so it is caught by review only.

### Re-export shims — read this before editing `src/shared/rendering/`

Several in-tree paths are **thin re-export shims over published `@openpcb/*` packages. Editing them
changes nothing at runtime.** The behaviour lives in the sibling `shared/` repo, consumed here via
per-package GitHub tags. The two most commonly mistaken for real code:

- `src/shared/rendering/` (`index`, `types`, `geometry`, the `*-preview-builder` and `*-bounds`
  files, `ipc7351b/index`, `parametric/index`)
- `src/shared/frontend/canvas/defaults.ts`

Both re-export **`@openpcb/rendering-core`**. To change a render model builder, an IPC-7351B
generator or a KLC constant, change it in the `shared/` repo, publish a tag, and re-pin here.

Other shimmed surfaces:

| Package                   | Shimmed at                                                                                                                                        | Owns                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `@openpcb/rendering-core` | `src/shared/rendering/*`, `src/shared/frontend/canvas/defaults.ts`                                                                                | render-model builders, IPC-7351B generator, parametric footprints, KLC  |
| `@openpcb/kicad-import`   | `src/modules/library/backend/import/{inspect-kicad,build-preview-models,validate-pads,pinmap}.ts`, `.../infrastructure/parsers/kicad/{heuristics,kicad-model-linker}.ts` | KiCad → normalized library shape, validation, heuristics, 3D linking    |
| `@openpcb/opclib-pack`    | `src/modules/library/backend/sync/{opclib-reader,canonical-json,types}.ts`, `.../import/archive/extract-zip.ts`                                   | `.opclib` pack/unpack, canonical JSON, ZIP extraction, manifest validation |
| `@openpcb/step-to-glb`    | `src/modules/library/frontend/three-d/{step-to-glb,category-materials,apply-category-material}.ts`                                                | STEP→GLB in a Web Worker via `occt-import-js` (Vite only)               |
| `@openpcb/kicad-parsers`  | imported directly, no shim                                                                                                                       | KiCad s-expression / symbol / footprint parsers                         |
| `@openpcb/r3f-eda-canvas` | installed, **not integrated** — `src/shared/frontend/canvas/` is still in-tree                                                                    | R3F canvas engine, primitives, scene renderers                          |

Local iteration against the sibling checkout: `npm run shared:link` → `npm run shared:status` →
`npm run shared:unlink`. `shared/` packages build `dist/` via `prepare` on install; a missing
`dist/` means rebuild the package, not that the shim is broken.

### Layout

```
src/
├── core/
│   ├── backend/        Bun HTTP runtime, module loader, router, DB (own workspace)
│   │   ├── main.ts     entry — boots ModuleRuntime, then createHttpServer
│   │   ├── http/       server, CORS, middleware, problem-details
│   │   ├── router/     HttpRouter, ModuleRouter, route matcher, registry
│   │   ├── modules/    module-loader.ts, manifest-discovery.ts, sdk-registry.ts
│   │   ├── db/         sqlite-client, module-db-factory, transaction-runner
│   │   ├── migrations/ module-migrator (per-module SQL migrations)
│   │   ├── controllers/ health, diagnostics
│   │   ├── contracts/  AppError hierarchy
│   │   ├── diagnostics/ error buffer + store
│   │   ├── logging/    JSON structured logger
│   │   └── tests/      Bun test suite
│   ├── frontend/       React 19 + Vite 7 + Tailwind 4 (own workspace)
│   │   └── src/        App → RuntimeProvider → BootstrapProvider → ThemeProvider → AppShell → AppRouter
│   └── contracts/      app/* (runtime, bootstrap, routes) + modules/* (manifest, backend-module,
│                       sdk facades) + feature-flags/
├── modules/            assistant · designer · knowledge · library · tasks
├── sdks/               public inter-module contracts (assistant, designer, library, tasks)
└── shared/
    ├── domain/             ECS world, commands, events, revision, patch/history infrastructure
    ├── drc/                the DRC engine (relocated here in S8 — `drc-engine`, `drc-context`,
    │                       `checks/`, `legality.ts` for the live / commit gate, `broad-phase.ts`
    │                       — the S9 grid; `DrcOptions.broadPhase: "grid" | "exhaustive"` keeps
    │                       the pre-S9 loops as the oracle, see
    │                       docs/pcb-hardening/08-broad-phase-contract.md), rule resolver,
    │                       fab presets; `modules/designer/backend/drc/` is re-export shims;
    │                       `worker/` — the S10 worker-thread entry + main-thread client
    │                       (docs/pcb-hardening/09-execution-contract.md); `checks/{courtyard,
    │                       silkscreen,solder-mask,copper-shape,filled-gap}.ts` — the S12 DFM
    │                       checks (docs/pcb-hardening/11-dfm-contract.md); `voltage-term.ts`,
    │                       `mask-exposure.ts`, `effective-net-overlay.ts`, `checks/chain-short.ts`
    │                       — the S13 electrical constituents (docs/pcb-hardening/13-electrical-contract.md)
    ├── pcb-connectivity/   copper connectivity kernel (records, items, touch, graph; S13 adds
    │                       `effective-nets.ts` — tier nets of unassigned copper — and
    │                       `copper-drc-items.ts`) — see
    │                       docs/pcb-hardening/01-connectivity-contract.md
    ├── pcb-areas/          copper zones + keepouts: v1→v2 upgrade, the ONE derivation of
    │                       effective copper areas (board zones are persisted rows), the
    │                       keepout predicate, pour-parameter composition — see
    │                       docs/pcb-hardening/03-zone-keepout-contract.md
    ├── pcb-geometry/       PCB geometry (S12b adds the exact layer — `rounded-shape.ts`,
    │                       `canonical-contour.ts`, `exact-arcs.ts`, `exact-ring.ts`,
    │                       `exact-contour.ts`, `exact-simplicity.ts`, `region-{build,rounded,exact}.ts`,
    │                       docs/pcb-hardening/12-exact-geometry-contract.md): segment predicates, arc chords, outline flattening, the
    │                       board region (+ region-index.ts: the S9 boundary-edge index its
    │                       predicates take as an optional argument), area overlap
    │                       (area-overlap.ts) (+ tolerance.ts: the single epsilon policy) — see
    │                       docs/pcb-hardening/02-geometry-contract.md; pad-annular.ts — the S11
    │                       annular-ring kernel (analytic signed distances, breakout, copper-in-drill
    │                       containment), docs/pcb-hardening/10-manufacturability-contract.md §3.
    │                       `rendering/pcb/outline-geometry.ts` and `backend/pcb/outline-geometry.ts`
    │                       are re-export shims over it; courtyard-rings.ts — the S12 per-side
    │                       courtyard regions (11 §2)
    ├── pcb-routing/        PCB routing
    ├── rendering/          re-export shim over @openpcb/rendering-core (see above) — EXCEPT the
    │                       in-tree `pcb/` (drills, outline kernels, chain-edges, loop-ring,
    │                       footprint-labels) and `pcb/artwork/` (the S12 silk + mask artwork
    │                       model the Gerber writer and the DFM checks share, 11 §1) and
    │                       `copper-fill/` (the Clipper2 kernel + the S12 copper-shape kernel)
    ├── schematic-routing/  schematic wire routing
    └── frontend/           canvas engine, context-menu, UI primitives

electron/               Electron main + preload + MCP shim; hosts the backend in-process
scripts/                module-cli.ts, gen-modules.ts, gen-sdk.ts, gen-contract-types.ts, tooling
tests/e2e/              Playwright
```

The shared tree has **nine** subtrees, listed above. There is no `src/shared/backend/`.

### Modules

| Module      | Depends on | Scope                                                                       |
| ----------- | ---------- | --------------------------------------------------------------------------- |
| `library`   | —          | component catalog: symbols, footprints, KiCad import, built-in seeding       |
| `designer`  | `library`  | schematic + PCB editor: commands, history, projections, ECS world, DRC, `pcb/` |
| `tasks`     | —          | task tracking + SSE                                                         |
| `assistant` | `tasks`    | AI assistant (OpenAI / Ollama / LM Studio providers); hosts the MCP server   |
| `knowledge` | —          | read `src/modules/knowledge/manifest.json` — scope not documented here       |

`designer` declares a required dependency on `library >= 0.1.0`.

### Module system

`ModuleRuntime` (`src/core/backend/modules/module-loader.ts`) drives boot:

1. `discoverModuleManifests(workspaceRoot)` walks `<workspaceRoot>/modules/*`. **`workspaceRoot`
   resolution is a 3-candidate fallback**: `MODULE_DIR/../../..`, then `process.cwd()/src`, then
   `process.cwd()`. Set `OPENPCB_WORKSPACE_ROOT` **only** when running from an unusual cwd — the
   default loader already finds `src/modules` in normal layouts.
2. Validates and normalizes manifests (`id`, `namespace`, `apiVersion: 2`, `sidebar`, `dependsOn`).
3. Topological sort with cycle detection, resolving `dependsOn`.
4. Per module: applies `backend/migrations/*.sql` → dynamic-imports `module.backend.ts` → expects a
   `ModuleDefinition` export (`definition`, `default`, or `backendModule`; its `id` must match
   `manifest.json`).
5. Lifecycle: `onActivate → registerSdk → registerRoutes(router, ctx)`.
6. SDKs land in `RuntimeSdkRegistry` keyed by `MODULE_SDK_TOKENS`; routes land in
   `ModuleRouterRegistry`.

**Module route URL pattern:** `/api/modules/{moduleId}/{subpath}` — the registry rewrites the URL to
just `{subpath}` before dispatching to the module's router. `/api/modules/registry` is a **core**
route, not module dispatch.

**Manifest schema:** `id` (kebab-case), `label`, `namespace` (dot-separated), `version`,
`apiVersion: 2`, `kind: "space" | "tool"`, `sidebar: { label, icon (Lucide name), order, group? }`,
`runtime: { backendEntry?, frontendEntry? }`, `dependsOn: [{ id, minVersion?, optional? }]`,
optional `defaultPinned`.

**Definition contract** (`src/core/contracts/modules/backend-module.ts`):

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

Context carries `moduleId`, `manifest`, `db` (prefixed SQLite via Drizzle — tables prefixed
`library_`, `designer_`, …), `sdk` (RuntimeSdkRegistry) and `logger`.

### SDK dependency injection

- Consume: `ctx.sdk.get<T>(MODULE_SDK_TOKENS.LIBRARY)`. Never import another module directly.
- Publish: in the module's `registerSdk()` lifecycle hook.
- `src/sdks/` holds **pure interfaces and types only** — no implementations.
- The frontend consumes **generated typed stubs** at `src/core/frontend/src/generated/sdk/`. They
  are codegen output; regenerate with `npm run sdk:generate` (or `npm run gen`) and commit.
- **Adding a designer command requires updating the `DesignerCommand` union** in
  `src/sdks/designer/types.ts`. A handler without a union entry will not typecheck through the SDK,
  and a command field that has no parser in the module's `routes.ts` is **silently dropped over
  HTTP**.

### Frontend module loading

`src/core/frontend/src/components/ModuleSpaceHost.tsx` uses `import.meta.glob` to discover
`module.frontend.ts` files. Each exports `{ manifest, Space }`, where `Space` is a lazy React
component receiving `{ moduleId, namespace, backendURL }`. Navigation is **Zustand-based**
(`useNavigationStore`) — there is no React Router dependency.

### Backend HTTP stack

Boot: `main.ts` → `ModuleRuntime.bootstrap()` → `createHttpServer()` → `Bun.serve()`.
Middleware chain: requestId → logging → CORS → error handler.

Built-in routes: `GET /api/health`, `GET /api/diagnostics` (error stats, ring buffer of the last
100), `GET /api/modules/registry`.

Errors use **RFC 7807 problem-details** (`application/problem+json`). `AppError` subclasses:
`ValidationError` (400), `NotFoundError` (404), `MethodNotAllowedError` (405). Custom problem types
are prefixed `https://openpcb.dev/problems/`.

### SQLite runtime

One SQLite file via a native driver + Drizzle ORM. Facts that constrain how you write code against
it:

- The client is a **singleton**, **WAL enabled**, **foreign keys on**. There is one writer.
- Module tables are **prefix-partitioned** — each module gets a `DrizzleModuleDbClient` with its own
  `tablePrefix`.
- Migrations are `.sql` files under `<module>/backend/migrations/`, applied in **lexicographic**
  order, split on `--> statement-breakpoint`, tracked in the `openpcb_migrations` table, each
  wrapped in `BEGIN IMMEDIATE`.
- Migrations apply **automatically on backend startup**. `npm run db:migrate` is a deliberate no-op
  message — never write a standalone migration runner.
- Path resolution: `OPENPCB_DB_PATH` → dev `dev-data/openpcb.sqlite` → prod `~/.openpcb/data.sqlite`.

### Designer command pattern

Every designer mutation flows through a `CommandEnvelope` with idempotency and inverse patches:

```
CommandEnvelope
  → idempotency check (command log; duplicate commandId rejected)
  → load DesignWorld (ECS)
  → validate baseRevision      (REVISION_CONFLICT on mismatch)
  → command-bus dispatch
  → handler plans patches
  → apply + persist
  → publish invalidation
  → CommandResult (with inverse patch for undo)
```

Envelope shape: `{ commandId, sessionId, aggregateId, baseRevision, issuedAt, command }`.

- The ECS world (entities/components) is persisted as JSON blobs.
- Patches and inverses come from the `shared/domain` ECS + patch infrastructure — this is what makes
  undo/redo possible.
- Reads go through projections (`projection-read.ts`, `projection-world.ts`); PCB placements are
  auto-synced from schematic changes.
- Per-session undo/redo is persisted across runtime reloads.

Deeper designer invariants — net identity, pad addressing, DRC extension points, board-settings
shape — live in `src/modules/designer/AGENTS.md`. Read it before touching that module.

### Coordinate contract

**world = nanometres · scene = millimetres · screen = pixels**, with `NM_TO_SCENE = 1_000_000`.

Integer nanometres are the persisted unit everywhere. This is deliberate: exact boolean polygon
operations, exact transform composition, lossless save/load, and DRC that is deterministic across
machines. Do not introduce floating-point storage units.

Editor rendering is **React Three Fiber only**: no Canvas2D, no imperative Three.js scene mutation,
no `frameloop="always"`. Use demand rendering and `invalidate()`.

### Dev ports and proxy

- Backend dev: `127.0.0.1:3000` (`PORT`, `HOST`).
- Frontend dev: `127.0.0.1:1420`, proxying `/api` and `/ws` to the backend.
- Electron waits on `http-get://127.0.0.1:1420` before opening the window, and in desktop mode binds
  the backend to an **ephemeral port** — never hardcode 3000 outside standalone dev. See
  `electron/AGENTS.md`.

## Security model

OpenPCB is a **single-user desktop app with no auth layer**. Loopback is the security boundary.

- The backend binds `127.0.0.1` by default (`HOST`). **Do not bind `0.0.0.0` or a public
  interface** — many endpoints are unauthenticated by design.
- The CORS allowlist (`OPENPCB_ALLOWED_ORIGINS`, default localhost/Tauri only) is the **only**
  same-origin boundary. It makes browsers refuse cross-origin reads; it does **not** stop a
  determined caller that can already reach the loopback socket. Treat the backend as trusting
  anything on loopback.
- Two endpoints depend entirely on that assumption:
  - `GET /api/modules/library/models/export` — streams the **entire library** (manifest plus every
    footprint GLB/STEP) as a ZIP. **Never expose to a network.**
  - `POST /api/modules/library/models/import` — accepts a ZIP and writes content-addressed assets
    and DB rows **for any caller**.
- **Re-audit trigger:** if a future deployment widens the boundary at all — multi-user, a remote
  backend, a browser-extension surface — gate `models/export` and `models/import` behind an env flag
  or session token and re-audit every unauthenticated module endpoint before shipping.
- The one exception to pure loopback trust is the MCP endpoint, which additionally requires a bearer
  token (below).

## MCP server

OpenPCB exposes its assistant tool registry over **MCP** so external agents (Claude Code, Claude
Desktop, Codex) can drive the design the user has open. It lives **inside the assistant module**,
which owns the registry, `ContextResolver`, proposals and the write policy.

- **Endpoint:** Streamable HTTP at `/api/modules/assistant/mcp` (POST/GET/DELETE), built on
  `@modelcontextprotocol/server` v2's `createMcpHandler`, whose `fetch(Request) → Response` matches
  the module router natively. Code under `src/modules/assistant/backend/mcp/`.
- **Sessions are backed by a real assistant chat**, one per client, matched on
  `metadata.mcp.clientKey` derived from the `X-OpenPCB-MCP-Client` header or User-Agent — it must be
  **header-stable, never the display name**. This is what lets every existing designer tool work
  unchanged: they resolve their design through `contextResolver.getPrimaryDesign(chatId)`. It also
  means MCP tool calls and pending proposals render in the assistant panel.
- **Tools:** the 15 in-app `AiTool`s projected 1:1 (`AiToolDefinition` is already MCP-shaped;
  `fromJsonSchema` takes `inputSchema` verbatim), plus MCP-only extended reads in
  `tools/read-tools.ts` (`designer_list_designs`, `get_pcb_state`, `run_erc`, `run_drc`, `get_bom`,
  `export_manufacturing`) and the session-scoped `designer_use_design`. **Do not add the extended
  reads to the in-app registry** — its prompt and DoD harness are tuned against the current 15.
- **Design targeting:** explicit `designId` → session pin (`designer_use_design`) → UI-active
  design. The frontend pushes the focused tab to `PUT /api/modules/designer/active-design`
  (in-memory).
- **Two settings, both default off** (`assistant_settings.mcp_enabled` / `mcp_allow_writes`). Writes
  are forced off whenever the server is off; when writes are off, write tools are **not registered
  at all**. Otherwise the in-app policy applies — non-destructive edits auto-apply, deletions pend
  for approval.
- **Security:** bearer token from `OPENPCB_MCP_TOKEN` (generated per launch by Electron main) plus a
  loopback-only Origin check. Discovery via `<APP_DATA_DIR>/mcp.json` at mode 0600; the backend port
  is ephemeral, so there is nothing to hardcode.
- **stdio clients** use the bundled shim (`electron/src/mcp-shim/`), launched by
  `build/mcp/openpcb-mcp{,.cmd}` via `ELECTRON_RUN_AS_NODE` on the app's own Electron binary — no
  system Node needed. It ships through `extraResources` because nothing inside `app.asar` is
  spawnable. The app must be running; there is no headless fallback (one SQLite writer).

## Commands — agent-relevant deltas

Full list in `DEVELOPER.md`. What is not obvious from it:

| Fact                                                                                                       | Why it matters                                                              |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `npm run typecheck` runs the root composite `tsc -b` and **excludes `electron/`**                          | A green typecheck does not mean the Electron workspace compiles              |
| Packaging is **`electron-builder`, not Electron Forge**                                                    | Older reports say Forge. `npm run build` = frontend bundle + electron-builder |
| `npm run build` **runs `npm run corelib:fetch` automatically**                                             | The build verifies the fetched `.opclib`: SHA-256, Ed25519 signature, manifest id and component count. A build failure here is a **library integrity failure**, not a bundler bug |
| `npm run gen:contracts -- --check` is **wired into CI**                                                    | `bun scripts/gen-contract-types.ts` regenerates `board-snapshot.generated.ts`; commit the result or CI fails |
| `npm run gen:check` fails if the generated module registry / SDK stubs are dirty                           | Any manifest change needs `npm run gen` + a commit                          |
| Backend tests are **Bun** (`npm run test:backend`), frontend tests are **Vitest** (`npm run test:react`)    | Never cross them                                                            |
| Frontend Vitest `include` covers `src/core/frontend/src/**`, `src/modules/*/frontend/**` and `src/shared/frontend/**` only | A `*.test.ts` under any other `src/shared/*` subtree runs in **neither** runner — put kernel tests under `src/core/backend/tests/` (Bun) |
| `npm run db:migrate` is a no-op message                                                                    | Module SQL migrations apply on backend startup                              |
| The module CLI (`npm run module`, `module:create`, `module:validate`, `module:codegen`) does **registry + SDK codegen only** | There is no Rust, no bridge and no Cargo anywhere in this repo, whatever older script docs claim |

CI order worth mirroring locally: `npm ci` → rebuild installed `@openpcb/*` dists →
`npm run corelib:fetch` → `typecheck` → `gen:check` → `gen:contracts -- --check` → backend tests →
frontend tests → Playwright.

### Playwright

- **Chromium only.** baseURL `http://127.0.0.1:1420`.
- Resets the e2e SQLite database (`/tmp/openpcb-e2e.sqlite*`) via `OPENPCB_DB_PATH`.
- `npm run test:e2e` starts its own backend and frontend unless `OPENPCB_E2E_NO_WEBSERVER=1`.

## Feature flags

A per-feature build-target gate, separate from the whole-module `availability` gate.

- **Registry — the single source of truth, edit here:**
  `src/core/contracts/feature-flags/registry.ts`. Each flag is `{ availability: "all" | "dev" }`,
  reusing the module-manifest vocabulary. `"dev"` = enabled in dev, hidden from release builds.
  Graduate a feature by flipping it to `"all"`.
- **Adapters:** frontend `src/core/frontend/src/feature-flags` (`isFeatureEnabled`,
  `useFeatureFlag`, keyed on `import.meta.env.DEV`); backend
  `src/core/contracts/feature-flags/backend` (`isFeatureEnabled`, keyed on `process.env.NODE_ENV`;
  module backends import this, and `core/backend/feature-flags` re-exports it). Any non-prod
  `NODE_ENV` / `import.meta.env.DEV`, **including tests**, means flags are on.
- **Per-build override (e.g. QA):** `VITE_FEATURE_<FLAG>` (frontend) / `OPENPCB_FEATURE_<FLAG>`
  (backend), value `1/true/on` or `0/false/off`. `<FLAG>` is the flag name upper-cased with `.` → `_`
  (`cloud.autolayout` → `CLOUD_AUTOLAYOUT`).
- **Graduating a flag obliges you to write release notes.** Behaviour changes hidden behind a flag
  are invisible to users until the flip; the flip is the release event. This applies to at minimum
  the snap and `pcb.padShapeConnectivity` DRC shifts and the auto-finish / walkaround / length-tuning
  / bundle-routing route-tool behaviours.

**Flag inventory — verify against `src/core/contracts/feature-flags/registry.ts` before relying on
any id below.** The exact ids were not confirmed when this file was written.

| Flag                       | Gates                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| `pcb.padShapeConnectivity` | pad-shape-aware connectivity in DRC                                |
| `pcb.advancedVias`         | advanced via handling                                              |
| `pcb.routeAutoFinish`      | route auto-finish                                                  |
| `pcb.routeWalkaround`      | route walkaround                                                   |
| `pcb.lengthTuning`         | the length-tuning (Tune) tool                                      |
| `pcb.bundleRouting`        | the Bundle tool (toolbar-only surface)                             |
| `dataset.capture`          | designer dataset capture — see `src/modules/designer/AGENTS.md`    |
| `mcp.server`               | the MCP endpoint route                                             |
| `cloud.auth`               | cloud foundation, wired at the `readCloudConfig().enabled` chokepoint |
| `cloud.sync`               | cloud design sync                                                  |
| `cloud.designBrowser`      | cloud design browser                                               |
| `cloud.presence`           | presence                                                           |
| `cloud.comments`           | comments                                                           |
| `cloud.autolayout`         | the unified Auto-Layout button/modal **and** both the `/autoroute` and `/autoplace` backend routes (replaced the former separate `cloud.autoroute` + `cloud.autoplace`) |
| `cloud.library`            | cloud library                                                      |
| `cloud.componentSearch`    | cloud component search                                             |
| `cloud.assistantProviders` | cloud assistant providers                                          |

Per-feature flags gate **both** their UI surface and their backend routes — a flag-off cloud route
returns 404, which is the expected behaviour in release builds, not a bug.

## Skills (slash commands)

Domain skills live in `.claude/skills/`. Use `/skill-name` or let auto-triggers fire. Each loads
detailed reference material — use them instead of guessing EDA conventions.

| Skill                | When to use                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/library`           | Component wizard, symbol/footprint editors, KiCad `.kicad_sym`/`.kicad_mod` import, library↔designer linking, built-in seeding, ComponentPalette / ComponentDetailPage UI          |
| `/schematic-editor`  | Symbol placement, wire routing (Manhattan 90° only), net labels, pin connections, junction detection, net extraction, ERC, netlist, tool modes, undo/redo                          |
| `/pcb-layout`        | Trace routing (Manhattan + 45°), vias, pad rendering, ratsnest (MST), board outline, placement, net classes, footprint rendering from KiCad payload, grid presets, Gerber export   |
| `/r3f-eda-rendering` | **Any** visual rendering in EDA editors. R3F orthographic + demand rendering (`invalidate()`), render-order constants, InstancedMesh, LineSegments2, text, hit-testing patterns    |
| `/eda-standards`     | IPC-2221B clearance tables, trace-width formula and lookup, manufacturer presets (JLCPCB / PCBWay), layer naming, via specs, copper weight, grid standards, DRC rule values. **Values only, no code patterns** |
| `/pcb-hardening-review` | **Opt-in, explicit invocation only.** Delegates a DRC / PCB-geometry / manual-routing / copper-pour / ERC correctness question to GPT-6-Astra via the Codex CLI, read-only, attack-framed (finds counterexamples, specifies fixes — never writes code). Scoped only to `src/shared/drc/` (engine + checks; `backend/drc/` is shims), `shared/pcb-connectivity/`, `shared/pcb-geometry/`, `shared/pcb-routing/`, `shared/schematic-routing/` + `backend/erc/`, `shared/rendering/copper-fill/`. Refuses and redirects for anything else. |

Selection guidance:

- Touching any canvas or visual code → `/r3f-eda-rendering` first, then the domain skill.
- Library module backend or frontend → `/library`.
- Need a DRC value, clearance rule or trace width → `/eda-standards`; never invent one.
- Hard DRC/geometry/routing/electrical correctness question — attacking a design or an
  implementation, not everyday review → `/pcb-hardening-review` (explicit invocation only, never
  auto-triggered).
- Skills carry `references/` subdirectories with detailed specs (routing algorithms, hit-testing, net
  extraction, design rules), loaded automatically.
