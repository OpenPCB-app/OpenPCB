# designer.shell — QA findings

[← index](../README.md) · 10 triage entries · S1 0 · S2 1 · S3 6 · S4 3

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-081](#t-081) | S2 | Design tab strip overflows silently: at 1100×720 with 4 open designs the ACTIVE tab and the '+' New design button are scrolled out of view with no indicator | Q3-026 | fix-now | D1 / W2 | frontend | S |
| [T-082](#t-082) | S3 | Designer toast is off-token (raw red/amber, backdrop-blur, shadow), has no role/aria-live, lasts only 3 s even for errors and covers header controls | F1A-009 | fix-now | F0b / F0b | frontend | S |
| [T-083](#t-083) | S3 | Designer error strip: raw 'Internal error' repeated, never clears, shifts canvas; spurious 'Nothing to undo' error | F1A-010, F1B-012 | fix-now | D1 / W2 | frontend | S |
| [T-084](#t-084) | S3 | Designer forgets view/camera: returning from Settings or reload reopens on Schematic | Q2-025, F2A-013 | fix-now | D1 / W2 | frontend | S |
| [T-085](#t-085) | S3 | Designer no-design state: no 'Import KiCad', dead Outline/view tabs, squashed unsorted 'Open existing' list | Q3-002, Q3-003, Q8-029, Q3-032 | fix-now | D1 / W2 | frontend | S |
| [T-086](#t-086) | S3 | Active design tab revision badge goes stale after edits (shows r0 while design is at r3) | Q3-006 | fix-now | D1 / W2 | frontend | S |
| [T-087](#t-087) | S3 | Designer shell/schematic keyboard a11y gaps: design tabs unreachable, no focus ring on view/dock tabs, unnamed tablist/separators, palette & outline lack list semantics | Q3-033 | fix-now | D1 / W2 | frontend | M |
| [T-088](#t-088) | S4 | Opening a design briefly shows 'No design open' + 'Empty design', and loading views show confident zeros ('0 DRC', 'All 0', '$0.00', 'Synced with schematic') | F1A-007 | fix-now | D1 / W2 | frontend | S |
| [T-089](#t-089) | S4 | Status-bar selection segment hard-clips long names mid-glyph with no ellipsis ('Text · Long PCB overlay text for silkscreen overlap Q') | F1B-020 | fix-now | D1 / W2 | frontend | XS |
| [T-090](#t-090) | S4 | Minor shell state issues: left sidebar width not persisted (dock width is), status bar keeps the previous design's cursor X/Y | Q3-036 | fix-now | D1 / W2 | frontend | XS |

## T-081

**Design tab strip overflows silently: at 1100×720 with 4 open designs the ACTIVE tab and the '+' New design button are scrolled out of view with no indicator**

- Severity **S2** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate S
- Findings: Q3-026

**Summary.** The design-tab region is capped at the left 1fr of a 1fr/auto/1fr grid (383 px). Tabs keep min-width 120 px, so only 'S3 LLM Ed…', 'S3 LLM Ed…', 'QA-Q3-em…' are visible; the active 'QA-Q3-sandbox' tab (x=440) and the '+' button sit under the view tabs area, hidden by overflow-x:auto with scrollbar-width:none — no visual cue, no keyboard access. At 1440×900 the same 4 tabs are already truncated to 'QA-Q…' while ~250…

**Root cause.** `src/modules/designer/frontend/components/DesignerHeader.tsx:42` — grid-cols-[1fr_auto_1fr] limits tabs to half the free width

**Proposed fix.** Tab strip overflow: keep active tab in view, scroll buttons/overflow menu, '+' pinned outside the scroller. — Detail: Let the tab region take the remaining width (e.g. grid-cols-[minmax(0,1fr)_auto_auto]), allow tabs to shrink to ~80 px, scrollIntoView the active tab on change, and add overflow chevrons or an 'open tabs' dropdown; keep '+' outside the scroller.

**Evidence.** [091-schem-1100](../evidence/shots/q3/dark/091-schem-1100.png), [027-tabs-1100](../evidence/shots/vq3/dark/027-tabs-1100.png)

<details><summary>Q3-026 — Design tab strip overflows silently: at 1100×720 with 4 open designs the ACTIVE tab and the '+' New design button are scrolled out of view with no indicator (S2, confirmed)</summary>

- Area designer.shell · stack A · design None · themes dark · viewports 1100x720, 1440x900
- Repro:
  1. Open 4 designs (12V params, additive v2, QA-Q3-empty, QA-Q3-sandbox) with QA-Q3-sandbox active
  2. Resize the window to 1100×720 (Electron minimum)
- Expected: Active tab always visible; overflow shown via chevrons/scroll buttons or a tab-list dropdown; '+' always reachable; tabs shrink before disappearing
- Actual: The design-tab region is capped at the left 1fr of a 1fr/auto/1fr grid (383 px). Tabs keep min-width 120 px, so only 'S3 LLM Ed…', 'S3 LLM Ed…', 'QA-Q3-em…' are visible; the active 'QA-Q3-sandbox' tab (x=440) and the '+' button sit under the view tabs area, hidden by overflow-x:auto with scrollbar-width:none — no visual cue, no keyboard access. At 1440×900 the same 4 tabs are already truncated to 'QA-Q…' while ~250 px of empty header remain on the right.
- Screenshots: [091-schem-1100](../evidence/shots/q3/dark/091-schem-1100.png), [066-footprint-variant-menu](../evidence/shots/q3/dark/066-footprint-variant-menu.png)
- Code: `src/modules/designer/frontend/components/DesignerHeader.tsx:42` — grid-cols-[1fr_auto_1fr] limits tabs to half the free width
- Code: `src/modules/designer/frontend/components/DesignTabs.tsx:327` — overflow-x-auto + scrollbarWidth:none; min-w-[120px] per tab; no scrollIntoView for active tab
- Suggested fix: Let the tab region take the remaining width (e.g. grid-cols-[minmax(0,1fr)_auto_auto]), allow tabs to shrink to ~80 px, scrollIntoView the active tab on change, and add overflow chevrons or an 'open tabs' dropdown; keep '+' outside the scroller.
- Verification (vq3): **confirmed** — Reproduced at 1100×720 with four tabs open. The tab scroller spans x=80–463 (scrollWidth 506 > clientWidth 383). The active tab 'QA-Q3-sandbox' sits at x=440–560, under the view-tab strip, and the '+' button is off-screen, with no scrollbar or chevrons (scrollbarWidth:none). Design tabs are also not keyboard-focusable (tabIndex −1), so a horizontal trackpad scroll is the only way to reach them. The header grid 1fr/auto/1fr limits tabs to about half the free width, so at 1440 px five tabs (5×120 px min-width > ≈550 px) overflow the same way. S2 kept: the active design is hidden at the supported minimum window size. · evidence: [027-tabs-1100](../evidence/shots/vq3/dark/027-tabs-1100.png), [028-stale-cursor-after-tab-switch](../evidence/shots/vq3/dark/028-stale-cursor-after-tab-switch.png)

</details>


## T-082

**Designer toast is off-token (raw red/amber, backdrop-blur, shadow), has no role/aria-live, lasts only 3 s even for errors and covers header controls**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0b · wave F0b · scope frontend · estimate S
- Findings: F1A-009 · known ref K10
- Depends on: ['T-004']

**Summary.** Container and items have no role or aria-live, so screen readers never announce them. Classes are 'rounded-md border … shadow-sm backdrop-blur border-red-300 bg-red-50 text-red-700 dark:bg-red-950 …' (computed backdrop-filter blur(8px), box-shadow 0 1px 3px). Pixel probes: dark error bg #460809 (ΔE 25.7 vs --status-danger-soft), dark warning bg #461901 (ΔE 23.9 vs --status-warning-soft), light error bg #fef2f2 (red-…

**Root cause.** `src/modules/designer/frontend/hooks/use-toast.tsx:81` — raw palette + shadow-sm + backdrop-blur, no role/aria-live

**Proposed fix.** Rebuild use-toast on kit Toast: tokens, role=status/alert + aria-live, errors persist until dismissed, positioned below header controls. — Detail: Replace ToastViewport with the shared kit notice (or port Library's NoticeViewport): bg-surface-raised with border-status-danger and a text-status-* accent, no blur or shadow, role='status' (role='alert' for errors) on an aria-live region, a 20 px IconButton close, errors sticky until dismissed and others ~5 s. Place it below the header (top: 34px + 8px) or bottom-right above the status bar. Prefix messages with the action ('Couldn't place Capacitor: …').

**Evidence.** [110-k10-error-toast-1440](../evidence/shots/f1a/dark/110-k10-error-toast-1440.png), [110-k10-error-toast-1440](../evidence/shots/vf1a/dark/110-k10-error-toast-1440.png)

<details><summary>F1A-009 — Designer toast is off-token (raw red/amber, backdrop-blur, shadow), has no role/aria-live, lasts only 3 s even for errors and covers header controls (S3, confirmed)</summary>

- Area designer.shell · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Error toast: route '**/library/components/*/placement' → 500; Schematic Cmd+K, type 'Capacitor', Enter (Space.tsx:698)
  2. Warning toast: BOM line whose refs have no placementId (mocked GET /bom), inspector 'PCB' (Space.tsx:895)
  3. Inspect the toast DOM, time its lifetime, probe colours in both themes, repeat at 1100×720
- Expected: Kit notice: token colours (--status-danger / --status-danger-soft), no blur or shadow, role=status or alert with aria-live, errors persist until dismissed, a ≥20 px dismiss target, and placement clear of header controls.
- Actual: Container and items have no role or aria-live, so screen readers never announce them. Classes are 'rounded-md border … shadow-sm backdrop-blur border-red-300 bg-red-50 text-red-700 dark:bg-red-950 …' (computed backdrop-filter blur(8px), box-shadow 0 1px 3px). Pixel probes: dark error bg #460809 (ΔE 25.7 vs --status-danger-soft), dark warning bg #461901 (ΔE 23.9 vs --status-warning-soft), light error bg #fef2f2 (red-50) and light warning #fffbeb (amber-50). Both auto-dismiss after ~3.05 s, including errors. The '×' button is named 'Dismiss' but is a 7×15 px glyph in raw slate-400. At top-right it covers 'Assistant', 'Toggle side panel' and 'ERC' (1440), plus the BOM inspector's 'Show in schematic' / 'PCB' links the user just clicked. At 1100 it covers 'Assistant' and 'Toggle side panel'. The error text is the raw problem title 'Internal error' with no mention of the failed part placement.
- Screenshots: [110-k10-error-toast-1440](../evidence/shots/f1a/dark/110-k10-error-toast-1440.png), [111-k10-warning-toast-1440](../evidence/shots/f1a/dark/111-k10-warning-toast-1440.png), [110-k10-error-toast-1100](../evidence/shots/f1a/dark/110-k10-error-toast-1100.png), [110-k10-error-toast-1440](../evidence/shots/f1a/light/110-k10-error-toast-1440.png), [111-k10-warning-toast-1440](../evidence/shots/f1a/light/111-k10-warning-toast-1440.png)
- Network: `GET /api/modules/designer/library/components/openpcb.core.passive.capacitor/placement → 500 (injected)`
- Pixel probes: {"file": "shots/f1a/dark/110-k10-error-toast-1440.png", "x": 1330, "y": 20, "hex": "#460809", "nearestToken": "--status-danger-soft@app", "deltaE": 25.7}; {"file": "shots/f1a/dark/111-k10-warning-toast-1440.png", "x": 1183, "y": 20, "hex": "#461901", "nearestToken": "--status-warning-soft@app", "deltaE": 23.9}; {"file": "shots/f1a/light/110-k10-error-toast-1440.png", "x": 1325, "y": 16, "hex": "#fef2f2", "nearestToken": "--primary-foreground", "deltaE": 4.3}; {"file": "shots/f1a/light/111-k10-warning-toast-1440.png", "x": 1183, "y": 16, "hex": "#fffbeb", "nearestToken": "--surface-input", "deltaE": 8.4}
- Code: `src/modules/designer/frontend/hooks/use-toast.tsx:81` — raw palette + shadow-sm + backdrop-blur, no role/aria-live
- Code: `src/modules/designer/frontend/hooks/use-toast.tsx:32` — default duration 3000 ms for every variant, including error
- Code: `src/modules/designer/frontend/hooks/use-toast.tsx:77` — fixed right-3 top-3 overlays the 34 px header controls
- Suggested fix: Replace ToastViewport with the shared kit notice (or port Library's NoticeViewport): bg-surface-raised with border-status-danger and a text-status-* accent, no blur or shadow, role='status' (role='alert' for errors) on an aria-live region, a 20 px IconButton close, errors sticky until dismissed and others ~5 s. Place it below the header (top: 34px + 8px) or bottom-right above the status bar. Prefix messages with the action ('Couldn't place Capacitor: …').
- Verification (vf1a): **confirmed** — Reproduced in both themes: route **/library/components/*/placement -> 500, Schematic Cmd+K 'Capacitor' Enter -> toast 'Internal error ×' at (1321,12) 107×33. No role/aria-live on toast or container; classes 'rounded-md … shadow-sm backdrop-blur border-red-300 bg-red-50 … dark:bg-red-950'; computed backdrop-filter blur(8px) and box-shadow 0 1px 3px; 'Dismiss' button 7×15 px in slate (#7f7f84). Gone at 3.1 s (error variant uses the 3000 ms default). Covers 'Assistant', 'Toggle side panel', 'ERC'. Probes: dark bg #460809 ΔE 25.7 vs --status-danger-soft, border #82181a ΔE 32.2 vs --status-danger; light bg #fef2f2 (red-50), border #ffa2a2 ΔE 34.6. Confirms K10. S3 kept. · evidence: [110-k10-error-toast-1440](../evidence/shots/vf1a/dark/110-k10-error-toast-1440.png), [110-k10-error-toast-1440](../evidence/shots/vf1a/light/110-k10-error-toast-1440.png), probe dark (1330,20) #460809 --status-danger-soft ΔE 25.7; (1321,20) #82181a --status-danger ΔE 32.2, probe light (1330,20) #fef2f2 ΔE 4.3 to --primary-foreground (raw red-50); (1321,20) #ffa2a2 ΔE 34.6

</details>


## T-083

**Designer error strip: raw 'Internal error' repeated, never clears, shifts canvas; spurious 'Nothing to undo' error**

- Severity **S3** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate S
- Findings: F1A-010, F1B-012 · known ref K40
- Depends on: ['T-004', 'T-006']

**Summary.** Positives: no divergence or data loss. Every edit rolls back (server stayed at rev 19, and the UI matched after reload), the route session survives a failed commit, and pressing Enter again once online commits it (rev 21) without a reload. Messaging: one PCB failure shows the raw title 'Internal error' (or 'Failed to fetch' offline) three times: the designer header strip (from the earlier schematic failure), a canva… | Also covers: F1B-012: Undo stays enabled after the last step; the extra click shows a red 'Nothing to undo' err…

**Root cause.** `src/modules/designer/frontend/Space.tsx:1303` — header error strip: raw state.error, inserted as a 24 px row, no dismiss/retry, not cleared by PCB commands

**Proposed fix.** Designer error strip -> non-layout-shifting kit Banner with problem.ts copy, dedupe, dismiss + auto-clear on next success; Undo/Redo disabled at history ends, 'Nothing to undo' silent. — Detail: Route command failures through one surface. Wrap errors with the operation name in usePcbWorkspace/useDesignerWorkspace (e.g. setError(`Move failed: ${msg}`)) and map TypeError 'Failed to fetch' to 'Can't reach the OpenPCB backend'. Make the header strip dismissible, overlay it instead of inserting a row, and clear it on any successful command. Drop the duplicate Board-panel copy.

**Evidence.** [082-cmd500-schem-move-3s](../evidence/shots/f1a/dark/082-cmd500-schem-move-3s.png), [111-cmd500-schem-move](../evidence/shots/vf1a/dark/111-cmd500-schem-move.png), [010-outline-filter](../evidence/shots/f1b/dark/010-outline-filter.png)

<details><summary>F1A-010 — Failed designer commands show a context-free raw 'Internal error'/'Failed to fetch' up to three times; the header strip never clears and shifts the whole layout (S3, confirmed)</summary>

- Area designer.shell · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. route '**/api/modules/designer/designs/*/commands' → 500 problem+json {title:'Internal error'}
  2. Schematic: drag R2 (move_part) → header strip. Draw a wire J1.5 → R2.2
  3. PCB: drag R2, R route J2 → R2 + Enter, V via + Enter, select a trace + Delete, flip C1
  4. unroute; do a successful PCB move; reload and diff GET /designs/{id} with what the UI showed
  5. Offline (network-state-set offline): PCB move/route/delete, schematic Value '10k' + Enter
- Expected: Each failure says what failed ('Couldn't move R2 — server error') in one place, with Retry/Dismiss, and clears once the backend recovers.
- Actual: Positives: no divergence or data loss. Every edit rolls back (server stayed at rev 19, and the UI matched after reload), the route session survives a failed commit, and pressing Enter again once online commits it (rev 21) without a reload. Messaging: one PCB failure shows the raw title 'Internal error' (or 'Failed to fetch' offline) three times: the designer header strip (from the earlier schematic failure), a canvas toast with shadow-lg that auto-hides after 6 s, and a Board-panel inline box. None names the operation. The header strip (Space.tsx state.error) persists across views and after successful PCB commands, has no dismiss or retry, and inserts a 24 px row that pushes the toolbar and canvas down (a layout jump mid-drag). Offline, a schematic Value edit just reverts the field to empty: the typed '10k' is lost and only the generic strip explains it. After the wire commit fails, the rubber-band wire stays live from J1.5 with no failure hint at the wire. No white screen and no uncaught errors for these paths.
- Screenshots: [082-cmd500-schem-move-3s](../evidence/shots/f1a/dark/082-cmd500-schem-move-3s.png), [086-cmd500-wire-after-mousemove](../evidence/shots/f1a/dark/086-cmd500-wire-after-mousemove.png), [089-cmd500-pcb-move](../evidence/shots/f1a/dark/089-cmd500-pcb-move.png), [092-cmd500-route-enter](../evidence/shots/f1a/dark/092-cmd500-route-enter.png), [097-cmd500-delete-2s](../evidence/shots/f1a/dark/097-cmd500-delete-2s.png), [098-after-unroute-successful-move](../evidence/shots/f1a/dark/098-after-unroute-successful-move.png), [102-offline-route-commit](../evidence/shots/f1a/dark/102-offline-route-commit.png), [105-offline-schem-value](../evidence/shots/f1a/dark/105-offline-schem-value.png), [082-cmd500-schem-strip-1100](../evidence/shots/f1a/light/082-cmd500-schem-strip-1100.png), [090-cmd500-pcb-flip-toast-1100](../evidence/shots/f1a/light/090-cmd500-pcb-flip-toast-1100.png)
- Network: `POST /commands → 500 ×8 (move_part, create_wire, pcb_move_placement, pcb_commit_route ×2, pcb_delete_trace, pcb_flip_placement)`; `GET /designs/91573bb6… after unroute → revision 19 unchanged, positions unchanged`
- Code: `src/modules/designer/frontend/Space.tsx:1303` — header error strip: raw state.error, inserted as a 24 px row, no dismiss/retry, not cleared by PCB commands
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6310` — second copy as a role=alert toast (shadow-lg, 6 s timer at :5427)
- Code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:513` — third copy inline in the Board panel (visible when nothing is selected)
- Suggested fix: Route command failures through one surface. Wrap errors with the operation name in usePcbWorkspace/useDesignerWorkspace (e.g. setError(`Move failed: ${msg}`)) and map TypeError 'Failed to fetch' to 'Can't reach the OpenPCB backend'. Make the header strip dismissible, overlay it instead of inserting a row, and clear it on any successful command. Drop the duplicate Board-panel copy.
- Verification (vf1a): **confirmed** — Reproduced: route **/designs/*/commands -> 500. Schematic drag R2 -> header strip 'Internal error' (80,34 1360×24) pushes the toolbar from y=34 to y=58. PCB drag C1 -> the same strip plus a role=alert canvas toast 'Internal error ×' (auto-hides after 6 s, has a Dismiss button); the move rolled back (server unchanged). After unroute, a successful PCB move (rev 34->35) left the header strip in place. The third copy (PcbBoardPanel.tsx:513) renders only when nothing is selected, per the code; with a selection the dock shows the part instead. Messages never name the operation. Confirms K40 for designer commands. S3 kept (no data divergence). · evidence: [111-cmd500-schem-move](../evidence/shots/vf1a/dark/111-cmd500-schem-move.png), [114-cmd500-pcb-move-3copies](../evidence/shots/vf1a/dark/114-cmd500-pcb-move-3copies.png), [115-after-unroute-successful-move-strip-stays](../evidence/shots/vf1a/dark/115-after-unroute-successful-move-strip-stays.png), DOM: schem toolbar top 34 -> 58 after the strip appears; strip still present after pcb_move_placement ok rev 35

</details>

<details><summary>F1B-012 — Undo stays enabled after the last step; the extra click shows a red 'Nothing to undo' error strip that never goes away and shifts the canvas down 24 px (S4, confirmed)</summary>

- Area designer.shell · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. After a multi-step edit, click the schematic Undo button quickly until it disables (e.g. restoring the 150-part delete)
  2. Observe the top of the designer
  3. Switch Schem → PCB → DRC → BOM
- Expected: Undo disables as soon as the last step is consumed (or queued clicks are coalesced); 'nothing to undo' is not an error — at most a transient hint.
- Actual: The button remained enabled while the previous undo was in flight; the 151st click returned ok:false and useDesignerWorkspace sets setError('Nothing to undo'). A 24 px bg-status-danger-soft strip 'Nothing to undo' appears above the toolbar (pushing every view down), has no role=alert, no close button and no timeout, and persisted through Schem/PCB/3D/BOM/DRC switches and a successful DRC run until the page was reloaded.
- Screenshots: [010-outline-filter](../evidence/shots/f1b/dark/010-outline-filter.png), [014-pcb-stacked-150](../evidence/shots/f1b/dark/014-pcb-stacked-150.png), [020-drc-view-51k](../evidence/shots/f1b/dark/020-drc-view-51k.png)
- Network: `POST /history/undo → 200 {result.ok:false}`
- Code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:593` — setError('Nothing to undo') on ok:false; error strip has no dismiss
- Suggested fix: useDesignerWorkspace.ts undo/redo: treat result.ok===false (history empty) as a silent no-op (applyHistorySnapshot only, no setError) and disable Undo/Redo while a history request is in flight. Strip dismiss and auto-clear are handled under F1A-010.
- Verification (vf1b): **confirmed** — Reproduced on QA-vf1b-stack60: with one undo step left, three quick Undo clicks produced the red 24 px 'Nothing to undo' strip (role=null, no button). It stayed through Schem -> PCB -> Schem and cleared on the next schematic history action (Redo), because refreshProjectionForDesign calls setError(null). The claim that it persists 'until reload' is overstated; it clears on the next schematic edit. With 40 ms spacing between clicks Undo disabled correctly, so this is a click race. Re-scoped and lowered to S4. The unique defect is that useDesignerWorkspace.ts:593 turns a benign ok:false (history empty) into a red error. Strip persistence, no dismiss and layout shift are already verified as F1A-010; Undo staying enabled in flight is F1A-013 (PCB path). · evidence: [025-nothing-to-undo-strip](../evidence/shots/vf1b/dark/025-nothing-to-undo-strip.png), DOM strip {t:'Nothing to undo',h:24,role:null,btns:0}; onPcb:true, back:true, afterRedo:false

</details>


## T-084

**Designer forgets view/camera: returning from Settings or reload reopens on Schematic**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate S
- Findings: Q2-025, F2A-013

**Summary.** Designer remounts and activeView resets to 'schem' (local useState), so the PCB view, zoom and selection are lost. | Also covers: F2A-013: Reload restores the open tab and undo history but not where you were: the app lands on Ho…

**Root cause.** `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:167` — useState<DesignerView>('schem')

**Proposed fix.** Persist active view + PCB camera per design tab (tabs store); restore after Settings and reload. — Detail: Persist activeView per design tab next to openpcb.designer.tabs.v1 (or in a zustand store that survives unmount) and initialise useDesignerWorkspace.ts:167 from it; longer-term keep the module screen mounted (hidden) while Settings is shown.

**Evidence.** [006-designer-pcb-before](../evidence/shots/q2/dark/006-designer-pcb-before.png), [020-designer-pcb-before](../evidence/shots/vq2/dark/020-designer-pcb-before.png), [091-before-reload-zoomed](../evidence/shots/f2a/dark/091-before-reload-zoomed.png)

<details><summary>Q2-025 — Returning from Settings (Back/Esc) resets the Designer to the Schematic view (S3, confirmed)</summary>

- Area designer.shell · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Open '555 Timer LED Blinker' in Designer, switch to PCB
  2. Open Settings (gear or Cmd+,), then Back (or Esc)
  3. Designer is back on 'Schem' (also happens via rail Home → Designer)
- Expected: Back returns to exactly the previous screen state (same view tab, camera, selection).
- Actual: Designer remounts and activeView resets to 'schem' (local useState), so the PCB view, zoom and selection are lost.
- Screenshots: [006-designer-pcb-before](../evidence/shots/q2/dark/006-designer-pcb-before.png), [007-designer-pcb-after](../evidence/shots/q2/dark/007-designer-pcb-after.png)
- Code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:167` — useState<DesignerView>('schem')
- Code: `src/core/frontend/src/AppRouter.tsx:23` — Settings route replaces (unmounts) the module screen
- Suggested fix: Persist activeView per design tab next to openpcb.designer.tabs.v1 (or in a zustand store that survives unmount) and initialise useDesignerWorkspace.ts:167 from it; longer-term keep the module screen mounted (hidden) while Settings is shown.
- Verification (vq2): **CONFIRMED** — Reproduced on B '555 Timer LED Blinker' (read-only): PCB tab selected -> Cmd+, -> Back -> Schem selected. useDesignerWorkspace.ts:167 activeView is component state; AppRouter.tsx unmounts ModuleScreen for Settings/Home, so every module switch loses view/camera/selection. Area re-tagged designer.shell. · evidence: [020-designer-pcb-before](../evidence/shots/vq2/dark/020-designer-pcb-before.png), [021-designer-after-back](../evidence/shots/vq2/dark/021-designer-after-back.png)

</details>

<details><summary>F2A-013 — Reload restores the open tab and undo history but not where you were: the app lands on Home, the design reopens on Schem (not PCB) and the PCB camera snaps back to Fit board (S3, confirmed)</summary>

- Area designer.shell · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark, light · viewports 1440x900
- Repro:
  1. QA-f2a-golden on the PCB view, zoomed onto U1 (status-bar calibration 0.0251 mm/px, origin −16.6/11.5)
  2. Reload the window (Electron: Cmd+R / crash-restart)
  3. Click Designer in the rail → view; click PCB
- Expected: Like other EDA tools, reopening restores the last active view (PCB) and its camera (zoom/pan), or at least the designer space instead of Home.
- Actual: App opens on Home; after clicking Designer the tab is restored ('QA-f2a-golden r125') but the view is Schem at 80 % around the origin (NE555 filling the canvas), and PCB opens at Fit board (0.0576 mm/px) — zoom and pan lost. Dock tab (DRC) and dock width are restored, and undo/redo history survives (PCB Cmd+Z 125→126, Schem Undo →127, Redo →128, PCB Cmd+Shift+Z →129), so only view/camera state is dropped.
- Screenshots: [091-before-reload-zoomed](../evidence/shots/f2a/dark/091-before-reload-zoomed.png), [092-after-reload](../evidence/shots/f2a/dark/092-after-reload.png), [093-after-reload-designer](../evidence/shots/f2a/dark/093-after-reload-designer.png), [094-after-reload-pcb](../evidence/shots/f2a/dark/094-after-reload-pcb.png)
- Code: `src/modules/designer/frontend/stores/designer-tabs-store.ts:28` — persists only openDesignIds/activeDesignId (openpcb.designer.tabs.v1); no per-design active view or camera
- Suggested fix: Persist per-design {activeView, pcbCamera, schematicCamera} next to openpcb.designer.tabs.v1 (or in board viewState) and restore on mount; restore the last space (Designer) on app start when a design tab was active.
- Verification (vf2a): **confirmed** — Golden PCB zoomed to 0.01799 mm/px, then reload. The app lands on Home. Designer shows the tab with the Schem view at 80 % (not PCB). PCB then opens at 0.057644 mm/px (Fit board), so zoom and pan are lost. localStorage holds only tabs, dock width/tab/open and recents; no view or camera keys. The 'lands on Home' part is the known in-memory navigation behaviour; the schematic 80 % part shares its root with Q3-004. The lost active view and PCB camera are new. S3. · evidence: [036-before-reload-pcb-zoomed](../evidence/shots/vf2a/dark/036-before-reload-pcb-zoomed.png), [037-after-reload](../evidence/shots/vf2a/dark/037-after-reload.png), [038-after-reload-designer](../evidence/shots/vf2a/dark/038-after-reload-designer.png), [039-after-reload-pcb](../evidence/shots/vf2a/dark/039-after-reload-pcb.png)

</details>


## T-085

**Designer no-design state: no 'Import KiCad', dead Outline/view tabs, squashed unsorted 'Open existing' list**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate S
- Findings: Q3-002, Q3-003, Q8-029, Q3-032 · known ref K19

**Summary.** Only 'New design' and 'Open existing' are shown; the Import button is never rendered because the visible empty-state instance is created without onImportKicad. | Also covers: Q3-003: With no design open, Designer still shows view tabs, the Outline 'Empty design' panel and…; Q8-029: Designer with no design open still shows the Outline 'Empty design' panel whose Place com…; Q3-032: Designer empty-state 'Open existing' list squashes rows to 15 px (declared 22 px), hides…

**Root cause.** `src/modules/designer/frontend/Space.tsx:1381` — DesignerEmptyState in the noTabsOpen branch has no onImportKicad

**Proposed fix.** No-design state: hide view tabs/Outline/dock; empty state offers New design, Import KiCad project…, recent designs sorted by recency with 22px rows. — Detail: Pass onImportKicad={() => setKicadImportOpen(true)} to the DesignerEmptyState at Space.tsx:1381 and delete the unreachable noTabsOpen branch in canvasContent().

**Evidence.** [001-designer-no-tabs](../evidence/shots/q3/dark/001-designer-no-tabs.png), [001-designer-no-tabs](../evidence/shots/vq3/dark/001-designer-no-tabs.png), [001-no-design-outline](../evidence/shots/vq8/light/001-no-design-outline.png)

<details><summary>Q3-002 — Designer no-tabs empty state never offers 'Import KiCad project…' (S3, confirmed)</summary>

- Area designer.shell · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Close all design tabs (or fresh profile)
  2. Click rail 'Designer'
- Expected: Empty state shows New design + Import KiCad project… + Open existing (the component supports onImportKicad)
- Actual: Only 'New design' and 'Open existing' are shown; the Import button is never rendered because the visible empty-state instance is created without onImportKicad.
- Screenshots: [001-designer-no-tabs](../evidence/shots/q3/dark/001-designer-no-tabs.png), [001-designer-no-tabs](../evidence/shots/q3/light/001-designer-no-tabs.png)
- Code: `src/modules/designer/frontend/Space.tsx:1381` — DesignerEmptyState in the noTabsOpen branch has no onImportKicad
- Code: `src/modules/designer/frontend/Space.tsx:1144` — onImportKicad passed only in the unreachable canvasContent() branch
- Suggested fix: Pass onImportKicad={() => setKicadImportOpen(true)} to the DesignerEmptyState at Space.tsx:1381 and delete the unreachable noTabsOpen branch in canvasContent().
- Verification (vq3): **confirmed** — Reproduced in both themes with no tabs open: the empty state shows only 'New design' plus the Open existing list, and no Import KiCad button. Code verified: the visible instance (Space.tsx:1380-1386) omits onImportKicad. The canvasContent() instance that passes it (Space.tsx:1138-1145) is unreachable while noTabsOpen. K19 confirmed. S3. · evidence: [001-designer-no-tabs](../evidence/shots/vq3/dark/001-designer-no-tabs.png), [001-designer-no-tabs](../evidence/shots/vq3/light/001-designer-no-tabs.png)

</details>

<details><summary>Q3-003 — With no design open, Designer still shows view tabs, the Outline 'Empty design' panel and dead 'Place component / Add net label' buttons (S3, confirmed)</summary>

- Area designer.shell · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Close all design tabs, click rail 'Designer'
  2. Observe the left sidebar: 'Outline 0 — Empty design — Add your first component…' with Place component ⌘K / Add net label / Browse library
  3. Click 'Place component ⌘K' or 'Add net label', press ⌘K
  4. Click view tabs PCB / BOM / 3D
- Expected: No-design state hides the sidebar and view tabs (or disables them); no call-to-action that cannot work.
- Actual: Sidebar claims the (non-existent) design is empty; Place component / Add net label / ⌘K do nothing (no palette, no feedback). View tabs stay clickable: PCB shows empty 'Layers' / 'Components 0' sections; BOM/DRC hide the sidebar so the empty-state card jumps horizontally between views.
- Screenshots: [001-designer-no-tabs](../evidence/shots/q3/dark/001-designer-no-tabs.png), [002-no-tabs-place-component](../evidence/shots/q3/dark/002-no-tabs-place-component.png), [003-no-tabs-pcb-view](../evidence/shots/q3/dark/003-no-tabs-pcb-view.png), [004-no-tabs-bom-view](../evidence/shots/q3/dark/004-no-tabs-bom-view.png), [001-designer-no-tabs](../evidence/shots/q3/light/001-designer-no-tabs.png)
- Code: `src/modules/designer/frontend/Space.tsx:1342` — sidebar rendered whenever activeView is not bom/drc, regardless of noTabsOpen
- Code: `src/modules/designer/frontend/components/DesignerHeader.tsx:1` — view tabs always rendered
- Suggested fix: In Space.tsx gate the DesignerSidebar + resize separator on !noTabsOpen, and render the view-tab strip disabled (or hidden) in DesignerHeader when openDesignIds is empty.
- Verification (vq3): **confirmed** — Reproduced (dark and light): with no design open, the left sidebar shows 'Outline 0 · Empty design' and its CTAs. Clicking 'Place component ⌘K', pressing ⌘K and clicking 'Add net label' each opened nothing (0 dialogs/listboxes/menus). The view tabs stay active: in the PCB view the sidebar stays, and BOM hides it, so the 'No design open' card jumps horizontally. Not intentional: PLAN D6 says to omit controls that cannot work. S3. · evidence: [001-designer-no-tabs](../evidence/shots/vq3/dark/001-designer-no-tabs.png), [002-no-tabs-pcb](../evidence/shots/vq3/dark/002-no-tabs-pcb.png), [003-no-tabs-bom](../evidence/shots/vq3/dark/003-no-tabs-bom.png), [001-designer-no-tabs](../evidence/shots/vq3/light/001-designer-no-tabs.png)

</details>

<details><summary>Q8-029 — Designer with no design open still shows the Outline 'Empty design' panel whose Place component / Add net label buttons do nothing, plus active view tabs (S3, confirmed)</summary>

- Area designer.shell · stack A · design None · themes light · viewports 1440x900
- Repro:
  1. Fresh profile (no designer tabs) → rail Designer
  2. Click 'Place component ⌘K' then 'Add net label' in the left Outline panel
- Expected: Left sidebar hidden (or disabled) until a design is open; only the centred 'No design open' card is actionable; Schem/PCB/3D/BOM/DRC tabs disabled.
- Actual: Outline shows '0 · Empty design — Add your first component…' with primary 'Place component' button; clicking it or 'Add net label' does nothing (no dialog, no feedback). View tabs remain clickable.
- Screenshots: [001-no-design-outline](../evidence/shots/vq8/light/001-no-design-outline.png), [002-no-design-after-clicks](../evidence/shots/vq8/light/002-no-design-after-clicks.png), [008-dock-light](../evidence/shots/q8/light/008-dock-light.png), [009-no-design-place-component](../evidence/shots/q8/light/009-no-design-place-component.png)
- Code: `src/modules/designer/frontend/Space.tsx:1344` — DesignerSidebar rendered even when noTabsOpen
- Code: `src/modules/designer/frontend/Space.tsx:599` — openComponentPalette silently returns when !canOpenPalette
- Code: `src/modules/designer/frontend/components/OutlinePanel/OutlineEmptyState.tsx:19` — 'Empty design' state shown with no design
- Suggested fix: Designer Space.tsx:1344: render the left sidebar/resizer only when !noTabsOpen (and disable the view tabs), so the no-design state is just DesignerEmptyState.
- Verification (vq8): **confirmed** — Reproduced in a fresh light profile: Designer with no tabs shows centred 'No design open' plus left Outline 'Empty design' with 'Place component ⌘K' / 'Add net label' - clicking both opens nothing (0 dialogs); Schem/PCB/3D/BOM/DRC tabs switch (PCB selected). Designer Space.tsx:1344-1377 renders DesignerSidebar whenever activeView isn't bom/drc, not gated on noTabsOpen; openComponentPalette (:599) no-ops without canOpenPalette. S3 kept. · evidence: [001-no-design-outline](../evidence/shots/vq8/light/001-no-design-outline.png), [002-no-design-after-clicks](../evidence/shots/vq8/light/002-no-design-after-clicks.png)

</details>

<details><summary>Q3-032 — Designer empty-state 'Open existing' list squashes rows to 15 px (declared 22 px), hides overflow without cue, and is not sorted by recency (S3, confirmed)</summary>

- Area designer.shell · stack A · design None · themes light, dark · viewports 1440x900
- Repro:
  1. Close all design tabs, click rail 'Designer' (18 designs on stack A)
  2. Look at the OPEN EXISTING list; measure a row
- Expected: 22 px rows (kit standard), a visible scroll affordance or search once the list overflows, most-recent designs first (like Home 'Modified')
- Actual: Rows are 15 px tall (flex-shrink inside the max-h-64 flex column; dark with 14 designs: 18 px), so text lines nearly touch and hover targets are tiny; the newest design ('QA-Q3-empty') is below the fold with no scrollbar cue; order is creation/API order, not recency; duplicate names ('DRC Demo', 'Untitled Design', 'S3 LLM Smoke…') are only distinguishable by revision.
- Screenshots: [001-designer-no-tabs](../evidence/shots/q3/light/001-designer-no-tabs.png), [001-designer-no-tabs](../evidence/shots/q3/dark/001-designer-no-tabs.png)
- Code: `src/modules/designer/frontend/components/DesignerEmptyState.tsx:57` — flex max-h-64 flex-col overflow-y-auto; rows h-[22px] without shrink-0
- Suggested fix: Add shrink-0 to the row buttons, sort designs by updatedAt desc, and show a small filter input or 'Show all in Home' link when >10 designs; show modified date as secondary text to disambiguate duplicates.
- Verification (vq3): **confirmed** — Reproduced (light, 20 designs). The Open existing rows compute to 15 px tall although their class is h-[22px], because the buttons lack shrink-0 inside the max-h-64 flex column. The list overflows (scrollHeight 300 > clientHeight 256) with no cue. Order is API/creation order ('Dual LED Blinker' first, newest QA designs last and below the fold), not recency. Duplicate names ('DRC Demo', 'Untitled Design') differ only by revision. Code: DesignerEmptyState.tsx:57. S3. · evidence: [001-designer-no-tabs](../evidence/shots/vq3/light/001-designer-no-tabs.png), [001-designer-no-tabs](../evidence/shots/vq3/dark/001-designer-no-tabs.png)

</details>


## T-086

**Active design tab revision badge goes stale after edits (shows r0 while design is at r3)**

- Severity **S3** · category data · status confirmed · themes dark
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate S
- Findings: Q3-006

**Summary.** Tab still shows 'r0' after three committed commands; only a reload/refreshDesigns updates it. The number is misleading next to Home, which shows the real revision.

**Root cause.** `src/modules/designer/frontend/components/DesignTabs.tsx:40` — tabLabel() reads revision from the designs summary list, which is not refreshed after dispatchCommand

**Proposed fix.** Tab revision badge reads live projection revision (or drop the badge). — Detail: Derive the active tab's revision from the live projection/workspace revision (state.projection.revision) instead of the design summary list, or refresh the summary entry after each successful command.

**Evidence.** [019-placed-r1](../evidence/shots/q3/dark/019-placed-r1.png), [018-gnd-selected](../evidence/shots/vq3/dark/018-gnd-selected.png)

<details><summary>Q3-006 — Active design tab revision badge goes stale after edits (shows r0 while design is at r3) (S3, confirmed)</summary>

- Area designer.shell · stack A · design e77715d2 · themes dark · viewports 1440x900
- Repro:
  1. Create a new design (tab shows r0), rename it QA-Q3-sandbox
  2. Place a part, Undo, Redo via toolbar (backend revision → 3)
  3. Look at the active tab badge
- Expected: Tab badge tracks the current revision (r3) — or no revision is shown
- Actual: Tab still shows 'r0' after three committed commands; only a reload/refreshDesigns updates it. The number is misleading next to Home, which shows the real revision.
- Screenshots: [019-placed-r1](../evidence/shots/q3/dark/019-placed-r1.png)
- Network: `GET …/projection/schematic → revision 3 while tab text = 'QA-Q3-sandboxr0'`
- Code: `src/modules/designer/frontend/components/DesignTabs.tsx:40` — tabLabel() reads revision from the designs summary list, which is not refreshed after dispatchCommand
- Suggested fix: Derive the active tab's revision from the live projection/workspace revision (state.projection.revision) instead of the design summary list, or refresh the summary entry after each successful command.
- Verification (vq3): **confirmed** — Reproduced: the active tab badge read 'QA-Q3-vq3-a r13' while the backend revision went to 16 and then 17 (R rotate, GND placement). It refreshed to r31 only after leaving Designer and coming back (refreshDesigns on mount). Code: DesignTabs.tsx:39-46 tabLabel() reads revision from the design summary list, which dispatchCommand does not refresh. S3. · evidence: [018-gnd-selected](../evidence/shots/vq3/dark/018-gnd-selected.png), [010-outline-delete-conflict](../evidence/shots/vq3/dark/010-outline-delete-conflict.png)

</details>


## T-087

**Designer shell/schematic keyboard a11y gaps: design tabs unreachable, no focus ring on view/dock tabs, unnamed tablist/separators, palette & outline lack list semantics**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate M
- Findings: Q3-033 · known ref K34

**Summary.** View tabs switch with arrows but show no focus indicator (outline-style none, box-shadow none) and their tablist has no accessible name; design tabs are role=tab divs with tabIndex −1 (cannot be focused, activated, renamed or closed from the keyboard) and nest a close <button> inside role=tab; left-sidebar and dock resizers are role=separator with tabIndex −1, no aria-label/aria-valuenow; ⌘K palette results are plai…

**Root cause.** `src/modules/designer/frontend/components/DesignTabs.tsx:194` — role=tab div, no tabIndex/onKeyDown

**Proposed fix.** Design tabs focusable (roving tabindex), named tablist/separators, focus ring on view/dock tabs (kit). — Detail: Give design tabs roving tabIndex + Enter/F2/Delete handling, add focus-visible rings to kit Tabs/DockTabs, aria-label the view tablist ('Designer views') and resizers (with keyboard arrow resize), add role=listbox/option + aria-activedescendant to the palette and restore focus on close, aria-label severity toggles ('Errors (3)'), and implement F / arrow navigation in OutlineRow.

**Evidence.** [014-view-tab-keyboard-focus](../evidence/shots/q3/light/014-view-tab-keyboard-focus.png), [020-outline-actions-menu](../evidence/shots/vq3/dark/020-outline-actions-menu.png)

<details><summary>Q3-033 — Designer shell/schematic keyboard a11y gaps: design tabs unreachable, no focus ring on view/dock tabs, unnamed tablist/separators, palette & outline lack list semantics (S3, confirmed)</summary>

- Area designer.shell · stack A · design None · themes light, dark · viewports 1440x900
- Repro:
  1. Focus the 'Schem' view tab and press ArrowRight (switches to PCB) — observe focus styling
  2. Tab through the header
  3. Inspect ARIA of palette results, ERC severity toggles, outline rows, panel resizers
- Expected: Every interactive element reachable and visibly focused (focus-visible ring); named landmarks; composite widgets expose listbox/option or grid semantics
- Actual: View tabs switch with arrows but show no focus indicator (outline-style none, box-shadow none) and their tablist has no accessible name; design tabs are role=tab divs with tabIndex −1 (cannot be focused, activated, renamed or closed from the keyboard) and nest a close <button> inside role=tab; left-sidebar and dock resizers are role=separator with tabIndex −1, no aria-label/aria-valuenow; ⌘K palette results are plain <ul>/<button> without listbox/option or aria-activedescendant, and focus is not returned to the trigger on Esc (activeElement = BODY); ERC severity toggles are named only '3' / '0' (title 'Toggle error' is not the name); outline rows ignore ArrowUp/Down and advertise an 'F' shortcut that does nothing (F2 works). [vq3] Comment composer opened by a canvas click is not focused (activeElement BODY), so the first keystrokes go to canvas hotkeys (typing 'check' toggled comment mode and 'h' opened the net-portal picker); CommentComposerPopup.tsx:46-48 focuses on mount but focus is lost afterwards — confirm in Electron.
- Screenshots: [014-view-tab-keyboard-focus](../evidence/shots/q3/light/014-view-tab-keyboard-focus.png), [056-outline-actions-menu](../evidence/shots/q3/dark/056-outline-actions-menu.png)
- Code: `src/modules/designer/frontend/components/DesignTabs.tsx:194` — role=tab div, no tabIndex/onKeyDown
- Code: `src/modules/designer/frontend/components/DesignerHeader.tsx:59` — view Tabs/TabsList without aria-label
- Code: `src/shared/frontend/ui/tabs.tsx:30` — outline-none, no focus-visible style
- Code: `src/shared/frontend/ui/dock-tabs.tsx:54` — outline-none, no focus-visible style
- Code: `src/modules/designer/frontend/Space.tsx:1371` — role=separator without tabIndex/aria-*
- Code: `src/modules/designer/frontend/components/OutlinePanel/OutlineRow.tsx:121` — onKeyDown: Enter/Space/F2/Delete only; menus advertise 'F'
- Code: `src/modules/designer/frontend/components/comments/CommentComposerPopup.tsx:46` — focus-on-mount is lost after the opening click
- Suggested fix: Give design tabs roving tabIndex + Enter/F2/Delete handling, add focus-visible rings to kit Tabs/DockTabs, aria-label the view tablist ('Designer views') and resizers (with keyboard arrow resize), add role=listbox/option + aria-activedescendant to the palette and restore focus on close, aria-label severity toggles ('Errors (3)'), and implement F / arrow navigation in OutlineRow.
- Verification (vq3): **confirmed** — Verified via DOM. The view-tab tablist has no accessible name, although the design-tab list ('Open designs') and the dock ('Side panel') have one. Design tabs are role=tab divs with tabIndex −1, each nesting a close button. Both panel resizers are role=separator with tabIndex −1 and no aria-label/valuenow. Kit tabs, dock-tabs and segmented-control use 'outline-none' with no focus-visible replacement (tabs.tsx:30, dock-tabs.tsx:54, segmented-control.tsx:58). The ⌘K palette has 0 listbox/option roles and no aria-activedescendant, and Escape leaves focus on BODY. The ERC severity toggles are named '2' / '0' / '0'. The outline menus advertise 'Frame to canvas  F', but OutlineRow.onKeyDown handles only Enter/Space/F2/Delete. Additional (vq3): after the comment composer opens from a canvas click its textarea is not focused (activeElement BODY), so typed text triggers canvas hotkeys; typing 'vq3 check…' armed the H net-portal picker. Seen in headless Chromium; confirm in Electron. K34 confirmed. S3. · evidence: [020-outline-actions-menu](../evidence/shots/vq3/dark/020-outline-actions-menu.png), [024-comment-posted](../evidence/shots/vq3/dark/024-comment-posted.png)

</details>


## T-088

**Opening a design briefly shows 'No design open' + 'Empty design', and loading views show confident zeros ('0 DRC', 'All 0', '$0.00', 'Synced with schematic')**

- Severity **S4** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate S
- Findings: F1A-007

**Summary.** Schem: the tab is only created after the design list loads. Until then the canvas says 'No design open — Create a new design or open an existing one' with a primary 'New design' button, and the Outline says 'Empty design — Add your first component…' with Place/Add/Browse CTAs. At loopback speed this lasts ~50 ms (t=178–222 ms), then 'Loading schematic…' still sits next to Outline 'Empty design'. With 2.5 s latency i…

**Root cause.** `src/modules/designer/frontend/Space.tsx:522` — route/tab reconciliation waits for state.loadingDesigns, so noTabsOpen stays true meanwhile

**Proposed fix.** Loading skeleton while a design opens; '—' instead of confident zeros until data loaded. — Detail: Open the tab immediately from the route designId (optimistically) and show 'Loading design…' until designs load, or render a loading branch while state.loadingDesigns. Hide Outline empty CTAs until the projection exists. In BOM, hide counts/totals/sync status and disable Export while loading. In the PCB status bar render '— DRC' in a neutral colour until the report is known.

**Evidence.** [020-first-schem-250ms](../evidence/shots/f1a/dark/020-first-schem-250ms.png), [090-first-schem-400ms](../evidence/shots/vf1a/dark/090-first-schem-400ms.png)

<details><summary>F1A-007 — Opening a design briefly shows 'No design open' + 'Empty design', and loading views show confident zeros ('0 DRC', 'All 0', '$0.00', 'Synced with schematic') (S4, confirmed)</summary>

- Area designer.shell · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark, light · viewports 1440x900
- Repro:
  1. Close all design tabs, reload, open QA-f1a-board from Home (double-click)
  2. Watch the first frames with no latency: poll the DOM every 20 ms
  3. Repeat with a 2.5 s fetch latency shim and switch to PCB, BOM, 3D, DRC right after opening
- Expected: A loading state ('Opening QA-f1a-board…' or a skeleton) until data arrives. No empty-state CTAs and no 0 counts while loading.
- Actual: Schem: the tab is only created after the design list loads. Until then the canvas says 'No design open — Create a new design or open an existing one' with a primary 'New design' button, and the Outline says 'Empty design — Add your first component…' with Place/Add/Browse CTAs. At loopback speed this lasts ~50 ms (t=178–222 ms), then 'Loading schematic…' still sits next to Outline 'Empty design'. With 2.5 s latency it lasts ~5 s, and clicking 'New design' there creates a stray design. PCB: 'Loading PCB...' (good), but Components '0' and the status bar '◆ 0 DRC' in success blue; the toolbar and dock are blank. BOM: 'Loading BOM…' next to 'All 0 · Missing MPN 0 · DNP 0', '0 lines · 0 parts', '$0.00', a red '0 missing MPN' and 'Synced with schematic r15', with Export enabled. 3D has a proper spinner card; its left rail is an empty 260 px column. Designer counterpart of F1D-002.
- Screenshots: [020-first-schem-250ms](../evidence/shots/f1a/dark/020-first-schem-250ms.png), [021-first-schem-1450ms](../evidence/shots/f1a/dark/021-first-schem-1450ms.png), [022-first-pcb-250ms](../evidence/shots/f1a/dark/022-first-pcb-250ms.png), [025-first-3d-250ms](../evidence/shots/f1a/dark/025-first-3d-250ms.png), [027-first-bom-250ms](../evidence/shots/f1a/dark/027-first-bom-250ms.png), [020-first-schem-250ms](../evidence/shots/f1a/light/020-first-schem-250ms.png), [027-first-bom-250ms](../evidence/shots/f1a/light/027-first-bom-250ms.png)
- Network: `GET /designs (2.5 s) gates tab creation; GET projection/schematic afterwards`
- Code: `src/modules/designer/frontend/Space.tsx:522` — route/tab reconciliation waits for state.loadingDesigns, so noTabsOpen stays true meanwhile
- Code: `src/modules/designer/frontend/Space.tsx:1380` — noTabsOpen renders DesignerEmptyState ('No design open' + New design) with no loading branch
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:391` — 'Loading BOM…' row while filters, footer totals and 'Synced with schematic' render from the empty bom
- Suggested fix: Open the tab immediately from the route designId (optimistically) and show 'Loading design…' until designs load, or render a loading branch while state.loadingDesigns. Hide Outline empty CTAs until the projection exists. In BOM, hide counts/totals/sync status and disable Export while loading. In the PCB status bar render '— DRC' in a neutral colour until the report is known.
- Verification (vf1a): **confirmed** — Reproduced. With the 2.5 s shim, opening QA-f1a-board from Home showed at 400 ms both 'No design open … New design' and Outline '0 · Empty design' with Place/Add/Browse CTAs; BOM showed 'Loading BOM…' next to 'All 0 · Missing MPN 0', '$0.00', '0 missing MPN', 'Synced with schematic r34'; PCB 'Loading PCB...' with 'Components 0' and '0 DRC'. On the real loopback stack a per-frame rAF sampler saw 'No design open' + 'Empty design' in only 2 painted frames (t=261-263 ms) and never saw 'Loading schematic'. Severity lowered S3->S4 to match F1D-002 (the same loading-state class on Home/Assistant, S4): invisible at loopback speed, only a slow backend shows it (and only then can the 'New design' CTA create a stray design). · evidence: [090-first-schem-400ms](../evidence/shots/vf1a/dark/090-first-schem-400ms.png), [091-first-bom-400ms](../evidence/shots/vf1a/dark/091-first-bom-400ms.png), [092-first-pcb-400ms](../evidence/shots/vf1a/dark/092-first-pcb-400ms.png), rAF sampler (no shim): 148 frames, 'No design open'+'Empty design' at 261 ms and 263 ms only

</details>


## T-089

**Status-bar selection segment hard-clips long names mid-glyph with no ellipsis ('Text · Long PCB overlay text for silkscreen overlap Q')**

- Severity **S4** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate XS
- Findings: F1B-020

**Summary.** The segment has class 'flex … max-w-[240px] truncate' (text-overflow: ellipsis, overflow hidden, scrollWidth 718 > clientWidth 239) but, being a flex container, never renders the ellipsis: the text is cut through the letter 'Q' flush against the 'view top' segment. Same for any long selection label (e.g. long refdes/value).

**Root cause.** `src/modules/designer/frontend/components/DesignerStatusBar.tsx:144` — <StatusSegment sans className='max-w-[240px] truncate'> — truncate on a flex container

**Proposed fix.** Selection segment: min-w-0 + truncate with ellipsis + title. — Detail: Wrap the label in an inner <span className='min-w-0 truncate'> inside StatusSegment (keep max-w on the segment) and add title={fullText}.

**Evidence.** [076-long-pcb-text-selected](../evidence/shots/f1b/dark/076-long-pcb-text-selected.png), [016-statusbar-long-selection](../evidence/shots/vf1b/dark/016-statusbar-long-selection.png)

<details><summary>F1B-020 — Status-bar selection segment hard-clips long names mid-glyph with no ellipsis ('Text · Long PCB overlay text for silkscreen overlap Q') (S4, confirmed)</summary>

- Area designer.shell · stack A · design 43a2da78-9d2e-43a0-bcd3-ecebe3f72551 · themes dark · viewports 1440x900
- Repro:
  1. QA-f1b-long → PCB → T, click the board, accept a 150-char overlay text
  2. Click the text to select it
  3. Look at the status bar selection segment (right side)
- Expected: Segment truncates with an ellipsis ('Text · Long PCB overlay text for silk…') and exposes the full text via title.
- Actual: The segment has class 'flex … max-w-[240px] truncate' (text-overflow: ellipsis, overflow hidden, scrollWidth 718 > clientWidth 239) but, being a flex container, never renders the ellipsis: the text is cut through the letter 'Q' flush against the 'view top' segment. Same for any long selection label (e.g. long refdes/value).
- Screenshots: [076-long-pcb-text-selected](../evidence/shots/f1b/dark/076-long-pcb-text-selected.png), [076b-statusbar-zoom](../evidence/shots/f1b/dark/076b-statusbar-zoom.png)
- Code: `src/modules/designer/frontend/components/DesignerStatusBar.tsx:144` — <StatusSegment sans className='max-w-[240px] truncate'> — truncate on a flex container
- Code: `src/shared/frontend/ui/status-bar.tsx:38` — StatusSegment is display:flex
- Suggested fix: Wrap the label in an inner <span className='min-w-0 truncate'> inside StatusSegment (keep max-w on the segment) and add title={fullText}.
- Verification (vf1b): **confirmed** — Reproduced on QA-f1b-long PCB after selecting the overlay text. The segment 'max-w-[240px] truncate' is display:flex with text-overflow:ellipsis, clientWidth 239 and scrollWidth 718. The text is cut mid-glyph ('…overlap Q') with no ellipsis and no title. S4 kept. · evidence: [016-statusbar-long-selection](../evidence/shots/vf1b/dark/016-statusbar-long-selection.png), [016b-statusbar-zoom](../evidence/shots/vf1b/dark/016b-statusbar-zoom.png)

</details>


## T-090

**Minor shell state issues: left sidebar width not persisted (dock width is), status bar keeps the previous design's cursor X/Y**

- Severity **S4** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate XS
- Findings: Q3-036

**Summary.** Dock width 439 px restored, left sidebar snaps back to 260 px. New design 'QA-Q3-sandbox' showed 'X 10.568 Y −10.578' from the 12V design before any pointer movement.

**Root cause.** `src/modules/designer/frontend/Space.tsx:437` — leftWidth useState, not persisted

**Proposed fix.** Persist left sidebar width; clear status cursor X/Y on design switch. — Detail: Persist leftWidth next to the dock prefs (stores/designer-dock-prefs.ts, e.g. openpcb:designer:left-width). In SchematicCanvas reset cursorNm to null when projection?.designId changes (or key the canvas by designId).

**Evidence.** [012-resized-panels](../evidence/shots/q3/dark/012-resized-panels.png), [028-stale-cursor-after-tab-switch](../evidence/shots/vq3/dark/028-stale-cursor-after-tab-switch.png)

<details><summary>Q3-036 — Minor shell state issues: left sidebar width not persisted (dock width is), status bar keeps the previous design's cursor X/Y (S4, confirmed)</summary>

- Area designer.shell · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Drag the left sidebar resizer from 340 → 460 px and the dock resizer; reload and reopen Designer
  2. Hover the canvas of design A, then create/open design B without moving over its canvas
- Expected: Both panel widths persist (like openpcb:designer:dock-width); status-bar X/Y resets to '—' on design switch
- Actual: Dock width 439 px restored, left sidebar snaps back to 260 px. New design 'QA-Q3-sandbox' showed 'X 10.568 Y −10.578' from the 12V design before any pointer movement.
- Screenshots: [012-resized-panels](../evidence/shots/q3/dark/012-resized-panels.png), [011-new-design-empty](../evidence/shots/q3/dark/011-new-design-empty.png)
- Code: `src/modules/designer/frontend/Space.tsx:437` — leftWidth useState, not persisted
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:945` — cursorNm survives design switch
- Suggested fix: Persist leftWidth next to the dock prefs (stores/designer-dock-prefs.ts, e.g. openpcb:designer:left-width). In SchematicCanvas reset cursorNm to null when projection?.designId changes (or key the canvas by designId).
- Verification (vq3): **confirmed** — Both parts confirmed. (1) The left sidebar width is useState(DEFAULT_LEFT=260) and never persisted (Space.tsx:82, :437), while the dock width is persisted under openpcb:designer:dock-width. (2) Hovered the QA-Q3-sandbox canvas (X −1.469 Y −7.371), then clicked the QA-Q3-empty tab: the status bar of the empty design still reads X −1.469 Y −7.371. The SchematicCanvas instance survives the design switch and cursorNm (SchematicCanvas.tsx:945) is not reset on projection.designId change. S4. · evidence: [028-stale-cursor-after-tab-switch](../evidence/shots/vq3/dark/028-stale-cursor-after-tab-switch.png)

</details>

