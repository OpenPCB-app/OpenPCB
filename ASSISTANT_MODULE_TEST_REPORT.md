# Assistant Module (Chats) — Manual Test & Validation Report

> **Phase 3 addendum (root-cause of empty responses + new composer bug) is at the bottom — see "## 8".** Key correction: the oMLX model+server are **not** at fault; they produce correct content/tool-calls in isolation. The empty responses are an **OpenPCB-side** interaction defect.

**Date:** 2026-05-29 · **Tester role:** Senior QA · **Method:** `npm run dev` + `playwright-cli` driving the real UI at `http://127.0.0.1:1420`
**Scope:** Assistant **module screen only** (full-screen space) — _not_ the Designer sidebar chat dock.
**Provider:** `oMLX` (local, OpenAI-compatible) @ `http://127.0.0.1:8000/v1` · **Model:** `Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit` (a reasoning/"thinking" distilled model)

---

## 1. Summary / Verdict

The Assistant module is **largely functional**: chat lifecycle, streaming, markdown, and the read-tool pipeline (library search / BOM resolve / designer resolve+bind) all work, and the write-proposal UI renders correctly. The backend is clean (no 5xx, no exceptions in this session).

**However, two significant issues make the module unreliable with this reasoning model:**

1. **🔴 HIGH — Empty assistant responses with no feedback.** The model frequently completes a turn (`finish_reason: stop`, task `status: completed`) with **empty visible content**, rendering a blank assistant bubble — no text, no error, no retry. Root cause: the model emits its answer into the OpenAI `reasoning_content` field (chain-of-thought), which OpenPCB discards; when the actual `content` is empty there is no fallback. Reproduced 4× (incl. fresh chats). Worsens as conversation history grows.
2. **🟠 HIGH — Capability probe false-negative disables ALL tools.** The tool-call capability probe sends `max_tokens: 16`. The reasoning model spends all 16 tokens on `reasoning_content` and never emits the tool call → probe reports `toolCalling: false`. The run service (`run-service.ts:75`) then **disables every tool** for that provider. So a user who clicks "Test" in Settings (a normal action) silently loses all 13 tools.

**Overall:** Plumbing is sound; the integration is **not production-ready for reasoning models** until `reasoning_content` is handled and the probe token budget is fixed.

| Result                            | Count |
| --------------------------------- | ----- |
| ✅ PASS                           | 13    |
| 🟡 PARTIAL / not fully verifiable | 4     |
| 🔴 Issue found                    | 4     |
| ⛔ Blocked (by model behavior)    | 2     |

---

## 2. Environment & provider readiness (Area A)

| Check                                   | Result | Detail                                                                                                                                  |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Backend `:3000` + frontend `:1420` boot | ✅     | Modules loaded: assistant, designer, library, tasks                                                                                     |
| oMLX configured & enabled               | ✅     | base `http://127.0.0.1:8000/v1`, model present, `hasApiKey:true`, default provider                                                      |
| `/v1/models` reachable                  | ✅     | 4 models incl. target Qwen3.5-27B                                                                                                       |
| Completion (warm)                       | ✅     | ~3 s                                                                                                                                    |
| **Tool-call capability**                | 🔴     | Probe reports `toolCalling:false` (see Issue #2) — but raw stream proves the model **does** emit valid `tool_calls` at `max_tokens:200` |

> **Test-baseline action taken:** I deleted the polluted `assistant_provider_capability` row for `omlx` (set to `false` by the probe) so tools would be sent during functional testing. This is a dev-env baseline reset, **not** a product fix.

---

## 3. Results by area

### B — Chat lifecycle

| ID  | Case                          | Result | Notes                                                                                                                                                           |
| --- | ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Create new chat               | ✅     | "New" → empty state w/ 4 starter prompts; becomes active                                                                                                        |
| B2  | Inline rename (top-bar title) | 🟡     | Inline input appears (`beginRename` works); couldn't commit via synthetic events (controlled-input harness limit). Backend `PATCH /chats/:id` verified working. |
| B3  | Chat-actions menu             | ✅     | Top-bar Radix menu: Rename / Export markdown (disabled "Coming soon" stub) / Archive / Delete                                                                   |
| B4  | Search + filter tabs          | ✅     | Search "Dual" → 7→1 chats, restores on clear; "Linked" tab → 2                                                                                                  |
| B5  | Delete chat (confirm dialog)  | ✅     | `window.confirm` accepted → chats 7→6                                                                                                                           |
| B6  | Reload persistence            | ✅     | Full page reload restored chat list, active chat, messages, model badge                                                                                         |

### C — Messaging & streaming (all via oMLX/Qwen)

| ID  | Case                            | Result | Notes                                                                                                                                                     |
| --- | ------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Simple text send + stream       | ✅     | "Hello from oMLX" streamed; run card queued→writing→cleared; verified real SSE task                                                                       |
| C2  | Markdown rendering              | ✅     | Ordered list + inline `code` + 2×2 table + fenced JS code block all rendered                                                                              |
| C3  | Multiline (Shift+Enter / Enter) | 🟡     | Send-on-Enter & busy→Stop swap confirmed; newline insertion not isolated in automation                                                                    |
| C4  | Slash `/` quick-actions         | 🟡     | Code correct (`QUICK_ACTIONS` defined, `slashOpen` logic sound); single-char controlled-input wouldn't stick via CLI — **not a bug**, not verifiable here |
| C5  | Stop mid-stream                 | 🟡     | "Stop generating" button confirmed present during streaming (C1); click ends run. Partial-text-retention not cleanly captured (latency/automation timing) |
| C8  | Empty input → Send disabled     | ✅     | Send disabled when empty; enabled after fill (also F2)                                                                                                    |

### D — Read tools

| ID  | Tool                                  | Result | Notes                                                                                                                                                                               |
| --- | ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `library_search_components`           | ✅     | Tool fired ("1 tool call"); Search Results + ComponentResultsBlock (AMS1117-3.3, Best 100%) + expandable ToolCard (args, source, raw result). `tool-events` API: `succeeded, src=1` |
| D2  | `library_resolve_bom`                 | ✅     | BOM proposal card, 5-row table (NE555/2×R/C/LED) resolved to core library; "5 src"                                                                                                  |
| D3  | `library_get_component_detail`        | 🔴     | Empty response 3× (incl. fresh chat) — see Issue #1. (Raw oMLX stream shows the model _does_ emit the tool call; OpenPCB returns `toolCallCount:0, finish:stop, content:''`.)       |
| D4  | `designer_resolve_design` + bind      | ✅     | Resolved "Dual LED Blinker", chat auto-bound (`context-bindings: active`, "Linked" badge); final summary text empty (Issue #1)                                                      |
| D5  | `designer_get_design_summary`         | ⛔     | Model never called it (stopped after resolve, empty text) — blocked by model behavior, not a backend defect                                                                         |
| D6  | `designer_get_part_detail`            | ⛔     | Not reached (same model-behavior blocker)                                                                                                                                           |
| D7  | `designer_get_schematic_connectivity` | ⛔     | Not reached                                                                                                                                                                         |

### E — Write tools & proposals

| ID    | Case                                          | Result | Notes                                                                                                                                                                                                                         |
| ----- | --------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2    | `designer_place_components` (pipeline + card) | ✅     | Validated via **existing applied proposal**: PlacementProposalCard renders (Pin Header, "Applied" status, **Reject disabled** = re-action guard). One historical chat shows full success: assistant text + placement proposal |
| E3    | `designer_propose_schematic_edits`            | ⛔     | Model produced empty response / no tool call across 3 attempts (incl. turn-1 in a pre-bound design chat) — Issue #1 blocks live exercise                                                                                      |
| E4–E6 | wires / updates / deletions                   | ⛔     | Not exercisable — same model blocker (write-tool calls not emitted this session)                                                                                                                                              |
| E7    | Re-apply guard                                | ✅     | UI: Reject disabled on applied proposal. Backend guard exists (`assistant-service.ts` "already applied")                                                                                                                      |
| E1    | `designer_create_design`                      | ⛔     | Not emitted by model                                                                                                                                                                                                          |

> **Note:** Write proposals **do** work historically (2 existing chats have `status: applied` placement proposals created/applied successfully). The backend pipeline (propose → proposal row → card → Apply → design mutation) is sound; the blocker is the model not emitting write-tool calls in this session.

### F/G — Error / robustness

| ID  | Case                   | Result | Notes                                                                                                                           |
| --- | ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| F2  | Empty/whitespace send  | ✅     | Send disabled                                                                                                                   |
| F6  | Send during active run | ✅     | Send button becomes "Stop generating" while busy → no double-send                                                               |
| G1  | Browser console        | ✅     | Only benign favicon 404 this session (the 500s in `.playwright-cli/console-*.log` are from a **stale 2026-05-28** session file) |
| G2  | Backend logs           | ✅     | No 5xx, no exceptions, no error-level logs during the session                                                                   |

---

## 4. Issues found (by severity)

### 🔴 Issue #1 — Empty assistant response renders a blank bubble with no feedback

- **Severity:** High (core UX). **Reproducibility:** High with this reasoning model (4×, incl. fresh chats).
- **Repro:** In the Assistant module, select oMLX/Qwen3.5-27B. Ask: _"Call library_get_component_detail with componentId openpcb.core.ic.ams1117-3v3-sot-223 and list its pins."_
- **Expected:** Visible answer (or an error/retry).
- **Actual:** Empty assistant bubble. Task `status: completed`, `finishReason: stop`, `toolCallCount: 0`, `content: ''`. No error, no retry affordance.
- **Root cause (verified via raw `:8000` stream):** the model routes output to OpenAI `reasoning_content` (e.g. 371 reasoning chars, `content: '\n\n'`). OpenPCB's `@openpcb/ai-core` OpenAI-compatible client accumulates only `content`/`tool_calls` and **discards `reasoning_content`** with no empty-content fallback.
- **Suggested pointers (no fix applied):** `node_modules/@openpcb/ai-core/dist/providers/openai-compatible.js` (streaming delta handling ~L150-170 — handle/strip `reasoning_content`); `src/modules/assistant/frontend/components/MessageCard.tsx` / `AssistantRunStatusCard.tsx` (render an "empty response — retry" state when `content===''` and no tool calls).

### 🟠 Issue #2 — Capability probe false-negative disables all tools for reasoning models

- **Severity:** High. **Reproducibility:** Deterministic.
- **Repro:** Settings → Assistant → oMLX → run **Test** (or `POST /providers/omlx/capabilities/refresh`). Result caches `toolCalling:false`. Then every chat with oMLX has tools stripped.
- **Root cause:** `probeToolCall` uses `maxOutputTokens: 16` (`openai-compatible.js:258`). Reasoning model spends 16 tokens on `reasoning_content` (`finish_reason: length`, no tool_calls) → `toolCalling:false`. At `max_tokens:200` the same request returns `finish_reason: tool_calls` correctly.
- **Gate:** `src/modules/assistant/backend/run-service.ts:75` → `providerAllowsTools = provider.capabilities?.toolCalling !== false` → tools disabled.
- **Suggested pointers:** raise probe `maxOutputTokens` substantially (e.g. 256+) and/or treat `finish_reason:length` as inconclusive rather than `false`; consider not hard-gating tools on a cached probe.

### 🟡 Issue #3 — Model frequently stops after tool calls without final text

- **Severity:** Medium. Even when read tools succeed (D4: resolve+bind worked), the model often emits **no closing natural-language summary** (`content` len 0–3). User sees tool cards but no explanation. Related to Issue #1 (`reasoning_content`). Tool-result cards still render, so partially mitigated.

### 🟡 Issue #4 — `designer_get_design_summary` (and follow-on read/write tools) not invoked

- **Severity:** Medium (likely model-side, but worth a grounding-prompt review). When asked to resolve a design _and_ summarize, the model performed `designer_resolve_design` then stopped (empty), never calling `designer_get_design_summary` despite `maxToolIterations:4`. May indicate the strict-grounded system prompt + reasoning model interplay needs tuning. Pointer: `src/modules/assistant/backend/prompt-service.ts`, `run-service.ts` (maxToolIterations / continuation after tool result).

**Known stubs (not bugs):** "Export markdown" chat action disabled ("Coming soon"); "Attach a file" disabled ("coming soon").

---

## 5. Coverage matrix

**Message types:** user ✅ · assistant text ✅ · assistant empty 🔴 · markdown (list/code/table/fenced) ✅ · tool-call card ✅ · tool-result/BOM/component cards ✅ · placement proposal card ✅ · run-status card ✅ · system/error message — not triggered.

**Tools (13):** search ✅ · resolve_bom ✅ · get_component_detail 🔴 · resolve_design ✅ · get_design_summary ⛔ · get_part_detail ⛔ · get_schematic_connectivity ⛔ · create_design ⛔ · propose_schematic_edits ⛔ · propose_schematic_wires ⛔ · propose_schematic_updates ⛔ · propose_schematic_deletions ⛔ · place_components ✅(historical).

**Lifecycle:** create ✅ · rename 🟡 · delete ✅ · bulk-delete (UI not exercised; bulk-delete endpoint exists) · search ✅ · filter tabs ✅ · archive (menu present) · reload-persist ✅.

---

## 6. Limitations of this test pass

- The oMLX reasoning model's empty-response behavior (Issue #1) **blocked** end-to-end exercise of designer read tools D5–D7 and write tools E1/E3–E6 _through the chat UI_. The backend pipelines for these are verified to work historically (applied proposals) and via direct tool-event inspection.
- Inline rename, slash menu, and partial-stop retention couldn't be fully driven because `playwright-cli` runs each command as a separate process (focus/keystroke state doesn't persist across calls). These are **automation limitations**, not confirmed product defects.
- DB state was modified once (cleared `omlx` capability cache) to enable functional tool testing — documented above.

---

## 7. Headed Re-Test (Phase 2) — were findings test-method artifacts?

Re-ran in a **headed, persistent** browser (`playwright-cli -s=qa2 open … --headed --persistent`) using **real keyboard input** (`type`, `press Enter`, `press Shift+Enter`, real `click`/`select`) instead of programmatic `fill`/`eval`. Screenshots saved to `OpenPCB/qa2-*.png`.

### Artifact-suspect items — RECLASSIFIED as test-method artifacts (all work):

| Case               | Phase-1 result     | Headed result | Evidence                                                                                                         |
| ------------------ | ------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------- |
| C4 slash `/` menu  | 🟡 not verifiable  | ✅ **PASS**   | `type "/"` → "Quick actions" popover (Wire/Resolve BOM/Run ERC/Suggest); picking one fills composer. `qa2-02`    |
| B2 inline rename   | 🟡 couldn't commit | ✅ **PASS**   | click title → select-all → type → Enter → title="QA Headed Rename" (verified via `GET /chats/:id`). `qa2-03`     |
| C3 multiline       | 🟡 not isolated    | ✅ **PASS**   | `Shift+Enter` → value `"line one\nline two"` (newline present). `qa2-04`                                         |
| C5 Stop mid-stream | 🟡 partial         | ✅ **PASS**   | Stop button appears ~1 s; click → run shows **"Assistant task cancelled." + Retry** (user Image #3). `qa2-07/08` |

→ **All four prior PARTIALs were artifacts of the non-persistent CLI + synthetic-event method, not product defects.** The first pass under-counted working features.

### Real bugs — RE-CONFIRMED visually (headed):

- **Issue #1 (empty bubble)** reproduced live with screenshots: `library_get_component_detail` follow-up → fully blank **Assistant** bubble, `content` len 0, no tool/card/error/retry (`qa2-06`, user Image #2). Also the "tool ran, no closing answer" variant (`qa2-05`, user Image #1: "1 tool call" + tool card but no pin list).
- **Asymmetry pinpointed:** cancelled/failed runs DO get a Retry affordance ("Assistant task cancelled." — Image #3), but a **completed-but-empty** run removes the status card → blank bubble with nothing. The fix for Issue #1 should make completed-empty behave like cancelled (show a retry/empty state).

### New findings this phase:

- **🟠 Environment blocker — oMLX 16 GB memory ceiling.** Only the resident `Qwen3.5-27B` (15.5 GB) is loadable. `gemma-4-26b` (30.8 GB), `Qwen3.5-9B` (21.4 GB), `Qwen3.6-27B` all fail with `"projected memory … exceed the memory ceiling 16.00GB"`. **A3 (non-reasoning validation) is blocked by hardware**, not software. (Raise the oMLX `memory_guard_tier` / free RAM, or run a model that fits, to test non-reasoning paths.)
- **✅ Good behavior confirmed — chat-only fallback.** When the provider errored (gemma OOM) with tools enabled, the UI showed `"Provider failed while tools were enabled. Retrying this answer in chat-only mode."` (`run-service.ts:150-180`). This is the _correct_ feedback pattern — exactly what Issue #1's empty-completed path lacks.
- **Write-tool emission via the reasoning model still not achievable.** Even a maximally-directive `designer_propose_schematic_edits` prompt produced an empty response (no tool call, no proposal). Write-tool Apply remains validated **historically only** (existing applied placement proposal: card renders, Reject disabled). Likely model-behavior + strict-grounded prompt interplay (audit Issue #4) — re-test once a tool-capable non-reasoning model can load.

### Screenshots (in `OpenPCB/`)

`qa2-01-assistant-open` · `qa2-02-slash-menu` · `qa2-03-rename-typing` · `qa2-04-multiline` · `qa2-05-component-detail-reasoning` · `qa2-06-empty-bubble-followup` · `qa2-07-streaming-stop` · `qa2-08-after-stop` · `qa2-09-gemma-selected` · `qa2-10-gemma-write`

### Net effect on Phase-1 verdict

The two HIGH bugs stand and are now visually confirmed. **Four PARTIALs were false negatives caused by the headless/CLI method** and are actually PASS. The module's UI layer is healthier than the first pass implied; the real defects are concentrated in the **reasoning-model integration** (`@openpcb/ai-core` reasoning_content handling + probe) and the **completed-empty UI affordance** — see the audit/fix plan in `~/.claude/plans/act-as-senior-tester-abstract-parasol.md`.

---

## 8. Phase 3 — Clean re-test (27B only) + root cause of empty responses

Re-ran headed, persistent browser, **only `Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit`, no model switching** (per user). Screenshots in `OpenPCB/qa3-shots/`.

### The oMLX model + server are NOT the problem (verified by direct API probes)

Hitting `:8000` directly, the model reliably produces correct output for the exact turns OpenPCB returns empty for:

- Simple chat: `"OK-27B"`/`"STILL-OK"` (content + ~140-500 reasoning chars). ✅
- Post-tool continuation (system+user+assistant-toolcall+tool-result): **6/6 produced a full pin list** (496–908 chars content). ✅
- Iteration-1 with full 5 KB prompt + **1** tool schema: emits a valid `tool_call` (`finish=tool_calls`). ✅

So the user is correct — oMLX/Qwen works fully correctly. (The earlier OOM was solely from my switching to gemma-4-26b alongside the resident 27B; with a single model there is no OOM.)

### Root cause of the empty bubbles (OpenPCB-side)

Ground-truth via OpenPCB's own task SSE for "Find a 3.3V regulator": events were `run.started → run.message.completed → run.completed` with **0 `run.message.delta`, 0 tool events, 0 text chars**. The model emitted **only `reasoning_content`** then finished empty.
Two compounding OpenPCB-side factors:

1. **`reasoning_content` is discarded** — `openai-compatible.ts:180` accumulates only `delta.content`. For this thinking model, when a turn is reasoning-heavy, the visible content is empty.
2. **Context bloat tips the model into reasoning-only/empty** — with **all 13 tool schemas (~20 KB)** + the **5 KB strict-grounded system prompt**, the model frequently produces no tool call and no content; with **1** tool it calls correctly. (Isolated test with 13 large schemas degraded to fully-empty/error responses, reproducing the failure direction.)
3. **No empty-completed fallback** — `run.message.completed` with empty content + no tool calls is persisted/rendered as a blank bubble (no text/retry). Note: _cancelled/failed_ runs DO show a Retry; _completed-empty_ does not (the asymmetry to fix).

**Manifestations observed (user screenshots):** tool runs but no answer text (Image #5), and no tool + blank bubble (Images #2/#6).

**Fix direction (refined):** (a) capture/handle `reasoning_content` (surface or at least guarantee a non-empty fallback / auto-retry on empty-completed); (b) reduce per-call tool/prompt payload (only send relevant tools, trim TOOL_INSTRUCTIONS, or stage tools) to stop the reasoning model from emitting empty; (c) render a "no response — retry" state for completed-empty in `MessageCard`/`AssistantRunStatusCard`. Files: `shared/packages/ai-core/src/providers/openai-compatible.ts`, `…/runs/run-loop.ts`; `OpenPCB/src/modules/assistant/backend/{run-service.ts,prompt-service.ts}`; frontend `MessageCard.tsx`/`AssistantRunStatusCard.tsx`.

### NEW UI bug — composer doesn't auto-grow (Image #7)

`ChatComposer.tsx` textarea is `rows={1}` + `max-h-48` + `resize-none` with **no auto-resize logic** (no `scrollHeight`→`style.height` effect). Multi-line/long input therefore **shows an inner scrollbar instead of growing the field** up to `max-h-48`. **Fix:** on input, set `textarea.style.height = 'auto'` then `= min(scrollHeight, maxPx)`. File: `src/modules/assistant/frontend/components/ChatComposer.tsx:113-125`.

### Re-validated WORKING this phase (27B, fresh chats, screenshots)

- Simple chat → full streamed answer (`qa3-03/06`). ✅
- Loading/streaming states render correctly: "thinking…", "Writing response…" spinner + Stop + pulsing dots (`qa3-03`). ✅
- Slash menu, inline rename, multiline (Shift+Enter), Stop→cancelled+Retry — all PASS (Phase 2, real keyboard).
- **Intermittent:** `library_search`/`library_get_component_detail` sometimes execute the tool + render the tool card (no final text), sometimes empty entirely — same root cause. Tool _execution_ and card rendering work when the model emits the call.

### Screenshots (`OpenPCB/qa3-shots/`)

`01-empty-state` · `02-composer-filled` · `03/04/05-stream-t2/6/12` · `06-simple-done` · `07/08/09-cdetail-*` · `10/11-search-*`
