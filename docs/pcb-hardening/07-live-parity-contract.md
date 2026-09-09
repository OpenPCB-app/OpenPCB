# 07 — Live DRC and route-legality parity contract (Session 8)

Status: **S8 in progress (2026-09-09)** — contract written before implementation; Astra
spec-attack and adversarial-verify ledgers in §11; gates at close in `PROGRAM.md`.

This contract states how interactive legality — the route tool's live check, its commit gate, the
smart-via and tune guards, the router's obstacle model and the server-side commit gate — relates
to batch DRC, the reference implementation of `06-batch-drc-contract.md`. The one-line version:
**live legality is the batch pair kernel run on a per-revision context with the pending copper as
the subject set.** Not a second implementation that agrees by discipline; the same functions, so
the measurement live reports is the measurement batch reports, to the bit.

## 0. Scope

In scope: `src/shared/drc/` (the relocated engine, `legality.ts`, `fab-presets.ts`,
`diff-pair-resolver.ts`), `src/shared/pcb-connectivity/{board-connectivity,ratsnest}.ts`,
`src/shared/pcb-geometry/{placement-extent,courtyard}.ts`, `src/shared/pcb-routing/route-obstacles.ts`,
`src/modules/designer/frontend/pcb/drc/live-drc.ts`, the route / bundle / tune / smart-via paths in
`PcbCanvas.tsx` and `usePcbWorkspace.ts`, `command-executor.ts` (the five gated commands),
`store.ts` (`dispatchCommand`), `routes.ts` (the command parsers and the cloud apply loops).

Out of scope, with the owning session: routing algorithms, walkaround, auto-finish, pull-tight,
board-edge / cutout obstacles (S16), tune / bundle / diff-pair geometry (S17), the batch broad
phase (S9), async execution / B5-SYNC (S10), slot / annular / plating models (S11), DFM (S12),
electrical (S13), SI / length (S14), part-move / free-pad legality (none scheduled — batch reports).

## 1. The parity statement

Let `P` be a PCB projection, `T` a set of pending copper (traces and vias about to be committed),
`R` the ids of board items `T` replaces (empty for a new route; the edited trace for a tune),
`P' = P \ R`, `L` the live code set of §3, and:

- `R⁺ = runDrc(P' ⊎ T, opts)`, `R⁻ = runDrc(P', opts)` — batch on the board after and before the
  commit, with the same suppressions;
- `touch(v)` — some anchor of `v` names an item of `T`, **or** `v` is a null-net bridge
  (`NET_SHORT_CIRCUIT` on an unassigned item) whose set of bridged nets changed because of `T`.

Then `checkPendingCopper(items(P'), T, opts)` satisfies:

1. **Attribution (equality).** `checkPendingCopper(items(P'), T) = { v ∈ R⁺ | v.code ∈ L ∧ touch(v) }`,
   compared on `(id, code, layer, severity, measuredMm, requiredMm, message)` — `measuredMm` and
   `requiredMm` with `===`, not a tolerance (the exit gate's `≤ 1e-9` budget is unused); `message`
   because it is the only carrier of *which rule* set the requirement (`ruleSuffix`), which the
   "required rule" clause of the exit gate needs.
2. **Non-perturbation.** `{ v ∈ R⁺ | v.code ∈ L ∧ ¬touch(v) } = { v ∈ R⁻ | v.code ∈ L } \ replaced(T)`,
   where `replaced(T)` is the set of `R⁻` bridges on a null-net anchor whose net set differs in
   `R⁺` — committing `T` adds verdicts about `T` and REPLACES the bridge verdicts it grows (a
   bridge over nets {A, B} becomes one over {A, B, C}: the old id leaves, the new id arrives and
   is attributed by clause 1; Astra run 1 #1); it changes nothing else. One further declared
   exception: a pre-existing bridge on a multi-shape pad whose marker moves when `T` touches an
   earlier-sorting shape of the same pin (`markerBefore`) — compared without the location bucket.
3. **Declared exceptions.** Outside `L` nothing is promised (`DRC_RULE_INEFFECTIVE` can change
   because `knownNetIds` grows with `T`; `UNCONNECTED_NET`, `TRACK_DANGLING`, `VIA_DANGLING`,
   `ISOLATED_COPPER_ISLAND` and the zone codes move with every route). Chains through two
   null-net items are the batch limit of 06 §9. On an exact geometric tie the closest-point
   marker — and with it a location-hashed id — can follow the pending item's id order; code,
   layer, severity and measurement never do.

Ids: a violation's id hashes the anchors' ids. They are equal on both sides only where the pending
id *is* the committed id — the server gate (built items carry their assigned uuid), replacements
(the existing id) and the harness (which assigns the id). The client's pending items carry
`pending:<n>` ids and are compared through the bijection `pending:<n> ↔ assigned id`; the client
never expects a live id to match a batch id, a waiver or a marker.

## 2. The shared core

- **Layout (D1).** The engine lives in `src/shared/drc/` (`drc-engine.ts`, `drc-context.ts`,
  `pair-gap.ts`, `checks/*`, `severity.ts`, `violation-id.ts`, `code-registry.ts`, `types.ts`,
  `rule-message.ts`, `zone-label.ts`, `ipc2221-spacing.ts`, `legality.ts`, `fab-presets.ts`,
  `diff-pair-resolver.ts`), its connectivity adapters in `src/shared/pcb-connectivity/`
  (`board-connectivity.ts`, `ratsnest.ts` — **not** exported from that barrel: `board-connectivity`
  pulls the fill kernel and with it `clipper2-ts`; import by path) and the placement extent in
  `src/shared/pcb-geometry/` (`placement-extent.ts`, `courtyard.ts`). Every former
  `src/modules/designer/backend/{drc,pcb}/…` path is a one-line re-export shim; no new importer
  of a shim path is accepted (grep census). Nothing in the closure imports `bun:`, `node:` or the
  database.
- **Item builder split (D2).** `buildDrcItems(input)` is the eager physical model: copper
  records → `DrcTrace[]` / `DrcPad[]` / `DrcViaGeom[]` / `DrcHole[]` under the clamp policy,
  `boardRegion`, effective zones / keepouts / warnings, the resolver, valid layers, net names,
  fab, plus a dependency-free uniform-grid broad phase `near(kind, bounds)` / `nearPolyline` (S9:
  per-sub-segment trace entries, contract 08 §2.1) over the four item
  arrays. `LegalityContext = ReturnType<typeof buildDrcItems>`; `buildDrcContext` adds the lazy
  layer (`copperItems`, `connectivity`, `pourResults`, `placementExtent`) and `DrcContext extends
  LegalityContext`. `input` is either a projection or the row form the dispatcher already holds
  (§6), assembled by the pure `assemblePcbLegalityInput` extracted from the tail of
  `loadPcbProjection` (netName binding, `correlateNetPads` → `padNets`, zone binding; no pours).
- **Pair bodies shared, batch loops verbatim (D3).** `checks/clearance.ts` exposes a `PairJudge`
  (the per-pair bodies for the six pair kinds plus the `emit` / `recordBridge` / `bridges`
  closure). `checkClearance(ctx)` keeps its six loops unchanged and calls the bodies;
  `judgeCopperPairs(ctx, subjects, others, opts)` enumerates on its own, reproducing the eight
  pair filters exactly: `i<j` when `subjects ≡ others`; shared layers; `sameNet`; `farApart`;
  the intra-footprint `exactShape` skip; `shortTierOnly` inside a footprint; a hole's own-pad
  self-skip; coincident same-net drills. Batch is **not** redefined as a special case of the
  general form — both are defined by the shared bodies. The same shape for
  `copperToHolePairs(ctx, copper, holes)`, `boardItems(ctx, items)` + `holePairs(ctx, subjects,
  others)`, `keepoutItems(ctx, items)`, and the per-item scalars of `constraints`,
  `manufacturability` (without the outline milling advisories) and `netclass`. `splitCache` is
  keyed by object, not id.
- **`finalizeReport`.** Severity resolution, `NON_OVERRIDABLE`, class ignores, waivers, dedupe
  (`worseWitness`), the `(code, id)` sort and `countsByCode` are one function used by `runDrc`
  and `checkPendingCopper` alike.

## 3. The live code set `L`

| Group | Codes | Form |
|---|---|---|
| Copper pairs | `NET_SHORT_CIRCUIT`, `TRACE_TO_TRACE_CLEARANCE`, `TRACE_TO_PAD_CLEARANCE`, `TRACE_TO_VIA_CLEARANCE`, `VIA_TO_VIA_CLEARANCE`, `PAD_TO_PAD_CLEARANCE`, `PAD_TO_VIA_CLEARANCE`, `FAB_CLEARANCE` | `judgeCopperPairs` |
| Copper ↔ NPTH | `COPPER_TO_HOLE` | `copperToHolePairs` |
| Board | `COPPER_TO_BOARD_EDGE`, `COPPER_OFF_BOARD`, `HOLE_TO_BOARD_EDGE`, `HOLE_OFF_BOARD` | `boardItems` |
| Hole pairs | `HOLE_TO_HOLE`, `FAB_HOLE_TO_HOLE` | `holePairs` |
| Areas | `KEEPOUT_VIOLATION` | `keepoutItems` |
| Per item | `TRACE_LAYER_MISMATCH`, `VIA_LAYER_SPAN`, `TRACE_WIDTH_MIN`, `VIA_DIAMETER_MIN`, `VIA_DRILL_MIN`, `DRILL_SIZE_MIN`, `ANNULAR_RING_MIN`, `VIA_ASPECT_RATIO`, `FAB_TRACE_WIDTH`, `FAB_DRILL`, `FAB_ANNULAR_RING`, `FAB_PAD` (a via's pad diameter against the fab minimum), `NETCLASS_TRACE_WIDTH`, `NETCLASS_VIA_DIAMETER`, `NETCLASS_VIA_DRILL` | per-item scalars |

`L` is exported as `LIVE_CODES` from `legality.ts` (R2 #7). The one pad-only per-item code
(`PAD_LAYER_MISMATCH`) is in the forms but never fires for pending copper (a route commits no
pads); `PAD_TO_PAD_CLEARANCE` is likewise unreachable until a pad becomes a subject. Excluded, with owners: `CREEPAGE_DISTANCE`,
`TRACE_CURRENT_WIDTH` (S13); `DIFF_PAIR_*`, `NET_LENGTH_OUT_OF_RANGE` (S14); `TRACK_DANGLING`,
`VIA_DANGLING`, `UNCONNECTED_NET`, `ISOLATED_COPPER_ISLAND`, `ZONE_*`, `BOARD_OUTLINE_INVALID`,
`OUTLINE_*`, `PLACED_PART_MISSING_FOOTPRINT`, `DRC_RULE_*` (board-wide; routing legitimately
creates dangling ends and splits islands mid-session).

## 4. Pending-copper semantics

`checkPendingCopper(ctx, { traces: PendingTrace[], vias: PendingVia[] }, { replaces?: string[],
suppressions }) → DrcViolation[]`.

- **Items.** Pending items are built by `buildCopperRecords` on a synthetic input (the same
  builder, the same clamp mapping as the board's items), each carrying the id it has:
  `pending:<n>` on the client, the assigned uuid on the server, the existing id for a
  replacement. A `PendingVia` contributes a `DrcViaGeom` and a `via` `DrcHole`.
- **Pairs.** Pending × board and pending × pending are both judged. Two null-net runs of one
  session are a pair after commit; a bundle's lanes likewise; a via against its own run is a
  same-net pair and skips. `replaces` removes the named board items at enumeration — no context
  rebuild — so a tune is judged against the board without the trace it replaces.
- **Null-net bridges and touches.** When a pending item touches an unassigned board item, that
  item's other touches are completed against the board and the SAME `recordBridge` code runs over
  (board touches) ∪ (pending touches). "That item" is the LOGICAL anchor: every copper shape
  sharing the anchor key (a multi-shape pin) is completed, as batch aggregates them (Astra run 1
  #7). The completion of a board item is a function of the board alone, so the context memoises
  it per anchor key — one O(near) walk per touched item per revision, not per pointer move
  (Astra run 1 #9). A bridge whose net set grew because of `T` is attributed to `T` (§1 `touch`)
  and refused (§6) even though it carries no pending anchor — rerouting away from the unassigned
  copper fixes it. **Touching unassigned copper is one conductor** (S8 batch correction, 06 §4):
  two null-net items that touch (`gap ≤ SHORT_EPS_MM`) are not a clearance pair, and a null-net
  item touching ONE named item is an extension of that net — banked for the bridge pass, never a
  clearance or fab report. Null-net copper that is merely close (`0 < gap < required`) is still
  judged: it may be a different conductor.
- **Suppressions.** `finalizeReport` applies the board's severity overrides, class ignores and
  waivers exactly as the report does (§2). A waiver can match only a replacement's stable id;
  a class ignore removes that class from the live verdict as it removes it from the report — the
  gate follows the report, not the other way round (§6 records the consequence).
- **Order.** Pending items enter every pair in canonical anchor-key orientation like any other
  item; the output is sorted `(code, id)`.

## 5. Route obstacles

`buildRouteObstacles` reads the `LegalityContext` items — never the projection's placements:

- traces: one rect per segment; when an `area` rule can reach the segment it is split at the area
  rings (`splitSegmentAtRings`, the gate's own §4.4 split) and each sub-segment is resolved at its
  own midpoint, so a tightening that covers only one end of a segment inflates that end (Astra
  run 2 #2);
- pads: one rect per `DrcPad` whose `layers` include the routing layer, from `DrcPad.bounds`
  (exact rotated ring bounds; through-hole pads on every copper layer; free pads included);
  `placementSideLayer` is not consulted for pads and the former un-swapped union is gone;
- vias: on every layer of their span; NPTH holes (free holes, non-plated free-pad drills): the
  disc / slot stadium inflated by `copperToHoleClearanceMm`; keepouts: as before (§13.4 of 03);
- inflation = `max(clearance at the obstacle, clearance outside every area, SHORT_EPS_MM + 1 nm)`
  + both half widths, rounded **outward** to nanometres. "At the obstacle" is the S6 §9 resolution
  with both evaluation points on the obstacle; "outside every area" is the same pair resolved with
  both area masks 0 (`RuleResolver.clearanceOutsideAreas` — the masks-0 term `clearancePour`
  already uses: net-, class- and layer-scoped rules still apply, only `area` scopes are off) — an
  `area` relaxation around the obstacle must not shrink the rect below what the pair requires when
  the route itself is OUTSIDE the area (Astra run 1 #4), while a net-scoped relaxation, exact for
  the pair everywhere, still shrinks it; a tightening still applies whenever the obstacle is
  inside. The short tier is inclusive at
  `SHORT_EPS_MM`, so under a 0 mm rule boundary contact would be a short — the inflation floor of
  `SHORT_EPS_MM + 1 nm` keeps boundary contact above it (Astra run 1 #5). `fabMin` is not added:
  `FAB_CLEARANCE` is a warning and never refuses, so the router must not be stricter than the gate
  on its account.

**Convention (closes 02 §7 "one convention for live/batch parity").** An obstacle rect is a
superset of `item ⊕ required` (AABB corners and the outward nanometre are the only slack, both in
the safe direction). `segmentIntersectsRectNm` tests the open interior, so boundary contact is the
`gap ≥ required` case, which `clearanceViolated` passes. Therefore a path that avoids every rect
passes the gate's clearance, short, hole and keepout tiers on that layer; it may still fail the
edge / off-board tier (no edge obstacles until S16) and may be refused a path that exists (AABB
superset). This is a superset statement, not an equivalence.

## 6. The commit gate

**Rows, never the projection.** `store.dispatchCommand` already loads, before the executor runs,
the schematic projection and the PCB rows it snapshots for history (`board`, `placements`,
`traces`, `vias`, `freeHoles`, `freePads`, `zones`, `keepouts`). `ExecuteDesignerCommandParams`
carries them as `pcbBefore`; a gated command builds its `LegalityContext` lazily from those rows
through `assemblePcbLegalityInput`. `loadPcbProjection` is never called from the executor: it
migrates and syncs placements (writes), which would leak into a route commit's history patch.

**Gated commands.** `pcb_commit_route`, `pcb_add_trace`, `pcb_add_via`, `pcb_add_manual_via`,
`pcb_add_trace_via`, `pcb_update_trace_geometry` (`replaces: [traceId]`; the pending item is the
BOUND row — the same `netName` → `netId` binding the context's board side went through — so an
imported trace is never judged against its own net, R1 #1). There is NO truncation exemption: a vertex
subsequence is not a copper subset (dropping an interior vertex draws a new segment), and even a
genuine prefix / suffix cut can move a surviving violation's hotspot into a different location
bucket, past its waiver (Astra run 1 #2, #3) — every geometry update is judged. The gate runs on the
**built** items (assigned ids; a width the trace builder upgraded to the class default — a
declared live/server divergence the client sees as a refusal detail) after structural validation
and before any insert; `buildPcbViaForInsert` resolves its minimums through the context's
resolver (one compile per envelope). Not gated, recorded: `pcb_apply_autolayout_candidate`
(placements are written after the copper is built, so a gate here would judge the wrong board —
filed), part moves / rotations / flips, free pads / holes.

**`legality` (command field, parsed for the six commands).** `"refuse"` (default) — any
violation in the refuse set → `{ ok: false, code: "PCB_COPPER_ILLEGAL", violations, refusedCount,
detail }`, nothing persisted (`violations` is capped at the first 50 in canonical order and
`refusedCount` is the total — an unbounded refusal would be persisted verbatim in the command
log, R1 #2; the anchors name the ids the copper WOULD have carried, which never exist); `"report"` — the verdict is computed, never refuses; `"off"` — no context is
built. The ok result carries counts only (`legality: { refused: 0, warnings: n }`; `warnings`
counts every non-refused violation of `L`, waived ones included): the command log persists
results verbatim, and an idempotent replay returns the original revision's verdict — the replay
parser (`results.ts`) carries both the counts and a stored `PCB_COPPER_ILLEGAL` through, so a
retried refusal is answered with its verdict, not with a revision conflict. `detail` is one line:
`"<n> DRC violation(s): CODE (measured/required), …"` — the first three in canonical order.

**Refuse set (an allow-list, not "error severity").** `NET_SHORT_CIRCUIT`, the six
`*_CLEARANCE`, `COPPER_TO_HOLE`, `COPPER_TO_BOARD_EDGE`, `COPPER_OFF_BOARD`, `KEEPOUT_VIOLATION`,
`HOLE_OFF_BOARD`, `VIA_LAYER_SPAN`, `TRACE_LAYER_MISMATCH`, `TRACE_WIDTH_MIN` (symmetric with the
via minimum gate that already refuses `VIA_DIAMETER_MIN` / `VIA_DRILL_MIN` / `ANNULAR_RING_MIN`
before this contract). Membership is by CODE: a severity override that downgrades one of them to
a warning does not unblock it — only a suppression that removes it from the report does (a
per-code `ignore` override, a class ignore, or a waiver — R1 #4), so the gate follows the report
exactly. Everything else in `L` is
reported as a warning (so are overlapping drills of two vias — `HOLE_TO_HOLE` is a warning in
batch; S11 owns hole semantics). Waived ⇒ not refused. A
class ignore applies to the gate as to the report — a user who ignores the `clearance` class has
turned the hard block off for that class; the desktop HUD says so. Non-overridable codes always
refuse. When the outline is invalid (`BOARD_OUTLINE_INVALID` would fire on this board),
`COPPER_OFF_BOARD` and `COPPER_TO_BOARD_EDGE` are reported, not refused — rerouting cannot fix an
outline.

**Who sends what.** The desktop sends `refuse`, or `report` while its `allowDrcViolations`
toggle is on — the server flag mirrors the locked "DRC hard-block plus explain" decision, so a
refusal reaching the desktop means either a live/server disagreement (a parity bug, surfaced with
its codes) or a board that changed under the session (a concurrent assistant / MCP edit — the
case the server gate exists for). The cloud `/autoroute/apply` and `/autoplace/apply` loops send
`off`: cloud output is judged by the post-apply batch report (recorded boundary). Assistant / MCP
route batches use the default and receive the reference verdict in `detail`; surfacing it in the
proposal UI is filed for the assistant module.

**Untouched by construction.** Undo / redo apply ECS patches and never re-execute a command;
idempotent replays return the stored result; PCB commands are never cloud-mirrored; KiCad import
writes rows directly. The gate adds no write before its verdict: `ensurePcbBoardSettings` (which
may reset an unparsable settings row) already runs in the dispatcher before any `pcb_*` command,
gate or not.

## 7. Performance envelope

- One `LegalityContext` per projection object on the client (`usePcbWorkspace`, next to
  `effectiveKeepouts`), per envelope on the server. The client guarantee this rests on: the
  projection is an immutable snapshot replaced wholesale on every refresh — nothing mutates a
  projection's rules, copper or view state in place — so object identity IS revision identity
  (the same guarantee `projectionIndex` already relies on; Astra run 1 #8): `buildCopperRecords` + `buildBoardRegion` +
  `createRuleResolver` + `collectCopperZones` / `collectKeepouts` + the grid — O(board), once per
  revision, never per pointer move (closes the S0 residual).
- The gate is O(pending × near) with the grid broad phase, plus the memoised bridge completion
  (§4). Pathological inputs — a pending trace touching many overlapping unassigned items that each
  touch many named items, giant traces covering thousands of grid cells, thousands of keepouts —
  are bounded by geometry, not by the design (Astra run 1 #9; measured in §10). Since S9 the batch
  loops enumerate through the same grid (`08-broad-phase-contract.md` §4; the pre-S9 loops stay
  behind `broadPhase: "exhaustive"` as the oracle), trace entries are filed per sub-segment and a
  trace subject queries with its polyline (`nearPolyline`), and `judgeCopperPairs` honours the mode.
  Site A runs at most once per animation frame; throttling bounds frequency, not the cost of one
  frame.
- Recorded at close (§10): context build and gate time on `golden-census-2l` and on a synthetic
  5 000-item board; target gate < 2 ms per pointer move at 5 000 items.

## 8. Consumers

| Consumer | Calls | Subject set | Blocks on | Notes |
|---|---|---|---|---|
| Site A — route preview (`PcbCanvas.tsx`) | `runLiveDrc({ ctx, pending })` | session runs ∪ ghost, session vias | — (HUD count / colour) | ONE whole-session call per animation frame (rAF-throttled) — the same subject set site B judges, never two verdicts merged by id (Astra run 2 #7) |
| Site B — `finishRoute` | same | all runs + vias of the session | refuse set (unless override) | then `pcb_commit_route` with `legality` |
| Site C — `finishBundle` | same | every lane + vias | refuse set (no override) | lanes are pending × pending |
| Smart via | `checkPendingCopper` on the via | the via | refuse set | before `rebase-layer`; HUD notice, replaces the keepout-only guard |
| Tune | `checkPendingCopper` with `replaces` | the proposal | refuse set (unless override) | then `pcb_update_trace_geometry` |
| Server gate | `checkPendingCopper` on built items | the command's copper | refuse set (`legality: "refuse"`) | rows-built context |
| Route obstacles | context items | — | — | §5 superset |
| Assistant / MCP | default `legality` | the tool's copper | refuse set | verdict in `detail` |
| Cloud apply loops | `legality: "off"` | — | — | post-apply batch report |

## 9. Stated limits

- Part move / rotate / flip, free pad / hole edits and the `pads` / `footprints` keepout
  restrictions have no live or server gate; batch reports them.
- `L` excludes electrical, SI / length, dangling and every board-wide code (§3).
- Obstacles stay AABB heuristics; no board-edge / cutout obstacles (S16); the S6 §9 area-rule
  divergence stays.
- `pcb_apply_autolayout_candidate` is not gated (filed); the server rebuilds the context per
  envelope (memo per revision is S10).
- Client-minted ids are not adopted; live ids never match batch ids, waivers or markers (§1).
- The assistant's proposal apply does not yet show a refusal's detail (filed).
- Marker ties and the multi-shape-pad bridge marker (§1 exceptions).
- **Unassigned copper does not inherit the rule tier of the net it extends** (Astra run 2 #1,
  registered as B7-1, owner S13): a null-net trace touching net A's copper is judged against every
  other net with the null-net (default) requirement, not A's class or A's net-scoped rules — a
  false pass in batch and live alike (parity holds; the verdict is wrong in both). The fix needs a
  post-bridge pass that re-resolves the pairs of every null-net item touching exactly one net as
  that net, with the attribution consequences that follow.
- The trace width the server inserts can exceed the width the client checked (§6). The net
  CLASS is not a divergence: the session mapper and the server builders share
  `effectiveNetClassId` (a per-net assignment upgrades the default class the session offered), so
  the pending copper carries the class the server will store (R2 #3).
- Every corridor window (auto-finish `max(5, 1 + reach + width)`, walkaround, tune) is padded by
  `maxObstacleReachMm = max(maxClearanceBoundMm, maxHoleBoundMm)`, so the halo-0 window of the
  obstacle builder cannot drop an obstacle a scoped rule or `copperToHoleMm` reaches (R2 #2, Astra
  run 2 #3); the A* grid step and the meander leg floor keep the copper-to-copper bound. The
  accept path still re-runs the gate.
- The bridge-completion memo (§4) is bypassed whenever `replaces` is non-empty (a tune commit):
  correct, one-shot, but O(board) per touched anchor rather than the §7 bound (R1 #6).
- `worseWitness` breaks a full tie (severity, deficit, measured, message) on `locationMm`; two
  drafts equal in every compared field are interchangeable by definition.
- `clearance-judge.ts` and `drc-context.ts` exceed the repo's 500-line guidance; splitting the six
  pair bodies or the item builder would separate what the contract keeps together (R1 #8).
- `checkPendingCopper` runs inside the command transaction without a catch: a kernel throw aborts
  the transaction (nothing persisted) and surfaces as the dispatcher's error, not as a verdict —
  the same failure class batch DRC has, now on the commit path.
- `pcb_cleanup_pour_traces` still loads the full projection (pours after the placement sync); it
  is not a copper-creating command and stays outside the gate.
- The rows-built context sees only MATERIALISED placements: a schematic part placed but never
  loaded into the PCB projection has no placement row yet, so its pads are invisible to the gate
  until the next projection load creates the row (at a default position, which is why the gate
  must not invent one) — batch reports it after the load (R1 #3).
- A throw inside the gate is caught by the dispatcher's transaction wrapper and answered as a
  revision conflict; it is logged with the command type so it stays attributable (R1 #5).

## 10. Golden and test delta

Batch semantics change exactly once in S8, deliberately: **touching unassigned copper is an
extension** (§4, 06 §4). Every other step — the relocation, the pair-body factoring, the server
gate, the `worseWitness` tie-breaks — left the six goldens byte-identical, which is the refactor
oracle the session ran at every checkpoint. The extension rule moves ONE golden:
`golden-census-2l` 84 → 82 violations (errors 37 → 35, `countsByCode.TRACE_TO_TRACE_CLEARANCE`
2 → absent), the two removed ids being the deliberate bridge trace `t_bridge_null`'s −0.300 mm
overlaps with the two named runs it bridges (`TRACE_TO_TRACE_CLEARANCE-v2-d7dd6b39c5f31ec9`,
`…-ff9125cba8163ca0`); its `NET_SHORT_CIRCUIT` bridge survives, so the fault is reported once, as
the bridge. `areas`, `cutouts`, `pours`, `rules`, `small` unchanged; the corpus still provokes
`TRACE_TO_TRACE_CLEARANCE` (cutouts, rules, small). Two `drc-engine.test.ts` assertions that
encoded the old semantics were rewritten (the null-net overlap is now asserted to be neither a
clearance error nor a short, with a new "merely close is still judged" case; the mirrored-pad test
names its pad so its geometric intent no longer rides on the null-net tier). New tests:
`drc-live-parity.test.ts` (leave-one-out over the six goldens for §1 clause 2; hand-built
boundary fixtures per pair kind, hole, edge, keepout, bridge completion and replacement for
clause 1; obstacle-superset property; server ↔ live parity through the runtime),
`drc-audit-b5.test.ts` (`B5-LIVE-ROT-PAD`, `B5-LIVE-TH-PAD-SIDE` flipped), the rewritten
`live-drc.test.ts`, the updated `pcb-routing-obstacles.test.ts`, executor gate tests
(`designer-copper-gate.test.ts`), e2e (`pcb-live-parity.spec.ts`: a live-blocked route is refused
at commit and commits with the override; a route into a free NPTH hole is blocked — both wrap the
obstacle in a `tracks` keepout because walkaround detours around a bare obstacle headlessly, so the
NPTH case asserts the conflict count proves the hole's own code participated; driving the smart via
through Playwright is filed).

## 11. Astra ledger

Run 1 — spec-attack, xhigh, prompt-only, 2026-09-09, ≈16 min, on §1–§6 — 9 findings:

| # | Finding | Verdict | Folded |
|---|---|---|---|
| 1 | Non-perturbation fails when an existing bridge gains a net (old id leaves) | accepted (verified by reasoning over `recordBridge` / anchors) | §1 clause 2 `replaced(T)`; harness |
| 2 | A vertex subsequence is not a copper subset | accepted, blocker | §6: no truncation exemption |
| 3 | A genuine truncation can move a waived hotspot's bucket | accepted (inference; clearance codes are waivable and location-hashed) | §6: no exemption |
| 4 | Obstacle inflation resolved at the obstacle undercuts an area relaxation | accepted (S6 §9 heuristic overclaimed by the first §5 draft) | §5: `max(at obstacle, implicit)` |
| 5 | Clearance-only inflation does not cover the inclusive short tier at a 0 mm rule | accepted | §5: `SHORT_EPS_MM + 1 nm` floor |
| 6 | `worseWitness` has no final tie-break (equal deficit + measured, different message) | accepted (verified in `drc-engine.ts`; a batch determinism hole outside the goldens) | `finalizeReport`: message tie-break |
| 7 | Bridge completion must expand to every shape of a logical pin | accepted | §4 |
| 8 | Projection-object memo is not per-revision freshness | rejected as a defect — the projection is an immutable snapshot; recorded as the guarantee the memo rests on | §7 |
| 9 | Bridge completion can be quadratic per pointer move | accepted as a bound: completion memoised per context | §4, §7 |

Also folded from the run's closing notes: refuse-set membership by code (a severity downgrade
does not unblock); `HOLE_TO_HOLE` stays a warning; `ensurePcbBoardSettings` is not a gate side
effect; codes outside `L` a route can newly cause are listed in §3 as excluded.

Run 2 — adversarial-verify, xhigh, repository-grounded, 2026-09-09, ≈13 min, 7 findings:

| # | Finding | Verdict | Folded |
|---|---|---|---|
| 1 | Null-net extensions bypass the attached net's stricter rules (blocker-class false pass, pre-existing: the null tier was the default before S8 too) | accepted as a defect, out of S8's parity objective — registered **B7-1** with a `test.todo` (`drc-audit-b7.test.ts`), owner S13 | §9; 06 §4; OPEN_FINDINGS |
| 2 | Obstacle inflation resolves a segment at its midpoint, missing an area tightening that covers only its end | accepted (the gate catches it; the §5 superset claim did not hold) | obstacles split at the area rings, per sub-segment resolution |
| 3 | Corridor windows are padded by the clearance bound only, so a far NPTH with a large `copperToHoleMm` is not an obstacle | accepted | corridor padding = `max(clearance bound, hole bound)` |
| 4 | Equal-deficit candidate ties follow the pending id (measured / required / message, not only the marker) | accepted — the §1 "marker only" exception was too generous. Reproduces only for OFF-diagonal ties of the candidate matrix (a transposition preserves diagonal order): the fixture draws the named trace right-to-left so its segment order opposes the pending run's | `betterWitness` in `summarize`: deficit → larger required → smaller gap → location (x, y); `layered` mode untouched (§4.3 mandates stackup order) |
| 5 | An exact 100 nm short is dropped by the AABB prefilter (float: `aabbGap` lands 6e-17 above the inclusive threshold) | accepted (pre-existing S7 prefilter). Reproduces only AWAY from the origin (at y = 0 both expressions round alike): the fixture sits at y = 5 / 5.2001 | `farApart`, the grid halo and the copper-to-hole prefilter get `GEOM_EPS_MM` grace |
| 6 | Cold bridge completion is O(board) per touched anchor: 130–238 ms on a 5 000-item sparse board | accepted | `itemsByAnchorKey()` index on the context: 24 → 2.4 ms cold at 5 000 items |
| 7 | Site A merges two verdicts by id and keeps a superseded bridge (two conflicts vs one at commit) | accepted | site A judges the whole session in one call per frame |
