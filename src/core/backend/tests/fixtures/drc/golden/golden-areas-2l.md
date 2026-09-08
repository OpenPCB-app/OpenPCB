# golden-areas-2l

Third DRC golden board (S4, zone/keepout legality integration). Outline is a
plain 80x60 rect, 2-layer, so nothing here is about the outline: the fixture
exists to pin the four area codes — `KEEPOUT_VIOLATION`, `ZONE_OVERLAP`,
`ZONE_INVALID`, `ZONE_EMPTY_FILL` — and the fill parity behind them
(docs/pcb-hardening/03-zone-keepout-contract.md SS13).

Copper areas:

- `z_ov_a` / `z_ov_b` - F.Cu polygon zones on SIG_A / SIG_B, BOTH priority 0,
  rings overlapping over [-25,-20] x [15,25] -> one `ZONE_OVERLAP` (error), the
  marker at the centre of the two rings' bounds intersection.
- `z_pri_a` / `z_pri_b` - the same picture with priorities 0 and 2 -> **no**
  violation since S5. The fill carves `z_pri_a` around `z_pri_b` (copper-pour
  contract SS3.3), so the contested [20,25] x [15,25] belongs to the higher
  zone alone and there is nothing ambiguous to report; the check narrowed to
  equal-priority pairs (SS10). This line pinned the pre-S5 GAP and now pins the
  carve: the golden's `ZONE_OVERLAP` count went 2 -> 1 and the violation id
  `ZONE_OVERLAP-v2-54016d05defcd53f` left the expected file.
- `z_off` - a polygon zone entirely off the board -> `ZONE_EMPTY_FILL`
  (warning): its extent is `polygon INTERSECT R_board-`, which is empty.
- `board:B.Cu` - the GND plane on the back.

Keepouts (all enabled; each carries exactly ONE restriction so the item classes
cannot cross-contaminate):

- `k_tracks` (F.Cu, `tracks`) - `t_ko` runs straight through it ->
  `KEEPOUT_VIOLATION`.
- `k_vias` (F.Cu, `vias`) - `via_ko` sits inside it -> `KEEPOUT_VIOLATION`.
- `k_pads` (F.Cu, `pads`) - `P_KO`'s only pad is inside it ->
  `KEEPOUT_VIOLATION`.
- `k_body` (F.Cu, `footprints`) - `P_BODY` carries an `F.CrtYd` courtyard
  rectangle that overlaps it while its pad stays outside ->
  `KEEPOUT_VIOLATION` anchored on the placement, not on a pad. This is the
  branch that proves the extent is the courtyard and not a pad hull.
- `k_pour` (B.Cu, `copperPour`) - an L-shaped band that fences the top-right
  corner off the GND plane. The corner island then anchors on no GND copper, so
  the keepout's effect on the FILL is visible as an extra
  `ISOLATED_COPPER_ISLAND` on B.Cu (the fifth). Without the keepout threaded
  into the pour, the plane is one anchored island and that warning disappears.
- `k_bow` (F.Cu, `tracks`) - a self-intersecting "bow tie" ring the derivation
  refuses -> `ZONE_INVALID` (error, non-waivable, non-overridable).

Deliberate control:

- `t_edge_ok` - a 0.25 mm trace whose right edge lies EXACTLY on `k_tracks`'s
  left edge (x = -10). A keepout has clearance 0, so touching the boundary is
  legal -> no violation. It is kept clear of `t_ko` so the pair does not also
  trip `NET_SHORT_CIRCUIT`.

Ordinary content (U1 SOIC-16, J1/J2 headers, R1-R8, their traces, GND stitching
vias, two free pads and two mounting holes) pads the primitive count past the
>=80 gate and contributes the incidental `UNCONNECTED_NET`, `TRACK_DANGLING`,
`VIA_DANGLING` and F.Cu `ISOLATED_COPPER_ISLAND` warnings a partially routed
board of this size is expected to produce. Those are not part of this fixture's
contract.
