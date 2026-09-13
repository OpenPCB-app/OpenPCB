# Handoff — PCB correctness-hardening program, Session 14 (SI v1 mathematical correctness)

Session 4 · 2026-09-13

## Goal

One physical PCB model that connectivity, geometry, zones, pours, routing, DRC, manufacturing checks
and export all consume (`docs/pcb-hardening/PROGRAM.md`). This session delivered **S14 — SI v1
mathematical correctness** (contract `docs/pcb-hardening/14-si-contract.md`, binding) and
committed it as **`b417145`** on the user's "commit all" (a second commit carries the handoff
files). The tree is clean.

## Original plan

`~/.claude/plans/s14-si-v1-correctness.md` (rev 3): decisions D1–D7, WP0–6, eight user decisions
taken by default. Operating model as `PROGRAM.md` "Standing instruction": reconnaissance +
executed probes → Opus plan-critique (26 findings) → Astra spec-attack (15) → contract →
`impl-critical` WP1 / WP2 in parallel → `reviewer-critical` R1 (11) → `impl-careful` WP3 → WP4 ∥
WP5 → R2 (9) → Astra repository-grounded adversarial-verify (8) → fix rounds → gates → docs.

## Done so far (and why)

- **Junctions** (`pcb-connectivity/{junctions,contact-components,terminal-contact,island-contact,
  trace-arc}.ts`, `touch.ts` witness variants, `connectivity-graph.ts` opt-in
  `{ junctions: true }`): WHERE the S1 copper touches, one junction per contact component, from the
  same witness the union used; S1 components / contacts byte-identical either way.
- **Net path model** (`net-path.ts`, `net-path-graph.ts`, `net-path-uniqueness.ts`,
  `net-path-types.ts`): logical-pin terminals, terminal interiors clipped, zero-weight contraction,
  bridge-only-forest uniqueness, minimal terminal-spanning subtree, through-via z, pour-bypass
  contact sets; reasons `open | terminals | loop | pour | via | unresolved`.
- **Coupling kernel** (`drc/si/{coupled-span,intervals,length-target}.ts`,
  `pcb-geometry/segment-sublevel.ts`): exact sublevel intervals; `coupled` / `tight` gate-free,
  `wide` on near-parallel strips (direction-invariant 15° gate), per-axis sweep.
- **Consumers**: `checks/{length,signal-integrity,diff-pair-paths}.ts` on `ctx.netPaths()`;
  `NET_LENGTH_UNDEFINED`; `PcbDiffPair.couplingMaxGapMm`; one `diff-pair-resolver.ts` (bare
  `P/N` gone, conflicts / ambiguity reported); canonical `diffPair` anchor key; frontend
  `use-net-path-lengths.ts`, `tools/diff-pair.ts` shim, `PcbCanvas` gauges + `route/tune-hud-model`
  (`pathDefined` → "≈").
- **Findings**: B8-1..B8-7 registered from executed probes and closed the same day
  (`drc-audit-b8.test.ts` 8 live tests).
- **Goldens**: `golden-si-2l` new (104 primitives, 24 violations / 10 codes, attributed);
  `golden-census-2l` re-fixtured with pads + a looped `lg2`, 87 → 85, attributed; nine
  byte-identical.
- **Docs**: contract 14 (ledgers §12.0–§12.4), OPEN_FINDINGS (S14 section + §6.7), PROGRAM.md
  (S14 done + decisions + evidence), 00-ground-truth §4, 06 §5 regime rows, designer AGENTS.md
  "## DRC", hardening-skill scope, TODO.md release notes.
- **Dead ends ruled out**: shortest terminal-spanning walk (NP-hard); `wide` as a bare strip union;
  uniform-stackup inner-layer via z; summing off-band over both members; an angle-free `wide`.

## How to resume

1. Run the `handoff` skill with "resume".
2. Read `docs/pcb-hardening/PROGRAM.md` (S14 bullet; S15 / S12c rows), contract 14,
   `src/modules/designer/AGENTS.md` "## DRC", the memory file `pcb-hardening-program.md`.
3. Verify HEAD is the handoff commit after `b417145` on `master` with a clean tree and re-run the
   cheap gates: `cd src/core/backend && bun test drc-
   legality connectivity net-path coupled` and `npx tsc -b --force 2>&1 | grep -c "error TS"` (44,
   repo root only).
4. Next (all on the user's word): the shared-tags follow-up; then S15 (no tag dependency) or S12c (needs the tags) in plan mode via
   `/fable-orchestrator` + `/pcb-hardening-review`.

## Open questions

- Whether the user has tagged `../shared` (S11 fields) — S12c depends on it; S15 does not.
- `unresolved` path reason: no hand-written board reaches it (kernel-limit reason, reported).
- The coupling sweep axis is per layer; an S9-style grid only if a fixture ever shows the cliff.

## Pointers

- Tasks → `TODO.md` ("Now — handoff" block) · Snapshot → `CURRENT_STATE.md` · Session scratch →
  `/private/tmp/claude-501/-Users-andrejvysny-workspace-openpcb-OpenPCB/340ce36a-c0de-4c2c-b18e-0c0f3cb7c837/scratchpad/s14/`
  (probe tests, Astra packets / prompts / outputs 1–2, gate logs; temporary).
