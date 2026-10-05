# designer.schematic — QA findings

[← index](../README.md) · 34 triage entries · S1 2 · S2 9 · S3 16 · S4 6

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-091](#t-091) | S1 | GND/PWR port dropped onto a pin looks attached but is not connected: placement ignores the hit pin and uses the raw cursor position, so the port becomes its own net 22 µm away | F2A-002 | fix-now | D2 / W2 | frontend | S |
| [T-092](#t-092) | S1 | Placing a multi-unit IC (74HC00, LM358) stacks every unit on one origin — gate pins coincide and are auto-shorted (ERC: 4 outputs driven together) | Q3-015 | decide (DEC-SCH) | D2 / W2 | backend | L |
| [T-093](#t-093) | S2 | Schematic camera resets to 80 % at origin on every view round-trip; first open not fitted | F1B-035, Q3-004 | fix-now | D2 / W2 | frontend | S |
| [T-094](#t-094) | S2 | Schematic has no Cmd/Ctrl+Z undo or Cmd+Shift+Z / Ctrl+Y redo hotkeys (toolbar only) | Q3-005 | fix-now | D2 / W2 | frontend | S |
| [T-095](#t-095) | S2 | Grid snapping disabled in both editors: parts/wires land off-grid, stray 2 mm quantisation on drags/drops, µm jogs reject L-wires | Q3-007, Q3-008, F1C-007, F2A-001 | fix-now | G / G | frontend | L |
| [T-096](#t-096) | S2 | Multi-delete creates one undo step per entity (8–150 Undo clicks), slow, no confirmation | Q3-011, F1B-011 | decide (DEC-SCH) | D2 / W2 | backend | M |
| [T-097](#t-097) | S2 | Net label tool (L) cannot connect anything: places an un-named 'NET' text that only joins a wire at a nanometre-exact vertex, and same-named labels stay separate nets | Q3-013 | decide (DEC-SCH) | D2 / W2 | backend | M |
| [T-098](#t-098) | S2 | ERC shows green 'No ERC violations' for a schematic with unconnected pins and floating power/GND ports, portals and labels | Q3-014 | defer | followup / followup | backend | M |
| [T-099](#t-099) | S2 | Inspector 'Open in Library' lands on the Library list with an unrelated part (74HC00) previewed instead of the selected component | Q3-016 | fix-now | D1+L1 / W2 | frontend | XS |
| [T-100](#t-100) | S2 | Delete on a focused Outline row dispatches the delete twice and shows 'Revision conflict. Please retry after refresh.' after a successful delete | Q3-021 | fix-now | D2 / W2 | frontend | XS |
| [T-101](#t-101) | S2 | Schematic load failure leaves 'Loading schematic...' forever, raw 'Internal error' strip without retry, and an Outline that claims the design is empty | Q3-025 | fix-now | D1 / W2 | frontend | S |
| [T-102](#t-102) | S3 | Outline Parts 'REF' column leaves 24 px for the designator: every 4+ character refdes (R100, C101, LED1, SW10, TP1…) is cut to 'R1…'/'C1…' and reads as a different part | F1B-029 | fix-now | D2 / W2 | frontend | XS |
| [T-103](#t-103) | S3 | Unconnected pins shown as auto nets; schematic vs PCB net counts disagree (0 vs 4, 60 vs 353) | F1C-008, F1B-010 | fix-now | D2+D3 / W2 | frontend | S |
| [T-104](#t-104) | S3 | Place-component palette: Enter places whatever row happens to be under the resting mouse pointer, not the top result (typed 'conn' + Enter → 6-pin 'Pin Header 2x03' instead of the first match) | F2A-015 | fix-now | D2 / W2 | frontend | XS |
| [T-105](#t-105) | S3 | Symbol text rendering: '~{RST}' literal, pin names overprint ('CONTVCC'), labels inside bodies, fit ignores text | F2A-016, Q7-031, Q3-035 | defer | followup / followup | shared-package | M |
| [T-106](#t-106) | S3 | Junction dots are 0.2 mm — barely wider than the wire, so T-connections look identical to crossing wires | Q3-009 | fix-now | D2 / W2 | frontend | XS |
| [T-107](#t-107) | S3 | Rotate labels are inverted: 'Rotate 90° clockwise (R)' turns the part counter-clockwise (and Shift+R 'counter-clockwise' turns it clockwise) | Q3-010, Q7-034 | fix-now | D2 / W2 | frontend | XS |
| [T-108](#t-108) | S3 | Esc does not clear the schematic selection although the context menu advertises 'Clear selection · Esc' | Q3-012 | fix-now | D2 / W2 | frontend | XS |
| [T-109](#t-109) | S3 | Part inspector ships stubs: footprint-variant list is all disabled ('Per-instance override coming soon') and 'Replace component' is permanently disabled | Q3-017 | fix-now | D2 / W2 | frontend | S |
| [T-110](#t-110) | S3 | Inspector inputs have inconsistent keyboard semantics: Esc never reverts, Tolerance/X/Y ignore Enter differently from Value | Q3-018 | fix-now | D2 / W2 | frontend | S |
| [T-111](#t-111) | S3 | Multi-select batch Value skips unit parsing/normalisation and allows one value across mixed components | Q3-019 | fix-now | D2 / W2 | frontend | S |
| [T-112](#t-112) | S3 | Duplicate drops the copy 2.54 mm diagonal from the original; overlapping bounding boxes then make the copy unselectable by clicking | Q3-020 | fix-now | D2 / W2 | frontend | M |
| [T-113](#t-113) | S3 | Selected power/GND ports and net portals have no inspector, no status-bar entry, and ignore the R / Shift+R keys their menu advertises | Q3-022 | fix-now | D2 / W2 | frontend | M |
| [T-114](#t-114) | S3 | Place-component palette exposes internal metadata tags as filter chips ('kicad-footprint-id:capacitor_smd:c_020…', 'kicad-derived', 'imported-from-kicad', 'unknown', 'builtin', 'system') | Q3-027 | fix-now | D2 / W2 | frontend | S |
| [T-115](#t-115) | S3 | Schematic canvas background is blue-tinted in both themes (#f0f4fb light, #0e1116 dark) instead of the neutral surface tokens | Q3-029 | fix-now | D2 / W2 | frontend | XS |
| [T-116](#t-116) | S3 | Schematic canvas palette ignores the neutral redesign: violet selection (light) vs amber selection (dark) vs cyan UI --selection, violet net portals, slate-blue wires/labels | Q3-030 | defer | followup / followup | shared-package | S |
| [T-117](#t-117) | S3 | 'Fit schematic' cannot fit an imported KiCad sheet (zoom floor 20) — parts stay off-canvas; toolbar Zoom-out floor differs from wheel | Q5-023 | fix-now | D2 / W2 | frontend | XS |
| [T-393](#t-393) | S3 | Place-component palette symbol preview stays black (#131313) in light theme while the schematic canvas is light | Q3-031 | wont-fix | — / followup | frontend | XS |
| [T-118](#t-118) | S4 | Long Value / net-label text is drawn as one unbounded line across the whole schematic, ignored by 'Fit schematic', and a same-named net portal shows as a second identical net | F1B-030 | fix-now | D2 / W2 | frontend | S |
| [T-119](#t-119) | S4 | Place-component search ranks an imported KiCad 'Device:R' above the Core 'Resistor' for the query 'resistor' (Enter places the imported part) | F2A-022 | defer | L1 / followup | backend | XS |
| [T-120](#t-120) | S4 | Wheel zoom-out goes down to 1% where the whole schematic vanishes, while the −/+ buttons clamp at 10% | Q3-024 | defer | followup / followup | shared-package | S |
| [T-121](#t-121) | S4 | Console noise on every schematic session: Radix 'Missing Description for DialogContent' per palette open and THREE.Clock deprecation per canvas mount | Q3-028 | fix-now | D2 / W2 | frontend | XS |
| [T-122](#t-122) | S4 | Toolbar icon semantics: 'Zoom to selection' uses a '#' Frame glyph that reads as a grid toggle; GND uses a double-chevron | Q3-037 | fix-now | D2 / W2 | frontend | XS |
| [T-123](#t-123) | S4 | Small schematic feedback gaps: DNP parts look unchanged, 'View on PCB' does not frame the part, filtering all ERC severities shows a blank list, Outline header count mixes parts+nets+labels | Q3-038 | fix-now | D2 / W2 | frontend | S |

## T-091

**GND/PWR port dropped onto a pin looks attached but is not connected: placement ignores the hit pin and uses the raw cursor position, so the port becomes its own net 22 µm away**

- Severity **S1** · category data · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate S
- Findings: F2A-002

**Summary.** Port stored at (-35.090360, 11.980394) mm while R1.1 is at (-35.067663, 11.980394): net 'VCC' has pins=[] (floating) and R1.1 stays a single-pin net 'Net_11'. Nothing on screen distinguishes this from a connected port (no junction dot, no dangling marker). A user wiring a board with G/P ports gets a netlist with the rails missing — the PCB ratsnest/DRC/export then silently lack VCC/GND on those pins. Same mechanism…

**Root cause.** `src/modules/designer/frontend/components/SchematicCanvas.tsx:2319` — armedPrimitive branch dispatches place_gnd_port/place_pwr_port/place_net_portal with snappedWorldNm (grid off → raw cursor)

**Proposed fix.** When a GND/PWR port is dropped on a pin hit, anchor at the pin endpoint and connect; ghost shows the snapped pin. — Detail: In SchematicCanvas onPointerDown's armedPrimitive branch, use pin.worldPositionNm when hitPin() hits, else the projection of the cursor onto wireHit's segment, as positionNm; show the same pin-hover highlight in the port ghost preview; render an unconnected-anchor marker for ports whose anchor touches nothing; add the floating-port ERC rule from Q3-014.

**Evidence.** [021-vcc-port](../evidence/shots/f2a/dark/021-vcc-port.png), [009-pwr-picker](../evidence/shots/vf2a/dark/009-pwr-picker.png)

<details><summary>F2A-002 — GND/PWR port dropped onto a pin looks attached but is not connected: placement ignores the hit pin and uses the raw cursor position, so the port becomes its own net 22 µm away (S1, confirmed)</summary>

- Area designer.schematic · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2a-golden schematic, zoom 18%
  2. Press P → pick 'VCC' → click exactly on R1 pin 1's end dot
  3. Visually the VCC arrow stands on the pin (crop [021-vcc-port](../evidence/shots/f2a/dark/021-vcc-port.png))
  4. GET /projection/schematic → nets
- Expected: Dropping a power/GND port on a pin (or wire) snaps the port anchor onto that pin/wire and joins the net (as every EDA tool does); if it can't attach, the port should look visibly unattached.
- Actual: Port stored at (-35.090360, 11.980394) mm while R1.1 is at (-35.067663, 11.980394): net 'VCC' has pins=[] (floating) and R1.1 stays a single-pin net 'Net_11'. Nothing on screen distinguishes this from a connected port (no junction dot, no dangling marker). A user wiring a board with G/P ports gets a netlist with the rails missing — the PCB ratsnest/DRC/export then silently lack VCC/GND on those pins. Same mechanism applies to GND and net portals (same code path).
- Screenshots: [021-vcc-port](../evidence/shots/f2a/dark/021-vcc-port.png)
- Network: `POST commands place_pwr_port positionNm = raw cursor → rev 18; projection/schematic nets: VCC pins=[] ; Net_11 pins=['R1.1']`
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:2319` — armedPrimitive branch dispatches place_gnd_port/place_pwr_port/place_net_portal with snappedWorldNm (grid off → raw cursor)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:2242` — pin = hitPin(worldNm) and wireHit = hitWire(worldNm) are computed in the same onPointerDown but ignored by the primitive branch
- Suggested fix: In SchematicCanvas onPointerDown's armedPrimitive branch, use pin.worldPositionNm when hitPin() hits, else the projection of the cursor onto wireHit's segment, as positionNm; show the same pin-hover highlight in the port ghost preview; render an unconnected-anchor marker for ports whose anchor touches nothing; add the floating-port ERC rule from Q3-014.
- Verification (vf2a): **confirmed** — Reproduced on stack A, QA-vf2a-a (dark): P → 'VCC' → hover R1 pin 1 end dot (429,300) → click. Projection: VCC primitive at (-31.100000, 17.100000) mm, R1 pin 1 at (-31.080000, 17.100000) mm (20 µm apart). Net 'VCC' has pinIds [] and R1.pin-1 remains its own net 'Net_7'. On screen the VCC arrow sits on the pin; there is no junction dot or dangling marker, and the ghost preview never highlights the pin. Code confirms the raw cursor is used although hitPin/hitWire are computed. Kept at S1, deliberately above Q3-007/Q3-013 (S2): with snap off the raw cursor essentially never equals a pin coordinate, so every port dropped on a pin (the normal way to use GND/PWR ports) fails. It fails invisibly: ERC has no floating-port rule (Q3-014), the PCB just lacks the airwire and DRC stays clean. The result is a netlist and board missing supply connections. · evidence: [009-pwr-picker](../evidence/shots/vf2a/dark/009-pwr-picker.png), [010-vcc-hover-pin](../evidence/shots/vf2a/dark/010-vcc-hover-pin.png), [011-vcc-on-pin](../evidence/shots/vf2a/dark/011-vcc-on-pin.png), GET /projection/schematic: VCC pinIds=[]; Net_7 pinIds=['R1.pin-1']

</details>


## T-092

**Placing a multi-unit IC (74HC00, LM358) stacks every unit on one origin — gate pins coincide and are auto-shorted (ERC: 4 outputs driven together)**

- Severity **S1** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-SCH · owner D2 · wave W2 · scope backend · estimate L
- Findings: Q3-015

**Summary.** All 5 units are drawn at the same origin: pin numbers over-print ('12/4', '10/5', '8/3/6/11'), the power-unit body (solid black box) covers the gates and a stray full-circle arc crosses the symbol. Coincident pins are connected by the net builder: pins 1,4,9,12 share one position (-11.117, 1.826), 2,5,10,13 another, outputs 3,6,8,11 another → ERC immediately reports OUTPUT_OUTPUT_SHORT 'Net "Net_8" drives 4 output p…

**Root cause.** `src/modules/designer/backend/projection-world.ts:989` — pin.unit persisted but world positions ignore the unit (no per-unit placement)

**Proposed fix.** Backend: place units of multi-unit parts at offsets (or unit concept); preview filters units (see L3 entry). — Detail: Model units: place one unit per click (unit picker in palette/inspector, KiCad 'U1A…U1E'), store per-unit position/rotation, and exclude same-part/different-unit pins from coordinate unions. Short-term: lay units out side-by-side at placement (offset per unit) so pins never coincide, and hide multi-unit parts from the palette until supported.

**Evidence.** [047-erc-violations](../evidence/shots/q3/dark/047-erc-violations.png), [007-palette-nand](../evidence/shots/vq3/dark/007-palette-nand.png)

<details><summary>Q3-015 — Placing a multi-unit IC (74HC00, LM358) stacks every unit on one origin — gate pins coincide and are auto-shorted (ERC: 4 outputs driven together) (S1, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox (Schem): ⌘K → type 'nand' → Enter → click canvas to place '74HC00 Quad NAND SOIC-14'
  2. Zoom in on U1; open dock ERC → Run ERC
  3. GET …/projection/schematic and look at U1 pins
- Expected: Each gate (unit A–D) and the power unit is placed/placeable separately (KiCad-style unit selection) or at least drawn side-by-side; pins of different gates are never connected unless wired
- Actual: All 5 units are drawn at the same origin: pin numbers over-print ('12/4', '10/5', '8/3/6/11'), the power-unit body (solid black box) covers the gates and a stray full-circle arc crosses the symbol. Coincident pins are connected by the net builder: pins 1,4,9,12 share one position (-11.117, 1.826), 2,5,10,13 another, outputs 3,6,8,11 another → ERC immediately reports OUTPUT_OUTPUT_SHORT 'Net "Net_8" drives 4 output pins together (U1.3, U1.6, U1.8, U1.11)'. Individual gate pins cannot be clicked/wired. The palette preview shows the same stacked symbol for 74HC00 and LM358 Dual Op-Amp, so every multi-unit core part is affected and the wrong netlist propagates to PCB/BOM.
- Screenshots: [047-erc-violations](../evidence/shots/q3/dark/047-erc-violations.png), [048-74hc00-stacked-units](../evidence/shots/q3/dark/048-74hc00-stacked-units.png), [049-palette-74hc00-preview](../evidence/shots/q3/dark/049-palette-74hc00-preview.png), [050-palette-lm358-preview](../evidence/shots/q3/dark/050-palette-lm358-preview.png)
- Network: `U1 pins: 1/4/9/12 input @(-11116647,1826254); 2/5/10/13 @(-11116647,-3253746); 3/6/8/11 output @(4123353,-713746); unit 1..5 on the same origin`
- Code: `src/modules/designer/backend/projection-world.ts:989` — pin.unit persisted but world positions ignore the unit (no per-unit placement)
- Code: `src/modules/designer/backend/projection-world.ts:697` — coincident pin coordinates are unioned into one net
- Code: `src/modules/designer/backend/import/kicad-project/insert-schematic.ts:150` — importer already filters pins per unit — reuse for palette placement
- Suggested fix: Model units: place one unit per click (unit picker in palette/inspector, KiCad 'U1A…U1E'), store per-unit position/rotation, and exclude same-part/different-unit pins from coordinate unions. Short-term: lay units out side-by-side at placement (offset per unit) so pins never coincide, and hide multi-unit parts from the palette until supported.
- Verification (vq3): **confirmed** — Reproduced on QA-Q3-vq3-a: ⌘K 'nand' → 74HC00 → place. All units are drawn on one origin (over-printed pin numbers, the power-unit box covering the gates, a stray arc). The projection shows pins 1/4/9/12 on one net (Net_6), 2/5/10/13 on Net_5, and outputs 3/6/8/11 on Net_8, and ERC reports OUTPUT_OUTPUT_SHORT 'Net "Net_8" drives 4 output pins together (U1.3, U1.6, U1.8, U1.11)'. The inspector pin table lists the same shorted nets. Refutation: the KiCad project importer does handle units (backend/import/kicad-project/insert-schematic.ts:150-194); palette placement does not, and no code or doc marks multi-unit parts unsupported. S1 kept: placing core-library ICs (74HC00, LM358) silently corrupts the netlist that flows to PCB/BOM. Only output shorts are flagged; shorted inputs are not. · evidence: [007-palette-nand](../evidence/shots/vq3/dark/007-palette-nand.png), [008-74hc00-stacked-erc](../evidence/shots/vq3/dark/008-74hc00-stacked-erc.png), [018-gnd-selected](../evidence/shots/vq3/dark/018-gnd-selected.png)

</details>


## T-093

**Schematic camera resets to 80 % at origin on every view round-trip; first open not fitted**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate S
- Findings: F1B-035, Q3-004

**Summary.** Schematic: fit (10 %, cursor at 131.3, −85.8 mm) → after PCB round-trip 80 %, cursor at (−0.975, 0.525) — a giant close-up of R1 at the origin (shot 119/118). Wheel-zoomed 49 % at (0.66, −0.28) → 80 % at (−0.975, 0.525) again. Same after switching design tabs. PCB in the same round-trips: (−20.286, 6.713) before and after — restored. On a 150-part sheet the user has to re-find their place after every cross-check wit… | Also covers: Q3-004: First design opened after app load is not fitted — schematic shows a random 80% close-up…

**Root cause.** `src/modules/designer/frontend/Space.tsx:576` — onSchemViewportChange writes viewportRef 'schem:<id>' — fed by the fresh canvas's default camera on mount

**Proposed fix.** Persist schematic camera across view switches; fit on first open when no saved camera. — Detail: In SchematicCanvas ignore onViewportChange until initialViewport has been applied (or the auto-fit ran), mirroring whatever PcbCanvas does; add a Vitest/e2e that zooms, switches to PCB and back, and asserts the zoom/centre.

**Evidence.** [118-stress-erc](../evidence/shots/f1b/dark/118-stress-erc.png), [010-schem-fit-before](../evidence/shots/vf1b/dark/010-schem-fit-before.png), [006-schem-12v-open](../evidence/shots/q3/dark/006-schem-12v-open.png)

<details><summary>F1B-035 — Every Schem → PCB/3D/BOM/DRC → Schem round-trip resets the schematic camera to 80 % at the origin (zoom/pan lost); the PCB camera is restored correctly (S2, confirmed)</summary>

- Area designer.schematic · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. Open QA-f1b-stress → Schem, click Fit schematic (zoom 10 %) or wheel-zoom to 49 % somewhere
  2. Switch to PCB (or 3D/BOM/DRC, or another design tab) and back to Schem
  3. Read zoom % and the X/Y under a fixed cursor position (700,450)
- Expected: Each view restores its own camera (the Space keeps viewportRef 'schem:<id>' / 'pcb:<id>' for exactly this), as the PCB view does.
- Actual: Schematic: fit (10 %, cursor at 131.3, −85.8 mm) → after PCB round-trip 80 %, cursor at (−0.975, 0.525) — a giant close-up of R1 at the origin (shot 119/118). Wheel-zoomed 49 % at (0.66, −0.28) → 80 % at (−0.975, 0.525) again. Same after switching design tabs. PCB in the same round-trips: (−20.286, 6.713) before and after — restored. On a 150-part sheet the user has to re-find their place after every cross-check with the PCB. Probably the same default-camera write as Q3-004 (first open not fitted), here hit on every remount rather than only the first open.
- Screenshots: [118-stress-erc](../evidence/shots/f1b/dark/118-stress-erc.png), [119-schem-after-tab-roundtrip](../evidence/shots/f1b/dark/119-schem-after-tab-roundtrip.png), [100-stress-schem-refit](../evidence/shots/f1b/dark/100-stress-schem-refit.png)
- Console: `{fit:{z:10,c:[131.298,-85.800]}, afterPcbRoundtrip:{z:80,c:[-0.975,0.525]}, afterDesignTabRoundtrip:{z:80,c:[-0.975,0.525]}}`; `{pcbBefore:[-20.286,6.713], pcbAfter:[-20.286,6.713], schemBefore:{z:49,c:[0.659,-0.284]}, schemAfter:{z:80,c:[-0.975,0.525]}}`
- Code: `src/modules/designer/frontend/Space.tsx:576` — onSchemViewportChange writes viewportRef 'schem:<id>' — fed by the fresh canvas's default camera on mount
- Code: `src/modules/designer/frontend/Space.tsx:1203` — initialViewport read from viewportRef
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:899` — onViewportChange fires with the default zoom/position before initialViewport is applied
- Suggested fix: In SchematicCanvas ignore onViewportChange until initialViewport has been applied (or the auto-fit ran), mirroring whatever PcbCanvas does; add a Vitest/e2e that zooms, switches to PCB and back, and asserts the zoom/centre.
- Verification (vf1b): **confirmed** — Reproduced on QA-vf1b-stack60: Fit schematic gives zoom 10% with the cursor at (131.098, -25.800). After Schem -> PCB -> Schem it is 80% at (-0.975, 0.525), the default camera at the origin. Same root cause as verified Q3-004 (ViewportReporter's first useFrame at SchematicCanvas.tsx:889-900 writes the default camera into viewportRef via Space.tsx:572-580 before initialViewport/auto-fit applies). Q3-004's verifier saw it on first open and on Designer->Library->Designer. This finding shows it on every view switch inside a design, which is the most frequent action and a larger impact, so S2 stays. Fix once together with Q3-004: gate onViewportChange until the initial viewport or auto-fit is applied. · evidence: [010-schem-fit-before](../evidence/shots/vf1b/dark/010-schem-fit-before.png), [011-schem-after-pcb-roundtrip](../evidence/shots/vf1b/dark/011-schem-after-pcb-roundtrip.png), status: before {z:'10%',xy:[131.098,-25.800]} after {z:'80%',xy:[-0.975,0.525]}

</details>

<details><summary>Q3-004 — First design opened after app load is not fitted — schematic shows a random 80% close-up around the origin (S3, confirmed)</summary>

- Area designer.schematic · stack A · design 37099ba4 · themes dark, light · viewports 1440x900
- Repro:
  1. Reload the app (or fresh profile)
  2. Home → double-click 'S3 LLM Edge — additive v2' (or open '…12V params' from the Designer empty state)
  3. Look at the schematic canvas and status-bar zoom
  4. Variant: with sandbox + a newly created tab open, go Library (Browse library) → back to Designer → click the sandbox tab: it also shows the 80% origin close-up instead of its last/fit view
- Expected: Schematic auto-fits to content on first open (as it does for a second design opened later: zoom 11%, whole sheet visible)
- Actual: Canvas opens at zoom 80% centred on (0,0): only one giant symbol (D1 / R4) is visible, the rest of the sheet is off-screen; user must press Fit. Reproduced 3/3 times (both owned designs). Opening a design while another tab is already mounted fits correctly.
- Screenshots: [006-schem-12v-open](../evidence/shots/q3/dark/006-schem-12v-open.png), [014-additive-first-open-after-reload](../evidence/shots/q3/dark/014-additive-first-open-after-reload.png), [008-schem-additive-open](../evidence/shots/q3/dark/008-schem-additive-open.png), [066-footprint-variant-menu](../evidence/shots/q3/dark/066-footprint-variant-menu.png), [002-sandbox-first-open](../evidence/shots/q3/light/002-sandbox-first-open.png)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:889` — ViewportReporter reports the default camera on first frame
- Code: `src/modules/designer/frontend/Space.tsx:572` — onSchemViewportChange stores it as the design's saved viewport
- Code: `src/modules/designer/frontend/Space.tsx:1203` — initialViewport read from viewportRef at render time
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1175` — auto-fit prefers initialViewport over fitCamera()
- Suggested fix: Ignore ViewportReporter output until the auto-fit for the current designId has run (e.g. gate onViewportChange on lastAutoFittedDesignIdRef.current === projection.designId), or snapshot initialViewport once per design open (useState initializer / ref captured at tab activation) so a default-camera write can never masquerade as a saved viewport.
- Verification (vq3): **confirmed** — Reproduced twice. (1) Fresh light session: opening QA-Q3-sandbox from the empty state lands at zoom 80% on the origin, not fitted. (2) Dark: Designer → Library → Designer, and the active QA-Q3-vq3-a tab shows an 80% close-up of U1 at the origin. Root cause confirmed in code: ViewportReporter's useFrame (SchematicCanvas.tsx:889-900) reports the DEFAULT camera on its first frame (lastRef null) into Space's viewportRef (Space.tsx:572-580) before the projection arrives. The next render passes that entry as initialViewport (Space.tsx:1203-1207), and the auto-fit effect (SchematicCanvas.tsx:1175-1184) 'restores' it instead of calling fitCamera(). S3. · evidence: [002-sandbox-first-open](../evidence/shots/vq3/light/002-sandbox-first-open.png), [016-back-to-designer](../evidence/shots/vq3/dark/016-back-to-designer.png), [004-12v-first-open](../evidence/shots/vq3/dark/004-12v-first-open.png)

</details>


## T-094

**Schematic has no Cmd/Ctrl+Z undo or Cmd+Shift+Z / Ctrl+Y redo hotkeys (toolbar only)**

- Severity **S2** · category keyboard · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate S
- Findings: Q3-005 · known ref K17
- Depends on: ['T-002']

**Summary.** ⌘Z / Ctrl+Z / ⌘⇧Z / Ctrl+Y do nothing (backend revision stays 1 → 1, 2 → 2). Toolbar Undo (rev 1→2, part removed) and Redo (rev 2→3, part back) work. Undo/Redo tooltips carry no shortcut hint.

**Root cause.** `src/modules/designer/frontend/components/SchematicCanvas.tsx:1860` — keydown handler covers Esc/Del/R/L/G/P/H/C only — no z/y with modifiers

**Proposed fix.** Add Cmd/Ctrl+Z, Cmd+Shift+Z, Ctrl+Y to schematic keymap (shortcut guard). — Detail: In SchematicCanvas's window keydown (after the isEditableShortcutTarget guard) handle isUndoShortcut → actions.undo() and isRedoShortcut || (ctrlKey && key==='y') → actions.redo(), with preventDefault. Pass title='Undo (⌘Z)' / 'Redo (⇧⌘Z)' to the toolbar buttons.

**Evidence.** [016-back-to-designer](../evidence/shots/vq3/dark/016-back-to-designer.png)

<details><summary>Q3-005 — Schematic has no Cmd/Ctrl+Z undo or Cmd+Shift+Z / Ctrl+Y redo hotkeys (toolbar only) (S2, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark, light · viewports 1440x900
- Repro:
  1. Open QA-Q3-sandbox (Schem), place a Resistor (⌘K → Enter → click)
  2. Move pointer over canvas, press ⌘Z, then Ctrl+Z
  3. Click toolbar Undo; then press ⌘⇧Z and Ctrl+Y; then click toolbar Redo
- Expected: ⌘Z / Ctrl+Z undo and ⌘⇧Z / Ctrl+Y redo like the PCB editor and every EDA tool; toolbar tooltip shows the shortcut
- Actual: ⌘Z / Ctrl+Z / ⌘⇧Z / Ctrl+Y do nothing (backend revision stays 1 → 1, 2 → 2). Toolbar Undo (rev 1→2, part removed) and Redo (rev 2→3, part back) work. Undo/Redo tooltips carry no shortcut hint.
- Network: `GET projection/schematic rev 1 after ⌘Z and Ctrl+Z; rev 2 after toolbar Undo; rev 2 after ⌘⇧Z/Ctrl+Y; rev 3 after toolbar Redo`
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1860` — keydown handler covers Esc/Del/R/L/G/P/H/C only — no z/y with modifiers
- Code: `src/modules/designer/frontend/Space.tsx:660` — shell hotkeys handle ⌘K/⌘W only
- Code: `src/modules/designer/frontend/components/DesignerFloatingToolbar.tsx:70` — Undo/Redo buttons without hotkey prop
- Suggested fix: In SchematicCanvas's window keydown (after the isEditableShortcutTarget guard) handle isUndoShortcut → actions.undo() and isRedoShortcut || (ctrlKey && key==='y') → actions.redo(), with preventDefault. Pass title='Undo (⌘Z)' / 'Redo (⇧⌘Z)' to the toolbar buttons.
- Verification (vq3): **confirmed** — Reproduced on QA-Q3-vq3-a (pointer over canvas): ⌘Z and Ctrl+Z left the revision at 13. Toolbar Undo moved it to 14 and removed the last label. ⌘⇧Z and Ctrl+Y left it at 14, and toolbar Redo moved it to 15. Code: the schematic keydown handler (SchematicCanvas.tsx:1739ff) has no z/y branch, and Space.tsx handles only ⌘K/⌘W. The canvas package already exports isUndoShortcut/isRedoShortcut (node_modules/@openpcb/r3f-eda-canvas/dist/utils/keyboard-shortcuts.js:11-16), unused here. The toolbar Undo/Redo buttons (DesignerFloatingToolbar.tsx:69-80) have no hotkey title. K17 confirmed. S2 kept: the most basic editor hotkey is missing, and the toolbar is the only workaround. · evidence: [016-back-to-designer](../evidence/shots/vq3/dark/016-back-to-designer.png)

</details>


## T-095

**Grid snapping disabled in both editors: parts/wires land off-grid, stray 2 mm quantisation on drags/drops, µm jogs reject L-wires**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner G · wave G · scope frontend · estimate L
- Findings: Q3-007, Q3-008, F1C-007, F2A-001 · known ref K44,N1,N2

**Summary.** No grid is rendered; placement, drag and wire corners are unsnapped. Pin endpoints become e.g. -16.13 / -5.97 mm; the corner at X=18.75 next to pin X=18.76 produced a stored 0.01 mm jog segment [(18.75,-12.9),(18.76,-12.9)] that survives later drags. Aligning two parts by eye is effectively impossible. The shared constant is also 2 mm, which does not match the 2.54 mm pin pitch of the built-in symbols (pins at ±5.08… | Also covers: Q3-008: Wire-segment drag snaps its shift to 2 mm while everything else is free — dragged wires s…; F1C-007: Drag-dropped parts snap to the 2 mm grid while palette placement lands off-grid (latent:…; F2A-001: Ordinary L-shaped wire from a pin to an existing wire is rejected with 'wire path doubles…

**Root cause.** `src/modules/designer/frontend/Space.tsx:1166` — gridVisible={false} hard-coded for SchematicCanvas (and PcbCanvas at :1405)

**Proposed fix.** Real snap toggle default ON: schematic 1.27 mm, PCB 0.25 mm + presets; draw grid; Shift+S toggle, N/Shift+N PCB presets, status-bar grid dropdown; segment drag + drops use the same snap; collapse sub-tolerance wire jogs; backend autoplace/assistant/routing constants -> 1.27 mm (approved). — Detail: Expose a schematic grid toggle (e.g. toolbar + Shift+G / status-bar chip) defaulting ON, render the grid dots, and snap placement/drag/wire corners through snapNm. Change the schematic grid to 1.27 mm (50 mil) in @openpcb/rendering-core so built-in symbol pins (2.54 mm pitch) land on grid.

**Note.** Approved backend: schematic grid constants 1.27 mm. Do not edit @openpcb/rendering-core/r3f-eda-canvas grid defaults — pass grid size from the app; package default change is a follow-up.

**Evidence.** [023-wires-done](../evidence/shots/q3/dark/023-wires-done.png), [014-labels-placed](../evidence/shots/vq3/dark/014-labels-placed.png), [029-wire-seg-drag-live](../evidence/shots/q3/dark/029-wire-seg-drag-live.png)

<details><summary>Q3-007 — Schematic has no grid and no snapping: parts, wires and corners land at arbitrary sub-mm coordinates, creating 10 µm wire jogs (S2, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark, light · viewports 1440x900
- Repro:
  1. Open QA-Q3-sandbox (Schem) — no grid dots/lines are drawn at any zoom
  2. ⌘K → Resistor → Enter → click canvas: part stored at (-11.050, 7.100) mm; drag it: stored at (-10.640498, -18.701277) mm
  3. Wire R2.2 → click empty space for a corner near D1.2's X → click D1.2
  4. Light theme: select R10 and press Shift+R — the rubber-banded wire from R10.2 now runs at y=-23.781 straight through the GND port stem (GND pin at y=-23.373): visually connected, electrically not (GND net has 0 pins/wires), and R10's refdes and value text collide ('1kR10')
- Expected: A visible schematic grid (KiCad default 50 mil / 1.27 mm) with parts, pins, wire corners snapping to it so pins align and wires are clean
- Actual: No grid is rendered; placement, drag and wire corners are unsnapped. Pin endpoints become e.g. -16.13 / -5.97 mm; the corner at X=18.75 next to pin X=18.76 produced a stored 0.01 mm jog segment [(18.75,-12.9),(18.76,-12.9)] that survives later drags. Aligning two parts by eye is effectively impossible. The shared constant is also 2 mm, which does not match the 2.54 mm pin pitch of the built-in symbols (pins at ±5.08 mm), so even enabling it would put pins off-grid.
- Screenshots: [023-wires-done](../evidence/shots/q3/dark/023-wires-done.png), [028-drag-part-done](../evidence/shots/q3/dark/028-drag-part-done.png), [013-shift-r](../evidence/shots/q3/light/013-shift-r.png)
- Network: `GET …/e77715d2…/projection/schematic: R2 positionNm {x:-10640498,y:-18701277}; WIRE cb214431 points (18.75,-12.9)->(18.76,-12.9)`; `W [(-10.64,-23.781),(18.75,-23.781),...] vs P gnd {x:3669636,y:-23372852}; GND net pins []`
- Code: `src/modules/designer/frontend/Space.tsx:1166` — gridVisible={false} hard-coded for SchematicCanvas (and PcbCanvas at :1405)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:307` — snapNm() is a no-op when grid disabled
- Code: `node_modules/@openpcb/rendering-core/dist/constants.js:14` — SCHEMATIC_GRID_MM = 2 (not 1.27/2.54)
- Suggested fix: Expose a schematic grid toggle (e.g. toolbar + Shift+G / status-bar chip) defaulting ON, render the grid dots, and snap placement/drag/wire corners through snapNm. Change the schematic grid to 1.27 mm (50 mil) in @openpcb/rendering-core so built-in symbol pins (2.54 mm pitch) land on grid.
- Verification (vq3): **confirmed** — Confirmed. No grid is drawn at any zoom. Stored coordinates are unsnapped: R1 is at (-16.972910, 11.775114) mm. Wire 8b0f1a90 in QA-Q3-vq3-a contains a 44 µm jog (-16.973,-11.6)→(-16.973,-11.556), and an accidental U1 drag moved it by exactly 2.553 mm with no snap. Code: gridVisible={false} is hard-coded at Space.tsx:1166 and :1405, snapNm is a no-op when the grid is off (SchematicCanvas.tsx:307-312), and SCHEMATIC_GRID_MM = 2 (node_modules/@openpcb/rendering-core/dist/constants.js:14). Refutation: PLAN Run 2 records 'grid snapping is off in both editors … add a real snap toggle' as a follow-up, so this is a deferred gap, not a design decision. K44 confirmed. S2 kept because it produces wires that look connected but are electrically open (q3's GND stem case) and makes alignment impractical. · evidence: [014-labels-placed](../evidence/shots/vq3/dark/014-labels-placed.png), [030-wire-drag-grabs-u1-bbox](../evidence/shots/vq3/dark/030-wire-drag-grabs-u1-bbox.png), [003-sandbox-fit](../evidence/shots/vq3/light/003-sandbox-fit.png)

</details>

<details><summary>Q3-008 — Wire-segment drag snaps its shift to 2 mm while everything else is free — dragged wires stay off-grid and create collinear overlaps (S3, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. In QA-Q3-sandbox, draw a wire whose horizontal segment sits at Y=-2.9 mm and T's into another wire
  2. Drag that horizontal segment ~4.9 mm downward and release
- Expected: Segment follows the pointer (snap off) or snaps to an absolute grid; attached T-connection moves to the new corner without leaving overlapping wire
- Actual: Shift was quantised to exactly 4.000 mm (-2.9 → -6.9), i.e. relative 2 mm snapping, so the segment is still off-grid. The wire now has a new vertical leg (18.76,-6.9)->(18.76,-2.9) lying on top of the existing vertical wire cb214431 — two collinear overlapping wires plus a stale junction at (18.76,-2.9).
- Screenshots: [029-wire-seg-drag-live](../evidence/shots/q3/dark/029-wire-seg-drag-live.png), [030-wire-seg-drag-done](../evidence/shots/q3/dark/030-wire-seg-drag-done.png)
- Network: `WIRE 1ec9fc9e after drag: [(-16.13,7.1),(-16.15,7.1),(-16.15,-6.9),(18.76,-6.9),(18.76,-2.9)] vs WIRE cb214431 [...,(18.76,-12.9),(18.76,-2.9)]`
- Code: `src/shared/schematic-routing/segment-drag.ts:91` — snapToGrid(delta, SCHEMATIC_GRID_NM) unconditionally
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1993` — dragWireSegment called for live preview and commit (:2027)
- Suggested fix: Pass the canvas snap state into dragWireSegment (gridNm=0 when snap is off) or snap the absolute segment coordinate, and after a segment drag merge collinear overlap / re-home the T-junction to the new intersection.
- Verification (vq3): **confirmed** — Code-confirmed. Both the live preview (SchematicCanvas.tsx:1993-1997) and the commit (SchematicCanvas.tsx:2027-2031) call dragWireSegment(basePoints, segmentIndex, delta) without gridNm. The default parameter is SCHEMATIC_GRID_NM (segment-drag.ts:80), and the shift is quantised with snapToGrid (segment-drag.ts:89-92), a relative 2 mm step, while every other schematic operation is unsnapped. My live repro on QA-Q3-vq3-a grabbed U1 instead of the wire because U1's oversized bbox covers the whole wire (see Q3-020), so the quantisation evidence is q3's network capture (−2.9 → −6.9 mm = exactly 4.000 mm). Not a duplicate of Q3-007: different code path (forced relative snap versus no snap) and a separate fix. N1 confirmed. S3. · evidence: [030-wire-drag-grabs-u1-bbox](../evidence/shots/vq3/dark/030-wire-drag-grabs-u1-bbox.png), [029-wire-seg-drag-live](../evidence/shots/q3/dark/029-wire-seg-drag-live.png), [030-wire-seg-drag-done](../evidence/shots/q3/dark/030-wire-seg-drag-done.png)

</details>

<details><summary>F1C-007 — Drag-dropped parts snap to the 2 mm grid while palette placement lands off-grid (latent: the drop path is unreachable, see F1C-006) (S4, confirmed)</summary>

- Area designer.schematic · stack B · design 7c22a0f9-faf8-4d2d-9da7-95c117eac147 · themes dark · viewports 1440x900
- Repro:
  1. Stack B, QA-f1c-drop, Schem
  2. Place 'QA-f1c pack LED' and 'QA-f1c pack Resistor' with the Components palette (click on the canvas)
  3. Place core Resistor and Capacitor with synthetic designer-MIME DragEvents (F1C-006 step 2)
  4. GET /designs/{id}/projection/schematic
- Expected: Every placement path follows the same grid policy (snap is currently 'off' per K44).
- Actual: Palette placements: D1 (-8.000, 1.100) mm and R1 (7.000, 1.100) mm, both off the 2 mm grid (x mod 2 mm = 1.0 for R1, y mod 2 mm = 1.1). Dropped parts: R2 (0, -4.000) and C1 (-4.000, -8.000), exactly on 2 mm. The EdaCanvas drop overlay gets gridSize=SCHEMATIC_GRID_NM and snaps snappedPoint even though snap() is a no-op with gridVisible=false.
- Screenshots: [023-dnd-drop-not-ready](../evidence/shots/f1c/dark/023-dnd-drop-not-ready.png)
- Network: `projection parts: D1 {-8000000,1100000}, R1 {7000000,1100000}, R2 {0,-4000000}, C1 {-4000000,-8000000}`
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:3270` — gridSize={SCHEMATIC_GRID_NM} passed to EdaCanvas
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/interaction/DragDropOverlay.js:35` — snappedPoint = snapPointToGridNm(worldPoint, gridSize)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:307` — snapNm is a no-op when grid disabled
- Suggested fix: Decide the grid policy (K44) once. Until then, use event.worldPoint rather than event.snappedPoint in onDragEnter/onDragOver/onDrop, or pass gridSize={gridVisible ? SCHEMATIC_GRID_NM : 0} to EdaCanvas.
- Verification (vf1c): **confirmed** — Reproduced with synthetic readable DataTransfer drops (designer MIME, 2.5 s dwell) at two arbitrary screen points. The parts were placed at L1 (0, 0) and L2 (4.000, 2.000) mm, exactly on the 2 mm grid. Palette placements in the same design sit at D1 (-8.000, 1.100) and R1 (7.000, 1.100), off-grid. Code: SchematicCanvas passes gridSize={SCHEMATIC_GRID_NM} to EdaCanvas (:3270). DragDropOverlay computes snappedPoint = snapPointToGridNm(worldPoint, gridSize), and the handlers use event.snappedPoint while snap() is a no-op with the grid off. Latent only, because the drop path is unreachable (F1C-006). This is a different code path from N1 (Q3-008, wire drag), with the same K44 grid-policy question. Both test parts were removed with toolbar Undo x2 (design back to 5 parts, rev 11). S4 kept. · evidence: [012-synthetic-drops-snapped-2mm](../evidence/shots/vf1c/dark/012-synthetic-drops-snapped-2mm.png), projection after drops: L1 {0,0}, L2 {4000000,2000000}; palette parts D1 {-8000000,1100000}, R1 {7000000,1100000}

</details>

<details><summary>F2A-001 — Ordinary L-shaped wire from a pin to an existing wire is rejected with 'wire path doubles back along its own segment' because the off-grid corner click lands a few µm off the pin row; the error strip then shifts the canvas 12 px and the wire tool stays armed (S2, confirmed)</summary>

- Area designer.schematic · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2a-golden schematic at zoom 18% (after Fit + 7× Zoom out)
  2. Click U1 pin 2 (TRIG), click empty space ~4 mm left of the pin (same row as the pin) to add a corner, then click the THR wire above it to T into it
  3. Observe the red strip above the toolbar; press the same gesture again → same rejection (3/3 attempts)
  4. Instead click the pin and then the wire directly with no corner → accepted (rev 14)
- Expected: A corner clicked visually on the pin's row produces a clean L-wire; tiny off-axis deltas (sub-pixel, <0.05 mm) are absorbed/snapped by the client, and any rejection is phrased for users and doesn't move the canvas.
- Actual: The client builds pointsNm [pin(-11.160,-3.305), (-15.114,-3.305), (-15.114,-3.3277), (-15.114,-0.722)]: a 22.7 µm downward jog followed by the upward leg. Backend returns {ok:false, code:INVALID_WIRE_PATH, detail:'wire path doubles back along its own segment'} and the UI prints the raw detail in a full-width danger strip inserted above the toolbar (no dismiss). Inserting/removing the strip shrinks the canvas by 24 px and re-centres it, so the whole drawing jumps 12 px under the cursor mid-gesture; my next clicks (planned in the old frame) landed 12 px off and got appended to a still-armed in-progress wire (request 875 contains 8 points incl. unintended corners). The strip only disappears after a later successful command. A user sees a correct-looking L that 'doesn't work' with a geometry error they can't act on. (The layout-shifting, non-dismissable strip itself is the same mechanism as F1A-010/F1B-012; the new part is that an ordinary cornered wire triggers it: 2 of my 3 first cornered wires were rejected — TRIG→THR wire and J1.1→U1.8 VCC wire, request 2 carried pointsNm [(29.964584,20.014428),(1.497065,20.014428),(1.540000,20.014428),(1.540000,11.935000)] → +43 µm reversal.)
- Screenshots: [014-wires](../evidence/shots/f2a/dark/014-wires.png), [015-after-esc](../evidence/shots/f2a/dark/015-after-esc.png), [016-trig-retry](../evidence/shots/f2a/dark/016-trig-retry.png)
- Network: `POST /designs/847e94e7…/commands create_wire_junction pointsNm [(-11160000,-3305000),(-15113843,-3305000),(-15113843,-3327697),(-15113843,-722065)] → {ok:false,code:INVALID_WIRE_PATH,detail:'wire path`; `req 875: same in-progress wire extended with 4 unintended corners after the 12 px layout shift → rejected again`
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1708` — commitWireToPin/commitWireToWireJunction feed the raw, unsnapped corner click into buildManhattanPathThroughAnchors, which emits pin→(cx,py)→(cx,cy): a µm jog whenever the click is a sub-pixel off the pin row
- Code: `src/modules/designer/backend/commands/create-wire.ts:33` — normalizeWirePath keeps a caller path verbatim when it is Manhattan, so the jog survives into validateWirePath
- Code: `src/modules/designer/backend/commands/create-wire.ts:69` — collinear-reversal check rejects the jog followed by the opposite-direction leg: 'wire path doubles back along its own segment'
- Code: `src/modules/designer/frontend/Space.tsx:1303` — error strip rendered in-flow above the toolbar (layout shift, no dismiss) — same mechanism as F1A-010/F1B-012
- Suggested fix: Backend (covers AI/import callers too): in normalizeWirePath, before validateWirePath, merge consecutive collinear segments and drop any segment shorter than a pick tolerance (e.g. 50 µm) by snapping that corner onto the previous segment's axis. Client: in SchematicCanvas, when a waypoint is within the pick tolerance of the source pin's X or Y, snap it onto that axis before building pointsNm. Show wire rejections as a non-layout-shifting notice with user copy and cancel/keep the wire tool consistently (F1A-010 fix).
- Verification (vf2a): **confirmed** — Reproduced on stack A in my own design QA-vf2a-a (fc48af2a), dark, 1440x900, schematic zoom 25% after a wheel zoom (non-aligned camera). Target wire U1.4→R1.2 drawn first; then click U1.2 TRIG (594,519) → corner at (545,519) → click the wire above at (545,389). Request 796 create_wire_junction pointsNm [(-14.160000,-2.980000),(-18.025991,-2.980000),(-18.025991,-3.015462),(-18.025991,7.180000)] → {ok:false, code:INVALID_WIRE_PATH, detail:'wire path doubles back along its own segment'}: a 35.5 µm downward jog followed by the upward leg. The red strip appeared above the toolbar, the canvas box moved top 64→88 (height 814→790, so the drawing shifts 12 px) and the wire tool stayed armed ('Click a pin or wire to connect … Esc cancel'). Not intentional (no PLAN decision); root is the unsnapped schematic (Q3-007/K44) but the outright rejection of an ordinary cornered wire is a distinct, core-flow symptom with its own fix, so kept separate. S2: wiring fails for roughly every other cornered wire; workaround = click pin→target without corners. · evidence: [012-target-wire](../evidence/shots/vf2a/dark/012-target-wire.png), [013-zoomed](../evidence/shots/vf2a/dark/013-zoomed.png), [014-cornered-wire-rejected](../evidence/shots/vf2a/dark/014-cornered-wire-rejected.png), POST /designs/fc48af2a…/commands req 796 → INVALID_WIRE_PATH

</details>


## T-096

**Multi-delete creates one undo step per entity (8–150 Undo clicks), slow, no confirmation**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **decide** · decision DEC-SCH · owner D2 · wave W2 · scope backend · estimate M
- Findings: Q3-011, F1B-011

**Summary.** First Undo restores only 1 entity; entity counts after successive Undo clicks: 1,2,3,4,5,7,9,12 — eight Undo clicks to get the design back. A user who presses Undo once believes the rest is lost. Every intermediate state is also a persisted revision. | Also covers: F1B-011: 'Delete all 150' deletes one part per request over ~8 s with no confirmation, and needs 1…

**Root cause.** `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:559` — dispatchCommandsBatch loops dispatchEnvelope() per command — each is its own history entry

**Proposed fix.** Backend composite command (one undo entry) for multi-delete/rotate/align; frontend confirm for large deletes now. — Detail: Add a composite/batch command (or a history group id on the envelope) so the backend records a batch as one undoable entry; route delete/rotate/align batches through it.

**Evidence.** [040-cmd-a](../evidence/shots/q3/dark/040-cmd-a.png), [016-back-to-designer](../evidence/shots/vq3/dark/016-back-to-designer.png), [006-stress-schem-selectall](../evidence/shots/f1b/dark/006-stress-schem-selectall.png)

<details><summary>Q3-011 — Deleting a multi-selection creates one undo step per entity — one Delete needs 8 Undo clicks to restore (S2, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. In QA-Q3-sandbox (3 parts, 4 wires, GND/+5V/SDA ports, 1 net label) press ⌘A then Delete
  2. Revision goes 16 → 24; canvas empty
  3. Click toolbar Undo once
- Expected: One user action = one undo step: a single Undo restores the whole deleted selection (same for multi-part rotate via R)
- Actual: First Undo restores only 1 entity; entity counts after successive Undo clicks: 1,2,3,4,5,7,9,12 — eight Undo clicks to get the design back. A user who presses Undo once believes the rest is lost. Every intermediate state is also a persisted revision.
- Screenshots: [040-cmd-a](../evidence/shots/q3/dark/040-cmd-a.png), [041-after-delete-all](../evidence/shots/q3/dark/041-after-delete-all.png)
- Network: `projection revision 16 → 24 after one Delete; 24 → 32 after eight toolbar Undos`
- Code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:559` — dispatchCommandsBatch loops dispatchEnvelope() per command — each is its own history entry
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1850` — Delete uses dispatchCommandsBatch; R rotate of several parts too (:1890)
- Suggested fix: Add a composite/batch command (or a history group id on the envelope) so the backend records a batch as one undoable entry; route delete/rotate/align batches through it.
- Verification (vq3): **confirmed** — Reproduced on QA-Q3-vq3-a (2 parts, 1 wire, 2 labels, 1 GND port). ⌘A then Delete moved the revision 17 → 22, five separate commands. One toolbar Undo restored only the GND port. Entity counts after each Undo were 1, 2, 3, 4, 6, so five Undo clicks were needed. Code: dispatchCommandsBatch (useDesignerWorkspace.ts:559-567) sends one envelope per command, and each becomes its own history entry. S2 kept: one user action is not one undo step, and a single Undo looks like data loss. · evidence: [016-back-to-designer](../evidence/shots/vq3/dark/016-back-to-designer.png)

</details>

<details><summary>F1B-011 — 'Delete all 150' deletes one part per request over ~8 s with no confirmation, and needs 150 Undo clicks (≈17 s) to restore (S2, duplicate)</summary>

- Area designer.schematic · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. Open QA-f1b-stress (150 parts, 60 wires) → Schematic
  2. Cmd+A (inspector: '150 parts · Delete all 150')
  3. Click 'Delete all 150'
  4. Click Undo until it disables
- Expected: A bulk delete is one command (one revision, one undo step), completes in well under a second, and a 150-item destructive action asks for confirmation or at least offers an 'Undo' toast.
- Actual: No confirmation. The UI dispatches 150 sequential delete_entity commands: after 3 s the inspector still showed '122 parts', parts vanish one by one for ≈8 s while the canvas stays interactive (fps 47). History: undoDepth 150, revision 210 → 362. Restoring took 151 Undo clicks and 17.1 s (schematic has no Cmd+Z, K17). Same root cause as Q3-011 (non-atomic batch), here quantified at scale.
- Screenshots: [006-stress-schem-selectall](../evidence/shots/f1b/dark/006-stress-schem-selectall.png), [008-after-delete-all](../evidence/shots/f1b/dark/008-after-delete-all.png), [009-after-delete-all-done](../evidence/shots/f1b/dark/009-after-delete-all-done.png)
- Network: `GET /history?sessionId=designer-ui-session → undoDepth 28 (t+3 s) → 119 → 150`
- Code: `src/modules/designer/frontend/components/SelectionInspector/MultiPartInspectorPanel.tsx:45` — deleteAll awaits dispatchCommand(delete_entity) in a for-loop, one envelope per part
- Suggested fix: Add a batch delete command (delete_entities with ids[]) that plans all patches in one envelope → one revision and one inverse; confirm deletes above a threshold (e.g. >10 items) with the kit dialog or show an Undo toast.
- Verification (vf1b): **duplicate** — Reproduced on QA-vf1b-stack60: Cmd+A -> 'Delete all 60' -> no confirmation (dialog spy 0). Parts vanished one by one (after 2 s the inspector still read '30 parts'; finished after ~3 s), and history went to undoDepth 60. Same root cause as verified Q3-011 (S2, a multi-delete is N envelopes / N undo entries). This finding adds a second call site: MultiPartInspectorPanel.tsx:45 deleteAll awaits dispatchCommand per part, so each delete also refreshes the projection, which is why it is slow. Fold into Q3-011: route deleteAll through the same batch command, and add the scale data and the missing confirmation for large deletes. · evidence: [025-nothing-to-undo-strip](../evidence/shots/vf1b/dark/025-nothing-to-undo-strip.png), GET /history -> undoDepth 60 after one 'Delete all 60' click

</details>


## T-097

**Net label tool (L) cannot connect anything: places an un-named 'NET' text that only joins a wire at a nanometre-exact vertex, and same-named labels stay separate nets**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-SCH · owner D2 · wave W2 · scope backend · estimate M
- Findings: Q3-013

**Summary.** Labels are free-floating text: the wire keeps its auto name Net_2, two 'NET' labels produce two distinct nets with the same name, and the label text is drawn centred ON the wire (reads as struck-through 'N̶E̶T̶'). Net labels are only connected when their anchor equals a wire VERTEX to the nanometre, which is unreachable by clicking with snapping disabled. ERC reports nothing. The outline empty-state button 'Add net…

**Root cause.** `src/modules/designer/frontend/components/SchematicCanvas.tsx:1907` — L arms label text labelDraftText || 'NET' without a prompt

**Proposed fix.** Frontend: L gets name picker + ghost + snap anchor to wire/pin; backend: labels join wires at segment interior and same-name labels merge nets. — Detail: Give L a name picker like H (LabelPicker), render a ghost, snap the label anchor to the nearest wire segment/pin within a few px, and in deriveNetsAndJunctions treat label points like pins (segment-interior T-touch) and merge same-text labels in the named-net union. Rename the outline button to 'Add net portal' or make it arm L.

**Evidence.** [038-label-placed](../evidence/shots/q3/dark/038-label-placed.png), [013-label-armed](../evidence/shots/vq3/dark/013-label-armed.png)

<details><summary>Q3-013 — Net label tool (L) cannot connect anything: places an un-named 'NET' text that only joins a wire at a nanometre-exact vertex, and same-named labels stay separate nets (S2, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark, light · viewports 1440x900
- Repro:
  1. In QA-Q3-sandbox press L (no name prompt, no ghost preview), click empty canvas → label 'NET' at (0.052,-0.168)
  2. Press L again and click exactly on the R1–D1 wire → label 'NET' stored at y=7.0668 while the wire is at y=7.1
  3. GET projection/schematic → nets: [..., 'Net_2' (the wire, unchanged), 'NET' (0 wires), 'NET' (0 wires)]
  4. Run ERC
- Expected: L asks for (or offers) a net name, previews the label, snaps its anchor to the wire/pin under the cursor, names that net, and labels with the same text join into one net (KiCad local-label semantics)
- Actual: Labels are free-floating text: the wire keeps its auto name Net_2, two 'NET' labels produce two distinct nets with the same name, and the label text is drawn centred ON the wire (reads as struck-through 'N̶E̶T̶'). Net labels are only connected when their anchor equals a wire VERTEX to the nanometre, which is unreachable by clicking with snapping disabled. ERC reports nothing. The outline empty-state button 'Add net label' actually arms the Net portal (H) tool, and the empty-canvas menu 'Place net label  L' arms this text label — two different things share the name.
- Screenshots: [038-label-placed](../evidence/shots/q3/dark/038-label-placed.png), [043-label-on-wire-armed](../evidence/shots/q3/dark/043-label-on-wire-armed.png), [045-erc-after-run](../evidence/shots/q3/dark/045-erc-after-run.png), [015-empty-add-net-label](../evidence/shots/q3/light/015-empty-add-net-label.png)
- Network: `LABEL NET {x:2714132,y:7066790}; WIRE f8ce4f02 at y=7.1; nets [('+5V',0),('Net_1',0),('SDA',0),('Net_2',1),('Net_3',3),('NET',0),('GND',0),('NET',0)]`
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1907` — L arms label text labelDraftText \|\| 'NET' without a prompt
- Code: `src/modules/designer/backend/projection-world.ts:719` — labels union only with wire vertices at identical coordinates
- Code: `src/modules/designer/backend/projection-world.ts:726` — global named-net union excludes labels
- Suggested fix: Give L a name picker like H (LabelPicker), render a ghost, snap the label anchor to the nearest wire segment/pin within a few px, and in deriveNetsAndJunctions treat label points like pins (segment-interior T-touch) and merge same-text labels in the named-net union. Rename the outline button to 'Add net portal' or make it arm L.
- Verification (vq3): **confirmed** — Confirmed on QA-Q3-vq3-a. L placed two labels with the default text 'NET' (no name prompt): one in free space and one clicked onto the U1.7 wire. The projection lists two separate nets both named 'NET' with 0 wires and no pins, and the wire keeps its auto name. The on-wire label is drawn centred on the wire, so it reads as struck-through. Code: labels union only with wire vertices at the exact same coordinate (projection-world.ts:719-724, 'Labels keep vertex-exact semantics'). The named-net union (projection-world.ts:726-749) covers only gnd/pwr/net_portal, so same-text labels never merge. Not intentional: designer/AGENTS.md says a net's name changes 'if a label or rail was renamed', i.e. labels are meant to name nets. S2 kept. · evidence: [013-label-armed](../evidence/shots/vq3/dark/013-label-armed.png), [014-labels-placed](../evidence/shots/vq3/dark/014-labels-placed.png)

</details>


## T-098

**ERC shows green 'No ERC violations' for a schematic with unconnected pins and floating power/GND ports, portals and labels**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **defer** · owner followup · wave followup · scope backend · estimate M
- Findings: Q3-014

**Summary.** Green banner 'No ERC violations', badges 0/0/0, status bar '0 ERC'. The engine only has three rules (unconnected strict-input pins, output-output short, no-connect conflict), so passive/power symbols and floating labels are never checked — the green result gives false confidence before PCB layout/fab.

**Root cause.** `src/modules/designer/backend/erc/erc-engine.ts:99` — Rule 1 skips every pin not in STRICT_INPUT_TYPES; only 3 rules in the 167-line engine

**Proposed fix.** ERC engine: flag unconnected pins and floating ports/labels (engine correctness — out of this UI run). — Detail: Add ERC rules: unconnected pin (any type, unless no-connect flagged) → warning; power/GND/portal primitive with no wire/pin on its net → warning; label not attached to a wire → warning; net with a single pin → info. Until then, change the empty-result copy to 'No violations for the checks run (inputs, output shorts, no-connect)'.

**Note.** Out of scope per user: engine correctness (ERC is in pcb-hardening review scope).

**Evidence.** [045-erc-after-run](../evidence/shots/q3/dark/045-erc-after-run.png), [011-12v-erc-green-stacked](../evidence/shots/vq3/dark/011-12v-erc-green-stacked.png)

<details><summary>Q3-014 — ERC shows green 'No ERC violations' for a schematic with unconnected pins and floating power/GND ports, portals and labels (S2, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox: R2 pin 1 unconnected, +5V port, GND port and 'SDA' portal not wired to anything, two floating 'NET' labels, all part values empty
  2. Dock → ERC → Run ERC
  3. Also: owned design 1198c943 'S3 LLM Edge — 12V params' has R1/R4, R2/R5, R3/R6, D1/D4, D2/D5, D3/D6 stacked at identical coordinates (e.g. R1 and R4 both at (0,0)); their pins coincide so each pair is silently paralleled (Net_2 = D1.2, D4.2, R4.2, R1.2). The canvas shows over-printed refdes 'R4'/'R1', and ERC reports 0 violations — no 'overlapping symbols' / duplicate-placement check.
- Expected: Warnings for unconnected pins (no-connect flag missing), power/ground symbols not connected, labels/portals not connected to any wire, single-pin nets (KiCad ERC 'pin not connected', 'label not connected', 'power pin not driven')
- Actual: Green banner 'No ERC violations', badges 0/0/0, status bar '0 ERC'. The engine only has three rules (unconnected strict-input pins, output-output short, no-connect conflict), so passive/power symbols and floating labels are never checked — the green result gives false confidence before PCB layout/fab.
- Screenshots: [045-erc-after-run](../evidence/shots/q3/dark/045-erc-after-run.png), [006-schem-12v-open](../evidence/shots/q3/dark/006-schem-12v-open.png), [007-schem-12v-fit](../evidence/shots/q3/dark/007-schem-12v-fit.png)
- Network: `12V params: PART R1 {x:0,y:0} and PART R4 {x:0,y:0}; nets Net_2 ['D1.2','D4.2','R4.2','R1.2']`
- Code: `src/modules/designer/backend/erc/erc-engine.ts:99` — Rule 1 skips every pin not in STRICT_INPUT_TYPES; only 3 rules in the 167-line engine
- Suggested fix: Add ERC rules: unconnected pin (any type, unless no-connect flagged) → warning; power/GND/portal primitive with no wire/pin on its net → warning; label not attached to a wire → warning; net with a single pin → info. Until then, change the empty-result copy to 'No violations for the checks run (inputs, output shorts, no-connect)'.
- Verification (vq3): **confirmed** — Reproduced. (a) Owned design 'S3 LLM Edge — 12V params' has R1/R4, R2/R5, R3/R6, D1/D4 … stacked on identical coordinates with over-printed refdes, and Run ERC shows the green 'No ERC violations', 0/0/0. (b) On QA-Q3-vq3-a, R1/R2 each have single-pin passive nets (Net_1, Net_3, Net_4), the GND port and both 'NET' labels float, yet ERC reports only UNCONNECTED_INPUT_PIN (U1.14 power_in) and OUTPUT_OUTPUT_SHORT. Code: erc-engine.ts is 167 lines with three rules: unconnected strict-input (:99-110), output-output short (:113-140) and no-connect conflict (:143ff). S2 kept as a misleading 'No ERC violations' claim. · evidence: [011-12v-erc-green-stacked](../evidence/shots/vq3/dark/011-12v-erc-green-stacked.png), [008-74hc00-stacked-erc](../evidence/shots/vq3/dark/008-74hc00-stacked-erc.png)

</details>


## T-099

**Inspector 'Open in Library' lands on the Library list with an unrelated part (74HC00) previewed instead of the selected component**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D1+L1 · wave W2 · scope frontend · estimate XS
- Findings: Q3-016 · known ref K21

**Summary.** Library opens on the unfiltered list; the preview pane shows the first row '74HC00 Quad NAND SOIC-14' (a different part), which reads as if R1 were a 74HC00. The component id is never passed. (Outline empty-state 'Browse library' also lands on the list — acceptable for 'browse'.)

**Root cause.** `src/modules/designer/frontend/Space.tsx:1536` — componentId ignored

**Proposed fix.** Open in Library navigates with {componentId}; Library opens that part's detail (or selects row); 'not found' notice for orphaned parts. — Detail: Space.tsx:1536: onOpenInLibrary={(componentId) => navigateToModule('library', undefined, { componentId })} (same call the assistant uses at assistant/frontend/Space.tsx:88).

**Evidence.** [063-open-in-library](../evidence/shots/q3/dark/063-open-in-library.png), [015-open-in-library](../evidence/shots/vq3/dark/015-open-in-library.png)

<details><summary>Q3-016 — Inspector 'Open in Library' lands on the Library list with an unrelated part (74HC00) previewed instead of the selected component (S2, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox: select R1 (Resistor) in the Outline
  2. Properties dock → Quick actions → 'Open in Library'
- Expected: Library opens on R1's component (openpcb.core.passive.resistor) — detail page or at least the row selected/scrolled into view
- Actual: Library opens on the unfiltered list; the preview pane shows the first row '74HC00 Quad NAND SOIC-14' (a different part), which reads as if R1 were a 74HC00. The component id is never passed. (Outline empty-state 'Browse library' also lands on the list — acceptable for 'browse'.)
- Screenshots: [063-open-in-library](../evidence/shots/q3/dark/063-open-in-library.png), [062-browse-library](../evidence/shots/q3/dark/062-browse-library.png)
- Code: `src/modules/designer/frontend/Space.tsx:1536` — componentId ignored
- Code: `src/modules/library/frontend/Space.tsx:193` — Library already honours params.componentId
- Suggested fix: Space.tsx:1536: onOpenInLibrary={(componentId) => navigateToModule('library', undefined, { componentId })} (same call the assistant uses at assistant/frontend/Space.tsx:88).
- Verification (vq3): **confirmed** — Reproduced: R1 (Device:R) selected → Properties › Quick actions › 'Open in Library' lands on the unfiltered Library table with the default first row '74HC00 Quad NAND SOIC-14' previewed. Code: Space.tsx:1536 onOpenInLibrary={() => navigateToModule('library')} drops the componentId the inspector passes. The Library already opens a detail page from params.componentId (library/frontend/Space.tsx:190-199), and the assistant already navigates that way (assistant/frontend/Space.tsx:88). K21 confirmed. S2 kept (control does not do what its label says; workaround is to search manually). The fix is XS. · evidence: [015-open-in-library](../evidence/shots/vq3/dark/015-open-in-library.png)

</details>


## T-100

**Delete on a focused Outline row dispatches the delete twice and shows 'Revision conflict. Please retry after refresh.' after a successful delete**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: Q3-021

**Summary.** R11 is deleted (rev 44 → 45) but two POST …/commands are sent back-to-back; the second fails with a revision conflict and the red error strip 'Revision conflict. Please retry after refresh.' appears under the header and stays (no dismiss) — telling the user to refresh after an operation that succeeded. Reproduced 2/2 (U1, R11).

**Root cause.** `src/modules/designer/frontend/components/OutlinePanel/OutlineRow.tsx:131` — row onKeyDown Delete/Backspace → deleteAction.onSelect() without stopPropagation

**Proposed fix.** OutlineRow Delete: single handler (stopPropagation) — one dispatch. — Detail: In OutlineRow's Delete/Backspace branch call event.preventDefault() + event.stopPropagation() (and have the canvas handler ignore events whose target is inside the outline), or let only one owner handle Delete.

**Evidence.** [079-after-u1-delete](../evidence/shots/q3/dark/079-after-u1-delete.png), [010-outline-delete-conflict](../evidence/shots/vq3/dark/010-outline-delete-conflict.png)

<details><summary>Q3-021 — Delete on a focused Outline row dispatches the delete twice and shows 'Revision conflict. Please retry after refresh.' after a successful delete (S2, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox: click the 'R11 1k' row in the Outline (selects it on canvas and focuses the row)
  2. Press Delete
- Expected: R11 is deleted once, no error
- Actual: R11 is deleted (rev 44 → 45) but two POST …/commands are sent back-to-back; the second fails with a revision conflict and the red error strip 'Revision conflict. Please retry after refresh.' appears under the header and stays (no dismiss) — telling the user to refresh after an operation that succeeded. Reproduced 2/2 (U1, R11).
- Screenshots: [079-after-u1-delete](../evidence/shots/q3/dark/079-after-u1-delete.png), [080-outline-delete-conflict](../evidence/shots/q3/dark/080-outline-delete-conflict.png)
- Network: `POST /api/modules/designer/designs/e77715d2…/commands → 200 (ok)`; `POST /api/modules/designer/designs/e77715d2…/commands → 200 (ok:false REVISION_CONFLICT)`
- Code: `src/modules/designer/frontend/components/OutlinePanel/OutlineRow.tsx:131` — row onKeyDown Delete/Backspace → deleteAction.onSelect() without stopPropagation
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1792` — window keydown isDeleteShortcut also deletes the (same) canvas selection — row is a div role=button so isEditableShortcutTarget does not exclude it
- Suggested fix: In OutlineRow's Delete/Backspace branch call event.preventDefault() + event.stopPropagation() (and have the canvas handler ignore events whose target is inside the outline), or let only one owner handle Delete.
- Verification (vq3): **confirmed** — Reproduced on QA-Q3-vq3-a: click the 'R2 1k' outline row, then Delete. Two POST …/commands fired back-to-back (requests #1304 and #1305), the revision went 41 → 42 (R2 deleted once), and the header strip shows 'Revision conflict. Please retry after refresh.' with no dismiss. Code: OutlineRow onKeyDown Delete (OutlineRow.tsx:131-136) calls deleteAction.onSelect() without stopPropagation, and the window keydown in SchematicCanvas (:1792) deletes the same canvas selection again. isEditableShortcutTarget only excludes input/textarea/select/contenteditable (r3f-eda-canvas keyboard-shortcuts.js:20-28), not role=button rows. S2 kept (misleading error after a successful operation). · evidence: [010-outline-delete-conflict](../evidence/shots/vq3/dark/010-outline-delete-conflict.png)

</details>


## T-101

**Schematic load failure leaves 'Loading schematic...' forever, raw 'Internal error' strip without retry, and an Outline that claims the design is empty**

- Severity **S2** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate S
- Findings: Q3-025 · known ref K09,K40

**Summary.** Canvas shows 'Loading schematic...' indefinitely; header strip shows the raw problem title 'Internal error' with no retry/dismiss; the Outline says 'Empty design — Add your first component…' with Place component/Add net label CTAs (looks like the design was wiped); schematic toolbar is gone; ERC dock shows green 'No ERC violations'. After the backend is healthy again nothing retries — PCB→Schem view switch does not…

**Root cause.** `src/modules/designer/frontend/Space.tsx:1151` — !state.projection → CanvasEmptyState 'Loading schematic...' regardless of error

**Proposed fix.** Schematic load failure -> error state with Retry (no infinite 'Loading schematic…'); Outline shows error, not 'Empty design'. — Detail: Track a projectionError in useDesignerWorkspace; when set render an error panel with Retry (actions.refreshProjection) instead of 'Loading…', hide the Outline empty state while projection is null (show skeleton/error), and map problem+json to friendly copy.

**Evidence.** [090-projection-500](../evidence/shots/q3/dark/090-projection-500.png), [026-projection-500](../evidence/shots/vq3/dark/026-projection-500.png)

<details><summary>Q3-025 — Schematic load failure leaves 'Loading schematic...' forever, raw 'Internal error' strip without retry, and an Outline that claims the design is empty (S2, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. Close the QA-Q3-sandbox tab
  2. route "**/projection/schematic*" → 500 application/problem+json {title:'Internal error'}
  3. Home → double-click QA-Q3-sandbox; wait 15 s
  4. unroute; wait 5 s; switch view PCB → Schem
  5. Switch to another design tab and back
- Expected: A clear error state in the canvas ('Couldn't load the schematic' + Retry), no misleading empty-design content, automatic or one-click recovery
- Actual: Canvas shows 'Loading schematic...' indefinitely; header strip shows the raw problem title 'Internal error' with no retry/dismiss; the Outline says 'Empty design — Add your first component…' with Place component/Add net label CTAs (looks like the design was wiped); schematic toolbar is gone; ERC dock shows green 'No ERC violations'. After the backend is healthy again nothing retries — PCB→Schem view switch does not help; only switching to another design tab and back reloads.
- Screenshots: [090-projection-500](../evidence/shots/q3/dark/090-projection-500.png)
- Network: `GET /api/modules/designer/designs/e77715d2…/projection/schematic → 500`
- Code: `src/modules/designer/frontend/Space.tsx:1151` — !state.projection → CanvasEmptyState 'Loading schematic...' regardless of error
- Code: `src/modules/designer/frontend/Space.tsx:1303` — state.error strip: plain text, no retry/dismiss
- Code: `src/modules/designer/frontend/components/OutlinePanel/OutlinePanel.tsx:114` — designIsEmpty true when projection is null → empty-design CTA
- Suggested fix: Track a projectionError in useDesignerWorkspace; when set render an error panel with Retry (actions.refreshProjection) instead of 'Loading…', hide the Outline empty state while projection is null (show skeleton/error), and map problem+json to friendly copy.
- Verification (vq3): **confirmed** — Reproduced with route 500 (problem+json) on **/projection/schematic*, then switching to the 'S3 LLM Edge — 12V params' tab. Result: 'Loading schematic...' indefinitely, a raw 'Internal error' strip with no retry/dismiss, the Outline showing 'Empty design' with Place component / Add net label CTAs on a 12-part design, the toolbar gone, and the zoom readout still showing 3% from the previous design. After unroute + 5 s, PCB → Schem did not recover. Switching to another tab and back did. K09 confirmed. S2. · evidence: [026-projection-500](../evidence/shots/vq3/dark/026-projection-500.png)

</details>


## T-102

**Outline Parts 'REF' column leaves 24 px for the designator: every 4+ character refdes (R100, C101, LED1, SW10, TP1…) is cut to 'R1…'/'C1…' and reads as a different part**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: F1B-029

**Summary.** The Parts grid template is '40px 1fr 80px'; after the 13 px type icon and gap the designator span is 24 px wide at 11 px IBM Plex Mono (6.6 px/char) — measured widths: R10 19.8 px fits, R100/C101/SW10/LED1 26.4 px and TP100 33 px do not. 'R123456789' renders as 'R1…' (clientWidth 24, scrollWidth 66; the full text is only in a title tooltip). On a real 100+ part board R100–R199 all show as 'R1…', indistinguishable fr…

**Root cause.** `src/modules/designer/frontend/components/OutlinePanel/OutlinePanel.tsx:66` — TAB_COLS.parts = '40px 1fr 80px' — 40 px includes the icon

**Proposed fix.** REF column min 48px (or auto-size to longest refdes) with tooltip. — Detail: Size the REF track to content: 'minmax(56px,max-content) 1fr 80px' (or compute from the longest designator, capped at ~96 px), or move the type icon out of the REF cell. Keep ellipsis + title for pathological lengths.

**Evidence.** [108-long-schem-fit](../evidence/shots/f1b/dark/108-long-schem-fit.png), [012-long-schem-fit](../evidence/shots/vf1b/dark/012-long-schem-fit.png)

<details><summary>F1B-029 — Outline Parts 'REF' column leaves 24 px for the designator: every 4+ character refdes (R100, C101, LED1, SW10, TP1…) is cut to 'R1…'/'C1…' and reads as a different part (S3, confirmed)</summary>

- Area designer.schematic · stack A · design 43a2da78-9d2e-43a0-bcd3-ecebe3f72551 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Open QA-f1b-long → Schem → Outline, Parts tab
  2. Rename R1 to R123456789 (or look at any board with ≥100 resistors / R100)
  3. Read the REF column
- Expected: The REF column fits typical designators (at least 5–6 characters: R100, C101, TP12, SW10, LED1) and truncates only unusually long ones, ideally with the column sized to content or resizable.
- Actual: The Parts grid template is '40px 1fr 80px'; after the 13 px type icon and gap the designator span is 24 px wide at 11 px IBM Plex Mono (6.6 px/char) — measured widths: R10 19.8 px fits, R100/C101/SW10/LED1 26.4 px and TP100 33 px do not. 'R123456789' renders as 'R1…' (clientWidth 24, scrollWidth 66; the full text is only in a title tooltip). On a real 100+ part board R100–R199 all show as 'R1…', indistinguishable from R1–R19, and sorting by REF then looks random. Same at 1100×720 (the sidebar has the same width).
- Screenshots: [108-long-schem-fit](../evidence/shots/f1b/dark/108-long-schem-fit.png), [066-long-r1-inspector](../evidence/shots/f1b/dark/066-long-r1-inspector.png), [002-long-schem-inspector](../evidence/shots/f1b/light/002-long-schem-inspector.png), [079-long-schem-1100](../evidence/shots/f1b/dark/079-long-schem-1100.png)
- Console: `font 11px 'IBM Plex Mono'; cellW 24; widths R1 13.2, R10 19.8, R100 26.4, C101 26.4, SW10 26.4, LED1 26.4, TP100 33, R123456789 66`
- Code: `src/modules/designer/frontend/components/OutlinePanel/OutlinePanel.tsx:66` — TAB_COLS.parts = '40px 1fr 80px' — 40 px includes the icon
- Suggested fix: Size the REF track to content: 'minmax(56px,max-content) 1fr 80px' (or compute from the longest designator, capped at ~96 px), or move the type icon out of the REF cell. Keep ellipsis + title for pathological lengths.
- Verification (vf1b): **confirmed** — Reproduced on QA-f1b-long Outline (Parts): the designator cell for R123456789 has clientWidth 24 and scrollWidth 66, rendered 'R1…' with title. In 11 px IBM Plex Mono, R10 is 19.8 px (fits) while R100/C101/LED1 are 26.4 px and TP100 is 33 px (do not fit). TAB_COLS.parts = '40px 1fr 80px' (OutlinePanel.tsx:66). S3 kept. · evidence: [012-long-schem-fit](../evidence/shots/vf1b/dark/012-long-schem-fit.png), DOM: cw 24 sw 66; widths R10 19.8, R100 26.4, TP100 33

</details>


## T-103

**Unconnected pins shown as auto nets; schematic vs PCB net counts disagree (0 vs 4, 60 vs 353)**

- Severity **S3** · category consistency · status confirmed · themes dark
- Recommendation **fix-now** · owner D2+D3 · wave W2 · scope frontend · estimate S
- Findings: F1C-008, F1B-010

**Summary.** The inspector shows synthetic net names for floating pins, and the two summaries disagree (0 vs 4) for the same design. | Also covers: F1B-010: Net count disagrees between views: schematic Summary 'Nets 60' vs PCB Board Summary 'Nets…

**Root cause.** `src/modules/designer/frontend/components/SelectionInspector/SelectionInspector.tsx:60` — Sheet summary counts only nets with wires/labels/primitives (excludes the 1-pin nets the projection emits)

**Proposed fix.** Single-pin nets are 'unconnected' (not Net_N); schematic and PCB summaries count nets with ≥2 pins the same way. — Detail: Pick one definition of a net for the summaries. PcbBoardPanel.tsx:499 should count only nets with 2+ connected items (the same predicate as SelectionInspector.tsx:60-70), or both should show 'Nets 3 (+10 unconnected pins)'. In PartInspectorPanel's Pins table (:666), render '—' / 'unconnected' for nets whose pinIds.length === 1 and that have no wires, labels or primitives, instead of the regenerated Net_<n>.

**Evidence.** [011-drop-design-after-source-removed](../evidence/shots/f1c/dark/011-drop-design-after-source-removed.png), [013-schematic-summary-nets-0](../evidence/shots/vf1c/dark/013-schematic-summary-nets-0.png), [021-reopen](../evidence/shots/f1b/dark/021-reopen.png)

<details><summary>F1C-008 — Unconnected pins show auto-named nets (Net_3, Net_4): Schematic summary says 0 nets while the PCB summary says 4 (S3, confirmed)</summary>

- Area designer.schematic · stack B · design 7c22a0f9-faf8-4d2d-9da7-95c117eac147 · themes dark · viewports 1440x900
- Repro:
  1. Stack B, new design QA-f1c-drop, place an LED and a Resistor with no wires
  2. Schem: the Properties dock with nothing selected shows Summary 'Nets 0'
  3. Select R1: the Pins table lists '1 Net_4' and '2 Net_3'
  4. PCB tab: Board panel Summary reads 'Nets 4'
- Expected: An unconnected pin shows 'unconnected' or '—'. Net counts agree between views. Either both count only real nets, or both label the singleton nets as such.
- Actual: The inspector shows synthetic net names for floating pins, and the two summaries disagree (0 vs 4) for the same design.
- Screenshots: [011-drop-design-after-source-removed](../evidence/shots/f1c/dark/011-drop-design-after-source-removed.png), [012-inspector-removed-source-part](../evidence/shots/f1c/dark/012-inspector-removed-source-part.png), [014-pcb-after-source-removed](../evidence/shots/f1c/dark/014-pcb-after-source-removed.png)
- Code: `src/modules/designer/frontend/components/SelectionInspector/SelectionInspector.tsx:60` — Sheet summary counts only nets with wires/labels/primitives (excludes the 1-pin nets the projection emits)
- Code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:499` — Board summary counts Object.keys(projection.netNames), which includes every singleton net
- Code: `src/modules/designer/backend/projection-world.ts:857` — unconnected pins get regenerated Net_<n> names
- Code: `src/modules/designer/frontend/components/SelectionInspector/PartInspectorPanel.tsx:666` — Pins table 'Name · net' renders the synthetic Net_<n> for floating pins
- Suggested fix: Pick one definition of a net for the summaries. PcbBoardPanel.tsx:499 should count only nets with 2+ connected items (the same predicate as SelectionInspector.tsx:60-70), or both should show 'Nets 3 (+10 unconnected pins)'. In PartInspectorPanel's Pins table (:666), render '—' / 'unconnected' for nets whose pinIds.length === 1 and that have no wires, labels or primitives, instead of the regenerated Net_<n>.
- Verification (vf1c): **confirmed** — Reproduced on QA-f1c-drop (5 parts, no wires). The schematic Sheet summary reads 'Symbols 5 · Nets 0 · Labels 0', while the PCB Board summary reads 'Components 5 · Nets 10'. The projection has 10 nets, all singletons (e.g. {name:'Net_1', pinIds:[1 pin], wireIds:[]}). R1's Pins table shows 'Net_9' / 'Net_8' for its floating pins. Code: the schematic deliberately excludes 1-pin nets (SelectionInspector.tsx:60, with a comment saying so), but PcbBoardPanel counts every netNames key. This is an inconsistency, not a single intentional decision. S3 kept. · evidence: [013-schematic-summary-nets-0](../evidence/shots/vf1c/dark/013-schematic-summary-nets-0.png), [014-pcb-summary-nets](../evidence/shots/vf1c/dark/014-pcb-summary-nets.png), schematic projection: 10 nets, all 1-pin, 0 wires

</details>

<details><summary>F1B-010 — Net count disagrees between views: schematic Summary 'Nets 60' vs PCB Board Summary 'Nets 353' for the same design (PCB counts every unconnected pin as a net) (S3, confirmed)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. Open QA-f1b-stress (150 parts, 60 wires)
  2. Schematic, nothing selected → Properties Summary: Nets
  3. Switch to PCB, nothing selected → Board panel Summary: Nets
  4. Also open Design rules → Net assignments / length group chips
- Expected: One definition of 'net' across the app (nets with ≥2 connections, like KiCad's net count); the same number in both summaries; auto single-pin nets hidden from net pickers.
- Actual: Schematic Summary shows Nets 60 (filters out auto 1-pin nets), PCB Board Summary shows Nets 353 (Object.keys(projection.netNames)). The 293 single-pin 'Net_n' entries also flood the Outline Nets tab numbering (Net_187…Net_335), the Design-rules Net assignments list (353 selects) and length-group chips (353). Dual LED Blinker shows 13 vs 13 only because every pin there is wired.
- Screenshots: [021-reopen](../evidence/shots/f1b/dark/021-reopen.png), [026-pcb-fit-to-parts](../evidence/shots/f1b/dark/026-pcb-fit-to-parts.png)
- Code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:499` — Nets = Object.keys(projection.netNames).length
- Code: `src/modules/designer/frontend/components/SelectionInspector/SelectionInspector.tsx:61` — schematic netCount excludes auto 1-pin nets
- Suggested fix: Count only nets with ≥2 pads (or with a wire/label/primitive) in PcbBoardPanel, and apply the same filter to the Design-rules net lists; share one helper between schematic and PCB summaries.
- Verification (vf1b): **confirmed** — Reproduced on QA-vf1b-stack60: the schematic Sheet summary shows 'Nets 0' (no wires) while the PCB Board summary shows 'Nets 168'. Code: PcbBoardPanel.tsx:499 counts Object.keys(netNames); SelectionInspector.tsx:61 filters out auto 1-pin nets. S3 kept. · evidence: [009-schem-summary-nets](../evidence/shots/vf1b/dark/009-schem-summary-nets.png), [002-pcb-stack60-markers](../evidence/shots/vf1b/dark/002-pcb-stack60-markers.png)

</details>


## T-104

**Place-component palette: Enter places whatever row happens to be under the resting mouse pointer, not the top result (typed 'conn' + Enter → 6-pin 'Pin Header 2x03' instead of the first match)**

- Severity **S3** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: F2A-015

**Summary.** With the pointer parked at (1300,850) the first result 'Connector:Conn_01x05_Pin' carries ENTER; with it parked at (560,380) the third row 'Pin Header 2x03 2.54mm' carries ENTER, because the list re-renders under the stationary pointer and onMouseEnter fires. During the golden path this nearly placed a 6-pin header for a 2-pin connector.

**Root cause.** `src/modules/designer/frontend/components/ComponentCommandPalette.tsx:372` — onMouseEnter={() => setHighlightedIndex(flatIndex)} fires when results re-render under a stationary pointer, after the search effect reset the highlight to 0 (:161)

**Proposed fix.** Palette Enter places the highlighted (keyboard) row, default top result; mouse hover doesn't steal selection until moved. — Detail: Switch to onMouseMove (or ignore mouseenter until a pointermove with non-zero delta after the last keystroke); reset highlight to 0 on query change.

**Evidence.** [006-palette-conn](../evidence/shots/f2a/dark/006-palette-conn.png), [004-palette-conn-560](../evidence/shots/vf2a/dark/004-palette-conn-560.png)

<details><summary>F2A-015 — Place-component palette: Enter places whatever row happens to be under the resting mouse pointer, not the top result (typed 'conn' + Enter → 6-pin 'Pin Header 2x03' instead of the first match) (S3, confirmed)</summary>

- Area designer.schematic · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. Leave the mouse pointer resting in the middle of the schematic canvas (e.g. 560,380 at 1440×900)
  2. Cmd+K, type 'conn' (do not touch the mouse)
  3. Observe the ENTER badge / press Enter
- Expected: Keyboard flow: the first result is highlighted after typing; hover only takes over after the pointer actually moves.
- Actual: With the pointer parked at (1300,850) the first result 'Connector:Conn_01x05_Pin' carries ENTER; with it parked at (560,380) the third row 'Pin Header 2x03 2.54mm' carries ENTER, because the list re-renders under the stationary pointer and onMouseEnter fires. During the golden path this nearly placed a 6-pin header for a 2-pin connector.
- Screenshots: [006-palette-conn](../evidence/shots/f2a/dark/006-palette-conn.png), [103-palette-hover-560](../evidence/shots/f2a/dark/103-palette-hover-560.png), [103-palette-hover-1300](../evidence/shots/f2a/dark/103-palette-hover-1300.png)
- Code: `src/modules/designer/frontend/components/ComponentCommandPalette.tsx:372` — onMouseEnter={() => setHighlightedIndex(flatIndex)} fires when results re-render under a stationary pointer, after the search effect reset the highlight to 0 (:161)
- Suggested fix: Switch to onMouseMove (or ignore mouseenter until a pointermove with non-zero delta after the last keystroke); reset highlight to 0 on query change.
- Verification (vf2a): **confirmed** — QA-vf2a-a (dark). Pointer parked at (560,380), Cmd+K, type 'conn': the third row 'Pin Header 2x03 2.54mm' carries ENTER (shot 004). Pointer parked at (1300,850): the first row 'Connector:Conn_01x05_Pin' carries ENTER (shot 005). Hover overrides the keyboard default without any pointer movement. S3. · evidence: [004-palette-conn-560](../evidence/shots/vf2a/dark/004-palette-conn-560.png), [005-palette-conn-1300](../evidence/shots/vf2a/dark/005-palette-conn-1300.png)

</details>


## T-105

**Symbol text rendering: '~{RST}' literal, pin names overprint ('CONTVCC'), labels inside bodies, fit ignores text**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **defer** · owner followup · wave followup · scope shared-package · estimate M
- Findings: F2A-016, Q7-031, Q3-035

**Summary.** Pin 4 label reads '~{RST}' verbatim (also in the Pins list of the inspector '~{RST}'); pins 5 (CONT) and 8 (VCC) are 2.54 mm apart on the top edge and their names overlap into 'CONTVCC'; 'GND' is drawn across pin 1's stem. Value is '' after placement (schematic shows no value text; BOM/PnP would carry an empty Comment until the user types one) while the Outline shows the component name 'NE555 Timer SOIC-8' in the Va… | Also covers: Q7-031: Symbol previews overprint pin names/numbers on the pin line and don't rotate labels for v…; Q3-035: Symbol text rendering glitches: LED pin names 'K'/'A' drawn inside the diode body, rotate…

**Root cause.** `node_modules/@openpcb/rendering-core/dist/symbol-preview-builder.js:32` — createPinLabels: text = pin.name verbatim (no ~{…} overbar parsing) and rotationDeg 0 for top/bottom pins, so vertical-pin names 2.54 mm apart collide

**Proposed fix.** @openpcb/rendering-core symbol builder: KiCad markup (~{}), rotated/vertical pin labels, no overprint, fit includes text. — Detail: In @openpcb/rendering-core createPinLabels: parse KiCad '~{…}' into plain text + overbar span (render the overline), and rotate names of top/bottom pins 90° (KiCad convention) so adjacent vertical pins don't collide. Empty Value on placement is general: covered by F1B-016/F1B-005; optionally default place_part value to the component's value field.

**Evidence.** [007-fit](../evidence/shots/f2a/dark/007-fit.png), [002-schem-fit](../evidence/shots/vf2a/dark/002-schem-fit.png), [002-symbol-import-resistor](../evidence/shots/q7/dark/002-symbol-import-resistor.png)

<details><summary>F2A-016 — Core NE555 symbol renders KiCad markup '~{RST}' literally and prints top-edge pin names horizontally so 'CONT' and 'VCC' overprint into 'CONTVCC'; parts are also placed with an empty Value (S3, confirmed)</summary>

- Area designer.schematic · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. Cmd+K → 'NE555 Timer SOIC-8' (Core) → place
  2. Fit schematic ([007-fit](../evidence/shots/f2a/dark/007-fit.png))
  3. Look at the Outline/Properties Value and the BOM
- Expected: Active-low pins drawn as RST with an overline; power-unit pins (VCC/GND) placed so names don't collide with CONT; Value defaults to 'NE555' like R/C default to their component name.
- Actual: Pin 4 label reads '~{RST}' verbatim (also in the Pins list of the inspector '~{RST}'); pins 5 (CONT) and 8 (VCC) are 2.54 mm apart on the top edge and their names overlap into 'CONTVCC'; 'GND' is drawn across pin 1's stem. Value is '' after placement (schematic shows no value text; BOM/PnP would carry an empty Comment until the user types one) while the Outline shows the component name 'NE555 Timer SOIC-8' in the Value column, hiding that the value is empty.
- Screenshots: [007-fit](../evidence/shots/f2a/dark/007-fit.png), [093-after-reload-designer](../evidence/shots/f2a/dark/093-after-reload-designer.png), [100-schem-undo-move](../evidence/shots/f2a/dark/100-schem-undo-move.png)
- Network: `projection/schematic U1 value '' ; pin 4 name '~{RST}'`
- Code: `node_modules/@openpcb/rendering-core/dist/symbol-preview-builder.js:32` — createPinLabels: text = pin.name verbatim (no ~{…} overbar parsing) and rotationDeg 0 for top/bottom pins, so vertical-pin names 2.54 mm apart collide
- Code: `../CoreLibrary/symbols/ic/ne555d.symbol.json:1` — pin 4 name '~{RST}', pins 5 CONT (0,10.16) and 8 VCC (2.54,10.16) on the top edge
- Suggested fix: In @openpcb/rendering-core createPinLabels: parse KiCad '~{…}' into plain text + overbar span (render the overline), and rotate names of top/bottom pins 90° (KiCad convention) so adjacent vertical pins don't collide. Empty Value on placement is general: covered by F1B-016/F1B-005; optionally default place_part value to the component's value field.
- Verification (vf2a): **confirmed** — Fresh placement in QA-vf2a-a: pin 4 reads '~{RST}' and the top edge reads 'CONTVCC' (shot 007), same on the golden (shot 002). The projection pin name is '~{RST}'. Pin placement is from CoreLibrary; rendering is in rendering-core (no ~{} handling, names at rotation 0). Correction: the empty Value is not NE555-specific. A fresh Core 'Resistor' also gets value '' while the Outline shows the component name in the Value column (shot 008). That part overlaps F1B-016/F1B-005, so the finding is re-scoped to the overbar and pin-name collision. S3. · evidence: [002-schem-fit](../evidence/shots/vf2a/dark/002-schem-fit.png), [007-ne555-placed](../evidence/shots/vf2a/dark/007-ne555-placed.png), [008-r1-placed](../evidence/shots/vf2a/dark/008-r1-placed.png), projection: U1 value '' ; R1 value '' ; pin 4 name '~{RST}'

</details>

<details><summary>Q7-031 — Symbol previews overprint pin names/numbers on the pin line and don't rotate labels for vertical pins; fit ignores text (REF** clipped/under toolbar) (S3, confirmed)</summary>

- Area library.symbol-editor · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Import simple_resistor.kicad_sym → preview
  2. Footprints → Import C_0603 or Preset → Generate → look at REF**
- Expected: KiCad-like pin text: number above the pin line, name inside the body offset by pin_names offset, rotated 90° for vertical pins; zoom-to-fit includes reference/value text with margin and clears the floating toolbar.
- Actual: Resistor: pin name '1'/'2' drawn on top of the vertical pin line and the number drawn over the connection dot (two '1's stacked), unrotated. Footprint previews: 'REF**' 1 mm text rendered huge and clipped at the canvas edge (C_0603) or hidden behind the Grid toolbar (0603/SOT/QFN presets).
- Screenshots: [002-symbol-import-resistor](../evidence/shots/q7/dark/002-symbol-import-resistor.png), [041-footprint-import-c0603](../evidence/shots/q7/dark/041-footprint-import-c0603.png), [093-chip0603-B](../evidence/shots/q7/dark/093-chip0603-B.png), [046-preset-sot23-B](../evidence/shots/q7/dark/046-preset-sot23-B.png)
- Code: `node_modules/@openpcb/rendering-core/dist/symbol-preview-builder.js:1` — pin label placement
- Code: `src/modules/library/frontend/import-wizard/steps/FootprintStep.tsx:219` — fitToGeometryOnly excludes text
- Suggested fix: In rendering-core place pin numbers/names per KiCad rules (offset + rotation for 90/270° pins); in the wizard previews fit to geometry+text with top padding ≥ toolbar height.
- Verification (vq7): **confirmed** — Reproduced: simple_resistor preview draws pin name '1' on the vertical pin line plus number '1' over the connection dot (stacked, unrotated); C_0603 import preview renders 1 mm REF** huge and clipped at the canvas bottom; SOT-23 preset REF** sits under the Grid toolbar. FootprintStep passes fitToGeometryOnly (line 219). · evidence: [001-symbol-import-resistor](../evidence/shots/vq7/dark/001-symbol-import-resistor.png), [033-fp-import-c0603](../evidence/shots/vq7/dark/033-fp-import-c0603.png), [019-preset-sot23-B](../evidence/shots/vq7/dark/019-preset-sot23-B.png)

</details>

<details><summary>Q3-035 — Symbol text rendering glitches: LED pin names 'K'/'A' drawn inside the diode body, rotated parts overlap refdes and value, port text rotates to vertical (S4, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark, light · viewports 1440x900
- Repro:
  1. Place an LED (D1) — pin names K/A are printed on top of the triangle
  2. Select R10 and press Shift+R — 'R10' and '1k' collide ('1kR10')
  3. Rotate the +5V port via its menu — '+5V' is drawn vertically
- Expected: Hidden pin names for 2-pin passives/LEDs (KiCad hides them), refdes/value re-laid out to stay readable after rotation, port text kept horizontal
- Actual: 'KA' overprints the LED body (also in the palette preview), rotated resistor labels overlap each other, '+5V' reads bottom-to-top.
- Screenshots: [056-outline-actions-menu](../evidence/shots/q3/dark/056-outline-actions-menu.png), [013-shift-r](../evidence/shots/q3/light/013-shift-r.png), [083-comment-composer](../evidence/shots/q3/dark/083-comment-composer.png), [017-palette-search-led](../evidence/shots/q3/dark/017-palette-search-led.png)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:3600` — part text rendered in symbol-local frame
- Suggested fix: Respect pin-name visibility (hide when name is a single letter on 2-pin parts or flag hide_pin_names), counter-rotate field text to stay upright and offset refdes/value perpendicular to the body after rotation.
- Verification (vq3): **confirmed** — Confirmed in both themes. LED pin names 'K'/'A' over-print the diode body, R10 shows '1kR10' (value and refdes collide after rotation), and '+5V' is drawn vertically after the port was rotated (light 003). Dark: R1 after R shows 'R4.7kΩ' overlapping. S4. · evidence: [003-sandbox-fit](../evidence/shots/vq3/light/003-sandbox-fit.png), [021-duplicate](../evidence/shots/vq3/dark/021-duplicate.png)

</details>


## T-106

**Junction dots are 0.2 mm — barely wider than the wire, so T-connections look identical to crossing wires**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: Q3-009

**Summary.** At 20–29% zoom there is no visible dot at all; at 80% the dot is a ~9 px blob on a ~7 px wire (probe: dot #cfd3d8 vs wire #a6b2c1). Connectivity cannot be read from the drawing.

**Root cause.** `src/modules/designer/frontend/components/SchematicCanvas.tsx:3661` — <circleGeometry args={[0.1, 24]} /> — radius 0.1 mm

**Proposed fix.** Junction dots ~0.8–1.0 mm diameter (KiCad-like) so T-connections are distinguishable. — Detail: Raise junction radius to ~0.45 mm (or a screen-space minimum of ~6 px) and use the net/wire colour at full strength.

**Evidence.** [024-t-junction](../evidence/shots/q3/dark/024-t-junction.png), [025b-junction-crop-4x](../evidence/shots/q3/dark/025b-junction-crop-4x.png)

<details><summary>Q3-009 — Junction dots are 0.2 mm — barely wider than the wire, so T-connections look identical to crossing wires (S3, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. In QA-Q3-sandbox draw a wire from R1.1 ending on the middle of an existing wire (T-junction)
  2. Backend projection now lists junction {xNm:18760000,yNm:-2900000}
  3. Look at the T at 29% zoom, then zoom in to 80%
- Expected: A clearly visible filled junction dot (KiCad default ≈0.9 mm / 36 mil, ~5–6× wire width) so connected T's are distinguishable from unconnected crossings
- Actual: At 20–29% zoom there is no visible dot at all; at 80% the dot is a ~9 px blob on a ~7 px wire (probe: dot #cfd3d8 vs wire #a6b2c1). Connectivity cannot be read from the drawing.
- Screenshots: [024-t-junction](../evidence/shots/q3/dark/024-t-junction.png), [025-t-junction-zoomed](../evidence/shots/q3/dark/025-t-junction-zoomed.png), [025b-junction-crop-4x](../evidence/shots/q3/dark/025b-junction-crop-4x.png)
- Pixel probes: {"file": "shots/q3/dark/025-t-junction-zoomed.png", "x": 858, "y": 500, "hex": "#cfd3d8", "nearestToken": "--text", "deltaE": 3.8}; {"file": "shots/q3/dark/025-t-junction-zoomed.png", "x": 858, "y": 600, "hex": "#a6b2c1", "nearestToken": "--net-signal", "deltaE": 6.6}
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:3661` — <circleGeometry args={[0.1, 24]} /> — radius 0.1 mm
- Suggested fix: Raise junction radius to ~0.45 mm (or a screen-space minimum of ~6 px) and use the net/wire colour at full strength.
- Verification (vq3): **confirmed** — Code-confirmed: junction mesh is circleGeometry radius 0.1 mm (SchematicCanvas.tsx:3661), 0.2 mm diameter. KiCad's default is 36 mil (≈0.9 mm). q3's 4× crop shows the dot barely wider than the screen-space wire at 80% zoom, and it is invisible at fit zoom (junctions not discernible in the 12V design at 21%). S3. · evidence: [025b-junction-crop-4x](../evidence/shots/q3/dark/025b-junction-crop-4x.png), [011-12v-erc-green-stacked](../evidence/shots/vq3/dark/011-12v-erc-green-stacked.png)

</details>


## T-107

**Rotate labels are inverted: 'Rotate 90° clockwise (R)' turns the part counter-clockwise (and Shift+R 'counter-clockwise' turns it clockwise)**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: Q3-010, Q7-034 · known ref K28

**Summary.** R = +90° (math CCW in the Y-up sheet) is labelled 'clockwise'; Shift+R = −90° labelled 'counter-clockwise'. The symbol/footprint editors label the same +90° operation 'Rotate 90° CCW (R)' — the app contradicts itself between editors. | Also covers: Q7-034: Schematic labels R as 'Rotate 90° clockwise' but R rotates counter-clockwise (symbol/foot…

**Root cause.** `src/modules/designer/frontend/components/SchematicCanvas.tsx:2657` — 'Rotate 90° clockwise' does rotationDeg + 90 (CCW on screen)

**Proposed fix.** Fix schematic labels: R = 'Rotate 90° counter-clockwise', Shift+R = clockwise (match editors). — Detail: Rename the schematic items to 'Rotate 90° counter-clockwise (R)' / 'Rotate 90° clockwise (Shift+R)' to match actual behaviour and the symbol/footprint editors (KiCad also rotates CCW on R).

**Evidence.** [028-drag-part-done](../evidence/shots/q3/dark/028-drag-part-done.png), [009-esc-selection-stays](../evidence/shots/vq3/dark/009-esc-selection-stays.png), [080-schematic-npn-0](../evidence/shots/q7/light/080-schematic-npn-0.png)

<details><summary>Q3-010 — Rotate labels are inverted: 'Rotate 90° clockwise (R)' turns the part counter-clockwise (and Shift+R 'counter-clockwise' turns it clockwise) (S3, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark, light · viewports 1440x900
- Repro:
  1. In QA-Q3-sandbox select horizontal R2 (pin 1 left, pin 2 right, rotation 0)
  2. Press R (or right-click → 'Rotate 90° clockwise R')
  3. Observe: rotation becomes 90 and pin 1 moves to the BOTTOM, pin 2 to the top
  4. Right-click → 'Rotate 90° counter-clockwise Shift+R': rotation 90 → 0
  5. Light: Shift+R ('counter-clockwise') on R10 moved pin 1 from left to TOP (rotation 270) = clockwise on screen
- Expected: Clockwise on screen moves pin 1 from left to TOP (sheet is Y-up: R1 at y=+7.1 is drawn above R2 at y=-12.9). Labels and behaviour agree, and all editors use the same convention.
- Actual: R = +90° (math CCW in the Y-up sheet) is labelled 'clockwise'; Shift+R = −90° labelled 'counter-clockwise'. The symbol/footprint editors label the same +90° operation 'Rotate 90° CCW (R)' — the app contradicts itself between editors.
- Screenshots: [028-drag-part-done](../evidence/shots/q3/dark/028-drag-part-done.png), [031-rotate-R](../evidence/shots/q3/dark/031-rotate-R.png), [033-ctx-part](../evidence/shots/q3/dark/033-ctx-part.png), [013-shift-r](../evidence/shots/q3/light/013-shift-r.png)
- Network: `R2 rotationDeg 0 → 90 after R; 90 → 0 after menu 'counter-clockwise'`
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:2657` — 'Rotate 90° clockwise' does rotationDeg + 90 (CCW on screen)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:2815` — same label on primitives
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1869` — R key: delta = shift ? -90 : +90
- Code: `src/modules/library/frontend/import-wizard/editor/EditorToolbar.tsx:91` — symbol editor: R = 90° CCW
- Code: `src/modules/library/frontend/import-wizard/footprint-editor/FootprintEditorToolbar.tsx:142` — footprint editor: R = 90° CCW
- Suggested fix: Rename the schematic items to 'Rotate 90° counter-clockwise (R)' / 'Rotate 90° clockwise (Shift+R)' to match actual behaviour and the symbol/footprint editors (KiCad also rotates CCW on R).
- Verification (vq3): **confirmed** — Reproduced on QA-Q3-vq3-a. R1 was vertical with pin 1 at the top, rotation 0; the sheet is Y-up, since R1 at y=+11.8 is drawn above U1 at y=+1.1. Pressing R set rotation 90 and moved pin 1 to the LEFT, which is counter-clockwise on screen. The part and primitive context menus label this operation 'Rotate 90° clockwise  R' (SchematicCanvas.tsx:2657, :2815), and Shift+R is labelled counter-clockwise. The symbol and footprint editors label the same +90° step 'Rotate 90° CCW (R)' (EditorToolbar.tsx:91, FootprintEditorToolbar.tsx:142). K28 confirmed: the schematic labels are the wrong ones. S3. · evidence: [009-esc-selection-stays](../evidence/shots/vq3/dark/009-esc-selection-stays.png), [017-r1-after-R](../evidence/shots/vq3/dark/017-r1-after-R.png)

</details>

<details><summary>Q7-034 — Schematic labels R as 'Rotate 90° clockwise' but R rotates counter-clockwise (symbol/footprint editors correctly say CCW) (S3, confirmed)</summary>

- Area designer.schematic · stack B · design QA-q7-rotate (stack B) · themes light, dark · viewports 1440x900
- Repro:
  1. Stack B: new design QA-q7-rotate → Place component → NPN Transistor SOT-23 EBC (base pin 2 on the LEFT)
  2. Select Q1, press R
  3. Compare: Library → New part → Draw symbol → place pin (180°, pointing left) → select → R
- Expected: One direction convention with matching labels everywhere (KiCad: R = rotate CCW).
- Actual: Schematic: base pin moves left → bottom and collector top → left (9 o'clock → 6 o'clock = counter-clockwise), inspector Rotation 0 → 90, yet the part context menu reads 'Rotate 90° clockwise (R)' / 'counter-clockwise (Shift+R)'. Symbol editor: R turns a left-pointing pin (180°) to pointing down (270°) — also CCW — and its toolbar says 'Rotate selection 90° CCW (R)', 'CW (Shift+R)'. Both rotate +90°, only the schematic label is wrong.
- Screenshots: [080-schematic-npn-0](../evidence/shots/q7/light/080-schematic-npn-0.png), [081-schematic-npn-R](../evidence/shots/q7/light/081-schematic-npn-R.png), [018-pin4-selected](../evidence/shots/q7/dark/018-pin4-selected.png), [019-pin4-after-R](../evidence/shots/q7/dark/019-pin4-after-R.png)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:2657` — label 'Rotate 90° clockwise' for rotationDeg + 90 (also :2815)
- Code: `src/modules/library/frontend/import-wizard/editor/EditorToolbar.tsx:112` — 'Rotate selection 90° CCW (R)' for rotateSelection(90)
- Suggested fix: Change SchematicCanvas labels (2657/2680/2815/2837) to 'Rotate 90° counter-clockwise (R)' / 'clockwise (Shift+R)' (or flip the math if CW is intended — then flip the editors too).
- Verification (vq7): **confirmed** — Reproduced on q7's design QA-q7-rotate (light): Q1 at rotation 90 (base pin bottom, C left) -> R -> rotation 180 with base pin at the right and C at the bottom (6->3 and 9->6 o'clock = counter-clockwise), while the part context menu reads 'Rotate 90° clockwise R' / 'counter-clockwise Shift+R' (SchematicCanvas.tsx:2657/2680/2815/2837 label +90 as clockwise). Symbol editor: selected 180° pin -> R -> 270° (pointing down) = CCW, labelled 'Rotate selection 90° CCW (R)' - consistent. Rotation restored to 90 with Shift+R afterwards. · evidence: [001-rotate-design](../evidence/shots/vq7/light/001-rotate-design.png), [002-rotate-after-R](../evidence/shots/vq7/light/002-rotate-after-R.png), [003-rotate-ctx-menu](../evidence/shots/vq7/light/003-rotate-ctx-menu.png), [014-pin-after-R-crop](../evidence/shots/vq7/dark/014-pin-after-R-crop.png)

</details>


## T-108

**Esc does not clear the schematic selection although the context menu advertises 'Clear selection · Esc'**

- Severity **S3** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: Q3-012

**Summary.** Selection stays (status bar still '3 parts selected', inspector unchanged). Esc only cancels an active tool/wire/drag/picker; with no tool active it is a no-op. Only the tiny 'Deselect' link in the inspector footer or clicking empty canvas clears.

**Root cause.** `src/modules/designer/frontend/components/SchematicCanvas.tsx:1745` — Escape branch only resets tools; never setSelection(emptySelection())

**Proposed fix.** Esc clears selection (after cancelling an active tool). — Detail: In the Escape branch, when no tool/session is active, clear the selection (setSelection(emptySelection()) + actions.selectPart(null) etc.).

**Evidence.** [032-ctx-empty-canvas](../evidence/shots/q3/dark/032-ctx-empty-canvas.png), [009-esc-selection-stays](../evidence/shots/vq3/dark/009-esc-selection-stays.png)

<details><summary>Q3-012 — Esc does not clear the schematic selection although the context menu advertises 'Clear selection · Esc' (S3, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. In QA-Q3-sandbox click a part or the 'NET' label (or press ⌘A)
  2. Move pointer over canvas and press Escape
- Expected: Selection clears (as the empty-canvas context menu 'Clear selection  Esc' and every EDA tool promise)
- Actual: Selection stays (status bar still '3 parts selected', inspector unchanged). Esc only cancels an active tool/wire/drag/picker; with no tool active it is a no-op. Only the tiny 'Deselect' link in the inspector footer or clicking empty canvas clears.
- Screenshots: [032-ctx-empty-canvas](../evidence/shots/q3/dark/032-ctx-empty-canvas.png), [040-cmd-a](../evidence/shots/q3/dark/040-cmd-a.png)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1745` — Escape branch only resets tools; never setSelection(emptySelection())
- Suggested fix: In the Escape branch, when no tool/session is active, clear the selection (setSelection(emptySelection()) + actions.selectPart(null) etc.).
- Verification (vq3): **confirmed** — Reproduced: with R2 selected, Escape over the canvas left it selected (status bar still 'R2', inspector unchanged). Code: the Escape branch (SchematicCanvas.tsx:1745-1770) only resets tool/wire/drag/picker state and returns without clearing the selection, while the empty-canvas menu advertises 'Clear selection  Esc'. S3. · evidence: [009-esc-selection-stays](../evidence/shots/vq3/dark/009-esc-selection-stays.png)

</details>


## T-109

**Part inspector ships stubs: footprint-variant list is all disabled ('Per-instance override coming soon') and 'Replace component' is permanently disabled**

- Severity **S3** · category stub · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate S
- Findings: Q3-017 · known ref K43

**Summary.** The dropdown lists 0402/0805/1206/1210 but every alternative is disabled, with an amber 'Per-instance override coming soon' line; 'Replace component' is disabled with title 'Replace component — coming in a future designer phase'. Also Esc does not close the variant listbox.

**Root cause.** `src/modules/designer/frontend/components/SelectionInspector/SelectionInspector.tsx:186` — onReplaceComponentDisabledMessage='Per-instance override coming soon'; variants rendered disabled in PartInspectorPanel

**Proposed fix.** Remove disabled footprint-variant list and 'Replace component' stubs from inspector. — Detail: Hide the variant dropdown (show the footprint as read-only text) and the Replace button until the features exist, and drop 'pick another variant per instance' from the built-in component descriptions; or implement update_part_footprint + replace_part commands.

**Note.** Binding: remove Coming-soon stubs.

**Evidence.** [066-footprint-variant-menu](../evidence/shots/q3/dark/066-footprint-variant-menu.png), [007-footprint-variant-menu](../evidence/shots/vq3/light/007-footprint-variant-menu.png)

<details><summary>Q3-017 — Part inspector ships stubs: footprint-variant list is all disabled ('Per-instance override coming soon') and 'Replace component' is permanently disabled (S3, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox: select R1 → Properties
  2. Click the Footprint dropdown '0603 (1608 metric) SMD'
  3. Hover 'Replace component' in Quick actions
- Expected: Either a working per-instance footprint variant switch (the palette copy for Resistor/Capacitor literally says 'pick another variant per instance') and a working Replace component, or neither control is shown
- Actual: The dropdown lists 0402/0805/1206/1210 but every alternative is disabled, with an amber 'Per-instance override coming soon' line; 'Replace component' is disabled with title 'Replace component — coming in a future designer phase'. Also Esc does not close the variant listbox.
- Screenshots: [066-footprint-variant-menu](../evidence/shots/q3/dark/066-footprint-variant-menu.png), [028-drag-part-done](../evidence/shots/q3/dark/028-drag-part-done.png)
- Census: `census/designer-schematic-inspector-dark-1440.json`
- Code: `src/modules/designer/frontend/components/SelectionInspector/SelectionInspector.tsx:186` — onReplaceComponentDisabledMessage='Per-instance override coming soon'; variants rendered disabled in PartInspectorPanel
- Suggested fix: Hide the variant dropdown (show the footprint as read-only text) and the Replace button until the features exist, and drop 'pick another variant per instance' from the built-in component descriptions; or implement update_part_footprint + replace_part commands.
- Verification (vq3): **confirmed** — Reproduced (light, R1 in QA-Q3-sandbox). The Footprint dropdown lists 9 variant options, all disabled, under an amber 'Per-instance override coming soon'. 'Replace component' is disabled with the title 'Replace component — coming in a future designer phase'. Escape leaves the variant menu open (aria-expanded stays true). This contradicts PLAN D6 ('no disabled placeholders'). K43 confirmed for this surface. S3. · evidence: [007-footprint-variant-menu](../evidence/shots/vq3/light/007-footprint-variant-menu.png), [006-outline-row-rightclick](../evidence/shots/vq3/dark/006-outline-row-rightclick.png)

</details>


## T-110

**Inspector inputs have inconsistent keyboard semantics: Esc never reverts, Tolerance/X/Y ignore Enter differently from Value**

- Severity **S3** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate S
- Findings: Q3-018

**Summary.** Esc leaves the typed text in place and focus in the field (the bad value is then committed/rejected on blur with a global error strip 'Value must include a valid resistor unit (Ω, kΩ, MΩ)'). Value commits on Enter, but Tolerance does not (stays focused, rev unchanged 37 → 37; only Tab/blur commits → rev 38). (Positive: typing r/g/p/h/l/c in these inputs does NOT trigger canvas hotkeys.) [vq3] Also: with an empty Val…

**Root cause.** `src/modules/designer/frontend/components/SelectionInspector/PartInspectorPanel.tsx:449` — Value onKeyDown handles Enter only (no Esc revert)

**Proposed fix.** Inspector fields: Enter commits, Esc reverts, blur commits — uniformly. — Detail: Use one shared InspectorTextInput with Enter → blur/commit and Esc → reset draft + blur for Value, Tolerance, MPN, Manufacturer, X, Y, Rotation, Reference and label Text.

**Evidence.** [064-value-esc-no-revert](../evidence/shots/q3/dark/064-value-esc-no-revert.png), [019-value-esc-no-revert](../evidence/shots/vq3/dark/019-value-esc-no-revert.png)

<details><summary>Q3-018 — Inspector inputs have inconsistent keyboard semantics: Esc never reverts, Tolerance/X/Y ignore Enter differently from Value (S3, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox: select R1 → Properties
  2. Click Value, type 'rgphlc', press Esc
  3. Click Tolerance, type '5%', press Enter
- Expected: Esc reverts the draft to the stored value and leaves the field; Enter commits in every text field of the inspector
- Actual: Esc leaves the typed text in place and focus in the field (the bad value is then committed/rejected on blur with a global error strip 'Value must include a valid resistor unit (Ω, kΩ, MΩ)'). Value commits on Enter, but Tolerance does not (stays focused, rev unchanged 37 → 37; only Tab/blur commits → rev 38). (Positive: typing r/g/p/h/l/c in these inputs does NOT trigger canvas hotkeys.) [vq3] Also: with an empty Value, a typed Tolerance is silently discarded on blur (commitTolerance returns when valueStructured is undefined) while the field keeps displaying it.
- Screenshots: [064-value-esc-no-revert](../evidence/shots/q3/dark/064-value-esc-no-revert.png), [065-value-invalid-error](../evidence/shots/q3/dark/065-value-invalid-error.png)
- Network: `revision 37 after Enter in Tolerance, 38 after Tab`
- Code: `src/modules/designer/frontend/components/SelectionInspector/PartInspectorPanel.tsx:449` — Value onKeyDown handles Enter only (no Esc revert)
- Code: `src/modules/designer/frontend/components/SelectionInspector/PartInspectorPanel.tsx:466` — Tolerance input: onBlur only, no onKeyDown
- Code: `src/modules/designer/frontend/components/SelectionInspector/PartInspectorPanel.tsx:279` — commitTolerance silently returns when valueStructured is missing
- Suggested fix: Use one shared InspectorTextInput with Enter → blur/commit and Esc → reset draft + blur for Value, Tolerance, MPN, Manufacturer, X, Y, Rotation, Reference and label Text.
- Verification (vq3): **confirmed** — Reproduced on QA-Q3-vq3-a R1: typing 'rgx' in Value then Escape leaves 'rgx' in the field with focus still there. Value commits on Enter (rev 27 → 28). Tolerance ignores Enter (rev stays 28) and commits on Tab (29). Additional defect found: when the part has no structured value (empty Value), Tolerance edits are silently dropped even on blur, because commitTolerance returns early when valueStructured is undefined (PartInspectorPanel.tsx:277-279), yet the field keeps showing '5%'. The hotkeys r/g/x did not leak to the canvas. S3. · evidence: [019-value-esc-no-revert](../evidence/shots/vq3/dark/019-value-esc-no-revert.png)

</details>


## T-111

**Multi-select batch Value skips unit parsing/normalisation and allows one value across mixed components**

- Severity **S3** · category data · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate S
- Findings: Q3-019

**Summary.** R10/R11 stored value '1k' (no Ω, no valueStructured) — BOM/export now see two notations for resistors. With ⌘A (LED + resistors + 74HC00, 'Mixed components') the same free-text field applies e.g. '10nF' to every part. 'Delete all N' deletes only the parts (not the wires/ports also in the selection) with no confirmation, one undo step per part. [vq3] The batch write also leaves the previous valueStructured in place (…

**Root cause.** `src/modules/designer/frontend/components/SelectionInspector/MultiPartInspectorPanel.tsx:30` — applyBatchValue sends batchValue.trim() raw via update_parts_properties

**Proposed fix.** Batch Value uses the same unit parser; disable batch value for mixed component types. — Detail: Run parseInlineValue(inferValueKind) per part in applyBatchValue (disable when kinds differ, show the unit hint of the common kind in the placeholder), and make 'Delete all' reuse the canvas delete path (whole selection, single batch).

**Evidence.** [075-batch-value](../evidence/shots/q3/dark/075-batch-value.png), [023-batch-value-1k](../evidence/shots/vq3/dark/023-batch-value-1k.png)

<details><summary>Q3-019 — Multi-select batch Value skips unit parsing/normalisation and allows one value across mixed components (S3, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox: box-select R10 + R11 → Properties shows '2 parts · Same component · BATCH EDIT'
  2. Type '1k' in the batch field, press Enter
  3. Compare with single-part edit: R1 Value '4.7k' → stored '4.7kΩ' with valueStructured
- Expected: Batch edit uses the same parser as the single-part Value field (stores '1kΩ' + valueStructured, rejects unit-less/invalid values) and is disabled or kind-aware for 'Mixed components'
- Actual: R10/R11 stored value '1k' (no Ω, no valueStructured) — BOM/export now see two notations for resistors. With ⌘A (LED + resistors + 74HC00, 'Mixed components') the same free-text field applies e.g. '10nF' to every part. 'Delete all N' deletes only the parts (not the wires/ports also in the selection) with no confirmation, one undo step per part. [vq3] The batch write also leaves the previous valueStructured in place (R1: value '1k' but valueStructured 4.7 kΩ / 1%), so the two fields contradict each other.
- Screenshots: [075-batch-value](../evidence/shots/q3/dark/075-batch-value.png), [040-cmd-a](../evidence/shots/q3/dark/040-cmd-a.png)
- Network: `PART R10 '1k', R11 '1k' vs PART R1 '4.7kΩ'`
- Code: `src/modules/designer/frontend/components/SelectionInspector/MultiPartInspectorPanel.tsx:30` — applyBatchValue sends batchValue.trim() raw via update_parts_properties
- Code: `src/modules/designer/frontend/components/SelectionInspector/PartInspectorPanel.tsx:240` — single-part commitValue uses inferValueKind + parseInlineValue
- Suggested fix: Run parseInlineValue(inferValueKind) per part in applyBatchValue (disable when kinds differ, show the unit hint of the common kind in the placeholder), and make 'Delete all' reuse the canvas delete path (whole selection, single batch).
- Verification (vq3): **confirmed** — Reproduced on QA-Q3-vq3-a: R1 + R2 (same component) → batch '1k' → both stored as the raw string '1k' (no Ω, no valueStructured). Worse, R1 keeps its old propertiesJson.valueStructured {amount 4.7, unit kΩ, tolerance 1%}, so value and structured value now disagree. Code: applyBatchValue sends batchValue.trim() via update_parts_properties (MultiPartInspectorPanel.tsx:31-43) without parseInlineValue. deleteAll loops over parts only, one dispatch each, with no confirmation (:45-58). S3. · evidence: [023-batch-value-1k](../evidence/shots/vq3/dark/023-batch-value-1k.png)

</details>


## T-112

**Duplicate drops the copy 2.54 mm diagonal from the original; overlapping bounding boxes then make the copy unselectable by clicking**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate M
- Findings: Q3-020
- Depends on: ['T-095']

**Summary.** R11 overlaps R10 — R10's refdes text sits on R11's body. Clicking R11's body selects R10 (R10's hit box includes its label area); clicking R11's label selects U1 (whose oversized bbox covers it). R11 can only be selected via the Outline or a marquee. [vq3] Duplicate also drops the source part's Value/Tolerance/MPN/Manufacturer/DNP (it is a fresh place_part), and a wire lying inside U1's bbox cannot be grabbed — the…

**Root cause.** `src/modules/designer/frontend/components/OutlinePanel/OutlinePanel.tsx:274` — duplicatePart = place_part at +2.54/+2.54 mm; properties not copied

**Proposed fix.** Duplicate enters ghost/move mode (offset = grid pitch); hit-test prefers pins/graphics over large bboxes. — Detail: Duplicate via a command that copies propertiesJson (value, valueStructured, fields, DNP) and enter ghost/move mode for the copy (commit on click). Hit-test symbol graphics/pins/wires before part bounding boxes and prefer the smallest candidate, so a large symbol's bbox never steals clicks from parts or wires drawn inside it.

**Evidence.** [059-duplicate](../evidence/shots/q3/dark/059-duplicate.png), [021-duplicate](../evidence/shots/vq3/dark/021-duplicate.png)

<details><summary>Q3-020 — Duplicate drops the copy 2.54 mm diagonal from the original; overlapping bounding boxes then make the copy unselectable by clicking (S3, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox: Outline → R10 row → Actions → Duplicate (creates R11 at +2.54/+2.54 mm)
  2. Fit; click R11's zig-zag body on canvas; click R11's reference text
  3. With the 74HC00 (U1) on the sheet, clicking the +5V port or right-clicking the floating 'NET' label hits U1 instead (U1's box, inflated by the stray arc, covers them) — pressing R then rotated U1 unintentionally (rev 43)
- Expected: Duplicate is placed clear of the original (or enters move mode attached to the cursor, KiCad-style); clicking a visible symbol body selects that symbol
- Actual: R11 overlaps R10 — R10's refdes text sits on R11's body. Clicking R11's body selects R10 (R10's hit box includes its label area); clicking R11's label selects U1 (whose oversized bbox covers it). R11 can only be selected via the Outline or a marquee. [vq3] Duplicate also drops the source part's Value/Tolerance/MPN/Manufacturer/DNP (it is a fresh place_part), and a wire lying inside U1's bbox cannot be grabbed — the press drags U1.
- Screenshots: [059-duplicate](../evidence/shots/q3/dark/059-duplicate.png), [072-hit-test-overlap](../evidence/shots/q3/dark/072-hit-test-overlap.png), [073-box-select-live](../evidence/shots/q3/dark/073-box-select-live.png), [078-u1-rotated-by-accident](../evidence/shots/q3/dark/078-u1-rotated-by-accident.png)
- Code: `src/modules/designer/frontend/components/OutlinePanel/OutlinePanel.tsx:274` — duplicatePart = place_part at +2.54/+2.54 mm; properties not copied
- Suggested fix: Duplicate via a command that copies propertiesJson (value, valueStructured, fields, DNP) and enter ghost/move mode for the copy (commit on click). Hit-test symbol graphics/pins/wires before part bounding boxes and prefer the smallest candidate, so a large symbol's bbox never steals clicks from parts or wires drawn inside it.
- Verification (vq3): **confirmed** — Reproduced on QA-Q3-vq3-a. Outline → R1 → Duplicate created R2 at exactly +2.54/+2.54 mm, overlapping R1's label area, while the selection stayed on the original. Clicking R2's visible body selected U1, because U1's oversized bbox covers it. Pressing on a wire segment started a drag of U1 instead of the segment. Additional defect: Duplicate re-places the component from scratch (place_part, OutlinePanel.tsx:274-291), so Value/Tolerance/MPN/Manufacturer/DNP are NOT copied: R1 '4.7kΩ' → R2 value ''. S3 kept. · evidence: [021-duplicate](../evidence/shots/vq3/dark/021-duplicate.png), [022-click-r2-body-selects-u1](../evidence/shots/vq3/dark/022-click-r2-body-selects-u1.png), [030-wire-drag-grabs-u1-bbox](../evidence/shots/vq3/dark/030-wire-drag-grabs-u1-bbox.png)

</details>


## T-113

**Selected power/GND ports and net portals have no inspector, no status-bar entry, and ignore the R / Shift+R keys their menu advertises**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate M
- Findings: Q3-022

**Summary.** Properties shows 'Sheet — Nothing selected', status bar 'No selection'; R does nothing (rotation stays 0, rev unchanged) while the same action from the context menu works (rev 45 → 46, rotation 90). A placed '+5V' or 'SDA' portal cannot be renamed at all — delete and re-place is the only way.

**Root cause.** `src/modules/designer/frontend/components/SchematicCanvas.tsx:1860` — R handler requires selection.partIds.size > 0 — primitives ignored

**Proposed fix.** Ports/portals: inspector panel, status entry, R/Shift+R rotate as advertised. — Detail: Extend the R handler to rotate selected primitives (rotate_primitive), publish primitive selection to the shell, and add a PrimitiveInspectorPanel (kind, rail/portal text via an update command, rotation, net).

**Evidence.** [081-port-selected](../evidence/shots/q3/dark/081-port-selected.png), [018-gnd-selected](../evidence/shots/vq3/dark/018-gnd-selected.png)

<details><summary>Q3-022 — Selected power/GND ports and net portals have no inspector, no status-bar entry, and ignore the R / Shift+R keys their menu advertises (S3, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox: click the '+5V' power port (yellow selection box appears)
  2. Look at Properties dock and status bar; press R
  3. Right-click the port → 'Rotate 90° clockwise  R'
- Expected: Inspector shows the port (kind, rail/portal name editable, rotation, net) and status bar names it; R/Shift+R rotate it like the menu says
- Actual: Properties shows 'Sheet — Nothing selected', status bar 'No selection'; R does nothing (rotation stays 0, rev unchanged) while the same action from the context menu works (rev 45 → 46, rotation 90). A placed '+5V' or 'SDA' portal cannot be renamed at all — delete and re-place is the only way.
- Screenshots: [081-port-selected](../evidence/shots/q3/dark/081-port-selected.png)
- Network: `pwr 1ec179a5 rotationDeg 0 after R; 90 after menu Rotate`
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1860` — R handler requires selection.partIds.size > 0 — primitives ignored
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:2815` — primitive menu advertises shortcut 'R' / 'Shift+R'
- Code: `src/modules/designer/frontend/Space.tsx:782` — selectionSummary / inspector know parts, labels, wires, pins only
- Suggested fix: Extend the R handler to rotate selected primitives (rotate_primitive), publish primitive selection to the shell, and add a PrimitiveInspectorPanel (kind, rail/portal text via an update command, rotation, net).
- Verification (vq3): **confirmed** — Reproduced on QA-Q3-vq3-a: a GND port placed with G and clicked shows a yellow selection box, but Properties shows 'Sheet — Nothing selected', the status bar says 'No selection', and R leaves rotation 0 with the revision unchanged. The context menu advertises 'Rotate 90° clockwise  R' for primitives (SchematicCanvas.tsx:2815-2816). Code: the R handler requires selection.partIds.size > 0 (SchematicCanvas.tsx:1860-1866). S3. · evidence: [018-gnd-selected](../evidence/shots/vq3/dark/018-gnd-selected.png)

</details>


## T-114

**Place-component palette exposes internal metadata tags as filter chips ('kicad-footprint-id:capacitor_smd:c_020…', 'kicad-derived', 'imported-from-kicad', 'unknown', 'builtin', 'system')**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate S
- Findings: Q3-027

**Summary.** OTHER shows 'kicad-derived 15', 'imported-from-kicad 6', 'unknown 1' and three truncated 'kicad-footprint-id:…' chips that wrap the facet area onto two rows; preview pills show 'builtin', 'system', 'kicad-derived'. Facet counts also do not update with the search query (typing 'led' → 1 result but chips still show library-wide counts).

**Root cause.** `src/modules/designer/frontend/components/ComponentCommandPalette.tsx:99` — tag stats fetched once per open (library-wide counts)

**Proposed fix.** Hide internal tags (kicad-*, imported-*, builtin, system, user) from palette chips. — Detail: Filter tags with an allow/deny list (drop 'kicad-*', 'imported-*', 'builtin', 'system', 'unknown', anything containing ':'), move provenance to a Source facet, and recompute facet counts from the current result set.

**Evidence.** [092-palette-1100](../evidence/shots/q3/dark/092-palette-1100.png), [007-palette-nand](../evidence/shots/vq3/dark/007-palette-nand.png)

<details><summary>Q3-027 — Place-component palette exposes internal metadata tags as filter chips ('kicad-footprint-id:capacitor_smd:c_020…', 'kicad-derived', 'imported-from-kicad', 'unknown', 'builtin', 'system') (S3, confirmed)</summary>

- Area designer.schematic · stack A · design None · themes dark · viewports 1440x900, 1100x720
- Repro:
  1. Any design (Schem) → ⌘K
  2. Look at the OTHER facet row and the tag pills in the preview pane
  3. Light theme: preview pills for imported parts also show 'kicad-lib-id:device:led' and 'kicad-footprint-id:led_smd:led_0201_0603metric'
- Expected: Facets/tags limited to user-meaningful attributes (function, package, mount, voltage…); provenance/internal ids hidden or shown as a 'Source' facet
- Actual: OTHER shows 'kicad-derived 15', 'imported-from-kicad 6', 'unknown 1' and three truncated 'kicad-footprint-id:…' chips that wrap the facet area onto two rows; preview pills show 'builtin', 'system', 'kicad-derived'. Facet counts also do not update with the search query (typing 'led' → 1 result but chips still show library-wide counts).
- Screenshots: [092-palette-1100](../evidence/shots/q3/dark/092-palette-1100.png), [016-palette-open](../evidence/shots/q3/dark/016-palette-open.png), [017-palette-search-led](../evidence/shots/q3/dark/017-palette-search-led.png), [006-palette](../evidence/shots/q3/light/006-palette.png)
- Code: `src/modules/designer/frontend/components/ComponentCommandPalette.tsx:99` — tag stats fetched once per open (library-wide counts)
- Code: `src/modules/designer/frontend/components/ComponentCommandPalette.tsx:223` — groupTags(..., {excludeSystem:true}) keeps kicad-* provenance tags
- Code: `src/modules/designer/frontend/components/ComponentCommandPalette.tsx:503` — preview pills show raw tags
- Code: `src/modules/library/frontend/tag-grouping.ts:1` — shared grouping — add provenance/id-tag deny list here
- Suggested fix: Filter tags with an allow/deny list (drop 'kicad-*', 'imported-*', 'builtin', 'system', 'unknown', anything containing ':'), move provenance to a Source facet, and recompute facet counts from the current result set.
- Verification (vq3): **confirmed** — Confirmed. The palette's OTHER facet row shows 'kicad-derived 15', 'imported-from-kicad 6' and truncated 'kicad-footprint-id:…' chips. With query 'nand' (1 result) the facet counts are still library-wide. Preview pills show 'kicad-lib-id:device:led', 'kicad-footprint-id:led_smd:…' and 'kicad-derived'. Code: tags are fetched once per open (ComponentCommandPalette.tsx:96-110) and grouped with groupTags(availableTags, {excludeSystem:true}) (:223, from library/frontend/tag-grouping.ts), which does not drop kicad-*/imported-* provenance tags. Preview pills render raw highlighted.tags (:501-503). The same grouping feeds the Library 'Other' facet ('imported-from-kicad 6' is visible there too), so fix it in tag-grouping.ts. S3. · evidence: [007-palette-nand](../evidence/shots/vq3/dark/007-palette-nand.png), [005-palette](../evidence/shots/vq3/light/005-palette.png), [015-open-in-library](../evidence/shots/vq3/dark/015-open-in-library.png)

</details>


## T-115

**Schematic canvas background is blue-tinted in both themes (#f0f4fb light, #0e1116 dark) instead of the neutral surface tokens**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: Q3-029 · known ref K38

**Summary.** Light canvas #f0f4fb (B−R = +11, visibly bluish against the #f7f7f8 sidebar/dock); dark canvas #0e1116 (package default, blue cast) next to #111113 panels. The light value is hard-coded with a stale comment claiming it 'tracks the app surface'.

**Root cause.** `src/modules/designer/frontend/components/SchematicCanvas.tsx:941` — const canvasBackground = mode === 'light' ? '#f0f4fb' : undefined

**Proposed fix.** Schematic canvas bg from neutral tokens in both themes (no #f0f4fb/#0e1116). — Detail: Read the background from CSS tokens (getComputedStyle(--surface-app) in light, --color-surface-schematic-well in dark) and pass both to EdaCanvas backgroundColor; update the package default to the token values.

**Evidence.** [003-sandbox-fit](../evidence/shots/q3/light/003-sandbox-fit.png), [003-sandbox-fit](../evidence/shots/vq3/light/003-sandbox-fit.png)

<details><summary>Q3-029 — Schematic canvas background is blue-tinted in both themes (#f0f4fb light, #0e1116 dark) instead of the neutral surface tokens (S3, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes light, dark · viewports 1440x900
- Repro:
  1. Open QA-Q3-sandbox (Schem) in light theme, Fit
  2. Probe the empty canvas; repeat in dark theme
- Expected: Neutral canvas matching the redesign (light: --surface-app #f2f2f3 / panel #f7f7f8; dark: --color-surface-schematic-well #101012 or --surface-canvas-well #08090a) — no blue/slate cast next to neutral side panels
- Actual: Light canvas #f0f4fb (B−R = +11, visibly bluish against the #f7f7f8 sidebar/dock); dark canvas #0e1116 (package default, blue cast) next to #111113 panels. The light value is hard-coded with a stale comment claiming it 'tracks the app surface'.
- Screenshots: [003-sandbox-fit](../evidence/shots/q3/light/003-sandbox-fit.png), [026-fit-sandbox](../evidence/shots/q3/dark/026-fit-sandbox.png)
- Pixel probes: {"file": "shots/q3/light/003-sandbox-fit.png", "x": 400, "y": 800, "hex": "#f0f4fb", "nearestToken": "--surface-app", "deltaE": 3.4}; {"file": "shots/q3/light/003-sandbox-fit.png", "x": 200, "y": 500, "hex": "#f7f7f8", "nearestToken": "--surface-panel", "deltaE": 0.0}; {"file": "shots/q3/dark/026-fit-sandbox.png", "x": 700, "y": 200, "hex": "#0e1116", "nearestToken": "--primary-foreground", "deltaE": 1.8}
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:941` — const canvasBackground = mode === 'light' ? '#f0f4fb' : undefined
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/theme/canvasTheme.js:122` — getDefaultCanvasBackground dark → #0e1116
- Suggested fix: Read the background from CSS tokens (getComputedStyle(--surface-app) in light, --color-surface-schematic-well in dark) and pass both to EdaCanvas backgroundColor; update the package default to the token values.
- Verification (vq3): **confirmed** — Pixel probes. Light: the canvas is #f0f4fb (B−R = +11, a blue cast) next to #f7f7f8 panels. Dark: the canvas is #0e1116 next to #111113 panels. The light value is a hard-coded in-tree constant whose comment wrongly claims it 'tracks the app surface' (SchematicCanvas.tsx:938-941), while --surface-app is #f2f2f3. The dark value is the package default. design-tokens.md §7 records the canvas palette as a follow-up in @openpcb/r3f-eda-canvas, so the dark half is shared-package work. The light constant is in-tree and XS. K38 confirmed. S3. · evidence: [003-sandbox-fit](../evidence/shots/vq3/light/003-sandbox-fit.png), [029-vq3a-fit](../evidence/shots/vq3/dark/029-vq3a-fit.png)

</details>


## T-116

**Schematic canvas palette ignores the neutral redesign: violet selection (light) vs amber selection (dark) vs cyan UI --selection, violet net portals, slate-blue wires/labels**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **defer** · owner followup · wave followup · scope shared-package · estimate S
- Findings: Q3-030

**Summary.** Light: part selection box/wire highlight violet (#a462e4 / #bd92ec), 'SDA' portal violet #8b31dd. Dark: selection amber (#fbbf24 family — same hue as the yellow refdes text #e6c84d, so a selected part is hard to tell from an unselected one), drag ghost violet #a78bfa, portal violet #7c3aed, wires/labels slate-blue #94a3b8. The Outline/dock use cyan #33d1ff for the same selection. Selected net labels get no highlight…

**Root cause.** `node_modules/@openpcb/r3f-eda-canvas/dist/theme/canvasTheme.js:4` — SCHEMATIC_LIGHT selectionColor/wireSelectedColor/partOutlineColor #7c3aed; SCHEMATIC_DARK selectionColor #fbbf24, dragGhostColor #a78bfa, primitivePortalColor #7c3aed ('matches app primary brand'), wire/label #94a3b8

**Proposed fix.** @openpcb/r3f-eda-canvas canvasTheme: neutral palette, selection = --selection. — Detail: In @openpcb/r3f-eda-canvas re-derive SCHEMATIC_LIGHT/DARK from the redesign tokens (selection = --selection, portal = --net-signal or --text-strong, wires = neutral grey, labels = --text-secondary) and give labels a selection outline; republish and re-pin.

**Evidence.** [004-part-selected](../evidence/shots/q3/light/004-part-selected.png), [004-r1-selected](../evidence/shots/vq3/light/004-r1-selected.png)

<details><summary>Q3-030 — Schematic canvas palette ignores the neutral redesign: violet selection (light) vs amber selection (dark) vs cyan UI --selection, violet net portals, slate-blue wires/labels (S3, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes light, dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox: select R1 in light theme, then in dark theme
  2. Compare with the Outline row selection bar and look at the 'SDA' net portal
- Expected: One selection colour app-wide (--selection: #0891b2 light / #33d1ff dark), no violet anywhere (PLAN D-series neutral EDA), neutral/grey signal wires and labels, portal/port colours from --net-* tokens
- Actual: Light: part selection box/wire highlight violet (#a462e4 / #bd92ec), 'SDA' portal violet #8b31dd. Dark: selection amber (#fbbf24 family — same hue as the yellow refdes text #e6c84d, so a selected part is hard to tell from an unselected one), drag ghost violet #a78bfa, portal violet #7c3aed, wires/labels slate-blue #94a3b8. The Outline/dock use cyan #33d1ff for the same selection. Selected net labels get no highlight at all (only text brightens #6e7782 → #919397).
- Screenshots: [004-part-selected](../evidence/shots/q3/light/004-part-selected.png), [004b-selection-crop](../evidence/shots/q3/light/004b-selection-crop.png), [028-drag-part-done](../evidence/shots/q3/dark/028-drag-part-done.png), [039-label-inspector](../evidence/shots/q3/dark/039-label-inspector.png), [084-comment-posted](../evidence/shots/q3/dark/084-comment-posted.png)
- Pixel probes: {"file": "shots/q3/dark/028-drag-part-done.png", "x": 81, "y": 190, "hex": "#33d1ff", "nearestToken": "--selection", "deltaE": 0.0}; {"file": "shots/q3/dark/028-drag-part-done.png", "x": 489, "y": 299, "hex": "#e6c84d", "nearestToken": "--net-bus", "deltaE": 8.0}
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/theme/canvasTheme.js:4` — SCHEMATIC_LIGHT selectionColor/wireSelectedColor/partOutlineColor #7c3aed; SCHEMATIC_DARK selectionColor #fbbf24, dragGhostColor #a78bfa, primitivePortalColor #7c3aed ('matches app primary brand'), wire/label #94a3b8
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:3616` — PartSelectionOutline color={t.selectionColor}
- Suggested fix: In @openpcb/r3f-eda-canvas re-derive SCHEMATIC_LIGHT/DARK from the redesign tokens (selection = --selection, portal = --net-signal or --text-strong, wires = neutral grey, labels = --text-secondary) and give labels a selection outline; republish and re-pin.
- Verification (vq3): **confirmed** — Pixel probes. Light: R1's selection box is #bd92ec (violet) and the SDA portal #8b31dd, while the outline selection bar uses --selection #0891b2. Dark: the selection box is #e6c84d (amber), the same hue as the refdes text, while the outline bar is #33d1ff. Refutation considered: PLAN §0 lists the canvas palette as a non-goal of the redesign run, and §9 plus design-tokens.md §7 record it as a follow-up. So this is a known deferred gap, not a regression. It still visibly breaks the neutral one-selection-colour rule, so it stays confirmed at S3 with fixScope shared-package. · evidence: [004-r1-selected](../evidence/shots/vq3/light/004-r1-selected.png), [017-r1-after-R](../evidence/shots/vq3/dark/017-r1-after-R.png), [018-gnd-selected](../evidence/shots/vq3/dark/018-gnd-selected.png)

</details>


## T-117

**'Fit schematic' cannot fit an imported KiCad sheet (zoom floor 20) — parts stay off-canvas; toolbar Zoom-out floor differs from wheel**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: Q5-023

**Summary.** Fit schematic stops at zoom 10% (fitCamera floor camera.zoom >= 5), so a KiCad A4-scale sheet never fits the ~800 px canvas; D3–D5, J2 area and J1's leftover wires are clipped at the left edge. The Zoom-out button also floors at 5 (10%) while the wheel reaches 1%, so the button appears broken at 10%.

**Root cause.** `src/modules/designer/frontend/components/SchematicCanvas.tsx:1154` — fitCamera clamps camera.zoom to >= 5 (readout 10%)

**Proposed fix.** Allow Fit to go below 20 % (min zoom matching wheel clamp); unify toolbar/wheel zoom floors. — Detail: In SchematicCanvas.fitCamera (line 1154) and zoomOut (line 1239) use the same MIN_ZOOM as the wheel handler in @openpcb/r3f-eda-canvas (or compute the floor from content bounds); keep frameBounds' floor (line 1216) separate for selection framing; auto-fit imported designs on first open.

**Evidence.** [047-import-schem-fit](../evidence/shots/q5/dark/047-import-schem-fit.png), [018-import-schem-fit](../evidence/shots/vq5/dark/018-import-schem-fit.png)

<details><summary>Q5-023 — 'Fit schematic' cannot fit an imported KiCad sheet (zoom floor 20) — parts stay off-canvas; toolbar Zoom-out floor differs from wheel (S3, confirmed)</summary>

- Area designer.schematic · stack A · design 70d12af0-c3c1-46e7-a9f7-d5b352df1eb0 · themes dark · viewports 1440x900
- Repro:
  1. Open imported QA-q5-USBtoUART → Schem (initial view already clips the left third)
  2. Click 'Fit schematic' → nothing changes (readout 10%)
  3. Click 'Zoom out' twice → still 10%
  4. Mouse-wheel out → zoom goes to 2% and the whole sheet becomes visible
- Expected: Fit shows the whole drawing (all 18 parts) regardless of size; toolbar zoom-out and wheel share the same limits.
- Actual: Fit schematic stops at zoom 10% (fitCamera floor camera.zoom >= 5), so a KiCad A4-scale sheet never fits the ~800 px canvas; D3–D5, J2 area and J1's leftover wires are clipped at the left edge. The Zoom-out button also floors at 5 (10%) while the wheel reaches 1%, so the button appears broken at 10%.
- Screenshots: [047-import-schem-fit](../evidence/shots/q5/dark/047-import-schem-fit.png), [048-import-schem-zoomout](../evidence/shots/q5/dark/048-import-schem-zoomout.png), [056-import-schem-wheel-out](../evidence/shots/q5/dark/056-import-schem-wheel-out.png)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1154` — fitCamera clamps camera.zoom to >= 5 (readout 10%)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1239` — zoomOut() floor 5
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1216` — frameBounds floor 20 (frame-to-selection / cross-probe) — separate, larger floor
- Suggested fix: In SchematicCanvas.fitCamera (line 1154) and zoomOut (line 1239) use the same MIN_ZOOM as the wheel handler in @openpcb/r3f-eda-canvas (or compute the floor from content bounds); keep frameBounds' floor (line 1216) separate for selection framing; auto-fit imported designs on first open.
- Verification (vq5): **confirmed** — Reproduced on QA-q5-USBtoUART: 'Fit schematic' -> zoom 10% with D3–D5/J2 area clipped at the left edge; 'Zoom out' x2 stays 10%; mouse wheel goes down to 1%. Root-cause correction: 'Fit schematic' calls fitCamera (SchematicCanvas.tsx:1121-1157) whose floor is Math.max(5, …) = 10% readout, not frameBounds' Math.max(20, …) at :1216 (that one only affects frameToBoundsMm/zoom-to-selection). zoomOut floor is also 5 (:1239) while the wheel (canvas package) has a lower limit. · evidence: [018-import-schem-fit](../evidence/shots/vq5/dark/018-import-schem-fit.png), [019-import-schem-wheel-out](../evidence/shots/vq5/dark/019-import-schem-wheel-out.png), dom: zoom readout 10% after Fit and after 2x Zoom out; 1% after wheel

</details>


## T-393

**Place-component palette symbol preview stays black (#131313) in light theme while the schematic canvas is light**

- Severity **S3** · category visual · status rejected · themes light
- Recommendation **wont-fix** · owner — · wave followup · scope frontend · estimate XS
- Findings: Q3-031

**Summary.** REJECTED — Intentional per the redesign decisions. Canvas and preview wells are theme-invariant dark: D1 defines --surface-canvas-well = #08090a in both themes, design-tokens.md §3 says 'Only the canvas and layer palettes are theme-invariant', and the T6 run log says 'wells are always dark'. The palette preview (#131313) matches every other preview surface in light theme: the Library preview pane probes #131313 in light too (s…

**Root cause.** `src/modules/designer/frontend/components/ComponentCommandPalette.tsx:17` — SymbolPreviewCanvas rendered without a theme-aware background (package dark default #131313)

**Proposed fix.** None — preview wells theme-invariant dark by decision.

**Evidence.** [006-palette](../evidence/shots/q3/light/006-palette.png), [005-palette](../evidence/shots/vq3/light/005-palette.png)

<details><summary>Q3-031 — Place-component palette symbol preview stays black (#131313) in light theme while the schematic canvas is light (S3, rejected)</summary>

- Area designer.schematic · stack A · design None · themes light · viewports 1440x900
- Repro:
  1. Light theme → any design (Schem) → ⌘K
  2. Look at the symbol preview well on the right
- Expected: Preview uses the same light canvas surface as the schematic it will be placed on (theme parity)
- Actual: Preview well is #131313 (dark) with white strokes inside an otherwise light dialog; the symbol then appears in black on a light canvas after placement.
- Screenshots: [006-palette](../evidence/shots/q3/light/006-palette.png)
- Pixel probes: {"file": "shots/q3/light/006-palette.png", "x": 900, "y": 300, "hex": "#131313", "nearestToken": "--text-strong", "deltaE": 2.0}
- Code: `src/modules/designer/frontend/components/ComponentCommandPalette.tsx:17` — SymbolPreviewCanvas rendered without a theme-aware background (package dark default #131313)
- Suggested fix: Pass the resolved theme / token background (and preview colours) to SymbolPreviewCanvas, same as SchematicCanvas does.
- Verification (vq3): **rejected** — Intentional per the redesign decisions. Canvas and preview wells are theme-invariant dark: D1 defines --surface-canvas-well = #08090a in both themes, design-tokens.md §3 says 'Only the canvas and layer palettes are theme-invariant', and the T6 run log says 'wells are always dark'. The palette preview (#131313) matches every other preview surface in light theme: the Library preview pane probes #131313 in light too ([006-library-preview-light](../evidence/shots/vq3/light/006-library-preview-light.png)), and the Home thumbnails do the same (Q1-017 was rejected on the same grounds). The outlier is the in-tree light schematic canvas (#f0f4fb, Q3-029), not the preview. Residual note for the §9 canvas-palette follow-up: align preview and schematic-canvas backgrounds together. · evidence: [005-palette](../evidence/shots/vq3/light/005-palette.png), [006-library-preview-light](../evidence/shots/vq3/light/006-library-preview-light.png)

</details>


## T-118

**Long Value / net-label text is drawn as one unbounded line across the whole schematic, ignored by 'Fit schematic', and a same-named net portal shows as a second identical net**

- Severity **S4** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate S
- Findings: F1B-030

**Summary.** U1's value is drawn as a single ~1,450 px line running off both sides of the fitted canvas (Fit only frames symbol bodies). The 80-char net label is drawn from R1 pin 2 straight through U1's body, over the DISCH/OUT pin names. The net portal with the identical text forms a separate 0-pin net (projection nets 'pt:30480000:-10160000' 2 pins and 'pt:8414275:-2064275' 0 pins, same name), so Outline → Nets lists two rows…

**Root cause.** `src/modules/designer/backend/projection-world.ts:556` — portal names only union with other portals/pwr/gnd; DesignerLabel text never joins the portal namespace

**Proposed fix.** Cap label/value text width (ellipsis) and include text in Fit bounds. — Detail: Include field-text bounds in the schematic fit bounds; elide canvas field text beyond N chars (KiCad-style long fields are rare — a max length on Value/label text of ~64 chars with inspector showing full text is simplest). Either put label text into the same name namespace as portals or raise an ERC 'duplicate net name on different nets' warning, and disambiguate duplicate names in Outline (append pin count / id).

**Evidence.** [108-long-schem-fit](../evidence/shots/f1b/dark/108-long-schem-fit.png), [012-long-schem-fit](../evidence/shots/vf1b/dark/012-long-schem-fit.png)

<details><summary>F1B-030 — Long Value / net-label text is drawn as one unbounded line across the whole schematic, ignored by 'Fit schematic', and a same-named net portal shows as a second identical net (S4, confirmed)</summary>

- Area designer.schematic · stack A · design 43a2da78-9d2e-43a0-bcd3-ecebe3f72551 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Open QA-f1b-long → Schem (U1 Value = 200-char description; net label and a net portal both named 'VERY_LONG_NET_LABEL_FOR_QA…' (80 chars))
  2. Click Fit schematic
  3. Zoom to 25% around R123456789/U1
  4. Outline → Nets tab
- Expected: Fit schematic frames all visible text; field text longer than a sensible limit is elided on canvas (full text in inspector/tooltip), or the Value field enforces a length; a net portal that shares a net label's name is the same net (or ERC flags the clash).
- Actual: U1's value is drawn as a single ~1,450 px line running off both sides of the fitted canvas (Fit only frames symbol bodies). The 80-char net label is drawn from R1 pin 2 straight through U1's body, over the DISCH/OUT pin names. The net portal with the identical text forms a separate 0-pin net (projection nets 'pt:30480000:-10160000' 2 pins and 'pt:8414275:-2064275' 0 pins, same name), so Outline → Nets lists two rows that both read 'VERY_LONG_NET_LABEL_FO…' with no way to tell them apart. (Same-named labels never joining is Q3-013; this is the label↔portal variant plus the duplicate-name display.) Note: resistor Value rejects free text ('Value must include a valid resistor unit'), so the long-value case is reachable on ICs/connectors only.
- Screenshots: [108-long-schem-fit](../evidence/shots/f1b/dark/108-long-schem-fit.png), [109-long-schem-label-overlap](../evidence/shots/f1b/dark/109-long-schem-label-overlap.png), [067-long-outline-nets](../evidence/shots/f1b/dark/067-long-outline-nets.png), [002-long-schem-inspector](../evidence/shots/f1b/light/002-long-schem-inspector.png), [061-long-value-rejected](../evidence/shots/f1b/dark/061-long-value-rejected.png)
- Network: `GET /api/modules/designer/designs/43a2da78…/projection/schematic → nets[VERY_LONG…] ×2 (2 pins + label; 0 pins + net_portal)`
- Code: `src/modules/designer/backend/projection-world.ts:556` — portal names only union with other portals/pwr/gnd; DesignerLabel text never joins the portal namespace
- Code: `src/modules/designer/backend/projection-world.ts:728` — global named-net union covers gnd/pwr/net_portal only
- Suggested fix: Include field-text bounds in the schematic fit bounds; elide canvas field text beyond N chars (KiCad-style long fields are rare — a max length on Value/label text of ~64 chars with inspector showing full text is simplest). Either put label text into the same name namespace as portals or raise an ERC 'duplicate net name on different nets' warning, and disambiguate duplicate names in Outline (append pin count / id).
- Verification (vf1b): **confirmed** — Reproduced on QA-f1b-long. After 'Fit schematic' (13%) U1's 200-char value runs off both canvas edges, and the 80-char label runs through U1's body. Outline Nets lists two rows that both read 'VERY_LONG_NET_LABEL_FO…' (2 pins / 0 pins). The label-vs-portal net split has the same root cause as verified Q3-013 (the named-net union covers gnd/pwr/net_portal only; labels never join by name), so only the unbounded text, the fit bounds and the indistinguishable duplicate rows are new here. S4 kept (pathological field lengths). · evidence: [012-long-schem-fit](../evidence/shots/vf1b/dark/012-long-schem-fit.png), [013b-long-outline-nets-zoom](../evidence/shots/vf1b/dark/013b-long-outline-nets-zoom.png)

</details>


## T-119

**Place-component search ranks an imported KiCad 'Device:R' above the Core 'Resistor' for the query 'resistor' (Enter places the imported part)**

- Severity **S4** · category consistency · status confirmed · themes dark
- Recommendation **defer** · owner L1 · wave followup · scope backend · estimate XS
- Findings: F2A-022

**Summary.** Row 1 'Device:R smd — Imported from KiCad project (Device:R)' carries ENTER; 'Resistor Core' is row 2. A keyboard user gets an unvalued imported part with a KiCad lib-id as its name.

**Root cause.** `src/modules/library/backend/queries.ts:868` — searchComponents orders matches by components.name only (alphabetical): 'Device:R' < 'Resistor', 'Connector:Conn_01x05_Pin' < 'Pin Header…' — no relevance or source ranking

**Proposed fix.** Backend search ranking: exact/prefix name, core before imported. — Detail: In library searchComponents rank results: exact/prefix name match > name contains > description/tag match, then core/curated source before imported-from-kicad, then name; the palette keeps server order.

**Evidence.** [006-palette-resistor](../evidence/shots/f2a/dark/006-palette-resistor.png), [006-palette-resistor](../evidence/shots/vf2a/dark/006-palette-resistor.png)

<details><summary>F2A-022 — Place-component search ranks an imported KiCad 'Device:R' above the Core 'Resistor' for the query 'resistor' (Enter places the imported part) (S4, confirmed)</summary>

- Area designer.schematic · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. Cmd+K, type 'resistor' with the pointer outside the list
  2. Look at the first (ENTER) row
- Expected: Core/curated parts whose name matches rank above imported parts that only match via description/tags.
- Actual: Row 1 'Device:R smd — Imported from KiCad project (Device:R)' carries ENTER; 'Resistor Core' is row 2. A keyboard user gets an unvalued imported part with a KiCad lib-id as its name.
- Screenshots: [006-palette-resistor](../evidence/shots/f2a/dark/006-palette-resistor.png)
- Code: `src/modules/library/backend/queries.ts:868` — searchComponents orders matches by components.name only (alphabetical): 'Device:R' < 'Resistor', 'Connector:Conn_01x05_Pin' < 'Pin Header…' — no relevance or source ranking
- Suggested fix: In library searchComponents rank results: exact/prefix name match > name contains > description/tag match, then core/curated source before imported-from-kicad, then name; the palette keeps server order.
- Verification (vf2a): **confirmed** — QA-vf2a-a, pointer outside the list, Cmd+K 'resistor': row 1 'Device:R smd — Imported from KiCad project (Device:R)' carries ENTER, and 'Resistor CORE' is row 2 (shot 006). Root cause is the backend's alphabetical ORDER BY name, not the palette. fixScope changed to backend-needed. S4 kept: both results are resistors. · evidence: [006-palette-resistor](../evidence/shots/vf2a/dark/006-palette-resistor.png)

</details>


## T-120

**Wheel zoom-out goes down to 1% where the whole schematic vanishes, while the −/+ buttons clamp at 10%**

- Severity **S4** · category bug · status confirmed · themes dark
- Recommendation **defer** · owner followup · wave followup · scope shared-package · estimate S
- Findings: Q3-024

**Summary.** At 1% the schematic is sub-pixel and only the comment pin remains visible — looks like an empty design. Small wheel-in notches at 1% did not change the readout (5× −100 stayed 1%); zoom-out button stops at 10% (camera.zoom 5). Two different clamps.

**Root cause.** `node_modules/@openpcb/r3f-eda-canvas/dist/camera/use-eda-camera.js:46` — MIN_ZOOM = 0.01 for wheel

**Proposed fix.** use-eda-camera: wheel zoom floor = button floor (10 %). — Detail: Pass a minZoom derived from the content/sheet bounds (or at least 5) into the EdaCanvas camera so wheel and buttons share one clamp.

**Evidence.** [088-min-zoom](../evidence/shots/q3/dark/088-min-zoom.png), [025-wheel-min-zoom](../evidence/shots/vq3/dark/025-wheel-min-zoom.png)

<details><summary>Q3-024 — Wheel zoom-out goes down to 1% where the whole schematic vanishes, while the −/+ buttons clamp at 10% (S4, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. QA-Q3-sandbox: pointer over canvas, scroll the wheel out ~15 notches
  2. Status bar shows 'zoom 1%'; scroll back in with small notches
- Expected: A sane minimum (e.g. whole sheet ≈ 10–20% of the viewport) shared by wheel and buttons
- Actual: At 1% the schematic is sub-pixel and only the comment pin remains visible — looks like an empty design. Small wheel-in notches at 1% did not change the readout (5× −100 stayed 1%); zoom-out button stops at 10% (camera.zoom 5). Two different clamps.
- Screenshots: [088-min-zoom](../evidence/shots/q3/dark/088-min-zoom.png)
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/camera/use-eda-camera.js:46` — MIN_ZOOM = 0.01 for wheel
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1239` — zoomOut clamps Math.max(zoom/1.15, 5)
- Suggested fix: Pass a minZoom derived from the content/sheet bounds (or at least 5) into the EdaCanvas camera so wheel and buttons share one clamp.
- Verification (vq3): **confirmed** — Reproduced: repeated wheel-out reached 'zoom 3%' where the sheet is a speck, while the −/+ buttons clamp at 10%. Code: wheel clamp MIN_ZOOM = 0.01 (node_modules/@openpcb/r3f-eda-canvas/dist/camera/use-eda-camera.js:46), button clamp Math.max(zoom/1.15, 5) (SchematicCanvas.tsx:1239). S4. · evidence: [025-wheel-min-zoom](../evidence/shots/vq3/dark/025-wheel-min-zoom.png)

</details>


## T-121

**Console noise on every schematic session: Radix 'Missing Description for DialogContent' per palette open and THREE.Clock deprecation per canvas mount**

- Severity **S4** · category console · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: Q3-028

**Summary.** 27 warnings in one session: 7× 'Warning: Missing `Description` or `aria-describedby={undefined}` for {DialogContent}' (one per palette open) and 20× 'THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.' (one per R3F canvas mount).

**Root cause.** `src/modules/designer/frontend/components/ComponentCommandPalette.tsx:291` — DialogPrimitive.Content without Description / aria-describedby

**Proposed fix.** Add Dialog.Description (or aria-describedby={undefined}) to palette; THREE.Clock noise tracked in package follow-up. — Detail: Add a visually-hidden DialogDescription (or aria-describedby={undefined}) to the palette; bump @react-three/fiber / pin three to a version that uses THREE.Timer, or filter the warning in dev.

**Evidence.** `console: [WARNING] Warning: Missing `Description` or `aria-describedby={undefined}` for {DialogContent}.`

<details><summary>Q3-028 — Console noise on every schematic session: Radix 'Missing Description for DialogContent' per palette open and THREE.Clock deprecation per canvas mount (S4, confirmed)</summary>

- Area designer.schematic · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Open a design (Schem), open/close the ⌘K palette a few times, switch tabs/views
  2. playwright console warning
- Expected: Clean console
- Actual: 27 warnings in one session: 7× 'Warning: Missing `Description` or `aria-describedby={undefined}` for {DialogContent}' (one per palette open) and 20× 'THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.' (one per R3F canvas mount).
- Console: `[WARNING] Warning: Missing `Description` or `aria-describedby={undefined}` for {DialogContent}.`; `[WARNING] THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`
- Code: `src/modules/designer/frontend/components/ComponentCommandPalette.tsx:291` — DialogPrimitive.Content without Description / aria-describedby
- Suggested fix: Add a visually-hidden DialogDescription (or aria-describedby={undefined}) to the palette; bump @react-three/fiber / pin three to a version that uses THREE.Timer, or filter the warning in dev.
- Verification (vq3): **confirmed** — Reproduced. The vq3-dark console had 12× 'THREE.Clock: This module has been deprecated' and 4× 'Missing `Description` or `aria-describedby={undefined}` for {DialogContent}'. Code: the palette uses Radix Dialog Content without a Description (ComponentCommandPalette.tsx:288-291). S4.

</details>


## T-122

**Toolbar icon semantics: 'Zoom to selection' uses a '#' Frame glyph that reads as a grid toggle; GND uses a double-chevron**

- Severity **S4** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate XS
- Findings: Q3-037

**Summary.** lucide Frame (looks like '#') for Zoom to selection next to ScanSearch for Fit; ChevronsDown for GND, Zap for PWR, ArrowRightFromLine for Portal.

**Root cause.** `src/modules/designer/frontend/components/DesignerFloatingToolbar.tsx:93` — icon={<Frame />}

**Proposed fix.** 'Zoom to selection' uses a zoom/scan icon; GND uses ground glyph. — Detail: Use Focus/ScanSearch for zoom-to-selection and Maximize/Expand for Fit; add custom ground/power glyphs.

**Evidence.** [028-drag-part-done](../evidence/shots/q3/dark/028-drag-part-done.png), [016-back-to-designer](../evidence/shots/vq3/dark/016-back-to-designer.png)

<details><summary>Q3-037 — Toolbar icon semantics: 'Zoom to selection' uses a '#' Frame glyph that reads as a grid toggle; GND uses a double-chevron (S4, confirmed)</summary>

- Area designer.schematic · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Look at the schematic toolbar between Fit and Components
- Expected: Recognisable EDA icons (zoom-to-selection = magnifier+box / focus; GND = ground symbol), especially since the schematic has no grid
- Actual: lucide Frame (looks like '#') for Zoom to selection next to ScanSearch for Fit; ChevronsDown for GND, Zap for PWR, ArrowRightFromLine for Portal.
- Screenshots: [028-drag-part-done](../evidence/shots/q3/dark/028-drag-part-done.png)
- Code: `src/modules/designer/frontend/components/DesignerFloatingToolbar.tsx:93` — icon={<Frame />}
- Suggested fix: Use Focus/ScanSearch for zoom-to-selection and Maximize/Expand for Fit; add custom ground/power glyphs.
- Verification (vq3): **confirmed** — Code-confirmed: DesignerFloatingToolbar.tsx:93 Frame (renders like '#', beside ScanSearch for Fit), :117 ChevronsDown for GND, :127 Zap for PWR, :137 ArrowRightFromLine for Portal. Visible in every schematic screenshot. Subjective icon polish. S4. · evidence: [016-back-to-designer](../evidence/shots/vq3/dark/016-back-to-designer.png)

</details>


## T-123

**Small schematic feedback gaps: DNP parts look unchanged, 'View on PCB' does not frame the part, filtering all ERC severities shows a blank list, Outline header count mixes parts+nets+labels**

- Severity **S4** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D2 · wave W2 · scope frontend · estimate S
- Findings: Q3-038

**Summary.** As described; the numbers/visual states give no feedback.

**Root cause.** `src/modules/designer/frontend/components/OutlinePanel/OutlinePanel.tsx:112` — totalCount = parts + labels + nets

**Proposed fix.** DNP visual (dim + strike refdes), 'View on PCB' frames part, ERC all-filtered empty message. — Detail: Render DNP parts at reduced opacity with an 'DNP' badge; frame the placement after cross-probe; add 'N violations hidden by filter'; show per-tab count in the Outline header.

**Evidence.** [068-fields-dnp](../evidence/shots/q3/dark/068-fields-dnp.png), [004-r1-selected](../evidence/shots/vq3/light/004-r1-selected.png)

<details><summary>Q3-038 — Small schematic feedback gaps: DNP parts look unchanged, 'View on PCB' does not frame the part, filtering all ERC severities shows a blank list, Outline header count mixes parts+nets+labels (S4, confirmed)</summary>

- Area designer.schematic · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. Tick DNP on R1 — canvas and outline row unchanged
  2. Properties → View on PCB — R1 selected but view stays at board fit (R1 is a few px, overlapping R10)
  3. ERC dock: toggle off the only non-zero severity — list becomes empty with no 'hidden by filter' note
  4. Outline header shows '13' while the Parts tab lists 4 rows
- Expected: DNP visibly marked (greyed/crossed + outline badge), cross-probe frames the target, filtered-empty state explains itself, header count matches the active tab
- Actual: As described; the numbers/visual states give no feedback.
- Screenshots: [068-fields-dnp](../evidence/shots/q3/dark/068-fields-dnp.png), [069-view-on-pcb](../evidence/shots/q3/dark/069-view-on-pcb.png), [052-erc-filter-errors-off](../evidence/shots/q3/dark/052-erc-filter-errors-off.png), [053-outline-nets](../evidence/shots/q3/dark/053-outline-nets.png)
- Code: `src/modules/designer/frontend/components/OutlinePanel/OutlinePanel.tsx:112` — totalCount = parts + labels + nets
- Code: `src/modules/designer/frontend/Space.tsx:907` — handleCrossProbePcb selects by reference, no frame
- Suggested fix: Render DNP parts at reduced opacity with an 'DNP' badge; frame the placement after cross-probe; add 'N violations hidden by filter'; show per-tab count in the Outline header.
- Verification (vq3): **confirmed** — All four confirmed. (1) DNP: R1 in QA-Q3-sandbox has DNP ticked, and neither the canvas nor the outline marks it (no dnp handling in SchematicCanvas/OutlinePanel). (2) View on PCB only sets a selection request (Space.tsx:907-920 → PcbCanvas.tsx:1066-1091); there is no camera framing. (3) ERC with all non-zero severities toggled off shows an empty list with no note (q3 052). (4) The Outline header count is parts+labels+nets (OutlinePanel.tsx:113): 'Outline 9' with 3 part rows. S4. · evidence: [004-r1-selected](../evidence/shots/vq3/light/004-r1-selected.png), [029-vq3a-fit](../evidence/shots/vq3/dark/029-vq3a-fit.png), [052-erc-filter-errors-off](../evidence/shots/q3/dark/052-erc-filter-errors-off.png)

</details>

