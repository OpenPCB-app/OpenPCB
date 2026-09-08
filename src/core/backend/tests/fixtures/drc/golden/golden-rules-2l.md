# golden-rules-2l

Fifth DRC golden board (S6, rule semantics). Built from `golden-areas-2l`'s
ordinary content — U1 SOIC-16, J1/J2 headers, R1–R8, their traces, the GND
stitching vias, two free pads and two mounting holes — with every S4 zone and
keepout stripped except the `board:B.Cu` GND plane, so nothing here is about
zone legality. It exists to pin the rule-resolution tiers, the three new codes
and the scoped-rule behaviours of
`docs/pcb-hardening/05-rule-semantics-contract.md`.

Board: 80x60 rect, 2-layer, `minimums.clearanceMm = 0.12` (the absolute floor),
board `traceToTrace` / `traceToPad` / `padToPad` 0.25, `viaToVia` 0.3,
`copperToBoardEdge` 0.5. Net classes are the three defaults plus **HV**
(clearance 0.8), assigned to `HV_RAIL` and `HV_PAD` through
`perNetClassAssignments`.

## What each rule pins

- **`bga`** — an `area` relaxation to 0.125 over
  `x in [-34.25,-33.5], y in [19.75,20.75]`, with the **two-hotspot layout**
  (contract SS4.4, Astra run 1 #1) underneath it: `t_hs_a` runs
  `(-34,20) -> (-32,20)` and `t_hs_b` runs `(-34,20.375) -> (-32,20.4375)`,
  both 0.25 mm wide. ONE segment pair. Its CLOSEST approach (the left ends,
  gap 0.125 mm) lies inside the relaxing area and is legal at the relaxed
  0.125; a second, farther approach lies outside it and is not. Resolving the
  pair once at its closest points would report the board clean. The split at
  the area ring makes the first outside sub-segment the witness: the reported
  `TRACE_TO_TRACE_CLEARANCE` is at x ~ -33.506 (just past the ring), required
  **0.25** (the board tier — the rule does not reach outside its area),
  measured **0.1404**. If this violation ever disappears, the two-hotspot trap
  is back.
- **`hv-gap`** — a `netClass`-scoped tightening (`netClass: [hv]`,
  `pairKind: [traceToTrace]`) to 0.9. `t_hv` (HV_RAIL, class HV) and `t_sig_c`
  (SIG_C, default class) run 0.85 mm apart: legal under the 0.8 class tier,
  refused by the rule -> one `TRACE_TO_TRACE_CLEARANCE`, required 0.9. This is
  the "a rule may tighten past a class" branch.
- **`back-pads`** — a `layer`-scoped rule (`B.Cu`, `padToPad`, 2.0 mm) over the
  through-hole pair `fp_p1` / `fp_p2` (1.397 mm apart). The pair is LEGAL on
  F.Cu (board 0.25) and refused on B.Cu, and SS4.3 aggregates a multi-layer pair
  into ONE violation: layer `B.Cu` (the first violated layer in stackup order),
  required 2.0.
- **`front-vias` / `back-vias`** — the severity half of SS4.3 (Astra run 1 #4).
  `v_sev_a` / `v_sev_b` sit 0.7 mm apart and violate on BOTH layers: an
  F.Cu-scoped rule at 1.0 mm carrying `severity: "warning"`, and a B.Cu-scoped
  rule at 1.2 mm carrying `severity: "error"`. The single aggregate
  `VIA_TO_VIA_CLEARANCE` reports layer `F.Cu` (first violated), required
  **1.2** (the max over violated layers) and severity **error** — a
  warning-tier rule on the front may never hide an error-tier rule on the back.
- **`tw-wide`** — a `trackWidth` scalar rule (0.3 mm) scoped to net `WIDE_1`.
  `t_tw1` (0.25 mm) fails with `TRACE_WIDTH_MIN`; `t_tw2` on `WIDE_2`, the same
  0.25 mm, passes, because the board minimum is 0.05. Scoped SCALAR rules were
  persisted-but-inert before S6 (SS12 item 1) — this is the migration.
- **`ec-strict`** — an `edgeClearance` scalar rule (1.5 mm) scoped to net
  `EDGE_1`. `t_ec1` sits 0.675 mm from the right board edge: legal under the
  board's 0.5 mm rule, refused by the rule -> `COPPER_TO_BOARD_EDGE`.
- **`bad-area`** — an `area` scope whose polygon has positive point count but
  ~zero area -> **`DRC_RULE_INVALID`** (error, non-overridable, non-waivable).
  The rule is excluded from resolution; the code exists because dropping a
  tightening rule silently is fail-open (SS2.1, SS10).
- **`ghost-net`** — a `net` scope naming a net this design does not have ->
  **`DRC_RULE_INEFFECTIVE`** (warning, reason `unknown_net`). The rule still
  resolves for whatever else matches; the author just cannot see that its
  reference is dead.
- **`under-floor`** — a clearance of 0.1 mm, below the board's 0.12 mm floor ->
  the second `DRC_RULE_INEFFECTIVE`, reason `value_clamped`. The rule is still
  EFFECTIVE (it matches first and shadows everything below it) but resolves AS
  the floor, which is exactly the case Astra run 1 #7 showed can turn a failing
  board into a passing one.
- **`h_edge`** — a 1.2 mm non-plated hole at `(39.8, 10)`, breaching the right
  edge by 0.4 mm -> **`HOLE_OFF_BOARD`** (error, dfm). Before S6 this was a
  `HOLE_TO_BOARD_EDGE` error sharing a code with the near-miss warning (SS7,
  SS12 item 3).

## The pour half (no code of its own)

`board:B.Cu` is the GND plane. `fp_hv` is an SMD pad of the **HV** class
(clearance 0.8) sitting in it at `(22,-16)`, and two rules aim at it:

- **`pour-relax`** carries an explicit `pairKind: [pourToPad]` scope (plus
  `net: [hvpad]`) at 0.3 mm — the ONLY way a scoped rule reaches a fill (SS6
  rule 1). The plane holds 0.3 mm around that pad instead of the class's 0.8.
- **`hvpad-nopour`** relaxes the same net to 0.2 mm with NO pour `pairKind`
  scope, and therefore does not touch the fill at all. It is scoped to `hvpad`
  rather than left global purely so it cannot perturb any copper–copper verdict
  elsewhere on this board.

Neither shows up as a violation code; they are here so a future change that
lets an unscoped rule leak into a pour moves this golden's
`ISOLATED_COPPER_ISLAND` / connectivity counts. The fill behaviour itself is
asserted directly in `pour-consumer-parity.test.ts` and
`rule-resolution-parity.test.ts`.

## Incidental

`UNCONNECTED_NET` (10), `TRACK_DANGLING` (32) and `VIA_DANGLING` (2) come from
the partially routed base board and the two spacing vias. They are not part of
this fixture's contract.
