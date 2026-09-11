# golden-arcs-2l

S12b golden (exact-geometry contract 12). A 200 × 140 mm two-layer board whose
outline is a **contour** carrying a convex fillet, a concave notch and an outer
neck, with twelve cutouts chosen so that every §3 / §4 / §5 rule has at least one
witness. `designRules.outline.minWebMm = 1.0` and
`clearance.copperToBoardEdgeMm = 0.2`; fabricator `custom`, so no milling
advisory fires and every verdict here is a DESIGN-rule verdict.

83 primitives, 37 violations.

## Outline (`contour`, CCW)

- `x ∈ [-100, 100]`, `y ∈ [-70, 70]`.
- **Convex fillet** r = 20 about `(80, 50)`, from `(100, 50)` to `(80, 70)`. Its
  inward-biased chords sit up to 0.0095 mm inside the true arc.
- **Concave notch** r = 10 about `(0, -70)`, a half-disc removed from the bottom
  edge. Its biased chords bulge into the material by up to 0.0095 mm.
- **Outer neck**: two opposing slots at `x ∈ [-62, -58]`, one from the top edge
  down to `y = 0.3` and one from the bottom edge up to `y = -0.3`, leaving a
  **0.6 mm × 4 mm isthmus**. The erosion separates the board into two cores, so
  this is the one web located by the copper kernel's NECK arm (§5.1), not by the
  opposing-wall rule — both of its walls are the SAME ring.

## Cutouts

| # | id | shape | why it is here |
|---|---|---|---|
| 1 | `ann_a` | circle r=8 @ (30, 40) | with `ann_b`: an **arc–arc annulus**, 0.5 mm apart |
| 2 | `ann_b` | circle r=8 @ (46.5, 40) | ” |
| 3 | `band` | circle r=10 @ (0, 59.5) | a **0.5 mm band** between a void and the top edge |
| 4 | `rect_a` | contour rect [-35,-25]×[35,45] | with `rect_b`: **Astra run 1 #4** — two SEPARATE voids 0.5 mm apart that the material still runs around. One erosion core, no neck; the opposing-wall rule is the only thing that sees it |
| 5 | `rect_b` | contour rect [-24.5,-14.5]×[35,45] | ” |
| 6 | `plain_rr` | roundrect 20×20 r=5 @ (70,-40) | **Astra run 1 #7** — a plain roundrect void must report NOTHING. Its four corner residuals touch ONE ring |
| 7 | `nest_out` | circle r=12 @ (-80,-40) | with `nest_in`: **rule (e)**, concentric voids |
| 8 | `nest_in` | circle r=5 @ (-80,-40) | ” |
| 9 | `semi` | circle r=6 @ (-80, 40) | **Astra run 1 #12** — a `circle` is TWO exact semicircles sharing BOTH endpoints; both junctions are legal and neither is a retrace |
| 10 | `ellipse` | circle 20×10 @ (-80, 0) | the `{ kind: "chords" }` arm (§2.4): no finite circular-arc form, so it keeps today's chord rules and is never certified exact |
| 11 | `thin_strip` | contour rect [20,60]×[50,69.9995] | **Astra run 1 #5** — a 0.0005 mm-thick strip of board against the top edge, measured EXACTLY by the ring-pair arm |
| 12 | `graze` | circle r=2 @ (92.727, 62.727) | **S2 #8 / rule (c)**: its wall passes **0.002 mm** inside the convex fillet — closer than the 0.0095 mm chord deviation |
| 13 | `poly_lobe` | contour @ (62, 22) | a HORSESHOE void: its mouth pinches the material to **0.5 mm** and BOTH walls of that web are the SAME ring (§5.1 amended — the contact-run rule) |

## Expected violations (37)

### `BOARD_OUTLINE_INVALID` (1)

- **`nest_in` inside `nest_out`** — "Cutout 8 lies inside cutout 7 — merge them",
  at the inner cutout's centre `(-80, -40)`. Rule **(e)**, new in S12b:
  concentric cutouts pass every pairwise rule (b)–(d), today and under the exact
  ones, and the material between them is not material at all.

### `OUTLINE_MIN_WEB` (7, warnings)

All seven are new in S12b; every one is measured, none is floored.

| location | measured | source | arm |
|---|---|---|---|
| (-60.00, 0.00) | 0.600 | the outer neck's isthmus | NECK (two erosion cores) |
| (62.00, 28.00) | 0.500 | `poly_lobe`'s horseshoe mouth | NECK (two erosion cores); its residual ALSO has two contact runs on ONE ring |
| (94.14, 64.14) | **0.0020** | `graze` ↔ the convex fillet | **RING PAIR** (rings 0 ↔ 12) |
| (0.00, 69.75) | **0.5000** | `band` ↔ the top edge | **RING PAIR** (rings 0 ↔ 3) |
| (-24.75, 35.00) | **0.5000** | `rect_a` ↔ `rect_b` | **RING PAIR** (rings 4 ↔ 5) — Astra run 1 #4 |
| (38.25, 40.00) | **0.5000** | `ann_a` ↔ `ann_b` | **RING PAIR** (rings 1 ↔ 2) |
| (20.00, 70.00) | **0.0005** | `thin_strip` ↔ the top edge | **RING PAIR** (rings 0 ↔ 11) — Astra run 1 #5 |

**S12b Astra-run-2 delta.** The count is unchanged at seven, but the five rows
between DISTINCT rings are now measured by §5.1's third arm — the EXACT distance
between the two boundaries, which needs no erosion — instead of the residual's
mean thickness. They read their authored values to the last digit (0.5000,
0.0020, 0.0005 where the erosion read 0.383 / 0.471 / 0.459, 0.157 and 0.003),
carry no chord band in the message, and two of them moved onto the true closest
pair: `band` from (-0.00, 69.68) to (0.00, 69.75) and `rect_a` ↔ `rect_b` from
(-24.75, 40.00) to (-24.75, 35.00). The two NECK rows, whose walls are ONE ring,
are unchanged.

`measuredMm` for an EROSION row is still the residual's MEAN thickness
`2·area/perimeter`, which reads a 0.5 mm web as ≈0.46: the residual loses its
ends to the opening's disc reach and gains their perimeter. Only those rows state
the band (`0.9965 … 1.000 mm`), which is `(w − 3e-3 − 2·δ, w)` with `δ` the
ACHIEVED chord deviation of the 10×-refined material flattening.

### `COPPER_OFF_BOARD` (3, errors) and `COPPER_TO_BOARD_EDGE` (2, errors)

- **`fp_across_notch`** — a 24 × 4 rect free pad at `(0, -59)`. Every VERTEX is
  on the board; its bottom EDGE crosses the semicircular notch. **Astra run 1
  #3**: "vertices inside + unsigned distance ≥ 0" accepts this pad, and the
  edge-subinterval containment rule rejects it. → `COPPER_OFF_BOARD` +
  `COPPER_TO_BOARD_EDGE` (0.000 mm).
- **`t_off`** — a B.Cu trace at `x = -59.5`, `y ∈ [20, 60]`: straight up the
  outer neck's top slot, which is not board at all. → `COPPER_OFF_BOARD`.
- **`t_edge`** — a 0.3 mm trace whose centreline runs 0.1 mm inside the bottom
  edge, so its copper pokes 0.05 mm out. → `COPPER_OFF_BOARD` +
  `COPPER_TO_BOARD_EDGE` (−0.050 mm).

### `TRACK_DANGLING` (2) / `VIA_DANGLING` (22), warnings

The corpus bulk: 50 free pads, 22 vias, 8 free holes and 2 traces, none of them
connected to anything. They exist to clear the fixture's ≥ 80-primitive gate.

## What must NOT be reported (the S12b claims this board pins)

- **`v_band_convex`** (via Ø0.8 at 0.205 mm true clearance from the convex
  fillet, on the 0.2 mm rule) — the inner region measures **0.195250** (a FAIL)
  and the outer-bias region **0.212562** (a PASS), so the verdict is AMBIGUOUS
  and is recomputed exactly: 0.205 > 0.2 → **no violation**. S12 reported a
  `COPPER_TO_BOARD_EDGE` error here. This is §4's chord-band second chance
  (02 §6, closed).
- **`v_band_concave`** — the same, against the concave notch at 152.5° (a
  mid-chord angle, where the tangent chain deviates most): inner **0.195473**,
  outer **0.214518**, exact 0.205 → **no violation**.
- **`graze`** — `ringStrictlyInside` on the BIASED rings fails for this cutout
  (the inward-biased fillet chords cross its 0.002 mm wall), so S12 reported a
  `BOARD_OUTLINE_INVALID`. Rule (c) on the exact contour measures 0.002 mm >
  `GEOM_EPS_MM` → **valid**. This is the S2 #8 class, closed.
- **`plain_rr`** — no `OUTLINE_MIN_WEB` anywhere near it (Astra run 1 #7).
- **`semi`** — a `circle` cutout is two 180° arcs sharing both endpoints; neither
  junction is a crossing and their shared ANGLE is a single point, not an
  interval, so it is not a retrace (Astra run 1 #12).
- **`ellipse`** — enters as `{ kind: "chords" }` and provokes nothing.

## Stated gaps of this fixture

- **A web with two contact runs on ONE ring is always ALSO a neck here.** The
  amended §5.1 counts contact COMPONENTS along the residual's own boundary, so
  `poly_lobe`'s horseshoe mouth qualifies under the opposing-wall rule — but a
  simple closed cutout curve that pinches the material in ONE place makes that
  pinch a cut vertex of the material, so the erosion separates two cores and
  `analyseGroup`'s neck arm names it first (measured 0.5000 by the wall-normal
  chord, not by the residual's mean thickness). The contact-run form is
  therefore a second, independent detector for these shapes rather than the only
  one; it is what keeps a residual whose contact is ONE component — a roundrect
  corner, a strip along a convex arc — out of the report.
- **No capped arc and no fallback ring on THIS board.** A flattening that
  reaches `MAX_ARC_SEGMENTS` needs `sweep > 1024·√(0.02/r)`, which with
  `sweep ≤ 2π` forces `r ≳ 531 mm` — a metre-scale feature a 200 × 140 mm board
  cannot host; it is pinned by `drc-outline-exact.test.ts` instead.
  A fallback ring CAN be authored (R2 built two): a 400 × 200 contour of two
  100 mm lobes meeting at a 1 µm pinch yields `fallbacks = [0]`, and so does a
  4 000 mm-radius sliver. Both are whole OUTLINES rather than cutouts, so they
  cannot join this board; the `unknown`-containment arm they exercise — Astra
  run 1 #13's via in the omitted chord segment, and a via the exact path must
  still FAIL — is pinned in `drc-audit-b4.test.ts` (B4-10), together with the
  exhausted-budget note (B4-11).
