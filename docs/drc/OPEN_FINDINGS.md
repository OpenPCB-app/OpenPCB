# DRC — open findings

This is the defect register for OpenPCB's design-rule checker. It records the 12 bugs that a
full adversarial audit of the DRC engine confirmed and that are **still open** (19 at the audit;
B2-9 and B5-LIVE-PADGEOMS were verified closed in Session 0, and B3-1, B3-3, B3-4, B3-5, B3-6
were fixed in Session 1 — both 2026-09-06), together with the durable
engineering contracts and constant sets that the surrounding hardening work locked in.

For 11 of the 12 findings this document is the only prose description that exists. The audit
report they came from has been retired; the hardening plan that scheduled the fixes has been
retired and replaced by `docs/pcb-hardening/PROGRAM.md`. Nothing else in the repository explains
*why* these are bugs or what the correct behaviour is. The verified current-master inventory that
re-checked every entry is `docs/pcb-hardening/00-ground-truth.md`.

## How to use it

- **Before touching a DRC check**, read the finding for that check. Several of them are traps
  where the current behaviour is deliberate-looking (a comment, a passing test) but wrong.
- **Before writing a new check**, read the reference sections. Epsilon policy, determinism,
  net-class resolution, severity precedence and the fab profile are all settled decisions; a new
  check that re-derives them will diverge.
- **Each finding names its subsystem and symbol, not a line number.** The original audit was
  `file.ts:line`-anchored and had already drifted during the audit itself. Grep for the symbol.

## Checking status

Every open finding has a corresponding `test.todo` regression test. The register is live only as
long as that correspondence holds:

```
rg -n "test\.todo\(" src/core/backend/tests/drc-audit-b*.test.ts
```

Expect **8 call sites, 8 unique bug ids**, and every body a real post-fix assertion
(`rg "expect\(true\)\.toBe\(true\)"` over the same files must return nothing — Session 0 replaced
the seven placeholder bodies; Sessions 1 and 2 flipped nine of them). When a fix lands, the `test.todo` becomes a real `test` and the
finding leaves this document. If the count drops without a finding being removed here, the
register is stale. To check whether a finding is still open without editing the suite, copy the
file to a scratch directory with `test.todo(` → `test(` and absolute import paths, and run it.

## Evidence standard

The audit's own findings were verified: every bug was re-read against source and, where
expressible through the engine, reproduced by running the real `runDrc`. Those confirmations are
trustworthy.

**The claims about which bugs were subsequently *fixed* are not.** The hardening program reported
21 of the 40 audit bugs as flipped, but those per-bug claims were self-reported by the implementer
and were never independently verified against code. The only verified signal is the `test.todo`
census above. Where this document says something shipped, it means "the test file says it is no
longer pending" — not "someone confirmed the code is correct."

Session 0 (2026-09-06) re-verified every *open* entry by running its `test.todo` body against
current source: 11 of the 12 bodies that carried a real assertion failed as expected; one
(B5-LIVE-ROT-PAD) passed for the wrong reason and was rewritten; the seven placeholder bodies were
replaced with real specs, and two of those (B2-9, B5-LIVE-PADGEOMS) passed and were flipped.

---

# 1. Resolved in Session 1 — connectivity (B3-1, B3-3, B3-4, B3-5, B3-6)

Fixed 2026-09-06 by the connectivity program session (`docs/pcb-hardening/PROGRAM.md` S1). The
contract that replaced the six independent connectivity models is
`docs/pcb-hardening/01-connectivity-contract.md`; the kernel is `src/shared/pcb-connectivity/`;
`pcb/ratsnest.ts` is now an MST over kernel components and `checks/dangling.ts` a lookup into the
kernel's contact records. All five regressions are live `test`s in `drc-audit-b3.test.ts`.

What was wrong, for the record:

- **B3-1 (was HIGH)** — `computeRatsnest` dropped GND-named nets by name before any check that a
  pour existed, so an entirely unrouted ground on a default board (no fill layers) reported
  DRC-clean; `designer-pcb-ratsnest.test.ts` codified that as intended. Resolution: no net-name
  rule anywhere; a same-net pour island is a graph node and collapses GND geometrically when a
  fill layer is enabled; otherwise GND shows airwires and `UNCONNECTED_NET` like any net (user
  decision). The golden board gained exactly one `UNCONNECTED_NET` (net `GND`).
- **B3-3** — endpoint↔endpoint chaining ignored layer. Resolution: connection requires a shared
  copper layer; a via is the only cross-layer node.
- **B3-4** — pad↔endpoint and via↔endpoint unions were layer-blind and `PadRef` had no layer.
  Resolution: pads carry `resolvePadCopperLayers` layers and their exact `padOutlineWorldMm` ring;
  the `pcb.padShapeConnectivity` AABB flag is retired because copper overlap subsumes it.
- **B3-5** — vias unioned with trace endpoints only. Resolution: via disc vs trace body on every
  span layer.
- **B3-6** — free pads were absent. Resolution: free pads are items (`std` on every layer,
  `smd`/`conn` on their layer, `hole` none) and ratsnest endpoints (`RatsnestEndpoint.kind ===
  "freePad"`); free-pad-anchored airwires are omitted from the cloud autoroute target list with a
  snapshot warning because the generated `RatsnestTarget` contract has footprint-pad fields only.

---

# 2. Resolved in Session 2 — geometry (B4-1, B4-2, B4-6, B4-7, full-radius roundrects)

Fixed 2026-09-07 by the geometry program session (`docs/pcb-hardening/PROGRAM.md` S2). The
contract is `docs/pcb-hardening/02-geometry-contract.md`; the kernel is
`src/shared/pcb-geometry/{segment-predicates,arc-chords,ring-utils,outline-geometry,region-rings,board-region}.ts`;
`checks/board.ts` and `checks/outline.ts` consume one closed-set board region built once per run
(`ctx.boardRegion`). All four regressions are live `test`s in `drc-audit-b4.test.ts` (20 tests).

What was wrong, for the record:

- **B4-1 (was HIGH)** — trace containment sampled vertices and segment midpoints, so a trace
  crossing a cutout narrower than the stride passed and was demoted to a distance-0
  `COPPER_TO_BOARD_EDGE`. Resolution: `stadiumInsideRegion` — the copper WITH its width must lie
  inside the region; a centreline farther than its half-width from every boundary edge cannot
  cross one, so the test is exact and O(edges).
- **B4-2 (was HIGH)** — pad containment tested pad vertices plus "a cutout vertex inside the pad".
  A slot through the pad interior, a pad spanning a concave notch and a pad exactly filling a
  cutout all passed. Resolution: `polygonInsideRegion` — every pad edge inside the region
  (sub-interval midpoints between every boundary contact), and no hole interior meeting the pad
  interior through the hole's own boundary, including coincident edges.
- **B4-6** — cutout arcs were flattened inscribed (hole polygon smaller than the true hole) and
  circles with a fixed 64 chords (0.024 mm off at r = 20). Resolution: per-arc bias — the chord
  polygon always lies on the board side of the true curve (holes circumscribed as a tangent chain
  with exact endpoints, convex outer arcs inscribed, concave notches circumscribed) — so the
  legality region is a subset of the true board within `MAX_CHORD_DEVIATION_MM`; full circles
  follow the chord rule with 64 as a floor.
- **B4-7** — `pointInOutline` re-flattened the outline and every cutout on each sampled point
  (151 flattens for 50 traces). Resolution: `buildBoardRegion` once per `runDrc`; the audit test
  now asserts the flatten count is independent of the trace count.
- **Full-radius roundrects (found in S2 reconnaissance, no register id)** — `roundRectPoints`
  emitted a duplicate vertex when the corner radius equalled half the width or height, and the
  zero-length edge tripped the self-intersection test, so every rounded slot cutout and every
  stadium outline was `BOARD_OUTLINE_INVALID`. Resolution: no zero-length edge is emitted and
  every flattened ring is canonicalised.
- **Same class, no id — outline validity was vertex-only**: a cutout crossing the outline with no
  vertex outside, two cutouts crossing with no vertex inside each other, and cutouts sharing
  supporting edges all passed. Resolution: validity runs on the biased rings —
  `ringStrictlyInside(cut, outer)` and no `ringsIntersect(cut, other)` — so a cutout that touches
  the edge or another cutout is now invalid (zero-width web), as is any true breach or overlap.

---

# 3. Open findings by owning session

Sessions refer to `docs/pcb-hardening/PROGRAM.md`. The former P4/P7/P9 milestone groupings are
kept as sub-headings because their prose still explains the mechanisms; ownership has moved.

## S2 — core PCB geometry truth (formerly P4)

Closed — see §2 above (B4-1, B4-2, B4-6, B4-7 resolved 2026-09-07).

## S8 — live DRC / route-legality parity, and S10 — async execution (formerly P7)

S8 moves the engine to `src/shared/drc/` behind re-export shims so live DRC and the batch path
consume the identical code; its acceptance criteria are the divergences in §5.5. S10 moves the
batch run off the HTTP request path. Session 0 (2026-09-06) closed two of P7's original five
findings: B2-9 (the via gate already consumes `pcb/tolerance.ts`) and B5-LIVE-PADGEOMS (the
per-segment rebuild is gone; the residual per-cursor-move rebuild is noted in
`docs/pcb-hardening/00-ground-truth.md` §1 for S8/S9).

### B5-LIVE-ROT-PAD — live pad boxes never swap dimensions under rotation

Batch DRC uses the exact rotated pad polygon. Live DRC models each pad as an **unrotated
axis-aligned box**, transforming only the pad's centre. A 2.0 × 0.5 mm pad rotated 90° is
therefore checked as if it were still 2.0 wide and 0.5 tall. Result: live-clean, batch-error along
the pad's true long axis — and spurious live errors on circular pads, where the box overstates the
copper. Reproduced.

*Anchor:* `frontend/pcb/drc/live-drc.ts`, pad AABB construction.

### B5-LIVE-TH-PAD-SIDE — live gives every pad exactly one layer

Live DRC assigns each pad a single layer equal to its placement side. Through-hole pads span all
copper layers in the batch model. So while routing B.Cu, every top-placed THT barrel is invisible
to live checking. The code comment immediately above this logic states the opposite intent.

*Anchor:* `frontend/pcb/drc/live-drc.ts`, pad layer assignment.

### B5-SYNC — the full O(n²) batch run executes synchronously in the HTTP handler

`POST /designs/:designId/drc/run` runs the engine inline on Bun's single thread. At ~10k copper
primitives that is 0.5–5 s (§5.4) during which command dispatch and SSE are blocked. The engine
itself is pure and correct; this is purely a placement problem.

*Anchor:* the `POST /designs/:designId/drc/run` handler in `designer/backend/routes.ts`. Cite the
route, not a line number — the handler has already drifted once.

## S11 — manufacturability, S5 — pours (formerly P9; the two pour findings were closed in S5)

The DFM overlay checks P9 was to add (courtyard, silkscreen, mask, copper shape) are now S12 and
own no register entry — none of those codes exist yet. The nine pre-existing findings P9 carried
are split: three manufacturability geometry defects → S11; the layer-blindness cluster → S1
(fixed, see §1); the two island findings → S5.

### B2-5 — slotted drills are modelled as round holes in the manufacturability checks

**Narrowed 2026-09-06.** `DrcHole.slot` exists and is populated for free pads and free holes, and
`checks/board.ts` already consumes it: `HOLE_TO_HOLE` measures slot-to-slot edge gaps on the slot
centreline and the hole-to-board-edge check uses the slot radius. What remains: `DRILL_SIZE_MIN`
and the pad `ANNULAR_RING_MIN` branch in `checks/manufacturability.ts` read only `hole.drillMm`
and `hole.padOdMm`, so a slot is still judged as a round hole of the slot's *width* there; and
footprint through-hole pads never populate `slot` at all (only free pads/holes go through
`slotCenterline`). Excellon export is slot-aware (`G85`), so DRC and the fab see different holes.

*Anchor:* `checks/manufacturability.ts`, `DRILL_SIZE_MIN` and pad annular branches ·
`drc-context.ts` `slotCenterline` and footprint-pad hole construction · the `drillSlot` field on
the pad type in `sdks/designer/types.ts`.

### B2-6 — annular ring uses bounding-box extents for non-rectangular pads

`padOdMm` is computed as `min(width, height)`. That is correct for circle, rect and oval pads.
For `trapezoid` and `custom` pads those are bounding-box extents, and the actual copper is
narrower than the box, so the annular ring is over-estimated — a false pass on exactly the pad
shapes where the ring is most likely to be marginal.

*Anchor:* `checks/manufacturability.ts`, pad annular branch; `padOdMm` derivation in
`drc-context.ts`.

### B2-7 — the blind-via aspect model is wrong twice over

`VIA_ASPECT_RATIO` scales board thickness linearly by the via's layer-span fraction and then
applies the **through-hole** 10:1 limit to that scaled depth. Blind and laser vias are governed by
a depth-to-drill convention closer to 1:1. Compounding it, neither JLCPCB standard preset (2L or
4L) offers blind vias at all. Unmanufacturable blind vias pass by roughly an order of magnitude.

*Anchor:* `checks/manufacturability.ts`, `VIA_ASPECT_RATIO` branch.

### B3-9 — `measuredMm` carries mm² for isolated islands

`ISOLATED_COPPER_ISLAND` writes the island's **area** into `measuredMm`, whose field contract
declares millimetres. Any consumer formatting or comparing that number is wrong by a dimension.

*Anchor:* `checks/copper-pour.ts` emit site · the `measuredMm` field contract in
`sdks/designer/types.ts`.

**Resolved 2026-09-08 (Session 5).** `ISOLATED_COPPER_ISLAND` no longer sets `measuredMm`; the
area stays in the message (mm²). Live regression: `drc-audit-b3.test.ts` "B3-9" (now `test`).

### B3-10 — `anchored` accepts dead copper, and the message overclaims

An island is considered anchored if it intersects *any* same-net copper — including other dead
copper. The emitted message states the island is connected to a pad, which the check never
verifies.

*Anchor:* `copper-fill-geometry.ts`, anchoring predicate · `checks/copper-pour.ts` message text.

**Resolved 2026-09-08 (Session 5).** The check reads the S1 connectivity component of every kept
island (`DrcContext.pourResults()` → `pourItemKey` → `connectivity().componentOf`): an island is
dead iff its component contains no pad / free pad, so a floating same-net stub no longer anchors
it; the message says "reach no pad". The kernel's own `attached` flag is now only the
island-removal criterion (`docs/pcb-hardening/04-copper-pour-contract.md` §8, §10). Live
regression: `drc-audit-b3.test.ts` "B3-10" (now `test`), plus `drc-copper-pour.test.ts`.

---

# 3. Resolved — the B2-9 double-claim

Settled 2026-09-06 (Session 0). The route-tool via gate (`buildPcbViaForInsert` in
`command-executor.ts`) checks diameter, drill and annular ring through `below()` from
`pcb/tolerance.ts` — the same policy the engine uses — so P1's claim was right and the register
was stale. B2-9 is now a live executor-level parity test in `drc-audit-b2.test.ts`: a 5e-7 mm
deficit is accepted by the gate and not flagged by DRC, a 2e-6 mm deficit is rejected by the gate
and flagged by DRC, and an exact-minimum annular ring passes both. The former P7 group therefore
owns three findings (B5-LIVE-ROT-PAD, B5-LIVE-TH-PAD-SIDE → S8; B5-SYNC → S10).

---

# 4. Nomenclature trap — `drc-p0-fixes.test.ts` is not P0

There are two unrelated numbering schemes in the test suite and they collide.

`src/core/backend/tests/drc-p0-fixes.test.ts` and `drc-p1-fixes.test.ts` **predate this audit
entirely**. They belong to an earlier route-tool hardening round and have nothing to do with the
DRC hardening program's milestones P0 and P1.

The DRC hardening program's P0 artifacts are:

| Artifact | Purpose |
|---|---|
| `drc-audit-b1.test.ts` … `drc-audit-b5.test.ts` | The 40 audit regression fixtures; open ones are `test.todo` |
| `drc-golden.test.ts` | Golden-board full-report snapshots |
| `drc-determinism.test.ts` | Byte-identity across runs and processes |
| `drc-epsilon-matrix.test.ts` | Encodes the boundary semantics of §5.1 |

If you are looking for the status of an audit bug, only the `drc-audit-b*` files answer that
question. The `drc-p*-fixes` files are historical and their names should be read as
"route-tool phase 0/1", never as milestone names.

---

# 5. Reference — engineering contracts

Durable content extracted from the audit. These are properties of the engine as it stands, not
proposals.

## 5.1 Epsilon policy

Four distinct comparison regimes existed at audit time. The hardening program's P1 milestone
unified them into `src/modules/designer/backend/pcb/tolerance.ts` (`below` / `exceeds`,
`DRC_EPS_MM = 1e-6`, `SHORT_EPS_MM = 1e-4`) — one policy, grace everywhere, including the
route-tool via gate (the former B2-9 exception, verified closed 2026-09-06). The *semantics
chosen* are the part that must survive:

| Regime | Form | Applies to | Boundary behaviour |
|---|---|---|---|
| Minimums | `below(v, limit)` = `v < limit − 1e-6` | Manufacturability minimums, board checks | Exact-spec geometry passes; sub-nanometre float noise forgiven |
| Clearance | `gap < required − GEOM_EPS_MM` (0.5 nm grace, S6 — `clearanceViolated` in `tolerance.ts`) | All clearance pairs, FAB tier | Exact equality passes, including the derived-float case `0.3 − (0.1 + 0.1)` that the former bare `<` failed; a 1 nm deficit still errors |
| Short | `gap <= SHORT_EPS_MM` (1e-4), **inclusive** | Short tier | A gap of exactly 1e-4 mm is a short |
| Fab validators | bare `<` / `>`, no epsilon | Fab preset comparisons | Produced a real false positive on a derived float |

The asymmetry between regimes 1 and 2 is deliberate but was undocumented: trace coordinates are
integer nanometres, so exact-equality clearance cases are exactly representable. The exposure
was *derived* floats — diagonal geometry and half-width subtraction — which is where B1-3
lived, and where Astra (S6 run 1 #10) showed the bare `<` failing exact physical equality
(`0.3 − (0.1 + 0.1) = 0.09999999999999998 < 0.1`). S6 gave the clearance regime 0.5 nm of grace
(`GEOM_EPS_MM`), below the 1 nm deficit that must still fire (P-A2).

**The probe ladder.** These were run against the real engine through the parity harness with
integer-nm coordinates, where 1 nm equals `DRC_EPS_MM` exactly. They are the only record of the
chosen boundary semantics and are the specification an epsilon-matrix test must encode:

| Probe | Setup | Result |
|---|---|---|
| P-A0 | Different nets, rule 0.127 override, gap 0.200, default net class 0.25 | Clearance violation fires — proves the `max(rule, class)` floor |
| P-A1 | Null nets / unknown class (defeats the floor), gap exactly 0.127 = rule | Clean — bare `<` passes at equality |
| P-A2 | Gap = 0.127 − 1 nm | Violation fires — zero grace |
| P-A3a | Width 0.1999995 vs min 0.2 (deficit 5e-7, below eps) | Clean — `below()` grace |
| P-A3b | Width 0.199998 (deficit 2e-6, above eps) | `TRACE_WIDTH_MIN` fires |
| P-B1 | Different-net edges exactly touching (gap 0) | `NET_SHORT_CIRCUIT` |
| P-B2 | Gap 150 nm (above `SHORT_EPS`) | Clearance violation, not a short |
| P-B3 | Overlap (gap −0.1) | `NET_SHORT_CIRCUIT` |
| P-B4 | Gap exactly 100 nm | `NET_SHORT_CIRCUIT` — inclusive `<=` |
| P-C1 | Coincident vias, same net | Clean — coincident same-net exception |
| P-C2 | Coincident vias, different nets | `NET_SHORT_CIRCUIT` (error) plus `HOLE_TO_HOLE` (warning); via-to-via clearance is preempted by the short branch |

## 5.2 Determinism contract

The engine is a pure function of `(projection, options)`. Grep-verified: no `Date`, no
`Math.random`, no I/O anywhere under `drc/`. The persistence timestamp is injected *outside* the
engine, at the store's DRC-result write. Since S4 the options may carry `lookupRawFootprint`, a
map of raw KiCad footprints the CALLER pre-fetches from the library (`pcb/raw-footprint-lookup.ts`,
built by the `/drc/run` route, the SDK and the cloud apply paths) so a KiCad-imported placement
contributes its real courtyard to the keepout `footprints` extent; the engine only reads the map.
A DRC verdict can therefore differ between a run with and without the lookup (courtyard hull vs
the pads+graphics bounds — both supersets of the part) — every production entry point builds it.

Violation ids are FNV-1a-64 over the rule code plus the **sorted** anchor keys, which makes them
order-independent by construction rather than by convention.

Empirically: a non-trivial projection (3 nets, 2 layers, vias, placement pads, 7 violations across
5 codes) produced byte-identical full reports across two `structuredClone` copies and across
separate Bun processes. With the `traces[]` and `vias[]` arrays reversed, the violation-id
multiset, per-code counts, messages and locations were all identical.

**The caveat that must survive:** reordering the *input* arrays changes presentation order — the
order of `violations[]`, the key order of `countsByCode`, and anchor order within pairwise
violations. Consumers that need canonical bytes across input reorderings must **sort by violation
id** first. The in-repo determinism test proves only sorted-id stability; it does not prove
full-report byte-identity.

## 5.3 Net-class resolution chain

`resolveNetClassId` resolves in this order:

1. Explicit `perNetClassAssignments[netId]`, if that class still exists.
2. Anchored name regexes, tried in order: `GND_NAMES`, then `POWER_NAMES`, then `POWER_VOLTAGE`.
   All are fully anchored — `GND_SENSE` does **not** match the GND pattern.
3. **The first class in the `board.netClasses` array** (`defaultNetClassId`, S6 — one helper
   used by the resolver, the executor and the canvas; still `netClasses[0]?.id ?? "default"`).

Step 3 is array-order-dependent by contract (`docs/pcb-hardening/05-rule-semantics-contract.md`
§3): the stored order is semantic, the first class is the default, no UI reorders classes. S6
kept it deliberately — preferring a class whose id is `default` would have silently changed
existing boards (Astra S6 run 1 #8).

`clearanceMm` is enforced for every net through the clearance path. `traceWidthMm`,
`viaDiameterMm` and `viaDrillMm` are enforced by `checks/netclass.ts` (`NETCLASS_*`, added in
P5, severity warning) **only for nets deliberately classed — an explicit
`perNetClassAssignments` entry or a GND/POWER name match**; nets that fall to the array-order
default class get no width/via check. `defaultViaProtection` and `color` feed route-tool
defaults only.

**Model comparison** — worth keeping because it explains a functional gap:

| Tool | Model | Can a scoped rule relax? |
|---|---|---|
| OpenPCB | Explicit scoped rules (first match, may relax) → `max(boardRule, classA, classB)` → floor; scalar kinds first-match then the board minimum — `05-rule-semantics-contract.md` §4–§5 | Yes, above `minimums.clearanceMm` (S6) |
| KiCad | Larger-wins for implicit values, board minimum as absolute floor, plus priority-ordered custom rules (last matching rule wins) | Yes, above the floor, via custom rules |
| Altium | Pure priority-ordered first-match; one rule wins | Yes — a specific-scope rule may be *less* strict |

A pure tighten-only model cannot express the BGA-fanout relaxation that Altium's own documentation
uses as its worked example. That is why the hardening program's scoped rule engine explicitly
allows relaxation above a board-minimum floor (§6.1).

## 5.4 Scaling arithmetic

There is no R-tree, quadtree or grid in the DRC path (grep-verified at audit time; P4 adds one).
Clearance is six pair loops — T²/2, T·P, T·V, V²/2, P²/2, P·V — behind a linear AABB gap
prefilter which is itself O(n²). The exact kernel `polylineToPolylineClosestPoints` is
O(segA · segB), which is a 25–400× multiplier on close 45°-routed pairs. `HOLE_TO_HOLE` has no
prefilter at all. Board checks are O(primitives × outline vertices) and re-flatten the outline per
sampled point (B4-7).

| Copper primitives | Pair visits | Wall time | Verdict |
|---|---|---|---|
| 1k | ~5 × 10⁵ | Tens of ms | Fine |
| 10k | ~5 × 10⁷ | 0.5–5 s | Batch-tolerable, event-loop-hostile (B5-SYNC) |
| 100k | ~5 × 10⁹ | Minutes | Unusable |

Concrete thresholds: **batch becomes interactive-hostile at roughly 5–10k primitives**; the **live
path degraded at roughly 1–2k pads** at audit time because pad geometry was rebuilt per pending
segment (B5-LIVE-PADGEOMS, closed 2026-09-06 — now built once per `runLiveDrc` call and
broad-phase filtered by `PcbCanvas.tsx`; a per-cursor-move rebuild remains and is tracked for
S8/S9 in `docs/pcb-hardening/00-ground-truth.md`).
For contrast, KiCad's `DRC_RTREE` gives approximately O(n log n) queries.

The conclusion the audit reached and that still holds: this is a scaling problem, not a
correctness problem. A spatial index is a prerequisite for large boards, not for correct results.

## 5.5 Live-versus-batch divergence inventory

This inventory *is* P7's acceptance criteria. Live DRC implements only trace-to-trace (with
correct edge maths) and trace-to-pad. Everything else is batch-only. The user-facing pattern is
**live-clean, commit, batch-error**.

| Aspect | Batch | Live |
|---|---|---|
| Short tier | Yes | Absent |
| FAB tier | Yes | Absent |
| Vias | Checked | Never checked — a via placed mid-route gets zero live checking |
| Board edge / off-board / width / manufacturability | Yes | Absent |
| Pad geometry | Exact rotated polygon (`padOutlineWorldMm`) | Unrotated AABB (B5-LIVE-ROT-PAD) |
| THT pad layers | All copper layers | Placement side only (B5-LIVE-TH-PAD-SIDE) |
| Neighbour net class | Resolved | Ignored |
| Reported number | Edge gap vs rule | Centreline distance vs required + half-widths |
| Tests | Extensive | **Zero** |

P7's parity gate is `|measured_live − measured_batch| ≤ 1e-9`, achieved by making both paths call
the same item builders and clearance kernels rather than by fixing the live path in place.

## 5.6 Waiver semantics and drift

Waivers are id-based (`viewState.drcWaivedViolationIds: string[]`) and persisted per design in
`viewState`, alongside whole-rule-class ignores. This matches KiCad's behaviour of remembering
excluded violations between runs, and is coarser than KiCad's per-check severity remapping.
Since S6 an id that does not match the v2 format is pruned on read and on patch — a v1 id
cannot be recomputed (`05-rule-semantics-contract.md` §8).

**The drift mechanism.** A violation id hashes the rule code and the anchors — *not* the location
and *not* the measured value. Two consequences follow directly:

1. A waiver granted against a marginal 0.24 mm gap keeps suppressing that same pair as the
   geometry degrades. Demonstrated at 24× degradation: the pair reached 0.01 mm and stayed
   silent.
2. Two distinct hotspots between the same pair of objects collapse to one id. Only the first is
   reported, and waiving it hides both.

Violation-id v2 (§6.3) mitigates this with a 0.1 mm location bucket, but the reasoning above is
why the bucket exists and why it is applied to pairwise codes only.

## 5.7 JLCPCB threshold conflict and its resolution rule

Three sources in the repository gave three different sets of JLCPCB thresholds. The live
capabilities page was fetched three times and was consistent.

| Parameter | Code (`fab-presets.ts`) | Research doc §7 | `eda-standards` skill | JLCPCB live, 2026-07 |
|---|---|---|---|---|
| 2L trace / space | 0.127 | 0.127 | 0.127 | **0.10 / 0.10 mm** |
| ML trace / space | 0.0889 | 0.09 | — | **0.09 / 0.09 mm** |
| Min mechanical drill | 0.3 (2L) / 0.2 (4L) | 0.15 | 0.3 | **0.15 mm (both)** |
| Min via diameter | 0.6 (2L) / 0.45 (4L) | 0.25 | 0.56 | **0.25 mm** (hole 0.15, both) |
| Via annular per side | 0.15 (all presets) | — | 0.13 | **0.05 min / 0.075 recommended** |
| Hole-to-hole | rule default 0.25 | — | — | **via 0.2 / PTH 0.45** |
| Board edge | rule default 0.5 | — | 0.3 | **routed ≥0.2 / V-cut ≥0.4** |
| Mask dam | — | ≥0.2 | 0.1 | **0.10 (1 oz) / 0.20 (2 oz)** |
| Silk min line | — | 0.15 | 0.15 | **0.15 mm** |
| Max layers | — | 1–20 | — | **1–32** |
| Aspect ratio | 10 | — | — | **≤10:1 (through-hole)** |

**Resolution rule: treat the live capabilities page as the only threshold source of truth.**

All of the code's drift was in the over-warning (safe) direction except two cases: the annular-ring
row applied the ML PTH *component-hole* value (0.15; 2L is actually 0.18) to **vias**, whose
requirement is 0.05 per side — over-warning on legal vias while under-checking 2L PTH; and the 4L
preset's own minimum-compliant via always self-flagged.

**Still unfixed:** the `eda-standards` skill's JLCPCB preset (drill 0.3, via 0.56, annular 0.13)
matches neither the live page nor the research doc. The fab profile in code was refreshed
(§6.4); the skill was not.

## 5.8 Constraint gap map

Scored against a 16-item constraint taxonomy: **7 implemented, 1 partial, 8 missing** at audit
time.

| # | Constraint | Status at audit |
|---|---|---|
| 1 | Min trace width | Implemented |
| 2 | Min clearance | Implemented |
| 3 | Min annular ring | Implemented (nominal model) |
| 4 | Min drill / via size | Implemented |
| 5 | Board-edge clearance | Implemented (warning severity; holes not covered) |
| 6 | Copper-to-edge / silkscreen-on-pad | **Partial** — copper-to-edge yes, silkscreen checks entirely absent |
| 7 | Trace width vs current (IPC-2152) | Missing |
| 8 | Acid trap / acute angle | Missing |
| 9 | Sliver / min feature | Missing |
| 10 | Isolated copper island | Implemented (board-wide fills only) |
| 11 | Teardrop presence (Class 3) | Missing |
| 12 | HV clearance / creepage by voltage | Missing |
| 13 | Diff-pair gap and skew | Missing |
| 14 | Single-ended / differential impedance | Missing |
| 15 | Reference-plane gap crossing | Missing |
| 16 | Aspect ratio | Implemented (blind-via model wrong — B2-7) |

**Two corrections to the taxonomy itself**, which is otherwise the planning input everyone reaches
for:

- **#12 creepage is understated.** The taxonomy frames it as a later-phase concern. It is now a
  first-class native check in **both** KiCad 9 and Altium. Its priority should be raised, not
  deferred. (P10 subsequently implemented it.)
- **#15 reference-plane gap crossing is overstated.** It is not a mainstream DRC check. KiCad 9
  has no native equivalent; only Altium's Return Path rule covers it. The taxonomy implies it is
  standard; it is not.

## 5.9 `BOARD_OUTLINE_INVALID` — an anti-regression note

`BOARD_OUTLINE_INVALID` was declared in `sdks/designer/types.ts` and had a label in
`drc-labels.ts`, but for months it was **emitted nowhere**. A full-repo grep found exactly two
hits, both declarations. No outline closure or self-intersection validation existed anywhere, so
degenerate outlines silently produced nonsense edge-clearance results.

P5 resurrected it as `checks/outline.ts` (area, self-intersection, arcs, cutouts).

Record this because the failure mode is recurrent and invisible: a declared rule code with a
label and no emit site looks implemented from every direction except a grep for its emit. When
adding a code, add the emit and a test in the same change.

---

# 6. Reference — binding decisions and specifications

These are the specifications the hardening program locked in. They were recorded only in the plan
document, which has been retired; an implementer needs them.

## 6.1 Binding decisions

Approved and binding:

- **Full scope**: core plus DFM plus electrical plus signal-integrity checks.
- **Scoped priority rules**: first-match, **can relax**, with a board-minimum absolute floor.
- **Full multilayer 2–32** copper layers.
- **Breaking changes allowed with migration** — specifically violation-id v2, KiCad-aligned
  severities, and live net-class resolution.

## 6.2 Rule model

```
PcbDrcRule {
  id, name, enabled, priority,
  scopes[]      // net | netClass | layer | area | pairKind, combined with AND
  constraint,   // clearance | trackWidth | viaDiameter | viaDrill
                // | annularRing | holeToHole | edgeClearance
  severity?,
  comment?
}
```

Stored on `PcbBoardSettings.drcRules`, persisted through an extended `pcb_set_design_rules`.

**Resolution — authoritative text is `docs/pcb-hardening/05-rule-semantics-contract.md` §4–§6
(S6, 2026-09-08); the summary:**

1. Explicit tier — priority-descending first match (ties by array index). **May relax.** `net` /
   `netClass` match on either item; `area` requires **both** evaluation points inside the same one
   of the rule's polygons; pour pair kinds match only through an explicit `pairKind` scope.
2. Implicit tier — `max(boardRule[pairKind], classA, classB)`, byte-identical to pre-rule
   behaviour (`padToVia` reads `traceToViaMm`; the pour kinds read `pourToCopperMm ?? 0.5`).
3. Absolute floor — `minimums.clearanceMm` (0.1 mm on boards created after S6, 0 when absent).

Scalar kinds resolve by the same algorithm with the board minimum of their kind as the floor
("tighten-only" = that floor); they are enforced by the manufacturability and board checks since
S6. Area membership is evaluated on regions of constant scope membership (trace segments split at
the area rings), not at a representative point. A matched rule's `severity` applies to the
violations it decided. Invalid rules are refused on save and reported (`DRC_RULE_INVALID`);
partially ineffective ones are reported (`DRC_RULE_INEFFECTIVE`). Area rules are capped at 31
polygons; the 32nd makes its rule invalid rather than global. Memoised on
`(pairKind, layer, netA, netB, maskA, maskB)`.

**Remaining limitation, documented not silent:** cutout-overlap uses vertex containment, so
perpendicular crossing rectangles are missed (S2 territory, unchanged here).

## 6.3 Violation id v2

```
${code}-v2-${fnv1a64("v2|code#sortedAnchors#L:layer#Q:qx,qy")}
```

| Element | Rule |
|---|---|
| Location bucket `Q:qx,qy` | **0.1 mm**, applied to pair / short / fab / hole codes **only** — never to `UNCONNECTED_NET` or `ISOLATED_COPPER_ISLAND` |
| Layer `L:` | Hashed whenever set (this is what fixes cross-layer island id collisions) |
| `measuredMm` | **Never** hashed |

The engine is one monolithic `runDrc` (build `DrcContext` → the checks → a single pass applying
ignores, waivers, severity and ids); the draft/finalize split the plan described was never
implemented (verified 2026-09-06). Waivers live at `viewState.drcWaivedViolationIds: string[]` —
the `{ id, comment, waivedAt }` shape and the "one-shot v1-to-v2 remap through
`store.patchPcbViewState`" that earlier revisions of this section described never existed
(verified 2026-09-08); S6 prunes non-v2 ids on read and patch instead, and `runDrc` defaults
its ignore / waiver / override options from the projection so every entry point agrees.

## 6.4 Severity model

An exhaustive `DEFAULT_SEVERITY_BY_CODE` map lives in `drc/severity.ts`. Overrides
(`DrcSeverityOverrides`) live on **board settings**, not on `viewState`.

**Precedence: override → rule severity → default** — true since S6. Before S6 every check
hardcoded a severity literal on its draft, so the table was never reached as a default and a
scoped rule's `severity` never applied; drafts now carry no severity, the engine decides
(`05-rule-semantics-contract.md` §7). `HOLE_TO_BOARD_EDGE` (which emitted both `error` and
`warning`) was split: breach → `HOLE_OFF_BOARD` (error).

| Decision | Value |
|---|---|
| `NET_SHORT_CIRCUIT` override | **Ignored** — cannot be downgraded |
| `COPPER_TO_BOARD_EDGE` | Promoted to error (was hardcoded warning) |
| `UNCONNECTED_NET` | Promoted to error (KiCad alignment) |
| Non-waivable set (`NON_OVERRIDABLE`, the single list since S6) | `NET_SHORT_CIRCUIT`, `VIA_LAYER_SPAN`, `PAD_LAYER_MISMATCH`, `BOARD_OUTLINE_INVALID`, `ZONE_INVALID`, `ZONE_FILL_FAILED`, `DRC_RULE_INVALID` |
| `ignoredRuleClasses` | Retained |

Non-waivable codes survive both a class-level ignore and a per-code `"ignore"` override.

## 6.5 Fab profile — JLCPCB live capabilities, 2026-07

Typed and zod-validated in `src/shared/pcb/fab-profiles.ts`. `customFabProfile` on board settings
overrides. `DrcHole.kind` is `via | pth | npth` so per-hole fab checks can select the right row.

| Parameter | Value |
|---|---|
| Via min diameter | 0.25 mm |
| Via min annular per side | 0.05 mm (0.075 mm recommended) |
| PTH annular per side | 0.18 mm (2 layer) / 0.15 mm (multilayer) |
| Hole-to-hole, via to via | 0.2 mm |
| Hole-to-hole, PTH to PTH | 0.45 mm |
| Board edge, routed | 0.2 mm |
| Board edge, V-cut | 0.4 mm |
| Mask dam | 0.10 mm |
| Trace / space | 0.10 mm (2 layer) / 0.09 mm (multilayer) |
| Min drill | 0.15 mm |
| Aspect ratio | ≤10:1, through-hole |

PCBWay values were deferred to a re-fetch at implementation time and are not recorded here.

## 6.6 Electrical constants

IPC-2221 Table 6-1, columns B1 and B2, sourced at implementation time. Current-versus-width uses
the IPC-2221 formulation:

| Constant | Value |
|---|---|
| `k`, external layer | 0.048 |
| `k`, internal layer | 0.024 |
| `b` | 0.44 |
| `c` | 0.725 |
| `designRules.electrical.tempRiseC` | 10 |
| `designRules.electrical.copperWeightOz` | 1 |

Nets carrying no voltage are treated as 0 V. Creepage seeds from HV pads and vias as well as
traces, uses `|ΔV|` so negative rails behave, applies a per-pair-kind base clearance, and does not
double-emit on HV-to-HV pairs.

## 6.7 Signal-integrity thresholds

| Threshold | Value |
|---|---|
| Diff-pair near-parallel gate | < 15° |
| Uncoupled length | 15 mm |
| Skew | 0.5 mm |

Pair naming convention: `_P` / `_N` suffixes and trailing `+` / `-`. An explicit
`PcbBoardSettings.diffPairs` table **wins over inference**.

This design **explicitly rejects** the LLM-based and `signalType`-based inference proposed in
`TODO-signal-aware-routing.md`. Auto-detected pair order is deterministically sorted, duplicate
explicit pairs are deduped, negative thresholds are clamped, and the coupling angle calculation
handles wrap-around so anti-parallel segments and ±179° are not misclassified.

Length matching shipped separately and in-flight as `checks/length.ts`
(`NET_LENGTH_OUT_OF_RANGE`, `PcbBoardSettings.lengthMatchGroups`, behind the `pcb.lengthTuning`
flag) and was adopted as-is; diff-pair skew reconciles against its `lengthByNet`.

## 6.8 DFM parameters

| Parameter | Value |
|---|---|
| Courtyard fallback when none authored | Footprint bbox + **0.25 mm** |
| `designRules.silkscreen.silkToMaskClearanceMm` | 0 |
| `designRules.silkscreen.silkToBoardEdgeMm` | 0.15 |
| `sliverWidthMm` | 0.1 |
| `clearance.holeToBoardEdgeMm` | 0.3 |
| Acute-angle threshold | < 90° |

**Parity requirement:** silk strokes and mask apertures consumed by DFM checks must be built at
**Gerber parity** — the same geometry the Gerber writer emits, from the writer's own stroke and
aperture paths. A check that models silk differently from the exported artwork will disagree with
the fab.

Copper sliver and connection-width checks run a Clipper opening over memoized pour paths, cover
pours only in v1, and exempt hatched fills.

## 6.9 Via-span topology

Enforced at DRC by `isValidViaSpan`; `VIA_LAYER_SPAN` fires on any violation.

| Via type | Valid span |
|---|---|
| Through | Front to back (outer to outer) |
| Blind | Exactly one outer layer |
| Buried | No outer layer |
| Microvia | One adjacent layer step |

Explicitly flagged: a blind via spanning both outers, a reversed span, and a non-adjacent
microvia.

Note the interaction that made this urgent: a layer-invalid via used to escape trace-to-via,
via-to-via, pad-to-via **and the short tier**, leaving only a single waivable `VIA_LAYER_SPAN`
error. Waive that one violation and you ship a dead short. Layer-invalid items are now
clamp-checked against all valid layers, and the span code is non-waivable.

## 6.10 Cloud contract boundary

The desktop engine supports 2–32 copper layers. The cloud snapshot contract does not follow it:

- The snapshot builder **strips** `voltageV`, `currentA` and `diffPairGapMm` before sending.
- `SnapshotCopperLayerId` pins snapshot copper layers to **2 or 4**.

So cloud-side DRC cannot reproduce electrical or SI results, and cannot represent a 6+ layer
board. This is a deliberate contract boundary, not an oversight — but any feature that assumes
cloud and desktop DRC agree needs to account for it.
