# assistant.dock — QA findings

[← index](../README.md) · 5 triage entries · S1 0 · S2 3 · S3 2 · S4 0

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-355](#t-355) | S2 | A hung local provider blocks the chat: provider calls have no timeout, and once the dock remounts mid-run (close/reopen or reload) a second send orphans the running task (it loses its Stop) while later messages queue behind it as a fake 'Working…' | F2C-002 | decide (DEC-A) | A2 / W3 | backend | M |
| [T-356](#t-356) | S2 | Dock run state wrong: 'Working…' forever on paused runs; after reload no Stop; empty answers show nothing | Q10-016, Q8-024 | fix-now | A2 / W3 | frontend | S |
| [T-357](#t-357) | S2 | Dock thread menu uses native window.prompt (Rename) and window.confirm (Delete) | Q8-035 | fix-now | A2 / W3 | frontend | S |
| [T-358](#t-358) | S3 | Dock header row overflows at the default dock width: with a local model name the tools badge is cut off at the window edge and the 'just now' timestamp is pushed out of view | F2C-011 | fix-now | A2 / W3 | frontend | XS |
| [T-359](#t-359) | S3 | Dock chrome polish: composer hint row wraps into a cramped 3-line block, thread-menu Rename/Delete are 10px/15px-tall text links, preset list shows raw ids, 'Close chat' hides the whole side panel | Q8-025 | fix-now | A2 / W3 | frontend | S |

## T-355

**A hung local provider blocks the chat: provider calls have no timeout, and once the dock remounts mid-run (close/reopen or reload) a second send orphans the running task (it loses its Stop) while later messages queue behind it as a fake 'Working…'**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **decide** · decision DEC-A · owner A2 · wave W3 · scope backend · estimate M
- Findings: F2C-002

**Summary.** No timeout: the first task stayed 'streaming' for 6 min 51 s (19:04:34 → 19:11:25) and ended only because the fake server closed the socket. It then 'completed' with the misleading 'Retrying … chat-only mode' text (see F2C-001). After the reload, Send was enabled mid-run. The second send was accepted (201) and its task went to status 'waiting' (scope-serialised behind the hung task). The dock/space track one run per…

**Root cause.** `src/modules/assistant/frontend/DesignerChatDock.tsx:113` — taskStage has no 'waiting' case → default 'running' → 'Working…' (same in Space.tsx:451)

**Proposed fix.** Backend provider timeout; dock remount doesn't orphan runs (re-attach stream). — Detail: Backend: in run-service.ts pass signal: AbortSignal.any([taskCtx.signal, firstByteTimeout]) plus an idle-stream timer (reset per chunk; generous for local models, e.g. 180 s first byte / 60 s idle, configurable per provider) and fail the task with 'Provider did not respond in N s'. Frontend (DesignerChatDock.tsx and Space.tsx): derive composer busy/Stop from the selected chat's active run (status queued/waiting/running/streaming) instead of the local `loading` flag, so a remount keeps Stop; block or queue a second…

**Evidence.** [018-dock-hung-3s](../evidence/shots/f2c/dark/018-dock-hung-3s.png), [208-dock-hung-4s](../evidence/shots/vf2c/dark/208-dock-hung-4s.png)

<details><summary>F2C-002 — A hung local provider blocks the chat: provider calls have no timeout, and once the dock remounts mid-run (close/reopen or reload) a second send orphans the running task (it loses its Stop) while later messages queue behind it as a fake 'Working…' (S2, confirmed)</summary>

- Area assistant.dock · stack B · design 284f64fc-6c44-4b49-bc92-076a4135fbf7 · themes dark · viewports 1440x900
- Repro:
  1. Stack B, default provider oMLX at 127.0.0.1:8000. Simulate a hung local server, e.g. LM Studio still loading a model: a TCP listener on :8000 that accepts and never replies (QA used f2c/blackhole.py)
  2. QA-f2c-board → Cmd+I dock → type 'hello hung provider' → Enter: 'Working… Stop' appears (OK)
  3. Reload the page and reopen Designer → dock: the bubble shows 'Working… Stop' again, but the composer now shows an enabled Send button instead of 'Stop generating'
  4. Type 'second while running' → Enter
  5. Open in Assistant view; press Stop on the visible run; send 'third message'
- Expected: Provider requests time out (e.g. 60–120 s for first byte) with a clear error. While a run is in flight the composer offers Stop, not a second Send. If a message is queued it reads 'Queued — waiting for the previous answer', and every in-flight run keeps a Stop control.
- Actual: No timeout: the first task stayed 'streaming' for 6 min 51 s (19:04:34 → 19:11:25) and ended only because the fake server closed the socket. It then 'completed' with the misleading 'Retrying … chat-only mode' text (see F2C-001). After the reload, Send was enabled mid-run. The second send was accepted (201) and its task went to status 'waiting' (scope-serialised behind the hung task). The dock/space track one run per chat, so the new run replaced the old one: the hung run's bubble became an empty 'Assistant' header with no Stop, while the waiting run showed a spinner 'Working…'. 'waiting' is not handled in taskStage and falls through to 'running'. Stop cancels only the waiting task. The hung task has no control anywhere in the dock or the Assistant space, and every further message in that chat ('third message') again waits behind it, shown as 'Working…'. The only escapes are waiting it out or starting a new chat.
- Screenshots: [018-dock-hung-3s](../evidence/shots/f2c/dark/018-dock-hung-3s.png), [019-dock-hung-after-reload](../evidence/shots/f2c/dark/019-dock-hung-after-reload.png), [020-dock-second-send-during-run](../evidence/shots/f2c/dark/020-dock-second-send-during-run.png), [022-space-stuck-run](../evidence/shots/f2c/dark/022-space-stuck-run.png), [208-dock-hung-4s](../evidence/shots/vf2c/dark/208-dock-hung-4s.png), [209-dock-reopened-midrun](../evidence/shots/vf2c/dark/209-dock-reopened-midrun.png), [210-dock-second-send](../evidence/shots/vf2c/dark/210-dock-second-send.png), [211-dock-after-stop](../evidence/shots/vf2c/dark/211-dock-after-stop.png), [214-space-third-waiting](../evidence/shots/vf2c/dark/214-space-third-waiting.png)
- Network: `GET /api/modules/tasks/tasks/420e9f14… → streaming (19:04:34 … 19:11:25 then completed)`; `GET /api/modules/tasks/tasks/7ccd21be… → waiting (UI: 'Working…')`; `POST /api/modules/tasks/tasks/7ccd21be…/cancel → cancelled; 420e9f14 unaffected`
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:113` — taskStage has no 'waiting' case → default 'running' → 'Working…' (same in Space.tsx:451)
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:466` — restored run bound per chat; a new submit overwrites the chat's single activeRun, orphaning the in-flight one
- Code: `src/modules/tasks/backend/runtime/task-runtime.ts:103` — scope lock per chatId: later tasks wait for the hung one indefinitely
- Code: `src/modules/assistant/backend/assistant-service.ts:324` — only the capability probe has AbortSignal.timeout; the chat completion call has none
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:998` — composer busy={loading}; loading is component state, so a remount (close/reopen dock, reload) resets it to false while restoreActiveTask only restores the bubble's run
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:682` — submit() writes activeRunsByChat[chatId] = new run, overwriting the in-flight one (one run per chat)
- Code: `src/modules/assistant/backend/run-service.ts:752` — runChat gets only taskCtx.signal; ai-core postChatCompletions (openai-compatible.js:270) has no timeout of its own
- Suggested fix: Backend: in run-service.ts pass signal: AbortSignal.any([taskCtx.signal, firstByteTimeout]) plus an idle-stream timer (reset per chunk; generous for local models, e.g. 180 s first byte / 60 s idle, configurable per provider) and fail the task with 'Provider did not respond in N s'. Frontend (DesignerChatDock.tsx and Space.tsx): derive composer busy/Stop from the selected chat's active run (status queued/waiting/running/streaming) instead of the local `loading` flag, so a remount keeps Stop; block or queue a second submit while a run is in flight, or keep a list of runs per chat so the earlier one keeps its Stop. Add case 'waiting' to both taskStage switches → 'Queued behind the previous answer…' with its own Cancel.
- Verification (vf2c): **confirmed** — Reproduced on stack B (dark) with a temporary TCP black-hole on 127.0.0.1:8000 (accepts, never replies; closed after 7 min). QA-f2c-board › dock › 'vf2c r2 hung one' → 'Working… Stop' + 'Stop generating'. Refinement: no reload is needed — closing the dock and reopening it (Cmd+I) already shows the bubble's 'Stop' but the composer's 'Send' (busy={loading} is reset on remount). Second send 'vf2c r2 second while running' → 201, task 731f25ba status 'waiting', rendered as spinner 'Working… Stop'; the hung task fbfa0fbd's bubble became an empty 'Assistant' header with no Stop, in the dock and in the Assistant space. Stop cancelled only 731f25ba. A third message from the Space (0b81ed59) sat 'waiting' shown as 'Working…' for 5 min. No timeout: fbfa0fbd streamed 20:29:19.411Z → 20:36:11.645Z (6 m 52 s) and ended exactly when the black-hole closed its sockets, then 'completed' with the F2C-001 'Retrying…' text; 0b81ed59 started 4 ms later. Overlap: 'Send enabled after reload mid-run' shares the restore path with Q8-024, but Q8-024's root is binding to a hidden internal message; here the bubble restores correctly and the composer does not. Timeout, orphaning and the 'waiting' mapping are new. S2 kept (hung run uncontrollable, chat blocked; workaround: new chat). · evidence: [208-dock-hung-4s](../evidence/shots/vf2c/dark/208-dock-hung-4s.png), [209-dock-reopened-midrun](../evidence/shots/vf2c/dark/209-dock-reopened-midrun.png), [210-dock-second-send](../evidence/shots/vf2c/dark/210-dock-second-send.png), [211-dock-after-stop](../evidence/shots/vf2c/dark/211-dock-after-stop.png), [214-space-third-waiting](../evidence/shots/vf2c/dark/214-space-third-waiting.png), GET /api/modules/tasks/tasks/fbfa0fbd… → streaming 20:29:19 → completed 20:36:11 (error null), 731f25ba waiting → cancelled via Stop; fbfa0fbd unaffected; 0b81ed59 waiting 20:31:05 → started 20:36:11.649

</details>


## T-356

**Dock run state wrong: 'Working…' forever on paused runs; after reload no Stop; empty answers show nothing**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner A2 · wave W3 · scope frontend · estimate S
- Findings: Q10-016, Q8-024

**Summary.** Dock shows the spinner 'Working… Stop' indefinitely (still after 75 s and after a full reload). GET /api/modules/tasks/tasks/6cb6ed94… returns status 'paused', error {type:'provider', code:'EXECUTION_ERROR', message:'OpenPCB Cloud workspace resolution failed (Unable to connect…)', retryable:true}, createdAt 11:35:02.061, updatedAt 11:35:02.074. The dock polled the task twice and then stopped; no stream is opened for… | Also covers: Q8-024: After a page reload an in-flight run shows no 'Working…'/Stop, and a run that ends with a…

**Root cause.** `src/modules/assistant/frontend/DesignerChatDock.tsx:141` — taskStage default branch maps 'paused' to running

**Proposed fix.** Dock taskStage handles 'paused'/'failed' (show error + Retry); restore Working/Stop after reload; empty answer shows 'No answer — Retry'. — Detail: Add `case "paused": return { status: "paused", stage: "Assistant paused before completing.", error: task.error?.message ?? null };` to taskStage in DesignerChatDock.tsx (mirroring Space.tsx:484) and render the paused banner + Retry in the dock; better, move taskStage into a shared helper used by both.

**Evidence.** [096-C1-dock-openpcb-cloud-offline](../evidence/shots/q10/dark/096-C1-dock-openpcb-cloud-offline.png), [080-dock-paused-task](../evidence/shots/vq10/dark/080-dock-paused-task.png), [024-dock-open](../evidence/shots/vq8/dark/024-dock-open.png)

<details><summary>Q10-016 — Designer chat dock shows 'Working… / Stop' forever when a run ends in status 'paused' (e.g. OpenPCB Cloud unreachable) — error never shown, even after reload (S2, confirmed)</summary>

- Area assistant.dock · stack C1 · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Stack C1, signed in with a Pro session (simulated) so the 'OpenPCB Cloud' provider exists
  2. Open 'Dual LED Blinker' → right dock → Assistant tab
  3. Model pill → Provider 'OpenPCB Cloud' (model resets to openpcb-fast)
  4. Type 'QA-q10 dock offline test', Enter; wait 75 s; reload the app and reopen the dock
- Expected: Same outcome as the Assistant space: 'Assistant paused before completing. <reason>' with Retry, within a second (the task fails in 13 ms).
- Actual: Dock shows the spinner 'Working… Stop' indefinitely (still after 75 s and after a full reload). GET /api/modules/tasks/tasks/6cb6ed94… returns status 'paused', error {type:'provider', code:'EXECUTION_ERROR', message:'OpenPCB Cloud workspace resolution failed (Unable to connect…)', retryable:true}, createdAt 11:35:02.061, updatedAt 11:35:02.074. The dock polled the task twice and then stopped; no stream is opened for 'paused', and taskStage maps 'paused' to running. The same chat in the Assistant space shows the paused banner correctly.
- Screenshots: [096-C1-dock-openpcb-cloud-offline](../evidence/shots/q10/dark/096-C1-dock-openpcb-cloud-offline.png), [097-C1-dock-openpcb-cloud-offline-40s](../evidence/shots/q10/dark/097-C1-dock-openpcb-cloud-offline-40s.png), [099-C1-dock-paused-task-working-forever-after-reload](../evidence/shots/q10/dark/099-C1-dock-paused-task-working-forever-after-reload.png), [094-C1-copilot-send-13s](../evidence/shots/q10/dark/094-C1-copilot-send-13s.png)
- Network: `GET /api/modules/tasks/tasks/6cb6ed94-d5db-4adc-8059-e3009a21e874 → 200 {status:'paused', error.code:'EXECUTION_ERROR', retryable:true}`
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:141` — taskStage default branch maps 'paused' to running
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:490` — paused excluded from openStream
- Code: `src/modules/assistant/frontend/Space.tsx:484` — reference 'paused' case
- Suggested fix: Add `case "paused": return { status: "paused", stage: "Assistant paused before completing.", error: task.error?.message ?? null };` to taskStage in DesignerChatDock.tsx (mirroring Space.tsx:484) and render the paused banner + Retry in the dock; better, move taskStage into a shared helper used by both.
- Verification (vq10): **confirmed** — Reproduced: Designer → Dual LED Blinker → dock Assistant tab shows 'Working… Stop' for chat 'Dual LED Blinker chat', while GET /api/modules/tasks/tasks/6cb6ed94… returns status 'paused' (created 11:35:02.061, updated 11:35:02.074, error EXECUTION_ERROR retryable). The same chat in the Assistant space shows 'Assistant paused before completing.' with Retry. Code: DesignerChatDock taskStage has no 'paused' case (default → running 'Assistant is working…'), and restoreActiveTask skips openStream for paused, so it never corrects. 'paused' is produced for any retryable provider failure, not only the cloud one, so this is not an offline-only artefact. Distinct from Q8-024 (in-flight run after reload). · evidence: [080-dock-paused-task](../evidence/shots/vq10/dark/080-dock-paused-task.png), [070-assistant-space](../evidence/shots/vq10/dark/070-assistant-space.png), GET /api/modules/tasks/tasks/6cb6ed94-d5db-4adc-8059-e3009a21e874 → status 'paused'

</details>

<details><summary>Q8-024 — After a page reload an in-flight run shows no 'Working…'/Stop, and a run that ends with an empty answer shows no 'No answer — Retry' (just tool chips + library cards) (S3, confirmed)</summary>

- Area assistant.dock · stack A · design 3d5d1f7c · themes dark · viewports 1440x900
- Repro:
  1. Designer 3d5d1f7c → dock → new design chat → 'How many LEDs are in this design? Answer in one line.' → Enter
  2. While 'Working…' is shown, reload the page (here: Vite restart/host suspend triggered a reload) and reopen Designer → dock (and 'Open in Assistant view')
  3. Task d728b47d… stays status 'streaming' for ~6 min (API), then 'completed' with empty assistant content
- Expected: Restored run shows Working…/Stop on the visible assistant bubble; an empty completion shows the 'No answer returned — Retry' card the live path shows.
- Actual: During the streaming phase the bubble shows only '4 tools · 3 src' + 'Components from library' cards, Send is enabled, no Stop (sidebar row does pulse). After completion the answer text is simply absent — no notice, no Retry. restoreActiveTask binds the run to the LAST assistant message with a taskId, which is an internal (metadata.ai.internal) hidden message, so the visible bubble never gets runState; the emptyResponse→Retry logic only exists in the live onTerminal path. Same root: a cancelled run's assistant bubble renders as an empty 'Assistant' header with no content once the in-memory run state is gone (QA-q8-retry, first answer).
- Screenshots: [024-dock-open](../evidence/shots/vq8/dark/024-dock-open.png), [047-dock-after-reload](../evidence/shots/q8/dark/047-dock-after-reload.png), [048-open-in-assistant-view](../evidence/shots/q8/dark/048-open-in-assistant-view.png), [059-dock-empty-answer](../evidence/shots/q8/dark/059-dock-empty-answer.png), [020-component-mention-raw-in-bubble](../evidence/shots/q8/light/020-component-mention-raw-in-bubble.png)
- Network: `GET /tasks/d728b47d… → status 'streaming' (11:38), later 'completed' updatedAt 11:40:49`; `GET /chats/b934ae46…/messages → visible assistant content '' + internal assistant/tool rows with same taskId`
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:466` — latest = last assistant message with taskId (internal one)
- Code: `src/modules/assistant/frontend/Space.tsx:686` — same in Space restoreActiveTask
- Code: `src/modules/assistant/frontend/Space.tsx:640` — emptyResponse → Retry only in live onTerminal
- Suggested fix: In restoreActiveTask pick the first non-internal assistant message for that taskId; when rendering a completed assistant message with empty content and no proposals, show the 'No answer returned — Retry' card.
- Verification (vq8): **confirmed** — Empty-answer half reproduced: QA-q8-dock first turn (task d728b47d, completed) renders only '4 tools · 3 src' + 'Components from library' cards, no text, no 'No answer'/Retry (textContent check). API: visible assistant 0e… content '' plus internal assistant/tool rows with the same taskId. Restore half code-verified: DesignerChatDock.tsx:463-467 and Space.tsx:684-688 pick the last assistant message with a taskId without filtering metadata.ai.internal, so after the first tool iteration a restored run is bound to a hidden message; the emptyResponse->Retry card exists only in live onTerminal (Space.tsx:640-656). A fresh reload-mid-run attempt completed before the first internal message, so timing could not be re-hit. S3 kept. · evidence: [024-dock-open](../evidence/shots/vq8/dark/024-dock-open.png)

</details>


## T-357

**Dock thread menu uses native window.prompt (Rename) and window.confirm (Delete)**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner A2 · wave W3 · scope frontend · estimate S
- Findings: Q8-035 · known ref K04,K06
- Depends on: ['T-014']

**Summary.** Native prompt 'Rename chat' (dialog-spy: prompt 1) and native confirm 'Delete "S3 Smoke — 5 LED indicators (v2) chat"?' (confirm 1, both themes). In Electron window.prompt is unsupported → dock rename silently fails.

**Root cause.** `src/modules/assistant/frontend/DesignerChatDock.tsx:725` — window.prompt

**Proposed fix.** Dock Rename inline; Delete via kit confirmDialog. — Detail: Share the Space's inline title editor (click title → input) and the kit ConfirmDialog.

**Evidence.** [025-dock-thread-menu](../evidence/shots/vq8/dark/025-dock-thread-menu.png)

<details><summary>Q8-035 — Dock thread menu 'Rename' uses native window.prompt and 'Delete' native window.confirm (S2, confirmed)</summary>

- Area assistant.dock · stack A · design 3d5d1f7c · themes dark, light · viewports 1440x900
- Repro:
  1. Designer 3d5d1f7c → Cmd+I → thread title ▾ → 'Rename' under the chat
  2. Thread menu → 'Delete' under another chat
- Expected: Inline rename field in the menu/header and a kit confirm dialog.
- Actual: Native prompt 'Rename chat' (dialog-spy: prompt 1) and native confirm 'Delete "S3 Smoke — 5 LED indicators (v2) chat"?' (confirm 1, both themes). In Electron window.prompt is unsupported → dock rename silently fails.
- Screenshots: [025-dock-thread-menu](../evidence/shots/vq8/dark/025-dock-thread-menu.png), [049-dock-thread-menu](../evidence/shots/q8/dark/049-dock-thread-menu.png), [021-dock-thread-menu-2chats](../evidence/shots/q8/light/021-dock-thread-menu-2chats.png), [050-dock-after-delete](../evidence/shots/q8/dark/050-dock-after-delete.png)
- Console: `__qaDialogCalls.log: 'prompt: Rename chat', 'confirm: Delete "QA-q8-dock"?'`; `__qaDialogCalls.log: 'prompt: Rename chat', 'confirm: Delete "S3 Smoke — 5 LED indicators (v2) chat"?'`
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:725` — window.prompt
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:748` — window.confirm
- Suggested fix: Share the Space's inline title editor (click title → input) and the kit ConfirmDialog.
- Verification (vq8): **confirmed** — Reproduced in dock (3d5d1f7c PCB): thread title ▾ -> 'Rename' -> native prompt 'Rename chat' (dismissed); 'Delete' -> native confirm 'Delete "QA-q8-dock"?' (dismissed, chat still exists). DesignerChatDock.tsx:725 window.prompt, :748 window.confirm. Matches K04 (+K06). S2 per rubric. · evidence: [025-dock-thread-menu](../evidence/shots/vq8/dark/025-dock-thread-menu.png)

</details>


## T-358

**Dock header row overflows at the default dock width: with a local model name the tools badge is cut off at the window edge and the 'just now' timestamp is pushed out of view**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner A2 · wave W3 · scope frontend · estimate XS
- Findings: F2C-011

**Summary.** The pill (already truncated to 22 chars plus 'STRICT') and the shrink-0 badge/timestamp don't fit in the ~276px row. At 1440×900 the tools badge spans x 1405.9–1447.9 in a 1440px window, so its right half and the whole timestamp are clipped by the window edge. At 1100×720 it spans 1065.9–1107.9 in a 1100px window. The dock container has no overflow handling (the parent is overflow:visible), so the content is simply…

**Root cause.** `src/modules/assistant/frontend/DesignerChatDock.tsx:854` — `mt-2 flex items-center gap-2` row: pill has no min-w-0/flex-shrink, badge and timestamp are shrink-0

**Proposed fix.** Dock header: truncate model name/badges, timestamp never clipped. — Detail: DesignerChatDock.tsx:854: give the ModelSelectorPill wrapper `min-w-0 flex-1` and make the pill button `min-w-0` with the model label `truncate` (CSS ellipsis instead of shortModel's 22-char slice, ModelSelectorPill.tsx:39); or move the timestamp to the chat selector row / hide it when the dock is narrower than ~340 px.

**Evidence.** [013-dock-send-7s](../evidence/shots/f2c/dark/013-dock-send-7s.png), [206-dock-open](../evidence/shots/vf2c/dark/206-dock-open.png)

<details><summary>F2C-011 — Dock header row overflows at the default dock width: with a local model name the tools badge is cut off at the window edge and the 'just now' timestamp is pushed out of view (S3, confirmed)</summary>

- Area assistant.dock · stack B · design 284f64fc-6c44-4b49-bc92-076a4135fbf7 · themes dark · viewports 1440x900, 1100x720
- Repro:
  1. QA-f2c-board › Cmd+I (dock default width ~300px)
  2. Chat on provider oMLX (model 'Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit')
  3. Look at the row under the chat selector: model pill · tools badge · timestamp
- Expected: The pill truncates, or the row wraps, so the tools badge and timestamp stay inside the dock.
- Actual: The pill (already truncated to 22 chars plus 'STRICT') and the shrink-0 badge/timestamp don't fit in the ~276px row. At 1440×900 the tools badge spans x 1405.9–1447.9 in a 1440px window, so its right half and the whole timestamp are clipped by the window edge. At 1100×720 it spans 1065.9–1107.9 in a 1100px window. The dock container has no overflow handling (the parent is overflow:visible), so the content is simply cut at the viewport edge. With the short 'gpt-4o-mini' model the row fits, so it depends on the model name.
- Screenshots: [013-dock-send-7s](../evidence/shots/f2c/dark/013-dock-send-7s.png), [100-1100-dock-schem](../evidence/shots/f2c/dark/100-1100-dock-schem.png), [206-dock-open](../evidence/shots/vf2c/dark/206-dock-open.png), [207-dock-header-row-crop](../evidence/shots/vf2c/dark/207-dock-header-row-crop.png), [235-1100-dock-header](../evidence/shots/vf2c/light/235-1100-dock-header.png)
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:854` — `mt-2 flex items-center gap-2` row: pill has no min-w-0/flex-shrink, badge and timestamp are shrink-0
- Code: `src/modules/assistant/frontend/components/ModelSelectorPill.tsx:39` — shortModel truncates by character count (22) rather than CSS width
- Suggested fix: DesignerChatDock.tsx:854: give the ModelSelectorPill wrapper `min-w-0 flex-1` and make the pill button `min-w-0` with the model label `truncate` (CSS ellipsis instead of shortModel's 22-char slice, ModelSelectorPill.tsx:39); or move the timestamp to the chat selector row / hide it when the dock is narrower than ~340 px.
- Verification (vf2c): **confirmed** — Reproduced on stack B, chat on oMLX, default dock width: dark 1440x900 row 1152–1430, pill 1152–1397.9, tools badge 1405.9–1447.9, timestamp '25m ago' 1455.9–1495.1 in a 1440 px window (badge half-clipped, timestamp invisible; crop 207). Light 1100x720: badge 1065.9–1107.9, timestamp 1115.9–1149.1 in 1100 px. Long model ids are the norm for local and OpenRouter models, so this is the common case. S3 kept. · evidence: [206-dock-open](../evidence/shots/vf2c/dark/206-dock-open.png), [207-dock-header-row-crop](../evidence/shots/vf2c/dark/207-dock-header-row-crop.png), [235-1100-dock-header](../evidence/shots/vf2c/light/235-1100-dock-header.png)

</details>


## T-359

**Dock chrome polish: composer hint row wraps into a cramped 3-line block, thread-menu Rename/Delete are 10px/15px-tall text links, preset list shows raw ids, 'Close chat' hides the whole side panel**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner A2 · wave W3 · scope frontend · estimate S
- Findings: Q8-025

**Summary.** 'Type / for commands Type @ to reference docs, components, or designs' wraps to three lines (≈45px). Thread menu is a hand-rolled list: 'Rename' and 'Delete' are 10px text, 15px tall, side by side under each chat. Dock passes presets={[]} so the preset select lists 'strict-grounded / friendly-tutorial / minimal-concise'. 'Close chat' collapses the entire side panel incl. Properties/ERC tabs.

**Root cause.** `src/modules/assistant/frontend/components/ChatComposer.tsx:264` — hint row not collapsed when compact

**Proposed fix.** Dock chrome polish: single-line hint row, kit menu items for Rename/Delete, readable presets. — Detail: Hide the hint row when compact (or show only '/ · @'); switch the thread menu to the kit DropdownMenu with 22px items; fetch prompt presets in the dock (or share from a store); rename the X to 'Close panel'.

**Evidence.** [024-dock-open](../evidence/shots/vq8/dark/024-dock-open.png)

<details><summary>Q8-025 — Dock chrome polish: composer hint row wraps into a cramped 3-line block, thread-menu Rename/Delete are 10px/15px-tall text links, preset list shows raw ids, 'Close chat' hides the whole side panel (S3, confirmed)</summary>

- Area assistant.dock · stack A · design 3d5d1f7c · themes dark · viewports 1440x900
- Repro:
  1. Designer 3d5d1f7c → Cmd+I (dock ~288px wide)
  2. Look at the composer header row
  3. Open the thread menu (chat title ▾)
  4. Open the model pill → Prompt preset
  5. Click the X 'Close chat'
- Expected: Hints collapse to a single line or hide in narrow docks; menu actions are ≥20px rows with icons (kit DropdownMenu); preset labels match the Space ('Strict Grounded'); the X label matches its effect ('Close panel') or only closes the chat.
- Actual: 'Type / for commands  Type @ to reference docs, components, or designs' wraps to three lines (≈45px). Thread menu is a hand-rolled list: 'Rename' and 'Delete' are 10px text, 15px tall, side by side under each chat. Dock passes presets={[]} so the preset select lists 'strict-grounded / friendly-tutorial / minimal-concise'. 'Close chat' collapses the entire side panel incl. Properties/ERC tabs.
- Screenshots: [024-dock-open](../evidence/shots/vq8/dark/024-dock-open.png), [025-dock-thread-menu](../evidence/shots/vq8/dark/025-dock-thread-menu.png), [026-dock-preset-raw-ids](../evidence/shots/vq8/dark/026-dock-preset-raw-ids.png), [027-dock-close-chat-hides-panel](../evidence/shots/vq8/dark/027-dock-close-chat-hides-panel.png), [043-dock-open](../evidence/shots/q8/dark/043-dock-open.png), [049-dock-thread-menu](../evidence/shots/q8/dark/049-dock-thread-menu.png), [062-dock-model-pill](../evidence/shots/q8/dark/062-dock-model-pill.png), [051-dock-close-chat](../evidence/shots/q8/dark/051-dock-close-chat.png)
- Census: `census/assistant-dock-schem-dark-1440.json`
- Code: `src/modules/assistant/frontend/components/ChatComposer.tsx:264` — hint row not collapsed when compact
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:867` — presets={[]}
- Code: `src/modules/assistant/frontend/DesignerChatDock.tsx:848` — 'Close chat' closes dock
- Suggested fix: Hide the hint row when compact (or show only '/ · @'); switch the thread menu to the kit DropdownMenu with 22px items; fetch prompt presets in the dock (or share from a store); rename the X to 'Close panel'.
- Verification (vq8): **confirmed** — Reproduced in dock (~278px): composer hint row 54px tall, wraps ('Type / for commands Type @ to reference docs, components, or designs'); thread menu has no role=menu, 'Rename'/'Delete' are 10px text buttons 15px tall; preset select lists raw ids strict-grounded / friendly-tutorial / minimal-concise (DesignerChatDock.tsx:867 presets={[]}); 'Close chat' (aria-label, :848-849) collapses the whole side panel (0 Side panel tabs, Toggle side panel aria-pressed=false). S3 kept. · evidence: [024-dock-open](../evidence/shots/vq8/dark/024-dock-open.png), [025-dock-thread-menu](../evidence/shots/vq8/dark/025-dock-thread-menu.png), [026-dock-preset-raw-ids](../evidence/shots/vq8/dark/026-dock-preset-raw-ids.png), [027-dock-close-chat-hides-panel](../evidence/shots/vq8/dark/027-dock-close-chat-hides-panel.png)

</details>

