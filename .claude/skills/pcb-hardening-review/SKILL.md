---
name: pcb-hardening-review
description: Delegates an explicitly-approved PCB-correctness hardening question to GPT-6-Astra via the Codex CLI — scoped ONLY to DRC, PCB geometry, manual routing (not the cloud auto-layout service), copper pours, ratsnest/connectivity, and ERC/electrical rules in OpenPCB. Astra attacks: it hunts counterexamples and specifies algorithms, it never writes code — Claude implements the fix. Codex runs read-only and makes no changes. Use only when the user explicitly invokes it for a DRC engine, PCB/schematic geometry, manual trace-routing, copper-fill, or electrical-rule correctness question. For routine review of anything else (UI, forms, CRUD, KiCad import plumbing, library editors, Electron), use codex-implementation-review or codex-plan-review instead — this skill will refuse and redirect. Trigger for any mention of: DRC hardening, clearance check correctness, polygon boolean correctness, copper pour / ground plane correctness, ratsnest / connectivity bug, manual routing algorithm (walkaround, tune, bundle, diff-pair), ERC / electrical rule correctness, signal integrity threshold, determinism / byte-identical DRC, adversarial geometry, ask Astra, GPT-6-Astra, gpt-6-astra.
disable-model-invocation: true
---

# PCB Hardening Review (GPT-6-Astra)

Independent, adversarial second opinion on PCB-correctness-critical code via the Codex CLI's
`gpt-6-astra` model. Codex runs read-only and does not modify the project. Astra's job is to
**attack and specify, never to implement** — findings come back as a hardening spec (failure
scenario, classification, fix direction), and Claude verifies and implements the actual fix. Run
only when the user explicitly invokes `/pcb-hardening-review`.

For anything outside the scope gate below, use the generic `codex-implementation-review` /
`codex-plan-review` / `codex-brainstorm` skills instead — those route across the
`gpt-5.6-terra/sol/luna` family and are the right (cheaper) tool for ordinary review.

## Why this exists, not the generic codex-\* skills

Astra (`gpt-6-astra`) is a scarce, high-cost resource shared with a ChatGPT Plus allowance —
unlike Fable/Claude's own budget. This skill exists to concentrate that scarce budget on the
~10-20% of PCB work where a subtly wrong algorithm produces a silently-wrong board: DRC
completeness, geometric correctness, routing determinism, electrical safety. Two consequences:

1. **Hard scope gate.** If the target isn't in-scope, this skill refuses and redirects — it does
   not "helpfully" run anyway at a lower bar.
2. **Packet-first, not repo-grazing.** Default access is prompt-only: Claude compresses the
   question into a minimal packet (see below) *before* calling Codex. This is the token-efficiency
   mechanism the skill exists for — Astra should spend its reasoning on the problem, not on
   rediscovering the codebase. Repository-grounded access (`-C`) is an explicit escalation, used
   only when cross-file grepping is genuinely required (e.g. "does any other check already assume
   this").

## Scope gate — check this before anything else

Read `${CLAUDE_SKILL_DIR}/references/scope-and-invariants.md` for the full table and quoted
invariants. Summary — in scope only if the target is one of:

| Area | Path |
|---|---|
| DRC engine + checks | `src/modules/designer/backend/drc/`, `src/shared/drc/rule-resolver.ts` |
| PCB geometry | `src/shared/pcb-geometry/` |
| Manual routing (route/walkaround/tune/bundle/diff-pair) — **not** cloud auto-layout | `src/shared/pcb-routing/`, `src/modules/designer/frontend/pcb/tools/` |
| Ratsnest / connectivity | `src/shared/pcb-connectivity/` (the kernel), `src/modules/designer/backend/pcb/{ratsnest,board-connectivity}.ts` |
| Copper pours / polygon booleans | `src/shared/rendering/copper-fill/`, `src/shared/rendering/pcb/` |
| ERC / electrical rules | `src/modules/designer/backend/erc/erc-engine.ts`, `src/shared/schematic-routing/` |
| Signal integrity / length matching | `checks/signal-integrity.ts`, `checks/length.ts` |
| Stackup / manufacturability / DFM | `checks/manufacturability.ts`, `checks/constraints.ts` |

Explicitly **out of scope** — refuse and redirect: `cloud-workspace/cloud-auto-layout/` (separate
repo, separate legality oracle — not manual routing); any UI/forms/CRUD/Electron/KiCad-import-UI/
library-editor code; anything with no correctness invariant at stake.

If the target straddles both (e.g. a route-tool UI component that also touches routing math),
scope the packet to only the math, and note the UI half is out of scope.

## Mode policy

Pick exactly one mode per run and state it in the approval summary:

- **`spec-attack`** — pre-implementation. You have a proposed algorithm/fix and want it attacked
  before writing code. Astra tries to prove completeness/break it with adversarial input.
- **`adversarial-verify`** — post-implementation. A diff, working tree, or specific file exists.
  Astra hunts for a counterexample that passes existing tests but violates an invariant.
- **`brainstorm`** — still exploring; no algorithm or diff yet, just a hard question (e.g. "is a
  spatial index actually necessary here", "how should degenerate geometry be handled"). Verdict-
  free, no approve/reject gate — same spirit as `codex-brainstorm`.

Full prompt scaffolds for all three modes: `${CLAUDE_SKILL_DIR}/references/attack-prompts.md`.

- Codex runs read-only (`-s read-only`) and `--ignore-user-config`. It may run read-only
  inspection commands only when repository-grounded access is explicitly approved; in the default
  prompt-only mode it reasons over the packet alone.
- Web search off by default (`web_search="disabled"`).
- Model is always `gpt-6-astra` — never silently substitute another model. A wrong model slug
  fails fast; there is no fallback to gpt-5.x for this skill (use the generic codex-\* skills if
  Astra is unavailable).
- Never silently change effort, access mode, or scope.

## Building the packet (do this before touching the command)

The packet is what keeps Astra's own token usage low — this is the entire point of the skill.
Assemble it yourself (main thread, no subagent) as plain text:

```
GOAL: <one line — what you need Astra to attack or specify>
MODE: spec-attack | adversarial-verify | brainstorm
SUBSYSTEM: <DRC | PCB geometry | manual routing | ratsnest/connectivity | copper-fill | ERC | signal-integrity | manufacturability>
COORDINATE DOMAIN: <nanometers (world/persisted) | millimeters (scene/DRC) | note any conversion boundary in play>
INVARIANTS: <verbatim-quoted, pulled from references/scope-and-invariants.md and src/modules/designer/AGENTS.md — do not paraphrase from memory>
KNOWN OPEN FINDING: <matching OpenPCB/docs/drc/OPEN_FINDINGS.md id + one-line summary, or "none found — checked">
CURRENT ALGORITHM / CODE: <minimal inlined excerpts only, file:symbol + short code block — NOT whole files>
PROPOSED ALGORITHM: <spec-attack only — pseudocode/description of the fix or design under attack>
DIFF: <adversarial-verify only — git diff, scoped to the relevant hunks, not the whole changeset>
EXISTING TEST COVERAGE: <list relevant test files + what they assert + what they do NOT cover>
RISKS / UNCERTAINTIES: <bullets>
QUESTIONS FOR ASTRA: <numbered, specific — this is what actually drives the response>
```

Rules:
- Do not paste entire files or unrelated modules. If code excerpts exceed ~150 lines, cut back —
  trim to the minimum needed to reproduce the question.
- Check `OpenPCB/docs/drc/OPEN_FINDINGS.md` for an overlapping finding before treating something
  as novel — if one exists, give Astra the finding id and ask it to attack a *proposed fix*, not
  rediscover the bug from scratch.
- Never invent manufacturing/electrical constants in the packet — pull them from `/eda-standards`
  or quote the exact value from source; if Astra asserts a different constant, flag it for
  verification rather than trusting it.

## Effort routing

Model is fixed to `gpt-6-astra`; only effort varies. Default **`high`**; escalate only with
explicit per-call approval.

| Situation | Effort |
|---|---|
| Bounded check within one file (e.g. verify one DRC check's completeness) | `high` |
| Cross-subsystem correctness (e.g. connectivity vs. ratsnest vs. copper-pour interaction) | `high`, escalate to `xhigh` on approval |
| Novel algorithm design/spec before implementation (routing kernel, geometry algorithm, spatial index) | `xhigh` |
| Adversarial counterexample hunting on shipped/critical code (determinism, polygon booleans, electrical shorts) | `xhigh`, escalate to `max` on approval |
| Exceptional hardest (disputed finding, multi-day regression) | `max`, explicit approval required |

- `max` requires explicit approval for the added cost every time — never default to it.
- `ultra` is listed as a valid effort for `gpt-6-astra` in the local Codex CLI config, but it is
  **unconfirmed** whether it engages genuine multi-agent behavior (as documented for `gpt-5.6-sol`)
  or is just a deeper single pass for Astra specifically. Treat `max` as the practical ceiling
  until `ultra` has been empirically verified; only use `ultra` with explicit approval and after
  telling the user this is unverified.
- A wrong effort string fails fast — no silent downgrade.

## Approval summary

Print this and wait for explicit approval before running:

```
PCB hardening review (GPT-6-Astra)
  Mode:         <spec-attack | adversarial-verify | brainstorm>
  Subsystem:    <DRC | PCB geometry | manual routing | ratsnest | copper-fill | ERC | signal-integrity | manufacturability>
  In scope:     <path(s) matched against the scope table>
  Model:        gpt-6-astra
  Effort:       <high | xhigh | max*>   (*max needs explicit approval; ultra unverified — flag if requested)
  Provider:     openai
  Access:       <prompt-only (packet) | repository-grounded>
  Working dir:  <neutral/empty | approved path>
  Web:          disabled
  Output:       attack-framed findings (Claude-parsed, not a patch)
  Purpose:      <one sentence>
```

## Command

```bash
codex exec \
  -m "gpt-6-astra" \
  -c 'model_provider="openai"' \
  -c 'model_reasoning_effort="<EFFORT>"' \
  -c 'web_search="disabled"' \
  -c 'approval_policy="never"' \
  -s read-only \
  --ephemeral \
  --strict-config \
  --ignore-user-config \
  - <<'CODEXEOF'
<ATTACK_PROMPT>
CODEXEOF
```

- Repository-grounded escalation: add `-C "<APPROVED_PATH>"` (sets working directory, not a read
  allowlist — state exactly which paths Astra should inspect in the prompt itself).
- Prompt-only (default): add `--skip-git-repo-check` and run from a neutral/empty directory.
- Web only on explicit approval: `-c 'web_search="cached"'` (or `"live"`).
- Never use `workspace-write`, `danger-full-access`, or
  `--dangerously-bypass-approvals-and-sandbox`.
- `<ATTACK_PROMPT>` = the packet above, wrapped in the mode's scaffold from
  `${CLAUDE_SKILL_DIR}/references/attack-prompts.md`.

## Multiple runs

Run one primary attack. A second pass is justified only with a genuinely different angle (e.g. a
`spec-attack` before implementing, then a separate `adversarial-verify` after) — never re-run the
same packet hoping for a different answer. Each additional run needs approval.

## Secrets

Never put secrets, tokens, keys, `.env` contents, or production data in the packet. Keep the
packet within the intended subsystem; do not direct Codex to read credential files.

## Failure policy

1. Report the exact error.
2. Retry once with identical settings only for a likely-transient failure.
3. Lower effort only for a confirmed cost/quota/latency issue, and only with approval.
4. If `gpt-6-astra` is unavailable, stop and offer the generic `codex-plan-review` /
   `codex-implementation-review` at `gpt-5.6-sol`/`xhigh` as an explicitly-labelled substitute —
   never silently substitute a different model under the Astra label.
5. Auth, missing-CLI, invalid-model, permission, and config errors are not fixed by lowering
   effort — surface them.

## Integrating the result

Astra's output is a hardening specification and a set of attack findings — **not code**. For each
finding: verify it against the actual source before acting (basis: verified|inference|unknown),
reject unsupported claims, check any cited constant against `/eda-standards` or source, and note
whether it maps to an existing `OpenPCB/docs/drc/OPEN_FINDINGS.md` id. Claude (or the user)
implements the fix; do not ask Astra to write the patch, and do not paste Astra's raw output as a
finished review. State which findings were accepted, rejected, or need more investigation, and why.
