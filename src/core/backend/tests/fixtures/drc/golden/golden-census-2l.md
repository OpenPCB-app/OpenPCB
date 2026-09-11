# golden-census-2l

Sixth DRC golden board (S7 WP4, batch-DRC contract 06 §6 census gate). Unlike
the first five goldens — each pinning one subsystem's behavior — this fixture
exists ONLY to make the emit census a machine gate: together with
`golden-small-2l`, `golden-areas-2l`, `golden-cutouts-2l`, `golden-pours-2l`
and `golden-rules-2l`, the union of every emitted code across all six equals
every `DrcRuleCode` member except `ZONE_FILL_FAILED` (documented exception
below). Fabricator `jlcpcb_2l`, 2-layer, ≥ 80 primitives, ≥ 10 violations
(the golden-suite non-triviality gates), 84 violations / 37 codes in this
fixture alone (82 / 37 from S8 to S10; 84 / 38 until S8: the bridge trace's
two overlap rows left when touching unassigned copper became an extension —
contract 06 §4; S11 added the two fab rows noted under "Hole pairs"), all
ids unique.

Outline: a polygon rectangle (120×90) with two deliberate milling features on
the OUTER outline (not a cutout — S7's cutout-milling semantics were still
in flight in a parallel work package when this fixture was authored, so the
provocation stays on the outer ring to avoid depending on it):

- A rectangular notch cut into the top edge (x 10..20, y 35..45) — its two
  inner corners are sharp (radius 0) reflex vertices biting into the board
  material -> two `OUTLINE_INTERNAL_RADIUS` hits (< jlcpcb_2l's 0.8 mm bit
  radius).
- A 0.5 mm-wide, 5 mm-deep slit cut into the left edge (x -60..-55,
  y 11.75..12.25) — its two parallel walls are 0.5 mm apart, under
  jlcpcb_2l's 1.0 mm minimum slot width -> `OUTLINE_SLOT_WIDTH`.
- A small circular cutout (`c_bad`, r=3) straddling the bottom edge at
  (0,-45) — half outside the outline -> `BOARD_OUTLINE_INVALID` ("touches or
  extends outside the board outline"). Chosen as a circle so it contributes
  no milling-advisory noise of its own (parametric corner/slot checks are
  empty for a circular cutout).
  **S12b id move** (exact-geometry contract 12 §3.1): rule (c) is now judged on
  the EXACT rings and reported at the exact contact point. The circle
  `x² + (y+45)² = 9` meets the bottom edge `y = -45` at `(±3, -45)` and the
  lexicographically smaller witness wins, so the marker moved from the first
  vertex of the flattened cutout ring to `(-3, -45)` and the 0.1 mm id bucket
  moved with it: `BOARD_OUTLINE_INVALID-v2-37ab5e9b4725cbfd` ->
  `BOARD_OUTLINE_INVALID-v2-25128a4a1a9a9008`. The verdict, the count and the
  message are unchanged, and this is the ONLY row of this golden that moved.

Deliberate violation-bearing items, by region (all F.Cu unless noted):

- **Manufacturability / fab (y=-38, x=-50..-40):** `via1` (dia 0.3, drill
  0.1) -> `VIA_DIAMETER_MIN`, `VIA_DRILL_MIN`, `ANNULAR_RING_MIN`,
  `DRILL_SIZE_MIN`, `FAB_DRILL` (< jlcpcb_2l 0.15 mm), `VIA_ASPECT_RATIO`
  (1.6 mm board / 0.1 mm drill = 16:1 > 10:1). `via2` (dia 0.2, drill 0.15)
  -> `FAB_PAD` (< 0.25 mm minPad), `FAB_ANNULAR_RING` (< 0.05 mm), plus the
  board-minimum duplicates. `via_layer_bad` (blind, F.Cu -> In1.Cu on a
  2-layer board) -> `VIA_LAYER_SPAN`.
- **Hole pairs (y=-38, x=-34..-14):** `hh_a1`/`hh_a2` 0.2 mm apart (< board
  0.25 mm) -> `HOLE_TO_HOLE`. `hh_b1`/`hh_b2` 0.4 mm apart (board rule
  passes, < jlcpcb_2l's 0.45 mm PTH/NPTH floor) -> `FAB_HOLE_TO_HOLE`.
  `npth_cross` (NPTH, drill 1.0) directly under `t_over_hole` (0.4 mm trace)
  -> `COPPER_TO_HOLE`. `npth_slot` — a 3×0.6 mm routed slot hole, standalone
  (D3 slot-hole coverage); since S11 also `FAB_DRILL` — a 0.6 mm non-plated
  slot is under jlcpcb_2l's 1.0 mm `minNpthSlotWidthMm` (manufacturability
  contract 10 §4; before S11 every hole was compared with the 0.15 mm via
  drill floor whatever its kind or tool). `fp_smd_drilled` — a drilled `smd`
  free pad (D3: a drill on `smd`/`conn` is non-plated by the one derivation);
  since S11 also `FAB_ANNULAR_RING` — its 1.2 mm copper around a 0.5 mm NPTH
  drill is a 0.35 mm ring under jlcpcb_2l's 0.45 mm `npthAnnularRingMm`
  (contract 10 §4; before S11 NPTH rings had no fab ring check at all). In the
  ARTWORK the same pad lost its `paste.top` aperture in S11: a record with a
  drill, or an unplated one, gets no paste (contract 10 §6.4) — pinned by
  `gerber-pad-parity.test.ts`, not by this report.
- **Clearance pairs (y=-38, x=0..30):** `t_clr_a` vs pad `P_CLR.1`, 0.15 mm
  gap (< 0.25 mm) -> `TRACE_TO_PAD_CLEARANCE`. `t_clr_via` vs `v_clr`,
  0.15 mm gap -> `TRACE_TO_VIA_CLEARANCE`. Pad `P_PV.1` vs `v_pv`, 0.05 mm
  gap -> `PAD_TO_VIA_CLEARANCE`. `t_fabclr_a`/`t_fabclr_b`, 0.08 mm gap,
  under a scoped `drcRules` entry (`fab-clr-relax`, net `fabclr_a` +
  `pairKind: traceToTrace`) that relaxes the ordinary rule to 0.05 mm (so it
  passes) while jlcpcb_2l's 0.1 mm fab floor still fails it ->
  `FAB_CLEARANCE` only.
- **Layer / structural (y=-38, x=34..48):** `t_bad_layer` on `In1.Cu` (a
  2-layer board has none) -> `TRACE_LAYER_MISMATCH`. `P_BADPAD.1` declared
  on `In1.Cu` -> `PAD_LAYER_MISMATCH`. `P_EMPTY` — a placement with zero
  pads -> `PLACED_PART_MISSING_FOOTPRINT`.
- **Electrical / SI / length (y=-20, x=-50..6):** net class `hv`
  (`voltageV: 230`) on `t_hv` vs 0 V `t_lv`, 0.3 mm gap (passes the ordinary
  0.25 mm rule, fails the IPC-2221 230 V / B2 requirement of 1.25 mm) ->
  `CREEPAGE_DISTANCE`. Net class `hc` (`currentA: 3`) on the default-width
  (0.2 mm) trace `t_hc`, well under the ~1.37 mm IPC-2221 minimum for 3 A ->
  `TRACE_CURRENT_WIDTH`. Diff pair `dp1` (`dp_p` 20 mm, `dp_n` 2 mm, coupled
  over the first 2 mm at a 0.7 mm gap against an explicit 0.2 mm target) ->
  `DIFF_PAIR_GAP` (gap deviation 0.5 mm > 0.05 mm tolerance),
  `DIFF_PAIR_SKEW` (18 mm > 0.5 mm), `DIFF_PAIR_UNCOUPLED_LENGTH` (18 mm >
  15 mm) — one diff pair provokes all three signal-integrity codes. Net
  `lg1` (3 mm routed) against an absolute length-match group target of
  10 mm ± 1 mm -> `NET_LENGTH_OUT_OF_RANGE`.
- **Keepouts (y=-8, x=-50..-4), one item per restriction kind:** `k_tracks`
  (tracks) crossed by `t_ko_tracks`; `k_vias` (vias) containing `v_ko`;
  `k_pads` (pads) containing `P_KO.1`; `k_body` (footprints) overlapped by
  `P_BODY`'s `F.CrtYd` courtyard while its pad stays outside (proves the
  extent is the courtyard, not the pad hull, matching `golden-areas-2l`'s
  `k_body`) — all four -> `KEEPOUT_VIOLATION`. `k_pour` (copperPour) carves
  a corner off the `z_ko_pour` B.Cu zone, same mechanism as
  `golden-areas-2l`'s `k_pour` (no code of its own; visible as the extra
  `ISOLATED_COPPER_ISLAND`).
- **Zones (y=-6..4, x=0..16):** `z_ov_a` / `z_ov_b`, equal priority (0),
  overlapping on F.Cu with different nets -> `ZONE_OVERLAP`. `z_off`, a
  polygon entirely off the board -> `ZONE_EMPTY_FILL`. `z_ko_pour`, an
  unbound net id (not in `netNames`) -> a second, independent
  `ZONE_EMPTY_FILL` reason (unbound net rather than off-board).
- **Shorts (D5/D6, y=-1, x=22..38):** `P_SHORT`'s two pads (`.1`/`.2`,
  different nets) overlap inside one footprint — clearance/fab tiers are
  skipped for intra-footprint pairs, but the short tier is not ->
  `NET_SHORT_CIRCUIT` (intra-footprint variant). `t_bridge_a` (net
  `bridge_a`) and `t_bridge_b` (net `bridge_b`) do NOT touch each other;
  a null-net trace `t_bridge_null` sits between them and touches both ->
  `NET_SHORT_CIRCUIT` (null-net bridge variant, D6 — the two-net-touch
  aggregation after the six clearance loops). Its two −0.300 mm overlaps
  with the runs are NOT clearance rows since S8: touching unassigned copper
  is an extension of what it touches (06 §4), so the fault is reported once,
  as the bridge.
- **Dangling / island (y=15..19, x=0..14):** `t_dangle` + `via_dangle`,
  each with no other copper on its net -> `TRACK_DANGLING` / `VIA_DANGLING`.
  `t_island_a`/`t_island_b`, a two-segment L on net `island1` with no pad or
  via anywhere on that net -> both ends dangle too (adds to the same codes;
  already pinned by the other five goldens, kept here for routing realism).
- **Rules (`board.drcRules`):** `fab-clr-relax` (net + pairKind scope, see
  above, effective). `bad-area` — a ~0 mm² `area` scope polygon -> excluded
  from resolution -> `DRC_RULE_INVALID`. `ghost-net` — a `net` scope naming
  `does_not_exist` -> resolves to nothing -> `DRC_RULE_INEFFECTIVE`.
  `layer-scoped` — a `layer` + `pairKind` scoped rule (B.Cu via-to-via,
  1.0 mm), effective but inert here (no via-to-via pair on B.Cu).
- **Ordinary routing padding:** five unrouted SOIC-8 placements (`U_R1..5`,
  y=25, 40 pads, one net per pin) pad the primitive count past the ≥ 80
  gate without contributing new codes.

## Exception: `ZONE_FILL_FAILED`

`ZONE_FILL_FAILED` is the only `DrcRuleCode` NOT provoked anywhere in the
six-fixture corpus. It fires only when the copper-fill KERNEL itself throws
or refuses (copper-pour contract §8) — not from any board geometry a golden
fixture can express through the normal projection/DRC path. It is pinned
directly against a synthetic draft in `drc-copper-pour.test.ts` (`describe("ZONE_FILL_FAILED", …)`),
which asserts the code, its `RULE_CLASS_BY_CODE` entry (`"structural"`), its
default severity (`"error"`) and its `NON_OVERRIDABLE` membership without
needing to hack the fill kernel into failing. `drc-census.test.ts` lists this
as the sole, justified corpus exception.

## S12 — DFM overlay hits on pre-existing geometry (contract 11)

Re-baselined 2026-09-11 for the S12 solder-mask check; no fixture change. Every hit is a new
code firing on geometry that was already in the fixture:

- `FAB_MASK_BRIDGE` +1 — `P_SHORT` pads 1 and 2 are 0.4 mm apart, so their 0.075 mm-expanded
  openings OVERLAP: different nets, both copper ⇒ a bridge with `measuredMm 0` ("openings
  overlap — no dam"; JLCPCB dam 0.10 mm, contract 11 §4).
- `FAB_MASK_TO_COPPER` +2 — `P_PV`'s opening reaches x = 18.575 while via `v_pv`'s copper starts
  at 18.55 (the via does NOT touch the pad, gap 0.05 mm, so it is not the opening's own copper);
  `P_CLR`'s opening sits 0.075 mm from trace `t_clr_a` (JLCPCB "keep 0.09 mm between soldermask
  openings and neighbouring traces").
- Astra run 2 fold (2026-09-11): the `P_SHORT` bridge's witness moved from (22.375, −1.575) to
  (21.625, −1.575) — same code, count, anchors and `measuredMm 0`; `ringGapToRing` now breaks a
  witness tie on the smaller `(x, y)` instead of the operand order (the fix for a pad-reversal
  non-determinism), so the id moved to the other corner of the same overlap.
