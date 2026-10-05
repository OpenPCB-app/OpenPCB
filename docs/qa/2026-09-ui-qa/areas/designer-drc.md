# designer.drc — QA findings

[← index](../README.md) · 7 triage entries · S1 2 · S2 1 · S3 4 · S4 0

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-210](#t-210) | S1 | Design rules 'Save & re-run DRC' silently loses edits on conflict and re-runs DRC with old rules; Board-panel entry never re-runs DRC | F1A-001, Q4-021 | fix-now | D3 / W2 | frontend | S |
| [T-211](#t-211) | S1 | DRC view hangs the whole app for 10+ minutes on a large report — the violation list renders every row with no virtualization | F1B-003 | fix-now | D3 / W2 | frontend | M |
| [T-212](#t-212) | S2 | DRC indicators read '0'/clean when report failed to load or DRC never ran | F1A-005, Q4-047 | fix-now | D3 / W2 | frontend | S |
| [T-213](#t-213) | S3 | DRC/ERC run failures show only a bare 'Internal error' line; the stale error sticks above a good report, and Run DRC shows no pending state (double-click starts twice) | F1A-006 | fix-now | D3 / W2 | frontend | S |
| [T-214](#t-214) | S3 | Built-in core footprints fail the default JLCPCB DRC preset out of the box: every placed part adds ~5 silkscreen warnings (0.12 mm silk width, silk 0.12 mm from mask) | F1B-009 | defer | followup / followup | shared-package | M |
| [T-215](#t-215) | S3 | Waiving one DRC violation adds a 'Show waived' checkbox to the DRC dock header that overflows the 300 px dock: the label is cut to 'Sho' and the 'Close DRC panel' button is pushed off-screen | F2A-007 | fix-now | D3 / W2 | frontend | XS |
| [T-216](#t-216) | S3 | DRC messages expose internal rule keys ('pthAnnularRingMm', 'minNpthDrillMm') and repeat the numbers with an orphaned 'mm' | Q4-044 | defer | followup / followup | backend | S |

## T-210

**Design rules 'Save & re-run DRC' silently loses edits on conflict and re-runs DRC with old rules; Board-panel entry never re-runs DRC**

- Severity **S1** · category data · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F1A-001, Q4-021

**Summary.** The command goes out with the stale baseRevision 25 and the server answers 200 {result:{ok:false, code:'REVISION_CONFLICT', expected:25, actual:26}}. The hook ignores result.ok: the dialog closes as if the save worked, DRC re-runs (POST /drc/runs 202) against the OLD rules, and nothing tells the user. The server still has 0.2 and the Board panel shows 'Clearance 0.20'. Reproduced twice (from the DRC full view after… | Also covers: Q4-021: Design rules 'Save & re-run DRC' opened from Board properties saves but never re-runs DRC

**Root cause.** `src/modules/designer/frontend/pcb/use-pcb-design-rules-dialog.tsx:82` — `await api.dispatch(designId, envelope)` result ignored: ok:false (REVISION_CONFLICT) treated as success, then onSaved() re-runs DRC

**Proposed fix.** Rules dialog: use fresh baseRevision, check dispatch result, show error and keep dialog open on failure; re-run DRC only after a successful save — from both dock and Board panel. — Detail: use-pcb-design-rules-dialog.tsx handleSave: capture `const result = await api.dispatch(...)`; if (!result.ok) and code === 'REVISION_CONFLICT', re-GET the projection (api.getPcbProjection) and re-dispatch once with its revision (rules are a full replace, so a retry is safe); on any other !ok throw new Error(<friendly message>). Only call onSaved() after ok. PcbDesignRulesDialog.save(): add catch that keeps the dialog open and renders an inline role='alert' error ('Couldn't save design rules: …') with the Save butt…

**Evidence.** [116-rules-dock-edit](../evidence/shots/f1a/dark/116-rules-dock-edit.png), [010-rules-dock-edit](../evidence/shots/vf1a/dark/010-rules-dock-edit.png), [099-rules-dialog](../evidence/shots/q4/dark/099-rules-dialog.png)

<details><summary>F1A-001 — Design rules 'Save & re-run DRC' silently throws away the edited rules when the save is rejected, then re-runs DRC with the old rules (S1, confirmed)</summary>

- Area designer.drc · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark · viewports 1440x900
- Repro:
  1. Open QA-f1a-board → PCB view, open the right dock DRC tab (leave it open)
  2. Make any PCB edit that does not switch the dock tab, e.g. click toolbar Undo (server revision 25 → 26)
  3. In the DRC dock click 'Edit rules', change Clearances › Trace ↔ trace 0.2 → 0.3, click 'Save & re-run DRC'
  4. GET /api/modules/designer/designs/{id}/projection/pcb → board.designRules.clearance.traceToTraceMm
  5. Variant: route '**/designs/*/commands' → 500 (or go offline) and click 'Save & re-run DRC'
- Expected: Either the rules are saved, or the dialog stays open with a clear error and a retry. DRC only re-runs after a successful save.
- Actual: The command goes out with the stale baseRevision 25 and the server answers 200 {result:{ok:false, code:'REVISION_CONFLICT', expected:25, actual:26}}. The hook ignores result.ok: the dialog closes as if the save worked, DRC re-runs (POST /drc/runs 202) against the OLD rules, and nothing tells the user. The server still has 0.2 and the Board panel shows 'Clearance 0.20'. Reproduced twice (from the DRC full view after an external edit, and from the dock after toolbar Undo). On HTTP 500 or offline, the dialog stays open, the button reverts to 'Save & re-run DRC', and no message appears. The only trace is an unhandled promise rejection in the console. The dock/full-view DRC panel fetches its own projection once per mount, so any PCB edit made while it stays mounted makes the next rules save conflict.
- Screenshots: [116-rules-dock-edit](../evidence/shots/f1a/dark/116-rules-dock-edit.png), [117-rules-dock-saved-silently-dropped](../evidence/shots/f1a/dark/117-rules-dock-saved-silently-dropped.png), [112-rules-save-cmd500](../evidence/shots/f1a/dark/112-rules-save-cmd500.png), [113-rules-save-conflict-silent](../evidence/shots/f1a/dark/113-rules-save-conflict-silent.png), [121-dxf-sample-txt](../evidence/shots/f1a/dark/121-dxf-sample-txt.png)
- Console: `Error: Internal error at fetchData (api.ts:24) at async Object.dispatch (api.ts:337) at async use-pcb-design-rules-dialog.tsx:39 (uncaught in promise, commands→500 variant)`
- Network: `POST /designs/91573bb6…/commands {type:'pcb_set_design_rules', baseRevision:25, sessionId:'designer-drc-session'} → 200 {result:{ok:false,code:'REVISION_CONFLICT',conflict:{expected:25,actual:26}}}`; `POST /designs/91573bb6…/drc/runs → 202 (re-run with unchanged rules)`; `GET projection/pcb after save → clearance.traceToTraceMm 0.2 (user entered 0.3)`
- Code: `src/modules/designer/frontend/pcb/use-pcb-design-rules-dialog.tsx:82` — `await api.dispatch(designId, envelope)` result ignored: ok:false (REVISION_CONFLICT) treated as success, then onSaved() re-runs DRC
- Code: `src/modules/designer/frontend/pcb/use-pcb-design-rules-dialog.tsx:71` — baseRevision = projection?.revision from the caller's copy
- Code: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:236` — save(): try/finally with no catch, so no error state and the rejection escapes as unhandled
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:107` — projection (the source of baseRevision) is fetched once per mount and never refreshed after PCB edits while the dock stays mounted
- Suggested fix: use-pcb-design-rules-dialog.tsx handleSave: capture `const result = await api.dispatch(...)`; if (!result.ok) and code === 'REVISION_CONFLICT', re-GET the projection (api.getPcbProjection) and re-dispatch once with its revision (rules are a full replace, so a retry is safe); on any other !ok throw new Error(<friendly message>). Only call onSaved() after ok. PcbDesignRulesDialog.save(): add catch that keeps the dialog open and renders an inline role='alert' error ('Couldn't save design rules: …') with the Save button re-enabled. DesignerDrcView: stop using the mount-time projection for baseRevision (pass the PCB workspace projection when docked, or re-read the head revision right before dispatch).
- Verification (vf1a): **confirmed** — Reproduced 2x on loopback, no latency shim. (1) PCB, dock DRC tab open, toolbar Redo (rev 26->27), Edit rules, Trace<->trace 0.2->0.3, Save: POST /commands pcb_set_design_rules base=26 -> 200 {ok:false, REVISION_CONFLICT, expected 26, actual 27}; the dialog closed, POST /drc/runs 202 re-ran DRC, no role=alert or text, and the server still has traceToTraceMm 0.2. (2) Everyday trigger: with the DRC dock open, one eye-toggle on 'Top Overlay' in the Layers panel (pcb_set_visible_layers bumps the revision, see Q4-025) then a rules save gave the same silent REVISION_CONFLICT plus a DRC re-run. Variant commands->500: the dialog stays open, the button reverts, no message, and pageerror 'Error: Internal error' (unhandled rejection). Code: use-pcb-design-rules-dialog.tsx:82 ignores the DesignerDispatchResult; PcbDesignRulesDialog.tsx save() is try/finally with no catch; DesignerDrcView.tsx:107-114 fetches the projection once per mount, so baseRevision goes stale after any PCB edit that keeps the dock mounted. Not intentional per PLAN D1-D15, not an environment artefact. S1 kept: user-entered rules are silently lost, and DRC re-runs as if they applied (a false manufacturability confirmation), from a normal workflow. Distinct from Q4-021 (Board-panel entry point never re-runs DRC); both live in the same hook and should be fixed together. · evidence: [010-rules-dock-edit](../evidence/shots/vf1a/dark/010-rules-dock-edit.png), [011-rules-dock-after-save](../evidence/shots/vf1a/dark/011-rules-dock-after-save.png), [012-rules-save-cmd500](../evidence/shots/vf1a/dark/012-rules-save-cmd500.png), network: POST /commands pcb_set_design_rules base=26 -> {ok:false,REVISION_CONFLICT,expected:26,actual:27}; POST /drc/runs 202; GET projection/pcb traceToTraceMm 0.2 (rev 27), network: pcb_set_visible_layers base=35 -> rev 36; pcb_set_design_rules base=35 -> REVISION_CONFLICT; POST /drc/runs 202; server traceToTraceMm 0.2, pageerror: Error: Internal error (commands->500 variant)

</details>

<details><summary>Q4-021 — Design rules 'Save & re-run DRC' opened from Board properties saves but never re-runs DRC (S2, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB → Properties (nothing selected) → Board → 'Edit rules…'
  2. Change Minimums → Trace width 0.2 → 0.15
  3. Click 'Save & re-run DRC'
- Expected: Rules saved and a DRC run starts (progress in DRC tab), counts update
- Actual: Rules are saved (Board panel shows Min track 0.15) but no POST …/drc/run is made; GET /designs still reports drcStatus ranAtRevision 449, stale:true; toolbar/dock/status keep the old 13/19/19. Only the DRC view's 'Edit rules' path re-runs.
- Screenshots: [099-rules-dialog](../evidence/shots/q4/dark/099-rules-dialog.png), [102-rules-saved-drc-done](../evidence/shots/q4/dark/102-rules-saved-drc-done.png), [009-rules-dialog](../evidence/shots/vq4/dark/009-rules-dialog.png)
- Network: `POST /designs/c2c58a19/commands (pcb_set_design_rules) → ok; no /drc request follows`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5556` — handleRulesSaved: refresh + refreshHistory only
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:175` — DRC view's onSaved re-runs
- Code: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:558` — label 'Save & re-run DRC'
- Suggested fix: Call useDrcStore startRun() in PcbCanvas handleRulesSaved (or move the re-run into usePcbDesignRulesDialog so every entry point behaves the same).
- Verification (vq4): **confirmed** — Reproduced: Board panel -> Edit rules… -> 'Save & re-run DRC' sent POST /commands + GET projection + GET history only; no DRC run request; GET /designs drcStatus stayed ranAtRevision 527, stale:true (rev 528). PcbCanvas.tsx:5555-5558 handleRulesSaved only refreshes; the DRC view's handler (DesignerDrcView.tsx:175-181) re-runs. · evidence: [009-rules-dialog](../evidence/shots/vq4/dark/009-rules-dialog.png)

</details>


## T-211

**DRC view hangs the whole app for 10+ minutes on a large report — the violation list renders every row with no virtualization**

- Severity **S1** · category perf · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate M
- Findings: F1B-003

**Summary.** The renderer is blocked by a single 632,559 ms long task (≈10.5 min, PerformanceObserver longtask) after the click; playwright clicks/evals time out, nothing repaints, the user would have to force-quit. When it finally paints, the list shows every violation of the 6,323-row first group expanded. The dock DRC tab has the same unvirtualized list (DesignerDrcView) and the first click on a row costs ~6 s of long tasks (…

**Root cause.** `src/modules/designer/frontend/components/DesignerDrcView.tsx:380` — group.violations.map renders every row; no windowing/cap

**Proposed fix.** Virtualize DRC violation list (windowed rows) and group by type with counts. — Detail: DesignerDrcView.tsx: virtualize the violation rows (fixed-height windowing or @tanstack/react-virtual) and auto-collapse groups over ~200 rows. Build a placementId->reference Map once per projection instead of calling resolveAnchorLabel -> placements.find per anchor (drc-labels.ts:100). Fix the marker teardown via F1B-004 (InstancedMesh: one object per visual layer, not 48k groups). Optionally cap the persisted report per code (first N + count).

**Evidence.** [017-drc-dock-stacked](../evidence/shots/f1b/dark/017-drc-dock-stacked.png), [001-drc-view-8k](../evidence/shots/vf1b/dark/001-drc-view-8k.png)

<details><summary>F1B-003 — DRC view hangs the whole app for 10+ minutes on a large report — the violation list renders every row with no virtualization (S1, confirmed)</summary>

- Area designer.drc · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. Create a 150-part design (parts land stacked on the PCB, see F1B-002)
  2. PCB → dock DRC tab → Run DRC (report: 50,996 violations — 14,068 errors / 36,928 warnings; persisted report JSON is 24.7 MB)
  3. Click the DRC view tab in the designer header
- Expected: The DRC view opens within a second or two regardless of report size: rows virtualized/windowed, groups collapsed by default above N items, or a capped list with 'show more'; the app stays responsive.
- Actual: The renderer is blocked by a single 632,559 ms long task (≈10.5 min, PerformanceObserver longtask) after the click; playwright clicks/evals time out, nothing repaints, the user would have to force-quit. When it finally paints, the list shows every violation of the 6,323-row first group expanded. The dock DRC tab has the same unvirtualized list (DesignerDrcView) and the first click on a row costs ~6 s of long tasks (80+2716+743+755+525+513+727+511 ms). Backend DRC itself is fast (0.14 s on the spread board); the hang is purely frontend.
- Screenshots: [017-drc-dock-stacked](../evidence/shots/f1b/dark/017-drc-dock-stacked.png), [019-drc-51k-click-violation](../evidence/shots/f1b/dark/019-drc-51k-click-violation.png), [020-drc-view-51k](../evidence/shots/f1b/dark/020-drc-view-51k.png)
- Network: `GET /api/modules/designer/designs/cc5a12b9…/drc → 200, 24,768,443 bytes, 50,996 violations`
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:380` — group.violations.map renders every row; no windowing/cap
- Code: `src/modules/designer/frontend/pcb/drc/drc-labels.ts:100` — resolveAnchorLabel does projection.placements.find per anchor per render (O(violations×placements))
- Code: `src/modules/designer/frontend/pcb/layers/DrcMarkerLayer.tsx:110` — 48k marker groups x4 meshes/materials; tearing them down on PCB->DRC switch accounts for ~9 of the 10 min freeze
- Suggested fix: DesignerDrcView.tsx: virtualize the violation rows (fixed-height windowing or @tanstack/react-virtual) and auto-collapse groups over ~200 rows. Build a placementId->reference Map once per projection instead of calling resolveAnchorLabel -> placements.find per anchor (drc-labels.ts:100). Fix the marker teardown via F1B-004 (InstancedMesh: one object per visual layer, not 48k groups). Optionally cap the persisted report per code (first N + count).
- Verification (vf1b): **confirmed** — Reproduced. QA-vf1b-stack150 (150 stacked parts): DRC via API = 47,988 violations, 23.3 MB report. A 100 ms in-page heartbeat measured one main-thread freeze of 619,856 ms (10.3 min) on PCB -> DRC view, matching f1b's 632,559 ms long task. Schem -> DRC view (PCB not mounted) froze for 59.5 s and rendered 96,006 buttons (every row, no windowing). Leaving the view cost another 5.3 s. At 8,171 violations (60 parts) the view takes 0.6 s from Schem but 3.0 s from PCB. Refinement of the root cause: the unvirtualized list (DesignerDrcView.tsx group.violations.map) costs ~60 s. The extra ~9 min on the PCB path comes from tearing down the PCB canvas with ~48k marker groups (192k meshes and materials, see F1B-004); mounting the same PCB with markers took only 6.4 s. The stacked-board precondition arises naturally from F1B-002, so S1 stays: the app is frozen for 10 minutes. · evidence: [001-drc-view-8k](../evidence/shots/vf1b/dark/001-drc-view-8k.png), vf1b/hang.log, vf1b/hang2.log: heartbeat gaps [619856,1689] ms (PCB->DRC view), [59536,1643] ms (Schem->DRC view), API QA-vf1b-stack150 c9d5aa13: GET /drc 23,304,682 bytes, 47,988 violations

</details>


## T-212

**DRC indicators read '0'/clean when report failed to load or DRC never ran**

- Severity **S2** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F1A-005, Q4-047 · known ref K41

**Summary.** GET /drc 500: the view says 'Run DRC to validate the board.' (as if DRC never ran) and the status bar shows '0 DRC' with the blue no-issues diamond, although the persisted report has 1 error and 31 warnings (Home shows '32 errors'). The dock and PCB toolbar do the same. PCB projection 500: every violation anchor stays unresolved ('net pt:-14', '?.1 ↔ ?.2', 'part ↔ ?.4', 'part ↔ ?.5') permanently, and 'Edit rules' is… | Also covers: Q4-047: Before DRC has ever run, the DRC view is a blank page and every DRC indicator reads '0' a…

**Root cause.** `src/modules/designer/frontend/components/DesignerDrcView.tsx:114` — getPcbProjection(...).catch(() => {}): labels unresolved and rules.available false forever, no error

**Proposed fix.** DRC state 'unknown/failed/never run' distinct from 0: show 'Not run'/'Couldn't load' + Retry; resolve net/pad labels after load. — Detail: DesignerDrcView.tsx:109-121: replace both `.catch(() => {})` with `useDrcStore.getState().setError('Couldn't load DRC results: …')` / a local projectionError, render them with a Retry button that re-runs the effect, and give 'Edit rules' a disabled title ('Board data failed to load'). Keep the status-bar/toolbar/dock counts at '—' (unknown) while no report is known (shared with Q4-047's fix). When docked in PCB, pass the PCB workspace projection instead of refetching.

**Evidence.** [042-k41-drcview-drcget500](../evidence/shots/f1a/dark/042-k41-drcview-drcget500.png), [070-k41-drcview-drcget500](../evidence/shots/vf1a/dark/070-k41-drcview-drcget500.png), [020-drc-fullview-empty](../evidence/shots/q4/light/020-drc-fullview-empty.png)

<details><summary>F1A-005 — DRC view/dock swallow load failures: '0 DRC' + 'Run DRC to validate the board.' for a board with 33 violations, and unresolved '?.1 ↔ ?.2' / 'net pt:892' labels (S2, confirmed)</summary>

- Area designer.drc · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark, light · viewports 1440x900
- Repro:
  1. Reload (empty DRC store). route '**/api/modules/designer/designs/*/drc' → 500 problem+json
  2. Open QA-f1a-board → DRC tab; also PCB → dock DRC tab
  3. unroute; route '**/designs/*/projection/pcb*' → 500; open the DRC tab and click Run DRC
  4. With a 2.5 s latency shim and no 500s, open the DRC tab or dock (every mount refetches the projection)
- Expected: A failed report or label fetch shows an error with Retry, not a 'never run' state. Counts are shown as unknown, not 0. Violation labels fall back to refdes/net names already in the report.
- Actual: GET /drc 500: the view says 'Run DRC to validate the board.' (as if DRC never ran) and the status bar shows '0 DRC' with the blue no-issues diamond, although the persisted report has 1 error and 31 warnings (Home shows '32 errors'). The dock and PCB toolbar do the same. PCB projection 500: every violation anchor stays unresolved ('net pt:-14', '?.1 ↔ ?.2', 'part ↔ ?.4', 'part ↔ ?.5') permanently, and 'Edit rules' is disabled with no explanation. No error text appears in either case: both fetches end in .catch(() => {}). Under latency the same raw placeholders show for the whole projection round-trip on every DRC view/dock mount, because the view refetches a projection the PCB workspace already holds. Confirms K41 (DesignerDrcView part).
- Screenshots: [042-k41-drcview-drcget500](../evidence/shots/f1a/dark/042-k41-drcview-drcget500.png), [043-k41-pcb-drcdock-drcget500](../evidence/shots/f1a/dark/043-k41-pcb-drcdock-drcget500.png), [040-k41-drcview-pcbproj500](../evidence/shots/f1a/dark/040-k41-drcview-pcbproj500.png), [041-k41-pcb-view-proj500](../evidence/shots/f1a/dark/041-k41-pcb-view-proj500.png), [042-k41-drcview-drcget500](../evidence/shots/f1a/light/042-k41-drcview-drcget500.png), [045-k41-drcview-unresolved-labels](../evidence/shots/f1a/light/045-k41-drcview-unresolved-labels.png), [029-first-drc-250ms](../evidence/shots/f1a/dark/029-first-drc-250ms.png), [033-first-drc-dock-250ms](../evidence/shots/f1a/dark/033-first-drc-dock-250ms.png)
- Console: `Failed to load resource: 500 …/designs/91573bb6…/drc`; `Failed to load resource: 500 …/projection/pcb (no app-level log)`
- Network: `GET /designs/91573bb6…/drc → 500`; `GET /designs/91573bb6…/projection/pcb → 500`
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:114` — getPcbProjection(...).catch(() => {}): labels unresolved and rules.available false forever, no error
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:121` — getDrcResult(...).catch(() => {}): renders the never-run state and the store count 0
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:405` — resolveAnchorLabel falls back to '?' / raw net id when projection is null
- Suggested fix: DesignerDrcView.tsx:109-121: replace both `.catch(() => {})` with `useDrcStore.getState().setError('Couldn't load DRC results: …')` / a local projectionError, render them with a Retry button that re-runs the effect, and give 'Edit rules' a disabled title ('Board data failed to load'). Keep the status-bar/toolbar/dock counts at '—' (unknown) while no report is known (shared with Q4-047's fix). When docked in PCB, pass the PCB workspace projection instead of refetching.
- Verification (vf1a): **confirmed** — Reproduced after a reload (empty DRC store): route GET **/designs/*/drc -> 500, open the DRC view -> only 'Run DRC to validate the board.' and status '◆ 0 DRC' with the diamond probed #7aa7d9 (--status-info, ΔE 0) although the persisted report has 1 error + 32 warnings. With projection/pcb -> 500 and the report loaded: permanent 'net pt:-14', '?.1 ↔ ?.2', 'part ↔ ?.4' labels and 'Edit rules' disabled with no title/reason; no error text anywhere. Code: DesignerDrcView.tsx:114 and :121 `.catch(() => {})`. Confirms K41 (DRC part). The latency sub-claim (placeholders during the projection round trip) is negligible on loopback (projection 2 ms). Related to Q4-047 (the never-run state itself reads '0' / blank); the new defect here is that a failed load is disguised as that never-run state. S2 kept: wrong data shown (clean '0 DRC' for a board with violations), same calibration as F1D-003. · evidence: [070-k41-drcview-drcget500](../evidence/shots/vf1a/dark/070-k41-drcview-drcget500.png), [071-k41-drcview-proj500-labels](../evidence/shots/vf1a/dark/071-k41-drcview-proj500-labels.png), probe 070: diamond (1324,889) #7aa7d9 --status-info ΔE 0.0, network: GET /designs/91573bb6…/drc -> 500; GET /projection/pcb -> 500, [045-k41-drcview-unresolved-labels](../evidence/shots/f1a/light/045-k41-drcview-unresolved-labels.png) (f1a, light)

</details>

<details><summary>Q4-047 — Before DRC has ever run, the DRC view is a blank page and every DRC indicator reads '0' as if the board were clean (S3, confirmed)</summary>

- Area designer.drc · stack A · design 5909d519 · themes light, dark · viewports 1440x900
- Repro:
  1. QA-q4-board (DRC never run; Home row 'DRC not run') → view tab 'DRC'
  2. Look at the body and the status bar; switch to PCB and look at the dock DRC tab and status bar
- Expected: Centered empty state ('DRC has not been run for this board' + Run DRC button + rule preset summary) and indicators showing '—' / 'Not run' (neutral) until the first run
- Actual: The full DRC view body is completely empty; only a small grey 'Run DRC to validate the board.' at the far right of the toolbar row. Status bar shows '◆ 0 DRC' (same chip that shows real counts) in both DRC and PCB views, suggesting zero violations. After Run DRC the view shows a green 'No DRC violations' strip with no run time/revision.
- Screenshots: [020-drc-fullview-empty](../evidence/shots/q4/light/020-drc-fullview-empty.png), [021-drc-fullview-results](../evidence/shots/q4/light/021-drc-fullview-results.png), [120-shape-Oval](../evidence/shots/q4/dark/120-shape-Oval.png)
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:1` — no body empty state when result is null
- Code: `src/modules/designer/frontend/Space.tsx:1589` — status-bar DRC count defaults to 0
- Suggested fix: Render a kit EmptyState in DesignerDrcView when no result exists; make the status-bar/dock/toolbar DRC chips show '—' with title 'DRC not run' until drcStatus exists; show 'Last run r{rev} · {time}' next to results.
- Verification (vq4): **confirmed** — Confirmed from the q4 light screenshot (DRC full view empty body, only 'Run DRC to validate the board.' at the far right, status '0 DRC' with a neutral diamond) and code: DesignerDrcView.tsx:246-249 shows only the toolbar hint when report is null, with no body empty state; status bar drcCount defaults to 0 (Space.tsx:1601). Not re-run live because every owned design already has a DRC run. · evidence: [020-drc-fullview-empty](../evidence/shots/q4/light/020-drc-fullview-empty.png), [021-drc-fullview-results](../evidence/shots/q4/light/021-drc-fullview-results.png)

</details>


## T-213

**DRC/ERC run failures show only a bare 'Internal error' line; the stale error sticks above a good report, and Run DRC shows no pending state (double-click starts twice)**

- Severity **S3** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F1A-006 · known ref K40
- Depends on: ['T-006']

**Summary.** Every failure shows only the raw problem title 'Internal error' in a thin red line (no 'DRC'/'ERC' context, no dismiss/retry, not role=alert). The header meanwhile still says 'Run DRC to validate the board.', which wraps to two lines in the 300 px dock. When the run succeeds but the report GET fails, the run is lost behind the same message. After recovery the error stays: 'Internal error' renders above a fully loade…

**Root cause.** `src/modules/designer/frontend/pcb/drc/use-drc-run.ts:230` — start(): guard checks store.run only; nothing marks 'starting' before await api.startDrcRun, so a second click passes

**Proposed fix.** Run DRC shows pending state (disabled + spinner), maps errors via problem.ts, clears stale error on success. — Detail: drc-store.ts: add `starting: boolean`; set it synchronously at the top of use-drc-run.ts start() and return early when already set; clear it in beginRun/failRun. Make setReport also set error: null. DesignerDrcView.tsx:331: render '`DRC couldn't start: ${error}`' in a role='alert' strip with Retry (startRun) and Dismiss (setError(null)); show 'Starting…' and disable Run DRC while starting. Same pattern in DesignerErcView.

**Evidence.** [044-drc-dock-run-post500](../evidence/shots/f1a/dark/044-drc-dock-run-post500.png), [080-drcview-run-post500](../evidence/shots/vf1a/dark/080-drcview-run-post500.png)

<details><summary>F1A-006 — DRC/ERC run failures show only a bare 'Internal error' line; the stale error sticks above a good report, and Run DRC shows no pending state (double-click starts twice) (S3, confirmed)</summary>

- Area designer.drc · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark, light · viewports 1440x900
- Repro:
  1. route '**/designs/*/drc/runs' → 500; PCB dock DRC tab → Run DRC
  2. route '**/designs/*/drc' (report GET) → 500 only; DRC full view → Run DRC
  3. route '**/designs/*/erc' → 500; Schematic dock ERC tab → Run ERC
  4. unroute; switch Schem → DRC (view remounts and loads the report)
  5. With the latency shim, double-click Run DRC
- Expected: A contextual error ('DRC could not start: …') with Retry/Dismiss that clears when a report loads. The button shows Starting…/disabled from the first click.
- Actual: Every failure shows only the raw problem title 'Internal error' in a thin red line (no 'DRC'/'ERC' context, no dismiss/retry, not role=alert). The header meanwhile still says 'Run DRC to validate the board.', which wraps to two lines in the 300 px dock. When the run succeeds but the report GET fails, the run is lost behind the same message. After recovery the error stays: 'Internal error' renders above a fully loaded 33-violation report until the next run. During the 2.5 s start request the button still says 'Run DRC' and stays enabled. A double-click sends two POST /drc/runs (both 202) and aborts both SSE streams, and the run then finishes via the poll fallback. ERC behaves the same way: 'Run ERC to check the schematic.' plus a bare 'Internal error'.
- Screenshots: [044-drc-dock-run-post500](../evidence/shots/f1a/dark/044-drc-dock-run-post500.png), [045-drcview-run-ok-report-get500](../evidence/shots/f1a/dark/045-drcview-run-ok-report-get500.png), [046-erc-run-500](../evidence/shots/f1a/dark/046-erc-run-500.png), [050-race-dblclick-rundrc](../evidence/shots/f1a/dark/050-race-dblclick-rundrc.png)
- Network: `POST /drc/runs → 500`; `POST /drc/runs → 202 ×2 on double-click`; `GET /drc/runs/eedf71ce…/stream → net::ERR_ABORTED ×2`; `GET /erc → 500`
- Code: `src/modules/designer/frontend/pcb/drc/use-drc-run.ts:230` — start(): guard checks store.run only; nothing marks 'starting' before await api.startDrcRun, so a second click passes
- Code: `src/modules/designer/frontend/pcb/drc/drc-store.ts:180` — setReport(report) sets only report; the stale error survives hydration
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:331` — error strip renders the raw message, no dismiss/retry, no role=alert
- Suggested fix: drc-store.ts: add `starting: boolean`; set it synchronously at the top of use-drc-run.ts start() and return early when already set; clear it in beginRun/failRun. Make setReport also set error: null. DesignerDrcView.tsx:331: render '`DRC couldn't start: ${error}`' in a role='alert' strip with Retry (startRun) and Dismiss (setError(null)); show 'Starting…' and disable Run DRC while starting. Same pattern in DesignerErcView.
- Verification (vf1a): **confirmed** — Reproduced: route POST **/drc/runs -> 500, DRC view Run DRC -> a thin red line with the bare 'Internal error' (no 'DRC' context, no retry/dismiss, not role=alert) under the header hint. After unroute and a Schem -> DRC remount the report loads (labels resolve) but 'Internal error' still renders above it: drc-store.ts:180 setReport never clears error. Double-click Run DRC under the 2.5 s shim: button stays 'Run DRC' and enabled at 400 ms, two POST /drc/runs are sent, and the SSE stream is aborted once and reopened; the backend returned the same runId, so only one run happened. The double-click part is latency-only (on loopback the first POST resolves before the second click). Confirms K40 for DRC/ERC. S3 kept. · evidence: [080-drcview-run-post500](../evidence/shots/vf1a/dark/080-drcview-run-post500.png), [081-drcview-stale-error-after-recovery](../evidence/shots/vf1a/dark/081-drcview-stale-error-after-recovery.png), [082-dblclick-rundrc-inflight](../evidence/shots/vf1a/dark/082-dblclick-rundrc-inflight.png), network: POST /drc/runs x2 on double-click; GET /drc/runs/9342b0f4…/stream net::ERR_ABORTED then reopened

</details>


## T-214

**Built-in core footprints fail the default JLCPCB DRC preset out of the box: every placed part adds ~5 silkscreen warnings (0.12 mm silk width, silk 0.12 mm from mask)**

- Severity **S3** · category data · status confirmed · themes dark
- Recommendation **defer** · owner followup · wave followup · scope shared-package · estimate M
- Findings: F1B-009

**Summary.** 720 warnings on 150 non-overlapping parts: FAB_SILK_WIDTH ×150 ('Silkscreen of D42 is 0.120 mm wide < JLCPCB 2-layer min 0.150 mm') — one per part — plus FAB_SILK_CLEARANCE ×570 ('Silkscreen of R6 is 0.123 mm from a pad's mask opening < … 0.150 mm'): 4/part for R, C, L; 7/part for SOT-23; 5/part for SOIC-8. Dual LED Blinker (11 parts) likewise shows 43 + 11 of them. Real problems drown in stock-library noise and DRC…

**Root cause.** `src/shared/drc/checks/silkscreen.ts:137` — silk artwork checks against fab preset minimums

**Proposed fix.** Core footprints silk width vs JLCPCB preset — CoreLibrary data / DRC preset review. — Detail: Either regenerate/clip the core footprints' silkscreen to the preset (0.15 mm width, ≥0.15 mm from mask openings — KiCad's own export clips silk at mask openings) or make the fab silk checks clip-and-report-once per footprint; at minimum group identical per-footprint silk warnings into one row per library footprint.

**Note.** DRC + CoreLibrary data — out of scope.

**Evidence.** [023-pcb-spread-fit](../evidence/shots/f1b/dark/023-pcb-spread-fit.png)

<details><summary>F1B-009 — Built-in core footprints fail the default JLCPCB DRC preset out of the box: every placed part adds ~5 silkscreen warnings (0.12 mm silk width, silk 0.12 mm from mask) (S3, confirmed)</summary>

- Area designer.drc · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. Place core-library parts (Resistor, Capacitor, LED, diodes, SOT-23 transistors, NE555 SOIC-8, inductor) and spread them so nothing overlaps (QA-f1b-stress after spreading)
  2. Run DRC with the default fabricator (jlcpcb_2l)
- Expected: Parts shipped in the core library pass the app's default fab preset (or the preset's silk minimums match what the library ships, as KiCad's 0.12 mm silk / 0.2 mm silk-to-pad library conventions do); a fresh board of non-overlapping stock parts is warning-free.
- Actual: 720 warnings on 150 non-overlapping parts: FAB_SILK_WIDTH ×150 ('Silkscreen of D42 is 0.120 mm wide < JLCPCB 2-layer min 0.150 mm') — one per part — plus FAB_SILK_CLEARANCE ×570 ('Silkscreen of R6 is 0.123 mm from a pad's mask opening < … 0.150 mm'): 4/part for R, C, L; 7/part for SOT-23; 5/part for SOIC-8. Dual LED Blinker (11 parts) likewise shows 43 + 11 of them. Real problems drown in stock-library noise and DRC markers bury every footprint (see shots/f1b/dark/023).
- Screenshots: [023-pcb-spread-fit](../evidence/shots/f1b/dark/023-pcb-spread-fit.png)
- Network: `POST /drc/run → countsByCode {FAB_SILK_CLEARANCE:570, FAB_SILK_WIDTH:150, NET_SHORT_CIRCUIT:17, UNCONNECTED_NET:47}`
- Code: `src/shared/drc/checks/silkscreen.ts:137` — silk artwork checks against fab preset minimums
- Suggested fix: Either regenerate/clip the core footprints' silkscreen to the preset (0.15 mm width, ≥0.15 mm from mask openings — KiCad's own export clips silk at mask openings) or make the fab silk checks clip-and-report-once per footprint; at minimum group identical per-footprint silk warnings into one row per library footprint.
- Verification (vf1b): **confirmed** — Reproduced on my own 2-resistor design (QA-vf1b-netid, parts spread 16 mm apart): DRC gives FAB_SILK_CLEARANCE 8 + FAB_SILK_WIDTH 2, i.e. 5 warnings per stock 0603 resistor on a clean board. The preset values are sourced correctly (fab-presets.ts:150 minSilkLineWidthMm 0.15 and silkToMaskMm 0.15, JLCPCB published rules), so the defect is that the shipped core footprints (0.12 mm KLC silk, unclipped at mask openings) fail the app's own default preset. S3 kept. The fix belongs in the CoreLibrary data or in grouping/clipping, not in the preset. · evidence: API QA-vf1b-netid 7af2033c before-move DRC {FAB_SILK_CLEARANCE:8, FAB_SILK_WIDTH:2}, src/shared/drc/fab-presets.ts:150

</details>


## T-215

**Waiving one DRC violation adds a 'Show waived' checkbox to the DRC dock header that overflows the 300 px dock: the label is cut to 'Sho' and the 'Close DRC panel' button is pushed off-screen**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: F2A-007

**Summary.** Header row = Run DRC · Edit rules · ◆1 ◆44 ◆0 · [Show waived] · [×]. 'Show waived' label spans x 1407–1483 and the Close button sits at x 1490 (viewport 1440) — unreachable by mouse; only the checkbox box at x 1406 is visible ('☐ Sho'). Also the dock tab badge ('DRC 46') and status bar ('46 DRC') keep counting the waived item until the next run, while the chip says 44.

**Root cause.** `src/modules/designer/frontend/components/DesignerDrcView.tsx:251` — 'Show waived' Checkbox + Close IconButton share one shrink-0 group at the end of a single non-wrapping header row

**Proposed fix.** DRC dock header: move 'Show waived' into overflow/filter menu so header fits 300px. — Detail: Move 'Show waived' to a second toolbar row (or into the severity-chip group as an eye toggle), let the header wrap, keep the close button outside the overflowing group; recompute the tab/status counts after waive.

**Evidence.** [079-waived](../evidence/shots/f2a/dark/079-waived.png), [028-drc-dock-header](../evidence/shots/vf2a/dark/028-drc-dock-header.png)

<details><summary>F2A-007 — Waiving one DRC violation adds a 'Show waived' checkbox to the DRC dock header that overflows the 300 px dock: the label is cut to 'Sho' and the 'Close DRC panel' button is pushed off-screen (S3, confirmed)</summary>

- Area designer.drc · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. 1440×900, PCB, right dock at default width, DRC tab
  2. Run DRC on a board with ≥1 error and warnings
  3. Hover a violation → click 'waive'
- Expected: Header controls fit (wrap to a second row or move 'Show waived' into the list/filter area); Close stays reachable.
- Actual: Header row = Run DRC · Edit rules · ◆1 ◆44 ◆0 · [Show waived] · [×]. 'Show waived' label spans x 1407–1483 and the Close button sits at x 1490 (viewport 1440) — unreachable by mouse; only the checkbox box at x 1406 is visible ('☐ Sho'). Also the dock tab badge ('DRC 46') and status bar ('46 DRC') keep counting the waived item until the next run, while the chip says 44.
- Screenshots: [079-waived](../evidence/shots/f2a/dark/079-waived.png), [080-drc-header-overflow](../evidence/shots/f2a/dark/080-drc-header-overflow.png), `f2a/crop-drc-header.png`
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:251` — 'Show waived' Checkbox + Close IconButton share one shrink-0 group at the end of a single non-wrapping header row
- Suggested fix: Move 'Show waived' to a second toolbar row (or into the severity-chip group as an eye toggle), let the header wrap, keep the close button outside the overflowing group; recompute the tab/status counts after waive.
- Verification (vf2a): **confirmed** — Golden PCB with 1 waived violation, right dock at the default 300 px, DRC tab. Measured: Run DRC x 1149–1225, Edit rules 1233–1298, 'Show waived' label x 1407–1482, 'Close DRC panel' x 1490–1510 in a 1440 px viewport. The checkbox shows as '☐ Sho' and Close is unreachable. D6 omitted waive UI in the redesign, but waiving now exists (backend + UI), so this is not a D6 decision. I did not re-verify the transient tab-badge/status count lag after waiving; count inconsistencies are tracked under Q4-001. S3. · evidence: [028-drc-dock-header](../evidence/shots/vf2a/dark/028-drc-dock-header.png), vf2a/crop-drc-dock-header.png

</details>


## T-216

**DRC messages expose internal rule keys ('pthAnnularRingMm', 'minNpthDrillMm') and repeat the numbers with an orphaned 'mm'**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **defer** · owner followup · wave followup · scope backend · estimate S
- Findings: Q4-044

**Summary.** 'PTH annular ring 0.050 mm < JLCPCB 2-layer pthAnnularRingMm 0.180 mm 0.050 / 0.180 mm' and 'Non-plated drill 0.200 mm < JLCPCB 2-layer minNpthDrillMm 0.500 mm 0.200 / 0.500 mm' — camelCase config keys and '<' in user copy; every row appends 'measured / required mm' after a sentence that already contains both numbers, and the trailing 'mm' wraps onto its own line. Same pad also appears twice (ANNULAR RING BELOW MINI…

**Root cause.** `src/shared/drc/fab-presets.ts:357` — message embeds ${drillRule} = 'minNpthDrillMm'

**Proposed fix.** Human-readable DRC rule names in messages (strings live in src/shared/drc). — Detail: Map rule keys to labels ('PTH annular ring minimum', 'NPTH drill minimum') and phrase as 'below … minimum'; in DesignerDrcView render measured/required as a separate right-aligned mono chip (nowrap) and drop it when the message already includes the numbers, or strip numbers from messages; hide the chip for short-circuit rows.

**Note.** src/shared/drc is out of scope (engine).

**Evidence.** [189-drc-demo-run](../evidence/shots/q4/dark/189-drc-demo-run.png), [030-drc-demo-pcb](../evidence/shots/vq4/dark/030-drc-demo-pcb.png)

<details><summary>Q4-044 — DRC messages expose internal rule keys ('pthAnnularRingMm', 'minNpthDrillMm') and repeat the numbers with an orphaned 'mm' (S3, confirmed)</summary>

- Area designer.drc · stack A · design 3196d811 · themes dark · viewports 1440x900
- Repro:
  1. DRC Demo (3196d811) → PCB → right dock 'DRC' → Run DRC
  2. Read rows under 'ANNULAR BELOW FAB MINIMUM' and 'DRILL BELOW FAB MINIMUM', and any clearance row
- Expected: Plain-language limits ('PTH annular ring 0.050 mm is below JLCPCB 2-layer minimum 0.180 mm'), numbers stated once, units kept with values
- Actual: 'PTH annular ring 0.050 mm < JLCPCB 2-layer pthAnnularRingMm 0.180 mm 0.050 / 0.180 mm' and 'Non-plated drill 0.200 mm < JLCPCB 2-layer minNpthDrillMm 0.500 mm 0.200 / 0.500 mm' — camelCase config keys and '<' in user copy; every row appends 'measured / required mm' after a sentence that already contains both numbers, and the trailing 'mm' wraps onto its own line. Same pad also appears twice (ANNULAR RING BELOW MINIMUM + ANNULAR BELOW FAB MINIMUM). Short-circuit rows read 'overlap 0.000 / 0.250 mm', which is meaningless for a short.
- Screenshots: [189-drc-demo-run](../evidence/shots/q4/dark/189-drc-demo-run.png), [007-drc-dock](../evidence/shots/q4/light/007-drc-dock.png), [030-drc-demo-pcb](../evidence/shots/vq4/dark/030-drc-demo-pcb.png), [029-drc-dock](../evidence/shots/vq4/dark/029-drc-dock.png)
- Code: `src/shared/drc/fab-presets.ts:357` — message embeds ${drillRule} = 'minNpthDrillMm'
- Code: `src/shared/drc/fab-presets.ts:373` — message embeds ${ringRule} = 'pthAnnularRingMm'
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:413` — always appends measured / required mm
- Suggested fix: Map rule keys to labels ('PTH annular ring minimum', 'NPTH drill minimum') and phrase as 'below … minimum'; in DesignerDrcView render measured/required as a separate right-aligned mono chip (nowrap) and drop it when the message already includes the numbers, or strip numbers from messages; hide the chip for short-circuit rows.
- Verification (vq4): **confirmed** — Reproduced on DRC Demo: 'PTH annular ring 0.050 mm < JLCPCB 2-layer pthAnnularRingMm 0.180 mm 0.050 / 0.180 mm' with the orphan 'mm' wrapping; 'Non-plated drill … minNpthDrillMm …'; pad 3e4e4e is listed under both ANNULAR RING BELOW MINIMUM and ANNULAR BELOW FAB MINIMUM; short rows say 'overlap 0.000 / 0.250 mm'. fab-presets.ts:357/373 embed rule keys; DesignerDrcView.tsx:412-416 always appends measured/required. · evidence: [030-drc-demo-pcb](../evidence/shots/vq4/dark/030-drc-demo-pcb.png), [029-drc-dock](../evidence/shots/vq4/dark/029-drc-dock.png)

</details>

