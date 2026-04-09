# Refactor batch

- [x] Verify exact source/target file sets for Designer + ComponentLibrary
- [x] Execute filesystem moves into modules/designer and modules/component-library
- [x] Delete all Tauri v2 / Rust obsolete files
- [x] Remove empty legacy directories and verify final tree

# Core backend migration (runtime + transport minimal)

- [x] Create `core/backend` package scaffolding (package.json, tsconfig, bunfig)
- [x] Implement Bun runtime with `/api/health` and `/api/diagnostics`
- [x] Implement router abstractions + module router registry/dispatch contracts
- [x] Implement middleware stack (error/problem-details, CORS, request logging)
- [x] Add Bun tests for health/diagnostics/error contract/module routing
- [x] Switch root scripts/build entrypoint from `src-ts` to `core/backend`
- [x] Run backend tests and typecheck, fix regressions

# Modular infra refactor (core canonical)

- [x] Define new module contracts (backend entry, frontend entry, registry payload, SDK registry)
- [x] Implement `core/backend` module bootstrap (manifest scan, dependency-aware load, skip dependents on failure)
- [x] Register module HTTP routes from backend entrypoints into `ModuleRouterRegistry`
- [x] Expose module registry/status API for frontend bootstrap (`/api/modules/registry`)
- [x] Implement `core/frontend` module shell (registry fetch, module nav, dynamic module space loading)
- [x] Add per-module core entry wrappers under `modules/*/core/*` without touching module business logic
- [x] Add backend tests for module bootstrap/status + dependency skip behavior
- [x] Run backend/frontend typecheck + tests, fix regressions

# Component-library native migration + capability wiring

- [x] Replace `component-library` backend placeholder with native core routes (`parts`, `symbols`, `footprints`)
- [x] Register `ComponentLibrarySDK` in runtime SDK registry from native module entry
- [x] Wire `AIServiceSDK` stub registration in `ai-service` module entry
- [x] Add core runtime `ProjectsCapability` and expose as `core.projects` SDK token
- [x] Extend module backend context with `db` + `core.projects`
- [x] Mount selective real component-library UI in core frontend (live parts search/list)
- [x] Add strong backend tests for component-library native routes + SDK/capability exposure
- [x] Re-run backend tests/typecheck, frontend typecheck/build, backend startup smoke, sidecar compile

# Designer read-only native migration + debug diagnostics

- [x] Replace `designer` backend placeholder with native read-only routes (`designs`, `entities`, `netlist`, `projects`)
- [x] Wire designer read routes to `ComponentLibrarySDK` for part resolution
- [x] Wire designer read routes to `core.projects` read-only capability
- [x] Add debug-only module diagnostics route (`/api/diagnostics/debug/modules`) gated by `OPENPCB_DEBUG_DIAGNOSTICS=true`
- [x] Expose runtime debug snapshot (loaded modules, dependency graph, sdk tokens)
- [x] Add contract tests for designer read-only routes and debug diagnostics
- [x] Re-run backend tests/typecheck, backend startup smoke, sidecar compile

# ComponentLibrary hardening phase (canvas core extraction + designer disable)

- [x] Add `enabled` support to manifest contract/loader and skip disabled modules
- [x] Disable Designer via manifest and hide non-loaded modules from sidebar
- [x] Replace designer contract test with disabled-module coverage
- [x] Extract core `editor-canvas` foundations (coords/layers/utils/camera/interaction)
- [x] Add core canvas primitives (`GridShader`, `SymbolBody`, `PinDots`, `PadInstances`, `EDAText`)
- [x] Add `editor-canvas` barrel exports (`index.ts`, `primitives/index.ts`)
- [x] Rewire ComponentLibrary R3F adapters to core `@/editor-canvas/*` imports
- [x] Rewire adapter tests to mock core `editor-canvas` module paths
- [ ] Finish remaining generic helper extraction (selection/history/drag-snap intent helpers)
- [ ] Implement ComponentLibrary backend canonical parse/import DTO API (new API only)
- [ ] Complete ComponentLibrary import+detail-first UX wiring in module `Space.tsx`
- [ ] Run full validation pass (`core/backend bun test`, frontend tests subset, frontend build, backend smoke, bun compile)
