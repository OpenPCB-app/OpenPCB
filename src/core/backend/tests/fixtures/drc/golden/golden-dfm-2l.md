# golden-dfm-2l

The S12 DFM golden (DFM contract 11). `jlcpcb_2l`, an 80 x 60 mm rect outline,
`layerCount` 2, `boardThicknessMm` 1.6, 117 primitives, 43 violations.

Board rules are pinned so the fixture's own hits are the ones this file is
about: `minimums` `{ traceWidthMm 0.2, drillSizeMm 0.2, annularRingMm 0.13,
viaDiameterMm 0.45, viaDrillMm 0.2, holeToHoleMm 0.5 }`, a single permissive
`default` net class, an explicit `dfm` group `{ sliverWidthMm 0.1,
sliverMinLengthMm 0.2, acuteAngleDeg 90 }` — so the effective copper width is
`w = min(0.1, 0.2) = 0.1` and the erosion radius is `r = 0.049` (§5.1, §5.2) —
and `solderMask { minBridgeMm 0.15 }`. The `silkscreen` group is DELIBERATELY
absent, so the silk checks run on their own documented defaults (§6):
`silkToMaskClearanceMm` 0 and `silkToBoardEdgeMm` 0.15. `solderMaskExpansionMm`
is the board default 0.075 mm; the `mk_` free pads override it to 0.3 mm each,
which is what lets a 0.08 mm mask dam sit on copper that is still 0.68 mm apart
and therefore clear of every clearance tier.

Every placement carries at least one small net-less anchor pad. A pad-less
placement is `PLACED_PART_MISSING_FOOTPRINT`, and seventeen of those would
drown what this fixture is actually about.

The eight `cs_F0`..`cs_F7` placements along `y = -22` and the four `cs_v*` vias
along `y = -27` are ORDINARY, unassigned copper: they exist only to clear the
80-primitive non-triviality gate, are 0.9 mm apart so no pair forms a null-net
neck, and carry no copper-shape hit at all.

Ownership: every id prefixed `cs_` belongs to the copper-shape block below.
Other S12 blocks append their own prefixes (`cy_`, `sk_`, `mk_`) without
restructuring this one.

## Copper shape (`cs_`, contract §5)

### `COPPER_CONNECTION_WIDTH` — 3

- **`cs_lobeA` / `cs_bridge` / `cs_lobeB`** (-31, 20) — two 1 x 1 mm lobes
  joined by a **0.06 x 1.5 mm web** on net `CS_NECK`. `2r = 0.098 > 0.06`, so
  the web vanishes in `E(r)`; it survives as a component of `R = P − O` that
  TOUCHES BOTH lobes' opening components, which is what makes it a channel neck
  (§5.3 (i)). Measured as the LOCAL copper width at the marker — the chord of
  the copper along the wall normal — **`≈0.060 mm`** at (-29.750, 20.000).
- **`cs_cornerA` / `cs_cornerB`** (-20.5, 20) / (-19.5, 21) — two 1 x 1 mm pads
  on net `CS_CORNER` that **touch at exactly one point**. Clipper emits them as
  two components; the `CONNECT_EPS_MM` grouping merges them, and every positive
  erosion separates them -> a **zero-width neck**, `≈0.000 mm` at
  (-20.000, 20.500). The one case the residual rule cannot see either — the
  opening CUTS the contact in two, so the two cores land in different opening
  components and no residual touches both. It is the bisection (§5.3 (ii)) that
  answers it, and the only thing in this golden that spends an erosion beyond
  the first.
- **`cs_zoneA` / `cs_pourBridge` / `cs_zoneB`** (0..15, 10..16) — **two same-net
  pours** on `CS_POUR`, 3 mm apart, bridged by a 0.05 mm-wide free pad. Neither
  pour can emit sub-`w` copper on its own (the fill's min-width open is
  `traceWidthMm/2`), so this is a neck the UNION has and neither input does —
  the whole point of §5.1's per-net unit. A channel neck: **`≈0.050 mm`** at
  (7.500, 13.000), anchored `{ kind: "net", netId: "cs_pour" }`.

### `COPPER_SLIVER` — 1

- **`cs_padBody` / `cs_tab`** (-10, 20) — a 0.05 x 0.5 mm appendage on a
  2 x 2 mm pad, net `CS_TAB`. It leads nowhere, so `E(r)` keeps ONE core and
  there is no neck; the residual `P − dilate(E(r), r)` is the 0.45 mm
  protrusion, `τ = 2·area/perimeter ≈ 0.044` (above the 1 µm floor) and
  `length = perimeter/2 ≈ 0.5` (above `sliverMinLengthMm`) -> **reports** at
  (-10.000, 21.227). `τ` is the MEAN thickness `wL/(w+L)`, not the width.

### `TRACE_ACUTE_ANGLE` — 4

All four §5.6 event kinds, every one at exactly 30°:

- **(a) interior vertex** — `cs_acuteA` bends 30° at (-28.000, 0.000).
- **(b) endpoint pair** — `cs_acuteB1` and `cs_acuteB2` meet end-to-end at
  (-16.000, 0.000).
- **(c) T-junction** — `cs_acuteC2` ends on the interior of `cs_acuteC1` at
  (-6.000, 0.000); the smaller of the two angles it makes with the host is 30°.
- **(d) interior crossing** — `cs_acuteD1` and `cs_acuteD2` cross transversally
  at (9.000, -2.000).

Each pair is on its own net (`CS_WA`..`CS_WD`) so nothing here is a short. No
`measuredMm` / `requiredMm`: the field is millimetres and an angle is not one
(§10).

**Not reported here:** the two shared ends of `cs_dupA` / `cs_dupB` and the fold
vertex of `cs_fold` are COLLINEAR junctions (`θ = 0`). Two stadiums lying on top
of each other leave no copper-free wedge, so those are `TRACE_OVERLAP`'s feature
and this code stays silent — one fact, one code.

### `TRACE_OVERLAP` — 2

- **`cs_dupA` / `cs_dupB`** (-34, -10) -> (-28, -10) — two IDENTICAL 0.25 mm
  traces on net `CS_DUP`. Same net, so no `NET_SHORT_CIRCUIT`; the item model
  cannot see the duplication at all (01 §4). Reports the full **6.000 mm** of
  shared run at (-31.000, -10.000), anchored on both `segment` anchors. The
  BETWEEN-trace arm.
- **`cs_fold`** (-20, -10) -> (-14, -10) -> (-17, -10) — ONE trace on net
  `CS_FOLD` that **doubles back over its own copper**: its two ADJACENT segments
  are collinear and anti-parallel, so the last 3 mm are laid twice. Reports
  **3.000 mm** at (-15.500, -10.000), anchored on `segment` 0 and `segment` 1 of
  the same trace. The WITHIN-trace arm — no pair loop over two DIFFERENT traces
  can reach it.

### Not provoked here

- **`COPPER_SHAPE_UNCHECKED`** is a `CORPUS_EXCEPTIONS` entry: it needs a
  250 000-vertex unit, a kernel refusal or more than 64 necks in one group, none
  of which a hand-written fixture reaches. `drc-copper-shape.test.ts` provokes
  all three through the `copperShapeBudgets` test override.



## Courtyards (`cy_`, contract §2)

All along `y = 26`, clear of every other block. None of these parts carries
copper beyond its 0.3 mm anchor pad, so nothing here reaches a clearance tier.

### `COURTYARD_OVERLAP` — 3

- **`cy_ovlA` / `cy_ovlB`** (-36, 26) / (-33.5, 26) — two 3 x 3 mm courtyards
  drawn as four LOOSE `F.CrtYd` lines each, chained into one ring by
  `chainEdgesToLoops` (§2.1). They overlap by 0.5 x 3 = **1.5000 mm²**, marked
  at the intersection's centroid (-34.750, 26.000).
- **`cy_circ` / `cy_rect`** (-18, 26) / (-15.6, 26) — a `circle` courtyard of
  r = 1.5 (which BYPASSES chaining and lands as one S2 chord ring) against a
  chained rect: **0.9893 mm²** at (-16.856, 26.000). The area is just under the
  exact 0.9928 mm² of the true disc because the ring is unbiased — the vertices
  sit ON the circle, and a courtyard is a declared boundary, not a clearance
  operand (§2.1).
- **`cy_fbA` / `cy_fbB`** (8, 26) / (9.4, 26) — two parts with NO courtyard
  graphics at all. Each falls back to its `preview.bounds`-less pad box
  (1 x 1 mm) inflated by `dfm.courtyardFallbackMm`, absent here and therefore
  the 0.25 mm IPC-7351B level B excess: 1.5 x 1.5 boxes 1.4 mm apart overlap by
  0.1 x 1.5 = **0.1500 mm²** at (8.700, 26.000). Their COPPER is 0.4 mm apart
  and their openings 0.25 mm apart, so neither a clearance tier nor a mask dam
  fires — the courtyard is the only thing that objects.

`measuredMm` is unset on all three: the intersection is an AREA, and putting
mm² in a millimetre field would make it comparable with a `requiredMm` it is
not (§2.2). The overlap is in the message instead.

### `COURTYARD_INVALID` — 1

- **`cy_bad`** (0, 26) — THREE sides of a rectangle. The chain never closes, so
  the region falls back to the S4 superset hull and the part is reported. It is
  still JUDGED on that hull (it simply has no neighbour here), which is the
  fail-closed half of the rule: a footprint whose geometry cannot be stitched
  over-reports, it does not vanish.

### Deliberate passes

- **`cy_tchA` / `cy_tchB`** (-28, 26) / (-25, 26) — courtyards that share an
  edge exactly. `> DEGENERATE_AREA_MM2` is the test, so a board laid out on a
  courtyard grid is clean (§2.2).
- **`cy_donut` / `cy_inner`** (-8, 26) — an outer 6 x 6 ring with a 3 x 3 ring
  inside it, and a 2 x 2 part sitting IN that hole. Depth classification makes
  the inner ring a hole (CW) so the NonZero union is a real donut; the S4
  convex hull would have filled it and reported an overlap (§2.1, Astra #14).
  `cy_donut`'s anchor pad is offset to (-5.8, 26) so the two parts' pads do not
  coincide.
- **`cy_mir`** (18, 26) — a `mirrored: true` part on `F.Cu` whose `F.CrtYd`
  rectangle is drawn at local x ∈ [1, 3] and therefore lands at world
  x ∈ [15, 17], while its `B.CrtYd` rectangle lands on the BOTTOM face. Mirror
  and side-flip are two predicates, and only the second moves a face (§1.1).
- **`cy_bot`** (26, 26) — a `B.Cu` part: its `F.CrtYd` ring lands on the bottom
  face and its `B.CrtYd` ring on the top one, both reflected in X.

## Silkscreen (`sk_`, contract §3)

### `SILK_TO_MASK_CLEARANCE` — 1

- **`sk_pad`** (22, 10) — a 0.15 mm `F.SilkS` line straight across a 1 x 1 pad
  whose opening is 1.15 mm. The gap is the FILLED-SET gap, so this is
  **≈ −0.650 mm** of penetration — half the pen (0.075) plus the depth at the
  middle of the ink that landed on the pad (0.575, the opening's half height) —
  not the zero an unsigned perimeter distance would report (Astra #17). Neither
  end of the line is inside the opening, so the marker is the MIDPOINT of its
  inside run, at the pad's centre (22.000, 10.000): a marker at either end
  would be 2 mm away and would key a waiver there (R1). At the default
  `silkToMaskClearanceMm` of 0 only true penetration reports: ink that merely
  touches an opening's edge passes.

### `FAB_SILK_CLEARANCE` — 1

- **`sk_pad`**, the same line, against JLCPCB's `silkToMaskMm` 0.15. The row
  names a "pad" without saying whether the copper or the exposed area is meant,
  so the check measures BOTH and keeps the smaller; here the opening (1.15) is
  wider than the copper (1.0), so its deeper penetration (−0.650 vs −0.575) is
  the smaller gap and therefore bounds, which the message says (Astra #18). An
  untented via's opening reaches no silk row at all — the row is about pads.

### `SILK_TO_BOARD_EDGE` — 2

- **`sk_edge`** (33, 29.8) — a 0.15 mm line whose ink edge is **0.125 mm** from
  the routed edge at y = 30, against the 0.15 mm default.
- **`sk_off`** (44, 5) — a line ENTIRELY off the board: the same code with
  `measuredMm` 0 and an "outside the board" message, because there is no
  clearance left to measure. Its anchor pad is pulled back to (36, 5) so the
  case stays about silkscreen and not about copper.

### `FAB_SILK_WIDTH` — 2

- **`sk_thin`** (30, 10) — an authored **0.100 mm** pen against JLCPCB's
  0.15 mm row.
- **`sk_small`** (35, 10) — the 0.6 mm label below. Text has no authored
  thickness in the preview model, so its pen is `max(0.1, 0.15 · size)` =
  **0.100 mm** (§1.2, §10) — a small label is automatically a thin one.

### `FAB_SILK_TEXT_HEIGHT` — 1

- **`sk_small`** (35, 10) — a 0.6 mm label against JLCPCB's 1.0 mm row.

### Deliberate passes

- **`sk_gfx`** (22, 18) — every footprint silk primitive at once: an
  `F.SilkS` `line`, `rect`, `circle` and `arc3`, plus a CLOSED SOLID `B.SilkS`
  `polyline`, which is the only source in this fixture that yields a
  `SilkRegion` from a footprint. All 0.15 mm, clear of the edge and of every
  opening.
- **`sk_ref`** (30, 18) — a `role: "reference"` label reading `REF**`, on a
  placement rotated 180°. The text resolves to the placement's own reference
  (`U9`) and the keep-upright rule un-rotates it (§1.2). 1.0 mm high, so it
  clears both fab rows.
- **`sk_ovRect` / `sk_ovCirc` / `sk_ovPoly` / `sk_ovText`** — the four board
  OVERLAY sources: a solid `F.SilkS` rectangle, a solid `F.SilkS` circle, a
  solid `B.SilkS` polygon and a `mirror: true` `F.SilkS` text. Each yields a
  stroke, and the three filled ones a region as well. All clean — they exist so
  the model, the `overlayShape` / `overlayText` anchors and the region path are
  exercised on a real board; the anchors themselves are pinned in
  `drc-silkscreen.test.ts`.

## Solder mask (`mk_`, contract §4)

Every `mk_` free pad overrides `solderMaskExpansionMm` to 0.3 mm, so a pair
1.68 mm apart has a 0.08 mm mask dam over copper that is 0.68 mm apart.

### `MASK_BRIDGE` — 2 and `FAB_MASK_BRIDGE` — 2

- **`mk_brgA` / `mk_brgB`** (18, -12) / (19.68, -12) — two 1 x 1 pads on
  DIFFERENT nets with a **0.0800 mm** dam: below the board's `minBridgeMm`
  0.15 (error) and below JLCPCB's `maskDamMm` 0.10 (warning). `maskDamMm` had
  been declared since S6 with no emit site at all (OPEN_FINDINGS §5.9); this is
  it. Two openings that MERGE report the same pair of codes with `measuredMm` 0
  and "openings merge — no dam", and the merge is transitive: a component is
  judged as one window however many openings chained it together (Astra run 2
  #3).
- **`mk_viaPad` / `mk_via`** (18, -16) / (19.325, -16) — an UNTENTED via
  (`protection: "none"`, 0.8 mm) 0.05 mm from a different-net pad's opening.
  The via's opening uses the BOARD expansion (0.075), not the pad's override,
  so the measured dam is **0.0490 mm** — the 48-gon ring of a circular aperture
  is inscribed in its own flash by up to 0.21 %·r, which is the stated
  tolerance (§1.3). Their COPPER is 0.425 mm apart, so no clearance tier fires.

### `MASK_SLIVER` — 2

- **`mk_slvA` / `mk_slvB`** (24, -12) / (25.68, -12) — the SAME 0.08 mm dam on
  ONE net. A web that can lift, never a short, so it is judged against the same
  minimum but never as a bridge (§4).
- **`mk_relief` / `mk_reliefN`** (30, -12) / (32.05, -12) — a copper-LESS NPTH
  `hole` free pad beside an ordinary pad, **0.0474 mm** apart. A `hole` pad
  flashes its declared 1.0 mm shape (the authored opening, Astra 2b #3) AND the
  drill relief its FLASHED opening does not cover — the 1.8 mm drill against a
  1.0 + 2 · 0.3 = 1.6 mm flash, giving a 1.8 + 2 · 0.3 = 2.4 mm relief. The
  containment is measured against the flash and not the declared shape, because
  a negative expansion shrinks the opening below a drill the declared size
  "covers" (Astra run 2 #2). The pad's own two openings merge, so this pair
  is measured between COMPONENTS — the relief's merged window against the
  neighbouring pad's — at **0.0474 mm**. Either side being copper-less makes it
  a sliver rather than a bridge.

### `FAB_MASK_TO_COPPER` — 1

- **`mk_cuPad` / `mk_cu`** (26, -16) — a 0.4 mm trace on net `MK_NT` whose
  copper edge is **0.050 mm** from a different-net pad's opening, against
  JLCPCB's 0.09 mm row. Net equality is NOT the exemption (Astra #10): an
  opening is entitled to its OWN copper (`ownerKey`) and to whatever TOUCHES
  it, which is why the `cs_pourBridge` free pad inside its own same-net pours,
  and every trace that actually enters a pad, report nothing.

### Deliberate passes

- **`mk_smdDrill`** (34, -16) — a DRILLED `smd` free pad (2 x 2 mm copper,
  0.6 mm drill). Its declared face gets the pad opening (2.15 mm); the FAR face
  gets the drill relief unconditionally — 0.6 + 2 · 0.075 = **0.75 mm** — which
  is the 06 §9 fix (§1.3). Before S12 the bottom face kept solder mask
  stretched over an open NPTH. It is isolated, so the opening itself raises
  nothing; `gerber-silk-parity.test.ts` is what asserts the flash exists.

## Incidental hits (both blocks)

`TRACK_DANGLING` (9), `VIA_DANGLING` (5) and one `UNCONNECTED_NET` fall out of
the acute-wedge traces, the filler and untented vias reaching no pad, and the
two same-net `mk_slv*` pads that are deliberately not connected. They are not
what this fixture is about, but they are deterministic and are counted in the
baseline.
