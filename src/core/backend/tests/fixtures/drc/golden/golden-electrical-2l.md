# golden-electrical-2l

Tenth DRC golden board (S13 WP5, electrical contract 13 §7, §9). Its one job is
to provoke every S13 behaviour on one small board and to pin the resulting
report: the IPC-2221 conductor-spacing constituent (`CREEPAGE_DISTANCE`) in all
three conductor columns, the exposure decision that chooses between them, the
effective net of unassigned copper (B7-1) in both its spacing and its
chain-short form, and the current-versus-width verdict.

Fabricator `jlcpcb_2l`, 2-layer, 1.6 mm, outline a plain 60 × 60 rect centred on
the origin (`outline.minWebMm` deliberately absent — no `OUTLINE_MIN_WEB`
verdict), `computeRatsnest` absent (no `UNCONNECTED_NET` noise). 85 primitives,
26 violations across 7 codes, all ids unique — clear of the golden suite's ≥ 80
primitive and ≥ 10 violation non-triviality gates.

## Declarations

```
electrical: { tempRiseC: 10, copperWeightOz: 1, innerCopperWeightOz: 0.5,
              outerConductors: "coated" }
```

`innerCopperWeightOz` is unused on a 2-layer board and is carried only so the
key survives the fixture round trip. **`outerConductors: "coated"` is the pivot
of this fixture**: it makes the B4 column *available*, so every pair's column is
then decided by EXPOSURE (13 §1.2) — an item whose copper any solder-mask
opening reaches is an uncoated conductor and is judged in B2 whatever the board
setting says. Pads carry their own openings and are therefore always exposed;
a trace with no opening near it is covered and gets B4. Regions F and G below
are the same 48 V pair at the same 0.5 mm gap and differ ONLY in that.

Net classes (first entry is the fallback class, so every unassigned net is
UNDECLARED and assumed at the board reference potential, 13 §2):

| class | declaration | IPC-2221B values used here |
|---|---|---|
| `default` | — | — |
| `hv` | `voltageV: 230` | Δ 230 ⇒ B2 1.25, B4 0.40 |
| `hvn` | `voltageV: -230` | vs `hv`: Δ 460 ⇒ B2 2.50 |
| `sw` | `voltageMinV: 0`, `voltageMaxV: 400` | vs `hvn`: Δ 630 ⇒ B2 2.5 + 0.005·130 = 3.15 |
| `lv48` | `voltageV: 48` | Δ 48 ⇒ B2 0.60, B4 0.13 |
| `khv` | `voltageV: 600` | Δ 600 ⇒ B2 2.5 + 0.005·100 = 3.00 |
| `hc` | `currentA: 3` | 3 A / 10 °C / 1 oz outer ⇒ 1.367 mm |

The two `> 500 V` rows are the **"500 V value plus the per-volt slope times the
excess"** reading of Table 6-1 (13 §6.2), not `slope × V`. B2 cannot tell the two
apart numerically (2.5 + 0.005·(V − 500) ≡ 0.005·V); they are here because the
rule is what the transcription states and both rows have to be exercised
somewhere.

## Regions, by row (all `F.Cu` unless noted)

Rows are ≥ 6 mm apart in y and regions ≥ 8 mm apart in x — comfortably beyond
the widest halo this board can demand (the widest pair is `khv` 600 V against
`hvn` −230 V, Δ 830 ⇒ B2 4.15 mm), so no region can reach into another.

- **A — covered 230 V vs 0 V at 0.3 mm (y = −26 / −25.5, x −26…−18).**
  `t_a_hv` (net `HV1`, class `hv`) and `t_a_ref` (net `GND1`, undeclared),
  both 0.2 mm wide, 0.5 mm centre-to-centre ⇒ 0.3 mm copper gap.
  Neither trace is reached by a mask opening, so the pair is judged in **B4**
  (0.40 mm). The ordinary 0.25 mm trace-to-trace rule PASSES at 0.3 mm →
  **`CREEPAGE_DISTANCE` only** — the constituent-independence claim of 13 §3.3
  in its simplest form.
- **B — the same pair at 0.1 mm (y = −26 / −25.7, x −6…2).** `t_b_hv` (`HV2`,
  `hv`) and `t_b_ref` (`GND2`), 0.3 mm centre-to-centre ⇒ 0.1 mm gap. Below both
  requirements, so it reports **two rows**: `TRACE_TO_TRACE_CLEARANCE`
  (required 0.25) and `CREEPAGE_DISTANCE` (required 0.40, B4). A waiver of
  either never hides the other (13 §3.3). No `FAB_CLEARANCE`: jlcpcb_2l's floor
  is exactly 0.1 mm and `clearanceViolated` is strict.
- **C — `hv` vs `hvn`, exposed, 2 mm (y = −19, x −25…−21).** Free pads
  `fp_c_hv` (`HV3`) and `fp_c_hvn` (`HVN1`), 1 × 1 mm, 3 mm apart ⇒ 2 mm gap.
  Both carry mask openings ⇒ **B2**. Δ = |230 − (−230)| = 460 V ⇒ 2.50 mm →
  **`CREEPAGE_DISTANCE`**. Ordinary pad-to-pad (0.25) passes. This is the pair
  that fails Astra run 0's signed-peak model, which called two opposed rails
  Δ = 0.
- **D — an INTERVAL against a constant, 3 mm (y = −19, x −7…−2).** `fp_d_sw`
  (`SW1`, class `sw`, interval [0, 400]) and `fp_d_hvn` (`HVN2`, −230 V), 4 mm
  apart ⇒ 3 mm gap. Δ = max(|0 − (−230)|, |400 − (−230)|) = **630 V** ⇒ B2
  3.15 mm → **`CREEPAGE_DISTANCE`**. The interval formula of 13 §2, and the
  first of the two `> 500 V` rows.
- **E — 600 V on the BACK face, 2.9 mm (y = −19, x 7…12, `B.Cu`).**
  `fp_e_khv` (`KHV1`, 600 V) and `fp_e_ref` (`GND3`), both `B.Cu` free pads,
  3.9 mm apart ⇒ 2.9 mm gap. B2 at 600 V = 2.5 + 0.005·100 = **3.00 mm**, so
  2.9 fails and 3.0 would have passed — the row is deliberately 0.1 mm inside
  the requirement. Also the only pair of this fixture on the bottom face, which
  pins that exposure is decided per FACE.
- **F — 48 V EXPOSED at 0.5 mm (y = −12, x −25…−22.5).** `fp_f_lv` (`LV1`,
  class `lv48`) and `fp_f_ref` (`GND4`), 1.5 mm apart ⇒ 0.5 mm gap. Pads ⇒
  exposed ⇒ **B2 0.60 mm** → **`CREEPAGE_DISTANCE`**. Ordinary pad-to-pad
  (0.25) and the fab floor (0.1) both pass; the mask openings are 0.35 mm
  apart, over jlcpcb_2l's 0.1 mm dam, so there is no `FAB_MASK_BRIDGE`.
- **G — the SAME 48 V pair, COVERED, at the same 0.5 mm (y = −12 / −11.3,
  x −6…0).** `t_g_lv` (`LV2`, `lv48`) and `t_g_ref` (`GND5`), 0.7 mm
  centre-to-centre ⇒ 0.5 mm gap. No opening reaches either trace ⇒ **B4
  0.13 mm** → **no violation at all**. F and G are the fixture's exposure
  control pair: identical voltage, identical gap, opposite verdict, and the
  only thing that differs is whether the solder mask covers the copper.
- **H — two pads of ONE footprint, 0.5 mm apart (y = −5, x −25…−23).**
  Placement `P_HV`, pads `1` (`HV4`, class `hv`) and `2` (`GND6`), 1.5 mm apart
  ⇒ 0.5 mm gap. Intra-footprint pairs skip the ordinary and fab constituents
  (the library owns geometric spacing inside a footprint) but **not** the
  voltage one (13 §3.3) → **`CREEPAGE_DISTANCE` only**, B2 1.25 mm (both pads
  exposed). No `PAD_TO_PAD_CLEARANCE` row, which is the point.
- **I — a TENTED via exposed by a neighbour's opening (y = −5, x −6…−3).**
  `fp_i_hv` (`HV5`, `hv`) at x = −6; via `v_i` (`GND7`, tented, ⌀0.8 / drill
  0.4) at x = −4.4; free pad `fp_i_open` (`GND7`, the via's OWN net, so it
  forms no pair with it) at x = −3.45. The via contributes no opening of its
  own, but `fp_i_open`'s opening (1 mm pad + 0.075 mm expansion per side)
  reaches x = −4.025 while the via's copper ends at x = −4.0, so the opening
  overlaps the via copper: the via is **exposed** (13 §1.2, Astra run 1 #4).
  The `fp_i_hv` / `v_i` pair is therefore judged in **B2 1.25 mm** against a
  0.7 mm gap → **`CREEPAGE_DISTANCE`**. In B4 (0.40 mm) it would have passed,
  which is exactly the false pass the per-item exposure rule exists to close.
  The same overlap is independently reported as **`FAB_MASK_TO_COPPER`**
  (`fp_i_open`'s opening exposes a via that is not its own; jlcpcb_2l keeps
  0.09 mm) — the DFM twin of the exposure fact, useful here as corroboration
  that the opening really does reach the barrel. `fp_i_hv` vs `fp_i_open` is
  1.55 mm apart, clear of the 1.25 requirement, so that pair reports nothing.
- **J — a null trace INHERITING a 230 V tier (y = 2, x −26…−14).** `t_j_hv`
  (`HV6`, `hv`) runs x −26…−20; `t_j_null` (**no net**) continues x −20…−14 and
  touches it; `t_j_ref` (`GND8`) runs x −19…−14 at y = 2.5, i.e. 0.3 mm from
  `t_j_null`. `t_j_null`'s own net is null — undeclared — and `GND8` is
  undeclared too, so WITHOUT the effective net the pair carries no voltage
  constituent at all and the board would report nothing. With it (13 §4.1,
  §4.2) `t_j_null` is judged as `HV6` → **`CREEPAGE_DISTANCE`** at B4 0.40 mm
  against the 0.3 mm gap, anchored on `t_j_null` / `t_j_ref` (anchors keep the
  ORIGINAL items; only the requirement moves). The ordinary rule stays 0.25 mm
  — class `hv` declares the same clearance as `default` — so it passes at 0.3
  and there is no second row. `t_j_ref` starts at x = −19, 1 mm clear of
  `t_j_hv`'s end cap, so `t_j_hv` itself forms no violating pair.
- **K — a CHAIN short, A–X–Y–B (y = 9, x −26…−10).** `t_k_a` (`CHAIN_A`),
  `t_k_x` (null), `t_k_y` (null), `t_k_b` (`CHAIN_B`), each 4 mm and joined end
  to end. No null member touches two named nets DIRECTLY, so the pre-S13
  direct-bridge emitter produces nothing; the component carries two labels, so
  13 §4.3's component-wide draft fires: one **`NET_SHORT_CIRCUIT`** anchored on
  `t_k_x` and `t_k_y` (the null members, in anchor-key order) plus one net
  anchor per label (`chain_a`, `chain_b`, in net-id order), located at the
  smallest member marker (−20, 9), `measuredMm` 0, `requiredMm` 0.25 (the
  largest ordinary requirement among the component's cross-net pairs). This is
  the S7 "chains" limit (06 §9) closed.
- **L — current versus width (y = 16, x −26…−18).** `t_l_hc` (`HC1`, class
  `hc`, 3 A) at the 0.2 mm default width. IPC-2221 external conductor at 3 A /
  10 °C rise / 1 oz ⇒ 1.367 mm → **`TRACE_CURRENT_WIDTH`** (warning). The only
  non-spacing electrical verdict of the fixture.
- **M — a 230 V zone pouring around a 0 V pad (zone x −10…2, y 12…17).**
  Zone `z_m_hv` on `F.Cu`, net `HV7` (class `hv`), priority 0; free pads
  `fp_m_hv` (`HV7`, same net — the pour attaches to it, so the island is not
  dead copper) and `fp_m_ref` (`GND9`, 0 V) inside it. **No violation** — and an
  absent row is ALL this golden pins here. The pour CARVES `fp_m_ref` at the
  IPC-2221 spacing (conservative exposure outside the DRC context ⇒ B2 1.25 mm,
  13 §3.2) instead of the 0.5 mm pour tier, so the filled copper already
  satisfies the requirement the judge would apply and there is nothing to
  report. The behaviour IS the carve distance, which no violation count can
  show, so it is measured instead in `drc-electrical-consumers.test.ts`
  (`"a 230 V zone carves a 0 V trace at the IPC spacing, not the pour tier"`),
  whose control run on the same geometry with the voltages stripped measures
  0.5 mm.
- **Padding (y = 25, x −26…22).** Seven SOIC-8 placements `U_P1…U_P7`, 8 pads
  each, all nets null. They exist only to carry the fixture past the ≥ 80
  primitive gate. Null against null declares nothing on either side, so no pair
  among them carries a voltage constituent; their pitch (1.27 mm, 1.2 × 0.5 mm
  pads) clears both the 0.25 mm pad-to-pad rule and the 0.1 mm mask dam, and
  they contribute no code.

## Every violation, by code

| code | n | where |
|---|---|---|
| `CREEPAGE_DISTANCE` | 9 | A, B, C, D, E, F, H, I, J — one each (region G is the deliberate PASS) |
| `TRACE_TO_TRACE_CLEARANCE` | 1 | B, the 0.1 mm pair's ordinary constituent |
| `TRACE_CURRENT_WIDTH` | 1 | L |
| `NET_SHORT_CIRCUIT` | 1 | K, the component-wide chain draft |
| `FAB_MASK_TO_COPPER` | 1 | I, `fp_i_open`'s opening over via `v_i` — the DFM twin of that region's exposure fact |
| `TRACK_DANGLING` | 12 | one per trace whose start or end cap touches nothing: `t_a_hv`, `t_a_ref`, `t_b_hv`, `t_b_ref`, `t_g_lv`, `t_g_ref`, `t_j_hv`, `t_j_null`, `t_j_ref`, `t_k_a`, `t_k_b`, `t_l_hc`. Three reasons, not one. In **A, B, G and J** — the four B4 verdicts — the pair is two standalone copper runs with no pad or via on either net because adding one would put a mask opening on the trace and move its column from B4 to B2: there the antennae are the price of the covered-conductor cases. **K**'s `t_k_a` / `t_k_b` are the chain's two named terminals, bare at their far ends because a pad there would add pairs and an opening to a region whose subject is the component-wide short, not spacing (`t_k_x` / `t_k_y` are joined at both ends and do not appear). **L**'s `t_l_hc` carries a per-item WIDTH verdict — no column, no pair, no neighbour needed — so copper attached to it would only add unrelated rows. |
| `VIA_DANGLING` | 1 | `v_i`, which reaches copper on no layer (`fp_i_open` stops 0.05 mm short of its barrel, deliberately — a touch would have made them one item and removed the pair) |

Summary: **11 errors / 15 warnings / 26 violations**.

## What this fixture does NOT cover

- Inner-layer spacing (column B1) — this is a 2-layer board and `In*.Cu` has no
  mask face. B1 is pinned by the unit tests (13 §9), not here.
- A malformed electrical declaration (`DRC_RULE_INVALID` from the electrical
  block): every value here is valid, deliberately, so that the fixture measures
  verdicts rather than the fail-closed path.
- The pour and route-obstacle carve DISTANCES (13 §3.2): a report cannot show
  them. They are measured in `drc-electrical-consumers.test.ts`, each against a
  control run that differs only in the declaration.
