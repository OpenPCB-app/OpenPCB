# Scope table and quoted invariants

Read this before building any packet. Everything below is quoted or closely paraphrased from
source — verify against the live file if it looks stale; this reference is a packet-assembly aid,
not the source of truth.

## Scope table

| Area | Path | Astra routing |
|---|---|---|
| DRC engine + checks | `src/modules/designer/backend/drc/` (`checks/*.ts`, `drc-context.ts`, `severity.ts`, `violation-id.ts`, `ipc2221-spacing.ts`), `src/shared/drc/rule-resolver.ts` | ✅✅ always eligible |
| PCB geometry | `src/shared/pcb-geometry/` (`pcb-trace-geometry.ts`, `pcb-clearance-geometry.ts`, `pad-geometry.ts`, `pad-outline.ts`, `rotation.ts`) | ✅✅ |
| Manual routing (route/walkaround/tune/bundle/diff-pair tools) — **not** the cloud auto-layout service | `src/shared/pcb-routing/` (`route-obstacles.ts`, `collision.ts`, `corner-fixup.ts`, `pull-tight.ts`, `walkaround.ts`, `auto-finish.ts`, `meander.ts`, `bundle-geometry.ts`), `src/modules/designer/frontend/pcb/tools/` | ✅✅ |
| Ratsnest / connectivity | `src/shared/pcb-connectivity/` (`copper-records.ts`, `copper-items.ts`, `touch.ts`, `connectivity-graph.ts` — the one connectivity model, contract in `docs/pcb-hardening/01-connectivity-contract.md`), `src/modules/designer/backend/pcb/board-connectivity.ts` (items + pour nodes), `ratsnest.ts` (MST over kernel components) | ✅✅ |
| Copper pours / polygon booleans | `src/shared/rendering/copper-fill/` (`copper-geometry-kernel.ts` — the Clipper2 kernel; real in-tree code, **not** a package shim, unlike most of `src/shared/rendering/`), `src/shared/rendering/pcb/` (`outline-geometry.ts`, `chain-edges.ts`, `contour-validation.ts`, `outline-manufacturability.ts`, `pcb-drills.ts`); since S5 the fill is specified by `docs/pcb-hardening/04-copper-pour-contract.md` (S1 records as the one copper geometry, S2 region extent, per-net clearance tier, precedence, pad-local thermals, `buildCopperFillIslands` → `{ ok | failed }` in the total order, per-net Gerber unions) | ✅✅ |
| Copper zones / keepouts | `src/shared/pcb-areas/` (`zone-parse.ts`, `copper-zones.ts`, `keepout-predicates.ts`, `pour-params.ts`), the S4 consumers `drc/checks/{keepouts,zones,copper-pour}.ts`, `backend/pcb/placement-extent.ts`, `pcb-routing/route-obstacles.ts`, `frontend/pcb/drc/live-drc.ts` — contract `docs/pcb-hardening/03-zone-keepout-contract.md` (§13 legality); S5 consumers `drc/drc-context.ts` `pourResults()`, `export/gerber/writer.ts` `emitCopperPour`, `backend/pcb/board-snapshot-pours.ts`, zone holes (`zone-parse.ts` `zoneRegionValidity`) | ✅✅ |
| ERC / electrical rules | `src/modules/designer/backend/erc/erc-engine.ts`, `src/shared/schematic-routing/` (`manhattan.ts`, `schematic-autoroute.ts`, `wire-obstacles.ts`, `crossing-gaps.ts`) | ✅✅ |
| Signal integrity / length matching | `checks/signal-integrity.ts` (diff-pair skew/gap), `checks/length.ts`, `backend/pcb/diff-pair-resolver.ts` | ✅✅ |
| Stackup / manufacturability / DFM | `checks/manufacturability.ts` (via/drill/annular/aspect-ratio, FAB tier), `checks/constraints.ts` (stackup) | ✅ |

**Explicitly out of scope** — refuse and redirect to `/codex-implementation-review` or plain
Claude review:
- `cloud-workspace/cloud-auto-layout/` — a separate repo/service with its own legality oracle; not
  manual routing, out of this skill's blast radius entirely.
- UI, forms, CRUD, Electron plumbing, KiCad import UI, library editors — no correctness invariant
  at stake that justifies Astra's cost.

## Coordinate contract (from `OpenPCB/CLAUDE.md`)

> **world = nanometres · scene = millimetres · screen = pixels**, with `NM_TO_SCENE = 1_000_000`.
> Integer nanometres are the persisted unit everywhere.

`src/shared/pcb-routing/` and `src/shared/schematic-routing/` operate in integer nanometres and
are explicitly deterministic (no `Math.random`/`Date.now`). DRC (`backend/drc/`) converts to an
mm-domain view for its checks (`drc-context.ts`). Always state which domain a packet's numbers are
in — a bug can be a units mismatch at this exact boundary.

## DRC invariants — verbatim from `src/modules/designer/AGENTS.md`, "## DRC" (re-verified 2026-09-08, S6)

> - **Net-class enforcement is partial.** `clearanceMm` resolves through the clearance path for
>   every net. `traceWidthMm`, `viaDiameterMm` and `viaDrillMm` are enforced by `checks/netclass.ts`
>   (`NETCLASS_*`, severity warning) **only for nets deliberately classed — an explicit
>   `perNetClassAssignments` entry or a GND/POWER name match**; nets that fall to the default class
>   (`defaultNetClassId` = the first class in the stored array — the order is semantic) get no
>   width/via check. `defaultViaProtection` and `color` feed route-tool defaults only. The
>   `netClassId` stored on a trace or via is a creation-time hint; no legality consumer reads it.
> - **One rule resolver** (`src/shared/drc/rule-resolver.ts` `createRuleResolver`, contract
>   `docs/pcb-hardening/05-rule-semantics-contract.md`): explicit scoped `PcbDrcRule`s
>   (priority-descending first match, **may relax** above the floor; `net`/`netClass` match on
>   either item, `area` needs both evaluation points in the same polygon, pour pair kinds only
>   through an explicit `pairKind` scope) → implicit `max(designRule[pairKind], netA, netB)` → the
>   `minimums.clearanceMm` floor; scalar kinds resolve the same way with the board minimum as
>   their floor and ARE enforced. Batch DRC, the live route gate, route obstacles, the pour
>   composition and the via insert gate all consume it — there is no other clearance formula.
>   Area scopes are evaluated on regions of constant membership, never at a representative point.
>   Severity: `override → matched rule → DEFAULT_SEVERITY_BY_CODE`; drafts carry no severity
>   literal. Invalid / partially ineffective rules are reported (`DRC_RULE_INVALID`,
>   `DRC_RULE_INEFFECTIVE`). Clearance comparisons use `clearanceViolated` (0.5 nm float grace).
> - **Dispatch is a hardcoded array, not a registry.** `runDrc` is one monolithic function: it
>   builds one `DrcContext`, runs thirteen pure `(ctx: DrcContext) => DrcViolationDraft[]` checks
>   into a flat list, then applies ignores, waivers, severity and ids in a single pass.
>   `DrcContext` carries traces, pads, vias and holes, plus (S3a) the effective `copperZones` /
>   `keepouts` and (S4) `copperAreaWarnings` and a lazily resolved `placementExtent(id)` — checks
>   read those, never `projection.zones` / `projection.keepouts`.
> - **`DrcRuleClass` has eight values:** `clearance | constraint | connectivity |
>   manufacturability | structural | dfm | electrical | signal-integrity`. There is **no
>   `copper-pour` class** — pour islands report under `structural`.
> - Violation ids (v2) hash the code, the **sorted** anchor keys, the layer, and a 0.1 mm location
>   bucket for pairwise codes — order-independent by construction. `measuredMm` is never hashed.
> - **Connectivity has one model: `src/shared/pcb-connectivity/`.** Records (one geometry
>   resolution per pad / free pad / trace / via) → fail-safe items → copper-overlap touch predicates
>   → union-find graph with end-cap and via-layer contact records. Contract:
>   `docs/pcb-hardening/01-connectivity-contract.md`. `pcb/ratsnest.ts` is an MST over kernel
>   components (`pcb/board-connectivity.ts` adds one node per filled pour island, members from the
>   fill kernel); `checks/dangling.ts` is a lookup into the contact records; `checks/connectivity.ts`
>   reads the ratsnest. There is no net-name rule anywhere — GND shows airwires until a GND pour
>   exists. Two layer policies share the one geometry: connectivity is fail-safe (a layer-invalid
>   pad or via occupies no layer), DRC short detection clamps such items to every layer; the DRC-side
>   graph (`ctx.connectivity()`) is always built from the fail-safe items. The remaining private
>   answers to "is this copper connected" — copper-fill island anchoring (done in S5 — `ISOLATED_COPPER_ISLAND` reads the component), routed-length sums in
>   `checks/length.ts` / `signal-integrity.ts` (S14), routing-obstacle and live-DRC pad layers (S8)
>   — are scheduled, not sanctioned. Never add another.
> - **Apply-time re-validation is a non-blocking backstop, not a gate.** Both cloud apply handlers
>   run `runDrc` and report the result but do **not** reject a bad envelope and do **not** persist
>   the report.

Also verified against `src/sdks/designer/types.ts`: `PcbLayerCount` is `2 | 4 | … | 32` (multilayer
is import-only — no UI writes it); `PcbViaType` is `through | blind | buried | micro` with span
topology enforced by `VIA_LAYER_SPAN` (non-through only behind `pcb.advancedVias`). `PcbZone` v2
and `PcbKeepout` are authored data as of S3b (`docs/pcb-hardening/03-zone-keepout-contract.md`
§12): six commands with parsers and undo, Zone/Keepout tools, and the per-layer copper fill is a
persisted board-zone row (`board:<layer>`), no longer view state. The full duplicate-model register (connectivity models — one
kernel after S1 —, one clearance resolver after S6, the arc flatteners) is in
`docs/pcb-hardening/00-ground-truth.md` §4 — cite it in any packet touching those boundaries.

## Zone / keepout invariants — from `docs/pcb-hardening/03-zone-keepout-contract.md` (S3a)

> A keepout `K` (ring, layers `Λ`, restrictions) is the **open interior** of its polygon on each
> layer in `Λ`. Touching the boundary is allowed — a keepout has clearance 0, so copper whose edge
> lies on the boundary (within `GEOM_EPS_MM`) is legal.

> `collectCopperZones({ zones, layerCount, knownNetIds? }) → { zones: EffectiveCopperZone[], warnings }`
> ... is the **only** place that decides which copper areas exist. ... every consumer reads
> `collectCopperZones`; since S3b it reads persisted zone rows only (board zones are rows with
> `region.kind === "board"` and id `board:<layer>`; there is no view-state input).

## Determinism contract — from `OpenPCB/docs/drc/OPEN_FINDINGS.md` §5.2

> The engine is a pure function. Grep-verified: no `Date`, no `Math.random`, no I/O anywhere under
> `drc/`. ... Violation ids are FNV-1a-64 over the rule code plus the **sorted** anchor keys, which
> makes them order-independent by construction rather than by convention.
>
> **The caveat that must survive:** reordering the *input* arrays changes presentation order — the
> order of `violations[]`, the key order of `countsByCode`, and anchor order within pairwise
> violations. Consumers that need canonical bytes across input reorderings must **sort by
> violation id** first.

## Epsilon policy — from `OpenPCB/docs/drc/OPEN_FINDINGS.md` §5.1

Comparison regimes, unified in `src/shared/pcb-geometry/tolerance.ts` (`backend/pcb/tolerance.ts` is a
re-export shim; `below`/`exceeds`, `DRC_EPS_MM = 1e-6`, `SHORT_EPS_MM = 1e-4`, `GEOM_EPS_MM = 5e-7`,
`clearanceViolated`) — re-verified 2026-09-08 (S7), record in `docs/pcb-hardening/06-batch-drc-contract.md` §5:

| Regime | Form | Applies to | Boundary behaviour |
|---|---|---|---|
| Minimums | `below(v, limit)` = `v < limit − 1e-6` | Manufacturability minimums, board checks | Exact-spec geometry passes; sub-nm float noise forgiven |
| Clearance | `clearanceViolated(gap, required)` = `gap < required − GEOM_EPS_MM` (0.5 nm grace, S6) | All copper clearance pairs, copper-to-edge, copper-to-hole (S7) | Exact equality passes, derived floats forgiven; a 1 nm deficit still errors |
| Fab capability | `below(gap, fabMin)` | `FAB_CLEARANCE`, `FAB_HOLE_TO_HOLE`, fab validators | Minimums regime, not the clearance one |
| Short | `gap <= SHORT_EPS_MM` (1e-4), **inclusive** | Short tier | A gap of exactly 1e-4 mm is a short |

If a packet touches any comparison logic, quote the relevant regime — do not let Astra assume a
uniform epsilon.

## Net-class resolution chain — from `OpenPCB/docs/drc/OPEN_FINDINGS.md` §5.3

`resolveNetClassId` resolves in order: (1) explicit `perNetClassAssignments[netId]` if still
valid, (2) anchored name regexes tried `GND_NAMES` → `POWER_NAMES` → `POWER_VOLTAGE` (fully
anchored — `GND_SENSE` does not match `GND`), (3) `board.netClasses[0]` as a silent, array-order-
dependent fallback for everything else. Step 3 is untested and fragile — flag it explicitly if a
packet touches net-class resolution.

## Known open defect register

`OpenPCB/docs/drc/OPEN_FINDINGS.md` is the live defect register — 7 open DRC bugs remain after
S0–S7 (B2-5/6/7 + B6-1 → S11, B5-LIVE-ROT-PAD / B5-LIVE-TH-PAD-SIDE → S8, B5-SYNC → S10), each
with a `test.todo` regression test whose body is a real post-fix assertion (`rg -n "test\.todo\("
src/core/backend/tests/drc-audit-b*.test.ts` should show 7 call sites; if the count drops without
a finding being removed from the doc, the register is stale). The program that schedules the fixes is `docs/pcb-hardening/PROGRAM.md`; the verified
current-master inventory is `docs/pcb-hardening/00-ground-truth.md`. **Always check the register
for an overlapping finding before treating something as a new bug.**

The highest-severity, currently-unowned finding, quoted in full since it is the best worked
example of the bug class this skill exists to catch — a check that looks correct in isolation but
is unsound across a boundary:

> ## B3-1 — an unrouted `GND` net reports DRC-clean on a default board
>
> **Severity: HIGH.** This is the finding to escalate. A completely unrouted ground net on a
> default board produces no violation of any kind.
>
> **Mechanism.** The ratsnest builder drops GND-named nets *by name*, and it does so **before**
> any check for whether a copper pour actually exists. On a default board `copperFillLayers` is
> empty. So the two checks that should catch an unrouted ground both miss:
>
> - `UNCONNECTED_NET` (connectivity check) trusts `projection.ratsnest`. GND was suppressed from
>   the ratsnest, so there are no airwires, so there is nothing to report.
> - `ISOLATED_COPPER_ISLAND` (copper-pour check) only iterates board-wide fill layers. There are
>   none, so it never runs.
>
> The name-based suppression is only defensible if a same-net pour is guaranteed to satisfy the
> net. The doc comment in the copper-pour check asserts exactly that — **and it is false for this
> path**, because nothing verifies that a pour exists.
>
> **The test codifies the wrong behaviour.** The ratsnest test suite contains an assertion that a
> GND net with no routing produces no airwires. It passes. Fixing B3-1 means changing that test,
> not just the engine.
>
> **Anchors.** Ratsnest builder (`pcb/ratsnest.ts`), GND name-suppression branch · default
> `copperFillLayers` in `pcb-defaults.ts` · `checks/connectivity.ts` · `checks/copper-pour.ts`

Findings are owned by program sessions (see `PROGRAM.md`): connectivity B3-1/3/4/5/6 → S1;
geometry B4-1/2/6/7 → S2; pours B3-9/10 → S5; live parity B5-LIVE-ROT-PAD / TH-PAD-SIDE → S8;
B5-SYNC → S10; manufacturability B2-5/6/7 → S11. Check the owning session's scope before
building a packet on the same area.

## Manufacturing/electrical constants

Never invent a clearance, trace-width, via, or IPC-2221 value in a packet. Pull it from
`/eda-standards` (`.claude/skills/eda-standards/`) or quote it verbatim from source
(`ipc2221-spacing.ts`, `fab-presets.ts`). If Astra cites a different numeric value, flag it as
needing verification against `/eda-standards` rather than trusting it — `OPEN_FINDINGS.md` §5.7
notes the live JLCPCB capabilities page is the resolution rule of last resort for threshold
conflicts, not a cached table.
