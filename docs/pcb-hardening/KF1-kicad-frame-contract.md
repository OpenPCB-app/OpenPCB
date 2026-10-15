# KF1 — KiCad coordinate-frame contract

Cross-item contract (H13 / OPENPCB-61, slice OP1). Not a numbered hardening session; see the
"Cross-item contracts" table in `PROGRAM.md`. Binding for every path that moves KiCad geometry into
OpenPCB: footprint import, project import, schematic import, library migration, CoreLibrary packing,
3D, export.

Status: the contract is binding now. The shared-package conversion (`@openpcb/kicad-import` 0.2.0,
SH1) and the code that implements the rules below land in later H13 slices (OP2..OP13). Until
`kicad-import-v0.2.0` is pinned (OP7), the pinned 0.1.2 importer still stores footprint geometry in
the K frame; the qualification rules in §6 exist to tell the two apart.

## 1. Frames

| Frame | Axes and units | Angles | Owner |
|---|---|---|---|
| **K**: KiCad source (`.kicad_mod`, `.kicad_pcb`, `.kicad_sch` positions) | +x right, **+y down**, mm with up to 6 decimals (1 nm) | **Visually CCW** (KiCad `RotatePoint` is math-CW in Y-down), degrees, may be fractional, range (-180,180] | file |
| **Ks**: KiCad library symbol (`.kicad_sym` pin/body coordinates) | +y **up**, mm | visually CCW | file |
| **C**: canonical model (DB, commands, DRC, connectivity, export input) | +x right, **+y up**, **integer nm** for persisted world geometry; footprint-local preview geometry in mm (`FootprintRenderModel`, `units:"mm"`) | math-CCW, degrees, normalized to [0,360), fractional allowed | OpenPCB |
| **S**: canvas scene | mm = nm / 1_000_000 (`NM_TO_SCENE`), Y-up | identity with C | renderer |
| **Px**: screen | px, Y-down | camera projection only | camera |
| **3D**: Board3D scene | X = C.x mm, Y = C.y mm, Z up. Board top at z=0, bottom at z=-thickness | Euler about Z = C rotation | `three-d/` |
| **G**: Gerber/Excellon output | `%FSLAX46Y46*% %MOMM*%`, absolute, Y-up, identical numbers to C (no origin shift) | n/a | export (H19) |
| **P**: PnP/CPL | mm, Y-up, board origin = C origin. Bottom-side conventions belong to H19/H23 | CCW plus the family offset (`export/pnp/rotation-db.ts`) | export |

The canonical frame is Y-up integer nm everywhere. Do not introduce floating-point storage units.

For H23: imported back-side parts are stored as `rotationDeg = theta_K + 180` (§3). KiCad `.pos`
reports bottom-side rotation differently; the delta is H23's to define and is **not verified** here.

## 2. Conversion K to C

`N = diag(1,-1)`.

- Point: `p_C = N * p_K`.
- Angle: `phi_C = norm360(phi_K)`, **sign unchanged**. Exact because `N * RotK(p,theta) = R(theta) * N * p`.
  Only coordinates are negated; angles are not.
- `norm360(d)`: first snap `d` to `round(d)` when `|d - round(d)| < 1e-9`; then
  `((d % 360) + 360) % 360`; then map `360 -> 0` and `-0 -> 0`. Never `Math.round` otherwise.
  Snap **before** the modulo, otherwise `-1e-12` returns 360.
  Required results: `norm360(-1e-12) === 0`, `norm360(359.9999999999) === 0`, `norm360(-0) === 0`.
- A 3-point arc `(start, mid, end)` maps pointwise; its sweep direction reverses automatically,
  which is correct for a reflection.
- Any angle-swept arc representation (KiCad 5 `fp_arc` with `(angle)`, or `PcbOutlineSegment.cw`)
  must negate the sweep, or flip `cw`.
- Integer nm: `x_nm = Math.round(x_mm * 1e6)` and `y_nm = -Math.round(y_mm * 1e6)`. Round **in K**,
  then negate, so a value and its negation round symmetrically. Normalize `-0` to `0`
  (`y === 0 ? 0 : -y`).
- **Pad with drill offset** (KiCad `PAD::ShapePos`: hole at `at`, copper at `at + RotK(offset, alpha)`,
  alpha = pad local angle). Canonical, native convention (copper at `centerMm`, hole at
  `centerMm + R(beta) * drillOffsetMm`):
  - `centerMm = N * (at + RotK(offset, alpha)) = N * at + R(alpha) * N * offset`
  - `drillOffsetMm = -N * offset = (-ox, +oy)`
  - `rotationDeg = alpha`
  - The hole is then at `centerMm + R(alpha) * (-N * offset) = N * at`.
  - The implementation cites `pcbnew/pad.cpp` `ShapePos` at the pinned KiCad tag in a comment. If it
    cannot be cited the rule still ships (it is the documented KiCad behaviour) and drill-offset
    pads stay an open item of A7 (§9) until a kicad-cli reference confirms them.
- **Geometry relation** (used by classification, §6). For transform version 1 the expected canonical
  local centre of raw pad `r` is
  `expectedCentreV1(r) = N * (r.position + RotK(r.drillOffset ?? 0, r.rotation))`.
  Each future transform version defines its own relation here.

## 3. Placement composition

The library footprint local frame is canonical and front-side: `p_c = N * p_K,front`.

- **Front instance:** `world_C = N * at_K + R(theta) * p_c`. So `rotationDeg = norm360(theta)`,
  `mirrored = false`, `layer = F.Cu`.
- **Back instance:** KiCad stores the children already flipped (local `y` negated, pad and text
  local angle negated, layers swapped) and the footprint `theta` as written. Derivation:
  `world_K = at_K + RotK(N * p_K,front, theta)`, hence
  `world_C = N * at_K + R(theta) * p_c'` with `p_c' = N * N * p_K,front = M_x * R(180) * p_c`, which
  gives `world_C = N * at_K + R(theta + 180) * M_x * p_c`. So
  **`rotationDeg = norm360(theta + 180)`, `mirrored = true`, `layer = B.Cu`**.
  - Worked example: a front part at 0 with pad 1 at K-local (-1,0), flipped L/R in KiCad, gives
    theta = 180 and world pad at `at + (1,0)`. With the rule: `M_x * (-1,0) = (1,0)`, then `R(0)`
    gives `(1,0)`. Correct.
  - Independent evidence: the Chickadee board (§8). Treating back-side pad locals as stored (already
    flipped), 44 pad centres land on track or via endpoints; re-flipping them gives 4.
  - The pre-OP importer used `theta` for back-side parts. That is wrong for every back-side part.
- **Pad world rotation** (unchanged in-tree rule): front `phi + beta`, back `phi - beta`, where
  `beta` is the library pad rotation: `beta = alpha_K,front` for `.kicad_mod`, and
  `alpha_abs - theta` (front) or `theta - alpha_abs` (back) when un-placing a board instance.
- **3D back-side model:** KiCad renders the flipped model as `R_z(theta) * diag(1,-1,-1)`, which
  equals `R_z(theta + 180) * diag(-1,1,-1)`. In C the model group gets rotation `phi` and
  **scale `(-1, 1, -1)`**, a proper rotation (det = +1), placed at `z = -thickness`. The flat 2D
  overlay keeps `(-1,1,1)`.
- **KiCad 3D model `(offset)`** is taken to be in the 3D Y-up frame (applied after KiCad's board to
  3D Y negation) and is copied unchanged. **Unverified**: the `(offset)` frame and the `(rotate)`
  sign and order. OP6 verifies against cited KiCad source or records "unverified" here.
- **Schematic:** `.kicad_sch` positions are K and `.kicad_sym` locals are Ks (Y-up).
  `world_C = N * at_K + R(theta) * p_s` (verified 91/92 pins on USBtoUART, versus 79/92 for the old
  importer). The `(mirror ...)` mapping is fixed by the corpus pin oracle (OP11,
  `kicad-sch-mirror-oracle.test.ts`) and recorded here when it runs; the USBtoUART schematic has no
  mirrors and says nothing about mirror composition. Initial expectation: `y` gives
  `mirrored: true`; `x` gives `mirrored: true` with rotation + 180. **The oracle decides.**

## 4. Exactly-once rule

Every K datum is converted at **one** site. Everything downstream stores and uses C and never
converts again.

| Data path | The ONE transform site | Everything downstream |
|---|---|---|
| `.kicad_mod` to library (wizard, ZIP, drawn+imported, project ingestion, CoreLibrary batch import) | `kicadPointToCanonical` / `kicadPadToCanonical` in `@openpcb/kicad-import` `src/frame.ts`, called only from the `build-preview-models.ts` footprint functions | stores C. `raw` stays K by contract and is never rendered. Any reader comparing `raw` with `preview` goes through the §2 geometry relation of the preview's stamped transform version |
| `.kicad_pcb` board-instance footprint to library form | `unplaceBoardFootprint` (K to K normalization: un-rotate angles, un-flip back side; `src/shared/kicad-frame/`), then the row above | as above |
| `.kicad_pcb` board items (placements, tracks, arcs, vias, zones, keepouts, outline, board graphics) and `.kicad_sch` positions | `KicadBoardFrame` in `kicad-frame.ts`, called by H14's `frame-port.ts` call sites | C |
| Legacy library rows | re-derivation from `raw` through the first row (OP8) | C |
| CoreLibrary `.opclib` | precomputed at pack time through the first row (CL2) | C; intake verifies signature and stamp |
| Snapshots, projections, undo, save/reopen, cloud sync, export | **none** | C |

Guard (test, OP9): `kicad-frame-boundary.test.ts` reads the source of the designer import planner
files and fails if `.yMm` is dereferenced outside `kicad-frame.ts`, `frame-port.ts` or an allowlist
of parser files.

## 5. Provenance

Footprint rows carry a frame stamp in `provenance.frame`:

```ts
interface FootprintFrameProvenance {
  frame: "openpcb-y-up";
  origin: "kicad-converted" | "authored";
  transformVersion: number;   // kicad-converted: >= 1; authored: 0
  tool: string;               // "@openpcb/kicad-import" | "openpcb-editor" | "ipc-7351b" | "parametric:<id>"
}
```

Row classes: `kicad-converted`, `authored`, `placeholder`, `legacy-kicad-ydown`, `ambiguous`. Trust:
`signed-pack`, `geometry-verified`, `markers`.

**Trust principle.** A stamp in `provenance.frame` is a claim, never evidence. Class
`kicad-converted` requires one of: a pack signature that is valid now, or the §2 geometry relation
`preview == expectedCentreV1(raw)`. Trust is re-derived from the row's own data on every
classification, never from `source_id` and never copied. Clones and cloud repacks therefore cannot
launder a stamp: an unsigned row with a lying stamp fails the geometry relation. Stamps whose
`transformVersion` is not in `QUALIFIED_KICAD_TRANSFORM_VERSIONS` (currently `[1]`) are `ambiguous`.

The producer of `kicad-converted` data (`@openpcb/kicad-import` >= 0.2.0) stamps every preview it
builds. The installed package version is detected by the presence of
`KICAD_FOOTPRINT_TRANSFORM_VERSION`; on 0.1.2 detection returns null and nothing qualifies.

## 6. Qualification and blocking rules

- **Intake is qualification-based.** A KiCad footprint is accepted as `kicad-converted` only if the
  installed package is qualified, the server-built preview carries a matching stamp, and the §2
  relation holds for its raw pads. Unqualified input is rejected when
  `library.footprintIntakeQuarantine` is on and stored as `legacy-kicad-ydown` otherwise.
  A `.opclib` is accepted only when every footprint classifies as `kicad-converted` or `authored`.
- **Legacy data is never auto-flipped in place on designs.** Placed copper is never moved. A design
  is classified from its placements' library snapshots (and a sticky legacy-project-import finding
  for boards imported before this contract); legacy or ambiguous designs are blocked from
  manufacturing export in every build. Resolution is by user command under undo
  (`refresh_part_footprint`, same-footprint mode) or by re-import of the project.
- **Library rows** are rewritten only when `user.local`, proven legacy by geometry, and only after a
  whole-DB snapshot plus a per-row backup of the prior `data_json` (OP8, re-pin-gated). Pack rows
  are never rewritten.
- `designer.outputQuarantine` (release) stays on until the user signs off. The frame blocker is
  data-driven and independent of any flag.

## 7. Consumers

| Consumer | Rule |
|---|---|
| H14 (project import) | all board and schematic positions go through `KicadBoardFrame`; board-instance footprints are un-placed to library form first; the chosen frame is recorded in the import report |
| H19 (export) | consumes the frame-status verdict as a blocker; Gerber/Excellon numbers are C with no shift |
| H23 (PnP) | owns bottom-side rotation conventions; see §1 note |
| 3D | back-side scale `(-1,1,-1)` (§3) |
| CoreLibrary | packs precomputed C geometry; G-FRAME gate verifies the stamp and the relation |

## 8. Evidence

Scratch checks against the tracked USBtoUART project (KiCad 8.0.4, 19 footprints, front side only,
rotations 0/+-90/180):

| Check | Result |
|---|---|
| Canonical pad = `N * (at_fp + RotK(at_pad_local, theta_fp))` | all 86 numbered copper pads match `%TO.P` identity in `F_Cu.gbr`, max error 3e-14 mm; both NPTH pegs match `NPTH.drl` |
| Pad `at` pre-rotated (alternative B) | 40 mismatches |
| Math-CCW in the Y-down frame (alternative C) | 22 mismatches |
| Pad angles in a board file | absolute: (theta_fp, alpha_pad) pairs (-90, 270), (90, 90), (180, 180) |
| Footprint graphics in a board file | footprint-local and unrotated |
| Schematic pins on wires/labels/junctions | 91/92 with `N*at + R(theta)*p_symbol` versus 79/92 for the old importer |
| USBtoUART drill offsets | none; drill-offset semantics are not numerically verified |

Back side: `0400_laptimer58_Chickadee/semantic.kicad_pcb` in the local, gitignored auto-layout corpus
(20 B.Cu footprints), see §3. Mirrored schematic census over the same corpus: `(mirror x)` at
0/90/270 and `(mirror y)` at 0; KiCad writes only these canonical forms.

## 9. A7 status (open)

| Evidence | Covers | Status |
|---|---|---|
| O1 USBtoUART Gerber/Excellon | front side, 0/+-90/180, NPTH | runs in CI (OP11) |
| O4 Chickadee + corpus | back side (track endpoints), F/B equality | local only, skip in CI |
| Schematic mirror oracle | 4 canonical mirrored orientations | local only, skip in CI |
| O3 `sides` via kicad-cli | full 0/90/180/270 x F/B matrix, drill offset, `.pos` | needs kicad-cli |

A7 stays **open** until `OPENPCB_REQUIRE_KICAD_REF=1` passes on a machine with the corpus and
kicad-cli references, or the user waives O3. Lifting `designer.outputQuarantine` for KiCad-derived
content additionally requires A7 sign-off.

## 10. Revision rule

Any change to the K to C output for the same input bumps `transformVersion` and adds a relation
definition to §2. Existing versions stay qualified until explicitly removed from
`QUALIFIED_KICAD_TRANSFORM_VERSIONS`.
