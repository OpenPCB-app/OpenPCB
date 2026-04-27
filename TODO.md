# OpenPCB Rewrite Tracking

## Decisions (locked)

- ECS storage: JSON blob per entity
- Command idempotency: keep command log table
- Net rebuild: full rebuild on each relevant change
- Schematic→PCB sync: auto-sync on schematic changes
- Migrations: automatic on startup

## Deliverable Target

- Architecture + working schematic editor on new foundations (Phase 1 + Phase 2)

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
- [ ] Enable real undo/redo in backend + frontend controls
- [ ] Add focused unit tests for command handlers and systems

## Phase 3 — Basic PCB Foundation (later)

- [ ] Add PCB entity/component types and persistence
- [ ] Auto-sync schematic netlist/entities into PCB model
- [ ] Basic PCB view: component placement + ratsnest

## Current Status

- Phase 1 infrastructure established and validated.
- Next: connect designer backend/store to shared ECS + patch/history primitives.
