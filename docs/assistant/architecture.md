# Assistant architecture — decision record

> This is the durable architecture record for the AI assistant. It replaces two implementation
> specs that were written as forward plans, shipped, and then superseded: the v1 assistant
> specification and the agentic-loop upgrade handoff. Their phase plans, track tables, file-
> ownership matrices and task checklists are in git history and are **not** repeated here.
>
> What survives is only what is still binding: the boundaries the code must respect, the
> invariants that turned out to be load-bearing, the decisions that are contract-level and
> recorded nowhere else, and the approaches that were tried and failed.
>
> Every rule below is written as a current rule. Each carries the reason it exists, because a
> rule whose reason is lost gets deleted by the next person who finds it inconvenient.

---

## 1. Package boundaries

### 1.1 `@openpcb/ai-core` must not import

`@openpcb/ai-core` is a published, standalone package. It owns the OpenAI-compatible fetch
client, provider preset metadata, tool definition types, the tool registry, tool
argument/result validation, run-loop primitives, streaming run events, the context-binding
model, the source/citation model, prompt preset composition, adaptive output-cap helpers, and
the generic search/rewrite/rerank interfaces.

It **must not import**:

| Forbidden import | Reason |
|---|---|
| OpenPCB core or module contracts | The package must build and test with no OpenPCB app present |
| Designer / Library SDKs | Same; also keeps the tool layer app-agnostic |
| Tasks module types | Same |
| Cloud Hono / auth / db code | The package is consumed by both app and cloud; depending on either forks it |
| React / DOM / Electron | It runs headless, in tests, on a server, and in a desktop process |
| Provider SDKs (OpenAI, Anthropic, Vercel AI) | Locks the package to one vendor's release cadence and breaks local providers |

Runtime dependency policy: **prefer zero runtime dependencies**; use global `fetch` for all
transport. Ajv is the one deliberate exception (see §4.1) and was added with that policy
explicitly in view.

**Dependency direction is `contracts → ai-core`, never the reverse.** `@openpcb/contracts` may
depend on and re-export `ai-core` types; `ai-core` must never depend on `@openpcb/contracts`.
This was chosen over duplicating minimal wire DTOs in `contracts` because duplication drifts,
and it is the only arrangement that has no cycle.

### 1.2 Shared packages stay pure

- Do not import OpenPCB app internals into shared packages.
- Do not import Cloud internals into shared packages.
- Keep shared packages pure and deterministic — no ambient clock, no global config read, no
  hidden IO. This is what makes their test suites meaningful and what lets the same code run
  in the desktop app and in cloud handlers.

### 1.3 Module import discipline

OpenPCB module code imports from `core/contracts/*`, `sdks/*`, `shared/*` and shared npm
packages — **never from core internals**. Core is infrastructure; reaching into it from a
module inverts the layering and makes the module unloadable in isolation.

---

## 2. Tool-surface constraints that remain policy

These come from the v1 specification's implementation-constraints section. Only the ones still
in force are listed. See §2.1 for the ones that are explicitly dead, so nobody re-imposes them.

| Rule | Reason |
|---|---|
| Do not expose raw projections by default | A schematic/PCB projection is unbounded; dumping it into a prompt is the fastest way to blow the context window and produce an empty answer. Raw data is available only through an explicit debug path when `allowRawToolData` is set. |
| Never return binary or model blobs from a tool | No GLB, STEP, image or other binary payload in an `AiToolResult`. It is unreadable by the model, it is enormous, and it defeats every output cap. |
| Every tool populates `sources` | Citations are what make grounded answers auditable. A tool that returns facts without provenance produces answers nobody can check. |
| Every tool sets `truncated` when capped | Silent truncation makes the model confidently wrong about data it never saw. |
| Compact summaries by default | The default shape of a tool result is the smallest thing that supports a decision, not the full record. |

### 2.1 Superseded constraints — do not re-impose

The v1 spec also carried "keep v1 read-only", "no write tools", "no schema-validation
dependency", and "no Designer sidebar". **All four are obsolete and are contradicted by
shipped code.** Write tools, a proposal/apply pipeline, Ajv validation and the docked Designer
chat panel all exist. They are recorded here only so that a reader who finds the old spec in
git history does not mistake it for current policy.

### 2.2 Adaptive output caps

Per-tool byte caps derive from a user-facing `contextSizePreference`, refined by the model's
known context size when available:

| Preference | Cap per tool |
|---|---|
| `small` | 16–32 KB |
| `medium` | 64 KB |
| `large` | 128 KB |

These are the live semantics of the setting, not a proposal. The reason caps are per-tool
rather than per-turn is that a single oversized tool result is the common failure, and a
per-turn budget cannot be enforced before the tool runs.

### 2.3 Tool naming

Tool names use **provider-safe underscore names with no dots** — `library_search_components`,
`designer_get_design_summary`. The registry enforces this with a name-pattern check at
registration. Dots are rejected by several OpenAI-compatible servers and by some function-call
grammars; underscores work everywhere. The registry check is the enforcement point, so a new
tool with a bad name fails at startup rather than at the first user request.

---

## 3. The invariants that paid off

### 3.1 Generic context-binding storage

The v1 product shape was one design per chat. The schema deliberately did **not** encode that.
Context is stored as a generic `AiContextBinding[]`; the single-design rule lived in the
adapter and UI layers only.

The reason recorded at the time was defensive: "v1 decisions becoming permanent" was listed as
a known risk, and the mitigation was to keep v1 constraints as adapter rules, never schema
rules.

That bet has now paid. The MCP integration retargets the design **per connection**: an
explicit `designId` wins, otherwise the connection's pin set by `designer_use_design`, otherwise
the UI-active design pushed from the focused designer tab, otherwise the connection's last design
(with a warning). Every existing designer tool works unchanged under MCP because it resolves its
design through the context resolver rather than through a hardcoded one-design assumption. That is exactly the flexibility the
generic binding bought, and it was bought years before there was a caller who needed it.

**Rule going forward:** product-level scoping rules (one design per chat, one chat per panel,
one active design per window) are adapter and UI concerns. They do not go into the schema.

### 3.2 MCP connections are real chats

The MCP server sits inside the assistant module rather than beside it. Each MCP client (keyed on
a header-stable client key, never the display name) gets real assistant chats: one **home** chat
that is never bound to a design, and one chat **per design**, bound once when it is created and
never rebound. A tool that binds the home chat (`designer_create_design`,
`designer_resolve_design`) turns it into that design's chat and a fresh home chat is created on
the next call. This is a direct consequence of §3.1: because context binding is generic and
design resolution goes through the resolver, projecting the in-app tool registry over MCP
required no changes to the tools themselves.

Two further decisions follow from "one audit trail, not two":

- **Every MCP call is recorded** as a visible assistant activity message plus a tool event on
  the chat it ran in. Proposal cards render from tool events, so a pending deletion Claude Code
  proposed shows an approval card in the panel exactly as an in-app one does. The recorder is
  MCP-specific on purpose: the run service's `role: "tool"` replay messages would corrupt the
  in-app model's history.
- **Approval stays in the app.** Destructive writes, rule and net-class changes, and design
  deletion wait for the user in the OpenPCB panel. The external agent can only observe the
  decision (`assistant_await_proposal`), never make it.

The transport is stateless per request (the MCP SDK serves 2025-era clients without an
`Mcp-Session-Id`), so connection state lives in `McpConnectionRegistry`, keyed on
client + per-process instance id, not in the transport. Operational detail — endpoint, auth,
identity headers, tool inventory, approval tiers, the stdio bridge, launcher and plugin — lives
in `CLAUDE.md` (MCP section); the review that produced this shape and the user guide are in
`docs/assistant/mcp-claude-code.md`.

---

## 4. Locked decisions — the agentic run loop

These are contract-level. They are the shape of the interface between the model, the tool
layer and the verifier, and they are recorded nowhere else in the repo.

### 4.1 Schema validation: Ajv, at registration, before exec

**Decision:** Ajv is the schema validator in `ai-core`. Each tool's `inputSchema` is compiled
**once at registration** and the compiled validator is cached on the registry entry. The run
loop calls `validateToolInput` **before** `executeToolSafely`; on failure it emits a tool
failure with an actionable message (path, expectation, example), feeds that back to the model,
and **does not execute the tool**.

**Why Ajv and not the hand-rolled validator:** the pre-existing `validateAgainstSchema` did not
support `oneOf`, `enum`, `maxLength` or `additionalProperties`, which meant a discriminated
union like a wire endpoint could not be validated at all. Adding a runtime dependency to a
zero-dependency package was accepted specifically to buy that.

**Why compile at registration:** compiling per call is the naive placement and it is a hot-path
cost on every tool invocation of every turn. Registration happens once.

**Why validate before exec:** an invalid argument that reaches the tool becomes a thrown
exception or, worse, a silently wrong query. Validating first turns it into a structured,
model-readable correction that the loop can recover from in one iteration.

`parseToolArguments` and `validateAgainstSchema` remain exported — other callers and tests
depend on them.

### 4.2 The Definition-of-Done verifier: four hard-fail checks

A build run is not done because the model said it was done. It is done when all four of these
pass:

| # | Check |
|---|---|
| 1 | Every BOM line is placed |
| 2 | Every required net is wired |
| 3 | No dangling power or ground |
| 4 | ERC error count is exactly zero |

All four are **hard fails**. There is no partial credit and no warning-level variant, because
the failure mode this exists to prevent is a run that reports success on a schematic that is
missing wires.

### 4.3 Correction retry: dynamic shrink-or-stall

**Decision:** on a failed DoD check, retry **while the set of failing check IDs is shrinking**;
**stop on stall**.

**Why not a fixed retry count:** a fixed count is wrong in both directions. Too low and it
abandons a run that is converging; too high and it burns tokens looping on a defect the model
cannot fix. Keying on the failing-check-ID *set* (not the count) means a retry that fixes one
check and breaks another registers as a stall, which is the correct reading.

### 4.4 The balanced model envelope

**Decision:** what the model sees is not what the UI sees.

- The model receives `{ ok, status, warnings, truncated, summary }` plus the
  decision-relevant data inline.
- The full payload goes to the UI only, through a separate field.

Concretely: `AiToolResult` carries optional `modelData`, `summary` and `status`; the run loop
builds `modelResultJson` from `modelData ?? data` plus the envelope and pushes that as the
tool-role message, while emitting the full `data` for the backend to persist.

**Why balanced rather than full or minimal:** feeding the full payload is what blows the
context window; feeding a bare `ok` flag strips the model of what it needs to decide the next
step. The envelope is the smallest thing that supports the decision.

**Why a new field rather than changing the persisted result:** the persisted and UI-facing
`resultJson` stays the full payload, so no frontend card had to change when this landed.

`status` is `"ok" | "partial"`. **On `partial`:** report the exact deficiencies and written
suggested fixes, and take **no further automatic action**. The reason is that the ambiguous
middle — a half-applied change plus an optimistic retry — is the state that is hardest for a
user to recover from.

### 4.5 `action_id` idempotency contract

Write tools take a model-generated `action_id`. Re-using the same `action_id` is a safe no-op.

| Element | Value |
|---|---|
| Format | `<verb>_<primaryKey>_<designId>` |
| Examples | `place_R1_<designId>`, `wire_U1.OUT__R1.1_<designId>` |
| Validator regex | `/^[a-z]+_[^_]+.*_[A-Za-z0-9-]+$/` |
| Model-facing description (`ACTION_ID_DESC`) | "Stable idempotency key you generate: `<verb>_<primaryKey>_<designId>` (e.g. `place_R1_<designId>`, `wire_U1.OUT__R1.1_<designId>`). Re-using the same action_id is a safe no-op." |

The server validates the *shape* only; it does not attempt to derive or correct the key.

**Why the model generates it:** the retry loop replays turns. Without a key the model
controls, a retried turn is indistinguishable from a new intent, and a correction pass
double-places every part it already placed.

**Why the exact description string is recorded here:** it is the model-facing contract. Reword
it and you change behaviour — the "safe no-op" clause is what makes a retrying model willing
to re-send rather than invent a new key to be safe.

### 4.6 Plain Chat Completions only

**No Responses API. No provider-specific features.** The assistant must run against local
LM Studio, Ollama and oMLX servers, which implement plain Chat Completions and nothing else.
Any feature that only exists on one hosted provider is out of scope by construction.

This is a product constraint, not a technical preference: local-first operation is the point of
the product, and it has no other home in the documentation.

A related consequence: reasoning-register detection is done by **capability probe** — either
`reasoning_content` is present in the stream, or the probe truncates — rather than by provider
or model name, because model names on local servers are user-chosen strings.

### 4.7 Connectivity semantics — what "connected" means

A pin is connected only if its net has **another real endpoint**: at least two pin IDs, or a
wire, or a label, or a power/ground/net-portal primitive — or an explicit no-connect marker.

**Why this is here rather than in the designer docs:** the verifier in §4.2 is only as good as
this predicate. The original defect was that a net was minted for every pin, so an
electrically isolated pin looked connected to everything downstream, and the DoD verifier
happily passed a floating design.

Warning policy that follows from it: **do not** warn on passive, output or NC pins left open —
open is legal for those. **Do** warn on a floating `power_in` or `input`.

---

## 5. Locked decisions — the schematic compiler

The assistant's build path is not "model emits commands". It is a compiler.

### 5.1 The pipeline

```
LLM  →  declarative circuit-spec IR  →  deterministic expander  →  ERC
```

**The IR stays TypeScript-internal. Only the expanded command batch crosses a boundary.**

**Why an IR at all:** a model emitting a command batch directly has to be right about
component references, pin identifiers, coordinates and ordering simultaneously. A model
emitting a declarative circuit spec only has to be right about the circuit. Everything else
becomes deterministic and testable.

**Why the IR does not cross a boundary:** the moment an IR is serialised over a wire it becomes
a public contract with versioning obligations. Keeping it internal means it can be refactored
freely; the only thing with contract status is the `DesignerCommand` batch, which already had
one.

### 5.2 Parameter calculation happens in the expander, not the LLM

Resistor values, divider ratios, timing components, decoupling values — computed by code in the
expander, not produced by the model.

**Why:** arithmetic is the thing language models are least reliable at and the thing that is
cheapest to make exactly right in code. It is also the thing whose errors are least visible in
review: a wrong resistor value looks exactly like a right one.

### 5.3 Local-first brain; cloud is a gateway, not an orchestrator

The orchestrator runs locally. Cloud provides **a model gateway and stateless tools**. Cloud
does not hold run state, does not drive the loop, and does not decide what happens next.

**Why:** the product works offline with a local model. If the loop lived in the cloud, the
local-only configuration would be a second, divergent code path rather than the same path with
a different endpoint.

### 5.4 Hybrid recipes

Primitives live in code. Functional blocks are planned as cloud-delivered **data**, later.

**Why the split:** primitives (decoupling, pull-up/pull-down, RC) are small, stable, and need
to work offline. Functional blocks are numerous, evolve fast, and are exactly the kind of thing
that should be updatable without shipping an app release. Making them data rather than code is
what allows that.

### 5.5 Apply policy

| Situation | Behaviour |
|---|---|
| Non-destructive change, ERC-clean | Auto-apply |
| Destructive change (deletion, overwrite) | Gate on explicit approval |
| ERC not clean | Self-correct, up to N attempts, then stop and report |

**Why non-destructive auto-applies:** requiring a click for every added resistor destroys the
value of an agentic build. **Why destructive is always gated:** the cost of a wrong deletion is
asymmetric and, given §5.7, not currently recoverable in one undo.

### 5.6 Guardrails

| Guardrail | Reason |
|---|---|
| **Clarify first** | A build run is expensive and hard to review. One clarifying question is cheaper than a wrong 30-part schematic. |
| **Installed parts only** | The assistant proposes only components actually present in the installed library. Inventing a part produces a design that cannot be placed, wired or ordered. |
| **Schematic only** | The compiler does not place or route the PCB. Schematic is a logical graph; PCB is a physical layout with its own constraint system. |

### 5.7 Current frontier

The next increment is more primitive blocks — decoupling, pull-up/pull-down, RC — followed by
the cloud data-recipe tier. Tracked in `TODO.md`; recorded here only so the §5.4 split does not
read as hypothetical.

---

## 6. Do not re-attempt

Each of these was tried and failed. The reason is recorded so the same approach does not get
proposed again by someone who only sees the symptom.

### 6.1 A provisional post-placement index for atomic place-and-wire

**Attempted:** make "place these parts and wire them" atomic by having the placement step
return a provisional index that the wiring step could reference.

**Why it fails:** `place_part` assigns the reference designator and the pin IDs itself, during
apply. `create_wire` needs concrete pin IDs. There is no point in the batch at which a caller
can know the IDs before the placement has been applied, so a provisional index is either empty
or a guess.

**Correct approach:** **apply-time deferred resolution** — carry symbolic endpoints through the
batch and resolve them against real IDs inside the apply step, where the placement result is
actually available.

### 6.2 Word-boundary token matching in the library resolver

**Attempted:** improve resolver precision by requiring query tokens to match on word
boundaries.

**Why it fails:** it destroys recall on part numbers. The token `555` no longer matches
`NE555`, which is the single most common search a hobbyist performs.

**The decisive fix is the category boost/penalty**, not the tokenizer. The concrete reason:
searching for an LDR surfaces resistors, because an LDR's own **description literally contains
the word "resistor"**. No amount of token-boundary tightening fixes that — only scoring the
candidate's category against the query's intended category does.

### 6.3 Surfacing a `category` or `type` column

**Attempted:** add a category/type column to the component schema and expose it in results, to
support category-aware ranking.

**Why it is unnecessary:** **category is already `tags[0]`.** The schema stores tags as a
single JSON column with no separate category field, and the pack builder derives `category`
from `tags[0]`. The column would be a denormalised copy of data that already exists.

This is why the resolver fix in §6.2 was implemented as **tag scoring** rather than as a schema
migration.

### 6.4 A ReAct loop-termination patch

**Attempted:** patch the run loop's termination condition so that a run which auto-applied a
placement would keep going and wire it.

**Why it is redundant:** the correction harness already re-drives wiring after auto-applied
placements. The patch addressed a symptom that another layer had already handled, and layering
a second termination rule on top of the harness produced double work, not more completion.

### 6.5 Assuming "single undoable batch"

**This is not true today.** The group identifier attached to a batch is **capture-only** — it
records which operations belonged together, but nothing consumes it to undo them as a unit.
Batch-undo grouping is backlog.

Any design, prompt, or user-facing copy that promises "undo the whole thing in one step" is
currently wrong. It is also the reason destructive operations are gated rather than auto-applied
(§5.5): there is no cheap recovery.

### 6.6 Layout invariant — auto-routes must not graze foreign pins

**Constraint:** the auto-route geometry emitted for a generated block must not pass through or
touch a pin belonging to another component.

**Why it is a hard invariant:** a naive one-row grid layout produced routes that ran across
neighbouring pins. Because a pin sitting on a wire is a junction, this **shorted every LED** in
the generated block — a design that looked correct and was electrically destroyed. The rule is
documented at the lowering step in the compiler, which is where the geometry is chosen.

---

## 7. What is not in this document

- Phase plans, wave/track partitions, file-ownership tables and per-task checklists from the
  two superseded specs. They described how the work was scheduled, not how the system behaves.
  They are in git history.
- MCP operational detail (endpoint, auth, connection keying, discovery, stdio bridge,
  launcher, plugin) — see `CLAUDE.md`; review, tool surface and user guide — see
  `docs/assistant/mcp-claude-code.md`.
- Chat and proposal presentation rules — see `docs/assistant/chat-ui-spec.md`.
- Designer data-model facts the assistant depends on (net-ID ephemerality, placement identity,
  board-settings blob) — see `src/modules/designer/AGENTS.md`.
