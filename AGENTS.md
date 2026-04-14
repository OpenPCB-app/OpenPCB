# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-14
**Branch:** aggresive-cleanup
**Type:** Desktop PCB design suite

## OVERVIEW

OpenPCB — Bun HTTP backend + React 19/Vite 7/Tailwind 4 frontend + Electron shell + SQLite (Drizzle ORM). Mid-restructuring branch. Module renamed: `component-library` → `library`.

## STRUCTURE

```
./
├── src/
│   ├── core/           # Infrastructure (backend + frontend + contracts)
│   ├── modules/        # Feature modules (only library currently)
│   └── shared/         # Canvas engine (frontend/canvas/), backend placeholder
├── electron/           # OS shell (spawns backend as child)
├── scripts/            # Module CLI, codegen, bun sidecar compile
├── docs/               # PROPOSED_ARCHITECTURE.md, COMMAND_PATTERN.md, DATA_MODEL.md
├── tests/e2e/          # Playwright E2E tests
└── .claude/skills/     # 5 domain-specific Claude Code skills
```

## WHERE TO LOOK

| Task              | Location                                                     | Notes                                                        |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Add backend route | `src/core/backend/router/`                                   | Mounts in module-loader.ts                                   |
| Add module        | `src/modules/<name>/`                                        | Copy library/ structure, add manifest.json                   |
| Module discovery  | `src/core/backend/modules/module-loader.ts`                  | WorkspaceRoot bug: searches src/core/modules not src/modules |
| Module contracts  | `src/core/contracts/modules/`                                | ModuleDefinition, ModuleManifest, LibrarySDK                 |
| Shared canvas     | `src/shared/frontend/canvas/`                                | Used by editor modules                                       |
| SDK interfaces    | `src/core/contracts/modules/sdk.ts`                          | Pure interfaces (LibrarySDK etc.)                            |
| Entry points      | `src/core/backend/main.ts`, `src/core/frontend/src/main.tsx` | Boot + React mount                                           |
| Fix stale paths   | `package.json` scripts                                       | Many reference src-ts, src-react, core/_ (now src/core/_)    |
| Error handling    | `src/core/backend/contracts/errors.ts`                       | AppError, ValidationError, NotFoundError                     |
| DB setup          | `src/core/backend/db/sqlite-client.ts`                       | Singleton SQLite + Drizzle                                   |
| Module migrations | `src/modules/*/backend/migrations/*.sql`                     | Applied by module-migrator.ts                                |

## CONVENTIONS

- Path alias: `@modules/*` → `src/modules/*`, `@` → frontend `src/`
- Composite TS build: references in tsconfig.json
- Strict mode: `noUncheckedIndexedAccess`, `noImplicitOverride`, ES2022 target
- Bun for backend runtime + tests, npm workspaces at root
- Module routes: `/api/modules/{moduleId}/{subpath}`
- Errors: RFC 7807 problem-details (`application/problem+json`)
- DB: single SQLite, per-module table prefix (e.g., `library_`)
- Frontend state: Zustand (no React Router), context providers for runtime/bootstrap/theme

## ANTI-PATTERNS (THIS PROJECT)

- **Direct core/ imports from modules/** — Use sdks/ + shared/ only
- **Stale path references** — Don't add new refs to src-ts, src-react, core/backend, core/frontend
- **Module workspaceRoot** — Module discovery broken; set OPENPCB_WORKSPACE_ROOT or fix resolution
- **Business logic in core/** — core/ is pure infrastructure only
- **Canvas2D in editors** — All rendering via R3F, never Canvas2D
- **frameloop="always"** — Demand-based rendering only, use `invalidate()`
- **Raw Three.js imperatively** — Use R3F JSX declarative patterns

## COMMANDS

```bash
# Dev
npm run dev              # backend + frontend
npm run dev:electron     # + electron shell
npm run dev:backend      # Bun only (port 3000)
npm run dev:frontend     # Vite only (port 1420)

# Build / check
npm run build            # full bundle
npm run typecheck        # tsc -b composite

# Tests (use these, not root scripts which have stale paths)
cd src/core/backend && bun test          # backend
cd src/core/frontend && npx vitest run   # frontend
bun test path/to/file.test.ts            # single backend test
npm run test:e2e                         # Playwright E2E

# Module system
npm run module           # interactive CLI
npm run module:validate  # check manifests
npm run module:codegen   # regenerate SDKs
npm run gen              # full codegen pipeline
```

## ENVIRONMENT VARIABLES

| Variable                    | Default                      | Purpose                                  |
| --------------------------- | ---------------------------- | ---------------------------------------- |
| `PORT`                      | 3000                         | Backend server port                      |
| `HOST`                      | 127.0.0.1                    | Backend bind address                     |
| `OPENPCB_DB_PATH`           | `dev-data/openpcb.sqlite`    | SQLite path                              |
| `OPENPCB_WORKSPACE_ROOT`    | (derived)                    | Set to repo root to fix module discovery |
| `OPENPCB_ALLOWED_ORIGINS`   | localhost:1420, :3000, tauri | CORS origins                             |
| `OPENPCB_DEBUG_DIAGNOSTICS` | false                        | Debug modules endpoint                   |

## SKILLS (SLASH COMMANDS)

Five domain-specific skills in `.claude/skills/`. Use these instead of guessing EDA conventions.

| Skill                | When to use                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/component-library` | Component wizard, symbol/footprint editors, KiCad import, variant model, library↔designer linking, seeding, ComponentPalette UI |
| `/schematic-editor`  | Wire routing (Manhattan 90°), net labels, pin connections, junction detection, net extraction, ERC, tool modes, undo/redo       |
| `/pcb-layout`        | Trace routing (Manhattan + 45°), via placement, pad/footprint rendering, ratsnest (MST), board outline, net classes, Gerber     |
| `/r3f-eda-rendering` | **Any** visual rendering. R3F + demand rendering. Coordinate pipeline: nm→mm→px. InstancedMesh, LineSegments2, hit-testing      |
| `/eda-standards`     | IPC-2221B clearance, trace width formula, manufacturer presets (JLCPCB/PCBWay), layer naming, via specs, DRC values only        |

**Selection guide:**

- Canvas/visual code → `/r3f-eda-rendering` first, then domain skill
- Library module work → `/component-library`
- DRC values, clearances, trace widths → `/eda-standards`

## NOTES

- Designer domain moving from core/backend/designer/ → modules/designer/ (in progress)
- Only library module exists; designer module planned
- Electron spawns Bun backend; frontend proxies /api → :3000
- Drizzle config paths stale (points to src-ts/)
- bunfig.toml test preload path stale (src-ts/test/setup.ts)
