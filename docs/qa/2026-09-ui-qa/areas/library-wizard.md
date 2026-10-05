# library.wizard — QA findings

[← index](../README.md) · 17 triage entries · S1 0 · S2 5 · S3 9 · S4 3

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-292](#t-292) | S2 | Part wizard Enter hijack: Enter on 'Back' imports; second Enter in a field silently advances | F1C-009, Q7-018 | fix-now | L2 / W3 | frontend | S |
| [T-293](#t-293) | S2 | Part wizard close/leave: native confirm, dirty check misses footprint/metadata work, rail leaves without guard, stale draft resumes | Q7-001, Q7-019, Q7-021 | fix-now | L2 / W3 | frontend | S |
| [T-294](#t-294) | S2 | Multi-unit symbols (74HC00, LM358) render all units + De Morgan superimposed (wizard, preview pane, detail, fullscreen) | Q7-003, Q6-013 | fix-now | L3+L1 / W3 | frontend | M |
| [T-295](#t-295) | S2 | Garbage STEP is accepted with a green 'will be converted' message and then fails silently after import | Q7-016 | fix-now | L2+L1 / W3 | frontend | S |
| [T-296](#t-296) | S2 | Pin/pad mismatch is a soft warning in the wizard but a hard 400 on Import; no pin↔pad mapping UI; error names internal 'U'/'FP' | Q7-017 | fix-now | L2 / W3 | frontend | M |
| [T-297](#t-297) | S3 | Keyboard-only part wizard: focus is never placed or moved on step change, controls are unnamed or invisibly focused, and Next/'Import component' sits before the step content (an accidental Space imports the part) | F1C-010, F1C-011 | fix-now | L2 / W3 | frontend | M |
| [T-298](#t-298) | S3 | Grid never renders in any wizard/preview canvas: GridShader's uPixelsPerUnit uniform is stuck at 1 so every fragment is discarded; symbol-import Grid toggle is also dead | Q7-002 | defer | followup / followup | shared-package | S |
| [T-299](#t-299) | S3 | Invalid symbol file: error shown only in far-right panel while left/centre claim nothing was imported | Q7-004 | fix-now | L3 / W3 | frontend | S |
| [T-300](#t-300) | S3 | Part wizard and both editors are an unmigrated surface: raw slate/violet/emerald/amber/pink palette, native file inputs/selects/checkboxes, floating blurred toolbar unlike designer toolbars | Q7-023 | fix-now | L2+L3+L4b / W3 | frontend | L |
| [T-301](#t-301) | S3 | Wizard pin/pad panels: 9px labels (2.1–2.3:1 in light) and 15–36px inputs; pin Type select truncated | Q7-024, Q7-025 | fix-now | L3+L4b / W3 | frontend | S |
| [T-302](#t-302) | S3 | Editors don't fit at 1100×720 (and footprint toolbar already overflows at 1440): floating toolbar covers the right panel | Q7-026 | fix-now | L2 / W3 | frontend | S |
| [T-303](#t-303) | S3 | Successful 'Import component' gives no feedback and doesn't reveal the new part (not even listed when the library has >60 parts) | Q7-027 | fix-now | L2+L1 / W3 | frontend | S |
| [T-304](#t-304) | S3 | Metadata step lacks core part fields (value, MPN, manufacturer, datasheet); reference prefix only editable for drawn symbols | Q7-030 | decide (P6) | L2 / proposal | proposal | M |
| [T-305](#t-305) | S3 | 3D Model step has no 3D preview, placement or orientation controls — model is attached blind | Q7-035 | decide (P6) | L2 / proposal | proposal | L |
| [T-306](#t-306) | S4 | 'Import component' wraps onto two lines inside the fixed 176 px wizard header action area | F1C-012 | fix-now | L2 / W3 | frontend | XS |
| [T-307](#t-307) | S4 | Symbol import copy: '(1 pins)', literal '~' pin name, duplicate warnings for one construct | Q7-005 | fix-now | L3 / W3 | frontend | S |
| [T-308](#t-308) | S4 | Wizard steps are laid out inconsistently (section header styles, sidebar widths, which side holds the pin/pad list, toolbar off-centre) | Q7-036 | decide (P6) | L2 / proposal | proposal | S |

## T-292

**Part wizard Enter hijack: Enter on 'Back' imports; second Enter in a field silently advances**

- Severity **S2** · category keyboard · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L2 · wave W3 · scope frontend · estimate S
- Findings: F1C-009, Q7-018

**Summary.** The window-level Enter binding calls handleNext() and preventDefault()s the keydown, so the focused button's own action never runs. Enter on 'Preset' skipped straight to step 3 (Preset was never selected). Enter on 'Back' at step 3 moved forward to Metadata. Enter on 'Back' at Metadata ran runCommit and imported 'QA-f1c-enter-on-back-test' (id e8252e42-…) with no confirmation. The same applies to the step buttons, C… | Also covers: Q7-018: Enter in a property field commits, a second Enter silently advances the wizard step

**Root cause.** `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:644` — Enter binding → e.preventDefault(); handleNext() for any non-editable target

**Proposed fix.** Wizard Enter handler only acts when focus is in a field of the current step and not on a button; field Enter commits without advancing. — Detail: In the Enter binding's matches(), skip events whose target is a button, [role=button], select, a or [role=option] (closest('button,a,select,[role=button],[role=option]')). Better, drop the window-level Enter entirely and wrap each step in a <form onSubmit={handleNext}>. Never commit on Enter from the Metadata step unless focus is in a text field or on 'Import component'.

**Evidence.** [029-kbd-wizard-enter-on-back-went-forward](../evidence/shots/f1c/dark/029-kbd-wizard-enter-on-back-went-forward.png), [006-wizard-metadata-focus-on-back](../evidence/shots/vf1c/light/006-wizard-metadata-focus-on-back.png), [023-after-second-enter](../evidence/shots/vq7/dark/023-after-second-enter.png)

<details><summary>F1C-009 — Enter on any focused button in the part wizard runs Next/Import instead of that button: Enter on 'Back' at Metadata imports the part (S2, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library → New part → import simple_resistor.kicad_sym (keyboard walk, dark)
  2. Footprints step: Tab to 'Preset' → Enter
  3. 3D step: focus 'Back' → Enter
  4. Light: complete Symbol (simple_capacitor.kicad_sym) → Next ×3 to Metadata, set Component name 'QA-f1c-enter-on-back-test', focus 'Back' → Enter
- Expected: Enter activates the focused button, like Space does: Preset switches the footprint source, Back goes back. Enter only advances when focus is on Next or inside a single-line field, as an intentional submit.
- Actual: The window-level Enter binding calls handleNext() and preventDefault()s the keydown, so the focused button's own action never runs. Enter on 'Preset' skipped straight to step 3 (Preset was never selected). Enter on 'Back' at step 3 moved forward to Metadata. Enter on 'Back' at Metadata ran runCommit and imported 'QA-f1c-enter-on-back-test' (id e8252e42-…) with no confirmation. The same applies to the step buttons, Chip/size/density options, Generate footprint and the Remove-tag ×. Keyboard users must know to use Space, and Enter can create library parts by accident. Space works correctly throughout.
- Screenshots: [029-kbd-wizard-enter-on-back-went-forward](../evidence/shots/f1c/dark/029-kbd-wizard-enter-on-back-went-forward.png), [002-wizard-metadata-before-enter-on-back](../evidence/shots/f1c/light/002-wizard-metadata-before-enter-on-back.png)
- Console: `Enter on Preset: h2 → '3D STEP model'; Space on '2. Footprints' → footprint mode still 'Import'`
- Network: `GET /components?q=enter-on-back → [{id:'e8252e42-bead-4c88-8232-60d681227c17', name:'QA-f1c-enter-on-back-test'}] created by Enter on Back`
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:644` — Enter binding → e.preventDefault(); handleNext() for any non-editable target
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:653` — useWindowKeyboardShortcuts(..., { ignoreEditableTarget: true }) — buttons are not excluded
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/utils/keyboard-shortcuts.js:20` — isEditableShortcutTarget covers input/textarea/select/contenteditable only; buttons are not excluded, and the window keydown handler runs before the button's default Enter activation
- Suggested fix: In the Enter binding's matches(), skip events whose target is a button, [role=button], select, a or [role=option] (closest('button,a,select,[role=button],[role=option]')). Better, drop the window-level Enter entirely and wrap each step in a <form onSubmit={handleNext}>. Never commit on Enter from the Metadata step unless focus is in a text field or on 'Import component'.
- Verification (vf1c): **confirmed** — Reproduced in vf1c-light. Library > New part > import simple_capacitor.kicad_sym > Next x3 > Metadata. Set the name to 'QA-vf1c-enter-on-back', focus 'Back' (activeElement 'Back'), press Enter. The wizard did not go back. Instead it fired POST /api/modules/library/imports/kicad -> 200 {componentId:'e8252e42-…', componentName:'QA-f1c-enter-on-back-test', reused:true}, i.e. runCommit ran from the Back button. No new row was created only because the backend content-deduped to the part f1c's identical import had created, and the typed name was discarded, with a notice 'Component “QA-f1c-enter-on-back-test” already exists — reused existing record.'. Code: the Enter binding (ImportWizardPage.tsx:644-649) calls preventDefault + handleNext for any non-editable target, and useWindowKeyboardShortcuts only skips input/textarea/select/contenteditable. Not intentional. S2 kept: Enter on a focused button does the opposite action and can commit a part (keyboard trap-like misbehaviour). · evidence: [006-wizard-metadata-focus-on-back](../evidence/shots/vf1c/light/006-wizard-metadata-focus-on-back.png), [007-wizard-enter-on-back-committed](../evidence/shots/vf1c/light/007-wizard-enter-on-back-committed.png), requests: 654. [POST] /api/modules/library/imports/kicad => 200 {reused:true, componentName:'QA-f1c-enter-on-back-test'} after Enter on 'Back'

</details>

<details><summary>Q7-018 — Enter in a property field commits, a second Enter silently advances the wizard step (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Footprints → Draw → place a pad
  2. Click the pad's W (mm) field, type 1.2, press Enter (field blurs, focus → body)
  3. Press Enter again
- Expected: Enter commits the field and keeps focus in the panel; wizard advance only via explicit Next (or Cmd/Ctrl+Enter).
- Actual: Second Enter jumps to '3D STEP model' step (eval: activeElement BODY → h2='3D STEP model'). Same with the Pin panel and after drawing on the canvas; a stray Enter while editing moves the user off the editor.
- Console: `after Enter #1: 'BODY W=1.2'; after Enter #2: h2='3D STEP model'`
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:644` — window Enter → handleNext
- Code: `src/modules/library/frontend/import-wizard/footprint-editor/PadPropertyPanel.tsx:175` — Enter → blur
- Suggested fix: Bind wizard advance to Mod+Enter (or only when focus is on the wizard chrome), and keep focus on the input after Enter commit instead of blurring to body.
- Verification (vq7): **confirmed** — Reproduced: pad W field, typed 1.2, Enter -> activeElement BODY (still on Footprints); second Enter -> h2 '3D STEP model'. ImportWizardPage.tsx:644 window Enter binding -> handleNext with ignoreEditableTarget only. · evidence: eval after Enter #1: 'BODY step:Drawing Summary'; after Enter #2: 'BODY headings:3D STEP model', [023-after-second-enter](../evidence/shots/vq7/dark/023-after-second-enter.png)

</details>


## T-293

**Part wizard close/leave: native confirm, dirty check misses footprint/metadata work, rail leaves without guard, stale draft resumes**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner L2 · wave W3 · scope frontend · estimate S
- Findings: Q7-001, Q7-019, Q7-021 · known ref K06
- Depends on: ['T-014']

**Summary.** Browser-native window.confirm opens (spy: confirm=1, 'confirm: Close the wizard? Unsaved changes will be lost.'); playwright press blocks until the native dialog is dismissed. Native dialogs are unstyled, block the renderer and look amateur inside Electron. | Also covers: Q7-019: Leaving the wizard via the rail has no unsaved-work guard; 'New part' later silently resu…; Q7-021: Esc discards footprint/preset/metadata work without any confirm (dirty check only looks a…

**Root cause.** `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:577` — window.confirm in handleClose

**Proposed fix.** Kit confirmDialog on close; dirty check covers footprint/preset/metadata; guard rail navigation; 'New part' asks Resume/Discard. — Detail: Replace window.confirm in ImportWizardPage.handleClose with the shared kit confirm Dialog (src/shared/frontend/ui) rendered by the wizard; Esc/Back open it, Enter=Keep editing default.

**Evidence.** [007-symbol-import-garbage](../evidence/shots/q7/dark/007-symbol-import-garbage.png), [001-symbol-import-resistor](../evidence/shots/vq7/dark/001-symbol-import-resistor.png), [090-return-after-rail](../evidence/shots/q7/dark/090-return-after-rail.png)

<details><summary>Q7-001 — Part wizard close uses native window.confirm ('Close the wizard? Unsaved changes will be lost.') (S2, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Library → New part
  2. Import file → Choose File → simple_resistor.kicad_sym (or garbage.step)
  3. Click empty right panel so focus leaves the file input
  4. Press Esc (or click the ← back arrow)
- Expected: In-app styled confirm dialog (kit Dialog) with Discard / Keep editing; works in Electron and is keyboard-trappable.
- Actual: Browser-native window.confirm opens (spy: confirm=1, 'confirm: Close the wizard? Unsaved changes will be lost.'); playwright press blocks until the native dialog is dismissed. Native dialogs are unstyled, block the renderer and look amateur inside Electron.
- Screenshots: [007-symbol-import-garbage](../evidence/shots/q7/dark/007-symbol-import-garbage.png)
- Console: `__qaDialogCalls = {confirm:1, log:['confirm: Close the wizard? Unsaved changes will be lost.']}`
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:577` — window.confirm in handleClose
- Suggested fix: Replace window.confirm in ImportWizardPage.handleClose with the shared kit confirm Dialog (src/shared/frontend/ui) rendered by the wizard; Esc/Back open it, Enter=Keep editing default.
- Verification (vq7): **confirmed** — Reproduced on stack B (vq7-dark): imported simple_resistor.kicad_sym, clicked empty right panel (activeElement BODY), pressed Esc -> playwright modal state '"confirm" dialog with message "Close the wizard? Unsaved changes will be lost."'; spy confirm=1. Code: ImportWizardPage.tsx:577 window.confirm inside handleClose, reached from the window Esc binding (:640) and the unlabeled back-arrow (:665). Native confirm in Electron = S2 per protocol. · evidence: [001-symbol-import-resistor](../evidence/shots/vq7/dark/001-symbol-import-resistor.png), console: __qaDialogCalls={confirm:1, log:['confirm: Close the wizard? Unsaved changes will be lost.']}

</details>

<details><summary>Q7-019 — Leaving the wizard via the rail has no unsaved-work guard; 'New part' later silently resumes the stale draft (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Library → New part → Import file → simple_resistor.kicad_sym
  2. Click Home in the rail (no prompt)
  3. Click Library → the list is shown (wizard gone)
  4. Click New part
- Expected: Rail navigation away from a dirty wizard asks to keep/discard (in-app dialog), or the wizard stays open when returning to Library; 'New part' starts clean or offers 'Resume draft'.
- Actual: No confirm on rail navigation (spy confirm count unchanged). Returning to Library shows the list; New part reopens with the previous symbol (R, 2 pins) while the native file input reads 'No file chosen' next to the stale 'simple_resistor.kicad_sym' chip. A page reload would lose it (only beforeunload guard when a symbol file exists).
- Screenshots: [090-return-after-rail](../evidence/shots/q7/dark/090-return-after-rail.png), [091-reopen-wizard-stale](../evidence/shots/q7/dark/091-reopen-wizard-stale.png)
- Code: `src/modules/library/frontend/Space.tsx:184` — wizardOpen is local state, lost on unmount while zustand stores persist
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:567` — reset only in handleClose/success
- Suggested fix: Lift wizardOpen into useImportWizardStore (so returning to Library restores the wizard) and register a navigation guard with the shell for dirty wizard state (in-app dialog); replace the native file input with a kit button + filename chip so the UI can't disagree.
- Verification (vq7): **confirmed** — Reproduced: wizard with simple_resistor imported -> rail Home (spy confirm unchanged 6->6) -> Library shows the list -> New part reopens directly on the Metadata step of the stale draft (with the stale OCCT footer from the previous import), native file input empty. Space.tsx:184 wizardOpen is local useState while the zustand stores persist. · evidence: [030-reopen-wizard-stale](../evidence/shots/vq7/dark/030-reopen-wizard-stale.png)

</details>

<details><summary>Q7-021 — Esc discards footprint/preset/metadata work without any confirm (dirty check only looks at symbol file, STEP file and drawn symbol) (S2, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Library → New part → Draw symbol (draw nothing) → Next (allowed with 0 pins)
  2. Footprints → Draw → D → place 3 pads → V
  3. Press Esc
- Expected: Any user work (drawn/imported/preset footprint, metadata edits) triggers the discard confirmation.
- Actual: Wizard closes immediately back to the Library list, spy confirm count unchanged (5→5); the 3 pads (Drawing Summary 3/0) are gone — store reset. hasWork ignores footprintFiles, generatedFootprint, footprint editor pads/graphics, componentName/description/tags. Related: Next is enabled on the Symbol step with an empty drawn symbol even though the panel says 'Add at least one pin before proceeding.'
- Screenshots: [062-fp-work-before-esc](../evidence/shots/q7/dark/062-fp-work-before-esc.png)
- Console: `after Esc: h1='Library', __qaDialogCalls.confirm=5 (unchanged)`
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:571` — hasWork = symbolFile \|\| modelFile \|\| drawn symbol graphics/pins
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:136` — readyForAdvancedSteps true for any draw-mode symbol
- Suggested fix: Compute hasWork from all stores: footprintFiles.length, generatedFootprint, useFootprintEditorStore pads/graphics/labels, metadata dirty flags; require ≥1 pin for draw-mode canProceed on the Symbol step.
- Verification (vq7): **confirmed** — Reproduced: Draw symbol (0 pins; Next enabled although the panel says 'Add at least one pin before proceeding.') -> Footprints Draw -> 3 pads -> Esc: wizard closed, spy confirm 7->7, pads gone. Also reproduced with two imported .kicad_mod files + idle Text tool: Esc closed the wizard silently. hasWork (ImportWizardPage.tsx:571) ignores footprintFiles, generatedFootprint, footprint editor state and metadata. · evidence: [031-fp-work-before-esc](../evidence/shots/vq7/dark/031-fp-work-before-esc.png), after Esc: h1='Library', confirm count 7 (unchanged)

</details>


## T-294

**Multi-unit symbols (74HC00, LM358) render all units + De Morgan superimposed (wizard, preview pane, detail, fullscreen)**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L3+L1 · wave W3 · scope frontend · estimate M
- Findings: Q7-003, Q6-013

**Summary.** All 3 units drawn on top of each other: pin numbers 3 & 5, 2 & 6, 1 & 7 overprint each other, the power unit (8/4) body overlaps the op-amp bodies. Details say 'Pins 8', no unit count, no warning (inspect API returns unitCount=3 and per-pin unit, warnings=[]). User cannot tell whether the saved part will have overlapping pins. | Also covers: Q6-013: Multi-unit symbols (74HC00, LM358) render all units and the De Morgan body superimposed i…

**Root cause.** `src/modules/library/frontend/import-wizard/steps/SymbolStep.tsx:108` — SymbolPreviewCanvas given the whole preview model; no unit filter

**Proposed fix.** Warn on multi-unit symbols; unit selector/filter in SymbolStep and Library previews (filter graphics by unit before render); pins table sorted. Native unit support = package follow-up. — Detail: Short term (wizard): when inspect returns preview.unitCount > 1, show a warning 'Multi-unit symbols are not supported yet - all N units will be merged into one body' and render a unit selector/filter in SymbolStep; add a 'Units' row to Symbol Details. Real fix needs multi-unit support in the designer (no unit concept exists in designer/schematic code today - SchematicCanvas hard-codes unit: 1), otherwise the merged pins (3/5, 2/6, 1/7 at identical coordinates) end up overlapping on the schematic.

**Evidence.** [005-symbol-import-opamp](../evidence/shots/q7/dark/005-symbol-import-opamp.png), [003-symbol-import-opamp](../evidence/shots/vq7/dark/003-symbol-import-opamp.png), [035-fullscreen-symbol-74hc00](../evidence/shots/q6/dark/035-fullscreen-symbol-74hc00.png)

<details><summary>Q7-003 — Multi-unit symbol import renders all units superimposed with no unit selector (pins 3/5, 2/6, 1/7 overlap) (S2, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Library → New part → Import file → multi_unit_opamp.kicad_sym (LM358, 3 units)
  2. Look at the preview + Symbol Details
- Expected: Preview shows one unit at a time with a Unit A/B/C selector (KiCad behaviour) and details list 'Units: 3'; or a warning that units are merged.
- Actual: All 3 units drawn on top of each other: pin numbers 3 & 5, 2 & 6, 1 & 7 overprint each other, the power unit (8/4) body overlaps the op-amp bodies. Details say 'Pins 8', no unit count, no warning (inspect API returns unitCount=3 and per-pin unit, warnings=[]). User cannot tell whether the saved part will have overlapping pins.
- Screenshots: [005-symbol-import-opamp](../evidence/shots/q7/dark/005-symbol-import-opamp.png)
- Network: `POST /api/modules/library/imports/kicad/inspect → 200, preview.unitCount=3, pins[].unit=1..3, warnings=[]`
- Code: `src/modules/library/frontend/import-wizard/steps/SymbolStep.tsx:108` — SymbolPreviewCanvas given the whole preview model; no unit filter
- Suggested fix: Short term (wizard): when inspect returns preview.unitCount > 1, show a warning 'Multi-unit symbols are not supported yet - all N units will be merged into one body' and render a unit selector/filter in SymbolStep; add a 'Units' row to Symbol Details. Real fix needs multi-unit support in the designer (no unit concept exists in designer/schematic code today - SchematicCanvas hard-codes unit: 1), otherwise the merged pins (3/5, 2/6, 1/7 at identical coordinates) end up overlapping on the schematic.
- Verification (vq7): **confirmed** — Reproduced: multi_unit_opamp.kicad_sym renders LM358 units A/B/C superimposed (pin numbers 3&5, 2&6, 1&7 overprint; power unit body overlaps). Inspect API: preview.unitCount=3, pins carry unit 1..3, warnings=[]. Not a wizard-only preview issue: grep shows no multi-unit handling anywhere in designer/library frontends (unitCount only in the symbol editor store, set to 1), so an imported multi-unit part keeps the stacked pins. S2 kept (wrong data shown and persisted without warning). · evidence: [003-symbol-import-opamp](../evidence/shots/vq7/dark/003-symbol-import-opamp.png), POST /imports/kicad/inspect -> preview.unitCount=3, pins [(3,+,1),(2,-,1),(1,~,1),(5,+,2),(6,-,2),(7,~,2),(8,V+,3),(4,V-,3)], warnings=[]

</details>

<details><summary>Q6-013 — Multi-unit symbols (74HC00, LM358) render all units and the De Morgan body superimposed in the preview pane, detail card and fullscreen (S2, duplicate)</summary>

- Area library.detail · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library table → select core '74HC00 Quad NAND SOIC-14' (preview pane Symbol cell)
  2. Double-click → detail page Symbol card → 'Open symbol full screen'
  3. Compare with Grid view card (server SVG) for the same part
  4. Repeat for 'LM358 Dual Op-Amp'
- Expected: Preview shows one unit (unit A) with a unit selector / 'Unit 1 of 5' badge, or lays the units out side by side — like the Grid card's server-rendered SVG, which draws a single clean NAND gate.
- Actual: The R3F symbol preview draws all 5 units of 74HC00 plus the alternate (De Morgan) body on top of each other: pin numbers overprint ('1/4/9/12' → '19', '3/6/8/11' → '81'), an OR-shape and a huge circle overlap the AND body, VCC/GND labels overprint the filled power-unit box. LM358 shows both op-amp units overprinted (pins 3/5, 2/6, 1/7). Symbol payload: unitCount 5, pins carry `unit`, but symbol-render-layer ignores units. Pins table ordering is also unsorted (1,2,3,4,5,6,8,…,13,7,14).
- Screenshots: [035-fullscreen-symbol-74hc00](../evidence/shots/q6/dark/035-fullscreen-symbol-74hc00.png), [010-detail-builtin](../evidence/shots/q6/dark/010-detail-builtin.png), [033-grid](../evidence/shots/q6/dark/033-grid.png), [023-search-lm358](../evidence/shots/q6/dark/023-search-lm358.png), [010-edit-mode](../evidence/shots/q6/light/010-edit-mode.png), [002-library-table-start](../evidence/shots/q6/light/002-library-table-start.png)
- Network: `GET /components/openpcb.core.ic.74hc00-soic-14/detail → symbol.preview.unitCount=5, 14 pins with unit 1..5, 33 graphics`
- Code: `node_modules/@openpcb/r3f-eda-canvas/src/scene/symbol-render-layer.tsx:1` — no unit / body-style filtering
- Code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:138` — SymbolPreviewCanvas fed the whole multi-unit model
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:557` — same in detail + PreviewModal
- Suggested fix: In @openpcb/rendering-core's symbol preview builder (or the render layer) filter graphics/pins/labels to one unit + body style 1 (plus the shared unit 0), expose unitCount, and add a small 'Unit A ▾' selector / 'A of 5' badge in the preview header; the schematic placement path should be checked for the same superimposition.
- Verification (vq6): **duplicate** — Reproduced (74HC00 preview pane, detail card and fullscreen draw all 5 units + De Morgan body superimposed: pins '19'/'81' overprint, OR-shape + circle over the AND body; pins list unsorted 1..6,8..13,7,14). Same root cause as Q7-003 (verified: symbol preview/render path has no unit/body-style filtering anywhere; wizard import shows LM358 units stacked). Fold the affected surfaces (Library preview pane, detail Symbol card, PreviewModal, core 74HC00/LM358) and the unsorted Pins table into Q7-003; the placement consequence is Q3-015 (S1). · evidence: [009-74hc00-preview](../evidence/shots/vq6/dark/009-74hc00-preview.png), [010-detail-74hc00](../evidence/shots/vq6/dark/010-detail-74hc00.png), [011-fullscreen-symbol-74hc00](../evidence/shots/vq6/dark/011-fullscreen-symbol-74hc00.png)

</details>


## T-295

**Garbage STEP is accepted with a green 'will be converted' message and then fails silently after import**

- Severity **S2** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner L2+L1 · wave W3 · scope frontend · estimate S
- Findings: Q7-016

**Summary.** Only extension/size are checked; wizard closes on success (store reset) so the conversion status footer is never shown; console logs '**** ERR StepFile : Undefined Parsing: Line 2: Incorrect syntax…'; detail page 3D card just shows 'Upload STEP' as if nothing was attempted. Size row shows '0.00 MB' for a 59-byte/746-byte file. Worse: the background failure lands in the NEXT wizard session — after the import closed t…

**Root cause.** `src/modules/library/frontend/three-d/model-conversion.ts:69` — validateStepUploadFile checks only extension + size

**Proposed fix.** Sniff STEP header before accepting; show failure after conversion, not green success. — Detail: Sniff the first bytes for 'ISO-10303-21' in validateStepUploadFile; route conversion progress/failure into the Library NoticeViewport after the wizard closes and persist a failed status the detail 3D card renders; format sizes with B/KB/MB.

**Evidence.** [072-model-garbage-step](../evidence/shots/q7/dark/072-model-garbage-step.png), [024-model-garbage-step](../evidence/shots/vq7/dark/024-model-garbage-step.png)

<details><summary>Q7-016 — Garbage STEP is accepted with a green 'will be converted' message and then fails silently after import (S2, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Wizard → 3D Model → Select STEP model → garbage.step ('this is not a STEP file')
  2. Observe green box 'This model will be converted and attached to the imported footprint.'
  3. Finish Metadata → Import component
  4. Open the new part's detail page
- Expected: Validate the STEP header (ISO-10303-21) on selection and show an error; if conversion fails after import, surface it (notice / detail page 3D card 'Conversion failed — re-upload').
- Actual: Only extension/size are checked; wizard closes on success (store reset) so the conversion status footer is never shown; console logs '**** ERR StepFile : Undefined Parsing: Line 2: Incorrect syntax…'; detail page 3D card just shows 'Upload STEP' as if nothing was attempted. Size row shows '0.00 MB' for a 59-byte/746-byte file. Worse: the background failure lands in the NEXT wizard session — after the import closed the wizard, opening New part → Import file + minimal.step → Metadata already shows the footer 'OCCT could not read the STEP file' (jargon) before anything was converted (screenshot 094). minimal.step (header-valid but no solid geometry) also ends with no model: detail API footprint.model=null/modelStatus=null and the 3D card shows only 'Upload STEP' (095) — no failed state is persisted anywhere.
- Screenshots: [072-model-garbage-step](../evidence/shots/q7/dark/072-model-garbage-step.png), [088-detail-scrolled](../evidence/shots/q7/dark/088-detail-scrolled.png), [071-model-minimal-step](../evidence/shots/q7/dark/071-model-minimal-step.png), [094-metadata-import-path](../evidence/shots/q7/dark/094-metadata-import-path.png), [095-detail-R0603](../evidence/shots/q7/dark/095-detail-R0603.png)
- Console: `[LOG] **** ERR StepFile : Undefined Parsing: Line 2: Incorrect syntax: unexpected TYPE, expecting STEP    ****`
- Network: `GET /components/ab68b38d…/detail → footprint.model=null, modelStatus=null, modelConversion=null`
- Code: `src/modules/library/frontend/three-d/model-conversion.ts:69` — validateStepUploadFile checks only extension + size
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:496` — upload .catch sets modelConversionProgress('failed') AFTER store.reset()/onClose() at :536-539 -> leaks into the next wizard session
- Code: `src/modules/library/frontend/import-wizard/steps/ModelStep.tsx:85` — (size/1024/1024).toFixed(2) MB
- Suggested fix: Sniff the first bytes for 'ISO-10303-21' in validateStepUploadFile; route conversion progress/failure into the Library NoticeViewport after the wizard closes and persist a failed status the detail 3D card renders; format sizes with B/KB/MB.
- Verification (vq7): **confirmed** — Reproduced: garbage.step (59 B) selected -> 'Size 0.00 MB' + green 'This model will be converted…' box; Import succeeded, wizard closed with no notice; console '**** ERR StepFile : Undefined Parsing: Line 2 …'; detail API for QA-q7-vq7-drawn has no model/modelStatus fields at all. Opening New part again (dark and light) shows the stale footer 'OCCT could not read the STEP file' on Metadata before anything was selected. minimal.step (light, QA-q7-vq7-light-QFN16) likewise ended with no model and the same stale footer. · evidence: [024-model-garbage-step](../evidence/shots/vq7/dark/024-model-garbage-step.png), [029-next-session-stale-occt](../evidence/shots/vq7/dark/029-next-session-stale-occt.png), [009-model-selected](../evidence/shots/vq7/light/009-model-selected.png), console: [LOG] **** ERR StepFile : Undefined Parsing: Line 2: Incorrect syntax: unexpected TYPE, expecting STEP

</details>


## T-296

**Pin/pad mismatch is a soft warning in the wizard but a hard 400 on Import; no pin↔pad mapping UI; error names internal 'U'/'FP'**

- Severity **S2** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner L2 · wave W3 · scope frontend · estimate M
- Findings: Q7-017

**Summary.** POST /imports/drawn → 400 'Symbol "U" has pin numbers not present in footprint "FP": [3, 4]. Available pad numbers: [1, 2].' shown in a red bottom strip. The warning promised the import would go through. After fixing the footprint and returning to Metadata, the stale red error is still shown until the next Import. The metadata step also shows '2 parser warnings / 2 footprint' left over from footprints imported earli…

**Root cause.** `src/modules/library/frontend/import-wizard/steps/MetadataStep.tsx:201` — count-only 'Pin/pad count mismatch' warning

**Proposed fix.** Client-side pin↔pad check blocks Next with list of mismatches; readable error names (mapping UI = proposal P6). — Detail: Compute missing pin numbers vs pad numbers client-side (same rule as backend) and block Next on the Footprints step with a clear list + a pin-map table; clear commitError in goToStep; only show inspect warnings for the active footprintSource; use componentName/footprintName in backend messages.

**Evidence.** [082-after-import](../evidence/shots/q7/dark/082-after-import.png), [025-metadata](../evidence/shots/vq7/dark/025-metadata.png)

<details><summary>Q7-017 — Pin/pad mismatch is a soft warning in the wizard but a hard 400 on Import; no pin↔pad mapping UI; error names internal 'U'/'FP' (S2, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Draw symbol with pins 1,3,4; draw footprint with pads 1,2
  2. Metadata shows amber 'Pin/pad count mismatch: 3 pins vs 2 pads. Auto-mapping by number may leave some unconnected.'
  3. Click Import component
- Expected: Mismatch detected by number (not count) at the Footprints step, blocking with a pin-map editor; the message names the user's symbol/footprint.
- Actual: POST /imports/drawn → 400 'Symbol "U" has pin numbers not present in footprint "FP": [3, 4]. Available pad numbers: [1, 2].' shown in a red bottom strip. The warning promised the import would go through. After fixing the footprint and returning to Metadata, the stale red error is still shown until the next Import. The metadata step also shows '2 parser warnings / 2 footprint' left over from footprints imported earlier but no longer used (source switched to Draw).
- Screenshots: [082-after-import](../evidence/shots/q7/dark/082-after-import.png), [083-metadata-stale-error](../evidence/shots/q7/dark/083-metadata-stale-error.png), [080-metadata](../evidence/shots/q7/dark/080-metadata.png)
- Network: `POST /api/modules/library/imports/drawn → 400 (validation)`
- Code: `src/modules/library/frontend/import-wizard/steps/MetadataStep.tsx:201` — count-only 'Pin/pad count mismatch' warning
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:750` — commitError rendered on Metadata; never cleared by goToStep/goNext (useImportWizardStore.ts:254-260)
- Suggested fix: Compute missing pin numbers vs pad numbers client-side (same rule as backend) and block Next on the Footprints step with a clear list + a pin-map table; clear commitError in goToStep; only show inspect warnings for the active footprintSource; use componentName/footprintName in backend messages.
- Verification (vq7): **confirmed** — Reproduced: pins 1,3,4,4 vs pads 1,2 -> amber 'Pin/pad count mismatch: 4 pins vs 2 pads. Auto-mapping by number may leave some unconnected.' then Import -> POST /imports/drawn 400 'Symbol "U" has pin numbers not present in footprint "FP": [3, 4, 4]. Available pad numbers: [1, 2].' After adding pads 3,4 and returning to Metadata the red error was still shown. · evidence: [025-metadata](../evidence/shots/vq7/dark/025-metadata.png), [026-import-400](../evidence/shots/vq7/dark/026-import-400.png), [027-metadata-stale-error](../evidence/shots/vq7/dark/027-metadata-stale-error.png), POST /api/modules/library/imports/drawn -> 400

</details>


## T-297

**Keyboard-only part wizard: focus is never placed or moved on step change, controls are unnamed or invisibly focused, and Next/'Import component' sits before the step content (an accidental Space imports the part)**

- Severity **S3** · category a11y · status confirmed · themes dark
- Recommendation **fix-now** · owner L2 · wave W3 · scope frontend · estimate M
- Findings: F1C-010, F1C-011 · known ref K34

**Summary.** (1) After Enter on 'New part', activeElement is <body>. (2) Each step change that unmounts the focused control drops focus to <body> (Preset → step, Generate, Next on step 2→3). After the successful Import, focus is <body> as well. (3) Unnamed controls: the header back/close arrow (a <button> with no text or aria-label, the first tab stop), the Symbol <select> ('R (2 pins)', no label), and the Symbol file <input> (n… | Also covers: F1C-011: Next morphs into 'Import component' under the keyboard focus, and Shift+Tab from the firs…

**Root cause.** `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:665` — icon-only back/close button without aria-label

**Proposed fix.** Focus step heading/first field on step change; actions after content in DOM; name controls; visible focus. — Detail: In ImportWizardPage: add aria-label='Close wizard' to the arrow button. On mount and on every currentStep change, focus the step's <h2> (tabIndex=-1). After a successful commit, focus the new row in the Library (pass the id through onImported). Label the Symbol <select> ('Symbol in file'). For the sr-only file inputs, add focus-visible:ring styling to the visible label via peer-focus-visible. Convert family/size/density to role=radiogroup with roving tabindex. Add a footer or sticky bar with Back/Next after the st…

**Evidence.** [026-kbd-wizard-open](../evidence/shots/f1c/dark/026-kbd-wizard-open.png), [008-wizard-shift-tab-lands-on-import](../evidence/shots/vf1c/light/008-wizard-shift-tab-lands-on-import.png), [034-library-after-accidental-import](../evidence/shots/f1c/dark/034-library-after-accidental-import.png)

<details><summary>F1C-010 — Keyboard-only part wizard: focus is never placed or moved on step change, controls are unnamed or invisibly focused, and Next/'Import component' sits before the step content (an accidental Space imports the part) (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B, Library. Tab to 'New part' (4 Tabs from the search box) → Enter
  2. Walk Symbol → Footprints → 3D Model → Metadata → Import using only Tab/Shift+Tab/Space/Enter/Esc. A focusin logger records the tag, name and computed outline for each stop (f1c/focus.js, f1c/tabto.sh)
- Expected: Opening the wizard moves focus to its heading or first control. Each step change moves focus to the new step's heading. Every control has an accessible name and a visible focus indicator. Single-choice groups (family/size/density) are one tab stop with arrow keys. After Import, focus lands on the new part.
- Actual: (1) After Enter on 'New part', activeElement is <body>. (2) Each step change that unmounts the focused control drops focus to <body> (Preset → step, Generate, Next on step 2→3). After the successful Import, focus is <body> as well. (3) Unnamed controls: the header back/close arrow (a <button> with no text or aria-label, the first tab stop), the Symbol <select> ('R (2 pins)', no label), and the Symbol file <input> (no name). (4) Invisible focus: the 3D step's 'Select STEP model' is an sr-only <input type=file> (1×1 px at 396,139) whose focus shows no ring on the visible label. The Remove-tag × buttons only light the whole tag box (focus-within), so you can't tell which chip's × is focused. (5) Family (5), Size (8) and Density (3) are 16 separate tab stops with only aria-pressed and no radio-group semantics. (6) Next/Import sits before the step content in DOM order. From the Generate button it took 25 Shift+Tabs to reach Next, and from the tag input 27 Shift+Tabs to reach 'Import component'. (7) Esc in the tag input doesn't close its suggestion list, which stays open over the page. Tab order otherwise escapes into the app rail (the wizard is not modal), and there are no traps. (Merged F1C-011) When the last step is reached with Next, focus stays on the same header button, which is now labelled 'Import component'. Because that button precedes the Metadata form in DOM order, Shift+Tab from 'Component name' lands on it. f1c's keyboard walk imported an unnamed part 'R' (ea9ed02d) this way, with one stray Space and no confirmation.
- Screenshots: [026-kbd-wizard-open](../evidence/shots/f1c/dark/026-kbd-wizard-open.png), [032-kbd-wizard-3d-step-file-focus](../evidence/shots/f1c/dark/032-kbd-wizard-3d-step-file-focus.png), [033-kbd-metadata-remove-tag-focus](../evidence/shots/f1c/dark/033-kbd-metadata-remove-tag-focus.png), [035-wizard-metadata-longtext](../evidence/shots/f1c/dark/035-wizard-metadata-longtext.png), [034-library-after-accidental-import](../evidence/shots/f1c/dark/034-library-after-accidental-import.png), [036-kbd-import-component-focus](../evidence/shots/f1c/dark/036-kbd-import-component-focus.png)
- Console: `focus log step1: BUTTON '' → '1. Symbol' → 'Import file' → 'Draw symbol' → INPUT/file '' → 'Grid' → rail Home…`; `after Enter on New part / Import: activeElement=BODY`; `tabto Next from Generate: 25 Shift+Tab; tabto 'Import component' from tag input: 27 Shift+Tab`
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:665` — icon-only back/close button without aria-label
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:691` — Back/Next rendered in the header before step content
- Code: `src/modules/library/frontend/import-wizard/steps/SymbolStep.tsx:204` — file input without accessible name
- Code: `src/modules/library/frontend/import-wizard/steps/ModelStep.tsx:37` — sr-only STEP file input: focus invisible
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:698` — Next button onClick=handleNext; label switches to 'Import component' (:705) on the last step → runCommit
- Suggested fix: In ImportWizardPage: add aria-label='Close wizard' to the arrow button. On mount and on every currentStep change, focus the step's <h2> (tabIndex=-1). After a successful commit, focus the new row in the Library (pass the id through onImported). Label the Symbol <select> ('Symbol in file'). For the sr-only file inputs, add focus-visible:ring styling to the visible label via peer-focus-visible. Convert family/size/density to role=radiogroup with roving tabindex. Add a footer or sticky bar with Back/Next after the step content, or a skip link. In particular, on reaching the Metadata step focus and select the Component name input, and render 'Import component' as its own button after the form (footer), not by relabelling the header Next button. This also removes the accidental-commit path from F1C-011.
- Verification (vf1c): **confirmed** — Re-verified in vf1c-light and by code. After opening the wizard (New part), document.activeElement is BODY. The header back/close arrow is an unnamed <button> (snapshot 'button [ref]' with no name; ImportWizardPage.tsx:665 has no aria-label). The Symbol file <input type=file> has no accessible name (SymbolStep.tsx:204), and the Symbol <select> has no label (:228). The STEP input is sr-only and its visible <label> has no focus-visible styling (ModelStep.tsx:37-56). FootprintPresetPicker uses aria-pressed buttons with no radiogroup (:72, :142). There is no .focus()/autoFocus anywhere in ImportWizardPage or the steps. TagTokenInput's Esc only clears a non-empty draft. For merged F1C-011: after clicking Next x3, the snapshot shows 'Import component' [active], and Shift+Tab from 'Component name' focused BUTTON 'Import component' (UA outline #005fcc, Q11-003). F1C-011 has the same root cause (no focus management on step change, and the commit button placed in the header ahead of the content), so it is merged here. Related but separate: Q7-032 (editor focus drops), Q11-002/Q11-003 (focus styles). S3 kept. · evidence: [008-wizard-shift-tab-lands-on-import](../evidence/shots/vf1c/light/008-wizard-shift-tab-lands-on-import.png), activeElement after opening wizard: BODY, snapshot Metadata step: button 'Back', button 'Import component' [active] precede heading 'Metadata' and textbox 'Component name *'
- Merged duplicates: F1C-011

</details>

<details><summary>F1C-011 — Next morphs into 'Import component' under the keyboard focus, and Shift+Tab from the first field lands on it, so one stray Space imports an unnamed part (S3, duplicate)</summary>

- Area library.wizard · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B, part wizard. Import simple_resistor.kicad_sym, generate a 0603 Chip preset, then Space on Next twice to reach Metadata. Focus stays on the header button, which is now labelled 'Import component'.
  2. Tab once to 'Component name' (prefilled 'R'), then press Shift+Tab: focus returns to 'Import component'
  3. Type text containing a space (e.g. start typing the part name before noticing where the focus is)
- Expected: Advancing to the last step doesn't leave focus on a button whose meaning just changed. The commit action is not the immediate Shift+Tab neighbour of the first field, or it asks for confirmation when required fields still hold defaults.
- Actual: The first space character activated 'Import component' and immediately imported a part named 'R' with the auto tags. The wizard closed, and the rest of the typed text went into the Library search box. No confirmation or success notice was shown. It happened to me during the keyboard walk and produced part ea9ed02d ('R'), which I later renamed QA-f1c-R-accidental. The same holds for a double Space/Enter on Next at step 3.
- Screenshots: [034-library-after-accidental-import](../evidence/shots/f1c/dark/034-library-after-accidental-import.png), [036-kbd-import-component-focus](../evidence/shots/f1c/dark/036-kbd-import-component-focus.png)
- Console: `focus history: … TEXTAREA → INPUT 'e.g. C, R, LED' → BUTTON 'Import component' → INPUT 'Search name, MPN, package…'`; `GET /components?q=R → new part {id:'ea9ed02d-…', name:'R', tags:[chip,passive,smd,ipc-nominal,generated,ipc-7351b]}`
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:698` — Next button onClick=handleNext; label switches to 'Import component' (:705) on the last step → runCommit
- Suggested fix: On reaching the Metadata step, move focus to the Component name input and select it. Render 'Import component' as a separate button at the end of the Metadata form (after tags), not in place of Next. Briefly disable it (≈300 ms) after the step change to absorb double activations.
- Verification (vf1c): **duplicate** — Reproduced: after clicking Next x3, focus remains on the header button, now labelled 'Import component' (snapshot [active]). Shift+Tab from 'Component name' lands on 'Import component'. The accidental commit is real, but it has the same root cause as F1C-010: no focus management on step change, and Back/Next/Import rendered in the header before the step content (ImportWizardPage.tsx:686-708). F1C-010 lists both as items (2) and (6), and its fix (focus the step heading or first field on step change, move actions after the content) removes this path. Merged into F1C-010 (mergedIds). · evidence: [008-wizard-shift-tab-lands-on-import](../evidence/shots/vf1c/light/008-wizard-shift-tab-lands-on-import.png)

</details>


## T-298

**Grid never renders in any wizard/preview canvas: GridShader's uPixelsPerUnit uniform is stuck at 1 so every fragment is discarded; symbol-import Grid toggle is also dead**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **defer** · owner followup · wave followup · scope shared-package · estimate S
- Findings: Q7-002

**Summary.** No grid pixels anywhere (canvas histogram 100% #131313). Root cause found at runtime via the R3F root store: the grid ShaderMaterial's uPixelsPerUnit uniform = 1 while camera.zoom = 63.9 (after wheel: 90.3); mesh position/scale ARE updated each frame, so useFrame runs but writes into a different uniforms object than the one bound to the material (renderer-cached uniforms === material.uniforms, both still 1). With pp…

**Root cause.** `node_modules/@openpcb/r3f-eda-canvas/dist/primitives/GridShader.js:56` — default param color=[0.58,0.64,0.72] is a fresh array every render -> resolvedColor changes -> useMemo (line 59) builds a new uniforms object every render

**Proposed fix.** GridShader uPixelsPerUnit uniform update (wizard/preview grids never render). — Detail: In OpenPCB-app/shared r3f-eda-canvas GridShader: hoist the default color to a module constant and create the uniforms object once (useMemo with [] or useRef), updating .value fields in place each render/frame; add a unit test that material.uniforms.uPixelsPerUnit tracks camera.zoom. Re-pin the tag here. In SymbolStep.tsx:112 pass showGrid={symbolGridVisible}.

**Evidence.** [002-symbol-import-resistor](../evidence/shots/q7/dark/002-symbol-import-resistor.png), [001-symbol-import-resistor](../evidence/shots/vq7/dark/001-symbol-import-resistor.png)

<details><summary>Q7-002 — Grid never renders in any wizard/preview canvas: GridShader's uPixelsPerUnit uniform is stuck at 1 so every fragment is discarded; symbol-import Grid toggle is also dead (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Library → New part → Import file → simple_resistor.kicad_sym
  2. Observe canvas: Grid button shows active (bordered) but no grid dots/lines
  3. Click Grid twice; zoom out with wheel
- Expected: Grid visible when toggle on, hidden when off (as in the footprint step).
- Actual: No grid pixels anywhere (canvas histogram 100% #131313). Root cause found at runtime via the R3F root store: the grid ShaderMaterial's uPixelsPerUnit uniform = 1 while camera.zoom = 63.9 (after wheel: 90.3); mesh position/scale ARE updated each frame, so useFrame runs but writes into a different uniforms object than the one bound to the material (renderer-cached uniforms === material.uniforms, both still 1). With ppu=1 the fragment shader computes gridPx = 2 mm x 1 = 2 < uMinSpacingPx 4 and discards everything. Forcing material.uniforms.uPixelsPerUnit = camera.zoom + invalidate() makes the dot grid appear (shot 002). This runs on a real GPU (ANGLE Metal, Apple M4 Pro, WebGL2), so it is not a headless/SwiftShader artefact. Separately, SymbolStep passes showGrid literally so the import-mode Grid button only toggles its own style. Affects every GridShader user: symbol/footprint Draw editors, symbol/footprint import previews and PreviewCanvasShell (Library preview pane / detail page).
- Screenshots: [002-symbol-import-resistor](../evidence/shots/q7/dark/002-symbol-import-resistor.png), [003-symbol-import-grid-toggled](../evidence/shots/q7/dark/003-symbol-import-grid-toggled.png), [004-symbol-import-grid-zoomout](../evidence/shots/q7/dark/004-symbol-import-grid-zoomout.png), [010-draw-symbol-empty](../evidence/shots/q7/dark/010-draw-symbol-empty.png), [044-footprint-variant2](../evidence/shots/q7/dark/044-footprint-variant2.png)
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/primitives/GridShader.js:56` — default param color=[0.58,0.64,0.72] is a fresh array every render -> resolvedColor changes -> useMemo (line 59) builds a new uniforms object every render
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/primitives/GridShader.js:83` — useFrame writes uPixelsPerUnit into the latest uniforms object, not the one the ShaderMaterial/renderer holds
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/primitives/GridShader.js:27` — gridPx < uMinSpacingPx -> discard (ppu stays 1.0)
- Code: `src/modules/library/frontend/import-wizard/steps/SymbolStep.tsx:112` — showGrid hard-coded; symbolGridVisible (store) ignored
- Suggested fix: In OpenPCB-app/shared r3f-eda-canvas GridShader: hoist the default color to a module constant and create the uniforms object once (useMemo with [] or useRef), updating .value fields in place each render/frame; add a unit test that material.uniforms.uPixelsPerUnit tracks camera.zoom. Re-pin the tag here. In SymbolStep.tsx:112 pass showGrid={symbolGridVisible}.
- Verification (vq7): **confirmed** — Reproduced in dark and on a real GPU (WebGL renderer string 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)'), refuting the headless caveat. Inspected the live scene through @react-three/fiber _roots: grid mesh visible, renderOrder -2, but uPixelsPerUnit=1 vs zoom 63.9/90.3; forcing the uniform made the grid draw. Root cause is in the shared package GridShader, not the wizard. · evidence: [001-symbol-import-resistor](../evidence/shots/vq7/dark/001-symbol-import-resistor.png), [002-grid-forced-ppu](../evidence/shots/vq7/dark/002-grid-forced-ppu.png), eval: [{zoom:63.88, grid:{vis:true, u:{g:2, ppu:1, a:0.18, min:4}}}] -> after forcing ppu=zoom, 8 px of #2a2d31 grid dots appear in the 300x230 probe region

</details>


## T-299

**Invalid symbol file: error shown only in far-right panel while left/centre claim nothing was imported**

- Severity **S3** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner L3 · wave W3 · scope frontend · estimate S
- Findings: Q7-004

**Summary.** Right sidebar shows amber 'Not a valid KiCad symbol library file' (warning colour, not danger); left says 'Import a symbol file to inspect available symbols.' and canvas says 'No preview available for selected symbol.' — three contradictory messages; file name still shown twice (native input + duplicate chip).

**Root cause.** `src/modules/library/frontend/import-wizard/steps/SymbolStep.tsx:257` — inspectError rendered in right sidebar amber box

**Proposed fix.** Show inspect error under the file input; left/centre reflect failure. — Detail: Render inspectError under the file input in ImportModeSidebar with status-danger tokens; set the canvas emptyMessage to the error when inspectStatus==='error'; drop the duplicate filename chip.

**Evidence.** [007-symbol-import-garbage](../evidence/shots/q7/dark/007-symbol-import-garbage.png), [004-symbol-import-garbage](../evidence/shots/vq7/dark/004-symbol-import-garbage.png)

<details><summary>Q7-004 — Invalid symbol file: error shown only in far-right panel while left/centre claim nothing was imported (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Library → New part → Import file → choose a non-KiCad file (garbage.step)
- Expected: Inline error next to the file input (danger styling), e.g. 'garbage.step is not a KiCad symbol library (.kicad_sym)'; centre empty state consistent.
- Actual: Right sidebar shows amber 'Not a valid KiCad symbol library file' (warning colour, not danger); left says 'Import a symbol file to inspect available symbols.' and canvas says 'No preview available for selected symbol.' — three contradictory messages; file name still shown twice (native input + duplicate chip).
- Screenshots: [007-symbol-import-garbage](../evidence/shots/q7/dark/007-symbol-import-garbage.png)
- Code: `src/modules/library/frontend/import-wizard/steps/SymbolStep.tsx:257` — inspectError rendered in right sidebar amber box
- Suggested fix: Render inspectError under the file input in ImportModeSidebar with status-danger tokens; set the canvas emptyMessage to the error when inspectStatus==='error'; drop the duplicate filename chip.
- Verification (vq7): **confirmed** — Reproduced with garbage.step: right sidebar amber box 'Not a valid KiCad symbol library file' (dark bg #461901, amber not danger), left 'Import a symbol file to inspect available symbols.', canvas 'No preview available for selected symbol.', file name shown twice (native input + chip). Note the input has accept='.kicad_sym' so the OS picker filters by default, but a malformed .kicad_sym takes the same path. SymbolStep.tsx:257 renders inspectError in the right sidebar only. · evidence: [004-symbol-import-garbage](../evidence/shots/vq7/dark/004-symbol-import-garbage.png)

</details>


## T-300

**Part wizard and both editors are an unmigrated surface: raw slate/violet/emerald/amber/pink palette, native file inputs/selects/checkboxes, floating blurred toolbar unlike designer toolbars**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L2+L3+L4b · wave W3 · scope frontend · estimate L
- Findings: Q7-023 · known ref K45

**Summary.** Editor toolbars are floating pills with border+shadow-sm+backdrop-blur and 28×28 buttons, active state via violet (remapped grey) border, no aria-pressed/focus-visible (focus ring is the browser default #99c8ff). Progress bar 'done' = raw emerald-500 #00bc7d (ΔE 17 from --status-success); 'current' #3a3a40 barely differs from pending #1c1c1f in dark. Tool 'hint' rings/dots raw emerald. Warning boxes raw amber (#4619…

**Root cause.** `src/modules/library/frontend/import-wizard/editor/EditorToolbar.tsx:102` — rounded-lg border shadow-sm backdrop-blur pill; h-7 w-7 buttons

**Proposed fix.** Wizard + editors to tokens/kit (no pink/violet/emerald, kit file input/selects/checkboxes, flat toolbar). — Detail: Migrate import-wizard/* to src/shared/frontend/ui (Toolbar/ToolbarButton pressable, SegmentedControl for source toggles, Checkbox, kit Select, Button primary for Next/Import, status tokens for warnings/progress); dock the editor toolbar like the designer's instead of a floating pill; aria-label='Close wizard' on the back arrow.

**Evidence.** [040-footprint-step](../evidence/shots/q7/dark/040-footprint-step.png), [025-metadata](../evidence/shots/vq7/dark/025-metadata.png)

<details><summary>Q7-023 — Part wizard and both editors are an unmigrated surface: raw slate/violet/emerald/amber/pink palette, native file inputs/selects/checkboxes, floating blurred toolbar unlike designer toolbars (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Open Library → New part and walk all 4 steps in dark and light
- Expected: Kit components and tokens (Toolbar 30px docked, ToolbarButton 24px with aria-pressed + focus-visible outline, Checkbox, Select, status tokens, --selection) as in the designer.
- Actual: Editor toolbars are floating pills with border+shadow-sm+backdrop-blur and 28×28 buttons, active state via violet (remapped grey) border, no aria-pressed/focus-visible (focus ring is the browser default #99c8ff). Progress bar 'done' = raw emerald-500 #00bc7d (ΔE 17 from --status-success); 'current' #3a3a40 barely differs from pending #1c1c1f in dark. Tool 'hint' rings/dots raw emerald. Warning boxes raw amber (#461901 dark bg ΔE 23.9 from --status-warning-soft; #fffbeb light), 3D 'will be converted' box raw emerald-50 #ecfdf5, card shadows on 3D/Metadata cards (light: #e1e1e2→#f6f6f7 gradient under the card). Native <input type=file> 'Choose File', native selects (Pin Type/Rotation, Pad Shape/Layer, 15px toolbar layer select), 9 native checkboxes in Layers (#4098ff/#99c8ff default accent, unlabelled). Canvas bg hard-coded #131313 (token --surface-canvas-well #08090a). Back arrow button has no accessible name.
- Screenshots: [040-footprint-step](../evidence/shots/q7/dark/040-footprint-step.png), [050-footprint-draw-empty](../evidence/shots/q7/dark/050-footprint-draw-empty.png), [020-footprint-draw](../evidence/shots/q7/light/020-footprint-draw.png), [031-model-selected](../evidence/shots/q7/light/031-model-selected.png), [006-symbol-import-unsupported](../evidence/shots/q7/dark/006-symbol-import-unsupported.png), [060-layers-fcu-hidden](../evidence/shots/q7/light/060-layers-fcu-hidden.png)
- Pixel probes: {"file": "shots/q7/dark/040-footprint-step.png", "x": 380, "y": 21, "hex": "#00bc7d", "nearestToken": "--status-success", "deltaE": 17.3}; {"file": "shots/q7/dark/006-symbol-import-unsupported.png", "x": 1165, "y": 75, "hex": "#461901", "nearestToken": "--status-warning-soft@app", "deltaE": 23.9}; {"file": "shots/q7/light/020-footprint-draw.png", "x": 119, "y": 357, "hex": "#4098ff", "nearestToken": "--status-info", "deltaE": 31.5}; {"file": "shots/q7/dark/016-pin-dup-number.png", "x": 285, "y": 291, "hex": "#99c8ff", "nearestToken": "--status-info", "deltaE": 12.2}
- Census: `census/q7-wizard-footprint-draw-light-1440.json`
- Code: `src/modules/library/frontend/import-wizard/editor/EditorToolbar.tsx:102` — rounded-lg border shadow-sm backdrop-blur pill; h-7 w-7 buttons
- Code: `src/modules/library/frontend/import-wizard/WizardProgressBar.tsx:31` — bg-emerald-500 / bg-violet-600
- Code: `src/modules/library/frontend/import-wizard/footprint-editor/LayerPanel.tsx:1` — native checkboxes
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:662` — icon-only back button without aria-label
- Suggested fix: Migrate import-wizard/* to src/shared/frontend/ui (Toolbar/ToolbarButton pressable, SegmentedControl for source toggles, Checkbox, kit Select, Button primary for Next/Import, status tokens for warnings/progress); dock the editor toolbar like the designer's instead of a floating pill; aria-label='Close wizard' on the back arrow.
- Verification (vq7): **confirmed** — Re-probed: progress 'done' #00bc7d (dE 17.3 from --status-success, dark) / dE 28 light; amber warning bg #461901 (dE 23.9); light checkbox #4098ff (dE 31.5); 3D 'will be converted' box emerald-50 oklch(0.979 0.021 166); ModelStep sections carry shadow-sm; Next button shadow rgba(0,0,0,.1); 9 unlabelled native checkboxes + unnamed layer <select> in the snapshot; back-arrow button has no accessible name (census nameless=1). Note: PLAN §0 scoped the import wizard to 'token re-skin only' and §9/Run-2 follow-ups list its raw amber/red/emerald pass as outstanding, so this is a known documented gap, not a regression - still valid for release readiness; S3 kept. · evidence: [025-metadata](../evidence/shots/vq7/dark/025-metadata.png), [022-footprint-2pads](../evidence/shots/vq7/dark/022-footprint-2pads.png), [007-footprint-draw](../evidence/shots/vq7/light/007-footprint-draw.png), [009-model-selected](../evidence/shots/vq7/light/009-model-selected.png), census/vq7-wizard-symbol-draw-dark-1440.json

</details>


## T-301

**Wizard pin/pad panels: 9px labels (2.1–2.3:1 in light) and 15–36px inputs; pin Type select truncated**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L3+L4b · wave W3 · scope frontend · estimate S
- Findings: Q7-024, Q7-025 · known ref K36,K37

**Summary.** Census: 10 × 9px labels in the Pins panel (#, Name, Type, Rotation, Length), 14 × 9px in the Pads panel (#, Shape, W (mm), H (mm), Rot, Layer, Drill (mm)). Light theme contrast of these labels on white: 2.11 ('TYPE'), 2.29 ('NAME'); shortcut list text 3.48. 'Next pin defaults' uses 10px. Canvas dimension labels ~5px at default zoom. | Also covers: Q7-025: Wizard input heights are 15/24/28/32/36 px (kit standard 22px); pin 'Type' select truncat…

**Root cause.** `src/modules/library/frontend/import-wizard/editor/PinPropertyPanel.tsx:96` — text-[9px] uppercase text-slate-400

**Proposed fix.** Pin/pad property panels: ≥10px labels (token contrast), kit 22px inputs/selects with min widths. — Detail: Use the kit PropertyGrid / label style (text-2xs ≥10px, --text-caps colour) in PinPropertyPanel and PadPropertyPanel.

**Evidence.** [010-symbol-draw](../evidence/shots/q7/light/010-symbol-draw.png), [006-symbol-draw](../evidence/shots/vq7/light/006-symbol-draw.png), [015-draw-rect-2pins](../evidence/shots/q7/dark/015-draw-rect-2pins.png)

<details><summary>Q7-024 — Wizard property panels use 9px uppercase labels (pin and pad rows) — 2.1–2.3:1 contrast in light (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Draw symbol → place 2 pins (Pins panel)
  2. Footprints → Draw → place 2 pads (Pads panel)
  3. Run DOM census
- Expected: ≥10px text (kit 10–11px caps labels) with ≥4.5:1 contrast.
- Actual: Census: 10 × 9px labels in the Pins panel (#, Name, Type, Rotation, Length), 14 × 9px in the Pads panel (#, Shape, W (mm), H (mm), Rot, Layer, Drill (mm)). Light theme contrast of these labels on white: 2.11 ('TYPE'), 2.29 ('NAME'); shortcut list text 3.48. 'Next pin defaults' uses 10px. Canvas dimension labels ~5px at default zoom.
- Screenshots: [010-symbol-draw](../evidence/shots/q7/light/010-symbol-draw.png), [020-footprint-draw](../evidence/shots/q7/light/020-footprint-draw.png)
- Census: `census/q7-wizard-symbol-draw-light-1440.json`
- Code: `src/modules/library/frontend/import-wizard/editor/PinPropertyPanel.tsx:96` — text-[9px] uppercase text-slate-400
- Code: `src/modules/library/frontend/import-wizard/footprint-editor/PadPropertyPanel.tsx:1` — text-[9px] labels
- Suggested fix: Use the kit PropertyGrid / label style (text-2xs ≥10px, --text-caps colour) in PinPropertyPanel and PadPropertyPanel.
- Verification (vq7): **confirmed** — Census: 20 x 9px labels for 4 pins (#, Name, Type, Rotation, Length). Light: label colour rgb(168,168,173) on #f7f7f8 = 2.21:1 (2.37:1 on white). · evidence: census/vq7-wizard-symbol-draw-dark-1440.json, [006-symbol-draw](../evidence/shots/vq7/light/006-symbol-draw.png)

</details>

<details><summary>Q7-025 — Wizard input heights are 15/24/28/32/36 px (kit standard 22px); pin 'Type' select truncated to 'Pa' (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Draw symbol → place a pin; Footprints → Draw; Metadata
  2. DOM census
- Expected: Controls 22px (sm 20px), selects wide enough to show their value.
- Actual: Census heights: input 32 (Reference prefix, Footprint name, Component name), input/select 24 (pin/pad rows), select 28 (Next pin defaults), select 15 (toolbar layer), symbol select 36 (h-9), tag input 15. The pin row Type select is 43px wide and shows only 'Pa' for 'Passive' at the default 264px sidebar. Header Next/Import buttons 32px and 'Import component' wraps onto two lines inside the fixed w-44 action area.
- Screenshots: [015-draw-rect-2pins](../evidence/shots/q7/dark/015-draw-rect-2pins.png), [080-metadata](../evidence/shots/q7/dark/080-metadata.png)
- Census: `census/q7-wizard-symbol-draw-dark-1440.json`
- Code: `src/modules/library/frontend/import-wizard/editor/PinPropertyPanel.tsx:150` — Type select flex-1 next to fixed 72px rotation + length
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:685` — w-44 action area, h-8 buttons
- Suggested fix: Use kit Input/Select (h-[22px]) everywhere in import-wizard; give pin rows a 2-column property grid so Type gets full width; let the header action area size to content (drop w-44) and keep 'Import' label single-line.
- Verification (vq7): **confirmed** — Census (symbol draw): input:32 x1, input:24 x12, select:24 x8, none at 22px; pin Type select shows 'Pa'; Metadata header 'Import component' wraps onto two lines in the w-44 action area. · evidence: census/vq7-wizard-symbol-draw-dark-1440.json, [012-pin-dup-after-delete](../evidence/shots/vq7/dark/012-pin-dup-after-delete.png), [025-metadata](../evidence/shots/vq7/dark/025-metadata.png)

</details>


## T-302

**Editors don't fit at 1100×720 (and footprint toolbar already overflows at 1440): floating toolbar covers the right panel**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L2 · wave W3 · scope frontend · estimate S
- Findings: Q7-026

**Summary.** Symbol draw: canvas 350–800 px but toolbar spans 360–860, covering the 'Drawing Summary' heading ('ing Summary'). Footprint draw: canvas ~350 px wide (two 330 px sidebars), toolbar 425–1040 covers the 'PADS (2)' header and first row of the Pads panel. At 1440 the footprint toolbar already ends at x=1128 past the canvas edge (1105) into the right sidebar. The canvas at 350 px is barely usable.

**Root cause.** `src/modules/library/frontend/import-wizard/layout/CanvasStepLayout.tsx:103` — topContent absolutely positioned max-w-[520px] but toolbar content wider; sidebars fixed 264/296 and 330/330 defaults

**Proposed fix.** CanvasStepLayout: toolbar in its own row, panel widths clamp at 1100×720. — Detail: Dock the toolbar in-flow at the top of the canvas column with overflow-x hidden + overflow menu (or wrap), and make the side panels collapsible / narrower below 1280px.

**Evidence.** [101-1100-symbol-draw](../evidence/shots/q7/dark/101-1100-symbol-draw.png), [017-1100-symbol-draw](../evidence/shots/vq7/dark/017-1100-symbol-draw.png)

<details><summary>Q7-026 — Editors don't fit at 1100×720 (and footprint toolbar already overflows at 1440): floating toolbar covers the right panel (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Resize to 1100×720 (Electron minimum)
  2. New part → Draw symbol; then Footprints → Draw
- Expected: Toolbar fits inside the canvas (wraps/overflow menu) or sidebars collapse; nothing overlaps panel content.
- Actual: Symbol draw: canvas 350–800 px but toolbar spans 360–860, covering the 'Drawing Summary' heading ('ing Summary'). Footprint draw: canvas ~350 px wide (two 330 px sidebars), toolbar 425–1040 covers the 'PADS (2)' header and first row of the Pads panel. At 1440 the footprint toolbar already ends at x=1128 past the canvas edge (1105) into the right sidebar. The canvas at 350 px is barely usable.
- Screenshots: [101-1100-symbol-draw](../evidence/shots/q7/dark/101-1100-symbol-draw.png), [102-1100-footprint-draw](../evidence/shots/q7/dark/102-1100-footprint-draw.png), [070-1100-footprint-draw](../evidence/shots/q7/light/070-1100-footprint-draw.png), [050-footprint-draw-empty](../evidence/shots/q7/dark/050-footprint-draw-empty.png)
- Code: `src/modules/library/frontend/import-wizard/layout/CanvasStepLayout.tsx:103` — topContent absolutely positioned max-w-[520px] but toolbar content wider; sidebars fixed 264/296 and 330/330 defaults
- Suggested fix: Dock the toolbar in-flow at the top of the canvas column with overflow-x hidden + overflow menu (or wrap), and make the side panels collapsible / narrower below 1280px.
- Verification (vq7): **confirmed** — Reproduced at 1100x720: symbol draw toolbar 360-860 px over a canvas 349-799, covering the 'Drawing Summary' heading; footprint draw toolbar 426-1042 over a 415-765 canvas, covering the 'PADS (2)' header. At 1440 the footprint toolbar still ends past the canvas (~1119 vs 1108). Severity lowered S2 -> S3: the covered area is headings/borders, the pad and pin inputs stay reachable - a layout defect, not a broken feature. · evidence: [017-1100-symbol-draw](../evidence/shots/vq7/dark/017-1100-symbol-draw.png), [037-1100-footprint-draw](../evidence/shots/vq7/dark/037-1100-footprint-draw.png), [022-footprint-2pads](../evidence/shots/vq7/dark/022-footprint-2pads.png)

</details>


## T-303

**Successful 'Import component' gives no feedback and doesn't reveal the new part (not even listed when the library has >60 parts)**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L2+L1 · wave W3 · scope frontend · estimate S
- Findings: Q7-027

**Summary.** Wizard just disappears; no notice (no role=status/alert), previous selection (74HC00) stays in the preview pane. With 70 parts the list shows '60 of 70' and the new 'QA-q7-light-QFN16-preset' is not among the 60 rows (only found via search) — users can think the import failed.

**Root cause.** `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:532` — onImported() only bumps refreshTick; onClose()

**Proposed fix.** After import: toast 'Imported X' + select/open the new part in Library. — Detail: Pass result.componentId to onImported; in LibrarySpace set a success notice via NoticeViewport and setSelectedComponentId/setDetailComponentId(newId); ensure the list query includes it (depends on K07 paging).

**Evidence.** [084-after-import-ok](../evidence/shots/q7/dark/084-after-import-ok.png), [028-after-import-ok](../evidence/shots/vq7/dark/028-after-import-ok.png)

<details><summary>Q7-027 — Successful 'Import component' gives no feedback and doesn't reveal the new part (not even listed when the library has >60 parts) (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Complete the wizard → Import component
  2. Observe the Library list after the wizard closes (light run: library has 70 parts)
- Expected: Success notice ('QA-q7-… added to Local library' with Open), the new part selected in the list/preview or its detail page opened.
- Actual: Wizard just disappears; no notice (no role=status/alert), previous selection (74HC00) stays in the preview pane. With 70 parts the list shows '60 of 70' and the new 'QA-q7-light-QFN16-preset' is not among the 60 rows (only found via search) — users can think the import failed.
- Screenshots: [084-after-import-ok](../evidence/shots/q7/dark/084-after-import-ok.png), [050-after-import-list](../evidence/shots/q7/light/050-after-import-list.png), [051-search-q7](../evidence/shots/q7/light/051-search-q7.png)
- Console: `rows=60, contains QA-q7 = false; search 'QA-q7' → 3 rows`
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:532` — onImported() only bumps refreshTick; onClose()
- Code: `src/modules/library/frontend/Space.tsx:598` — onImported → setRefreshTick only
- Suggested fix: Pass result.componentId to onImported; in LibrarySpace set a success notice via NoticeViewport and setSelectedComponentId/setDetailComponentId(newId); ensure the list query includes it (depends on K07 paging).
- Verification (vq7): **confirmed** — Reproduced: after 'Import component' the wizard closes with no [role=status]/[role=alert] notice; library header '67 parts', list '60 of 67' with 60 rows and the new QA-q7-vq7-drawn not among them (K07 limit=60 makes it invisible). Space.tsx:600 onImported only bumps refreshTick. · evidence: [028-after-import-ok](../evidence/shots/vq7/dark/028-after-import-ok.png), eval: '67 parts · 3 sources | rows=60 | hasNew=false | 60 of 67'

</details>


## T-304

**Metadata step lacks core part fields (value, MPN, manufacturer, datasheet); reference prefix only editable for drawn symbols**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **decide** · decision P6 · owner L2 · wave proposal · scope proposal · estimate M
- Findings: Q7-030

**Summary.** Only Component name, Description, Tags. Imported symbols can't change their reference prefix anywhere in the wizard (it's shown read-only in Symbol Details), and every wizard-created part lands with Family '—', MPN/manufacturer null (API) — it then shows as '—' in Library Family/Package columns and the BOM 'Missing MPN' filter.

**Root cause.** `src/modules/library/frontend/import-wizard/steps/MetadataStep.tsx:1` — name/description/tags only

**Proposed fix.** Metadata step: value, MPN, manufacturer, datasheet fields (needs backend fields). — Detail: Add Reference prefix (prefilled), Value, Manufacturer, MPN, Datasheet, Family select to MetadataStep and pass them through the three commit endpoints.

**Evidence.** [080-metadata](../evidence/shots/q7/dark/080-metadata.png), [025-metadata](../evidence/shots/vq7/dark/025-metadata.png)

<details><summary>Q7-030 — Metadata step lacks core part fields (value, MPN, manufacturer, datasheet); reference prefix only editable for drawn symbols (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Complete Symbol (Import file) → … → Metadata
- Expected: Metadata offers Reference prefix, Value, Manufacturer, MPN, Datasheet URL, Family/category (the Library facets and BOM rely on these), plus the tags.
- Actual: Only Component name, Description, Tags. Imported symbols can't change their reference prefix anywhere in the wizard (it's shown read-only in Symbol Details), and every wizard-created part lands with Family '—', MPN/manufacturer null (API) — it then shows as '—' in Library Family/Package columns and the BOM 'Missing MPN' filter.
- Screenshots: [080-metadata](../evidence/shots/q7/dark/080-metadata.png), [086-detail-new-part](../evidence/shots/q7/dark/086-detail-new-part.png)
- Network: `GET /components → QA-q7-drawn-garbage3d manufacturer=null, manufacturerPartNumber=null, subcategory=null`
- Code: `src/modules/library/frontend/import-wizard/steps/MetadataStep.tsx:1` — name/description/tags only
- Suggested fix: Add Reference prefix (prefilled), Value, Manufacturer, MPN, Datasheet, Family select to MetadataStep and pass them through the three commit endpoints.
- Verification (vq7): **confirmed** — Metadata step shows only Component name, Description, Tags; commit bodies pass only name/description/tags (ImportWizardPage.tsx:366-370); detail API of the new part: manufacturer/manufacturerPartNumber/subcategory/datasheetUrl all null. Feature gap rather than regression; S3 kept. · evidence: [025-metadata](../evidence/shots/vq7/dark/025-metadata.png), GET /components/4a1b93b7…/detail -> manufacturer=null, manufacturerPartNumber=null, subcategory=null, datasheetUrl=null

</details>


## T-305

**3D Model step has no 3D preview, placement or orientation controls — model is attached blind**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **decide** · decision P6 · owner L2 · wave proposal · scope proposal · estimate L
- Findings: Q7-035

**Summary.** Only File name + Size ('0.00 MB') and a green 'will be converted' note; conversion happens after import, so orientation/offset errors can't be seen until the detail page or the Designer 3D view.

**Root cause.** `src/modules/library/frontend/import-wizard/steps/ModelStep.tsx:1` — file picker only

**Proposed fix.** 3D Model step preview + placement/orientation controls. — Detail: Convert client-side on selection (occt-import-js worker already exists) and render a small R3F preview with the footprint outline plus offset/rotation inputs saved into the model metadata.

**Evidence.** [031-model-selected](../evidence/shots/q7/light/031-model-selected.png), [009-model-selected](../evidence/shots/vq7/light/009-model-selected.png)

<details><summary>Q7-035 — 3D Model step has no 3D preview, placement or orientation controls — model is attached blind (S3, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Wizard → 3D Model → Select STEP model → minimal.step
- Expected: Preview of the STEP body over the footprint with offset/rotation/scale (KiCad 3D model settings) before committing.
- Actual: Only File name + Size ('0.00 MB') and a green 'will be converted' note; conversion happens after import, so orientation/offset errors can't be seen until the detail page or the Designer 3D view.
- Screenshots: [031-model-selected](../evidence/shots/q7/light/031-model-selected.png), [070-model-step-empty](../evidence/shots/q7/dark/070-model-step-empty.png)
- Code: `src/modules/library/frontend/import-wizard/steps/ModelStep.tsx:1` — file picker only
- Suggested fix: Convert client-side on selection (occt-import-js worker already exists) and render a small R3F preview with the footprint outline plus offset/rotation inputs saved into the model metadata.
- Verification (vq7): **confirmed** — 3D step shows only File/Size ('0.00 MB') and the green 'will be converted' note; no preview, offset, rotation or scale controls (ModelStep.tsx). Conversion happens only after import, and failures are silent (Q7-016). Feature gap, S3 kept because a mis-oriented user STEP has no in-wizard correction path. · evidence: [009-model-selected](../evidence/shots/vq7/light/009-model-selected.png)

</details>


## T-306

**'Import component' wraps onto two lines inside the fixed 176 px wizard header action area**

- Severity **S4** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L2 · wave W3 · scope frontend · estimate XS
- Findings: F1C-012

**Summary.** The primary button reads 'Import / component' on two lines (112×32 px, line-height 15 px, 2 lines) because the container is w-44 (176 px) and also holds 'Back'. It looks broken next to the single-line 'Back', in both themes.

**Root cause.** `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:686` — <div className='flex w-44 shrink-0 …'> holds Back + Next/Import

**Proposed fix.** Header action area auto width (no 2-line 'Import component'). — Detail: Replace w-44 with w-auto (min-w-44) plus whitespace-nowrap on the buttons, or relabel the button 'Import'. Use the kit Button (22px) as part of the K45 migration.

**Evidence.** [035-wizard-metadata-longtext](../evidence/shots/f1c/dark/035-wizard-metadata-longtext.png), [009-wizard-header-import-wraps](../evidence/shots/vf1c/light/009-wizard-header-import-wraps.png)

<details><summary>F1C-012 — 'Import component' wraps onto two lines inside the fixed 176 px wizard header action area (S4, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library → New part → import any symbol → Next ×3 to Metadata
  2. Look at the top-right action buttons
- Expected: Single-line button labels at the kit control height, e.g. 22px 'Import' or a wider action area.
- Actual: The primary button reads 'Import / component' on two lines (112×32 px, line-height 15 px, 2 lines) because the container is w-44 (176 px) and also holds 'Back'. It looks broken next to the single-line 'Back', in both themes.
- Screenshots: [035-wizard-metadata-longtext](../evidence/shots/f1c/dark/035-wizard-metadata-longtext.png), [002-wizard-metadata-before-enter-on-back](../evidence/shots/f1c/light/002-wizard-metadata-before-enter-on-back.png)
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:686` — <div className='flex w-44 shrink-0 …'> holds Back + Next/Import
- Suggested fix: Replace w-44 with w-auto (min-w-44) plus whitespace-nowrap on the buttons, or relabel the button 'Import'. Use the kit Button (22px) as part of the K45 migration.
- Verification (vf1c): **confirmed** — Measured in vf1c-light at Metadata. The 'Import component' button is 112x32 px with line-height 15 px (2 lines), inside the 176 px w-44 action container, next to a single-line 'Back' (56x32). The cropped screenshot shows 'Import / component' on two lines. Code ImportWizardPage.tsx:686 'flex w-44 shrink-0'. The fixed h-8 hides the wrap as a height change, but the label still breaks. S4 kept. It will be subsumed if F1C-010's fix moves Import into a footer. · evidence: [009-wizard-header-import-wraps](../evidence/shots/vf1c/light/009-wizard-header-import-wraps.png), button rect 112x32, lineHeight 15px, parent width 176

</details>


## T-307

**Symbol import copy: '(1 pins)', literal '~' pin name, duplicate warnings for one construct**

- Severity **S4** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner L3 · wave W3 · scope frontend · estimate S
- Findings: Q7-005

**Summary.** 'WEIRD (1 pins)'; '~' drawn as pin name; 'Unknown graphic element …' and 'Unsupported symbol graphic … was skipped' both listed.

**Root cause.** `src/modules/library/frontend/import-wizard/steps/SymbolStep.tsx:222` — {symbol.pinCount} pins

**Proposed fix.** Pluralise '(1 pin)', render '~' pin names as overbar/blank, dedupe warnings. — Detail: Pluralise pin count in SymbolStep option label; treat '~' as empty name in the symbol render model (@openpcb/rendering-core); dedupe warnings by construct in @openpcb/kicad-import.

**Evidence.** [006-symbol-import-unsupported](../evidence/shots/q7/dark/006-symbol-import-unsupported.png), [005-symbol-import-unsupported](../evidence/shots/vq7/dark/005-symbol-import-unsupported.png)

<details><summary>Q7-005 — Symbol import copy: '(1 pins)', literal '~' pin name, duplicate warnings for one construct (S4, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Import unsupported_construct.kicad_sym → select shows 'WEIRD (1 pins)'; warnings panel lists 2 warnings for the same future_graphic_element
  2. Import multi_unit_opamp.kicad_sym → output pins labelled '~'
- Expected: '1 pin'; KiCad '~' (empty name) hidden; one warning per construct.
- Actual: 'WEIRD (1 pins)'; '~' drawn as pin name; 'Unknown graphic element …' and 'Unsupported symbol graphic … was skipped' both listed.
- Screenshots: [006-symbol-import-unsupported](../evidence/shots/q7/dark/006-symbol-import-unsupported.png), [005-symbol-import-opamp](../evidence/shots/q7/dark/005-symbol-import-opamp.png)
- Code: `src/modules/library/frontend/import-wizard/steps/SymbolStep.tsx:222` — {symbol.pinCount} pins
- Suggested fix: Pluralise pin count in SymbolStep option label; treat '~' as empty name in the symbol render model (@openpcb/rendering-core); dedupe warnings by construct in @openpcb/kicad-import.
- Verification (vq7): **confirmed** — Reproduced: unsupported_construct.kicad_sym -> option 'WEIRD (1 pins)' and two warnings for the same construct ('Unknown graphic element "future_graphic_element" in sub-symbol' + 'Unsupported symbol graphic ... was skipped'); multi_unit_opamp output pins draw a literal '~' name (fixture: (name "~") = KiCad empty name). · evidence: [005-symbol-import-unsupported](../evidence/shots/vq7/dark/005-symbol-import-unsupported.png), [003-symbol-import-opamp](../evidence/shots/vq7/dark/003-symbol-import-opamp.png)

</details>


## T-308

**Wizard steps are laid out inconsistently (section header styles, sidebar widths, which side holds the pin/pad list, toolbar off-centre)**

- Severity **S4** · category consistency · status confirmed · themes dark, light
- Recommendation **decide** · decision P6 · owner L2 · wave proposal · scope proposal · estimate S
- Findings: Q7-036

**Summary.** Symbol step sections use tracked caps ('IMPORT', 'PROPERTIES', 'PINS (2)'), Footprint Import/Preset use title-case h2 ('Import Footprints', 'Package Family', 'Size', 'Density Level') while Footprint Draw uses caps again; sidebars 264/296 px vs 330/330 px; pins list is in the LEFT sidebar, pads list in the RIGHT; in import mode the small Grid/Zoom toolbar sits left of centre (x 496–663 on a canvas centred at 745; 512…

**Root cause.** `src/modules/library/frontend/import-wizard/steps/FootprintStep.tsx:1` — CanvasStepLayout default widths 280/320 → 330

**Proposed fix.** Harmonise wizard step layouts (section headers, sidebar widths, list side). — Detail: Use PanelSectionHeader everywhere, one width pair for both steps, put the element list (pins/pads) on the same side, and centre the toolbar with flex justify-center.

**Evidence.** [015-draw-rect-2pins](../evidence/shots/q7/dark/015-draw-rect-2pins.png), [012-pin-dup-after-delete](../evidence/shots/vq7/dark/012-pin-dup-after-delete.png)

<details><summary>Q7-036 — Wizard steps are laid out inconsistently (section header styles, sidebar widths, which side holds the pin/pad list, toolbar off-centre) (S4, confirmed)</summary>

- Area library.wizard · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Walk Symbol (Import/Draw) and Footprints (Import/Preset/Draw) steps
- Expected: Same panel grammar on both canvas steps (kit PanelSectionHeader caps, same sidebar widths, element list on the same side, centred toolbar).
- Actual: Symbol step sections use tracked caps ('IMPORT', 'PROPERTIES', 'PINS (2)'), Footprint Import/Preset use title-case h2 ('Import Footprints', 'Package Family', 'Size', 'Density Level') while Footprint Draw uses caps again; sidebars 264/296 px vs 330/330 px; pins list is in the LEFT sidebar, pads list in the RIGHT; in import mode the small Grid/Zoom toolbar sits left of centre (x 496–663 on a canvas centred at 745; 512–700 vs 760). 'Zoom: scroll wheel' is the only navigation hint (no pan hint).
- Screenshots: [015-draw-rect-2pins](../evidence/shots/q7/dark/015-draw-rect-2pins.png), [051-footprint-2pads](../evidence/shots/q7/dark/051-footprint-2pads.png), [045-footprint-preset](../evidence/shots/q7/dark/045-footprint-preset.png), [040-footprint-step](../evidence/shots/q7/dark/040-footprint-step.png)
- Code: `src/modules/library/frontend/import-wizard/steps/FootprintStep.tsx:1` — CanvasStepLayout default widths 280/320 → 330
- Code: `src/modules/library/frontend/import-wizard/layout/CanvasStepLayout.tsx:103` — topContent w-full max-w-[520px] + inline-flex mx-auto → not centred
- Suggested fix: Use PanelSectionHeader everywhere, one width pair for both steps, put the element list (pins/pads) on the same side, and centre the toolbar with flex justify-center.
- Verification (vq7): **confirmed** — Screenshots confirm: symbol step caps section labels (IMPORT, PROPERTIES, PINS) vs footprint Import/Preset title-case h2 ('Import Footprints', 'Package Family', 'Size', 'Density Level'); left sidebar ~265 px (symbol) vs ~330 px (footprint); pins list in the left sidebar, pads list in the right; import-mode toolbar at x 496-663 on a canvas centred at ~742. S4. · evidence: [012-pin-dup-after-delete](../evidence/shots/vq7/dark/012-pin-dup-after-delete.png), [022-footprint-2pads](../evidence/shots/vq7/dark/022-footprint-2pads.png), [020-preset-stale](../evidence/shots/vq7/dark/020-preset-stale.png), [004-symbol-import-garbage](../evidence/shots/vq7/dark/004-symbol-import-garbage.png)

</details>

