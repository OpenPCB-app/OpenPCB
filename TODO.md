# OpenPCB Rewrite Tracking

## Decisions (locked)

- ECS storage: JSON blob per entity
- Command idempotency: keep command log table
- Net rebuild: full rebuild on each relevant change
- Schematic→PCB sync: auto-sync on schematic changes
- Migrations: automatic on startup

## Current Status

- Branch `aggresive-cleanup` merged to `master`. Phases 1–3 complete; Phase 4 partially shipped (trace routing, vias, layer switching, live DRC, ratsnest).
- Backend: 124 tests passing (19 files). Frontend: 11 tests passing. Typecheck clean.
- Active sprint: post-merge cleanup + dead-code removal (see plan in `.claude/plans/act-as-senior-software-resilient-meadow.md`).

## Phase 0 — Browser Dev Stabilization (done)

- [x] Frontend lazy-loads `src/modules/*`
- [x] Module catalog and SDK exports for `library` + `designer`
- [x] Module/shared TypeScript coverage in root `npm run typecheck`
- [x] Playwright browser smoke tests
- [x] Verified: typecheck + backend + frontend + e2e

## Phase 1 — Architecture Alignment (done except boundary lint)

- [x] `src/sdks/` structure (`library`, `designer`, root token map)
- [x] SDK contracts migrated from `src/contracts/modules/*` to `src/sdks/*`
- [x] Backward-compatible facade exports in `src/contracts/modules/*`
- [x] Shared ECS core (`entity`, `component`, `world`, `query`, `system`)
- [x] Shared command+patch infrastructure (`patch`, `apply`, `invert`, `history`)
- [x] Backend tests for ECS and patch/history foundations
- [x] Shared command/patch infrastructure integrated into designer runtime store
- [ ] Boundary enforcement lint rules (deferred — see Backlog)

## Phase 2 — Designer Domain Rewrite (done)

- [x] ECS component model for schematic entities (part/wire/label/net/primitive)
- [x] Command handlers emit ECS patches
- [x] Apply/invert/history flow wired into dispatch pipeline
- [x] Full net rebuild system from ECS world
- [x] Projection builder from ECS world
- [x] Real undo/redo in backend + frontend controls
- [x] Backend tests for command idempotency, history, undo/redo, nets, junctions
- [x] Per-session undo/redo snapshots persisted across runtime reloads
- [x] Designer result parsing, history state, projection/world, wire geometry helpers extracted from `store.ts`
- [x] Command execution extracted into `command-executor.ts`
- [x] Projection read mapping in `projection-read.ts`

## Phase 3 — Basic PCB Foundation (done)

- [x] PCB board settings entity types and persistence
- [x] Persisted empty PCB projection with default 100x80mm board
- [x] Basic PCB tab canvas + board-size settings form
- [x] PCB undo/redo with separate history session from schematic
- [x] PCB render ordering (grid < fill < outline)
- [x] Canvas mount stable across revision changes
- [x] PCB entity/component types for placements
- [x] Auto-sync schematic parts into PCB placements (center + deterministic offset)
- [x] Component placement rendering via FootprintRenderLayer
- [x] Pad world-position helper + net↔pad correlation (pin.number == pad.number)
- [x] Ratsnest (Prim's MST per net, always-on)
- [x] PCB placement selection + drag-to-move + R rotate, with combined-world undo/redo
- [~] Schematic wire → PCB trace auto-sync — **wontfix**, replaced by ratsnest + manual routing. Bridge between schematic and PCB is the netlist.

## Phase 4 — PCB routing + DRC (partially shipped)

Shipped:

- [x] Trace + via entity model + migrations (`0005_pcb_traces.sql`)
- [x] Manual trace routing tool (Manhattan-90 + Manhattan-45 with corner chamfer)
- [x] Layer switching on V key (smart via: + / - flips layer, v drops via)
- [x] Live DRC (trace-trace + trace-pad clearance, same-net skip, same-layer filter, design-rule + net-class fallback)
- [x] Net classes applied via trace presets (Default/Power/GND with width/clearance/via dims)
- [x] Trace presets array on board settings ([0.15, 0.2, 0.25, 0.5, 1.0] mm)
- [x] Posture cycling (auto/axis/diagonal via `/` key)
- [x] Cursor layer chip + 45° corner chamfer
- [x] Schematic primitives (GND/PWR/net portals + wiring + edits)
- [x] Label upsert
- [x] Footprint editor + IPC-7351B preset generator + drawn-footprint commit path

Backlog:

- [ ] Marquee / multi-select / group move on PCB
- [ ] Trace editing (drag segment, break + reconnect, rip-up & retry)
- [ ] Layer-visibility panel UI (currently only active layer toggleable from toolbar)
- [ ] Ratsnest visibility toggle UI (currently always-on)
- [ ] Explicit `pinmap` field in `LibraryComponent` (currently relies on `pin.number == pad.number`)

## Backlog (post-Phase 4)

- [ ] ESLint + `eslint-plugin-boundaries` for compile-time `core ← shared ← sdks ← modules` enforcement
- [ ] Manufacturing export — Gerber, drill, BOM
- [ ] Library variants / families / presets / provenance
- [ ] Differential pair rules + length tuning
- [ ] Copper pours / zones / keepouts
- [ ] Symbol/footprint editor expansion (multi-unit, alt graphical body styles)
- [ ] OpenAPI codegen pipeline (revisit `gen:openapi` if/when frontend SDK regen is needed)
- [ ] E2E test expansion (currently smoke only)
