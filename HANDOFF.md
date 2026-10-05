# Handoff — UI QA hardening pass (post neutral-EDA redesign)

Session 6 · 2026-09-26

## Goal

The goal is an app that reads as a professional, consistent EDA/PCB tool (KiCad / Altium / Flux quality bar) in both dark and light themes, and is stable and release-ready. The neutral-EDA redesign (`4678a90`, recorded in `PLAN.md`) restyled Home, the Library table, BOM and the schematic/PCB chrome. Everything else only got the slate/violet remap. This pass does thorough manual QA with `playwright-cli`, screenshot validation and pixel probes, then fixes everything approved.

The PCB correctness-hardening program is paused, not abandoned. **S15b (board stack-up model) is still its next session.** See `TODO.md` → "PCB hardening — paused" and the previous handoff content preserved there.

## Original plan

`~/.claude/plans/act-as-senior-software-linked-squid.md` (approved):

- **Phase 0:** isolated QA stacks.
- **Phase 1:** QA discovery (11 charters), adversarial verification, completeness critic.
- **Phase 2:** triage checkpoint with the user.
- **Phase 3:** fix waves with strict file ownership:
  - F0a kit + tokens
  - F0b app wiring
  - G grid snap
  - DB / LB backends
  - W2 area owners C1 C2 D1 D2 D3a D3b D4 L1 K1
  - W3 owners L2 L3 L4a L4b A1 A2 A3
  - W4 sweep + e2e
- **Phase 4:** full regression, release-like smoke (prod bundle, dev flags off), docs.

The execution protocol is `docs/qa/2026-09-ui-qa/fix/FIX_PROTOCOL.md`. It holds the rules, the ownership map, the design-system rules, the e2e-frozen names and the report format.

## User decisions (binding)

**Fix scope and areas**
- Fix UI/UX and frontend bugs. Backend only where approved: the grid, Library paging, the Designer bundle and the Library bundle.
- DRC/geometry correctness is out of scope.
- Areas: Home/Shell/Settings, Designer, Library, Assistant, Docs, Tasks. Cloud features only for graceful offline and flag-off states.

**Design**
- Latitude: polish plus targeted structural fixes.
- Approved proposals: **P1** fixed PCB tool row, **P2** narrow-window (1100×720) layout, **P3** PCB "Layout ▾" menu, **P4** trace/via inspector, **P5** net-class management. **P6** (part-wizard restructure) is not approved.
- Depth is FULL: kit primitives plus migrating every in-scope surface to tokens and primitives.
- Dark and light must reach parity.
- Issues in `@openpcb/*` packages go on the follow-up list only; do not edit packages.

**Grid snap**
- A real toggle, default ON.
- Schematic grid 1.27 mm. All 2,406 library pins sit on 1.27 mm, and backend autoplace, assistant and routing all move to 1.27 mm.
- PCB grid 0.25 mm default, with presets 1.0/0.5/0.25/0.1 mm and 1.27/0.635/0.254/0.127 mm.
- Shift+S toggles snap; N / Shift+N cycle presets; the status-bar grid dropdown returns.

**Stubs**
- Wire Home Rename and Library "Place in design".
- Build Tasks in the rail and the PCB C comment hotkey.
- Remove the other "Coming soon" stubs.
- Bundle tool: remove dead leftovers but keep the flag.

**S1s rooted outside the UI: mitigate now, dedicated sessions later.**
- In-app mitigations this pass: offline canvas font (T-001), hide broken IPC presets (T-316), warn on multi-unit placement (T-092).
- **Release blockers** for dedicated sessions: Y-down KiCad footprints (T-317), KiCad import pad swap / missing nets (T-244/T-245), and stable net identity (T-132).

**Commits and archive**
- Commit fixes per verified area on master.
- The QA archive `docs/qa/` stays gitignored and is never committed; the user backs it up manually.
- Push only when the user says so. It was pushed this session on the user's word.

**LLM for QA:** OpenRouter. The key is in root `.env` as `OPEN_ROUTER_API_KEY` ($2 cap). Model `nvidia/nemotron-3.5-lightning:free`; $0 spent so far. Inject it only through a script and never echo it.

## Done so far (and why)

**Phase 0**
- Isolated stacks: A 3100/1520 (cloud off, real LLM), B 3200/1620 (library/settings mutations, no keys), and C1 3300/1720 (cloud on, dead URLs).
- Each stack uses its own copy of the dev DB. A sha256 guard confirmed the real dev DB was never touched.
- The CoreLibrary pack is taken from `resources/core-library`, because the `../CoreLibrary/dist` pack has 963 entries, over the 500 cap.

**Phase 1 (39 agents, ≈11 h)**
- 480 raw findings: 461 confirmed, 15 duplicates, 4 rejected.
- Deduplicated into 395 root causes. By severity: S1 16, S2 112, S3 204, S4 58.
- The recon-predicted findings K01–K45 were confirmed: 46 confirmed, K16 partial, K27 refuted.

**Phase 2**
- The user approved **344** entries (`data/triage-approved.json`, owner = `fixOwner`) and left 51 out (`09-approved-scope.md`).
- Everything is archived in `docs/qa/2026-09-ui-qa/` (≈900 MB, gitignored):
  - index and numbered docs;
  - 23 per-area files with full repro and verification;
  - every PNG;
  - raw, verified and coverage JSON;
  - census data;
  - agent work dirs;
  - DB snapshots with API keys scrubbed (VACUUM + WAL checkpoint; zero `sk-or-v1` bytes).

**Wave A — committed and pushed** (`6e8c2e0` gitignore, `6f5fca1` kit, `e64a464` designer backend, `47142ad` library backend)
- **F0a kit.** Tokens: scrim, float/dialog shadows, status borders, canvas-well overlay tokens, AA light-danger contrast, flat bare `rounded`, and `@source` for the canvas package. Primitives: Input, NumberInput, Field, Select, Switch, RadioGroup, Dialog + `confirmDialog`/`promptDialog` host, toast, ErrorBoundary, Banner, Badge, EmptyState, Spinner, Kbd. Also:
  - roving tabindex and a visible focus ring;
  - `problem.ts` (`describeError`, `isRetryableError`);
  - the `isShortcutBlocked` guard and `useGlobalShortcut`;
  - the `ui-discipline` raw-class ratchet test.

  The API is in `fix/contracts/F0a.md`. After the review loop, I fixed one leftover myself: the kit Dialog yields Escape to a dirty NumberInput (`data-escape-owner`).
- **DB (designer backend).**
  - Refdes changes propagate to the PCB/BOM. Overrides are now bound to the part id (migration 0019).
  - Multi-delete is one undoable batch (`commands/batch.ts`).
  - Net labels merge nets.
  - Net-class CRUD with per-class vias.
  - Trace/via edit commands.
  - Design-named exports.
  - KiCad inspect returns 400/422.

  Contract: `fix/contracts/DB.md`.
- **LB (library backend).**
  - List paging with `offset` + `total` (max 200) in a stable order.
  - One list/facet predicate.
  - A `kind`-less `.opclib` is no longer treated as core (migration 0011).
  - `user.local` cannot be removed.
  - Duplicate copies everything and the copy is editable.
  - Inspect returns 400/422.

  Contract: `fix/contracts/LB.md`.
- **Test-isolation fix.** The new library tests leaked `OPENPCB_DB_PATH` and the sqlite singleton into `tasks-runtime` (5 spurious 404 failures in the full run). Each afterEach now restores the env and calls `resetSharedSqliteForTesting()`.

**Dead ends and lessons**
- `pipefail` combined with `grep -q` kills pipelines; use `grep -c`.
- macOS has no `timeout`.
- The running Vite serves stale transforms for `src/modules` and `src/shared` edits; restart it before any browser verification.
- `playwright-cli eval` must be synchronous.
- The Read tool shows light PNGs as dark; probe pixels instead.
- The workflow agent-stall retry sometimes restarts a long QA agent. That is expected, not stuck.

## How to resume

1. Run the `handoff` skill with "resume". Then read `docs/qa/2026-09-ui-qa/README.md`, `fix/FIX_PROTOCOL.md`, `fix/KIT_SPEC.md`, `fix/contracts/*.md` and `fix/results/wave-a-crossowner.md`.
2. **Merge first.** Fold the 35 cross-owner hand-offs from wave A (`fix/results/wave-a-crossowner.md`) into the owner briefs (`fix/owners/<X>.md`). You can regenerate the briefs from `data/triage-approved.json` with the generator logic from session 6, or append a "Hand-offs from wave A" section to each brief.
3. **Wave B** (one workflow, disjoint files):
   - **F0b app wiring:** mount Toaster, DialogHost and a root plus per-Space ErrorBoundary; window error handlers; native context menu on editable targets; offline canvas font (T-001); favicon; a use-toast adapter.
   - **G grid snap:** the spec is in the plan and in `fix/owners/G.md`, including the backend 1.27 mm constants and `tests/e2e/grid-snap.spec.ts`.

   Reuse `fix/workflows/ui-fix-wave-a-*.js` as the template (implement → reviewer-critical → up to 2 fix rounds). Then run the gates and commit per area.
4. **Wave C** (W2 + W3, 16 owners, at most about 8 implementers at once, the same template). Then run the gates. Then restart Stack A (or rebuild the stacks, see below) and run a browser-verification workflow that re-runs each addressed finding in both themes. Fix loops come next, then per-area commits.
5. **W4 sweep and e2e** (a frozen-name audit and spec updates), then **Phase 4**:
   - full gates;
   - regression QA;
   - a C2 release-like smoke (`build:frontend` + `vite preview`, all dev flags `=0`);
   - docs: `TODO.md`, the `PLAN.md` follow-ups, `docs/design/design-tokens.md`, a CLAUDE.md UI invariant, the grid release note, and `../docs/sessions/ROADMAP.md`.
6. **QA stacks.** Stacks A, B and C1 may still be running from session 6, but their data lives in an ephemeral scratchpad. To rebuild:
   1. Copy `docs/qa/2026-09-ui-qa/raw-run/scripts/` into a new scratch `qa/scripts/`.
   2. Copy `raw-run/db-snapshots/pristine` to `qa/data/{pristine,A,B,C}`.
   3. Run `scripts/mkviteconf.sh A 1520 3100` (and likewise for B and C1).
   4. Run `scripts/start-stack.sh A|B|C1`.
   5. Run `python3 scripts/inject-llm.py http://127.0.0.1:3100`.

   Stop the stacks with `scripts/stop-stack.sh <S>` or kill the listeners on 3100/3200/3300 and 1520/1620/1720.

## Open questions

- None blocking. The Phase 4 Electron smoke is optional.
- Whether to open the triage as an HTML page with screenshots: offered, not requested.
- PCB snap for a single footprint drag: the default is to snap the anchor absolutely, the same as the schematic.
- The release blockers T-317, T-244/245 and T-132 need their own sessions once this pass closes.

## Paused program — PCB hardening (carried forward from session 5)

**Status**
- S15 is committed (`0f7c002`).
- The next session is **S15b, the board stack-up model.**
  - Run it before S16.
  - Start in plan mode with `/fable-orchestrator` and `/pcb-hardening-review` (Astra spec-attack at xhigh).
  - Its brief is contract 15 §4, plus the source note `docs/pcb-hardening/sources/jlcpcb-stackup-2026-09-18.md`.
  - It includes a minimal stack-up editor.
- Full session-5 narrative: `git show 63e90ea:HANDOFF.md`.

**Open questions from session 5**
- **S15b scope:**
  - Is a second fab reference (PCBWay) needed?
  - Where does the editor live: the design-rules dialog, or its own panel?
  - Does `layerCount` get its write command in S15b (S15-4)?
- **S15-10:** the per-fab inner-copper default. Fix it in S15b, or with the fab presets?
- **Product:**
  - Is "delay" routed-copper, tap-to-tap, or pin-to-pin?
  - Is reference analysis descriptive or normative (contract 15 §6)?
- **Tags:** has `../shared` been tagged? It was still at `e882332` on 2026-09-18. S12c depends on it.

## Pointers

- Tasks → `TODO.md` (block "Now — UI QA hardening") · Snapshot → `CURRENT_STATE.md`
- QA archive and fix kit → `docs/qa/2026-09-ui-qa/` (gitignored) · Plan → `~/.claude/plans/act-as-senior-software-linked-squid.md`
- PCB hardening (paused, S15b next) → `docs/pcb-hardening/PROGRAM.md`, contract 15 §4, `docs/pcb-hardening/sources/jlcpcb-stackup-2026-09-18.md`
