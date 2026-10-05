# Fix brief — owner F0a

13 approved triage entries. Entries marked **shared** are co-owned: implement ONLY the part that lives in your owned files; the lead owner is listed. Screenshot paths are absolute (open with the Read tool for layout only).

## T-002 [S2] No shared shortcut guard: global hotkeys fire while typing, behind modals and inside menus

- Area cross-cutting · category keyboard · estimate S · findings  · known K12
- Summary: Infra entry; adopters: K12 PCB keymap (D3), Home N (C1), Settings Esc (C2), wizard Esc (L2), schematic keymap (D2).
- Root cause: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` — Keymaps check only <input>; no shared editable/modal/menu guard
- Proposed fix: Add src/shared/frontend/keyboard/shortcut-guard.ts: isEditableTarget (input/textarea/select/contenteditable), isModalOpen (aria-modal/role=dialog/menu), modifier filtering; export useGlobalShortcut().
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q4/dark/094-comment-typing.png

## T-004 [S3] Kit primitive set missing (Input/NumberInput/Select/Switch/RadioGroup/Toast/Spinner/Kbd/ErrorBoundary) — root of hand-rolled controls

- Area cross-cutting · category consistency · estimate M · findings  · known K37,K45
- Summary: Infra entry derived from K37/K45 + user decision 'full consistency depth'; unblocks every area migration entry.
- Root cause: `src/shared/frontend/ui/:None` — No Input/NumberInput/Select/Switch/RadioGroup/Toast/Spinner/Kbd/ErrorBoundary primitives; surfaces hand-roll controls
- Proposed fix: Add kit primitives Input, NumberInput, Select, Switch, RadioGroup, Checkbox (22/20px), Toast, Spinner, Kbd, ErrorBoundary in src/shared/frontend/ui; document sizes in tokens doc.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q2/dark/003b-theme-system-crop.png, census/settings-assistant-provider-dark-1440.json

## T-006 [S3] Raw 'HTTP 500' / 'Internal error' / 'Failed to fetch' shown to users (42 sites) — no shared error-message mapper

- Area cross-cutting · category error-handling · estimate S · findings Q10-004 · known K40
- Summary: Designer toast (3 s, red, covers the header's Open from Cloud / sync badge / Assistant / panel toggle): 'Cloud sync failed: Unable to connect. Is the computer able to access the url?'. Auto-route panel: 'Unable to connect. Is the computer able to access the url?' with only a 'Cancel' button (no retry). Auto-place panel: same text, no footer buttons at all (only ×). Open from Cloud: 'Failed to fetch'. Library: the Sy…
- Root cause: `src/core/frontend/src (42 sites):None` — Each surface renders problem.title / `HTTP ${status}` / fetch error text directly
- Proposed fix: Add src/shared/frontend/http/problem.ts: map RFC7807/HTTP/network (Failed to fetch, Bun 'Unable to connect') to user copy + retryable flag; kit Banner/inline error with Retry. — Detail: Add one backend helper (e.g. src/core/backend/http/cloud-fetch.ts) that wraps cloud fetches and converts network errors/timeouts into AppError 503 type https://openpcb.dev/problems/cloud-unreachable with a fixed friendly title; use it in designer autoroute/autoplace/cloud-sync, library cloud-sync, assistant cloud-context. Frontend: map that type to a shared 'Can't reach OpenPCB Cloud' string + Retry; CloudLibrarySyncButton must keep its label and show errors in a tooltip/notice; Auto-route error state should say C…
- Depends on: ['T-004']
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q10/dark/042-C1-designer-cloudsync-failed-toast.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq10/dark/034-designer-cloudsync-toast.png
- Q10-004 repro: Stack C1 (cloud URLs dead), signed in (simulated session) → Designer: open 'Dual LED Blinker' → toast → PCB → 'Route Board…'; then 'Auto Place…' → Designer header → 'Open from Cloud' → Library → 'Sync to Cloud', then the pull (cloud-download) button → Assistant → New chat → provider 'OpenPCB Cloud' → send a message
  - expected: One consistent, friendly offline message (e.g. 'Can't reach OpenPCB Cloud — you're offline or the service is down. Your local work is unaffected.') with a Retry action; raw runtime strings only in logs.
  - actual: Designer toast (3 s, red, covers the header's Open from Cloud / sync badge / Assistant / panel toggle): 'Cloud sync failed: Unable to connect. Is the computer able to access the url?'. Auto-route panel: 'Unable to connect. Is the computer able to access the url?' with only a 'Cancel' button (no retry). Auto-place panel: same text, no footer buttons at all (only ×). Open from Cloud: 'Failed to fetch'. Library: the Sync button's own label turns into red 'HTTP 500' (its accessible name becomes 'HTTP 500'; the server's detail is discarded) and stays that way. Assistant (OpenPCB Cloud provider): 'Assistant paused before completing. OpenPCB Cloud workspace resolution failed (Unable to connect. Is the computer able to access the url?).' — 'paused' is wrong, it failed. Backend returns generic 500 internal-error problem documents for all of these.
  - code: `src/modules/designer/backend/autoroute/client.ts:34` fetch() rejection propagates as generic 500
  - code: `src/modules/library/backend/cloud-sync.ts:66` resolvePersonalWorkspace fetch error → 500
  - code: `src/modules/library/frontend/components/CloudLibrarySyncButton.tsx:58` throw new Error(`HTTP ${res.status}`) then renders it as the button label
  - code: `src/modules/designer/frontend/components/CloudSyncBadge.tsx:83` toast shows err.message verbatim
  - code: `src/modules/designer/frontend/pcb/PcbAutorouteDialog.tsx:137` message = e.message; error phase only offers Cancel; error block at :304
  - code: `src/modules/designer/frontend/pcb/PcbAutoplaceDialog.tsx:193` error phase has no footer / retry

## T-007 [S3] No visible keyboard focus on kit controls; non-kit controls show UA blue ring

- Area cross-cutting · category a11y · estimate M · findings Q11-001, Q11-002, Q11-003, Q1-012 · known K34
- Summary: Computed style on focus-visible = 'outline: none 1px rgb(8,145,178)' (light) / 'none 1px rgb(51,209,255)' (dark): width and colour are applied but style is none. Generated CSS: `.outline-none{--tw-outline-style:none;outline-style:none}` and `.focus-visible\:outline:focus-visible{outline-style:var(--tw-outline-style);outline-width:1px}` → the variable is 'none'. Affects every schematic toolbar tool (Fit, Place compon… | Also covers: Q11-002: Kit tabs, dock tabs, segmented controls, section-header toggles, primary/ghost buttons, H…; Q11-003: Non-kit controls fall back to the browser's default blue focus ring (#005fcc light / #99c…; Q1-012: No visible keyboard focus on Home filter buttons, star toggles, '…' More-actions triggers…
- Root cause: `src/shared/frontend/ui/toolbar.tsx:58` — '… transition-colors outline-none' + line 59 'focus-visible:outline focus-visible:outline-1 … outline-selection'
- Proposed fix: Remove outline-none that cancels focus-visible in ToolbarButton/IconButton; add token focus ring to Tabs, DockTabs, SegmentedControl, Chip, StatusSegment, PanelSectionHeader, Button; global :focus-visible token rule in index.css replaces UA blue ring. — Detail: In src/shared/frontend/ui/toolbar.tsx:59, icon-button.tsx:40 and canvas-zoom-cluster.tsx:14 replace `focus-visible:outline` with `focus-visible:outline-solid` (keep outline-1 / -outline-offset-1 / outline-selection). Do NOT switch to `outline-hidden`: in the installed Tailwind 4.3.0 it also sets --tw-outline-style:none, so it would not fix this. Add a DOM test that asserts outlineStyle !== 'none' on :focus-visible for kit buttons.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q11/light/focus2-montage-pcb-light.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq11/dark/002-pcb-route-focused-crop.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q11/light/focus2-montage-home-lib-light.png
- Q11-001 repro: Open GUIDE-VALIDATE (b5a31f3e) → PCB tab → Click the empty toolbar strip, then press Tab until 'Route (R)' (or any toolbar icon button, 'Zoom in', header 'Toggle side panel') is focused → Observe no focus indicator; in DevTools getComputedStyle(document.activeElement).outlineStyle === 'none'
  - expected: Kit ToolbarButton/IconButton/CanvasZoomCluster were given a 1px --selection focus-visible outline (PLAN Run 2 commit 590aebb 'focus rings on ToolbarButton/IconButton'); it should be visible on keyboard focus.
  - actual: Computed style on focus-visible = 'outline: none 1px rgb(8,145,178)' (light) / 'none 1px rgb(51,209,255)' (dark): width and colour are applied but style is none. Generated CSS: `.outline-none{--tw-outline-style:none;outline-style:none}` and `.focus-visible\:outline:focus-visible{outline-style:var(--tw-outline-style);outline-width:1px}` → the variable is 'none'. Affects every schematic toolbar tool (Fit, Place component, GND, PWR, Portal, Comment, ERC), every PCB toolbar tool (Undo, Redo, Fit board, Flip part, Route, Board, Add, Export…, DRC, View), all kit IconButtons (header 'Toggle side panel', Home/Library 'More actions', 'Component actions') and the Zoom in/out/fit cluster on both canvases.
  - code: `src/shared/frontend/ui/toolbar.tsx:58` '… transition-colors outline-none' + line 59 'focus-visible:outline focus-visible:outline-1 … outline-selection'
  - code: `src/shared/frontend/ui/icon-button.tsx:39` same pattern (lines 39-40)
  - code: `src/shared/frontend/ui/canvas-zoom-cluster.tsx:14` same pattern
- Q11-002 repro: On each main screen press Tab ~40 times from page start (tab walks recorded in census/q11/tab-*.json) → Watch the focused element: e.g. Home 'Grid' view toggle, 'New design' (primary), 'Recent' filter; Designer view tab 'PCB'; dock tab 'DRC'; PCB 'Dim'; Library 'New part', facet header 'Family', a grid card
  - expected: Every focusable control shows a visible focus indicator (WCAG 2.4.7), consistently styled.
  - actual: No computed style difference between focused and unfocused state (tab-walk probe compares against an unfocused clone) for: view tabs Schem/PCB/3D/BOM/DRC; dock tabs Properties/ERC/DRC/Assistant; segmented controls Home List/Grid, Library Table/Grid, BOM All/Missing MPN/DNP, Outline Parts/Nets/Labels, PCB Normal/Dim/Hide; PanelSectionHeader toggles (Library facets Source/Family/Mount/Package/Other, PCB 'Layers'); primary buttons Home 'New design', Library 'New part', Outline 'Place component', DRC 'Run DRC', detail 'Duplicate to edit', Designer-empty 'New design'; ghost/text buttons Home filters All/Recent/Starred/Archived, ★ Star, 'More actions', Library 'Show 20 more…', Docs 'Import document'/'New page', BOM 'Export ▾', 'Show in schematic', 'PCB', column sort header; Library grid cards (268×222 buttons); selects 3D 'Lighting scene', BOM 'Order quantity'. Secondary buttons and inputs DO 
  - code: `src/shared/frontend/ui/segmented-control.tsx:58` outline-none, no focus-visible style
  - code: `src/shared/frontend/ui/tabs.tsx:30` TabsTrigger (designer view tabs) outline-none only
  - code: `src/shared/frontend/ui/dock-tabs.tsx:54` outline-none only
  - code: `src/shared/frontend/ui/panel-section-header.tsx:82` toggle button outline-none
  - code: `src/shared/frontend/ui/chip.tsx:18` outline-none
  - code: `src/shared/frontend/ui/status-bar.tsx:51` outline-none
- Q11-003 repro: Press Tab from page start on any screen: the rail (Home…Assistant, bug link, Settings) is focused first → Continue into PCB Layers rows, Settings nav rows, 3D panel buttons, DRC rows, Assistant chat rows → Compare with kit secondary buttons (e.g. Home 'Import KiCad…') and search fields
  - expected: One app-wide focus treatment on tokens (e.g. 1px --selection outline) — the redesign bans blue casts.
  - actual: Four different focus treatments co-exist: (1) Chromium UA `outline: auto` rounded blue ring — pixel #005fcc in light (ΔE 30.4 from nearest token --status-info) and #99c8ff in dark (ΔE 12.2) on rail items, Settings Back/nav rows/theme buttons, PCB layer rows + opacity/eye buttons + 'Collapse group'/'Show all'/preset, 3D camera/display/colour buttons, DRC group headers/violation rows/severity toggles, Assistant chat rows/filters/New/collapse, design-tab close and '+' New design, header 'Open the assistant'; (2) 1px cyan --selection border on kit secondary buttons and SearchField wrappers; (3) background tint only (Outline rows, Library table rows rgb(38,38,43)→rgb(28,28,31)); (4) nothing (Q11-001/Q11-002).
  - code: `src/core/frontend/src/index.css:10` token doc says the selection cyan is THE focus-ring colour, but there is no global :focus-visible rule, so the UA ring shows wherever a component doesn't set outline-none
  - code: `src/core/frontend/src/components/LeftSidebar.tsx:95` navButtonClass(): no focus style → UA ring
- Q1-012 repro: Home; Tab through the page → Watch the focused element for each stop (filters, Star, More actions, List/Grid)
  - expected: Every focus stop shows a clear focus-visible indicator (e.g. 1px --selection ring/border like kit Button).
  - actual: Computed style at :focus-visible for Star, More actions, All/Recent/Starred/Archived filters, List and Grid: outline none, box-shadow none, no background change → focus is invisible (compare Import KiCad… which gets a cyan border, and rail items which fall back to the browser outline).
  - code: `src/core/frontend/src/screens/home/HomeSidebar.tsx:91` filter buttons outline-none, no focus-visible style
  - code: `src/core/frontend/src/screens/home/DesignCard.tsx:180` StarButton outline-none
  - code: `src/core/frontend/src/screens/home/DesignCard.tsx:114` More actions trigger outline-none
  - code: `src/shared/frontend/ui/segmented-control.tsx:58` option buttons outline-none with no focus-visible replacement (K34)

## T-008 [S3] Hover-revealed row actions receive keyboard focus while fully transparent (opacity 0) — focus disappears

- Area cross-cutting · category a11y · estimate XS · findings Q11-004
- Summary: The focused element has effective opacity 0 — focus is invisible and the user can't tell what Enter will do (e.g. DRC waive, Docs delete). Measured op=0 for: Outline row 'Actions' (tab-schematic i27/29/31/33), Assistant 'Chat actions for QA-q8-main' (tab-assistant i17/20/23/26/29), DRC 'Waive (accept)' (tab-drc i18/21/23/25/27/29), Docs 'Add subpage'/'Delete' (tab-docs i12-22). Also the close X of inactive design ta…
- Root cause: `src/modules/designer/frontend/components/OutlinePanel/OutlineRow.tsx:159` — opacity-0 … group-hover:opacity-100
- Proposed fix: Add .row-actions utility (opacity-0 group-hover/focus-within:opacity-100) in index.css; adopters OutlineRow (D2), Docs TreeItem (K1), Assistant chat rows (A1). — Detail: Add `group-focus-within:opacity-100 focus-visible:opacity-100` (and the same for the wrapper in TreeItem) to each hover-reveal class list.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q11/dark/focus-schem-outline-actions-invisible.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq11/dark/005-outline-actions-focused.png
- Q11-004 repro: Open GUIDE-VALIDATE → Schem; Tab into the Outline list: after row 'C1 Capacitor' the next stop is its 'Actions' button → Same on DRC view ('Waive (accept)' after each violation), Assistant chat list ('Chat actions for …'), Docs page tree ('Add subpage', 'Delete')
  - expected: Actions revealed on hover must also become visible on keyboard focus (focus-within/focus-visible).
  - actual: The focused element has effective opacity 0 — focus is invisible and the user can't tell what Enter will do (e.g. DRC waive, Docs delete). Measured op=0 for: Outline row 'Actions' (tab-schematic i27/29/31/33), Assistant 'Chat actions for QA-q8-main' (tab-assistant i17/20/23/26/29), DRC 'Waive (accept)' (tab-drc i18/21/23/25/27/29), Docs 'Add subpage'/'Delete' (tab-docs i12-22). Also the close X of inactive design tabs uses the same pattern.
  - code: `src/modules/designer/frontend/components/OutlinePanel/OutlineRow.tsx:159` opacity-0 … group-hover:opacity-100
  - code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:430` Waive button opacity-0 group-hover:opacity-100
  - code: `src/modules/assistant/frontend/Space.tsx:1328` chat row actions opacity-0 group-hover:opacity-100
  - code: `src/modules/knowledge/frontend/components/Sidebar/TreeItem.tsx:209` row actions wrapper opacity-0 group-hover:opacity-100
  - code: `src/modules/designer/frontend/components/DesignTabs.tsx:267` inactive tab close 'opacity-0 group-hover:opacity-80'

## T-014 [S3] Modal surfaces use four recipes; no kit confirm/prompt helpers (enables native-dialog removal)

- Area cross-cutting · category consistency · estimate M · findings Q11-013 · known K06
- Summary: Kit Dialog: overlay black/50, panel --surface-panel, shadow-xl. PCB Design rules & Export: overlay black/40, panel --surface-raised (#e2e2e5 light / rgb(28,28,31) dark), shadow-2xl '0 25px 50px -12px rgba(0,0,0,.25)', title 'Design rules' 12px/600. Power-port picker: overlay black/50, --surface-raised, shadow-lg, p-3. Cmd+K: --surface-raised, shadow-lg. Home delete: overlay black/50, --surface-raised, shadow-lg, tit…
- Root cause: `src/core/frontend/src/components/ui/dialog.tsx:47` — kit: bg-surface-panel shadow-xl, overlay :27 bg-black/50
- Proposed fix: One kit Dialog recipe (overlay 50%, surface-panel, no heavy shadow, 12/600 title) with focus trap + restore; add confirmDialog()/promptDialog() helpers for K02–K06 migrations. — Detail: Port these to the kit Dialog (also fixes Q11-005) and standardise titles to sentence case 12px/500.
- Depends on: ['T-014']
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q11/light/dlg2-pcb-rules-open.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq11/dark/010-dlg-pcb-rules.png
- Q11-013 repro: Open (and cancel) PCB 'Edit rules…', PCB 'Export…', Schem 'Place power port', Cmd+K palette, Home '…' → Delete
  - expected: One dialog recipe (kit Dialog: bg-black/50 overlay, --surface-panel, border, rounded-float, one shadow level, 12–13px/500 title, sentence case).
  - actual: Kit Dialog: overlay black/50, panel --surface-panel, shadow-xl. PCB Design rules & Export: overlay black/40, panel --surface-raised (#e2e2e5 light / rgb(28,28,31) dark), shadow-2xl '0 25px 50px -12px rgba(0,0,0,.25)', title 'Design rules' 12px/600. Power-port picker: overlay black/50, --surface-raised, shadow-lg, p-3. Cmd+K: --surface-raised, shadow-lg. Home delete: overlay black/50, --surface-raised, shadow-lg, title 'Delete Design' 12px/500 in Title Case (others sentence case).
  - code: `src/core/frontend/src/components/ui/dialog.tsx:47` kit: bg-surface-panel shadow-xl, overlay :27 bg-black/50
  - code: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:286` bg-black/40, :291 bg-surface-raised shadow-2xl
  - code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:178` bg-surface-raised shadow-2xl
  - code: `src/core/frontend/src/screens/HomeScreen.tsx:58` shadow-lg, 'Delete Design'

## T-016 [S3] Radius flattening leaks: bare `rounded` still renders 4px, Assistant bubbles 10px, and rounded-full pills are used for non-status labels that are square elsewhere

- Area cross-cutting · category visual · estimate S · findings Q11-015
- Summary: Generated CSS `.rounded{border-radius:.25rem}` is not covered by the --radius-sm…3xl overrides, so every bare `rounded` renders 4px: 3D camera buttons (22 elements), Assistant chips/badges (11 dark / 16 light), Settings 'Advanced'/'Caution', model pill 'STRICT'; 24 .tsx files use bare `rounded`. Assistant message bubbles use rounded-[10px]. rounded-full pills: Settings 'LOCAL', 'DEFAULT', 'Up to date', 'user', 'core…
- Root cause: `src/core/frontend/src/index.css:35` — --radius-sm…3xl flattened, but bare `rounded` (0.25rem) is not
- Proposed fix: Override --radius (bare `rounded`) to 2px in index.css @theme; A1/A2 drop 10px bubble radii; restrict rounded-full to status dots. — Detail: In src/core/frontend/src/index.css @theme add `--radius: 2px;`. Tailwind 4.3's bare `rounded` utility reads the `--radius` theme key (themeKeys:['--radius']) and today falls back to 0.25rem, so this one line flattens all 26 files using bare `rounded`. Replace MessageCard.tsx:383 `rounded-[10px_10px_2px_10px]` with rounded-control, and move non-status rounded-full badges (Settings 'Up to date'/'user'/'core'/'read-only'/'LOCAL'/'DEFAULT', assistant filter pills, GenericProposalCard) onto the kit Chip.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q11/light/007-3d-1440.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq11/light/062-3d.png
- Q11-015 repro: Inspect 3D camera buttons, Assistant chat chips/bubbles, Settings → Assistant/Libraries badges; compare Library 'core'/'user' badges
  - expected: D1: controls 2px, floats 3px, pills only for status pills.
  - actual: Generated CSS `.rounded{border-radius:.25rem}` is not covered by the --radius-sm…3xl overrides, so every bare `rounded` renders 4px: 3D camera buttons (22 elements), Assistant chips/badges (11 dark / 16 light), Settings 'Advanced'/'Caution', model pill 'STRICT'; 24 .tsx files use bare `rounded`. Assistant message bubbles use rounded-[10px]. rounded-full pills: Settings 'LOCAL', 'DEFAULT', 'Up to date', 'user', 'core', 'read-only', Assistant filters 'All 12' etc., 'BEST' — while Library shows the same 'core'/'user' source as square badges and the Library detail 'CORE' badge is 2px.
  - code: `src/core/frontend/src/index.css:35` --radius-sm…3xl flattened, but bare `rounded` (0.25rem) is not
  - code: `src/modules/designer/frontend/three-d/Board3DOverlay.tsx:161` 'rounded px-1 py-1'
  - code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:475` rounded-full 'Up to date'

## T-017 [S3] Status badges and banners are inconsistent: info notes painted as amber warnings, cyan selection colour used as 'success', the same 'core' badge rendered three ways

- Area cross-cutting · category consistency · estimate S · findings Q11-019
- Summary: 'Up to date' (Settings → Libraries) uses --selection cyan text (rgb 8,145,178) in a rounded-full pill instead of a success/status token. 'read-only' is a raw amber pill (oklch amber-100/700). MCP 'Caution' is raw amber-100/amber-700 at 9px with bare `rounded` (4px). The 'core' source badge renders three ways: Library table 9.5px caps text, detail header 2px 'CORE' badge with a lock, Settings 18px rounded-full pill.…
- Root cause: `src/core/frontend/src/settings/panels/GeneralPanel.tsx:19` — DesktopOnlyNote bg-amber-50 text-amber-900
- Proposed fix: Kit Banner (info/warning/danger/success via status tokens) + Badge; info notes neutral, success never cyan --selection. — Detail: Introduce one Badge/Notice on status tokens. LibrariesPanel.tsx:475 'Up to date' → --status-success-soft/-fg Chip (square, 2px). LibrariesPanel 'read-only' and McpSection.tsx:141 'Caution' → --status-warning-soft token Chip at text-2xs. Unify the core/user source badge (LibraryTable.tsx:227, ComponentDetailPage header, LibrariesPanel). Low priority: move GeneralPanel.tsx:17 DesktopOnlyNote to a neutral info tone (browser/dev only).
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q11/light/016-settings-general-1440.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq11/light/060-settings-general.png
- Q11-019 repro: Settings → General / Privacy (desktop-only notes); Settings → Libraries ('Up to date', 'core'); Settings → Assistant MCP ('Caution') → Designer BOM → select C1 (missing MPN banner); Library table 'core'/'user'; Library detail header 'CORE'; Home DRC pills
  - expected: Status tokens only (--status-*-soft/-fg), one Chip/Pill component, info≠warning.
  - actual: 'Up to date' (Settings → Libraries) uses --selection cyan text (rgb 8,145,178) in a rounded-full pill instead of a success/status token. 'read-only' is a raw amber pill (oklch amber-100/700). MCP 'Caution' is raw amber-100/amber-700 at 9px with bare `rounded` (4px). The 'core' source badge renders three ways: Library table 9.5px caps text, detail header 2px 'CORE' badge with a lock, Settings 18px rounded-full pill. BOM 'C1: missing MPN…' uses the correct --status-warning-soft token but at 10px, radius 0, no icon. [vq11] The amber 'Updates are managed by the OpenPCB desktop app.' / 'Local file locations…' notes are browser-only: GeneralPanel renders DesktopOnlyNote only when the Electron bridge is absent, so desktop users never see them.
  - code: `src/core/frontend/src/settings/panels/GeneralPanel.tsx:19` DesktopOnlyNote bg-amber-50 text-amber-900
  - code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:475` rounded-full … text-selection
  - code: `src/core/frontend/src/settings/panels/McpSection.tsx:141` raw amber Caution
  - code: `src/modules/library/frontend/components/LibraryTable.tsx:227` 9.5px source badge

## T-018 [S3] Tab widgets behave three different ways and PCB Layers costs ~40 Tab stops: dock tabs/layer strip lack arrow keys & roving tabindex, view tablist unnamed, design tab tabindex=-1

- Area cross-cutting · category keyboard · estimate M · findings Q11-022
- Summary: View tabs (Radix): roving tabindex + arrows + aria-controls, but the tablist has no aria-label. DockTabs 'Side panel' (Properties/ERC/DRC/Assistant) and PCB layer strip (7 tabs): every tab in the Tab order, no arrow-key support, no aria-controls. Design tab strip: tabs are <div role=tab> without tabIndex (property -1), so open designs are unreachable by keyboard. PCB: stops 21–60 of the tab walk are all inside the L…
- Root cause: `src/shared/frontend/ui/dock-tabs.tsx:49` — plain buttons role=tab, no roving tabindex/keydown handling/aria-controls
- Proposed fix: Roving tabindex + arrow keys in kit Tabs/DockTabs; name the view tablist; D3 collapses PCB Layers panel to one tab stop with arrow navigation. — Detail: Implement roving tabindex + ArrowLeft/Right in DockTabs (or build it on Radix Tabs), name the view tablist ('Designer views'), give the active design tab tabIndex 0, and make the Layers list a single roving-focus listbox (opacity/eye reachable via arrow/shortcut).
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q11/dark/tab-pcb-40.png
- Q11-022 repro: Designer: focus view tab 'Schem', press ArrowRight → moves to PCB (Radix) → Focus dock tab 'Properties', press ArrowRight → nothing happens → Tab through the PCB view from the header
  - expected: All role=tab widgets follow one pattern (roving tabindex, Arrow keys, aria-controls, named tablist); long lists use roving focus so the canvas/dock are reachable quickly.
  - actual: View tabs (Radix): roving tabindex + arrows + aria-controls, but the tablist has no aria-label. DockTabs 'Side panel' (Properties/ERC/DRC/Assistant) and PCB layer strip (7 tabs): every tab in the Tab order, no arrow-key support, no aria-controls. Design tab strip: tabs are <div role=tab> without tabIndex (property -1), so open designs are unreachable by keyboard. PCB: stops 21–60 of the tab walk are all inside the Layers panel (row + opacity + eye per layer, group toggles) before the Components list, zoom cluster or dock.
  - code: `src/shared/frontend/ui/dock-tabs.tsx:49` plain buttons role=tab, no roving tabindex/keydown handling/aria-controls
  - code: `src/modules/designer/frontend/components/DesignTabs.tsx:195` design tab is a <div role=tab> without tabIndex → not focusable

## T-175 [S3] Light theme: status-danger text on the danger-soft box fails AA — export refusal / DRC-gate text #c2402f on #dececf is 3.3:1

- Area designer.pcb · category a11y · estimate XS · findings F2B-013
- Summary: The 12 px error line 'OpenPCB's Gerber export writes at most four copper layers…' and the 'DRC found 230 error(s)…' block render #c34333 (--status-danger #c2402f) on #dececf (--status-danger-soft 12% over --surface-raised #e2e2e5): 3.32:1. The raised dialog surface in light (#e2e2e5) is darker than the app surface, which pulls every tinted status box below AA.
- Root cause: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:224` — border-status-danger bg-status-danger-soft text-status-danger text-xs
- Proposed fix: Light theme: darken --status-danger text or lighten --status-danger-soft so danger text on soft box ≥4.5:1 (same for warning). — Detail: Darken light --status-danger for text use (e.g. a --status-danger-text ≈ #a3301f, ≥4.5:1 on soft tint over surface-raised) or render the message in --text-strong with a red icon/left border.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2b/light/055-6L-export-422.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2b/light/017-6L-export-422.png
- F2B-013 repro: Light theme, stack B, QA-f2b-6L (or QA-f2b-blind / any board with DRC errors) → PCB → Export… → Probe the red error box text vs its background
  - expected: Body text in status boxes ≥ 4.5:1 (12 px text).
  - actual: The 12 px error line 'OpenPCB's Gerber export writes at most four copper layers…' and the 'DRC found 230 error(s)…' block render #c34333 (--status-danger #c2402f) on #dececf (--status-danger-soft 12% over --surface-raised #e2e2e5): 3.32:1. The raised dialog surface in light (#e2e2e5) is darker than the app surface, which pulls every tinted status box below AA.
  - code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:224` border-status-danger bg-status-danger-soft text-status-danger text-xs
  - code: `src/core/frontend/src/index.css:228` light --status-danger #c2402f; line 197 --surface-raised #e2e2e5

## T-264 [S3] Preview 'No symbol/footprint preview' and 'Loading preview…' overlays use un-generated slate classes → bright button-like outline boxes

- Area library.browse · category visual · estimate S · findings Q6-012
- Summary: 'No symbol preview' / 'No footprint preview' render as rounded boxes with a bright #c4c4c9 1px outline on a #131313 canvas — they look like buttons. Cause: the overlay classes (border-slate-700/60, bg-slate-900/55, text-slate-300, rounded-md; loading overlay bg-slate-900 + slate spinner; error boundary red-800/red-950) live in @openpcb/r3f-eda-canvas, which Tailwind does not scan, so the border colour falls back to…
- Root cause: `node_modules/@openpcb/r3f-eda-canvas/dist/preview/PreviewCanvasShell.js:35` — EmptyStateOverlay: border-slate-700/60 bg-slate-900/55 text-slate-300 (alpha variants not generated)
- Proposed fix: Add @source for node_modules/@openpcb/r3f-eda-canvas/dist in index.css so package overlay classes generate; follow-up: package should not depend on host Tailwind. — Detail: In @openpcb/r3f-eda-canvas replace slate/red palette classes with semantic token classes (text-text-tertiary, no box; status-danger for errors) and default backgroundColor to var(--surface-canvas-well); meanwhile add `@source "../../../../node_modules/@openpcb/r3f-eda-canvas/dist"` in index.css so its classes are generated. Show a Retry link in the preview pane on detail errors.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q6/dark/031-preview-detail-500.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq6/dark/008-preview-detail-500.png
- Q6-012 repro: Stack B, Library table → route '**/api/modules/library/components/*/detail' → 500 (or select any part whose detail has no preview) → Select 'Generic Diode' → Pixel-probe the empty-state boxes
  - expected: Muted text on the canvas well (text-tertiary, no box) matching the kit empty states; loading/error overlays on tokens.
  - actual: 'No symbol preview' / 'No footprint preview' render as rounded boxes with a bright #c4c4c9 1px outline on a #131313 canvas — they look like buttons. Cause: the overlay classes (border-slate-700/60, bg-slate-900/55, text-slate-300, rounded-md; loading overlay bg-slate-900 + slate spinner; error boundary red-800/red-950) live in @openpcb/r3f-eda-canvas, which Tailwind does not scan, so the border colour falls back to currentColor. Preview canvases are also hardcoded #131313 (not --surface-canvas-well #08090a / schematic well #101012). The preview pane error itself is a bare 'Internal error' line with header 'Component' and no retry.
  - code: `node_modules/@openpcb/r3f-eda-canvas/dist/preview/PreviewCanvasShell.js:35` EmptyStateOverlay: border-slate-700/60 bg-slate-900/55 text-slate-300 (alpha variants not generated)
  - code: `node_modules/@openpcb/r3f-eda-canvas/dist/preview/PreviewCanvasShell.js:32` CanvasLoadingOverlay 'Loading preview...' bg-slate-900 + slate spinner
  - code: `src/core/frontend/src/index.css:3` @source covers ../../../modules and ../../../shared only
  - code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:138` preview error rendered as bare text, no retry

## T-284 [S3] Light theme: messages inside the always-dark canvas wells use light-theme tokens (dark text, light borders) — low contrast, glaring boxes

- Area library.detail · category visual · estimate S · findings Q6-034
- **shared** with L1; lead: L1
- Summary: 'Converting 3D model…' / 'Loading 3D model metadata…' render text #55555c (light --text-secondary) on #08090a = 2.7:1 inside a bright #cfcfd4 (light --border-control) outline box; the empty-state 'Upload STEP' uses light --primary #1a1a1d on #08090a (invisible edge). The preview-pane canvases are a third black (#131313, hardcoded in the package) next to grid thumbnails on #08090a.
- Root cause: `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:86` — LoadingMessage: border-border-control text-text-secondary on bg-surface-canvas-well
- Proposed fix: Messages inside dark wells use well tokens (F0a adds --text-on-well/--border-on-well). — Detail: Add canvas-overlay tokens (e.g. --canvas-overlay-text/-border) that stay dark-palette in both themes and use them for every message inside wells; pass backgroundColor=var(--surface-canvas-well) to the preview canvases.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q6/light/023-stuck-converting-after-reload.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq6/light/002-dead-upload-step-in-well.png
- Q6-034 repro: Stack B, light theme, open a part whose 3D model is pending ('Converting 3D model…') or missing, or a preview whose detail fails → Pixel-probe the message box inside the canvas well
  - expected: Well overlays use the dark palette (the well is #08090a in both themes) — e.g. a canvas-overlay token set.
  - actual: 'Converting 3D model…' / 'Loading 3D model metadata…' render text #55555c (light --text-secondary) on #08090a = 2.7:1 inside a bright #cfcfd4 (light --border-control) outline box; the empty-state 'Upload STEP' uses light --primary #1a1a1d on #08090a (invisible edge). The preview-pane canvases are a third black (#131313, hardcoded in the package) next to grid thumbnails on #08090a.
  - code: `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:86` LoadingMessage: border-border-control text-text-secondary on bg-surface-canvas-well
  - code: `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:142` empty state text-text-secondary + bg-primary button in the well
  - code: `node_modules/@openpcb/r3f-eda-canvas/dist/preview/FootprintPreviewCanvas.js:17` backgroundColor = '#131313' default

## T-022 [S4] Empty states use six different patterns (icon+text, text-only, bordered card+button, left-aligned stack, rounded box) with no shared component

- Area cross-cutting · category consistency · estimate S · findings Q11-020
- Summary: Home: centred 16px icon + 'No matching designs' + hint, no action (no 'Clear filter'). Library: centred text only ('No components match the current filters.' + 'Import a component to get started' — wrong hint for a search miss). Docs: bordered card, 40px icon, 'No page selected', 'New page' button. Designer: bordered 448px card, 13px/500 title, full-width primary button + 15px-row list. Outline: left-aligned title +…
- Root cause: `src/core/frontend/src/screens/HomeScreen.tsx:322` — Home empty
- Proposed fix: Kit EmptyState (icon, title, body, optional action); area owners adopt in W2/W3; W4 verifies. — Detail: Add src/shared/frontend/ui/empty-state.tsx and use it in these six places; make filter-empty copy say what to clear ('No pinned chats', 'No parts match “…” — Clear search').
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q11/dark/021-empty-states-montage.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq11/dark/050-empty-home.png
- Q11-020 repro: Home → Starred (0) → Library → search 'zzqq-nomatch' → Docs with no page selected → Designer with no design open (fresh session) → Schem Outline of an empty design → Assistant → Pinned (0)
  - expected: One EmptyState (icon, 12px title, 11px hint, optional primary action) used everywhere.
  - actual: Home: centred 16px icon + 'No matching designs' + hint, no action (no 'Clear filter'). Library: centred text only ('No components match the current filters.' + 'Import a component to get started' — wrong hint for a search miss). Docs: bordered card, 40px icon, 'No page selected', 'New page' button. Designer: bordered 448px card, 13px/500 title, full-width primary button + 15px-row list. Outline: left-aligned title + 3 stacked full-width buttons. Assistant Pinned: rounded bordered box 'No chats yet.' although 12 chats exist (filter-empty copy is wrong).
  - code: `src/core/frontend/src/screens/HomeScreen.tsx:322` Home empty
  - code: `src/modules/library/frontend/Space.tsx:738` Library empty
  - code: `src/modules/knowledge/frontend/components/Editor/PageEditor.tsx:215` Docs empty
  - code: `src/modules/designer/frontend/components/DesignerEmptyState.tsx:26` Designer empty
  - code: `src/modules/assistant/frontend/Space.tsx:1351` 'No chats yet.' for any empty filter
