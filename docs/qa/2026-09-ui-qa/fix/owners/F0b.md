# Fix brief — owner F0b

7 approved triage entries. Entries marked **shared** are co-owned: implement ONLY the part that lives in your owned files; the lead owner is listed. Screenshot paths are absolute (open with the Read tool for layout only).

## T-001 [S1] Schematic/PCB/3D canvases render black offline (canvas fonts fetched from cdn.jsdelivr.net)

- Area cross-cutting · category crash · estimate S · findings Q10-001
- **Approved scope:** Approved as MITIGATION only: bundle a font + configure troika so canvases render offline; the real fix in @openpcb/r3f-eda-canvas is a follow-up.
- Summary: Schematic canvas is 100% #000000 (1 colour vs 853 online), PCB canvas black (zoom stuck at 20%, only the Auto Layout buttons float over it), 3D view black (FPS —). Turning 'Refdes labels' off does not recover. After connectivity returns the canvases stay black until a full app reload. Online baseline renders normally. Every canvas load online also makes 8 requests to cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@…
- Root cause: `node_modules/@openpcb/r3f-eda-canvas/dist/primitives/EDAText.js:9` — preloadFont({characters}) and drei <Text> are called with no `font` → troika falls back to unicode-font-resolver on cdn.jsdelivr.net
- Proposed fix: Mitigation: bundle a font + configure troika text builder (unicodeFontsURL/font) in main.tsx so canvases render offline; real fix: r3f-eda-canvas EDAText passes a bundled font. — Detail: In the shared repo (@openpcb/r3f-eda-canvas): ship a font file (e.g. the bundled IBM Plex Sans woff from D2) as a package asset and pass `font={bundledFontUrl}` to drei <Text> in EDAText plus preloadFont({font: bundledFontUrl, …}); at app startup call troika's configureTextBuilder({ unicodeFontsURL: <app-local copy of unicode-font-resolver data> }) so fallback glyphs never go to jsdelivr. Wrap label layers in their own <Suspense fallback={null}> (and an error boundary) so a text failure drops labels instead of bla…
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q10/dark/020-C1-designer-schem-signedout.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq10/light/002-schem-internet-offline-15s.png
- Q10-001 repro: Stack C1 (any stack works), open Designer with 'Dual LED Blinker' open → Simulate no internet while localhost works: run-code page.context().route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort('internetdisconnected')) → Reload, go to Designer (Schem tab), wait 15 s → Switch to PCB tab, then 3D tab → Remove the route (internet back) and switch tabs again without reloading → Also: with internet blocked, open Library and select any part → preview cards never load
  - expected: A desktop EDA app renders every editor canvas with no internet connection; canvas text uses bundled fonts.
  - actual: Schematic canvas is 100% #000000 (1 colour vs 853 online), PCB canvas black (zoom stuck at 20%, only the Auto Layout buttons float over it), 3D view black (FPS —). Turning 'Refdes labels' off does not recover. After connectivity returns the canvases stay black until a full app reload. Online baseline renders normally. Every canvas load online also makes 8 requests to cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@v1.0.1 (codepoint-index + latin/greek woff), i.e. the app phones a third-party CDN on every launch. Library preview pane (Symbol + Footprint cards) shows 'Loading preview…' spinners indefinitely (still spinning after 16 s) for any part when offline. Light theme identical (PCB canvas 99.6% #000000).
  - code: `node_modules/@openpcb/r3f-eda-canvas/dist/primitives/EDAText.js:9` preloadFont({characters}) and drei <Text> are called with no `font` → troika falls back to unicode-font-resolver on cdn.jsdelivr.net
  - code: `src/shared/frontend/canvas/primitives/EDAText.tsx:1` in-tree shim re-exporting the package EDAText
  - code: `src/modules/designer/frontend/pcb/layers/OverlayLayer.tsx:13` PCB overlay text via EDAText
  - code: `node_modules/troika-three-text/dist/troika-three-text.esm.js:453` default dataUrl https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@v1.0.1/packages/data
  - code: `node_modules/@react-three/drei/core/Text.js:34` suspend(() => new Promise(res => preloadFont({font, characters}, res))) never resolves when troika's font fetch fails → whole scene suspends; cached key keeps it suspended after reconnect
  - code: `node_modules/troika-three-text/dist/troika-three-text.esm.js:464` configureTextBuilder supports `unicodeFontsURL` to point the resolver at app-local data

## T-003 [S2] No React ErrorBoundary / global error handlers — any render crash blanks the whole app

- Area cross-cutting · category crash · estimate S · findings  · known K01
- Summary: Containment for Q9-008/Q9-022 (root fixes in K1) and uncaught rejections seen in F1A-001/F1A-004.
- Root cause: `src/core/frontend/src/main.tsx:36` — No ErrorBoundary in App.tsx/ModuleSpaceHost; no window error/unhandledrejection handlers
- Proposed fix: Wrap AppShell/ModuleSpaceHost in kit ErrorBoundary (per-module fallback with Reload); window error + unhandledrejection handlers -> sentry + toast.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q9/dark/022-crash-pdf-to-text.png

## T-024 [S2] App-wide right-click handler hijacks every context menu (inputs, design tabs, outline rows, 3D pan, Docs editor)

- Area shell · category bug · estimate S · findings Q1-006, Q3-001, Q5-016, Q9-027, Q2-026 · known K33
- Summary: Both places show the same custom menu with title 'OpenPCB' and a single item 'Settings Ctrl+,'. No clipboard actions in inputs (a capture-phase listener preventDefaults every native contextmenu). Opening the menu moves focus from the input to the menu; after Esc focus lands on <body>, not back on the input (selection lost). Label hardcodes 'Ctrl+,' although the handler also accepts ⌘ and this is a macOS-first deskto… | Also covers: Q3-001: App-level 'Settings' context menu hijacks right-click: design-tab menu never opens, outli…; Q5-016: Right-drag pan in the 3D view pops the app context menu ('OpenPCB · Settings') on release; Q9-027: Right-click in the Docs editor shows only the app menu ('Settings') — no Cut/Copy/Paste o…; Q2-026: App context menu shows 'Ctrl+,' for Settings on macOS
- Root cause: `src/core/frontend/src/AppShell.tsx:36` — capture-phase contextmenu preventDefault on document for ALL targets
- Proposed fix: AppShell: skip app menu when target is editable/contenteditable, inside a canvas, or event already handled (defaultPrevented); keep native menu in inputs; platform-aware shortcut labels (⌘ on macOS). — Detail: AppShell.tsx:63: when (event.target as Element).closest('input, textarea, [contenteditable="true"]') open an 'edit' scope menu with Cut/Copy/Paste/Select all (document.execCommand or an Electron IPC to webContents.cut/copy/paste) instead of the app menu — letting the native menu through (:36) only helps the browser, Electron shows nothing. Render the shortcut via a platform helper (⌘, on macOS). AppContextMenu closeMenu: restore focus to the previously focused element.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq1/dark/009-ctx-in-search-input.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q3/dark/010-tab-context-menu.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq3/dark/005-tab-rightclick.png
- Q1-006 repro: Home: type 'LED' in 'Search designs', select the text → Right-click inside the search input → Observe the menu; press Esc → Right-click on empty sidebar area (180,500) for comparison
  - expected: Inside editable fields the native (or an equivalent Cut/Copy/Paste/Select all) menu appears; the app menu appears only on non-editable chrome; shortcut shown per platform (⌘, on macOS); focus returns to the input after Esc.
  - actual: Both places show the same custom menu with title 'OpenPCB' and a single item 'Settings  Ctrl+,'. No clipboard actions in inputs (a capture-phase listener preventDefaults every native contextmenu). Opening the menu moves focus from the input to the menu; after Esc focus lands on <body>, not back on the input (selection lost). Label hardcodes 'Ctrl+,' although the handler also accepts ⌘ and this is a macOS-first desktop app.
  - code: `src/core/frontend/src/AppShell.tsx:36` capture-phase contextmenu preventDefault on document for ALL targets
  - code: `src/core/frontend/src/AppShell.tsx:63` shell-wide onContextMenu opens app menu even over inputs
  - code: `src/core/frontend/src/AppShell.tsx:77` shortcut: 'Ctrl+,' hardcoded
  - code: `src/core/frontend/src/components/AppContextMenu.tsx:119` menu autofocus; no focus restore on close
- Q3-001 repro: Open two designs in Designer (e.g. 'S3 LLM Edge — 12V params' and 'S3 LLM Edge — additive v2') → Right-click either design tab in the header → Right-click any row in the Outline panel (e.g. R1)
  - expected: Tab context menu with Rename / Close / Close others / Close all (DesignTabs.tsx:278-300)
  - actual: Design tabs: the generic app context menu 'OpenPCB — Settings Ctrl+,' opens instead of the tab menu, so Rename/Close/Close others/Close all are unreachable (no other entry point for Close others/Close all). Outline rows (Parts/Nets/Labels): the row menu (Frame/Rename/Duplicate/Delete) AND the app 'OpenPCB / Settings' menu open at the same time, overlapping (4/4 attempts).
  - code: `src/core/frontend/src/AppShell.tsx:36` capture-phase document contextmenu listener preventDefault()s every event
  - code: `src/core/frontend/src/AppShell.tsx:63` grid onContextMenu opens the app menu unconditionally (no defaultPrevented check)
  - code: `src/modules/designer/frontend/components/DesignTabs.tsx:193` Radix ContextMenuTrigger; its handler is skipped because defaultPrevented is already true
  - code: `src/modules/designer/frontend/components/OutlinePanel/OutlineRow.tsx:75` handleContextMenu preventDefault without stopPropagation, so the grid handler also runs
- Q5-016 repro: Open 'LED Indicators 5V' → 3D → Press right mouse button on the board, drag ~80 px, release
  - expected: Right-drag pans the camera (it does) and no menu appears; a context menu only on a right-click without movement, and one with 3D-relevant items (camera presets, snapshot).
  - actual: Camera pans, then on release the global app context menu (data-testid=app-context-menu, only item 'Settings Ctrl+,') opens over the board. The 3D canvas does not suppress contextmenu after a drag and offers no 3D items.
  - code: `src/core/frontend/src/AppShell.tsx:36` global contextmenu handler
  - code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:756` Canvas has no onContextMenu preventDefault
- Q9-027 repro: Docs > QA-q9-B, right-click on the word 'Heading_2' in the editor (or on a misspelled, red-underlined word)
  - expected: Native/text context menu with Cut, Copy, Paste, Select all and spell-check suggestions inside contenteditable/inputs
  - actual: data-testid=app-context-menu opens with a single item 'Settings Ctrl+,'. Text editing via mouse (paste from context menu, accept spelling suggestion — the editor does show spell-check squiggles) is impossible. Same in the title and search inputs.
  - code: `src/core/frontend/src/AppShell.tsx:36` global contextmenu handler preventDefault everywhere
- Q2-026 repro: macOS: right-click anywhere in the app shell → Menu item 'Settings  Ctrl+,'
  - expected: ⌘, on macOS (Ctrl+, elsewhere), matching '⌘/Ctrl+I' hints elsewhere.
  - actual: Hard-coded 'Ctrl+,' (navigator.platform MacIntel).
  - code: `src/core/frontend/src/AppShell.tsx:77` shortcut: 'Ctrl+,'

## T-005 [S3] When the OS theme changes while the schematic is open (Appearance = System, the default), the canvas keeps the previous palette: parts go invisible on light, or a glaring white sheet appears in dark

- Area cross-cutting · category visual · estimate XS · findings F2C-005
- Summary: Dark → light (live): the background switches to #f0f4fb, but parts and wires keep the dark palette. Body is #030303 (black box), outlines #d9dbde (1.26:1 on the bg, so R1/C1/J1 are practically invisible), wire #a6b2c1 (1.95:1). Light → dark (live): the canvas turns into a bright #f5f5f0 sheet with light-palette parts inside the dark shell (17:1 against the surrounding chrome). The zoom cluster also stays in the old…
- Root cause: `src/core/frontend/src/providers/ThemeProvider.tsx:49` — system-change path calls setMode(nextMode); applyThemeClass runs later in a useEffect, so during that render <html data-color-mode> still holds the old mode
- Proposed fix: ThemeProvider: applyThemeClass before setMode on system theme change; D2/D3 pass themeMode to EdaCanvas. — Detail: ThemeProvider.tsx:48-51: inside the subscribeToSystemTheme callback call applyThemeClass(nextMode) before setMode(nextMode), so the <html data-color-mode> read by EdaCanvas (r3f-eda-canvas EdaCanvas.js:10-19) is current during the re-render. Additionally pass themeMode={mode} from useTheme() to <EdaCanvas> in SchematicCanvas.tsx:3264 (and PcbCanvas), as ComponentDetailPage.tsx:590 already does, so palette and background come from React state.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2c/light/059-system-live-light-schem.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2c/dark/226-system-dark-baseline-schem.png
- F2C-005 repro: Settings › General › Appearance = System (the default when no preference is stored) → Open QA-f2c-board › Schem (parts + one wire), Fit schematic → Change the OS appearance (QA: page.emulateMedia({colorScheme:'light'}) then 'dark'), do not touch the canvas → Pixel-probe canvas bg, wire, part body and outline. Compare with a fresh reload in the same theme
  - expected: The whole schematic re-themes with the shell, identical to a fresh load in that theme (light: bg #f0f4fb, wire #3e506b, body #dbdbd9, outline #020616).
  - actual: Dark → light (live): the background switches to #f0f4fb, but parts and wires keep the dark palette. Body is #030303 (black box), outlines #d9dbde (1.26:1 on the bg, so R1/C1/J1 are practically invisible), wire #a6b2c1 (1.95:1). Light → dark (live): the canvas turns into a bright #f5f5f0 sheet with light-palette parts inside the dark shell (17:1 against the surrounding chrome). The zoom cluster also stays in the old style. The stale palette stays until something re-renders the scene; any click on the canvas fixes it. Switching through Settings › Light/Dark is fine, because the designer unmounts while Settings is open. Library list/detail, portalled menus and Docs re-theme correctly on the same live switch. The PCB canvas is identical in both themes anyway (Q4-038).
  - code: `src/core/frontend/src/providers/ThemeProvider.tsx:49` system-change path calls setMode(nextMode); applyThemeClass runs later in a useEffect, so during that render <html data-color-mode> still holds the old mode
  - code: `node_modules/@openpcb/r3f-eda-canvas/dist/interaction/EdaCanvas.js:10` themeMode='auto' reads document.documentElement.dataset.colorMode at render time → resolves the stale mode
  - code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:3264` EdaCanvas gets backgroundColor from useTheme() but no themeMode prop, so bg and palette come from different sources
  - code: `src/core/frontend/src/lib/theme.ts:67` updateThemePreference applies the class synchronously (why the Settings path works); subscribeToSystemTheme (:75) only calls back
  - code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:941` canvasBackground is undefined in dark, so EdaCanvas falls back to getDefaultCanvasBackground(staleMode) → the #f5f5f0 sheet

## T-025 [S3] Menus use three recipes (app context menu 28px/panel bg vs kit 22px/menu-bg vs toolbar dropdowns)

- Area shell · category consistency · estimate S · findings Q1-007, Q11-012, Q3-034, F1B-024
- Summary: App context menu (also used by schematic/PCB canvas menus via data-scope): bg rgb(17,17,19)=--surface-panel, item height 28px, font 12px, title 11px, hover bg-surface-hover. Kit dropdown: bg rgb(28,28,31)=--menu-bg, item 22px, font 11px. The two menu families look different side by side. | Also covers: Q11-012: Menus/popovers use three different recipes: kit dropdown (22px items, --menu-bg) vs app c…; Q3-034: Canvas context menus use off-kit styling (28 px rows, shadow-lg, panel bg) and show 'Ctrl…; F1B-024: Schematic Outline row 'Actions' menu uses a fourth menu recipe (bg-surface-raised grey, b…
- Root cause: `src/core/frontend/src/components/AppContextMenu.tsx:155` — bg-surface-panel, py-1.5; items px-3 py-1.5 text-sm
- Proposed fix: Restyle AppContextMenu to kit menu tokens (menu-bg, 22px items, 11px); clamp to viewport; D3/D2 move toolbar + outline row menus to kit DropdownMenu. — Detail: AppContextMenu.tsx:155: 'bg-menu-bg border-menu-border p-1' ; items (:193) 'h-[22px] px-2 text-xs rounded-control' with focused/hover 'bg-menu-highlight text-text-strong', shortcut 'text-2xs text-text-tertiary', title/group label like DropdownMenuLabel; set ITEM_HEIGHT (:6) to 22 and PADDING_Y to 4.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq1/dark/010-ctx-empty.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q11/light/menu-home-sort.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq11/dark/040-menu-pcb-add.png
- Q1-007 repro: Home: right-click empty area → app context menu → Then click the sort button 'Modified' → kit dropdown menu → Compare computed styles
  - expected: All menus share the kit menu tokens: bg --menu-bg, border --menu-border, 22px items, 11px text, --menu-highlight hover.
  - actual: App context menu (also used by schematic/PCB canvas menus via data-scope): bg rgb(17,17,19)=--surface-panel, item height 28px, font 12px, title 11px, hover bg-surface-hover. Kit dropdown: bg rgb(28,28,31)=--menu-bg, item 22px, font 11px. The two menu families look different side by side.
  - code: `src/core/frontend/src/components/AppContextMenu.tsx:155` bg-surface-panel, py-1.5; items px-3 py-1.5 text-sm
  - code: `src/shared/frontend/ui/dropdown-menu.tsx:46` kit: bg-menu-bg border-menu-border; items h-[22px] text-xs
- Q11-012 repro: Open Home sort ('Modified ▾') and a design's '…' menu → Right-click a design tab / the PCB canvas / the schematic canvas → Open PCB toolbar 'Add ▾' and 'View ▾'
  - expected: All menus share the kit DropdownMenu/ContextMenu look: --menu-bg, --menu-border, 22px items, 11px text, 4px padding, --menu-highlight.
  - actual: Light: kit dropdown (Home sort/more) bg #ffffff (--menu-bg), border --menu-border, radius 3px, pad 4px, items 22px/11px. App context menu (design tab, PCB canvas, schematic canvas) bg #f7f7f8 (--surface-panel), pad 6px 0, items 28px/12px (text-sm), full-bleed highlight. PCB 'Add'/'View' dropdowns bg #e2e2e5 (--surface-raised), items 23px/11px, pad 0, no role=menu. Dark: kit #1c1c1f with border rgb(35,35,38) vs PCB dropdown border rgb(30,30,33); context-menu items 28px/12px in both themes. Three visibly different menu densities in one editor.
  - code: `src/core/frontend/src/components/AppContextMenu.tsx:193` items px-3 py-1.5 text-sm (28px); container :155 bg-surface-panel py-1.5
  - code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:46` Add/View dropdown container: absolute div bg-surface-raised, no menu role
  - code: `src/shared/frontend/ui/dropdown-menu.tsx:68` kit item h-[22px] text-xs
- Q3-034 repro: Right-click a part or empty canvas in the schematic → Measure a menu item; compare with the kit ContextMenu (22 px rows, --menu-bg) used elsewhere
  - expected: Kit menu metrics (22 px rows, --menu-bg/--menu-border, no heavy shadow) and platform-correct shortcut labels (⌘A on macOS, as the toolbar uses ⌘/Ctrl)
  - actual: Items are 28 px tall (py-1.5), menu uses bg-surface-panel + shadow-lg; empty-canvas menu lists 'Select all  Ctrl+A' on macOS while the toolbar/palette say ⌘K.
  - code: `src/core/frontend/src/components/AppContextMenu.tsx:155` bg-surface-panel py-1.5 shadow-lg; item px-3 py-1.5 text-sm
  - code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:2892` shortcut: 'Ctrl+A' hard-coded
- F1B-024 repro: QA-f1b-long → Schem → Outline → hover a part row → click '…' (Actions) → Compare with BOM → Export ▾ in the same theme
  - expected: All dropdowns use the kit DropdownMenu recipe (bg-menu-bg, border-menu-border, 22 px items).
  - actual: Outline Actions: class 'min-w-[9rem] rounded-float border border-border bg-surface-raised py-1 shadow-lg', computed bg rgb(226,226,229) and 24 px items; BOM Export ▾: 'bg-menu-bg border-menu-border p-1' → #ffffff in light. In dark both tokens resolve to #1c1c1f so the drift is only visible in light. Additional instance of the menu-recipe drift in Q11-012 (kit dropdown vs context menu vs PCB Add/View).

## T-082 [S3] Designer toast is off-token (raw red/amber, backdrop-blur, shadow), has no role/aria-live, lasts only 3 s even for errors and covers header controls

- Area designer.shell · category a11y · estimate S · findings F1A-009 · known K10
- Summary: Container and items have no role or aria-live, so screen readers never announce them. Classes are 'rounded-md border … shadow-sm backdrop-blur border-red-300 bg-red-50 text-red-700 dark:bg-red-950 …' (computed backdrop-filter blur(8px), box-shadow 0 1px 3px). Pixel probes: dark error bg #460809 (ΔE 25.7 vs --status-danger-soft), dark warning bg #461901 (ΔE 23.9 vs --status-warning-soft), light error bg #fef2f2 (red-…
- Root cause: `src/modules/designer/frontend/hooks/use-toast.tsx:81` — raw palette + shadow-sm + backdrop-blur, no role/aria-live
- Proposed fix: Rebuild use-toast on kit Toast: tokens, role=status/alert + aria-live, errors persist until dismissed, positioned below header controls. — Detail: Replace ToastViewport with the shared kit notice (or port Library's NoticeViewport): bg-surface-raised with border-status-danger and a text-status-* accent, no blur or shadow, role='status' (role='alert' for errors) on an aria-live region, a 20 px IconButton close, errors sticky until dismissed and others ~5 s. Place it below the header (top: 34px + 8px) or bottom-right above the status bar. Prefix messages with the action ('Couldn't place Capacitor: …').
- Depends on: ['T-004']
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1a/dark/110-k10-error-toast-1440.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1a/dark/110-k10-error-toast-1440.png
- F1A-009 repro: Error toast: route '**/library/components/*/placement' → 500; Schematic Cmd+K, type 'Capacitor', Enter (Space.tsx:698) → Warning toast: BOM line whose refs have no placementId (mocked GET /bom), inspector 'PCB' (Space.tsx:895) → Inspect the toast DOM, time its lifetime, probe colours in both themes, repeat at 1100×720
  - expected: Kit notice: token colours (--status-danger / --status-danger-soft), no blur or shadow, role=status or alert with aria-live, errors persist until dismissed, a ≥20 px dismiss target, and placement clear of header controls.
  - actual: Container and items have no role or aria-live, so screen readers never announce them. Classes are 'rounded-md border … shadow-sm backdrop-blur border-red-300 bg-red-50 text-red-700 dark:bg-red-950 …' (computed backdrop-filter blur(8px), box-shadow 0 1px 3px). Pixel probes: dark error bg #460809 (ΔE 25.7 vs --status-danger-soft), dark warning bg #461901 (ΔE 23.9 vs --status-warning-soft), light error bg #fef2f2 (red-50) and light warning #fffbeb (amber-50). Both auto-dismiss after ~3.05 s, including errors. The '×' button is named 'Dismiss' but is a 7×15 px glyph in raw slate-400. At top-right it covers 'Assistant', 'Toggle side panel' and 'ERC' (1440), plus the BOM inspector's 'Show in schematic' / 'PCB' links the user just clicked. At 1100 it covers 'Assistant' and 'Toggle side panel'. The error text is the raw problem title 'Internal error' with no mention of the failed part placement.
  - code: `src/modules/designer/frontend/hooks/use-toast.tsx:81` raw palette + shadow-sm + backdrop-blur, no role/aria-live
  - code: `src/modules/designer/frontend/hooks/use-toast.tsx:32` default duration 3000 ms for every variant, including error
  - code: `src/modules/designer/frontend/hooks/use-toast.tsx:77` fixed right-3 top-3 overlays the 34 px header controls

## T-028 [S4] No favicon: /favicon.ico 404 on every load (tab shows the generic icon)

- Area shell · category console · estimate XS · findings Q1-025
- Summary: [ERROR] Failed to load resource: 404 /favicon.ico; index.html has no <link rel=icon>.
- Root cause: `src/core/frontend/index.html:6` — no <link rel=icon>
- Proposed fix: Add favicon (index.html + public/) — also silences the 404 console noise. — Detail: Add src/core/frontend/public/favicon.svg (electron/openpcb_icon.svg already exists) and <link rel="icon" href="/favicon.svg"> in index.html:6.
- Evidence: console: [ERROR] Failed to load resource: 404 @ http://127.0.0.1:1520/favicon.ico
- Q1-025 repro: Open http://127.0.0.1:1520 and read the console
  - expected: index.html links an app icon.
  - actual: [ERROR] Failed to load resource: 404 /favicon.ico; index.html has no <link rel=icon>.
  - code: `src/core/frontend/index.html:6` no <link rel=icon>
