# golden-cutouts-2l

Second DRC golden board (WP3b, S2 hardening). Outline is an 80x60 roundrect
(cornerRadiusMm 15) with five cutouts (c1-c5) covering circle and full-radius
roundrect ("slot") shapes. Every cutout is kept >= 0.5 mm from the outline and
from every other cutout (c4/c5 are the tightest pair, at exactly a 0.5 mm web)
so the board produces **zero** `BOARD_OUTLINE_INVALID` (contract S2 SS6:
touching/tangent/edge-touching cutouts are invalid).

Deliberate violation-bearing items:

- `t_cross` - 1.0 mm trace straight through c1 (a circular cutout), vertices
  outside it -> `COPPER_OFF_BOARD` + `COPPER_TO_BOARD_EDGE` (crossing not
  caught by vertex-only sampling).
- `t_slot` (B.Cu, to avoid shorting `pad_fill` at the same spot) - 0.4 mm trace
  through c3 (the vertical slot) -> `COPPER_OFF_BOARD`.
- `t_corner_ok` / `t_corner_bad` - 0.3 mm traces tangent to the bottom-right
  rounded corner (center (25,-15), r=15) at true gaps 0.6 mm and 0.45 mm
  against the 0.5 mm copper-to-edge rule -> ok produces no violation, bad
  produces `COPPER_TO_BOARD_EDGE` only (still inside the biased region).
- `t_poke` - 0.5 mm trace centered 0.1 mm inside the straight top edge ->
  pokes out 0.15 mm -> `COPPER_OFF_BOARD` + `COPPER_TO_BOARD_EDGE`.
- `t_edge_ok` - 0.2 mm trace along the bottom edge at exactly the 0.5 mm
  required gap -> no violation (exact-spec passes).
- `pad_slot` / `pad_fill` / `pad_corner` - rect pads placed through c2's slot
  interior, exactly filling c3, and straddling the top-left rounded corner
  arc -> each `COPPER_OFF_BOARD` + `COPPER_TO_BOARD_EDGE` (0 mm perimeter gap).
- `via_tangent` / `via_edge` / `via_out` - vias at 0.8 / 0.5 / 0.2 mm from the
  right edge -> no violation / `COPPER_TO_BOARD_EDGE` only / both
  (`via_out`'s own drill also trips a `HOLE_TO_BOARD_EDGE` warning, since a
  via's hole is checked the same way a free hole is).
- `hole_slot` - a 4x1 mm routed slot hole whose end enters c1 ->
  `HOLE_OFF_BOARD` error (S6: a breach is `HOLE_OFF_BOARD`, a near miss stays `HOLE_TO_BOARD_EDGE`). `hole_warn` - a round hole 0.1 mm inside the
  default 0.3 mm hole-to-edge rule from c1 -> `HOLE_TO_BOARD_EDGE` warning.
- `t_tt_a` / `t_tt_b` - parallel traces 0.15 mm apart (below the 0.25 mm rule)
  -> `TRACE_TO_TRACE_CLEARANCE`.
- `t_short_a` / `t_short_b` - crossing traces on different nets ->
  `NET_SHORT_CIRCUIT`.
- `unc1` / `unc2` (+ `vcc`, `gnd`) - nets with pads but no connecting copper
  -> `UNCONNECTED_NET` (>= 2, required by the golden-suite non-triviality
  gate).

Ordinary routing (U1/J1/J2/R1-R6, a GND pour zone) pads out the primitive
count comfortably past the >=80 gate and contributes incidental realistic
violations (`NETCLASS_TRACE_WIDTH`, `TRACK_DANGLING`, `VIA_DANGLING`,
`ISOLATED_COPPER_ISLAND`) that are not part of this fixture's contract but are
expected of a board this size.
