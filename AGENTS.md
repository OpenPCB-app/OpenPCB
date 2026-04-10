# PROJECT KNOWLEDGE BASE

**Generated:** 2025-01-09  
**Branch:** aggresive-cleanup  
**Type:** Desktop PCB design suite

## OVERVIEW

OpenPCB — Bun HTTP backend + React 19/Vite/Tailwind 4 frontend + Electron shell + SQLite (Drizzle). Mid-restructuring branch.

## STRUCTURE

```
./
├── src/
│   ├── core/           # Infrastructure (backend + frontend + contracts)
│   ├── modules/        # Feature modules (only component-library currently)
│   └── shared/         # Domain platform (ECS, canvas, commands)
├── electron/           # OS shell (spawns backend as child)
├── scripts/            # Build/codegen
└── docs/               # Architecture docs
```

## WHERE TO LOOK

| Task                    | Location                                                 | Notes                                                        |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| Add backend route       | src/core/backend/router/                                 | Mounts in module-loader.ts                                   |
| Add module              | src/modules/<name>/                                      | Copy component-library structure                             |
| Change module discovery | src/core/backend/modules/module-loader.ts                | WorkspaceRoot bug: searches src/core/modules not src/modules |
| Shared canvas           | src/shared/frontend/canvas/                              | Used by designer + component-library                         |
| SDK interface           | src/sdks/ (docs)                                         | Pure interfaces only                                         |
| Entry points            | src/core/backend/main.ts, src/core/frontend/src/main.tsx | Boot + React mount                                           |
| Fix stale paths         | package.json scripts                                     | Many reference src-ts, src-react, core/_ (now src/core/_)    |

## CONVENTIONS

- Path alias: `@modules/*` → `src/modules/*`
- Composite TS build: references in tsconfig.json
- Strict mode: `noUncheckedIndexedAccess`, `noImplicitOverride`
- Bun for backend scripts, npm workspaces for root

## ANTI-PATTERNS (THIS PROJECT)

- **Direct core/ imports from modules/** — Use sdks/ + shared/ only
- **Stale path references** — Don't add new refs to src-ts, src-react, core/backend, core/frontend
- **Module workspaceRoot** — Module discovery broken; set OPENPCB_WORKSPACE_ROOT or fix resolution
- **Business logic in core/** — core/ is pure infrastructure only

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

# Module system
npm run module           # interactive CLI
npm run module:validate  # check manifests
npm run module:codegen   # regenerate SDKs
```

## NOTES

- Drizzle config paths stale (points to src-ts/)
- Designer domain moving from core/backend/designer/ → modules/designer/ (in progress)
- Only component-library module exists; designer module planned
- Electron spawns Bun backend; frontend proxies /api → :3000
