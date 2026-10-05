# home — QA findings

[← index](../README.md) · 21 triage entries · S1 0 · S2 4 · S3 8 · S4 8

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-029](#t-029) | S2 | Design 'More actions' menu stays open after Archive/Delete: delete modal is inert on first click and the menu re-targets the next design | Q1-001, Q11-006 | fix-now | C1 / W2 | frontend | XS |
| [T-030](#t-030) | S2 | Delete Design modal: no dialog role, Esc does nothing, no focus trap, unlabelled close X, and global N/Enter hotkeys fire behind it | Q1-002 | fix-now | C1 / W2 | frontend | S |
| [T-031](#t-031) | S2 | Designs load failure shows 'No designs yet — Create your first design' under a raw 'HTTP 500' strip with no Retry | Q1-003 | fix-now | C1 / W2 | frontend | S |
| [T-032](#t-032) | S2 | At the 1100×720 minimum window the Home list collapses the Name column to 0px and clips the star column — design names are invisible | Q1-005, Q3-039 | fix-now | C1 / W2 | frontend | S |
| [T-033](#t-033) | S3 | Home 'N' hotkey creates a design from inside open menus and with any modifier (Cmd+Shift+N, sort-menu typeahead) | Q1-004, F1A-008 | fix-now | C1 / W2 | frontend | XS |
| [T-034](#t-034) | S3 | List header always shows 'Modified ▾' regardless of sort; headers are not clickable and sort direction cannot be changed | Q1-008 | fix-now | C1 / W2 | frontend | S |
| [T-035](#t-035) | S3 | Home counts disagree with the lists: Starred/Archived include archived & deleted designs, header 'N local' includes archived | Q1-009 | fix-now | C1 / W2 | frontend | XS |
| [T-036](#t-036) | S3 | Home design list and grid cards are not keyboard operable (rows/cards unreachable by Tab, no arrow-key selection) | Q1-011, Q11-021 | fix-now | C1 / W2 | frontend | M |
| [T-037](#t-037) | S3 | Unstarred star icon is nearly invisible (1.05–1.4:1) and filter counts are low-contrast (2.2–2.5:1) | Q1-013 | fix-now | C1 / W2 | frontend | XS |
| [T-038](#t-038) | S3 | Card/detail 'More actions' shows Rename, Duplicate, Export… permanently disabled; the 'Coming soon' tooltip can never appear and Rename/Export already exist elsewhere | Q1-014 | fix-now | C1 / W2 | frontend | S |
| [T-039](#t-039) | S3 | 'Import KiCad…' on Home dumps the user into Designer; cancelling the wizard does not return to Home and focus is not moved into the dialog | Q1-016 | fix-now | C1+D1 / W2 | frontend | S |
| [T-040](#t-040) | S3 | Grid view has no selection, yet the detail panel keeps showing a hidden 'selected' design (first row) that Enter will open | Q1-018 | fix-now | C1 / W2 | frontend | S |
| [T-391](#t-391) | S3 | Design thumbnails are hard-coded dark slate art (#131313 bg, slate-400 wires) that ignore theme and tokens — and don't match the light schematic | Q1-017 | wont-fix | — / followup | frontend | S |
| [T-041](#t-041) | S4 | Home paints '0 local' / All 0 / 'designs 0' / 'Select a design' next to the loading spinner on every visit; Assistant paints 'No chats yet.' while chats load | F1D-002 | fix-now | C1 / W2 | frontend | M |
| [T-042](#t-042) | S4 | Home renders every design row/card with its SVG thumbnail at once: a 0.36–0.54 s main-thread block at 300 designs (no virtualization) | F1D-008 | defer | C1 / followup | frontend | S |
| [T-043](#t-043) | S4 | Home view (List/Grid), sort and filter reset on every reload and every time you leave Home | Q1-010 | fix-now | C1 / W2 | frontend | XS |
| [T-044](#t-044) | S4 | Archive, unarchive and delete give no feedback and no undo | Q1-020 | fix-now | C1 / W2 | frontend | S |
| [T-045](#t-045) | S4 | Deleting a design that is open in a Designer tab fires 404s for it when Designer is reopened | Q1-021 | fix-now | D1 / W2 | frontend | XS |
| [T-046](#t-046) | S4 | Long design names can't be read in full on Home (no tooltip in list/grid, detail panel only truncates) | Q1-023 | fix-now | C1 / W2 | frontend | XS |
| [T-047](#t-047) | S4 | Empty/first-run Home offers only 'New design' (no Import KiCad…), keeps a 300px 'Select a design' panel and 'Enter to open' hint; no-results state has no 'Clear search' | Q1-024 | fix-now | C1 / W2 | frontend | XS |
| [T-048](#t-048) | S4 | Right-clicking a design row/card shows the generic 'OpenPCB › Settings' menu instead of design actions | Q1-026 | fix-now | C1 / W2 | frontend | S |

## T-029

**Design 'More actions' menu stays open after Archive/Delete: delete modal is inert on first click and the menu re-targets the next design**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate XS
- Findings: Q1-001, Q11-006

**Summary.** Menu stays open (onSelect calls e.preventDefault()). Delete modal needs two clicks, is unreachable by keyboard while the menu is open, and after Archive the still-open menu now targets the next selected design (risk of archiving/deleting the wrong design). | Also covers: Q11-006: Home 'More actions → Delete' leaves the menu open above the Delete modal; first click on…

**Root cause.** `src/core/frontend/src/screens/home/DesignCard.tsx:134` — Archive onSelect e.preventDefault() keeps Radix menu open

**Proposed fix.** Drop e.preventDefault() in ActionsMenu onSelect so Radix closes; open delete modal after menu close; key ActionsMenu by design id. — Detail: DesignCard.tsx ActionsMenu: drop e.preventDefault() from both onSelect handlers (lines 134-137, 151-154) so Radix closes the menu; defer onDelete() to the menu's onCloseAutoFocus (or setTimeout 0) so focus can move into the modal. In DesignDetailPanel.tsx:50 render <ActionsMenu key={design.id} …> so a menu can never outlive the design it was opened for.

**Evidence.** [001-delete-modal-menu-open](../evidence/shots/vq1/dark/001-delete-modal-menu-open.png), [dlg2-home-delete-mouse](../evidence/shots/q11/light/dlg2-home-delete-mouse.png), [014-home-delete-mouse](../evidence/shots/vq11/dark/014-home-delete-mouse.png)

<details><summary>Q1-001 — Design 'More actions' menu stays open after Archive/Delete: delete modal is inert on first click and the menu re-targets the next design (S2, confirmed)</summary>

- Area home · stack A · design 5464e17b / e154d769 (QA-q1-*) · themes dark, light · viewports 1440x900
- Repro:
  1. Home, List view, click row 'QA-q1-alpha' (own design) so it shows in the detail panel
  2. Click the detail panel '…' (More actions) → Delete
  3. Observe the Delete Design modal opens but the dropdown menu is still open underneath the overlay (Delete item highlighted); body has pointer-events:none and the modal is aria-hidden
  4. Click 'Cancel' (or 'Delete') once: nothing happens except the menu closing; a 2nd click is needed
  5. Keyboard: focus stays inside the (hidden) menu, Tab does not reach the modal buttons; Esc #1 only closes the menu
  6. Separately: select 'QA-q1-LONG…' → detail '…' → Archive. The design is archived, the selection jumps to the next row (another agent's 'QA-Q3-sandbox') and the SAME menu stays open, now bound to that other design (Archive/Delete would act on it)
  7. Same behaviour from grid-card '…' menu (Delete) — first click on modal Delete only dismisses the menu
- Expected: Choosing Archive or Delete closes the menu; the confirmation modal is immediately interactive and focused; a menu never silently re-targets a different design.
- Actual: Menu stays open (onSelect calls e.preventDefault()). Delete modal needs two clicks, is unreachable by keyboard while the menu is open, and after Archive the still-open menu now targets the next selected design (risk of archiving/deleting the wrong design).
- Screenshots: [001-delete-modal-menu-open](../evidence/shots/vq1/dark/001-delete-modal-menu-open.png), [002-after-first-cancel-click](../evidence/shots/vq1/dark/002-after-first-cancel-click.png), [006-archive-menu-stays-retargets](../evidence/shots/vq1/dark/006-archive-menu-stays-retargets.png), [025-delete-modal](../evidence/shots/q1/dark/025-delete-modal.png), [026-after-first-click-cancel](../evidence/shots/q1/dark/026-after-first-click-cancel.png), [028-grid-delete-modal](../evidence/shots/q1/dark/028-grid-delete-modal.png), [038-detail-archive-menu-stays](../evidence/shots/q1/dark/038-detail-archive-menu-stays.png)
- Code: `src/core/frontend/src/screens/home/DesignCard.tsx:134` — Archive onSelect e.preventDefault() keeps Radix menu open
- Code: `src/core/frontend/src/screens/home/DesignCard.tsx:151` — Delete onSelect e.preventDefault() keeps menu open (modal) behind the delete modal
- Code: `src/core/frontend/src/screens/home/DesignDetailPanel.tsx:50` — detail panel ActionsMenu persists across selection changes, so an open menu re-targets the new selectedDesign
- Suggested fix: DesignCard.tsx ActionsMenu: drop e.preventDefault() from both onSelect handlers (lines 134-137, 151-154) so Radix closes the menu; defer onDelete() to the menu's onCloseAutoFocus (or setTimeout 0) so focus can move into the modal. In DesignDetailPanel.tsx:50 render <ActionsMenu key={design.id} …> so a menu can never outlive the design it was opened for.
- Verification (vq1): **confirmed** — Reproduced on stack A (own QA-q1-vq1-a): detail '…' → Delete leaves the Radix menu open over the modal; body pointer-events:none, modal overlay aria-hidden=true, activeElement = menuitem 'Delete'. First click on modal Cancel only closed the menu (menu:false, modal:true), second click closed the modal. Tab x3 stayed on the menuitem; Esc #1 closed only the menu. Detail '…' → Archive on QA-q1-vq1-a: menu stayed open (items Rename/Duplicate/Export…/Archive/Delete) while the detail header switched to another design (QA-q1-vq1-stray-n) → the open menu now targets a different design. Root cause DesignCard.tsx:134-137/151-154 e.preventDefault() in onSelect. Not intentional (no PLAN decision); S2 kept (wrong-target risk + keyboard dead end). · evidence: [001-delete-modal-menu-open](../evidence/shots/vq1/dark/001-delete-modal-menu-open.png), [002-after-first-cancel-click](../evidence/shots/vq1/dark/002-after-first-cancel-click.png), [006-archive-menu-stays-retargets](../evidence/shots/vq1/dark/006-archive-menu-stays-retargets.png)

</details>

<details><summary>Q11-006 — Home 'More actions → Delete' leaves the menu open above the Delete modal; first click on Cancel/Delete only dismisses the menu (S3, confirmed)</summary>

- Area home · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Home → click row GUIDE-VALIDATE
  2. Click the detail-panel '…' (More actions) → click 'Delete'
  3. Observe the dropdown menu still open (undimmed) above the modal overlay; body has pointer-events:none
  4. Click 'Cancel' once → only the menu closes; click again → modal closes (nothing deleted)
- Expected: Selecting Delete closes the menu and hands focus/pointer to the modal.
- Actual: After mouse click on Delete: [role=menu] count 1, body pointer-events 'none', document.elementFromPoint(Cancel centre) ≠ Cancel. First click at Cancel (788,488) → menus 0, modal still open; second click → modal closed. With the keyboard the focus stays on the hidden 'Delete' menu item. Same onSelect pattern on Archive keeps the menu open.
- Screenshots: [dlg2-home-delete-mouse](../evidence/shots/q11/light/dlg2-home-delete-mouse.png), [dlg2-home-delete-open](../evidence/shots/q11/light/dlg2-home-delete-open.png)
- Census: `census/q11/dlg2-home-delete-light.json`
- Code: `src/core/frontend/src/screens/home/DesignCard.tsx:150` — onSelect={(e) => { e.preventDefault(); onDelete(); }} keeps the Radix menu open
- Suggested fix: Drop e.preventDefault() in the Delete item's onSelect (let Radix close the menu), and open the modal after close (or use DropdownMenu modal={false}).
- Verification (vq11): **confirmed** — Reproduced in dark (q11 did light). Steps: Home → select GUIDE-VALIDATE → detail 'More actions' → click 'Delete'. Result: [role=menu] count 1, body pointer-events none, and elementFromPoint at the Cancel centre hits <html>, not Cancel. The menu stays drawn above the modal (screenshot). The 1st click on Cancel only closes the menu (modal still open); the 2nd closes the modal. Nothing deleted. Root cause is DesignCard.tsx:150-153 `onSelect={(e)=>{e.preventDefault(); onDelete();}}` in the ActionsMenu shared by DesignCard and DesignDetailPanel:50; Archive at :135 has the same pattern. Severity stays S3: the workaround is a second click and there is no data risk. Cross-agent duplicate of Q1-001 (rated S2 there); same pattern in assistant chat actions (Q8-015). · evidence: [014-home-delete-mouse](../evidence/shots/vq11/dark/014-home-delete-mouse.png), state after Delete item: {menus:1, bodyPE:'none', hitAtCancel:'HTML.dark'}; after 1st Cancel: {menus:0, modal open}; after 2nd: closed

</details>


## T-030

**Delete Design modal: no dialog role, Esc does nothing, no focus trap, unlabelled close X, and global N/Enter hotkeys fire behind it**

- Severity **S2** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate S
- Findings: Q1-002 · known ref K26
- Depends on: ['T-014']

**Summary.** None of these hold. Esc ignored; Tab leaves the modal; Enter behind the modal opens a design; N behind the modal silently creates a new design and navigates away.

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:58` — hand-rolled overlay div, no role/aria-modal/Esc/focus management

**Proposed fix.** Replace hand-rolled delete modal with kit confirmDialog (role=dialog, Esc, focus trap/restore, named close); suspend N/Enter hotkeys while open. — Detail: HomeScreen.tsx:46-100: rebuild DeleteConfirmationModal on @radix-ui/react-dialog (already a dependency; kit/Settings dialogs use it): role=dialog + aria-modal + aria-labelledby title, focus trap, initial focus on Cancel, Esc = cancel (blocked while deleting), focus returns to trigger; add aria-label='Close' to the X (line 64). In the keydown handler (:265) early-return when deletingDesign !== null (add to deps).

**Evidence.** [003-delete-modal](../evidence/shots/vq1/dark/003-delete-modal.png)

<details><summary>Q1-002 — Delete Design modal: no dialog role, Esc does nothing, no focus trap, unlabelled close X, and global N/Enter hotkeys fire behind it (S2, confirmed)</summary>

- Area home · stack A · design 5464e17b (QA-q1-alpha), 82773719 (QA-q1-stray, created by the N leak) · themes dark, light · viewports 1440x900
- Repro:
  1. Home → select own design 'QA-q1-alpha' → detail '…' → Delete (press Esc once to dismiss the lingering menu, see Q1-001)
  2. Inspect modal: wrapper has no role=dialog/aria-modal/aria-labelledby; close X button has no aria-label/title
  3. Press Esc → modal stays open
  4. Press Tab repeatedly → focus goes X → Cancel → Delete → Home rail → Designer rail … (escapes the modal)
  5. Blur to body and press Enter → the selected design opens in Designer and the modal vanishes
  6. Re-open modal, focus on the '…' trigger behind it, press N → a brand-new 'Untitled Design' is created and opened (had to rename it QA-q1-stray and delete it)
- Expected: Modal is a proper dialog (role=dialog, aria-modal, labelled by its title), focus moves into it and is trapped, Esc cancels, the X has an accessible name, and page hotkeys (N / Enter / '/') are suppressed while it is open.
- Actual: None of these hold. Esc ignored; Tab leaves the modal; Enter behind the modal opens a design; N behind the modal silently creates a new design and navigates away.
- Screenshots: [003-delete-modal](../evidence/shots/vq1/dark/003-delete-modal.png), [001-delete-modal-menu-open](../evidence/shots/vq1/dark/001-delete-modal-menu-open.png), [025-delete-modal](../evidence/shots/q1/dark/025-delete-modal.png), [027-modal-before-N](../evidence/shots/q1/dark/027-modal-before-N.png)
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:58` — hand-rolled overlay div, no role/aria-modal/Esc/focus management
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:64` — icon-only close button without aria-label
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:264` — window keydown handler (Enter/N) not gated on deletingDesign
- Suggested fix: HomeScreen.tsx:46-100: rebuild DeleteConfirmationModal on @radix-ui/react-dialog (already a dependency; kit/Settings dialogs use it): role=dialog + aria-modal + aria-labelledby title, focus trap, initial focus on Cancel, Esc = cancel (blocked while deleting), focus returns to trigger; add aria-label='Close' to the X (line 64). In the keydown handler (:265) early-return when deletingDesign !== null (add to deps).
- Verification (vq1): **confirmed** — Reproduced: modal wrapper/inner have role=null, aria-modal=null; buttons [{name:''},Cancel,Delete] (X unlabelled). Esc leaves the modal open. Tab goes X → Cancel → Delete → BODY → rail 'Home' (no trap, no initial focus). With focus blurred to body, Enter opened the selected design (title 'QA-q1-vq1-a — OpenPCB') and the modal vanished. With focus on the '…' trigger behind the modal, pressing 'n' created and opened a new design (designs 20 → 21, id 031125da, renamed QA-q1-vq1-stray and deleted). HomeScreen.tsx:58-71 hand-rolled overlay; keydown handler :264-303 never checks deletingDesign. Matches K26. S2 kept: hotkeys behind a destructive-confirm modal create persisted designs / navigate away. · evidence: [003-delete-modal](../evidence/shots/vq1/dark/003-delete-modal.png), [001-delete-modal-menu-open](../evidence/shots/vq1/dark/001-delete-modal-menu-open.png)

</details>


## T-031

**Designs load failure shows 'No designs yet — Create your first design' under a raw 'HTTP 500' strip with no Retry**

- Severity **S2** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate S
- Findings: Q1-003 · known ref K32,K40
- Depends on: ['T-006']

**Summary.** Red strip 'Failed to load designs: HTTP 500' (raw status, no role=alert, no retry/dismiss) + the first-run empty state 'No designs yet / Create your first design to get started / New design', header '0 local', All 0 — while the user actually has 18 designs. Create failure similarly surfaces 'Failed to create design: HTTP 500'. Only recovery is a full app reload.

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:138` — raw `HTTP ${status}` message

**Proposed fix.** On load error show kit error state with Retry (problem.ts copy) instead of 'No designs yet'; keep list on refresh failure. — Detail: HomeScreen.tsx: before the `visible.length === 0` branch (:350) add `else if (error && designs.length === 0)` rendering an error state ('Couldn't load your designs', problem-details `title` when present, Button 'Retry' → fetchDesigns()); parse application/problem+json in fetchDesigns/handleCreateDesign/handleDeleteDesign instead of `HTTP ${status}` (:138,:184,:207); give the strip (:489) role='alert' and a dismiss button.

**Evidence.** [007-load-error-500](../evidence/shots/vq1/dark/007-load-error-500.png)

<details><summary>Q1-003 — Designs load failure shows 'No designs yet — Create your first design' under a raw 'HTTP 500' strip with no Retry (S2, confirmed)</summary>

- Area home · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Home (stack A), playwright: route "**/api/modules/designer/designs" --status 500 (problem+json)
  2. Reload
  3. Observe the page
  4. Click 'New design' (POST also 500)
- Expected: A load-error state that says designs could not be loaded (human wording), with a Retry button, and no claim that the user has no designs; counts/sidebar not presenting 0 as fact.
- Actual: Red strip 'Failed to load designs: HTTP 500' (raw status, no role=alert, no retry/dismiss) + the first-run empty state 'No designs yet / Create your first design to get started / New design', header '0 local', All 0 — while the user actually has 18 designs. Create failure similarly surfaces 'Failed to create design: HTTP 500'. Only recovery is a full app reload.
- Screenshots: [007-load-error-500](../evidence/shots/vq1/dark/007-load-error-500.png), [063-load-error-500](../evidence/shots/q1/light/063-load-error-500.png), [032-load-error-500](../evidence/shots/q1/dark/032-load-error-500.png), [033-create-error-500](../evidence/shots/q1/dark/033-create-error-500.png)
- Network: `GET /api/modules/designer/designs → 500 (injected)`; `POST /api/modules/designer/designs → 500 (injected)`
- Pixel probes: {"file": "shots/q1/dark/032-load-error-500.png", "x": 400, "y": 47, "hex": "#261817", "nearestToken": "--status-danger-soft@app", "deltaE": 0.6}; {"file": "shots/q1/light/063-load-error-500.png", "x": 400, "y": 47, "hex": "#ecdcdb", "nearestToken": "--status-danger-soft@app", "deltaE": 0.7}; {"file": "shots/vq1/dark/007-load-error-500.png", "x": 400, "y": 47, "hex": "#261817", "nearestToken": "--status-danger-soft@app", "deltaE": 0.6}
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:138` — raw `HTTP ${status}` message
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:350` — visible.length===0 renders emptyState even when error is set
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:489` — error strip: no role=alert, no Retry/dismiss
- Suggested fix: HomeScreen.tsx: before the `visible.length === 0` branch (:350) add `else if (error && designs.length === 0)` rendering an error state ('Couldn't load your designs', problem-details `title` when present, Button 'Retry' → fetchDesigns()); parse application/problem+json in fetchDesigns/handleCreateDesign/handleDeleteDesign instead of `HTTP ${status}` (:138,:184,:207); give the strip (:489) role='alert' and a dismiss button.
- Verification (vq1): **confirmed** — Reproduced with route 500 (problem+json) on GET /api/modules/designer/designs + reload: strip text 'Failed to load designs: HTTP 500' (role=null, 0 buttons), below it 'No designs yet / Create your first design to get started / New design', header '0 local', status 'designs 0' — while the DB has 18+ designs; sidebar still shows 'Archived 1' from localStorage. Strip bg #261817 = --status-danger-soft (ΔE 0.6) — on token. Unrouted afterwards. HomeScreen.tsx:137-139 raw status, :350 emptyState chosen whenever visible.length===0 regardless of error, :489-493 strip without role/retry. Also K40 instance. S2 kept (misleading 'no designs' claim, only recovery is reload). · evidence: [007-load-error-500](../evidence/shots/vq1/dark/007-load-error-500.png), [063-load-error-500](../evidence/shots/q1/light/063-load-error-500.png)

</details>


## T-032

**At the 1100×720 minimum window the Home list collapses the Name column to 0px and clips the star column — design names are invisible**

- Severity **S2** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate S
- Findings: Q1-005, Q3-039

**Summary.** grid-template-columns resolves to '220px 0px 70px 90px 110px 24px': list pane is 520px wide, Name cell is 0px (header 'NAME' overlaps 'REV'), and the star cell starts at x=820 beyond the pane edge (800) so stars are clipped. Rows show only thumbnail/rev/DRC/modified, so users cannot tell designs apart (many are 'Empty design'). Grid view is fine at the same size. | Also covers: Q3-039: Home list hides every design name at 1100×720 (Name column collapses to 29 px while the 2…

**Root cause.** `src/core/frontend/src/screens/home/DesignListRow.tsx:7` — DESIGN_LIST_COLS = '220px 1fr 70px 90px 110px 24px' — 1fr has no minimum

**Proposed fix.** Use minmax() so Name keeps ≥160px; shrink/hide Preview column below ~1280px. — Detail: DesignListRow.tsx:7: DESIGN_LIST_COLS = 'minmax(96px,220px) minmax(160px,1fr) 56px 90px 90px 24px' (thumbnail wrapper at :36 must then use w-full instead of w-[220px]); and/or hide DesignDetailPanel (w-[300px], DesignDetailPanel.tsx:32/39) below ~1280px viewport via a container/media query.

**Evidence.** [008-home-list-1100](../evidence/shots/vq1/dark/008-home-list-1100.png), [018-home-1100-names-hidden](../evidence/shots/q3/light/018-home-1100-names-hidden.png)

<details><summary>Q1-005 — At the 1100×720 minimum window the Home list collapses the Name column to 0px and clips the star column — design names are invisible (S2, confirmed)</summary>

- Area home · stack A · design None · themes dark, light · viewports 1100x720
- Repro:
  1. Home, List view (default)
  2. Resize window to 1100×720 (Electron minimum)
  3. Look at the design rows
- Expected: Name stays visible (it is the primary column); fixed columns shrink/hide (e.g. drop the 220px preview or the detail panel) before Name.
- Actual: grid-template-columns resolves to '220px 0px 70px 90px 110px 24px': list pane is 520px wide, Name cell is 0px (header 'NAME' overlaps 'REV'), and the star cell starts at x=820 beyond the pane edge (800) so stars are clipped. Rows show only thumbnail/rev/DRC/modified, so users cannot tell designs apart (many are 'Empty design'). Grid view is fine at the same size.
- Screenshots: [008-home-list-1100](../evidence/shots/vq1/dark/008-home-list-1100.png), [043-home-list-1100](../evidence/shots/q1/dark/043-home-list-1100.png), [044-home-grid-1100](../evidence/shots/q1/dark/044-home-grid-1100.png)
- Code: `src/core/frontend/src/screens/home/DesignListRow.tsx:7` — DESIGN_LIST_COLS = '220px 1fr 70px 90px 110px 24px' — 1fr has no minimum
- Code: `src/core/frontend/src/screens/home/DesignDetailPanel.tsx:39` — fixed 300px detail panel + 200px sidebar + 80px rail leave ~520px
- Suggested fix: DesignListRow.tsx:7: DESIGN_LIST_COLS = 'minmax(96px,220px) minmax(160px,1fr) 56px 90px 90px 24px' (thumbnail wrapper at :36 must then use w-full instead of w-[220px]); and/or hide DesignDetailPanel (w-[300px], DesignDetailPanel.tsx:32/39) below ~1280px viewport via a container/media query.
- Verification (vq1): **confirmed** — Reproduced at 1100×720 (= Electron minWidth/minHeight, electron/src/main/index.ts:133-134): row grid-template-columns resolves to '220px 0px 70px 90px 110px 24px', list pane 520px wide (right edge 800), Name cell width 0, star cell at x=820 (outside the pane, clipped). Screenshot shows only thumbnails/rev/DRC/modified — no names; header 'NAME' collides with 'REV'. Not an artefact (layout is theme/stack independent). S2 kept: primary identifying column invisible at the minimum supported window. · evidence: [008-home-list-1100](../evidence/shots/vq1/dark/008-home-list-1100.png)

</details>

<details><summary>Q3-039 — Home list hides every design name at 1100×720 (Name column collapses to 29 px while the 220 px preview column stays) (S2, duplicate)</summary>

- Area home · stack A · design None · themes light · viewports 1100x720
- Repro:
  1. Resize to 1100×720 (Electron minimum), rail → Home, List view with the detail panel open
- Expected: Name column keeps priority (preview shrinks/hides first); names always readable
- Actual: NAME header is 29 px wide and the rows show only preview, revision, DRC chip and modified time — no design names at all; users must click each row to see its name in the detail panel. (Noticed while navigating for the designer charter; observed at 1440×900 the names are fine.)
- Screenshots: [018-home-1100-names-hidden](../evidence/shots/q3/light/018-home-1100-names-hidden.png), [017-sandbox-1100](../evidence/shots/q3/light/017-sandbox-1100.png), [019-home-1440](../evidence/shots/q3/light/019-home-1440.png)
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:379` — list grid columns — preview column fixed width
- Suggested fix: Give the name column minmax(160px,1fr) and let the preview column shrink/hide below ~1280 px (or hide the detail panel by default at narrow widths).
- Verification (vq3): **duplicate** — Same defect as Q1-005, already verified by vq1 (Home list Name column collapses to 0 px at 1100×720, DesignListRow.tsx:7 column template). Out of q3's charter (home). Fold into Q1-005. · evidence: [018-home-1100-names-hidden](../evidence/shots/q3/light/018-home-1100-names-hidden.png)

</details>


## T-033

**Home 'N' hotkey creates a design from inside open menus and with any modifier (Cmd+Shift+N, sort-menu typeahead)**

- Severity **S3** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate XS
- Findings: Q1-004, F1A-008
- Depends on: ['T-002']

**Summary.** The window keydown handler checks only e.key==='n'|'N' and input/textarea targets — it ignores metaKey/ctrlKey/altKey and role=menuitem/menu focus, so every such key press silently creates a persisted design (two stray designs created during this test). | Also covers: F1A-008: Pressing N twice on Home while the first create is in flight creates two 'Untitled Design…

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:296` — N branch lacks modifier check and the onControl/menu guard used for Enter

**Proposed fix.** Gate N via shortcut guard (no modifiers, not in menus/inputs) and ignore while a create is in flight. — Detail: HomeScreen.tsx:296: `if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;` before the N branch and apply the onControl guard extended with "[role='menu'], [role='listbox'], [role='dialog']" so menu typeahead and focused controls never create designs.

**Evidence.** [005-n-in-sort-menu-created](../evidence/shots/vq1/dark/005-n-in-sort-menu-created.png), [001-home-N-twice-creating](../evidence/shots/f1a/dark/001-home-N-twice-creating.png), [100-home-N-thrice-creating](../evidence/shots/vf1a/dark/100-home-N-thrice-creating.png)

<details><summary>Q1-004 — Home 'N' hotkey creates a design from inside open menus and with any modifier (Cmd+Shift+N, sort-menu typeahead) (S3, confirmed)</summary>

- Area home · stack A · design 26f807ad (QA-q1-meta), 10f73c81 (QA-q1-menu-n) — both created by the bug · themes dark · viewports 1440x900
- Repro:
  1. Home, click the sort button 'Modified' to open the sort menu
  2. Press 'n' (standard menu typeahead to jump to 'Name')
  3. → menu closes, a new 'Untitled Design' is created in the DB and the app navigates to Designer
  4. Back on Home with nothing focused, press Cmd+Shift+N (or Ctrl+N / Alt+N) → also creates a new design
- Expected: N only fires when no modifier is held and focus is not in a menu/listbox/dialog; menu typeahead works ('n' focuses 'Name').
- Actual: The window keydown handler checks only e.key==='n'|'N' and input/textarea targets — it ignores metaKey/ctrlKey/altKey and role=menuitem/menu focus, so every such key press silently creates a persisted design (two stray designs created during this test).
- Screenshots: [005-n-in-sort-menu-created](../evidence/shots/vq1/dark/005-n-in-sort-menu-created.png), [039-n-in-sort-menu-created](../evidence/shots/q1/dark/039-n-in-sort-menu-created.png)
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:296` — N branch lacks modifier check and the onControl/menu guard used for Enter
- Suggested fix: HomeScreen.tsx:296: `if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;` before the N branch and apply the onControl guard extended with "[role='menu'], [role='listbox'], [role='dialog']" so menu typeahead and focused controls never create designs.
- Verification (vq1): **confirmed** — Reproduced: with the sort menu open (focus role=menu), pressing 'n' closed the menu and created+opened a new design (count 20 → 21). With nothing focused, Ctrl+N also created one (21 → 22). Both strays were mine (renamed QA-q1-vq1-stray-n, deleted). Electron main (electron/src/main) sets no application menu/accelerators, so Cmd/Ctrl+N reach the renderer in the desktop app too. HomeScreen.tsx:296 checks only key + input/textarea target, no modifier or menu guard (the Enter branch's onControl guard at :288 is not applied). S3 kept. · evidence: [005-n-in-sort-menu-created](../evidence/shots/vq1/dark/005-n-in-sort-menu-created.png)

</details>

<details><summary>F1A-008 — Pressing N twice on Home while the first create is in flight creates two 'Untitled Design' designs (S4, confirmed)</summary>

- Area home · stack A · design c1fbe4fd-6b34-409f-a765-ee559f458dcc · themes dark · viewports 1440x900
- Repro:
  1. Home, latency shim 2.5 s
  2. Press N, then N again while the button reads 'Creating…'
  3. GET /api/modules/designer/designs
- Expected: The second N is ignored while a create is pending (as the disabled button suggests).
- Actual: Two POST /designs (both 201) create c1fbe4fd… and 91573bb6… ('Untitled Design' ×2, 13:47:07.519Z / .648Z). The designer opens only the second, so the first is an invisible orphan in the list. It was renamed afterwards via API to 'QA-f1a-dup-from-N-twice'. The button correctly shows a disabled 'Creating…', but the N hotkey handler doesn't check `creating`.
- Screenshots: [001-home-N-twice-creating](../evidence/shots/f1a/dark/001-home-N-twice-creating.png), [002-designer-after-N-twice](../evidence/shots/f1a/dark/002-designer-after-N-twice.png)
- Network: `POST /api/modules/designer/designs → 201 (#251)`; `POST /api/modules/designer/designs → 201 (#575)`
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:296` — keydown N calls handleCreateDesign() without checking `creating`
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:171` — handleCreateDesign has no in-flight guard (a ref), only setCreating for the button
- Suggested fix: Guard handleCreateDesign with a creatingRef (return early if set) and add `!creating` to the N hotkey condition. The same pattern is worth applying to the Designer empty-state 'New design' and the tab-strip '+'.
- Verification (vf1a): **confirmed** — Reproduced without creating designs: an in-page fetch wrapper held POST /api/modules/designer/designs unresolved; on Home, pressing N three times while the button read 'Creating…' (disabled=true) issued 3 POSTs. Code: HomeScreen.tsx:296 N hotkey has no `creating` check and handleCreateDesign (:171) has no in-flight guard. Severity lowered S3->S4: latency-only. On loopback the create resolves and navigates to the designer (unmounting Home) within one round trip, well before a second key press; the outcome is an extra empty design, not data loss. · evidence: [100-home-N-thrice-creating](../evidence/shots/vf1a/dark/100-home-N-thrice-creating.png), in-page counter: POST /designs issued 3 (held, never sent)

</details>


## T-034

**List header always shows 'Modified ▾' regardless of sort; headers are not clickable and sort direction cannot be changed**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate S
- Findings: Q1-008 · known ref K25

**Summary.** Header text stays 'MODIFIED ▾' for Name and Created sorts (rows are sorted correctly). Header cells are plain <span>s (cursor auto, no role/aria-sort), so clicking does nothing. Name is always A→Z, dates always newest first — no way to reverse. The sort menu itself shows no check mark on the current option (only a slightly brighter text).

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:379` — hardcoded <span>Modified ▾</span>

**Proposed fix.** Header reflects current sort field + direction; make headers clickable to sort (toggle asc/desc). — Detail: HomeScreen.tsx:374-381: render Name/Modified header cells as buttons with aria-sort that set sort (+ a direction state used in the comparator at :237) and show ▲/▼ only on the active column (for 'created' show 'Created ▾' in the date slot); :458-468 use DropdownMenuRadioGroup/RadioItem so the current sort is checked.

**Evidence.** [012-sort-name-header](../evidence/shots/vq1/dark/012-sort-name-header.png)

<details><summary>Q1-008 — List header always shows 'Modified ▾' regardless of sort; headers are not clickable and sort direction cannot be changed (S3, confirmed)</summary>

- Area home · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Home, List view
  2. Sort button 'Modified' → choose 'Name' (rows re-order alphabetically)
  3. Read the column header row
  4. Choose 'Created' → header unchanged; click any header cell
- Expected: The sort indicator moves to the active column (Name ▲ / Created ▼), headers are clickable (aria-sort) and toggle direction; 'Created' has a visible column or the indicator sits on the subtitle.
- Actual: Header text stays 'MODIFIED ▾' for Name and Created sorts (rows are sorted correctly). Header cells are plain <span>s (cursor auto, no role/aria-sort), so clicking does nothing. Name is always A→Z, dates always newest first — no way to reverse. The sort menu itself shows no check mark on the current option (only a slightly brighter text).
- Screenshots: [012-sort-name-header](../evidence/shots/vq1/dark/012-sort-name-header.png), [010-sort-name](../evidence/shots/q1/dark/010-sort-name.png), [009-sort-menu](../evidence/shots/q1/dark/009-sort-menu.png)
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:379` — hardcoded <span>Modified ▾</span>
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:237` — fixed sort directions
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:460` — DropdownMenuItem without checked indicator (use DropdownMenuRadioItem)
- Suggested fix: HomeScreen.tsx:374-381: render Name/Modified header cells as buttons with aria-sort that set sort (+ a direction state used in the comparator at :237) and show ▲/▼ only on the active column (for 'created' show 'Created ▾' in the date slot); :458-468 use DropdownMenuRadioGroup/RadioItem so the current sort is checked.
- Verification (vq1): **confirmed** — Reproduced: sort → Name re-orders rows alphabetically ('555 Timer LED Blinker','DRC Demo',…) while the header still reads 'PREVIEW NAME REV DRC MODIFIED ▾'; header cells are SPAN, role=null, cursor auto. Sort menu items are plain menuitem with no aria-checked. HomeScreen.tsx:379 hardcoded label, :237-241 fixed directions, :460 DropdownMenuItem. K25 confirmed, S3. · evidence: [012-sort-name-header](../evidence/shots/vq1/dark/012-sort-name-header.png)

</details>


## T-035

**Home counts disagree with the lists: Starred/Archived include archived & deleted designs, header 'N local' includes archived**

- Severity **S3** · category data · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate XS
- Findings: Q1-009

**Summary.** Starred shows '1' but the Starred list is empty ('No matching designs') because the only starred design is archived; on an empty/failed design list 'Starred 1' persists; deleted designs stay in openpcb.home.starred/archived forever and keep inflating counts. Header reads '20 local' while 'All designs' shows 19 (one archived) — two different totals on one screen.

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:313` — starred: userState.starredCount / archived: archivedCount = raw Set.size

**Proposed fix.** Count Starred/Archived only among existing designs; header shows active count; forget ids on delete. — Detail: HomeScreen.tsx:305-316: starred = active.filter(d => userState.isStarred(d.id)).length; archived = designs.filter(d => userState.isArchived(d.id)).length; header (:406) show the same active count or 'N local · M archived'; after a successful DELETE (:209) remove the id from both sets (add a forget(id) to useDesignUserState).

**Evidence.** [013-starred-count-vs-list](../evidence/shots/vq1/dark/013-starred-count-vs-list.png)

<details><summary>Q1-009 — Home counts disagree with the lists: Starred/Archived include archived & deleted designs, header 'N local' includes archived (S3, confirmed)</summary>

- Area home · stack A · design 5464e17b (QA-q1-alpha) · themes dark, light · viewports 1440x900
- Repro:
  1. Home: star own design QA-q1-alpha (Starred 1 ✓)
  2. Grid → its '…' → Archive
  3. Click 'Starred' filter
  4. Also: with the designs API mocked to return [] (or failing with 500), the sidebar still shows 'Starred 1'
  5. Light session: star QA-q1-alpha, then delete it → sidebar still 'Starred 1', list empty; localStorage openpcb.home.starred still holds 5464e17b…
- Expected: Each filter count equals the number of rows that filter shows (starred ∩ active designs; archived ∩ existing designs).
- Actual: Starred shows '1' but the Starred list is empty ('No matching designs') because the only starred design is archived; on an empty/failed design list 'Starred 1' persists; deleted designs stay in openpcb.home.starred/archived forever and keep inflating counts. Header reads '20 local' while 'All designs' shows 19 (one archived) — two different totals on one screen.
- Screenshots: [013-starred-count-vs-list](../evidence/shots/vq1/dark/013-starred-count-vs-list.png), [007-load-error-500](../evidence/shots/vq1/dark/007-load-error-500.png), [018-after-archive](../evidence/shots/q1/dark/018-after-archive.png), [034-empty-state](../evidence/shots/q1/dark/034-empty-state.png), [032-load-error-500](../evidence/shots/q1/dark/032-load-error-500.png), [043-home-list-1100](../evidence/shots/q1/dark/043-home-list-1100.png), [062-starred-count-after-delete](../evidence/shots/q1/light/062-starred-count-after-delete.png)
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:313` — starred: userState.starredCount / archived: archivedCount = raw Set.size
- Code: `src/core/frontend/src/screens/home/useDesignUserState.ts:71` — counts are localStorage set sizes, never intersected with loaded designs or pruned on delete
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:406` — header uses designs.length (includes archived)
- Suggested fix: HomeScreen.tsx:305-316: starred = active.filter(d => userState.isStarred(d.id)).length; archived = designs.filter(d => userState.isArchived(d.id)).length; header (:406) show the same active count or 'N local · M archived'; after a successful DELETE (:209) remove the id from both sets (add a forget(id) to useDesignUserState).
- Verification (vq1): **confirmed** — Reproduced: archived own QA-q1-vq1-a, starred it from the Archived filter → sidebar 'Starred 1' but the Starred filter shows 'No matching designs'; header '22 local' vs 'All designs 21'. With the list API failing (Q1-003 repro) the sidebar still showed 'Archived 1' with 0 designs. HomeScreen.tsx:313-314 use raw Set sizes from useDesignUserState.ts:71-72; nothing prunes deleted ids. S3 kept (count badge only, lists themselves are correct). · evidence: [013-starred-count-vs-list](../evidence/shots/vq1/dark/013-starred-count-vs-list.png), [007-load-error-500](../evidence/shots/vq1/dark/007-load-error-500.png)

</details>


## T-036

**Home design list and grid cards are not keyboard operable (rows/cards unreachable by Tab, no arrow-key selection)**

- Severity **S3** · category keyboard · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate M
- Findings: Q1-011, Q11-021 · known ref K35

**Summary.** Tab order: Star ×N → Open → More actions → rail → search → view/import/sort/new → filters → Star… — rows and cards never receive focus (no tabindex/role/aria-selected). ArrowDown does nothing (selection unchanged). The only keyboard path to a design is 'Enter opens selected', where the selection is the implicit first row, so a keyboard user can open only the top design. Grid cards are clickable <div>s with no keyboa… | Also covers: Q11-021: Home list rows / grid cards and BOM rows are not keyboard reachable — Tab skips from the…

**Root cause.** `src/core/frontend/src/screens/home/DesignListRow.tsx:28` — TableRow with onClick/onDoubleClick only

**Proposed fix.** Rows/cards focusable (roving tabindex, role=row/option), arrows move selection, Enter opens; BOM rows handled in D4 entry. — Detail: Make the list container role=listbox aria-label='Designs'; DesignListRow → role=option aria-selected tabIndex={selected?0:-1}; handle ArrowUp/Down/Home/End (move selectedId + scrollIntoView), Enter open, Delete → setDeletingDesign. DesignCard: role=button tabIndex=0 with Enter/Space → onOpen (or select, see Q1-018).

**Evidence.** [021-tab-focus](../evidence/shots/q1/dark/021-tab-focus.png), [tab-home-list-20](../evidence/shots/q11/dark/tab-home-list-20.png), [050-empty-home](../evidence/shots/vq11/dark/050-empty-home.png)

<details><summary>Q1-011 — Home design list and grid cards are not keyboard operable (rows/cards unreachable by Tab, no arrow-key selection) (S3, confirmed)</summary>

- Area home · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Home, List view; click in empty space then press Tab ~30×, logging document.activeElement
  2. Try ArrowDown/ArrowUp to move the selected row
  3. Switch to Grid and Tab again
- Expected: Rows are focusable (roving tabindex, role=row/option with aria-selected) so arrows move selection, Enter opens, Delete prompts; grid cards are focusable buttons/links that open with Enter/Space.
- Actual: Tab order: Star ×N → Open → More actions → rail → search → view/import/sort/new → filters → Star… — rows and cards never receive focus (no tabindex/role/aria-selected). ArrowDown does nothing (selection unchanged). The only keyboard path to a design is 'Enter opens selected', where the selection is the implicit first row, so a keyboard user can open only the top design. Grid cards are clickable <div>s with no keyboard handler.
- Screenshots: [021-tab-focus](../evidence/shots/q1/dark/021-tab-focus.png), [020-row-select](../evidence/shots/q1/dark/020-row-select.png)
- Code: `src/core/frontend/src/screens/home/DesignListRow.tsx:28` — TableRow with onClick/onDoubleClick only
- Code: `src/core/frontend/src/screens/home/DesignCard.tsx:195` — card is a <div onClick> — not focusable
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:264` — keydown handler has no Arrow handling
- Suggested fix: Make the list container role=listbox aria-label='Designs'; DesignListRow → role=option aria-selected tabIndex={selected?0:-1}; handle ArrowUp/Down/Home/End (move selectedId + scrollIntoView), Enter open, Delete → setDeletingDesign. DesignCard: role=button tabIndex=0 with Enter/Space → onOpen (or select, see Q1-018).
- Verification (vq1): **confirmed** — Reproduced: all 21 list rows tabIndex -1, role null, aria-selected null; ArrowDown ×2 with nothing focused left the detail panel on the same design; grid cards are DIV tabIndex -1 role null. Only keyboard path is Enter on the implicit first/selected row. DesignListRow.tsx:28-35, DesignCard.tsx:195-197, keydown handler HomeScreen.tsx:264 has no arrow handling. K35 confirmed, S3.

</details>

<details><summary>Q11-021 — Home list rows / grid cards and BOM rows are not keyboard reachable — Tab skips from the filters straight to the ★ buttons / row checkboxes (S3, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Home (List): Tab from page start → rail → search → List/Grid → Import → Sort → New design → All/Recent/Starred/Archived → next stop is the first row's ★ 'Star' (rows skipped)
  2. Home (Grid): after the filters Tab visits only 'Star'/'More actions' per card
  3. Designer → BOM: Tab reaches 'Select all' and 'Select C1' checkboxes, never a row; ArrowUp/Down do nothing
- Expected: Rows are focusable (roving tabindex / grid pattern) with Enter to open (the Home status bar even advertises 'Enter to open').
- Actual: tab-home-list-dark: stops 18–35 are 'Star' buttons only; tab-home-grid-dark: stops 18–30 Star/More actions only; tab-bom-dark: stops 16–19 checkboxes only (1×1 sr-only inputs). A keyboard user can open a design only via the detail panel 'Open' after selecting with the mouse.
- Screenshots: [tab-home-list-20](../evidence/shots/q11/dark/tab-home-list-20.png), [001-home-list-1440](../evidence/shots/q11/dark/001-home-list-1440.png), [008-bom-1440](../evidence/shots/q11/dark/008-bom-1440.png)
- Census: `census/q11/tab-home-list-dark.json`
- Code: `src/core/frontend/src/screens/home/DesignListRow.tsx:32` — row is a clickable div without tabIndex/role
- Suggested fix: Give the shared TableRow (src/shared/frontend/ui/data-table.tsx:34-55) an opt-in interactive mode (role=row/option, roving tabIndex, Enter/Space/Arrow handlers), the way LibraryTable.tsx:166-174 already does it locally, and use it in DesignListRow.tsx:28 (Home list), DesignCard grid cards and the BOM table rows.
- Verification (vq11): **confirmed** — Reproduced in light. From Home 'Archived' the next 5 Tab stops are all 'Star' buttons. The 20 list rows (64px) have tabIndex -1 and no role. HomeScreen.tsx:286-293 opens the selected design on Enter, but a row can only be selected with the mouse. Root cause: the shared TableRow (data-table.tsx) is a plain div, and only LibraryTable adds roving tabindex itself. Cross-agent duplicates: Q1-011 (Home, K35) and Q5-008 (BOM rows, K35). · evidence: [050-empty-home](../evidence/shots/vq11/dark/050-empty-home.png), live: 'Archived' → Tab ×5 = Star, Star, Star, Star, Star; '20 rows; tabbable=0; role=null'

</details>


## T-037

**Unstarred star icon is nearly invisible (1.05–1.4:1) and filter counts are low-contrast (2.2–2.5:1)**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate XS
- Findings: Q1-013

**Summary.** Unstarred star stroke uses --border-control: dark #2a2a2e on row #0c0c0d = 1.37:1 and on the selected row #26262b = 1.05:1 (invisible); light #cfcfd4 on #f2f2f3 = 1.39:1, on selected #e2e2e5 = 1.2:1. The star is the only star affordance in List view, so starring is effectively undiscoverable on the selected row. Filter counts use --text-disabled: dark #55555a on #111113 = 2.54:1, light #a8a8ae on #f7f7f8 = 2.21:1.

**Root cause.** `src/core/frontend/src/screens/home/DesignCard.tsx:183` — unstarred: text-border-control

**Proposed fix.** Unstarred star and filter counts to text-tertiary/secondary tokens (≥3:1 icon, ≥4.5:1 text). — Detail: DesignCard.tsx:183 unstarred 'text-text-tertiary hover:text-text-secondary' (≥3:1 on selected rows); HomeSidebar.tsx:98 counts 'text-text-tertiary'.

**Evidence.** [015-home-list](../evidence/shots/vq1/dark/015-home-list.png)

<details><summary>Q1-013 — Unstarred star icon is nearly invisible (1.05–1.4:1) and filter counts are low-contrast (2.2–2.5:1) (S3, confirmed)</summary>

- Area home · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Home, List view
  2. Look at the star column on normal rows and on the selected row
  3. Look at the counts next to All designs / Recent / Starred / Archived
- Expected: Interactive icons ≥3:1 against their background (WCAG 1.4.11), text ≥4.5:1 (counts are informational text).
- Actual: Unstarred star stroke uses --border-control: dark #2a2a2e on row #0c0c0d = 1.37:1 and on the selected row #26262b = 1.05:1 (invisible); light #cfcfd4 on #f2f2f3 = 1.39:1, on selected #e2e2e5 = 1.2:1. The star is the only star affordance in List view, so starring is effectively undiscoverable on the selected row. Filter counts use --text-disabled: dark #55555a on #111113 = 2.54:1, light #a8a8ae on #f7f7f8 = 2.21:1.
- Screenshots: [015-home-list](../evidence/shots/vq1/dark/015-home-list.png), [001-home-list](../evidence/shots/vq1/light/001-home-list.png), [001-home-list](../evidence/shots/q1/dark/001-home-list.png), [050-home-list](../evidence/shots/q1/light/050-home-list.png)
- Pixel probes: {"file": "shots/q1/dark/001-home-list.png", "x": 1109, "y": 86, "hex": "#2a2a2e", "nearestToken": "--border-control", "deltaE": 0}; {"file": "shots/q1/dark/001-home-list.png", "x": 1110, "y": 90, "hex": "#28282d", "nearestToken": "--surface-selected", "deltaE": 1.0}; {"file": "shots/q1/light/050-home-list.png", "x": 1109, "y": 150, "hex": "#cfcfd4", "nearestToken": "--border-control", "deltaE": 0}; {"file": "shots/q1/light/050-home-list.png", "x": 1109, "y": 86, "hex": "#cfcfd4", "nearestToken": "--border-control", "deltaE": 0}
- Code: `src/core/frontend/src/screens/home/DesignCard.tsx:183` — unstarred: text-border-control
- Code: `src/core/frontend/src/screens/home/HomeSidebar.tsx:98` — counts text-text-disabled
- Suggested fix: DesignCard.tsx:183 unstarred 'text-text-tertiary hover:text-text-secondary' (≥3:1 on selected rows); HomeSidebar.tsx:98 counts 'text-text-tertiary'.
- Verification (vq1): **confirmed** — Pixel-verified. Dark: unstarred star on a normal row — darkest antialiased stroke #232326 on #0c0c0d; on the selected row the 12px icon box is #26262b bg with stroke pixels #27272c–#29292d (visually absent). Light: normal row stroke ≤#e1e1e3 on #f2f2f3, selected row ≤#dbdbdf on #e6e6e9. Token-level ratios: --border-control on row 1.37:1 (dark) / 1.39:1 (light), on selected 1.05:1 / 1.2:1; counts --text-disabled 2.54:1 (dark) / 2.21:1 (light). DesignCard.tsx:183, HomeSidebar.tsx:98. S3 kept. · evidence: [015-home-list](../evidence/shots/vq1/dark/015-home-list.png), [001-home-list](../evidence/shots/vq1/light/001-home-list.png)

</details>


## T-038

**Card/detail 'More actions' shows Rename, Duplicate, Export… permanently disabled; the 'Coming soon' tooltip can never appear and Rename/Export already exist elsewhere**

- Severity **S3** · category stub · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate S
- Findings: Q1-014 · known ref K43

**Summary.** Three greyed-out items at the top of every menu. They carry title='Coming soon' but the kit sets pointer-events:none on disabled items, so no tooltip ever shows — users see unexplained dead items. The source comment claims 'No backend endpoint yet', but PATCH /api/modules/designer/designs/:designId exists (designer tab double-click rename works; verified by renaming QA-q1-alpha) and the export endpoints exist. Home…

**Root cause.** `src/core/frontend/src/screens/home/DesignCard.tsx:122` — stale comment + disabled items

**Proposed fix.** Wire Rename (inline edit, PATCH exists); remove Duplicate/Export… stubs from card + detail menus. — Detail: DesignCard.tsx:122-131: remove Duplicate (no backend) and Export… (or route to navigateToModule('designer', id, {action:'export'}) if the designer handles it); implement Rename as inline edit calling PATCH /api/modules/designer/designs/:id then fetchDesigns(). Never ship disabled 'Coming soon' items (D6).

**Note.** Binding user decision: wire Home Rename, remove other Coming-soon stubs.

**Evidence.** [019-detail-menu-stubs](../evidence/shots/vq1/dark/019-detail-menu-stubs.png)

<details><summary>Q1-014 — Card/detail 'More actions' shows Rename, Duplicate, Export… permanently disabled; the 'Coming soon' tooltip can never appear and Rename/Export already exist elsewhere (S3, confirmed)</summary>

- Area home · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Home → Grid → any card '…' (or detail panel '…')
  2. Hover 'Rename' / 'Duplicate' / 'Export…'
- Expected: Either working actions (Rename via the existing PATCH /designs/:id used by the designer tab rename; Export… opening the designer export dialog) or the items hidden until implemented.
- Actual: Three greyed-out items at the top of every menu. They carry title='Coming soon' but the kit sets pointer-events:none on disabled items, so no tooltip ever shows — users see unexplained dead items. The source comment claims 'No backend endpoint yet', but PATCH /api/modules/designer/designs/:designId exists (designer tab double-click rename works; verified by renaming QA-q1-alpha) and the export endpoints exist. Home offers no rename path at all.
- Screenshots: [019-detail-menu-stubs](../evidence/shots/vq1/dark/019-detail-menu-stubs.png), [017-card-menu](../evidence/shots/q1/dark/017-card-menu.png), [024-detail-menu](../evidence/shots/q1/dark/024-detail-menu.png)
- Network: `PATCH /api/modules/designer/designs/5464e17b… (tab rename) → 200, name 'QA-q1-alpha'`
- Code: `src/core/frontend/src/screens/home/DesignCard.tsx:122` — stale comment + disabled items
- Code: `src/shared/frontend/ui/dropdown-menu.tsx:71` — data-[disabled]:pointer-events-none kills the title tooltip
- Code: `src/modules/designer/backend/routes.ts:3002` — router.patch('/designs/:designId') rename exists
- Suggested fix: DesignCard.tsx:122-131: remove Duplicate (no backend) and Export… (or route to navigateToModule('designer', id, {action:'export'}) if the designer handles it); implement Rename as inline edit calling PATCH /api/modules/designer/designs/:id then fetchDesigns(). Never ship disabled 'Coming soon' items (D6).
- Verification (vq1): **confirmed** — Reproduced: detail/card '…' menu items Rename/Duplicate/Export… have aria-disabled=true, title='Coming soon', computed pointer-events none (kit dropdown-menu.tsx:71), so the tooltip can never show. PATCH /designs/:designId exists (routes.ts:3002). This also contradicts PLAN D6 ('No disabled placeholders') and K43. S3 kept. · evidence: [019-detail-menu-stubs](../evidence/shots/vq1/dark/019-detail-menu-stubs.png)

</details>


## T-039

**'Import KiCad…' on Home dumps the user into Designer; cancelling the wizard does not return to Home and focus is not moved into the dialog**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner C1+D1 · wave W2 · scope frontend · estimate S
- Findings: Q1-016

**Summary.** Route changes to Designer; the wizard (role=dialog 'Import KiCad project') opens over whatever design tab was last active; focus stays on body; after Esc the user is left in Designer on that design instead of back on Home.

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:438` — navigateToModule('designer', undefined, {action:'import-kicad'})

**Proposed fix.** Open KiCad import from Home with from:'home'; cancel returns to Home; autofocus 'Choose ZIP…'. — Detail: Pass params {action:'import-kicad', from:'home'} (HomeScreen.tsx:439); in designer Space.tsx:955 remember it and on wizard cancel call navigateHome() (import success stays in Designer). Autofocus 'Choose ZIP…' when the wizard opens.

**Evidence.** [016-import-kicad-from-home](../evidence/shots/vq1/dark/016-import-kicad-from-home.png)

<details><summary>Q1-016 — 'Import KiCad…' on Home dumps the user into Designer; cancelling the wizard does not return to Home and focus is not moved into the dialog (S3, confirmed)</summary>

- Area home · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Home → click 'Import KiCad…'
  2. Observe the app switched to the Designer space (last open design tab shown behind the dialog); activeElement is <body>
  3. Press Esc (or Cancel)
- Expected: The import wizard opens over Home (or returns to Home on cancel); initial focus goes to 'Choose ZIP…'.
- Actual: Route changes to Designer; the wizard (role=dialog 'Import KiCad project') opens over whatever design tab was last active; focus stays on body; after Esc the user is left in Designer on that design instead of back on Home.
- Screenshots: [016-import-kicad-from-home](../evidence/shots/vq1/dark/016-import-kicad-from-home.png), [031-import-kicad](../evidence/shots/q1/dark/031-import-kicad.png)
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:438` — navigateToModule('designer', undefined, {action:'import-kicad'})
- Code: `src/modules/designer/frontend/Space.tsx:955` — opens wizard on params.action; cancel never navigates back
- Suggested fix: Pass params {action:'import-kicad', from:'home'} (HomeScreen.tsx:439); in designer Space.tsx:955 remember it and on wizard cancel call navigateHome() (import success stays in Designer). Autofocus 'Choose ZIP…' when the wizard opens.
- Verification (vq1): **confirmed** — Reproduced: Home 'Import KiCad…' switches the rail to Designer (title = last design tab), dialog 'Import KiCad project' aria-modal=true opens with activeElement BODY; Esc closes it and leaves the user in Designer on that design. Routing to the designer wizard is intentional (PLAN Run 2 c616767 'nav params → designer wizard'), but no return path exists: Space.tsx:955-957 only opens the wizard, nothing records the origin. Not an environment artefact. S3 kept. · evidence: [016-import-kicad-from-home](../evidence/shots/vq1/dark/016-import-kicad-from-home.png)

</details>


## T-040

**Grid view has no selection, yet the detail panel keeps showing a hidden 'selected' design (first row) that Enter will open**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate S
- Findings: Q1-018

**Summary.** Card click = open; no card has a selected state; the detail panel and Enter act on an invisible selection carried over from List (defaults to the first item).

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:357` — DesignCard gets onOpen only, no selected/onSelect

**Proposed fix.** Grid view gets visible selection (or detail panel hides) — Enter only opens a visibly selected design. — Detail: Pass selected/onSelect into DesignCard (click selects with bg-surface-selected + inset selection bar like TableRow, double-click/Enter opens) — or hide DesignDetailPanel when view==='grid'.

**Evidence.** [017-grid-detail-no-selection](../evidence/shots/vq1/dark/017-grid-detail-no-selection.png)

<details><summary>Q1-018 — Grid view has no selection, yet the detail panel keeps showing a hidden 'selected' design (first row) that Enter will open (S3, confirmed)</summary>

- Area home · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Home → Grid
  2. Note the right detail panel shows e.g. 'LED Indicators 5V' but no card is highlighted
  3. Single-click a card → it opens the designer immediately (no selection step)
  4. Back on Home Grid, press Enter with nothing focused → opens the invisible selected design
- Expected: Grid behaves like List: click selects (highlighted card, detail panel follows), double-click/Enter opens — or the detail panel is hidden in Grid.
- Actual: Card click = open; no card has a selected state; the detail panel and Enter act on an invisible selection carried over from List (defaults to the first item).
- Screenshots: [017-grid-detail-no-selection](../evidence/shots/vq1/dark/017-grid-detail-no-selection.png), [011-grid](../evidence/shots/q1/dark/011-grid.png), [052-home-grid](../evidence/shots/q1/light/052-home-grid.png)
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:357` — DesignCard gets onOpen only, no selected/onSelect
- Code: `src/core/frontend/src/screens/home/DesignCard.tsx:196` — onClick={onOpen}
- Suggested fix: Pass selected/onSelect into DesignCard (click selects with bg-surface-selected + inset selection bar like TableRow, double-click/Enter opens) — or hide DesignDetailPanel when view==='grid'.
- Verification (vq1): **confirmed** — Reproduced: Grid view shows the detail panel for 'QA-q1-vq1-stray-n' while no card carries a selected state (0 [data-selected]); card click = open (DesignCard.tsx:196), HomeScreen.tsx:357-366 passes no selected/onSelect; Enter acts on that invisible selection (handler :291). Click-to-open on cards predates the redesign (D13 'Grid view keeps restyled DesignCard'), but the 300px detail panel beside the grid is new and now disagrees with it. S3 kept. · evidence: [017-grid-detail-no-selection](../evidence/shots/vq1/dark/017-grid-detail-no-selection.png)

</details>


## T-391

**Design thumbnails are hard-coded dark slate art (#131313 bg, slate-400 wires) that ignore theme and tokens — and don't match the light schematic**

- Severity **S3** · category visual · status rejected · themes dark, light
- Recommendation **wont-fix** · owner — · wave followup · scope frontend · estimate S
- Findings: Q1-017

**Summary.** REJECTED — Intentional per PLAN, not a redesign defect: (1) D1 defines --surface-canvas-well = #08090a in BOTH themes and the T6 run-log entry says 'card preview SVG pinned to theme=dark (wells are always dark)' — the dark thumbnails in light theme are the decided look; (2) the hex values are an exact mirror of the canvas package palette (node_modules/@openpcb/r3f-eda-canvas/dist/theme/canvasTheme.js:30-55: SCHEMATIC_DARK.back…

**Root cause.** `src/core/frontend/src/screens/home/SchematicThumbnail.tsx:14` — BG '#131313', WIRE '#94a3b8', SYMBOL_STROKE '#e2e8f0', SYMBOL_FILL '#111111' hard-coded

**Proposed fix.** None — dark thumbnails are intentional (canvas wells always dark, D1/T6).

**Evidence.** [001-home-list](../evidence/shots/vq1/light/001-home-list.png)

<details><summary>Q1-017 — Design thumbnails are hard-coded dark slate art (#131313 bg, slate-400 wires) that ignore theme and tokens — and don't match the light schematic (S3, rejected)</summary>

- Area home · stack A · design None · themes light, dark · viewports 1440x900
- Repro:
  1. Set theme Light
  2. Home List/Grid and detail panel
  3. Open a design (e.g. LED Indicators 5V, read-only) and compare the schematic canvas
- Expected: Thumbnails use theme tokens (canvas-well / schematic palette per theme, neutral greys, no blue/slate cast) and look like the schematic the user will open.
- Actual: In light theme every row/card/detail shows a black #131313 box inside a #08090a well (two different near-blacks), wires #94a3b8 (Tailwind slate-400, ΔE 11 from any token) and symbols #e2e8f0 (slate-200) — a blue cast banned by the neutral spec. The light schematic editor itself renders on a light canvas (#f0f4fb), so the preview misrepresents the design; the grid in light theme reads as a wall of black rectangles.
- Screenshots: [001-home-list](../evidence/shots/vq1/light/001-home-list.png), [050-home-list](../evidence/shots/q1/light/050-home-list.png), [052-home-grid](../evidence/shots/q1/light/052-home-grid.png), [051-schematic-light-vs-thumb](../evidence/shots/q1/light/051-schematic-light-vs-thumb.png)
- Pixel probes: {"file": "shots/q1/light/050-home-list.png", "x": 400, "y": 110, "hex": "#131313", "nearestToken": "--text-strong", "deltaE": 2.0}; {"file": "shots/q1/light/051-schematic-light-vs-thumb.png", "x": 700, "y": 500, "hex": "#f0f4fb", "nearestToken": "--surface-app", "deltaE": 3.4}; {"file": "shots/vq1/light/001-home-list.png", "x": 400, "y": 100, "hex": "#131313", "nearestToken": "--text-strong", "deltaE": 2.0}
- Code: `src/core/frontend/src/screens/home/SchematicThumbnail.tsx:14` — BG '#131313', WIRE '#94a3b8', SYMBOL_STROKE '#e2e8f0', SYMBOL_FILL '#111111' hard-coded
- Code: `src/core/frontend/src/screens/home/DesignListRow.tsx:36` — thumbnail wrapper bg-surface-canvas-well (#08090a) around a #131313 svg
- Suggested fix: Drive SchematicThumbnail colours from CSS vars (fill='var(--surface-canvas-well)' / a --schematic-wire / --schematic-symbol token pair per theme) and match the schematic canvas palette; drop the inner #131313 rect or make it the same token as the well.
- Verification (vq1): **rejected** — Intentional per PLAN, not a redesign defect: (1) D1 defines --surface-canvas-well = #08090a in BOTH themes and the T6 run-log entry says 'card preview SVG pinned to theme=dark (wells are always dark)' — the dark thumbnails in light theme are the decided look; (2) the hex values are an exact mirror of the canvas package palette (node_modules/@openpcb/r3f-eda-canvas/dist/theme/canvasTheme.js:30-55: SCHEMATIC_DARK.background #131313, wireColor #94a3b8, PREVIEW_DARK.symbolStroke #e2e8f0, symbolFill #111111), and the canvas palette is an explicit non-goal (§0) with a §9 follow-up — so the thumbnail matches the dark schematic editor by design; (3) the #08090a well is fully covered by the SVG's #131313 background (probe at 400,100 = #131313), so no visible 'two near-blacks'. Residual note for the §9 canvas-palette follow-up: SchematicThumbnail.tsx:14-17 constants must be updated together with SCHEMATIC_DARK/PREVIEW_DARK. · evidence: [001-home-list](../evidence/shots/vq1/light/001-home-list.png)

</details>


## T-041

**Home paints '0 local' / All 0 / 'designs 0' / 'Select a design' next to the loading spinner on every visit; Assistant paints 'No chats yet.' while chats load**

- Severity **S4** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate M
- Findings: F1D-002

**Summary.** Home: until /designs resolves the header says '0 local', the sidebar counts are all 0, the status bar says 'designs 0' and the detail panel says 'Select a design' beside the list spinner. On the real stack (23 designs) this is visible for ~127 ms (8 painted frames) on every Home visit, and for the full load under a slow backend (screenshot at 3 s latency). Assistant: 'No chats yet.' / All 0 / 'New chat' with no load…

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:406` — '{designs.length} local' rendered while loading

**Proposed fix.** While loading show '—'/skeleton instead of 0 counts and 'Select a design'; Assistant part handled in A1 entry. — Detail: HomeScreen.tsx: while loading render '—' (or nothing) for the header count (:406), the HomeSidebar counts (:305 counts -> pass null) and the 'designs N' status segment (:523), and hide 'Select a design' in DesignDetailPanel. Assistant Space.tsx: add chatsLoaded state set in refreshChats (:327); until true render a kit skeleton instead of 'No chats yet.' (:1351) and the EmptyState (:1626). (Docs needs no change for visibility; optionally init tree-store isLoading=true at tree-store.ts:104 for correctness.)

**Evidence.** [002-lat-home-first](../evidence/shots/f1d/dark/002-lat-home-first.png), [004-latency-home-zero-counts](../evidence/shots/vf1d/dark/004-latency-home-zero-counts.png)

<details><summary>F1D-002 — Home paints '0 local' / All 0 / 'designs 0' / 'Select a design' next to the loading spinner on every visit; Assistant paints 'No chats yet.' while chats load (S4, confirmed)</summary>

- Area cross-cutting · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. In-page latency shim: delay every /api fetch 2.5 s (window.fetch wrapper)
  2. Navigate in memory (useNavigationStore, no reload): Home → Docs → Assistant → Settings General/Libraries/About → Tasks. For Docs, make it the first visit after a page load
  3. Screenshot the first render and record which strings appear (MutationObserver watcher)
- Expected: While a list is loading, each space shows a loading state (spinner/skeleton). Counts and empty-state copy stay hidden until data arrives, and actions that depend on the data wait.
- Actual: Home: until /designs resolves the header says '0 local', the sidebar counts are all 0, the status bar says 'designs 0' and the detail panel says 'Select a design' beside the list spinner. On the real stack (23 designs) this is visible for ~127 ms (8 painted frames) on every Home visit, and for the full load under a slow backend (screenshot at 3 s latency). Assistant: 'No chats yet.' / All 0 / 'New chat' with no loading indicator while /chats loads (1 frame on loopback, full load under latency). Docs sub-claim not reproduced as visible: 'No pages yet' is in the DOM for ~2 ms and is never painted (0 rAF frames) because the tree effect flips isLoading before paint. Tasks 'No tasks yet.' is already Q9-023 (and Tasks is unreachable, K42). Settings › Libraries 'Check for updates' enabled while status is unknown is harmless (the check fetches status itself).
- Screenshots: [002-lat-home-first](../evidence/shots/f1d/dark/002-lat-home-first.png), [004-lat-assistant-first](../evidence/shots/f1d/dark/004-lat-assistant-first.png), [005-lat-assistant-mid](../evidence/shots/f1d/dark/005-lat-assistant-mid.png), [014-lat-tasks-first](../evidence/shots/f1d/dark/014-lat-tasks-first.png), [009-lat-settings-libraries-first](../evidence/shots/f1d/dark/009-lat-settings-libraries-first.png), [101-lat-docs-first](../evidence/shots/f1d/light/101-lat-docs-first.png), [102-lat-home-first](../evidence/shots/f1d/light/102-lat-home-first.png), [103-lat-assistant-first](../evidence/shots/f1d/light/103-lat-assistant-first.png), [107-lat-tasks-first](../evidence/shots/f1d/light/107-lat-tasks-first.png), [004-latency-home-zero-counts](../evidence/shots/vf1d/dark/004-latency-home-zero-counts.png), [002-latency-assistant-placeholder](../evidence/shots/vf1d/dark/002-latency-assistant-placeholder.png)
- Network: `watcher events light: Docs 40ms 'No pages yet'; Home 6ms 'designs 0','0 local','Select a design' until 2648ms; Assistant 36ms 'No chats yet' until ~2585ms; Tasks 6ms 'No tasks yet'`
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:406` — '{designs.length} local' rendered while loading
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:305` — counts memo computed from the empty initial array during load
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:523` — 'designs {visible.length}' status segment rendered while loading
- Code: `src/modules/assistant/frontend/Space.tsx:1351` — 'No chats yet.' whenever filteredChats is empty — no chats-loaded flag
- Code: `src/modules/assistant/frontend/Space.tsx:1626` — EmptyState shown before the chat list/selection resolves
- Suggested fix: HomeScreen.tsx: while loading render '—' (or nothing) for the header count (:406), the HomeSidebar counts (:305 counts -> pass null) and the 'designs N' status segment (:523), and hide 'Select a design' in DesignDetailPanel. Assistant Space.tsx: add chatsLoaded state set in refreshChats (:327); until true render a kit skeleton instead of 'No chats yet.' (:1351) and the EmptyState (:1626). (Docs needs no change for visibility; optionally init tree-store isLoading=true at tree-store.ts:104 for correctness.)
- Verification (vf1d): **confirmed** — Home zero counts reproduced without any shim: per-frame rAF sampler after in-memory navigateHome showed 'Designs|0 local' + 'designs 0' + spinner from t=15 ms to t=142 ms, then '23 local'/'designs 23'. Under 3 s latency the full screenshot shows 0 counts, 'designs 0', 'Select a design'. Assistant 'No chats yet.' confirmed (1 frame on loopback, whole load under latency). Refuted parts: Docs 'No pages yet' never painted (2 ms in DOM, 0 rAF frames); Tasks is a duplicate of Q9-023; the Libraries 'Check for updates' point is not a defect. Severity lowered S3->S4: flicker-grade on the real loopback backend (~130 ms), no wrong action results. · evidence: [004-latency-home-zero-counts](../evidence/shots/vf1d/dark/004-latency-home-zero-counts.png), rAF frames: t=15 'Designs|0 local','designs 0',spin=true -> t=142 'Designs|23 local','designs 23', Docs watcher: 'No pages yet' on 1135 ms / off 1137 ms, noPagesFrames=[]

</details>


## T-042

**Home renders every design row/card with its SVG thumbnail at once: a 0.36–0.54 s main-thread block at 300 designs (no virtualization)**

- Severity **S4** · category perf · status confirmed · themes dark, light
- Recommendation **defer** · owner C1 · wave followup · scope frontend · estimate S
- Findings: F1D-008

**Summary.** Long tasks: 465 ms (list, dark), 535 ms (list, light), 363 ms (List → Grid toggle). All 280 row DOM nodes and 300 SVG previews mount at once. Scrolling itself is smooth: list p95 16.8 ms per frame, grid avg 18.1 ms / p95 17.5 ms, no long tasks while scrolling. The only stalls >50 ms coincided with CLI screenshot/eval calls. The cost grows linearly with design count.

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:383` — visible.map renders all rows

**Proposed fix.** Virtualize Home list/grid (or lazy thumbnails) for >200 designs. — Detail: HomeScreen.tsx:356 (grid) and :383 (list): virtualize with @tanstack/react-virtual (fixed 64 px list rows) or at minimum add content-visibility:auto + contain-intrinsic-size to DesignListRow/DesignCard and lazy-build thumbnails with IntersectionObserver in SchematicThumbnail.tsx:52 (buildSchematicPreviewGeometry runs eagerly per row).

**Evidence.** [020-home300-list](../evidence/shots/f1d/dark/020-home300-list.png), [040-home300-list](../evidence/shots/vf1d/dark/040-home300-list.png)

<details><summary>F1D-008 — Home renders every design row/card with its SVG thumbnail at once: a 0.36–0.54 s main-thread block at 300 designs (no virtualization) (S4, confirmed)</summary>

- Area home · stack A · design None · themes dark, light · viewports 1440x900, 1100x720, 1920x1080
- Repro:
  1. In-page mock: GET /api/modules/designer/designs returns 300 designs cloned from the real shape (real schematicPreview payloads, mixed names, every DRC state)
  2. Navigate to Home (list), then toggle Grid
  3. Record PerformanceObserver longtask entries; run a rAF scroll probe
- Expected: First paint of a 300-item list stays under ~100 ms (virtualized rows / lazy thumbnails). Scrolling stays at 60 fps.
- Actual: Long tasks: 465 ms (list, dark), 535 ms (list, light), 363 ms (List → Grid toggle). All 280 row DOM nodes and 300 SVG previews mount at once. Scrolling itself is smooth: list p95 16.8 ms per frame, grid avg 18.1 ms / p95 17.5 ms, no long tasks while scrolling. The only stalls >50 ms coincided with CLI screenshot/eval calls. The cost grows linearly with design count.
- Screenshots: [020-home300-list](../evidence/shots/f1d/dark/020-home300-list.png), [022-home300-grid](../evidence/shots/f1d/dark/022-home300-grid.png), [120-home300-list](../evidence/shots/f1d/light/120-home300-list.png), [040-home300-list](../evidence/shots/vf1d/dark/040-home300-list.png)
- Network: `longtask 465ms after designs render (dark)`; `longtask 535ms (light)`; `longtask 363ms on Grid toggle`
- Census: `census/f1d-home300-list-dark-1440.json`
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:383` — visible.map renders all rows
- Code: `src/core/frontend/src/screens/home/SchematicThumbnail.tsx:49` — buildSchematicPreviewGeometry + full SVG per row, eagerly
- Suggested fix: HomeScreen.tsx:356 (grid) and :383 (list): virtualize with @tanstack/react-virtual (fixed 64 px list rows) or at minimum add content-visibility:auto + contain-intrinsic-size to DesignListRow/DesignCard and lazy-build thumbnails with IntersectionObserver in SchematicThumbnail.tsx:52 (buildSchematicPreviewGeometry runs eagerly per row).
- Verification (vf1d): **confirmed** — Reproduced with the f1d Home mock (300 designs cloned from real previews): long task 548 ms on first list render, 458 ms List->Grid, 383 ms Grid->List; 920 SVG elements mounted at once. Baseline on the real stack (23 designs): 117 ms long task on Home entry, so cost scales with design count. S4 kept (only large libraries hit it; scrolling itself is smooth per f1d). · evidence: [040-home300-list](../evidence/shots/vf1d/dark/040-home300-list.png), longtask 548 ms (list render), 458 ms (grid toggle), 383 ms (list toggle); real 23 designs: 117 ms

</details>


## T-043

**Home view (List/Grid), sort and filter reset on every reload and every time you leave Home**

- Severity **S4** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate XS
- Findings: Q1-010

**Summary.** All three are component useState in HomeScreen, which unmounts on navigation; nothing is written to storage (localStorage only holds theme + starred/archived).

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:117` — filter/sort/view are plain useState

**Proposed fix.** Persist Home view/sort/filter in localStorage (like openpcb.library.view). — Detail: HomeScreen.tsx:117-119: back view/sort/filter with a small try/catch localStorage hook (keys openpcb.home.view / .sort / .filter), mirroring openpcb.library.view in the Library space.

**Evidence.** [011-grid](../evidence/shots/q1/dark/011-grid.png)

<details><summary>Q1-010 — Home view (List/Grid), sort and filter reset on every reload and every time you leave Home (S4, confirmed)</summary>

- Area home · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Home: switch to Grid, sort by Created, pick filter 'Starred'
  2. Reload the app → List / Modified / All designs again
  3. Or: set Grid + Starred, click rail 'Library', then rail 'Home' → back to List / All designs
- Expected: The chosen view mode (and ideally sort + filter) persist per user across navigation and restarts, like the designer dock/tab state does (openpcb:designer:dock-*).
- Actual: All three are component useState in HomeScreen, which unmounts on navigation; nothing is written to storage (localStorage only holds theme + starred/archived).
- Screenshots: [011-grid](../evidence/shots/q1/dark/011-grid.png), [012-after-reload](../evidence/shots/q1/dark/012-after-reload.png)
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:117` — filter/sort/view are plain useState
- Suggested fix: HomeScreen.tsx:117-119: back view/sort/filter with a small try/catch localStorage hook (keys openpcb.home.view / .sort / .filter), mirroring openpcb.library.view in the Library space.
- Verification (vq1): **confirmed** — Reproduced: set Grid + sort Name + filter Starred, rail Library → Home: back to List / Modified / All designs. localStorage keys hold only theme, starred/archived, designer and library keys (openpcb.library.view exists — Library persists its view per D11, Home does not). HomeScreen.tsx:116-119 plain useState. Severity recalibrated S3 → S4: no data/function impact, preference polish (the sibling-screen inconsistency with Library is noted).

</details>


## T-044

**Archive, unarchive and delete give no feedback and no undo**

- Severity **S4** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate S
- Findings: Q1-020

**Summary.** No toast/status/aria-live output at all (queried [role=status],[role=alert],[aria-live] → []); archived designs just disappear, which reads like data loss; after delete the selection jumps to the first row instead of the neighbour.

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:209` — delete success path: no notice

**Proposed fix.** Toast with Undo after Archive/Unarchive/Delete (delete = confirm + toast). — Detail: Add a kit notice (role=status) on archive/unarchive ('Archived X · Undo' → toggleArchive) and delete ('Deleted X'); after removal select the next neighbour instead of visible[0] (HomeScreen.tsx:246-252).

**Evidence.** [018-after-archive](../evidence/shots/q1/dark/018-after-archive.png)

<details><summary>Q1-020 — Archive, unarchive and delete give no feedback and no undo (S4, confirmed)</summary>

- Area home · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Home: archive a design from '…' → it silently vanishes from the list
  2. Delete a design → modal closes, row vanishes, selection jumps to the top row
- Expected: A brief status/toast ('Archived QA-q1-alpha · Undo', 'Deleted QA-q1-menu-n') with role=status so the action is confirmed (and archive is reversible in place).
- Actual: No toast/status/aria-live output at all (queried [role=status],[role=alert],[aria-live] → []); archived designs just disappear, which reads like data loss; after delete the selection jumps to the first row instead of the neighbour.
- Screenshots: [018-after-archive](../evidence/shots/q1/dark/018-after-archive.png), [056-after-delete](../evidence/shots/q1/light/056-after-delete.png)
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:209` — delete success path: no notice
- Code: `src/core/frontend/src/screens/home/useDesignUserState.ts:58` — toggleArchive: no notice/undo
- Suggested fix: Add a kit notice (role=status) on archive/unarchive ('Archived X · Undo' → toggleArchive) and delete ('Deleted X'); after removal select the next neighbour instead of visible[0] (HomeScreen.tsx:246-252).
- Verification (vq1): **confirmed** — Verified: after deleting own QA-q1-vq1-stray via the modal, [role=status],[role=alert],[aria-live] → []; selection jumped to QA-q1-vq1-b (top row). Archive silently removes the row. HomeScreen.tsx:209-210, useDesignUserState.ts:58-64. S4 kept.

</details>


## T-045

**Deleting a design that is open in a Designer tab fires 404s for it when Designer is reopened**

- Severity **S4** · category console · status confirmed · themes dark
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate XS
- Findings: Q1-021

**Summary.** Tab is pruned eventually, but first 4 requests for the deleted design 404 (console errors): PUT active-design, GET …/projection/schematic, …/history, …/comments.

**Root cause.** `src/modules/designer/frontend/Space.tsx:510` — pruneMissing runs once after designs load; active-tab fetches are not gated on it

**Proposed fix.** On design delete, close its tab and drop cached state (no 404 fetches). — Detail: In designer Space.tsx gate the active design's projection/history/comments fetches and the active-design PUT until the first designs load + pruneMissing (designsLoadedRef, :510-519) has run, or treat a 404 on projection as 'design gone → closeTab'. Do not import the designer tabs store from core HomeScreen (layer rule).

**Evidence.** [004-designer-after-delete](../evidence/shots/vq1/dark/004-designer-after-delete.png)

<details><summary>Q1-021 — Deleting a design that is open in a Designer tab fires 404s for it when Designer is reopened (S4, confirmed)</summary>

- Area home · stack A · design 82773719 (QA-q1-stray) · themes dark · viewports 1440x900
- Repro:
  1. Open own design QA-q1-stray in Designer (tab stays open)
  2. Home → its '…' → Delete → Delete
  3. Click rail 'Designer'
- Expected: Home delete closes/prunes the tab immediately; no requests for the deleted id.
- Actual: Tab is pruned eventually, but first 4 requests for the deleted design 404 (console errors): PUT active-design, GET …/projection/schematic, …/history, …/comments.
- Screenshots: [004-designer-after-delete](../evidence/shots/vq1/dark/004-designer-after-delete.png), [030-designer-after-delete](../evidence/shots/q1/dark/030-designer-after-delete.png)
- Console: `404 /api/modules/designer/active-design`; `404 /api/modules/designer/designs/82773719-…/projection/schematic`; `404 …/history?sessionId=designer-ui-session`; `404 …/comments?surface=schematic`
- Code: `src/modules/designer/frontend/Space.tsx:510` — pruneMissing runs once after designs load; active-tab fetches are not gated on it
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:198` — delete success path
- Suggested fix: In designer Space.tsx gate the active design's projection/history/comments fetches and the active-design PUT until the first designs load + pruneMissing (designsLoadedRef, :510-519) has run, or treat a 404 on projection as 'design gone → closeTab'. Do not import the designer tabs store from core HomeScreen (layer rule).
- Verification (vq1): **confirmed** — Reproduced: own design QA-q1-vq1-stray open in a Designer tab, deleted from Home, then rail Designer → 4 console errors: 404 PUT /active-design, 404 …/031125da…/projection/schematic, …/history?sessionId=designer-ui-session, …/comments?surface=schematic; tab then pruned (title fell back to QA-q1-vq1-a). Cause: Space.tsx:510-519 prunes tabs only after the design list loads, but the active-tab fetches start earlier. Note q1's suggested fix (HomeScreen touching the designer tabs store) would violate the core→module layering rule. S4 kept. · evidence: [004-designer-after-delete](../evidence/shots/vq1/dark/004-designer-after-delete.png)

</details>


## T-046

**Long design names can't be read in full on Home (no tooltip in list/grid, detail panel only truncates)**

- Severity **S4** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate XS
- Findings: Q1-023

**Summary.** Truncation itself is clean (ellipsis in list 286px, grid 231px, detail header, designer tab), but list rows and grid cards have no title/tooltip; only the detail header has title=. Delete modal wraps the full name correctly.

**Root cause.** `src/core/frontend/src/screens/home/DesignListRow.tsx:40` — name div without title

**Proposed fix.** Title tooltip on truncated names (list, grid, detail panel wraps to 2 lines). — Detail: Add title={design.name} at DesignListRow.tsx:40 and DesignCard.tsx:204.

**Evidence.** [036-long-name-list](../evidence/shots/q1/dark/036-long-name-list.png)

<details><summary>Q1-023 — Long design names can't be read in full on Home (no tooltip in list/grid, detail panel only truncates) (S4, confirmed)</summary>

- Area home · stack A · design e154d769 (QA-q1-LONG…, 120 chars, deleted after test) · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Create a design and rename it (designer tab) to a 120-char name
  2. Home List, Grid and detail panel; hover the names
- Expected: Truncated names reveal the full text (title/tooltip) everywhere; detail panel shows the full name wrapped in its body.
- Actual: Truncation itself is clean (ellipsis in list 286px, grid 231px, detail header, designer tab), but list rows and grid cards have no title/tooltip; only the detail header has title=. Delete modal wraps the full name correctly.
- Screenshots: [036-long-name-list](../evidence/shots/q1/dark/036-long-name-list.png), [037-long-name-grid](../evidence/shots/q1/dark/037-long-name-grid.png), [035-long-name-designer-tab](../evidence/shots/q1/dark/035-long-name-designer-tab.png), [057-delete-modal-long-name](../evidence/shots/q1/light/057-delete-modal-long-name.png)
- Code: `src/core/frontend/src/screens/home/DesignListRow.tsx:40` — name div without title
- Code: `src/core/frontend/src/screens/home/DesignCard.tsx:204` — h3 without title
- Suggested fix: Add title={design.name} at DesignListRow.tsx:40 and DesignCard.tsx:204.
- Verification (vq1): **confirmed** — Code-verified (S4): DesignListRow.tsx:40 name div and DesignCard.tsx:204 h3 have no title; only DesignDetailPanel.tsx:43 sets title. q1's 120-char repro screenshots show clean ellipsis without a way to read the full name. S4 kept. · evidence: [036-long-name-list](../evidence/shots/q1/dark/036-long-name-list.png), [037-long-name-grid](../evidence/shots/q1/dark/037-long-name-grid.png)

</details>


## T-047

**Empty/first-run Home offers only 'New design' (no Import KiCad…), keeps a 300px 'Select a design' panel and 'Enter to open' hint; no-results state has no 'Clear search'**

- Severity **S4** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate XS
- Findings: Q1-024

**Summary.** Only 'New design'; right panel says 'Select a design' although there is nothing to select; status bar still 'Enter to open · N new'; 'No matching designs — Try a different filter or search term' with no clear action.

**Root cause.** `src/core/frontend/src/screens/HomeScreen.tsx:318` — emptyState: single New design button

**Proposed fix.** First-run empty state offers New design + Import KiCad…; hide detail panel/Enter hint when list is empty; no-results state with Clear search. — Detail: HomeScreen.tsx emptyState: add outline 'Import KiCad project…' next to New design when designs.length===0, and a 'Clear search' button (setQuery('')) when query is set; hide DesignDetailPanel when visible.length===0.

**Evidence.** [034-empty-state](../evidence/shots/q1/dark/034-empty-state.png)

<details><summary>Q1-024 — Empty/first-run Home offers only 'New design' (no Import KiCad…), keeps a 300px 'Select a design' panel and 'Enter to open' hint; no-results state has no 'Clear search' (S4, confirmed)</summary>

- Area home · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Mock GET designs → {ok:true,data:{designs:[]}} and reload
  2. Separately search 'zzqx'
- Expected: First-run state offers both primary entry points (New design / Import KiCad project…); the empty detail panel is hidden or explains itself; the no-results state offers 'Clear search'.
- Actual: Only 'New design'; right panel says 'Select a design' although there is nothing to select; status bar still 'Enter to open · N new'; 'No matching designs — Try a different filter or search term' with no clear action.
- Screenshots: [034-empty-state](../evidence/shots/q1/dark/034-empty-state.png), [008-search-noresults](../evidence/shots/q1/dark/008-search-noresults.png)
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:318` — emptyState: single New design button
- Code: `src/core/frontend/src/screens/home/DesignDetailPanel.tsx:30` — 'Select a design' placeholder
- Suggested fix: HomeScreen.tsx emptyState: add outline 'Import KiCad project…' next to New design when designs.length===0, and a 'Clear search' button (setQuery('')) when query is set; hide DesignDetailPanel when visible.length===0.
- Verification (vq1): **confirmed** — Code-verified (S4): emptyState (HomeScreen.tsx:318-341) offers only 'New design' although Import KiCad… exists in the header (D6/D13 entry point); no 'Clear search' when query is set; DesignDetailPanel.tsx:30-35 shows 'Select a design' with nothing selectable; footer hint (:525) static. S4 kept. · evidence: [034-empty-state](../evidence/shots/q1/dark/034-empty-state.png), [008-search-noresults](../evidence/shots/q1/dark/008-search-noresults.png)

</details>


## T-048

**Right-clicking a design row/card shows the generic 'OpenPCB › Settings' menu instead of design actions**

- Severity **S4** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner C1 · wave W2 · scope frontend · estimate S
- Findings: Q1-026
- Depends on: ['T-024']

**Summary.** The app-wide menu with a single 'Settings' item appears; per-design actions are only reachable via the 22px '…' in the grid card footer or the detail panel header (list rows have no '…'). The detail panel also has no star toggle (Starred Yes/No is read-only text).

**Root cause.** `src/core/frontend/src/AppShell.tsx:63` — single shell-level onContextMenu

**Proposed fix.** Design row/card context menu = same actions as More actions (after F0b handler fix). — Detail: DesignListRow.tsx:28 / DesignCard.tsx:195: onContextMenu → e.preventDefault(); e.stopPropagation(); select row; openContextMenu({scope:'home', groups:[Open, Star/Unstar, Archive/Unarchive, Delete…]}).

**Evidence.** [060-ctx-menu-light](../evidence/shots/q1/light/060-ctx-menu-light.png)

<details><summary>Q1-026 — Right-clicking a design row/card shows the generic 'OpenPCB › Settings' menu instead of design actions (S4, confirmed)</summary>

- Area home · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Home List: right-click a design row (700,150)
  2. Grid: right-click a card
- Expected: A design context menu (Open, Star/Unstar, Archive, Delete…) as in KiCad/Altium project managers — right-click is the primary way pros act on list items.
- Actual: The app-wide menu with a single 'Settings' item appears; per-design actions are only reachable via the 22px '…' in the grid card footer or the detail panel header (list rows have no '…'). The detail panel also has no star toggle (Starred Yes/No is read-only text).
- Screenshots: [060-ctx-menu-light](../evidence/shots/q1/light/060-ctx-menu-light.png)
- Code: `src/core/frontend/src/AppShell.tsx:63` — single shell-level onContextMenu
- Code: `src/core/frontend/src/screens/home/DesignListRow.tsx:28` — no onContextMenu
- Suggested fix: DesignListRow.tsx:28 / DesignCard.tsx:195: onContextMenu → e.preventDefault(); e.stopPropagation(); select row; openContextMenu({scope:'home', groups:[Open, Star/Unstar, Archive/Unarchive, Delete…]}).
- Verification (vq1): **confirmed** — Code-verified + q1 evidence: DesignListRow/DesignCard have no onContextMenu, so the AppShell handler (AppShell.tsx:63-84) shows the generic 'OpenPCB › Settings' menu on a design row; list rows have no '…' either. Distinct from Q1-006 (inputs/clipboard) though both live in the same AppShell handler. S4 kept. · evidence: [060-ctx-menu-light](../evidence/shots/q1/light/060-ctx-menu-light.png)

</details>

