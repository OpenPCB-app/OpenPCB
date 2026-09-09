# PCB correctness-hardening program

> Program tracker for making OpenPCB trustworthy on ordinary medium-complexity boards.
> Established 2026-09-06 (Session 0). Supersedes the retired DRC P0–P12 sequence in `TODO.md` §5.
> Companion documents: [`00-ground-truth.md`](00-ground-truth.md) (current-master inventory,
> produced by Session 0) and [`../drc/OPEN_FINDINGS.md`](../drc/OPEN_FINDINGS.md) (the defect
> register — one `test.todo` per open finding).

## Target

**One authoritative model of physical connectivity and legality, shared by DRC, pours,
zones/keepouts and manual routing.** Electrical and signal-integrity checks are then hardened so
that today's simpler checks do not create architectural dead ends for future high-speed work.

This is a correctness-hardening program, not a feature roadmap. Router cleverness, cloud
auto-layout, visual polish, richer tuning UX, impedance routing, field solving and advanced
autorouting are deliberately postponed until the foundation below is complete.

## Operating model

- **One session, one objective.** Do not broaden scope into adjacent subsystems unless required to
  prove or preserve the phase invariant. Do not opportunistically implement unrelated TODOs.
- **Fable 5.1 is the engineer** (exploration, implementation, tests, refactoring, integration).
  Implementation past the delegation break-even goes to Sonnet/Opus subagents per the
  `fable-orchestrator` skill; Fable reviews every diff.
- **GPT-6-Astra is the scarce correctness specialist**, reached only through
  `/pcb-hardening-review` (packet-first, read-only Codex, attack-and-specify, never writes code).
  Every Astra run needs explicit user approval; two-pass sessions need the user present at both
  points. Claude verifies every Astra finding against source before acting.
- **Ordinary software review** (architecture, plumbing, UI) uses the generic Codex review skills,
  not Astra.
- **Session lifecycle:** reconnaissance → written invariant/problem inventory → Astra attack when
  designated → verify Astra → implement → tests → self-review → optional post-implementation Astra
  → close only verified findings.
- **Astra effort policy:** `high` for narrow bounded review; `xhigh` for geometry algorithms,
  cross-subsystem connectivity, polygon booleans, routing kernels, electrical/SI; `max` only for
  disputed or exceptionally hard problems, with separate approval.

## Standing instruction for every session

```text
This session has exactly one PCB-hardening objective.

Do not broaden scope into adjacent subsystems unless required to prove or preserve
the phase invariant. Do not opportunistically implement unrelated TODOs.

Before changing code:
1. Read src/modules/designer/AGENTS.md and docs/pcb-hardening/00-ground-truth.md.
2. Reconcile live source with docs/drc/OPEN_FINDINGS.md and the corresponding
   drc-audit-b*.test.ts regressions.
3. State the current invariant, known failures, affected consumers, and explicit
   out-of-scope areas.
4. Identify whether the pcb-hardening-review Astra skill is required by this phase.
5. If required, prepare the minimal packet and invoke /pcb-hardening-review using
   the program-designated mode/effort. Do not ask Astra to implement.
6. Verify every Astra finding against current source before accepting it.

During work:
- Prefer fixing the authoritative shared model rather than patching consumers.
- Breaking changes are acceptable when they improve long-term correctness.
- Preserve determinism unless this phase explicitly changes its contract.
- Do not invent electrical/manufacturing constants (use /eda-standards or source).
- Add or activate regression coverage for every confirmed defect addressed.
- Exclude `_to_delete/` and `electron/out/` from every grep — they are gitignored stale trees.

Before declaring the phase complete:
1. Run the relevant focused tests.
2. Run the appropriate full backend/typecheck gates (see 00-ground-truth.md §0 for the
   baseline; no new failures beyond it).
3. Re-read the complete phase diff.
4. Perform the designated Codex/Astra post-review if required.
5. Classify every Astra finding as accepted/rejected/unresolved with evidence.
6. Confirm every phase exit criterion individually.
7. Update OPEN_FINDINGS only for defects proven closed by live regression tests.
8. Update this file's status column and summarize remaining risks without beginning the next phase.
```

## Dependency order (enforced)

```
S0  Ground truth
 └► S1  Connectivity truth
      └► S2  Geometry truth
           └► S3a Zone/keepout semantics + data model
                ├► S3b Zone/keepout authoring tools
                └► S4  Zone/keepout legality integration
                     └► S5  Copper-pour truth
                          └► S6  DRC rule semantics
                               └► S7  Authoritative batch DRC
                                    └► S8  Live DRC / route-legality parity
                                         └► S9  DRC broad-phase scaling
                                              └► S10 DRC execution responsiveness
                                                   └► S11 Hole / pad / via manufacturability
                                                        └► S12 DFM overlays
                                                             └► S13 Electrical rules
                                                                  └► S14 SI v1 correctness
                                                                       └► S15 High-speed runway
                                                                            └► S16 Base manual routing
                                                                                 └► S17 Advanced routing
                                                                                      └► S18 PCB trust gate
```

Do not, for example, improve diff-pair routing while SI's definition of coupled length is still
questionable, or optimize ratsnest performance while layer connectivity is still wrong.

## Sessions

Status values: `pending` · `in progress` · `done` · `blocked`. Owned findings use the ids in
`docs/drc/OPEN_FINDINGS.md`; `—` means the session owns no register entry.

### Stage A — one physical truth model

| # | Session | Objective | Owns | Astra | Status |
|---|---|---|---|---|---|
| S0 | Ground-truth reconciliation | Establish what is true on current master; inventory every defect, invariant, duplicate model, test contract and doc drift. No implementation. | B2-9 (closed), B5-LIVE-PADGEOMS (closed), B2-5 (narrowed), B5-LIVE-ROT-PAD (spec rewritten) | none | done 2026-09-06 |
| S1 | Physical copper connectivity truth | One trustworthy answer to "which copper is electrically connected": traces, pads, free pads, vias, layer transitions, same-layer and trace-interior junctions, schematic–pad correlation, ratsnest, pour-established connectivity. | B3-1, B3-3, B3-4, B3-5, B3-6 | spec-attack xhigh · adversarial-verify xhigh | done 2026-09-06 (`01-connectivity-contract.md`) |
| S2 | Core PCB geometry truth | Trustworthy geometric primitives: segment relations, polygon intersection/containment, pad outlines, board outline, cutouts, arcs, rotation, tolerance boundaries, distances. No spatial index. | B4-1, B4-2, B4-6, B4-7; cutout crossing-overlap (vertex-containment) follow-up | spec-attack xhigh · adversarial-verify xhigh | done 2026-09-07 (`02-geometry-contract.md`) |
| S3a | Zone / keepout semantic contract + data model | What a zone or keepout means everywhere: ownership/net, layer scope, board/cutout relation, zone vs keepout, enabled/disabled, persistence, import, render, Gerber, DRC and routing visibility. Types + parser + KiCad import + consumer visibility. Astra spec-attack run 1 aborted (usage limit); run 2 packet-only produced 18 findings, ledger §10. | — (new work; started from a KiCad-import-only `PcbZone` and no keepout type) | brainstorm or spec-attack xhigh (one call) | done 2026-09-07 (`03-zone-keepout-contract.md`) |
| S3b | Zone / keepout authoring tools | Zone drawing tool, keepout drawing tool, commands + `routes.ts` parsers, inspector UI, canvas rendering, storage migration of the fill toggle into board-zone rows. Consumes the S3a contract; introduces no new legality semantics. | — | none (reviewer-critical on the migration, reviewer on commands + UI; Codex review not run) | done 2026-09-07 (`03-zone-keepout-contract.md` §12) |
| S4 | Zone / keepout legality integration | Every legality consumer (DRC, routing obstacles, copper fill, manufacturing output) interprets zones and keepouts identically. | — | adversarial-verify xhigh (late) — run 1 completed, 5 findings all accepted | done 2026-09-07 (`03-zone-keepout-contract.md` §13) |
| S5 | Copper-pour correctness | Generated copper represents real, electrically meaningful copper: fill extent, obstacle clearances, board/cutout clipping, same-net interaction, thermals, island identification and anchoring, zone fills, render/export/fill consistency, determinism. Uses S1 connectivity, never a pour-local definition. | B3-9, B3-10 | spec-attack xhigh (run 1: 15 findings, 11 accepted) · adversarial-verify xhigh (run 2: 9 findings, 8 fixed, 1 limit) | done 2026-09-08 (`04-copper-pour-contract.md`) |

### Stage B — make DRC authoritative

| # | Session | Objective | Owns | Astra | Status |
|---|---|---|---|---|---|
| S6 | DRC rule semantics and scoped constraints | Complete, unambiguous rule resolution: board rules, net classes, scoped rules, precedence, relaxations, floors, pair kinds, layers, area scopes, severity, waivers, migrations. Every stored rule type has one documented resolution path; nothing appears supported while inert. | scalar scoped constraints not enforced; area-scope midpoint approximation; optional severity ignored; v1→v2 waiver migration | spec-attack xhigh (run 1: 15 findings, 14 accepted, 1 limit) | done 2026-09-08 (`05-rule-semantics-contract.md`) |
| S7 | Authoritative batch DRC completeness | Audit every check against the hardened primitives: duplicated geometry/connectivity models, checks bypassing shared rule resolution, declared-but-unemitted codes, primitive types checks cannot see, unit inconsistencies, false-pass directions, ordering. Batch DRC becomes the reference implementation. | — | repository-grounded adversarial-verify xhigh (run 1: 8 findings — 5 fixed, 2 contract corrections, 1 registered B6-1) | done 2026-09-09 (`06-batch-drc-contract.md`) |
| S8 | Live DRC and manual-route legality parity | A route legal interactively is legal when committed and batch-checked, and vice versa where practical. Engine relocation to `src/shared/drc/` behind shims so both paths share item builders and kernels. Decide whether route commit gets a server-side clearance gate. | B5-LIVE-ROT-PAD, B5-LIVE-TH-PAD-SIDE | spec-attack xhigh · adversarial-verify xhigh | pending |
| S9 | DRC broad-phase scaling and determinism | Faster candidate discovery without changing meaning; exhaustive mode retained as oracle; byte-identical reports. Target 10k primitives under ~300 ms. | — | spec-attack xhigh; post optional | pending |
| S10 | DRC execution responsiveness | Expensive DRC runs without blocking the app: lifecycle, cancellation, progress, concurrency, partial-result semantics, deterministic final output. | B5-SYNC | none by default | pending |

### Stage C — manufacturing and electrical trust

| # | Session | Objective | Owns | Astra | Status |
|---|---|---|---|---|---|
| S11 | Hole, pad and via manufacturability geometry | Drill geometry, slots, PTH/NPTH, annular geometry, via type/span, aspect semantics. DRC's model of manufactured holes matches export. | B2-5 (manufacturability half), B2-6, B2-7 | spec-attack xhigh · adversarial-verify xhigh | pending |
| S12 | DFM overlays and production checks | Courtyard, silkscreen, mask bridges/slivers, copper slivers, acute angles — built at Gerber parity. | — (no overlay codes exist today) | spec-attack xhigh; post only for polygon-topology checks | pending |
| S13 | Electrical-rule fidelity | Voltage difference, clearance/creepage semantics, external/internal assumptions, current vs width, layer-dependent assumptions, defaults, applicable pad/via/trace combinations, interaction with net classes and scoped rules. Precise modest claims over ambitious labels. | — | spec-attack xhigh · adversarial-verify xhigh | pending |
| S14 | SI v1 mathematical correctness | Routed length, branches/stubs, disconnected fragments, via contribution, coupled-span accounting, overlapping segments, gap measurement, diverging gap, layer transitions, pair ordering, determinism. Every reported SI number has a precise definition. | — | spec-attack xhigh · adversarial-verify xhigh | pending |
| S15 | High-speed architecture runway | Identify contracts/data representations that would block credible future SI (stackup geometry, dielectrics, per-layer copper, reference planes, propagation delay, via barrel path, impedance targets, return-path continuity). Produce a compatibility document; change only what prevents a known dead end. | — | brainstorm xhigh (one call) | pending |

### Stage D — routing after legality is trustworthy

| # | Session | Objective | Owns | Astra | Status |
|---|---|---|---|---|---|
| S16 | Base manual-routing correctness | Manual 45/90 routing, finish behaviour, obstacle representation, walkaround, pull-tight, bounded auto-finish, deterministic geometry — as a consumer of the authoritative legality model. Failing to find a path is acceptable; accepting an illegal route is not. | — | adversarial-verify high/xhigh | pending |
| S17 | Advanced routing: tune, bundle, diff-pair | Tuning, bundle offsets, diff pairs, lane relationships, length targets verified against connectivity, DRC, diff-pair semantics and SI v1. Consumes SI/DRC definitions; invents none. | — | spec-attack xhigh for algorithm changes; post if kernels change | pending |
| S18 | PCB trust gate | Attempt to prove the hardened subsystems still disagree. Representative boards (2-layer and multilayer, SMD + PTH, free pads, slots, vias, cutouts, concave outlines, zones, keepouts, pours, islands, GND, high-current, higher-voltage, diff pairs, tuned routes, intentionally broken layouts) plus a realistic medium board, verified across schematic → connectivity → ratsnest → routing → live legality → batch DRC → pours → zones → DFM → electrical/SI → Gerber/Excellon. | — | repository-grounded adversarial-verify xhigh; `max` only on a disputed critical finding | pending |

## Per-session exit gates

- **S1** — pending regressions live; no net-name special case manufactures connectivity by
  itself; free pads participate; layer changes require physically legitimate connections
  (a via whose span covers both layers); results deterministic; ratsnest and `UNCONNECTED_NET`
  agree; the six connectivity models in `00-ground-truth.md` §4 are reduced to one, or every
  remaining consumer is proven equivalent. S1 consumes only `src/shared/pcb-geometry/` kernels
  and lists which; it never inlines a predicate.
- **S2** — higher-level code can ask intersects / contains / distance / off-board / inside-cutout
  without a second approximation; arc flattening bias is explicit and safe per use; the
  duplicate predicates in `00-ground-truth.md` §4 are unified or their divergence is documented as
  intentional.
- **S3a** — one written zone/keepout contract; nobody can ask "does this keepout affect this
  object?" and get different answers from DRC, routing and rendering.
- **S3b** — authoring tools produce only data the S3a contract defines; every command has its
  `routes.ts` parser; no tool-local legality.
- **S4** — zone/keepout behaviour coherent across DRC, routing obstacles, copper fill and
  manufacturing output before pour hardening starts.
- **S5** — a pour is called electrically connected only when the S1 model can justify it;
  render, export and fill paths represent the same copper; `measuredMm` carries millimetres.
- **S6** — every supported rule type has one documented resolution path; no stored rule is
  silently inert; routing and live DRC consume the same resolver as batch DRC or the divergence
  is an explicit, tested contract.
- **S7** — batch DRC can be called the reference implementation; the emit census still shows
  every declared code emitted and every emitted code declared.
- **S8** — for equivalent geometry, live and batch agree on collision class, affected layer,
  required rule, legal/illegal boundary and measurement (`|measured_live − measured_batch| ≤
  1e-9`); the route-commit gate decision is recorded and implemented.
- **S9** — optimized and exhaustive modes agree byte-for-byte on representative medium boards;
  ordering stable; no false negatives introduced.
- **S10** — expensive runs no longer block command dispatch or SSE; cancel leaves no partial
  persistence; B5-SYNC regression live.
- **S11** — DRC's representation of drilled and plated structures matches what export emits,
  slots included.
- **S12** — DFM checks use the same physical geometry export uses.
- **S13** — no check claims more than its model proves; every electrical constant is sourced.
- **S14** — every SI number has a precise mathematical definition and a testable interpretation.
- **S15** — a future-SI compatibility document exists; near-term changes only where they prevent
  a known dead end.
- **S16** — the route tool reasons consistently and deterministically about any legal path it
  represents.
- **S17** — advanced routing consumes SI/DRC definitions rather than competing definitions of gap,
  length or legality.
- **S18** — the cross-subsystem disagreement hunt finds nothing, or every finding is filed with
  an owner.

## Astra allocation

| Session | Astra use |
|---|---|
| S0 | none |
| S1 | **xhigh pre + xhigh post** |
| S2 | **xhigh pre + xhigh post** |
| S3a | xhigh once (run 1 aborted on quota, run 2 completed) |
| S3b | none |
| S4 | xhigh post (run 1 completed; 5 findings accepted) |
| S5 | **xhigh pre + xhigh post** |
| S6 | high/xhigh once |
| S7 | xhigh post (repository-grounded) |
| S8 | **xhigh pre + xhigh post** |
| S9 | xhigh pre; post optional |
| S10 | none normally |
| S11 | **xhigh pre + xhigh post** |
| S12 | xhigh pre |
| S13 | **xhigh pre + xhigh post** |
| S14 | **xhigh pre + xhigh post** |
| S15 | xhigh brainstorm once |
| S16 | high/xhigh once |
| S17 | xhigh when changing algorithms |
| S18 | **xhigh post** (repository-grounded) |

If quota becomes tight, the non-negotiable Astra sessions are **S1, S2, S5, S8, S11, S13, S14 and
S18** — where a false pass translates most directly into an electrically incorrect or
unmanufacturable board.

## Cross-cutting decisions and open items

- **`integ/trace-drag`** (6 commits, +1905/−7, trace-segment drag + 555-blinker fab fixture) must
  be merged or parked **before S1**. Its `PcbCanvas.tsx` / `PcbScene.tsx` hunks overlap master's
  later work; the 555 fixture (`src/core/backend/tests/fixtures/blinker-555.ts` on that branch)
  is wanted for S18.
- **Fixture infrastructure** is a shared gap: the golden corpus is one 2-layer board, the parity
  harness builds synthetic projections, and there is no KiCad project fixture in-tree. Each session
  that needs a multilayer or realistic board adds it to `src/core/backend/tests/fixtures/`.
- **Route-commit server gate** (today: none; all collision legality is client-side) — decided in
  S8.
- **Cloud contract boundary** — the cloud snapshot pins copper layers to 2/4 and strips
  electrical/SI fields; nothing in this program assumes cloud and desktop DRC agree.
- **S1 decisions (2026-09-06)** — connectivity = physical copper overlap on a shared layer
  (`CONNECT_EPS_MM = 1e-6`, float noise only); two layer policies over one geometry (fail-safe for
  connectivity, clamp for shorts); GND is an ordinary net (airwires + `UNCONNECTED_NET` until a
  pour exists); `pcb.padShapeConnectivity` retired; free pads are graph nodes and ratsnest
  endpoints (`RatsnestEndpoint`), omitted from cloud autoroute targets with a snapshot warning;
  `checks/copper-pour.ts` keeps computing islands independently in S1 (S5 consumes the kernel).
  Filed for later sessions from the S1 Astra/review ledger: fill-kernel layer predicates diverge
  from the contract for `std` free pads on inner layers and for vias without a layer count (S5);
  no DRC check for copper over an NPTH hole (closed in S7: `COPPER_TO_HOLE`); pad plating attribute missing (S11);
  zero-neck corner contact and coincident duplicate traces (S12 DFM); segment-level broad-phase
  (S9); contact locations for length walks (S14); default-exclude GND-class nets from cloud
  autoroute targets? (cloud session).
- **S2 decisions (2026-09-07)** — one polygonal board region for legality
  (`src/shared/pcb-geometry/board-region.ts`), closed set at `GEOM_EPS_MM = 5e-7`, every arc
  flattened toward the board side (`R_poly ⊆ R_true`, error ≤ 0.01 mm, tangent chains with exact
  endpoints, refinement on flattening-induced self-crossing); `COPPER_OFF_BOARD` judges copper with
  its width and co-fires with the unsigned edge gap; outline validity runs on the biased rings, so
  touching / tangent / abutting cutouts and a cutout touching the edge are invalid (merge them);
  self-touching rings invalid; full circles follow the chord rule with 64 as a floor;
  canonicalised rings (full-radius rounded slots no longer falsely invalid); one inclusive segment
  predicate, one arc sampler for outlines, pad-outline sampler left as a documented divergence.
  Filed for later sessions from the S2 ledgers: exact disc for circular pads in edge + clearance
  checks and a signed edge clearance / second-chance test inside the chord band (S7); copper-fill
  extent from `buildBoardRegion` and its 0.005 mm via tolerance (S5); board-edge and cutout route
  obstacles from the same region (S8/S16); spatial index — Astra's cost probe puts `checkBoard`
  at ≈ 1.6 s for 300 pads × ten 100-chord cutouts, linear in pads × boundary edges (S9); exact-arc
  contour validity, minimum-web / connected-material checks, Gerber true arcs (S12). Process note:
  the first adversarial-verify run was cut off by the provider's content filter on the
  "adversary / attack" scaffold wording; the re-run with verification wording completed — keep
  the neutral scaffold (`scratchpad/s2/astra-adversarial-verify-prompt-v2.txt`) for later sessions.
- **S3a decisions (2026-09-07)** — `PcbZone` v2: one zone = one layer, a persisted `netId` with a
  `netName` import hint bound at projection time, `region` is `board | polygon`, an integer
  `priority`, tighten-only clearance/min-width overrides, `padConnection` is
  `solid | thermal | thruHoleThermal | none`, and `islandRemoval` composes onto the board default.
  New `PcbKeepout`: a layer set plus five restrictions (`tracks`, `vias`, `pads`, `copperPour`,
  `footprints`). A read-time v1→v2 upgrade (`upgradePcbZoneRecord`) is the only zone-payload reader,
  including the legacy net-less rule — a v1 row with no net imports `enabled: false` so the data-
  model change can never make it start pouring. One derivation, `collectCopperZones` /
  `collectKeepouts` in `src/shared/pcb-areas/`, replaces the seven pour-list copies; the board fill
  toggle stays view state and `applyLegacyBoardFillPolicy` (shared by the projection and the
  canvas) is the one place that turns it into a board zone. One predicate, `keepoutAffects`, treats
  a keepout as the open interior of its polygon at `GEOM_EPS_MM` (touching the boundary is legal),
  with a rule per object class. `copperPour` keepouts are now subtracted from every fill (with a
  grid-step guard so quantisation cannot round copper back into the keepout). KiCad rule areas
  import as keepouts, with per-arc S2 bias; hole contours import disabled (fail-safe, zone imports
  disabled rather than pouring more copper than drawn). The 3D preview now follows the same
  effective list as Gerber, canvas and DRC. Filed for later sessions from the S3a ledgers: S3b —
  storage migration of the fill toggle into board-zone rows plus an explicit per-zone net picker,
  zone/keepout authoring commands, hole support in zone regions (flip the bias for hole rings),
  selection/inspector; S4 — `KEEPOUT_VIOLATION` / `ZONE_OVERLAP` / `ZONE_OUTLINE_INVALID` / an
  empty-fill warning consuming `keepoutAffects` and `DrcContext.copperZones`/`keepouts`, placement
  extent (courtyard else pad+graphics bbox), route obstacles from keepouts, cloud snapshot
  keepouts; S5 — inter-zone precedence/clearance in the fill (other pours as obstacles;
  equal-priority symmetric exclusion), net-class clearance into the fill via the rule resolver
  (S6), Gerber pour emission order vs LPC, `pcb_cleanup_pour_traces` widening, free-pad/rotated-pad
  thermal spoke geometry, B3-9/B3-10; S9 — keepout predicate and precedence complexity bounds.
  Process note: prompt-only Astra runs must use a neutral cwd (`/tmp/...`) and an explicit "reason
  over the packet only" instruction — run 1 inferred the repo path from the scratchpad directory
  name and burned the quota reading files.
- **S3b decisions (2026-09-07)** — the per-layer copper fill is a persisted board-zone row
  (`region: { kind: "board" }`, id `board:<layer>`, at most one per layer by id uniqueness), not
  view state: `PcbViewState` lost `copperFillLayers` / `copperFillPourNetIds` /
  `copperFillPadConnection`, `applyLegacyBoardFillPolicy` is deleted, and `collectCopperZones`
  takes zone rows only (`padConnection` default is the constant `"solid"`). Legacy rows migrate
  lazily through `migrateLegacyBoardFill` on every entry point that can write board settings
  (projection load, dispatch, history replay), before the settings row is parsed — the row persists
  the ground net's NAME (fallback hint `"GND"`), never an ephemeral id. Zone / keepout rows carry a
  uuid row id with the entity id in the payload because `designer_pcb_entities.id` is a global
  primary key. Six commands (`pcb_add/update/delete_zone`, `pcb_add/update/delete_keepout`; flat
  optional fields + `locked`, per repo convention) with `routes.ts` parsers pinned by a full-field
  HTTP round-trip test, undo/redo arms in the ECS world diff (payload id as entity id), ring
  validity through the shared `zoneRingValidity` in the executor AND the tool. Tools: Zone (Z) and
  Keepout (K) on the board-shape sketch machinery with an options bar (layer / net / pad
  connection; layers / five restrictions, default all forbidden), edge-only hit-testing (an
  interior hit would swallow marquee starts over a pour), vertex drag / insert / delete, an
  inspector, `ZoneOutlineLayer` (solid ring / dashed ghost), and the layers-panel fill toggle now
  driving the board-zone row (undoable; net + pad-connection pickers). Zone holes deferred to S5.
  Filed for later sessions: interior-click selection and whole-object drag-move (UI follow-ups);
  hole rings with the import-bias flip (S5); `knownNetIds` asymmetry in `drc-context` /
  snapshot / Gerber (S4/S5); `parseDispatchResultJson` arms for the free-hole / free-pad / overlay
  codes (housekeeping); `NetSelect` shows an unresolved zone net as "No net" (UI follow-up); a
  `@openpcb/contracts` release mirroring the five new dispatch-result codes (the installed 0.2.6
  copy adds one duplicated drift error to the typecheck baseline: 42 → 44). Gerber pour emission
  order (explicit zones before the board plane, derivation order) is now pinned by a test. Process
  note: the S3a golden delta prediction "none" held; the one modified golden in the tree is S1's
  documented `UNCONNECTED_NET` change.

- **S4 decisions (2026-09-07)** — legality integration (`03-zone-keepout-contract.md` §13). Four
  DRC codes declared, emitted, labelled and tested together: `KEEPOUT_VIOLATION` (one per affected
  item–keepout pair through `keepoutAffects`; traces, vias and pads on their DRC clamp layer sets,
  placements on their side layer with a resolved extent), `ZONE_OVERLAP` (different-net polygon
  zones on one layer with positive-area overlap — **any priority until S5** implements the §5
  precedence carve, because today both zones pour the contested area and the Gerber carries a
  short; S5 narrows it to equal priority), `ZONE_INVALID` (non-overridable, non-waivable: every
  reason the derivation refuses an enabled zone or keepout — a dropped keepout is fail-open) and
  `ZONE_EMPTY_FILL` (net-unbound zones and effective zones whose fill has no island). DRC consumes
  the derivation's own warnings (`DrcContext.copperAreaWarnings`, a total mapping) rather than
  re-deriving. **Parity is enforced by the compiler:** `pourParamsForZone`, `boardPourSpecs` and
  `collectCopperZones.knownNetIds` lost their defaults, which exposed that only the canvas and the
  3D preview had ever subtracted keepouts — Gerber, the snapshot pours, the DRC island check,
  `pcb_cleanup_pour_traces` omitted the argument and the connectivity pours lost it inside
  `BoardPourSpec` (the contract's S3a claim is corrected in §4 / §10.2). Placement extent =
  courtyard hull flattened **outward** (circles at `r·sec(π/16)`, arcs through the S2
  circumscribed chain — the plain hull undershot both, R1 finding) else the transformed
  pads+graphics bounds else the pad bbox; the raw-KiCad courtyard lookup is a pre-fetched
  `DrcOptions.lookupRawFootprint` built by every production entry point (DRC run, SDK, cloud
  apply) so the engine stays a pure function of its input. Routing: `tracks` keepouts are
  floor/ceil AABB superset obstacles, the live check runs the exact predicate per pending segment
  (`trace-keepout`, commit-blocking like a clearance conflict), a `vias` keepout refuses a smart
  via (tested on the nm-quantised centre), `placementSideLayer` is the one side resolution; no
  server-side route gate (S8). Cloud: the vendored `BoardSnapshot` schema stays keepout-free; the
  snapshot pours subtract keepouts and the apply-time DRC report surfaces `KEEPOUT_VIOLATION`.
  Third golden `golden-areas-2l` (51 violations) pins the codes; the two older goldens are
  hash-identical. Filed: S5 — fill kernel failure contract (`buildCopperFillIslandReport` throws
  where the connectivity twin swallows; a kernel bail is indistinguishable from an empty extent),
  narrow `ZONE_OVERLAP` once the carve lands, `BoardPourSpec` as a structural `Omit<ZonePourParams>`;
  S7 — exact circle-pad discs for keepout verdicts, `custom`-pad `preview.bounds` superset check;
  S8 — server-side commit gate, live `trace-keepout` dedupe per segment; S9 — live keepout check
  and `checkKeepouts` are O(items × keepouts) without an index; cloud session — keepouts in the
  wire contract. Process notes: `ZONE_INVALID` replaced the S3a-reserved name `ZONE_OUTLINE_INVALID`
  (it covers layer and id drops too); the macOS shell has no `setsid`, so a long Astra run is
  launched with `nohup … &` and a `Monitor` on a done-marker rather than a tool-timed command.
  Astra adversarial-verify (xhigh, repository-grounded, one run): 5 findings, all verified by probe
  and accepted — opposite-winding keepouts cancelled in the fill (blocker; rings now CCW-normalised
  in the derivation and the kernel), `pcb_cleanup_pour_traces` deleted a trace bridging two islands
  (blocker; coverage is now geometric single-island containment), a polygon zone over a board plane
  of another net reached no check while Gerber `LPC` opened its pads (blocker; reported until S5),
  duplicate-id rows on different layers gave order-dependent ids (fixed), an undersized authored
  courtyard hid pads from the `footprints` extent (extent now hulls the pads). Ledger: contract
  §13.8.

- **S5 decisions (2026-09-08)** — copper-pour correctness (`04-copper-pour-contract.md`). **One
  copper geometry:** the fill kernel classifies S1's `buildCopperRecords` records (real
  `layerCount`, `resolvedLayers`, `declaredLayerInvalid` / `layerSpanInvalid`, the circumscribed
  ring + exact disc, `rotationDeg` + `mirrored`) instead of its own pad polygons and 32-layer stackup;
  a layer-invalid record is a different-net obstacle on every layer; `std` free pads pour on inner
  layers. **Flattening bias per role:** every obstacle is a superset (circumscribed pads, vias and
  trace caps — the inscribed caps under-cleared a 6 mm trace by 4.4 µm, R1), drills circumscribed.
  **Extent** from `buildBoardRegion(…, "board-inner")` in one round inset (+`ε`, +0.01 on a fallback
  ring); **conservative quantisation** (forbidden regions +`q`, the zone's outer ring −`q`).
  **Clearance per obstacle net** `max(zone tier, class(pour net), class(item net), floor)` — a 0.8 mm
  net class poured at 0.5 before (Astra run 1 #1, blocker); scoped rules stay S6. **Precedence** (S3a
  §5) enforced: `pourParamsForZone(zone, rules, keepouts, zones, nets)` (five required arguments —
  the S4 parity trick) emits exclusions of every other-net zone with priority ≥ this zone's, inflated
  by the mutual clearance; `ZONE_OVERLAP` narrowed to equal-priority pairs. **Thermals** in the
  pad-local frame (first spoke at 90°, reflected for mirrored pads; the old fixed world angle aimed
  at corners). **Islands:** `buildCopperFillIslands` → `{ status: "ok" | "failed", islands }`,
  islands canonical and in the total order for every consumer; `attached = memberKeys.length > 0`
  is the removal criterion; every clipper primitive throws `CopperKernelError` (no `[]`-on-throw),
  a collapsed union / positive dilation is `failed`, an erosion emptying is `ok`; `three` left the
  kernel (`copper-fill-shapes.ts`). **DRC:** `pourResults()` computed once and shared by the
  connectivity graph and `checks/copper-pour.ts`; `ISOLATED_COPPER_ISLAND` = S1 component without a
  pad (B3-10), `measuredMm` dropped (B3-9), new `ZONE_FILL_FAILED` (non-overridable). **Consumers:**
  Gerber emits per-net unions of the layer's pours in the total order (ancestor-first) with per-island
  `%TO.N`, reads `projection.padNets`, and fails the export with a 422 problem on a failed fill or a
  collapsed union; snapshot warns on a failed zone; cleanup covers explicit zones. **Zone holes**
  (user decision: full): `region.polygon.holesMm`, `zoneRegionValidity` (strictly inside, no
  contact, pairwise disjoint, no nesting) → `zone_hole_invalid` → `ZONE_INVALID`; KiCad hole
  contours import enabled with outward bias; Shift+Z cutout tool, hole-ring vertex editing,
  inspector. New golden `golden-pours-2l` (45 violations); `golden-areas-2l` lost exactly the
  priority-pair `ZONE_OVERLAP`; `small` / `cutouts` byte-identical. Stated limits: the 0.5 mm floor and
  scoped rules (S6), NPTH at the edge rule (S11), union necks (S12), per-pour removal, ≤ q/√2 Gerber
  re-quantisation, no compute budget (S9/S10). Filed: cutout-ring drag has no live outline (UI);
  `thruHoleThermal` on a `std` free pad with `drillMm` null and blocked-spoke relocation (S7/S12);
  `region.fallbacks` branch has no fixture (`test.todo`); the KiCad parser test file lives outside
  both runners; the ratsnest path builds copper records twice. Process: Astra run 1 (spec-attack,
  prompt-only, ≈40 min) 15 findings — 11 accepted, 2 recorded limits, 2 rejected with source
  evidence; R1 (reviewer-critical) 9 findings, R2 (reviewer) 6; Astra run 2 (adversarial-verify,
  repository-grounded, ≈35 min) 9 findings, all traced and verified: obstacle windings cancelling
  into a flood (blocker; rings normalised), circumscribed trace caps as false membership evidence
  (exact segment contact now), the opening re-joining lobes through a sub-`w` neck (recorded limit,
  §7 reworded, S12), the canvas' global-index via bucket (removed), cleanup deleting the trace that
  kept its island alive (refill fixed point), KiCad hole classification on the inward outline
  (outward now), slotted drills as discs (stadiums), a sub-grid obstacle vanishing inside a
  non-empty union (`failed`), zero edge clearance skipping the `q` inset (always inset) — ledger
  `04-copper-pour-contract.md` §15. Gates at close: backend 1845 / 22 known / 8 skip / 6 todo (1881),
  tsc 44, Vitest 61 files 512 + 1 todo, gen clean, e2e 11/11.

- **S6 decisions (2026-09-08)** — DRC rule semantics (`05-rule-semantics-contract.md`). **One
  resolver:** `createRuleResolver(board, netNames, { validCopperLayers })` in
  `src/shared/drc/rule-resolver.ts` (+ `rule-compile.ts`) is consumed by batch DRC, the live
  route gate, route obstacle inflation, the pour composition (`ZonePourNets = { resolver }`) and
  the via insert gate; `resolveRouteClearancesMm`, the live inline `max`, and the kernel's
  `resolveCopperFillClearanceMm` / 0.5 constant are gone (the constant became the board rule
  `pourToCopperMm`, absent = 0.5). **Scalar scoped rules enforce** (first match, then the board
  minimum as the floor); **area scopes are evaluated on regions of constant membership** —
  trace segments split at every area ring (`splitSegmentAtRings`), per sub-segment pair at the
  closest points, largest deficit reported in the canonical (sorted-anchor) orientation — the
  representative-midpoint false pass and Astra's single-segment two-hotspot case both close;
  **multi-layer pairs** report the first violated layer with the maximum requirement and the
  most severe input. **Severity:** drafts carry no literal (49 removed); `override → matched
  rule → DEFAULT_SEVERITY_BY_CODE`; `NON_OVERRIDABLE` is the one non-waivable list;
  `HOLE_TO_BOARD_EDGE` breaches → `HOLE_OFF_BOARD` (an `"ignore"` override is copied on read).
  **Validity:** `pcb_set_design_rules` refuses malformed rules (`INVALID_DRC_RULE`, nothing
  persisted); persisted invalid rules → `DRC_RULE_INVALID` (non-overridable), partially
  ineffective / clamped rules → `DRC_RULE_INEFFECTIVE`; 31 area polygons max. **Pours:** per
  obstacle kind (`pourToTrace/Pad/Via`, `pourToPour` for zone–zone with masks 0), only rules
  with an explicit pour `pairKind` scope reach a fill, area scopes never relax a fill.
  **Comparison regime:** `clearanceViolated = gap < required − GEOM_EPS_MM` (0.5 nm grace;
  P-A2 still fires). **Options default from the projection**, so the assistant / MCP report
  equals the HTTP report. **Store:** update path preserves optional keys (`electrical`, floor,
  `holeToBoardEdgeMm`, `pourToCopperMm`; `null` clears), read path never invents them; new
  boards get floor 0.1; fixtures and goldens stay floor-free; stale (non-v2) waiver ids pruned.
  **Default class** stays `netClasses[0]` (one helper `defaultNetClassId`; Astra showed a
  `default`-id preference would silently change boards). **Live gate:** every (pending
  sub-segment, neighbour sub-segment / pad) pair through the same procedure, pending class from
  the net, short tier refuses; router inflation is a stated heuristic. **KiCad import:**
  `design_settings.rules` → minimums / floor / edge, `Default` class → board clearances,
  `nets` / `netclass_patterns` / `netclass_assignments` → per-net assignments, `.kicad_dru` →
  warning. **User decisions:** no scoped-rules UI (filed), explicit pour rule + pour pair kinds,
  waivers stay ids, Astra xhigh once. Codes 48 → 51. Goldens: `small` / `areas` / `pours`
  byte-identical, `cutouts` changed by exactly the one `HOLE_OFF_BOARD` id (`c611f7…` →
  `e5afb6…`), new `golden-rules-2l` (`773252…`). Stated limits: area relaxations never reach
  pours (exact clipped halo filed), sub-segment products are `O(n·m·(R+V))` on pairs that meet an
  area (S9), gate covers trace–trace / trace–pad only (S8), scoped rules not in the cloud
  snapshot, `CREEPAGE_DISTANCE` keeps `below()` (S13), `zonePourNets` compiles per call (hoisted
  in the 3D preview), `ruleResolverFor` loads the schematic projection per via insert. Process:
  Astra run 1 (spec-attack xhigh, prompt-only, ≈25 min, 27k tokens) 15 findings — 14 accepted,
  1 limit, 0 rejected; R1 (reviewer-critical) 10 findings all fixed or routed (incl. a pre-existing
  fast-path determinism hole); R2 (reviewer) 7 findings all fixed (the save validator on a partial
  payload, the two undeclared snapshot keys — now stripped —, the parity test's missing gate leg). Gates at close (frozen tree): backend 1952 pass / 22 known / 8 skip / 6 todo (1988),
  tsc 44, Vitest 62 files 527 + 1 todo, gen + contracts clean, e2e zones + board-shape + routing
  13 passed + 1 flag-skipped (an earlier fill-toggle click timed out only while the full backend
  suite ran concurrently — run e2e on an idle machine); census greps empty (no
  `resolveRouteClearancesMm` / `resolveCopperFillClearanceMm` / `clearanceForNetMm` /
  `computeViolationIdV1`, no product `netClasses[0]`, no severity literal in a check). Tree: 125
  files modified (+15669 / −4883), 223 entries incl. untracked, S0–S6 all uncommitted.

- **S7 decisions (2026-09-08/09)** — user: `COPPER_TO_HOLE` now (optional `clearance.copperToHoleMm`,
  absent = the edge rule the pour's NPTH halo has always used; KiCad `min_hole_clearance` maps to it),
  `UNCONNECTED_NET` derived in-engine (`ratsnestFromConnectivity` split out of `computeRatsnest`), the
  exact-arc second chance deferred to S12, one post-implementation Astra run. Fable: canonical report
  (`(code, id)` sort, unique ids with a most-severe / largest-deficit dedupe, byte-identity under the
  eight input reversals; `drcRules` order stays semantic for equal-priority ties), `drc/pair-gap.ts`
  as the one gap kernel (exact `disc` for circles; `exactShape=false` bounding rects out of the
  intra-footprint short tier), intra-footprint different-net overlap and null-net bridges are shorts,
  one free-pad drill / layer derivation (`freePadDrill`, `freePadCopperLayers`) consumed by records,
  DRC, pour, Gerber (NPTH `hole` pad flashes no copper, keeps mask relief), Excellon, snapshot, canvas,
  `RULE_CLASS_BY_CODE` + `EMIT_SITE_BY_CODE` compiler-total with a corpus census gate
  (`golden-census-2l`; every code but `ZONE_FILL_FAILED`), cutout milling advisories with material
  outside the ring (winding from the flattened contour), signed `COPPER_TO_BOARD_EDGE.measuredMm`,
  `TRACE_LAYER_MISMATCH` non-overridable, all eight class ignores persist, creepage skip only without
  area rules and never inside a footprint, strictest IPC column, canonical trace order for length / SI
  sums. Stated limits: footprint NPTH pads read as copper (no plating attribute, S11); connectivity's
  circumscribed oval / roundrect rings can fabricate contact (S1/S2 limit, S11); slot width vs
  `drillMm` split (S11); mask policy for drilled `smd` / `conn` pads (S12); chained null-net bridges;
  Gerber pad rotation / ellipse (B6-1, S11). Goldens: `cutouts` +4, `pours` +2 (fixture artefacts:
  overlapping footprint pads), `census` new, all six regenerated in canonical key order. Gates at
  close: backend 2051 pass / 22 known library+assistant fails / 8 skip / 7 todo (2088); tsc 44; Vitest
  531 + 1 todo; gen + gen:contracts clean; e2e zones + board-shape + routing 13 + 1 flag-skip.
  Process: R1 (reviewer-critical) found a byte-identity hole, id collisions and a regression the
  session itself introduced — run it on every pair loop with reversal probes; an implementer's
  `git stash` around a tsc run briefly reverted the shared tree — forbid it in briefs; Astra run 1
  (≈ 40 min, 235 k tokens) 8 findings, 5 fixed, 2 contract corrections, 1 registered (B6-1).
## Appendix — Session 0 amendments to the original program text

The program above is the user's plan of 2026-09-06 with the following changes, each backed by the
evidence in `00-ground-truth.md`:

| # | Amendment | Evidence |
|---|---|---|
| A1 | Register evidence weaker than assumed: 7 of 19 `test.todo` bodies were placeholders. S0 wrote real specs for them. | ground-truth §1 |
| A2 | B2-9 closed (via gate already uses `below()`); B5-LIVE-PADGEOMS closed (mechanism gone; residual per-cursor-move rebuild noted for S8/S9); B2-5 narrowed to the manufacturability half; B5-LIVE-ROT-PAD spec rewritten (old body passed for the wrong reason). | ground-truth §1 |
| A3 | Stale invariant sources corrected (`designer/AGENTS.md`, hardening-skill references, OPEN_FINDINGS §6.3, `types.ts` comment). | ground-truth §2, §7 |
| A4 | S1's mandate includes unifying six independent connectivity models, not only the ratsnest. | ground-truth §4 |
| A5 | S6 must reconcile the three clearance-resolution copies (rule resolver, route obstacles, live DRC). | ground-truth §4 |
| A6 | S8 owns the route-commit server-gate decision. | ground-truth §3 |
| A7 | S1 runs before S2 but consumes only shared geometry kernels and lists them. | ground-truth §4 |
| A8 | S3 split into S3a (contract + data model + consumers) and S3b (authoring tools) — user chose to include authoring tools in the program. | ground-truth §3 |
| A9 | Session count is 20 (S0–S18 with S3a/S3b), not 16; `_to_delete/` and `electron/out/` excluded from greps; each Astra run needs user approval. | — |
