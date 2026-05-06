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

## Phase 3 — Basic PCB Foundation (in progress)

- [x] Add PCB board settings entity types and persistence
- [x] Add persisted empty PCB projection with default 100x80mm board
- [x] Add basic PCB tab canvas + board-size settings form
- [x] Add PCB undo/redo with separate history session from schematic
- [x] Fix PCB render ordering (grid < fill < outline)
- [x] Fix canvas remounting on every revision change
- [x] Add PCB entity/component types for placements
- [x] Auto-sync schematic parts into PCB placements (center + deterministic offset)
- [x] Basic PCB view: component placement rendering via FootprintRenderLayer
- [x] Pad world-position helper + net↔pad correlation (pin.number == pad.number)
- [x] Basic PCB view: ratsnest (Prim's MST per net, always-on)
- [x] PCB placement selection + drag-to-move + R rotate, with combined-world undo/redo
- [~] Auto-sync schematic wires into PCB traces — **wontfix**, replaced by ratsnest + manual routing (Phase 4). No real EDA tool does literal wire→trace sync; bridge is the netlist.
- [ ] PCB traces/vias entity types — deferred to Phase 4
- [ ] DRC engine reading PcbDesignRules — deferred to Phase 4

## Phase 4 — PCB routing + DRC (next)

- [ ] Trace/via entity model + migrations
- [ ] Manual trace routing tool (Manhattan + 45°, see /pcb-layout skill)
- [ ] Layer switching on V key (pad↔via)
- [ ] DRC violations rendered against PcbDesignRules
- [ ] Net classes applied to routed traces
- [ ] Ratsnest visibility toggle UI (currently always-on)
- [ ] Marquee / multi-select / group move on PCB
- [ ] Explicit pinmap field in LibraryComponent (currently relies on pin.number == pad.number)

## Current Status

- Phase 1 infrastructure established and validated.
- Phase 3 PCB foundation complete: board, placements, ratsnest, selection, move, rotate, full undo/redo.
- Backend: 56 tests passing. Frontend: 11 tests passing. Typecheck clean.
- Next: Phase 4 — trace routing + DRC.
