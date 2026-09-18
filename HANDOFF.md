# Handoff — PCB correctness-hardening program, Session 15 (high-speed architecture runway)

Session 5 · 2026-09-18

## Goal

One physical PCB model that connectivity, geometry, zones, pours, routing, DRC, manufacturing checks
and export all consume (`docs/pcb-hardening/PROGRAM.md`). This session delivered **S15 — the
high-speed architecture runway** (contract `docs/pcb-hardening/15-high-speed-runway.md`, binding).
Committed on the user's word: **`0f7c002`** (S15), **`54b08f2`** (JLCPCB source research for S15b), then the
handoff files. The tree is clean.

## Original plan

`~/.claude/plans/typed-discovering-glacier.md` (rev 3): 3 Explore scouts → plan-critique (opus
`Plan`, 24 findings) → Astra run 0 (brainstorm, xhigh, prompt-only) → scope decision **T1+** (user):
the compatibility contract, the one true dead end fixed, side defects registered, the stack-up
model split off as **S15b**. Execution: `impl-careful` for the serializer ∥ Fable inline for the
export refusal + contract → `reviewer-critical` R1 (16 executed probes) → fix round → gates → docs.

## Done so far (and why)

- **Contract 15**: capability ladder L0–L4, the dead-end register, eight binding extension rules
  (§3: future SI consumes the junction GRAPH never the `NetPath` scalars; join-never-rename;
  nominal ≠ finished copper; reference planes are derived candidates; broadside = a new measure;
  extended nets = composition; stitched copper = a result variant; canonical-grid stack numerics),
  the stack-up brief for S15b (§4), registered findings (§7), ledgers (§8).
- **Settings survival** (the only irreversible dead end): every board-settings write goes through
  `serializeBoardSettings` (`backend/pcb/board-settings-serialize.ts` +
  `board-settings-known-keys.ts`; `pcb-store.ts` `loadBoardSettingsRow` /
  `serializePcbBoardSettings`; the KiCad importer's two writes). `schemaVersion` stamped; unknown
  keys carried at the top level, in `designRules` + sub-blocks, `viewState` + `autoLayoutConfig`,
  on id-keyed rows and nested objects; every unparseable row rescued raw with its net-class
  assignments; rule scopes paired by CONTENT; typed projection untouched. 32 tests.
- **6+-layer export refusal**: `export/index.ts` throws 422 `export-unsupported-layer-count` (it
  shipped F.Cu / B.Cu only); the export dialog renders the refusal and disables Export; the
  assistant `designer_export_manufacturing` tool returns `ok: false` with the reason.
- **Docs**: OPEN_FINDINGS "S15" (S15-1 / S15-2 closed, S15-3..S15-10 filed), PROGRAM (S15 done, new
  S15b row, graph, exit gates, Astra table, decisions bullet), 00 / 10 / 13 / 14 pointers → S15b,
  designer `AGENTS.md` (the one-serializer rule), hardening-skill scope, `TODO.md`.
- **Dead ends ruled out**: recording via traversal / clipped spans in `NetPath` (re-derivable, and
  the proposed shapes were insufficient); a stackup accessor with no producer (dominated); the
  full stack-up in this session (its hybrid via length is non-additive:
  `L(F,In2) + L(In2,B) = D_Cu − (t_F + t_B)/2 ≠ boardThicknessMm`; bounding surfaces unsourced);
  index-paired scope carry-over (moves data onto the wrong scope).

## How to resume

1. Run the `handoff` skill with "resume".
2. `git status` — expect a clean tree; `git log --oneline -5` shows `0f7c002` (S15), `54b08f2`
   (source research), `7c8c0af` + one refresh (handoff files). Not pushed.
3. Cheap gates: `cd src/core/backend && bun test board-settings-serialize designer-export
   assistant-export-refusal drc-golden` and `npx tsc -b --force 2>&1 | grep -c "error TS"` (44, repo root).
4. Next (plan mode first via `/fable-orchestrator` + `/pcb-hardening-review`): **S15b — board
   stack-up model** (user decisions 2026-09-18: before S16; includes a minimal stack-up editor).
   Read contract 15 §4 (the brief) and `docs/pcb-hardening/sources/jlcpcb-stackup-2026-09-18.md`
   first. The shared-tags follow-up → S12c stays parked until the user tags `../shared`.

## Open questions

- RESOLVED 2026-09-18: S15b runs before S16; it includes a minimal stack-up editor; the JLCPCB
  reference is researched — the nominal thickness is a label with ± 10 % / ± 0.1 mm tolerance and
  NO stated bounding surfaces (template sums run −10.8 % … +10.4 % of nominal), so a stack-up sum is
  a problem only outside the fab tolerance and every axial length comes from declared items.
- S15b: is a second fab (PCBWay) reference needed; where does the editor live (design-rules dialog
  vs its own panel); does `layerCount` get its write command in the same session (S15-4)?
- S15-10: a sourced per-fab inner-copper default (JLCPCB builds 0.5 oz inner; OpenPCB falls back to
  the outer weight) — fix in S15b or with the fab presets?
- Product: is future "delay" routed-copper, tap-to-tap or pin-to-pin; is reference analysis
  descriptive or normative (contract 15 §6)?
- Whether the user has tagged `../shared` (still `e882332` on 2026-09-18) — S12c depends on it.

## Pointers

- Tasks → `TODO.md` ("Now — handoff" block) · Snapshot → `CURRENT_STATE.md` · Session scratch →
  `/private/tmp/claude-501/-Users-andrejvysny-workspace-openpcb-OpenPCB/95caf7cc-e8d9-4b0b-ab0a-0535b277c298/scratchpad/s15/`
  (plan rev 3, Astra run 0 output, R1 probes, gate logs; temporary).
