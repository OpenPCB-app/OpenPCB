# designer.3d — QA findings

[← index](../README.md) · 14 triage entries · S1 0 · S2 5 · S3 7 · S4 1

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-231](#t-231) | S2 | 3D view drops to 14–19 fps on a 150-part board: every orbit/zoom frame is a 55–90 ms long task (60 fps on a 5-part board) | F1B-026 | fix-now | D4 / W2 | frontend | M |
| [T-232](#t-232) | S2 | 3D view drops the body of a bottom-side part: C2 flipped to B.Cu shows only its pads and silkscreen, no capacitor model from any camera | F2A-010 | fix-now | D4 / W2 | frontend | S |
| [T-233](#t-233) | S2 | 3D view ignores the design's board thickness (always 1.6 mm in the Mechanical panel and the rendered board) | Q5-014 | fix-now | D4 / W2 | frontend | S |
| [T-234](#t-234) | S2 | 3D view of an imported KiCad board is empty — board rendered at KiCad coordinates (≈150,137 mm) while camera/grid stay at the origin | Q5-020 | fix-now | D4 / W2 | frontend | S |
| [T-235](#t-235) | S2 | 3D left rail and Mechanical card are hard-coded dark slate/violet: unreadable in light theme, off-token native controls in dark | Q5-028 | fix-now | D4 / W2 | frontend | M |
| [T-236](#t-236) | S3 | 3D ships stubs: fake Height heatmap legend, disabled STEP/Measure, 'FPS —'/'Zoom —' placeholders | F1B-027, Q5-013 | fix-now | D4 / W2 | frontend | XS |
| [T-237](#t-237) | S3 | 3D view omits board-level silkscreen: PCB Text-tool overlay text (and overlay shapes) is exported to F_Silkscreen but never drawn on the 3D board | F1B-031 | fix-now | D4 / W2 | frontend | M |
| [T-238](#t-238) | S3 | Core 'Pin Header 1x02 2.54mm' (footprint …_Vertical) renders in 3D as a header lying flat on the board with its pins pointing sideways | F2A-011 | defer | followup / followup | shared-package | XS |
| [T-239](#t-239) | S3 | 3D refdes labels are not occluded by the board: viewed from below, every top-side refdes (R1, R2, U1, D1, R3, C1) shows through the PCB, mirrored, next to the real bottom label | F2A-012 | defer | followup / followup | shared-package | XS |
| [T-240](#t-240) | S3 | 3D Transparency slider has no visible effect | Q5-015 | fix-now | D4 / W2 | frontend | S |
| [T-241](#t-241) | S3 | 3D Mechanical card truncates every value at 1440 px and mislabels counts ('Parts 16 · 0 traces · 0 vias') | Q5-017 | fix-now | D4 / W2 | frontend | XS |
| [T-242](#t-242) | S3 | 3D error state floods the whole viewport with a maroon wash, no retry, empty left rail | Q5-033 | fix-now | D4 / W2 | frontend | XS |
| [T-243](#t-243) | S4 | 3D view floods the console with THREE deprecation warnings (PCFSoftShadowMap ×31, Clock) | Q5-018 | fix-now | D4 / W2 | frontend | XS |
| [T-395](#t-395) | S4 | 3D Snapshot button has no accessible label (K27) |  | wont-fix | — / followup | frontend | XS |

## T-231

**3D view drops to 14–19 fps on a 150-part board: every orbit/zoom frame is a 55–90 ms long task (60 fps on a 5-part board)**

- Severity **S2** · category perf · status confirmed · themes dark
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate M
- Findings: F1B-026

**Summary.** 150 parts: orbit 18–19 fps with 124 long tasks (max 78 ms, sum 7.1 s) — a 40-step drag that should take ~0.7 s took 7.2 s; wheel zoom 14 fps (36 long tasks, max 88 ms). Idle 60 fps (demand loop). Same machine, 5-part board: orbit 60 fps, 0 long tasks. Time to first render of the 3D tab itself is fine (tab ready 100 ms, 540 ms of long tasks while models load). Every frame re-renders 2048² soft shadow map + ContactSha…

**Root cause.** `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:540` — castShadow directional light, shadow-mapSize 2048×2048

**Proposed fix.** 3D perf: merge/instance repeated footprint meshes, cap shadow map, frameloop demand. — Detail: Bake static shadows (ContactShadows frames={1} / shadow autoUpdate=false, update only on layout change), drop N8AO/SMAA while the camera is moving (PerformanceMonitor / regress), and instance or merge identical footprint models per componentId (150 parts here are only 8 distinct models). Add a perf budget test for 150+ parts.

**Evidence.** [105-stress-3d-orbit](../evidence/shots/f1b/dark/105-stress-3d-orbit.png), [020-stress-3d-after-orbit](../evidence/shots/vf1b/dark/020-stress-3d-after-orbit.png)

<details><summary>F1B-026 — 3D view drops to 14–19 fps on a 150-part board: every orbit/zoom frame is a 55–90 ms long task (60 fps on a 5-part board) (S2, confirmed)</summary>

- Area designer.3d · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. Open QA-f1b-stress (150 placements: R/C/L 0603/0805, SOD-123, SOT-23, SOIC-8, 15 pin headers) → 3D tab, wait 6 s for models
  2. Install an rAF counter + PerformanceObserver('longtask') (f1b/perf-install.js)
  3. Left-drag orbit 40 steps × 16 ms, then 10 wheel notches
  4. Repeat on QA-f1b-long (5 parts)
- Expected: Orbit/zoom stay interactive (≥45 fps) on a 150-part board on an Apple M4 Pro GPU (ANGLE Metal).
- Actual: 150 parts: orbit 18–19 fps with 124 long tasks (max 78 ms, sum 7.1 s) — a 40-step drag that should take ~0.7 s took 7.2 s; wheel zoom 14 fps (36 long tasks, max 88 ms). Idle 60 fps (demand loop). Same machine, 5-part board: orbit 60 fps, 0 long tasks. Time to first render of the 3D tab itself is fine (tab ready 100 ms, 540 ms of long tasks while models load). Every frame re-renders 2048² soft shadow map + ContactShadows + N8AO over ~150 individually cloned GLB groups + 150 refdes labels.
- Screenshots: [105-stress-3d-orbit](../evidence/shots/f1b/dark/105-stress-3d-orbit.png), [106-long-3d-orbit](../evidence/shots/f1b/dark/106-long-3d-orbit.png), [107-stress-3d-after](../evidence/shots/f1b/dark/107-stress-3d-after.png)
- Console: `WebGL renderer: ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`; `stress orbit {elapsedMs:7212,fps:18,longTasks:124,maxLongTask:78}`; `stress wheel {elapsedMs:2500,fps:14,longTasks:36,maxLongTask:88}`; `5-part orbit {elapsedMs:1654,fps:60,longTasks:0}`
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:540` — castShadow directional light, shadow-mapSize 2048×2048
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:555` — ContactShadows re-rendered per frame
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:490` — N8AO post-processing pass
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:758` — shadows='soft' on the Canvas
- Code: `src/modules/designer/frontend/three-d/ModelCacheProvider.tsx:39` — cloneModelScene deep-clones geometry AND material per placement (lines 44-45) — 150 parts = 150 geometry/material copies, no sharing or instancing
- Suggested fix: Bake static shadows (ContactShadows frames={1} / shadow autoUpdate=false, update only on layout change), drop N8AO/SMAA while the camera is moving (PerformanceMonitor / regress), and instance or merge identical footprint models per componentId (150 parts here are only 8 distinct models). Add a perf budget test for 150+ parts.
- Verification (vf1b): **confirmed** — Reproduced on QA-f1b-stress (150 placements), 3D tab, ANGLE Metal on Apple M4 Pro. A 40-step orbit took 8.3 s at 15 fps (121 long tasks, max 146 ms); 10 wheel notches ran at 18 fps (30 long tasks). The same orbit on the 5-part QA-f1b-long ran at 60 fps with 0 long tasks. The long tasks are main-thread CPU time per frame, not headless GPU limits. S2 kept, since 100-200-part boards are common. Caveat: only one GPU was tested, in headless Chromium. · evidence: [020-stress-3d-after-orbit](../evidence/shots/vf1b/dark/020-stress-3d-after-orbit.png), measure: 150-part orbit {elapsedMs:8255,fps:15,longTasks:121,max:146}; wheel {fps:18,longTasks:30}; 5-part orbit {fps:60,longTasks:0}

</details>


## T-232

**3D view drops the body of a bottom-side part: C2 flipped to B.Cu shows only its pads and silkscreen, no capacitor model from any camera**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate S
- Findings: F2A-010

**Summary.** Under the board only the two gold pads, the courtyard/silk outline and the 'C2' refdes are drawn; the capacitor body (same GLB c-0603 that renders fine for C1 on top) is missing. The user cannot verify bottom-side assembly in 3D. Likely the back-layer transform (mirrorX = placement.mirrored || isBackLayer) applies a negative scale that inverts face winding so the mesh is back-face culled, or places it inside the boa…

**Root cause.** `src/modules/designer/frontend/three-d/transform-helpers.ts:65` — getPlacementTransformProps: B.Cu → position z = -boardThickness, scale [-1,1,1] only — the model is never flipped in Z, so its body extends +Z from the bottom face INTO the board (0603 ≈0.8 mm < 1.6 mm board → fully hid…

**Proposed fix.** Bottom-side placements: flip model about board plane at z=-thickness. — Detail: For back-side placements flip about the board plane: scale [-1,1,-1] (equivalently rotate π about Y) at z = -boardThicknessMm, keeping the X mirror consistent with the 2D footprint; add a unit test that a B.Cu placement's model bounding box lies entirely below z = -boardThickness.

**Evidence.** [088-3d-bottom](../evidence/shots/f2a/dark/088-3d-bottom.png), [040-3d](../evidence/shots/vf2a/dark/040-3d.png)

<details><summary>F2A-010 — 3D view drops the body of a bottom-side part: C2 flipped to B.Cu shows only its pads and silkscreen, no capacitor model from any camera (S2, confirmed)</summary>

- Area designer.3d · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark, light · viewports 1440x900
- Repro:
  1. QA-f2a-golden: PCB → select C2 → F (flip to bottom; projection layer B.Cu, mirrored true)
  2. 3D tab → Back camera, orbit under the board, zoom on C2 ([089-3d-bottom-c2](../evidence/shots/f2a/dark/089-3d-bottom-c2.png))
  3. Also check Top/Iso: no C2 body on the top either
- Expected: The 0603 capacitor model hangs under the board at C2's position (mirrored about the board plane), like every top-side part.
- Actual: Under the board only the two gold pads, the courtyard/silk outline and the 'C2' refdes are drawn; the capacitor body (same GLB c-0603 that renders fine for C1 on top) is missing. The user cannot verify bottom-side assembly in 3D. Likely the back-layer transform (mirrorX = placement.mirrored || isBackLayer) applies a negative scale that inverts face winding so the mesh is back-face culled, or places it inside the board.
- Screenshots: [088-3d-bottom](../evidence/shots/f2a/dark/088-3d-bottom.png), [089-3d-bottom-c2](../evidence/shots/f2a/dark/089-3d-bottom-c2.png), [086-3d-top](../evidence/shots/f2a/dark/086-3d-top.png)
- Network: `projection C2: layer B.Cu, mirrored true, model3d.status 'ready' glb c-0603`
- Code: `src/modules/designer/frontend/three-d/transform-helpers.ts:65` — getPlacementTransformProps: B.Cu → position z = -boardThickness, scale [-1,1,1] only — the model is never flipped in Z, so its body extends +Z from the bottom face INTO the board (0603 ≈0.8 mm < 1.6 mm board → fully hidden)
- Code: `src/modules/designer/frontend/three-d/ComponentModelLayer.tsx:95` — applyPlacementTransform uses those props for the GLB
- Suggested fix: For back-side placements flip about the board plane: scale [-1,1,-1] (equivalently rotate π about Y) at z = -boardThicknessMm, keeping the X mirror consistent with the 2D footprint; add a unit test that a B.Cu placement's model bounding box lies entirely below z = -boardThickness.
- Verification (vf2a): **confirmed** — Golden 3D (dark): Back camera, orbit under the board, zoom on C2 (B.Cu, mirrored). Only the two gold pads, the silk outline and 'C2' are drawn; there is no capacitor body (shots 042/043), and none in Iso from the top either (shot 040). Code root cause: for B.Cu the transform only mirrors X and translates to z = -1.6, so the Z-up model grows back into the board. That is not a culling artefact. S2: bottom-side assembly cannot be checked in 3D. · evidence: [040-3d](../evidence/shots/vf2a/dark/040-3d.png), [042-3d-under](../evidence/shots/vf2a/dark/042-3d-under.png), [043-3d-under-c2](../evidence/shots/vf2a/dark/043-3d-under-c2.png)

</details>


## T-233

**3D view ignores the design's board thickness (always 1.6 mm in the Mechanical panel and the rendered board)**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate S
- Findings: Q5-014

**Summary.** Mechanical shows '2 layer · 1.6 mm' (and the 3D board keeps 1.6 mm): Board3DCanvas passes DEFAULT_BOARD_THICKNESS_MM instead of projection.board.boardThicknessMm; enclosure numbers are computed from the same constant.

**Root cause.** `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:832` — thicknessMm: DEFAULT_BOARD_THICKNESS_MM

**Proposed fix.** Use board thickness from projection for extrusion + Mechanical stat. — Detail: Use activeProjection.board.boardThicknessMm ?? DEFAULT_BOARD_THICKNESS_MM for the stat, BoardGeometry extrusion and floor-grid offset.

**Evidence.** [036-3d-thickness-ignores-design](../evidence/shots/q5/dark/036-3d-thickness-ignores-design.png), [009-3d-thickness-empty-design](../evidence/shots/vq5/light/009-3d-thickness-empty-design.png)

<details><summary>Q5-014 — 3D view ignores the design's board thickness (always 1.6 mm in the Mechanical panel and the rendered board) (S2, confirmed)</summary>

- Area designer.3d · stack A · design QA-q5-empty (a0ce5e9e…) · themes dark · viewports 1440x900
- Repro:
  1. Open QA-q5-empty → PCB → Properties → Design rules 'Edit rules…'
  2. Set Board thickness 0.8 mm → 'Save & re-run DRC' (Board panel now shows Thickness 0.80 mm; PCB projection has board.boardThicknessMm)
  3. Open 3D
- Expected: Mechanical → Stackup '2 layer · 0.8 mm' and board rendered 0.8 mm thick.
- Actual: Mechanical shows '2 layer · 1.6 mm' (and the 3D board keeps 1.6 mm): Board3DCanvas passes DEFAULT_BOARD_THICKNESS_MM instead of projection.board.boardThicknessMm; enclosure numbers are computed from the same constant.
- Screenshots: [036-3d-thickness-ignores-design](../evidence/shots/q5/dark/036-3d-thickness-ignores-design.png)
- Network: `GET …/projection/pcb → board.boardThicknessMm present`
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:832` — thicknessMm: DEFAULT_BOARD_THICKNESS_MM
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:569` — BoardGeometry rendered without boardThicknessMm
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:590` — gridHelper offset uses the constant
- Suggested fix: Use activeProjection.board.boardThicknessMm ?? DEFAULT_BOARD_THICKNESS_MM for the stat, BoardGeometry extrusion and floor-grid offset.
- Verification (vq5): **confirmed** — Confirmed: GET …/a0ce5e9e…/projection/pcb -> board.boardThicknessMm 0.8, but the 3D Mechanical card reads 'Stackup 2 layer · 1.6 mm'. Board3DCanvas.tsx:832 passes DEFAULT_BOARD_THICKNESS_MM to the overlay, BoardGeometry is rendered without boardThicknessMm (defaults to the constant, :569-578) and the floor grid/contact shadow use the constant (:556, :590). S2 kept (wrong data shown). · evidence: [009-3d-thickness-empty-design](../evidence/shots/vq5/light/009-3d-thickness-empty-design.png), network: projection/pcb board.boardThicknessMm=0.8; snapshot 'Stackup 2 layer · 1.6 mm'

</details>


## T-234

**3D view of an imported KiCad board is empty — board rendered at KiCad coordinates (≈150,137 mm) while camera/grid stay at the origin**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate S
- Findings: Q5-020

**Summary.** Only the floor grid is visible; Mechanical still says 'Board 31.0 × 15.0…, 18 · 183 tr…'. Zooming far out reveals a sliver of green board at the top-right edge. The imported outline has centerMm {x:149.5, y:137}; presets use fixed positions around (0,0) and the 120 mm floor grid is centred at the origin. Every KiCad import (whose sheet origin is top-left of an A4 page) will hit this.

**Root cause.** `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:53` — PRESET_POSITIONS relative to origin

**Proposed fix.** Centre camera/grid on board bounds (imported boards at KiCad coords). — Detail: In Board3DScene translate the board group by -outline.centerMm (or set the orbit target/presets to the outline centre and scale preset distance by board size); alternatively recentre the outline at import time.

**Evidence.** [052-import-3d](../evidence/shots/q5/dark/052-import-3d.png), [016-import-3d-empty](../evidence/shots/vq5/dark/016-import-3d-empty.png)

<details><summary>Q5-020 — 3D view of an imported KiCad board is empty — board rendered at KiCad coordinates (≈150,137 mm) while camera/grid stay at the origin (S2, confirmed)</summary>

- Area designer.3d · stack A · design 70d12af0-c3c1-46e7-a9f7-d5b352df1eb0 · themes dark · viewports 1440x900
- Repro:
  1. Import fixtures/KiCad_Example_Project_USBtoUART.zip (design QA-q5-USBtoUART)
  2. Open 3D; try Iso/Top presets; zoom out with the wheel
- Expected: Board centred in view like native designs (outline centre 0,0).
- Actual: Only the floor grid is visible; Mechanical still says 'Board 31.0 × 15.0…, 18 · 183 tr…'. Zooming far out reveals a sliver of green board at the top-right edge. The imported outline has centerMm {x:149.5, y:137}; presets use fixed positions around (0,0) and the 120 mm floor grid is centred at the origin. Every KiCad import (whose sheet origin is top-left of an A4 page) will hit this.
- Screenshots: [052-import-3d](../evidence/shots/q5/dark/052-import-3d.png), [053-import-3d-top](../evidence/shots/q5/dark/053-import-3d-top.png), [054-import-3d-zoomout](../evidence/shots/q5/dark/054-import-3d-zoomout.png)
- Network: `GET …/70d12af0…/projection/pcb → board.outline.centerMm {x:149.5,y:137}; native design centre {0,0}`
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:53` — PRESET_POSITIONS relative to origin
- Code: `src/modules/designer/backend/import/kicad-project/commit.ts:247` — adjustBoardCenter used for placements only
- Suggested fix: In Board3DScene translate the board group by -outline.centerMm (or set the orbit target/presets to the outline centre and scale preset distance by board size); alternatively recentre the outline at import time.
- Verification (vq5): **confirmed** — Reproduced: QA-q5-USBtoUART -> 3D shows only the floor grid (Iso and Top); Mechanical still reports 'Board 31.0 × 15.0…'. projection/pcb board.outline.centerMm = {x:149.5, y:137} while PRESET_POSITIONS (Board3DCanvas.tsx:52-59) and the 120 mm gridHelper are origin-centred. S2 kept (3D unusable for every KiCad import). · evidence: [016-import-3d-empty](../evidence/shots/vq5/dark/016-import-3d-empty.png), [017-import-3d-top](../evidence/shots/vq5/dark/017-import-3d-top.png), api: outline.centerMm {x:149.5,y:137}

</details>


## T-235

**3D left rail and Mechanical card are hard-coded dark slate/violet: unreadable in light theme, off-token native controls in dark**

- Severity **S2** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate M
- Findings: Q5-028 · known ref K45

**Summary.** Light: Display labels (Components/Silkscreen/Refdes labels/Floor grid, text-slate-300) #c5c5ca on #f7f7f8 = contrast 1.61; inactive camera buttons (bg-slate-800/60) grey on grey = 1.84; Scene select is a black (#0c0c0d) native box; section dividers render as heavy dark lines; White swatch disappears on the panel; Mechanical card stays dark and its 'Min enclosure' label is #111114 on #0e1c22 (contrast 1.08, invisible…

**Root cause.** `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:88` — Section: border-slate-800, text-[9px] text-slate-500

**Proposed fix.** 3D overlay (rail, Mechanical card) on theme tokens; kit controls; ≥10px labels. — Detail: Rebuild Board3DControls with kit PanelSectionHeader, Checkbox, SegmentedControl (aria-pressed), Select and a tokenised slider; restyle the Mechanical card/toolbar/status bar with --surface-panel/--border tokens (no blur/shadow, 2px radius); tokenise grid colours.

**Evidence.** [102-3d](../evidence/shots/q5/light/102-3d.png), [001-3d](../evidence/shots/vq5/light/001-3d.png)

<details><summary>Q5-028 — 3D left rail and Mechanical card are hard-coded dark slate/violet: unreadable in light theme, off-token native controls in dark (S2, confirmed)</summary>

- Area designer.3d · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes light, dark · viewports 1440x900
- Repro:
  1. Set theme Light, open 'LED Indicators 5V' → 3D
  2. Compare with dark theme
- Expected: Rail uses kit tokens (PanelSectionHeader 24px, kit Checkbox/Select/Segmented control) and reads correctly in both themes; overlay cards use surface tokens without blur/shadow.
- Actual: Light: Display labels (Components/Silkscreen/Refdes labels/Floor grid, text-slate-300) #c5c5ca on #f7f7f8 = contrast 1.61; inactive camera buttons (bg-slate-800/60) grey on grey = 1.84; Scene select is a black (#0c0c0d) native box; section dividers render as heavy dark lines; White swatch disappears on the panel; Mechanical card stays dark and its 'Min enclosure' label is #111114 on #0e1c22 (contrast 1.08, invisible). Both themes: native Chromium checkboxes (#99c8ff blue fill), native range with white #efefef track, 26 px native select, 9 px section titles (Camera/Display/Board color/Scene/Transparency/Tallest parts — K36), camera presets and colour swatches expose no aria-pressed, overlay cards with shadow-xl + backdrop-blur, floor grid lines slate-blue rgb(71,85,105)/rgb(30,41,59), (spinner/banner violet classes and rounded-lg render neutral/2px via the PLAN D1 remap).
- Screenshots: [102-3d](../evidence/shots/q5/light/102-3d.png), [021-3d-heatmap-stub-legend](../evidence/shots/q5/dark/021-3d-heatmap-stub-legend.png)
- Pixel probes: {"file": "shots/q5/light/102-3d.png", "x": 100, "y": 164, "hex": "#c5c5ca", "nearestToken": "text on --surface-panel #f7f7f8 (CR 1.61)", "deltaE": 0}; {"file": "shots/q5/light/102-3d.png", "x": 990, "y": 240, "hex": "#111114", "nearestToken": "'Min enclosure' on #0e1c22 (CR 1.08)", "deltaE": 0}; {"file": "shots/q5/dark/021-3d-heatmap-stub-legend.png", "x": 318, "y": 164, "hex": "#99c8ff", "nearestToken": "native checkbox accent (off-token)", "deltaE": 0}
- Census: `census/3d-main-dark-1440.json`
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:88` — Section: border-slate-800, text-[9px] text-slate-500
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:110` — ToggleRow native checkbox, text-slate-300
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:163` — camera buttons bg-slate-800/60
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:222` — native select bg-slate-950
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:239` — accent-violet-500 range
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:272` — rounded-lg bg-slate-900/90 shadow-xl backdrop-blur
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:212` — THREE_D_THEME slate/violet
- Suggested fix: Rebuild Board3DControls with kit PanelSectionHeader, Checkbox, SegmentedControl (aria-pressed), Select and a tokenised slider; restyle the Mechanical card/toolbar/status bar with --surface-panel/--border tokens (no blur/shadow, 2px radius); tokenise grid colours.
- Verification (vq5): **confirmed** — Re-probed light 3D: 'Components' label #c5c5ca on #f7f7f8 = CR 1.61; inactive 'Persp' #a2a2a7 on #747476 = 1.84; 'Min enclosure' #111114 on #0e1c21 = 1.08; Scene select #0c0c0d. Dark: native checkbox fill #99c8ff, native range track #efefef, 9 px section titles. Corrections from the D1 remap (PLAN §2 D1 maps slate/violet ramps to neutral and radius-lg to 2px): the spinner 'border-t-violet-400', banner 'border-violet-500/60' and slider 'accent-violet-500' render neutral grey, and rounded-lg is 2px — not violet/rounded. Still off-token: shadow-xl + backdrop-blur cards and the raw rgb grid colours (THREE_D_SCENE_COLORS gridMajor/gridMinor rgb(71,85,105)/rgb(30,41,59)). 3D was 'token re-skin only' (§0, §9 follow-up), but D3 keeps light theme and §5 requires per-screen light checks, so an unreadable light rail is a defect. S2 kept (one theme unreadable). · evidence: [001-3d](../evidence/shots/vq5/light/001-3d.png), [012-3d-heatmap-legend](../evidence/shots/vq5/dark/012-3d-heatmap-legend.png), probe: light Components #c5c5ca/#f7f7f8 CR 1.61; Persp CR 1.84; Min enclosure CR 1.08; dark checkbox #99c8ff; range #efefef

</details>


## T-236

**3D ships stubs: fake Height heatmap legend, disabled STEP/Measure, 'FPS —'/'Zoom —' placeholders**

- Severity **S3** · category stub · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate XS
- Findings: F1B-027, Q5-013 · known ref K43

**Summary.** The bar always reads 'FPS —' and 'Zoom —' (em-dash placeholders) before and after orbit/zoom, on every design; the spans are literal strings. Looks unfinished next to the working 'iso · studio dark' segments. | Also covers: Q5-013: 3D 'Height heatmap' is an enabled checkbox that shows a fabricated 0–12 mm legend while t…

**Root cause.** `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:389` — <span className="ml-auto">FPS —</span>

**Proposed fix.** Remove Height heatmap, Export STEP, Measure stubs and FPS/Zoom placeholders from 3D. — Detail: Remove both spans, or feed them from the canvas (camera distance → zoom %, a throttled useFrame fps sampler behind a dev flag). Add them to the K43 stub list if kept as placeholders.

**Note.** Binding: remove Coming-soon stubs.

**Evidence.** [105-stress-3d-orbit](../evidence/shots/f1b/dark/105-stress-3d-orbit.png), [019-long-3d-top](../evidence/shots/vf1b/dark/019-long-3d-top.png), [021-3d-heatmap-stub-legend](../evidence/shots/q5/dark/021-3d-heatmap-stub-legend.png)

<details><summary>F1B-027 — 3D status bar shows hard-coded 'FPS —' and 'Zoom —' placeholders that never update (S4, confirmed)</summary>

- Area designer.3d · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark, light · viewports 1440x900
- Repro:
  1. Open any design → 3D tab
  2. Orbit, wheel-zoom, switch camera presets
  3. Read the right side of the 3D status bar
- Expected: Either live readouts (frame rate / zoom or camera distance) or no segment at all; the 2D views show a real zoom % in the shell status bar.
- Actual: The bar always reads 'FPS —' and 'Zoom —' (em-dash placeholders) before and after orbit/zoom, on every design; the spans are literal strings. Looks unfinished next to the working 'iso · studio dark' segments.
- Screenshots: [105-stress-3d-orbit](../evidence/shots/f1b/dark/105-stress-3d-orbit.png), [106-long-3d-orbit](../evidence/shots/f1b/dark/106-long-3d-orbit.png)
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:389` — <span className="ml-auto">FPS —</span>
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:390` — <span>Zoom —</span>
- Suggested fix: Remove both spans, or feed them from the canvas (camera distance → zoom %, a throttled useFrame fps sampler behind a dev flag). Add them to the K43 stub list if kept as placeholders.
- Verification (vf1b): **confirmed** — Seen on the QA-f1b-long 3D view: the status bar always reads 'FPS —' and 'Zoom —'. Code: Board3DOverlay.tsx:389-390 has the literal strings. Lowered to S4: harmless static placeholder text in a status strip, no dead control and no misleading claim (Q2-024, a similar placeholder block, was S4). It still conflicts with D6 ('no placeholders'). The strip also uses raw slate classes (K45). · evidence: [019-long-3d-top](../evidence/shots/vf1b/dark/019-long-3d-top.png)

</details>

<details><summary>Q5-013 — 3D 'Height heatmap' is an enabled checkbox that shows a fabricated 0–12 mm legend while the board is unchanged (S3, confirmed)</summary>

- Area designer.3d · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. Open 'LED Indicators 5V' → 3D
  2. In the left rail tick 'Height heatmap'
- Expected: Either a working height heatmap or a clearly disabled control (K43 recon assumed it was disabled).
- Actual: The checkbox is NOT disabled (input.disabled=false, only a 'Coming soon' title on the label). Ticking it renders a 'HEIGHT 0 ▬ 12 mm' gradient legend (#34D399→#FBBF24→#F87171) bottom-left, but the board/components are not recoloured — the legend presents invented data. Other 3D stubs confirmed: 'Export STEP' (disabled, title 'STEP / STL export — coming soon'), 'Measure' (disabled), status bar permanently 'FPS —' and 'Zoom —' (no zoom readout even after wheel zoom), Mechanical 'Tallest parts — needs component heights' and 'Min enclosure 52 × 32 × — mm'.
- Screenshots: [021-3d-heatmap-stub-legend](../evidence/shots/q5/dark/021-3d-heatmap-stub-legend.png), [034-3d-after-wheel](../evidence/shots/q5/dark/034-3d-after-wheel.png)
- Census: `census/3d-main-dark-1440.json`
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:189` — heatmap ToggleRow stub but onChange live
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:364` — hard-coded legend
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:389` — FPS — / Zoom — placeholders
- Suggested fix: Remove the heatmap row and legend (or render it disabled) until implemented; drop the FPS/Zoom placeholders or wire the zoom readout to camera distance; hide 'Tallest parts'/'Min enclosure' height until component heights exist.
- Verification (vq5): **confirmed** — Reproduced: 'Height heatmap' input.disabled=false (label title 'Coming soon'); ticking it shows a 'HEIGHT 0 ▬ 12 mm' gradient legend while the board is not recoloured. Export STEP / Measure disabled; status bar hard-codes 'FPS —' / 'Zoom —' (Board3DOverlay.tsx:389-390). Downgraded S2->S3: the stub is disclosed by a 'Coming soon' tooltip and presents no data a user could act on; 3D was 'token re-skin only' in PLAN §0, so this is a pre-existing stub rather than a redesign regression. K43 partial (heatmap is enabled, not disabled). · evidence: [012-3d-heatmap-legend](../evidence/shots/vq5/dark/012-3d-heatmap-legend.png), dom: Height heatmap input disabled=false, label title='Coming soon'

</details>


## T-237

**3D view omits board-level silkscreen: PCB Text-tool overlay text (and overlay shapes) is exported to F_Silkscreen but never drawn on the 3D board**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate M
- Findings: F1B-031

**Summary.** Only footprint silk and refdes labels render; the overlay text is missing in both themes (board top-left is blank green) while the PCB view shows it and POST /exports/gerber puts it in F_Silkscreen (24.6 kB, strokes spanning x −90.9…58.8 mm). Board3D never reads projection.overlayTexts / overlayShapes (they appear only in test fixtures), so version labels, logos and assembly notes are invisible in the 3D review step.

**Root cause.** `src/modules/designer/frontend/three-d/FootprintOverlayLayer.tsx:19` — only per-footprint silk/refdes are rendered

**Proposed fix.** Render board-level silkscreen text/shapes in 3D. — Detail: Reuse the S12 silk artwork model (src/shared/rendering/pcb/artwork — the one the Gerber writer and DFM checks share) to build the 3D silk layer, so 3D, Gerber and DRC draw the same silk; at minimum add an OverlaySilkLayer that strokes overlayTexts/overlayShapes on the matching board side.

**Evidence.** [110-long-3d-top-no-overlay-text](../evidence/shots/f1b/dark/110-long-3d-top-no-overlay-text.png), [019-long-3d-top](../evidence/shots/vf1b/dark/019-long-3d-top.png)

<details><summary>F1B-031 — 3D view omits board-level silkscreen: PCB Text-tool overlay text (and overlay shapes) is exported to F_Silkscreen but never drawn on the 3D board (S3, confirmed)</summary>

- Area designer.3d · stack A · design 43a2da78-9d2e-43a0-bcd3-ecebe3f72551 · themes dark, light · viewports 1440x900
- Repro:
  1. Open QA-f1b-long → PCB → Add ▾ → Text (T), click on the board, enter a text (K02 prompt) — here 'Long PCB overlay text …' on F.SilkS at (−15.85, 9.37) mm
  2. Switch to 3D, Display → Silkscreen checked, camera Top
  3. Compare with PCB view and with the Gerber F_Silkscreen from Export…
- Expected: 3D silkscreen shows everything that goes to the silkscreen Gerber — footprint silk, refdes and user text/graphics on F.SilkS/B.SilkS.
- Actual: Only footprint silk and refdes labels render; the overlay text is missing in both themes (board top-left is blank green) while the PCB view shows it and POST /exports/gerber puts it in F_Silkscreen (24.6 kB, strokes spanning x −90.9…58.8 mm). Board3D never reads projection.overlayTexts / overlayShapes (they appear only in test fixtures), so version labels, logos and assembly notes are invisible in the 3D review step.
- Screenshots: [110-long-3d-top-no-overlay-text](../evidence/shots/f1b/dark/110-long-3d-top-no-overlay-text.png), [027-long-3d-top](../evidence/shots/f1b/light/027-long-3d-top.png), [005-long-pcb](../evidence/shots/f1b/light/005-long-pcb.png), [075-long-pcb-text](../evidence/shots/f1b/dark/075-long-pcb-text.png)
- Network: `GET /projection/pcb → overlayTexts[0] {layer:'F.SilkS', positionMm:{x:-15.85,y:9.37}, fontSizeMm:1}`; `POST /exports/gerber?format=json → F_Silkscreen.gbr 24657 B, X range −90.85…58.81 mm`
- Code: `src/modules/designer/frontend/three-d/FootprintOverlayLayer.tsx:19` — only per-footprint silk/refdes are rendered
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:794` — showSilkscreen only toggles the footprint overlay layer
- Code: `src/modules/designer/backend/export/gerber/writer.ts:193` — the Gerber writer does include proj.overlayTexts
- Suggested fix: Reuse the S12 silk artwork model (src/shared/rendering/pcb/artwork — the one the Gerber writer and DFM checks share) to build the 3D silk layer, so 3D, Gerber and DRC draw the same silk; at minimum add an OverlaySilkLayer that strokes overlayTexts/overlayShapes on the matching board side.
- Verification (vf1b): **confirmed** — Reproduced on QA-f1b-long, 3D, camera Top, Silkscreen checked. The F.SilkS overlay text visible in the PCB view (and exported to F_Silkscreen) is absent; the board's top-left is blank, and only footprint silk/refdes render (refdes still shows the stale 'R1', see F1B-019). Code: no reference to overlayTexts/overlayShapes anywhere under src/modules/designer/frontend/three-d. S3 kept. · evidence: [019-long-3d-top](../evidence/shots/vf1b/dark/019-long-3d-top.png), [014-long-pcb](../evidence/shots/vf1b/dark/014-long-pcb.png), grep overlayTexts|overlayShapes in three-d -> 0 hits

</details>


## T-238

**Core 'Pin Header 1x02 2.54mm' (footprint …_Vertical) renders in 3D as a header lying flat on the board with its pins pointing sideways**

- Severity **S3** · category data · status confirmed · themes dark, light
- Recommendation **defer** · owner followup · wave followup · scope shared-package · estimate XS
- Findings: F2A-011

**Summary.** The GLB is rotated 90° (pins horizontal over the board), so height/clearance checks and the enclosure estimate are wrong and the render looks broken. modelRef is null (no correction applied), so the orientation is baked wrong in the library asset.

**Root cause.** `../CoreLibrary/3d/connector/pin-header-1x02-p2-54mm-vertical.model.json:1` — current source: rotation 0, scale y -1, bounds z 11.54 (correct Z-up); the fix exists in source but is unreleased

**Proposed fix.** CoreLibrary: fix pin-header 1x02 vertical model orientation. — Detail: Cut a new CoreLibrary release tag (current HEAD / the local beta.2 pack carries the fixed GLB 154f0aa7…) and let corelib:fetch bundle it; add a pack-time check that '*_Vertical' THT connectors have their tallest GLB extent on +Z. Separately make package-locator compare prerelease identifiers (semver) so a newer beta wins.

**Evidence.** [085-3d-zoom](../evidence/shots/f2a/dark/085-3d-zoom.png), [040-3d](../evidence/shots/vf2a/dark/040-3d.png)

<details><summary>F2A-011 — Core 'Pin Header 1x02 2.54mm' (footprint …_Vertical) renders in 3D as a header lying flat on the board with its pins pointing sideways (S3, confirmed)</summary>

- Area designer.3d · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark, light · viewports 1440x900
- Repro:
  1. Place Core 'Pin Header 1x02 2.54mm' (PinHeader_1x02_P2.54mm_Vertical) and open 3D
  2. Top camera: long gold pins lie across the board surface to the right of J1; Side camera: J1 is ~1 mm tall
- Expected: A vertical header: black 2.5 mm spacer on the board with two square pins standing ~6 mm up (and 3 mm tails below).
- Actual: The GLB is rotated 90° (pins horizontal over the board), so height/clearance checks and the enclosure estimate are wrong and the render looks broken. modelRef is null (no correction applied), so the orientation is baked wrong in the library asset.
- Screenshots: [085-3d-zoom](../evidence/shots/f2a/dark/085-3d-zoom.png), [086-3d-top](../evidence/shots/f2a/dark/086-3d-top.png), [087-3d-side](../evidence/shots/f2a/dark/087-3d-side.png), [009-3d-light](../evidence/shots/f2a/light/009-3d-light.png)
- Network: `projection J1 model3d: glbSha256 d7b66456…, sourceFilename pin-header-1x02-p2-54mm-vertical.step, modelRef null`
- Code: `../CoreLibrary/3d/connector/pin-header-1x02-p2-54mm-vertical.model.json:1` — current source: rotation 0, scale y -1, bounds z 11.54 (correct Z-up); the fix exists in source but is unreleased
- Code: `src/modules/library/backend/sync/package-locator.ts:71` — side issue: VERSION_RE/sort ignore the prerelease suffix, so with beta.1 and beta.2 side by side the older beta.1 wins the tie (dev only)
- Suggested fix: Cut a new CoreLibrary release tag (current HEAD / the local beta.2 pack carries the fixed GLB 154f0aa7…) and let corelib:fetch bundle it; add a pack-time check that '*_Vertical' THT connectors have their tallest GLB extent on +Z. Separately make package-locator compare prerelease identifiers (semver) so a newer beta wins.
- Verification (vf2a): **confirmed** — Golden 3D Iso: J1's two long pins lie flat across the board (shot 040). The served GLB (sha d7b66456…) has a root-node matrix [0,0,-1 | 0,-1,0 | 1,0,0] that rotates the Z-up model 90° onto its side. Stack A runs CoreLibrary 0.1.0-beta.1 (sources API: latestVersion 0.1.0-beta.1, installOrigin bundled), whose GLB is exactly d7b66456. The local, untagged beta.2 pack and the CoreLibrary dev pack contain a fixed GLB (154f0aa7…, Y-mirror only). CoreLibrary git tags stop at v0.1.0-beta.1, the latest release corelib:fetch would bundle, so the shipped app shows the lying header. Real, not an environment artefact. The fix is in CoreLibrary source but not released. S3. · evidence: [040-3d](../evidence/shots/vf2a/dark/040-3d.png), vf2a/j1.glb (d7b66456, rotated root node), vf2a/opclib/3d/connector/pin-header-1x02-p2-54mm-vertical.glb (beta.2, 154f0aa7, upright), GET /api/modules/library/sources → openpcb.core latestVersion 0.1.0-beta.1

</details>


## T-239

**3D refdes labels are not occluded by the board: viewed from below, every top-side refdes (R1, R2, U1, D1, R3, C1) shows through the PCB, mirrored, next to the real bottom label**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **defer** · owner followup · wave followup · scope shared-package · estimate XS
- Findings: F2A-012

**Summary.** Mirrored 'R2', 'R1', 'U1', 'D1', 'R3', 'C1' float over the bottom surface at full contrast, making it look as if those parts were on the bottom.

**Root cause.** `node_modules/@openpcb/r3f-eda-canvas/dist/primitives/EDAText.js:17` — Text material hard-codes material-depthTest=false / depthWrite=false

**Proposed fix.** 3D refdes text depth-tested against board. — Detail: In @openpcb/r3f-eda-canvas add a depthTest prop to EDAText (default false for 2D) and pass enableDepthTest from FootprintRenderLayer to its label EDAText; release the tag and re-pin. Alternative in-tree stopgap: hide refdes labels whose board side faces away from the camera.

**Evidence.** [088-3d-bottom](../evidence/shots/f2a/dark/088-3d-bottom.png), [042-3d-under](../evidence/shots/vf2a/dark/042-3d-under.png)

<details><summary>F2A-012 — 3D refdes labels are not occluded by the board: viewed from below, every top-side refdes (R1, R2, U1, D1, R3, C1) shows through the PCB, mirrored, next to the real bottom label (S3, confirmed)</summary>

- Area designer.3d · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2a-golden 3D, Refdes labels on
  2. Back camera, orbit under the board
- Expected: Top-side labels are hidden behind the opaque board when looking at the bottom; only bottom-side labels (C2) are readable.
- Actual: Mirrored 'R2', 'R1', 'U1', 'D1', 'R3', 'C1' float over the bottom surface at full contrast, making it look as if those parts were on the bottom.
- Screenshots: [088-3d-bottom](../evidence/shots/f2a/dark/088-3d-bottom.png), [089-3d-bottom-c2](../evidence/shots/f2a/dark/089-3d-bottom-c2.png)
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/primitives/EDAText.js:17` — Text material hard-codes material-depthTest=false / depthWrite=false
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/scene/footprint-render-layer.js:201` — label EDAText ignores the layer's enableDepthTest prop (silk lines and pads honour it)
- Code: `src/modules/designer/frontend/three-d/FootprintOverlayLayer.tsx:90` — 3D overlay passes enableDepthTest, which never reaches the labels
- Suggested fix: In @openpcb/r3f-eda-canvas add a depthTest prop to EDAText (default false for 2D) and pass enableDepthTest from FootprintRenderLayer to its label EDAText; release the tag and re-pin. Alternative in-tree stopgap: hide refdes labels whose board side faces away from the camera.
- Verification (vf2a): **confirmed** — Golden 3D, Back camera orbited under the board: the top-side refdes C1, R2, R1, U1, D1, R3 and J1 are drawn mirrored at full contrast on the bottom surface next to the real 'C2' (shots 042/043). Root cause is in the shared package: EDAText forces depthTest off, and FootprintRenderLayer does not pass enableDepthTest to labels. fixScope changed to shared-package. S3. · evidence: [042-3d-under](../evidence/shots/vf2a/dark/042-3d-under.png), [043-3d-under-c2](../evidence/shots/vf2a/dark/043-3d-under-c2.png)

</details>


## T-240

**3D Transparency slider has no visible effect**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate S
- Findings: Q5-015

**Summary.** Canvas pixel diff between slider 0 and 100: max 3/765, mean 0.36 — no visible change. BoardGeometry accepts maskOpacity only 'for API compatibility' and ignores it, so the slider is a dead control on every board. The 'Transparent' scene preset is just a #0b0b0d background with gl alpha:false, not a transparent background.

**Root cause.** `src/modules/designer/frontend/three-d/BoardGeometry.tsx:34` — maskOpacity 'accepted for API compatibility' — ignored

**Proposed fix.** Wire Transparency to board material opacity (or remove the slider). — Detail: Either wire maskOpacity into BoardSubstrate's face material (transparent + depthWrite off, opacity from the slider) so copper/drills show through, or remove the Transparency section from Board3DOverlay until implemented; rename 'Transparent' scene or render with alpha:true for snapshots.

**Evidence.** [028-3d-transp-drag-0](../evidence/shots/q5/dark/028-3d-transp-drag-0.png), [013-3d-transp-0](../evidence/shots/vq5/dark/013-3d-transp-0.png)

<details><summary>Q5-015 — 3D Transparency slider has no visible effect (S3, confirmed)</summary>

- Area designer.3d · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. Open 'LED Indicators 5V' → 3D, board colour Blue, scene Outdoor
  2. Drag 'Board transparency' from 0 to 100 (slider value confirmed 100)
  3. Compare screenshots
- Expected: Board mask becomes see-through (substrate/copper/inner features visible) as the slider moves.
- Actual: Canvas pixel diff between slider 0 and 100: max 3/765, mean 0.36 — no visible change. BoardGeometry accepts maskOpacity only 'for API compatibility' and ignores it, so the slider is a dead control on every board. The 'Transparent' scene preset is just a #0b0b0d background with gl alpha:false, not a transparent background.
- Screenshots: [028-3d-transp-drag-0](../evidence/shots/q5/dark/028-3d-transp-drag-0.png), [028-3d-transp-drag-100](../evidence/shots/q5/dark/028-3d-transp-drag-100.png), [025-3d-blue-transparent-70](../evidence/shots/q5/dark/025-3d-blue-transparent-70.png)
- Code: `src/modules/designer/frontend/three-d/BoardGeometry.tsx:34` — maskOpacity 'accepted for API compatibility' — ignored
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:248` — transparencyToMaskOpacity feeds an ignored prop
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:765` — gl alpha:false; transparent scene = #0b0b0d (:244)
- Suggested fix: Either wire maskOpacity into BoardSubstrate's face material (transparent + depthWrite off, opacity from the slider) so copper/drills show through, or remove the Transparency section from Board3DOverlay until implemented; rename 'Transparent' scene or render with alpha:true for snapshots.
- Verification (vq5): **confirmed** — Reproduced: slider 0 vs 100 on LED Indicators 5V -> canvas pixel diff max 3/765, mean 0.36. Root cause is stronger than reported: BoardGeometry.tsx declares `maskOpacity` as 'Accepted for API compatibility; the matte two-tone board ignores it' and never uses it, so the Transparency slider is a dead control on every board (the q5 blocker about testing on a copper board is moot). 'Transparent' scene is just #0b0b0d with gl alpha:false (Board3DCanvas.tsx:244, :765). · evidence: [013-3d-transp-0](../evidence/shots/vq5/dark/013-3d-transp-0.png), [014-3d-transp-100](../evidence/shots/vq5/dark/014-3d-transp-100.png), src/modules/designer/frontend/three-d/BoardGeometry.tsx:34-35

</details>


## T-241

**3D Mechanical card truncates every value at 1440 px and mislabels counts ('Parts 16 · 0 traces · 0 vias')**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate XS
- Findings: Q5-017

**Summary.** Fixed w-48 card with w-14 labels: 'Board 50.0 × 30.0…', 'Stackup 2 layer · 1…', 'Parts 16 · 0 trac…' — the numbers users need are cut, even at the primary viewport. The 'Parts' row also carries traces and vias. Status bar echoes raw ids in lower case ('iso', 'studio dark', 'persp'); 'Persp' preset is just another perspective angle (all presets are perspective, 'Top' is not orthographic).

**Root cause.** `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:272` — w-48 card

**Proposed fix.** Mechanical card: wider value column/wrap; correct counts (traces/vias from projection). — Detail: Stack label over value or widen to ~w-60 and split rows (Board / Stackup / Parts / Traces / Vias); map preset/scene ids to their labels in the status bar; rename 'Persp' to 'Perspective (default)' or add a real orthographic Top.

**Evidence.** [020-3d-initial](../evidence/shots/q5/dark/020-3d-initial.png), [011-3d-initial](../evidence/shots/vq5/dark/011-3d-initial.png)

<details><summary>Q5-017 — 3D Mechanical card truncates every value at 1440 px and mislabels counts ('Parts 16 · 0 traces · 0 vias') (S3, confirmed)</summary>

- Area designer.3d · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900, 1100x720
- Repro:
  1. Open 'LED Indicators 5V' → 3D with the side panel (Assistant dock) open at 1440×900
- Expected: Values fully readable ('50.0 × 30.0 mm', '2 layer · 1.6 mm', '16 parts · 0 traces · 0 vias').
- Actual: Fixed w-48 card with w-14 labels: 'Board 50.0 × 30.0…', 'Stackup 2 layer · 1…', 'Parts 16 · 0 trac…' — the numbers users need are cut, even at the primary viewport. The 'Parts' row also carries traces and vias. Status bar echoes raw ids in lower case ('iso', 'studio dark', 'persp'); 'Persp' preset is just another perspective angle (all presets are perspective, 'Top' is not orthographic).
- Screenshots: [020-3d-initial](../evidence/shots/q5/dark/020-3d-initial.png), [036-3d-thickness-ignores-design](../evidence/shots/q5/dark/036-3d-thickness-ignores-design.png)
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:272` — w-48 card
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:408` — w-14 label + truncate value
- Code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:386` — raw preset/scene ids in status bar
- Suggested fix: Stack label over value or widen to ~w-60 and split rows (Board / Stackup / Parts / Traces / Vias); map preset/scene ids to their labels in the status bar; rename 'Persp' to 'Perspective (default)' or add a real orthographic Top.
- Verification (vq5): **confirmed** — Reproduced at 1440x900 with the Assistant dock open: 'Board 50.0 × 30.0…', 'Stackup 2 layer · 1…', 'Parts 16 · 0 trac…' (w-48 card + w-14 labels + truncate, Board3DOverlay.tsx:272, 296-310, 405-411; the code comment at :42-47 even acknowledges the truncation). Status bar shows raw 'iso' / 'studio dark'. PRESET_POSITIONS (Board3DCanvas.tsx:52-59) confirms 'Persp' and 'Top' are both perspective positions. · evidence: [011-3d-initial](../evidence/shots/vq5/dark/011-3d-initial.png), [012-3d-heatmap-legend](../evidence/shots/vq5/dark/012-3d-heatmap-legend.png)

</details>


## T-242

**3D error state floods the whole viewport with a maroon wash, no retry, empty left rail**

- Severity **S3** · category error-handling · status confirmed · themes light
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate XS
- Findings: Q5-033

**Summary.** The entire 800×866 canvas area turns #7a4e4f (bg-red-950/70 over the light surface) with a small red card '3D view unavailable / Internal error'; no retry (must leave and re-enter the tab); the left rail is blank white. Off-token colours (red-950/red-800/red-200).

**Root cause.** `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:270` — Board3DStatePanel error variant fills container with errorBackground

**Proposed fix.** 3D error state: neutral kit EmptyState with reason + Retry. — Detail: Keep the canvas-well background, show a tokenised error card with Retry (re-run getPcbProjection); render the rail with disabled controls.

**Evidence.** [110-3d-error](../evidence/shots/q5/light/110-3d-error.png), [002-3d-error](../evidence/shots/vq5/light/002-3d-error.png)

<details><summary>Q5-033 — 3D error state floods the whole viewport with a maroon wash, no retry, empty left rail (S3, confirmed)</summary>

- Area designer.3d · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes light · viewports 1440x900
- Repro:
  1. route **/projection/pcb → 500
  2. Open the 3D tab
- Expected: A calm kit error state (status-danger text/icon on the canvas-well surface) with a Retry button; left rail shows controls disabled or a note.
- Actual: The entire 800×866 canvas area turns #7a4e4f (bg-red-950/70 over the light surface) with a small red card '3D view unavailable / Internal error'; no retry (must leave and re-enter the tab); the left rail is blank white. Off-token colours (red-950/red-800/red-200).
- Screenshots: [110-3d-error](../evidence/shots/q5/light/110-3d-error.png)
- Network: `GET …/projection/pcb → 500 (injected)`
- Pixel probes: {"file": "shots/q5/light/110-3d-error.png", "x": 500, "y": 300, "hex": "#7a4e4f", "nearestToken": "--text-secondary", "deltaE": 20.5}
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:270` — Board3DStatePanel error variant fills container with errorBackground
- Suggested fix: Keep the canvas-well background, show a tokenised error card with Retry (re-run getPcbProjection); render the rail with disabled controls.
- Verification (vq5): **confirmed** — Reproduced in light: projection/pcb routed to 500 -> whole canvas #7a4e4f wash with small '3D view unavailable / Internal error' card, left rail blank #f7f7f8, no Retry. Unrouted afterwards. · evidence: [002-3d-error](../evidence/shots/vq5/light/002-3d-error.png), probe: wash #7a4e4f, rail #f7f7f8

</details>


## T-243

**3D view floods the console with THREE deprecation warnings (PCFSoftShadowMap ×31, Clock)**

- Severity **S4** · category console · status confirmed · themes dark
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate XS
- Findings: Q5-018

**Summary.** 31× 'THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.' (one per re-render/shadow update) and 2× 'THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.' (also emitted on the schematic/PCB canvases).

**Root cause.** `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:758` — shadows="soft" → PCFSoftShadowMap

**Proposed fix.** Replace PCFSoftShadowMap with supported shadow type. — Detail: Use shadows="percentage"/PCFShadowMap (or VSM) explicitly; the Clock warning comes from @react-three/fiber — upgrade or filter.

**Evidence.** `console: [WARNING] THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead. (×31)`

<details><summary>Q5-018 — 3D view floods the console with THREE deprecation warnings (PCFSoftShadowMap ×31, Clock) (S4, confirmed)</summary>

- Area designer.3d · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. Open a design → 3D, change a few display/scene options, orbit
  2. console warning
- Expected: No warnings.
- Actual: 31× 'THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.' (one per re-render/shadow update) and 2× 'THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.' (also emitted on the schematic/PCB canvases).
- Console: `[WARNING] THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead. (×31)`; `[WARNING] THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:758` — shadows="soft" → PCFSoftShadowMap
- Suggested fix: Use shadows="percentage"/PCFShadowMap (or VSM) explicitly; the Clock warning comes from @react-three/fiber — upgrade or filter.
- Verification (vq5): **confirmed** — Reproduced: after opening 3D and toggling a few options, console had 5x 'THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated' and 7x 'THREE.THREE.Clock: This module has been deprecated'. shadows="soft" at Board3DCanvas.tsx:758. · evidence: console warning: 5x PCFSoftShadowMap, 7x THREE.Clock (session vq5-dark)

</details>


## T-395

**3D Snapshot button has no accessible label (K27)**

- Severity **S4** · category a11y · status refuted · themes dark, light
- Recommendation **wont-fix** · owner — · wave followup · scope frontend · estimate XS
- Findings:  · known ref K27

**Summary.** Refuted by q5: the 3D Snapshot button has accessible name 'Snapshot' from its visible text and downloads <designId>-3d.png.

**Root cause.** `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:None` — Refuted

**Proposed fix.** None — 3D Snapshot button is named 'Snapshot' (visible text).

**Note.** Refuted by q5: the 3D Snapshot button has accessible name 'Snapshot' from its visible text and downloads <designId>-3d.png.

