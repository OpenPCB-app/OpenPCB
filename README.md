<div align="center">
  <img src="logo.svg" alt="OpenPCB" width="120" />
  <h1>OpenPCB</h1>
  <p><strong>Modular, open desktop PCB design suite — schematic capture, PCB layout, and a unified component library in one app.</strong></p>

  <p>
    <img alt="version" src="https://img.shields.io/badge/version-0.1.5--dev-blue" />
    <img alt="license" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-lightgrey" />
    <img alt="electron" src="https://img.shields.io/badge/Electron-41-47848F?logo=electron&logoColor=white" />
    <img alt="bun" src="https://img.shields.io/badge/Bun-runtime-black?logo=bun&logoColor=white" />
    <img alt="react" src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" />
    <img alt="vite" src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" />
    <img alt="tailwind" src="https://img.shields.io/badge/Tailwind-4-38BDF8?logo=tailwindcss&logoColor=white" />
    <img alt="typescript" src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white" />
  </p>
</div>

---

OpenPCB is a desktop application that lets electronics designers go from idea → schematic → PCB → fabrication-ready output in a single, modular workspace. It is built on a **module-runtime architecture**: each vertical slice (library, designer, tasks, assistant) ships its own backend routes, frontend Space, DB schema, and migrations, and is loaded dynamically at boot through a typed SDK registry.

> Status: pre-1.0, active development. Phases 1–3 of the rewrite are complete; PCB layout (Phase 4) is partially shipped (trace routing, vias, layer switching, live DRC, ratsnest).

## Highlights

- **Schematic capture** — symbol placement, Manhattan wire routing, net labels, junctions, net extraction, ERC scaffolding, full undo/redo.
- **PCB layout** — trace routing (Manhattan + 45°), via placement with layer switch, pad rendering, MST ratsnest, board outline, component placement, live DRC, IPC-2221B-aware net classes.
- **Component library** — symbols, footprints (IPC-7351B preset generator + drawn editor), variants, KiCad `.kicad_sym` / `.kicad_mod` import, built-in seeded components.
- **R3F-based canvas** — single React Three Fiber orthographic renderer with demand rendering, shared by all editors; nm → mm → px coordinate pipeline.
- **Command + ECS core** — every mutation is a `CommandEnvelope` with idempotency, base-revision check, inverse patches, persisted per-session history.
- **Module runtime** — kebab-case manifest, topological boot, per-module SQLite prefix, auto-applied SQL migrations, codegenerated SDK + module registry.
- **AI Assistant module** (dev) — OpenAI / Ollama / LM Studio providers, read-only tools today, write-tool scaffolding behind confirm/reject.
- **Cross-platform desktop** — Electron 41 shell, embedded backend in main process, auto-update via `electron-updater`, signed/notarized builds in CI for macOS arm64/x64, Windows x64, Linux x64.

## Screenshots

> _Screenshots are intentionally omitted in this repo — open the app to see the schematic editor, PCB canvas, and library palette._

## Tech stack

| Layer         | Choice                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| Desktop       | Electron 41 (embedded backend in main process)                                        |
| Backend       | Bun HTTP server, RFC 7807 problem-details, JSON structured logging                    |
| Database      | SQLite via `better-sqlite3` + Drizzle ORM, per-module table prefixes                  |
| Frontend      | React 19, Vite 7, Tailwind 4, Zustand 5, Radix UI, Lucide icons                       |
| Rendering     | React Three Fiber + three.js, orthographic + demand rendering                         |
| Geometry      | `polygon-clipping`, custom Manhattan / 45° routers, MST ratsnest                      |
| 3D import     | `occt-import-js` (STEP), background ZIP+STEP conversion                               |
| Tests         | Bun Test (backend), Vitest 4 (frontend), Playwright (e2e)                             |
| Observability | Sentry (`@sentry/electron`, `@sentry/react`, `@sentry/node`)                          |
| Packaging     | `electron-builder` → dmg/zip (mac), Setup.exe + nupkg (win), deb/rpm/AppImage (linux) |

## Architecture

OpenPCB enforces strict one-way layer dependencies:

```
electron/  ──spawns──►  core/backend (in-process)
                         │
modules/*  ─────────►  sdks/*  ─────────►  shared/*  ─────────►  core/*
```

| Layer       | Responsibility                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `core/`     | Pure infrastructure: HTTP server, router, module loader, DB factory, errors. Zero business logic. |
| `shared/`   | ECS world, command/patch infrastructure, canvas engine, geometry, UI primitives.                  |
| `sdks/`     | Pure inter-module contracts (`@sdks/library`, `@sdks/designer`, …) — types only.                  |
| `modules/*` | Self-contained vertical slices: manifest + backend + frontend + migrations + domain.              |
| `electron/` | Thin OS shell: windows, IPC, updater, lifecycle.                                                  |

### Active modules

| Module      | Kind  | Depends on | Status                                     |
| ----------- | ----- | ---------- | ------------------------------------------ |
| `library`   | space | —          | symbols, footprints, KiCad import, seeding |
| `designer`  | space | `library`  | schematic ✅, PCB layout 🚧 (phase 4)      |
| `tasks`     | tool  | —          | persisted runtime, SSE, hidden sidebar     |
| `assistant` | space | `tasks`    | dev-only, OpenAI/Ollama/LM Studio          |

### Designer command flow

```
CommandEnvelope
  → idempotency check (command log)
  → load DesignWorld (ECS)
  → validate baseRevision
  → command-bus dispatch
  → handler plans patches
  → apply + persist
  → publish invalidation
  → CommandResult (with inverse patch for undo)
```

Reads go through `SchematicProjection` (`projection-read.ts`, `projection-world.ts`). PCB placements are auto-synced from schematic changes. See [`docs/COMMAND_PATTERN.md`](docs/COMMAND_PATTERN.md), [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md), [`docs/PROPOSED_ARCHITECTURE.md`](docs/PROPOSED_ARCHITECTURE.md).

### Module HTTP routing

- Public URL: `/api/modules/{moduleId}/{subpath}`
- Core routes: `GET /api/health`, `GET /api/diagnostics`, `GET /api/modules/registry`
- Errors use `application/problem+json` (RFC 7807) with `https://openpcb.dev/problems/*` types.

## Repository layout

```
src/
├── core/
│   ├── backend/        Bun HTTP runtime, module loader, router, DB (own workspace)
│   ├── frontend/       React 19 + Vite 7 + Tailwind 4 (own workspace)
│   └── contracts/      app/* + modules/* type contracts
├── modules/
│   ├── library/        components, symbols, footprints, KiCad import
│   ├── designer/       schematic + PCB editor (commands, history, projection, pcb/)
│   ├── tasks/          task tracking + SSE
│   └── assistant/      AI assistant (dev)
├── sdks/               public inter-module contracts
└── shared/             ECS, commands, canvas engine, rendering, UI primitives
electron/               Electron main + preload + embedded backend manager
scripts/                module CLI, codegen, sourcemap upload
docs/                   architecture + command-pattern + data-model
tests/e2e/              Playwright
```

## Quick start

Requirements: **Node 20+**, **npm 10.9+**, **Bun ≥ 1.3** (backend runtime/tests).

```bash
git clone https://github.com/andrejvysny/OpenPCB.git
cd OpenPCB
npm install
```

### Run in the browser (dev backend + Vite)

```bash
npm run dev
# backend  → http://127.0.0.1:3000
# frontend → http://127.0.0.1:1420  (proxies /api and /ws → 3000)
```

### Run as a desktop app

```bash
npm run dev:electron     # alias: dev:desktop
```

### Build installers

```bash
npm run build            # frontend bundle + electron-builder make for current OS
# Per-OS in electron workspace:
npm run make:mac --workspace electron
npm run make:win --workspace electron
npm run make:linux --workspace electron
```

CI builds and publishes artifacts (dmg/zip, Setup.exe/nupkg/RELEASES, deb/rpm/AppImage) on `v*` tags via `.github/workflows/release-electron.yml`.

## Commands reference

| Command                      | What it does                                                  |
| ---------------------------- | ------------------------------------------------------------- |
| `npm run dev`                | Backend + Vite (browser mode)                                 |
| `npm run dev:electron`       | Vite + Electron shell with embedded backend                   |
| `npm run dev:backend`        | Bun backend only (`--watch`, port 3000)                       |
| `npm run dev:frontend`       | Vite dev server only (port 1420)                              |
| `npm run dev:browser`        | Backend + Playwright UI runner                                |
| `npm run build`              | Frontend bundle + electron-builder make                       |
| `npm run typecheck`          | Composite `tsc -b` over backend/frontend/modules              |
| `npm run test:backend`       | Bun test suite (`src/core/backend`)                           |
| `npm run test:react`         | Vitest (`src/core/frontend`)                                  |
| `npm run test:e2e`           | Playwright e2e                                                |
| `npm run module`             | Interactive module CLI                                        |
| `npm run module:create`      | Scaffold a new module                                         |
| `npm run module:validate`    | Validate all module manifests                                 |
| `npm run modules:generate`   | Codegen module registry → `frontend/src/generated/modules.ts` |
| `npm run sdk:generate`       | Codegen SDK barrels → `frontend/src/generated/sdk/`           |
| `npm run gen` / `gen:check`  | Run codegen / fail if generated files are dirty               |
| `npm run db:generate`        | `drizzle-kit generate`                                        |
| `npm run db:studio`          | `drizzle-kit studio`                                          |
| `npm run release:sourcemaps` | Upload sourcemaps post-release                                |

Single-file test runs:

```bash
cd src/core/backend && bun test tests/<file>.test.ts
cd src/core/frontend && npx vitest run path/to/file.test.tsx
```

## Environment variables

| Variable                    | Default                         | Purpose                                         |
| --------------------------- | ------------------------------- | ----------------------------------------------- |
| `PORT`                      | `3000`                          | Backend port                                    |
| `HOST`                      | `127.0.0.1`                     | Backend bind address                            |
| `OPENPCB_DB_PATH`           | `dev-data/openpcb.sqlite` (dev) | SQLite path (prod: `~/.openpcb/data.sqlite`)    |
| `OPENPCB_WORKSPACE_ROOT`    | derived                         | Module discovery root (defaults to repo `src/`) |
| `OPENPCB_ALLOWED_ORIGINS`   | localhost:1420, :3000, tauri    | Comma-separated CORS origins                    |
| `OPENPCB_DEBUG_DIAGNOSTICS` | `false`                         | Enables `/api/diagnostics/debug/modules`        |
| `NODE_ENV`                  | —                               | `development` / `test`                          |

## Creating a new module

```bash
npm run module:create        # interactive scaffolder
npm run modules:validate     # validates all manifests
npm run gen                  # regenerate module + sdk indexes
```

Each module needs:

```
src/modules/<id>/
├── manifest.json            # id, namespace, apiVersion: 2, sidebar, dependsOn
├── module.backend.ts        # exports ModuleDefinition (default|definition|backendModule)
├── module.frontend.ts       # exports { manifest, Space }
├── backend/
│   ├── migrations/0000_*.sql   # auto-applied on boot, transactional, tracked in openpcb_migrations
│   └── routes.ts
└── frontend/Space.tsx
```

Module routes are mounted under `/api/modules/{id}/...`. SDKs are registered against tokens in `src/sdks/index.ts` and consumed via the `RuntimeSdkRegistry`.

## TypeScript path aliases

- `@modules/*` → `src/modules/*`
- `@sdks/*` → `src/sdks/*`
- `@shared/*` → `src/shared/*`
- `@/*` → `src/core/frontend/src/*` (frontend only)

## Troubleshooting

- **Backend won't boot** — check `OPENPCB_DB_PATH` is writable; module SQL migrations run transactionally on startup. See `/api/diagnostics`.
- **Module not appearing** — re-run `npm run gen`; confirm `manifest.json` `apiVersion: 2` and unique `id`; check topological order in logs.
- **Stuck STEP/3D conversion** — import commits first, conversion runs in background; use the Library 3D preview retry control.
- **macOS "developer cannot be verified" beta** — see [`electron/README-BETA-INSTALL.md`](electron/README-BETA-INSTALL.md).

## License

Released under the **PolyForm Noncommercial License 1.0.0**. Use, modification, and distribution are permitted for noncommercial purposes only. See [`LICENSE`](LICENSE) for the full text.

## Contributing

Contributions are welcome while OpenPCB matures. Before opening a PR:

1. `npm run typecheck && npm run test:backend && npm run test:react`
2. `npm run gen:check` (no uncommitted codegen drift)
3. Respect layer rules: `modules → sdks + shared → core`. Never import across module internals.
4. Follow existing module structure; add SQL migrations rather than ad-hoc schema patches.

For architecture-shaping changes, open an issue first.
