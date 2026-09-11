# Scope table and quoted invariants

Read this before building any packet. Everything below is quoted or closely paraphrased from
source — verify against the live file if it looks stale; this reference is a packet-assembly aid,
not the source of truth.

## Scope table

| Area | Path | Astra routing |
|---|---|---|
| DRC engine + checks | `src/shared/drc/` (relocated in S8; `src/modules/designer/backend/drc/` is re-export shims) (`checks/*.ts`, `drc-context.ts`, `severity.ts`, `violation-id.ts`, `ipc2221-spacing.ts`, `legality.ts`, `broad-phase.ts` — the S9 grid, contract `docs/pcb-hardening/08-broad-phase-contract.md`; `worker/` — S10 execution plumbing, in scope ONLY for the byte-identity claim of `09-execution-contract.md` §6, never for lifecycle/UI questions), `src/shared/drc/rule-resolver.ts` | ✅✅ always eligible |
| PCB geometry | `src/shared/pcb-geometry/` (`pcb-trace-geometry.ts`, `pcb-clearance-geometry.ts`, `pad-geometry.ts` — incl. `padCopperShape`, the ONE world frame of a pad's copper, `pad-outline.ts`, `pad-annular.ts` — the S11 annular-ring kernel: analytic signed distances, breakout-first, copper-in-drill containment, contract `docs/pcb-hardening/10-manufacturability-contract.md` §3, `rotation.ts`, `board-region.ts`, `region-rings.ts`, `region-index.ts` — the S9 boundary-edge index) | ✅✅ |
| Manual routing (route/walkaround/tune/bundle/diff-pair tools) — **not** the cloud auto-layout service | `src/shared/pcb-routing/` (`route-obstacles.ts`, `collision.ts`, `corner-fixup.ts`, `pull-tight.ts`, `walkaround.ts`, `auto-finish.ts`, `meander.ts`, `bundle-geometry.ts`), `src/modules/designer/frontend/pcb/tools/` | ✅✅ |
| Ratsnest / connectivity | `src/shared/pcb-connectivity/` (`copper-records.ts`, `copper-items.ts`, `touch.ts`, `connectivity-graph.ts` — the one connectivity model, contract in `docs/pcb-hardening/01-connectivity-contract.md`), `src/modules/designer/backend/pcb/board-connectivity.ts` (items + pour nodes), `ratsnest.ts` (MST over kernel components) | ✅✅ |
| Copper pours / polygon booleans | `src/shared/rendering/copper-fill/` (`copper-geometry-kernel.ts` — the Clipper2 kernel; real in-tree code, **not** a package shim, unlike most of `src/shared/rendering/`), `src/shared/rendering/pcb/` (`outline-geometry.ts`, `chain-edges.ts`, `contour-validation.ts`, `outline-manufacturability.ts`, `pcb-drills.ts`); since S5 the fill is specified by `docs/pcb-hardening/04-copper-pour-contract.md` (S1 records as the one copper geometry, S2 region extent, per-net clearance tier, precedence, pad-local thermals, `buildCopperFillIslands` → `{ ok | failed }` in the total order, per-net Gerber unions) | ✅✅ |
| Copper zones / keepouts | `src/shared/pcb-areas/` (`zone-parse.ts`, `copper-zones.ts`, `keepout-predicates.ts`, `pour-params.ts`), the S4 consumers `drc/checks/{keepouts,zones,copper-pour}.ts`, `backend/pcb/placement-extent.ts`, `pcb-routing/route-obstacles.ts`, `frontend/pcb/drc/live-drc.ts` — contract `docs/pcb-hardening/03-zone-keepout-contract.md` (§13 legality); S5 consumers `drc/drc-context.ts` `pourResults()`, `export/gerber/writer.ts` `emitCopperPour`, `backend/pcb/board-snapshot-pours.ts`, zone holes (`zone-parse.ts` `zoneRegionValidity`) | ✅✅ |
| ERC / electrical rules | `src/modules/designer/backend/erc/erc-engine.ts`, `src/shared/schematic-routing/` (`manhattan.ts`, `schematic-autoroute.ts`, `wire-obstacles.ts`, `crossing-gaps.ts`) | ✅✅ |
| Signal integrity / length matching | `checks/signal-integrity.ts` (diff-pair skew/gap), `checks/length.ts`, `backend/pcb/diff-pair-resolver.ts` | ✅✅ |
| Stackup / manufacturability / DFM | `checks/manufacturability.ts` (via/drill/annular/aspect-ratio, FAB tier — since S11: tool- and plating-aware fab rows, `VIA_TYPE_UNSUPPORTED` on every fab, through-only aspect), `checks/constraints.ts` (stackup), `checks/structural.ts` (`NPTH_PAD_NET`), `fab-presets.ts` (sourced rows, fetch dates in the comments), `src/shared/rendering/pcb/pcb-drills.ts` (`footprintPadDrill` / `freePadDrill` — the ONE drill derivation per object, contract 10 §1) | ✅ |
| Exact geometry (S12b) | `src/shared/pcb-geometry/{rounded-shape,rounded-shape-types,canonical-contour,exact-arcs,exact-ring,exact-contour,exact-simplicity,region-build,region-rounded,region-exact}.ts`, `src/shared/drc/checks/{board,outline}.ts` (certified interval, exact validity), `src/shared/rendering/copper-fill/material-web-kernel.ts` (`OUTLINE_MIN_WEB`), `src/shared/rendering/pcb/contour-validation.ts` (the editor gate on the same predicate), `src/modules/designer/backend/export/gerber/arcs.ts` (Profile arcs); contract `docs/pcb-hardening/12-exact-geometry-contract.md` | ✅✅ |
| DFM overlays + copper shape (S12) | `src/shared/drc/checks/{courtyard,silkscreen,solder-mask,filled-gap,copper-shape}.ts`, `src/shared/rendering/pcb/artwork/` (the silk + mask artwork model — in-tree, shared with the Gerber writer), `src/shared/pcb-geometry/courtyard-rings.ts`, `src/shared/rendering/copper-fill/copper-shape-kernel.ts`; contract `docs/pcb-hardening/11-dfm-contract.md` | ✅✅ (polygon-topology checks post-implementation) |

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
are explicitly deterministic (no `Math.random`/`Date.now`). DRC (`src/shared/drc/`) converts to an
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
>   builds one `DrcContext`, runs seventeen pure `(ctx: DrcContext) => DrcViolationDraft[]` checks
>   into a flat list, then `finalizeReport` applies ignores, waivers, severity, ids, dedupe and the
>   canonical `(code, id)` sort in a single pass. Since S8 `DrcContext extends LegalityContext`:
>   `buildDrcItems` is the eager physical model (traces, pads, vias, holes under the clamp policy,
>   the board region, the effective `copperZones` / `keepouts` / `copperAreaWarnings`, the
>   resolver, a uniform-grid `near()` broad phase, the cached outline drafts) and `buildDrcContext`
>   adds the lazy layer (`copperItems`, `connectivity`, `pourResults`, `placementExtent(id)`).
>   Checks read those, never `projection.zones` / `projection.keepouts`. The live route gate and
>   the server commit gate call `checkPendingCopper` (`src/shared/drc/legality.ts`), which runs the
>   same pair bodies (`checks/clearance-judge.ts` `PairJudge`) and the same per-item forms over the
>   pending copper — contract `docs/pcb-hardening/07-live-parity-contract.md`.
> - **Candidate discovery is indexed; the exhaustive enumeration is the oracle (S9,
>   `docs/pcb-hardening/08-broad-phase-contract.md`).** `buildDrcItems` builds a per-kind uniform
>   grid (`broad-phase.ts`: `near` / `nearPolyline`, trace entries filed per sub-segment) and a
>   boundary-edge index on the board region (`pcb-geometry/region-index.ts`); the clearance,
>   copper-to-hole, hole-pair, board-edge, keepout and creepage checks enumerate their candidates
>   through them under halos that bound every resolvable requirement. `DrcOptions.broadPhase:
>   "grid" | "exhaustive"` (default `grid`; tests and `scripts/drc-bench.ts` only) selects the pre-S9
>   loops, kept verbatim: both modes produce identical pre-finalise drafts and byte-identical
>   reports (`drc-broad-phase-oracle.test.ts`). A new check that enumerates pairs must take its
>   candidates from the context's index and prove the halo, or run unindexed and say so.
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
>   `checks/length.ts` / `signal-integrity.ts` (S14) — the routing-obstacle and live-DRC pad layers were closed in S8 (both read the `LegalityContext` items; contract `07-live-parity-contract.md`)
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

## DFM invariants — from `docs/pcb-hardening/11-dfm-contract.md` (S12, 2026-09-11)

- A check may only judge geometry the fab actually receives: silk strokes and mask openings come from `src/shared/rendering/pcb/artwork/` (`buildSilkArtwork`, `buildMaskOpenings`) — the same model the Gerber writer emits; no check re-derives a stroke, an opening or a transform.
- Two placement predicates, never one: `mirrorX = placement.mirrored || placement.layer === "B.Cu"` (point transform, text mirror, keep-upright input); `sideFlip = placement.layer === "B.Cu"` (F.* ↔ B.* face).
- Courtyard regions: edges chained at 0.01 mm, arcs de-duplicated by endpoints + centre + sweep, rings oriented by containment depth and unioned NonZero (overlapping exterior rings union; a donut stays a donut); `malformed` ⇒ the superset hull + `COURTYARD_INVALID`; overlap iff the kernel intersection's area > `DEGENERATE_AREA_MM2`.
- Mask pairs use the SIGNED filled-set gap (containment first): overlapping different-net copper openings are a bridge with gap 0; overlapping same-net or copper-less openings merge (nothing); `FAB_MASK_TO_COPPER` exempts the opening's own copper and what touches it — net equality is not an exemption.
- Copper connection width: the EROSION `E(r)`, `r = w/2 − 1e-3`, at arc tolerance 1e-4 decides (the opening cannot see a neck shorter than the disc reach); necks are located by bisection on the radius, narrowest first; verdict band `(w − 3e-3, w)`; every input ring CCW-normalised, stadiums and discs circumscribed, nothing excluded for being narrow; `w` is capped by `minimums.traceWidthMm`.
- Slivers are thickness-classified residuals (`τ = 2·area/perimeter > 1e-3`, `perimeter/2 ≥ sliverMinLengthMm`) of the over-dilated opening; a convex copper spike is a sliver, a concave copper-free wedge is `TRACE_ACUTE_ANGLE`'s.
- Nothing passes silently: over-budget units and kernel failures report `COPPER_SHAPE_UNCHECKED`.
- Angles use `θ < limit − ANGLE_EPS_DEG` (degrees), never `below()` (millimetres); collinear junctions are `TRACE_OVERLAP`'s.

## Exact-geometry invariants — from `docs/pcb-hardening/12-exact-geometry-contract.md` (S12b, 2026-09-11)

- Copper is a convex core ⊕ disc: `roundedGap = convexDistance(coreA, coreB) − (rA + rB)` (radii summed first; arity-dispatched primitives; `r === 0` delegates to today's polygon primitives); exact for separation and touch in real arithmetic; a negative gap is overlap, not depth.
- ONE canonical contour arc (start-radius circle, authored end projected radially, explicit closing segment), DERIVED at read, never persisted; authored radii validated BEFORE canonicalisation, the canonical ring AFTER.
- Outline validity: no primitive-count rule; two-primitive rings share both endpoints; same-circle interval overlap = retrace = invalid; nested cutouts invalid; DRC and the editor gate share the predicate.
- Board-edge verdicts: certified PASS on the inner region, certified FAIL on the outer, exact only when the regime VERDICT differs between `m_lo` and `m_hi` or containment is unknown; halo = `edgeHalo + r + maxBoundMm`; a `{kind:"chords"}` (ellipse) ring is never exact; `outlineInvalid` counts only `BOARD_OUTLINE_INVALID`.
- Web = erosion feature (necks + residuals whose boundary contact has ≥ 2 connected components + empty erosion), never a pairwise primitive distance; no thickness floor.
- Gerber Profile: no centre repair; one quantised centre per arc, integer I/J, pieces ≤ 90° validated after quantisation (zero-chord merged); radius residual ≤ 2√2 nm.

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

`OpenPCB/docs/drc/OPEN_FINDINGS.md` is the live defect register — 6 open DRC bugs remain after
S0–S8 (B2-5/6/7 + B6-1 → S11, B5-SYNC → S10, B7-1 → S13), each
with a `test.todo` regression test whose body is a real post-fix assertion (`rg -n "test\.todo\("
src/core/backend/tests/drc-audit-b*.test.ts` should show 6 call sites; if the count drops without
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
