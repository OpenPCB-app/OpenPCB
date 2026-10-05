# Fix brief — owner L4b

3 approved triage entries. Entries marked **shared** are co-owned: implement ONLY the part that lives in your owned files; the lead owner is listed. Screenshot paths are absolute (open with the Read tool for layout only).

## T-318 [S2] Footprint editor cannot place pads precisely: no X/Y fields, fixed 0.635 mm grid, no zoom-to-fit

- Area library.footprint-editor · category bug · estimate M · findings Q7-015
- Summary: Pad row has only #, Shape, W, H, Rot, Layer, Drill — no position. Grid is hard-coded 0.635 mm (setGridSizeMm has no UI), so metric pitches are unreachable except by free placement. No Fit/zoom buttons in either editor toolbar; after zooming in the pads were off-screen with no way back except blind wheel-out (054). Drill 2 mm on a 1.6 mm pad is accepted (only an amber 'Annular ring −0.20mm' note) and the pad renders…
- Root cause: `src/modules/library/frontend/import-wizard/footprint-editor/PadPropertyPanel.tsx:110` — no positionMm inputs
- Proposed fix: Pad X/Y inputs, grid-size select (presets), Zoom-to-fit (F), drill < pad validation. — Detail: Add X/Y (mm) inputs to PadRow (commitPatch positionMm), a grid-size select next to Grid in FootprintEditorToolbar/EditorToolbar, a 'Zoom to fit' button (+ F/Home key) using the canvas fit helper, and block drill ≥ min(W,H).
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q7/dark/051-footprint-2pads.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq7/dark/022-footprint-2pads.png
- Q7-015 repro: Footprints → Draw → D (Pad) → click twice → Look at the Pads panel (right) → Try to put pads at a 0.5/0.65/0.8/1.0 mm pitch; zoom in, then try to get back to the pads
  - expected: Pad properties include Position X/Y (mm), grid size selectable (0.05/0.1/0.25/0.5/1.27 mm…), and a Fit/Zoom-to-fit control (toolbar + key) like the designer toolbars.
  - actual: Pad row has only #, Shape, W, H, Rot, Layer, Drill — no position. Grid is hard-coded 0.635 mm (setGridSizeMm has no UI), so metric pitches are unreachable except by free placement. No Fit/zoom buttons in either editor toolbar; after zooming in the pads were off-screen with no way back except blind wheel-out (054). Drill 2 mm on a 1.6 mm pad is accepted (only an amber 'Annular ring −0.20mm' note) and the pad renders invisible. Default editor zoom (DEFAULT_PCB_ZOOM = 8 px/mm) renders a 1.6 mm pad as ~13 px, the pad number as a 1-px speck and the '1.60 × 1.60' dimension label ~5 px tall (unreadable) — every new footprint starts zoomed far out with no fit command.
  - code: `src/modules/library/frontend/import-wizard/footprint-editor/PadPropertyPanel.tsx:110` no positionMm inputs
  - code: `src/modules/library/frontend/import-wizard/footprint-editor/useFootprintEditorStore.ts:236` gridSizeMm: 0.635 fixed
  - code: `src/modules/library/frontend/import-wizard/footprint-editor/FootprintEditorToolbar.tsx:1` no fit/zoom controls

## T-300 [S3] Part wizard and both editors are an unmigrated surface: raw slate/violet/emerald/amber/pink palette, native file inputs/selects/checkboxes, floating blurred toolbar unlike designer toolbars

- Area library.wizard · category consistency · estimate L · findings Q7-023 · known K45
- **shared** with L2, L3; lead: L2
- Summary: Editor toolbars are floating pills with border+shadow-sm+backdrop-blur and 28×28 buttons, active state via violet (remapped grey) border, no aria-pressed/focus-visible (focus ring is the browser default #99c8ff). Progress bar 'done' = raw emerald-500 #00bc7d (ΔE 17 from --status-success); 'current' #3a3a40 barely differs from pending #1c1c1f in dark. Tool 'hint' rings/dots raw emerald. Warning boxes raw amber (#4619…
- Root cause: `src/modules/library/frontend/import-wizard/editor/EditorToolbar.tsx:102` — rounded-lg border shadow-sm backdrop-blur pill; h-7 w-7 buttons
- Proposed fix: Wizard + editors to tokens/kit (no pink/violet/emerald, kit file input/selects/checkboxes, flat toolbar). — Detail: Migrate import-wizard/* to src/shared/frontend/ui (Toolbar/ToolbarButton pressable, SegmentedControl for source toggles, Checkbox, kit Select, Button primary for Next/Import, status tokens for warnings/progress); dock the editor toolbar like the designer's instead of a floating pill; aria-label='Close wizard' on the back arrow.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q7/dark/040-footprint-step.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq7/dark/025-metadata.png
- Q7-023 repro: Open Library → New part and walk all 4 steps in dark and light
  - expected: Kit components and tokens (Toolbar 30px docked, ToolbarButton 24px with aria-pressed + focus-visible outline, Checkbox, Select, status tokens, --selection) as in the designer.
  - actual: Editor toolbars are floating pills with border+shadow-sm+backdrop-blur and 28×28 buttons, active state via violet (remapped grey) border, no aria-pressed/focus-visible (focus ring is the browser default #99c8ff). Progress bar 'done' = raw emerald-500 #00bc7d (ΔE 17 from --status-success); 'current' #3a3a40 barely differs from pending #1c1c1f in dark. Tool 'hint' rings/dots raw emerald. Warning boxes raw amber (#461901 dark bg ΔE 23.9 from --status-warning-soft; #fffbeb light), 3D 'will be converted' box raw emerald-50 #ecfdf5, card shadows on 3D/Metadata cards (light: #e1e1e2→#f6f6f7 gradient under the card). Native <input type=file> 'Choose File', native selects (Pin Type/Rotation, Pad Shape/Layer, 15px toolbar layer select), 9 native checkboxes in Layers (#4098ff/#99c8ff default accent, unlabelled). Canvas bg hard-coded #131313 (token --surface-canvas-well #08090a). Back arrow button h
  - code: `src/modules/library/frontend/import-wizard/editor/EditorToolbar.tsx:102` rounded-lg border shadow-sm backdrop-blur pill; h-7 w-7 buttons
  - code: `src/modules/library/frontend/import-wizard/WizardProgressBar.tsx:31` bg-emerald-500 / bg-violet-600
  - code: `src/modules/library/frontend/import-wizard/footprint-editor/LayerPanel.tsx:1` native checkboxes
  - code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:662` icon-only back button without aria-label

## T-301 [S3] Wizard pin/pad panels: 9px labels (2.1–2.3:1 in light) and 15–36px inputs; pin Type select truncated

- Area library.wizard · category visual · estimate S · findings Q7-024, Q7-025 · known K36,K37
- **shared** with L3; lead: L3
- Summary: Census: 10 × 9px labels in the Pins panel (#, Name, Type, Rotation, Length), 14 × 9px in the Pads panel (#, Shape, W (mm), H (mm), Rot, Layer, Drill (mm)). Light theme contrast of these labels on white: 2.11 ('TYPE'), 2.29 ('NAME'); shortcut list text 3.48. 'Next pin defaults' uses 10px. Canvas dimension labels ~5px at default zoom. | Also covers: Q7-025: Wizard input heights are 15/24/28/32/36 px (kit standard 22px); pin 'Type' select truncat…
- Root cause: `src/modules/library/frontend/import-wizard/editor/PinPropertyPanel.tsx:96` — text-[9px] uppercase text-slate-400
- Proposed fix: Pin/pad property panels: ≥10px labels (token contrast), kit 22px inputs/selects with min widths. — Detail: Use the kit PropertyGrid / label style (text-2xs ≥10px, --text-caps colour) in PinPropertyPanel and PadPropertyPanel.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q7/light/010-symbol-draw.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq7/light/006-symbol-draw.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q7/dark/015-draw-rect-2pins.png
- Q7-024 repro: Draw symbol → place 2 pins (Pins panel) → Footprints → Draw → place 2 pads (Pads panel) → Run DOM census
  - expected: ≥10px text (kit 10–11px caps labels) with ≥4.5:1 contrast.
  - actual: Census: 10 × 9px labels in the Pins panel (#, Name, Type, Rotation, Length), 14 × 9px in the Pads panel (#, Shape, W (mm), H (mm), Rot, Layer, Drill (mm)). Light theme contrast of these labels on white: 2.11 ('TYPE'), 2.29 ('NAME'); shortcut list text 3.48. 'Next pin defaults' uses 10px. Canvas dimension labels ~5px at default zoom.
  - code: `src/modules/library/frontend/import-wizard/editor/PinPropertyPanel.tsx:96` text-[9px] uppercase text-slate-400
  - code: `src/modules/library/frontend/import-wizard/footprint-editor/PadPropertyPanel.tsx:1` text-[9px] labels
- Q7-025 repro: Draw symbol → place a pin; Footprints → Draw; Metadata → DOM census
  - expected: Controls 22px (sm 20px), selects wide enough to show their value.
  - actual: Census heights: input 32 (Reference prefix, Footprint name, Component name), input/select 24 (pin/pad rows), select 28 (Next pin defaults), select 15 (toolbar layer), symbol select 36 (h-9), tag input 15. The pin row Type select is 43px wide and shows only 'Pa' for 'Passive' at the default 264px sidebar. Header Next/Import buttons 32px and 'Import component' wraps onto two lines inside the fixed w-44 action area.
  - code: `src/modules/library/frontend/import-wizard/editor/PinPropertyPanel.tsx:150` Type select flex-1 next to fixed 72px rotation + length
  - code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:685` w-44 action area, h-8 buttons
