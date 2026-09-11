# Current State

Last verified: 2026-09-11 21:30

- **Branch:** `master`, 7 commits ahead of `origin/master` (HEAD `262e4e4` = S12), **dirty** — the
  S12b working tree (≈ 79 entries: 44 modified + 35 untracked), nothing staged. Sibling `../shared`
  on `main` at `e882332` (clean, UNTAGGED, unpushed).
- **What the dirty tree is:** Session 12b — exact-arc geometry (`docs/pcb-hardening/12-exact-geometry-contract.md`,
  binding; PROGRAM.md row S12b = done, S12c row added).
- **Changed files (by role):**
  - Exact layer (new): `src/shared/pcb-geometry/{rounded-shape,rounded-shape-types,canonical-contour,exact-arcs,exact-ring,exact-contour,exact-simplicity,region-build,region-rounded,region-exact}.ts`; `board-region.ts`, `outline-geometry.ts`, `pad-outline.ts` (additive builders) edited.
  - Consumers: `pcb-connectivity/{copper-records,copper-items,touch}.ts`, `drc/{drc-context,pair-gap}.ts`, `drc/checks/{board,outline,keepouts,manufacturability}.ts`, `rendering/pcb/{contour-validation,outline-manufacturability}.ts`, `copper-fill/{copper-shape-kernel,material-web-kernel}.ts` (new kernel), `export/gerber/{arcs,writer,job-file}.ts` (new `arcs.ts`), `export/units.ts`, `pcb-store.ts`, `command-executor.ts` (comment), registries (`sdks/designer/types.ts`, `code-registry.ts` + shim, `severity.ts`, `violation-id.ts`, `drc-labels.ts`).
  - Tests: new `pcb-geometry-{rounded-shape,exact-arcs}.test.ts`, `drc-{outline-exact,material-web}.test.ts`, `gerber-outline-parity.test.ts` (+ `helpers/gerber-outline-fixtures.ts`), `frontend/pcb/contour-validation-gate.test.ts` (Vitest); edited `drc-audit-b4` (B4-9…B4-13), `drc-legality`, `drc-golden`, `drc-broad-phase-oracle`, `drc-keepouts`, `drc-pair-gap`, `drc-s7-clearance`, `contour-validation`, `pcb-geometry-board-region`, `designer-export`, `designer-pcb-view-state`, `helpers/{drc-golden,gerber-parse}.ts`; goldens `golden-arcs-2l.*` (new), `golden-census-2l.expected.json` (+ `.md`), `golden-holes-4l.md`, `golden-pours-2l.md`.
  - Docs: contract 12 (new), `PROGRAM.md`, `OPEN_FINDINGS.md` §6.8b, contracts 01/02/04/06/10/11, `TODO.md`, `CLAUDE.md` tree, `designer/AGENTS.md`, hardening-skill `scope-and-invariants.md`; memory.
- **Build/test (2026-09-11, final tree):** backend `bun test` 2814 pass / 22 known fails / 8 skip / 1 todo; `npx tsc -b --force | grep -c "error TS"` = 44 (repo root); `npm run test:react` 64 files 583 + 1 todo; `gen` + `gen:contracts -- --check` clean (`gen:check` fails on `gen:copilot-schemas:check` ENOENT — pre-existing); `test:drc-worker-smoke` PASS byte-identical; e2e `pcb-drc pcb-routing pcb-live-parity` 5 passed 1 skipped; `package-lock.json` 034652c3 unchanged; goldens areas 99c49eb3 · census (moved) · cutouts 43fbd513 · dfm 47573fd3 · holes c8ab6694 · pours ab245110 · rules ed0705e8 · small 95fbb3dc · arcs (new).
- **Key decisions (user, 2026-09-11):** polygon pads → S12c; exact editor gate; canonical arc derived at read (refined from write + read after Astra run 1 #11); `outline.minWebMm` rule only, no invented fab row; Astra "as needed" (brainstorm + spec-attack + adversarial-verify, all run).
- **Review status:** plan-critique 29 / Astra 0 / Astra 1 (18) / R1 (10) / R2 (6) / Astra 2 (4) — all folded, every fix verified; ledgers in contract 12 §12.
- **Blockers:** none. Waiting on the user for: the S12b commit; the shared tags (S11 follow-up) before S12c.
