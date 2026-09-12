# Handoff — PCB correctness-hardening program, Session 13 (electrical-rule fidelity)

Session 3 · 2026-09-12

## Goal

One physical PCB model that connectivity, geometry, zones, pours, routing, DRC, manufacturing checks
and export all consume (`docs/pcb-hardening/PROGRAM.md`). This session delivered **S13 —
electrical-rule fidelity** (contract `docs/pcb-hardening/13-electrical-contract.md`, binding) and
committed it as `8214488` (S12b `ac968dd` and the contract 13 draft `01d3179` earlier in the same
session). The tree is clean.

## Original plan

`~/.claude/plans/resume-implementation-snappy-ullman.md` (approved 2026-09-11, rewritten for S13):
decisions D1–D10, WP0–6, the four user decisions (resolver constituent term; refuse + warn;
coated option → refined to per-item exposure; rules UI backend-only). Operating model as
`PROGRAM.md` "Standing instruction": plan mode (3 scouts + Opus plan-critique + an Astra
`brainstorm` on the design) → contract → Astra spec-attack → `impl-critical` / `impl-careful`
work packages → `reviewer-critical` → Astra repository-grounded adversarial-verify → gates →
docs; never commit / push / stash.

## Done so far (and why)

- **§3 the voltage term** — `rule-resolver.ts` → `voltage-term.ts`: the IPC-2221B spacing is a
  non-relaxable constituent of every resolved clearance (`ResolvedValue.{ordinaryMm, voltage}`,
  `mm` = their max); the judge reports `CREEPAGE_DISTANCE` as its own row (pre-S13 id derivation,
  strictest layer) beside the ordinary row; the pour halo, `zoneExclusions`, the route obstacles
  and the live gate (refuse) inherit it. The separate creepage loop is gone.
- **§4 effective nets** — `pcb-connectivity/effective-nets.ts`: connected components over
  trace / pad / via contacts at `SHORT_EPS_MM` (pours excluded, inexact pads never join, unplated
  pads one node per face); `tierNetOf` on the context; chain shorts via `checks/chain-short.ts`;
  the live gate's per-call overlay (`effective-net-overlay.ts`) rejudges existing items whose
  tier or exposure moved. B7-1 closed (`drc-audit-b7` live), the S7 chain limit closed.
- **§1.2 exposure** — `mask-exposure.ts` / `mask-exposure-overlay.ts`: B4 only on a coated board
  when neither item's copper meets any mask opening on that face (tenting is not coverage).
- **§2 voltages** — DC potential + optional `voltageMinV` / `voltageMaxV` interval, Δ at 1 µV,
  undeclared = reference (stated); magnitude caps; malformed input → `DRC_RULE_INVALID`, never
  assessed; the store persists declarations, only the resolver refuses them.
- **§5 current** — `currentItems` per-item form (tier net, inner / outer copper weight), live
  warning; `requiredTraceWidthMm` guarded both ways.
- **§6 constants** — Table 6-1 pinned to IPC-2221B from KiCad 8 @ `942661f` and smpspowersupply
  (fetched 2026-09-11; IPC-2221C differs, never mixed); the in-repo `eda-standards` references
  corrected (251–300 V row, 1.378 mil/oz, recomputed width tables).
- **Dead ends ruled out:** signed AC-peak subtraction (two 300 V-peak nets 180° apart → Δ 0);
  direct-adjacency effective nets (chains, pours, pending-only live judging); one row per pair
  (a waiver erases the other constituent); a global "coated" switch (exposed pads); via ampacity
  from barrel area (unverified thermal substitution); a rejudge budget (guarded nothing);
  `{}`-substituting a malformed interval at the store (erased a live requirement); tenting as
  coverage; sharing an unplated pad's node across faces.
- **Goldens:** `golden-electrical-2l` new (85 primitives, 26 violations / 7 codes, attributed);
  every pre-existing golden byte-identical (census walked cause by cause).

## How to resume

1. Run the `handoff` skill with "resume".
2. Read `docs/pcb-hardening/PROGRAM.md` (S13 bullet, S12c / S14 rows), contract 13,
   `src/modules/designer/AGENTS.md` "## DRC", the memory file `pcb-hardening-program.md`.
3. Verify HEAD is `8214488` on `master` with a clean tree and re-run the cheap gates:
   `cd src/core/backend && bun test drc- legality connectivity routing` and
   `npx tsc -b --force 2>&1 | grep -c "error TS"` (44, repo root only).
4. Next (all on the user's word): the S11 shared-tags follow-up once `../shared` is tagged; then
   S12c (polygon pads, needs the tags) or S14 (SI v1, no tag dependency) in plan mode via
   `/fable-orchestrator` + `/pcb-hardening-review`; the mechanical splits listed in `TODO.md`.

## Open questions

- Whether the user has tagged `../shared` (S11 fields) — S12c depends on it; S14 does not.
- A per-layer tier for split unplated pads and the judge's per-anchor direct bridge (06 §4) —
  recorded limits, owner S18.

## Pointers

- Tasks → `TODO.md` ("Now — handoff" block) · Snapshot → `CURRENT_STATE.md` · Session scratch →
  `/private/tmp/claude-501/-Users-andrejvysny-workspace-openpcb-OpenPCB/5cf59798-7b89-4741-9c64-204100af5304/scratchpad/s13/`
  (briefs wp2–wp5, Astra packets / outputs 0–2, sources/, r1 / r1b / r2 probes, gate logs;
  temporary).
