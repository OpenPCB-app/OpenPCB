# OpenPCB agent notes

Compact repo facts only. If this conflicts with executable config, trust config.

## Stack and package boundaries

- npm workspaces only: `src/core/backend`, `src/core/frontend`, `electron` (`packageManager: npm@10.9.2`). Bun is the backend runtime/test runner, not the root package manager.
- App shape: Bun HTTP backend + React 19/Vite 7/Tailwind 4 frontend + Electron shell + shared SQLite/Drizzle DB.
- Real source roots: `src/core/*` infrastructure, `src/modules/*` feature modules, `src/sdks/*` cross-module SDK contracts, `src/shared/*` shared rendering/domain code.
- Active modules are `library` and `designer`; `designer` has required dependency `library >=0.1.0`.
- Module route shape is `/api/modules/{moduleId}/{subpath}`. `/api/modules/registry` is a core route, not module dispatch.

## Entry points and wiring

- Backend starts at `src/core/backend/main.ts`: `ModuleRuntime.bootstrap()` before `createHttpServer()`/`Bun.serve()`.
- Module bootstrap: discover manifests -> resolve dependencies -> run `backend/migrations/*.sql` -> import backend entry -> `onActivate` -> `registerSdk` -> `registerRoutes`.
- Module backend export may be `definition`, default, or `backendModule`; its `id` must match `manifest.json`.
- Frontend entry: `src/core/frontend/src/main.tsx`; provider stack in `App.tsx` is `RuntimeProvider -> BootstrapProvider -> ThemeProvider -> AppShell`.
- Electron dev loads Vite at `127.0.0.1:1420` and does not spawn backend; packaged Electron spawns the compiled Bun sidecar and waits for the first JSON stdout line containing `serverPort`.

## Commands that matter

```bash
npm run dev              # backend (:3000) + frontend (:1420)
npm run dev:electron     # backend + frontend + electron watch/start
npm run dev:backend      # cd src/core/backend && PORT=3000 NODE_ENV=development bun --watch main.ts
npm run dev:frontend     # Vite only

npm run typecheck        # root composite tsc -b; excludes electron
npm run build            # compile Bun sidecar, frontend build, electron build+dist
npm run bun:compile      # builds bin/bun-backend-{rust-host-triple}

npm run test:backend     # workspace bun test
npm run test:react       # frontend vitest
npm run test:e2e         # Playwright; starts fresh backend/frontend

npm run module:validate  # manifest validation via registry generator
npm run module:codegen   # registry + SDK only
npm run gen:check        # fails if generated modules/sdk differ from git
```

- Focused backend test: `cd src/core/backend && bun test path/to/file.test.ts`.
- Focused frontend test: `npm run test --workspace src/core/frontend -- path/to/file.test.tsx`.
- `npm run db:migrate` is a no-op note; module SQL migrations apply on backend startup.
- `scripts/README.md` mentions Rust types/bridge codegen and root scripts that no longer exist; current CLI only does registry + SDK.

## Tests and runtime quirks

- Playwright config uses Chromium only, baseURL `http://127.0.0.1:1420`, and resets `/tmp/openpcb-e2e.sqlite*` via `OPENPCB_DB_PATH=/tmp/openpcb-e2e.sqlite`.
- Backend default DB path: dev `dev-data/openpcb.sqlite`, prod `~/.openpcb/data.sqlite`; override with `OPENPCB_DB_PATH`.
- Shared SQLite is singleton, WAL enabled, foreign keys on, module tables are prefix-partitioned.
- Module migrations are lexicographic `.sql` files, split by `--> statement-breakpoint`, tracked in `openpcb_migrations`, wrapped in `BEGIN IMMEDIATE`.
- Set `OPENPCB_WORKSPACE_ROOT` only when module discovery runs from an unusual cwd; default loader already searches for `src/modules`.

## Import and architecture rules

- Modules must not import `src/core/backend/*` or `src/core/frontend/*`; use `src/core/contracts/*`, `src/sdks/*`, and `src/shared/*`.
- Keep business/domain logic out of `src/core/*`; core is transport/runtime/module infrastructure.
- Error responses use RFC 7807 problem details (`application/problem+json`).
- Root TS aliases: `@modules/*`, `@sdks/*`, `@shared/*`; frontend also has `@/* -> src/core/frontend/src/*`.
- Frontend has no React Router dependency; routing/state is app-shell + Zustand/module registry based.

## Rendering / EDA-specific rules

- Editor rendering is React Three Fiber only: no Canvas2D, no imperative Three.js scene mutation, no `frameloop="always"`; use demand rendering/invalidation.
- For visual/editor work, read `.claude/skills/r3f-eda-rendering/SKILL.md` plus the domain skill: `schematic-editor`, `pcb-layout`, or `library`.
- For DRC, clearances, trace widths, Gerbers, IPC/JLCPCB/PCBWay values, read `.claude/skills/eda-standards/SKILL.md`; do not invent manufacturing constants.

## Known stale guidance to ignore

- Older nested `AGENTS.md` files may still say module routes are `/api/v1/{module}` or module discovery is broken; current code uses `/api/modules/{moduleId}` and the loader has fallback discovery.
- `bun.lock` is stale relative to root `package.json`; use `package-lock.json`/npm workspaces for dependency truth.
- Do not auto commit/push/pull; only when explicitly asked.
