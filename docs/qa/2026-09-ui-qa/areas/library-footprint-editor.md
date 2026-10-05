# library.footprint-editor — QA findings

[← index](../README.md) · 5 triage entries · S1 2 · S2 1 · S3 2 · S4 0

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-316](#t-316) | S1 | IPC preset generator emits wrong land patterns (SOT pad count/layout, QFN EP shorts signal pads) | Q7-013 | decide (DEC-PKG) | L4a / W3 | shared-package | M |
| [T-317](#t-317) | S1 | KiCad-derived footprints (wizard + CoreLibrary) stored Y-down: every land pattern mirrored in PCB/Gerber (dead boards) | Q7-022, Q6-023, F2A-008 | decide (DEC-PKG) | followup / followup | shared-package | L |
| [T-318](#t-318) | S2 | Footprint editor cannot place pads precisely: no X/Y fields, fixed 0.635 mm grid, no zoom-to-fit | Q7-015 | fix-now | L4b / W3 | frontend | M |
| [T-319](#t-319) | S3 | Preset size/density changes don't regenerate: UI shows SOT-323 + 'C (Least)' pressed while the footprint to be saved is still SOT-23 nominal | Q7-014 | fix-now | L4a / W3 | frontend | S |
| [T-320](#t-320) | S3 | Footprint import: a second import replaces the first, variant naming inconsistent, garbled placeholder copy | Q7-029 | fix-now | L4a / W3 | frontend | S |

## T-316

**IPC preset generator emits wrong land patterns (SOT pad count/layout, QFN EP shorts signal pads)**

- Severity **S1** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-PKG · owner L4a · wave W3 · scope shared-package · estimate M
- Findings: Q7-013

**Summary.** Generated Footprint panel: SOT-23 'Pads 4' laid out 2×2 (pads 1,2 left at 0.95 mm, 3,4 right); SOT-23-5 'Pads 6' (SOT-23-6 layout); SOT-323 'Pads 4'; SOT-223 four equal 2×2 pads, no tab. The size card itself says '3 pins'. Committing yields a footprint whose pad positions/numbers do not match the real package — boards built with it are unassemblable, and nothing warns. QFN is also broken: QFN-16 (3×3, 0.5 pitch) → p…

**Root cause.** `node_modules/@openpcb/rendering-core/dist/ipc7351b/family-presets.js:74` — pinCount: 4, // SOT-23 has 3 pins but uses 4-pin dual-row layout (1 empty) — the 'empty' pad is never removed; SOT-23-5 pinCount 6; SOT-223/SOT-323 pinCount 4

**Proposed fix.** Mitigation now: hide/disable affected SOT and QFN-EP presets with note; real fix in @openpcb/rendering-core ipc7351b family-presets. — Detail: In shared/rendering-core ipc7351b add a dedicated SOT generator (per-side pin lists + optional tab) or depopulate positions (SOT-23: keep 1,3 left→1,2 and centre right→3; SOT-23-5: drop pin 5 position; SOT-223: 3 pads + tab 4). Add golden tests against KiCad Package_TO_SOT_SMD; until fixed hide the SOT family in FootprintPresetPicker.

**Evidence.** [046-preset-sot23-B](../evidence/shots/q7/dark/046-preset-sot23-B.png), [019-preset-sot23-B](../evidence/shots/vq7/dark/019-preset-sot23-B.png)

<details><summary>Q7-013 — IPC preset generator emits wrong land patterns: every SOT size has the wrong pad count/layout and QFN exposed pad overlaps (shorts) all signal pads (S1, confirmed)</summary>

- Area library.footprint-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Library → New part → (any symbol) → Next → Footprints → Preset
  2. Package family SOT → Size 'SOT-23 — 3 pins, 0.95 mm pitch' → Density B → Generate footprint
  3. Repeat for SOT-23-5, SOT-223, SOT-323
  4. Also: Preset → QFN → QFN-16 → B → Generate footprint (Pads 17, EP covers the pin rows)
- Expected: SOT-23: 3 pads (1,2 on one side at 1.9 mm pitch, 3 centred opposite); SOT-23-5: 5 pads (3+2); SOT-223: 3 small pads + large tab (pad 4); SOT-323: 3 pads — per IPC-7351B / KiCad Package_TO_SOT_SMD.
- Actual: Generated Footprint panel: SOT-23 'Pads 4' laid out 2×2 (pads 1,2 left at 0.95 mm, 3,4 right); SOT-23-5 'Pads 6' (SOT-23-6 layout); SOT-323 'Pads 4'; SOT-223 four equal 2×2 pads, no tab. The size card itself says '3 pins'. Committing yields a footprint whose pad positions/numbers do not match the real package — boards built with it are unassemblable, and nothing warns. QFN is also broken: QFN-16 (3×3, 0.5 pitch) → perimeter pads centred at ±1.05 mm, 0.9 mm long (inner edge 0.60 mm from centre) while EP pad 17 is 1.7×1.7 (edge 0.85 mm) — the EP overlaps every signal pad by 0.25 mm, i.e. all 16 pins shorted to the thermal pad; the preview's even-odd fill draws the overlaps as dark notches (light/021). Node dump of generateFootprint('qfn','QFN-16','nominal') and ('sot','SOT-23','nominal') confirms: SOT-23 pads 1(-1.2,0.475) 2(-1.2,-0.475) 3(1.2,-0.475) 4(1.2,0.475). Worth auditing the whole family table: SOIC-8 nominal yields pads centred at x=±3.0 mm, 1.2×0.46 mm, vs KiCad SOIC-8_3.9x4.9mm_P1.27mm ±2.475 mm, 1.95×0.6 mm — pad narrower than the JEDEC max lead width (0.51 mm) and no heel fillet; needs verification against IPC-7351B with /eda-standards.
- Screenshots: [046-preset-sot23-B](../evidence/shots/q7/dark/046-preset-sot23-B.png), [047-preset-SOT-23-5](../evidence/shots/q7/dark/047-preset-SOT-23-5.png), [047-preset-SOT-223](../evidence/shots/q7/dark/047-preset-SOT-223.png), [047-preset-SOT-323](../evidence/shots/q7/dark/047-preset-SOT-323.png), [021-preset-qfn16](../evidence/shots/q7/light/021-preset-qfn16.png)
- Console: `node generateFootprint('qfn','QFN-16','nominal'): pad-1 center(-1.05,0.75) 0.9×0.25; pad-17 center(0,0) 1.7×1.7`
- Code: `node_modules/@openpcb/rendering-core/dist/ipc7351b/family-presets.js:74` — pinCount: 4, // SOT-23 has 3 pins but uses 4-pin dual-row layout (1 empty) — the 'empty' pad is never removed; SOT-23-5 pinCount 6; SOT-223/SOT-323 pinCount 4
- Code: `node_modules/@openpcb/rendering-core/dist/ipc7351b/generate-footprint.js:11` — QFN perimeter pad placement ignores EP clearance (no pad-to-EP gap check)
- Suggested fix: In shared/rendering-core ipc7351b add a dedicated SOT generator (per-side pin lists + optional tab) or depopulate positions (SOT-23: keep 1,3 left→1,2 and centre right→3; SOT-23-5: drop pin 5 position; SOT-223: 3 pads + tab 4). Add golden tests against KiCad Package_TO_SOT_SMD; until fixed hide the SOT family in FootprintPresetPicker.
- Verification (vq7): **confirmed** — Reproduced in UI (SOT-23 card '3 pins' -> Generated Footprint 'Pads 4', 2x2 layout) and in node against the installed @openpcb/rendering-core 0.1.2: SOT-23 pads 1(-1.2,0.475) 2(-1.2,-0.475) 3(1.2,-0.475) 4(1.2,0.475) (pins 1-2 at 0.95 mm instead of 1.9 mm; extra pad 4); SOT-23-5 -> 6 pads; SOT-223 -> 4 equal pads, no tab; SOT-323 -> 4 pads. QFN-16: perimeter pads 0.90x0.25 centred at ±1.05 (inner edge 0.60 mm) vs EP 17 1.70x1.70 (edge 0.85) -> 0.25 mm overlap on all 16 pads; the light preview shows the overlap as merged copper. family-presets.js:74 comment admits the SOT-23 'empty' 4th position. SOIC-8 nominal pads at ±3.0, 1.2x0.46 (narrower than JEDEC max lead width). S1 kept: the generator persists electrically wrong/shorted land patterns into the library and on to PCB/Gerber with no warning. · evidence: [019-preset-sot23-B](../evidence/shots/vq7/dark/019-preset-sot23-B.png), [008-preset-qfn16](../evidence/shots/vq7/light/008-preset-qfn16.png), node generateFootprint('sot','SOT-23','nominal') -> 4 pads; ('qfn','QFN-16','nominal') -> pad1 (-1.05,0.75) 0.90x0.25, pad17 (0,0) 1.70x1.70

</details>


## T-317

**KiCad-derived footprints (wizard + CoreLibrary) stored Y-down: every land pattern mirrored in PCB/Gerber (dead boards)**

- Severity **S1** · category data · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-PKG · owner followup · wave followup · scope shared-package · estimate L
- Findings: Q7-022, Q6-023, F2A-008

**Summary.** Wizard preview of CP_Elec_6.3x5.4_Nichicon shows REF** and the '+' mark BELOW the pads (KiCad file: REF** at (0,-4.35), '+' at y≈-1.85, i.e. above in KiCad's Y-down system); C_0603 REF** below / value above (KLC puts REF above, value below). The same raw coordinates reach the PCB: on QA-q7-rotate (stack B) the CoreLibrary SOT-23 placement (rotation 0, not mirrored, F.Cu) has pads 1(-0.9375,-0.95) 2(-0.9375,+0.95) 3(… | Also covers: Q6-023: KiCad footprints are stored Y-down in a Y-up board: every imported/core footprint is mirr…; F2A-008: Golden path ships a dead board: the core NE555 SOIC-8 lands mirrored (pin 1 GND bottom-le…

**Root cause.** `node_modules/@openpcb/kicad-import/dist/build-preview-models.js:121` — footprint geometry copied without y negation

**Proposed fix.** @openpcb/kicad-import: convert KiCad Y-down to Y-up on import; regenerate CoreLibrary pack; migration for existing libraries/designs. Release blocker. — Detail: Pick one convention (Y-up, matching drawn/IPC footprints, board and Gerber) and negate y (and mirror arc sweep/rotation angles) for all .kicad_mod-derived geometry at import time in @openpcb/kicad-import and in the CoreLibrary pack step; add golden tests (CP_Elec '+' mark top-left, SOT-23 pad 1 top-left, SOIC-8 counter-clockwise numbering) and a data migration for already-imported footprints and placed designs. Needs PCB/export owner sign-off before release.

**Evidence.** [042-footprint-import-cpelec](../evidence/shots/q7/dark/042-footprint-import-cpelec.png), [034-fp-import-cpelec](../evidence/shots/vq7/dark/034-fp-import-cpelec.png), [040-pcb-555](../evidence/shots/q6/light/040-pcb-555.png)

<details><summary>Q7-022 — KiCad-derived footprints (wizard imports AND CoreLibrary) keep KiCad's Y-down coordinates in OpenPCB's Y-up world: previews, PCB and Gerber get a mirror-image land pattern (SOT-23 pad 1 bottom-left) (S1, confirmed)</summary>

- Area library.footprint-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. New part → Footprints → Import CP_Elec_6.3x5.4_Nichicon.kicad_mod (and C_0603_1608Metric.kicad_mod)
  2. Compare with KiCad: REF** at (0,-4.35) and the '+' polarity mark at (-4.04,-1.85) are ABOVE the pads in KiCad (Y-down)
  3. Draw a pad at the top of the Draw canvas and read its stored y
- Expected: One coordinate convention: .kicad_mod y is negated on import (as drawn/IPC-generated footprints are Y-up), so the preview matches KiCad and pin-1/polarity marks land on the correct side.
- Actual: Wizard preview of CP_Elec_6.3x5.4_Nichicon shows REF** and the '+' mark BELOW the pads (KiCad file: REF** at (0,-4.35), '+' at y≈-1.85, i.e. above in KiCad's Y-down system); C_0603 REF** below / value above (KLC puts REF above, value below). The same raw coordinates reach the PCB: on QA-q7-rotate (stack B) the CoreLibrary SOT-23 placement (rotation 0, not mirrored, F.Cu) has pads 1(-0.9375,-0.95) 2(-0.9375,+0.95) 3(0.9375,0) and the PCB top view draws pad 1 bottom-left / pad 2 top-left (cursor readout Y -2.944 at pad 1 vs -1.042 at pad 2, world is Y-up). That order (1->2->3 clockwise) is the mirror of KiCad's SOT-23 (pad 1 top-left, counter-clockwise), which cannot be produced by rotation. The Gerber writer emits y unflipped (export/gerber/arcs.ts:7), so exported copper carries the mirrored pattern: for the NPN SOT-23 EBC, E and B pads are swapped on the fabricated board. Drawn and IPC-generated footprints use Y-up (QFN pin 1 at (-1.05,+0.75), counter-clockwise), so the two footprint populations disagree.
- Screenshots: [042-footprint-import-cpelec](../evidence/shots/q7/dark/042-footprint-import-cpelec.png), [041-footprint-import-c0603](../evidence/shots/q7/dark/041-footprint-import-c0603.png), [021-preset-qfn16](../evidence/shots/q7/light/021-preset-qfn16.png)
- Network: `GET /components/ab68b38d…/detail → footprint.preview.labels REF** at {x:0,y:-1.43} (F.SilkS)`; `GET /components/ccf704c1…/detail → drawn pad 1 centerMm {x:-7.62,y:22.225} (placed at top)`
- Code: `node_modules/@openpcb/kicad-import/dist/build-preview-models.js:121` — footprint geometry copied without y negation
- Code: `../CoreLibrary/footprints/package/sot-23.fp.json:1` — normalized + raw pads keep KiCad y (pad 1 y=-0.95, REF** y=-2.4)
- Code: `src/modules/designer/backend/export/gerber/arcs.ts:7` — 'The writer emits y unflipped'
- Suggested fix: Pick one convention (Y-up, matching drawn/IPC footprints, board and Gerber) and negate y (and mirror arc sweep/rotation angles) for all .kicad_mod-derived geometry at import time in @openpcb/kicad-import and in the CoreLibrary pack step; add golden tests (CP_Elec '+' mark top-left, SOT-23 pad 1 top-left, SOIC-8 counter-clockwise numbering) and a data migration for already-imported footprints and placed designs. Needs PCB/export owner sign-off before release.
- Verification (vq7): **confirmed** — Confirmed in the wizard preview and extended to the PCB: q7 asked for PCB/Gerber verification, which I did on q7's own design QA-q7-rotate (CoreLibrary SOT-23, projection pads + on-canvas cursor readout) and in the Gerber writer source. Severity raised S2 -> S1: every asymmetric KiCad-derived footprint, including the default CoreLibrary, is placed and exported as its mirror image (wrong pinout on real boards). · evidence: [034-fp-import-cpelec](../evidence/shots/vq7/dark/034-fp-import-cpelec.png), [033-fp-import-c0603](../evidence/shots/vq7/dark/033-fp-import-c0603.png), [005-pcb-sot23-zoom](../evidence/shots/vq7/light/005-pcb-sot23-zoom.png), [008-preset-qfn16](../evidence/shots/vq7/light/008-preset-qfn16.png), GET /designs/f2a044b0…/projection/pcb -> Q1 rotationDeg 0, mirrored false, layer F.Cu, pads 1(-0.9375,-0.95) 2(-0.9375,0.95) 3(0.9375,0), cursor readout: pad 2 (screen y 335) Y=-1.042, pad 1 (screen y 655) Y=-2.944

</details>

<details><summary>Q6-023 — KiCad footprints are stored Y-down in a Y-up board: every imported/core footprint is mirrored — confirmed in Gerber F.Cu (SOIC-8 pins numbered clockwise) and in the 3D view (S1, duplicate)</summary>

- Area library.import · stack B · design 3f9e4e24-dc31-4931-a8ed-f8cd6d1ec0f3 · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library → core 'NE555 Timer SOIC-8' (or imported OP07CD): footprint preview shows pad 1 bottom-left, pads 1→4 going UP the left side, 5 top-right, 8 bottom-right
  2. GET /api/modules/library/components/openpcb.core.ic.ne555-soic-8/detail → pads 1..4 at (-2.475, -1.905…+1.905), 5..8 at (+2.475, +1.905…-1.905) = KiCad's raw Y-down coordinates, no negation
  3. Open design '555 Timer LED Blinker' (3f9e4e24) → PCB: U1 shows pad 1 bottom-left with the silkscreen pin-1 triangle bottom-left ('Viewing Top')
  4. 3D tab → Top camera: the IC model's pin-1 dot is at the TOP-left of the body while the footprint's silk triangle is at the BOTTOM-left
  5. POST /api/modules/designer/designs/3f9e4e24…/exports/gerber → F_Cu.gbr: %TO.P,U1,1% X-5.575 Y-1.905, U1,4 Y+1.905, U1,5 X-0.625 Y+1.905, U1,8 Y-1.905 (Gerber is Y-up); F_Silkscreen pin-1 triangle at (-5.7,-2.47…-2.8)
- Expected: Datasheet/KiCad top view of SOIC-8: pin 1 top-left, pins numbered counter-clockwise (1-4 down the left, 5-8 up the right). Imported .kicad_mod geometry (Y-down) must be negated into OpenPCB's Y-up board space (the PnP writer documents board space as Cartesian Y-up with no flip), exactly as the in-house IPC generator already does (QA-q7 QFN-16 preset: pin 1 top-left, CCW).
- Actual: KiCad-derived footprints keep KiCad's Y-down coordinates, so in the Y-up board space and in the exported Gerber the land pattern is a vertical mirror image: SOIC-8 pins run clockwise from a bottom-left pin 1. A real IC placed on this copper has pins 1↔4, 2↔3, 5↔8, 6↔7 swapped; SOT-23 transistors get pins 1/2 swapped; polarised parts get their marks on the wrong side. The app itself exposes the contradiction: in 3D the (correctly-oriented) model's pin-1 dot sits over copper pad 4. IPC-generated/drawn footprints use the opposite (correct) convention, so a library mixes both handednesses. Same root cause as Q7-022 (reported S2 'needs PCB/Gerber verification') — this is that verification: the manufacturing output is affected, which makes it S1.
- Screenshots: [040-pcb-555](../evidence/shots/q6/light/040-pcb-555.png), [066-3d-555-top](../evidence/shots/q6/dark/066-3d-555-top.png), [066b-3d-u1-pin1-dot-vs-silk-triangle](../evidence/shots/q6/dark/066b-3d-u1-pin1-dot-vs-silk-triangle.png), [065-pcb-555-compare](../evidence/shots/q6/dark/065-pcb-555-compare.png), [067-op07cd-footprint-framing](../evidence/shots/q6/dark/067-op07cd-footprint-framing.png), [020-dead-upload-step-view](../evidence/shots/q6/light/020-dead-upload-step-view.png)
- Network: `GET /api/modules/library/components/openpcb.core.ic.ne555-soic-8/detail → pad1 centerMm {x:-2.475,y:-1.905}, pad5 {x:2.475,y:1.905}`; `GET …/components/3b59b251…(OP07CD)/detail → pad1 {x:-2.47,y:-1.905} (raw .kicad_mod value)`; `POST /api/modules/designer/designs/3f9e4e24-dc31-4931-a8ed-f8cd6d1ec0f3/exports/gerber → F_Cu: U1 p1 (-5.575,-1.905) p4 (-5.575,1.905) p5 (-0.625,1.905) p8 (-0.625,-1.905)`
- Code: `node_modules/@openpcb/kicad-import/dist/build-preview-models.js:121` — footprint geometry copied without y negation (per Q7-022)
- Code: `src/modules/designer/backend/export/pnp/writer.ts:19` — documents board space as Cartesian Y-up, no Y-flip at export
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:568` — 3D places Z-up models correctly, so model and copper disagree
- Suggested fix: Negate Y (and mirror arc sweep/pad & text rotation angles) when converting .kicad_mod into the normalized footprint in @openpcb/kicad-import, re-pack CoreLibrary footprints, and add a migration that flips already-imported KiCad-provenance footprints (and their placed instances' pad geometry). Add golden tests: SOIC-8 pin order CCW, SOT-23 pin 3 on top, CP_Elec '+' top-left; plus a Gerber regression test on a SOIC footprint.
- Verification (vq6): **duplicate** — Verified independently: POST /designs/3f9e4e24…/exports/gerber (stack B) → F_Cu.gbr (%MOMM, Y-up) U1 pads 1(-5.575,-1.905) 2(-5.575,-0.635) 3(-5.575,0.635) 4(-5.575,1.905) 5(-0.625,1.905) … 8(-0.625,-1.905): pins run clockwise viewed from the top on F.Cu, which no rotation can produce → mirrored land pattern in the manufacturing output. Library previews show the same (74HC00 pads 7/8 at the top; OP07CD pin 1 bottom-left with the model's pin-1 dot at the top). Same root cause and dedupeKey as Q7-022, which vq7 already confirmed at S1; this Gerber dump is additional evidence to attach there. · evidence: [010-detail-74hc00](../evidence/shots/vq6/dark/010-detail-74hc00.png), [015-op07cd-detail](../evidence/shots/vq6/dark/015-op07cd-detail.png), POST /api/modules/designer/designs/3f9e4e24-dc31-4931-a8ed-f8cd6d1ec0f3/exports/gerber → F_Cu U1 p1 X-5575000Y-1905000, p4 X-5575000Y1905000, p5 X-625000Y1905000, p8 X-625000Y-1905000

</details>

<details><summary>F2A-008 — Golden path ships a dead board: the core NE555 SOIC-8 lands mirrored (pin 1 GND bottom-left, pins counted clockwise), yet ERC/DRC are clean and the export gate says 'DRC passed' — VCC/GND end up on RST/CTRL pins (S1, duplicate)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark, light · viewports 1440x900
- Repro:
  1. Cmd+K → 'NE555 Timer SOIC-8' (Core) → place, wire a standard astable, PCB → route, pour, DRC (0 errors), Export… → Download ZIP
  2. Zoom U1 on PCB ([037-u1-zoom](../evidence/shots/f2a/dark/037-u1-zoom.png)): pad 1 bottom-left, 2-3-4 upward, 5 top-right, 8 bottom-right
  3. Open F_Cu.gbr / F_Silkscreen.gbr / PnP.csv from the ZIP
- Expected: Core-library footprints are placed with the correct (top-view, counter-clockwise) pin order; a DRC/export gate that says 'passed' produces an assemblable board.
- Actual: Extension of Q6-023 on the end-to-end flow: F_Cu flashes U1 pad 1 (GND) at (-2.475,-2.022) and pad 4 (VCC) at (-2.475,+1.788) around U1 at (0,-0.117); F_Silkscreen pin-1 triangle at (-2.6,-2.59)…(-2.84,-2.92) i.e. bottom-left; PnP 'U1,NE555,SOIC-8…,0.0000,-0.1170,270.00,Top'. A real NE555 (or JLC placing it at 270°) puts chip pin 1 where pad 4 is: GND↔~RST, TRIG↔OUT, CTRL↔VCC, THR↔DIS — the supply is shorted through the chip on power-up. Nothing in the flow warns: ERC 0, DRC 0 errors, export dialog 'DRC passed with 44 warning(s)'. The same applies to every KiCad-derived core footprint with asymmetric pinout (SOT-23, SOT-223, LED polarity).
- Screenshots: [037-u1-zoom](../evidence/shots/f2a/dark/037-u1-zoom.png), [082-export-dialog](../evidence/shots/f2a/dark/082-export-dialog.png)
- Network: `GET /projection/pcb ratsnest U1.4 at (-2.475, 3.897) / U1.2 at (-2.475, 1.357) with U1 at (1.15,1.992) → pad world = position + local (no Y flip)`
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/scene/footprint-render-layer.js:151` — pads rendered at (centerMm.x, centerMm.y) in the Y-up scene without negating KiCad's Y-down local y
- Suggested fix: See Q6-023: normalise KiCad-derived footprint geometry to Y-up once (negate local y, keep rotation sense) in @openpcb/kicad-import / core library pack, with a regression test asserting SOIC-8 pad 1 is top-left and pin order counter-clockwise in F_Cu.gbr; until then, block export of boards with KiCad-derived asymmetric footprints or warn in the export gate.
- Verification (vf2a): **duplicate** — Reproduced independently: in QA-vf2a-a the Core NE555 SOIC-8 at rotation 0 draws pad 1 bottom-left, then 2-3-4 upward, 5 top-right and 8 bottom-right (clockwise from the top; shot 016). POST /exports/gerber F_Cu flashes U1 pads in order: (-3.975,-1.905) (-3.975,-0.635) (-3.975,0.635) (-3.975,1.905) (0.975,1.905) (0.975,0.635) (0.975,-0.635) (0.975,-1.905), a mirrored land pattern. The SOIC-8 .fp.json is still Y-down in CoreLibrary beta.1, beta.2 and the current dev pack, so this is not a stack artefact. Same root cause and fix as Q7-022 (confirmed S1; Q6-023 is already merged there). The golden-path evidence (export gate 'DRC passed', PnP rot 270) should be attached to Q7-022. · evidence: [016-pcb-zoom](../evidence/shots/vf2a/dark/016-pcb-zoom.png), vf2a/export.json (QA-vf2a-a F_Cu flashes), f2a/export/*F_Cu.gbr

</details>


## T-318

**Footprint editor cannot place pads precisely: no X/Y fields, fixed 0.635 mm grid, no zoom-to-fit**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner L4b · wave W3 · scope frontend · estimate M
- Findings: Q7-015

**Summary.** Pad row has only #, Shape, W, H, Rot, Layer, Drill — no position. Grid is hard-coded 0.635 mm (setGridSizeMm has no UI), so metric pitches are unreachable except by free placement. No Fit/zoom buttons in either editor toolbar; after zooming in the pads were off-screen with no way back except blind wheel-out (054). Drill 2 mm on a 1.6 mm pad is accepted (only an amber 'Annular ring −0.20mm' note) and the pad renders…

**Root cause.** `src/modules/library/frontend/import-wizard/footprint-editor/PadPropertyPanel.tsx:110` — no positionMm inputs

**Proposed fix.** Pad X/Y inputs, grid-size select (presets), Zoom-to-fit (F), drill < pad validation. — Detail: Add X/Y (mm) inputs to PadRow (commitPatch positionMm), a grid-size select next to Grid in FootprintEditorToolbar/EditorToolbar, a 'Zoom to fit' button (+ F/Home key) using the canvas fit helper, and block drill ≥ min(W,H).

**Evidence.** [051-footprint-2pads](../evidence/shots/q7/dark/051-footprint-2pads.png), [022-footprint-2pads](../evidence/shots/vq7/dark/022-footprint-2pads.png)

<details><summary>Q7-015 — Footprint editor cannot place pads precisely: no X/Y fields, fixed 0.635 mm grid, no zoom-to-fit (S2, confirmed)</summary>

- Area library.footprint-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Footprints → Draw → D (Pad) → click twice
  2. Look at the Pads panel (right)
  3. Try to put pads at a 0.5/0.65/0.8/1.0 mm pitch; zoom in, then try to get back to the pads
- Expected: Pad properties include Position X/Y (mm), grid size selectable (0.05/0.1/0.25/0.5/1.27 mm…), and a Fit/Zoom-to-fit control (toolbar + key) like the designer toolbars.
- Actual: Pad row has only #, Shape, W, H, Rot, Layer, Drill — no position. Grid is hard-coded 0.635 mm (setGridSizeMm has no UI), so metric pitches are unreachable except by free placement. No Fit/zoom buttons in either editor toolbar; after zooming in the pads were off-screen with no way back except blind wheel-out (054). Drill 2 mm on a 1.6 mm pad is accepted (only an amber 'Annular ring −0.20mm' note) and the pad renders invisible. Default editor zoom (DEFAULT_PCB_ZOOM = 8 px/mm) renders a 1.6 mm pad as ~13 px, the pad number as a 1-px speck and the '1.60 × 1.60' dimension label ~5 px tall (unreadable) — every new footprint starts zoomed far out with no fit command.
- Screenshots: [051-footprint-2pads](../evidence/shots/q7/dark/051-footprint-2pads.png), [054-footprint-zoomed](../evidence/shots/q7/dark/054-footprint-zoomed.png), [059-pad-drill-oversize](../evidence/shots/q7/dark/059-pad-drill-oversize.png), [020-footprint-draw](../evidence/shots/q7/light/020-footprint-draw.png)
- Code: `src/modules/library/frontend/import-wizard/footprint-editor/PadPropertyPanel.tsx:110` — no positionMm inputs
- Code: `src/modules/library/frontend/import-wizard/footprint-editor/useFootprintEditorStore.ts:236` — gridSizeMm: 0.635 fixed
- Code: `src/modules/library/frontend/import-wizard/footprint-editor/FootprintEditorToolbar.tsx:1` — no fit/zoom controls
- Suggested fix: Add X/Y (mm) inputs to PadRow (commitPatch positionMm), a grid-size select next to Grid in FootprintEditorToolbar/EditorToolbar, a 'Zoom to fit' button (+ F/Home key) using the canvas fit helper, and block drill ≥ min(W,H).
- Verification (vq7): **confirmed** — Reproduced: pad rows expose #, Shape, W, H, Rot, Layer, Drill only (no X/Y); setGridSizeMm exists in both editor stores but no UI calls it (grid fixed 0.635 mm footprint / symbol default); no fit/zoom control in either editor toolbar; 1.6 mm pads render ~13 px at DEFAULT_PCB_ZOOM. Drill 2 mm on a 1.6 mm pad: only an amber 'Annular ring -0.20mm < 0.15mm minimum' note, layer silently becomes '*.Cu (TH)' and the pad disappears from the canvas. · evidence: [022-footprint-2pads](../evidence/shots/vq7/dark/022-footprint-2pads.png), [036-pad-drill-oversize](../evidence/shots/vq7/dark/036-pad-drill-oversize.png), [037-1100-footprint-draw](../evidence/shots/vq7/dark/037-1100-footprint-draw.png)

</details>


## T-319

**Preset size/density changes don't regenerate: UI shows SOT-323 + 'C (Least)' pressed while the footprint to be saved is still SOT-23 nominal**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner L4a · wave W3 · scope frontend · estimate S
- Findings: Q7-014

**Summary.** After generating SOT-23 B, clicking 'C (Least)' leaves tags 'ipc-nominal' and the preview unchanged; clicking the SOT-323 size card also leaves 'Generated Footprint: SOT-23, Pads 4'. Next stays enabled and would commit the stale footprint. Only a family change clears it (setPresetFamily). Next is also enabled in Preset mode before anything is generated (the part is then saved with no footprint).

**Root cause.** `src/modules/library/frontend/import-wizard/useImportWizardStore.ts:247` — setPresetSize / setPresetDensity (248) don't clear generatedFootprint; only setPresetFamily (245) does

**Proposed fix.** Regenerate footprint on preset size/density change; UI state = saved footprint. — Detail: Auto-generate on every family/size/density change (drop the Generate button) or clear generatedFootprint in setPresetDensity/setPresetSize; block Next (with hint) when footprintSource is preset/import/draw but nothing is generated/selected/drawn.

**Evidence.** [048-preset-stale](../evidence/shots/q7/dark/048-preset-stale.png), [020-preset-stale](../evidence/shots/vq7/dark/020-preset-stale.png)

<details><summary>Q7-014 — Preset size/density changes don't regenerate: UI shows SOT-323 + 'C (Least)' pressed while the footprint to be saved is still SOT-23 nominal (S3, confirmed)</summary>

- Area library.footprint-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Footprints → Preset → SOT → SOT-323 → Generate footprint (tags show ipc-nominal)
  2. Click density 'C (Least)'
  3. Observe Generated Footprint panel/tags; click Next
- Expected: Changing family/size/density regenerates (or clears) the generated footprint so preview and saved data match the pressed options.
- Actual: After generating SOT-23 B, clicking 'C (Least)' leaves tags 'ipc-nominal' and the preview unchanged; clicking the SOT-323 size card also leaves 'Generated Footprint: SOT-23, Pads 4'. Next stays enabled and would commit the stale footprint. Only a family change clears it (setPresetFamily). Next is also enabled in Preset mode before anything is generated (the part is then saved with no footprint).
- Screenshots: [048-preset-stale](../evidence/shots/q7/dark/048-preset-stale.png)
- Console: `eval: 'SOT-323 pads=4 tags=ipc-nominal pressed=SOT…,C (Least)High-density'`
- Code: `src/modules/library/frontend/import-wizard/useImportWizardStore.ts:247` — setPresetSize / setPresetDensity (248) don't clear generatedFootprint; only setPresetFamily (245) does
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:605` — canProceed ignores footprintSource==='preset' && !generatedFootprint
- Suggested fix: Auto-generate on every family/size/density change (drop the Generate button) or clear generatedFootprint in setPresetDensity/setPresetSize; block Next (with hint) when footprintSource is preset/import/draw but nothing is generated/selected/drawn.
- Verification (vq7): **confirmed** — Reproduced and broadened: size change is stale too (q7 only reported density). The details panel does show the stale name, so S3 kept. · evidence: [020-preset-stale](../evidence/shots/vq7/dark/020-preset-stale.png), eval: Generated 'SOT-23 … Pads 4 … ipc-nominal' with pressed=[SOT, C (Least)] and SOT-323 card selected, Next disabled=false

</details>


## T-320

**Footprint import: a second import replaces the first, variant naming inconsistent, garbled placeholder copy**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner L4a · wave W3 · scope frontend · estimate S
- Findings: Q7-029

**Summary.** Second import silently drops C_0603 (only CP_Elec remains). With both selected at once, variants read 'default ★' (C_0603) and 'CP_Elec_6.3x5.4_Nichicon'; CP_Elec 'Package code: default'. Right panel before import: 'No footprint selected. Import will use visible placeholder No footprint yet.' (two sentences run together). Every KiCad footprint shows a warning '3D model reference … was not found in the import payload…

**Root cause.** `src/modules/library/frontend/import-wizard/steps/FootprintStep.tsx:1` — setFootprintFiles replaces array; variant label from packageCode/default

**Proposed fix.** Multiple footprint imports append variants; consistent variant naming; fix placeholder copy. — Detail: Append on subsequent imports (dedupe by name) with per-file remove; label variants by footprint name with the package code as secondary text; fix the placeholder copy; soften the missing-3D warning to info with a pointer to the 3D Model step.

**Evidence.** [042-footprint-import-cpelec](../evidence/shots/q7/dark/042-footprint-import-cpelec.png), [033-fp-import-c0603](../evidence/shots/vq7/dark/033-fp-import-c0603.png)

<details><summary>Q7-029 — Footprint import: a second import replaces the first, variant naming inconsistent, garbled placeholder copy (S3, confirmed)</summary>

- Area library.footprint-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Footprints → Import .kicad_mod → C_0603 → then Import .kicad_mod again → CP_Elec
  2. Multi-select both files in one dialog
  3. Look at Package Variants and the empty-state text
- Expected: 'Add footprint…' appends variants (with remove ×); each variant labelled by its footprint name; clear empty-state sentence.
- Actual: Second import silently drops C_0603 (only CP_Elec remains). With both selected at once, variants read 'default ★' (C_0603) and 'CP_Elec_6.3x5.4_Nichicon'; CP_Elec 'Package code: default'. Right panel before import: 'No footprint selected. Import will use visible placeholder No footprint yet.' (two sentences run together). Every KiCad footprint shows a warning '3D model reference … was not found in the import payload' without saying it is harmless or how to attach one.
- Screenshots: [042-footprint-import-cpelec](../evidence/shots/q7/dark/042-footprint-import-cpelec.png), [044-footprint-variant2](../evidence/shots/q7/dark/044-footprint-variant2.png), [092-fp-import-empty-placeholder-copy](../evidence/shots/q7/dark/092-fp-import-empty-placeholder-copy.png)
- Code: `src/modules/library/frontend/import-wizard/steps/FootprintStep.tsx:1` — setFootprintFiles replaces array; variant label from packageCode/default
- Suggested fix: Append on subsequent imports (dedupe by name) with per-file remove; label variants by footprint name with the package code as secondary text; fix the placeholder copy; soften the missing-3D warning to info with a pointer to the 3D Model step.
- Verification (vq7): **confirmed** — Reproduced: importing C_0603 then CP_Elec via two picks leaves only CP_Elec (setFootprintFiles replaces the array, FootprintStep.tsx:166); CP_Elec variant labelled 'default ★' with 'Package code default'; every KiCad footprint shows the amber '3D model reference … was not found in the import payload' warning. Placeholder copy at FootprintStep.tsx:363 reads 'No footprint selected. Import will use visible placeholder No footprint yet.' (bold span, no punctuation). · evidence: [033-fp-import-c0603](../evidence/shots/vq7/dark/033-fp-import-c0603.png), [034-fp-import-cpelec](../evidence/shots/vq7/dark/034-fp-import-cpelec.png)

</details>

