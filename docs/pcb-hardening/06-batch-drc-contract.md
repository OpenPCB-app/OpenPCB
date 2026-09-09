# 06 — Batch DRC reference-implementation contract (Session 7)

Status: **S7 complete (2026-09-09)** — implemented; one Astra adversarial-verify run and two review
passes folded (§11); golden delta in §10; gates at close in `PROGRAM.md`.

This contract states what batch DRC is: the reference legality implementation of OpenPCB. It
fixes which inputs the engine trusts and which it derives, the item model every check reads, the
complete inventory of checks and pair kinds with the kernels and comparison regimes they use,
the shape of the report, and the limits that remain. Live DRC converged on it in S8
(`07-live-parity-contract.md`: `checkPendingCopper` runs these checks' subject-set forms —
`judgeCopperPairs`, `copperToHolePairs`, `boardItems` / `holePairs`, `keepoutItems` and the per-item
scalars — through the same `finalizeReport`; the batch loops are unchanged and the clearance codes'
emit site is `checks/clearance-judge.ts`); scaling (S9) and execution (S10) still converge on it;
S11–S14 extend it. Session sequence and gates: `PROGRAM.md`.

## 0. Scope

In scope: `src/shared/drc/` — relocated there in S8 from `src/modules/designer/backend/drc/`, which is now re-export shims — (`drc-engine.ts`, `drc-context.ts`, `pair-gap.ts`,
`code-registry.ts`, `severity.ts`, `violation-id.ts`, `checks/*`), the shared derivations it
consumes (`src/shared/pcb-connectivity/copper-records.ts`, `src/shared/rendering/pcb/pcb-drills.ts`,
`src/shared/rendering/pad-copper-layers.ts`, `src/shared/drc/`, `src/shared/pcb-geometry/`,
`src/shared/pcb-areas/`, `src/shared/rendering/copper-fill/`), and the consumers of the report.

Out of scope, with the owning session: live / route parity (S8, `07-live-parity-contract.md`), the broad phase (S9), async
execution (S10), slot / annular / aspect / plating models and scoped hole rules (S11), DFM
overlays, exact-arc geometry and minimum-web checks (S12), electrical thresholds (S13), SI and
length semantics (S14).

## 1. The reference-implementation statement

`runDrc(projection, options)` is a pure function. It **trusts** exactly three things from the
projection: the board settings (`board`, incl. rules, classes, assignments, view-state
suppressions), the schematic pad→net correlation (`padNets`) and the net-name map (`netNames`).
It **derives everything else itself**, through the one shared derivation each physical question
has, and never reads a caller-computed answer:

| Question | Derivation (the only one) | Where it is consumed |
|---|---|---|
| Which copper exists, on which layers | `buildCopperRecords` (S1) — pads incl. free pads via `freePadCopperLayers`, traces, vias | every item in §2 |
| Which drills exist | `freePadDrill` + free holes + via / footprint drills (`pcb-drills.ts`) | `DrcHole` list |
| The board region | `buildBoardRegion` (S2, biased `board-inner`) | edge, off-board, hole checks, outline validity |
| Effective copper areas and keepouts | `collectCopperZones` / `collectKeepouts` (S3a) | zones, keepouts, pours |
| Every rule value | `createRuleResolver` (S6) | every clearance / scalar comparison |
| Electrical connectivity | `computeBoardConnectivity` over the context's own records and pours (S1/S5) | dangling, dead copper, **ratsnest** |
| The ratsnest | `ratsnestFromConnectivity` over that connectivity (S7) | `UNCONNECTED_NET` |
| Pour copper | `buildCopperFillIslands` once per effective zone (S5) | connectivity pour nodes, pour verdicts |

Before S7 the engine read `projection.ratsnest`, a loader-computed field; a projection whose
ratsnest and copper disagreed could produce a report contradicting its own connectivity. The
loader still computes a ratsnest for the canvas; a parity test asserts it equals the engine's on
every golden.

The engine has no `Date`, no `Math.random`, no I/O. Two runs over equal projections produce
byte-identical reports (§7).

## 2. Item model

`buildDrcContext` turns the projection into millimetre-domain items once; checks read items,
never the projection's primitives (the two exceptions are placements for `PLACED_PART_MISSING_FOOTPRINT`
and the outline for milling advisories, both non-copper).

| Item | Built from | Geometry | Layer policy |
|---|---|---|---|
| `DrcTrace` | every trace record | round-capped polyline stadium (`pointsMm`, `halfWidthMm`), AABB inflated by the half width | its declared layer, **un-clamped** — an off-stackup layer raises `TRACE_LAYER_MISMATCH`, which is non-overridable and non-waivable (S7): the copper collides with nothing, so the code is its only guard |
| `DrcPad` | every pad record: footprint pads and free pads (`smd` / `conn` on their declared layer, `std` on every copper layer, `hole` has no copper) | world ring (rotated, mirrored); **`disc`** for a true circle (S7 — the exact disc, not the circumscribed 48-gon); `custom` / `trapezoid` = bounding rectangle (declared superset, S11) | resolved layers; an off-stackup declaration → **clamp** to every valid layer (cannot mask a short) + `PAD_LAYER_MISMATCH` |
| `DrcViaGeom` | every via | disc of `diameterMm / 2` | its span; an invalid span → clamp to every valid layer + `VIA_LAYER_SPAN` |
| `DrcHole` | via barrels (`via`), footprint pads with a drill (`pth`), **every free pad with a drill** (`pth` iff `std`, else `npth` — S7; `smd` / `conn` drills used to be invisible although Excellon drilled them), free holes (`npth`) | disc of `drillMm / 2`, or the slot stadium (`slot`) for oblong free-pad / free-hole drills; footprint pads carry no slot field (S11, B2-5) | through every layer |

Connectivity items are built from the same records under the **fail-safe** policy (an invalid
pad or via occupies no layer); the two policies share one geometry (S1 §2).

Single-point traces cannot reach the engine (`pcb-store.ts` rejects `< 2` points and non-finite
coordinates); the disc branches that handle them in `checks/board.ts` are defensive.

## 3. Check inventory

Seventeen checks run in this order; the report order is canonical (§6), so the order matters
only for the memoised context (rules and areas first because they contextualise what follows).

| Check | Codes | Items | Kernels | Regime (§5) |
|---|---|---|---|---|
| `rules` | `DRC_RULE_INVALID`, `DRC_RULE_INEFFECTIVE` | resolver problems | — | — |
| `outline` | `BOARD_OUTLINE_INVALID` | region rings | `ringSelfIntersects`, `ringStrictlyInside`, `ringsIntersect`, `ringSignedArea` | degenerate area `DEGENERATE_AREA_MM2` |
| `zones` | `ZONE_INVALID`, `ZONE_EMPTY_FILL` (net reasons), `ZONE_OVERLAP` | effective zones / keepouts + derivation warnings | `ringsOverlapPositiveArea` | inclusive overlap |
| `constraints` | `TRACE_LAYER_MISMATCH`, `PAD_LAYER_MISMATCH`, `VIA_LAYER_SPAN` | traces, pads, vias | — | — |
| `structural` | `PLACED_PART_MISSING_FOOTPRINT` | placements | — | — |
| `manufacturability` | `TRACE_WIDTH_MIN`, `VIA_DIAMETER_MIN`, `VIA_DRILL_MIN`, `ANNULAR_RING_MIN`, `DRILL_SIZE_MIN`, `VIA_ASPECT_RATIO`, `FAB_TRACE_WIDTH`, `FAB_DRILL`, `FAB_PAD`, `FAB_ANNULAR_RING`, `OUTLINE_INTERNAL_RADIUS`, `OUTLINE_SLOT_WIDTH` | traces, vias, holes, outline **and cutouts** (S7) | resolver scalars; `findSmallInternalRadii`, `findNarrowestSlot` | minimums `below`; fab `below`; aspect `exceeds` |
| `netclass` | `NETCLASS_TRACE_WIDTH`, `NETCLASS_VIA_DIAMETER`, `NETCLASS_VIA_DRILL` | traces, vias (intent-gated nets) | resolver class | minimums |
| `clearance` | six `*_CLEARANCE`, `NET_SHORT_CIRCUIT`, `FAB_CLEARANCE` | traces, pads, vias — every different-net pair on a shared layer | `pair-gap.ts` (S2 kernels), resolver `clearance` / `clearanceBound`, `splitSegmentAtRings` | short inclusive; clearance `clearanceViolated`; fab `below` |
| `copper-to-hole` (S7) | `COPPER_TO_HOLE` | traces, pads, vias × non-plated holes | `pair-gap.ts` `copperHoleGap`, `copperToHoleClearanceMm` | clearance |
| `connectivity` | `UNCONNECTED_NET` | the engine's own ratsnest (§1) | `ratsnestFromConnectivity` | — |
| `copper-pour` | `ZONE_FILL_FAILED`, `ZONE_EMPTY_FILL` (no island), `ISOLATED_COPPER_ISLAND` | pour results, connectivity components | S5 kernel | — |
| `dangling` | `TRACK_DANGLING`, `VIA_DANGLING` | connectivity contact records | S1 kernel | — |
| `electrical` | `TRACE_CURRENT_WIDTH`, `CREEPAGE_DISTANCE` | traces, pads, vias (net voltage / current from the resolver's class) | `pair-gap.ts`, `ipc2221-spacing.ts`, resolver `clearance` (skip only without area rules — S7) | minimums (S13) |
| `signal-integrity` | `DIFF_PAIR_GAP`, `DIFF_PAIR_SKEW`, `DIFF_PAIR_UNCOUPLED_LENGTH` | traces of resolved pairs | own segment maths (S14) | bare `>` (S14) |
| `length` | `NET_LENGTH_OUT_OF_RANGE` | traces per net, per group (anchor `net` + `lengthGroup`, S7) | `polylineLength` | bare (S14) |
| `board` | `COPPER_TO_BOARD_EDGE`, `COPPER_OFF_BOARD`, `HOLE_TO_BOARD_EDGE`, `HOLE_OFF_BOARD`, `HOLE_TO_HOLE`, `FAB_HOLE_TO_HOLE` | traces, pads (disc-aware), vias, holes vs the biased region | region kernels, resolver `edgeClearance` / `holeToHole` | clearance for copper edge; minimums for holes |
| `keepouts` | `KEEPOUT_VIOLATION` | traces, vias, pads (disc-aware), placement extents | `keepoutAffects` (S3a) | open interior |

Every code has exactly one class (`RULE_CLASS_BY_CODE`), one default severity
(`DEFAULT_SEVERITY_BY_CODE`), one label (`CODE_LABEL`) and at least one registered emitter
(`EMIT_SITE_BY_CODE`) — all four are `Record<DrcRuleCode, …>`, so an unmapped code fails `tsc`.
Checks emit facts (code, anchors, measured, required, location, layer); the engine assigns class
and severity. The census test (§6) proves reachability: the corpus provokes every code.

## 4. Pair-kind matrix

Rows and columns are physical things on the board; each cell names the check that judges the
pair, or the reason no check does.

| | trace | pad | via | NPTH drill | board edge / cutout | keepout | zone (other net) | pour copper |
|---|---|---|---|---|---|---|---|---|
| **trace** | clearance (`traceToTrace`) | clearance (`traceToPad`) | clearance (`traceToVia`) | copper-to-hole | board (`edgeClearance`, off-board) | keepouts | pour carves around it (S5) | by construction |
| **pad** | · | clearance (`padToPad`; same-footprint pairs: short tier only) | clearance (`padToVia`) | copper-to-hole | board | keepouts | carve | by construction |
| **via** | · | · | clearance (`viaToVia`) | copper-to-hole | board | keepouts | carve | by construction |
| **NPTH drill** | · | · | · | board (`HOLE_TO_HOLE`) | board (`HOLE_TO_BOARD_EDGE` / `HOLE_OFF_BOARD`) | not a copper item — no restriction applies | pour clears it by `copperToHoleClearanceMm` | — |
| **PTH / via drill** | covered by the copper pair | · | · | board (`HOLE_TO_HOLE`) | board | · | · | — |
| **zone** | · | · | · | · | `ZONE_INVALID` off-board | `copperPour` restriction (subtracted) | `ZONE_OVERLAP` (equal priority) | — |
| **null-net copper** | pairwise: clearance tier (a null net matches no scope); **a null-net item touching two known nets is a short** (S7) | | | | | | | |

"By construction": pour copper is generated with the resolver's clearance halos and is never
re-measured against foreign copper; a kernel regression would produce a clean report. The pour
suite owns that assertion (filed S5).

Copper-to-hole (S7): `required = clearance.copperToHoleMm ?? copperToBoardEdgeMm` — the
non-plated wall is a bare substrate edge, which is exactly the value the fill has always applied
to its NPTH halo, so DRC and the pour agree by construction and an absent field changes nothing
in the artwork. A copper item's own drill is not a pair (anchor identity). Plated drills are
covered by their copper. No scoped rule reaches the value (S11 adds hole pair kinds).
**Non-plated FOOTPRINT pads are not seen** (R1 #5): the footprint render source carries no
plating attribute, so every drilled footprint pad is a `pth` hole with (fictitious) copper — a
KiCad `np_thru_hole` mounting hole reaches DRC as copper, not as an NPTH obstacle; only free
holes and non-plated free-pad drills are `COPPER_TO_HOLE` obstacles until S11 plumbs the pad
type through. The release note says "free holes", not "mounting-hole footprints".

Intra-footprint pads (S7): pads of one placement skip the clearance and fab tiers (spacing inside
a footprint is the library's responsibility) but never the short tier — overlapping different-net
pads of one footprint are a dead short on the board. Symmetric with the hole↔hole rule, which
keeps overlapping drills of one footprint. Exception (R1 #4): a pair in which either pad is a
`custom` / `trapezoid` bounding rectangle (`exactShape === false`) is not judged at all inside a
footprint — its ring is a declared superset, and a short is non-waivable, so the pre-S7 skip
stays until S11 models the true outline. Across footprints such pads keep today's (conservative)
verdicts.

Null-net bridges (S7): the clearance loops record, for every null-net item, each known net whose
copper it touches (`gap ≤ SHORT_EPS_MM`, shared layer). An item touching two or more distinct
known nets emits `NET_SHORT_CIRCUIT` anchored on the item and the nets. Pairwise semantics stay
S1's: unassigned copper touching one net is an extension of it. Chains through two null-net items
are a stated limit.

Touching unassigned copper is one conductor (S8 correction, `07-live-parity-contract.md` §4):
until S8 the clearance tier still judged a touching (null, null) pair and a touching (null, named)
pair as different nets and reported a negative-gap `*_CLEARANCE` — a conductor violating clearance
with itself, or with the net it extends. Since S8 `emit` returns before the clearance and fab tiers
for any touching pair with a null side (the bridge record of a (null, named) touch is kept); a
null-net item that is merely close (`0 < gap < required`) to any copper is still judged, since it
may be a different conductor. The `census` golden carried such rows; §10 records the delta. What
the extension does NOT yet do (Astra S8 run 2 #1, registered B7-1, owner S13): give the unassigned
copper the rule tier of the net it extends — its pairs with other nets still resolve with the
null-net (default) requirement.

## 5. Comparison regimes

| Regime | Form | Used by |
|---|---|---|
| Minimums | `below(v, limit)` = `v < limit − 1e-6` | manufacturability, net-class, hole↔hole, hole↔edge, current width, creepage |
| Clearance | `clearanceViolated(gap, req)` = `gap < req − GEOM_EPS_MM` (0.5 nm) | six copper pairs, copper↔edge, copper↔hole |
| Short | `gap <= SHORT_EPS_MM` (1e-4), inclusive | short tier, null-net bridges |
| Fab | `below(gap, fabMin)` | `FAB_CLEARANCE`, `FAB_HOLE_TO_HOLE`, the fab validators |
| Bare | `>` / `<` with no grace | SI, length (S14) |

(`OPEN_FINDINGS.md` §5.1 listed the FAB tier under the clearance regime; the code uses `below`,
and this table is now the record.)

Every remaining approximation IN A DRC CHECK biases towards false-fail: bounding rectangles for
`custom` / `trapezoid` pads, the board-inner biased region (≤ `MAX_CHORD_DEVIATION_MM` = 0.01 mm on
curved edges — the exact-arc second chance is S12), the pour's circumscribed arc samplers. The one
approximation that biases the OTHER way lives in connectivity, not in a check: the circumscribed
ring of an oval / roundrect pad (≤ 0.2 %·r) can fabricate contact between two same-net pads that
are physically ≈ 2 µm apart, so `UNCONNECTED_NET` is not raised and — the pads being same-net — no
clearance check sees them either (S1/S2 recorded limit; exact arcs for non-circles are S11's;
Astra S7 #5). The AABB
prefilter uses `clearanceBound` (board pair ∨ both classes ∨ rule maximum ∨ floor) ∨ `fabMin` ∨
`SHORT_EPS_MM` over outward-inflated boxes — an upper bound of every value a pair can resolve to,
so it cannot skip a violating pair.

## 6. Report contract

- `violations` is sorted by `(code, id)`; `countsByCode` keys follow that order; `summary` counts
  non-waived violations. Input order cannot change the report.
- Ids are unique within a report. Every code that can fire more than once between the same
  anchors carries a location bucket (`LOCATION_HASHED_CODES`, now including the outline-milling
  advisories); `NET_LENGTH_OUT_OF_RANGE` carries the group as a second anchor. The several copper
  shapes of ONE pad number share a logical anchor (records carry `occurrence`, anchors do not), so
  drafts that hash alike are collapsed by the engine to the worst witness (smallest `measuredMm`)
  — one pin against one hole is one violation — and the hole↔hole loop never pairs a pin's own
  drills (R1 #2).
- Class and severity come from the tables; `override → matched rule → default`; the
  non-overridable set is `NET_SHORT_CIRCUIT`, `VIA_LAYER_SPAN`, `PAD_LAYER_MISMATCH`,
  `TRACE_LAYER_MISMATCH` (S7), `BOARD_OUTLINE_INVALID`, `ZONE_INVALID`, `ZONE_FILL_FAILED`,
  `DRC_RULE_INVALID`.
- Rule-class ignores persist for every class (`DRC_RULE_CLASSES` is derived from the union; the
  store used to drop `dfm`, `electrical` and `signal-integrity` silently).
- `measuredMm` is signed for `COPPER_TO_BOARD_EDGE`: negative when the copper is not inside the
  region (S7); for a polygon pad that crosses the edge the magnitude is how far its ring reaches
  past the boundary (never less than `GEOM_EPS_MM`, so it never serialises as `0`);
  `COPPER_OFF_BOARD` stays the authoritative verdict.
- The census gate: the corpus (five goldens + `golden-census-2l`) provokes every code; each
  emitted code's class equals the table; ids are unique per fixture; the registry, severity, class
  and label maps agree member for member.

## 7. Determinism

Reversing any input array (`traces`, `vias`, `placements`, `freePads`, `freeHoles`, `zones`,
`keepouts`, `drcRules`) yields a byte-identical `JSON.stringify(report)`: every pairwise
computation runs in the canonical orientation (the item with the smaller sorted anchor key leads),
every per-net accumulation and "first trace" witness walks the traces in canonical id order
(`canonicalTraces` — float sums are not associative, Astra S7 #6), so witnesses, locations and
measured values do not depend on iteration order, and the canonical sort removes the last order
dependence. One deliberate exception: the ORDER of `drcRules` is part of their meaning — two
enabled rules of equal priority resolve by array index (rule-semantics contract §2 / §4.1), so
reversing a table that contains such a tie is a different rule table, not a presentation change
(Astra S7 #7). The caveat in `OPEN_FINDINGS.md` §5.2 is retired.

## 8. Consumers

`routes.ts` (`/drc/run` and the three cloud / auto-layout apply paths), `sdk.ts` (assistant
`run_drc`, MCP resource, proposal apply), `scripts/drc-parity-harness.ts`,
`scripts/update-drc-goldens.ts`, the golden and census tests. All call `runDrc` with options that
default from the projection (05 §8); none re-orders or re-derives.

## 9. Stated limits

- `drillSizeMm`, the pad annular ring and `holeToBoardEdgeMm` read the board minimums directly —
  no scalar kind exists, so no scoped rule can reach them (S11).
- `custom` / `trapezoid` pads are bounding rectangles in every consumer (S11) — excluded from the
  intra-footprint short tier (§4); footprint pads carry no oblong drill (S11, B2-5); no plating
  attribute — non-plated footprint pads read as copper (S11, §4).
- A slotted free-pad drill carries two widths (`drillMm` and `drillSlot.widthMm`); the SDK says
  they are one value, the store does not enforce it, and consumers read one or the other
  (Excellon tool and the gap kernel: the slot width; drill minimums and hole↔hole overlap:
  `drillMm`). Reconciling the store is S11.
- A drilled `smd` / `conn` free pad opens the mask on its declared layer only, although its NPTH
  drill goes through both faces; a `hole` free pad opens both (mask policy, S12).
- The Gerber writer flashes a pad from its OWN aperture model (`padApertureShape`: an orthogonal
  swap for 90° multiples, no rotation otherwise; a `circle` uses `widthMm` only), not from the
  world ring DRC judges — a non-orthogonally rotated rectangular pad ships un-rotated and a
  DRC-clean board can export a short (Astra S7 #1, register entry B6-1, S11: "DRC's representation
  matches export").
- Two problems that hash to one id collapse into one row (§6); the survivor is the most severe,
  then the largest deficit against its own requirement (Astra S7 #4).
- Invalid-layer traces are not clamped (§2); the guard is non-waivable.
- Pour copper is never re-measured against foreign copper (§4).
- Chained null-net shorts (§4).
- The exact-arc second chance inside the chord band (S12).
- Via barrel length is absent from length / SI; SI and length comparisons carry no epsilon (S14).
- Outline-milling advisories are fab-advisory (`custom` fab: none). Cutouts are judged with the
  material OUTSIDE the ring (sharp void corners, parametric holes narrower than the cutter); the
  slot / neck search is side-agnostic, so a narrow material web between two lobes of one cutout
  also reports `OUTLINE_SLOT_WIDTH` (a minimum-web limit S12 owns). The whole outer outline being
  narrower than the cutter is not reported (S12). The cutout message names the cutout's id; its
  ordinal is positional.
- Rendering / export changes riding on the one free-pad model (release notes): a `std` free pad
  now draws and exports copper on inner layers of a 4+-layer board; a `hole` free pad draws and
  exports no copper (its mask relief on both faces stays); a drilled `smd` / `conn` free pad is
  both connectable copper and an NPTH obstacle in the cloud snapshot.

## 10. Golden delta

`small` / `areas` / `rules` byte-identical. `cutouts` +4: two `COPPER_TO_HOLE` (trace `t_cross`
runs straight through the Ø1 mm free hole `hole_warn` and the 4×1 mm slot `hole_slot`, measured
−1.000 mm) and two intra-footprint `NET_SHORT_CIRCUIT` (U1 pads 4/5 and 12/13 overlap by 0.05 mm at
a corner — a fixture-footprint defect the old skip hid). `pours` +2: null-net bridges on J1 / J2 —
1.27 mm-pitch headers drawn with Ø1.6 mm pads, whose unassigned pin 2 physically overlaps pins 1
and 3 (`gnd` / `s3`, `gnd` / `s4`); the fixture's geometry, not a demonstration board. No id was
removed or changed. New `golden-census-2l` (`jlcpcb_2l`, 84 violations, 38 codes); the six
goldens together provoke every code except `ZONE_FILL_FAILED` (kernel bail only; pinned by
`drc-copper-pour.test.ts`). Every expected file was regenerated so its `countsByCode` keys sit
in the canonical code order (§6) — `areas` / `rules` / `small` changed in key order only, values
identical to S6. Digests at close: `areas 99c49e…`, `census 7b3a5e…`, `cutouts 43fbd5…`,
`pours ab2451…`, `rules ed0705…`, `small cd4b96…`.


S8 (2026-09-09): the extension rule of §4 removed two `TRACE_TO_TRACE_CLEARANCE` rows from
`golden-census-2l` (84 → 82; the bridge trace's overlaps with the runs it bridges; its short
survives) — `07-live-parity-contract.md` §10. The other five goldens are byte-identical after S8's
relocation and refactor.

## 11. Astra ledger

**Run 1 — adversarial-verify, `gpt-6-astra`, xhigh, repository-grounded (`-C OpenPCB`, read-only),
2026-09-09 07:42, ≈ 40 min, 235 k tokens.** Packet: this contract + the diff summary + the census result
+ 11 questions. Astra ran the targeted S7 suites (113 passed) and its own boundary / slot / layer /
invalid-ring / net-name / purity probes. Eight findings, every one traced against source before
acting:

| # | Finding | Severity (Astra) | Verdict | Where |
|---|---|---|---|---|
| 1 | Gerber flashes a pad from its own aperture model: non-orthogonal rotations ship un-rotated, an unequal `circle` uses `widthMm` — a DRC-clean board can export a short | blocker | **partially confirmed** (a probe shows the 90° case is correct — the orthogonal swap works; 45° is un-rotated). Export-side, not batch DRC: registered as **B6-1**, `drc-audit-b6.test.ts`, owner S11 | §9 |
| 2 | Creepage skips a pair whenever the ordinary rule dominates, but the ordinary tier never runs inside a footprint — two pads of one footprint 100 V apart go unreported | blocker | **accepted, fixed** — the skip no longer applies to same-footprint pairs (pre-S7 miss, same mechanism) | `electrical.ts` |
| 3 | R1 #2's same-anchor skip in the hole↔hole loop hides two DISTINCT overlapping drills of one pin that Excellon still emits | high | **accepted, fixed** — only a coincident (same) drill is skipped | `board.ts` |
| 4 | The id dedupe keeps the smallest measured and can drop an error for a warning | high | **accepted, fixed** — survivor = most severe, then largest deficit, then smallest measured | `drc-engine.ts` |
| 5 | Connectivity's circumscribed oval / roundrect rings fabricate contact across a 2 µm gap — a real open is hidden, and the "false-fail only" claim is wrong for connectivity | blocker | **accepted as the recorded S1/S2 limit** — §5 corrected (the claim holds for DRC checks, not for connectivity); exact arcs for non-circles stay S11 | §5, §9 |
| 6 | Float sums in `length.ts` / `signal-integrity.ts` and the `pTraces[0]` marker follow `ctx.traces` order — reversal changes the id multiset | medium | **accepted, fixed** — `canonicalTraces` (id order) before every accumulation and witness | `pair-gap.ts`, `length.ts`, `signal-integrity.ts` |
| 7 | Equal-priority rules resolve by array index, so reversing `drcRules` can change a verdict — contradicting §7 | medium | **accepted as a contract correction** — rule order IS meaning (05 §2 / §4.1); §7 now states the exception | §7 |
| 8 | The milling classifier infers winding from the arc-endpoint polygon; a major arc reverses it and a material tip is reported as a void corner | medium | **accepted, fixed** — winding from the flattened contour | `outline-manufacturability.ts` |

Tests: `drc-s7-review-fixes.test.ts` (Astra #2, #3, #4, #6, #8 plus the R1 fixes),
`drc-audit-b6.test.ts` (B6-1, `test.todo`). Reviewer passes before Astra: R1 (reviewer-critical,
12 findings — a byte-identity hole in the hole↔hole loop, id collisions from multi-shape pads, a
`stdFreePadIds` regression this session introduced, the non-waivable false short on bounding-rect
pads, footprint NPTH pads invisible, `-0` in the signed measure, a NaN drill guard, the slot
width vs `drillMm` split, mask policy, `std` on inner layers, the golden delta record) and R2
(reviewer, accept with three lows) — all fixed or recorded above and in §9.
