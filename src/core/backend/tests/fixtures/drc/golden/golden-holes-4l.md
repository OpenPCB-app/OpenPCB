# golden-holes-4l

The S11 drilled-structure golden (manufacturability contract 10). The first
**4-layer** golden and the first one whose subject is the DRILL rather than the
copper: plating, footprint slots, drill offsets, the exact annular ring, the
NPTH fab rows and the via-type verdict. `jlcpcb_4l`, 80 x 60 mm rect outline,
`boardThicknessMm` 1.6, 91 primitives, 29 violations. Because it carries a blind
via (`v_blind`), the export ORCHESTRATOR refuses it (contract 10 §5.1, a 422) —
only `buildGerberLayer` / `buildExcellonDrill` run against it, which is what
`gerber-pad-parity.test.ts` does; never add an orchestrator-level assertion
over the golden set.

Board rules are pinned so the fixture's own hits are the ones this file is
about: `minimums` `{ traceWidthMm 0.1, drillSizeMm 0.1, annularRingMm 0.2,
viaDiameterMm 0.3, viaDrillMm 0.1, holeToHoleMm 0.25 }` and a single permissive
`default` net class, so no `TRACE_WIDTH_MIN` / `DRILL_SIZE_MIN` /
`VIA_DIAMETER_MIN` / `VIA_DRILL_MIN` / `NETCLASS_*` noise sits on top of them.
Clearances stay at the board defaults (0.25 mm pair tiers, 0.5 mm
copper-to-board-edge, which is also the copper-to-hole value).

## Export-parity items (no DRC hit; R2 #3)

- **`RT2`** (15, -24) — a **bottom-side, mirrored placement at 30°** whose four
  pads exist only so the per-layer parity harness (`gerber-pad-parity.test.ts`)
  covers what no other golden does: pad `1` an `oval` 2 x 1 at 15° (a rotated
  `ROT_O_` macro under the mirror conjugation), pad `2` a `roundrect` 2 x 1
  ratio 0.25 at 45° (`ROT_RR_`), pad `3` a `rect` 1 x 0.6 with an EXPLICIT
  `layer: "F.Cu"` that the mirror flips to B.Cu (copper, mask and paste all
  land on B.Cu), pad `4` an `oval` 2 x 1.2 with a 1.4 x 0.5 plated slot (the
  slot frame under mirror + rotation; end ring 0.3 >= 0.2, slot 0.5 >= 0.35 —
  clean). No `padNets` entries, far from every other item: zero violations.

## Deliberate hits

- **`MH1`** (-30, 20) — a **copper-less NPTH**: `plated:false`, a `circle` 3.2
  copper on `*.Cu` around a 3.2 drill, so the copper lies entirely inside the
  drilled void (§2.3). It therefore has **no copper record** — and still has a
  hole (§1.3). `t_hole` runs 0.1 mm from its wall -> **`COPPER_TO_HOLE`**
  anchored on the PAD. It raises **no `ANNULAR_RING_MIN`**: there is no ring to
  measure, which the pre-S11 `min(w, h)` outer-diameter model could not
  express.
- **`MH2`** (30, 20) — an **NPTH with a copper ring**: `plated:false`, `circle`
  4.0 around a 3.2 drill -> ring 0.400 mm < `npthAnnularRingMm` 0.45 ->
  **`FAB_ANNULAR_RING`**. The pad is **unnumbered and has no `padNets` entry**,
  so it raises **no `NPTH_PAD_NET`**.
- **`MH3`** (-30, -20) — the same ring pad, but **numbered `1` and bound to the
  `shield` net** -> **`NPTH_PAD_NET`** (§2.4) plus its own
  **`FAB_ANNULAR_RING`**. Its copper is split into one null-net item per copper
  layer, so the pin's per-pad key matches no kernel item, its component is
  synthetic and the airwire to `TP1|1` never clears -> **`UNCONNECTED_NET`**
  on `SHIELD`. Waiving `NPTH_PAD_NET` would not remove that airwire.
- **`J9`** (0, 20) — a **plated footprint slot**: `oval` 2.0 x 1.0 copper,
  `drillDiameterMm 0.5` with `drillSlotMm { widthMm 1.8, heightMm 0.5 }`. Tool
  0.5, centreline +/- 0.65 mm along the pad's local X. The ring at a slot END is
  `0.35 - 0.25 = 0.100` mm -> **`ANNULAR_RING_MIN`** + **`FAB_ANNULAR_RING`**
  (`pthAnnularRingMm` 0.15). The round model would have measured
  `(1.0 - 0.5) / 2 = 0.25` and passed both (B2-5).
- **`MS1`** (-10, 20) — a **non-plated slot 0.3 mm wide** (`circle` 0.3 copper,
  which the slot stadium contains, so no record): tool 0.3 <
  `minNpthSlotWidthMm` 1.0 -> **`FAB_DRILL`**. Before S11 every hole was
  compared with `minDrillMm` 0.15 whatever its kind or tool.
- **`PS1`** (10, 20) — a **plated slot 0.3 mm wide** (`oval` 2.0 x 1.2 copper):
  tool 0.3 < `minPlatedSlotWidthMm` **0.35** (the multi-layer JLCPCB row; the
  2-layer row is 0.5) -> **`FAB_DRILL`**. Its ring is 0.25 mm, so it raises
  nothing else — the slot width alone is the defect.
- **`OF1`** (-20, 10) — a **drill offset**: `circle` 2.0 copper, 1.0 drill,
  `drillOffsetMm { x: 0.4, y: 0 }`. The hole centre moves with the offset, so
  the ring is `(1.0 - 0.4) - 0.5 = 0.100` mm -> **`ANNULAR_RING_MIN`** +
  **`FAB_ANNULAR_RING`**. A centred model sees 0.5 mm and passes (Astra run 1
  #4: an offset must never be silently centred).
- **`RT1`** (0, 10) — the **frame case, deliberately clean**: a `rect`
  2.0 x 1.6 pad at `rotationDeg 45` on a placement at `rotationDeg 30` (world
  rotation 75 deg) with a centred 1.0 drill. Ring `0.8 - 0.5 = 0.3` mm -> no
  violation. It proves the composed frame does not perturb the measurement.
- **`v_blind`** (-10, -25) — a **valid** blind via `F.Cu -> In1.Cu` on a
  4-layer stackup (so no `VIA_LAYER_SPAN`) -> **`VIA_TYPE_UNSUPPORTED`**
  (§5.1). It gets **no `VIA_ASPECT_RATIO`**: there is no per-layer thickness
  model and no preset states a blind-via limit (§5.2, B2-7).
- **`v_aspect`** (10, -25) — a through via, 0.6 pad / **0.1 drill** ->
  `1.6 / 0.1 = 16:1` > 10 -> **`VIA_ASPECT_RATIO`**, plus **`FAB_DRILL`**
  (0.1 < `minDrillMm` 0.15).
- **`fh_small`** (-35, -25) — a 0.4 mm **NPTH free hole** ->  **`FAB_DRILL`**
  (`minNpthDrillMm` **0.5**, not the 0.15 via row).

Clean by construction, as controls: `fh_ok` (1.0 mm NPTH hole), `v_ok1..3`
(1.0 / 0.3 through vias, ring 0.35), `J1` / `J2` (10 plated 1.6 / 0.8 THT pads
each, ring 0.4), `U1` (24 SMD pads), `R1..R8`, `tp_a` / `tp_b`.

Note: `trapezoid` and `custom` pad outlines are NOT exercised here — the
importer degrades them to a rectangle at the source and S12 owns their fidelity
(contract 10 §0).

## Incidental hits

Expected of a board with unrouted copper, not part of this fixture's contract:
`TRACK_DANGLING` x 9 (every trace has free ends) and `VIA_DANGLING` x 5 (no via
lands on copper).

## S12 — DFM overlay hits on pre-existing geometry (contract 11)

Re-baselined 2026-09-11 for the S12 solder-mask check; no fixture change:

- `FAB_MASK_TO_COPPER` +1 — `MH1` is a copper-less NPTH pad: its drill relief carries no owner
  (`ownerKey` null), so it exempts no copper, and trace `t_hole` runs 0.021 mm from the relief's
  edge — below JLCPCB's 0.09 mm opening-to-trace row (contract 11 §4).

## S12b §1 — exact rounded pads: verified unchanged

The rounded-shape model (exact-geometry contract 12 §1) replaces the
circumscribed ring with the exact core ⊕ disc for every pad gap, connectivity
touch and keepout overlap. This fixture carries five arc-bearing pads — `J9`
pad 1 (oval 2 x 1), `PS1` pad 1 (oval 2 x 1.2) and `RT2` pads 1 / 2 / 4 (the
mirrored 30° export-parity part) — and **every row of this golden is
byte-identical under the change**: ids, counts, `measuredMm`, `requiredMm`,
`locationMm`, `anchors` and messages all match the pre-S12b report exactly
(verified by dumping the full report on both trees, not just the checked-in
`.expected.json`).

Why: none of the five sits in a reported pair. `RT2` is the deliberate
zero-violation export-parity part; `J9` and `PS1` are judged only on their
DRILLS (`FAB_DRILL`, `FAB_ANNULAR_RING`, `ANNULAR_RING_MIN`), which the S11
annular kernel already measured exactly (contract 10 §3) and which §1 does not
touch. The ≤ 0.2146 %·r (oval) / ≤ 0.8629 %·r (roundrect) shift 12 §1.4
predicts for this fixture therefore has no row to land on. If a future edit
gives one of these pads a clearance or connectivity neighbour, that row's
`measuredMm` is expected to GROW by at most that bound.
