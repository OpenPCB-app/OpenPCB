# DESIGNER MODULE

**Purpose:** Schematic + PCB editor — ECS-based design world, command pattern, undo/redo,
projections, DRC.

Read the root `CLAUDE.md` first (layer rules, command-pattern flow, coordinate contract, SQLite
runtime). This file carries only what is specific to this module: the invariants that will cost you
a rewrite if you learn them late, and the anti-patterns they imply.

There is deliberately **no directory map here.** Trees rot faster than any other kind of
documentation, and the previous one was wrong within a release. Use the table below and read the
code.

## WHERE TO LOOK

| Task                        | Location                              |
| --------------------------- | ------------------------------------- |
| Add a command handler       | `backend/command-executor.ts`         |
| Add an HTTP route           | `backend/routes.ts`                   |
| Change schema               | `backend/schema.ts` + a new migration |
| Net derivation              | `backend/projection-world.ts`         |
| PCB entity CRUD             | `backend/pcb/pcb-store.ts`            |
| PCB read-only snapshot      | `backend/pcb/pcb-projection.ts`       |
| Trace geometry validation   | `backend/pcb/pcb-trace-geometry.ts`   |
| Ratsnest (MST net segments) | `backend/pcb/ratsnest.ts`             |
| DRC engine + checks         | `src/shared/drc/`, `src/shared/drc/checks/` (S8 relocation; `backend/drc/` is re-export shims) |
| Undo / redo                 | `backend/history-*.ts`                |
| Dataset capture             | `backend/capture/`                    |
| Schematic canvas            | `frontend/components/SchematicCanvas.tsx` |
| PCB canvas                  | `frontend/pcb/PcbCanvas.tsx`          |
| Auto Layout (dialog, run state, preview) | `frontend/pcb/autolayout/` |
| Auto Layout backend (client, apply, routes) | `backend/autolayout/` |

## KEY ABSTRACTIONS

- **CommandEnvelope** — `{ commandId, sessionId, aggregateId, baseRevision, issuedAt, command }`.
- **DesignerStore** — design CRUD, command dispatch, history.
- **Projection** — read-only `DesignerSchematicProjection` / `DesignerPcbProjection`.
- **ECS world** — schematic parts, wires and labels as entities + components; patches drive undo.
- **Revision-based OCC** — `baseRevision` on the envelope; `REVISION_CONFLICT` on mismatch.
- Command log provides idempotency: a duplicate `commandId` is rejected.

## IDENTITY — read this before persisting anything

**Net ids are ephemeral and must never be persisted against.** `deriveNetsAndJunctions` in
`projection-world.ts` builds nets with a union-find over coordinate-keyed nodes; `net.id` is
whichever node won the merge. It therefore depends on geometry and merge order, and it **changes**
when a component moves, a pin moves, or a wire is added. Nets are not persisted at all — there is
no `designer_nets` table, and `netNames` is rebuilt on every projection.

Consequences, in the order you will hit them:

- **Key persisted constraints on the stable pad address `` `${placement.id}|${pad.number}` ``** (or
  on the pin id `` `${partId}:${originPinKey}` ``), then resolve to the live `net.id` at projection
  time through `padNets`. Never store a `net.id`.
- **The upper-cased net NAME is the durable cross-edit identifier — and only for named nets.** This
  is why persisted traces and vias re-bind by name (`bindNetName`) after a schematic→PCB re-sync.
  Unnamed nets get regenerated `Net_<n>` labels and carry no identity across edits.
- `placement.id` is a `crypto.randomUUID()` minted once and matched on re-sync by `partId`. It is
  **stable across re-annotation and re-sync** and dies only with its schematic part.
- `pad.number` is library-defined and refdes-independent. The correlation convention is that the
  symbol's `pin.number` equals the footprint's `pad.number` on the same placement.
- Re-annotating a refdes updates only the `reference` column, keyed by an unchanged `partId`. Pin
  ids and geometry are untouched, so `net.id` does not change — but the net **name** can, if a label
  or rail was renamed.

Net-id instability is the single biggest constraint on relational features (constraint groups,
decoupling/crystal groups, diff pairs). Plan for it up front; it is a design constraint, not a bug.

## BOARD SETTINGS — the cheap extension surface

Board settings is **one row, one JSON blob**: `kind: "board_settings"` in the single
`designer_pcb_entities` table, holding the whole `PcbBoardSettings` stringified. Design rules, net
classes, `perNetClassAssignments`, `layerCount`, board thickness and `viewState` (including
`autoLayoutConfig`) all live inside it.

⇒ **Additive fields need no migration.** That makes stackup records, per-net policy fields for new
DRC checks, and constraint groups cheap to persist. It does **not** make them free: each still needs
a command field, a parse-with-default branch in the board-settings parser, and a dialog section.
And a command field with no parser in `routes.ts` is silently dropped over HTTP.

## DRC

- **Defect register and program.** `docs/drc/OPEN_FINDINGS.md` is the live defect register (one
  `test.todo` per open finding in `src/core/backend/tests/drc-audit-b*.test.ts`);
  `docs/pcb-hardening/PROGRAM.md` is the hardening-program tracker and
  `docs/pcb-hardening/00-ground-truth.md` the verified current-master inventory. Read the register
  entry for a check before touching it — several traps look deliberate (a comment, a passing test).
- **Net-class enforcement is partial.** `clearanceMm` resolves through the clearance path for
  every net. `traceWidthMm`, `viaDiameterMm` and `viaDrillMm` are enforced by `checks/netclass.ts`
  (`NETCLASS_*`, severity warning) **only for nets deliberately classed — an explicit
  `perNetClassAssignments` entry or a GND/POWER name match**; nets that fall to the default class
  (`defaultNetClassId` = the first class in the stored array — the order is semantic) get no
  width/via check. `defaultViaProtection` and `color` feed route-tool defaults only. The
  `netClassId` stored on a trace or via is a creation-time hint; no legality consumer reads it.
- **One rule resolver** (`src/shared/drc/rule-resolver.ts` `createRuleResolver`, contract
  `docs/pcb-hardening/05-rule-semantics-contract.md`): explicit scoped `PcbDrcRule`s
  (priority-descending first match, **may relax** above the floor; `net`/`netClass` match on
  either item, `area` needs both evaluation points in the same polygon, pour pair kinds only
  through an explicit `pairKind` scope) → implicit `max(designRule[pairKind], netA, netB)` → the
  `minimums.clearanceMm` floor; scalar kinds (`trackWidth`, `viaDiameter`, `viaDrill`,
  `annularRing`, `holeToHole`, `edgeClearance`) resolve the same way with the board minimum as
  their floor and ARE enforced. Batch DRC, the live route gate, route obstacles, the pour
  composition and the via insert gate all consume it — there is no other clearance formula. Area
  scopes are evaluated on regions of constant membership (segments split at the area rings), never
  at a representative point. Severity: `override → matched rule → DEFAULT_SEVERITY_BY_CODE`;
  drafts carry no severity literal. Invalid / partially ineffective rules are reported
  (`DRC_RULE_INVALID` non-overridable, `DRC_RULE_INEFFECTIVE`). Clearance comparisons use
  `clearanceViolated` (0.5 nm float grace).
- **Dispatch is a hardcoded array, not a registry.** `runDrc` is one monolithic function: it builds
  one `DrcContext`, runs seventeen pure `(ctx: DrcContext) => DrcViolationDraft[]` checks into a flat
  list, then applies class, severity, ignores, waivers and ids in a single pass and sorts the report
  by `(code, id)` (S7, `docs/pcb-hardening/06-batch-drc-contract.md` §6 — input order never changes
  the report). Adding a check is a new
  file under `drc/checks/` plus one array entry. The real cost is always the **rules-input
  schema**: a new rule has no home on `PcbDesignRules` / `PcbNetClass` until you add one, wire the
  corresponding command field, and add a dialog section. `DrcContext` carries traces, pads, vias
  and holes only — pours and zones are read from the projection inside the checks that need them.
- **Holes come from the drilled objects, never from the copper records (S11,
  `docs/pcb-hardening/10-manufacturability-contract.md`).** `footprintPadDrill(pad, placement)` /
  `freePadDrill(pad)` / `drillSlotCenterline` (`src/shared/rendering/pcb/pcb-drills.ts`) are the ONE
  derivation per object — position (drill offset applied), tool (the slot width for a slot), plating —
  read by DRC, the live gate, route obstacles, the pour's NPTH halo, Excellon, the snapshot and
  `collectDrills`. A footprint pad's `plated?` / `drillSlotMm?` / `drillOffsetMm?` are read ONLY through
  `padDrillFields` (the pinned `@openpcb/rendering-core` does not declare them yet; absent = plated,
  and an undrilled pad is always plated). The annular ring is `pad-annular.ts`'s exact signed-distance
  kernel (`DrcHole.annularRingMm`; breakout `≤ GEOM_EPS_MM` is judged before any minimum); a
  `circle` pad is a disc of `widthMm` everywhere. An unplated pad's copper ring is mechanical:
  per-layer null-net kernel items (a net bound to it = permanent airwire + `NPTH_PAD_NET`), no pour
  membership. `VIA_TYPE_UNSUPPORTED` fires for every non-through via on every fabricator (the export
  writes one through-drill file and REFUSES such boards with a 422); `VIA_ASPECT_RATIO` is
  `boardThicknessMm / drillMm` for through vias only. Fab rows in `fab-presets.ts` are sourced with
  fetch dates — never add a number without its source.
- **Candidate discovery is indexed; the exhaustive enumeration is the oracle (S9,
  `docs/pcb-hardening/08-broad-phase-contract.md`).** `buildDrcItems` builds a per-kind uniform
  grid (`broad-phase.ts`: `near` / `nearPolyline`, trace entries filed per sub-segment) and a
  boundary-edge index on the board region (`pcb-geometry/region-index.ts`); the clearance,
  copper-to-hole, hole-pair, board-edge, keepout and creepage checks enumerate their candidates
  through them under halos that bound every resolvable requirement. `DrcOptions.broadPhase:
  "grid" | "exhaustive"` (default `grid`; tests and `scripts/drc-bench.ts` only) selects the pre-S9
  loops, kept verbatim: both modes produce identical pre-finalise drafts and byte-identical
  reports (`drc-broad-phase-oracle.test.ts`). A new check that enumerates pairs must take its
  candidates from the context's index and prove the halo, or run unindexed and say so.
- **Batch DRC runs on a worker thread** (S10, `docs/pcb-hardening/09-execution-contract.md`).
  `POST /designs/:id/drc/runs` starts or joins a run owned by `backend/drc/run-service.ts`
  (in-memory registry: queued → running → completed | cancelled | failed; one run per design,
  same `(revision, options)` joins, a different one supersedes; FIFO across designs). The engine
  executes on ONE persistent `node:worker_threads` worker (`src/shared/drc/worker/`); the report
  is byte-identical to the in-thread `runDrc`; persistence is a single main-thread upsert after
  completion — never partial, never on cancel; cancel is a shared flag read at stage / pour-zone
  boundaries with `terminate()` as the fallback. `DrcOptions.tick` is the only engine seam —
  results-neutral like `stats`; never put cancellation or progress inside a check body. Every
  batch caller (route, SDK, cloud apply, MCP) goes through `runAndWait`; do not call `runDrc`
  inline in module code.
  As of S3a it also carries `copperZones` (the effective `collectCopperZones` list) and `keepouts`;
  since S4 also `copperAreaWarnings` (the derivation's own warnings — `ZONE_INVALID` /
  `ZONE_EMPTY_FILL` are a total mapping of them, never a re-derivation) and a lazily cached
  `placementExtent(id)` (courtyard hull, else the transformed pads+graphics bounds, else the pad
  bbox — `pcb/placement-extent.ts`, a declared superset). Checks must read those, never
  `projection.zones` / `projection.keepouts`. `DrcOptions.lookupRawFootprint` (built by
  `pcb/raw-footprint-lookup.ts` in the `/drc/run` route and the SDK) recovers KiCad-imported
  courtyards; it is not persisted with the options. Since S5 the context also owns
  `pourResults()` — ONE `buildCopperFillIslands` per effective zone (net-less included), fed the
  context's own copper records; the connectivity graph's pour nodes and `checks/copper-pour.ts`
  (`ISOLATED_COPPER_ISLAND` = the island's S1 component has no pad, `ZONE_FILL_FAILED` for a
  failed fill) both read it, so the DRC never runs the fill twice and never disagrees with itself
  (`docs/pcb-hardening/04-copper-pour-contract.md` §9–§10).
  Since S12 (`docs/pcb-hardening/11-dfm-contract.md`) the context also owns the DFM inputs:
  `silkArtwork()` and `maskIndex(face)` — built by `src/shared/rendering/pcb/artwork/`
  (`buildSilkArtwork`, `buildMaskOpenings`), the SAME model the Gerber writer emits, so a silk or
  mask verdict is about the artwork the fab receives — and `placementCourtyard(id)` (per-side
  courtyard regions from `pcb-geometry/courtyard-rings.ts`: chained edges, depth-oriented NonZero
  union, `malformed` ⇒ the superset hull + `COURTYARD_INVALID`, `dfm.courtyardFallbackMm`
  box). Never rebuild a stroke, an opening or a courtyard inside a check. The copper-shape check
  (`checks/copper-shape.ts`) is batch-only (`DRC_STAGES` is not the live path), judges the
  per-(layer, net) union of pads + traces + vias + pour islands by EROSION cores and bisection
  (contract 11 §5), ticks `copperShapeUnit` per unit and per erosion (a per-item stage label like
  `pour` — the run service and the stage tests filter it by name), and never passes silently:
  over-budget or kernel failure is `COPPER_SHAPE_UNCHECKED`.
- **`DrcRuleClass` has eight values:** `clearance | constraint | connectivity | manufacturability |
  structural | dfm | electrical | signal-integrity`. There is **no `copper-pour` class** — pour
  islands report under `structural`. Do not add a value without checking every consumer that
  switches on the union.
- Violation ids (v2) hash the code, the **sorted** anchor keys, the layer, and a 0.1 mm location
  bucket for pairwise codes — order-independent by construction, which is what makes waivers
  survive re-runs. `measuredMm` is never hashed.
- **Connectivity has one model: `src/shared/pcb-connectivity/`.** Records (one geometry
  resolution per pad / free pad / trace / via) → fail-safe items → copper-overlap touch predicates
  → union-find graph with end-cap and via-layer contact records. Contract:
  `docs/pcb-hardening/01-connectivity-contract.md`. `pcb/ratsnest.ts` is an MST over kernel
  components (`pcb/board-connectivity.ts` adds one node per filled pour island, members from the
  fill kernel); `checks/dangling.ts` is a lookup into the contact records; `checks/connectivity.ts`
  reads the ratsnest. There is no net-name rule anywhere — GND shows airwires until a GND pour
  exists. Two layer policies share the one geometry: connectivity is fail-safe (a layer-invalid
  pad or via occupies no layer), DRC short detection clamps such items to every layer; the DRC-side
  graph (`ctx.connectivity()`) is always built from the fail-safe items. The remaining private
  answers to "is this copper connected" — copper-fill island anchoring (S5), routed-length sums in
  `checks/length.ts` / `signal-integrity.ts` (S14) — are scheduled, not sanctioned (the
  routing-obstacle and live-DRC pad layers were closed in S8: both read the `LegalityContext`
  items). Never add another.
- **Electrical rules are constituents of the one rule model since S13 (`docs/pcb-hardening/13-electrical-contract.md`).**
  The IPC-2221B conductor spacing (edition B pinned, `ipc2221-spacing.ts` cites its sources) is a
  non-relaxable term of every resolved clearance (`rule-resolver.ts` → `voltage-term.ts`), so the
  pair judge (`CREEPAGE_DISTANCE`, its own row beside the ordinary row), the copper-pour halo, the
  route obstacles and the live gate (refuses) inherit it; voltages are DC potentials with optional
  `voltageMinV` / `voltageMaxV` intervals, Δ = max(|a.min − b.max|, |a.max − b.min|) at 1 µV;
  undeclared = reference potential (stated assumption); columns B1 inner, B2 outer, B4 only when
  `electrical.outerConductors: "coated"` AND neither item is mask-exposed on that face
  (`mask-exposure.ts`). Unassigned copper takes the tier net of its connected component
  (`pcb-connectivity/effective-nets.ts`, contact = the bridge model's `SHORT_EPS_MM`, pours
  excluded, inexact pads never join); chain shorts are reported; the live gate builds a per-call
  overlay (`effective-net-overlay.ts`) and rejudges existing items whose tier or exposure the
  pending copper moved. `TRACE_CURRENT_WIDTH` is a per-item form (`currentItems`, inner / outer
  copper weight, tier net). Malformed electrical input is a `DRC_RULE_INVALID` row, never assessed.
- **Curved copper and board arcs are exact since S12b (`docs/pcb-hardening/12-exact-geometry-contract.md`).**
  A pad record carries `rounded` — a convex core ⊕ disc (`pcb-geometry/rounded-shape.ts`; circle =
  point, oval = spine, roundrect = four inner corners, rect / trapezoid / custom = ring with r = 0)
  — and every pad gap (`pair-gap.ts`), touch (`touch.ts`: `padTouch`, `endCapTouches`,
  `viaTouchesOnLayer`) and keepout overlap is `convexDistance(coreA, coreB) − (rA + rB)`, exact;
  `disc` and `ring` stay for the pour, the copper-shape unit, the artwork and the broad phase. A
  contour arc's ONE curve is `canonicalContour` (start-radius circle, authored end point projected;
  DERIVED at read, never persisted — `normalizeContour` does not project); `exactContour` /
  `exact-arcs.ts` / `exact-simplicity.ts` are the exact kernel; the outline verdict
  (`checks/outline.ts`) AND the editor gate (`validateContour`) run the SAME simplicity predicate
  on the exact ring; board-edge verdicts (`checks/board.ts`, BOTH bodies) use the certified
  interval `R_inner ⊆ R_true ⊆ R_outer` (`BoardRegion.outerBias` / `exact` / `boundMm`) and
  recompute exactly only when the interval straddles the verdict — never spread or clone a
  `BoardRegion` (its exact fields are lazy getters); the budget note is `OUTLINE_WEB_UNCHECKED`
  and `outlineInvalid` counts ONLY `BOARD_OUTLINE_INVALID`. Board-material webs are
  `OUTLINE_MIN_WEB` (`outline.minWebMm`, erosion via `material-web-kernel.ts`). The Gerber
  Profile emits true arcs (`export/gerber/arcs.ts`: one quantised centre, integer I/J, ≤ 90°
  pieces). Ellipse outlines stay chords everywhere. Polygon pads (trapezoid / custom) are S12c.
- **Board geometry has one region: `src/shared/pcb-geometry/board-region.ts`.** `buildBoardRegion`
  flattens the outline and cutouts once per `runDrc` into a closed set (`ctx.boardRegion`); the
  legality build biases every arc toward the board side so the polygon is a subset of the true
  board (≤ 0.01 mm). Off-board, hole-to-edge and outline validity (cutout-in-outline, cutout
  separation) and edge clearance ask that region; only self-intersection asks its unbiased rings. Contract: `docs/pcb-hardening/02-geometry-contract.md`. No
  check samples points or tests vertices only — use `stadiumInsideRegion` / `discInsideRegion` /
  `polygonInsideRegion`. Touching or tangent cutouts and a cutout touching the edge are invalid.
  Zone and keepout rings share the same validity kernels as the outline (`zoneRingValidity`, S3a).
- **Apply-time re-validation is a non-blocking backstop, not a gate.** Both cloud apply handlers run
  the same `runDrc` and report the result, but they do **not** reject a bad envelope and do **not**
  persist the report (unlike the interactive DRC run). Partial apply therefore carries no overlap
  guarantee. If cloud results must be DRC-clean on apply, that enforcement does not exist yet.

## FOOTPRINTS AND COURTYARDS — bifurcated by provenance

Courtyard availability depends on **how the footprint entered the library**:

- **KiCad import whitelists SilkS + Fab only.** `F.CrtYd` / `B.CrtYd` are dropped from the preview
  **before persistence**, so a KiCad-imported placement has no courtyard geometry. The Fab outline
  survives and is the only in-projection fallback.
- **The generated / drawn path does not filter.** IPC-7351B preset and drawn-editor footprints call
  the render-model builder with no options, so **all layers survive, including CrtYd**.
- The full all-layer parsed footprint does survive for KiCad parts, in
  `library_footprints.data_json.raw` — but **no placement path reads it.** It is inert for snapshot
  enrichment without an explicit library re-query.

Price courtyard work per provenance. A mapper change covers generated parts; KiCad parts need either
an import-whitelist change or a library re-query.

## PCB CAPABILITY BOUNDARIES

- **Multilayer is import-only.** `PcbLayerCount` is `2 | 4 | … | 32` and the engine, stackup
  validation and the 2/4-layer Gerber path follow it, but the **sole writer of `layerCount > 2` is
  the KiCad project importer** — no UI and no command sets it. The board panel renders a static
  `2-layer` pill that is not bound to `board.layerCount`. Multilayer testing uses an inline
  `layerCount` on a fixture projection; a `layerCount` control is a prerequisite for native
  multilayer work.
- **Zones and keepouts are authored data** (persisted kinds `zone` / `keepout`, read-time v1
  upgrade in `src/shared/pcb-areas/zone-parse.ts`; commands `pcb_add/update/delete_zone` and
  `pcb_add/update/delete_keepout` with `routes.ts` parsers and undo arms; zone / keepout tool
  modes, canvas selection, vertex editing and an inspector — S3b). **The per-layer copper fill is
  a persisted board-zone row** (`region.kind === "board"`, id `board:<layer>`), not view state:
  `PcbViewState` has no `copperFill*` fields any more, a legacy row migrates lazily through
  `migrateLegacyBoardFill` (`pcb-store.ts`) before any settings write, and the ONE effective list
  is `collectCopperZones` (`src/shared/pcb-areas/copper-zones.ts`) — never assemble pours from
  `projection.zones` yourself. Zone / keepout rows have a uuid row id with the entity id in the
  payload (`designer_pcb_entities.id` is a global primary key); resolve rows by payload id. Ring
  validity is the shared `zoneRingValidity`, in the executor and in the tools — never a tool-local
  rule. **Legality (S4):** `checks/keepouts.ts` emits `KEEPOUT_VIOLATION` through
  `keepoutAffects` for traces, vias, pads and placements; `checks/zones.ts` emits `ZONE_OVERLAP`
  (same layer, equal priority, different nets, positive-area overlap), `ZONE_INVALID`
  (non-overridable, non-waivable — a dropped keepout is fail-open) and `ZONE_EMPTY_FILL`;
  `checks/copper-pour.ts` adds `ZONE_EMPTY_FILL` for an effective zone with no island.
  `pourParamsForZone(zone, rules, keepouts, zones, nets)` (S5: the effective zone list drives
  the §3.3 precedence exclusions, `nets = zonePourNets(board, netNames)` the per-obstacle
  net-class clearance), `boardPourSpecs(zones, rules, keepouts, …)` and
  `collectCopperZones({ zones, layerCount, knownNetIds })` have NO defaults — a fill consumer that
  omits the keepouts, the zone list, the net tier or the known net ids does not compile, which is
  what keeps Gerber, snapshot, DRC, cleanup, ratsnest, canvas and 3D on the same copper. The
  kernel itself is specified by `docs/pcb-hardening/04-copper-pour-contract.md` (S5): S1 records
  as the one copper geometry, the S2 region as the extent, `buildCopperFillIslands` →
  `{ status: "ok" | "failed", islands }` with islands in the total order. Routing: `tracks` keepouts are AABB
  superset obstacles (`route-obstacles.ts`, built from the `LegalityContext` items), and the live
  gate, the smart-via guard, the tune guard and the SERVER commit gate all run
  `checkPendingCopper` (`src/shared/drc/legality.ts`) — the batch pair kernel over the pending
  copper, `KEEPOUT_VIOLATION` in its refuse set (`docs/pcb-hardening/07-live-parity-contract.md`).
  `placementSideLayer` (`shared/rendering/pad-copper-layers.ts`) is
  the one side resolution. Contract: `docs/pcb-hardening/03-zone-keepout-contract.md` (§12
  authoring, §13 legality).

## AUTO-LAYOUT INTEGRATION

- **Three workflows, not one.** *Auto Layout* is one composite cloud job (`/v1/layout`) that
  returns complete candidates; *Route Board* (`/v1/route`) routes the board as placed; *Auto Place*
  (`/v1/place`) optimizes placement only. The old desktop-sequenced place→apply→route flow is gone
  — it committed the placement before routing began, so a failure left a half-laid-out board.
- **Apply semantics differ by workflow, deliberately.** A layout candidate applies ATOMICALLY
  (`pcb_apply_autolayout_candidate`: plan everything, write nothing until all of it validates, one
  revision, one undo). Route Board stays per-op cherry-pick; Auto Place stays an all-or-nothing
  diff over its interactive ghost.
- **Never validate through the mutating placement helpers.** `movePcbPlacement` / `rotate` / `flip`
  upsert on call, and executor branches return error RESULTS rather than throwing — so validating
  by calling them commits earlier writes when a later op fails. The pure planner
  (`backend/pcb/autolayout-candidate-plan.ts`) exists for exactly this reason.
- **Staleness is a content digest, not the revision.** `pcb_set_view_state` bumps the revision, so
  revision equality would invalidate a candidate on a pan or a layer toggle. See
  `backend/pcb/board-content-digest.ts` — and add new persisted board data to its projection.
- **The renderer never sends candidate operations.** Apply carries `{jobId, candidateId,
  snapshotDigest, applyRequestId}`; the backend re-fetches the candidate from the service.
- **Transport types are GENERATED** from the service's emitted schemas
  (`src/sdks/designer/cloud-autolayout`); `autoroute.ts` / `autoplace.ts` are aliases. Do not
  hand-write a cloud shape — that is what produced the six-gap drift this replaced.
- **Capabilities are negotiated as booleans.** Read `/v1/version` `engines.*.features`; never
  compare engine version strings.

## HEADLESS PATHS

A headless, app-free snapshot path already exists: `scripts/board-snapshot-parity-harness.ts` is a
standalone Bun CLI that builds synthetic projections **entirely in memory** — no DB, no app — calls
the real snapshot builder, and prints JSON to stdout. A sibling `scripts/drc-parity-harness.ts` does
the same for DRC. **Neither has a `package.json` alias — run them directly.** Use them for
cross-repo parity checks instead of standing up a runtime.

## DATASET CAPTURE (WP-D4, `backend/capture/`)

- Gated by the `dataset.capture` feature flag: default OFF in dev/test, ON in packaged builds,
  override with `OPENPCB_FEATURE_DATASET_CAPTURE`. When off, every hook is a no-op.
- One `CaptureRuntime` singleton (`resolveCaptureRuntime`) — **two `DesignerStore` instances exist**
  (one from the SDK entry, one from routes); registry state lives in SQLite for the same reason.
- Session log: per (process, design) session, JSONL segments under
  `OPENPCB_CAPTURE_DIR ?? <db-dir>/capture`, zstd on rotation, 200 MB/session cap →
  `capture_truncated` marker then stop. **Never drop-oldest** — `seq` continuity matters. Appends
  are buffered and flushed on a 250 ms timer, so a hard crash may lose the tail (acceptable for
  telemetry).
- **There is no `CommandBatch` type.** Entries are per-envelope; apply loops share a `groupId`.
  Actor attribution is the optional `capture` parameter on `dispatchCommand` — the envelope has no
  actor field, and AI shares the UI session id. Import bypasses dispatch entirely and has its own
  hook.
- `AutoCopperRegistry`: geometry ids come from history forward/inverse patches, **not**
  `createdEntityId` — `pcb_add_trace_via` drops the trace id. Undoing a creating command marks
  `undone`; redo restores it (ids are stable across undo→redo). Touches are per-command and are
  removed and re-added by history replay — **never reconstructed by diffing**.
- `PerNetOutcome` at export is `accepted | modified | ripped | rerouted`, derived from the registry
  plus live-projection copper against the ids that pre-existed at apply. It is **export-time
  analytics, not apply-time cherry-pick**.
- Upload queue mirrors the comment-outbox pattern; endpoint and token come from
  `OPENPCB_DATASET_INGEST_URL` / `OPENPCB_DATASET_INGEST_TOKEN`; delivery is at-least-once with ULID
  idempotency. Milestone snapshot hashes are **local dedup only** — canonical board identity is
  computed at ingest, never here.

## NOTES

- Depends on `library`; resolves symbols and footprints through `LibrarySDK`, never by importing the
  module.
- The PCB tab renders in dark mode regardless of app theme (single token set).
- Trace modes: `manhattan-90` | `manhattan-45`. Copper layers on a 2-layer board: `F.Cu` | `B.Cu`.
- Via types are `through | blind | buried | micro` (`PcbViaType`) with span topology enforced by
  `VIA_LAYER_SPAN`; non-through spans are accepted only behind the `pcb.advancedVias` dev flag, so
  release builds create through vias only.

## ANTI-PATTERNS

- Do **NOT** persist anything keyed on `net.id`. Use `` `${placement.id}|${pad.number}` `` or the
  upper-cased net name.
- Do **NOT** assume a `PcbNetClass` width or via field is enforced for a net that fell to the
  array-order default class — `NETCLASS_*` checks cover explicitly assigned or name-matched nets
  only; `clearanceMm` covers all.
- Do **NOT** treat apply-time DRC as a gate. It reports; it does not reject.
- Do **NOT** add a `DrcRuleClass` value without auditing every consumer of the eight-value union.
- Do **NOT** add a command field without adding its parser in `routes.ts` — unparsed fields are
  silently dropped over HTTP, with no error.
- Do **NOT** add a designer command without extending the `DesignerCommand` union in
  `src/sdks/designer/types.ts`.
- Do **NOT** import `core/backend/*` or `core/frontend/*` from here, and do not put business logic
  in `core/`.
- Do **NOT** invent manufacturing constants — use `/eda-standards`.
- Do **NOT** cite `file.ts:line` in this file. Line anchors are what made the previous state report
  unmaintainable within weeks. Name the subsystem and the symbol; let the reader grep.
- The schematic canvas is already oversized — split interactions into hooks rather than growing it.
