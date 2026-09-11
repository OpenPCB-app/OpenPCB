# OpenPCB — TODO

> Live tracker. Last reviewed **2026-08-02** · repo version **0.1.1-beta**.
> Open work only. Completed work lives in git history, not in this file.
> Six programs: Route tool · Compiler agent · MCP integration · Release hardening · DRC · Backlog.

## Now — handoff (2026-09-11, S12b closed in the working tree; S12 committed as `262e4e4`)

Session-resume block written by `/handoff`; `HANDOFF.md` is the entry point, `CURRENT_STATE.md`
the snapshot. Everything below this block is the live program tracker and is unchanged.

- [ ] **Commit S12b** on `master` when the user says so — ≈ 79 entries, nothing staged; suggested
      message: "PCB hardening S12b: exact-arc geometry — rounded pads, canonical contour, certified
      board-edge interval, board-material web, Gerber Profile arcs" (never auto-commit; exclude
      `HANDOFF.md` / `CURRENT_STATE.md`).
- [ ] **Shared-tags follow-up** (after the user tags `kicad-parsers-v0.1.4` / `kicad-import-v0.2.0`
      / `rendering-core-v0.1.4` in `../shared` from `e882332`): repin `package.json` in OpenPCB and
      CoreLibrary, `npm install` lock refresh, verify with a real `npm ci` in a scratch clone (lock
      diff = three tag lines, no `"link": true`), CoreLibrary `bun tools/rebuild-previews.ts` +
      `bun validate`. Separate commit.
- [x] **S12b — exact-arc geometry** closed 2026-09-11 in the working tree (contract
      `docs/pcb-hardening/12-exact-geometry-contract.md`; Astra brainstorm + spec-attack +
      adversarial-verify, R1 + R2 folded) — commit on the user's word.
- [ ] **S12c — polygon pads (trapezoid / custom)** — new PROGRAM row: `kicad-parsers` (`rect_delta`,
      `primitives`) → `rendering-core` `outlinesMm` → `kicad-import`; OpenPCB record `rings`, pair
      kernels, pour, copper-shape unit, annular SDF, mask artwork, Gerber `%AM` primitive 4, canvas /
      3D; re-parse of `raw.rawSource` for existing rows; authored fixtures (none exist). Needs the
      S11 tag follow-up first, then a third tag round.
- [ ] S12b follow-ups: mechanical split of `checks/board.ts` (1078) and `manufacturability.ts`
      (525); the 16 s board-budget exhaustion fixture (left out of the suite); CAM verification of
      the ≤ 2√2 nm Gerber arc residual on a real fab upload.
- [ ] Split the five S12 files over 500 lines (mechanical, after S12c): `copper-shape-kernel.ts`,
      `checks/copper-shape.ts`, `courtyard-rings.ts`, `checks/solder-mask.ts`, `checks/silkscreen.ts`.

## Repo state

- **Unmerged local branch `integ/trace-drag`** — 6 commits, ~1.9k lines: trace segment drag
  editing, vertex handles, 555-blinker fab fixture + tests. Unpushed. Push, then integrate or
  rebase. **Do not delete.**
- **Verify then drop:** the CI-red pair recorded 2026-07-12 — `@openpcb/contracts` needing a
  `contracts-v0.3.0` cut plus a repin, and a `package-lock.json` SHA refresh for
  `opclib-pack-v0.3.0`. Both may already be resolved; confirm against master before carrying
  either as work.

---

## 1. Route tool

**Locked decisions.** Length tuning before bundles · walkaround-lite, no shove · batch-per-session
commit · rbush is the only new dependency · through-vias in v1 · DRC hard-block plus explain ·
match groups with an in-tool target · diff pairs by `_P`/`_N` suffix convention only.

P1–P4 shipped. P5 Tune and P6 Bundle are code-complete with their review-session fixes landed;
both are gated on manual QA on a real board before their dev flags can graduate.

- [ ] **P5 Tune — manual QA on a real 45-routed board.** Diagonal meanders, painted-span halo,
      idle hover pick and honest per-status HUD copy (`target-met` / `blocked` / `span-too-small`)
      all landed. QA is the last gate before `pcb.lengthTuning` graduates.
- [ ] **P6 Bundle — manual QA.** Ghost-stability fixes landed (lanes never unmount, degraded lanes
      hold last-good geometry in amber, stable fan-out direction). `pcb.bundleRouting`, toolbar-only.
      Known v1 weakness to judge during QA: breakout connector quality near tight pin rows.
- [ ] **P6 diff pairs — blocked on Bundle QA.** Suffix convention only; `PcbNetClass.diffPairGapMm`
      sets pair pitch and is stripped from the cloud BoardSnapshot to keep the wire schema stable.
- [ ] **Skew tuning** = P5 Tune applied to the shorter leg. No extra code; usable once Tune passes QA.
- [ ] **Release notes are required when graduating a dev flag.** Behaviour changes that must be
      written up: snap tolerance moved to 8px/zoom (P2d), auto-finish / walkaround / lengthTuning /
      bundleRouting behaviour, and the S1 connectivity changes (`docs/pcb-hardening/01-connectivity-contract.md`
      §7: GND airwires + `UNCONNECTED_NET` when no pour exists, `pcb.padShapeConnectivity` retired in
      favour of exact copper overlap, free-pad airwires, GND airwires now reach the cloud autorouter), and the S2 geometry changes
      (`docs/pcb-hardening/02-geometry-contract.md` §6: off-board judged on copper with its width,
      touching / tangent cutouts and edge-touching cutouts now `BOARD_OUTLINE_INVALID`, full-radius
      rounded slots no longer falsely invalid, large circles flattened finer), and the S3a
      zone/keepout changes (`docs/pcb-hardening/03-zone-keepout-contract.md`: KiCad rule areas now
      import as keepouts, hatched fills import solid, hole zones import disabled, `connect_pads`
      modes are honoured including `none`/thru-hole, the 3D preview follows the fill toggle and
      shows zones, copper-pour keepouts subtract from fills, and a fill layer with no ground net no
      longer pours a null-net plane), and the S3b authoring changes (`03-zone-keepout-contract.md`
      §12: the per-layer copper fill is now a persisted board zone — the toggle is undoable, has a
      net and pad-connection picker, migrates from the old view state on first load and enters the
      cloud content digest, so in-flight auto-layout candidates for filled boards go stale once;
      new Zone (Z) and Keepout (K) tools, zone/keepout selection, vertex editing and inspector;
      disabled zones draw a dashed ghost outline), and the S4 legality changes
      (`03-zone-keepout-contract.md` §13: four new DRC codes `KEEPOUT_VIOLATION`, `ZONE_OVERLAP`,
      `ZONE_INVALID` (cannot be waived or ignored), `ZONE_EMPTY_FILL`; Gerber, the cloud snapshot,
      the DRC island check, "clean up pour traces" and the ratsnest now honour copper-pour keepouts
      exactly like the canvas — exported copper can shrink where a keepout was drawn; a stale zone
      net no longer pours anywhere; the route tool avoids `tracks` keepouts, flags a route through
      one as a conflict at commit, and refuses a via inside a `vias` keepout; "clean up pour
      traces" now deletes only a trace that lies entirely inside one pour island — a trace that
      bridges two islands or crosses a thermal-relief gap is kept, where it used to be deleted), and
      the S5 copper-pour changes (`docs/pcb-hardening/04-copper-pour-contract.md`: pours are built
      from the same copper geometry and layer rules as DRC — a `std` free pad now pours on inner
      layers, a pad on an invalid layer is a void everywhere; the pour extent follows the S2 board
      region; large circle pads, wide traces and drills now get their full clearance (the old
      inscribed sampling could be short by ~5 ‰ of the radius); net-class clearances apply to pours;
      zones of different nets on one layer carve each other by priority with a clearance band, so
      overlapping zones no longer short; thermal spokes follow the pad's own axes (edge midpoints at
      90°, rotated with the pad — every thermal pad looks different); the Gerber emits each net's
      pours as one union with net attributes; "clean up pour traces" covers explicit zones too;
      `ISOLATED_COPPER_ISLAND` now means "reaches no pad" and drops the mm² from `measuredMm`;
      a zone whose fill fails reports `ZONE_FILL_FAILED` and ships no copper; zones can have cutouts
      (Shift+Z) and KiCad zones with cutouts import enabled), and the S6 rule-semantics changes
      (`docs/pcb-hardening/05-rule-semantics-contract.md` §12: scoped scalar rules — track width,
      via diameter / drill, annular ring, hole-to-hole, edge clearance — now enforce (they were
      stored but inert); area-scoped rules are evaluated along the whole trace, so a relaxation
      that leaks past its area now fails; a matched rule's severity applies and the severity table
      is the real default; `HOLE_TO_BOARD_EDGE` breaches are now `HOLE_OFF_BOARD`; the assistant's
      DRC honours severity overrides; new boards get a 0.1 mm clearance floor; the design-rules
      dialog no longer resets the IPC-2221 electrical parameters on save and exposes the floor and
      the pour-to-copper clearance; pours are cleared per obstacle kind (a board whose pad rule is
      below its trace rule pours closer to pads) and scoped rules reach fills only through an
      explicit pour pair-kind scope; the route tool and the interactive commit gate honour the
      neighbour's net class, scoped rules and the floor and refuse shorts, and they take the
      pending trace's class from the net rather than the session; clearance comparisons forgive
      0.5 nm of float noise at exact equality; stale (v1) waiver ids are pruned; malformed rules are
      refused on save and persisted invalid / partially ineffective rules are reported
      (`DRC_RULE_INVALID`, `DRC_RULE_INEFFECTIVE`); KiCad import maps the project's minimums and
      per-net class assignments and warns when a `.kicad_dru` file is present), and the S7 batch-DRC
      changes (`docs/pcb-hardening/06-batch-drc-contract.md`: copper over a non-plated hole is now
      `COPPER_TO_HOLE` (the pour's NPTH clearance, `clearance.copperToHoleMm` or the edge rule);
      overlapping different-net pads inside one footprint and an unassigned trace / pad bridging two
      nets are now shorts; circular pads are judged as exact discs (a ~0.2 %·r false-fail band is
      gone); the DRC report is sorted by code then id and byte-stable under any input order (the
      panel's within-severity order changes); `TRACE_LAYER_MISMATCH` can no longer be waived or
      ignored; `COPPER_TO_BOARD_EDGE.measuredMm` is negative for copper past the edge; cutouts get
      the milling advisories; every drilled free pad is a hole to DRC, the drill file and the pour
      alike; an NPTH `hole` free pad no longer flashes copper in the Gerber and a `conn` pad flashes
      on its declared layer only; class ignores for `dfm` / `electrical` / `signal-integrity` now
      persist; `UNCONNECTED_NET` is derived by the engine itself), and the S8 live-parity changes
      (`docs/pcb-hardening/07-live-parity-contract.md`: the route tool's live check, its commit
      gate, the smart-via and tune guards now judge the pending copper with the batch DRC kernel —
      every pair kind, shorts, the fab tier, NPTH holes, board edge / off-board, hole spacing,
      keepouts and the item minimums, against exact rotated pads and through-hole barrels on every
      layer; the HUD shows conflicts and warnings separately; the tune commit is gated like a route;
      every copper command is judged server-side too and refused with `PCB_COPPER_ILLEGAL` unless
      the DRC-override toggle is on (`legality: "report"`) — assistant / MCP routes get the same
      verdict; two touching pieces of unassigned copper are one conductor and unassigned copper
      touching a named net is an extension of it, so their overlaps are no longer clearance errors
      (the census golden lost two rows); router obstacles follow the same items).
- [ ] Follow-up: migrate `/autoroute/apply` onto `pcb_commit_route`. Carries an open UX decision —
      per-op cherry-pick (today's route apply) versus all-or-nothing batch (today's place apply).
- [ ] Follow-up: pad-bearing E2E fixture board covering Tab→accept, tune-a-trace, bundle
      pad-collect and one-undo-multi-via. Blocked on library fixture infrastructure.
- [ ] Follow-up: **bundle v2** — target-row landing (v1 lanes end dangling), via support, per-net
      lane widths, crossing warnings when pads are not monotone, smarter breakout connectors.
      Also: diagonal-segment obstacle AABB pre-split (≤2 mm) if dense-board QA shows auto-finish
      misses, and walkaround multi-cluster.
- [ ] P7 cloud corridor routing — optional, only if bundle usage shows demand.

---

## 2. Compiler agent (cloud copilot → local)

**Locked decisions.** LLM → declarative circuit-spec IR → deterministic expander → ERC; the IR
stays TS-internal and only the expanded `DesignerCommand` batch crosses a boundary · local-first
brain (cloud is a model gateway plus stateless tools, never the orchestrator) · hybrid recipes
(primitives in code, functional blocks as cloud data later) · **parameter calculation lives in the
expander, not the LLM** · auto-apply non-destructive changes once ERC-clean, gate destructive ones,
ERC self-correct ≤N · guardrails: clarify-first, installed-parts-only, schematic-only.

**Layout invariant for new blocks** (documented in `compiler/lowering.ts`): auto-routes must not
graze foreign pins. The original one-row grid put a straight R→A route through `LED.K`, and that
pin-on-wire junction shorted every LED into GND. Every new block must respect it.

- [ ] **More primitive blocks** in `compiler/blocks.ts` — decoupling, pull-up/down, RC.
- [ ] **P2 data recipes + additive editing** · **P3 edit reconciliation** · cloud stateless tools +
      model gateway · golden-IR / fixture / telemetry validation.
- [ ] `compile_circuit` polish: a tool-description hint to reuse existing rail names when extending
      a design (rails merge by name only), and `designer_resolve_design` by-UUID lookup — name-only
      today.
- [ ] (deprioritized) `get_design_state` completion-pressure read.

### Assistant loop follow-ups

Same module, out of the Phases 0–4 scope that landed 2026-06-02. Not blocking.

- [ ] **P5 prompt + context engineering** (`prompt-service.ts` + `run-service.ts`): agentic-mode
      triad (persistence / tool-first / principled-stop); two-register selection by capability probe,
      dropping plan-then-reflect for reasoning models; inject a live design summary into the system
      prompt (reuse the existing `buildDesignContextSummary`); lean read-tool envelopes; additive presets.
- [ ] **P6 loop robustness** (ai-core `run-loop.ts`): fingerprint dedup keyed on
      `{tool, normalizedArgs, designRevision}` plus outcome; no-progress/stall detection off the
      design-revision signal; per-tool call caps; wall-clock timeout. Warning codes are already
      reserved in `events.ts`.
- [ ] **Emulated-tool-call guard.** Weak or distilled local models emit tool-call-shaped ```json in
      assistant *content* rather than real `tool_calls`, so they narrate fake progress, nothing is
      built, and the DoD verifier never runs. Detect the pattern and surface it.
- [ ] **Verify:** headed Playwright assistant scenarios (a)–(e) were pending a local oMLX endpoint
      at :8000. Typecheck, backend, react and ai-core suites were green at the time. Re-run and
      close, or re-open with a real blocker.

---

## 3. MCP integration — in flight

The largest live workstream and the newest. Uncommitted WIP in the working tree as of the
2026-07-28 verification pass; it is **not** unshipped and it is **not** finished.

OpenPCB exposes its assistant tool registry over MCP so external agents (Claude Code, Claude
Desktop, Codex) can drive whatever design the user has open. It lives inside the assistant module,
which already owns the registry, the `ContextResolver`, proposals and the write policy.

**Shape as designed** (full description in `CLAUDE.md` — only the load-bearing constraints repeat here):

- Streamable HTTP at `/api/modules/assistant/mcp`; sessions are backed by a real assistant chat,
  one per client, keyed on `metadata.mcp.clientKey`. That key must be **header-stable and never the
  display name** — it is what lets every existing designer tool resolve its design unchanged via
  `contextResolver.getPrimaryDesign(chatId)`, and why MCP calls and proposals render in the panel.
- The 15 in-app `AiTool`s projected 1:1, plus MCP-only extended reads and the session-scoped
  `designer_use_design`. **Do not add the extended reads to the in-app registry** — its prompt and
  DoD harness are tuned against the current 15.
- Design targeting: explicit `designId` → session pin → UI-active design, pushed by the frontend to
  `PUT /api/modules/designer/active-design`.
- Two settings, both default off (`mcp_enabled`, `mcp_allow_writes`). Writes are forced off when the
  server is off, and write tools are then not registered at all.
- Bearer token plus loopback-only Origin check; discovery through a 0600 `mcp.json`. stdio clients
  use the bundled shim on the app's own Electron binary. The app must be running — there is no
  headless fallback, because there is one SQLite writer.

**Working-tree surfaces:** `src/modules/assistant/backend/mcp/`, `electron/src/mcp-shim/`,
`McpSection.tsx`, `0014_mcp_settings.sql`, `assistant-mcp-endpoint.test.ts`,
`designer/backend/active-design.ts`, `useActiveDesignSync.ts`.

- [ ] **Finish the WIP and commit it.** It is currently the only unversioned work in the repo.
- [ ] **Test it.** `assistant-mcp-endpoint.test.ts` exists; establish what it covers and fill the
      gaps — auth rejection paths, session/client-key stability, tool projection fidelity, the
      write-policy matrix (server off, server on + writes off, server on + writes on), and the
      active-design targeting precedence chain.
- [ ] **Exercise the stdio shim end-to-end** from a real external client against a running app,
      including the `mcp.json` discovery handoff.
- [ ] **Decide `mcp.server` flag graduation.** It is a `dev` flag today. Graduating it means
      flipping the registry entry to `"all"`, and carries the same release-notes obligation as the
      route-tool flags.
- [ ] Document the feature for users once the two settings are considered stable.

---

## 4. Release hardening

The least complete program. **The target has been corrected**: the old plan aimed at a signed,
notarized, auto-updating `1.0.0`. `ROADMAP.md` defers code signing and notarization while the
project is a solo beta, and the repo is at **0.1.1-beta**. This program now hardens the 0.1.x beta
line; signing is a Phase 5 item held behind explicit triggers.

**Signing position (from the roadmap, authoritative).** macOS Developer ID plus a Windows
individual-validation certificate — EV certificates are not available to individual developers.
Deferred while the project is a solo beta. **Revisit triggers:** 500 downloads/month, the first
commercial-licence enquiry, or macOS download share overtaking Windows. Until then, releases ship
`SHA256SUMS.txt` as the verification path. macOS auto-update is blocked behind the same decision —
Squirrel.Mac rejects the ad-hoc signature, so `canAutoUpdate()` excludes darwin; Windows (NSIS) and
Linux (AppImage) auto-update already ship.

### Correctness and data integrity

- [ ] Graceful shutdown — SIGTERM/SIGINT close the server and sqlite; the Electron backend-manager
      awaits exit before `app.quit()`.
- [ ] Global error handling — React error boundary, `window` error/unhandledrejection, main-process
      `uncaughtException`/`unhandledRejection` → Sentry plus a crash/recover UI. Sweep
      release-critical silent `catch {}`.
- [ ] Global toast: lift the designer toast into `core/frontend`, surface `DesignerDrcView` and
      `model-conversion.ts` silent catches, and translate `problem+json` by extending
      `commandErrorMessage`.
- [ ] DRC trust — fix the free-pad false `UNCONNECTED_NET`, then re-run `drc-parity-harness`.
      (The "broken thermal-relief check" half was a fill option, not a check; its world-frame spoke
      bug was fixed in S5.)
- [ ] KiCad ZIP import: aggregate size cap in `routes.ts` (mirror the opclib 256 MB limit).
- [ ] Symbol-only import: warn or block on 0-pad components (`commit-kicad.ts`,
      `placeholder-footprint.ts`).
- [ ] Show *all* import warnings in an expandable list, not only the first.

### Security

- [ ] Path-traversal fix in Electron static serving — `path.resolve` both sides plus a separator
      boundary check.
- [ ] Evaluate `sandbox: true`; confirm `contextIsolation`, `nodeIntegration: false`, CSP and the
      `127.0.0.1` binding.
- [ ] GLB `sha256` validation after fetch, and partition `ModelCacheProvider` by `backendURL`.
- [ ] `/security-review` clean on the cumulative diff.

### Assistant readiness

- [ ] **Blocker:** default-provider fallback when the cloud flag is off (`settings-store.ts`,
      `Space.tsx`, `DesignerChatDock.tsx`).
- [ ] Pre-send config validation (base URL plus API key) and an `empty_response` banner with retry.
- [ ] Keep `manifest.json availability: "all"`; correct the "dev-only" assistant wording in README
      and `CLAUDE.md`.
- [ ] Assistant tests: `run-service` mock-provider integration plus a Playwright chat smoke.
- [ ] Failed-apply regression test for the write/apply path.

### CoreLibrary runtime updates — import and security hardening

The status service, routes and Settings UI shipped. What remains is the security envelope and its
test matrix. *One item needs verification first: the stricter-signature requirement may already be
satisfied by the production Ed25519 signing key minted and trusted on 2026-07-27.*

- [ ] Enforce `manifest.library.minOpenPcbVersion` when present (plus a rejection test).
- [ ] Replace the ad-hoc semver compare in `sync/bootstrap.ts` and `sync/package-locator.ts` with a
      prerelease-aware comparison.
- [ ] Fix the URL install redirect policy in `sync/install-source.ts` — manual redirects, or
      validate the final redirected host against an allowlist (plus a regression test).
- [ ] Prevent generic `/sources/install` from replacing `openpcb.core` unless the package is
      trusted and the caller opts into the core-replacement path.
- [ ] **Verify, then enforce:** a production official core update must be signed by the committed
      trusted key; dev and test may warn.
- [ ] Source collision guard — reject packages that overwrite rows owned by another source, unless
      it is an allowed core legacy-alias migration.
- [ ] Rework `reconcileSourceRows()` so stale core rows are deleted only when unreferenced by
      components or design placements; otherwise mark and retain (plus a retained-when-referenced test).
- [ ] Preview SVG and model-store cleanup for unreferenced cache files after safe reconciliation.
- [ ] Finish the `.opclib` integrity gate: manifest integrity, `library.id === "openpcb.core"`,
      minimum component threshold and trusted signature are in; the compatibility gate is pending.
- [ ] Remaining status-route matrix cases (no installed core, installed-only, bundled-only) and the
      Libraries panel state/enablement tests.

### Packaging and distribution

- [ ] Revisit auto-update metadata before the first public non-beta release.
- [ ] GPG-sign Linux artifacts (deb / rpm / AppImage) — currently all unsigned.
- [ ] AppImage zsync / update channel for AppImageUpdate-compatible in-place delta updates.
- [ ] Validate the remote release workflow and the downloaded app after a commit/tag/push.
- [ ] Deferred behind the signing triggers: macOS Developer ID + hardened runtime + notarization,
      Windows signing (Azure Trusted Signing is the recommendation; an EV token does not work in
      CI), the `release.yml` identity/notarize flips, and gating `allowPrerelease` behind
      `!app.isPackaged`.

### Test, QA and accessibility

- [ ] Flagship E2E: schematic capture, PCB route, export → ZIP validate, DRC/ERC UI, undo/redo,
      settings persistence, library drag-and-drop.
- [ ] Import integration tests (malformed / missing-model / oversized / signature-fail) plus an
      export validation harness.
- [ ] Frontend Vitest uplift — coverage is still thin.
- [ ] Fix or quarantine the `library-opclib-importer-idempotent-reimport.test.ts` flake.
- [ ] Accessibility baseline: aria labels, keyboard canvas navigation, a screen-reader pass.
- [ ] Project export/import for backup and portability — ZIP of schematic + PCB JSON with embedded
      models.
- [ ] Wire the new suites into `.github/workflows/ci.yml`.
- [ ] Per-OS clean-machine smoke: install, launch, deep link, design, export, 3D. Verify Gatekeeper
      and SmartScreen behaviour for the current unsigned reality, and auto-update from a prior build
      on Windows and Linux.
- [ ] Rollback / yank runbook, extending `.github/RELEASE_DRY_RUN.md`.

### Owner tasks and open questions

- [ ] `LICENSE-COMMERCIAL.md` plus a working `licensing@openpcb.app` inbox (the dual licence stands).
- [ ] GH secrets for Sentry; the signing secrets wait on the signing decision.
- [ ] Sentry: opt-in and off by default per the roadmap. Needs first-run consent, a Settings toggle,
      sourcemap upload in `release.yml`, and a live DSN. **Open:** is a DSN provisioned?
- [ ] **Open:** is `licensing@openpcb.app` monitored?

---

## 5. PCB correctness hardening (supersedes DRC P0–P12)

**The P0–P12 sequence is retired.** As of 2026-09-06 the work is scheduled as a 20-session
correctness-hardening program in
[`docs/pcb-hardening/PROGRAM.md`](docs/pcb-hardening/PROGRAM.md) (connectivity → geometry →
zones/keepouts → pours → rule semantics → batch DRC → live/route parity → scaling → async →
manufacturability → DFM → electrical → SI → high-speed runway → routing → trust gate), with the
verified current-master inventory in
[`docs/pcb-hardening/00-ground-truth.md`](docs/pcb-hardening/00-ground-truth.md). Sessions 0–7 are
done (S7 authoritative batch DRC closed 2026-09-09); S8 (live / route parity) closed 2026-09-09
(`docs/pcb-hardening/07-live-parity-contract.md`); S9 (broad-phase scaling and determinism) closed
2026-09-09 (`docs/pcb-hardening/08-broad-phase-contract.md`: 10k primitives 3.5 s → 195.5 ms,
byte-identical to the exhaustive oracle); S10 (DRC execution responsiveness, B5-SYNC) closed
2026-09-10 (`docs/pcb-hardening/09-execution-contract.md`: the batch run on a persistent worker
thread, byte-identical; join / supersede / cancel / SSE; nothing persisted before completion); S11
(hole, pad and via manufacturability) closed 2026-09-10
(`docs/pcb-hardening/10-manufacturability-contract.md`: one drill derivation per object incl.
footprint slots, drill offsets and plating; the exact annular-ring kernel; sourced fab rows;
`VIA_TYPE_UNSUPPORTED` + export refusal for non-through vias; the Gerber flashing copper / mask /
paste from the S1 records with rotated macros; a per-layer artwork parity harness). The matching
`plated` / `drillSlotMm` / `drillOffsetMm` fields live UNCOMMITTED in the sibling `shared/`
checkout (kicad-import + rendering-core); the tags `kicad-parsers-v0.1.4` / `kicad-import-v0.2.0`
/ `rendering-core-v0.1.4`, the OpenPCB + CoreLibrary repin with a `package-lock.json` refresh
(verify with a real `npm ci`) and the CoreLibrary `bun tools/rebuild-previews.ts` re-pack are a
SEPARATE follow-up commit — until then new KiCad imports carry no plating / slot attributes and
existing library rows are corrected at read time from their stored raw pad type. S12 (DFM
overlays and copper shape — `docs/pcb-hardening/11-dfm-contract.md`) shipped 2026-09-11; S12b
(exact-arc geometry and polygon pads, re-owned from S12) is next, then S13.

**Binding decisions (unchanged).** Full scope — core plus DFM plus electrical plus SI · scoped
priority rules (first-match, *can relax*, board-minimum floor) · full multilayer 2–32 · breaking
changes allowed with migration (violation-id v2, KiCad-aligned severities, live net-class
resolution).

**Open bugs.** 1 audit finding remains unresolved — B7-1 (S13) — (B2-9 and B5-LIVE-PADGEOMS closed
in Session 0; B3-1/3/4/5/6 fixed in Session 1; B4-1/2/6/7 fixed in Session 2; B3-9/10 fixed in
Session 5; B6-1 registered in Session 7; B5-LIVE-ROT-PAD / B5-LIVE-TH-PAD-SIDE fixed and B7-1
registered in Session 8; B5-SYNC fixed in Session 10; B2-5/6/7 and B6-1 fixed in Session 11) and
is tracked as a `test.todo` with a real post-fix assertion in `drc-audit-b7.test.ts`. They
are enumerated with mechanism and anchors in
[`docs/drc/OPEN_FINDINGS.md`](docs/drc/OPEN_FINDINGS.md) — do not restate them here. Every finding
now has an owning session.

The old milestone items below are kept for their design detail and map onto sessions as follows:
P4 → S9 (spatial index) and S2 (containment on precomputed rings); P7 → S8 (engine relocation +
live parity) and S10 (async execution); P9 → S12; P12 (rules/severity UI) stays a backlog UI item
outside the program; review follow-ups → S6 (scalar scoped constraints, severity, waiver
migration, area-scope precision) and S2 (cutout crossing-overlap).

- [x] **Before S1:** `integ/trace-drag` decided 2026-09-06 — cherry-pick the 555-blinker fixture
      (`a340ed2`) onto master, park the drag work (branch kept). See `00-ground-truth.md` §9.
- [x] **S1 — connectivity (done 2026-09-06).** Contract, Astra ledgers and checklist in
      [`docs/pcb-hardening/01-connectivity-contract.md`](docs/pcb-hardening/01-connectivity-contract.md).
      Kernel `src/shared/pcb-connectivity/`; B3-1/3/4/5/6 live; register census 12. Next: S2
      (geometry: B4-1/2/6/7 + the S1 residuals filed for S2 — circumscribed oval/roundrect arcs).

- [x] **P4** [I] **Backend spatial index** — done as S9 (2026-09-09), without rbush: a
      dependency-free uniform grid (per-sub-segment trace entries) plus a boundary-edge index,
      `DrcOptions.broadPhase: "grid" | "exhaustive"` kept permanently as the oracle, `scripts/drc-bench.ts`,
      pair-count stats and a seeded fuzz corpus; 10k primitives in 195.5 ms
      (`docs/pcb-hardening/08-broad-phase-contract.md`).
- [ ] **P7** [I] **Async DRC + engine relocation + live/batch parity.** *Superseded: the
      engine relocation and live parity landed as S8; the async execution is S10
      (`docs/pcb-hardening/09-execution-contract.md` — a `node:worker_threads` worker and a
      designer-local run registry, NOT a TaskRuntime executor, no size threshold, no `202` on
      `/drc/run`; the old design below is kept for its history only).* A `'designer.drc'`
      TaskRuntime executor (scope id `drc:<designId>`) with slice-yield every 256 items and between
      groups, SSE progress and `AbortSignal` cancel; the route runs synchronously at ≤2000
      primitives and otherwise returns `202 {taskId}`. `run-helper.ts` dedupes the four call sites.
      The engine moves to `src/shared/drc/` behind re-export shims so live DRC and the worker
      consume the identical engine (only the net-class resolver and fab presets block the move, and
      both are pure). Live rewrite covers rotated pad rings, through-hole pads on all layers,
      session vias, neighbour net class and the short tier. **Parity acceptance:
      `|measured_live − measured_batch| ≤ 1e-9`; cancel must leave no partial persistence.**
      High blast radius. Depends on P4, and on P6 for live rules.
- [x] **P9** [C] **DFM overlay checks** — shipped as S12 (2026-09-11, contract 11): sixteen `dfm`
      codes on the shared artwork model (`src/shared/rendering/pcb/artwork/`, consumed by the Gerber
      writer AND the checks), per-side courtyard regions, and the copper-shape check. Left for
      later: a DFM section in the rules dialog (P12), silk-over-silk overlap, courtyard off-board,
      mask colours / 2 oz bridge rows, a per-board copper-shape budget, `pcb-standards.md`'s
      qualitative silk placement rules as checks, and splitting the five S12 files that exceed the
      500-line guideline (`copper-shape-kernel.ts` 1361, `checks/copper-shape.ts` 888,
      `courtyard-rings.ts` 679, `checks/solder-mask.ts` 671, `checks/silkscreen.ts` 528 — a
      mechanical split after S12b, not during the reviewed session).
- [ ] **P12** [I] **Rules and severity UI** — `PcbRulesTableEditor`, severity grid, waiver-comment
      flow, `customFabProfile` editor. The backend contracts (`drcRules`, `drcSeverityOverrides`,
      `customFabProfile`, `diffPairs`) are all persisted and ready to bind. Depends on P3, P6, P7.
- [ ] **Review follow-ups** — enforce scalar scoped constraints (trackWidth / via / annular / hole /
      edge rules; v1 enforcement is clearance-only), apply the scoped-rule optional severity, wire
      the v1→v2 waiver migration, improve area-scope closest-point precision (today it tests a
      representative midpoint and can over-relax a long trace), and fix cutout crossing-overlap
      (vertex containment misses perpendicular crossing rects).

**Program exit:** all 40 audit regressions live with zero `test.todo`, golden boards matching, a
6-layer board routing and checking end-to-end, and the S18 trust gate in `PROGRAM.md` passed.

---

## 6. Backlog

Unscheduled. Nothing here is committed to a release.

- [ ] **Export dialog — rest of the overhaul.** Fab-preset selector, per-layer and per-artifact
      selection, individual-file downloads. Extend `GerberExportOptions` *and* `parseExportOptions`
      — new fields that are not added to the parser are silently dropped over HTTP.
- [ ] **MPN data sources.** Map MPN/LCSC from KiCad symbol fields on import (in
      `@openpcb/kicad-import`), a component-editor sourcing UI, and optional CoreLibrary `.opclib`
      sourcing. The columns and the BOM inheritance plumbing are already in place; this populates them.
- [ ] **4-layer UI.** Current position, stated precisely because the old tracker contradicted
      itself three ways: after DRC P2 the type model supports **stackup 2–32**; the Gerber/drill
      export path handles 2 and 4 layers (12 artifacts for 2-layer, 14 for 4-layer); and
      `PcbBoardPanel.tsx` still renders a **hardcoded static "2-layer" pill** that is not bound to
      `board.layerCount`. The earlier "N-layer beyond 4 is impossible" claim is false and has been
      dropped. Remaining work is the UI: a layer-count / fabricator picker replacing the pill,
      per-design board thickness (`job-file.ts` hardcodes 1.6 mm), inner-layer Gerber validation
      (In1/In2.Cu, drill spans, via annuli, `.gbrjob` stack-up) and a 4-layer export-validation
      fixture. Note the cloud snapshot contract is deliberately pinned to 2/4 even though the
      desktop is 2–32.
- [ ] **Document plaintext API-key storage.** Keys are stored in plaintext today; `safeStorage` is
      the 1.1 plan. Until it lands, do not ship a "saved, encrypted locally" badge — document the
      actual behaviour instead.
- [ ] **Batch-undo grouping.** "Single undoable batch" is not true today: `groupId` is
      dataset-capture-only, so a compiled circuit costs one Cmd+Z per command — 40 for the 5-LED
      build. Needed for compiled circuits and for command batches generally.
- [ ] **Cloud Teams — desktop integration P1.9–P1.11. Not started.** The cloud side (org
      workspaces, members/roles, per-design grants, share links, role-aware authz) shipped and was
      E2E-validated 2026-06-10; the desktop side is the only remaining P1 work. Shared designs must
      become cloud-authoritative in the editor while personal and unshared designs stay local-first.
      P1.9 is the `cloud_link_authority` migration plus `cloudLink` authority fields (re-verify the
      next free migration number). P1.10 is `dispatchToCloudAndReplicate` — projection-driven
      refetch, **not** replay — plus a reversible authority upgrade/downgrade and a "Shared with me"
      list; note `linkDesignToCloud` cannot be reused because it early-returns. P1.11 is
      read-only/offline gating. P2 (WS client plus SSE push) and P3 (client rebase, multiplayer
      undo) follow later. **Full spec: `../docs/TODO-teams-sharing.md`** — that copy is authoritative.
- [ ] **Drill slot authoring.** Write-side create-command plus the `routes.ts` parser and an
      inspector UI for free hole/pad slots, plus canvas slot rendering; then footprint-pad slots and
      KiCad `(drill oval W H)` import. Read and export paths already exist.
- [ ] **THREE-free copper-fill kernel** — replace `THREE.Path` in the relocated kernel with plain
      point-array arc maths so `shared/rendering/copper-fill` carries no THREE dependency.
- [ ] **Visual verification before a production fab run** — render a board with copper pours and
      silk text in gerbv or the JLCPCB online viewer, and validate bottom-side CPL rotation against
      JLCPCB's 3D assembly preview. Top-side rotation is solid.
- [ ] **E2E with the 555-blinker fixture** plus a manual JLCPCB DFM check. Deferred to the first
      real fab attempt.
- [ ] **ESLint + `eslint-plugin-boundaries`** for compile-time `core ← shared ← sdks ← modules`
      enforcement.
- [ ] **Copper zones / keepouts.** S3a landed the `PcbZone` v2 / `PcbKeepout` data model, the one
      `collectCopperZones`/`collectKeepouts` derivation, KiCad import (rule areas as keepouts) and
      the `keepoutAffects` predicate (copper-pour subtraction wired in); see
      `docs/pcb-hardening/03-zone-keepout-contract.md`. S3b (authoring tools + storage migration
      of the fill toggle) and S4 (DRC codes, route obstacles + live check + via guard, fill-consumer
      parity) and S5 (zone cutouts, precedence carve, pour correctness) are done. Open:
      keepouts in the cloud snapshot wire contract (cloud session), a server-side route commit gate
      (S8); exact circle-pad discs for keepout verdicts landed in S7.
- [ ] Library variants / families / presets / provenance.
- [ ] Symbol and footprint editor expansion — multi-unit, alternate graphical body styles.
- [ ] OpenAPI codegen pipeline — revisit `gen:openapi` if and when frontend SDK regeneration is needed.
- [ ] E2E test expansion beyond smoke.
- [ ] Housekeeping: reconcile the shared `package-lock.json` left dirty by the `ai-core` 0.3.0 /
      `contracts` 0.2.4 bumps, delete the local FF-merged `fix/library-model-double-apply-guard`
      branch, and confirm a tag-based build on a fresh CI runner.

**Wontfix.** Schematic wire → PCB trace auto-sync. The bridge between schematic and PCB is the
netlist; ratsnest plus manual routing replaces it.

**Not doing (export).** Protel filenames, a UTF-8 BOM on the BOM CSV, and mixed-side splits — both
target fabs accept X2 filenames, a UTF-8 BOM risks JLC's column auto-mapper, and mixed-side is
informational. IPC-2581 / ODB++ / Gerber X3 component layers are deferred; X3 is the best-ROI
"intelligent format" when revisited, but it depends on MPN inheritance landing first.

---

## Proposals

Unbuilt, unscheduled feature proposals live in `docs/proposals/`:

- [`f1-design-blocks.md`](docs/proposals/f1-design-blocks.md) — reusable hierarchical design blocks
- [`f2-parametric-components.md`](docs/proposals/f2-parametric-components.md) — templated components
- [`f3-kicad-project-import.md`](docs/proposals/f3-kicad-project-import.md) — full KiCad project import
