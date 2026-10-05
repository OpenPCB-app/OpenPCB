# tasks — QA findings

[← index](../README.md) · 3 triage entries · S1 0 · S2 0 · S3 1 · S4 2

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-384](#t-384) | S3 | Tasks space white-screens the app when /tasks returns an error JSON (tasks.map is not a function) | Q9-022 | fix-now | K1 / W2 | frontend | XS |
| [T-385](#t-385) | S4 | Tasks module is unreachable from the UI (hidden from rail; no menu/shortcut) | Q9-021 | fix-now | K1 / W2 | frontend | S |
| [T-386](#t-386) | S4 | Tasks list is clipped (36 of 50 rows unreachable), has no loading state, and is styled with raw palette (light-pink error box in dark theme) | Q9-023 | fix-now | K1 / W2 | frontend | M |

## T-384

**Tasks space white-screens the app when /tasks returns an error JSON (tasks.map is not a function)**

- Severity **S3** · category crash · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate XS
- Findings: Q9-022 · known ref K01

**Summary.** #root becomes empty (innerHTML length 0); console 'TypeError: tasks.map is not a function'. The fetch never checks response.ok and stores the problem object as the task array. Rated S2 only because the space is currently hidden (K42); it is S1 once reachable.

**Root cause.** `src/modules/tasks/frontend/Space.tsx:13` — .then(response => response.json()) without ok check; setTasks(data) with non-array

**Proposed fix.** Guard non-array responses; error state with Retry. — Detail: tasks/frontend/Space.tsx:12-16: if (!response.ok) throw new Error(problem?.title ?? `Couldn't load tasks (${response.status})`); setTasks(Array.isArray(data) ? data : []); plus the module error boundary (K01).

**Evidence.** [036-tasks-500-crash](../evidence/shots/q9/dark/036-tasks-500-crash.png), [020-tasks-500-crash](../evidence/shots/vq9/dark/020-tasks-500-crash.png)

<details><summary>Q9-022 — Tasks space white-screens the app when /tasks returns an error JSON (tasks.map is not a function) (S3, confirmed)</summary>

- Area tasks · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. route '**/api/modules/tasks/tasks*' -> 500 application/problem+json {"type":"about:blank","title":"Internal error","status":500}
  2. eval navigateToModule('tasks')
- Expected: Error message with Retry; app keeps working
- Actual: #root becomes empty (innerHTML length 0); console 'TypeError: tasks.map is not a function'. The fetch never checks response.ok and stores the problem object as the task array. Rated S2 only because the space is currently hidden (K42); it is S1 once reachable.
- Screenshots: [036-tasks-500-crash](../evidence/shots/q9/dark/036-tasks-500-crash.png), [020-tasks-500-crash](../evidence/shots/vq9/dark/020-tasks-500-crash.png)
- Console: `TypeError: tasks.map is not a function`
- Network: `GET /api/modules/tasks/tasks?limit=50 -> 500 (injected)`
- Code: `src/modules/tasks/frontend/Space.tsx:13` — .then(response => response.json()) without ok check; setTasks(data) with non-array
- Suggested fix: tasks/frontend/Space.tsx:12-16: if (!response.ok) throw new Error(problem?.title ?? `Couldn't load tasks (${response.status})`); setTasks(Array.isArray(data) ? data : []); plus the module error boundary (K01).
- Verification (vq9): **confirmed** — Reproduced: route GET /api/modules/tasks/tasks* → 500 problem+json, navigateToModule('tasks') via eval → #root innerHTML length 0, console 'TypeError: tasks.map is not a function'. tasks/frontend/Space.tsx:12-15 never checks response.ok and stores the problem object. Recalibrated S2→S3: the space is unreachable from the UI (Q9-021, manifest hidden), so no user can hit it today; it becomes S1 the moment the module is exposed. · evidence: [020-tasks-500-crash](../evidence/shots/vq9/dark/020-tasks-500-crash.png), console: TypeError: tasks.map is not a function

</details>


## T-385

**Tasks module is unreachable from the UI (hidden from rail; no menu/shortcut)**

- Severity **S4** · category stub · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate S
- Findings: Q9-021 · known ref K42

**Summary.** manifest sidebar.hidden:true; rail shows Home/Designer/Library/Docs/Assistant only; the space renders only via the navigation store. When shown, no rail item is highlighted.

**Root cause.** `src/modules/tasks/manifest.json:13` — "hidden": true

**Proposed fix.** Unhide Tasks in rail (manifest sidebar.hidden=false) with icon/order. — Detail: Decide: expose background work as a status-bar activity popover or Settings > Diagnostics page (kit table), or drop the frontend entry until designed. Do not un-hide before Q9-022/Q9-023 are fixed.

**Note.** Binding: build Tasks in rail.

**Evidence.** [034-tasks-list](../evidence/shots/q9/dark/034-tasks-list.png), [018-tasks-list](../evidence/shots/vq9/dark/018-tasks-list.png)

<details><summary>Q9-021 — Tasks module is unreachable from the UI (hidden from rail; no menu/shortcut) (S4, confirmed)</summary>

- Area tasks · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Look at the left rail, Settings, context menu and command surfaces for 'Tasks'
  2. Only eval navigateToModule('tasks') opens it
- Expected: Either a deliberate entry point (rail 'system' group, Settings > Diagnostics, or a status-bar background-work indicator) or the module is not shipped
- Actual: manifest sidebar.hidden:true; rail shows Home/Designer/Library/Docs/Assistant only; the space renders only via the navigation store. When shown, no rail item is highlighted.
- Screenshots: [034-tasks-list](../evidence/shots/q9/dark/034-tasks-list.png), [018-tasks-list](../evidence/shots/vq9/dark/018-tasks-list.png)
- Network: `GET /api/modules/tasks/tasks?limit=50 -> 200 (50 assistant.chat tasks)`
- Code: `src/modules/tasks/manifest.json:13` — "hidden": true
- Code: `src/core/frontend/src/components/LeftSidebar.tsx:36` — filters hidden modules
- Suggested fix: Decide: expose background work as a status-bar activity popover or Settings > Diagnostics page (kit table), or drop the frontend entry until designed. Do not un-hide before Q9-022/Q9-023 are fixed.
- Verification (vq9): **confirmed** — Verified: tasks/manifest.json sidebar.hidden:true since the module was added (commit b5fb5a0), LeftSidebar.tsx:35-37 filters hidden modules, no code path calls navigateToModule('tasks'); only reachable via eval; with the space open no rail item is active. This is a deliberate hide, so it is a product decision rather than a defect — kept as S4 design-decision per K42. · evidence: [018-tasks-list](../evidence/shots/vq9/dark/018-tasks-list.png), src/modules/tasks/manifest.json:13 "hidden": true

</details>


## T-386

**Tasks list is clipped (36 of 50 rows unreachable), has no loading state, and is styled with raw palette (light-pink error box in dark theme)**

- Severity **S4** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner K1 · wave W2 · scope frontend · estimate M
- Findings: Q9-023 · known ref K45

**Summary.** List container is overflow-hidden inside a non-scrolling h-full column: scrollHeight 2799 vs 790 visible, wheel does nothing, rows 15-50 unreachable. Before data arrives it says 'No tasks yet.' (no loading state). Error shows the raw exception ('Unexpected token \'o\', "not json" is not valid JSON') in a bg-red-50 box that stays light pink (#fef2f2) in dark theme, text #c40d14 (dE 19.2), and 'No tasks yet.' still re…

**Root cause.** `src/modules/tasks/frontend/Space.tsx:26` — flex h-full flex-col p-6 bg-slate-50 dark:bg-slate-950 — no overflow-auto

**Proposed fix.** Tasks list scrolls, loading state, tokens. — Detail: tasks/frontend/Space.tsx:26-38: make the list 'min-h-0 flex-1 overflow-auto' inside the h-full column, add loading/empty/error states (no 'No tasks yet.' while loading or on error), token classes (bg-surface-app, border-border, bg-status-danger-soft text-status-danger), kit table rows 22px with status chips and relative timestamps, Refresh button or subscribe to the tasks SSE stream.

**Evidence.** [034-tasks-list](../evidence/shots/q9/dark/034-tasks-list.png), [018-tasks-list](../evidence/shots/vq9/dark/018-tasks-list.png)

<details><summary>Q9-023 — Tasks list is clipped (36 of 50 rows unreachable), has no loading state, and is styled with raw palette (light-pink error box in dark theme) (S4, confirmed)</summary>

- Area tasks · stack A · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. eval navigateToModule('tasks') on stack A (50 tasks)
  2. Scroll the list with the mouse wheel
  3. Make /tasks return invalid JSON (route body 'not json') and reload the space
- Expected: Scrollable dense table (22px rows: type, status chip, created/duration, id), 'Loading…' while fetching, token-coloured error with Retry, no 'No tasks yet' under an error
- Actual: List container is overflow-hidden inside a non-scrolling h-full column: scrollHeight 2799 vs 790 visible, wheel does nothing, rows 15-50 unreachable. Before data arrives it says 'No tasks yet.' (no loading state). Error shows the raw exception ('Unexpected token \'o\', "not json" is not valid JSON') in a bg-red-50 box that stays light pink (#fef2f2) in dark theme, text #c40d14 (dE 19.2), and 'No tasks yet.' still renders below it. Rows show only type + raw UUID + status (no timestamps/duration, no status colour), 56px tall, rounded-xl/rounded-lg containers, text-xl title — none of the kit metrics. No refresh/live update (SSE route exists).
- Screenshots: [034-tasks-list](../evidence/shots/q9/dark/034-tasks-list.png), [037-tasks-error-state](../evidence/shots/q9/dark/037-tasks-error-state.png), [010-tasks-1440](../evidence/shots/q9/light/010-tasks-1440.png), [018-tasks-list](../evidence/shots/vq9/dark/018-tasks-list.png), [019-tasks-error-state](../evidence/shots/vq9/dark/019-tasks-error-state.png)
- Pixel probes: {"file": "shots/q9/dark/037-tasks-error-state.png", "x": 700, "y": 95, "hex": "#fef2f2", "nearestToken": "--text-strong", "deltaE": 4.3}; {"file": "shots/q9/dark/037-tasks-error-state.png", "x": 118, "y": 106, "hex": "#c40d14", "nearestToken": "--net-power", "deltaE": 19.2}; {"file": "shots/q9/light/010-tasks-1440.png", "x": 700, "y": 115, "hex": "#ffffff", "nearestToken": "--surface-input (list uses bg-white instead of a surface token)", "deltaE": 0.0}
- Code: `src/modules/tasks/frontend/Space.tsx:26` — flex h-full flex-col p-6 bg-slate-50 dark:bg-slate-950 — no overflow-auto
- Code: `src/modules/tasks/frontend/Space.tsx:29` — border-red-300 bg-red-50 text-red-700 without dark variants
- Code: `src/modules/tasks/frontend/Space.tsx:30` — overflow-hidden rounded-xl list
- Code: `src/modules/tasks/frontend/Space.tsx:37` — 'No tasks yet.' also shown while loading/after error
- Suggested fix: tasks/frontend/Space.tsx:26-38: make the list 'min-h-0 flex-1 overflow-auto' inside the h-full column, add loading/empty/error states (no 'No tasks yet.' while loading or on error), token classes (bg-surface-app, border-border, bg-status-danger-soft text-status-danger), kit table rows 22px with status chips and relative timestamps, Refresh button or subscribe to the tasks SSE stream.
- Verification (vq9): **confirmed** — Reproduced: 50 rows, list scrollHeight 2799 vs clientHeight 788, parent column overflow visible and not scrollable; after mousewheel 1500 no element scrolled (row 15 still at y=871). Invalid JSON → raw 'Unexpected token 'o', "not json" is not valid JSON' in a #fef2f2 box (light pink in dark theme, probe dE 4.3 to --text-strong) with #c40d14 text (dE 19.2) and 'No tasks yet.' still rendered below. Recalibrated S3→S4: same latent surface as Q9-022 (hidden from the UI, PLAN §0 token re-skin only). · evidence: [018-tasks-list](../evidence/shots/vq9/dark/018-tasks-list.png), [019-tasks-error-state](../evidence/shots/vq9/dark/019-tasks-error-state.png), probe 700,90 #fef2f2; 118,102 #c40d14

</details>

