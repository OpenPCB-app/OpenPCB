# 08 — DRC broad-phase contract (Session 9)

Status: **S9 in progress (2026-09-09)** — contract written before implementation; the Astra
spec-attack ledger is folded (§11); the numbers in §7 are filled at close.

This contract states how batch DRC discovers candidate pairs and candidate boundary edges without
changing what it reports. It fixes the two indexes the engine builds once per context, the exact
sense in which the indexed run equals the exhaustive run, the mode switch that keeps the exhaustive
enumeration in the tree as the oracle, the halos every query is made with, and the harness that
proves the equality on every golden, on the determinism fixture and on a seeded synthetic corpus.
Session sequence and gates: `PROGRAM.md`.

## 0. Scope

In scope: candidate discovery in `src/shared/drc/` — `broad-phase.ts`, the grid-driven
enumerations in `checks/clearance.ts`, `checks/copper-to-hole.ts`, `checks/board.ts`,
`checks/keepouts.ts`, `checks/electrical.ts`, the mode switch in `drc-context.ts` / `types.ts` /
`drc-engine.ts` / `legality.ts` — and the boundary-edge index in `src/shared/pcb-geometry/`
(`region-index.ts`, the indexed variants in `board-region.ts` and `region-rings.ts`), plus the
consumers that already queried the S8 grid (`judgeCopperPairs`, `route-obstacles.ts`).

Out of scope, with the owning session: execution (async, cancellation, progress, the per-envelope
server context memo — S10, B5-SYNC); every rule value and comparison regime (06, 05 — unchanged);
every kernel in `pair-gap.ts` and every geometry primitive's arithmetic (02 — unchanged; the
indexed variants call the same primitives); the per-pair sub-segment product on pairs that meet an
area polygon (05 §13 — a per-pair cost, not candidate discovery); `ZONE_OVERLAP` O(Z²), the cutout
pairs of `checks/outline.ts` (S12), `signal-integrity` (S14), the fill kernel (04 §13, S10 budget),
the connectivity sweep (S1 — already indexed), the frontend `rbush` hit-test index (UI).

The program's word for this session is **"no change of meaning"**: the report of any projection is
byte-identical to the report the S7/S8 engine produces. §1 says exactly what that means and why it
holds; §7 says how it is proven.

## 1. The identity statement

Let `P` be a projection, `O` its options. Let `runDrc(P, { ...O, broadPhase: "exhaustive" })` be
the report produced by the pre-S9 enumerations (kept verbatim, §3) and `runDrc(P, O)` the report
produced by the indexed enumerations (the default). The contract is:

> **For every `P` and `O`, `JSON.stringify(runDrc(P, O)) === JSON.stringify(runDrc(P, { ...O,
> broadPhase: "exhaustive" }))`, and the pre-finalise draft multisets are equal.**

The second clause is the stronger one and is what the harness asserts first (§7): `finalizeReport`
drops class-ignored and severity-ignored drafts and keeps one witness per id, so two different draft
sets could in principle finalise to equal bytes; equality of the draft multiset rules that out. The
first clause is the user-visible one.

Three lemmas carry the statement. Each names a mechanism of the S7/S8 engine that S9 relies on and
does not touch.

**L1 — pair enumeration.** For every pair kind the index returns every pair whose true gap (the
value `pair-gap.ts` computes) is at most the query halo, and the halo is an upper bound of every
requirement the pair can resolve to (§5), of the fabricator floor and of `SHORT_EPS_MM`. A pair the
index does not return therefore has a gap above every threshold any tier compares against —
`clearanceViolated(gap, required)`, `below(gap, fabMin)`, `gap ≤ SHORT_EPS_MM` — and under the
unchanged bodies (`clearance-judge.ts`) it emits no draft, banks no null-net bridge, and changes no
ledger. Hence the set of drafts is the same as the exhaustive enumeration's. Draft CONTENT never
depended on visit order (canonical orientation by anchor key, the `betterWitness` / `summarize` /
`worseWitness` total orders, bridges flushed in sorted key order, the `(code, id)` report sort —
06 §7, 07 §1); so equal draft sets give equal bytes.

Note what L1 does NOT say: it does not say the index returns every pair `farApart` would pass.
`farApart` tests AABBs; the trace entries of the index are geometry-tight (§2), so a pair whose
boxes meet but whose copper is far is not enumerated. That pair produces nothing in either mode.

**L2 — min over a subset.** Every boundary distance the board check reads is `min_e f(item, e)` over
the region's edges, `f` evaluated by one primitive in one argument order. The edge index returns
every `e` with `f(item, e) ≤ halo`; so the restricted min equals the full min whenever the full min
is at most the halo, and both exceed the halo otherwise — which no comparison at or below the halo
distinguishes. Floating-point `min` over a set is exact and associative, so grouping the edges by
ring (the exhaustive helpers) or not (the index) yields the same float. Where a distance is USED
without a comparison first — a hole that is not inside the region reports its gap; the penetration
of an outside pad vertex is a reported magnitude — the full min is computed (§4).

**L3 — ray parity.** `pointInPolygon` counts the edges whose y-range straddles `p.y` under
`a.y > p.y !== b.y > p.y` and toggles a boolean per crossing. Only straddling edges contribute; the
row band of `p.y` contains every edge whose closed y-range covers `p.y`, a superset of the straddling
set; and the toggle is a commutative XOR, so the subset in any order gives the same boolean.

**Float caveat.** Cell assignment uses `Math.floor((v ± pad) / CELL_MM)`. The query pads by
`haloMm + GEOM_EPS_MM + GRID_SLACK_MM` (§2), so a coordinate that rounds across a cell boundary is
still reached; the exact tests that follow every query (`farApart` / `aabbGap` / the primitives)
are the authority, and the index is never the tighter of the two. The row-band table applies no
grace: `Math.floor` is monotone, and an inclusive closed range is exactly what L3 needs.

## 2. The two indexes

### 2.1 Grid v2 (`src/shared/drc/broad-phase.ts`)

One uniform grid per item kind (`traces`, `pads`, `vias`, `holes`), cell edge `CELL_MM = 2`
(a `createBroadPhase` option, so the bench can vary it; never a semantic input), built once with
the context.

- **Entries.** A pad, via or hole is filed in every cell its AABB touches, as in S8. A **trace is
  filed per sub-segment**: every polyline segment is cut into pieces of length ≤ `CELL_MM`, and each
  piece's AABB inflated by the trace's `halfWidthMm` is filed. `stadium(piece) ⊆ box(piece) ⊕ r`
  and the union of the pieces' stadiums is the trace's stadium, so the cells filed cover every
  point of the copper. A 100 mm 45° trace occupies ≈ 100 cells instead of the 1 225 of its AABB.
  A **one-point trace** (a disc of copper, 06 §2) is filed as its point box inflated by `r`; a
  zero-length segment is one piece with the same box; a trace with no points files nothing (it has
  no copper). The polyline query form treats a one-point subject the same way (Astra A1 #1).
- **Caps, fail-open.** An item that would occupy more than `MAX_CELLS_PER_ITEM` cells, more than
  `MAX_SUBSEGMENTS_PER_ITEM` pieces, carries a non-finite coordinate, **or whose cell indices are not
  safe integers** (`Number.isSafeInteger` on every `x0 / x1 / y0 / y1` — at `|v| ≳ 2^53 · CELL_MM` the
  unit increment of a cell loop no longer advances, Astra A1 #4; the S8 grid had the same latent
  hazard) is `oversized`: returned by EVERY query, unfiltered by the exact box re-test (a NaN makes
  every comparison false, so filtering would drop a pair the exact tests would still judge). The
  same rule applies to a query range. Consecutive pushes of one item into one bucket are deduped
  (an item's insertions are contiguous).
- **Queries.** `near(kind, bounds, haloMm)` — the box form, for a pad / via / hole subject, a
  keepout, or a window. `nearPolyline(kind, pointsMm, halfWidthMm, haloMm)` — the union of the box
  queries of the subject's own pieces, for a trace subject. Both return ascending, unique indices
  into the context array of `kind`; both pad the query by `haloMm + GEOM_EPS_MM + GRID_SLACK_MM`
  (`GRID_SLACK_MM = 1e-6`); both re-test every candidate with `boundsMeet` against the item's WHOLE
  AABB (a superset of every piece box) except `oversized` ones; a query that cannot be indexed — a
  non-finite box, a subject past `MAX_SUBSEGMENTS_PER_ITEM` pieces, or a box or piece range past
  `MAX_CELLS_PER_QUERY` (2¹⁶ cells: a query is a map lookup per cell, so a whole-board window still
  filters; an item's own cap stays `MAX_CELLS_PER_ITEM`) — returns every index, unfiltered.
- **Semantics, stated exactly.** `near` and `nearPolyline` return a SUPERSET of every item whose
  GEOMETRY (stadium, ring, disc) is within `haloMm` of the query geometry. Nothing more is promised.
  For pads, vias and holes the filed bounds are their AABBs, so the result is also a superset of
  AABB-within-halo; for traces it is not, and consumers may not assume it (L1 note).
- **Determinism.** The result is a function of the filed bounds, the array order and the query;
  `Set` / `Map` iteration never reaches the output (sorted ascending), and `oversized` membership is
  a function of the item alone.

### 2.2 Region edge index (`src/shared/pcb-geometry/region-index.ts`)

`buildRegionIndex(region: BoardRegion, cellMm = 2)` over `region.edges` (every edge of the outer
ring and of every hole, tagged with its ring — `RegionEdge.ring`, `board-region.ts`), built once in
`buildDrcItems` and exposed as `LegalityContext.regionIndex`.

- `edgesNear(bounds, haloMm, ring?)` — ascending edge indices whose filed bounds meet the query
  padded by `haloMm + GEOM_EPS_MM + GRID_SLACK_MM`; a superset of every edge within `haloMm` of the
  box; `ring` restricts the result to one ring's edges, which is how every per-ring predicate of
  `board-region.ts` stays per ring.
- `edgesStraddling(y, ring)` — the row band of `y` for one ring: every edge of that ring whose
  closed y-range `[min(a.y, b.y), max(a.y, b.y)]` touches the band `Math.floor(y / cellMm)`. No
  grace (L3). Horizontal edges are filed and rejected by the crossing test exactly as today.
- An edge with a non-finite coordinate, with unsafe cell or row indices, or spanning more than
  `MAX_CELLS_PER_ITEM` cells or rows is `oversized` for both query forms — returned by every query
  (Astra A1 #7: a finite 10⁹ mm edge would otherwise materialise 5 × 10⁸ row postings).
- **PIP operand orientation (Astra A1 #3).** `pointInPolygon` walks `a = ring[i]`, `b = ring[j]`
  with `j = i − 1` — the LATER vertex is `a` — while `region.edges[k]` stores `a = ring[k]`,
  `b = ring[k + 1]`. The crossing expression `((b.x − a.x) · (p.y − a.y)) / (b.y − a.y) + a.x` is
  symmetric under swapping `a` and `b` mathematically but not bit for bit, and a point within a few
  10⁻⁷ mm of an edge can flip the parity. The indexed test therefore evaluates every selected edge
  with `a = e.b`, `b = e.a` — the ring loop's operands — and the harness pins it on random points
  and on the constructed near-edge case.

The geometry functions keep their signatures and code paths and gain an optional trailing `index`
(and, where a comparison threshold exists, a `haloMm`); with the argument absent they are the
pre-S9 functions, byte for byte:

| Function | Indexed behaviour | Lemma |
|---|---|---|
| `regionContainsPoint(region, p, eps, index?)` | ring-0 PIP over `edgesStraddling(p.y, 0)`; `nearRing(ring_k, p, eps)` → any edge of `edgesNear(pointBox, eps, k)` within eps — per ring, in BOTH branches (a point inside a cutout within eps of the OUTER ring stays off-board); the per-hole `ringBounds` prefilter stays | L3 |
| `regionBoundaryDistancePoint / Polyline / Ring(…, index?, haloMm?)` | min over `edgesNear(box, haloMm)` by the same primitive in the same argument order (`projectPointToSegment(p, e.a, e.b)`, `segmentToSegmentDistance(p, q, e.a, e.b)`, `segmentToSegmentDistance(ring_i, ring_i+1, e.a, e.b)`); `Infinity` when the index returns no edge, otherwise the exact min whenever that min ≤ halo and some value > halo otherwise (the index is a superset, so a returned edge can sit beyond the halo) | L2 |
| `segmentInsideRegion / polylineInsideRegion / polygonInsideRegion(…, index?)` | contact parameters from `edgesNear(segBox, eps)` over every ring instead of `splitParamsAgainstRing` over the `ringsNear` rings — `segmentContactParams` yields a parameter only for an edge within eps of the segment, and the parameters are sorted afterwards, so the array is identical; "no edge near → true" replaces "no ring near → true" | L2 |
| `stadiumInsideRegion / discInsideRegion(…, index?)` | the boundary distance queried with `haloMm = halfWidthMm` / `radiusMm`; `Infinity ≥ r − eps` is the same boolean as a true min above `r` | L2 |

## 3. The mode switch

`DrcOptions.broadPhase?: "grid" | "exhaustive"` (default `"grid"`), threaded
`runDrc → buildDrcContext → buildDrcItems(input, { broadPhase, stats })`, carried as
`LegalityContext.broadPhase`. `"exhaustive"` selects, in every check of §4, the pre-S9 enumeration:
the six loops of `checkClearance`, the hole-outer scan of `copperToHolePairs`, the O(H²) loop of
`holePairs`, the per-ring helpers of `boardItems` (and the unindexed geometry functions under it),
the K × items loop of `checkKeepouts`, the i<j loop of `checkCreepage`, and `ALL_PICK` in
`judgeCopperPairs`. Those enumerations are MOVED verbatim into their own functions and dispatched by
the switch — the review gate is a byte-identical move (`git diff --color-moved=dimmed-zebra`), not a
re-implementation. The shared bodies they call (`clearance-judge.ts`, the `judge` closure of
`copperToHolePairs`, the `judgePair` closure of `holePairs`) may gain the results-neutral counter lines of §7 and nothing else; the moved `boardItems`
body carries two `edgeTests` counter lines of its own (its distance sites live inside the moved
block), and `checks/keepouts.ts` extracted its three per-item candidate constructors
(`traceCandidate` / `viaCandidate` / `padCandidate`) so both enumerations build a candidate one way
— the only non-move changes, each diffed against HEAD by the review pass (R1). One shared body DID
change meaning, deliberately and in both modes: `copperToHolePairs` now orients its anchor pair by
anchor key (06 §7), see §11 R1 #1.

Who may select `"exhaustive"`: tests and `scripts/drc-bench.ts`. No environment flag, no HTTP
option, no UI. The HTTP route, the SDK (assistant / MCP), the cloud apply paths and every command
gate run the default.

## 4. Loop inventory

`n` items, `H` holes, `E` boundary edges, `K` keepouts, `S` segments per trace, `V` ring vertices,
`near` the candidates one query returns (a few tens at the measured densities).

| Check | Exhaustive (kept) | Cost | Indexed enumeration | Cost | Identity |
|---|---|---|---|---|---|
| `checkClearance` — six pair loops | `i<j` / nested over the arrays, `farApart` per pair | O(n²) prefilter tests (≈ 37 M at 10k) | trace subjects: `nearPolyline` per other kind; via / pad subjects: `near(kind, bounds, maxClearanceBoundMm)`; symmetric kinds keep `j > i`; the same `farApart` and the same body per pair | O(n · near) | L1 |
| `copperToHolePairs` (batch) | hole-outer scan, `aabbGap` per pair | O(n · H) | subject-outer over `near("holes", bounds, maxHoleBoundMm)` — the S8 gridded branch, enabled for the board | O(n · near) | L1 |
| `holePairs` (batch) | `i<j` over `holes`, no prefilter | O(H²) | `near("holes", holeBounds(i), maxHoleBoundMm)` with `j > i`; the canonical side by key stays | O(H · near) | L1 |
| `boardItems` — edge clearance, off-board, hole edge | per-ring helpers over every ring, containment through the unindexed predicates | O(n · E), pads O(n · V · E) | `regionBoundaryDistance*(…, index, halo)` with the halo per site (§5); containment through the indexed predicates; **unhaloed** where the value is reported without a comparison: a hole not inside the region (`HOLE_OFF_BOARD` message and `measuredMm`), `ringPenetration` of an outside pad vertex | O(n · edgesNear) | L2, L3 |
| `checkKeepouts` / `keepoutItems` | every keepout × every item, `boundsMeet` | O(K · n) | per keepout: `near(kind, keepoutBounds, 0)` for traces, vias, pads in that order, then the placements linearly — the order the check already builds | O(K · near) | same predicate per pair; `KEEPOUT_VIOLATION` is unmeasured and every field but `message` is an id input |
| `checkCreepage` | `i<j` over every copper item whenever any net has a voltage; `aabbGap` after the resolver work | O(n²) | outer loop over items with voltage ≠ 0 in `items` order; candidates by `near` / `nearPolyline` with `maxCreepageBoundMm`, mapped back through recorded per-kind indices; an (HV, HV) pair judged only from the side that is smaller in `(key, ElItem index)` — a TOTAL order, because two copper shapes of one pin share one anchor key (Astra A1 #5); the canonical swap and every skip kept; `aabbGap` hoisted before the resolver work (both branches return null) | O(HV · near) | pair set ⊇ pairs with `aabbGap ≤ required`; drafts canonical by key |
| `judgeCopperPairs` (live and server gate) | `ALL_PICK` | — | `near` / `nearPolyline` (v2 entries) | — | the gate ↔ batch parity suites compare like with like |

Untouched, with owner: `signal-integrity` (its first-wins `>` tie, S14), `outline` cutout pairs
(S12), `zones` O(Z²), pours (S10 budget), connectivity (S1), the area sub-segment products (05 §13),
`ratsnest`.

## 5. Halos

A halo is the one number a query may be made with. Each is an explicit max over every term the
checks compare against, so it bounds every value a pair can resolve to; each is a tested inequality
(§7), not a comment.

| Halo | Terms | Bound argument |
|---|---|---|
| `maxClearanceBoundMm` (S8) | `SHORT_EPS_MM`, `fabMinClearanceMm(fabricator)`, `resolver.clearanceBound(kind, null, null)` for every pair kind, every class's `clearanceMm` | `clearance(kind, layer, a, b).mm = max(explicit rule value or implicitTier(kind, a, b), floor)`; `implicitTier = max(board[kind], class(a).clearanceMm, class(b).clearanceMm)`; `clearanceBound(kind, null, null) = max(board[kind], maxClearanceRuleMm, floor)`; every class value is in the max — so the halo ≥ every resolved value, the fab tier and the short tier |
| `maxHoleBoundMm` (S8) | `SHORT_EPS_MM`, `copperToHoleClearanceMm`, the board `holeToHole` minimum, every `holeToHole` rule (enabled or not), both fab hole floors | enumerated term by term |
| `maxEdgeBoundMm` (new) | `copperToBoardEdgeMm`, `holeToBoardEdgeMm`, every `edgeClearance` rule's `minMm` (enabled or not) | `scalar("edgeClearance", …).mm` is a rule value or the board value |
| `maxCreepageBoundMm` (new) | `ipc2221SpacingMm(max(V ∪ {0}) − min(V ∪ {0}), "B2") + GEOM_EPS_MM`, `V` = every class `voltageV` | the pair value is `u.voltage − v.voltage` with one side possibly 0 V, so the largest difference is max − min over `V ∪ {0}` (not `max|V|`); `ipc2221SpacingMm` is monotone non-decreasing in |ΔV| and B2 ≥ B1 on every band and above 500 V; `strictestSpacing` maxes over `column(layer)` |

Per-site distance halos in `boardItems` (the reported quantity subtracts the copper's own extent):

| Site | Query halo |
|---|---|
| trace edge gap (`polylineToRingEdgeDistance − halfWidthMm`) | `maxEdgeBoundMm + halfWidthMm` |
| via edge gap (`pointToRingEdgeDistance − radiusMm`) | `maxEdgeBoundMm + radiusMm` |
| disc pad edge gap (`− disc.radiusMm`) | `maxEdgeBoundMm + disc.radiusMm` |
| ring pad edge gap (edge to edge) | `maxEdgeBoundMm` |
| hole edge gap (`− radius`), inside the region | `maxEdgeBoundMm + radius` |
| hole not inside; `ringPenetration` | unhaloed (index allowed) |
| containment (`stadiumInsideRegion` / `discInsideRegion`) | `halfWidthMm` / `radiusMm` |

## 6. Determinism

Candidates are ascending indices into the context arrays; `Set` / `Map` iteration is sorted before
it is returned; `oversized` membership is a per-item fact. The report pipeline was already
visit-order-independent (06 §7, 07 §1), so the indexed run and the exhaustive run produce the same
bytes, and the eight array reversals of `drc-determinism.test.ts` produce the same bytes in both
modes. Nothing in S9 introduces a first-wins tie; the one that exists (`signal-integrity.ts`,
`dev > worstGapDev`) is untouched and belongs to S14.

## 7. The oracle harness and the bench

- `DrcOptions.stats?: DrcRunStats` — `{ prefilterTests, pairsJudged: Record<pairKind, number>,
  edgeTests }`, carried on the context, incremented by the enumerations and the shared bodies, off
  by default, never read by a check.
- `helpers/drc-synthetic.ts` — a seeded (LCG) deterministic generator of projections: 45° routing,
  long diagonals (`oversized` entries), coordinates on exact `CELL_MM` multiples, THT pads, NPTH and
  slots, free pads, multi-shape pins, rotated pads, HV classes (incl. negative), area- and
  net-scoped rules, waivers / class ignores / severity overrides (and boards without any), zones on
  one seed, a non-`custom` fabricator, zero-length and single-point traces, items across the board
  edge, holes outside, one board with a non-finite coordinate.
- `drc-broad-phase-oracle.test.ts` — on the six goldens, the determinism fixture and its eight
  reversals, ≥ 12 seeds × 3 sizes and the boundary micro-fixtures (gap exactly at `bound +
  GEOM_EPS`, an item on a cell boundary, an item exactly `halo` from an edge, a trace over the caps,
  an HV pair at the creepage halo, plus Astra A1's list — both sides of every cap, overlapping holes,
  slots outside the board, positive bridge and replacement events, coincident draft ids with
  different witnesses, geometry translated near the coordinate limit, a one-point trace inside a
  keepout, the near-edge PIP case): (i) `drcDrafts(P, { broadPhase: "exhaustive" })` equals
  `drcDrafts(P, {})` as a sorted multiset; (ii) `JSON.stringify(runDrc(…))` equal byte for byte;
  (iii) `grid.pairsJudged ≤ exhaustive.pairsJudged` per kind, strictly less on at least one seed for the
  trace-bearing kinds (`traceToTrace`, `traceToPad`, `traceToVia`) — a box-filed kind (`padToPad`,
  `padToVia`, `viaToVia`) returns exactly the AABB-within-halo set that `farApart` re-derives, so its
  `pairsJudged` are equal by construction and only its `prefilterTests` drop; the four `pourTo*`
  counters are never incremented (pour candidate discovery is S10's) — and
  `grid.prefilterTests < exhaustive.prefilterTests / 10` on the dense seed; (iv) the
  halo inequalities of §5 over every (kind, netA, netB) triple the corpus contains; (v) every
  `DrcRuleCode` (minus `ZONE_FILL_FAILED`) observed across the corpus. The review pass demonstrates
  the oracle is live by a temporary halo mutation that fails it.
- `drc-golden.test.ts` asserts every `.expected.json` in both modes.
- `scripts/drc-bench.ts` — 1k / 5k / 10k / 20k items, both modes, per-check ms and stats. The gate:
  `runDrc` (default, every check, no zones) on the 10k bench board < 300 ms on the reference
  machine; `buildDrcItems` ≤ 60 ms at 10k; the census board ≤ 50 ms. Pour cost is reported
  separately (S10).

Recorded at close (2026-09-09, `bun scripts/drc-bench.ts --items 1000 --items 10000 --golden census`,
this machine, medians of 3; the synthetic boards are `helpers/drc-synthetic.ts` at seed 1, no zones;
the pre-S9 baseline of the plan's own 10k probe was `checkClearance` 1 035 ms, `checkBoard` 2 130 ms,
`runDrc` 3 500 ms):

| board | mode | `buildDrcItems` | `checkClearance` | `checkBoard` | `checkCopperToHole` | `checkElectrical` | `connectivity()` | `runDrc` |
|---|---|---|---|---|---|---|---|---|
| synthetic 1 000 | grid | 3.2 | 5.2 | 3.9 | 1.0 | 13.2 | 5.0 | **24.7** |
| synthetic 1 000 | exhaustive | 1.6 | 19.6 | 14.5 | 1.6 | 13.6 | 2.9 | 51.3 |
| synthetic 10 000 | grid | 14.0 | 48.2 | 25.7 | 9.6 | 10.9 | 31.9 | **195.5** |
| synthetic 10 000 | exhaustive | 11.4 | 1 183.8 | 376.2 | 60.7 | 156.7 | 29.7 | 1 908.7 |
| `golden-census-2l` | grid | 0.4 | 0.4 | 0.3 | 0.05 | 0.03 | 11.3 | **10.9** |
| `golden-census-2l` | exhaustive | 0.4 | 0.4 | 4.2 | 0.04 | 0.04 | 8.6 | 13.1 |

Stats at 1 000 items: `prefilterTests` 638 (grid) vs 324 293 (exhaustive); `pairsJudged` 579 vs
1 177. All three §7 gates hold: `runDrc` 195.5 ms < 300 ms at 10k, `buildDrcItems` 14 ms ≤ 60 ms,
census 10.9 ms ≤ 50 ms. After S9 the largest single stage at 10k is the S1 connectivity sweep
(≈ 32 ms), then `checkClearance` (≈ 48 ms, dominated by the exact kernels on real neighbours).

## 8. Consumers

| Consumer | Query | Note |
|---|---|---|
| Batch checks (§4) | `near` / `nearPolyline` with the §5 halos | default mode |
| `judgeCopperPairs` — live gate, server gate | `nearPolyline` for a subject trace, `near` for a subject via / pad; `ALL_PICK` in exhaustive mode | v2 entries tighten the pending × board candidate set; verdicts unchanged (07 §1) |
| `route-obstacles.ts` | `near(kind, withinBounds, max(maxClearanceBoundMm, maxHoleBoundMm) + routeHalfMm)` | the builder's own halo: every item whose copper can constrain a path inside the window is a rect, whatever the caller padded (the callers' `1 + reach + width` padding stays); an omitted item's copper is farther than `reach + routeHalf` from the window. Trace rects are PER SEGMENT (`trace:<id>:<i>`, one per area sub-segment), each the segment's AABB inflated by `required + halfWidth + routeHalf` — so a dropped trace's rects contain no window point within `required + routeHalf` of its copper, and a path inside the window that avoids the remaining rects still clears it (Astra A1 #2 assumed whole-trace rects; rejected on the source, the argument recorded here). The obstacle set does shrink — a long diagonal's empty AABB corners stop blocking — which the gate confirms legal. |
| `checkPendingCopper` per-item forms | `boardItems` / `holePairs` / `keepoutItems` as §4 | the gate inherits the indexed forms |
| Frontend `usePcbWorkspace` | builds the context (grid v2 + region index) per projection | cost budgeted in §7 |

## 9. Stated limits

- PIP is O(edges in the row band): a comb outline with hundreds of horizontal chords per band is
  linear per point.
- `splitParamsAgainstRing` on the live outline editor and `ringWithinClosed` inside
  `buildBoardRegion` stay unindexed (built once).
- The grid is layer-blind; a per-layer grid is a future knob.
- The area sub-segment products, `ZONE_OVERLAP` O(Z²), the cutout pairs, the fill kernel,
  `signal-integrity`, `ratsnest` are unchanged.
- The server rebuilds the context per envelope (S10).
- `"exhaustive"` is option-only.
- `cellMm` is a `createBroadPhase` option that `buildDrcItems` does not thread through; the bench's
  `--cell` is parsed and reported as ignored. A change of cell size is a bench result, never a
  semantic one.
- `stats.edgeTests` counts distance SITES (per item), not edges: per-edge counting would sit inside
  `board-region.ts`. It is mode-symmetric by construction; the index's win shows in
  `prefilterTests` / `pairsJudged`.
- **Degenerate rings (S9 correction, recorded in 02 §6):** a ring of fewer than two vertices — a
  zero-size cutout or outline canonicalises to one — files no boundary edge. Before S9 `region.edges`
  carried a `(p, p)` edge for it while the per-ring helpers returned `Infinity`, so the region-level
  distances (`stadiumInsideRegion`, `discInsideRegion`) and the per-ring edge distances of
  `boardItems` disagreed on such a board; the index made the disagreement a two-mode divergence
  (WP3). The unindexed `nearRing` still walks the `(p, p)` segment, so the indexed containment test
  delegates to it for such a ring (R1 #2) — containment is unchanged, only the distance functions
  stopped seeing a perimeter that was never one. Such a ring is `BOARD_OUTLINE_INVALID` regardless.
- **The grid's slack is absolute.** `GRID_SLACK_MM = 1e-6` covers the interpolation error of
  `polylinePieces` for coordinates up to ≈ 10¹⁰ mm; the safe-integer bail admits ≈ 1.8 × 10¹⁶ mm.
  Persisted coordinates are integer nanometres within the S2 range (|v| ≤ 1 m), so the gap is not
  reachable; recorded, not closed (R1 #8).
- **`COPPER_TO_HOLE` anchors are canonical since S9.** Before, the pair's anchors were `[copper,
  hole]` in visit order; two coincident drilled free pads produce two drafts under one id that tie
  on every survivor field, so the reported `anchors` followed draft order — unstable under a
  `freePads` reversal in the pre-S9 engine already, and reversed between the two modes. Both modes
  now lead with the smaller anchor key (06 §7); ids, counts and every compared field are unchanged,
  which is why the six goldens (id multisets) did not move.

## 10. Golden and test delta

None expected: every `.expected.json` byte-identical in both modes (`shasum` at the S8 close:
areas `99c49eb3…`, census `abffa9b1…`, cutouts `43fbd513…`, pours `ab245110…`, rules
`ed0705e8…`, small `cd4b962e…`). `drc-legality.test.ts` "the broad phase is a superset" is
rewritten to the §2.1 semantics (`nearPolyline(subject) ⊇ { j : traceTraceGap(subject, j) ≤ halo }`).

## 11. Astra ledger

**A1 — spec-attack, gpt-6-astra, xhigh, prompt-only, 2026-09-09 (11 min).** 7 findings; every one
traced to source before classification.

| # | Finding | Verdict | Where |
|---|---|---|---|
| 1 | A one-point trace files no grid entry (no polyline segment), so a consumer that judges it through the grid drops it | **accepted** — the clearance loops and the creepage items skip `< 2` points, but `keepoutItems` and the polyline query would miss the disc | §2.1 one-point entries; micro-fixture |
| 2 | Geometry-near discovery does not preserve the whole-trace obstacle rectangle | **rejected on the source** — obstacle rects are per SEGMENT (`route-obstacles.ts` L225-253), each inflated by `required + halfWidth + routeHalf`; a dropped trace contributes no rect that touches a window point within reach of its copper | §8 (argument recorded); the existing obstacle-superset path test exercises it |
| 3 | L3 needs the PIP operand orientation, not just the crossing formula: `pointInPolygon` evaluates `(current, previous)`, `region.edges` stores `(current, next)`; the float result can differ (constructed near-edge case) | **accepted** (verified: `pcb-clearance-geometry.ts` L23-25 `a = ring[i]`, `b = ring[j]`, `j = i − 1`) | §2.2 operand rule; parity test on random and constructed points |
| 4 | Finite coordinates do not guarantee safely enumerable cell indices (`2^53 + 1 === 2^53`): a via at `x = 2^54 mm` hangs the cell loop; latent in the S8 grid too | **accepted** — persistence bounds placements (`POSITION_SANITY_MM = 10 000`) but not every primitive; the cap is cheap | §2.1 / §2.2 safe-integer rule |
| 5 | "Judged from the smaller key's side" is not total on equal keys — two shapes of one pin share an anchor key | **accepted** — ownership by `(key, ElItem index)`; equal-key same-net pairs are skipped anyway, corrupted duplicate ids are not | §4 creepage row |
| 6 | The packet omits `maxHoleBoundMm` / `judgePair` / the judge paths, so the halo and omission-neutrality proofs are asserted, not shown | **addressed by evidence** — `maxHoleBoundMm` (S8) enumerates the board minimum, every `holeToHole` rule and both fab floors; the §5 inequalities are property-tested over the corpus (D6a); the bodies compare only against thresholds ≤ halo and bank a bridge only on touching | §5, §7 (iv) |
| 7 | The row-band table has no bound for a long finite edge (5 × 10⁸ postings for a 10⁹ mm edge) | **accepted** — rows and cells capped like items, fail-open | §2.2 |

Survived: the clearance-threshold argument (`maxClearanceRuleMm` bounds every eligible explicit
rule; disabled rules only broaden), the bridge-extension branch (touching ⊆ short-inclusive halo),
L2 with identical operands (strict `<` accumulation must stay — a NaN-propagating `Math.min`
would not preserve the shown behaviour), containment with closed bands and per-ring near tests
(the `0.0094 mm` example), creepage bounds (zero included; B2 dominates; off-stackup layers resolve
to B1 ≤ B2), determinism after draft equality, units. Astra's added fixtures — both sides of every
cap, overlapping holes, outside slots, positive bridge / replacement events, coincident draft ids
with different witnesses, translated geometry near the coordinate limit — go into §7.

**Review passes.** R1 (`reviewer-critical`, WP2 + WP3; 1 500 adversarial boards, 436 008 region-index
sites, 600 gate boards, 500 reversal boards, 3 000 windowed paths — every probe under the session
scratchpad): 2 blockers, 2 majors, 4 minors, all fixed or recorded — (1) `COPPER_TO_HOLE` anchor
orientation (above); (2) a one-vertex OUTER ring diverged between the indexed and unindexed
`nearRing` (delegated, above); (3) `maxCreepageBound` skipped a non-finite `voltageV` instead of
propagating it — a grid-mode false negative on an unreachable input, fixed with `Math.min` /
`Math.max`; (4) `fileItem` summed per-piece cell counts with multiplicity, so a 350 mm straight
trace went `oversized` where the S8 grid indexed it — distinct cells are counted now; (5) the
obstacle halo names `shortFloorMm` explicitly (it was covered by the query slack by accident); (6)
the keepout candidate-constructor extraction, licensed in §3; (7) "three" counter lines was two;
(8) the absolute slack, recorded above. R2 (`reviewer`, WP4): 1 blocker (the draft-level assertion
could silently disable itself when `drcDrafts` was read dynamically — static import now) and 7
majors on harness coverage (no `oversized` entry, no non-finite board, the halo test sampling only
the origin, no `edgeClearance` / `holeToHole` rules in the generator, the multi-shape-pin fixture
not built, the PIP constant off by 1000×, the bench timing the context inside every check) plus
minors — all folded into the harness (§7).

**A2 — adversarial-verify, gpt-6-astra, xhigh, repository-grounded, 2026-09-09 (14 min; 180 000
region comparisons, 45 000 large-coordinate grid probes, 2 800 check comparisons, 20 bridge /
replacement cases, 2 567 obstacle-clearing paths across every fabricator preset — no divergence).**
5 findings, every one traced before classification.

| # | Finding | Verdict | Where |
|---|---|---|---|
| 1 | An unused net class with `voltageV: NaN` shrank the creepage halo to the 2.5 mm NaN band while a finite +400 / −400 V pair needs 4 mm — the grid omitted the pair the exhaustive loop reported (a grid-mode FALSE NEGATIVE; introduced by the R1 #3 fix, which made the NaN propagate instead of being skipped) | **accepted, blocker** — a non-finite voltage anywhere makes the halo `Infinity` (every creepage query fails open); fixture pins the 800 V pair in both modes | §5; `maxCreepageBound` |
| 2 | Equal draft multisets do not guarantee identical bytes for UNMEASURED same-id groups: `finalizeReport` merged the messages but kept the FIRST draft's `locationMm`, so two copper shapes of one pin inside a keepout reported whichever marker the footprint's pad order put first — inherited, identical in both modes | **accepted** (a 06 §6 canonicality defect, not a two-mode divergence) — the survivor keeps the smaller marker (x, then y), the measured group's own last rung; fixture reverses the footprint's pads | 06 §6 note; `finalizeReport` |
| 3 | Reversing `drcRules` changes the report when two enabled rules share a priority | **rejected — already the stated exception** of 06 §7 (equal priorities resolve by array index, the order is part of the rule table's meaning); the packet's quotation had truncated that sentence. An explicit test now documents it | 06 §7 |
| 4 | The "exact boundary" trace-pair fixture separated centrelines by `required + one half width`, so its copper gap was ≈ 0.15 mm, an ordinary interior breach; neither advertised boundary was reached | **accepted** — the fixture now separates by `required + 2 · halfWidth` (± 1 nm) and asserts the realised gap through `traceTraceGap` and the resolved requirement before comparing modes | §7 |
| 5 | An unindexable subject (past the piece cap) was re-cut on every query — per other kind, per check — before failing open; 200 such traces made `checkClearance` 34 ms indexed vs 0.2 ms exhaustive (correct, slow) | **accepted, low** — pieces are memoised per subject (a `WeakMap` on the points array) and a query against an empty kind returns `[]` without cutting | §2.1 |

Astra's suite run reported two failures in the S8 server ↔ live runtime parity tests
("SDK token not registered: DesignerSDK") — an artefact of running them outside the backend
workspace; they pass from `src/core/backend`.
