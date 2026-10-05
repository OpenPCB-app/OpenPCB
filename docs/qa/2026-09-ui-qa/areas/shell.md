# shell — QA findings

[← index](../README.md) · 5 triage entries · S1 0 · S2 1 · S3 2 · S4 2

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-024](#t-024) | S2 | App-wide right-click handler hijacks every context menu (inputs, design tabs, outline rows, 3D pan, Docs editor) | Q1-006, Q3-001, Q5-016, Q9-027, Q2-026 | fix-now | F0b / F0b | frontend | S |
| [T-025](#t-025) | S3 | Menus use three recipes (app context menu 28px/panel bg vs kit 22px/menu-bg vs toolbar dropdowns) | Q1-007, Q11-012, Q3-034, F1B-024 | fix-now | F0b / F0b | frontend | S |
| [T-026](#t-026) | S3 | Left rail inconsistencies: Settings has no tooltip, Home has none while module items get native title tooltips, active item is narrower (64px vs 72px), no aria-current on active item | Q1-015 | fix-now | C1 / W2 | frontend | XS |
| [T-027](#t-027) | S4 | Rail 'local' glyph says 'Local only — not signed in' even when cloud is disabled and sign-in is impossible | Q1-019 | fix-now | C1 / W2 | frontend | XS |
| [T-028](#t-028) | S4 | No favicon: /favicon.ico 404 on every load (tab shows the generic icon) | Q1-025 | fix-now | F0b / F0b | frontend | XS |

## T-024

**App-wide right-click handler hijacks every context menu (inputs, design tabs, outline rows, 3D pan, Docs editor)**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0b · wave F0b · scope frontend · estimate S
- Findings: Q1-006, Q3-001, Q5-016, Q9-027, Q2-026 · known ref K33

**Summary.** Both places show the same custom menu with title 'OpenPCB' and a single item 'Settings Ctrl+,'. No clipboard actions in inputs (a capture-phase listener preventDefaults every native contextmenu). Opening the menu moves focus from the input to the menu; after Esc focus lands on <body>, not back on the input (selection lost). Label hardcodes 'Ctrl+,' although the handler also accepts ⌘ and this is a macOS-first deskto… | Also covers: Q3-001: App-level 'Settings' context menu hijacks right-click: design-tab menu never opens, outli…; Q5-016: Right-drag pan in the 3D view pops the app context menu ('OpenPCB · Settings') on release; Q9-027: Right-click in the Docs editor shows only the app menu ('Settings') — no Cut/Copy/Paste o…; Q2-026: App context menu shows 'Ctrl+,' for Settings on macOS

**Root cause.** `src/core/frontend/src/AppShell.tsx:36` — capture-phase contextmenu preventDefault on document for ALL targets

**Proposed fix.** AppShell: skip app menu when target is editable/contenteditable, inside a canvas, or event already handled (defaultPrevented); keep native menu in inputs; platform-aware shortcut labels (⌘ on macOS). — Detail: AppShell.tsx:63: when (event.target as Element).closest('input, textarea, [contenteditable="true"]') open an 'edit' scope menu with Cut/Copy/Paste/Select all (document.execCommand or an Electron IPC to webContents.cut/copy/paste) instead of the app menu — letting the native menu through (:36) only helps the browser, Electron shows nothing. Render the shortcut via a platform helper (⌘, on macOS). AppContextMenu closeMenu: restore focus to the previously focused element.

**Evidence.** [009-ctx-in-search-input](../evidence/shots/vq1/dark/009-ctx-in-search-input.png), [010-tab-context-menu](../evidence/shots/q3/dark/010-tab-context-menu.png), [005-tab-rightclick](../evidence/shots/vq3/dark/005-tab-rightclick.png)

<details><summary>Q1-006 — Right-click anywhere (incl. text inputs) shows only an 'OpenPCB › Settings' menu — no Cut/Copy/Paste, steals focus, shortcut label says Ctrl+, on macOS (S3, confirmed)</summary>

- Area shell · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Home: type 'LED' in 'Search designs', select the text
  2. Right-click inside the search input
  3. Observe the menu; press Esc
  4. Right-click on empty sidebar area (180,500) for comparison
- Expected: Inside editable fields the native (or an equivalent Cut/Copy/Paste/Select all) menu appears; the app menu appears only on non-editable chrome; shortcut shown per platform (⌘, on macOS); focus returns to the input after Esc.
- Actual: Both places show the same custom menu with title 'OpenPCB' and a single item 'Settings  Ctrl+,'. No clipboard actions in inputs (a capture-phase listener preventDefaults every native contextmenu). Opening the menu moves focus from the input to the menu; after Esc focus lands on <body>, not back on the input (selection lost). Label hardcodes 'Ctrl+,' although the handler also accepts ⌘ and this is a macOS-first desktop app.
- Screenshots: [009-ctx-in-search-input](../evidence/shots/vq1/dark/009-ctx-in-search-input.png), [006-ctx-search-input](../evidence/shots/q1/dark/006-ctx-search-input.png), [005-ctx-empty](../evidence/shots/q1/dark/005-ctx-empty.png)
- Code: `src/core/frontend/src/AppShell.tsx:36` — capture-phase contextmenu preventDefault on document for ALL targets
- Code: `src/core/frontend/src/AppShell.tsx:63` — shell-wide onContextMenu opens app menu even over inputs
- Code: `src/core/frontend/src/AppShell.tsx:77` — shortcut: 'Ctrl+,' hardcoded
- Code: `src/core/frontend/src/components/AppContextMenu.tsx:119` — menu autofocus; no focus restore on close
- Suggested fix: AppShell.tsx:63: when (event.target as Element).closest('input, textarea, [contenteditable="true"]') open an 'edit' scope menu with Cut/Copy/Paste/Select all (document.execCommand or an Electron IPC to webContents.cut/copy/paste) instead of the app menu — letting the native menu through (:36) only helps the browser, Electron shows nothing. Render the shortcut via a platform helper (⌘, on macOS). AppContextMenu closeMenu: restore focus to the previously focused element.
- Verification (vq1): **confirmed** — Reproduced: right-click inside the Home search input (text 'LED' selected) opened data-testid=app-context-menu scope 'app' with 'OpenPCB / Settings / Ctrl+,' only; focus moved to the menu DIV and after Esc landed on BODY (not the input). AppShell.tsx:35-47 capture-phase preventDefault on every contextmenu + :63-84 shell-wide menu. Refutation attempt: in Electron a native menu would not appear anyway — electron/src has no 'context-menu' handler — so the desktop app has no Cut/Copy/Paste on right-click at all; the finding stands for Electron too. Shortcut label hardcoded 'Ctrl+,' (useSettingsHotkeys accepts ⌘ too). K33 confirmed, S3. · evidence: [009-ctx-in-search-input](../evidence/shots/vq1/dark/009-ctx-in-search-input.png)

</details>

<details><summary>Q3-001 — App-level 'Settings' context menu hijacks right-click: design-tab menu never opens, outline rows open two overlapping menus (S2, confirmed)</summary>

- Area designer.shell · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Open two designs in Designer (e.g. 'S3 LLM Edge — 12V params' and 'S3 LLM Edge — additive v2')
  2. Right-click either design tab in the header
  3. Right-click any row in the Outline panel (e.g. R1)
- Expected: Tab context menu with Rename / Close / Close others / Close all (DesignTabs.tsx:278-300)
- Actual: Design tabs: the generic app context menu 'OpenPCB — Settings Ctrl+,' opens instead of the tab menu, so Rename/Close/Close others/Close all are unreachable (no other entry point for Close others/Close all). Outline rows (Parts/Nets/Labels): the row menu (Frame/Rename/Duplicate/Delete) AND the app 'OpenPCB / Settings' menu open at the same time, overlapping (4/4 attempts).
- Screenshots: [010-tab-context-menu](../evidence/shots/q3/dark/010-tab-context-menu.png), [061-outline-row-two-menus](../evidence/shots/q3/dark/061-outline-row-two-menus.png)
- Code: `src/core/frontend/src/AppShell.tsx:36` — capture-phase document contextmenu listener preventDefault()s every event
- Code: `src/core/frontend/src/AppShell.tsx:63` — grid onContextMenu opens the app menu unconditionally (no defaultPrevented check)
- Code: `src/modules/designer/frontend/components/DesignTabs.tsx:193` — Radix ContextMenuTrigger; its handler is skipped because defaultPrevented is already true
- Code: `src/modules/designer/frontend/components/OutlinePanel/OutlineRow.tsx:75` — handleContextMenu preventDefault without stopPropagation, so the grid handler also runs
- Suggested fix: AppShell.tsx: drop the capture-phase preventDefault (:35-47). In the grid onContextMenu (:63) return early when event.defaultPrevented (both Radix ContextMenuTrigger and OutlineRow already call preventDefault), and suppress the native menu in a bubble-phase document listener only for events nobody handled. Optionally port DesignTabs to the shared openContextMenu() store for one menu system.
- Verification (vq3): **confirmed** — Reproduced on stack A (vq3-dark): right-click on a design tab opens only the app menu 'OpenPCB / Settings Ctrl+,'; right-click on outline row R1 opens the row menu (Frame/Rename/Duplicate/Delete) AND the app menu on top of each other. Root cause verified: AppShell.tsx:35-47 registers a capture-phase contextmenu listener that preventDefault()s every event; Radix composeEventHandlers (node_modules/@radix-ui/primitive/dist/index.mjs:3-9) then skips ContextMenuTrigger's own handler because event.defaultPrevented is already true, and the event bubbles to the grid onContextMenu (AppShell.tsx:63) which opens the app menu. OutlineRow.handleContextMenu (OutlineRow.tsx:75-81) never stops propagation, so the grid handler fires as well. DesignTabs is the only Radix ContextMenuTrigger consumer in src/, so Close others / Close all have no other entry point. Refutation attempts: not browser-only (Electron runs the same handlers); not intended (DesignTabs.tsx:278-300 builds the tab menu). This shares the AppShell handler with Q1-006 (K33, native menu replaced everywhere), but the symptom and the fix are different, so it stays separate. S2 kept. · evidence: [005-tab-rightclick](../evidence/shots/vq3/dark/005-tab-rightclick.png), [006-outline-row-rightclick](../evidence/shots/vq3/dark/006-outline-row-rightclick.png)

</details>

<details><summary>Q5-016 — Right-drag pan in the 3D view pops the app context menu ('OpenPCB · Settings') on release (S3, confirmed)</summary>

- Area designer.3d · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. Open 'LED Indicators 5V' → 3D
  2. Press right mouse button on the board, drag ~80 px, release
- Expected: Right-drag pans the camera (it does) and no menu appears; a context menu only on a right-click without movement, and one with 3D-relevant items (camera presets, snapshot).
- Actual: Camera pans, then on release the global app context menu (data-testid=app-context-menu, only item 'Settings Ctrl+,') opens over the board. The 3D canvas does not suppress contextmenu after a drag and offers no 3D items.
- Screenshots: [035-3d-rightdrag-contextmenu](../evidence/shots/q5/dark/035-3d-rightdrag-contextmenu.png)
- Code: `src/core/frontend/src/AppShell.tsx:36` — global contextmenu handler
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:756` — Canvas has no onContextMenu preventDefault
- Suggested fix: In Board3DCanvas wrapper add onContextMenu={e=>e.preventDefault()} (or suppress when the pointer moved > threshold), optionally a 3D scope menu (views, snapshot).
- Verification (vq5): **confirmed** — Reproduced: right-button drag on the 3D board pans, then [data-testid=app-context-menu] ('OpenPCB · Settings Ctrl+,') is open over the canvas. Board3DCanvas has no onContextMenu suppression; the global AppShell handler catches it (K33). Same behaviour expected in Electron since the menu is React-rendered. · evidence: [015-3d-rightdrag-contextmenu](../evidence/shots/vq5/dark/015-3d-rightdrag-contextmenu.png)

</details>

<details><summary>Q9-027 — Right-click in the Docs editor shows only the app menu ('Settings') — no Cut/Copy/Paste or spelling suggestions (S2, confirmed)</summary>

- Area docs · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Docs > QA-q9-B, right-click on the word 'Heading_2' in the editor (or on a misspelled, red-underlined word)
- Expected: Native/text context menu with Cut, Copy, Paste, Select all and spell-check suggestions inside contenteditable/inputs
- Actual: data-testid=app-context-menu opens with a single item 'Settings Ctrl+,'. Text editing via mouse (paste from context menu, accept spelling suggestion — the editor does show spell-check squiggles) is impossible. Same in the title and search inputs.
- Screenshots: [014-editor-context-menu](../evidence/shots/q9/light/014-editor-context-menu.png), [024-editor-context-menu](../evidence/shots/vq9/dark/024-editor-context-menu.png)
- Code: `src/core/frontend/src/AppShell.tsx:36` — global contextmenu handler preventDefault everywhere
- Suggested fix: AppShell.tsx:35-46 and :60-84: return early (no preventDefault, no app menu) when event.target is inside input, textarea, [contenteditable=true] or when there is a text selection; in electron/src/main add webContents.on('context-menu') building Cut/Copy/Paste/Select All + params.dictionarySuggestions (replaceMisspelling) for editable targets.
- Verification (vq9): **confirmed** — Reproduced: right-click on 'Heading_2' in the Docs editor opens data-testid=app-context-menu 'OpenPCB | Settings | Ctrl+,' only. AppShell.tsx:35-46 preventDefault()s every contextmenu in capture phase and :60-84 opens the app menu; electron/src has no webContents 'context-menu' handler, so Electron has no Cut/Copy/Paste/spellcheck menu either. Same root cause as Q1-006 (Home search input, verified S3 by vq1) — merge candidate at triage. Kept S2 here because in the rich-text editor spell-check squiggles are shown but can never be corrected and mouse paste is impossible (keyboard shortcuts remain the only workaround). · evidence: [024-editor-context-menu](../evidence/shots/vq9/dark/024-editor-context-menu.png), DOM: app-context-menu text 'OpenPCB | Settings | Ctrl+,'

</details>

<details><summary>Q2-026 — App context menu shows 'Ctrl+,' for Settings on macOS (S4, duplicate)</summary>

- Area shell · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. macOS: right-click anywhere in the app shell
  2. Menu item 'Settings  Ctrl+,'
- Expected: ⌘, on macOS (Ctrl+, elsewhere), matching '⌘/Ctrl+I' hints elsewhere.
- Actual: Hard-coded 'Ctrl+,' (navigator.platform MacIntel).
- Screenshots: [005-rightclick-menu](../evidence/shots/q2/dark/005-rightclick-menu.png), [107-designer-rightclick](../evidence/shots/q2/light/107-designer-rightclick.png)
- Code: `src/core/frontend/src/AppShell.tsx:77` — shortcut: 'Ctrl+,'
- Suggested fix: Compute label from platform (isMac ? '⌘,' : 'Ctrl+,') via a shared shortcut-label helper.
- Verification (vq2): **DUPLICATE** — Reproduced (menu shows 'Settings Ctrl+,' on macOS; AppShell.tsx:77 hard-coded) but already covered verbatim by Q1-006 ('…shortcut label says Ctrl+, on macOS', K33). Fold into Q1-006. · evidence: [015-context-menu](../evidence/shots/vq2/dark/015-context-menu.png)

</details>


## T-025

**Menus use three recipes (app context menu 28px/panel bg vs kit 22px/menu-bg vs toolbar dropdowns)**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0b · wave F0b · scope frontend · estimate S
- Findings: Q1-007, Q11-012, Q3-034, F1B-024

**Summary.** App context menu (also used by schematic/PCB canvas menus via data-scope): bg rgb(17,17,19)=--surface-panel, item height 28px, font 12px, title 11px, hover bg-surface-hover. Kit dropdown: bg rgb(28,28,31)=--menu-bg, item 22px, font 11px. The two menu families look different side by side. | Also covers: Q11-012: Menus/popovers use three different recipes: kit dropdown (22px items, --menu-bg) vs app c…; Q3-034: Canvas context menus use off-kit styling (28 px rows, shadow-lg, panel bg) and show 'Ctrl…; F1B-024: Schematic Outline row 'Actions' menu uses a fourth menu recipe (bg-surface-raised grey, b…

**Root cause.** `src/core/frontend/src/components/AppContextMenu.tsx:155` — bg-surface-panel, py-1.5; items px-3 py-1.5 text-sm

**Proposed fix.** Restyle AppContextMenu to kit menu tokens (menu-bg, 22px items, 11px); clamp to viewport; D3/D2 move toolbar + outline row menus to kit DropdownMenu. — Detail: AppContextMenu.tsx:155: 'bg-menu-bg border-menu-border p-1' ; items (:193) 'h-[22px] px-2 text-xs rounded-control' with focused/hover 'bg-menu-highlight text-text-strong', shortcut 'text-2xs text-text-tertiary', title/group label like DropdownMenuLabel; set ITEM_HEIGHT (:6) to 22 and PADDING_Y to 4.

**Evidence.** [010-ctx-empty](../evidence/shots/vq1/dark/010-ctx-empty.png), [menu-home-sort](../evidence/shots/q11/light/menu-home-sort.png), [040-menu-pcb-add](../evidence/shots/vq11/dark/040-menu-pcb-add.png)

<details><summary>Q1-007 — App context menu is styled unlike every kit menu (panel bg, 28px rows, 12px text vs menu-bg, 22px rows, 11px) (S3, confirmed)</summary>

- Area shell · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Home: right-click empty area → app context menu
  2. Then click the sort button 'Modified' → kit dropdown menu
  3. Compare computed styles
- Expected: All menus share the kit menu tokens: bg --menu-bg, border --menu-border, 22px items, 11px text, --menu-highlight hover.
- Actual: App context menu (also used by schematic/PCB canvas menus via data-scope): bg rgb(17,17,19)=--surface-panel, item height 28px, font 12px, title 11px, hover bg-surface-hover. Kit dropdown: bg rgb(28,28,31)=--menu-bg, item 22px, font 11px. The two menu families look different side by side.
- Screenshots: [010-ctx-empty](../evidence/shots/vq1/dark/010-ctx-empty.png), [011-sort-menu](../evidence/shots/vq1/dark/011-sort-menu.png), [005-ctx-empty](../evidence/shots/q1/dark/005-ctx-empty.png), [009-sort-menu](../evidence/shots/q1/dark/009-sort-menu.png)
- Code: `src/core/frontend/src/components/AppContextMenu.tsx:155` — bg-surface-panel, py-1.5; items px-3 py-1.5 text-sm
- Code: `src/shared/frontend/ui/dropdown-menu.tsx:46` — kit: bg-menu-bg border-menu-border; items h-[22px] text-xs
- Suggested fix: AppContextMenu.tsx:155: 'bg-menu-bg border-menu-border p-1' ; items (:193) 'h-[22px] px-2 text-xs rounded-control' with focused/hover 'bg-menu-highlight text-text-strong', shortcut 'text-2xs text-text-tertiary', title/group label like DropdownMenuLabel; set ITEM_HEIGHT (:6) to 22 and PADDING_Y to 4.
- Verification (vq1): **confirmed** — Reproduced (dark): app context menu bg rgb(17,17,19) (--surface-panel), border rgb(30,30,33), item 28px / 12px text; kit sort dropdown bg rgb(28,28,31) (--menu-bg), border rgb(35,35,38), item 22px / 11px. AppContextMenu.tsx:155 and :193 vs dropdown-menu.tsx:46/68. Also ITEM_HEIGHT=32 (AppContextMenu.tsx:6) no longer matches the real 28px rows, so bottom-edge clamping is off. S3 kept. · evidence: [010-ctx-empty](../evidence/shots/vq1/dark/010-ctx-empty.png), [011-sort-menu](../evidence/shots/vq1/dark/011-sort-menu.png)

</details>

<details><summary>Q11-012 — Menus/popovers use three different recipes: kit dropdown (22px items, --menu-bg) vs app context menu (28px items, 12px, --surface-panel) vs PCB toolbar dropdowns (23px items, --surface-raised, no role=menu) (S3, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Open Home sort ('Modified ▾') and a design's '…' menu
  2. Right-click a design tab / the PCB canvas / the schematic canvas
  3. Open PCB toolbar 'Add ▾' and 'View ▾'
- Expected: All menus share the kit DropdownMenu/ContextMenu look: --menu-bg, --menu-border, 22px items, 11px text, 4px padding, --menu-highlight.
- Actual: Light: kit dropdown (Home sort/more) bg #ffffff (--menu-bg), border --menu-border, radius 3px, pad 4px, items 22px/11px. App context menu (design tab, PCB canvas, schematic canvas) bg #f7f7f8 (--surface-panel), pad 6px 0, items 28px/12px (text-sm), full-bleed highlight. PCB 'Add'/'View' dropdowns bg #e2e2e5 (--surface-raised), items 23px/11px, pad 0, no role=menu. Dark: kit #1c1c1f with border rgb(35,35,38) vs PCB dropdown border rgb(30,30,33); context-menu items 28px/12px in both themes. Three visibly different menu densities in one editor.
- Screenshots: [menu-home-sort](../evidence/shots/q11/light/menu-home-sort.png), [menu-pcb-canvas-ctx](../evidence/shots/q11/light/menu-pcb-canvas-ctx.png), [menu-pcb-add](../evidence/shots/q11/light/menu-pcb-add.png), [menu-design-tab-ctx](../evidence/shots/q11/dark/menu-design-tab-ctx.png), [menu-pcb-add](../evidence/shots/q11/dark/menu-pcb-add.png)
- Census: `census/q11/menu-pcb-canvas-ctx-light.json`
- Code: `src/core/frontend/src/components/AppContextMenu.tsx:193` — items px-3 py-1.5 text-sm (28px); container :155 bg-surface-panel py-1.5
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:46` — Add/View dropdown container: absolute div bg-surface-raised, no menu role
- Code: `src/shared/frontend/ui/dropdown-menu.tsx:68` — kit item h-[22px] text-xs
- Suggested fix: Render AppContextMenu items with the kit ContextMenu item classes (h-[22px] text-xs, bg-menu-bg/border-menu-border, p-1) and rebuild the PCB Add/View dropdowns on the kit DropdownMenu (also gives role=menu + keyboard).
- Verification (vq11): **confirmed** — Live in dark. Home sort (kit DropdownMenu): role=menu, bg rgb(28,28,31), border rgb(35,35,38), pad 4px, radius 3px, items 22px/11px. PCB toolbar 'Add': no role=menu container, the items are plain buttons without role=menuitem (Hole/Pad/Text/Zone 23px/11px), container pad 0. App context menu (data-testid app-context-menu): items 28px/12px, pad 6px 0, bg rgb(17,17,19) (--surface-panel). AppContextMenu.tsx:155 (bg-surface-panel py-1.5 shadow-lg) and :193 (px-3 py-1.5 text-sm) render every context menu fed from @shared/frontend/context-menu: PcbCanvas, SchematicCanvas, DesignTabs and use-area-interactions. Cross-agent overlap: Q3-034 (canvas context menus). · evidence: [040-menu-pcb-add](../evidence/shots/vq11/dark/040-menu-pcb-add.png), [041-menu-pcb-ctx](../evidence/shots/vq11/dark/041-menu-pcb-ctx.png), probe: pcbAdd_roleMenu=null, ctx items 28px/12px, homeSort items 22px/11px

</details>

<details><summary>Q3-034 — Canvas context menus use off-kit styling (28 px rows, shadow-lg, panel bg) and show 'Ctrl+A' on macOS (S4, duplicate)</summary>

- Area designer.schematic · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Right-click a part or empty canvas in the schematic
  2. Measure a menu item; compare with the kit ContextMenu (22 px rows, --menu-bg) used elsewhere
- Expected: Kit menu metrics (22 px rows, --menu-bg/--menu-border, no heavy shadow) and platform-correct shortcut labels (⌘A on macOS, as the toolbar uses ⌘/Ctrl)
- Actual: Items are 28 px tall (py-1.5), menu uses bg-surface-panel + shadow-lg; empty-canvas menu lists 'Select all  Ctrl+A' on macOS while the toolbar/palette say ⌘K.
- Screenshots: [033-ctx-part](../evidence/shots/q3/dark/033-ctx-part.png), [032-ctx-empty-canvas](../evidence/shots/q3/dark/032-ctx-empty-canvas.png), [008-ctx-part](../evidence/shots/q3/light/008-ctx-part.png)
- Code: `src/core/frontend/src/components/AppContextMenu.tsx:155` — bg-surface-panel py-1.5 shadow-lg; item px-3 py-1.5 text-sm
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:2892` — shortcut: 'Ctrl+A' hard-coded
- Suggested fix: Restyle AppContextMenu with the kit menu tokens (h-[22px] items, bg-menu-bg, border-menu-border, shadow-none/sm) and format shortcuts via a platform helper (⌘ on mac).
- Verification (vq3): **duplicate** — Reproduced (canvas menus render through the same AppContextMenu, AppContextMenu.tsx:155/193: bg-surface-panel, 28 px rows, shadow-lg), but this is the component already reported and verified as Q1-007 (app context menu styled unlike kit menus). Fold into Q1-007. Fold the hard-coded 'Select all  Ctrl+A' on macOS (SchematicCanvas.tsx:2892) into Q1-006's platform-shortcut-label fix, the same pattern as 'Ctrl+,'. · evidence: [006-outline-row-rightclick](../evidence/shots/vq3/dark/006-outline-row-rightclick.png)

</details>

<details><summary>F1B-024 — Schematic Outline row 'Actions' menu uses a fourth menu recipe (bg-surface-raised grey, border-border, 24 px items) — grey #e2e2e5 in light where kit menus are white --menu-bg (S4, duplicate)</summary>

- Area designer.schematic · stack A · design 43a2da78-9d2e-43a0-bcd3-ecebe3f72551 · themes light, dark · viewports 1440x900
- Repro:
  1. QA-f1b-long → Schem → Outline → hover a part row → click '…' (Actions)
  2. Compare with BOM → Export ▾ in the same theme
- Expected: All dropdowns use the kit DropdownMenu recipe (bg-menu-bg, border-menu-border, 22 px items).
- Actual: Outline Actions: class 'min-w-[9rem] rounded-float border border-border bg-surface-raised py-1 shadow-lg', computed bg rgb(226,226,229) and 24 px items; BOM Export ▾: 'bg-menu-bg border-menu-border p-1' → #ffffff in light. In dark both tokens resolve to #1c1c1f so the drift is only visible in light. Additional instance of the menu-recipe drift in Q11-012 (kit dropdown vs context menu vs PCB Add/View).
- Screenshots: [003-outline-actions-menu](../evidence/shots/f1b/light/003-outline-actions-menu.png), [004-bom-export-menu](../evidence/shots/f1b/light/004-bom-export-menu.png), [083-outline-actions-menu](../evidence/shots/f1b/dark/083-outline-actions-menu.png), [082-bom-export-menu](../evidence/shots/f1b/dark/082-bom-export-menu.png)
- Pixel probes: {"file": "shots/f1b/light/003-outline-actions-menu.png", "x": 420, "y": 230, "hex": "#e2e2e5", "nearestToken": "--surface-raised", "deltaE": 0}; {"file": "shots/f1b/light/004-bom-export-menu.png", "x": 1020, "y": 135, "hex": "#ffffff", "nearestToken": "--menu-bg", "deltaE": 0}; {"file": "shots/f1b/dark/083-outline-actions-menu.png", "x": 420, "y": 230, "hex": "#1c1c1f", "nearestToken": "--menu-bg", "deltaE": 0}
- Suggested fix: Render the Outline row actions with the kit DropdownMenu (src/shared/frontend/ui) or switch its classes to bg-menu-bg border-menu-border p-1 with 22 px items.
- Verification (vf1b): **duplicate** — Reproduced in light: the Outline row 'Actions' menu is 'rounded-float border border-border bg-surface-raised py-1 shadow-lg', computed bg rgb(226,226,229) (--surface-raised), items 23-24 px. This is the same --surface-raised recipe that verified Q11-012 lists for the PCB toolbar Add/View dropdowns, not a fourth recipe. Add OutlinePanel's row menu to Q11-012's list of places to migrate to the kit DropdownMenu. · evidence: [001-outline-actions-menu](../evidence/shots/vf1b/light/001-outline-actions-menu.png), DOM menu bg rgb(226,226,229), itemH [24,24,23,24]

</details>


## T-026

**Left rail inconsistencies: Settings has no tooltip, Home has none while module items get native title tooltips, active item is narrower (64px vs 72px), no aria-current on active item**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate XS
- Findings: Q1-015

**Summary.** Settings gear: no tooltip and no title (only aria-label). Report-bug and Local-only use the kit Tooltip. Designer/Library/Docs/Assistant use the native browser title tooltip (redundant with their visible label, inconsistent look); Home has no title. Active item width 64px vs inactive 72px (highlight looks inset). Only Settings sets aria-current; the active Home/module button does not.

**Root cause.** `src/core/frontend/src/components/LeftSidebar.tsx:15` — active w-16 vs inactive w-[72px]

**Proposed fix.** Kit Tooltip on every rail item incl. Settings/Home; equal active-item width. — Detail: LeftSidebar.tsx: wrap Settings in <Tooltip label='Settings (⌘,)' side='right'>; drop title= on labelled module buttons (:115); add aria-current={active ? 'page' : undefined} to Home (:93) and module buttons (:112); use one width in navButtonClass (:15).

**Evidence.** [002-rail-settings-hover](../evidence/shots/q1/dark/002-rail-settings-hover.png)

<details><summary>Q1-015 — Left rail inconsistencies: Settings has no tooltip, Home has none while module items get native title tooltips, active item is narrower (64px vs 72px), no aria-current on active item (S3, confirmed)</summary>

- Area shell · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Hover the Settings gear (icon-only) for >1s
  2. Hover Home, then Designer
  3. Hover the bug-report and 'local only' glyphs
  4. Inspect rail button widths / aria-current
- Expected: Icon-only rail items (Settings, bug, local) all show the same kit Tooltip; labelled items need none (or all use the kit tooltip); active item is marked aria-current='page' and highlight geometry is consistent.
- Actual: Settings gear: no tooltip and no title (only aria-label). Report-bug and Local-only use the kit Tooltip. Designer/Library/Docs/Assistant use the native browser title tooltip (redundant with their visible label, inconsistent look); Home has no title. Active item width 64px vs inactive 72px (highlight looks inset). Only Settings sets aria-current; the active Home/module button does not.
- Screenshots: [002-rail-settings-hover](../evidence/shots/q1/dark/002-rail-settings-hover.png), [003-rail-bug-hover](../evidence/shots/q1/dark/003-rail-bug-hover.png), [004-rail-local-hover](../evidence/shots/q1/dark/004-rail-local-hover.png)
- Code: `src/core/frontend/src/components/LeftSidebar.tsx:15` — active w-16 vs inactive w-[72px]
- Code: `src/core/frontend/src/components/LeftSidebar.tsx:115` — module buttons use native title
- Code: `src/core/frontend/src/components/LeftSidebar.tsx:153` — Settings button: no Tooltip
- Suggested fix: LeftSidebar.tsx: wrap Settings in <Tooltip label='Settings (⌘,)' side='right'>; drop title= on labelled module buttons (:115); add aria-current={active ? 'page' : undefined} to Home (:93) and module buttons (:112); use one width in navButtonClass (:15).
- Verification (vq1): **confirmed** — Verified: hovering Settings produced no [role=tooltip] (bug link does: 'Report a bug or request a feature'); LeftSidebar.tsx:153-165 Settings has only aria-label; module buttons use native title (:115), Home has none; navButtonClass (:15) w-16 active vs w-[72px] inactive; aria-current only on Settings (:156). S3 kept (icon-only control without visible label/tooltip).

</details>


## T-027

**Rail 'local' glyph says 'Local only — not signed in' even when cloud is disabled and sign-in is impossible**

- Severity **S4** · category copy · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate XS
- Findings: Q1-019

**Summary.** Rail tooltip 'Local only — not signed in', sidebar footer 'Local', status bar 'Local', designer chip 'Local' (title 'Not signed in — local only'). With cloud off there is nowhere to sign in, so 'not signed in' is misleading; the same fact is repeated 3× on one screen.

**Root cause.** `src/core/frontend/src/components/LeftSidebar.tsx:32` — localOnly = !cloudEnabled || !session; same copy for both

**Proposed fix.** When cloud disabled, rail glyph reads 'Local only' without sign-in wording (or hide). — Detail: LeftSidebar.tsx:131-141: when !cloudEnabled use label 'Local only' (no sign-in wording); keep 'Local only — not signed in' for cloud-enabled-but-signed-out. Revisit the triple indicator with design (D13) separately.

**Evidence.** [004-rail-local-hover](../evidence/shots/q1/dark/004-rail-local-hover.png)

<details><summary>Q1-019 — Rail 'local' glyph says 'Local only — not signed in' even when cloud is disabled and sign-in is impossible (S4, confirmed)</summary>

- Area shell · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack A (cloud off): Home
  2. Hover the rail cloud-off glyph; read the Home sidebar footer and the status bar right segment; open a design and hover the header 'Local' chip
- Expected: One consistent state label; when cloud is disabled/unavailable, don't imply the user can sign in.
- Actual: Rail tooltip 'Local only — not signed in', sidebar footer 'Local', status bar 'Local', designer chip 'Local' (title 'Not signed in — local only'). With cloud off there is nowhere to sign in, so 'not signed in' is misleading; the same fact is repeated 3× on one screen.
- Screenshots: [004-rail-local-hover](../evidence/shots/q1/dark/004-rail-local-hover.png), [001-home-list](../evidence/shots/q1/dark/001-home-list.png)
- Code: `src/core/frontend/src/components/LeftSidebar.tsx:32` — localOnly = !cloudEnabled \|\| !session; same copy for both
- Code: `src/core/frontend/src/screens/home/HomeSidebar.tsx:33` — footer 'Local'
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:527` — status bar 'Local'
- Suggested fix: LeftSidebar.tsx:131-141: when !cloudEnabled use label 'Local only' (no sign-in wording); keep 'Local only — not signed in' for cloud-enabled-but-signed-out. Revisit the triple indicator with design (D13) separately.
- Verification (vq1): **confirmed** — Partially refuted: three 'Local' markers are per D13 (sidebar footer + 22px footer 'Local') plus the Run-2 rail glyph, so the duplication is a design decision. What stands: with cloud off (stack A, readCloudConfig disabled) the rail glyph tooltip/aria-label reads 'Local only — not signed in' because LeftSidebar.tsx:32 uses `!cloudEnabled || !session`, implying a sign-in that does not exist; HomeSidebar's SyncFooter correctly degrades to 'Local'. S4 kept, scope narrowed to the wording. · evidence: [004-rail-local-hover](../evidence/shots/q1/dark/004-rail-local-hover.png)

</details>


## T-028

**No favicon: /favicon.ico 404 on every load (tab shows the generic icon)**

- Severity **S4** · category console · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0b · wave F0b · scope frontend · estimate XS
- Findings: Q1-025

**Summary.** [ERROR] Failed to load resource: 404 /favicon.ico; index.html has no <link rel=icon>.

**Root cause.** `src/core/frontend/index.html:6` — no <link rel=icon>

**Proposed fix.** Add favicon (index.html + public/) — also silences the 404 console noise. — Detail: Add src/core/frontend/public/favicon.svg (electron/openpcb_icon.svg already exists) and <link rel="icon" href="/favicon.svg"> in index.html:6.

**Evidence.** `console: [ERROR] Failed to load resource: 404 @ http://127.0.0.1:1520/favicon.ico`

<details><summary>Q1-025 — No favicon: /favicon.ico 404 on every load (tab shows the generic icon) (S4, confirmed)</summary>

- Area shell · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Open http://127.0.0.1:1520 and read the console
- Expected: index.html links an app icon.
- Actual: [ERROR] Failed to load resource: 404 /favicon.ico; index.html has no <link rel=icon>.
- Console: `[ERROR] Failed to load resource: 404 @ http://127.0.0.1:1520/favicon.ico`
- Code: `src/core/frontend/index.html:6` — no <link rel=icon>
- Suggested fix: Add src/core/frontend/public/favicon.svg (electron/openpcb_icon.svg already exists) and <link rel="icon" href="/favicon.svg"> in index.html:6.
- Verification (vq1): **confirmed** — Verified in this session's console log: [ERROR] 404 http://127.0.0.1:1520/favicon.ico; src/core/frontend/index.html has no <link rel=icon> and there is no public/ dir. Browser/dev-only visibility (Electron shows no tab favicon), per protocol recorded once as S4.

</details>

