# golden-pours-2l

Fourth DRC golden board (S5, copper-pour correctness). It exists to pin the
pour codes of docs/pcb-hardening/04-copper-pour-contract.md SS10 and the SS3.3
precedence carve behind them, on geometry the earlier goldens do not have:
an 80x60 **roundrect** outline (corner radius 5 mm) with one circular cutout,
2 layers, and twelve effective copper areas.

## Copper areas

- `board:F.Cu` / `board:B.Cu` - GND planes on both sides.
- `z_pri_lo` (NET_A, priority 0) / `z_pri_hi` (NET_B, priority 2) - overlapping
  F.Cu polygons of DIFFERENT nets at DIFFERENT priorities. **No violation**:
  SS3.3 carves `z_pri_lo` around `z_pri_hi` plus the mutual clearance, so the
  contested band belongs to the higher zone alone and the artwork is
  unambiguous. `z_pri_lo` pours ~311 mm2 of its 400 mm2 outline; the missing
  copper IS the carve. This is the pair that pinned the pre-S5 gap in
  `golden-areas-2l` and now pins the fix.
- `z_eq_c` (NET_C) / `z_eq_d` (NET_D), both priority 1 - the same picture at
  EQUAL priority. The carve is mutual, the contested area belongs to neither
  fill, and the user's intent is genuinely ambiguous -> the fixture's **one**
  `ZONE_OVERLAP` (error).
- `z_same_tight` / `z_same_wide` - two overlapping F.Cu zones of the SAME net
  (NET_A) with different `clearanceMm` overrides (0.5 and 0.8) around the
  NET_B pad `P_B`. Same-net zones never carve each other, so both pour and each
  keeps its own antipad around `P_B`. This is the pair the Gerber must UNION
  (contract SS9): emitting them one after the other would cut the wide zone's
  1.1 mm antipad out of the copper the tight zone had already laid down.
- `z_hole` (GND) - a polygon zone with ONE `holesMm` cutout (SS11). The hole is
  removed from the extent EXACTLY, with clearance 0, so the fill is the zone
  area minus the hole area (320 - 36 = ~284 mm2) and the island carries exactly
  one hole ring.
- `z_none` (GND, `padConnection: "none"`) - poured over the same-net GND pad
  `P_NONE`, which is therefore treated as different-net copper: a full
  clearance halo, no flood, no island membership (SS4).
- `z_therm` (GND, `padConnection: "thermal"`, gap 0.4 / spoke 0.5) - poured over
  `P_ROT`, a rect pad rotated **30 deg**. A non-cardinal rotation is the case a
  bounding-box relief would get wrong; the island's hole ring set carries the
  relief and its spokes.
- `z_empty` (GND, B.Cu) - lies entirely inside the `k_pour` keepout, so its
  extent is empty -> `ZONE_EMPTY_FILL` (warning). An empty extent is a
  geometric fact and must never be reported as `ZONE_FILL_FAILED` (SS8).

## Keepout

- `k_pour` (B.Cu, `copperPour` only) - the band `z_empty` sits inside.

## The dead island (audit B3-10)

`t_split` is a full-width 2 mm SPLITTER trace across B.Cu at y = 14, cutting the
B.Cu GND plane into two islands. The upper island contains only `t_stub`, a
floating GND trace with no pad on it. The kernel's `attached` flag is TRUE for
that island (S1 membership is "touches any same-net bare copper" - the
island-REMOVAL criterion), so the pre-S5 check stayed silent. The verdict is now
the island's connectivity COMPONENT reaching a `pad:`/`freepad:` item, so the
upper island reports the fixture's single `ISOLATED_COPPER_ISLAND` (warning),
anchored on `{ net: gnd }` because a board zone has at most one pour per layer.
The area rides in the MESSAGE; `measuredMm` is omitted (audit B3-9).

## Deliberate content

`J1` carries an **oval** through-hole pad (pad 1) next to seven round ones;
`J2` is an all-round THT header; `mh1` is an NPTH mounting hole in the rounded
top-left corner; `fp_gnd` and `fp_free` are `std` free pads, one on GND and one
with **no net at all** (the null-net obstacle class). `U1` (SOIC-16), ten 0603
resistors, twelve stitching vias and short single-pad trace stubs carry the
primitive count past the >=80 gate.

Each explicit zone net owns one pad inside its own zone (`P_NA1`, `P_NA2`,
`P_NB`, `P_NC`, `P_ND`), so every explicit fill is electrically LIVE and the
only dead copper on the board is the deliberate one above.

## Not part of this fixture's contract

The `NETCLASS_*` advisories, `TRACK_DANGLING`, `VIA_DANGLING` and the
`UNCONNECTED_NET` errors are what a partially routed board of this size
produces. Two of them are worth reading, though: NET_A and NET_B each own two
pads that sit in two SEPARATE pours, and the ratsnest keeps an airwire for each
- pour-aware connectivity, not a fixture bug.
