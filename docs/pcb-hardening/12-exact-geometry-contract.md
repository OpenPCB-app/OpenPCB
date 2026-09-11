# 12 — Exact-arc geometry (S12b)

Status: **binding** (S12b closed 2026-09-11 in the working tree; every §12 ledger folded — plan-critique, Astra runs 0 / 1 / 2, R1, R2).

Sessions S1–S12 built one physical model of copper, holes, the board region and the production
artwork — on **chord polygons**. Every curve OpenPCB knows (pad arcs, board arcs, circles) is
flattened at `MAX_CHORD_DEVIATION_MM = 0.01` with a documented bias so the polygon errs on the
safe side. That was the right price for one model, and it left three recorded debts: connectivity
can fabricate contact between two same-net rounded pads that are physically open (06 §5, Astra S7
#5); copper tangent to a curved board edge is reported off-board or short of clearance by up to
the chord deviation (02 §6); and a true-simple contour whose feature lies closer to an arc than
the deviation is rejected as self-intersecting (02 §3, S2 #8). The Gerber Profile ships the
chords, although the contour type promises true curves, and no check judges the board material's
minimum web.

This session pays those debts with **one exact model of every curved shape**, consumed by
connectivity, DRC, the outline verdict, the editor's contour gate and the Profile. Chord rings
stay as the broad phase and as the polygon-only consumers' input (fill, snapshot, canvas) — never
as a verdict where an exact answer exists. Polygon pads (trapezoid / custom) are re-owned by
**S12c** (user decision 2026-09-11).

## 0. Scope

In scope: the rounded-shape model of copper (`src/shared/pcb-geometry/rounded-shape.ts`) and
its consumers (`drc/pair-gap.ts`, `pcb-connectivity/touch.ts`, `checks/board.ts`,
`checks/keepouts.ts`); the canonical contour and the exact arc kernel
(`src/shared/pcb-geometry/exact-arcs.ts`); outline validity on the exact contour
(`checks/outline.ts`, `rendering/pcb/contour-validation.ts`); the certified-interval board-edge
verdicts (`board-region.ts`, `checks/board.ts`); the board-material minimum web
(`OUTLINE_MIN_WEB`, `OUTLINE_WEB_UNCHECKED`); the Gerber Profile with true arcs
(`export/gerber/writer.ts`); the design-rule field `outline.minWebMm`.

Items earlier sessions tagged "S12b", with their disposition:

| Item | Source | Disposition |
|---|---|---|
| Exact arcs for non-circular pads in clearance AND connectivity (circumscribed oval / roundrect rings fabricate contact across ≈ 2 µm) | 06 §5, 02 §7, Astra S7 #5 | **S12b** — §1 rounded shapes |
| The chord-band second chance (copper tangent to a curved edge reported by ≤ 0.01 mm) | 02 §6, 06 §5 / §9 | **S12b** — §4 certified interval |
| Exact-arc contour validity (a return edge 0.002 mm inside a fillet rejected) | 02 §3, S2 #8 | **S12b** — §3, DRC and editor gate |
| Gerber true arcs | 02 §4 / §6 | **S12b** — §6 Profile |
| Board-material minimum web; the whole outer outline narrower than a limit; `OUTLINE_SLOT_WIDTH` double-reporting a material web | 02 §6, 06 §9, S2 #11 | **S12b** — §5 |
| Trapezoid / custom pad outlines (importer degrades to rectangles; `exactShape === false`) | 10 §0 / §10, 06 §2 / §9, 11 §0 | **Not S12b** — re-owned by **S12c** (three shared packages, a third tag round, no fixtures exist); `exactShape` is unchanged here |

Out of scope, recorded as limits with owners in §10.

Coordinate domain: every number in this contract is **millimetres** (the DRC item domain) unless
it says degrees or nanometres; persisted geometry is integer nanometres converted once by
`/ 1_000_000` (exact to 1e-13 mm for `|x| ≤ 1e9 nm`, 02 §4). Gerber is X4.6 (1 nm). Tolerances:
`GEOM_EPS_MM = 5e-7`, `DRC_EPS_MM = 1e-6`, `SHORT_EPS_MM = 1e-4`; regimes as 06 §5. Tolerances
are dimension-specific — a length epsilon is never applied to a squared distance, an angle or an
area; every kernel names the quantity its epsilon guards.

## 1. Rounded shapes — copper is a convex core ⊕ a disc

### 1.1 The model

Every copper primitive OpenPCB has is the Minkowski sum of a convex point set with a disc:

```
RoundedShape = { core: PcbPointMm[]; radiusMm: number }   // world mm, core convex, 1..n points
```

| Copper | `core` | `radiusMm` | Notes (inputs pinned to `pad-outline.ts` / `copper-records.ts`) |
|---|---|---|---|
| `circle` pad | `[c]` | `widthMm / 2` | `heightMm` is IGNORED — the one interpretation `discOf`, the annular kernel and the writer share (10 §7). |
| `oval` pad | spine: `w >= h` ⇒ `[(cx − (w−h)/2, cy), (cx + (w−h)/2, cy)]`; else along Y | `min(w, h) / 2` | Matches `stadiumRing`'s `w >= h` switch. `w === h` ⇒ a zero-length spine (legal: a 2-point core whose points coincide is a point). |
| `roundrect` pad | the 4 corners of `(w − 2r) × (h − 2r)` | `r = min((roundrectRatio ?? 0.25) · min(w, h), w/2, h/2)` | `roundRectRing`'s formula incl. the `?? 0.25` default. `r = 0` ⇒ the rect. Full radius in one dimension ⇒ two corners coincide (a spine); in both ⇒ a point. Coincident corners are kept as-is — `convexDistance` treats them as one point, never as a degenerate edge. |
| `rect`, `trapezoid`, `custom` pad | the record `ring` | `0` | Unchanged geometry (S12c owns the true outlines). |
| any pad whose radius-setting dimension is not finite or not `> 0` | the record `ring` | `0` | The `discOf` guard, mirrored (R1 #3): a negative `widthMm` must never become a negative radius (a 0.498 mm gap read 2.5 mm). Today's ring path, conservative. |
| trace segment | `[a, b]` | `widthMm / 2` | |
| via | `[c]` | `radiusMm` | |

Core points go through the SAME transform chain as ring vertices — `rotate(v, pad.rotationDeg)`
→ `+ pad.centerMm` → `transformPadCenterMm(local, placement.rotationDeg, mirrored)` (mirror X
first, then rotate, with `pad-geometry.ts`'s exact-integer branch for cardinal angles) — never a
composed matrix. A composed matrix yields `6.1e-17` where the chain yields `0` at 90°, which
moves `measuredMm` at the last bit and re-ids goldens. Test: for a `rect` pad at 90° on a
mirrored placement, every core vertex is bit-identical to the `padOutlineWorldMm` vertex.

`PadCopperRecord`, `DrcPad` and `CopperItem` gain `rounded: RoundedShape`. **`disc` stays** —
it has 56 read sites outside tests (the pour, the copper-shape unit, `keepout-predicates.ts`,
`copper-items.ts`, tests) and is exactly `rounded` with a 1-point core. `ring` stays for the
broad phase (`bounds`), the pour, the copper-shape unit and the artwork. `exactShape` is
unchanged (S12c).

### 1.2 Kernels (`rounded-shape.ts`)

- `convexDistance(A, B)` — the exact Euclidean distance between two convex point sets of 1..n
  points, DISPATCHED BY ARITY (Astra run 1 #1: `polygonToPolygonDistance` returns `Infinity` for a
  ring of fewer than two points, so a one-point core must take the point–polygon primitive): point–point, point–segment, point–polygon, segment–segment (the S2
  `segmentToSegmentDistance`), segment–polygon, polygon–polygon (vertex–edge pairs, 0 when the
  polygons intersect). **When both radii are 0 it DELEGATES to the primitives the pair kernels
  call today** (`polygonToPolygonDistance`, `polylineToPolygonDistance`,
  `circleToPolygonDistance`, `segmentToSegmentDistance`) so every `rect` / `trapezoid` / `custom`
  verdict is byte-identical to S12 — the synthetic corpus is ≈ 10 % trapezoid pads
  (`helpers/drc-synthetic.ts`).
- `roundedGap(A, B) = convexDistance(A.core, B.core) − (A.radiusMm + B.radiusMm)` — the radii are
  SUMMED FIRST, exactly as today's `disc` arithmetic `distance − (rA + rB)` groups them, so a pair of
  true circles is byte-identical (Astra run 1 #16: `(0.2 − 0.05) − 0.05 = 0.10000000000000002`). For filled sets
  `d(K_A ⊕ B_rA, K_B ⊕ B_rB) = max(0, d(K_A, K_B) − rA − rB)` (Astra run 0), so the gap is EXACT
  for separation and contact under rotation and reflection. A negative value means overlap; its
  magnitude is a LOWER BOUND on the penetration depth, not the depth (two coincident squares with
  `r = 0` return 0) — the short tier reads only `gap ≤ SHORT_EPS_MM`, and no consumer reports a
  rounded overlap depth as a measurement.
- `roundedTouch(A, B, eps = CONNECT_EPS_MM) = roundedGap(A, B) ≤ eps`.
- `roundedOverlapsRing(A, ring)` — positive-area overlap with a simple ring, DIMENSION-AWARE:
  `convexDistance(core, ring) < r − GEOM_EPS_MM` (arity-dispatched — a point core uses
  `pointToPolygonDistance`; Astra run 1 #1 built a circle pad half inside a keepout that every arm
  missed through the `Infinity` return), OR any core point strictly inside the
  ring (a point or segment core has no 2-D interior — a small pad wholly inside a keepout must
  still overlap it), OR (3+-point core) the core interior meets the ring interior
  (`ringsOverlapPositiveArea`).
- Region predicates live in `board-region.ts` (§4): `roundedInsideRegion`,
  `regionBoundaryDistanceRounded`, `roundedPenetration` — implemented in `region-rounded.ts` /
`region-exact.ts` next to it (not re-exported from `board-region.ts`: they consume its
predicates, and a re-export would close an import cycle — R1 scope note).

### 1.3 Consumers

| Consumer | Before | After |
|---|---|---|
| `pair-gap.ts` `padPadGap`, `padViaGap`, `tracePadGap`, `segmentPadGap`, `copperHoleGap` | `disc` ⇒ exact circle math, else circumscribed ring distance | `roundedGap` on the two rounded shapes (a trace segment / via / hole stadium is a rounded shape too) |
| `touch.ts` `padTouch`, `endCapTouches`, `viaTouchesOnLayer` | `disc` ⇒ exact, else ring–ring / ring–segment | `roundedTouch` / `roundedPolylineGap` — this closes the false-CONTACT limit: two same-net rounded pads physically 2 µm apart are now OPEN and raise `UNCONNECTED_NET`; the end-cap and via-layer tests (`TRACK_DANGLING`, `VIA_DANGLING`) read the same shape, so the graph and the dangling checks never contradict each other on one copper pair (R1 #2) |
| `checks/keepouts.ts` pad branch | ring overlap | `roundedOverlapsRing` |
| `checks/board.ts` pad branch (both bodies, §4) | `disc` ⇒ point distance − r with halo `edgeHalo + r`; else ring distance with halo `edgeHalo` | `regionBoundaryDistanceRounded` with **halo = `edgeHalo + rounded.radiusMm + maxBoundMm`** (a core-based distance is in the disc regime — a plain `edgeHalo` returns `Infinity` and silently DROPS the verdict for a pad whose core sits between `edgeHalo` and `edgeHalo + r` from the edge; and the §4 interval needs every boundary that could lower a candidate distance by the ring bound, or the indexed body certifies a PASS the exhaustive body would make ambiguous — Astra run 1 #2); containment `roundedInsideRegion`; penetration `roundedPenetration` |
| the S8 live gate (`legality.ts`) | — | inherits through `judgeCopperPairs`, `boardItems`, `keepoutItems` |

Not switched, recorded: the pour's pad halos (record ring, conservative — 04 §4); the
copper-shape unit union (11 §5: circumscribed inputs by construction); the artwork mask ring (11
§1.3: an opening circumscribes as a pad ring does; the mask checks judge openings against
openings, both circumscribed, so the relative error is the same on both sides);
`keepout-predicates.ts` (route obstacles are AABB supersets); the broad-phase `bounds`.

### 1.4 What changes on a board

Only pairs involving an oval or roundrect pad, and only by the circumscription error:
`sec(π/48) − 1 ≈ 0.2146 %` of the cap radius for an oval, `sec(π/24) − 1 ≈ 0.8629 %` of the
corner radius for a roundrect (six chords per quarter). An OPEN pair can never become CONNECTED:
cores ⊆ rings ⇒ `d(K_A, K_B) ≥ d(P_A, P_B)` (Astra run 0). Removed contacts lie within the two
pads' combined circumscription error plus `CONNECT_EPS_MM`. That is a statement in REAL
arithmetic: `touch.ts`'s old `discGap` grouped the radii successively (`d − rA − rB`) while
`pair-gap.ts` summed them first, and the one kernel now sums first everywhere, so a circle pair
whose gap is EXACTLY `CONNECT_EPS_MM` (0.5 nm — five atoms) can flip either way by one ulp of the
regrouping (R1 #1: 5 of 20 nanometre-grid cases at exactly 0.5 nm; symmetric in a ±60-ulp sweep).
The monotonicity test asserts the real-arithmetic form: a true gap `≥ CONNECT_EPS_MM + 1e-12`
never reads connected, `≤ CONNECT_EPS_MM − 1e-12` always does. Clearance `measuredMm` GROWS by at
most that error for SEPARATED pairs; a verdict flips only inside it (false-fail → pass). For an
OVERLAPPING pair the measure can change by more — a rounded core contained in a rect read gap 0 and
now reads `−r` (Astra run 1 #16) — the short tier's verdict is unchanged and `measuredMm` is never
hashed. Goldens: `golden-holes-4l`
(4 oval, 1 roundrect pad) and `golden-pours-2l` (1 oval, 1 roundrect) — attributed per row in
their `.md`; `golden-cutouts-2l` has no oval / roundrect PAD (its three roundrects are the
outline and two cutouts) and is byte-identical under §1.

## 2. The canonical contour and the exact arc kernel (`exact-arcs.ts`)

### 2.1 One curve per arc

A `PcbOutlineSegment` arc is `{ to, centerMm, cw }` — centre, END point and direction; the
radius is implicit and the start / end radii may differ within the validator's acceptance band
`max(1e-3, 1e-3·r)` (`contour-validation.ts`). A tolerance is not a curve: distance, intersection,
area and export would each pick a different shape (Astra run 0). **The canonical curve: the
circle of the START radius `|start − c|` about the authored centre, swept in the authored
direction from the start angle to the angle of the authored `to`; the arc's effective end point
is the projection of `to` onto that circle along the ray from the centre; the next segment starts
there.** **The canonical curve is DERIVED, never persisted** (Astra run 1 #11: a radially projected
endpoint rounded back to integer nanometres changes the radius by ≤ 0.7 nm, so "write once" is
not a fixed point — a second save moves it another nanometre). `canonicalContour(contour)` is a
pure, deterministic function of the AUTHORED integer geometry, applied inside the ONE derivation
every consumer shares: `flattenOutline`, `exactContour`, the validator's geometric arms, the
region and the Profile all call it; the `pcb-store` hydrator and the executor keep the authored
coordinates. Every board — old rows included — therefore reads one curve, with no data change and
no release-note event (this refines the user's "write + read" decision of 2026-09-11: the intent,
one curve on every board, is met on the read side alone). Order of operations (Astra run 1 #8:
projecting before validation erases a 1 mm authored mismatch): (1) validate the AUTHORED contour's
finiteness, radii (`arc-radius-mismatch` on the authored radii, band `max(1e-3, 1e-3·r)`),
`full-circle-arc`, `too-few-segments`; (2) canonicalise; (3) validate the CANONICAL ring's
geometry (§3 simplicity, area, closure). Closure (Astra run 1 #9): the chain of projections ends at
the last arc's projected end, which may miss the authored `start` by ≤ the band; the canonical
ring then carries an explicit closing SEGMENT from that point to `start` as an ordinary exact
primitive (flattened, validated and exported like any line; dropped only when it quantises to
zero length in the Profile) — never a snap that re-introduces the mismatch, and immune to
`CONTOUR_POINT_EPSILON_MM = 1e-3`, which is an authoring-time coincidence rule, not a rule of the
derived ring. Displacement bound (Astra run 1 #10): each arc's end moves by ≤ its own authored
mismatch ≤ `max(1e-3, 1e-3·r)`, and consecutive arcs CHAIN (each arc's radius is taken from its
moved start), so the bound over a run of `n` consecutive arcs is `n·max(1e-3, 1e-3·r)`; topology
and the sign of the exact area are NOT invariant under that displacement, which is why step (3)
re-validates the canonical ring and a ring that becomes non-simple is `BOARD_OUTLINE_INVALID`
(never silently accepted). `flattenOutline`'s annulus arm (02 §3 "mismatched arc endpoints") is
dead and removed; its tests re-target canonical input.

The closing segment is appended whenever the last effective point misses `start` by more
than `GEOM_EPS_MM` — including an AUTHORED open contour (R1 #7); that is harmless because the
validator's `not-closed` arm judges the authored contour first (§3.2) and a persisted open
contour then still gets a closed exact ring for DRC rather than an undefined one.
Conventions: `cw` + start angle + end angle ⇒ a sweep in `(0, 2π)`; equal start / end within
`GEOM_EPS_MM` is `full-circle-arc` — refused, as today (a circle is the `circle` kind); a
`circle` outline with `|widthMm − heightMm| ≤ GEOM_EPS_MM` is two 180° arcs; an ELLIPSE
(`w ≠ h`) has no circular form and is a `{ kind: "chords" }` ring (§2.4).

### 2.2 Primitives

```
ExactSeg  = { kind: "seg"; a; b }
ExactArc  = { kind: "arc"; c; r; a0; sweep }          // sweep signed, 0 < |sweep| ≤ 2π
ExactRing = { prims: (ExactSeg | ExactArc)[] } | { kind: "chords"; ring: PcbPointMm[]; boundMm }
exactContour(outline: PcbBoardOutline): ExactRing
exactContourBounds(ring: ExactRing): RingBounds       // true arc extrema, not chord vertices
exactRingSignedArea(ring: ExactRing): number          // = contourSignedArea, exported in place
```

`rect` / `polygon` ⇒ segments; `roundrect` ⇒ `roundRectPoints`' clamping reproduced (corner
radius 0 ⇒ four segments; full radius in one dimension ⇒ two half arcs and two segments —
zero-length segments dropped; full in both ⇒ two half arcs); `circle` ⇒ two 180° arcs, or
`chords` for an ellipse; `contour` ⇒ its canonical segments and arcs. A closure residue below `GEOM_EPS_MM` that survives
canonicalisation is snapped onto `start` by rewriting the last primitive's end vertex `b` (an
arc's `c` / `r` / `sweep` are untouched, so its circle misses `b` by ≤ 5e-7 — R1 #8), which is
what lets the ring close to the bit for the half-open ray rule; a residue above `GEOM_EPS_MM`
is the explicit closing segment of §2.1.

### 2.3 Kernels

All closed-form, returning the TRUE distance — 0 only on a true intersection; predicates apply
`GEOM_EPS_MM` themselves (a within-epsilon approach is contact for a predicate, not a zero
distance for a measurement).

- `pointToArcDistance(p, arc)` — the radial foot if its angle lies in the arc's range, else the
  nearer endpoint; `p === c` ⇒ the deterministic witness is the arc's start point.
- `segmentToArcDistance(seg, arc)` — candidates: the segment point nearest the centre, projected
  radially, when in range; both arc endpoints to the segment; both segment endpoints to the arc;
  0 on intersection.
- `arcToArcDistance(a, b)` — circle–circle closest points (external for separated circles,
  INTERNAL for nested circles — `|d − |r1 − r2||`) when both feet are in range; else endpoint
  candidates; coincident circles with overlapping ranges ⇒ 0 with an INTERVAL witness;
  concentric unequal circles with overlapping ranges ⇒ `|r1 − r2|` with the canonical witness at
  the smallest common angle; 0 on intersection.
- `segmentArcIntersections`, `arcArcIntersections` — points within `GEOM_EPS_MM` of both
  primitives; tangency = one point; coincident-circle overlap = an interval (returned as such,
  §3 treats it as a boundary retrace). Zero-length segments and collinear segment overlap have
  explicit arms.
- `primsIntersect(p, q, eps)`.
- `pointInExactRing(ring, p)` — boundary membership first (within `GEOM_EPS_MM` ⇒ on the
  boundary, reported separately from inside / outside); then arcs are split at their vertical
  extrema into y-monotone pieces and a horizontal ray is cast with ONE half-open rule: a piece
  crosses iff `y_min ≤ y_ray < y_max`; horizontal pieces are ignored; multiplicity is KEPT — a
  local minimum on the ray contributes two crossings, a local maximum none (Astra run 1: collapsing
  the minimum to one crossing is wrong); a vertex shared by two pieces is counted by the pieces
  that own it under the half-open rule, once per piece.
- Witness tie-break (determinism, §7): intersection points are returned sorted by `(x, y)`;
  `closestPointOnArc` prefers the radial foot over an endpoint at a tie. Total and
  input-order-independent (R1 #6 — the earlier "angle first" wording is withdrawn).
- `exactRingSignedArea` evaluates `θ − sin θ` stably for small θ (series below 1e-3 rad).

### 2.4 Ellipses

A `circle` outline or cutout with `w ≠ h` is an ellipse. It has no finite circular-arc form;
point distance to an ellipse is a quartic and Gerber has no ellipse primitive. It is
`{ kind: "chords", ring, boundMm }` — its default flattening with its stated deviation bound —
in every consumer of this contract: validity uses the chord rules on it, the certified interval
counts `boundMm` on both sides and never reaches "exact" through it, the Profile emits its
chords. Stated limit (§10) with a test. A conic primitive with a certified distance is the
recorded option if ellipse accuracy is ever required.

## 3. Outline validity on the exact contour (`checks/outline.ts`, `contour-validation.ts`)

`BoardRegion.exact = { outer: ExactRing; holes: ExactRing[] }` (§4) is what
`outlineProblems` reads (its `OutlineInput` gains it). Rules — validity must survive
subdivision and merging of equivalent primitives (Astra run 0):

- (a) a non-finite coordinate, or `|exactRingSignedArea| < 1e-6 mm²` (a POLICY threshold, not
  a geometric one — stated). There is NO primitive-count rule: two semicircles are a circle, a
  semicircle plus its diameter is valid.
- (b) simplicity: two NON-adjacent primitives of one ring intersect (inclusive within
  `GEOM_EPS_MM`), or two adjacent ones intersect anywhere but their shared endpoint(s) — a
  TWO-primitive ring (a `circle` kind = two semicircles) shares BOTH endpoints and both junctions
  are legal (Astra run 1 #12), or two
  arcs on one circle overlap over an interval (a boundary retrace), or a primitive is degenerate
  (zero-length segment, zero-radius arc; equal start / end = `full-circle-arc`). A sweep of
  `2π − ε` plus a short closing chord is VALID; a short chord is not evidence of degeneracy.
- (c) cutout in outline: no cutout primitive intersects an outer primitive; one cutout point is
  strictly inside the outer (sufficient for a simple cutout disjoint from a simple outer); every
  cutout primitive's distance to the outer is `> GEOM_EPS_MM`.
- (d) cutout separation: no intersection and distance `> GEOM_EPS_MM` between primitives of
  two cutouts (touching, abutting, internally tangent ⇒ invalid, zero material).
- (e) NEW — nesting: a cutout with a point strictly inside another cutout is invalid (concentric
  cutouts pass every pairwise rule, today and under (b)–(d); the message says "merge them").
- `{ kind: "chords" }` rings use today's chord rules (`ringSelfIntersects` on the refined
  unbiased ring, the biased containment / separation).

Consequences: a return edge 0.002 mm inside a fillet is VALID (S2 #8 closed); a circular cutout
0.005 mm outside the board is INVALID (today caught only by the biased rings; now exact). The
chord rules stay as the ORACLE in tests: wherever the chord verdict and the exact verdict
disagree, the feature that decides must lie within the chord deviation of an arc.

### 3.1 Messages and ids

`BOARD_OUTLINE_INVALID` is location-hashed and the goldens pin `violationIds`; today's nine
drafts map as follows (locations unchanged unless stated):

| Today (`outline.ts`) | Rule | Message | Location |
|---|---|---|---|
| outline non-finite `:51` | (a) | unchanged | unchanged |
| outline empty / zero area `:58` | (a) | unchanged | unchanged |
| outline self-intersects `:62` | (b) | unchanged; retrace / degenerate primitive add their own wording | the exact intersection point (was: the chord crossing). NOT bounded by the chord deviation: near a tangency the crossing-angle amplifies the error (Astra run 1 #17: a 0.0012 mm sagitta moved a crossing by 0.024 mm), so the 0.1 mm id bucket CAN move — attributed per golden |
| cutout non-finite `:74` | (a) | unchanged | unchanged |
| cutout zero area `:78` | (a) | unchanged | unchanged |
| cutout self-intersects `:82` | (b) | unchanged | exact point (as above) |
| cutout touches / extends outside `:87` | (c) | unchanged | the exact contact point |
| cutouts i and j touch / overlap `:104` | (d) | unchanged | `boundsIntersectionCenter` as today |
| — | (e) | "cutout `<id>` lies inside cutout `<id>` — merge them" | the inner cutout's centre |
| fallback report `:117-121` | retired | — | — (no golden carries a fallback ring; `fallbacks` STAYS for the fill kernel, 04 §4) |

### 3.2 The editor gate

`validateContour` (`rendering/pcb/contour-validation.ts`) gates the draw tool, fillet / chamfer,
DXF import and the HTTP command parser; today its `self-intersects` arm runs on the CHORD ring
and would still refuse the S2 #8 contour after DRC accepts it. Its arm moves onto §3 (b) over
`exactContour` — one validity predicate for authoring and DRC (user decision). `arc-radius-
mismatch` (on the AUTHORED radii, before canonicalisation — §2.1), `full-circle-arc`,
`too-few-segments` (the type's structural minimum for an AUTHORED contour — a two-arc circle is
authored as the `circle` kind; this is not §3 (a)'s geometric rule), `zero-length-edge`, `degenerate-arc` and
`not-closed` stay. Zones, keepouts and rule areas keep `ringSelfIntersects` — they carry no arcs.

## 4. Board-edge verdicts on a certified interval (`board-region.ts`, `checks/board.ts`)

The chord region is `R_inner ⊆ R_true` within a per-ring bound (02 §4). One region cannot say
how far a verdict is from the truth; two can. `buildBoardRegion` gains the mirror bias
`"board-outer"` — circumscribe where `"board-inner"` inscribes and inscribe where it
circumscribes, so `R_inner ⊆ R_true ⊆ R_outer` — and `BoardRegion` carries:

```
inner: { outer, holes }            // today's rings — unchanged bytes, same RegionIndex
outerBias: { outer, holes, index } // the superset region
exact: { outer: ExactRing; holes: ExactRing[] }
boundMm: number[]                  // per ring: 0.01; r(1 − cos(π/512)) or r(sec(π/512) − 1) for
                                   // an arc capped at MAX_ARC_SEGMENTS (≈ 0.038 at r = 2000);
                                   // for a FALLBACK ring both sets are the unbiased ring and the
                                   // bound applies on both sides
```

Per item (trace stadium, via disc, pad rounded / ring, hole disc / slot stadium) and per verdict
(`COPPER_OFF_BOARD`, `COPPER_TO_BOARD_EDGE`, `HOLE_OFF_BOARD`, `HOLE_TO_BOARD_EDGE`):

```
m(R, item) = signed material margin: +boundaryDistance − r when the item is inside R,
             −(penetration) when it is not          (Astra run 1 #13: unsigned distances reverse
                                                    their order outside the region)
m_lo = m(inner, item)      m_hi = m(outerBias, item)      m_lo ≤ m_exact ≤ m_hi
inside_lo = insideRegion(inner, item)   inside_hi = insideRegion(outerBias, item)
fallback ring (in EITHER build — Astra run 2 #3: the outer build can fall back where the inner
               did not): that side loses its inclusion guarantee, its bound widens the interval,
               containment within `bound` of the ring's boundary is UNKNOWN (an item in a convex arc's omitted chord segment reads
               outside both — Astra run 1 #13)
```

- **Certified PASS** — `inside_lo` (known) and the rule's own regime function passes on `m_lo`.
  Byte-identical to today (same region, same floats, same `measuredMm`).
- **Certified FAIL** — `!inside_hi` (known), or the regime function fails on `m_hi`. Reported
  with today's inner-region `measuredMm` — byte-identical to today's FAIL.
- **Ambiguous** — containment differs or is unknown, or the regime VERDICT differs between
  `m_lo` and `m_hi` (the verdict, not "the threshold lies in the interval" — with the 0.5 nm
  grace the effective transition is `required − GEOM_EPS_MM`, Astra run 1 #13). Recomputed
  EXACTLY with the exact analogue of `polygonInsideRegion` (Astra run 1 #3: vertices inside +
  unsigned distance ≥ 0 accepted a pad whose edge crosses a notch): every core EDGE inside — split
  at its exact contact parameters with the outer and hole primitives, every sub-interval midpoint
  tested by `pointInExactRing` — AND no exact hole interior meets the core interior (hole
  primitive endpoints strictly inside the core, hole sub-segments' midpoints inside the core) AND
  for `r > 0` the exact distance from the core to every hole / outer primitive `≥ r − GEOM_EPS_MM`
  (a 1-/2-point core reduces to the point / segment forms); the margin = the exact signed
  distance over the primitives of every ring whose `exactContourBounds`, inflated by `r +
  required + boundMm`, meets the item; `measuredMm` signed as today (`inside ? gap :
  −max(penetration, GEOM_EPS_MM)`, penetration exact). The exact verdict and measure REPLACE the
  chord ones. Budget (Astra run 1 #18, run 2 #2): the exact path is bounded PER ITEM (a named constant of
  primitive comparisons through a bounds sweep, not all pairs — a shared per-run budget spent in
  input order made the id multiset depend on array order); an item that exhausts it keeps TODAY'S
  inner-region verdict and the report carries ONE per-run
  note — `OUTLINE_WEB_UNCHECKED` (info, unhashed, so the three emit sites — `outline`, `board`,
  `manufacturability` — merge into one row; `DrcReport` has no notes field, and this is the one
  existing "not fully answered" code with a `boardEdge` anchor; its label is "Board geometry not
  fully checked") — never a silent pass, never a silent drop. An ellipse (`{kind: "chords"}`)
  ring that decides an ambiguous verdict keeps the inner-region answer with a note in the message.

The indexed body's halo carries `r + maxBoundMm` (§1.3) so its candidate set contains every
boundary the interval can depend on — otherwise it certifies a PASS the exhaustive body makes
ambiguous (Astra run 1 #2). Both counterexamples Astra run 0 built against the earlier "witness
edge is an arc" trigger land in "ambiguous": the disc outside the inner polygon whose nearest edge is a cutout LINE has
`inside_lo = false`, `inside_hi = true`; the fallback-ring PASS at chord clearance 0.105 against
a true 0.095 and a 0.1 rule has `[0.095, 0.115] ∋ 0.1`. Clearance uncertainty is relative to the
required clearance, not to proximity — the interval carries it. A `{ kind: "chords" }` ring
(ellipse) contributes its `boundMm` on both sides and is never "exact": an ambiguous verdict that
depends on it keeps the inner-region verdict and is recorded as such in the message.

Containment of a rounded pad (§1.2): `roundedInsideRegion(R, A)` = the WHOLE filled core inside
(`polygonInsideRegion(core)` for 3+ points — every edge inside and no hole interior meets the
core interior — `segmentInsideRegion` for 2, `regionContainsPoint` for 1) AND THEN
`distanceToBoundary(core) ≥ r − GEOM_EPS_MM`. Never "one point inside": a rect core
`[9, 11] × [4, 6]` on a `[0, 10]²` board passes a one-point rule with `r = 0` (Astra run 0). The
core is measured as a CLOSED ring for 3+ points (`regionBoundaryDistanceRing`), as a polyline /
point for 1–2. `roundedPenetration(R, A)` = max over core vertices outside of their boundary
distance, plus `r`.

`checks/board.ts` is TWO bodies — `boardItemsExhaustive` (the S9 oracle, kept verbatim) and
`boardItemsIndexed`. Every edit of §1 and §4 lands in BOTH, in the same order; `signed` and the
penetration helpers are hoisted into one shared local so the two bodies cannot drift.
`drc-broad-phase-oracle.test.ts` (both modes byte-identical) is a gate of WP2 and WP4. The live
gate inherits through `boardItems`. Claim: every verdict outside the ambiguous band is
byte-identical to S12; only ambiguous verdicts change, attributed per golden. Cost: one extra
region + index per `runDrc`; the exact path runs on ambiguous items only.

## 5. Board-material minimum web (`OUTLINE_MIN_WEB`, `OUTLINE_WEB_UNCHECKED`)

### 5.1 The feature

A "web" is not a pairwise primitive distance (Astra run 0: subdividing a convex arc manufactures
a zero web; concentric arcs have a continuum of witnesses; a blocked nearest connector hides a
valid longer one; excluding adjacent primitives makes the result depend on segmentation). The
feature is defined by erosion, exactly as contract 11 §5 defines a copper neck: the board
MATERIAL region `M` = the canonical outer contour minus its cutouts, flattened at a FINE
tolerance (`flattenOutline` with a `stepMultiplier` giving ≤ 1e-4 mm deviation — 1 % of the
verdict band, not the 0.01 default; ellipses enter as their fine chords), is analysed by the S12
copper-shape kernel (`copper-shape-kernel.ts`: erosion cores at `r = w/2 − EROSION_MARGIN_MM`,
`SHAPE_ARC_TOLERANCE_MM`) with `w = outline.minWebMm`:

- a NECK — two material lobes joined through a channel narrower than `w`, located and measured
  as `COPPER_CONNECTION_WIDTH` is (the chord through the marker along the wall normal);
- an OPPOSING-WALL RESIDUAL — a component of `M − open(M, w/2)` whose CONTACT with the material
  boundary has TWO OR MORE CONNECTED COMPONENTS: the contact set is the part of the residual's
  boundary within `SLIVER_RESIDUE_EPS_MM` of ANY boundary ring (outer or cutout), and its
  components are counted along the residual's own boundary — two contact intervals separated by
  an interval on the erosion frontier are two components. A band between a cutout and the edge,
  an annulus between two cutouts, the short throat between two separate cutouts that the
  material still runs around (Astra run 1 #4: the copper kernel's union-find saw ONE core, no
  neck — a channel between two voids is a web even when the material stays connected), and a
  material finger between two arms of ONE cutout or of the outer ring (WP4 follow-up: the
  earlier "≥ 2 distinct rings" form missed it) all have two; a corner residue and a thin strip
  along a convex arc have one. On the current cutout vocabulary (`roundrect | circle | contour`,
  each one simple closed curve) a two-component contact on ONE ring always makes the pinch a cut
  vertex of the material, so the erosion splits two cores and the NECK arm already owns it — the
  contact rule is a second, independent detector there (bisection blind spots, budget) and is what
  keeps one-component residuals out of the report; its false-positive direction (a wavy single wall
  whose contact is interrupted where the wall bulges away) has no fixture in the corpus — stated. Thickness is MEASURED, never floored:
  the copper kernel's `SLIVER_THICKNESS_FLOOR_MM = 1e-3` does not apply (Astra run 1 #5: a
  0.0005 mm-thick board strip was discarded as numerical residue). No minimum length either — a
  web is a web at any length;
- a RING-PAIR WEB — the EXACT minimum distance `d` between the primitives of two DISTINCT boundary
  rings (outer vs cutout, cutout vs cutout; `primDistance` over `exactContour` prims, bounds-swept,
  budgeted) with `below(d, w)`: reported with `measuredMm = d`, exact, no band — between two distinct
  voids the material web IS the ring distance, and this arm needs no erosion (Astra run 2 #1: two Ø2
  circles 0.9 apart passed the erosion arms — the opening erased the throat before classification).
  A ring-pair row supersedes an erosion row whose marker lies within `w` of BOTH rings of the pair
  (the closest approach of two parallel walls is an interval, so a point-distance dedupe double-reported);
  the ring-pair witness is a best-of-candidates closest point (endpoints, projected endpoints, the
  interior stationary point, the antipodal projections) verified to lie midway between the two rings
  — an unverified witness is reported anyway (fail-open), `measuredMm` is always the exact distance;
- the EMPTY EROSION — no core survives and `area(M) > 0` (the area of the EXACT contour, computed
  BEFORE the kernel's 0.1 µm quantisation — Astra run 2 #4: a 98 nm-wide board collapsed to nothing;
  when the grid loses only PART of the material — more than `MATERIAL_GRID_AREA_FRACTION = 0.5` of
  the exact area — the check reports `OUTLINE_WEB_UNCHECKED` ("the erosion saw a different shape"),
  never a false "narrower everywhere" claim): the whole board is narrower than `w`
  (reported once at the material's centroid, Astra run 1 #5),

all report `OUTLINE_MIN_WEB`. A residual with ONE contact component (the opening's residue at a
convex corner or along a convex arc) is never a web — Astra run 1 #7 showed the
copper residual criteria report four corner slivers on a plain 10 × 10 roundrect. The analysis is
segmentation-independent and treats a uniform annulus as one residual. The material is flattened
with the `board-inner` bias (a SUBSET of the true material, so the chord error is false-fail
only) and the ACHIEVED per-ring deviation `δ` is carried after the `MAX_ARC_SEGMENTS` cap (Astra
run 1 #6: a 1e-4 request on an r = 100 circle is capped at 512 chords = 1.9e-3 achieved); the
verdict band is `(w − 3e-3 − 2·δ_max, w)` and the message states it; when `2·δ_max > w/10` the
certificate is unavailable and the check reports `OUTLINE_WEB_UNCHECKED` for that board (an
engineering limit, tunable, stated). Over-budget or a `CopperKernelError` ⇒
`OUTLINE_WEB_UNCHECKED` (info; anchor `boardEdge`) — never a silent pass. The kernel entry is a
new `analyseMaterialRegion` in `copper-shape-kernel.ts` sharing the erosion / residual machinery
with `analyseGroup` but with the ring-touch classification above; `analyseGroup` and every copper
verdict are unchanged.

`OUTLINE_SLOT_WIDTH` stays the fab-advisory VOID check (cutter access, `minSlotWidthMm`);
`findNarrowestSlot` skips a pair whose connecting segment has a point in material, so it stops
reporting material webs. Astra run 0: the two codes will not perfectly partition today's report
(chord artefacts, obstructed connectors) — an advisory, recorded.

### 5.2 Emitter, rule, registries

- Emitter: `checks/manufacturability.ts`, ONE call over the whole board material, OUTSIDE the
  `fabricator !== "custom"` branch (a design rule fires on every fabricator; the existing
  per-contour `millingAdvisories` cannot see a cross-contour web). Class `manufacturability`,
  severity warning, overridable, anchor `boardEdge` (the only outline anchor) — location-hashed;
  no new `DrcStage`.
- Rule: `PcbDesignRules.outline?: { minWebMm?: number }` — the S12 `silkscreen` / `solderMask` /
  `dfm` precedent: a `compactRules({ minWebMm: optNum(...) })` block AND the returned-literal
  entry in `parseDesignRules` (`pcb-store.ts`, hit on `read` and `update`); `routes.ts` casts
  `designRules` whole (no per-key allowlist — verified) and the executor needs nothing; the
  round-trip test joins `designer-pcb-view-state.test.ts`'s silent-drop suite. Absent ⇒ no
  verdict (user decision). A fab row `minBoardWebMm?` is added ONLY with a sourced value (URL +
  fetch date); neither the JLCPCB nor the PCBWay capability page fetched 2026-09-10 states one,
  so the fab tier emits nothing and no constant is invented.
- Registries: `DrcRuleCode` (`sdks/designer/types.ts`), `code-registry.ts` (shared AND the
  `modules/designer/backend/drc/code-registry` shim the census imports), `severity.ts`
  (`DEFAULT_SEVERITY_BY_CODE`, `RULE_CLASS_BY_CODE`), `violation-id.ts` `LOCATION_HASHED_CODES`,
  `drc-labels.ts` `CODE_LABEL`, `drc-census.test.ts`, `drc-cutout-milling.test.ts`,
  `drc-golden.test.ts` (`CORPUS_EXCEPTIONS` = `["COPPER_SHAPE_UNCHECKED",
  "OUTLINE_WEB_UNCHECKED", "ZONE_FILL_FAILED"]`).

## 6. Gerber Profile with true arcs (`export/gerber/writer.ts`)

`emitEdgeCuts` emits `exactContour(outline)` and `exactContour(cutout)`: `G75*` once after the
existing `G01*`; `G01*` before a run of line moves; `G02*` (CW) / `G03*` (CCW) before an arc
move `X..Y..I..J..D01*`, `I`/`J` = the centre offset from the arc's START point (signed, 4.6).
`rect` / `polygon` / ellipse stay lines (the two export tests on rect and polygon outlines are
byte-identical); `roundrect` = its clamped segments and quarter arcs; a circle = two 180° arcs;
the closing `D01` rule is preserved.

- **No centre repair in the writer.** A 1 nm endpoint mismatch on a near-full arc moves a
  bisector-repaired centre by `|r_end² − r_start²| / (2·|end − start|)` ≈ 7.07 mm (Astra run 0);
  the canonical contour (§2.1) already has consistent radii.
- **Quantise once, subtract in integers.** The centre and the endpoints are quantised to 1 nm
  once per arc; `I`/`J` are integer differences from that shared centre, so consecutive arcs on
  one circle reconstruct one centre. The residual start / end radius difference after
  quantisation is ≤ 1 nm.
- **Pieces of ≤ 90°, validated after quantisation.** Every arc is emitted split at the quadrant
  boundaries of its own circle, so no piece is a near-full turn; a piece whose QUANTISED start and
  end coincide (Astra run 1 #14: an arc starting 5e-13 mm past a quadrant boundary yields a
  zero-chord piece that a CAM reads as a full circle) is MERGED into its neighbour, and a piece
  shorter than 2 nm after quantisation is emitted as a line. Radius consistency: independent 1 nm
  rounding of the centre and of each endpoint bounds each endpoint's radius error by `√2 nm` and
  a piece's start / end radius difference by `2√2 nm ≈ 2.83 nm` (Astra run 1 #15 exhibited
  1.06 nm with an integer centre) — the bound the parity test asserts; the shared vertex between
  two pieces is quantised ONCE (no endpoint discontinuity). CAM acceptance of a ≤ 2.83 nm residual
  on a ≤ 90° arc needs verification (recorded).
- Direction follows the writer's axis convention (`y` is emitted unflipped — verified); the
  parity test asserts direction, since a reflection would reverse handedness.
- `.gbrjob` `outlineSizeMm` → `exactContourBounds`.

`tests/helpers/gerber-parse.ts` gains `G74`/`G75` and `G01`/`G02`/`G03` modal state and `I`/`J`
operands; strokes gain `arc?: { c, cw }`; an unparsed mode line is an ERROR in the parity test
(today an unmatched line is silently skipped). `gerber-outline-parity.test.ts`, per golden and on
`golden-arcs-2l`: loop topology (one closed loop per contour), direction, closure; the
reconstructed arc set (≤ 90° pieces merged) ≡ `exactContour` — centre and endpoints within 1 nm,
radius within `2√2 nm`; the parsed arcs' chord flattening ≡ `flattenOutline` within `MAX_CHORD_DEVIATION_MM`
(the canvas, snapshot and Profile describe one board). The 2e-6 mm pad-parity tolerance is not
reused — it is 4·`GEOM_EPS_MM` and proves distance only.

## 7. Report contract

- New codes `OUTLINE_MIN_WEB` (warning, `manufacturability`, `boardEdge`, location-hashed) and
  `OUTLINE_WEB_UNCHECKED` (info, `manufacturability`, `boardEdge`, unhashed). `NON_OVERRIDABLE`
  unchanged (8). No new stage (21).
- `OUTLINE_WEB_UNCHECKED` is also the exact-budget note of §3 and §4 (one merged row per run).
- The material-web analysis emits no `tick` (one indivisible board-level unit inside the
  `manufacturability` stage; ≈ 160 ms on `golden-arcs-2l`; not cancellable mid-way — stated).
- `BOARD_OUTLINE_INVALID` ids move where §3.1 says a location moves (exact intersection /
  contact points on arcs — NOT bounded by the chord deviation near tangency, Astra run 1 #17) and
  for the new nesting rule; attributed per golden.
- `measuredMm` of an OVERLAPPING rounded pair can turn negative where the ring path read 0 (§1.4)
  — ids are unaffected (`measuredMm` is never hashed).
- Determinism (06 §7 holds): the eight-array reversal invariant applies to UNORDERED
  collections; a contour's `segments` array is ordered geometry and is excluded by definition.
  Equal-distance witnesses (concentric arcs, coincident intervals, root ordering) resolve by the
  §2.3 tie-break; epsilon de-duplication runs on canonically sorted candidates; the exact kernel
  is closed-form — no iteration, no `Math.random`, no `Date`.
- Golden deltas, attributed per golden and per cause in each `.md`: §1 (oval / roundrect
  `measuredMm`, `holes-4l`, `pours-2l`), §4 (ambiguous band verdicts, `cutouts-2l` if a pre-flight
  run shows any), §5 (`OUTLINE_MIN_WEB` where `outline.minWebMm` is set — `golden-arcs-2l`, and
  `golden-cutouts-2l` if the fixture gains the rule: +1 on its 0.5 mm c4 ↔ c5 annular web).

## 8. Consumers

`runDrc` (both broad-phase modes), the live gate (`checkPendingCopper` → `boardItems`,
`judgeCopperPairs`, `keepoutItems`), the connectivity graph (`copperTouch`), the ratsnest and
`UNCONNECTED_NET` (through the graph), the command executor and the `pcb-store` hydrator
(`canonicalizeContour`), the editor's `validateContour`, the Gerber writer and `.gbrjob`. The
pour, the copper-shape unit, the artwork, the snapshot, the canvas and the 3D board are
unchanged consumers of the chord rings (§10).

## 9. Tests

- `pcb-geometry-rounded-shape.test.ts`: `roundedGap` vs a 4096-gon ring distance ≤ 1e-6 on
  random pad pairs of every shape / rotation / mirror; the S7 #5 2 µm open is OPEN; `r === 0`
  byte-identity against today's primitives over the synthetic corpus; core vertex ≡ ring vertex
  at 90° + mirrored; 1-/2-point cores; the halo case (a roundrect at `edgeHalo + r/2` from the
  edge is reported).
- `pcb-geometry-exact-arcs.test.ts`: distance / intersection oracles vs dense sampling ≤ 1e-6;
  every quadrant; tangency; coincident, concentric, nested circles; a point at the centre;
  `pointInExactRing` with rays through endpoints, tangents and extrema; canonicalisation of a
  mismatched arc; the ellipse `chords` arm; `exactContourBounds`.
- `pcb-geometry-board-region.test.ts`: `R_inner ⊆ R_true ⊆ R_outer` on the arc fixtures;
  `inner` byte-identical to today's rings; rounded containment incl. the `[9, 11] × [4, 6]` case
  and the closing-edge case.
- `contour-validation.test.ts` (17, Vitest + Bun): the S2 #8 contour accepted; the chord-vs-exact
  disagreement bound.
- `drc-audit-b4.test.ts`: the band cases; Astra run 0's two counterexamples and Astra run 1's
  #2 (indexed halo), #3 (pad edge across a notch), #13 (fallback chord segment; the
  `[0.0999994, 0.0999996]` interval) as fixtures.
- Astra run 1 fixtures elsewhere: #1 (circle pad half inside a keepout) in the keepout suite;
  #4 / #5 / #7 (two separate cutouts 0.5 apart on a 1.0 rule; a 0.0005-thick strip; a plain
  roundrect reports nothing) in the web suite; #8 / #9 / #10 / #11 (validation order, closure
  segment, chained displacement, derived-not-persisted round trip) in `contour-validation` /
  `exact-arcs` tests; #12 (two-semicircle ring valid) in the validity suite; #14 / #15 (zero-chord
  piece merged; the `2√2 nm` radius bound) in `gerber-outline-parity`; #16 (two circle pads at
  0.2 with r = 0.05 byte-identical) in `pcb-geometry-rounded-shape`.
- `drc-broad-phase-oracle.test.ts`: byte-identical with rounded pads AND the certified interval.
- `gerber-outline-parity.test.ts` (§6); `designer-export.test.ts` arc + cutout + mode-line cases;
  the rect / polygon outline tests byte-identical.
- Registry gates: `drc-census` (2 codes, both registry paths), `drc-severity`, `drc-golden`
  (every code provoked; `CORPUS_EXCEPTIONS` as §5.2), `drc-stages` (21), `drc-cutout-milling`.
- New golden `golden-arcs-2l`: a contour outline with a return edge 0.002 mm inside a fillet;
  tangent copper in the band on every arc kind incl. a capped arc and a fallback ring; the two
  Astra counterexamples; webs — an arc–arc annulus, a cutout–outline band, an outer neck, a
  polygon cutout with a lobe web and a void slot; concentric cutouts (invalid); an ellipse
  cutout; `outline.minWebMm` set; provokes `OUTLINE_MIN_WEB`.

## 10. Stated limits (owners)

Ellipse outlines / cutouts are chords everywhere incl. the Profile (§2.4); copper regions,
pours and silk arcs stay polygons in the Gerber (export backlog); the pour's pad halos and the
copper-shape unit consume circumscribed rings (04 §4, 11 §5); the artwork mask ring circumscribes
(11 §1.3); `keepout-predicates.ts` route-obstacle discs; the cloud snapshot outline is polygons
by schema; canvas / 3D chords; KiCad `tessellateArcChords` (16) at import — a `polygon` outline
carries no arcs and gets no true-arc export (library, out of program); chamfered roundrects;
trace arcs (`pointsNm` has no arc segment); zones / keepouts / rule areas on `ringSelfIntersects`;
`exactShape` semantics and polygon pads (S12c); the CAM interpretation of a ≤ 1 nm radius
residual on a ≤ 90° Gerber arc (needs verification); `OUTLINE_SLOT_WIDTH` vs `OUTLINE_MIN_WEB`
is not a perfect partition (advisory); a negative `roundedGap` is not a penetration depth; the exact paths (simplicity, ambiguity) are
budgeted per run and fall back to the chord verdict with a note (§4); the nesting rule (e) is
not budgeted (`O(k²)` over cutout pairs); fallback rings ARE authorable (R2: a huge-radius thin contour, two lobes meeting at 1 µm) and
are fixtured in `drc-audit-b4` / `golden-arcs-2l` after R2 or a CAPPED arc (needs `r ≳ 531 mm`; unit-tested at r = 600 instead); `checks/board.ts`
(1078 lines) and `manufacturability.ts` (525) exceed the 500-line guideline — a mechanical split
after the session, like the S12 files; the certified interval costs one extra biased region and
index per `runDrc` (`drc-audit-b4` B4-7's `flattenOutline` bound 4 → 6); a ring-pair web whose
connector crosses a third void is skipped by the material guard and caught by that void's own
pairs — a pair whose connector crosses a void AND whose witness is unverified reports (fail-open,
no fixture); the 16 s board-budget exhaustion fixture is left out of the suite (B4-11 exercises the
outline budget); intersection-witness ids
may move near tangency (§3.1); the web certificate is unavailable when the capped flattening's
`2·δ_max > w/10` (§5).

## 11. Amendments (applied when S12b closes)

`PROGRAM.md` (S12b row → done, Astra column = brainstorm + spec-attack + adversarial-verify,
exit gate, decisions bullet, NEW S12c row); `OPEN_FINDINGS.md` (§2 geometry notes, §5 limits);
`TODO.md`; contracts 01 §4 (the S1/S2 limit closed), 02 §3 / §4 / §6 / §7 (annulus arm retired,
`board-outer`, second chance → §4 here, divergence table), 04 §4, 06 §2 / §5 / §9 (the exact-arc
lines, `OUTLINE_SLOT_WIDTH`), 10 §0 / §10 (trapezoid / custom → S12c), 11 §0 (the S12b row →
here / S12c); `src/modules/designer/AGENTS.md`; `CLAUDE.md` tree (`exact-arcs.ts`,
`rounded-shape.ts`); the hardening skill's `scope-and-invariants.md`; memory.

## 12. Review ledger

### 12.0 Plan-critique (Opus, 2026-09-11) and Astra run 0 (brainstorm)

Plan-critique: 29 findings, 11 blockers, all folded — `disc` cannot be removed (56 sites);
three ring arms pin the rounded inputs (`?? 0.25`, `heightMm` ignored, the oval axis switch);
`r === 0` must delegate; the transform chain, not a matrix; off-board penetration for rounded
pads; no witness edge exists; two `board.ts` bodies; the indexed halo drops verdicts;
`stadiumInsideRegion` is open-polyline; `outlineProblems` sees chords only; nine messages are
id-load-bearing; the editor gate is chord-strict; zones stay on chords; `golden-cutouts-2l` is
all-parametric; `millingAdvisories` is per-contour and fab-gated; the parse sites corrected; the
`circle` outline is an ellipse; `emitContour` is Profile-only; golden shape census; WP re-split.

Astra run 0 (gpt-6-astra, xhigh, brainstorm, prompt-only, ≈ 40 min; packet
`scratchpad/s12b/astra-0-prompt.txt`, output `astra-0-output.md`): §1.2 exactness identity and
the OPEN→CONNECTED impossibility; the whole-core containment rule (§4); the canonical curve
(§2.1); no primitive-count rule, nesting, retrace, near-full sweeps (§3); the certified interval
replacing the witness trigger, with two executed counterexamples (§4); the erosion definition of
a web (§5); no centre repair, integer I/J, ≤ 90° pieces, topology-level parity (§6); the ellipse
exception (§2.4); determinism notes (§7). Lean: compact convex cores + one canonical contour +
exact checks after conservative broad-phase filtering — adopted.

### 12.1 Astra run 1 — spec-attack (2026-09-11, gpt-6-astra, xhigh)

Declared prompt-only (444-line packet = §1–§6 verbatim + 10 questions, `scratchpad/s12b/
astra-1-prompt.txt`); the read-only sandbox let Astra execute `bun -e` probes against the
repository's existing helpers, so most findings are EXECUTED counterexamples (recorded: the run
became repository-grounded on its own; nothing was written). Verdict: "The proposal fails several
completeness claims, including silent false passes." Eighteen findings, every one traced against
source before acting:

| # | Finding (Astra) | Severity | Disposition | Where |
|---|---|---|---|---|
| 1 | A one-point core against a keepout: `polygonToPolygonDistance` returns `Infinity` for < 2 points — a circle pad half inside a keepout passes every arm | blocker | **accepted** — `convexDistance` / `roundedOverlapsRing` dispatch by arity (verified: `pcb-clearance-geometry.ts:159`) | §1.2 |
| 2 | The indexed halo `edgeHalo + r` omits boundaries the interval depends on: a disc 0.205 from the chord boundary gets `Infinity` ⇒ certified PASS; the exhaustive body says ambiguous ⇒ FAIL — parity breaks | blocker | **accepted** — halo = `edgeHalo + r + maxBoundMm` | §1.3, §4 |
| 3 | The exact containment recipe (vertices inside + unsigned distance ≥ 0) accepts a rect pad whose top edge crosses a semicircular notch | blocker | **accepted** — the exact analogue of `polygonInsideRegion` (edge sub-intervals at exact contacts, hole-interior test) | §4 |
| 4 | Erosion with union-find misses a 0.5 mm web between two separate cutouts when the material stays connected around them (one core, no neck) | blocker | **accepted** — opposing-wall residuals: a residual touching ≥ 2 distinct rings is a web regardless of connectivity | §5 |
| 5 | The inherited 1e-3 thickness floor discards a 0.0005-thick board strip as numerical residue | blocker | **accepted** — no floor for webs; the empty erosion reports | §5 |
| 6 | A 1e-4 "fine" flattening is capped at 512 chords (r = 100 ⇒ 1.9e-3 achieved); two boundaries contribute two errors; 1e-4 is 3.3 % of the band, not 1 % | high | **accepted** — board-inner bias (false-fail only), achieved `δ` carried, band `(w − 3e-3 − 2δ, w)`, unchecked when `2δ > w/10` | §5 |
| 7 | Copper residual criteria report four corner slivers on a plain 10 × 10 roundrect | high | **accepted** — a residual touching ONE ring is never a web | §5 |
| 8 | Projecting inside `normalizeContour` before validation erases a 1 mm authored mismatch | high | **accepted** — validate the authored radii first, canonicalise, validate the canonical ring | §2.1 |
| 9 | Sequential projection leaves a closure gap; snapping re-introduces the mismatch; a short closing line is eaten by `CONTOUR_POINT_EPSILON_MM = 1e-3` | high | **accepted** — an explicit closing segment in the DERIVED ring, outside the authoring-time coincidence rule (verified `contour-validation.ts:25`) | §2.1 |
| 10 | The displacement bound is `max(1e-3, 1e-3·r)` per arc and CHAINS; topology and area sign can change | high | **accepted** — bound corrected (`n·tol` over a run), the canonical ring is re-validated | §2.1 |
| 11 | Projected endpoints persisted as integer nm are not a fixed point (another 1 nm on re-save) | high | **accepted** — the canonical curve is derived at read, never persisted (refines the user's write + read decision; intent met) | §2.1 |
| 12 | A two-primitive ring shares both endpoints; rule (b) and `too-few-segments` reject a valid circle | high | **accepted** — both junctions legal for 2-primitive rings; the editor's structural minimum stays for authored contours (a circle is the `circle` kind) | §3 |
| 13 | Unsigned distances reverse order outside the region; fallback containment near the band is uncertified; the ambiguity test must compare regime verdicts, not "threshold in interval" | high | **accepted** — signed margin `m_lo ≤ m_exact ≤ m_hi`; unknown containment on fallback bands; verdict-based ambiguity | §4 |
| 14 | Quadrant splitting can emit a zero-chord piece (start 5e-13 past a boundary) that a CAM reads as a full circle | blocker | **accepted** — pieces validated after quantisation, zero-chord merged, < 2 nm ⇒ line | §6 |
| 15 | Shared-centre quantisation does not bound the radius inconsistency to 1 nm (1.06 nm exhibited); the bound is `2√2·q` | high | **accepted** — bound corrected to `2√2 nm`; CAM acceptance needs verification | §6 |
| 16 | `(0.2 − 0.05) − 0.05 ≠ 0.2 − (0.05 + 0.05)` — byte identity fails for two plain circles; overlap measures exceed the circumscription bound | medium | **accepted** — radii summed first (today's grouping); overlap change stated | §1.2, §1.4 |
| 17 | Intersection-location error is amplified near tangency (0.0012 sagitta ⇒ 0.024 movement) — the "≤ chord deviation" bound is false | medium | **accepted as a contract correction** — ids may move, attributed | §3.1, §7 |
| 18 | Exact simplicity is O(P²) and the ambiguous path O(A·P) with no budget | medium | **accepted** — bounds sweep, per-run budget, fallback to the chord verdict with a note | §4, §10 |

Survived attack, per Astra: the rounded-distance identity (no negative penetration needed);
`edgeHalo + r` for threshold-only queries; the arc distance candidate families incl. nested and
concentric circles; the ray-parity rule as now stated (§2.3); validity of tangent-continuous arcs,
rejection of a same-circle 359° + 2° retrace, a cutout in another's concavity being valid.
Constants flagged "needs verification": `1e-6 mm²`, the projection tolerance's manufacturing
meaning, the web error band, CAM acceptance of quantised arcs, the 90° maximum sweep — all
recorded as engineering limits, none presented as sourced.

### 12.2 R1 — `reviewer-critical` on WP2 + WP3 (2026-09-11)

Executed probes (scratchpad `s12b/r1/`): exactness vs an independent 40 000-sample oracle
(worst 1e-10 over 2540 pairs); `core ⊆ ring` over 2520 combinations (2e-15); full-report byte
diff HEAD vs tree on 8 goldens + 18 synthetic boards × 2 broad phases (goldens byte-identical;
1034 `measuredMm` rows moved by ≤ 2 × 0.86 %·r on separated pairs, 2 verdict flips both
false-fail removals inside the band, 0 new violations); grid ≡ exhaustive 18/18; ray parity
7301 samples 0 disagreements; region ordering 0 violations; `boundMm` never exceeded incl. the
r = 2000 cap; idempotence 200/200; budget never returns a partial result. Verdict: fix-first.

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | Summed-first radii vs `touch.ts`'s successive grouping: 5/20 nm-grid circle pairs at exactly a 0.5 nm gap flip OPEN → CONNECTED; the monotonicity comment and §1.4 were stated as absolute | major | **accepted as a contract correction** — one kernel, one grouping; monotonicity is a real-arithmetic statement, the ±1 ulp window at exactly `CONNECT_EPS_MM` is recorded (§1.4) and the test asserts the real-arithmetic form (R1 #9) |
| 2 | `endCapTouches` / `viaTouchesOnLayer` still on the ring: graph says OPEN, dangling checks say CONNECTED on one pair | major | **accepted, fixed** — both switched to the rounded shape (§1.3) |
| 3 | No positivity guard: a negative `widthMm` becomes a negative radius, a 0.498 gap reads 2.5 (false pass) | major | **accepted, fixed** — the `discOf` guard mirrored (§1.1) |
| 4 | `exactSignedMargin` returns `marginMm: 0` with `inside: false` for an edge-crossing item | minor | **accepted, fixed** — `−max(penetration, GEOM_EPS_MM)` in both the exact and the chord `signedMargin`; WP4 must read `inside` |
| 5 | The lazy non-enumerable region fields vanish on spread ⇒ a `NaN` halo silently drops verdicts | minor | **accepted** — `Number.isFinite(halo)` assertion at every halo site (WP4); never clone a `BoardRegion` |
| 6 | Tie-break wording vs `(x, y)` sort | minor | **contract corrected** (§2.3) |
| 7 | A closing segment is appended to an authored-open contour too | minor | **stated** (§2.1) |
| 8 | The sub-eps closure snap rewrites an arc's `b` without its circle | minor | **stated** (§2.2) |
| 9 | No monotonicity test | minor | **accepted** — added with #1 |
| 10 | Hygiene: all files < 500 lines, no `any`, constants named | low | — |

### 12.3 R2 — `reviewer-critical` on WP4 (§3, §4) + WP5 (2026-09-11)

Executed against a frozen snapshot with an independent oracle (`scratchpad/s12b/r2/probes/`):
§4 end-to-end through `runDrc` on five arc boards, 4760 checks / 1002 in the band / 0 findings; a
0.4 µm sweep straight through the chord band, 0 findings; the Astra #3 notch at 5 µm resolution
flips exactly at the true crossing; full-report diff HEAD vs tree on 8 goldens + 27 synthetic
boards × 2 phases: only the census id move and 3 in-band false-fail removals, 0 additions;
grid ≡ exhaustive 35/35; §3 validity 17/17 (S2 #8 accepted by the gate AND DRC; 350° + 20°
retrace invalid; 1 mm authored mismatch still refused; `normalizeContour` ≡ authored); Gerber
parsed by an independent reader over 13 synthetic outlines + 9 goldens, 0 problems, rect /
polygon byte-identical, `.gbrjob` exact; determinism 10/10; the budget note emitted once and
merged; performance no regression (10k board 2.2 s vs 2.4 s). §5 (material web) excluded — under
concurrent edit; reviewed by Astra run 2. Verdict: fix-first.

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | The §3 budget note lands in `ctx.outlineDrafts`, `outlineInvalid` = "any draft", and the commit gate then DROPS `COPPER_OFF_BOARD` from its refuse set on a VALID 1204-primitive outline — a silent gate downgrade | major | **accepted, fixed** — `outlineInvalid` counts only `BOARD_OUTLINE_INVALID`; regression in the legality suite |
| 2 | "A fallback ring cannot be authored" is false (two constructed); the `unknown` arm is correct against the oracle but unfixtured; the §9 Astra fixtures were not all added | minor | **accepted** — fixtures added (two-lobe fallback contour, a budget-exhaustion board); §10 corrected |
| 3 | A one-primitive contour yields an EMPTY Profile with no warning (HEAD emitted its chords) | minor | **accepted, fixed** — chord fallback + export warning |
| 4 | `PROGRAM.md`'s S12b bullet still said "applied at write AND read" | low | **fixed** — bullet records the derived-at-read refinement |
| 5 | `board.ts` 1078 lines / `outlineProblems` 175 lines | low | recorded (§10 split follow-up) |
| 6 | The Vitest gate test asserts none of the gate-only arms | low | **accepted** — three tests added |

### 12.4 Astra run 2 — repository-grounded adversarial-verify (2026-09-11, gpt-6-astra, xhigh)

Packet `scratchpad/s12b/astra-2-prompt.txt` (84 lines; `-C OpenPCB`, read-only; the 609 focused
Bun tests run by Astra passed). Four executed counterexamples, all accepted, all fixed:

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | A SHORT cutout-to-cutout throat (two Ø2 circles 0.9 apart, rule 1.0) passes: the opening erases the throat and the residual splits into two one-wall crescents — the disc-reach blind spot again; §12.1 #4 was not fully resolved | high | **accepted, fixed** — §5.1 gains a third, erosion-free arm: the EXACT minimum distance between the primitives of every pair of DISTINCT boundary rings, `below(d, w)` ⇒ `OUTLINE_MIN_WEB` with `measuredMm = d` (exact, no band); ring-pair rows supersede erosion rows at the same place |
| 2 | The shared exact budget is spent in input order: reversing 200 pads on a 2000-segment outline changes 52 ids — the id multiset depends on order | medium | **accepted, fixed** — the budget is PER ITEM (`BOARD_EXACT_ITEM_BUDGET = 50 000` comparisons), so no verdict depends on what was evaluated before it; the note counts the items that kept the chord verdict; regression B4-12 (1400 segments × 250 pads, the smallest board that diverged under the shared budget) |
| 3 | `fallbackBoundMm` reads only the inner region's `fallbacks`; an outer-only fallback ring (a 400 mm slot cutout) certified a FAIL at 0.4928 for a true 0.5005 clearance | medium | **accepted, fixed** — fallback status and bound from BOTH builds; unknown containment / widened interval on the side that lost its inclusion guarantee |
| 4 | A 98 nm-wide board (area 0.0098 mm² > the degeneracy threshold) collapses on the kernel's 0.1 µm grid: no groups, area 0, `emptyErosion` false — nothing reported | medium | **accepted, fixed** — the material area is taken from the exact contour BEFORE quantisation; positive area with no surviving group reports `OUTLINE_MIN_WEB` |

### 12.4 Astra run 2 (pending)
