# OpenPCB Roadmap

Public roadmap for the OpenPCB desktop application. This is a living document and may shift as feedback arrives — the order below reflects current priorities, not commitments.

## v0.1.x-beta — first public beta (current)

Shipped:

- Schematic capture: symbol placement, Manhattan wire routing, net labels, junction detection, net extraction, ERC scaffolding, full undo/redo
- PCB layout: trace routing (Manhattan + 45°), via placement with V-key layer switch, pad rendering, MST ratsnest, board outline, component placement, live DRC, IPC-2221B-aware net classes
- Component library: symbols, footprints (IPC-7351B preset generator + drawn editor), variants, KiCad `.kicad_sym` / `.kicad_mod` import, built-in seeded components, 3D models via STEP → GLB
- Manufacturing export: Gerber X2, Excellon drill, BOM, Pick-and-Place, single-ZIP export
- Module runtime: dynamic discovery, topological boot, per-module SQLite + auto-applied migrations, codegenerated SDK + module registry
- Cross-platform Electron desktop (macOS arm64/x64, Windows x64, Linux x64) — **unsigned in this beta**

## v0.1.1-beta — first patch

- CoreLibrary: pre-bake GLBs into the `.opclib` pack (currently STEP-only; OpenPCB converts on import). Needs a Node-side STEP→GLB tool (occt-import-js + GLB writer) plus per-model visual verification.
- Frontend Vitest coverage uplift (currently 4 files).
- Bug-fix backlog from beta feedback.

## Phase 4 polish — next minor releases

- Trace segment drag-edit
- Net-class-aware width / clearance on routing
- Silkscreen text rasterization in Gerber export
- 4-layer board support (currently 2-layer only)
- Differential pair routing
- Copper zones / pours

## Phase 5 — production readiness

- Code signing + notarization (macOS Developer ID, Windows EV)
- `electron-updater` live feed once signing exists
- ESLint module-boundary enforcement
- Expanded frontend test coverage
- Sentry crash reporting (opt-in, off by default — wiring already exists)

## Out of scope for v1.0

- Cloud sync, multi-user collaboration, library marketplace (separate SaaS, closed source)
- Autorouting beyond manual + DRC-assisted

## How to influence the roadmap

Open a GitHub issue with the `discussion` or `feature_request` label and explain the use case. Roadmap items are weighted by user demand, technical risk, and license compatibility.
