# Session 1 — physical copper connectivity contract

Status: **done** (2026-09-06; both Astra passes closed, all gates green). Program: `PROGRAM.md` S1. Inventory basis:
`00-ground-truth.md` §4.1 (six connectivity models), §8 (consumers). Owns `OPEN_FINDINGS.md`
B3-1, B3-3, B3-4, B3-5, B3-6.

This document is the authoritative statement of what "electrically connected" means in OpenPCB's
PCB editor. Every consumer — ratsnest, `UNCONNECTED_NET`, `TRACK_DANGLING` / `VIA_DANGLING`,
and later the copper-fill anchoring (S5), routed-length (S14) and routing legality (S8: the live gate is the batch pair kernel, `07-live-parity-contract.md`; S16 for the router) —
must derive its answer from the kernel in `src/shared/pcb-connectivity/`, never from a private
predicate.

Decisions taken by the user before implementation (2026-09-06): semantics = **physical copper
overlap**; GND nets with no pour show airwires like any other net; `integ/trace-drag` is parked
with only the 555 fixture cherry-picked.

## 1. Definition

Two copper items are **connected** if and only if there is a chain of items in which every
adjacent pair

1. belongs to the same net (both `netId`s equal and non-null),
2. shares at least one copper layer, and
3. has overlapping copper on that shared layer — the minimum distance between their copper
   shapes is `≤ CONNECT_EPS_MM`.

A via is one node that occupies every copper layer of its span, so it joins items on any two of
those layers. A pour island is one node whose members are the same-net items whose bare copper
intersects the filled island (the fill kernel's own clipper intersection, the same test that
decides which copper the pour merges with).

Nothing else connects. In particular: no net-name special case (the `GND_NAMES` suppression is
removed), no cross-layer contact without a via, no bounding-box approximation of a pad, and no
"any pour on this layer" shortcut.

## 2. Items and their layers

| Item | Copper layers | Copper geometry (mm) | Source of truth |
|---|---|---|---|
| footprint pad | `resolvePadCopperLayers(pad, placement, validLayers)`: drilled or `*.Cu` → every valid layer; SMD → the declared layer side-flipped for `B.Cu` placements, else the placement side. A pad whose declared copper layer is not on the stackup is **layer-invalid** → no layer. | `padOutlineWorldMm(placement, pad)` ring (shape, pad rotation, placement transform); **circle pads additionally carry an exact disc** and every predicate uses it — the ring is circumscribed and would close gaps of ≈0.2 % · r; oval/roundrect arcs remain circumscribed (S2 residual) | `src/shared/rendering/pad-copper-layers.ts`, `src/shared/pcb-geometry/pad-outline.ts` |
| free pad | `std` → every valid layer; `smd` / `conn` → `[freePad.layer]` (off-stackup → layer-invalid → no layer); `hole` (NPTH) → no copper, no item | `freePadOutlineWorldMm(freePad)` | same |
| trace | `[trace.layer]`; fewer than two points → no item | polyline (`pointsNm` → mm once) with half width `widthMm / 2` | `src/sdks/designer/types.ts` `PcbTrace` |
| via | `viaSpanLayers(fromLayer, toLayer, layerCount)`; an empty or single-layer span is **layer-invalid** → no layer | disc of radius `diameterMm / 2` at `centerMm` | `src/sdks/designer/stackup.ts` |
| pour island | `[layer]` | island rings `[outer, ...holes]` plus the member keys computed by the fill kernel | `src/shared/rendering/copper-fill/copper-fill-geometry.ts` `buildCopperFillIslandMembers` |

Net of a footprint pad = `projection.padNets["<placementId>|<padNumber>"]` (schematic
correlation); of a free pad = `freePad.netId`; of a trace / via = its `netId`; of an island = the
pour net. Items with a null net belong to no net graph — they never join a component and never
manufacture connectivity between named nets (a null-net trace joining two pads leaves their
airwire in place: this is deliberate assignment uncertainty, not a physical claim; DRC reports the
same overlap as a different-net contact, and since S7 a null-net item that touches copper of two
or more known nets is reported as `NET_SHORT_CIRCUIT` — `06-batch-drc-contract.md` §4). Contact records follow today's `dangling.ts` rule,
which is **asymmetric**: a null-net end cap or via is "in contact" with any copper it touches; a
named-net end cap or via is in contact only with same-net copper. Null-net copper never rescues a
named-net stub.

**Degenerate copper is not copper.** A trace of zero width, a via of zero radius, or a pad whose
ring has fewer than three vertices or zero area produces no item (DRC reports the defect through
`TRACE_WIDTH_MIN` / `VIA_DIAMETER_MIN` / structural checks). Such data can never bridge two
components.

**Physical shapes versus logical pins.** A footprint may carry several pads with the same number
(one pin, several copper shapes). Every physical shape is its own item with an injective key
(`pad:` + the JSON tuple `[placementId, padNumber, occurrence]`, occurrence counted in preview
order); the kernel never merges them geometrically. The ratsnest treats all shapes of one
`(placementId, padNumber)` as a single node — the pin — because the component itself joins them.
Pins are enumerated from the records (every correlated pad), so a pin whose copper is degenerate
still appears as an isolated node and keeps its airwire (Astra 9.2 #4). Duplicate trace or via
ids are de-duplicated deterministically in record order (`#2`, …); pour membership binds the
first occurrence only (fail-safe; Astra 9.2 #2).

**Fill-kernel divergence — resolved in S5 (2026-09-08).** The fill kernel no longer has layer
predicates of its own: it classifies the `buildCopperRecords` records of this contract (real
`layerCount`, `resolvedLayers`, `declaredLayerInvalid`, `layerSpanInvalid`, the circumscribed
ring and the exact disc), so a `std` free pad is pour copper on every layer of the stackup and a
via is matched on its resolved span. A layer-invalid record is a different-net obstacle on every
layer of the fill (no phantom merge, no short) — `04-copper-pour-contract.md` §4. The former
`freePadOnLayer` is gone; `viaCrossesLayer` survives only for the canvas.

**Plating assumption.** The data model has no plated/unplated attribute. A drilled footprint pad
and a `*.Cu` pad are treated as plated (vertical conduction through the barrel), as are `std`
free pads. NPTH footprint pads must reach the model without copper; an undrilled `*.Cu` pad
without plating cannot be expressed today. Recorded for S11 (hole model).

### Two layer policies, one geometry

The pad, via and trace geometry is built once (`buildCopperRecords`) and mapped to items under a
named policy:

- **fail-safe** (connectivity): a layer-invalid item occupies no layer. It can never manufacture
  a connection; the worst outcome is an extra airwire. DRC still reports the defect through
  `PAD_LAYER_MISMATCH` / `VIA_LAYER_SPAN`.
- **clamp** (DRC short detection, unchanged): a layer-invalid item is checked on every valid
  layer so its copper cannot escape a short. This is the existing `drc-context.ts` behaviour.

The connectivity graph inside DRC (`ctx.connectivity()`) is always built from fail-safe items,
never from the clamp-policy `ctx.pads` / `ctx.vias`.

## 3. Touch predicates

All predicates come from `src/shared/pcb-geometry/`; none is re-implemented inline. Every pair
is first gated by layer sharing and by an axis-aligned bounding-box test (bounds inflated by
`CONNECT_EPS_MM`). `ε = CONNECT_EPS_MM = 5e-7` mm — half the one-nanometre coordinate quantum,
defined once in `src/shared/pcb-geometry/tolerance.ts`. It exists only to absorb floating-point
noise in the nm→mm conversion and in distance arithmetic (observed error is below 1e-12 mm); it
is **not** a physical allowance. Exact tangency (distance 0 ± noise) connects; the smallest
expressible designed gap (1 nm) is open (Astra 9.2 #8). (The previous `TOUCH_EPS_MM = 1e-3` was a concession to the old
centre-touch approximation and is gone; Astra finding 1.) Consequence, accepted: `CONNECT_EPS_MM`
is now smaller than `SHORT_EPS_MM = 1e-4`, so a 50 nm gap is reported as a dead short when the nets
differ and as an open (airwire) when they match — both verdicts are the conservative one for their
question, and the underlying geometry is a defect either way.

| Pair | Predicate |
|---|---|
| pad – trace | `polylineToPolygonDistance(trace.pointsMm, pad.ring) ≤ hw + ε` |
| trace – trace | `polylineToPolylineDistance(a.pointsMm, b.pointsMm) ≤ hwA + hwB + ε` |
| via – trace | `pointToPolylineDistance(via.center, trace.pointsMm).distance ≤ r + hw + ε` |
| via – pad | `circleToPolygonDistance(via.center, r, pad.ring) ≤ ε` |
| via – via | `hypot(cA − cB) ≤ rA + rB + ε` |
| pad – pad | `polygonToPolygonDistance(a.ring, b.ring) ≤ ε` |
| X – island | membership: `X.key ∈ island.memberKeys` — the fill kernel lists an item when its bare copper has a positive-area clipper intersection with the island **or** its outline is within ε of any island ring (edge-to-edge distance, so a pad sharing an edge with an island, or touching a hole boundary from inside, is a member; Astra finding 5); vias and circle pads are evaluated as exact discs (centre inside the copper or within `r + ε` of a ring; Astra 9.2 #6) |
| island – island | same layer and net, **different pours** (two zones, or zone + board fill): touching when a vertex of one outer ring lies inside the other's copper or any rings are within ε edge-to-edge; islands of one pour are disjoint by construction and never touch (Astra 9.2 #5) |
| point – island (end caps, via discs) | `pointToIslandDistance(p, rings) ≤ radius + ε`, where the distance is 0 when `p` is inside the outer ring and outside every hole ring, else the minimum ring-edge distance |

`pointToIslandDistance` is the only new geometry primitive; it composes `pointInPolygon` and
`pointToRingEdgeDistance`.

## 4. Derived answers (what consumers ask)

| Question | Answer from the kernel | Consumer |
|---|---|---|
| Which pads of net N are already joined by copper? | components of N restricted to pad / free-pad items | ratsnest MST → airwires; `UNCONNECTED_NET` |
| Is this trace endpoint a stub? | the end cap (circle of radius `hw` at the endpoint, on the trace's layer) touches no other same-net item | `TRACK_DANGLING` |
| Does this via connect on enough layers? | per span layer, the via disc touches a same-net pad / trace / island; needs ≥ 2 layers | `VIA_DANGLING` |
| Is this pour island real copper? *(S5)* | its component contains a pad or free pad | `ISOLATED_COPPER_ISLAND` |
| Routed length of a net *(S14)* | walk of the component graph | `checks/length.ts`, SI |

Trace–trace body overlap without endpoint contact unions the two components (the copper is
physically continuous) but leaves the overlapping trace's endpoints dangling — a stub crossing
another trace is still a stub. This is intended. A trace's end cap may also contact the trace's
**own** body when the copper folds back onto it: for a point `q` on a non-incident segment with
Euclidean distance `d = |q − p|` and arc length `s(q)` along the polyline from the endpoint, the
cap self-contacts iff `d ≤ 2·hw + ε` and `s − d > 2·hw`, evaluated at the **farthest** point of
each segment that is still within reach (`s − d` grows monotonically along a segment away from
its nearest point, so the verdict survives collinear subdivision; Astra 9.2 #7). A straight run or
a corner near the end has `s ≈ d` (still a stub); a closed loop or a U-turn that returns within
reach has `s ≫ d` (not a stub). An index-based "exclude the incident segment" rule was tried and rejected because any first
segment shorter than `2·hw` rescued its own cap (Astra finding 6; adversarial review finding 1).

Known limitation, accepted: two coincident same-net traces "contact" each other at their far ends,
so a stub drawn twice is not reported (Astra finding 7). The item model has no copper-union
topology; an overlapping-trace DFM check is the S12 remedy.

## 5. Ratsnest on top of the kernel

- Nets = schematic nets ∪ nets referenced by free pads.
- Nodes = pad and free-pad items of the net; components from the kernel.
- One representative per component: minimum `(worldMm.x, worldMm.y, key)`.
- Prim's MST over representatives sorted by the same order; a segment carries `from` / `to`
  endpoints of type `RatsnestEndpoint` (`pad` or `freePad`).
- No net-name filtering. With a copper fill enabled, `pcb-projection.ts` already pours the GND
  net on every enabled layer, so GND collapses geometrically; with fill disabled, GND airwires and
  one `UNCONNECTED_NET` error appear, exactly as for any other net.

## 6. Determinism and complexity

- Items are sorted by key before the union-find; components are sorted by their minimum key;
  representatives, MST order and segment output are fully ordered. A test shuffles every input
  array and asserts byte-identical output.
- Pour islands are sorted by `(minX, minY, areaMm2, maxX, maxY, vertex count, canonical outer
  ring)` before indexing — a total order — so island keys never depend on clipper's internal order
  (the canonical ring starts at the lexicographically smallest vertex; Astra finding 12). Keys
  carry the pour ordinal as well as the island index, so two pours on one layer and net never
  collide (Astra 9.2 #5).
- Per net: candidates are found by a per-layer sweep over bounds sorted by `minX`; the exact
  predicate runs only on overlapping bounds. Measured motivation: 200 same-net 48-gon pads take
  2.7 s all-pairs versus 1 ms with the bounds gate. A perf regression test holds a 300-pad +
  300-trace net under a wall-clock budget.

## 7. Product consequences (release-note items)

- Unrouted GND with no GND pour now shows airwires and an `UNCONNECTED_NET` error.
- `pcb.padShapeConnectivity` (dev flag) is retired: exact pad rings replace the AABB test, which
  also corrects a defect (`padWorldHalfExtentsMm` ignored the pad's own rotation).
- A trace endpoint that overlaps a sibling's copper without touching its centreline now connects.
- GND airwires reach the cloud autoroute target list unless the net is excluded (recorded as an
  open product question for the cloud session).
- Free-pad airwires are omitted from the cloud target list (the generated `RatsnestTarget`
  contract has footprint-pad endpoints only); the snapshot reports how many were omitted.

## 8. Expected golden delta (`golden-small-2l.expected.json`)

Predicted before implementation by replaying the contract over the fixture:

| Code | Before | After | Why |
|---|---|---|---|
| `UNCONNECTED_NET` | 7 | 8 | `gnd` is no longer name-suppressed: pad components `{U1\|10, J1\|10}`, `{J2\|10}`, `{tp2}` → two airwires, one violation |
| `TRACK_DANGLING` | 7 | 7 | unchanged under the end-cap predicate |
| `VIA_DANGLING` | 2 | 2 | unchanged |
| errors | 12 | 13 | the new `UNCONNECTED_NET` |
| violation ids | 29 | 30 | `UNCONNECTED_NET` ids hash `code + netId` only, so the seven existing ids are stable |

`vcc` keeps two airwires for a different reason: `U1|9` now joins `{J1|9, R1|1 … R4|1}` because
trace `t16`'s endpoint lies inside `U1|9`'s ring (0.7 mm off centre, missed by the old
centre-touch test), while free pad `tp1` is admitted as a new component. Any deviation from this
table during implementation must be explained here before the expected file is refreshed.

## 9. Astra ledger

### 9.1 `spec-attack` — 2026-09-06, gpt-6-astra, xhigh, prompt-only

Run from an empty scratch directory; the packet was the contract above plus the current
`ratsnest.ts` / `dangling.ts` excerpts. Codex nevertheless read repository files on its own
initiative (read-only sandbox); nothing was written. Verdict: "the proposal fails the completeness
proof" with 14 findings. Disposition after verification against source:

| # | Finding (Astra) | Disposition | Evidence / action |
|---|---|---|---|
| 1 | ε = 1 µm turns designed sub-micron gaps into connections | **accepted** | ε → `1e-6` (float-noise only), §3 |
| 2 | Layer occupancy ≠ vertical conduction (undrilled `*.Cu`, unplated drills) | **accepted as documented assumption**, owner S11 | no plating attribute in the data model; §2 "Plating assumption" |
| 3 | NPTH / cutout voids can sever a trace the graph keeps whole | **rejected for S1**, filed | connectivity models designed copper; DRC today has **no** copper-over-NPTH check (`HOLE_TO_HOLE`, `HOLE_TO_BOARD_EDGE` only) — filed for S11; cutout crossing is B4-1 (S2) |
| 4 | Point/corner contact has zero conductive neck | **rejected for S1**, filed | topological contact is connection; neck width is a DFM sliver check (S12) |
| 5 | Area-only island membership misses shared-edge contact | **accepted** | membership = positive-area intersection **or** edge distance ≤ ε, §3 |
| 6 | Whole-trace self-exclusion makes a closed loop dangling | **accepted** | exclude only the incident segment, §4 |
| 7 | Duplicate coincident traces hide a stub | **accepted as limitation**, filed S12 | item model has no union topology; same in KiCad's item model; §4 |
| 8 | Null-net exclusion → false opens; wildcard rule misdescribed | **accepted** (wording + rule) | asymmetric contact rule restored; false open is deliberate assignment uncertainty, §2 |
| 9 | Zero-width copper can bridge | **accepted** | degenerate items dropped, §2 |
| 10 | Same-numbered pads alias under one key | **accepted** | unique physical keys; logical-pin union in the ratsnest, §2 |
| 11 | Float noise flips a verdict exactly at the ε boundary | **rejected as immaterial** | instability only at gap = ε exactly (1 nm), observed error 9e-16 mm; JS IEEE arithmetic is deterministic for identical inputs |
| 12 | Island sort lacks a total tie-break | **accepted** | total order, §6 |
| 13 | Sweep keeps quadratic worst cases (coincident traces, long horizontals) | **accepted-noted**, owner S9 | perf test in place; segment-level indexing is the S9 broad-phase work |
| 14 | Component graph is insufficient for routed-length walks | **noted**, owner S14 | contact records will need contact locations; not an S1 consumer |

Astra also confirmed: via span / side-flip / free-pad layer rules sound; island-hole distance
correct; the two-policy split is not contradictory (a short and an open on the same copper are
both conservative); determinism argument holds; no nm/mm mismatch in the predicates.

### 9.1a Adversarial review of the kernel (Claude reviewer-critical, 2026-09-06)

Ran alongside the spec-attack; 80 random adversarial boards (4/6-layer, coincident items,
rotations, pours with holes) matched an all-pairs brute force byte-for-byte; determinism under
permutation held; perf 1.3 ms for 300 pads + 300 traces, 41 ms for a 5000-member pour. Findings:
(1) index-based self-contact rescued short first segments → replaced by the fold-back rule in §4;
(2) pour-membership union lacked a layer / fail-safe guard → guard added in `computeConnectivity`;
(3) `std` free pads invisible to inner-layer pours → recorded above for S5; (4) a free pad on a
non-copper layer fell to `F.Cu` instead of layer-invalid → fixed; (5) `DrcContext` aliases record
arrays → copies at the DRC boundary; (6) ε < `SHORT_EPS_MM` asymmetry → documented in §3.
Also confirmed 618 of 4000 vendored KiCad footprints repeat pad numbers, so the unique-key rule
in §2 is exercised by real data.

### 9.2 `adversarial-verify` — 2026-09-06, gpt-6-astra, xhigh, repository-grounded (read-only)

Eight counterexamples, all reproduced by Astra with read-only Bun probes against the working tree
and all confirmed against source. Disposition:

| # | Finding (Astra) | Disposition | Action |
|---|---|---|---|
| 1 | Circumscribed circle-pad polygons close a real 1 µm gap (blocker) | **accepted** | circle pads carry an exact disc; every predicate uses it; oval/roundrect arcs stay circumscribed (S2 residual, ≈0.2 % of arc radius) |
| 2 | Duplicate trace ids → last-write-wins membership, order-dependent verdict | **accepted** | keys de-duplicated deterministically in record order (`#2`, …); membership binds the first occurrence (fail-safe) |
| 3 | Occurrence suffix collides with a literal pad number `"1#2"` | **accepted** | injective key `pad:[placementId, padNumber, occurrence]` |
| 4 | A degenerate pad shape drops its pin from open-net checking | **accepted** | ratsnest pins come from records (all correlated pads), not from surviving items; a pin without copper is an isolated node |
| 5 | Overlapping same-net zones stay disconnected; pour keys collide across pours | **accepted** | pour keys include the pour ordinal; pour–pour touch (different pours, same layer+net) unions overlapping islands |
| 6 | Via/circle-pad island membership uses an inscribed polygon, contradicting the exact contact predicate | **accepted** | membership for discs evaluated exactly in the fill kernel |
| 7 | Fold-back rule tested at each segment's nearest point only; a collinear waypoint flips the verdict | **accepted** | evaluate at the farthest in-reach point of the segment (`s − d` is monotone along it) |
| 8 | Inclusive ε = 1 nm still accepts a designed 1 nm gap | **accepted** | `CONNECT_EPS_MM = 5e-7` (half the coordinate quantum): exact tangency connects, the smallest expressible gap is open |

Astra also confirmed the B3-1/3/4/5/6 mechanisms are addressed and that the golden delta is
consistent with the semantics (it could not independently re-derive the fixture).

## 10. Session checklist

- [x] WP0 baseline recorded 2026-09-06: backend 1321 pass / 8 skip / 17 todo / 22 fail (all library + assistant, same set as S0); `tsc -b` 42 errors (all pre-existing, outside the program)
- [x] WP1 contract + Astra spec-attack ledger (§9.1; 8 accepted findings applied)
- [x] WP2 kernel (`src/shared/pcb-connectivity/`), tolerance move, fill-kernel members, unit tests (52 Bun tests; adversarial review §9.1a; amendments A–J applied)
- [x] WP3 `drc-context.ts` on shared records (golden byte-identical, verified by probe diff)
- [x] WP4 `RatsnestSegment` shape, ratsnest rewrite (`board-connectivity.ts` + MST over kernel components), flag retirement, pad-net fallback removal; B3-1/3/4/5/6 flipped live; golden delta measured = §8
- [x] WP5 `dangling.ts` on the kernel (`ctx.connectivity()` memo from fail-safe items; golden dangling ids unchanged; 8 new kernel-dangling tests)
- [x] WP6 tests rewritten, B3-1/3/4/5/6 flipped, golden refreshed 2026-09-06 (delta = §8 exactly: +1 `UNCONNECTED_NET` for GND, errors 12→13, ids 29→30); gates: backend 1396 pass / 22 baseline fail (same set) / 12 todo, `tsc -b --force` 42, Vitest 48 files / 347, contracts up to date
- [x] WP7 Astra adversarial-verify ledger (§9.2; 8 findings, all accepted and fixed; gates re-run green)
- [x] WP8 docs (`OPEN_FINDINGS` §1 resolved + census 12, `00-ground-truth` §1/§4.1/§8/§10, `PROGRAM` status + decisions, `designer/AGENTS.md` connectivity invariant, skill scope + invariants, `CLAUDE.md` layout, `TODO.md`)
