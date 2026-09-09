# Session 2 — core PCB geometry contract

Status: **done** (2026-09-07). Owns B4-1, B4-2, B4-6, B4-7, the crossing-overlap
(vertex-containment) follow-up, and the full-radius roundrect outline bug found during S2
reconnaissance. Program tracker: `PROGRAM.md`; verified inventory: `00-ground-truth.md`;
defect register: `../drc/OPEN_FINDINGS.md`.

The question this session answers once, for every consumer:

> Given the board outline, its cutouts and a piece of copper, is the copper on the board, how far
> is it from the edge, and do two outline features overlap — without a second approximation.

Scope: segment predicates, arc flattening, the board region, containment and overlap tests, and
the DRC checks that consume them (`checks/board.ts`, `checks/outline.ts`). Out of scope: spatial
indexing (S9), copper-fill extent (S5, consumes this region), Gerber true arcs (S12), route
obstacles and live DRC (S8 — `07-live-parity-contract.md`; edge / cutout obstacles S16), exact-disc clearance for circular pads (S7).

Decisions taken with the user before this contract was written: off-board is judged on **copper
with its width** and co-fires with edge clearance as today; arcs are handled by **one polygonal
region with an explicit, always-safe per-arc bias** (no exact-arc kernels); an outline that
touches itself is **invalid**, matching the editor's contour gate.

## 1. Tolerance policy

`src/shared/pcb-geometry/tolerance.ts` is the single epsilon policy. Three constants, three jobs:

| Constant | Value | Used for |
|---|---|---|
| `DRC_EPS_MM` | `1e-6` | rule comparisons (`below`, `exceeds`): a deficit inside it is float noise, not a violation |
| `SHORT_EPS_MM` | `1e-4` | different-net copper closer than this is a dead short regardless of the clearance rule |
| `GEOM_EPS_MM` | `5e-7` | every boundary, collinearity and containment predicate in this contract; `CONNECT_EPS_MM` is an alias of it |

`GEOM_EPS_MM` is justified on its own terms, not only by the nanometre grid: trace coordinates
are integer nanometres (so 0.5 nm is half the smallest expressible gap), but outline coordinates
are unquantised millimetre doubles and flattened arc vertices are transcendental. The value is
three orders of magnitude below any manufacturable feature and six orders above double rounding
noise at board scale (`1e3 mm × 2⁻⁵² ≈ 2e-13 mm`).

Collinearity is always a **length**, never a raw cross product compared to a constant:
`|orient(a, b, c)| ≤ GEOM_EPS_MM · |b − a|`, i.e. `c` lies within `GEOM_EPS_MM` of the line
through `a` and `b`. The previous `|rxs| < 1e-6` guard in `segmentsIntersect` compared an
area-like quantity with a length and reported two 0.01 mm segments crossing at 0.3° as parallel.

There is **one** "on the board" rule: the board region is a closed set and a point within
`GEOM_EPS_MM` of its boundary is on the board. The strict `gap < 0` tests for vias and holes and
the hole error/warning split are re-expressed through the containment predicates of §5 — error
when the copper or drill is not inside the region, warning when it is inside and `below(gap, rule)`.
A via whose gap computes to `−1e-16` is on the board.

## 2. Segment predicates (`segment-predicates.ts`)

One implementation of each, mm domain, pure:

- `orient(a, b, c)` — signed twice-area of the triangle.
- `pointOnSegment(p, a, b, eps)` — distance from `p` to segment `ab` ≤ eps.
- `segmentsIntersect(a, b, c, d, eps)` — **inclusive**: a proper crossing, a T-touch (an endpoint
  on the other segment), a shared endpoint, or a collinear overlap all return true. This replaces
  both `pcb-trace-geometry.segmentsIntersect` (which was inclusive of endpoints but returned false
  for near-parallel and collinear input) and `outline-geometry.segmentsIntersectInclusive`.
- `segmentsCrossTransversally(a, b, c, d, eps)` — strict: the endpoints of each segment lie on
  opposite sides of the other's line, beyond eps. Used only where positive-area overlap matters (§5).
- `segmentContactParams(a, b, c, d, eps) → number[]` — every parameter `t ∈ [0, 1]` along `ab` at
  which `ab` touches `cd`: the crossing parameter for a transversal crossing, the parameter of an
  endpoint that lies on the other segment, and for a collinear overlap the clamped parameters of
  **both** overlap ends.

`segmentToSegmentDistance` changes value only for crossings the old guard missed (two segments
whose lengths and angle put `|r × s|` below `1e-6 mm²` — sub-manufacturable copper — measured a
few 1e-5 mm apart before and 0 now). `segmentToSegmentClosestPoints` gains an explicit collinear-overlap
branch returning the midpoint of the overlap interval, so the inclusive predicate can never route a
`0/0` division into a violation location (`NET_SHORT_CIRCUIT` ids hash a 0.1 mm location bucket; a
`NaN` there collapses every hot spot on an anchor pair to one id).

## 3. Arc flattening (`arc-chords.ts`, `outline-geometry.ts`)

One chord sampler, two constructions, one tolerance. `MAX_CHORD_DEVIATION_MM = 0.01 mm` bounds
the distance between the flattened boundary and the true curve, on the side the construction
promises. Every arc emits the exact end point; the start point belongs to the previous segment.

- **Inscribed**: vertices on the true arc at `a0 + kθ`, `k = 1..n`; chords lie on the centre side
  of the arc; sagitta `r(1 − cos(θ/2)) ≤ d` gives `θ ≤ 2·acos(1 − d/r)`.
- **Circumscribed** (tangent chain): exact start, then `n` vertices at radius `r·sec(θ/2)` at angles
  `a0 + θ/2 + kθ`, `k = 0..n−1`, then the exact end. Each edge lies on a tangent line of the arc,
  so the polygon encloses the arc **and** joins its neighbouring segments without a dip. Pushing
  the arc's own endpoints outward instead (the pad-outline construction) is not enclosing at the
  joins. The radial excess `r(sec(θ/2) − 1) ≤ d` is a **stricter** step rule than the inscribed
  one (`θ ≤ 2·acos(r / (r + d))`); using the inscribed rule for a tangent chain overshoots the
  bound (0.010016 mm at r = 2.07 with 32 steps).
- Every construction keeps `θ ≤ π/2`: a two-chord "circle" has zero area and a tangent step of
  π puts vertices at infinity. The step count is therefore
  `max(ceil(sweep / θ_max(bias)), ceil(sweep / (π/2)))`, clamped to `MAX_ARC_SEGMENTS = 512`; the
  former `MIN_ARC_SEGMENTS = 2` floor for `r ≤ d` is gone (it produced degenerate rings for
  sub-0.01 mm arcs).
- Full circles and ellipses use the same rules (`sweep = 2π`, `r = max(rx, ry)`) with the
  former fixed 64 chords kept as a **floor** — for **every** consumer, including default
  flattening for rendering, Gerber, fill and snapshot. Large circles get finer (the old 64-gon at
  r = 20 deviated 0.024 mm; it is now a 100-gon), small ones never coarser than before (the chord
  rule alone would make a 1 mm circle a 23-gon). The ellipse tangent
  chain is the affine image of the circle's (radii scaled by `sec(θ/2)`); affine maps preserve
  tangency.
- Error bound, for arc-bearing outline kinds (`roundrect`, `circle`, `contour`): within
  `MAX_CHORD_DEVIATION_MM` of the true curve on the promised side, unless `MAX_ARC_SEGMENTS` caps
  the count — then within `r(1 − cos(π/512))` / `r(sec(π/512) − 1)` (≈ 0.038 mm at r = 2000 mm),
  still on the promised side. `polygon` outlines carry no arcs; whatever error their producer
  introduced (KiCad import tessellates Edge.Cuts arcs at 16 chords) is theirs, and no bias applies.
- **Flattening can change topology** when an authored feature lies closer to an arc than the chord
  deviation (a return edge 0.002 mm inside a fillet; a notch 0.004 mm from a hole's arc). A chord
  polygon — inscribed or biased — may then cross a neighbouring edge and its parity is wrong. The
  rule, with one level of look-ahead: after flattening a ring at step multiplier m, flatten it at
  2m as well; if either ring self-intersects, or the two are not **monotone** — an inward ring must
  satisfy `coarse ⊆ fine`, an outward one `fine ⊆ coarse`, closed containment with no transversal
  crossing — adopt the finer ring and look again, up to the cap. A coarse ring can stay simple and
  still sit on the wrong side of a sliver-thin feature (a crescent-shaped board whose shallow arc
  flattens to one chord); monotonicity is what exposes it, because a correctly-sided sequence of
  refinements only ever grows (inward) or shrinks (outward) toward the true shape. Lines that
  cross the true arc but miss its coarse chords surface the same way: the refinement crosses.
  A ring still self-intersecting at the cap is treated as a true self-intersection for validity
  (§6) and falls back to its unbiased flattening for the region (§4), which records the fallback.
- **Mismatched arc endpoints** (the contour validator tolerates radii differing by up to 1e-3
  relative): in a biased build the true curve is only known to lie in the annulus between the two
  radii, so an inscribed arc is sampled on the smaller radius and a circumscribed one on the
  larger, joined to the exact endpoints by radial stubs. Without this the last tangent edge to a
  shorter-radius endpoint cuts back inside the circle. Default flattening keeps the start radius
  and the exact end point as before. Features finer than the residual chord error at the cap are
  below any manufacturable web and are not resolvable by a polygonal model; certifying them needs
  exact arc predicates (S12).

Two flattening fixes ride along: `roundRectPoints` no longer emits a duplicate vertex when the
corner radius equals half the width or height (the natural rounded-slot shape produced a
zero-length edge, which the self-intersection test read as a self-touch — every full-radius
roundrect outline or cutout was `BOARD_OUTLINE_INVALID`); and every flattened ring is canonicalised
(consecutive coincident vertices, including the wrap pair, dropped at `GEOM_EPS_MM` — an
explicitly closed `polygon` therefore loses its repeated closing vertex, and Gerber / snapshot /
fill see the same ring without a zero-length edge).

## 4. Board region (`board-region.ts`)

```
buildBoardRegion(outline, cutouts, { bias }) → { outer, holes, bounds, ringBounds, edges, fallbacks }
```

A **closed** point set: the outer ring's interior and boundary, minus the interior of every hole
(hole boundaries stay on the board). Rings are canonicalised and topology-checked per §3.

`bias: "none"` is today's flattening (§3 constructions with inscribed arcs) and stays the input to
rendering, Gerber, the copper-fill extent and the cloud snapshot.

`bias: "board-inner"` is the legality region. **One rule per arc: inscribe if the arc's centre
lies on the region-interior side of the arc, circumscribe otherwise.** The chord polygon of every
arc then lies on the board side of the true curve, so `R_poly ⊆ R_true`: a convex bulge of the
outer ring is inscribed, a round notch in the outer ring is circumscribed, a round hole is
circumscribed, a rounded peninsula of board protruding into a hole is inscribed. Outer ring and
holes need no separate rules; CW and CCW authoring produce the same region. Parametric shapes are
convex, so a `roundrect` or `circle` outer is inscribed and a `roundrect` or `circle` cutout is
circumscribed.

The interior side is **computed, never assumed**: the **exact** contour's signed area (shoelace
over the segment endpoints plus each arc's circular segment `(r²/2)(θ − sin θ)`, signed by its
direction) gives its orientation, the centre side of each arc follows from the arc's direction
relative to the ring's travel, and the ring is flattened with the bias. The flattened ring's area
is not a safe substitute: a sliver-thin cutout whose shallow arc flattens to one chord comes out
as a simple polygon of the opposite orientation, which would flip every arc's bias (§9.2). A degenerate ring (|area| below
`1e-6 mm²`, a bow-tie, fewer than three vertices) is flattened inscribed and never throws — the
DRC context is built before `checkOutline` has a chance to reject it.

Two ring sets exist, and each consumer is told which one it gets:

| Consumer | Rings |
|---|---|
| copper containment, off-board, hole-to-edge, edge clearance (§5, §6) | biased region |
| outline validity: cutout-in-outline, cutout separation (§6) | biased region — conservative: a true breach or contact is always caught; a false rejection needs a web thinner than the chord error |
| outline validity: self-intersection (§6) | unbiased, refined (§3) — bias itself can introduce crossings |
| rendering, Gerber, copper-fill extent, cloud snapshot, DXF round-trip | default flattening (finer circles per §3, deduped roundrects; otherwise unchanged) |

Validity on the unbiased rings cannot certify a curved outline: a circular cutout whose true
circle breaches the board edge by 0.005 mm passes an unbiased containment test because its chords
stop 0.0093 mm short of the circle. Validity on the biased rings rejects it.

Supported coordinate range: `|x|, |y| ≤ 1e9 nm` (1 m). Within it the single nm→mm conversion is
exact to `1e-13 mm`; beyond it a double cannot hold the quotient and the tolerance below is not
honoured.

## 5. Containment and overlap (`board-region.ts`)

All predicates are closed with `eps = GEOM_EPS_MM`. Stated limit: the closed rules and the
stadium / disc shortcut each spend up to `eps` (a centre `eps` outside the board with a radius up
to `2·eps` passes), so copper may exceed the true region by at most `3·eps` (1.5 nm) without an
error, and an air sliver or a penetration thinner than `2·eps` is invisible. Nothing
manufacturable lives there.

- `regionContainsPoint(R, p)` — **per ring**, not "near any boundary": inside-or-on the outer
  ring, and for every hole not strictly inside it (strictly = inside and farther than eps from
  that hole's boundary). A point on one hole's boundary that lies 0.0094 mm inside a neighbouring
  hole is off the board; a global "within eps of any edge ⇒ inside" would have admitted it.
- The region built with `bias: "none"` (frontend resize count, `pointInOutline`) skips the
  topology probe: it feeds no validity verdict, and a contour vertex drag rebuilds it per frame.
- `segmentInsideRegion(R, a, b)` — both endpoints inside and, for the sorted parameter set
  `T = {0, 1} ∪ {t of every boundary vertex within eps of ab} ∪ {t of every transversal crossing}
  ∪ {clamped t of both endpoints of every boundary edge collinear with ab within eps}`, the
  midpoint of every consecutive sub-interval is inside. Between consecutive parameters the
  segment is entirely inside or entirely outside the polygonal region, so the midpoint decides.
  Exact for polygonal regions up to the `2·eps` limit above (a hole 1.5 nm tall between two
  parameters is not partitioned). A zero-length segment reduces to the endpoint test.
- `polylineInsideRegion(R, pts)` — every segment inside.
- `polygonInsideRegion(R, ring)` — every edge inside (which already excludes any ring edge from a
  hole's interior) **and no hole interior meets the ring's interior**. Because the ring's boundary
  is inside the region, the only way a hole interior can still meet the ring interior is through
  the hole's boundary: for every hole whose bounds meet the ring's, no hole vertex strictly inside
  the ring, no hole-edge sub-segment midpoint (split at its contacts with the ring) strictly
  inside the ring, and no collinear overlapping edge pair whose interior sides agree (a pad that
  exactly fills a square cutout shares all four edges with it; the interior sides agree, so it is
  off the board). Proof sketch: two simple polygons whose interiors meet either have a boundary
  point of one strictly inside the other, or share boundary pieces with interiors on the same
  side; when either ring's orientation is undefined (zero area, bow-tie) the sides are treated as
  agreeing — fail closed. The outer ring needs no such test: a ring whose boundary lies inside a
  simply connected region lies inside it.
- `stadiumInsideRegion(R, pts, hw)` — for `hw > eps`: `distanceToBoundary(pts) ≥ hw − eps` and
  `regionContainsPoint(pts[0])`. Exact for the true region: the stadium is the Minkowski sum of
  the centreline and a disc of radius `hw`; a stadium point outside `R` would put a boundary point
  within `hw` of the centreline, and a centreline that far from the boundary cannot cross it, so
  one point decides the side. For `hw ≤ eps` fall back to `polylineInsideRegion`.
  `discInsideRegion(R, c, r)` likewise.
- `distanceToBoundary` — today's perimeter kernels (`pointToRingEdgeDistance`,
  `polylineToRingEdgeDistance`, `ringToRingEdgeDistance`) over `[outer, ...holes]`, unchanged.
- Broad phase without an index — per-ring bounds: an object is tested only against rings whose
  eps-inflated bounds meet its own; an object meeting no ring's boundary bounds is decided by one
  point test. Cost is linear in the edges of the rings it is near. Pathological inputs (hundreds
  of comb-shaped cutouts with hundreds of chords each) were quadratic until S9 added the
  boundary-edge index (`08-broad-phase-contract.md` §2.2: `edgesNear` for distances and contact
  parameters, a row-band table for the ray parity; the unindexed functions stay as the oracle). S9
  also corrected one degeneracy: a ring of fewer than two vertices (a zero-size cutout canonicalises
  to one) files no boundary edge, so the region-level distances agree with the per-ring helpers,
  which already returned `Infinity` for it.
- `ringsIntersect(A, B)` — closed-set contact: a vertex of one inside-or-on the other, or any edge
  pair `segmentsIntersect` (inclusive). Complete for closed polygons: interiors that meet without
  any vertex containment must have crossing or touching edges.
- `ringStrictlyInside(A, B)` — every vertex of A strictly inside B (beyond eps) and no edge contact
  between A and B. Complete: a boundary that leaves B must touch B's boundary.
- `ringSelfIntersects(ring)` — inclusive: any two non-adjacent edges touching (crossing, T-touch,
  collinear spur) makes the ring invalid. One export, replacing the private copy in
  `checks/outline.ts`; the only behavioural change there is that a collinear spur is now invalid.

## 6. Consumers and their answers

| Code | Rule |
|---|---|
| `COPPER_OFF_BOARD` | copper **with width** not inside the biased region: trace ⇒ `stadiumInsideRegion`, via ⇒ `discInsideRegion`, pad ⇒ `polygonInsideRegion(ring)` (circular pads keep the circumscribed 48-gon here so this test and edge clearance agree; its radial excess is `sec(π/48) − 1 ≈ 0.215 %`, so a circular pad can be rejected where an identical via passes by up to `0.00215·r`; the exact disc for both is S7). Replaces vertex/midpoint sampling for traces and vertex-only tests for pads. |
| `COPPER_TO_BOARD_EDGE` | perimeter gap `below` the rule, measured against the **biased** region rings (on an arc the unbiased chords sit up to 0.01 mm on the wrong side — a true 0.4949999 mm copper-to-cutout gap read 0.5049 mm on the inscribed chords and passed a 0.5 mm rule; §9.2); still co-fires with `COPPER_OFF_BOARD` for copper that pokes through, as vias did before. B4-1 and B4-2 therefore gain a second violation. `measuredMm` remains the unsigned perimeter gap (it can read positive for copper entirely inside a hole); `COPPER_OFF_BOARD` is the authoritative verdict. A signed clearance is filed for S7. |
| `HOLE_TO_BOARD_EDGE` | error when the drill (disc, or slot stadium) is not inside the region; warning when inside and `below(gap, rule)`. Same verdicts as before, one epsilon. |
| `BOARD_OUTLINE_INVALID` | outer ring: fewer than three vertices, zero area, inclusive self-intersection (unbiased, refined). Cutout: the same, plus `ringStrictlyInside(cut, outer)` on the **biased** rings must hold (a cutout that touches or crosses the edge leaves a zero-width or negative web — invalid; merge it into the outline), plus no `ringsIntersect(cut, other)` on the biased rings (touching, abutting or overlapping cutouts are invalid — merge them into one cutout). Conservative: a true breach, tangency or overlap is always caught; a false rejection needs a web thinner than the chord error (≤ 0.01 mm per curve), below any manufacturable web. |

Accepted false-positive band: near an arc, the biased region is up to `MAX_CHORD_DEVIATION_MM`
inside the true board, so copper exactly tangent to a curved edge can be reported off-board or
short of clearance by that much. This is the price of one polygonal model; the exact second-chance
test inside the band is deferred to S12 (user decision 2026-09-08, S7) and recorded as a limit in
`06-batch-drc-contract.md` §5.

`pointInOutline` survives for the frontend resize warning, implemented on
`regionContainsPoint` with the default flattening; its count of items outside may change at exact
edges because the region is closed.

Later consumers, recorded here so they do not re-derive geometry: S5 builds the fill extent from
`buildBoardRegion`; S7 adopted the exact disc for circular pads in the edge, clearance, keepout and
creepage checks and made `COPPER_TO_BOARD_EDGE.measuredMm` signed (negative when the copper is not
inside the region); S8 made the live gate judge edge / off-board through the same region (`boardItems`); S16 gives the router board-edge and cutout obstacles from the same
region; S12 decides whether Gerber emits true arcs, adds exact-arc contour validity, and owns the
minimum-web / connected-material checks that outline validity does not make (`findNarrowestSlot`).

## 7. Divergences kept and documented

| Site | Divergence | Owner |
|---|---|---|
| `pad-outline.ts` `arc` / `ellipseRing` | pad arcs circumscribed by pushing both endpoints out, fixed 48/6 chords; conservative for clearance and connectivity, moving them shifts every pad ring by micrometres | S7 resolved the CIRCLE case without touching the sampler: every DRC check consumes the record's exact `disc` (`drc/pair-gap.ts`); ovals / roundrects keep the circumscribed ring (S11) |
| `pcb-routing/collision.ts` `segmentIntersectsRectNm` | nm domain, Liang–Barsky, open interior (boundary contact legal); already uses the clipped-midpoint technique of §5 | S8 named the convention (`07-live-parity-contract.md` §5): an obstacle rect is an outward-rounded superset of `item ⊕ max(required, implicit, SHORT_EPS + 1 nm)`, so boundary contact is always legal under `clearanceViolated` and above the inclusive short threshold; the verdict stays with the gate |
| copper-fill `addArc`, `buildTraceSegmentStadium`, `buildDiscRing` (`VIA_MAX_ERROR_MM = 0.005`), `padDisc` | fixed-count inscribed samplers and a second chord tolerance; `padDisc` duplicates the S1 disc predicate | S5 |
| `courtyard.ts` `pushCircle` | 16-chord inscribed hull | S12 |
| `computeOutlineBboxMm` | boxes the inscribed ring (≤ 0.01 mm under-report at a bulge); feeds only the cached width/height | documented |
| `pcb-trace-geometry.ts` path validators (`simplifyCollinearPath`, `validate45Path`) | exact comparisons, no epsilon | S16 |
| KiCad `tessellateArcChords` (16), DXF `pushEllipse`, SVG `arcToSvgPath` | import / preview fidelity | out of program |

`outline-manufacturability.ts` loses its private `pointSegDistance` / `segSegDistance` in favour of
the shared kernels (a superset on validated rings).

## 8. Expected golden delta

`golden-small-2l`: rect outline, no cutouts, one `COPPER_TO_BOARD_EDGE` on trace `t24` measured
+0.300 mm — contained copper, so no new `COPPER_OFF_BOARD`; board codes are not location-hashed.
Predicted delta: **none** — confirmed (its expected file differs from `HEAD` only by S1's
`UNCONNECTED_NET` +1). Because that golden never exercises a cutout or an arc, S2 adds
`golden-cutouts-2l` (80×60 roundrect r = 15, five cutouts incl. a full-radius slot and a 0.5 mm
web pair, copper near curved edges and over cutouts, a slot hole into a cutout; 87 primitives),
baselined after both Astra passes: 23 errors / 31 warnings / 54 violations —
`COPPER_OFF_BOARD` 7, `COPPER_TO_BOARD_EDGE` 9, `HOLE_TO_BOARD_EDGE` 3, `BOARD_OUTLINE_INVALID` 0,
plus the ordinary clearance / short / unconnected / dangling codes. Its intent per item is in
`fixtures/drc/golden/golden-cutouts-2l.md`.

## 9. Astra ledger

### 9.1 `spec-attack` — 2026-09-07, gpt-6-astra, xhigh, prompt-only

Packet: `scratchpad/s2/astra-spec-attack-packet.txt` (61 lines). Verdict: "The proposal fails:
it can accept copper inside a true cutout without an error." Fourteen findings; disposition after
verification against the contract and the current source:

| # | Finding (Astra) | Disposition | Where |
|---|---|---|---|
| 1 | Circumscribing a hole arc can cross an authored edge 0.004 mm away; the self-crossing ring's parity admits a disc inside the true hole | **accepted** — refine on self-intersection up to the cap, then fall back to the unbiased ring and record it; the residual is below any manufacturable web | §3, §4 |
| 2 | A pad exactly filling a square cutout passes `polygonInsideRegion` (no hole vertex strictly inside) | **accepted** (blocker) — hole-interior-meets-ring-interior test through the hole's boundary, incl. collinear pieces with agreeing interior sides | §5 |
| 3 | "Vertex strictly inside or transversal crossing" is not positive-area overlap (two rectangles sharing supporting edges) | **accepted** — cutout separation is now closed-set contact (`ringsIntersect`, inclusive), which is complete; touching cutouts are invalid | §5, §6 |
| 4 | T is incomplete for the eps-expanded set (a 0.75 nm-tall hole between two parameters) | **accepted as a stated limit** — features under `2·eps` (1 nm) are not partitioned; the quantum itself | §5 |
| 5 | Global "within eps of any boundary ⇒ inside" admits a point on one hole's boundary that is 0.0094 mm inside a neighbouring hole | **accepted** — per-ring rule | §5 |
| 6 | Inscribed step rule overshoots the tangent-chain bound (0.010016 at r = 2.07); `MIN_ARC_SEGMENTS = 2` gives tangent steps of π (vertices at infinity) and degenerate two-chord circles | **accepted** — circumscribed rule `θ ≤ 2·acos(r/(r+d))`, `θ ≤ π/2` floor for both constructions | §3 |
| 7 | Unbiased chords cannot certify curved-outline validity (a circle 0.005 mm outside the board passes; two circles 0.005 mm overlapping pass) | **accepted** — cutout-in-outline and cutout separation run on the biased rings | §4, §6 |
| 8 | Inscribed flattening of an outer contour with a return edge 0.002 mm inside a fillet self-crosses and is rejected although the true contour is simple | **accepted as a stated limit** (pre-existing today) — refinement before concluding; exact-arc validity is S12 | §3 |
| 9 | Stadium/disc shortcut plus closed centre test admits a `3·eps` breach for a `2·eps` disc | **accepted as a stated limit** — total excursion ≤ `2·eps` = 1 nm | §5 |
| 10 | Conservative polygons reject a via exactly tangent inside a circular outline; the circular-pad discrepancy is `sec(π/48) − 1 ≈ 0.00215·r`, not `0.0011·r` | **accepted** — bound corrected; the false-positive band is the documented price of one polygonal model (user decision); exact second chance is S7 | §6 |
| 11 | Validity does not guarantee positive-area connected material (cutout identical to the outline; a cutout spanning the full height; touching cutouts) | **accepted in part** — cutouts must be strictly inside the outer ring and pairwise separated on the biased rings, which rejects all three examples; minimum web / connectivity of the remaining material is S12 | §6 |
| 12 | A persisted coordinate of 9·10¹⁵ nm loses 0.69 nm in the single nm→mm conversion | **accepted as a documented range** — `|x| ≤ 1e9 nm` (1 m), conversion exact to `1e-13 mm` | §4 |
| 13 | Containment is quadratic per tested edge; a linear AABB scan does not bound comb-shaped cutouts | **accepted in part** — per-ring bounds bound the practical case; the worst case is S9's spatial index, as planned | §5 |
| 14 | Applying the new circle step rule to `bias: "none"` contradicts "default flattening unchanged" | **accepted** — the change is authorised for every consumer (a 64-gon at r = 20 was 0.024 mm off); the contract no longer claims "unchanged" | §3, §4 |

Survived attack, per Astra: exact segment partitioning with complete contacts; the tangent-chain
geometry (with steps below π); the stadium argument on the true region; units; no new
non-determinism, no rule-class or net-class change.

### 9.1a Adversarial review of the kernel (Claude reviewer-critical, 2026-09-07)

Read-only pass over the WP2 kernel with 48 000 fuzzed segment cases, 40 000 arc-region cases in
both biases and 3 000 randomised polygon cases: no unsound verdict; every §9.1 disposition
confirmed absorbed; the bias sign convention verified for convex and concave arcs under CW and
CCW authoring. Nine findings, all applied before the Astra verification pass:

| # | Finding | Disposition |
|---|---|---|
| 1 | closest points on a collinear overlap landed on an overlap end, not the §2 midpoint (marker bucket differs) | fixed — `collinearOverlapMidpoint` branch |
| 2 | the O(n²) topology probe ran on the `bias: "none"` build too (contour vertex drag: 60–190× slower per frame) | fixed — probe only in the legality build; redundant second probe removed |
| 3 | `holeInteriorMeetsRing` failed OPEN when a ring's orientation was undefined (zero-area or bow-tie ring on a hole edge passed) | fixed — fail closed |
| 4 | `segmentContactParams` emitted parameters for collinear-but-disjoint segments (harmless to current callers) | fixed — extent gate |
| 5 | `arcSegmentCount` / `arcChordPoints` / `ellipseChordRing` had no NaN or θ ≥ π guard on the public API | fixed — finite guards, floor enforced in the sampler too |
| 6 | `findNarrowestSlot` on a self-crossing coarse ring reported a 0 mm slot (old private helper ignored crossings) | fixed — crossing pairs skipped; validity reports them |
| 7 | "`segmentToSegmentDistance` keeps its value" was false for near-parallel crossings the old guard missed | contract §2 reworded |
| 8 | canonicalisation drops an explicitly repeated closing vertex of a `polygon` (KiCad import shape) — untested, undocumented | contract §3 documents it; test added |
| 9 | the chord rule made circles below r ≈ 3.4 mm coarser than the legacy 64-gon (r = 1 → 23-gon in the renderers) | fixed — 64 kept as a floor for full circles; §3 updated |

### 9.2 `adversarial-verify` — 2026-09-07, gpt-6-astra, xhigh, repository-grounded (read-only)

Packet: `scratchpad/s2/astra-adversarial-verify-packet.txt` (279 lines: invariants, the two check
diffs, an inspect list). **The run was terminated by the provider's content filter** ("This
content was flagged for possible cybersecurity risk") after ~115k tokens, at roughly 40 % of its
own plan (degenerate inputs, determinism quantification and cost were still queued). Three findings
were confirmed in its progress trace before the abort, all verified against source and fixed:

| # | Finding (Astra) | Disposition |
|---|---|---|
| 1 | A sliver-thin cutout whose shallow arc flattens to one chord becomes a simple polygon of the OPPOSITE orientation; the bias then flips and refinement never triggers, so copper inside the true cutout passes with no board or outline error | **accepted** — orientation now comes from the exact contour's signed area (arcs included); regression in `pcb-geometry-board-region.test.ts` |
| 2 | B4-6 remained for edge clearance: `COPPER_TO_BOARD_EDGE` still measured on the unbiased (inscribed) cutout chords, so a true 0.494999902 mm gap read 0.5049 mm and passed a 0.5 mm rule | **accepted** — edge clearance measures the biased region rings; B4-6c in `drc-audit-b4.test.ts` |
| 3 | The pairwise cutout loop stopped at the first partner, so authoring order changed the number of `BOARD_OUTLINE_INVALID` drafts (1 vs 2 for the same three cutouts) — a determinism-contract breach | **accepted** — every touching pair is reported; order test in `drc-audit-b4.test.ts` |
| 4 | The "≤ 2·eps" leakage bound is understated for the disc shortcut (centre `eps` outside plus radius `2·eps`) | **accepted** — §5 now states `3·eps` |

**Second run, filter-neutral wording, same settings** (`astra-adversarial-verify-prompt-v2.txt`):
completed; eight counterexamples, every one reproduced against the code and fixed, with a
regression each:

| # | Finding (Astra) | Disposition |
|---|---|---|
| 1 | A sliver-thin OUTER contour (shallow arc + two lines, 0.003 mm thick) flattens to a simple triangle on the wrong side; orientation was already exact, but nothing refined because the polygon was simple — copper 0.001 mm outside the true board passed | **accepted** (high) — look-ahead refinement with the monotonicity rule (§3); `drc-audit-b4` "sliver outer contour" + kernel test |
| 2 | Two lines crossing the TRUE arc but missing its coarse chords: both rings simple, `checkOutline` empty | **accepted** (high) — the look-ahead's refinement crosses, so the ring refines to the cap and is invalid; `drc-audit-b4` "lines cross its true arc" |
| 3 | Arc endpoints with radii 1 and 0.9991 (inside the validator's tolerance): the last tangent edge to the shorter endpoint cuts 0.0004 mm inside the circle | **accepted** — annulus rule (§3); kernel test |
| 4 | A single-point trace skipped both board checks (`length < 2 → continue`) | **accepted** — measured and contained as a disc |
| 5 | A zero-area cutout's early return skipped its pair comparisons: `[D, B]` vs `[B, D]` gave 1 vs 2 outline errors | **accepted** — pairs are evaluated in a separate loop over every non-degenerate pair |
| 6 | The projection guard collapsed segments shorter than 1 nm, so a 0.9 nm segment's own end point read as off it | **accepted** — guard at `GEOM_EPS_MM` |
| 7 | A `NaN` vertex made every comparison false and the outline read as valid | **accepted** — non-finite coordinates are `BOARD_OUTLINE_INVALID` |
| 8 | `arcChordPoints` with an infinite angle looped allocating `NaN` vertices (public kernel API only) | **accepted** — finite-geometry guard, count capped at `MAX_ARC_SEGMENTS` |

Astra's cost probe (300 pads × 48 vertices, ten 100-chord cutouts, 1 004 boundary edges):
`checkBoard` ≈ 1.57 s, `checkOutline` ≈ 48 ms, linear in pads × boundary edges — the pre-existing
perimeter-distance pattern, now with more chords; filed for S9's spatial index. Astra confirmed
no further counterexample for §9.1 F2–F5, F7, F10–F14 and that B4-7's mechanism is gone.

## 10. Session checklist

- [x] WP0 baseline re-checked (backend 1410 pass / 22 known fails; tsc 42, assistant + library only)
- [x] WP1 contract written, Astra spec-attack run, findings ledgered and applied (§9.1)
- [x] WP2 kernel + tests, reviewer-critical pass (§9.1a)
- [x] WP3 checks + B4 flips + new cases (`drc-audit-b4.test.ts`: 20 live tests)
- [x] WP3b `golden-cutouts-2l` fixture (87 primitives, 54 violations, 0 outline errors)
- [x] WP4 full gates at baseline (backend 22 known fails only; tsc 42 assistant/library; Vitest 48/347; contracts clean)
- [x] WP5 Astra adversarial-verify — run 1 aborted by the provider filter at ~40 % (4 findings applied); run 2 completed (8 findings, all applied) (§9.2)
- [x] WP6 `golden-cutouts-2l` baselined; docs, register, program, memory updated
