# OpenPCB Rewrite Tracking

## Decisions (locked)

- ECS storage: JSON blob per entity
- Command idempotency: keep command log table
- Net rebuild: full rebuild on each relevant change
- Schematic→PCB sync: auto-sync on schematic changes
- Migrations: automatic on startup

## Deliverable Target

- Architecture + working schematic editor on new foundations (Phase 1 + Phase 2)

## Phase 0 — Browser Dev Stabilization

- [x] Allow frontend dev server to lazy-load `src/modules/*`
- [x] Regenerate module catalog and SDK exports for `library` + `designer`
- [x] Add module/shared TypeScript coverage to root `npm run typecheck`
- [x] Add Playwright browser smoke tests for app boot, module registry, and designer shell
- [x] Verify with typecheck, backend tests, frontend tests, and e2e smoke

## Phase 1 — Architecture Alignment

- [x] Create `src/sdks/` structure (`library`, `designer`, root token map)
- [x] Migrate SDK contracts from `src/contracts/modules/*` to `src/sdks/*`
- [x] Keep backward-compatible facade exports in `src/contracts/modules/*`
- [x] Add shared ECS core (`entity`, `component`, `world`, `query`, `system`)
- [x] Add shared command+patch infrastructure (`patch`, `apply`, `invert`, `history`)
- [x] Add backend tests for new ECS and patch/history foundations
- [x] Verify with `npm run typecheck`
- [x] Verify with backend tests (`bun test`)
- [x] Integrate new shared command/patch infrastructure into designer runtime store
- [ ] Add boundary enforcement lint rules (pending lint infra)

## Phase 2 — Designer Domain Rewrite (next)

- [ ] Define ECS component model for schematic entities (part/wire/label/net)
- [ ] Implement command handlers that emit ECS patches
- [ ] Wire apply/invert/history flow into dispatch pipeline
- [ ] Implement full net rebuild system from ECS world
- [ ] Implement projection builder from ECS world
- [x] Enable real undo/redo in backend + frontend controls
- [x] Add focused backend tests for command idempotency, history, undo/redo, nets, and junctions
- [x] Persist per-session undo/redo snapshots across backend runtime reloads
- [x] Extract designer result parsing, history state, projection/world, and wire geometry helpers from `store.ts`
- [x] Extract command execution from `store.ts` into `command-executor.ts`
- [x] Extract projection read mapping into `projection-read.ts`

## Phase 3 — Basic PCB Foundation (later)

- [ ] Add PCB entity/component types and persistence
- [ ] Auto-sync schematic netlist/entities into PCB model
- [ ] Basic PCB view: component placement + ratsnest

## Current Status

- Phase 1 infrastructure established and validated.
- Next: connect designer backend/store to shared ECS + patch/history primitives.
