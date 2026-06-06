# Assistant Module — Findings & Fix Handoff (single source of truth)

> Self-contained handoff from a manual QA + code-audit session (2026-05-29). A new coding session can plan/implement fixes from this file alone. Companion files: `OpenPCB/ASSISTANT_MODULE_TEST_REPORT.md` (full test log), `qa2-*.png` + `qa3-shots/*.png` (evidence screenshots).

## TL;DR

The Assistant **module** (full-screen space, not the Designer sidebar dock) is mostly functional. The headline problem is **frequent empty assistant responses** ("blank bubbles") when using the local **oMLX** provider with the reasoning model `Qwen3.5-27B-Claude-4.6-Opus-Distilled-MLX-4bit`. Ground-truth probes prove **the model + oMLX server are correct in isolation** — the defect is **OpenPCB-side**: (1) OpenAI `reasoning_content` is discarded, (2) sending all 13 tool schemas + a 5 KB system prompt on every call tips the reasoning model into reasoning-only/empty output, and (3) there is no fallback/affordance when a run completes empty. Plus a separate composer auto-grow UI bug.

---

## Environment / how to run & reproduce

- Monorepo: `/Users/andrejvysny/workspace/openpcb/` → `OpenPCB/` (app) + sibling `shared/` (the `@openpcb/*` packages, **including `ai-core`** where the core bugs live).
- Run: from `OpenPCB/` → `npm run dev` (backend Bun `127.0.0.1:3000` + Vite frontend `127.0.0.1:1420`). DB auto-migrates: `OpenPCB/src/core/backend/dev-data/openpcb.sqlite`.
- Provider: **oMLX** (OpenAI-compatible) at `http://127.0.0.1:8000/v1`, builtin id `omlx`, key stored in DB, default model = the Qwen3.5-27B above. **Use only that model; do not switch** (switching to gemma-4-26b / Qwen3.5-9B / Qwen3.6-27B OOMs — the server has a 16 GB ceiling and the 27B is resident; single-model = no OOM).
- Manual UI testing: `playwright-cli` (installed at `/opt/homebrew/bin/playwright-cli`). **Use `--headed --persistent` and real input** (`type`, `press`, `select`) — programmatic `fill`/`eval` on controlled inputs gives false negatives.
- Reproduce empty bubble: open Assistant → new chat → "Use library_get_component_detail for componentId openpcb.core.ic.ams1117-3v3-sot-223 and list its pins." → blank assistant bubble (or tool card with no answer text).
- Inspect ground truth (no UI): `GET /api/modules/assistant/chats/:id/messages`, `/tool-events`, `/write-proposals`; task SSE at `/api/modules/tasks/tasks/:taskId/stream` (watch for `run.message.delta` vs only `run.message.completed`).

---

## Issues (prioritized)

### 🔴 P0-1 — Empty assistant responses / blank bubbles (the headline bug)

**Symptom:** Assistant turn completes (`task status: completed`, `finish_reason: stop`) with empty `content` and no tool call → UI renders a bare "Assistant" bubble (no text, no error, no retry). Sometimes a tool card renders but no closing answer.
**Proven NOT the model:** direct `:8000` calls return correct content/tool_calls for the exact same turns (post-tool continuation: 6/6 produced 496–908-char pin lists; iter-1 with full prompt + **1** tool → valid `tool_call`). Simple chats also return content.
**Root cause (OpenPCB-side, three compounding factors):**

1. **`reasoning_content` discarded.** Streaming loop accumulates only `delta.content`:
   `shared/packages/ai-core/src/providers/openai-compatible.ts:180` (`if (typeof delta.content === "string" && delta.content.length > 0) …`). The reasoning model's output goes to `delta.reasoning_content`, which is never read. Final emit: `run.message.completed { content: aggregatedContent }` (~L239-248) with empty content.
2. **Context bloat tips the model into reasoning-only/empty.** Every call sends **all 13 tool schemas (~20 KB)** + the **~5 KB strict-grounded system prompt**. With 1 tool the model calls correctly; with the full payload it frequently emits no tool call and no content. Tool set assembled in `OpenPCB/src/modules/assistant/backend/run-service.ts:74-76` (`buildRegistry`); system prompt in `OpenPCB/src/modules/assistant/backend/prompt-service.ts` (`TOOL_INSTRUCTIONS` ~50 lines + preset).
3. **No empty-completed fallback/affordance.** Backend `run.message.completed` handler doesn't detect empty content: `run-service.ts` ~L216-238. Frontend renders nothing: `OpenPCB/src/modules/assistant/frontend/components/MessageCard.tsx` (blank when `!hasContent && !toolEvents.length && !runState`); run card removed on completion: `AssistantRunStatusCard.tsx` (`status==='completed' → null`) + `Space.tsx` (~L544 deletes run from `activeRunsByChat`). **Asymmetry to exploit:** cancelled/failed runs DO show a Retry button — completed-empty should behave the same.
   **Fix direction:**

- (a) In ai-core streaming, capture `delta.reasoning_content` (and `delta.reasoning`); on a turn that finishes with empty `content` + no tool calls, emit a distinct signal (e.g. `run.warning` code `empty_response`).
- (b) Reduce per-call payload: send only relevant tools (or stage tools), trim/condense `TOOL_INSTRUCTIONS`, and/or gate write-tool schemas until a design is bound. This is likely the **highest-impact single change**.
- (c) Guarantee a non-empty UX: auto-retry once on empty-completed, or render a "model returned no answer — Retry" state (reuse `AssistantRunStatusCard` `onRetry` plumbing) and optionally a collapsed "thinking" view of `reasoning_content`.

### 🟠 P1-2 — Tool-call capability probe false-negative disables all tools

**Symptom:** After Settings→Assistant→**Test** (or `POST /providers/omlx/capabilities/refresh`), `toolCalling` caches `false` → all tools silently disabled.
**Root cause:** probe uses `maxOutputTokens: 16` — `shared/packages/ai-core/src/providers/openai-compatible.ts` `probeToolCall` (dist line ~258). Reasoning model spends 16 tokens on `reasoning_content`, `finish_reason: length`, no `tool_calls` → reports `false`. At `max_tokens: 200`+ it returns valid `tool_calls`.
**Gate:** `OpenPCB/src/modules/assistant/backend/run-service.ts:75` → `providerAllowsTools = provider.capabilities?.toolCalling !== false`.
**Fix:** raise probe `maxOutputTokens` (≥256) and/or treat `finish_reason:"length"` as inconclusive (not `false`); don't hard-disable tools on a single cached probe (treat as soft hint). (Workaround used during testing: `DELETE FROM assistant_provider_capability WHERE provider_id='omlx';`.)

### 🟠 P1-3 — Composer textarea doesn't auto-grow (shows scrollbar)

**Symptom:** long/multi-line input scrolls inside a 1-row field instead of stretching up.
**Root cause:** `OpenPCB/src/modules/assistant/frontend/components/ChatComposer.tsx:113-125` — `<textarea rows={1}>` + `max-h-48` + `resize-none`, **no** `scrollHeight`→`style.height` logic.
**Fix:** on input, `el.style.height='auto'; el.style.height = Math.min(el.scrollHeight, MAX_PX)+'px'` (also reset to 1 row after send/clear).

### 🟡 P1-4 — `finish_reason: "length"` unhandled

Treated like a normal stop in the run-loop (`shared/packages/ai-core/src/runs/run-loop.ts`); should surface a "truncated" warning.

### 🟡 P2-5 — Chat-selection race

`OpenPCB/src/modules/assistant/frontend/Space.tsx:611-622` `refreshMessages` can set a stale chat's messages on rapid switching → guard with active-chat check / AbortController.

### 🟡 P2-6 — Title rename commit race

`Space.tsx:859-882` async commit + blur — add a "committing" state / reset draft on failure. (UI itself works — see "what works".)

### 🟡 P2 — Robustness/quality (audit)

- SSE/JSON parse errors silently skipped: `openai-compatible.ts` (`try{JSON.parse}catch{continue}` ~L172-176) — count/log, warn if mostly dropped.
- Error UI not dismissible / scrolls away: `Space.tsx` inline error (~L1255) — make a sticky/toast with dismiss.
- Retry-timer hygiene + dead `"disconnected"` status: `OpenPCB/src/modules/assistant/frontend/hooks/useAssistantStream.ts`.
- Accessibility: aria-labels on chat-list `role=button`, `aria-live` for status/errors, focus-visible in dark theme.
- Disabled stubs: "Export markdown" (`Space.tsx`), "Attach a file" (`ChatComposer.tsx`) — gate or remove.
- **Test gaps:** no backend tests for streaming / empty response / `reasoning_content` / probe `length` / finish-reason variants. Add under `OpenPCB/src/core/backend/tests/assistant-*.test.ts` (mock `client.streamChat`); add ai-core tests under `shared/packages/ai-core/tests/`.

---

## What WORKS (validated, don't "fix")

- Chat lifecycle: create, **rename** (real keyboard), search, filter tabs (All/Pinned/Linked/Archived), bulk + single **delete** (confirm dialog), reload persistence.
- Messaging: simple chat streams full content; **markdown** (lists, inline code, tables, fenced code, Mermaid) renders; **Shift+Enter** multiline; **slash `/`** quick-actions popover; **Stop** mid-stream → "Assistant task cancelled." + **Retry**.
- Read tools when the model emits the call: `library_search_components` (ComponentResultsBlock), `library_resolve_bom` (BOM table), `designer_resolve_design` (+auto-bind, "Linked" badge). Tool cards render args/result/sources/status; cross-checked via `/tool-events`.
- Write proposals (historical): PlacementProposalCard renders; Apply/Reject works; **Reject disabled** when already applied (re-action guard).
- Loading/streaming UI states are correct ("thinking…", "Writing response…" spinner + Stop + pulsing dots).
- Backend: no 5xx / exceptions during sessions.

## False negatives from the FIRST pass (do not re-investigate)

Inline rename, slash menu, multiline, partial-stop were reported PARTIAL in pass 1 — those were **test-method artifacts** (non-persistent CLI + synthetic events). All PASS with a headed/persistent browser + real input.

## Could NOT be validated (blocked)

- Write-tool **Apply** end-to-end via chat: the reasoning model doesn't emit write-tool calls (P0-1); validated only historically. Re-test once a tool-capable model that fits under 16 GB can load (or fix P0-1 #2 so the 27B emits calls).

---

## Where fixes live + workflow

- **ai-core bugs (P0-1 #1, P1-2, P1-4)** are in the **shared** package, consumed via github tag `ai-core-v0.1.0`. Edit source in **`/Users/andrejvysny/workspace/openpcb/shared/packages/ai-core/src/`**, then: `cd shared/packages/ai-core && npm run build`; from `OpenPCB/` → `npm run shared:link` (symlinks local build), `npm run shared:status` to confirm, `npm run shared:unlink` to restore. A real release bumps the tag.
- **OpenPCB-side fixes** (run-service, prompt-service, frontend `MessageCard`/`AssistantRunStatusCard`/`Space`/`ChatComposer`/`useAssistantStream`) are in `OpenPCB/src/...`.
- Reuse existing infra: `run.warning` event type, `appendMessageContent`/`setMessageContent` (`conversation-store.ts`), `AssistantRunStatusCard` `onRetry`, the capability cache table. Don't add new infra.

## Open questions for the fix phase

1. `reasoning_content`: show a collapsed "thinking" panel, or discard but guarantee a non-empty fallback? (Recommend: fallback + optional collapsed view.)
2. Is bumping a new `@openpcb/ai-core` tag in scope, or link-only locally until a separate release?
3. Tool-payload reduction strategy: dynamic relevant-tool selection vs static trim vs bind-gated write tools?

## Verification for any fix

Re-run headed (`--headed --persistent`, real input), 27B only, no model switching. Confirm: (a) component_detail/search produce a visible answer (no blank bubble), (b) write-tool call emitted → proposal card → Apply mutates the design (check `designer_get_design_summary` before/after), (c) composer grows with multi-line input, (d) Settings→Test no longer disables tools. Cross-check `/messages`, `/tool-events`, task SSE (`run.message.delta` present), and scan dev-server log + browser console.
