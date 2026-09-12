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

Expect **0 call sites, 0 unique bug ids** (S5 closed B3-9 / B3-10; S7 added B6-1; S8 closed B5-LIVE-ROT-PAD / B5-LIVE-TH-PAD-SIDE and added B7-1; S10 closed B5-SYNC; S11 closed B2-5 / B2-6 / B2-7 / B6-1; S13 closed B7-1), and every body a real post-fix assertion
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

### B5-LIVE-ROT-PAD and B5-LIVE-TH-PAD-SIDE — closed in S8 (2026-09-09)

Both were properties of a second pad model in `frontend/pcb/drc/live-drc.ts` (an unrotated AABB on
the placement's side layer). S8 deleted that model: the live check, the commit gates, the smart-via
and tune guards and the server-side commit gate all call `checkPendingCopper`
(`src/shared/drc/legality.ts`), which builds the pending copper with the batch item builder and
judges it with the batch pair bodies against a `LegalityContext` built from the same records
(`docs/pcb-hardening/07-live-parity-contract.md`). Live regressions: `drc-audit-b5.test.ts`
"B5-LIVE-ROT-PAD" / "B5-LIVE-TH-PAD-SIDE" (now `test`), plus the parity harness
`drc-live-parity.test.ts` (leave-one-out over the six goldens, attribution fixtures, obstacle
superset, server ↔ live through the runtime).

### B7-1 — closed in S13 (2026-09-12): unassigned copper did not inherit the rule tier of the net it extends

Was: since S8 (`06-batch-drc-contract.md` §4) a null-net item touching exactly one named net is an
extension of that net, so its overlap with that net is no longer a clearance error. But its pairs
with every OTHER net still resolved with the null-net requirement — the board default, no class,
no net-scoped rule — so a net-less trace that started on a 2 mm-class net and passed 0.5 mm from
another net was clean in batch and at the live / server gates alike (Astra S8 run 2 #1; parity held,
the verdict was wrong on both sides). Pre-existing before S8 (the null tier was the default then
too); the extension wording made it explicit.

Now (`docs/pcb-hardening/13-electrical-contract.md` §4): `pcb-connectivity/effective-nets.ts` is a
pure kernel that gives every unassigned copper item the TIER of the conductor it physically
extends, built once with the context and immutable for its life. The pair judge and the per-item
forms that carry a tier — `netClassItems`, `currentItems` — resolve on that tier; the original
net is what anchors, the short tier and the bridge record keep. The live gate applies the same
overlay before any check reads a tier and rejudges the existing items the pending copper
re-tiered, so live and batch stay in step.

*Regression:* `drc-audit-b7.test.ts` "B7-1" (live) — a null-net trace extending a 2 mm-class net is
judged against other nets as that net, in batch and through `checkPendingCopper` alike.

### B5-SYNC — closed in S10 (2026-09-10): the batch run executed synchronously in the HTTP handler

Was: `POST /designs/:designId/drc/run` ran the engine inline on the backend's single thread —
Bun in dev, **Electron's main process** in the app — so command dispatch, SSE and the desktop
shell stalled for the whole run (0.5–5 s at 10k primitives before S9, and unbounded on a
pour-heavy board). The engine itself was pure and correct; this was a placement problem.

Now (`docs/pcb-hardening/09-execution-contract.md`): every batch run executes on one persistent
`node:worker_threads` worker (`src/shared/drc/worker/`); the designer's `DrcRunService` owns the
lifecycle (`POST /drc/runs` → 202, `GET /runs/:id`, `POST /runs/:id/cancel`, SSE `/stream`);
`POST /drc/run`, the SDK and the cloud apply sites await the same service, so no module code
calls the engine inline; the report is byte-identical to the in-thread engine; nothing is
persisted before `completed`; cancel is a shared flag at stage / pour-zone boundaries with
`terminate()` as the fallback.

*Regression:* `drc-audit-b5.test.ts` "B5-SYNC" — live: (a) a held worker proves a command
dispatch completes while `GET /runs/:id` still reports `running`, the released run persists
`runDrc(projection)`'s exact bytes, and a cancelled run persists nothing; (b) the real worker
completes on a seeded design with equal bytes. Loop freedom on a 10k board (timer ticks, `GET
/api/health`, progress frames all before the run resolves) is `drc-worker-client.test.ts`.

## S11 — export parity (raised by the S7 Astra run, 2026-09-09) — CLOSED 2026-09-10

B6-1 (a non-orthogonally rotated pad shipped un-rotated in the Gerber; an unequal `circle` had
two interpretations) is closed by S11: the Gerber flashes copper, mask and paste from the S1
copper records with rotated aperture macros, a `circle` pad is a disc of `widthMm` everywhere,
and `gerber-pad-parity.test.ts` holds every golden's artwork to the record geometry within
2e-6 mm per layer file. Regression: `drc-audit-b6.test.ts` B6-1 (live). Contract:
`docs/pcb-hardening/10-manufacturability-contract.md` §6–§7.

## S11 — manufacturability, S5 — pours (formerly P9) — CLOSED (S5 2026-09-08, S11 2026-09-10)

The DFM overlay checks P9 was to add (courtyard, silkscreen, mask, copper shape) are S12 and own
no register entry — none of those codes exist yet. The nine pre-existing findings P9 carried are
all closed: the layer-blindness cluster in S1 (§1), the two island findings in S5, and the three
manufacturability geometry defects in S11 — B2-5 (slots: every hole now comes from ONE drill
derivation per object, footprint slots and drill offsets included, and `DRILL_SIZE_MIN` / the fab
rows judge the tool width), B2-6 (the annular ring is the exact signed-distance kernel of
`pcb-geometry/pad-annular.ts`, breakout judged first), B2-7 (`VIA_ASPECT_RATIO` is
`boardThicknessMm / drillMm` for through vias only; every non-through via is
`VIA_TYPE_UNSUPPORTED` on every fabricator and the export refuses it). Regressions:
`drc-audit-b2.test.ts` B2-5 / B2-6 / B2-7 (live), `golden-holes-4l`. Contract:
`docs/pcb-hardening/10-manufacturability-contract.md`.

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
| Clearance | `gap < required − GEOM_EPS_MM` (0.5 nm grace, S6 — `clearanceViolated` in `tolerance.ts`) | All copper clearance pairs, copper-to-edge, copper-to-hole (S7) | Exact equality passes, including the derived-float case `0.3 − (0.1 + 0.1)` that the former bare `<` failed; a 1 nm deficit still errors |
| Fab capability | `below(gap, fabMin)` = the minimums regime | `FAB_CLEARANCE`, `FAB_HOLE_TO_HOLE`, the fab validators | Recorded in S7 (`06-batch-drc-contract.md` §5): the FAB tier never moved to the clearance regime — this table used to say it had |
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

## 5.4 Scaling arithmetic — superseded by S9 (2026-09-09)

**As of S9** (`docs/pcb-hardening/08-broad-phase-contract.md`) candidate discovery runs through two
indexes built once per context — a per-kind uniform grid with per-sub-segment trace entries, and a
boundary-edge index on the board region — while every verdict is still reached by the unchanged
bodies and comparisons. The pre-S9 enumerations stay in the tree behind `broadPhase: "exhaustive"`
as the oracle, and a harness proves byte-identical reports and equal pre-finalise draft multisets in
both modes on every golden, the determinism fixture and a seeded corpus. Measured on a synthetic
10 000-primitive board (this machine): `checkClearance` 1 035 → 35 ms, `checkBoard` 2 130 → 25 ms,
`runDrc` 3.5 s → 136 ms (the 300 ms target). The paragraph below is the pre-S9 record, kept for
the arithmetic it explains.

Pre-S9: there was no R-tree, quadtree or grid in the batch DRC path.
Clearance was six pair loops — T²/2, T·P, T·V, V²/2, P²/2, P·V — behind a linear AABB gap
prefilter which was itself O(n²). The exact kernel `polylineToPolylineClosestPoints` is
O(segA · segB), which is a 25–400× multiplier on close 45°-routed pairs. `HOLE_TO_HOLE` had no
prefilter at all. Board checks were O(primitives × outline vertices) and re-flattened the outline per
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

The conclusion the audit reached held: this was a scaling problem, not a correctness problem, and
S9 closed it without changing a verdict; S10 moved the run off the request thread (B5-SYNC
closed 2026-09-10, `docs/pcb-hardening/09-execution-contract.md`).

## 5.5 Live-versus-batch divergence — closed in S8

The inventory this section used to carry (short tier, fab tier, vias, edge, pad geometry, THT
layers, neighbour class, reported number — all batch-only or approximated live) is gone: since S8
the live path IS the batch pair kernel over the pending copper. The contract is
`docs/pcb-hardening/07-live-parity-contract.md` §1 — two clauses, compared with `===` on
`measuredMm` / `requiredMm` (the old `≤ 1e-9` budget is unused): attribution (the live verdict
equals the batch violations that name the pending copper, plus the bridges it grows) and
non-perturbation (committing the copper changes no other verdict, except the bridge it replaces).
The remaining, declared limits are 07 §9: codes outside the live set (electrical, SI, dangling,
board-wide), obstacles as AABB heuristics, unsynced placements invisible to the server gate, the
client's `pending:<n>` ids.

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
| 3 | Min annular ring | Implemented (exact signed-distance kernel since S11; breakout first) |
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
| 16 | Aspect ratio | Implemented (through vias only since S11; non-through vias are `VIA_TYPE_UNSUPPORTED` — B2-7 closed) |

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

The same shape recurred with a preset field: `PcbFabPreset.maskDamMm` (0.1 on every preset,
"minimum solder-mask dam") was declared and never read by any check until S12 gave it its
emitter, `checks/solder-mask.ts` (`FAB_MASK_BRIDGE`). A declared constant with no consumer is
the same false comfort as a declared code with no emit site — grep for the READ, not the field.

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

S11 (2026-09-10) re-fetched both fabricators' pages and added the sourced rows `minNpthDrillMm`,
`minPlatedSlotWidthMm`, `minNpthSlotWidthMm`, `npthAnnularRingMm` (JLCPCB only) and `viaTypes`
(through only, both fabricators) to `fab-presets.ts`, each with its quote and fetch date —
`docs/pcb-hardening/10-manufacturability-contract.md` §4 is the table.

## 6.6 Electrical constants

Sourced in S13 (`docs/pcb-hardening/13-electrical-contract.md` §6.1): two independent
transcriptions of IPC-2221B Table 6-1 fetched on 2026-09-11 — KiCad 8's
`panel_electrical_spacing_ipc2221.cpp` at commit `942661fc` and smpspowersupply.com's IPC-2221B
clearance page — which agree row for row. IPC-2221B itself is paywalled and has not been read, so
these are secondary. Edition **B** is pinned: IPC-2221C (Dec 2023) carries different values and
sources are never mixed.

| Voltage (V, DC or peak, `Δ ≤ max`) | B1 internal | B2 external uncoated (≤ 3050 m) | B4 external, permanent polymer coating |
|---|---|---|---|
| 0–15 | 0.05 | 0.1 | 0.05 |
| 16–30 | 0.05 | 0.1 | 0.05 |
| 31–50 | 0.1 | 0.6 | 0.13 |
| 51–100 | 0.1 | 0.6 | 0.13 |
| 101–150 | 0.2 | 0.6 | 0.4 |
| 151–170 | 0.2 | 1.25 | 0.4 |
| 171–250 | 0.2 | 1.25 | 0.4 |
| 251–300 | 0.2 | 1.25 | 0.4 |
| 301–500 | 0.25 | 2.5 | 0.8 |
| > 500 | 0.25 + 0.0025·(V − 500) | 2.5 + 0.005·(V − 500) | 0.8 + 0.00305·(V − 500) |

Bands are stepped, never interpolated. The current-versus-width estimate uses the IPC-2221
conductor formula `A(mil²) = (I / (k · ΔT^b))^(1/c)` with `width = A / thickness` and
`thickness = oz × 1.378 mil`:

| Constant | Value |
|---|---|
| `k`, external layer | 0.048 |
| `k`, internal layer | 0.024 |
| `b` | 0.44 |
| `c` | 0.725 |
| `designRules.electrical.tempRiseC` | 10 |
| `designRules.electrical.copperWeightOz` | 1 |
| `designRules.electrical.innerCopperWeightOz` | falls back to `copperWeightOz`, then 1 |

Assumptions (13 §1.3, §2, §5). Each verdict names the inputs it used and the choices it made: a
`CREEPAGE_DISTANCE` row names the differential Δ, the conductor column, the exposure decision
whenever a declared coating made B4 available (`coated per design rule` / `exposed conductor`),
and — when one side declares no potential — that the undeclared net is ASSUMED at the board
reference potential; a `TRACE_CURRENT_WIDTH` row names the current, the temperature rise, the
copper weight, the layer class, and that every segment is judged as carrying the FULL class
current. Two assumptions live here rather than in the message: Δ is the interval form
`Δ = max(|a.min − b.max|, |a.max − b.min|)`, and the copper weight is the declared nominal, not a
minimum finished thickness. Not claimed: creepage as distinct from same-layer clearance,
insulation coordination, cross-layer pairs, actual temperature rise, via / pour / pad ampacity,
current sharing between parallel paths.

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

## 6.8 DFM parameters — shipped in S12 (2026-09-11, `docs/pcb-hardening/11-dfm-contract.md`)

The values below were a specification until S12; they are now the defaults of the optional
`designRules.silkscreen` / `solderMask` / `dfm` sub-objects (contract 11 §6) and the fab rows of
`fab-presets.ts` (every row with its URL and fetch date).

| Parameter | Value | Where |
|---|---|---|
| `dfm.courtyardFallbackMm` (no authored courtyard: `preview.bounds` or the pad box, inflated) | **0.25 mm** (IPC-7351B level B) | contract 11 §2.1 |
| `silkscreen.silkToMaskClearanceMm` | 0 (only true penetration reports) | §3 |
| `silkscreen.silkToBoardEdgeMm` | 0.15 | §3 |
| `solderMask.minBridgeMm` | absent — the fab row `maskDamMm` judges (JLCPCB 0.10 green 1 oz, PCBWay 0.1016) | §4 |
| `dfm.sliverWidthMm` | 0.1, capped by `minimums.traceWidthMm` | §5.1 |
| `dfm.sliverMinLengthMm` | 0.2 | §5.4 |
| `clearance.holeToBoardEdgeMm` | 0.3 (pre-existing) | — |
| `dfm.acuteAngleDeg` | 90 (`θ < 90 − 1e-6°` reports; collinear junctions are `TRACE_OVERLAP`'s) | §5.6 |

**Parity is by construction, not by discipline:** the silk strokes and mask openings the DFM
checks judge come from `src/shared/rendering/pcb/artwork/` — the same model the Gerber writer
emits (`gerber-silk-parity.test.ts` proves the legend and mask files equal the model 1:1). The
writer no longer owns any silk or mask geometry.

Copper connection width is judged on the EROSION of the per-(layer, net) copper union (pads,
traces, vias and pour islands together; the opening cannot see a neck shorter than the disc
reach — contract 11 §5.2), necks are located by bisection on the erosion radius, and slivers are
thickness-classified residuals of the opening. Pours-only v1 and the hatched-fill exemption are
superseded (hatched fills import as solid since S3a).

## 6.8b Exact geometry — shipped in S12b (2026-09-11, `docs/pcb-hardening/12-exact-geometry-contract.md`)

The three recorded geometry limits are closed: connectivity's circumscribed oval / roundrect ring
(06 §5, Astra S7 #5 — a real ≈ 2 µm open hidden) — every pad gap and touch is now exact on a
convex-core ⊕ disc shape; the ≤ 0.01 mm false-fail band on curved board edges (02 §6) — board-edge
verdicts are certified on `R_inner ⊆ R_true ⊆ R_outer` and recomputed exactly only when the
interval straddles the verdict; a true-simple contour rejected by chord flattening (02 §3, S2 #8)
— outline validity and the editor gate run one exact predicate. New: `OUTLINE_MIN_WEB`
(`outline.minWebMm`, erosion-defined webs incl. cutout-to-edge, cutout-to-cutout, a narrow outer
outline), `OUTLINE_WEB_UNCHECKED` (the never-silent budget / certificate note), the Gerber
Profile with true arcs. Failure modes recorded as limits (12 §10): ellipse outlines stay chords;
the pour still clears against the circumscribed ring; a 1-ulp flip window at exactly
`CONNECT_EPS_MM`; CAM acceptance of a ≤ 2√2 nm radius residual needs verification.

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
