# Session 5 — copper-pour contract

> Status: **S5 complete (2026-09-08) — implemented, both Astra runs and two review passes folded (§15)**. Owner: S5. This file defines what
> generated pour copper *is* — as sets, with the flattening bias of every polygon named — and which
> answer every consumer must give. It consumes the S1 connectivity contract
> (`01-connectivity-contract.md`), the S2 geometry contract (`02-geometry-contract.md`) and the S3a
> zone/keepout contract (`03-zone-keepout-contract.md`); it does not redefine any of them. Where
> this file and the fill kernel disagree, the kernel is wrong until the ledger (§15) says otherwise.

## 0. Scope and non-goals

In scope: the copper a zone produces (extent, obstacles, clearances, thermals, minimum width,
islands, removal), the electrical status of that copper (S1), precedence between zones on one
layer (S3a §5, enforced here), zone holes, and the parity of every consumer — canvas, 3D, Gerber,
cloud snapshot, connectivity, DRC, trace cleanup. Owns `OPEN_FINDINGS` B3-9 and B3-10.

Out of scope, recorded as limits (§13): scoped `PcbDrcRule` clearances in the fill (S6; the net-class tier IS in, §5), the
`0.5 mm` fill-clearance floor (S6), execution off the main thread (S10, contract 09), spatial
acceleration (S9), Gerber true arcs (S12). The NPTH halo covers every non-plated drill since S11
(footprint `np_thru_hole` pads included — contract 10 §1.1 / §8), and an unplated pad's copper
ring is never a pour member (contract 10 §2.4).

## 1. Vocabulary

| term | meaning |
|---|---|
| pour | the copper one effective zone (`EffectiveCopperZone`, S3a §3.1) produces on its layer |
| extent | the region the pour may occupy before obstacles: board region inset by the edge clearance, clipped to the zone polygon (minus its holes), minus higher-precedence zones, minus `copperPour` keepouts |
| obstacle | copper of another net (or of no net, or of unknown layer) that the pour must keep `clearance` away from; the *halo* is the obstacle inflated by the clearance |
| same-net copper | copper of the pour's net that the pour floods over (`solid`), bridges (`thermal`) or — for `none` — treats as an obstacle |
| island | one connected component of the final fill, `[outer, ...holes]` |
| attached | an island whose copper touches same-net bare copper — the island-*removal* criterion (§8). Not an electrical claim |
| member | a same-net item whose copper intersects or abuts an island (S1 §3, `memberKeys`) |
| real / dead island | S1 verdict: an island is real iff its connectivity component contains a pad or free pad; else dead (§10) |
| kernel | `src/shared/rendering/copper-fill/` (`copper-fill-geometry.ts`, `copper-geometry-kernel.ts`, `copper-fill-trace-geometry.ts`), clipper2, `PRECISION = 4` (0.1 µm output grid), `ARC_TOLERANCE_MM = 0.005` |

Coordinate domain: every input to the kernel is millimetres (traces are converted from integer
nanometres once, by the projection). Every output ring is quantised to the 0.1 µm grid. Eps
regime: `GEOM_EPS_MM = 5e-7` for predicates (S2), `CONNECT_EPS_MM = GEOM_EPS_MM` for membership
(S1), `CLEARANCE_SAFETY_EPS_MM = 2 · ARC_TOLERANCE_MM = 0.01 mm` added to every clipper round
offset (halo, extent inset, zone exclusion) to cover the offset's own chord error.

## 2. Inputs — nothing is re-derived

| input | source | the kernel may not |
|---|---|---|
| copper items (pads, free pads, traces, vias) with resolved layers, `declaredLayerInvalid` / `layerSpanInvalid`, circumscribed ring, exact disc, drill | `buildCopperRecords` (`src/shared/pcb-connectivity/copper-records.ts`, S1) built with the board's real `layerCount` | build its own pad polygon, its own layer set, or resolve a via span by global index |
| board region `R_poly` (outer + cutout rings, inward-biased so `R_poly ⊆ R_true`) | `buildBoardRegion(outline, cutouts, { bias: "board-inner" })` (S2) | inset a parametric outline analytically |
| effective zones and keepouts | `collectCopperZones` / `collectKeepouts` (S3a) | filter, sort or re-validate rows |
| zone parameters | `pourParamsForZone(zone, designRules, keepouts, zones)` — the ONE composition (S3a §6); the fourth argument is the effective list of the same projection and is required (parity by the compiler, S4 §13.3) | default any of them |
| pad → net | `projection.padNets` (S1: written by the projection loader, authoritative) | correlate schematic and PCB itself |

`CopperFillPourParams` therefore carries `layerCount` (required), optionally a pre-built
`records: CopperRecords` (DRC builds them once), the board `outline` + `cutouts`, the zone slice
from `pourParamsForZone`, and `copperToBoardEdgeMm`.

## 3. The pipeline, as sets

For one effective zone `Z` on layer `L` with net `N` (possibly `null`), resolved clearance `c`
(§5), resolved minimum width `w` (§7):

1. **Extent₀** `= offset(R_poly, −(e + ε))`, `e = copperToBoardEdgeMm`, `ε = CLEARANCE_SAFETY_EPS_MM`,
   applied to the whole polygon-with-holes in one round offset (the outer ring shrinks, every
   cutout ring grows). `R_poly ⊆ R_true` and the offset over-clears by `ε`, so
   `Extent₀ ⊆ R_true − e` (no copper closer than `e` to a true board edge or cutout). A region
   ring the S2 builder could only flatten unbiased (`fallbacks`) is accepted and reported as a
   warning, and the inset grows by a further `0.01 mm` for that pour (`ε_fallback`): the
   unbiased chord error (≤ 0.01) and the offset's own chord error (≤ 0.005) plus one output
   rounding (≤ q/√2) do not fit inside one `ε` (Astra run 1 #2).
2. **Extent₁** `= Extent₀ ∩ (int(P_Z) − ∪ int(H_i))` for a polygon zone with outer ring `P_Z` and
   hole rings `H_i` (§11); the board zone skips this step. Exact up to quantisation: a zone's own
   outline has no clearance — copper reaches the drawn line (KiCad semantics for zone outlines
   and cutouts — *needs verification*; the alternative reading, outline inset by `w/2`, is not
   adopted). **Conservative quantisation rule** (Astra run 1 #2): every *forbidden* region — a
   hole, a keepout, another zone's exclusion, an obstacle halo — is inflated by one output grid
   step `q = 10^-PRECISION` before it is subtracted, and the *allowed* outer ring is deflated by
   `q` before it clips; nearest-grid rounding moves a vertex by at most `q/√2 < q`, so rounded
   copper never lands inside a forbidden region or outside the drawn outline.
3. **Extent₂** `= Extent₁ − ∪ offset(P_{Z'}, c_{ZZ'} + ε)` over every other effective zone `Z'` on
   `L` with `net(Z') ≠ net(Z)` (`null ≠` any id; two `null`s are equal) and
   `priority(Z') ≥ priority(Z)`, `c_{ZZ'} = max(c_Z, c_{Z'})`. Board zones carry priority `−1`
   (S3a §3.1), so every explicit zone of another net carves the plane and nothing carves an
   explicit zone from below. Equal priority carves both ways; the contested area and a `c` band
   around it belong to neither fill (S3a §5). Computed from the immutable polygons `P_{Z'}` (not
   their fills), so the result is independent of evaluation order. Zone holes of `Z'` do not
   reduce the exclusion (conservative: less copper). Priority domain: explicit zones carry an
   integer `≥ 0` (`normalisePriority`, S3a §2 — negative and fractional values are normalised on
   read), board zones exactly `−1`; the numeric comparison therefore never inverts the S3a
   board-below-explicit rule (Astra run 1 #12, rejected as already guaranteed, recorded).
4. **Extent₃** `= Extent₂ − ∪ offset(K_j, 10^{−PRECISION})` over every enabled keepout with
   `copperPour` on `L` (S3a §4, one output-grid step so rounding never lands inside), then the
   aesthetic remove-only fillet (`cornerRadiusMm`, anti-extensive, cannot add copper).
5. **Obstacles** `O = ∪ shape(x)` over every record `x` classified *different-net* on `L` (§4);
   **halo** `Hₒ = ∪_v offset(O_v, v + ε)` where `O_v` groups the obstacles whose resolved
   clearance (§5: per item net) is `v`. **Apertures** `A = ∪ drill discs` of every plated hole on
   `L` (pads with `drillMm > 0`, vias; the drill, not the annulus) and every NPTH (free holes,
   `hole`-type free pads); **NPTH halo** `H_n = offset(NPTH discs, e + ε)` (§5). **Thermal
   knockouts** `T = ∪ (offset(pad, g) − pad − spokes)` for every same-net pad resolved `thermal`
   (§6).
6. **Raw** `= Extent₃ − (Hₒ ∪ A ∪ H_n ∪ T)`.
7. **Fill** `= (open_{w}(Raw) ∩ Raw ∩ Extent₃) − (Hₒ ∪ A ∪ H_n ∪ T)` — the minimum-width pass
   (§7) re-clipped so it can neither leave the extent nor re-enter a void.
8. **Islands** `= components(Fill)` via clipper's polytree, each `[outer, ...holes]`, quantised,
   outer CCW / holes CW, in the total order of §8.
9. **Kept islands** `= { I : area(I) ≥ minArea ∨ attached(I) }` (§8).

Every step is a clipper boolean or offset. **Every clipper operation reports its own outcome**:
an exception inside any union / difference / intersection / offset — including the thermal
knockout's difference and the Gerber union — makes the whole pour (or the whole layer, for the
Gerber) **`failed`** (§8); the primitives no longer swallow a throw into `[]` (Astra run 1 #9).
An *empty* result is always a legitimate geometric answer: an erosion (negative offset) or a
difference may empty a set; a union of validated positive-area inputs or a positive dilation of
a non-empty set cannot, and those two cases are also `failed` (Astra run 1 #8).

## 4. Obstacle classification (per record, per layer)

Records come from `buildCopperRecords` with the board's real stackup. For layer `L` and pour net
`N`:

| record state | class on `L` |
|---|---|
| copper not on `L` (pad `resolvedLayers ∌ L`, via `span ∌ L`, trace `layer ≠ L`) and no invalid flag | ignored |
| `declaredLayerInvalid` (pad named a layer off the stackup) or `layerSpanInvalid` (via span resolves to < 2 valid layers) | **different-net obstacle on every copper layer** — its true position is unknown, so it may neither merge (no phantom connectivity) nor be flooded (no short). The structural DRC codes own the report; the pour only refuses to guess |
| `netId === N`, `N ≠ null`, pad connection resolves to `solid` | same-net: flooded, anchor, member |
| `netId === N`, pad connection resolves to `thermal` | same-net: anchor, member, plus a thermal knockout (§6) |
| `netId === N`, pad connection resolves to `none` (explicit `none`, or `thruHoleThermal` on a pad with `drillMm = 0`) | different-net obstacle (S3a §6: the zone disconnects the pad; connectivity then reports what is true) |
| `netId === N` trace or via | same-net (pad connection modes apply to pads only; vias flood solid) |
| any other `netId`, or `netId === null`, or `N === null` | different-net obstacle; `null` never equals `null` |

Pad connection resolution (`resolvePadConnection`): `none → none`, `thermal → thermal`,
`thruHoleThermal → thermal if drillMm > 0 else none`, otherwise `solid`. A `std` free pad is
drilled by definition (S3a). Degenerate records are not records (S1 §2) and never reach this table.

**Shape and bias.** A pad is its record `ring` — `padOutlineWorldMm`, which circumscribes arcs
(`sec(π/48)`), so the shape is a superset of the copper: an obstacle halo is never short, and
flooding a same-net pad with a slightly larger polygon adds copper only where copper already is.
A via is the disc of radius `r_via` sampled circumscribed (`buildDiscRing` at
`VIA_MAX_ERROR_MM = 0.005`, vertices pushed to `r · sec(π/n)`). A trace is its stadium chain
(`buildTraceSegmentStadium` with `circumscribed`: caps at `TRACE_CAP_SEGMENTS = 16` as a tangent
chain — vertices at the half-step angles pushed to `r · sec(π/2n)`, continuing the exact flat
sides). Drill apertures are circumscribed discs.
Membership (§8) uses the exact `disc` for true circles and the ring otherwise, exactly as S1 §3.
The circumscribed ring of an oval / roundrect / stadium pad exceeds the true copper by
`r·(sec(π/48) − 1) ≈ 0.2146 %` of the arc radius; membership on that ring can therefore call a
fill that ends inside that band (≤ 2.1 µm for `r = 1 mm`) a contact — the same residual S1 and S2
accepted for connectivity and DRC, kept here for parity with S1 rather than fixed with a second
pad geometry; exact discs for TRUE circles landed in DRC in S7 (`06-batch-drc-contract.md` §2), exact arcs for ovals / roundrects are S11's (Astra run 1 #3, accepted as the recorded S1 limit).

## 5. Clearances

| gap | value (mm) | notes |
|---|---|---|
| pour ↔ different-net copper of net `M` | **S6:** `c(M) = max(zone.clearanceMm ?? 0, R(pourTo<kind(M)>, L, N, M))` where `R` is the one rule resolver (`05-rule-semantics-contract.md` §6): implicit tier `max(pourToCopperMm ?? 0.5, traceTo<kind>Mm, class(N), class(M))`, an explicit rule only through a `pairKind` scope naming the pour kind, area scopes never relax a pour, floor last | S3a §6 tighten-only. Before S6: `max(c_zone, class(N), class(M), floor)` with `c_zone = max(zone.clearanceMm ?? 0, max(0.5, traceToTrace, traceToPad, padToPad, traceToVia))` — one blunt maximum for every obstacle kind; the 0.5 constant became the board rule `pourToCopperMm` (absent = 0.5) |
| pour ↔ board edge / cutout | `e = copperToBoardEdgeMm` | via the extent (§3.1) |
| pour ↔ NPTH | `copperToHoleMm ?? e` | `clearance.copperToHoleMm` since S7, the edge rule as its default; since S11 the halo also covers non-plated FOOTPRINT drills (`footprintPadDrill`, contract 10 §8) |
| pour ↔ plated drill | 0 beyond the drill disc | the annulus is the pad's own copper |
| pour ↔ `copperPour` keepout | 0 (+ one grid step) | S3a §4 |
| pour ↔ other zone (different net) | `max(Z.clearanceMm ?? 0, Z'.clearanceMm ?? 0, R(pourToPour, L, net Z, net Z'))` around the other zone's *polygon* (S6, symmetric by construction) | §3.3, `05-rule-semantics-contract.md` §6 |
| pour ↔ own zone outline / hole | 0 | §3.2 |

Every round offset adds `ε = 0.01 mm`. **Lower bound** (the guarantee): every manufactured gap is
`≥ value + ε − a − q/√2 ≈ value + 0.0049 mm` where `a = ARC_TOLERANCE_MM` is the offset's chord
error and `q/√2` one output rounding — i.e. never below the value. There is **no useful upper
bound**: a circumscribed pad ring adds up to `r·0.2146 %` (21 µm at `r = 10 mm`), min-width
removal and precedence remove more copper still (Astra run 1 #13). Scoped rules enter only through
an explicit pour `pairKind` scope (S6).

## 6. Thermal relief

For a same-net pad resolved `thermal` (footprint pad or free pad): knockout
`= offset(pad, g) − pad − ∪ spokes`, `g = zone.thermal.gapMm ?? 0.4`, spokes = `n` stadiums of
half-width `s/2`, `s = max(w, zone.thermal.spokeWidthMm ?? 0.4)` (a spoke thinner than the
minimum width would be erased by §7 and silently isolate the pad), from the pad centre to a reach
that clears `offset(pad, g)` (the pad's circumscribed radius `+ g + s`).

**Frame.** Spokes are laid out in the **pad-local frame**: angle `θ_i = θ₀ + i · 360/n` measured
from the pad's local x-axis, rotated by the pad's world rotation (placement rotation + pad
rotation, mirrored for a bottom-side placement), then translated to the world centre. The
current kernel uses a fixed world angle, which on a rotated rectangular or oval pad aims the
spokes at corners and can leave the pad unbridged — that is the defect this section fixes.

**Defaults.** `n = 4`, `θ₀ = 90°` (spokes cross the edge midpoints of a rect / roundrect / oval
pad; on a circle every angle is equivalent), `g = 0.4`, `s = 0.4`. Astra run 1 is asked what
KiCad and fabrication guidance use; those answers are marked *needs verification* and the
defaults follow them only after a source check. The IPC-2221 note in the kernel ("2–4 spokes,
0.2–0.5 mm") is the only cited standard and is not a manufacturing constant this file invents.

**Guarantee.** A spoke bridges iff its stadium reaches from inside the pad ring to outside
`offset(pad, g)` and no different-net halo, aperture or keepout removes the bridge. When a spoke
is blocked the pad simply has fewer bridges; when every spoke is blocked the pad is not a member
of the island and S1 reports the open (`UNCONNECTED_NET`). The kernel makes no attempt to rotate
or relocate spokes to find a free bridge (stated limit). A spoke that a foreign halo narrows
below `w` is removed by §7 like any other neck (Astra run 1 Q7). Where two same-net zones overlap
on one pad with different pad-connection modes, the union of their copper is what is manufactured
— a `solid` zone over a `thermal` zone floods the relief (Astra run 1 Q6, recorded).

`trapezoid` / `custom` pads use their record ring (a bounding rectangle for `custom`, S11);
spokes are placed on that ring's frame.

## 7. Minimum width

`w = max(designRules.minimums.traceWidthMm, zone.minWidthMm ?? 0)` (S3a §6). The pass is
`open_w(Raw) = offset_round(offset_chamfer(Raw, −(w/2 − 0.001)), +(w/2 − 0.001))`, then
re-clipped as in §3.7. **Guarantee:** the fill of one pour is a union of discs of radius
`w/2 − 0.001 mm` (the morphological opening), so every copper point lies in a disc of that radius
inside the fill — an isolated neck or sliver thinner than `w − 0.002 mm` cannot survive. That is
weaker than "no local width below `w`": where two fat lobes come within `w` of each other, the
re-inflated discs of both lobes can re-join through a neck of the original polygon narrower than
`w` (Astra run 2 #3 — a diagonal 0.49 mm neck between two lobes at `w = 1`). The kernel does not
enforce a minimum *connection* width; that is a DRC check on the final copper (S12, with the
same-net union case of #7 below). For `w ≤ 0.002 mm` the pass is skipped. After the pass every ring
whose area is `< DEGENERATE_AREA_MM2` is discarded regardless of `islandRemoval` (a degenerate
sliver is not copper, S1 §2). Thermal spokes are at least `w` wide (§6). **Limit:** the union of
two *same-net* pours can contain a neck narrower than `w` where their independently-opened
boundaries overlap (Astra run 1 #7) — the S12 copper-sliver / minimum-connection check owns the
union; the fill does not re-open the union because the union is not a pour.

## 8. Islands — result and failure contract

```ts
interface CopperFillIsland {
  rings: PcbPointMm[][];      // [outer CCW, ...holes CW], quantised to the 0.1 µm grid
  areaMm2: number;            // |outer| − Σ|holes|
  centerMm: PcbPointMm;       // area centroid of the outer ring
  memberKeys: string[];       // sorted S1 item keys (pad:/freepad:/trace:/via:)
  attached: boolean;          // touches same-net bare copper (removal criterion)
}
type CopperFillResult =
  | { status: "ok"; islands: CopperFillIsland[]; warnings: CopperFillWarning[] }
  | { status: "failed"; reason: string; islands: []; warnings: CopperFillWarning[] };
function buildCopperFillIslands(params: CopperFillPourParams): CopperFillResult;
```

- **Total order.** Islands are sorted by `(minX, minY, areaMm2, maxX, maxY, vertexCount,
  canonical outer ring)` (S1 §6, `sortCopperFillIslands`) inside the kernel, so *every* consumer
  sees the same order and the island index in a pour key `pour:<layer>:<net>:<pourIndex>:<i>` is
  a function of the geometry alone. Clipper's traversal order is never exposed.
- **Membership.** `memberKeys` per S1 §3: positive-area intersection with the island, or edge
  distance `≤ CONNECT_EPS_MM`; vias and true-circle pads on their exact disc. Unchanged.
- **`attached`** `= memberKeys.length > 0` — the island has at least one same-net member under
  the S1 membership rule (positive-area intersection **or** edge distance `≤ CONNECT_EPS_MM`,
  exact discs). The former positive-area-only test dropped an island that touched a pad along a
  shared edge (Astra run 1 #4a). It is the criterion of §3.9 (KiCad's island-removal semantics)
  and deliberately *not* the electrical verdict: a floating same-net trace stub keeps its island
  (the copper is manufactured), and §10 then reports the island as dead. Removal is a single
  pass per pour; there is no fill → connectivity → refill loop. **Limit** (Astra run 1 #4b): an
  island below the area limit that touches no bare item but overlaps a *kept* island of another
  same-net zone is still removed — per-pour removal cannot see other pours' fills; the direction
  is less copper and connectivity is computed on what is kept, so no phantom connection results.
- **Canonical form** (Astra run 1 #11): every ring starts at its lexicographically smallest
  `(x, y)` vertex; the outer ring is CCW, holes CW; holes are ordered by the same canonical key
  as islands; `areaMm2` and `centerMm` are accumulated in that fixed order; warnings are sorted.
  Byte-identical output under input permutation is a tested property, not an assumption.
- **`failed`.** Any exception inside any clipper operation of the pipeline (the primitives
  rethrow a typed `CopperKernelError` instead of returning `[]`), a union of validated
  positive-area inputs that returns empty, or a positive dilation of a non-empty set that
  returns empty — becomes `status: "failed"` with a reason. The consumers then produce **no copper
  for that zone** (fail-closed) and the DRC reports `ZONE_FILL_FAILED` (§10), so a bail is never
  mistaken for an empty extent, and a lost thermal knockout can no longer flood a pad solid
  (Astra run 1 #9). An empty `Extent`, `Raw` or `Fill` for geometric reasons (the zone lies
  off-board, the edge inset consumes a tiny board, the min-width erosion empties a thin strip,
  everything is inside halos) is `ok` with zero islands → `ZONE_EMPTY_FILL` (Astra run 1 #8).
- **Views.** `buildCopperFillPourPaths(params)` → `rings[]` of an `ok` result (`[]` on failure —
  callers that must distinguish use the result); `islandsToShapes(islands)` lives in the
  frontend-only `copper-fill-shapes.ts` and is the only place `three` is imported. The former
  `buildCopperFillIslandReport`, `buildCopperFillIslandMembers`, `buildCopperFillPadGroups`,
  `toShapes` and `CopperIsland.shape` are gone.

## 9. Consumers — one copper

| consumer | reads | may add | may not |
|---|---|---|---|
| canvas `CopperFillLayer` / `PcbScene` | `buildCopperFillIslands` per effective zone → `islandsToShapes` | paint order | recompute obstacles, filter islands |
| 3D `CopperPour` | the same, extruded | — | — |
| Gerber `emitCopperPour` | **the union** of every `ok` pour on the layer (`union → splitIslands`, islands in the §8 total order — an island nested inside another's hole has a strictly larger `minX`, so the ancestor is always emitted first and its `LPC` hole never erases the nested island), emitted first on the layer as `LPD` outer / `LPC` holes / `LPD` restore per island; a union failure fails the export (no silent copper loss) | net attribute of the pour | emit pours one by one (a later same-net pour's `LPC` hole would erase an earlier pour's copper where their clearances differ); build its own pad → net map (uses `pcb.padNets`) |
| cloud snapshot `board-snapshot-pours.ts` | `buildCopperFillIslands` per zone (layers `F.Cu`/`In1`/`In2`/`B.Cu`) | its content-addressed ids and `(sourceOrder, geometryOrder)` sort — a wire-contract detail, byte-stable | — ; a `failed` zone adds a snapshot warning naming it |
| connectivity `board-connectivity.ts` `pourItems` | the same results (DRC: `ctx.pourResults()`, computed once) → one `PourCopperItem` per kept island of a net-bound zone | — | run the kernel a second time |
| DRC `checks/copper-pour.ts` | `ctx.pourResults()` + `ctx.connectivity()` | §10 codes | its own island geometry |
| `pcb_cleanup_pour_traces` | `buildCopperFillIslands` per effective zone on the trace's layer (board **and** polygon zones — widened from S3a's board-only) | — | delete a trace not strictly inside one island (S4) |
| golden helper, parity harness | as DRC | — | — |

After §3.3 two different-net fills on one layer are disjoint with a `≥ c` gap, so the Gerber
union merges only same-net overlaps — for net-bound pours exactly the pairs S1's island–island
touch already unions into one component (null-net pours have no S1 node; their overlaps merge in
the artwork only). The union changes no electrical answer. Its re-quantisation can move an
off-grid intersection of two already-quantised boundaries by `≤ q/√2` (0.07 µm) relative to the
canvas overdraw (Astra run 1 #10) — recorded, below any fabrication resolution.

## 10. DRC codes

| code | class · severity | trigger | anchor / layer / location |
|---|---|---|---|
| `ISOLATED_COPPER_ISLAND` | `structural` · warning · waivable | an island of a net-bound zone whose S1 component contains **no** `pad:` / `freepad:` item (B3-10: an island attached only to a floating stub is dead). Aggregated per zone: count, total area in the **message**, `measuredMm` **omitted** (B3-9) | board zone → `{ net }`, polygon zone → `{ zone }` (unchanged ids) · the layer · the largest dead island's `centerMm` |
| `ZONE_EMPTY_FILL` | `structural` · warning | `ok` with zero islands, or a net-unbound zone (S4 §13.1) | unchanged |
| _(null-net zones)_ | — | a **net-less** zone's islands are manufactured copper that belongs to no net: no S1 node, no `ISOLATED_COPPER_ISLAND` (S3a §3.2 decision: net-less copper "joins no net graph" and is never reported as isolated — it is intent, like a disabled zone). Recorded explicitly because §10 otherwise defines the verdict through a component that does not exist (Astra run 1 #5) | — |
| **`ZONE_FILL_FAILED`** (new) | `structural` · error · **non-overridable, non-waivable** | `status: "failed"` — the zone ships no copper for a reason that is not its geometry | `{ zone }` · the layer · the zone's first vertex / outline |
| `ZONE_OVERLAP` | `constraint` · error | narrowed to **equal-priority polygon pairs** of different nets with positive-area overlap (S4 widened it to any priority and to board planes because the carve did not exist; §3.3 now carves them, so only the genuinely ambiguous case remains) | unchanged |
| `ZONE_INVALID` | unchanged | gains the derivation warning `zone_hole_invalid` (§11) | `{ zone }`, no layer for the same reasons as S4 |

`UNCONNECTED_NET`, `TRACK_DANGLING`, `VIA_DANGLING` keep reading the S1 graph, which now contains
exactly the kept islands of §3.9.

## 11. Zone holes

`PcbZoneRegion` polygon: `{ kind: "polygon"; pointsMm; holesMm?: PcbPointMm[][] }`. A hole ring
is valid iff it passes `zoneRingValidity` (S3a §3.3), lies **strictly inside** the outer ring
(every vertex strictly inside, no edge contact — S2 `holeInteriorMeetsRing`-style test in the
strict direction), and is **pairwise disjoint as a filled region** from every other hole (no
touching, no nesting — the S2 cutout rule; Astra run 1 Q12). A hole may contain a same-net pad:
the pour is removed there and the pad stays its own copper item. Otherwise the derivation drops the zone with `zone_hole_invalid` → `ZONE_INVALID`
(a zone that would pour *more* than drawn is refused, not repaired).

Semantics: the extent excludes `int(H_i)` exactly (§3.2), clearance 0 — a hole is part of the
outline. Differences from a `copperPour` keepout: a hole belongs to one zone (a keepout affects
every zone on its layers), has no layer set of its own, and is not a DRC object.
`ZONE_OVERLAP` and the S4 keepout / placement predicates keep using the outer ring; a hole only
removes copper, so judging on the outer ring is the conservative reading (stated limit).

KiCad import: every further `polygon` contour strictly inside the first is a hole (S3a §8
classification unchanged); its arcs are flattened **outward** (hole ≥ drawn → less copper),
its points are kept as `holesMm`, and the zone imports **enabled**. `zone_holes_unsupported` is
retired. Authoring: a Zone-cutout sub-mode of the Zone tool commits `pcb_update_zone { region }`
after the same validity check; hole rings are edited with the outer-ring vertex tools.

## 12. Determinism

The kernel is a pure function of `(params)`. Sources of order: records are built in projection
order (S1), islands are sorted (§8), `memberKeys` are sorted, keys are sets. Re-ordering any
input array yields deep-equal results (pinned by tests for every view). Two JS runtimes
(browser canvas, Bun backend) run the same clipper2-ts code on the same doubles; no consumer
depends on that beyond what the snapshot already pins.

## 13. Stated limits

- The `0.5 mm` fill-clearance floor and the absence of rule-resolver / net-class / scoped
  clearances in the fill (S6). NPTH halos use `copperToHoleClearanceMm` — `clearance.copperToHoleMm`
  when set, else the edge rule — the same value batch DRC's `COPPER_TO_HOLE` compares against
  (S7, `06-batch-drc-contract.md` §4); every non-plated free-pad drill gets the halo, not only
  `hole`-type pads.
- Spokes are not relocated when blocked (§6). `custom` / `trapezoid` pads pour against their
  bounding ring (the importer degrades them to rectangles at the source; S12).
- An UNPLATED pad's copper ring (contract 10 §2.4) is never a pour member: no thermal / solid
  connection is attempted and the ring receives the pour's ordinary clearance — the graph could
  never join it (per-layer null-net items), so the artwork must not either (S11 R1 #6).
- `ZONE_OVERLAP` and keepout / placement predicates ignore zone holes (§11).
- The fill runs synchronously on the caller's thread, except inside a batch DRC run: S10 moved
  that run — its pours included — to a worker thread with a checkpoint before every zone
  (`09-execution-contract.md` §3); Gerber export, the cloud snapshot pours and
  `pcb_cleanup_pour_traces` still fill on the caller's thread. Precedence is `O(Z²)` per layer and
  obstacle collection `O(items)` per pour without an index (S9).
- The Gerber union re-splits islands; island *indices* in the artwork are not the connectivity
  keys (the artwork carries no keys).
- No edge / intersection / output budget or cancellation exists: 50 zones × 5 000 items ×
  500-vertex rings is `Ω(E + I)` per pour with `I` up to `Θ(E²)` in arrangement-hostile input
  (Astra run 1 #15); the budget stays open (S9 recorded the limit); S10 made a runaway zone
  cancellable by terminating the worker, not bounded.
- The union of same-net pours is not re-opened for minimum width (§7, S12).
- Per-pour island removal cannot see other pours (§8, #4b).
- A hole ring that collapses to fewer than three distinct vertices on the output grid is dropped
  from the island and its area (`< 1e-8 mm²`) is not subtracted — the one additive rounding in
  the canonical output (R1 #7).

## 14. Golden delta (prediction, verified before any expected file is regenerated)

- `golden-small-2l`: unchanged (one gnd zone on B.Cu, rect outline, no other zone on the layer).
- `golden-cutouts-2l`: `ISOLATED_COPPER_ISLAND` count unchanged (1); the fill polygon moves with
  the region-based extent but ids hash code + anchors + layer, not location — expected file
  unchanged.
- `golden-areas-2l`: `ZONE_OVERLAP` 2 → 1 (the priority pair `z_pri_a` / `z_pri_b` is carved;
  the equal-priority pair `z_ov_a` / `z_ov_b` remains); island counts may move where `z_pri_a`
  loses the contested area. Every delta line is explained in the ledger.
- New `golden-pours-2l` pins §10 on a board with precedence, same-net overlap, holes, thermals,
  `none`, a dead stub, an NPTH, `std` free pads and a keepout.

## 15. Astra ledger

### 15.1 Runs

| run | mode | effort | access | outcome |
|---|---|---|---|---|
| 1 | spec-attack | xhigh | prompt-only, neutral cwd | completed 2026-09-08 — 15 findings; 11 accepted (contract amended), 2 accepted as recorded limits, 2 rejected as already guaranteed |
| 2 | adversarial-verify | xhigh | repository-grounded, restricted paths | completed 2026-09-08 — 9 findings; 8 accepted and fixed with regressions, 1 accepted as a recorded limit (§7); one recommendation (fillet clip) adopted |

### 15.2 Findings

Reviewer-critical pass on the kernel (R1, 2026-09-08, after Astra run 1): trace-cap obstacles
were still inscribed (a 6 mm trace poured 4.4 µm short of the clearance) — caps are now a
tangent chain at half-step angles (`r·sec(π/2n)`) for every kernel use, coverage test included;
drill apertures likewise circumscribed; a mirrored pad's thermal frame is reflected
(`PadCopperRecord.mirrored`, first spoke at `180° − θ₀`); the canvas memoises the per-zone pour
parameters (the inline spread rebuilt the Clipper pour on every scene render); the R1 claim that
`sortCopperFillIslands` is NaN-unsafe for an empty outer ring was checked and rejected (an
`Infinity − Infinity` term is falsy in the `||` chain and falls through to the next key; a single
empty ring sorts last). R1's "scope creep" and "regenerated golden" items were WP3's concurrent,
mandated work.

Reviewer pass on the consumers and the zone holes (R2, 2026-09-08): a clipper failure inside the
Gerber's per-net union escaped as an untyped 500 and an empty union was emitted as "no plane" —
`unionPourIslands` now fails on a collapse like every in-pour union and the writer maps any union
failure to the same 422 problem as a failed per-zone fill; the pour-ordinal test was vacuous (the
net-less zone was not first) and the snapshot's literal island id and failed-zone warning were
unpinned — tests added. Recorded, not fixed: a cutout-ring vertex drag shows no live outline until
commit (UI follow-up). R2 also traced the tree's `golden-small-2l` delta against `HEAD` to S1's
GND-airwire change (documented in S1), not to S5.

| # | finding (run 1) | severity | verdict | change |
|---|---|---|---|---|
| 1 | clearance formula omits net-class tightening — a 0.8 mm class pours at 0.5 | blocker | **accepted** — `drc-context.ts` `clearanceMm` resolves `max(board, classA, classB, floor)` for every pair; the fill used the board tier only | §5: per-obstacle clearance from the implicit net-class tier; scoped rules stay S6 (they can relax; no pour pair kind) |
| 2 | no conservative quantisation contract; fallback + offset + rounding exhaust `ε` | high | **accepted** — nearest-grid rounding can move copper `q/√2` into a hole; `fallbacks` error stacks with the offset chord error | §3.1–§3.2: forbidden regions inflated by `q`, outer deflated by `q`, `ε_fallback` |
| 3 | circumscribed non-circular pad rings can fabricate contact (≤ 0.2146 % of `r`) | blocker | **accepted as the recorded S1/S2 limit** — the same ring is S1's own contact predicate for non-circles (`copper-records.ts` comment); parity with S1 beats a second geometry; exact arcs are S7's | §4 records it |
| 4a | positive-area attachment drops an island that touches a pad along a shared edge | high | **accepted** — clipper intersection of edge-touching polygons is empty; `copper-fill-island-members.test.ts` already proves membership counts the flush pad | §8: `attached = memberKeys.length > 0` |
| 4b | per-pour removal deletes a small island bridged only through another same-net zone's fill | high | **accepted as a limit** — direction is less copper, connectivity is computed on kept copper | §8, §13 |
| 5 | null-net islands have no isolation verdict | high | **accepted (doc)** — S3a §3.2 decided net-less copper is never isolated; the text now says so; the union-equals-S1 claim is restricted to net-bound pours | §10, §9 |
| 6 | min-width pass keeps `w − 2 µm` strips; `r = 0` case; degenerate fragments under `never` | high | **accepted** — `MIN_THICKNESS_EPS_MM = 0.001` is a radius; guarantee restated as `w − 0.002`; degenerate rings discarded regardless of `islandRemoval` | §7 |
| 7 | width not enforced on the union of same-net pours | high | **accepted as a limit** — the union is not a pour; S12's sliver check owns it | §7, §13 |
| 8 | legitimate empty erosions would be `failed` | medium | **accepted** — the draft rule was wrong for negative offsets | §3, §8 |
| 9 | `[]`-on-throw primitives hide a lost thermal knockout (pad floods solid) | blocker | **accepted** — `buildThermalKnockout` returns `[]` on any boolean failure today | §3, §8: primitives throw `CopperKernelError`, the pour fails; Gerber union failure fails the export |
| 10 | Gerber re-quantised union ≠ canvas overdraw by `≤ q/√2` | medium | **accepted as a limit** (0.07 µm) | §9 |
| 11 | island sort does not canonicalise ring starts / hole order; nested-island emission order | high | **accepted** — canonical rings, hole order, fixed accumulation order; ancestor-first follows from the `minX` key | §8, §9 |
| 12 | explicit priority `−2` would outrank the board zone | high | **rejected** — `normalisePriority` clamps explicit priorities to integers `≥ 0` (S3a §2, `copper-zones.ts:311`) | §3.3 states the domain |
| 13 | the `≤ value + ε + q` upper bound is false; `0.2 %` is `0.2146 %` | medium | **accepted (doc)** | §5 lower bound only |
| 14 | via segment formula undefined for `r < 0.005` | medium | **rejected** — `buildDiscRing` guards `max(r, VIA_MAX_ERROR_MM)` and clamps the ratio to `[−1, 1]` before `acos` (`copper-fill-trace-geometry.ts:100-104`) | none |
| 15 | unbounded arrangement-size cliff | high | **accepted as a limit** (S9/S10) | §13 |

| # | finding (run 2, on the implementation) | severity | verdict | change |
|---|---|---|---|---|
| 1 | obstacle union mixed CCW pad rings with CW stadiums; the NonZero overlap cancelled into an un-clearanced void the pour flooded (a VCC pad under a VCC trace shorted to the GND plane) | blocker | **accepted** — traced; the S4 keepout lesson repeated for obstacles | every obstacle ring normalised CCW before grouping (`pushObstacle`); test (q) |
| 2 | circumscribed trace caps as positive evidence of membership: a zone ending 2 µm short of a trace's true cap was called a member, so a dead island reached a pad | high | **accepted** — the circumscribed stadium is an obstacle superset, not a contact predicate | trace membership decided on the exact segment (`segmentTouchesIsland`: end-cap island distance or segment-to-ring distance `≤ hw + ε`), as S1; test (r) |
| 3 | the opening re-joins two lobes through a neck narrower than `w` (one zone) | high | **accepted as a limit** — the opening guarantees a union of `w/2` discs, not a local width; the fix is a DRC connection-width check on final copper | §7 reworded; S12 |
| 4 | the canvas bucketed vias by global layer index (`viasByLayer`) and omitted a blind via from the B.Cu pour every backend fill cleared | high | **accepted** — a pre-S5 canvas optimisation the kernel's record-based span resolution made wrong | `PcbScene` passes every via; the kernel resolves the span |
| 5 | `pcb_cleanup_pour_traces` deleted the trace whose membership kept its island alive under `islandRemoval: "always"` — trace and copper both gone | high | **accepted** | coverage re-validated against a refill with the deletions applied, iterated to a fixed point |
| 6 | KiCad import classified a hole against the INWARD-flattened outer; an arc of sagitta below the chord budget flattened across the hole, which was dropped as an "extra outline" while the zone imported enabled | high | **accepted** — fail-open on import | classification against the outward-flattened outer (a superset of the true outline); a hole that then fails validity imports the zone disabled, never dropped |
| 7 | slotted NPTH / PTH drills were subtracted as their centre disc; copper stayed inside the routed slot and 0.25 mm from its edge | high | **accepted** — B2-5 extended to pours | slots are circumscribed stadiums of their centreline for apertures and NPTH halos |
| 8 | a 20 nm-wide obstacle quantised to nothing inside a non-empty union; its clearance band vanished with the pour still `ok` | medium | **accepted** — the whole-group emptiness test could not see one member vanish | an obstacle ring that collapses on the output grid fails the pour ("below the output resolution"); test (s) |
| 9 | at `copperToBoardEdgeMm = 0` the extent skipped the inset and rounding put copper 40 nm outside the board | low | **accepted** | the extent is always inset by `q` (plus the fallback allowance); test (t) |
| Q2 | the remove-only fillet is anti-extensive only in exact arithmetic | — | recommendation **adopted** | the fillet result is intersected with its input; test (u) |
