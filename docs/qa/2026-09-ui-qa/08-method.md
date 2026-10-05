[← index](README.md)

# Method

## Goal and scope

Harden the neutral EDA redesign (`PLAN.md`, merged in `4678a90`). The goal was an app that looks and
behaves like a professional EDA/PCB tool and is release-ready. The run was manual exploratory QA
followed by adversarial verification. No code was changed during it.

**Scope (user decisions, 2026-09-25)**
- **Areas:** Home/shell/Settings; the Designer (schematic, PCB, 3D, BOM, DRC/ERC, export, local
  comments, KiCad import); the Library (browse, detail, part wizard, symbol and footprint editors,
  imports); the Assistant (space and dock); Docs; Tasks.
- **Cloud:** only graceful flag-off and offline states were tested.
- **Out of scope:** the DRC/geometry engine correctness program (`docs/pcb-hardening`).
- **Themes:** dark and light, checked for parity. Colour claims were verified with pixel probes against
  the `index.css` tokens, not by eye, because the image viewer renders light screenshots as dark.

## Environment

- **Code:** HEAD `63e90ea` on `master`, with a clean tree. The app ran in the browser (Vite dev plus a
  Bun backend); Electron was not used.
- **Data:** each stack had its own copy of the dev database (`src/core/backend/dev-data`, 14 designs, 241
  core parts), taken with `sqlite3 .backup`. A sha256 guard confirmed that the real dev database was not
  touched.

| Stack | Frontend | Backend | Purpose |
|---|---|---|---|
| A | 127.0.0.1:1520 | 3100 | Main QA, with the cloud flag forced off. Real OpenRouter free model (`nvidia/nemotron-3.5-lightning:free`); total LLM spend $0. |
| B | 127.0.0.1:1620 | 3200 | Library, part-wizard and Settings mutations. No provider keys. |
| C1 | 127.0.0.1:1720 | 3300 | Cloud flags on, with every cloud URL pointing at a dead port (offline). |

- **Common backend env:** `OPENPCB_DB_PATH=<stack copy>` and
  `OPENPCB_BUNDLED_LIBRARY_PATH=resources/core-library`. The `../CoreLibrary/dist` pack has 963 entries,
  which is over the 500-entry cap, so it would be rejected.
- **Vite:** each stack used a wrapper config that re-targeted the port and proxy.
- **Tooling:** `playwright-cli` 0.1.13 with named sessions per agent and theme, plus these helpers
  (`data/method/scripts/`):
  - `probe.py`: pixel colour → nearest token, with ΔE;
  - `palette-audit.py`: which colours are off-token, and how much area they cover;
  - `dom-census.js`: text under 10px, control heights, controls with no name, "coming soon" stubs;
  - `dialog-spy.js`: counts `window.prompt`/`confirm` calls.
- **Viewports:** 1440×900 was the primary size. 1100×720 (the Electron minimum) was checked on every
  screen. 1920×1080 was used for the cross-cutting census.

## Process (workflow `ui-qa-discovery`, 39 agents, ≈11 h)

1. **Discover.** There were 11 area charters: q1 shell+Home, q2 Settings, q3 designer shell+schematic,
   q4 PCB, q5 3D/BOM/import/comments, q6 Library browse, q7 part wizard+editors, q8 Assistant, q9
   Docs+Tasks, q10 cloud off/offline, and q11 cross-cutting consistency/a11y. At most 7 browsers ran at
   once. Each charter got the protocol (`data/method/QA_PROTOCOL.md`), the known-findings catalog
   (K01–K45, N1, N2) to confirm or refute, and exclusive design ownership.
2. **Verify.** Each charter's findings went to an adversarial verifier. It reproduced every finding in
   fresh sessions in both themes and tried to refute each one: was it intended per PLAN D1–D15? an
   environment artefact? a duplicate? It also read the code and recalibrated severity.
3. **Critic.** A completeness critic built a coverage matrix and emitted follow-up charters:
   - Round 1: f1a (failure/latency), f1b (scale/long text/export/net classes), f1c (library+settings),
     f1d (home/docs/assistant/shell).
   - Round 2: f2a (export/pcb/schematic), f2b (import/multi-layer/export), f2c (assistant/theme/library/comments).
4. **Triage.** A triage lead deduplicated everything by root cause into `data/triage.json` and
   `TRIAGE-full.md`. Each entry was given an owner and a fix wave from the plan, a recommendation, and a
   decision id where needed.

**Severity rubric**
- **S1:** a crash or white screen, data loss, a blocked core flow (create/place/wire/route/DRC/export/save),
  or an exposed secret.
- **S2:** a broken feature that has a workaround, wrong data, one theme unreadable, a keyboard trap, a
  misleading claim, or a native prompt/confirm (those break in Electron).
- **S3:** a visible inconsistency, a missing label or focus style, confusing copy, an off-token colour,
  or text under 10px.
- **S4:** polish.

## Results per charter

| Charter | S1 | S2 | S3 | S4 | Confirmed | Rejected |
|---|---|---|---|---|---|---|
| q1 shell + Home | 0 | 4 | 14 | 8 | 25 | 1 |
| q2 Settings | 0 | 6 | 18 | 5 | 27 | 1 |
| q3 designer shell + schematic | 1 | 11 | 20 | 7 | 36 | 1 |
| q4 PCB | 1 | 16 | 31 | 3 | 51 | 0 |
| q5 3D / BOM / import / comments | 2 | 10 | 19 | 2 | 33 | 0 |
| q6 Library browse / detail / import | 1 | 13 | 21 | 2 | 34 | 0 |
| q7 part wizard + editors | 1 | 11 | 20 | 4 | 36 | 0 |
| q8 Assistant | 1 | 11 | 21 | 2 | 35 | 0 |
| q9 Docs + Tasks | 3 | 10 | 14 | 1 | 28 | 0 |
| q10 cloud off / offline | 1 | 8 | 8 | 1 | 18 | 0 |
| q11 cross-cutting | 0 | 1 | 16 | 5 | 22 | 0 |
| f1a failure / latency | 1 | 4 | 7 | 1 | 13 | 0 |
| f1b scale / long text / export | 3 | 9 | 17 | 6 | 30 | 0 |
| f1c library + settings | 0 | 6 | 9 | 3 | 17 | 0 |
| f1d home / docs / assistant / shell | 0 | 2 | 4 | 3 | 9 | 0 |
| f2a export / pcb / schematic | 2 | 6 | 12 | 2 | 18 | 1 |
| f2b import / multi-layer / export | 2 | 6 | 6 | 3 | 17 | 0 |
| f2c assistant / theme / library / comments | 0 | 4 | 7 | 1 | 12 | 0 |

The counts are raw severities as each QA agent reported them. The triage recalibrated severity per root
cause (see [01-summary.md](01-summary.md)).

## Baseline gates at HEAD 63e90ea (`data/gates/`)

| Gate | Result |
|---|---|
| `npm run typecheck:frontend` | 0 errors |
| `npx tsc -p tsconfig.modules.json` | 16 unique pre-existing errors (normalised set in `baseline-modules-set.txt`) |
| `npm run test:react` | 66 files, 594 passed + 1 todo |
| `npm run build:frontend` | ok |
| e2e chromium (`OPENPCB_BUNDLED_LIBRARY_PATH=resources/core-library`) | 39 passed, 4 skipped, 3 failed |

**The 3 e2e failures**
- `3d-preview` and `designer-3d`: the KiCad ZIP upload response is not ok.
- `builtin-footprints` canvas smoke: console noise from `src/core/frontend/.env.local`, which points the
  cloud at an offline `localhost:8000`.

## Known limitations of the run

- **Browser, not Electron.** Electron-only behaviour was not exercised: the title bar, the
  updater/version footer, `safeStorage`, MCP config snippets and the native menus.
- **Headless Chromium with software WebGL.** Canvas performance numbers are worst-case.
- **Library → schematic drag-and-drop** could not be exercised because only one module Space is mounted
  at a time. F1C-006 records the MIME mismatch.
- **LLM testing** used one free model, with ≤25 turns per charter.
