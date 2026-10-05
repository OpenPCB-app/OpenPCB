# library.symbol-editor — QA findings

[← index](../README.md) · 7 triage entries · S1 0 · S2 3 · S3 3 · S4 1

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-309](#t-309) | S2 | Esc while drawing a shape also fires the wizard's Esc=close: closes the whole wizard (no confirm) or pops the discard confirm | Q7-006 | fix-now | L2+L3 / W3 | frontend | S |
| [T-310](#t-310) | S2 | Text tool unusable in both symbol and footprint editors: the inline input opens and is blurred/removed within the same click | Q7-008 | fix-now | L3 / W3 | frontend | S |
| [T-311](#t-311) | S2 | Pin tool auto-numbering reuses an existing number after a pin is deleted (duplicate pin numbers, no validation) | Q7-009 | fix-now | L3 / W3 | frontend | S |
| [T-312](#t-312) | S3 | Selection highlight in symbol/footprint editors is raw pink-400 and a selected pin is almost invisible | Q7-010 | fix-now | L3 / W3 | frontend | S |
| [T-313](#t-313) | S3 | Arc tool: 2nd click is an on-arc point (undocumented), preview is a straight polyline, some inputs commit a degenerate stub | Q7-011 | fix-now | L3 / W3 | frontend | M |
| [T-314](#t-314) | S3 | Pin tool gives no orientation preview (dot only); default 180° makes left-side pins inside-out | Q7-012 | fix-now | L3 / W3 | frontend | S |
| [T-315](#t-315) | S4 | Editor keyboard/a11y gaps: Ctrl+Y redo missing, toggles lack aria-pressed, focus dropped to <body> after Remove / field commit, Esc doesn't deselect | Q7-032 | fix-now | L3 / W3 | frontend | S |

## T-309

**Esc while drawing a shape also fires the wizard's Esc=close: closes the whole wizard (no confirm) or pops the discard confirm**

- Severity **S2** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner L2+L3 · wave W3 · scope frontend · estimate S
- Findings: Q7-006 · known ref K29

**Summary.** Fresh wizard (nothing committed yet): the whole wizard closes immediately and returns to the Library list — no confirm. With committed work (or a stale symbol file), the same Esc opens the 'Close the wizard? Unsaved changes will be lost.' native confirm (spy count 1→2); pressing Enter/OK loses the part. Both window keydown listeners (wizard useWindowKeyboardShortcuts + editor useToolDispatch) handle the same Esc. Sa…

**Root cause.** `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:640` — window Esc binding -> handleClose() with no defaultPrevented / editor-state check

**Proposed fix.** Editor tools consume Esc (stopPropagation) before wizard-level Esc; wizard Esc ignores events from canvas tools. — Detail: In ImportWizardPage's Esc binding return early when event.defaultPrevented (child editor listeners register first, so the rect/line/arc/pad tools' preventDefault already marks the event), and add Esc=clear-selection (with preventDefault) to both select tools; only then treat Esc as 'leave wizard' (with the in-app confirm from Q7-001).

**Evidence.** [013-rect-mid-draw-fresh](../evidence/shots/q7/dark/013-rect-mid-draw-fresh.png), [006-rect-mid-draw-fresh](../evidence/shots/vq7/dark/006-rect-mid-draw-fresh.png)

<details><summary>Q7-006 — Esc while drawing a shape also fires the wizard's Esc=close: closes the whole wizard (no confirm) or pops the discard confirm (S2, confirmed)</summary>

- Area library.symbol-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Library → New part → Draw symbol
  2. Press R, click once on the canvas, move the mouse (rubber-band rect visible)
  3. Press Esc
  4. Variant: draw something, select it with V, press Esc to deselect → discard-wizard confirm appears instead
- Expected: Esc cancels only the in-progress rectangle; wizard stays open. A second Esc (idle tool) may offer to leave.
- Actual: Fresh wizard (nothing committed yet): the whole wizard closes immediately and returns to the Library list — no confirm. With committed work (or a stale symbol file), the same Esc opens the 'Close the wizard? Unsaved changes will be lost.' native confirm (spy count 1→2); pressing Enter/OK loses the part. Both window keydown listeners (wizard useWindowKeyboardShortcuts + editor useToolDispatch) handle the same Esc. Same with an idle Select tool and a selection: Esc does not clear the selection (select-tool has no Esc handling) — it only opens the wizard 'Close the wizard?' confirm (spy confirm 3→4).
- Screenshots: [013-rect-mid-draw-fresh](../evidence/shots/q7/dark/013-rect-mid-draw-fresh.png), [014-after-esc-mid-draw](../evidence/shots/q7/dark/014-after-esc-mid-draw.png), [012-rect-mid-draw](../evidence/shots/q7/dark/012-rect-mid-draw.png)
- Console: `after Esc: h1='Library' (wizard gone); __qaDialogCalls.confirm unchanged`
- Code: `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx:640` — window Esc binding -> handleClose() with no defaultPrevented / editor-state check
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/utils/keyboard-shortcuts.js:29` — useWindowKeyboardShortcuts runs every binding regardless of event.defaultPrevented
- Code: `src/modules/library/frontend/import-wizard/editor/tools/rect-tool.ts:76` — tool Esc already calls event.preventDefault() when cancelling a shape - the wizard just ignores it
- Code: `src/modules/library/frontend/import-wizard/editor/tools/select-tool.ts:381` — select tool has no Esc -> clear selection
- Suggested fix: In ImportWizardPage's Esc binding return early when event.defaultPrevented (child editor listeners register first, so the rect/line/arc/pad tools' preventDefault already marks the event), and add Esc=clear-selection (with preventDefault) to both select tools; only then treat Esc as 'leave wizard' (with the in-app confirm from Q7-001).
- Verification (vq7): **confirmed** — Reproduced both paths. Fresh wizard: Draw symbol, R, click, move (rubber-band visible), Esc -> h1 'Library', spy confirm count unchanged (wizard closed silently). With one committed rect: same Esc -> native 'Close the wizard?' confirm. With Select tool and the rect selected: Esc -> confirm again and the selection is still there after dismissing. rect-tool already preventDefaults Esc; the wizard binding just doesn't check it. · evidence: [006-rect-mid-draw-fresh](../evidence/shots/vq7/dark/006-rect-mid-draw-fresh.png), [008-rect-mid-draw-with-work](../evidence/shots/vq7/dark/008-rect-mid-draw-with-work.png), [010-select-after-esc](../evidence/shots/vq7/dark/010-select-after-esc.png), after fresh Esc: h1='Library', confirm count 2->2

</details>


## T-310

**Text tool unusable in both symbol and footprint editors: the inline input opens and is blurred/removed within the same click**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner L3 · wave W3 · scope frontend · estimate S
- Findings: Q7-008

**Summary.** MutationObserver log on click with T active: ['added Type text…', 'blur -> activeElement BODY', 'removed'] - the editor input mounts, loses focus to <body> from the same pointer event and onBlur commits the empty string, so it closes before any typing. Subsequent keystrokes go to the canvas shortcuts (typing 'Hello' switched tools). Same in the footprint editor (FootprintTextEditorOverlay): added -> blur -> removed.…

**Root cause.** `src/modules/library/frontend/import-wizard/editor/tools/text-tool.ts:26` — beginTextEdit on pointerdown without preventDefault

**Proposed fix.** Text tool: don't blur/remove inline input on the creating click (defer focus). — Detail: In text-tool onPointerDown call event.nativeEvent.preventDefault() (or open the editor on pointerup), and/or defer focus with requestAnimationFrame; ignore a blur that happens within the opening click. Same check for FootprintTextEditorOverlay.

**Evidence.** [025-text-editor](../evidence/shots/q7/dark/025-text-editor.png), [011-text-tool-click](../evidence/shots/vq7/dark/011-text-tool-click.png)

<details><summary>Q7-008 — Text tool unusable in both symbol and footprint editors: the inline input opens and is blurred/removed within the same click (S2, confirmed)</summary>

- Area library.symbol-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Library → New part → Draw symbol
  2. Press T (Text tool active in toolbar)
  3. Click anywhere on the canvas (mouse down + up)
- Expected: Floating 'Type text…' input appears at the click point with focus; Enter commits a text label.
- Actual: MutationObserver log on click with T active: ['added Type text…', 'blur -> activeElement BODY', 'removed'] - the editor input mounts, loses focus to <body> from the same pointer event and onBlur commits the empty string, so it closes before any typing. Subsequent keystrokes go to the canvas shortcuts (typing 'Hello' switched tools). Same in the footprint editor (FootprintTextEditorOverlay): added -> blur -> removed. No text label can be created in either editor.
- Screenshots: [025-text-editor](../evidence/shots/q7/dark/025-text-editor.png)
- Console: `window.__txtLog = [added, blur→BODY, removed] within 1 ms; activeElement after click = BODY`
- Code: `src/modules/library/frontend/import-wizard/editor/tools/text-tool.ts:26` — beginTextEdit on pointerdown without preventDefault
- Code: `src/modules/library/frontend/import-wizard/editor/TextEditorOverlay.tsx:36` — focus() in effect then onBlur={commit}
- Code: `src/modules/library/frontend/import-wizard/footprint-editor/tools/text-tool.ts:22` — same pattern in the footprint editor
- Suggested fix: In text-tool onPointerDown call event.nativeEvent.preventDefault() (or open the editor on pointerup), and/or defer focus with requestAnimationFrame; ignore a blur that happens within the opening click. Same check for FootprintTextEditorOverlay.
- Verification (vq7): **confirmed** — Reproduced in the symbol editor and additionally in the footprint editor (q7 had only suggested checking it). Graphics count stays unchanged after click + typing. · evidence: [011-text-tool-click](../evidence/shots/vq7/dark/011-text-tool-click.png), [035-fp-text-tool](../evidence/shots/vq7/dark/035-fp-text-tool.png), symbol: ["added Type text…","blur to null active=BODY","removed"], footprint: ["added Type text…","blur active=BODY","removed"]

</details>


## T-311

**Pin tool auto-numbering reuses an existing number after a pin is deleted (duplicate pin numbers, no validation)**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **fix-now** · owner L3 · wave W3 · scope frontend · estimate S
- Findings: Q7-009

**Summary.** Pins panel reads 1,3,4,4 — the new pin is numbered 4 again (counter = pins.length+1). Typing '1' into pin 2's # field is also accepted silently (two pin 1s, screenshot 016). Nothing warns and Next stays enabled; pin→pad mapping becomes ambiguous.

**Root cause.** `src/modules/library/frontend/import-wizard/editor/tools/pin-tool.ts:21` — pinCounter = state.pins.length + 1

**Proposed fix.** Pin auto-number = max+1; validate duplicate numbers. — Detail: Compute next pin number as max(parseInt(numbers))+1 at each placement (pasteInternal already has this helper — reuse it); validate uniqueness/non-empty in PinPropertyPanel (inline danger text) and gate canProceed on it in ImportWizardPage.

**Evidence.** [017-pin-dup-after-delete](../evidence/shots/q7/dark/017-pin-dup-after-delete.png), [012-pin-dup-after-delete](../evidence/shots/vq7/dark/012-pin-dup-after-delete.png)

<details><summary>Q7-009 — Pin tool auto-numbering reuses an existing number after a pin is deleted (duplicate pin numbers, no validation) (S2, confirmed)</summary>

- Area library.symbol-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Draw symbol → P, click 4 times (pins 1,2,3,4)
  2. Delete pin 2 (trash icon in Pins panel)
  3. Press V then P, click once on the canvas
- Expected: New pin gets next free number (5); duplicate/empty pin numbers are flagged and block Next/Import.
- Actual: Pins panel reads 1,3,4,4 — the new pin is numbered 4 again (counter = pins.length+1). Typing '1' into pin 2's # field is also accepted silently (two pin 1s, screenshot 016). Nothing warns and Next stays enabled; pin→pad mapping becomes ambiguous.
- Screenshots: [017-pin-dup-after-delete](../evidence/shots/q7/dark/017-pin-dup-after-delete.png), [016-pin-dup-number](../evidence/shots/q7/dark/016-pin-dup-number.png)
- Code: `src/modules/library/frontend/import-wizard/editor/tools/pin-tool.ts:21` — pinCounter = state.pins.length + 1
- Code: `src/modules/library/frontend/import-wizard/editor/PinPropertyPanel.tsx:101` — number onBlur commits without uniqueness check
- Suggested fix: Compute next pin number as max(parseInt(numbers))+1 at each placement (pasteInternal already has this helper — reuse it); validate uniqueness/non-empty in PinPropertyPanel (inline danger text) and gate canProceed on it in ImportWizardPage.
- Verification (vq7): **confirmed** — Reproduced: P x4 -> pins 1,2,3,4; delete pin 2; V then P, click -> Pins panel '1,3,4,4'. Committed a part with those pins (QA-q7-vq7-drawn, id 4a1b93b7): detail API stores pins [1,3,4,4] - duplicates are persisted, backend does not reject them either. pin-tool.ts:21 pinCounter = pins.length + 1 while useSymbolEditorStore.ts:624 already has a max+1 helper for paste. · evidence: [012-pin-dup-after-delete](../evidence/shots/vq7/dark/012-pin-dup-after-delete.png), GET /components/4a1b93b7…/detail -> symbol.preview.pins [(1,1),(3,3),(4,4),(4,4)]

</details>


## T-312

**Selection highlight in symbol/footprint editors is raw pink-400 and a selected pin is almost invisible**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner L3 · wave W3 · scope frontend · estimate S
- Findings: Q7-010

**Summary.** Only a ~0.3 mm diamond outline in #f472b6 around the pin dot, hidden under the dot (61 px of #bdb8d5 in a 160×45 crop vs 0 when unselected). Rect/circle selection uses the same off-token pink box. The only reliable cue is the grey border on the pin row in the sidebar.

**Root cause.** `src/modules/library/frontend/import-wizard/editor/SelectionOverlay.tsx:9` — SELECTION_COLOR = '#f472b6' // pink-400; pin = small diamond

**Proposed fix.** Selection overlay uses --selection token; selected pin clearly highlighted. — Detail: Use the canvas selection token from @openpcb/r3f-eda-canvas theme (same as schematic) and draw pins' full segment + dot in the highlight colour (thicker line) instead of a diamond.

**Evidence.** [018-pin4-selected](../evidence/shots/q7/dark/018-pin4-selected.png), [010-select-after-esc](../evidence/shots/vq7/dark/010-select-after-esc.png)

<details><summary>Q7-010 — Selection highlight in symbol/footprint editors is raw pink-400 and a selected pin is almost invisible (S3, confirmed)</summary>

- Area library.symbol-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Draw symbol with a pin
  2. Select tool V → click the pin's connection dot
- Expected: Selected pin clearly highlighted (whole pin line + dot) in the token selection colour (--selection), like the designer canvases.
- Actual: Only a ~0.3 mm diamond outline in #f472b6 around the pin dot, hidden under the dot (61 px of #bdb8d5 in a 160×45 crop vs 0 when unselected). Rect/circle selection uses the same off-token pink box. The only reliable cue is the grey border on the pin row in the sidebar.
- Screenshots: [018-pin4-selected](../evidence/shots/q7/dark/018-pin4-selected.png), [022-duplicate](../evidence/shots/q7/dark/022-duplicate.png), [031-drag-guides](../evidence/shots/q7/dark/031-drag-guides.png)
- Code: `src/modules/library/frontend/import-wizard/editor/SelectionOverlay.tsx:9` — SELECTION_COLOR = '#f472b6' // pink-400; pin = small diamond
- Code: `src/modules/library/frontend/import-wizard/footprint-editor/FootprintSelectionOverlay.tsx:9` — same
- Suggested fix: Use the canvas selection token from @openpcb/r3f-eda-canvas theme (same as schematic) and draw pins' full segment + dot in the highlight colour (thicker line) instead of a diamond.
- Verification (vq7): **confirmed** — Reproduced: selected rect outline is pink (1-px AA pixels #aa658c/#5f3c50 from #f472b6); selected pin shows only a tiny pink diamond hidden under the pin dot (10 pinkish px in a 280x60 crop). SELECTION_COLOR = '#f472b6' is defined in-repo (SelectionOverlay.tsx:9, FootprintSelectionOverlay.tsx:9), so this is not the package-owned canvas palette that PLAN §0 excludes. Overlaps the 'pink' item in Q7-023 but the near-invisible pin selection is a separate functional problem. · evidence: [010-select-after-esc](../evidence/shots/vq7/dark/010-select-after-esc.png), [013-pin-selected-crop](../evidence/shots/vq7/dark/013-pin-selected-crop.png)

</details>


## T-313

**Arc tool: 2nd click is an on-arc point (undocumented), preview is a straight polyline, some inputs commit a degenerate stub**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner L3 · wave W3 · scope frontend · estimate M
- Findings: Q7-011

**Summary.** Preview never shows a curve (chevron start–mid–cursor); the committed shape differs from what was previewed; a mid point outside the start–end span yields a major arc or a stub.

**Root cause.** `src/modules/library/frontend/import-wizard/editor/tools/arc-tool.ts:26` — start → mid → end; preview arc3 rendered as polyline by PreviewGraphicOverlay

**Proposed fix.** Arc tool: document 3-point flow in hint, true arc preview, reject degenerate arcs. — Detail: Render arc3 previews through the same arc tessellation as committed graphics (PreviewGraphicOverlay); switch interaction to start→end→bulge (derive mid from bulge) and show a hint strip ('Click start · click end · move to set bulge').

**Evidence.** [029-arc-start-end-bulge-preview](../evidence/shots/q7/dark/029-arc-start-end-bulge-preview.png), [015-016-arc-compare](../evidence/shots/vq7/dark/015-016-arc-compare.png)

<details><summary>Q7-011 — Arc tool: 2nd click is an on-arc point (undocumented), preview is a straight polyline, some inputs commit a degenerate stub (S3, confirmed)</summary>

- Area library.symbol-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Draw symbol → A
  2. Click start, click end, move to the bulge point: preview shows a two-segment polyline
  3. Click the bulge → a 270° major arc is committed (screenshots 029/030)
  4. Variant: start (600,700) → (700,700) → (650,660) commits a short straight stub (024/025)
- Expected: Arc preview shows the actual arc; interaction follows KiCad (centre→start→end) or start→end→bulge with a status hint.
- Actual: Preview never shows a curve (chevron start–mid–cursor); the committed shape differs from what was previewed; a mid point outside the start–end span yields a major arc or a stub.
- Screenshots: [029-arc-start-end-bulge-preview](../evidence/shots/q7/dark/029-arc-start-end-bulge-preview.png), [030-arc-start-end-bulge-committed](../evidence/shots/q7/dark/030-arc-start-end-bulge-committed.png), [027-arc3-preview](../evidence/shots/q7/dark/027-arc3-preview.png), [028-arc3-committed](../evidence/shots/q7/dark/028-arc3-committed.png), [025-text-editor](../evidence/shots/q7/dark/025-text-editor.png)
- Code: `src/modules/library/frontend/import-wizard/editor/tools/arc-tool.ts:26` — start → mid → end; preview arc3 rendered as polyline by PreviewGraphicOverlay
- Code: `src/modules/library/frontend/import-wizard/editor/PreviewGraphicOverlay.tsx:1` — arc3 preview
- Suggested fix: Render arc3 previews through the same arc tessellation as committed graphics (PreviewGraphicOverlay); switch interaction to start→end→bulge (derive mid from bulge) and show a hint strip ('Click start · click end · move to set bulge').
- Verification (vq7): **confirmed** — Reproduced: A, click (850,250), click (1000,250), move to (925,200): preview is a straight start->mid->cursor chevron; clicking commits a ~270 degree major arc because the 2nd click is treated as the on-arc MID point. PreviewGraphicOverlay.tsx:66-74 renders arc3 as a 2-segment polyline ('Approximate arc with line segments'). No hint explains the click order. · evidence: [015-016-arc-compare](../evidence/shots/vq7/dark/015-016-arc-compare.png), [015-arc-preview](../evidence/shots/vq7/dark/015-arc-preview.png), [016-arc-committed](../evidence/shots/vq7/dark/016-arc-committed.png)

</details>


## T-314

**Pin tool gives no orientation preview (dot only); default 180° makes left-side pins inside-out**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner L3 · wave W3 · scope frontend · estimate S
- Findings: Q7-012

**Summary.** Pin line extends outward from the click with connection dot on the body outline and the pin name drawn outside ('VIN' left of the pin, numbers inside the body) — screenshot 016. Pressing R while placing switches to the Rectangle tool instead of rotating the pin; the only way is the 'Next pin defaults' select in the right panel.

**Root cause.** `src/modules/library/frontend/import-wizard/editor/tools/pin-tool.ts:46` — preview = circle radius 0.2

**Proposed fix.** Pin ghost shows orientation; default orientation points outward from body side. — Detail: Preview the pin as a ghost PreviewGraphic line of pinDefaults.lengthMm/rotation; in the pin tool treat R as 'rotate next pin' (update pinDefaults.rotationDeg) before tool-switch shortcuts.

**Evidence.** [015-draw-rect-2pins](../evidence/shots/q7/dark/015-draw-rect-2pins.png), [012-pin-dup-after-delete](../evidence/shots/vq7/dark/012-pin-dup-after-delete.png)

<details><summary>Q7-012 — Pin tool gives no orientation preview (dot only); default 180° makes left-side pins inside-out (S3, confirmed)</summary>

- Area library.symbol-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Draw symbol → R → draw a body rectangle
  2. P → hover: only a small dot follows the cursor
  3. Click on the rectangle's left edge
- Expected: Ghost of the full pin (line + name/number) in the orientation it will be placed; R/Space rotates the pin before placing (KiCad), or orientation inferred from the side of the body.
- Actual: Pin line extends outward from the click with connection dot on the body outline and the pin name drawn outside ('VIN' left of the pin, numbers inside the body) — screenshot 016. Pressing R while placing switches to the Rectangle tool instead of rotating the pin; the only way is the 'Next pin defaults' select in the right panel.
- Screenshots: [015-draw-rect-2pins](../evidence/shots/q7/dark/015-draw-rect-2pins.png), [016-pin-dup-number](../evidence/shots/q7/dark/016-pin-dup-number.png)
- Code: `src/modules/library/frontend/import-wizard/editor/tools/pin-tool.ts:46` — preview = circle radius 0.2
- Code: `src/modules/library/frontend/import-wizard/editor/use-editor-tool.ts:19` — r → rect even while pin tool active
- Suggested fix: Preview the pin as a ghost PreviewGraphic line of pinDefaults.lengthMm/rotation; in the pin tool treat R as 'rotate next pin' (update pinDefaults.rotationDeg) before tool-switch shortcuts.
- Verification (vq7): **confirmed** — Code + visual: pin-tool.ts:53-57 preview is a 0.2 mm solid dot; default rotation 180 degrees puts the connection dot at the click point with the line extending left, so clicking on a body's left edge yields an inside-out pin (screenshot 012 shows pins with the dot on the click point). use-editor-tool.ts:101-111 only rotates on R when the Select tool has a selection; otherwise R maps to the Rect tool (TOOL_SHORTCUTS). S3 kept; the 'inside-out' part is a consequence of the missing orientation ghost rather than a wrong default. · evidence: [012-pin-dup-after-delete](../evidence/shots/vq7/dark/012-pin-dup-after-delete.png)

</details>


## T-315

**Editor keyboard/a11y gaps: Ctrl+Y redo missing, toggles lack aria-pressed, focus dropped to <body> after Remove / field commit, Esc doesn't deselect**

- Severity **S4** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner L3 · wave W3 · scope frontend · estimate S
- Findings: Q7-032

**Summary.** Ctrl+Y does nothing; toggles expose state only by colour; focus lost after DOM re-render/unmount, so keyboard users restart from the top of the page.

**Root cause.** `node_modules/@openpcb/r3f-eda-canvas/dist/utils/keyboard-shortcuts.js:14` — isRedoShortcut only Mod+Shift+Z

**Proposed fix.** Ctrl+Y redo, aria-pressed on toggles, keep focus after Remove/commit, Esc deselects. — Detail: Accept Ctrl+Y in isRedoShortcut; use kit ToolbarButton pressable; move focus to the Select button after Remove and keep focus in the row after commits.

**Evidence.** `console: after Ctrl+Y pins unchanged '1,2,3,4'; Remove → activeElement BODY; Drill Tab → activeElement BODY`

<details><summary>Q7-032 — Editor keyboard/a11y gaps: Ctrl+Y redo missing, toggles lack aria-pressed, focus dropped to <body> after Remove / field commit, Esc doesn't deselect (S4, confirmed)</summary>

- Area library.symbol-editor · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Draw symbol: Cmd+Z then Ctrl+Y (no redo; Cmd+Shift+Z works)
  2. Inspect Grid / Alignment guides / Show dimensions buttons (no aria-pressed)
  3. 3D step: click Remove (focus → BODY); Pad panel: edit Drill then Tab (focus → BODY)
- Expected: Same redo bindings as PCB (Ctrl+Y), toggle state exposed, focus kept on a sensible element.
- Actual: Ctrl+Y does nothing; toggles expose state only by colour; focus lost after DOM re-render/unmount, so keyboard users restart from the top of the page.
- Console: `after Ctrl+Y pins unchanged '1,2,3,4'; Remove → activeElement BODY; Drill Tab → activeElement BODY`
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/utils/keyboard-shortcuts.js:14` — isRedoShortcut only Mod+Shift+Z
- Code: `src/modules/library/frontend/import-wizard/editor/EditorToolbar.tsx:136` — toggle buttons without aria-pressed
- Suggested fix: Accept Ctrl+Y in isRedoShortcut; use kit ToolbarButton pressable; move focus to the Select button after Remove and keep focus in the row after commits.
- Verification (vq7): **confirmed** — Partially confirmed: Ctrl+Y and Cmd+Y do nothing (Graphics 1 -> 1) while Cmd+Shift+Z redoes (1 -> 2); PCB supports Ctrl+Y (PcbCanvas.tsx:4941-4961). Grid / Alignment guides / Show dimensions buttons expose no pressed state in the a11y snapshot. 3D 'Remove' -> activeElement BODY. Refuted sub-point: Tab after editing Drill kept focus on the next INPUT in my run (not BODY); focus loss after Enter is covered by Q7-018. 'Esc doesn't deselect' duplicates Q7-006. S4 kept. · evidence: Ctrl+Y: 'Graphics 1' unchanged; Meta+Shift+Z: 'Graphics 2', Remove -> activeElement BODY; Drill + Tab -> activeElement INPUT

</details>

