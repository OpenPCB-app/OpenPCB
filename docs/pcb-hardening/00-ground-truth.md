# Session 0 — ground truth on current master

> Snapshot of what is actually true in the PCB subsystems as of **2026-09-06**, master at
> `7b81ff4`. Produced by Session 0 of the [hardening program](PROGRAM.md). Line numbers are a
> dated snapshot and will drift; symbols are the durable anchor. Every claim marked **[v]** was
> verified by reading source or running a test in this session; **[a]** was reported by a
> reconnaissance agent and spot-checked on the load-bearing lines.
>
> Exit questions this document answers: *which current test proves each known defect's state?*
> (§1) and *what is the authoritative source for every invariant?* (§2).

## 0. Baseline gates on clean master

| Gate | Result | Notes |
|---|---|---|
| `npm run typecheck` (`tsc -b`) | **red, 42 errors** [v] | All pre-existing and outside this program: `src/modules/assistant/**` backend + frontend + `tests/assistant-remote-tool.test.ts` (`"openpcb-cloud"` not in `AiProviderKind`, remote-tool/copilot-client types — `@openpcb/ai-core` pin drift, 34 errors) and `src/modules/library/backend/sync/opclib-importer.ts` (`OpclibComponentEntry` metadata fields, 8 errors). Zero errors under `src/modules/designer/**`, `src/shared/**`, `src/sdks/**` or the DRC test files. Count with `npx tsc -b 2>&1 \| grep -c "error TS"` — do not `tail` it. |
| `npm run test:backend` | **1319 pass · 8 skip · 19 todo · 22 fail** across 154 files [v] | All 22 failures are library (`.opclib` bootstrap reads a dev pack at `../CoreLibrary/dist/` that fails with "ZIP archive contains too many files", cascading into tags/facets/preview/sources/model-ref suites) plus one assistant cloud-provider test. **Zero failures in any DRC, PCB, routing, ERC or geometry suite.** |

Program rule: a session's gate is *no new failures beyond this baseline*, not a green run. Fixing
the baseline is out of scope for the program.

## 1. Finding status — the 19 register entries, re-verified

Method: every `test.todo` body in `drc-audit-b2..b5.test.ts` was copied to a scratch file with
`test.todo(` → `test(` and executed against current source. A body that **fails** proves the
defect is open. A body that **passes** either means the defect is fixed or the spec is too weak —
each was read to decide which. Placeholder bodies (`expect(true).toBe(true)`) prove nothing and
were replaced with real specs in this session.

Evidence classes: `live-fail` (spec runs and fails today → open) · `live-pass→flipped` (spec runs,
passes, source confirms → closed) · `weak-spec→rewritten` (passed for the wrong reason → new spec,
still open) · `placeholder→spec-written` (no assertion existed → real spec written, still open) ·
`narrowed` (part of the mechanism is already fixed).

| Id | Sev | Subsystem | Owner | Evidence | Test | Source anchor (symbol) | Notes |
|---|---|---|---|---|---|---|---|
| B3-1 | HIGH | connectivity | **closed S1** | live-fail → fixed [v] | `drc-audit-b3.test.ts` "B3-1" (now `test`) | `pcb/ratsnest.ts` — no name rule; pour islands are kernel nodes | Fixed 2026-09-06 (`01-connectivity-contract.md`). `designer-pcb-ratsnest.test.ts` rewritten: "unrouted GND with no pour keeps its airwires". Golden: +1 `UNCONNECTED_NET` (GND). |
| B3-3 | high | connectivity | **closed S1** | live-fail → fixed [v] | b3 "B3-3" (now `test`) | `src/shared/pcb-connectivity/connectivity-graph.ts` per-layer sweep | Connection requires a shared copper layer; `groupPadsByConnectivity` deleted. |
| B3-4 | high | connectivity | **closed S1** | live-fail → fixed [v] | b3 "B3-4" (now `test`) | `copper-records.ts` (`resolvePadCopperLayers` + exact ring); `touch.ts` | `PadRef.halfExtentsMm` and `pcb.padShapeConnectivity` retired. |
| B3-5 | high | connectivity | **closed S1** | live-fail → fixed [v] | b3 "B3-5" (now `test`) | `touch.ts` via–trace body predicate on every span layer | |
| B3-6 | high | connectivity | **closed S1** | live-fail → fixed [v] | b3 "B3-6" (now `test`) | `copper-records.ts` free-pad records; `RatsnestEndpoint.kind === "freePad"` | Free-pad airwires omitted from cloud targets with a snapshot warning (generated `RatsnestTarget` is pad-only). |
| B3-9 | low | copper-pour | **closed S5** | live → fixed [v] | b3 "B3-9" | `checks/copper-pour.ts` emit sites (`measuredMm: largest.areaMm2`) | Spec: `measuredMm` undefined for `ISOLATED_COPPER_ISLAND`. |
| B3-10 | medium | copper-pour | **closed S5** | live → fixed [v] | b3 "B3-10" | `copper-fill-geometry.ts` `buildCopperFillIslandReport` `anchored:`; `collectBareCopper` pushes pads, traces **and vias** into `bare.sameNet` | Spec: island touching only a floating same-net trace stub must flag. |
| B4-1 | high | geometry/board | S2 | **closed S2** (2026-09-07) | `drc-audit-b4.test.ts` "B4-1" | `checks/board.ts` trace off-board branch (vertex + midpoint sampling) | |
| B4-2 | high | geometry/board | S2 | **closed S2** (2026-09-07) | b4 "B4-2" | `checks/board.ts` pad off-board branch (vertex-only) | |
| B4-6 | low | geometry/outline | S2 | **closed S2** (2026-09-07) | b4 "B4-6" | `shared/rendering/pcb/outline-geometry.ts` `arcPoints` (inscribed) | Spec: 90-point ring trace at true gap `c − 0.01` around an r=20 cutout must flag. |
| B4-7 | perf | geometry/board | S2 | **closed S2** (2026-09-07) | b4 "B4-7" | `checks/board.ts` calls `pointInOutline(board.outline, …)` per sampled point; `drc-context.ts` already precomputes `outlineRing` / `cutoutRings` [v] | Spec: `flattenOutline` called ≤ 1× per `runDrc`. |
| B2-5 | medium | manufacturability | S11 | **narrowed** + live-fail [v] | `drc-audit-b2.test.ts` "B2-5" | `checks/manufacturability.ts` `DRILL_SIZE_MIN` / `ANNULAR_RING_MIN` read `hole.drillMm` / `hole.padOdMm` only | `HOLE_TO_HOLE` and hole-to-edge in `checks/board.ts` are already slot-aware (`holeGap`, `hole.slot`). Only the manufacturability half remains. |
| B2-6 | medium | manufacturability | S11 | live-fail [v] | b2 "B2-6" | `drc-context.ts` `padOdMm = min(width, height)` (two sites) | |
| B2-7 | medium | manufacturability | S11 | live-fail [v] | b2 "B2-7" | `checks/manufacturability.ts` `VIA_ASPECT_RATIO` branch | |
| B2-9 | — | epsilon/gates | **closed S0** | live-pass→flipped [v] | b2 "B2-9" (now `test`) | `command-executor.ts` `buildPcbViaForInsert` uses `below()` from `pcb/tolerance.ts` for diameter, drill and annular | Register §3's own criterion is met. New executor-level parity test written. |
| B5-LIVE-ROT-PAD | high | live DRC | **closed S8** | live-fail → fixed [v] | `drc-audit-b5.test.ts` "B5-LIVE-ROT-PAD" | `frontend/pcb/drc/live-drc.ts` `computePadGeoms` (unrotated `halfW`/`halfH`) | Old body passed because its trace at x=5.35 lies inside the *wider* unrotated 2.0 mm box. Defect confirmed open by source read; new geometry puts the trace along the true long axis where the AABB verdict is clean. Fixed 2026-09-09 (`07-live-parity-contract.md`): the live path is `checkPendingCopper` over the batch item builder; regressions flipped, plus `drc-live-parity.test.ts`. |
| B5-LIVE-TH-PAD-SIDE | high | live DRC | **closed S8** | live-fail → fixed [v] | b5 "B5-LIVE-TH-PAD-SIDE" | `live-drc.ts` `computePadGeoms` `layer: placement.layer === "B.Cu" ? "B.Cu" : "F.Cu"` — comment above says the opposite | Fixed 2026-09-09 (`07-live-parity-contract.md`): the live path is `checkPendingCopper` over the batch item builder; regressions flipped, plus `drc-live-parity.test.ts`. |
| B5-LIVE-PADGEOMS | perf | live DRC | **closed S0** | live-pass→flipped [v] | b5 "B5-LIVE-PADGEOMS" (now `test`) | `live-drc.ts` L152-154: `computePadGeoms` hoisted above the per-segment loop; `PcbCanvas.tsx` `useMemo` (~L4833-4880) broad-phase filters `neighborTraces`/`neighborPlacements` via `projectionIndex` before calling `runLiveDrc` [a] | **Residual, not a register entry:** pad geometry is still rebuilt once per cursor move because `routePreview` is in the memo's dependency array. Tracked for S8/S9. |
| B5-SYNC | arch | DRC execution | S10 | placeholder→spec-written | b5 "B5-SYNC" | `designer/backend/routes.ts` `POST /designs/:designId/drc/run` runs `runDrc` inline (three inline call sites in that file) [v] | Spec: >2000 primitives → `202 { taskId }`. |

Post-S0 census: **17 open ids** (19 − B2-9 − B5-LIVE-PADGEOMS); every open id has a real,
runnable post-fix assertion. **Post-S1 census (2026-09-06): 12 open ids** — B3-1, B3-3, B3-4,
B3-5, B3-6 are live tests. `rg -n "expect\(true\)\.toBe\(true\)" src/core/backend/tests/drc-audit-b*.test.ts` → 0.

## 2. Invariants — authoritative sources

| Invariant | Authoritative source | Status 2026-09-06 | Restated in |
|---|---|---|---|
| Coordinate contract: world = integer nm, scene = mm, screen = px; `NM_TO_SCENE = 1_000_000` | `OpenPCB/CLAUDE.md`; `drc-context.ts` `NM_TO_MM` (only nm→mm site is trace points) [v] | verified | AGENTS.md, skill refs |
| Epsilon regimes: `below(v, limit) = v < limit − 1e-6`; clearance bare `<`; short `<= 1e-4` inclusive; fab validators via `below()` | `src/modules/designer/backend/pcb/tolerance.ts` (`DRC_EPS_MM`, `SHORT_EPS_MM`, `below`, `exceeds`) [v]; `drc-epsilon-matrix.test.ts` | verified; B2-9 exception **closed** | OPEN_FINDINGS §5.1 |
| Determinism: pure engine; ids = FNV-1a over code + sorted anchors (+ layer + 0.1 mm bucket for pairwise codes); input reordering changes presentation order only | `drc/violation-id.ts`; `drc-determinism.test.ts` (sorted-id stability only) | verified [a] | OPEN_FINDINGS §5.2, §6.3 |
| Engine shape: **monolithic `runDrc`** building one `DrcContext`, running **13** checks, then one finalize pass | `drc/drc-engine.ts` [v] | **AGENTS.md said "seven"; OPEN_FINDINGS §6.3 named `computeDrcViolationDrafts`/`finalizeDrcReport` which do not exist** — both corrected in S0 | — |
| Rule classes: `clearance \| constraint \| connectivity \| manufacturability \| structural \| dfm \| electrical \| signal-integrity` (8) | `src/sdks/designer/types.ts` `DrcRuleClass` [v] | **AGENTS.md said "exactly five"** — corrected | skill refs |
| Rule codes: 41 in `DrcRuleCode`, all emitted, all labelled | `types.ts` `DrcRuleCode`; `drc/checks/*`; `frontend/pcb/drc/drc-labels.ts` (`Record<DrcRuleCode,string>` enforces labels) [a] | verified; `types.ts` "P2 (declared, not yet implemented)" comment was stale — corrected | — |
| Net-class enforcement: `clearanceMm` via the clearance path for every net **and** `traceWidthMm` / `viaDiameterMm` / `viaDrillMm` via `checks/netclass.ts` (`NETCLASS_*`, warning) for nets deliberately classed — explicit assignment **or** GND/POWER name match; array-order fallback nets are not width-checked | `checks/netclass.ts` `classOf` intent gate [v]; `drc-dfm.test.ts` "net-class dimension enforcement"; `drc-review-fixes.test.ts` "M9" | **AGENTS.md said only `clearanceMm`** — corrected | — |
| Clearance resolution: explicit scoped rules (priority-descending first match, **may relax** above the board floor) → implicit `max(board, classA, classB)` → absolute floor | `src/shared/drc/rule-resolver.ts` (`compileRuleSet`, `resolveClearance`); `drc-rules.test.ts` [a] | **AGENTS.md said "can only tighten"** — corrected. Only `drc-context.ts` imports the resolver (see §4). | OPEN_FINDINGS §6.2 |
| Net-class id resolution: explicit assignment → anchored name regexes (`GND_NAMES` → `POWER_NAMES` → `POWER_VOLTAGE`) → `board.netClasses[0]` | `pcb/net-class-resolver.ts` | verified [a]; step 3 untested | OPEN_FINDINGS §5.3 |
| Severity precedence: override → rule severity → default; `NET_SHORT_CIRCUIT` cannot be downgraded; non-waivable set | `drc/severity.ts`; `drc-severity.test.ts` | verified [a] | OPEN_FINDINGS §6.4 |
| Layer model: `PcbLayerCount = 2 \| 4 \| … \| 32` | `types.ts` `PcbLayerCount` [v] | **AGENTS.md said `2 \| 4`** — corrected | — |
| Via types: `through \| blind \| buried \| micro` with span topology enforced by `VIA_LAYER_SPAN`; accepted only behind `pcb.advancedVias` (dev) | `types.ts` `PcbViaType`; `checks/constraints.ts`; `feature-flags/registry.ts` [v] | **AGENTS.md said every via is a through via** — corrected | OPEN_FINDINGS §6.9 |
| Zones: `PcbZone` exists, KiCad-import-only; **no keepout type exists** *(S0 state — superseded: `PcbKeepout` + authoring landed in S3a/S3b, legality in S4; see `03-zone-keepout-contract.md`)* | `types.ts` `PcbZone`; `import/kicad-project/insert-pcb.ts`; grep "keepout" → comments only [v] | verified | AGENTS.md capability boundaries |
| Electrical constants: IPC-2221 `k` 0.048/0.024, `b` 0.44, `c` 0.725, tempRise 10 °C, 1 oz; unset voltage = 0 V | `checks/electrical.ts`, `drc/ipc2221-spacing.ts` [a] | verified | OPEN_FINDINGS §6.6 |
| SI thresholds: 15° coupling gate, 15 mm uncoupled, 0.5 mm skew, 0.05 mm gap tolerance | `checks/signal-integrity.ts` constants [a] | verified | OPEN_FINDINGS §6.7 |
| Fab profile: JLCPCB live-capabilities values | `src/shared/pcb/fab-profiles.ts` / `pcb/fab-presets.ts` | not re-verified in S0 | OPEN_FINDINGS §6.5 |
| Apply-time DRC on cloud apply reports but does not gate | `designer/AGENTS.md` | not re-verified in S0 | — |

## 3. Subsystem ownership map

| Subsystem | Real code | Shims (edit the target, not the shim) | Owner |
|---|---|---|---|
| Connectivity / ratsnest | `backend/pcb/ratsnest.ts`, `backend/pcb/net-pad-correlation.ts`, `backend/pcb/pcb-projection.ts` (builds the ratsnest context), `frontend/pcb/pcb-pad-nets.ts` | — | S1 |
| PCB geometry kernels | `src/shared/pcb-geometry/{pad-geometry,pad-outline,pcb-clearance-geometry,pcb-trace-geometry,rotation}.ts`; `src/shared/rendering/pcb/{outline-geometry,chain-edges,contour-validation,outline-manufacturability,pcb-drills}.ts`; `backend/pcb/courtyard.ts`; `backend/pcb/tolerance.ts` | `backend/pcb/{pad-geometry,pad-outline,pcb-clearance-geometry,pcb-trace-geometry,outline-geometry,chain-edges,contour-validation,outline-manufacturability}.ts` are 3–5-line `export *` shims [v]; `frontend/pcb/pcb-drills.ts` shims `shared/rendering/pcb/pcb-drills` | S2 |
| Zones / keepouts | `src/shared/pcb-areas/{zone-parse,copper-zones,keepout-predicates,pour-params}.ts`, `src/shared/pcb-geometry/area-overlap.ts`, `pcb-store.ts` zone/keepout rows, `import/kicad-project/insert-pcb.ts`, parser `kicad-pcb-parser.ts` | — | S3a, S3b done / S4 pending |
| Copper fill | `src/shared/rendering/copper-fill/{copper-geometry-kernel,copper-fill-geometry,copper-fill-trace-geometry}.ts` (clipper2-ts, fail-closed, `PRECISION = 4`) — real in-tree code, not a package shim | `frontend/pcb/layers/{copper-geometry-kernel,copper-fill-geometry,copper-fill-trace-geometry}.ts` re-export the shared files [a] | S5 |
| DRC engine + context | `backend/drc/{drc-engine,drc-context,severity,violation-id,ipc2221-spacing,types}.ts`; 13 files under `backend/drc/checks/` (S8 relocated the engine to `src/shared/drc/`; the old paths are re-export shims) | — | S6/S7 |
| Rule resolution | `src/shared/drc/rule-resolver.ts`; `backend/pcb/net-class-resolver.ts` | — | S6 |
| Live DRC | `frontend/pcb/drc/live-drc.ts` (trace–trace and trace–pad only; imports only `shared/pcb-geometry/pcb-trace-geometry`) [v] — *S8: a thin adapter over `src/shared/drc/legality.ts` `checkPendingCopper`, no geometry of its own* | — | S8 (done) |
| Routing legality / obstacles | `src/shared/pcb-routing/{route-obstacles,collision,corner-fixup,pull-tight,walkaround,auto-finish,meander,bundle-geometry}.ts`; `frontend/pcb/tools/*`; `frontend/pcb/PcbCanvas.tsx` (calls both `runLiveDrc` and `buildRouteObstacles`) — *S8: obstacles read the `LegalityContext` items (`07-live-parity-contract.md` §5)* | — | S8 (legality, done), S16/S17 (algorithms) |
| Route commit (server) | `backend/command-executor.ts` `buildPcbTraceForInsert` / `buildPcbViaForInsert` / `pcb_commit_route` — structural validation + via minimums; fab violations `console.warn`; **no clearance/collision check** [a] — *S8: the five copper commands run `checkPendingCopper` on a context built from the dispatcher's rows and refuse the 07 §6 set unless `legality: "report" | "off"`* | — | S8 (done) |
| Electrical / SI | `checks/electrical.ts` (current per item), the resolver's voltage term (`voltage-term.ts`, S13 — `13-electrical-contract.md`), `checks/signal-integrity.ts`, `checks/length.ts`, `backend/pcb/diff-pair-resolver.ts` | — | S13 done 2026-09-12 / S14 |
| ERC | `backend/erc/erc-engine.ts` (`UNCONNECTED_INPUT_PIN`, `OUTPUT_OUTPUT_SHORT`, `NO_CONNECT_VIOLATION`; schematic-only) [a] | — | S13 (scope note only) |
| Export | `backend/export/gerber/writer.ts` (own `padApertureShape`, pours via the shared fill kernel), `export/excellon/writer.ts` (slot-aware `G85`) [a] | — | S11/S12 |
| Stackup | none — `boardThicknessMm` + `layerCount` + single `designRules.electrical.copperWeightOz`; no dielectric, no per-layer copper thickness [a] | — | S15 |

## 4. Duplicate-model register

Every second implementation of a physical question. S1/S2/S6 must reduce these to one or prove
equivalence.

### 4.1 "Is this copper connected?" — six models at S0; one kernel + three scheduled consumers after S1

**Status 2026-09-06 (S1):** models 1, 2 and 5 are replaced by `src/shared/pcb-connectivity/`
(contract `01-connectivity-contract.md`); models 3, 4 and 6 remain private answers with owning
sessions S5, S14 and S8. The S0 descriptions are kept below for the record.

1. **Ratsnest union-find** — *replaced in S1*: `ratsnest.ts` is now an MST over kernel components.
   Was: pad↔endpoint and endpoint↔endpoint and via↔endpoint unions layer-blind; only the T-junction
   pass checked `layer`; pour groups per-layer via `computePourPadGroups`; GND dropped by name. [v]
2. **Dangling check** — *replaced in S1*: `checks/dangling.ts` is a lookup into the kernel's
   end-cap / via-layer contact records. Was: own layer-aware point predicate with a whole-layer
   pour shortcut. [v]
3. **Copper-fill anchoring** — *replaced in S5*: `ISOLATED_COPPER_ISLAND` reads the S1 component of
   each kept island (`04-copper-pour-contract.md` §10); the kernel's `attached` is only the
   island-removal criterion. Was: `anchored = intersection(island, union(bare.sameNet))` where
   `bare.sameNet` includes pads, traces and vias — dead copper anchors. [v]
4. **Routed length** — `checks/length.ts` and `checks/signal-integrity.ts` `netLength` sum every
   trace polyline on the net: no continuity, no layer, no via barrel. [a]
5. **Frontend pad-net fallback** — *deleted in S1* (`pcb-pad-nets.ts` removed; `projection.padNets`
   is always written by the projection loader and every consumer reads it directly). Was: pad→net
   reconstructed from ratsnest endpoints then trace-endpoint-on-pad-centre. [a]
6. **Routing obstacles** — `route-obstacles.ts`: pads block `F.Cu` or `B.Cu` by placement side
   only; vias block every layer; no board edge, cutout or zone obstacles. [v] *S4: `tracks`
   keepouts are AABB superset obstacles, the live check runs the exact `keepoutAffects` per pending
   segment, and a `vias` keepout refuses a smart via (`03-zone-keepout-contract.md` §13.4). Board
   edge / cutout obstacles remain S16 (S8 gave the gate edge / off-board through `boardItems`, and
   the obstacles THT-on-every-layer pads, free pads and NPTH stadia from the context items).*

### 4.2 Clearance resolution — one copy after S6 (2026-09-08)
Before S6 there were four: `src/shared/drc/rule-resolver.ts` (imported only by
`drc-context.ts`), `route-obstacles.ts` `resolveRouteClearancesMm` and the inlined `Math.max` in
`live-drc.ts` (both `max(class(session), board.traceTo*)` — the neighbour's class, every scoped
rule and the floor invisible; the class taken from the UI session, not the net), and
`pour-params.ts` `netClearanceResolver` (scoped rules excluded). After S6 every consumer —
batch, live gate, route obstacles, the pour composition, the via insert gate — calls
`createRuleResolver` (`05-rule-semantics-contract.md` §9); the first three copies are deleted.
[v at S6 close]

### 4.3 Geometry predicates — after S2 (2026-09-07), pad model after S7 (2026-09-08)
- Pad copper for DRC: **one** ring per pad (`copper-records.ts`, via `pad-outline.ts`) plus the
  exact `disc` for a true circle; since S7 every DRC check consumes the disc through
  `drc/pair-gap.ts` (clearance, creepage, copper-to-hole), `checks/board.ts` and
  `checks/keepouts.ts` — the circumscribed 48-gon is no longer judged anywhere for circles.
  Free-pad copper layers and free-pad drills each have **one** derivation
  (`freePadCopperLayers`, `freePadDrill`) consumed by the records, DRC, the pour, the Gerber /
  Excellon writers, the snapshot and the canvas (`06-batch-drc-contract.md` §2). [v at S7]
- Point-in-polygon: **one** — `pcb-clearance-geometry.ts` `pointInPolygon` (the former
  `outline-geometry.ts` `pointInRing` is gone). Closed-set region containment lives in
  `pcb-geometry/board-region.ts` (`regionContainsPoint`, per ring, `GEOM_EPS_MM`). [v]
- Segment intersection: **one** mm implementation — `pcb-geometry/segment-predicates.ts`
  `segmentsIntersect` (inclusive: crossing, T-touch, shared endpoint, collinear overlap) with
  `segmentsCrossTransversally` and `segmentContactParams` beside it; `pcb-trace-geometry.ts` and
  `outline-geometry.ts` re-export it. `pcb-routing/collision.ts` `segmentIntersectsRectNm` (nm,
  Liang–Barsky, open interior) is the convention S8 named (`07-live-parity-contract.md` §5). [v]
- Arc flattening: the S0 count of "seven" was wrong — **nine** in-scope samplers plus two in the
  library module. After S2 the outline path has **one** (`pcb-geometry/arc-chords.ts`:
  `arcSegmentCount` with bias-aware step rules and a θ ≤ π/2 floor, `arcChordPoints` inscribed /
  tangent-chain, `ellipseChordRing`), used by `outline-geometry.ts` for every outline and cutout.
  Documented divergences (contract §7): `pad-outline.ts` `arc` / `ellipseRing` (pushed-endpoint
  circumscription, fixed 48/6 — S7), copper-fill `buildTraceSegmentStadium` /
  `buildDiscRing` (own 0.005 mm tolerance; S5 deleted `addArc` — pads now use the S1 record ring —
  and made via obstacles circumscribed; stadium caps stay at 16 segments, recorded in
  `04-copper-pour-contract.md` §4), `courtyard.ts` `pushCircle` (S12), DXF
  `pushEllipse` (uses `arcSegmentCount`), KiCad `tessellateArcChords` and SVG `arcToSvgPath`
  (library, out of program). [v]
- Self-intersection: **one** — `segment-predicates.ts` `ringSelfIntersects` (inclusive); the
  private copy in `checks/outline.ts` is gone. `outline-manufacturability.ts` uses the shared
  distance kernels. [v]
- Pad shape for export: `gerber/writer.ts` `padApertureShape` / `padTouchesCopperLayer` do not
  use `pad-outline.ts` `padOutlineWorldMm`; both approximate trapezoid/custom as a bounding rect,
  separately. [v]
- Live pad transform: `live-drc.ts` `transformPadCenter` duplicates `pad-geometry.ts`
  `transformPadCenterMm` but rotates only the centre. [a]
- Segment distance / closest points: **single source** (`pcb-trace-geometry.ts`
  `segmentToSegmentDistance`, `polylineToPolylineClosestPoints`), consumed by batch checks and live
  DRC alike. [a]
- Area overlap (open interior): one — `pcb-geometry/area-overlap.ts` (`ringsOverlapPositiveArea`,
  `stadiumOverlapsRing`, `discOverlapsRing`), S3a.

## 5. Rule-code emit census

43 codes in `DrcRuleCode` at S0 (the S0 census said 41 — a miscount, corrected in S6 against `git show HEAD`), 47 after S4, 48 after S5, **51 after S6**, **52 after S7** (`COPPER_TO_HOLE` — `checks/copper-to-hole.ts`; the union, `DEFAULT_SEVERITY_BY_CODE`, `RULE_CLASS_BY_CODE`, `EMIT_SITE_BY_CODE` and `CODE_LABEL` are all `Record<DrcRuleCode, …>` and the S7 census test proves every code reachable on the corpus) (`HOLE_OFF_BOARD` — `checks/board.ts`; `DRC_RULE_INVALID`, `DRC_RULE_INEFFECTIVE` — `checks/rules.ts`; S5: `ZONE_FILL_FAILED`, emitted by `checks/copper-pour.ts`; S4: `KEEPOUT_VIOLATION`, `ZONE_OVERLAP`, `ZONE_INVALID`,
`ZONE_EMPTY_FILL` — `checks/keepouts.ts`, `checks/zones.ts`, `checks/copper-pour.ts`); every code
has an emit site under `drc/checks/`, a default severity in `severity.ts` and a label in
`drc-labels.ts`; no emitted string is outside the union. [a] Two notes:

- `types.ts` carried a "P2 (declared, not yet implemented)" comment over 12 codes that are all
  implemented — corrected in S0.
- **P9 DFM overlay codes do not exist** (no `COURTYARD_*`, `SILK_*`, `MASK_*`, `*SLIVER*`,
  `ACUTE_*`). `drc-dfm.test.ts` is misnamed: it covers outline validity, hole-to-edge, dangling,
  net-class dimensions and zone-pour islands (the P5 batch), not overlays. OPEN_FINDINGS §6.8's
  DFM parameters are a specification, not shipped behaviour.

Recurrent failure mode to keep auditing (from OPEN_FINDINGS §5.9): a declared code with a label
and no emit site looks implemented from every direction except a grep for its emit.

## 6. Test contract map

Backend (Bun, `src/core/backend/tests/`) — DRC/PCB-relevant files and what they prove [a]:

| Contract | Files |
|---|---|
| Audit regressions (open = `test.todo`) | `drc-audit-b1..b5.test.ts` |
| Engine core: shorts, clearance, width, dangling, creepage, SI | `drc-engine.test.ts` (33) |
| Epsilon boundary semantics | `drc-epsilon-matrix.test.ts`, `drc-p1-fixes.test.ts` |
| Determinism (sorted-id stability, reorder) | `drc-determinism.test.ts` |
| Golden board | `drc-golden.test.ts` (one fixture: `fixtures/drc/golden/golden-small-2l.json`) |
| Scoped rules, severity, violation-id v2 | `drc-rules.test.ts`, `drc-severity.test.ts` |
| Electrical, SI, length | `drc-electrical.test.ts`, `drc-si.test.ts`, `drc-length.test.ts`, `diff-pair.test.ts` |
| P5 batch (outline, hole-edge, dangling, netclass, zone island) | `drc-dfm.test.ts` |
| Review-fix regressions (M2/M7/M9/B3/H1/H4/H6) | `drc-review-fixes.test.ts` |
| Ratsnest + pour-aware connectivity | `designer-pcb-ratsnest.test.ts` (16) |
| Free pads, free holes, via hydration, pad geometry, traces | `designer-pcb-free-pads.test.ts`, `designer-pcb-free-holes.test.ts`, `designer-pcb-via-hydrator.test.ts`, `designer-pcb-pad-geometry.test.ts`, `designer-pcb-traces.test.ts` |
| Outline editing / manufacturability | `outline-edit.test.ts`, `outline-dimension-edit.test.ts`, `outline-manufacturability.test.ts` |
| Routing kernels | `pcb-routing-{auto-finish,bundle-geometry,collision,meander,obstacles,pull-tight,walkaround}.test.ts`, `pcb-trace-geometry.test.ts` |
| Route tool state | `route-tool-state.test.ts`, `route-interactions.test.ts`, `route-hud-model.test.ts`, `route-layer.test.ts`, `route-target.test.ts`, `router-runtime.test.ts` |
| ERC | `erc-engine.test.ts`, `designer-erc-sdk.test.ts` |
| Drills / slots | `pcb-drills.test.ts` |

Frontend/shared specs: `copper-fill-geometry.test.ts` (23), `copper-fill-trace-geometry.test.ts`
(18), `copper-geometry-kernel.test.ts` (7), `pcb-hit.spec.ts`, `snap.spec.ts`, `pcb-pad-nets.test.ts` (4). [a]

**Tests that codify known-wrong behaviour** (landmines for later sessions):
- `designer-pcb-ratsnest.test.ts` ~L96-104: a net named `GND` with no routing and no pour → 0
  airwires (`toHaveLength(0)`). This is B3-1's mechanism asserted as intended. The pour-aware
  suite in the same file (~L362-384) sidesteps name suppression by using unnamed net ids, so it
  does not contradict the code. S1 changes this test with the fix. [v]
- `nomenclature`: `drc-p0-fixes.test.ts` / `drc-p1-fixes.test.ts` are route-tool phases, not DRC
  milestones (OPEN_FINDINGS §4).

## 7. Docs drift register

| Location | Claim | Evidence | Resolution |
|---|---|---|---|
| `designer/AGENTS.md` "## DRC" | seven checks; only `clearanceMm` enforced; net class only tightens; five rule classes | §2 rows | corrected in S0 |
| `designer/AGENTS.md` "PCB CAPABILITY BOUNDARIES" / "NOTES" | `PcbLayerCount` is `2 \| 4`; every via is through | `types.ts` `PcbLayerCount`, `PcbViaType` | corrected in S0 |
| `.claude/skills/pcb-hardening-review/references/scope-and-invariants.md` | quotes the stale AGENTS.md DRC section verbatim as Astra invariants | same | corrected in S0 |
| `docs/drc/OPEN_FINDINGS.md` §3 | B2-9 open question | `command-executor.ts` uses `below()` | resolved in S0 (closed) |
| `docs/drc/OPEN_FINDINGS.md` §6.3 | engine splits into `computeDrcViolationDrafts` / `finalizeDrcReport` | neither symbol exists | corrected in S0 |
| `docs/drc/OPEN_FINDINGS.md` B2-5 | slot ignored by annular, `HOLE_TO_HOLE`, `DRILL_SIZE_MIN` | `checks/board.ts` is slot-aware | narrowed in S0 |
| `docs/drc/OPEN_FINDINGS.md` B5-LIVE-PADGEOMS | `computePadGeoms` inside the per-segment loop | hoisted | closed in S0, residual noted above |
| `docs/drc/OPEN_FINDINGS.md` header | "20 lines covering 19 unique bug ids" | now 17 | updated in S0 |
| `src/sdks/designer/types.ts` ~L2096 | "P2 (declared, not yet implemented)" over 12 implemented codes | §5 | corrected in S0 |
| `TODO.md` §5 | P0–P12 sequence; B3-1 unowned | superseded | pointer to PROGRAM.md; B3-1 → S1 |
| `TODO.md` §4 "DRC trust" | "remove or disable the broken thermal-relief check" | no thermal-relief *check* exists; thermal relief is a fill option (`padConnection: "thermal"`) — the item's referent is unclear | resolved S5: there never was a check; the fill option's spokes sat at a fixed world angle, fixed in S5 (`04-copper-pour-contract.md` §6); the TODO.md item was rewritten |
| `route-obstacles.ts` comment | "the one shared definition of the live-DRC clearance formula" | `live-drc.ts` inlines its own | resolved S8: neither has a formula — both read the context (07 §5, §8) |
| `copper-fill-geometry.ts` `buildCopperFillPourPaths` comment | "backend-safe … no THREE" | the kernel module imports `three` at load [v] | resolved S5: `three` lives only in `copper-fill-shapes.ts` (`islandsToShapes`), the kernel and `copper-geometry-kernel.ts` no longer import it |
| `checks/copper-pour.ts` doc comment | "a same-net pour satisfies the net, so `UNCONNECTED_NET` already clears" | false when no pour exists (B3-1) | corrected in S1 |
| `README.md` L60 | "DRC runs live while you work" | live path covers trace–trace and trace–pad only | resolved S8: the live gate is the batch pair kernel over the pending copper (07 §3 lists what it judges); README reworded |
| `designer/AGENTS.md` "## DRC" | "thirteen" checks | 16 at S6 close, 17 after S7 | corrected in S7 |
| `.claude/skills/pcb-hardening-review/references/scope-and-invariants.md` | clearance regime = bare `<`; "17 `test.todo`"; tolerance path | S6 moved clearance to `clearanceViolated`; 6 todo; the path is a shim | corrected in S7 |
| `docs/drc/OPEN_FINDINGS.md` §5.1 / "Checking status" | FAB tier under the clearance regime; "8 call sites" | `clearance.ts` uses `below`; 6 | corrected in S7 |
| `gerber/writer.ts` `freePadTouchesCopperLayer` | `hole` and `conn` free pads on F.Cu + B.Cu | SDK: `hole` has no copper, `conn` is single-layer — the artwork carried copper DRC never saw | fixed in S7 (`freePadCopperLayers`) |

## 8. Dependency map

- **Consumers of `projection.ratsnest`** [a, spot-checked]: `checks/connectivity.ts`;
  `PcbScene.tsx` (airwire render, 4 sites); `PcbCanvas.tsx` (3); `tools/route-target.ts`
  (`nearestRatsnestPad`); `pcb/board-snapshot.ts` (cloud autoroute targets); assistant
  `context-summary.ts`, `tools/read-tools.ts`, `tools/designer-tools.ts` ("unrouted" counts);
  `CopperPour.tsx` fallback; `drc-context.ts` passthrough. Any ratsnest false negative is a route
  the autorouter never attempts and an "unrouted" count the assistant never reports.
- **Consumers of `shared/drc/rule-resolver.ts`**: `drc-context.ts` only.
- **Consumers of the copper-fill kernel**: backend `command-executor.ts`, `checks/copper-pour.ts`,
  `pcb/board-snapshot-pours.ts`, `export/gerber/writer.ts`, `pcb/ratsnest.ts`; frontend
  `three-d/primitives/CopperPour.tsx`, `pcb/layers/CopperFillLayer.tsx`. Same kernel, same
  `resolveCopperFillClearanceMm(dr.clearance)` inputs at every site — the kernel does **not**
  consult the rule resolver. [a]
- **Consumers of `collectCopperZones`** (the S3a derivation — every consumer reads it, not
  `projection.zones` / `viewState.copperFillLayers` directly): `pcb-projection.ts`,
  `board-connectivity.ts`, `drc-context.ts`, `checks/copper-pour.ts`,
  `pcb/board-snapshot-pours.ts`, `export/gerber/writer.ts`, `command-executor.ts`
  `pcb_cleanup_pour_traces` (board zones only), `tests/helpers/drc-golden.ts`, `PcbScene.tsx`,
  `CopperPour.tsx` (3D). Since S3b the per-layer copper fill is a persisted board-zone row
  (`board:<layer>`); `viewState.copperFill*` and `applyLegacyBoardFillPolicy` are gone, and the
  only reader of the legacy keys is `migrateLegacyBoardFill` (`pcb-store.ts`, raw payload).
  `checks/dangling.ts` no longer reads a `pourLayerMap` — that model was removed in S1.
- **Geometry kernel consumers**: `checks/clearance.ts`, `checks/electrical.ts`,
  `checks/board.ts`, `checks/signal-integrity.ts`, `live-drc.ts` all import
  `polylineToPolylineClosestPoints` / `segmentToSegmentDistance` from
  `shared/pcb-geometry/pcb-trace-geometry.ts`; `rule-resolver.ts`, `checks/outline.ts`,
  `checks/dangling.ts`, `checks/board.ts` import `pointInPolygon` from
  `pcb-clearance-geometry.ts`. [a]
- **Feature flags touching this program** (`feature-flags/registry.ts`): `pcb.padShapeConnectivity`
  **retired in S1** (exact pad rings under copper-overlap semantics replaced the AABB test),
  `pcb.advancedVias` (dev), `pcb.routeAutoFinish`, `pcb.routeWalkaround`, `pcb.lengthTuning`,
  `pcb.bundleRouting` (all dev), `cloud.autolayout` (all). No DRC check is flag-gated. [v]

## 9. Fixture inventory

| Fixture | Where | Notes |
|---|---|---|
| Fixture builders | `src/core/backend/tests/helpers/drc-fixtures.ts` — `board`, `boardWithRules`, `projection`, `trace`, `via`, `pad`, `placement`, `freeHole`, `freePad`, `ratsSeg`, `codes`, `sortedIds` | mm-in, nm-out for traces |
| Golden board | `src/core/backend/tests/fixtures/drc/golden/golden-small-2l.{json,expected.json}`; refresh with `scripts/update-drc-goldens.ts` | the only golden; 2-layer |
| DRC parity harness | `scripts/drc-parity-harness.ts` — stdin JSON fixture (schema v2, integer nm) → real `runDrc` verdict; no package alias, run directly | for cross-repo checks against cloud auto-layout |
| Board-snapshot parity harness | `scripts/board-snapshot-parity-harness.ts` | |
| 4-layer boards | inline `layerCount: 4` in ~10 test files [a] | no persisted 4-layer fixture; no `.kicad_pcb` in-tree (`helpers/kicad-fixtures.ts` only resolves an external dir) |
| 555 blinker | `src/core/backend/tests/fixtures/blinker-555.ts` + `designer-555-export.test.ts` + `docs/validation/555-blinker-gerbview.md` — **only on `integ/trace-drag`** (commit `a340ed2`) | wanted for S18 |
| E2E | `tests/e2e/fixtures/board-rect.dxf` | DXF outline only |

**`integ/trace-drag` status** [v]: local + `origin`; 6 commits (2026-05-27 … 06-09); 10 files,
+1905/−7: trace-segment drag editing, vertex handles, grid/guide snapping, measure persistence
fix, the 555 fixture and a TODO doc commit. Overlap with master since merge-base: `PcbCanvas.tsx`
and `PcbScene.tsx` (both heavily changed on master by custom board shapes, auto-layout, route-tool
P1, DRC hardening, comments). **Decision needed before S1**: rebase and integrate (expect
conflicts in the two canvas files) or cherry-pick `a340ed2` alone for the fixture and park the
rest.

## 10. Open questions for the user

1. `integ/trace-drag`: **decided 2026-09-06** — cherry-pick `a340ed2` (555 fixture) onto master,
   park the drag work (user action; branch kept).
2. `TODO.md` §4 "remove or disable the broken thermal-relief check" — what was the referent? No
   such DRC check exists; thermal relief is a fill option.
3. The typecheck/backend baseline is red for reasons outside this program (ai-core pin drift,
   library dev pack). Should a housekeeping pass fix it before S1 so gates can be "green" rather
   than "no new failures"?
4. **Decided in S1** — physical copper overlap (exact pad ring) is the shipped semantics; the flag
   is retired. New open question from S1 for the cloud session: should GND-class nets be excluded
   from autoroute targets by default now that unpoured GND airwires reach the snapshot?
