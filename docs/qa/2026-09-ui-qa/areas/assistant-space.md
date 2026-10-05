# assistant.space — QA findings

[← index](../README.md) · 34 triage entries · S1 0 · S2 12 · S3 19 · S4 3

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-321](#t-321) | S2 | Assistant chat list load failure falls back to 'No chats yet.' with no retry (same pattern on Home/Settings) | F1D-003 | fix-now | A1 / W3 | frontend | M |
| [T-322](#t-322) | S2 | An unreachable default provider ends every run with 'Retrying this answer in chat-only mode.' and nothing else — the connection error is swallowed, no Retry, no way to Settings, and every indicator stays green | F2C-001 | decide (DEC-A) | A1 / W3 | backend | M |
| [T-323](#t-323) | S2 | After 'Open in Assistant view', every chat-list refresh (run end, Stop, delete) snaps the Assistant space back to that chat | F2C-003 | fix-now | A1 / W3 | frontend | S |
| [T-324](#t-324) | S2 | Assistant picks wrong provider/model: hard-coded default before load, first (paid) model on switch, New chat ignores Settings default | Q8-001, Q10-015, F2C-012, F1D-001 | fix-now | A1+A2 / W3 | frontend | S |
| [T-325](#t-325) | S2 | Every tool call renders twice — a 'requested' card stuck on 'running…' spinner forever plus the real result; tool count doubled | Q8-002 | fix-now (DEC-A) | A3 / W3 | frontend | S |
| [T-326](#t-326) | S2 | Settings 'Tool policy: Auto read · confirm writes' is ignored — assistant write proposals auto-apply without confirmation | Q8-003 | decide (DEC-A) | C2 / W2 | decision | S |
| [T-327](#t-327) | S2 | Assistant reports 'R99 has been added' but the part got reference R6 — placement tool can't set a reference and its result omits the assigned one | Q8-004 | decide (DEC-A) | A1 / W3 | backend | S |
| [T-328](#t-328) | S2 | 'Configure providers' button in the model pill does nothing (onOpenSettings never wired) in Assistant space and dock | Q8-008 | fix-now | A2 / W3 | frontend | XS |
| [T-329](#t-329) | S2 | Assistant space uses native window.prompt (rename) and window.confirm (row/header/bulk delete) | Q8-013, Q8-014 | fix-now | A1 / W3 | frontend | S |
| [T-330](#t-330) | S2 | Send failures are invisible: the error alert renders at the top of the thread (≈3800px above the viewport) and says only 'Internal error' | Q8-017 | fix-now | A1 / W3 | frontend | S |
| [T-331](#t-331) | S2 | 'Retry' on a stopped/cancelled run does nothing (dead button) | Q8-031 | fix-now | A1 / W3 | frontend | XS |
| [T-332](#t-332) | S2 | @-mentions of built-in library components render as raw '@[library-component:openpcb.core.passive.resistor\|Resistor]' — mention regex rejects '.' in ids (frontend and backend) | Q8-034 | fix-now (DEC-A) | A2 / W3 | frontend | XS |
| [T-333](#t-333) | S3 | Wide markdown tables and unbroken URLs overflow the message column — the whole chat thread scrolls horizontally | F1D-004 | fix-now | A3 / W3 | frontend | S |
| [T-334](#t-334) | S3 | Model pill lists keyless cloud providers (OpenAI) as selectable with no hint, although Settings says 'Needs API key to activate', and the resulting 'API key required' error offers no way to add a key | F2C-004 | fix-now | A2 / W3 | frontend | S |
| [T-335](#t-335) | S3 | 'Pinned' chat filter is permanently empty — no Pin action exists anywhere; empty state then says 'No chats yet.' | Q8-005 | fix-now | A1 / W3 | frontend | XS |
| [T-336](#t-336) | S3 | Chat list says 'No chats yet.' for any empty filter or search miss | Q8-006 | fix-now | A1 / W3 | frontend | XS |
| [T-337](#t-337) | S3 | Model picker popover: 460-entry native <select> with no search or free/paid hint, unlabeled comboboxes, Esc does not close it | Q8-007 | fix-now | A2 / W3 | frontend | M |
| [T-338](#t-338) | S3 | Mermaid 'Fullscreen' shows the diagram smaller than inline; overlay ignores Esc, has no dialog role, drops focus to <body> | Q8-009 | fix-now | A3 / W3 | frontend | S |
| [T-339](#t-339) | S3 | Mermaid diagrams hard-coded violet/navy; light theme renders prompt-styled nodes as black boxes | Q8-010, Q8-027 | fix-now (DEC-A) | A3 / W3 | frontend | S |
| [T-340](#t-340) | S3 | Multi-step answers glue each iteration's text together with no separator ('…LED components.The design…', '…brightness)?Let me examine…') | Q8-011 | decide (DEC-A) | A1 / W3 | backend | XS |
| [T-341](#t-341) | S3 | Header 'Chat actions' menu stays open after Archive / Export / Delete and blocks the whole page (body pointer-events:none) | Q8-015 | fix-now | A1 / W3 | frontend | XS |
| [T-342](#t-342) | S3 | Multi-select keeps chats selected across filters; 'Delete selected' deletes hidden (e.g. archived) chats the user can't see | Q8-016 | fix-now | A1 / W3 | frontend | XS |
| [T-343](#t-343) | S3 | Chat row keeps the pulsing 'run active' dot after a run is cancelled (Stop) | Q8-018 | fix-now | A1 / W3 | frontend | XS |
| [T-344](#t-344) | S3 | Clicking an @page mention in a chat message opens Docs with 'No page selected' instead of the page | Q8-019 | fix-now | K1+A3 / W2 | frontend | S |
| [T-345](#t-345) | S3 | Composer shows raw mention markup '@[design:<uuid>\|Name]' after picking a mention (and exports it verbatim) | Q8-020 | fix-now | A2 / W3 | frontend | M |
| [T-346](#t-346) | S3 | Slash quick-actions menu is mouse-only; Enter on '/' sends a literal '/' message to the LLM | Q8-021 | fix-now | A2 / W3 | frontend | S |
| [T-347](#t-347) | S3 | @-mention autocomplete uses emoji icons (🛠️ 🔌 📄), no group headers or listbox semantics; duplicate-named designs indistinguishable | Q8-022 | fix-now | A2 / W3 | frontend | S |
| [T-348](#t-348) | S3 | Assistant space/dock is not on the redesign kit: raw sky/amber/red/emerald palette, shadow-xl + gradient composer, 56px header, 10px bubble radii, hand-rolled menus | Q8-026 | fix-now | A1+A2+A3 / W3 | frontend | L |
| [T-349](#t-349) | S3 | Light theme: composer hint row, footer meta and kbd hints are ~1.5–2.7:1 contrast (10px text) | Q8-028 | fix-now | A2 / W3 | frontend | XS |
| [T-350](#t-350) | S3 | Chat list rows trap keyboard: nested checkbox and '…' button can't be activated (row keydown swallows Enter/Space) and the '…' button stays invisible when focused | Q8-030 | fix-now | A1 / W3 | frontend | XS |
| [T-351](#t-351) | S3 | Proposal cards: applied/rejected cards keep disabled Apply/Reject/Allow buttons and no Undo; operations show raw nanometres and deletions don't name the part | Q8-032 | fix-now | A3 / W3 | frontend | S |
| [T-352](#t-352) | S4 | Assistant header gives the chat title the least room: at 1100px only ~12 chars show while the linked-design chip, tools badge and model pill keep full width | F1D-009 | fix-now | A1 / W3 | frontend | XS |
| [T-353](#t-353) | S4 | Inline HTML from the model (e.g. V<sub>F</sub>) is shown as literal tags in chat tables/lists | Q8-012 | fix-now | A3 / W3 | frontend | XS |
| [T-354](#t-354) | S4 | Chats are never auto-titled and 'New' immediately persists an empty 'New chat' row (list fills with identical 'New chat' entries) | Q8-033 | defer | A1 / followup | backend | S |

## T-321

**Assistant chat list load failure falls back to 'No chats yet.' with no retry (same pattern on Home/Settings)**

- Severity **S2** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate M
- Findings: F1D-003 · known ref K40

**Summary.** Home: raw 'Failed to load designs: HTTP 500' strip above 'No designs yet / Create your first design' (no Retry). Clicking filters does not refetch; you have to leave Home and come back. Assistant: the sidebar says 'No chats yet.' (All 0) and a generic 'Internal error' banner sits in the thread area, unrelated to the list. Dismissing it leaves an empty list, nothing refetches, and the user is invited to start a new c…

**Root cause.** `src/modules/assistant/frontend/Space.tsx:724` — Promise.all([refreshConfig(), refreshChats()]).catch -> generic setError('Internal error') in the thread; chats stays [] and nothing retries

**Proposed fix.** Chat list load failure -> error state + Retry (not 'No chats yet.'); Home/Settings parts covered by their own entries. — Detail: Add one kit ErrorState (human message + Retry button, token colours) in src/shared/frontend/ui and a per-list status ('loading'|'error'|'ready'). Assistant Space.tsx: split the mount effect (:724) so refreshChats failure sets chatsError, render ErrorState with Retry -> refreshChats() in the sidebar list instead of 'No chats yet.' (:1351), and keep the thread banner for config errors only. HomeScreen.tsx: when error is set render ErrorState (Retry -> fetchDesigns) instead of emptyState (:350) and map status to copy…

**Evidence.** [050-err500-home](../evidence/shots/f1d/dark/050-err500-home.png), [010-err500-assistant-chats](../evidence/shots/vf1d/dark/010-err500-assistant-chats.png)

<details><summary>F1D-003 — List load failures have no in-place retry (Home, Assistant chats, Settings › Libraries) and fall back to 'No designs yet' / 'No chats yet.' empty states — recovery needs navigation (S2, confirmed)</summary>

- Area cross-cutting · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. In-page fetch shim returns 500 application/problem+json for GET /api/modules/designer/designs, /knowledge/workspaces/default/tree, /assistant/chats, /library/sources, /library/core-library/status
  2. Navigate (in memory) to Home, Docs, Assistant, Settings › Libraries and screenshot each
  3. Remove the shim (backend healthy again) and look for any in-UI way to retry without leaving the screen (dismiss, filter click, wait)
- Expected: Each list shows an error with a Retry action next to the failed list, never the 'nothing here, create one' empty state. Errors use human copy, not raw codes.
- Actual: Home: raw 'Failed to load designs: HTTP 500' strip above 'No designs yet / Create your first design' (no Retry). Clicking filters does not refetch; you have to leave Home and come back. Assistant: the sidebar says 'No chats yet.' (All 0) and a generic 'Internal error' banner sits in the thread area, unrelated to the list. Dismissing it leaves an empty list, nothing refetches, and the user is invited to start a new chat. It recovers only after leaving and re-entering Assistant. Settings › Libraries: 'Internal error' banner plus the core card and sources table stuck on 'Loading…'. It recovers only by switching tabs (General → Libraries). Docs is the only list with a working Retry, which fixed it in one click (after shim removal: 1 GET, 8 rows), but it shows the raw code 'HTTP_500' in raw red.
- Screenshots: [050-err500-home](../evidence/shots/f1d/dark/050-err500-home.png), [051-err500-docs](../evidence/shots/f1d/dark/051-err500-docs.png), [052-err500-assistant](../evidence/shots/f1d/dark/052-err500-assistant.png), [053-err500-settings-libraries](../evidence/shots/f1d/dark/053-err500-settings-libraries.png), [054-recover-settings-libraries-after-tabswitch](../evidence/shots/f1d/dark/054-recover-settings-libraries-after-tabswitch.png), [055-recover-assistant-no-retry](../evidence/shots/f1d/dark/055-recover-assistant-no-retry.png), [056-recover-docs-retry](../evidence/shots/f1d/dark/056-recover-docs-retry.png), [150-err500-assistant](../evidence/shots/f1d/light/150-err500-assistant.png), [151-err500-docs](../evidence/shots/f1d/light/151-err500-docs.png), [152-err500-home](../evidence/shots/f1d/light/152-err500-home.png), [153-err500-settings-libraries](../evidence/shots/f1d/light/153-err500-settings-libraries.png), [010-err500-assistant-chats](../evidence/shots/vf1d/dark/010-err500-assistant-chats.png), [011-err500-home](../evidence/shots/vf1d/dark/011-err500-home.png), [012-err500-docs](../evidence/shots/vf1d/dark/012-err500-docs.png), [013-err500-settings-libraries](../evidence/shots/vf1d/dark/013-err500-settings-libraries.png)
- Network: `After shim removal: Home/Assistant made 0 requests until navigation; Settings refetched only on tab switch; Docs Retry → GET /knowledge/workspaces/default/tree 200`
- Code: `src/modules/assistant/frontend/Space.tsx:724` — Promise.all([refreshConfig(), refreshChats()]).catch -> generic setError('Internal error') in the thread; chats stays [] and nothing retries
- Code: `src/modules/assistant/frontend/Space.tsx:1351` — 'No chats yet.' rendered for a failed load
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:138` — raw 'Failed to load designs: HTTP ${status}'; :350 renders emptyState ('No designs yet' + New design) while error is set; strip at :489 has no Retry (= Q1-003)
- Code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:356` — sources===null stays 'Loading…' after a failed fetch (= Q2-014)
- Code: `src/modules/knowledge/frontend/components/Sidebar/PageTree.tsx:49` — only list with Retry; shows raw 'HTTP_500' in text-red-600 (= Q9-012)
- Suggested fix: Add one kit ErrorState (human message + Retry button, token colours) in src/shared/frontend/ui and a per-list status ('loading'|'error'|'ready'). Assistant Space.tsx: split the mount effect (:724) so refreshChats failure sets chatsError, render ErrorState with Retry -> refreshChats() in the sidebar list instead of 'No chats yet.' (:1351), and keep the thread banner for config errors only. HomeScreen.tsx: when error is set render ErrorState (Retry -> fetchDesigns) instead of emptyState (:350) and map status to copy ('Couldn't load designs — the local service didn't respond') instead of 'HTTP 500' (:138). LibrariesPanel.tsx:356/467: render ErrorState with Retry -> loadSources/loadStatus. PageTree.tsx:49: reuse the kit ErrorState and human copy instead of raw 'HTTP_500'.
- Verification (vf1d): **confirmed** — Reproduced with shim 500s: Assistant /chats -> sidebar 'No chats yet.' (All 0) + thread banner 'Internal error', no Retry; after removing the failure, filter clicks issued 0 requests and the list stayed empty. Home -> 'Failed to load designs: HTTP 500' above 'No designs yet' with no Retry. Docs -> 'HTTP_500' + Retry. Settings › Libraries -> 'Internal error' + two 'Loading…' still present 3 s after the failure was lifted, 0 Retry buttons. Home/Settings/Docs parts are already filed (Q1-003 S2, Q2-014 S3, Q9-012 S2); the new instance is the Assistant chat list, which claims 'No chats yet.' when chats exist (wrong data shown) — S2 kept, consistent with Q1-003. Triage should fold this umbrella together with Q1-003/Q2-014/Q9-012 under one shared ErrorState fix. · evidence: [010-err500-assistant-chats](../evidence/shots/vf1d/dark/010-err500-assistant-chats.png), [011-err500-home](../evidence/shots/vf1d/dark/011-err500-home.png), [012-err500-docs](../evidence/shots/vf1d/dark/012-err500-docs.png), [013-err500-settings-libraries](../evidence/shots/vf1d/dark/013-err500-settings-libraries.png)

</details>


## T-322

**An unreachable default provider ends every run with 'Retrying this answer in chat-only mode.' and nothing else — the connection error is swallowed, no Retry, no way to Settings, and every indicator stays green**

- Severity **S2** · category error-handling · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-A · owner A1 · wave W3 · scope backend · estimate M
- Findings: F2C-001

**Summary.** After ~1.1 s the bubble shows only the italic line 'Provider failed while tools were enabled. Retrying this answer in chat-only mode.' Nothing else ever appears — no answer, no error, no Retry, no link to Settings. The task is status 'completed' with error null (created 18:56:35.723, completed 18:56:35.750), and the persisted message content is just that warning. The chat-only retry fails too (ECONNREFUSED), but its…

**Root cause.** `src/modules/assistant/backend/run-service.ts:762` — on failedEvent writes the 'Retrying…' warning, then runs the chat-only retry without capturing its own run.failed

**Proposed fix.** Backend: surface provider connection error in run result instead of generic chat-only retry line. — Detail: Backend (run-service.ts:754-795): record run.failed from the chat-only retry loop too. When the retry also fails, or when the first failure is a transport error (fetch 'Unable to connect' / ECONNREFUSED / ENOTFOUND / abort-timeout, for which a tools-off retry is pointless), replace the 'Retrying…' text via setMessageContent with a readable error and throw so the task ends 'failed' with {type:'provider', message:`Can't reach ${provider.label} at ${baseUrl}`, retryable:true}. Frontend: render failed runs with Retry…

**Evidence.** [001-settings-assistant-omlx-active](../evidence/shots/f2c/dark/001-settings-assistant-omlx-active.png), [201-omlx-hello-1s](../evidence/shots/vf2c/dark/201-omlx-hello-1s.png)

<details><summary>F2C-001 — An unreachable default provider ends every run with 'Retrying this answer in chat-only mode.' and nothing else — the connection error is swallowed, no Retry, no way to Settings, and every indicator stays green (S2, confirmed)</summary>

- Area assistant.space · stack B · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack B: Settings › Assistant — default provider is oMLX (http://127.0.0.1:8000/v1, nothing listening). The provider card says 'Active · Qwen3.5-27B-…' with a green dot
  2. First-run view (chat list empty, simulated by routing GET /assistant/chats → []): the welcome screen offers four sample prompts under a green pill 'Qwen3.5-27B-…', with no hint that a local model server must be running and no provider setup CTA; clicking a suggestion leads to the same dead end
  3. Assistant › New, model pill → Provider oMLX, type 'hello', Enter
  4. Wait 5 s, then 60 s. Also repeat in the Designer dock (Cmd+I) on Schem and on PCB
  5. Check GET /api/modules/tasks/tasks/<taskId> and GET /chats/<id>/messages
- Expected: Within a few seconds a clear error in the message bubble: 'Can't reach oMLX at http://127.0.0.1:8000 — is the server running?', with Retry and an 'Open provider settings' action. The provider status dot/pill turns red or amber.
- Actual: After ~1.1 s the bubble shows only the italic line 'Provider failed while tools were enabled. Retrying this answer in chat-only mode.' Nothing else ever appears — no answer, no error, no Retry, no link to Settings. The task is status 'completed' with error null (created 18:56:35.723, completed 18:56:35.750), and the persisted message content is just that warning. The chat-only retry fails too (ECONNREFUSED), but its run.failed event is not captured. The run therefore counts as answered and the empty_response Retry path never fires. The same happens in the dock on Schem and PCB (each send adds another 'Retrying…' bubble). Every health indicator stays green throughout: the Settings card shows 'Active' (#6fbf7a, --status-success), the header pill dot is emerald #00bc7d, the sidebar footer dot is #6fbf7a and the chat row dot is green. The pill's model list shows 4 cached oMLX models, so nothing hints that the server is down.
- Screenshots: [001-settings-assistant-omlx-active](../evidence/shots/f2c/dark/001-settings-assistant-omlx-active.png), [005-omlx-hello-5s](../evidence/shots/f2c/dark/005-omlx-hello-5s.png), [013-dock-send-7s](../evidence/shots/f2c/dark/013-dock-send-7s.png), [014-dock-pcb-send](../evidence/shots/f2c/dark/014-dock-pcb-send.png), [110-omlx-hello-light](../evidence/shots/f2c/light/110-omlx-hello-light.png), [111-dock-light-send](../evidence/shots/f2c/light/111-dock-light-send.png), [114-1100-assistant-omlx](../evidence/shots/f2c/light/114-1100-assistant-omlx.png), [124-first-run-assistant](../evidence/shots/f2c/light/124-first-run-assistant.png), [201-omlx-hello-1s](../evidence/shots/vf2c/dark/201-omlx-hello-1s.png), [202-omlx-hello-8s](../evidence/shots/vf2c/dark/202-omlx-hello-8s.png), [225-settings-assistant-omlx](../evidence/shots/vf2c/dark/225-settings-assistant-omlx.png), [236-1100-dock-omlx-refused](../evidence/shots/vf2c/light/236-1100-dock-omlx-refused.png), [237-first-run-assistant](../evidence/shots/vf2c/light/237-first-run-assistant.png)
- Console: `no errors or warnings logged`
- Network: `POST /api/modules/assistant/chats/d64eab56…/messages → 201`; `GET /api/modules/tasks/tasks/4894037c… → 200 {status:'completed', error:null}`; `message a91d2c4b content: '_Provider failed while tools were enabled. Retrying this answer in chat-only mode._'`
- Pixel probes: {"file": "shots/f2c/dark/001-settings-assistant-omlx-active.png", "x": 623, "y": 671, "hex": "#6fbf7a", "nearestToken": "--status-success", "deltaE": 0.0}; {"file": "shots/f2c/dark/005-omlx-hello-5s.png", "x": 1147, "y": 28, "hex": "#00bc7d", "nearestToken": "--status-success", "deltaE": 17.3}; {"file": "shots/f2c/light/110-omlx-hello-light.png", "x": 1147, "y": 28, "hex": "#00bc7d", "nearestToken": "--net-ground", "deltaE": 28.1}
- Code: `src/modules/assistant/backend/run-service.ts:762` — on failedEvent writes the 'Retrying…' warning, then runs the chat-only retry without capturing its own run.failed
- Code: `src/modules/assistant/backend/run-service.ts:790` — answeredOrToolWork() is true because the warning text is non-blank → no empty_response, task completes as success
- Code: `src/modules/assistant/backend/run-service.ts:1241` — run.failed is only forwarded as an ai event; never turns the task into failed
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:621` — 'Active ·' label depends only on enabled plus a model, not on reachability
- Code: `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:31` — green 'Tools + streaming OK' comes from a stale capabilities probe and never reflects the current connection (raw bg-emerald-500)
- Code: `src/modules/assistant/backend/run-service.ts:754` — failedEvent captured only from the first (tools) loop; the chat-only retry loop at :776-795 never records its own run.failed
- Code: `src/modules/assistant/frontend/Space.tsx:573` — run.failed is handled only for the cloud 401 refresh path; any other errorMessage is dropped (same in DesignerChatDock.tsx:378)
- Code: `src/modules/assistant/frontend/Space.tsx:1357` — sidebar footer dot is hard-coded bg-status-success
- Suggested fix: Backend (run-service.ts:754-795): record run.failed from the chat-only retry loop too. When the retry also fails, or when the first failure is a transport error (fetch 'Unable to connect' / ECONNREFUSED / ENOTFOUND / abort-timeout, for which a tools-off retry is pointless), replace the 'Retrying…' text via setMessageContent with a readable error and throw so the task ends 'failed' with {type:'provider', message:`Can't reach ${provider.label} at ${baseUrl}`, retryable:true}. Frontend: render failed runs with Retry plus an 'Open provider settings' action (wire onOpenSettings, Q8-008) in both Space.tsx and DesignerChatDock.tsx. Drive the pill dot and the footer dot (Space.tsx:1357) from one status helper that includes the last run outcome / the 5 s reachability probe (assistant-service.ts:321-324), and show 'Unreachable' instead of 'Active' in AssistantPanel.tsx:621 when that probe fails.
- Verification (vf2c): **confirmed** — Reproduced on stack B, dark 1440x900: Assistant > New > oMLX (127.0.0.1:8000, nothing listening) > 'hello vf2c r2' > Enter. After ~1 s the bubble shows only the italic 'Provider failed while tools were enabled. Retrying this answer in chat-only mode.'; nothing more at 8 s. Task c0cce17d: running→completed in 15 ms, error null; its event stream holds TWO run.failed chunks with errorMessage 'Unable to connect. Is the computer able to access the url?' (tools run + chat-only retry), so the backend knows the cause and drops it. Frontend only handles run.failed for cloud 401 (Space.tsx:573 / DesignerChatDock.tsx:378). Indicators after the failure: pill dot #00bc7d title 'Tools + streaming OK' (raw emerald, dE 17.3), footer and row dots #6fbf7a, Settings › Assistant 'oMLX · DEFAULT · LOCAL · Active · Qwen…'. Light 1100x720 dock: another 'Retrying…' bubble, only a Send button. First-run (GET /chats routed to []): welcome shows 4 sample prompts with no provider/server hint. No console errors. Not an environment artefact: a stopped local model server is the normal failure for the oMLX/LM Studio providers. Distinct from Q10-016 (dock 'paused' mapping) and Q8-017 (POST failure placement). S2 kept (error swallowed, run reported as success). · evidence: [201-omlx-hello-1s](../evidence/shots/vf2c/dark/201-omlx-hello-1s.png), [202-omlx-hello-8s](../evidence/shots/vf2c/dark/202-omlx-hello-8s.png), [225-settings-assistant-omlx](../evidence/shots/vf2c/dark/225-settings-assistant-omlx.png), [236-1100-dock-omlx-refused](../evidence/shots/vf2c/light/236-1100-dock-omlx-refused.png), [237-first-run-assistant](../evidence/shots/vf2c/light/237-first-run-assistant.png), GET /api/modules/tasks/tasks/c0cce17d…/events → run.failed ×2 'Unable to connect…', task.completed (error null), probe 202-omlx-hello-8s.png: pill 1147,28 #00bc7d; footer 95,881 #6fbf7a

</details>


## T-323

**After 'Open in Assistant view', every chat-list refresh (run end, Stop, delete) snaps the Assistant space back to that chat**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate S
- Findings: F2C-003

**Summary.** Within 0.5 s of sending, the header reads 'QA-f2c-board chat' again. The new chat (with the 'jump test' message and its answer) is deselected in the list, so the reply lands in a chat you are not looking at. Pressing 'Stop generating' in a new chat does the same: the run is cancelled, then the view jumps. The jump repeats on every refresh (send, run end, cancel) until you leave the Assistant space through the rail.…

**Root cause.** `src/modules/assistant/frontend/Space.tsx:331` — refreshChats: `next = routeChat ?? current` — the route param chatId wins over the user's current selection on every refresh

**Proposed fix.** Don't re-select the 'opened' chat on list refresh (one-shot navigation param). — Detail: In assistant/frontend/Space.tsx apply routeChatId once: keep lastAppliedRouteChatRef, and in a useEffect on routeChatId select it only when it differs from the ref. In refreshChats (:327-344) drop the routeChat branch and keep `current` when it still exists, falling back to data[0]. Alternatively clear the chatId param via the navigation store after the first selection.

**Evidence.** [023-space-stop-hung](../evidence/shots/f2c/dark/023-space-stop-hung.png), [212-space-new-chat-running](../evidence/shots/vf2c/dark/212-space-new-chat-running.png)

<details><summary>F2C-003 — After 'Open in Assistant view', every chat-list refresh (run end, Stop, delete) snaps the Assistant space back to that chat (S2, confirmed)</summary>

- Area assistant.space · stack B · design 284f64fc-6c44-4b49-bc92-076a4135fbf7 · themes dark · viewports 1440x900
- Repro:
  1. Designer › QA-f2c-board › dock (Cmd+I) › 'Open in Assistant view' (opens 'QA-f2c-board chat')
  2. In the Assistant space click 'New', type 'jump test', press Enter
  3. Within 0.5 s read the thread header
  4. Also: in another chat press Stop / 'Stop generating' on a running answer
- Expected: The space stays on the chat you are using. 'Open in Assistant view' selects its chat once.
- Actual: Within 0.5 s of sending, the header reads 'QA-f2c-board chat' again. The new chat (with the 'jump test' message and its answer) is deselected in the list, so the reply lands in a chat you are not looking at. Pressing 'Stop generating' in a new chat does the same: the run is cancelled, then the view jumps. The jump repeats on every refresh (send, run end, cancel) until you leave the Assistant space through the rail. After re-entering through the rail it does not happen.
- Screenshots: [023-space-stop-hung](../evidence/shots/f2c/dark/023-space-stop-hung.png), [024-space-jump-after-run](../evidence/shots/f2c/dark/024-space-jump-after-run.png), [212-space-new-chat-running](../evidence/shots/vf2c/dark/212-space-new-chat-running.png), [213-space-jump-after-stop](../evidence/shots/vf2c/dark/213-space-jump-after-stop.png)
- Code: `src/modules/assistant/frontend/Space.tsx:331` — refreshChats: `next = routeChat ?? current` — the route param chatId wins over the user's current selection on every refresh
- Code: `src/modules/assistant/frontend/Space.tsx:221` — routeChatId = params?.chatId stays set for the whole visit
- Code: `src/modules/assistant/frontend/Space.tsx:681` — onTerminal → refreshChats() on every run end/cancel (also :855 delete, :881 bulk delete)
- Code: `src/modules/designer/frontend/Space.tsx:1571` — onOpenFull navigates with { chatId }, which stays in params for the whole visit
- Suggested fix: In assistant/frontend/Space.tsx apply routeChatId once: keep lastAppliedRouteChatRef, and in a useEffect on routeChatId select it only when it differs from the ref. In refreshChats (:327-344) drop the routeChat branch and keep `current` when it still exists, falling back to data[0]. Alternatively clear the chatId param via the navigation store after the first selection.
- Verification (vf2c): **confirmed** — Reproduced on stack B (dark): dock › 'Open in Assistant view' (header 'QA-f2c-board chat') › New (header 'New chat') › 'vf2c r2 jump test' › Enter (provider black-holed, run in flight): header still 'New chat'. Press 'Stop generating': 0.3 s later the header reads 'QA-f2c-board chat' and the new chat is deselected. Refinement: the jump is triggered by refreshChats (run end, cancel, delete), not by the send itself; with an unreachable provider the run ends in ~20 ms, so it looks like 'within 0.5 s of sending'. Code: refreshChats prefers routeChatId over the current selection on every call. S2 kept (every answer in another chat yanks the user away; workaround: leave via the rail). · evidence: [212-space-new-chat-running](../evidence/shots/vf2c/dark/212-space-new-chat-running.png), [213-space-jump-after-stop](../evidence/shots/vf2c/dark/213-space-jump-after-stop.png)

</details>


## T-324

**Assistant picks wrong provider/model: hard-coded default before load, first (paid) model on switch, New chat ignores Settings default**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A1+A2 · wave W3 · scope frontend · estimate S
- Findings: Q8-001, Q10-015, F2C-012, F1D-001

**Summary.** Pill + sidebar footer show 'aion-labs/aion-2.0' (alphabetically first of 460 OpenRouter models, a paid model). The new chat is persisted with model 'aion-labs/aion-2.0' (API: {providerConfigId:'openrouter', model:'aion-labs/aion-2.0'}). A user who just hits Send would be billed on an arbitrary paid model instead of the configured free default. | Also covers: Q10-015: Switching the chat provider to 'OpenPCB Cloud' keeps the previous provider's model ('big-…; F2C-012: 'New' chat reuses the last-viewed chat's provider/model and ignores Settings › Assistant…; F1D-001: Assistant shows hard-coded 'gpt-4o-mini · Cloud' (green dot) until settings load, and a s…

**Root cause.** `src/modules/assistant/frontend/Space.tsx:750` — effect: if model not in models → setModel(models[0].modelId); races with the provider-heal effect (:762) that sets fallback.defaultModel while `models` still holds the previous provider's list

**Proposed fix.** One provider/model resolver: New chat uses Settings default provider + its default model; switching provider picks that provider's default (never first-in-list paid); no hard-coded 'gpt-4o-mini · Cloud' before settings load; offline cloud shows warning dot. — Detail: Space.tsx:743-755: clear `models` (setModels([])) when providerId changes before fetching, and in the fallback effect prefer selectedProvider.defaultModel when it is in the list (models[0] only as a last resort). Apply the same to DesignerChatDock.tsx's copy of the effect. Never persist a model the user did not pick (createChat at :828 should send the provider default if the current model is not in the loaded list).

**Evidence.** [001-edge-unbound-v2-pill](../evidence/shots/vq8/dark/001-edge-unbound-v2-pill.png), [091-C1-assistant-model-pill](../evidence/shots/q10/dark/091-C1-assistant-model-pill.png), [070-assistant-space](../evidence/shots/vq10/dark/070-assistant-space.png)

<details><summary>Q8-001 — Model pill silently swaps the provider's default (free) model for the first model in the list (paid aion-labs/aion-2.0); new chats persist it (S2, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack A: OpenRouter provider enabled with defaultModel 'nvidia/nemotron-3.5-lightning:free' (GET /providers shows it); settings.defaultProviderId=openrouter
  2. Open Assistant (auto-selects chat 'edge unbound v2', stored on disabled provider OpenCode Zen / deepseek-v4-flash-free)
  3. Look at the model pill / sidebar footer
  4. Click New → GET /api/modules/assistant/chats
- Expected: When a chat's provider is healed to the default provider, the model falls back to that provider's defaultModel (nemotron free). New chats use the default model.
- Actual: Pill + sidebar footer show 'aion-labs/aion-2.0' (alphabetically first of 460 OpenRouter models, a paid model). The new chat is persisted with model 'aion-labs/aion-2.0' (API: {providerConfigId:'openrouter', model:'aion-labs/aion-2.0'}). A user who just hits Send would be billed on an arbitrary paid model instead of the configured free default.
- Screenshots: [001-edge-unbound-v2-pill](../evidence/shots/vq8/dark/001-edge-unbound-v2-pill.png), [002-new-chat-aion](../evidence/shots/vq8/dark/002-new-chat-aion.png), [001-assistant-initial](../evidence/shots/q8/dark/001-assistant-initial.png), [004-new-chat-empty](../evidence/shots/q8/dark/004-new-chat-empty.png), [003-model-pill-popover](../evidence/shots/q8/dark/003-model-pill-popover.png)
- Network: `GET /api/modules/assistant/chats → newest {title:'New chat', providerConfigId:'openrouter', model:'aion-labs/aion-2.0'}`; `GET /providers → openrouter.defaultModel='nvidia/nemotron-3.5-lightning:free' (present in the 460-entry models list)`
- Code: `src/modules/assistant/frontend/Space.tsx:750` — effect: if model not in models → setModel(models[0].modelId); races with the provider-heal effect (:762) that sets fallback.defaultModel while `models` still holds the previous provider's list
- Code: `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:163` — select value also falls back to models[0]
- Suggested fix: Space.tsx:743-755: clear `models` (setModels([])) when providerId changes before fetching, and in the fallback effect prefer selectedProvider.defaultModel when it is in the list (models[0] only as a last resort). Apply the same to DesignerChatDock.tsx's copy of the effect. Never persist a model the user did not pick (createChat at :828 should send the provider default if the current model is not in the loaded list).
- Verification (vq8): **confirmed** — Reproduced on A: selected 'edge unbound v2' (stored on disabled provider OpenCode Zen / deepseek-v4-flash-free) -> pill shows 'aion-labs/aion-2.0 Strict'; New -> API newest chat 8108e99e {providerConfigId:'openrouter', model:'aion-labs/aion-2.0'} although openrouter.defaultModel='nvidia/nemotron-3.5-lightning:free' is in the 460-entry list. Root cause verified: the disabled provider's /models still returns 55 models (first 'big-pickle'), so after the heal effect (Space.tsx:762) sets nemotron, the fallback effect (Space.tsx:750) sees a stale list without nemotron -> setModel('big-pickle'); when the OpenRouter list arrives 'big-pickle' is missing -> setModel(models[0]='aion-labs/aion-2.0'). Chat deleted afterwards. S2 kept: silently selects an arbitrary (non-free) model that is then persisted and billed. · evidence: [001-edge-unbound-v2-pill](../evidence/shots/vq8/dark/001-edge-unbound-v2-pill.png), [002-new-chat-aion](../evidence/shots/vq8/dark/002-new-chat-aion.png)

</details>

<details><summary>Q10-015 — Switching the chat provider to 'OpenPCB Cloud' keeps the previous provider's model ('big-pickle') and shows a healthy green dot while the cloud is unreachable (S3, confirmed)</summary>

- Area assistant.space · stack C1 · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack C1, signed in with a Pro session (simulated) → Assistant (the openpcb-cloud provider is auto-seeded: POST /providers/cloud/seed 200)
  2. New chat → model pill (currently 'big-pickle · OpenCode Zen') → Provider = 'OpenPCB Cloud'
  3. Look at the Model field, pill and sidebar footer; send a message
- Expected: Model resets to the cloud provider's model (or 'Managed by OpenPCB Cloud'); status dot reflects reachability.
- Actual: Model textbox still reads 'big-pickle', pill shows 'big-pickle STRICT' with a green dot, sidebar footer 'big-pickle · OpenPCB Cloud'. Sending then fails with 'Assistant paused before completing. OpenPCB Cloud workspace resolution failed (Unable to connect…)' (copy covered in Q10-004). The designer chat dock does it right: selecting 'OpenPCB Cloud' there switches the model to 'openpcb-fast' — so Space and dock behave differently.
- Screenshots: [091-C1-assistant-model-pill](../evidence/shots/q10/dark/091-C1-assistant-model-pill.png), [092-C1-assistant-openpcb-cloud-provider](../evidence/shots/q10/dark/092-C1-assistant-openpcb-cloud-provider.png), [094-C1-copilot-send-13s](../evidence/shots/q10/dark/094-C1-copilot-send-13s.png), [096-C1-dock-openpcb-cloud-offline](../evidence/shots/q10/dark/096-C1-dock-openpcb-cloud-offline.png)
- Network: `POST /api/modules/assistant/providers/cloud/seed → 200`; `GET /api/modules/assistant/providers/openpcb-cloud/models → 200 (body not inspected per protocol)`
- Code: `src/modules/assistant/frontend/Space.tsx:751` — model reset only when models.length > 0
- Code: `src/modules/assistant/frontend/Space.tsx:776` — refreshChatModels sends headers() = content-type only, no x-cloud-bearer/x-cloud-api-url
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:561` — same refresh without cloud creds
- Code: `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:103` — auto-refresh when opened with empty model list
- Code: `src/modules/assistant/backend/assistant-service.ts:719` — developer-facing 400 message
- Suggested fix: On provider change reset model to the provider's defaultModel (Space.tsx onProviderChange → setProviderId + setModel(provider.defaultModel), as refreshConfig does in the dock). Send cloud credentials (x-cloud-bearer, x-cloud-api-url via cloud/request-headers.ts) on /providers/:id/models/refresh from both Space.tsx and DesignerChatDock.tsx. Replace the backend 400 copy with 'Sign in to OpenPCB Cloud to use this provider.' Drive the pill status dot from cloud reachability (Q10-006).
- Verification (vq10): **confirmed** — Reproduced a variant: a New chat in the Assistant space came up with Provider 'OpenPCB Cloud' but Model 'Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit' (a stale oMLX model id), a green-dot pill, and the sidebar footer '… · OpenPCB Cloud'. The dock picks 'openpcb-fast'. Root cause refined: the Space only resets the model when the provider's cached model list is non-empty (Space.tsx:750-755); offline, /providers/openpcb-cloud/models is empty. When the pill opens, ModelSelectorPill auto-refreshes (ModelSelectorPill.tsx:103). Space.tsx:776 and DesignerChatDock.tsx:561 POST /models/refresh with only content-type and no cloud credentials, so it always returns 400 and the signed-in Pro user sees a red banner 'OpenPCB Cloud requires a signed-in session (x-cloud-bearer / x-cloud-api-url).' (assistant-service.ts:719). Ships (cloud.copilot 'all'). · evidence: [070-assistant-space](../evidence/shots/vq10/dark/070-assistant-space.png), [072-model-pill-open](../evidence/shots/vq10/dark/072-model-pill-open.png), [080-dock-paused-task](../evidence/shots/vq10/dark/080-dock-paused-task.png), network: POST /api/modules/assistant/providers/openpcb-cloud/models/refresh → 400; GET /providers/openpcb-cloud/models → 200 (body not inspected)

</details>

<details><summary>F2C-012 — 'New' chat reuses the last-viewed chat's provider/model and ignores Settings › Assistant › Default provider (S4, confirmed)</summary>

- Area assistant.space · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Settings › Assistant: Default provider = oMLX
  2. Assistant space: open chat 'edge unbound v2' (OpenCode Zen)
  3. Click 'New'
- Expected: A new chat starts on the configured default provider/model (oMLX / Qwen…), or the pill clearly says it is carrying over the previous chat's model.
- Actual: The new chat's pill reads 'big-pickle · Strict' (OpenCode Zen, and not even that chat's saved model 'deepseek-v4-flash-free', see Q8-001), and the first send creates the chat on that provider. The Settings default applies only when no chat was selected. The same happens after a reload: the auto-selected most-recent chat decides the provider of the next New chat.
- Screenshots: [002-assistant-new-chat](../evidence/shots/f2c/dark/002-assistant-new-chat.png), [203-new-after-opencode-chat](../evidence/shots/vf2c/dark/203-new-after-opencode-chat.png)
- Code: `src/modules/assistant/frontend/Space.tsx:828` — createChat posts `providerId \|\| settings.defaultProviderId`; providerId still holds the previously selected chat's provider
- Code: `src/modules/assistant/frontend/Space.tsx:734` — selecting a chat sets providerId; 'New' never resets it
- Code: `src/modules/assistant/frontend/Space.tsx:1389` — 'New' calls createChat() directly; providerId/model are never reset first
- Suggested fix: Space.tsx: in the 'New' handler (:1389, also :1161) reset providerId to settings.defaultProviderId and model to that provider's defaultModel before createChat(), or make createChat take explicit {providerId, model} for the New case. If carrying the last model over is the intended behaviour, relabel the Settings field (e.g. 'Provider for first chat') instead.
- Verification (vf2c): **confirmed** — Reproduced on stack B (dark): Settings defaultProviderId = omlx. Assistant › 'edge unbound v2' (OpenCode Zen) › pill 'big-pickle Strict' › New → pill still 'big-pickle Strict'; API: new chat dbfa681c {providerConfigId 5d25100b… (OpenCode Zen), model 'big-pickle'} (deleted afterwards). The wrong-model half ('big-pickle' instead of the chat's saved 'deepseek-v4-flash-free') is Q8-001's stale-list root; the provider inheritance is this finding. Related to F1D-001 (same createChat line, placeholder before settings load) but a different trigger. Reusing the last model is a product choice some chat apps make, hence S4 / design-decision. · evidence: [203-new-after-opencode-chat](../evidence/shots/vf2c/dark/203-new-after-opencode-chat.png), GET /api/modules/assistant/chats → newest dbfa681c providerConfigId=5d25100b… (OpenCode Zen), model big-pickle; settings.defaultProviderId=omlx

</details>

<details><summary>F1D-001 — Assistant shows hard-coded 'gpt-4o-mini · Cloud' (green dot) until settings load, and a send in that window creates the chat on 'openai' (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack A (configured default provider = OpenRouter / nvidia/nemotron-3.5-lightning:free)
  2. In-page latency shim: delay every /api fetch (window.fetch wrapper, 2.5–8 s) to simulate a slow backend
  3. Navigate Home → Assistant (in-memory, no reload)
  4. Observe the header model pill and the sidebar footer during load
  5. Before the chat list/settings arrive, type in the composer and press Enter (the shim blocks every non-GET, so nothing reached the backend)
- Expected: Until settings/providers are loaded, the model pill shows a neutral loading state and the composer and 'New' are disabled (or submit waits). A new chat always uses the configured default provider and model.
- Actual: The pill reads 'gpt-4o-mini STRICT' and the footer reads 'gpt-4o-mini · Cloud' with a green 'healthy' dot. These are the useState defaults, not the user's configuration. The composer and 'New' stay enabled. Pressing Enter issued POST /api/modules/assistant/chats with body {"providerConfigId":"openai","model":"gpt-4o-mini","promptPresetId":"strict-grounded"}, so the chat would be persisted on an unconfigured/disabled provider (or a paid OpenAI model if a key exists). Every Assistant mount also fires a needless GET /providers/openai/models before settings arrive.
- Screenshots: [004-lat-assistant-first](../evidence/shots/f1d/dark/004-lat-assistant-first.png), [019-lat-assistant-send-during-load](../evidence/shots/f1d/dark/019-lat-assistant-send-during-load.png), [103-lat-assistant-first](../evidence/shots/f1d/light/103-lat-assistant-first.png), [002-latency-assistant-placeholder](../evidence/shots/vf1d/dark/002-latency-assistant-placeholder.png), [003-latency-send-during-load](../evidence/shots/vf1d/dark/003-latency-send-during-load.png), [101-latency-assistant-placeholder](../evidence/shots/vf1d/light/101-latency-assistant-placeholder.png), [001-settings500-assistant-placeholder](../evidence/shots/vf1d/dark/001-settings500-assistant-placeholder.png)
- Network: `POST /api/modules/assistant/chats body {providerConfigId:'openai', model:'gpt-4o-mini'} (captured+blocked in-page)`; `GET /api/modules/assistant/providers/openai/models on every mount (before /settings resolves)`
- Code: `src/modules/assistant/frontend/Space.tsx:184` — useState('openai') / useState('gpt-4o-mini') placeholders render as the real config until refreshConfig resolves
- Code: `src/modules/assistant/frontend/Space.tsx:834` — createChat posts providerId \|\| settings?.defaultProviderId; providerId is the 'openai' placeholder, so the fallback never applies
- Code: `src/modules/assistant/frontend/Space.tsx:954` — submit also sends providerConfigId: providerId / model placeholder
- Code: `src/modules/assistant/frontend/Space.tsx:744` — models effect fires GET /providers/openai/models for the placeholder id (cache read only, harmless)
- Code: `src/modules/assistant/frontend/Space.tsx:1357` — footer dot is unconditionally bg-status-success; label falls back to 'Cloud' when no provider is loaded
- Code: `src/modules/assistant/backend/assistant-service.ts:139` — createChat only requireProvider() (exists), so a chat on the seeded built-in 'openai' is persisted; submitMessage then requireUsableProvider() fails 'Provider disabled'/'API key required' (or runs on OpenAI if that provider is enabled)
- Suggested fix: Space.tsx:184-185: initialise providerId/model to null (or '') and add configLoaded state set at the end of refreshConfig (:422-443). While !configLoaded: render the ModelSelectorPill and footer (:1355-1367) as a neutral skeleton, disable composer submit, the empty-state prompt chips and 'New' (or queue the submit until loaded). Guard the models effect (:744) on configLoaded. In createChat (:834) and submit (:954) use settings.defaultProviderId when providerId is unset. Drive the footer dot from provider health instead of hard-coded bg-status-success.
- Verification (vf1d): **confirmed** — Reproduced with the f1d fetch shim (6 s latency, writes blocked): pill 'gpt-4o-mini STRICT', footer 'gpt-4o-mini · Cloud' with green dot, 'No chats yet.'; composer enabled; a synthetic Enter 1.5 s after mount produced POST /assistant/chats {providerConfigId:'openai',model:'gpt-4o-mini'} (blocked). Code confirms (Space.tsx:184,834,954). Severity lowered S2->S3: on the real loopback stack the placeholder is on screen for one painted frame (MutationObserver: 22 ms, rAF saw 1 frame; /settings answers in ~1 ms), so a human cannot send inside the window; with /settings forced to 500 the auto-selected existing chat's provider (OpenRouter) was used, so the placeholder only persists when settings fail AND no chat is selected. Real defect (latent race + unconditional green 'healthy' dot), low exposure. · evidence: [002-latency-assistant-placeholder](../evidence/shots/vf1d/dark/002-latency-assistant-placeholder.png), [003-latency-send-during-load](../evidence/shots/vf1d/dark/003-latency-send-during-load.png), [101-latency-assistant-placeholder](../evidence/shots/vf1d/light/101-latency-assistant-placeholder.png), [001-settings500-assistant-placeholder](../evidence/shots/vf1d/dark/001-settings500-assistant-placeholder.png), blocked POST /api/modules/assistant/chats body {providerConfigId:'openai',model:'gpt-4o-mini',promptPresetId:'strict-grounded'}, no-latency watcher: 'gpt-4o-mini' present 1154->1176 ms (22 ms, 1 rAF frame)

</details>


## T-325

**Every tool call renders twice — a 'requested' card stuck on 'running…' spinner forever plus the real result; tool count doubled**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · decision DEC-A · owner A3 · wave W3 · scope frontend · estimate S
- Findings: Q8-002

**Summary.** Two cards: 'Read design running…' with an indeterminate progress bar + spinner that never resolves, and 'Read design designId=… 3 src 16 ms ✓'. Summary says '2 tools'. Persists after reload. Backend stores two events for the same toolCallId (status 'requested' and 'succeeded') and the UI renders both.

**Root cause.** `src/modules/assistant/backend/run-service.ts:1065` — run.tool.requested upsert omits id of the row already seeded by run.message.completed (:1049) -> duplicate row

**Proposed fix.** Collapse tool events by toolCallId (latest status wins) before render/count; backend single-row fix = decision. — Detail: run-service.ts:1065: pass id: toolEventsByCall.get(event.data.toolCallId)?.id (or skip the insert when callSummaries already has the call) so one row per toolCallId is kept; optionally make upsertToolEvent look up by (chat_id, tool_call_id). Frontend belt-and-braces: collapse events by toolCallId (latest status wins) in mergeToolEvents/MessageCard before rendering and counting. Existing duplicated rows need a one-off cleanup or the frontend collapse.

**Evidence.** [003-duplicate-running-toolcard](../evidence/shots/vq8/dark/003-duplicate-running-toolcard.png)

<details><summary>Q8-002 — Every tool call renders twice — a 'requested' card stuck on 'running…' spinner forever plus the real result; tool count doubled (S2, confirmed)</summary>

- Area assistant.space · stack A · design a557d3b5 · themes dark, light · viewports 1440x900
- Repro:
  1. Assistant → New chat → '@S3 LLM Smoke — 5 LED (DeepSeek V4 Flash) List the components in this design' → Enter
  2. Wait for the run to finish
  3. Expand '2 tools · 3 src · 16ms'
  4. Reload the page, reopen the chat, expand again
- Expected: One 'Read design' card, succeeded; summary '1 tool'.
- Actual: Two cards: 'Read design running…' with an indeterminate progress bar + spinner that never resolves, and 'Read design designId=… 3 src 16 ms ✓'. Summary says '2 tools'. Persists after reload. Backend stores two events for the same toolCallId (status 'requested' and 'succeeded') and the UI renders both.
- Screenshots: [003-duplicate-running-toolcard](../evidence/shots/vq8/dark/003-duplicate-running-toolcard.png), [011-prompt1-tools-expanded](../evidence/shots/q8/dark/011-prompt1-tools-expanded.png), [012-stale-running-toolcard-after-reload](../evidence/shots/q8/dark/012-stale-running-toolcard-after-reload.png)
- Network: `GET /chats/b5bf7167…/tool-events → [{toolName:designer_get_design_summary,status:'requested',toolCallId:call-3a1c…},{…status:'succeeded',toolCallId:call-3a1c…}]`
- Code: `src/modules/assistant/backend/run-service.ts:1065` — run.tool.requested upsert omits id of the row already seeded by run.message.completed (:1049) -> duplicate row
- Code: `src/modules/assistant/backend/conversation-store.ts:568` — upsertToolEvent only updates when input.id is given; no toolCallId uniqueness
- Code: `src/modules/assistant/frontend/Space.tsx:299` — mergeToolEvents keys by event.id, not toolCallId
- Code: `src/modules/assistant/frontend/components/MessageCard.tsx:336` — visibleToolEvents not deduped by toolCallId
- Suggested fix: run-service.ts:1065: pass id: toolEventsByCall.get(event.data.toolCallId)?.id (or skip the insert when callSummaries already has the call) so one row per toolCallId is kept; optionally make upsertToolEvent look up by (chat_id, tool_call_id). Frontend belt-and-braces: collapse events by toolCallId (latest status wins) in mergeToolEvents/MessageCard before rendering and counting. Existing duplicated rows need a one-off cleanup or the frontend collapse.
- Verification (vq8): **confirmed** — Reproduced: QA-q8-main -> expand '2 tools · 3 src · 16ms' -> 'Read design running…' (spinner + progress bar) above 'Read design … 3 src 16 ms ✓'. API: every chat on OpenRouter/OpenCode Zen has exactly 2 rows per toolCallId (requested + succeeded) - 13 of 15 chats, e.g. f6a5ed1d 28 events / 14 calls. Root cause is backend, not only rendering: run-service.ts:1064-1073 ('run.tool.requested' branch) calls upsertToolEvent WITHOUT id: toolEventsByCall.get(toolCallId)?.id, so when 'run.message.completed' (F8 seeding, :1039-1059) already inserted the 'requested' row, a second row is inserted and later status updates hit only the new one; the first row stays 'requested' forever. S2 kept (every tool history shows a never-ending 'running' item and doubled counts). · evidence: [003-duplicate-running-toolcard](../evidence/shots/vq8/dark/003-duplicate-running-toolcard.png)

</details>


## T-326

**Settings 'Tool policy: Auto read · confirm writes' is ignored — assistant write proposals auto-apply without confirmation**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **decide** · decision DEC-A · owner C2 · wave W2 · scope decision · estimate S
- Findings: Q8-003

**Summary.** Proposal 'Add 10kΩ resistor R99' is shown APPLIED immediately, its Apply/Reject buttons disabled; design a557d3b5 went rev 45 → 47 and gained a part with no user action. The backend never reads toolExecutionPolicy: auto-apply is hard-coded for every non-destructive proposal. The three policy options in Settings are therefore a misleading control.

**Root cause.** `src/modules/assistant/backend/assistant-service.ts:118` — isSessionAutoApplyAllowed: riskLevel !== 'destructive' || … — policy not consulted

**Proposed fix.** Replace 'Tool policy' select with accurate copy ('Edits apply immediately (undoable); deletions ask first') — or wire policy in backend. — Detail: Either wire settings.toolExecutionPolicy into isSessionAutoApplyAllowed (assistant-service.ts:118: confirm_all_writes -> only writeSessionPolicy.isAllowed; auto_readonly_confirm_writes -> same; auto_all -> true) or remove the 'Tool policy' select (AssistantPanel.tsx:393-410) and replace it with static copy 'Non-destructive edits apply immediately (undoable); deletions ask first'.

**Evidence.** [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png)

<details><summary>Q8-003 — Settings 'Tool policy: Auto read · confirm writes' is ignored — assistant write proposals auto-apply without confirmation (S2, confirmed)</summary>

- Area assistant.space · stack A · design a557d3b5 · themes dark · viewports 1440x900
- Repro:
  1. Stack A: Settings → Assistant → Tool policy = 'Auto read · confirm writes' (GET /settings → toolExecutionPolicy:'auto_readonly_confirm_writes')
  2. Assistant → chat referencing @S3 LLM Smoke — 5 LED → 'Add a 10k resistor R99 to the schematic'
  3. Watch the proposal card and the design revision
- Expected: With 'confirm writes' (or 'Confirm all writes') the proposal stays PENDING until the user clicks Apply.
- Actual: Proposal 'Add 10kΩ resistor R99' is shown APPLIED immediately, its Apply/Reject buttons disabled; design a557d3b5 went rev 45 → 47 and gained a part with no user action. The backend never reads toolExecutionPolicy: auto-apply is hard-coded for every non-destructive proposal. The three policy options in Settings are therefore a misleading control.
- Screenshots: [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png), [013-prompt2-proposal](../evidence/shots/q8/dark/013-prompt2-proposal.png)
- Network: `GET /api/modules/assistant/settings → toolExecutionPolicy:'auto_readonly_confirm_writes'`; `GET /api/modules/designer/designs/a557d3b5… → revision 47, parts 11 (was 45 / 10)`
- Code: `src/modules/assistant/backend/assistant-service.ts:118` — isSessionAutoApplyAllowed: riskLevel !== 'destructive' \|\| … — policy not consulted
- Code: `src/modules/assistant/backend/settings-store.ts:112` — toolExecutionPolicy only persisted; no reader in run-service/tools
- Code: `src/core/frontend/src/settings/panels/AssistantPanel.tsx:405` — 'Auto read · confirm writes' / 'Confirm all writes' / 'Auto all tools' options
- Suggested fix: Either wire settings.toolExecutionPolicy into isSessionAutoApplyAllowed (assistant-service.ts:118: confirm_all_writes -> only writeSessionPolicy.isAllowed; auto_readonly_confirm_writes -> same; auto_all -> true) or remove the 'Tool policy' select (AssistantPanel.tsx:393-410) and replace it with static copy 'Non-destructive edits apply immediately (undoable); deletions ask first'.
- Verification (vq8): **confirmed** — Code-verified and data-verified. GET /settings -> toolExecutionPolicy 'auto_readonly_confirm_writes'; QA-q8-main write-proposal 959b089f 'Add 10kΩ resistor R99' riskLevel medium went to status 'applied' 14 ms after creation (createdAt .635Z, updatedAt .649Z) with no user action. grep: toolExecutionPolicy is only read/written in settings-store.ts:32/112 and AssistantPanel.tsx:396-401 - never consulted by run-service or tools. assistant-service.ts:118 hard-codes isSessionAutoApplyAllowed = riskLevel !== 'destructive' || writeSessionPolicy. Auto-applying non-destructive edits is an intentional product rule (code comment, tool description 'Non-destructive, so it auto-applies', CLAUDE.md MCP policy), so the defect is the Settings control that promises a policy that does nothing. Not re-sent to the LLM (would mutate a557d3b5 again). S2 kept: misleading control whose default label contradicts actual behaviour. · evidence: [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png)

</details>


## T-327

**Assistant reports 'R99 has been added' but the part got reference R6 — placement tool can't set a reference and its result omits the assigned one**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-A · owner A1 · wave W3 · scope backend · estimate S
- Findings: Q8-004

**Summary.** Reply: 'The 10kΩ resistor (R99) has been added…'; card title 'Add 10kΩ resistor R99' APPLIED. Design actually contains reference R6, value 10k. designer_propose_schematic_edits parts[] has no `reference` field and its resultJson contains no assigned reference, so the model cannot know and states a wrong designator.

**Root cause.** `src/modules/assistant/backend/tools/designer-tools.ts:1813` — parts item schema: componentId/value/positionNm/rotationDeg/mirrored/properties - no reference

**Proposed fix.** Backend tool: accept/return assigned reference so replies are truthful. — Detail: Accept an optional `reference` per part in designer_propose_schematic_edits (apply via updatePartAfterCreate), and return the applied references (e.g. placed:[{ref:'R6',partId}]) in the tool result so the model reports real designators.

**Evidence.** [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png)

<details><summary>Q8-004 — Assistant reports 'R99 has been added' but the part got reference R6 — placement tool can't set a reference and its result omits the assigned one (S2, confirmed)</summary>

- Area assistant.space · stack A · design a557d3b5 · themes dark · viewports 1440x900
- Repro:
  1. Assistant chat linked by @mention to a557d3b5
  2. Send 'Add a 10k resistor R99 to the schematic'
  3. Read the reply and the proposal card, then inspect the design (GET /designs/a557d3b5… or open Designer)
- Expected: A part with reference R99 and value 10k, or an honest reply that the reference was auto-assigned (e.g. 'placed as R6').
- Actual: Reply: 'The 10kΩ resistor (R99) has been added…'; card title 'Add 10kΩ resistor R99' APPLIED. Design actually contains reference R6, value 10k. designer_propose_schematic_edits parts[] has no `reference` field and its resultJson contains no assigned reference, so the model cannot know and states a wrong designator.
- Screenshots: [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png), [013-prompt2-proposal](../evidence/shots/q8/dark/013-prompt2-proposal.png)
- Network: `tool-events: designer_propose_schematic_edits args parts:[{componentId:'openpcb.core.passive.resistor',value:'10k'}] (no reference); result has no 'R6'/'reference'`; `design entity a228a719… reference:'R6' value:'10k'`
- Code: `src/modules/assistant/backend/tools/designer-tools.ts:1813` — parts item schema: componentId/value/positionNm/rotationDeg/mirrored/properties - no reference
- Code: `src/modules/assistant/backend/tools/designer-tools.ts:1799` — designer_propose_schematic_edits result/operations omit the assigned reference
- Suggested fix: Accept an optional `reference` per part in designer_propose_schematic_edits (apply via updatePartAfterCreate), and return the applied references (e.g. placed:[{ref:'R6',partId}]) in the tool result so the model reports real designators.
- Verification (vq8): **confirmed** — Data-verified in QA-q8-main: tool-event args parts:[{componentId:'openpcb.core.passive.resistor', value:'10k', properties:{color:…}}] (no reference); resultJson (1729 chars) has no 'R6'/'reference', its only operation is 'Place Resistor at 110000000, 0 nm.'; the visible reply says 'The 10kΩ resistor (R99) has been added'; the later deletion proposals the model built from real design data are titled 'Delete resistor R6'. designer-tools.ts:1813-1830 parts item schema has no reference property. Not re-run to avoid another design mutation. Not purely LLM quality: the tool cannot honour the requested designator and does not report the assigned one. S2 kept (APPLIED card + reply state a designator that does not exist). · evidence: [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png)

</details>


## T-328

**'Configure providers' button in the model pill does nothing (onOpenSettings never wired) in Assistant space and dock**

- Severity **S2** · category bug · status confirmed · themes light
- Recommendation **fix-now** · owner A2 · wave W3 · scope frontend · estimate XS
- Findings: Q8-008

**Summary.** Popover closes and nothing else happens — the user stays on the Assistant chat (verified on stack B). Code: ModelSelectorPill calls onOpenSettings?.() but neither Space.tsx nor DesignerChatDock.tsx passes onOpenSettings, so the same dead button exists in the dock.

**Root cause.** `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:223` — onOpenSettings?.()

**Proposed fix.** Wire 'Configure providers' to Settings › Assistant (Space + dock). — Detail: Pass onOpenSettings={() => openSettings('assistant')} (the same navigation used by the rail gear / Ctrl+,) from both hosts; hide the button when absent.

**Evidence.** [006-stackB-configure-providers-noop](../evidence/shots/vq8/light/006-stackB-configure-providers-noop.png)

<details><summary>Q8-008 — 'Configure providers' button in the model pill does nothing (onOpenSettings never wired) in Assistant space and dock (S2, confirmed)</summary>

- Area assistant.space · stack B · design None · themes light · viewports 1440x900
- Repro:
  1. Stack B (no LLM use; stack A excluded by charter): Assistant → model pill 'big-pickle STRICT' → 'Configure providers'
- Expected: Navigates to Settings → Assistant providers.
- Actual: Popover closes and nothing else happens — the user stays on the Assistant chat (verified on stack B). Code: ModelSelectorPill calls onOpenSettings?.() but neither Space.tsx nor DesignerChatDock.tsx passes onOpenSettings, so the same dead button exists in the dock.
- Screenshots: [006-stackB-configure-providers-noop](../evidence/shots/vq8/light/006-stackB-configure-providers-noop.png), [014-stackB-pill-before-configure](../evidence/shots/q8/light/014-stackB-pill-before-configure.png), [015-stackB-after-configure-providers](../evidence/shots/q8/light/015-stackB-after-configure-providers.png), [003-model-pill-popover](../evidence/shots/q8/dark/003-model-pill-popover.png)
- Code: `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:223` — onOpenSettings?.()
- Code: `src/modules/assistant/frontend/Space.tsx:1466` — no onOpenSettings prop
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:855` — no onOpenSettings prop
- Suggested fix: Pass onOpenSettings={() => openSettings('assistant')} (the same navigation used by the rail gear / Ctrl+,) from both hosts; hide the button when absent.
- Verification (vq8): **confirmed** — Reproduced on stack B (charter: not on A): Assistant -> pill 'big-pickle Strict' -> Configure providers -> popover closes, still on Assistant (composer present, no Settings heading). grep: onOpenSettings is declared in ModelSelectorPill.tsx:57/78/223 and passed by neither Space.tsx:1468 nor DesignerChatDock.tsx:855 -> dead in both hosts. S2 kept (dead button whose label promises navigation; workaround via rail Settings). · evidence: [006-stackB-configure-providers-noop](../evidence/shots/vq8/light/006-stackB-configure-providers-noop.png)

</details>


## T-329

**Assistant space uses native window.prompt (rename) and window.confirm (row/header/bulk delete)**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate S
- Findings: Q8-013, Q8-014 · known ref K05,K06
- Depends on: ['T-014']

**Summary.** Native prompt 'Rename chat' appears (dialog-spy: prompt=1, log 'prompt: Rename chat'). Native prompt is unsupported/blocked in Electron (window.prompt returns null) so row-rename silently does nothing in the desktop app. Inconsistent with the header title inline editor, which works. | Also covers: Q8-014: Assistant space chat delete (row menu, header menu, bulk 'Delete selected') all use nativ…

**Root cause.** `src/modules/assistant/frontend/Space.tsx:893` — window.prompt('Rename chat', …)

**Proposed fix.** Row rename inline (like header); deletes via kit confirmDialog. — Detail: Reuse the header inline editor: setSelectedChatId(chatId); beginRename(); or render an inline <input> in the row.

**Evidence.** [006-row-actions-menu](../evidence/shots/vq8/dark/006-row-actions-menu.png), [008-multiselect-hidden](../evidence/shots/vq8/dark/008-multiselect-hidden.png)

<details><summary>Q8-013 — Assistant space row 'Rename chat' uses native window.prompt (header rename is inline)  (S2, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Assistant → hover chat row 'QA-q8-main' → '…' (Chat actions for QA-q8-main) → 'Rename chat'
- Expected: Inline rename in the row (as the header title already does) or a kit dialog.
- Actual: Native prompt 'Rename chat' appears (dialog-spy: prompt=1, log 'prompt: Rename chat'). Native prompt is unsupported/blocked in Electron (window.prompt returns null) so row-rename silently does nothing in the desktop app. Inconsistent with the header title inline editor, which works.
- Screenshots: [006-row-actions-menu](../evidence/shots/vq8/dark/006-row-actions-menu.png), [025-row-actions-menu](../evidence/shots/q8/dark/025-row-actions-menu.png), [024-header-rename-inline](../evidence/shots/q8/dark/024-header-rename-inline.png)
- Console: `__qaDialogCalls.log: 'prompt: Rename chat'`; `__qaDialogCalls: {prompt:1, log:['prompt: Rename chat']}`
- Code: `src/modules/assistant/frontend/Space.tsx:893` — window.prompt('Rename chat', …)
- Suggested fix: Reuse the header inline editor: setSelectedChatId(chatId); beginRename(); or render an inline <input> in the row.
- Verification (vq8): **confirmed** — Reproduced: row '…' -> 'Rename chat' on QA-q8-retry -> native prompt 'Rename chat' (spy prompt=1), dismissed. Space.tsx:893 window.prompt; header title rename is inline. Matches K05. S2 per rubric (native prompt, returns null in Electron). · evidence: [006-row-actions-menu](../evidence/shots/vq8/dark/006-row-actions-menu.png)

</details>

<details><summary>Q8-014 — Assistant space chat delete (row menu, header menu, bulk 'Delete selected') all use native window.confirm (S2, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Row '…' → 'Delete chat' on QA-q8-del1
  2. Header '…' Chat actions → Delete on QA-q8-del3
  3. Check two chats → 'Delete selected'
- Expected: Kit confirm dialog (danger variant) with chat title, focus on Cancel, Esc cancels.
- Actual: Native confirm dialogs: 'Delete "QA-q8-del1"?', 'Delete "QA-q8-del3"?', 'Delete 2 selected chats?'. In Electron native confirm is synchronous/unstyled (and blocked in some configs), inconsistent with the redesigned Home delete modal.
- Screenshots: [008-multiselect-hidden](../evidence/shots/vq8/dark/008-multiselect-hidden.png), [026-header-chat-actions](../evidence/shots/q8/dark/026-header-chat-actions.png), [029-multiselect-hidden-selection](../evidence/shots/q8/dark/029-multiselect-hidden-selection.png)
- Console: `__qaDialogCalls.log: 'confirm: Delete 2 selected chats?', 'confirm: Delete "QA-q8-retry"?'`; `__qaDialogCalls log: confirm: Delete "QA-q8-del1"? / confirm: Delete "QA-q8-del3"? / confirm: Delete 2 selected chats?`
- Code: `src/modules/assistant/frontend/Space.tsx:852` — deleteChat window.confirm
- Code: `src/modules/assistant/frontend/Space.tsx:869` — deleteSelectedChats window.confirm
- Suggested fix: Replace with the shared ConfirmDialog (same as Home delete) — async, returns boolean.
- Verification (vq8): **confirmed** — Reproduced: row 'Delete chat' on QA-q8-retry -> native confirm 'Delete "QA-q8-retry"?' (dismissed); bulk 'Delete selected' -> native confirm 'Delete 2 selected chats?'. Header Delete calls the same deleteChat (Space.tsx:852). Matches K06. S2 per rubric. · evidence: [008-multiselect-hidden](../evidence/shots/vq8/dark/008-multiselect-hidden.png)

</details>


## T-330

**Send failures are invisible: the error alert renders at the top of the thread (≈3800px above the viewport) and says only 'Internal error'**

- Severity **S2** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate S
- Findings: Q8-017
- Depends on: ['T-006']

**Summary.** Nothing visible changes: Send spinner stops, text stays in the composer. The role=alert box 'Internal error' is inserted above the first message (getBoundingClientRect top = -3811px) — only found by scrolling to the very top. No retry affordance; message is not shown as failed. Offline send shows the raw browser string 'Failed to fetch', also off-screen.

**Root cause.** `src/modules/assistant/frontend/Space.tsx:1609` — error alert placed inside the scroll container before messages

**Proposed fix.** Send errors inline at the composer/bottom of thread with problem.ts copy + Retry. — Detail: Render the error in the floating composer area (above ChatComposer) or as a sticky banner; map 5xx/network errors to friendly copy with a Retry button that resubmits the kept input.

**Evidence.** [013-send-500-nothing-visible](../evidence/shots/vq8/dark/013-send-500-nothing-visible.png)

<details><summary>Q8-017 — Send failures are invisible: the error alert renders at the top of the thread (≈3800px above the viewport) and says only 'Internal error' (S2, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Assistant → chat QA-q8-main (long thread, scrolled to bottom)
  2. playwright route '**/api/modules/assistant/chats/*/messages*' → 500 problem+json
  3. Type 'QA error injection test' → Enter
  4. Unroute afterwards
  5. Also: network-state-set offline → type 'offline send test' → Enter → same invisible alert, text 'Failed to fetch' (top=-4434px); network-state-set online → Enter resends fine (recovery OK, alert cleared)
- Expected: Inline error next to the composer / failed user bubble with 'Retry', human copy ('Couldn't send your message — the assistant service returned an error').
- Actual: Nothing visible changes: Send spinner stops, text stays in the composer. The role=alert box 'Internal error' is inserted above the first message (getBoundingClientRect top = -3811px) — only found by scrolling to the very top. No retry affordance; message is not shown as failed. Offline send shows the raw browser string 'Failed to fetch', also off-screen.
- Screenshots: [013-send-500-nothing-visible](../evidence/shots/vq8/dark/013-send-500-nothing-visible.png), [033-send-500](../evidence/shots/q8/dark/033-send-500.png), [034-send-500-alert-scrolled-top](../evidence/shots/q8/dark/034-send-500-alert-scrolled-top.png), [038-offline-send](../evidence/shots/q8/dark/038-offline-send.png)
- Network: `POST /api/modules/assistant/chats/b5bf7167…/messages -> 500 (injected, then unrouted)`; `offline -> net::ERR_INTERNET_DISCONNECTED`; `POST /api/modules/assistant/chats/b5bf7167…/messages → 500 (injected)`
- Code: `src/modules/assistant/frontend/Space.tsx:1609` — error alert placed inside the scroll container before messages
- Code: `src/modules/assistant/frontend/Space.tsx:140` — api() surfaces body.title ('Internal error') / 'HTTP 500' verbatim
- Suggested fix: Render the error in the floating composer area (above ChatComposer) or as a sticky banner; map 5xx/network errors to friendly copy with a Retry button that resubmits the kept input.
- Verification (vq8): **confirmed** — Reproduced on QA-q8-main: route POST **/chats/*/messages -> 500 problem+json, Enter -> nothing visible, text stays in composer; the only feedback is role=alert 'Internal error' at getBoundingClientRect().top = -6565px (inside the scroll container above the first message, Space.tsx:1607-1622). Offline -> same alert, text 'Failed to fetch', same off-screen position. Unrouted/online afterwards. S2 kept (send failures effectively invisible, raw error strings). · evidence: [013-send-500-nothing-visible](../evidence/shots/vq8/dark/013-send-500-nothing-visible.png)

</details>


## T-331

**'Retry' on a stopped/cancelled run does nothing (dead button)**

- Severity **S2** · category bug · status confirmed · themes light
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate XS
- Findings: Q8-031

**Summary.** Nothing happens: no Working… state, no POST /chats/3489e162…/messages (backend log count stays 1), no error. After the run terminates, onTerminal → refreshChats → the selected-chat effect calls restoreActiveTask, which overwrites the run with userMessageContent: '' — and retryRunAsNew returns early on an empty prompt.

**Root cause.** `src/modules/assistant/frontend/Space.tsx:1014` — if (!run.userMessageContent.trim()) return;

**Proposed fix.** Wire Retry for stopped/cancelled runs. — Detail: Retry should fall back to the preceding user message content from `messages` (find the user message before run.assistantMessageId); and restoreActiveTask must not clobber an existing in-memory run for the same task.

**Evidence.** [019-after-stop-pulse](../evidence/shots/vq8/dark/019-after-stop-pulse.png)

<details><summary>Q8-031 — 'Retry' on a stopped/cancelled run does nothing (dead button) (S2, confirmed)</summary>

- Area assistant.space · stack A · design None · themes light · viewports 1440x900
- Repro:
  1. Assistant → new chat QA-q8-retry → send 'Reply with exactly: hello from the retry test'
  2. Click Stop generating within ~1s → card 'Assistant task cancelled.' + Retry
  3. Click Retry (twice)
- Expected: The last user prompt is re-submitted as a new run.
- Actual: Nothing happens: no Working… state, no POST /chats/3489e162…/messages (backend log count stays 1), no error. After the run terminates, onTerminal → refreshChats → the selected-chat effect calls restoreActiveTask, which overwrites the run with userMessageContent: '' — and retryRunAsNew returns early on an empty prompt.
- Screenshots: [019-after-stop-pulse](../evidence/shots/vq8/dark/019-after-stop-pulse.png), [020-after-retry-noop](../evidence/shots/vq8/dark/020-after-retry-noop.png), [018-cancelled-with-retry](../evidence/shots/q8/light/018-cancelled-with-retry.png), [019-after-retry](../evidence/shots/q8/light/019-after-retry.png)
- Network: `backend-A.log: POST /api/modules/assistant/chats/3489e162…/messages count 3 before and after two Retry clicks`; `backend-A.log: POST /api/modules/assistant/chats/3489e162…/messages count before=1 after=1 around Retry clicks`
- Code: `src/modules/assistant/frontend/Space.tsx:1014` — if (!run.userMessageContent.trim()) return;
- Code: `src/modules/assistant/frontend/Space.tsx:708` — restoreActiveTask sets userMessageContent: ''
- Code: `src/modules/assistant/frontend/Space.tsx:737` — selected-chat effect re-runs restoreActiveTask on every chats refresh
- Suggested fix: Retry should fall back to the preceding user message content from `messages` (find the user message before run.assistantMessageId); and restoreActiveTask must not clobber an existing in-memory run for the same task.
- Verification (vq8): **confirmed** — Reproduced in QA-q8-retry: Stop generating -> 'Assistant task cancelled.' + Retry; clicked Retry twice (after switching chats and back) -> no Working…, backend log count of POST /chats/3489e162…/messages stayed 3 (before and after). Code: restoreActiveTask (Space.tsx:692-707) overwrites the run with userMessageContent '' on the post-terminal refresh, and retryRunAsNew (:1012-1014) returns on empty content. S2 kept (visible Retry button does nothing). · evidence: [019-after-stop-pulse](../evidence/shots/vq8/dark/019-after-stop-pulse.png), [020-after-retry-noop](../evidence/shots/vq8/dark/020-after-retry-noop.png)

</details>


## T-332

**@-mentions of built-in library components render as raw '@[library-component:openpcb.core.passive.resistor\|Resistor]' — mention regex rejects '.' in ids (frontend and backend)**

- Severity **S2** · category bug · status confirmed · themes light
- Recommendation **fix-now** · decision DEC-A · owner A2 · wave W3 · scope frontend · estimate XS
- Findings: Q8-034

**Summary.** Bubble shows the raw markup '@[library-component:openpcb.core.passive.resistor|Resistor] In one line…'; no chip, not clickable. Both parsers use /@\[([a-z-]+):([a-zA-Z0-9-]+)\|…/ — ids with dots never match, so every built-in/KiCad-derived component mention (all ids are dotted) is also invisible to the backend mention resolver (the model only answered via its own tool calls).

**Root cause.** `src/modules/assistant/frontend/lib/mention-utils.ts:3` — entityId class [a-zA-Z0-9-]

**Proposed fix.** Mention regex accepts '.', '_', ':' in ids (frontend); backend parser same change = decision (XS). — Detail: Allow '.', '_' and ':' in the id group ([A-Za-z0-9._:-]+) in both parsers (keep the '|' and ']' delimiters), add a unit test with 'openpcb.core.passive.resistor'.

**Evidence.** [028-component-mention-raw-bubble](../evidence/shots/vq8/dark/028-component-mention-raw-bubble.png)

<details><summary>Q8-034 — @-mentions of built-in library components render as raw '@[library-component:openpcb.core.passive.resistor\|Resistor]' — mention regex rejects '.' in ids (frontend and backend) (S2, confirmed)</summary>

- Area assistant.space · stack A · design None · themes light · viewports 1440x900
- Repro:
  1. Assistant → composer '@Resis' → pick 'Resistor' (built-in, id openpcb.core.passive.resistor)
  2. Add 'In one line: what package does this component default to?' → Enter
- Expected: User bubble shows an '@ Resistor' chip (clickable → Library detail) like design/page mentions; backend resolves the mention into context.
- Actual: Bubble shows the raw markup '@[library-component:openpcb.core.passive.resistor|Resistor] In one line…'; no chip, not clickable. Both parsers use /@\[([a-z-]+):([a-zA-Z0-9-]+)\|…/ — ids with dots never match, so every built-in/KiCad-derived component mention (all ids are dotted) is also invisible to the backend mention resolver (the model only answered via its own tool calls).
- Screenshots: [028-component-mention-raw-bubble](../evidence/shots/vq8/dark/028-component-mention-raw-bubble.png), [020-component-mention-raw-in-bubble](../evidence/shots/q8/light/020-component-mention-raw-in-bubble.png)
- Code: `src/modules/assistant/frontend/lib/mention-utils.ts:3` — entityId class [a-zA-Z0-9-]
- Code: `src/core/backend/mentions/mention-parser.ts:7` — same regex server-side
- Suggested fix: Allow '.', '_' and ':' in the id group ([A-Za-z0-9._:-]+) in both parsers (keep the '|' and ']' delimiters), add a unit test with 'openpcb.core.passive.resistor'.
- Verification (vq8): **confirmed** — Reproduced in QA-q8-retry: user bubble shows literal '@[library-component:openpcb.core.passive.resistor|Resistor] In one line: …', 0 mention chips. Both parsers use /@\[([a-z-]+):([a-zA-Z0-9-]+)\|([^\]]+)\]/ (frontend lib/mention-utils.ts:3, backend core/backend/mentions/mention-parser.ts:7) - ids with '.' never match, so every built-in component mention is neither rendered nor resolved for context. S2 kept. · evidence: [028-component-mention-raw-bubble](../evidence/shots/vq8/dark/028-component-mention-raw-bubble.png)

</details>


## T-333

**Wide markdown tables and unbroken URLs overflow the message column — the whole chat thread scrolls horizontally**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A3 · wave W3 · scope frontend · estimate S
- Findings: F1D-004

**Summary.** The table renders 2885 px wide and runs off the right edge. The URL runs to the viewport edge. The thread container becomes horizontally scrollable (scrollWidth 2949 vs clientWidth 1040), so panning sideways shifts every other message and leaves the prose cut off on the left. The code block is fine: it has its own overflow-x. Related (code only, not reproduced): the designer dock thread uses overflow-x-hidden (Desig…

**Root cause.** `src/shared/frontend/markdown/MarkdownContent.tsx:101` — markdownComponents overrides only pre (mermaid); no table wrapper component

**Proposed fix.** Markdown tables in horizontal scroller; break long URLs (overflow-wrap:anywhere). — Detail: MarkdownContent.tsx markdownComponents(): add a `table` component returning <div className='my-2 max-w-full overflow-x-auto'><table {...props}/></div> (fixes Space and dock at once). MessageCard.tsx:36: add 'break-words' and '[overflow-wrap:anywhere]' to PROSE_CLASSES (prose-a too). Optionally set overflow-x-hidden on the Space thread scroller (Space.tsx:1542) once tables have their own scroller.

**Evidence.** [030-asst200-first](../evidence/shots/f1d/dark/030-asst200-first.png), [020-asst-wide-table](../evidence/shots/vf1d/dark/020-asst-wide-table.png)

<details><summary>F1D-004 — Wide markdown tables and unbroken URLs overflow the message column — the whole chat thread scrolls horizontally (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. In-page mock: a chat whose assistant message (10k chars) contains a 30-column markdown table, a wide ```ts code block and a 300-char URL
  2. Open the chat in the Assistant space and scroll to the message
  3. Scroll the thread horizontally (trackpad / shift+wheel)
- Expected: Tables sit in their own horizontal scroller (like the code block does) and long tokens/URLs wrap. The thread itself never scrolls sideways.
- Actual: The table renders 2885 px wide and runs off the right edge. The URL runs to the viewport edge. The thread container becomes horizontally scrollable (scrollWidth 2949 vs clientWidth 1040), so panning sideways shifts every other message and leaves the prose cut off on the left. The code block is fine: it has its own overflow-x. Related (code only, not reproduced): the designer dock thread uses overflow-x-hidden (DesignerChatDock.tsx:891), so in the ~300 px dock the same tables are clipped and their right-hand columns are unreachable.
- Screenshots: [030-asst200-first](../evidence/shots/f1d/dark/030-asst200-first.png), [034-asst-10k-message](../evidence/shots/f1d/dark/034-asst-10k-message.png), [035-asst-thread-hscroll](../evidence/shots/f1d/dark/035-asst-thread-hscroll.png), [038-asst200-1100](../evidence/shots/f1d/dark/038-asst200-1100.png), [131-asst-10k-message](../evidence/shots/f1d/light/131-asst-10k-message.png), [020-asst-wide-table](../evidence/shots/vf1d/dark/020-asst-wide-table.png), [021-asst-thread-hscrolled](../evidence/shots/vf1d/dark/021-asst-thread-hscrolled.png), [102-asst-wide-table](../evidence/shots/vf1d/light/102-asst-wide-table.png)
- Code: `src/shared/frontend/markdown/MarkdownContent.tsx:101` — markdownComponents overrides only pre (mermaid); no table wrapper component
- Code: `src/modules/assistant/frontend/components/MessageCard.tsx:36` — PROSE_CLASSES (space) lacks break-words/[overflow-wrap:anywhere]; prose-table:w-full only
- Code: `src/modules/assistant/frontend/components/MessageCard.tsx:89` — COMPACT_PROSE_CLASSES (dock) has break-words but no table overflow handling
- Code: `src/modules/assistant/frontend/Space.tsx:1542` — thread scroller overflow-auto -> becomes horizontally scrollable
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:891` — dock scroller overflow-x-hidden -> wide tables clipped
- Suggested fix: MarkdownContent.tsx markdownComponents(): add a `table` component returning <div className='my-2 max-w-full overflow-x-auto'><table {...props}/></div> (fixes Space and dock at once). MessageCard.tsx:36: add 'break-words' and '[overflow-wrap:anywhere]' to PROSE_CLASSES (prose-a too). Optionally set overflow-x-hidden on the Space thread scroller (Space.tsx:1542) once tables have their own scroller.
- Verification (vf1d): **confirmed** — Reproduced with the f1d chat mock (30-column table + 300-char URL in one assistant message): table 2885 px wide, URL link 2444 px, thread scroller scrollWidth 2949 vs clientWidth 1040 (overflow-x auto) in dark and light; setting scrollLeft=600 slides every message and cuts prose on the left (screenshot). The ts code block keeps its own scroller. MarkdownContent has no table component and PROSE_CLASSES has no overflow-wrap. S3 kept: LLM answers with wide BOM/parameter tables are a normal case, and the dock variant clips content outright. · evidence: [020-asst-wide-table](../evidence/shots/vf1d/dark/020-asst-wide-table.png), [021-asst-thread-hscrolled](../evidence/shots/vf1d/dark/021-asst-thread-hscrolled.png), [102-asst-wide-table](../evidence/shots/vf1d/light/102-asst-wide-table.png)

</details>


## T-334

**Model pill lists keyless cloud providers (OpenAI) as selectable with no hint, although Settings says 'Needs API key to activate', and the resulting 'API key required' error offers no way to add a key**

- Severity **S3** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A2 · wave W3 · scope frontend · estimate S
- Findings: F2C-004

**Summary.** The Provider select lists OpenAI with no hint. In the Assistant space the Model field becomes a free-text box still holding the oMLX model 'Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit' (the dock correctly switches to gpt-4o-mini, so the two surfaces disagree). The pill dot turns red (#fb2c36, raw red-500, tooltip-only 'API key required'), but the sidebar footer still shows a green dot with 'Qwen3.5-27B-… · OpenAI…

**Root cause.** `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:25` — only the pill dot knows about requiresApiKey; the provider <select> options don't

**Proposed fix.** Keyless providers disabled in pill with 'Needs API key' hint + link to Settings. — Detail: ModelSelectorPill.tsx: render provider options with the same requiresApiKey && !hasApiKey check used for the dot (:25-29) — suffix '— needs API key' or disable the option, and under the select show an inline 'Add API key' link when such a provider is chosen. Map the 400 'API key required for provider: X' (Space.tsx / DesignerChatDock.tsx submit catch) to an inline composer notice with an 'Add API key' button that opens Settings › Assistant with that provider expanded. Model reset on provider change is Q10-015, ban…

**Evidence.** [006-pill-openai-nokey](../evidence/shots/f2c/dark/006-pill-openai-nokey.png), [204-pill-openai-nokey](../evidence/shots/vf2c/dark/204-pill-openai-nokey.png)

<details><summary>F2C-004 — Model pill lists keyless cloud providers (OpenAI) as selectable with no hint, although Settings says 'Needs API key to activate', and the resulting 'API key required' error offers no way to add a key (S3, confirmed)</summary>

- Area assistant.space · stack B · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack B (no keys). Assistant › chat on oMLX › model pill → Provider 'OpenAI'
  2. Observe the Model field, pill dot and sidebar footer
  3. Close the popover, type 'hello openai', Enter; press Enter again (retry)
  4. Repeat in the Designer dock (Cmd+I)
- Expected: Unconfigured providers are marked in the Provider select ('OpenAI — needs API key') or disabled. Selecting one shows an inline 'Add API key' action. The model resets to that provider's default. A send error gives a one-click route to the provider settings.
- Actual: The Provider select lists OpenAI with no hint. In the Assistant space the Model field becomes a free-text box still holding the oMLX model 'Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit' (the dock correctly switches to gpt-4o-mini, so the two surfaces disagree). The pill dot turns red (#fb2c36, raw red-500, tooltip-only 'API key required'), but the sidebar footer still shows a green dot with 'Qwen3.5-27B-… · OpenAI'. On send, POST /messages → 400 and a red banner 'API key required for provider: OpenAI' (Dismiss only) appears at the top of the thread, not next to the composer. There is no 'Add key'/'Open settings' link, the pill's 'Configure providers' is dead (Q8-008), and Enter just repeats the 400. The typed text stays in the composer (good) but is lost on reload. In a chat with history (light, 1100×720, 'QA-f2c-board chat') the same banner renders at top=-592px, above the scrolled thread. Nothing visible changes on send except the text staying in the composer (same placement root as Q8-017).
- Screenshots: [006-pill-openai-nokey](../evidence/shots/f2c/dark/006-pill-openai-nokey.png), [007-openai-nokey-send](../evidence/shots/f2c/dark/007-openai-nokey-send.png), [016-dock-openai-nokey](../evidence/shots/f2c/dark/016-dock-openai-nokey.png), [115-1100-openai-nokey-light](../evidence/shots/f2c/light/115-1100-openai-nokey-light.png), [204-pill-openai-nokey](../evidence/shots/vf2c/dark/204-pill-openai-nokey.png), [205-openai-nokey-send](../evidence/shots/vf2c/dark/205-openai-nokey-send.png)
- Console: `Failed to load resource: 400 (Bad Request) @ /api/modules/assistant/chats/d64eab56…/messages`
- Network: `GET /api/modules/assistant/providers/openai/models → 200 (empty → free-text model field)`; `POST /api/modules/assistant/chats/d64eab56…/messages → 400`
- Pixel probes: {"file": "shots/f2c/dark/007-openai-nokey-send.png", "x": 1147, "y": 28, "hex": "#fb2c36", "nearestToken": "--net-power", "deltaE": 22.8}; {"file": "shots/f2c/dark/007-openai-nokey-send.png", "x": 95, "y": 881, "hex": "#6fbf7a", "nearestToken": "--status-success", "deltaE": 0.0}
- Code: `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:25` — only the pill dot knows about requiresApiKey; the provider <select> options don't
- Code: `src/modules/assistant/frontend/Space.tsx:1365` — sidebar footer dot is always green regardless of provider state
- Suggested fix: ModelSelectorPill.tsx: render provider options with the same requiresApiKey && !hasApiKey check used for the dot (:25-29) — suffix '— needs API key' or disable the option, and under the select show an inline 'Add API key' link when such a provider is chosen. Map the 400 'API key required for provider: X' (Space.tsx / DesignerChatDock.tsx submit catch) to an inline composer notice with an 'Add API key' button that opens Settings › Assistant with that provider expanded. Model reset on provider change is Q10-015, banner placement is Q8-017, the dead 'Configure providers' is Q8-008 and the always-green footer dot is covered in F2C-001.
- Verification (vf2c): **confirmed** — Reproduced on stack B (dark): Assistant › chat on oMLX › pill › Provider select lists 'OpenAI / oMLX / OpenCode Zen' with no hint (Settings › Assistant shows OpenAI 'Needs API key to activate'). Selecting OpenAI: Model becomes a free-text box still holding 'Qwen3.5-27B-…', pill dot red (title 'API key required'), footer dot #6fbf7a with 'Qwen3.5-… · OpenAI'. Send → 400 and a role=alert 'API key required for provider: OpenAI' (top=73 in this short chat) with only 'Dismiss error'; the typed text stays in the composer; the chat's provider is unchanged. Scope narrowed to what is not already reported: model carry-over = Q10-015 (same provider-change root), off-screen banner in long chats = Q8-017, dead 'Configure providers' = Q8-008, hard-coded footer dot = F2C-001. Remaining: keyless providers are selectable unflagged (contradicting Settings) and the error has no add-key route. S3 kept (visible inconsistency with Settings + dead-end error); the error copy itself is clear, so not higher. · evidence: [204-pill-openai-nokey](../evidence/shots/vf2c/dark/204-pill-openai-nokey.png), [205-openai-nokey-send](../evidence/shots/vf2c/dark/205-openai-nokey-send.png), [225-settings-assistant-omlx](../evidence/shots/vf2c/dark/225-settings-assistant-omlx.png), POST /api/modules/assistant/chats/8d822fb1…/messages → 400 'API key required for provider: OpenAI'

</details>


## T-335

**'Pinned' chat filter is permanently empty — no Pin action exists anywhere; empty state then says 'No chats yet.'**

- Severity **S3** · category stub · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate XS
- Findings: Q8-005 · known ref K23

**Summary.** No UI calls togglePin; the Pinned filter always shows 0 and the list body reads 'No chats yet.' although 11 chats exist.

**Root cause.** `src/modules/assistant/frontend/components/useChatUserState.ts:49` — togglePin defined, never called

**Proposed fix.** Add Pin/Unpin to row + header menus (togglePin exists); empty Pinned state copy. — Detail: Add 'Pin'/'Unpin' to the header DropdownMenu and the row context menu (userState.togglePin(chat.id)); or remove the Pinned chip until pinning ships.

**Evidence.** [004-pinned-empty](../evidence/shots/vq8/dark/004-pinned-empty.png)

<details><summary>Q8-005 — 'Pinned' chat filter is permanently empty — no Pin action exists anywhere; empty state then says 'No chats yet.' (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Assistant space with 11 chats
  2. Look for a pin action: row '…' menu (Rename chat / Delete chat), right-click menu (same), header Chat actions (Rename / Export markdown / Archive / Delete)
  3. Click the 'Pinned 0' filter chip
- Expected: A Pin/Unpin action in the row and header menus, or no Pinned filter at all; a filter-specific empty message.
- Actual: No UI calls togglePin; the Pinned filter always shows 0 and the list body reads 'No chats yet.' although 11 chats exist.
- Screenshots: [004-pinned-empty](../evidence/shots/vq8/dark/004-pinned-empty.png), [006-row-actions-menu](../evidence/shots/vq8/dark/006-row-actions-menu.png), [002-filter-pinned-empty](../evidence/shots/q8/dark/002-filter-pinned-empty.png)
- Code: `src/modules/assistant/frontend/components/useChatUserState.ts:49` — togglePin defined, never called
- Code: `src/modules/assistant/frontend/Space.tsx:1191` — Pinned filter chip
- Code: `src/modules/assistant/frontend/Space.tsx:1480` — header Chat actions — no Pin item
- Suggested fix: Add 'Pin'/'Unpin' to the header DropdownMenu and the row context menu (userState.togglePin(chat.id)); or remove the Pinned chip until pinning ships.
- Verification (vq8): **confirmed** — Reproduced: row '…' menu = Rename chat / Delete chat; header Chat actions = Rename / Export markdown / Archive / Delete - no Pin anywhere; grep: useChatUserState.togglePin (useChatUserState.ts:49) has no caller. Pinned 0 filter shows 'No chats yet.' with 15 chats. Matches K23. Empty-state copy overlaps Q8-006 but the root cause (no pin action) is distinct. S3 kept. · evidence: [004-pinned-empty](../evidence/shots/vq8/dark/004-pinned-empty.png), [006-row-actions-menu](../evidence/shots/vq8/dark/006-row-actions-menu.png)

</details>


## T-336

**Chat list says 'No chats yet.' for any empty filter or search miss**

- Severity **S3** · category copy · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate XS
- Findings: Q8-006

**Summary.** Always 'No chats yet.' — implies the user has no chats at all. Search also matches titles only (typing 'LED' finds nothing although 4 chats are linked to LED designs).

**Root cause.** `src/modules/assistant/frontend/Space.tsx:1351` — single 'No chats yet.' empty state

**Proposed fix.** Filter/search-specific empty states; skeleton while loading. — Detail: Branch the empty state on query/filter; include linked design name in the search haystack.

**Evidence.** [005-search-zzzz-empty](../evidence/shots/vq8/dark/005-search-zzzz-empty.png)

<details><summary>Q8-006 — Chat list says 'No chats yet.' for any empty filter or search miss (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Assistant space (11 chats)
  2. Type 'zzzz' in Search chats, or click the Archived / Pinned filter
- Expected: 'No chats match "zzzz"' / 'No archived chats' with a Clear search affordance.
- Actual: Always 'No chats yet.' — implies the user has no chats at all. Search also matches titles only (typing 'LED' finds nothing although 4 chats are linked to LED designs).
- Screenshots: [005-search-zzzz-empty](../evidence/shots/vq8/dark/005-search-zzzz-empty.png), [004-pinned-empty](../evidence/shots/vq8/dark/004-pinned-empty.png), [002-filter-pinned-empty](../evidence/shots/q8/dark/002-filter-pinned-empty.png)
- Code: `src/modules/assistant/frontend/Space.tsx:1351` — single 'No chats yet.' empty state
- Code: `src/modules/assistant/frontend/Space.tsx:251` — query matches chat.title only
- Suggested fix: Branch the empty state on query/filter; include linked design name in the search haystack.
- Verification (vq8): **confirmed** — Reproduced: Pinned filter and search 'zzzz' both render 'No chats yet.' (single empty state Space.tsx:1349-1352); search 'LED' returns 0 rows although QA-q8-dock is linked to 'S3 Smoke — 5 LED indicators (v2)' (query only matches chat.title, Space.tsx:251). S3 kept. · evidence: [005-search-zzzz-empty](../evidence/shots/vq8/dark/005-search-zzzz-empty.png), [004-pinned-empty](../evidence/shots/vq8/dark/004-pinned-empty.png)

</details>


## T-337

**Model picker popover: 460-entry native <select> with no search or free/paid hint, unlabeled comboboxes, Esc does not close it**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A2 · wave W3 · scope frontend · estimate M
- Findings: Q8-007

**Summary.** Plain native <select>s — model list is an unfiltered 460-option dropdown sorted alphabetically (first entry is a paid model), no pricing/free cue. <label>s are not associated (a11y tree shows three nameless 'combobox'). Escape leaves the popover open; only an outside mousedown closes it. Pill is 32px tall (h-8) with a glowing status dot (shadow-[0_0_6px_currentColor]) vs 22px flat controls.

**Root cause.** `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:132` — label without htmlFor + native select

**Proposed fix.** Searchable kit combobox model picker (free/paid hint), labelled, Esc closes. — Detail: Use the kit Popover (Radix) for Esc/focus handling; replace the model select with a filterable combobox (cmdk) showing ':free'/price; add id/htmlFor; h-[22px] pill, drop the glow.

**Evidence.** [009-model-pill-popover](../evidence/shots/vq8/dark/009-model-pill-popover.png)

<details><summary>Q8-007 — Model picker popover: 460-entry native <select> with no search or free/paid hint, unlabeled comboboxes, Esc does not close it (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Assistant space → click the model pill (e.g. 'nvidia/nemotron-3.5-li… STRICT')
  2. Inspect the popover; press Escape
- Expected: Searchable model list (OpenRouter returns 460 models) that marks :free / pricing; each select labelled (Provider / Model / Prompt preset); Esc and focus-return close the popover; role=dialog.
- Actual: Plain native <select>s — model list is an unfiltered 460-option dropdown sorted alphabetically (first entry is a paid model), no pricing/free cue. <label>s are not associated (a11y tree shows three nameless 'combobox'). Escape leaves the popover open; only an outside mousedown closes it. Pill is 32px tall (h-8) with a glowing status dot (shadow-[0_0_6px_currentColor]) vs 22px flat controls.
- Screenshots: [009-model-pill-popover](../evidence/shots/vq8/dark/009-model-pill-popover.png), [003-model-pill-popover](../evidence/shots/q8/dark/003-model-pill-popover.png)
- Code: `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:132` — label without htmlFor + native select
- Code: `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:91` — only mousedown-outside closes; no keydown Escape
- Code: `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:114` — h-8 + glow shadow
- Suggested fix: Use the kit Popover (Radix) for Esc/focus handling; replace the model select with a filterable combobox (cmdk) showing ':free'/price; add id/htmlFor; h-[22px] pill, drop the glow.
- Verification (vq8): **confirmed** — Reproduced: popover has three native <select>s with labels.length 0 / no aria-label (a11y tree: 3 nameless combobox), model select 460 options, first 'aion-labs/aion-2.0', no free/price cue; Escape leaves it open (only mousedown-outside closes, ModelSelectorPill.tsx:91-99); pill height 32px (h-8) with glow dot; preset badge is text-[9px] (sub-10px). S3 kept. · evidence: [009-model-pill-popover](../evidence/shots/vq8/dark/009-model-pill-popover.png)

</details>


## T-338

**Mermaid 'Fullscreen' shows the diagram smaller than inline; overlay ignores Esc, has no dialog role, drops focus to <body>**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner A3 · wave W3 · scope frontend · estimate S
- Findings: Q8-009
- Depends on: ['T-014']

**Summary.** Overlay shows a ~350×270px thumbnail (inline figure is 609×465) — 'fullscreen' is smaller than the inline render. Escape does nothing. After closing, document.activeElement is BODY. The inline 'View source' toggle has no aria-pressed/aria-expanded.

**Root cause.** `src/shared/frontend/markdown/MermaidDiagram.tsx:368` — fixed inset-0 overlay, no role/Esc/focus; svg width=100% inside shrink-to-fit box → tiny

**Proposed fix.** Mermaid fullscreen as kit Dialog, fit-to-viewport scaling, Esc, focus restore. — Detail: Render fullscreen via the kit Dialog (Esc, focus trap/return); give the SVG container w-[90vw] h-[85vh] and set the svg to width/height 100% with preserveAspectRatio; add aria-pressed to View source.

**Evidence.** [010-mermaid-inline](../evidence/shots/vq8/dark/010-mermaid-inline.png)

<details><summary>Q8-009 — Mermaid 'Fullscreen' shows the diagram smaller than inline; overlay ignores Esc, has no dialog role, drops focus to <body> (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Assistant → open chat 'edge unbound' (contains a rendered flowchart)
  2. Click the diagram toolbar 'Fullscreen' (⤢)
  3. Press Escape; then click the X
- Expected: Diagram scaled up to fill most of the viewport (zoom/pan ideally); Esc closes; role=dialog + focus trapped on the close button and returned to the trigger on close.
- Actual: Overlay shows a ~350×270px thumbnail (inline figure is 609×465) — 'fullscreen' is smaller than the inline render. Escape does nothing. After closing, document.activeElement is BODY. The inline 'View source' toggle has no aria-pressed/aria-expanded.
- Screenshots: [010-mermaid-inline](../evidence/shots/vq8/dark/010-mermaid-inline.png), [011-mermaid-fullscreen](../evidence/shots/vq8/dark/011-mermaid-fullscreen.png), [019-mermaid-rendered](../evidence/shots/q8/dark/019-mermaid-rendered.png), [022-mermaid-fullscreen](../evidence/shots/q8/dark/022-mermaid-fullscreen.png), [020b-mermaid-source-open](../evidence/shots/q8/dark/020b-mermaid-source-open.png)
- Code: `src/shared/frontend/markdown/MermaidDiagram.tsx:368` — fixed inset-0 overlay, no role/Esc/focus; svg width=100% inside shrink-to-fit box → tiny
- Code: `src/shared/frontend/markdown/MermaidDiagram.tsx:330` — View source button lacks aria-pressed
- Suggested fix: Render fullscreen via the kit Dialog (Esc, focus trap/return); give the SVG container w-[90vw] h-[85vh] and set the svg to width/height 100% with preserveAspectRatio; add aria-pressed to View source.
- Verification (vq8): **confirmed** — Reproduced on 'edge unbound': inline diagram svg 609x465, fullscreen svg 300x229 (smaller than inline); overlay role=null, Escape leaves it open, after 'Close fullscreen' activeElement=BODY; 'View source' has no aria-pressed. MermaidDiagram.tsx:368-389 (plain fixed div, [&_svg]:max-w-[80vw] on an svg with width=100% inside a shrink-to-fit box). S3 kept. · evidence: [010-mermaid-inline](../evidence/shots/vq8/dark/010-mermaid-inline.png), [011-mermaid-fullscreen](../evidence/shots/vq8/dark/011-mermaid-fullscreen.png)

</details>


## T-339

**Mermaid diagrams hard-coded violet/navy; light theme renders prompt-styled nodes as black boxes**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · decision DEC-A · owner A3 · wave W3 · scope frontend · estimate S
- Findings: Q8-010, Q8-027

**Summary.** Node border #7a69b7 (ΔE 33.5 from any token), subgraph border #302b4a, diagram bg #0a0e14 (blue-black), FLOWCHART chip + subgraph titles violet. Markdown <hr> in answers probes #364153 (Tailwind gray-700, ΔE 12.8 — blue cast). Light theme variables also violet (#7C3AED / #f5f3ff). Dock/space markdown tables use the same gray scale: row separators #364153, header rule #4a5565. | Also covers: Q8-027: Light theme: Mermaid nodes styled with the prompt-mandated dark palette render as black b…

**Root cause.** `src/shared/frontend/markdown/MermaidDiagram.tsx:154` — themeVariablesFor: violet palette

**Proposed fix.** Mermaid theme from tokens (both themes), override prompt classDefs in light; prose borders neutral; prompt palette change = decision XS. — Detail: Build themeVariables from getComputedStyle(--surface-*, --border, --text*, --selection); drop violet chip; add prose-neutral/prose-zinc-like remap or set --tw-prose-hr/borders to var(--divider).

**Evidence.** [010-mermaid-inline](../evidence/shots/vq8/dark/010-mermaid-inline.png), [003-mermaid-light](../evidence/shots/vq8/light/003-mermaid-light.png)

<details><summary>Q8-010 — Mermaid diagrams use a hard-coded violet/navy theme (#A78BFA borders, #0A0E14 bg) off the neutral tokens; chat prose hr/borders use Tailwind gray (blue cast) (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Assistant → chat 'edge unbound' → scroll to 'Circuit topology' flowchart
  2. Probe node borders / background; also the <hr> in the new chat's answer
- Expected: Diagram chrome and theme variables derived from tokens (neutral surfaces, --selection/status accents); prose rules neutral.
- Actual: Node border #7a69b7 (ΔE 33.5 from any token), subgraph border #302b4a, diagram bg #0a0e14 (blue-black), FLOWCHART chip + subgraph titles violet. Markdown <hr> in answers probes #364153 (Tailwind gray-700, ΔE 12.8 — blue cast). Light theme variables also violet (#7C3AED / #f5f3ff). Dock/space markdown tables use the same gray scale: row separators #364153, header rule #4a5565.
- Screenshots: [010-mermaid-inline](../evidence/shots/vq8/dark/010-mermaid-inline.png), [019-mermaid-rendered](../evidence/shots/q8/dark/019-mermaid-rendered.png), [018-mermaid-invalid](../evidence/shots/q8/dark/018-mermaid-invalid.png), [061-dock-table-answer](../evidence/shots/q8/dark/061-dock-table-answer.png)
- Pixel probes: {"file": "shots/vq8/dark/010-mermaid-inline.png", "x": 802, "y": 311, "hex": "#7c71ad", "nearestToken": "--status-info", "deltaE": 25.7}; {"file": "shots/vq8/dark/010-mermaid-inline.png", "x": 900, "y": 253, "hex": "#363053", "nearestToken": "--surface-control", "deltaE": 18.0}; {"file": "shots/vq8/dark/010-mermaid-inline.png", "x": 660, "y": 300, "hex": "#0a0e14", "nearestToken": "--primary-foreground", "deltaE": 2.4}; {"file": "shots/q8/dark/019-mermaid-rendered.png", "x": 1072, "y": 584, "hex": "#7a69b7", "nearestToken": "--status-info", "deltaE": 33.5}; {"file": "shots/q8/dark/019-mermaid-rendered.png", "x": 560, "y": 620, "hex": "#0a0e14", "nearestToken": "--primary-foreground", "deltaE": 2.4}; {"file": "shots/q8/dark/018-mermaid-invalid.png", "x": 900, "y": 320, "hex": "#364153", "nearestToken": "--surface-control", "deltaE": 12.8}; {"file": "shots/q8/dark/061-dock-table-answer.png", "x": 1300, "y": 514, "hex": "#364153", "nearestToken": "--surface-control", "deltaE": 12.8}
- Code: `src/shared/frontend/markdown/MermaidDiagram.tsx:154` — themeVariablesFor: violet palette
- Code: `src/shared/frontend/markdown/MermaidDiagram.tsx:300` — violet type chip / bg-[#0A0E14]
- Code: `src/modules/assistant/frontend/components/MessageCard.tsx:36` — prose (typography gray scale not remapped)
- Suggested fix: Build themeVariables from getComputedStyle(--surface-*, --border, --text*, --selection); drop violet chip; add prose-neutral/prose-zinc-like remap or set --tw-prose-hr/borders to var(--divider).
- Verification (vq8): **confirmed** — Re-probed dark: default node border #7c71ad (dE 25.7 from nearest token, themeVariables nodeBorder #A78BFA), subgraph border #363053 (#5B4B8A), node fill #13191f and diagram bg #0a0e14 (slight blue cast). Prose hr/tbody row borders computed oklch(0.373 0.034 259.7) = Tailwind gray-700 #364153 (blue hue 259), thead rule oklch(0.446 0.03 256.8). Correction: the 'FLOWCHART' chip is NOT violet - text-violet-*/bg-violet-* are neutralised by the PLAN D1 violet->neutral remap (computed #a8a8ad) - but it is 9px text. The raw hex in themeVariablesFor bypasses the remap. Assistant/markdown is in the documented re-skin-only bucket (PLAN §0/§9) yet the violet accent is exactly what the redesign removed. S3 kept. · evidence: [010-mermaid-inline](../evidence/shots/vq8/dark/010-mermaid-inline.png)

</details>

<details><summary>Q8-027 — Light theme: Mermaid nodes styled with the prompt-mandated dark palette render as black boxes on a white diagram (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes light · viewports 1440x900
- Repro:
  1. Light theme → Assistant → chat 'edge unbound' → 'Circuit topology' flowchart
- Expected: Diagram readable and consistent in light theme (class colours adapt to theme).
- Actual: +5V / CTRL0 / CTRL1 / GND nodes are near-black (#13191F fill, #F3F4F6 text) while R/D nodes are light violet — a patchy dark-on-light diagram. The system prompt hard-codes classDef fills '#13191F' for every class, so every assistant diagram carries dark-mode colours regardless of theme; Download SVG exports them too.
- Screenshots: [003-mermaid-light](../evidence/shots/vq8/light/003-mermaid-light.png), [002-mermaid-light](../evidence/shots/q8/light/002-mermaid-light.png), [019-mermaid-rendered](../evidence/shots/q8/dark/019-mermaid-rendered.png)
- Pixel probes: {"file": "shots/vq8/light/003-mermaid-light.png", "x": 1192, "y": 450, "hex": "#13191f", "nearestToken": "--primary", "deltaE": 4.0}; {"file": "shots/vq8/light/003-mermaid-light.png", "x": 860, "y": 305, "hex": "#f5f3ff", "nearestToken": "--surface-app", "deltaE": 5.7}
- Code: `src/modules/assistant/backend/prompt-service.ts:18` — classDef power fill:#13191F … (dark-only palette)
- Code: `src/shared/frontend/markdown/MermaidDiagram.tsx:198` — light themeVariables violet
- Suggested fix: Have the model emit semantic class names only (classDef-free) and inject theme-aware classDefs in MermaidDiagram before render (from tokens), overriding any model-supplied fills.
- Verification (vq8): **confirmed** — Reproduced light on 'edge unbound': diagram bg #ffffff; +5V/CTRL0/CTRL1/GND node fill computed rgb(19,25,31) (#13191f, probe on GND dE 4.0 from --primary = near-black) from the prompt-mandated classDefs (prompt-service.ts:18), while default R/D nodes are light violet (#f5f3ff fill, #b697f3 border from light themeVariables #7C3AED). Distinct root from Q8-010 (prompt classDefs vs component theme). S3 kept. · evidence: [003-mermaid-light](../evidence/shots/vq8/light/003-mermaid-light.png)

</details>


## T-340

**Multi-step answers glue each iteration's text together with no separator ('…LED components.The design…', '…brightness)?Let me examine…')**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-A · owner A1 · wave W3 · scope backend · estimate XS
- Findings: Q8-011

**Summary.** Stored message content concatenates iteration deltas verbatim: 'look up available LED components.The design "LED Indicators 5V" is already bound…recipe.The circuit compiled cleanly', '…higher/lower brightness)?Let me examine the design…'. Reads as broken sentences; markdown headings following a glued sentence can fail to parse.

**Root cause.** `src/modules/assistant/backend/run-service.ts:1014` — run.message.delta appended verbatim across iterations

**Proposed fix.** Backend: separate iteration texts (paragraph break) in multi-step answers. — Detail: In run-service, when a new iteration starts (or after tool results) and the message already has content not ending in a newline, append '\n\n' before the next delta (track lastIteration per run).

**Evidence.** [012-raw-sub-and-glued](../evidence/shots/vq8/dark/012-raw-sub-and-glued.png)

<details><summary>Q8-011 — Multi-step answers glue each iteration's text together with no separator ('…LED components.The design…', '…brightness)?Let me examine…') (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Assistant → open chat 'edge unbound v2' (a multi-iteration tool run)
  2. Read the first paragraphs of the assistant answer
- Expected: Each model turn's prose starts on a new paragraph (or intermediate 'thinking aloud' turns are folded into the tool timeline).
- Actual: Stored message content concatenates iteration deltas verbatim: 'look up available LED components.The design "LED Indicators 5V" is already bound…recipe.The circuit compiled cleanly', '…higher/lower brightness)?Let me examine the design…'. Reads as broken sentences; markdown headings following a glued sentence can fail to parse.
- Screenshots: [012-raw-sub-and-glued](../evidence/shots/vq8/dark/012-raw-sub-and-glued.png), [023-concatenated-iterations-and-raw-sub](../evidence/shots/q8/dark/023-concatenated-iterations-and-raw-sub.png)
- Network: `GET /chats/f6a5ed1d…/messages → content 'LED components.The design "LED Indicators 5V" is already bound'`
- Code: `src/modules/assistant/backend/run-service.ts:1014` — run.message.delta appended verbatim across iterations
- Code: `node_modules/@openpcb/ai-core/dist/runs/run-loop.js:54` — each iteration re-streams deltas into the same assistant message
- Suggested fix: In run-service, when a new iteration starts (or after tool results) and the message already has content not ending in a newline, append '\n\n' before the next delta (track lastIteration per run).
- Verification (vq8): **confirmed** — Data-verified: f6a5ed1d ('edge unbound v2') visible assistant content contains 'look up available LED components.The design "LED Indic…', '…led_indicator` recipe.The circuit compiled', '…higher/lower brightness)?Let me examine the de…'. Current code still appends every run.message.delta verbatim (run-service.ts:1013-1018) across ai-core iterations (run-loop.js:53-56) with no separator. Newer nemotron chats show no gluing only because that model emits no pre-tool prose - model-dependent, not fixed. S3 kept. · evidence: [012-raw-sub-and-glued](../evidence/shots/vq8/dark/012-raw-sub-and-glued.png)

</details>


## T-341

**Header 'Chat actions' menu stays open after Archive / Export / Delete and blocks the whole page (body pointer-events:none)**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate XS
- Findings: Q8-015

**Summary.** Menu stays open (item now reads 'Unarchive'); Radix keeps body pointer-events:none so every other click is swallowed until Esc/outside click (a playwright click on 'Archived 1' failed: element not in a11y tree). The archived chat stays open in the main pane but vanishes from the All list with no archived indicator in the header.

**Root cause.** `src/modules/assistant/frontend/Space.tsx:1500` — onSelect={(e) => { e.preventDefault(); … }} on Export/Archive/Delete keeps Radix menu open

**Proposed fix.** Close menu after Archive/Export/Delete (drop preventDefault); archived chat shows 'Archived' chip. — Detail: Drop e.preventDefault() from those onSelect handlers (only needed if a nested dialog opens); after archiving, clear selection or show an 'Archived' chip + Unarchive in the header.

**Evidence.** [007-archive-menu-stays-open](../evidence/shots/vq8/dark/007-archive-menu-stays-open.png)

<details><summary>Q8-015 — Header 'Chat actions' menu stays open after Archive / Export / Delete and blocks the whole page (body pointer-events:none) (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Assistant → select chat QA-q8-del2 → header '…' (Chat actions) → Archive
  2. Try clicking the 'Archived' filter chip
- Expected: Menu closes after the action; archived chat deselected or header shows 'Archived' state.
- Actual: Menu stays open (item now reads 'Unarchive'); Radix keeps body pointer-events:none so every other click is swallowed until Esc/outside click (a playwright click on 'Archived 1' failed: element not in a11y tree). The archived chat stays open in the main pane but vanishes from the All list with no archived indicator in the header.
- Screenshots: [007-archive-menu-stays-open](../evidence/shots/vq8/dark/007-archive-menu-stays-open.png), [028a-archive-menu-stays-open](../evidence/shots/q8/dark/028a-archive-menu-stays-open.png), [028-archived-filter](../evidence/shots/q8/dark/028-archived-filter.png)
- Console: `getComputedStyle(document.body).pointerEvents === 'none', [role=menu] count 1 after selecting Archive`
- Code: `src/modules/assistant/frontend/Space.tsx:1500` — onSelect={(e) => { e.preventDefault(); … }} on Export/Archive/Delete keeps Radix menu open
- Suggested fix: Drop e.preventDefault() from those onSelect handlers (only needed if a nested dialog opens); after archiving, clear selection or show an 'Archived' chip + Unarchive in the header.
- Verification (vq8): **confirmed** — Reproduced on own disposable chat: header Chat actions -> Archive -> [role=menu] still open, item now 'Unarchive', body pointer-events 'none'; clicking 'Archived 1' did not go through; Esc closed the menu. Header still shows the archived chat with no archived indicator. Space.tsx:1500-1512 onSelect e.preventDefault(). Same pattern as Q1-001 (Home) but without wrong-target risk here. S3 kept. · evidence: [007-archive-menu-stays-open](../evidence/shots/vq8/dark/007-archive-menu-stays-open.png)

</details>


## T-342

**Multi-select keeps chats selected across filters; 'Delete selected' deletes hidden (e.g. archived) chats the user can't see**

- Severity **S3** · category data · status confirmed · themes dark
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate XS
- Findings: Q8-016

**Summary.** '2 selected' with one visible tick; confirm 'Delete 2 selected chats?' removed the hidden archived chat too.

**Root cause.** `src/modules/assistant/frontend/Space.tsx:1216` — selectedChatIds independent of filteredChats

**Proposed fix.** Clear/intersect multi-selection on filter/search change. — Detail: Intersect selectedChatIds with filteredChats (or clear on filter/query change); add 'Select all visible'.

**Evidence.** [008-multiselect-hidden](../evidence/shots/vq8/dark/008-multiselect-hidden.png)

<details><summary>Q8-016 — Multi-select keeps chats selected across filters; 'Delete selected' deletes hidden (e.g. archived) chats the user can't see (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Archived filter → tick 'QA-q8-del2'
  2. Switch to All → tick 'QA-q8-ms1'
  3. Bar shows '2 selected' while only one visible row is ticked → Delete selected → OK
- Expected: Selection cleared on filter/search change, or the bar lists/indicates hidden selected items.
- Actual: '2 selected' with one visible tick; confirm 'Delete 2 selected chats?' removed the hidden archived chat too.
- Screenshots: [008-multiselect-hidden](../evidence/shots/vq8/dark/008-multiselect-hidden.png), [029-multiselect-hidden-selection](../evidence/shots/q8/dark/029-multiselect-hidden-selection.png), [030-after-bulk-delete](../evidence/shots/q8/dark/030-after-bulk-delete.png)
- Code: `src/modules/assistant/frontend/Space.tsx:1216` — selectedChatIds independent of filteredChats
- Suggested fix: Intersect selectedChatIds with filteredChats (or clear on filter/query change); add 'Select all visible'.
- Verification (vq8): **confirmed** — Reproduced with two own chats: Archived -> tick 'New chat' -> All -> tick 'QA-vq8-ms1' -> 1 visible tick, bar '2 selected' -> Delete selected -> confirm 'Delete 2 selected chats?' accepted -> both chats gone from GET /chats, including the hidden archived one. selectedChatIds (Space.tsx:190) is never intersected with filteredChats. S3 kept (the confirm does state the count). · evidence: [008-multiselect-hidden](../evidence/shots/vq8/dark/008-multiselect-hidden.png)

</details>


## T-343

**Chat row keeps the pulsing 'run active' dot after a run is cancelled (Stop)**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate XS
- Findings: Q8-018

**Summary.** Row 'QA-q8-main' keeps the animate-pulse dot indefinitely after 'Assistant task cancelled.' (verified after switching chats). Cancelled/failed runs stay in activeRunsByChat for the Retry card and the sidebar treats any entry as active.

**Root cause.** `src/modules/assistant/frontend/Space.tsx:1305` — {activeRunsByChat[chat.id] ? <pulse/> : null} ignores run.status

**Proposed fix.** Clear run-active dot on cancel/finish events. — Detail: Show the dot only when status is running/streaming/queued (exclude cancelled/failed/paused/disconnected); use a static warning glyph for failed runs if desired.

**Evidence.** [019-after-stop-pulse](../evidence/shots/vq8/dark/019-after-stop-pulse.png)

<details><summary>Q8-018 — Chat row keeps the pulsing 'run active' dot after a run is cancelled (Stop) (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. QA-q8-main → send a long prompt → click Stop generating while streaming
  2. Observe the chat row in the sidebar; switch chats and back
- Expected: Activity dot only while a run is actually running.
- Actual: Row 'QA-q8-main' keeps the animate-pulse dot indefinitely after 'Assistant task cancelled.' (verified after switching chats). Cancelled/failed runs stay in activeRunsByChat for the Retry card and the sidebar treats any entry as active.
- Screenshots: [019-after-stop-pulse](../evidence/shots/vq8/dark/019-after-stop-pulse.png), [032-after-stop](../evidence/shots/q8/dark/032-after-stop.png), [033-send-500](../evidence/shots/q8/dark/033-send-500.png)
- Console: `row.querySelector('.animate-pulse') → true after cancel`
- Code: `src/modules/assistant/frontend/Space.tsx:1305` — {activeRunsByChat[chat.id] ? <pulse/> : null} ignores run.status
- Code: `src/modules/assistant/frontend/Space.tsx:660` — cancelled runs kept via updateRun(status:'cancelled')
- Suggested fix: Show the dot only when status is running/streaming/queued (exclude cancelled/failed/paused/disconnected); use a static warning glyph for failed runs if desired.
- Verification (vq8): **confirmed** — Reproduced in QA-q8-retry: sent a prompt, clicked 'Stop generating' -> 'Assistant task cancelled.' + Retry; row 'QA-q8-retry' keeps .animate-pulse, still true after switching to QA-q8-main and back. Space.tsx:1307 renders the dot for any activeRunsByChat entry regardless of status. S3 kept. · evidence: [019-after-stop-pulse](../evidence/shots/vq8/dark/019-after-stop-pulse.png)

</details>


## T-344

**Clicking an @page mention in a chat message opens Docs with 'No page selected' instead of the page**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner K1+A3 · wave W2 · scope frontend · estimate S
- Findings: Q8-019 · known ref K22

**Summary.** Docs opens on the empty state 'No page selected — Select a page from the sidebar or create a new one.'; the page is listed but not selected. (Design mention chips correctly open the design in Designer.)

**Root cause.** `src/modules/knowledge/frontend/Space.tsx:12` — KnowledgeSpaceInner ignores ModuleSpaceProps.params; selectedPageId initialised to null

**Proposed fix.** Docs Space reads pageId nav param; mention click passes it. — Detail: In knowledge/frontend/Space.tsx read params?.pageId and setSelectedPageId(pageId) in an effect keyed on it (also expand/scroll the tree to it).

**Evidence.** [014-page-mention-no-page-selected](../evidence/shots/vq8/dark/014-page-mention-no-page-selected.png)

<details><summary>Q8-019 — Clicking an @page mention in a chat message opens Docs with 'No page selected' instead of the page (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Assistant → composer '@QA-q9-mention' → pick 'QA-q9-mention-target' (pageId 5bec1891…, from q9 handoff) → 'Summarize this page in one sentence.' → Enter
  2. Click the '@ QA-q9-mention-target' chip in the sent user bubble
- Expected: Docs opens with QA-q9-mention-target selected in the tree and the editor showing it (design mentions do open the design).
- Actual: Docs opens on the empty state 'No page selected — Select a page from the sidebar or create a new one.'; the page is listed but not selected. (Design mention chips correctly open the design in Designer.)
- Screenshots: [014-page-mention-no-page-selected](../evidence/shots/vq8/dark/014-page-mention-no-page-selected.png), [040-page-mention-click](../evidence/shots/q8/dark/040-page-mention-click.png), [041-design-mention-click](../evidence/shots/q8/dark/041-design-mention-click.png)
- Code: `src/modules/knowledge/frontend/Space.tsx:12` — KnowledgeSpaceInner ignores ModuleSpaceProps.params; selectedPageId initialised to null
- Code: `src/modules/assistant/frontend/Space.tsx:84` — navigateToModule('knowledge', undefined, { pageId }) - already correct
- Suggested fix: In knowledge/frontend/Space.tsx read params?.pageId and setSelectedPageId(pageId) in an effect keyed on it (also expand/scroll the tree to it).
- Verification (vq8): **confirmed** — Reproduced: clicking '@ QA-q9-mention-target' chip in QA-q8-main opens Docs with 'No page selected' although the page (5bec1891, GET 200) is listed. Correction of root cause: assistant navigateFromMention already passes params {pageId} (Space.tsx:84-86); the knowledge Space ignores params entirely (knowledge/frontend/Space.tsx:12-17 destructures only backendURL/moduleId/designId; selectedPageId starts null). Matches K22. S3 kept. · evidence: [014-page-mention-no-page-selected](../evidence/shots/vq8/dark/014-page-mention-no-page-selected.png)

</details>


## T-345

**Composer shows raw mention markup '@[design:<uuid>\|Name]' after picking a mention (and exports it verbatim)**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner A2 · wave W3 · scope frontend · estimate M
- Findings: Q8-020

**Summary.** Textarea contains '@[design:a557d3b5-92c4-4caa-b79c-594f1382ac82|S3 LLM Smoke — 5 LED (DeepSeek V4 Flash)] ' with the UUID spell-check underlined; backspace edits the markup piecemeal. Exported QA-q8-main.md contains the same raw markup and omits every tool call / proposal outcome (only prose).

**Root cause.** `src/modules/assistant/frontend/components/ChatComposer.tsx:134` — inserts createMentionSyntax() text into a plain <textarea>

**Proposed fix.** Composer renders mention chips (not raw @[design:uuid|Name] markup). — Detail: Use a contenteditable/tiptap mini-editor with mention nodes (the Docs editor already has one), or overlay-highlight + atomic deletion; run stripMentions() in exportMarkdown and include tool/proposal summaries.

**Evidence.** [016-composer-raw-mention](../evidence/shots/vq8/dark/016-composer-raw-mention.png)

<details><summary>Q8-020 — Composer shows raw mention markup '@[design:<uuid>\|Name]' after picking a mention (and exports it verbatim) (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Assistant composer → type '@S3' → pick 'S3 LLM Smoke — 5 LED (DeepSeek V4 Flash)'
  2. Look at the textarea; later Chat actions → Export markdown
- Expected: Mention rendered as an atomic chip in the composer (as it is in the sent bubble); export writes '@S3 LLM Smoke…'.
- Actual: Textarea contains '@[design:a557d3b5-92c4-4caa-b79c-594f1382ac82|S3 LLM Smoke — 5 LED (DeepSeek V4 Flash)] ' with the UUID spell-check underlined; backspace edits the markup piecemeal. Exported QA-q8-main.md contains the same raw markup and omits every tool call / proposal outcome (only prose).
- Screenshots: [016-composer-raw-mention](../evidence/shots/vq8/dark/016-composer-raw-mention.png), [008-composer-raw-mention-syntax](../evidence/shots/q8/dark/008-composer-raw-mention-syntax.png)
- Code: `src/modules/assistant/frontend/components/ChatComposer.tsx:134` — inserts createMentionSyntax() text into a plain <textarea>
- Code: `src/modules/assistant/frontend/Space.tsx:1114` — exportMarkdown writes message.content verbatim
- Suggested fix: Use a contenteditable/tiptap mini-editor with mention nodes (the Docs editor already has one), or overlay-highlight + atomic deletion; run stripMentions() in exportMarkdown and include tool/proposal summaries.
- Verification (vq8): **confirmed** — Reproduced: '@S3' -> pick 'S3 LLM Smoke — 5 LED (DeepSeek V4 Flash) Revision 48' -> textarea value '@[design:a557d3b5-92c4-4caa-b79c-594f1382ac82|S3 LLM Smoke — 5 LED (DeepSeek V4 Flash)] '. exportMarkdown (Space.tsx:1114-1128) writes message.content verbatim and skips tool/internal messages. S3 kept. · evidence: [016-composer-raw-mention](../evidence/shots/vq8/dark/016-composer-raw-mention.png)

</details>


## T-346

**Slash quick-actions menu is mouse-only; Enter on '/' sends a literal '/' message to the LLM**

- Severity **S3** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner A2 · wave W3 · scope frontend · estimate S
- Findings: Q8-021

**Summary.** No keyboard selection; Enter runs onSubmit with content '/' (handleKey only special-cases the mention list). Popover has no listbox/option roles. (Enter-send not executed to save LLM budget; verified in code.)

**Root cause.** `src/modules/assistant/frontend/components/ChatComposer.tsx:210` — Enter submits whenever value.trim() — slashOpen not considered

**Proposed fix.** Slash menu keyboard navigable; Enter picks action, never sends bare '/'. — Detail: Track slashIndex like mentionIndex; ArrowUp/Down/Enter/Tab select when slashOpen; block submit of a bare '/'; add role=listbox/option + aria-activedescendant.

**Evidence.** [017-slash-menu](../evidence/shots/vq8/dark/017-slash-menu.png)

<details><summary>Q8-021 — Slash quick-actions menu is mouse-only; Enter on '/' sends a literal '/' message to the LLM (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Assistant composer → type '/' → 'Quick actions' popover (Wire the schematic / Resolve BOM / Run ERC / Suggest improvements)
  2. Press ArrowDown (focus stays in textarea, nothing highlighted); press Enter
- Expected: Arrow keys move a highlighted item, Enter/Tab picks it (like the @ mention list); '/' alone is never sent.
- Actual: No keyboard selection; Enter runs onSubmit with content '/' (handleKey only special-cases the mention list). Popover has no listbox/option roles. (Enter-send not executed to save LLM budget; verified in code.)
- Screenshots: [017-slash-menu](../evidence/shots/vq8/dark/017-slash-menu.png), [005-slash-menu](../evidence/shots/q8/dark/005-slash-menu.png)
- Network: `POST /api/modules/assistant/chats/b5bf7167…/messages body {"content":"/",…} (intercepted with 500)`
- Code: `src/modules/assistant/frontend/components/ChatComposer.tsx:210` — Enter submits whenever value.trim() — slashOpen not considered
- Code: `src/modules/assistant/frontend/components/ChatComposer.tsx:243` — quick-actions popover: plain buttons, no roles
- Suggested fix: Track slashIndex like mentionIndex; ArrowUp/Down/Enter/Tab select when slashOpen; block submit of a bare '/'; add role=listbox/option + aria-activedescendant.
- Verification (vq8): **confirmed** — Reproduced without spending LLM budget (POST routed to 500 + fetch spy): type '/' -> Quick actions popover open, ArrowDown keeps focus in textarea with no highlighted item, no listbox/option roles; Enter -> POST /messages body {content:'/', …}. ChatComposer.tsx:209-217 submits whenever value.trim(); only the mention list is keyboard-handled. S3 kept. · evidence: [017-slash-menu](../evidence/shots/vq8/dark/017-slash-menu.png)

</details>


## T-347

**@-mention autocomplete uses emoji icons (🛠️ 🔌 📄), no group headers or listbox semantics; duplicate-named designs indistinguishable**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner A2 · wave W3 · scope frontend · estimate S
- Findings: Q8-022

**Summary.** Rows prefixed with emoji glyphs; flat mixed list; a11y tree has no listbox/option (screen readers get nothing while arrowing). Two designs both named 'S3 LLM Smoke — 5 LED (DeepSeek V4 Flash)' differ only by 'Revision 45' vs 'Revision 0'.

**Root cause.** `src/modules/assistant/frontend/components/MentionAutocomplete.tsx:133` — emoji icon span

**Proposed fix.** Mention autocomplete: Lucide icons, group headers, listbox semantics, disambiguate duplicates. — Detail: Map entity types to Lucide icons (CircuitBoard, Cpu, FileText); add section headers + role=listbox/option/aria-selected; show short id or updated date as secondary text.

**Evidence.** [015-mention-autocomplete](../evidence/shots/vq8/dark/015-mention-autocomplete.png)

<details><summary>Q8-022 — @-mention autocomplete uses emoji icons (🛠️ 🔌 📄), no group headers or listbox semantics; duplicate-named designs indistinguishable (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Assistant composer → type '@' then '@S3' then '@QA-q9'
- Expected: Lucide icons consistent with the rest of the app, grouped sections (Designs / Components / Pages), role=listbox/option with aria-activedescendant; disambiguating detail for same-named designs (id/modified date).
- Actual: Rows prefixed with emoji glyphs; flat mixed list; a11y tree has no listbox/option (screen readers get nothing while arrowing). Two designs both named 'S3 LLM Smoke — 5 LED (DeepSeek V4 Flash)' differ only by 'Revision 45' vs 'Revision 0'.
- Screenshots: [015-mention-autocomplete](../evidence/shots/vq8/dark/015-mention-autocomplete.png), [006-mention-at-empty](../evidence/shots/q8/dark/006-mention-at-empty.png), [007-mention-design-list](../evidence/shots/q8/dark/007-mention-design-list.png), [039-mention-page](../evidence/shots/q8/dark/039-mention-page.png)
- Code: `src/modules/assistant/frontend/components/MentionAutocomplete.tsx:133` — emoji icon span
- Code: `src/modules/assistant/frontend/components/MentionAutocomplete.tsx:116` — no role attributes
- Suggested fix: Map entity types to Lucide icons (CircuitBoard, Cpu, FileText); add section headers + role=listbox/option/aria-selected; show short id or updated date as secondary text.
- Verification (vq8): **confirmed** — Reproduced: '@S3' list rows are buttons prefixed with '🛠️' emoji, no listbox/option roles; two rows 'S3 LLM Smoke — 5 LED (DeepSeek V4 Flash)' differ only by 'Revision 48' vs 'Revision 0'. S3 kept. · evidence: [015-mention-autocomplete](../evidence/shots/vq8/dark/015-mention-autocomplete.png)

</details>


## T-348

**Assistant space/dock is not on the redesign kit: raw sky/amber/red/emerald palette, shadow-xl + gradient composer, 56px header, 10px bubble radii, hand-rolled menus**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A1+A2+A3 · wave W3 · scope frontend · estimate L
- Findings: Q8-026 · known ref K45
- Depends on: ['T-004']

**Summary.** Proposal cards: sky border #034569 (ΔE 25 off-token) / Apply button sky-600 #0084d1 (ΔE 22.7); risk badges raw amber #736020 (ΔE 36) and red #91575c; 'Assistant task cancelled.' banner brown/amber #180f0a with #cdc39e text; pill status dot emerald-500 #00bc7d with glow. Composer floats with shadow-xl + bg-gradient-to-t fade; chat header h-14 (56px) vs 34px shell headers; chat rows are 70px cards (rounded-lg borders)…

**Root cause.** `src/modules/assistant/frontend/components/GenericProposalCard.tsx:231` — sky/amber/red/emerald classes

**Proposed fix.** Assistant space/dock/cards to kit + tokens (34px header, kit SearchField, no shadow/gradient, 2px radii, status tokens). — Detail: Migrate AST components to kit tokens: status badges → kit Chip with --status-*-soft; primary action → kit Button; card borders → --border; header → 34px PanelHeader; DropdownMenu for row/thread menus; remove shadow/gradient; radius-control everywhere.

**Evidence.** [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png)

<details><summary>Q8-026 — Assistant space/dock is not on the redesign kit: raw sky/amber/red/emerald palette, shadow-xl + gradient composer, 56px header, 10px bubble radii, hand-rolled menus (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Open Assistant space; open a chat with proposals ('edge unbound v2', QA-q8-main); open the dock in Designer
  2. Probe proposal card, Apply button, badges, cancel banner; measure header
- Expected: Same flat neutral tokens as redesigned screens: --surface-*/--border, --status-* for badges, 34px header, 22px rows/controls, 2px radii, no shadows/gradients, kit DropdownMenu/Dialog.
- Actual: Proposal cards: sky border #034569 (ΔE 25 off-token) / Apply button sky-600 #0084d1 (ΔE 22.7); risk badges raw amber #736020 (ΔE 36) and red #91575c; 'Assistant task cancelled.' banner brown/amber #180f0a with #cdc39e text; pill status dot emerald-500 #00bc7d with glow. Composer floats with shadow-xl + bg-gradient-to-t fade; chat header h-14 (56px) vs 34px shell headers; chat rows are 70px cards (rounded-lg borders) not 22px rows; user bubble radius 10px; row context menu and dock thread menu hand-rolled divs (no role=menu, no keyboard); native checkbox 13px in chat rows; 66 raw palette/shadow/gradient class uses across AST components. Light theme: proposal border sky-300 #74d4ff (ΔE 25.6), bg #f1f8fe, disabled Apply #79bee8, MEDIUM badge #e0b691 (ΔE 25.3).
- Screenshots: [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png), [005-proposal-light](../evidence/shots/vq8/light/005-proposal-light.png), [006-row-actions-menu](../evidence/shots/vq8/dark/006-row-actions-menu.png), [001-assistant-initial](../evidence/shots/q8/dark/001-assistant-initial.png), [013-prompt2-proposal](../evidence/shots/q8/dark/013-prompt2-proposal.png), [032-after-stop](../evidence/shots/q8/dark/032-after-stop.png), [025-row-actions-menu](../evidence/shots/q8/dark/025-row-actions-menu.png), [049-dock-thread-menu](../evidence/shots/q8/dark/049-dock-thread-menu.png), [005-proposal-light](../evidence/shots/q8/light/005-proposal-light.png), [006-model-pill-light](../evidence/shots/q8/light/006-model-pill-light.png), [007-row-menu-light](../evidence/shots/q8/light/007-row-menu-light.png)
- Pixel probes: {"file": "shots/vq8/dark/021-resolved-proposal-cards.png", "x": 464, "y": 400, "hex": "#034569", "nearestToken": "--surface-control", "deltaE": 25.3}; {"file": "shots/vq8/dark/021-resolved-proposal-cards.png", "x": 481, "y": 470, "hex": "#064d77", "nearestToken": "--text-disabled", "deltaE": 27.4}; {"file": "shots/vq8/light/005-proposal-light.png", "x": 464, "y": 400, "hex": "#74d4ff", "nearestToken": "--selection", "deltaE": 25.6}; {"file": "shots/vq8/light/005-proposal-light.png", "x": 481, "y": 470, "hex": "#79bee8", "nearestToken": "--selection", "deltaE": 20.8}; {"file": "shots/q8/dark/001-assistant-initial.png", "x": 498, "y": 658, "hex": "#0084d1", "nearestToken": "--status-info", "deltaE": 22.7}; {"file": "shots/q8/dark/013-prompt2-proposal.png", "x": 1415, "y": 600, "hex": "#034569", "nearestToken": "--surface-control", "deltaE": 25.3}; {"file": "shots/q8/dark/013-prompt2-proposal.png", "x": 694, "y": 502, "hex": "#736020", "nearestToken": "--status-warning", "deltaE": 36.2}; {"file": "shots/q8/dark/001-assistant-initial.png", "x": 590, "y": 227, "hex": "#91575c", "nearestToken": "--text-caps", "deltaE": 25.7}; {"file": "shots/q8/dark/032-after-stop.png", "x": 566, "y": 655, "hex": "#cdc39e", "nearestToken": "--text", "deltaE": 21.6}; {"file": "shots/q8/light/005-proposal-light.png", "x": 1415, "y": 560, "hex": "#74d4ff", "nearestToken": "--selection", "deltaE": 25.6}; {"file": "shots/q8/light/005-proposal-light.png", "x": 694, "y": 478, "hex": "#e0b691", "nearestToken": "--status-warning-soft@app", "deltaE": 25.3}
- Census: `census/assistant-space-dark-1440.json`
- Code: `src/modules/assistant/frontend/components/GenericProposalCard.tsx:231` — sky/amber/red/emerald classes
- Code: `src/modules/assistant/frontend/Space.tsx:1373` — h-14 header
- Code: `src/modules/assistant/frontend/Space.tsx:1730` — gradient fade + shadow-xl composer
- Code: `src/modules/assistant/frontend/components/MessageCard.tsx:383` — rounded-[10px_10px_2px_10px] bubble
- Code: `src/modules/assistant/frontend/Space.tsx:1782` — hand-rolled context menu
- Suggested fix: Migrate AST components to kit tokens: status badges → kit Chip with --status-*-soft; primary action → kit Button; card borders → --border; header → 34px PanelHeader; DropdownMenu for row/thread menus; remove shadow/gradient; radius-control everywhere.
- Verification (vq8): **confirmed** — Re-probed: dark proposal card border #034569 (dE 25.3), disabled Apply #064d77 (sky-600 @50%), card bg #0a151d; light card border #74d4ff (dE 25.6), bg #f1f8fe, disabled Apply #79bee8 (dE 20.8). Chat header computed height 56px (Space.tsx:1373 h-14); row actions menu is a hand-rolled div (no role=menu, Esc does not close it). Consistent with PLAN §0 (Assistant = token re-skin only) and §9 follow-up 'migrate remaining files … (Assistant…)' - a documented stopgap, but the sky/amber/red/emerald classes are NOT covered by the D1 remap so they render off-token. Matches K45. S3 kept. · evidence: [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png), [005-proposal-light](../evidence/shots/vq8/light/005-proposal-light.png), [006-row-actions-menu](../evidence/shots/vq8/dark/006-row-actions-menu.png)

</details>


## T-349

**Light theme: composer hint row, footer meta and kbd hints are ~1.5–2.7:1 contrast (10px text)**

- Severity **S3** · category a11y · status confirmed · themes light
- Recommendation **fix-now** · owner A2 · wave W3 · scope frontend · estimate XS
- Findings: Q8-028

**Summary.** Darkest hint-glyph pixel #9a9a9e on #fafafb = 2.69:1; kbd label #b1b1b6 on #d8d8db = 1.5:1; placeholder #a8a8ad on white = 2.37:1. Dark theme is fine.

**Root cause.** `src/modules/assistant/frontend/components/ChatComposer.tsx:264` — text-[10px] text-slate-400 hint row; kbd bg-slate-200

**Proposed fix.** Composer hints/footer text-tertiary (≥4.5:1) and kbd token. — Detail: Use text-text-tertiary (≥4.5:1 on panel) for hint/footer text and a bordered kbd token instead of slate-200 fill.

**Evidence.** [004-composer-contrast](../evidence/shots/vq8/light/004-composer-contrast.png)

<details><summary>Q8-028 — Light theme: composer hint row, footer meta and kbd hints are ~1.5–2.7:1 contrast (10px text) (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes light · viewports 1440x900
- Repro:
  1. Light theme → Assistant → look at the composer: 'Type / for commands · Type @ …', footer '15 tools · 64k context', '⏎ send ⇧⏎ newline'; placeholder
- Expected: ≥4.5:1 for 10–11px text (use --text-secondary/--text-tertiary on --surface-panel).
- Actual: Darkest hint-glyph pixel #9a9a9e on #fafafb = 2.69:1; kbd label #b1b1b6 on #d8d8db = 1.5:1; placeholder #a8a8ad on white = 2.37:1. Dark theme is fine.
- Screenshots: [004-composer-contrast](../evidence/shots/vq8/light/004-composer-contrast.png), [001-assistant-space](../evidence/shots/q8/light/001-assistant-space.png)
- Pixel probes: {"file": "shots/q8/light/001-assistant-space.png", "x": 460, "y": 780, "hex": "#9a9a9e", "nearestToken": "--text-disabled", "deltaE": 5.4}; {"file": "shots/q8/light/001-assistant-space.png", "x": 1329, "y": 851, "hex": "#b1b1b6", "nearestToken": "--text-disabled", "deltaE": 3.4}; {"file": "shots/q8/light/001-assistant-space.png", "x": 454, "y": 816, "hex": "#a8a8ad", "nearestToken": "--text-disabled", "deltaE": 0.5}
- Code: `src/modules/assistant/frontend/components/ChatComposer.tsx:264` — text-[10px] text-slate-400 hint row; kbd bg-slate-200
- Suggested fix: Use text-text-tertiary (≥4.5:1 on panel) for hint/footer text and a bordered kbd token instead of slate-200 fill.
- Verification (vq8): **confirmed** — Re-measured light (computed colours): composer hint row 10px #a8a8ad on ~#fafafb = 2.27:1; kbd '⏎' #a8a8ad on #dcdce0 = 1.73:1; placeholder #a8a8ad on #ffffff = 2.37:1 (all < 4.5:1). Footer '15 tools · 64k context' meta at #7f7f84 = 3.98:1. ChatComposer.tsx:264-282 text-slate-400 + bg-slate-200 (remapped neutral-400/200). Dark theme fine. S3 kept. · evidence: [004-composer-contrast](../evidence/shots/vq8/light/004-composer-contrast.png)

</details>


## T-350

**Chat list rows trap keyboard: nested checkbox and '…' button can't be activated (row keydown swallows Enter/Space) and the '…' button stays invisible when focused**

- Severity **S3** · category keyboard · status confirmed · themes light
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate XS
- Findings: Q8-030

**Summary.** Checkbox stays unchecked after Space; Enter on the actions button opens nothing (the parent role=button row handles Enter/Space with preventDefault and just selects the chat). The focused actions button has computed opacity 0 (group-hover only). Interactive controls are nested inside a role=button element (invalid ARIA nesting).

**Root cause.** `src/modules/assistant/frontend/Space.tsx:1267` — row onKeyDown Enter/Space → preventDefault + select, fires for nested controls

**Proposed fix.** Row keydown doesn't swallow Enter/Space from nested checkbox/menu; actions visible on focus. — Detail: In the row onKeyDown ignore events whose target !== currentTarget; add focus-visible:opacity-100 to the actions button; restructure row as a listitem containing a real <button> for 'open' plus sibling checkbox/menu button.

**Evidence.** [018-focused-row-actions-invisible](../evidence/shots/vq8/dark/018-focused-row-actions-invisible.png)

<details><summary>Q8-030 — Chat list rows trap keyboard: nested checkbox and '…' button can't be activated (row keydown swallows Enter/Space) and the '…' button stays invisible when focused (S3, confirmed)</summary>

- Area assistant.space · stack A · design None · themes light · viewports 1440x900
- Repro:
  1. Assistant → click 'Search chats' → Tab to 'Select QA-q8-main' checkbox → press Space
  2. Tab to 'Chat actions for QA-q8-main' → press Enter
- Expected: Space toggles the checkbox; Enter opens the row menu; focused '…' button visible (focus-visible:opacity-100).
- Actual: Checkbox stays unchecked after Space; Enter on the actions button opens nothing (the parent role=button row handles Enter/Space with preventDefault and just selects the chat). The focused actions button has computed opacity 0 (group-hover only). Interactive controls are nested inside a role=button element (invalid ARIA nesting).
- Screenshots: [018-focused-row-actions-invisible](../evidence/shots/vq8/dark/018-focused-row-actions-invisible.png), [016-focused-row-actions-invisible](../evidence/shots/q8/light/016-focused-row-actions-invisible.png)
- Console: `activeElement 'Chat actions for QA-q8-main' opacity=0`; `after Space: 'Select QA-q8-main' checked=false`
- Code: `src/modules/assistant/frontend/Space.tsx:1267` — row onKeyDown Enter/Space → preventDefault + select, fires for nested controls
- Code: `src/modules/assistant/frontend/Space.tsx:1328` — opacity-0 group-hover:opacity-100 only
- Suggested fix: In the row onKeyDown ignore events whose target !== currentTarget; add focus-visible:opacity-100 to the actions button; restructure row as a listitem containing a real <button> for 'open' plus sibling checkbox/menu button.
- Verification (vq8): **confirmed** — Reproduced: Tab from Search chats to 'Chat actions for QA-q8-retry' -> computed opacity 0 (visible outline style only, element invisible); Enter -> no menu, the row just gets selected (header 'QA-q8-retry'); Shift+Tab to 'Select QA-q8-retry' checkbox, Space -> checked stays false. Row role=button onKeyDown (Space.tsx:1267) preventDefaults Enter/Space for nested targets. Not a trap (Tab moves on) -> S3 kept. · evidence: [018-focused-row-actions-invisible](../evidence/shots/vq8/dark/018-focused-row-actions-invisible.png)

</details>


## T-351

**Proposal cards: applied/rejected cards keep disabled Apply/Reject/Allow buttons and no Undo; operations show raw nanometres and deletions don't name the part**

- Severity **S3** · category copy · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A3 · wave W3 · scope frontend · estimate S
- Findings: Q8-032

**Summary.** APPLIED / REJECTED cards still render three greyed buttons (Apply, Reject, 'Allow this tool this session') with no Undo affordance even though edits are 'undoable'. Operation text 'Place Resistor at 110000000, 0 nm.' shows raw nm. Destructive rows read only 'Delete part — User requested deletion' (no reference/value), so the user approves a deletion without seeing what is deleted except in the LLM-written title. Fee…

**Root cause.** `src/modules/assistant/frontend/components/GenericProposalCard.tsx:328` — buttons always rendered, only disabled

**Proposed fix.** Applied/rejected cards collapse to status + Undo; human units (mm) and named deletions. — Detail: Hide action row once status≠pending and show 'Applied · Undo' (dispatch designer undo) / 'Rejected'; format positions via nm→mm helper; include ref/value in delete op titles ('Delete R6 (10k)').

**Evidence.** [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png)

<details><summary>Q8-032 — Proposal cards: applied/rejected cards keep disabled Apply/Reject/Allow buttons and no Undo; operations show raw nanometres and deletions don't name the part (S3, confirmed)</summary>

- Area assistant.space · stack A · design a557d3b5 · themes dark, light · viewports 1440x900
- Repro:
  1. QA-q8-main: 'Add a 10k resistor R99…' (auto-applied) and 'Delete resistor R6…' (pending → Reject; second one → Apply)
  2. Read the cards
- Expected: Resolved cards collapse to a status line ('Applied · Undo' / 'Rejected'); coordinates in mm; delete rows name the target (R6).
- Actual: APPLIED / REJECTED cards still render three greyed buttons (Apply, Reject, 'Allow this tool this session') with no Undo affordance even though edits are 'undoable'. Operation text 'Place Resistor at 110000000, 0 nm.' shows raw nm. Destructive rows read only 'Delete part — User requested deletion' (no reference/value), so the user approves a deletion without seeing what is deleted except in the LLM-written title. Feedback after Apply is a tiny 'Applied 1 schematic operation(s).' line.
- Screenshots: [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png), [005-proposal-light](../evidence/shots/vq8/light/005-proposal-light.png), [013-prompt2-proposal](../evidence/shots/q8/dark/013-prompt2-proposal.png), [014-prompt3-delete-pending](../evidence/shots/q8/dark/014-prompt3-delete-pending.png), [015-after-reject](../evidence/shots/q8/dark/015-after-reject.png), [016-after-apply](../evidence/shots/q8/dark/016-after-apply.png), [005-proposal-light](../evidence/shots/q8/light/005-proposal-light.png)
- Code: `src/modules/assistant/frontend/components/GenericProposalCard.tsx:328` — buttons always rendered, only disabled
- Code: `src/modules/assistant/backend/tools/designer-tools.ts:3275` — deletion op summary lacks part reference
- Suggested fix: Hide action row once status≠pending and show 'Applied · Undo' (dispatch designer undo) / 'Rejected'; format positions via nm→mm helper; include ref/value in delete op titles ('Delete R6 (10k)').
- Verification (vq8): **confirmed** — Reproduced in QA-q8-main: all 3 resolved cards (APPLIED/REJECTED/APPLIED) still render Apply/Reject/'Allow this tool this session' (all disabled), no Undo; operation text 'Place Resistor at 110000000, 0 nm.'; delete rows read only 'Delete part' / 'User requested deletion'. GenericProposalCard.tsx:320-346 always renders the action row; designer-tools.ts:3271-3274 delete op title/summary lack reference/value. S3 kept. · evidence: [021-resolved-proposal-cards](../evidence/shots/vq8/dark/021-resolved-proposal-cards.png), [005-proposal-light](../evidence/shots/vq8/light/005-proposal-light.png)

</details>


## T-352

**Assistant header gives the chat title the least room: at 1100px only ~12 chars show while the linked-design chip, tools badge and model pill keep full width**

- Severity **S4** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A1 · wave W3 · scope frontend · estimate XS
- Findings: F1D-009

**Summary.** The header reads 'F1D long thre…' (~85 px) while the linked-design chip keeps 140 px, the '15 tools' badge ~70 px and the model pill ~230 px. The title button's title attribute is 'Rename chat', not the chat name, so the full title can't be seen.

**Root cause.** `src/modules/assistant/frontend/Space.tsx:1425` — title button (title='Rename chat') + shrink-0 linked chip/tools badge/pill

**Proposed fix.** Header: title gets flex priority; chips/badges truncate first. — Detail: Assistant Space.tsx:1419-1447 (title button :1422, chip :1436-1446): set title={selectedChat?.title} on the title button (move 'Rename chat' to aria-label/hover pencil), give the title span flex-1 priority, drop shrink-0 on the linked-design chip (:1437, title 'Open linked design' at :1440) and allow it to collapse to its Link2 icon below ~1200 px (container query or max-w-[40px] with tooltip); collapse the tools badge to the icon+count only.

**Evidence.** [038-asst200-1100](../evidence/shots/f1d/dark/038-asst200-1100.png), [022-asst-header-1100](../evidence/shots/vf1d/dark/022-asst-header-1100.png)

<details><summary>F1D-009 — Assistant header gives the chat title the least room: at 1100px only ~12 chars show while the linked-design chip, tools badge and model pill keep full width (S4, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1100x720
- Repro:
  1. In-page mock: chat with a 120-char title linked to a design with a long name
  2. Resize to 1100x720 and open the chat
- Expected: The title keeps priority: chips shrink or collapse to icons first, and the full title is available as a tooltip.
- Actual: The header reads 'F1D long thre…' (~85 px) while the linked-design chip keeps 140 px, the '15 tools' badge ~70 px and the model pill ~230 px. The title button's title attribute is 'Rename chat', not the chat name, so the full title can't be seen.
- Screenshots: [038-asst200-1100](../evidence/shots/f1d/dark/038-asst200-1100.png), [133-asst200-1100](../evidence/shots/f1d/light/133-asst200-1100.png), [022-asst-header-1100](../evidence/shots/vf1d/dark/022-asst-header-1100.png)
- Code: `src/modules/assistant/frontend/Space.tsx:1425` — title button (title='Rename chat') + shrink-0 linked chip/tools badge/pill
- Suggested fix: Assistant Space.tsx:1419-1447 (title button :1422, chip :1436-1446): set title={selectedChat?.title} on the title button (move 'Rename chat' to aria-label/hover pencil), give the title span flex-1 priority, drop shrink-0 on the linked-design chip (:1437, title 'Open linked design' at :1440) and allow it to collapse to its Link2 icon below ~1200 px (container query or max-w-[40px] with tooltip); collapse the tools badge to the icon+count only.
- Verification (vf1d): **confirmed** — Reproduced at 1100×720 with the chat mock: title button 106 px ('F1D long thre…') while the linked-design chip is 174 px (span capped at 140), the tools badge 76 px and the model pill ~230 px; the title button's title attribute is 'Rename chat', so the full chat name is not available on hover. S4 kept. · evidence: [022-asst-header-1100](../evidence/shots/vf1d/dark/022-asst-header-1100.png)

</details>


## T-353

**Inline HTML from the model (e.g. V<sub>F</sub>) is shown as literal tags in chat tables/lists**

- Severity **S4** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A3 · wave W3 · scope frontend · estimate XS
- Findings: Q8-012

**Summary.** Cells read 'V<sub>F</sub> = 2 V, I = 10 mA'; list item 'Forward voltage V<sub>F</sub> = 2 V'.

**Root cause.** `src/shared/frontend/markdown/MarkdownContent.tsx:1` — react-markdown without rehype-sanitize allow-list for sub/sup

**Proposed fix.** Allow safe inline HTML subset (sub/sup/br) via rehype-sanitize. — Detail: Enable rehype-raw + rehype-sanitize with an allow-list of sub/sup/br/kbd, or strip tags; also tell the prompt to use Unicode subscripts.

**Evidence.** [012-raw-sub-and-glued](../evidence/shots/vq8/dark/012-raw-sub-and-glued.png)

<details><summary>Q8-012 — Inline HTML from the model (e.g. V<sub>F</sub>) is shown as literal tags in chat tables/lists (S4, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Assistant → chat 'edge unbound v2' → 'Schematic: 2 LED Indicators on 5V' table and 'Assumptions made' list
- Expected: Subscript rendered (safe allow-list for sub/sup) or stripped to 'VF'.
- Actual: Cells read 'V<sub>F</sub> = 2 V, I = 10 mA'; list item 'Forward voltage V<sub>F</sub> = 2 V'.
- Screenshots: [012-raw-sub-and-glued](../evidence/shots/vq8/dark/012-raw-sub-and-glued.png), [023-concatenated-iterations-and-raw-sub](../evidence/shots/q8/dark/023-concatenated-iterations-and-raw-sub.png)
- Code: `src/shared/frontend/markdown/MarkdownContent.tsx:1` — react-markdown without rehype-sanitize allow-list for sub/sup
- Suggested fix: Enable rehype-raw + rehype-sanitize with an allow-list of sub/sup/br/kbd, or strip tags; also tell the prompt to use Unicode subscripts.
- Verification (vq8): **confirmed** — Reproduced on 'edge unbound v2': table cells and list item read literally 'V<sub>F</sub> = 2 V, I = 10 mA' / 'Forward voltage V<sub>F</sub> = 2 V'. MarkdownContent.tsx:162 uses remark-gfm only (raw HTML escaped - safe, but ugly). The prompt forbids HTML, so partly model non-compliance; stripping/allow-listing sub/sup is the cheap fix. S4 kept. · evidence: [012-raw-sub-and-glued](../evidence/shots/vq8/dark/012-raw-sub-and-glued.png)

</details>


## T-354

**Chats are never auto-titled and 'New' immediately persists an empty 'New chat' row (list fills with identical 'New chat' entries)**

- Severity **S4** · category copy · status confirmed · themes dark, light
- Recommendation **defer** · owner A1 · wave followup · scope backend · estimate S
- Findings: Q8-033

**Summary.** Title stays 'New chat' after messages (QA-q8-main needed a manual rename); each New click creates a server-side chat, so the list already contains three untouched 'New chat' rows from earlier sessions that are indistinguishable.

**Root cause.** `src/modules/assistant/frontend/Space.tsx:828` — createChat POSTs immediately

**Proposed fix.** Lazy-create chat on first send; auto-title from first message (backend). — Detail: Set title from the first user message (trim to ~48 chars) server-side on first submit; lazily create the chat on first send or reuse an existing empty chat.

**Evidence.** [002-new-chat-aion](../evidence/shots/vq8/dark/002-new-chat-aion.png)

<details><summary>Q8-033 — Chats are never auto-titled and 'New' immediately persists an empty 'New chat' row (list fills with identical 'New chat' entries) (S4, confirmed)</summary>

- Area assistant.space · stack A · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Assistant → New → send a message; observe the row title
  2. Click New several times without sending
- Expected: Title derived from the first prompt (or a short LLM summary); an empty chat is not persisted until the first message (or is reused).
- Actual: Title stays 'New chat' after messages (QA-q8-main needed a manual rename); each New click creates a server-side chat, so the list already contains three untouched 'New chat' rows from earlier sessions that are indistinguishable.
- Screenshots: [002-new-chat-aion](../evidence/shots/vq8/dark/002-new-chat-aion.png), [010-prompt1-done](../evidence/shots/q8/dark/010-prompt1-done.png), [001-assistant-initial](../evidence/shots/q8/dark/001-assistant-initial.png)
- Code: `src/modules/assistant/frontend/Space.tsx:828` — createChat POSTs immediately
- Suggested fix: Set title from the first user message (trim to ~48 chars) server-side on first submit; lazily create the chat on first send or reuse an existing empty chat.
- Verification (vq8): **confirmed** — Reproduced: New immediately POSTs a chat (8108e99e 'New chat' persisted before any message; deleted afterwards); list still holds 3 untouched 'New chat' rows. No auto-title logic exists (assistant-service.ts:141 title ?? 'New chat'; no title derivation on submit). S4 kept. · evidence: [002-new-chat-aion](../evidence/shots/vq8/dark/002-new-chat-aion.png)

</details>

