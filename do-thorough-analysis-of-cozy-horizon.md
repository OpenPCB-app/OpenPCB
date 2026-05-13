# OpenPCB: Codebase State & Next Steps Plan

## Context

Post-merge cleanup is done; `aggresive-cleanup` merged to master. Phases 1–3 complete; Phase 4 partially shipped. This plan captures the full state and proposes next work priorities.

---

## Current State Summary

### Phases

| Phase                         | Status                           |
| ----------------------------- | -------------------------------- |
| 0 — Browser Dev Stabilization | ✅ Done                          |
| 1 — Architecture Alignment    | ✅ Done (boundary lint deferred) |
| 2 — Designer Domain Rewrite   | ✅ Done                          |
| 3 — Basic PCB Foundation      | ✅ Done                          |
| 4 — PCB Routing + DRC         | ⚠️ Partially shipped             |

### Test counts

- Backend: 124 tests (27 files, Bun) — integration-style, no unit tests in designer backend
- Frontend: 11 tests (Vitest, mostly 3D geometry)
- E2E: smoke only

### Known regressions

- **3D ZIP+STEP import stuck** — `ATTINY13A-SU.zip` stuck at conversion; affects Library → Designer GLB rendering, camera/model fitting. Active TODO; no fixes yet.

---

## What's Implemented (Phase 4 shipped)

**PCB Backend (25+ commands)**

- Traces: Manhattan-90 + Manhattan-45 with chamfer, DRC, net classes, presets
- Vias: through-via model, IPC-4761 protection types, fab presets (JLCPCB/PCBWay)
- Ratsnest: Prim's MST per net, connectivity grouping (UnionFind), pad correlation
- Board settings: outline (rect only), active/visible layers, design rules
- Placement sync from schematic, flip (B.Cu), rotate

**PCB Frontend**

- PcbCanvas (918 lines): selection, drag, marquee, routing state machine, via drop (V), flip/rotate context menu
- PcbScene (738 lines): 16 render passes, trace/via/ratsnest rendering, layer dimming, cross-probe
- Live DRC (trace-trace, trace-pad, net class thresholds)
- 3D canvas (Board3DCanvas, BoardGeometry, CopperTraces, CopperVias, component models)

**Schematic**

- Commands: place/move/rotate/mirror/delete parts, create wire, create junction, GND/PWR/net portals, label upsert
- Rendering: SchematicCanvas (2385 lines), SchematicPrimitivesLayer

**Library**

- KiCad symbol + footprint parsers, ZIP import
- IPC-7351B preset generator
- Drawn footprint editor (6 tools)
- STEP → GLB (OCCT WASM), 3D model storage + routes

---

## Phase 4 Backlog (in-phase items not yet shipped)

Priority order:

1. **Ratsnest visibility toggle UI** — toggle currently implemented in store (`pcb-layer-visibility.ts`) but no UI surface in toolbar. Quick win.
2. **Layer-visibility panel UI** — only active-layer toggle in toolbar; F.Cu/B.Cu/Silk visibility checkboxes need panel. Partially exists in `PcbBoardPanel.tsx` but incomplete.
3. **Marquee / multi-select / group move on PCB** — marquee hit-test geometry exists (`pcb-rect-hit.ts`), `pcb_move_placements` command exists. Wire up selection + bulk move.
4. **Trace editing** — drag segment, break + reconnect, rip-up. No backend support yet; requires new commands.
5. **Explicit `pinmap` field** — `pin.number == pad.number` heuristic works for simple parts; multi-unit ICs need explicit mapping in `LibraryComponent`.

---

## 3D Regression Fix (active TODO)

**Scope:**

- `ATTINY13A-SU.zip` ZIP+STEP import hangs at worker STEP→GLB conversion
- Affects: import wizard UX, Library/Designer GLB rendering, camera fitting
- Files involved:
  - `src/modules/library/frontend/import-wizard/` (ZIP upload, STEP conversion flow)
  - `src/modules/library/frontend/three-d/step-to-glb.ts` + OCCT WASM worker
  - `src/modules/library/backend/routes.ts` (GLB upload endpoint)
  - `src/modules/designer/frontend/three-d/ModelCacheProvider.tsx` (GLB load)
  - `src/modules/designer/frontend/pcb/PcbScene.tsx` (3D projection rendering)

---

## Post-Phase 4 Backlog

| Item                                           | Effort | Value                  |
| ---------------------------------------------- | ------ | ---------------------- |
| Manufacturing export (Gerber, drill, BOM)      | High   | Critical for usability |
| ESLint boundary enforcement                    | Low    | Code health            |
| Copper pours / zones / keepouts                | High   | Core PCB feature       |
| Library variants / families                    | Medium | Reuse + variants       |
| Differential pair routing                      | High   | Signal integrity       |
| Symbol/footprint editor expansion (multi-unit) | Medium | Library completeness   |
| E2E test expansion                             | Medium | Confidence             |
| OpenAPI codegen pipeline                       | Low    | DX                     |

---

## Notable Gaps Found

- `Canvas.tsx` in `src/shared/frontend/canvas/` is **0 bytes** — dead file, safe to delete
- Designer backend has **no unit tests** (all integration)
- Library: IPC-7351B generator, drawn-footprint commit, ZIP extraction **untested**
- Frontend: no canvas/theme/interaction handler tests
- Schematic canvas (2385 lines) is **completely untested**
- Board outline supports **rect only** (polygon outline not implemented)

---

## Agreed Next Sequence

1. **3D regression fix** — `ATTINY13A-SU.zip` ZIP+STEP stuck conversion (active TODO)
2. **Phase 4 backlog** — ratsnest toggle UI → layer-visibility panel → marquee/group-move → trace rip-up & redraw → pinmap field
3. **Post-Phase 4** — Manufacturing export (Gerber/drill/BOM) is highest-value next target

**Trace editing decision (confirmed):** Rip-up & redraw — delete existing trace, re-enter routing from nearest endpoint. No new backend primitives needed beyond existing `pcb_delete_trace` + `pcb_add_trace`.

---

## Remaining Open Questions

1. **Board outline**: polygon outline needed before Gerber export, or rect-only sufficient for now?
2. **Canvas.tsx**: delete the empty 0-byte file?
