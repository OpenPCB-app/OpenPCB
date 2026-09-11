# 11 — DFM overlays and production checks (S12)

Status: **binding** (S12 closed 2026-09-11; every §12 ledger folded).

Sessions S1–S11 made copper, holes and the board region one physical model. This session adds the
production layers on top of it — silkscreen, solder mask, courtyards — and the copper-shape
hazards that no clearance rule sees (necks, slivers, acid traps, duplicated traces). The
governing principle is the one S11 established for pads: **a check may only judge geometry the
fab actually receives.** So this session first makes the artwork model explicit and shared, then
builds every check on it.

## 0. Scope

In scope: the silkscreen and solder-mask artwork model (`src/shared/rendering/pcb/artwork/`),
consumed by the Gerber writer and by the DFM checks; courtyard regions per side; the checks
`COURTYARD_OVERLAP`, `COURTYARD_INVALID`, `SILK_TO_MASK_CLEARANCE`, `SILK_TO_BOARD_EDGE`,
`FAB_SILK_CLEARANCE`, `FAB_SILK_WIDTH`, `FAB_SILK_TEXT_HEIGHT`, `MASK_BRIDGE`, `FAB_MASK_BRIDGE`,
`MASK_SLIVER`, `FAB_MASK_TO_COPPER`, `COPPER_CONNECTION_WIDTH`, `COPPER_SLIVER`,
`COPPER_SHAPE_UNCHECKED`, `TRACE_ACUTE_ANGLE`, `TRACE_OVERLAP`; the design-rule fields and fab
rows they read; the silkscreen export completion (footprint graphics and reference designators
were never exported; overlay `rect` / `circle` / `polygon` shapes were exported as their two
stored points).

Items earlier sessions tagged "S12", with their disposition:

| Item | Source | Disposition |
|---|---|---|
| Point / corner contact has zero conductive neck (S1 #4); the opening re-joins two lobes through a sub-`w` neck (04 #3); width not enforced on the union of same-net pours (04 #7) | 01 §4, 04 §7 | **S12** — `COPPER_CONNECTION_WIDTH` on the final copper (§5) |
| Duplicate coincident traces hide a stub (S1 #7) | 01 §4 | **S12** — `TRACE_OVERLAP` (§5.7) |
| A drilled `smd` / `conn` free pad opens the mask on its declared layer only | 06 §9 | **S12** — far-face drill relief, unconditional (§1.3) |
| `courtyard.ts` `pushCircle` is a 16-chord ring | 02 §7, 00 §4 | **S12** — the S2 arc kernel (§2.1) |
| Exact-arc contour validity (S2 #8), the chord-band second chance (S7), Gerber true arcs, exact arcs for non-circular pads in clearance, board-material minimum web (S2 #11) | 02 §3 / §6 / §7, 06 §5 / §9 | **Not S12** — re-owned by **S12b, "exact-arc geometry and polygon pads"**, a new session before S13 with its own contract and Astra spec-attack (user decision 2026-09-10) |
| Trapezoid / custom pad outlines (the importer degrades them to rectangles) | 10 §0 / §10 | **Not S12** — S12b (a rendering-core field; after the shared tags) |
| `thruHoleThermal` on a `std` free pad with `drillMm` 0; blocked-spoke relocation | 04 §5 / §6 | **Not S12** — pour backlog, listed for the S18 trust gate; not a DFM overlay |

Out of scope, recorded as limits with owners in §10.

## 1. The artwork model

Everything the fab receives on the silkscreen and solder-mask layers is built by ONE module,
`src/shared/rendering/pcb/artwork/`, from the projection. The Gerber writer emits the model; the
DFM checks judge the model. Neither may re-derive a stroke, an opening or a transform.

### 1.1 Placement transform — two predicates, not one

A placement has two independent geometric facts (`PcbScene.tsx`, `sdks/designer/pcb-helpers.ts`):

- **`mirrorX = placementMirrorX(placement) = placement.mirrored || placement.layer === "B.Cu"`** —
  every footprint-local point is transformed by `transformPadCenterMm(p, rotationDeg, mirrorX)`
  and translated by `positionMm` (the pad transform; contract 10 §1.1). Text is mirrored iff
  `mirrorX`, and the keep-upright rule receives `mirrorX`.
- **`sideFlip = placement.layer === "B.Cu"`** — the footprint's `F.*` layers land on the bottom
  face and its `B.*` layers on the top face iff `sideFlip`.

A `mirrored: true` placement on `F.Cu` is mirrored in X and its silk stays on the top face. The
two predicates are never merged into one. (Astra run 1 confirmed the algebra: a label's world
rotation composes as `placement ∓ label` under mirror exactly as a pad's does, `R(θ)·M·R(φ) =
R(θ − φ)·M`.)

### 1.2 Silkscreen

`buildSilkArtwork(projection): SilkArtwork` returns, per face (`top` / `bottom`):

- `SilkStroke { face, pointsMm: PcbPointMm[], widthMm, source }` — a polyline drawn with a round
  aperture of diameter `widthMm` (round caps and joins, exactly what `D02` / `D01` with a circle
  aperture produce). A stroke's deposited ink is the exact union of the segment stadiums; no
  check may approximate it by an inscribed polygon.
- `SilkRegion { face, ring: PcbPointMm[], source }` — a filled polygon (`G36` / `G37`).
- `source` is one of `{ kind: "placement", placementId, graphicIndex }`, `{ kind: "placement",
  placementId, labelId }`, `{ kind: "overlayShape", shapeId }`, `{ kind: "overlayText", textId }`.

Sources and their flattening (all in world millimetres, in this order — the writer's aperture
allocation order is the model order, so a board with only overlay lines and polylines exports
byte-identically to S11):

1. **Overlay shapes** (`projection.overlayShapes` on `F.SilkS` / `B.SilkS`), expanded exactly as the
   canvas expands them (`overlayShapePolyline`, moved from `OverlayLayer.tsx` `pointsForRender`
   into `artwork/overlay-shapes.ts`; the canvas re-exports it): `line` two points; `polyline` as
   stored; `polygon` closed back to its first point; `rect` the closed 5-point rectangle of its
   two stored corners; `circle` a closed 48-segment ring of radius `|edge − centre|`. Width
   `strokeWidthMm ?? 0.15` (a non-finite or non-positive stored width also becomes 0.15). `fill: "solid"` on `polygon` / `rect` / `circle` additionally yields
   a `SilkRegion` of the same ring.
2. **Overlay texts** (`projection.overlayTexts` on the silk layers): `textToStrokes(text, {
   originMm, sizeMm: fontSizeMm, rotationDeg, mirror, justify, anchorY: "middle" })` — `mirror`
   is the overlay's own flag; width `max(0.1, 0.15 · fontSizeMm)`.
3. **Footprint graphics** (`placement.footprint.preview.graphics` whose `layer` is `F.SilkS`,
   `B.SilkS`, `F.Silkscreen` or `B.Silkscreen` — the import whitelist admits both spellings), face
   per §1.1, every point through the placement transform: `line` two points; `rect` the closed
   rectangle; `circle` `ellipseChordRing(r, r)` (the S2 count); `arc3` the circumcircle of
   `start` / `mid` / `end`, sampled by `arcChordPoints` with `arcSegmentCount` (unbiased,
   `MAX_CHORD_DEVIATION_MM`), sweeping through `mid` (three collinear points ⇒ the polyline
   through them); `polyline` as stored, closed iff `closed`; `bezier` a 16-step de Casteljau
   polyline (recorded, §10). Width `strokeWidthMm`; a non-finite or non-positive authored width
   (KiCad `(stroke (width 0))` is real stock-library data — 68 silk graphics in 52 vendored
   footprints) becomes `DEFAULT_FOOTPRINT_STROKE_MM = 0.12`, the kicad-import default for a
   missing width, so the artwork always has a positive aperture and `FAB_SILK_WIDTH` judges it
   (R1 major 4). `fill: "solid"` on `rect` / `circle` / closed `polyline` additionally yields a
   `SilkRegion`.
4. **Footprint labels** (`preview.labels` on the silk layers): the text of a label with `role ===
   "reference"`, or whose text matches `${REFERENCE}` / `REF**`, is the placement's `reference`
   (`withPlacementReference`); its rotation is `uprightLabelRotationDeg(label.rotationDeg,
   placement.rotationDeg, mirrorX)` (the canvas keep-upright rule, moved to
   `src/shared/rendering/pcb/footprint-labels.ts`; the frontend re-exports); other labels keep
   their text and rotation. Position = the label anchor through the placement transform;
   rotation = `mirrorX ? placement.rotationDeg − labelRotation : placement.rotationDeg +
   labelRotation`; `mirror = mirrorX`; `anchorX` / `anchorY` from the label; width `max(0.1,
   0.15 · fontSizeMm)`.

`textToStrokes` moves to `artwork/stroke-font.ts` unchanged in glyph geometry and gains
`anchorY` (`top` / `middle` / `bottom` / the two baselines → a vertical shift of the cap box; the
existing callers pass `middle` and are byte-identical). The stroke width rule `max(0.1, 0.15 ·
size)` is THE text thickness for every text source; an authored thickness does not exist in the
preview model (§10).

### 1.3 Solder mask

`buildMaskOpenings(input): MaskOpening[]` with `MaskOpening { face, centerMm, shape: ApertureShape,
anchor: DrcAnchor, netId, copper: boolean, ownerKey }`. `ApertureShape`, `roundrectRadiusMm`,
`inflateShape` and `apertureFromShape` (the one pad-shape → aperture derivation) move to
`artwork/aperture-shape.ts` (`export/apertures.ts` re-exports them);
`apertureShapeRing(shape, centerMm)` builds the opening's ring with the `pad-outline.ts` builders
applied to the inflated dimensions (48-segment circle / oval, six arcs per roundrect corner,
sharp rect), so an opening's ring circumscribes its true shape exactly as a pad ring does — by
`sec(π/48) − 1 ≈ 0.215 %` of the radius on circles and ovals, by `sec(π/24) − 1 ≈ 0.86 %` of the
corner radius on roundrect corners (six chords per quarter turn); the checks state these as
their tolerance and every mask verdict is judged with the conservative bias (§4).

The rules are S11's (contract 10 §6.1 / §6.4), lifted out of the writer unchanged:

- a footprint pad record resolved on the face's copper layer: its aperture inflated by
  `board.solderMaskExpansionMm` per side; `copper: true`, `netId` = the record's, `ownerKey` =
  the record's item key;
- a copper-less unplated footprint drill (`maskOnlyDrills`): the drill relief on both faces;
  `copper: false`, `netId: null`;
- a free pad: `hole` opens its declared pad shape on both faces (the declared size of a `hole`
  free pad IS its authored mask opening — the KiCad NPTH-pad semantics S11 adopted, Astra 2b #3);
  `std` on both faces; `smd` / `conn` on their declared face; on EVERY face where a drilled free
  pad's shape is flashed, the drill relief is added too when the FLASHED aperture — the declared
  shape after its (possibly negative) expansion — does not contain the drill (a routed slot
  always, a round drill wider than the flashed aperture's narrow side — `uncoveredFreePadDrill`,
  all four pad types; R1 minor, Astra run 2 #2: a −0.2 expansion on a 1 × 1 `hole` pad with a 0.8
  drill flashed a 0.6 opening); expansion `pad.solderMaskExpansionMm ?? board`; `copper`
  = the pad has a record; `netId` = the pad's; `ownerKey` = the free pad's item key;
- an untented via (`protection === "none"`) on every face it touches: a circle of
  `diameterMm + 2 · expansion`; `copper: true`; `ownerKey` = the via's item key.

**Drill relief always contains the drill.** `drillReliefShape(drill, expansion)` uses
`drillMm + 2 · max(expansion, 0)` — a negative pad expansion contracts a copper pad's opening,
never a drilled void's relief (Astra run 1 #12). A relief whose computed dimension is not positive
is a data error and is reported through the export warnings, never flashed.

**06 §9 fix.** A drilled `smd` / `conn` free pad (its `drillMm > 0`; `freePadDrill` has no
pad-type gate, the Excellon and the DRC hole set already carry the drill) additionally opens the
**drill relief on the far face unconditionally** — `copper: false`, `netId` = the pad's,
`ownerKey` = the pad's. The `covered` short-circuit of `uncoveredHoleFreePadDrill` applies only on a
face where the pad shape itself is flashed. Without this the far face keeps solder mask over an
open NPTH.

`emitMask` allocates and flashes each opening in model order; `emitCopper` and `emitPaste` are
unchanged. Both models are built once per `BuildContext` (once per layer file, like the copper
records) from the projection the writer already holds.

### 1.4 Writer contract

- Strokes: `D02` at the first point, `D01` at every following point, with a circle
  `NonConductor` aperture of the stroke width; regions: `G36` … `G37` with the ring's vertices.
- Aperture allocation order = model order (§1.2). Boards with no footprint silk, no labels and
  no overlay `rect` / `circle` / `polygon` export byte-identically to S11 (asserted on every
  pre-existing export test by the `%ADD` sequence) — with two enumerated exceptions that remove
  an aperture which drew nothing: an overlay shape with fewer than two points and a
  whitespace-only overlay text no longer allocate a `%ADD` (R1 minor).
- Enumerated export changes (all fixes): footprint silk graphics and reference designators now
  appear on the legend layers; overlay rectangles, circles and polygons export as closed shapes;
  filled overlays export as regions; a drilled `smd` / `conn` free pad relieves its far face; a
  negative expansion no longer shrinks a drill relief.

### 1.5 Parity test

`gerber-silk-parity.test.ts` parses every golden's legend files (the parse helper gains stroke
and region capture) and asserts, per face and in order, one parsed stroke per `SilkStroke` and one
parsed region per `SilkRegion`, every vertex within 2e-6 mm, the aperture diameter within 1e-6,
and one parsed mask flash per `MaskOpening`. The S11 `gerber-pad-parity.test.ts` keeps its
independent reading of contract 10 §6.2. Gerber writes coordinates at 1 nm; the checks judge the
model in mm floats — the 1 nm rounding is below every DFM tolerance and is recorded (§10).

## 2. Courtyard regions

### 2.1 Building the region

`placementCourtyardRegionsMm(placement, lookupRaw, fallbackMm)` returns `{ top: Ring[], bottom:
Ring[], source: "courtyard" | "fallback" | null, malformed: boolean }`.

Courtyard graphics come from the placement's preview (`layer` `F.CrtYd` / `B.CrtYd`) or — only
when the preview has none on either side — from the raw KiCad footprint via `RawFootprintLookup`
(contract 03 §13, the S4 lookup; the two sources are alternatives, never merged). **The raw
payload is the parser's verbatim record**: points are `[x, y]` arrays (never `{x, y}`) and a
`poly` carries `pts`; one shared normaliser (`pcb-geometry/raw-graphics.ts`) reads both spellings for
`courtyard-rings.ts` AND the S4 hull reader in `courtyard.ts`, whose raw path had never matched a real row (R1 blocker —
every KiCad-imported placement would otherwise be `COURTYARD_INVALID` and judged on its bounds). Each graphic
yields **edges**: `line` one segment; `rect` four; `polyline` / raw `poly` one segment per side
(closed); `arc3` / raw `arc` one `EdgeSeg` carrying its arc; a `circle` bypasses chaining and
yields one closed ring directly (`ellipseChordRing`). Consecutive coincident points (within 0.01 mm) are collapsed and an already-closed ring is not
closed again, so no zero-length edge ever reaches the chainer (a duplicated closing vertex is
what every closed kicad-import polyline carries — R1 major 2). Duplicate edges are removed — two
straight edges are duplicates when their endpoint pairs coincide within 0.01 mm; two arcs only
when their endpoints, centre and sweep direction all coincide (two opposite semicircles share
endpoints and are both kept — Astra run 1 #16) — and the rest is chained by
`chainEdgesToLoops(edges, 0.01)`.

**`malformed` = an open chain or a branch** (a vertex with more than two incident edges — the
chainer takes an edge and continues, so the branch diagnostic is the only evidence); a degenerate
vertex is neither. Each loop
becomes a ring by the new shared flattener `loopToRing` (`src/shared/rendering/pcb/loop-ring.ts`;
the DXF `loopToContour` moves beside it and `import/dxf/to-outline.ts` re-exports it), arcs
sampled by the S2 kernel unbiased.

**Ring set → region (Astra run 1 #14).** Rings are classified by containment depth (the number
of other rings of the same side strictly containing a vertex of the ring): even depth = material,
odd depth = a hole. Material rings are oriented CCW, hole rings CW, and the side's region is the
**NonZero union** of the oriented rings. Two exterior rings that overlap (a body outline plus a
mating-area outline) therefore union into one region; a donut stays a donut; two rings of one
footprint crossing each other are material wherever either claims it.

Side assignment: a `F.CrtYd` ring is on the top face and a `B.CrtYd` ring on the bottom face,
swapped iff `sideFlip`; every point goes through the placement transform with `mirrorX` (§1.1).

Fallbacks: malformed ⇒ the region is the S4 **superset** hull (`placementCourtyardWorldMm(…,
{ superset: true })` — circles and arcs circumscribed, so the hull contains the true curve) on the
side(s) the graphics named, and `COURTYARD_INVALID` is reported. No courtyard graphics on either
path ⇒ `source: "fallback"`: the footprint's `preview.bounds` (pads and graphics; labels
excluded) — or, when the preview has no bounds but the placement has pads, the bounding box of
its pad rings — inflated by `fallbackMm` on every side (design rule `dfm.courtyardFallbackMm`,
default 0.25 mm — the IPC-7351B level B courtyard excess, `docs/designer/pcb-standards.md`
§2.1), transformed as a rotated rectangle, on the placement's own face only. Neither bounds nor
pads (an empty model) ⇒ `source: null`, no region, no check (§10).

`placementCourtyardWorldMm` keeps its convex-hull contract for the placer and the keepout extent;
its `pushCircle` samples circles with `ellipseChordRing` (the S2 count, circumscribed when
`superset`) instead of a fixed 16-gon. Any golden delta from that is attributed in §11.

### 2.2 Overlap

Per face, for every pair of placements whose region bounds meet: `intersection(regionA, regionB)`
in the copper kernel, operands in ascending placement-id order. The pair overlaps iff the
intersection's area is `> DEGENERATE_AREA_MM2` — touching courtyards and shared edges pass.
Location = the centroid of the intersection component with the largest area; equal areas are
broken by the smaller `(x, y)` centroid (a total order, Astra run 1 #22). A `CopperKernelError`
on a pair reports `COURTYARD_INVALID` for both placements with a "could not evaluate" message —
never a silent pass.

## 3. Silkscreen checks (`checks/silkscreen.ts`)

Items: every `SilkStroke` as the exact stadiums of its segments (half width `widthMm / 2`,
judged analytically — segment-to-polygon distance minus the half width — never as an inscribed
polygon; Astra run 1 #17), every `SilkRegion` as its ring. Mask openings from §1.3 as rings,
indexed by a `createBroadPhase` instance per face (openings as the `pads` kind).

**Filled-set gap.** The gap between a silk item and an opening is signed: positive when the
sets are disjoint (the edge distance), zero when their boundaries touch, negative when they
intersect or one contains the other — a stroke whose segment crosses the ring or lies inside it,
a region containing or contained by the opening. Containment is tested with a point-in-polygon
probe before any edge distance is trusted.

- **`SILK_TO_MASK_CLEARANCE`** (dfm, warning): a silk item and a mask opening on the same face with
  `gap < required − GEOM_EPS_MM` (`clearanceViolated`), `required = designRules.silkscreen.
  silkToMaskClearanceMm` (default 0 — only true penetration reports; silk touching an opening's
  edge passes). Anchors = the silk source's anchor (`placement`, `overlayShape`, `overlayText`)
  and the opening's anchor; location = the closest point for a positive gap, the penetrating
  vertex and its depth for an endpoint inside the opening, and — for a segment that CROSSES the
  opening with neither endpoint inside — the midpoint of the segment's inside portion with
  `measuredMm = −(halfWidth + depth)` at that point (labelled ≈; R1 major 5 — the marker sits on
  the opening, never at a far endpoint); `layer` = the face (§7).
- **`SILK_TO_BOARD_EDGE`** (dfm, warning): a silk item closer to the board region's boundary than
  `designRules.silkscreen.silkToBoardEdgeMm` (default 0.15 mm, OpenPCB's documented parameter) —
  `regionBoundaryDistancePolyline` minus the half width, `below(gap, required)`; a silk item not
  inside the region (`polylineInsideRegion` false) reports the same code with `measuredMm = 0` and
  an "outside the board" message.
- Fab tier (`fabricator !== "custom"`, warnings, `below(value, row)`): **`FAB_SILK_CLEARANCE`** —
  silk to a pad below the preset's `silkToMaskMm` (JLCPCB 0.15 mm, "The Minimum Distance Between
  Pad and Silkscreen is 0.15mm"; PCBWay states no row ⇒ absent ⇒ no verdict). The row names a
  pad; the page does not say whether the copper or the exposed area is meant, so the check
  measures to BOTH the mask opening and the pad's copper ring and takes the smaller distance —
  conservative under positive and negative mask expansion alike (Astra run 1 #18); the message
  says which one bound. **`FAB_SILK_WIDTH`** — a stroke narrower than `minSilkLineWidthMm` (JLCPCB
  ≥ 0.15 mm; PCBWay 0.15 mm), text strokes included. **`FAB_SILK_TEXT_HEIGHT`** — a label's or
  overlay text's `fontSizeMm` below `minSilkTextHeightMm` (JLCPCB 1.0 mm; PCBWay 0.8 mm).

## 4. Solder-mask checks (`checks/solder-mask.ts`)

Pairs of mask openings on one face within the largest applicable minimum (broad phase). The gap
is the filled-set gap of §3: containment and intersection are tested first (a vertex of one ring
inside the other, or crossing edges) and give `gap ≤ 0`; only disjoint rings use the ring-to-ring
edge distance.

- **Openings that overlap or touch (`gap ≤ 0`) have no mask between them** (Astra run 1 #9,
  #11). Both `copper` and nets differ (a null net differs from everything) ⇒ `MASK_BRIDGE` /
  `FAB_MASK_BRIDGE` with `measuredMm = 0` ("openings overlap — no dam"); same net, or either
  copper-less ⇒ nothing — the openings merge into one (a thermal pad with its untented vias is
  one opening, not a sliver).
- Disjoint openings, both `copper`, nets differ: **`MASK_BRIDGE`** (dfm, error) when
  `designRules.solderMask.minBridgeMm` is set and `below(gap, minBridgeMm)`; **`FAB_MASK_BRIDGE`**
  (dfm, warning) when `below(gap, preset.maskDamMm)`. `maskDamMm` finally has its emit site (it had
  none since it was declared — OPEN_FINDINGS §5.9). Values: JLCPCB 0.10 mm for green / red /
  yellow / blue / purple at 1 oz — the preset comment records 0.13 mm for black / white and
  0.20 mm for 2 oz, which the preset does not model (§10); PCBWay 0.1016 mm ("4 mil", green,
  < 2 oz, normal difficulty; today's 0.1 was unsourced).
- Disjoint openings of the SAME net, or where either opening is copper-less (a drill relief):
  **`MASK_SLIVER`** (dfm, warning) — a mask web that can lift, not a solder-bridging hazard;
  judged against the same minimum as the bridge (design rule if set, else the fab row; `custom`
  fab with no design rule ⇒ no verdict).
- **Openings are judged as merged components, not pairs** (Astra run 2 #3 — the pairwise merge
  rule let a copper-less relief that overlaps two different-net openings remove the dam with no
  verdict, and reported a sliver between two same-net vias inside their thermal pad's opening).
  Per face, openings that overlap or touch form one component that keeps its members' `copper`,
  net and owner sets; a component holding copper members of two different nets (null differs
  from everything) ⇒ `MASK_BRIDGE` / `FAB_MASK_BRIDGE` with `measuredMm = 0` ("openings merge —
  no dam"), located at the closest points of two differing-net copper members; the disjoint
  bridge tiers and `MASK_SLIVER` are judged BETWEEN components (the component gap is the minimum
  member-pair gap; a web inside a component does not exist), with the net policy applied to the
  components' copper member sets.
- **`FAB_MASK_TO_COPPER`** (dfm, warning): an opening and copper that is NOT its own — every trace
  stadium, pad ring, via disc and pour island on that face's copper layer, of any net — whose
  filled-set gap is below `preset.maskToCopperMm` (JLCPCB "Keep at least 0.09 mm clearance
  between soldermask openings and neighboring traces"; PCBWay states no row ⇒ absent). Copper is
  "its own" when it is the owner of any opening in the opening's merged component, or touches such
  an owner's copper ON A SHARED COPPER LAYER (the trace entering the pad, the via in the pad — the S1 touch semantics, layer
  included: a far-face relief whose owner has no copper on that face exempts only the owner
  itself, never the foreign trace running under it — R1 major 3); net equality is not an
  exemption (Astra run 1 #10). Copper contained in the opening reports with `measuredMm = 0`.

Anchors = both openings' anchors (or the opening's and the copper item's); location = the
closest point; `layer` = the face. With the default expansion of 0.075 mm a 0.4 mm-pitch footprint
has a 0.05 mm web and reports `FAB_MASK_BRIDGE` on every pad pair — that is the fab row's
verdict; the message says "reduce `solderMaskExpansionMm` or accept the fab's dam removal".

## 5. Copper shape (`checks/copper-shape.ts`, kernel helper `copper-fill/copper-shape-kernel.ts`)

Batch only by construction: `DRC_STAGES` is the batch engine's stage list; the live path
(`legality.ts`) never runs it and none of these codes joins `LIVE_CODES`.

### 5.1 Units — every piece of copper, in the unit its copper belongs to

Per copper layer:

- for every net `N ≠ null`: `P = union(` every pad ring resolved on the layer with net `N`, every
  trace segment's stadium, every via disc on the layer, every pour island of a zone with net
  `N` on the layer (from `ctx.pourResults()`) `)`;
- for the null-net copper: `union(` every null-net pad ring, trace stadium, via disc and
  net-less pour island on the layer `)`, then split into its geometric components — each
  component is one unit (two overlapping unassigned pads are one piece of copper; two
  unrelated unassigned pads are two units; Astra run 1 #4).

**No item is excluded for being narrow** (Astra run 1 #3): two sub-`w` traces side by side are a
`w`-wide connection, and a lone sub-`w` trace between two pads is reported here as the neck it is
AND by `TRACE_WIDTH_MIN` / `FAB_TRACE_WIDTH` — both are true; the double report is recorded. To
keep the default honest, the effective width is `w = min(designRules.dfm.sliverWidthMm ?? 0.1,
designRules.minimums.traceWidthMm)`: a web as wide as the board's own minimum trace is never a
neck.

Geometry going into the union: pad rings as the S1 records build them (circumscribed 48-gons),
trace stadiums and via discs built **circumscribed** (`buildTraceSegmentStadium(…, circumscribed:
true)`, `buildDiscRing(…, circumscribed: true)`) so that a `w`-wide item's inscribed radius is
never below `w / 2` (an inscribed 16-cap stadium has inradius `(w/2)·cos(π/32)`, which loses to
the erosion radius at any `w` — Astra run 1 #8); pour islands as the fill emits them. **Every
ring is oriented CCW (`ensureCcwRing`) and every island hole CW before the NonZero union** — a
mirrored placement's pad ring is CW as built and would cancel against overlapping copper (the
S5 winding lesson). Inputs are sorted canonically (pads by anchor key, traces by id and segment
index, vias by id, islands in the fill's sorted order) before the union.

Components of `P` (`splitIslands`) whose outer rings touch — ring-to-ring distance
`≤ CONNECT_EPS_MM` — are one **group** (Clipper may emit two rectangles that meet at a corner as
two paths; a point contact is a zero-width neck, not two pieces of copper).

### 5.2 Cores — the erosion, not the opening, decides connection width

`r = w / 2 − 1e-3 mm`. A NEW kernel entry `erodeWithTolerance(paths, r, arcToleranceMm = 1e-4)`
computes `E(r) = offset(P, −r)` with round joins at `arcToleranceMm` (≈ 50 chords per full turn
at `r ≈ 0.05`, chord sag ≤ 1e-4 mm). The pour's `removeOnlyFillet` and `ARC_TOLERANCE_MM` are
untouched — at the pour's 0.005 mm tolerance the round join at this radius is a 7-gon, and
changing it re-bakes every pour golden.

**Why erosion and not opening.** The opening `dilate(erode(P, r), r)` is the union of the discs of
radius `r` contained in `P`; a disc centred just inside a lobe pokes into a neck of width `n < 2r`
by `r − √(r² − n²/4)`, so two lobes joined by a neck shorter than twice that reach stay connected
in the opened shape and the neck is invisible (Astra run 1 #1). The eroded shape has no such
blind spot: a group is connected in `P` and disconnected in `E(r)` iff every path between two of
its cores passes within `r` of the boundary, i.e. through copper of local width `< 2r`. That is
the definition of a neck narrower than `w`, for any neck length — a zero-length corner contact
included (Astra run 1 #1, #2).

**Verdict band.** With `r = w/2 − 1e-3`, a `w`-wide circumscribed stadium keeps a core `≥ 2e-3`
wide (20 grid units, robust against the 0.1 µm quantisation of a diagonal strip — the pour's own
`w − 0.002` precedent, 04 §7); the erosion's concave-corner chords lie at most `1e-4` outside the
true offset. Therefore: local copper width `≤ w − 3e-3 mm` always separates the cores; width `≥
w` never does; `(w − 3e-3, w)` is undetermined. The oracle tests sit outside the band (0.05,
0.096, 0.104, 0.15).

### 5.3 `COPPER_CONNECTION_WIDTH` (dfm, error) — one violation per neck, residual first

`O = dilate(E(r), r + ε)` (`ε = 2e-4`, §5.4) and `R = P − O`. A neck is enumerated in one of two
ways, both on the same `E` / `O` / `R`:

1. **Channels the opening removes (long necks, curved or straight, parallel or single).** A
   component `c` of `R` that touches two or more distinct components of `O` (ring overlap or a
   ring-to-ring distance `≤ 2·GRID`) is copper narrower than `w` joining two cores: one violation
   per such `c`; location = the point of `c` nearest to its centroid (the centroid when it lies
   inside `c`, else the nearest boundary point — always on the copper); `measuredMm` = the LOCAL
   copper width at that point: the chord of `P` through the marker along the inward normal of the
   nearest residual edge (the forward and backward casts against `∂P` sum to the same width from
   anywhere on that normal, so the centroid marker and the nearest-boundary marker agree; the
   residual's mean thickness `τ` is only the fallback when the probe cannot be placed inside `P`
   or the chord runs along a channel END and comes out `≥ w` — a kind-1 neck is sub-`w` copper by
   construction). Labelled ≈; a straight channel reads its nominal width to 1e-5. `requiredMm =
   w`. Two parallel
   bridges are two residual components and two necks; an arc-routed channel is one component
   located on the arc (R2 blockers 1–2: the earlier bisection-only enumeration cut on the core
   count, which sees only the LAST connection between two lobes, and located a curved channel at
   the midpoint of its lobes' closest points — in empty board).
2. **Necks the opening cannot see (shorter than twice the disc reach).** A union-find over the
   cores of `E(r)` records which pairs kind 1 explained — a channel explains only the connection
   BETWEEN the two `O` components it touches, never the connections among cores inside one `O`
   component (Astra run 2 #1: a long channel to a third lobe hid a short neck inside the first
   pair); every `O` component holding two or more cores is bisected for its internal splits (an opening component holding two
   cores is NOT the gate: the opening cuts a zero-length corner contact in two, so its cores land
   in different `O` components with no residual touching both — WP4). For those cores: the smallest `ρ` at which
   the core count first exceeds 1 is the half-width of the widest cut, the cores that shared one
   component of `E(ρ)` are paired by a minimum spanning tree over their closest-point distances,
   location = the midpoint of the pair's closest points over ALL rings of both cores (hole
   boundaries included — Astra run 2 #4: a frame's hole faces the inner core) when that midpoint
   lies in the removed material (inside `P`, outside every core), else the pair's `4δ`-band
   short-neck location (a corner contact sits ON the boundary);
   `measuredMm = 2ρ` (exact to `2δ`, `δ = 1e-4`); the bisection continues on `(ρ, r]` for the
   next increase, narrowest first, and a pair is emitted only while its cores are still unmerged. Each bisection is `⌈log₂(r/δ)⌉ ≈ 9` erosions; every erosion is
   an execution checkpoint (`tick("copperShapeUnit", …)`, contract 09 §6).

Anchors `{ kind: "net", netId }` for a net unit, else the canonical minimum anchor key of the
unit's items (containment counts as membership: a pad strictly inside another is in its group —
R2 minor 4); `layer`; location-hashed. Necks of kind 1 and kind 2 are merged, sorted by width
then location, and capped at 64 per unit with the remainder reported (§5.5).

Limits stated here: a sub-`w` bridge shorter than twice the disc reach that runs in PARALLEL with
a wider short bridge between the same two lobes is not resolved (the bisection finds the wider
cut; kind 1 cannot see either of them — R2 blocker 2's short case, recorded); a neck that leads
only to sub-`w` copper (a thin lobe that vanishes before the neck splits) is reported as that
copper's `COPPER_SLIVER`; when the core count is not monotone in `ρ` the bisection finds a
transition, not necessarily the smallest; an L-shaped channel whose elbow admits a larger
inscribed disc than its legs may report one neck per leg (both true, both on the channel).

### 5.4 `COPPER_SLIVER` (dfm, warning) — thin copper, classified by thickness with a numerical floor

`O = dilate(E(r), r + ε)` with `ε = SLIVER_RESIDUE_EPS_MM = 2e-4` (one grid unit plus one chord
sag — the two shapes do not quantise identically along a slanted edge, and without the
over-dilation the difference is a web of zero-area filaments whose perimeter inflates `length`
by an order of magnitude; WP4 deviation 2) and `R = P − O`, grid-snapped. A component `c` of `R`
is a sliver iff

- `area(c) ≥ DEGENERATE_AREA_MM2` (1e-6 mm²), and
- mean thickness `τ = 2 · area(c) / perimeter(c) > 1e-3 mm` (`perimeter` includes every boundary
  of `c`, holes included; for an annulus `τ` IS the radial thickness), and
- `length = perimeter(c) / 2 ≥ designRules.dfm.sliverMinLengthMm` (default 0.2 mm = 2 · w), and
- `c` is not a neck of §5.3 kind 1 and contains no neck location of kind 2.

The thickness floor is a numerical-residue bound, not a physical one (Astra run 1 #5): the
re-sampled arcs of the opening leave bands of thickness `≤ sag + grid = 2e-4` along every curved
boundary; `1e-3` is five times that. Copper thinner than 1 µm is not a manufacturable feature and
is already dropped by the pour (`DEGENERATE_AREA_MM2`); every thinner-than-`w` copper above that
floor reports, including a 15 µm annulus or hairline appendage.

Residual arithmetic for an isolated convex corner of interior angle `α` (radians) at erosion
radius `r` — `area = r²·(cot(α/2) − (π − α)/2)`, `length = r·(cot(α/2) + (π − α)/2)` (Astra run 1
#5, verified):

| Residual (`r = 0.049`) | `τ` | `length` | verdict |
|---|---|---|---|
| a 48-gon pad boundary vs the 50-chord opening | `< 2e-4` | up to the circumference | never (floor) |
| a 90° convex corner | `≈ 0.0058` | `≈ 0.087` | never (length) |
| a 135° corner (45° routing) | smaller | `≈ 0.040` | never |
| a 45° corner | `≈ 0.0169` | `≈ 0.176` | never (length 0.176 < 0.2) |
| a 40° corner | `≈ 0.0203` | `≈ 0.194` | borderline — never |
| a 35° corner | `≈ 0.0245` | `≈ 0.217` | **reports** — a convex copper spike |
| an appendage of width `w' < w` protruding `L` from its lobe | `w'·L / (w' + L)` (→ `w'` for `L ≫ w'`) | `w' + L` | reports iff `w' + L ≥ 0.2` |

The 45° / 35° discrimination margin is ≈ 0.009 mm after the over-dilation (0.168 vs 0.209).
A convex copper spike and a concave copper-free wedge are different features: this check owns
spikes; the acid trap between two traces is a wedge and belongs to `TRACE_ACUTE_ANGLE` (§5.6).
Location = the residual's centroid; anchors as §5.3; location-hashed.

### 5.5 Budget — `COPPER_SHAPE_UNCHECKED` (dfm, info) and explicit truncation

A unit whose input paths carry more than 250 000 vertices, or whose kernel operation throws
`CopperKernelError`, is skipped and reports `COPPER_SHAPE_UNCHECKED` for its net / items and
layer — never a silent pass. A group with more than 64 necks reports the 64 narrowest and one
`COPPER_SHAPE_UNCHECKED` naming how many were not located (the count `k − 1` is known from the
single erosion at `r`; truncation is explicit, never a completeness limit — Astra run 1 #7). A
unit whose erosions would exceed 600 — the initial erosion of every group included (Astra run 2
#6: 601 disconnected pads spent 601 erosions unbudgeted) — stops and reports the same code for
the groups not examined; the grouping step's ring-to-ring work runs through a boundary-segment
index and is charged to an edge-comparison budget (`MAX_EDGE_COMPARISONS_PER_UNIT`) that also
reports the code when exhausted (Astra run 2 #5: two nested 8 192-vertex annuli spent 6 s in
grouping below the vertex budget). A unit reports its truncation and its unexamined groups in ONE
`COPPER_SHAPE_UNCHECKED` draft (they share an anchor and a layer, hence an id; two drafts would be
merged by the report's dedupe rather than by the check). `MAX_EDGE_COMPARISONS_PER_UNIT = 2 000 000`
is the fourth engineering limit; the per-island segment grid degrades to a full scan (never a
wrong answer) for a degenerate ring. The truncation message names what stopped the search (the neck cap or the erosion
budget). An effective width `w` whose erosion radius `w/2 − 1e-3` is not positive (a degenerate
`minimums.traceWidthMm`) reports one `COPPER_SHAPE_UNCHECKED` on the board (R2 minor 7) instead
of skipping the stage silently. The group step (`groupComponents`) sweeps island bounds sorted by
`minX` so only x-overlapping pairs reach the ring distance (R2 minor 9). All three numbers are engineering limits, stated here, not sourced. The golden corpus
cannot provoke the code without a synthetic fixture, so it joins `CORPUS_EXCEPTIONS` beside
`ZONE_FILL_FAILED` (the other kernel-failure code); a unit test provokes it through a budget
override.

`tick("copperShapeUnit", i, n)` fires per unit and per erosion inside a unit (contract 09 §6)
— a per-item stage label of its own, like `pour`, so the run service and the stage-sequence
test can tell an item frame from the engine's `copperShape` stage tick by name. The `dfm` class
ignore is applied when the report is finalised, as for every other check — a run that ignores
the class still pays for the stage (recorded, §10).

### 5.6 `TRACE_ACUTE_ANGLE` (dfm, warning) — copper-free wedges at trace junctions

`limit = designRules.dfm.acuteAngleDeg` (default 90; OPEN_FINDINGS §6.8 "< 90°"). An angle `θ`
(degrees) reports iff `θ < limit − ANGLE_EPS_DEG`, `ANGLE_EPS_DEG = 1e-6` — an angular predicate
of its own, never `below()` (whose tolerance is millimetres; Astra run 1 #21); a 90° corner and
the 135° corner of 45° routing pass.

Events, on one copper layer:

- (a) at every interior vertex `p_i` of a trace, `θ` = the angle between `p_{i−1} − p_i` and
  `p_{i+1} − p_i` (zero-length segments skipped; a fold — `θ = 0` — is `TRACE_OVERLAP`'s);
- (b) two traces whose endpoints lie within `min(halfWidth_a, halfWidth_b)` of each other (the
  cap copper overlaps; the persisted integer nanometre grid puts junction points up to 1 nm
  apart, and `CONNECT_EPS_MM` would miss them — Astra run 1 #19): `θ` between the end segments
  from the shared point;
- (c) an endpoint of one trace within `min(halfWidth_a, halfWidth_b)` of the interior of another
  trace's segment (the T-junction): the smaller of the two angles the ending segment makes with
  the host segment; an endpoint landing on a host VERTEX is judged against both incident host
  segments together and emits one event, the smaller wedge (R2 minor 6);
- (d) two segments of different traces that cross in their interiors (Astra run 1 #19): the
  smaller of the two angles at the crossing.

Junctions are judged between traces of the same net or where either net is null; a different-net
contact is `NET_SHORT_CIRCUIT`'s. **A collinear junction is not a wedge**: every event skips
`θ ≤ ANGLE_EPS_DEG` (the two segments run in the same direction — overlapping stadiums, which
are `TRACE_OVERLAP`'s feature, §5.7); `θ` near 180° passes as a straight continuation. A 45°
T-junction reports (`min(45, 135) = 45`). **Covered wedges are not reported** (Astra run 1 #20): when the
junction / crossing point lies inside a pad ring, via disc or pour island of the same net on that
layer, the wedge is filled by that copper and the event is skipped.

Anchors = the `segment` anchors involved; `layer`; location = the vertex, junction or crossing
point; the angle is in the message; `measuredMm` / `requiredMm` are unset because the field is
millimetres (§10).

### 5.7 `TRACE_OVERLAP` (dfm, warning)

Two segments of different traces on the same layer that are collinear (`isCollinear` at
`GEOM_EPS_MM`) and whose projections overlap over a length `> GEOM_EPS_MM` (`nearPolyline` broad
phase), and — within ONE trace — two adjacent segments that are collinear and anti-parallel (the
trace doubles back over itself; zero-length segments between them are skipped — R2 major 3),
reported once at the fold, and any two NON-adjacent segments of one trace that are collinear
with overlapping projections (a trace looping back over its own earlier run — R2 minor 5). Different-net overlap is already `NET_SHORT_CIRCUIT`; this code covers the same-net and
null-net duplicates the item model cannot see (01 §4). Anchors = both segments; location = the
overlap's midpoint; location-hashed.

## 6. Parameters and fab rows

Design-rule fields (all optional and additive on `PcbDesignRules`; absent = the default named
here; parsed with the `optNum` semantics of `parseDesignRules` on read and update, carried by the
HTTP settings parser and the command executor):

| Field | Default | Origin |
|---|---|---|
| `silkscreen.silkToMaskClearanceMm` | 0 | OPEN_FINDINGS §6.8 |
| `silkscreen.silkToBoardEdgeMm` | 0.15 | OPEN_FINDINGS §6.8 |
| `solderMask.minBridgeMm` | absent (no design verdict) | — |
| `dfm.sliverWidthMm` | 0.1, capped by `minimums.traceWidthMm` (§5.1) | OPEN_FINDINGS §6.8 |
| `dfm.sliverMinLengthMm` | 0.2 | 2 · `sliverWidthMm` (this contract) |
| `dfm.acuteAngleDeg` | 90 | OPEN_FINDINGS §6.8 |
| `dfm.courtyardFallbackMm` | 0.25 | IPC-7351B level B courtyard excess |

Fab rows (every value with its source; fetched 2026-09-10 from `jlcpcb.com/capabilities/pcb-
capabilities` and `pcbway.com/capabilities.html`; a row a page does not state is absent and
yields no verdict):

| Preset field | JLCPCB (2L / 4L) | PCBWay (std / adv) |
|---|---|---|
| `silkToMaskMm?` | 0.15 | absent |
| `minSilkLineWidthMm` | 0.15 | 0.15 |
| `minSilkTextHeightMm` | 1.0 | 0.8 |
| `maskDamMm` | 0.10 (green / red / yellow / blue / purple, 1 oz; 0.13 black / white, 0.20 2 oz — not modelled) | 0.1016 (4 mil, green, < 2 oz) |
| `maskToCopperMm?` | 0.09 | absent |

Neither page states a courtyard, acute-angle or copper-sliver capability; those are design rules
only.

## 7. Report contract

- New anchor kinds `{ kind: "overlayShape", shapeId }` and `{ kind: "overlayText", textId }`, with
  arms in `anchorKey`, `resolveAnchorLabel` and every other exhaustive switch over
  `DrcAnchor["kind"]`.
- `DrcViolation.layer` for a silkscreen, solder-mask or courtyard violation is the FACE encoded as
  the outer copper layer id (`F.Cu` = top, `B.Cu` = bottom), exactly as `emitMask` names a face.
  It is a convention, not a claim that copper is involved; no consumer filters markers by it.
- Location-hashed (a 0.1 mm bucket in the id): `COURTYARD_OVERLAP`, `SILK_TO_MASK_CLEARANCE`,
  `SILK_TO_BOARD_EDGE`, `FAB_SILK_CLEARANCE`, `MASK_BRIDGE`, `FAB_MASK_BRIDGE`, `MASK_SLIVER`,
  `FAB_MASK_TO_COPPER`, `COPPER_CONNECTION_WIDTH`, `COPPER_SLIVER`, `TRACE_ACUTE_ANGLE`,
  `TRACE_OVERLAP`. The copper-shape codes are pour-derived: an unrelated edit that moves a pour
  vertex can move a neck's location across a bucket and re-id a waiver — the mirror image of
  `ISOLATED_COPPER_ISLAND`'s choice not to hash, recorded (§10). Two violations that collide on
  one id are resolved by the report's existing survivor rule (06 §6: most severe, then the
  largest deficit) — a total order, so the report stays byte-identical.
- All sixteen codes are class `dfm` and overridable; `NON_OVERRIDABLE` stays eight. Default
  severities: error — `COURTYARD_OVERLAP`, `MASK_BRIDGE`, `COPPER_CONNECTION_WIDTH`; info —
  `COPPER_SHAPE_UNCHECKED`; warning — the rest.
- Determinism (06 §6 / §7): units, groups, pairs, necks and residuals are enumerated in canonical
  order; pair operands are ordered by id; locations use total tie-breakers (§2.2); the report is
  byte-identical under the eight input reversals.
- Stages `courtyard`, `silkscreen`, `solderMask`, `copperShape` follow `keepouts` (17 → 21).

## 8. Consumers

| Consumer | Reads |
|---|---|
| `gerber/writer.ts` `emitSilk` / `emitMask` | `buildSilkArtwork`, `buildMaskOpenings` (allocation in model order) |
| `checks/silkscreen.ts` | the silk artwork, the mask openings, `ctx.boardRegion`, `ctx.pads`, the preset |
| `checks/solder-mask.ts` | the mask openings, `ctx.pads` / `ctx.traces` / `ctx.vias`, `ctx.pourResults()`, the S1 touch predicate, the preset |
| `checks/courtyard.ts` | `ctx.placementCourtyard(id)` (lazy, memoised; `options.lookupRawFootprint`) |
| `checks/copper-shape.ts` | `ctx.pads` / `ctx.traces` / `ctx.vias` on the layer, `ctx.pourResults()`, the kernel |
| `OverlayLayer.tsx`, `frontend/lib/footprint-labels.ts` | re-export `overlayShapePolyline`, `uprightLabelRotationDeg`, `withPlacementReference` from the shared modules |
| `import/dxf/to-outline.ts` | re-exports `loopToContour` from `rendering/pcb/loop-ring.ts` |
| `pcb/placement-extent.ts`, cloud snapshot | `placementCourtyardWorldMm` (hull contract unchanged; circles sampled by the S2 kernel) |

## 9. Tests

`gerber-silk-parity.test.ts` (§1.5); `designer-export.test.ts` (`%ADD` order, the enumerated
diffs, negative-expansion relief); `drc-copper-shape.test.ts` (necks of width 0.05 / 0.096 /
0.104 / 0.15 with the verdict flipping outside the band, at neck lengths 0.01 and 1.0 and on a
curved connector; a 0.1 mm trace never reports at `w = 0.1` and a 0.2 mm trace never at
`w = 0.2`, including one-nanometre-long segments; a board of round pads and vias yields zero
`COPPER_SLIVER`; two 0.08 traces side by side across a 0.05 pour neck are NOT a neck; a lone
0.08 trace between pads IS one; 90° / 45° / 35° corners; corner contact; the same-net pour union
neck; a 15 µm annulus and a 0.05-wide appendage protruding 0.21 mm report, one protruding 0.19 mm
does not (`length = w' + L`, §5.4); the U-shaped
remote connector locates at the U; 65 necks with the narrowest last are reported narrowest first
with an explicit remainder; the budget skip; byte-identity under reversal; null-net units; acute events (a)–(d) incl. a 1 nm-offset junction, a covered junction inside a pad (no report), a 90° T (no report), a 45° T (reports), a collinear stub end (`TRACE_OVERLAP`, not acute); a fold within one trace is `TRACE_OVERLAP`);
`drc-courtyard.test.ts` (chained rect, circle, opposite semicircles, overlapping exterior rings,
donut nesting, malformed branch → superset hull + flag, fallback OBB under rotation, pad-box
fallback without bounds, mirrored `F.Cu` placement, `B.Cu` side swap, touching vs overlapping,
equal-area tie, kernel-error path); `drc-silkscreen.test.ts` (each code's boundary, crossing /
containment / cap-midpoint contact, the two predicates, the overlay anchors, the two-target fab
row); `drc-solder-mask.test.ts` (the net / copper-less matrix, nested openings, overlapping
same-net openings, a copper item contained in a foreign opening, pour copper under an opening,
the owner / touching exemption, `custom` fab ⇒ only the design rule, absent rule ⇒ only the fab
row, negative expansion); the registry gates `drc-census.test.ts`, `drc-stages.test.ts` (21
stages, function names, the two per-item tick stages), `drc-severity.test.ts` (no severity
literal in any check file), `drc-golden.test.ts:101` (every code provoked; `CORPUS_EXCEPTIONS =
["COPPER_SHAPE_UNCHECKED", "ZONE_FILL_FAILED"]`); the new golden `golden-dfm-2l` (`fabricator:
"jlcpcb_2l"`, `solderMask.minBridgeMm` set) provoking all fifteen reportable codes with per-code
attribution in its `.md`; an HTTP round-trip test proving the new design-rule keys survive the
settings parser.

## 10. Stated limits

§0's re-owned items (S12b, the pour backlog); bezier silk graphics are 16-step polylines; the
text thickness rule is `max(0.1, 0.15 · size)` — the preview model carries no authored thickness
(import backlog); the canvas draws text with its own font while the artwork uses the stroke font
(a UI limit; DRC ≡ artwork is the contract); Gerber's 1 nm coordinate rounding sits below every
DFM tolerance; board-level `F.CrtYd` / `B.CrtYd` overlay shapes are not courtyards; there are no
mask graphics (`F.Mask` overlays do not exist); silk-over-silk overlap and paste DFM are not
checked; courtyard off-board is not checked; a placement with an empty model has no courtyard;
mask bridge rows for black / white mask and 2 oz copper are not modelled; the copper-shape
verdict band `(w − 3e-3, w)`; the sliver thickness floor of 1 µm; a neck leading only to sub-`w`
copper is reported as a sliver; a non-monotone core count can hide the narrowest neck behind a
wider one; a sub-`w` trace is reported both as a neck and by the width rules; the neck cap, the
erosion cap and the vertex budget are engineering limits (a dense 5 000-item board spends ≈ 1 s
in the stage — batch-only, worker-hosted; a per-board budget is a follow-up); the `dfm` class
ignore does not skip the stage's work; an L-shaped channel may report one neck per leg; a short sub-`w` bridge parallel to a wider short
bridge is unresolved (§5.3); the residual neck width `τ` is a mean, not a minimum; the `drc-engine`
suite filters the five copper-shape codes out of its clearance assertions and the corpus gates
exempt `COPPER_SHAPE_UNCHECKED` (a unit test provokes it); pour-derived violation ids can re-hash
after unrelated edits; a covered acute wedge is judged by the junction point only; the angle of
`TRACE_ACUTE_ANGLE` lives in the message, not in `measuredMm`; 6+-layer inner Gerber layers
(pre-existing).

## 11. Amendments (applied when S12 closes)

`PROGRAM.md` (S12 row, exit gate, decisions bullet, the new S12b row); `OPEN_FINDINGS.md` §6.8 →
shipped values and §5.9 (`maskDamMm` had no emitter until S12); `TODO.md` P9 → done; contracts
01 §4 (S1 #4, #7 closed here), 02 §3 / §6 / §7 (re-owned to S12b), 04 §7 (#3, #7 closed here),
06 §0 / §3 / §9 (stage list, the mask policy, the exact-arc lines → S12b), 07 §0, 09 §6 (the
second per-item stage), 10 §0 / §10 (trapezoid / custom → S12b); `src/modules/designer/AGENTS.md`;
`CLAUDE.md` tree; the hardening skill's `scope-and-invariants.md`; the `eda-standards` skill's fab
rows; memory.

## 12. Review ledger

### 12.1 Plan-critique (2026-09-10, 5 blockers, 8 majors, 3 minors — all folded)

B1 residual classification by extent flags every round pad → thickness classification (§5.4);
B2 the pour's opening is a 7-gon at `r = 0.05` → dedicated tolerance + the verdict band (§5.2);
B3 one mirror predicate → two named predicates (§1.1); B4 one violation per component with an
ill-defined location → per-neck enumeration (§5.3); B5 the `covered` short-circuit leaves the far
face masked → unconditional far-face relief (§1.3); M1 fixture helper and 15-code count → §9;
M2 stage test → §5.5 / §7; M3 severity source gate → §9; M4 loop flattener lives in `modules/` →
`loop-ring.ts` (§2.1); M5 chaining branch / circle / nesting → §2.1; M6 double reports and
sub-`w` items → §5.1 / §5.4; M7 no budget → §5.5; M8 boolean overlap kernel → Clipper
intersection (§2.2); m1 aperture order → §1.4; m2 overlay courtyards / text mirror → §10 / §1.2;
m3 face-as-layer → §7.

### 12.2 Astra run 1 — spec-attack xhigh, prompt-only (2026-09-11; 23 findings)

| # | Finding | Disposition |
|---|---|---|
| 1 | The opening keeps a neck shorter than twice the disc reach `r − √(r² − n²/4)`; point contacts may be two PolyTree paths | **accepted (high)** — cores from the EROSION decide; touching components form one group (§5.1, §5.2) |
| 2 | The `2r` proximity cutoff misses long and curved necks | **accepted (high)** — pairing by group membership, no distance cutoff; bisection locates (§5.3) |
| 3 | Excluding sub-`w` items invents necks (two 0.08 traces = a 0.13 web) | **accepted (high)** — nothing excluded; `w` capped by the board's minimum trace width (§5.1) |
| 4 | Null-net copper had no unit | **accepted (medium)** — null-net union split into geometric components (§5.1) |
| 5 | The `τ ≥ 0.2·w` gate hides a 15 µm annulus; corner formulas were wrong | **accepted (high)** — numerical floor 1e-3 instead; the corrected `area` / `length` formulas and table (§5.4) |
| 6 | The neck midpoint can lie in an unrelated empty slit (the U connector) | **accepted (medium)** — location at the bisection's split scale, where only the neck is `≤ 4δ` apart (§5.3) |
| 7 | The 64-cap can drop the worst neck | **accepted (high)** — narrowest first, explicit remainder as `COPPER_SHAPE_UNCHECKED` (§5.3, §5.5) |
| 8 | The survival guarantee does not scale with `w` (inscribed caps); the 0.21 % bound was 0.2146 % | **accepted (medium)** — circumscribed stadiums / discs, `r = w/2 − 1e-3`, the bounds restated (§5.1, §1.3) |
| 9 | Unsigned ring distance misses contained openings and exposed copper | **accepted (high)** — filled-set gap with containment first (§3, §4) |
| 10 | Mask-to-copper omitted pours; net equality is the wrong exemption | **accepted (high)** — pour islands included; owner / touching exemption instead of net (§4) |
| 11 | Overlapping same-net openings are not slivers | **accepted (medium)** — `gap ≤ 0` merges; only `0 < gap < min` is a sliver (§4) |
| 12 | A negative expansion shrinks the far-face relief below the drill | **accepted (high)** — relief uses `max(expansion, 0)` (§1.3) |
| 13 | A copper-less `hole` pad flashes its declared size, not the drill | **rejected** — the declared size of a `hole` free pad is its authored mask opening (KiCad NPTH semantics, S11 Astra 2b #3); the drill relief is the floor, not the ceiling |
| 14 | Even-odd cancels overlapping courtyard rings | **accepted (high)** — depth-oriented NonZero union (§2.1) |
| 15 | The malformed fallback hull is an inscribed 16-gon; missing bounds silently skip | **accepted in part** — the S4 `superset` hull already circumscribes (the 16-gon goes with `pushCircle`); pad-box fallback added; an empty model stays unchecked (§2.1, §10) |
| 16 | Endpoint-based arc de-duplication deletes opposite semicircles | **accepted (medium)** — arcs de-duplicated by endpoints + centre + sweep (§2.1) |
| 17 | Silk clearance needs filled-set semantics and exact stroke envelopes | **accepted (high)** — analytic stadiums, containment probes (§3) |
| 18 | Measuring the silk row to the mask opening is not conservative under negative expansion | **accepted (medium)** — the smaller of the distances to the opening and to the copper (§3) |
| 19 | Acute angles miss interior crossings and 1 nm-offset junctions | **accepted (high)** — crossings added; junction tolerance = the smaller half width (§5.6) |
| 20 | Centreline angles inside a covering pad are not hazards; the "double report" claim was wrong | **accepted (medium)** — covered wedges skipped; spikes vs wedges separated (§5.4, §5.6) |
| 21 | `below(θ, 90)` reuses a length tolerance | **accepted (medium)** — `ANGLE_EPS_DEG` (§5.6) |
| 22 | Location ties and duplicate-id survivors unspecified | **accepted (medium)** — total tie-breakers; the 06 §6 survivor rule named (§2.2, §7) |
| 23 | Quadratic core pairing and unbounded intermediate work | **accepted (high)** — no pairing (bisection is `O(necks · log)`), erosion cap, per-erosion ticks (§5.3, §5.5) |

Invariant audit: the two placement predicates and the conjugated label rotation survived; the
NonZero winding convention is now stated (§5.1); the JLCPCB silk row's "pad" is resolved
conservatively (§3).

### 12.3 R1 — `reviewer-critical` on WP2 + WP3 (2026-09-11; 1 blocker, 4 majors, 3 minors — all accepted and fixed)

Blocker: the raw KiCad courtyard payload is arrays + `pts`, so every imported placement read as
malformed (and the S4 hull's raw path never matched) → one shared normaliser + real-parser tests
(§2.1). Majors: a duplicated closing vertex made a valid courtyard malformed and produced a false
`COURTYARD_OVERLAP` → coincident points collapsed, `malformed` = open chain or branch (§2.1); the
mask-to-copper owner exemption ignored layers → shared-layer touch (§4); degenerate silk widths
reached the file → `DEFAULT_FOOTPRINT_STROKE_MM` (§1.2); a crossing stroke was located at a far
endpoint → inside-portion midpoint + depth (§3). Minors: own-face uncovered relief for every
drilled free pad (§1.3); the round-trip test covers all seven fields over HTTP (§9); the
byte-identity claim's two exceptions (§1.4). Probes that passed: label geometry vs the canvas
nesting (2e-15), `arc3` sweep through `mid`, mask openings ≡ a verbatim pre-S12 `emitMask` for
`hole` + slot / `std` / untented via on 4L / `smd`, `ownerKey` ≡ `DrcPad.key`, every courtyard
case of §9, the signed gap's containment / tangency / plus-crossing, circumscription bias toward
over-reporting, byte identity under ten reversals of `golden-dfm-2l`.

### 12.4 R2 — `reviewer-critical` on WP4 (2026-09-11; 2 blockers, 1 major, 8 minors — all accepted and fixed)

Blockers: a curved or dog-legged channel was located in empty board and double-reported; two
parallel sub-`w` bridges reported only the wider one and a short narrow one passed silently →
the hybrid enumeration of §5.3 (residual channels first, bisection for the short necks the
opening cannot see). Major: a fold with a duplicated fold vertex was reported by nothing → the
fold arm pairs distinct segments (§5.7). Minors: a strictly nested null-net item left its group
(§5.3 anchors); a trace looping over its own non-adjacent run (§5.7); a T on a host vertex
double-reported (§5.6); a degenerate `minimums.traceWidthMm` skipped the stage silently (§5.5);
the truncation message's cause and the unlocated count (§5.5); `groupComponents` O(n²) (§5.5);
tie-breakers resting on Clipper's emit order (§7); the `drc-engine` suite's advisory filter (§10).
Probes that passed: `r = w/2 − 1e-3` at a 52-vertex round join (the pour's is 12), CCW
normalisation of a mirrored pad ring, the `w` cap, the band edges (0.097 reports, 0.099 / 0.1 /
0.101 do not), the corner table to 0.009 mm, no residual bands from 2–20 mm pour arcs, exact
budget boundaries, a `CopperKernelError` inside `findNecks` caught per unit, byte identity under
ten perturbations of two goldens and a bespoke zone / placement fixture, 133 ms on the pours
golden. Process note: the reviewer disclosed an accidental `git stash` + immediate pop; the tree
was verified intact afterwards (218 WP2/WP3 tests, empty stash list).

### 12.5 Astra run 2 — adversarial-verify xhigh, repository-grounded (2026-09-11; 6 findings, all executed counterexamples, all accepted and fixed)

| # | Finding | Disposition |
|---|---|---|
| 1 | A kind-1 channel marked every core of a touched opening as explained, hiding a short neck in series with a long one | **accepted (high)** — channels explain only the inter-component connection; internal splits always bisected (§5.3) |
| 2 | A negative expansion shrank a `hole` / `std` / `smd` pad's opening below its drill because coverage was tested on the unexpanded shape | **accepted (high)** — containment against the flashed aperture (§1.3) |
| 3 | The pairwise merge rule let a copper-less relief bridging two nets pass, and flagged a sliver inside a thermal pad's merged opening | **accepted (high)** — merged components with member net sets (§4) |
| 4 | Nested cores: outer-ring-only closest points put the neck marker inside the thick frame | **accepted (medium)** — all rings, midpoint must lie in the removed material (§5.3) |
| 5 | Two nested 8 192-vertex annuli: 6 s of quadratic grouping below the vertex budget, no checkpoint, no verdict | **accepted (high)** — indexed ring distance + an edge-comparison budget (§5.5) |
| 6 | The initial erosions bypass the 600-erosion budget (601 pads ⇒ 601 erosions) | **accepted (medium)** — every erosion charged, unexamined groups reported (§5.5) |

No violation-id order dependence was reproduced under the additional reversals; anti-parallel
overlap detection survived.
