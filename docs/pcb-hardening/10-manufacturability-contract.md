# 10 — Manufacturability contract: holes, pads and vias (S11)

Status: **binding for the S11 implementation** (2026-09-10; Astra spec-attack run 1 folded —
§12). Program: `PROGRAM.md`; consumers: the batch DRC contract (06), the connectivity contract
(01 §2), the copper-pour contract (04 §5), the rule-semantics contract (05 §5.1), the live-parity
contract (07 §6).

## 0. Scope

One model of every **drilled structure** on the board — where it is, what tool cuts it (a round
hit or a routed slot), whether its wall is plated, and what copper surrounds it — shared by batch
DRC, the live gate, route obstacles, connectivity, the copper fill, the Gerber and Excellon
writers, the job file and the cloud snapshot. The **annular ring** is the exact minimum copper
width around the drill wall. **Via manufacturability** claims exactly what OpenPCB can export and
a sourced fabricator capability supports, and nothing more.

Owned findings: B2-5 (slots judged as round holes in the manufacturability check; footprint pads
carried no slot), B2-6 (annular ring from a bounding box), B2-7 (blind-via aspect model), B6-1
(the Gerber flashed a non-orthogonally rotated pad un-rotated; an unequal `circle` had two
interpretations).

Out of scope, with the owning session: trapezoid / custom pad outlines (the importer degrades
them to a rectangle with a warning at the source, so every consumer — DRC, connectivity, the
pour, the artwork — sees the same rectangle; S12 owns fidelity; polygon pads are therefore not an
export input in S11), 6+-layer Gerber inner layers (pre-existing export limit, filed), slot
authoring UI and `drillSlot` command parsing (TODO), canvas / 3D rendering of slots and non-plated
pads (UI backlog), a per-layer thickness / depth model and per-span drill files (S15 / export
backlog), scoped `drillSize` / `copperToHole` / pad-`annularRing` rules (05 §13), PCBWay HDI
presets, the library editor's "plated" toggle (UI backlog).

Coordinate domain: every number in this contract is **millimetres** (the DRC item domain);
persisted geometry is integer nanometres and enters through the same conversion every other
contract uses. Tolerances: `GEOM_EPS_MM = 5e-7` (0.5 nm), `DRC_EPS_MM = 1e-6` (1 nm); minimums
use `below(v, limit) = v < limit − 1e-6`. Every drill diameter — persisted, imported, in a fab
row, in the Excellon tool table and in the aspect denominator — is the **finished hole
diameter**; plating compensation is the fabricator's (the fetched capability rows state finished
sizes and tolerances; Astra run 1 #16).

## 1. The drilled-structure model

### 1.1 One derivation per drilled object

| Object | Derivation (the ONLY one) | Position | Tool | Plated |
|---|---|---|---|---|
| via | `via.drillMm` | `centerMm` | round, `drillMm` | yes |
| footprint pad | **`footprintPadDrill(pad, placement)`** (new, `pcb-drills.ts`) | pad centre **plus the drill offset** (`drillOffsetMm`, pad-local, transformed like the copper), through the placement transform | round `drillDiameterMm`, or the slot of `drillSlotMm` | `plated ?? true` |
| free pad | `freePadDrill(pad)` (unchanged) | `centerMm` | round `drillMm`, or the slot of `drillSlot` | `padType === "std"` |
| free hole | **`freeHoleDrill(hole)`** (new, `pcb-drills.ts`) | `centerMm` | the slot width whenever a slot is declared (a degenerate slot is a round hit of that width), else `drillMm` | no |

`footprintPadDrill` returns `null` when the pad has no positive drill, else
`{ centerMm, drillMm, slot?, plated }` with `drillMm` = the tool diameter = the narrow axis of a
slot. Every consumer listed in §8 reads this function; none reads `drillDiameterMm`,
`drillSlotMm`, `drillOffsetMm` or `plated` directly. The fields are read through one narrowing
helper, `padDrillFields(pad)`, which tolerates a render-source pad that predates the attributes
(the pinned packages) — see §2.1. A KiCad drill offset is never silently centred (Astra run 1
#4): the importer carries it and this derivation applies it.

### 1.2 The slot frame

A footprint slot `drillSlotMm = { widthMm: W, heightMm: H }` is KiCad's `(drill oval W H)`: `W`
along the pad's local X, `H` along its local Y. The tool diameter is `min(W, H)` **whenever a slot
is declared**; the long axis is X when `W > H`, else Y; `max(W, H) ≤ min(W, H)` degenerates to a
round hole OF THAT TOOL — the centreline vanishes, the tool does not, and `drillDiameterMm` never
replaces it (Astra run 2b #2). The same rule governs free holes and free pads: a declared slot's
width is the tool, degenerate or not (Astra run 2b #1). The centreline runs
from `c − d` to `c + d` with `|d| = (max − min) / 2` along the long axis, expressed in the pad's
**world frame**: the pad's own rotation composed with the placement's rotation and mirror exactly
as the copper record does — X reflection first on a mirrored placement, then the rotation
`rotationDeg = placement.rotationDeg ± pad.rotationDeg` with the sign conjugated when mirrored
(`copper-records.ts` `footprintPadRecords`; `R_θ M R_φ = R_{θ−φ} M`). A slotted pad on a
mirrored placement therefore has its slot mirrored together with its copper (the endpoint order
may swap; the geometry does not); a 45° pad on a 30° placement has a 75° slot (−15° when
mirrored). The drill offset is transformed by the same composition before the centreline is
built. The Excellon `G85` endpoints and `DrcHole.slot` are this centreline.

Free-pad slots keep today's `drillSlot { lengthMm, widthMm, angleDeg }` (absolute angle, world
frame); `freePadDrill` reports the SLOT WIDTH as `drillMm` (the tool) whatever the row's `drillMm`
says, and the store hydrator makes the two equal (the SDK has always said they are one value —
06 §9 reconciled; S11 R1 #3).

### 1.3 `DrcHole`

```ts
interface DrcHole {
  anchor: DrcAnchor;
  kind: "via" | "pth" | "npth";     // plated wall ⇔ via | pth
  netId: string | null;             // the copper's net; null for npth (§2.4)
  center: PcbPointMm;
  drillMm: number;                  // tool diameter (slot width for a slot)
  slot?: { a: PcbPointMm; b: PcbPointMm; widthMm: number };
  annularRingMm?: number;           // §3 — set when the hole has copper around it (pth, and
                                    // npth with a ring); undefined for vias (own ring) and
                                    // copper-less holes
}
```

`padOdMm` no longer exists. **Holes are derived from the drilled objects, never from the copper
records**: `itemsFromRecords` receives the placements and walks `placementPads` with
`footprintPadDrill`, exactly as it walks `freePads` with `freePadDrill`. Consequences that the
previous model violated: a drilled pad yields exactly one hole whether it has copper or not; a
copper-less non-plated pad (§2.3) is still a hole for `DRILL_SIZE_MIN`, `HOLE_TO_HOLE`,
`HOLE_TO_BOARD_EDGE`, `HOLE_OFF_BOARD`, `COPPER_TO_HOLE` and the route obstacles; a pad with
several copper shapes (occurrences) has one hole per drilled shape.

Hole order in `ctx.holes` is placements × preview pads, then free pads, then free holes, then
vias — the order the report's canonical sort (06 §6) never depends on. Two same-numbered pads of
one placement share the violation-id anchor; when both violate the same per-item code the
report keeps the total-order survivor of 06 §6 (most severe, largest deficit, then the smaller
marker) — one row, deterministic under input reversal (Astra run 1 #13, rejected as
non-determinism; the collapse is the existing same-id rule).

## 2. Plating

### 2.1 The attributes

`FootprintRenderSourcePad` (in `@openpcb/rendering-core`) gains three optional fields:
`plated?: boolean` — **absent means plated**, every pad that exists today keeps its meaning, and
the attribute is meaningless without a drill: `padDrillFields` reads an UNDRILLED pad as plated
whatever the field says, so plain copper never loses its net (S11 R1 #4);
`drillSlotMm?` (moved down from kicad-import's extension type so DRC, export and rendering read
one declaration); `drillOffsetMm?` (pad-local). The KiCad importer sets
`plated = false` only for `np_thru_hole` (never `true`), the slot from `(drill oval W H)`, the
offset from `(drill … (offset X Y))` when non-zero. The app reads all three through
`padDrillFields(pad)`, so it typechecks and behaves identically against the pinned packages
(fields absent) and the linked checkout.

### 2.2 Legacy rows

The library row stores the whole import JSON, including `raw.pads[i].type`, and the preview pad
id is `` `${number || "?"}:${rawIndex}` `` (the raw index is assigned before paste-only sub-pads
are filtered, so it is NOT the preview array position). `parseFootprintPlacementSnapshot` applies
`withLegacyPlating(preview, rawPads)`: for a preview pad without `plated`, take the **last**
`:`-separated segment of its id as the raw index, and apply `plated = false` **only if the raw
pad at that index is `np_thru_hole` AND matches the preview pad's identity** — same trimmed
number, same drill diameter (|Δ| ≤ 1e-9) and same local position (|Δ| ≤ 1e-9 per axis). Any
mismatch, an unparsable id, a missing `raw` (editor-authored footprints) or a missing pad leaves
the attribute absent (plated) — the raw list is never assumed immutable (Astra run 1 #15). The
derivation is read-time and pure; no migration, no re-pack: existing installs and the current
CoreLibrary pack are corrected at once (the M3 mounting hole: 3.2 × 3.2 copper-less NPTH).

### 2.3 Copper of an unplated pad

- **Copper-less** ⇔ the pad's copper shape lies entirely inside the drill (the disc, or the slot
  stadium): the farthest point of the copper outline from the drill centre (round) or from the
  slot centreline (slot) is ≤ the tool radius + `GEOM_EPS_MM`. Evaluated per shape on the exact
  outline (circle: `|c_p − c_d| + w/2`; rect: the four corners; oval: both cap centres + the cap
  radius; roundrect: the four corner-circle centres + `r`), with an upper-bound distance for the
  slot case — an uncertain case keeps the copper (fail-safe). A bounding-box comparison is NOT
  a containment test (a `1 × 1` square survives a `⌀1` drill at its corners — Astra run 1 #3).
  A copper-less pad has **no copper record**: no flash, no net, no ratsnest endpoint; mask relief
  on both faces (§6.4); no paste; the hole exists by §1.3.
- **A copper ring** (77 of 15 435 corpus footprints): one copper record on the pad's declared
  copper layers, `kind: "npth"` hole, `annularRingMm` from §3, Gerber aperture function
  `WasherPad` (§6.4), the NPTH file in Excellon. Its net is null (§2.4).

### 2.4 Unplated copper carries no net, and never conducts between faces

An unplated pad's copper rings are mechanical. The copper **record** keeps whatever net
`padNets` binds to the pad (usually none — KiCad's `np_thru_hole` pads are unnumbered), so DRC
clearance sees the ring as that net's copper on its layers; but when the copper spans **two or
more layers** the connectivity kernel builds **one item per copper layer** for such a record,
each with a **null net** (key: the pad item key extended by the layer; the DRC pad item and the
violation-id anchor stay per pad). The split exists only to deny conduction BETWEEN faces:
unplated copper on exactly one layer (a drilled `smd` / `conn` free pad — a test point with a
probe hole) has no barrel to fake and keeps its net and its one item (Astra run 2). A ring may still be an unassigned extension of copper it touches on ITS layer (01 §2), but
two rings on different faces are never one node — a front trace and a back trace touching the
two rings of one hole are not connected (Astra run 1 #2: the previous "recorded limit" would
have hidden an open through the logical-pin union of `ratsnest.ts`).

A net assigned to copper that cannot carry it is a design error the report must not hide, in
two shapes: (a) an unplated pad whose ring spans two or more layers — the pin stays a ratsnest
endpoint (the record carries the net) whose per-pad item key matches no kernel item, so its
component is synthetic and the airwire — `UNCONNECTED_NET` — never clears; (b) an unplated pad
with **no copper at all** (a numbered copper-less `np_thru_hole` pad, or a `hole` free pad, bound
to a net) — it owns no record, so it is not even a ratsnest endpoint and the open would be
SILENT (Astra run 2). In both shapes the structural check emits `NPTH_PAD_NET` (new; class
structural, severity error, overridable — waiving it does not remove an airwire) on the pad:
"Net "N" is assigned to a non-plated pad … — use a plated pad". Unplated copper on exactly one
layer needs no report. No copper is manufactured differently by this rule.

## 3. The annular ring

### 3.1 Definition

For a hole with copper (a `pth`, or an `npth` with a ring):

> `annularRingMm = min over p ∈ drill centreline of sdf_pad(p) − r_tool`

where the centreline is the single point `center` for a round hit or the segment `slot.a → slot.b`
for a slot, `r_tool = drillMm / 2`, and `sdf_pad` is the **signed** distance to the pad's copper
boundary in the pad's world frame — **positive inside the copper, negative outside**, for every
shape (Astra run 1 #1: one convention, stated per formula in §3.2).

Exactness for a positive result: when the drill lies inside the copper, the distance field is
1-Lipschitz and from any centreline point the straight descent toward its nearest boundary point
stays inside the copper for the whole length `sdf(p)`; hence the minimum copper width measured
from the drill wall (the set of points at distance `r_tool` from the centreline) equals
`min sdf − r_tool` — for concave outlines too. A **negative** result is a breakout indicator and
a conservative margin (a lower bound of the wall deficit), not an exact wall measurement (Astra
run 1 #6); S11 reports it as such. All S11 shapes are convex: the signed distance to a convex set
is concave, so the minimum over the slot segment is attained at an endpoint —
`min(sdf(a), sdf(b)) − r_tool`, O(1) per hole.

### 3.2 Per-shape signed distance (analytic, never the circumscribed sampler)

`p` is mapped into the pad's local frame by the exact inverse of the record's transform (subtract
the centre, un-rotate by `−rotationDeg`, un-mirror X). `hw = w/2`, `hh = h/2`. Positive inside:

| Shape | `sdf_pad(p)` |
|---|---|
| `circle` | `hw − |p|` (a circle pad is a disc of `widthMm`, §7) |
| `rect` (also `trapezoid` / `custom`, which are rectangles in every consumer) | `q = (|p.x| − hw, |p.y| − hh)`; inside (`q.x ≤ 0 ∧ q.y ≤ 0`): `−max(q.x, q.y)`; outside: `−‖max(q, 0)‖` |
| `oval` | `min(hw, hh) − dist(p, S)` where `S` is the centre segment of length `|w − h|` along the long axis |
| `roundrect` | `r = min(ratio · min(w, h), hw, hh)`; `r < 1e-6` ⇒ the `rect` formula (the SAME clamp the ring builder `roundRectRing` applies; the Gerber writer adopts it in S11 through `apertures.ts` `roundrectRadiusMm` — before S11 it used `ratio · min(w, h)` unclamped, so a ratio above 0.5 exported a different shape); else `sdf_core(p) + r` with `sdf_core` the `rect` formula of the `(w − 2r, h − 2r)` core |

The pad ring `padOutlineWorldMm` (circumscribed arcs, ≤ 0.2 %·r outside the true copper) is
NOT used: it over-estimates copper, which over-estimates the ring — a false-pass bias in the
manufacturability direction.

### 3.3 Verdicts

- **Breakout is judged before the configurable minimum**: `annularRingMm ≤ GEOM_EPS_MM` (the
  wall touches or leaves the copper) is `ANNULAR_RING_MIN` with `measuredMm = ring` and the
  message "Drill breaks out of the pad copper", whatever `minimums.annularRingMm` says — a
  minimum of 0 and `below()`'s 1 nm grace cannot legalise missing copper (Astra run 1 #5).
- Otherwise `ANNULAR_RING_MIN` (error) when `below(annularRingMm, minimums.annularRingMm)`. A
  non-finite ring (a NaN pad dimension) is bad data, not a breakout: no verdict (R1 #5).
- `FAB_ANNULAR_RING` (warning): `pth` against `pthAnnularRingMm`; `npth` with a ring against
  `npthAnnularRingMm` when the preset states one (§4); vias against `minAnnularRingMm` as today.
- Vias keep `(diameterMm − drillMm) / 2` (concentric by construction).
- One value per pad: the pad has one copper shape on every layer it occupies, and a mirrored
  placement mirrors the drill (offset and slot) and the copper together. It is computed once in
  `itemsFromRecords` and carried on the hole.

## 4. Drill minimums and the fabricator table

`DRILL_SIZE_MIN` (error) compares the **tool diameter** (`drillMm`, the slot width for a slot)
with `minimums.drillSizeMm` for every hole kind.

Fab tier (warnings), by hole kind and tool:

| Hole | Round | Slot |
|---|---|---|
| via | `minDrillMm` | — |
| pth (plated) | `minDrillMm` | `minPlatedSlotWidthMm` |
| npth | `minNpthDrillMm` | `minNpthSlotWidthMm` |

Preset values (every number from the fabricator's own page; fetch date 2026-09-10; the page is the
resolution rule of last resort — `OPEN_FINDINGS.md` §5.7; all diameters are finished hole
sizes):

| Field | JLCPCB 2L | JLCPCB 4L | PCBWay std | PCBWay adv | Source |
|---|---|---|---|---|---|
| `minDrillMm` (via / PTH) | 0.15 | 0.15 | 0.2 | 0.15 | unchanged (jlcpcb.com/capabilities/pcb-capabilities: "0.15mm hole size"; pcbway.com/capabilities.html: via hole "0.15-6.0mm") |
| `minNpthDrillMm` | 0.5 | 0.5 | 0.2 | 0.15 | JLCPCB "Minimum NPTH Hole Size: 0.50mm"; PCBWay NPTH "0.15-6.0mm" (std keeps its 0.2 mechanical floor) |
| `minPlatedSlotWidthMm` | 0.5 | 0.35 | 0.5 | 0.5 | JLCPCB "Minimum Plated Slot Width 2-layer 0.5mm / Multi-layer 0.35mm"; PCBWay "Plated slots ≥0.5mm" |
| `minNpthSlotWidthMm` | 1.0 | 1.0 | 1.0 | 0.8 | JLCPCB "Minimum Non-Plated Slot Width 1.0mm"; PCBWay "Non-plated slots ≥0.8mm" (= today's `minSlotWidthMm`, which the milling advisory keeps) |
| `pthAnnularRingMm` | 0.18 | 0.15 | 0.15 | 0.15 | unchanged (JLCPCB "absolute minimum 0.18 mm" 2L / "0.15 mm" multilayer; PCBWay "0.15mm(6mil)") |
| `npthAnnularRingMm` | 0.45 | 0.45 | — | — | JLCPCB "NPTH Pad Annular Ring ≧0.45mm"; PCBWay not stated → absent → no check |
| `maxAspectRatio` (through) | 10 | 10 | 8 | 10 | JLCPCB blog "Do not exceed 10:1 when plating through-holes" (Aspect Ratio = Board Thickness / Drilled Hole Diameter); PCBWay "Thickness to diameter ratio ≤8" standard, "8" and "10" medium / high difficulty |
| `viaTypes` | {through} | {through} | {through} | {through} | JLCPCB "Not supported. Currently we don't support Blind/Buried Vias, only make through holes."; PCBWay lists blind / buried only under separately quoted HDI rows (§5.3) |

`minDrillMm`'s doc no longer claims NPTH. `custom` stays the opt-out for the FAB tier; §5.1
applies to every fabricator.

## 5. Via type, span and aspect

### 5.1 Only through vias can be manufactured from an OpenPCB export

Excellon export writes one plated drill file, `TF.FileFunction,Plated,1,<last>,PTH` — every plated
hit is a through drill. A blind, buried or micro via therefore has no manufacturable
representation today (per-span drill files are export backlog, §0). Consequently:

- `VIA_TYPE_UNSUPPORTED` (new; class manufacturability, default severity **error**, overridable,
  emitted by `manufacturability` only, label "Via type cannot be manufactured") fires for every
  via with `viaType !== "through"` **on every fabricator, `custom` included** — the message says
  "not supported by OpenPCB's drill export (through drills only)" and, on a preset fab, appends
  "<name> offers through-hole vias only". Emitted **only** when the span is valid for its type
  (`!layerSpanInvalid && !viaTypeInvalid`) — one code per defect; an invalid span keeps
  `VIA_LAYER_SPAN` (non-overridable) and gets nothing else.
- The manufacturing export **refuses** a board with a non-through via: a 422 problem
  `https://openpcb.dev/problems/export-unsupported-via-type` listing the via ids (the precedent is
  the failed-fill refusal of 04 §9). A silently emitted through drill for a blind via was the
  blocker of Astra run 1 #7.

### 5.2 Aspect ratio

`VIA_ASPECT_RATIO` is computed **only for `through` vias**: `boardThicknessMm / drillMm` against
`maxAspectRatio`. A blind, buried or micro via gets **no aspect verdict**: there is no per-layer
thickness model, and no preset states a limit for them (the 1:1–2:1 blind and 0.75:1 microvia
figures in the fabricator's blog are design guidelines, not capabilities). The former linear
scaling (`(span − 1) / (layers − 1)` × thickness against the through-hole limit) is deleted,
together with the unused `viaSpanDepthFraction`.

Nothing else validates a via type against the fab: the cloud snapshot warns generically about
non-through vias, the insert gate is the `pcb.advancedVias` flag, `constraints.ts` judges span
validity only, no net-class check reads `viaType`. No consumer can disagree with §5.1.

### 5.3 Board import

`(via blind …)` and `(via micro …)` carry the type as a bare atom after `via`; the parser reads
that atom (the previous `findNode` looked for a sub-list and never matched). The KiCad board
format has only these two tokens; a buried via is written as `blind` — the imported `viaType` is
`blind` when the span touches exactly one outer layer, `buried` when it touches none, `micro`
for the `micro` atom, `through` otherwise. The implementer cites the KiCad file-format reference
in the parser and tests on a real snippet.

### 5.4 Job file

`.gbrjob` `GeneralSpecs.BoardThickness` = `boardThicknessMm ?? DEFAULT_BOARD_THICKNESS_MM` — the
same thickness the aspect check uses.

## 6. Export parity

### 6.1 Copper, mask and paste flash from the copper records — and mask relief from the drills

The Gerber copper, mask and paste pad loops consume the S1 pad records (`buildCopperRecords`,
built once per export and threaded through the writer context — the pour already builds them),
not `preview.pads`. A record carries the frame DRC judges: the world centre, the composed
rotation, the mirror, the resolved copper layers (including the explicit-layer side flip a
mirrored SMD placement gets, which the mask loop used to miss) and the net through `padNets`.
Free pads are flashed from their records the same way. Mask relief for a **copper-less** unplated
pad (§2.3, no record) comes from the drilled objects (`footprintPadDrill`), not from a record
(Astra run 1 #8).

### 6.2 Apertures and inflation

- A frame whose composed rotation is a multiple of 90° keeps today's standard apertures (`C`,
  `R`, `O`, the roundrect macro) with the orthogonal width / height swap.
- Any other rotation emits a **rotated aperture macro** (one per `(shape, w, h, r, angle)` tuple,
  deterministic name): `rect` → primitive 21 (centre line: width, height, 0, 0, rotation);
  `oval` → primitive 21 for the straight part plus two circles (primitive 1) at the rotated cap
  centres; `roundrect` → the two strips as primitive 21 with the rotation plus four corner circles
  at rotated offsets; `circle` is rotation-invariant. `%LR` is not emitted. No polygon apertures.
- **Inflation convention** (mask / paste expansion `d` per side, Astra run 1 #10): `circle` and
  `oval` grow both dimensions by `2d` (a Euclidean offset); `roundrect` grows both dimensions by
  `2d` AND its corner radius by `d` (a Euclidean offset, as today's `inflateShape` does);
  `rect` grows both dimensions by `2d` and keeps sharp corners (KiCad's convention for
  rectangular pads — the corners overshoot a Euclidean offset by `d·(√2 − 1)`, deliberately).
  Rotated macros inflate the same dimensions and keep the angle.
- D-codes and macro names are allocated in encounter order of the record list (placements ×
  preview pads, then free pads — the order today's loops use); the artwork is byte-stable for a
  given input, not under input reversal (only the DRC report claims that — Astra run 1 #14).

### 6.3 Excellon

`collectDrillHits` reads `footprintPadDrill` for footprint pads: a slot becomes a `G85` routed hit
with the tool = slot width; an unplated pad goes to the NPTH file; the offset is already in the
centre. The set of hits (position, tool, plating, slot ends) equals the set of `ctx.holes` on
every golden (a set comparison, not a count). **Precision statement (Astra run 2):** the Excellon
file carries positions to 4 decimals (0.1 µm) and tool diameters to 3 decimals (1 µm), so the
hit-set comparison is made at the file's own precision, and a ring judged exactly at its minimum
in DRC can reach the fab up to 0.5 µm smaller through tool rounding — three orders of magnitude
inside the fabricator's drill tolerance (JLCPCB PTH +0.13 / −0.08 mm), and not a DRC claim: DRC
judges the design at full precision.

### 6.4 Non-plated pads in the artwork

| Pad | Copper | Mask | Paste | Excellon |
|---|---|---|---|---|
| unplated, copper-less (§2.3) | none | relief on **both** faces (the `hole` free-pad rule: the drill must not tear the mask), sized from the drill | none | NPTH |
| `hole` free pad | none | its pad-shape opening (a user-declared clearance) on both faces PLUS, when the drill is a slot or wider than the pad's narrow side, the drill-derived relief (the stadium along the slot's absolute angle, or the disc), inflated — Astra run 2b #3 | none | NPTH |
| unplated, copper ring | the ring, `%TA.AperFunction,WasherPad*%` (Gerber X2: a pad around a non-plated hole without electrical function — the implementer verifies the token against the Ucamco specification before emitting it) | opening follows the copper | none | NPTH |
| plated | as today (`ComponentPad`) | as today | none | PTH |

### 6.5 The parity harness (Astra run 1 #11, #12)

For every golden and every emitted layer file: parse the aperture table and every flash; expand
each aperture (standard or macro) to a polygon; compare **per layer file** against the expected
geometry — copper against the record ring of the records resolved to that copper layer, mask
against the record ring inflated by §6.2 (plus the drill-derived relief of copper-less unplated
pads), paste against the SMD records inflated by the paste expansion — as a 1:1 correspondence
of instances (flash position and aperture), so a pad flashed on the wrong face, a missing flash
or an extra one fails. Geometric tolerance: **2e-6 mm** (the X4.6 coordinate resolution is 1 nm
plus rounding) — never the 1e-3 mm a "1 µm" reading would allow, which exceeds `below()`'s 1 nm
grace by three orders of magnitude. The Excellon set comparison is §6.3.

### 6.6 Enumerated export differences

Byte identity with the previous writer is claimed for boards whose pads are all orthogonal, plated
and on top-side placements. Every other difference is listed in §12 with its cause: bottom-side
placements with an explicit `pad.layer` (copper and mask now flip together), non-orthogonal pads
(macro instead of an axis-aligned standard aperture), unplated pads (no copper / `WasherPad`,
NPTH drill), footprint slots (`G85`), drill offsets.

## 7. The one `circle` interpretation

A `circle` pad is a disc of diameter `widthMm`. The ring builder `padOutlineWorldMm` emits the
(circumscribed) disc of `widthMm` for every `circle` — never the ellipse of `heightMm` — so the
record's `ring`, `bounds` and exact `disc` agree (S11 R1 #1/#2); the copper record uses the exact
disc for every `circle` (previously only when `widthMm === heightMm`; an unequal circle was judged as an
ellipse ring by DRC and flashed as `widthMm` by the Gerber — B6-1's second half); the
free-pad command parser and the store hydrator normalise `heightMm := widthMm` for circles (so
previously stored unequal rows read as discs too); the KiCad importer normalises at import with a
warning. The Gerber writer is unchanged.

## 8. Consumers

| Consumer | Reads | Through |
|---|---|---|
| batch DRC `itemsFromRecords` | holes (§1.3), ring (§3) | `footprintPadDrill`, `freePadDrill`, `annularRingMm` |
| live gate `checkPendingCopper` / route obstacles | the same holes | `itemsFromRecords(records, …, placements)` |
| connectivity records / items | copper of unplated pads (§2.3, §2.4) | `padDrillFields`, per-layer items |
| ratsnest | net-assigned unplated pads as permanent endpoints (§2.4) | `padNets` |
| copper fill (NPTH halo) | every non-plated drill incl. footprint pads | `footprintPadDrill` |
| Gerber copper / mask / paste | pad records (§6.1) + drilled objects for copper-less relief | `buildCopperRecords` once per export |
| Excellon | hits (§6.3) | `footprintPadDrill`, `freePadDrill` |
| export orchestrator | refusal on non-through vias (§5.1) | `projection.vias` |
| job file | thickness (§5.4) | `boardThicknessMm` |
| cloud snapshot | unplated footprint drills as `FreeHole` obstacles | `footprintPadDrill` |
| `collectDrills` (2D board fill, 3D substrate, drill rings) | footprint slots, offsets and frames | `footprintPadDrill` (renderers still draw round drills — recorded) |
| library queries | legacy plating (§2.2) | `withLegacyPlating` |

## 9. Tests

B2-5 (a free `std` pad 2.0 × 1.0 with a 1.8 × 0.5 slot → `ANNULAR_RING_MIN`, and a footprint pad
with `drillSlotMm` → a `G85` hit and a slot-aware hole), B2-6 (an oval pad whose bounding-box
ring passes and whose exact slot-end ring fails; an off-centre drill through `drillOffsetMm`),
B2-7 (a `blind` via → `VIA_TYPE_UNSUPPORTED`, no `VIA_ASPECT_RATIO`; the export refuses), B6-1
(a 45° 2 × 0.2 mm pad → `%AM…` macro whose expansion equals the record ring); the kernel oracle
(`drc-pad-annular.test.ts`: dense boundary sampling vs the analytic value, ≤ 1e-6 mm, over shapes
× rotations × mirror × drill offsets × slots; the named cases — centre outside the copper, a slot
past one end, the roundrect clamp, a ring exactly at the minimum, the breakout at a minimum of
0; the mutation "1 nm below the minimum fails"); the copper-less containment test (the `1 × 1`
square with a `⌀1` drill keeps its corners); the per-layer NPTH items (front and back traces on
the two rings of one hole are NOT connected; a net-assigned unplated pad keeps its airwire and
raises `NPTH_PAD_NET`); `gerber-pad-parity.test.ts` (§6.5) and the Excellon set parity (§6.3)
over the goldens; the M3 mounting-hole row through `withLegacyPlating` incl. the identity
mismatch case; `drc-p1-fixes` "blind via" rewritten to §5.1–§5.2; a new 4-layer golden provokes
`VIA_TYPE_UNSUPPORTED` and `NPTH_PAD_NET` and carries a copper-less NPTH pad, an NPTH pad with a
ring, a footprint slot, an offset drill, a 45° pad and a through-via aspect hit; every golden's
`countsByCode` diff is attributed to a named cause.

## 10. Stated limits

§0's out-of-scope list; renderers draw round drills; `trapezoid` / `custom` pads are rectangles
at the source (import warning `footprint_pad_shape_degraded`); no scoped rule reaches the pad
ring, `drillSizeMm` or `copperToHoleMm`; the PCBWay HDI rows are not modelled; a negative
annular value is a margin, not a measurement (§3.1); the artwork is not byte-stable under input
reversal (§6.2); one drill file per plating — no per-span drills (§5.1); a roundrect macro at the
degenerate radius (`ratio ≥ 0.5`) repeats two corner circles — dead primitives, correct geometry
(R2 #5).

## 11. Amendments

(filled at close — PROGRAM.md, OPEN_FINDINGS.md, TODO.md, contracts 01/02/04/05/06/07, AGENTS,
CLAUDE.md tree, skill scope, eda-standards pointer, memory.)

## 12. Review ledger

### 12.1 Plan-critique (Opus, 2026-09-10) — 18 findings

5 blockers folded (holes as a byproduct of records; copper-less pads losing their hole; lockfile /
`npm ci`; unsigned polygon kernel; mask loop left on `preview.pads`), 6 majors folded (mirrored
mask flip, B2-7 body, legacy site, id parse, scope cuts, drill derivations), 1 major rejected
(`viaSpanDepthFraction` exists — `stackup.ts:145` — unused; deleted), 7 minors folded.

### 12.2 Astra run 1 — spec-attack, gpt-6-astra, xhigh, prompt-only (2026-09-10, 16 findings)

| # | Finding | Verdict | Where |
|---|---|---|---|
| 1 | SDF sign convention ambiguous in the packet's oval / roundrect wording | accepted (wording) | §3.1–§3.2 explicit positive-inside formulas |
| 2 | A net-assigned NPTH ring bridges faces (one graph node; the ratsnest pin union `ratsnest.ts:106-131` would merge per-layer shapes too) | **accepted, blocker** | §2.4: null net, per-layer items, permanent airwire + `NPTH_PAD_NET` |
| 3 | `min(w,h)` OD is not a containment test (`1 × 1` square, `⌀1` drill keeps corners) | accepted | §2.3 exact containment, fail-safe |
| 4 | Drill offsets silently centred | accepted | §1.1 `drillOffsetMm` carried and applied |
| 5 | `below()` grace + a 0 minimum legalises a breakout | accepted | §3.3 breakout judged first |
| 6 | Negative kernel value is not an exact wall measurement | accepted (wording) | §3.1 |
| 7 | `custom` fab: a blind via is exported as a through drill | **accepted, blocker** | §5.1 `VIA_TYPE_UNSUPPORTED` on every fab (error) + export refusal |
| 8 | Copper-less NPTH mask cannot come from records | accepted (already in WP4) | §6.1 |
| 9 | Polygon domain / asymmetric mirrored outlines not exportable | accepted (wording) | §0: polygon pads are not an S11 input |
| 10 | Dimension inflation ≠ Euclidean offset for rectangles; roundrect radius | accepted (convention stated) | §6.2 |
| 11 | Parity tolerance "1 µm" vs 1 nm DRC grace | accepted | §6.5 2e-6 mm |
| 12 | Aperture-only parity misses wrong-face flashes and mask | accepted | §6.5 per-layer 1:1 instances |
| 13 | Duplicate pad numbers → tied `(code, id)` non-determinism | **rejected** — the survivor is total (`drc-engine.ts:75-96`, S8) | §1.3 |
| 14 | D-code allocation order under record traversal | accepted as documented (no byte claim under reversal) | §6.2 |
| 15 | Legacy raw-index recovery assumes raw immutability | accepted | §2.2 identity match |
| 16 | Finished vs drilled diameter semantics | accepted (convention stated; no constant added) | §0 |

Survived: the kernel's exactness for contained drills, the mirror composition, the §4 row
mapping, the §7 disc policy (now applied at hydration too), the single `freePadDrill` derivation.

### 12.3 R1 — `reviewer-critical` on WP2 + WP3 (2026-09-10, 7 findings)

| # | Finding | Verdict | Where |
|---|---|---|---|
| 1 | `discOf` for every circle while the ring stayed the `heightMm` ellipse — `ring`/`bounds`/`disc` disagreed for an unequal circle | **accepted, major** — the ring builder emits the disc of `widthMm` | §7, `pad-outline.ts` |
| 2 | `copperInsideDrill`'s circle bound ignored `heightMm` — an ellipse record removed whole | accepted, major — same root cause; resolved by #1 | §2.3 |
| 3 | Free-pad slot: `drillMm` (row) ≠ `slot.widthMm` (tool) — fab row and `DRILL_SIZE_MIN` judged the wrong number | **accepted, major** — `freePadDrill` reports the slot width as the tool | §1.2 |
| 4 | `plated: false` honoured on an undrilled pad — its net vanished from connectivity | accepted, minor — `padDrillFields` reads an undrilled pad as plated | §2.1 |
| 5 | NaN ring fell into the breakout arm | accepted, minor — non-finite ring: no verdict | §3.3 |
| 6 | Pour still carves a thermal knockout for an unplated ring it can never join; an island whose only pad is that ring reads isolated | accepted, minor — pour membership skips unplated records (WP4) | §2.4 |
| 7 | §3.2 overstated the Gerber clamp (writer unclamped; macro name keyed on the unclamped value) | accepted (doc + WP4: shared `roundrectRadiusMm`, name keyed on the clamped radius) | §3.2, §6.2 |

Survived: the kernel against an independent boundary sampler (< 1e-6 contained, sign-agreeing for
breakouts, 8 shapes × 6 rotations × mirror × 6 drill forms), the mutations, the frame composition,
one hole per drilled shape incl. two-occurrence pins and mirrored slots, the via-type precedence,
every fab row, determinism under reversal, `padDrillFields` under both package states.

### 12.4 R2 — `reviewer` on WP4 (2026-09-10, verdict accept, 6 minors)

| # | Finding | Verdict | Where |
|---|---|---|---|
| 1 | 21 `library-*` gate failures are the environmental `.opclib` baseline, not the diff | noted (baseline 22 full-suite fails unchanged) | — |
| 2 | `golden-census-2l` paste.top lost the drilled `smd` free pad's aperture — an unlisted export difference | accepted — documented in the golden's `.md` (§6.4: a drilled or unplated record gets no paste) | §6.6 |
| 3 | The parity harness had no mirrored / bottom placement and no rotated oval / roundrect in any golden | accepted — `golden-holes-4l` gained `RT2` (mirrored 30° placement: rotated oval, rotated roundrect, explicit-layer flip, mirrored slot); DRC report unchanged, parity green | §6.5, §9 |
| 4 | `golden-holes-4l` cannot go through the export orchestrator (its blind via is refused) | accepted — recorded in the golden's `.md` | §5.1 |
| 5 | Degenerate-radius roundrect macro repeats two corner circles (dead primitives, correct geometry) | recorded limit (cosmetic; pre-existing) | §10 |
| 6 | Snapshot pushes NPTH footprint holes before the free-pad loop (brief said after; output deterministic) | accepted as-is | §8 |

R2 verified independently: 108 macro cases against an analytic boundary (2e-6), the mirrored
explicit-layer flip on copper / mask / paste, Excellon hit sets on all seven goldens, the export
refusal before any artifact, the legacy-plating identity rules on the real M3 row, the KiCad via
atoms, the pour halo distances, the snapshot obstacles, byte identity across two runs. Not
verified by R2: the `WasherPad` citation (the implementer verified it against the Ucamco
specification text extracted with `pdftotext`; `docs/designer/pcb-standards.md` §3.2 now lists it).

### 12.5 Astra run 2 — adversarial-verify, gpt-6-astra, xhigh, repository-grounded

**Run 2a (2026-09-10 20:0x–21:0x, ≈175 k tokens): cut off by the OpenAI usage limit before its
final report** ("You've hit your usage limit … try again at 10:04 PM"). Its trajectory (probes
it wrote and ran read-only against the tree) still yielded, verified against source:

| # | Finding (from the trajectory) | Verdict | Where |
|---|---|---|---|
| 2a-1 | A numbered copper-less NPTH pad bound to a net produced NO report: no record ⇒ no `NPTH_PAD_NET`, no ratsnest endpoint ⇒ no airwire — a silent open | **accepted, high** — `NPTH_PAD_NET` now also covers copper-less pads (footprint via `ctx.holes` + `padNets`; `hole` free pads via `netId`) | §2.4 (b), `checks/structural.ts` |
| 2a-2 | (found while verifying 2a-1) the per-layer null-net split also stripped the net from a drilled `smd` / `conn` FREE pad — single-layer copper with a legitimate net (a test point with a probe hole) | **accepted, high** — the split applies only to unplated copper on ≥ 2 layers | §2.4, `copper-items.ts` |
| 2a-3 | A PTH ring accepted at exactly 0.18 mm reaches the fab as 0.1798 mm through the Excellon tool's 3-decimal rounding | accepted as a precision statement (0.5 µm ≪ the fab's +0.13 / −0.08 mm; DRC judges the design) | §6.3 |
| 2a-4 | "roundrect parity 0.6 0": a free pad with `roundrectRatio` 0.6 flashed as ratio 0.25 | **rejected — probe artefact**: the test helper `freePad()` has no `roundrectRatio` option, so the pad it built carried none; with the ratio set, ring and macro both use the clamped 0.5 (`RR_2_1_0p5`) | §6.2 |

Also confirmed by the run before the cut: 164 listed tests green; fab-row boundary probes
(±2e-6 around every row) selected the right field; mask parity under mirror.

**Run 2b (2026-09-10 22:06–22:16, ≈193 k tokens, completed):** 6 findings, all "verified by
execution" by Astra and re-verified against source; B2-6, B2-7 and B6-1 mechanisms survived its
attacks; 167 listed tests green under its probes.

| # | Finding | Verdict | Where |
|---|---|---|---|
| 2b-1 | Free-hole slots: DRC compared the row's `drillMm` (1.2) while Excellon routed the slot width (0.8); a degenerate slot was a round 1.2 in DRC and a coincident-endpoint 0.8 `G85` in Excellon | **accepted, high** — `freeHoleDrill` is the one derivation (DRC, Excellon, pour halo, snapshot, `collectDrills`); hydrator makes `drillMm = drillSlot.widthMm` | §1.1, §1.2 |
| 2b-2 | A square (degenerate) footprint slot fell through to `drillDiameterMm` | **accepted, high** — the slot tool survives degeneration | §1.2 |
| 2b-3 | A slotted `hole` free pad's mask relief was the pad-shape circle, not the slot stadium | **accepted, high** — drill-derived relief added when the drill is a slot or wider than the pad; parity oracle mirrors it | §6.4 |
| 2b-4 | The unconditional breakout check never ran for vias (`D = d`, minimum 0 → clean) | **accepted, high** — via annulus breakout judged before its minimum | §3.3 |
| 2b-5 | `Number("")` = 0 bound an id `edited:` to raw pad 0 | accepted, medium — the index token must be `^\d+$` | §2.2 |
| 2b-6 | `NPTH_PAD_NET` for two copper-less occurrences de-duplicated in draft order → marker not byte-identical under reversal | accepted, medium — every occurrence is emitted; the canonical survivor decides | §2.4 |

Regressions: `drc-s11-review-fixes.test.ts` "Astra run 2b — the six verified findings".

