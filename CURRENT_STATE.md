# Current State

Last verified: 2026-09-26 01:30

- **Branch:** `master`, clean. It is level with `origin/master` at `47142ad`, pushed on the user's word.
- **Commits this session:**
  - `6e8c2e0`: `.gitignore` `/docs/qa/`
  - `6f5fca1`: kit and tokens (F0a)
  - `e64a464`: designer backend (DB)
  - `47142ad`: library backend (LB)
- **Changed areas:**
  - `src/shared/frontend/ui/**`: new primitives, plus focus and roving edits.
  - New shared modules: `src/shared/frontend/http/problem.ts` and `src/shared/frontend/keyboard/*`.
  - Frontend core: `src/core/frontend/src/index.css` (tokens), `ui-discipline.test.ts` with its baseline JSON, and the `components/ui/dialog.tsx` shim.
  - `docs/design/design-tokens.md`.
  - Designer backend: routes, commands (`batch.ts`), `projection-world`, BOM overrides (migration `0019_bom_override_part_binding`), export naming, KiCad inspect errors.
  - Library backend: `component-filter.ts`, queries/routes paging, migration `0011_untrusted_core_sources`, `source-ids.ts`, clone.
  - SDK types: `src/sdks/{designer,library}`.
  - New bun tests: `designer-*` and `library-*`.
- **Gates after wave A:**

  | Gate | Result | Baseline |
  |---|---|---|
  | `npm run typecheck:frontend` | 0 | 0 |
  | `npx tsc -p tsconfig.modules.json` | no errors outside the baseline set | 16 unique errors |
  | `npm run test:react` | 77 files, 696 passed + 1 todo | 66/594 |
  | `npm run build:frontend` | ok | — |
  | `cd src/core/backend && bun test` | 3119 pass / 22 fail / 8 skip | 3068/22 |
  | e2e chromium | not re-run since wave A | 39 pass / 4 skip / 3 fail |

  - The 22 backend failures are the known environment failures (CoreLibrary pack cap and one assistant cloud-credential test).
  - The 3 baseline e2e failures: two 3D KiCad-ZIP upload specs, and one console-noise spec caused by the offline cloud in `.env.local`.
- **QA archive:** `docs/qa/2026-09-ui-qa/` (≈900 MB, gitignored, the user backs it up manually).
  - 344 approved triage entries: `data/triage-approved.json`.
  - Owner briefs: `fix/owners/*.md`.
  - Protocol and spec: `fix/FIX_PROTOCOL.md`, `fix/KIT_SPEC.md`.
  - API contracts: `fix/contracts/{F0a,DB,LB}.md`.
  - Wave A hand-offs: `fix/results/wave-a-crossowner.md` (35).
- **Key decisions:**
  - Strict file ownership lets implementers work in parallel in the main checkout. Only the orchestrator commits.
  - Grid 1.27 mm for the schematic and 0.25 mm for the PCB, default ON.
  - Proposals P1–P5 are approved; P6 is not.
  - Package-rooted S1s are mitigated now. T-317, T-244/245 and T-132 are release blockers for dedicated sessions.
- **Blockers:** none.
- **Next wave:** B = F0b app wiring plus G grid snap. The PCB-hardening S15b is still pending in parallel.
- **Running processes:** the QA stacks may still be up from session 6: backends on 3100/3200/3300 and Vite on 1520/1620/1720. Their data is in an ephemeral scratchpad, so rebuild them from `docs/qa/2026-09-ui-qa/raw-run/` (see `HANDOFF.md` step 6).
