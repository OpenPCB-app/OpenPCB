# golden-census-2l

Sixth DRC golden board (S7 WP4, batch-DRC contract 06 §6 census gate). Unlike
the first five goldens — each pinning one subsystem's behavior — this fixture
exists ONLY to make the emit census a machine gate: together with
`golden-small-2l`, `golden-areas-2l`, `golden-cutouts-2l`, `golden-pours-2l`
and `golden-rules-2l`, the union of every emitted code across all six equals
every `DrcRuleCode` member except `ZONE_FILL_FAILED` (documented exception
below). Fabricator `jlcpcb_2l`, 2-layer, ≥ 80 primitives, ≥ 10 violations
(the golden-suite non-triviality gates), 85 violations / 40 codes in this
fixture alone since S14 (87 / 39 from S11 to S13; 82 / 37 from S8 to S10;
84 / 38 until S8: the bridge trace's two overlap rows left when touching
unassigned copper became an extension — contract 06 §4; S11 added the two fab
rows noted under "Hole pairs"; S14 traded three `TRACK_DANGLING` rows for the
pad terminals the path model needs and added `NET_LENGTH_UNDEFINED`), all
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
  over the first 2 mm at a 0.5 mm copper gap against an explicit 0.2 mm
  target) -> `DIFF_PAIR_GAP`, `DIFF_PAIR_SKEW`, `DIFF_PAIR_UNCOUPLED_LENGTH`
  — one diff pair provokes all three signal-integrity codes. Net `lg1`
  (3 mm routed) against an absolute length-match group target of
  10 mm ± 1 mm -> `NET_LENGTH_OUT_OF_RANGE`. Net `lg2`, the second member of
  that group, is reached from its two pads by TWO routes (`t_lg2_a` straight,
  `t_lg2_b` around three sides) -> `NET_LENGTH_UNDEFINED`. Since S14 all four
  of these nets carry PAD TERMINALS (`P_DPP_*`, `P_DPN_*`, `P_LG_*`,
  `P_LG2_*`, 0.3 mm pads with a declared 0.5 mm `F.CrtYd` so the two pads
  0.7 mm apart at x = −20 do not read as a courtyard overlap): under the path
  model a trace-only net has no routed length at all, so without them every
  code in this paragraph would go silent (contract 14 §2.7, §9).
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

## S13 — electrical constituents and effective nets: no delta (contract 13 §7)

Re-verified 2026-09-12 after the S13 work packages landed; **`golden-census-2l`
is byte-identical and was not re-baselined**. Contract 13 §7 enumerates six
migration causes and this fixture is untouched by all six — worth recording,
because it is the only pre-S13 golden that declares a voltage at all:

- **(a) comparison regime** (`below` 1e-6 → `clearanceViolated` 5e-7). No row of
  this fixture has a gap in the `[required − 1e-6, required − 5e-7)` band. The
  `t_hv` / `t_lv` pair is 0.3 mm against 1.25 mm and the `t_fabclr` pair is
  0.08 against 0.1 — both far outside it.
- **(b) effective nets (B7-1).** `t_bridge_null` is this fixture's only
  unassigned copper and it touches `t_bridge_a` AND `t_bridge_b` — two named
  nets, so its component has two labels and it stays NULL-tiered (13 §4.1).
  It therefore gains no class, its two −0.300 mm overlaps stay suppressed as
  the S8 extension rule already had them, and the single `NET_SHORT_CIRCUIT`
  (null-net bridge variant) is unchanged.
- **(c) chain and component-wide shorts.** `t_bridge_null` touches both nets
  DIRECTLY, so the direct-bridge draft already names the component's whole
  label set and §4.3's extra component draft does not fire. No new row.
- **(d) both constituents reported.** The `t_hv` / `t_lv` pair breaches only the
  voltage constituent (0.3 mm clears the 0.25 mm ordinary rule), so it was one
  row before S13 and is one row after. No pair here breaches both.
- **(e) pour carve on a board with declared voltages.** `hv` (230 V) is on
  `t_hv` at y = −20; the nearest zone (`z_ov_a` / `z_ov_b`, y −6…4) is over
  14 mm away, far outside the 1.25 mm B2 halo, so no fill geometry moves.
- **(f) exposure.** This fixture sets no `designRules.electrical`, so
  `outerConductors` is absent, B4 is unavailable and every outer pair stays in
  B2 — the column the pre-S13 check used. The mask artwork is never consulted.

`CREEPAGE_DISTANCE` ids are preserved by construction in any case: the id is
code + sorted anchors + layer (never location-hashed) and the layered aggregate
still reports the STRICTEST layer (13 §3.3).

## S14 — routed length and coupling become measures over the path (contract 14)

Re-fixtured and re-baselined 2026-09-13 (WP3). The fixture change is ADDITIVE —
eight pad placements, the two `lg2` traces, `lg2` in `netNames` and in the
`lg1grp` member list; no existing item moved. 87 -> 85 violations, 35 errors
unchanged, 52 -> 50 warnings. Cause by cause:

- **`TRACK_DANGLING` 18 -> 15.** `t_dp_p`, `t_dp_n` and `t_lg` now end on pads
  instead of in mid-air. This is the fixture change, not an engine change: the
  three rows describe copper that no longer dangles.
- **`NET_LENGTH_UNDEFINED` +1 (new code).** `lg2` is joined to its two pads by
  two independent routes, so no single routed length exists and the length rule
  says so instead of summing both (contract 14 §2.4, §3). This is also the
  corpus' only occurrence of the code, which is what keeps
  `drc-golden.test.ts`'s corpus-union gate and the oracle's non-vacuity test
  honest without a new exception entry.
- **`NET_LENGTH_OUT_OF_RANGE` unchanged (1).** `lg1` measures 2.7 mm now (3 mm
  of trace minus the 0.15 mm of copper inside each pad — copper inside a
  terminal is not routed length, §2.2) against the same 10 mm ± 1 mm target.
- **The three `DIFF_PAIR_*` rows keep their codes and counts, and all three
  MOVE ID.** Two independent causes, neither a change of verdict:
  (a) the `diffPair` anchor key is now canonicalised `min(p, n)` first
  (§5, Astra #14), and this pair's stored order is `dp_p` / `dp_n`, so every
  id that hashes it changes; (b) `DIFF_PAIR_UNCOUPLED_LENGTH` additionally
  gained its second anchor — the worse member, `dp_p` (§8).
  `DIFF_PAIR_GAP-v2-e4f6c4cf0b8a2c48` -> `-v2-6f5be11aa1d971f8`,
  `DIFF_PAIR_SKEW-v2-c9c757bf9df0b41e` -> `-v2-fa594437a9c3ed9e`,
  `DIFF_PAIR_UNCOUPLED_LENGTH-v2-82f06617c2cb899a` -> `-v2-582bdef23f9564cf`.
- **What the three now measure.** `DIFF_PAIR_GAP` reports 1.850 mm — an
  off-band COPPER LENGTH (§4.2), not a gap deviation: the 1.850 mm of `dp_p`
  that runs beside `dp_n` at a 0.5 mm gap, outside the 0.2 ± 0.05 mm band. It
  is the MAX over the two members, not their sum (`dp_n` sees the same stretch
  as its own whole 1.700 mm path; the message states both figures). The figure
  was 2.699 mm before the amended `wide` rule: the extra 0.849 mm was the band
  `dp_p` runs through as it passes `dp_n`'s END CAP, where the gap opens from
  0.5 mm to the edge of the coupling window — copper beside the rounded end of
  the partner, not beside the partner's run.
  `DIFF_PAIR_SKEW` reports 18.000 mm
  (19.7 − 1.7, the two paths with their pad interiors clipped). 
  `DIFF_PAIR_UNCOUPLED_LENGTH` reports 17.00 mm of `dp_p` beside no `dp_n`
  copper. The pre-S14 numbers (18 mm skew, 18 mm uncoupled) came from summing
  trace polylines.
- **No other row moved.** The nine other goldens are byte-identical.
