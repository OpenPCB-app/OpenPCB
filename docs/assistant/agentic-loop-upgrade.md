# AI Assistant — Agentic Loop Upgrade (Implementation Handoff)

> **Audience:** independent (cloud) coding agents working in **parallel**.
> **Design goal of this doc:** zero schema / type / file conflicts between agents.
> Each Wave-1 track is self-contained — read **§Conventions**, **§Wave 0 (Contracts)**, and
> **your track**, and you can implement without touching another agent's files.

## 1. Why

The assistant builds PCB schematics by chaining tool calls (BOM resolve → create design →
place → read connectivity → wire). The engine (`@openpcb/ai-core` `runChat`) is a flat
ReAct tool loop that (a) feeds the model **untruthful tool results**, (b) can't reliably do
a full one-run build, and (c) never **verifies** the finished design. A best-practices pass

- a Codex (gpt-5.5, high) code review showed the loop has **deterministic correctness bugs**
  that must be fixed before any heuristic/prompt tuning, and the verification layer sits on a
  **broken ERC foundation**. This iteration delivers the corrected path (Phases 0–4).

**Scope this iteration:** P0 loop correctness → P1 schema validation → P2 tool staging →
P3 ERC semantics → P4 BOM-intent + DoD verifier. Prompt rewrite (P5) and dedup/stall
heuristics (P6) are deferred.

## 2. Constraints (do not violate)

- **Stay on plain Chat Completions.** Must run local LM Studio / Ollama / oMLX reasoning
  models. **No Responses API**, no provider-specific features.
- **ai-core is editable** but is a **published package** (`@openpcb/ai-core`, consumed via
  github tag). For local dev: from `OpenPCB/`, `npm run shared:link` points at the sibling
  `shared/` checkout; `npm run shared:status` / `shared:unlink` manage it. Source lives at
  `shared/packages/ai-core/`.
- **Backend tests = Bun** (`bun test`); **ai-core tests = Bun** (`cd shared && npm run test`).
- **Module SQL migrations auto-apply on backend boot.** Never write a standalone runner.
- Coordinate pipeline & rendering rules are irrelevant here (backend only).

## 3. Conventions (all tracks)

- **One feature branch off `master`.** Commit **per track** once that track's own tests +
  `npm run typecheck` pass. Disjoint file ownership (see §5 table) means parallel commits
  don't conflict. Concise imperative commit messages.
- **Before any commit:** `npm run typecheck` (root composite) and `npm run gen:check`.
  After ai-core edits: `npm run shared:link` then rebuild ai-core (`cd shared && npm run
build`) so the OpenPCB backend picks up changes.
- **No new shared type outside Wave 0.** If you need a cross-track type/signature, it is
  already defined in §Wave 0 — import it. Don't redefine.
- **Don't edit files outside your track's "Owns" list.** If you think you must, stop and
  flag it — it means the partition is wrong.

## 4. Locked decisions (context for choices)

| Topic                | Decision                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Iteration scope      | Phases 0–4 only.                                                                                                                   |
| ERC                  | Fix connected-semantics in designer + regression tests.                                                                            |
| Schema validation    | **Ajv** in ai-core (currently `dependencies: {}`).                                                                                 |
| BOM intent storage   | New assistant migration `0009_build_intent.sql`, keyed by chatId/taskId.                                                           |
| DoD hard-fail checks | All 4: BOM placed · every required net wired · no dangling power/gnd · ERC errors == 0.                                            |
| Correction retry     | **Dynamic** — retry while failing-check-ID set shrinks; stop on stall.                                                             |
| Idempotency          | `action_id` on write tools (upsert/no-op).                                                                                         |
| Register detection   | Capability-probe derived (`reasoning_content` present **or** probe truncation).                                                    |
| Model envelope       | **Balanced**: `{ok,status,warnings,truncated,summary}` + decision-relevant data inline; full payload → UI only via separate field. |
| On partial           | `partial` status + exact deficiencies + written suggested-fixes; no further auto-action.                                           |
| `action_id` format   | Model-generated `<verb>_<primaryKey>_<designId>` (e.g. `place_R1_<designId>`); server validates shape.                             |

---

## 5. Conflict-avoidance model

1. **Wave 0 (serial, one agent):** lands all new types / event codes / function signatures
   (+ compile-time **stubs**). Blocks Wave 1.
2. **Wave 1 (five agents, parallel):** disjoint file ownership; cross-track interaction
   only through Wave-0 signatures.
3. **Wave 2 (serial, one agent):** integration — wire seams, prove end-to-end.

Only **Track E** authors a DB migration (no migration-number race). The frontend is
**untouched**: the model-facing slim payload is a **new** field; the persisted/UI
`resultJson` stays the full payload, so no card changes.

| Track                               | Owns (edits) ONLY                                                                                                                                                                                                                                                                              | Depends on (runtime, resolved in Wave 2) |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **A** ai-core engine                | `shared/packages/ai-core/src/runs/run-loop.ts`, `shared/packages/ai-core/src/providers/openai-compatible.ts`                                                                                                                                                                                   | B (real validator)                       |
| **B** ai-core validation            | `shared/packages/ai-core/src/tools/validation.ts`, `shared/packages/ai-core/src/tools/registry.ts`, `shared/packages/ai-core/package.json`                                                                                                                                                     | —                                        |
| **C** designer ERC                  | `src/modules/designer/backend/projection-world.ts`, designer ERC engine + its tests                                                                                                                                                                                                            | —                                        |
| **D** assistant write tools         | `src/modules/assistant/backend/tools/designer-tools.ts`, `src/modules/assistant/backend/proposals/proposal-apply-service.ts`                                                                                                                                                                   | —                                        |
| **E** assistant orchestration + DoD | `src/modules/assistant/backend/run-service.ts`, `src/modules/assistant/backend/tools/library-tools.ts`, `src/modules/assistant/backend/verification/*` (new), `src/modules/assistant/backend/context-summary.ts` (new), `src/modules/assistant/backend/migrations/0009_build_intent.sql` (new) | C (ERC), D (idempotency), A (envelope)   |

`openai-compatible.ts` lives under `providers/` (verified). ai-core `runs/` = `events.ts`,
`run-loop.ts`, `types.ts`; `tools/` = `limits.ts`, `registry.ts`, `types.ts`, `validation.ts`.

---

## 6. Wave 0 — Contracts (serial, one agent; blocks Wave 1)

Types/signatures + stubs only. **No behavior change.** End state: `npm run typecheck` green
in both `shared` and `OpenPCB`; existing tests unaffected.

### 0.1 `shared/packages/ai-core/src/runs/events.ts`

Extend the tool-result event data so the loop can carry a **balanced envelope** and new
warning codes. Keep existing fields; add optional ones (back-compatible).

```ts
// run.tool.succeeded data — ADD:
//   status: "ok" | "partial";
//   summary?: string;            // short human/model-facing line
//   modelResultJson?: string;    // slim payload for the model (see Track A/D)
// run.warning data.code — ALLOW new string codes:
//   "duplicate_loop" | "stall" | "tool_cap" | "timeout"  (P6; declare now, unused)
```

> Note: a `tool_call_cap` warning code already exists; keep it. The P6 codes are declared
> for forward-compat but not emitted this iteration.

### 0.2 `shared/packages/ai-core/src/tools/types.ts`

```ts
// AiToolResult<T> — ADD optional model-facing view (full result still default for UI):
//   modelData?: unknown;   // slim object the model should see instead of `data`
//   summary?: string;      // one-line status the model should see
//   status?: "ok" | "partial";
export type AiToolEnvelope = {
  ok: boolean;
  status: "ok" | "error" | "partial";
  summary?: string;
  warnings: string[];
  truncated: boolean;
  data: unknown; // modelData when present, else trimmed data
};
```

### 0.3 `shared/packages/ai-core/src/tools/validation.ts`

Keep the existing `validateAgainstSchema` (used elsewhere). **Add a stub** that Track B
replaces:

```ts
export type ValidationError = { path: string; message: string };
/** STUB (Track B replaces body with Ajv). Returns [] today. */
export function validateToolInput(
  schema: unknown,
  args: unknown,
): ValidationError[] {
  return [];
}
```

### 0.4 `src/modules/assistant/backend/verification/types.ts` (new)

```ts
export type DodCheckId =
  | "bom_placed"
  | "nets_wired"
  | "no_dangling_power"
  | "erc_clean";
export interface CheckResult {
  id: DodCheckId;
  passed: boolean;
  message: string; // actionable, includes refs/pins/nets
  affectedIds: string[];
}
export type DodStatus = "pass" | "partial";
export interface DeficiencyReport {
  status: DodStatus;
  checks: CheckResult[];
  failing: DodCheckId[];
}
export interface BuildIntentItem {
  role: string;
  componentId: string;
  quantity: number;
  value?: string;
  requiredNets: string[];
}
export interface BuildIntent {
  chatId: string;
  taskId: string;
  goal: string;
  items: BuildIntentItem[];
}
export interface DesignContextSummary {
  designId: string;
  name: string;
  schematic: {
    componentCount: number;
    netCount: number;
    unplaced: string[];
    openNets: string[];
  };
  pcb: { placed: number; unrouted: number };
}
```

### 0.5 `src/modules/assistant/backend/tools/action-id.ts` (new)

```ts
export type ActionId = string; // "<verb>_<primaryKey>_<designId>"
export const ACTION_ID_DESC =
  "Stable idempotency key you generate: `<verb>_<primaryKey>_<designId>` " +
  "(e.g. `place_R1_<designId>`, `wire_U1.OUT__R1.1_<designId>`). " +
  "Re-using the same action_id is a safe no-op.";
export function isValidActionId(s: string): boolean {
  return /^[a-z]+_[^_]+.*_[A-Za-z0-9-]+$/.test(s);
}
```

---

## 7. Wave 1 — Tracks (parallel)

### Track A — ai-core engine (Phase 0)

**Owns:** `runs/run-loop.ts`, `providers/openai-compatible.ts`.

**Current bugs (verified):**

- `executeToolSafely` returns `{ok:true, value:AiToolResult}` unless the tool _throws_. The
  loop checks `if (result.ok)` (the wrapper) → an `AiToolResult{ok:false}` is emitted as
  `run.tool.succeeded`. **Wrong.**
- Only `JSON.stringify(result.value.data)` is fed back — `warnings`/`truncated`/status lost.
- The assistant turn is assembled from streamed `delta`/`requested` events; if a provider
  returns a single `run.message.completed` (non-streaming) the turn can be missed.
- `max_tokens` only (some servers require `max_completion_tokens`).
- `finish_reason:"tool_calls"` with no reconstructable call can yield an empty success.

**Tasks:**

1. Branch on the **tool's own** ok: `if (result.ok && result.value.ok)` → succeeded;
   else `run.tool.failed` + feed error envelope.
2. Feed the model a **balanced envelope** (Wave 0 §0.2): build `modelResultJson` from
   `modelData ?? data` plus `{ok,status,summary,warnings,truncated}`; push that as the
   `role:"tool"` content. Emit `summary`/`status`/`modelResultJson` on the success event so
   the assistant backend can persist the full `data` separately (Track E/D supply it).
3. Use `run.message.completed.content/toolCalls` as the source of truth for the turn (treat
   deltas as display only).
4. Ensure **every** `run.tool.requested`/capped/duplicate call gets a terminal
   (`succeeded`/`failed`/`warning`) — no dangling state.
5. Call `validateToolInput(tool.definition.inputSchema, parsed.value)` (Wave 0 stub → Track
   B real) **before** `executeToolSafely`; on errors emit `run.tool.failed` with an
   actionable message (path + expected + example) and feed it back; do not execute.
6. Provider: add `max_completion_tokens` fallback (retry/translate when a server rejects
   `max_tokens`); treat `finish_reason:"tool_calls"` with no valid call as warn/fail; guard
   against emitting `run.failed` twice.

**Tests (`shared`):** completed-only `{content}` → assistant content captured; completed-only
`toolCalls` → executes; tool returns `{ok:false}` → `run.tool.failed` + error fed back;
`maxCallsPerIter` exceeded → each skipped call still terminal; `finish_reason:"tool_calls"`
with empty tool name → warn/fail (not empty success).

**Done:** `cd shared && npm run test` green; `npm run typecheck`.

---

### Track B — ai-core schema validation (Phase 1)

**Owns:** `tools/validation.ts`, `tools/registry.ts`, `ai-core/package.json`.

**Tasks:**

1. Add `ajv` (and `ajv-formats` if needed) to `ai-core/package.json` (`dependencies` is
   currently `{}`).
2. In `registry.ts`, compile each tool's `inputSchema` **once at registration** (cache the
   validator on the registry entry). The tool name pattern check already exists — keep it.
3. Replace the Wave-0 stub `validateToolInput` body with a real Ajv run returning
   `ValidationError[]` (map Ajv errors → `{path, message}`). Must support `oneOf`, `enum`,
   `maxLength`, `additionalProperties` (the existing hand-rolled `validateAgainstSchema`
   does not — that's why `WireEndpoint` couldn't be validated).
4. Keep `parseToolArguments` and `validateAgainstSchema` exports (other callers/tests).

**Tests:** `{"source":{}}` against the `WireEndpoint` `oneOf` schema → non-empty errors;
a valid `{ "source": "U1.OUT", "target": "R1.1" }` → `[]`; enum/maxLength violations caught.

**Done:** `cd shared && npm run test` green; `npm run typecheck`.

---

### Track C — designer ERC connected-semantics (Phase 3)

**Owns:** `src/modules/designer/backend/projection-world.ts`, designer ERC engine file(s)
and their tests.

**Current bug (verified):** in `projection-world.ts`, `ensureNet(unionFind.find(...))` is
called for **every pin**, so an electrically-isolated pin becomes a net with a single
`pinId`. Downstream ERC then treats it as "has a net" ⇒ isolated input pins look connected.

**Tasks:**

1. A pin is **connected** only if its net has another real endpoint: ≥2 pinIds, OR a wire,
   OR a label, OR a power/gnd/net-portal primitive — OR an explicit no-connect marker.
   Either stop minting standalone nets for isolated pins, or tag single-endpoint nets so
   ERC/DoD can distinguish them (preferred: keep the net for rendering but expose an
   `isConnected`/`endpointCount` signal).
2. Update the ERC engine to flag genuinely open pins by electrical type (don't warn on
   passive/output/NC where open is legal; do warn on `power_in`/`input` left floating).
3. **Regression tests** pinning current ERC dock / DRC expectations so behavior shifts are
   intentional and reviewed.

**Tests:** projection with one `power_in` pin and no wires → ERC error; two pins on the same
node → connected (no error); NC-marked pin open → no error.

**Done:** `cd src/core/backend && bun test tests/` (designer suites) green; `npm run typecheck`.

---

### Track D — assistant write tools: idempotency + slim summaries (Phase 4a)

**Owns:** `src/modules/assistant/backend/tools/designer-tools.ts`,
`src/modules/assistant/backend/proposals/proposal-apply-service.ts`.

**Tasks:**

1. Add an optional `action_id` (string) to the input schema of the **7 write tools**
   (`designer_create_design` excluded if no entity key; include the 7 that mutate the
   schematic: place_components, propose_schematic_edits, propose_schematic_wires,
   arrange_schematic, propose_schematic_updates, propose_schematic_deletions, +
   create_design if desired). Use `ACTION_ID_DESC` (Wave 0 §0.5) in the description.
2. In `proposal-apply-service.ts`, make apply **idempotent**: if a proposal/op carries an
   `action_id` already applied for this design, no-op and report `already_applied` instead
   of duplicating placements/wires. (Wiring already resolves by `REF.PIN`; ensure place is
   keyed too.)
3. Populate each tool's `summary` + `modelData` (Wave 0 §0.2) so the model gets a slim,
   truthful view (`{appliedCount, skipped:[{id,reason}], status}`) while the full envelope
   remains for persistence/UI. **Critically:** auto-apply that fails must surface
   `status:"partial"`/`ok:false` (today it can return `ok:true` + warnings).

**Tests:** same `action_id` twice → second is no-op; partial wire (one bad pin) → applied
ops remain, skipped item reported with reason; failed auto-apply → `ok:false`/`partial`.

**Done:** `cd src/core/backend && bun test tests/` (assistant/designer write tests) green;
`npm run typecheck`.

---

### Track E — assistant orchestration + DoD verifier (Phases 2 + 4b)

**Owns:** `run-service.ts`, `tools/library-tools.ts`, `verification/*` (new),
`context-summary.ts` (new), `migrations/0009_build_intent.sql` (new).

**Current bug (verified):** `stageRegistryForBindings` is computed **once** before the run
from a pre-run `hasBoundDesign`. An unbound chat is locked to the 5 `UNBOUND_TOOL_NAMES`
for the whole run, so after `designer_create_design` binds mid-run, the **write tools are
never exposed** → the prompt's "create → place → wire in one run" can't happen.

**Tasks:**

1. **Staging (P2):** reproduce the above, then refresh the staged registry mid-loop after a
   binding appears (re-stage when `designer_create_design` succeeds), or expose the full set
   for create-capable runs while keeping payload lean. Verify reasoning models still emit.
2. **Intent (P4):** add migration `0009_build_intent.sql` (table prefix `assistant_`) for
   `BuildIntent`/`BuildIntentItem`; write a row from `library_resolve_bom` in
   `library-tools.ts` (capture goal + resolved items + required nets), keyed by
   chatId/taskId.
3. **`context-summary.ts`:** `buildDesignContextSummary(designId): DesignContextSummary`
   from the designer SDK (`getSchematicProjection`, `getPcbProjection`).
4. **`verification/run-dod.ts`:** `runDefinitionOfDone({chatId, taskId}): DeficiencyReport`.
   Take **one** projection snapshot; run ERC on that snapshot (don't race two SDK calls
   across revisions); read **proposal/apply status** (not tool `ok`) to know what applied.
   4 hard-fail checks → `CheckResult[]` with actionable messages + affected IDs.
5. **Correction harness in `run-service.ts`:** after `runChat`, run DoD. While failing,
   build a **fresh minimal context** (goal + `buildDesignContextSummary` + structured
   deficiencies, "fix these, don't touch correct parts") and re-invoke `runChat`. **Dynamic
   budget:** continue only while the failing-check-ID set shrinks; stop on stall (same IDs
   two attempts). On stop → `status:"partial"` + remaining deficiencies + a written
   suggested-next-steps message (no further auto-action). Idempotent re-runs rely on Track
   D's `action_id`.

**Tests:** BOM asks 2 resistors, 1 placed → fail w/ missing item; provider fails after a
successful write → verifier still runs on real state; max-iterations after writes →
verifier still runs; create in unbound chat → write tools available + verifier discovers
the new binding; stall → `partial` + proposed fixes.

**Done:** `cd src/core/backend && bun test tests/` green; `npm run typecheck` + `gen:check`.

---

## 8. Wave 2 — Integration (serial, one agent)

No new features; wire the seams and prove the path:

- `npm run shared:link`; rebuild ai-core; `npm run typecheck` + `npm run gen:check`.
- Verify **A↔B** (Ajv validation actually rejects bad args), **E↔C** (DoD ERC reflects real
  open pins), **E↔D** (`action_id` makes a forced re-run a no-op), **A↔E** (model receives
  the slim `modelResultJson` while UI keeps full `resultJson`).
- `cd src/core/backend && bun test tests/`; frontend smoke (cards still render full result).
- Manual: `npm run dev`, drive `DesignerChatDock` with "555 LED blinker" → one-run
  BOM→placed→wired, DoD pass, idempotent forced re-run; repeat on an oMLX reasoning model
  for no empty-turn regression.

## 9. Merge order

```
Wave 0 (contracts) ──►  [ A | B | C | D | E ]  (parallel) ──►  Wave 2 (integration)
```

Runtime couplings (compile independently via Wave-0 stubs/fields; asserted in Wave 2): A↔B,
E↔C, E↔D, A↔E.

## 10. Out of scope (next iteration)

- **P5 Prompt + context:** agentic-mode triad (persistence / tool-first / principled-stop),
  capability-probe register gating, inject live design summary into the system prompt, lean
  read-tool envelopes, additive presets.
- **P6 Dedup / stall heuristics:** fingerprint dedup keyed on `{tool, normalizedArgs,
designRevision}` + outcome; no-progress via design-revision signal; per-tool caps;
  wall-clock timeout. (The P6 warning codes are pre-declared in Wave 0.)
