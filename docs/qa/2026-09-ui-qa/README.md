# UI QA pass — 2026-09 (post neutral-EDA redesign)

Manual exploratory QA of the whole OpenPCB desktop app after the neutral EDA redesign (`PLAN.md`), driven through `playwright-cli` against isolated dev stacks, in dark and light themes at 1100×720 / 1440×900 / 1920×1080, with every finding adversarially re-verified by a second agent. Nothing from the run was discarded: every raw, verified, rejected and duplicate finding, the coverage reports, DOM census data, triage and method are kept here.

- **Charters:** 18 (q1–q11 by area, f1a–f1d and f2a–f2c follow-ups from the completeness critic)
- **Raw findings:** 480 · confirmed 461 · duplicate 15 · rejected 4
- **Triage entries (root causes):** 395 · live by severity: S1 16 · S2 112 · S3 204 · S4 58
- **Recommendation:** fix-now 325 · decide 43 · defer 22 · wont-fix 5

## Documents

| Doc | Content |
|---|---|
| [01-summary.md](01-summary.md) | Counts, severity × area, all S1 release blockers, workload by owner |
| [02-known-findings.md](02-known-findings.md) | Status of the 45 code-recon findings (K01–K45, N1, N2) + original catalog |
| [03-decisions.md](03-decisions.md) | Product/scope decisions needed, with recommended defaults |
| [04-proposals.md](04-proposals.md) | Structural/layout proposals (not built without approval) |
| [05-rejected.md](05-rejected.md) | Rejected / duplicate / needs-info findings with reasons |
| [06-shared-package-followups.md](06-shared-package-followups.md) | Issues inside `@openpcb/*` packages and CoreLibrary data |
| [07-coverage.md](07-coverage.md) | What each charter tested (per theme / viewport), known-finding verdicts, untested items |
| [08-method.md](08-method.md) | Environment, stacks, tooling, charters, severity rubric, baselines |
| [09-approved-scope.md](09-approved-scope.md) | User decisions at the triage checkpoint; what is / is not fixed in this pass |
| [fix/](fix/FIX_PROTOCOL.md) | Fix protocol, kit spec and per-owner fix briefs |
| [TRIAGE-full.md](TRIAGE-full.md) | The complete single-file triage as produced by the triage lead |

## Findings by area

| Area | Entries | S1 | S2 | S3 | S4 |
|---|---|---|---|---|---|
| [cross-cutting](areas/cross-cutting.md) | 23 | 1 | 2 | 15 | 5 |
| [shell](areas/shell.md) | 5 |  | 1 | 2 | 2 |
| [home](areas/home.md) | 21 |  | 4 | 8 | 8 |
| [settings](areas/settings.md) | 33 |  | 8 | 19 | 5 |
| [designer.shell](areas/designer-shell.md) | 10 |  | 1 | 6 | 3 |
| [designer.schematic](areas/designer-schematic.md) | 34 | 2 | 9 | 16 | 6 |
| [designer.comments](areas/designer-comments.md) | 8 |  | 3 | 3 | 2 |
| [designer.pcb](areas/designer-pcb.md) | 79 | 2 | 25 | 41 | 10 |
| [designer.drc](areas/designer-drc.md) | 7 | 2 | 1 | 4 |  |
| [designer.bom](areas/designer-bom.md) | 14 | 2 | 7 | 4 | 1 |
| [designer.3d](areas/designer-3d.md) | 14 |  | 5 | 7 | 1 |
| [designer.import](areas/designer-import.md) | 9 | 2 | 2 | 5 |  |
| [library.browse](areas/library-browse.md) | 17 |  | 5 | 11 | 1 |
| [library.detail](areas/library-detail.md) | 18 |  | 3 | 13 | 2 |
| [library.import](areas/library-import.md) | 4 |  | 3 | 1 |  |
| [library.wizard](areas/library-wizard.md) | 17 |  | 5 | 9 | 3 |
| [library.symbol-editor](areas/library-symbol-editor.md) | 7 |  | 3 | 3 | 1 |
| [library.footprint-editor](areas/library-footprint-editor.md) | 5 | 2 | 1 | 2 |  |
| [assistant.space](areas/assistant-space.md) | 34 |  | 12 | 19 | 3 |
| [assistant.dock](areas/assistant-dock.md) | 5 |  | 3 | 2 |  |
| [docs](areas/docs.md) | 24 | 3 | 7 | 13 | 1 |
| [tasks](areas/tasks.md) | 3 |  |  | 1 | 2 |
| [cloud](areas/cloud.md) | 4 |  | 2 |  | 2 |

## Data

- `data/triage.json` — one entry per root cause (`tid`, finding `ids`, owner, wave, recommendation, `approved`).
- `data/raw/*.jsonl` — every finding as first recorded by the QA agent.
- `data/verified/*.json` — every finding after adversarial verification (status + verification verdict/reason/evidence).
- `data/coverage/*.json` — per-charter checklists; `data/census/*.json` — DOM census per screen × theme × viewport.
- `data/method/` — QA protocol, known-findings catalog, surface inventory, design assignments, helper scripts.
- `data/gates/` — baseline gate outputs (typecheck, modules tsc set, vitest, build, e2e) at HEAD 63e90ea.
- `evidence/` — all screenshot evidence (original PNGs, `evidence/shots/<agent>/<theme>/…`; verifier shots under `v<agent>`).
- `raw-run/` — everything else from the run: agent work dirs (crops, helper files), playwright-cli snapshots + console logs, backend/Vite logs, fixtures, Vite wrapper configs, all helper scripts, the workflow script, and post-run DB snapshots of stacks A/B/C + pristine (API keys scrubbed).
